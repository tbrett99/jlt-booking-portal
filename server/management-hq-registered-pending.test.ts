import { describe, expect, it } from "vitest";
import examples from "./fixtures/management-hq-implemented-http-examples.json";
import type {
  HqWireBookingPage,
  HqWireBookingPayload,
  HqWireChangePage,
  HqWireEntity,
  HqWireReader,
} from "../shared/management-hq-wire";
import type { HqReport, HqReportTotals } from "../shared/management-hq-report";
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
  type HqImplementedState,
  type HqImplementedStore,
} from "./management-hq-ingestion";
import {
  createHqImplementedSampleDirectory,
  createHqImplementedSampleReader,
} from "./management-hq-implemented-fixtures";
import {
  canonicalHqJson,
  exportHqReportCsv,
  getHqReport,
} from "./management-hq-engine";

// Derived clones of supplied synthetic source fixtures only. Exercise the actual
// wire validators, pure memory ingestion and local report, never live records,
// a provider, DB, configuration/environment, app wiring or a release operation.
const bookingPage = (): HqWireBookingPage =>
  structuredClone(examples.beforeAmendment.body) as HqWireBookingPage;
const amendmentPage = (): HqWireChangePage =>
  structuredClone(examples.afterAmendment.body) as HqWireChangePage;
const cancellationPage = (): HqWireBookingPage =>
  structuredClone(examples.afterCancellation.body) as HqWireBookingPage;
const payload = (page: HqWireBookingPage | HqWireChangePage) =>
  page.items[0].payload as HqWireBookingPayload;
