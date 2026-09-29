import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { calculatePaymentFailureStreak } from "./payment-failure-reconciliation";

describe("payment failure reconciliation", () => {
  it("counts three terminal failures with no later successful collection", () => {
    const result = calculatePaymentFailureStreak([
      { id: "PM-JUL", status: "failed", charge_date: "2026-07-24" },
      { id: "PM-AUG", status: "failed", charge_date: "2026-08-24" },
      { id: "PM-SEP", status: "failed", charge_date: "2026-09-24" },
    ]);

    expect(result.consecutiveFailures).toBe(3);
    expect(result.lastFailedPaymentId).toBe("PM-SEP");
    expect(result.lastFailedAt?.toISOString()).toContain("2026-09-24");
  });

  it("resets the consecutive count after a confirmed or paid-out payment", () => {
    const result = calculatePaymentFailureStreak([
      { id: "PM-APR", status: "failed", charge_date: "2026-04-28" },
      { id: "PM-MAY", status: "failed", charge_date: "2026-05-28" },
      { id: "PM-JUN", status: "paid_out", charge_date: "2026-06-28" },
      { id: "PM-JUL", status: "failed", charge_date: "2026-07-28" },
    ]);

    expect(result.consecutiveFailures).toBe(1);
    expect(result.lastFailedPaymentId).toBe("PM-JUL");
  });

  it("ignores non-terminal payments when calculating the current failure streak", () => {
    const result = calculatePaymentFailureStreak([
      { id: "PM-FAIL", status: "failed", charge_date: "2026-08-24" },
      { id: "PM-PENDING", status: "pending_submission", charge_date: "2026-10-02" },
    ]);

    expect(result.consecutiveFailures).toBe(1);
    expect(result.lastFailedPaymentId).toBe("PM-FAIL");
  });

  it("keeps the scheduler safety net and durable webhook acknowledgement", () => {
    const scheduler = fs.readFileSync(path.resolve(import.meta.dirname, "scheduler.ts"), "utf8");
    const coreServer = fs.readFileSync(path.resolve(import.meta.dirname, "_core/index.ts"), "utf8");

    expect(scheduler).toContain('cron.schedule("17 * * * *"');
    expect(scheduler).toContain("reconcilePaymentFailureSuspensions");
    expect(coreServer).toContain("Do not acknowledge a webhook until its database work has completed");
    expect(coreServer).not.toContain("Process events asynchronously (fire-and-forget)");
  });
});
