import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), execute: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./membership-payment-control-procedures", () => ({ membershipPaymentControlProcedures: {} }));
import {
  membershipPaymentsRouter,
  normalizePaymentIssue,
} from "./membership-payment-issues-router";

const dialect = new MySqlDialect();
const uiSource = readFileSync(
  new URL(
    "../client/src/pages/crm/MembershipPaymentIssues.tsx",
    import.meta.url
  ),
  "utf8"
).replace(/\s+/g, " ");
const routerSource = readFileSync(
  new URL("./membership-payment-issues-router.ts", import.meta.url),
  "utf8"
);
const membershipsSource = readFileSync(
  new URL("../client/src/pages/crm/Memberships.tsx", import.meta.url),
  "utf8"
);
function caller(role: "admin" | "super_admin" | "agent" | null = "admin") {
  return membershipPaymentsRouter.createCaller({
    user: role ? { id: 7, role } : null,
    req: {},
    res: {},
  } as unknown as TrpcContext);
}
function row(
  overrides: Partial<Parameters<typeof normalizePaymentIssue>[0]> = {}
): Parameters<typeof normalizePaymentIssue>[0] {
  return {
    userId: 42,
    name: "Review Agent",
    email: "agent@example.test",
    uniqueAgentId: "JLT-0042",
    agentStatus: "active",
    portalStatus: "active",
    isActive: 1,
    paymentExempt: 0,
    suspensionReason: null,
    accountPresent: 1,
    failedAttempts: 0,
    outstandingCount: 0,
    outstandingPence: 0,
    lastFailedAt: null,
    lastSyncedAt: null,
    lastError: null,
    historyReviewRequired: 0,
    mandateId: "MD_CURRENT",
    mandateStatus: "active",
    mandateUpdatedAt: null,
    subscriptionId: "SB_CURRENT",
    subscriptionStatus: "active",
    pendingFeeCount: 0,
    pendingFeePence: 0,
    feeReviewCount: 0,
    deliveryIssueCount: 0,
    mailPendingCount: 0,
    mailAcceptedCount: 0,
    ddIssue: 0,
    onboardingDd: 0,
    reviewIssue: 0,
    ...overrides,
  };
}
function results(...sets: unknown[][]) {
  for (const rows of sets) mocks.execute.mockResolvedValueOnce([rows, []]);
}
function queryAt(index: number) {
  return dialect.sqlToQuery(mocks.execute.mock.calls[index][0] as SQL);
}

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.getDb.mockReset();
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
});

