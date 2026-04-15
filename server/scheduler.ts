/**
 * Scheduled jobs for the JLT Group Booking Portal.
 * Currently runs:
 *   - Nightly full booking CSV export at 04:00 UTC → max@thejltgroup.co.uk
 */
import cron from "node-cron";
import nodemailer from "nodemailer";
import { getDb, getTasksDueForReminder, markCalendarReminderSent, getImapConfig } from "./db";
import { bookings, users, inAppNotifications } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";
import { importInbox, decryptPassword } from "./imap";

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

async function runInboxImport() {
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
  console.log(`[InboxScheduler] Auto-import started at ${new Date().toISOString()}`);
  try {
    const password = decryptPassword(config.passwordEncrypted);
    const result = await importInbox({
      host: config.host,
      port: config.port,
      email: config.email,
      password,
      useSsl: config.useSsl ?? true,
    });
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

const EXPORT_RECIPIENT = "max@thejltgroup.co.uk";
const EXPORT_RECIPIENT_NAME = "Max";

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function escapeCsv(value: string | null | undefined): string {
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
    return format(new Date(d), "dd/MM/yyyy");
  } catch {
    return "";
  }
}

// ─── Export logic ─────────────────────────────────────────────────────────────

export async function runNightlyExport(): Promise<{ success: boolean; rowCount?: number; error?: string }> {
  try {
    const db = await getDb();
    if (!db) return { success: false, error: "Database unavailable" };

    // Fetch all bookings joined with agent name
    const rows = await db
      .select({
        id: bookings.id,
        clientName: bookings.clientName,
        agentId: bookings.agentId,
        agentName: users.name,
        agentEmail: users.email,
        currentStage: bookings.currentStage,
        departureDate: bookings.departureDate,
        topdogRef: bookings.topdogRef,
        ptsRef: bookings.ptsRef,
        finalSupplierPaymentDate: bookings.finalSupplierPaymentDate,
        expectedCommission: bookings.expectedCommission,
        grossCost: bookings.grossCost,
        reimbursementsRequired: bookings.reimbursementsRequired,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt,
      })
      .from(bookings)
      .leftJoin(users, eq(bookings.agentId, users.id))
      .orderBy(bookings.id);

    // Build CSV
    const headers = [
      "Booking ID",
      "Client Name",
      "Agent Name",
      "Agent Email",
      "Stage",
      "Departure Date",
      "Topdog Ref",
      "PTS Ref",
      "Final Supplier Payment Date",
      "Expected Commission (£)",
      "Gross Cost (£)",
      "Reimbursements Required",
      "Created At",
      "Last Updated",
    ];

    const lines: string[] = [headers.join(",")];

    for (const row of rows) {
      lines.push(
        [
          escapeCsv(String(row.id)),
          escapeCsv(row.clientName),
          escapeCsv(row.agentName),
          escapeCsv(row.agentEmail),
          escapeCsv(row.currentStage),
          escapeCsv(formatDate(row.departureDate)),
          escapeCsv(row.topdogRef),
          escapeCsv(row.ptsRef),
          escapeCsv(formatDate(row.finalSupplierPaymentDate)),
          escapeCsv(row.expectedCommission != null ? String(Number(row.expectedCommission).toFixed(2)) : ""),
          escapeCsv(row.grossCost != null ? String(Number(row.grossCost).toFixed(2)) : ""),
          escapeCsv(row.reimbursementsRequired ? "Yes" : "No"),
          escapeCsv(formatDate(row.createdAt)),
          escapeCsv(formatDate(row.updatedAt)),
        ].join(",")
      );
    }

    const csvContent = lines.join("\n");
    const exportDate = format(new Date(), "yyyy-MM-dd");
    const filename = `jlt-bookings-export-${exportDate}.csv`;

    // Send email with attachment
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
      subject: `Nightly Booking Export — ${exportDate} (${rows.length} bookings)`,
      html: `
        <div style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #FFF6ED; padding: 32px; border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #414141; font-size: 24px; margin: 0;">JLT Group Booking Portal</h1>
            <div style="width: 60px; height: 4px; background: #70FFE8; margin: 12px auto 0;"></div>
          </div>
          <p style="color: #414141;">Hi ${EXPORT_RECIPIENT_NAME},</p>
          <p style="color: #414141;">Please find attached the nightly booking export for <strong>${exportDate}</strong>.</p>
          <div style="background: #fff; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #02E6D2;">
            <p style="margin: 0; color: #414141;"><strong>Total bookings exported:</strong> ${rows.length}</p>
            <p style="margin: 8px 0 0; color: #414141;"><strong>Export date:</strong> ${exportDate}</p>
            <p style="margin: 8px 0 0; color: #414141;"><strong>File:</strong> ${filename}</p>
          </div>
          <p style="color: #888; font-size: 13px;">This is an automated nightly export. All booking data is included regardless of stage.</p>
          <p style="color: #414141; margin-top: 32px;">The JLT Group Booking Portal</p>
        </div>
      `,
      attachments: [
        {
          filename,
          content: csvContent,
          contentType: "text/csv",
        },
      ],
    });

    console.log(`[Scheduler] Nightly export sent: ${rows.length} bookings → ${EXPORT_RECIPIENT}`);
    return { success: true, rowCount: rows.length };
  } catch (err: any) {
    console.error("[Scheduler] Nightly export failed:", err?.message);
    return { success: false, error: err?.message };
  }
}

