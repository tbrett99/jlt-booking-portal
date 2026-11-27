import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HqImplementedState } from "./management-hq-ingestion";
const m = vi.hoisted(() => ({
  rows: [] as any[][],
  published: vi.fn(),
  status: vi.fn(),
  sampleRead: vi.fn(),
  owner: vi.fn(),
  staff: vi.fn(),
  provider: vi.fn(),
  csv: vi.fn(),
  report: vi.fn(),
}));
vi.mock("./business-staff-access", () => ({
  getBusinessStaffAuthority: async () => null,
  assertBusinessStaffRouteAllowed: async () => undefined,
}));
vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => {
      const rows = m.rows.shift() ?? [];
      const q: any = { from: () => q, where: () => q, limit: async () => rows };
      return q;
    },
  }),
  getRawDbPool: async () => ({}),
}));
vi.mock("./management-hq-store", async () => ({
  ...(await vi.importActual<any>("./management-hq-store")),
  createHqSampleStore: () => ({ read: m.sampleRead }),
}));
vi.mock("./management-hq-live-service", async () => ({
  ...(await vi.importActual<any>("./management-hq-live-service")),
  createHqLiveService: () => ({
    getStatus: m.status,
    readPublished: m.published,
  }),
}));
vi.mock("./management-hq-identity", () => ({
  createPortalHqImplementedDirectory: () => ({
    resolve: async () => null,
    resolveCurrentOwner: m.owner,
    resolveAssignedStaff: m.staff,
  }),
}));
vi.mock("./management-hq-engine", async () => {
  const actual = await vi.importActual<any>("./management-hq-engine");
  return {
    ...actual,
    getHqReport: (...args: any[]) => m.report(...args),
    exportHqReportCsv: (...args: any[]) => m.csv(...args),
  };
});
import { managementHqRouter } from "./management-hq-router";
import { canonicalHqJson } from "./management-hq-engine";
import {
  runHqImplementedSampleScenario,
  createHqImplementedSampleDirectory,
} from "./management-hq-implemented-fixtures";
import { buildHqLiveStatus } from "./management-hq-live-service";
import { createHqLiveConfig } from "./management-hq-live-config";

const fresh = {
  id: 47,
  role: "super_admin",
  isActive: true,
  portalStatus: "active",
};
const caller = (user: any = fresh) =>
  managementHqRouter.createCaller({ user, req: {}, res: {} } as any);
