import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const m = vi.hoisted(() => ({
  rows: [] as any[][],
  dbError: null as any,
  published: vi.fn(),
  status: vi.fn(),
  sampleRead: vi.fn(),
  directory: vi.fn(),
  owner: vi.fn(),
  staff: vi.fn(),
  csv: vi.fn(),
  provider: vi.fn(),
}));
vi.mock("./business-staff-access", () => ({
  getBusinessStaffAuthority: async () => null,
  assertBusinessStaffRouteAllowed: async () => undefined,
}));
vi.mock("./db", () => ({
  getDb: async () => {
    if (m.dbError) throw m.dbError;
    return {
      select: () => {
        const rows = m.rows.shift() ?? [];
        const q: any = {
          from: () => q,
          where: () => q,
          limit: async () => rows,
        };
        return q;
      },
    };
  },
  getRawDbPool: async () => {
    throw new Error("live must not read sample pool");
  },
}));
vi.mock("./management-hq-store", async () => ({
  ...(await vi.importActual<any>("./management-hq-store")),
  createHqSampleStore: () => ({ read: m.sampleRead }),
}));
vi.mock("./management-hq-live-service", async () => ({
  ...(await vi.importActual<any>("./management-hq-live-service")),
  createHqLiveService: () => ({
    configurationStatus: () => ({}),
    authorizeTrigger: () => false,
    invoke: m.provider,
    readPublished: m.published,
    getStatus: m.status,
  }),
}));
vi.mock("./management-hq-identity", () => ({
  createPortalHqImplementedDirectory: m.directory,
}));
vi.mock("./management-hq-engine", async () => {
  const actual = await vi.importActual<any>("./management-hq-engine");
  return { ...actual, exportHqReportCsv: (...args: any[]) => m.csv(...args) };
});
import { managementHqRouter } from "./management-hq-router";
import { runHqImplementedSampleScenario } from "./management-hq-implemented-fixtures";
import { exportHqReportCsv as wrappedCsv } from "./management-hq-engine";
import { buildHqLiveStatus } from "./management-hq-live-service";
import { createHqLiveConfig } from "./management-hq-live-config";
import {
  memoizeHqReportDirectory,
  withHqLiveReportMetadata,
} from "./management-hq-live-report";
const fresh = {
  id: 47,
  role: "super_admin",
  isActive: true,
  portalStatus: "active",
};
const caller = (user: any = fresh) =>
  managementHqRouter.createCaller({ user, req: {}, res: {} } as any);
