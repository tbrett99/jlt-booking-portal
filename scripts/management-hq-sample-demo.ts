import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { createHqSampleDirectory, runHqSampleScenario } from "../server/management-hq-fixtures";
import { getHqReport, hqPennies } from "../server/management-hq-engine";

// Offline synthetic data only. No database, provider credentials, scheduler or operational writer.
const stages = [];
for (const scenario of ["initial", "amended", "cancelled"] as const) {
  const state = await runHqSampleScenario(scenario);
  const report = await getHqReport(state, createHqSampleDirectory(), { year: 2026, month: 1 });
  const april = await getHqReport(state, createHqSampleDirectory(), { year: 2026, month: 4 });
  const booking = report.bookings.find(row => row.id === "9000001")!;
  assert(booking);
  assert.equal(booking.reportingDate, "2026-01-10");
  assert.equal(booking.seller?.userId, 101);
  assert.equal(booking.processor?.userId, 47);
  assert(!april.bookings.some(row => row.id === booking.id));
  assert.equal(booking.financials.gross, scenario === "initial" ? "5000.00" : "6000.00");
  assert.equal(booking.cohort, scenario === "cancelled" ? "cancelled" : "headline");
  stages.push({ scenario, watermark: state.watermark, activeBookings: report.totals.bookingCount, januaryGrossSales: report.totals.grossSales.knownSum, aprilGrossSales: april.totals.grossSales.knownSum, cancelledBookings: report.cohorts.cancelledCount, retainedSampleBooking: { id: booking.id, memberId: booking.seller!.userId, processorId: booking.processor!.userId, originalReportingDate: booking.reportingDate, status: booking.status, gross: booking.financials.gross }, coverage: { unmatched: report.cohorts.unmatchedBusinessCount, undated: report.cohorts.undatedCount, policyCompleteJltIncome: report.totals.completeJltRetainedCommission.knownSum, settledJltIncome: report.totals.settledJltIncome.knownSum } });
}
assert.equal(hqPennies(stages[1].januaryGrossSales!) - hqPennies(stages[0].januaryGrossSales!), BigInt(100000));
assert.equal(stages[2].activeBookings, stages[1].activeBookings - 1);
assert.equal(hqPennies(stages[1].januaryGrossSales!) - hqPennies(stages[2].januaryGrossSales!), BigInt(600000));
const output = { syntheticOnly: true, liveOrbitCalled: false, operationalWrites: false, stages };
await writeFile("/home/ubuntu/hq-sample-demonstration.json", JSON.stringify(output, null, 2) + "\n");
for (const stage of stages) console.log(`${stage.scenario}: January headline gross GBP ${stage.januaryGrossSales}, active ${stage.activeBookings}, cancelled ${stage.cancelledBookings}; sample gross ${stage.retainedSampleBooking.gross}, status ${stage.retainedSampleBooking.status}, seller ${stage.retainedSampleBooking.memberId}, administrator ${stage.retainedSampleBooking.processorId}`);
console.log("Passed original-month restatement, administrator distinction and retained cancellation assertions; no database/provider activity.");
