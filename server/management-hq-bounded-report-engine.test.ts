import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HqReport } from "../shared/management-hq-report";
import type {
  HqWireEntity,
  HqWirePageQuery,
} from "../shared/management-hq-wire";
import {
  canonicalHqJson,
  exportHqReportCsv,
  getHqReport,
  type HqState,
} from "./management-hq-engine";
import {
  createHqSampleBooking,
  createHqSampleDirectory,
  createHqSampleEnvelope,
  runHqSampleScenario,
} from "./management-hq-fixtures";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import type { HqImplementedState } from "./management-hq-ingestion";
import { validateHqInitialPublication } from "./management-hq-initial-validation";
import type { HqLiveStatusDto } from "./management-hq-live-service";
import { getHqLiveReport } from "./management-hq-live-report";

vi.mock("./agent-merge-identity", () => ({
  getAgentMergeTarget: vi.fn(async () => null),
}));
const CAP = 16 * 1024 * 1024;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const combined = (report: HqReport) =>
  [...report.bookings, ...report.undatedExceptions].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
const aggregates = (report: HqReport) => ({
  totals: report.totals,
  cohorts: report.cohorts,
  monthly: report.monthly,
  agents: report.agents,
  filters: report.filters,
});
function population(count = 79): HqState {
  const envelope = createHqSampleEnvelope();
  const records: HqState["records"] = {};
  for (let i = count; i > 0; i--) {
    const booking = createHqSampleBooking({ id: String(i) });
    if (i % 4 === 0) {
      booking.dates.managementReportingDate = null;
      booking.eligibility.dated = false;
    }
    records[booking.id] = {
      revision: booking.revision,
      tombstone: false,
      booking,
      canonicalPayload: canonicalHqJson(booking),
      tombstoneReason: null,
    };
  }
  return {
    version: 1,
    scopeId: envelope.scopeId,
    watermark: envelope.watermark,
    envelope,
    records,
  };
}
function offlineDb() {
  const select = vi.fn(() => {
    const q: any = {
      from: () => q,
      where: () => q,
      limit: async () => [],
    };
    return q;
  });
  return { select };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HQ bounded detail selection keeps the original engine and caps", () => {
  it("partitions every dated and undated row without duplicates or skips, retaining every financial field and full aggregates", async () => {
    const state = population();
    const before = canonicalHqJson(state);
    const full = await getHqReport(state, createHqSampleDirectory(), {
      year: 2026,
    });
    const expected = combined(full);
    const actual: HqReport["bookings"] = [];
    for (let page = 0; page < Math.ceil(expected.length / 25); page++) {
      const report = await getHqReport(
        state,
        createHqSampleDirectory(),
        { year: 2026 },
        { details: { kind: "page", page } }
      );
      expect(report).toMatchObject({
        status: "available",
        exportComplete: false,
        detailMode: "page",
        detailPage: {
          page,
          pageSize: 25,
          totalRows: expected.length,
          totalsComplete: true,
        },
      });
      expect(aggregates(report)).toEqual(aggregates(full));
      expect(combined(report)).toEqual(
        expected.slice(page * 25, (page + 1) * 25)
      );
      actual.push(...combined(report));
      expect(() => exportHqReportCsv(report)).toThrow(
        "complete bounded report required"
      );
    }
    expect(actual).toEqual(expected);
    expect(new Set(actual.map(row => row.id)).size).toBe(expected.length);
    expect(canonicalHqJson(state)).toBe(before);
    const summary = await getHqReport(
      state,
      createHqSampleDirectory(),
      { year: 2026 },
      { details: { kind: "summary" } }
    );
    expect(summary).toMatchObject({
      status: "available",
      detailMode: "summary",
      bookings: [],
      undatedExceptions: [],
      exportComplete: false,
    });
    expect(summary.detailPage).toBeUndefined();
    expect(aggregates(summary)).toEqual(aggregates(full));
    expect(() => exportHqReportCsv(summary)).toThrow();
  });
  it.each([0, 1, 25])(
    "page zero for %i rows retains the exact old DTO and CSV bytes",
    async count => {
      const state = population(count);
      const full = await getHqReport(state, createHqSampleDirectory(), {
        year: 2026,
      });
      const page = await getHqReport(
        state,
        createHqSampleDirectory(),
        { year: 2026 },
        { details: { kind: "page", page: 0 } }
      );
      expect(JSON.stringify(page)).toBe(JSON.stringify(full));
      expect(exportHqReportCsv(page)).toBe(exportHqReportCsv(full));
      expect(page.exportComplete).toBe(true);
      const summary = await getHqReport(
        state,
        createHqSampleDirectory(),
        { year: 2026 },
        { details: { kind: "summary" } }
      );
      expect(summary.exportComplete).toBe(count === 0);
    }
  );
  it.each([-1, 0.5, 800, NaN, Infinity, "1", null, undefined])(
    "rejects invalid engine page %j without clamping",
    async page => {
      await expect(
        getHqReport(population(), createHqSampleDirectory(), { year: 2026 }, {
          details: { kind: "page", page },
        } as any)
      ).rejects.toThrow("Invalid HQ report detail page");
    }
  );
  it.each([4, 799])(
    "rejects population-out-of-range page %i instead of returning another page",
    async page => {
      await expect(
        getHqReport(
          population(),
          createHqSampleDirectory(),
          { year: 2026 },
          { details: { kind: "page", page } }
        )
      ).rejects.toThrow("out of range");
    }
  );
  it("bounds pages against filtered rows, including undated-only and empty publications", async () => {
    const state = population();
    const page = await getHqReport(
      state,
      createHqSampleDirectory(),
      { year: 2026, month: 4 },
      { details: { kind: "page", page: 0 } }
    );
    expect(page.bookings).toEqual([]);
    expect(page.undatedExceptions).toHaveLength(19);
    expect(page.exportComplete).toBe(true);
    await expect(
      getHqReport(
        state,
        createHqSampleDirectory(),
        { year: 2026, month: 4 },
        { details: { kind: "page", page: 1 } }
      )
    ).rejects.toThrow("out of range");
    await expect(
      getHqReport(
        population(0),
        createHqSampleDirectory(),
        { year: 2026 },
        { details: { kind: "page", page: 1 } }
      )
    ).rejects.toThrow("out of range");
  });
  it("deduplicates the sorted combined page membership by booking ID only", async () => {
    const state = population();
    state.records.alias = copy(state.records["1"]);
    const page = await getHqReport(
      state,
      createHqSampleDirectory(),
      { year: 2026 },
      { details: { kind: "page", page: 0 } }
    );
    expect(page.detailPage?.totalRows).toBe(79);
    expect(new Set(combined(page).map(row => row.id)).size).toBe(25);
  });
  it("summary and page never bypass off-page field, identity or canonical-person failures", async () => {
    for (const details of [
      { kind: "summary" } as const,
      { kind: "page", page: 0 } as const,
    ]) {
      const state = population();
      state.records["79"].booking!.financials.ptsAssumptions = [
        "x".repeat(513),
      ];
      expect(
        await getHqReport(
          state,
          createHqSampleDirectory(),
          { year: 2026 },
          { details }
        )
      ).toMatchObject({
        status: "unavailable",
        unavailableReason: "REPORT_FIELD_CAP_EXCEEDED",
        bookings: [],
        undatedExceptions: [],
        exportComplete: false,
      });
      const clean = population();
      expect(
        await getHqReport(
          clean,
          {
            resolve: async () => {
              throw new Error("private");
            },
          },
          { year: 2026 },
          { details }
        )
      ).toMatchObject({
        status: "unavailable",
        unavailableReason: "IDENTITY_DIRECTORY_UNAVAILABLE",
        bookings: [],
        exportComplete: false,
      });
      let n = 0;
      expect(
        await getHqReport(
          clean,
          {
            resolve: async () => ({
              userId: 101,
              name: `Conflicting ${n++}`,
              role: "agent",
              uniqueAgentId: "SAME",
            }),
          },
          { year: 2026 },
          { details }
        )
      ).toMatchObject({
        status: "unavailable",
        unavailableReason: "DIRECTORY_CANONICAL_IDENTITY_CONFLICT",
        bookings: [],
        exportComplete: false,
      });
      const tooMany = population(0);
      const record = population(1).records["1"];
      tooMany.records = Object.fromEntries(
        Array.from({ length: 20001 }, (_, i) => [String(i), record])
      );
      expect(
        await getHqReport(
          tooMany,
          createHqSampleDirectory(),
          { year: 2026 },
          { details }
        )
      ).toMatchObject({
        status: "unavailable",
        unavailableReason: "REPORT_ROW_CAP_EXCEEDED",
        exportComplete: false,
      });
    }
  });
  it("summary still applies the original final 16 MiB output cap to non-detail content", async () => {
    const state = await runHqSampleScenario("initial");
    state.envelope.coverage.limitations = ["x".repeat(CAP)];
    expect(
      await getHqReport(
        state,
        createHqSampleDirectory(),
        { year: 2026 },
        { details: { kind: "summary" } }
      )
    ).toMatchObject({
      status: "unavailable",
      unavailableReason: "REPORT_BYTE_CAP_EXCEEDED",
      bookings: [],
      exportComplete: false,
    });
  });
  it("retains exactly 20,000 entities and allows the last fixed page 799", async () => {
    const state = population(20000);
    const report = await getHqReport(
      state,
      { resolve: async () => null },
      { year: 2026 },
      { details: { kind: "page", page: 799 } }
    );
    expect(report).toMatchObject({
      status: "available",
      detailPage: { page: 799, totalRows: 20000, totalsComplete: true },
      exportComplete: false,
    });
    expect(combined(report)).toHaveLength(25);
  }, 30000);
});

