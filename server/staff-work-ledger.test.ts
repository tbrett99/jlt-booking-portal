import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect, getTableConfig } from "drizzle-orm/mysql-core";
import { getTableName } from "drizzle-orm";
import * as schema from "../drizzle/schema";

const external = vi.hoisted(() => ({ database: null as any, raw: null as any }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({ getConnection: async () => external.raw }) } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => new Proxy({}, { get: (_target, key) => external.database[key] }) }));
vi.mock("./email", () => ({ sendNotificationEmail: vi.fn(async () => undefined) }));
import * as helpers from "./db";
import { flightRequestsRouter } from "./flight-requests-router";
import { workEventValues, amendmentWorkStatus } from "./staff-work-ledger";
import { buildStaffWorkAnalysis, buildStaffWorkDetails } from "./staff-workload-report";

const dialect = new MySqlDialect();
const receivedAt = new Date("2026-02-10T10:00:00Z");
const completedAt = new Date("2026-03-10T10:00:00Z");
const staff = { id: 20, role: "admin", name: "Synthetic performing staff" };
const agent = { id: 10, role: "agent", name: "PRIVATE AGENT NAME" };
const amendment = { id: 1, bookingId: 100, agentId: 10, pipelineStage: "To Do", status: "pending", assignedToId: null, actionedAt: null, actionedById: null, createdAt: receivedAt };
const reimbursement = { id: 2, bookingId: 100, agentId: 10, status: "pending", assignedToId: null, actionedAt: null, nextFollowUpAt: null, isLate: false, createdAt: receivedAt };
const flight = { id: 3, bookingId: 100, agentId: 10, requestType: "both", status: "pending", cancellationStatus: "pending", invoiceAddedToPts: false, queryMessage: null, createdAt: receivedAt, pnr: "SYNTHETIC", flightCost: "10", priceIncreaseAmount: "20" };

