import { beforeAll, describe, expect, it } from "vitest";
import { canonicalHqJson } from "./management-hq-engine";
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
} from "./management-hq-live-store";
import { encodeHqLiveV2Sync } from "./management-hq-storage-v2";
import { offlineHqV2Pool } from "./management-hq-storage-v2-pool";

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
let large: HqImplementedSyncState;
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
  large = { ...copy((await memory.readSync())!), version: 1 };
  const original = large.published!.entities["booking:1"];
  large.published!.entities = {};
  for (let id = 1; id <= 128; id++) {
    const record = copy(original);
    record.entity.entityId = id;
    Object.assign(record.entity.payload, {
      orbitBookingId: id,
      syntheticExtension: {
        padding: Array.from({ length: 3 }, () => "X".repeat(4096)),
      },
    });
    record.canonicalPayload = canonicalHqJson(record.entity);
    large.published!.entities[`booking:${id}`] = record;
  }
}, 30000);
function seed(
  f: ReturnType<typeof offlineHqV2Pool>,
  config: ReturnType<typeof configuration>
) {
  const encoded = encodeHqLiveV2Sync(large, config.sourceFingerprint()!);
  const row = (datasetId: string, state: string) => ({
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
}
async function acquired(store: ReturnType<typeof createHqLiveStore>) {
  const result = await store.acquire();
  if (result.status !== "acquired") throw new Error("synthetic lease required");
  return result.lease;
}
const savedRows = (f: ReturnType<typeof offlineHqV2Pool>) =>
  copy(Array.from(f.rows));
const writes = (f: ReturnType<typeof offlineHqV2Pool>, from: number) =>
  f.trace
    .slice(from)
    .filter(item => /^(?:INSERT|UPDATE|DELETE)/.test(item.sql));

describe("cooperative live-store fences over synthetic rows only", () => {
  it("legacy V1 extras retain native JSON depth acceptance without loosening V2 encoding", async () => {
    const f = offlineHqV2Pool(),
      config = configuration(),
      store = createHqLiveStore(f.pool, config);
    await acquired(store);
    let deep: unknown = "retained";
    for (let n = 0; n < 258; n++) deep = { x: deep };
    const state = { version: 1, published: null, stage: null, extra: deep };
    f.rows.set(HQ_LIVE_SYNC_DATASET_ID, {
      datasetId: HQ_LIVE_SYNC_DATASET_ID,
      mode: "live",
      ownerUserId: 0,
      stateVersion: 1,
      state: JSON.stringify({
        format: "hq-live-sync-v1",
        sourceFingerprint: config.sourceFingerprint(),
        sync: state,
      }),
      updatedAt: "2026-11-22T12:00:00.000Z",
    });
    expect((await store.readSnapshot()).sync).toEqual(state);
    expect(() =>
      encodeHqLiveV2Sync(state, config.sourceFingerprint()!)
    ).toThrow();
  });
  it("guarded CPU renewal keeps only a valid holder alive and never extends its original hard cap", async () => {
    const f = offlineHqV2Pool(),
      config = configuration(),
      store = createHqLiveStore(f.pool, config);
    const lease = await acquired(store);
    f.advance(11000);
    await store.renewCooperative!(lease);
    let control = JSON.parse(f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state);
    expect(control.leaseExpiresAtMs).toBe(f.now() + 30000);
    expect(control.leaseHardExpiresAtMs).toBe(lease.hardExpiresAtMs);
    for (let n = 0; n < 5; n++) {
      f.advance(11000);
      await store.renewCooperative!(lease);
    }
    f.advance(11000);
    await store.renewCooperative!(lease);
    control = JSON.parse(f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state);
    expect(control.leaseExpiresAtMs).toBe(lease.hardExpiresAtMs);
    f.advance(18000);
    const before = savedRows(f);
    await expect(store.renewCooperative!(lease)).rejects.toMatchObject({
      code: "LEASE_LOST",
    });
    expect(savedRows(f)).toEqual(before);
  });
  it("authority denial after a CPU-renewal UPDATE rolls back exact control and never clears the lease", async () => {
    const f = offlineHqV2Pool(),
      config = configuration();
    let denied = false;
    const store = createHqLiveStore(f.pool, config, {
      cooperativeGuard: async () => {
        if (denied) throw new HqLiveError("AUTH_DENIED");
      },
    });
    const lease = await acquired(store);
    f.advance(11000);
    const before = savedRows(f);
    f.setAfterHook((sql, args) => {
      if (sql.startsWith("UPDATE") && args[2] === HQ_LIVE_CONTROL_DATASET_ID)
        denied = true;
    });
    await expect(store.renewCooperative!(lease)).rejects.toMatchObject({
      code: "AUTH_DENIED",
    });
    expect(savedRows(f)).toEqual(before);
  });
  it("encoding authority denial leaves all saved bytes and control unchanged before opening a new transaction", async () => {
    const f = offlineHqV2Pool(),
      config = configuration();
    let armed = false,
      checks = 0;
    const store = createHqLiveStore(f.pool, config, {
      cooperativeGuard: async () => {
        if (armed) {
          checks++;
          throw new HqLiveError("AUTH_DENIED");
        }
      },
    });
    const lease = await acquired(store),
      before = savedRows(f),
      from = f.trace.length;
    armed = true;
    await expect(
      store.fencedSyncStore(lease).compareAndSwapSync(null, copy(large))
    ).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(checks).toBeGreaterThan(0);
    expect(savedRows(f)).toEqual(before);
    expect(f.trace.slice(from)).toHaveLength(0);
  });
  it("source binding drift across a genuine CPU handoff fails closed without any SQL write", async () => {
    const f = offlineHqV2Pool(),
      base = configuration();
    let rotated = false,
      armed = false,
      checks = 0;
    const config = {
      ...base,
      sourceFingerprint: () =>
        rotated ? "f".repeat(64) : base.sourceFingerprint(),
    };
    const store = createHqLiveStore(f.pool, config, {
      cooperativeGuard: async () => {
        if (armed) {
          checks++;
          rotated = true;
        }
      },
    });
    const lease = await acquired(store),
      before = savedRows(f),
      from = f.trace.length;
    armed = true;
    await expect(
      store.fencedSyncStore(lease).compareAndSwapSync(null, copy(large))
    ).rejects.toMatchObject({ code: "SOURCE_BINDING_CHANGED" });
    expect(checks).toBeGreaterThan(0);
    expect(savedRows(f)).toEqual(before);
    expect(writes(f, from)).toHaveLength(0);
  });
  it("authority denial during a strong v2 read rolls back without changing root, chunks or control", async () => {
    const f = offlineHqV2Pool(),
      config = configuration();
    const initialization = createHqLiveStore(f.pool, config);
    await acquired(initialization);
    seed(f, config);
    const before = savedRows(f),
      rollbackCount = f.rollbacks.mock.calls.length;
    let checks = 0;
    const store = createHqLiveStore(f.pool, config, {
      cooperativeGuard: async () => {
        checks++;
        throw new HqLiveError("AUTH_DENIED");
      },
    });
    await expect(store.readSnapshot()).rejects.toMatchObject({
      code: "AUTH_DENIED",
    });
    expect(checks).toBeGreaterThan(0);
    expect(savedRows(f)).toEqual(before);
    expect(f.rollbacks.mock.calls.length).toBe(rollbackCount + 1);
  });
  it("lease expiry while decoding the locked current state prevents all CAS mutations", async () => {
    const f = offlineHqV2Pool(),
      config = configuration();
    let armed = false,
      expired = false;
    const store = createHqLiveStore(f.pool, config, {
      cooperativeGuard: async () => {
        if (armed && !expired) {
          expired = true;
          f.advance(30001);
        }
      },
    });
    const lease = await acquired(store);
    seed(f, config);
    const before = savedRows(f),
      from = f.trace.length;
    f.setAfterHook((sql, args) => {
      if (
        sql.startsWith("SELECT datasetId") &&
        args[0] === HQ_LIVE_SYNC_DATASET_ID
      )
        armed = true;
    });
    const next = copy(large);
    next.version = 2;
    await expect(
      store.fencedSyncStore(lease).compareAndSwapSync(1, next)
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(expired).toBe(true);
    expect(savedRows(f)).toEqual(before);
    expect(writes(f, from)).toHaveLength(0);
  });
  it("SQL-await caller mutation cannot change already-prepared root version or publication decisions", async () => {
    const f = offlineHqV2Pool(),
      config = configuration(),
      store = createHqLiveStore(f.pool, config);
    const lease = await acquired(store),
      next = copy(large),
      expected = copy(next);
    let changed = false;
    f.setAfterHook(sql => {
      if (!changed && sql.startsWith("SELECT datasetId")) {
        changed = true;
        next.version = 999;
        next.published = null;
        next.stage = null;
      }
    });
    expect(
      await store.fencedSyncStore(lease).compareAndSwapSync(null, next)
    ).toBe(true);
    f.setAfterHook(null);
    expect(changed).toBe(true);
    const snapshot = await store.readSnapshot();
    expect(JSON.stringify(snapshot.sync)).toBe(JSON.stringify(expected));
    expect(snapshot.control!.lastPublishAtMs).toBe(f.now());
  });
});
