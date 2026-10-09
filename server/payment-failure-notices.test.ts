import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildPaymentFailureNotice } from "./payment-failure-notices";

describe("payment failure notices", () => {
  it("sends the correct warning for each current failure stage", () => {
    const first = buildPaymentFailureNotice({ failureCount: 1, agentName: "Amy Hoey", reason: "Insufficient funds" });
    const second = buildPaymentFailureNotice({ failureCount: 2, agentName: "Amy Hoey" });
    const third = buildPaymentFailureNotice({ failureCount: 3, agentName: "Amy Hoey" });

    expect(first.subject).toContain("Action Required");
    expect(first.html).toContain("1 of 3");
    expect(second.subject).toContain("Second Warning");
    expect(second.html).toContain("One more failure");
    expect(third.subject).toContain("Portal Access Suspended");
    expect(third.html).toContain("3 consecutive failed payments");
  });

  it("uses the current urgent notice rather than replaying historic stages", () => {
    const notice = buildPaymentFailureNotice({ failureCount: 8, agentName: "Amy Hoey" });
    expect(notice.failureCount).toBe(8);
    expect(notice.subject).toContain("Portal Access Suspended");
  });

  it("escapes provider reason text before including it in agent email HTML", () => {
    const notice = buildPaymentFailureNotice({
      failureCount: 1,
      agentName: '<script>name</script>',
      reason: '<img src=x onerror=alert(1)>',
    });
    expect(notice.html).toContain("&lt;script&gt;name&lt;/script&gt;");
    expect(notice.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(notice.html).not.toContain("<script>");
  });

  it("uses GoCardless event IDs for replay protection instead of collapsing payment attempts", () => {
    const core = fs.readFileSync(path.resolve(import.meta.dirname, "_core/index.ts"), "utf8");
    const persistence = fs.readFileSync(path.resolve(import.meta.dirname, "gocardless-db.ts"), "utf8");
    const reconciliation = fs.readFileSync(path.resolve(import.meta.dirname, "payment-failure-reconciliation.ts"), "utf8");

    expect(core).toContain("gocardlessEventId: event.id");
    expect(core).toContain("Ignoring replayed GoCardless event");
    expect(core).not.toContain("alreadyCountedThisPayment");
    expect(persistence).toContain("gcPaymentEvents.gocardlessEventId");
    expect(reconciliation).toContain("failureRunResetAt");
    expect(reconciliation).toContain("failureNoticesSent");
  });
});
