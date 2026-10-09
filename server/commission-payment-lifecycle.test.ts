import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapClaimStatus } from "./orbit-sync";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
const readProjectFile = (relativePath: string) =>
  readFileSync(path.join(projectDir, relativePath), "utf8");

const dbSource = readProjectFile("server/db.ts");
const routerSource = readProjectFile("server/routers.ts");
const adminCommissionsSource = readProjectFile("client/src/pages/admin/AdminCommissions.tsx");
const agentBookingSource = readProjectFile("client/src/pages/agent/AgentBookingDetail.tsx");

describe("commission payment lifecycle", () => {
  it("keeps a processed claim in the due-for-payment stage until payment is confirmed", () => {
    const processingHelper = dbSource.slice(
      dbSource.indexOf("export async function markCommissionPaid"),
      dbSource.indexOf("export async function markCommissionAgentPaid"),
    );

    expect(processingHelper).toContain('status: "awaiting_payment"');
    expect(processingHelper).toContain('updateBookingStage(bookingId, "Commission Due for Payment", paidById)');
  });

  it("moves the booking to Commission Paid only when the payment completion path runs", () => {
    const paymentHelper = dbSource.slice(
      dbSource.indexOf("export async function markCommissionAgentPaid"),
      dbSource.indexOf("export async function getCommissionClaimByBooking"),
    );

    expect(paymentHelper).toContain('status: "paid"');
    expect(paymentHelper).toContain('updateBookingStage(bookingId, "Commission Paid", movedById)');
  });

  it("keeps pre-authorised claims in the same payment-run workflow", () => {
    const preAuthWorkflow = routerSource.slice(
      routerSource.indexOf("// Pre-auth auto-claim:"),
      routerSource.indexOf("const updated = await updateBookingStage(input.bookingId, input.toStage, ctx.user.id)"),
    );

    expect(preAuthWorkflow).toContain('"awaiting_payment"');
    expect(preAuthWorkflow).toContain('updateBookingStage(input.bookingId, "Commission Due for Payment", ctx.user.id)');
    expect(preAuthWorkflow).toContain('triggerKey: "commission_due_for_payment"');
  });

  it("maps the due-for-payment stage to an awaiting-payment Orbit status", () => {
    expect(mapClaimStatus(undefined, "Commission Due for Payment")).toBe("awaiting_payment");
  });

  it("presents the payment-run queue and prevents agents re-enabling pre-authorisation afterwards", () => {
    expect(adminCommissionsSource).toContain("Commission Due for Payment");
    expect(agentBookingSource).toContain("'Commission Due for Payment'");
    expect(agentBookingSource).toContain("'Commission Paid'");
  });

  it("shows and enforces a membership-arrears hold before a commission can be processed", () => {
    expect(routerSource).toContain("membershipArrearsHold");
    expect(routerSource).toContain("gcPaymentFailures.consecutiveFailures");
    expect(routerSource).toContain("outstanding monthly membership arrears");
    expect(adminCommissionsSource).toContain("Membership arrears — Hold");
    expect(adminCommissionsSource).toContain("Resolve the agent's monthly membership arrears");
  });
});
