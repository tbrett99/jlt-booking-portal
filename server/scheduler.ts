/**
 * Scheduled jobs for the JLT Group Booking Portal.
 * Currently runs:
 *   - Nightly full data ZIP export at 04:00 UTC → max@thejltgroup.co.uk
 *   - Task reminders
 *   - Inbox auto-import every 15 minutes
 */
import cron from "node-cron";
import nodemailer from "nodemailer";
import archiver from "archiver";
import { PassThrough } from "stream";
import { getDb, getTasksDueForReminder, markCalendarReminderSent, getImapConfig } from "./db";
import {
  bookings, users, commissionClaims, amendments, amendmentLineItems,
  cancellations, refunds, refundSuppliers, notes, reimbursementItems,
  reimbursementItemDocs, reimbursementDocs, paymentLinks, flightRequests,
  remittanceBatches, remittanceLines, commissionRemittances, commissionRemittanceItems,
  pipelineHistory, inAppNotifications, exportRuns,
} from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { format } from "date-fns";
import { importInbox, decryptPassword } from "./imap";
import { notifyOwner } from "./_core/notification";

// ─── Inbox auto-import state ──────────────────────────────────────────────────

let inboxImportRunning = false;
let inboxLastRunAt: Date | null = null;
let inboxLastResult: { imported: number; skipped: number; errors: number } | null = null;
let inboxNextRunAt: Date | null = null;

export function getInboxSchedulerStatus() {
  return {
    isRunning: inboxImportRunning,
    lastRunAt: inboxLastRunAt,
    lastResult: inboxLastResult,
    nextRunAt: inboxNextRunAt,
    intervalMinutes: 15,
  };
}

