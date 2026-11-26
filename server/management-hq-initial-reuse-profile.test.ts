import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHqLiveConfig } from "./management-hq-live-config";
import { offlineHqV2Pool } from "./management-hq-storage-v2-pool";

const mocks = vi.hoisted(() => ({
  pool: null as unknown,
  createPool: vi.fn(),
  stores: [] as {
    pool: unknown;
    options: {
      cooperativeGuard?: () => Promise<void>;
      cooperativeYieldGuard?: () => Promise<void>;
      validatedInitialReuseScope?: string;
    };
  }[],
}));
vi.mock("mysql2/promise", () => ({
  createPool: mocks.createPool,
}));
vi.mock("./management-hq-live-store", async importOriginal => {
  const original =
    await importOriginal<typeof import("./management-hq-live-store")>();
  return {
    ...original,
    createHqLiveStore: (
      ...args: Parameters<typeof original.createHqLiveStore>
    ) => {
      mocks.stores.push({ pool: args[0], options: args[2] ?? {} });
      return original.createHqLiveStore(...args);
    },
  };
});

const settings = {
  DATABASE_URL: "mysql://offline-only:synthetic@127.0.0.1:9/offline",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://orbit.thejltgroup.co.uk/api/reporting/v1",
  HQ_ORBIT_REPORTING_API_KEY: "offline-only-reuse-key-" + "k".repeat(40),
  HQ_PORTAL_SYNC_TOKEN: "offline-only-reuse-token-" + "t".repeat(40),
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_LIVE_INTERVAL_SECONDS: "300",
  HQ_LIVE_FRESHNESS_SECONDS: "900",
};
const keys = Object.keys(settings) as (keyof typeof settings)[];
const expectedScope = () =>
  createHash("sha256")
    .update(JSON.stringify(keys.map(key => process.env[key])))
    .digest("hex");

beforeEach(() => {
  vi.resetModules();
  mocks.stores.length = 0;
  mocks.createPool.mockReset();
  mocks.pool = offlineHqV2Pool().pool;
  mocks.createPool.mockImplementation(() => mocks.pool);
  for (const key of keys) vi.stubEnv(key, settings[key]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function makeService(accelerated = true) {
  const { createHqLiveService } = await import("./management-hq-live-service");
  const guard = vi.fn(async () => {});
  const cpuBinding = vi.fn(() => {});
  const service = createHqLiveService({
    config: createHqLiveConfig({ ...settings }),
    ...(accelerated
      ? {
          onlyInitialPublication: true,
          acceleratedInitialImport: true,
          initialImportGuard: guard,
          initialImportCpuBindingGuard: cpuBinding,
        }
      : {}),
  });
  await service.getStatus();
  return { service, guard, cpuBinding };
}

describe("initial-only validated reuse production default-store wiring", () => {
  it("creates fresh stores and guard closures for successive services while passing the same opaque scope and shared pool", async () => {
    await makeService();
    await makeService();
    expect(mocks.createPool).toHaveBeenCalledTimes(1);
    expect(mocks.stores).toHaveLength(2);
    const [first, second] = mocks.stores;
    expect(first.pool).toBe(mocks.pool);
    expect(second.pool).toBe(mocks.pool);
    expect(first.options.validatedInitialReuseScope).toBe(expectedScope());
    expect(second.options.validatedInitialReuseScope).toBe(expectedScope());
    expect(first.options.cooperativeGuard).not.toBe(
      second.options.cooperativeGuard
    );
    expect(first.options.cooperativeYieldGuard).not.toBe(
      second.options.cooperativeYieldGuard
    );
    expect(first.options.validatedInitialReuseScope).toMatch(/^[a-f0-9]{64}$/);
    expect(first.options.validatedInitialReuseScope).not.toContain("offline");
  });

  it("does not enable the shared validation slot for native/default store reads", async () => {
    await makeService(false);
    expect(mocks.stores).toHaveLength(1);
    expect(mocks.stores[0].options.validatedInitialReuseScope).toBeUndefined();
    expect(mocks.stores[0].options.cooperativeYieldGuard).toBeUndefined();
  });

  it("does not enable the shared validation slot for the old manual initial profile", async () => {
    const { createHqLiveService } = await import(
      "./management-hq-live-service"
    );
    await createHqLiveService({
      config: createHqLiveConfig({ ...settings }),
      onlyInitialPublication: true,
      initialImportGuard: async () => {},
      maxSourceMethods: 3,
    }).getStatus();
    expect(mocks.stores).toHaveLength(1);
    expect(mocks.stores[0].options.validatedInitialReuseScope).toBeUndefined();
  });

  it.each(keys.filter(key => key !== "DATABASE_URL"))(
    "changes only the opaque reuse identity when raw %s changes between service constructions",
    async key => {
      await makeService();
      const before = mocks.stores[0].options.validatedInitialReuseScope;
      // A fixed injected config isolates the scope identity test from import
      // eligibility. No invocation/source call/write is admitted by this read.
      vi.stubEnv(key, settings[key] + "-rotated");
      await makeService();
      expect(mocks.stores[1].options.validatedInitialReuseScope).toBe(
        expectedScope()
      );
      expect(mocks.stores[1].options.validatedInitialReuseScope).not.toBe(
        before
      );
    }
  );

  it("denies a default database binding change without constructing a second store", async () => {
    await makeService();
    vi.stubEnv("DATABASE_URL", settings.DATABASE_URL + "-rotated");
    const next = await makeService();
    expect(await next.service.getStatus()).toMatchObject({
      health: "needs_attention",
      lastErrorCode: "CONFIG_INVALID",
    });
    expect(mocks.stores).toHaveLength(1);
    expect(mocks.createPool).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed accelerated authority options before a pool or store is constructed", async () => {
    const { createHqLiveService } = await import(
      "./management-hq-live-service"
    );
    expect(() =>
      createHqLiveService({
        config: createHqLiveConfig({ ...settings }),
        acceleratedInitialImport: true,
        onlyInitialPublication: true,
        initialImportGuard: "not-authority" as never,
        initialImportCpuBindingGuard: () => {},
      })
    ).toThrow();
    expect(mocks.stores).toHaveLength(0);
    expect(mocks.createPool).not.toHaveBeenCalled();
  });
});
