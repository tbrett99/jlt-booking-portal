import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  users,
  agentCrmProfiles,
  membershipPaymentControl as controlTable,
  membershipPaymentAccounts as accountTable,
  membershipPaymentInbox as inboxTable,
  membershipPaymentObligations as obligationTable,
  membershipPaymentFees as feeTable,
  membershipPaymentOutbox as outboxTable,
  membershipPaymentSettlements as settlementTable,
} from "../drizzle/schema";
import { getDb } from "./db";
import { areNotificationsPaused } from "./db";
import { sendDirectEmail, sendSupportEmail } from "./email";
import {
  selectCorrespondenceAddress,
  isUsableCorrespondenceEmail,
} from "./agent-correspondence";
import {
  reduceMembershipPaymentEvents,
  type MembershipPaymentFailure,
  type MembershipPaymentPolicyResult,
} from "./membership-payment-policy";

export type RecordMembershipPaymentEventInput = {
  eventId: string;
  userId: number;
  paymentId: string;
  subscriptionId?: string | null;
  mandateId?: string | null;
  action: string;
  occurredAt: Date | string;
  amountPence?: number | null;
  currency?: string | null;
  willAttemptRetry?: boolean | null;
  reason?: string | null;
  source: string;
  rawPayload: string | Record<string, unknown>;
  /** Original provider resource type; callers must verify membership ownership. */
  resource_type?: string;
};
export type ManualMembershipSettlementInput = {
  userId: number;
  paymentId: string;
  reference: string;
  notes: string;
  actorId: number;
  settledAt: Date | string;
  /** When supplied, must equal the entire known outstanding obligation. */
  amountPence?: number;
};

type Control = typeof controlTable.$inferSelect;
type Account = typeof accountTable.$inferSelect;
type Inbox = typeof inboxTable.$inferSelect;
type Obligation = typeof obligationTable.$inferInsert;
type Fee = typeof feeTable.$inferSelect;
type Outbox = typeof outboxTable.$inferSelect;
type Settlement = typeof settlementTable.$inferSelect;
type User = typeof users.$inferSelect;
type Profile = typeof agentCrmProfiles.$inferSelect;
type Intent = {
  version: 1;
  kind: "failure" | "failure_support" | "suspension_support" | "receipt";
  eventId: string;
  paymentId: string;
  failureCount?: number;
  runKey?: string;
  action: string;
  occurredAt: string;
  amountPence: number | null;
  currency: string | null;
  reason: string | null;
  willAttemptRetry: boolean | null;
  /** Set once under lease, before the first provider request. Never re-render on retry. */
  rendered?: FrozenMembershipEmail;
};
export type FrozenMembershipEmail = {
  toEmail: string;
  toName: string;
  subject: string;
  html: string;
  /** Audit association only; never reroute this frozen address from a user ID. */
  auditUserId?: number;
};
export type MembershipAccountSnapshot = {
  account: Account;
  control: Control | null;
  user: User | null;
  profile: Profile | null;
  events: Inbox[];
  settlements: Settlement[];
  fees: Fee[];
};
export type MembershipPaymentTransaction = {
  load(): Promise<MembershipAccountSnapshot>;
  saveAccount(value: Partial<Account>): Promise<void>;
  saveObligation(value: Obligation): Promise<void>;
  getObligation(
    paymentId: string
  ): Promise<typeof obligationTable.$inferSelect | null>;
  insertFee(value: typeof feeTable.$inferInsert): Promise<void>;
  insertOutbox(value: typeof outboxTable.$inferInsert): Promise<void>;
  markProcessed(ids: number[], at: Date): Promise<void>;
  suspend(at: Date): Promise<boolean>;
  mirrorLegacy(
    result: MembershipPaymentPolicyResult,
    autoSuspendedAt: Date | null
  ): Promise<void>;
  insertSettlement(
    value: typeof settlementTable.$inferInsert
  ): Promise<Settlement>;
  getOutbox(id: number): Promise<Outbox | null>;
  /** SQL CAS must include lockToken; callers check its result before continuing. */
  updateOutbox(
    id: number,
    value: Partial<Outbox>,
    expectedToken?: string | null
  ): Promise<boolean>;
};
export type MembershipPaymentStore = {
  recordEvent(value: typeof inboxTable.$inferInsert): Promise<void>;
  transaction<T>(
    userId: number,
    work: (tx: MembershipPaymentTransaction) => Promise<T>
  ): Promise<T>;
  pendingUserIds(limit: number): Promise<number[]>;
  outboxCandidates(now: Date, limit: number): Promise<Outbox[]>;
  health(value: {
    lastError: string | null;
    lastSuccessAt?: Date;
  }): Promise<void>;
  accountError(userId: number, error: string): Promise<void>;
};
export type MembershipPaymentDependencies = {
  store: MembershipPaymentStore;
  now?: () => Date;
  token?: () => string;
  notificationsPaused?: () => Promise<boolean>;
  sendAgent?: (
    input: FrozenMembershipEmail & { idempotencyKey: string }
  ) => Promise<{
    success: boolean;
    error?: string;
    providerMessageId?: string;
    /** Only use when provider positively confirms no acceptance occurred. */
    definitivelyRejected?: boolean;
  }>;
  sendSupport?: (
    input: FrozenMembershipEmail & { idempotencyKey: string }
  ) => Promise<{
    success: boolean;
    error?: string;
    providerMessageId?: string;
    definitivelyRejected?: boolean;
  }>;
};
export type MembershipAccountProcessingResult = {
  userId: number;
  processedEvents: number;
  suspended: boolean;
  failedAttempts: number;
  outstandingCount: number;
  outstandingPence: number | null;
  historyReviewRequired: boolean;
};

