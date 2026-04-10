/**
 * Scheduled jobs for the JLT Group Booking Portal.
 * Currently runs:
 *   - Nightly full booking CSV export at 04:00 UTC → max@thejltgroup.co.uk
 */
import cron from "node-cron";
import nodemailer from "nodemailer";
import { getDb } from "./db";
import { bookings, users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";

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

// ─── Register cron jobs ───────────────────────────────────────────────────────

export function startScheduler() {
  // Run at 04:00 UTC every day
  cron.schedule("0 4 * * *", async () => {
    console.log("[Scheduler] Starting nightly booking export…");
    const result = await runNightlyExport();
    if (result.success) {
      console.log(`[Scheduler] Export complete — ${result.rowCount} bookings sent to ${EXPORT_RECIPIENT}`);
    } else {
      console.error(`[Scheduler] Export failed — ${result.error}`);
    }
  }, {
    timezone: "UTC",
  });

  console.log("[Scheduler] Nightly export scheduled at 04:00 UTC → " + EXPORT_RECIPIENT);
}
