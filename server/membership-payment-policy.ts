/** Provider timestamps, not webhook arrival times. Amounts are integer minor units. */
export type MembershipPaymentTime = string | Date;

export type MembershipPaymentEvent = {
  eventId: string;
  paymentId: string;
  action: string;
  occurredAt: MembershipPaymentTime;
  amount?: number;
  currency?: string;
  /** Omitted means this is already membership-scoped; false is always ignored. */
  isMembership?: boolean;
};

/** An explicit, whole-payment settlement, not a general account reinstatement. */
export type MembershipPaymentSettlement = {
  settlementId: string;
  paymentId: string;
  occurredAt: MembershipPaymentTime;
};

export type MembershipPaymentPolicyOptions = {
  manualSettlements?: readonly MembershipPaymentSettlement[];
  /** Inclusive counter/notice boundary only; NEVER forgives outstanding arrears. */
  resetAt?: MembershipPaymentTime;
};

export type MembershipPaymentFailure = {
  eventId: string;
  paymentId: string;
  action: "failed" | "charged_back";
  occurredAt: string;
  runKey: string;
  failureCount: number;
  /** Each distinct failure needs an email, including attempts beyond three. */
  shouldEmail: true;
  /** Eligibility only: fee amount/collection is deliberately not specified. */
  shouldApplyAdminFee: boolean;
  shouldSuspend: boolean;
};

export type MembershipPaymentArrears = {
  paymentId: string;
  firstFailedAt: string;
  lastFailedAt: string;
  /** Attempts for this currently outstanding debt, not the balance multiplier. */
  failureCount: number;
  amount: number | null;
  currency: string | null;
};

export type MembershipPaymentRecovery = {
  /** Provider event ID or settlement ID, disambiguated by action. */
  id: string;
  paymentId: string;
  action: "confirmed" | "paid_out" | "manual_settlement";
  occurredAt: string;
  runKey: string | null;
  closedRun: boolean;
};

export type MembershipPaymentPolicyResult = {
  failureCount: number;
  currentRunKey: string | null;
  /** Latest failure after resetAt; retained for audit even after full recovery. */
  lastFailedAt: string | null;
  shouldSuspend: boolean;
  failures: MembershipPaymentFailure[];
  outstandingPaymentIds: string[];
  outstandingPaymentCount: number;
  outstandingPayments: MembershipPaymentArrears[];
  /** Known subtotals only, one amount per payment; currencies are never mixed. */
  knownOutstandingAmounts: Record<string, number>;
  unknownAmountPaymentIds: string[];
  outstandingAmountsComplete: boolean;
  settlementState: "clear" | "outstanding" | "recovered";
  recoveries: MembershipPaymentRecovery[];
  lastRecoveredAt: string | null;
};

type Entry = {
  kind: "provider" | "manual";
  id: string;
  paymentId: string;
  action: string;
  occurredAt: string;
  time: number;
  amount?: number;
  currency?: string;
  isMembership: boolean;
};

function timestamp(value: MembershipPaymentTime): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time))
    throw new Error("Invalid membership payment timestamp");
  return time;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Rebuild one member's policy state from their complete canonical event ledger.
 * Pure: no account changes, notifications, fee collection, I/O or current clock.
 *
 * Distinct event IDs count as distinct failed attempts, even for the same payment.
 * Replays are deduplicated; conflicting copies of an ID throw rather than making
 * the result arrival-order dependent. Sort by provider time, then event ID; manual
 * settlements at the same instant follow provider events (then settlement ID).
 * Only failed/charged_back add debt, and only a later confirmed/paid_out or an
 * explicit manual settlement of THAT payment removes it. Other actions, including
 * pending retries, do not remove debt. A settlement before a failure is not credit
 * against future failures. All debt must clear before the run resets naturally.
 *
 * resetAt resets counts and failure hints after processing events at/before that
 * instant, but keeps their debt. A subsequent failure starts a fresh policy run.
 * isMembership:false never changes membership state; callers must identify admin
 * fees/unrelated payments or supply an already membership-scoped ledger.
 *
 * Hints are historical, NOT a queue of new side effects: callers must persist email
 * idempotency by eventId and fee idempotency by runKey, scoped to the member. The
 * fee hint occurs only at count two per run. Late historical events can change run
 * keys/counts, so callers must reconcile their durable effect ledger. Callers alone
 * decide account restoration and must preserve unrelated/manual suspension.
 */
