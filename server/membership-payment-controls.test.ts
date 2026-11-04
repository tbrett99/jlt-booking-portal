import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  settle: vi.fn(),
  ignore: vi.fn(),
  getDb: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./membership-payment-sync", () => ({
  reconcileMembershipPayments: mocks.reconcile,
}));
vi.mock("./membership-payment-service", () => ({
  recordManualMembershipSettlement: mocks.settle,
  ignoreMembershipPayment: mocks.ignore,
}));
import { membershipPaymentControlProcedures } from "./membership-payment-control-procedures";

const controls = router(membershipPaymentControlProcedures);
const caller = (role: string | null, actorId = 7) =>
  controls.createCaller({
    user: role ? { id: actorId, role } : null,
    req: {},
    res: {},
  } as TrpcContext);
const ignorePayment = {
  userId: 42,
  paymentId: "PM_FIXTURE",
  amountPence: 9900,
  reason: "Approved exception for this outstanding payment",
  confirmation: "IGNORE OUTSTANDING PAYMENT" as const,
};

function expectNoOtherPaymentActions() {
  expect(mocks.getDb).not.toHaveBeenCalled();
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(mocks.settle).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("membership payment control boundaries", () => {
  it.each([null, "agent"])("blocks recovery to non-staff %s", async role => {
    await expect(caller(role).refreshFromProvider({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("calls the canonical recovery service and does not hide provider errors", async () => {
    mocks.reconcile.mockResolvedValueOnce({
      automationEnabled: false,
      eventCount: 4,
    });
    expect(await caller("admin").refreshFromProvider({})).toMatchObject({
      automationEnabled: false,
      eventCount: 4,
    });
    mocks.reconcile.mockRejectedValueOnce(new Error("provider outage"));
    await expect(caller("admin").refreshFromProvider({})).rejects.toThrow(
      "provider outage"
    );
  });
  it("requires Super Admin and typed confirmation for activation", async () => {
    await expect(
      caller("admin").setAutomation({
        enabled: true,
        confirmation: "ENABLE FUTURE PAYMENT RULES",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("super_admin").setAutomation({
        enabled: true,
        confirmation: "yes",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["never_completed", "pending", "failed"] as const)(
    "blocks first activation for %s recovery even after a successful batch",
    async kind => {
      const state = {
        id: 1,
        enabled: false,
        activatedAt: null,
        lastEventSyncAt: new Date(),
        lastSuccessAt: kind === "never_completed" ? null : new Date(),
        lastError: null,
      };
      const results = [
        [state],
        [{ count: kind === "pending" ? 12 : 0 }],
        [{ count: kind === "failed" ? 1 : 0 }],
      ];
      const update = vi.fn();
      const tx = {
        select: () => ({
          from: () => ({
            where: () => {
              const result = results.shift()!;
              return {
                for: async () => result,
                then: (resolve: (rows: unknown[]) => unknown) =>
                  Promise.resolve(result).then(resolve),
              };
            },
          }),
        }),
        update,
      };
      mocks.getDb.mockResolvedValue({
        transaction: async (work: (value: typeof tx) => unknown) => work(tx),
      });
      await expect(
        caller("super_admin").setAutomation({
          enabled: true,
          confirmation: "ENABLE FUTURE PAYMENT RULES",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(update).not.toHaveBeenCalled();
    }
  );
  it("does not permit an ordinary admin to approve a fee amount", async () => {
    await expect(
      caller("admin").approveFeePolicy({
        amountPence: 2500,
        confirmation: "APPROVE ADMIN FEE POLICY",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("requires payment-received confirmation and records the logged-in actor", async () => {
    const input = {
      userId: 42,
      paymentId: "PM_FIXTURE",
      amountPence: 9900,
      reference: "bank-fixture",
      notes: "Confirmed whole membership payment received",
      settledAt: "2026-11-02T10:00:00.000Z",
      confirmation: "RECORD PAYMENT RECEIVED" as const,
    };
    await expect(
      caller("admin").recordSettlement({
        ...input,
        confirmation: "yes" as any,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.settle).not.toHaveBeenCalled();
    mocks.settle.mockResolvedValue({ account: { outstandingCount: 0 } });
    await caller("admin").recordSettlement(input);
    expect(mocks.settle).toHaveBeenCalledWith({ ...input, actorId: 7 });
  });
  it("does not swallow an invalid or partial settlement error", async () => {
    mocks.settle.mockRejectedValue(
      new Error(
        "Manual settlement must equal the full outstanding payment amount"
      )
    );
    await expect(
      caller("admin").recordSettlement({
        userId: 42,
        paymentId: "PM_FIXTURE",
        amountPence: 1,
        reference: "ref",
        notes: "fixture",
        settledAt: "2026-11-02T10:00:00Z",
        confirmation: "RECORD PAYMENT RECEIVED",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("contains only recovery, policy and audited ledger actions, not collection, retry or reinstatement", () => {
    expect(Object.keys(controls._def.procedures).sort()).toEqual(
      [
        "refreshFromProvider",
        "setAutomation",
        "approveFeePolicy",
        "recordSettlement",
        "ignorePayment",
        "recordFeeSettlement",
      ].sort()
    );
  });
});

describe("ignore outstanding membership payment (isolated service adapter)", () => {
  it.each([null, "agent", "finance", "support", "unknown"])(
    "rejects %s before any service or database access",
    async role => {
      await expect(
        caller(role).ignorePayment(ignorePayment)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(mocks.ignore).not.toHaveBeenCalled();
      expectNoOtherPaymentActions();
    }
  );

  it.each(["admin", "super_admin"])(
    "allows %s to ignore only the exact payment with the authenticated actor",
    async role => {
      const result = {
        ignored: true,
        decision: { id: 91, reason: ignorePayment.reason },
        account: { outstandingCount: 0 },
      };
      mocks.ignore.mockResolvedValueOnce(result);
      await expect(
        caller(role, 73).ignorePayment({
          ...ignorePayment,
          actorId: 999,
        } as typeof ignorePayment & { actorId: number })
      ).resolves.toEqual(result);
      expect(mocks.ignore).toHaveBeenCalledTimes(1);
      expect(mocks.ignore).toHaveBeenCalledWith({
        ...ignorePayment,
        actorId: 73,
      });
      expectNoOtherPaymentActions();
    }
  );

  it("trims the recorded payment ID and reason without calling receipt or provider adapters", async () => {
    mocks.ignore.mockResolvedValueOnce({ ignored: true });
    await caller("admin").ignorePayment({
      ...ignorePayment,
      paymentId: `  ${ignorePayment.paymentId}  `,
      reason: ` \n${ignorePayment.reason}\t `,
    });
    expect(mocks.ignore).toHaveBeenCalledTimes(1);
    expect(mocks.ignore).toHaveBeenCalledWith({
      ...ignorePayment,
      actorId: 7,
    });
    expectNoOtherPaymentActions();
  });

  it.each([
    ["missing reason", { reason: undefined }],
    ["empty reason", { reason: "" }],
    ["whitespace reason", { reason: " \n\t " }],
    ["short trimmed reason", { reason: " ab " }],
    ["overlong reason", { reason: "x".repeat(3001) }],
    ["non-string reason", { reason: 123 }],
    ["missing confirmation", { confirmation: undefined }],
    ["empty confirmation", { confirmation: "" }],
    ["wrong confirmation", { confirmation: "yes" }],
    ["receipt confirmation", { confirmation: "RECORD PAYMENT RECEIVED" }],
    ["padded confirmation", { confirmation: " IGNORE OUTSTANDING PAYMENT " }],
    ["lower-case confirmation", { confirmation: "ignore outstanding payment" }],
    ["zero user ID", { userId: 0 }],
    ["negative user ID", { userId: -1 }],
    ["fractional user ID", { userId: 1.5 }],
    ["missing user ID", { userId: undefined }],
    ["zero amount", { amountPence: 0 }],
    ["negative amount", { amountPence: -1 }],
    ["fractional amount", { amountPence: 1.5 }],
    ["missing amount", { amountPence: undefined }],
    ["empty payment ID", { paymentId: "" }],
    ["whitespace payment ID", { paymentId: " \t " }],
    ["overlong payment ID", { paymentId: "x".repeat(101) }],
    ["missing payment ID", { paymentId: undefined }],
  ] as const)("rejects %s with no mutation", async (_label, overrides) => {
    await expect(
      caller("admin").ignorePayment({ ...ignorePayment, ...overrides } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.ignore).not.toHaveBeenCalled();
    expectNoOtherPaymentActions();
  });

  it.each([3, 3000])(
    "accepts a trimmed reason at the %s-character boundary",
    async length => {
      mocks.ignore.mockResolvedValueOnce({ ignored: true });
      const input = {
        ...ignorePayment,
        userId: 1,
        amountPence: 1,
        paymentId: "P".repeat(100),
        reason: `  ${"r".repeat(length)}  `,
      };
      await caller("admin").ignorePayment(input);
      expect(mocks.ignore).toHaveBeenCalledTimes(1);
      expect(mocks.ignore).toHaveBeenCalledWith({
        ...input,
        reason: "r".repeat(length),
        actorId: 7,
      });
      expectNoOtherPaymentActions();
    }
  );

  it.each([
    "Payment belongs to another agent",
    "Payment is no longer outstanding",
    "Ignore amount must equal the full outstanding payment amount",
    "Database unavailable",
  ])("surfaces service rejection: %s", async message => {
    mocks.ignore.mockRejectedValueOnce(new Error(message));
    await expect(
      caller("admin").ignorePayment(ignorePayment)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message,
    });
    expect(mocks.ignore).toHaveBeenCalledTimes(1);
    expect(mocks.ignore).toHaveBeenCalledWith({
      ...ignorePayment,
      actorId: 7,
    });
    expectNoOtherPaymentActions();
  });
});
