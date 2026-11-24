import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { users } from "../drizzle/schema";
import examples from "./fixtures/management-hq-implemented-http-examples.json";
vi.hoisted(() => {
  delete process.env.DATABASE_URL;
});
const m = vi.hoisted(() => ({
  getDb: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  fetch: vi.fn(),
  rawPool: vi.fn(),
  liveService: vi.fn(),
  recover: vi.fn(),
  sampleStore: vi.fn(),
  importer: vi.fn(),
  report: vi.fn(),
  csv: vi.fn(),
  directory: vi.fn(),
  liveReport: vi.fn(),
  reportMetadata: vi.fn(),
  sample: vi.fn(),
  mysqlPool: vi.fn(),
  active: true,
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
vi.mock("./management-hq-initial-recovery", async () => {
  const actual = await vi.importActual<
    typeof import("./management-hq-initial-recovery")
  >("./management-hq-initial-recovery");
  return {
    ...actual,
    recoverHqEmptyInitialImport: async (
      options: Parameters<typeof actual.recoverHqEmptyInitialImport>[0]
    ) => {
      const result = await actual.recoverHqEmptyInitialImport(options);
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
const KEY = "SYNTHETIC-FIRST-PAGE-KEY-" + "a".repeat(32);
const TOKEN = "SYNTHETIC-SEPARATE-SYNC-TOKEN-" + "b".repeat(32);
const NOW = "2026-11-24T19:00:00.000Z";
const PRIVATE =
  "private-key customer@example.test https://private.test?token=private SELECT private_payload";
const page = () => structuredClone(examples.beforeAmendment.body);
const status = () => {
  const { items, entityType, complete, nextCursor, resumeCursor, ...metadata } =
    page();
  return { ...metadata, ready: true };
};
const capabilities = () => ({
  apiVersion: "1.0.0",
  endpoints: [
    "status",
    "capabilities",
    "bookings",
    "business-mappings",
    "catalogue",
    "changes",
  ],
  quotes: false,
  sourceWrites: false,
  providerCalls: false,
});
const json = (v: unknown) =>
  new Response(JSON.stringify(v), {
    headers: { "Content-Type": "application/json" },
  });
const forbidden = () => [
  m.rawPool,
  m.sampleStore,
  m.importer,
  m.report,
  m.csv,
  m.directory,
  m.liveReport,
  m.reportMetadata,
  m.sample,
  m.mysqlPool,
];
const safe = (v: unknown) =>
  expect(JSON.stringify(v)).not.toMatch(
    /SYNTHETIC|private-key|customer@|https:|SELECT|private_payload|bookingRef|items|counts|resumeCursor|changeUpper|apiKey|lease|sourceFingerprint/
  );
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
    ...forbidden(),
  ])
    fn.mockReset();
  for (const fn of forbidden())
    fn.mockImplementation(() => {
      throw new Error(PRIVATE);
    });
  m.liveService.mockReset();
  m.recover.mockReset();
  m.recover.mockResolvedValue("recovered");
  m.liveService.mockReturnValue({ recoverEmptyInitialImport: m.recover });
  m.active = true;
  m.helperDone = false;
  m.onSelect = null;
  m.onHelperDone = null;
  const q: any = { from: m.from, where: m.where, limit: m.limit };
  m.select.mockReturnValue(q);
  m.from.mockReturnValue(q);
  m.where.mockReturnValue(q);
  m.limit.mockImplementation(async () => {
    m.onSelect?.();
    return [{ ...fresh, isActive: m.active }];
  });
  m.getDb.mockResolvedValue({ select: m.select });
  m.fetch.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
    const endpoint = new URL(String(input)).pathname.split("/").pop();
    if (endpoint === "status") return json(status());
    if (endpoint === "capabilities") return json(capabilities());
    if (endpoint === "bookings") return json(page());
    throw new Error(PRIVATE);
  });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => {
  for (const fn of forbidden()) expect(fn).not.toHaveBeenCalled();
  expect(m.fetch.mock.calls.length).toBeLessThanOrEqual(3);
  expect(process.env.DATABASE_URL).toBeUndefined();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("actual protected empty-initial-import recovery route", () => {
  it("is inert before invocation", () => {
    caller();
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.liveService).not.toHaveBeenCalled();
  });
  it("recovers with initial-only service and minimal own authority, without importing or source reads", async () => {
    const result = await caller().recoverInitialImport();
    expect(result.status).toBe("recovered");
    safe(result);
    expect(m.recover).toHaveBeenCalledOnce();
    expect(m.recover).toHaveBeenCalledWith();
    expect(m.liveService.mock.calls[0][0]).toMatchObject({
      onlyInitialPublication: true,
      initialImportGuard: expect.any(Function),
    });
    expect(m.fetch).not.toHaveBeenCalled();
    for (const [fields] of m.select.mock.calls)
      expect(fields).toEqual({
        id: users.id,
        role: users.role,
        isActive: users.isActive,
        portalStatus: users.portalStatus,
      });
    for (const [condition] of m.where.mock.calls)
      expect(new MySqlDialect().sqlToQuery(condition).params).toEqual([47]);
    expect(process.env.HQ_LIVE_SYNC_ENABLED).toBe("true");
    expect(process.env.HQ_LIVE_READ_ENABLED).toBe("false");
  });
  it("denies anonymous before backend", async () => {
    await expect(caller(null).recoverInitialImport()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.recover).not.toHaveBeenCalled();
  });
  it.each(["admin", "agent", "instructor", "engagement", "business_staff"])(
    "denies %s before recovery",
    async role => {
      await expect(
        caller({ ...fresh, role }).recoverInitialImport()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(m.recover).not.toHaveBeenCalled();
    }
  );
  it("denies fresh revocation", async () => {
    m.active = false;
    await expect(caller().recoverInitialImport()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.recover).not.toHaveBeenCalled();
  });
  it.each(
    [
      null,
      {},
      { force: true },
      { expectedVersion: 3 },
      { url: PRIVATE },
      [],
      "payload",
    ].map(input => ({ input }))
  )("rejects selected recovery payload %j", async ({ input }) => {
    await expect(
      caller().recoverInitialImport(input as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(m.recover).not.toHaveBeenCalled();
  });
  it.each([
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_PORTAL_SYNC_TOKEN: undefined },
  ])("invalid settings %j do no recovery", async patch => {
    for (const [key, value] of Object.entries(patch)) vi.stubEnv(key, value);
    expect((await caller().recoverInitialImport()).status).toBe(
      "invalid_settings"
    );
    expect(m.liveService).not.toHaveBeenCalled();
  });
  it.each(["notdue", "busy", "not_recoverable"])(
    "returns fixed %s without source batch",
    async status => {
      m.recover.mockResolvedValue(status);
      const r = await caller().recoverInitialImport();
      expect(r.status).toBe(status);
      safe(r);
      expect(m.fetch).not.toHaveBeenCalled();
    }
  );
  it.each([true, false])(
    "authority failure after success=%s suppresses DTO",
    async success => {
      m.recover.mockImplementation(async () => {
        m.active = false;
        if (!success) throw new Error(PRIVATE);
        return "recovered";
      });
      await expect(caller().recoverInitialImport()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  );
  it("final router authority is checked after helper result", async () => {
    m.onSelect = () => {
      if (m.helperDone) m.active = false;
    };
    await expect(caller().recoverInitialImport()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.helperDone).toBe(true);
  });
  it.each([
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
  ])(
    "latches %s drift restored during final authority await",
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
      await expect(caller().recoverInitialImport()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(restored).toBe(true);
      expect(process.env[key]).toBe(original);
    }
  );
});
