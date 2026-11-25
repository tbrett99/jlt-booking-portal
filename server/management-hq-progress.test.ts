import { describe, it, expect, vi } from "vitest";
import { createHqLiveConfig } from "./management-hq-live-config";
import { createHqLiveService } from "./management-hq-live-service";
import {
  createHqLiveStore,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
  type HqLiveControl,
} from "./management-hq-live-store";
import {
  HQ_PROGRESS_SQL,
  readHqProgressSnapshot,
} from "./management-hq-progress";
import { offlineHqV2Pool } from "./management-hq-storage-v2-pool";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
} from "./management-hq-ingestion";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";

function fixture() {
  const env = {
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://reporting.orbittravel.co.uk/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "synthetic-not-live-key-" + "a".repeat(32),
    HQ_PORTAL_SYNC_TOKEN: "synthetic-not-live-token-" + "b".repeat(32),
  };
  const config = {
    status: () => createHqLiveConfig(env).status(),
    sourceFingerprint: () => createHqLiveConfig(env).sourceFingerprint(),
    authorizeTrigger: () => false,
    createReader: (): never => {
      throw new Error("Offline fixture forbids providers");
    },
  };
  if (!config.status().configured)
    throw new Error("Invalid synthetic configuration");
  const f = offlineHqV2Pool();
  const control: HqLiveControl = {
    format: "hq-live-control-v1",
    version: 1,
    sourceFingerprint: config.sourceFingerprint()!,
    fencingNumber: 0,
    leaseToken: null,
    leaseExpiresAtMs: null,
    leaseHardExpiresAtMs: null,
    nextDueAtMs: 0,
    consecutiveFailures: 0,
    lastAttemptAtMs: null,
    lastSuccessAtMs: null,
    lastPublishAtMs: null,
    lastErrorCode: null,
    stageStatus: "progress",
  };
  const put = (id: string, version: number, state: unknown) =>
    f.rows.set(id, {
      datasetId: id,
      mode: "live",
      ownerUserId: 0,
      stateVersion: version,
      state: JSON.stringify(state),
      updatedAt: new Date(f.now()).toISOString(),
    });
  put(HQ_LIVE_CONTROL_DATASET_ID, 1, control);
  const root: any = {
    format: "hq-live-sync-v1",
    sourceFingerprint: config.sourceFingerprint(),
    sync: {
      version: 40,
      published: null,
      stage: {
        kind: "backfill",
        phase: "bookings",
        pages: 40,
        recordsRead: 4000,
        entities: {
          private: { payload: "PRIVATE_PAYLOAD_NOT_FOR_PROGRESS".repeat(100) },
        },
      },
    },
  };
  put(HQ_LIVE_SYNC_DATASET_ID, 40, root);
  const store = createHqLiveStore(f.pool, config);
  const service = createHqLiveService({
    config,
    createStore: () => store,
    now: f.now,
  });
  return { f, env, config, control, put, root, store, service };
}

