import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { membershipPaymentControlProcedures } from "./membership-payment-control-procedures";
import {
  DIRECT_DEBIT_CONCERN_MEMBERSHIP_STATUSES,
  isDirectDebitConcernMembership,
  resolveMembershipConcernStatus,
} from "./membership-payment-concern-policy";
import {
  users,
  agentCrmProfiles,
  gcMandates,
  gcSubscriptions,
  membershipPaymentAccounts as accounts,
  membershipPaymentObligations as obligations,
  membershipPaymentFees as fees,
  membershipPaymentOutbox as outbox,
  membershipPaymentControl as control,
  membershipPaymentInbox as inbox,
} from "../drizzle/schema";

const SCHEMA_ERROR =
  "Schema update required: membership payment issue tables/columns are unavailable. Apply the membership payment migration before reviewing issues. Automation must remain paused.";
const listInput = z.object({
  search: z.string().trim().max(200).default(""),
  filter: z
    .enum(["all", "arrears", "dd", "delivery", "review", "resolved"])
    .default("all"),
  page: z.number().int().min(1).max(100_000).default(1),
  pageSize: z.number().int().min(1).max(50).default(25),
});

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Stamp = Date | string | null;
type IssueRow = {
  userId: number;
  name: string | null;
  email: string | null;
  uniqueAgentId: string | null;
  agentStatus: string;
  portalStatus: string;
  isActive: boolean | number;
  paymentExempt: boolean | number;
  suspensionReason: string | null;
  accountPresent: number;
  failedAttempts: number;
  outstandingCount: number;
  outstandingPence: number | null;
  lastFailedAt: Stamp;
  lastSyncedAt: Stamp;
  lastError: string | null;
  historyReviewRequired: boolean | number;
  mandateId: string | null;
  mandateStatus: string | null;
  mandateUpdatedAt: Stamp;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  pendingFeeCount: number;
  pendingFeePence: number;
  feeReviewCount: number;
  deliveryIssueCount: number;
  mailPendingCount: number;
  mailAcceptedCount: number;
  ddIssue: number;
  onboardingDd: number;
  reviewIssue: number;
};

// MySQL's execute() returns [rows, fields]. Never turn a query failure into [].
async function readRows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result[0] as unknown as T[];
}

function schemaMissing(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const candidate = current as {
      code?: string;
      errno?: number;
      cause?: unknown;
    };
    if (
      ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(
        candidate.code ?? ""
      ) ||
      [1146, 1054].includes(candidate.errno ?? 0)
    )
      return true;
    current = candidate.cause;
  }
  return false;
}

async function readOnly<T>(work: (db: Db) => Promise<T>): Promise<T> {
  try {
    if (![accounts, obligations, fees, outbox, control].every(Boolean)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: SCHEMA_ERROR,
      });
    }
    const db = await getDb();
    if (!db)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Payment issues unavailable: database is not configured. No successful refresh has occurred.",
      });
    // Validate the two tables not referenced by every list query, even on an empty DB.
    await readRows(
      db,
      sql`SELECT ${control.id}, (SELECT ${obligations.id} FROM ${obligations} LIMIT 1)
      FROM ${control} LIMIT 1`
    );
    return await work(db);
  } catch (error) {
    if (schemaMissing(error))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: SCHEMA_ERROR,
        cause: error,
      });
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Unable to read membership payment issues. No successful refresh has occurred; check provider/schema health.",
      cause: error,
    });
  }
}

