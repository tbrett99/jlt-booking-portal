import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type {
  HqLiveStore,
  HqLiveControl,
  HqLiveLease,
} from "./management-hq-live-store";
import type { HqImplementedSyncState } from "./management-hq-ingestion";
import type { HqWireReader } from "../shared/management-hq-wire";
import type { HqLiveService } from "./management-hq-live-service";
const m = vi.hoisted(() => ({
  rows: [] as any[][],
  select: vi.fn(),
  getDb: vi.fn(),
  pool: vi.fn(),
  transport: vi.fn(),
  options: [] as any[],
  store: null as HqLiveStore | null,
  reader: null as HqWireReader | null,
  readerFactory: vi.fn(),
  serviceFactory: vi.fn(),
  services: [] as HqLiveService[],
  onSelect: null as null | (() => void | Promise<void>),
  statusHook: null as null | (() => void),
  directoryRead: vi.fn(),
  directoryHook: null as null | (() => void | Promise<void>),
  snapshotHook: null as null | (() => void | Promise<void>),
}));
vi.mock("./business-staff-access", () => ({
  getBusinessStaffAuthority: async () => null,
  assertBusinessStaffRouteAllowed: async () => {},
}));
vi.mock("./db", () => ({ getDb: m.getDb, getRawDbPool: m.pool }));
vi.mock("./management-hq-live-service", async () => {
  const actual = await vi.importActual<any>("./management-hq-live-service");
  return {
    ...actual,
    createHqLiveService: (options: any) => {
      m.serviceFactory(options);
      m.options.push(options);
      const service = actual.createHqLiveService({
        ...options,
        createStore: () => m.store,
        createReader: () => {
          m.readerFactory();
          return m.reader;
        },
      });
      const getStatus = service.getStatus.bind(service);
      vi.spyOn(service, "getStatus").mockImplementation(async () => {
        const status = await getStatus();
        m.statusHook?.();
        return status;
      });
      vi.spyOn(service, "getValidationStatus");
      m.services.push(service);
      return service;
    },
  };
});
vi.mock("./management-hq-identity", () => ({
  createPortalHqImplementedDirectory: () => ({
    resolve: async () => null,
    resolveCurrentOwner: async () => {
      m.directoryRead();
      await m.directoryHook?.();
      return null;
    },
    resolveAssignedStaff: async () => {
      m.directoryRead();
      await m.directoryHook?.();
      return null;
    },
  }),
}));
import { managementHqRouter } from "./management-hq-router";
import { router } from "./_core/trpc";
import { createHqLiveConfig } from "./management-hq-live-config";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import { validateHqImplementedSyncState } from "./management-hq-ingestion";
import { HqLiveError } from "./management-hq-live-store";
const app = router({ managementHq: managementHqRouter });
const fresh = {
  id: 47,
  role: "super_admin",
  isActive: true,
  portalStatus: "active",
};
const caller = (user: any = { ...fresh }) =>
  app.createCaller({ user, req: {}, res: {} } as any).managementHq;
const PRIVATE =
  "secret-key customer@example.test https://provider.test?token=private SELECT private_payload";