const LEASE_MS = 5 * 60 * 1000;
// Leave a safety margin before Resend's 24-hour idempotency retention expires.
const SAFE_DEDUPE_MS = 23 * 60 * 60 * 1000;
const mailKinds = [
  "failure",
  "failure_support",
  "suspension_support",
  "receipt",
];
function date(value: string | Date): Date {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime()))
    throw new Error("Invalid membership payment timestamp");
  return result;
}
function id(value: string, name: string, max = 100): string {
  if (!value || value !== value.trim() || value.length > max)
    throw new Error(`Invalid ${name}`);
  return value;
}
function userId(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Invalid user ID");
}
function amount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)
    throw new Error("Invalid payment amount in pence");
}
function boundedLimit(value: number, max: number): number {
  if (!Number.isFinite(value)) throw new Error("Invalid worker limit");
  return Math.min(max, Math.max(0, Math.floor(value)));
}
function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2000
  );
}
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!
  );
}
function policy(
  snapshot: MembershipAccountSnapshot
): MembershipPaymentPolicyResult {
  return reduceMembershipPaymentEvents(
    snapshot.events
      .filter(e => e.paymentId && e.status !== "ignored")
      .map(e => ({
        eventId: e.eventId,
        paymentId: e.paymentId!,
        action: e.action,
        occurredAt: e.occurredAt,
        amount: e.amountPence ?? undefined,
        currency: e.currency ?? undefined,
      })),
    {
      manualSettlements: snapshot.settlements.map(s => ({
        settlementId: `settlement:${s.id}`,
        paymentId: s.paymentId,
        occurredAt: s.settledAt,
      })),
    }
  );
}
function future(
  event: Pick<Inbox, "occurredAt">,
  control: Control | null
): boolean {
  return (
    !!control?.activatedAt &&
    event.occurredAt.getTime() >= control.activatedAt.getTime()
  );
}
function bulkHistory(event: Inbox): boolean {
  return ["history", "historical", "backfill", "bulk_history"].includes(
    event.source
  );
}
function liveEffect(event: Inbox, control: Control | null): boolean {
  return !!control?.enabled && future(event, control) && !bulkHistory(event);
}
function canSuspend(snapshot: MembershipAccountSnapshot): boolean {
  const { user, profile } = snapshot;
  return (
    !!user &&
    !!profile &&
    user.role === "agent" &&
    !profile.paymentExempt &&
    user.isActive &&
    user.portalStatus === "active" &&
    profile.agentStatus === "active" &&
    !user.suspensionReason &&
    !profile.suspensionReason
  );
}
function canCorrespond(snapshot: MembershipAccountSnapshot): boolean {
  const { user, profile } = snapshot;
  if (!user || !profile || user.role !== "agent" || profile.paymentExempt)
    return false;
  if (["cancelled", "in_notice", "onboarding"].includes(user.portalStatus))
    return false;
  if (
    ["cancelled", "departed", "left", "in_notice"].includes(
      profile.agentStatus ?? ""
    )
  )
    return false;
  // Suspended agents still receive every failed-attempt notice, even isActive=false.
  return (
    user.isActive ||
    user.portalStatus === "suspended" ||
    profile.agentStatus === "suspended"
  );
}
function balance(result: MembershipPaymentPolicyResult): number | null {
  if (!result.outstandingPaymentCount) return 0;
  if (
    !result.outstandingAmountsComplete ||
    Object.keys(result.knownOutstandingAmounts).some(c => c !== "GBP")
  )
    return null;
  return result.knownOutstandingAmounts.GBP ?? 0;
}
function intent(
  event: Inbox,
  kind: Intent["kind"],
  failure?: MembershipPaymentFailure
): Intent {
  return {
    version: 1,
    kind,
    eventId: event.eventId,
    paymentId: event.paymentId!,
    ...(failure
      ? { failureCount: failure.failureCount, runKey: failure.runKey }
      : {}),
    action: event.action,
    occurredAt: event.occurredAt.toISOString(),
    amountPence: event.amountPence,
    currency: event.currency,
    reason: event.reason,
    willAttemptRetry: event.willAttemptRetry,
  };
}
function feeKey(user: number, runKey: string): string {
  if (runKey.startsWith(`${user}:membership:`) && runKey.length <= 100)
    return runKey;
  const key = `${user}:${runKey}`;
  return key.length <= 100
    ? key
    : `${user}:membership:${createHash("sha256").update(runKey).digest("hex")}`;
}
function money(pence: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    pence / 100
  );
}
function render(
  value: Intent,
  snapshot: MembershipAccountSnapshot
): FrozenMembershipEmail {
  const support = value.kind.endsWith("support");
  const user = snapshot.user;
  const profile = snapshot.profile;
  const name = user?.name?.trim() || "Agent";
  const recipient = support
    ? { email: "support@thejltgroup.co.uk" }
    : selectCorrespondenceAddress({
        kind: profile?.correspondenceEmailKind,
        jltEmail: profile?.jltEmail,
        personalEmail: profile?.personalEmail,
        businessEmail: profile?.businessEmail,
        loginEmail: user?.email,
      });
  if (!isUsableCorrespondenceEmail(recipient.email))
    throw new Error(
      "No valid operational correspondence email; staff review required"
    );
  const actualSuspended =
    user?.portalStatus === "suspended" || profile?.agentStatus === "suspended";
  let subject: string;
  let body: string;
  const paymentAmount =
    value.amountPence !== null && value.currency
      ? ` (${escape(money(value.amountPence, value.currency))})`
      : "";
  if (value.kind === "receipt") {
    subject = "JLT Group — Membership Payment Confirmed";
    body = `<p>Hi ${escape(name)},</p><p>Your membership payment${paymentAmount} was confirmed on ${escape(value.occurredAt)}.</p><p>Payment reference: ${escape(value.paymentId)}.</p>`;
  } else if (value.kind === "suspension_support") {
    subject = `Agent auto-suspended for non-payment: ${name}`;
    body = `<p>Agent ${escape(name)} (user ${snapshot.account.userId}) was automatically suspended for membership arrears.</p><p>Trigger: ${escape(value.eventId)}; recorded failed attempt ${value.failureCount}.</p><p>Current portal status: ${escape(user?.portalStatus ?? "unknown")}; CRM status: ${escape(profile?.agentStatus ?? "unknown")}.</p>`;
  } else {
    subject = support
      ? `Membership payment failure: ${name} — attempt ${value.failureCount}`
      : `Membership Payment ${value.action === "charged_back" ? "Charged Back" : "Failed"} — Attempt ${value.failureCount}`;
    body = `<p>${support ? `Agent ${escape(name)} (user ${snapshot.account.userId})` : `Hi ${escape(name)},`}</p><p>Your membership payment${paymentAmount} was ${value.action === "charged_back" ? "charged back" : "unsuccessful"} on ${escape(value.occurredAt)}.</p><p>This was failed attempt <strong>${value.failureCount}</strong> in the recorded arrears run. Payment reference: ${escape(value.paymentId)}.</p>`;
    if (value.reason) body += `<p>Reason: ${escape(value.reason)}.</p>`;
    const state = policy(snapshot);
    if (actualSuspended)
      body +=
        "<p><strong>Your portal access is currently suspended.</strong> Please contact memberships to discuss your account. Settling a payment does not automatically restore access.</p>";
    else if (!state.outstandingPaymentCount)
      body +=
        "<p>The membership payment arrears recorded on your account are now clear. This notice records the earlier failed attempt; it does not change your current portal status.</p>";
    else if (canSuspend(snapshot))
      body +=
        "<p>Your account currently has outstanding membership payments. Three failed attempts in an unresolved arrears run may result in suspension of portal access.</p>";
    else
      body += `<p>Your current portal status is ${escape(user?.portalStatus ?? "unknown")}. Please contact memberships about the outstanding payment.</p>`;
    // Do not infer retry timing from a payment's current resource status.
    if (
      value.willAttemptRetry === true &&
      state.outstandingPaymentIds.includes(value.paymentId)
    ) {
      body +=
        "<p>The provider indicated that it intended to retry this payment at the time of this event. Contact memberships to confirm the current collection arrangements.</p>";
    }
    const fee = snapshot.fees.find(
      f =>
        value.runKey &&
        f.runKey === feeKey(snapshot.account.userId, value.runKey) &&
        ["assessed", "collection_pending", "paid"].includes(f.status)
    );
    if (fee && value.failureCount! >= 2)
      body += `<p>An administration fee of ${escape(money(fee.amountPence, fee.currency))} has been assessed for this arrears run.${fee.status === "paid" ? " It has been paid." : " Collection arrangements are subject to staff approval; no collection is confirmed by this notice."}</p>`;
  }
  body +=
    '<p>Contact <a href="mailto:memberships@thejltgroup.co.uk">memberships@thejltgroup.co.uk</a> with any questions.</p>';
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escape(subject)}</title></head><body style="font-family:Arial,sans-serif;color:#1a1a2e"><main style="max-width:600px;margin:auto;padding:24px"><h1>JLT Group</h1>${body}</main></body></html>`;
  return {
    toEmail: recipient.email,
    toName: support ? "JLT Support" : name,
    subject,
    html,
    auditUserId: snapshot.account.userId,
  };
}

/** Injectable repository and mail transports keep tests entirely off the database/provider. */
export function createMembershipPaymentService(
  deps: MembershipPaymentDependencies
) {
  const now = deps.now ?? (() => new Date());
  const token = deps.token ?? randomUUID;
  const paused = deps.notificationsPaused ?? areNotificationsPaused;
  const sendAgent =
    deps.sendAgent ??
    (async (email: FrozenMembershipEmail & { idempotencyKey: string }) =>
      // Do NOT pass userId: sendDirectEmail otherwise resolves a mutable recipient again.
      // preRenderedHtml is the email adapter's explicit bypass for this persisted
      // final HTML; it must not wrap/re-render it against mutable templates.
      sendDirectEmail({
        ...email,
        ...{ preRenderedHtml: true },
        injectPortalFooter: false,
        triggerKey: "membership_payment_outbox",
      }));
  const sendSupport =
    deps.sendSupport ??
    (async (email: FrozenMembershipEmail & { idempotencyKey: string }) =>
      sendSupportEmail({
        ...email,
        subject: email.subject,
        html: email.html,
        idempotencyKey: email.idempotencyKey,
      }));

  async function recordMembershipPaymentEvent(
    input: RecordMembershipPaymentEventInput
  ): Promise<{ eventId: string; received: true }> {
    userId(input.userId);
    id(input.eventId, "event ID");
    id(input.paymentId, "payment ID");
    id(input.action, "event action", 60);
    id(input.source, "event source", 30);
    if (input.subscriptionId) id(input.subscriptionId, "subscription ID");
    if (input.mandateId) id(input.mandateId, "mandate ID");
    if (input.resource_type && input.resource_type !== "payments")
      throw new Error(
        "Only verified membership payment resources may be recorded"
      );
    if (input.amountPence != null) amount(input.amountPence);
    const currency = input.currency?.trim().toUpperCase() || null;
    if (currency && !/^[A-Z]{3}$/.test(currency))
      throw new Error("Invalid currency");
    const rawPayload =
      typeof input.rawPayload === "string"
        ? input.rawPayload
        : JSON.stringify(input.rawPayload);
    JSON.parse(rawPayload);
    await deps.store.recordEvent({
      eventId: input.eventId,
      userId: input.userId,
      paymentId: input.paymentId,
      mandateId: input.mandateId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      action: input.action,
      occurredAt: date(input.occurredAt),
      amountPence: input.amountPence ?? null,
      currency,
      willAttemptRetry: input.willAttemptRetry ?? null,
      reason: input.reason ?? null,
      source: input.source,
      rawPayload,
      status: "pending",
    });
    return { eventId: input.eventId, received: true };
  }

  async function recompute(
    tx: MembershipPaymentTransaction,
    snapshot: MembershipAccountSnapshot
  ): Promise<MembershipAccountProcessingResult> {
    const result = policy(snapshot);
    const at = now();
    const pending = snapshot.events.filter(
      e => e.status === "pending" || e.status === "failed"
    );
    const failureById = new Map(result.failures.map(f => [f.eventId, f]));
    // A late earlier failure can rename the reducer's run. Reuse a fee's stable
    // identity when its trigger remains inside that run; never double-assess.
    const stableRunKeys = new Map<string, string>();
    for (const failure of result.failures) {
      const existing = snapshot.fees.find(fee =>
        result.failures.some(
          f => f.runKey === failure.runKey && f.eventId === fee.triggerEventId
        )
      );
      if (existing) stableRunKeys.set(failure.runKey, existing.runKey);
    }
    let accountRunKey = result.currentRunKey
      ? feeKey(snapshot.account.userId, result.currentRunKey)
      : null;
    const priorFailure = [...result.failures]
      .reverse()
      .find(f =>
        snapshot.events.some(
          e =>
            e.eventId === f.eventId &&
            e.status === "processed" &&
            snapshot.account.lastFailedAt &&
            e.occurredAt.getTime() === snapshot.account.lastFailedAt.getTime()
        )
      );
    if (
      result.currentRunKey &&
      snapshot.account.runKey &&
      snapshot.account.outstandingCount > 0 &&
      priorFailure?.runKey === result.currentRunKey
    ) {
      stableRunKeys.set(
        result.currentRunKey,
        feeKey(snapshot.account.userId, snapshot.account.runKey)
      );
      accountRunKey = snapshot.account.runKey;
    }
    const durableFailure = (
      failure: MembershipPaymentFailure
    ): MembershipPaymentFailure => {
      const stable = stableRunKeys.get(failure.runKey);
      return stable
        ? {
            ...failure,
            runKey: stable.replace(`${snapshot.account.userId}:`, ""),
          }
        : failure;
    };
    const livePending = pending.filter(e => liveEffect(e, snapshot.control));
    // Only presently outstanding historical debt needs historical review.
    const historyReviewRequired = result.outstandingPayments.some(p =>
      snapshot.events.some(
        e =>
          e.paymentId === p.paymentId &&
          ["failed", "charged_back"].includes(e.action) &&
          e.occurredAt.getTime() >= date(p.firstFailedAt).getTime() &&
          (!future(e, snapshot.control) || bulkHistory(e))
      )
    );

    // Snapshot every payment, including resolved ones; newer unrelated successes never clear old debt.
    const eventsByPayment = new Map<string, Inbox[]>();
    for (const event of snapshot.events) {
      if (!event.paymentId || event.status === "ignored") continue;
      const group = eventsByPayment.get(event.paymentId) ?? [];
      group.push(event);
      eventsByPayment.set(event.paymentId, group);
    }
    for (const [paymentId, group] of Array.from(eventsByPayment)) {
      group.sort(
        (a, b) =>
          a.occurredAt.getTime() - b.occurredAt.getTime() ||
          a.eventId.localeCompare(b.eventId)
      );
      const last = group[group.length - 1];
      const debt = result.outstandingPayments.find(
        p => p.paymentId === paymentId
      );
      const recovery = result.recoveries
        .filter(r => r.paymentId === paymentId)
        .at(-1);
      const latestSettlement = snapshot.settlements
        .filter(s => s.paymentId === paymentId)
        .sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime())
        .at(-1);
      const lastFailed = group
        .filter(e => ["failed", "charged_back"].includes(e.action))
        .at(-1);
      await tx.saveObligation({
        userId: snapshot.account.userId,
        paymentId,
        amountPence:
          debt?.amount ??
          [...group].reverse().find(e => e.amountPence !== null)?.amountPence ??
          null,
        currency:
          debt?.currency ??
          [...group].reverse().find(e => e.currency !== null)?.currency ??
          null,
        status: debt
          ? "outstanding"
          : recovery?.action === "manual_settlement"
            ? "settled"
            : recovery
              ? "paid"
              : "pending",
        lastEventAt:
          latestSettlement && latestSettlement.settledAt > last.occurredAt
            ? latestSettlement.settledAt
            : last.occurredAt,
        lastFailureAt: lastFailed?.occurredAt ?? null,
      });
    }

    // Fee ledger is unique per run and immutable on replay. Historical hints remain review only.
    for (const failure of result.failures.filter(f => f.shouldApplyAdminFee)) {
      const event = snapshot.events.find(e => e.eventId === failure.eventId)!;
      const run =
        stableRunKeys.get(failure.runKey) ??
        feeKey(snapshot.account.userId, failure.runKey);
      const existingFee = snapshot.fees.find(
        f => f.runKey === run || f.triggerEventId === failure.eventId
      );
      if (existingFee) continue;
      const historical = !future(event, snapshot.control) || bulkHistory(event);
      const actionable =
        livePending.some(e => e.eventId === event.eventId) &&
        canCorrespond(snapshot);
      if (!historical && !actionable) continue;
      const feeAmount = snapshot.control?.feeAmountPence ?? 2500;
      amount(feeAmount);
      const approved =
        !historical &&
        actionable &&
        snapshot.control?.feePolicyApproved === true;
      await tx.insertFee({
        userId: snapshot.account.userId,
        runKey: run,
        triggerEventId: failure.eventId,
        amountPence: feeAmount,
        currency: "GBP",
        status: approved ? "assessed" : "review",
        notes: historical
          ? "Historical event — no automatic collection or catch-up action authorised."
          : approved
            ? "Assessed once under an approved policy; staff approval required for any collection."
            : "Fee policy/amount not approved; review only, not assessed or authorised for collection.",
      });
    }

    // Suspension depends on current complete arrears AND a newly received future trigger.
    let suspended = false;
    const suspensionEvent = livePending.find(e => failureById.has(e.eventId));
    if (result.shouldSuspend && suspensionEvent && canSuspend(snapshot)) {
      suspended = await tx.suspend(at);
      if (suspended) {
        await tx.insertOutbox({
          userId: snapshot.account.userId,
          eventId: suspensionEvent.eventId,
          dedupeKey: `membership:${snapshot.account.userId}:suspension:${suspensionEvent.eventId}`,
          kind: "suspension_support",
          payload: JSON.stringify(
            intent(
              suspensionEvent,
              "suspension_support",
              durableFailure(failureById.get(suspensionEvent.eventId)!)
            )
          ),
        });
      }
    }
    for (const event of livePending) {
      const failure = failureById.get(event.eventId);
      if (failure && canCorrespond(snapshot)) {
        for (const kind of ["failure", "failure_support"] as const) {
          await tx.insertOutbox({
            userId: snapshot.account.userId,
            eventId: event.eventId,
            dedupeKey: `membership:${snapshot.account.userId}:${kind}:${event.eventId}`,
            kind,
            payload: JSON.stringify(
              intent(event, kind, durableFailure(failure))
            ),
          });
        }
      }
      // Exactly one receipt per payment, on confirmed, never a second paid_out receipt.
      if (event.action === "confirmed" && canCorrespond(snapshot)) {
        const firstConfirmed = snapshot.events
          .filter(
            e => e.paymentId === event.paymentId && e.action === "confirmed"
          )
          .sort(
            (a, b) =>
              a.occurredAt.getTime() - b.occurredAt.getTime() ||
              a.eventId.localeCompare(b.eventId)
          )[0];
        if (firstConfirmed?.eventId === event.eventId)
          await tx.insertOutbox({
            userId: snapshot.account.userId,
            eventId: event.eventId,
            dedupeKey: `membership:${snapshot.account.userId}:receipt:${event.paymentId}`,
            kind: "receipt",
            payload: JSON.stringify(intent(event, "receipt")),
          });
      }
    }
    const outstandingPence = balance(result);
    await tx.saveAccount({
      failedAttempts: result.failureCount,
      outstandingPence,
      outstandingCount: result.outstandingPaymentCount,
      runKey: accountRunKey,
      lastFailedAt: result.lastFailedAt ? date(result.lastFailedAt) : null,
      lastSyncedAt: at,
      historyReviewRequired,
      lastError: null,
    });
    await tx.mirrorLegacy(result, suspended ? at : null);
    // Paused post-activation work stays pending, so resuming can finish its intents.
    // Pre-activation/bulk history is always audit-only and can safely be checkpointed.
    const completed = pending.filter(
      e =>
        !future(e, snapshot.control) ||
        bulkHistory(e) ||
        snapshot.control?.enabled
    );
    await tx.markProcessed(
      completed.map(e => e.id),
      at
    );
    return {
      userId: snapshot.account.userId,
      processedEvents: completed.length,
      suspended,
      failedAttempts: result.failureCount,
      outstandingCount: result.outstandingPaymentCount,
      outstandingPence,
      historyReviewRequired,
    };
  }

  async function processMembershipPaymentAccount(
    memberId: number
  ): Promise<MembershipAccountProcessingResult> {
    userId(memberId);
    try {
      return await deps.store.transaction(memberId, async tx =>
        recompute(tx, await tx.load())
      );
    } catch (error) {
      // Failure metadata outside the rolled-back effect transaction; never checkpoint inbox on failure.
      await deps.store
        .accountError(memberId, errorText(error))
        .catch(() => undefined);
      throw error;
    }
  }

  async function recordManualMembershipSettlement(
    input: ManualMembershipSettlementInput
  ): Promise<{
    settlement: Settlement;
    account: MembershipAccountProcessingResult;
  }> {
    userId(input.userId);
    userId(input.actorId);
    id(input.paymentId, "payment ID");
    const reference = input.reference?.trim();
    const notes = input.notes?.trim();
    if (!reference || reference.length > 255 || !notes)
      throw new Error(
        "A settlement reference and explanatory notes are required"
      );
    const settledAt = date(input.settledAt);
    if (settledAt > now())
      throw new Error("A manual settlement cannot be recorded in the future");
    return deps.store.transaction(input.userId, async tx => {
      const snapshot = await tx.load();
      const state = policy(snapshot);
      const obligation = state.outstandingPayments.find(
        p => p.paymentId === input.paymentId
      );
      const persisted = await tx.getObligation(input.paymentId);
      if (!persisted || persisted.status !== "outstanding")
        throw new Error(
          "A persisted outstanding obligation is required for manual settlement"
        );
      if (
        !obligation ||
        obligation.amount === null ||
        obligation.currency !== "GBP"
      )
        throw new Error(
          "A known, currently outstanding GBP obligation is required for full manual settlement"
        );
      if (
        input.amountPence !== undefined &&
        input.amountPence !== obligation.amount
      )
        throw new Error(
          "Manual settlement must equal the full outstanding payment amount"
        );
      if (settledAt < date(obligation.lastFailedAt))
        throw new Error("Settlement cannot predate the latest failed attempt");
      const settlement = await tx.insertSettlement({
        userId: input.userId,
        paymentId: input.paymentId,
        settledAt,
        recordedById: input.actorId,
        reference,
        // Schema has no amount column: freeze the exact whole-payment amount/currency in immutable audit notes.
        notes: `Full settlement: ${obligation.amount} ${obligation.currency} minor units.\n${notes}`,
      });
      snapshot.settlements.push(settlement);
      const account = await recompute(tx, snapshot);
      return { settlement, account };
    });
  }

  async function processPendingMembershipAccounts(
    limit = 50
  ): Promise<{
    processed: number;
    errors: number;
    results: MembershipAccountProcessingResult[];
  }> {
    const ids = Array.from(
      new Set(await deps.store.pendingUserIds(boundedLimit(limit, 50)))
    ).slice(0, boundedLimit(limit, 50));
    const results: MembershipAccountProcessingResult[] = [];
    const errors: string[] = [];
    for (const memberId of ids) {
      try {
        results.push(await processMembershipPaymentAccount(memberId));
      } catch (error) {
        errors.push(`User ${memberId}: ${errorText(error)}`);
      }
    }
    await deps.store.health(
      errors.length
        ? { lastError: errors.join("; ").slice(0, 2000) }
        : { lastError: null, lastSuccessAt: now() }
    );
    return { processed: results.length, errors: errors.length, results };
  }

  async function processMembershipPaymentOutbox(
    limit = 50
  ): Promise<{
    accepted: number;
    failed: number;
    ambiguous: number;
    skipped: number;
  }> {
    const result = { accepted: 0, failed: 0, ambiguous: 0, skipped: 0 };
    if (await paused()) return { ...result, skipped: 1 };
    const candidates = await deps.store.outboxCandidates(
      now(),
      boundedLimit(limit, 50)
    );
    for (const candidate of candidates) {
      const lockToken = token();
      const claimed = await deps.store.transaction(
        candidate.userId,
        async tx => {
          const row = await tx.getOutbox(candidate.id);
          const snapshot = await tx.load();
          const at = now();
          if (
            !row ||
            !mailKinds.includes(row.kind) ||
            !snapshot.control?.enabled ||
            !["pending", "failed", "sending"].includes(row.status) ||
            (row.lockedUntil && row.lockedUntil > at) ||
            (row.nextAttemptAt && row.nextAttemptAt > at)
          )
            return null;
          const payload = JSON.parse(row.payload) as Intent;
          const sourceEvent = snapshot.events.find(event => event.eventId === row.eventId);
          // Defence in depth: even an accidentally seeded historical outbox row
          // must never become a retrospective email after rules are enabled.
          if (!sourceEvent || sourceEvent.status === "ignored" ||
            !future(sourceEvent, snapshot.control) || bulkHistory(sourceEvent) ||
            !Number.isFinite(new Date(payload.occurredAt).getTime()) ||
            new Date(payload.occurredAt).getTime() !== sourceEvent.occurredAt.getTime()) {
            await tx.updateOutbox(row.id, {
              status: "review", lockedUntil: null, lockToken: null,
              lastError: "Historical, excluded or unverified payment email held for review; no retrospective delivery authorised.",
            }, row.lockToken);
            result.skipped++;
            return null;
          }
          if (
            row.firstAttemptAt &&
            at.getTime() - row.firstAttemptAt.getTime() >= SAFE_DEDUPE_MS
          ) {
            await tx.updateOutbox(
              row.id,
              {
                status: "ambiguous",
                lockedUntil: null,
                lockToken: null,
                lastError:
                  "Provider acceptance is uncertain and the idempotency retention window has expired. Manual delivery review required; do not blindly resend.",
              },
              row.lockToken
            );
            result.ambiguous++;
            return null;
          }
          if (!payload.rendered && row.firstAttemptAt) {
            await tx.updateOutbox(
              row.id,
              {
                status: "ambiguous",
                lockedUntil: null,
                lockToken: null,
                lastError:
                  "First provider attempt has no frozen payload; manual review required.",
              },
              row.lockToken
            );
            result.ambiguous++;
            return null;
          }
          if (
            !payload.rendered &&
            !payload.kind.endsWith("support") &&
            !canCorrespond(snapshot)
          ) {
            await tx.updateOutbox(
              row.id,
              {
                status: "review",
                lastError:
                  "Agent is departed or exempt; correspondence held for staff review.",
              },
              row.lockToken
            );
            return null;
          }
          try {
            payload.rendered ??= render(payload, snapshot);
          } catch (error) {
            await tx.updateOutbox(
              row.id,
              { status: "review", lastError: errorText(error) },
              row.lockToken
            );
            return null;
          }
          const updated = await tx.updateOutbox(
            row.id,
            {
              status: "sending",
              lockToken,
              lockedUntil: new Date(at.getTime() + LEASE_MS),
              payload: JSON.stringify(payload),
              recipientEmail: payload.rendered.toEmail,
            },
            row.lockToken
          );
          return updated ? { row, payload, snapshot } : null;
        }
      );
      if (!claimed) {
        result.skipped++;
        continue;
      }
      // Pause/disable after claim releases the lease without claiming provider acceptance.
      if (await paused()) {
        await deps.store.transaction(candidate.userId, tx =>
          tx.updateOutbox(
            candidate.id,
            { status: "pending", lockToken: null, lockedUntil: null },
            lockToken
          )
        );
        result.skipped++;
        continue;
      }
      const started = await deps.store.transaction(
        candidate.userId,
        async tx => {
          const snapshot = await tx.load();
          const row = await tx.getOutbox(candidate.id);
          if (!snapshot.control?.enabled) {
            await tx.updateOutbox(
              candidate.id,
              { status: "pending", lockedUntil: null, lockToken: null },
              lockToken
            );
            return false;
          }
          if (
            !row ||
            row.lockToken !== lockToken ||
            !row.lockedUntil ||
            row.lockedUntil <= now()
          )
            return false;
          return tx.updateOutbox(
            candidate.id,
            {
              attempts: row.attempts + 1,
              firstAttemptAt: row.firstAttemptAt ?? now(),
            },
            lockToken
          );
        }
      );
      if (!started) {
        result.skipped++;
        continue;
      }
      const idempotencyKey = `jlt-membership-${createHash("sha256").update(candidate.dedupeKey).digest("hex")}`;
      let response: {
        success: boolean;
        error?: string;
        providerMessageId?: string;
        definitivelyRejected?: boolean;
      };
      try {
        const send = claimed.payload.kind.endsWith("support")
          ? sendSupport
          : sendAgent;
        response = await send({ ...claimed.payload.rendered!, idempotencyKey });
      } catch (error) {
        response = { success: false, error: errorText(error) };
      }
      const acceptedId =
        response.success &&
        typeof response.providerMessageId === "string" &&
        response.providerMessageId.trim()
          ? response.providerMessageId.trim()
          : null;
      const committed = await deps.store.transaction(
        candidate.userId,
        async tx => {
          const row = await tx.getOutbox(candidate.id);
          if (!row || row.lockToken !== lockToken) return false;
          if (acceptedId)
            return tx.updateOutbox(
              candidate.id,
              {
                status: "accepted",
                providerMessageId: acceptedId,
                lastError: null,
                lockedUntil: null,
                lockToken: null,
                nextAttemptAt: null,
              },
              lockToken
            );
          const waitMs = Math.min(
            6 * 60 * 60 * 1000,
            60_000 * 2 ** Math.min(row.attempts - 1, 9)
          );
          return tx.updateOutbox(
            candidate.id,
            {
              status: "failed",
              lastError:
                response.error ||
                "Provider did not confirm acceptance with a message ID",
              nextAttemptAt: new Date(now().getTime() + waitMs),
              lockedUntil: null,
              lockToken: null,
              // Explicit rejection means no acceptance could have occurred. Only injected
              // transports with positive provider evidence may reset this uncertainty clock.
              ...(!claimed.row.firstAttemptAt &&
              (response.definitivelyRejected ||
                response.error === "Notifications are currently paused")
                ? { firstAttemptAt: null }
                : {}),
            },
            lockToken
          );
        }
      );
      if (!committed) result.skipped++;
      else if (acceptedId) result.accepted++;
      else result.failed++;
    }
    return result;
  }
  return {
    recordMembershipPaymentEvent,
    processMembershipPaymentAccount,
    recordManualMembershipSettlement,
    processPendingMembershipAccounts,
    processMembershipPaymentOutbox,
  };
}

// Production Drizzle adapter. The account mutex is held throughout every effect
// transition; inbox reception is deliberately separate and never sends anything.
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
async function dbRequired(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Membership payment database unavailable");
  return db;
}
function affected(result: unknown): boolean {
  return (
    Number((result as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) > 0
  );
}
const productionStore: MembershipPaymentStore = {
  async recordEvent(value) {
    const db = await dbRequired();
    await db.transaction(async tx => {
      // No-op insert obtains the unique-ID lock, then mapping enriches an earlier
      // durable receipt. Never overwrite an immutable canonical mapped event.
      await tx
        .insert(inboxTable)
        .values(value)
        .onDuplicateKeyUpdate({ set: { eventId: sql`${inboxTable.eventId}` } });
      const [existing] = await tx
        .select()
        .from(inboxTable)
        .where(eq(inboxTable.eventId, value.eventId))
        .for("update");
      if (!existing) throw new Error("Inbox event disappeared");
      if (existing.userId !== null) {
        if (
          existing.userId !== value.userId ||
          existing.paymentId !== value.paymentId ||
          existing.action !== value.action ||
          existing.occurredAt.getTime() !== value.occurredAt.getTime()
        )
          throw new Error("Conflicting mapped membership event ID");
        // Provider-resource enrichment may update a missing amount, never rewrite
        // an already frozen amount/currency from a different later resource state.
        const missing =
          (existing.amountPence === null && value.amountPence != null) ||
          (existing.currency === null && value.currency != null);
        if (missing)
          await tx
            .update(inboxTable)
            .set({
              amountPence: existing.amountPence ?? value.amountPence,
              currency: existing.currency ?? value.currency,
              status:
                existing.status === "processed" ? "pending" : existing.status,
            })
            .where(eq(inboxTable.id, existing.id));
        return;
      }
      await tx
        .update(inboxTable)
        .set({
          userId: value.userId,
          paymentId: value.paymentId,
          mandateId: value.mandateId,
          subscriptionId: value.subscriptionId,
          action: value.action,
          occurredAt: value.occurredAt,
          amountPence: value.amountPence,
          currency: value.currency,
          willAttemptRetry: value.willAttemptRetry,
          reason: value.reason,
          status: "pending",
          lastError: null,
          // Preserve original receipt source/raw payload; they are the audit evidence.
        })
        .where(eq(inboxTable.id, existing.id));
    });
  },
  async transaction(memberId, work) {
    const db = await dbRequired();
    return db.transaction(async tx => {
      await tx
        .insert(accountTable)
        .values({ userId: memberId })
        .onDuplicateKeyUpdate({ set: { userId: sql`${accountTable.userId}` } });
      const [account] = await tx
        .select()
        .from(accountTable)
        .where(eq(accountTable.userId, memberId))
        .for("update");
      if (!account) throw new Error("Membership account lock unavailable");
      // Lock current user/CRM rows too, so manual status changes cannot be overwritten.
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, memberId))
        .for("update");
      const [profile] = await tx
        .select()
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.userId, memberId))
        .for("update");
      const transaction: MembershipPaymentTransaction = {
        async load() {
          const [control] = await tx
            .select()
            .from(controlTable)
            .where(eq(controlTable.id, 1));
          const events = await tx
            .select()
            .from(inboxTable)
            .where(eq(inboxTable.userId, memberId))
            .orderBy(inboxTable.occurredAt, inboxTable.eventId);
          const settlements = await tx
            .select()
            .from(settlementTable)
            .where(eq(settlementTable.userId, memberId));
          const fees = await tx
            .select()
            .from(feeTable)
            .where(eq(feeTable.userId, memberId));
          return {
            account,
            user: user ?? null,
            profile: profile ?? null,
            control: control ?? null,
            events,
            settlements,
            fees,
          };
        },
        async saveAccount(value) {
          await tx
            .update(accountTable)
            .set(value)
            .where(eq(accountTable.userId, memberId));
        },
        async saveObligation(value) {
          await tx
            .insert(obligationTable)
            .values(value)
            .onDuplicateKeyUpdate({
              set: {
                amountPence: value.amountPence,
                currency: value.currency,
                status: value.status,
                lastEventAt: value.lastEventAt,
                lastFailureAt: value.lastFailureAt,
              },
            });
        },
        async getObligation(paymentId) {
          const [row] = await tx
            .select()
            .from(obligationTable)
            .where(
              and(
                eq(obligationTable.userId, memberId),
                eq(obligationTable.paymentId, paymentId)
              )
            )
            .for("update");
          return row ?? null;
        },
        async insertFee(value) {
          await tx
            .insert(feeTable)
            .values(value)
            .onDuplicateKeyUpdate({ set: { runKey: sql`${feeTable.runKey}` } });
        },
        async insertOutbox(value) {
          await tx
            .insert(outboxTable)
            .values(value)
            .onDuplicateKeyUpdate({
              set: { dedupeKey: sql`${outboxTable.dedupeKey}` },
            });
        },
        async markProcessed(ids, at) {
          if (ids.length)
            await tx
              .update(inboxTable)
              .set({ status: "processed", processedAt: at, lastError: null })
              .where(
                and(
                  eq(inboxTable.userId, memberId),
                  inArray(inboxTable.id, ids),
                  inArray(inboxTable.status, ["pending", "failed"])
                )
              );
        },
        async suspend(at) {
          const changed = await tx
            .update(users)
            .set({
              portalStatus: "suspended",
              isActive: false,
              suspendedAt: at,
              suspensionReason: "non_payment",
            })
            .where(
              and(
                eq(users.id, memberId),
                eq(users.role, "agent"),
                eq(users.isActive, true),
                eq(users.portalStatus, "active"),
                isNull(users.suspensionReason)
              )
            );
          if (!affected(changed)) return false;
          const crmChanged = await tx
            .update(agentCrmProfiles)
            .set({
              agentStatus: "suspended",
              suspendedAt: at,
              suspensionReason: "non_payment",
            })
            .where(
              and(
                eq(agentCrmProfiles.userId, memberId),
                eq(agentCrmProfiles.agentStatus, "active"),
                eq(agentCrmProfiles.paymentExempt, false),
                isNull(agentCrmProfiles.suspensionReason)
              )
            );
          if (!affected(crmChanged)) throw new Error("Membership status changed during automatic suspension; transaction rolled back");
          // System actor 0 is explicitly labelled in notes; never attribute this
          // automatic event to a staff member or omit its membership audit.
          await tx.execute(sql`INSERT INTO agent_status_events (userId, fromStatus, toStatus, adminId, notes, createdAt)
            VALUES (${memberId}, 'active', 'suspended', 0, 'System: automatically suspended after three failed membership payment attempts in an unresolved arrears run.', ${at})`);
          return true;
        },
        async mirrorLegacy(result, autoSuspendedAt) {
          // Explicit-column SQL intentionally avoids ORM insertion of legacy
          // default/notice/reset columns that may not exist in older deployments.
          const last = result.failures.at(-1);
          const lastAt = result.lastFailedAt ? date(result.lastFailedAt) : null;
          const existing = await tx.execute(
            sql`SELECT id FROM gc_payment_failures WHERE userId = ${memberId} FOR UPDATE`
          );
          const rows = existing[0] as unknown as { id: number }[];
          if (rows.length)
            await tx.execute(
              sql`UPDATE gc_payment_failures SET consecutiveFailures = ${result.failureCount}, lastFailedAt = ${lastAt}, lastFailedPaymentId = ${last?.paymentId ?? null}, autoSuspendedAt = COALESCE(${autoSuspendedAt}, autoSuspendedAt), updatedAt = ${new Date()} WHERE userId = ${memberId}`
            );
          else
            await tx.execute(
              sql`INSERT INTO gc_payment_failures (userId, consecutiveFailures, lastFailedAt, lastFailedPaymentId, autoSuspendedAt, updatedAt) VALUES (${memberId}, ${result.failureCount}, ${lastAt}, ${last?.paymentId ?? null}, ${autoSuspendedAt}, ${new Date()})`
            );
          // No legacy resetAt/notice-counter mutation and never auto-reinstate.
        },
        async insertSettlement(value) {
          const inserted = await tx
            .insert(settlementTable)
            .values(value)
            .$returningId();
          const [settlement] = await tx
            .select()
            .from(settlementTable)
            .where(eq(settlementTable.id, inserted[0].id));
          return settlement;
        },
        async getOutbox(outboxId) {
          const [row] = await tx
            .select()
            .from(outboxTable)
            .where(
              and(
                eq(outboxTable.id, outboxId),
                eq(outboxTable.userId, memberId)
              )
            )
            .for("update");
          return row ?? null;
        },
        async updateOutbox(outboxId, value, expectedToken) {
          const changed = await tx
            .update(outboxTable)
            .set(value)
            .where(
              and(
                eq(outboxTable.id, outboxId),
                eq(outboxTable.userId, memberId),
                expectedToken === undefined
                  ? undefined
                  : expectedToken === null
                    ? isNull(outboxTable.lockToken)
                    : eq(outboxTable.lockToken, expectedToken)
              )
            );
          return affected(changed);
        },
      };
      return work(transaction);
    });
  },
  async pendingUserIds(limit) {
    const db = await dbRequired();
    if (!limit) return [];
    const rows = await db
      .selectDistinct({ userId: inboxTable.userId })
      .from(inboxTable)
      .where(
        and(
          isNotNull(inboxTable.userId),
          inArray(inboxTable.status, ["pending", "failed"])
        )
      )
      .orderBy(inboxTable.userId)
      .limit(limit);
    return rows.map(r => r.userId!);
  },
  async outboxCandidates(now, limit) {
    if (!limit) return [];
    const db = await dbRequired();
    return db
      .select()
      .from(outboxTable)
      .where(
        and(
          inArray(outboxTable.kind, mailKinds),
          inArray(outboxTable.status, ["pending", "failed", "sending"]),
          or(
            isNull(outboxTable.nextAttemptAt),
            lte(outboxTable.nextAttemptAt, now)
          ),
          or(isNull(outboxTable.lockedUntil), lte(outboxTable.lockedUntil, now))
        )
      )
      .orderBy(outboxTable.id)
      .limit(limit);
  },
  async health(value) {
    const db = await dbRequired();
    await db.update(controlTable).set(value).where(eq(controlTable.id, 1));
  },
  async accountError(memberId, lastError) {
    const db = await dbRequired();
    await db
      .insert(accountTable)
      .values({ userId: memberId, lastError })
      .onDuplicateKeyUpdate({ set: { lastError } });
  },
};
const defaultService = createMembershipPaymentService({
  store: productionStore,
});
export const recordMembershipPaymentEvent =
  defaultService.recordMembershipPaymentEvent;
export const processMembershipPaymentAccount =
  defaultService.processMembershipPaymentAccount;
export const recordManualMembershipSettlement =
  defaultService.recordManualMembershipSettlement;
export const processPendingMembershipAccounts =
  defaultService.processPendingMembershipAccounts;
export const processMembershipPaymentOutbox =
  defaultService.processMembershipPaymentOutbox;
