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
        adminTasks,
        agentCrmNotes,
        emailCampaigns,
        emailSends,
        agentEmails,
        flightRequests,
        recruitmentProspects,
        recruitmentStageHistory,
      } = await import("../drizzle/schema");

      const { gte, lt, lte, and, eq, sql, isNotNull, inArray, or, ne } = await import("drizzle-orm");

      const weekStartDate = new Date(input.weekStart);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 7);

      // Previous week for WoW comparison
      const prevWeekStart = new Date(weekStartDate);
      prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevWeekEnd = new Date(weekStartDate);

      // ─── SECTION 1: Membership & Retention ────────────────────────────────

      // New sign-ups this week (portalStatus changed to active this week via agentStatusEvents)
      const newSignupsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentStatusEvents)
        .where(and(
          eq(agentStatusEvents.toStatus, "active"),
          gte(agentStatusEvents.createdAt, weekStartDate),
          lt(agentStatusEvents.createdAt, weekEndDate),
        ));

      const newSignupsPrevWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentStatusEvents)
        .where(and(
          eq(agentStatusEvents.toStatus, "active"),
          gte(agentStatusEvents.createdAt, prevWeekStart),
          lt(agentStatusEvents.createdAt, prevWeekEnd),
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

      // Total active agents (snapshot at end of week)
      const totalActiveAgents = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.agentStatus, "active"));

      // Membership tier breakdown
      const tierBreakdown = await db
        .select({
          tier: agentCrmProfiles.membershipTier,
          count: sql<number>`COUNT(*)`,
        })
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.agentStatus, "active"))
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

      // Active subscriptions & MRR
      const activeSubscriptions = await db
        .select({
          count: sql<number>`COUNT(*)`,
          totalAmountPence: sql<number>`SUM(amount)`,
        })
        .from(gcSubscriptions)
        .where(eq(gcSubscriptions.status, "active"));

      // Payments confirmed this week (actual collections)
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

      // New bookings this week
      const newBookingsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bookings)
        .where(and(
          gte(bookings.createdAt, weekStartDate),
          lt(bookings.createdAt, weekEndDate),
        ));

      const newBookingsPrevWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bookings)
        .where(and(
          gte(bookings.createdAt, prevWeekStart),
          lt(bookings.createdAt, prevWeekEnd),
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

      // Refunds this week
      const refundsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(refunds)
        .where(and(
          gte(refunds.createdAt, weekStartDate),
          lt(refunds.createdAt, weekEndDate),
        ));

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

      // Reimbursements pending
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

      // Won prospects this week
      const wonProspectsThisWeek = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(recruitmentProspects)
        .where(and(
          eq(recruitmentProspects.pipelineStage, "won"),
          gte(recruitmentProspects.updatedAt, weekStartDate),
          lt(recruitmentProspects.updatedAt, weekEndDate),
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
        // Return empty staff productivity
        return buildResponse({
          newSignupsThisWeek, newSignupsPrevWeek, cancellationsThisWeek, cancellationsPrevWeek,
          totalActiveAgents, tierBreakdown, inNoticeCount, pausedCount,
          activeSubscriptions, paymentsConfirmedThisWeek, paymentsConfirmedPrevWeek,
          failedPaymentsThisWeek, agentsWithFailures, newMandatesThisWeek, cancelledMandatesThisWeek,
          newBookingsThisWeek, newBookingsPrevWeek, pipelineStageDistribution, pipelineMovesThisWeek,
          amendmentsThisWeek, refundsThisWeek, flightRequestsThisWeek, flightRequestsPendingCount,
          jltRevenueThisWeek, jltRevenuePrevWeek, agentPayoutsThisWeek,
          commissionClaimsThisWeek, commissionClaimsPaidThisWeek,
          reimbursementsPaidThisWeek, reimbursementsPending,
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

      // CRM notes written per admin
      const notesByAdmin = await db
        .select({
          adminId: agentCrmNotes.authorId,
          count: sql<number>`COUNT(*)`,
        })
        .from(agentCrmNotes)
        .where(and(
          gte(agentCrmNotes.createdAt, weekStartDate),
          lt(agentCrmNotes.createdAt, weekEndDate),
          inArray(agentCrmNotes.authorId, adminIds),
        ))
        .groupBy(agentCrmNotes.authorId);

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
        const statusChanges = statusChangesByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
        const crmNotes = notesByAdmin.find((r) => r.adminId === admin.id)?.count ?? 0;
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
          statusChanges: Number(statusChanges),
          crmNotes: Number(crmNotes),
          recruitmentMoves: Number(recruitmentMoves),
          totalActions:
            Number(pipelineMoves) +
            Number(tasksCompleted) +
            Number(commissionsPaid) +
            Number(reimbPaid) +
            Number(statusChanges) +
            Number(crmNotes) +
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
        totalActiveAgents, tierBreakdown, inNoticeCount, pausedCount,
        activeSubscriptions, paymentsConfirmedThisWeek, paymentsConfirmedPrevWeek,
        failedPaymentsThisWeek, agentsWithFailures, newMandatesThisWeek, cancelledMandatesThisWeek,
        newBookingsThisWeek, newBookingsPrevWeek, pipelineStageDistribution, pipelineMovesThisWeek,
        amendmentsThisWeek, refundsThisWeek, flightRequestsThisWeek, flightRequestsPendingCount,
        jltRevenueThisWeek, jltRevenuePrevWeek, agentPayoutsThisWeek,
        commissionClaimsThisWeek, commissionClaimsPaidThisWeek,
        reimbursementsPaidThisWeek, reimbursementsPending,
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
    .input(z.object({ metric: z.enum(["newSignups", "cancellations", "newBookings", "ddCollected", "newProspects", "jltRevenue"]) }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const {
        agentStatusEvents,
        bookings,
        gcPaymentEvents,
        recruitmentProspects,
        remittanceLines,
        remittanceBatches,
      } = await import("../drizzle/schema");
      const { gte, lt, and, eq, sql, isNotNull, inArray } = await import("drizzle-orm");

      const weeks: Array<{ label: string; start: Date; end: Date }> = [];
      const now = new Date();
      // Get Monday of current week
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
            .from(agentStatusEvents)
            .where(and(eq(agentStatusEvents.toStatus, "active"), gte(agentStatusEvents.createdAt, week.start), lt(agentStatusEvents.createdAt, week.end)));
          value = Number(r[0]?.count ?? 0);
        } else if (input.metric === "cancellations") {
          const r = await db.select({ count: sql<number>`COUNT(*)` })
            .from(agentStatusEvents)
            .where(and(inArray(agentStatusEvents.toStatus, ["cancelled", "in_notice"]), gte(agentStatusEvents.createdAt, week.start), lt(agentStatusEvents.createdAt, week.end)));
          value = Number(r[0]?.count ?? 0);
        } else if (input.metric === "newBookings") {
          const r = await db.select({ count: sql<number>`COUNT(*)` })
            .from(bookings)
            .where(and(gte(bookings.createdAt, week.start), lt(bookings.createdAt, week.end)));
          value = Number(r[0]?.count ?? 0);
        } else if (input.metric === "ddCollected") {
          const r = await db.select({ total: sql<number>`SUM(amount)` })
            .from(gcPaymentEvents)
            .where(and(eq(gcPaymentEvents.eventType, "payments_confirmed"), gte(gcPaymentEvents.occurredAt, week.start), lt(gcPaymentEvents.occurredAt, week.end), isNotNull(gcPaymentEvents.amount)));
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
});

function buildResponse(data: any) {
  const n = (v: any) => Number(v ?? 0);

  return {
    // Section 1: Membership
    membership: {
      totalActiveAgents: n(data.totalActiveAgents[0]?.count),
      newSignupsThisWeek: n(data.newSignupsThisWeek[0]?.count),
      newSignupsPrevWeek: n(data.newSignupsPrevWeek[0]?.count),
      cancellationsThisWeek: n(data.cancellationsThisWeek[0]?.count),
      cancellationsPrevWeek: n(data.cancellationsPrevWeek[0]?.count),
      netGrowthThisWeek: n(data.newSignupsThisWeek[0]?.count) - n(data.cancellationsThisWeek[0]?.count),
      inNoticeCount: n(data.inNoticeCount[0]?.count),
      pausedCount: n(data.pausedCount[0]?.count),
      tierBreakdown: (data.tierBreakdown as any[]).map((r) => ({
        tier: r.tier ?? "Unknown",
        count: n(r.count),
      })),
    },

    // Section 2: DD Revenue
    ddRevenue: {
      activeSubscriptions: n(data.activeSubscriptions[0]?.count),
      mrrPence: n(data.activeSubscriptions[0]?.totalAmountPence),
      mrrGbp: Math.round(n(data.activeSubscriptions[0]?.totalAmountPence) / 100),
      paymentsConfirmedThisWeek: n(data.paymentsConfirmedThisWeek[0]?.count),
      paymentsConfirmedPrevWeek: n(data.paymentsConfirmedPrevWeek[0]?.count),
      collectedThisWeekPence: n(data.paymentsConfirmedThisWeek[0]?.totalPence),
      collectedThisWeekGbp: Math.round(n(data.paymentsConfirmedThisWeek[0]?.totalPence) / 100),
      collectedPrevWeekGbp: Math.round(n(data.paymentsConfirmedPrevWeek[0]?.totalPence) / 100),
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
      refundsThisWeek: n(data.refundsThisWeek[0]?.count),
      flightRequestsThisWeek: n(data.flightRequestsThisWeek[0]?.count),
      flightRequestsPending: n(data.flightRequestsPendingCount[0]?.count),
      pipelineStageDistribution: (data.pipelineStageDistribution as any[]).map((r) => ({
        stage: r.stage ?? "Unknown",
        count: n(r.count),
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
      reimbursementsPendingCount: n(data.reimbursementsPending[0]?.count),
      reimbursementsPendingTotal: Number(data.reimbursementsPending[0]?.total ?? 0),
    },

    // Section 5: Recruitment
    recruitment: {
      newProspectsThisWeek: n(data.newProspectsThisWeek[0]?.count),
      newProspectsPrevWeek: n(data.newProspectsPrevWeek[0]?.count),
      wonProspectsThisWeek: n(data.wonProspectsThisWeek[0]?.count),
      stageMovesThisWeek: n(data.recruitmentStageMovesThisWeek[0]?.count),
      funnel: (data.recruitmentFunnel as any[]).map((r) => ({
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
