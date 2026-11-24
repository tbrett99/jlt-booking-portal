import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import { createHqLiveConfig } from "./management-hq-live-config";
import {
  createHqLiveService,
  type HqLiveServiceOptions,
} from "./management-hq-live-service";
import {
  HqLiveError,
  type HqLiveControl,
  type HqLiveSnapshot,
  type HqLiveStore,
} from "./management-hq-live-store";

type ResumeStatus = "resumed" | "notdue" | "busy" | "not_resumable";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const settings = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_ORBIT_REPORTING_BASE_URL: "https://reporting.probe.tld/api/management-hq",
  HQ_ORBIT_REPORTING_API_KEY: "SYNTHETIC-REPORTING-KEY-" + "a".repeat(32),
  HQ_PORTAL_SYNC_TOKEN: "SYNTHETIC-PORTAL-TOKEN-" + "b".repeat(32),
  ...overrides,
});
let prepared: HqImplementedSyncState;
beforeAll(async () => {
  const memory = createHqImplementedMemoryStore();
  let calls = 0;
  expect(
    (
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        memory,
        { shouldContinue: () => ++calls <= 3 }
      ).sync()
    ).status
  ).toBe("yielded");
  prepared = (await memory.readSync())!;
  expect(prepared.stage!.pages).toBe(1);
  expect(prepared.stage!.recordsRead).toBeGreaterThan(0);
  prepared.version = 9;
});
function initialControl(patch: Partial<HqLiveControl> = {}): HqLiveControl {
  return {
    format: "hq-live-control-v1",
    version: 17,
    sourceFingerprint: "c".repeat(64),
    fencingNumber: 2,
    leaseToken: null,
    leaseExpiresAtMs: null,
    leaseHardExpiresAtMs: null,
    nextDueAtMs: 1000,
    consecutiveFailures: 2,
    lastAttemptAtMs: 1000,
    lastSuccessAtMs: null,
    lastPublishAtMs: null,
    lastErrorCode: "STATE_BYTE_CAP_EXCEEDED",
    stageStatus: "needs_attention",
    initialRecovery: {
      format: "empty-initial-recovery-v1",
      atMs: 900,
      fromControlVersion: 3,
      previousErrorCode: "INVALID_SEMANTICS",
      previousAttemptAtMs: 800,
    },
    ...patch,
  };
}
function setup(options: HqLiveServiceOptions = {}) {
  const events: string[] = [];
  const snapshot: HqLiveSnapshot = {
    control: initialControl(),
    sync: clone(prepared),
    databaseNowMs: 2000,
  };
  const forbidden = vi.fn(async () => {
    throw new Error("source/import/operational work forbidden");
  });
  const reader = vi.fn(() => {
    throw new Error("source reader forbidden");
  });
  const guard = vi.fn(async () => {
    events.push("guard");
  });
  const readSnapshot = vi.fn(async () => {
    events.push("snapshot");
    return clone(snapshot);
  });
  const resume = vi.fn(
    async (
      _controlVersion: number,
      _syncVersion: number,
      authority: () => Promise<void>
    ): Promise<ResumeStatus> => {
      events.push("resume");
      await authority();
      return "resumed";
    }
  );
  const store: HqLiveStore = {
    readSnapshot,
    readPublished: forbidden,
    acquire: forbidden,
    renew: forbidden,
    complete: forbidden,
    fencedSyncStore: vi.fn(() => {
      throw new Error("stage writes forbidden");
    }),
    resumeStagedInitialImport: resume,
    recoverEmptyInitialImport: forbidden,
  };
  const createStore = vi.fn(() => {
    events.push("store");
    return store;
  });
  const config = createHqLiveConfig(settings());
  const service = createHqLiveService({
    config,
    createStore,
    createReader: reader,
    onlyInitialPublication: true,
    initialImportGuard: guard,
    ...options,
  });
  const invoke = vi.spyOn(service, "invoke");
  const getStatus = vi.spyOn(service, "getStatus");
  return {
    snapshot,
    service,
    store,
    guard,
    createStore,
    readSnapshot,
    resume,
    events,
    run: () => service.resumeStagedInitialImport!(),
    noImport: () => {
      expect(forbidden).not.toHaveBeenCalled();
      expect(reader).not.toHaveBeenCalled();
      expect(store.fencedSyncStore).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(getStatus).not.toHaveBeenCalled();
    },
  };
}