// One row per agent: user/profile/account are unique, and current DD records are
// selected by latest createdAt then id; audit refreshes cannot promote an old mandate. Fee/mail scalar aggregates cannot fan out.
// Historical failed events never determine today's arrears or resolved state.
function issueBase(): SQL {
  // CRM membership is authoritative; disabled Portal access does not remove a
  // suspended/paused member from DD concerns. Cancellation never forgives debt.
  const membershipStatus = sql`LOWER(TRIM(COALESCE(NULLIF(TRIM(${agentCrmProfiles.agentStatus}), ''), ${users.portalStatus})))`;
  const ddConcernMember = sql`COALESCE(${agentCrmProfiles.paymentExempt}, 0) = 0
    AND ${membershipStatus} IN (${sql.join(DIRECT_DEBIT_CONCERN_MEMBERSHIP_STATUSES.map(status => sql`${status}`), sql`, `)})`;
  const currentMember = sql`COALESCE(${agentCrmProfiles.paymentExempt}, 0) = 0
    AND ${users.portalStatus} <> 'onboarding'
    AND ${users.portalStatus} NOT IN ('cancelled', 'paused')
    AND COALESCE(${agentCrmProfiles.agentStatus}, ${users.portalStatus}) NOT IN ('cancelled', 'paused', 'departed', 'left')
    AND (${users.portalStatus} IN ('active', 'suspended', 'in_notice') OR ${users.isActive} = 1)`;
  return sql`SELECT
    ${users.id} AS userId, ${users.name} AS name, ${users.email} AS email,
    ${agentCrmProfiles.uniqueAgentId} AS uniqueAgentId,
    ${membershipStatus} AS agentStatus,
    ${users.portalStatus} AS portalStatus, ${users.isActive} AS isActive,
    COALESCE(${agentCrmProfiles.paymentExempt}, 0) AS paymentExempt,
    COALESCE(${agentCrmProfiles.suspensionReason}, ${users.suspensionReason}) AS suspensionReason,
    (${accounts.userId} IS NOT NULL) AS accountPresent,
    COALESCE(${accounts.failedAttempts}, 0) AS failedAttempts,
    COALESCE(${accounts.outstandingCount}, 0) AS outstandingCount,
    ${accounts.outstandingPence} AS outstandingPence,
    ${accounts.lastFailedAt} AS lastFailedAt, ${accounts.lastSyncedAt} AS lastSyncedAt,
    ${accounts.lastError} AS lastError,
    COALESCE(${accounts.historyReviewRequired}, 0) AS historyReviewRequired,
    ${gcMandates.mandateId} AS mandateId, ${gcMandates.status} AS mandateStatus,
    ${gcMandates.updatedAt} AS mandateUpdatedAt,
    ${gcSubscriptions.subscriptionId} AS subscriptionId, ${gcSubscriptions.status} AS subscriptionStatus,
    (SELECT COUNT(*) FROM ${fees} WHERE ${fees.userId} = ${users.id}
      AND ${fees.status} IN ('review', 'assessed', 'collection_pending', 'failed')) AS pendingFeeCount,
    (SELECT COALESCE(SUM(${fees.amountPence}), 0) FROM ${fees} WHERE ${fees.userId} = ${users.id}
      AND ${fees.status} IN ('review', 'assessed', 'collection_pending', 'failed') AND ${fees.currency} = 'GBP') AS pendingFeePence,
    (SELECT COUNT(*) FROM ${fees} WHERE ${fees.userId} = ${users.id}
      AND ${fees.status} IN ('review', 'failed')) AS feeReviewCount,
    (SELECT COUNT(*) FROM ${outbox} WHERE ${outbox.userId} = ${users.id}
      AND ${outbox.status} IN ('failed', 'review', 'ambiguous')) AS deliveryIssueCount,
    (SELECT COUNT(*) FROM ${outbox} WHERE ${outbox.userId} = ${users.id}
      AND ${outbox.status} IN ('pending', 'sending')) AS mailPendingCount,
    (SELECT COUNT(*) FROM ${outbox} WHERE ${outbox.userId} = ${users.id}
      AND ${outbox.status} = 'accepted') AS mailAcceptedCount,
    (${ddConcernMember} AND (${gcMandates.id} IS NULL OR ${gcMandates.mandateId} IS NULL
      OR ${gcMandates.status} IN ('cancelled', 'failed', 'expired', 'consumed', 'blocked', 'suspended_by_payer'))) AS ddIssue,
    (COALESCE(${agentCrmProfiles.paymentExempt}, 0) = 0 AND ${users.portalStatus} = 'onboarding'
      AND ${membershipStatus} NOT IN ('cancelled', 'departed', 'left')
      AND (${gcMandates.id} IS NULL OR ${gcMandates.mandateId} IS NULL
      OR ${gcMandates.status} IN ('cancelled', 'failed', 'expired', 'consumed', 'blocked', 'suspended_by_payer'))) AS onboardingDd,
    (COALESCE(${accounts.historyReviewRequired}, 0) = 1 OR ${accounts.lastError} IS NOT NULL
      OR (${currentMember} AND (${accounts.userId} IS NULL OR ${accounts.lastSyncedAt} IS NULL))) AS reviewIssue
    FROM ${users}
    LEFT JOIN ${agentCrmProfiles} ON ${agentCrmProfiles.userId} = ${users.id}
    LEFT JOIN ${accounts} ON ${accounts.userId} = ${users.id}
    LEFT JOIN ${gcMandates} ON ${gcMandates.id} = (
      SELECT latest_m.id FROM ${gcMandates} latest_m WHERE latest_m.userId = ${users.id}
      ORDER BY latest_m.createdAt DESC, latest_m.id DESC LIMIT 1)
    LEFT JOIN ${gcSubscriptions} ON ${gcSubscriptions.id} = (
      SELECT latest_s.id FROM ${gcSubscriptions} latest_s WHERE latest_s.userId = ${users.id}
      AND latest_s.mandateId = ${gcMandates.mandateId}
      ORDER BY latest_s.createdAt DESC, latest_s.id DESC LIMIT 1)
    WHERE ${users.role} = 'agent' OR ${agentCrmProfiles.userId} IS NOT NULL OR ${accounts.userId} IS NOT NULL`;
}