let state: Awaited<ReturnType<typeof runHqImplementedSampleScenario>>;
let live: ReturnType<typeof buildHqLiveStatus>;
const secret =
  "secret-credential customer@example.test https://provider.test/key?token=private SELECT private_payload";
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production");
  for (const [key, value] of Object.entries({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "true",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://reporting.orbittravel.co.uk/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "offline-orbit-key-" + "a".repeat(40),
    HQ_PORTAL_SYNC_TOKEN: "offline-portal-token-" + "b".repeat(40),
  }))
    vi.stubEnv(key, value);
  vi.stubGlobal("fetch", m.provider);
  m.provider.mockReset().mockImplementation(() => {
    throw new Error("real provider forbidden");
  });
  m.rows = Array.from({ length: 9 }, () => [{ ...fresh }]);
  m.dbError = null;
  state = await runHqImplementedSampleScenario("initial");
  live = {
    ...buildHqLiveStatus(createHqLiveConfig().status()),
    health: "ready",
    hasPublished: true,
    stateVersion: 8,
    generationId: state.metadata.generationId,
    sourceAgeSeconds: 12,
    isStale: false,
    lastSuccessfulCheckAt: "2026-11-24T12:00:00Z",
    lastPublishedAt: "2026-11-24T11:59:00Z",
  };
  m.published.mockReset().mockImplementation(async () => state);
  m.status.mockReset().mockImplementation(async () => ({ ...live }));
  m.sampleRead.mockReset();
  m.owner.mockReset().mockResolvedValue({
    userId: 101,
    uniqueAgentId: "JLT101",
    role: "agent",
    name: "Existing Portal Owner",
  });
  m.staff.mockReset().mockResolvedValue({
    userId: 102,
    uniqueAgentId: "JLT102",
    role: "staff",
    name: "Existing Assigned Staff",
  });
  m.directory.mockReset().mockImplementation(() => ({
    resolve: async () => null,
    resolveCurrentOwner: m.owner,
    resolveAssignedStaff: m.staff,
  }));
  const engine = await vi.importActual<any>("./management-hq-engine");
  m.csv.mockReset().mockImplementation(engine.exportHqReportCsv);
});
afterEach(() => {
  expect(m.provider).not.toHaveBeenCalled();
  expect(m.sampleRead).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("actual HQ router production read boundaries", () => {
  it("flags off is disabled with no dataset reads", async () => {
    vi.stubEnv("HQ_LIVE_SYNC_ENABLED", "false");
    vi.stubEnv("HQ_LIVE_READ_ENABLED", "false");
    expect(await caller().status()).toMatchObject({
      reportMode: "disabled",
      liveConfigured: false,
      sampleEnabled: false,
      hasSample: false,
    });
    await expect(caller().report({ year: 2026 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(m.published).not.toHaveBeenCalled();
  });
  it.each(["TRUE", " true", "1"])(
    "malformed live flag %s cannot fall back to samples",
    async flag => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("HQ_LIVE_READ_ENABLED", flag);
      expect(await caller().status()).toMatchObject({
        reportMode: "live",
        sampleEnabled: false,
        liveConfigured: false,
      });
      await expect(
        caller().sample({ scenario: "initial", expectedVersion: null })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(caller().report({ year: 2026 })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(m.published).not.toHaveBeenCalled();
    }
  );
  it("missing live source configuration does not report healthy zero", async () => {
    vi.stubEnv("HQ_ORBIT_REPORTING_API_KEY", "");
    expect(await caller().status()).toMatchObject({
      reportMode: "live",
      liveConfigured: false,
    });
    await expect(caller().exportCsv({ year: 2026 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(m.published).not.toHaveBeenCalled();
  });
  it("valid shared publication uses only the real directory and preserves unknown seller/finance", async () => {
    const result = await caller().report({ year: 2026 });
    expect(result).toMatchObject({
      sourceMode: "live",
      liveReady: false,
      stateVersion: 8,
      sourceAgeSeconds: 12,
    });
    expect(result.bookings[0]).toMatchObject({
      seller: null,
      processor: null,
      currentOwner: { userId: 101 },
      assignedStaff: { userId: 102 },
      attributionState: "provisional_current_owner",
    });
    expect(result.bookings[0].financials.settledJltIncome).toBeNull();
    expect(result.limitations.join(" ")).not.toContain(
      "offline local examples"
    );
    expect(result.limitations.join(" ")).toContain(
      "acceptance is not yet verified"
    );
    expect(m.directory).toHaveBeenCalledOnce();
  });
  it("exports bounded LIVE CSV using existing report calculations", async () => {
    const result = await caller().exportCsv({ year: 2026, month: 1 });
    expect(result.filename).toBe("management-hq-LIVE-2026-01.csv");
    expect(result.csv).toContain("SYN-HQ-1");
    expect(result.csv).not.toContain("Synthetic Current Owner");
    expect(m.csv).toHaveBeenCalledOnce();
    expect(wrappedCsv).toBeDefined();
  });
  it.each(["report", "exportCsv"] as const)(
    "absent publication denies %s rather than sample/zero fallback",
    async op => {
      m.published.mockResolvedValue(null);
      await expect(caller()[op]({ year: 2026 })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(m.directory).not.toHaveBeenCalled();
    }
  );
  it.each(["report", "exportCsv"] as const)(
    "downgraded authority mid-%s suppresses all values",
    async op => {
      m.rows = [[fresh], [{ ...fresh, role: "admin" }]];
      await expect(caller()[op]({ year: 2026 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  );
  it("status authority downgrade suppresses safe status as well", async () => {
    m.rows = [[fresh], [{ ...fresh, isActive: false }]];
    await expect(caller().status()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it.each(["report", "exportCsv"] as const)(
    "read flag switched off after %s read suppresses cached results",
    async op => {
      m.owner.mockImplementation(async () => {
        vi.stubEnv("HQ_LIVE_READ_ENABLED", "false");
        return null;
      });
      await expect(caller()[op]({ year: 2026 })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    }
  );
  it("source binding changed during read cannot return data", async () => {
    m.owner.mockImplementation(async () => {
      vi.stubEnv("HQ_ORBIT_REPORTING_API_KEY", "rotated-" + "x".repeat(40));
      return null;
    });
    await expect(caller().report({ year: 2026 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("configuration change during CSV serialization is denied after serialization", async () => {
    m.csv.mockImplementation(() => {
      vi.stubEnv("HQ_LIVE_READ_ENABLED", "false");
      return "PRIVATE CSV";
    });
    await expect(caller().exportCsv({ year: 2026 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("post-read store error or concurrent generation denies all values", async () => {
    m.status.mockResolvedValueOnce(live).mockResolvedValueOnce({
      ...live,
      hasPublished: false,
      lastErrorCode: "STORE_UNAVAILABLE",
      health: "needs_attention",
    });
    await expect(caller().report({ year: 2026 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    m.rows = Array.from({ length: 5 }, () => [fresh]);
    m.status
      .mockReset()
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce({ ...live, stateVersion: 9 });
    await expect(caller().exportCsv({ year: 2026 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it.each(["sql", "source", "merge", "trpc", "trpc-prefix"])(
    "%s failures expose no provider/SQL credentials",
    async failure => {
      if (failure === "sql") m.dbError = new Error(secret);
      if (failure === "source")
        m.published.mockRejectedValue(new Error(secret));
      if (failure === "merge") m.owner.mockRejectedValue(new Error(secret));
      if (failure === "trpc")
        m.published.mockRejectedValue(
          new TRPCError({ code: "PRECONDITION_FAILED", message: secret })
        );
      if (failure === "trpc-prefix")
        m.published.mockRejectedValue(
          new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Management HQ live reporting is " + secret,
          })
        );
      const error = await caller()
        .report({ year: 2026 })
        .catch(error => error);
      expect(error.code).toBe("PRECONDITION_FAILED");
      expect(error.message).not.toMatch(
        /secret|customer@|provider\.test|SELECT|private_payload/
      );
    }
  );
  it("transient source backoff still allows only the complete last-good report", async () => {
    live = {
      ...live,
      health: "backoff",
      lastErrorCode: "TIMEOUT",
      isStale: true,
      sourceAgeSeconds: 2000,
    };
    const result = await caller().report({ year: 2026 });
    expect(result).toMatchObject({
      sourceMode: "live",
      stale: true,
      sourceAgeSeconds: 2000,
    });
  });
  it("source stale flag and source freshness target cannot be weakened", async () => {
    state.metadata.freshnessTargetSeconds = 60;
    state.metadata.stale = false;
    live.sourceAgeSeconds = 120;
    expect(await caller().report({ year: 2026 })).toMatchObject({
      stale: true,
      freshnessTargetSeconds: 60,
    });
    state.metadata.stale = true;
    live.sourceAgeSeconds = 1;
    expect(
      withHqLiveReportMetadata({ limitations: [] } as any, state, live).stale
    ).toBe(true);
  });
  it("request-local directory memoizes equal source links and preserves rejected strict merges", async () => {
    const resolve = vi.fn().mockResolvedValue(null);
    const directory = memoizeHqReportDirectory({
      resolve: async () => null,
      resolveCurrentOwner: resolve,
    });
    await directory.resolveCurrentOwner!({ memberJltAgentId: "JLT101" } as any);
    await directory.resolveCurrentOwner!({ memberJltAgentId: "JLT101" } as any);
    expect(resolve).toHaveBeenCalledOnce();
    const failed = vi
      .fn()
      .mockRejectedValue(new Error("strict merge unavailable"));
    const failing = memoizeHqReportDirectory({
      resolve: async () => null,
      resolveCurrentOwner: failed,
    });
    await expect(failing.resolveCurrentOwner!({} as any)).rejects.toThrow();
    await expect(failing.resolveCurrentOwner!({} as any)).rejects.toThrow();
    expect(failed).toHaveBeenCalledOnce();
    const next = memoizeHqReportDirectory({
      resolve: async () => null,
      resolveCurrentOwner: resolve,
    });
    await next.resolveCurrentOwner!({ memberJltAgentId: "JLT101" } as any);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it.each(["resolve", "resolveCurrentOwner", "resolveAssignedStaff"] as const)(
    "fresh guard brackets successful and rejected %s lookups without sharing cache across reports",
    async method => {
      for (const fails of [false, true]) {
        const events: string[] = [];
        const lookup = vi.fn(async () => {
          events.push("lookup");
          if (fails) throw new Error("strict merge unavailable");
          return null;
        });
        const guard = vi.fn(async () => {
          events.push("guard");
        });
        const directory = memoizeHqReportDirectory(
          {
            resolve: lookup,
            resolveCurrentOwner: lookup,
            resolveAssignedStaff: lookup,
          },
          guard
        );
        const first = directory[method]!({} as any);
        if (fails)
          await expect(first).rejects.toThrow("strict merge unavailable");
        else await expect(first).resolves.toBeNull();
        expect(events).toEqual(["guard", "lookup", "guard"]);
        if (method !== "resolve") {
          const second = directory[method]!({} as any);
          expect(second).toBe(first);
          if (fails)
            await expect(second).rejects.toThrow("strict merge unavailable");
          else await expect(second).resolves.toBeNull();
          expect(lookup).toHaveBeenCalledOnce();
          expect(guard).toHaveBeenCalledTimes(2);
        }
      }
    }
  );
  it("revoked pre-lookup guard prevents a read and revoked post-failure guard overrides the failed lookup", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("private lookup failure");
    });
    const revoked = new Error("fixed revoked access");
    const guard = vi.fn(async () => {
      throw revoked;
    });
    await expect(
      memoizeHqReportDirectory({ resolve: lookup }, guard).resolve({} as any)
    ).rejects.toBe(revoked);
    expect(lookup).not.toHaveBeenCalled();
    guard.mockResolvedValueOnce(undefined);
    await expect(
      memoizeHqReportDirectory({ resolve: lookup }, guard).resolve({} as any)
    ).rejects.toBe(revoked);
    expect(lookup).toHaveBeenCalledOnce();
  });
  it("rejects arbitrary URL/key/source payloads on live report inputs", async () => {
    await expect(
      caller().report({
        year: 2026,
        sourceUrl: "https://evil.test",
        key: "private",
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(m.published).not.toHaveBeenCalled();
  });
});