describe("initial-only protected staged Resume service", () => {
  it.each<ResumeStatus>(["resumed", "notdue", "busy", "not_resumable"])(
    "passes both observed versions and returns only %s without source work",
    async status => {
      const s = setup();
      const before = clone(s.snapshot);
      s.resume.mockResolvedValue(status);
      expect(await s.run()).toBe(status);
      expect(s.resume).toHaveBeenCalledOnce();
      expect(s.resume).toHaveBeenCalledWith(17, 9, s.guard);
      expect(s.snapshot).toEqual(before);
      expect(s.service.resumeStagedInitialImport).toHaveLength(0);
      s.noImport();
    }
  );
  it("guards preflight, store, snapshot, atomic authority and result in order", async () => {
    const s = setup();
    expect(await s.run()).toBe("resumed");
    expect(s.events).toEqual([
      "guard",
      "guard",
      "store",
      "guard",
      "guard",
      "snapshot",
      "guard",
      "guard",
      "resume",
      "guard",
      "guard",
    ]);
    s.noImport();
  });
  it.each([
    { onlyInitialPublication: false },
    { onlyInitialPublication: undefined },
    { initialImportGuard: undefined },
    { initialImportGuard: null as never },
  ])("refuses a missing mandatory initial-only fence: %j", async options => {
    const s = setup(options);
    await expect(s.run()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(s.createStore).not.toHaveBeenCalled();
    s.noImport();
  });
  it.each([
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_ORBIT_REPORTING_API_KEY: "" },
    { HQ_PORTAL_SYNC_TOKEN: "" },
    { HQ_ORBIT_REPORTING_BASE_URL: "https://bad.invalid" },
  ])("refuses invalid or non-sync-on/read-off settings: %j", async patch => {
    const s = setup({ config: createHqLiveConfig(settings(patch)) });
    await expect(s.run()).rejects.toBeInstanceOf(HqLiveError);
    expect(s.createStore).not.toHaveBeenCalled();
    s.noImport();
  });
  it.each<[string, Partial<HqLiveControl>]>([
    ["wrong error", { lastErrorCode: "INVALID_SEMANTICS" }],
    ["other terminal error", { lastErrorCode: "PAGE_CAP_EXCEEDED" as never }],
    ["no error", { lastErrorCode: null }],
    ["running", { stageStatus: "running" }],
    ["ordinary progress", { stageStatus: "progress" }],
    ["no failures", { consecutiveFailures: 0 }],
    ["no attempt", { lastAttemptAtMs: null }],
    ["prior success", { lastSuccessAtMs: 900 }],
    ["prior publication", { lastPublishAtMs: 900 }],
    ["used Resume", { initialStagedResume: {} as never }],
  ])(
    "denies ineligible control %s without store Resume",
    async (_name, patch) => {
      const s = setup();
      Object.assign(s.snapshot.control!, patch);
      expect(await s.run()).toBe("not_resumable");
      expect(s.resume).not.toHaveBeenCalled();
      s.noImport();
    }
  );
  it.each([
    "missing control",
    "missing sync",
    "empty sync",
    "published",
    "catchup",
    "base publication",
    "no metadata",
    "no pages",
    "no records",
    "missing store seam",
  ])("denies %s without atomic Resume", async kind => {
    const s = setup();
    if (kind === "missing control") s.snapshot.control = null;
    if (kind === "missing sync") s.snapshot.sync = null;
    if (kind === "empty sync") s.snapshot.sync!.stage = null;
    if (kind === "published") s.snapshot.sync!.published = {} as never;
    if (kind === "catchup") s.snapshot.sync!.stage!.kind = "catchup";
    if (kind === "base publication")
      s.snapshot.sync!.stage!.basePublishedVersion = 1;
    if (kind === "no metadata") s.snapshot.sync!.stage!.metadata = null;
    if (kind === "no pages") s.snapshot.sync!.stage!.pages = 0;
    if (kind === "no records") s.snapshot.sync!.stage!.recordsRead = 0;
    if (kind === "missing store seam") delete s.store.resumeStagedInitialImport;
    expect(await s.run()).toBe("not_resumable");
    expect(s.resume).not.toHaveBeenCalled();
    s.noImport();
  });
  it("does not require the old empty recovery marker or hardcode two failures", async () => {
    const s = setup();
    delete s.snapshot.control!.initialRecovery;
    s.snapshot.control!.consecutiveFailures = 1;
    expect(await s.run()).toBe("resumed");
    s.noImport();
  });
  it.each([null, {}, "recovered", "private-token", 4])(
    "never exposes unexpected store result %j",
    async value => {
      const s = setup();
      s.resume.mockResolvedValue(value as never);
      expect(await s.run()).toBe("not_resumable");
      s.noImport();
    }
  );
  it.each(["store", "snapshot", "resume"])(
    "checks authority after a rejected %s await",
    async operation => {
      const s = setup();
      const error = new HqLiveError("AUTH_DENIED");
      const fail = async () => {
        s.guard.mockRejectedValue(error);
        throw new Error("PRIVATE_PROVIDER_SQL_ERROR");
      };
      if (operation === "store")
        s.createStore.mockImplementation(fail as never);
      if (operation === "snapshot")
        s.readSnapshot.mockImplementation(fail as never);
      if (operation === "resume") s.resume.mockImplementation(fail as never);
      await expect(s.run()).rejects.toBe(error);
      s.noImport();
    }
  );
  it("denies authority loss before any store work", async () => {
    const s = setup();
    s.guard.mockRejectedValue(new HqLiveError("AUTH_DENIED"));
    await expect(s.run()).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(s.createStore).not.toHaveBeenCalled();
    s.noImport();
  });
  it("preserves existing source-method and method-start maximums", () => {
    expect(() => setup({ maxSourceMethods: 26 })).toThrow(HqLiveError);
    expect(() => setup({ methodStartDeadlineMs: 75001 })).toThrow(HqLiveError);
  });
});
