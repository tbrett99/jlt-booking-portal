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

  // Run inbox auto-import every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    await runInboxImport(false);
  }, { timezone: "UTC" });

  console.log("[Scheduler] Cron jobs registered: nightly export (04:00 UTC), task reminders (hourly), inbox import (every 15 min)");
}
