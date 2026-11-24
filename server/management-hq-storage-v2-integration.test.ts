import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import { createHqLiveConfig } from "./management-hq-live-config";
import {
  createHqLiveStore,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
} from "./management-hq-live-store";
import { createHqLiveService } from "./management-hq-live-service";
import { validateHqInitialPublication } from "./management-hq-initial-validation";
import { offlineHqV2Pool } from "./management-hq-storage-v2-pool";
import {
  HQ_LIVE_V2_VALIDATION_OPTIONS,
  hqJsonUtf8Bytes,
} from "./management-hq-storage-v2";

vi.mock("./agent-merge-identity", () => ({
  getAgentMergeTarget: vi.fn(async () => null),
}));
const NOW = Date.parse("2026-03-01T12:00:00.000Z");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function config() {
  return createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://reporting.probe.tld/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "synthetic-only-orbit-key-" + "a".repeat(40),
    HQ_PORTAL_SYNC_TOKEN: "synthetic-only-portal-token-" + "b".repeat(40),
  });
}
function emptyDirectoryDb() {
  const select = vi.fn(() => {
    const chain: any = {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      limit: async () => [],
    };
    return chain;
  });
  return { select };
}
afterEach(() => vi.restoreAllMocks());

describe("actual live service with bounded large synthetic storage", () => {
  it("reproduces the old aggregate cap without publishing or losing prior page commits", async () => {
    const memory = createHqImplementedMemoryStore();
    const result = await createHqImplementedEngine(
      createHqLargeSyntheticReader(),
      memory
    ).sync();
    expect(result).toMatchObject({
      status: "unavailable",
      code: "STATE_BYTE_CAP_EXCEEDED",
      state: null,
    });
    const retained = (await memory.readSync())!;
    expect(retained.published).toBeNull();
    expect(retained.stage?.phase).toBe("bookings");
    expect(retained.stage!.pages).toBeGreaterThan(0);
    expect(retained.stage!.recordsRead).toBe(retained.stage!.pages * 100);
    expect(hqJsonUtf8Bytes(retained)).toBeLessThanOrEqual(16 * 1024 * 1024);
  }, 120000);

  it("imports above16MiB through actual bounded service batches, reloads and checks safe totals with readOFF", async () => {
    const f = offlineHqV2Pool();
    f.advance(NOW - f.now());
    vi.spyOn(Date, "now").mockImplementation(() => f.now());
    const c = config();
    const store = createHqLiveStore(f.pool, c);
    const guard = vi.fn(async () => {});
    const source = createHqLargeSyntheticReader();
    const methods = [
      vi.spyOn(source, "status"),
      vi.spyOn(source, "capabilities"),
      vi.spyOn(source, "bookings"),
      vi.spyOn(source, "businessMappings"),
      vi.spyOn(source, "catalogue"),
      vi.spyOn(source, "changes"),
    ];
    const methodCount = () =>
      methods.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    const batches: { methods: number; elapsedMs: number }[] = [];
    const service = createHqLiveService({
      config: c,
      createStore: () => store,
      createReader: () => source,
      now: f.now,
      onlyInitialPublication: true,
      initialImportGuard: guard,
    });
    const started = performance.now();
    const invokeBatch = async () => {
      const before = methodCount(),
        began = performance.now();
      const result = await service.invoke();
      const calls = methodCount() - before;
      expect(calls).toBeLessThanOrEqual(25);
      batches.push({
        methods: calls,
        elapsedMs: Math.round(performance.now() - began),
      });
      return result;
    };
    let invocations = 0;
    let outcome = await invokeBatch();
    while (outcome.status === "progress" && !outcome.errorCode) {
      invocations++;
      expect(invocations).toBeLessThan(10);
      const pending = await service.getStatus();
      expect(pending.hasPublished).toBe(false);
      expect(pending.readEnabled).toBe(false);
      expect(pending.lastErrorCode).toBeNull();
      expect(await service.readPublished()).toBeNull();
      expect(Date.parse(pending.nextDueAt!) - f.now()).toBe(60000);
      f.advance(Date.parse(pending.nextDueAt!) - f.now());
      outcome = await invokeBatch();
    }
    expect(outcome).toEqual({ status: "applied" });
    expect(invocations).toBeGreaterThan(0);
    const snapshot = await createHqLiveStore(f.pool, c).readSnapshot();
    expect(snapshot.sync?.stage).toBeNull();
    const publication = snapshot.sync!.published!;
    expect(hqJsonUtf8Bytes(snapshot.sync)).toBeGreaterThan(16 * 1024 * 1024);
    expect(Object.keys(publication.entities)).toHaveLength(1203);
    expect(JSON.parse(f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!.state).format).toBe(
      "hq-live-sync-manifest-v2"
    );
    expect(await service.readPublished()).toBeNull();
    const safe = await service.getStatus();
    expect(safe).toMatchObject({
      health: "ready",
      hasPublished: true,
      readEnabled: false,
      progress: null,
      lastErrorCode: null,
    });
    const validation = await validateHqInitialPublication(
      await service.readValidationSnapshot(),
      emptyDirectoryDb(),
      safe,
      guard
    );
    expect(validation.status).toBe("checks_ready");
    expect(validation.years).toHaveLength(1);
    expect(validation.years[0]).toMatchObject({
      year: 2026,
      activeBookings: 720,
      grossSales: "864000.00",
      grossProfit: "144000.00",
      pendingBookings: 480,
      cancelledBookings: 240,
      undatedBookings: 0,
    });
    expect(validation.manualChecksPending).toBe(true);
    expect(JSON.stringify(validation)).not.toMatch(
      /SYNTHETIC-LARGE-|canonicalPayload|sourceFingerprint|chunk:|synthetic-only-/
    );
    expect(await service.invoke()).toEqual({ status: "already_complete" });
    expect(await service.recoverEmptyInitialImport!()).toBe("not_recoverable");
    expect(c.status().readEnabled).toBe(false);
    expect(guard).toHaveBeenCalled();
    const elapsedMs = performance.now() - started;
    // This deterministic SQL model freezes its DB clock between due advances.
    // Measure total runtime honestly; it is not a production latency SLA. Real
    // elapsed-clock lease/batch behavior is tested by the isolated MySQL probe.
    expect(Number.isFinite(elapsedMs) && elapsedMs > 0).toBe(true);
    console.info("SYNTHETIC_V2_PROFILE", {
      bookings: 1200,
      expandedBytes: hqJsonUtf8Bytes(snapshot.sync),
      sqlStatements: f.trace.length,
      invocations: invocations + 1,
      batches,
      elapsedMs: Math.round(elapsedMs),
      rssBytes: process.memoryUsage().rss,
    });
  }, 360000);

  it("reads a nine-page legacy stopped stage without migration, clearing attention, or starting a source", async () => {
    const memory = createHqImplementedMemoryStore();
    let methods = 0;
    const reader = createHqLargeSyntheticReader({
      bookingCount: 1200,
      paddingBytes: 2000,
    });
    await createHqImplementedEngine(reader, memory, {
      shouldContinue: () => ++methods <= 11,
    }).sync();
    const legacy = (await memory.readSync())!;
    expect(legacy.stage).toMatchObject({ pages: 9, recordsRead: 900 });
    const f = offlineHqV2Pool();
    const c = config();
    const store = createHqLiveStore(f.pool, c);
    const claim = await store.acquire();
    expect(claim.status).toBe("acquired");
    if (claim.status !== "acquired") throw new Error("synthetic lease missing");
    const initialRoot = {
      format: "hq-live-sync-v1",
      sourceFingerprint: c.sourceFingerprint(),
      sync: legacy,
    };
    f.rows.set(HQ_LIVE_SYNC_DATASET_ID, {
      datasetId: HQ_LIVE_SYNC_DATASET_ID,
      mode: "live",
      ownerUserId: 0,
      stateVersion: legacy.version,
      state: JSON.stringify(initialRoot),
      updatedAt: new Date(f.now()).toISOString(),
    });
    await store.complete(claim.lease, {
      status: "needs_attention",
      delaySeconds: 3600,
      errorCode: "STATE_BYTE_CAP_EXCEEDED",
    });
    const before = clone(Array.from(f.rows));
    const sourceFactory = vi.fn(() => reader);
    const service = createHqLiveService({
      config: c,
      createStore: () => store,
      createReader: sourceFactory,
      onlyInitialPublication: true,
      initialImportGuard: async () => {},
      now: f.now,
    });
    expect(await service.getStatus()).toMatchObject({
      health: "needs_attention",
      progress: { pages: 9, recordsRead: 900 },
      hasPublished: false,
      lastErrorCode: "STATE_BYTE_CAP_EXCEEDED",
    });
    expect(await service.invoke()).toEqual({ status: "needs_attention" });
    expect(await service.recoverEmptyInitialImport!()).toBe("not_recoverable");
    expect(sourceFactory).not.toHaveBeenCalled();
    expect(clone(Array.from(f.rows))).toEqual(before);
    expect((await store.readSnapshot()).sync).toEqual(legacy);
  }, 120000);

  it.each([NaN, Infinity, -1, 1.1])(
    "refuses malformed streaming measurement %s without any source call or store write",
    async bad => {
      const source = createHqLargeSyntheticReader({ bookingCount: 1 });
      const status = vi.spyOn(source, "status");
      const memory = createHqImplementedMemoryStore();
      const next = {
        version: 1,
        published: null,
        stage: null,
      } as HqImplementedSyncState;
      await memory.compareAndSwapSync(null, next);
      const result = await createHqImplementedEngine(source, memory, {
        ...HQ_LIVE_V2_VALIDATION_OPTIONS,
        measureStateBytes: () => bad,
      }).sync();
      expect(result).toMatchObject({
        status: "unavailable",
        code: "STATE_BYTE_CAP_EXCEEDED",
      });
      expect(status).not.toHaveBeenCalled();
      expect(await memory.readSync()).toEqual(next);
    }
  );
});
