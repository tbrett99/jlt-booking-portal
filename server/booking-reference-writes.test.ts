import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings, orbitFinancialSnapshots } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({ pool: { getConnection: vi.fn() }, makeDatabase: vi.fn(), selectResults: [] as any[][], writes: [] as any[], trace: [] as string[] }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => mocks.pool } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: (connection: any) => mocks.makeDatabase(connection) }));
import { createBooking, updateBookingAdminFields, applyOrbitFinancialSnapshot } from "./db";
import { BookingReferenceConflictError } from "./booking-reference-guard";

const snapshot = {
  bookingId: 7, crmRef: "JLT-0007", currency: "GBP" as const, grossBookingValue: 1500,
  totalNetCost: 1200, netCostSubtotal: 1200, netCostStatus: "complete" as const,
  missingNetCostProducts: 0, grossMargin: 300, marginPct: 20, expectedCommission: 250,
  financialRevision: "a".repeat(64), financialSnapshotAt: "2026-11-04T10:00:00.000Z",
};
function mockDatabase() {
  const database: any = {
    select: vi.fn(() => {
      let result: any[] | undefined;
      const consume = () => result ??= mocks.selectResults.shift() ?? [];
      const chain: any = {
        from: () => chain, where: () => chain, orderBy: () => chain,
        limit: () => chain, for: () => { mocks.trace.push("row-lock"); return chain; },
        then: (resolve: any, reject: any) => Promise.resolve(consume()).then(resolve, reject),
      };
      return chain;
    }),
    insert: vi.fn((table) => ({ values: async (values: any) => { mocks.writes.push({ kind: "insert", table, values }); return [{ insertId: 7 }]; } })),
    update: vi.fn((table) => ({ set: (values: any) => ({ where: async () => { mocks.writes.push({ kind: "update", table, values }); } }) })),
    transaction: vi.fn(async (work: any) => {
      const previous = mocks.writes.length;
      mocks.trace.push("begin");
      try { const result = await work(database); mocks.trace.push("commit"); return result; }
      catch (error) { mocks.writes.splice(previous); mocks.trace.push("rollback"); throw error; }
    }),
  };
  return database;
}

describe("central booking-reference write boundaries (mock database only)", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.selectResults.splice(0); mocks.writes.splice(0); mocks.trace.splice(0);
    const database = mockDatabase(); mocks.makeDatabase.mockReturnValue(database);
    const connection = {
      query: vi.fn(async (query: string) => { const acquire = query.includes("GET_LOCK"); mocks.trace.push(acquire ? "reference-lock" : "reference-unlock"); return [[acquire ? { acquired: 1 } : { released: 1 }]]; }),
      release: vi.fn(), destroy: vi.fn(),
    };
    mocks.pool.getConnection.mockResolvedValue(connection);
    // Merely configures mocked pool creation; no real connection/credential is used.
    process.env.DATABASE_URL = "mysql://mock-only/mock";
  });

  it.each(["ptsRef", "crmRef"] as const)("rejects an occupied %s before changing any submitted financial field", async (field) => {
    mocks.selectResults.push([{ id: 7, ptsRef: null, crmRef: null }], [{ id: 88 }]);
    await expect(updateBookingAdminFields(7, { [field]: " used-ref ", grossCost: 1234, expectedCommission: 80, grossCostLockedAt: new Date() })).rejects.toBeInstanceOf(BookingReferenceConflictError);
    expect(mocks.writes).toEqual([]);
    expect(mocks.trace).toEqual(["reference-lock", "begin", "row-lock", "rollback", "reference-unlock"]);
  });

  it("creates both references together only after both pass checks", async () => {
    mocks.selectResults.push([], [], [{ id: 7, ptsRef: "0007", crmRef: "JLT-0007" }]);
    await createBooking({ agentId: 5, clientName: "Synthetic", departureDate: new Date(), reimbursementsRequired: false, ptsRef: " 0007 ", crmRef: " jlt-0007 " });
    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0]).toMatchObject({ kind: "insert", table: bookings, values: { ptsRef: "0007", crmRef: "JLT-0007" } });
    expect(mocks.trace.indexOf("commit")).toBeLessThan(mocks.trace.indexOf("reference-unlock"));
  });

  it("a rejected import reference never creates an orphan booking", async () => {
    mocks.selectResults.push([{ id: 88 }]);
    await expect(createBooking({ agentId: 5, clientName: "Synthetic", departureDate: new Date(), reimbursementsRequired: false, ptsRef: "0007" })).rejects.toBeInstanceOf(BookingReferenceConflictError);
    expect(mocks.writes).toEqual([]);
  });

  it("preserves an unchanged historical duplicate during a full form save", async () => {
    mocks.selectResults.push([{ id: 7, ptsRef: " old ", crmRef: null }], [{ id: 7 }]);
    await updateBookingAdminFields(7, { ptsRef: "OLD", expectedCommission: 80 });
    expect(mocks.writes[0].values).toEqual({ ptsRef: " old ", expectedCommission: 80 });
    expect(mocks.makeDatabase().select).toHaveBeenCalledTimes(1); // locked current row only; no duplicate search
  });

  it("non-reference edits never need the reference lock", async () => {
    mocks.selectResults.push([{ id: 7 }]);
    await updateBookingAdminFields(7, { destination: "Synthetic location" });
    expect(mocks.pool.getConnection).not.toHaveBeenCalled();
    expect(mocks.writes[0].values).toEqual({ destination: "Synthetic location" });
  });

  it("blocks an occupied Orbit reference before any snapshot, finance or audit write", async () => {
    mocks.selectResults.push([{ id: 7, crmRef: null, currentStage: "Added to PTS" }], [], [{ id: 88 }]);
    await expect(applyOrbitFinancialSnapshot({ bookingId: 7, snapshot })).rejects.toBeInstanceOf(BookingReferenceConflictError);
    expect(mocks.writes).toEqual([]);
  });

  it("a mismatching Orbit reference cannot be used to update booking finances", async () => {
    mocks.selectResults.push([{ id: 7, crmRef: "JLT-OTHER", currentStage: "Added to PTS" }]);
    await expect(applyOrbitFinancialSnapshot({ bookingId: 7, snapshot })).rejects.toThrow("does not match");
    expect(mocks.writes).toEqual([]);
  });

  it("still mirrors an authorised financial snapshot and assigns its free Orbit reference", async () => {
    mocks.selectResults.push([{ id: 7, crmRef: null, currentStage: "Added to PTS", grossCost: "1000" }], [], [], []);
    const result = await applyOrbitFinancialSnapshot({ bookingId: 7, snapshot });
    expect(result).toMatchObject({ bookingId: 7, outcome: "applied", valuesChanged: true });
    expect(mocks.writes.find((w) => w.table === orbitFinancialSnapshots)).toBeDefined();
    expect(mocks.writes.find((w) => w.table === bookings && w.values.crmRef)).toMatchObject({ values: { crmRef: "JLT-0007" } });
  });
});
