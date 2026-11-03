import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { GO_CARDLESS_MANDATE_STATUSES, parseGoCardlessMandateStatus, canLinkGoCardlessMandate } from "../shared/gocardless-mandate-status";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), record: vi.fn(), process: vi.fn(), audit: vi.fn(), outbox: vi.fn(), authenticate: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./gocardless-email-link-lock", () => ({ withGoCardlessEmailLinkLock: (work: (db: any) => Promise<unknown>) => work({}) }));
vi.mock("./agent-merge-identity", () => ({ assertAgentNotMerged: vi.fn(async () => undefined) }));
vi.mock("./membership-payment-service", () => ({ recordMembershipPaymentEvent: mocks.record, processMembershipPaymentAccount: mocks.process, processMembershipPaymentOutbox: mocks.outbox }));
vi.mock("./gocardless-db", () => ({ createPaymentEvent: mocks.audit }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: mocks.authenticate } }));
import { membershipPaymentFees, gcSubscriptions, gcMandates, membershipPaymentInbox } from "../drizzle/schema";
import { enrichMembershipProviderEvent, receiveMembershipProviderEvent, type MembershipProviderEvent } from "./membership-payment-sync";
import { matchesMembershipCronSecret, membershipPaymentRecoveryHandler } from "./membership-payment-routes";
const failed: MembershipProviderEvent = { id: "EV_FAILED", action: "failed", resource_type: "payments", created_at: "2026-11-02T10:00:00.153Z", links: { payment: "PM_MONTH" } };
const recovered: MembershipProviderEvent = { id: "EV_CONFIRMED", action: "confirmed", resource_type: "payments", created_at: "2026-11-02T11:00:00.157Z", links: { payment: "PM_MONTH" } };
let inserted: unknown[];
let updates: Array<{ table: unknown; value: any }>;
function fakeDb(subscriptions: unknown[] = [{ userId: 42 }], mandates: unknown[] = []) {
  inserted = [];
  updates = [];
  return {
    select: () => ({ from: (table: unknown) => ({ where: () => {
      const data = table === membershipPaymentFees ? [] : table === gcSubscriptions ? subscriptions : table === gcMandates ? mandates : [];
      return { limit: async () => data, then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(data).then(resolve) };
    } }) }),
    insert: () => ({ values: (data: unknown) => { inserted.push(...(Array.isArray(data) ? data : [data])); return { onDuplicateKeyUpdate: async () => [{}] }; } }),
    update: (table: unknown) => ({ set: (value: any) => ({ where: async () => { updates.push({ table, value }); return [{}]; } }) }),
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
describe("provider mandate status recovery", () => {
  const event: MembershipProviderEvent = { id: "EV_OLD_MANDATE", action: "consumed", resource_type: "mandates", created_at: "2026-05-13T19:05:40Z", links: { mandate: "MD_OLD" } };
  it.each(["consumed", "blocked", "pending_customer_approval", "suspended_by_payer"])("preserves provider status %s without payment effects or reassignment", async status => {
    mocks.getDb.mockResolvedValue(fakeDb(undefined, [{ id: 4, userId: 42, mandateId: "MD_OLD", status: "active" }]));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ mandates: { status } }) })));
    expect(await enrichMembershipProviderEvent(event, "reconciliation")).toBeNull();
    expect(updates).toEqual([
      { table: gcMandates, value: { status } },
      { table: membershipPaymentInbox, value: { status: "ignored", processedAt: expect.any(Date), nextProcessingAt: null, lastError: null } },
    ]);
    expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it("uses current provider state rather than reviving an old active event", async () => {
    mocks.getDb.mockResolvedValue(fakeDb(undefined, [{ id: 4, userId: 42, mandateId: "MD_OLD" }]));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ mandates: { status: "consumed" } }) })));
    await enrichMembershipProviderEvent({ ...event, action: "active" }, "reconciliation");
    expect(updates[0]).toEqual({ table: gcMandates, value: { status: "consumed" } });
  });
  it("holds an unknown status without any write or false completion", async () => {
    mocks.getDb.mockResolvedValue(fakeDb(undefined, [{ id: 4, userId: 42, mandateId: "MD_OLD" }]));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ mandates: { status: "unknown_provider_state" } }) })));
    await expect(enrichMembershipProviderEvent(event, "reconciliation")).rejects.toThrow("held for review");
    expect(updates).toEqual([]);
  });
  it("keeps schema values aligned with exact provider states and rejects unsafe replacement linking", () => {
    expect(gcMandates.status.enumValues).toEqual(GO_CARDLESS_MANDATE_STATUSES);
    for (const state of GO_CARDLESS_MANDATE_STATUSES) expect(parseGoCardlessMandateStatus(state)).toBe(state);
    for (const state of ["consumed", "blocked", "suspended_by_payer", "cancelled", "failed", "expired", "invented", null]) expect(canLinkGoCardlessMandate(state)).toBe(false);
    for (const state of ["pending", "pending_customer_approval", "pending_submission", "submitted", "active"]) expect(canLinkGoCardlessMandate(state)).toBe(true);
    expect(() => parseGoCardlessMandateStatus(null)).toThrow("Unsupported");
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