async function runInboxImport(fullImport = false) {
  if (inboxImportRunning) {
    console.log("[InboxScheduler] Import already in progress, skipping");
    return;
  }
  const config = await getImapConfig();
  if (!config || !config.host || !config.email) {
    console.log("[InboxScheduler] IMAP not configured — skipping auto-import");
    return;
  }
  inboxImportRunning = true;
  const sinceDate = fullImport
    ? undefined
    : inboxLastRunAt
      ? new Date(inboxLastRunAt.getTime() - 5 * 60 * 1000)
      : undefined;
  console.log(
    `[InboxScheduler] Auto-import started at ${new Date().toISOString()} (${fullImport ? "full" : sinceDate ? `since ${sinceDate.toISOString()}` : "full — first run"})`
  );
  try {
    const password = decryptPassword(config.passwordEncrypted);
    const result = await importInbox(
      { host: config.host, port: config.port, email: config.email, password, useSsl: config.useSsl ?? true },
      undefined,
      sinceDate
    );
    inboxLastRunAt = new Date();
    inboxLastResult = result;
    console.log(`[InboxScheduler] Done — ${result.imported} new, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (err) {
    console.error("[InboxScheduler] Auto-import failed:", err);
    inboxLastRunAt = new Date();
    inboxLastResult = { imported: 0, skipped: 0, errors: 1 };
  } finally {
    inboxImportRunning = false;
    inboxNextRunAt = new Date(Date.now() + 15 * 60 * 1000);
  }
}

export async function runFullInboxImport() {
  return runInboxImport(true);
}

const EXPORT_RECIPIENT = "max@thejltgroup.co.uk";
const EXPORT_RECIPIENT_NAME = "Max";

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  try {
    return format(new Date(d), "dd/MM/yyyy HH:mm");
  } catch {
    return "";
  }
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines: string[] = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers.map((h) => {
        const v = row[h];
        if (v instanceof Date) return escapeCsv(formatDate(v));
        return escapeCsv(v);
      }).join(",")
    );
  }
  return lines.join("\n");
}

// ─── Build a ZIP buffer containing one CSV per table ─────────────────────────

async function buildExportZip(db: Awaited<ReturnType<typeof getDb>>): Promise<{ buffer: Buffer; summary: Record<string, number> }> {
  if (!db) throw new Error("Database unavailable");

  // ── Fetch all tables ──────────────────────────────────────────────────────

  const [
    bookingRows,
    userRows,
    claimRows,
    amendmentRows,
    amendmentLineRows,
    cancellationRows,
    refundRows,
    refundSupplierRows,
    noteRows,
    reimbItemRows,
    reimbItemDocRows,
    reimbDocRows,
    paymentLinkRows,
    flightRequestRows,
    remittanceBatchRows,
    remittanceLineRows,
    commRemittanceRows,
    commRemittanceItemRows,
    pipelineHistoryRows,
  ] = await Promise.all([
    // Bookings — join agent name
    db.select({
      id: bookings.id,
      clientName: bookings.clientName,
      clientEmail: bookings.clientEmail,
      agentId: bookings.agentId,
      agentName: users.name,
      agentEmail: users.email,
      currentStage: bookings.currentStage,
      departureDate: bookings.departureDate,
      bookedDate: bookings.bookedDate,
      topdogRef: bookings.topdogRef,
      ptsRef: bookings.ptsRef,
      destination: bookings.destination,
      passengers: bookings.passengers,
      numberOfNights: bookings.numberOfNights,
      grossCost: bookings.grossCost,
      expectedCommission: bookings.expectedCommission,
      finalSupplierPaymentDate: bookings.finalSupplierPaymentDate,
      reimbursementsRequired: bookings.reimbursementsRequired,
      suppliersAndDocsAddedToPts: bookings.suppliersAndDocsAddedToPts,
      isPersonalBooking: bookings.isPersonalBooking,
      commissionPreAuthorised: bookings.commissionPreAuthorised,
      createdAt: bookings.createdAt,
      updatedAt: bookings.updatedAt,
    }).from(bookings).leftJoin(users, eq(bookings.agentId, users.id)).orderBy(bookings.id),

    // Users (agents & admins) — exclude password hashes
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    }).from(users).orderBy(users.id),

    // Commission claims
    db.select().from(commissionClaims).orderBy(commissionClaims.id),

    // Amendments
    db.select().from(amendments).orderBy(amendments.id),

    // Amendment line items
    db.select().from(amendmentLineItems).orderBy(amendmentLineItems.id),

    // Cancellations
    db.select().from(cancellations).orderBy(cancellations.id),

    // Refunds (bank details are already AES-256 encrypted in DB — safe to export as-is)
    db.select().from(refunds).orderBy(refunds.id),

    // Refund suppliers
    db.select().from(refundSuppliers).orderBy(refundSuppliers.id),

    // Notes
    db.select().from(notes).orderBy(notes.id),

    // Reimbursement items
    db.select().from(reimbursementItems).orderBy(reimbursementItems.id),

    // Reimbursement item docs
    db.select().from(reimbursementItemDocs).orderBy(reimbursementItemDocs.id),

    // Reimbursement docs (legacy booking-level)
    db.select().from(reimbursementDocs).orderBy(reimbursementDocs.id),

    // Payment links
    db.select().from(paymentLinks).orderBy(paymentLinks.createdAt),

    // Flight requests
    db.select().from(flightRequests).orderBy(flightRequests.id),

    // Remittance batches
    db.select().from(remittanceBatches).orderBy(remittanceBatches.id),

    // Remittance lines
    db.select().from(remittanceLines).orderBy(remittanceLines.id),

    // Commission remittances (PTS CSV uploads)
    db.select().from(commissionRemittances).orderBy(commissionRemittances.id),

    // Commission remittance items
    db.select().from(commissionRemittanceItems).orderBy(commissionRemittanceItems.id),

    // Pipeline history
    db.select().from(pipelineHistory).orderBy(pipelineHistory.id),
  ]);

  const tables: Array<{ filename: string; rows: Record<string, unknown>[] }> = [
    { filename: "bookings.csv",                    rows: bookingRows as Record<string, unknown>[] },
    { filename: "users.csv",                       rows: userRows as Record<string, unknown>[] },
    { filename: "commission_claims.csv",           rows: claimRows as Record<string, unknown>[] },
    { filename: "amendments.csv",                  rows: amendmentRows as Record<string, unknown>[] },
    { filename: "amendment_line_items.csv",        rows: amendmentLineRows as Record<string, unknown>[] },
    { filename: "cancellations.csv",               rows: cancellationRows as Record<string, unknown>[] },
    { filename: "refunds.csv",                     rows: refundRows as Record<string, unknown>[] },
    { filename: "refund_suppliers.csv",            rows: refundSupplierRows as Record<string, unknown>[] },
    { filename: "notes.csv",                       rows: noteRows as Record<string, unknown>[] },
    { filename: "reimbursement_items.csv",         rows: reimbItemRows as Record<string, unknown>[] },
    { filename: "reimbursement_item_docs.csv",     rows: reimbItemDocRows as Record<string, unknown>[] },
    { filename: "reimbursement_docs.csv",          rows: reimbDocRows as Record<string, unknown>[] },
    { filename: "payment_links.csv",               rows: paymentLinkRows as Record<string, unknown>[] },
    { filename: "flight_requests.csv",             rows: flightRequestRows as Record<string, unknown>[] },
    { filename: "remittance_batches.csv",          rows: remittanceBatchRows as Record<string, unknown>[] },
    { filename: "remittance_lines.csv",            rows: remittanceLineRows as Record<string, unknown>[] },
    { filename: "commission_remittances.csv",      rows: commRemittanceRows as Record<string, unknown>[] },
    { filename: "commission_remittance_items.csv", rows: commRemittanceItemRows as Record<string, unknown>[] },
    { filename: "pipeline_history.csv",            rows: pipelineHistoryRows as Record<string, unknown>[] },
  ];

  // ── Build ZIP in memory ───────────────────────────────────────────────────
  const summary: Record<string, number> = {};
  const bufferChunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const passthrough = new PassThrough();

    passthrough.on("data", (chunk: Buffer) => bufferChunks.push(chunk));
    passthrough.on("end", resolve);
    passthrough.on("error", reject);
    archive.on("error", reject);

    archive.pipe(passthrough);

    for (const { filename, rows } of tables) {
      summary[filename] = rows.length;
      const csvContent = rowsToCsv(rows);
      archive.append(csvContent, { name: filename });
    }

    archive.finalize();
  });

  return { buffer: Buffer.concat(bufferChunks), summary };
}

// ─── Export logic ─────────────────────────────────────────────────────────────

export async function runNightlyExport(triggeredBy: string = "cron"): Promise<{ success: boolean; rowCount?: number; error?: string }> {
  try {
    const db = await getDb();
    if (!db) return { success: false, error: "Database unavailable" };

    const exportDate = format(new Date(), "yyyy-MM-dd");
    const zipFilename = `jlt-portal-export-${exportDate}.zip`;

    console.log(`[Scheduler] Building full data export ZIP for ${exportDate}…`);
    const { buffer, summary } = await buildExportZip(db);

    const totalRows = Object.values(summary).reduce((a, b) => a + b, 0);
    const summaryLines = Object.entries(summary)
      .map(([file, count]) => `<tr><td style="padding:4px 12px 4px 0;color:#414141;">${file.replace(".csv", "")}</td><td style="padding:4px 0;color:#414141;font-weight:600;">${count.toLocaleString()}</td></tr>`)
      .join("");

    // Send email with ZIP attachment
    const port = Number(process.env.SMTP_PORT ?? 465);
    const secure = port === 465 || process.env.SMTP_SECURE === "true";
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "mail.thejltgroup.co.uk",
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"JLT Group Booking Portal" <support@thejltgroup.co.uk>`,
      to: `"${EXPORT_RECIPIENT_NAME}" <${EXPORT_RECIPIENT}>`,
      subject: `Nightly Full Data Export — ${exportDate} (${totalRows.toLocaleString()} total rows)`,
      html: `
        <div style="font-family: 'Poppins', Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #FFF6ED; padding: 32px; border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #414141; font-size: 24px; margin: 0;">JLT Group Booking Portal</h1>
            <div style="width: 60px; height: 4px; background: #70FFE8; margin: 12px auto 0;"></div>
          </div>
          <p style="color: #414141;">Hi ${EXPORT_RECIPIENT_NAME},</p>
          <p style="color: #414141;">Please find attached the nightly full data export for <strong>${exportDate}</strong>. The ZIP contains one CSV file per table, covering all bookings, commissions, amendments, refunds, reimbursements, notes, payment links, flight requests, and remittance data.</p>
          <div style="background: #fff; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #02E6D2;">
            <p style="margin: 0 0 12px; color: #414141; font-weight: 600;">Export summary — ${exportDate}</p>
            <table style="border-collapse: collapse; width: 100%;">
              ${summaryLines}
              <tr style="border-top: 2px solid #e5e7eb;">
                <td style="padding:8px 12px 4px 0;color:#414141;font-weight:700;">Total rows</td>
                <td style="padding:8px 0 4px;color:#02E6D2;font-weight:700;">${totalRows.toLocaleString()}</td>
              </tr>
            </table>
          </div>
          <p style="color: #888; font-size: 13px;">This is an automated nightly export. All portal data is included regardless of stage or status.</p>
          <p style="color: #414141; margin-top: 32px;">The JLT Group Booking Portal</p>
        </div>
      `,
      attachments: [
        {
          filename: zipFilename,
          content: buffer,
          contentType: "application/zip",
        },
      ],
    });

    console.log(`[Scheduler] Nightly export sent: ${totalRows} total rows across ${Object.keys(summary).length} tables → ${EXPORT_RECIPIENT}`);

    // Log success to DB
    try {
      await db.insert(exportRuns).values({ success: true, rowCount: totalRows, triggeredBy });
    } catch (logErr) {
      console.error("[Scheduler] Failed to log export run:", logErr);
    }
    return { success: true, rowCount: totalRows };
  } catch (err: any) {
    console.error("[Scheduler] Nightly export failed:", err?.message);
    try {
      const db2 = await getDb();
      if (db2) await db2.insert(exportRuns).values({ success: false, errorMessage: err?.message ?? "Unknown error", triggeredBy });
    } catch { /* ignore */ }
    try {
      await notifyOwner({
        title: "⚠️ Nightly Export Failed",
        content: `The nightly full data export failed at ${new Date().toISOString()}. Error: ${err?.message ?? "Unknown error"}. Please check the server logs.`,
      });
    } catch { /* ignore */ }
    return { success: false, error: err?.message };
  }
}

