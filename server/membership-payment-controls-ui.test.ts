import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  reconcile: vi.fn(),
  settle: vi.fn(),
  update: vi.fn(),
  role: "admin" as string | undefined,
  reads: [] as unknown[][],
  health: {
    enabled: false,
    activatedAt: null,
    controlPresent: true,
    feePolicyApproved: false,
    feeAmountPence: 2500,
    feeCollectionMode: "staff_approval",
    stale: true,
    lastError: null,
  },
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./membership-payment-sync", () => ({
  reconcileMembershipPayments: mocks.reconcile,
}));
vi.mock("./membership-payment-service", () => ({
  recordManualMembershipSettlement: mocks.settle,
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: mocks.role ? { role: mocks.role } : null }),
}));
vi.mock("@/lib/trpc", () => {
  const query = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
  const node = (path = ""): unknown =>
    new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useUtils") return () => node();
          if (key === "invalidate") return vi.fn().mockResolvedValue(undefined);
          if (key === "useMutation")
            return () => ({
              mutate: vi.fn(),
              reset: vi.fn(),
              isPending: false,
              error: null,
            });
          if (key === "useQuery")
            return () =>
              path === "membershipPayments.overview"
                ? query({
                    health: mocks.health,
                    counts: {},
                    readAt: new Date("2026-10-01T00:00:00Z"),
                  })
                : query({ items: [], total: 0, page: 1, totalPages: 1 });
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
  return { trpc: node() };
});
import { router } from "./_core/trpc";
import { membershipPaymentControlProcedures } from "./membership-payment-control-procedures";
import MembershipPaymentIssues, {
  automationConfirmation,
  canRecordFeeSettlement,
  canRecordPaymentSettlement,
  feePolicyAmountPence,
  reconciliationMessage,
} from "../client/src/pages/crm/MembershipPaymentIssues";

const source = readFileSync(
  new URL(
    "../client/src/pages/crm/MembershipPaymentIssues.tsx",
    import.meta.url
  ),
  "utf8"
).replace(/\s+/g, " ");
const controls = router(membershipPaymentControlProcedures);
function caller(role: string | null = "admin") {
  return controls.createCaller({
    user: role ? { id: 7, role } : null,
    req: {},
    res: {},
  } as unknown as TrpcContext);
}
function currentState(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    enabled: false,
    activatedAt: null,
    lastSuccessAt: new Date(),
    lastEventSyncAt: new Date(),
    lastError: null,
    ...overrides,
  };
}
const receipt = {
  userId: 42,
  paymentId: "PM_EXACT",
  amountPence: 12345,
  reference: "BANK-123",
  notes: "Verified cleared bank transfer",
  settledAt: "2026-10-01T10:00:00.000Z",
  confirmation: "RECORD PAYMENT RECEIVED" as const,
};
const feeReceipt = {
  feeId: 9,
  reference: "BANK-FEE",
  notes: "Verified fee transfer",
  confirmation: "RECORD FEE RECEIVED" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  mocks.role = "admin";
  mocks.health.lastError = null;
  mocks.reads = [];
  const db = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          const rows = mocks.reads.shift() ?? [];
          return Object.assign(Promise.resolve(rows), {
            for: () => Promise.resolve(rows),
          });
        },
      }),
    })),
    update: mocks.update,
    transaction: async (work: (tx: unknown) => unknown) => work(db),
  };
  mocks.update.mockImplementation(() => ({
    set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }),
  }));
  mocks.getDb.mockResolvedValue(db);
  mocks.reconcile.mockResolvedValue({
    skipped: "another reconciliation is running",
  });
  mocks.settle.mockResolvedValue({
    settlement: { id: 1 },
    account: { outstandingCount: 0 },
  });
});