const entity = (page: HqWireBookingPage): HqWireEntity => {
  const item = page.items[0];
  return structuredClone({
    entityType: item.entityType,
    entityId: item.entityId,
    revision: item.revision,
    payload: item.payload,
  }) as HqWireEntity;
};
const asChange = (page: HqWireBookingPage): HqWireChangePage => ({
  ...structuredClone(page),
  entityType: "mixed",
  items: [{ ...entity(page), seq: page.changeUpper, operation: "upsert" }],
});
function registered<T extends HqWireBookingPage | HqWireChangePage>(
  page: T
): T {
  const p = payload(page);
  p.portalRegisteredAt = "2026-01-12T09:00:00.000Z";
  Object.assign(p.dates, {
    portalRegisteredAt: "2026-01-12T09:00:00.000Z",
    managementDate: "2026-01-12",
    dateSource: "portal_registered_at",
    month: "2026-01",
  });
  return page;
}
function pending<T extends HqWireBookingPage | HqWireChangePage>(page: T): T {
  const p = payload(page);
  p.status = "pending";
  p.financials.bookingStatus = "pending";
  p.eligibility.pending = true;
  // This source flag is confirmed-only. Portal must not rewrite it to make a
  // registered pending booking count toward its own active count / known gross.
  p.eligibility.activeSalesHeadline = false;
  p.financials.headlineEligible = true;
  return page;
}
const registeredPending = () => registered(pending(bookingPage()));
function acceptedEverywhere(page: HqWireBookingPage) {
  expect(validateHqWireBookingPage(page)).toEqual(page);
  expect(validateHqWireChangePage(asChange(page))).toEqual(asChange(page));
  expect(validateHqWireEntity(entity(page))).toEqual(entity(page));
}
function rejectedEverywhere(page: HqWireBookingPage) {
  expect(() => validateHqWireBookingPage(page)).toThrow(HqContractError);
  expect(() => validateHqWireChangePage(asChange(page))).toThrow(
    HqContractError
  );
  expect(() => validateHqWireEntity(entity(page))).toThrow(HqContractError);
}
async function reportFor(state: HqImplementedState, month?: number) {
  const report = await getHqReport(
    state,
    createHqImplementedSampleDirectory(),
    {
      year: 2026,
      ...(month === undefined ? {} : { month }),
    }
  );
  expect(report.status).toBe("available");
  return report;
}
async function persistedState(
  store: HqImplementedStore,
  state: HqImplementedState,
  source: HqWireBookingPage | HqWireChangePage
) {
  const sync = await store.readSync();
  validateHqImplementedSyncState(sync);
  expect(sync?.published).toEqual(state);
  expect(sync?.stage).toBeNull();
  expect(state.entities["booking:1"].entity.payload).toEqual(payload(source));
}
async function ingest(page: HqWireBookingPage) {
  const before = structuredClone(page);
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
  await persistedState(store, result.state, page);
  const report = await reportFor(result.state);
  expect(page).toEqual(before);
  return { store, state: result.state, report };
}
async function catchup(
  store: HqImplementedStore,
  page: HqWireChangePage,
  stage: "amended" | "cancelled"
) {
  const before = structuredClone(page);
  const reader: HqWireReader = {
    ...createHqImplementedSampleReader(stage),
    async changes() {
      return structuredClone(page);
    },
  };
  const result = await createHqImplementedEngine(reader, store).catchup();
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(result.code);
  await persistedState(store, result.state, page);
  const report = await reportFor(result.state);
  expect(page).toEqual(before);
  return { state: result.state, report };
}
function reportScopes(report: HqReport): HqReportTotals[] {
  expect(report.agents).toHaveLength(1);
  return [report.totals, report.monthly[0].totals, report.agents[0].totals];
}
function activeKnownGross(totals: HqReportTotals, gross: string) {
  expect(totals.bookingCount).toBe(1);
  expect(totals.passengerCount).toBe(2);
  expect(totals.grossSales).toMatchObject({
    knownSum: gross,
    eligibleCount: 1,
    coveredCount: 1,
    missingCount: 0,
  });
}
function noEarnedOrSettledIncome(totals: HqReportTotals) {
  // Active booking count and booked gross are NOT earned commission or cash
  // received. All existing economic/fee/commission/settlement populations must
  // remain confirmed-only, even where the pending source has diagnostic values.
  const metrics = [
    totals.supplierNetCost,
    totals.knownSupplierNetSubtotal,
    totals.grossProfit,
    totals.applicableVat,
    totals.ptsFees,
    totals.actualCardFees,
    totals.estimatedCardFees,
    totals.baselineAgentCommission,
    totals.baselineJltRetainedCommission,
    totals.completeAgentCommission,
    totals.completeJltRetainedCommission,
    totals.settledJltIncome,
  ];
  for (const metric of metrics) {
    expect(metric).toMatchObject({
      knownSum: null,
      eligibleCount: 0,
      coveredCount: 0,
      missingCount: 0,
    });
  }
  expect(totals.weightedMargin).toEqual({
    fraction: null,
    coveredCount: 0,
    coveredGross: null,
    coveredProfit: null,
  });
}
function excluded(totals: HqReportTotals) {
  expect(totals.bookingCount).toBe(0);
  expect(totals.passengerCount).toBe(0);
  expect(totals.grossSales).toMatchObject({
    knownSum: null,
    eligibleCount: 0,
    coveredCount: 0,
  });
  noEarnedOrSettledIncome(totals);
}

