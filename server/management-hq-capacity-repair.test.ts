import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HQ_INITIAL_CAPACITY_REPAIR_MESSAGES } from "../shared/management-hq-capacity-repair";
import { repairHqInitialCapacity } from "./management-hq-capacity-repair";
import { createHqLiveConfig } from "./management-hq-live-config";
import { HqLiveError } from "./management-hq-live-store";
import type { HqLiveServiceOptions } from "./management-hq-live-service";
import { createHqLiveService } from "./management-hq-live-service";
import type {
  HqLiveControl,
  HqLiveSnapshot,
  HqLiveStore,
} from "./management-hq-live-store";
import type { HqProgressSnapshot } from "./management-hq-progress";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DRIZZLE_DATABASE_URL;
});
const NOW = "2026-11-24T21:00:00.000Z";
const PRIVATE =
  "SYNTHETIC-private-key customer@example.test https://private.test?token=private SELECT private_payload";
const settings = (): NodeJS.ProcessEnv => ({
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://orbit.thejltgroup.co.uk/api/reporting/v1",
  HQ_ORBIT_REPORTING_API_KEY: "SYNTHETIC-KEY-" + "a".repeat(32),
  HQ_PORTAL_SYNC_TOKEN: "SYNTHETIC-TOKEN-" + "b".repeat(32),
});
const settingKeys = [
  "HQ_ORBIT_REPORTING_BASE_URL",
  "HQ_ORBIT_REPORTING_API_KEY",
  "HQ_PORTAL_SYNC_TOKEN",
  "HQ_LIVE_SYNC_ENABLED",
  "HQ_LIVE_READ_ENABLED",
  "HQ_LIVE_INTERVAL_SECONDS",
  "HQ_LIVE_FRESHNESS_SECONDS",
] as const;
function restore(
  env: NodeJS.ProcessEnv,
  key: string,
  value: string | undefined
) {
  if (value === undefined) delete env[key];
  else env[key] = value;
}
function safe(value: unknown) {
  expect(Object.keys(value as object).sort()).toEqual([
    "checkedAt",
    "errorCode",
    "message",
    "status",
  ]);
  expect(value).toMatchObject({ checkedAt: NOW, message: expect.any(String) });
  const dto = value as {
    status: keyof typeof HQ_INITIAL_CAPACITY_REPAIR_MESSAGES;
    message: string;
  };
  expect(dto.message).toBe(HQ_INITIAL_CAPACITY_REPAIR_MESSAGES[dto.status]);
  expect(JSON.stringify(value)).not.toMatch(
    /SYNTHETIC|private-key|customer@|https?:|SELECT|private_payload|bookingRef|rawrows|sourceFingerprint|leaseToken|apiKey|syncToken|resumeCursor|nextCursor|controlVersion|syncVersion|stateVersion|fromControlVersion|initialStagedResume|initialCapacityRepair|initialRecovery|audit|sha256|[a-f0-9]{64}/i
  );
}
let transport: ReturnType<typeof vi.fn>;
let forbiddenCalls: Array<ReturnType<typeof vi.fn>>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  forbiddenCalls = [];
  transport = vi.fn(() => {
    throw new Error(PRIVATE);
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  expect(transport).not.toHaveBeenCalled();
  for (const fn of forbiddenCalls) expect(fn).not.toHaveBeenCalled();
  expect(process.env.DATABASE_URL).toBeUndefined();
  expect(process.env.DRIZZLE_DATABASE_URL).toBeUndefined();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup() {
  const env = settings();
  const guard = vi.fn(async () => {});
  const resume = vi.fn<() => Promise<unknown>>(async () => "repaired");
  const forbidden = {
    invoke: vi.fn(),
    complete: vi.fn(),
    readPublished: vi.fn(),
    readValidationSnapshot: vi.fn(),
    getStatus: vi.fn(),
    recoverEmptyInitialImport: vi.fn(),
    resumeStagedInitialImport: vi.fn(),
  };
  forbiddenCalls.push(...Object.values(forbidden));
  for (const fn of Object.values(forbidden))
    fn.mockImplementation(() => {
      throw new Error(PRIVATE);
    });
  const factory = vi.fn(
    (_options: HqLiveServiceOptions) =>
      ({
        repairInitialCapacity: resume,
        ...forbidden,
      }) as any
  );
  const run = () =>
    repairHqInitialCapacity({ env, guard, createService: factory });
  return { env, guard, resume, forbidden, factory, run };
}

describe("protected initial capacity repair helper", () => {
  it("publishes exactly six fixed status messages without storage/private metadata", () => {
    expect(Object.keys(HQ_INITIAL_CAPACITY_REPAIR_MESSAGES).sort()).toEqual([
      "busy",
      "invalid_settings",
      "needs_attention",
      "not_repairable",
      "notdue",
      "repaired",
    ]);
    expect(
      new Set(Object.values(HQ_INITIAL_CAPACITY_REPAIR_MESSAGES)).size
    ).toBe(6);
    for (const [status, message] of Object.entries(
      HQ_INITIAL_CAPACITY_REPAIR_MESSAGES
    )) {
      expect(message).toEqual(expect.any(String));
      expect(message.length).toBeGreaterThan(20);
      safe({ status, message, checkedAt: NOW, errorCode: null });
    }
  });
  it("constructs a new initial-only service and binding guard for each request", async () => {
    const s = setup();
    expect((await s.run()).status).toBe("repaired");
    expect((await s.run()).status).toBe("repaired");
    expect(s.factory).toHaveBeenCalledTimes(2);
    const [first, second] = s.factory.mock.calls.map(([options]) => options);
    expect(first).not.toBe(second);
    expect(first.initialImportGuard).not.toBe(second.initialImportGuard);
    for (const options of [first, second]) {
      expect(Object.keys(options).sort()).toEqual([
        "config",
        "initialImportGuard",
        "onlyInitialPublication",
      ]);
      expect(options.onlyInitialPublication).toBe(true);
      expect(options.acceleratedInitialImport).toBeUndefined();
      expect(options.initialImportCpuBindingGuard).toBeUndefined();
    }
  });
  it.each(["repaired", "notdue", "busy", "not_repairable"])(
    "maps only fixed %s status with an exact private-free DTO",
    async status => {
      const s = setup();
      s.resume.mockResolvedValue(status);
      const result = await s.run();
      expect(result.status).toBe(status);
      expect(result.errorCode).toBeNull();
      safe(result);
      expect(s.factory).toHaveBeenCalledOnce();
      expect(s.factory.mock.calls[0][0]).toMatchObject({
        onlyInitialPublication: true,
        initialImportGuard: expect.any(Function),
      });
      expect(Object.keys(s.factory.mock.calls[0][0]).sort()).toEqual([
        "config",
        "initialImportGuard",
        "onlyInitialPublication",
      ]);
      expect(s.resume).toHaveBeenCalledOnce();
      expect(s.resume).toHaveBeenCalledWith();
      Object.values(s.forbidden).forEach(fn =>
        expect(fn).not.toHaveBeenCalled()
      );
      expect(s.guard.mock.calls.length).toBeGreaterThanOrEqual(4);
      if (status === "repaired") {
        expect(result.message).toMatch(/preserv|saved progress/i);
        expect(result.message).toMatch(/no import batch/i);
        expect(result.message).toMatch(/finish first import/i);
      }
    }
  );
  it.each([
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_SYNC_ENABLED: "TRUE" },
    { HQ_LIVE_SYNC_ENABLED: "1" },
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_LIVE_READ_ENABLED: "0" },
    { HQ_PORTAL_SYNC_TOKEN: undefined },
    { HQ_PORTAL_SYNC_TOKEN: "short" },
    { HQ_ORBIT_REPORTING_BASE_URL: undefined },
    { HQ_ORBIT_REPORTING_BASE_URL: "https://private.test/api/reporting/v1" },
    { HQ_ORBIT_REPORTING_API_KEY: undefined },
    { HQ_ORBIT_REPORTING_API_KEY: "short" },
    { HQ_LIVE_INTERVAL_SECONDS: "0" },
    { HQ_LIVE_FRESHNESS_SECONDS: "NaN" },
  ])(
    "settings %j construct no service but still check authority",
    async patch => {
      const s = setup();
      Object.assign(s.env, patch);
      const result = await s.run();
      expect(result.status).toBe("invalid_settings");
      expect(["CONFIG_INVALID", "CONFIG_INCOMPLETE"]).toContain(
        result.errorCode
      );
      safe(result);
      expect(s.factory).not.toHaveBeenCalled();
      expect(s.resume).not.toHaveBeenCalled();
      expect(s.guard.mock.calls.length).toBeGreaterThanOrEqual(2);
    }
  );
  it("uses an explicit server config without constructing a source reader", async () => {
    const s = setup();
    const config = createHqLiveConfig(s.env);
    const createReader = vi.fn(() => {
      throw new Error(PRIVATE);
    });
    const explicit = { ...config, createReader };
    const result = await repairHqInitialCapacity({
      env: s.env,
      config: explicit,
      guard: s.guard,
      createService: s.factory,
    });
    expect(result.status).toBe("repaired");
    expect(s.factory.mock.calls[0][0].config).toBe(explicit);
    expect(createReader).not.toHaveBeenCalled();
    safe(result);
  });
  it.each([undefined, null, "not-a-method"])(
    "fails closed for absent/noncallable service capacity repair %s",
    async method => {
      const s = setup();
      s.factory.mockReturnValue({
        ...s.forbidden,
        repairInitialCapacity: method,
      } as any);
      const result = await s.run();
      expect(result.status).toBe("not_repairable");
      expect(result.errorCode).toBeNull();
      safe(result);
      Object.values(s.forbidden).forEach(fn =>
        expect(fn).not.toHaveBeenCalled()
      );
    }
  );
  it.each(
    [
      undefined,
      null,
      true,
      false,
      0,
      [],
      {},
      "recovered",
      "not_recoverable",
      "invalid_settings",
      "needs_attention",
      "REPAIRED",
      PRIVATE,
      {
        status: "repaired",
        errorCode: PRIVATE,
        message: PRIVATE,
        rawrows: [{ bookingRef: PRIVATE }],
        audit: {
          fromControlVersion: 9,
          syncVersion: 9,
          sha256: "a".repeat(64),
          resumeCursor: PRIVATE,
        },
      },
    ].map(value => ({ value }))
  )("rejects malformed service response %j", async ({ value }) => {
    const s = setup();
    s.resume.mockResolvedValue(value);
    const result = await s.run();
    expect(result.status).toBe("needs_attention");
    expect(result.errorCode).toBe("STORE_UNAVAILABLE");
    safe(result);
  });
  it.each([
    new Error(PRIVATE),
    PRIVATE,
    { code: "STATE_BYTE_CAP_EXCEEDED", message: PRIVATE, audit: PRIVATE },
    new HqLiveError(PRIVATE as any),
  ])("sanitizes untrusted thrown service error %#", async error => {
    const s = setup();
    s.resume.mockRejectedValue(error);
    const result = await s.run();
    expect(result.status).toBe("needs_attention");
    expect(result.errorCode).toBe("STORE_UNAVAILABLE");
    safe(result);
  });
  it.each([
    "STORE_UNAVAILABLE",
    "STATE_BYTE_CAP_EXCEEDED",
    "INVALID_PERSISTED_STATE",
  ] as const)("returns only fixed allowlisted HqLiveError %s", async code => {
    const s = setup();
    const error = new HqLiveError(code);
    error.message = PRIVATE;
    s.resume.mockRejectedValue(error);
    const result = await s.run();
    expect(result.status).toBe("needs_attention");
    expect(result.errorCode).toBe(code);
    safe(result);
  });
  it("sanitizes a mutated HqLiveError code rather than trusting its class", async () => {
    const s = setup();
    const error = new HqLiveError("STORE_UNAVAILABLE");
    Object.assign(error, { code: PRIVATE, message: PRIVATE });
    s.resume.mockRejectedValue(error);
    const result = await s.run();
    expect(result.status).toBe("needs_attention");
    expect(result.errorCode).toBe("STORE_UNAVAILABLE");
    safe(result);
  });
  it("sanitizes a service factory failure and still runs the final authority gate", async () => {
    const s = setup();
    s.factory.mockImplementation(() => {
      throw new Error(PRIVATE);
    });
    const result = await s.run();
    expect(result.status).toBe("needs_attention");
    expect(result.errorCode).toBe("STORE_UNAVAILABLE");
    expect(s.guard.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(s.resume).not.toHaveBeenCalled();
    safe(result);
  });
  it.each([undefined, null, false, "guard"])(
    "requires callable guard %s before service work",
    async guard => {
      const s = setup();
      await expect(
        repairHqInitialCapacity({
          env: s.env,
          guard: guard as any,
          createService: s.factory,
        })
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(s.factory).not.toHaveBeenCalled();
      expect(s.resume).not.toHaveBeenCalled();
    }
  );
  it("latches the first failed authority await despite later restored authority", async () => {
    const s = setup();
    const first = new Error(PRIVATE);
    s.guard.mockRejectedValueOnce(first).mockResolvedValue(undefined);
    await expect(s.run()).rejects.toBe(first);
    expect(s.guard.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(s.factory).not.toHaveBeenCalled();
  });
  it("checks fresh authority even when initial settings are invalid", async () => {
    const s = setup();
    s.env.HQ_LIVE_READ_ENABLED = "true";
    const denied = new Error(PRIVATE);
    s.guard.mockRejectedValueOnce(denied).mockResolvedValue(undefined);
    await expect(s.run()).rejects.toBe(denied);
    expect(s.factory).not.toHaveBeenCalled();
  });
  it("denies authority lost during service creation before calling capacity repair", async () => {
    const s = setup();
    const denied = new Error(PRIVATE);
    s.factory.mockImplementation(() => {
      s.guard.mockRejectedValueOnce(denied).mockResolvedValue(undefined);
      return { repairInitialCapacity: s.resume } as any;
    });
    await expect(s.run()).rejects.toBe(denied);
    expect(s.resume).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "denies revoked authority after successful=%s service await",
    async success => {
      const s = setup();
      const denied = new Error(PRIVATE);
      s.resume.mockImplementation(async () => {
        s.guard.mockRejectedValueOnce(denied).mockResolvedValue(undefined);
        if (!success) throw new Error(PRIVATE);
        return "repaired";
      });
      await expect(s.run()).rejects.toBe(denied);
      expect(s.guard.mock.calls.length).toBeGreaterThanOrEqual(4);
    }
  );
  it("the final DTO gate suppresses a previously verified result", async () => {
    const s = setup();
    const denied = new Error(PRIVATE);
    let afterService = false,
      gates = 0;
    s.resume.mockImplementation(async () => {
      afterService = true;
      return "repaired";
    });
    s.guard.mockImplementation(async () => {
      if (afterService && ++gates === 2) throw denied;
    });
    await expect(s.run()).rejects.toBe(denied);
    expect(gates).toBe(2);
  });
  it("a swallowed service guard failure stays denied after actor restoration", async () => {
    const s = setup();
    const denied = new Error(PRIVATE);
    s.resume.mockImplementation(async () => {
      s.guard.mockRejectedValueOnce(denied).mockResolvedValue(undefined);
      await expect(
        s.factory.mock.calls[0][0].initialImportGuard!()
      ).rejects.toBe(denied);
      return "repaired";
    });
    await expect(s.run()).rejects.toBe(denied);
  });
  it.each(settingKeys)(
    "latches %s pre-await drift restored during authority await",
    async key => {
      const s = setup();
      const original = s.env[key];
      let changed = false,
        restored = false;
      s.resume.mockImplementation(async () => {
        s.env[key] = "changed";
        changed = true;
        return "repaired";
      });
      s.guard.mockImplementation(async () => {
        if (changed) {
          restore(s.env, key, original);
          restored = true;
        }
      });
      await expect(s.run()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(restored).toBe(true);
      expect(s.env[key]).toBe(original);
    }
  );
  it.each(settingKeys)(
    "latches %s post-await drift even when next authority restores it",
    async key => {
      const s = setup();
      const original = s.env[key];
      let calls = 0;
      s.guard.mockImplementation(async () => {
        if (++calls === 1) s.env[key] = "changed";
        else restore(s.env, key, original);
      });
      await expect(s.run()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(s.env[key]).toBe(original);
      expect(s.factory).not.toHaveBeenCalled();
      expect(calls).toBeGreaterThanOrEqual(2);
    }
  );
  it.each(settingKeys)(
    "failed service await cannot hide restored %s rotation",
    async key => {
      const s = setup();
      const original = s.env[key];
      let changed = false;
      s.resume.mockImplementation(async () => {
        s.env[key] = "changed";
        changed = true;
        throw new Error(PRIVATE);
      });
      s.guard.mockImplementation(async () => {
        if (changed) restore(s.env, key, original);
      });
      await expect(s.run()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(s.env[key]).toBe(original);
    }
  );
  it("binding failure does not skip fresh authority and permanently keeps the first denial", async () => {
    const s = setup();
    let changed = false;
    s.resume.mockImplementation(async () => {
      s.env.HQ_PORTAL_SYNC_TOKEN = "changed";
      changed = true;
      return "repaired";
    });
    s.guard.mockImplementation(async () => {
      if (changed) throw new Error(PRIVATE);
    });
    await expect(s.run()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(s.guard.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
  it.each(
    settingKeys.flatMap(key => [true, false].map(success => ({ key, success })))
  )(
    "latches $key post-authority drift after service success=$success despite later restoration",
    async ({ key, success }) => {
      const s = setup();
      const original = s.env[key];
      let operationDone = false,
        afterOperationGates = 0;
      s.resume.mockImplementation(async () => {
        operationDone = true;
        if (!success) throw new Error(PRIVATE);
        return "repaired";
      });
      s.guard.mockImplementation(async () => {
        if (!operationDone) return;
        if (++afterOperationGates === 1) s.env[key] = "changed";
        else restore(s.env, key, original);
      });
      await expect(s.run()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(afterOperationGates).toBeGreaterThanOrEqual(2);
      expect(s.env[key]).toBe(original);
      expect(s.resume).toHaveBeenCalledOnce();
    }
  );
});

// Real service, injected offline store. Atomic repair success is mocked here;
// this suite makes no SQL/chunk cold-validation or actual-source success claim.
function repairControl(patch: Partial<HqLiveControl> = {}): HqLiveControl {
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
    ...patch,
  };
}
function realServiceSetup(options: HqLiveServiceOptions = {}) {
  const events: string[] = [];
  const observation: HqProgressSnapshot = {
    payloadIntegrity: "unchecked",
    control: repairControl(),
    stateVersion: 9,
    hasPublished: false,
    progress: null,
    databaseNowMs: 2000,
  };
  const guard = vi.fn(async () => {
    events.push("guard");
  });
  const forbidden = vi.fn(async () => {
    throw new Error(PRIVATE);
  });
  const reader = vi.fn(() => {
    throw new Error(PRIVATE);
  });
  forbiddenCalls.push(forbidden, reader);
  const readSnapshot = vi.fn<() => Promise<HqLiveSnapshot>>(async () => {
    events.push("snapshot");
    throw new Error(
      "Full root/chunk reads forbidden before atomic cold validation"
    );
  });
  const readProgress = vi.fn(async () => {
    events.push("progress");
    return observation;
  });
  const repair = vi.fn(
    async (
      _controlVersion: number,
      _syncVersion: number,
      authority: () => Promise<void>
    ): Promise<"repaired" | "notdue" | "busy" | "not_repairable"> => {
      events.push("repair");
      await authority();
      return "repaired";
    }
  );
  const store: HqLiveStore = {
    readSnapshot,
    readProgressSnapshot: readProgress,
    readPublished: forbidden,
    acquire: forbidden,
    acquireInitialPublication: forbidden,
    renew: forbidden,
    complete: forbidden,
    recoverEmptyInitialImport: forbidden,
    resumeStagedInitialImport: forbidden,
    fencedSyncStore: vi.fn(() => {
      throw new Error(PRIVATE);
    }),
    repairInitialCapacity: repair,
  };
  forbiddenCalls.push(store.fencedSyncStore as ReturnType<typeof vi.fn>);
  const createStore = vi.fn(() => {
    events.push("store");
    return store;
  });
  const service = createHqLiveService({
    config: createHqLiveConfig(settings()),
    createStore,
    createReader: reader,
    onlyInitialPublication: true,
    initialImportGuard: guard,
    ...options,
  });
  const sourceMethods = [
    vi.spyOn(service, "invoke"),
    vi.spyOn(service, "readPublished"),
    vi.spyOn(service, "readValidationSnapshot"),
    vi.spyOn(service, "getStatus"),
  ];
  return {
    observation,
    guard,
    store,
    createStore,
    readSnapshot,
    readProgress,
    repair,
    service,
    events,
    run: () => service.repairInitialCapacity!(),
    noSource: () => {
      expect(forbidden).not.toHaveBeenCalled();
      expect(reader).not.toHaveBeenCalled();
      expect(store.fencedSyncStore).not.toHaveBeenCalled();
      for (const method of sourceMethods) expect(method).not.toHaveBeenCalled();
    },
  };
}

describe("real initial-only capacity repair service with offline store", () => {
  it.each(["repaired", "notdue", "busy", "not_repairable"] as const)(
    "passes exact cheap-observation versions for %s without full state reads",
    async status => {
      const s = realServiceSetup();
      const before = JSON.stringify(s.observation);
      s.repair.mockResolvedValue(status);
      expect(await s.run()).toBe(status);
      expect(s.readProgress).toHaveBeenCalledOnce();
      expect(s.readProgress).toHaveBeenCalledWith();
      expect(s.readSnapshot).not.toHaveBeenCalled();
      expect(s.repair).toHaveBeenCalledOnce();
      expect(s.repair).toHaveBeenCalledWith(17, 9, s.guard);
      expect(s.service.repairInitialCapacity).toHaveLength(0);
      expect(JSON.stringify(s.observation)).toBe(before);
      s.noSource();
    }
  );
  it("guards before and after store, cheap observation, atomic repair and result", async () => {
    const s = realServiceSetup();
    expect(await s.run()).toBe("repaired");
    expect(s.events).toEqual([
      "guard",
      "guard",
      "store",
      "guard",
      "guard",
      "progress",
      "guard",
      "guard",
      "repair",
      "guard",
      "guard",
    ]);
    expect(s.readSnapshot).not.toHaveBeenCalled();
    s.noSource();
  });
  it.each([
    { onlyInitialPublication: false },
    { onlyInitialPublication: undefined },
    { initialImportGuard: undefined },
    { initialImportGuard: null as never },
  ])("denies missing mandatory first-import fence %j", async options => {
    const s = realServiceSetup(options);
    await expect(s.run()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(s.createStore).not.toHaveBeenCalled();
    expect(s.repair).not.toHaveBeenCalled();
    s.noSource();
  });
  it.each([
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_SYNC_ENABLED: "TRUE" },
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_LIVE_READ_ENABLED: "0" },
    { HQ_ORBIT_REPORTING_API_KEY: "" },
    { HQ_PORTAL_SYNC_TOKEN: "" },
    { HQ_ORBIT_REPORTING_BASE_URL: "https://bad.invalid" },
    { HQ_LIVE_INTERVAL_SECONDS: "0" },
    { HQ_LIVE_FRESHNESS_SECONDS: "invalid" },
  ])("denies invalid/non-sync-on-read-off actual config %j", async patch => {
    const s = realServiceSetup({
      config: createHqLiveConfig({ ...settings(), ...patch }),
    });
    await expect(s.run()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(s.createStore).not.toHaveBeenCalled();
    expect(s.readProgress).not.toHaveBeenCalled();
    expect(s.repair).not.toHaveBeenCalled();
    s.noSource();
  });
  it.each<[string, Partial<HqLiveControl>]>([
    ["semantic failure", { lastErrorCode: "INVALID_SEMANTICS" }],
    ["other terminal error", { lastErrorCode: "PAGE_CAP_EXCEEDED" }],
    ["transient error", { lastErrorCode: "SOURCE_OR_STORE_UNAVAILABLE" }],
    ["no error", { lastErrorCode: null }],
    ["running", { stageStatus: "running" }],
    ["ordinary progress", { stageStatus: "progress" }],
    ["backoff", { stageStatus: "backoff" }],
    ["no failure history", { consecutiveFailures: 0 }],
    ["no saved attempt", { lastAttemptAtMs: null }],
    ["successful history", { lastSuccessAtMs: 900 }],
    ["published history", { lastPublishAtMs: 900 }],
    ["used audit marker", { initialCapacityRepair: {} as never }],
    [
      "malformed present audit marker",
      { initialCapacityRepair: null as never },
    ],
  ])("denies %s without atomic capability", async (_name, patch) => {
    const s = realServiceSetup();
    Object.assign(s.observation.control!, patch);
    expect(await s.run()).toBe("not_repairable");
    expect(s.repair).not.toHaveBeenCalled();
    expect(s.readSnapshot).not.toHaveBeenCalled();
    s.noSource();
  });
  it.each([
    "missing control",
    "missing state version",
    "published",
    "missing repair",
  ])("denies %s without atomic repair or full reads", async kind => {
    const s = realServiceSetup();
    if (kind === "missing control") s.observation.control = null;
    if (kind === "missing state version") s.observation.stateVersion = null;
    if (kind === "published") s.observation.hasPublished = true;
    if (kind === "missing repair") delete s.store.repairInitialCapacity;
    expect(await s.run()).toBe("not_repairable");
    expect(s.repair).not.toHaveBeenCalled();
    expect(s.readSnapshot).not.toHaveBeenCalled();
    s.noSource();
  });
  it.each(["INVALID_PERSISTED_STATE", "STATE_BYTE_CAP_EXCEEDED"] as const)(
    "delegates cold validation for eligible %s without trusting progress counts",
    async code => {
      const s = realServiceSetup();
      s.observation.control!.lastErrorCode = code;
      s.observation.control!.consecutiveFailures = 1;
      s.observation.progress = {
        kind: "backfill",
        phase: "bookings",
        pages: 0,
        recordsRead: 0,
      };
      s.repair.mockResolvedValue("not_repairable");
      expect(await s.run()).toBe("not_repairable");
      expect(s.repair).toHaveBeenCalledWith(17, 9, s.guard);
      expect(s.readSnapshot).not.toHaveBeenCalled();
      s.noSource();
    }
  );
  it("preserves unrelated prior recovery and Resume audit history", async () => {
    const s = realServiceSetup();
    s.observation.control!.initialRecovery = {
      format: "empty-initial-recovery-v1",
      atMs: 500,
      fromControlVersion: 3,
      previousErrorCode: "INVALID_SEMANTICS",
      previousAttemptAtMs: 400,
    };
    s.observation.control!.initialStagedResume = {
      format: "staged-initial-resume-v1",
      atMs: 800,
      fromControlVersion: 5,
      syncVersion: 9,
      previousErrorCode: "STATE_BYTE_CAP_EXCEEDED",
      previousAttemptAtMs: 700,
      previousConsecutiveFailures: 1,
      pages: 1,
      recordsRead: 1,
    };
    const before = JSON.stringify(s.observation);
    expect(await s.run()).toBe("repaired");
    expect(JSON.stringify(s.observation)).toBe(before);
    s.noSource();
  });
  it("uses readSnapshot only when optional cheap progress method is absent", async () => {
    const s = realServiceSetup();
    delete s.store.readProgressSnapshot;
    s.readSnapshot.mockResolvedValue({
      control: s.observation.control,
      sync: { version: 23, published: null, stage: null },
      databaseNowMs: 2000,
    });
    expect(await s.run()).toBe("repaired");
    expect(s.readSnapshot).toHaveBeenCalledOnce();
    expect(s.readProgress).not.toHaveBeenCalled();
    expect(s.repair).toHaveBeenCalledWith(17, 23, s.guard);
    s.noSource();
  });
  it("never falls back to full state after a failed cheap progress await", async () => {
    const s = realServiceSetup();
    const error = new HqLiveError("INVALID_PERSISTED_STATE");
    s.readProgress.mockRejectedValue(error);
    await expect(s.run()).rejects.toBe(error);
    expect(s.readSnapshot).not.toHaveBeenCalled();
    expect(s.repair).not.toHaveBeenCalled();
    s.noSource();
  });
  it.each(
    [
      undefined,
      null,
      {},
      [],
      true,
      4,
      "recovered",
      "resumed",
      PRIVATE,
      {
        status: "repaired",
        message: PRIVATE,
        errorCode: PRIVATE,
        audit: { controlVersion: 17, syncVersion: 9 },
        resumeCursor: PRIVATE,
        rawrows: [{ bookingRef: PRIVATE }],
      },
    ].map(value => ({ value }))
  )(
    "maps malformed private store response %# to not_repairable",
    async ({ value }) => {
      const s = realServiceSetup();
      s.repair.mockResolvedValue(value as never);
      const result = await s.run();
      expect(result).toBe("not_repairable");
      expect(JSON.stringify(result)).not.toMatch(
        /SYNTHETIC|audit|Cursor|bookingRef/
      );
      expect(s.readSnapshot).not.toHaveBeenCalled();
      s.noSource();
    }
  );
  it.each(["store", "progress", "repair"])(
    "rechecks fresh guard after rejected %s await",
    async operation => {
      const s = realServiceSetup();
      const denied = new HqLiveError("AUTH_DENIED");
      const fail = async () => {
        s.guard.mockRejectedValueOnce(denied).mockResolvedValue(undefined);
        throw new Error(PRIVATE);
      };
      if (operation === "store")
        s.createStore.mockImplementation(fail as never);
      if (operation === "progress")
        s.readProgress.mockImplementation(fail as never);
      if (operation === "repair") s.repair.mockImplementation(fail as never);
      await expect(s.run()).rejects.toBe(denied);
      expect(s.readSnapshot).not.toHaveBeenCalled();
      s.noSource();
    }
  );
  it("denies final guard after successful repair despite restored next authority", async () => {
    const s = realServiceSetup();
    const denied = new HqLiveError("AUTH_DENIED");
    s.repair.mockImplementation(async () => {
      s.guard.mockRejectedValueOnce(denied).mockResolvedValue(undefined);
      return "repaired";
    });
    await expect(s.run()).rejects.toBe(denied);
    s.noSource();
  });
  it("denies authority before constructing the store", async () => {
    const s = realServiceSetup();
    s.guard.mockRejectedValue(new HqLiveError("AUTH_DENIED"));
    await expect(s.run()).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(s.createStore).not.toHaveBeenCalled();
    s.noSource();
  });
});