describe("payment controls UI safety", () => {
  it.each(["admin", "super_admin"])(
    "allows %s only known positive whole GBP outstanding payments",
    role => {
      expect(
        canRecordPaymentSettlement(role, {
          status: "outstanding",
          amountPence: 12345,
          currency: "GBP",
        })
      ).toBe(true);
      for (const status of [
        "paid",
        "pending",
        "settled",
        "failed",
        "review",
        "cancelled",
      ])
        expect(
          canRecordPaymentSettlement(role, {
            status,
            amountPence: 12345,
            currency: "GBP",
          })
        ).toBe(false);
      for (const amountPence of [null, 0, -1, 1.5, Number.NaN])
        expect(
          canRecordPaymentSettlement(role, {
            status: "outstanding",
            amountPence,
            currency: "GBP",
          })
        ).toBe(false);
      for (const currency of [null, "EUR", "USD", "gbp"])
        expect(
          canRecordPaymentSettlement(role, {
            status: "outstanding",
            amountPence: 12345,
            currency,
          })
        ).toBe(false);
    }
  );

  it.each([undefined, "agent", "finance", "support"])(
    "does not expose receipt actions to %s",
    role => {
      expect(
        canRecordPaymentSettlement(role, {
          status: "outstanding",
          amountPence: 100,
          currency: "GBP",
        })
      ).toBe(false);
      expect(canRecordFeeSettlement(role, "assessed")).toBe(false);
    }
  );

  it("restricts fee receipt actions to assessed only, never review/failed/pending/paid", () => {
    expect(canRecordFeeSettlement("admin", "assessed")).toBe(true);
    expect(canRecordFeeSettlement("super_admin", "assessed")).toBe(true);
    for (const status of [
      "review",
      "failed",
      "collection_pending",
      "paid",
      "waived",
      "pending",
    ])
      expect(canRecordFeeSettlement("admin", status)).toBe(false);
    expect(source).toContain("canRecordFeeSettlement(user?.role, fee.status)");
    expect(source).toContain("canRecordPaymentSettlement(user?.role, payment)");
  });

  it.each([
    ["", null],
    [" ", null],
    ["0", null],
    ["-1", null],
    ["1.001", null],
    ["1000.01", null],
    ["NaN", null],
    ["1e2", null],
    ["0.01", 1],
    ["19.99", 1999],
    ["1000", 100000],
    ["12.3", 1230],
  ] as const)(
    "validates explicit fee amount %j as %j pence",
    (value, expected) => {
      expect(feePolicyAmountPence(value)).toBe(expected);
    }
  );

  it("renders blank/unapproved policy and role-gates Super Admin controls", () => {
    const admin = renderToStaticMarkup(
      React.createElement(MembershipPaymentIssues)
    );
    expect(admin).toContain("Run provider reconciliation");
    expect(admin).toContain("Refresh view");
    expect(admin).toContain("Admin fee amount pending policy approval");
    expect(admin).not.toContain("£25");
    expect(admin).not.toContain("Enable future payment rules");
    expect(admin).not.toContain("Approve admin fee policy");
    mocks.role = "super_admin";
    const superAdmin = renderToStaticMarkup(
      React.createElement(MembershipPaymentIssues)
    );
    expect(superAdmin).toContain("Enable future payment rules");
    expect(superAdmin).toContain("Approve admin fee policy");
    mocks.role = "agent";
    const agent = renderToStaticMarkup(
      React.createElement(MembershipPaymentIssues)
    );
    expect(agent).toContain("restricted to authorised staff");
    expect(agent).not.toContain("Run provider reconciliation");
  });

  it("requires typed confirmations and displays exact automation payload without silent enable", () => {
    expect(automationConfirmation(true)).toBe("ENABLE FUTURE PAYMENT RULES");
    expect(automationConfirmation(false)).toBe("PAUSE PAYMENT RULES");
    expect(source).toContain("confirmation !== expected");
    expect(source).toContain("{ enabled, confirmation: expected }");
    expect(source).toContain(
      "automation.mutate({ enabled, confirmation: automationConfirmation(enabled), })"
    );
    expect(source).toContain('const [feeAmount, setFeeAmount] = useState("")');
    expect(source).toContain("APPROVE ADMIN FEE POLICY");
    expect(source).toContain("healthy, complete current provider ledger scan");
    expect(source).toContain("Resume already activated future work");
    expect(source).not.toMatch(/useEffect|onMutate|\.setData\(/);
  });

  it("separates read refresh from reconciliation, invalidates appropriate financial/CRM queries", () => {
    expect(source).toContain("void overview.refetch()");
    expect(source).toContain("void issues.refetch()");
    expect(source).toContain("reconcile.mutate({})");
    for (const text of [
      "utils.membershipPayments.invalidate()",
      "utils.crm.agentCrm.invalidate()",
      "utils.gocardless.adminGetCurrentPaymentIssues.invalidate()",
      "utils.gocardless.adminGetPaymentEvents.invalidate()",
      "utils.gocardless.adminGetDdStatus.invalidate()",
      "utils.gocardless.adminGetPaymentSchedule.invalidate()",
    ])
      expect(source).toContain(text);
    expect(source).toContain("not provider last success");
    expect(source).not.toMatch(/\bfetch\(|axios|Collect now|Sync GoCardless/);
  });

  it("retains exact whole-payment receipt, bank verification warning, UTC audit and no access claim", () => {
    for (const text of [
      "Exact full amount",
      "Whole outstanding payment only",
      "Only record money actually received by bank transfer",
      "does not initiate a payment",
      "automatically reinstate membership",
      "paymentId: target.paymentId",
      "amountPence: target.amountPence",
      "settledAt: receivedDate.toISOString()",
      "RECORD PAYMENT RECEIVED",
      "RECORD FEE RECEIVED",
      "reference: reference.trim()",
      "notes: notes.trim()",
      "receivedDate.getTime() <= Date.now()",
      "data.account.outstandingPence",
    ])
      expect(source).toContain(text);
    expect(source).not.toContain("Accordion");
    expect(source).toContain("pageSize: 25");
    expect(source).toContain("not delivery confirmed");
  });

  it("reports skip, backlog and recovery errors without invented success", () => {
    expect(reconciliationMessage({ skipped: "busy" })).toContain("not run");
    expect(reconciliationMessage({})).toContain("needs review");
    for (const recovered of [
      { completed: 2, errors: 1, backlog: 0 },
      { completed: 2, errors: 0, backlog: 3 },
    ]) {
      const message = reconciliationMessage({ eventCount: 5, recovered });
      expect(message).toContain("No healthy status is implied");
      expect(message).not.toContain("reconciliation completed");
    }
    const message = reconciliationMessage({
      eventCount: 5,
      recovered: { completed: 5, errors: 0, backlog: 0 },
      notifications: { failed: 2, ambiguous: 1 },
    });
    expect(message).toContain("Mail failures: 2");
    expect(message).toContain("uncertain acceptance: 1");
    expect(message).toContain("not proof of collection or email delivery");
  });
});

describe("membership payment control server boundaries (isolated adapters)", () => {
  it.each([null, "agent", "finance", "support"])(
    "rejects %s on every mutation before adapters",
    async role => {
      const api = caller(role);
      for (const work of [
        () => api.refreshFromProvider({}),
        () =>
          api.setAutomation({
            enabled: true,
            confirmation: automationConfirmation(true),
          }),
        () =>
          api.approveFeePolicy({
            amountPence: 1900,
            confirmation: "APPROVE ADMIN FEE POLICY",
          }),
        () => api.recordSettlement(receipt),
        () => api.recordFeeSettlement(feeReceipt),
      ])
        await expect(work()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocks.getDb).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
      expect(mocks.settle).not.toHaveBeenCalled();
    }
  );

  it("requires Super Admin approval for automation and fees even when caller is staff", async () => {
    await expect(
      caller().setAutomation({
        enabled: true,
        confirmation: automationConfirmation(true),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().approveFeePolicy({
        amountPence: 1900,
        confirmation: "APPROVE ADMIN FEE POLICY",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "rejects mismatched typed automation confirmation for enabled=%s",
    async enabled => {
      await expect(
        caller("super_admin").setAutomation({
          enabled,
          confirmation: automationConfirmation(!enabled),
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );

  it.each([0, -1, 1.5, 100001])(
    "rejects invalid fee amount %s before DB",
    async amountPence => {
      await expect(
        caller("super_admin").approveFeePolicy({
          amountPence,
          confirmation: "APPROVE ADMIN FEE POLICY",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );

  it("approves the explicit amount with staff-approval collection mode only", async () => {
    const set = vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    }));
    mocks.update.mockReturnValue({ set });
    const result = await caller("super_admin").approveFeePolicy({
      amountPence: 1900,
      confirmation: "APPROVE ADMIN FEE POLICY",
    });
    expect(set).toHaveBeenCalledWith({
      feePolicyApproved: true,
      feeAmountPence: 1900,
      feeCollectionMode: "staff_approval",
    });
    expect(result).toMatchObject({
      amountPence: 1900,
      collectionMode: "staff_approval",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("requires a first complete current healthy scan with no pending events", async () => {
    for (const reads of [
      [],
      [currentState({ lastSuccessAt: null })],
      [currentState({ lastSuccessAt: new Date(Date.now() - 16 * 60 * 1000) })],
      [currentState({ lastError: "mapping issue" })],
    ]) {
      mocks.reads = [reads];
      await expect(
        caller("super_admin").setAutomation({
          enabled: true,
          confirmation: automationConfirmation(true),
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
    mocks.reads = [[currentState()], [{ count: 2 }], [{ count: 0 }]];
    await expect(
      caller("super_admin").setAutomation({
        enabled: true,
        confirmation: automationConfirmation(true),
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("first activates only after healthy reconciliation and resumes already activated pending future work", async () => {
    mocks.reads = [[currentState()], [{ count: 0 }], [{ count: 0 }]];
    await expect(
      caller("super_admin").setAutomation({
        enabled: true,
        confirmation: automationConfirmation(true),
      })
    ).resolves.toMatchObject({ enabled: true, activatedAt: expect.any(Date) });
    const activatedAt = new Date("2026-01-01T00:00:00Z");
    mocks.reads = [
      [
        currentState({
          activatedAt,
          lastSuccessAt: null,
          lastError: "pending future work",
        }),
      ],
      [{ count: 2 }],
      [{ count: 0 }],
    ];
    await expect(
      caller("super_admin").setAutomation({
        enabled: true,
        confirmation: automationConfirmation(true),
      })
    ).resolves.toEqual({ enabled: true, activatedAt });
  });

  it("does not resume failed provider events but permits an explicit pause despite stale/error health", async () => {
    mocks.reads = [
      [currentState({ activatedAt: new Date() })],
      [{ count: 1 }],
      [{ count: 1 }],
    ];
    await expect(
      caller("super_admin").setAutomation({
        enabled: true,
        confirmation: automationConfirmation(true),
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    mocks.reads = [
      [currentState({ lastSuccessAt: null, lastError: "failure" })],
      [{ count: 1 }],
      [{ count: 1 }],
    ];
    await expect(
      caller("super_admin").setAutomation({
        enabled: false,
        confirmation: automationConfirmation(false),
      })
    ).resolves.toMatchObject({ enabled: false });
  });

  it("forwards exact whole-payment amount, receipt audit, UTC date and actor only after confirmation", async () => {
    await caller().recordSettlement(receipt);
    expect(mocks.settle).toHaveBeenCalledWith({ ...receipt, actorId: 7 });
    mocks.settle.mockClear();
    for (const overrides of [
      { confirmation: "yes" },
      { amountPence: 0 },
      { reference: " " },
      { notes: " " },
      { settledAt: "2026-10-01T10:00:00" },
    ])
      await expect(
        caller().recordSettlement({ ...receipt, ...overrides } as never)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("surfaces service rejection rather than reporting a receipt success", async () => {
    mocks.settle.mockRejectedValueOnce(
      new Error(
        "Manual settlement must equal the full outstanding payment amount"
      )
    );
    await expect(caller().recordSettlement(receipt)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("full outstanding"),
    });
  });

  it.each(["review", "failed", "collection_pending", "paid"])(
    "rejects manual fee receipt for %s",
    async status => {
      mocks.reads = [[{ id: 9, status }]];
      await expect(
        caller().recordFeeSettlement(feeReceipt)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(mocks.update).not.toHaveBeenCalled();
    }
  );

  it("records only an assessed fee with actor and reference evidence", async () => {
    const set = vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    }));
    mocks.update.mockReturnValue({ set });
    mocks.reads = [[{ id: 9, status: "assessed", notes: "Original audit" }]];
    await expect(
      caller().recordFeeSettlement(feeReceipt)
    ).resolves.toMatchObject({ paid: true, feeId: 9 });
    expect(set).toHaveBeenCalledWith({
      status: "paid",
      settledById: 7,
      notes: expect.stringContaining("BANK-FEE"),
    });
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("passes provider skip and errors through without inventing reconciliation health", async () => {
    await expect(caller().refreshFromProvider({})).resolves.toEqual({
      skipped: "another reconciliation is running",
    });
    mocks.reconcile.mockRejectedValueOnce(
      new Error("3 payment events await recovery; no healthy status reported")
    );
    await expect(caller().refreshFromProvider({})).rejects.toThrow(
      "no healthy status reported"
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});
