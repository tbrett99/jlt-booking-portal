import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HqWireReader } from "../shared/management-hq-wire";
import {
  finishHqInitialBatch,
  importHqInitialBatch,
  HQ_INITIAL_IMPORT_MAX_SOURCE_METHODS,
} from "./management-hq-initial-import";
import {
  createHqLiveService,
  HQ_LIVE_MAX_SOURCE_METHODS,
  HQ_LIVE_METHOD_START_DEADLINE_MS,
  HQ_LIVE_PROGRESS_DELAY_SECONDS,
  type HqLiveServiceOptions,
} from "./management-hq-live-service";
import {
  createHqLiveStore,
  HqLiveError,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_LEASE_SECONDS,
  HQ_LIVE_MAX_LEASE_SECONDS,
  HQ_LIVE_SYNC_DATASET_ID,
} from "./management-hq-live-store";
import { createHqLiveConfig } from "./management-hq-live-config";
import {
  createHqImplementedSampleDirectory,
  createHqImplementedSampleReader,
  HQ_IMPLEMENTED_SAMPLE_PROVENANCE,
} from "./management-hq-implemented-fixtures";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
} from "./management-hq-ingestion";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import * as cooperation from "./management-hq-cooperative";
import { offlineHqV2Pool } from "./management-hq-storage-v2-pool";
import { getHqReport } from "./management-hq-engine";
import { HQ_PROGRESS_SQL } from "./management-hq-progress";
import supplied from "./fixtures/management-hq-implemented-http-examples.json";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const settings = (): NodeJS.ProcessEnv => ({
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://orbit.thejltgroup.co.uk/api/reporting/v1",
  HQ_ORBIT_REPORTING_API_KEY: "offline-accelerated-key-" + "a".repeat(40),
  HQ_PORTAL_SYNC_TOKEN: "offline-accelerated-token-" + "b".repeat(40),
});
function instrument(base: HqWireReader) {
  const calls: string[] = [];
  const reader: HqWireReader = {
    status: vi.fn(() => {
      calls.push("status");
      return base.status();
    }),
    capabilities: vi.fn(() => {
      calls.push("capabilities");
      return base.capabilities();
    }),
    bookings: vi.fn(query => {
      calls.push("bookings");
      return base.bookings(query);
    }),
    businessMappings: vi.fn(query => {
      calls.push("businessMappings");
      return base.businessMappings(query);
    }),
    catalogue: vi.fn((type, query) => {
      calls.push(`catalogue:${type}`);
      return base.catalogue(type, query);
    }),
    changes: vi.fn((cursor, limit) => {
      calls.push("changes");
      return base.changes(cursor, limit);
    }),
  };
  return { reader, calls };
}
function setup(reader = createHqImplementedSampleReader("initial")) {
  const env = settings();
  const config = createHqLiveConfig(env);
  const fixture = offlineHqV2Pool();
  const store = createHqLiveStore(fixture.pool, config);
  const guard = vi.fn(async () => {});
  const createReader = vi.fn(() => reader);
  const services: ReturnType<typeof createHqLiveService>[] = [];
  const configure = {
    override: null as
      | null
      | ((options: HqLiveServiceOptions) => HqLiveServiceOptions),
  };
  const createService = vi.fn((options: HqLiveServiceOptions) => {
    const actual = {
      ...options,
      createStore: () => store,
      createReader,
      now: fixture.now,
    };
    const service = createHqLiveService(
      configure.override ? configure.override(actual) : actual
    );
    vi.spyOn(service, "invoke");
    services.push(service);
    return service;
  });
  const finish = () =>
    finishHqInitialBatch({ env, config, guard, createService });
  const manual = () =>
    importHqInitialBatch({ env, config, guard, createService });
  return {
    env,
    config,
    fixture,
    store,
    guard,
    createReader,
    createService,
    configure,
    services,
    finish,
    manual,
  };
}
const safe = (value: unknown) =>
  expect(JSON.stringify(value)).not.toMatch(
    /offline-accelerated-key|offline-accelerated-token|SELECT|https:|resumeCursor|leaseToken|sourceFingerprint|bookingRef|canonicalPayload/
  );
