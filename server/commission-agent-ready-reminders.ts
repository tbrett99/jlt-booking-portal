import { getAgentReadyUnclaimedBookings, getAllUsers } from "./db";
import { sendDirectEmail } from "./email";

export type AgentReadyCommissionBooking = {
  bookingId: number;
  clientName: string;
  reference: string | null;
  expectedCommission: number | null;
};

export type AgentReadyCommissionReminderRecipient = {
  agentId: number;
  name: string;
  firstName: string;
  email: string;
  bookings: AgentReadyCommissionBooking[];
};

type AgentReadyBookingSource = {
  id: number;
  agentId: number;
  clientName: string;
  ptsRef?: string | null;
  topdogRef?: string | null;
  expectedCommission?: number | string | null;
};

export type CommissionReminderAgent = {
  id: number;
  name: string | null;
  email: string | null;
  role: string | null;
  isActive: boolean | null;
  portalStatus: string | null;
};

/**
 * Reminder emails are operational communications for agents who can still use
 * the Portal. Cancelled, paused, suspended, inactive and onboarding accounts
 * are deliberately excluded; an agent in notice remains eligible because they
 * can still have genuine commission to claim before their notice completes.
 */
export function isEligibleCommissionReminderAgent(agent: CommissionReminderAgent | null | undefined): boolean {
  return agent?.role === "agent"
    && agent.isActive === true
    && (agent.portalStatus === "active" || agent.portalStatus === "in_notice");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function firstName(value: string | null | undefined): string {
  const name = value?.trim();
  return name ? name.split(/\s+/)[0] : "there";
}

function formatGbp(value: number | string | null | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `£${amount.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Consolidates staff-approved, unclaimed bookings by agent. A recipient is
 * excluded only when the agent no longer has an email address; this keeps the
 * send path safe even when historic imports have incomplete agent data.
 */
export function buildAgentReadyCommissionReminderRecipients(input: {
  bookings: Array<{
    id: number;
    agentId: number;
    clientName: string;
    ptsRef?: string | null;
    topdogRef?: string | null;
    expectedCommission?: number | string | null;
  }>;
  users: CommissionReminderAgent[];
}): AgentReadyCommissionReminderRecipient[] {
  const userById = new Map(input.users.map((user) => [user.id, user]));
  const grouped = new Map<number, AgentReadyCommissionReminderRecipient>();

  for (const booking of input.bookings) {
    const agent = userById.get(booking.agentId);
    if (!agent || !isEligibleCommissionReminderAgent(agent)) continue;
    const email = agent.email?.trim();
    if (!email) continue;

    const name = agent.name?.trim() || "Agent";
    const recipient = grouped.get(booking.agentId) ?? {
      agentId: booking.agentId,
      name,
      firstName: firstName(name),
      email,
      bookings: [],
    };

    recipient.bookings.push({
      bookingId: booking.id,
      clientName: booking.clientName,
      reference: booking.ptsRef || booking.topdogRef || null,
      expectedCommission: Number.isFinite(Number(booking.expectedCommission))
        ? Number(booking.expectedCommission)
        : null,
    });
    grouped.set(booking.agentId, recipient);
  }

  return Array.from(grouped.values())
    .map((recipient) => ({
      ...recipient,
      bookings: recipient.bookings.sort((a, b) => a.clientName.localeCompare(b.clientName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildAgentReadyCommissionReminderEmail(recipient: AgentReadyCommissionReminderRecipient) {
  const bookingLabel = recipient.bookings.length === 1 ? "booking" : "bookings";
  const rows = recipient.bookings.map((booking) => `
    <tr>
      <td style="padding:12px 14px;border-bottom:1px solid #e8e8e8;color:#1f2937;font-weight:600;">${escapeHtml(booking.reference ?? `Booking #${booking.bookingId}`)}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #e8e8e8;color:#1f2937;">${escapeHtml(booking.clientName)}</td>
      <td align="right" style="padding:12px 14px;border-bottom:1px solid #e8e8e8;color:#1f2937;font-weight:700;">${formatGbp(booking.expectedCommission)}</td>
    </tr>`).join("\n");

  return {
    subject: "Reminder: commission ready to claim",
    html: `<p>Hi ${escapeHtml(recipient.firstName)},</p>
<p>This is a reminder that our records show we have previously confirmed the following ${bookingLabel} ${recipient.bookings.length === 1 ? "is" : "are"} <strong>ready for you to submit a commission claim</strong>, but we have not yet received a claim through the JLT Booking Portal:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dce7e5;border-radius:8px;border-collapse:separate;overflow:hidden;margin:18px 0;">
  <thead><tr style="background:#f0fffe;"><th align="left" style="padding:10px 14px;color:#24403c;font-size:13px;">Booking reference</th><th align="left" style="padding:10px 14px;color:#24403c;font-size:13px;">Client</th><th align="right" style="padding:10px 14px;color:#24403c;font-size:13px;">Expected commission</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p>Please log in to the JLT Booking Portal and submit your commission claim${recipient.bookings.length === 1 ? "" : "s"} when you are ready.</p>
<div style="margin:20px 0;padding:14px 18px;background:#fff8e8;border-left:4px solid #e7ad31;border-radius:6px;color:#614713;">
  <p style="margin:0 0 8px;"><strong>Please note:</strong> some historic booking files were imported into the Portal. In some cases, a file may show as ready to claim even though the commission has already been paid.</p>
  <p style="margin:0;">If you believe commission has already been paid for any booking above, please add a message to the relevant booking in the Portal confirming this. The JLT team will review it and update the file accordingly.</p>
</div>
<p>Before submitting a claim, please make sure the booking file is complete and that no further amendments, refunds or reimbursements are expected.</p>
<p style="margin-top:22px;"><a href="https://portal.thejltgroup.co.uk/commissions" style="display:inline-block;background:#02E6D2;color:#1a1a2e;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700;">Open My Commission Claims &rarr;</a></p>
<p>Thank you,<br/><strong>The JLT Team</strong></p>`,
  };
}

/**
 * Sends one reminder per agent and uses the current database state at the point
 * of delivery, so a booking claimed while staff are reviewing the page is not
 * included in a reminder email.
 */
export async function sendAgentReadyCommissionReminders() {
  const [bookingsRaw, usersRaw] = await Promise.all([
    getAgentReadyUnclaimedBookings(),
    getAllUsers(),
  ]);
  const bookings = bookingsRaw as AgentReadyBookingSource[];
  const users = usersRaw as CommissionReminderAgent[];
  const recipients = buildAgentReadyCommissionReminderRecipients({ bookings, users });
  const agentIdsWithBookings = new Set(bookings.map((booking) => booking.agentId));
  const userById = new Map(users.map((user) => [user.id, user]));
  const agentsEligible = Array.from(agentIdsWithBookings).filter((agentId) =>
    isEligibleCommissionReminderAgent(userById.get(agentId)),
  );
  const agentsWithoutEmail = agentsEligible.filter((agentId) => !userById.get(agentId)?.email?.trim()).length;
  const agentsExcluded = agentIdsWithBookings.size - agentsEligible.length;

  let emailsSent = 0;
  let bookingsIncluded = 0;
  const failures: string[] = [];

  for (const recipient of recipients) {
    const email = buildAgentReadyCommissionReminderEmail(recipient);
    const result = await sendDirectEmail({
      toEmail: recipient.email,
      toName: recipient.name,
      subject: email.subject,
      html: email.html,
      userId: recipient.agentId,
      triggerKey: "commission_agent_ready_unclaimed_reminder",
    });

    if (!result.success) {
      failures.push(recipient.name);
      continue;
    }

    emailsSent += 1;
    bookingsIncluded += recipient.bookings.length;
  }

  return {
    emailsSent,
    bookingsIncluded,
    agentsWithUnclaimedBookings: agentIdsWithBookings.size,
    agentsEligible: agentsEligible.length,
    agentsWithoutEmail,
    agentsExcluded,
    failures,
  };
}
