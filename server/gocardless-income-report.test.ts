import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "csv-parse/sync";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import {
  addIncomeDays,
  incomeCsv,
  incomeHistoryFloor,
  incomeMonday,
  incomeMoney,
  isCalendarDate,
  londonDate,
  londonMidnight,
  validateIncomeRange,
  type PaidOutIncomeReport,
} from "../shared/gocardless-income-report";
import {
  buildPaidOutIncomeReport,
  incomePaymentFingerprint,
  type IncomeEvent,
  type IncomeIdentityData,
  type IncomePayment,
} from "./gocardless-income-policy";

// Entire dependency modules are replaced: never import their database/provider code.
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  get: vi.fn(),
  receive: vi.fn(),
  receiveMany: vi.fn(),
  enrich: vi.fn(),
  recover: vi.fn(),
  recoveryCounts: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./membership-payment-sync", () => ({
  membershipProviderGet: mocks.get,
  receiveMembershipProviderEvent: mocks.receive,
  receiveMembershipProviderEvents: mocks.receiveMany,
  enrichMembershipProviderEvent: mocks.enrich,
  recoverPendingMembershipEvents: mocks.recover,
  membershipRecoveryQueueCounts: mocks.recoveryCounts,
  reconcileMembershipPayments: mocks.reconcile,
}));
import {
  getPaidOutIncomeReport,
  readIncomeIdentities,
  readPaidOutEvents,
  readUnmatchedJoiningPayers,
  readVerifiedProviderMembershipSubscriptionIds,
  selectIncomeSource,
} from "./gocardless-income-service";
import { superAdminRouter } from "./super-admin-router";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const FROM = new Date("2026-10-31T00:00:00.000Z");
const TO = new Date("2026-11-06T00:00:00.000Z");
const request = {
  rangeStart: "2026-10-31",
  rangeEnd: "2026-11-05",
  refreshKey: 1,
};
const effects = [
  mocks.receive,
  mocks.receiveMany,
  mocks.enrich,
  mocks.recover,
  mocks.recoveryCounts,
  mocks.reconcile,
];

function event(
  paymentId = "PM_ONE",
  patch: Partial<IncomeEvent> = {}
): IncomeEvent {
  return {
    id: `EV_${paymentId}`,
    resource_type: "payments",
    action: "paid_out",
    created_at: "2026-11-02T10:00:00Z",
    links: { payment: paymentId, payout: "PO_ONE" },
    ...patch,
  };
}
function payment(
  id = "PM_ONE",
  patch: Partial<IncomePayment> = {}
): IncomePayment {
  return {
    id,
    amount: 10000,
    currency: "GBP",
    status: "paid_out",
    description: "Joining fee (discounted)",
    charge_date: "2026-10-30",
    links: { mandate: "MD_ONE", payout: "PO_ONE" },
    ...patch,
  };
}
function identities(
  patch: Partial<IncomeIdentityData> = {}
): IncomeIdentityData {
  return {
    subscriptions: [
      { subscriptionId: "SB_ONE", mandateId: "MD_ONE", userId: 42 },
    ],
    mandates: [{ mandateId: "MD_ONE", userId: 42 }],
    users: [
      {
        id: 42,
        name: "Synthetic former member",
        email: "member@example.invalid",
      },
    ],
    sources: [
      {
        userId: 42,
        sources: ["TikTok"],
        evidence: "Existing captured readiness form",
      },
    ],
    feePaymentIds: [],
    ...patch,
  };
}
function report(
  events: IncomeEvent[] = [event()],
  payments: IncomePayment[] = [payment()],
  data = identities(),
  bounds: { from?: Date; to?: Date } = {}
) {
  return buildPaidOutIncomeReport({
    rangeStart: request.rangeStart,
    rangeEnd: request.rangeEnd,
    from: FROM,
    to: TO,
    now: NOW,
    environment: "sandbox",
    events,
    payments,
    identities: data,
    ...bounds,
  });
}
function page(
  events: IncomeEvent[] = [],
  payments: IncomePayment[] = [],
  after: string | null = null
) {
  return { events, linked: { payments }, meta: { cursors: { after } } };
}
// This generic adapter preserves the service's real GET signature; it never uses fetch.
const injectedGet = <T>(path: string): Promise<T> =>
  mocks.get(path) as Promise<T>;
function caller(role: string | null) {
  return superAdminRouter.createCaller({
    user: role ? { id: 5, role, name: "Synthetic staff" } : null,
    req: {},
    res: {},
  } as TrpcContext);
}

// Only select/from/join/where exist on this fake; all results are synthetic.
function fakeDatabase(
  rows: Record<string, unknown[]> = {},
  errors: Record<string, unknown> = {}
) {
  const dialect = new MySqlDialect();
  const queries: {
    table: string;
    columns: string[];
    where: string;
    params: unknown[];
  }[] = [];
  const db = {
    select: vi.fn((projection: Record<string, unknown>) => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const name = getTableName(table);
        const chain = {
          leftJoin: vi.fn(() => chain),
          innerJoin: vi.fn(() => chain),
          where: vi.fn(
            (condition: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
              const query = dialect.sqlToQuery(condition);
              queries.push({
                table: name,
                columns: Object.keys(projection),
                where: query.sql,
                params: query.params,
              });
              if (name in errors) return Promise.reject(errors[name]);
              // Real SELECTs return independent arrays, not a mutable fixture store.
              return Promise.resolve([...(rows[name] ?? [])]);
            }
          ),
        };
        return chain;
      },
    })),
    insert: vi.fn(() => {
      throw new Error("Unexpected INSERT");
    }),
    update: vi.fn(() => {
      throw new Error("Unexpected UPDATE");
    }),
    delete: vi.fn(() => {
      throw new Error("Unexpected DELETE");
    }),
    execute: vi.fn(() => {
      throw new Error("Unexpected raw SQL");
    }),
  };
  mocks.getDb.mockResolvedValue(db);
  return { db, queries };
}
function capturedIdentityRows() {
  return {
    gc_subscriptions: [
      {
        subscriptionId: "SB_ONE",
        mandateId: "MD_ONE",
        userId: 42,
        status: "cancelled",
      },
    ],
    gc_mandates: [{ mandateId: "MD_ONE", userId: 42, status: "cancelled" }],
    gc_mandate_replacements: [] as {
      previousMandateId: string | null;
      replacementMandateId: string | null;
      userId: number | null;
      status?: string;
    }[],
    users: [
      {
        id: 42,
        name: "Synthetic former member",
        email: " Member@Example.invalid ",
        personalEmail: null,
        introducedBy: null,
        isActive: false,
      },
    ],
    recruitment_prospects: [
      {
        email: "member@example.invalid",
        howHeard: "website",
        applicationData: '["TikTok","website"]',
      },
    ],
    prospects: [] as {
      userId: number;
      prospectId: number;
      formId: number;
      submittedAt: Date;
      hearAboutUs: string | null;
    }[],
    membership_payment_fees: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockRejectedValue(new Error("Unexpected synthetic provider GET"));
  mocks.getDb.mockResolvedValue(null);
});
afterEach(() => {
  for (const effect of effects) expect(effect).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("paid-out evidence, uniqueness and exact gross income", () => {
  it("counts different payment IDs with identical subscription amounts independently", () => {
    const payments = ["PM_A", "PM_B"].map(id =>
      payment(id, {
        amount: 25999,
        description: "Monthly subscription",
        links: { subscription: "SB_ONE", mandate: "MD_ONE", payout: "PO_ONE" },
      })
    );
    const result = report(
      payments.map(p => event(p.id)),
      payments
    );
    expect(result.rows).toHaveLength(2);
    expect(result.currencies).toEqual([
      expect.objectContaining({
        currency: "GBP",
        membershipCount: 2,
        membershipGrossMinor: 51998,
        totalCount: 2,
        totalGrossMinor: 51998,
        joiningCount: 0,
      }),
    ]);
  });
  it("deduplicates identical events and multiple true paid_out events for the same payment", () => {
    const first = event();
    const result = report([
      first,
      { ...first },
      event("PM_ONE", { id: "EV_AGAIN", created_at: "2026-11-03T11:00:00Z" }),
    ]);
    expect(result.eventCount).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].paidOutAt).toBe("2026-11-02T10:00:00.000Z");
    expect(result.currencies[0]).toMatchObject({
      joiningCount: 1,
      totalCount: 1,
      totalGrossMinor: 10000,
    });
    expect(result.uniqueMatchedJoiners).toBe(1);
  });
  it.each([
    { links: { payment: "PM_OTHER", payout: "PO_ONE" } },
    { links: { payment: "PM_ONE", payout: "PO_OTHER" } },
    { created_at: "2026-11-03T10:00:00Z" },
  ])("rejects conflicting copies of one event identity: %j", patch => {
    expect(() => report([event(), event("PM_ONE", patch)])).toThrow(
      /conflicting copies/i
    );
  });
  it.each([
    { action: "confirmed" },
    { action: "submitted" },
    { resource_type: "payouts" },
    { id: "" },
    { created_at: "not-a-date" },
    { links: { payout: "PO_ONE" } },
  ])(
    "rejects non-paid_out or invalid event evidence rather than counting it: %j",
    patch => {
      expect(() => report([event("PM_ONE", patch)])).toThrow(
        /invalid paid-out event evidence/i
      );
    }
  );
  it("payment status and creation time cannot synthesize a historical payout event", () => {
    const syntheticCurrentPayment = {
      ...payment(),
      created_at: "2026-11-02T10:00:00Z",
    };
    const result = report([], [syntheticCurrentPayment]);
    expect(result.rows).toEqual([]);
    expect(result.currencies).toEqual([]);
    expect(result.eventCount).toBe(0);
  });
  it("does not move an out-of-range old event into the period using current payment status", () => {
    expect(
      report([event("PM_ONE", { created_at: "2026-10-01T10:00:00Z" })]).rows
    ).toEqual([]);
  });
  it.each(["cancelled", "confirmed", "failed", "charged_back"])(
    "historical paid_out remains income when current payment status is %s",
    status => {
      const result = report([event()], [payment("PM_ONE", { status })]);
      expect(result.currencies[0].joiningGrossMinor).toBe(10000);
      expect(result.rows[0].currentStatus).toBe(status);
    }
  );
  it("conflicting event payouts retain a review row but contribute no monetary/category totals", () => {
    const result = report([
      event(),
      event("PM_ONE", {
        id: "EV_SECOND",
        links: { payment: "PM_ONE", payout: "PO_OTHER" },
      }),
    ]);
    expect(result.rows[0]).toMatchObject({
      amountMinor: null,
      payoutId: null,
      category: "unclassified",
    });
    expect(result.rows[0].reviewReason).toMatch(
      /Conflicting payout references/
    );
    expect(result.currencies).toEqual([]);
    expect(result.referralBreakdown).toEqual([]);
    expect(result.uniqueMatchedJoiners).toBe(0);
  });
  it("payment detail payout disagreement with its event also fails closed", () => {
    const result = report(
      [event()],
      [payment("PM_ONE", { links: { mandate: "MD_ONE", payout: "PO_OTHER" } })]
    );
    expect(result.rows[0].amountMinor).toBeNull();
    expect(result.currencies).toEqual([]);
  });
  it("rejects conflicting payment copies instead of selecting the last amount", () => {
    expect(() =>
      report([event()], [payment(), payment("PM_ONE", { amount: 20000 })])
    ).toThrow(/conflicting payment details/);
  });
  it("permits identical linked payment copies", () => {
    expect(
      report([event()], [payment(), payment()]).currencies[0].totalCount
    ).toBe(1);
  });
  it("semantic fingerprints ignore link key order and mutable current status", () => {
    const original = payment("PM_ONE", {
      links: { mandate: "MD_ONE", payout: "PO_ONE", subscription: "SB_ONE" },
    });
    const reordered = payment("PM_ONE", {
      status: "charged_back",
      links: { subscription: "SB_ONE", payout: "PO_ONE", mandate: "MD_ONE" },
    });
    expect(incomePaymentFingerprint(original)).toBe(
      incomePaymentFingerprint(reordered)
    );
    expect(report([event()], [original, reordered]).rows).toHaveLength(1);
  });
  it("fingerprints compare normalized classification descriptions, not formatting or unrelated metadata", () => {
    const formatted = payment("PM_ONE", {
      description: "  JOINING   FEE (discounted)  ",
      metadata: { diagnostic_note: "not a classification input" },
      charge_date: "2026-11-01",
    });
    expect(incomePaymentFingerprint(payment())).toBe(
      incomePaymentFingerprint(formatted)
    );
  });
  it.each([
    { amount: 10001 },
    { currency: "EUR" },
    { description: "Monthly subscription" },
    { metadata: { jlt_payment_kind: "membership" } },
    { links: { mandate: "MD_OTHER", payout: "PO_ONE" } },
    { links: { mandate: "MD_ONE", payout: "PO_OTHER" } },
    { links: { mandate: "MD_ONE", payout: "PO_ONE", subscription: "SB_ONE" } },
  ])(
    "semantic fingerprints preserve substantive financial/classification/link differences: %j",
    patch => {
      const changed = payment("PM_ONE", patch);
      expect(incomePaymentFingerprint(payment())).not.toBe(
        incomePaymentFingerprint(changed)
      );
      expect(() => report([event()], [payment(), changed])).toThrow(
        /conflicting payment details/
      );
    }
  );
  it.each([undefined, "", "   "])(
    "a missing historical event payout %j cannot be filled by current payment.links.payout",
    payout => {
      const result = report([
        event("PM_ONE", { links: { payment: "PM_ONE", payout } }),
      ]);
      expect(result.rows[0]).toMatchObject({
        paymentId: "PM_ONE",
        payoutId: null,
        amountMinor: null,
        category: "unclassified",
      });
      expect(result.rows[0].reviewReason).toMatch(
        /no verified historical payout reference/i
      );
      expect(result.rows[0].reviewReason).toMatch(
        /current payment links cannot replace/i
      );
      expect(result.currencies).toEqual([]);
      expect(result.referralBreakdown).toEqual([]);
      expect(result.uniqueMatchedJoiners).toBe(0);
      expect(result.reviewCount).toBe(1);
    }
  );
  it("one event with missing payout invalidates that payment even alongside another verified event", () => {
    const result = report([
      event(),
      event("PM_ONE", {
        id: "EV_MISSING_PAYOUT",
        links: { payment: "PM_ONE" },
      }),
    ]);
    expect(result.rows[0]).toMatchObject({
      amountMinor: null,
      payoutId: null,
      category: "unclassified",
    });
    expect(result.currencies).toEqual([]);
    expect(result.eventCount).toBe(2);
  });
  it("unknown historical payout does not fabricate zero or contaminate independently known totals", () => {
    const result = report(
      [
        event("PM_KNOWN"),
        event("PM_UNKNOWN", { links: { payment: "PM_UNKNOWN" } }),
      ],
      [
        payment("PM_KNOWN", { amount: 12905 }),
        payment("PM_UNKNOWN", { amount: 99999 }),
      ]
    );
    expect(
      result.rows.find(row => row.paymentId === "PM_UNKNOWN")?.amountMinor
    ).toBeNull();
    expect(result.currencies[0]).toMatchObject({
      totalCount: 1,
      totalGrossMinor: 12905,
      joiningCount: 1,
      joiningGrossMinor: 12905,
      unclassifiedCount: 0,
      unclassifiedGrossMinor: 0,
    });
    expect(result.referralBreakdown).toEqual([
      { source: "TikTok", joiningPaymentCount: 1 },
    ]);
  });
  it("includes the exact start instant and excludes the exact following-day end instant", () => {
    const payments = ["PM_BEFORE", "PM_START", "PM_LAST", "PM_END"].map(id =>
      payment(id)
    );
    const events = [
      event("PM_BEFORE", { created_at: "2026-10-30T23:59:59.999Z" }),
      event("PM_START", { created_at: FROM.toISOString() }),
      event("PM_LAST", { created_at: "2026-11-05T23:59:59.999Z" }),
      event("PM_END", { created_at: TO.toISOString() }),
    ];
    expect(report(events, payments).rows.map(r => r.paymentId)).toEqual([
      "PM_LAST",
      "PM_START",
    ]);
  });
  it("rejects unsafe aggregate arithmetic rather than silently rounding pence", () => {
    const payments = [
      payment("PM_A", { amount: Number.MAX_SAFE_INTEGER }),
      payment("PM_B", { amount: 1 }),
    ];
    expect(() =>
      report(
        payments.map(p => event(p.id)),
        payments
      )
    ).toThrow(/exact arithmetic range/);
  });
});