export function reduceMembershipPaymentEvents(
  events: readonly MembershipPaymentEvent[],
  options: MembershipPaymentPolicyOptions = {}
): MembershipPaymentPolicyResult {
  const resetTime =
    options.resetAt === undefined ? null : timestamp(options.resetAt);
  const entries = new Map<string, Entry>();
  const add = (entry: Entry) => {
    if (!entry.id.trim() || !entry.paymentId.trim()) {
      throw new Error("Membership payment IDs must be non-empty");
    }
    const key = `${entry.kind}:${entry.id}`;
    const previous = entries.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
      throw new Error(`Conflicting membership payment ledger ID: ${key}`);
    }
    entries.set(key, entry);
  };
  for (const event of events) {
    const time = timestamp(event.occurredAt);
    if (
      event.amount !== undefined &&
      (!Number.isSafeInteger(event.amount) || event.amount < 0)
    ) {
      throw new Error(
        "Membership payment amount must be non-negative integer minor units"
      );
    }
    add({
      kind: "provider",
      id: event.eventId,
      paymentId: event.paymentId,
      action: event.action,
      occurredAt: new Date(time).toISOString(),
      time,
      amount: event.amount,
      currency: event.currency?.trim().toUpperCase() || undefined,
      isMembership: event.isMembership !== false,
    });
  }
  for (const settlement of options.manualSettlements ?? []) {
    const time = timestamp(settlement.occurredAt);
    add({
      kind: "manual",
      id: settlement.settlementId,
      paymentId: settlement.paymentId,
      action: "manual_settlement",
      occurredAt: new Date(time).toISOString(),
      time,
      isMembership: true,
    });
  }
  const ordered = Array.from(entries.values()).sort(
    (a, b) =>
      a.time - b.time ||
      (a.kind === b.kind
        ? compareText(a.id, b.id)
        : a.kind === "provider"
          ? -1
          : 1)
  );
  const outstanding = new Map<string, MembershipPaymentArrears>();
  const amounts = new Map<
    string,
    { amount: number | null; currency: string | null }
  >();
  const failures: MembershipPaymentFailure[] = [];
  const recoveries: MembershipPaymentRecovery[] = [];
  let failureCount = 0;
  let currentRunKey: string | null = null;
  let lastFailedAt: string | null = null;
  let lastRecoveredAt: string | null = null;
  let hadFailure = false;
  let resetApplied = resetTime === null;
  const applyReset = () => {
    failureCount = 0;
    currentRunKey = null;
    lastFailedAt = null;
    resetApplied = true;
  };

  for (const entry of ordered) {
    if (!resetApplied && entry.time > resetTime!) applyReset();
    if (!entry.isMembership) continue;
    if (entry.kind === "provider") {
      const known = amounts.get(entry.paymentId) ?? {
        amount: null,
        currency: null,
      };
      if (entry.amount !== undefined) known.amount = entry.amount;
      if (entry.currency !== undefined) known.currency = entry.currency;
      amounts.set(entry.paymentId, known);
      const debt = outstanding.get(entry.paymentId);
      if (debt) Object.assign(debt, known);
    }
    if (entry.action === "failed" || entry.action === "charged_back") {
      hadFailure = true;
      const debt = outstanding.get(entry.paymentId);
      outstanding.set(entry.paymentId, {
        paymentId: entry.paymentId,
        firstFailedAt: debt?.firstFailedAt ?? entry.occurredAt,
        lastFailedAt: entry.occurredAt,
        failureCount: (debt?.failureCount ?? 0) + 1,
        ...(amounts.get(entry.paymentId) ?? { amount: null, currency: null }),
      });
      // Pre-boundary events still establish arrears, but never produce new hints.
      if (resetTime !== null && entry.time <= resetTime) continue;
      currentRunKey ??= `membership:${entry.id}`;
      failureCount += 1;
      lastFailedAt = entry.occurredAt;
      failures.push({
        eventId: entry.id,
        paymentId: entry.paymentId,
        action: entry.action,
        occurredAt: entry.occurredAt,
        runKey: currentRunKey,
        failureCount,
        shouldEmail: true,
        shouldApplyAdminFee: failureCount === 2,
        shouldSuspend: failureCount >= 3,
      });
    } else if (
      entry.action === "confirmed" ||
      entry.action === "paid_out" ||
      entry.kind === "manual"
    ) {
      // No debt for this ID means no recovery/reset (including paid_out after confirmed).
      if (!outstanding.delete(entry.paymentId)) continue;
      const closedRun = outstanding.size === 0;
      recoveries.push({
        id: entry.id,
        paymentId: entry.paymentId,
        action:
          entry.kind === "manual"
            ? "manual_settlement"
            : (entry.action as "confirmed" | "paid_out"),
        occurredAt: entry.occurredAt,
        runKey: currentRunKey,
        closedRun,
      });
      if (closedRun) {
        failureCount = 0;
        currentRunKey = null;
        lastRecoveredAt = entry.occurredAt;
      }
    }
  }
  if (!resetApplied) applyReset();
  const outstandingPayments = Array.from(outstanding.values()).sort((a, b) =>
    compareText(a.paymentId, b.paymentId)
  );
  const knownOutstandingAmounts: Record<string, number> = {};
  const unknownAmountPaymentIds: string[] = [];
  for (const debt of outstandingPayments) {
    if (debt.amount === null || debt.currency === null) {
      unknownAmountPaymentIds.push(debt.paymentId);
    } else {
      // Define own properties so even unusual provider currency keys are safe.
      Object.defineProperty(knownOutstandingAmounts, debt.currency, {
        value:
          (Object.hasOwn(knownOutstandingAmounts, debt.currency)
            ? knownOutstandingAmounts[debt.currency]
            : 0) + debt.amount,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return {
    failureCount,
    currentRunKey,
    lastFailedAt,
    shouldSuspend: outstanding.size > 0 && failureCount >= 3,
    failures,
    outstandingPayments,
    outstandingPaymentIds: outstandingPayments.map(debt => debt.paymentId),
    outstandingPaymentCount: outstanding.size,
    knownOutstandingAmounts,
    unknownAmountPaymentIds,
    outstandingAmountsComplete: unknownAmountPaymentIds.length === 0,
    settlementState: outstanding.size
      ? "outstanding"
      : hadFailure
        ? "recovered"
        : "clear",
    recoveries,
    lastRecoveredAt,
  };
}