type Fixture = ReturnType<typeof fixture>;
let f: Fixture;
function fixture() {
  const rows = new Map<any, any[]>([
    [schema.amendments, [structuredClone(amendment)]], [schema.amendmentLineItems, []],
    [schema.reimbursementItems, [structuredClone(reimbursement)]], [schema.reimbursementItemDocs, []],
    [schema.flightRequests, [structuredClone(flight)]], [schema.flightRequestActions, []],
    [schema.reimbursementAuditLogs, []], [schema.staffWorkEvents, []],
    [schema.bookings, [{ id: 100, agentId: 10, isPersonalBooking: false, clientName: "Synthetic" }]],
    [schema.users, [staff, agent]], [schema.businessStaffMemberships, []], [schema.notes, []],
  ]);
  const trace: any[] = [];
  let failTable: any = null;
  let beforeTransaction: (() => void) | undefined;
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
      const query: any = {
        from: (value: any) => { table = value; return query; },
        where: (value: any) => { condition = value; return query; },
        limit: (value: number) => { limit = value; return query; }, orderBy: () => query,
        innerJoin: () => query, leftJoin: () => query,
        for: (mode: string) => { expect(mode).toBe("update"); expect(transactional).toBe(true); locked = true; return query; },
        then: (resolve: any, reject: any) => Promise.resolve().then(() => {
          if (!state.has(table)) throw new Error("Unapproved table; no live/personal/finance reads allowed");
          trace.push({ kind: "read", table: getTableName(table), locked, transactional, sql: condition ? dialect.sqlToQuery(condition).sql : null });
          return state.get(table)!.filter(row => matches(row, table, condition)).slice(0, limit).map(row => fields
            ? Object.fromEntries(Object.entries(fields).map(([key, column]: any) => [key, row[column.name]])) : { ...row });
        }).then(resolve, reject),
      }; return query;
    },
    insert: (table: any) => ({ values: async (values: any) => {
      expect(transactional).toBe(true);
      if (table === failTable) throw new Error("Synthetic missing audit/ledger storage");
      const list = state.get(table); if (!list) throw new Error("Unexpected insert table");
      let id = 0;
      for (const value of Array.isArray(values) ? values : [values]) {
        id = 500 + list.length;
        if (table === schema.staffWorkEvents && list.some(row => row.eventKey === value.eventKey)) throw new Error("Duplicate eventKey");
        list.push({ id, createdAt: new Date(), ...value });
        trace.push({ kind: "insert", table: getTableName(table), id, values: value });
      }
      return [{ insertId: id }];
    } }),
    update: (table: any) => ({ set: (values: any) => ({ where: async (condition: any) => {
      expect(transactional).toBe(true);
      for (const row of state.get(table)!) if (matches(row, table, condition)) Object.assign(row, values);
      trace.push({ kind: "update", table: getTableName(table), values });
    } }) }),
    delete: (table: any) => ({ where: async (condition: any) => {
      expect(transactional).toBe(true);
      state.set(table, state.get(table)!.filter(row => !matches(row, table, condition)));
      trace.push({ kind: "delete", table: getTableName(table) });
    } }),
    transaction: async (work: any) => {
      expect(transactional).toBe(false); beforeTransaction?.();
      const cloned = new Map(Array.from(rows, ([table, values]) => [table, structuredClone(values)]));
      trace.push({ kind: "begin" });
      try { const result = await work(connection(cloned, true)); for (const [table, values] of Array.from(cloned)) rows.set(table, values); trace.push({ kind: "commit" }); return result; }
      catch (error) { trace.push({ kind: "rollback" }); throw error; }
    },
  });
  const db = connection(rows, false);
  const raw = {
    staged: null as Map<any, any[]> | null,
    beginTransaction: vi.fn(async () => { raw.staged = new Map(Array.from(rows, ([table, values]) => [table, structuredClone(values)])); }),
    execute: vi.fn(async (sql: string, params: any[]) => {
      const match = /^INSERT INTO ([a-z_]+)\s*\(([^)]+)\)/i.exec(sql);
      if (!match || !raw.staged) throw new Error("Unexpected prepared query");
      const table = Array.from(rows.keys()).find(table => getTableName(table) === match[1]);
      if (table === failTable) throw new Error("Synthetic missing audit/ledger storage");
      const list = raw.staged.get(table)!;
      const id = 700 + list.length;
      const keys = match[2].replace(/`/g, "").split(",").map(key => key.trim());
      const valueTokens = sql.slice(sql.indexOf("VALUES") + 6).replace(/[()]/g, "").split(",").map(token => token.trim());
      let index = 0; const value: any = { id };
      keys.forEach((key, position) => { const token = valueTokens[position]; value[key] = token === "?" ? params[index++] : token.replace(/'/g, ""); });
      if (typeof value.metadata === "string") value.metadata = JSON.parse(value.metadata);
      list.push(value); return [{ insertId: id }];
    }),
    commit: vi.fn(async () => { for (const [table, values] of Array.from(raw.staged!)) rows.set(table, values); raw.staged = null; }),
    rollback: vi.fn(async () => { raw.staged = null; }), release: vi.fn(),
  };
  external.database = db; external.raw = raw;
  return { rows, trace, db, raw, fail: (table: any) => { failTable = table; }, before: (callback: () => void) => { beforeTransaction = callback; },
    events: () => rows.get(schema.staffWorkEvents)!, audits: (domain: "flight" | "reimbursement") => rows.get(domain === "flight" ? schema.flightRequestActions : schema.reimbursementAuditLogs)! };
}
function caller(user = staff) { return flightRequestsRouter.createCaller({ user } as any); }
function actual(table: any, id: number) { return f.rows.get(table)!.find(row => row.id === id); }
function assertSourceLinks(domain: "flight" | "reimbursement") {
  for (const event of f.events().filter(row => row.domain === domain)) {
    expect(f.audits(domain).filter(row => row.id === event.sourceEventId)).toHaveLength(1);
    expect(event.eventKey).toBe(`${domain}:audit:${event.sourceEventId}`);
  }
}
beforeEach(() => {
  process.env.DATABASE_URL = "mysql://synthetic-only/never-connect";
  f = fixture();
  vi.spyOn(helpers, "createNote").mockResolvedValue({ id: 900 } as any);
  vi.spyOn(helpers, "createInAppNotification").mockResolvedValue(undefined as any);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network permitted"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("append-only staff work ledger schema/privacy", () => {
  it("has unique source keys, indexes and no foreign keys", () => {
    const config = getTableConfig(schema.staffWorkEvents);
    expect(config.name).toBe("staff_work_events"); expect(config.foreignKeys).toEqual([]);
    expect(config.indexes.find(index => index.config.name === "staff_work_events_event_key_unique")?.config.unique).toBe(true);
    expect(config.indexes).toHaveLength(5);
  });
  it("never snapshots agent name or arbitrary PNR/body/finance metadata", () => {
    const result = workEventValues({ domain: "flight", requestId: 3, eventType: "queried", actor: agent,
      metadata: { component: "ticketing", pnr: "SECRET", amount: 123, body: "SECRET" } as any });
    expect(result.actorName).toBeNull(); expect(result.actorRole).toBe("agent");
    expect(result.metadata).toEqual({ component: "ticketing" });
  });
  it("honours explicit pipeline stage over stale legacy status and rejection first", () => {
    expect(amendmentWorkStatus({ pipelineStage: "To Do", status: "actioned" })).toBe("To Do");
    expect(amendmentWorkStatus({ pipelineStage: "Actioned", status: "rejected" })).toBe("rejected");
    expect(amendmentWorkStatus({ pipelineStage: null, status: "actioned" })).toBe("Actioned");
    expect(amendmentWorkStatus({ pipelineStage: "invalid", status: "actioned" })).toBe("To Do");
  });
});

describe("actual amendment helpers with native Drizzle predicate mocks", () => {
  it("marks created, assigned, baseline, reopened, completed and rejected document tasks even after source deletion", async () => {
    const asOf = new Date("2026-11-20T16:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(asOf);
    try {
      Object.assign(actual(schema.amendments, 1), { isReimbursementDoc: true, pipelineStage: "Actioned", status: "actioned", actionedAt: completedAt, actionedById: 44 });
      await helpers.updateAmendmentPipeline(1, { assignedToId: 99 }, staff, 100);
      await helpers.updateAmendmentPipeline(1, { pipelineStage: "To Do" }, staff, 100);
      await helpers.actionAmendment(1, staff.id, 100, staff);
      await helpers.rejectAmendment(1, staff.id, "Synthetic", 100, staff);
      const createdId = await f.db.transaction((tx: any) => helpers.createAmendment({ bookingId: 100, agentId: 10, details: "Synthetic document task", isReimbursementDoc: true }, tx, agent));
      expect(createdId).toBeGreaterThan(0);
      expect(f.events().map(row => row.eventType)).toEqual(expect.arrayContaining(["created", "assigned", "baseline_completed", "reopened", "status_changed"]));
      expect(f.events().every(row => row.requestType === "reimbursement_doc")).toBe(true);
      const range = { rangeStart: "2026-11-01", rangeEnd: "2026-11-21" };
      const analysis = buildStaffWorkAnalysis({ domains: { amendment: { current: [], ledger: f.events(), legacy: [] }, flight: { current: [], ledger: [], legacy: [] }, reimbursement: { current: [], ledger: [], legacy: [] } }, people: [], historyTrackingReady: true }, range, asOf);
      expect(analysis.report.summaries[0]).toMatchObject({ received: 0, completed: 0, reprocessed: 0, rejected: 0, touched: 0 });
      expect(buildStaffWorkDetails(analysis, { ...range, domain: "amendment", metric: "completed" }).total).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("credits a real completion once, actual actor not assignee; no repeated dates", async () => {
    actual(schema.amendments, 1).assignedToId = 99;
    await helpers.actionAmendment(1, staff.id, 100, staff);
    const date = actual(schema.amendments, 1).actionedAt;
    await helpers.actionAmendment(1, staff.id, 100, staff);
    expect(f.events()).toHaveLength(1); expect(f.events()[0]).toMatchObject({ eventType: "status_changed", beforeStatus: "To Do", afterStatus: "Actioned", actorId: 20, actorRole: "admin", actorName: staff.name });
    expect(actual(schema.amendments, 1).actionedAt).toEqual(date);
    expect(f.trace.filter(row => row.kind === "read" && row.table === "amendments").every(row => row.locked)).toBe(true);
  });
  it("keeps legacy completion through assignment then reopen and does not copy assignee as performer", async () => {
    Object.assign(actual(schema.amendments, 1), { pipelineStage: "Actioned", status: "actioned", actionedAt: completedAt, actionedById: 44 });
    await helpers.updateAmendmentPipeline(1, { assignedToId: 99 }, staff, 100);
    await helpers.updateAmendmentPipeline(1, { pipelineStage: "To Do" }, staff, 100);
    const baseline = f.events().find(row => row.eventType === "baseline_completed");
    expect(baseline).toMatchObject({ occurredAt: completedAt, actorId: 44, actorRole: null, actorName: null, eventKey: "amendment:1:baseline_completed" });
    expect(f.events().find(row => row.eventType === "reopened")).toMatchObject({ beforeStatus: "Actioned", afterStatus: "To Do", actorId: 20 });
    expect(actual(schema.amendments, 1).actionedAt).toBeNull();
    await helpers.actionAmendment(1, 20, 100, staff);
    await helpers.updateAmendmentPipeline(1, { pipelineStage: "In Progress" }, staff, 100);
    expect(f.events().filter(row => row.eventType === "baseline_completed")).toHaveLength(1);
  });
  it("same-status actioned snapshots cannot suppress known legacy completion before reopen", async () => {
    Object.assign(actual(schema.amendments, 1), { pipelineStage: "Actioned", status: "actioned", actionedAt: completedAt, actionedById: 44 });
    f.rows.get(schema.staffWorkEvents)!.push({ id: 123, domain: "amendment", requestId: 1, eventType: "status_changed", beforeStatus: "Actioned", afterStatus: "Actioned", eventKey: "synthetic-snapshot" });
    await helpers.updateAmendmentPipeline(1, { pipelineStage: "To Do" }, staff);
    expect(f.events().find(row => row.eventType === "baseline_completed")).toMatchObject({ occurredAt: completedAt, actorId: 44 });
  });
  it("preserves reliable legacy completion before overwriting a stale actioned status under explicit To Do", async () => {
    Object.assign(actual(schema.amendments, 1), { status: "actioned", actionedAt: completedAt, actionedById: 44 });
    await helpers.actionAmendment(1, 20, 100, staff);
    expect(f.events()).toHaveLength(2);
    expect(f.events()[0]).toMatchObject({ eventType: "baseline_completed", occurredAt: completedAt });
    expect(f.events()[1]).toMatchObject({ beforeStatus: "To Do", afterStatus: "Actioned" });
  });
  it("never manufactures a legacy completion from updatedAt or assignment", async () => {
    Object.assign(actual(schema.amendments, 1), { pipelineStage: "Actioned", status: "actioned", updatedAt: completedAt, assignedToId: 99 });
    await helpers.updateAmendmentPipeline(1, { pipelineStage: "To Do" }, staff);
    expect(f.events().filter(row => row.eventType === "baseline_completed")).toEqual([]);
  });
  it("preserves newly recorded completion on reopen without inserting a duplicate baseline", async () => {
    await helpers.actionAmendment(1, 20, 100, staff);
    const completion = structuredClone(f.events()[0]);
    await helpers.updateAmendmentPipeline(1, { pipelineStage: "To Do" }, staff);
    expect(f.events()[0]).toEqual(completion); expect(f.events()).toHaveLength(2);
  });
  it("rejects incorrect booking linkage or missing rows before state writes", async () => {
    await expect(helpers.actionAmendment(1, 20, 999, staff)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(helpers.rejectAmendment(999, 20, "Synthetic", 100, staff)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.events()).toEqual([]); expect(actual(schema.amendments, 1).status).toBe("pending");
  });
  it("rolls back state and baseline if ledger storage is missing", async () => {
    f.fail(schema.staffWorkEvents);
    await expect(helpers.actionAmendment(1, 20, 100, staff)).rejects.toThrow("missing");
    expect(actual(schema.amendments, 1).status).toBe("pending"); expect(f.events()).toEqual([]);
    expect(f.trace).toContainEqual({ kind: "rollback" });
  });
  it("makes rejection idempotent and retains known completion evidence", async () => {
    Object.assign(actual(schema.amendments, 1), { pipelineStage: "Actioned", status: "actioned", actionedAt: completedAt, actionedById: 44 });
    await helpers.rejectAmendment(1, 20, "Synthetic", 100, staff);
    const date = actual(schema.amendments, 1).rejectedAt;
    await helpers.rejectAmendment(1, 20, "Synthetic", 100, staff);
    expect(f.events()).toHaveLength(2); expect(actual(schema.amendments, 1).rejectedAt).toEqual(date);
  });
  it("shares caller writer with creation and line items; dependent failure rolls back all", async () => {
    f.fail(schema.staffWorkEvents);
    await expect(f.db.transaction((tx: any) => helpers.createAmendment({ bookingId: 100, agentId: 10, details: "Synthetic", lineItems: [{ type: "other", notes: "PRIVATE BODY" }] }, tx, agent))).rejects.toThrow("missing");
    expect(f.rows.get(schema.amendments)).toHaveLength(1); expect(f.rows.get(schema.amendmentLineItems)).toEqual([]);
    expect(f.trace.filter(row => row.kind === "begin")).toHaveLength(1);
  });
});

describe("actual reimbursement helpers", () => {
  it("records scheduled processing and paid recording separately; repeated status never rewrites dates", async () => {
    await helpers.updateReimbursementStatus(2, "scheduled", 20, staff);
    const scheduledAt = actual(schema.reimbursementItems, 2).scheduledAt;
    await helpers.updateReimbursementStatus(2, "scheduled", 20, staff);
    expect(actual(schema.reimbursementItems, 2).scheduledAt).toEqual(scheduledAt);
    await helpers.updateReimbursementStatus(2, "paid", 20, staff);
    const paidAt = actual(schema.reimbursementItems, 2).paidAt;
    await helpers.updateReimbursementStatus(2, "paid", 20, staff);
    expect(actual(schema.reimbursementItems, 2).paidAt).toEqual(paidAt);
    expect(f.events().map(row => row.afterStatus)).toEqual(["scheduled", "paid"]); assertSourceLinks("reimbursement");
  });
  it("keeps processed/paid history on reopen and actor separate from assignee", async () => {
    actual(schema.reimbursementItems, 2).assignedToId = 99;
    await helpers.updateReimbursementStatus(2, "scheduled", 20, staff);
    await helpers.updateReimbursementStatus(2, "pending", 20, staff);
    expect(f.events()[1]).toMatchObject({ eventType: "reopened", beforeStatus: "scheduled", afterStatus: "pending", actorId: 20 });
    expect(f.events()[0].afterStatus).toBe("scheduled");
  });
  it("records repeated genuine chases separately but stores no chase body", async () => {
    const followup = new Date("2027-01-01T10:00:00Z");
    await helpers.setReimbursementAwaitingAgent(2, 20, "PRIVATE CHASE", followup, staff);
    await helpers.setReimbursementAwaitingAgent(2, 20, "PRIVATE CHASE", followup, staff);
    expect(f.events()).toHaveLength(2); expect(f.events().every(row => row.eventType === "queried")).toBe(true);
    expect(f.events()[1]).toMatchObject({ beforeStatus: "awaiting_agent", afterStatus: "awaiting_agent", metadata: { beforeFollowUpAt: followup.toISOString(), afterFollowUpAt: followup.toISOString() } });
    expect(JSON.stringify(f.events())).not.toContain("PRIVATE CHASE"); assertSourceLinks("reimbursement");
  });
  it("does not chase a paid item or write anything", async () => {
    actual(schema.reimbursementItems, 2).status = "paid";
    await expect(helpers.setReimbursementAwaitingAgent(2, 20, "Synthetic", new Date(), staff)).rejects.toThrow("paid"); expect(f.events()).toEqual([]);
  });
  it("suppresses repeated assignment and checkbox action, without implying payment", async () => {
    await helpers.updateReimbursementAssignee(2, 99, staff);
    await helpers.updateReimbursementAssignee(2, 99, staff);
    await helpers.markReimbursementActioned(2, staff);
    await helpers.markReimbursementActioned(2, staff);
    expect(f.events()).toHaveLength(2); expect(f.events()[0]).toMatchObject({ eventType: "assigned", actorId: 20, metadata: { afterAssigneeId: 99 } });
    expect(f.events()[1]).toMatchObject({ beforeStatus: "pending", afterStatus: "pending" });
    expect(actual(schema.reimbursementItems, 2).status).toBe("pending"); assertSourceLinks("reimbursement");
  });
  it("duplicate exact source event keys fail closed instead of writing double credit", async () => {
    f.rows.get(schema.staffWorkEvents)!.push({ id: 123, domain: "reimbursement", requestId: 2, eventKey: "reimbursement:audit:500" });
    await expect(helpers.updateReimbursementStatus(2, "scheduled", 20, staff)).rejects.toThrow("Duplicate eventKey");
    expect(actual(schema.reimbursementItems, 2).status).toBe("pending");
    expect(f.audits("reimbursement")).toEqual([]); expect(f.events()).toHaveLength(1);
  });
  it.each([schema.staffWorkEvents, schema.reimbursementAuditLogs])("rolls back item and old audit if any audit writer fails", async table => {
    f.fail(table);
    await expect(helpers.updateReimbursementStatus(2, "scheduled", 20, staff)).rejects.toThrow("missing");
    expect(actual(schema.reimbursementItems, 2).status).toBe("pending"); expect(f.events()).toEqual([]); expect(f.audits("reimbursement")).toEqual([]);
  });
  it("preserves old audit and ledger on deletion", async () => {
    await helpers.updateReimbursementStatus(2, "scheduled", 20, staff);
    await helpers.deleteReimbursementItem(2, staff);
    expect(f.rows.get(schema.reimbursementItems)).toEqual([]); expect(f.audits("reimbursement")).toHaveLength(2);
    expect(f.events()[1]).toMatchObject({ eventType: "deleted", beforeStatus: "scheduled", receivedAt }); assertSourceLinks("reimbursement");
  });
  it("bulk scheduling locks each item and does not assume an automated action was staff", async () => {
    f.rows.get(schema.reimbursementItems)!.push({ ...reimbursement, id: 4 });
    await helpers.scheduleReimbursementsForBooking(100);
    expect(f.events()).toHaveLength(2);
    expect(f.events().every(row => row.actorId === null && row.actorRole === "system" && row.sourceEventId === null)).toBe(true);
  });
  it("creation shares the caller transaction and returns only its own items", async () => {
    const created = await f.db.transaction((tx: any) => helpers.createReimbursementItems([{ bookingId: 100, agentId: 10, supplierName: "PRIVATE SUPPLIER", amount: 1 }], tx, agent));
    expect(created).toHaveLength(1); expect(created[0].id).not.toBe(2);
    expect(f.events()[0]).toMatchObject({ eventType: "created", actorId: 10, actorRole: "agent", actorName: null });
    expect(JSON.stringify(f.events())).not.toContain("PRIVATE SUPPLIER"); assertSourceLinks("reimbursement");
  });
  it("prepared creation uses the exact audit insert ID and original receivedAt before commit", async () => {
    const created = await helpers.createReimbursementItems([{ bookingId: 100, agentId: 10, supplierName: "Synthetic", amount: 1 }], undefined, agent);
    expect(created).toHaveLength(1);
    const event = f.events()[0]; expect(event.sourceEventId).toBe(f.audits("reimbursement")[0].id);
    expect(event.receivedAt).toEqual(created[0].createdAt); expect(f.raw.commit).toHaveBeenCalledOnce();
  });
  it("prepared creation rolls back all items and audit if ledger storage is missing", async () => {
    f.fail(schema.staffWorkEvents);
    await expect(helpers.createReimbursementItems([{ bookingId: 100, agentId: 10, supplierName: "Synthetic", amount: 1 }], undefined, agent)).rejects.toThrow("missing");
    expect(f.rows.get(schema.reimbursementItems)).toHaveLength(1); expect(f.audits("reimbursement")).toEqual([]);
    expect(f.raw.rollback).toHaveBeenCalledOnce(); expect(f.raw.commit).not.toHaveBeenCalled(); expect(f.raw.release).toHaveBeenCalledOnce();
  });
});

describe("actual flight tRPC mutations", () => {
  it("counts cancellation-only Mark Complete and reclosure once, with repeat work included and exact legacy dedupe", async () => {
    const asOf = new Date("2026-11-20T16:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(asOf);
    try {
      Object.assign(actual(schema.flightRequests, 3), { requestType: "cancellation", status: "cancelled" });
      await caller().updateStatus({ id: 3, status: "completed" });
      await caller().updateStatus({ id: 3, status: "cancelled" });
      await caller().updateStatus({ id: 3, status: "completed" });
      assertSourceLinks("flight");
      expect(f.events().every(row => row.metadata === null)).toBe(true);
      const range = { rangeStart: "2026-11-01", rangeEnd: "2026-11-21" };
      const data = { domains: { amendment: { current: [], ledger: [], legacy: [] }, flight: { current: [actual(schema.flightRequests, 3)], ledger: f.events(), legacy: f.audits("flight").map(row => ({ id: row.id, requestId: row.flightRequestId, bookingId: row.bookingId, eventType: row.action, beforeStatus: row.previousStatus, afterStatus: row.newStatus, actorId: row.performedById, occurredAt: row.createdAt })) }, reimbursement: { current: [], ledger: [], legacy: [] } }, people: [{ id: staff.id, name: staff.name }], historyTrackingReady: true };
      const analysis = buildStaffWorkAnalysis(data, range, asOf);
      expect(analysis.report.summaries[1]).toMatchObject({ completed: 1, reprocessed: 1, outstanding: 0 });
      expect(analysis.report.staff[0]).toMatchObject({ actorId: staff.id, flightsCompleted: 1, reprocessed: 1 });
      expect(analysis.report.daily.reduce((sum, day) => sum + day.completed, 0)).toBe(1);
      expect(buildStaffWorkDetails(analysis, { ...range, domain: "flight", metric: "completed", actorId: staff.id })).toMatchObject({ total: 1, rows: [{ requestId: 3, actorId: staff.id }] });
      expect(analysis.entities[0].actions.filter(action => action.completion)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("distinguishes completion from ticketing and completed→ticketed reopening, retaining completion", async () => {
    await caller().updateStatus({ id: 3, status: "ticketed" });
    await caller().updateStatus({ id: 3, status: "completed" });
    await caller().updateStatus({ id: 3, status: "completed" });
    await caller().updateStatus({ id: 3, status: "ticketed" });
    expect(f.audits("flight").map(row => row.action)).toEqual(["ticketed", "completed", "reopened"]);
    expect(f.events().map(row => row.eventType)).toEqual(["status_changed", "status_changed", "reopened"]);
    expect(f.events()[1]).toMatchObject({ beforeStatus: "ticketed", afterStatus: "completed", actorId: 20 }); assertSourceLinks("flight");
  });
  it("tracks both ticketing and cancellation components separately and suppresses component no-ops", async () => {
    await caller().updateStatus({ id: 3, status: "completed", cancellationStatus: "cancelled" });
    await caller().updateStatus({ id: 3, status: "completed", cancellationStatus: "cancelled" });
    expect(f.events()).toHaveLength(2);
    expect(f.events()[0].metadata).toBeNull();
    expect(f.events()[1]).toMatchObject({ beforeStatus: "pending", afterStatus: "cancelled", metadata: { component: "cancellation" } });
    await caller().updateStatus({ id: 3, cancellationStatus: "pending" });
    expect(f.events()[2]).toMatchObject({ eventType: "reopened", metadata: { component: "cancellation" } }); assertSourceLinks("flight");
  });
  it.each([schema.staffWorkEvents, schema.flightRequestActions])("rolls back flight state and both audits on failure", async table => {
    f.fail(table);
    await expect(caller().updateStatus({ id: 3, status: "completed", cancellationStatus: "cancelled" })).rejects.toThrow("missing");
    expect(actual(schema.flightRequests, 3)).toMatchObject({ status: "pending", cancellationStatus: "pending" });
    expect(f.events()).toEqual([]); expect(f.audits("flight")).toEqual([]);
  });
  it("reads beforeStatus from the locked row, not the stale notification join", async () => {
    f.before(() => { actual(schema.flightRequests, 3).status = "completed"; });
    await caller().updateStatus({ id: 3, status: "ticketed" });
    expect(f.events()[0]).toMatchObject({ eventType: "reopened", beforeStatus: "completed", afterStatus: "ticketed" });
  });
  it("logs real query edits and price notices without copying message bodies or prices", async () => {
    await caller().updateStatus({ id: 3, status: "query", queryMessage: "PRIVATE QUERY" });
    await caller().updateStatus({ id: 3, status: "query", queryMessage: "SECOND PRIVATE QUERY" });
    await caller().notifyPriceIncrease({ id: 3, newPrice: 55, note: "PRIVATE PRICE NOTE" });
    expect(f.events().map(row => row.eventType)).toEqual(["queried", "queried", "price_notified"]);
    expect(JSON.stringify(f.events())).not.toContain("PRIVATE");
    expect(f.events()[2].metadata).toBeNull();
    expect(Object.keys(f.events()[2])).not.toEqual(expect.arrayContaining(["amount", "newPrice", "note"]));
    assertSourceLinks("flight");
  });
  it("records repeated query sends as separate work, not separate completions", async () => {
    await caller().updateStatus({ id: 3, status: "query", queryMessage: "Synthetic query" });
    await caller().updateStatus({ id: 3, status: "query", queryMessage: "Synthetic query" });
    expect(f.events()).toHaveLength(2); expect(f.events()[1]).toMatchObject({ eventType: "queried", beforeStatus: "query", afterStatus: "query" });
    expect(f.audits("flight")).toHaveLength(2); assertSourceLinks("flight");
  });
  it("suppresses unchanged invoice checkbox and preserves history on deletion", async () => {
    await caller().toggleInvoice({ id: 3, invoiceAddedToPts: true });
    await caller().toggleInvoice({ id: 3, invoiceAddedToPts: true });
    await caller().delete({ id: 3 });
    expect(f.events()).toHaveLength(2); expect(f.audits("flight")).toHaveLength(2);
    expect(f.events()[1]).toMatchObject({ eventType: "deleted", requestType: "both", receivedAt });
    expect(f.rows.get(schema.flightRequests)).toEqual([]); assertSourceLinks("flight");
  });
  it.each(["acceptPriceIncrease", "declinePriceIncrease"] as const)("records %s as agent history, never staff productivity", async operation => {
    actual(schema.flightRequests, 3).status = "price_increase_pending";
    await caller(agent)[operation]({ id: 3 });
    expect(f.events()[0]).toMatchObject({ actorId: 10, actorRole: "agent", actorName: null, beforeStatus: "price_increase_pending" });
    assertSourceLinks("flight");
  });
  it("logs creation and preserves original request type/receivedAt atomically", async () => {
    const created = await caller(agent).create({ bookingId: 100, requestType: "ticketing", supplier: "Aviate", pnr: "SYNTHETIC", departureDate: new Date("2027-02-01"), ticketingDeadline: new Date("2027-01-01") });
    expect(f.events()[0]).toMatchObject({ eventType: "created", requestId: created.id, requestType: "ticketing", actorId: 10, actorRole: "agent", actorName: null, receivedAt: created.createdAt }); assertSourceLinks("flight");
  });
  it.each(["ticketing", "cancellation", "both"] as const)("persists Faremine for %s through the normal atomic create and audit workflow", async requestType => {
    const original = structuredClone(f.rows.get(schema.flightRequests));
    const created = await caller(agent).create({ bookingId: 100, requestType, supplier: "Faremine", pnr: "SYNTHETIC", departureDate: new Date("2027-02-01"), ticketingDeadline: new Date("2027-01-01"), flightCost: 100,
      ...(requestType === "both" ? { cancellationPnr: "CANCEL", cancellationDepartureDate: new Date("2027-02-02"), cancellationTicketingDeadline: new Date("2027-01-02"), cancellationFlightCost: 50 } : {}) });
    expect(created).toMatchObject({ bookingId: 100, agentId: 10, requestType, supplier: "Faremine", status: "pending", flightCost: "100" });
    expect(f.rows.get(schema.flightRequests)!.filter(row => row.id === 3)).toEqual(original);
    expect(f.events()[0]).toMatchObject({ eventType: "created", requestId: created.id, requestType, actorId: 10, actorRole: "agent", actorName: null });
    expect(f.audits("flight")).toHaveLength(1); assertSourceLinks("flight");
    if (requestType === "both") expect(created).toMatchObject({ cancellationPnr: "CANCEL", cancellationFlightCost: "50" });
  });
  it.each(["Lime", "VA Flight Store"] as const)("still accepts existing supplier %s", async supplier => {
    const created = await caller(agent).create({ bookingId: 100, requestType: "ticketing", supplier, pnr: "SYNTHETIC", departureDate: new Date("2027-02-01"), ticketingDeadline: new Date("2027-01-01") });
    expect(created.supplier).toBe(supplier); assertSourceLinks("flight");
  });
  it("does not allow arbitrary supplier strings", async () => {
    await expect(caller(agent).create({ bookingId: 100, requestType: "ticketing", supplier: "Unsupported supplier" as any, pnr: "SYNTHETIC", departureDate: new Date("2027-02-01"), ticketingDeadline: new Date("2027-01-01") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Protected middleware still checks whether the caller is business staff.
    expect(f.trace.every(entry => entry.kind === "read" && entry.table === "business_staff_memberships")).toBe(true);
  });
  it("denies Faremine requests on another agent's booking without a write", async () => {
    await expect(caller({ ...agent, id: 99 }).create({ bookingId: 100, requestType: "ticketing", supplier: "Faremine", pnr: "SYNTHETIC", departureDate: new Date("2027-02-01"), ticketingDeadline: new Date("2027-01-01") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.trace.some(entry => ["insert", "update", "delete", "begin"].includes(entry.kind))).toBe(false);
  });
  it.each(["updateStatus", "toggleInvoice", "delete", "notifyPriceIncrease"] as const)("retains admin role denial for %s", async operation => {
    await expect((caller(agent)[operation] as any)({ id: 3, status: "completed", invoiceAddedToPts: true, newPrice: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.events()).toEqual([]); expect(f.trace).toEqual([]);
  });
  it("denies another agent's price response before any mutation", async () => {
    actual(schema.flightRequests, 3).status = "price_increase_pending";
    await expect(caller({ ...agent, id: 99 }).acceptPriceIncrease({ id: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.events()).toEqual([]);
  });
});
