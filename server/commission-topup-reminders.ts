import { eq } from "drizzle-orm";
import { commissionClaims } from "../drizzle/schema";
import { getAllBookings, getAllCommissionClaims, getAllUsers, getDb } from "./db";
import { sendDirectEmail } from "./email";

export type TopUpReminderClaim = {
  claimId: number;
  bookingId: number;
  clientName: string;
  reference: string | null;
  amountPence: number;
};

export type TopUpReminderRecipient = {
  agentId: number;
  name: string;
  email: string;
  claims: TopUpReminderClaim[];
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatGbpFromPence(amountPence: number): string {
  return `£${(amountPence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Consolidates an agent's in-minus files so one reminder covers every outstanding
 * top-up, rather than generating a separate email per claim.
 */
export function buildTopUpReminderRecipients(input: {
  claims: Array<{
    id: number;
    agentId: number;
    bookingId: number;
    topUpAmountPence: number | null;
  }>;
  bookings: Array<{
    id: number;
    clientName: string;
    ptsRef?: string | null;
    topdogRef?: string | null;
  }>;
  users: Array<{ id: number; name: string | null; email: string | null }>;
}): TopUpReminderRecipient[] {
  const bookingById = new Map(input.bookings.map((booking) => [booking.id, booking]));
  const userById = new Map(input.users.map((user) => [user.id, user]));
  const grouped = new Map<number, TopUpReminderRecipient>();

  for (const claim of input.claims) {
    const booking = bookingById.get(claim.bookingId);
    const agent = userById.get(claim.agentId);
    if (!booking || !agent?.email) continue;

    const existing = grouped.get(claim.agentId) ?? {
      agentId: claim.agentId,
      name: agent.name?.trim() || "there",
      email: agent.email,
      claims: [],
    };
    existing.claims.push({
      claimId: claim.id,
      bookingId: claim.bookingId,
      clientName: booking.clientName,
      reference: booking.ptsRef || booking.topdogRef || null,
      amountPence: Number(claim.topUpAmountPence ?? 0),
    });
    grouped.set(claim.agentId, existing);
  }

  return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function buildTopUpReminderEmail(recipient: TopUpReminderRecipient, mode: "manual" | "weekly") {
  const fileLabel = recipient.claims.length === 1 ? "file" : "files";
  const subjectPrefix = mode === "weekly" ? "Weekly reminder" : "Reminder";
  const rows = recipient.claims
    .map((claim) => {
      const reference = claim.reference ? ` <span style="color:#687076;">(${escapeHtml(claim.reference)})</span>` : "";
      return `<tr>
  <td style="padding:12px 14px;border-bottom:1px solid #e8e8e8;color:#1f2937;font-weight:600;">${escapeHtml(claim.clientName)}${reference}</td>
  <td style="padding:12px 14px;border-bottom:1px solid #e8e8e8;color:#b42318;font-weight:700;text-align:right;">${formatGbpFromPence(claim.amountPence)}</td>
</tr>`;
    })
    .join("\n");
  const total = recipient.claims.reduce((sum, claim) => sum + claim.amountPence, 0);

  return {
    subject: `${subjectPrefix} — ${recipient.claims.length} ${fileLabel} need${recipient.claims.length === 1 ? "s" : ""} a top-up`,
    html: `<p>Hi ${escapeHtml(recipient.name)},</p>
<p>This is a reminder that the following commission ${fileLabel} ${recipient.claims.length === 1 ? "is" : "are"} still in minus and need${recipient.claims.length === 1 ? "s" : ""} to be topped up:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f1d0d0;border-radius:8px;border-collapse:separate;overflow:hidden;margin:18px 0;">
  <thead><tr style="background:#fff5f5;"><th align="left" style="padding:10px 14px;color:#7f1d1d;font-size:13px;">Booking</th><th align="right" style="padding:10px 14px;color:#7f1d1d;font-size:13px;">Amount to top up</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr style="background:#fff5f5;"><td style="padding:12px 14px;color:#7f1d1d;font-weight:700;">Total</td><td align="right" style="padding:12px 14px;color:#b42318;font-weight:800;">${formatGbpFromPence(total)}</td></tr></tfoot>
</table>
<p>Please top up your account and confirm this in the Portal as soon as possible so JLT can review the files.</p>
<p style="margin-top:20px;padding:14px 18px;background:#f0fffe;border-top:3px solid #02E6D2;border-radius:6px;"><a href="https://portal.thejltgroup.co.uk/my-files-in-minus" style="display:inline-block;background:#02E6D2;color:#1a1a2e;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700;">View My Files in Minus &rarr;</a></p>`,
  };
}

/** Sends one grouped reminder per agent for every current Top-Up Required claim. */
export async function sendOutstandingTopUpReminders(mode: "manual" | "weekly") {
  const [allClaims, allBookings, allUsers] = await Promise.all([
    getAllCommissionClaims(),
    getAllBookings(),
    getAllUsers(),
  ]);
  const outstandingClaims = allClaims.filter((claim) => claim.status === "top_up_required");
  const recipients = buildTopUpReminderRecipients({
    claims: outstandingClaims,
    bookings: allBookings,
    users: allUsers,
  });

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const sentAt = new Date();
  let emailsSent = 0;
  let claimsIncluded = 0;
  const failures: string[] = [];

  for (const recipient of recipients) {
    const email = buildTopUpReminderEmail(recipient, mode);
    const result = await sendDirectEmail({
      toEmail: recipient.email,
      toName: recipient.name,
      subject: email.subject,
      html: email.html,
      userId: recipient.agentId,
      triggerKey: mode === "weekly" ? "commission_top_up_weekly_reminder" : "commission_top_up_manual_reminder",
    });

    if (!result.success) {
      failures.push(recipient.name);
      continue;
    }

    emailsSent += 1;
    claimsIncluded += recipient.claims.length;
    for (const claim of recipient.claims) {
      await db
        .update(commissionClaims)
        .set({ topUpNotifiedAt: sentAt })
        .where(eq(commissionClaims.id, claim.claimId));
    }
  }

  return {
    emailsSent,
    claimsIncluded,
    agentsWithOutstandingClaims: recipients.length,
    failures,
  };
}
