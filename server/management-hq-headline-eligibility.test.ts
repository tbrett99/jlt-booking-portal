import { describe, expect, it } from "vitest";
import examples from "./fixtures/management-hq-wire-http-examples.json";
import type {
  HqWireBookingPage,
  HqWireBookingPayload,
  HqWireChangePage,
  HqWireEntity,
  HqWireReader,
} from "../shared/management-hq-wire";
import {
  HqContractError,
  validateHqWireBookingPage,
  validateHqWireChangePage,
  validateHqWireEntity,
} from "./management-hq-wire-contract";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  validateHqImplementedSyncState,
} from "./management-hq-ingestion";
import {
  createHqImplementedSampleDirectory,
  createHqImplementedSampleReader,
} from "./management-hq-implemented-fixtures";
import { getHqReport } from "./management-hq-engine";

// All records are clones of the existing synthetic wire examples. No live
// reader, configuration, database, HTTP transport or financial helper is used.
const bookingPage = (): HqWireBookingPage =>
  structuredClone(examples.beforeAmendment.body) as HqWireBookingPage;
const changePage = (): HqWireChangePage =>
  structuredClone(examples.afterAmendment.body) as HqWireChangePage;
const cancelledPage = (): HqWireBookingPage =>
  structuredClone(examples.afterCancellation.body) as HqWireBookingPage;
const payload = (page: HqWireBookingPage | HqWireChangePage) =>
  page.items[0].payload as HqWireBookingPayload;
const storedEntity = (page: HqWireBookingPage): HqWireEntity => {
  const item = page.items[0];
  return structuredClone({
    entityType: item.entityType,
    entityId: item.entityId,
    revision: item.revision,
    payload: item.payload,
  }) as HqWireEntity;
};
const asChange = (page: HqWireBookingPage): HqWireChangePage => {
  const change = changePage();
  // Keep the supplied seq/revision/generation envelope; replace only the
  // synthetic aggregate, not its financial calculations.
  change.items[0].entityType = page.items[0].entityType;
  change.items[0].entityId = page.items[0].entityId;
  change.items[0].payload = structuredClone(page.items[0].payload);
  return change;
};
function acceptedEverywhere(page: HqWireBookingPage) {
  const entity = storedEntity(page);
  const change = asChange(page);
  expect(validateHqWireBookingPage(page)).toEqual(page);
  expect(validateHqWireChangePage(change)).toEqual(change);
  expect(validateHqWireEntity(entity)).toEqual(entity);
}
function rejectedEverywhere(page: HqWireBookingPage) {
  expect(() => validateHqWireBookingPage(page)).toThrow(HqContractError);
  expect(() => validateHqWireChangePage(asChange(page))).toThrow(
    HqContractError
  );
  expect(() => validateHqWireEntity(storedEntity(page))).toThrow(
    HqContractError
  );
}
function pending(page: HqWireBookingPage | HqWireChangePage) {
  const p = payload(page);
  p.status = "pending";
  p.financials.bookingStatus = "pending";
  p.eligibility.pending = true;
  p.eligibility.activeSalesHeadline = false;
  // Source financial headline includes pending; active sales does not.
  p.financials.headlineEligible = true;
  return page;
}
function undated(page: HqWireBookingPage) {
  const p = payload(page);
  p.portalRegisteredAt = null;
  p.bookedOn = null;
  Object.assign(p.dates, {
    portalRegisteredAt: null,
    bookedOn: null,
    managementDate: null,
    month: null,
    dateSource: "unavailable",
    issues: [],
  });
  p.eligibility.undated = true;
  p.eligibility.activeSalesHeadline = false;
  // A financial diagnostic is independent of the selected reporting date.
  p.financials.headlineEligible = true;
  return page;
}
async function ingest(page: HqWireBookingPage) {
  const base = createHqImplementedSampleReader("initial");
  const reader: HqWireReader = {
    ...base,
    async bookings() {
      return structuredClone(page);
    },
  };
  const store = createHqImplementedMemoryStore();
  const result = await createHqImplementedEngine(reader, store).backfill();
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(result.code);
  const persisted = await store.readSync();
  validateHqImplementedSyncState(persisted);
  expect(persisted?.published).toEqual(result.state);
  expect(persisted?.stage).toBeNull();
  const report = await getHqReport(
    result.state,
    createHqImplementedSampleDirectory(),
    { year: 2026 }
  );
  expect(report.status).toBe("available");
  expect(result.state.entities["booking:1"].entity.payload).toEqual(
    payload(page)
  );
  return { store, state: result.state, report };
}

