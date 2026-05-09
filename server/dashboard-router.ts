import { adminProcedure, router } from "./_core/trpc";
import { sql } from "drizzle-orm";

/**
 * Dashboard stats router — returns all counts needed by the Admin Dashboard
 * in a single SQL query instead of fetching full table rows client-side.
 */
export const dashboardRouter = router({
  stats: adminProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const URGENT_STAGES = ["Query", "Reimb Docs Missing", "Urgent/Reimb"];
    const urgentIn = URGENT_STAGES.map(() => "?").join(",");

    // Run all counts in parallel
    const [
      bookingCounts,
      amendmentCounts,
      refundCounts,
      cancellationCounts,
      commissionClaimCounts,
      reimbCounts,
      upcomingDepartures,
      recentBookings,
      stageBreakdown,
      missingPaymentDate,
      commissionClaimableMissingDate,
      lowMarginBookings,
      thisMonthCount,
      newSignUpsCount,
    ] = await Promise.all([
      // Booking counts
      db.execute(sql`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN currentStage != 'Cancelled' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN currentStage = 'Commission Claimable' THEN 1 ELSE 0 END) AS commissionReady,
          SUM(CASE WHEN currentStage IN ('Query', 'Reimb Docs Missing', 'Urgent/Reimb') THEN 1 ELSE 0 END) AS urgent,
          SUM(CASE WHEN currentStage NOT IN ('Cancelled') AND finalSupplierPaymentDate IS NULL AND paymentDateDismissed = 0 AND currentStage != 'Commission Claimable' THEN 1 ELSE 0 END) AS missingPaymentDateCount,
          SUM(CASE WHEN currentStage = 'Commission Claimable' AND finalSupplierPaymentDate IS NULL AND paymentDateDismissed = 0 THEN 1 ELSE 0 END) AS commissionClaimableMissingDateCount,
          SUM(CASE WHEN currentStage IN ('New Booking', 'Not on Topdog', 'Query', 'Reimb Docs Missing', 'Urgent/Reimb', 'T/O Package', 'DP', 'Holding Accounts') THEN 1 ELSE 0 END) AS filesToAddToPts
        FROM bookings
      `),
      // Amendment counts
      db.execute(sql`
        SELECT
          SUM(CASE WHEN pipelineStage != 'Actioned' AND isReimbursementDoc = 0 THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN pipelineStage = 'To Do' AND isReimbursementDoc = 0 THEN 1 ELSE 0 END) AS newAmendments,
          SUM(CASE WHEN pipelineStage != 'Actioned' AND isReimbursementDoc = 1 THEN 1 ELSE 0 END) AS reimbAmendments
        FROM amendments
      `),
      // Refund counts
      db.execute(sql`
        SELECT
          SUM(CASE WHEN pipelineStage != 'Refund Processed' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN pipelineStage = 'New Refund Request' THEN 1 ELSE 0 END) AS newRefunds
        FROM refunds
      `),
      // Cancellation counts
      db.execute(sql`
        SELECT COUNT(*) AS pending FROM cancellations WHERE status != 'actioned'
      `),
      // Commission claim counts
      db.execute(sql`
        SELECT COUNT(*) AS pending FROM commission_claims WHERE status = 'processing'
      `),
      // Reimbursement counts
      db.execute(sql`
        SELECT
          SUM(CASE WHEN isLate = 1 AND actionedAt IS NULL AND status NOT IN ('scheduled', 'paid') THEN 1 ELSE 0 END) AS lateUnactioned,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS outstanding
        FROM reimbursement_items
      `),
      // Upcoming departures (next 14 days)
      db.execute(sql`
        SELECT id, clientName, departureDate, currentStage, agentId
        FROM bookings
        WHERE currentStage != 'Cancelled'
          AND departureDate >= CURDATE()
          AND departureDate <= DATE_ADD(CURDATE(), INTERVAL 14 DAY)
        ORDER BY departureDate ASC
        LIMIT 10
      `),
      // Recent bookings (last 6)
      db.execute(sql`
        SELECT id, clientName, currentStage, createdAt, agentId
        FROM bookings
        ORDER BY createdAt DESC
        LIMIT 6
      `),
      // Stage breakdown
      db.execute(sql`
        SELECT currentStage, COUNT(*) AS count
        FROM bookings
        GROUP BY currentStage
      `),
      // Missing payment date bookings (for urgent attention - names)
      db.execute(sql`
        SELECT id, clientName
        FROM bookings
        WHERE currentStage NOT IN ('Cancelled', 'Commission Claimable')
          AND finalSupplierPaymentDate IS NULL
          AND paymentDateDismissed = 0
        LIMIT 5
      `),
      // Commission claimable missing date
      db.execute(sql`
        SELECT id, clientName
        FROM bookings
        WHERE currentStage = 'Commission Claimable'
          AND finalSupplierPaymentDate IS NULL
          AND paymentDateDismissed = 0
        LIMIT 5
      `),
      // Low margin bookings (< 5%)
      db.execute(sql`
        SELECT id, clientName
        FROM bookings
        WHERE currentStage != 'Cancelled'
          AND grossCost IS NOT NULL AND grossCost > 0
          AND expectedCommission IS NOT NULL AND expectedCommission > 0
          AND (CAST(expectedCommission AS DECIMAL(10,2)) / CAST(grossCost AS DECIMAL(10,2))) * 100 < 5
        LIMIT 10
      `),
      // This month bookings count
      db.execute(sql`
        SELECT COUNT(*) AS count
        FROM bookings
        WHERE MONTH(createdAt) = MONTH(CURDATE())
          AND YEAR(createdAt) = YEAR(CURDATE())
      `),
      // New sign-ups count (join_sessions with userId set, created this month)
      db.execute(sql`
        SELECT COUNT(*) AS count FROM join_sessions
        WHERE userId IS NOT NULL
          AND MONTH(createdAt) = MONTH(CURDATE())
          AND YEAR(createdAt) = YEAR(CURDATE())
      `),
    ]);

    // Parse results (drizzle sql`` returns rows array)
    const bc = (bookingCounts as any[])[0] ?? {};
    const ac = (amendmentCounts as any[])[0] ?? {};
    const rc = (refundCounts as any[])[0] ?? {};
    const cc = (cancellationCounts as any[])[0] ?? {};
    const ccc = (commissionClaimCounts as any[])[0] ?? {};
    const reimbc = (reimbCounts as any[])[0] ?? {};
    const tmc = (thisMonthCount as any[])[0] ?? {};
    const nsc = (newSignUpsCount as any[])[0] ?? {};

    const stageMap: Record<string, number> = {};
    for (const row of stageBreakdown as any[]) {
      stageMap[row.currentStage] = Number(row.count);
    }

    return {
      // Booking totals
      totalBookings: Number(bc.total ?? 0),
      activeBookings: Number(bc.active ?? 0),
      commissionReady: Number(bc.commissionReady ?? 0),
      urgentCount: Number(bc.urgent ?? 0),
      missingPaymentDateCount: Number(bc.missingPaymentDateCount ?? 0),
      commissionClaimableMissingDateCount: Number(bc.commissionClaimableMissingDateCount ?? 0),
      filesToAddToPts: Number(bc.filesToAddToPts ?? 0),
      thisMonthCount: Number(tmc.count ?? 0),
      newSignUpsCount: Number(nsc.count ?? 0),

      // Amendment counts
      pendingAmendments: Number(ac.pending ?? 0),
      newAmendments: Number(ac.newAmendments ?? 0),
      reimbAmendments: Number(ac.reimbAmendments ?? 0),

      // Refund counts
      pendingRefunds: Number(rc.pending ?? 0),
      newRefunds: Number(rc.newRefunds ?? 0),

      // Cancellation counts
      pendingCancellations: Number(cc.pending ?? 0),

      // Commission claim counts
      pendingClaims: Number(ccc.pending ?? 0),

      // Reimbursement counts
      lateUnactioned: Number(reimbc.lateUnactioned ?? 0),
      outstandingReimbs: Number(reimbc.outstanding ?? 0),

      // Stage breakdown
      stageBreakdown: stageMap,

      // Lists (small, for display)
      upcomingDepartures: (upcomingDepartures as any[]).slice(0, 10),
      recentBookings: (recentBookings as any[]).slice(0, 6),
      missingPaymentDateBookings: (missingPaymentDate as any[]).slice(0, 5),
      commissionClaimableMissingDateBookings: (commissionClaimableMissingDate as any[]).slice(0, 5),
      lowMarginBookings: (lowMarginBookings as any[]).slice(0, 10),

      // Urgent bookings (for the attention panel)
      urgentBookings: await (async () => {
        const rows = await db.execute(sql`
          SELECT id, clientName, currentStage, agentId
          FROM bookings
          WHERE currentStage IN ('Query', 'Reimb Docs Missing', 'Urgent/Reimb')
          ORDER BY updatedAt DESC
          LIMIT 20
        `);
        return rows as any[];
      })(),
    };
  }),
});
