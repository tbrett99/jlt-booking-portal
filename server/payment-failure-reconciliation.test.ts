import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { reduceMembershipPaymentEvents } from "./membership-payment-policy";

const event = (id: string, paymentId: string, action: string, day: number) => ({ eventId: id, paymentId, action, occurredAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00Z`, amount: 7900, currency: "GBP" });
describe("event-based membership reconciliation", () => {
  it("counts same-payment retries as distinct attempts, not distinct debt", () => {
    const result = reduceMembershipPaymentEvents([event("EV1", "PM1", "failed", 1), event("EV2", "PM1", "failed", 2), event("EV3", "PM1", "failed", 3)]);
    expect(result.failureCount).toBe(3); expect(result.shouldSuspend).toBe(true);
    expect(result.outstandingPaymentCount).toBe(1); expect(result.knownOutstandingAmounts.GBP).toBe(7900);
  });
  it("does not let a different month's successful payment forgive earlier arrears", () => {
    const result = reduceMembershipPaymentEvents([event("EV1", "PM1", "failed", 1), event("EV2", "PM2", "confirmed", 2)]);
    expect(result.failureCount).toBe(1); expect(result.outstandingPaymentIds).toEqual(["PM1"]);
  });
  it("does not run a second payment-ID-counting timer or effects checkpoint", () => {
    const scheduler = fs.readFileSync(path.resolve(import.meta.dirname, "scheduler.ts"), "utf8");
    const core = fs.readFileSync(path.resolve(import.meta.dirname, "_core/index.ts"), "utf8");
    expect(scheduler).not.toContain('cron.schedule("17 * * * *"');
    expect(scheduler).not.toContain("reconcilePaymentFailureSuspensions");
    expect(core).toContain("receiveMembershipProviderEvent(canonicalEvent");
    expect(core).toContain("registerMembershipPaymentRoutes(app)");
    expect(core).not.toContain("Ignoring replayed GoCardless event");
    expect(core).not.toContain("newConsecutive = (existing.consecutiveFailures");
  });
});
