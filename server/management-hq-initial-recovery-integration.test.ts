import { describe, expect, it, vi } from "vitest";
import { createHqLiveConfig } from "./management-hq-live-config";
import { createHqLiveService } from "./management-hq-live-service";
import { createHqLiveStore } from "./management-hq-live-store";
import {
  createHqImplementedSampleReader,
  createHqImplementedSampleDirectory,
} from "./management-hq-implemented-fixtures";
import { getHqReport } from "./management-hq-engine";
import { importHqInitialBatch } from "./management-hq-initial-import";
import type { HqWireReader } from "../shared/management-hq-wire";
import { HQ_PROGRESS_SQL } from "./management-hq-progress";
import { projectHqProgressFixture } from "./management-hq-progress-fixtures";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const settings = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://orbit.thejltgroup.co.uk/api/reporting/v1",
  HQ_ORBIT_REPORTING_API_KEY: "SYNTHETIC-REPORTING-KEY-" + "a".repeat(32),
  HQ_PORTAL_SYNC_TOKEN: "SYNTHETIC-PORTAL-TOKEN-" + "b".repeat(32),
  ...overrides,
});
function offlinePool() {
  const rows = new Map<string, any>();
  let clock = Date.parse("2026-11-22T12:00:00Z"),
    tail = Promise.resolve();
  const pool: any = {
    execute: vi.fn(async (sql: string) => {
      if (sql === HQ_PROGRESS_SQL)
        return [projectHqProgressFixture(rows, clock)];
      throw new Error("no nontransactional SQL");
    }),
    getConnection: vi.fn(async () => {
      let draft: Map<string, any>,
        unlock = () => {},
        started = false;
      return {
        async beginTransaction() {
          const previous = tail;
          tail = new Promise<void>(resolve => {
            unlock = resolve;
          });
          await previous;
          started = true;
          draft = new Map(Array.from(rows, ([k, v]) => [k, clone(v)]));
        },
        async execute(sql: string, args: any[] = []) {
          if (!started) throw new Error("transaction required");
          if (sql.startsWith("SELECT CAST")) return [[{ nowMs: clock }]];
          if (sql.startsWith("SELECT datasetId"))
            return [draft.has(args[0]) ? [clone(draft.get(args[0]))] : []];
          if (sql.startsWith("INSERT IGNORE")) {
            if (draft.has(args[0])) return [{ affectedRows: 0 }];
            draft.set(args[0], {
              datasetId: args[0],
              mode: "live",
              ownerUserId: 0,
              stateVersion: 1,
              state: args[1],
              updatedAt: new Date(clock).toISOString(),
            });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith("UPDATE management_hq_datasets")) {
            const row = draft.get(args[2]);
            if (
              !row ||
              row.mode !== "live" ||
              row.ownerUserId !== 0 ||
              row.stateVersion !== args[3]
            )
              return [{ affectedRows: 0 }];
            draft.set(args[2], {
              ...row,
              stateVersion: args[0],
              state: args[1],
              updatedAt: new Date(clock).toISOString(),
            });
            return [{ affectedRows: 1 }];
          }
          throw new Error("unexpected SQL");
        },
        async commit() {
          rows.clear();
          for (const [k, v] of draft) rows.set(k, clone(v));
          started = false;
          unlock();
        },
        async rollback() {
          if (started) {
            started = false;
            unlock();
          }
        },
        release() {
          if (started) {
            started = false;
            unlock();
          }
        },
      };
    }),
  };
  return {
    pool,
    rows,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
function setup(
  reader = createHqImplementedSampleReader("initial"),
  maxSourceMethods?: number
) {
  const env = settings(),
    config = createHqLiveConfig(env),
    fixture = offlinePool();
  const store = createHqLiveStore(fixture.pool, config);
  const createReader = vi.fn(() => reader),
    guard = vi.fn(async () => {});
  const services: ReturnType<typeof createHqLiveService>[] = [];
  const createService = vi.fn(
    (options: Parameters<typeof createHqLiveService>[0]) => {
      const service = createHqLiveService({
        ...options,
        createStore: () => store,
        createReader,
        now: fixture.now,
        maxSourceMethods,
      });
      vi.spyOn(service, "invoke");
      services.push(service);
      return service;
    }
  );
  const click = () =>
    importHqInitialBatch({ env, config, guard, createService });
  return {
    env,
    config,
    fixture,
    store,
    createReader,
    createService,
    guard,
    services,
    click,
  };
}
const safe = (value: unknown) =>
  expect(JSON.stringify(value)).not.toMatch(
    /SYNTHETIC|customer@|SELECT|https:|resumeCursor|leaseToken|sourceFingerprint|bookingRef|apiKey|private_payload/
  );

import { recoverHqEmptyInitialImport } from "./management-hq-initial-recovery";
describe("actual initial recovery plus existing bounded importer, offline only", () => {
  it("retains initial failure history, recovers once and publishes without enabling reads or later refresh", async () => {
    const base = createHqImplementedSampleReader("initial");
    let invalid = true;
    const s = setup({
      ...base,
      bookings: async query => {
        const page = clone(await base.bookings(query));
        if (invalid)
          (page.items[0].payload as any).financials.grossBookingValue = 1.001;
        return page;
      },
    });
    const failed = await s.click();
    expect(failed.status).toBe("needs_attention");
    expect(failed.errorCode).toBe("INVALID_SEMANTICS");
    const before = await s.store.readSnapshot();
    expect(before.sync).toBeNull();
    expect(before.control!.consecutiveFailures).toBe(1);
    s.fixture.advance(3600001);
    invalid = false;
    const recovered = await recoverHqEmptyInitialImport({
      env: s.env,
      config: s.config,
      guard: s.guard,
      createService: s.createService,
    });
    expect(recovered.status).toBe("recovered");
    safe(recovered);
    expect(s.createReader).toHaveBeenCalledOnce();
    const after = await s.store.readSnapshot();
    expect(after.sync).toBeNull();
    expect(after.control!.lastAttemptAtMs).toBe(
      before.control!.lastAttemptAtMs
    );
    expect(after.control!.consecutiveFailures).toBe(1);
    expect((after.control as any).initialRecovery.previousErrorCode).toBe(
      "INVALID_SEMANTICS"
    );
    expect(
      (
        await recoverHqEmptyInitialImport({
          env: s.env,
          config: s.config,
          guard: s.guard,
          createService: s.createService,
        })
      ).status
    ).toBe("not_recoverable");
    expect((await s.click()).status).toBe("applied");
    const published = clone(await s.store.readPublished());
    expect(published).not.toBeNull();
    expect(s.config.status().readEnabled).toBe(false);
    expect(await s.services[s.services.length - 1].readPublished()).toBeNull();
    const progress = await s.services[s.services.length - 1].getStatus();
    expect(progress).toMatchObject({
      health: "progress",
      payloadIntegrity: "unchecked",
      hasPublished: true,
      readEnabled: false,
      generationId: null,
      isStale: null,
    });
    safe(progress);
    expect(
      (
        await recoverHqEmptyInitialImport({
          env: s.env,
          config: s.config,
          guard: s.guard,
          createService: s.createService,
        })
      ).status
    ).toBe("not_recoverable");
    s.fixture.advance(3600000);
    expect((await s.click()).status).toBe("already_complete");
    expect(await s.store.readPublished()).toEqual(published);
    expect(s.createReader).toHaveBeenCalledTimes(2);
    // The progress exception must never authorize arbitrary outside SQL.
    expect(s.fixture.pool.execute).toHaveBeenCalled();
    expect(
      s.fixture.pool.execute.mock.calls.every(
        ([sql]: [string]) => sql === HQ_PROGRESS_SQL
      )
    ).toBe(true);
    await expect(
      s.fixture.pool.execute(`${HQ_PROGRESS_SQL} FOR UPDATE`)
    ).rejects.toThrow("no nontransactional SQL");
    await expect(
      s.fixture.pool.execute("SELECT state FROM management_hq_datasets")
    ).rejects.toThrow("no nontransactional SQL");
  });
});
