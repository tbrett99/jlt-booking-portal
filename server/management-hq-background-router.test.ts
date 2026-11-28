import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  db: null as any,
  pool: null as any,
  live: null as any,
  rows: [] as any[],
  authority: vi.fn(),
  onAuthority: null as null | (() => void),
  invoke: vi.fn(),
  services: [] as any[],
  poolHook: null as null | (() => void),
}));
vi.mock("./business-staff-access", () => ({
  getBusinessStaffAuthority: async () => null,
  assertBusinessStaffRouteAllowed: async () => {},
}));
vi.mock("./db", () => ({
  getDb: async () => m.db,
  getRawDbPool: async () => {
    m.poolHook?.();
    return m.pool;
  },
}));
vi.mock("./management-hq-background-pool", () => ({
  getHqBackgroundPool: () => {
    m.poolHook?.();
    return m.pool;
  },
  requireHqBackgroundActor: async () => {
    if (
      m.rows.length !== 1 ||
      m.rows[0].role !== "super_admin" ||
      !m.rows[0].isActive ||
      m.rows[0].portalStatus !== "active"
    )
      throw new Error("Denied");
  },
}));
vi.mock("./management-hq-live-service", async () => {
  const actual = await vi.importActual<any>("./management-hq-live-service");
  return {
    ...actual,
    createHqLiveService: (options: any) => {
      m.services.push(options);
      return {
        getStatus: async () => ({
          ...m.live,
          progress: m.live.progress ? { ...m.live.progress } : null,
        }),
        invoke: m.invoke,
      };
    },
  };
});
import { managementHqRouter } from "./management-hq-router";
import { router } from "./_core/trpc";
import { offlineHqBackgroundPool } from "./management-hq-background-fixture";
import {
  createHqBackgroundStore,
  HQ_BACKGROUND_DATASET_ID,
} from "./management-hq-background-store";
import {
  createHqBackgroundCoordinator,
  hqBackgroundBinding,
} from "./management-hq-background";
const app = router({ managementHq: managementHqRouter });
const user = {
  id: 47,
  role: "super_admin",
  isActive: true,
  portalStatus: "active",
};
const caller = (actor: any = { ...user }) =>
  app.createCaller({ user: actor, req: {}, res: {} } as any).managementHq;
