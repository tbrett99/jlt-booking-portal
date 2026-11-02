import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { membershipPaymentAccounts, membershipPaymentControl, membershipPaymentInbox } from "../drizzle/schema";
import { readMembershipPaymentState } from "./membership-payment-health";

const now = new Date("2026-11-02T22:00:00Z");
function harness(options: {
  successAt?: Date | null; providerAt?: Date | null; accountAt?: Date | null;
  pending?: number; failed?: number; accountError?: string | null; controlError?: string | null;
  noAccount?: boolean; noControl?: boolean; noQueue?: boolean;
} = {}) {
  const account = { userId: 42, failedAttempts: 0, outstandingCount: 0,
    lastSyncedAt: options.accountAt === undefined ? new Date("2026-10-01T12:00:00Z") : options.accountAt,
    lastError: options.accountError ?? null };
  const control = { id: 1, enabled: false,
    lastSuccessAt: options.successAt === undefined ? new Date("2026-11-02T21:59:00Z") : options.successAt,
    lastEventSyncAt: options.providerAt === undefined ? new Date("2026-11-02T21:58:00Z") : options.providerAt,
    lastError: options.controlError ?? null };
  const queue = { pending: options.pending ?? 0, failed: options.failed ?? 0 };
  const select = vi.fn(() => ({ from: (table: unknown) => ({ where: () => {
    const rows = table === membershipPaymentAccounts ? options.noAccount ? [] : [account]
      : table === membershipPaymentControl ? options.noControl ? [] : [control]
      : table === membershipPaymentInbox ? options.noQueue ? [] : [queue] : [];
    return { limit: async () => rows, then: (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve) };
  } }) }));
  mocks.getDb.mockResolvedValue({ select });
  return { account, control, queue, select };
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe("CRM current membership payment verification", () => {
  it("verifies unchanged older account data only under a fresh completed scan and empty inbox", async () => {
    const h = harness();
    expect(await readMembershipPaymentState(42)).toMatchObject({ available: true, verified: true, account: h.account, syncError: null });
    expect(h.select).toHaveBeenCalledTimes(3);
  });
  it("does not report zero-debt data as verified while any recovery is pending", async () => {
    harness({ pending: 12000 });
    expect(await readMembershipPaymentState(42)).toMatchObject({ verified: false, syncError: expect.stringContaining("12000") });
  });
  it("does not report an old success as verified with mapping-review events", async () => {
    harness({ failed: 9 });
    expect(await readMembershipPaymentState(42)).toMatchObject({ verified: false, syncError: expect.stringContaining("mapping review") });
  });
  it("rejects a preserved January success even with a clear error field", async () => {
    const old = new Date("2026-01-01T12:00:00Z");
    harness({ successAt: old, providerAt: old, accountAt: old });
    expect(await readMembershipPaymentState(42)).toMatchObject({ verified: false, syncError: expect.stringContaining("15 minutes") });
  });
  it("rejects the newest provider checkpoint until matching ledger completion even with zero pending counts", async () => {
    harness({ providerAt: new Date("2026-11-02T21:59:30Z") });
    expect(await readMembershipPaymentState(42)).toMatchObject({ verified: false, syncError: expect.stringContaining("latest provider scan") });
  });
  it("does not verify missing account, missing control or unreadable queue", async () => {
    for (const options of [{ noAccount: true }, { noControl: true }, { noQueue: true }, { accountAt: null }]) {
      harness(options);
      expect(await readMembershipPaymentState(42)).toMatchObject({ available: true, verified: false });
    }
  });
  it("preserves account and provider errors instead of pretending they are clean", async () => {
    for (const options of [{ accountError: "Agent ledger review required" }, { controlError: "Provider scan failed" }]) {
      harness(options);
      const result = await readMembershipPaymentState(42);
      expect(result.verified).toBe(false);
      expect(result.syncError).toBe(options.accountError ?? options.controlError);
    }
  });
  it("does not verify future or invalid completed scan timestamps", async () => {
    for (const successAt of [new Date("2026-11-03T00:00:00Z"), new Date(NaN)]) {
      harness({ successAt, providerAt: null });
      expect((await readMembershipPaymentState(42)).verified).toBe(false);
    }
  });
  it("returns schema unavailable when the inbox migration is absent rather than zero arrears", async () => {
    mocks.getDb.mockResolvedValue({ select: () => { throw Object.assign(new Error("Table membership_payment_inbox doesn't exist"), { code: "ER_NO_SUCH_TABLE" }); } });
    expect(await readMembershipPaymentState(42)).toMatchObject({ available: false, verified: false, account: null });
  });
  it("propagates database access failures rather than disguising them as missing schema", async () => {
    mocks.getDb.mockResolvedValue({ select: () => { throw Object.assign(new Error("Access denied"), { code: "ER_ACCESS_DENIED_ERROR" }); } });
    await expect(readMembershipPaymentState(42)).rejects.toThrow("Access denied");
  });
});
