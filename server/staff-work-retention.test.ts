import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";

const offline = vi.hoisted(() => ({ database: null as any }));
vi.mock("mysql2/promise", () => ({ default: { createPool: vi.fn(() => ({ getConnection: () => { throw new Error("No database connection permitted"); } })) } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => new Proxy({}, { get: (_target, key) => offline.database[key] }) }));
vi.mock("./email", () => ({ sendNotificationEmail: vi.fn(() => { throw new Error("No notifications permitted"); }) }));
import * as helpers from "./db";
import { buildStaffWorkAnalysis, buildStaffWorkDetails } from "./staff-workload-report";
import { preserveAmendmentCompletion, preserveAmendmentRejection, preserveReimbursementTimestamps } from "./staff-work-ledger";

// Independent offline harness: original legacy evidence is always seeded directly,
// never fabricated by a new completion helper. No database, provider or network access.
const dialect = new MySqlDialect();
const intake = new Date("2026-02-10T10:00:00Z");
const oldCompletion = new Date("2026-03-10T10:00:00.875Z");
const oldPaid = new Date("2026-03-12T11:00:00.625Z");
const oldRejected = new Date("2026-03-15T12:00:00.250Z");
const now = new Date("2026-11-20T16:00:00Z");
const performer = { id: 20, role: "admin", name: "Synthetic performing staff" };
const legacyAmendment = { id: 1, bookingId: 100, agentId: 10, status: "pending", pipelineStage: "To Do", isReimbursementDoc: false,
  actionedAt: oldCompletion, actionedById: 44, assignedToId: 99, createdAt: intake };
const legacyReimbursement = { id: 2, bookingId: 100, agentId: 10, status: "scheduled", assignedToId: 99,
  scheduledAt: oldCompletion, paidAt: null, paidById: null, createdAt: intake, nextFollowUpAt: null };

