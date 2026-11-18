import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { incomeVatBreakdown, incomeVatSummary, incomeCsv, type PaidOutIncomeRow, type PaidOutIncomeReport } from "../shared/gocardless-income-report";

function row(amountMinor: number | null, overrides: Partial<PaidOutIncomeRow> = {}): PaidOutIncomeRow {
  return { paymentId: "PM-SYNTHETIC", payoutId: "PO-SYNTHETIC", paidOutAt: "2026-11-02T10:00:00Z", chargeDate: null,
    amountMinor, currency: "GBP", category: "joining_fee", categoryEvidence: "Synthetic", agentId: null,
    agentName: null, identityStatus: "unmatched", sources: [], sourceEvidence: "Synthetic", description: null,
    currentStatus: "paid_out", reviewReason: null, ...overrides };
}
function report(rows: PaidOutIncomeRow[]): PaidOutIncomeReport {
  return { rangeStart: "2026-11-02", rangeEnd: "2026-11-08", asOf: "2026-11-09T10:00:00Z",
    providerEnvironment: "sandbox", source: "gocardless_paid_out_events", rows, currencies: [], referralBreakdown: [],
    uniqueMatchedJoiners: 0, reviewCount: 0, eventCount: rows.length, earliestAvailableDate: "2025-05-03", complete: true };
}

describe("read-only 20% VAT-inclusive income estimates", () => {
  it.each([
    [12000, 2000, 10000], [69700, 11617, 58083], [9900, 1650, 8250],
    [3999, 667, 3332], [10001, 1667, 8334], [10002, 1667, 8335],
    [101, 17, 84], [3, 1, 2], [2, 0, 2], [1, 0, 1], [0, 0, 0],
  ])("extracts VAT from %i minor units rather than subtracting 20%%", (grossMinor, vatMinor, excludingVatMinor) => {
    expect(incomeVatBreakdown(grossMinor, "GBP")).toEqual({ grossMinor, vatMinor, excludingVatMinor });
    expect(vatMinor + excludingVatMinor).toBe(grossMinor);
  });
  it.each([null, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("leaves invalid/unknown amount %s unavailable", amount => {
    expect(incomeVatBreakdown(amount, "GBP")).toBeNull();
  });
  it.each([null, "", "gbp", "GB", "GBP ", "=GBP"]) ("leaves invalid/unknown currency %s unavailable", currency => {
    expect(incomeVatBreakdown(12000, currency)).toBeNull();
  });
  it("uses exact arithmetic even near the maximum safe integer", () => {
    expect(incomeVatBreakdown(Number.MAX_SAFE_INTEGER, "GBP")).toEqual({
      grossMinor: 9007199254740991, vatMinor: 1501199875790165, excludingVatMinor: 7505999378950826,
    });
  });
  it("checks exact integer reconciliation across many amounts", () => {
    for (let grossMinor = 0; grossMinor <= 20000; grossMinor++) {
      const result = incomeVatBreakdown(grossMinor, "GBP")!;
      expect(result.vatMinor + result.excludingVatMinor).toBe(grossMinor);
      expect(result.vatMinor).toBe(Number((BigInt(grossMinor) + BigInt(3)) / BigInt(6)));
    }
  });
  it("sums payment-level rounding, not a rounded combined gross", () => {
    const rows = [row(3), row(3)];
    const summary = incomeVatSummary(rows, "GBP");
    expect(summary.joining).toEqual({ grossMinor: 6, vatMinor: 2, excludingVatMinor: 4 });
    expect(summary.total).toEqual(summary.joining);
    expect(incomeVatBreakdown(6, "GBP")!.vatMinor).toBe(1);
  });
  it("keeps currencies and categories independent and excludes unknown values", () => {
    const rows = [row(12000), row(6000, { category: "membership" }), row(3000, { category: "other" }),
      row(600, { category: "unclassified" }), row(12000, { currency: "EUR" }), row(null), row(500, { currency: null })];
    const snapshot = JSON.stringify(rows);
    const summary = incomeVatSummary(rows, "GBP");
    expect(summary.total).toEqual({ grossMinor: 21600, vatMinor: 3600, excludingVatMinor: 18000 });
    expect(summary.joining.excludingVatMinor).toBe(10000);
    expect(summary.membership.excludingVatMinor).toBe(5000);
    expect(summary.other.excludingVatMinor).toBe(2500);
    expect(summary.unclassified.excludingVatMinor).toBe(500);
    expect(incomeVatSummary(rows, "EUR").total).toEqual({ grossMinor: 12000, vatMinor: 2000, excludingVatMinor: 10000 });
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
  it("does not silently adjust historical paid-out income for a later refund", () => {
    expect(incomeVatSummary([row(12000, { currentStatus: "refunded", reviewReason: "Later refund" })], "GBP").total)
      .toEqual({ grossMinor: 12000, vatMinor: 2000, excludingVatMinor: 10000 });
  });
  it("fails closed on an unsafe cumulative total", () => {
    expect(() => incomeVatSummary([row(Number.MAX_SAFE_INTEGER), row(1)], "GBP")).toThrow("exact arithmetic range");
  });
  it("appends estimated VAT CSV fields without replacing gross, currency or review data", () => {
    const rows = [row(12000), row(null, { reviewReason: "Unknown amount" }), row(0), row(12000, { currency: null })];
    const input = report(rows);
    const before = JSON.stringify(input);
    const csv = incomeCsv(input);
    const records = parse(csv, { bom: true, columns: true });
    expect(records[0]["Gross amount"]).toBe("120.00");
    expect(records[0]["Currency"]).toBe("GBP");
    expect(records[0]["VAT amount (20% estimate)"]).toBe("20.00");
    expect(records[0]["Income excluding VAT (20% estimate)"]).toBe("100.00");
    expect(records[0]["VAT estimate basis"]).toContain("not a tax return or net bank payout");
    expect(records[1]["VAT amount (20% estimate)"]).toBe("");
    expect(records[1]["Income excluding VAT (20% estimate)"]).toBe("");
    expect(records[1]["Review reason"]).toBe("Unknown amount");
    expect(records[2]["VAT amount (20% estimate)"]).toBe("0.00");
    expect(records[2]["Income excluding VAT (20% estimate)"]).toBe("0.00");
    expect(records[3]["Income excluding VAT (20% estimate)"]).toBe("");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("CSV payment figures reconcile exactly to category and currency estimates", () => {
    const rows = [row(3), row(3), row(69700), row(9900, { category: "membership" }), row(12000, { currency: "EUR" })];
    const records = parse(incomeCsv(report(rows)), { bom: true, columns: true });
    const gbp = records.filter((r: any) => r.Currency === "GBP");
    const sum = (field: string) => gbp.reduce((n: number, r: any) => n + Math.round(Number(r[field]) * 100), 0);
    const summary = incomeVatSummary(rows, "GBP").total;
    expect(sum("Gross amount")).toBe(summary.grossMinor);
    expect(sum("VAT amount (20% estimate)")).toBe(summary.vatMinor);
    expect(sum("Income excluding VAT (20% estimate)")).toBe(summary.excludingVatMinor);
  });
});
