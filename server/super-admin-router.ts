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
      const paymentsPaidOutThisWeek = await db
        .select({
          count: sql<number>`COUNT(*)`,
          totalPence: sql<number>`SUM(amount)`,
        })
        .from(gcPaymentEvents)
        .where(and(
          eq(gcPaymentEvents.eventType, "payments_paid_out"),
          gte(gcPaymentEvents.occurredAt, weekStartDate),
          lt(gcPaymentEvents.occurredAt, weekEndDate),
          isNotNull(gcPaymentEvents.amount),
        ));

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