describe("Management HQ independent financial and active-sales headline eligibility", () => {
  it("accepts pending financial headline true / active sales false in a booking page unchanged", () => {
    const page = pending(bookingPage()) as HqWireBookingPage;
    const before = structuredClone(page);
    const result = validateHqWireBookingPage(page);
    expect(result).toEqual(before);
    expect(result).not.toBe(page);
    expect(payload(result).financials).not.toBe(payload(page).financials);
    expect(payload(result).eligibility).toMatchObject({
      pending: true,
      activeSalesHeadline: false,
    });
    expect(payload(result).financials.headlineEligible).toBe(true);
    expect(payload(result).financials.grossBookingValue).toBe(10000);
    expect(page).toEqual(before);
  });

  it("accepts a pending upsert with financial headline true without rewriting source financials", () => {
    const page = pending(changePage()) as HqWireChangePage;
    const result = validateHqWireChangePage(page);
    expect(result).toEqual(page);
    expect(payload(result).financials.headlineEligible).toBe(true);
    expect(payload(result).eligibility.activeSalesHeadline).toBe(false);
    expect(payload(result).financials.grossBookingProfit).toBe(2500);
    expect(result.items[0]).toMatchObject({ seq: 2, revision: 2 });
  });

  it("accepts an undated confirmed stored entity with financial headline true / active sales false", () => {
    const entity = storedEntity(undated(bookingPage()));
    const result = validateHqWireEntity(entity);
    expect(result).toEqual(entity);
    expect(result.payload).toMatchObject({
      status: "confirmed",
      dates: { managementDate: null, month: null, dateSource: "unavailable" },
      financials: { headlineEligible: true, grossBookingValue: 10000 },
      eligibility: { activeSalesHeadline: false, undated: true },
    });
  });

  it("accepts a confirmed dated stored entity whose financial headline false veto does not change active sales", () => {
    const page = bookingPage();
    payload(page).financials.headlineEligible = false;
    const entity = storedEntity(page);
    expect(validateHqWireEntity(entity)).toEqual(entity);
    expect(entity.payload).toMatchObject({
      status: "confirmed",
      dates: { managementDate: "2026-01-10" },
      financials: { headlineEligible: false, grossBookingValue: 10000 },
      eligibility: { activeSalesHeadline: true },
    });
  });

  it("still rejects pending active-sales true even when the financial diagnostic agrees or is absent", () => {
    for (const diagnosticPresent of [true, false]) {
      const page = pending(bookingPage()) as HqWireBookingPage;
      payload(page).eligibility.activeSalesHeadline = true;
      if (!diagnosticPresent) delete payload(page).financials.headlineEligible;
      rejectedEverywhere(page);
    }
  });

  it("rejects cancelled financial headline true at all three wire entry points", () => {
    const page = cancelledPage();
    payload(page).financials.headlineEligible = true;
    rejectedEverywhere(page);
  });

  it("accepts cancelled financial headline false or absent with all original economic exclusions unchanged", () => {
    for (const diagnosticPresent of [true, false]) {
      const page = cancelledPage();
      if (!diagnosticPresent) delete payload(page).financials.headlineEligible;
      acceptedEverywhere(page);
      expect(payload(page)).toMatchObject({
        status: "cancelled",
        eligibility: { cancelled: true, activeSalesHeadline: false },
        financials: {
          grossBookingValue: 11000,
          headlineGrossBookingValue: null,
          grossBookingProfit: null,
          grossMarginPct: null,
          weightedMarginContribution: {
            profitPence: null,
            coveredGrossPence: null,
          },
          baselineEstimate: { status: "excluded", financials: null },
          completeness: { economicsStatus: "excluded" },
        },
      });
      expect(Object.hasOwn(payload(page).financials, "headlineEligible")).toBe(
        diagnosticPresent
      );
    }
  });

  it("does not weaken cancelled profit, margin, weighted contribution or excluded-status guards", () => {
    const mutations: ((p: HqWireBookingPayload) => void)[] = [
      p => (p.financials.grossBookingProfit = 1.1),
      p => (p.financials.grossMarginPct = 33.33333333333333),
      p => (p.financials.weightedMarginContribution.profitPence = 110),
      p => (p.financials.weightedMarginContribution.coveredGrossPence = 110),
      p => (p.financials.baselineEstimate.status = "estimated"),
      p => (p.financials.completeness.economicsStatus = "complete"),
    ];
    for (const mutate of mutations) {
      const page = cancelledPage();
      delete payload(page).financials.headlineEligible;
      mutate(payload(page));
      rejectedEverywhere(page);
    }
  });

  it("keeps required boolean, status and amount types strict without coercion", () => {
    const mutations: ((p: any) => void)[] = [
      p => (p.eligibility.activeSalesHeadline = "true"),
      p => (p.eligibility.pending = null),
      p => (p.status = 1),
      p => (p.financials.grossBookingValue = "10000.00"),
    ];
    for (const mutate of mutations) {
      const page = bookingPage();
      mutate(payload(page));
      rejectedEverywhere(page);
    }
  });

  it("retains required status and undated flag consistency independently of optional financial headline", () => {
    for (const key of ["pending", "cancelled", "undated"] as const) {
      const page = bookingPage();
      delete payload(page).financials.headlineEligible;
      payload(page).eligibility[key] = true;
      rejectedEverywhere(page);
    }
    const page = undated(bookingPage());
    delete payload(page).financials.headlineEligible;
    payload(page).eligibility.activeSalesHeadline = true;
    rejectedEverywhere(page);
  });

  it("retains supplied diagnostic booking-status and cancelled consistency checks", () => {
    for (const mutate of [
      (p: HqWireBookingPayload) => (p.financials.bookingStatus = "cancelled"),
      (p: HqWireBookingPayload) => (p.financials.cancelled = true),
    ]) {
      const page = bookingPage();
      delete payload(page).financials.headlineEligible;
      mutate(payload(page));
      rejectedEverywhere(page);
    }
  });

  it("retains selected date, calendar, source and month checks", () => {
    const mutations: ((p: HqWireBookingPayload) => void)[] = [
      p => (p.dates.managementDate = "2026-02-30"),
      p => (p.dates.managementDate = "2026-01-11"),
      p => (p.dates.dateSource = "portal_registered_at"),
      p => (p.dates.month = "2026-02"),
    ];
    for (const mutate of mutations) {
      const page = bookingPage();
      delete payload(page).financials.headlineEligible;
      mutate(payload(page));
      rejectedEverywhere(page);
    }
  });

  it("retains envelope booking ID, tenant identity and assigned-staff identity checks", () => {
    const mutations: ((p: HqWireBookingPayload) => void)[] = [
      p => (p.orbitBookingId = 2),
      p => (p.identity.orbitTenantId = 90053),
      p => (p.identity.assignedStaff.orbitTenantUserId = 360041),
    ];
    for (const mutate of mutations) {
      const page = bookingPage();
      delete payload(page).financials.headlineEligible;
      mutate(payload(page));
      rejectedEverywhere(page);
    }
  });
});