/** Source-fixture-shaped publication assembled pagewise, not huge repeated SQL/CAS.
 * Full financial payloads and canonical strings remain intact. The extra business
 * entities are valid fixture copies, not claims about observed production people. */
async function fullSizePublication(): Promise<HqImplementedState> {
  const reader = createHqLargeSyntheticReader({
    bookingCount: 8115,
    paddingBytes: 8000,
  });
  const { ready: _ready, ...metadata } = await reader.status();
  const state: HqImplementedState = {
    wireVersion: "1.0.0",
    version: 1,
    scope: metadata.scope,
    resumeCursor: "",
    seqProofs: {},
    entities: {},
    metadata,
  };
  const put = (entity: HqWireEntity) => {
    state.entities[`${entity.entityType}:${entity.entityId}`] = {
      entity,
      canonicalPayload: canonicalHqJson(entity),
      absent: false,
    };
  };
  for (const read of [reader.bookings, reader.businessMappings]) {
    let query: HqWirePageQuery | undefined;
    while (true) {
      const page = await read(query);
      state.resumeCursor = page.resumeCursor;
      page.items.forEach(put);
      if (page.nextCursor === null) break;
      query = { cursor: page.nextCursor };
    }
  }
  const template = Object.values(state.entities).find(
    r => r.entity.entityType === "business"
  )!.entity;
  for (let index = 3; index < 518; index++) {
    const entity = copy(template);
    entity.entityId = 820000001 + index;
    entity.revision = 8116 + index;
    const payload = entity.payload as any;
    payload.orbitTenantId = entity.entityId;
    payload.identity.orbitTenantId = entity.entityId;
    for (const member of [
      ...payload.identity.members,
      ...payload.identity.ownerCandidates,
    ])
      member.tenantId = entity.entityId;
    put(entity);
  }
  state.metadata.counts = { bookingCount: 8115, businessCount: 518 };
  state.metadata.changeUpper = 8633;
  state.metadata.sourceObservationWindow = {
    from: "2026-11-27T16:59:58.000Z",
    to: "2026-11-27T16:59:59.000Z",
  };
  state.metadata.publishedAt = "2026-11-27T17:00:00.000Z";
  state.metadata.expiresAt = "2026-11-28T17:00:00.000Z";
  return state;
}
function canonicalDigest(state: HqImplementedState) {
  const hash = createHash("sha256");
  for (const key of Object.keys(state.entities).sort()) {
    const record = state.entities[key];
    expect(record.canonicalPayload).toBe(canonicalHqJson(record.entity));
    hash
      .update(key)
      .update(record.canonicalPayload)
      .update(String(record.absent));
  }
  return hash.digest("hex");
}
describe("actual full-size offline source fixture, original output cap", () => {
  it("keeps all 8633 canonical entities and exact whole-publication totals while full DTO is denied and summary/page/initial checks stay bounded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-11-27T17:00:00.000Z");
    const network = vi.fn(() => {
      throw new Error("Network forbidden");
    });
    vi.stubGlobal("fetch", network);
    const state = await fullSizePublication();
    expect(Object.keys(state.entities)).toHaveLength(8633);
    const before = canonicalDigest(state);
    const db = offlineDb();
    let fullBytes = 0;
    const stringify = JSON.stringify;
    const observer = vi.spyOn(JSON, "stringify").mockImplementation(((
      value: any,
      ...args: any[]
    ) => {
      const text = (stringify as any)(value, ...args);
      if (value?.status === "available" && value?.bookings?.length === 8115)
        fullBytes = Buffer.byteLength(text);
      return text;
    }) as typeof JSON.stringify);
    const full = await getHqLiveReport(state, db, { year: 2026 }).catch(
      error => error
    );
    observer.mockRestore();
    expect(full).toBeInstanceOf(Error);
    expect(full.message).toBe("HQ_REPORT_UNAVAILABLE");
    expect(fullBytes).toBeGreaterThan(CAP);
    const denied = await getHqReport(
      state,
      { resolve: async () => null },
      { year: 2026 }
    );
    expect(denied).toMatchObject({
      status: "unavailable",
      unavailableReason: "REPORT_BYTE_CAP_EXCEEDED",
      exportComplete: false,
      bookings: [],
      undatedExceptions: [],
    });
    expect(() => exportHqReportCsv(denied)).toThrow();
    const summary = await getHqLiveReport(
      state,
      db,
      { year: 2026 },
      undefined,
      { details: { kind: "summary" } }
    );
    const page = await getHqLiveReport(state, db, { year: 2026 }, undefined, {
      details: { kind: "page", page: 0 },
    });
    expect(summary).toMatchObject({
      status: "available",
      detailMode: "summary",
      exportComplete: false,
      bookings: [],
      undatedExceptions: [],
      totals: {
        bookingCount: 4869,
        grossSales: { knownSum: "5842800.00" },
        grossProfit: { knownSum: "973800.00" },
      },
      cohorts: { pendingCount: 3246, cancelledCount: 1623 },
    });
    expect(aggregates(page)).toEqual(aggregates(summary));
    expect(page.detailPage).toEqual({
      page: 0,
      pageSize: 25,
      totalRows: 8115,
      totalsComplete: true,
    });
    expect(combined(page)).toHaveLength(25);
    expect(combined(page)[0].financials).toHaveProperty("amountStates");
    const safe = {
      configured: true,
      syncEnabled: true,
      readEnabled: false,
      hasPublished: true,
      health: "ready",
      stageStatus: "applied",
      progress: null,
      lastErrorCode: null,
      recoveryGuidance: null,
      isStale: false,
      generationId: state.metadata.generationId,
      stateVersion: 8,
      sourceObservationAt: state.metadata.sourceObservationWindow.to,
      sourcePublishedAt: state.metadata.publishedAt,
      sourceAgeSeconds: 1,
      freshnessTargetSeconds: 900,
      lastSuccessfulCheckAt: state.metadata.publishedAt,
    } as HqLiveStatusDto;
    const guard = vi.fn(async () => undefined);
    const checked = await validateHqInitialPublication(state, db, safe, guard);
    expect(checked).toMatchObject({
      status: "checks_ready",
      manualChecksPending: true,
      years: [
        {
          year: 2026,
          activeBookings: 4869,
          pendingBookings: 3246,
          cancelledBookings: 1623,
          grossSales: "5842800.00",
          grossProfit: "973800.00",
        },
      ],
    });
    expect(guard.mock.calls.length).toBeGreaterThanOrEqual(3);
    const summaryBytes = Buffer.byteLength(JSON.stringify(summary));
    const pageBytes = Buffer.byteLength(JSON.stringify(page));
    expect(summaryBytes).toBeLessThan(CAP);
    expect(pageBytes).toBeLessThan(CAP);
    expect(Buffer.byteLength(JSON.stringify(checked))).toBeLessThan(CAP);
    expect(Object.keys(state.entities)).toHaveLength(8633);
    expect(canonicalDigest(state)).toBe(before);
    expect(network).not.toHaveBeenCalled();
    console.info("bounded full-size proof", {
      fullBytes,
      summaryBytes,
      pageBytes,
      canonicalEntities: 8633,
      canonicalSha256: before,
    });
  }, 120000);
});