const writes = (f: ReturnType<typeof offlineHqV2Pool>, from = 0) =>
  f.trace
    .slice(from)
    .filter(entry => /^(INSERT|UPDATE|DELETE)/.test(entry.sql));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("real accelerated initial-only helper, offline SQL and source fixtures", () => {
  it("retains the old manual three-method maximum while the new protected helper defaults to the existing 25", async () => {
    expect(HQ_INITIAL_IMPORT_MAX_SOURCE_METHODS).toBe(3);
    expect(HQ_LIVE_MAX_SOURCE_METHODS).toBe(25);
    const oldSource = instrument(createHqImplementedSampleReader("initial"));
    const old = setup(oldSource.reader);
    expect(await old.manual()).toMatchObject({
      status: "progress",
      hasPublished: false,
      progress: { pages: 1, recordsRead: 1 },
    });
    expect(oldSource.calls).toEqual(["status", "capabilities", "bookings"]);
    expect(old.createService.mock.calls[0][0]).toMatchObject({
      onlyInitialPublication: true,
      maxSourceMethods: 3,
    });
    expect(
      old.createService.mock.calls[0][0].acceleratedInitialImport
    ).toBeUndefined();
    const fastSource = instrument(createHqImplementedSampleReader("initial"));
    const fast = setup(fastSource.reader);
    const result = await fast.finish();
    expect(result).toMatchObject({ status: "applied", hasPublished: true });
    expect(fast.createService.mock.calls[0][0]).toMatchObject({
      onlyInitialPublication: true,
      maxSourceMethods: 25,
      acceleratedInitialImport: true,
      initialImportGuard: expect.any(Function),
      initialImportCpuBindingGuard: expect.any(Function),
    });
    expect(fastSource.calls).toEqual([
      "status",
      "capabilities",
      "bookings",
      "businessMappings",
      "catalogue:booking",
      "catalogue:business",
    ]);
    expect(fast.services[0].invoke).toHaveBeenCalledOnce();
    expect(await fast.services[0].readPublished()).toBeNull();
    expect(await fast.services[0].readValidationSnapshot()).not.toBeNull();
    expect(fast.config.status().readEnabled).toBe(false);
    safe(result);
  });

  it("fully publishes a small feed without ordinary reads, provider transport or implicit work", async () => {
    const source = instrument(createHqImplementedSampleReader("initial"));
    const s = setup(source.reader);
    const network = vi.fn(() => {
      throw new Error("No network in offline tests");
    });
    vi.stubGlobal("fetch", network);
    const read = vi.spyOn(s.store, "readPublished");
    expect(s.fixture.rows.size).toBe(0);
    expect(s.createReader).not.toHaveBeenCalled();
    expect(s.createService).not.toHaveBeenCalled();
    const outcome = await s.finish();
    expect(outcome.status).toBe("applied");
    expect(read).not.toHaveBeenCalled();
    expect(await s.services[0].readPublished()).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect((await s.store.readSnapshot()).sync).toMatchObject({
      stage: null,
      published: { version: 1 },
    });
    expect(source.calls).not.toContain("changes");
    expect(network).not.toHaveBeenCalled();
    expect(
      s.fixture.trace
        .filter(t => t.transaction === 0)
        .every(t => t.sql === HQ_PROGRESS_SQL)
    ).toBe(true);
    safe(outcome);
  });

  it("strongly refuses an existing publication before provider construction and never begins a refresh", async () => {
    const s = setup();
    expect((await s.finish()).status).toBe("applied");
    s.fixture.advance(3600000);
    const before = copy(Array.from(s.fixture.rows));
    const complete = vi.spyOn(s.store, "complete");
    const result = await s.finish();
    expect(result).toMatchObject({
      status: "already_complete",
      hasPublished: true,
    });
    expect(s.services[1].invoke).toHaveBeenCalledOnce();
    expect(s.createReader).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
    expect(Array.from(s.fixture.rows)).toEqual(before);
    safe(result);
  });

  it("rejects an unchecked corrupted publication instead of refreshing or trusting its header", async () => {
    const s = setup();
    expect((await s.finish()).status).toBe("applied");
    const root = s.fixture.rows.get(HQ_LIVE_SYNC_DATASET_ID)!;
    const envelope = JSON.parse(root.state);
    envelope.sync.published.entities["booking:1"].canonicalPayload = "{}";
    root.state = JSON.stringify(envelope);
    s.fixture.advance(3600000);
    const before = copy(Array.from(s.fixture.rows));
    expect(await s.finish()).toMatchObject({
      status: "needs_attention",
      errorCode: "INVALID_PERSISTED_STATE",
    });
    expect(s.createReader).toHaveBeenCalledOnce();
    expect(Array.from(s.fixture.rows)).toEqual(before);
  });

  it("honors a pre-existing future due time without forcing a clear or another source batch", async () => {
    const s = setup();
    expect((await s.manual()).status).toBe("progress");
    const before = copy(Array.from(s.fixture.rows));
    const traceFrom = s.fixture.trace.length;
    const complete = vi.spyOn(s.store, "complete");
    expect(await s.finish()).toMatchObject({
      status: "notdue",
      hasPublished: false,
    });
    expect(s.createReader).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
    expect(
      writes(s.fixture, traceFrom).map(entry =>
        entry.sql.startsWith("INSERT IGNORE")
      )
    ).toEqual([true]);
    expect(Array.from(s.fixture.rows)).toEqual(before);
  });

  it("honors a live busy lease, preserving token, hard cap and all stored rows", async () => {
    const s = setup();
    const claim = await s.store.acquire();
    expect(claim.status).toBe("acquired");
    const control = (await s.store.readSnapshot()).control!;
    expect(control.leaseExpiresAtMs! - s.fixture.now()).toBe(30000);
    expect(control.leaseHardExpiresAtMs! - s.fixture.now()).toBe(95000);
    const before = copy(Array.from(s.fixture.rows));
    const traceFrom = s.fixture.trace.length;
    const complete = vi.spyOn(s.store, "complete");
    expect((await s.finish()).status).toBe("busy");
    expect(s.createReader).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(
      writes(s.fixture, traceFrom).map(entry =>
        entry.sql.startsWith("INSERT IGNORE")
      )
    ).toEqual([true]);
    expect(Array.from(s.fixture.rows)).toEqual(before);
  });

  it("uses at most 25 methods in an unfinished feed and resumes retained staging immediately only for accelerated yield", async () => {
    const base = createHqImplementedSampleReader("initial");
    const first = await base.bookings();
    const bookings = vi.fn(async (query?: any) => {
      const index = query?.cursor ? Number(query.cursor.slice(5)) : 0;
      return {
        ...copy(first),
        items: index ? [] : first.items,
        complete: index === 28,
        nextCursor: index === 28 ? null : `page-${index + 1}`,
      };
    });
    const source = instrument({ ...base, bookings });
    const s = setup(source.reader);
    const response = await s.finish();
    expect(response).toMatchObject({
      status: "progress",
      hasPublished: false,
      progress: { pages: 23, recordsRead: 1 },
    });
    expect(source.calls).toHaveLength(25);
    expect(bookings).toHaveBeenCalledTimes(23);
    const stage = copy((await s.store.readSnapshot()).sync!.stage);
    expect(stage).toMatchObject({
      phase: "bookings",
      pages: 23,
      recordsRead: 1,
      cursor: "page-23",
    });
    expect(Date.parse(response.nextDueAt!) - s.fixture.now()).toBe(0);
    expect((await s.finish()).status).toBe("applied");
    expect(bookings).toHaveBeenCalledTimes(29);
    expect(source.calls.slice(25)).toHaveLength(11);
    expect((await s.store.readSnapshot()).sync!.stage).toBeNull();
  });

  it.each(["manual", "native", "accelerated"] as const)(
    "keeps %s yield delay separate from the unchanged legacy 60 seconds",
    async profile => {
      const source = instrument(createHqImplementedSampleReader("initial"));
      const s = setup(source.reader);
      let result: { status: string };
      if (profile === "native") {
        const service = createHqLiveService({
          config: s.config,
          createStore: () => s.store,
          createReader: s.createReader,
          now: s.fixture.now,
          maxSourceMethods: 3,
        });
        result = await service.invoke();
      } else {
        if (profile === "accelerated")
          s.configure.override = options => ({
            ...options,
            maxSourceMethods: 3,
          });
        result = await (profile === "manual" ? s.manual() : s.finish());
      }
      expect(result.status).toBe("progress");
      const control = (await s.store.readSnapshot()).control!;
      expect(control.nextDueAtMs - s.fixture.now()).toBe(
        profile === "accelerated" ? 0 : 60000
      );
      expect(control).toMatchObject({
        stageStatus: "progress",
        consecutiveFailures: 0,
        leaseToken: null,
      });
      expect(source.calls).toHaveLength(3);
      expect(HQ_LIVE_PROGRESS_DELAY_SECONDS).toBe(60);
    }
  );

  it.each(["manual", "native", "accelerated"] as const)(
    "keeps %s transient-error backoff at 60 seconds and does not retry before due",
    async profile => {
      const base = createHqImplementedSampleReader("initial");
      const status = vi.fn(async () => {
        throw new HqLiveError("RATE_LIMITED");
      });
      const s = setup({ ...base, status });
      const native = createHqLiveService({
        config: s.config,
        createStore: () => s.store,
        createReader: s.createReader,
        now: s.fixture.now,
      });
      const invoke = () =>
        profile === "native"
          ? native.invoke()
          : profile === "manual"
            ? s.manual()
            : s.finish();
      expect(await invoke()).toMatchObject({
        status: "progress",
        errorCode: "RATE_LIMITED",
      });
      const saved = copy(Array.from(s.fixture.rows));
      const control = (await s.store.readSnapshot()).control!;
      expect(control.nextDueAtMs - s.fixture.now()).toBe(60000);
      expect(control).toMatchObject({
        stageStatus: "backoff",
        consecutiveFailures: 1,
        lastErrorCode: "RATE_LIMITED",
        leaseToken: null,
      });
      expect((await invoke()).status).toBe("notdue");
      expect(Array.from(s.fixture.rows)).toEqual(saved);
      expect(status).toHaveBeenCalledOnce();
      s.fixture.advance(60000);
      expect(await invoke()).toMatchObject({
        status: "progress",
        errorCode: "RATE_LIMITED",
      });
      expect(
        (await s.store.readSnapshot()).control!.nextDueAtMs - s.fixture.now()
      ).toBe(120000);
      expect(status).toHaveBeenCalledTimes(2);
    }
  );

  it.each([120, 3600])(
    "preserves a %s-second safe Retry-After instead of applying zero yield delay to errors",
    async delay => {
      const base = createHqImplementedSampleReader("initial");
      const s = setup({
        ...base,
        status: async () => {
          throw Object.assign(new HqLiveError("RATE_LIMITED"), {
            safeRetryAfter: delay,
          });
        },
      });
      expect(await s.finish()).toMatchObject({
        status: "progress",
        errorCode: "RATE_LIMITED",
      });
      expect(
        (await s.store.readSnapshot()).control!.nextDueAtMs - s.fixture.now()
      ).toBe(delay * 1000);
      expect((await s.finish()).status).toBe("notdue");
      expect(s.createReader).toHaveBeenCalledOnce();
    }
  );

  it("preserves terminal-error delay and history instead of applying the zero-delay yield profile", async () => {
    const base = createHqImplementedSampleReader("initial");
    const status = vi.fn(async () => {
      throw new HqLiveError("INVALID_PAYLOAD");
    });
    const s = setup({ ...base, status });
    expect(await s.finish()).toMatchObject({
      status: "needs_attention",
      errorCode: "INVALID_PAYLOAD",
    });
    const saved = copy(Array.from(s.fixture.rows));
    expect(
      (await s.store.readSnapshot()).control!.nextDueAtMs - s.fixture.now()
    ).toBe(3600000);
    s.fixture.advance(4000000);
    expect((await s.finish()).status).toBe("needs_attention");
    expect(status).toHaveBeenCalledOnce();
    expect(Array.from(s.fixture.rows)).toEqual(saved);
  });
});