describe("Management HQ exact-decimal nested financial passthrough", () => {
  it("preserves baseline grossMargin 1.1, stored override 1.1/null and unrestricted finite percentage precision", () => {
    expect(validateHqWireBookingPage(examples.beforeAmendment.body)).toEqual(
      examples.beforeAmendment.body
    );
    expect(validateHqWireChangePage(examples.afterAmendment.body)).toEqual(
      examples.afterAmendment.body
    );
    for (const storedAmount of [1.1, null]) {
      const page = bookingPage();
      const f = payload(page).financials;
      f.baselineEstimate.financials!.grossMargin = 1.1;
      f.grossMarginPct = 33.33333333333333;
      const override = f.bookingVatOverride as Record<string, unknown>;
      override.storedAmount = storedAmount;
      override.present = storedAmount !== null;
      acceptedEverywhere(page);
      const result = payload(validateHqWireBookingPage(page)).financials;
      expect(result.baselineEstimate.financials!.grossMargin).toBe(1.1);
      expect(typeof result.baselineEstimate.financials!.grossMargin).toBe(
        "number"
      );
      expect(
        (result.bookingVatOverride as Record<string, unknown>).storedAmount
      ).toBe(storedAmount);
      expect(result.grossMarginPct).toBe(33.33333333333333);
      // Validation must not reconcile or recompute the intentionally independent
      // nested source values, commissions or weighted numerator/denominator.
      expect(result.grossBookingProfit).toBe(1500);
      expect(result.baselineEstimate.financials!.agentExpectedCommission).toBe(
        979.28
      );
      expect(result.weightedMarginContribution).toEqual(
        examples.beforeAmendment.body.items[0].payload.financials
          .weightedMarginContribution
      );
    }
  });

  it("rejects sub-penny amounts in nested baseline financials and stored override", () => {
    for (const field of ["baseline", "override"] as const) {
      const page = bookingPage();
      const f = payload(page).financials;
      if (field === "baseline")
        f.baselineEstimate.financials!.grossMargin = 1.001;
      else
        (f.bookingVatOverride as Record<string, unknown>).storedAmount = 1.001;
      rejectedEverywhere(page);
    }
  });

  it("rejects non-finite nested amounts before JSON can turn them into null", () => {
    for (const value of [Infinity, -Infinity, NaN]) {
      const page = bookingPage();
      payload(page).financials.baselineEstimate.financials!.grossMargin = value;
      rejectedEverywhere(page);
      const overridePage = bookingPage();
      (
        payload(overridePage).financials.bookingVatOverride as Record<
          string,
          unknown
        >
      ).storedAmount = value;
      rejectedEverywhere(overridePage);
    }
  });

  it("rejects unsafe penny magnitudes in both nested baseline and stored override amounts", () => {
    const page = bookingPage();
    payload(page).financials.baselineEstimate.financials!.grossMargin =
      Number.MAX_SAFE_INTEGER;
    rejectedEverywhere(page);
    const overridePage = bookingPage();
    (
      payload(overridePage).financials.bookingVatOverride as Record<
        string,
        unknown
      >
    ).storedAmount = "90071992547409.92";
    rejectedEverywhere(overridePage);
  });
});

