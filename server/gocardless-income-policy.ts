import {
  type PaidOutIncomeReport,
  type PaidOutIncomeRow,
  type IncomeCategory,
  incomeHistoryFloor,
} from "../shared/gocardless-income-report";
export type IncomeEvent = {
  id: string;
  resource_type: string;
  action: string;
  created_at: string;
  links: { payment?: string; payout?: string };
};
export type IncomePayment = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  charge_date?: string;
  description?: string | null;
  metadata?: Record<string, string>;
  links?: { mandate?: string; subscription?: string; payout?: string };
};
export type IncomeIdentityData = {
  subscriptions: {
    subscriptionId: string | null;
    mandateId: string;
    userId: number | null;
  }[];
  mandates: { mandateId: string | null; userId: number | null }[];
  users: { id: number; name: string | null; email: string | null }[];
  sources: { userId: number; sources: string[]; evidence: string }[];
  feePaymentIds: string[];
  replacementHistoryAvailable?: boolean;
  verifiedProviderMembershipSubscriptionIds?: string[];
  providerPayers?: {
    paymentId: string;
    name: string | null;
    sources: string[];
    evidence: string;
  }[];
};
/** Compare actual classification/financial/link inputs, not JSON property order or mutable status. */
export function incomePaymentFingerprint(payment: IncomePayment): string {
  return JSON.stringify({
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    description: (payment.description ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " "),
    kind: payment.metadata?.jlt_payment_kind ?? null,
    links: Object.entries(payment.links ?? {}).sort(([a], [b]) =>
      a.localeCompare(b)
    ),
  });
}
function classify(
  payment: IncomePayment,
  data: IncomeIdentityData
): { category: IncomeCategory; evidence: string } {
  const kind = payment.metadata?.jlt_payment_kind;
  if (
    kind === "membership_admin_fee" ||
    data.feePaymentIds.includes(payment.id)
  )
    return {
      category: "other",
      evidence: "Explicit membership admin-fee payment reference",
    };
  const joiningDescription = /\bjoining\s+fee\b/i.test(
    payment.description ?? ""
  );
  const joining = kind === "joining_fee" || joiningDescription;
  const subId = payment.links?.subscription;
  const membership =
    kind === "membership" ||
    kind === "membership_fee" ||
    (!!subId &&
      (data.subscriptions.some(s => s.subscriptionId === subId) ||
        data.verifiedProviderMembershipSubscriptionIds?.includes(subId)));
  if (joining && (membership || subId))
    return {
      category: "unclassified",
      evidence: "Conflicting joining-fee and subscription evidence",
    };
  if (joining)
    return {
      category: "joining_fee",
      evidence:
        kind === "joining_fee"
          ? "Explicit joining-fee metadata"
          : "Provider payment description identifies a joining fee (not amount-based)",
    };
  if (membership)
    return {
      category: "membership",
      evidence:
        subId && data.subscriptions.some(s => s.subscriptionId === subId)
          ? "Exact Portal membership subscription reference"
          : subId &&
              data.verifiedProviderMembershipSubscriptionIds?.includes(subId)
            ? "Exact provider subscription ID with a currently recorded JLT membership name and monthly schedule; payer ownership remains separate"
            : "Explicit membership-payment metadata",
    };
  return {
    category: "unclassified",
    evidence: subId
      ? "Subscription reference is not verified as a Portal membership subscription"
      : "No explicit joining-fee or membership reference; amount is never used to guess",
  };
}
function payer(payment: IncomePayment, data: IncomeIdentityData) {
  const subId = payment.links?.subscription,
    mandateId = payment.links?.mandate;
  const relevantSubs = subId
    ? data.subscriptions.filter(s => s.subscriptionId === subId)
    : [];
  const relevantMandates = mandateId
    ? data.mandates.filter(m => m.mandateId === mandateId)
    : [];
  const mismatched =
    !!mandateId && relevantSubs.some(s => s.mandateId !== mandateId);
  const ids = Array.from(
    new Set(
      [...relevantSubs, ...relevantMandates]
        .map(r => r.userId)
        .filter(
          (id): id is number => Number.isSafeInteger(id) && Number(id) > 0
        )
    )
  );
  const unverified = [...relevantSubs, ...relevantMandates].some(
    r => !r.userId
  );
  if (mismatched || ids.length > 1 || (ids.length && unverified))
    return { id: null, name: null, status: "ambiguous" as const };
  const user = ids.length === 1 ? data.users.find(u => u.id === ids[0]) : null;
  if (!user) return { id: null, name: null, status: "unmatched" as const };
  return { id: user.id, name: user.name, status: "matched" as const };
}
export function buildPaidOutIncomeReport(input: {
  rangeStart: string;
  rangeEnd: string;
  from: Date;
  to: Date;
  now: Date;
  environment: "live" | "sandbox";
  events: IncomeEvent[];
  payments: IncomePayment[];
  identities: IncomeIdentityData;
}): PaidOutIncomeReport {
  const eventMap = new Map<string, IncomeEvent>();
  for (const e of input.events) {
    if (
      !e.id ||
      e.resource_type !== "payments" ||
      e.action !== "paid_out" ||
      !e.links?.payment ||
      !Number.isFinite(Date.parse(e.created_at))
    )
      throw new Error("GoCardless returned invalid paid-out event evidence");
    const prior = eventMap.get(e.id);
    if (
      prior &&
      (prior.links.payment !== e.links.payment ||
        prior.links.payout !== e.links.payout ||
        prior.created_at !== e.created_at)
    )
      throw new Error(
        "GoCardless returned conflicting copies of a paid-out event"
      );
    eventMap.set(e.id, e);
  }
  const groups = new Map<string, IncomeEvent[]>();
  for (const event of Array.from(eventMap.values())) {
    const time = Date.parse(event.created_at);
    if (time < input.from.getTime() || time >= input.to.getTime()) continue;
    const id = event.links.payment!;
    groups.set(id, [...(groups.get(id) ?? []), event]);
  }
  const paymentMap = new Map<string, IncomePayment>();
  for (const payment of input.payments) {
    const prior = paymentMap.get(payment.id);
    if (
      prior &&
      incomePaymentFingerprint(prior) !== incomePaymentFingerprint(payment)
    )
      throw new Error(
        "GoCardless returned conflicting payment details; refresh the report"
      );
    paymentMap.set(payment.id, payment);
  }
  const rows: PaidOutIncomeRow[] = Array.from(groups.entries())
    .map(([id, events]) => {
      const sorted = events
        .slice()
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      const payment = paymentMap.get(id);
      const payoutIds = Array.from(
        new Set(events.map(e => e.links.payout).filter(Boolean))
      );
      const missingPayout = events.some(
        e => typeof e.links.payout !== "string" || !e.links.payout.trim()
      );
      const reasons: string[] = [];
      if (!payment)
        reasons.push(
          "Payment details unavailable; amount, type and payer need review"
        );
      const amount =
        payment && Number.isSafeInteger(payment.amount) && payment.amount >= 0
          ? payment.amount
          : null;
      const currency =
        payment && /^[A-Z]{3}$/.test(payment.currency ?? "")
          ? payment.currency
          : null;
      if (payment && (amount === null || !currency))
        reasons.push(
          "Gross amount or currency is invalid; omitted from monetary totals"
        );
      const conflictingPayout =
        payoutIds.length > 1 ||
        (payment?.links?.payout &&
          payoutIds.length === 1 &&
          payment.links.payout !== payoutIds[0]);
      if (conflictingPayout)
        reasons.push(
          "Conflicting payout references; excluded from monetary/category totals pending review"
        );
      if (missingPayout)
        reasons.push(
          "Paid-out event has no verified historical payout reference; current payment links cannot replace that evidence. Excluded from monetary/category totals pending review"
        );
      const identity = payment
        ? payer(payment, input.identities)
        : { id: null, name: null, status: "unmatched" as const };
      if (identity.status !== "matched")
        reasons.push(
          identity.status === "ambiguous"
            ? "Payer ownership references conflict; no name assigned"
            : "Payer not linked to one verified Portal agent"
        );
      if (
        identity.status !== "matched" &&
        input.identities.replacementHistoryAvailable === false
      )
        reasons.push(
          "Historical mandate replacement ownership is unavailable; no owner inferred"
        );
      const type =
        payment && !conflictingPayout && !missingPayout
          ? classify(payment, input.identities)
          : {
              category: "unclassified" as const,
              evidence: "Insufficient verified payment/payout details",
            };
      if (type.category === "unclassified") reasons.push(type.evidence);
      const source = identity.id
        ? input.identities.sources.find(s => s.userId === identity.id)
        : null;
      const providerPayer =
        identity.status === "unmatched"
          ? input.identities.providerPayers?.find(p => p.paymentId === id)
          : null;
      const recordedSource = source ?? providerPayer;
      if (
        type.category === "joining_fee" &&
        (!recordedSource?.sources.length ||
          recordedSource.sources.some(s =>
            ["Not recorded", "Needs source review"].includes(s)
          ))
      )
        reasons.push(
          "Joining-fee acquisition source is missing or ambiguous; not inferred retrospectively"
        );
      return {
        paymentId: id,
        payoutId:
          conflictingPayout || missingPayout ? null : (payoutIds[0] ?? null),
        paidOutAt: new Date(sorted[0].created_at).toISOString(),
        chargeDate: payment?.charge_date ?? null,
        amountMinor: conflictingPayout || missingPayout ? null : amount,
        currency,
        category: type.category,
        categoryEvidence: type.evidence,
        agentId: identity.id,
        agentName: identity.name ?? providerPayer?.name ?? null,
        identityStatus: identity.status,
        sources: recordedSource?.sources.length
          ? recordedSource.sources
          : ["Not recorded"],
        sourceEvidence:
          recordedSource?.evidence ?? "No verified acquisition-source record",
        description: payment?.description ?? null,
        currentStatus: payment?.status ?? null,
        reviewReason: reasons.length ? reasons.join("; ") : null,
      };
    })
    .sort(
      (a, b) =>
        b.paidOutAt.localeCompare(a.paidOutAt) ||
        a.paymentId.localeCompare(b.paymentId)
    );
  const currencies: PaidOutIncomeReport["currencies"] = [];
  for (const row of rows) {
    if (!row.currency || row.amountMinor === null) continue;
    let s = currencies.find(s => s.currency === row.currency);
    if (!s) {
      s = {
        currency: row.currency,
        joiningCount: 0,
        joiningGrossMinor: 0,
        membershipCount: 0,
        membershipGrossMinor: 0,
        otherCount: 0,
        otherGrossMinor: 0,
        unclassifiedCount: 0,
        unclassifiedGrossMinor: 0,
        totalCount: 0,
        totalGrossMinor: 0,
      };
      currencies.push(s);
    }
    s.totalCount++;
    s.totalGrossMinor += row.amountMinor;
    if (row.category === "joining_fee") {
      s.joiningCount++;
      s.joiningGrossMinor += row.amountMinor;
    } else if (row.category === "membership") {
      s.membershipCount++;
      s.membershipGrossMinor += row.amountMinor;
    } else if (row.category === "other") {
      s.otherCount++;
      s.otherGrossMinor += row.amountMinor;
    } else {
      s.unclassifiedCount++;
      s.unclassifiedGrossMinor += row.amountMinor;
    }
    if (!Number.isSafeInteger(s.totalGrossMinor))
      throw new Error(
        "Income report exceeds the supported exact arithmetic range"
      );
  }
  const breakdown = new Map<string, number>();
  for (const row of rows.filter(r => r.category === "joining_fee"))
    for (const source of Array.from(new Set(row.sources)))
      breakdown.set(source, (breakdown.get(source) ?? 0) + 1);
  return {
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    asOf: input.now.toISOString(),
    providerEnvironment: input.environment,
    source: "gocardless_paid_out_events",
    rows,
    currencies: currencies.sort((a, b) => a.currency.localeCompare(b.currency)),
    referralBreakdown: Array.from(breakdown.entries())
      .map(([source, joiningPaymentCount]) => ({ source, joiningPaymentCount }))
      .sort(
        (a, b) =>
          b.joiningPaymentCount - a.joiningPaymentCount ||
          a.source.localeCompare(b.source)
      ),
    uniqueMatchedJoiners: new Set(
      rows
        .filter(r => r.category === "joining_fee" && r.agentId)
        .map(r => r.agentId)
    ).size,
    reviewCount: rows.filter(r => r.reviewReason).length,
    eventCount: eventMap.size,
    earliestAvailableDate: incomeHistoryFloor(input.now),
    complete: true,
  };
}
