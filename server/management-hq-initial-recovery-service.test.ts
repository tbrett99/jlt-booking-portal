import { describe, expect, it, vi } from "vitest";
import type { HqImplementedSyncState } from "./management-hq-ingestion";
import {
  createHqLiveConfig,
  type HqLiveConfigurationStatus,
} from "./management-hq-live-config";
import {
  createHqLiveService,
  type HqLiveService,
  type HqLiveServiceOptions,
} from "./management-hq-live-service";
import {
  HqLiveError,
  type HqLiveControl,
  type HqLiveSnapshot,
  type HqLiveStore,
} from "./management-hq-live-store";

type RecoveryStatus = "recovered" | "notdue" | "busy" | "not_recoverable";
type RecoveryStore = HqLiveStore & {
  recoverEmptyInitialImport?: (
    expectedVersion: number,
    authority: () => Promise<void>
  ) => Promise<RecoveryStatus>;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const settings = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://orbit.thejltgroup.co.uk/api/reporting/v1",
  HQ_ORBIT_REPORTING_API_KEY: "SYNTHETIC-REPORTING-KEY-" + "a".repeat(32),
  HQ_PORTAL_SYNC_TOKEN: "SYNTHETIC-PORTAL-TOKEN-" + "b".repeat(32),
  HQ_LIVE_INTERVAL_SECONDS: "300",
  HQ_LIVE_FRESHNESS_SECONDS: "900",
  ...overrides,
});
const control = (overrides: Partial<HqLiveControl> = {}): HqLiveControl => ({
  format: "hq-live-control-v1",
  version: 9,
  sourceFingerprint: "c".repeat(64),
  fencingNumber: 1,
  leaseToken: null,
  leaseExpiresAtMs: null,
  leaseHardExpiresAtMs: null,
  nextDueAtMs: 1000,
  consecutiveFailures: 1,
  lastAttemptAtMs: 1000,
  lastSuccessAtMs: null,
  lastPublishAtMs: null,
  lastErrorCode: "INVALID_SEMANTICS",
  stageStatus: "needs_attention",
  ...overrides,
});
function snapshot(overrides: Partial<HqLiveSnapshot> = {}): HqLiveSnapshot {
  return { control: control(), sync: null, databaseNowMs: 2000, ...overrides };
}
function syntheticSync(kind: "empty" | "stage" | "published") {
  const sync: HqImplementedSyncState = {
    version: 1,
    published: null,
    stage: null,
  };
  if (kind === "stage")
    sync.stage = {
      kind: "backfill",
      phase: "bookings",
      basePublishedVersion: null,
      metadata: null,
      cursor: null,
      pendingResumeCursor: null,
      entities: {},
      seqProofs: {},
      feedKeys: { booking: [], business: [] },
      catalogueKeys: { booking: [], business: [] },
      cursors: [],
      pages: 0,
      recordsRead: 0,
      lastSeq: null,
    };
  if (kind === "published")
    sync.published = {
      wireVersion: "1.0.0",
      version: 1,
      scope: "company_all_real_and_unattributed",
      resumeCursor: "SYNTHETIC-PRIVATE-CHECKPOINT",
      entities: {},
      seqProofs: {},
      metadata: {
        generationId: 1,
        projectionVersion: "1.0.0",
        scope: "company_all_real_and_unattributed",
        sourceObservationWindow: {
          from: "2026-11-22T12:00:00Z",
          to: "2026-11-22T12:00:00Z",
        },
        publishedAt: "2026-11-22T12:00:00Z",
        expiresAt: "2026-11-23T12:00:00Z",
        changeUpper: 0,
        sourceAgeSeconds: 0,
        freshnessTargetSeconds: 900,
        stale: false,
        consistency:
          "sealed_reporting_generation_with_per_page_source_snapshot",
        counts: { bookings: 0, businesses: 0 },
      },
    };
  return sync;
}
function setup(
  options: HqLiveServiceOptions = {},
  initialSnapshot = snapshot()
) {
  const events: string[] = [];
  const forbiddenReader = vi.fn(() => {
    throw new Error("source reader factory forbidden");
  });
  const configurationReader = vi.fn(() => {
    throw new Error("configuration source reader factory forbidden");
  });
  const forbiddenWork = vi.fn(async () => {
    throw new Error("operational work and import invocation forbidden");
  });
  const guard = vi.fn(async () => {
    events.push("guard");
  });
  const readSnapshot = vi.fn(async () => {
    events.push("snapshot");
    return clone(initialSnapshot);
  });
  const recovery = vi.fn(
    async (_expectedVersion: number, authority: () => Promise<void>) => {
      events.push("recovery");
      await authority();
      return "recovered" as RecoveryStatus;
    }
  );
  const store: RecoveryStore = {
    readSnapshot,
    readPublished: forbiddenWork,
    acquire: forbiddenWork,
    renew: forbiddenWork,
    complete: forbiddenWork,
    fencedSyncStore: vi.fn(() => {
      throw new Error("sync store and import invocation forbidden");
    }),
    recoverEmptyInitialImport: recovery,
  };
  const createStore = vi.fn(() => {
    events.push("store");
    return store;
  });
  const config = {
    ...createHqLiveConfig(settings()),
    createReader: configurationReader,
  };
  const service = createHqLiveService({
    config,
    createStore,
    createReader: forbiddenReader,
    onlyInitialPublication: true,
    initialImportGuard: guard,
    ...options,
  });
  const invoke = vi.spyOn(service, "invoke");
  const getStatus = vi.spyOn(service, "getStatus");
  const recover = () => service.recoverEmptyInitialImport!();
  const expectNoImport = () => {
    expect(forbiddenReader).not.toHaveBeenCalled();
    expect(configurationReader).not.toHaveBeenCalled();
    expect(forbiddenWork).not.toHaveBeenCalled();
    expect(store.fencedSyncStore).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(getStatus).not.toHaveBeenCalled();
  };
  return {
    service,
    store,
    config,
    guard,
    createStore,
    readSnapshot,
    recovery,
    events,
    recover,
    expectNoImport,
  };
}
function safeStatus(value: unknown) {
  expect(["recovered", "notdue", "busy", "not_recoverable"]).toContain(value);
  expect(typeof value).toBe("string");
  expect(JSON.stringify(value)).not.toMatch(
    /SYNTHETIC|version|sourceFingerprint|resumeCursor|history|rows|https:|SELECT|lease|control/
  );
}