type Fixture = ReturnType<typeof fixture>;
let f: Fixture;
function fixture() {
  const rows = new Map<any, any[]>([
    [schema.bookings, [{ id: 100, agentId: 10 }, { id: 101, agentId: 11 }]],
    [schema.amendments, [structuredClone(legacyAmendment)]], [schema.amendmentLineItems, [{ id: 900, amendmentId: 1 }]],
    [schema.reimbursementItems, [structuredClone(legacyReimbursement)]], [schema.reimbursementItemDocs, [{ id: 901, reimbursementItemId: 2 }]],
    [schema.staffWorkEvents, []], [schema.reimbursementAuditLogs, []],
    [schema.flightRequests, [{ id: 3, bookingId: 100, status: "pending", createdAt: intake }]], [schema.flightRequestActions, []],
    [schema.users, [performer]], [schema.adminTasks, [
      { id: 5, linkedType: "booking", linkedId: 100 }, { id: 6, linkedType: "booking", linkedId: 101 }, { id: 7, linkedType: "amendment", linkedId: 100 },
    ]],
  ]);
  for (const table of [schema.pipelineHistory, schema.notes, schema.reimbursementDocs, schema.commissionClaims, schema.cancellations, schema.refunds]) {
    rows.set(table, [{ id: 1000, bookingId: 100 }, { id: 1001, bookingId: 101 }]);
  }
  let failure: any = null;
  let failAfter = 0;
  let inserts = 0;
  let beforeTransaction: (() => void) | undefined;
  const trace: any[] = [];
  const matches = (row: any, table: any, condition: any) => {
    if (!condition) return true;
    const compiled = dialect.sqlToQuery(condition);
    const pattern = /`([^`]+)`\.`([^`]+)`\s*(=\s*\?|in\s*\(([^)]*)\))/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(compiled.sql))) {
      if (match[1] !== getTableName(table)) continue;
      const index = (compiled.sql.slice(0, match.index).match(/\?/g) ?? []).length;
      if (match[3].toLowerCase().startsWith("in")) {
        const count = (match[3].match(/\?/g) ?? []).length;
        if (!compiled.params.slice(index, index + count).includes(row[match[2]])) return false;
      } else if (row[match[2]] !== compiled.params[index]) return false;
    }
    return true;
  };
  const connection = (state: Map<any, any[]>, transactional: boolean): any => ({
    select: (fields?: any) => {
      let table: any, condition: any, limit = Infinity, locked = false;
      let order: any[] = [];
      const query: any = {
        from: (value: any) => { table = value; return query; },
        where: (value: any) => { condition = value; return query; },
        limit: (value: number) => { limit = value; return query; },
        orderBy: (...values: any[]) => { order = values; return query; },
        for: (mode: string) => { expect(mode).toBe("update"); expect(transactional).toBe(true); locked = true; return query; },
        then: (resolve: any, reject: any) => Promise.resolve().then(() => {
          if (!state.has(table)) throw new Error("Unapproved offline read");
          const selected = state.get(table)!.filter(row => matches(row, table, condition));
          if (order.length) selected.sort((a, b) => a[order[0].name] - b[order[0].name]);
          trace.push({ kind: "read", table: getTableName(table), locked, transactional, fields: fields ? Object.keys(fields) : null,
            ids: selected.slice(0, limit).map(row => row.id) });
          return selected.slice(0, limit).map(row => fields
            ? Object.fromEntries(Object.entries(fields).map(([key, column]: any) => [key, row[column.name]])) : { ...row });
        }).then(resolve, reject),
      };
      return query;
    },
    insert: (table: any) => ({ values: async (values: any) => {
      expect(transactional).toBe(true);
      if (table === failure && inserts++ >= failAfter) throw new Error("Synthetic missing audit/ledger storage");
      const list = state.get(table);
      if (!list) throw new Error("Unapproved offline insert");
      let id = 0;
      for (const value of Array.isArray(values) ? values : [values]) {
        id = 500 + list.length;
        if (table === schema.staffWorkEvents && list.some(row => row.eventKey === value.eventKey)) throw new Error("Duplicate eventKey");
        list.push({ id, ...value });
        trace.push({ kind: "insert", table: getTableName(table), values: structuredClone(value) });
      }
      return [{ insertId: id }];
    } }),
    update: (table: any) => ({ set: (values: any) => ({ where: async (condition: any) => {
      expect(transactional).toBe(true);
      if (!state.has(table)) throw new Error("Unapproved offline update");
      for (const row of state.get(table)!) if (matches(row, table, condition)) Object.assign(row, values);
      trace.push({ kind: "update", table: getTableName(table) });
    } }) }),
    delete: (table: any) => ({ where: async (condition: any) => {
      expect(transactional).toBe(true);
      if (!state.has(table)) throw new Error("Unapproved offline delete");
      state.set(table, state.get(table)!.filter(row => !matches(row, table, condition)));
      trace.push({ kind: "delete", table: getTableName(table) });
    } }),
    transaction: async (work: any) => {
      expect(transactional).toBe(false);
      beforeTransaction?.();
      const staged = new Map(Array.from(rows, ([table, list]) => [table, structuredClone(list)]));
      trace.push({ kind: "begin" });
      try {
        const result = await work(connection(staged, true));
        for (const [table, list] of staged) rows.set(table, list);
        trace.push({ kind: "commit" });
        return result;
      } catch (error) { trace.push({ kind: "rollback" }); throw error; }
    },
  });
  const db = connection(rows, false);
  offline.database = db;
  return { rows, trace, db, fail: (table: any, after = 0) => { failure = table; failAfter = after; },
    before: (callback: () => void) => { beforeTransaction = callback; }, events: () => rows.get(schema.staffWorkEvents)! };
}
function actual(table: any, id: number) { return f.rows.get(table)!.find(row => row.id === id); }
function snapshot() { return new Map(Array.from(f.rows, ([table, rows]) => [table, structuredClone(rows)])); }
function analysis(period: "prior" | "new" | "intake" = "prior") {
  const range = period === "prior" ? { rangeStart: "2026-03-01", rangeEnd: "2026-04-01" }
    : period === "new" ? { rangeStart: "2026-11-01", rangeEnd: "2026-11-21" }
    : { rangeStart: "2026-02-01", rangeEnd: "2026-03-01" };
  const domain = (name: "amendment" | "flight" | "reimbursement", table: any) => ({
    current: f.rows.get(table)!, ledger: f.events().filter(row => row.domain === name).map(row => ({ ...row, ...row.metadata })),
    legacy: name === "reimbursement" ? f.rows.get(schema.reimbursementAuditLogs)!.map(row => ({ id: row.id, requestId: row.reimbursementItemId,
      bookingId: row.bookingId, eventType: row.action, beforeStatus: row.oldStatus, afterStatus: row.newStatus, actorId: row.actedById, occurredAt: row.actedAt })) : [],
  });
  return buildStaffWorkAnalysis({ domains: { amendment: domain("amendment", schema.amendments), flight: domain("flight", schema.flightRequests),
    reimbursement: domain("reimbursement", schema.reimbursementItems) }, people: [], historyTrackingReady: true }, range, now);
}
function summary(name: "amendment" | "reimbursement", period: "prior" | "new" | "intake" = "prior") {
  return analysis(period).report.summaries.find(row => row.domain === name)!;
}
function seedLedger(value: any) { f.events().push({ id: 123 + f.events().length, recordedAt: intake, bookingId: 100, ...value }); }
function seedAudit(value: any) { f.rows.get(schema.reimbursementAuditLogs)!.push({ id: 90 + f.rows.get(schema.reimbursementAuditLogs)!.length,
  reimbursementItemId: 2, bookingId: 100, action: "status_changed", actedById: 45, ...value }); }