describe("bounded observational HQ progress", () => {
  it("returns 4000 saved records using one unlocked scalar statement and never returns payloads or validated health", async () => {
    const x = fixture();
    const before = JSON.stringify(Array.from(x.f.rows));
    const result = await x.service.getStatus();
    expect(result).toMatchObject({
      payloadIntegrity: "unchecked",
      health: "progress",
      hasPublished: false,
      stateVersion: 40,
      progress: { pages: 40, recordsRead: 4000 },
    });
    expect(result.generationId).toBeNull();
    expect(result.isStale).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_PAYLOAD|sourceFingerprint|leaseToken|cursor|synthetic-not-live/
    );
    expect(x.f.trace).toHaveLength(1);
    expect(x.f.trace[0].sql).toBe(HQ_PROGRESS_SQL);
    expect(x.f.trace[0].transaction).toBe(0);
    expect(x.f.trace[0].responseBytes!).toBeLessThan(6000);
    expect(HQ_PROGRESS_SQL).not.toMatch(/FOR UPDATE|entities|SELECT \*/i);
    expect(x.f.commits.mock.calls).toHaveLength(0);
    expect(JSON.stringify(Array.from(x.f.rows))).toBe(before);
  });
  it("does not queue behind a reporting transaction in the offline model", async () => {
    const x = fixture();
    const connection = await x.f.pool.getConnection();
    await connection.beginTransaction();
    try {
      const progress = await x.store.readProgressSnapshot!();
      expect(progress.progress?.recordsRead).toBe(4000);
    } finally {
      await connection.rollback();
      connection.release();
    }
  });
  it("reports an expired persisted running label as saved progress without resetting control", async () => {
    const x = fixture();
    Object.assign(x.control, {
      stageStatus: "running",
      lastAttemptAtMs: x.f.now() - 95000,
      leaseToken: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      leaseExpiresAtMs: x.f.now() - 2000,
      leaseHardExpiresAtMs: x.f.now() - 1000,
    });
    x.put(HQ_LIVE_CONTROL_DATASET_ID, 1, x.control);
    const original = x.f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state;
    expect((await x.service.getStatus()).stageStatus).toBe("progress");
    expect(x.f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state).toBe(original);
  });
  it("a found publication remains explicitly unchecked and cannot become ready or supply totals", async () => {
    const x = fixture();
    x.root.sync.published = {};
    x.root.sync.stage = null;
    x.put(HQ_LIVE_SYNC_DATASET_ID, 40, x.root);
    const result = await x.service.getStatus();
    expect(result).toMatchObject({
      payloadIntegrity: "unchecked",
      hasPublished: true,
      health: "progress",
      generationId: null,
      sourceObservationAt: null,
    });
    expect(await x.service.readPublished()).toBeNull();
  });
  it("does not use cheap progress when report reading is enabled", async () => {
    const x = fixture();
    x.env.HQ_LIVE_READ_ENABLED = "true";
    const result = await x.service.getStatus();
    expect(result.health).toBe("needs_attention");
    expect(x.f.trace.some(t => t.sql === HQ_PROGRESS_SQL)).toBe(false);
  });
  it("still rejects corrupt payload before granting a lease or constructing a source reader", async () => {
    const x = fixture();
    const reader = vi.fn();
    const service = createHqLiveService({
      config: x.config,
      createStore: () => x.store,
      createReader: reader,
      onlyInitialPublication: true,
      initialImportGuard: async () => {},
    });
    expect((await service.getStatus()).payloadIntegrity).toBe("unchecked");
    expect(await service.invoke()).toMatchObject({
      status: "needs_attention",
      errorCode: "INVALID_PERSISTED_STATE",
    });
    expect(reader).not.toHaveBeenCalled();
    expect(
      JSON.parse(x.f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state).leaseToken
    ).toBeNull();
  });
  for (const field of [
    "syncFormat",
    "syncFingerprint",
    "syncVersion",
    "publishedType",
    "stageType",
    "stageKind",
    "stagePhase",
    "stagePages",
    "stageRecordsRead",
  ] as const) {
    it(`rejects malformed projected ${field} without returning arbitrary fields`, async () => {
      const x = fixture();
      const pool = {
        execute: async () => {
          const [rows] = await x.f.pool.execute(HQ_PROGRESS_SQL, []);
          (rows as any[])[0][field] = "PRIVATE_BAD_VALUE";
          return [rows];
        },
      };
      await expect(
        readHqProgressSnapshot(pool as any, x.config)
      ).rejects.toMatchObject({
        code:
          field === "syncFingerprint"
            ? "SOURCE_BINDING_CHANGED"
            : "INVALID_PERSISTED_STATE",
      });
    });
  }
  it("rejects source configuration drift during the metadata statement", async () => {
    const x = fixture();
    x.f.setAfterHook(sql => {
      if (sql === HQ_PROGRESS_SQL)
        x.env.HQ_ORBIT_REPORTING_API_KEY += "changed";
    });
    await expect(x.store.readProgressSnapshot!()).rejects.toMatchObject({
      code: "SOURCE_BINDING_CHANGED",
    });
  });
  it("rejects an orphan reporting row rather than initializing missing control", async () => {
    const x = fixture();
    x.f.rows.delete(HQ_LIVE_CONTROL_DATASET_ID);
    await expect(x.store.readProgressSnapshot!()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
    expect(x.f.rows.has(HQ_LIVE_CONTROL_DATASET_ID)).toBe(false);
  });
  it("caps the returned control and projected values even if underlying scalar strings are huge", async () => {
    const x = fixture();
    x.root.sync.stage.phase = "X".repeat(100000);
    x.control = { ...x.control, extra: "Y".repeat(10000) } as any;
    x.put(HQ_LIVE_CONTROL_DATASET_ID, 1, x.control);
    x.put(HQ_LIVE_SYNC_DATASET_ID, 40, x.root);
    await expect(x.store.readProgressSnapshot!()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
    expect(x.f.trace[0].responseBytes!).toBeLessThan(6000);
  });
  it("the initial-only atomic acquire validates once and cannot start a second publication", async () => {
    const x = fixture();
    const memory = createHqImplementedMemoryStore();
    await createHqImplementedEngine(
      createHqLargeSyntheticReader({ bookingCount: 1, paddingBytes: 0 }),
      memory
    ).sync();
    const sync = (await memory.readSync())!;
    x.put(HQ_LIVE_SYNC_DATASET_ID, sync.version, {
      format: "hq-live-sync-v1",
      sourceFingerprint: x.config.sourceFingerprint(),
      sync,
    });
    const before = JSON.stringify(Array.from(x.f.rows));
    expect(await x.store.acquireInitialPublication!()).toEqual({
      status: "already_complete",
    });
    expect(JSON.stringify(Array.from(x.f.rows))).toBe(before);
    expect(
      x.f.trace.filter(
        t => t.args[0] === HQ_LIVE_SYNC_DATASET_ID && t.sql.startsWith("SELECT")
      )
    ).toHaveLength(1);
  });
});
