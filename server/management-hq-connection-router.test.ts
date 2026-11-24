import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { users } from "../drizzle/schema";
import type { HqWireStatus } from "../shared/management-hq-wire";
vi.hoisted(() => {
  delete process.env.DATABASE_URL;
});
const m = vi.hoisted(() => ({
  getDb: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  rows: [] as any[][],
  onSelect: null as null | ((index: number) => void | Promise<void>),
  selectCount: 0,
  events: [] as string[],
  useSeam: false,
  status: vi.fn(),
  capabilities: vi.fn(),
  check: vi.fn(),
  transport: vi.fn(),
  pool: vi.fn(),
  liveService: vi.fn(),
  liveStore: vi.fn(),
  sampleStore: vi.fn(),
  importer: vi.fn(),
  sample: vi.fn(),
  directory: vi.fn(),
  report: vi.fn(),
  csv: vi.fn(),
  liveReport: vi.fn(),
  reportMetadata: vi.fn(),
  syncHandler: vi.fn(),
  mysqlPool: vi.fn(),
}));
vi.mock("./business-staff-access", () => ({
  getBusinessStaffAuthority: async () => null,
  assertBusinessStaffRouteAllowed: async () => undefined,
}));
vi.mock("./db", () => ({ getDb: m.getDb, getRawDbPool: m.pool }));
vi.mock("mysql2/promise", () => ({ createPool: m.mysqlPool }));
vi.mock("./management-hq-live-service", () => ({
  createHqLiveService: m.liveService,
}));
vi.mock("./management-hq-live-store", () => ({
  createHqLiveStore: m.liveStore,
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
vi.mock("./management-hq-sync-route", () => ({
  createManagementHqSyncHandler: m.syncHandler,
}));
// The wrapper changes only the internal reader seam for race tests. Settings,
// production helper, strict adapter, actual procedure and fresh DB gate are real.
vi.mock("./management-hq-connection-check", async () => {
  const actual = await vi.importActual<any>("./management-hq-connection-check");
  return {
    ...actual,
    checkHqConnection: (options: any) => {
      m.check(options);
      return actual.checkHqConnection({
        ...options,
        ...(m.useSeam
          ? {
              createReader: () => ({
                status: m.status,
                capabilities: m.capabilities,
              }),
            }
          : {}),
      });
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
const KEY = "SYNTHETIC-REPORTING-KEY-32-CHARS-ONLY";
const NOW = "2026-11-24T12:00:00.000Z";
const PRIVATE =
  "private-key customer@example.test https://private.test?token=private SELECT private_payload hash-deadbeef";
const authorityMessage = "Active Super Admin access required.";
const boundaryMessage =
  "Management HQ data or access could not be verified. Values are unavailable, not zero. No partial totals have been returned.";
function status(): HqWireStatus {
  return {
    generationId: 47,
    projectionVersion: "1.0.0",
    scope: "company_all_real_and_unattributed",
    sourceObservationWindow: {
      from: "2026-11-24T11:59:49.000Z",
      to: "2026-11-24T11:59:50.000Z",
    },
    publishedAt: "2026-11-24T11:59:55.000Z",
    expiresAt: "2026-11-25T11:59:55.000Z",
    changeUpper: 999,
    sourceAgeSeconds: 10,
    freshnessTargetSeconds: 900,
    stale: false,
    consistency: "sealed_reporting_generation_with_per_page_source_snapshot",
    counts: { bookingCount: 12345, businessCount: 67890, diagnostic: PRIVATE },
    ready: true,
    diagnostic: PRIVATE,
  };
}
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
  diagnostic: PRIVATE,
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const forbidden = () => [
  m.pool,
  m.liveService,
  m.liveStore,
  m.sampleStore,
  m.importer,
  m.sample,
  m.directory,
  m.report,
  m.csv,
  m.liveReport,
  m.reportMetadata,
  m.syncHandler,
  m.mysqlPool,
];
function assertNoLeak(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /private|customer@|SELECT|hash-deadbeef|12345|67890|changeUpper|scope|sourceAgeSeconds|bookingCount|apiKey|https:/
  );
}
async function denied(
  pending: Promise<unknown>,
  code = "FORBIDDEN",
  message = authorityMessage
) {
  const error = await pending.catch(error => error);
  expect(error).toBeInstanceOf(TRPCError);
  expect(error).toMatchObject({ code, message });
  assertNoLeak({ code: error.code, message: error.message });
  return error;
}
beforeEach(() => {
  expect(process.env.DATABASE_URL).toBeUndefined();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  for (const [key, value] of Object.entries({
    NODE_ENV: "production",
    HQ_LIVE_SYNC_ENABLED: "false",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_API_KEY: KEY,
    HQ_ORBIT_REPORTING_BASE_URL: undefined,
    HQ_LIVE_INTERVAL_SECONDS: undefined,
    HQ_LIVE_FRESHNESS_SECONDS: undefined,
    HQ_PORTAL_SYNC_TOKEN: undefined,
    HQ_SAMPLE_PILOT_DISABLED: undefined,
  }))
    vi.stubEnv(key, value);
  for (const fn of [
    m.getDb,
    m.select,
    m.from,
    m.where,
    m.limit,
    m.status,
    m.capabilities,
    m.check,
    m.transport,
    ...forbidden(),
  ])
    fn.mockReset();
  for (const fn of forbidden())
    fn.mockImplementation(() => {
      throw new Error("Forbidden operational function: " + PRIVATE);
    });
  m.rows = [];
  m.selectCount = 0;
  m.onSelect = null;
  m.events = [];
  m.useSeam = false;
  const query: any = { from: m.from, where: m.where, limit: m.limit };
  m.select.mockReturnValue(query);
  m.from.mockReturnValue(query);
  m.where.mockReturnValue(query);
  m.limit.mockImplementation(async () => {
    const index = ++m.selectCount;
    m.events.push("authority:" + index);
    const rows = m.rows.shift() ?? [{ ...fresh }];
    await m.onSelect?.(index);
    return rows;
  });
  m.getDb.mockResolvedValue({ select: m.select });
  m.status.mockImplementation(async () => {
    m.events.push("status");
    return status();
  });
  m.capabilities.mockImplementation(async () => {
    m.events.push("capabilities");
    return capabilities();
  });
  m.transport.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
    const endpoint = new URL(String(input)).pathname.split("/").pop();
    m.events.push(String(endpoint));
    if (endpoint === "status") return json(status());
    if (endpoint === "capabilities") return json(capabilities());
    throw new Error("Non-health source endpoint forbidden");
  });
  vi.stubGlobal("fetch", m.transport);
});
afterEach(() => {
  for (const fn of forbidden()) expect(fn).not.toHaveBeenCalled();
  expect(m.transport.mock.calls.length).toBeLessThanOrEqual(2);
  expect(process.env.DATABASE_URL).toBeUndefined();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("actual managementHq.checkConnection caller; synthetic health only and no release", () => {
  it("actual router import and caller construction have no source or DB reads", async () => {
    await import("./management-hq-router");
    caller();
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.check).not.toHaveBeenCalled();
    expect(m.transport).not.toHaveBeenCalled();
  });
  it("real strict adapter uses the confirmed default URL, exactly two read-only GETs and fresh SELECT around each await", async () => {
    const result = await caller().checkConnection();
    expect(result).toEqual({
      outcome: "ready",
      message:
        "Portal can connect to Orbit. No bookings have been imported or HQ switched on.",
      checkedAt: NOW,
      generationId: 47,
      sourcePublishedAt: status().publishedAt,
      sourceObservationAt: status().sourceObservationWindow.to,
    });
    assertNoLeak(result);
    expect(m.events).toEqual([
      "authority:1",
      "authority:2",
      "status",
      "authority:3",
      "authority:4",
      "capabilities",
      "authority:5",
      "authority:6",
    ]);
    expect(m.transport).toHaveBeenCalledTimes(2);
    expect(m.select).toHaveBeenCalledTimes(6);
    for (const [input, init] of m.transport.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://orbit.thejltgroup.co.uk");
      expect(url.pathname).toMatch(
        /^\/api\/reporting\/v1\/(status|capabilities)$/
      );
      expect(url.search).toBe("");
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
    for (const [condition] of m.where.mock.calls) {
      const sql = new MySqlDialect().sqlToQuery(condition);
      expect(sql.params).toEqual([47]);
      expect(sql.sql).toContain("`users`.`id`");
    }
    for (const [limit] of m.limit.mock.calls) expect(limit).toBe(2);
    expect(process.env.HQ_LIVE_SYNC_ENABLED).toBe("false");
    expect(process.env.HQ_LIVE_READ_ENABLED).toBe("false");
    expect(process.env.HQ_PORTAL_SYNC_TOKEN).toBeUndefined();
    expect(m.check.mock.calls[0][0]).toEqual({
      beforeRequest: expect.any(Function),
    });
  });
  it("anonymous caller is denied before any backend read", async () => {
    await expect(caller(null).checkConnection()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.check).not.toHaveBeenCalled();
    expect(m.transport).not.toHaveBeenCalled();
  });
  it.each([
    "admin",
    "agent",
    "staff",
    "instructor",
    "engagement",
    "business_staff",
  ])("%s role is rejected before source reads", async role => {
    await denied(caller({ ...fresh, role }).checkConnection());
    expect(m.check).not.toHaveBeenCalled();
    expect(m.transport).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      [{ ...fresh, role: "admin" }],
      [{ ...fresh, isActive: false }],
      [{ ...fresh, isActive: 1 }],
      [{ ...fresh, portalStatus: "pending" }],
      [{ ...fresh, id: 48 }],
      [{ ...fresh }, { ...fresh }],
    ].map(rows => ({ rows }))
  )("rejects fresh non-authoritative DB rows %j", async ({ rows }) => {
    m.rows = [rows];
    await denied(caller().checkConnection());
    expect(m.check).not.toHaveBeenCalled();
    expect(m.transport).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid actor id %s before source calls",
    async id => {
      await denied(caller({ ...fresh, id }).checkConnection());
      expect(m.select).not.toHaveBeenCalled();
      expect(m.transport).not.toHaveBeenCalled();
    }
  );
  it.each([
    null,
    {},
    { url: "https://evil.test" },
    { apiKey: PRIVATE },
    { body: { bookings: [] } },
    { sourceUrl: "https://evil.test", key: PRIVATE },
    { syncEnabled: true },
    [],
    "payload",
    0,
    true,
  ])(
    "z.void rejects forged caller input %j before source reads",
    async input => {
      await expect(
        (caller().checkConnection as any)(input)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(m.check).not.toHaveBeenCalled();
      expect(m.transport).not.toHaveBeenCalled();
    }
  );
  it.each([undefined, ""])(
    "missing key %s still performs final fresh authority check",
    async key => {
      vi.stubEnv("HQ_ORBIT_REPORTING_API_KEY", key);
      const result = await caller().checkConnection();
      expect(result).toEqual({
        outcome: "missing_key",
        message:
          "Orbit reporting key is not configured (HQ_ORBIT_REPORTING_API_KEY).",
        checkedAt: NOW,
        generationId: null,
        sourcePublishedAt: null,
        sourceObservationAt: null,
      });
      expect(m.select).toHaveBeenCalledTimes(2);
      expect(m.transport).not.toHaveBeenCalled();
      m.rows = [[fresh], [{ ...fresh, isActive: false }]];
      await denied(caller().checkConnection());
      expect(m.transport).not.toHaveBeenCalled();
    }
  );
  it.each([
    ["HQ_ORBIT_REPORTING_API_KEY", "short"],
    ["HQ_ORBIT_REPORTING_BASE_URL", "http://127.0.0.1/api"],
    ["HQ_LIVE_SYNC_ENABLED", "TRUE"],
    ["HQ_LIVE_READ_ENABLED", " true"],
    ["HQ_LIVE_INTERVAL_SECONDS", "59"],
    ["HQ_LIVE_FRESHNESS_SECONDS", "86401"],
  ])(
    "invalid %s returns only null metadata after final authority check",
    async (key, value) => {
      vi.stubEnv(key, value);
      const result = await caller().checkConnection();
      expect(result).toMatchObject({
        outcome: "invalid_settings",
        message:
          "Orbit connection settings are invalid. No bookings have been imported.",
        generationId: null,
        sourcePublishedAt: null,
        sourceObservationAt: null,
      });
      assertNoLeak(result);
      expect(m.transport).not.toHaveBeenCalled();
      expect(m.select).toHaveBeenCalledTimes(2);
    }
  );
  it.each(["status", "capabilities"])(
    "actual adapter failed %s read still checks authority before mapping HTTP errors",
    async endpoint => {
      m.transport.mockImplementation(
        async (input: Parameters<typeof fetch>[0]) =>
          String(input).endsWith(`/${endpoint}`)
            ? new Response(PRIVATE, { status: 401 })
            : json(status())
      );
      const result = await caller().checkConnection();
      expect(result).toMatchObject({
        outcome: "key_rejected",
        message: "Orbit reporting key was rejected.",
        generationId: null,
        sourcePublishedAt: null,
        sourceObservationAt: null,
      });
      assertNoLeak(result);
      expect(m.select).toHaveBeenCalledTimes(endpoint === "status" ? 4 : 6);
      expect(m.transport).toHaveBeenCalledTimes(endpoint === "status" ? 1 : 2);
    }
  );
  it.each([
    [503, "unavailable"],
    [200, "not_ready"],
  ] as const)(
    "actual adapter HTTP %s produces %s with no provider error leak",
    async (httpStatus, outcome) => {
      m.transport.mockResolvedValue(
        new Response(
          httpStatus === 200
            ? JSON.stringify({ ready: false, diagnostic: PRIVATE })
            : PRIVATE,
          {
            status: httpStatus,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
      const result = await caller().checkConnection();
      expect(result.outcome).toBe(outcome);
      expect(result.generationId).toBeNull();
      assertNoLeak(result);
      expect(m.transport).toHaveBeenCalledOnce();
      expect(m.select).toHaveBeenCalledTimes(4);
    }
  );
  it("false source stale cannot weaken the configured Portal freshness ceiling", async () => {
    vi.stubEnv("HQ_LIVE_FRESHNESS_SECONDS", "60");
    m.transport.mockImplementation(async (input: Parameters<typeof fetch>[0]) =>
      json(
        String(input).endsWith("/status")
          ? { ...status(), sourceAgeSeconds: 61, stale: false }
          : capabilities()
      )
    );
    expect(await caller().checkConnection()).toMatchObject({
      outcome: "stale",
      generationId: 47,
    });
  });
  it.each([2, 3, 4, 5, 6])(
    "fresh actor revocation at SELECT %s suppresses all health metadata",
    async index => {
      m.rows = Array.from({ length: index }, (_, i) => [
        { ...fresh, ...(i === index - 1 ? { role: "admin" } : {}) },
      ]);
      await denied(caller().checkConnection());
      expect(m.transport).toHaveBeenCalledTimes(
        index === 2 ? 0 : index <= 4 ? 1 : 2
      );
    }
  );
  it.each(["status", "capabilities"])(
    "actor revocation after failed %s await suppresses failure health too",
    async endpoint => {
      m.useSeam = true;
      m[endpoint as "status" | "capabilities"].mockImplementation(async () => {
        m.rows = [[{ ...fresh, isActive: false }]];
        throw new Error(PRIVATE);
      });
      await denied(caller().checkConnection());
      expect(m.select).toHaveBeenCalledTimes(endpoint === "status" ? 3 : 5);
      expect(m.transport).not.toHaveBeenCalled();
    }
  );
  it.each(["status", "capabilities"] as const)(
    "failed %s read with disabled-source rotation still checks and rejects revoked actor",
    async endpoint => {
      m.useSeam = true;
      m[endpoint].mockImplementation(async () => {
        vi.stubEnv("HQ_ORBIT_REPORTING_API_KEY", "rotated-" + "x".repeat(40));
        m.rows = [[{ ...fresh, isActive: false }]];
        throw new Error(PRIVATE);
      });
      await denied(caller().checkConnection());
      expect(m.select).toHaveBeenCalledTimes(endpoint === "status" ? 3 : 5);
      expect(m.transport).not.toHaveBeenCalled();
    }
  );
  it.each([
    "initial-db",
    "pre-status",
    "post-status",
    "pre-capabilities",
    "post-capabilities",
    "final",
  ])(
    "raw DB/SQL error at %s is suppressed into fixed plain English",
    async when => {
      if (when === "initial-db") m.getDb.mockRejectedValue(new Error(PRIVATE));
      else
        m.onSelect = async index => {
          if (
            index ===
            (
              {
                "pre-status": 2,
                "post-status": 3,
                "pre-capabilities": 4,
                "post-capabilities": 5,
                final: 6,
              } as Record<string, number>
            )[when]
          )
            throw new Error(PRIVATE);
        };
      await denied(
        caller().checkConnection(),
        "PRECONDITION_FAILED",
        boundaryMessage
      );
    }
  );
  it("unavailable DB cannot grant stale cookie authority", async () => {
    m.getDb.mockResolvedValue(null);
    await denied(
      caller().checkConnection(),
      "INTERNAL_SERVER_ERROR",
      "Management HQ access could not be verified."
    );
    expect(m.transport).not.toHaveBeenCalled();
  });
  const drift: [string, string][] = [
    ["HQ_ORBIT_REPORTING_API_KEY", "ROTATED-SYNTHETIC-KEY-" + "x".repeat(40)],
    [
      "HQ_ORBIT_REPORTING_BASE_URL",
      "https://approved.example.org/api/reporting/v1",
    ],
    ["HQ_LIVE_SYNC_ENABLED", "true"],
    ["HQ_LIVE_READ_ENABLED", "true"],
    ["HQ_LIVE_INTERVAL_SECONDS", "600"],
    ["HQ_LIVE_FRESHNESS_SECONDS", "60"],
  ];
  it.each(drift)(
    "disabled source %s drift during FINAL authority await cannot return health",
    async (key, value) => {
      m.onSelect = async index => {
        if (index === 6) vi.stubEnv(key, value);
      };
      await denied(
        caller().checkConnection(),
        "PRECONDITION_FAILED",
        boundaryMessage
      );
      expect(m.transport).toHaveBeenCalledTimes(2);
    }
  );
  it.each(["status", "capabilities"] as const)(
    "binding drift during successful or failed %s source read fails closed",
    async endpoint => {
      for (const fails of [false, true]) {
        m.useSeam = true;
        m.selectCount = 0;
        m.rows = [];
        vi.stubEnv("HQ_ORBIT_REPORTING_API_KEY", KEY);
        m[endpoint].mockImplementation(async () => {
          vi.stubEnv(
            "HQ_ORBIT_REPORTING_API_KEY",
            "ROTATED-SYNTHETIC-KEY-" + "x".repeat(40)
          );
          if (fails) throw new Error(PRIVATE);
          return endpoint === "status" ? status() : capabilities();
        });
        await denied(
          caller().checkConnection(),
          "PRECONDITION_FAILED",
          boundaryMessage
        );
      }
      expect(m.transport).not.toHaveBeenCalled();
    }
  );
  it("key becomes configured during final missing-key authority await: no obsolete result", async () => {
    vi.stubEnv("HQ_ORBIT_REPORTING_API_KEY", undefined);
    m.onSelect = async index => {
      if (index === 2) vi.stubEnv("HQ_ORBIT_REPORTING_API_KEY", KEY);
    };
    await denied(
      caller().checkConnection(),
      "PRECONDITION_FAILED",
      boundaryMessage
    );
    expect(m.transport).not.toHaveBeenCalled();
  });
  it("disabled base rotates during final missing-key authority await: no obsolete result", async () => {
    vi.stubEnv("HQ_ORBIT_REPORTING_API_KEY", "");
    m.onSelect = async index => {
      if (index === 2)
        vi.stubEnv(
          "HQ_ORBIT_REPORTING_BASE_URL",
          "https://approved.example.org/api"
        );
    };
    await denied(
      caller().checkConnection(),
      "PRECONDITION_FAILED",
      boundaryMessage
    );
    expect(m.transport).not.toHaveBeenCalled();
  });
  it("sample mode can check health without creating or reading a sample dataset", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await caller().checkConnection()).toMatchObject({
      outcome: "ready",
    });
    expect(m.sampleStore).not.toHaveBeenCalled();
    expect(m.sample).not.toHaveBeenCalled();
  });
  it("requested live flags do not allow health probe to invoke sync, store, report or importer", async () => {
    vi.stubEnv("HQ_LIVE_SYNC_ENABLED", "true");
    vi.stubEnv("HQ_LIVE_READ_ENABLED", "true");
    vi.stubEnv(
      "HQ_ORBIT_REPORTING_BASE_URL",
      "https://approved.example.org/api/reporting/v1"
    );
    vi.stubEnv(
      "HQ_PORTAL_SYNC_TOKEN",
      "SYNTHETIC-PORTAL-TOKEN-" + "z".repeat(40)
    );
    expect(await caller().checkConnection()).toMatchObject({
      outcome: "ready",
    });
    expect(process.env.HQ_LIVE_SYNC_ENABLED).toBe("true");
    expect(process.env.HQ_LIVE_READ_ENABLED).toBe("true");
  });
});
