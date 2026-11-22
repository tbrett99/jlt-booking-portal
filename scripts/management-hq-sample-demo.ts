import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import {
  createHqImplementedSampleDirectory,
  createHqImplementedSampleReader,
  HQ_IMPLEMENTED_SAMPLE_PROVENANCE,
} from "../server/management-hq-implemented-fixtures";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
} from "../server/management-hq-ingestion";
import { getHqReport, hqPennies } from "../server/management-hq-engine";

// Offline synthetic data only. No database, provider credentials, scheduler or operational writer.
// Feed/cursor/catalogue scaffolding is derived; provenance distinguishes it from supplied bodies.
const store = createHqImplementedMemoryStore();
const stages = [];
for (const scenario of [
  "initial",
  "amended",
  "cancelled",
  "registered",
] as const) {
  const engine = createHqImplementedEngine(
    createHqImplementedSampleReader(scenario),
    store
  );
  const applied =
    scenario === "initial" ? await engine.backfill() : await engine.catchup();
  assert.equal(applied.status, "applied");
  if (applied.status !== "applied")
    throw new Error("Offline synthetic traversal unavailable");
  const report = await getHqReport(
    applied.state,
    createHqImplementedSampleDirectory(),
    { year: 2026 }
  );
  const january = await getHqReport(
    applied.state,
    createHqImplementedSampleDirectory(),
    { year: 2026, month: 1 }
  );
  const february = await getHqReport(
    applied.state,
    createHqImplementedSampleDirectory(),
    { year: 2026, month: 2 }
  );
  const booking = report.bookings.find(row => row.id === "1")!;
  assert(booking);
  assert.equal(report.status, "available");
  assert.equal(
    booking.reportingDate,
    scenario === "registered" ? "2026-02-03" : "2026-01-10"
  );
  assert.equal(booking.seller, null);
  assert.equal(booking.processor, null);
  assert.equal(booking.currentOwner?.userId, 101);
  assert.equal(booking.assignedStaff?.userId, 102);
  assert.equal(booking.attributionState, "provisional_current_owner");
  assert.equal(
    booking.financials.gross,
    scenario === "initial" ? "10000.00" : "11000.00"
  );
  assert.equal(
    booking.cohort,
    scenario === "cancelled" || scenario === "registered"
      ? "cancelled"
      : "headline"
  );
  stages.push({
    scenario,
    generationId: applied.state.metadata.generationId,
    activeBookings: report.totals.bookingCount,
    // A null aggregate with zero eligible rows means no contribution, not missing source gross.
    headlineGrossKnownSum: report.totals.grossSales.knownSum,
    headlineGrossEligibleRows: report.totals.grossSales.eligibleCount,
    januaryBookingRows: january.bookings.length,
    februaryBookingRows: february.bookings.length,
    cancelledBookings: report.cohorts.cancelledCount,
    retainedSampleBooking: {
      id: booking.id,
      currentOwnerId: booking.currentOwner!.userId,
      assignedStaffId: booking.assignedStaff!.userId,
      attribution: booking.attributionState,
      verifiedOriginalSeller: false,
      reportingDate: booking.reportingDate,
      status: booking.status,
      gross: booking.financials.gross,
      baselineAgentCommission: booking.financials.baselineAgentCommission,
    },
    coverage: {
      policyCompleteJltIncome:
        report.totals.completeJltRetainedCommission.knownSum,
      settledJltIncome: report.totals.settledJltIncome.knownSum,
    },
  });
}
assert.equal(
  hqPennies(stages[1].headlineGrossKnownSum!) -
    hqPennies(stages[0].headlineGrossKnownSum!),
  BigInt(100000)
);
assert.equal(stages[2].activeBookings, 0);
assert.equal(stages[2].headlineGrossEligibleRows, 0);
assert.equal(stages[3].januaryBookingRows, 0);
assert.equal(stages[3].februaryBookingRows, 1);
const output = {
  syntheticOnly: true,
  contract: "implemented_1.0.0",
  liveOrbitCalled: false,
  operationalWrites: false,
  provenance: HQ_IMPLEMENTED_SAMPLE_PROVENANCE,
  stages,
};
const outputPath =
  process.argv[2] ?? "/home/ubuntu/hq-implemented-sample-demonstration.json";
await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n");
for (const stage of stages)
  console.log(
    `${stage.scenario}: active ${stage.activeBookings}, eligible gross ${stage.headlineGrossKnownSum ?? "none"}; retained ${stage.retainedSampleBooking.gross} on ${stage.retainedSampleBooking.reportingDate}; owner provisional ${stage.retainedSampleBooking.currentOwnerId}, assigned staff ${stage.retainedSampleBooking.assignedStaffId}`
  );
console.log(
  "Passed implemented original-month restatement, retained cancellation, later month move and provisional-owner/staff assertions; no database/provider activity."
);
