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
vi.mock("./management-hq-first-page-check", async () => {
  const actual = await vi.importActual<
    typeof import("./management-hq-first-page-check")
  >("./management-hq-first-page-check");
  return {
    ...actual,
    checkHqFirstPage: async (
      options: Parameters<typeof actual.checkHqFirstPage>[0]
    ) => {
      const result = await actual.checkHqFirstPage(options);
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
  m.liveService,
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

describe("actual protected managementHq.checkFirstBookingPage; no import or recovery", () => {
  it("constructs without provider, reporting store or authority reads", () => {
    caller();
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it("runs exactly three strict GETs including unpinned bookings limit100, returning metadata only", async () => {
    const result = await caller().checkFirstBookingPage();
    expect(result).toMatchObject({
      outcome: "page_valid",
      stage: "bookings",
      errorCode: null,
      failedRule: null,
    });
    safe(result);
    expect(m.fetch).toHaveBeenCalledTimes(3);
    expect(
      m.fetch.mock.calls.map(([url]) =>
        new URL(String(url)).pathname.split("/").pop()
      )
    ).toEqual(["status", "capabilities", "bookings"]);
    for (const [input, init] of m.fetch.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://orbit.thejltgroup.co.uk");
      expect(url.search).toBe(
        url.pathname.endsWith("/bookings") ? "?limit=100" : ""
      );
      expect(init).toMatchObject({
        method: "GET",
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
      });
      expect(init.body).toBeUndefined();
      const headers = new Headers(init.headers);
      expect(headers.get("X-Orbit-Reporting-Key")).toBe(KEY);
      expect(headers.get("Authorization")).toBeNull();
      expect(headers.get("Cookie")).toBeNull();
    }
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
    expect(process.env.HQ_LIVE_SYNC_ENABLED).toBe("true");
    expect(process.env.HQ_LIVE_READ_ENABLED).toBe("false");
    expect(process.env.HQ_PORTAL_SYNC_TOKEN).toBe(TOKEN);
  });
  it("denies an anonymous request before backend work", async () => {
    await expect(caller(null).checkFirstBookingPage()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it.each([
    "admin",
    "agent",
    "staff",
    "instructor",
    "engagement",
    "business_staff",
  ])("denies %s role before source work", async role => {
    await expect(
      caller({ ...fresh, role }).checkFirstBookingPage()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it("denies freshly revoked own authority before source work", async () => {
    m.active = false;
    await expect(caller().checkFirstBookingPage()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it.each(
    [null, {}, { limit: 1 }, { url: PRIVATE }, [], "payload"].map(input => ({
      input,
    }))
  )("rejects forged non-void input %j", async ({ input }) => {
    await expect(
      caller().checkFirstBookingPage(input as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it.each([
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_ORBIT_REPORTING_BASE_URL: undefined },
    { HQ_PORTAL_SYNC_TOKEN: undefined },
  ])("invalid actual settings %j cause no source request", async values => {
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
    const result = await caller().checkFirstBookingPage();
    expect(result.outcome).toBe("invalid_settings");
    safe(result);
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it.each(["status", "capabilities", "bookings"])(
    "rechecks authority after a rejected %s read",
    async endpoint => {
      const base = m.fetch.getMockImplementation()!;
      m.fetch.mockImplementation(
        async (input: Parameters<typeof fetch>[0], init: RequestInit) => {
          if (new URL(String(input)).pathname.endsWith("/" + endpoint)) {
            m.active = false;
            throw new Error(PRIVATE);
          }
          return base(input, init);
        }
      );
      await expect(caller().checkFirstBookingPage()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  );
  it.each(["status", "capabilities", "bookings"])(
    "rechecks authority after a successful %s read",
    async endpoint => {
      const base = m.fetch.getMockImplementation()!;
      m.fetch.mockImplementation(
        async (input: Parameters<typeof fetch>[0], init: RequestInit) => {
          const response = await base(input, init);
          if (new URL(String(input)).pathname.endsWith("/" + endpoint))
            m.active = false;
          return response;
        }
      );
      await expect(caller().checkFirstBookingPage()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  );
  it.each([
    [
      "HQ_ORBIT_REPORTING_BASE_URL",
      "https://other.thejltgroup.co.uk/api/reporting/v1",
    ],
    ["HQ_ORBIT_REPORTING_API_KEY", "ROTATED-SYNTHETIC-KEY-" + "c".repeat(32)],
    ["HQ_PORTAL_SYNC_TOKEN", "ROTATED-SYNTHETIC-TOKEN-" + "d".repeat(32)],
    ["HQ_LIVE_SYNC_ENABLED", "false"],
    ["HQ_LIVE_READ_ENABLED", "true"],
    ["HQ_LIVE_INTERVAL_SECONDS", "120"],
    ["HQ_LIVE_FRESHNESS_SECONDS", "120"],
  ])("denies rotation of %s during a source await", async (key, value) => {
    const base = m.fetch.getMockImplementation()!;
    m.fetch.mockImplementation(
      async (input: Parameters<typeof fetch>[0], init: RequestInit) => {
        const response = await base(input, init);
        vi.stubEnv(key, value);
        return response;
      }
    );
    const error = await caller()
      .checkFirstBookingPage()
      .catch(error => error);
    expect(error.code).toBe("PRECONDITION_FAILED");
    safe({ code: error.code, message: error.message });
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });
  it("returns a fixed current-bookings failure label with no raw rejected page or provider message", async () => {
    const base = m.fetch.getMockImplementation()!;
    m.fetch.mockImplementation(
      async (input: Parameters<typeof fetch>[0], init: RequestInit) => {
        if (new URL(String(input)).pathname.endsWith("/bookings")) {
          const rejected = page();
          rejected.items[0].payload.financials.grossBookingValue = 1.001;
          return json(rejected);
        }
        return base(input, init);
      }
    );
    const result = await caller().checkFirstBookingPage();
    expect(result).toMatchObject({
      outcome: "needs_attention",
      stage: "bookings",
      errorCode: "INVALID_SEMANTICS",
    });
    expect(typeof result.failedRule).toBe("string");
    safe(result);
    expect(result.generationId).toBeNull();
  });
  it("rechecks the final router authority await after the helper has finished reading", async () => {
    m.onSelect = () => {
      if (m.helperDone) m.active = false;
    };
    await expect(caller().checkFirstBookingPage()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.helperDone).toBe(true);
  });
  it("denies settings rotation during the final router authority await", async () => {
    m.onSelect = () => {
      if (m.helperDone)
        vi.stubEnv(
          "HQ_PORTAL_SYNC_TOKEN",
          "ROTATED-SYNTHETIC-" + "e".repeat(32)
        );
    };
    await expect(caller().checkFirstBookingPage()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(m.helperDone).toBe(true);
  });
  it("suppresses a safe failure DTO if final router authority is revoked", async () => {
    m.fetch.mockRejectedValue(new Error(PRIVATE));
    m.onSelect = () => {
      if (m.helperDone) m.active = false;
    };
    await expect(caller().checkFirstBookingPage()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.helperDone).toBe(true);
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    [
      "HQ_ORBIT_REPORTING_BASE_URL",
      "https://other.thejltgroup.co.uk/api/reporting/v1",
    ],
    ["HQ_ORBIT_REPORTING_API_KEY", "ROTATED-SYNTHETIC-" + "f".repeat(32)],
    ["HQ_PORTAL_SYNC_TOKEN", "ROTATED-SYNTHETIC-" + "g".repeat(32)],
    ["HQ_LIVE_SYNC_ENABLED", "false"],
    ["HQ_LIVE_READ_ENABLED", "true"],
    ["HQ_LIVE_INTERVAL_SECONDS", "120"],
    ["HQ_LIVE_FRESHNESS_SECONDS", "120"],
  ])(
    "latches final-router %s rotation restored during its authority await",
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
      await expect(caller().checkFirstBookingPage()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(m.helperDone).toBe(true);
      expect(restored).toBe(true);
      expect(process.env[key]).toBe(original);
      expect(m.fetch).toHaveBeenCalledTimes(3);
    }
  );
});