describe("classification, ownership, currencies and review rows", () => {
  it("classifies a discounted 10000-pence joining description and a >20000-pence verified subscription by evidence", () => {
    const payments = [
      payment("PM_JOIN"),
      payment("PM_MEMBER", {
        amount: 30001,
        description: "Regular charge",
        links: { subscription: "SB_ONE", mandate: "MD_ONE" },
      }),
    ];
    const result = report(
      payments.map(p => event(p.id)),
      payments
    );
    expect(result.rows.find(r => r.paymentId === "PM_JOIN")).toMatchObject({
      category: "joining_fee",
      amountMinor: 10000,
    });
    expect(result.rows.find(r => r.paymentId === "PM_MEMBER")).toMatchObject({
      category: "membership",
      amountMinor: 30001,
    });
    expect(result.currencies[0]).toMatchObject({
      joiningGrossMinor: 10000,
      membershipGrossMinor: 30001,
      totalGrossMinor: 40001,
    });
  });
  it.each([10000, 20000, 30000])(
    "does not infer the category of an unknown one-off from amount %s",
    amount => {
      const result = report(
        [event()],
        [payment("PM_ONE", { amount, description: "One-off charge" })]
      );
      expect(result.rows[0].category).toBe("unclassified");
      expect(result.rows[0].reviewReason).toMatch(
        /amount is never used to guess/
      );
      expect(result.currencies[0]).toMatchObject({
        joiningCount: 0,
        membershipCount: 0,
        unclassifiedCount: 1,
        unclassifiedGrossMinor: amount,
      });
    }
  );
  it("an unverified subscription is not counted as Portal membership", () => {
    const result = report(
      [event()],
      [
        payment("PM_ONE", {
          description: "Subscription charge",
          links: { subscription: "SB_UNKNOWN", mandate: "MD_ONE" },
        }),
      ]
    );
    expect(result.rows[0]).toMatchObject({
      category: "unclassified",
      agentId: 42,
    });
    expect(result.currencies[0].membershipCount).toBe(0);
  });
  it("conflicting joining-fee and subscription evidence needs classification", () => {
    const result = report(
      [event()],
      [
        payment("PM_ONE", {
          links: { subscription: "SB_ONE", mandate: "MD_ONE" },
        }),
      ]
    );
    expect(result.rows[0].category).toBe("unclassified");
    expect(result.rows[0].reviewReason).toMatch(
      /Conflicting joining-fee and subscription/
    );
  });
  it.each([
    "joining_fee",
    "membership",
    "membership_fee",
    "membership_admin_fee",
  ])("uses explicit provider kind metadata %s", kind => {
    const expected =
      kind === "joining_fee"
        ? "joining_fee"
        : kind === "membership_admin_fee"
          ? "other"
          : "membership";
    const result = report(
      [event()],
      [
        payment("PM_ONE", {
          description: "Unlabelled charge",
          metadata: { jlt_payment_kind: kind },
        }),
      ]
    );
    expect(result.rows[0].category).toBe(expected);
  });
  it("an exact admin-fee payment reference identifies other income, not membership", () => {
    expect(
      report([event()], [payment()], identities({ feePaymentIds: ["PM_ONE"] }))
        .rows[0].category
    ).toBe("other");
  });
  it("GBP and EUR remain independent exact minor-unit totals, with no FX or combined total", () => {
    const payments = [
      payment("PM_GBP", { amount: 12345 }),
      payment("PM_EUR", { amount: 67890, currency: "EUR" }),
    ];
    const result = report(
      payments.map(p => event(p.id)),
      payments
    );
    expect(result.currencies).toEqual([
      expect.objectContaining({
        currency: "EUR",
        totalCount: 1,
        totalGrossMinor: 67890,
      }),
      expect.objectContaining({
        currency: "GBP",
        totalCount: 1,
        totalGrossMinor: 12345,
      }),
    ]);
    expect(result).not.toHaveProperty("totalGrossMinor");
    expect(result).not.toHaveProperty("exchangeRate");
  });
  it.each([
    { amount: undefined },
    { amount: null },
    { amount: -1 },
    { amount: 10.5 },
    { amount: Number.NaN },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
    { currency: undefined },
    { currency: "" },
    { currency: "gbp" },
  ])(
    "invalid or missing monetary data is review, not a fabricated zero: %j",
    patch => {
      const bad = { ...payment(), ...patch } as unknown as IncomePayment;
      const result = report([event()], [bad]);
      expect(result.rows).toHaveLength(1);
      expect(result.currencies).toEqual([]);
      expect(result.reviewCount).toBe(1);
      expect(result.rows[0].reviewReason).toMatch(
        /Gross amount or currency is invalid/
      );
      if ("amount" in patch) expect(result.rows[0].amountMinor).toBeNull();
      else expect(result.rows[0].currency).toBeNull();
    }
  );
  it("a genuine zero provider amount remains distinguishable from unavailable details", () => {
    expect(
      report([event()], [payment("PM_ONE", { amount: 0 })]).currencies[0]
    ).toMatchObject({ totalCount: 1, totalGrossMinor: 0 });
    const missing = report([event()], []);
    expect(missing.rows[0]).toMatchObject({
      amountMinor: null,
      currency: null,
      category: "unclassified",
    });
    expect(missing.currencies).toEqual([]);
    expect(missing.rows[0].reviewReason).toMatch(/Payment details unavailable/);
  });
  it("manual receipt and ignored-payment records cannot add income without paid_out events", () => {
    const unrelated = [
      payment("PM_MANUAL", { metadata: { manually_received: "true" } }),
      payment("PM_IGNORED", {
        status: "ignored",
        metadata: { ignored: "true" },
      }),
    ];
    const result = report([event()], [payment(), ...unrelated]);
    expect(result.source).toBe("gocardless_paid_out_events");
    expect(result.rows.map(r => r.paymentId)).toEqual(["PM_ONE"]);
    expect(result.currencies[0].totalCount).toBe(1);
  });
  it("unknown owner remains null, not a guessed subscription user or name", () => {
    const result = report(
      [event()],
      [payment("PM_ONE", { links: { mandate: "MD_UNKNOWN" } })]
    );
    expect(result.rows[0]).toMatchObject({
      agentId: null,
      agentName: null,
      identityStatus: "unmatched",
      sources: ["Not recorded"],
    });
    expect(result.uniqueMatchedJoiners).toBe(0);
  });
  it.each([
    {
      mandates: [
        { mandateId: "MD_ONE", userId: 42 },
        { mandateId: "MD_ONE", userId: 99 },
      ],
    },
    {
      mandates: [
        { mandateId: "MD_ONE", userId: 42 },
        { mandateId: "MD_ONE", userId: null },
      ],
    },
    {
      subscriptions: [
        { subscriptionId: "SB_ONE", mandateId: "MD_OTHER", userId: 42 },
      ],
    },
  ])(
    "conflicting/unverified ownership fails closed without assigning a name: %j",
    patch => {
      const result = report(
        [event()],
        [
          payment("PM_ONE", {
            description: "Monthly charge",
            links: { mandate: "MD_ONE", subscription: "SB_ONE" },
          }),
        ],
        identities(patch)
      );
      expect(result.rows[0]).toMatchObject({
        agentId: null,
        agentName: null,
        identityStatus: "ambiguous",
      });
      expect(result.rows[0].reviewReason).toMatch(
        /ownership references conflict/
      );
    }
  );
  it("a missing user record is unmatched even when the mandate stores a user ID", () => {
    expect(
      report([event()], [payment()], identities({ users: [] })).rows[0]
    ).toMatchObject({
      agentId: null,
      agentName: null,
      identityStatus: "unmatched",
    });
  });
  it("provider payer name/source never rescue conflicting Portal owners", () => {
    const result = report(
      [event()],
      [payment()],
      identities({
        mandates: [
          { mandateId: "MD_ONE", userId: 42 },
          { mandateId: "MD_ONE", userId: 99 },
        ],
        providerPayers: [
          {
            paymentId: "PM_ONE",
            name: "Synthetic provider payer",
            sources: ["TikTok"],
            evidence: "Provider name, never ownership evidence",
          },
        ],
      })
    );
    expect(result.rows[0]).toMatchObject({
      agentId: null,
      agentName: null,
      identityStatus: "ambiguous",
    });
    expect(result.rows[0].reviewReason).toMatch(/no name assigned/i);
    expect(result.uniqueMatchedJoiners).toBe(0);
  });
  it("missing optional replacement history is explicit only when ownership is unmatched", () => {
    const data = identities({ replacementHistoryAvailable: false });
    const matched = report([event()], [payment()], data);
    expect(matched.rows[0].reviewReason).toBeNull();
    const unmatched = report(
      [event()],
      [
        payment("PM_ONE", {
          links: { mandate: "MD_HISTORICAL", payout: "PO_ONE" },
        }),
      ],
      data
    );
    expect(unmatched.rows[0]).toMatchObject({
      agentId: null,
      identityStatus: "unmatched",
    });
    expect(unmatched.rows[0].reviewReason).toMatch(
      /replacement ownership is unavailable/i
    );
    expect(unmatched.currencies[0].totalGrossMinor).toBe(10000);
  });
  it("array sources contribute once per source per joining payment, not once per unique joiner", () => {
    const data = identities({
      sources: [
        {
          userId: 42,
          sources: ["TikTok", "website", "TikTok"],
          evidence: "Captured multi-select",
        },
      ],
    });
    const payments = [payment("PM_A"), payment("PM_B")];
    const result = report(
      payments.map(p => event(p.id)),
      payments,
      data
    );
    expect(result.referralBreakdown).toEqual([
      { source: "TikTok", joiningPaymentCount: 2 },
      { source: "website", joiningPaymentCount: 2 },
    ]);
    expect(result.uniqueMatchedJoiners).toBe(1);
  });
});