function baselines(domain: string) { return f.events().filter(row => row.domain === domain && row.eventType === "baseline_completed"); }

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "mysql://synthetic-only/never-connect");
  vi.useFakeTimers(); vi.setSystemTime(now);
  f = fixture();
  vi.spyOn(helpers, "createNote").mockImplementation(async () => { throw new Error("No notifications/notes permitted"); });
  vi.spyOn(helpers, "createInAppNotification").mockImplementation(async () => { throw new Error("No notifications permitted"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network permitted"); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(helpers.createNote).not.toHaveBeenCalled(); expect(helpers.createInAppNotification).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("reimbursement reliable legacy evidence retention", () => {
  it("keeps old scheduled work through reopen/reschedule and counts the new completion as a repeat subset", async () => {
    expect(summary("reimbursement")).toMatchObject({ completed: 1, reprocessed: 0 });
    await helpers.updateReimbursementStatus(2, "pending", 20, performer);
    await helpers.updateReimbursementStatus(2, "scheduled", 20, performer);
    expect(summary("reimbursement")).toMatchObject({ completed: 1, reprocessed: 0 });
    expect(summary("reimbursement", "new")).toMatchObject({ completed: 1, reprocessed: 1 });
    expect(baselines("reimbursement")).toHaveLength(1);
    expect(baselines("reimbursement")[0]).toMatchObject({ afterStatus: "scheduled", occurredAt: oldCompletion,
      actorId: null, actorRole: null, actorName: null, receivedAt: intake, sourceEventId: null,
      eventKey: `reimbursement:2:baseline_completed:scheduled:${Math.floor(oldCompletion.getTime() / 1000)}` });
    expect(actual(schema.reimbursementItems, 2).scheduledAt).toEqual(now);
    const details = buildStaffWorkDetails(analysis(), { rangeStart: "2026-03-01", rangeEnd: "2026-04-01", domain: "reimbursement", metric: "completed" });
    expect(details).toMatchObject({ total: 1, rows: [{ actorId: null, evidence: "legacy_record" }] });
    expect(f.trace.filter(row => row.kind === "read" && row.table === "reimbursement_items").every(row => row.locked)).toBe(true);
  });
  it("preserves unmatched scheduled and paid timestamps, paidBy only, before deleting legacy paid item", async () => {
    Object.assign(actual(schema.reimbursementItems, 2), { status: "paid", paidAt: oldPaid, paidById: 46, updatedAt: now });
    expect(summary("reimbursement")).toMatchObject({ completed: 1, paid: 1 });
    await helpers.deleteReimbursementItem(2, performer);
    expect(summary("reimbursement")).toMatchObject({ completed: 1, paid: 1, reprocessed: 0 });
    expect(summary("reimbursement", "intake").received).toBe(1);
    expect(baselines("reimbursement").map(row => [row.afterStatus, row.actorId])).toEqual([["scheduled", null], ["paid", 46]]);
    expect(baselines("reimbursement").every(row => row.actorRole === null && row.actorName === null && row.receivedAt.getTime() === intake.getTime())).toBe(true);
    expect(f.rows.get(schema.reimbursementItems)).toEqual([]); expect(f.rows.get(schema.reimbursementItemDocs)).toEqual([]);
  });
  it("preserves old paid evidence before a second paid date/by overwrites it", async () => {
    Object.assign(actual(schema.reimbursementItems, 2), { status: "pending", paidAt: oldPaid, paidById: 46 });
    await helpers.updateReimbursementStatus(2, "paid", 20, performer);
    expect(baselines("reimbursement").find(row => row.afterStatus === "paid")).toMatchObject({ occurredAt: oldPaid, actorId: 46 });
    expect(actual(schema.reimbursementItems, 2)).toMatchObject({ paidAt: now, paidById: 20 });
    expect(summary("reimbursement").paid).toBe(1); expect(summary("reimbursement", "new").paid).toBe(1);
  });
  it.each(["audit", "ledger"])("suppresses scheduled/paid no-op matches in %s at MySQL second precision", async source => {
    Object.assign(actual(schema.reimbursementItems, 2), { status: "paid", paidAt: oldPaid, paidById: 46 });
    for (const [status, at] of [["scheduled", oldCompletion], ["paid", oldPaid]] as const) {
      const sameSecond = new Date(Math.floor(at.getTime() / 1000) * 1000 + 100);
      if (source === "audit") seedAudit({ oldStatus: status, newStatus: status, actedAt: sameSecond });
      else seedLedger({ domain: "reimbursement", requestId: 2, eventType: "status_changed", beforeStatus: status, afterStatus: status,
        occurredAt: sameSecond, eventKey: `seed:${status}` });
    }
    expect(summary("reimbursement")).toMatchObject({ completed: 0, paid: 0 });
    await helpers.deleteReimbursementItem(2, performer);
    expect(baselines("reimbursement")).toEqual([]);
    expect(summary("reimbursement")).toMatchObject({ completed: 0, paid: 0, reprocessed: 0 });
  });
  it.each(["audit", "ledger"])("does not duplicate genuine %s transitions with matching scheduled/paid dates", async source => {
    Object.assign(actual(schema.reimbursementItems, 2), { status: "paid", paidAt: oldPaid, paidById: 46 });
    for (const [status, at] of [["scheduled", oldCompletion], ["paid", oldPaid]] as const) {
      if (source === "audit") seedAudit({ oldStatus: "pending", newStatus: status, actedAt: at });
      else seedLedger({ domain: "reimbursement", requestId: 2, eventType: "status_changed", beforeStatus: "pending", afterStatus: status,
        occurredAt: at, actorId: 45, eventKey: `seed:${status}` });
    }
    await helpers.deleteReimbursementItem(2, performer);
    expect(baselines("reimbursement")).toEqual([]);
    expect(summary("reimbursement")).toMatchObject({ completed: 1, paid: 1, reprocessed: 0 });
  });
  it("requires matching request, status and second, not just a nearby history row", async () => {
    seedAudit({ oldStatus: "paid", newStatus: "paid", actedAt: oldCompletion });
    seedAudit({ oldStatus: "scheduled", newStatus: "scheduled", actedAt: new Date(oldCompletion.getTime() - 1000) });
    seedLedger({ domain: "reimbursement", requestId: 999, eventType: "status_changed", beforeStatus: "scheduled", afterStatus: "scheduled",
      occurredAt: oldCompletion, eventKey: "other-request" });
    await helpers.updateReimbursementStatus(2, "pending", 20, performer);
    expect(baselines("reimbursement")).toHaveLength(1);
  });
  it("does not mutate on same-status saves or infer dates/actors from updatedAt/assignee", async () => {
    await helpers.updateReimbursementStatus(2, "scheduled", 20, performer);
    expect(f.events()).toEqual([]); expect(actual(schema.reimbursementItems, 2).scheduledAt).toEqual(oldCompletion);
    Object.assign(actual(schema.reimbursementItems, 2), { scheduledAt: null, paidAt: new Date("invalid"), updatedAt: oldPaid });
    await helpers.deleteReimbursementItem(2, performer);
    expect(baselines("reimbursement")).toEqual([]); expect(summary("reimbursement")).toMatchObject({ completed: 0, paid: 0 });
  });
  it("dedupes immutable timestamp keys when called twice inside an already locked writer", async () => {
    await f.db.transaction(async (tx: any) => {
      const row = await helpers.getReimbursementItemById(2, tx, true);
      await preserveReimbursementTimestamps(tx, row); await preserveReimbursementTimestamps(tx, row);
    });
    expect(baselines("reimbursement")).toHaveLength(1); expect(f.trace.filter(row => row.kind === "begin")).toHaveLength(1);
  });
  it.each(["overwrite", "delete"])("rolls back %s and any staged baselines on ledger failure", async operation => {
    Object.assign(actual(schema.reimbursementItems, 2), { status: "pending", paidAt: oldPaid, paidById: 46 });
    const original = snapshot();
    f.fail(schema.staffWorkEvents, 1);
    await expect(operation === "delete" ? helpers.deleteReimbursementItem(2, performer)
      : helpers.updateReimbursementStatus(2, "paid", 20, performer)).rejects.toThrow("missing");
    expect(f.rows).toEqual(original); expect(f.trace).toContainEqual({ kind: "rollback" });
  });
});

describe("amendment retained dates follow report eligibility", () => {
  it("preserves pending/To Do retained actionedAt before completion overwrite and reports old period plus new repeat", async () => {
    expect(summary("amendment")).toMatchObject({ completed: 1, reprocessed: 0 });
    await helpers.actionAmendment(1, 20, 100, performer);
    expect(baselines("amendment")).toHaveLength(1);
    expect(baselines("amendment")[0]).toMatchObject({ occurredAt: oldCompletion, actorId: 44, actorRole: null, receivedAt: intake });
    expect(summary("amendment")).toMatchObject({ completed: 1, reprocessed: 0 });
    expect(summary("amendment", "new")).toMatchObject({ completed: 1, reprocessed: 1 });
    expect(actual(schema.amendments, 1).actionedAt).toEqual(now);
  });
  it("retains pending completion before clearing it during a non-completing stage change", async () => {
    await helpers.updateAmendmentPipeline(1, { pipelineStage: "In Progress" }, performer, 100);
    expect(actual(schema.amendments, 1).actionedAt).toBeNull();
    expect(summary("amendment").completed).toBe(1);
    expect(baselines("amendment")[0].actorId).toBe(44);
  });
  it("same-second recorded non-complete transition contradicts the retained date", async () => {
    seedLedger({ domain: "amendment", requestId: 1, eventType: "reopened", beforeStatus: "Actioned", afterStatus: "To Do",
      occurredAt: new Date("2026-03-10T10:00:00.050Z"), eventKey: "seed:contradiction" });
    expect(summary("amendment").completed).toBe(0);
    await helpers.actionAmendment(1, 20, 100, performer);
    expect(baselines("amendment")).toEqual([]); expect(summary("amendment").completed).toBe(0);
    expect(summary("amendment", "new")).toMatchObject({ completed: 1, reprocessed: 0 });
  });
  it("existing genuine completion prevents an extra latest-date fallback even on another second", async () => {
    seedLedger({ domain: "amendment", requestId: 1, eventType: "status_changed", beforeStatus: "To Do", afterStatus: "Actioned",
      occurredAt: new Date("2026-03-09T10:00:00Z"), eventKey: "seed:genuine", actorId: 45 });
    await helpers.actionAmendment(1, 20, 100, performer);
    expect(baselines("amendment")).toEqual([]);
    expect(summary("amendment")).toMatchObject({ completed: 1, reprocessed: 0 });
    expect(summary("amendment", "new")).toMatchObject({ completed: 1, reprocessed: 1 });
  });
  it("same-status Actioned snapshot is not a genuine completion and cannot suppress retained evidence", async () => {
    seedLedger({ domain: "amendment", requestId: 1, eventType: "status_changed", beforeStatus: "Actioned", afterStatus: "Actioned",
      occurredAt: oldCompletion, eventKey: "seed:no-op" });
    await helpers.actionAmendment(1, 20, 100, performer);
    expect(baselines("amendment")).toHaveLength(1); expect(summary("amendment").completed).toBe(1);
  });
  it("marks pending retained timestamp baselines and new work as documents excluded from deleted history", async () => {
    actual(schema.amendments, 1).isReimbursementDoc = true;
    await helpers.actionAmendment(1, 20, 100, performer);
    await helpers.deleteBooking(100, performer);
    expect(f.events().filter(row => row.domain === "amendment").every(row => row.requestType === "reimbursement_doc")).toBe(true);
    expect(summary("amendment")).toMatchObject({ received: 0, completed: 0, reprocessed: 0, rejected: 0 });
    expect(summary("amendment", "new")).toMatchObject({ completed: 0, reprocessed: 0, touched: 0 });
  });
  it("preserves a retained rejection before rejection timestamp/by overwrite", async () => {
    Object.assign(actual(schema.amendments, 1), { rejectedAt: oldRejected, rejectedById: 47 });
    await helpers.rejectAmendment(1, 20, "Synthetic reason", 100, performer);
    expect(baselines("amendment").find(row => row.afterStatus === "rejected")).toMatchObject({ occurredAt: oldRejected, actorId: 47 });
    expect(summary("amendment").rejected).toBe(1); expect(summary("amendment", "new").rejected).toBe(1);
  });
  it("never infers completion from updatedAt, stage or assignee with invalid/future/missing timestamp", async () => {
    for (const at of [null, new Date("invalid"), new Date("2027-01-01T00:00:00Z")]) {
      Object.assign(actual(schema.amendments, 1), { actionedAt: at, updatedAt: oldCompletion });
      await f.db.transaction((tx: any) => preserveAmendmentCompletion(tx, actual(schema.amendments, 1)));
    }
    expect(baselines("amendment")).toEqual([]);
  });
  it("rolls back pending legacy timestamp overwrite when append-only storage is missing", async () => {
    f.fail(schema.staffWorkEvents, 1);
    const original = snapshot();
    await expect(helpers.actionAmendment(1, 20, 100, performer)).rejects.toThrow("missing");
    expect(f.rows).toEqual(original); expect(f.trace).toContainEqual({ kind: "rollback" });
  });
});

describe("targeted booking cascade retention", () => {
  function seedCascade() {
    f.rows.get(schema.amendments)!.push(
      { ...structuredClone(legacyAmendment), id: 4, status: "rejected", actionedAt: null, actionedById: null, rejectedAt: oldRejected, rejectedById: 47 },
      { ...structuredClone(legacyAmendment), id: 5, isReimbursementDoc: true, rejectedAt: oldRejected, rejectedById: 48 },
      { ...structuredClone(legacyAmendment), id: 6, actionedAt: null, actionedById: null },
      { ...structuredClone(legacyAmendment), id: 7, bookingId: 101 },
    );
    // Deliberately unsorted input verifies actual SQL ordering/processing.
    f.rows.get(schema.amendments)!.reverse();
  }
  it("retains known genuine/doc completion/rejection and intake before deletion, preserving exact cascade/unlinks", async () => {
    seedCascade();
    expect(summary("amendment")).toMatchObject({ completed: 2, rejected: 1 });
    await helpers.deleteBooking(100, performer);
    expect(summary("amendment")).toMatchObject({ completed: 2, rejected: 1, reprocessed: 0 });
    expect(summary("amendment", "intake").received).toBe(4); // 3 deleted genuine tasks plus unaffected booking 101 task.
    const deleted = f.events().filter(row => row.eventType === "deleted");
    expect(deleted.map(row => row.requestId)).toEqual([1, 4, 5, 6]);
    expect(deleted.every(row => row.actorId === 20 && row.actorRole === "admin" && row.actorName === performer.name && row.receivedAt.getTime() === intake.getTime())).toBe(true);
    expect(f.events().filter(row => row.requestId === 5).every(row => row.requestType === "reimbursement_doc")).toBe(true);
    const detail = buildStaffWorkDetails(analysis(), { rangeStart: "2026-03-01", rangeEnd: "2026-04-01", domain: "amendment", metric: "completed" });
    expect(detail.total).toBe(2); expect(detail.rows.find(row => row.requestId === 1)).toMatchObject({ isDeleted: true, actorId: 44, evidence: "legacy_record", receivedAt: intake.toISOString() });
    expect(detail.rows.some(row => row.requestId === 5)).toBe(false);
    expect(f.rows.get(schema.amendments)!.map(row => row.id)).toEqual([7]);
    for (const table of [schema.pipelineHistory, schema.notes, schema.reimbursementDocs, schema.commissionClaims, schema.cancellations, schema.refunds]) {
      expect(f.rows.get(table)).toEqual([{ id: 1001, bookingId: 101 }]);
    }
    expect(f.rows.get(schema.bookings)).toEqual([{ id: 101, agentId: 11 }]);
    expect(f.rows.get(schema.adminTasks)).toEqual([
      { id: 5, linkedType: "none", linkedId: null }, { id: 6, linkedType: "booking", linkedId: 101 }, { id: 7, linkedType: "amendment", linkedId: 100 },
    ]);
    // Explicitly do not redesign or extend old cascade to line items, flights or reimbursement items.
    expect(f.rows.get(schema.amendmentLineItems)).toEqual([{ id: 900, amendmentId: 1 }]);
    expect(f.rows.get(schema.flightRequests)).toHaveLength(1); expect(f.rows.get(schema.reimbursementItems)).toHaveLength(1);
    expect(f.trace.filter(row => row.kind === "delete").map(row => row.table)).toEqual([
      "pipelineHistory", "notes", "reimbursementDocs", "commissionClaims", "amendments", "cancellations", "refunds", "bookings",
    ].map(name => getTableName((schema as any)[name])));
    expect(f.trace.filter(row => row.kind === "begin")).toHaveLength(1);
    expect(f.trace.find(row => row.kind === "read" && row.table === "bookings")).toMatchObject({ locked: true, fields: ["id"], ids: [100] });
    expect(f.trace.find(row => row.kind === "read" && row.table === "amendments")).toMatchObject({ locked: true, ids: [1, 4, 5, 6],
      fields: ["id", "bookingId", "status", "pipelineStage", "isReimbursementDoc", "actionedAt", "actionedById", "rejectedAt", "rejectedById", "createdAt"] });
    const amendmentDelete = f.trace.findIndex(row => row.kind === "delete" && row.table === "amendments");
    expect(f.trace.filter((row, i) => row.kind === "insert" && row.table === "staff_work_events" && i > amendmentDelete)).toEqual([]);
  });
  it("dedupes seeded genuine completion and same-second rejection while retaining deleted intake", async () => {
    Object.assign(actual(schema.amendments, 1), { rejectedAt: oldRejected, rejectedById: 47 });
    seedLedger({ domain: "amendment", requestId: 1, eventType: "status_changed", beforeStatus: "To Do", afterStatus: "Actioned",
      occurredAt: oldCompletion, eventKey: "seed:completed", actorId: 44 });
    seedLedger({ domain: "amendment", requestId: 1, eventType: "status_changed", beforeStatus: "Actioned", afterStatus: "rejected",
      occurredAt: new Date("2026-03-15T12:00:00.010Z"), eventKey: "seed:rejected", actorId: 47 });
    await helpers.deleteBooking(100);
    expect(baselines("amendment")).toEqual([]);
    expect(summary("amendment")).toMatchObject({ completed: 1, rejected: 1 });
    expect(f.events().find(row => row.eventType === "deleted")).toMatchObject({ actorId: null, actorRole: null, actorName: null, receivedAt: intake });
  });
  it("idempotently retains known rejection at entity/date key under the same writer", async () => {
    Object.assign(actual(schema.amendments, 1), { rejectedAt: oldRejected, rejectedById: 47 });
    await f.db.transaction(async (tx: any) => {
      await preserveAmendmentRejection(tx, actual(schema.amendments, 1));
      await preserveAmendmentRejection(tx, actual(schema.amendments, 1));
    });
    expect(baselines("amendment")).toHaveLength(1);
    expect(baselines("amendment")[0].eventKey).toBe(`amendment:1:baseline_rejected:${Math.floor(oldRejected.getTime() / 1000)}`);
  });
  it("uses booking/request data from locks and rejects a booking removed before the transaction", async () => {
    f.before(() => f.rows.set(schema.bookings, f.rows.get(schema.bookings)!.filter(row => row.id !== 100)));
    await expect(helpers.deleteBooking(100, performer)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.events()).toEqual([]); expect(f.rows.get(schema.amendments)).toHaveLength(1);
    expect(f.trace.filter(row => row.kind === "delete")).toEqual([]);
  });
  it.each([0, 2])("rolls back the entire original cascade and staged evidence when ledger fails after %s inserts", async after => {
    seedCascade();
    const original = snapshot();
    f.fail(schema.staffWorkEvents, after);
    await expect(helpers.deleteBooking(100, performer)).rejects.toThrow("missing");
    expect(f.rows).toEqual(original); expect(f.trace).toContainEqual({ kind: "rollback" });
    expect(f.trace.some(row => row.kind === "delete" && row.table === getTableName(schema.pipelineHistory))).toBe(true);
    expect(f.trace.some(row => row.kind === "commit")).toBe(false);
  });
});
