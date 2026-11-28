import type { Pool } from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHqBackgroundCoordinator,
  hqBackgroundBinding,
  hqBackgroundEnabled,
  HQ_BACKGROUND_BATCH_LIMIT,
  HQ_BACKGROUND_RUN_BUDGET_MS,
} from "./management-hq-background";
import {
  HQ_BACKGROUND_LEASE_MS,
  HQ_BACKGROUND_MAX_ATTEMPTS,
  HQ_BACKGROUND_MAX_ERRORS,
  HQ_BACKGROUND_RUN_MS,
  type HqBackgroundClaimResult,
  type HqBackgroundJob,
  type HqBackgroundOutcome,
  type HqBackgroundStore,
} from "./management-hq-background-store";
import { createHqLiveConfig } from "./management-hq-live-config";
import {
  buildHqLiveStatus,
  HQ_LIVE_MAX_SOURCE_METHODS,
  HQ_LIVE_METHOD_START_DEADLINE_MS,
  type HqLiveInvocationResult,
  type HqLiveService,
  type HqLiveServiceOptions,
  type HqLiveStatusDto,
} from "./management-hq-live-service";
import * as liveStoreModule from "./management-hq-live-store";
import {
  HqLiveError,
  HQ_LIVE_MAX_LEASE_SECONDS,
  type HqLiveErrorCode,
} from "./management-hq-live-store";

// All credentials are deliberately synthetic; this file never inherits process.env.
const settings = (): NodeJS.ProcessEnv => ({
  DATABASE_URL:
    "mysql://offline-user:offline-password@127.0.0.1:1/offline_hq_background",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://orbit.thejltgroup.co.uk/api/reporting/v1",
  HQ_ORBIT_REPORTING_API_KEY: "offline-background-key-" + "a".repeat(40),
  HQ_PORTAL_SYNC_TOKEN: "offline-background-token-" + "b".repeat(40),
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_LIVE_INTERVAL_SECONDS: "300",
  HQ_LIVE_FRESHNESS_SECONDS: "900",
  HQ_INITIAL_BACKGROUND_ENABLED: "true",
});
const clone = <T>(value: T): T => structuredClone(value);
const ACTOR = 71;
const OTHER_ACTOR = 89;
const DB_NOW = Date.parse("2026-11-28T10:00:00.000Z");
const TRANSIENT_CODES = [
  "TIMEOUT",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "TRANSPORT_FAILURE",
  "SOURCE_NOT_READY",
  "SOURCE_OR_STORE_UNAVAILABLE",
] as const satisfies readonly HqLiveErrorCode[];

/** Contract fixture only, NOT a substitute for the store agent's SQL/locking tests.
 * Reads are immutable observations. Guarded mutations serialize, preserve the DB
 * clock/run window, and atomically compare the current claim token on settlement.
 * No reporting root/control, source reader, pool, or operational data is involved.
 */
