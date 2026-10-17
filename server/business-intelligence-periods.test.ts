import { describe, expect, it } from "vitest";
import {
  addToComparisonRow,
  buildComparisonPeriods,
  findComparisonPeriodIndex,
  initialiseComparisonRows,
  totalComparisonRows,
} from "../shared/business-intelligence-periods";

describe("Business Intelligence calendar comparison periods", () => {
  it("returns every calendar month in a selected year", () => {
    const periods = buildComparisonPeriods(2026, "monthly");

    expect(periods).toHaveLength(12);
    expect(periods[0]).toMatchObject({ key: "2026-01-01", label: "January" });
    expect(periods[11]).toMatchObject({ key: "2026-12-01", label: "December" });
    expect(periods[11]?.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("keeps a weekly calendar-year view inside its own year", () => {
    const periods = buildComparisonPeriods(2026, "weekly");

    expect(periods[0]?.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(periods[0]?.end.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(periods.at(-1)?.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(periods.some((period) => period.start.getUTCFullYear() < 2026)).toBe(false);
  });

  it("assigns each metric to the one selected reporting period", () => {
    const periods = buildComparisonPeriods(2026, "monthly");
    const rows = initialiseComparisonRows(periods);
    const aprilIndex = findComparisonPeriodIndex(periods, new Date("2026-04-15T12:00:00.000Z"));

    addToComparisonRow(rows, aprilIndex, {
      bookingsRegistered: 3,
      jltRevenue: 240,
      newProspects: 2,
      newAgents: 1,
    });

    expect(rows[3]).toMatchObject({
      periodStart: "2026-04-01",
      bookingsRegistered: 3,
      jltRevenue: 240,
      newProspects: 2,
      newAgents: 1,
    });
    expect(rows[2]?.bookingsRegistered).toBe(0);
    expect(findComparisonPeriodIndex(periods, new Date("2027-01-01T00:00:00.000Z"))).toBe(-1);
  });

  it("produces full-year totals without overwriting financial values", () => {
    const periods = buildComparisonPeriods(2026, "monthly");
    const rows = initialiseComparisonRows(periods);
    addToComparisonRow(rows, 0, { jltRevenue: 500, agentPayouts: 2000, commissionsPaid: 2, commissionsPaidValue: 2000 });
    addToComparisonRow(rows, 1, { jltRevenue: 700, agentPayouts: 3000, commissionsPaid: 3, commissionsPaidValue: 3000 });

    expect(totalComparisonRows(rows)).toMatchObject({
      jltRevenue: 1200,
      agentPayouts: 5000,
      commissionsPaid: 5,
      commissionsPaidValue: 5000,
    });
  });
});