describe("accelerated profile validation and fresh security fences", () => {
  it.each([
    { acceleratedInitialImport: true },
    {
      acceleratedInitialImport: true,
      onlyInitialPublication: false,
      initialImportGuard: async () => {},
      initialImportCpuBindingGuard: () => {},
    },
    { acceleratedInitialImport: true, onlyInitialPublication: true },
    {
      acceleratedInitialImport: true,
      onlyInitialPublication: true,
      initialImportGuard: async () => {},
    },
    {
      acceleratedInitialImport: true,
      onlyInitialPublication: true,
      initialImportCpuBindingGuard: () => {},
    },
    {
      acceleratedInitialImport: true,
      onlyInitialPublication: true,
      initialImportGuard: async () => {},
      initialImportCpuBindingGuard: null,
    },
    {
      acceleratedInitialImport: true,
      onlyInitialPublication: true,
      initialImportGuard: "not-a-guard",
      initialImportCpuBindingGuard: () => {},
    },
  ])(
    "rejects malformed accelerated profile before store/source construction: %j",
    malformed => {
      const createStore = vi.fn();
      const createReader = vi.fn();
      expect(() =>
        createHqLiveService({
          config: createHqLiveConfig(settings()),
          createStore,
          createReader,
          ...malformed,
        } as any)
      ).toThrow("CONFIG_INVALID");
      expect(createStore).not.toHaveBeenCalled();
      expect(createReader).not.toHaveBeenCalled();
    }
  );

  it.each([
    { maxSourceMethods: 26 },
    { maxSourceMethods: 2 },
    { maxSourceMethods: NaN },
    { methodStartDeadlineMs: 75001 },
    { methodStartDeadlineMs: 0 },
  ])(
    "cannot use acceleration to enlarge or invalidate existing cap %j",
    invalid => {
      const createStore = vi.fn();
      const createReader = vi.fn();
      expect(() =>
        createHqLiveService({
          config: createHqLiveConfig(settings()),
          onlyInitialPublication: true,
          acceleratedInitialImport: true,
          initialImportGuard: async () => {},
          initialImportCpuBindingGuard: () => {},
          createStore,
          createReader,
          ...invalid,
        })
      ).toThrow("CONFIG_INVALID");
      expect(createStore).not.toHaveBeenCalled();
      expect(createReader).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["HQ_PORTAL_SYNC_TOKEN", "rotated-offline-token-" + "x".repeat(40)],
    ["HQ_ORBIT_REPORTING_API_KEY", "rotated-offline-key-" + "x".repeat(40)],
    ["HQ_ORBIT_REPORTING_BASE_URL", "https://changed-offline.test/api"],
    ["HQ_LIVE_SYNC_ENABLED", "false"],
    ["HQ_LIVE_READ_ENABLED", "true"],
    ["HQ_LIVE_INTERVAL_SECONDS", "600"],
    ["HQ_LIVE_FRESHNESS_SECONDS", "60"],
  ])(
    "raw %s drift after a source await denies follow-up methods and completion",
    async (key, value) => {
      const base = createHqImplementedSampleReader("initial");
      const s = setup();
      const complete = vi.spyOn(s.store, "complete");
      let saved: any[] = [],
        traceFrom = 0;
      const source = instrument({
        ...base,
        status: async () => {
          saved = copy(Array.from(s.fixture.rows));
          traceFrom = s.fixture.trace.length;
          s.env[key] = value;
          return base.status();
        },
      });
      s.createReader.mockReturnValue(source.reader);
      await expect(s.finish()).rejects.toMatchObject({
        code: "CONFIG_INVALID",
      });
      expect(source.calls).toEqual(["status"]);
      expect(complete).not.toHaveBeenCalled();
      expect(writes(s.fixture, traceFrom)).toHaveLength(0);
      expect(Array.from(s.fixture.rows)).toEqual(saved);
    }
  );

  it.each([false, true])(
    "authority denial after successful/failed source await (%s) stays latched despite later recovery",
    async fails => {
      const base = createHqImplementedSampleReader("initial");
      const s = setup();
      const complete = vi.spyOn(s.store, "complete");
      let revoke = false,
        denied = 0,
        saved: any[] = [],
        traceFrom = 0;
      s.guard.mockImplementation(async () => {
        if (revoke) {
          revoke = false;
          denied++;
          throw new HqLiveError("AUTH_DENIED");
        }
      });
      const source = instrument({
        ...base,
        status: async () => {
          saved = copy(Array.from(s.fixture.rows));
          traceFrom = s.fixture.trace.length;
          revoke = true;
          if (fails) throw new Error("private source failure");
          return base.status();
        },
      });
      s.createReader.mockReturnValue(source.reader);
      await expect(s.finish()).rejects.toMatchObject({ code: "AUTH_DENIED" });
      expect(denied).toBe(1);
      expect(source.calls).toEqual(["status"]);
      expect(complete).not.toHaveBeenCalled();
      expect(writes(s.fixture, traceFrom)).toHaveLength(0);
      expect(Array.from(s.fixture.rows)).toEqual(saved);
    }
  );

  it("checks the actual helper-service raw binding seam across a real CPU handoff and stops token rotation without completion", async () => {
    const source = instrument(
      createHqLargeSyntheticReader({ bookingCount: 100, paddingBytes: 256 })
    );
    const s = setup(source.reader);
    const complete = vi.spyOn(s.store, "complete");
    let armed = false,
      rotated = false,
      cpuCalls = 0,
      saved: any[] = [],
      callsAtRotation: string[] = [],
      traceFrom = 0,
      commitsFrom = 0;
    s.configure.override = options => {
      const binding = options.initialImportCpuBindingGuard!;
      return {
        ...options,
        initialImportCpuBindingGuard: () => {
          cpuCalls++;
          binding();
          if (!armed) {
            armed = true;
            setImmediate(() => {
              rotated = true;
              saved = copy(Array.from(s.fixture.rows));
              callsAtRotation = [...source.calls];
              traceFrom = s.fixture.trace.length;
              commitsFrom = s.fixture.commits.mock.calls.length;
              s.env.HQ_PORTAL_SYNC_TOKEN =
                "rotated-during-cpu-" + "x".repeat(40);
            });
          }
        },
      };
    };
    await expect(s.finish()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(rotated).toBe(true);
    expect(cpuCalls).toBeGreaterThan(2);
    expect(source.calls).toEqual(callsAtRotation);
    expect(complete).not.toHaveBeenCalled();
    expect(s.fixture.commits.mock.calls).toHaveLength(commitsFrom);
    expect(writes(s.fixture, traceFrom)).toHaveLength(0);
    expect(Array.from(s.fixture.rows)).toEqual(saved);
  });

  it("checks raw binding on every CPU-only checkpoint with fresh authority at one-second intervals", async () => {
    const base = createHqImplementedSampleReader("initial");
    const s = setup();
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const callbacks: (() => Promise<void>)[] = [];
    // Expose only the checkpoint callbacks. The separate token-rotation test
    // exercises real asynchronous handoffs through the real service/engine.
    vi.spyOn(cooperation, "createHqCpuCheckpoint").mockImplementation(guard => {
      if (guard) callbacks.push(guard);
      return async () => {};
    });
    const raw = vi.fn();
    s.configure.override = options => {
      const binding = options.initialImportCpuBindingGuard!;
      return {
        ...options,
        initialImportCpuBindingGuard: () => {
          raw();
          binding();
        },
      };
    };
    const authorityDeltas: number[] = [];
    const bindingDeltas: number[] = [];
    s.createReader.mockReturnValue({
      ...base,
      status: async () => {
        const checkpoint = callbacks[0];
        expect(checkpoint).toBeTypeOf("function");
        for (const time of [0, 0, 999, 1000, 1999, 2000]) {
          elapsed = time;
          const beforeAuthority = s.guard.mock.calls.length;
          const beforeBinding = raw.mock.calls.length;
          await checkpoint();
          authorityDeltas.push(s.guard.mock.calls.length - beforeAuthority);
          bindingDeltas.push(raw.mock.calls.length - beforeBinding);
        }
        return base.status();
      },
    });
    expect((await s.finish()).status).toBe("applied");
    expect(authorityDeltas).toEqual([1, 0, 0, 1, 0, 1]);
    expect(bindingDeltas).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it("does not throttle the immediate fresh guard preceding a fenced CAS", async () => {
    const s = setup();
    const fencedFactory = s.store.fencedSyncStore.bind(s.store);
    const cas = vi.fn();
    let armed = false,
      denied = false,
      saved: any[] = [],
      traceFrom = 0;
    vi.spyOn(s.store, "fencedSyncStore").mockImplementation(lease => {
      const fenced = fencedFactory(lease);
      return {
        ...fenced,
        compareAndSwapSync: async (expected, next) => {
          cas();
          return fenced.compareAndSwapSync(expected, next);
        },
      };
    });
    const base = createHqImplementedSampleReader("initial");
    s.createReader.mockReturnValue({
      ...base,
      bookings: async query => {
        const page = await base.bookings(query);
        saved = copy(Array.from(s.fixture.rows));
        traceFrom = s.fixture.trace.length;
        armed = true;
        return page;
      },
    });
    // Permit post-source authority; deny only the subsequent immediate CAS
    // guard. A source-only or throttled side-effect guard would miss this.
    let freshAfterPage = 0;
    s.guard.mockImplementation(async () => {
      if (armed && ++freshAfterPage === 2) {
        denied = true;
        throw new HqLiveError("AUTH_DENIED");
      }
    });
    const complete = vi.spyOn(s.store, "complete");
    await expect(s.finish()).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(denied).toBe(true);
    expect(cas).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(writes(s.fixture, traceFrom)).toHaveLength(0);
    expect(Array.from(s.fixture.rows)).toEqual(saved);
  });

  it("retains the store's fresh post-UPDATE/pre-commit authority fence in the accelerated profile", async () => {
    const s = setup();
    let freshStore: ReturnType<typeof createHqLiveStore> | undefined;
    let revoked = false,
      denied = false,
      saved: any[] = [],
      commitsFrom = 0;
    s.configure.override = options => {
      freshStore = createHqLiveStore(s.fixture.pool, s.config, {
        cooperativeGuard: options.initialImportGuard,
      });
      return { ...options, createStore: () => freshStore! };
    };
    s.guard.mockImplementation(async () => {
      if (revoked) {
        denied = true;
        throw new HqLiveError("AUTH_DENIED");
      }
    });
    s.fixture.setAfterHook((sql, args) => {
      if (
        !revoked &&
        sql.startsWith("UPDATE") &&
        args[2] === HQ_LIVE_SYNC_DATASET_ID
      ) {
        saved = copy(Array.from(s.fixture.rows));
        commitsFrom = s.fixture.commits.mock.calls.length;
        revoked = true;
      }
    });
    await expect(s.finish()).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(revoked).toBe(true);
    expect(denied).toBe(true);
    expect(s.fixture.rollbacks.mock.calls.length).toBeGreaterThan(0);
    expect(s.fixture.commits.mock.calls).toHaveLength(commitsFrom);
    expect(Array.from(s.fixture.rows)).toEqual(saved);
    expect(
      JSON.parse(s.fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state)
        .leaseToken
    ).not.toBeNull();
  });

  it("retains a fresh authority check before every source method despite CPU authority throttling", async () => {
    const s = setup();
    const observed: number[] = [];
    let last = 0;
    const base = createHqImplementedSampleReader("initial");
    const record = <T>(work: () => Promise<T>) => {
      observed.push(s.guard.mock.calls.length - last);
      last = s.guard.mock.calls.length;
      return work();
    };
    s.createReader.mockReturnValue({
      status: () => record(() => base.status()),
      capabilities: () => record(() => base.capabilities()),
      bookings: query => record(() => base.bookings(query)),
      businessMappings: query => record(() => base.businessMappings(query)),
      catalogue: (type, query) => record(() => base.catalogue(type, query)),
      changes: (cursor, limit) => record(() => base.changes(cursor, limit)),
    });
    expect((await s.finish()).status).toBe("applied");
    expect(observed).toHaveLength(6);
    expect(observed.every(count => count >= 2)).toBe(true);
  });

  it("preserves the 75-second source-start deadline and 30/95-second lease caps", async () => {
    expect(HQ_LIVE_METHOD_START_DEADLINE_MS).toBe(75000);
    expect(HQ_LIVE_LEASE_SECONDS).toBe(30);
    expect(HQ_LIVE_MAX_LEASE_SECONDS).toBe(95);
    const base = createHqImplementedSampleReader("initial");
    const s = setup();
    // Share one deterministic elapsed budget with the frozen offline DB clock.
    // Real performance time is not permitted to consume simulated SQL time.
    vi.spyOn(performance, "now").mockReturnValue(0);
    const initialTime = s.fixture.now();
    const starts: number[] = [];
    const sourceWork = async <T>(work: () => Promise<T>) => {
      starts.push(s.fixture.now() - initialTime);
      s.fixture.advance(15000);
      return work();
    };
    const source = instrument({
      ...base,
      status: () => sourceWork(() => base.status()),
      capabilities: () => sourceWork(() => base.capabilities()),
      bookings: query => sourceWork(() => base.bookings(query)),
      businessMappings: query => sourceWork(() => base.businessMappings(query)),
      catalogue: (type, query) => sourceWork(() => base.catalogue(type, query)),
    });
    s.createReader.mockReturnValue(source.reader);
    expect((await s.finish()).status).toBe("progress");
    expect(source.calls.length).toBeGreaterThanOrEqual(4);
    expect(source.calls.length).toBeLessThanOrEqual(5);
    expect(source.calls).toEqual(
      [
        "status",
        "capabilities",
        "bookings",
        "businessMappings",
        "catalogue:booking",
      ].slice(0, source.calls.length)
    );
    expect(starts.every(time => time < HQ_LIVE_METHOD_START_DEADLINE_MS)).toBe(
      true
    );
    expect((await s.store.readSnapshot()).control).toMatchObject({
      leaseToken: null,
      stageStatus: "progress",
    });
    expect((await s.store.readSnapshot()).sync!.published).toBeNull();
  });

  it("cannot extend the hard 95-second fence by repeated renewals", async () => {
    const s = setup();
    const acquired = await s.store.acquire();
    if (acquired.status !== "acquired")
      throw new Error("offline lease required");
    const hard = acquired.lease.hardExpiresAtMs;
    for (const delta of [20000, 20000, 20000, 20000, 14999]) {
      s.fixture.advance(delta);
      await s.store.renew(acquired.lease);
      expect((await s.store.readSnapshot()).control!.leaseHardExpiresAtMs).toBe(
        hard
      );
    }
    s.fixture.advance(1);
    const before = copy(Array.from(s.fixture.rows));
    await expect(s.store.renew(acquired.lease)).rejects.toMatchObject({
      code: "LEASE_LOST",
    });
    expect(Array.from(s.fixture.rows)).toEqual(before);
  });
});

function pendingReader(registered: boolean): HqWireReader {
  const base = createHqImplementedSampleReader("initial");
  return {
    ...base,
    bookings: async query => {
      const page = copy(await base.bookings(query));
      const payload = page.items[0].payload as any;
      payload.status = "pending";
      payload.eligibility.pending = true;
      payload.eligibility.activeSalesHeadline = false;
      payload.financials.bookingStatus = "pending";
      payload.financials.headlineEligible = true;
      if (registered) {
        payload.dates.portalRegisteredAt = "2026-01-10T12:00:00Z";
        payload.dates.dateSource = "portal_registered_at";
      }
      return page;
    },
  };
}

describe("pinned financial/cancellation/pending equality with the old fixture engine", () => {
  it.each(["initial", "amended", "cancelled", "registered"] as const)(
    "preserves exact %s source payload, canonical state and old financial report",
    async stage => {
      const reader = createHqImplementedSampleReader(stage);
      const memory = createHqImplementedMemoryStore();
      const old = await createHqImplementedEngine(reader, memory).backfill();
      expect(old.status).toBe("applied");
      const s = setup(createHqImplementedSampleReader(stage));
      expect((await s.finish()).status).toBe("applied");
      const actual = (await s.store.readSnapshot()).sync!;
      expect(actual).toEqual(await memory.readSync());
      const key = {
        initial: "beforeAmendment",
        amended: "afterAmendment",
        cancelled: "afterCancellation",
        registered: "afterLaterRegistration",
      } as const;
      const expected = supplied[key[stage]].body.items[0];
      expect(actual.published!.entities["booking:1"].entity.payload).toEqual(
        expected.payload
      );
      const report = await getHqReport(
        actual.published!,
        createHqImplementedSampleDirectory(),
        { year: 2026 }
      );
      expect(report).toEqual(
        await getHqReport(
          (await memory.readSync())!.published!,
          createHqImplementedSampleDirectory(),
          { year: 2026 }
        )
      );
      expect(report.totals.grossSales.knownSum).toBe(
        stage === "initial"
          ? "10000.00"
          : stage === "amended"
            ? "11000.00"
            : null
      );
      expect(report.totals.grossProfit.knownSum).toBe(
        stage === "initial" ? "1500.00" : stage === "amended" ? "2500.00" : null
      );
      expect(report.cohorts.cancelledCount).toBe(
        stage === "cancelled" || stage === "registered" ? 1 : 0
      );
      expect(report.totals.settledJltIncome.knownSum).toBeNull();
    }
  );

  it.each([false, true])(
    "preserves exact pending source-financial state and existing registration semantics (registered=%s)",
    async registered => {
      const memory = createHqImplementedMemoryStore();
      expect(
        (
          await createHqImplementedEngine(
            pendingReader(registered),
            memory
          ).backfill()
        ).status
      ).toBe("applied");
      const s = setup(pendingReader(registered));
      expect((await s.finish()).status).toBe("applied");
      const actual = (await s.store.readSnapshot()).sync!;
      expect(actual).toEqual(await memory.readSync());
      const report = await getHqReport(
        actual.published!,
        createHqImplementedSampleDirectory(),
        { year: 2026 }
      );
      expect(report).toEqual(
        await getHqReport(
          (await memory.readSync())!.published!,
          createHqImplementedSampleDirectory(),
          { year: 2026 }
        )
      );
      expect(report.cohorts.pendingCount).toBe(1);
      expect(report.totals.bookingCount).toBe(registered ? 1 : 0);
      expect(report.totals.grossSales.knownSum).toBe(
        registered ? "10000.00" : null
      );
      expect(report.totals.grossProfit.knownSum).toBeNull();
      expect(report.totals.settledJltIncome.knownSum).toBeNull();
      expect(
        actual.published!.entities["booking:1"].entity.payload
      ).toMatchObject({
        status: "pending",
        eligibility: { activeSalesHeadline: false },
        financials: { headlineEligible: true },
      });
    }
  );

  it("keeps the supplied immutable fixture checksum pinned", () => {
    const bytes = readFileSync(
      new URL(
        "./fixtures/management-hq-implemented-http-examples.json",
        import.meta.url
      )
    );
    expect(HQ_IMPLEMENTED_SAMPLE_PROVENANCE.sourceSha256).toBe(
      "eafa38df7c549497146a4893c0b543bd9ae68f962a4859aab6d1268f26c0b235"
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      HQ_IMPLEMENTED_SAMPLE_PROVENANCE.sourceSha256
    );
  });
});
