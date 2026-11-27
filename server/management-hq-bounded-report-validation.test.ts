import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HqReport } from "../shared/management-hq-report";
import { canonicalHqJson, getHqReport } from "./management-hq-engine";
import { runHqImplementedSampleScenario } from "./management-hq-implemented-fixtures";
import type { HqImplementedState } from "./management-hq-ingestion";
import type { HqLiveStatusDto } from "./management-hq-live-service";
import { validateHqInitialPublication } from "./management-hq-initial-validation";
import * as live from "./management-hq-live-report";

vi.mock("./agent-merge-identity", () => ({
  getAgentMergeTarget: vi.fn(async () => null),
}));
const NOW = "2026-11-27T17:00:00.000Z";
let state: HqImplementedState;
let safe: HqLiveStatusDto;
function offlineDb(onRead?: () => void) {
  const select = vi.fn(() => {
    const q: any = {
      from: () => q,
      where: () => q,
      limit: async () => {
        onRead?.();
        return [];
      },
    };
    return q;
  });
  return { select };
}
function suppressed(
  result: Awaited<ReturnType<typeof validateHqInitialPublication>>
) {
  expect(result).toMatchObject({
    status: "needs_attention",
    generationId: null,
    years: [],
    manualChecksPending: true,
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state = await runHqImplementedSampleScenario("initial");
  state.metadata.sourceObservationWindow = {
    from: "2026-11-27T16:59:58.000Z",
    to: "2026-11-27T16:59:59.000Z",
  };
  state.metadata.publishedAt = NOW;
  state.metadata.expiresAt = "2026-11-28T17:00:00.000Z";
  state.metadata.sourceAgeSeconds = 1;
  safe = {
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
    lastSuccessfulCheckAt: NOW,
  } as HqLiveStatusDto;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("initial checks accept only complete engine summary semantics", () => {
  it("forwards summary as the fifth live option while retaining the fourth fresh guard", async () => {
    const spy = vi.spyOn(live, "getHqLiveReport");
    const guard = vi.fn(async () => undefined);
    const result = await validateHqInitialPublication(
      state,
      offlineDb(),
      safe,
      guard
    );
    expect(result.status).toBe("checks_ready");
    expect(spy).toHaveBeenCalledWith(
      state,
      expect.anything(),
      { year: 2026 },
      expect.any(Function),
      { details: { kind: "summary" } }
    );
    const report = (await spy.mock.results[0].value) as HqReport;
    expect(report).toMatchObject({
      detailMode: "summary",
      exportComplete: false,
      bookings: [],
      undatedExceptions: [],
    });
    expect(result.years[0]).toMatchObject({
      activeBookings: 1,
      grossSales: "10000.00",
      grossProfit: "1500.00",
    });
    expect(guard.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it("retains compatibility with complete old engine DTOs", async () => {
    const full = await getHqReport(
      state,
      { resolve: async () => null },
      { year: 2026 }
    );
    expect(full.detailMode).toBeUndefined();
    vi.spyOn(live, "getHqLiveReport").mockResolvedValueOnce(full);
    expect(
      (await validateHqInitialPublication(state, offlineDb(), safe)).status
    ).toBe("checks_ready");
  });
  it.each([
    "unmarked",
    "page",
    "summary-with-rows",
    "summary-with-page",
    "unavailable",
    "bad-currency",
    "bad-scope",
    "bad-year",
    "bad-month",
    "bad-money",
    "bad-count",
    "bad-generation",
    "bad-publication",
  ])(
    "denies %s rather than accepting partial or mismatched financial checks",
    async kind => {
      const report = await getHqReport(
        state,
        { resolve: async () => null },
        { year: 2026 },
        { details: { kind: "summary" } }
      );
      switch (kind) {
        case "unmarked":
          delete report.detailMode;
          break;
        case "page":
          report.detailMode = "page";
          break;
        case "summary-with-rows":
          report.bookings = (
            await getHqReport(
              state,
              { resolve: async () => null },
              { year: 2026 }
            )
          ).bookings;
          break;
        case "summary-with-page":
          report.detailPage = {
            page: 0,
            pageSize: 25,
            totalRows: 1,
            totalsComplete: true,
          };
          break;
        case "unavailable":
          report.status = "unavailable";
          break;
        case "bad-currency":
          (report as any).currency = "EUR";
          break;
        case "bad-scope":
          report.scopeId = "PRIVATE";
          break;
        case "bad-year":
          report.filters.year = 2025;
          break;
        case "bad-month":
          report.filters.month = 1;
          break;
        case "bad-money":
          report.totals.grossSales.knownSum = "1000.001";
          break;
        case "bad-count":
          report.totals.bookingCount = 0.5;
          break;
        case "bad-generation":
          report.generationId!++;
          break;
        case "bad-publication":
          report.publishedAt = "2026-11-27T17:00:01.000Z";
          break;
      }
      vi.spyOn(live, "getHqLiveReport").mockResolvedValueOnce(report);
      suppressed(await validateHqInitialPublication(state, offlineDb(), safe));
    }
  );
  it.each([
    "future-source",
    "future-published",
    "future-check",
    "stale-source",
    "stale-status",
    "expired",
    "canonical",
    "count",
    "children",
    "authority",
  ])("summary mode cannot weaken %s publication validation", async kind => {
    const db = offlineDb();
    let guard: (() => Promise<void>) | undefined;
    switch (kind) {
      case "future-source":
        state.metadata.sourceObservationWindow.to = "2026-11-27T17:00:01.000Z";
        safe.sourceObservationAt = state.metadata.sourceObservationWindow.to;
        break;
      case "future-published":
        state.metadata.publishedAt = "2026-11-27T17:00:01.000Z";
        safe.sourcePublishedAt = state.metadata.publishedAt;
        break;
      case "future-check":
        safe.lastSuccessfulCheckAt = "2026-11-27T17:00:01.000Z";
        break;
      case "stale-source":
        state.metadata.stale = true;
        break;
      case "stale-status":
        safe.isStale = true;
        break;
      case "expired":
        state.metadata.expiresAt = "2026-11-27T16:59:59.000Z";
        break;
      case "canonical":
        Object.values(state.entities)[0].canonicalPayload = "PRIVATE";
        break;
      case "count":
        state.metadata.counts.bookingCount = 2;
        break;
      case "children": {
        const row = Object.values(state.entities).find(
          r => r.entity.entityType === "booking"
        )!;
        row.entity.payload.childrenComplete = false;
        row.canonicalPayload = canonicalHqJson(row.entity);
        break;
      }
      case "authority":
        guard = async () => {
          throw new Error("PRIVATE authority revoked");
        };
        break;
    }
    suppressed(await validateHqInitialPublication(state, db, safe, guard));
    expect(db.select).not.toHaveBeenCalled();
  });
  it.each(["authority", "elapsed", "generation", "version"])(
    "suppresses all summary rows when %s changes during the actual directory await",
    async change => {
      let revoked = false;
      const db = offlineDb(() => {
        if (change === "authority") revoked = true;
        if (change === "elapsed") vi.setSystemTime(Date.parse(NOW) + 901000);
        if (change === "generation") state.metadata.generationId++;
        if (change === "version") safe.stateVersion!++;
      });
      suppressed(
        await validateHqInitialPublication(state, db, safe, async () => {
          if (revoked) throw new Error("PRIVATE revoked");
        })
      );
      expect(db.select).toHaveBeenCalled();
    }
  );
});
