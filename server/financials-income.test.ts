import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName } from "drizzle-orm";
import { buildFinancialsIncome, buildFinancialsIncomeFromEvidence, FINANCIALS_EVENT_LIMIT, type FinancialsPaymentEvidence, type FinancialsCommissionEvidence } from "../shared/financials-income";
import { readFinancialsIncome } from "./financials-income";
const event = (paymentId = "PM-SYNTHETIC", amount: number | null = 12000, currency: string | null = "GBP"): FinancialsPaymentEvidence => ({ paymentId, amount, currency });

describe("Financials recorded income: VAT on GoCardless only", () => {
  it("leaves £50 commission unchanged and combines it with £100 GC excluding VAT", () => {
    expect(buildFinancialsIncome("50.00", [event()])).toEqual({ available: true, reason: null,
      gcGrossMinor: 12000, gcVatMinor: 2000, gcExVatMinor: 10000, commissionMinor: 5000,
      grossIncomeMinor: 17000, incomeAfterVatMinor: 15000, paymentCount: 1 });
  });
  it("does not apply VAT to commission-only income", () => {
    expect(buildFinancialsIncome("697.00", [])).toMatchObject({ available: true, gcVatMinor: 0,
      commissionMinor: 69700, incomeAfterVatMinor: 69700, grossIncomeMinor: 69700 });
  });
  it("uses pence rather than legacy whole-pound rounded summary values", () => {
    expect(buildFinancialsIncome("123.45", [event("PM-PENCE", 3999)])).toMatchObject({
      available: true, gcGrossMinor: 3999, gcVatMinor: 667, gcExVatMinor: 3332, commissionMinor: 12345,
      grossIncomeMinor: 16344, incomeAfterVatMinor: 15677 });
  });
  it("rounds VAT once per unique payment and counts same-priced different payments independently", () => {
    expect(buildFinancialsIncome(0, [event("PM-A", 3), event("PM-A", 3), event("PM-B", 3)]))
      .toMatchObject({ available: true, paymentCount: 2, gcGrossMinor: 6, gcVatMinor: 2, gcExVatMinor: 4, incomeAfterVatMinor: 4 });
  });
  it("fills absent immutable fields only from nonconflicting copies of the same payment", () => {
    expect(buildFinancialsIncome(0, [event("PM-A", null, null), event("PM-A", 12000), event("PM-A", null, "GBP")]))
      .toMatchObject({ available: true, paymentCount: 1, gcGrossMinor: 12000 });
  });
  it("permits signed remittance adjustments without a VAT adjustment to them", () => {
    expect(buildFinancialsIncome("-50.25", [event()])).toMatchObject({ available: true,
      commissionMinor: -5025, incomeAfterVatMinor: 4975, grossIncomeMinor: 6975 });
    expect(buildFinancialsIncome("-150.00", [])).toMatchObject({ available: true, incomeAfterVatMinor: -15000 });
  });
  it.each(["20", "20.4", "20.40", 20, 20.4])("preserves exact commission value %s", commission => {
    expect(buildFinancialsIncome(commission, []).commissionMinor).toBe(commission === "20" || commission === 20 ? 2000 : 2040);
  });
  it.each(["", " 20", "20.401", "1e10", NaN, Infinity, "9007199254740991"]) ("rejects unknown or malformed commission %s", commission => {
    expect(buildFinancialsIncome(commission, [])).toMatchObject({ available: false, reason: "invalid_commission", incomeAfterVatMinor: null });
  });
  it.each([
    [event("PM-A", 12000), event("PM-A", 13000)],
    [event("PM-A", 12000, "GBP"), event("PM-A", 12000, "USD")],
  ])("withholds conflicting immutable payment copies", (...events) => {
    expect(buildFinancialsIncome(0, events)).toMatchObject({ available: false, reason: "conflicting_payment_evidence", incomeAfterVatMinor: null });
  });
  it.each([event("", 12000), event(" PM-A", 12000), event("PM-A", null), event("PM-A", 12000, null),
    event("PM-A", -1), event("PM-A", 1.2), event("PM-A", NaN), event("PM-A", 12000, "gbp")])
    ("does not turn missing/invalid payment evidence into zero", bad => {
      const result = buildFinancialsIncome(0, [bad]);
      expect(result).toMatchObject({ available: false, reason: "missing_payment_evidence", gcGrossMinor: null, incomeAfterVatMinor: null });
    });
  it("never combines GBP with a foreign currency or assumes currency conversion", () => {
    expect(buildFinancialsIncome(50, [event("PM-A"), event("PM-EUR", 12000, "EUR")]))
      .toMatchObject({ available: false, reason: "non_gbp_income", incomeAfterVatMinor: null });
  });
  it("shows genuine successful empty income as zero", () => {
    expect(buildFinancialsIncome(0, [])).toMatchObject({ available: true, gcGrossMinor: 0, gcVatMinor: 0,
      commissionMinor: 0, grossIncomeMinor: 0, incomeAfterVatMinor: 0, paymentCount: 0 });
  });
  it("withholds rather than silently truncating an oversized period", () => {
    expect(buildFinancialsIncome(0, Array.from({ length: FINANCIALS_EVENT_LIMIT + 1 }, (_, i) => event(`PM-${i}`))))
      .toMatchObject({ available: false, reason: "too_many_events" });
  });
  it("withholds unsafe aggregate arithmetic and never mutates evidence", () => {
    const events = [event("PM-A", Number.MAX_SAFE_INTEGER), event("PM-B", Number.MAX_SAFE_INTEGER)];
    const before = JSON.stringify(events);
    expect(buildFinancialsIncome(0, events)).toMatchObject({ available: false, reason: "unavailable" });
    expect(JSON.stringify(events)).toBe(before);
  });
});

