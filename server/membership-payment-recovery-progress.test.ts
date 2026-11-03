import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), outbox: vi.fn(), record: vi.fn(), process: vi.fn(), authenticate: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./gocardless-email-link-lock", () => ({ withGoCardlessEmailLinkLock: (work: (db: any) => Promise<unknown>) => work({}) }));
vi.mock("./agent-merge-identity", () => ({ assertAgentNotMerged: vi.fn(async () => undefined) }));
vi.mock("./membership-payment-service", () => ({ recordMembershipPaymentEvent: mocks.record, processMembershipPaymentAccount: mocks.process, processMembershipPaymentOutbox: mocks.outbox }));
vi.mock("./gocardless-db", () => ({ createPaymentEvent: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: mocks.authenticate } }));
import { membershipPaymentControl as controlTable, membershipPaymentInbox as inboxTable } from "../drizzle/schema";
import { receiveMembershipProviderEvents, reconcileMembershipPayments, type MembershipProviderEvent } from "./membership-payment-sync";
import { membershipPaymentRecoveryHandler } from "./membership-payment-routes";

function harness(options: { pending?: number; failed?: number; locked?: boolean; completeBefore?: boolean } = {}) {
  const oldSuccess = options.completeBefore ? new Date("2026-11-01T12:00:00Z") : null;
  const control = { id: 1, enabled: false, activatedAt: null, lastEventSyncAt: new Date("2026-11-02T00:00:00Z"), lastSuccessAt: oldSuccess, lastError: null as string | null };
  const rows: any[] = Array.from({ length: options.pending ?? 0 }, (_, i) => ({
    id: i + 1, eventId: `EV-${i}`, status: "pending", processingAttempts: 0,
    rawPayload: JSON.stringify({ id: `EV-${i}`, action: "unsupported", resource_type: "payments", created_at: "2026-05-01T00:00:00Z", links: { payment: `PM-${i}` } }),
    source: "reconciliation", nextProcessingAt: null,
  }));
  for (let i = 0; i < (options.failed ?? 0); i++) rows.push({ id: rows.length + 1, eventId: `FAILED-${i}`, status: "failed", nextProcessingAt: new Date(Date.now() + 3600000) });
  const updates: { table: unknown; value: any }[] = [];
  const inserts: { table: unknown; value: any; duplicate: any }[] = [];
  let nextSelection: any;
  const db = {
    select: (shape?: unknown) => ({ from: (table: unknown) => ({ where: () => {
      const data = table === controlTable ? [control] : shape ? [{ pending: rows.filter(r => r.status === "pending").length, failed: rows.filter(r => r.status === "failed").length }] : rows.filter(r => ["pending", "failed"].includes(r.status) && (!r.nextProcessingAt || r.nextProcessingAt <= new Date()));
      nextSelection = data;
      return { limit: async (n: number) => data.slice(0, n), orderBy: () => ({ limit: async (n: number) => data.slice(0, n) }), then: (resolve: (v: unknown) => unknown) => Promise.resolve(data).then(resolve) };
    } }) }),
    insert: (table: unknown) => ({ values: (value: any) => ({ onDuplicateKeyUpdate: async (duplicate: any) => { inserts.push({ table, value, duplicate }); return [{ affectedRows: 1 }]; } }) }),
    update: (table: unknown) => ({ set: (value: any) => ({ where: async () => {
      updates.push({ table, value });
      if (table === controlTable) {
        if (value.syncLockToken && options.locked) return [{ affectedRows: 0 }];
        Object.assign(control, value);
      }
      if (table === inboxTable && value.status === "ignored") {
        const row = rows.find(r => r.status === "pending" && !r.nextProcessingAt);
        if (row) Object.assign(row, value);
      }
      return [{ affectedRows: 1 }];
    } }) }),
  };
  mocks.getDb.mockResolvedValue(db);
  mocks.outbox.mockResolvedValue({ accepted: 0, failed: 0, skipped: 1 });
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ events: [], meta: { cursors: { after: null } } }) }));
  vi.stubGlobal("fetch", fetcher);
  return { rows, control, updates, inserts, fetcher, oldSuccess };
}
function response() { return { status: vi.fn().mockReturnThis(), json: vi.fn() }; }
const req = { headers: { "x-membership-cron-secret": "test-secret-not-a-credential-00000000000" } } as unknown as Request;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOCARDLESS_ACCESS_TOKEN", "fixture-not-a-real-credential");
  vi.stubEnv("GOCARDLESS_ENVIRONMENT", "live");
  vi.stubEnv("MEMBERSHIP_PAYMENT_CRON_SECRET", "test-secret-not-a-credential-00000000000");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("bounded recovery progress and truthful completion", () => {
  it("returns HTTP success for a completed batch with pending backfill without stamping a healthy ledger", async () => {
    const h = harness({ pending: 300 }); const res = response();
    await membershipPaymentRecoveryHandler(req, res as unknown as Response);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, result: expect.objectContaining({ status: "in_progress", automationEnabled: false, recovered: { completed: 250, errors: 0, pending: 50, failed: 0, backlog: 50 } }) }));
    expect(h.control.enabled).toBe(false); expect(h.control.activatedAt).toBeNull();
    expect(h.control.lastSuccessAt).toBeNull(); expect(h.control.lastError).toBeNull();
    expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled();
  });
  it("does not overwrite an old lastSuccessAt during partial recovery", async () => {
    const h = harness({ pending: 251, completeBefore: true });
    const result = await reconcileMembershipPayments();
    expect(result).toMatchObject({ status: "in_progress" });
    expect(h.control.lastSuccessAt).toEqual(h.oldSuccess);
    expect(h.updates.some(u => "lastSuccessAt" in u.value)).toBe(false);
  });
  it("stamps completion only after the pending and failed queues are empty", async () => {
    const h = harness({ pending: 2 });
    expect(await reconcileMembershipPayments()).toMatchObject({ status: "complete", recovered: { completed: 2, errors: 0, pending: 0, failed: 0, backlog: 0 } });
    expect(h.control.lastSuccessAt).toBeInstanceOf(Date);
    expect(h.control.enabled).toBe(false); expect(h.control.activatedAt).toBeNull();
  });
  it("keeps genuine mapping failures at HTTP 503 with counts and continues other pending work", async () => {
    const h = harness({ pending: 2, failed: 3 }); const res = response();
    await membershipPaymentRecoveryHandler(req, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, status: "review_required", progress: { completed: 2, errors: 0, pending: 0, failed: 3, backlog: 3 } }));
    expect(h.control.lastSuccessAt).toBeNull(); expect(h.control.lastError).toContain("3 payment events require");
    expect(h.control.syncLockToken).toBeNull();
  });
  it("does not disguise a provider outage as normal backfill progress", async () => {
    const h = harness({ pending: 2 }); const res = response();
    h.fetcher.mockResolvedValueOnce({ ok: false, status: 429 } as any);
    await membershipPaymentRecoveryHandler(req, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(h.control.lastError).toContain("HTTP 429");
    expect(h.control.lastSuccessAt).toBeNull(); expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it("does not advance the provider checkpoint if a page is invalid", async () => {
    const h = harness(); const before = h.control.lastEventSyncAt;
    h.fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ events: [{ id: "INVALID", resource_type: "payments", created_at: "not-a-date", links: {} }] }) });
    await expect(reconcileMembershipPayments()).rejects.toThrow("timestamp");
    expect(h.control.lastEventSyncAt).toEqual(before);
    expect(h.inserts.filter(v => v.table === inboxTable)).toHaveLength(0);
  });
  it("imports a complete provider page in one no-op-on-replay insert without processing or emails", async () => {
    const h = harness();
    const events = Array.from({ length: 500 }, (_, n) => ({ id: `EV-PAGE-${n}`, action: "submitted", resource_type: "payments", created_at: "2026-11-02T12:00:00.153Z", links: { payment: `PM-${n}` } }));
    await receiveMembershipProviderEvents(events, "reconciliation");
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].value).toHaveLength(500);
    expect(Object.keys(h.inserts[0].duplicate.set)).toEqual(["eventId"]);
    expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it("leaves payment work untouched when another instance owns the recovery lease", async () => {
    const h = harness({ locked: true, pending: 2 });
    expect(await reconcileMembershipPayments()).toEqual({ skipped: "another reconciliation is running" });
    expect(h.fetcher).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled();
    expect(h.rows.every(r => r.status === "pending")).toBe(true);
  });
});
