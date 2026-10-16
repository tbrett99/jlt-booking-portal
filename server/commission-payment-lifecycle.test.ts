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
const adminBookingSource = readProjectFile("client/src/pages/admin/AdminBookingDetail.tsx");
const remittanceRouterSource = readProjectFile("server/remittance-router.ts");
const schemaSource = readProjectFile("drizzle/schema.ts");
const schedulerSource = readProjectFile("server/scheduler.ts");

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
    expect(isBookingReadyForCommissionReview({
      ...baseBooking,
      isPersonalBooking: true,
    }, now)).toBe(true);
    expect(routerSource).toContain("queueBookingForCommissionReview(bookingId, ctx.user.id)");
    expect(routerSource).toContain("it never makes the booking claimable without a human review");
  });

  it("keeps historic agent-ready files separate from new staff review work", () => {
    expect(dbSource).toContain("export async function getAgentReadyUnclaimedBookings()");
    expect(dbSource).toContain('eq(bookings.currentStage, "Commission Claimable")');
    expect(dbSource).not.toContain("const eligibleRows = rows.filter((booking) => !booking.isPersonalBooking)");
    expect(workflowSource).toContain("COMMISSION_REVIEW_ELIGIBLE_STAGES");
    expect(routerSource).toContain("agentReadyUnclaimed: adminProcedure.query");
    expect(adminCommissionsSource).toContain("Agent-ready, not yet claimed");
    expect(adminCommissionsSource).toContain("not as new Commission Due reviews");
  });

  it("gives staff a controlled recovery path for a legacy financial stage without a claim", () => {
    const recoveryRoute = routerSource.slice(
      routerSource.indexOf("restoreCommissionReview: adminProcedure"),
      routerSource.indexOf("togglePreAuth: protectedProcedure"),
    );

    expect(recoveryRoute).toContain('booking.currentStage !== "Commission Due for Payment"');
    expect(recoveryRoute).toContain("getCommissionClaimByBooking(input.bookingId)");
    expect(recoveryRoute).toContain("COMMISSION_REVIEW_STAGE");
    expect(recoveryRoute).toContain("No commission claim, payment or agent notification was created");
    expect(adminBookingSource).toContain("Restore Commission Review");
    expect(adminBookingSource).toContain("Confirm & Auto-Claim");
  });

  it("lets staff record an already-paid historical commission only through an auditable backfill path", () => {
    const historicalRoute = routerSource.slice(
      routerSource.indexOf("recordHistoricalPaid: adminProcedure"),
      routerSource.indexOf("// Agent: get own commission claims with booking info"),
    );
    const historicalPersistence = dbSource.slice(
      dbSource.indexOf("export async function recordHistoricalCommissionPaid"),
      dbSource.indexOf("export async function getCommissionClaimByBooking"),
    );

    expect(historicalRoute).toContain("getCommissionClaimByBooking(input.bookingId)");
    expect(historicalRoute).toContain("canReconcileHistoricalCommissionClaim(existingClaim)");
    expect(historicalRoute).toContain("recordHistoricalCommissionPaid");
    expect(historicalRoute).toContain("pushClaimStatusToOrbit(booking.id)");
    expect(historicalRoute).not.toContain("sendNotificationEmail");
    expect(historicalPersistence).toContain('status: "paid"');
    expect(historicalPersistence).toContain("canReconcileHistoricalCommissionClaim(existingClaim)");
    expect(historicalPersistence).toContain("topUpAmountPence: null");
    expect(historicalPersistence).toContain('currentStage: "Commission Paid"');
    expect(historicalPersistence).toContain("pipelineHistory");
    expect(historicalPersistence).toContain("auditNote");
    expect(adminBookingSource).toContain("Record Historic Commission Paid");
    expect(adminBookingSource).toContain("already paid outside the Portal");
    expect(adminBookingSource).toContain("old pending or top-up marker");
  });

  it("opens agent-ready unclaimed bookings in a separate browser tab", () => {
    const agentReadySection = adminCommissionsSource.slice(
      adminCommissionsSource.indexOf('<TabsContent value="agent_ready">'),
      adminCommissionsSource.indexOf("{/* NOTICE PERIOD TAB */}"),
    );

    expect(agentReadySection).toContain('href={`/bookings/${booking.id}`}');
    expect(agentReadySection).toContain('target="_blank"');
    expect(agentReadySection).toContain('rel="noopener noreferrer"');
  });

  it("counts only unclaimed review-stage files in the dashboard Commission Due figure", () => {
    expect(dashboardSource).toContain("currentStage IN ('Added to PTS','Commission Ready for Review')");
    expect(dashboardSource).toContain("FROM commission_claims");
    expect(dashboardSource).toContain("WHERE commission_claims.bookingId = bookings.id");
    expect(dashboardSource).not.toContain("AND (isPersonalBooking IS NULL OR isPersonalBooking = 0)");
    expect(dashboardSource).not.toContain("currentStage NOT IN ('Commission Claimable','Commission Claimed','Commission Due for Payment','Commission Paid','Cancelled')");
  });

  it("uses the claim’s recorded VAT rather than a later booking-level value", () => {
    expect(routerSource).toContain("vatAmount: (c as any).vatAmount ?? null");
    expect(routerSource).not.toContain("vatAmount: (c as any).vatAmount ?? (booking as any)?.commissionVat ?? null");
    expect(dbSource).toContain("vatAmount: booking?.commissionVat ?? null");
  });

  it("loads Commission Management supporting data only for the displayed claims", () => {
    const managementQuery = routerSource.slice(
      routerSource.indexOf("// Admin: get all commission claims with booking and agent info"),
      routerSource.indexOf("// Admin: release a notice-period hold claim to processing"),
    );

    expect(managementQuery).not.toContain("const allBookingsRaw = await");
    expect(managementQuery).toContain("inArray(bookingsTable.id, bookingIds)");
    expect(managementQuery).toContain("inArray(usersTable.id, referencedUserIds)");
    expect(managementQuery).toContain("const decryptedProfiles = await Promise.all");
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

  it("allows every booking type to complete the same claim record, including a £0 personal booking", () => {
    const claimRoute = routerSource.slice(
      routerSource.indexOf("claim: protectedProcedure"),
      routerSource.indexOf("myCommissions: protectedProcedure"),
    );

    expect(claimRoute).toContain('grossAmount: z.number().min(0');
    expect(claimRoute).not.toContain('grossAmount: z.number().positive');
    expect(routerSource).not.toContain('!(b as any).isPersonalBooking');
  });

  it("regularly queues already-due payment-date files for review", () => {
    expect(schedulerSource).toContain('import { queueDueBookingsForCommissionReview } from "./commission-review-queue"');
    expect(schedulerSource).toContain("void queueDueBookingsForCommissionReview()");
    expect(schedulerSource).toContain('cron.schedule("*/15 * * * *"');
    expect(schedulerSource).toContain("await queueDueBookingsForCommissionReview()");
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
