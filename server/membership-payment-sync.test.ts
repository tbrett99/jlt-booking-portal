import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), record: vi.fn(), process: vi.fn(), audit: vi.fn(), outbox: vi.fn(), authenticate: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./membership-payment-service", () => ({ recordMembershipPaymentEvent: mocks.record, processMembershipPaymentAccount: mocks.process, processMembershipPaymentOutbox: mocks.outbox }));
vi.mock("./gocardless-db", () => ({ createPaymentEvent: mocks.audit }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: mocks.authenticate } }));
import { membershipPaymentFees, gcSubscriptions } from "../drizzle/schema";
import { enrichMembershipProviderEvent, receiveMembershipProviderEvent, type MembershipProviderEvent } from "./membership-payment-sync";
import { matchesMembershipCronSecret, membershipPaymentRecoveryHandler } from "./membership-payment-routes";
const failed: MembershipProviderEvent = { id: "EV_FAILED", action: "failed", resource_type: "payments", created_at: "2026-11-02T10:00:00.153Z", links: { payment: "PM_MONTH" } };
const recovered: MembershipProviderEvent = { id: "EV_CONFIRMED", action: "confirmed", resource_type: "payments", created_at: "2026-11-02T11:00:00.157Z", links: { payment: "PM_MONTH" } };
let inserted: unknown[];
function fakeDb(subscriptions: unknown[] = [{ userId: 42 }]) {
  inserted = [];
  return {
    select: () => ({ from: (table: unknown) => ({ where: () => {
      const data = table === membershipPaymentFees ? [] : table === gcSubscriptions ? subscriptions : [];
      return { limit: async () => data, then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(data).then(resolve) };
    } }) }),
    insert: () => ({ values: (data: unknown) => { inserted.push(...(Array.isArray(data) ? data : [data])); return { onDuplicateKeyUpdate: async () => [{}] }; } }),
    update: () => ({ set: () => ({ where: async () => [{}] }) }),
  };
}
function provider(status: string, recoveryEvents: MembershipProviderEvent[] = [recovered], hasSubscription = true) {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("/events?")
    ? { events: recoveryEvents }
    : { payments: { id: "PM_MONTH", amount: 9900, currency: "GBP", status, links: hasSubscription ? { subscription: "SB_MEMBER", mandate: "MD_MEMBER" } : { mandate: "MD_MEMBER" } } } }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("GOCARDLESS_ACCESS_TOKEN", "fixture-not-a-credential"); vi.stubEnv("GOCARDLESS_ENVIRONMENT", "live"); mocks.getDb.mockResolvedValue(fakeDb()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("provider receipt and recovery", () => {
  it("persists immutable raw receipt and millisecond timestamp before any effects", async () => {
    await receiveMembershipProviderEvent(failed, "webhook");
    expect(inserted[0]).toMatchObject({ eventId: "EV_FAILED", status: "pending", occurredAt: new Date(failed.created_at), rawPayload: JSON.stringify(failed) });
    expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled();
  });
  it("imports real matching success before a delayed failure is processed", async () => {
    provider("confirmed");
    expect(await enrichMembershipProviderEvent(failed, "webhook")).toBe(42);
    expect(mocks.record.mock.calls.map(c => c[0].eventId)).toEqual(["EV_CONFIRMED", "EV_FAILED"]);
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(mocks.record.mock.calls[0][0].occurredAt).toEqual(new Date(recovered.created_at));
  });
  it("holds a recovered resource with unavailable recovery evidence instead of inventing payment success or applying a suspension", async () => {
    provider("paid_out", []);
    await expect(enrichMembershipProviderEvent(failed, "webhook")).rejects.toThrow("held for review");
    expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled();
  });
  it("does not use a different payment's success to clear this month", async () => {
    provider("confirmed", [{ ...recovered, links: { payment: "PM_OTHER" } }]);
    await expect(enrichMembershipProviderEvent(failed, "reconciliation")).rejects.toThrow("matching recovery event");
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("does not count one-off/joining-fee failures as membership attempts", async () => {
    provider("failed", [], false);
    expect(await enrichMembershipProviderEvent(failed, "webhook")).toBeNull();
    expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled();
  });
  it("holds missing or ambiguous subscription ownership for staff review", async () => {
    mocks.getDb.mockResolvedValue(fakeDb([{ userId: 42 }, { userId: 43 }])); provider("failed");
    await expect(enrichMembershipProviderEvent(failed, "webhook")).rejects.toThrow("missing or ambiguous");
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
describe("external recovery authentication", () => {
  it("requires a dedicated sufficiently long exact secret", () => {
    expect(matchesMembershipCronSecret("short", "short")).toBe(false);
    expect(matchesMembershipCronSecret(["x"], "x".repeat(40))).toBe(false);
    expect(matchesMembershipCronSecret("x".repeat(40), "x".repeat(40))).toBe(true);
    expect(matchesMembershipCronSecret("y".repeat(40), "x".repeat(40))).toBe(false);
  });
  it("rejects ordinary/unauthenticated users without touching payment state", async () => {
    vi.stubEnv("MEMBERSHIP_PAYMENT_CRON_SECRET", ""); mocks.authenticate.mockRejectedValue(new Error("unauthenticated"));
    const status = vi.fn().mockReturnThis(), json = vi.fn();
    await membershipPaymentRecoveryHandler({ headers: {} } as Request, { status, json } as unknown as Response);
    expect(status).toHaveBeenCalledWith(403); expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