// ─── Get last export run status ───────────────────────────────────────────────

export async function getLastExportRun() {
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(exportRuns).orderBy(desc(exportRuns.ranAt)).limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Task reminder logic ──────────────────────────────────────────────────────

export async function runTaskReminders(): Promise<{ sent: number; errors: number }> {
  const db = await getDb();
  if (!db) return { sent: 0, errors: 0 };

  const tasks = await getTasksDueForReminder();
  let sent = 0;
  let errors = 0;

  for (const task of tasks) {
    try {
      const port = Number(process.env.SMTP_PORT ?? 465);
      const secure = port === 465 || process.env.SMTP_SECURE === "true";
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? "mail.thejltgroup.co.uk",
        port,
        secure,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });

      // task.assigneeName is the name; we send to the portal owner as fallback
      // since getTasksDueForReminder doesn't return an email address
      await transporter.sendMail({
        from: `"JLT Group Booking Portal" <support@thejltgroup.co.uk>`,
        to: EXPORT_RECIPIENT,
        subject: `Task Reminder: ${task.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #414141;">Task Reminder</h2>
            <p style="color: #414141;">A task is due tomorrow${task.assigneeName ? ` (assigned to <strong>${task.assigneeName}</strong>)` : ""}:</p>
            <div style="background: #f9fafb; border-left: 4px solid #02E6D2; padding: 16px; border-radius: 4px; margin: 16px 0;">
              <p style="margin: 0; font-weight: 600; color: #414141;">${task.title}</p>
              ${task.dueDate ? `<p style="margin: 8px 0 0; color: #414141;"><strong>Due:</strong> ${format(new Date(task.dueDate), "dd MMM yyyy")}</p>` : ""}
            </div>
            <p style="color: #888; font-size: 13px;">Log in to the portal to view and manage this task.</p>
          </div>
        `,
      });

      await markCalendarReminderSent(task.id);
      sent++;
    } catch (err) {
      console.error(`[Scheduler] Failed to send reminder for task ${task.id}:`, err);
      errors++;
    }
  }

  return { sent, errors };
}