const safe = (value: unknown) =>
  expect(JSON.stringify(value)).not.toMatch(
    /secret-key|customer@|https:|SELECT|private_payload|resumeCursor|leaseToken|sourceFingerprint|bookingRef|apiKey/
  );
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function fakeFencedStore(): HqLiveStore {
  const fingerprint = createHqLiveConfig().sourceFingerprint()!;
  let state: HqImplementedSyncState | null = null,
    control: HqLiveControl | null = null;
  function guard(lease: HqLiveLease) {
    if (
      !control ||
      control.leaseToken !== lease.token ||
      control.fencingNumber !== lease.fencingNumber ||
      control.leaseExpiresAtMs! <= Date.now() ||
      control.leaseHardExpiresAtMs! <= Date.now()
    )
      throw new HqLiveError("LEASE_LOST");
  }
  const store: HqLiveStore = {
    readSnapshot: vi.fn(async () => {
      await m.snapshotHook?.();
      if (state) validateHqImplementedSyncState(state);
      return clone({ control, sync: state, databaseNowMs: Date.now() });
    }),
    readPublished: vi.fn(
      async () => (await store.readSnapshot()).sync?.published ?? null
    ),
    acquire: vi.fn(async () => {
      control ??= {
        format: "hq-live-control-v1",
        version: 1,
        sourceFingerprint: fingerprint,
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
        stageStatus: "idle",
      };
      if (control.leaseToken && control.leaseExpiresAtMs! > Date.now())
        return { status: "busy" };
      if (control.stageStatus === "needs_attention")
        return { status: "needs_attention" };
      if (control.nextDueAtMs > Date.now()) return { status: "notdue" };
      control.fencingNumber++;
      control.version++;
      control.leaseToken = "00000000-0000-0000-0000-000000000001";
      control.leaseExpiresAtMs = Date.now() + 30000;
      control.leaseHardExpiresAtMs = Date.now() + 95000;
      control.lastAttemptAtMs = Date.now();
      control.stageStatus = "running";
      return {
        status: "acquired",
        lease: {
          token: control.leaseToken,
          fencingNumber: control.fencingNumber,
          sourceFingerprint: fingerprint,
          hardExpiresAtMs: control.leaseHardExpiresAtMs,
        },
      };
    }),
    renew: vi.fn(async lease => {
      guard(lease);
      control!.leaseExpiresAtMs = Math.min(
        Date.now() + 30000,
        control!.leaseHardExpiresAtMs!
      );
    }),
    fencedSyncStore: vi.fn(lease => ({
      readSync: async () => (await store.readSnapshot()).sync,
      compareAndSwapSync: async (expected, next) => {
        guard(lease);
        validateHqImplementedSyncState(next);
        if ((state?.version ?? null) !== expected) return false;
        if (next.version !== (expected ?? 0) + 1)
          throw new HqLiveError("INVALID_PERSISTED_STATE");
        if (
          next.published &&
          !next.stage &&
          next.published.version !== state?.published?.version
        )
          control!.lastPublishAtMs = Date.now();
        state = clone(next);
        return true;
      },
    })),
    complete: vi.fn(async (lease, completion) => {
      guard(lease);
      control!.stageStatus = completion.status;
      control!.nextDueAtMs = Date.now() + completion.delaySeconds * 1000;
      control!.lastErrorCode = completion.errorCode ?? null;
      if (completion.status === "applied")
        control!.lastSuccessAtMs = Date.now();
      control!.leaseToken =
        control!.leaseExpiresAtMs =
        control!.leaseHardExpiresAtMs =
          null;
    }),
  };
  return store;
}
async function denied(pending: Promise<unknown>, code = "FORBIDDEN") {
  const error = await pending.catch(e => e);
  expect(error).toBeInstanceOf(TRPCError);
  expect(error.code).toBe(code);
  safe({ code: error.code, message: error.message });
}
async function completeInitialPublication(
  initial?: Awaited<ReturnType<ReturnType<typeof caller>["importInitialBatch"]>>
) {
  let outcome = initial ?? (await caller().importInitialBatch());
  let batches = 1;
  while (outcome.status === "progress") {
    expect(++batches).toBeLessThan(12);
    expect(outcome.hasPublished).toBe(false);
    const due = Date.parse(outcome.nextDueAt!);
    expect(due - Date.now()).toBe(60000);
    vi.advanceTimersByTime(due - Date.now());
    outcome = await caller().importInitialBatch();
  }
  expect(outcome).toMatchObject({ status: "applied", hasPublished: true });
  expect((await m.store!.readSnapshot()).sync?.published).not.toBeNull();
  return batches;
}
beforeEach(() => {
  // Freeze security/lease timestamps and explicit due advances, but keep the
  // cooperative CPU validator's setImmediate handoff genuinely asynchronous.
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ],
  });
  vi.setSystemTime(new Date("2026-11-22T12:00:10Z"));
  for (const [k, v] of Object.entries({
    NODE_ENV: "production",
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://orbit.thejltgroup.co.uk/api/reporting/v1",
    HQ_ORBIT_REPORTING_API_KEY: "SYNTHETIC-REPORTING-KEY-" + "a".repeat(32),
    HQ_PORTAL_SYNC_TOKEN: "SYNTHETIC-PORTAL-TOKEN-" + "b".repeat(32),
    HQ_LIVE_INTERVAL_SECONDS: undefined,
    HQ_LIVE_FRESHNESS_SECONDS: undefined,
  }))
    vi.stubEnv(k, v);
  m.rows = [];
  m.options = [];
  m.services = [];
  m.onSelect = m.directoryHook = m.snapshotHook = null;
  m.statusHook = null;
  for (const fn of [
    m.select,
    m.getDb,
    m.pool,
    m.transport,
    m.readerFactory,
    m.serviceFactory,
    m.directoryRead,
  ])
    fn.mockReset();
  m.select.mockImplementation(() => {
    const q: any = {
      from: () => q,
      where: () => q,
      limit: async () => {
        await m.onSelect?.();
        return m.rows.shift() ?? [{ ...fresh }];
      },
    };
    return q;
  });
  m.getDb.mockResolvedValue({ select: m.select });
  m.pool.mockImplementation(() => {
    throw new Error(PRIVATE);
  });
  m.transport.mockImplementation(() => {
    throw new Error(PRIVATE);
  });
  vi.stubGlobal("fetch", m.transport);
  m.reader = createHqImplementedSampleReader("initial");
  m.store = fakeFencedStore();
});
afterEach(() => {
  expect(m.pool).not.toHaveBeenCalled();
  expect(m.transport).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("actual protected tRPC first-import procedures", () => {
  it("router import/caller creation and status/validation checks never invoke imports", async () => {
    await import("./management-hq-router");
    caller();
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.readerFactory).not.toHaveBeenCalled();
    expect(m.serviceFactory).not.toHaveBeenCalled();
    expect(await caller().status()).toMatchObject({
      live: { readEnabled: false, hasPublished: false },
    });
    expect(await caller().validateInitialImport()).toMatchObject({
      status: "awaiting_import",
      years: [],
      manualChecksPending: true,
    });
    expect(m.store!.acquire).not.toHaveBeenCalled();
    expect(m.readerFactory).not.toHaveBeenCalled();
  });
  it.each([
    "HQ_ORBIT_REPORTING_BASE_URL",
    "HQ_ORBIT_REPORTING_API_KEY",
    "HQ_PORTAL_SYNC_TOKEN",
  ])(
    "protected status identifies missing %s without store/source work or secret values",
    async field => {
      vi.stubEnv(field, undefined);
      const result = await caller().status();
      expect(result.live).toMatchObject({
        configured: false,
        configurationCode: "CONFIG_INCOMPLETE",
        syncEnabled: true,
        readEnabled: false,
        missingSettings: [field],
        hasPublished: false,
      });
      expect(m.store!.readSnapshot).not.toHaveBeenCalled();
      expect(m.store!.acquire).not.toHaveBeenCalled();
      expect(m.readerFactory).not.toHaveBeenCalled();
      const output = JSON.stringify(result);
      expect(output).not.toMatch(
        /SYNTHETIC-|https:|leaseToken|sourceFingerprint/
      );
      m.getDb.mockClear();
      await denied(caller(null).status(), "UNAUTHORIZED");
      expect(m.getDb).not.toHaveBeenCalled();
      await denied(caller({ ...fresh, role: "agent" }).status());
    }
  );
  it("one protected click invokes one bounded first-only service with actual strict config and keeps reports/export off", async () => {
    const sourceMethods = [
      vi.spyOn(m.reader!, "status"),
      vi.spyOn(m.reader!, "capabilities"),
      vi.spyOn(m.reader!, "bookings"),
      vi.spyOn(m.reader!, "businessMappings"),
      vi.spyOn(m.reader!, "catalogue"),
      vi.spyOn(m.reader!, "changes"),
    ];
    const result = await caller().importInitialBatch();
    expect(result).toMatchObject({ status: "progress", hasPublished: false });
    safe(result);
    expect(m.options[0]).toMatchObject({
      onlyInitialPublication: true,
      initialImportGuard: expect.any(Function),
      maxSourceMethods: 3,
    });
    expect(m.options[0].config.status()).toMatchObject({
      configured: true,
      syncEnabled: true,
      readEnabled: false,
    });
    expect(m.store!.acquire).toHaveBeenCalledOnce();
    expect(m.readerFactory).toHaveBeenCalledOnce();
    expect(sourceMethods.map(spy => spy.mock.calls.length)).toEqual([
      1, 1, 1, 0, 0, 0,
    ]);
    await denied(caller().report({ year: 2026 }), "PRECONDITION_FAILED");
    await denied(caller().exportCsv({ year: 2026 }), "PRECONDITION_FAILED");
    expect(process.env.HQ_LIVE_READ_ENABLED).toBe("false");
    const batches = await completeInitialPublication(result);
    expect(m.store!.acquire).toHaveBeenCalledTimes(batches);
    expect(m.readerFactory).toHaveBeenCalledTimes(batches);
    vi.advanceTimersByTime(3600000);
    expect((await caller().importInitialBatch()).status).toBe(
      "already_complete"
    );
    expect(m.store!.acquire).toHaveBeenCalledTimes(batches);
    expect(m.readerFactory).toHaveBeenCalledTimes(batches);
  });
  it("complete first publication validates bounded totals with real engine; no normal reads or new source batch", async () => {
    const batches = await completeInitialPublication();
    const before = m.readerFactory.mock.calls.length;
    const result = await caller().validateInitialImport();
    expect(result).toMatchObject({
      status: "checks_ready",
      manualChecksPending: true,
      generationId: 1,
    });
    expect(result.years.length).toBeGreaterThan(0);
    expect(result.years[0].grossSales).toMatch(/^\d+\.\d{2}$/);
    safe(result);
    expect(m.readerFactory).toHaveBeenCalledTimes(before);
    expect(m.store!.readPublished).toHaveBeenCalled();
    expect(m.store!.acquire).toHaveBeenCalledTimes(batches);
  });
  it("ordinary protected progress remains unchecked while real validation prefers strong pre/post status", async () => {
    const batches = await completeInitialPublication();
    const snapshot = await m.store!.readSnapshot();
    m.store!.readProgressSnapshot = vi.fn(async () => ({
      payloadIntegrity: "unchecked" as const,
      control: clone(snapshot.control),
      stateVersion: snapshot.sync!.version,
      hasPublished: true,
      progress: null,
      databaseNowMs: Date.now(),
    }));
    vi.mocked(m.store!.readSnapshot).mockClear();
    vi.mocked(m.store!.readPublished).mockClear();
    const progress = await caller().status();
    expect(progress.live).toMatchObject({
      health: "progress",
      payloadIntegrity: "unchecked",
      hasPublished: true,
      stateVersion: snapshot.sync!.version,
      generationId: null,
      isStale: null,
      readEnabled: false,
    });
    const progressService = m.services[m.services.length - 1];
    expect(progressService.getStatus).toHaveBeenCalledOnce();
    expect(progressService.getValidationStatus).not.toHaveBeenCalled();
    expect(m.store!.readProgressSnapshot).toHaveBeenCalledOnce();
    expect(m.store!.readSnapshot).not.toHaveBeenCalled();
    expect(m.store!.readPublished).not.toHaveBeenCalled();
    safe(progress);

    const checks = await caller().validateInitialImport();
    const validationService = m.services[m.services.length - 1];
    expect(validationService.getValidationStatus).toHaveBeenCalledTimes(2);
    expect(validationService.getStatus).not.toHaveBeenCalled();
    expect(m.store!.readProgressSnapshot).toHaveBeenCalledOnce();
    expect(m.store!.readPublished).toHaveBeenCalledOnce();
    expect(checks).toMatchObject({
      status: "checks_ready",
      generationId: snapshot.sync!.published!.metadata.generationId,
      sourcePublishedAt: snapshot.sync!.published!.metadata.publishedAt,
      isStale: false,
      manualChecksPending: true,
    });
    expect(checks.years.length).toBeGreaterThan(0);
    expect(checks.years[0].grossSales).toMatch(/^\d+\.\d{2}$/);
    safe(checks);
    expect(m.store!.acquire).toHaveBeenCalledTimes(batches);
    expect(m.readerFactory).toHaveBeenCalledTimes(batches);
    await denied(caller().report({ year: 2026 }), "PRECONDITION_FAILED");
    await denied(caller().exportCsv({ year: 2026 }), "PRECONDITION_FAILED");
    expect(process.env.HQ_LIVE_READ_ENABLED).toBe("false");
  });
  it.each(["importInitialBatch", "validateInitialImport"] as const)(
    "anonymous %s is denied before database/source work",
    async action => {
      await denied(caller(null)[action](), "UNAUTHORIZED");
      expect(m.getDb).not.toHaveBeenCalled();
      expect(m.readerFactory).not.toHaveBeenCalled();
    }
  );
  it.each(["admin", "agent", "staff", "business_staff", "instructor"])(
    "%s cannot import",
    async role => {
      await denied(caller({ ...fresh, role }).importInitialBatch());
      expect(m.readerFactory).not.toHaveBeenCalled();
      expect(m.serviceFactory).not.toHaveBeenCalled();
    }
  );
  it.each([
    [],
    [{ ...fresh, isActive: false }],
    [{ ...fresh, role: "admin" }],
    [{ ...fresh, portalStatus: "pending" }],
    [{ ...fresh, id: 48 }],
    [fresh, fresh],
  ])("fresh invalid authority rows %j reject before source", async (...row) => {
    // it.each spreads array rows; reconstruct one result set.
    m.rows = [row as any[]];
    await denied(caller().importInitialBatch());
    expect(m.readerFactory).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { sourceUrl: PRIVATE },
    { syncEnabled: true },
    { apiKey: PRIVATE },
    [],
    "payload",
    true,
    0,
  ])("z.void rejects forged import and validation input %j", async input => {
    for (const action of [
      "importInitialBatch",
      "validateInitialImport",
    ] as const)
      await denied((caller()[action] as any)(input), "BAD_REQUEST");
    expect(m.serviceFactory).not.toHaveBeenCalled();
    expect(m.readerFactory).not.toHaveBeenCalled();
  });
  it.each([
    ["HQ_LIVE_SYNC_ENABLED", "false"],
    ["HQ_LIVE_READ_ENABLED", "true"],
    ["HQ_LIVE_SYNC_ENABLED", "TRUE"],
    ["HQ_PORTAL_SYNC_TOKEN", undefined],
    ["HQ_ORBIT_REPORTING_API_KEY", "short"],
  ])("actual %s=%s cannot start a batch", async (key, value) => {
    vi.stubEnv(key, value);
    const result = await caller().importInitialBatch();
    expect(["disabled", "needs_attention"]).toContain(result.status);
    safe(result);
    expect(m.serviceFactory).not.toHaveBeenCalled();
    expect(m.store!.acquire).not.toHaveBeenCalled();
    await denied(caller().validateInitialImport(), "PRECONDITION_FAILED");
  });
  it.each([false, true])(
    "fresh revocation after successful/failed source await %s denies result and stops later GETs",
    async fails => {
      const base = m.reader!,
        capabilities = vi.fn(base.capabilities);
      let beforeFailure: unknown;
      m.reader = {
        ...base,
        capabilities,
        status: async () => {
          beforeFailure = clone((await m.store!.readSnapshot()).control);
          // Only the immediate post-GET read is revoked. Later reads recover; the
          // action must nevertheless stay denied after that failed fresh guard.
          m.rows = [[{ ...fresh, isActive: false }]];
          if (fails) throw new Error(PRIVATE);
          return base.status();
        },
      };
      await denied(caller().importInitialBatch());
      expect(capabilities).not.toHaveBeenCalled();
      expect(await m.store!.readPublished()).toBeNull();
      expect(m.store!.complete).not.toHaveBeenCalled();
      expect((await m.store!.readSnapshot()).control).toEqual(beforeFailure);
    }
  );
  it.each([
    ["HQ_ORBIT_REPORTING_API_KEY", "rotated-" + "x".repeat(40)],
    ["HQ_ORBIT_REPORTING_BASE_URL", "https://approved.example.org/api"],
    ["HQ_PORTAL_SYNC_TOKEN", "rotated-" + "x".repeat(40)],
    ["HQ_LIVE_SYNC_ENABLED", "false"],
    ["HQ_LIVE_READ_ENABLED", "true"],
    ["HQ_LIVE_INTERVAL_SECONDS", "600"],
    ["HQ_LIVE_FRESHNESS_SECONDS", "60"],
  ])(
    "raw %s drift during source GET suppresses all action data",
    async (key, value) => {
      const base = m.reader!,
        capabilities = vi.fn(base.capabilities);
      let beforeFailure: unknown;
      m.reader = {
        ...base,
        capabilities,
        status: async () => {
          beforeFailure = clone((await m.store!.readSnapshot()).control);
          vi.stubEnv(key, value);
          return base.status();
        },
      };
      await denied(caller().importInitialBatch(), "PRECONDITION_FAILED");
      expect(capabilities).not.toHaveBeenCalled();
      expect(m.store!.complete).not.toHaveBeenCalled();
      expect((await m.store!.readSnapshot()).control).toEqual(beforeFailure);
    }
  );
  it("fresh authority/SQL failure after source await never exposes private causes", async () => {
    const base = m.reader!;
    m.reader = {
      ...base,
      status: async () => {
        m.onSelect = () => {
          throw new TRPCError({ code: "FORBIDDEN", message: PRIVATE });
        };
        return base.status();
      },
    };
    await denied(caller().importInitialBatch(), "PRECONDITION_FAILED");
  });
  it("settings drift inside initial status store await denies before acquisition", async () => {
    m.snapshotHook = () => {
      vi.stubEnv("HQ_PORTAL_SYNC_TOKEN", "rotated-" + "x".repeat(40));
    };
    await denied(caller().importInitialBatch(), "PRECONDITION_FAILED");
    expect(m.store!.acquire).not.toHaveBeenCalled();
  });
  it("raw binding drift during the final authority await cannot return already-complete status", async () => {
    const batches = await completeInitialPublication();
    let selects = 0;
    m.statusHook = () => {
      // Arm only after strong status has resolved. The first fresh read is
      // the import helper's post-await guard; the second is the router's final
      // guard. Cooperative validation may add earlier reads but cannot retarget
      // this regression away from the last authority await.
      m.onSelect = () => {
        if (++selects === 2)
          vi.stubEnv("HQ_PORTAL_SYNC_TOKEN", "rotated-" + "x".repeat(40));
      };
    };
    await denied(caller().importInitialBatch(), "PRECONDITION_FAILED");
    expect(selects).toBe(2);
    expect(m.store!.acquire).toHaveBeenCalledTimes(batches);
    expect(m.readerFactory).toHaveBeenCalledTimes(batches);
  });
  it("validation directory authority revocation is denied even if helper catches its guard", async () => {
    await completeInitialPublication();
    m.directoryHook = () => {
      m.rows = [[{ ...fresh, role: "admin" }], [{ ...fresh, role: "admin" }]];
    };
    await denied(caller().validateInitialImport());
    expect(m.directoryRead).toHaveBeenCalled();
  });
  it("validation directory source/token drift suppresses checks", async () => {
    await completeInitialPublication();
    m.directoryHook = () => {
      vi.stubEnv("HQ_PORTAL_SYNC_TOKEN", "rotated-" + "x".repeat(40));
    };
    await denied(caller().validateInitialImport(), "PRECONDITION_FAILED");
    expect(m.directoryRead).toHaveBeenCalled();
  });
  it("concurrent publication/status version change suppresses computed validation totals", async () => {
    await completeInitialPublication();
    const read = vi.mocked(m.store!.readSnapshot).getMockImplementation()!;
    let count = 0;
    vi.mocked(m.store!.readSnapshot).mockImplementation(async () => {
      const snapshot = await read();
      count++;
      if (count >= 3 && snapshot.sync) snapshot.sync.version++;
      return snapshot;
    });
    await denied(caller().validateInitialImport(), "PRECONDITION_FAILED");
    expect(count).toBeGreaterThanOrEqual(3);
    expect(m.directoryRead).toHaveBeenCalled();
  });
  it("safe terminal provider outcome exposes no raw SQL/source data and never auto-retries", async () => {
    const base = m.reader!;
    m.reader = {
      ...base,
      status: async () => {
        throw Object.assign(new Error(PRIVATE), { code: "INVALID_PAYLOAD" });
      },
    };
    const response = await caller().importInitialBatch();
    expect(response).toMatchObject({
      status: "needs_attention",
      errorCode: "INVALID_PAYLOAD",
    });
    safe(response);
    vi.advanceTimersByTime(4000000);
    expect((await caller().importInitialBatch()).status).toBe(
      "needs_attention"
    );
    expect(m.readerFactory).toHaveBeenCalledOnce();
    expect(m.store!.acquire).toHaveBeenCalledOnce();
  });
});