describe("minimal read-only Financials income service", () => {
  function database(events: FinancialsPaymentEvidence[]) {
    const seen: any[] = [], queries: any[] = [];
    const db: any = { select: vi.fn((projection: any) => {
      const record: any = { projection: Object.keys(projection) }; seen.push(record);
      const query: any = { from: vi.fn((table: any) => { record.table = getTableName(table); return query; }),
        innerJoin: vi.fn(() => query), where: vi.fn((condition: any) => { record.condition = condition; return query; }),
        limit: vi.fn(async (limit: number) => { record.limit = limit; return record.table === "gc_payment_events" ? events : [{ jlt20: "50.00", currency: "GBP" }]; }) };
      queries.push(query); return query;
    }),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn(), transaction: vi.fn() };
    return { db, seen, queries };
  }
  const from = new Date("2026-11-16T00:00:00Z"), to = new Date("2026-11-23T00:00:00Z");
  it("projects only payment ID, amount and currency; uses exact existing interval and paid-out event type", async () => {
    const { db, seen } = database([event()]);
    expect(await readFinancialsIncome(db, from, to)).toMatchObject({ available: true, incomeAfterVatMinor: 15000 });
    expect(seen[0].projection).toEqual(["paymentId", "amount", "currency"]);
    expect(seen[0].table).toBe("gc_payment_events");
    expect(seen[0].limit).toBe(FINANCIALS_EVENT_LIMIT + 1);
    expect(seen[1].projection).toEqual(["jlt20", "currency"]);
    expect(seen[1].table).toBe("remittance_lines");
    expect(seen[1].limit).toBe(FINANCIALS_EVENT_LIMIT + 1);
    const sql = new MySqlDialect().sqlToQuery(seen[0].condition);
    expect(sql.sql).toContain("`eventType` = ?");
    expect(sql.sql).toContain("`occurredAt` >= ?");
    expect(sql.sql).toContain("`occurredAt` < ?");
    expect(sql.params).toEqual(["payments_paid_out", "2026-11-16 00:00:00.000", "2026-11-23 00:00:00.000"]);
    const commissionSql = new MySqlDialect().sqlToQuery(seen[1].condition);
    expect(commissionSql.params).toEqual(["2026-11-16 00:00:00.000", "2026-11-23 00:00:00.000"]);
    expect(commissionSql.sql).toContain("`remittance_batches`.`createdAt`");
    expect(commissionSql.sql).not.toContain("is not null");
    for (const method of ["insert", "update", "delete", "execute", "transaction"]) expect(db[method]).not.toHaveBeenCalled();
  });
  it("returns no false totals or SQL/private details on a database failure", async () => {
    const { db } = database([]);
    db.select.mockImplementation(() => { throw new Error("SQL raw_payload email private@example.invalid"); });
    const result = await readFinancialsIncome(db, from, to);
    expect(result).toMatchObject({ available: false, reason: "unavailable", incomeAfterVatMinor: null });
    expect(JSON.stringify(result)).not.toMatch(/SQL|email|private@example/);
  });
  it("does not reuse or cache evidence across period changes", async () => {
    const events = [event()];
    const { db } = database(events);
    await readFinancialsIncome(db, from, to);
    events.length = 0;
    const next = await readFinancialsIncome(db, to, new Date("2026-11-30T00:00:00Z"));
    expect(next.incomeAfterVatMinor).toBe(5000);
    expect(db.select).toHaveBeenCalledTimes(4);
  });
});

describe("currency-aware commission share evidence", () => {
  it("distinguishes a genuinely empty period from missing commission shares", () => {
    expect(buildFinancialsIncomeFromEvidence([], []).incomeAfterVatMinor).toBe(0);
    expect(buildFinancialsIncomeFromEvidence([{ jlt20: null, currency: "GBP" }], []).available).toBe(false);
    expect(buildFinancialsIncomeFromEvidence([{ jlt20: "50.00", currency: "GBP" }, { jlt20: null, currency: "GBP" }], []).available).toBe(false);
  });
  it.each(["EUR", "USD", null, "", "gbp", "GBP "]) ("never treats commission currency %s as pounds", currency => {
    const result = buildFinancialsIncomeFromEvidence([{ jlt20: "50.00", currency }], [event()]);
    expect(result.available).toBe(false); expect(result.incomeAfterVatMinor).toBeNull();
  });
  it("withholds mixed currency shares instead of converting or summing them", () => {
    expect(buildFinancialsIncomeFromEvidence([{ jlt20: "50.00", currency: "GBP" }, { jlt20: "50.00", currency: "EUR" }], []).available).toBe(false);
  });
  it("sums commission shares with exact signed pence and no VAT deduction", () => {
    expect(buildFinancialsIncomeFromEvidence([{ jlt20: "50.25", currency: "GBP" }, { jlt20: "-0.01", currency: "GBP" }], [event()]))
      .toMatchObject({ available: true, commissionMinor: 5024, gcVatMinor: 2000, incomeAfterVatMinor: 15024 });
  });
  it("withholds oversized or malformed recorded commission evidence", () => {
    expect(buildFinancialsIncomeFromEvidence([{ jlt20: "not-money", currency: "GBP" }], []).available).toBe(false);
    expect(buildFinancialsIncomeFromEvidence(Array.from({ length: FINANCIALS_EVENT_LIMIT + 1 }, () => ({ jlt20: "1.00", currency: "GBP" })), []).reason).toBe("too_many_events");
  });
});
