import { describe, expect, it, vi } from "vitest";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
} from "./management-hq-ingestion";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import { createHqLiveConfig } from "./management-hq-live-config";
import {
  createHqLiveStore,
  HQ_LIVE_SYNC_DATASET_ID,
} from "./management-hq-live-store";
import {
  encodeHqLiveV2Sync,
  HQ_LIVE_V2_VALIDATION_OPTIONS,
} from "./management-hq-storage-v2";
import { offlineHqV2Pool } from "./management-hq-storage-v2-pool";
const A = "mysql://synthetic-a.invalid/hq";
const B = "mysql://synthetic-b.invalid/hq";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const configuration = () =>
  createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://offline-synthetic.probe.tld/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "synthetic-key-" + "a".repeat(40),
    HQ_PORTAL_SYNC_TOKEN: "synthetic-token-" + "b".repeat(40),
  });

describe("HQ service action-wide default DB denial latch", () => {
  it("retains B observed at a real CPU handoff after lease acquisition even when fresh authority immediately restores A", async () => {
    const fixture = offlineHqV2Pool(),
      config = configuration();
    const memory = createHqImplementedMemoryStore();
    let methods = 0;
    const reader = createHqLargeSyntheticReader({
      bookingCount: 200,
      paddingBytes: 4096,
    });
    expect(
      (
        await createHqImplementedEngine(reader, memory, {
          ...HQ_LIVE_V2_VALIDATION_OPTIONS,
          shouldContinue: () => ++methods <= 3,
        }).backfill()
      ).status
    ).toBe("yielded");
    const state = copy((await memory.readSync())!);
    const initialization = createHqLiveStore(fixture.pool, config);
    const acquired = await initialization.acquire();
    if (acquired.status !== "acquired")
      throw new Error("synthetic initialization lease required");
    const encoded = encodeHqLiveV2Sync(state, config.sourceFingerprint()!);
    const row = (datasetId: string, text: string, version = 1) => ({
      datasetId,
      mode: "live",
      ownerUserId: 0,
      stateVersion: version,
      state: text,
      updatedAt: "2026-11-22T12:00:00.000Z",
    });
    fixture.rows.set(
      HQ_LIVE_SYNC_DATASET_ID,
      row(
        HQ_LIVE_SYNC_DATASET_ID,
        JSON.stringify(encoded.manifest),
        state.version
      )
    );
    for (const chunk of encoded.chunks)
      fixture.rows.set(chunk.id, row(chunk.id, chunk.serialized));
    await initialization.complete(acquired.lease, {
      status: "progress",
      delaySeconds: 0,
    });
    let armed = false,
      observed = false,
      restored = false,
      freshAfterDrift = 0;
    let before: any[] = [],
      traceFrom = 0,
      commitsFrom = 0;
    fixture.setAfterHook((sql, args, draft) => {
      if (sql.startsWith("UPDATE") && args[2] !== HQ_LIVE_SYNC_DATASET_ID) {
        const control = JSON.parse(draft.get(args[2])!.state);
        if (control.stageStatus === "running" && control.leaseToken)
          armed = true;
      }
    });
    fixture.setHook((sql, args) => {
      if (
        armed &&
        !observed &&
        sql.startsWith("SELECT datasetId") &&
        args[0] === HQ_LIVE_SYNC_DATASET_ID
      ) {
        observed = true;
        before = copy(Array.from(fixture.rows));
        traceFrom = fixture.trace.length;
        commitsFrom = fixture.commits.mock.calls.length;
        process.env.DATABASE_URL = B;
      }
    });
    const source = {
      ...reader,
      status: vi.fn(reader.status),
      capabilities: vi.fn(reader.capabilities),
      bookings: vi.fn(reader.bookings),
    };
    const createReader = vi.fn(() => source),
      createPool = vi.fn(() => fixture.pool);
    vi.resetModules();
    vi.doMock("mysql2/promise", () => ({ createPool }));
    try {
      vi.stubEnv("DATABASE_URL", A);
      const { createHqLiveService } = await import(
        "./management-hq-live-service"
      );
      const service = createHqLiveService({
        config,
        createReader,
        onlyInitialPublication: true,
        maxSourceMethods: 3,
        initialImportGuard: async () => {
          if (observed) {
            freshAfterDrift++;
            restored = true;
            process.env.DATABASE_URL = A;
          }
        },
      });
      expect(await service.invoke()).toEqual({
        status: "needs_attention",
        errorCode: "CONFIG_INVALID",
      });
      expect(observed).toBe(true);
      expect(restored).toBe(true);
      expect(freshAfterDrift).toBeGreaterThan(1);
      expect(Array.from(fixture.rows)).toEqual(before);
      expect(fixture.commits.mock.calls.length).toBe(commitsFrom);
      expect(
        fixture.trace
          .slice(traceFrom)
          .filter(item => /^(?:INSERT|UPDATE|DELETE)/.test(item.sql))
      ).toHaveLength(0);
      expect(source.status).not.toHaveBeenCalled();
      expect(source.capabilities).not.toHaveBeenCalled();
      expect(source.bookings).not.toHaveBeenCalled();
      expect(createPool).toHaveBeenCalledOnce();
      // The failed action's latch does not poison a distinct, restored read action.
      const status = await service.getStatus();
      expect(status.payloadIntegrity).toBe("unchecked");
      expect(status.health).toBe("progress");
      expect(Array.from(fixture.rows)).toEqual(before);
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock("mysql2/promise");
      vi.resetModules();
    }
  });
});