function memoryJobs(env: NodeJS.ProcessEnv) {
  const state = {
    databaseNowMs: DB_NOW,
    job: null as HqBackgroundJob | null,
    beforeRead: null as null | (() => void | Promise<void>),
    beforeSettle: null as null | (() => void | Promise<void>),
    settleError: null as Error | null,
  };
  const writes: HqBackgroundJob[] = [];
  let sequence = 0;
  let tail = Promise.resolve();
  const snapshot = () => clone(state.job);
  const freshJob = (patch: Partial<HqBackgroundJob> = {}): HqBackgroundJob => ({
    format: "hq-initial-background-v1",
    version: 1,
    sourceBinding: hqBackgroundBinding(env),
    actorId: ACTOR,
    status: "queued",
    startedAtMs: DB_NOW,
    updatedAtMs: DB_NOW,
    expiresAtMs: DB_NOW + HQ_BACKGROUND_RUN_MS,
    attempts: 0,
    consecutiveErrors: 0,
    nextDueAtMs: DB_NOW,
    token: null,
    leaseUntilMs: null,
    lastErrorCode: null,
    ...patch,
  });
  const bump = (job: HqBackgroundJob, patch: Partial<HqBackgroundJob>) => ({
    ...job,
    ...patch,
    version: job.version + 1,
    updatedAtMs: state.databaseNowMs,
  });
  const failed = (job: HqBackgroundJob, code: HqLiveErrorCode) =>
    bump(job, {
      status: "failed",
      token: null,
      leaseUntilMs: null,
      lastErrorCode: code,
    });
  type Decision<T> = { value: T; write?: HqBackgroundJob };
  async function atomic<T>(
    guard: () => Promise<void>,
    decide: () => Decision<T>
  ): Promise<T> {
    let denial: unknown;
    const check = async () => {
      try {
        await guard();
      } catch (error) {
        denial ??= error;
      }
      if (denial) throw denial;
    };
    await check();
    const preceding = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => {
      release = resolve;
    });
    await preceding;
    try {
      await check();
      const decision = decide();
      await check();
      await check();
      if (decision.write) {
        state.job = clone(decision.write);
        writes.push(clone(decision.write));
      }
      return clone(decision.value);
    } finally {
      release();
    }
  }
  const store = {
    read: vi.fn(async () => {
      await state.beforeRead?.();
      return { job: snapshot(), databaseNowMs: state.databaseNowMs };
    }),
    start: vi.fn(
      async (
        actorId: number,
        sourceBinding: string,
        guard: () => Promise<void>
      ) =>
        atomic(guard, (): Decision<HqBackgroundJob> => {
          const job = state.job;
          if (job && (job.status === "queued" || job.status === "running")) {
            if (job.sourceBinding !== sourceBinding)
              throw new HqLiveError("CONFIG_INVALID");
            if (state.databaseNowMs >= job.expiresAtMs) {
              const stopped = failed(job, "SOURCE_EXPIRED");
              return { value: stopped, write: stopped };
            }
            return { value: job };
          }
          if (job?.status === "completed")
            throw new HqLiveError("CONFIG_INVALID");
          const started = freshJob({
            actorId,
            sourceBinding,
            version: (job?.version ?? 0) + 1,
            startedAtMs: state.databaseNowMs,
            updatedAtMs: state.databaseNowMs,
            expiresAtMs: state.databaseNowMs + HQ_BACKGROUND_RUN_MS,
            nextDueAtMs: state.databaseNowMs,
          });
          return { value: started, write: started };
        })
    ),
    pause: vi.fn(async (guard: () => Promise<void>) =>
      atomic(guard, (): Decision<HqBackgroundJob | null> => {
        const job = state.job;
        if (!job || !["queued", "running"].includes(job.status))
          return { value: job };
        const paused = bump(job, {
          status: "paused",
          token: null,
          leaseUntilMs: null,
        });
        return { value: paused, write: paused };
      })
    ),
    claim: vi.fn(async (binding: string, guard: () => Promise<void>) =>
      atomic(guard, (): Decision<HqBackgroundClaimResult> => {
        const job = state.job;
        if (!job || !["queued", "running"].includes(job.status))
          return { value: { kind: "idle", job } };
        if (job.sourceBinding !== binding)
          throw new HqLiveError("CONFIG_INVALID");
        if (
          state.databaseNowMs >= job.expiresAtMs ||
          job.attempts >= HQ_BACKGROUND_MAX_ATTEMPTS ||
          job.consecutiveErrors >= HQ_BACKGROUND_MAX_ERRORS
        ) {
          const stopped = failed(
            job,
            state.databaseNowMs >= job.expiresAtMs
              ? "SOURCE_EXPIRED"
              : (job.lastErrorCode ?? "STORE_UNAVAILABLE")
          );
          return { value: { kind: "idle", job: stopped }, write: stopped };
        }
        if (
          job.nextDueAtMs > state.databaseNowMs ||
          (job.status === "running" && job.leaseUntilMs! > state.databaseNowMs)
        ) {
          return { value: { kind: "idle", job } };
        }
        const claimed = bump(job, {
          status: "running",
          attempts: job.attempts + 1,
          token: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
          leaseUntilMs: Math.min(
            state.databaseNowMs + HQ_BACKGROUND_LEASE_MS,
            job.expiresAtMs
          ),
        });
        return { value: { kind: "claimed", job: claimed }, write: claimed };
      })
    ),
    settle: vi.fn(
      async (
        token: string,
        outcome: HqBackgroundOutcome,
        guard: () => Promise<void>
      ) => {
        await state.beforeSettle?.();
        if (state.settleError) throw state.settleError;
        const input = clone(outcome);
        return atomic(guard, (): Decision<HqBackgroundJob | null> => {
          const job = state.job;
          if (
            !job ||
            job.status !== "running" ||
            job.token !== token ||
            state.databaseNowMs >= job.expiresAtMs ||
            state.databaseNowMs >= job.leaseUntilMs!
          )
            return { value: job };
          const code = input.errorCode ?? null;
          const errors =
            input.status === "queued"
              ? code === null
                ? 0
                : job.consecutiveErrors + 1
              : job.consecutiveErrors;
          const status =
            input.status === "queued" &&
            (errors >= HQ_BACKGROUND_MAX_ERRORS ||
              job.attempts >= HQ_BACKGROUND_MAX_ATTEMPTS)
              ? "failed"
              : input.status;
          const settled = bump(job, {
            status,
            token: null,
            leaseUntilMs: null,
            consecutiveErrors: errors,
            nextDueAtMs: input.nextDueAtMs ?? job.nextDueAtMs,
            lastErrorCode:
              input.status === "failed" && input.errorCode === undefined
                ? job.lastErrorCode
                : code,
          });
          return { value: settled, write: settled };
        });
      }
    ),
  } satisfies HqBackgroundStore;
  return {
    state,
    writes,
    store,
    freshJob,
    seed: (patch: Partial<HqBackgroundJob> = {}) => {
      state.job = freshJob(patch);
    },
  };
}

function fixture(env = settings()) {
  const jobs = memoryJobs(env);
  const authority = { allowed: true };
  const authorize = vi.fn(async (_actorId: number) => {
    if (!authority.allowed) throw new HqLiveError("AUTH_DENIED");
  });
  const forbidden = vi.fn(async () => {
    throw new Error("OFFLINE: forbidden pool/network operation");
  });
  const pool = {
    getConnection: forbidden,
    execute: forbidden,
    query: forbidden,
    end: forbidden,
  } as unknown as Pool;
  const control = Object.freeze({
    nextDueAtMs: DB_NOW + 60_000,
    stage: "saved-initial-backfill",
    root: "untouched-import-root",
  });
  const state = {
    monotonicMs: 0,
    status: {
      ...buildHqLiveStatus(createHqLiveConfig(env).status()),
      health: "progress",
      stageStatus: "progress",
      hasPublished: false,
      stateVersion: 12,
      progress: {
        kind: "backfill",
        phase: "bookings",
        pages: 1,
        recordsRead: 1,
      },
      nextDueAt: new Date(DB_NOW).toISOString(),
      payloadIntegrity: "unchecked",
    } as HqLiveStatusDto,
    invoke: null as
      | null
      | ((options: HqLiveServiceOptions) => Promise<HqLiveInvocationResult>),
  };
  const services: HqLiveService[] = [];
  const serviceOptions: HqLiveServiceOptions[] = [];
  const source = vi.fn(async () => {});
  const invoke = vi.fn(
    async (options: HqLiveServiceOptions): Promise<HqLiveInvocationResult> => {
      if (state.invoke) return state.invoke(options);
      return { status: "progress" };
    }
  );
  const getStatus = vi.fn(async () => clone(state.status));
  const readPublished = vi.fn(async () => {
    throw new Error("OFFLINE: normal reporting is forbidden");
  });
  const readValidationSnapshot = vi.fn(async () => {
    throw new Error("OFFLINE: reporting snapshot is forbidden");
  });
  const recovery = vi.fn(async () => {
    throw new Error("OFFLINE: import control reset is forbidden");
  });
  const createService = vi.fn(
    (options: HqLiveServiceOptions): HqLiveService => {
      serviceOptions.push(options);
      const service: HqLiveService = {
        configurationStatus: () => options.config!.status(),
        authorizeTrigger: () => false,
        invoke: () => invoke(options),
        getStatus,
        readPublished,
        readValidationSnapshot,
        recoverEmptyInitialImport: recovery,
        resumeStagedInitialImport: recovery,
        repairInitialCapacity: recovery,
      };
      services.push(service);
      return service;
    }
  );
  const createStore = vi.fn(() => jobs.store);
  const coordinator = createHqBackgroundCoordinator({
    env,
    pool,
    authorize,
    createStore,
    createService,
    monotonicNow: () => state.monotonicMs,
  });
  const noReporting = () => {
    expect(readPublished).not.toHaveBeenCalled();
    expect(readValidationSnapshot).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
    expect(source).not.toHaveBeenCalled();
    expect(control).toEqual({
      nextDueAtMs: DB_NOW + 60_000,
      stage: "saved-initial-backfill",
      root: "untouched-import-root",
    });
  };
  return {
    ...jobs,
    env,
    pool,
    authority,
    authorize,
    forbidden,
    control,
    stateService: state,
    invoke,
    getStatus,
    createService,
    createStore,
    services,
    serviceOptions,
    coordinator,
    noReporting,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("OFFLINE: fetch is forbidden");
    })
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function safeDto(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /actorId|sourceBinding|token|leaseUntil|updatedAtMs|format|version|offline-background|mysql:|https:|raw|bookingRef|SELECT/
  );
}

