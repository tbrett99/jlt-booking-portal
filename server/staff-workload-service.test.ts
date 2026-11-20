import { describe, expect, it } from "vitest";
import { getTableName, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { amendments, flightRequests } from "../drizzle/schema";
import { getStaffWorkloadDetails, getStaffWorkloadSummary, isMissingStaffWorkTable, readStaffWorkBatches, readStaffWorkData, readStaffWorkPageContexts, readStaffWorkPeople } from "./staff-workload-report";
const now = new Date("2026-11-20T12:00:00Z");
const range = { rangeStart: "2026-11-01", rangeEnd: "2026-11-21" };
const dialect = new MySqlDialect();
type Query = { table: string; keys: string[]; sql: string; params: unknown[]; limit: number };
function mockDb(fixtures: Record<string, any[]> = {}, errors: Record<string, unknown> = {}) {
  const queries: Query[] = []; const transactions: any[] = [];
  const db: any = {
    queries, transactions,
    transaction: async (work: any, config: any) => { transactions.push(config); return work(db); },
    select: (projection: any) => {
      let table: string; let condition: any;
      const chain: any = {
        from: (value: any) => { table = getTableName(value); return chain; },
        where: (value: any) => { condition = value; return chain; },
        orderBy: () => chain,
        limit: async (limit: number) => {
          const compiled = dialect.sqlToQuery(condition);
          queries.push({ table, keys: Object.keys(projection), sql: compiled.sql, params: compiled.params, limit });
          if (errors[table]) throw errors[table];
          let rows = fixtures[table] ?? [];
          if (compiled.sql.includes(" > ?")) {
            const last = Number(compiled.params.at(-1));
            rows = rows.filter(row => row.id > last).sort((a, b) => a.id - b.id);
          }
          if (table === "staff_work_events") rows = rows.filter(row => compiled.params.includes(row.domain));
          if (table === "users" || table === "bookings") rows = rows.filter(row => compiled.params.includes(row.id));
          return rows.slice(0, limit).map(row => Object.fromEntries(Object.entries(projection).map(([key, field]: [string, any]) => [key, field?.name ? row[field.name] ?? null : row[key] ?? null])));
        },
      };
      return chain;
    },
  };
  return db;
}
const fixtures = () => ({
  amendments: [{ id: 1, bookingId: 50, createdAt: new Date("2026-11-01T09:00:00Z"), status: "pending", pipelineStage: "To Do", isReimbursementDoc: false, assignedToId: 20 }, { id: 2, bookingId: 51, createdAt: new Date("2026-10-01T09:00:00Z"), status: "actioned", pipelineStage: "Actioned", actionedAt: new Date("2026-11-03T10:00:00Z"), actionedById: 10 }],
  flight_requests: [{ id: 1, bookingId: 60, createdAt: new Date("2026-10-01T09:00:00Z"), status: "completed", requestType: "both" }, { id: 2, bookingId: 61, createdAt: new Date("2026-10-01T09:00:00Z"), status: "completed", requestType: "ticketing" }],
  flight_request_actions: [{ id: 1, flightRequestId: 1, bookingId: 60, action: "ticketed", previousStatus: "ticketed", newStatus: "completed", performedById: 10, createdAt: new Date("2026-11-04T10:00:00Z") }, { id: 2, flightRequestId: 2, bookingId: 61, action: "ticketed", previousStatus: "pending", newStatus: "completed", performedById: null, createdAt: new Date("2026-11-03T10:00:00Z") }],
  users: [{ id: 10, name: "Historical staff", role: "agent", isActive: false }, { id: 20, name: "Assignee", role: "admin" }, { id: 999, name: "Never involved" }],
  bookings: [{ id: 50, departureDate: new Date("2026-11-27T23:30:00Z"), clientName: "Current client", ptsRef: "P50" }, { id: 51, clientName: "Amendment client" }, { id: 60, clientName: "Flight client", ptsRef: "P60", departureDate: new Date("2026-12-01T00:00:00Z") }, { id: 61, clientName: "Off page", ptsRef: "P61" }, { id: 999, clientName: "Unrelated" }],
});
describe("actual staff workload query service with SQL mocks (offline)", () => {
  it("reads all prior relevant minimal history, not range-only history, and no sensitive projections", async () => {
    const db = mockDb(fixtures());
    const data = await readStaffWorkData(db, now);
    expect(data.people.map(p => p.id)).toEqual([10, 20]);
    expect(data.historyTrackingReady).toBe(true);
    expect(data.domains.amendment.current[0].departureDate).toEqual(new Date("2026-11-27T23:30:00Z"));
    for (const query of db.queries) {
      expect(query.limit).toBeLessThanOrEqual(1001);
      expect(query.keys.join(" ")).not.toMatch(/pnr|email|details|queryMessage|amount|price|bank|rejectionReason|note|supplierName/i);
      if (["flight_request_actions", "reimbursement_audit_logs", "staff_work_events"].includes(query.table)) {
        expect(query.sql).toContain("<="); expect(query.sql).not.toContain(">="); expect(query.sql).toContain(" > ?");
      }
      if (query.table === "users") { expect(query.keys).toEqual(["id", "name"]); expect(query.params).not.toContain(999); expect(query.sql).not.toContain("role"); }
      if (query.table === "bookings") { expect(query.keys).toEqual(["id", "departureDate"]); expect(query.params).toEqual([50]); }
    }
  });
  it("uses a read-only consistent snapshot and enriches exact page booking IDs only", async () => {
    const db = mockDb(fixtures());
    const report = await getStaffWorkloadSummary(db, range, now);
    expect(report.summaries.find(s => s.domain === "flight")).toMatchObject({ completed: 2, reprocessed: 0 });
    expect(report.summaries.find(s => s.domain === "amendment")!.urgent).toBe(1);
    expect(db.transactions).toEqual([{ isolationLevel: "repeatable read" }]);
    db.queries.length = 0;
    const details = await getStaffWorkloadDetails(db, { ...range, domain: "flight", metric: "completed", page: 1, pageSize: 1 }, now);
    expect(details.total).toBe(2); expect(details.rows).toMatchObject([{ requestId: 1, clientName: "Flight client", reference: "P60", actorId: 10, actorName: "Historical staff" }]);
    const context = db.queries.filter((q: Query) => q.table === "bookings" && q.keys.includes("clientName"));
    expect(context).toHaveLength(1); expect(context[0].params).toEqual([60]); expect(context[0].limit).toBe(2);
    expect(context[0].keys).toEqual(["id", "clientName", "ptsRef", "topdogRef", "crmRef"]);
  });
  it("only a verified missing new table enables legacy fallback; other errors propagate", async () => {
    const missing = Object.assign(new Error("Table 'portal.staff_work_events' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
    const db = mockDb(fixtures(), { staff_work_events: { cause: missing } });
    const report = await getStaffWorkloadSummary(db, range, now);
    expect(report.historyTrackingReady).toBe(false); expect(report.warnings.join(" ")).toContain("Legacy evidence"); expect(report.summaries.find(s => s.domain === "flight")!.completed).toBe(2);
    const fault = new Error("Connection reset");
    await expect(getStaffWorkloadSummary(mockDb(fixtures(), { staff_work_events: fault }), range, now)).rejects.toBe(fault);
    const oldMissing = Object.assign(new Error("Table flight_request_actions doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
    expect(isMissingStaffWorkTable(oldMissing)).toBe(false);
    await expect(readStaffWorkData(mockDb(fixtures(), { flight_request_actions: oldMissing }), now)).rejects.toBe(oldMissing);
  });
  it("bounded keyset reading checks an extra row; exact cap succeeds, cap+1 fails closed", async () => {
    const db = mockDb({ flight_requests: Array.from({ length: 1002 }, (_, i) => ({ id: i + 1 })) });
    await expect(readStaffWorkBatches(db, flightRequests, { id: flightRequests.id }, sql`1 = 1`, 1001)).rejects.toThrow("No partial totals");
    expect(db.queries.map((q: Query) => q.params.at(-1))).toEqual([0, 1000]);
    expect(db.queries.map((q: Query) => q.limit)).toEqual([1000, 2]);
    const exact = mockDb({ flight_requests: Array.from({ length: 1001 }, (_, i) => ({ id: i + 1 })) });
    expect(await readStaffWorkBatches(exact, flightRequests, { id: flightRequests.id }, sql`1 = 1`, 1001)).toHaveLength(1001);
    const empty = mockDb(); expect(await readStaffWorkBatches(empty, amendments, { id: amendments.id }, sql`1 = 1`, 1)).toEqual([]);
  });
  it("refuses invalid source ordering and empty lookups avoid entire-table scans", async () => {
    const corrupt = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [{ id: 2 }, { id: 1 }] }) }) }) }) };
    await expect(readStaffWorkBatches(corrupt, flightRequests, { id: flightRequests.id }, sql`1 = 1`, 5)).rejects.toThrow("source order");
    const db = mockDb();
    expect(await readStaffWorkPeople(db, [])).toEqual([]); expect(await readStaffWorkPageContexts(db, [])).toEqual([]); expect(db.queries).toHaveLength(0);
    await expect(readStaffWorkPageContexts(db, Array.from({ length: 101 }, (_, i) => i + 1))).rejects.toThrow("page limit");
  });
});
