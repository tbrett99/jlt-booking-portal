import { createHash } from "node:crypto";
import { eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { isMissingGoCardlessReplacementHistoryTable } from "./gocardless-db";
import {
  gcMandates,
  gcMandateReplacements,
  gcSubscriptions,
  users,
  agentCrmProfiles,
  prospects,
  prospectArForms,
  recruitmentProspects,
  membershipPaymentFees,
} from "../drizzle/schema";
import { membershipProviderGet } from "./membership-payment-sync";
import {
  validateIncomeRange,
  type PaidOutIncomeReport,
} from "../shared/gocardless-income-report";
import {
  buildPaidOutIncomeReport,
  incomePaymentFingerprint,
  type IncomeEvent,
  type IncomePayment,
  type IncomeIdentityData,
} from "./gocardless-income-policy";

type Page = {
  events: IncomeEvent[];
  linked?: { payments?: IncomePayment[] };
  meta: { cursors: { after: string | null } };
};
export async function readPaidOutEvents(
  from: Date,
  to: Date,
  get = membershipProviderGet
) {
  const events: IncomeEvent[] = [],
    payments = new Map<string, IncomePayment>();
  const seen = new Set<string>();
  let after: string | null = null;
  const deadline = Date.now() + 110_000;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    if (Date.now() > deadline)
      throw new Error(
        "GoCardless report exceeded its read time limit; choose a shorter range"
      );
    const query = new URLSearchParams({
      resource_type: "payments",
      action: "paid_out",
      include: "payment",
      limit: "500",
      "created_at[gte]": from.toISOString(),
      "created_at[lt]": to.toISOString(),
    });
    if (after) query.set("after", after);
    const page = await get<Page>("/events?" + query.toString());
    if (
      !Array.isArray(page.events) ||
      !page.meta?.cursors ||
      !("after" in page.meta.cursors)
    )
      throw new Error(
        "GoCardless returned an incomplete event page; no complete totals can be shown"
      );
    if (
      page.events.length > 500 ||
      (page.linked?.payments && !Array.isArray(page.linked.payments))
    )
      throw new Error("GoCardless returned an invalid payment page");
    events.push(...page.events);
    for (const payment of page.linked?.payments ?? []) {
      if (!payment?.id)
        throw new Error("GoCardless linked payment identity is missing");
      const prior = payments.get(payment.id);
      if (
        prior &&
        incomePaymentFingerprint(prior) !== incomePaymentFingerprint(payment)
      )
        throw new Error(
          "GoCardless returned conflicting payment details; refresh the report"
        );
      payments.set(payment.id, payment);
    }
    const next = page.meta.cursors.after;
    if (
      next !== null &&
      (typeof next !== "string" ||
        !next ||
        seen.has(next) ||
        !page.events.length)
    )
      throw new Error(
        "GoCardless pagination did not advance; no complete totals can be shown"
      );
    if (!next) {
      const missing = Array.from(
        new Set(
          events
            .map(e => e.links?.payment)
            .filter((id): id is string => !!id && !payments.has(id))
        )
      );
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, missing.length) }, async () => {
          while (index < missing.length) {
            const id = missing[index++];
            if (Date.now() > deadline)
              throw new Error(
                "GoCardless report exceeded its read time limit; choose a shorter range"
              );
            let response: { payments: IncomePayment };
            try {
              response = await get<{ payments: IncomePayment }>(
                "/payments/" + encodeURIComponent(id)
              );
            } catch {
              continue;
            } // Missing payment detail is shown explicitly as a review row, never zero.
            if (!response.payments || response.payments.id !== id)
              throw new Error(
                "GoCardless payment identity did not match its paid-out event"
              );
            payments.set(id, response.payments);
          }
        })
      );
      return { events, payments: Array.from(payments.values()) };
    }
    seen.add(next);
    after = next;
  }
  throw new Error(
    "GoCardless report exceeds the complete pagination limit; choose a shorter range"
  );
}
function listSources(value: unknown): string[] {
  if (Array.isArray(value))
    return Array.from(
      new Set(
        value
          .filter((v): v is string => typeof v === "string" && !!v.trim())
          .map(v => v.trim())
      )
    );
  if (typeof value === "string" && value.trim())
    return Array.from(
      new Set(
        value
          .split(/[,;\n]/)
          .map(v => v.trim())
          .filter(Boolean)
      )
    );
  return [];
}
export function selectIncomeSource(input: {
  introducedBy?: string | null;
  linkedForms: string[];
  recruitment: { howHeard: string | null; applicationData: unknown }[];
}) {
  // Each entry is one prospect's current submission, not a historical union.
  // Only exact known labels are canonicalized; never guess a channel from free text.
  const knownSources = new Map(
    [
      "TikTok",
      "website",
      "Facebook",
      "Instagram",
      "Recommended by someone",
      "Other",
    ].map(source => [source.toLowerCase(), source])
  );
  const linkedSets = new Map<string, string[]>();
  for (const form of input.linkedForms) {
    const sources = Array.from(
      new Set(
        listSources(form).map(
          source => knownSources.get(source.toLowerCase()) ?? source
        )
      )
    );
    const key = JSON.stringify(sources.slice().sort());
    if (!linkedSets.has(key)) linkedSets.set(key, sources);
  }
  if (linkedSets.size > 1)
    return {
      sources: ["Needs source review"],
      evidence:
        "Current readiness-form source sets differ across explicitly agent-linked prospects; no sources combined",
    };
  const linked = linkedSets.values().next().value ?? [];
  if (linked.length)
    return {
      sources: linked,
      evidence:
        "Currently recorded source in explicitly agent-linked readiness form",
    };
  if (input.recruitment.length === 1) {
    const row = input.recruitment[0];
    let application: any = row.applicationData;
    if (typeof application === "string") {
      try {
        application = JSON.parse(application);
      } catch {
        application = null;
      }
    }
    const recorded = listSources(application?.heardAbout);
    if (recorded.length)
      return {
        sources: recorded,
        evidence:
          "Currently recorded application source; one exact-email recruitment match (attribution only)",
      };
    const enquiry = listSources(row.howHeard);
    if (enquiry.length)
      return {
        sources: enquiry,
        evidence:
          "Currently recorded enquiry source; one exact-email recruitment match (attribution only)",
      };
  }
  if (input.recruitment.length > 1)
    return {
      sources: ["Needs source review"],
      evidence:
        "Multiple recruitment records match; no acquisition source inferred",
    };
  const introduced = listSources(input.introducedBy);
  return introduced.length
    ? {
        sources: introduced,
        evidence:
          "Current CRM introduced-by field; not a historical acquisition snapshot",
      }
    : {
        sources: ["Not recorded"],
        evidence:
          "No acquisition source was recorded; technical default website is not attribution",
      };
}
export async function readIncomeIdentities(
  payments: IncomePayment[]
): Promise<IncomeIdentityData & { replacementHistoryAvailable: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Reporting database is unavailable");
  const subscriptionIds = Array.from(
    new Set(
      payments.map(p => p.links?.subscription).filter((v): v is string => !!v)
    )
  );
  const mandateIds = Array.from(
    new Set(payments.map(p => p.links?.mandate).filter((v): v is string => !!v))
  );
  const ids = payments.map(p => p.id);
  const subscriptions = subscriptionIds.length
    ? await db
        .select({
          subscriptionId: gcSubscriptions.subscriptionId,
          mandateId: gcSubscriptions.mandateId,
          userId: gcSubscriptions.userId,
        })
        .from(gcSubscriptions)
        .where(inArray(gcSubscriptions.subscriptionId, subscriptionIds))
    : [];
  const mandates = mandateIds.length
    ? await db
        .select({ mandateId: gcMandates.mandateId, userId: gcMandates.userId })
        .from(gcMandates)
        .where(inArray(gcMandates.mandateId, mandateIds))
    : [];
  let replacementHistoryAvailable = true;
  if (mandateIds.length) {
    try {
      const history = await db
        .select({
          previousMandateId: gcMandateReplacements.previousMandateId,
          replacementMandateId: gcMandateReplacements.replacementMandateId,
          userId: gcMandateReplacements.userId,
        })
        .from(gcMandateReplacements)
        .where(
          or(
            inArray(gcMandateReplacements.previousMandateId, mandateIds),
            inArray(gcMandateReplacements.replacementMandateId, mandateIds)
          )
        );
      const requested = new Set(mandateIds);
      for (const entry of history)
        for (const mandateId of [
          entry.previousMandateId,
          entry.replacementMandateId,
        ])
          if (mandateId && requested.has(mandateId))
            // Preserve all exact owners, including null/conflicting candidates:
            // the pure payer policy decides ambiguity without email inference.
            mandates.push({ mandateId, userId: entry.userId });
    } catch (error) {
      if (!isMissingGoCardlessReplacementHistoryTable(error)) throw error;
      // This optional-table gap is surfaced to the pure report policy; no write or PII log.
      replacementHistoryAvailable = false;
    }
  }
  const userIds = Array.from(
    new Set(
      [...subscriptions, ...mandates]
        .map(r => r.userId)
        .filter(
          (id): id is number => Number.isSafeInteger(id) && Number(id) > 0
        )
    )
  );
  const people = userIds.length
    ? await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          introducedBy: agentCrmProfiles.introducedBy,
          personalEmail: agentCrmProfiles.personalEmail,
        })
        .from(users)
        .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
        .where(inArray(users.id, userIds))
    : [];
  const emails = Array.from(
    new Set(
      people
        .flatMap(u => [u.email, u.personalEmail])
        .filter((v): v is string => !!v?.trim())
        .map(v => v.trim().toLowerCase())
    )
  );
  const recruitment = emails.length
    ? await db
        .select({
          email: recruitmentProspects.email,
          howHeard: recruitmentProspects.howHeard,
          applicationData: sql<unknown>`JSON_EXTRACT(${recruitmentProspects.applicationData}, '$.heardAbout')`,
        })
        .from(recruitmentProspects)
        .where(inArray(sql`LOWER(TRIM(${recruitmentProspects.email}))`, emails))
    : [];
  // Project only the explicit attribution field, never free-text application, bank or assessment data.
  const linked = userIds.length
    ? await db
        .select({
          userId: prospects.linkedUserId,
          prospectId: prospects.id,
          formId: prospectArForms.id,
          submittedAt: prospectArForms.submittedAt,
          hearAboutUs: prospectArForms.hearAboutUs,
        })
        .from(prospects)
        .innerJoin(
          prospectArForms,
          eq(prospectArForms.prospectId, prospects.id)
        )
        .where(inArray(prospects.linkedUserId, userIds))
    : [];
  const latestForms = new Map<number, (typeof linked)[number]>();
  for (const form of linked) {
    const previous = latestForms.get(form.prospectId);
    if (
      !previous ||
      form.submittedAt.getTime() > previous.submittedAt.getTime() ||
      (form.submittedAt.getTime() === previous.submittedAt.getTime() &&
        form.formId > previous.formId)
    )
      latestForms.set(form.prospectId, form);
  }
  const currentForms = Array.from(latestForms.values());
  const sources = people.map(person => ({
    userId: person.id,
    ...selectIncomeSource({
      introducedBy: person.introducedBy,
      linkedForms: currentForms
        .filter(f => f.userId === person.id)
        .map(f => f.hearAboutUs ?? ""),
      recruitment: recruitment
        .filter(r =>
          [person.email, person.personalEmail].some(
            email =>
              email?.trim().toLowerCase() === r.email.trim().toLowerCase()
          )
        )
        .map(r => ({
          howHeard: r.howHeard,
          applicationData: {
            heardAbout:
              typeof r.applicationData === "string"
                ? (() => {
                    try {
                      return JSON.parse(r.applicationData);
                    } catch {
                      return null;
                    }
                  })()
                : r.applicationData,
          },
        })),
    }),
  }));
  const fees = ids.length
    ? await db
        .select({ paymentId: membershipPaymentFees.paymentId })
        .from(membershipPaymentFees)
        .where(inArray(membershipPaymentFees.paymentId, ids))
    : [];
  return {
    subscriptions,
    mandates,
    replacementHistoryAvailable,
    users: people.map(({ id, name, email }) => ({ id, name, email })),
    sources,
    feePaymentIds: fees
      .map(f => f.paymentId)
      .filter((id): id is string => !!id),
  };
}
/** Classify missing local subscription mirrors only; provider data never assigns a Portal owner. */
export async function readVerifiedProviderMembershipSubscriptionIds(
  payments: IncomePayment[],
  identities: Pick<IncomeIdentityData, "subscriptions">,
  get = membershipProviderGet
) {
  const localIds = new Set(
    identities.subscriptions.map(row => row.subscriptionId)
  );
  const unknown = new Map<string, IncomePayment[]>();
  for (const payment of payments) {
    const subscriptionId = payment.links?.subscription;
    if (!subscriptionId || localIds.has(subscriptionId)) continue;
    const linked = unknown.get(subscriptionId) ?? [];
    linked.push(payment);
    unknown.set(subscriptionId, linked);
  }
  const targets = Array.from(unknown.entries());
  const verified: string[] = [];
  const deadline = Date.now() + 45_000;
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (index < targets.length && Date.now() < deadline) {
        const [id, linkedPayments] = targets[index++];
        let response: {
          subscriptions: {
            id: string;
            name?: string;
            interval_unit?: string;
            interval?: number;
            links?: { mandate?: string };
          };
        };
        try {
          response = await get<typeof response>(
            "/subscriptions/" + encodeURIComponent(id)
          );
        } catch {
          continue;
        }
        const subscription = response?.subscriptions;
        // The Portal creates `JLT ${tierLabel} Membership` monthly subscriptions.
        // Historic cancelled/finished subscriptions remain the same type; neither
        // status nor amount establishes membership. Unknowns retain policy review.
        if (
          Date.now() >= deadline ||
          subscription?.id !== id ||
          typeof subscription.name !== "string" ||
          !/^JLT\s.+\sMembership$/i.test(subscription.name.trim()) ||
          subscription.interval_unit !== "monthly" ||
          subscription.interval !== 1 ||
          !subscription.links?.mandate ||
          linkedPayments.some(
            payment =>
              !payment.links?.mandate ||
              payment.links.mandate !== subscription.links!.mandate
          )
        )
          continue;
        // Verify every payment's actual mandate before blessing this shared ID.
        verified.push(id);
      }
    })
  );
  return verified;
}
const cache = new Map<
  string,
  { expires: number; result: PaidOutIncomeReport }
