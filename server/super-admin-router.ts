/**
 * Super Admin Router — Business Intelligence Dashboard
 * All procedures restricted to super_admin role only.
 */
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Super admin access required" });
  }
  return next({ ctx });
});

export const superAdminRouter = router({
  /**
   * Main weekly stats — returns all 7 dashboard sections for a given week.
   * weekStart: ISO date string (Monday of the week, e.g. "2026-05-26")
   */
  weeklyStats: superAdminProcedure
    .input(z.object({ weekStart: z.string() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const {
        users,
        agentCrmProfiles,
        agentStatusEvents,
        bookings,
        pipelineHistory,
        amendments,
        refunds,
        reimbursementItems,
        commissionClaims,
        remittanceBatches,
        remittanceLines,
        gcSubscriptions,
        gcPaymentEvents,
        gcPaymentFailures,
        gcMandates,
        adminTasks,
        notes,
        emailCampaigns,
        emailSends,
        agentEmails,
        flightRequests,
        recruitmentProspects,
        recruitmentStageHistory,
      } = await import("../drizzle/schema");

      const { gte, lt, and, eq, sql, isNotNull, inArray, or, ne, notLike } = await import("drizzle-orm");

      const [wsYear, wsMon, wsDay] = input.weekStart.split("-").map(Number);
      const weekStartDate = new Date(wsYear, wsMon - 1, wsDay, 0, 0, 0, 0);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 7);

      // Previous week for WoW comparison
      const prevWeekStart = new Date(weekStartDate);
      prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevWeekEnd = new Date(weekStartDate);

      // ─── SECTION 1: Membership & Retention ────────────────────────────────

      // New sign-ups: count gc_mandates where joining fee was paid in the week.
      // This is the single source of truth — one record per agent, set exactly when GoCardless
      // confirms the one-off joining fee payment. Never includes monthly DD collections.
      const newSignupsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(gcMandates)
        .where(and(
          isNotNull(gcMandates.joiningFeePaidAt),
          gte(gcMandates.joiningFeePaidAt, weekStartDate),
          lt(gcMandates.joiningFeePaidAt, weekEndDate),
        ));

      const newSignupsPrevWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(gcMandates)
        .where(and(
          isNotNull(gcMandates.joiningFeePaidAt),
          gte(gcMandates.joiningFeePaidAt, prevWeekStart),
          lt(gcMandates.joiningFeePaidAt, prevWeekEnd),
        ));

      // Cancellations / churn this week
      const cancellationsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentStatusEvents)
        .where(and(
          inArray(agentStatusEvents.toStatus, ["cancelled", "in_notice"]),
          gte(agentStatusEvents.createdAt, weekStartDate),
          lt(agentStatusEvents.createdAt, weekEndDate),
        ));

      const cancellationsPrevWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentStatusEvents)
        .where(and(
          inArray(agentStatusEvents.toStatus, ["cancelled", "in_notice"]),
          gte(agentStatusEvents.createdAt, prevWeekStart),
          lt(agentStatusEvents.createdAt, prevWeekEnd),
        ));

      // Total active agents (current snapshot)
      const totalActiveAgents = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.agentStatus, "active"));

      // Total active + paused (paying members)
      const totalPayingAgents = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentCrmProfiles)
        .where(inArray(agentCrmProfiles.agentStatus, ["active", "paused"]));

      // Membership tier breakdown
      const tierBreakdown = await db
        .select({
          tier: agentCrmProfiles.membershipTier,
          count: sql<number>`COUNT(*)`,
        })
        .from(agentCrmProfiles)
        .where(inArray(agentCrmProfiles.agentStatus, ["active", "paused"]))
        .groupBy(agentCrmProfiles.membershipTier);

      // Agents in notice / paused
      const inNoticeCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.agentStatus, "in_notice"));

      const pausedCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.agentStatus, "paused"));

      // ─── SECTION 2: DD Revenue (GoCardless) ───────────────────────────────

      // Active GC subscriptions & MRR (active only for MRR)
      const activeSubscriptions = await db
        .select({
          count: sql<number>`COUNT(*)`,
          totalAmountPence: sql<number>`SUM(amount)`,
        })
        .from(gcSubscriptions)
        .where(eq(gcSubscriptions.status, "active"));

      // Active + paused subscriptions count
      const totalGcSubscriptions = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(gcSubscriptions)
        .where(inArray(gcSubscriptions.status, ["active", "paused"]));

      // Payments confirmed this week (one-off joining fees only — excludes subscription/monthly DD)
      const paymentsConfirmedThisWeek = await db
        .select({
          count: sql<number>`COUNT(*)`,
          totalPence: sql<number>`SUM(amount)`,
        })
        .from(gcPaymentEvents)
        .where(and(
          eq(gcPaymentEvents.eventType, "payments_confirmed"),
          gte(gcPaymentEvents.occurredAt, weekStartDate),
          lt(gcPaymentEvents.occurredAt, weekEndDate),
          isNotNull(gcPaymentEvents.amount),
          notLike(gcPaymentEvents.rawPayload, '%"subscription"%'),
        ));

      const paymentsConfirmedPrevWeek = await db
        .select({
          count: sql<number>`COUNT(*)`,
          totalPence: sql<number>`SUM(amount)`,
        })
        .from(gcPaymentEvents)
        .where(and(
          eq(gcPaymentEvents.eventType, "payments_confirmed"),
          gte(gcPaymentEvents.occurredAt, prevWeekStart),
          lt(gcPaymentEvents.occurredAt, prevWeekEnd),
          isNotNull(gcPaymentEvents.amount),
          notLike(gcPaymentEvents.rawPayload, '%"subscription"%'),
        ));

      // Payments paid out this week (funds actually landed in your bank account)
      // IMPORTANT: gc_payment_events stores multiple rows per GoCardless payment (one per webhook event).
      // We must deduplicate by paymentId to avoid counting the same payment multiple times.
      const paymentsPaidOutThisWeek = await db.execute(sql`
        SELECT
          COUNT(DISTINCT paymentId) AS count,
          SUM(DISTINCT CASE WHEN paymentId IS NOT NULL THEN amount ELSE 0 END) AS totalPence
        FROM gc_payment_events
        WHERE eventType = 'payments_paid_out'
          AND occurredAt >= ${weekStartDate}
          AND occurredAt < ${weekEndDate}
          AND amount IS NOT NULL
          AND paymentId IS NOT NULL
      `) as unknown as Array<{ count: number; totalPence: number }>;

      // Failed payments this week
      const failedPaymentsThisWeek = await db
        .select({
          count: sql<number>`COUNT(*)`,
          totalPence: sql<number>`SUM(amount)`,
        })
        .from(gcPaymentEvents)
        .where(and(
          eq(gcPaymentEvents.eventType, "payments_failed"),
          gte(gcPaymentEvents.occurredAt, weekStartDate),
          lt(gcPaymentEvents.occurredAt, weekEndDate),
        ));

      // Agents with consecutive failures
      const agentsWithFailures = await db
        .select({
          count: sql<number>`COUNT(*)`,
          totalFailures: sql<number>`SUM(consecutiveFailures)`,
        })
        .from(gcPaymentFailures)
        .where(gte(gcPaymentFailures.consecutiveFailures, 1));

      // New mandates this week
      const newMandatesThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(gcSubscriptions)
        .where(and(
          gte(gcSubscriptions.createdAt, weekStartDate),
          lt(gcSubscriptions.createdAt, weekEndDate),
        ));

      // Cancelled mandates this week
      const cancelledMandatesThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(gcPaymentEvents)
        .where(and(
          inArray(gcPaymentEvents.eventType, ["mandates_cancelled", "subscriptions_cancelled"]),
          gte(gcPaymentEvents.occurredAt, weekStartDate),
          lt(gcPaymentEvents.occurredAt, weekEndDate),
        ));

      // ─── SECTION 3: Bookings & Pipeline ───────────────────────────────────

      // New bookings this week — use bookedDate (the date the booking was made with the supplier)
      // NOT createdAt (when it was registered in the portal, which can be a bulk-import date)
      const newBookingsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bookings)
        .where(and(
          isNotNull(bookings.bookedDate),
          gte(bookings.bookedDate, weekStartDate),
          lt(bookings.bookedDate, weekEndDate),
        ));

      const newBookingsPrevWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bookings)
        .where(and(
          isNotNull(bookings.bookedDate),
          gte(bookings.bookedDate, prevWeekStart),
          lt(bookings.bookedDate, prevWeekEnd),
        ));

      // Pipeline stage distribution (current snapshot)
      const pipelineStageDistribution = await db
        .select({
          stage: bookings.currentStage,
          count: sql<number>`COUNT(*)`,
        })
        .from(bookings)
        .groupBy(bookings.currentStage)
        .orderBy(sql`COUNT(*) DESC`);

      // Pipeline moves this week
      const pipelineMovesThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(pipelineHistory)
        .where(and(
          gte(pipelineHistory.movedAt, weekStartDate),
          lt(pipelineHistory.movedAt, weekEndDate),
        ));

      // Amendments this week
      const amendmentsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(amendments)
        .where(and(
          gte(amendments.createdAt, weekStartDate),
          lt(amendments.createdAt, weekEndDate),
        ));

      // Amendments actioned this week
      const amendmentsActionedThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(amendments)
        .where(and(
          eq(amendments.status, "actioned"),
          isNotNull(amendments.actionedAt),
          gte(amendments.actionedAt, weekStartDate),
          lt(amendments.actionedAt, weekEndDate),
        ));

      // Refunds this week (created)
      const refundsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(refunds)
        .where(and(
          gte(refunds.createdAt, weekStartDate),
          lt(refunds.createdAt, weekEndDate),
        ));

      // Refunds by stage (current snapshot)
      const refundsByStage = await db
        .select({
          stage: refunds.pipelineStage,
          count: sql<number>`COUNT(*)`,
        })
        .from(refunds)
        .where(ne(refunds.status, "completed"))
        .groupBy(refunds.pipelineStage)
        .orderBy(sql`COUNT(*) DESC`);

      // Flight requests this week
      const flightRequestsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(flightRequests)
        .where(and(
          gte(flightRequests.createdAt, weekStartDate),
          lt(flightRequests.createdAt, weekEndDate),
        ));

      const flightRequestsPendingCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(flightRequests)
        .where(eq(flightRequests.status, "pending"));

      // Pipeline dwell time: avg days per stage (calculated from pipeline_history)
      // Uses LEAD() window function — TiDB does not support correlated subqueries in ON clauses.
      const pipelineDwellRaw = await db.execute(sql`
        SELECT 
          stage,
          AVG(hoursInStage) / 24.0 AS avgDays,
          COUNT(*) AS bookingCount
        FROM (
          SELECT 
            toStage AS stage,
            TIMESTAMPDIFF(HOUR, movedAt, LEAD(movedAt) OVER (PARTITION BY bookingId ORDER BY id)) AS hoursInStage
          FROM pipeline_history
        ) t
        WHERE hoursInStage IS NOT NULL
        GROUP BY stage
        ORDER BY avgDays DESC
        LIMIT 20
      `);

      // ─── SECTION 4: Financials ─────────────────────────────────────────────

      // JLT revenue from remittance lines this week (jlt20 sum)
      const jltRevenueThisWeek = await db
        .select({ total: sql<number>`SUM(jlt20)` })
        .from(remittanceLines)
        .innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id))
        .where(and(
          gte(remittanceBatches.createdAt, weekStartDate),
          lt(remittanceBatches.createdAt, weekEndDate),
          isNotNull(remittanceLines.jlt20),
        ));

      const jltRevenuePrevWeek = await db
        .select({ total: sql<number>`SUM(jlt20)` })
        .from(remittanceLines)
        .innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id))
        .where(and(
          gte(remittanceBatches.createdAt, prevWeekStart),
          lt(remittanceBatches.createdAt, prevWeekEnd),
          isNotNull(remittanceLines.jlt20),
        ));

      // Agent payouts (remit80) this week
      const agentPayoutsThisWeek = await db
        .select({ total: sql<number>`SUM(remit80)` })
        .from(remittanceLines)
        .innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id))
        .where(and(
          gte(remittanceBatches.createdAt, weekStartDate),
          lt(remittanceBatches.createdAt, weekEndDate),
          isNotNull(remittanceLines.remit80),
        ));

      // Commission claims this week
      const commissionClaimsThisWeek = await db
        .select({
          count: sql<number>`COUNT(*)`,
          totalGross: sql<number>`SUM(grossAmount)`,
        })
        .from(commissionClaims)
        .where(and(
          gte(commissionClaims.createdAt, weekStartDate),
          lt(commissionClaims.createdAt, weekEndDate),
        ));

      // Commission claims paid this week
      const commissionClaimsPaidThisWeek = await db
        .select({
          count: sql<number>`COUNT(*)`,
          totalGross: sql<number>`SUM(grossAmount)`,
        })
        .from(commissionClaims)
        .where(and(
          eq(commissionClaims.status, "paid"),
          isNotNull(commissionClaims.paidAt),
          gte(commissionClaims.paidAt, weekStartDate),
          lt(commissionClaims.paidAt, weekEndDate),
        ));

      // Reimbursements paid this week
      const reimbursementsPaidThisWeek = await db
        .select({
          count: sql<number>`COUNT(*)`,
          total: sql<number>`SUM(amount)`,
        })
        .from(reimbursementItems)
        .where(and(
          eq(reimbursementItems.status, "paid"),
          isNotNull(reimbursementItems.paidAt),
          gte(reimbursementItems.paidAt, weekStartDate),
          lt(reimbursementItems.paidAt, weekEndDate),
        ));

      // Reimbursements scheduled (approved, awaiting payment)
      const reimbursementsScheduled = await db
        .select({
          count: sql<number>`COUNT(*)`,
          total: sql<number>`SUM(amount)`,
        })
        .from(reimbursementItems)
        .where(eq(reimbursementItems.status, "scheduled"));

      // Reimbursements pending (not yet approved)
      const reimbursementsPending = await db
        .select({
          count: sql<number>`COUNT(*)`,
          total: sql<number>`SUM(amount)`,
        })
        .from(reimbursementItems)
        .where(eq(reimbursementItems.status, "pending"));

      // ─── SECTION 5: Recruitment Pipeline ──────────────────────────────────

      // New prospects this week
      const newProspectsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(recruitmentProspects)
        .where(and(
          gte(recruitmentProspects.createdAt, weekStartDate),
          lt(recruitmentProspects.createdAt, weekEndDate),
        ));

      const newProspectsPrevWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(recruitmentProspects)
        .where(and(
          gte(recruitmentProspects.createdAt, prevWeekStart),
          lt(recruitmentProspects.createdAt, prevWeekEnd),
        ));

      // Won prospects this week (stage moved to "won" this week)
      const wonProspectsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(recruitmentStageHistory)
        .where(and(
          eq(recruitmentStageHistory.toStage, "won"),
          gte(recruitmentStageHistory.changedAt, weekStartDate),
          lt(recruitmentStageHistory.changedAt, weekEndDate),
        ));

      // Current funnel snapshot
      const recruitmentFunnel = await db
        .select({
          stage: recruitmentProspects.pipelineStage,
          count: sql<number>`COUNT(*)`,
        })
        .from(recruitmentProspects)
        .where(ne(recruitmentProspects.pipelineStage, "archived"))
        .groupBy(recruitmentProspects.pipelineStage)
        .orderBy(sql`COUNT(*) DESC`);

      // Stage moves this week (recruitment)
      const recruitmentStageMovesThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(recruitmentStageHistory)
        .where(and(
          gte(recruitmentStageHistory.changedAt, weekStartDate),
          lt(recruitmentStageHistory.changedAt, weekEndDate),
        ));

      // ─── SECTION 6: Staff Productivity ────────────────────────────────────

      // Get all admin/super_admin users
      const adminUsers = await db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
        })
        .from(users)
        .where(inArray(users.role, ["admin", "super_admin"]));

      const adminIds = adminUsers.map((u) => u.id);

      if (adminIds.length === 0) {
        return buildResponse({
          newSignupsThisWeek, newSignupsPrevWeek, cancellationsThisWeek, cancellationsPrevWeek,
          totalActiveAgents, totalPayingAgents, tierBreakdown, inNoticeCount, pausedCount,
          activeSubscriptions, totalGcSubscriptions,
          paymentsConfirmedThisWeek, paymentsConfirmedPrevWeek, paymentsPaidOutThisWeek,
          failedPaymentsThisWeek, agentsWithFailures, newMandatesThisWeek, cancelledMandatesThisWeek,
          newBookingsThisWeek, newBookingsPrevWeek, pipelineStageDistribution, pipelineMovesThisWeek,
          amendmentsThisWeek, amendmentsActionedThisWeek, refundsThisWeek, refundsByStage,
          flightRequestsThisWeek, flightRequestsPendingCount, pipelineDwellRaw,
          jltRevenueThisWeek, jltRevenuePrevWeek, agentPayoutsThisWeek,
          commissionClaimsThisWeek, commissionClaimsPaidThisWeek,
          reimbursementsPaidThisWeek, reimbursementsScheduled, reimbursementsPending,
          newProspectsThisWeek, newProspectsPrevWeek, wonProspectsThisWeek,
          recruitmentFunnel, recruitmentStageMovesThisWeek,
          staffProductivity: [],
          emailStats: null,
        });
      }

      // Pipeline moves per admin
      const pipelineMovesByAdmin = await db
        .select({
          adminId: pipelineHistory.movedById,
          count: sql<number>`COUNT(*)`,
        })
        .from(pipelineHistory)
        .where(and(
          gte(pipelineHistory.movedAt, weekStartDate),
          lt(pipelineHistory.movedAt, weekEndDate),
          inArray(pipelineHistory.movedById, adminIds),
        ))
        .groupBy(pipelineHistory.movedById);

      // Tasks completed per admin
      const tasksCompletedByAdmin = await db
        .select({
          adminId: adminTasks.assigneeId,
          count: sql<number>`COUNT(*)`,
        })
        .from(adminTasks)
        .where(and(
          eq(adminTasks.status, "done"),
          gte(adminTasks.updatedAt, weekStartDate),
          lt(adminTasks.updatedAt, weekEndDate),
          isNotNull(adminTasks.assigneeId),
          inArray(adminTasks.assigneeId, adminIds),
        ))
        .groupBy(adminTasks.assigneeId);

      // Tasks created per admin
      const tasksCreatedByAdmin = await db
        .select({
          adminId: adminTasks.createdById,
          count: sql<number>`COUNT(*)`,
        })
        .from(adminTasks)
        .where(and(
          gte(adminTasks.createdAt, weekStartDate),
          lt(adminTasks.createdAt, weekEndDate),
          inArray(adminTasks.createdById, adminIds),
        ))
        .groupBy(adminTasks.createdById);

      // Commission claims paid per admin
      const commissionsPaidByAdmin = await db
        .select({
          adminId: commissionClaims.paidById,
          count: sql<number>`COUNT(*)`,
          total: sql<number>`SUM(grossAmount)`,
        })
        .from(commissionClaims)
        .where(and(
          eq(commissionClaims.status, "paid"),
          isNotNull(commissionClaims.paidAt),
          gte(commissionClaims.paidAt, weekStartDate),
          lt(commissionClaims.paidAt, weekEndDate),
          isNotNull(commissionClaims.paidById),
          inArray(commissionClaims.paidById, adminIds),
        ))
        .groupBy(commissionClaims.paidById);

      // Reimbursements paid per admin
      const reimbursementsPaidByAdmin = await db
        .select({
          adminId: reimbursementItems.paidById,
          count: sql<number>`COUNT(*)`,
          total: sql<number>`SUM(amount)`,
        })
        .from(reimbursementItems)
        .where(and(
          eq(reimbursementItems.status, "paid"),
          isNotNull(reimbursementItems.paidAt),
          gte(reimbursementItems.paidAt, weekStartDate),
          lt(reimbursementItems.paidAt, weekEndDate),
          isNotNull(reimbursementItems.paidById),
          inArray(reimbursementItems.paidById, adminIds),
        ))
        .groupBy(reimbursementItems.paidById);

      // Reimbursements scheduled per admin (marked as scheduled this week)
      const reimbursementsScheduledByAdmin = await db
        .select({
          adminId: reimbursementItems.assignedToId,
          count: sql<number>`COUNT(*)`,
        })
        .from(reimbursementItems)
        .where(and(
          eq(reimbursementItems.status, "scheduled"),
          isNotNull(reimbursementItems.scheduledAt),
          gte(reimbursementItems.scheduledAt, weekStartDate),
          lt(reimbursementItems.scheduledAt, weekEndDate),
          isNotNull(reimbursementItems.assignedToId),
          inArray(reimbursementItems.assignedToId, adminIds),
        ))
        .groupBy(reimbursementItems.assignedToId);

      // Agent status changes per admin
      const statusChangesByAdmin = await db
        .select({
          adminId: agentStatusEvents.adminId,
          count: sql<number>`COUNT(*)`,
        })
        .from(agentStatusEvents)
        .where(and(
          gte(agentStatusEvents.createdAt, weekStartDate),
          lt(agentStatusEvents.createdAt, weekEndDate),
          inArray(agentStatusEvents.adminId, adminIds),
        ))
        .groupBy(agentStatusEvents.adminId);

      // Booking notes written per admin (admin-authored notes in the notes table)
      const notesByAdmin = await db
        .select({
          adminId: notes.authorId,
          count: sql<number>`COUNT(*)`,
        })
        .from(notes)
        .where(and(
          gte(notes.createdAt, weekStartDate),
          lt(notes.createdAt, weekEndDate),
          inArray(notes.authorId, adminIds),
        ))
        .groupBy(notes.authorId);

      // Amendments actioned per admin
      const amendmentsActionedByAdmin = await db
        .select({
          adminId: amendments.actionedById,
          count: sql<number>`COUNT(*)`,
        })
        .from(amendments)
        .where(and(
          eq(amendments.status, "actioned"),
          isNotNull(amendments.actionedAt),
          gte(amendments.actionedAt, weekStartDate),
          lt(amendments.actionedAt, weekEndDate),
          isNotNull(amendments.actionedById),
          inArray(amendments.actionedById, adminIds),
        ))
        .groupBy(amendments.actionedById);

      // Recruitment stage moves per admin
      const recruitmentMovesByAdmin = await db
        .select({
          adminId: recruitmentStageHistory.changedById,
          count: sql<number>`COUNT(*)`,
        })
        .from(recruitmentStageHistory)
        .where(and(
          gte(recruitmentStageHistory.changedAt, weekStartDate),
          lt(recruitmentStageHistory.changedAt, weekEndDate),
          isNotNull(recruitmentStageHistory.changedById),
          inArray(recruitmentStageHistory.changedById, adminIds),
        ))
        .groupBy(recruitmentStageHistory.changedById);

      // Build staff productivity rows
      const staffProductivity = adminUsers.map((admin) => {
        const pipelineMoves = pipelineMovesByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
        const tasksCompleted = tasksCompletedByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
        const tasksCreated = tasksCreatedByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
        const commissionsPaid = commissionsPaidByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
        const commissionsTotal = commissionsPaidByAdmin.find((r) => r.adminId === admin.id)?.total ?? 0;
        const reimbPaid = reimbursementsPaidByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
        const reimbTotal = reimbursementsPaidByAdmin.find((r) => r.adminId === admin.id)?.total ?? 0;
        const reimbScheduled = reimbursementsScheduledByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
        const statusChanges = statusChangesByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
        const bookingNotes = notesByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
        const amendmentsActioned = amendmentsActionedByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
        const recruitmentMoves = recruitmentMovesByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;

        return {
          adminId: admin.id,
          adminName: admin.name,
          adminRole: admin.role,
          pipelineMoves: Number(pipelineMoves),
          tasksCompleted: Number(tasksCompleted),
          tasksCreated: Number(tasksCreated),
          commissionsPaid: Number(commissionsPaid),
          commissionsTotal: Number(commissionsTotal),
          reimbursementsPaid: Number(reimbPaid),
          reimbursementsTotal: Number(reimbTotal),
          reimbursementsScheduled: Number(reimbScheduled),
          statusChanges: Number(statusChanges),
          bookingNotes: Number(bookingNotes),
          amendmentsActioned: Number(amendmentsActioned),
          recruitmentMoves: Number(recruitmentMoves),
          totalActions:
            Number(pipelineMoves) +
            Number(tasksCompleted) +
            Number(commissionsPaid) +
            Number(reimbPaid) +
            Number(reimbScheduled) +
            Number(statusChanges) +
            Number(bookingNotes) +
            Number(amendmentsActioned) +
            Number(recruitmentMoves),
        };
      }).sort((a, b) => b.totalActions - a.totalActions);

      // ─── SECTION 7: Communications ────────────────────────────────────────

      // Emails sent this week (all types)
      const emailsSentThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentEmails)
        .where(and(
          gte(agentEmails.sentAt, weekStartDate),
          lt(agentEmails.sentAt, weekEndDate),
          eq(agentEmails.status, "sent"),
        ));

      const emailsSentPrevWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentEmails)
        .where(and(
          gte(agentEmails.sentAt, prevWeekStart),
          lt(agentEmails.sentAt, prevWeekEnd),
          eq(agentEmails.status, "sent"),
        ));

      // Campaign emails this week
      const campaignEmailsThisWeek = await db
        .select({
          count: sql<number>`COUNT(*)`,
          opened: sql<number>`SUM(CASE WHEN status = 'opened' THEN 1 ELSE 0 END)`,
          clicked: sql<number>`SUM(CASE WHEN status = 'clicked' THEN 1 ELSE 0 END)`,
          bounced: sql<number>`SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END)`,
        })
        .from(emailSends)
        .where(and(
          isNotNull(emailSends.campaignId),
          gte(emailSends.createdAt, weekStartDate),
          lt(emailSends.createdAt, weekEndDate),
        ));

      // Campaigns sent this week
      const campaignsSentThisWeek = await db
        .select({
          id: emailCampaigns.id,
          name: emailCampaigns.name,
          audienceType: emailCampaigns.audienceType,
          totalRecipients: emailCampaigns.totalRecipients,
          sentAt: emailCampaigns.sentAt,
          sentByName: emailCampaigns.sentByName,
        })
        .from(emailCampaigns)
        .where(and(
          eq(emailCampaigns.status, "sent"),
          isNotNull(emailCampaigns.sentAt),
          gte(emailCampaigns.sentAt, weekStartDate),
          lt(emailCampaigns.sentAt, weekEndDate),
        ));

      // Email type breakdown (triggerKey grouping)
      const emailTypeBreakdown = await db
        .select({
          triggerKey: agentEmails.triggerKey,
          count: sql<number>`COUNT(*)`,
        })
        .from(agentEmails)
        .where(and(
          gte(agentEmails.sentAt, weekStartDate),
          lt(agentEmails.sentAt, weekEndDate),
          eq(agentEmails.status, "sent"),
        ))
        .groupBy(agentEmails.triggerKey)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(15);

      const emailStats = {
        emailsSentThisWeek: Number(emailsSentThisWeek[0]?.count ?? 0),
        emailsSentPrevWeek: Number(emailsSentPrevWeek[0]?.count ?? 0),
        campaignEmailsThisWeek: Number(campaignEmailsThisWeek[0]?.count ?? 0),
        campaignOpenRate: campaignEmailsThisWeek[0]?.count
          ? Math.round((Number(campaignEmailsThisWeek[0].opened) / Number(campaignEmailsThisWeek[0].count)) * 100)
          : 0,
        campaignClickRate: campaignEmailsThisWeek[0]?.count
          ? Math.round((Number(campaignEmailsThisWeek[0].clicked) / Number(campaignEmailsThisWeek[0].count)) * 100)
          : 0,
        campaignBounceRate: campaignEmailsThisWeek[0]?.count
          ? Math.round((Number(campaignEmailsThisWeek[0].bounced) / Number(campaignEmailsThisWeek[0].count)) * 100)
          : 0,
        campaignsSentThisWeek,
        emailTypeBreakdown: emailTypeBreakdown.map((r) => ({
          triggerKey: r.triggerKey ?? "unknown",
          count: Number(r.count),
        })),
      };

      return buildResponse({
        newSignupsThisWeek, newSignupsPrevWeek, cancellationsThisWeek, cancellationsPrevWeek,
        totalActiveAgents, totalPayingAgents, tierBreakdown, inNoticeCount, pausedCount,
        activeSubscriptions, totalGcSubscriptions,
        paymentsConfirmedThisWeek, paymentsConfirmedPrevWeek, paymentsPaidOutThisWeek,
        failedPaymentsThisWeek, agentsWithFailures, newMandatesThisWeek, cancelledMandatesThisWeek,
        newBookingsThisWeek, newBookingsPrevWeek, pipelineStageDistribution, pipelineMovesThisWeek,
        amendmentsThisWeek, amendmentsActionedThisWeek, refundsThisWeek, refundsByStage,
        flightRequestsThisWeek, flightRequestsPendingCount, pipelineDwellRaw,
        jltRevenueThisWeek, jltRevenuePrevWeek, agentPayoutsThisWeek,
        commissionClaimsThisWeek, commissionClaimsPaidThisWeek,
        reimbursementsPaidThisWeek, reimbursementsScheduled, reimbursementsPending,
        newProspectsThisWeek, newProspectsPrevWeek, wonProspectsThisWeek,
        recruitmentFunnel, recruitmentStageMovesThisWeek,
        staffProductivity,
        emailStats,
      });
    }),

  /**
   * 13-week trend data for sparklines / charts
   */
  weeklyTrend: superAdminProcedure
    .input(z.object({ metric: z.enum(["newSignups", "cancellations", "newBookings", "ddConfirmed", "ddPaidOut", "newProspects", "jltRevenue"]) }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const {
        agentStatusEvents,
        bookings,
        gcPaymentEvents,
        recruitmentProspects,
        recruitmentStageHistory,
        remittanceLines,
        remittanceBatches,
      } = await import("../drizzle/schema");
      const { gte, lt, and, eq, sql, isNotNull, inArray, notLike } = await import("drizzle-orm");
      const { gcMandates: gcMandatesTrend } = await import("../drizzle/schema");

      const weeks: Array<{ label: string; start: Date; end: Date }> = [];
      const now = new Date();
      const dayOfWeek = now.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const thisMonday = new Date(now);
      thisMonday.setDate(now.getDate() - daysToMonday);
      thisMonday.setHours(0, 0, 0, 0);

      for (let i = 12; i >= 0; i--) {
        const start = new Date(thisMonday);
        start.setDate(thisMonday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 7);
        const label = start.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        weeks.push({ label, start, end });
      }

      const results: Array<{ week: string; value: number }> = [];

      for (const week of weeks) {
        let value = 0;
        if (input.metric === "newSignups") {
          const r = await db.select({ count: sql<number>`COUNT(*)` })
            .from(gcMandatesTrend)
            .where(and(isNotNull(gcMandatesTrend.joiningFeePaidAt), gte(gcMandatesTrend.joiningFeePaidAt, week.start), lt(gcMandatesTrend.joiningFeePaidAt, week.end)));
          value = Number(r[0]?.count ?? 0);
        } else if (input.metric === "cancellations") {
          const r = await db.select({ count: sql<number>`COUNT(*)` })
            .from(agentStatusEvents)
            .where(and(inArray(agentStatusEvents.toStatus, ["cancelled", "in_notice"]), gte(agentStatusEvents.createdAt, week.start), lt(agentStatusEvents.createdAt, week.end)));
          value = Number(r[0]?.count ?? 0);
        } else if (input.metric === "newBookings") {
          const r = await db.select({ count: sql<number>`COUNT(*)` })
            .from(bookings)
            .where(and(gte(bookings.bookedDate, week.start), lt(bookings.bookedDate, week.end)));
          value = Number(r[0]?.count ?? 0);
        } else if (input.metric === "ddConfirmed") {
          const r = await db.select({ total: sql<number>`SUM(amount)` })
            .from(gcPaymentEvents)
            .where(and(eq(gcPaymentEvents.eventType, "payments_confirmed"), gte(gcPaymentEvents.occurredAt, week.start), lt(gcPaymentEvents.occurredAt, week.end), isNotNull(gcPaymentEvents.amount), notLike(gcPaymentEvents.rawPayload, '%"subscription"%')));
          value = Math.round(Number(r[0]?.total ?? 0) / 100);
        } else if (input.metric === "ddPaidOut") {
          const r = await db.select({ total: sql<number>`SUM(amount)` })
            .from(gcPaymentEvents)
            .where(and(eq(gcPaymentEvents.eventType, "payments_paid_out"), gte(gcPaymentEvents.occurredAt, week.start), lt(gcPaymentEvents.occurredAt, week.end), isNotNull(gcPaymentEvents.amount)));
          value = Math.round(Number(r[0]?.total ?? 0) / 100);
        } else if (input.metric === "newProspects") {
          const r = await db.select({ count: sql<number>`COUNT(*)` })
            .from(recruitmentProspects)
            .where(and(gte(recruitmentProspects.createdAt, week.start), lt(recruitmentProspects.createdAt, week.end)));
          value = Number(r[0]?.count ?? 0);
        } else if (input.metric === "jltRevenue") {
          const r = await db.select({ total: sql<number>`SUM(jlt20)` })
            .from(remittanceLines)
            .innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id))
            .where(and(gte(remittanceBatches.createdAt, week.start), lt(remittanceBatches.createdAt, week.end), isNotNull(remittanceLines.jlt20)));
          value = Number(r[0]?.total ?? 0);
        }
        results.push({ week: week.label, value });
      }

      return results;
    }),

  /**
   * Drill-down: list of agents who paid their joining fee in a given week.
   * Uses gc_mandates.joiningFeePaidAt — the same source as the sign-ups count metric.
   */
  drillDownSignups: superAdminProcedure
    .input(z.object({ weekStart: z.string() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { gcMandates, agentCrmProfiles, users } = await import("../drizzle/schema");
      const { gte, lt, and, eq, isNotNull } = await import("drizzle-orm");
      const [wsYear, wsMon, wsDay] = input.weekStart.split("-").map(Number);
      const weekStartDate = new Date(wsYear, wsMon - 1, wsDay, 0, 0, 0, 0);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 7);
      return db
        .select({
          id: gcMandates.id,
          prospectId: gcMandates.id,
          firstName: users.name,
          lastName: agentCrmProfiles.uniqueAgentId,
          email: users.email,
          tierInterest: agentCrmProfiles.membershipTier,
          changedAt: gcMandates.joiningFeePaidAt,
          changedByName: agentCrmProfiles.uniqueAgentId,
        })
        .from(gcMandates)
        .innerJoin(users, eq(gcMandates.userId, users.id))
        .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, gcMandates.userId))
        .where(and(
          isNotNull(gcMandates.joiningFeePaidAt),
          gte(gcMandates.joiningFeePaidAt, weekStartDate),
          lt(gcMandates.joiningFeePaidAt, weekEndDate),
        ))
        .orderBy(gcMandates.joiningFeePaidAt);
    }),

  /**
   * Drill-down: list of cancellations in a given week
   */
  drillDownCancellations: superAdminProcedure
    .input(z.object({ weekStart: z.string() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { agentStatusEvents, users } = await import("../drizzle/schema");
      const { gte, lt, and, inArray, eq } = await import("drizzle-orm");
      const [wsYear, wsMon, wsDay] = input.weekStart.split("-").map(Number);
      const weekStartDate = new Date(wsYear, wsMon - 1, wsDay, 0, 0, 0, 0);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 7);
      return db
        .select({
          id: agentStatusEvents.id,
          userId: agentStatusEvents.userId,
          agentName: users.name,
          agentEmail: users.email,
          toStatus: agentStatusEvents.toStatus,
          notes: agentStatusEvents.notes,
          createdAt: agentStatusEvents.createdAt,
        })
        .from(agentStatusEvents)
        .innerJoin(users, eq(agentStatusEvents.userId, users.id))
        .where(and(
          inArray(agentStatusEvents.toStatus, ["cancelled", "in_notice"]),
          gte(agentStatusEvents.createdAt, weekStartDate),
          lt(agentStatusEvents.createdAt, weekEndDate),
        ))
        .orderBy(agentStatusEvents.createdAt);
    }),

  /**
   * Drill-down: DD payment events for a given week
   */
  drillDownDdPayments: superAdminProcedure
    .input(z.object({ weekStart: z.string(), eventType: z.enum(["payments_confirmed", "payments_paid_out", "payments_failed"]).optional() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { gcPaymentEvents, users } = await import("../drizzle/schema");
      const { gte, lt, and, eq, isNotNull } = await import("drizzle-orm");
      const [wsYear, wsMon, wsDay] = input.weekStart.split("-").map(Number);
      const weekStartDate = new Date(wsYear, wsMon - 1, wsDay, 0, 0, 0, 0);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 7);
      return db
        .select({
          id: gcPaymentEvents.id,
          userId: gcPaymentEvents.userId,
          agentName: users.name,
          agentEmail: users.email,
          paymentId: gcPaymentEvents.paymentId,
          amount: gcPaymentEvents.amount,
          currency: gcPaymentEvents.currency,
          failureReason: gcPaymentEvents.failureReason,
          failureDescription: gcPaymentEvents.failureDescription,
          occurredAt: gcPaymentEvents.occurredAt,
        })
        .from(gcPaymentEvents)
        .leftJoin(users, eq(gcPaymentEvents.userId, users.id))
        .where(and(
          input.eventType ? eq(gcPaymentEvents.eventType, input.eventType) : undefined,
          gte(gcPaymentEvents.occurredAt, weekStartDate),
          lt(gcPaymentEvents.occurredAt, weekEndDate),
          isNotNull(gcPaymentEvents.amount),
        ))
        .orderBy(gcPaymentEvents.occurredAt);
    }),

  /**
   * Drill-down: active GC subscriptions with agent details
   */
  drillDownSubscriptions: superAdminProcedure
    .input(z.object({ status: z.enum(["active", "paused", "cancelled"]).optional() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { gcSubscriptions, users, agentCrmProfiles } = await import("../drizzle/schema");
      const { eq, sql: sqlDrizzle, and: andDrizzle, or: orDrizzle } = await import("drizzle-orm");
      const statusFilter = input.status ? [input.status] : ["active", "paused"];
      const statusCond = statusFilter.length === 1
        ? eq(gcSubscriptions.status, statusFilter[0] as "active" | "paused" | "cancelled")
        : orDrizzle(
            eq(gcSubscriptions.status, statusFilter[0] as "active" | "paused" | "cancelled"),
            eq(gcSubscriptions.status, statusFilter[1] as "active" | "paused" | "cancelled"),
          );
      return db
        .select({
          id: gcSubscriptions.id,
          userId: gcSubscriptions.userId,
          agentName: users.name,
          agentEmail: users.email,
          membershipTier: agentCrmProfiles.membershipTier,
          status: gcSubscriptions.status,
          amount: gcSubscriptions.amount,
          currency: gcSubscriptions.currency,
          nextChargeDate: gcSubscriptions.nextChargeDate,
          createdAt: gcSubscriptions.createdAt,
        })
        .from(gcSubscriptions)
        .innerJoin(users, eq(gcSubscriptions.userId, users.id))
        .leftJoin(agentCrmProfiles, eq(gcSubscriptions.userId, agentCrmProfiles.userId))
        .where(statusCond)
                .orderBy(gcSubscriptions.createdAt);
    }),

/**
   * Monthly stats — same 7-section structure as weeklyStats but month-over-month.
   * monthStart: ISO date string (first day of the month, e.g. "2026-05-01")
   */
  monthlyStats: superAdminProcedure
    .input(z.object({ monthStart: z.string() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const {
        users, agentCrmProfiles, agentStatusEvents, bookings, pipelineHistory, amendments, refunds,
        reimbursementItems, commissionClaims, remittanceBatches, remittanceLines, gcSubscriptions,
        gcPaymentEvents, gcMandates, notes, agentEmails, flightRequests,
        recruitmentProspects, recruitmentStageHistory, adminTasks,
      } = await import("../drizzle/schema");
      const { gte, lt, and, eq, sql, isNotNull, inArray, ne, notLike } = await import("drizzle-orm");
      const [msYear, msMon] = input.monthStart.split("-").map(Number);
      const monthStartDate = new Date(msYear, msMon - 1, 1, 0, 0, 0, 0);
      const monthEndDate = new Date(msYear, msMon, 1, 0, 0, 0, 0);
      const prevMonthStart = new Date(msYear, msMon - 2, 1, 0, 0, 0, 0);
      const prevMonthEnd = monthStartDate;
      const n = (v: unknown) => Number(v ?? 0);

      // ── Section 1: Membership ──
      const [
        newSignupsThisMonth, newSignupsPrevMonth,
        cancellationsThisMonth, cancellationsPrevMonth,
        totalActiveAgents, totalPayingAgents, tierBreakdown,
        inNoticeCount, pausedCount,
      ] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` }).from(gcMandates).where(and(isNotNull(gcMandates.joiningFeePaidAt), gte(gcMandates.joiningFeePaidAt, monthStartDate), lt(gcMandates.joiningFeePaidAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)` }).from(gcMandates).where(and(isNotNull(gcMandates.joiningFeePaidAt), gte(gcMandates.joiningFeePaidAt, prevMonthStart), lt(gcMandates.joiningFeePaidAt, prevMonthEnd))),
        db.select({ count: sql<number>`COUNT(*)` }).from(agentStatusEvents).where(and(inArray(agentStatusEvents.toStatus, ["cancelled", "in_notice"]), gte(agentStatusEvents.createdAt, monthStartDate), lt(agentStatusEvents.createdAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)` }).from(agentStatusEvents).where(and(inArray(agentStatusEvents.toStatus, ["cancelled", "in_notice"]), gte(agentStatusEvents.createdAt, prevMonthStart), lt(agentStatusEvents.createdAt, prevMonthEnd))),
        db.select({ count: sql<number>`COUNT(*)` }).from(agentCrmProfiles).where(eq(agentCrmProfiles.agentStatus, "active")),
        db.select({ count: sql<number>`COUNT(*)` }).from(agentCrmProfiles).where(inArray(agentCrmProfiles.agentStatus, ["active", "paused"])),
        db.select({ tier: agentCrmProfiles.membershipTier, count: sql<number>`COUNT(*)` }).from(agentCrmProfiles).where(inArray(agentCrmProfiles.agentStatus, ["active", "paused"])).groupBy(agentCrmProfiles.membershipTier),
        db.select({ count: sql<number>`COUNT(*)` }).from(agentCrmProfiles).where(eq(agentCrmProfiles.agentStatus, "in_notice")),
        db.select({ count: sql<number>`COUNT(*)` }).from(agentCrmProfiles).where(eq(agentCrmProfiles.agentStatus, "paused")),
      ]);

      // ── Section 2: DD Revenue ──
      const [activeSubscriptions] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)`, totalAmountPence: sql<number>`SUM(amount)` }).from(gcSubscriptions).where(eq(gcSubscriptions.status, "active")),
      ]);
      // Deduplicated paid-out payments for the month
      const paidOutThisMonthRaw = await db.execute(sql`
        SELECT COUNT(DISTINCT paymentId) AS count, SUM(DISTINCT CASE WHEN paymentId IS NOT NULL THEN amount ELSE 0 END) AS totalPence
        FROM gc_payment_events
        WHERE eventType = 'payments_paid_out' AND occurredAt >= ${monthStartDate} AND occurredAt < ${monthEndDate} AND amount IS NOT NULL AND paymentId IS NOT NULL
      `) as unknown as Array<{ count: number; totalPence: number }>;
      const paidOutPrevMonthRaw = await db.execute(sql`
        SELECT COUNT(DISTINCT paymentId) AS count, SUM(DISTINCT CASE WHEN paymentId IS NOT NULL THEN amount ELSE 0 END) AS totalPence
        FROM gc_payment_events
        WHERE eventType = 'payments_paid_out' AND occurredAt >= ${prevMonthStart} AND occurredAt < ${prevMonthEnd} AND amount IS NOT NULL AND paymentId IS NOT NULL
      `) as unknown as Array<{ count: number; totalPence: number }>;
      const [confirmedThisMonth, confirmedPrevMonth, failedThisMonth] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)`, totalPence: sql<number>`SUM(amount)` }).from(gcPaymentEvents).where(and(eq(gcPaymentEvents.eventType, "payments_confirmed"), gte(gcPaymentEvents.occurredAt, monthStartDate), lt(gcPaymentEvents.occurredAt, monthEndDate), isNotNull(gcPaymentEvents.amount), notLike(gcPaymentEvents.rawPayload, '%"subscription"%'))),
        db.select({ count: sql<number>`COUNT(*)`, totalPence: sql<number>`SUM(amount)` }).from(gcPaymentEvents).where(and(eq(gcPaymentEvents.eventType, "payments_confirmed"), gte(gcPaymentEvents.occurredAt, prevMonthStart), lt(gcPaymentEvents.occurredAt, prevMonthEnd), isNotNull(gcPaymentEvents.amount), notLike(gcPaymentEvents.rawPayload, '%"subscription"%'))),
        db.select({ count: sql<number>`COUNT(*)`, totalPence: sql<number>`SUM(amount)` }).from(gcPaymentEvents).where(and(eq(gcPaymentEvents.eventType, "payments_failed"), gte(gcPaymentEvents.occurredAt, monthStartDate), lt(gcPaymentEvents.occurredAt, monthEndDate))),
      ]);

      // ── Section 3: Bookings & Pipeline ──
      const [
        newBookingsThisMonth, newBookingsPrevMonth,
        pipelineMovesThisMonth, amendmentsThisMonth, amendmentsActionedThisMonth,
        refundsThisMonth, flightRequestsThisMonth, flightRequestsPending,
        pipelineStageDistribution, refundsByStage,
      ] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` }).from(bookings).where(and(isNotNull(bookings.bookedDate), gte(bookings.bookedDate, monthStartDate), lt(bookings.bookedDate, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)` }).from(bookings).where(and(isNotNull(bookings.bookedDate), gte(bookings.bookedDate, prevMonthStart), lt(bookings.bookedDate, prevMonthEnd))),
        db.select({ count: sql<number>`COUNT(*)` }).from(pipelineHistory).where(and(gte(pipelineHistory.movedAt, monthStartDate), lt(pipelineHistory.movedAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)` }).from(amendments).where(and(gte(amendments.createdAt, monthStartDate), lt(amendments.createdAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)` }).from(amendments).where(and(eq(amendments.status, "actioned"), isNotNull(amendments.actionedAt), gte(amendments.actionedAt, monthStartDate), lt(amendments.actionedAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)` }).from(refunds).where(and(gte(refunds.createdAt, monthStartDate), lt(refunds.createdAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)` }).from(flightRequests).where(and(gte(flightRequests.createdAt, monthStartDate), lt(flightRequests.createdAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)` }).from(flightRequests).where(eq(flightRequests.status, "pending")),
        db.select({ stage: bookings.currentStage, count: sql<number>`COUNT(*)` }).from(bookings).groupBy(bookings.currentStage).orderBy(sql`COUNT(*) DESC`),
        db.select({ stage: refunds.pipelineStage, count: sql<number>`COUNT(*)` }).from(refunds).where(ne(refunds.status, "completed")).groupBy(refunds.pipelineStage).orderBy(sql`COUNT(*) DESC`),
      ]);

      // ── Section 4: Financials ──
      const [
        jltRevenueThisMonth, jltRevenuePrevMonth, agentPayoutsThisMonth,
        commissionClaimsThisMonth, commissionClaimsPaidThisMonth,
        reimbursementsPaidThisMonth, reimbursementsScheduled, reimbursementsPending,
      ] = await Promise.all([
        db.select({ total: sql<number>`SUM(jlt20)` }).from(remittanceLines).innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id)).where(and(gte(remittanceBatches.createdAt, monthStartDate), lt(remittanceBatches.createdAt, monthEndDate), isNotNull(remittanceLines.jlt20))),
        db.select({ total: sql<number>`SUM(jlt20)` }).from(remittanceLines).innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id)).where(and(gte(remittanceBatches.createdAt, prevMonthStart), lt(remittanceBatches.createdAt, prevMonthEnd), isNotNull(remittanceLines.jlt20))),
        db.select({ total: sql<number>`SUM(remit80)` }).from(remittanceLines).innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id)).where(and(gte(remittanceBatches.createdAt, monthStartDate), lt(remittanceBatches.createdAt, monthEndDate), isNotNull(remittanceLines.remit80))),
        db.select({ count: sql<number>`COUNT(*)`, totalGross: sql<number>`SUM(grossAmount)` }).from(commissionClaims).where(and(gte(commissionClaims.createdAt, monthStartDate), lt(commissionClaims.createdAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)`, totalGross: sql<number>`SUM(grossAmount)` }).from(commissionClaims).where(and(eq(commissionClaims.status, "paid"), isNotNull(commissionClaims.paidAt), gte(commissionClaims.paidAt, monthStartDate), lt(commissionClaims.paidAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)`, total: sql<number>`SUM(amount)` }).from(reimbursementItems).where(and(eq(reimbursementItems.status, "paid"), isNotNull(reimbursementItems.paidAt), gte(reimbursementItems.paidAt, monthStartDate), lt(reimbursementItems.paidAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)`, total: sql<number>`SUM(amount)` }).from(reimbursementItems).where(eq(reimbursementItems.status, "scheduled")),
        db.select({ count: sql<number>`COUNT(*)`, total: sql<number>`SUM(amount)` }).from(reimbursementItems).where(eq(reimbursementItems.status, "pending")),
      ]);

      // ── Section 5: Recruitment ──
      const [
        newProspectsThisMonth, newProspectsPrevMonth, wonProspectsThisMonth,
        recruitmentFunnel, recruitmentStageMovesThisMonth,
      ] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentProspects).where(and(gte(recruitmentProspects.createdAt, monthStartDate), lt(recruitmentProspects.createdAt, monthEndDate))),
        db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentProspects).where(and(gte(recruitmentProspects.createdAt, prevMonthStart), lt(recruitmentProspects.createdAt, prevMonthEnd))),
        db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentStageHistory).where(and(eq(recruitmentStageHistory.toStage, "won"), gte(recruitmentStageHistory.changedAt, monthStartDate), lt(recruitmentStageHistory.changedAt, monthEndDate))),
        db.select({ stage: recruitmentProspects.pipelineStage, count: sql<number>`COUNT(*)` }).from(recruitmentProspects).where(ne(recruitmentProspects.pipelineStage, "archived")).groupBy(recruitmentProspects.pipelineStage).orderBy(sql`COUNT(*) DESC`),
        db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentStageHistory).where(and(gte(recruitmentStageHistory.changedAt, monthStartDate), lt(recruitmentStageHistory.changedAt, monthEndDate))),
      ]);

      // Recruitment conversion rate: won / total non-archived
      const totalNonArchivedProspects = await db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentProspects).where(ne(recruitmentProspects.pipelineStage, "archived"));
      const wonAllTime = await db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentStageHistory).where(eq(recruitmentStageHistory.toStage, "won"));
      const totalEnquiries = await db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentProspects);
      const totalApplications = await db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentProspects).where(isNotNull(recruitmentProspects.applicationSubmittedAt));
      // Avg time from enquiry to won (days)
      const avgTimeToSignupRaw = await db.execute(sql`
        SELECT AVG(TIMESTAMPDIFF(DAY, rp.createdAt, rsh.changedAt)) AS avgDays
        FROM recruitment_stage_history rsh
        JOIN recruitment_prospects rp ON rsh.prospectId = rp.id
        WHERE rsh.toStage = 'won'
      `) as unknown as Array<{ avgDays: number | null }>;

      // ── Section 6: Staff Productivity ──
      const adminUsers = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.role, ["admin", "super_admin"]));
      const adminIds = adminUsers.map((u) => u.id);
      let staffProductivity: Array<{
        adminId: number; adminName: string; role: string;
        pipelineMoves: number; tasksCompleted: number; tasksCreated: number;
        commissionsPaid: number; commissionsTotal: number;
        reimbPaid: number; reimbTotal: number; reimbScheduled: number;
        statusChanges: number; bookingNotes: number; amendmentsActioned: number;
        recruitmentMoves: number; totalActions: number;
      }> = [];
      if (adminIds.length > 0) {
        const [
          pipelineMovesByAdmin, tasksCompletedByAdmin, tasksCreatedByAdmin,
          commissionsPaidByAdmin, reimbursementsPaidByAdmin, reimbursementsScheduledByAdmin,
          statusChangesByAdmin, notesByAdmin, amendmentsActionedByAdmin, recruitmentMovesByAdmin,
        ] = await Promise.all([
          db.select({ adminId: pipelineHistory.movedById, count: sql<number>`COUNT(*)` }).from(pipelineHistory).where(and(gte(pipelineHistory.movedAt, monthStartDate), lt(pipelineHistory.movedAt, monthEndDate), inArray(pipelineHistory.movedById, adminIds))).groupBy(pipelineHistory.movedById),
          db.select({ adminId: adminTasks.assigneeId, count: sql<number>`COUNT(*)` }).from(adminTasks).where(and(eq(adminTasks.status, "done"), gte(adminTasks.updatedAt, monthStartDate), lt(adminTasks.updatedAt, monthEndDate), isNotNull(adminTasks.assigneeId), inArray(adminTasks.assigneeId, adminIds))).groupBy(adminTasks.assigneeId),
          db.select({ adminId: adminTasks.createdById, count: sql<number>`COUNT(*)` }).from(adminTasks).where(and(gte(adminTasks.createdAt, monthStartDate), lt(adminTasks.createdAt, monthEndDate), inArray(adminTasks.createdById, adminIds))).groupBy(adminTasks.createdById),
          db.select({ adminId: commissionClaims.paidById, count: sql<number>`COUNT(*)`, total: sql<number>`SUM(grossAmount)` }).from(commissionClaims).where(and(eq(commissionClaims.status, "paid"), isNotNull(commissionClaims.paidAt), gte(commissionClaims.paidAt, monthStartDate), lt(commissionClaims.paidAt, monthEndDate), isNotNull(commissionClaims.paidById), inArray(commissionClaims.paidById, adminIds))).groupBy(commissionClaims.paidById),
          db.select({ adminId: reimbursementItems.paidById, count: sql<number>`COUNT(*)`, total: sql<number>`SUM(amount)` }).from(reimbursementItems).where(and(eq(reimbursementItems.status, "paid"), isNotNull(reimbursementItems.paidAt), gte(reimbursementItems.paidAt, monthStartDate), lt(reimbursementItems.paidAt, monthEndDate), isNotNull(reimbursementItems.paidById), inArray(reimbursementItems.paidById, adminIds))).groupBy(reimbursementItems.paidById),
          db.select({ adminId: reimbursementItems.assignedToId, count: sql<number>`COUNT(*)` }).from(reimbursementItems).where(and(eq(reimbursementItems.status, "scheduled"), isNotNull(reimbursementItems.scheduledAt), gte(reimbursementItems.scheduledAt, monthStartDate), lt(reimbursementItems.scheduledAt, monthEndDate), isNotNull(reimbursementItems.assignedToId), inArray(reimbursementItems.assignedToId, adminIds))).groupBy(reimbursementItems.assignedToId),
          db.select({ adminId: agentStatusEvents.adminId, count: sql<number>`COUNT(*)` }).from(agentStatusEvents).where(and(gte(agentStatusEvents.createdAt, monthStartDate), lt(agentStatusEvents.createdAt, monthEndDate), inArray(agentStatusEvents.adminId, adminIds))).groupBy(agentStatusEvents.adminId),
          db.select({ adminId: notes.authorId, count: sql<number>`COUNT(*)` }).from(notes).where(and(gte(notes.createdAt, monthStartDate), lt(notes.createdAt, monthEndDate), inArray(notes.authorId, adminIds))).groupBy(notes.authorId),
          db.select({ adminId: amendments.actionedById, count: sql<number>`COUNT(*)` }).from(amendments).where(and(eq(amendments.status, "actioned"), isNotNull(amendments.actionedAt), gte(amendments.actionedAt, monthStartDate), lt(amendments.actionedAt, monthEndDate), isNotNull(amendments.actionedById), inArray(amendments.actionedById, adminIds))).groupBy(amendments.actionedById),
          db.select({ adminId: recruitmentStageHistory.changedById, count: sql<number>`COUNT(*)` }).from(recruitmentStageHistory).where(and(gte(recruitmentStageHistory.changedAt, monthStartDate), lt(recruitmentStageHistory.changedAt, monthEndDate), isNotNull(recruitmentStageHistory.changedById), inArray(recruitmentStageHistory.changedById, adminIds))).groupBy(recruitmentStageHistory.changedById),
        ]);
        staffProductivity = adminUsers.map((admin) => {
          const pipelineMoves = Number(pipelineMovesByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0);
          const tasksCompleted = Number(tasksCompletedByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0);
          const tasksCreated = Number(tasksCreatedByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0);
          const commissionsPaid = Number(commissionsPaidByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0);
          const commissionsTotal = Number(commissionsPaidByAdmin.find((r) => r.adminId === admin.id)?.total ?? 0);
          const reimbPaid = Number(reimbursementsPaidByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0);
          const reimbTotal = Number(reimbursementsPaidByAdmin.find((r) => r.adminId === admin.id)?.total ?? 0);
          const reimbScheduled = Number(reimbursementsScheduledByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0);
          const statusChanges = Number(statusChangesByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0);
          const bookingNotes = Number(notesByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0);
          const amendmentsActioned = Number(amendmentsActionedByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0);
          const recruitmentMoves = Number(recruitmentMovesByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0);
          return {
            adminId: admin.id, adminName: admin.name ?? "", role: admin.role,
            pipelineMoves, tasksCompleted, tasksCreated, commissionsPaid, commissionsTotal,
            reimbPaid, reimbTotal, reimbScheduled, statusChanges, bookingNotes, amendmentsActioned, recruitmentMoves,
            totalActions: pipelineMoves + tasksCompleted + tasksCreated + commissionsPaid + Number(reimbPaid) + Number(reimbScheduled) + statusChanges + bookingNotes + amendmentsActioned + recruitmentMoves,
          };
        }).sort((a, b) => b.totalActions - a.totalActions);
      }

      // ── Section 7: Communications ──
      const [emailsSentThisMonth, emailsSentPrevMonth] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` }).from(agentEmails).where(and(gte(agentEmails.sentAt, monthStartDate), lt(agentEmails.sentAt, monthEndDate), eq(agentEmails.status, "sent"))),
        db.select({ count: sql<number>`COUNT(*)` }).from(agentEmails).where(and(gte(agentEmails.sentAt, prevMonthStart), lt(agentEmails.sentAt, prevMonthEnd), eq(agentEmails.status, "sent"))),
      ]);

      // ── 12-month trend (for charts) ──
      const months: Array<{ label: string; start: Date; end: Date }> = [];
      for (let i = 11; i >= 0; i--) {
        const start = new Date(msYear, msMon - 1 - i, 1, 0, 0, 0, 0);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1, 0, 0, 0, 0);
        const label = start.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
        months.push({ label, start, end });
      }
      const monthlyTrend: Array<{
        month: string;
        newSignups: number; cancellations: number; newBookings: number;
        ddPaidOut: number; commissionClaims: number; newProspects: number; jltRevenue: number;
      }> = [];
      for (const m of months) {
        const [sigs, cans, bks, prospects, rev, claims] = await Promise.all([
          db.select({ count: sql<number>`COUNT(*)` }).from(gcMandates).where(and(isNotNull(gcMandates.joiningFeePaidAt), gte(gcMandates.joiningFeePaidAt, m.start), lt(gcMandates.joiningFeePaidAt, m.end))),
          db.select({ count: sql<number>`COUNT(*)` }).from(agentStatusEvents).where(and(inArray(agentStatusEvents.toStatus, ["cancelled", "in_notice"]), gte(agentStatusEvents.createdAt, m.start), lt(agentStatusEvents.createdAt, m.end))),
          db.select({ count: sql<number>`COUNT(*)` }).from(bookings).where(and(isNotNull(bookings.bookedDate), gte(bookings.bookedDate, m.start), lt(bookings.bookedDate, m.end))),
          db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentProspects).where(and(gte(recruitmentProspects.createdAt, m.start), lt(recruitmentProspects.createdAt, m.end))),
          db.select({ total: sql<number>`SUM(jlt20)` }).from(remittanceLines).innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id)).where(and(gte(remittanceBatches.createdAt, m.start), lt(remittanceBatches.createdAt, m.end), isNotNull(remittanceLines.jlt20))),
          db.select({ count: sql<number>`COUNT(*)` }).from(commissionClaims).where(and(gte(commissionClaims.createdAt, m.start), lt(commissionClaims.createdAt, m.end))),
        ]);
        const ddRaw = await db.execute(sql`
          SELECT SUM(DISTINCT CASE WHEN paymentId IS NOT NULL THEN amount ELSE 0 END) AS totalPence
          FROM gc_payment_events
          WHERE eventType = 'payments_paid_out' AND occurredAt >= ${m.start} AND occurredAt < ${m.end} AND amount IS NOT NULL AND paymentId IS NOT NULL
        `) as unknown as Array<{ totalPence: number }>;
        monthlyTrend.push({
          month: m.label,
          newSignups: n(sigs[0]?.count),
          cancellations: n(cans[0]?.count),
          newBookings: n(bks[0]?.count),
          ddPaidOut: Math.round(n(ddRaw[0]?.totalPence) / 100),
          commissionClaims: n(claims[0]?.count),
          newProspects: n(prospects[0]?.count),
          jltRevenue: n(rev[0]?.total),
        });
      }

      return {
        period: { monthStart: input.monthStart, monthLabel: monthStartDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) },
        membership: {
          totalActiveAgents: n(totalActiveAgents[0]?.count),
          totalPayingAgents: n(totalPayingAgents[0]?.count),
          newSignupsThisMonth: n(newSignupsThisMonth[0]?.count),
          newSignupsPrevMonth: n(newSignupsPrevMonth[0]?.count),
          cancellationsThisMonth: n(cancellationsThisMonth[0]?.count),
          cancellationsPrevMonth: n(cancellationsPrevMonth[0]?.count),
          netGrowthThisMonth: n(newSignupsThisMonth[0]?.count) - n(cancellationsThisMonth[0]?.count),
          inNoticeCount: n(inNoticeCount[0]?.count),
          pausedCount: n(pausedCount[0]?.count),
          tierBreakdown: tierBreakdown.map((r) => ({ tier: r.tier ?? "Unknown", count: n(r.count) })),
        },
        ddRevenue: {
          mrrGbp: Math.round(n(activeSubscriptions[0]?.totalAmountPence) / 100),
          paidOutThisMonthCount: n(paidOutThisMonthRaw[0]?.count),
          paidOutThisMonthGbp: Math.round(n(paidOutThisMonthRaw[0]?.totalPence) / 100),
          paidOutPrevMonthGbp: Math.round(n(paidOutPrevMonthRaw[0]?.totalPence) / 100),
          confirmedThisMonthCount: n(confirmedThisMonth[0]?.count),
          confirmedThisMonthGbp: Math.round(n(confirmedThisMonth[0]?.totalPence) / 100),
          confirmedPrevMonthGbp: Math.round(n(confirmedPrevMonth[0]?.totalPence) / 100),
          failedThisMonthCount: n(failedThisMonth[0]?.count),
          failedThisMonthGbp: Math.round(n(failedThisMonth[0]?.totalPence) / 100),
        },
        bookings: {
          newBookingsThisMonth: n(newBookingsThisMonth[0]?.count),
          newBookingsPrevMonth: n(newBookingsPrevMonth[0]?.count),
          pipelineMovesThisMonth: n(pipelineMovesThisMonth[0]?.count),
          amendmentsThisMonth: n(amendmentsThisMonth[0]?.count),
          amendmentsActionedThisMonth: n(amendmentsActionedThisMonth[0]?.count),
          refundsThisMonth: n(refundsThisMonth[0]?.count),
          flightRequestsThisMonth: n(flightRequestsThisMonth[0]?.count),
          flightRequestsPending: n(flightRequestsPending[0]?.count),
          pipelineStageDistribution: pipelineStageDistribution.map((r) => ({ stage: r.stage ?? "Unknown", count: n(r.count) })),
          refundsByStage: refundsByStage.map((r) => ({ stage: r.stage ?? "Unknown", count: n(r.count) })),
        },
        financials: {
          jltRevenueThisMonth: n(jltRevenueThisMonth[0]?.total),
          jltRevenuePrevMonth: n(jltRevenuePrevMonth[0]?.total),
          agentPayoutsThisMonth: n(agentPayoutsThisMonth[0]?.total),
          commissionClaimsThisMonth: n(commissionClaimsThisMonth[0]?.count),
          commissionClaimsGrossThisMonth: n(commissionClaimsThisMonth[0]?.totalGross),
          commissionClaimsPaidThisMonth: n(commissionClaimsPaidThisMonth[0]?.count),
          commissionClaimsPaidGrossThisMonth: n(commissionClaimsPaidThisMonth[0]?.totalGross),
          reimbursementsPaidThisMonth: n(reimbursementsPaidThisMonth[0]?.count),
          reimbursementsPaidTotalThisMonth: n(reimbursementsPaidThisMonth[0]?.total),
          reimbursementsScheduledCount: n(reimbursementsScheduled[0]?.count),
          reimbursementsScheduledTotal: n(reimbursementsScheduled[0]?.total),
          reimbursementsPendingCount: n(reimbursementsPending[0]?.count),
          reimbursementsPendingTotal: n(reimbursementsPending[0]?.total),
        },
        recruitment: {
          newProspectsThisMonth: n(newProspectsThisMonth[0]?.count),
          newProspectsPrevMonth: n(newProspectsPrevMonth[0]?.count),
          wonProspectsThisMonth: n(wonProspectsThisMonth[0]?.count),
          stageMovesThisMonth: n(recruitmentStageMovesThisMonth[0]?.count),
          funnel: recruitmentFunnel.map((r) => ({ stage: r.stage ?? "unknown", count: n(r.count) })),
          totalEnquiries: n(totalEnquiries[0]?.count),
          totalApplications: n(totalApplications[0]?.count),
          totalWon: n(wonAllTime[0]?.count),
          conversionRate: n(totalEnquiries[0]?.count) > 0 ? Math.round((n(wonAllTime[0]?.count) / n(totalEnquiries[0]?.count)) * 1000) / 10 : 0,
          avgTimeToSignupDays: Math.round(Number(avgTimeToSignupRaw[0]?.avgDays ?? 0) * 10) / 10,
        },
        staffProductivity,
        communications: {
          emailsSentThisMonth: n(emailsSentThisMonth[0]?.count),
          emailsSentPrevMonth: n(emailsSentPrevMonth[0]?.count),
        },
        monthlyTrend,
      };
    }),

  /**
   * Per-agent commission margin report.
   * Returns each agent's avg margin %, count below 6% threshold, and 3-month trend.
   */
  agentMarginReport: superAdminProcedure
    .input(z.object({ minBookings: z.number().default(1) }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { users, bookings, commissionClaims } = await import("../drizzle/schema");
      const { eq, sql, isNotNull, and, gte, lt } = await import("drizzle-orm");

      // Per-agent margin summary.
      // Uses COALESCE(cc.grossAmount, b.expectedCommission) so older claims without a
      // grossAmount still contribute using the booking's expectedCommission as the figure.
      const agentMargins = await db.execute(sql`
        SELECT
          u.id AS agentId,
          u.name AS agentName,
          u.email AS agentEmail,
          COUNT(DISTINCT cc.id) AS totalClaims,
          COUNT(DISTINCT CASE WHEN b.grossCost IS NOT NULL AND b.grossCost > 0
            AND COALESCE(cc.grossAmount, b.expectedCommission) IS NOT NULL THEN cc.id END) AS claimsWithMargin,
          AVG(CASE WHEN b.grossCost IS NOT NULL AND b.grossCost > 0
            AND COALESCE(cc.grossAmount, b.expectedCommission) IS NOT NULL
            THEN (COALESCE(cc.grossAmount, b.expectedCommission) / b.grossCost * 100) END) AS avgMarginPct,
          COUNT(DISTINCT CASE WHEN b.grossCost IS NOT NULL AND b.grossCost > 0
            AND COALESCE(cc.grossAmount, b.expectedCommission) IS NOT NULL
            AND (COALESCE(cc.grossAmount, b.expectedCommission) / b.grossCost * 100) < 6 THEN cc.id END) AS claimsBelowThreshold,
          COUNT(DISTINCT CASE WHEN b.grossCost IS NOT NULL AND b.grossCost > 0
            AND COALESCE(cc.grossAmount, b.expectedCommission) IS NOT NULL
            AND (COALESCE(cc.grossAmount, b.expectedCommission) / b.grossCost * 100) >= 6
            AND (COALESCE(cc.grossAmount, b.expectedCommission) / b.grossCost * 100) < 8 THEN cc.id END) AS claimsAmber,
          COUNT(DISTINCT CASE WHEN b.grossCost IS NOT NULL AND b.grossCost > 0
            AND COALESCE(cc.grossAmount, b.expectedCommission) IS NOT NULL
            AND (COALESCE(cc.grossAmount, b.expectedCommission) / b.grossCost * 100) >= 8 THEN cc.id END) AS claimsGreen,
          SUM(COALESCE(cc.grossAmount, b.expectedCommission)) AS totalGrossCommission,
          SUM(b.grossCost) AS totalGrossCost
        FROM commission_claims cc
        JOIN bookings b ON cc.bookingId = b.id
        JOIN users u ON cc.agentId = u.id
        GROUP BY u.id, u.name, u.email
        HAVING COUNT(DISTINCT cc.id) >= ${input.minBookings}
        ORDER BY avgMarginPct ASC
      `) as unknown as [Array<{
        agentId: number; agentName: string; agentEmail: string;
        totalClaims: number; claimsWithMargin: number; avgMarginPct: number | null;
        claimsBelowThreshold: number; claimsAmber: number; claimsGreen: number;
        totalGrossCommission: number; totalGrossCost: number;
      }>, unknown];
      const agentMarginRows = agentMargins[0];

      // 3-month trend per agent (last 3 calendar months)
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1, 0, 0, 0, 0);
      const monthlyMarginsRaw = await db.execute(sql`
        SELECT
          cc.agentId,
          DATE_FORMAT(cc.claimedAt, '%Y-%m') AS month,
          AVG(CASE WHEN b.grossCost IS NOT NULL AND b.grossCost > 0
            AND COALESCE(cc.grossAmount, b.expectedCommission) IS NOT NULL
            THEN (COALESCE(cc.grossAmount, b.expectedCommission) / b.grossCost * 100) END) AS avgMarginPct,
          COUNT(cc.id) AS claimCount
        FROM commission_claims cc
        JOIN bookings b ON cc.bookingId = b.id
        WHERE cc.claimedAt >= ${threeMonthsAgo}
        GROUP BY cc.agentId, DATE_FORMAT(cc.claimedAt, '%Y-%m')
        ORDER BY cc.agentId, month ASC
      `) as unknown as [Array<{ agentId: number; month: string; avgMarginPct: number | null; claimCount: number }>, unknown];
      const monthlyMargins = monthlyMarginsRaw[0];

      // Group monthly trend by agentId
      const trendByAgent = new Map<number, Array<{ month: string; avgMarginPct: number; claimCount: number }>>();
      for (const row of monthlyMargins) {
        if (!trendByAgent.has(row.agentId)) trendByAgent.set(row.agentId, []);
        trendByAgent.get(row.agentId)!.push({
          month: row.month,
          avgMarginPct: Math.round(Number(row.avgMarginPct ?? 0) * 10) / 10,
          claimCount: Number(row.claimCount),
        });
      }

      return {
        agents: agentMarginRows.map((r) => ({
          agentId: Number(r.agentId),
          agentName: r.agentName,
          agentEmail: r.agentEmail,
          totalClaims: Number(r.totalClaims),
          claimsWithMargin: Number(r.claimsWithMargin),
          avgMarginPct: r.avgMarginPct !== null ? Math.round(Number(r.avgMarginPct) * 10) / 10 : null,
          claimsBelowThreshold: Number(r.claimsBelowThreshold),
          claimsAmber: Number(r.claimsAmber),
          claimsGreen: Number(r.claimsGreen),
          totalGrossCommission: Number(r.totalGrossCommission),
          totalGrossCost: Number(r.totalGrossCost),
          // Flag: red = any below threshold, amber = all in 6-8%, green = all above 8%
          flag: Number(r.claimsBelowThreshold) > 0 ? "red" : Number(r.claimsAmber) > 0 ? "amber" : "green",
          trend: trendByAgent.get(Number(r.agentId)) ?? [],
        })),
        summary: {
          totalAgentsReported: agentMarginRows.length,
          agentsBelowThreshold: agentMarginRows.filter((r) => Number(r.claimsBelowThreshold) > 0).length,
          agentsAmber: agentMarginRows.filter((r) => Number(r.claimsBelowThreshold) === 0 && Number(r.claimsAmber) > 0).length,
          agentsGreen: agentMarginRows.filter((r) => Number(r.claimsBelowThreshold) === 0 && Number(r.claimsAmber) === 0).length,
        },
      };
    }),

  /**
   * Drill-down: open refunds with stage, agent, booking, days open, assigned admin.
   */
  drillDownRefunds: superAdminProcedure
    .input(z.object({ stage: z.string().optional(), assignedToId: z.number().optional() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { refunds, bookings, users } = await import("../drizzle/schema");
      const { eq, ne, and, sql, isNull, or } = await import("drizzle-orm");
      const conditions: ReturnType<typeof eq>[] = [ne(refunds.status, "completed")];
      if (input.stage) conditions.push(eq(refunds.pipelineStage, input.stage as typeof refunds.pipelineStage._.data));
      if (input.assignedToId) conditions.push(eq(refunds.assignedToId, input.assignedToId));
      const rows = await db
        .select({
          id: refunds.id,
          bookingId: refunds.bookingId,
          clientName: bookings.clientName,
          ptsRef: bookings.ptsRef,
          agentId: refunds.agentId,
          agentName: users.name,
          pipelineStage: refunds.pipelineStage,
          refundType: refunds.refundType,
          amountToClient: refunds.amountToClient,
          assignedToId: refunds.assignedToId,
          status: refunds.status,
          createdAt: refunds.createdAt,
          daysOpen: sql<number>`DATEDIFF(NOW(), ${refunds.createdAt})`,
        })
        .from(refunds)
        .innerJoin(bookings, eq(refunds.bookingId, bookings.id))
        .innerJoin(users, eq(refunds.agentId, users.id))
        .where(and(...conditions))
        .orderBy(sql`DATEDIFF(NOW(), ${refunds.createdAt}) DESC`);
      // Fetch assigned admin names separately
      const assignedIds1 = Array.from(new Set(rows.filter((r) => r.assignedToId).map((r) => r.assignedToId!)));
      let adminMap: Record<number, string> = {};
      if (assignedIds1.length > 0) {
        const admins = await db.select({ id: users.id, name: users.name }).from(users).where(sql`${users.id} IN (${sql.join(assignedIds1.map((id) => sql`${id}`), sql`, `)})`);
        adminMap = Object.fromEntries(admins.map((a) => [a.id, a.name ?? "Unknown"]));
      }
      return rows.map((r) => ({
        ...r,
        amountToClient: r.amountToClient ? Number(r.amountToClient) : null,
        daysOpen: Number(r.daysOpen),
        assignedAdminName: r.assignedToId ? (adminMap[r.assignedToId] ?? "Unknown") : null,
      }));
    }),

  /**
   * Drill-down: pending/scheduled reimbursements with agent, booking, amount, status.
   */
  drillDownReimbursements: superAdminProcedure
    .input(z.object({ status: z.enum(["pending", "scheduled", "paid"]).optional() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { reimbursementItems, bookings, users } = await import("../drizzle/schema");
      const { eq, and, inArray, sql, isNotNull } = await import("drizzle-orm");
      const statusFilter = input.status ? [input.status] : ["pending", "scheduled"];
      const rows = await db
        .select({
          id: reimbursementItems.id,
          bookingId: reimbursementItems.bookingId,
          clientName: bookings.clientName,
          ptsRef: bookings.ptsRef,
          agentId: reimbursementItems.agentId,
          agentName: users.name,
          supplierName: reimbursementItems.supplierName,
          amount: reimbursementItems.amount,
          status: reimbursementItems.status,
          isLate: reimbursementItems.isLate,
          jltCompanyCard: reimbursementItems.jltCompanyCard,
          scheduledAt: reimbursementItems.scheduledAt,
          paidAt: reimbursementItems.paidAt,
          assignedToId: reimbursementItems.assignedToId,
          createdAt: reimbursementItems.createdAt,
          daysOpen: sql<number>`DATEDIFF(NOW(), ${reimbursementItems.createdAt})`,
        })
        .from(reimbursementItems)
        .innerJoin(bookings, eq(reimbursementItems.bookingId, bookings.id))
        .innerJoin(users, eq(reimbursementItems.agentId, users.id))
        .where(inArray(reimbursementItems.status, statusFilter as Array<"pending" | "scheduled" | "paid">))
        .orderBy(sql`DATEDIFF(NOW(), ${reimbursementItems.createdAt}) DESC`);
      const assignedIds2 = Array.from(new Set(rows.filter((r) => r.assignedToId).map((r) => r.assignedToId!)));
      let adminMap2: Record<number, string> = {};
      if (assignedIds2.length > 0) {
        const admins2 = await db.select({ id: users.id, name: users.name }).from(users).where(sql`${users.id} IN (${sql.join(assignedIds2.map((id) => sql`${id}`), sql`, `)})`);
        adminMap2 = Object.fromEntries(admins2.map((a) => [a.id, a.name ?? "Unknown"]));
      }
      return rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        daysOpen: Number(r.daysOpen),
        assignedAdminName: r.assignedToId ? (adminMap2[r.assignedToId] ?? "Unknown") : null,
      }));
    }),

  /**
   * Drill-down: open amendments with agent, booking, assigned admin, days open.
   */
  drillDownAmendments: superAdminProcedure
    .input(z.object({ stage: z.string().optional(), assignedToId: z.number().optional() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { amendments, bookings, users } = await import("../drizzle/schema");
      const { eq, ne, and, sql } = await import("drizzle-orm");
      const conditions: ReturnType<typeof eq>[] = [ne(amendments.status, "actioned"), ne(amendments.status, "rejected")];
      if (input.stage) conditions.push(eq(amendments.pipelineStage, input.stage as typeof amendments.pipelineStage._.data));
      if (input.assignedToId) conditions.push(eq(amendments.assignedToId, input.assignedToId));
      const rows = await db
        .select({
          id: amendments.id,
          bookingId: amendments.bookingId,
          clientName: bookings.clientName,
          ptsRef: bookings.ptsRef,
          agentId: amendments.agentId,
          agentName: users.name,
          details: amendments.details,
          pipelineStage: amendments.pipelineStage,
          status: amendments.status,
          assignedToId: amendments.assignedToId,
          createdAt: amendments.createdAt,
          daysOpen: sql<number>`DATEDIFF(NOW(), ${amendments.createdAt})`,
        })
        .from(amendments)
        .innerJoin(bookings, eq(amendments.bookingId, bookings.id))
        .innerJoin(users, eq(amendments.agentId, users.id))
        .where(and(...conditions))
        .orderBy(sql`DATEDIFF(NOW(), ${amendments.createdAt}) DESC`);
      const assignedIds3 = Array.from(new Set(rows.filter((r) => r.assignedToId).map((r) => r.assignedToId!)));
      let adminMap3: Record<number, string> = {};
      if (assignedIds3.length > 0) {
        const admins3 = await db.select({ id: users.id, name: users.name }).from(users).where(sql`${users.id} IN (${sql.join(assignedIds3.map((id) => sql`${id}`), sql`, `)})`);
        adminMap3 = Object.fromEntries(admins3.map((a) => [a.id, a.name ?? "Unknown"]));
      }
      return rows.map((r) => ({
        ...r,
        daysOpen: Number(r.daysOpen),
        assignedAdminName: r.assignedToId ? (adminMap3[r.assignedToId] ?? "Unknown") : null,
      }));
    }),

  /**
   * Drill-down: pending flight ticketing requests with agent, booking, days pending.
   */
  drillDownFlightTicketing: superAdminProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { flightRequests, bookings, users } = await import("../drizzle/schema");
      const { eq, ne, and, sql } = await import("drizzle-orm");
      const statusFilter = input.status ?? "pending";
      const rows = await db
        .select({
          id: flightRequests.id,
          bookingId: flightRequests.bookingId,
          clientName: bookings.clientName,
          ptsRef: bookings.ptsRef,
          agentId: flightRequests.agentId,
          agentName: users.name,
          requestType: flightRequests.requestType,
          supplier: flightRequests.supplier,
          pnr: flightRequests.pnr,
          departureDate: flightRequests.departureDate,
          ticketingDeadline: flightRequests.ticketingDeadline,
          status: flightRequests.status,
          invoiceAddedToPts: flightRequests.invoiceAddedToPts,
          createdAt: flightRequests.createdAt,
          daysPending: sql<number>`DATEDIFF(NOW(), ${flightRequests.createdAt})`,
          daysToDeadline: sql<number>`DATEDIFF(${flightRequests.ticketingDeadline}, NOW())`,
        })
        .from(flightRequests)
        .innerJoin(bookings, eq(flightRequests.bookingId, bookings.id))
        .innerJoin(users, eq(flightRequests.agentId, users.id))
        .where(eq(flightRequests.status, statusFilter as "pending" | "ticketed" | "cancelled" | "query"))
        .orderBy(flightRequests.ticketingDeadline);
      return rows.map((r) => ({
        ...r,
        daysPending: Number(r.daysPending),
        daysToDeadline: Number(r.daysToDeadline),
      }));
    }),

});
function buildResponse(data: {
  newSignupsThisWeek: Array<{ count: number }>;
  newSignupsPrevWeek: Array<{ count: number }>;
  cancellationsThisWeek: Array<{ count: number }>;
  cancellationsPrevWeek: Array<{ count: number }>;
  totalActiveAgents: Array<{ count: number }>;
  totalPayingAgents: Array<{ count: number }>;
  tierBreakdown: Array<{ tier: string | null; count: number }>;
  inNoticeCount: Array<{ count: number }>;
  pausedCount: Array<{ count: number }>;
  activeSubscriptions: Array<{ count: number; totalAmountPence: number }>;
  totalGcSubscriptions: Array<{ count: number }>;
  paymentsConfirmedThisWeek: Array<{ count: number; totalPence: number }>;
  paymentsConfirmedPrevWeek: Array<{ count: number; totalPence: number }>;
  paymentsPaidOutThisWeek: Array<{ count: number; totalPence: number }>;
  failedPaymentsThisWeek: Array<{ count: number; totalPence: number }>;
  agentsWithFailures: Array<{ count: number; totalFailures: number }>;
  newMandatesThisWeek: Array<{ count: number }>;
  cancelledMandatesThisWeek: Array<{ count: number }>;
  newBookingsThisWeek: Array<{ count: number }>;
  newBookingsPrevWeek: Array<{ count: number }>;
  pipelineStageDistribution: Array<{ stage: string | null; count: number }>;
  pipelineMovesThisWeek: Array<{ count: number }>;
  amendmentsThisWeek: Array<{ count: number }>;
  amendmentsActionedThisWeek: Array<{ count: number }>;
  refundsThisWeek: Array<{ count: number }>;
  refundsByStage: Array<{ stage: string | null; count: number }>;
  flightRequestsThisWeek: Array<{ count: number }>;
  flightRequestsPendingCount: Array<{ count: number }>;
  pipelineDwellRaw: unknown;
  jltRevenueThisWeek: Array<{ total: number | null }>;
  jltRevenuePrevWeek: Array<{ total: number | null }>;
  agentPayoutsThisWeek: Array<{ total: number | null }>;
  commissionClaimsThisWeek: Array<{ count: number; totalGross: number }>;
  commissionClaimsPaidThisWeek: Array<{ count: number; totalGross: number }>;
  reimbursementsPaidThisWeek: Array<{ count: number; total: number }>;
  reimbursementsScheduled: Array<{ count: number; total: number }>;
  reimbursementsPending: Array<{ count: number; total: number }>;
  newProspectsThisWeek: Array<{ count: number }>;
  newProspectsPrevWeek: Array<{ count: number }>;
  wonProspectsThisWeek: Array<{ count: number }>;
  recruitmentFunnel: Array<{ stage: string | null; count: number }>;
  recruitmentStageMovesThisWeek: Array<{ count: number }>;
  staffProductivity: Array<{
    adminId: number;
    adminName: string | null;
    adminRole: string;
    pipelineMoves: number;
    tasksCompleted: number;
    tasksCreated: number;
    commissionsPaid: number;
    commissionsTotal: number;
    reimbursementsPaid: number;
    reimbursementsTotal: number;
    reimbursementsScheduled: number;
    statusChanges: number;
    bookingNotes: number;
    amendmentsActioned: number;
    recruitmentMoves: number;
    totalActions: number;
  }>;
  emailStats: {
    emailsSentThisWeek: number;
    emailsSentPrevWeek: number;
    campaignEmailsThisWeek: number;
    campaignOpenRate: number;
    campaignClickRate: number;
    campaignBounceRate: number;
    campaignsSentThisWeek: Array<{
      id: number;
      name: string;
      audienceType: string | null;
      totalRecipients: number | null;
      sentAt: Date | null;
      sentByName: string | null;
    }>;
    emailTypeBreakdown: Array<{ triggerKey: string; count: number }>;
  } | null;
}) {
  const n = (v: unknown) => Number(v ?? 0);

  // Parse pipeline dwell time from raw SQL result
  const dwellRows = Array.isArray(data.pipelineDwellRaw)
    ? (data.pipelineDwellRaw as Array<{ stage: string; avgDays: number; bookingCount: number }>)
    : [];

  return {
    // Section 1: Membership
    membership: {
      totalActiveAgents: n(data.totalActiveAgents[0]?.count),
      totalPayingAgents: n(data.totalPayingAgents[0]?.count),
      newSignupsThisWeek: n(data.newSignupsThisWeek[0]?.count),
      newSignupsPrevWeek: n(data.newSignupsPrevWeek[0]?.count),
      cancellationsThisWeek: n(data.cancellationsThisWeek[0]?.count),
      cancellationsPrevWeek: n(data.cancellationsPrevWeek[0]?.count),
      netGrowthThisWeek: n(data.newSignupsThisWeek[0]?.count) - n(data.cancellationsThisWeek[0]?.count),
      inNoticeCount: n(data.inNoticeCount[0]?.count),
      pausedCount: n(data.pausedCount[0]?.count),
      tierBreakdown: data.tierBreakdown.map((r) => ({
        tier: r.tier ?? "Unknown",
        count: n(r.count),
      })),
    },

    // Section 2: DD Revenue
    ddRevenue: {
      activeSubscriptions: n(data.activeSubscriptions[0]?.count),
      totalGcSubscriptions: n(data.totalGcSubscriptions[0]?.count),
      mrrPence: n(data.activeSubscriptions[0]?.totalAmountPence),
      mrrGbp: Math.round(n(data.activeSubscriptions[0]?.totalAmountPence) / 100),
      // Confirmed = submitted to bank by GoCardless
      paymentsConfirmedThisWeek: n(data.paymentsConfirmedThisWeek[0]?.count),
      paymentsConfirmedPrevWeek: n(data.paymentsConfirmedPrevWeek[0]?.count),
      confirmedThisWeekGbp: Math.round(n(data.paymentsConfirmedThisWeek[0]?.totalPence) / 100),
      confirmedPrevWeekGbp: Math.round(n(data.paymentsConfirmedPrevWeek[0]?.totalPence) / 100),
      // Paid out = funds landed in your bank account
      paymentsPaidOutThisWeek: n(data.paymentsPaidOutThisWeek[0]?.count),
      paidOutThisWeekGbp: Math.round(n(data.paymentsPaidOutThisWeek[0]?.totalPence) / 100),
      failedPaymentsThisWeek: n(data.failedPaymentsThisWeek[0]?.count),
      failedAmountGbp: Math.round(n(data.failedPaymentsThisWeek[0]?.totalPence) / 100),
      agentsWithConsecutiveFailures: n(data.agentsWithFailures[0]?.count),
      newMandatesThisWeek: n(data.newMandatesThisWeek[0]?.count),
      cancelledMandatesThisWeek: n(data.cancelledMandatesThisWeek[0]?.count),
    },

    // Section 3: Bookings & Pipeline
    bookings: {
      newBookingsThisWeek: n(data.newBookingsThisWeek[0]?.count),
      newBookingsPrevWeek: n(data.newBookingsPrevWeek[0]?.count),
      pipelineMovesThisWeek: n(data.pipelineMovesThisWeek[0]?.count),
      amendmentsThisWeek: n(data.amendmentsThisWeek[0]?.count),
      amendmentsActionedThisWeek: n(data.amendmentsActionedThisWeek[0]?.count),
      refundsThisWeek: n(data.refundsThisWeek[0]?.count),
      flightRequestsThisWeek: n(data.flightRequestsThisWeek[0]?.count),
      flightRequestsPending: n(data.flightRequestsPendingCount[0]?.count),
      pipelineStageDistribution: data.pipelineStageDistribution.map((r) => ({
        stage: r.stage ?? "Unknown",
        count: n(r.count),
      })),
      refundsByStage: data.refundsByStage.map((r) => ({
        stage: r.stage ?? "Unknown",
        count: n(r.count),
      })),
      pipelineDwellTime: dwellRows.map((r) => ({
        stage: r.stage,
        avgDays: Math.round(Number(r.avgDays) * 10) / 10,
        bookingCount: Number(r.bookingCount),
      })),
    },

    // Section 4: Financials
    financials: {
      jltRevenueThisWeek: Number(data.jltRevenueThisWeek[0]?.total ?? 0),
      jltRevenuePrevWeek: Number(data.jltRevenuePrevWeek[0]?.total ?? 0),
      agentPayoutsThisWeek: Number(data.agentPayoutsThisWeek[0]?.total ?? 0),
      commissionClaimsThisWeek: n(data.commissionClaimsThisWeek[0]?.count),
      commissionClaimsGrossThisWeek: Number(data.commissionClaimsThisWeek[0]?.totalGross ?? 0),
      commissionClaimsPaidThisWeek: n(data.commissionClaimsPaidThisWeek[0]?.count),
      commissionClaimsPaidGrossThisWeek: Number(data.commissionClaimsPaidThisWeek[0]?.totalGross ?? 0),
      reimbursementsPaidThisWeek: n(data.reimbursementsPaidThisWeek[0]?.count),
      reimbursementsPaidTotalThisWeek: Number(data.reimbursementsPaidThisWeek[0]?.total ?? 0),
      reimbursementsScheduledCount: n(data.reimbursementsScheduled[0]?.count),
      reimbursementsScheduledTotal: Number(data.reimbursementsScheduled[0]?.total ?? 0),
      reimbursementsPendingCount: n(data.reimbursementsPending[0]?.count),
      reimbursementsPendingTotal: Number(data.reimbursementsPending[0]?.total ?? 0),
    },

    // Section 5: Recruitment
    recruitment: {
      newProspectsThisWeek: n(data.newProspectsThisWeek[0]?.count),
      newProspectsPrevWeek: n(data.newProspectsPrevWeek[0]?.count),
      wonProspectsThisWeek: n(data.wonProspectsThisWeek[0]?.count),
      stageMovesThisWeek: n(data.recruitmentStageMovesThisWeek[0]?.count),
      funnel: data.recruitmentFunnel.map((r) => ({
        stage: r.stage ?? "unknown",
        count: n(r.count),
      })),
    },

    // Section 6: Staff Productivity
    staffProductivity: data.staffProductivity,

    // Section 7: Communications
    communications: data.emailStats,
  };
}
