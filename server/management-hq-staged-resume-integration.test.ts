import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
} from "./management-hq-ingestion";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import { createHqLiveConfig } from "./management-hq-live-config";
import {
  createHqLiveStore,
  HQ_LIVE_CONTROL_DATASET_ID as CONTROL,
  HQ_LIVE_SYNC_DATASET_ID as SYNC,
} from "./management-hq-live-store";
import { createHqLiveService } from "./management-hq-live-service";
import { offlineHqV2Pool } from "./management-hq-storage-v2-pool";
import { hqJsonUtf8Bytes } from "./management-hq-storage-v2";
import { resumeHqStagedInitialImport } from "./management-hq-staged-resume";
import { importHqInitialBatch } from "./management-hq-initial-import";
import { validateHqInitialPublication } from "./management-hq-initial-validation";

vi.mock("./agent-merge-identity", () => ({
  getAgentMergeTarget: vi.fn(async () => null),
}));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const safe = (v: unknown) =>
  expect(JSON.stringify(v)).not.toMatch(
    /SYNTHETIC-LARGE-|synthetic-only-|canonicalPayload|sourceFingerprint|chunk:|leaseToken|https:|cursor|fromControlVersion/i
  );
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

describe("actual staged Resume and separately invoked bounded importer, offline only", () => {
  it("preserves all nine pages and original failure history, resumes once and publishes with normal reads off", async () => {
    const env = {
      HQ_LIVE_SYNC_ENABLED: "true",
      HQ_LIVE_READ_ENABLED: "false",
      HQ_ORBIT_REPORTING_BASE_URL:
        "https://reporting.probe.tld/api/management-hq",
      HQ_ORBIT_REPORTING_API_KEY: "synthetic-only-orbit-key-" + "a".repeat(40),
      HQ_PORTAL_SYNC_TOKEN: "synthetic-only-portal-token-" + "b".repeat(40),
    };
    const config = createHqLiveConfig(env);
    const f = offlineHqV2Pool();
    f.advance(Date.parse("2026-03-01T12:00:00Z") - f.now());
    vi.spyOn(Date, "now").mockImplementation(f.now);
    // Small synthetic payloads keep this regression fast. The cap below is a
    // deliberately smaller fixture cap, not a change to any production limit.
    const source = createHqLargeSyntheticReader({
      bookingCount: 1000,
      paddingBytes: 0,
    });
    const memory = createHqImplementedMemoryStore();
    let methods = 0;
    expect(
      (
        await createHqImplementedEngine(source, memory, {
          shouldContinue: () => ++methods <= 11,
        }).sync()
      ).status
    ).toBe("yielded");
    const legacy = (await memory.readSync())!;
    expect(legacy.stage).toMatchObject({
      kind: "backfill",
      phase: "bookings",
      pages: 9,
      recordsRead: 900,
    });
    const capped = await createHqImplementedEngine(source, memory, {
      maxStateBytes: hqJsonUtf8Bytes(legacy),
    }).sync();
    expect(capped).toMatchObject({
      status: "unavailable",
      code: "STATE_BYTE_CAP_EXCEEDED",
      state: null,
    });
    expect(await memory.readSync()).toEqual(legacy);
    const store = createHqLiveStore(f.pool, config);
    const acquired = await store.acquire();
    expect(acquired.status).toBe("acquired");
    if (acquired.status !== "acquired")
      throw new Error("fixture lease missing");
    f.rows.set(SYNC, {
      datasetId: SYNC,
      mode: "live",
      ownerUserId: 0,
      stateVersion: legacy.version,
      state: JSON.stringify({
        format: "hq-live-sync-v1",
        sourceFingerprint: config.sourceFingerprint(),
        sync: legacy,
      }),
      updatedAt: new Date(f.now()).toISOString(),
    });
    await store.complete(acquired.lease, {
      status: "needs_attention",
      // Fixture-only short due delay keeps this pinned synthetic observation
      // fresh. Native production attention cooldowns remain unchanged.
      delaySeconds: 60,
      errorCode: "STATE_BYTE_CAP_EXCEEDED",
    });
    // Retain the real rollout's earlier empty recovery/failed-attempt shape.
    const controlRow = f.rows.get(CONTROL)!;
    const history = JSON.parse(controlRow.state);
    history.consecutiveFailures = 2;
    history.initialRecovery = {
      format: "empty-initial-recovery-v1",
      atMs: f.now() - 10000,
      fromControlVersion: 1,
      previousErrorCode: "INVALID_SEMANTICS",
      previousAttemptAtMs: f.now() - 20000,
    };
    controlRow.state = JSON.stringify(history);
    const guard = vi.fn(async () => {});
    const createReader = vi.fn(() => source);
    const createService = (
      options: Parameters<typeof createHqLiveService>[0]
    ) =>
      createHqLiveService({
        ...options,
        createStore: () => store,
        createReader,
        now: f.now,
        maxSourceMethods: 5,
      });
    const resume = () =>
      resumeHqStagedInitialImport({ env, config, guard, createService });
    const batch = () =>
      importHqInitialBatch({ env, config, guard, createService });
    const before = clone(Array.from(f.rows));
    expect((await batch()).status).toBe("needs_attention");
    expect((await resume()).status).toBe("notdue");
    expect(Array.from(f.rows)).toEqual(before);
    expect(createReader).not.toHaveBeenCalled();
    f.advance(60000);
    const initial = await store.readSnapshot();
    const traceStart = f.trace.length;
    const result = await resume();
    expect(result.status).toBe("resumed");
    safe(result);
    expect(createReader).not.toHaveBeenCalled();
    expect(f.rows.get(SYNC)).toEqual(before.find(([id]) => id === SYNC)![1]);
    const mutations = f.trace
      .slice(traceStart)
      .filter(x => /^(INSERT|UPDATE|DELETE)/.test(x.sql));
    expect(mutations).toHaveLength(1);
    expect(mutations[0].args[2]).toBe(CONTROL);
    const after = await store.readSnapshot();
    expect(after.sync).toEqual(legacy);
    expect(after.control).toMatchObject({
      consecutiveFailures: 2,
      lastAttemptAtMs: initial.control!.lastAttemptAtMs,
      lastSuccessAtMs: null,
      lastPublishAtMs: null,
      stageStatus: "progress",
      lastErrorCode: null,
      nextDueAtMs: initial.control!.nextDueAtMs,
      initialRecovery: history.initialRecovery,
      initialStagedResume: {
        previousErrorCode: "STATE_BYTE_CAP_EXCEEDED",
        pages: 9,
        recordsRead: 900,
        syncVersion: 9,
      },
    });
    expect((await resume()).status).toBe("not_resumable");
    let outcome = await batch();
    let batches = 1;
    while (outcome.status === "progress") {
      expect(++batches).toBeLessThan(12);
      expect(outcome.hasPublished).toBe(false);
      expect(outcome.nextDueAt).not.toBeNull();
      const due = Date.parse(outcome.nextDueAt!);
      expect(due - f.now()).toBe(60000);
      expect((await batch()).status).toBe("notdue");
      f.advance(due - f.now());
      outcome = await batch();
    }
    expect(outcome.status).toBe("applied");
    expect(batches).toBeGreaterThan(1);
    const service = createService({
      config,
      onlyInitialPublication: true,
      initialImportGuard: guard,
    });
    const final = await store.readSnapshot();
    expect(final.sync!.stage).toBeNull();
    expect(Object.keys(final.sync!.published!.entities)).toHaveLength(1003);
    expect(final.control!.initialStagedResume).toEqual(
      after.control!.initialStagedResume
    );
    expect(final.control!.initialRecovery).toEqual(history.initialRecovery);
    expect(await service.readPublished()).toBeNull();
    expect(config.status().readEnabled).toBe(false);
    const progress = await service.getStatus();
    expect(progress).toMatchObject({
      health: "progress",
      payloadIntegrity: "unchecked",
      hasPublished: true,
      readEnabled: false,
      stateVersion: final.sync!.version,
      generationId: null,
      isStale: null,
      progress: null,
    });
    safe(progress);
    const validationStatus = await service.getValidationStatus!();
    expect(validationStatus).toMatchObject({
      health: "ready",
      payloadIntegrity: "validated",
      hasPublished: true,
      readEnabled: false,
      stateVersion: final.sync!.version,
      generationId: final.sync!.published!.metadata.generationId,
      isStale: false,
      progress: null,
      lastErrorCode: null,
    });
    const checks = await validateHqInitialPublication(
      await service.readValidationSnapshot(),
      emptyDirectoryDb(),
      validationStatus,
      guard
    );
    expect(checks.status).toBe("checks_ready");
    expect(checks.years[0]).toMatchObject({
      year: 2026,
      activeBookings: 600,
      grossSales: "720000.00",
      grossProfit: "120000.00",
      pendingBookings: 400,
      cancelledBookings: 200,
      undatedBookings: 0,
    });
    expect(checks.manualChecksPending).toBe(true);
    expect(checks.generationId).toBe(validationStatus.generationId);
    expect(checks.sourcePublishedAt).toBe(validationStatus.sourcePublishedAt);
    expect(checks.isStale).toBe(false);
    expect(await service.getValidationStatus!()).toMatchObject({
      health: "ready",
      stateVersion: validationStatus.stateVersion,
      generationId: validationStatus.generationId,
      isStale: false,
      readEnabled: false,
    });
    safe(checks);
    const reads = createReader.mock.calls.length;
    expect((await resume()).status).toBe("not_resumable");
    expect((await batch()).status).toBe("already_complete");
    expect(createReader).toHaveBeenCalledTimes(reads);
    expect((await store.readSnapshot()).sync).toEqual(final.sync);
  }, 120000);
});