>();
/** Name/source enrichment only. Provider customer emails never select or modify a Portal owner. */
export async function readUnmatchedJoiningPayers(
  rows: PaidOutIncomeReport["rows"],
  payments: IncomePayment[],
  get = membershipProviderGet
) {
  const db = await getDb();
  if (!db) throw new Error("Reporting database is unavailable");
  const result: NonNullable<IncomeIdentityData["providerPayers"]> = [];
  const targets = rows.filter(
    r => r.category === "joining_fee" && r.identityStatus === "unmatched"
  );
  const paymentById = new Map(payments.map(payment => [payment.id, payment]));
  const unavailable = (paymentId: string, reason: string) => {
    result.push({
      paymentId,
      name: null,
      sources: ["Needs source review"],
      evidence: reason + ". No Portal account identity assigned.",
    });
  };
  let index = 0;
  const deadline = Date.now() + 45_000;
  await Promise.all(
    Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (index < targets.length) {
        const row = targets[index++],
          payment = paymentById.get(row.paymentId);
        if (Date.now() >= deadline) {
          unavailable(
            row.paymentId,
            "Provider payer lookup not attempted: enrichment deadline reached"
          );
          continue;
        }
        // The inspected live paid-out sample had six joining fees: all had actual
        // payment.links.mandate for faster_payments (instant-payments), plus payout
        // and creditor links. This is not a Direct Debit/BACS mandate fallback.
        // If the actual payment mandate is absent, review only; invent no alternate links.
        const mandateId = payment?.links?.mandate;
        if (!mandateId) {
          unavailable(
            row.paymentId,
            "Provider payer lookup not attempted: actual payment mandate link is missing"
          );
          continue;
        }
        let mandate: {
          mandates: { id: string; links?: { customer?: string } };
        };
        try {
          mandate = await get<typeof mandate>(
            "/mandates/" + encodeURIComponent(mandateId)
          );
        } catch {
          unavailable(
            row.paymentId,
            "Provider payer lookup unavailable: mandate request failed"
          );
          continue;
        }
        if (mandate.mandates?.id !== mandateId)
          throw new Error(
            "GoCardless payer mandate identity did not match its payment"
          );
        if (Date.now() >= deadline) {
          unavailable(
            row.paymentId,
            "Provider payer lookup unavailable: enrichment deadline reached"
          );
          continue;
        }
        const customerId = mandate.mandates.links?.customer;
        if (!customerId) {
          unavailable(
            row.paymentId,
            "Provider payer lookup unavailable: actual mandate customer link is missing"
          );
          continue;
        }
        let response: {
          customers: {
            id: string;
            given_name?: string;
            family_name?: string;
            company_name?: string;
            email?: string;
          };
        };
        try {
          response = await get<typeof response>(
            "/customers/" + encodeURIComponent(customerId)
          );
        } catch {
          unavailable(
            row.paymentId,
            "Provider payer lookup unavailable: customer request failed"
          );
          continue;
        }
        if (response.customers?.id !== customerId)
          throw new Error(
            "GoCardless payer customer identity did not match its mandate"
          );
        if (Date.now() >= deadline) {
          unavailable(
            row.paymentId,
            "Provider payer lookup unavailable: enrichment deadline reached"
          );
          continue;
        }
        const customer = response.customers;
        const name =
          [customer.given_name, customer.family_name]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          customer.company_name?.trim() ||
          null;
        const email = customer.email?.trim().toLowerCase();
        if (!email) {
          unavailable(
            row.paymentId,
            "Provider payer lookup unavailable: exact-email source lookup not attempted because provider email is missing"
          );
          continue;
        }
        let prospects: { howHeard: string | null; heardAbout: unknown }[];
        try {
          prospects = await db
            .select({
              howHeard: recruitmentProspects.howHeard,
              heardAbout: sql<unknown>`JSON_EXTRACT(${recruitmentProspects.applicationData}, '$.heardAbout')`,
            })
            .from(recruitmentProspects)
            .where(eq(sql`LOWER(TRIM(${recruitmentProspects.email}))`, email));
        } catch {
          unavailable(
            row.paymentId,
            "Provider payer lookup unavailable: recorded-source query failed"
          );
          continue;
        }
        if (Date.now() >= deadline) {
          unavailable(
            row.paymentId,
            "Provider payer lookup unavailable: enrichment deadline reached"
          );
          continue;
        }
        const source = selectIncomeSource({
          linkedForms: [],
          recruitment: prospects.map(p => ({
            howHeard: p.howHeard,
            applicationData: {
              heardAbout:
                typeof p.heardAbout === "string"
                  ? (() => {
                      try {
                        return JSON.parse(p.heardAbout);
                      } catch {
                        return null;
                      }
                    })()
                  : p.heardAbout,
            },
          })),
        });
        result.push({
          paymentId: row.paymentId,
          name,
          sources: source.sources,
          evidence:
            (name
              ? "Verified GoCardless payer name; "
              : "Verified GoCardless payer customer (name not recorded); ") +
            source.evidence +
            ". No Portal account identity assigned.",
        });
      }
    })
  );
  return result;
}
export async function getPaidOutIncomeReport(input: {
  rangeStart: string;
  rangeEnd: string;
  refreshKey?: number;
}): Promise<PaidOutIncomeReport> {
  const now = new Date();
  const { from, to } = validateIncomeRange(
    input.rangeStart,
    input.rangeEnd,
    now
  );
  const environment =
    (process.env.GOCARDLESS_ENVIRONMENT ?? "live").toLowerCase() === "live"
      ? "live"
      : "sandbox";
  const scope = createHash("sha256")
    .update(process.env.GOCARDLESS_ACCESS_TOKEN ?? "")
    .digest("hex");
  const key = `${environment}:${scope}:${input.rangeStart}:${input.rangeEnd}`;
  const saved = cache.get(key);
  if (!input.refreshKey && saved && saved.expires > now.getTime())
    return saved.result;
  const evidence = await readPaidOutEvents(from, to);
  const identities = await readIncomeIdentities(evidence.payments);
  identities.verifiedProviderMembershipSubscriptionIds =
    await readVerifiedProviderMembershipSubscriptionIds(
      evidence.payments,
      identities
    );
  const initial = buildPaidOutIncomeReport({
    ...input,
    from,
    to,
    now: new Date(),
    environment,
    ...evidence,
    identities,
  });
  identities.providerPayers = await readUnmatchedJoiningPayers(
    initial.rows,
    evidence.payments
  );
  const result = buildPaidOutIncomeReport({
    ...input,
    from,
    to,
    now: new Date(),
    environment,
    ...evidence,
    identities,
  });
  for (const [key, item] of Array.from(cache.entries()))
    if (item.expires < Date.now()) cache.delete(key);
  if (cache.size >= 20) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 5 * 60 * 1000, result });
  return result;
}