describe("protected empty initial-import recovery service", () => {
  it.each<RecoveryStatus>(["recovered", "notdue", "busy", "not_recoverable"])(
    "returns only the closed store status %s without importing",
    async status => {
      const s = setup();
      s.recovery.mockImplementation(async (_version, authority) => {
        await authority();
        return status;
      });
      const before = await s.readSnapshot();
      s.readSnapshot.mockClear();
      expect(await s.recover()).toBe(status);
      expect(s.createStore).toHaveBeenCalledOnce();
      expect(s.readSnapshot).toHaveBeenCalledOnce();
      expect(s.recovery).toHaveBeenCalledOnce();
      expect(s.recovery).toHaveBeenCalledWith(9, s.guard);
      expect(before).toEqual(snapshot());
      safeStatus(status);
      s.expectNoImport();
    }
  );

  it("guards store construction, snapshot, transaction authority and final result in order", async () => {
    const s = setup();
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(s.service.recoverEmptyInitialImport).toHaveLength(0);
    expect(s.events).toEqual([]);
    expect(await s.recover()).toBe("recovered");
    expect(s.events).toEqual([
      "guard",
      "store",
      "guard",
      "guard",
      "snapshot",
      "guard",
      "guard",
      "recovery",
      "guard",
      "guard",
    ]);
    expect(s.guard).toHaveBeenCalledTimes(7);
    expect(process.env.DATABASE_URL).toBeUndefined();
    s.expectNoImport();
  });

  it.each([undefined, false, 1])(
    "rejects native/non-strict initial-publication mode %s before store or source",
    async onlyInitialPublication => {
      const s = setup({
        onlyInitialPublication:
          onlyInitialPublication as HqLiveServiceOptions["onlyInitialPublication"],
      });
      await expect(s.recover()).rejects.toMatchObject({
        code: "CONFIG_INVALID",
      });
      expect(s.guard).not.toHaveBeenCalled();
      expect(s.createStore).not.toHaveBeenCalled();
      s.expectNoImport();
    }
  );

  it.each([undefined, null, true])(
    "rejects missing/nonfunction mandatory guard %s before store or source",
    async initialImportGuard => {
      const s = setup({
        initialImportGuard:
          initialImportGuard as HqLiveServiceOptions["initialImportGuard"],
      });
      await expect(s.recover()).rejects.toMatchObject({
        code: "CONFIG_INVALID",
      });
      expect(s.createStore).not.toHaveBeenCalled();
      s.expectNoImport();
    }
  );

  it.each([
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_LIVE_SYNC_ENABLED: "TRUE" },
    { HQ_LIVE_READ_ENABLED: "FALSE" },
    { HQ_PORTAL_SYNC_TOKEN: undefined },
    { HQ_ORBIT_REPORTING_API_KEY: "short" },
    { HQ_LIVE_INTERVAL_SECONDS: "0" },
    { HQ_LIVE_FRESHNESS_SECONDS: "900.0" },
  ])(
    "rejects strict configuration failure %j before store or source",
    async env => {
      const s = setup({ config: createHqLiveConfig(settings(env)) });
      await expect(s.recover()).rejects.toBeInstanceOf(HqLiveError);
      expect(s.createStore).not.toHaveBeenCalled();
      expect(s.guard).not.toHaveBeenCalled();
      s.expectNoImport();
    }
  );

  it.each([
    { configured: 1 },
    { syncEnabled: 1 },
    { readEnabled: undefined },
    { configurationCode: "CONFIG_INVALID" },
  ])("rejects non-strict configuration projection %j", async overrides => {
    const s = setup();
    vi.spyOn(s.config, "status").mockReturnValue({
      ...s.config.status(),
      ...overrides,
    } as HqLiveConfigurationStatus);
    await expect(s.recover()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(s.createStore).not.toHaveBeenCalled();
    s.expectNoImport();
  });

  it.each([undefined, null, true])(
    "optional missing/nonfunction store method %s fails closed without work",
    async method => {
      const s = setup();
      s.store.recoverEmptyInitialImport =
        method as RecoveryStore["recoverEmptyInitialImport"];
      expect(await s.recover()).toBe("not_recoverable");
      expect(s.readSnapshot).toHaveBeenCalledOnce();
      expect(s.recovery).not.toHaveBeenCalled();
      s.expectNoImport();
    }
  );

  it("requires an existing control row, not an entirely empty store", async () => {
    const s = setup({}, snapshot({ control: null }));
    expect(await s.recover()).toBe("not_recoverable");
    expect(s.recovery).not.toHaveBeenCalled();
    s.expectNoImport();
  });

  it.each<Partial<HqLiveControl>>([
    { stageStatus: "idle" },
    { stageStatus: "running" },
    { stageStatus: "progress" },
    { stageStatus: "applied" },
    { stageStatus: "backoff" },
    { lastErrorCode: null },
    { lastErrorCode: "INVALID_PAYLOAD" },
    { consecutiveFailures: 0 },
    { consecutiveFailures: 2 },
    { lastSuccessAtMs: 1000 },
    { lastPublishAtMs: 1000 },
  ])(
    "rejects non-first-attention or historical-success control %j",
    async changes => {
      const s = setup({}, snapshot({ control: control(changes) }));
      expect(await s.recover()).toBe("not_recoverable");
      expect(s.recovery).not.toHaveBeenCalled();
      s.expectNoImport();
    }
  );

  it.each(["empty", "stage", "published"] as const)(
    "rejects a present %s sync container, not merely unpublished data",
    async kind => {
      const s = setup({}, snapshot({ sync: syntheticSync(kind) }));
      expect(await s.recover()).toBe("not_recoverable");
      expect(s.recovery).not.toHaveBeenCalled();
      s.expectNoImport();
    }
  );

  it("rejects an omitted sync value instead of treating undefined as absent", async () => {
    const s = setup();
    s.readSnapshot.mockResolvedValue({
      ...snapshot(),
      sync: undefined,
    } as unknown as HqLiveSnapshot);
    expect(await s.recover()).toBe("not_recoverable");
    expect(s.recovery).not.toHaveBeenCalled();
    s.expectNoImport();
  });

  it("passes the observed control version exactly, not fencing or sync defaults", async () => {
    const s = setup(
      {},
      snapshot({ control: control({ version: 213, fencingNumber: 47 }) })
    );
    expect(await s.recover()).toBe("recovered");
    expect(s.recovery).toHaveBeenCalledOnce();
    expect(s.recovery).toHaveBeenCalledWith(213, s.guard);
    s.expectNoImport();
  });

  it.each([
    "applied",
    "already_complete",
    { status: "recovered", rows: "SYNTHETIC" },
    null,
  ])("unexpected injected store status %j remains closed", async status => {
    const s = setup();
    s.recovery.mockResolvedValue(status as RecoveryStatus);
    expect(await s.recover()).toBe("not_recoverable");
    s.expectNoImport();
  });

  it.each([1, 2, 3, 4, 5, 6, 7])(
    "fresh authority denial at guard boundary %i rejects, never returns healthy",
    async deniedBoundary => {
      const s = setup();
      let calls = 0;
      s.guard.mockImplementation(async () => {
        if (++calls === deniedBoundary) throw new HqLiveError("AUTH_DENIED");
      });
      await expect(s.recover()).rejects.toMatchObject({ code: "AUTH_DENIED" });
      expect(s.createStore).toHaveBeenCalledTimes(deniedBoundary > 1 ? 1 : 0);
      expect(s.readSnapshot).toHaveBeenCalledTimes(deniedBoundary > 3 ? 1 : 0);
      expect(s.recovery).toHaveBeenCalledTimes(deniedBoundary > 5 ? 1 : 0);
      s.expectNoImport();
    }
  );

  it.each(["store", "snapshot", "recovery"] as const)(
    "post-await authority rejection wins over failed %s work",
    async boundary => {
      const s = setup();
      let active = true;
      s.guard.mockImplementation(async () => {
        if (!active) throw new HqLiveError("AUTH_DENIED");
      });
      const fail = async () => {
        active = false;
        throw new Error("SELECT SYNTHETIC-PRIVATE-PAYLOAD raw failure");
      };
      if (boundary === "store") s.createStore.mockImplementation(fail as never);
      if (boundary === "snapshot") s.readSnapshot.mockImplementation(fail);
      if (boundary === "recovery") s.recovery.mockImplementation(fail);
      await expect(s.recover()).rejects.toMatchObject({ code: "AUTH_DENIED" });
      s.expectNoImport();
    }
  );

  it("mandatory transaction authority rejects before its synthetic mutation", async () => {
    const s = setup();
    let active = true;
    let writes = 0;
    s.guard.mockImplementation(async () => {
      if (!active) throw new HqLiveError("AUTH_DENIED");
    });
    s.recovery.mockImplementation(async (_version, authority) => {
      active = false;
      await authority();
      writes++;
      return "recovered";
    });
    await expect(s.recover()).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(writes).toBe(0);
    s.expectNoImport();
  });

  it.each(Object.keys(settings()))(
    "latched fresh final guard rejects raw setting drift in %s",
    async name => {
      const env = settings();
      const latched = { ...env };
      const s = setup();
      s.guard.mockImplementation(async () => {
        if (Object.keys(latched).some(key => env[key] !== latched[key]))
          throw new HqLiveError("CONFIG_INVALID");
      });
      s.recovery.mockImplementation(async (_version, authority) => {
        await authority();
        env[name] = "changed-after-transaction-authority";
        return "recovered";
      });
      await expect(s.recover()).rejects.toMatchObject({
        code: "CONFIG_INVALID",
      });
      expect(s.recovery).toHaveBeenCalledOnce();
      s.expectNoImport();
    }
  );

  it("preserves original rejected await when post-authority still succeeds", async () => {
    const s = setup();
    const error = new HqLiveError("STORE_UNAVAILABLE");
    s.readSnapshot.mockRejectedValue(error);
    await expect(s.recover()).rejects.toBe(error);
    expect(s.guard).toHaveBeenCalledTimes(4);
    expect(s.recovery).not.toHaveBeenCalled();
    s.expectNoImport();
  });

  it("keeps existing service mocks compatible with the optional recovery API", () => {
    const service: HqLiveService = {
      configurationStatus: () => createHqLiveConfig(settings()).status(),
      authorizeTrigger: () => false,
      invoke: async () => ({ status: "notdue" }),
      readPublished: async () => null,
      readValidationSnapshot: async () => null,
      getStatus: async () => {
        throw new Error("status forbidden");
      },
    };
    expect(service.recoverEmptyInitialImport).toBeUndefined();
  });
});