describe("Management HQ Portal-local registered pending active count and booked gross", () => {
  it("accepts the unchanged confirmed-only source false flag at all actual wire entry points", () => {
    const page = registeredPending();
    const before = structuredClone(page);
    acceptedEverywhere(page);
    expect(payload(validateHqWireBookingPage(page))).toMatchObject({
      status: "pending",
      dates: {
        portalRegisteredAt: "2026-01-12T09:00:00.000Z",
        managementDate: "2026-01-12",
        dateSource: "portal_registered_at",
        month: "2026-01",
      },
      eligibility: {
        activeSalesHeadline: false,
        pending: true,
        cancelled: false,
      },
      financials: {
        bookingStatus: "pending",
        headlineEligible: true,
        grossBookingValue: 10000,
        grossBookingProfit: 1500,
      },
    });
    expect(page).toEqual(before);
  });

  it("includes registered pending count and known gross in annual, registration-month and provisional-agent totals, not income", async () => {
    const { state, report } = await ingest(registeredPending());
    expect(report.cohorts.pendingCount).toBe(1);
    expect(report.bookings).toHaveLength(1);
    expect(report.bookings[0]).toMatchObject({
      status: "pending",
      cohort: "pending",
      reportingDate: "2026-01-12",
      dateSource: "portal_registered_at",
      attributionState: "provisional_current_owner",
      seller: null,
      processor: null,
      financials: {
        gross: "10000.00",
        grossProfit: null,
        completeAgentCommission: null,
        settledJltIncome: null,
      },
    });
    expect(report.monthly[0].pendingCount).toBe(1);
    expect(report.agents[0].pendingCount).toBe(1);
    for (const totals of reportScopes(report)) {
      activeKnownGross(totals, "10000.00");
      noEarnedOrSettledIncome(totals);
    }
    const january = await reportFor(state, 1);
    activeKnownGross(january.totals, "10000.00");
    noEarnedOrSettledIncome(january.totals);
    // The supplied observation occurs in November; it must not move January's
    // booking into the observation month or imply a cash-received event.
    const observationMonth = await reportFor(state, 11);
    excluded(observationMonth.totals);
    expect(observationMonth.bookings).toEqual([]);
    expect(observationMonth.agents).toEqual([]);
  });

  it("restates a +1000 amendment observed in a later month into the original January count/gross, never an event-month sale", async () => {
    const { store } = await ingest(registeredPending());
    const page = registered(pending(amendmentPage()));
    Object.assign(page, {
      sourceObservationWindow: {
        from: "2026-12-03T11:59:59.000Z",
        to: "2026-12-03T12:00:00.000Z",
      },
      publishedAt: "2026-12-03T12:00:00.000Z",
      expiresAt: "2026-12-04T12:00:00.000Z",
    });
    expect(validateHqWireChangePage(page)).toEqual(page);
    const { state, report } = await catchup(store, page, "amended");
    expect(report.bookings[0]).toMatchObject({
      revision: "2",
      reportingDate: "2026-01-12",
      status: "pending",
      financials: { gross: "11000.00", grossProfit: null },
    });
    expect(report.sourceObservationWindow?.to).toBe("2026-12-03T12:00:00.000Z");
    for (const totals of reportScopes(report)) {
      activeKnownGross(totals, "11000.00");
      noEarnedOrSettledIncome(totals);
    }
    activeKnownGross((await reportFor(state, 1)).totals, "11000.00");
    const december = await reportFor(state, 12);
    excluded(december.totals);
    expect(december.bookings).toEqual([]);
    expect(report.monthly[11].totals.grossSales.knownSum).toBeNull();
  });

  it("retains a cancellation and its source gross in January drilldown while excluding all active totals", async () => {
    const { store } = await ingest(registeredPending());
    const page = registered(cancellationPage());
    acceptedEverywhere(page);
    const { report } = await catchup(store, asChange(page), "cancelled");
    expect(report.cohorts.cancelledCount).toBe(1);
    expect(report.cohorts.pendingCount).toBe(0);
    expect(report.bookings).toHaveLength(1);
    expect(report.bookings[0]).toMatchObject({
      status: "cancelled",
      cohort: "cancelled",
      reportingDate: "2026-01-12",
      financials: {
        gross: "11000.00",
        grossProfit: null,
        cancellationRetainedCommission: null,
        settledJltIncome: null,
      },
    });
    expect(report.monthly[0].cancelledCount).toBe(1);
    expect(report.agents[0].cancelledCount).toBe(1);
    for (const totals of reportScopes(report)) excluded(totals);
  });

  it("keeps unregistered pending excluded even when bookedOn supplies a valid January reporting date", async () => {
    const page = pending(bookingPage());
    acceptedEverywhere(page);
    const { report } = await ingest(page);
    expect(report.cohorts.pendingCount).toBe(1);
    expect(report.bookings[0]).toMatchObject({
      status: "pending",
      cohort: "pending",
      reportingDate: "2026-01-10",
      dateSource: "booked_on",
      financials: { gross: "10000.00", grossProfit: null },
    });
    for (const totals of reportScopes(report)) excluded(totals);
  });

  it("keeps genuinely undated pending as a retained exception, outside dated and agent totals", async () => {
    const page = pending(bookingPage());
    const p = payload(page);
    p.portalRegisteredAt = null;
    p.bookedOn = null;
    Object.assign(p.dates, {
      portalRegisteredAt: null,
      bookedOn: null,
      managementDate: null,
      dateSource: "unavailable",
      month: null,
    });
    p.eligibility.undated = true;
    acceptedEverywhere(page);
    const { report } = await ingest(page);
    expect(report.cohorts.undatedCount).toBe(1);
    expect(report.bookings).toEqual([]);
    expect(report.undatedExceptions).toHaveLength(1);
    expect(report.undatedExceptions[0]).toMatchObject({
      status: "pending",
      cohort: "exception",
      reportingDate: null,
      financials: { gross: "10000.00", grossProfit: null },
    });
    excluded(report.totals);
    for (const row of report.monthly) excluded(row.totals);
    expect(report.agents).toEqual([]);
  });

  it("uses actual nested registration evidence, not the optional top-level diagnostic copy", async () => {
    const registeredPage = registeredPending();
    payload(registeredPage).portalRegisteredAt = null;
    acceptedEverywhere(registeredPage);
    const registeredReport = (await ingest(registeredPage)).report;
    expect(registeredReport.bookings[0].reportingDate).toBe("2026-01-12");
    for (const totals of reportScopes(registeredReport)) {
      activeKnownGross(totals, "10000.00");
      noEarnedOrSettledIncome(totals);
    }
    const diagnosticOnly = pending(bookingPage());
    payload(diagnosticOnly).portalRegisteredAt = "2026-01-12T09:00:00.000Z";
    acceptedEverywhere(diagnosticOnly);
    const diagnosticReport = (await ingest(diagnosticOnly)).report;
    expect(diagnosticReport.bookings[0].reportingDate).toBe("2026-01-10");
    for (const totals of reportScopes(diagnosticReport)) excluded(totals);
  });

  it("counts registered pending with missing gross as uncovered/unknown, not zero or a product/top-level fallback", async () => {
    const page = registeredPending();
    payload(page).financials.grossBookingValue = null;
    payload(page).financials.headlineGrossBookingValue = null;
    const { report } = await ingest(page);
    expect(report.bookings[0].financials.gross).toBeNull();
    // Original stored bookingTotal/product gross remains 10000 in the raw
    // payload; it cannot silently fill a missing source headline gross.
    expect(payload(page).bookingTotal).toBe("10000.00");
    for (const totals of reportScopes(report)) {
      expect(totals.bookingCount).toBe(1);
      expect(totals.grossSales).toMatchObject({
        knownSum: null,
        eligibleCount: 1,
        coveredCount: 0,
        missingCount: 1,
      });
      noEarnedOrSettledIncome(totals);
    }
  });

  it("includes known pending gross with missing cost without inventing profit, weighted coverage or commission", async () => {
    const page = registeredPending();
    const f = payload(page).financials;
    f.totalNetCost = null;
    f.netCostStatus = "incomplete";
    f.grossBookingProfit = null;
    f.grossMarginPct = null;
    f.weightedMarginContribution.profitPence = null;
    f.weightedMarginContribution.coveredGrossPence = null;
    f.completeness.economicsStatus = "incomplete";
    f.completeness.strictSourceComplete = false;
    f.completeness.economicsReasons = ["missing_net_cost"];
    f.baselineEstimate.status = "incomplete";
    f.baselineEstimate.financials = null;
    const { report } = await ingest(page);
    expect(report.bookings[0].financials).toMatchObject({
      gross: "10000.00",
      supplierNet: null,
      grossProfit: null,
      baselineAgentCommission: null,
      baselineJltRetainedCommission: null,
      completeAgentCommission: null,
      settledJltIncome: null,
    });
    for (const totals of reportScopes(report)) {
      activeKnownGross(totals, "10000.00");
      noEarnedOrSettledIncome(totals);
    }
  });

  it("treats an explicitly valid zero pending gross as covered zero, not missing, without zero-income invention", async () => {
    const page = registeredPending();
    payload(page).financials.grossBookingValue = 0;
    payload(page).financials.headlineGrossBookingValue = 0;
    const { report } = await ingest(page);
    expect(report.bookings[0].financials.gross).toBe("0.00");
    for (const totals of reportScopes(report)) {
      activeKnownGross(totals, "0.00");
      noEarnedOrSettledIncome(totals);
    }
  });

  it("preserves the explicit financial-headline false gross veto as an expected exception while the registered pending count stays active", async () => {
    const page = registeredPending();
    payload(page).financials.headlineEligible = false;
    acceptedEverywhere(page);
    const { report } = await ingest(page);
    expect(report.bookings[0]).toMatchObject({
      status: "pending",
      cohort: "pending",
      qualityIssues: ["REGISTERED_PENDING_SALES_ELIGIBILITY_CONFLICT"],
      financials: { gross: "10000.00", grossProfit: null },
    });
    for (const totals of reportScopes(report)) {
      expect(totals.bookingCount).toBe(1);
      expect(totals.passengerCount).toBe(2);
      expect(totals.grossSales).toMatchObject({
        knownSum: null,
        eligibleCount: 0,
        coveredCount: 0,
        missingCount: 0,
      });
      noEarnedOrSettledIncome(totals);
    }
  });

  it("retains bad registration/calendar, selected date/month/source and confirmed-only source-flag rejection", () => {
    const mutations: ((p: HqWireBookingPayload) => void)[] = [
      p => (p.dates.portalRegisteredAt = "not-a-date"),
      p => (p.dates.portalRegisteredAt = "2026-02-30T09:00:00.000Z"),
      p => (p.dates.managementDate = "2026-01-13"),
      p => (p.dates.month = "2026-02"),
      p => (p.dates.dateSource = "booked_on"),
      p => (p.eligibility.activeSalesHeadline = true),
    ];
    for (const mutate of mutations) {
      const page = registeredPending();
      mutate(payload(page));
      rejectedEverywhere(page);
    }
  });

  it("exports one pending row with booked gross and no invented profit or settled income", async () => {
    const { report } = await ingest(registeredPending());
    const csv = exportHqReportCsv(report);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    const cells = lines[1].match(/"(?:[^"]|"")*"/g)!;
    expect(cells[2]).toBe('"2026-01-12"');
    expect(cells[3]).toBe('"pending"');
    expect(cells[4]).toBe('"pending"');
    expect(cells[12]).toBe('"10000.00"');
    expect(cells[13]).toBe('""');
    expect(cells[15]).toBe('""');
    expect(cells[16]).toBe('""');
    expect(report.totals.bookingCount).toBe(1);
    expect(report.cohorts.pendingCount).toBe(1);
    expect(report.limitations.join(" ")).toContain(
      "Pending status counts overlap active counts"
    );
  });

  it("adds pending gross once without diluting the confirmed weighted-margin denominator or financial estimates", async () => {
    const { state } = await ingest(registeredPending());
    // A derived, explicitly validated synthetic report state, not a new import.
    const confirmed = entity(bookingPage());
    confirmed.entityId = 2;
    (confirmed.payload as HqWireBookingPayload).orbitBookingId = 2;
    (confirmed.payload as HqWireBookingPayload).bookingRef =
      "SYNTHETIC-CONFIRMED-2";
    const validated = validateHqWireEntity(confirmed);
    state.entities["booking:2"] = {
      entity: validated,
      canonicalPayload: canonicalHqJson(validated),
      absent: false,
    };
    state.metadata.counts.bookingCount = 2;
    validateHqImplementedSyncState({
      version: state.version,
      published: state,
      stage: null,
    });
    const report = await reportFor(state);
    expect(report.bookings).toHaveLength(2);
    expect(report.cohorts.pendingCount).toBe(1);
    for (const totals of reportScopes(report)) {
      expect(totals.bookingCount).toBe(2);
      expect(totals.grossSales).toMatchObject({
        knownSum: "20000.00",
        eligibleCount: 2,
        coveredCount: 2,
      });
      expect(totals.grossProfit).toMatchObject({
        knownSum: "1500.00",
        eligibleCount: 1,
        coveredCount: 1,
      });
      expect(totals.weightedMargin).toEqual({
        fraction: "0.150000",
        coveredCount: 1,
        coveredGross: "10000.00",
        coveredProfit: "1500.00",
      });
      expect(totals.baselineAgentCommission.eligibleCount).toBe(1);
      expect(totals.baselineJltRetainedCommission.eligibleCount).toBe(1);
      expect(totals.settledJltIncome.knownSum).toBeNull();
    }
  });

  it("uses London registration date across a summer UTC month boundary, never the UTC or bookedOn month", async () => {
    const page = registeredPending();
    Object.assign(payload(page).dates, {
      portalRegisteredAt: "2026-07-31T23:30:00.000Z",
      managementDate: "2026-08-01",
      month: "2026-08",
    });
    acceptedEverywhere(page);
    const { state, report } = await ingest(page);
    activeKnownGross(report.totals, "10000.00");
    activeKnownGross(report.monthly[7].totals, "10000.00");
    excluded(report.monthly[6].totals);
    expect(report.bookings[0].reportingDate).toBe("2026-08-01");
    activeKnownGross((await reportFor(state, 8)).totals, "10000.00");
    excluded((await reportFor(state, 7)).totals);
    const wrongUtcDate = structuredClone(page);
    payload(wrongUtcDate).dates.managementDate = "2026-07-31";
    payload(wrongUtcDate).dates.month = "2026-07";
    rejectedEverywhere(wrongUtcDate);
  });

  it("allows a genuine source registration-date correction to move the original booking once into its new selected month", async () => {
    const { store } = await ingest(registeredPending());
    const page = registered(pending(amendmentPage()));
    Object.assign(payload(page).dates, {
      portalRegisteredAt: "2026-02-03T09:00:00.000Z",
      managementDate: "2026-02-03",
      month: "2026-02",
    });
    expect(validateHqWireChangePage(page)).toEqual(page);
    const { state, report } = await catchup(store, page, "amended");
    expect(report.bookings).toHaveLength(1);
    expect(report.bookings[0].reportingDate).toBe("2026-02-03");
    activeKnownGross(report.totals, "11000.00");
    excluded(report.monthly[0].totals);
    activeKnownGross(report.monthly[1].totals, "11000.00");
    excluded((await reportFor(state, 1)).totals);
    activeKnownGross((await reportFor(state, 2)).totals, "11000.00");
  });

  it("accepts registered pending known gross when the optional source financial-headline diagnostic is omitted", async () => {
    const page = registeredPending();
    delete (payload(page).financials as any).headlineEligible;
    acceptedEverywhere(page);
    const { state, report } = await ingest(page);
    expect(state.entities["booking:1"].entity.payload).toEqual(payload(page));
    expect(Object.hasOwn(payload(page).financials, "headlineEligible")).toBe(
      false
    );
    for (const totals of reportScopes(report)) {
      activeKnownGross(totals, "10000.00");
      noEarnedOrSettledIncome(totals);
    }
  });

  it("moves registered pending to confirmed without a second active sale, making only supplied confirmed economics eligible", async () => {
    const { store } = await ingest(registeredPending());
    const page = registered(amendmentPage());
    expect(validateHqWireChangePage(page)).toEqual(page);
    const { report } = await catchup(store, page, "amended");
    expect(report.bookings).toHaveLength(1);
    expect(report.bookings[0].status).toBe("confirmed");
    expect(report.cohorts.pendingCount).toBe(0);
    for (const totals of reportScopes(report)) {
      activeKnownGross(totals, "11000.00");
      expect(totals.grossProfit.eligibleCount).toBe(1);
      expect(totals.grossProfit.knownSum).not.toBeNull();
      expect(totals.weightedMargin.coveredCount).toBe(1);
      expect(totals.settledJltIncome.knownSum).toBeNull();
    }
  });

  it("removes active sales once when source registration evidence is removed from a pending booking", async () => {
    const { store } = await ingest(registeredPending());
    const page = pending(amendmentPage());
    expect(payload(page).dates.portalRegisteredAt).toBeNull();
    expect(payload(page).dates.dateSource).toBe("booked_on");
    expect(validateHqWireChangePage(page)).toEqual(page);
    const { report } = await catchup(store, page, "amended");
    expect(report.bookings).toHaveLength(1);
    expect(report.bookings[0]).toMatchObject({
      status: "pending",
      reportingDate: "2026-01-10",
      financials: { gross: "11000.00" },
    });
    expect(report.cohorts.pendingCount).toBe(1);
    for (const totals of reportScopes(report)) excluded(totals);
  });
});