const anyIssue = sql`(outstandingCount > 0 OR ddIssue = 1 OR onboardingDd = 1 OR deliveryIssueCount > 0 OR mailPendingCount > 0 OR reviewIssue = 1 OR pendingFeeCount > 0)`;
function issueFilter(filter: z.infer<typeof listInput>["filter"]): SQL {
  switch (filter) {
    case "arrears":
      return sql`outstandingCount > 0`;
    case "dd":
      return sql`(ddIssue = 1 OR onboardingDd = 1)`;
    case "delivery":
      return sql`(deliveryIssueCount > 0 OR mailPendingCount > 0)`;
    case "review":
      return sql`(reviewIssue = 1 OR feeReviewCount > 0)`;
    case "resolved":
      return sql`accountPresent = 1 AND lastSyncedAt IS NOT NULL AND NOT ${anyIssue}`;
    default:
      return anyIssue;
  }
}
function searchFilter(search: string): SQL {
  if (!search) return sql`1 = 1`;
  // Explicit ESCAPE avoids wildcard interpretation and NO_BACKSLASH_ESCAPES differences.
  const term = `%${search.replace(/[!%_]/g, "!$&")}%`;
  return sql`(name LIKE ${term} ESCAPE '!' OR email LIKE ${term} ESCAPE '!'
    OR uniqueAgentId LIKE ${term} ESCAPE '!' OR CAST(userId AS CHAR) = ${search})`;
}

export function normalizePaymentIssue(row: IssueRow) {
  const arrears = Number(row.outstandingCount) > 0;
  const agentStatus = resolveMembershipConcernStatus(row.agentStatus, row.portalStatus);
  const departed = ["cancelled", "departed", "left"].includes(agentStatus);
  return {
    ...row,
    agentStatus,
    isActive: Boolean(Number(row.isActive)),
    paymentExempt: Boolean(Number(row.paymentExempt)),
    accountPresent: Boolean(Number(row.accountPresent)),
    historyReviewRequired: Boolean(Number(row.historyReviewRequired)),
    failedAttempts: Number(row.failedAttempts),
    outstandingCount: Number(row.outstandingCount),
    outstandingPence:
      row.outstandingPence == null ? null : Number(row.outstandingPence),
    amountUnknown: arrears && row.outstandingPence == null,
    ddIssue: Boolean(Number(row.ddIssue)) && !Number(row.paymentExempt) && isDirectDebitConcernMembership(agentStatus, row.portalStatus),
    onboardingDd: Boolean(Number(row.onboardingDd)) && !Number(row.paymentExempt) && !departed,
    reviewIssue: Boolean(Number(row.reviewIssue)),
    pendingFeeCount: Number(row.pendingFeeCount),
    pendingFeePence: Number(row.pendingFeePence),
    feeReviewCount: Number(row.feeReviewCount),
    deliveryIssueCount: Number(row.deliveryIssueCount),
    mailPendingCount: Number(row.mailPendingCount),
    mailAcceptedCount: Number(row.mailAcceptedCount),
    // "direct-debit" is a panel id, not a valid CRM tab; dd resolves to membership-payments.
    crmHref: `/crm/agents?agent=${row.userId}&tab=dd`,
  };
}

