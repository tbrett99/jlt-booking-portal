import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { recoverHqEmptyInitialImport } from "./management-hq-initial-recovery";
import { HqLiveError } from "./management-hq-live-store";
import type { HqLiveServiceOptions } from "./management-hq-live-service";
vi.hoisted(() => {
  delete process.env.DATABASE_URL;
});
const settings = (): NodeJS.ProcessEnv => ({
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://orbit.thejltgroup.co.uk/api/reporting/v1",
  HQ_ORBIT_REPORTING_API_KEY: "SYNTHETIC-KEY-" + "a".repeat(32),
  HQ_PORTAL_SYNC_TOKEN: "SYNTHETIC-TOKEN-" + "b".repeat(32),
});
const PRIVATE =
  "private-key client@example.test https://private.test SELECT private_payload";
const safe = (v: unknown) =>
  expect(JSON.stringify(v)).not.toMatch(
    /SYNTHETIC|private-key|client@|https:|SELECT|private_payload|lease|sourceFingerprint|items|bookingRef/
  );
let transport: ReturnType<typeof vi.fn>;
beforeEach(() => {
  transport = vi.fn(() => {
    throw new Error(PRIVATE);
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  expect(transport).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(process.env.DATABASE_URL).toBeUndefined();
});
function setup() {
  const env = settings();
  const guard = vi.fn(async () => {});
  const recovery = vi.fn(async () => "recovered");
  const forbidden = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  const factory = vi.fn(
    (options: HqLiveServiceOptions) =>
      ({
        recoverEmptyInitialImport: recovery,
        invoke: forbidden[0],
        readPublished: forbidden[1],
        readValidationSnapshot: forbidden[2],
        getStatus: forbidden[3],
      }) as any
  );
  const run = () =>
    recoverHqEmptyInitialImport({ env, guard, createService: factory });
  return { env, guard, recovery, forbidden, factory, run };
}
describe("approved empty first-import recovery helper", () => {
  it.each(["recovered", "notdue", "busy", "not_recoverable"])(
    "returns only fixed %s DTO without invoking import or reads",
    async status => {
      const s = setup();
      s.recovery.mockResolvedValue(status);
      const r = await s.run();
      expect(r.status).toBe(status);
      expect(Object.keys(r).sort()).toEqual([
        "checkedAt",
        "errorCode",
        "message",
        "status",
      ]);
      safe(r);
      expect(s.factory.mock.calls[0][0]).toMatchObject({
        onlyInitialPublication: true,
        initialImportGuard: expect.any(Function),
      });
      expect(s.recovery).toHaveBeenCalledOnce();
      expect(s.recovery).toHaveBeenCalledWith();
      s.forbidden.forEach(fn => expect(fn).not.toHaveBeenCalled());
    }
  );
  it.each([
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_PORTAL_SYNC_TOKEN: undefined },
    { HQ_ORBIT_REPORTING_BASE_URL: undefined },
    { HQ_ORBIT_REPORTING_API_KEY: "short" },
  ])("strict settings %j construct no service", async patch => {
    const s = setup();
    Object.assign(s.env, patch);
    const r = await s.run();
    expect(r.status).toBe("invalid_settings");
    expect(s.factory).not.toHaveBeenCalled();
    safe(r);
  });
  it("fails closed without a service recovery method", async () => {
    const s = setup();
    s.factory.mockReturnValue({} as any);
    expect((await s.run()).status).toBe("not_recoverable");
  });
  it("maps arbitrary returned values and errors to fixed safe attention", async () => {
    const s = setup();
    s.recovery.mockResolvedValue(PRIVATE);
    const r = await s.run();
    expect(r.status).toBe("needs_attention");
    safe(r);
    s.recovery.mockRejectedValue(new Error(PRIVATE));
    const failed = await s.run();
    expect(failed.errorCode).toBe("STORE_UNAVAILABLE");
    safe(failed);
  });
  it.each([true, false])(
    "denies source-free successful=%s recovery after authority failure",
    async success => {
      const s = setup();
      const denied = new Error(PRIVATE);
      let calls = 0;
      s.guard.mockImplementation(async () => {
        if (++calls === 3) throw denied;
      });
      s.recovery.mockImplementation(async () => {
        if (!success) throw new Error(PRIVATE);
        return "recovered";
      });
      await expect(s.run()).rejects.toBe(denied);
      expect(s.guard.mock.calls.length).toBeGreaterThan(3);
    }
  );
  it.each([
    "HQ_ORBIT_REPORTING_BASE_URL",
    "HQ_ORBIT_REPORTING_API_KEY",
    "HQ_PORTAL_SYNC_TOKEN",
    "HQ_LIVE_SYNC_ENABLED",
    "HQ_LIVE_READ_ENABLED",
    "HQ_LIVE_INTERVAL_SECONDS",
    "HQ_LIVE_FRESHNESS_SECONDS",
  ])(
    "latches %s drift even when restored during authority await",
    async key => {
      const s = setup();
      const original = s.env[key];
      let changed = false,
        restored = false;
      s.recovery.mockImplementation(async () => {
        s.env[key] = "changed";
        changed = true;
        return "recovered";
      });
      s.guard.mockImplementation(async () => {
        if (changed) {
          if (original === undefined) delete s.env[key];
          else s.env[key] = original;
          restored = true;
        }
      });
      await expect(s.run()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(restored).toBe(true);
      expect(s.env[key]).toBe(original);
    }
  );
  it("rejects missing guard before service or source work", async () => {
    const s = setup();
    await expect(
      recoverHqEmptyInitialImport({
        env: s.env,
        guard: undefined as any,
        createService: s.factory,
      })
    ).rejects.toBeInstanceOf(HqLiveError);
    expect(s.factory).not.toHaveBeenCalled();
  });
});