const settings = {
  DATABASE_URL: "mysql://synthetic:synthetic@invalid.invalid/synthetic",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://orbit.thejltgroup.co.uk/api/reporting/v1",
  HQ_ORBIT_REPORTING_API_KEY: "synthetic-key-" + "a".repeat(40),
  HQ_PORTAL_SYNC_TOKEN: "synthetic-token-" + "b".repeat(40),
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_LIVE_INTERVAL_SECONDS: "300",
  HQ_LIVE_FRESHNESS_SECONDS: "900",
  HQ_INITIAL_BACKGROUND_ENABLED: "true",
};
let fixture: ReturnType<typeof offlineHqBackgroundPool>;
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value);
  fixture = offlineHqBackgroundPool();
  m.pool = fixture.pool;
  m.poolHook = null;
  m.rows = [{ ...user }];
  m.onAuthority = null;
  m.services = [];
  m.db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            m.authority();
            m.onAuthority?.();
            return m.rows;
          },
        }),
      }),
    }),
  };
  m.live = {
    configured: true,
    syncEnabled: true,
    readEnabled: false,
    configurationCode: null,
    health: "backoff",
    stageStatus: "backoff",
    hasPublished: false,
    lastErrorCode: "TIMEOUT",
    payloadIntegrity: "unchecked",
    progress: {
      kind: "backfill",
      phase: "catalogue_booking",
      pages: 141,
      recordsRead: 13933,
    },
  };
  m.invoke.mockImplementation(async () => {
    throw new Error("No source import during start/status/pause tests");
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const safe = (value: unknown) =>
  expect(JSON.stringify(value)).not.toMatch(
    /synthetic-key|synthetic-token|mysql:|https:|sourceBinding|actorId|leaseUntil|\"token\"|SELECT|canonicalPayload|bookingRef/
  );

describe("protected background initial-import router", () => {
  it("starts one durable job from saved TIMEOUT backoff without invoking a source, resetting progress or reading reports", async () => {
    const before = JSON.stringify(m.live);
    const result = await caller().startBackgroundInitialImport();
    expect(result).toMatchObject({
      enabled: true,
      job: { status: "queued", attempts: 0, consecutiveErrors: 0 },
    });
    expect(m.invoke).not.toHaveBeenCalled();
    expect(JSON.stringify(m.live)).toBe(before);
    expect(fixture.rows.size).toBe(1);
    expect([...fixture.rows.keys()]).toEqual([HQ_BACKGROUND_DATASET_ID]);
    expect(m.services[0]).toMatchObject({
      onlyInitialPublication: true,
      acceleratedInitialImport: true,
      initialImportGuard: expect.any(Function),
    });
    safe(result);
  });
  it("returns safe persisted status after a new router caller/remount", async () => {
    await caller().startBackgroundInitialImport();
    const result = await caller().backgroundInitialImportStatus();
    expect(result?.job?.status).toBe("queued");
    safe(result);
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("pauses only the background request and leaves saved reporting progress unchanged", async () => {
    await caller().startBackgroundInitialImport();
    const before = JSON.stringify(m.live);
    expect((await caller().pauseBackgroundInitialImport())?.job?.status).toBe(
      "paused"
    );
    expect(JSON.stringify(m.live)).toBe(before);
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("repeated explicit starts cannot create overlapping jobs or extend an active run", async () => {
    const a = await caller().startBackgroundInitialImport();
    const b = await caller().startBackgroundInitialImport();
    expect(a).toEqual(b);
    expect(fixture.rows.size).toBe(1);
  });
  it.each([
    "startBackgroundInitialImport",
    "pauseBackgroundInitialImport",
    "backgroundInitialImportStatus",
  ] as const)(
    "%s requires a void input, not a caller-selected actor, URL, cursor or limits",
    async method => {
      await expect(
        (caller()[method] as any)({
          actorId: 47,
          url: "https://invalid.invalid",
          limit: 1000,
        })
      ).rejects.toThrow();
      expect(fixture.rows.size).toBe(0);
      expect(m.invoke).not.toHaveBeenCalled();
    }
  );
  it.each([
    "startBackgroundInitialImport",
    "pauseBackgroundInitialImport",
    "backgroundInitialImportStatus",
  ] as const)(
    "%s rejects anonymous and non-SuperAdmin callers",
    async method => {
      for (const actor of [
        null,
        { ...user, role: "admin" },
        { ...user, role: "agent" },
      ]) {
        await expect((caller(actor)[method] as any)()).rejects.toThrow();
      }
      expect(fixture.rows.size).toBe(0);
    }
  );
  it.each(["role", "isActive", "portalStatus"])(
    "checks fresh %s rather than trusting the session",
    async field => {
      m.rows = [
        {
          ...user,
          [field]:
            field === "role"
              ? "admin"
              : field === "isActive"
                ? false
                : "cancelled",
        },
      ];
      await expect(caller().startBackgroundInitialImport()).rejects.toThrow();
      expect(fixture.rows.size).toBe(0);
    }
  );
  it.each([
    { hasPublished: true },
    { health: "needs_attention" },
    { stageStatus: "needs_attention" },
    { progress: null },
    { progress: { kind: "catchup", pages: 141, recordsRead: 13933 } },
  ])(
    "refuses ineligible start state %j without touching any job or import",
    async patch => {
      m.live = { ...m.live, ...patch };
      await expect(caller().startBackgroundInitialImport()).rejects.toThrow();
      expect(fixture.rows.size).toBe(0);
    }
  );
  it("default-off status performs fresh authority checks but no job/database-pool or source operations", async () => {
    vi.stubEnv("HQ_INITIAL_BACKGROUND_ENABLED", "false");
    const result = await caller().backgroundInitialImportStatus();
    expect(result).toEqual({ enabled: false, job: null });
    expect(fixture.trace).toEqual([]);
    expect(m.services).toEqual([]);
    expect(m.authority).toHaveBeenCalled();
  });
  it.each(Object.keys(settings))(
    "denies %s rotation across pool acquisition before job writes",
    async key => {
      m.poolHook = () => {
        process.env[key] = settings[key as keyof typeof settings] + "-rotated";
      };
      await expect(caller().startBackgroundInitialImport()).rejects.toThrow();
      expect(fixture.rows.size).toBe(0);
      expect(m.invoke).not.toHaveBeenCalled();
    }
  );
  it("post-UPDATE authority loss rolls back the job-only write", async () => {
    await caller().startBackgroundInitialImport();
    const before = JSON.stringify([...fixture.rows]);
    fixture.setAfterHook((stage: string) => {
      if (stage === "update") m.rows = [{ ...user, isActive: false }];
    });
    await expect(caller().pauseBackgroundInitialImport()).rejects.toThrow();
    expect(JSON.stringify([...fixture.rows])).toBe(before);
  });
  it("blocks manual Finish and Continue while an enabled background request is active", async () => {
    await caller().startBackgroundInitialImport();
    await expect(caller().finishInitialImportBatch()).rejects.toThrow();
    await expect(caller().importInitialBatch()).rejects.toThrow();
    expect(m.invoke).not.toHaveBeenCalled();
    expect(
      (await createHqBackgroundStore(fixture.pool).read()).job?.status
    ).toBe("queued");
  });
  it.each([
    ["finishInitialImportBatch", "missing"],
    ["importInitialBatch", "missing"],
    ["finishInitialImportBatch", "paused"],
    ["importInitialBatch", "paused"],
    ["finishInitialImportBatch", "default_off"],
    ["importInitialBatch", "default_off"],
  ] as const)(
    "%s preserves successful manual admission with %s background state",
    async (method, state) => {
      if (state === "paused") {
        await caller().startBackgroundInitialImport();
        await caller().pauseBackgroundInitialImport();
      }
      if (state === "default_off")
        vi.stubEnv("HQ_INITIAL_BACKGROUND_ENABLED", "false");
      const before = JSON.stringify([...fixture.rows]);
      m.invoke.mockResolvedValue({ status: "progress" });
      const result = await caller()[method]();
      expect(result.status).toBe("progress");
      expect(m.invoke).toHaveBeenCalledTimes(1);
      expect(JSON.stringify([...fixture.rows])).toBe(before);
      if (state === "default_off") expect(fixture.trace).toEqual([]);
      expect(m.services.at(-1)).toMatchObject({
        onlyInitialPublication: true,
        maxSourceMethods: method === "finishInitialImportBatch" ? 25 : 3,
      });
      safe(result);
    }
  );
  it("an expired worker lease projects queued without changing persisted job/import state", async () => {
    await caller().startBackgroundInitialImport();
    await createHqBackgroundStore(fixture.pool).claim(
      hqBackgroundBinding(),
      async () => {}
    );
    fixture.advance(10 * 60 * 1000);
    const before = JSON.stringify([...fixture.rows]);
    expect((await caller().backgroundInitialImportStatus()).job?.status).toBe(
      "queued"
    );
    expect(JSON.stringify([...fixture.rows])).toBe(before);
    expect(
      (await createHqBackgroundStore(fixture.pool).read()).job?.status
    ).toBe("running");
  });
  it("24-hour expiry projects failure and prevents a worker source launch even if initiating authority is revoked", async () => {
    await caller().startBackgroundInitialImport();
    fixture.advance(24 * 60 * 60 * 1000);
    const before = JSON.stringify([...fixture.rows]);
    expect((await caller().backgroundInitialImportStatus()).job).toMatchObject({
      status: "failed",
      lastErrorCode: "SOURCE_EXPIRED",
    });
    const authorize = vi.fn(async () => {
      throw new Error("Revoked");
    });
    expect(
      await createHqBackgroundCoordinator({
        pool: fixture.pool,
        authorize,
      }).run()
    ).toEqual({ status: "failed", batches: 0 });
    expect(authorize).not.toHaveBeenCalled();
    expect(m.invoke).not.toHaveBeenCalled();
    expect(JSON.stringify([...fixture.rows])).toBe(before);
  });
});