// ─── Cron wiring ──────────────────────────────────────────────────────────────

export function startScheduler() {
  // Run at 04:00 UTC every day — nightly full data export
  cron.schedule("0 4 * * *", async () => {
    console.log("[Scheduler] Starting nightly full data export…");
    const result = await runNightlyExport("cron");
    if (result.success) {
      console.log(`[Scheduler] Export complete — ${result.rowCount} total rows`);
    } else {
      console.error(`[Scheduler] Export failed — ${result.error}`);
    }
  }, { timezone: "UTC" });

  // Run task reminders every hour
  cron.schedule("0 * * * *", async () => {
    const result = await runTaskReminders();
    if (result.sent > 0 || result.errors > 0) {
      console.log(`[Scheduler] Task reminders: ${result.sent} sent, ${result.errors} errors`);
    }
  }, { timezone: "UTC" });

  // Inbox auto-import disabled — IMAP connection instability was crashing the server
  // To re-enable, uncomment the block below and redeploy.
  // cron.schedule("*/15 * * * *", async () => {
  //   await runInboxImport(false);
  // }, { timezone: "UTC" });

  // Recruitment follow-up: every day at 09:00 UTC
  // Sends nurture emails to prospects who enquired but haven't completed their application.
  cron.schedule("0 9 * * *", async () => {
    try {
      await runRecruitmentFollowUp();
    } catch (err: any) {
      console.error("[Scheduler] Recruitment follow-up error:", err?.message);
    }
  }, { timezone: "UTC" });

  // Recruitment workflow emails: every 15 minutes
  // Processes pending enrollment steps (delayed follow-up emails) and sends via Resend.
  cron.schedule("*/15 * * * *", async () => {
    try {
      const { processWorkflowEmailsInternal } = await import("./recruitment-workflow-router");
      const result = await processWorkflowEmailsInternal();
      if (result.sent > 0 || result.errors > 0) {
        console.log(`[WorkflowScheduler] Processed ${result.processed} enrollments, sent ${result.sent} emails, ${result.errors} errors`);
      }
    } catch (err: any) {
      console.error("[WorkflowScheduler] Error:", err?.message);
    }
  }, { timezone: "UTC" });

  // CRM Drip email processor: every 15 minutes
  // Processes active CRM drip enrollments (email_drip_enrollments) that are due.
  cron.schedule("*/15 * * * *", async () => {
    try {
      const { processDripEmailsInternal } = await import("./crm-db");
      const result = await processDripEmailsInternal();
      if (result.sent > 0 || result.errors > 0) {
        console.log(`[DripScheduler] Processed ${result.processed} enrollments, sent ${result.sent} emails, ${result.errors} errors`);
      }
    } catch (err: any) {
      console.error("[DripScheduler] Error:", err?.message);
    }
  }, { timezone: "UTC" });

  // Campaign queue processor: every 5 minutes
  // Picks up 'queued' email_sends rows for campaigns and sends them in batches of 200.
  // Restart-safe: progress is persisted in the database (no fire-and-forget).
  cron.schedule("*/5 * * * *", async () => {
    try {
      const { processCampaignQueue } = await import("./resend-email");
      const result = await processCampaignQueue(200);
      if (result.sent > 0 || result.failed > 0) {
        console.log(`[CampaignQueue] Sent: ${result.sent}, Failed: ${result.failed}, Skipped: ${result.skipped}`);
      }
    } catch (err: any) {
      console.error("[CampaignQueue] Error:", err?.message);
    }
  }, { timezone: "UTC" });

  // Database backup to S3: DISABLED — Railway native backups are used instead.
  // cron.schedule("0 */4 * * *", async () => { ... }, { timezone: "UTC" });

  // Business update confirmation reminders: daily at 08:00 UTC
  // Sends email to agents who have unconfirmed Business Updates older than 14 days.
  cron.schedule("0 8 * * *", async () => {
    try {
      const { getAgentsNeedingConfirmationReminder, recordConfirmationReminder } = await import("./community-db");
      const { sendDirectEmail } = await import("./email");
      const pairs = await getAgentsNeedingConfirmationReminder();
      // Group by agent so each agent gets one email listing all unconfirmed posts
      const byAgent = new Map<number, { name: string; email: string; postIds: number[]; postCount: number }>();
      for (const { post, agent } of pairs) {
        const existing = byAgent.get(agent.id);
        if (existing) {
          existing.postIds.push(post.id);
          existing.postCount++;
        } else {
          byAgent.set(agent.id, { name: agent.name ?? "", email: agent.email ?? "", postIds: [post.id], postCount: 1 });
        }
      }
      let sent = 0;
      for (const [agentId, agentData] of Array.from(byAgent.entries())) {
        try {
          await sendDirectEmail({
            toEmail: agentData.email,
            toName: agentData.name,
            subject: "Action Required \u2014 Business Update Awaiting Your Confirmation",
            html: `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:'Poppins',Arial,sans-serif;"><div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);"><div style="background:#70FFE8;padding:24px 40px;text-align:center;"><span style="font-size:22px;font-weight:700;color:#414141;">JLT Group</span></div><div style="padding:32px 40px;color:#414141;font-size:15px;line-height:1.7;"><p>Hi ${agentData.name},</p><p>You have <strong>${agentData.postCount} Business Update${agentData.postCount !== 1 ? 's' : ''}</strong> in the JLT Portal that require your confirmation.</p><p>Please log in and confirm you have read and understood them.</p><p style="text-align:center;margin:28px 0;"><a href="${process.env.PORTAL_BASE_URL ?? 'https://portal.thejltgroup.co.uk'}/community" style="background:#70FFE8;color:#414141;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View Business Updates</a></p></div><div style="padding:20px 40px;text-align:center;background:#fafafa;font-size:12px;color:#888;">&copy; ${new Date().getFullYear()} JLT Group. All rights reserved.</div></div></body></html>`,
          });
          for (const postId of agentData.postIds) {
            await recordConfirmationReminder(postId, agentId);
          }
          sent++;
        } catch (e: any) {
          console.error(`[ConfirmReminder] Failed to send to ${agentData.email}:`, e?.message);
        }
      }
      if (sent > 0) console.log(`[ConfirmReminder] Sent ${sent} confirmation reminder email(s)`);
    } catch (err: any) {
      console.error("[ConfirmReminder] Fatal error:", err?.message);
    }
  }, { timezone: "UTC" });

  // Agent event day-of reminders: runs at 07:00 UTC daily
  // Sends an email to ALL active agents for any agent-facing events happening today.
  cron.schedule("0 7 * * *", async () => {
    try {
      const { getAgentEventsTodayForReminder, markAgentEventReminderSent } = await import("./db");
      const { sendDirectEmail } = await import("./email");
      const db = await import("./db").then((m) => m.getDb());
      if (!db) return;
      const { users: usersTable } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const events = await getAgentEventsTodayForReminder();
      if (events.length === 0) return;
      const agents = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(and(eq(usersTable.role, "agent"), eq(usersTable.isActive, true)));
      let sent = 0;
      for (const ev of events) {
        const timeStr = ev.allDay
          ? "All day"
          : new Date(ev.startDate).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
        const durationStr = ev.duration ? ` (${ev.duration} min)` : "";
        const urlLine = ev.eventUrl
          ? `<p style="margin:8px 0;"><strong>Join link:</strong> <a href="${ev.eventUrl}" style="color:#02E6D2;">${ev.eventUrl}</a></p>`
          : "";
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:'Poppins',Arial,sans-serif;"><div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);"><div style="background:#70FFE8;padding:24px 40px;text-align:center;"><span style="font-size:22px;font-weight:700;color:#414141;">JLT Group</span></div><div style="padding:32px 40px;color:#414141;font-size:15px;line-height:1.7;"><p>Hi there,</p><p>This is a reminder that <strong>${ev.title}</strong> is happening today.</p><p><strong>Time:</strong> ${timeStr}${durationStr}</p>${ev.description ? `<p>${ev.description}</p>` : ""}${urlLine}<p style="text-align:center;margin:28px 0;"><a href="${process.env.PORTAL_BASE_URL ?? 'https://portal.thejltgroup.co.uk'}/events" style="background:#70FFE8;color:#414141;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View Events Calendar</a></p></div><div style="padding:20px 40px;text-align:center;background:#fafafa;font-size:12px;color:#888;">&copy; ${new Date().getFullYear()} JLT Group. All rights reserved.</div></div></body></html>`;
        for (const agent of agents) {
          if (!agent.email) continue;
          try {
            await sendDirectEmail({ toEmail: agent.email, toName: agent.name ?? "Agent", subject: `Today: ${ev.title}`, html });
            sent++;
          } catch { /* continue */ }
        }
        await markAgentEventReminderSent(ev.id);
      }
      if (sent > 0) console.log(`[AgentEventReminder] Sent ${sent} reminder email(s) for ${events.length} event(s)`);
    } catch (err: any) {
      console.error("[AgentEventReminder] Error:", err?.message);
    }
  }, { timezone: "UTC" });

  // Weekly calendar summary: every Friday at 08:00 UTC
  // Sends a summary of next week's training, webinars, and supplier events to support@thejltgroup.co.uk
  cron.schedule("0 8 * * 5", async () => {
    try {
      await runWeeklyCalendarSummary();
    } catch (err: any) {
      console.error("[WeeklyCalendar] Error:", err?.message);
    }
  }, { timezone: "UTC" });

  console.log("[Scheduler] Cron jobs registered: nightly export (04:00 UTC), task reminders (hourly), recruitment follow-up (09:00 UTC), workflow emails (every 15 min), drip emails (every 15 min), campaign queue (every 15 min), confirmation reminders (08:00 UTC), agent event reminders (07:00 UTC), weekly calendar summary (Friday 08:00 UTC) — inbox auto-import DISABLED");
}

