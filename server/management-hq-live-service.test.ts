import { describe, expect, it, vi } from "vitest";
import type { HqWireReader } from "../shared/management-hq-wire";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import { createHqLiveConfig } from "./management-hq-live-config";
import {
  buildHqLiveStatus,
  createHqLiveService,
} from "./management-hq-live-service";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
} from "./management-hq-ingestion";
import * as ingestion from "./management-hq-ingestion";
import {
  createHqLiveStore,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
} from "./management-hq-live-store";
import { HqOrbitClient } from "./management-hq-orbit-client";
import { HQ_LIVE_V2_VALIDATION_OPTIONS } from "./management-hq-storage-v2";
import { HQ_PROGRESS_SQL } from "./management-hq-progress";
import { projectHqProgressFixture } from "./management-hq-progress-fixtures";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function liveConfig(overrides: Record<string, string> = {}) {
  return createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "true",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://reporting.orbittravel.co.uk/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "orbit-test-key-not-live-" + "a".repeat(32),
    HQ_PORTAL_SYNC_TOKEN: "portal-test-token-not-live-" + "b".repeat(32),
    ...overrides,
  });
}
function offlineLivePool() {
  type Row = {
    datasetId: string;
    mode: string;
    ownerUserId: number;
    stateVersion: number;
    state: string;
    updatedAt: string;
  };
  const rows = new Map<string, Row>();
  let clock = Date.parse("2026-11-22T12:00:00Z"),
    tail = Promise.resolve();
  const pool: any = {
    execute: vi.fn(async (sql: string) => {
      if (sql === HQ_PROGRESS_SQL)
        return [projectHqProgressFixture(rows, clock)];
      throw new Error("explicit transaction required");
    }),
    getConnection: vi.fn(async () => {
      let draft: Map<string, Row>,
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
          for (const [id, row] of draft) rows.set(id, clone(row));
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
  const fixture = offlineLivePool(),
    config = liveConfig(),
    store = createHqLiveStore(fixture.pool, config);
  const createReader = vi.fn(() => reader),
    createStore = vi.fn(() => store);
  const service = createHqLiveService({
    config,
    createStore,
    createReader,
    now: fixture.now,
    maxSourceMethods,
  });
  return { fixture, config, store, service, createReader, createStore };
}
function error(code: string, hint?: number): never {
  throw Object.assign(
    new Error("secret provider records/key/raw SQL must not escape"),
    { code, safeRetryAfter: hint }
  );
}
describe("finite external-triggered live runner", () => {
  it.each([
    {},
    { HQ_LIVE_SYNC_ENABLED: "true" },
    { HQ_LIVE_SYNC_ENABLED: "TRUE" },
    { HQ_LIVE_READ_ENABLED: "true" },
  ])(
    "disabled/missing/malformed config touches no dependencies for %j",
    env => {
      const createStore = vi.fn(() => {
          throw new Error("DB forbidden");
        }),
        createReader = vi.fn(() => {
          throw new Error("provider forbidden");
        });
      const service = createHqLiveService({
        config: createHqLiveConfig(env),
        createStore,
        createReader,
      });
      return Promise.all([
        service.invoke(),
        service.getStatus(),
        service.readPublished().catch(() => null),
      ]).then(() => {
        expect(createStore).not.toHaveBeenCalled();
        expect(createReader).not.toHaveBeenCalled();
      });
    }
  );
  it("runs a six-method fixture backfill and honors DB-clock next-due with no early reader", async () => {
    const s = setup();
    expect(await s.service.invoke()).toEqual({ status: "applied" });
    expect(await s.service.invoke()).toEqual({ status: "notdue" });
    expect(s.createReader).toHaveBeenCalledTimes(1);
    const status = await s.service.getStatus();
    expect(status).toMatchObject({
      configured: true,
      hasPublished: true,
      stateVersion: 5,
      generationId: 1,
      stageStatus: "applied",
    });
    expect(status.lastSuccessfulCheckAt).toBe(status.lastPublishedAt);
    expect(JSON.stringify(status)).not.toMatch(
      /resumeCursor|leaseToken|fencingNumber|sourceFingerprint|apiKey|orbit-test-key|bookingRef/
    );
  });
  it("partial three-method batches retain last-good data and resume after a new process", async () => {
    const s = setup(undefined, 3);
    expect(await s.service.invoke()).toEqual({ status: "progress" });
    expect(await s.service.readPublished()).toBeNull();
    expect((await s.store.readSnapshot()).sync?.stage?.phase).toBe("business");
    expect(await s.service.invoke()).toEqual({ status: "notdue" });
    const reader = createHqImplementedSampleReader("initial"),
      bookings = vi.spyOn(reader, "bookings");
    const restarted = createHqLiveService({
      config: s.config,
      createStore: () => createHqLiveStore(s.fixture.pool, s.config),
      createReader: () => reader,
      now: s.fixture.now,
      maxSourceMethods: 3,
    });
    for (let i = 0; i < 3; i++) {
      s.fixture.advance(60000);
      expect((await restarted.invoke()).status).toBe(
        i === 2 ? "applied" : "progress"
      );
    }
    expect(bookings).not.toHaveBeenCalled();
    expect((await restarted.readPublished())?.version).toBe(1);
    const previous = clone(await restarted.readPublished());
    s.fixture.advance(300000);
    const amended = createHqImplementedSampleReader("amended"),
      page = await amended.changes(previous!.resumeCursor);
    const interrupted: HqWireReader = {
      ...amended,
      changes: async cursor =>
        cursor === previous!.resumeCursor
          ? {
              ...page,
              complete: false,
              nextCursor: "pending-change",
              resumeCursor: "not-visible",
            }
          : error("UNAVAILABLE"),
    };
    const changes = createHqLiveService({
      config: s.config,
      createStore: () => s.store,
      createReader: () => interrupted,
      now: s.fixture.now,
      maxSourceMethods: 3,
    });
    expect(await changes.invoke()).toEqual({ status: "progress" });
    expect(await changes.readPublished()).toEqual(previous);
  });
  it("25 source method cap is per invocation, not the cumulative 1000-page generation cap", async () => {
    const base = createHqImplementedSampleReader("initial"),
      first = await base.bookings();
    let methods = 0,
      bookings = 0;
    const reader: HqWireReader = {
      ...base,
      status: async () => {
        methods++;
        return base.status();
      },
      capabilities: async () => {
        methods++;
        return base.capabilities();
      },
      bookings: async q => {
        methods++;
        bookings++;
        const index = q?.cursor ? Number(q.cursor.slice(5)) : 0;
        return {
          ...clone(first),
          items: index ? [] : first.items,
          complete: index === 28,
          nextCursor: index === 28 ? null : `page-${index + 1}`,
        };
      },
      businessMappings: async q => {
        methods++;
        return base.businessMappings(q);
      },
      catalogue: async (t, q) => {
        methods++;
        return base.catalogue(t, q);
      },
    };
    const s = setup(reader);
    expect(await s.service.invoke()).toEqual({ status: "progress" });
    expect(methods).toBe(25);
    expect(bookings).toBe(23);
    expect((await s.store.readSnapshot()).sync?.stage?.pages).toBe(23);
    s.fixture.advance(60000);
    expect(await s.service.invoke()).toEqual({ status: "applied" });
    expect(bookings).toBe(29);
    expect((await s.store.readSnapshot()).sync?.published).not.toBeNull();
  });
  it("method-start deadline yields safely and does not start another source method", async () => {
    const s = setup(),
      base = createHqImplementedSampleReader("initial"),
      calls: string[] = [];
    const service = createHqLiveService({
      config: s.config,
      createStore: () => s.store,
      now: s.fixture.now,
      createReader: () => ({
        ...base,
        status: async () => {
          calls.push("status");
          s.fixture.advance(10000);
          return base.status();
        },
        capabilities: async () => {
          calls.push("capabilities");
          return base.capabilities();
        },
      }),
      methodStartDeadlineMs: 10000,
    });
    expect(await service.invoke()).toEqual({ status: "progress" });
    expect(calls).toEqual(["status"]);
    expect((await s.store.readSnapshot()).control?.leaseToken).toBeNull();
  });
  it("busy/acquire corruption or binding drift never constructs a provider", async () => {
    const s = setup();
    await s.store.acquire();
    expect(await s.service.invoke()).toEqual({ status: "busy" });
    expect(s.createReader).not.toHaveBeenCalled();
    s.fixture.advance(31000);
    const row = s.fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!;
    row.state = "{}";
    expect(await s.service.invoke()).toEqual({
      status: "needs_attention",
      errorCode: "INVALID_PERSISTED_STATE",
    });
    expect(s.createReader).not.toHaveBeenCalled();
  });
  it.each(["RATE_LIMITED", "TIMEOUT", "UNAVAILABLE", "TRANSPORT_FAILURE"])(
    "bounded backoff %s has no immediate retry and honors next due",
    async code => {
      const reader = createHqImplementedSampleReader("initial"),
        status = vi.fn(async () =>
          error(code, code === "RATE_LIMITED" ? 120 : undefined)
        );
      const s = setup({ ...reader, status });
      expect(await s.service.invoke()).toEqual({
        status: "progress",
        errorCode: code,
      });
      expect(status).toHaveBeenCalledTimes(1);
      const delay = code === "RATE_LIMITED" ? 120 : 60;
      expect((await s.store.readSnapshot()).control?.nextDueAtMs).toBe(
        s.fixture.now() + delay * 1000
      );
      s.fixture.advance(delay * 1000 - 1);
      expect(await s.service.invoke()).toEqual({ status: "notdue" });
      expect(status).toHaveBeenCalledTimes(1);
      s.fixture.advance(1);
      expect(await s.service.invoke()).toEqual({
        status: "progress",
        errorCode: code,
      });
      expect((await s.store.readSnapshot()).control?.nextDueAtMs).toBe(
        s.fixture.now() + 120000
      );
      expect(await s.service.getStatus()).toMatchObject({
        health: "backoff",
        lastErrorCode: code,
        hasPublished: false,
      });
    }
  );
  it.each([
    "AUTH_DENIED",
    "INVALID_QUERY",
    "INVALID_PAYLOAD",
    "SCOPE_MISMATCH",
  ])(
    "terminal %s needs explicit attention and preserves partial staging",
    async code => {
      const base = createHqImplementedSampleReader("initial"),
        businessMappings = vi.fn(async () => error(code));
      const s = setup({ ...base, businessMappings });
      expect(await s.service.invoke()).toEqual({
        status: "needs_attention",
        errorCode: code,
      });
      expect((await s.store.readSnapshot()).sync?.stage?.phase).toBe(
        "business"
      );
      s.fixture.advance(4000000);
      expect(await s.service.invoke()).toEqual({ status: "needs_attention" });
      expect(businessMappings).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(await s.service.getStatus())).not.toContain(
        "secret provider"
      );
    }
  );
  it("410 fallback persists its backfill decision when budget yields before the first page", async () => {
    const s = setup();
    await s.service.invoke();
    const previous = await s.service.readPublished();
    s.fixture.advance(300000);
    const base = createHqImplementedSampleReader("amended"),
      changes = vi.fn(async () => error("RESTART_REQUIRED"));
    const limited = createHqLiveService({
      config: s.config,
      createStore: () => s.store,
      createReader: () => ({ ...base, changes }),
      now: s.fixture.now,
      maxSourceMethods: 3,
    });
    expect(await limited.invoke()).toEqual({ status: "progress" });
    const state = (await s.store.readSnapshot()).sync!;
    expect(state.stage).toMatchObject({
      kind: "backfill",
      phase: "bookings",
      pages: 0,
      metadata: null,
    });
    expect(await limited.readPublished()).toEqual(previous);
    s.fixture.advance(60000);
    const resumed = createHqLiveService({
      config: s.config,
      createStore: () => s.store,
      createReader: () => ({ ...base, changes }),
      now: s.fixture.now,
    });
    expect(await resumed.invoke()).toEqual({ status: "applied" });
    expect(changes).toHaveBeenCalledTimes(1);
    expect((await resumed.readPublished())?.metadata.generationId).toBe(2);
  });
  it("persistent 410 does only one fallback per invocation and requires attention", async () => {
    const s = setup();
    await s.service.invoke();
    s.fixture.advance(300000);
    const base = createHqImplementedSampleReader("amended"),
      bookings = vi.fn(async () => error("RESTART_REQUIRED")),
      changes = vi.fn(async () => error("RESTART_REQUIRED"));
    const service = createHqLiveService({
      config: s.config,
      createStore: () => s.store,
      createReader: () => ({ ...base, bookings, changes }),
      now: s.fixture.now,
    });
    expect(await service.invoke()).toEqual({
      status: "needs_attention",
      errorCode: "SOURCE_EXPIRED",
    });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(bookings).toHaveBeenCalledTimes(1);
    expect((await service.readPublished())?.metadata.generationId).toBe(1);
  });
  it("late expired holder cannot publish when a request finishes after crash expiry", async () => {
    const s = setup(),
      base = createHqImplementedSampleReader("initial");
    const service = createHqLiveService({
      config: s.config,
      createStore: () => s.store,
      now: s.fixture.now,
      createReader: () => ({
        ...base,
        bookings: async q => {
          s.fixture.advance(30001);
          const successor = await s.store.acquire();
          expect(successor.status).toBe("acquired");
          return base.bookings(q);
        },
      }),
    });
    expect((await service.invoke()).status).toBe("needs_attention");
    expect(await service.readPublished()).toBeNull();
    expect((await s.store.readSnapshot()).control).toMatchObject({
      fencingNumber: 2,
      stageStatus: "running",
    });
  });
  it("source age grows dynamically and read binding drift returns explicit safe recovery guidance", async () => {
    const s = setup();
    await s.service.invoke();
    const a = await s.service.getStatus();
    s.fixture.advance(1800000);
    const b = await s.service.getStatus();
    expect(b.sourceAgeSeconds! - a.sourceAgeSeconds!).toBe(1800);
    expect(b.isStale).toBe(true);
    const config = liveConfig({
      HQ_ORBIT_REPORTING_API_KEY: "other-key-" + "d".repeat(40),
    });
    const changed = createHqLiveService({
      config,
      createStore: () => createHqLiveStore(s.fixture.pool, config),
      now: s.fixture.now,
    });
    expect(await changed.getStatus()).toMatchObject({
      health: "needs_attention",
      lastErrorCode: "SOURCE_BINDING_CHANGED",
      hasPublished: false,
      recoveryGuidance:
        "restore_original_source_binding_or_explicit_protected_reset",
    });
    await expect(changed.readPublished()).rejects.toMatchObject({
      code: "SOURCE_BINDING_CHANGED",
    });
  });
  it("actual Orbit adapter consumes only in-memory reserved HTTPS fixture transport", async () => {
    const base = createHqImplementedSampleReader("initial"),
      paths: string[] = [];
    const fetcher = vi.fn(async (input: any) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      const q = url.searchParams.has("generationId")
        ? {
            generationId: Number(url.searchParams.get("generationId")),
            limit: 100,
          }
        : { limit: 100 };
      const body = url.pathname.endsWith("/status")
        ? await base.status()
        : url.pathname.endsWith("/capabilities")
          ? await base.capabilities()
          : url.pathname.endsWith("/bookings")
            ? await base.bookings(q)
            : url.pathname.endsWith("/business-mappings")
              ? await base.businessMappings(q)
              : await base.catalogue(
                  url.searchParams.get("entityType") as "booking" | "business",
                  q
                );
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const reader = new HqOrbitClient({
      baseUrl: "https://orbit.test/reporting",
      apiKey: "synthetic-key-" + "x".repeat(40),
      scopeId: "company_all_real_and_unattributed",
      enabled: true,
      fetcher,
      allowFixtureTransport: true,
    });
    const s = setup(reader);
    expect(await s.service.invoke()).toEqual({ status: "applied" });
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(paths.every(p => p.startsWith("/reporting/"))).toBe(true);
  });
  it("read switch denies dataset reads independently of sync-enabled state", async () => {
    const createStore = vi.fn(() => {
      throw new Error("must not touch DB");
    });
    const service = createHqLiveService({
      config: liveConfig({ HQ_LIVE_READ_ENABLED: "false" }),
      createStore,
    });
    expect(await service.readPublished()).toBeNull();
    expect(createStore).not.toHaveBeenCalled();
  });
  it("sync-only status monitors partial import safely without enabling report reads", async () => {
    const s = setup(undefined, 3);
    await s.service.invoke();
    const config = liveConfig({ HQ_LIVE_READ_ENABLED: "false" });
    const store = createHqLiveStore(s.fixture.pool, config);
    const readSnapshot = vi.spyOn(store, "readSnapshot");
    const readProgress = vi.spyOn(store, "readProgressSnapshot");
    const readPublished = vi.spyOn(store, "readPublished");
    const createReader = vi.fn(() => {
      throw new Error("provider forbidden");
    });
    const service = createHqLiveService({
      config,
      createStore: () => store,
      createReader,
      now: s.fixture.now,
    });
    const status = await service.getStatus();
    expect(status).toMatchObject({
      readEnabled: false,
      syncEnabled: true,
      health: "progress",
      hasPublished: false,
      progress: { kind: "backfill", phase: "business" },
      payloadIntegrity: "unchecked",
    });
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(readProgress).toHaveBeenCalledOnce();
    expect(await service.readPublished()).toBeNull();
    expect(readPublished).not.toHaveBeenCalled();
    expect(createReader).not.toHaveBeenCalled();
    expect(JSON.stringify(status)).not.toMatch(
      /resumeCursor|leaseToken|sourceFingerprint|bookingRef|apiKey|orbit-test-key/
    );
  });
  it("corrupt cached envelope cannot reach report or provider and safe status exposes no partial view", async () => {
    const s = setup();
    await s.service.invoke();
    s.fixture.rows.get(HQ_LIVE_SYNC_DATASET_ID)!.state =
      '{"format":"hq-live-sync-v1","sync":null}';
    await expect(s.service.readPublished()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
    expect(await s.service.getStatus()).toMatchObject({
      health: "needs_attention",
      hasPublished: false,
      lastErrorCode: "INVALID_PERSISTED_STATE",
    });
    s.fixture.advance(300000);
    expect(await s.service.invoke()).toEqual({
      status: "needs_attention",
      errorCode: "INVALID_PERSISTED_STATE",
    });
    expect(s.createReader).toHaveBeenCalledTimes(1);
  });
  it("rechecks DB binding before any cached default-store read, invoke or status without reusing A", async () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    const fixture = offlineLivePool(),
      createPool = vi.fn(() => fixture.pool),
      createReader = vi.fn(() => createHqImplementedSampleReader("initial"));
    vi.resetModules();
    vi.doMock("mysql2/promise", () => ({ createPool }));
    try {
      process.env.DATABASE_URL =
        "mysql://synthetic:fixture@db-a.invalid/reporting";
      const { createHqLiveService: createDefaultService } = await import(
        "./management-hq-live-service"
      );
      const service = createDefaultService({
        config: liveConfig(),
        createReader,
      });
      expect(await service.readPublished()).toBeNull();
      expect(
        await createDefaultService({ config: liveConfig() }).readPublished()
      ).toBeNull();
      expect(createPool).toHaveBeenCalledOnce();
      expect(createPool).toHaveBeenCalledWith({
        uri: process.env.DATABASE_URL,
        connectionLimit: 3,
        waitForConnections: true,
        queueLimit: 10,
        connectTimeout: 10000,
        timezone: "Z",
      });
      const connections = fixture.pool.getConnection.mock.calls.length;
      process.env.DATABASE_URL =
        "mysql://synthetic:fixture@db-b.invalid/reporting";
      await expect(service.readPublished()).rejects.toMatchObject({
        code: "CONFIG_INVALID",
      });
      expect(await service.invoke()).toEqual({
        status: "needs_attention",
        errorCode: "CONFIG_INVALID",
      });
      expect(await service.getStatus()).toMatchObject({
        health: "needs_attention",
        lastErrorCode: "CONFIG_INVALID",
        hasPublished: false,
      });
      expect(fixture.pool.getConnection).toHaveBeenCalledTimes(connections);
      expect(fixture.pool.execute).not.toHaveBeenCalled();
      expect(createPool).toHaveBeenCalledOnce();
      expect(createReader).not.toHaveBeenCalled();
    } finally {
      delete process.env.DATABASE_URL;
      vi.doUnmock("mysql2/promise");
      vi.resetModules();
    }
  });
  it("injected fixture stores stay independent of runtime DATABASE_URL drift", async () => {
    const s = setup();
    expect(process.env.DATABASE_URL).toBeUndefined();
    try {
      process.env.DATABASE_URL =
        "mysql://synthetic:fixture@db-a.invalid/reporting";
      expect(await s.service.invoke()).toEqual({ status: "applied" });
      process.env.DATABASE_URL =
        "mysql://synthetic:fixture@db-b.invalid/reporting";
      expect(await s.service.readPublished()).not.toBeNull();
      expect((await s.service.getStatus()).hasPublished).toBe(true);
      expect(await s.service.invoke()).toEqual({ status: "notdue" });
      expect(s.createStore).toHaveBeenCalledOnce();
    } finally {
      delete process.env.DATABASE_URL;
    }
  });
  it("default path missing DATABASE_URL fails closed without any provider construction", async () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    const createReader = vi.fn(() =>
      createHqImplementedSampleReader("initial")
    );
    const service = createHqLiveService({ config: liveConfig(), createReader });
    expect(await service.invoke()).toEqual({
      status: "needs_attention",
      errorCode: "STORE_UNAVAILABLE",
    });
    expect(createReader).not.toHaveBeenCalled();
  });
});

describe("safe live status source freshness projection", () => {
  it.each([
    [60, false, 120, 60, true],
    [900, true, 5, 900, true],
    [1800, false, 120, 900, false],
  ])(
    "uses source target %i, source stale %s and age %i with the stricter portal target",
    async (sourceTarget, sourceStale, age, target, stale) => {
      const memory = createHqImplementedMemoryStore();
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        memory
      ).backfill();
      const sync = (await memory.readSync())!,
        metadata = sync.published!.metadata;
      metadata.freshnessTargetSeconds = sourceTarget;
      metadata.sourceAgeSeconds = age;
      metadata.stale = sourceStale;
      const now = Date.parse(metadata.sourceObservationWindow.to) + age * 1000;
      // The current wire schema pins source target to 900. Isolate projection math only here;
      // production read-boundary validation remains unchanged and rejects non-contract targets.
      const validator = vi
        .spyOn(ingestion, "validateHqImplementedSyncState")
        .mockImplementation(() => {});
      try {
        const status = buildHqLiveStatus(
          liveConfig().status(),
          { control: null, sync, databaseNowMs: now },
          now
        );
        expect(validator).toHaveBeenCalledWith(
          sync,
          HQ_LIVE_V2_VALIDATION_OPTIONS
        );
        expect(status).toMatchObject({
          sourceAgeSeconds: age,
          freshnessTargetSeconds: target,
          isStale: stale,
          health: stale ? "stale" : "ready",
        });
        expect(JSON.stringify(status)).not.toMatch(
          /resumeCursor|leaseToken|sourceFingerprint|bookingRef|apiKey/
        );
      } finally {
        validator.mockRestore();
      }
    }
  );
});
