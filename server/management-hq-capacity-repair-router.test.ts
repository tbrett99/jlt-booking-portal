import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HQ_INITIAL_CAPACITY_REPAIR_MESSAGES } from "../shared/management-hq-capacity-repair";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { users } from "../drizzle/schema";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DRIZZLE_DATABASE_URL;
});
const m = vi.hoisted(() => ({
  getDb: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  fetch: vi.fn(),
  rawPool: vi.fn(),
  mysqlPool: vi.fn(),
  liveService: vi.fn(),
  repair: vi.fn(),
  invoke: vi.fn(),
  complete: vi.fn(),
  recover: vi.fn(),
  stagedResume: vi.fn(),
  readPublished: vi.fn(),
  readValidation: vi.fn(),
  getStatus: vi.fn(),
  sampleStore: vi.fn(),
  importer: vi.fn(),
  report: vi.fn(),
  csv: vi.fn(),
  directory: vi.fn(),
  liveReport: vi.fn(),
  reportMetadata: vi.fn(),
  sample: vi.fn(),
  fresh: {
    id: 47,
    role: "super_admin",
    isActive: true,
    portalStatus: "active",
  },
  helperDone: false,
  onSelect: null as null | (() => void),
  onHelperDone: null as null | (() => void),
}));
vi.mock("./business-staff-access", () => ({
  getBusinessStaffAuthority: async () => null,
  assertBusinessStaffRouteAllowed: async () => undefined,
}));
vi.mock("./db", () => ({ getDb: m.getDb, getRawDbPool: m.rawPool }));
vi.mock("mysql2/promise", () => ({ createPool: m.mysqlPool }));
vi.mock("./management-hq-live-service", () => ({
  createHqLiveService: m.liveService,
}));
vi.mock("./management-hq-store", async () => ({
  ...(await vi.importActual<any>("./management-hq-store")),
  createHqSampleStore: m.sampleStore,
}));
vi.mock("./management-hq-ingestion", () => ({
  createHqImplementedEngine: m.importer,
}));
vi.mock("./management-hq-implemented-fixtures", () => ({
  createHqImplementedSampleDirectory: m.directory,
  runHqImplementedSampleScenario: m.sample,
}));
vi.mock("./management-hq-engine", () => ({
  getHqReport: m.report,
  exportHqReportCsv: m.csv,
}));
vi.mock("./management-hq-live-report", () => ({
  getHqLiveReport: m.liveReport,
  withHqLiveReportMetadata: m.reportMetadata,
}));
// Wrap, rather than replace, the actual helper so the actual router's final gate is observable.
vi.mock("./management-hq-capacity-repair", async () => {
  const actual = await vi.importActual<
    typeof import("./management-hq-capacity-repair")
  >("./management-hq-capacity-repair");
  return {
    ...actual,
    repairHqInitialCapacity: async (
      options: Parameters<typeof actual.repairHqInitialCapacity>[0]
    ) => {
      const result = await actual.repairHqInitialCapacity(options);
      m.helperDone = true;
      m.onHelperDone?.();
      return result;
    },
  };
});
import { managementHqRouter } from "./management-hq-router";
import { router } from "./_core/trpc";
const app = router({ managementHq: managementHqRouter });
const fresh = {
  id: 47,
  role: "super_admin",
  isActive: true,
  portalStatus: "active",
};
const caller = (user: any = { ...fresh }) =>
  app.createCaller({ user, req: {}, res: {} } as any).managementHq;
const KEY = "SYNTHETIC-CAPACITY-KEY-" + "a".repeat(32);
const TOKEN = "SYNTHETIC-CAPACITY-TOKEN-" + "b".repeat(32);
const NOW = "2026-11-24T21:00:00.000Z";
const PRIVATE =
  "SYNTHETIC-private-key customer@example.test https://private.test?token=private SELECT private_payload";