// ─── Recruitment follow-up nurture emails ─────────────────────────────────────
/**
 * Runs daily at 09:00 UTC.
 * Sends nurture emails to prospects who submitted an enquiry but have NOT yet
 * completed the full application form.
 *
 * Schedule:
 *  - Day 3 after enquiry: gentle reminder with prospectus link
 *  - Day 7 after enquiry: second nudge ("still interested?")
 *  - Day 14 after enquiry: final follow-up before archiving
 *
 * Idempotent: each email key is checked against recruitment_emails_sent so
 * duplicates are never sent even if the cron fires multiple times.
 */
async function runRecruitmentFollowUp(): Promise<void> {
  try {
    const { getAllRecruitmentProspects, hasRecruitmentEmailBeenSent, logRecruitmentEmail, updateRecruitmentProspect, extractApplicationToken, encodeApplicationToken } = await import("./recruitment-db");
    const { nanoid } = await import("nanoid");
    const { Resend } = await import("resend");
    const { ENV } = await import("./_core/env");
    const { PROSPECT_FROM, PROSPECT_REPLY_TO } = await import("./resend-email");

    if (!ENV.resendApiKey) {
      console.log("[RecruitmentFollowUp] RESEND_API_KEY not set — skipping");
      return;
    }

    const resend = new Resend(ENV.resendApiKey);
    const prospects = await getAllRecruitmentProspects({ stage: "new_enquiry", limit: 2000 });
    const now = Date.now();
    let sent = 0;

    for (const prospect of prospects) {
      // Skip if application already submitted
      if (prospect.applicationSubmittedAt) continue;

      const enquiryAge = now - new Date(prospect.createdAt).getTime();
      const daysSinceEnquiry = enquiryAge / (1000 * 60 * 60 * 24);

      // Determine which email to send based on age
      let emailKey: string | null = null;
      let subject = "";
      let bodyHtml = "";

      // Ensure this prospect has a personal application token
      let appToken = extractApplicationToken(prospect.adminNotes);
      if (!appToken) {
        appToken = nanoid(32);
        await updateRecruitmentProspect(prospect.id, {
          adminNotes: encodeApplicationToken(appToken, prospect.adminNotes),
        });
      }
      const applicationUrl = `https://portal.thejltgroup.co.uk/apply/form?token=${appToken}`;

      if (daysSinceEnquiry >= 14 && daysSinceEnquiry < 21) {
        emailKey = "followup_day14";
        subject = "One Last Thing — JLT Group";
        bodyHtml = `
<p>Hi ${prospect.firstName},</p>
<p>We wanted to reach out one final time to see if you're still interested in joining the JLT Group travel agency team.</p>
<p>We completely understand that life gets busy, and there's absolutely no pressure. But if you'd like to move forward, your application link is still active:</p>
<p style="text-align:center;margin:24px 0;">
  <a href="${applicationUrl}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;">
    Complete Your Application
  </a>
</p>
<p>If you have any questions or would like to chat before applying, simply reply to this email — we'd love to hear from you.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`;
      } else if (daysSinceEnquiry >= 7 && daysSinceEnquiry < 14) {
        emailKey = "followup_day7";
        subject = "Still Thinking It Over? — JLT Group";
        bodyHtml = `
<p>Hi ${prospect.firstName},</p>
<p>We hope you've had a chance to look through our prospectus. We just wanted to check in and see if you have any questions about joining the JLT Group team.</p>
<p>We'd love to hear from you — whether you're ready to apply or just want to find out more, we're here to help.</p>
<p style="text-align:center;margin:24px 0;">
  <a href="${applicationUrl}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;">
    Complete Your Application
  </a>
</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`;
      } else if (daysSinceEnquiry >= 3 && daysSinceEnquiry < 7) {
        emailKey = "followup_day3";
        subject = "Don't Forget — Your JLT Group Application";
        bodyHtml = `
<p>Hi ${prospect.firstName},</p>
<p>Thank you again for your interest in JLT Group! We noticed you haven't yet completed your application form, and we'd love to hear more about you.</p>
<p>It only takes a few minutes — click below to pick up where you left off:</p>
<p style="text-align:center;margin:24px 0;">
  <a href="${applicationUrl}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;">
    Complete Your Application
  </a>
</p>
<p>If you have any questions in the meantime, feel free to reply to this email.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`;
      }

      if (!emailKey) continue;

      // Idempotency check
      const alreadySent = await hasRecruitmentEmailBeenSent(prospect.id, emailKey);
      if (alreadySent) continue;

      // Send the email
      try {
        await resend.emails.send({
          from: PROSPECT_FROM,
          to: [prospect.email],
          replyTo: PROSPECT_REPLY_TO,
          subject,
          html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${subject}</title><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"/></head><body style="margin:0;padding:0;background-color:#f5f5f5;font-family:'Poppins',Arial,sans-serif;"><div style="width:100%;background-color:#f5f5f5;padding:20px 0;"><div style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);"><div style="background-color:#70FFE8;padding:24px 40px;text-align:center;"><span style="font-family:'Poppins',Arial,sans-serif;font-size:22px;font-weight:700;color:#414141;">JLT Group</span></div><div style="padding:32px 40px;color:#414141;font-family:'Poppins',Arial,sans-serif;font-size:15px;line-height:1.7;">${bodyHtml}</div><div style="padding:20px 40px;text-align:center;background-color:#fafafa;font-family:'Poppins',Arial,sans-serif;font-size:12px;color:#888;">&copy; ${new Date().getFullYear()} JLT Group. All rights reserved.</div></div></div></body></html>`,
        });

        await logRecruitmentEmail({
          prospectId: prospect.id,
          stage: "new_enquiry",
          emailKey,
          subject,
        });

        sent++;
        console.log(`[RecruitmentFollowUp] Sent ${emailKey} to prospect ${prospect.id} (${prospect.email})`);
      } catch (sendErr: any) {
        console.error(`[RecruitmentFollowUp] Failed to send ${emailKey} to ${prospect.email}:`, sendErr?.message);
      }
    }

    console.log(`[RecruitmentFollowUp] Done — ${sent} follow-up email(s) sent`);
  } catch (err: any) {
    console.error("[RecruitmentFollowUp] Fatal error:", err?.message);
  }
}

