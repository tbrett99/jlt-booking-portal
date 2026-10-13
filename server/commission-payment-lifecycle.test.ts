import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapClaimStatus } from "./orbit-sync";
import { isBookingReadyForCommissionReview } from "./commission-workflow-utils";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
const readProjectFile = (relativePath: string) =>
  readFileSync(path.join(projectDir, relativePath), "utf8");

const dbSource = readProjectFile("server/db.ts");
const routerSource = readProjectFile("server/routers.ts");
const workflowSource = readProjectFile("server/commission-workflow-utils.ts");
const dashboardSource = readProjectFile("server/dashboard-router.ts");
const adminCommissionsSource = readProjectFile("client/src/pages/admin/AdminCommissions.tsx");
const agentBookingSource = readProjectFile("client/src/pages/agent/AgentBookingDetail.tsx");
const remittanceRouterSource = readProjectFile("server/remittance-router.ts");
const schemaSource = readProjectFile("drizzle/schema.ts");

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
    expect(paymentHelper).toContain("agentPaymentReceivedAt");
    expect(paymentHelper).toContain("Agent confirmed that their commission payment has been received");
  });

  it("queues a due final supplier payment date for review without making it claimable", () => {
    const now = new Date("2026-10-12T12:00:00.000Z");
    const baseBooking = {
      isPersonalBooking: false,
      currentStage: "Added to PTS",
      finalSupplierPaymentDate: new Date("2026-10-12T00:00:00.000Z"),
      commissionPreAuthorised: false,
      departureDate: new Date("2026-10-20T00:00:00.000Z"),
    };
    expect(isBookingReadyForCommissionReview(baseBooking, now)).toBe(true);
    expect(isBookingReadyForCommissionReview({
      ...baseBooking,
      finalSupplierPaymentDate: new Date("2026-10-13T00:00:00.000Z"),
    }, now)).toBe(false);
    expect(isBookingReadyForCommissionReview({
      ...baseBooking,
      commissionPreAuthorised: true,
    }, now)).toBe(false);
    expect(isBookingReadyForCommissionReview({
      ...baseBooking,
      currentStage: "Commission Claimable",
    }, now)).toBe(false);
    expect(isBookingReadyForCommissionReview({
      ...baseBooking,
      currentStage: "Commission Ready for Review",
    }, now)).toBe(true);
    expect(routerSource).toContain("queueBookingForCommissionReview(bookingId, ctx.user.id)");
    expect(routerSource).toContain("it never makes the booking claimable without a human review");
  });

  it("keeps historic agent-ready files separate from new staff review work", () => {
    expect(dbSource).toContain("export async function getAgentReadyUnclaimedBookings()");
    expect(dbSource).toContain('eq(bookings.currentStage, "Commission Claimable")');
    expect(workflowSource).toContain("COMMISSION_REVIEW_ELIGIBLE_STAGES");
    expect(routerSource).toContain("agentReadyUnclaimed: adminProcedure.query");
    expect(adminCommissionsSource).toContain("Agent-ready, not yet claimed");
    expect(adminCommissionsSource).toContain("not as new Commission Due reviews");
  });

  it("counts only unclaimed review-stage files in the dashboard Commission Due figure", () => {
    expect(dashboardSource).toContain("currentStage IN ('Added to PTS','Commission Ready for Review')");
    expect(dashboardSource).toContain("FROM commission_claims");
    expect(dashboardSource).toContain("WHERE commission_claims.bookingId = bookings.id");
    expect(dashboardSource).not.toContain("currentStage NOT IN ('Commission Claimable','Commission Claimed','Commission Due for Payment','Commission Paid','Cancelled')");
  });

  it("uses the claim’s recorded VAT rather than a later booking-level value", () => {
    expect(routerSource).toContain("vatAmount: (c as any).vatAmount ?? null");
    expect(routerSource).not.toContain("vatAmount: (c as any).vatAmount ?? (booking as any)?.commissionVat ?? null");
    expect(dbSource).toContain("vatAmount: booking?.commissionVat ?? null");
  });

  it("requires an explicit review confirmation when there are open booking actions", () => {
    expect(routerSource).toContain("requireOutstandingActionsConfirmation");
    expect(routerSource).toContain("confirmOutstandingActions");
    expect(adminCommissionsSource).toContain("I have reviewed the file and confirm commission should proceed");
  });

  it("keeps remittance payment runs awaiting receipt until the agent confirms funds arrived", () => {
    expect(remittanceRouterSource).toContain('status: "awaiting_payment"');
    expect(remittanceRouterSource).toContain('updateBookingStage(line.bookingId, "Commission Due for Payment", ctx.user.id)');
    expect(remittanceRouterSource).not.toMatch(/status:\s*["']paid["']/);
    expect(remittanceRouterSource).not.toMatch(/updateBookingStage\([^\n]+"Commission Paid"/);
  });

  it("enforces one commission claim per booking in the schema", () => {
    expect(schemaSource).toContain('bookingId: int("bookingId").notNull().unique()');
    expect(schemaSource).toContain("agentPaymentReceivedAt");
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