describe("Management HQ memory ingestion and report headline regression", () => {
  it("ingests pending financial headline true but retains the pending cohort and excludes active-sales totals", async () => {
    const page = pending(bookingPage()) as HqWireBookingPage;
    const { report } = await ingest(page);
    expect(report.cohorts.pendingCount).toBe(1);
    expect(report.bookings).toHaveLength(1);
    expect(report.bookings[0]).toMatchObject({
      status: "pending",
      cohort: "pending",
      reportingDate: "2026-01-10",
      financials: { gross: "10000.00", grossProfit: null },
    });
    expect(report.totals.bookingCount).toBe(0);
    expect(report.totals.grossSales.knownSum).toBeNull();
    expect(report.totals.grossProfit.knownSum).toBeNull();
    expect(report.totals.weightedMargin.coveredCount).toBe(0);
    expect(report.monthly[0].pendingCount).toBe(1);
    expect(report.monthly[0].totals.bookingCount).toBe(0);
    expect(report.agents[0].pendingCount).toBe(1);
    expect(report.agents[0].totals.grossSales.knownSum).toBeNull();
  });

  it("ingests undated confirmed financial headline true into exceptions, not dated headline totals", async () => {
    const { report } = await ingest(undated(bookingPage()));
    expect(report.cohorts.undatedCount).toBe(1);
    expect(report.bookings).toEqual([]);
    expect(report.undatedExceptions).toHaveLength(1);
    expect(report.undatedExceptions[0]).toMatchObject({
      status: "confirmed",
      cohort: "exception",
      reportingDate: null,
      financials: { gross: "10000.00" },
    });
    expect(report.totals.bookingCount).toBe(0);
    expect(report.totals.grossSales.knownSum).toBeNull();
    expect(report.monthly.every(row => row.totals.bookingCount === 0)).toBe(
      true
    );
    expect(report.agents).toEqual([]);
  });

  it("applies a confirmed dated financial-headline veto upsert while retaining counts and source drilldown amounts", async () => {
    const { store } = await ingest(bookingPage());
    const page = changePage();
    payload(page).financials.headlineEligible = false;
    const base = createHqImplementedSampleReader("amended");
    const reader: HqWireReader = {
      ...base,
      async changes() {
        return structuredClone(page);
      },
    };
    const result = await createHqImplementedEngine(reader, store).catchup();
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error(result.code);
    const persisted = await store.readSync();
    validateHqImplementedSyncState(persisted);
    expect(persisted?.published).toEqual(result.state);
    expect(persisted?.stage).toBeNull();
    expect(result.state.entities["booking:1"].entity.payload).toEqual(
      payload(page)
    );
    const report = await getHqReport(
      result.state,
      createHqImplementedSampleDirectory(),
      { year: 2026 }
    );
    expect(report.status).toBe("available");
    expect(report.totals.bookingCount).toBe(1);
    expect(report.totals.passengerCount).toBe(2);
    expect(report.totals.grossSales).toMatchObject({
      knownSum: null,
      eligibleCount: 0,
      coveredCount: 0,
    });
    expect(report.totals.grossProfit.knownSum).toBeNull();
    expect(report.totals.baselineAgentCommission.knownSum).toBeNull();
    expect(report.totals.weightedMargin).toMatchObject({
      coveredCount: 0,
      coveredGross: null,
      coveredProfit: null,
    });
    expect(report.monthly[0].totals.bookingCount).toBe(1);
    expect(report.monthly[0].totals.grossSales.knownSum).toBeNull();
    expect(report.agents[0].totals.bookingCount).toBe(1);
    expect(report.agents[0].totals.grossSales.knownSum).toBeNull();
    expect(report.bookings[0]).toMatchObject({
      status: "confirmed",
      cohort: "headline",
      reportingDate: "2026-01-10",
      financials: {
        gross: "11000.00",
        grossProfit: "2500.00",
        baselineAgentCommission: "1644.69",
        baselineJltRetainedCommission: "411.17",
        sourceGrossMarginPct: "22.727272727272727",
      },
    });
  });
});
