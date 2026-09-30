import { adminProcedure, router } from "./_core/trpc";
import { sql } from "drizzle-orm";
import { buildPipelineHealth } from "../shared/dashboard-workboard-utils";
import { normaliseTaskIdentityEmail } from "../shared/task-identity";

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
          SUM(CASE WHEN currentStage IN ('New Booking', 'Incomplete Booking', 'Query', 'Reimb Docs Missing', 'Urgent/Reimb', 'T/O Package', 'DP') THEN 1 ELSE 0 END) AS filesToAddToPts
        FROM bookings
      `),
      // Amendment counts
      db.execute(sql`
        SELECT
          SUM(CASE WHEN pipelineStage != 'Actioned' AND isReimbursementDoc = 0 THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN (pipelineStage = 'To Do' OR pipelineStage IS NULL) AND isReimbursementDoc = 0 AND status != 'rejected' THEN 1 ELSE 0 END) AS newAmendments,
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
      // Low margin bookings (< 6%) — use orbitMarginPct if available
      db.execute(sql`
        SELECT id, clientName
        FROM bookings
        WHERE currentStage != 'Cancelled'
          AND (
            (orbitMarginPct IS NOT NULL AND orbitMarginPct < 6)
            OR (orbitMarginPct IS NULL AND grossCost IS NOT NULL AND grossCost > 0
              AND expectedCommission IS NOT NULL AND expectedCommission > 0
              AND (CAST(expectedCommission AS DECIMAL(10,2)) / CAST(grossCost AS DECIMAL(10,2))) * 100 < 6)
          )
        LIMIT 10
      `),
      // This month bookings count
      db.execute(sql`
        SELECT COUNT(*) AS count
        FROM bookings
        WHERE MONTH(createdAt) = MONTH(CURDATE())
          AND YEAR(createdAt) = YEAR(CURDATE())
      `),
      // New agent sign-ups this month (exclude admin and super-admin accounts)
      db.execute(sql`
        SELECT COUNT(*) AS count FROM join_sessions js
        INNER JOIN users u ON u.id = js.userId
        WHERE js.userId IS NOT NULL
          AND u.role = 'agent'
          AND MONTH(js.createdAt) = MONTH(CURDATE())
          AND YEAR(js.createdAt) = YEAR(CURDATE())
      `),
    ]);

    // Parse results
    // db.execute(sql`...`) with drizzle-orm/mysql2 returns [rows, fields] tuple
    // So we need to unwrap: result[0] is the rows array, result[0][0] is the first row
    const unwrap = (result: any): any[] => Array.isArray(result[0]) ? result[0] : result;
    const unwrapOne = (result: any): any => unwrap(result)[0] ?? {};

    const bc = unwrapOne(bookingCounts);
    const ac = unwrapOne(amendmentCounts);
    const rc = unwrapOne(refundCounts);
    const cc = unwrapOne(cancellationCounts);
    const ccc = unwrapOne(commissionClaimCounts);
    const reimbc = unwrapOne(reimbCounts);
    const tmc = unwrapOne(thisMonthCount);
    const nsc = unwrapOne(newSignUpsCount);

    const stageRows = unwrap(stageBreakdown);
    const stageMap: Record<string, number> = {};
    for (const row of stageRows) {
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
      upcomingDepartures: unwrap(upcomingDepartures).slice(0, 10),
      recentBookings: unwrap(recentBookings).slice(0, 6),
      missingPaymentDateBookings: unwrap(missingPaymentDate).slice(0, 5),
      commissionClaimableMissingDateBookings: unwrap(commissionClaimableMissingDate).slice(0, 5),
      lowMarginBookings: unwrap(lowMarginBookings).slice(0, 10),

      // Urgent bookings (for the attention panel)
      urgentBookings: await (async () => {
        const rows = await db.execute(sql`
          SELECT id, clientName, currentStage, agentId
          FROM bookings
          WHERE currentStage IN ('Query', 'Reimb Docs Missing', 'Urgent/Reimb')
          ORDER BY updatedAt DESC
          LIMIT 20
        `);
        return unwrap(rows);
      })(),
    };
  }),

  /**
   * Daily operational data for the Admin Dashboard. This is intentionally a
   * compact internal workboard payload rather than a copy of each specialist
   * page's entire dataset.
   */
  workboard: adminProcedure.query(async ({ ctx }) => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const unwrap = (result: any): any[] => Array.isArray(result[0]) ? result[0] : result;
    const unwrapOne = (result: any): any => unwrap(result)[0] ?? {};
    const now = new Date();
    const taskOwnerEmail = normaliseTaskIdentityEmail(ctx.user.email);

    const [
      myTasksResult,
      teamTasksResult,
      unreadMessagesResult,
      unreadMessageCountResult,
      controlCountsResult,
      ptsMissingResult,
      claimableMissingResult,
      missedMandatesResult,
      todayCalendarResult,
      queueHealthResult,
      pipelineRowsResult,
      membershipSummaryResult,
      membershipWatchResult,
      changeRequestsResult,
      changeRequestCountResult,
      agentWinsResult,
      adminUsersResult,
    ] = await Promise.all([
      db.execute(sql`
        SELECT t.id, t.title, t.status, t.priority, t.dueDate, t.acknowledgedAt,
               t.createdFrom, t.linkedType, t.linkedId, t.createdAt,
               assignee.name AS assigneeName, b.clientName AS linkedBookingClientName
        FROM admin_tasks t
        LEFT JOIN users assignee ON assignee.id = t.assigneeId
        LEFT JOIN users creator ON creator.id = t.createdById
        LEFT JOIN bookings b ON t.linkedType = 'booking' AND b.id = t.linkedId
        WHERE t.status != 'done'
          AND (
            t.assigneeId = ${ctx.user.id}
            OR (t.assigneeId IS NULL AND t.createdById = ${ctx.user.id})
            OR (${taskOwnerEmail} != '' AND LOWER(TRIM(assignee.email)) = ${taskOwnerEmail})
            OR (${taskOwnerEmail} != '' AND t.assigneeId IS NULL AND LOWER(TRIM(creator.email)) = ${taskOwnerEmail})
          )
        ORDER BY
          CASE WHEN t.dueDate IS NOT NULL AND t.dueDate < NOW() THEN 0
               WHEN t.acknowledgedAt IS NULL THEN 1
               WHEN DATE(t.dueDate) = CURDATE() THEN 2
               ELSE 3 END,
          t.dueDate IS NULL,
          t.dueDate ASC,
          t.createdAt DESC
        LIMIT 6
      `),
      db.execute(sql`
        SELECT t.id, t.title, t.status, t.priority, t.dueDate, t.acknowledgedAt,
               t.createdFrom, t.linkedType, t.linkedId, t.createdAt,
               assignee.name AS assigneeName, b.clientName AS linkedBookingClientName
        FROM admin_tasks t
        LEFT JOIN users assignee ON assignee.id = t.assigneeId
        LEFT JOIN bookings b ON t.linkedType = 'booking' AND b.id = t.linkedId
        WHERE t.status != 'done'
          AND (t.assigneeId IS NULL OR t.dueDate < NOW())
        ORDER BY
          CASE WHEN t.assigneeId IS NULL THEN 0 ELSE 1 END,
          CASE WHEN t.dueDate IS NOT NULL AND t.dueDate < NOW() THEN 0 ELSE 1 END,
          t.dueDate IS NULL,
          t.dueDate ASC,
          t.createdAt ASC
        LIMIT 6
      `),
      db.execute(sql`
        SELECT n.bookingId, b.clientName, agent.name AS agentName, n.content AS latestMessage,
               n.createdAt AS latestMessageAt, n.tag, COUNT(*) AS unreadCount
        FROM notes n
        INNER JOIN users author ON author.id = n.authorId
        INNER JOIN bookings b ON b.id = n.bookingId
        LEFT JOIN users agent ON agent.id = b.agentId
        WHERE n.isInternal = 0
          AND n.isReadByAdmin = 0
          AND author.role = 'agent'
          AND n.content NOT LIKE '[System]%'
        GROUP BY n.bookingId, b.clientName, agent.name, n.content, n.createdAt, n.tag
        ORDER BY n.createdAt ASC
        LIMIT 5
      `),
      db.execute(sql`
        SELECT COUNT(DISTINCT n.bookingId) AS count
        FROM notes n
        INNER JOIN users author ON author.id = n.authorId
        WHERE n.isInternal = 0
          AND n.isReadByAdmin = 0
          AND author.role = 'agent'
          AND n.content NOT LIKE '[System]%'
      `),
      db.execute(sql`
        SELECT
          SUM(CASE WHEN b.currentStage NOT IN ('Cancelled', 'Commission Claimable')
                        AND b.finalSupplierPaymentDate IS NULL
                        AND b.paymentDateDismissed = 0 THEN 1 ELSE 0 END) AS ptsMissingCount,
          SUM(CASE WHEN b.currentStage = 'Commission Claimable'
                        AND b.finalSupplierPaymentDate IS NULL
                        AND b.paymentDateDismissed = 0 THEN 1 ELSE 0 END) AS claimableMissingCount
        FROM bookings b
      `),
      db.execute(sql`
        SELECT id, clientName, currentStage
        FROM bookings
        WHERE currentStage NOT IN ('Cancelled', 'Commission Claimable')
          AND finalSupplierPaymentDate IS NULL
          AND paymentDateDismissed = 0
        ORDER BY createdAt ASC
        LIMIT 4
      `),
      db.execute(sql`
        SELECT id, clientName, currentStage
        FROM bookings
        WHERE currentStage = 'Commission Claimable'
          AND finalSupplierPaymentDate IS NULL
          AND paymentDateDismissed = 0
        ORDER BY createdAt ASC
        LIMIT 4
      `),
      db.execute(sql`
        SELECT m.userId, u.name AS userName, u.email AS userEmail, m.mandateId,
               p.membershipTier
        FROM gc_mandates m
        INNER JOIN users u ON u.id = m.userId
        LEFT JOIN agent_crm_profiles p ON p.userId = m.userId
        LEFT JOIN gc_subscriptions s ON s.userId = m.userId
        WHERE m.status = 'active' AND s.id IS NULL
        ORDER BY u.name ASC
        LIMIT 4
      `),
      db.execute(sql`
        SELECT e.id, e.title, e.type, e.startDate, e.endDate, e.allDay,
               e.assigneeId, u.name AS assigneeName, e.dueDate
        FROM calendar_events e
        LEFT JOIN users u ON u.id = e.assigneeId
        WHERE (
          (e.recurrenceRule = 'none' AND e.startDate <= DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND e.endDate >= CURDATE())
          OR (e.recurrenceRule = 'daily' AND e.startDate <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
              AND (e.recurrenceEndDate IS NULL OR e.recurrenceEndDate >= CURDATE()))
          OR (e.recurrenceRule = 'weekly' AND WEEKDAY(e.startDate) = WEEKDAY(CURDATE())
              AND e.startDate <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
              AND (e.recurrenceEndDate IS NULL OR e.recurrenceEndDate >= CURDATE()))
          OR (e.recurrenceRule = 'monthly' AND DAY(e.startDate) = DAY(CURDATE())
              AND e.startDate <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
              AND (e.recurrenceEndDate IS NULL OR e.recurrenceEndDate >= CURDATE()))
          OR (e.recurrenceRule = 'yearly' AND DATE_FORMAT(e.startDate, '%m-%d') = DATE_FORMAT(CURDATE(), '%m-%d')
              AND e.startDate <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
              AND (e.recurrenceEndDate IS NULL OR e.recurrenceEndDate >= CURDATE()))
        )
        ORDER BY e.allDay DESC, e.startDate ASC
        LIMIT 10
      `),
      db.execute(sql`
        SELECT 'Amendments' AS label, '/amendments/pipeline' AS href,
               COUNT(*) AS count, DATEDIFF(CURDATE(), MIN(createdAt)) AS oldestAgeDays,
               SUM(CASE WHEN createdAt < DATE_SUB(CURDATE(), INTERVAL 3 DAY) THEN 1 ELSE 0 END) AS overTargetCount
        FROM amendments
        WHERE pipelineStage != 'Actioned' AND isReimbursementDoc = 0
        UNION ALL
        SELECT 'Refunds', '/refunds/pipeline', COUNT(*), DATEDIFF(CURDATE(), MIN(createdAt)),
               SUM(CASE WHEN createdAt < DATE_SUB(CURDATE(), INTERVAL 3 DAY) THEN 1 ELSE 0 END)
        FROM refunds WHERE pipelineStage != 'Refund Processed'
        UNION ALL
        SELECT 'Reimbursements', '/admin/reimbursements', COUNT(*), DATEDIFF(CURDATE(), MIN(createdAt)),
               SUM(CASE WHEN createdAt < DATE_SUB(CURDATE(), INTERVAL 3 DAY) THEN 1 ELSE 0 END)
        FROM reimbursement_items WHERE status IN ('pending', 'awaiting_agent')
        UNION ALL
        SELECT 'Cancellations', '/pipeline', COUNT(*), DATEDIFF(CURDATE(), MIN(confirmedAt)),
               SUM(CASE WHEN confirmedAt < DATE_SUB(CURDATE(), INTERVAL 3 DAY) THEN 1 ELSE 0 END)
        FROM cancellations WHERE status != 'actioned'
        UNION ALL
        SELECT 'Flight requests', '/flights', COUNT(*), DATEDIFF(CURDATE(), MIN(createdAt)),
               SUM(CASE WHEN createdAt < DATE_SUB(CURDATE(), INTERVAL 3 DAY) THEN 1 ELSE 0 END)
        FROM flight_requests WHERE status NOT IN ('ticketed', 'cancelled', 'completed')
        UNION ALL
        SELECT 'Commission claims', '/commissions-admin', COUNT(*), DATEDIFF(CURDATE(), MIN(createdAt)),
               SUM(CASE WHEN createdAt < DATE_SUB(CURDATE(), INTERVAL 3 DAY) THEN 1 ELSE 0 END)
        FROM commission_claims WHERE status = 'processing'
      `),
      db.execute(sql`
        SELECT b.id, b.clientName, b.currentStage,
               COALESCE((
                 SELECT MAX(h.movedAt)
                 FROM pipeline_history h
                 WHERE h.bookingId = b.id AND h.toStage = b.currentStage
               ), b.createdAt) AS stageEntered
        FROM bookings b
        WHERE b.currentStage != 'Cancelled'
      `),
      db.execute(sql`
        SELECT
          SUM(CASE WHEN agentStatus = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN agentStatus = 'paused' THEN 1 ELSE 0 END) AS paused,
          SUM(CASE WHEN agentStatus = 'in_notice' THEN 1 ELSE 0 END) AS inNotice,
          SUM(CASE WHEN agentStatus = 'suspended' THEN 1 ELSE 0 END) AS suspended
        FROM agent_crm_profiles
      `),
      db.execute(sql`
        SELECT p.userId, p.agentStatus, p.noticeEndsAt, p.pauseEndsAt,
               u.name, p.uniqueAgentId
        FROM agent_crm_profiles p
        INNER JOIN users u ON u.id = p.userId
        WHERE (p.agentStatus = 'in_notice' AND p.noticeEndsAt IS NOT NULL AND p.noticeEndsAt <= DATE_ADD(CURDATE(), INTERVAL 14 DAY))
           OR (p.agentStatus = 'paused' AND p.pauseEndsAt IS NOT NULL AND p.pauseEndsAt <= DATE_ADD(CURDATE(), INTERVAL 14 DAY))
        ORDER BY COALESCE(p.noticeEndsAt, p.pauseEndsAt) ASC
        LIMIT 8
      `),
      db.execute(sql`
        SELECT r.id, r.fieldLabel, r.createdAt, u.name AS agentName
        FROM agent_change_requests r
        INNER JOIN users u ON u.id = r.userId
        WHERE r.status = 'pending'
        ORDER BY r.createdAt ASC
        LIMIT 5
      `),
      db.execute(sql`SELECT COUNT(*) AS count FROM agent_change_requests WHERE status = 'pending'`),
      db.execute(sql`
        SELECT id, authorName, title, createdAt
        FROM community_posts
        WHERE category = 'agent_win'
          AND isHidden = 0
          AND isDraft = 0
          AND (expiresAt IS NULL OR expiresAt >= NOW())
        ORDER BY createdAt DESC
        LIMIT 5
      `),
      db.execute(sql`
        SELECT id, name, email
        FROM users
        WHERE role IN ('admin', 'super_admin')
        ORDER BY name ASC
      `),
    ]);

    const controls = unwrapOne(controlCountsResult);
    const membership = unwrapOne(membershipSummaryResult);
    const changeRequests = unwrapOne(changeRequestCountResult);
    const todayEvents = unwrap(todayCalendarResult);
    const membershipWatch = unwrap(membershipWatchResult).map((row) => ({
      ...row,
      endDate: row.noticeEndsAt ?? row.pauseEndsAt,
    }));
    const adminUsersByEmail = new Map<string, { id: number; name: string }>();
    unwrap(adminUsersResult).forEach((user) => {
      const email = normaliseTaskIdentityEmail(user.email);
      const key = email || `user:${user.id}`;
      if (!adminUsersByEmail.has(key) || user.id === ctx.user.id) {
        adminUsersByEmail.set(key, { id: user.id, name: user.name ?? "" });
      }
    });

    return {
      generatedAt: now,
      myTasks: unwrap(myTasksResult),
      teamTasks: unwrap(teamTasksResult),
      unreadMessages: unwrap(unreadMessagesResult),
      unreadMessageCount: Number(unwrapOne(unreadMessageCountResult).count ?? 0),
      controls: {
        ptsMissing: { count: Number(controls.ptsMissingCount ?? 0), records: unwrap(ptsMissingResult) },
        claimableMissing: { count: Number(controls.claimableMissingCount ?? 0), records: unwrap(claimableMissingResult) },
        missedMandates: { count: unwrap(missedMandatesResult).length, records: unwrap(missedMandatesResult) },
      },
      today: {
        events: todayEvents,
        away: todayEvents.filter((event) => event.type === 'holiday'),
      },
      queues: unwrap(queueHealthResult).map((row) => ({
        ...row,
        count: Number(row.count ?? 0),
        oldestAgeDays: Number(row.oldestAgeDays ?? 0),
        overTargetCount: Number(row.overTargetCount ?? 0),
        targetDays: 3,
      })),
      pipelineHealth: buildPipelineHealth(unwrap(pipelineRowsResult), now),
      membership: {
        active: Number(membership.active ?? 0),
        paused: Number(membership.paused ?? 0),
        inNotice: Number(membership.inNotice ?? 0),
        suspended: Number(membership.suspended ?? 0),
        watch: membershipWatch,
      },
      changeRequests: {
        count: Number(changeRequests.count ?? 0),
        records: unwrap(changeRequestsResult),
      },
      agentWins: unwrap(agentWinsResult),
      adminUsers: Array.from(adminUsersByEmail.values()),
    };
  }),

  /**
   * Lightweight counts for the PortalLayout top bar.
   * Returns only numbers — no row data — so it completes in ~50ms.
   */
  urgentCounts: adminProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const unwrapOne = (result: any): any => {
      const rows = Array.isArray(result[0]) ? result[0] : result;
      return rows[0] ?? {};
    };

    const [bookingCounts, amendmentCounts, refundCounts, commissionDueCounts, reimbCounts, flightCounts, signUpCounts] =
      await Promise.all([
        db.execute(sql`
          SELECT
            SUM(CASE WHEN currentStage IN ('New Booking','Incomplete Booking','Query','Reimb Docs Missing','Urgent/Reimb','T/O Package','DP') THEN 1 ELSE 0 END) AS filesToAddToPts
          FROM bookings
        `),
        db.execute(sql`
          SELECT SUM(CASE WHEN (pipelineStage = 'To Do' OR pipelineStage IS NULL) AND isReimbursementDoc = 0 AND status != 'rejected' THEN 1 ELSE 0 END) AS newAmendments
          FROM amendments
        `),
        db.execute(sql`
          SELECT SUM(CASE WHEN pipelineStage = 'New Refund Request' THEN 1 ELSE 0 END) AS newRefunds
          FROM refunds
        `),
        db.execute(sql`
          SELECT COUNT(*) AS commissionDue
          FROM bookings
          WHERE finalSupplierPaymentDate IS NOT NULL
            AND finalSupplierPaymentDate <= CURDATE()
            AND currentStage NOT IN ('Commission Claimable','Commission Claimed','Cancelled')
            AND (isPersonalBooking IS NULL OR isPersonalBooking = 0)
        `),
        db.execute(sql`
          SELECT
            SUM(CASE WHEN status IN ('pending','awaiting_agent') THEN 1 ELSE 0 END) AS outstanding,
            SUM(CASE WHEN isLate = 1 AND actionedAt IS NULL AND status NOT IN ('scheduled','paid') THEN 1 ELSE 0 END) AS lateUnactioned
          FROM reimbursement_items
        `),
        db.execute(sql`
          SELECT COUNT(*) AS pending FROM flight_requests
          WHERE status NOT IN ('ticketed','cancelled','completed')
        `),
        db.execute(sql`
          SELECT COUNT(*) AS count FROM users
          WHERE portalStatus = 'onboarding' AND role = 'agent'
        `),
      ]);

    const bc = unwrapOne(bookingCounts);
    const ac = unwrapOne(amendmentCounts);
    const rc = unwrapOne(refundCounts);
    const cdc = unwrapOne(commissionDueCounts);
    const reimbc = unwrapOne(reimbCounts);
    const fc = unwrapOne(flightCounts);
    const sc = unwrapOne(signUpCounts);

    return {
      filesToAddToPts: Number(bc.filesToAddToPts ?? 0),
      newAmendments: Number(ac.newAmendments ?? 0),
      newRefunds: Number(rc.newRefunds ?? 0),
      commissionDueCount: Number(cdc.commissionDue ?? 0),
      outstandingReimbs: Number(reimbc.outstanding ?? 0),
      lateUnactionedCount: Number(reimbc.lateUnactioned ?? 0),
      pendingFlightCount: Number(fc.pending ?? 0),
      newSignUpsCount: Number(sc.count ?? 0),
    };
  }),
});