export const membershipPaymentsRouter = router({
  ...membershipPaymentControlProcedures,
  listIssues: adminProcedure.input(listInput).query(({ input }) =>
    readOnly(async db => {
      const where = sql`${issueFilter(input.filter)} AND ${searchFilter(input.search)}`;
      const [count] = await readRows<{ total: number }>(
        db,
        sql`SELECT COUNT(*) AS total FROM (${issueBase()}) issue_rows WHERE ${where}`
      );
      const total = Number(count?.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
      const page = Math.min(input.page, totalPages);
      const rows = await readRows<IssueRow>(
        db,
        sql`SELECT * FROM (${issueBase()}) issue_rows WHERE ${where}
      ORDER BY outstandingCount DESC, reviewIssue DESC, ddIssue DESC, userId ASC
      LIMIT ${input.pageSize} OFFSET ${(page - 1) * input.pageSize}`
      );
      return {
        items: rows.map(normalizePaymentIssue),
        total,
        page,
        pageSize: input.pageSize,
        totalPages,
        readAt: new Date(),
      };
    })
  ),

  overview: adminProcedure.input(z.object({})).query(() =>
    readOnly(async db => {
      const [state] = await readRows<{
        enabled: boolean | number;
        activatedAt: Stamp;
        lastEventSyncAt: Stamp;
        lastSuccessAt: Stamp;
        lastError: string | null;
        updatedAt: Stamp;
        feePolicyApproved: boolean | number;
        feeAmountPence: number;
        feeCollectionMode: string;
      }>(
        db,
        sql`SELECT ${control.enabled} AS enabled, ${control.activatedAt} AS activatedAt,
      ${control.lastEventSyncAt} AS lastEventSyncAt, ${control.lastSuccessAt} AS lastSuccessAt,
      ${control.feePolicyApproved} AS feePolicyApproved, ${control.feeAmountPence} AS feeAmountPence, ${control.feeCollectionMode} AS feeCollectionMode,
      ${control.lastError} AS lastError, ${control.updatedAt} AS updatedAt FROM ${control} WHERE ${control.id} = 1 LIMIT 1`
      );
      const [counts] = await readRows<Record<string, number>>(
        db,
        sql`SELECT
      COUNT(*) AS agents, COALESCE(SUM(${anyIssue}), 0) AS issueAgents,
      COALESCE(SUM(outstandingCount > 0), 0) AS arrearsAgents,
      COALESCE(SUM(CASE WHEN outstandingCount > 0 THEN outstandingCount ELSE 0 END), 0) AS outstandingPayments,
      COALESCE(SUM(CASE WHEN outstandingCount > 0 AND outstandingPence IS NOT NULL THEN outstandingPence ELSE 0 END), 0) AS knownOutstandingPence,
      COALESCE(SUM(outstandingCount > 0 AND outstandingPence IS NULL), 0) AS unknownAmountAgents,
      COALESCE(SUM(ddIssue = 1), 0) AS ddAgents, COALESCE(SUM(onboardingDd = 1), 0) AS onboardingDdAgents,
      COALESCE(SUM(deliveryIssueCount > 0 OR mailPendingCount > 0), 0) AS deliveryAgents,
      COALESCE(SUM(reviewIssue = 1 OR feeReviewCount > 0), 0) AS reviewAgents,
      COALESCE(SUM(accountPresent = 1 AND lastSyncedAt IS NOT NULL AND NOT ${anyIssue}), 0) AS resolvedAgents,
      COALESCE(SUM(historyReviewRequired = 1), 0) AS historicalReviewRequiredAgents,
      COALESCE(SUM(pendingFeeCount), 0) AS pendingFeeCount,
      COALESCE(SUM(pendingFeePence), 0) AS pendingFeePence,
      COALESCE(SUM(mailAcceptedCount), 0) AS mailAcceptedCount FROM (${issueBase()}) issue_rows`
      );
      const [queue] = await readRows<{ pendingEvents: number; failedEvents: number }>(
        db,
        sql`SELECT
          COALESCE(SUM(CASE WHEN ${inbox.status} = 'pending' THEN 1 ELSE 0 END), 0) AS pendingEvents,
          COALESCE(SUM(CASE WHEN ${inbox.status} = 'failed' THEN 1 ELSE 0 END), 0) AS failedEvents
          FROM ${inbox} WHERE ${inbox.status} IN ('pending', 'failed')`
      );
      const pendingEvents = Number(queue?.pendingEvents ?? 0), failedEvents = Number(queue?.failedEvents ?? 0);
      const lastSuccessAt = state?.lastSuccessAt ?? null;
      return {
        counts: Object.fromEntries(
          Object.entries(counts ?? {}).map(([key, value]) => [
            key,
            Number(value),
          ])
        ),
        health: {
          schemaReady: true,
          controlPresent: Boolean(state),
          enabled: Boolean(Number(state?.enabled ?? 0)),
          activatedAt: state?.activatedAt ?? null,
          lastEventSyncAt: state?.lastEventSyncAt ?? null,
          lastSuccessAt,
          lastError: state?.lastError ?? null,
          updatedAt: state?.updatedAt ?? null,
          pendingEvents,
          failedEvents,
          recoveryState: failedEvents || state?.lastError ? "review_required" as const
            : pendingEvents ? "in_progress" as const
            : lastSuccessAt ? "complete" as const : "waiting" as const,
          stale:
            pendingEvents > 0 || failedEvents > 0 || Boolean(state?.lastError) || !lastSuccessAt ||
            Date.now() - new Date(lastSuccessAt).getTime() >
              15 * 60 * 1000,
          feePolicyApproved: Boolean(Number(state?.feePolicyApproved ?? 0)),
          feeAmountPence: Number(state?.feeAmountPence ?? 0),
          feeCollectionMode: state?.feeCollectionMode ?? "staff_approval",
          historicalReviewComplete:
            Number(counts?.historicalReviewRequiredAgents ?? 0) === 0,
        },
        readAt: new Date(),
      };
    })
  ),

  accountDetail: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(({ input }) =>
      readOnly(async db => {
        const [row] = await readRows<IssueRow>(
          db,
          sql`SELECT * FROM (${issueBase()}) issue_rows WHERE userId = ${input.userId} LIMIT 1`
        );
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Membership payment account not found.",
          });
        const paymentRows = await readRows<{
          id: number;
          paymentId: string;
          amountPence: number | null;
          currency: string | null;
          status: string;
          lastEventAt: Stamp;
          lastFailureAt: Stamp;
        }>(
          db,
          sql`SELECT ${obligations.id} AS id, ${obligations.paymentId} AS paymentId,
      ${obligations.amountPence} AS amountPence, ${obligations.currency} AS currency,
      ${obligations.status} AS status, ${obligations.lastEventAt} AS lastEventAt,
      ${obligations.lastFailureAt} AS lastFailureAt FROM ${obligations}
      WHERE ${obligations.userId} = ${input.userId} ORDER BY ${obligations.lastEventAt} DESC, ${obligations.id} DESC LIMIT 21`
        );
        const feeRows = await readRows<{
          id: number;
          runKey: string;
          triggerEventId: string;
          paymentId: string | null;
          amountPence: number;
          currency: string;
          status: string;
          updatedAt: Stamp;
        }>(
          db,
          sql`SELECT ${fees.id} AS id, ${fees.runKey} AS runKey, ${fees.triggerEventId} AS triggerEventId,
      ${fees.paymentId} AS paymentId, ${fees.amountPence} AS amountPence, ${fees.currency} AS currency,
      ${fees.status} AS status, ${fees.updatedAt} AS updatedAt FROM ${fees}
      WHERE ${fees.userId} = ${input.userId} ORDER BY ${fees.updatedAt} DESC, ${fees.id} DESC LIMIT 21`
        );
        const mailRows = await readRows<{
          id: number;
          eventId: string | null;
          kind: string;
          status: string;
          attempts: number;
          lastError: string | null;
          providerMessageId: string | null;
          updatedAt: Stamp;
        }>(
          db,
          sql`SELECT ${outbox.id} AS id, ${outbox.eventId} AS eventId, ${outbox.kind} AS kind,
      ${outbox.status} AS status, ${outbox.attempts} AS attempts, ${outbox.lastError} AS lastError,
      ${outbox.providerMessageId} AS providerMessageId, ${outbox.updatedAt} AS updatedAt FROM ${outbox}
      WHERE ${outbox.userId} = ${input.userId} ORDER BY ${outbox.updatedAt} DESC, ${outbox.id} DESC LIMIT 21`
        );
        return {
          account: normalizePaymentIssue(row),
          payments: paymentRows.slice(0, 20),
          fees: feeRows.slice(0, 20),
          mail: mailRows.slice(0, 20),
          truncated: {
            payments: paymentRows.length > 20,
            fees: feeRows.length > 20,
            mail: mailRows.length > 20,
          },
        };
      })
    ),
});