describe("background opt-in, protected metadata and explicit admission (offline)", () => {
  it.each([undefined, "false"])(
    "defaults off for flag %s: worker/manual do no IO; status still freshly authorizes",
    async flag => {
      const env = settings();
      if (flag === undefined) delete env.HQ_INITIAL_BACKGROUND_ENABLED;
      else env.HQ_INITIAL_BACKGROUND_ENABLED = flag;
      const f = fixture(env);
      expect(hqBackgroundEnabled(env)).toBe(false);
      expect(await f.coordinator.run()).toEqual({ status: "idle", batches: 0 });
      await f.coordinator.assertManualAllowed(ACTOR);
      expect(f.authorize).not.toHaveBeenCalled();
      expect(await f.coordinator.status(ACTOR)).toEqual({
        enabled: false,
        job: null,
      });
      f.authority.allowed = false;
      await expect(f.coordinator.status(ACTOR)).rejects.toMatchObject({
        code: "AUTH_DENIED",
      });
      expect(f.authorize).toHaveBeenCalledTimes(2);
      expect(f.store.read).not.toHaveBeenCalled();
      expect(f.createService).not.toHaveBeenCalled();
      expect(f.writes).toEqual([]);
      f.noReporting();
    }
  );

  it.each(["TRUE", "1", "yes", "", " true", "false "])(
    "rejects malformed flag %j before worker IO",
    async flag => {
      const f = fixture({ ...settings(), HQ_INITIAL_BACKGROUND_ENABLED: flag });
      expect(() => hqBackgroundEnabled(f.env)).toThrow("CONFIG_INVALID");
      await expect(f.coordinator.run()).rejects.toMatchObject({
        code: "CONFIG_INVALID",
      });
      await expect(f.coordinator.status(ACTOR)).rejects.toMatchObject({
        code: "CONFIG_INVALID",
      });
      expect(f.store.read).not.toHaveBeenCalled();
      expect(f.createService).not.toHaveBeenCalled();
      expect(f.authorize).toHaveBeenCalledWith(ACTOR);
      f.noReporting();
    }
  );

  it("off start/pause cannot persist a job or invoke a source", async () => {
    const f = fixture({
      ...settings(),
      HQ_INITIAL_BACKGROUND_ENABLED: "false",
    });
    await expect(f.coordinator.start(ACTOR)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    await expect(f.coordinator.pause(ACTOR)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    expect(f.getStatus).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
    f.noReporting();
  });

  it("status freshly authorizes and reads on every call, returning only an allowlisted DTO", async () => {
    const f = fixture();
    f.seed({
      status: "running",
      attempts: 1,
      token: "00000000-0000-4000-8000-000000000001",
      leaseUntilMs: DB_NOW + HQ_BACKGROUND_LEASE_MS,
    });
    const before = clone(f.state.job);
    const first = await f.coordinator.status(ACTOR);
    expect(Object.keys(first.job!).sort()).toEqual(
      [
        "attempts",
        "consecutiveErrors",
        "expiresAt",
        "lastErrorCode",
        "nextDueAt",
        "startedAt",
        "status",
      ].sort()
    );
    safeDto(first);
    f.state.job!.status = "paused";
    f.state.job!.token = null;
    f.state.job!.leaseUntilMs = null;
    expect((await f.coordinator.status(ACTOR)).job?.status).toBe("paused");
    const reads = f.store.read.mock.calls.length;
    f.authority.allowed = false;
    await expect(f.coordinator.status(ACTOR)).rejects.toMatchObject({
      code: "AUTH_DENIED",
    });
    expect(f.store.read).toHaveBeenCalledTimes(reads);
    expect(f.authorize.mock.calls.every(([id]) => id === ACTOR)).toBe(true);
    expect(before?.status).toBe("running");
    expect(f.writes).toEqual([]);
    expect(f.createService).not.toHaveBeenCalled();
    f.noReporting();
  });

  it("fresh post-read authority denial prevents returning even metadata", async () => {
    const f = fixture();
    f.seed();
    f.state.beforeRead = () => {
      f.authority.allowed = false;
    };
    await expect(f.coordinator.status(ACTOR)).rejects.toMatchObject({
      code: "AUTH_DENIED",
    });
    expect(f.writes).toEqual([]);
  });

  it("explicit start only persists the separate job and never invokes source/report/reset work", async () => {
    const f = fixture();
    expect(f.state.job).toBeNull();
    expect(await f.coordinator.status(ACTOR)).toEqual({
      enabled: true,
      job: null,
    });
    expect(f.writes).toEqual([]);
    const response = await f.coordinator.start(ACTOR);
    expect(response).toMatchObject({
      enabled: true,
      job: { status: "queued", attempts: 0 },
    });
    safeDto(response);
    expect(f.state.job).toMatchObject({
      actorId: ACTOR,
      sourceBinding: hqBackgroundBinding(f.env),
      startedAtMs: DB_NOW,
    });
    expect(f.state.job!.expiresAtMs).toBe(DB_NOW + HQ_BACKGROUND_RUN_MS);
    expect(f.store.start).toHaveBeenCalledWith(
      ACTOR,
      hqBackgroundBinding(f.env),
      expect.any(Function)
    );
    expect(f.getStatus).toHaveBeenCalledTimes(1);
    expect(f.invoke).not.toHaveBeenCalled();
    f.noReporting();
  });

  it.each([
    ["published", { hasPublished: true }],
    ["health attention", { health: "needs_attention" }],
    ["stage attention", { stageStatus: "needs_attention" }],
    ["no saved progress", { progress: null }],
    [
      "catchup",
      {
        progress: {
          kind: "catchup",
          phase: "changes",
          pages: 1,
          recordsRead: 1,
        },
      },
    ],
    [
      "zero pages",
      {
        progress: {
          kind: "backfill",
          phase: "bookings",
          pages: 0,
          recordsRead: 1,
        },
      },
    ],
    [
      "zero records",
      {
        progress: {
          kind: "backfill",
          phase: "bookings",
          pages: 1,
          recordsRead: 0,
        },
      },
    ],
  ] as const)("rejects start with %s", async (_label, patch) => {
    const f = fixture();
    Object.assign(f.stateService.status, clone(patch));
    await expect(f.coordinator.start(ACTOR)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    expect(f.store.start).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
    f.noReporting();
  });

  it.each([
    ["sync off", { HQ_LIVE_SYNC_ENABLED: "false" }],
    ["read on", { HQ_LIVE_READ_ENABLED: "true" }],
    ["missing source key", { HQ_ORBIT_REPORTING_API_KEY: undefined }],
    [
      "invalid source URL",
      {
        HQ_ORBIT_REPORTING_BASE_URL: "https://example.invalid/api/reporting/v1",
      },
    ],
    [
      "matching credentials",
      { HQ_PORTAL_SYNC_TOKEN: settings().HQ_ORBIT_REPORTING_API_KEY },
    ],
  ])(
    "requires configured sync-on/read-off on start: %s",
    async (_label, patch) => {
      const f = fixture({ ...settings(), ...patch });
      await expect(f.coordinator.start(ACTOR)).rejects.toMatchObject({
        code: "CONFIG_INVALID",
      });
      expect(f.getStatus).not.toHaveBeenCalled();
      expect(f.store.start).not.toHaveBeenCalled();
      f.noReporting();
    }
  );

  it("allows a saved TIMEOUT backoff start without resetting original import control or its due time", async () => {
    const f = fixture();
    Object.assign(f.stateService.status, {
      health: "backoff",
      stageStatus: "backoff",
      lastErrorCode: "TIMEOUT",
      nextDueAt: new Date(f.control.nextDueAtMs).toISOString(),
    });
    f.seed({
      nextDueAtMs: f.control.nextDueAtMs,
      consecutiveErrors: 1,
      lastErrorCode: "TIMEOUT",
    });
    const before = clone(f.state.job);
    expect((await f.coordinator.start(ACTOR)).job).toMatchObject({
      status: "queued",
      lastErrorCode: "TIMEOUT",
      consecutiveErrors: 1,
    });
    expect(f.state.job).toEqual(before);
    expect(f.writes).toEqual([]);
    expect(f.invoke).not.toHaveBeenCalled();
    f.noReporting();
  });

  it("pause mutates the job only and clears the current token, never source/import controls", async () => {
    const f = fixture();
    f.seed({
      status: "running",
      attempts: 1,
      token: "00000000-0000-4000-8000-000000000001",
      leaseUntilMs: DB_NOW + HQ_BACKGROUND_LEASE_MS,
    });
    const response = await f.coordinator.pause(ACTOR);
    expect(response.job?.status).toBe("paused");
    expect(f.state.job).toMatchObject({
      status: "paused",
      token: null,
      leaseUntilMs: null,
      attempts: 1,
    });
    safeDto(response);
    expect(f.createService).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
    f.noReporting();
  });

  it.each(["queued", "running"] as const)(
    "denies manual admission while job is %s",
    async status => {
      const f = fixture();
      f.seed({ status });
      await expect(
        f.coordinator.assertManualAllowed(ACTOR)
      ).rejects.toMatchObject({ code: "LEASE_LOST" });
      expect(f.createService).not.toHaveBeenCalled();
      expect(f.writes).toEqual([]);
    }
  );
  it.each(["paused", "completed", "failed", null] as const)(
    "allows manual admission for inactive job %s with fresh authorization",
    async status => {
      const f = fixture();
      if (status) f.seed({ status });
      await f.coordinator.assertManualAllowed(ACTOR);
      expect(f.authorize).toHaveBeenCalledWith(ACTOR);
      f.authority.allowed = false;
      await expect(
        f.coordinator.assertManualAllowed(ACTOR)
      ).rejects.toMatchObject({ code: "AUTH_DENIED" });
      expect(f.writes).toEqual([]);
      f.noReporting();
    }
  );
});

describe("finite background batches and atomic token lifecycle (offline)", () => {
  it("uses at most four original 25-method/75-second/95-second batches with mandatory initial-only accelerated guards", async () => {
    const f = fixture();
    f.seed();
    expect(await f.coordinator.run()).toEqual({ status: "queued", batches: 4 });
    expect(HQ_BACKGROUND_BATCH_LIMIT).toBe(4);
    expect(HQ_LIVE_MAX_SOURCE_METHODS).toBe(25);
    expect(HQ_LIVE_METHOD_START_DEADLINE_MS).toBe(75_000);
    expect(HQ_LIVE_MAX_LEASE_SECONDS).toBe(95);
    expect(f.invoke).toHaveBeenCalledTimes(4);
    expect(f.createService).toHaveBeenCalledTimes(4);
    for (const options of f.serviceOptions) {
      expect(options).toMatchObject({
        onlyInitialPublication: true,
        acceleratedInitialImport: true,
        initialImportGuard: expect.any(Function),
        initialImportCpuBindingGuard: expect.any(Function),
        createStore: expect.any(Function),
      });
      expect(options.maxSourceMethods ?? HQ_LIVE_MAX_SOURCE_METHODS).toBe(25);
      expect(
        options.methodStartDeadlineMs ?? HQ_LIVE_METHOD_START_DEADLINE_MS
      ).toBe(75_000);
    }
    expect(f.state.job).toMatchObject({
      attempts: 4,
      status: "queued",
      token: null,
      consecutiveErrors: 0,
    });
    const tokens = f.store.settle.mock.calls.map(([token]) => token);
    expect(new Set(tokens).size).toBe(4);
    expect(f.state.job!.startedAtMs).toBe(DB_NOW);
    expect(f.state.job!.expiresAtMs).toBe(DB_NOW + HQ_BACKGROUND_RUN_MS);
    f.noReporting();
  });

  it("keeps the provided pool and mandatory cooperative guards in the deferred live-store factory", async () => {
    const f = fixture();
    const factory = vi.spyOn(liveStoreModule, "createHqLiveStore");
    await f.coordinator.start(ACTOR);
    expect(factory).not.toHaveBeenCalled();
    const options = f.serviceOptions[0];
    const created = await options.createStore!(options.config!);
    expect(created).toBeDefined();
    expect(factory).toHaveBeenCalledWith(f.pool, options.config, {
      cooperativeGuard: expect.any(Function),
      cooperativeYieldGuard: expect.any(Function),
      validatedInitialReuseScope: hqBackgroundBinding(f.env),
    });
    const storeOptions = factory.mock.calls[0][2]!;
    await storeOptions.cooperativeGuard!();
    const previousChecks = f.authorize.mock.calls.length;
    await storeOptions.cooperativeYieldGuard!();
    const firstChecks = f.authorize.mock.calls.length;
    expect(firstChecks).toBeGreaterThan(previousChecks);
    await storeOptions.cooperativeYieldGuard!();
    expect(f.authorize.mock.calls.length).toBe(firstChecks);
    f.stateService.monotonicMs += 1000;
    await storeOptions.cooperativeYieldGuard!();
    expect(f.authorize.mock.calls.length).toBeGreaterThan(firstChecks);
    f.env.DATABASE_URL += "-drift";
    await expect(storeOptions.cooperativeYieldGuard!()).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    f.noReporting();
  });

  it("measures the eight-minute launch budget with monotonic time, not wall/DB time", async () => {
    const f = fixture();
    f.seed();
    vi.spyOn(Date, "now").mockReturnValue(DB_NOW + 100 * HQ_BACKGROUND_RUN_MS);
    f.stateService.invoke = async () => {
      f.stateService.monotonicMs += 160_000;
      return { status: "progress" };
    };
    expect(HQ_BACKGROUND_RUN_BUDGET_MS).toBe(480_000);
    expect(await f.coordinator.run()).toEqual({ status: "queued", batches: 3 });
    expect(f.invoke).toHaveBeenCalledTimes(3);
    expect(f.state.databaseNowMs).toBe(DB_NOW);
  });

  it("SAFETY REGRESSION: cannot launch a batch after metadata/authority awaits consume the eight-minute budget", async () => {
    const f = fixture();
    f.seed();
    f.state.beforeRead = () => {
      f.stateService.monotonicMs = HQ_BACKGROUND_RUN_BUDGET_MS;
    };
    await f.coordinator.run();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it.each(["future due", "unexpired holder"])(
    "exits without invocation or implicit retry for %s",
    async label => {
      const f = fixture();
      f.seed(
        label === "future due"
          ? { nextDueAtMs: DB_NOW + 60_000 }
          : {
              status: "running",
              attempts: 1,
              token: "00000000-0000-4000-8000-000000000001",
              leaseUntilMs: DB_NOW + HQ_BACKGROUND_LEASE_MS,
            }
      );
      const before = clone(f.state.job);
      expect(await f.coordinator.run()).toEqual({ status: "idle", batches: 0 });
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.store.claim).toHaveBeenCalledTimes(1);
      expect(f.state.job).toEqual(before);
      expect(f.writes).toEqual([]);
      f.noReporting();
    }
  );

  it.each(["busy", "notdue"] as const)(
    "settles %s once then exits without immediately retrying",
    async status => {
      const f = fixture();
      f.seed();
      f.stateService.invoke = async () => ({ status });
      expect(await f.coordinator.run()).toEqual({
        status: "queued",
        batches: 1,
      });
      expect(f.invoke).toHaveBeenCalledTimes(1);
      expect(f.store.settle).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["paused", "failed", "completed", null] as const)(
    "does not implicitly restart an inactive %s job",
    async status => {
      const f = fixture();
      if (status) f.seed({ status });
      expect(await f.coordinator.run()).toEqual({
        status: status ?? "idle",
        batches: 0,
      });
      expect(f.store.claim).not.toHaveBeenCalled();
      expect(f.createService).not.toHaveBeenCalled();
      expect(f.authorize).not.toHaveBeenCalled();
      f.noReporting();
    }
  );

  it("simultaneous finite workers cannot both claim the same queued token", async () => {
    const f = fixture();
    f.seed();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    f.stateService.invoke = async () => {
      entered();
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return { status: "busy" };
    };
    const worker = f.coordinator.run();
    await started;
    expect(await f.coordinator.run()).toEqual({ status: "idle", batches: 0 });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    release();
    expect(await worker).toEqual({ status: "queued", batches: 1 });
    expect(f.state.job!.attempts).toBe(1);
  });

  it.each(["run expiry", "attempt limit", "error limit"])(
    "persisted %s stops before service/source work",
    async label => {
      const f = fixture();
      f.seed(
        label === "attempt limit"
          ? { attempts: HQ_BACKGROUND_MAX_ATTEMPTS }
          : label === "error limit"
            ? { consecutiveErrors: 3, lastErrorCode: "TIMEOUT" }
            : {}
      );
      if (label === "run expiry")
        f.state.databaseNowMs = f.state.job!.expiresAtMs;
      expect(await f.coordinator.run()).toEqual({
        status: "failed",
        batches: 0,
      });
      expect(f.state.job!.status).toBe(
        label === "run expiry" ? "queued" : "failed"
      );
      if (label === "run expiry") {
        // Expiry is an independent read-only denial even after initiating authority
        // is revoked. No job rewrite or source admission is required to stop it.
        expect(f.store.claim).not.toHaveBeenCalled();
        expect(f.authorize).not.toHaveBeenCalled();
      }
      expect(f.createService).not.toHaveBeenCalled();
      f.noReporting();
    }
  );
});

describe("persisted errors and verified initial-only completion (offline)", () => {
  it.each(TRANSIENT_CODES)(
    "only transient %s is queued with preserved backoff; persisted errors 1 -> 2 -> 3 fail",
    async code => {
      const f = fixture();
      f.seed();
      f.stateService.invoke = async () => {
        f.stateService.status.lastErrorCode = code;
        f.stateService.status.nextDueAt = new Date(
          f.state.databaseNowMs + 60_000
        ).toISOString();
        return { status: "progress", errorCode: code };
      };
      for (let errors = 1; errors <= HQ_BACKGROUND_MAX_ERRORS; errors++) {
        const result = await f.coordinator.run();
        expect(result).toEqual({
          status: errors === 3 ? "failed" : "queued",
          batches: 1,
        });
        expect(f.state.job).toMatchObject({
          consecutiveErrors: errors,
          lastErrorCode: code,
          attempts: errors,
        });
        expect(f.state.job!.nextDueAtMs).toBe(f.state.databaseNowMs + 60_000);
        const calls = f.invoke.mock.calls.length;
        expect(await f.coordinator.run()).toEqual({
          status: errors === 3 ? "failed" : "idle",
          batches: 0,
        });
        expect(f.invoke).toHaveBeenCalledTimes(calls);
        f.state.databaseNowMs += 60_000;
      }
      expect(f.state.job!.consecutiveErrors).toBe(3);
      f.noReporting();
    }
  );

  it("a successful progress batch resets consecutive persisted errors without resetting the run window", async () => {
    const f = fixture();
    f.seed({ consecutiveErrors: 2, lastErrorCode: "TIMEOUT" });
    f.stateService.invoke = async () => ({ status: "busy" });
    expect(await f.coordinator.run()).toEqual({ status: "queued", batches: 1 });
    expect(f.state.job).toMatchObject({
      consecutiveErrors: 0,
      lastErrorCode: null,
      expiresAtMs: DB_NOW + HQ_BACKGROUND_RUN_MS,
    });
  });

  it.each([
    "AUTH_DENIED",
    "CONFIG_INVALID",
    "INVALID_PERSISTED_STATE",
    "SOURCE_BINDING_CHANGED",
    "STORE_UNAVAILABLE",
    "INVALID_SEMANTICS",
    "SOURCE_EXPIRED",
    "STATE_BYTE_CAP_EXCEEDED",
  ] as const)("terminal %s fails once and never retries", async code => {
    const f = fixture();
    f.seed();
    f.stateService.invoke = async () => ({
      status: "progress",
      errorCode: code,
    });
    expect(await f.coordinator.run()).toEqual({ status: "failed", batches: 1 });
    expect(f.state.job).toMatchObject({
      status: "failed",
      lastErrorCode: code,
    });
    expect(await f.coordinator.run()).toEqual({ status: "failed", batches: 0 });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    f.noReporting();
  });

  it.each(["disabled", "needs_attention"] as const)(
    "terminal result %s does not retry even without an error code",
    async status => {
      const f = fixture();
      f.seed();
      f.stateService.invoke = async () => ({ status });
      expect(await f.coordinator.run()).toEqual({
        status: "failed",
        batches: 1,
      });
      expect(f.invoke).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["applied", "already_complete"] as const)(
    "%s completes only after observed publication and never invokes again",
    async status => {
      const f = fixture();
      f.seed();
      f.stateService.invoke = async options => {
        expect(options.onlyInitialPublication).toBe(true);
        expect(options.initialImportGuard).toEqual(expect.any(Function));
        f.stateService.status.hasPublished = true;
        return { status };
      };
      expect(await f.coordinator.run()).toEqual({
        status: "completed",
        batches: 1,
      });
      expect(f.getStatus).toHaveBeenCalledTimes(1);
      expect(f.store.settle.mock.calls[0][1]).toMatchObject({
        status: "completed",
      });
      expect(await f.coordinator.run()).toEqual({
        status: "completed",
        batches: 0,
      });
      expect(f.invoke).toHaveBeenCalledTimes(1);
      expect(f.state.job).toMatchObject({
        status: "completed",
        token: null,
        leaseUntilMs: null,
      });
      f.noReporting();
    }
  );

  it.each(["applied", "already_complete"] as const)(
    "%s without after.hasPublished fails closed",
    async status => {
      const f = fixture();
      f.seed();
      f.stateService.invoke = async () => ({ status });
      expect(await f.coordinator.run()).toEqual({
        status: "failed",
        batches: 1,
      });
      expect(f.state.job).toMatchObject({
        status: "failed",
        lastErrorCode: "STORE_UNAVAILABLE",
      });
      expect(f.invoke).toHaveBeenCalledTimes(1);
      f.noReporting();
    }
  );

  it("unchecked published metadata alone never completes a job without an actual strongly initial-only invoke result", async () => {
    const f = fixture();
    f.seed();
    Object.assign(f.stateService.status, {
      hasPublished: true,
      payloadIntegrity: "unchecked",
    });
    f.stateService.invoke = async () => ({ status: "busy" });
    expect(await f.coordinator.run()).toEqual({ status: "queued", batches: 1 });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(f.serviceOptions[0].onlyInitialPublication).toBe(true);
    expect(f.state.job!.status).not.toBe("completed");
    f.noReporting();
  });

  it.each([
    [
      "attention health",
      { health: "needs_attention", stageStatus: "progress" },
    ],
    ["attention stage", { health: "progress", stageStatus: "needs_attention" }],
  ] as const)(
    "SAFETY REGRESSION: after-status %s without an error code must fail, not launch more batches",
    async (_label, patch) => {
      const f = fixture();
      f.seed();
      Object.assign(f.stateService.status, patch);
      expect(await f.coordinator.run()).toEqual({
        status: "failed",
        batches: 1,
      });
      expect(f.invoke).toHaveBeenCalledTimes(1);
    }
  );

  it("SAFETY REGRESSION: unknown invoke status cannot be treated as safe progress and retried", async () => {
    const f = fixture();
    f.seed();
    // Deliberately simulate a broken adapter/runtime return, beyond TS's union.
    f.stateService.invoke = async () =>
      ({ status: "unknown_failed" }) as unknown as HqLiveInvocationResult;
    expect(await f.coordinator.run()).toEqual({ status: "failed", batches: 1 });
    expect(f.invoke).toHaveBeenCalledTimes(1);
  });

  it("a rejected source/service promise gets sanitized job-only failure settlement, not import-root/control reset", async () => {
    const f = fixture();
    f.seed();
    f.stateService.invoke = async () => {
      throw new Error("raw provider body / secret / SELECT");
    };
    expect(await f.coordinator.run()).toEqual({ status: "failed", batches: 0 });
    expect(f.store.settle).toHaveBeenCalledTimes(1);
    expect(f.store.settle.mock.calls[0][1]).toEqual({
      status: "failed",
      errorCode: "STORE_UNAVAILABLE",
    });
    expect(f.state.job).toMatchObject({
      status: "failed",
      lastErrorCode: "STORE_UNAVAILABLE",
    });
    safeDto(await f.coordinator.status(ACTOR));
    f.noReporting();
  });

  it("failure settlement is best effort: rejected job write never resets import data or retries source", async () => {
    const f = fixture();
    f.seed();
    f.stateService.invoke = async () => {
      throw new HqLiveError("TIMEOUT");
    };
    f.state.settleError = new HqLiveError("STORE_UNAVAILABLE");
    expect(await f.coordinator.run()).toEqual({ status: "failed", batches: 0 });
    expect(f.state.job!.status).toBe("running");
    expect(f.store.settle).toHaveBeenCalledTimes(1);
    expect(f.invoke).toHaveBeenCalledTimes(1);
    f.noReporting();
  });

  it("SAFETY REGRESSION: rejected after-status read must return bounded failure with best-effort job-only settlement", async () => {
    const f = fixture();
    f.seed();
    f.getStatus.mockRejectedValueOnce(new HqLiveError("STORE_UNAVAILABLE"));
    await expect(f.coordinator.run()).resolves.toEqual({
      status: "failed",
      batches: 1,
    });
    expect(f.store.settle).toHaveBeenCalled();
    expect(f.state.job!.status).toBe("failed");
    expect(f.invoke).toHaveBeenCalledTimes(1);
    f.noReporting();
  });

  it("SAFETY REGRESSION: rejected normal settlement must return bounded failure rather than leak rejection", async () => {
    const f = fixture();
    f.seed();
    f.state.settleError = new HqLiveError("STORE_UNAVAILABLE");
    await expect(f.coordinator.run()).resolves.toEqual({
      status: "failed",
      batches: 1,
    });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(f.state.job!.status).not.toBe("completed");
    f.noReporting();
  });
});

describe("fresh authority/settings latches and race fences (offline)", () => {
  it("worker resolves only the persisted initiating actor; revocation prevents service creation/source work", async () => {
    const f = fixture();
    f.seed({ actorId: OTHER_ACTOR });
    f.authority.allowed = false;
    await expect(f.coordinator.run()).rejects.toMatchObject({
      code: "AUTH_DENIED",
    });
    expect(f.authorize.mock.calls.length).toBeGreaterThan(0);
    expect(f.authorize.mock.calls.every(([id]) => id === OTHER_ACTOR)).toBe(
      true
    );
    expect(f.createService).not.toHaveBeenCalled();
    expect(f.store.claim).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
    f.noReporting();
  });

  it("actor denial stays permanently latched after restoration and prevents engine continuation", async () => {
    const f = fixture();
    f.seed();
    const continuation = vi.fn();
    f.stateService.invoke = async options => {
      await options.initialImportGuard!();
      f.authority.allowed = false;
      await expect(options.initialImportGuard!()).rejects.toMatchObject({
        code: "AUTH_DENIED",
      });
      f.authority.allowed = true;
      await expect(options.initialImportGuard!()).rejects.toMatchObject({
        code: "AUTH_DENIED",
      });
      expect(options.initialImportCpuBindingGuard!).toThrow("AUTH_DENIED");
      try {
        await options.initialImportGuard!();
        continuation();
      } catch {
        /* engine halts */
      }
      return { status: "applied" };
    };
    expect(await f.coordinator.run()).toEqual({ status: "failed", batches: 0 });
    expect(continuation).not.toHaveBeenCalled();
    expect(f.state.job).toMatchObject({
      status: "failed",
      lastErrorCode: "AUTH_DENIED",
    });
    expect(f.getStatus).not.toHaveBeenCalled();
    f.noReporting();
  });

  it.each([
    [
      "DATABASE_URL",
      "mysql://offline-user:offline-password@127.0.0.1:2/offline_hq_background_changed",
    ],
    [
      "HQ_ORBIT_REPORTING_BASE_URL",
      "https://orbit.thejltgroup.co.uk/api/reporting/v1/",
    ],
    ["HQ_ORBIT_REPORTING_API_KEY", "offline-changed-key-" + "c".repeat(40)],
    ["HQ_PORTAL_SYNC_TOKEN", "offline-changed-token-" + "d".repeat(40)],
    ["HQ_LIVE_SYNC_ENABLED", "false"],
    ["HQ_LIVE_READ_ENABLED", "true"],
    ["HQ_LIVE_INTERVAL_SECONDS", "600"],
    ["HQ_LIVE_FRESHNESS_SECONDS", "1200"],
    ["HQ_INITIAL_BACKGROUND_ENABLED", "false"],
  ] as const)(
    "raw %s drift permanently denies both guards, even after restoration",
    async (key, changed) => {
      const f = fixture();
      f.seed();
      const initial = f.env[key];
      const originalBinding = hqBackgroundBinding(f.env);
      const continuation = vi.fn();
      f.stateService.invoke = async options => {
        await options.initialImportGuard!();
        f.env[key] = changed;
        expect(hqBackgroundBinding(f.env)).not.toBe(originalBinding);
        expect(options.initialImportCpuBindingGuard!).toThrow("CONFIG_INVALID");
        f.env[key] = initial;
        expect(hqBackgroundBinding(f.env)).toBe(originalBinding);
        expect(options.initialImportCpuBindingGuard!).toThrow("CONFIG_INVALID");
        await expect(options.initialImportGuard!()).rejects.toMatchObject({
          code: "CONFIG_INVALID",
        });
        try {
          await options.initialImportGuard!();
          continuation();
        } catch {
          /* no more engine work */
        }
        return { status: "progress" };
      };
      expect(await f.coordinator.run()).toEqual({
        status: "failed",
        batches: 0,
      });
      expect(continuation).not.toHaveBeenCalled();
      expect(f.state.job).toMatchObject({
        status: "failed",
        lastErrorCode: "CONFIG_INVALID",
      });
      expect(f.getStatus).not.toHaveBeenCalled();
      f.noReporting();
    }
  );

  it("fresh settings denial after getStatus prevents start persistence", async () => {
    const f = fixture();
    f.getStatus.mockImplementationOnce(async () => {
      f.env.HQ_LIVE_READ_ENABLED = "true";
      return clone(f.stateService.status);
    });
    await expect(f.coordinator.start(ACTOR)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    expect(f.store.start).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });

  it.each(["status", "pause", "run"] as const)(
    "stale persisted source fingerprint fails %s without creating a source reader",
    async operation => {
      const f = fixture();
      f.seed({ sourceBinding: "f".repeat(64) });
      const before = clone(f.state.job);
      if (operation === "run")
        await expect(f.coordinator.run()).rejects.toMatchObject({
          code: "CONFIG_INVALID",
        });
      else
        await expect(f.coordinator[operation](ACTOR)).rejects.toMatchObject({
          code: "SOURCE_BINDING_CHANGED",
        });
      expect(f.state.job).toEqual(before);
      expect(f.createService).not.toHaveBeenCalled();
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.writes).toEqual([]);
      f.noReporting();
    }
  );

  it.each(["pause", "token race", "lease expiry", "run expiry"])(
    "running %s is caught by mandatory guard before engine continuation",
    async race => {
      const f = fixture();
      f.seed();
      const continuation = vi.fn();
      f.stateService.invoke = async options => {
        await options.initialImportGuard!();
        if (race === "pause") await f.coordinator.pause(ACTOR);
        else if (race === "token race")
          f.state.job!.token = "00000000-0000-4000-8000-000000009999";
        else
          f.state.databaseNowMs =
            race === "lease expiry"
              ? f.state.job!.leaseUntilMs!
              : f.state.job!.expiresAtMs;
        try {
          await options.initialImportGuard!();
          continuation();
        } catch (error) {
          expect(error).toMatchObject({ code: "LEASE_LOST" });
        }
        return { status: "applied" };
      };
      expect(await f.coordinator.run()).toEqual({
        status: "failed",
        batches: 0,
      });
      expect(continuation).not.toHaveBeenCalled();
      expect(f.getStatus).not.toHaveBeenCalled();
      expect(f.state.job!.status).not.toBe("completed");
      if (race === "pause") expect(f.state.job!.status).toBe("paused");
      if (race === "token race")
        expect(f.state.job!.token).toBe("00000000-0000-4000-8000-000000009999");
      f.noReporting();
    }
  );

  it("late worker cannot mark completion after pause wins the settlement token race", async () => {
    const f = fixture();
    f.seed();
    f.stateService.invoke = async () => {
      f.stateService.status.hasPublished = true;
      return { status: "applied" };
    };
    let paused = false;
    f.state.beforeSettle = async () => {
      if (!paused) {
        paused = true;
        await f.coordinator.pause(ACTOR);
      }
    };
    expect(await f.coordinator.run()).toEqual({ status: "paused", batches: 1 });
    expect(f.state.job).toMatchObject({
      status: "paused",
      token: null,
      leaseUntilMs: null,
    });
    expect(f.writes.some(job => job.status === "completed")).toBe(false);
    expect(f.invoke).toHaveBeenCalledTimes(1);
    f.noReporting();
  });

  it("a successor token is never overwritten by a late completion settlement", async () => {
    const f = fixture();
    f.seed();
    f.stateService.invoke = async () => {
      f.stateService.status.hasPublished = true;
      return { status: "applied" };
    };
    f.state.beforeSettle = () => {
      f.state.job!.token = "00000000-0000-4000-8000-000000009999";
    };
    expect(await f.coordinator.run()).toEqual({ status: "failed", batches: 1 });
    expect(f.state.job).toMatchObject({
      status: "running",
      token: "00000000-0000-4000-8000-000000009999",
    });
    expect(f.writes.some(job => job.status === "completed")).toBe(false);
    f.noReporting();
  });
});
