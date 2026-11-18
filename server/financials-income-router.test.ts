import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const state = vi.hoisted(() => ({ getDb: vi.fn(), managed: false, staff: false }));
vi.mock("./db", () => ({ getDb: state.getDb }));
vi.mock("./business-staff-access", async importOriginal => ({
  ...await importOriginal<typeof import("./business-staff-access")>(),
  getBusinessStaffAuthority: vi.fn(async () => ({ managed: state.managed, active: false, owner: null, membership: null, orbitReady: false, orbitNotice: "Synthetic" })),
}));
import { superAdminRouter } from "./super-admin-router";
import type { FinancialsPaymentEvidence, FinancialsCommissionEvidence } from "../shared/financials-income";
function fixture(events: FinancialsPaymentEvidence[] = [{ paymentId: "PM-SYNTHETIC", amount: 12000, currency: "GBP" }], commissions: FinancialsCommissionEvidence[] = [{ jlt20: "50.25", currency: "GBP" }]) {
  const reads: any[] = [];
  const db: any = { execute: vi.fn(async () => [[], []]), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() };
  db.select = vi.fn((projection: any) => {
    const selected = { projection: Object.keys(projection), table: "", condition: null, limit: 0 }; reads.push(selected);
    const query: any = { from: (table: any) => { selected.table = getTableName(table); return query; },
      where: (condition: any) => { selected.condition = condition; return query; },
      innerJoin: () => query, leftJoin: () => query, groupBy: () => query, orderBy: () => query, limit: (limit: number) => { selected.limit = limit; return query; },
      then: (resolve: any, reject: any) => {
        let rows: any[] = [];
        if (selected.table === "remittance_lines" && selected.projection.includes("total")) rows = [{ total: "50.25" }];
        if (selected.table === "remittance_lines" && selected.projection.includes("jlt20")) rows = commissions;
        if (selected.table === "gc_payment_events" && selected.projection.includes("paymentId")) rows = events;
        if (selected.table === "users" && selected.projection.includes("role") && state.staff) rows = [{ id: 47, name: "Synthetic administrator", role: "super_admin" }];
        return Promise.resolve(rows).then(resolve, reject);
      } };
    return query;
  });
  state.getDb.mockResolvedValue(db);
  return { db, reads };
}
function caller(role: string | null = "super_admin") {
  return superAdminRouter.createCaller({ user: role ? { id: 47, role, isActive: true, portalStatus: "active" } : null, req: {}, res: {} } as any);
}
beforeEach(() => { state.getDb.mockReset(); state.managed = false; state.staff = false; });
describe("actual Financials router integration, offline only", () => {
  it.each([false, true])("weekly response carries exact income after VAT with admin-list branch %s", async staff => {
    state.staff = staff;
    const { db, reads } = fixture();
    const result = await caller().weeklyStats({ weekStart: "2026-11-16" });
    expect(result.financials.incomeAfterVat).toMatchObject({ available: true, commissionMinor: 5025,
      gcGrossMinor: 12000, gcVatMinor: 2000, gcExVatMinor: 10000, grossIncomeMinor: 17025, incomeAfterVatMinor: 15025 });
    expect(result.financials.jltRevenueThisWeek).toBe(50.25);
    const read = reads.find(r => r.table === "gc_payment_events" && r.projection.includes("paymentId"));
    expect(read.projection).toEqual(["paymentId", "amount", "currency"]);
    const where = new MySqlDialect().sqlToQuery(read.condition);
    expect(where.params).toEqual(["payments_paid_out", "2026-11-16 00:00:00.000", "2026-11-23 00:00:00.000"]);
    const commissionRead = reads.find(r => r.table === "remittance_lines" && r.projection.includes("jlt20"));
    expect(commissionRead.projection).toEqual(["jlt20", "currency"]);
    expect(new MySqlDialect().sqlToQuery(commissionRead.condition).params).toEqual(["2026-11-16 00:00:00.000", "2026-11-23 00:00:00.000"]);
    for (const method of ["insert", "update", "delete", "transaction"]) expect(db[method]).not.toHaveBeenCalled();
  });
  it("monthly response uses the same rule and its exact selected-month interval", async () => {
    const { db, reads } = fixture();
    const result = await caller().monthlyStats({ monthStart: "2026-11-01" });
    expect(result.financials.incomeAfterVat).toMatchObject({ available: true, incomeAfterVatMinor: 15025, commissionMinor: 5025 });
    expect(result.financials.jltRevenueThisMonth).toBe(50.25);
    const read = reads.find(r => r.table === "gc_payment_events" && r.projection.includes("paymentId"));
    expect(new MySqlDialect().sqlToQuery(read.condition).params).toEqual(["payments_paid_out", "2026-11-01 00:00:00.000", "2026-12-01 00:00:00.000"]);
    for (const method of ["insert", "update", "delete", "transaction"]) expect(db[method]).not.toHaveBeenCalled();
  });
  it("missing evidence withholds only the new total instead of returning a misleading rounded fallback", async () => {
    fixture([{ paymentId: "PM-MISSING", amount: null, currency: "GBP" }]);
    const result = await caller().weeklyStats({ weekStart: "2026-11-16" });
    expect(result.financials.incomeAfterVat).toMatchObject({ available: false, incomeAfterVatMinor: null, reason: "missing_payment_evidence" });
    expect(result.financials.jltRevenueThisWeek).toBe(50.25);
  });
  it.each([null, "admin", "agent", "user"])("role %s cannot query either Financials report", async role => {
    const { db } = fixture();
    for (const call of [() => caller(role).weeklyStats({ weekStart: "2026-11-16" }), () => caller(role).monthlyStats({ monthStart: "2026-11-01" })]) {
      await expect(call()).rejects.toMatchObject({ code: role ? "FORBIDDEN" : "UNAUTHORIZED" });
    }
    expect(db.select).not.toHaveBeenCalled(); expect(db.execute).not.toHaveBeenCalled();
  });
  it("managed business employees remain denied before any income projection", async () => {
    const { db } = fixture(); state.managed = true;
    await expect(caller("agent").weeklyStats({ weekStart: "2026-11-16" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("agent").monthlyStats({ monthStart: "2026-11-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.select).not.toHaveBeenCalled(); expect(db.execute).not.toHaveBeenCalled();
  });
  it.each([{ jlt20: null, currency: "GBP" }, { jlt20: "50.00", currency: "EUR" }, { jlt20: "50.00", currency: null }])
    ("both selected-period routes withhold unknown or non-GBP commission evidence: %s", async commission => {
      fixture([], [commission]);
      const week = await caller().weeklyStats({ weekStart: "2026-11-16" });
      const month = await caller().monthlyStats({ monthStart: "2026-11-01" });
      for (const result of [week, month]) expect(result.financials.incomeAfterVat).toMatchObject({ available: false, incomeAfterVatMinor: null });
    });
});