// ─── Task reminder logic ──────────────────────────────────────────────────────

export async function runTaskReminders(): Promise<{ sent: number; errors: number }> {
  let sent = 0;
  let errors = 0;
  try {
    const db = await getDb();
    if (!db) return { sent: 0, errors: 1 };
    const tasks = await getTasksDueForReminder();
    for (const task of tasks) {
      if (!task.assigneeId) continue;
      try {
        const dueDateStr = task.dueDate
          ? format(new Date(task.dueDate), "d MMM yyyy")
          : "tomorrow";
        await db.insert(inAppNotifications).values({
          userId: task.assigneeId,
          message: `Reminder: Task "${task.title}" is due ${dueDateStr}.`,
          linkUrl: `/admin/calendar`,
          isRead: false,
        });
        await markCalendarReminderSent(task.id);
        sent++;
        console.log(`[Scheduler] Task reminder sent for task #${task.id} to user #${task.assigneeId}`);
      } catch (err: any) {
        console.error(`[Scheduler] Failed to send reminder for task #${task.id}:`, err?.message);
        errors++;
      }
    }
  } catch (err: any) {
    console.error("[Scheduler] Task reminders job failed:", err?.message);
    errors++;
  }
  return { sent, errors };
}

// ─── Register cron jobs ───────────────────────────────────────────────────────

export function startScheduler() {
  // Run at 04:00 UTC every day — nightly booking export
  cron.schedule("0 4 * * *", async () => {
    console.log("[Scheduler] Starting nightly booking export…");
    const result = await runNightlyExport();
    if (result.success) {
      console.log(`[Scheduler] Export complete — ${result.rowCount} bookings sent to ${EXPORT_RECIPIENT}`);
    } else {
      console.error(`[Scheduler] Export failed — ${result.error}`);
    }
  }, { timezone: "UTC" });

  // Run at 08:00 UTC every day — task due-date reminders
  cron.schedule("0 8 * * *", async () => {
    console.log("[Scheduler] Running task due-date reminders…");
    const result = await runTaskReminders();
    console.log(`[Scheduler] Task reminders: ${result.sent} sent, ${result.errors} errors`);
  }, { timezone: "UTC" });

  console.log("[Scheduler] Nightly export scheduled at 04:00 UTC → " + EXPORT_RECIPIENT);
  console.log("[Scheduler] Task reminders scheduled at 08:00 UTC");

  // Inbox auto-import every 15 minutes
  inboxNextRunAt = new Date(Date.now() + 15 * 60 * 1000);
  // Run once on startup after a short delay to let DB connect
  setTimeout(() => {
    runInboxImport().catch(console.error);
  }, 30_000); // 30 second startup delay
  cron.schedule("*/15 * * * *", () => {
    runInboxImport().catch(console.error);
  }, { timezone: "UTC" });
  console.log("[Scheduler] Inbox auto-import scheduled every 15 minutes");
}
