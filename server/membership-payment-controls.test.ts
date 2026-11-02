import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";
const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), settle: vi.fn(), getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./membership-payment-sync", () => ({ reconcileMembershipPayments: mocks.reconcile }));
vi.mock("./membership-payment-service", () => ({ recordManualMembershipSettlement: mocks.settle }));
import { membershipPaymentControlProcedures } from "./membership-payment-control-procedures";
const controls = router(membershipPaymentControlProcedures);
const caller = (role: string | null) => controls.createCaller({ user: role ? { id: 7, role } : null, req: {}, res: {} } as TrpcContext);
beforeEach(() => { vi.clearAllMocks(); });
describe("membership payment control boundaries", () => {
  it.each([null, "agent"])("blocks recovery to non-staff %s", async role => {
    await expect(caller(role).refreshFromProvider({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("calls the canonical recovery service and does not hide provider errors", async () => {
    mocks.reconcile.mockResolvedValueOnce({ automationEnabled: false, eventCount: 4 });
    expect(await caller("admin").refreshFromProvider({})).toMatchObject({ automationEnabled: false, eventCount: 4 });
    mocks.reconcile.mockRejectedValueOnce(new Error("provider outage"));
    await expect(caller("admin").refreshFromProvider({})).rejects.toThrow("provider outage");
  });
  it("requires Super Admin and typed confirmation for activation", async () => {
    await expect(caller("admin").setAutomation({ enabled: true, confirmation: "ENABLE FUTURE PAYMENT RULES" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("super_admin").setAutomation({ enabled: true, confirmation: "yes" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["never_completed", "pending", "failed"] as const)("blocks first activation for %s recovery even after a successful batch", async kind => {
    const state = { id: 1, enabled: false, activatedAt: null, lastEventSyncAt: new Date(), lastSuccessAt: kind === "never_completed" ? null : new Date(), lastError: null };
    const results = [[state], [{ count: kind === "pending" ? 12 : 0 }], [{ count: kind === "failed" ? 1 : 0 }]];
    const update = vi.fn();
    const tx = {
      select: () => ({ from: () => ({ where: () => {
        const result = results.shift()!;
        return { for: async () => result, then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve) };
      } }) }),
      update,
    };
    mocks.getDb.mockResolvedValue({ transaction: async (work: (value: typeof tx) => unknown) => work(tx) });
    await expect(caller("super_admin").setAutomation({ enabled: true, confirmation: "ENABLE FUTURE PAYMENT RULES" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(update).not.toHaveBeenCalled();
  });
  it("does not permit an ordinary admin to approve a fee amount", async () => {
    await expect(caller("admin").approveFeePolicy({ amountPence: 2500, confirmation: "APPROVE ADMIN FEE POLICY" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("requires payment-received confirmation and records the logged-in actor", async () => {
    const input = { userId: 42, paymentId: "PM_FIXTURE", amountPence: 9900, reference: "bank-fixture", notes: "Confirmed whole membership payment received", settledAt: "2026-11-02T10:00:00.000Z", confirmation: "RECORD PAYMENT RECEIVED" as const };
    await expect(caller("admin").recordSettlement({ ...input, confirmation: "yes" as any })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.settle).not.toHaveBeenCalled();
    mocks.settle.mockResolvedValue({ account: { outstandingCount: 0 } });
    await caller("admin").recordSettlement(input);
    expect(mocks.settle).toHaveBeenCalledWith({ ...input, actorId: 7 });
  });
  it("does not swallow an invalid or partial settlement error", async () => {
    mocks.settle.mockRejectedValue(new Error("Manual settlement must equal the full outstanding payment amount"));
    await expect(caller("admin").recordSettlement({ userId: 42, paymentId: "PM_FIXTURE", amountPence: 1, reference: "ref", notes: "fixture", settledAt: "2026-11-02T10:00:00Z", confirmation: "RECORD PAYMENT RECEIVED" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("contains no payment collection, payment retry or automatic reinstatement procedure", () => {
    expect(Object.keys(controls._def.procedures)).toEqual(["refreshFromProvider", "setAutomation", "approveFeePolicy", "recordSettlement", "recordFeeSettlement"]);
  });
});
