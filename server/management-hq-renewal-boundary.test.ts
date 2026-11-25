import { performance } from "node:perf_hooks";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHqLiveConfig } from "./management-hq-live-config";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import {
  createHqLiveStore,
  HqLiveError,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
  HQ_LIVE_LEASE_SECONDS,
  HQ_LIVE_MAX_LEASE_SECONDS,
} from "./management-hq-live-store";
import { encodeHqLiveV2Sync } from "./management-hq-storage-v2";
import {
  offlineHqV2Pool,
  type HqV2OfflineRow,
} from "./management-hq-storage-v2-pool";

// Only the independent, in-memory SQL model is used. No default DB/service,
// provider, environment configuration, real clock waits or network is involved.
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const configuration = () =>
  createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://offline-synthetic.probe.tld/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "synthetic-only-key-" + "a".repeat(40),
    HQ_PORTAL_SYNC_TOKEN: "synthetic-only-token-" + "b".repeat(40),
  });
type Fixture = ReturnType<typeof offlineHqV2Pool>;
let small: HqImplementedSyncState;
beforeAll(async () => {
  const memory = createHqImplementedMemoryStore();
  expect(
    (
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        memory
      ).sync()
    ).status
  ).toBe("applied");
  small = { ...copy((await memory.readSync())!), version: 1 };
});
afterEach(() => vi.restoreAllMocks());

function seed(f: Fixture, fingerprint: string) {
  const encoded = encodeHqLiveV2Sync(small, fingerprint);
  const row = (datasetId: string, state: string): HqV2OfflineRow => ({
    datasetId,
    state,
    mode: "live",
    ownerUserId: 0,
    stateVersion: 1,
    updatedAt: "2026-11-22T12:00:00.000Z",
  });
  f.rows.set(
    HQ_LIVE_SYNC_DATASET_ID,
    row(HQ_LIVE_SYNC_DATASET_ID, JSON.stringify(encoded.manifest))
  );
  for (const chunk of encoded.chunks)
    f.rows.set(chunk.id, row(chunk.id, chunk.serialized));
  expect(encoded.chunks.length).toBeGreaterThan(0);
}
async function setup(cooperativeGuard?: () => Promise<void>) {
  const f = offlineHqV2Pool();
  // The guard closure is supplied by each test and only armed after acquisition.
  const store = createHqLiveStore(f.pool, configuration(), {
    cooperativeGuard,
  });
  const acquisition = await store.acquire();
  if (acquisition.status !== "acquired")
    throw new Error("offline synthetic lease required");
  const lease = acquisition.lease;
  seed(f, lease.sourceFingerprint);
  const control = JSON.parse(f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state);
  expect(HQ_LIVE_LEASE_SECONDS).toBe(30);
  expect(HQ_LIVE_MAX_LEASE_SECONDS).toBe(95);
  expect(control.leaseExpiresAtMs - f.now()).toBe(30000);
  expect(lease.hardExpiresAtMs - f.now()).toBe(95000);
  return { f, store, lease, control };
}
const savedRows = (f: Fixture) => copy(Array.from(f.rows));
const isClock = (sql: string) => sql.startsWith("SELECT CAST(");
const isControlSelect = (sql: string, args: any[]) =>
  sql.startsWith("SELECT datasetId") && args[0] === HQ_LIVE_CONTROL_DATASET_ID;
const isControlUpdate = (sql: string, args: any[]) =>
  sql.startsWith("UPDATE") && args[2] === HQ_LIVE_CONTROL_DATASET_ID;
const isRootSelect = (sql: string, args: any[]) =>
  sql.startsWith("SELECT datasetId") && args[0] === HQ_LIVE_SYNC_DATASET_ID;
function snapshot(f: Fixture) {
  return {
    rows: savedRows(f),
    commits: f.commits.mock.calls.length,
    rollbacks: f.rollbacks.mock.calls.length,
    trace: f.trace.length,
  };
}
function expectExactRollback(f: Fixture, before: ReturnType<typeof snapshot>) {
  // Full rows include control JSON/version/lease, root/chunk bytes, and every
  // updatedAt timestamp, not just the published payload or lease token.
  expect(savedRows(f)).toEqual(before.rows);
  expect(f.commits.mock.calls.length).toBe(before.commits);
  expect(f.rollbacks.mock.calls.length).toBe(before.rollbacks + 1);
}
const cleanup: HqImplementedSyncState = {
  version: 1,
  published: null,
  stage: null,
};