const rotations = [
  [
    "HQ_ORBIT_REPORTING_BASE_URL",
    "https://other.thejltgroup.co.uk/api/reporting/v1",
  ],
  ["HQ_ORBIT_REPORTING_API_KEY", "ROTATED-" + "c".repeat(32)],
  ["HQ_PORTAL_SYNC_TOKEN", "ROTATED-" + "d".repeat(32)],
  ["HQ_LIVE_SYNC_ENABLED", "false"],
  ["HQ_LIVE_READ_ENABLED", "true"],
  ["HQ_LIVE_INTERVAL_SECONDS", "120"],
  ["HQ_LIVE_FRESHNESS_SECONDS", "120"],
] as const;
const forbidden = () => [
  m.rawPool,
  m.mysqlPool,
  m.invoke,
  m.complete,
  m.recover,
  m.stagedResume,
  m.readPublished,
  m.readValidation,
  m.getStatus,
  m.sampleStore,
  m.importer,
  m.report,
  m.csv,
  m.directory,
  m.liveReport,
  m.reportMetadata,
  m.sample,
];
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
function safeFailure(error: unknown) {
  expect(error).toBeInstanceOf(TRPCError);
  expect(
    JSON.stringify({
      code: (error as TRPCError).code,
      message: (error as Error).message,
    })
  ).not.toMatch(
    /SYNTHETIC|private-key|customer@|https?:|SELECT|private_payload|apiKey|resumeCursor|audit|sha256/i
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  for (const [key, value] of Object.entries({
    NODE_ENV: "production",
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://orbit.thejltgroup.co.uk/api/reporting/v1",
    HQ_ORBIT_REPORTING_API_KEY: KEY,
    HQ_PORTAL_SYNC_TOKEN: TOKEN,
    HQ_LIVE_INTERVAL_SECONDS: undefined,
    HQ_LIVE_FRESHNESS_SECONDS: undefined,
    HQ_SAMPLE_PILOT_DISABLED: undefined,
  }))
    vi.stubEnv(key, value);
  for (const fn of [
    m.getDb,
    m.select,
    m.from,
    m.where,
    m.limit,
    m.fetch,
    m.liveService,
    m.repair,
    ...forbidden(),
  ])
    fn.mockReset();
  for (const fn of [...forbidden(), m.fetch])
    fn.mockImplementation(() => {
      throw new Error(PRIVATE);
    });
  m.repair.mockResolvedValue("repaired");
  m.liveService.mockReturnValue({
    repairInitialCapacity: m.repair,
    invoke: m.invoke,
    complete: m.complete,
    recoverEmptyInitialImport: m.recover,
    resumeStagedInitialImport: m.stagedResume,
    readPublished: m.readPublished,
    readValidationSnapshot: m.readValidation,
    getStatus: m.getStatus,
  });
  m.fresh = { ...fresh };
  m.helperDone = false;
  m.onSelect = null;
  m.onHelperDone = null;
  const q: any = { from: m.from, where: m.where, limit: m.limit };
  m.select.mockReturnValue(q);
  m.from.mockReturnValue(q);
  m.where.mockReturnValue(q);
  m.limit.mockImplementation(async () => {
    m.onSelect?.();
    return [{ ...m.fresh }];
  });
  m.getDb.mockResolvedValue({ select: m.select });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => {
  for (const fn of [...forbidden(), m.fetch]) expect(fn).not.toHaveBeenCalled();
  expect(process.env.DATABASE_URL).toBeUndefined();
  expect(process.env.DRIZZLE_DATABASE_URL).toBeUndefined();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Actual router, actual helper, actual fresh-authority queries; injected mock
// service success is not a real-source or store/chunk cold-validation claim.
describe("actual protected initial capacity repair route", () => {
  it("is an inert no-input mutation before invocation", () => {
    caller();
    expect(
      managementHqRouter._def.procedures.repairInitialImportCapacity._def.type
    ).toBe("mutation");
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.liveService).not.toHaveBeenCalled();
  });
  it("repairs only saved initial capacity with minimal fresh actor queries and no source/import/read", async () => {
    const result = await caller().repairInitialImportCapacity();
    expect(result.status).toBe("repaired");
    expect(result.errorCode).toBeNull();
    safe(result);
    expect(result.message).toMatch(/preserv|saved import/i);
    expect(result.message).toMatch(/no import batch/i);
    expect(result.message).toMatch(/finish first import/i);
    expect(m.repair).toHaveBeenCalledOnce();
    expect(m.repair).toHaveBeenCalledWith();
    expect(m.liveService).toHaveBeenCalledOnce();
    expect(m.liveService.mock.calls[0][0]).toMatchObject({
      onlyInitialPublication: true,
      initialImportGuard: expect.any(Function),
    });
    expect(Object.keys(m.liveService.mock.calls[0][0]).sort()).toEqual([
      "config",
      "initialImportGuard",
      "onlyInitialPublication",
    ]);
    expect(m.select.mock.calls.length).toBeGreaterThanOrEqual(5);
    for (const [fields] of m.select.mock.calls)
      expect(fields).toEqual({
        id: users.id,
        role: users.role,
        isActive: users.isActive,
        portalStatus: users.portalStatus,
      });
    for (const [table] of m.from.mock.calls) expect(table).toBe(users);
    for (const [condition] of m.where.mock.calls)
      expect(new MySqlDialect().sqlToQuery(condition).params).toEqual([47]);
    for (const [limit] of m.limit.mock.calls) expect(limit).toBe(2);
    expect(process.env.HQ_LIVE_SYNC_ENABLED).toBe("true");
    expect(process.env.HQ_LIVE_READ_ENABLED).toBe("false");
  });
  it("creates request-local service and guard without acceleration on successive repairs", async () => {
    const actor = caller();
    expect((await actor.repairInitialImportCapacity()).status).toBe("repaired");
    expect((await actor.repairInitialImportCapacity()).status).toBe("repaired");
    expect(m.liveService).toHaveBeenCalledTimes(2);
    const [first, second] = m.liveService.mock.calls.map(
      ([options]) => options
    );
    expect(first).not.toBe(second);
    expect(first.initialImportGuard).not.toBe(second.initialImportGuard);
    for (const options of [first, second]) {
      expect(Object.keys(options).sort()).toEqual([
        "config",
        "initialImportGuard",
        "onlyInitialPublication",
      ]);
      expect(options.acceleratedInitialImport).toBeUndefined();
      expect(options.initialImportCpuBindingGuard).toBeUndefined();
    }
  });
  it.each(["report", "exportCsv"] as const)(
    "successful repair grants no ordinary %s read or configuration activation",
    async route => {
      const actor = caller();
      expect((await actor.repairInitialImportCapacity()).status).toBe(
        "repaired"
      );
      await expect(
        actor[route]({ year: 2026, month: 11 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(m.liveService).toHaveBeenCalledOnce();
      expect(m.repair).toHaveBeenCalledOnce();
      expect(process.env.HQ_LIVE_SYNC_ENABLED).toBe("true");
      expect(process.env.HQ_LIVE_READ_ENABLED).toBe("false");
    }
  );
  it("denies anonymous before any backend", async () => {
    await expect(
      caller(null).repairInitialImportCapacity()
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.liveService).not.toHaveBeenCalled();
    expect(m.repair).not.toHaveBeenCalled();
  });
  it.each([
    "user",
    "admin",
    "agent",
    "instructor",
    "engagement",
    "business_staff",
  ])("denies %s before capacity repair", async role => {
    await expect(
      caller({ ...fresh, role }).repairInitialImportCapacity()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(m.liveService).not.toHaveBeenCalled();
    expect(m.repair).not.toHaveBeenCalled();
    expect(m.select).not.toHaveBeenCalled();
  });
  it.each([
    { isActive: false },
    { role: "admin" },
    { portalStatus: "suspended" },
    { portalStatus: "pending" },
    { id: 48 },
  ])("denies stale session against fresh actor %j", async patch => {
    Object.assign(m.fresh, patch);
    await expect(caller().repairInitialImportCapacity()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.repair).not.toHaveBeenCalled();
    expect(m.liveService).not.toHaveBeenCalled();
  });
  it.each([[], [{ ...fresh }, { ...fresh }]].map(rows => ({ rows })))(
    "denies missing or ambiguous authority %#",
    async ({ rows }) => {
      m.limit.mockResolvedValue(rows);
      await expect(
        caller().repairInitialImportCapacity()
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(m.repair).not.toHaveBeenCalled();
    }
  );
  it.each(
    [
      null,
      false,
      true,
      0,
      1,
      "",
      "payload",
      [],
      {},
      { force: true },
      { expectedControlVersion: 9, expectedSyncVersion: 9 },
      { token: TOKEN },
      { url: PRIVATE },
      { errorCode: "STATE_BYTE_CAP_EXCEEDED" },
      { resumeCursor: PRIVATE },
      { readEnabled: true, syncEnabled: true },
    ].map(input => ({ input }))
  )(
    "z.void rejects arbitrary capacity repair payload %j",
    async ({ input }) => {
      await expect(
        caller().repairInitialImportCapacity(input as never)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(m.repair).not.toHaveBeenCalled();
      expect(m.liveService).not.toHaveBeenCalled();
    }
  );
  it.each([
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_SYNC_ENABLED: "TRUE" },
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_PORTAL_SYNC_TOKEN: undefined },
    { HQ_ORBIT_REPORTING_API_KEY: "short" },
    { HQ_ORBIT_REPORTING_BASE_URL: undefined },
    { HQ_LIVE_INTERVAL_SECONDS: "0" },
    { HQ_LIVE_FRESHNESS_SECONDS: "invalid" },
  ])("strict configuration %j makes no service", async patch => {
    for (const [key, value] of Object.entries(patch)) vi.stubEnv(key, value);
    const result = await caller().repairInitialImportCapacity();
    expect(result.status).toBe("invalid_settings");
    safe(result);
    expect(m.liveService).not.toHaveBeenCalled();
    expect(m.repair).not.toHaveBeenCalled();
    expect(m.select.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it.each(["notdue", "busy", "not_repairable"])(
    "returns fixed %s without a source batch",
    async status => {
      m.repair.mockResolvedValue(status);
      const result = await caller().repairInitialImportCapacity();
      expect(result.status).toBe(status);
      expect(result.errorCode).toBeNull();
      safe(result);
    }
  );
  it("missing optional service capacity repair is not resumable, never falls back to recovery/import", async () => {
    m.liveService.mockReturnValue({
      recoverEmptyInitialImport: m.recover,
      resumeStagedInitialImport: m.stagedResume,
      invoke: m.invoke,
      complete: m.complete,
    });
    const result = await caller().repairInitialImportCapacity();
    expect(result.status).toBe("not_repairable");
    safe(result);
    expect(m.repair).not.toHaveBeenCalled();
  });
  it.each(
    [
      undefined,
      null,
      "recovered",
      "invalid_settings",
      "needs_attention",
      PRIVATE,
      {
        status: "repaired",
        message: PRIVATE,
        errorCode: PRIVATE,
        audit: { fromControlVersion: 9, syncVersion: 9 },
        sha256: "a".repeat(64),
        resumeCursor: PRIVATE,
        rawrows: [{ bookingRef: PRIVATE }],
      },
    ].map(value => ({ value }))
  )(
    "maps malformed service output %j to private-free attention",
    async ({ value }) => {
      m.repair.mockResolvedValue(value);
      const result = await caller().repairInitialImportCapacity();
      expect(result.status).toBe("needs_attention");
      expect(result.errorCode).toBe("STORE_UNAVAILABLE");
      safe(result);
    }
  );
  it("sanitizes arbitrary service failures", async () => {
    m.repair.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: PRIVATE })
    );
    const result = await caller().repairInitialImportCapacity();
    expect(result.status).toBe("needs_attention");
    expect(result.errorCode).toBe("STORE_UNAVAILABLE");
    safe(result);
  });
  it("does not expose unsafe authority storage errors", async () => {
    m.limit.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: PRIVATE })
    );
    const error = await caller()
      .repairInitialImportCapacity()
      .catch(error => error);
    expect(error).toMatchObject({ code: "PRECONDITION_FAILED" });
    safeFailure(error);
    expect(m.repair).not.toHaveBeenCalled();
  });
  it("rechecks fresh actor before constructing a service", async () => {
    let reads = 0;
    m.onSelect = () => {
      if (++reads === 2) m.fresh.isActive = false;
    };
    await expect(caller().repairInitialImportCapacity()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.liveService).not.toHaveBeenCalled();
    expect(m.repair).not.toHaveBeenCalled();
  });
  it("fresh revocation during service creation prevents capacity repair", async () => {
    m.liveService.mockImplementation(() => {
      m.fresh.isActive = false;
      return { repairInitialCapacity: m.repair };
    });
    await expect(caller().repairInitialImportCapacity()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.repair).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "fresh authority revoked after service success=%s suppresses DTO",
    async success => {
      m.repair.mockImplementation(async () => {
        m.fresh.isActive = false;
        if (!success) throw new Error(PRIVATE);
        return "repaired";
      });
      await expect(
        caller().repairInitialImportCapacity()
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(m.helperDone).toBe(false);
    }
  );
  it("a swallowed service guard denial remains denied after actor restoration", async () => {
    m.repair.mockImplementation(async () => {
      m.fresh.isActive = false;
      await expect(
        m.liveService.mock.calls[0][0].initialImportGuard()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      m.fresh.isActive = true;
      return "repaired";
    });
    await expect(caller().repairInitialImportCapacity()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.fresh.isActive).toBe(true);
    expect(m.helperDone).toBe(false);
  });
  it("final router fresh-actor guard runs after the actual helper result", async () => {
    m.onSelect = () => {
      if (m.helperDone) m.fresh.isActive = false;
    };
    await expect(caller().repairInitialImportCapacity()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.helperDone).toBe(true);
    expect(m.repair).toHaveBeenCalledOnce();
  });
  it.each(rotations)(
    "%s rotation during service creation prevents capacity repair",
    async (key, changed) => {
      const original = process.env[key];
      let rotated = false,
        restored = false;
      m.liveService.mockImplementation(() => {
        vi.stubEnv(key, changed);
        rotated = true;
        return { repairInitialCapacity: m.repair };
      });
      m.onSelect = () => {
        if (rotated) {
          vi.stubEnv(key, original);
          restored = true;
        }
      };
      await expect(
        caller().repairInitialImportCapacity()
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(m.repair).not.toHaveBeenCalled();
      expect(restored).toBe(true);
      expect(process.env[key]).toBe(original);
    }
  );
  it.each(rotations)(
    "%s post-success rotation is permanently denied despite restoration",
    async (key, changed) => {
      const original = process.env[key];
      let rotated = false,
        restored = false;
      m.repair.mockImplementation(async () => {
        vi.stubEnv(key, changed);
        rotated = true;
        return "repaired";
      });
      m.onSelect = () => {
        if (rotated) {
          vi.stubEnv(key, original);
          restored = true;
        }
      };
      await expect(
        caller().repairInitialImportCapacity()
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(restored).toBe(true);
      expect(process.env[key]).toBe(original);
    }
  );
  it.each(rotations)(
    "%s failed-service rotation is permanently denied despite restoration",
    async (key, changed) => {
      const original = process.env[key];
      let rotated = false;
      m.repair.mockImplementation(async () => {
        vi.stubEnv(key, changed);
        rotated = true;
        throw new Error(PRIVATE);
      });
      m.onSelect = () => {
        if (rotated) vi.stubEnv(key, original);
      };
      await expect(
        caller().repairInitialImportCapacity()
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(process.env[key]).toBe(original);
    }
  );
  it.each(rotations)(
    "%s post-authority-await rotation denies before service even when restored",
    async (key, changed) => {
      const original = process.env[key];
      let reads = 0;
      m.onSelect = () => {
        if (++reads === 2) vi.stubEnv(key, changed);
        else if (reads > 2) vi.stubEnv(key, original);
      };
      await expect(
        caller().repairInitialImportCapacity()
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(m.liveService).not.toHaveBeenCalled();
      expect(m.repair).not.toHaveBeenCalled();
      expect(process.env[key]).toBe(original);
    }
  );
  it.each(rotations)(
    "final router guard latches %s rotation restored during its authority await",
    async (key, changed) => {
      const original = process.env[key];
      let restored = false;
      m.onHelperDone = () => vi.stubEnv(key, changed);
      m.onSelect = () => {
        if (m.helperDone) {
          vi.stubEnv(key, original);
          restored = true;
        }
      };
      await expect(
        caller().repairInitialImportCapacity()
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(m.helperDone).toBe(true);
      expect(restored).toBe(true);
      expect(process.env[key]).toBe(original);
    }
  );
  it.each(rotations)(
    "final router guard detects %s rotation after its fresh authority await",
    async (key, changed) => {
      m.onSelect = () => {
        if (m.helperDone) vi.stubEnv(key, changed);
      };
      await expect(
        caller().repairInitialImportCapacity()
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(m.helperDone).toBe(true);
      expect(m.repair).toHaveBeenCalledOnce();
    }
  );
});