describe("membershipPayments read-only API", () => {
  it.each([null, "agent"] as const)(
    "blocks %s on every procedure before accessing DB",
    async role => {
      await expect(caller(role).listIssues({})).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(caller(role).overview({})).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller(role).accountDetail({ userId: 42 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );

  it.each(["admin", "super_admin"] as const)(
    "allows %s to read bounded accounts",
    async role => {
      results([], [{ total: 1 }], [row()]);
      const data = await caller(role).listIssues({});
      expect(data).toMatchObject({
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });
      expect(data.items).toHaveLength(1);
      expect(data.items[0].crmHref).toBe("/crm/agents?agent=42&tab=dd");
      const query = queryAt(2);
      expect(query.sql).toContain("LIMIT ? OFFSET ?");
      expect(query.params.slice(-2)).toEqual([25, 0]);
    }
  );

  it("rejects unbounded or invalid inputs before a database read", async () => {
    for (const input of [
      { pageSize: 51 },
      { page: 0 },
      { page: 1.5 },
      { search: "x".repeat(201) },
      { filter: "failed" },
    ]) {
      await expect(caller().listIssues(input as never)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("counts in SQL and clamps stale page numbers, never loads every account for pagination", async () => {
    results([], [{ total: 61 }], [row()]);
    const data = await caller().listIssues({
      page: 9,
      pageSize: 50,
      search: "Agent",
    });
    expect(data).toMatchObject({ page: 2, totalPages: 2 });
    expect(queryAt(1).sql).toContain("SELECT COUNT(*) AS total");
    expect(queryAt(2).params.slice(-2)).toEqual([50, 50]);
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });

  it("parameterises search and escapes SQL LIKE wildcard characters", async () => {
    results([], [{ total: 0 }], []);
    await caller().listIssues({ search: "O'Neil%_!" });
    const query = queryAt(1);
    expect(query.sql).not.toContain("O'Neil");
    expect(query.sql).toContain("ESCAPE '!'");
    expect(query.params).toContain("%O'Neil!%!_!!%");
  });

  it.each(["all", "arrears", "dd", "delivery", "review", "resolved"] as const)(
    "supports the %s SQL filter",
    async filter => {
      results([], [{ total: 0 }], []);
      const data = await caller().listIssues({ filter });
      expect(data.total).toBe(0);
      const query = queryAt(1).sql;
      if (filter === "arrears")
        expect(query).toContain("WHERE outstandingCount > 0");
      if (filter === "resolved")
        expect(query).toContain(
          "accountPresent = 1 AND lastSyncedAt IS NOT NULL AND NOT"
        );
    }
  );

  it("uses account state, newest updated mandate, and no historical event failure joins", async () => {
    results(
      [],
      [{ total: 1 }],
      [
        row({
          lastFailedAt: "2026-01-01",
          outstandingCount: 0,
          failedAttempts: 0,
        }),
      ]
    );
    const data = await caller().listIssues({ filter: "resolved" });
    expect(data.items[0]).toMatchObject({
      outstandingCount: 0,
      amountUnknown: false,
    });
    const query = queryAt(2).sql;
    expect(query).toContain(
      "ORDER BY latest_m.createdAt DESC, latest_m.id DESC LIMIT 1"
    );
    expect(query).toContain("latest_s.mandateId = `gc_mandates`.`mandateId`");
    expect(query).not.toContain("gc_payment_events");
    expect(query).toContain(
      "NOT IN ('cancelled', 'paused', 'departed', 'left')"
    );
    expect(query).toContain("AS onboardingDd");
  });

  it("shows unknown outstanding amounts explicitly and preserves manual suspension", () => {
    const account = normalizePaymentIssue(
      row({
        outstandingCount: 2,
        outstandingPence: null,
        agentStatus: "suspended",
        isActive: 0,
        suspensionReason: "manual",
      })
    );
    expect(account).toMatchObject({
      amountUnknown: true,
      outstandingPence: null,
      outstandingCount: 2,
      isActive: false,
      suspensionReason: "manual",
    });
  });

  it.each(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"])(
    "surfaces %s as schema update required, not empty success",
    async code => {
      mocks.execute.mockRejectedValueOnce({ cause: { code } });
      await expect(caller().listIssues({})).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("Schema update required"),
      });
    }
  );

  it("does not hide database outages", async () => {
    mocks.getDb.mockResolvedValue(null);
    await expect(caller().overview({})).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    mocks.getDb.mockResolvedValue({ execute: mocks.execute });
    mocks.execute.mockRejectedValueOnce({ code: "ER_ACCESS_DENIED_ERROR" });
    await expect(caller().listIssues({})).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("reports paused uninitialised control with no invented sync success", async () => {
    results(
      [],
      [],
      [{ agents: 1, issueAgents: 1, historicalReviewRequiredAgents: 1 }]
    );
    const data = await caller().overview({});
    expect(data.health).toMatchObject({
      enabled: false,
      controlPresent: false,
      stale: true,
      lastSuccessAt: null,
      historicalReviewComplete: false,
    });
  });

  it("reports stored control health and converts SQL aggregate strings to numbers", async () => {
    const now = new Date();
    results(
      [],
      [
        {
          enabled: 0,
          lastSuccessAt: now,
          lastEventSyncAt: now,
          lastError: "Provider rate limited",
        },
      ],
      [
        {
          issueAgents: "3",
          historicalReviewRequiredAgents: "2",
          mailAcceptedCount: "4",
        },
      ]
    );
    const data = await caller().overview({});
    expect(data.counts).toMatchObject({ issueAgents: 3, mailAcceptedCount: 4 });
    expect(data.health).toMatchObject({
      enabled: false,
      stale: false,
      lastError: "Provider rate limited",
      historicalReviewComplete: false,
    });
  });

  it("bounds payment, fee and mail review references to 20 with explicit truncation", async () => {
    const records = Array.from({ length: 21 }, (_, id) => ({ id }));
    results([], [row()], records, records, records);
    const data = await caller().accountDetail({ userId: 42 });
    expect(data.payments).toHaveLength(20);
    expect(data.fees).toHaveLength(20);
    expect(data.mail).toHaveLength(20);
    expect(data.truncated).toEqual({ payments: true, fees: true, mail: true });
    for (const index of [2, 3, 4]) {
      expect(queryAt(index).sql).toContain("LIMIT 21");
      expect(queryAt(index).params).toContain(42);
    }
  });

  it("returns NOT_FOUND for an unknown account", async () => {
    results([], []);
    await expect(caller().accountDetail({ userId: 404 })).rejects.toMatchObject(
      { code: "NOT_FOUND" }
    );
  });

  it("exposes queries only and imports no sending, collection or synchronisation code", () => {
    for (const procedure of Object.values(
      membershipPaymentsRouter._def.procedures
    ))
      expect(procedure._def.type).toBe("query");
    expect(routerSource).not.toMatch(/\.(mutation|insert|update|delete)\s*\(/);
    expect(routerSource).not.toMatch(
      /from ["']\.\/(gocardless|email|membership-payment-processor)/
    );
  });
});

describe("payment issues UI safety source", () => {
  it("keeps finance transport server-side and exposes no collection or reinstatement shortcuts", () => {
    expect(uiSource).not.toMatch(
      /\bfetch\(|axios|Sync GoCardless|Collect now|Reinstate/
    );
    expect(uiSource).toContain("Refresh view");
    expect(uiSource).toContain("void overview.refetch()");
    expect(uiSource).toContain("void issues.refetch()");
    expect(uiSource).toContain("Manual suspensions remain unchanged");
    expect(uiSource).toContain("not delivery confirmed");
    expect(uiSource).toContain("Amount unknown");
  });

  it("shows health, schema, error, onboarding, review and freshness states", () => {
    for (const text of [
      "Automation paused",
      "Schema update required",
      "Last successful sync",
      "Reviewed historical issues",
      "Onboarding — DD setup needed",
      "Do not interpret unavailable",
      "over 15 minutes",
    ])
      expect(uiSource).toContain(text);
    expect(uiSource).not.toContain("Accordion");
    expect(uiSource).toContain("reviewUserId !== null");
    expect(uiSource).toContain("pageSize: 25");
    expect(uiSource).toContain('aria-label="Next page"');
  });

  it("registers the new tab without replacing the existing membership panels", () => {
    expect(membershipsSource).toContain("Payment &amp; Direct Debit Issues");
    expect(membershipsSource).toContain('<TabsContent value="payment_issues">');
    expect(membershipsSource).toContain("<MembershipPaymentIssues />");
    for (const tab of [
      "new_signups",
      "in_notice",
      "paused",
      "suspended",
      "offboarding",
    ])
      expect(membershipsSource).toContain(`<TabsContent value="${tab}">`);
  });
});