let state: HqImplementedState;
let safe: ReturnType<typeof buildHqLiveStatus>;
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
  m.provider.mockReset().mockImplementation(() => {
    throw new Error("Network forbidden");
  });
  vi.stubGlobal("fetch", m.provider);
  m.rows = Array.from({ length: 30 }, () => [{ ...fresh }]);
  state = await runHqImplementedSampleScenario("initial");
  const template = Object.values(state.entities).find(
    r => r.entity.entityType === "booking"
  )!.entity;
  for (let index = 1; index < 61; index++) {
    const entity = JSON.parse(JSON.stringify(template));
    entity.entityId += index;
    entity.payload.orbitBookingId = entity.entityId;
    entity.payload.bookingRef = `BOUND-${index}`;
    if (index % 4 === 0) {
      entity.payload.dates = {
        ...entity.payload.dates,
        portalRegisteredAt: null,
        bookedOn: null,
        managementDate: null,
        dateSource: "unavailable",
        month: null,
      };
      entity.payload.eligibility.undated = true;
      entity.payload.eligibility.activeSalesHeadline = false;
      entity.payload.financials.headlineEligible = false;
    }
    state.entities[`booking:${entity.entityId}`] = {
      entity,
      canonicalPayload: canonicalHqJson(entity),
      absent: false,
    };
  }
  state.metadata.counts.bookingCount = 61;
  safe = {
    ...buildHqLiveStatus(createHqLiveConfig().status()),
    hasPublished: true,
    generationId: state.metadata.generationId,
    stateVersion: 8,
    health: "ready",
    isStale: false,
    sourceAgeSeconds: 12,
  };
  m.published.mockReset().mockImplementation(async () => state);
  m.status.mockReset().mockImplementation(async () => ({ ...safe }));
  m.sampleRead.mockReset().mockImplementation(async () => ({
    state,
    stateVersion: 1,
    updatedAt: new Date(),
  }));
  m.owner.mockReset().mockResolvedValue({
    userId: 101,
    name: "Owner",
    role: "agent",
    uniqueAgentId: "SYN-MEMBER-1",
  });
  m.staff.mockReset().mockResolvedValue(null);
  const actual = await vi.importActual<any>("./management-hq-engine");
  m.report.mockReset().mockImplementation(actual.getHqReport);
  m.csv.mockReset().mockImplementation(actual.exportHqReportCsv);
});
afterEach(() => {
  expect(m.provider).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const aggregates = (report: any) => ({
  totals: report.totals,
  cohorts: report.cohorts,
  monthly: report.monthly,
  agents: report.agents,
});
const ids = (report: any) =>
  [...report.bookings, ...report.undatedExceptions]
    .map(row => row.id)
    .sort((a, b) => a.localeCompare(b));

describe("actual HQ router bounded detail contract", () => {
  it("defaults to fixed page zero, forwards no page into filters, and partitions the complete sorted publication", async () => {
    const first = await caller().report({ year: 2026 });
    expect(first).toMatchObject({
      sourceMode: "live",
      exportComplete: false,
      detailMode: "page",
      detailPage: {
        page: 0,
        pageSize: 25,
        totalRows: 61,
        totalsComplete: true,
      },
    });
    expect(ids(first)).toHaveLength(25);
    expect(m.report.mock.calls[0][2]).toEqual({ year: 2026 });
    expect(m.report.mock.calls[0][3]).toEqual({
      details: { kind: "page", page: 0 },
    });
    const allIds = ids(first);
    for (const page of [1, 2]) {
      const report = await caller().report({ year: 2026, detailPage: page });
      expect(aggregates(report)).toEqual(aggregates(first));
      expect(report.filters).toEqual({ year: 2026, month: null });
      expect(report.detailPage?.page).toBe(page);
      allIds.push(...ids(report));
    }
    const actual = await vi.importActual<any>("./management-hq-engine");
    const full = await actual.getHqReport(
      state,
      {
        resolve: async () => null,
        resolveCurrentOwner: m.owner,
        resolveAssignedStaff: m.staff,
      },
      { year: 2026 }
    );
    expect(allIds).toEqual(ids(full));
    expect(new Set(allIds).size).toBe(61);
    expect(() => actual.exportHqReportCsv(first)).toThrow();
  });
  it.each([
    { detailPage: -1 },
    { detailPage: 0.5 },
    { detailPage: 800 },
    { detailPage: "1" },
    { detailPage: null },
    { detailPage: NaN },
    { page: 0 },
    { pageSize: 25 },
    { details: { kind: "summary" } },
    { sourceUrl: "https://evil.invalid" },
    { month: 13 },
    { year: 2101 },
  ])(
    "rejects strict report input %j before reading a publication",
    async extra => {
      await expect(
        caller().report({ year: 2026, ...extra } as any)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(m.published).not.toHaveBeenCalled();
      expect(m.report).not.toHaveBeenCalled();
    }
  );
  it.each([3, 799])(
    "rejects valid integer but population-out-of-range page %i with no clamping",
    async detailPage => {
      await expect(
        caller().report({ year: 2026, detailPage })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(m.report.mock.calls[0][3]).toEqual({
        details: { kind: "page", page: detailPage },
      });
    }
  );
  it.each([0, 1])(
    "CSV retains the original strict range and rejects detailPage %i",
    async detailPage => {
      await expect(
        caller().exportCsv({ year: 2026, detailPage } as any)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(m.published).not.toHaveBeenCalled();
      expect(m.csv).not.toHaveBeenCalled();
    }
  );
  it("CSV does a new uncached full read and preserves every original CSV byte on a small complete publication", async () => {
    const first = await caller().report({ year: 2026, detailPage: 1 });
    expect(first.exportComplete).toBe(false);
    const actual = await vi.importActual<any>("./management-hq-engine");
    const full = await actual.getHqReport(
      state,
      {
        resolve: async () => null,
        resolveCurrentOwner: m.owner,
        resolveAssignedStaff: m.staff,
      },
      { year: 2026 }
    );
    const csv = await caller().exportCsv({ year: 2026 });
    expect(csv.csv).toBe(actual.exportHqReportCsv(full));
    expect(csv.filename).toBe("management-hq-LIVE-2026.csv");
    expect(m.published).toHaveBeenCalledTimes(2);
    expect(m.report.mock.calls[1][2]).toEqual({ year: 2026 });
    expect(m.report.mock.calls[1][3]).toBeUndefined();
    expect(m.csv.mock.calls[0][0].exportComplete).toBe(true);
    expect(
      m.csv.mock.calls[0][0].bookings.length +
        m.csv.mock.calls[0][0].undatedExceptions.length
    ).toBe(61);
  });
  it("CSV rejects a partial report returned by a reader instead of exporting a page", async () => {
    const page = await caller().report({ year: 2026 });
    m.report.mockResolvedValueOnce(page);
    await expect(caller().exportCsv({ year: 2026 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("sample mode uses the same paged output and leaves export in the original full mode", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("HQ_LIVE_SYNC_ENABLED", "false");
    vi.stubEnv("HQ_LIVE_READ_ENABLED", "false");
    const report = await caller().report({ year: 2026, detailPage: 2 });
    expect(report).toMatchObject({
      sourceMode: "sample",
      detailPage: { page: 2, totalRows: 61 },
    });
    const actual = await vi.importActual<any>("./management-hq-engine");
    const full = await actual.getHqReport(
      state,
      createHqImplementedSampleDirectory(),
      { year: 2026 }
    );
    expect((await caller().exportCsv({ year: 2026 })).csv).toBe(
      actual.exportHqReportCsv(full)
    );
    expect(m.published).not.toHaveBeenCalled();
    expect(m.sampleRead).toHaveBeenCalledTimes(2);
  });
  it.each([
    "authority",
    "read-flag",
    "source-binding",
    "state-version",
    "generation",
    "missing-status",
  ])("paged read retains the final %s gate", async gate => {
    if (gate === "authority") m.rows = [[fresh], [{ ...fresh, role: "admin" }]];
    if (gate === "read-flag")
      m.owner.mockImplementation(async () => {
        vi.stubEnv("HQ_LIVE_READ_ENABLED", "false");
        return null;
      });
    if (gate === "source-binding")
      m.owner.mockImplementation(async () => {
        vi.stubEnv("HQ_ORBIT_REPORTING_API_KEY", "rotated-" + "x".repeat(40));
        return null;
      });
    if (gate === "state-version")
      m.status
        .mockResolvedValueOnce(safe)
        .mockResolvedValueOnce({ ...safe, stateVersion: 9 });
    if (gate === "generation")
      m.status
        .mockResolvedValueOnce(safe)
        .mockResolvedValueOnce({ ...safe, generationId: 999 });
    if (gate === "missing-status")
      m.status
        .mockResolvedValueOnce(safe)
        .mockResolvedValueOnce({ ...safe, hasPublished: false });
    await expect(
      caller().report({ year: 2026, detailPage: 1 })
    ).rejects.toMatchObject({
      code: gate === "authority" ? "FORBIDDEN" : "PRECONDITION_FAILED",
    });
  });
  it("export still checks uncached fresh authority after CSV serialization", async () => {
    m.rows = [[fresh], [fresh], [{ ...fresh, isActive: false }]];
    await expect(caller().exportCsv({ year: 2026 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.csv).toHaveBeenCalledOnce();
  });
});