describe("renewal transaction boundaries over small synthetic SQL rows", () => {
  it("old ordinary expiry crossed in pre-UPDATE authority await is LEASE_LOST even with a future proposed renewal", async () => {
    let f: Fixture | undefined;
    let armed = false;
    let crossed = false;
    let oldDeadline = 0;
    const initialized = await setup(async () => {
      if (armed && !crossed) {
        crossed = true;
        f!.advance(oldDeadline - f!.now() + 1);
        await Promise.resolve();
      }
    });
    f = initialized.f;
    oldDeadline = initialized.control.leaseExpiresAtMs;
    f.advance(11000);
    const proposedDeadline = f.now() + 30000;
    const before = snapshot(f);
    f.setAfterHook(sql => {
      // The initial guard has obtained its valid clock sample; the next
      // cooperative authority await is the pre-write renewal authorization.
      if (!crossed && isClock(sql)) armed = true;
    });
    await expect(
      initialized.store.renewCooperative!(initialized.lease)
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(crossed).toBe(true);
    expect(f.now()).toBeGreaterThan(oldDeadline);
    expect(f.now()).toBeLessThan(proposedDeadline);
    expect(f.now()).toBeLessThan(initialized.lease.hardExpiresAtMs);
    expectExactRollback(f, before);
  });

  it("old ordinary expiry crossed in UPDATE await is LEASE_LOST and rolls back proposed control/version/timestamp", async () => {
    const { f, store, lease, control } = await setup();
    f.advance(11000);
    const before = snapshot(f);
    let crossed = false;
    let proposedDeadline = 0;
    f.setAfterHook((sql, args, draft) => {
      if (!crossed && isControlUpdate(sql, args)) {
        crossed = true;
        proposedDeadline = JSON.parse(args[1]).leaseExpiresAtMs;
        expect(draft.get(HQ_LIVE_CONTROL_DATASET_ID)).not.toEqual(
          f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)
        );
        f.advance(control.leaseExpiresAtMs - f.now() + 1);
      }
    });
    await expect(store.renewCooperative!(lease)).rejects.toMatchObject({
      code: "LEASE_LOST",
    });
    expect(crossed).toBe(true);
    expect(f.now()).toBeGreaterThan(control.leaseExpiresAtMs);
    expect(f.now()).toBeLessThan(proposedDeadline);
    expect(f.now()).toBeLessThan(lease.hardExpiresAtMs);
    expectExactRollback(f, before);
  });

  it("transaction-final authority await cannot outlive the provisional renewal's old ordinary deadline", async () => {
    let f: Fixture | undefined;
    let armed = false,
      crossed = false,
      oldDeadline = 0;
    const initialized = await setup(async () => {
      if (armed && !crossed) {
        crossed = true;
        f!.advance(oldDeadline - f!.now() + 1);
        await Promise.resolve();
      }
    });
    f = initialized.f;
    oldDeadline = initialized.control.leaseExpiresAtMs;
    f.advance(11000);
    const before = snapshot(f);
    let updated = false,
      postUpdateClocks = 0;
    f.setAfterHook((sql, args) => {
      if (isControlUpdate(sql, args)) updated = true;
      // Post-UPDATE guard clock, then helper-local final clock. The next
      // authority callback is the transaction's finalization check.
      if (updated && isClock(sql) && ++postUpdateClocks === 2) armed = true;
    });
    await expect(
      initialized.store.renewCooperative!(initialized.lease)
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(crossed).toBe(true);
    expect(f.now()).toBeGreaterThan(oldDeadline);
    expect(f.now()).toBeLessThan(initialized.lease.hardExpiresAtMs);
    expectExactRollback(f, before);
  });

  it.each(["control SELECT", "clock SELECT"] as const)(
    "direct renewal denies authority after its post-UPDATE %s inside the transaction, not a service post-check",
    async boundary => {
      let denied = false;
      let denialChecks = 0;
      const { f, store, lease } = await setup(async () => {
        if (denied) {
          denialChecks++;
          throw new HqLiveError("AUTH_DENIED");
        }
      });
      f.advance(11000);
      const before = snapshot(f);
      let updated = false;
      let triggered = false;
      f.setAfterHook((sql, args) => {
        if (isControlUpdate(sql, args)) updated = true;
        const atBoundary =
          boundary === "control SELECT"
            ? isControlSelect(sql, args)
            : isClock(sql);
        if (updated && !triggered && atBoundary) {
          triggered = true;
          denied = true;
        }
      });
      // Invoke the actual store method directly. There is deliberately no
      // service wrapper capable of detecting denial only after a committed row.
      await expect(store.renewCooperative!(lease)).rejects.toMatchObject({
        code: "AUTH_DENIED",
      });
      expect(updated).toBe(true);
      expect(triggered).toBe(true);
      expect(denialChecks).toBeGreaterThan(0);
      expectExactRollback(f, before);
    }
  );

  it("low-headroom expected-version mismatch returns false and rolls back renewal-only CAS mutations", async () => {
    const { f, store, lease } = await setup();
    // Keep preparation CPU time fixed so no independent lease-maintenance
    // transaction can confuse the failed held-CAS rollback contract.
    vi.spyOn(performance, "now").mockReturnValue(0);
    f.advance(11000);
    const before = snapshot(f);
    const result = await store
      .fencedSyncStore(lease)
      .compareAndSwapSync(null, copy(cleanup));
    expect(result).toBe(false);
    const trace = f.trace.slice(before.trace);
    const renewal = trace.findIndex(item =>
      isControlUpdate(item.sql, item.args)
    );
    const loadedRoot = trace.findIndex(item =>
      isRootSelect(item.sql, item.args)
    );
    expect(renewal).toBeGreaterThanOrEqual(0);
    expect(loadedRoot).toBeGreaterThan(renewal);
    expect(new Set(trace.map(item => item.transaction)).size).toBe(1);
    expect(
      trace
        .filter(item => /^(?:INSERT|UPDATE|DELETE)/.test(item.sql))
        .every(item => isControlUpdate(item.sql, item.args))
    ).toBe(true);
    expectExactRollback(f, before);
  });

  it("renewal during locked-current validation is also rolled back when expected version mismatches", async () => {
    const { f, store, lease } = await setup();
    let monotonic = 0;
    let decoding = false;
    // Use the existing Node monotonic dependency, restored by afterEach. This
    // advances CPU elapsed time without an eight-second sleep or production seam.
    // Preparation remains at zero; only validation inside the held CAS advances.
    vi.spyOn(performance, "now").mockImplementation(() => {
      if (decoding) monotonic += 9000;
      return monotonic;
    });
    const before = snapshot(f);
    let loadedRoot = false;
    let renewedDuringValidation = false;
    f.setAfterHook((sql, args, draft) => {
      if (!loadedRoot && isRootSelect(sql, args)) {
        loadedRoot = true;
        decoding = true;
        // Entry renewal had 30 seconds of headroom and did not write. Current
        // validation now has 19 seconds and the original holder is still valid.
        f.advance(11000);
      }
      if (isControlUpdate(sql, args)) {
        expect(loadedRoot).toBe(true);
        expect(JSON.parse(args[1]).leaseExpiresAtMs).toBe(f.now() + 30000);
        expect(draft.get(HQ_LIVE_CONTROL_DATASET_ID)).not.toEqual(
          f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)
        );
        renewedDuringValidation = true;
      }
    });
    expect(
      await store.fencedSyncStore(lease).compareAndSwapSync(null, copy(cleanup))
    ).toBe(false);
    expect(loadedRoot).toBe(true);
    expect(renewedDuringValidation).toBe(true);
    const trace = f.trace.slice(before.trace);
    expect(new Set(trace.map(item => item.transaction)).size).toBe(1);
    expect(
      trace
        .filter(item => /^(?:INSERT|UPDATE|DELETE)/.test(item.sql))
        .every(item => isControlUpdate(item.sql, item.args))
    ).toBe(true);
    expectExactRollback(f, before);
  });
});
