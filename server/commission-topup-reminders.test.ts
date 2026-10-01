import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildTopUpReminderEmail,
  buildTopUpReminderRecipients,
} from "./commission-topup-reminders";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const routerSource = readFileSync(path.join(serverDir, "routers.ts"), "utf8");
const schedulerSource = readFileSync(path.join(serverDir, "scheduler.ts"), "utf8");

describe("commission top-up reminders", () => {
  it("groups every outstanding file into one email per agent", () => {
    const recipients = buildTopUpReminderRecipients({
      claims: [
        { id: 1, agentId: 10, bookingId: 101, topUpAmountPence: 1250 },
        { id: 2, agentId: 10, bookingId: 102, topUpAmountPence: 2750 },
        { id: 3, agentId: 20, bookingId: 103, topUpAmountPence: 500 },
      ],
      bookings: [
        { id: 101, clientName: "Alex Smith", ptsRef: "PTS-101" },
        { id: 102, clientName: "Sam Jones", topdogRef: "TD-102" },
        { id: 103, clientName: "Morgan Lee", ptsRef: "PTS-103" },
      ],
      users: [
        { id: 10, name: "Agent One", email: "agent.one@example.com" },
        { id: 20, name: "Agent Two", email: "agent.two@example.com" },
      ],
    });

    expect(recipients).toHaveLength(2);
    expect(recipients.find((recipient) => recipient.agentId === 10)?.claims).toHaveLength(2);

    const groupedEmail = buildTopUpReminderEmail(recipients[0], "weekly");
    expect(groupedEmail.subject).toContain("Weekly reminder");
    expect(groupedEmail.html).toContain("Alex Smith");
    expect(groupedEmail.html).toContain("Sam Jones");
    expect(groupedEmail.html).toContain("£40.00");
  });

  it("keeps files with no agent email out of the send queue", () => {
    const recipients = buildTopUpReminderRecipients({
      claims: [{ id: 1, agentId: 10, bookingId: 101, topUpAmountPence: 1250 }],
      bookings: [{ id: 101, clientName: "Alex Smith" }],
      users: [{ id: 10, name: "Agent One", email: null }],
    });

    expect(recipients).toEqual([]);
  });

  it("moves Commission Due files directly to Top-Up Required without changing their supplier payment date", () => {
    const commissionDueSource = routerSource.slice(
      routerSource.indexOf("commissionDue: router({"),
      routerSource.indexOf("sendShortFundsMessage: adminProcedure"),
    );
    expect(commissionDueSource).toContain("status: 'top_up_required'");
    expect(commissionDueSource).toContain("does not change finalSupplierPaymentDate");
    expect(commissionDueSource).not.toContain("updateBookingAdminFields(");
    expect(commissionDueSource).toContain("topUpNotifiedAt: null");
    expect(commissionDueSource).toContain('triggerKey: "commission_top_up_initial"');
  });

  it("keeps the Commission Management top-up action on the same no-date workflow", () => {
    const requestTopUpSource = routerSource.slice(
      routerSource.indexOf("// Admin: request a top-up from the agent (file in minus)"),
      routerSource.indexOf("agentNotifyTopUpComplete: protectedProcedure"),
    );
    expect(requestTopUpSource).toContain("sendTopUpReminders: adminProcedure");
    expect(requestTopUpSource).toContain("does not change finalSupplierPaymentDate");
    expect(requestTopUpSource).toContain("topUpNotifiedAt: null");
  });

  it("schedules a grouped reminder every Monday at 09:00 UK time", () => {
    expect(schedulerSource).toContain('cron.schedule("0 9 * * 1"');
    expect(schedulerSource).toContain('sendOutstandingTopUpReminders("weekly")');
    expect(schedulerSource).toContain('timezone: "Europe/London"');
  });
});