describe("existing recorded recruitment attribution and read-only identity lookup", () => {
  it("retains explicitly captured TikTok and website without inventing attribution", () => {
    expect(
      selectIncomeSource({
        linkedForms: ["TikTok; website"],
        recruitment: [],
      })
    ).toMatchObject({
      sources: ["TikTok", "website"],
      evidence: expect.stringContaining("agent-linked"),
    });
  });
  it("distinct current sets across explicitly linked prospects are review, not a historical/source union", () => {
    const source = selectIncomeSource({
      introducedBy: "Existing referrer",
      linkedForms: ["TikTok; website", "TikTok"],
      recruitment: [{ howHeard: "Facebook", applicationData: null }],
    });
    expect(source.sources).toEqual(["Needs source review"]);
    expect(source.evidence).toMatch(/current.*differ.*linked prospects/i);
    expect(source.evidence).toMatch(/no sources combined/i);
  });
  it("the same current source set on multiple linked prospects is not ambiguous despite order/case", () => {
    expect(
      selectIncomeSource({
        linkedForms: ["TikTok; website", "website; tiktok; TikTok"],
        recruitment: [],
      }).sources
    ).toEqual(["TikTok", "website"]);
  });
  it.each([
    { heardAbout: ["TikTok", "website", "TikTok"] },
    JSON.stringify({ heardAbout: ["TikTok", "website"] }),
  ])(
    "one unique recruitment application's captured source is a valid fallback: %j",
    applicationData => {
      expect(
        selectIncomeSource({
          linkedForms: [],
          recruitment: [{ howHeard: "Facebook", applicationData }],
        })
      ).toMatchObject({
        sources: ["TikTok", "website"],
        evidence: expect.stringContaining("one exact-email recruitment match"),
      });
    }
  );
  it("falls back to uniquely recorded enquiry source when no application source exists", () => {
    expect(
      selectIncomeSource({
        linkedForms: [],
        recruitment: [{ howHeard: "website", applicationData: "bad-json" }],
      }).sources
    ).toEqual(["website"]);
  });
  it("uses current introducedBy only as explicit CRM evidence, not a historical snapshot", () => {
    expect(
      selectIncomeSource({
        introducedBy: "Existing referrer",
        linkedForms: [],
        recruitment: [],
      })
    ).toEqual({
      sources: ["Existing referrer"],
      evidence:
        "Current CRM introduced-by field; not a historical acquisition snapshot",
    });
  });
  it("no captured source never defaults to website", () => {
    const selection = selectIncomeSource({ linkedForms: [], recruitment: [] });
    expect(selection.sources).toEqual(["Not recorded"]);
    expect(selection.evidence).toMatch(
      /technical default website is not attribution/
    );
    const result = report([event()], [payment()], identities({ sources: [] }));
    expect(result.rows[0].sources).toEqual(["Not recorded"]);
    expect(result.rows[0].reviewReason).toMatch(
      /source is missing or ambiguous/
    );
  });
  it("duplicate matching prospects require review rather than picking one/defaulting to website", () => {
    const selection = selectIncomeSource({
      introducedBy: "website",
      linkedForms: [],
      recruitment: [
        { howHeard: "TikTok", applicationData: null },
        { howHeard: "website", applicationData: null },
      ],
    });
    expect(selection.sources).toEqual(["Needs source review"]);
    const result = report(
      [event()],
      [payment()],
      identities({ sources: [{ userId: 42, ...selection }] })
    );
    expect(result.reviewCount).toBe(1);
    expect(result.rows[0].reviewReason).toMatch(
      /source is missing or ambiguous/
    );
  });
  it("an explicitly linked readiness form outranks duplicate email-only recruitment records", () => {
    expect(
      selectIncomeSource({
        linkedForms: ["TikTok"],
        recruitment: [
          { howHeard: "website", applicationData: null },
          { howHeard: "Facebook", applicationData: null },
        ],
      }).sources
    ).toEqual(["TikTok"]);
  });
  it("retains historically cancelled owners; queries never filter active/current status or read settlements", async () => {
    const { db, queries } = fakeDatabase(capturedIdentityRows());
    const member = payment("PM_ONE", {
      description: "Monthly charge",
      links: { subscription: "SB_ONE", mandate: "MD_ONE" },
    });
    const data = await readIncomeIdentities([member]);
    expect(report([event()], [member], data).rows[0]).toMatchObject({
      agentId: 42,
      agentName: "Synthetic former member",
      category: "membership",
      sources: ["TikTok", "website"],
    });
    expect(queries.map(q => q.table)).toEqual([
      "gc_subscriptions",
      "gc_mandates",
      "gc_mandate_replacements",
      "users",
      "recruitment_prospects",
      "prospects",
      "membership_payment_fees",
    ]);
    for (const query of queries) {
      expect(query.where).not.toMatch(/status|is_active|isActive|cancelled/i);
      expect(query.columns).not.toContain("applicationDataFull");
    }
    expect(
      queries.find(q => q.table === "recruitment_prospects")?.columns
    ).toEqual(["email", "howHeard", "applicationData"]);
    expect(
      queries.find(q => q.table === "gc_mandate_replacements")?.columns
    ).toEqual(["previousMandateId", "replacementMandateId", "userId"]);
    expect(queries.find(q => q.table === "prospects")?.columns).toEqual([
      "userId",
      "prospectId",
      "formId",
      "submittedAt",
      "hearAboutUs",
    ]);
    for (const method of [db.insert, db.update, db.delete, db.execute])
      expect(method).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("adapter matches exact normalized emails, not names or unrelated prospects", async () => {
    const rows = capturedIdentityRows();
    rows.recruitment_prospects = [
      {
        email: " MEMBER@EXAMPLE.INVALID ",
        howHeard: "TikTok",
        applicationData: "null",
      },
      {
        email: "someone-else@example.invalid",
        howHeard: "website",
        applicationData: "null",
      },
    ];
    fakeDatabase(rows);
    expect(
      (await readIncomeIdentities([payment()])).sources[0].sources
    ).toEqual(["TikTok"]);
  });
  it("adapter retains ambiguity from duplicate recruitment matches", async () => {
    const rows = capturedIdentityRows();
    rows.recruitment_prospects.push({
      ...rows.recruitment_prospects[0],
      howHeard: "Facebook",
    });
    fakeDatabase(rows);
    expect(
      (await readIncomeIdentities([payment()])).sources[0].sources
    ).toEqual(["Needs source review"]);
  });
  it.each([false, true])(
    "latest submission replaces an older source for one linked prospect independent of row order (%s)",
    async reverse => {
      const rows = capturedIdentityRows();
      rows.prospects = [
        {
          userId: 42,
          prospectId: 71,
          formId: 90,
          submittedAt: new Date("2026-10-01"),
          hearAboutUs: "website",
        },
        {
          userId: 42,
          prospectId: 71,
          formId: 10,
          submittedAt: new Date("2026-11-01"),
          hearAboutUs: "TikTok",
        },
      ];
      if (reverse) rows.prospects.reverse();
      fakeDatabase(rows);
      const data = await readIncomeIdentities([payment()]);
      expect(data.sources[0].sources).toEqual(["TikTok"]);
      expect(report([event()], [payment()], data).referralBreakdown).toEqual([
        { source: "TikTok", joiningPaymentCount: 1 },
      ]);
    }
  );
  it.each([false, true])(
    "equal submission timestamps choose the greatest form ID rather than unioning (%s)",
    async reverse => {
      const rows = capturedIdentityRows();
      rows.prospects = [
        {
          userId: 42,
          prospectId: 71,
          formId: 10,
          submittedAt: new Date("2026-11-01"),
          hearAboutUs: "website",
        },
        {
          userId: 42,
          prospectId: 71,
          formId: 11,
          submittedAt: new Date("2026-11-01"),
          hearAboutUs: "TikTok",
        },
      ];
      if (reverse) rows.prospects.reverse();
      fakeDatabase(rows);
      expect(
        (await readIncomeIdentities([payment()])).sources[0].sources
      ).toEqual(["TikTok"]);
    }
  );
  it("one current form retains its selected multi-source set while old submissions are excluded", async () => {
    const rows = capturedIdentityRows();
    rows.prospects = [
      {
        userId: 42,
        prospectId: 71,
        formId: 10,
        submittedAt: new Date("2026-10-01"),
        hearAboutUs: "Facebook",
      },
      {
        userId: 42,
        prospectId: 71,
        formId: 11,
        submittedAt: new Date("2026-11-01"),
        hearAboutUs: "TikTok; website",
      },
    ];
    fakeDatabase(rows);
    expect(
      (await readIncomeIdentities([payment()])).sources[0].sources
    ).toEqual(["TikTok", "website"]);
  });
  it("multiple linked prospects with conflicting current sets require source review", async () => {
    const rows = capturedIdentityRows();
    rows.prospects = [
      {
        userId: 42,
        prospectId: 71,
        formId: 10,
        submittedAt: new Date("2026-11-01"),
        hearAboutUs: "TikTok",
      },
      {
        userId: 42,
        prospectId: 72,
        formId: 11,
        submittedAt: new Date("2026-11-02"),
        hearAboutUs: "website",
      },
    ];
    fakeDatabase(rows);
    const data = await readIncomeIdentities([payment()]);
    expect(data.sources[0].sources).toEqual(["Needs source review"]);
    const result = report([event()], [payment()], data);
    expect(result.rows[0].reviewReason).toMatch(
      /source is missing or ambiguous/
    );
    expect(result.referralBreakdown).toEqual([
      { source: "Needs source review", joiningPaymentCount: 1 },
    ]);
  });
  it("multiple linked prospects with equivalent current sets retain attribution", async () => {
    const rows = capturedIdentityRows();
    rows.prospects = [
      {
        userId: 42,
        prospectId: 71,
        formId: 10,
        submittedAt: new Date("2026-10-01"),
        hearAboutUs: "Facebook",
      },
      {
        userId: 42,
        prospectId: 71,
        formId: 11,
        submittedAt: new Date("2026-11-01"),
        hearAboutUs: "TikTok; website",
      },
      {
        userId: 42,
        prospectId: 72,
        formId: 12,
        submittedAt: new Date("2026-11-02"),
        hearAboutUs: "website; TikTok",
      },
    ];
    fakeDatabase(rows);
    expect(
      (await readIncomeIdentities([payment()])).sources[0].sources
    ).toEqual(["TikTok", "website"]);
  });
  it("an empty latest linked submission does not resurrect that prospect's older captured source", async () => {
    const rows = capturedIdentityRows();
    rows.recruitment_prospects = [];
    rows.prospects = [
      {
        userId: 42,
        prospectId: 71,
        formId: 10,
        submittedAt: new Date("2026-10-01"),
        hearAboutUs: "TikTok",
      },
      {
        userId: 42,
        prospectId: 71,
        formId: 11,
        submittedAt: new Date("2026-11-01"),
        hearAboutUs: null,
      },
    ];
    fakeDatabase(rows);
    expect(
      (await readIncomeIdentities([payment()])).sources[0].sources
    ).toEqual(["Not recorded"]);
  });
  it.each(["MD_OLD", "MD_REPLACEMENT"])(
    "exact historical replacement reference %s recovers one audited owner, not an email guess",
    async mandateId => {
      const rows = capturedIdentityRows();
      rows.gc_mandates = [];
      rows.gc_mandate_replacements = [
        {
          previousMandateId: "MD_OLD",
          replacementMandateId: "MD_REPLACEMENT",
          userId: 42,
          status: "cancelled",
        },
      ];
      const { db, queries } = fakeDatabase(rows);
      const paid = payment("PM_ONE", {
        links: { mandate: mandateId, payout: "PO_ONE" },
      });
      const data = await readIncomeIdentities([paid]);
      expect(data.replacementHistoryAvailable).toBe(true);
      expect(data.mandates).toEqual([{ mandateId, userId: 42 }]);
      expect(report([event()], [paid], data).rows[0]).toMatchObject({
        agentId: 42,
        agentName: "Synthetic former member",
        identityStatus: "matched",
        sources: ["TikTok", "website"],
      });
      const history = queries.find(
        query => query.table === "gc_mandate_replacements"
      );
      expect(history?.where).toMatch(
        /previousMandateId.*or.*replacementMandateId/i
      );
      expect(history?.params).toEqual([mandateId, mandateId]);
      expect(history?.where).not.toMatch(/status|email|name/i);
      for (const method of [db.insert, db.update, db.delete, db.execute])
        expect(method).not.toHaveBeenCalled();
      expect(mocks.get).not.toHaveBeenCalled();
    }
  );
  it.each([99, null])(
    "conflicting replacement owner candidate %j cannot be discarded to assign a name",
    async userId => {
      const rows = capturedIdentityRows();
      rows.gc_mandate_replacements = [
        { previousMandateId: "MD_ONE", replacementMandateId: "MD_NEW", userId },
      ];
      fakeDatabase(rows);
      const data = await readIncomeIdentities([payment()]);
      expect(data.mandates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ mandateId: "MD_ONE", userId: 42 }),
          { mandateId: "MD_ONE", userId },
        ])
      );
      expect(report([event()], [payment()], data).rows[0]).toMatchObject({
        agentId: null,
        agentName: null,
        identityStatus: "ambiguous",
      });
    }
  );
  it("unrelated replacement IDs returned by the synthetic adapter cannot attach ownership to a requested mandate", async () => {
    const rows = capturedIdentityRows();
    rows.gc_mandates = [];
    rows.gc_mandate_replacements = [
      {
        previousMandateId: "MD_OTHER",
        replacementMandateId: "MD_UNRELATED",
        userId: 42,
      },
    ];
    fakeDatabase(rows);
    const data = await readIncomeIdentities([payment()]);
    expect(data.mandates).toEqual([]);
    expect(report([event()], [payment()], data).rows[0]).toMatchObject({
      agentId: null,
      agentName: null,
      identityStatus: "unmatched",
    });
  });
  it.each([
    Object.assign(
      new Error("Table 'synthetic.gc_mandate_replacements' doesn't exist"),
      { code: "ER_NO_SUCH_TABLE", errno: 1146 }
    ),
    Object.assign(new Error("Synthetic Drizzle SELECT failed"), {
      cause: Object.assign(
        new Error("Table 'synthetic.gc_mandate_replacements' doesn't exist"),
        { code: "ER_NO_SUCH_TABLE", errno: 1146 }
      ),
    }),
  ])(
    "only a recognized optional replacement-history missing table degrades safely: %j",
    async error => {
      const rows = capturedIdentityRows();
      rows.gc_mandates = [];
      const { db } = fakeDatabase(rows, { gc_mandate_replacements: error });
      const data = await readIncomeIdentities([payment()]);
      expect(data.replacementHistoryAvailable).toBe(false);
      expect(data.mandates).toEqual([]);
      const result = report([event()], [payment()], data);
      expect(result.rows[0]).toMatchObject({
        agentId: null,
        identityStatus: "unmatched",
      });
      expect(result.rows[0].reviewReason).toMatch(
        /replacement ownership is unavailable/i
      );
      expect(result.currencies[0].totalGrossMinor).toBe(10000);
      for (const method of [db.insert, db.update, db.delete, db.execute])
        expect(method).not.toHaveBeenCalled();
      expect(mocks.get).not.toHaveBeenCalled();
    }
  );
  it("optional missing history does not erase a directly verified existing mandate owner", async () => {
    const error = Object.assign(
      new Error("Table 'synthetic.gc_mandate_replacements' doesn't exist"),
      { code: "ER_NO_SUCH_TABLE" }
    );
    fakeDatabase(capturedIdentityRows(), { gc_mandate_replacements: error });
    const data = await readIncomeIdentities([payment()]);
    expect(data.replacementHistoryAvailable).toBe(false);
    expect(report([event()], [payment()], data).rows[0]).toMatchObject({
      agentId: 42,
      identityStatus: "matched",
      reviewReason: null,
    });
  });
  it.each([
    Object.assign(new Error("Synthetic database connection refused"), {
      code: "ECONNREFUSED",
    }),
    Object.assign(new Error("SELECT denied for gc_mandate_replacements"), {
      code: "ER_TABLEACCESS_DENIED_ERROR",
    }),
    Object.assign(new Error("Table 'synthetic.users' doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
    }),
    new Error("Synthetic replacement-history query syntax error"),
  ])(
    "unrelated replacement-history database failures remain fatal, not optional gaps: %j",
    async error => {
      fakeDatabase(capturedIdentityRows(), { gc_mandate_replacements: error });
      await expect(readIncomeIdentities([payment()])).rejects.toBe(error);
      expect(mocks.get).not.toHaveBeenCalled();
    }
  );
  it("a missing required identity table is fatal even when its error mentions an absent table", async () => {
    const error = Object.assign(
      new Error("Table 'synthetic.gc_mandates' doesn't exist"),
      { code: "ER_NO_SUCH_TABLE", errno: 1146 }
    );
    fakeDatabase(capturedIdentityRows(), { gc_mandates: error });
    await expect(readIncomeIdentities([payment()])).rejects.toBe(error);
  });
  it("no database returns an explicit error and no provider GET", async () => {
    await expect(readIncomeIdentities([payment()])).rejects.toThrow(
      "Reporting database is unavailable"
    );
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe("London inclusive calendar ranges, DST and historical restrictions", () => {
  it.each([
    ["2026-11-02", "2026-11-02"],
    ["2026-11-08", "2026-11-02"],
    ["2026-11-01", "2026-10-26"],
  ])("Monday/Sunday boundary %s belongs to Monday %s", (date, monday) => {
    expect(incomeMonday(date)).toBe(monday);
  });
  it("London date follows BST rather than the UTC date", () => {
    expect(londonDate(new Date("2026-07-05T23:30:00Z"))).toBe("2026-07-06");
    expect(londonDate(new Date("2026-11-05T23:30:00Z"))).toBe("2026-11-05");
  });
  it.each([
    ["2026-03-29", "2026-03-29T00:00:00.000Z", "2026-03-29T23:00:00.000Z", 23],
    ["2026-10-25", "2026-10-24T23:00:00.000Z", "2026-10-26T00:00:00.000Z", 25],
  ] as const)(
    "inclusive single-day %s spans its actual DST length",
    (date, from, to, hours) => {
      const bounds = validateIncomeRange(date, date, NOW);
      expect(bounds.from.toISOString()).toBe(from);
      expect(bounds.to.toISOString()).toBe(to);
      expect((bounds.to.getTime() - bounds.from.getTime()) / 3600000).toBe(
        hours
      );
      const payments = [payment("PM_IN"), payment("PM_OUT")];
      expect(
        report(
          [
            event("PM_IN", { created_at: from }),
            event("PM_OUT", { created_at: to }),
          ],
          payments,
          identities(),
          bounds
        ).rows.map(r => r.paymentId)
      ).toEqual(["PM_IN"]);
    }
  );
  it("inclusive custom dates end at midnight after the final London date", () => {
    const bounds = validateIncomeRange("2026-06-17", "2026-06-19", NOW);
    expect(bounds.from.toISOString()).toBe("2026-06-16T23:00:00.000Z");
    expect(bounds.to.toISOString()).toBe("2026-06-19T23:00:00.000Z");
  });
  it("supports the leap day and calendar addition across it", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(addIncomeDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addIncomeDays("2024-02-29", 1)).toBe("2024-03-01");
    const bounds = validateIncomeRange(
      "2024-02-29",
      "2024-02-29",
      new Date("2024-03-01T12:00:00Z")
    );
    expect(bounds.from.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(bounds.to.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });
  it.each([
    "2025-02-29",
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-2-01",
    "not-a-date",
  ])("rejects impossible/noncanonical calendar date %s", date => {
    expect(isCalendarDate(date)).toBe(false);
    expect(() => londonMidnight(date)).toThrow(/valid calendar dates/);
    expect(() => validateIncomeRange(date, "2026-11-05", NOW)).toThrow(
      /valid date range/
    );
  });
  it("rejects reversed dates and future starts", () => {
    expect(() => validateIncomeRange("2026-11-05", "2026-11-04", NOW)).toThrow(
      /end on or after the start/
    );
    expect(() => validateIncomeRange("2026-11-06", "2026-11-06", NOW)).toThrow(
      /cannot start in the future/
    );
  });
  it.each([
    ["2026-11-05T12:00:00Z", "2025-05-06"],
    ["2026-08-31T12:00:00Z", "2025-03-01"],
    ["2025-08-31T12:00:00Z", "2024-03-01"],
  ])(
    "18-month floor clamps end-of-month/leap history for %s",
    (nowString, floor) => {
      const now = new Date(nowString);
      expect(incomeHistoryFloor(now)).toBe(floor);
      expect(() =>
        validateIncomeRange(addIncomeDays(floor, -1), floor, now)
      ).toThrow(/older than 18 months are archived/);
      expect(validateIncomeRange(floor, floor, now).from).toEqual(
        londonMidnight(floor)
      );
    }
  );
  it("rejects overly long complete ranges even within the available archive window", () => {
    expect(() => validateIncomeRange("2025-05-06", "2026-11-05", NOW)).toThrow(
      /at most one year/
    );
  });
});

describe("CSV is complete, exact and spreadsheet-safe", () => {
  it("exports every review and valid row with exact cents, blank unavailable amounts and UTC/London dates", () => {
    const result = report();
    result.rows = [
      {
        ...result.rows[0],
        paymentId: "PM_PENCE",
        amountMinor: 12905,
        paidOutAt: "2026-07-05T23:30:00.000Z",
        agentName: 'Synthetic "quoted", member',
        sources: ["TikTok", "website"],
      },
      {
        ...result.rows[0],
        paymentId: "PM_REVIEW",
        amountMinor: null,
        currency: null,
        agentId: null,
        agentName: null,
        reviewReason: "Missing details",
      },
    ];
    const csv = incomeCsv(result);
    const records = parse(csv, { bom: true, columns: true });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      "Payment ID": "PM_PENCE",
      "Gross amount": "129.05",
      Currency: "GBP",
      "Paid out at (UTC)": "2026-07-05T23:30:00.000Z",
      "Paid out date (Europe/London)": "2026-07-06",
      "Joining-fee payer / member": 'Synthetic "quoted", member',
      "How they found us": "TikTok; website",
    });
    expect(records[1]).toMatchObject({
      "Payment ID": "PM_REVIEW",
      "Gross amount": "",
      Currency: "",
      "Agent ID": "",
      "Review reason": "Missing details",
    });
  });
  it.each([
    "=SUM(1,2)",
    "+cmd",
    "-cmd",
    "@evil",
    "  =evil",
    "\t@evil",
    "\n+evil",
  ])(
    "neutralizes spreadsheet formula prefix %j in untrusted cells",
    formula => {
      const result = report();
      result.rows[0] = {
        ...result.rows[0],
        paymentId: formula,
        payoutId: formula,
        agentName: formula,
        sources: [formula],
        sourceEvidence: formula,
        categoryEvidence: formula,
        currentStatus: formula,
        reviewReason: formula,
      };
      const [row] = parse(incomeCsv(result), { bom: true, columns: true });
      for (const key of [
        "Payment ID",
        "Payout ID",
        "Joining-fee payer / member",
        "How they found us",
        "Source evidence",
        "Classification evidence",
        "Current payment status",
        "Review reason",
      ])
        expect(row[key]).toBe("'" + formula);
    }
  );
  it("a zero provider amount exports 0.00 rather than a missing-value blank", () => {
    const [row] = parse(
      incomeCsv(report([event()], [payment("PM_ONE", { amount: 0 })])),
      { bom: true, columns: true }
    );
    expect(row["Gross amount"]).toBe("0.00");
    expect(incomeMoney(12905, "GBP")).toBe("£129.05");
  });
});

describe("injected GET provider read: complete paid_out pagination only", () => {
  it("uses exact paid_out/payment filters, linked payments and second-page cursor with UTC bounds", async () => {
    mocks.get
      .mockResolvedValueOnce(
        page([event("PM_A")], [payment("PM_A")], "NEXT_PAGE")
      )
      .mockResolvedValueOnce(page([event("PM_B")], [payment("PM_B")]));
    const result = await readPaidOutEvents(FROM, TO, injectedGet);
    expect(result.events.map(e => e.links.payment)).toEqual(["PM_A", "PM_B"]);
    expect(result.payments.map(p => p.id)).toEqual(["PM_A", "PM_B"]);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    const first = new URL(
      mocks.get.mock.calls[0][0],
      "https://synthetic.invalid"
    );
    const second = new URL(
      mocks.get.mock.calls[1][0],
      "https://synthetic.invalid"
    );
    expect(first.pathname).toBe("/events");
    expect(Object.fromEntries(first.searchParams)).toEqual({
      resource_type: "payments",
      action: "paid_out",
      include: "payment",
      limit: "500",
      "created_at[gte]": FROM.toISOString(),
      "created_at[lt]": TO.toISOString(),
    });
    expect(Object.fromEntries(second.searchParams)).toEqual({
      ...Object.fromEntries(first.searchParams),
      after: "NEXT_PAGE",
    });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("a terminal empty page is complete zero evidence, without fetching payment details", async () => {
    mocks.get.mockResolvedValue(page());
    expect(await readPaidOutEvents(FROM, TO, injectedGet)).toEqual({
      events: [],
      payments: [],
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it.each([
    { events: [] },
    { events: [], meta: {} },
    { events: [], meta: { cursors: {} } },
    { events: null, meta: { cursors: { after: null } } },
  ])(
    "missing page/meta/cursor evidence must fail, not silently report zero: %j",
    response => {
      mocks.get.mockResolvedValue(response);
      return expect(readPaidOutEvents(FROM, TO, injectedGet)).rejects.toThrow(
        /incomplete event page/
      );
    }
  );
  it.each(["", 4, false])(
    "invalid continuation cursor %j fails closed",
    after => {
      mocks.get.mockResolvedValue({
        ...page([event()], [payment()]),
        meta: { cursors: { after } },
      });
      return expect(readPaidOutEvents(FROM, TO, injectedGet)).rejects.toThrow(
        /pagination did not advance/
      );
    }
  );
  it("an empty page with a continuation is incomplete, not a false zero", async () => {
    mocks.get.mockResolvedValue(page([], [], "NEXT"));
    await expect(readPaidOutEvents(FROM, TO, injectedGet)).rejects.toThrow(
      /pagination did not advance/
    );
  });
  it("detects repeated cursor loops without fetching endlessly", async () => {
    mocks.get
      .mockResolvedValueOnce(page([event()], [payment()], "LOOP"))
      .mockResolvedValueOnce(page([event()], [payment()], "LOOP"));
    await expect(readPaidOutEvents(FROM, TO, injectedGet)).rejects.toThrow(
      /pagination did not advance/
    );
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it("the 100-page upper bound prevents unbounded work", async () => {
    let index = 0;
    mocks.get.mockImplementation(async () =>
      page([event()], [payment()], `CURSOR_${++index}`)
    );
    await expect(readPaidOutEvents(FROM, TO, injectedGet)).rejects.toThrow(
      /complete pagination limit/
    );
    expect(mocks.get).toHaveBeenCalledTimes(100);
  });
  it("the read deadline stops pagination with an explicit incomplete-report error", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValue(112001);
    mocks.get.mockResolvedValue(page([event()], [payment()], "NEXT"));
    await expect(readPaidOutEvents(FROM, TO, injectedGet)).rejects.toThrow(
      /read time limit/
    );
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it.each([
    page(
      Array.from({ length: 501 }, () => event()),
      []
    ),
    { ...page([event()]), linked: { payments: {} } },
  ])("rejects oversized/malformed linked pages", response => {
    mocks.get.mockResolvedValue(response);
    return expect(readPaidOutEvents(FROM, TO, injectedGet)).rejects.toThrow(
      /invalid payment page/
    );
  });
  it("linked payment without an identity cannot be silently ignored", async () => {
    mocks.get.mockResolvedValue({
      ...page([event()]),
      linked: { payments: [{ amount: 10000 }] },
    });
    await expect(readPaidOutEvents(FROM, TO, injectedGet)).rejects.toThrow(
      /linked payment identity is missing/
    );
  });
  it.each([
    { amount: 10001 },
    { currency: "EUR" },
    { description: "Monthly subscription" },
    { metadata: { jlt_payment_kind: "membership" } },
    { links: { mandate: "MD_OTHER" } },
  ])("conflicting linked payment details across pages fail: %j", patch => {
    mocks.get
      .mockResolvedValueOnce(page([event()], [payment()], "NEXT"))
      .mockResolvedValueOnce(page([event()], [payment("PM_ONE", patch)]));
    return expect(readPaidOutEvents(FROM, TO, injectedGet)).rejects.toThrow(
      /conflicting payment details/
    );
  });
  it("paginated copies with reordered links and changed current status remain one payment", async () => {
    const first = payment("PM_ONE", {
      links: { mandate: "MD_ONE", payout: "PO_ONE" },
    });
    const second = payment("PM_ONE", {
      status: "charged_back",
      links: { payout: "PO_ONE", mandate: "MD_ONE" },
    });
    mocks.get
      .mockResolvedValueOnce(page([event()], [first], "NEXT"))
      .mockResolvedValueOnce(
        page([event("PM_ONE", { id: "EV_SECOND" })], [second])
      );
    const evidence = await readPaidOutEvents(FROM, TO, injectedGet);
    expect(evidence.payments).toEqual([second]);
    expect(
      report(evidence.events, evidence.payments).currencies[0]
    ).toMatchObject({ totalCount: 1, totalGrossMinor: 10000 });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it("missing linked payment uses one GET per distinct event payment with encoded identity", async () => {
    const id = "PM_TEST/SPACE ?";
    mocks.get
      .mockResolvedValueOnce(page([event(id), event(id, { id: "EV_COPY" })]))
      .mockResolvedValueOnce({ payments: payment(id) });
    const result = await readPaidOutEvents(FROM, TO, injectedGet);
    expect(result.payments).toEqual([payment(id)]);
    expect(mocks.get.mock.calls.map(call => call[0]).slice(1)).toEqual([
      "/payments/" + encodeURIComponent(id),
    ]);
  });
  it("a mismatching direct payment identity fails closed", async () => {
    mocks.get
      .mockResolvedValueOnce(page([event()]))
      .mockResolvedValueOnce({ payments: payment("PM_WRONG") });
    await expect(readPaidOutEvents(FROM, TO, injectedGet)).rejects.toThrow(
      /identity did not match/
    );
  });
  it("failed payment enrichment stays a review row with unavailable amount, never false zero", async () => {
    mocks.get
      .mockResolvedValueOnce(page([event()]))
      .mockRejectedValueOnce(new Error("Synthetic GET unavailable"));
    const evidence = await readPaidOutEvents(FROM, TO, injectedGet);
    const result = report(evidence.events, evidence.payments);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      paymentId: "PM_ONE",
      amountMinor: null,
      currency: null,
      agentId: null,
    });
    expect(result.rows[0].reviewReason).toMatch(/Payment details unavailable/);
    expect(result.currencies).toEqual([]);
    expect(result.reviewCount).toBe(1);
  });
  it("missing-payment GETs have a bounded concurrency of four", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `PM_CONCURRENT_${i}`);
    let active = 0,
      peak = 0;
    mocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith("/events?")) return page(ids.map(id => event(id)));
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 0));
      active--;
      return {
        payments: payment(decodeURIComponent(path.slice("/payments/".length))),
      };
    });
    expect(
      (await readPaidOutEvents(FROM, TO, injectedGet)).payments
    ).toHaveLength(9);
    expect(peak).toBe(4);
  });
});

describe("provider-only monthly membership verification, synthetic GETs only", () => {
  const monthly = (id = "PM_EXTERNAL", mandateId = "MD_EXTERNAL") =>
    payment(id, {
      amount: 30001,
      description: "Regular monthly charge",
      links: {
        subscription: "SB_EXTERNAL/ONE",
        mandate: mandateId,
        payout: "PO_ONE",
      },
    });
  const subscription = (patch: Record<string, unknown> = {}) => ({
    id: "SB_EXTERNAL/ONE",
    name: "JLT Gold Membership",
    interval_unit: "monthly",
    interval: 1,
    links: { mandate: "MD_EXTERNAL" },
    ...patch,
  });
  it.each(["active", "cancelled", "finished"])(
    "a verified JLT monthly subscription in current status %s classifies >20000 pence without a Portal owner",
    async status => {
      const paid = monthly();
      const data = identities({
        subscriptions: [],
        mandates: [],
        users: [],
        sources: [],
      });
      mocks.get.mockResolvedValueOnce({
        subscriptions: subscription({ status }),
      });
      data.verifiedProviderMembershipSubscriptionIds =
        await readVerifiedProviderMembershipSubscriptionIds(
          [paid],
          data,
          injectedGet
        );
      expect(data.verifiedProviderMembershipSubscriptionIds).toEqual([
        "SB_EXTERNAL/ONE",
      ]);
      const result = report([event(paid.id)], [paid], data);
      expect(result.rows[0]).toMatchObject({
        category: "membership",
        amountMinor: 30001,
        agentId: null,
        agentName: null,
        identityStatus: "unmatched",
      });
      expect(result.rows[0].categoryEvidence).toMatch(
        /exact provider subscription ID.*JLT membership.*monthly schedule/i
      );
      expect(result.currencies[0]).toMatchObject({
        membershipCount: 1,
        membershipGrossMinor: 30001,
        joiningCount: 0,
      });
      expect(mocks.get.mock.calls.map(call => call[0])).toEqual([
        "/subscriptions/" + encodeURIComponent("SB_EXTERNAL/ONE"),
      ]);
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );
  it.each([
    { name: "Other company Gold Membership" },
    { name: "JLT Gold Donation" },
    { name: "" },
    { interval_unit: "weekly" },
    { interval: 2 },
    { interval: "1" },
    { id: "SB_WRONG" },
    { links: { mandate: "MD_WRONG" } },
    { links: {} },
  ])(
    "unknown provider subscription evidence %j cannot classify membership",
    async patch => {
      const paid = monthly();
      const data = identities({
        subscriptions: [],
        mandates: [],
        users: [],
        sources: [],
      });
      mocks.get.mockResolvedValueOnce({ subscriptions: subscription(patch) });
      data.verifiedProviderMembershipSubscriptionIds =
        await readVerifiedProviderMembershipSubscriptionIds(
          [paid],
          data,
          injectedGet
        );
      expect(data.verifiedProviderMembershipSubscriptionIds).toEqual([]);
      const result = report([event(paid.id)], [paid], data);
      expect(result.rows[0]).toMatchObject({
        category: "unclassified",
        agentId: null,
        agentName: null,
        identityStatus: "unmatched",
      });
      expect(result.currencies[0]).toMatchObject({
        membershipCount: 0,
        unclassifiedGrossMinor: 30001,
      });
    }
  );
  it("provider subscription GET failure remains unclassified review, not an amount-based membership guess", async () => {
    const paid = monthly();
    const data = identities({
      subscriptions: [],
      mandates: [],
      users: [],
      sources: [],
    });
    mocks.get.mockRejectedValueOnce(
      new Error("Synthetic subscription GET unavailable")
    );
    data.verifiedProviderMembershipSubscriptionIds =
      await readVerifiedProviderMembershipSubscriptionIds(
        [paid],
        data,
        injectedGet
      );
    expect(data.verifiedProviderMembershipSubscriptionIds).toEqual([]);
    expect(report([event(paid.id)], [paid], data).rows[0].category).toBe(
      "unclassified"
    );
  });
  it("all payments referencing one unknown subscription must agree with its actual mandate", async () => {
    const payments = [monthly("PM_A"), monthly("PM_B", "MD_DIFFERENT")];
    mocks.get.mockResolvedValueOnce({ subscriptions: subscription() });
    expect(
      await readVerifiedProviderMembershipSubscriptionIds(
        payments,
        { subscriptions: [] },
        injectedGet
      )
    ).toEqual([]);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it("a referenced payment without a mandate prevents provider subscription verification", async () => {
    const paid = payment("PM_EXTERNAL", {
      description: "Regular charge",
      links: { subscription: "SB_EXTERNAL/ONE", payout: "PO_ONE" },
    });
    mocks.get.mockResolvedValueOnce({ subscriptions: subscription() });
    expect(
      await readVerifiedProviderMembershipSubscriptionIds(
        [paid],
        { subscriptions: [] },
        injectedGet
      )
    ).toEqual([]);
  });
  it("deduplicates unknown subscription GETs and never rereads locally verified subscription identities", async () => {
    const payments = [
      monthly("PM_A"),
      monthly("PM_B"),
      payment("PM_LOCAL", {
        description: "Monthly charge",
        links: { subscription: "SB_ONE", mandate: "MD_ONE" },
      }),
    ];
    mocks.get.mockResolvedValueOnce({ subscriptions: subscription() });
    expect(
      await readVerifiedProviderMembershipSubscriptionIds(
        payments,
        identities(),
        injectedGet
      )
    ).toEqual(["SB_EXTERNAL/ONE"]);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it("a verified external monthly subscription still cannot override explicit joining-fee conflict", () => {
    const paid = monthly();
    paid.description = "Joining fee";
    const result = report(
      [event(paid.id)],
      [paid],
      identities({
        subscriptions: [],
        mandates: [],
        users: [],
        sources: [],
        verifiedProviderMembershipSubscriptionIds: ["SB_EXTERNAL/ONE"],
      })
    );
    expect(result.rows[0]).toMatchObject({
      category: "unclassified",
      agentId: null,
      agentName: null,
    });
    expect(result.rows[0].reviewReason).toMatch(
      /conflicting joining-fee and subscription/i
    );
    expect(result.currencies[0].membershipCount).toBe(0);
  });
  it("provider subscription lookup has a bounded concurrency of four", async () => {
    const payments = Array.from({ length: 9 }, (_, index) =>
      payment(`PM_EXTERNAL_${index}`, {
        description: "Regular charge",
        links: {
          subscription: `SB_EXTERNAL_${index}`,
          mandate: `MD_EXTERNAL_${index}`,
        },
      })
    );
    let active = 0,
      peak = 0;
    mocks.get.mockImplementation(async (path: string) => {
      const id = path.slice("/subscriptions/".length);
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 0));
      active--;
      return {
        subscriptions: subscription({
          id,
          links: { mandate: id.replace("SB_", "MD_") },
        }),
      };
    });
    expect(
      await readVerifiedProviderMembershipSubscriptionIds(
        payments,
        { subscriptions: [] },
        injectedGet
      )
    ).toHaveLength(9);
    expect(peak).toBe(4);
  });
  it("subscription enrichment deadline leaves unknowns unverified without provider calls", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValue(46001);
    expect(
      await readVerifiedProviderMembershipSubscriptionIds(
        [monthly()],
        { subscriptions: [] },
        injectedGet
      )
    ).toEqual([]);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe("unmatched provider payer enrichment, synthetic GETs only", () => {
  it("a Faster Payments joining mandate different from the BACS mandate routes to verified name/source without assigning a Portal account", async () => {
    const paid = {
      ...payment("PM_FAST", { description: "Joining fee (discounted)" }),
      scheme: "faster_payments",
      links: {
        mandate: "MD_FAST/ONE",
        payout: "PO_ONE",
        creditor: "CR_SYNTHETIC",
      },
    };
    const rows = capturedIdentityRows();
    rows.recruitment_prospects = [];
    const { db, queries } = fakeDatabase({
      ...rows,
      recruitment_prospects: [
        { howHeard: "website", heardAbout: '["TikTok","website"]' },
      ],
    });
    const data = identities(); // MD_ONE is the unrelated BACS monthly-payment identity.
    const initial = report([event(paid.id)], [paid], data);
    expect(initial.rows[0]).toMatchObject({
      agentId: null,
      agentName: null,
      identityStatus: "unmatched",
    });
    mocks.get
      .mockResolvedValueOnce({
        mandates: {
          id: "MD_FAST/ONE",
          scheme: "faster_payments",
          links: { customer: "CU_FAST/ONE" },
        },
      })
      .mockResolvedValueOnce({
        customers: {
          id: "CU_FAST/ONE",
          given_name: "Synthetic",
          family_name: "Fast payer",
          email: " MEMBER@EXAMPLE.INVALID ",
        },
      });
    data.providerPayers = await readUnmatchedJoiningPayers(
      initial.rows,
      [paid],
      injectedGet
    );
    const result = report([event(paid.id)], [paid], data);
    expect(mocks.get.mock.calls.map(call => call[0])).toEqual([
      "/mandates/" + encodeURIComponent("MD_FAST/ONE"),
      "/customers/" + encodeURIComponent("CU_FAST/ONE"),
    ]);
    expect(result.rows[0]).toMatchObject({
      agentId: null,
      agentName: "Synthetic Fast payer",
      identityStatus: "unmatched",
      category: "joining_fee",
      amountMinor: 10000,
      sources: ["TikTok", "website"],
    });
    expect(result.rows[0].sourceEvidence).toMatch(
      /verified GoCardless payer name/i
    );
    expect(result.rows[0].sourceEvidence).toMatch(
      /no Portal account identity assigned/i
    );
    expect(result.rows[0].reviewReason).toMatch(
      /not linked to one verified Portal agent/i
    );
    expect(result.uniqueMatchedJoiners).toBe(0);
    expect(result.currencies[0].joiningGrossMinor).toBe(10000);
    expect(queries.map(query => query.table)).toEqual([
      "recruitment_prospects",
    ]);
    expect(queries[0].columns).toEqual(["howHeard", "heardAbout"]);
    expect(queries[0].params).toEqual(["member@example.invalid"]);
    expect(queries[0].where).toMatch(/LOWER\(TRIM\(/i);
    for (const method of [db.insert, db.update, db.delete, db.execute])
      expect(method).not.toHaveBeenCalled();
  });
  it("a Faster Payments joining payment with no mandate is explicitly unavailable for payer/source lookup", async () => {
    fakeDatabase();
    const paid = {
      ...payment("PM_FAST"),
      scheme: "faster_payments",
      links: { payout: "PO_ONE", creditor: "CR_SYNTHETIC" },
    };
    const data = identities();
    const initial = report([event(paid.id)], [paid], data);
    data.providerPayers = await readUnmatchedJoiningPayers(
      initial.rows,
      [paid],
      injectedGet
    );
    const row = report([event(paid.id)], [paid], data).rows[0];
    expect(row).toMatchObject({
      agentId: null,
      agentName: null,
      identityStatus: "unmatched",
      sources: ["Needs source review"],
    });
    expect(row.sourceEvidence).toMatch(/mandate|lookup.*unavailable/i);
    expect(row.sourceEvidence).not.toMatch(
      /no acquisition source was recorded/i
    );
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each(["mandate", "customer"])(
    "a failed %s GET yields explicit lookup-unavailable source evidence, not 'Not recorded'",
    async stage => {
      fakeDatabase();
      const paid = payment("PM_UNKNOWN", {
        links: { mandate: "MD_UNKNOWN", payout: "PO_ONE" },
      });
      const data = identities();
      if (stage === "customer")
        mocks.get.mockResolvedValueOnce({
          mandates: { id: "MD_UNKNOWN", links: { customer: "CU_UNKNOWN" } },
        });
      mocks.get.mockRejectedValueOnce(
        new Error("Synthetic provider read unavailable")
      );
      const initial = report([event(paid.id)], [paid], data);
      data.providerPayers = await readUnmatchedJoiningPayers(
        initial.rows,
        [paid],
        injectedGet
      );
      const row = report([event(paid.id)], [paid], data).rows[0];
      expect(row).toMatchObject({
        agentId: null,
        agentName: null,
        identityStatus: "unmatched",
        sources: ["Needs source review"],
      });
      expect(row.sourceEvidence).toMatch(/unavailable|could not|failed/i);
      expect(row.sourceEvidence).not.toMatch(
        /no acquisition source was recorded/i
      );
      expect(row.reviewReason).toMatch(/source is missing or ambiguous/i);
      expect(mocks.get).toHaveBeenCalledTimes(stage === "mandate" ? 1 : 2);
    }
  );
  it("a mandate without a linked customer yields explicit unverified source evidence", async () => {
    fakeDatabase();
    const paid = payment("PM_UNKNOWN", {
      links: { mandate: "MD_UNKNOWN", payout: "PO_ONE" },
    });
    mocks.get.mockResolvedValueOnce({
      mandates: { id: "MD_UNKNOWN", links: {} },
    });
    const initial = report([event(paid.id)], [paid]);
    const payers = await readUnmatchedJoiningPayers(
      initial.rows,
      [paid],
      injectedGet
    );
    expect(payers).toEqual([
      expect.objectContaining({
        paymentId: paid.id,
        name: null,
        sources: ["Needs source review"],
      }),
    ]);
    expect(payers[0].evidence).toMatch(/customer|unavailable/i);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it("deadline-excluded payer lookups retain explicit pending/unavailable source-review evidence for every target", async () => {
    fakeDatabase();
    const payments = ["PM_DEADLINE_A", "PM_DEADLINE_B"].map(id =>
      payment(id, { links: { mandate: "MD_UNKNOWN", payout: "PO_ONE" } })
    );
    const initial = report(
      payments.map(paid => event(paid.id)),
      payments
    );
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValue(46001);
    const payers = await readUnmatchedJoiningPayers(
      initial.rows,
      payments,
      injectedGet
    );
    expect(payers).toHaveLength(2);
    expect(payers.map(payer => payer.paymentId).sort()).toEqual(
      payments.map(paid => paid.id).sort()
    );
    for (const payer of payers) {
      expect(payer.sources).toEqual(["Needs source review"]);
      expect(payer.evidence).toMatch(
        /deadline|pending|unavailable|time limit/i
      );
      expect(payer.name).toBeNull();
    }
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("matched or ambiguous owners and non-joining income never enter provider-name enrichment", async () => {
    const { queries } = fakeDatabase();
    const base = report().rows[0];
    const rows = [
      { ...base, paymentId: "PM_MATCHED", identityStatus: "matched" as const },
      {
        ...base,
        paymentId: "PM_AMBIGUOUS",
        agentId: null,
        agentName: null,
        identityStatus: "ambiguous" as const,
      },
      {
        ...base,
        paymentId: "PM_MEMBER",
        category: "membership" as const,
        identityStatus: "unmatched" as const,
      },
    ];
    expect(
      await readUnmatchedJoiningPayers(
        rows,
        rows.map(row => payment(row.paymentId)),
        injectedGet
      )
    ).toEqual([]);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });
  it.each(["mandate", "customer"])(
    "a mismatching provider %s identity fails closed instead of displaying the wrong person's name",
    async stage => {
      fakeDatabase();
      const paid = payment("PM_UNKNOWN", {
        links: { mandate: "MD_UNKNOWN", payout: "PO_ONE" },
      });
      if (stage === "mandate")
        mocks.get.mockResolvedValueOnce({
          mandates: { id: "MD_WRONG", links: { customer: "CU_UNKNOWN" } },
        });
      else
        mocks.get
          .mockResolvedValueOnce({
            mandates: { id: "MD_UNKNOWN", links: { customer: "CU_UNKNOWN" } },
          })
          .mockResolvedValueOnce({
            customers: { id: "CU_WRONG", given_name: "Wrong synthetic person" },
          });
      const initial = report([event(paid.id)], [paid]);
      await expect(
        readUnmatchedJoiningPayers(initial.rows, [paid], injectedGet)
      ).rejects.toThrow(/identity did not match/i);
    }
  );
  it("verified provider payer email with no captured source really is Not recorded, distinct from lookup failure", async () => {
    fakeDatabase();
    const paid = payment("PM_UNKNOWN", {
      links: { mandate: "MD_UNKNOWN", payout: "PO_ONE" },
    });
    mocks.get
      .mockResolvedValueOnce({
        mandates: { id: "MD_UNKNOWN", links: { customer: "CU_UNKNOWN" } },
      })
      .mockResolvedValueOnce({
        customers: {
          id: "CU_UNKNOWN",
          given_name: "Synthetic",
          email: "no-source@example.invalid",
        },
      });
    const initial = report([event(paid.id)], [paid]);
    const payers = await readUnmatchedJoiningPayers(
      initial.rows,
      [paid],
      injectedGet
    );
    expect(payers[0]).toMatchObject({
      name: "Synthetic",
      sources: ["Not recorded"],
    });
    expect(payers[0].evidence).toMatch(/no acquisition source was recorded/i);
  });
  it("optional source-enrichment database failure is explicit review rather than a falsely absent source", async () => {
    const error = Object.assign(
      new Error("Synthetic source database read denied"),
      { code: "ER_TABLEACCESS_DENIED_ERROR" }
    );
    fakeDatabase({}, { recruitment_prospects: error });
    const paid = payment("PM_UNKNOWN", {
      links: { mandate: "MD_UNKNOWN", payout: "PO_ONE" },
    });
    mocks.get
      .mockResolvedValueOnce({
        mandates: { id: "MD_UNKNOWN", links: { customer: "CU_UNKNOWN" } },
      })
      .mockResolvedValueOnce({
        customers: { id: "CU_UNKNOWN", email: "synthetic@example.invalid" },
      });
    const initial = report([event(paid.id)], [paid]);
    const payers = await readUnmatchedJoiningPayers(
      initial.rows,
      [paid],
      injectedGet
    );
    expect(payers[0]).toMatchObject({
      paymentId: paid.id,
      name: null,
      sources: ["Needs source review"],
    });
    expect(payers[0].evidence).toMatch(/recorded-source query failed/i);
    expect(payers[0].evidence).not.toMatch(
      /no acquisition source was recorded/i
    );
  });
});

describe("real report service and super-admin route, entirely offline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("GOCARDLESS_ENVIRONMENT", "sandbox");
    vi.stubEnv(
      "GOCARDLESS_ACCESS_TOKEN",
      "synthetic-token-never-used-over-network"
    );
  });
  it("real service combines only provider event evidence with historical identity records", async () => {
    const { db } = fakeDatabase(capturedIdentityRows());
    mocks.get.mockResolvedValue(page([event()], [payment()]));
    const result = await getPaidOutIncomeReport(request);
    expect(result).toMatchObject({
      complete: true,
      source: "gocardless_paid_out_events",
      providerEnvironment: "sandbox",
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      asOf: NOW.toISOString(),
      earliestAvailableDate: "2025-05-06",
    });
    expect(result.rows[0]).toMatchObject({
      agentId: 42,
      sources: ["TikTok", "website"],
      category: "joining_fee",
    });
    expect(result.currencies[0].totalGrossMinor).toBe(10000);
    for (const method of [db.insert, db.update, db.delete, db.execute])
      expect(method).not.toHaveBeenCalled();
  });
  it("real service applies provider-only JLT subscription verification before classification without assigning an owner", async () => {
    fakeDatabase();
    const paid = payment("PM_EXTERNAL", {
      amount: 30001,
      description: "Regular charge",
      links: {
        subscription: "SB_EXTERNAL",
        mandate: "MD_EXTERNAL",
        payout: "PO_ONE",
      },
    });
    mocks.get
      .mockResolvedValueOnce(page([event(paid.id)], [paid]))
      .mockResolvedValueOnce({
        subscriptions: {
          id: "SB_EXTERNAL",
          name: "JLT Gold Membership",
          interval_unit: "monthly",
          interval: 1,
          status: "cancelled",
          links: { mandate: "MD_EXTERNAL" },
        },
      });
    const result = await getPaidOutIncomeReport(request);
    expect(result.rows[0]).toMatchObject({
      category: "membership",
      amountMinor: 30001,
      agentId: null,
      agentName: null,
      identityStatus: "unmatched",
    });
    expect(result.currencies[0]).toMatchObject({
      membershipCount: 1,
      membershipGrossMinor: 30001,
    });
    expect(mocks.get.mock.calls.map(call => call[0]).slice(1)).toEqual([
      "/subscriptions/SB_EXTERNAL",
    ]);
  });
  it.each(["non-JLT", "unavailable"])(
    "real service retains unknown subscription %s as unclassified review",
    async outcome => {
      fakeDatabase();
      const paid = payment("PM_EXTERNAL", {
        amount: 30001,
        description: "Regular charge",
        links: {
          subscription: "SB_EXTERNAL",
          mandate: "MD_EXTERNAL",
          payout: "PO_ONE",
        },
      });
      mocks.get.mockResolvedValueOnce(page([event(paid.id)], [paid]));
      if (outcome === "unavailable")
        mocks.get.mockRejectedValueOnce(
          new Error("Synthetic provider unavailable")
        );
      else
        mocks.get.mockResolvedValueOnce({
          subscriptions: {
            id: "SB_EXTERNAL",
            name: "Other company membership",
            interval_unit: "monthly",
            interval: 1,
            links: { mandate: "MD_EXTERNAL" },
          },
        });
      const result = await getPaidOutIncomeReport(request);
      expect(result.rows[0]).toMatchObject({
        category: "unclassified",
        agentId: null,
        agentName: null,
        identityStatus: "unmatched",
      });
      expect(result.currencies[0]).toMatchObject({
        membershipCount: 0,
        unclassifiedGrossMinor: 30001,
      });
      expect(mocks.get).toHaveBeenCalledTimes(2);
    }
  );
  it("real service retains source review when its actual Faster Payments mandate lookup fails", async () => {
    fakeDatabase();
    const paid = {
      ...payment("PM_FAST"),
      scheme: "faster_payments",
      links: { mandate: "MD_FAST", payout: "PO_ONE", creditor: "CR_SYNTHETIC" },
    };
    mocks.get
      .mockResolvedValueOnce(page([event(paid.id)], [paid]))
      .mockRejectedValueOnce(new Error("Synthetic mandate lookup unavailable"));
    const result = await getPaidOutIncomeReport(request);
    expect(result.rows[0]).toMatchObject({
      category: "joining_fee",
      amountMinor: 10000,
      agentId: null,
      agentName: null,
      sources: ["Needs source review"],
    });
    expect(result.rows[0].sourceEvidence).toMatch(/lookup unavailable/i);
    expect(result.currencies[0].joiningGrossMinor).toBe(10000);
    expect(mocks.get.mock.calls.map(call => call[0]).slice(1)).toEqual([
      "/mandates/MD_FAST",
    ]);
  });
  it("conflicting provider event identities throw without receipt, recovery or enrichment processing", async () => {
    fakeDatabase(capturedIdentityRows());
    mocks.get.mockResolvedValue(
      page(
        [
          event(),
          event("PM_ONE", {
            links: { payment: "PM_ONE", payout: "PO_CONFLICT" },
          }),
        ],
        [payment()]
      )
    );
    await expect(getPaidOutIncomeReport(request)).rejects.toThrow(
      /conflicting copies/
    );
    for (const effect of effects) expect(effect).not.toHaveBeenCalled();
  });
  it("range validation happens before either provider or database read", async () => {
    await expect(
      getPaidOutIncomeReport({
        rangeStart: "2026-02-30",
        rangeEnd: "2026-11-05",
        refreshKey: 1,
      })
    ).rejects.toThrow(/valid date range/);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("cache is scoped to provider token/environment and refresh forces a new read", async () => {
    fakeDatabase(capturedIdentityRows());
    mocks.get.mockResolvedValue(page([event()], [payment()]));
    const range = { rangeStart: "2026-11-01", rangeEnd: "2026-11-03" };
    const first = await getPaidOutIncomeReport({ ...range, refreshKey: 1 });
    expect(await getPaidOutIncomeReport(range)).toBe(first);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    await getPaidOutIncomeReport({ ...range, refreshKey: 2 });
    expect(mocks.get).toHaveBeenCalledTimes(2);
    vi.stubEnv("GOCARDLESS_ACCESS_TOKEN", "other-synthetic-token");
    await getPaidOutIncomeReport(range);
    expect(mocks.get).toHaveBeenCalledTimes(3);
    vi.stubEnv("GOCARDLESS_ENVIRONMENT", "live");
    expect((await getPaidOutIncomeReport(range)).providerEnvironment).toBe(
      "live"
    );
    expect(mocks.get).toHaveBeenCalledTimes(4);
  });
  it.each([null, "agent", "admin"])(
    "role %s is blocked before service performs any read",
    async role => {
      await expect(caller(role).paidOutIncome(request)).rejects.toMatchObject({
        code: role ? "FORBIDDEN" : "UNAUTHORIZED",
      });
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );
  it("super-admin route invokes the actual service and returns its complete evidence report", async () => {
    fakeDatabase(capturedIdentityRows());
    mocks.get.mockResolvedValue(page([event()], [payment()]));
    const result = await caller("super_admin").paidOutIncome(request);
    expect(result).toMatchObject({
      complete: true,
      source: "gocardless_paid_out_events",
    });
    expect(result.rows[0].paymentId).toBe("PM_ONE");
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it("sanitizes unexpected provider/server error details rather than exposing secrets or false totals", async () => {
    mocks.get.mockRejectedValue(
      new Error(
        "Bearer SECRET_TOKEN sql SELECT personal_email FROM users https://private.invalid"
      )
    );
    const error = await caller("super_admin")
      .paidOutIncome(request)
      .catch(error => error);
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Paid-out income could not be verified. No complete totals are shown; please retry.",
    });
    expect(error.message).not.toMatch(
      /SECRET_TOKEN|personal_email|private\.invalid/
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("keeps a safe actionable date validation error without provider access", async () => {
    await expect(
      caller("super_admin").paidOutIncome({
        ...request,
        rangeStart: "2026-11-06",
        rangeEnd: "2026-11-06",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "The report cannot start in the future",
    });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("invalid route schema is rejected before any read", async () => {
    await expect(
      caller("super_admin").paidOutIncome({ ...request, rangeStart: "bad" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