// ─── Weekly calendar summary email ───────────────────────────────────────────
/**
 * Runs every Friday at 08:00 UTC.
 * Fetches all training, webinar, and supplier_event calendar events for the
 * following Monday–Sunday and emails a formatted summary to support@thejltgroup.co.uk.
 * Staff holidays (type = "holiday") and staff tasks (type = "task") are excluded.
 */
export async function runWeeklyCalendarSummary(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.log("[WeeklyCalendar] DB unavailable — skipping");
    return;
  }

  // Calculate next Monday 00:00 UTC → next Sunday 23:59:59 UTC
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 5=Fri
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday, 0, 0, 0));
  const nextSunday = new Date(nextMonday.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

  const { calendarEvents } = await import("../drizzle/schema");
  const { and, gte, lte, inArray } = await import("drizzle-orm");

  const events = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        inArray(calendarEvents.type, ["event"]),
        inArray(calendarEvents.eventCategory, ["training", "webinar", "supplier_event"]),
        gte(calendarEvents.startDate, nextMonday),
        lte(calendarEvents.startDate, nextSunday)
      )
    )
    .orderBy(calendarEvents.startDate);

  const weekLabel = `${nextMonday.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })} – ${nextSunday.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;

  const categoryLabel = (cat: string | null) => {
    if (cat === "training") return "Training";
    if (cat === "webinar") return "Webinar";
    if (cat === "supplier_event") return "Supplier Event";
    return "Event";
  };

  const categoryColour = (cat: string | null) => {
    if (cat === "training") return "#4F46E5";
    if (cat === "webinar") return "#0891B2";
    if (cat === "supplier_event") return "#059669";
    return "#6B7280";
  };

  const formatEventTime = (ev: typeof events[0]) => {
    if (ev.allDay) return "All day";
    return new Date(ev.startDate).toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/London"
    }) + " (UK time)";
  };

  const formatEventDate = (ev: typeof events[0]) =>
    new Date(ev.startDate).toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC"
    });

  let eventRows = "";
  if (events.length === 0) {
    eventRows = `<tr><td colspan="4" style="padding:24px;text-align:center;color:#888;font-size:14px;">No training, webinars, or supplier events scheduled for this week.</td></tr>`;
  } else {
    for (const ev of events) {
      const cat = ev.eventCategory ?? null;
      const colour = categoryColour(cat);
      const label = categoryLabel(cat);
      const urlCell = ev.eventUrl
        ? `<a href="${ev.eventUrl}" style="color:#02E6D2;font-size:12px;">Join link</a>`
        : `<span style="color:#aaa;font-size:12px;">—</span>`;
      const durationCell = ev.duration ? `${ev.duration} min` : "—";
      eventRows += `
        <tr style="border-bottom:1px solid #f0f0f0;">
          <td style="padding:12px 16px;font-size:14px;color:#414141;">
            <strong>${ev.title}</strong>
            ${ev.description ? `<div style="font-size:12px;color:#666;margin-top:2px;">${ev.description.slice(0, 120)}${ev.description.length > 120 ? "…" : ""}</div>` : ""}
          </td>
          <td style="padding:12px 16px;font-size:13px;color:#555;white-space:nowrap;">${formatEventDate(ev)}<br/><span style="color:#888;">${formatEventTime(ev)}</span></td>
          <td style="padding:12px 16px;">
            <span style="background:${colour}18;color:${colour};border:1px solid ${colour}40;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${label}</span>
          </td>
          <td style="padding:12px 16px;text-align:center;">${urlCell}</td>
        </tr>`;
    }
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Poppins',Arial,sans-serif;">
  <div style="max-width:700px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#70FFE8;padding:24px 40px;text-align:center;">
      <span style="font-size:22px;font-weight:700;color:#414141;">JLT Group</span>
      <div style="font-size:13px;color:#414141;margin-top:4px;">Weekly Events Summary</div>
    </div>
    <div style="padding:32px 40px;color:#414141;">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 4px;">Next Week's Events</h2>
      <p style="font-size:14px;color:#666;margin:0 0 24px;">${weekLabel}</p>
      <p style="font-size:14px;color:#555;margin:0 0 20px;">
        This is your weekly summary of upcoming <strong>training sessions</strong>, <strong>webinars</strong>, and <strong>supplier events</strong> scheduled for next week.
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f8f8f8;">
            <th style="padding:10px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Event</th>
            <th style="padding:10px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Date &amp; Time</th>
            <th style="padding:10px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Type</th>
            <th style="padding:10px 16px;text-align:center;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Link</th>
          </tr>
        </thead>
        <tbody>${eventRows}</tbody>
      </table>
      <p style="font-size:13px;color:#888;margin:24px 0 0;">
        Total: <strong>${events.length} event${events.length !== 1 ? "s" : ""}</strong> scheduled for next week.
        Staff holidays and internal tasks are not included in this summary.
      </p>
      <p style="text-align:center;margin:28px 0 0;">
        <a href="${process.env.PORTAL_BASE_URL ?? "https://portal.thejltgroup.co.uk"}/admin/calendar"
           style="background:#70FFE8;color:#414141;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          View Full Calendar
        </a>
      </p>
    </div>
    <div style="padding:20px 40px;text-align:center;background:#fafafa;font-size:12px;color:#888;">
      &copy; ${new Date().getFullYear()} JLT Group. All rights reserved.
    </div>
  </div>
</body></html>`;

  const port = Number(process.env.SMTP_PORT ?? 465);
  const secure = port === 465 || process.env.SMTP_SECURE === "true";
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "mail.thejltgroup.co.uk",
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: `"JLT Group Portal" <${process.env.SMTP_USER ?? "portal@thejltgroup.co.uk"}>`,
    to: "support@thejltgroup.co.uk",
    subject: `Weekly Events Summary — ${weekLabel}`,
    html,
  });

  console.log(`[WeeklyCalendar] Summary sent for ${weekLabel} — ${events.length} event(s)`);
}
