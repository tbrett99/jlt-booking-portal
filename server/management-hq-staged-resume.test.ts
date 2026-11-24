import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resumeHqStagedInitialImport } from "./management-hq-staged-resume";
import { createHqLiveConfig } from "./management-hq-live-config";
import { HqLiveError } from "./management-hq-live-store";
import type { HqLiveServiceOptions } from "./management-hq-live-service";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DRIZZLE_DATABASE_URL;
});
const offline = vi.hoisted(() => ({ defaultService: vi.fn() }));
vi.mock("./management-hq-live-service", () => ({
  createHqLiveService: offline.defaultService,
}));
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
  expect(JSON.stringify(value)).not.toMatch(
    /SYNTHETIC|private-key|customer@|https?:|SELECT|private_payload|bookingRef|rawrows|sourceFingerprint|leaseToken|apiKey|syncToken|resumeCursor|nextCursor|controlVersion|syncVersion|stateVersion|fromControlVersion|initialStagedResume|initialRecovery|audit|sha256|[a-f0-9]{64}/i
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
  offline.defaultService.mockReset();
  offline.defaultService.mockImplementation(() => {
    throw new Error("Unexpected default service construction");
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  expect(transport).not.toHaveBeenCalled();
  for (const fn of forbiddenCalls) expect(fn).not.toHaveBeenCalled();
  expect(offline.defaultService).not.toHaveBeenCalled();
  expect(process.env.DATABASE_URL).toBeUndefined();
  expect(process.env.DRIZZLE_DATABASE_URL).toBeUndefined();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup() {
  const env = settings();
  const guard = vi.fn(async () => {});
  const resume = vi.fn<() => Promise<unknown>>(async () => "resumed");
  const forbidden = {
    invoke: vi.fn(),
    complete: vi.fn(),
    readPublished: vi.fn(),
    readValidationSnapshot: vi.fn(),
    getStatus: vi.fn(),
    recoverEmptyInitialImport: vi.fn(),
  };
  forbiddenCalls.push(...Object.values(forbidden));
  for (const fn of Object.values(forbidden))
    fn.mockImplementation(() => {
      throw new Error(PRIVATE);
    });
  const factory = vi.fn(
    (_options: HqLiveServiceOptions) =>
      ({
        resumeStagedInitialImport: resume,
        ...forbidden,
      }) as any
  );
  const run = () =>
    resumeHqStagedInitialImport({ env, guard, createService: factory });
  return { env, guard, resume, forbidden, factory, run };
}

describe("protected staged initial Resume helper", () => {
  it.each(["resumed", "notdue", "busy", "not_resumable"])(
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
      expect(s.resume).toHaveBeenCalledOnce();
      expect(s.resume).toHaveBeenCalledWith();
      Object.values(s.forbidden).forEach(fn =>
        expect(fn).not.toHaveBeenCalled()
      );
      expect(s.guard.mock.calls.length).toBeGreaterThanOrEqual(4);
      if (status === "resumed") {
        expect(result.message).toMatch(/preserv|saved progress/i);
        expect(result.message).toMatch(/no source batch/i);
        expect(result.message).toMatch(/dashboards.*automatic updates.*off/i);
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
    const result = await resumeHqStagedInitialImport({
      env: s.env,
      config: explicit,
      guard: s.guard,
      createService: s.factory,
    });
    expect(result.status).toBe("resumed");
    expect(s.factory.mock.calls[0][0].config).toBe(explicit);
    expect(createReader).not.toHaveBeenCalled();
    safe(result);
  });
  it.each([undefined, null, "not-a-method"])(
    "fails closed for absent/noncallable service Resume %s",
    async method => {
      const s = setup();
      s.factory.mockReturnValue({
        ...s.forbidden,
        resumeStagedInitialImport: method,
      } as any);
      const result = await s.run();
      expect(result.status).toBe("not_resumable");
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
      "RESUMED",
      PRIVATE,
      {
        status: "resumed",
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
        resumeHqStagedInitialImport({
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
  it("denies authority lost during service creation before calling Resume", async () => {
    const s = setup();
    const denied = new Error(PRIVATE);
    s.factory.mockImplementation(() => {
      s.guard.mockRejectedValueOnce(denied).mockResolvedValue(undefined);
      return { resumeStagedInitialImport: s.resume } as any;
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
        return "resumed";
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
      return "resumed";
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
      return "resumed";
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
        return "resumed";
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
      return "resumed";
    });
    s.guard.mockImplementation(async () => {
      if (changed) throw new Error(PRIVATE);
    });
    await expect(s.run()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(s.guard.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
