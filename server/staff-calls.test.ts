import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { User } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  slots: vi.fn(),
  status: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
  reschedule: vi.fn(),
  scan: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.db }));
vi.mock("./business-staff-access", () => ({
  getBusinessStaffAuthority: vi.fn(async () => null),
  assertBusinessStaffRouteAllowed: vi.fn(async () => undefined),
}));
vi.mock("./staff-calls-provider", () => ({
  StaffCallsProvider: class {
    getConnectionStatus = mocks.status;
    getBookableSlots = mocks.slots;
    createBooking = mocks.create;
    getBooking = mocks.get;
    cancelBooking = mocks.cancel;
    rescheduleBooking = mocks.reschedule;
    reconcileOperation = mocks.scan;
  },
  verifyStaffCallWebhook: mocks.verify,
}));
import { staffCallsRouter } from "./staff-calls-router";
import {
  createStaffCallsService,
  handleStaffCallsWebhook,
  reconcileStaffCallsBatch,
  staffCallPayloadHash,
} from "./staff-calls-service";

const dialect = new MySqlDialect();
let tables: Record<string, any[]>;
let writes: { table: string; record: any; type: string; tx: boolean }[];
let queries: string[];
let transactionDepth = 0;
let transactionOptions: any[];
let afterCommit: (() => void) | undefined;
let afterHostLock: (() => void) | undefined;
let locks: string[];
const start = new Date("2090-01-02T12:00:00Z"),
  end = new Date("2090-01-02T12:30:00Z");
const ended = new Date("2020-01-02T12:30:00Z");
const requestId = "11111111-1111-4111-8111-111111111111";
const clone = (v: any): any =>
  v instanceof Date
    ? new Date(v)
    : Array.isArray(v)
      ? v.map(clone)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))
        : v;
function eligible(id: number, role = "agent") {
  return {
    id,
    name: `Person ${id}`,
    email: `p${id}@example.test`,
    role,
    isActive: true,
    mustChangePassword: false,
    portalStatus: "active",
    crmStatus: "active",
    archiveId: null,
    businessId: null,
  };
}
function call(overrides: any = {}) {
  return {
    id: 31,
    hostUserId: 7,
    reasonKey: "business_review",
    reasonExplanation: null,
    format: "one_to_one",
    startAt: new Date("2020-01-02T12:00:00Z"),
    endAt: ended,
    status: "booked",
    version: 1,
    activeOperationId: null,
    providerBookingUid: "booking31",
    providerBookingId: "99",
    providerEventTypeId: "42",
    providerHostId: "7",
    meetingUrl: null,
    bookedAt: ended,
    createdById: 7,
    createdAt: ended,
    updatedAt: ended,
    ...overrides,
  };
}
function participant(overrides: any = {}) {
  return {
    id: 51,
    callId: 31,
    agentId: 12,
    attendance: "awaiting",
    outcome: null,
    privateNotes: null,
    sharedSummary: null,
    sharedAt: null,
    status: "active",
    version: 1,
    providerSeatUid: null,
    bookedAt: ended,
    createdAt: ended,
    updatedAt: ended,
    ...overrides,
  };
}
function matches(table: string, row: any, predicate: any) {
  if (!predicate) return true;
  const q = dialect.sqlToQuery(predicate);
  queries.push(q.sql);
  let pi = 0;
  let good = true;
  const regex =
    /`([^`]+)`\.`([^`]+)`\s*(=|<>|>=|<=|>|<|in)\s*(\? |\?|\([^)]*\))/gi;
  let m;
  while ((m = regex.exec(q.sql))) {
    const count = (m[4].match(/\?/g) || []).length;
    const values = q.params.slice(
      (q.sql.slice(0, m.index).match(/\?/g) || []).length,
      (q.sql.slice(0, m.index).match(/\?/g) || []).length + count
    );
    pi += count;
    if (m[1] !== table) continue;
    const value = row[m[2]];
    // MySqlDialect encodes timestamp parameters as UTC SQL strings; compare
    // them as dates as the real database does, not Date > string (NaN).
    const target =
      value instanceof Date && typeof values[0] === "string"
        ? new Date(values[0].replace(" ", "T") + "Z")
        : values[0];
    if (m[3].toLowerCase() === "in") good &&= values.includes(value);
    else if (m[3] === "=") good &&= value === target;
    else if (m[3] === "<>") good &&= value !== target;
    else if (m[3] === "<") good &&= value < target;
    else if (m[3] === ">") good &&= value > target;
    else if (m[3] === "<=") good &&= value <= target;
    else good &&= value >= target;
  }
  // SQL eligibility must be evaluated before fake SELECT's limit, just as in MySQL.
  const nullPredicate = /`([^`]+)`\.`([^`]+)`\s+is\s+(not\s+)?null/gi;
  while ((m = nullPredicate.exec(q.sql))) {
    if (m[1] === table) good &&= m[3] ? row[m[2]] != null : row[m[2]] == null;
  }
  if (table === "users" && q.sql.includes("sc_merge"))
    good &&=
      !row.archiveId &&
      !row.businessId &&
      (!row.crmStatus || row.crmStatus === "active");
  return good;
}
function fakeDb(tx = false): any {
  return {
    select(selection?: any) {
      let table = "",
        pred: any,
        limit = 10000;
      let ordering: { key: string; desc: boolean }[] = [];
      let joinTable = "";
      let locked = false;
      let joinPredicate: any;
      const builder: any = {
        from(t: any) {
          table = getTableName(t);
          return builder;
        },
        leftJoin() {
          return builder;
        },
        innerJoin(t: any, p: any) {
          joinTable = getTableName(t);
          joinPredicate = p;
          return builder;
        },
        where(p: any) {
          pred = p;
          return builder;
        },
        orderBy(...args: any[]) {
          ordering = args.map(a => {
            const q = dialect.sqlToQuery(a).sql;
            return {
              key: /`[^`]+`\.`([^`]+)`/.exec(q)?.[1] ?? "id",
              desc: q.includes("desc"),
            };
          });
          return builder;
        },
        limit(n: number) {
          limit = n;
          return builder;
        },
        for() {
          locked = true;
          return builder;
        },
        groupBy() {
          return builder;
        },
        then(resolve: any, reject: any) {
          try {
            if (locked) {
              locks.push(table);
              if (tx && table === "users" && afterHostLock) {
                const hook = afterHostLock;
                afterHostLock = undefined;
                hook();
              }
            }
            let rows = tables[table].filter(r => matches(table, r, pred));
            if (joinTable === "staff_call_participants")
              rows = rows.flatMap(r =>
                tables[joinTable]
                  .filter(
                    p =>
                      p.callId === r.id &&
                      matches(joinTable, p, joinPredicate) &&
                      matches(joinTable, p, pred)
                  )
                  .map(p => ({
                    ...r,
                    ...Object.fromEntries(
                      Object.entries(p).map(([k, v]) => [`participant_${k}`, v])
                    ),
                  }))
              );
            rows = [...rows]
              .sort((a, b) => {
                for (const o of ordering) {
                  const x = a[o.key] ?? 0,
                    y = b[o.key] ?? 0;
                  if (x < y) return o.desc ? 1 : -1;
                  if (x > y) return o.desc ? -1 : 1;
                }
                return a.id - b.id;
              })
              .slice(0, limit);
            const result = rows.map(r => {
              if (!selection) return clone(r);
              const out: any = {};
              for (const [k, column] of Object.entries(selection) as any) {
                if (
                  k === "archiveId" ||
                  k === "businessId" ||
                  k === "crmStatus"
                )
                  out[k] = clone(r[k] ?? null);
                else if (k === "participantCount")
                  out[k] = tables.staff_call_participants.filter(
                    p => p.callId === r.id && p.status === "active"
                  ).length;
                else if (column?.name) {
                  const ct = column.table ? getTableName(column.table) : table;
                  out[k] =
                    ct === "staff_call_participants" && joinTable
                      ? clone(r[`participant_${column.name}`])
                      : clone(
                          r[column.name] ??
                            (k === "archiveId" || k === "businessId"
                              ? null
                              : undefined)
                        );
                } else out[k] = r[k];
              }
              return out;
            });
            return Promise.resolve(result).then(resolve, reject);
          } catch (e) {
            return Promise.reject(e).then(resolve, reject);
          }
        },
      };
      return builder;
    },
    insert(t: any) {
      const table = getTableName(t);
      return {
        values(value: any) {
          const records = Array.isArray(value) ? value : [value];
          const ids = records.map(record => {
            const id = Math.max(0, ...tables[table].map(r => r.id || 0)) + 1;
            let row = { id, ...clone(record) };
            if (table === "staff_calls")
              row = {
                ...call({
                  id,
                  status: "pending",
                  version: 1,
                  bookedAt: null,
                  providerBookingUid: null,
                  providerBookingId: null,
                  providerEventTypeId: null,
                  providerHostId: null,
                }),
                ...row,
              };
            if (table === "staff_call_participants")
              row = { ...participant({ id, bookedAt: null }), ...row };
            if (table === "staff_call_webhook_inbox")
              row = { state: "received", processedAt: null, ...row };
            if (table === "staff_call_operations")
              row = {
                participantId: null,
                result: null,
                lastError: null,
                ...row,
              };
            tables[table].push(row);
            writes.push({ table, record: clone(row), type: "insert", tx });
            return { id };
          });
          return {
            $returningId: async () => ids,
            then: (resolve: any) => Promise.resolve(undefined).then(resolve),
          };
        },
      };
    },
    update(t: any) {
      const table = getTableName(t);
      return {
        set(record: any) {
          return {
            where: async (pred: any) => {
              for (const row of tables[table])
                if (matches(table, row, pred))
                  Object.assign(row, clone(record));
              writes.push({ table, record: clone(record), type: "update", tx });
              return [{ affectedRows: 1 }];
            },
          };
        },
      };
    },
    async transaction(fn: any, options?: any) {
      transactionOptions.push(options);
      const before = clone(tables);
      transactionDepth++;
      try {
        const result = await fn(fakeDb(true));
        if (afterCommit) {
          const hook = afterCommit;
          afterCommit = undefined;
          hook();
        }
        return result;
      } catch (e) {
        tables = before;
        throw e;
      } finally {
        transactionDepth--;
      }
    },
  };
}
function caller(id = 7, role: User["role"] = "agent") {
  return staffCallsRouter.createCaller({
    user: { ...eligible(id, role) } as User,
    req: {},
    res: {},
  } as TrpcContext);
}
const bookingInput = () => ({
  requestId,
  hostUserId: 7,
  reasonKey: "business_review" as const,
  format: "one_to_one" as const,
  startAt: start,
  endAt: end,
  agentIds: [12],
});
beforeEach(() => {
  transactionOptions = [];
  afterCommit = undefined;
  afterHostLock = undefined;
  locks = [];
  vi.clearAllMocks();
  writes = [];
  queries = [];
  tables = {
    users: [eligible(7), eligible(12), eligible(20, "admin")],
    staff_role_assignments: [
      { id: 1, userId: 7, staffRole: "agent_engagement", isActive: true },
    ],
    agent_crm_profiles: [],
    agent_record_merges: [],
    business_staff_memberships: [],
    staff_calls: [],
    staff_call_participants: [],
    staff_call_operations: [],
    staff_call_history: [],
    staff_call_webhook_inbox: [],
    staff_call_action_sources: [],
    academy_action_plans: [],
    academy_action_plan_targets: [],
  };
  mocks.db.mockImplementation(async () => {
    if (transactionDepth) throw new Error("Global DB call inside transaction");
    return fakeDb();
  });
  mocks.status.mockResolvedValue({
    state: "READY",
    oneToOne: { ready: true },
    group: { ready: true, capacity: 10 },
  });
  mocks.slots.mockResolvedValue({
    ok: true,
    value: [
      {
        start: start.toISOString(),
        end: end.toISOString(),
        remainingSeats: 10,
      },
    ],
  });
  mocks.create.mockImplementation(async (input: any) => ({
    ok: true,
    value: {
      ...input,
      bookingUid: "b-new",
      providerBookingId: 99,
      eventTypeId: 42,
      provider: "cal.com",
      start: start.toISOString(),
      end: end.toISOString(),
      status: "accepted",
      ...(input.kind === "group"
        ? { seatUid: `seat-${input.participantId}` }
        : {}),
    },
  }));
  mocks.scan.mockResolvedValue({
    ok: true,
    value: { bookings: [], complete: true },
  });
});

describe("actual staffCalls router with offline ORM/provider mocks", () => {
  it.each([
    { isActive: false },
    { mustChangePassword: true },
    { portalStatus: "paused" },
    { archiveId: 55 },
    { crmStatus: "cancelled" },
    { businessId: 3 },
  ])(
    "denies fresh ineligible agent %j despite eligible session",
    async flags => {
      Object.assign(tables.users[0], flags);
      await expect(caller().context()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(mocks.status).not.toHaveBeenCalled();
    }
  );
  it.each([{ isActive: false }, { mustChangePassword: true }])(
    "denies disabled fresh administrator %j",
    async flags => {
      Object.assign(tables.users[2], flags);
      await expect(caller(20, "admin").hosts()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  );
  it("does not accept session admin promotion or instructor-only grants", async () => {
    tables.staff_role_assignments[0].staffRole = "instructor";
    await expect(caller(7, "admin").agents({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(writes).toHaveLength(0);
  });
  it("engagement sees only own minimal host and cannot request team diary", async () => {
    expect(await caller().hosts()).toEqual([{ id: 7, name: "Person 7" }]);
    await expect(
      caller().diary({
        from: new Date("2020-01-01"),
        to: new Date("2020-01-03"),
        hostUserId: 20,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("agentHistory is admin-only; restricted grant does not confer CRM access", async () => {
    await expect(caller().agentHistory({ agentId: 12 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("rejects malformed dates, duplicate IDs, unexplained Other and overbroad windows before provider", async () => {
    await expect(
      caller().book({ ...bookingInput(), reasonKey: "other" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().book({ ...bookingInput(), agentIds: [12, 12] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().diary({
        from: new Date("2020-01-01"),
        to: new Date("2021-01-01"),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects instructor write and no-show successful-contact outcome", async () => {
    await expect(
      caller().saveNotes({
        callId: 31,
        participantId: 51,
        expectedVersion: 1,
        attendance: "no_show",
        outcome: "completed",
        privateNotes: "No contact",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(writes).toHaveLength(0);
  });
  it("returns no invented availability/booking when disconnected", async () => {
    mocks.slots.mockResolvedValue({
      ok: false,
      code: "UNCONNECTED",
      message: "Not connected",
      uncertain: false,
    });
    const available = await caller().availability({
      hostUserId: 7,
      format: "one_to_one",
      agentIds: [12],
      from: start,
      to: end,
    });
    expect(available.slots).toEqual([]);
    expect(available.connected).toBe(false);
    await expect(caller().book(bookingInput())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(tables.staff_call_operations).toHaveLength(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires exact current selectable identities, not broad email/name matching", async () => {
    tables.users[1].archiveId = 44;
    await expect(caller().book(bookingInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("commits pending ledger before provider, only accepted becomes booked, durable idempotent replay", async () => {
    const original = mocks.create.getMockImplementation()!;
    mocks.create.mockImplementation(async input => {
      expect(tables.staff_call_operations).toHaveLength(1);
      expect(tables.staff_call_operations[0].state).toBe("pending");
      expect(transactionDepth).toBe(0);
      return original(input);
    });
    const result = await caller().book(bookingInput());
    expect(result).toMatchObject({ state: "succeeded", status: "booked" });
    expect(tables.staff_calls[0].bookedAt).toBeInstanceOf(Date);
    expect(tables.staff_call_participants[0].bookedAt).toBeInstanceOf(Date);
    expect(await caller().book(bookingInput())).toMatchObject({
      state: "succeeded",
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(writes.every(w => w.tx)).toBe(true);
  });
  it("requestId cannot be reused for different payload or actor", async () => {
    await caller().book(bookingInput());
    await expect(
      caller().book({ ...bookingInput(), reasonKey: "onboarding" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller(20, "admin").book(bookingInput())
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("timeout is never falsely booked and never blindly retried, exact metadata scan retains unknown recovery", async () => {
    mocks.create.mockRejectedValue(new Error("write timeout"));
    const result = await caller().book(bookingInput());
    expect(result).toMatchObject({
      state: "needs_recovery",
      status: "needs_recovery",
    });
    expect(tables.staff_calls[0].bookedAt).toBeNull();
    expect(await caller().book(bookingInput())).toMatchObject({
      state: "needs_recovery",
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(await caller().reconcile({ requestId })).toMatchObject({
      state: "needs_recovery",
    });
    expect(mocks.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: requestId,
        participantId: 1,
        callId: 1,
      })
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("recovers unknown booking UID only from exact single operation metadata", async () => {
    mocks.create.mockRejectedValue(new Error("timeout"));
    await caller().book(bookingInput());
    mocks.scan.mockResolvedValue({
      ok: true,
      value: {
        complete: true,
        bookings: [
          {
            hostUserId: 7,
            kind: "oneToOne",
            callId: 1,
            participantId: 1,
            operationId: requestId,
            bookingUid: "recovered",
            providerBookingId: 99,
            eventTypeId: 42,
            provider: "cal.com",
            start: start.toISOString(),
            end: end.toISOString(),
            status: "accepted",
          },
        ],
      },
    });
    expect(await caller().reconcile({ requestId })).toMatchObject({
      state: "succeeded",
      status: "booked",
    });
    expect(tables.staff_calls[0].providerBookingUid).toBe("recovered");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("manual per-participant notes preserve exact immutable old/new revision and stay private", async () => {
    tables.staff_calls = [call()];
    tables.staff_call_participants = [participant()];
    expect(
      await caller().saveNotes({
        callId: 31,
        participantId: 51,
        expectedVersion: 1,
        attendance: "no_show",
        outcome: "no_contact",
        privateNotes: "No answer; try later",
      })
    ).toEqual({ participantId: 51, version: 2 });
    const p = tables.staff_call_participants[0];
    expect(p.sharedSummary).toBeNull();
    expect(p.sharedAt).toBeNull();
    expect(p.attendance).toBe("no_show");
    const h = tables.staff_call_history[0];
    expect(h.action).toBe("notes.saved");
    expect(h.beforeState.privateNotes).toBeNull();
    expect(h.afterState.privateNotes).toBe("No answer; try later");
    expect(writes.map(w => w.table)).toEqual([
      "staff_call_participants",
      "staff_call_history",
    ]);
    expect(writes.every(w => w.tx)).toBe(true);
    await expect(
      caller().saveNotes({
        callId: 31,
        participantId: 51,
        expectedVersion: 1,
        attendance: "attended",
        outcome: "completed",
        privateNotes: "stale",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tables.staff_call_history).toHaveLength(1);
  });
  it("pre-end notes forbidden, explicit share only, safe agent detail excludes everyone else's notes", async () => {
    tables.staff_calls = [call({ startAt: start, endAt: end })];
    tables.staff_call_participants = [participant()];
    await expect(
      caller().saveNotes({
        callId: 31,
        participantId: 51,
        expectedVersion: 1,
        attendance: "attended",
        outcome: "completed",
        privateNotes: "future",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    tables.staff_calls[0].endAt = ended;
    Object.assign(tables.staff_call_participants[0], {
      attendance: "attended",
      privateNotes: "internal sensitive",
    });
    await caller().shareRecap({
      callId: 31,
      participantId: 51,
      expectedVersion: 1,
      sharedSummary: "Your agreed next step",
    });
    const detail = await caller(12).get({ callId: 31 });
    expect(detail.participants).toHaveLength(1);
    expect(detail.participants[0].sharedSummary).toBe("Your agreed next step");
    expect(detail.participants[0]).not.toHaveProperty("privateNotes");
    expect(detail.participants[0]).not.toHaveProperty("outcome");
    expect(detail.history).toEqual([]);
    expect(detail.followUps).toEqual([]);
    expect(detail.call.reasonExplanation).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("draft follow-up creates selected-agent existing Academy plan/target/source atomically with rewards off, no publish/assignment", async () => {
    tables.staff_calls = [call()];
    tables.staff_call_participants = [
      participant({
        attendance: "attended",
        privateNotes: "Learning follow-up",
        outcome: "follow_up_required",
      }),
    ];
    const draft = await caller().draftFollowUp({
      callId: 31,
      participantId: 51,
      expectedVersion: 1,
      title: "Practice planning",
      instructions: "Prepare your learning plan",
    });
    expect(draft).toEqual({ planId: 1, status: "draft" });
    expect(tables.academy_action_plans[0]).toMatchObject({
      actionType: "ad_hoc",
      assignmentTrigger: "immediate",
      audience: "selected_agents",
      status: "draft",
      courseId: null,
      momentumAwardMode: "off",
      momentumPoints: 0,
    });
    expect(tables.academy_action_plan_targets[0]).toMatchObject({
      agentId: 12,
      planId: 1,
    });
    expect(tables.staff_call_action_sources[0]).toMatchObject({
      callId: 31,
      participantId: 51,
      planId: 1,
    });
    expect(writes.every(w => w.tx)).toBe(true);
    await expect(
      caller().draftFollowUp({
        callId: 31,
        participantId: 51,
        expectedVersion: 1,
        title: "Practice planning",
        instructions: "Prepare your learning plan",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("private group saga records each exact seat, never copies a seat ID to others", async () => {
    tables.users.push(eligible(13));
    const input = {
      ...bookingInput(),
      format: "group" as const,
      agentIds: [12, 13],
    };
    const result = await caller().book(input);
    expect(result).toMatchObject({ state: "succeeded", status: "booked" });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(tables.staff_call_participants.map(p => p.providerSeatUid)).toEqual([
      "seat-1",
      "seat-2",
    ]);
    expect(tables.staff_call_operations[0].result.seats).toHaveProperty("1");
    expect(tables.staff_call_operations[0].result.seats).toHaveProperty("2");
  });
  it("group partial acceptance stays recovery and cannot replay unconfirmed creation", async () => {
    tables.users.push(eligible(13));
    mocks.create
      .mockImplementationOnce(async i => ({
        ok: true,
        value: {
          ...i,
          bookingUid: "g1",
          seatUid: "s1",
          providerBookingId: 99,
          eventTypeId: 42,
          status: "accepted",
          start: start.toISOString(),
          end: end.toISOString(),
        },
      }))
      .mockRejectedValueOnce(new Error("seat timeout"));
    const input = {
      ...bookingInput(),
      format: "group" as const,
      agentIds: [12, 13],
    };
    expect(await caller().book(input)).toMatchObject({
      state: "needs_recovery",
      status: "needs_recovery",
    });
    expect(tables.staff_call_participants[0].providerSeatUid).toBe("s1");
    expect(tables.staff_call_participants[1].providerSeatUid).toBeNull();
    expect(tables.staff_calls[0].bookedAt).toBeNull();
    await caller().book(input);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("group private booking cannot join an already populated external session", async () => {
    tables.users.push(eligible(13));
    mocks.slots.mockResolvedValue({
      ok: true,
      value: [
        {
          start: start.toISOString(),
          end: end.toISOString(),
          remainingSeats: 4,
          bookingUid: "outside-session",
        },
      ],
    });
    await expect(
      caller().book({ ...bookingInput(), format: "group", agentIds: [12, 13] })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("sanitizes unknown errors, never exposes Drizzle SQL or private notes", async () => {
    mocks.db.mockRejectedValue(new Error("INSERT SQL privateNotes = SECRET"));
    await expect(caller().context()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The private diary operation could not be completed. Please reload or contact an administrator.",
    });
  });
  it("hashes exact canonical payload/date without object-key order dependence", () => {
    expect(staffCallPayloadHash({ b: 2, a: start })).toBe(
      staffCallPayloadHash({ a: start, b: 2 })
    );
    expect(staffCallPayloadHash({ a: start })).not.toBe(
      staffCallPayloadHash({ a: end })
    );
  });
  it("invalid raw webhook signatures never query storage", async () => {
    mocks.verify.mockReturnValue({ ok: false, code: "INVALID_SIGNATURE" });
    expect(
      await handleStaffCallsWebhook(Buffer.from("{}"), {
        "x-cal-signature-256": "bad",
      })
    ).toMatchObject({ status: 401, body: { accepted: false } });
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("empty finite sync checks no provider and adds no timers/actions", async () => {
    expect(
      await reconcileStaffCallsBatch({ limit: 2, deadlineMs: 1000 })
    ).toEqual({ checked: 0, recovered: 0, processed: 0, skipped: 0 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("whole one-to-one cancellation retains first bookedAt and exact audited old/new state", async () => {
    await caller().book(bookingInput());
    const bookedAt = tables.staff_calls[0].bookedAt;
    const before = clone(tables.staff_calls[0]);
    mocks.cancel.mockImplementation(async (link: any) => ({
      ok: true,
      value: {
        ...link,
        providerBookingId: 99,
        eventTypeId: 42,
        providerHostUserId: 70,
        meetingUrl: null,
        start: start.toISOString(),
        end: end.toISOString(),
        status: "cancelled",
      },
    }));
    const result = await caller().cancel({
      requestId: "22222222-2222-4222-8222-222222222222",
      callId: 1,
      expectedVersion: tables.staff_calls[0].version,
      reason: "Agent unavailable",
    });
    expect(result).toMatchObject({ state: "succeeded", status: "cancelled" });
    expect(tables.staff_calls[0].bookedAt).toEqual(bookedAt);
    expect(tables.staff_call_participants[0].status).toBe("cancelled");
    expect(mocks.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ bookingUid: "b-new", operationId: requestId }),
      "meeting",
      expect.any(Function)
    );
    const revision = tables.staff_call_history.find(
      h => h.action === "cancel.succeeded"
    );
    expect(revision.beforeState.startAt).toBe(before.startAt.toISOString());
    expect(revision.afterState.status).toBe("cancelled");
  });
  it("reschedule audits retained prior and confirmed replacement UID/times, preserves booking date", async () => {
    await caller().book(bookingInput());
    const bookedAt = tables.staff_calls[0].bookedAt;
    const newStart = new Date("2090-01-03T12:00:00Z"),
      newEnd = new Date("2090-01-03T12:30:00Z");
    mocks.slots.mockResolvedValue({
      ok: true,
      value: [{ start: newStart.toISOString(), end: newEnd.toISOString() }],
    });
    mocks.reschedule.mockImplementation(async (link: any) => ({
      ok: true,
      value: {
        ...link,
        bookingUid: "b-replacement",
        providerBookingId: 100,
        eventTypeId: 42,
        providerHostUserId: 70,
        meetingUrl: "https://meet.example.test/new",
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
        status: "accepted",
      },
    }));
    expect(
      await caller().reschedule({
        requestId: "22222222-2222-4222-8222-222222222222",
        callId: 1,
        expectedVersion: tables.staff_calls[0].version,
        startAt: newStart,
        endAt: newEnd,
      })
    ).toMatchObject({ state: "succeeded", status: "booked" });
    expect(tables.staff_calls[0]).toMatchObject({
      providerBookingUid: "b-replacement",
      providerHostId: "70",
      meetingUrl: "https://meet.example.test/new",
    });
    expect(tables.staff_calls[0].bookedAt).toEqual(bookedAt);
    const h = tables.staff_call_history.find(
      h => h.action === "reschedule.succeeded"
    );
    expect(h.beforeState.startAt).toBe(start.toISOString());
    expect(h.afterState.startAt).toBe(newStart.toISOString());
  });
  it("group participant cancellation only cancels its exact seat; whole group only retained seats", async () => {
    tables.users.push(eligible(13));
    await caller().book({
      ...bookingInput(),
      format: "group",
      agentIds: [12, 13],
    });
    mocks.cancel.mockImplementation(async (link: any) => ({
      ok: true,
      value: {
        ...link,
        providerBookingId: 99,
        eventTypeId: 42,
        providerHostUserId: 70,
        meetingUrl: null,
        start: start.toISOString(),
        end: end.toISOString(),
        status: "cancelled",
      },
    }));
    await caller().cancelParticipant({
      requestId: "22222222-2222-4222-8222-222222222222",
      callId: 1,
      participantId: 1,
      expectedVersion: tables.staff_calls[0].version,
      reason: "Unavailable",
    });
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ seatUid: "seat-1", participantId: 1 }),
      "seat",
      expect.any(Function)
    );
    expect(tables.staff_call_participants[1].status).toBe("active");
    expect(tables.staff_calls[0].status).toBe("booked");
    await caller().cancel({
      requestId: "33333333-3333-4333-8333-333333333333",
      callId: 1,
      expectedVersion: tables.staff_calls[0].version,
      reason: "Session cancelled",
    });
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.cancel).toHaveBeenLastCalledWith(
      expect.objectContaining({ seatUid: "seat-2", participantId: 2 }),
      "seat",
      expect.any(Function)
    );
    expect(tables.staff_calls[0].status).toBe("cancelled");
  });
  it("group UID divergence stops after mismatched seat, saves exact distinct linkage but never marks booked", async () => {
    tables.users.push(eligible(13), eligible(14));
    mocks.create.mockImplementation(async i => ({
      ok: true,
      value: {
        ...i,
        bookingUid: i.participantId === 1 ? "g1" : "g2",
        seatUid: `seat-${i.participantId}`,
        providerBookingId: 99,
        eventTypeId: 42,
        providerHostUserId: 70,
        meetingUrl: null,
        status: "accepted",
        start: start.toISOString(),
        end: end.toISOString(),
      },
    }));
    expect(
      await caller().book({
        ...bookingInput(),
        format: "group",
        agentIds: [12, 13, 14],
      })
    ).toMatchObject({ state: "needs_recovery", status: "needs_recovery" });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0]).toMatchObject({
      expectedBookingUid: "g1",
    });
    expect(tables.staff_call_participants[2].providerSeatUid).toBeNull();
    expect(tables.staff_calls[0].bookedAt).toBeNull();
  });
  it("unshared summary remains hidden and unrelated agent cannot enumerate participant details", async () => {
    tables.staff_calls = [call({ reasonExplanation: "private reason" })];
    tables.staff_call_participants = [
      participant({
        privateNotes: "secret",
        sharedSummary: "unpublished",
        sharedAt: null,
      }),
    ];
    const detail = await caller(12).get({ callId: 31 });
    expect(detail.participants[0].sharedSummary).toBeNull();
    expect(detail.participants[0]).not.toHaveProperty("privateNotes");
    expect(detail.call.reasonExplanation).toBeNull();
    tables.users.push(eligible(13));
    await expect(caller(13).get({ callId: 31 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("cancelled own group invitation retains history but loses booked status and meeting link", async () => {
    tables.staff_calls = [
      call({
        format: "group",
        meetingUrl: "https://meet.example.test/private-group",
      }),
    ];
    tables.staff_call_participants = [
      participant({
        status: "cancelled",
        privateNotes: "Never disclose",
        sharedSummary: "Earlier shared recap",
        sharedAt: ended,
      }),
      participant({ id: 52, agentId: 13 }),
    ];
    const detail = await caller(12).get({ callId: 31 });
    expect(detail.call.status).toBe("cancelled");
    expect(detail.call.meetingUrl).toBeNull();
    expect(detail.participants).toHaveLength(1);
    expect(detail.participants[0].sharedSummary).toBe("Earlier shared recap");
    const mine = await caller(12).mine({
      from: new Date("2020-01-01"),
      to: new Date("2020-01-03"),
    });
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({
      status: "cancelled",
      meetingUrl: null,
    });
    expect(tables.staff_calls[0].status).toBe("booked");
    expect(tables.staff_call_participants[1].status).toBe("active");
  });
  it("active own group invitation retains the safe link without exposing the other agent", async () => {
    tables.staff_calls = [
      call({
        format: "group",
        meetingUrl: "https://meet.example.test/private-group",
      }),
    ];
    tables.staff_call_participants = [
      participant(),
      participant({ id: 52, agentId: 13, status: "cancelled" }),
    ];
    const detail = await caller(12).get({ callId: 31 });
    expect(detail.call).toMatchObject({
      status: "booked",
      meetingUrl: "https://meet.example.test/private-group",
      participantCount: 1,
    });
    expect(detail.participants.map(p => p.agentId)).toEqual([12]);
  });
  it("admin CRM history includes exact participant outcomes and independently queried next appointment", async () => {
    tables.staff_calls = [call({ startAt: start, endAt: end })];
    tables.staff_call_participants = [
      participant({
        attendance: "no_show",
        outcome: "no_contact",
        privateNotes: "No answer",
      }),
    ];
    const history = await caller(20, "admin").agentHistory({ agentId: 12 });
    expect(history.items[0]).toMatchObject({
      participantId: 51,
      attendance: "no_show",
      outcome: "no_contact",
      privateNotes: "No answer",
    });
    expect(history.nextCall).toMatchObject({ id: 31, status: "booked" });
    expect(queries.some(q => q.includes("agentId"))).toBe(true);
  });
  it("webhook ignores unknown exact identities and never stores raw body/email/attendance", async () => {
    const event = {
      receiptHash: "x".repeat(64),
      event: "BOOKING_CREATED",
      createdAt: start.toISOString(),
      bookingUid: "unknown",
      eventTypeId: 42,
      start: start.toISOString(),
      end: end.toISOString(),
      identity: { callId: 99, participantId: 50, operationId: requestId },
      hostUserId: 7,
    };
    mocks.verify.mockReturnValue({ ok: true, ignored: false, value: event });
    expect(
      await handleStaffCallsWebhook(Buffer.from("{raw:private@email}"), {
        "x-cal-signature-256": "valid",
      })
    ).toMatchObject({ status: 202 });
    expect(tables.staff_call_webhook_inbox[0].state).toBe("ignored");
    expect(JSON.stringify(tables.staff_call_webhook_inbox)).not.toContain(
      "private@email"
    );
    expect(mocks.get).not.toHaveBeenCalled();
    expect(tables.staff_call_participants).toEqual([]);
  });
  it("exact known webhook rereads current provider rather than trusting stale cancellation payload, notes untouched", async () => {
    await caller().book(bookingInput());
    tables.staff_call_participants[0].privateNotes = "Keep internal";
    const event = {
      receiptHash: "x".repeat(64),
      event: "BOOKING_CANCELLED",
      createdAt: start.toISOString(),
      bookingUid: "b-new",
      eventTypeId: 42,
      start: start.toISOString(),
      end: end.toISOString(),
      identity: { callId: 1, participantId: 1, operationId: requestId },
      hostUserId: 7,
    };
    mocks.verify.mockReturnValue({ ok: true, ignored: false, value: event });
    mocks.get.mockResolvedValue({
      ok: true,
      value: {
        hostUserId: 7,
        kind: "oneToOne",
        callId: 1,
        participantId: 1,
        operationId: requestId,
        bookingUid: "b-new",
        providerBookingId: 99,
        eventTypeId: 42,
        providerHostUserId: 70,
        meetingUrl: null,
        start: start.toISOString(),
        end: end.toISOString(),
        status: "accepted",
      },
    });
    expect(
      await handleStaffCallsWebhook(Buffer.from("{}"), {
        "x-cal-signature-256": "valid",
      })
    ).toMatchObject({ status: 202 });
    expect(tables.staff_calls[0].status).toBe("booked");
    expect(tables.staff_call_participants[0].privateNotes).toBe(
      "Keep internal"
    );
    expect(tables.staff_call_participants[0].attendance).toBe("awaiting");
    expect(tables.staff_call_webhook_inbox[0].state).toBe("processed");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});

describe("lifecycle review regressions (offline)", () => {
  function seeded() {
    tables.staff_calls = [call()];
    tables.staff_call_participants = [participant()];
    tables.staff_call_operations = [
      {
        id: 1,
        requestId: "old-book",
        actorId: 7,
        payloadHash: "old",
        kind: "book",
        callId: 31,
        participantId: null,
        state: "succeeded",
        payload: {},
        result: null,
        lastError: null,
        createdAt: ended,
        updatedAt: ended,
      },
    ];
  }
  const mutationId = "22222222-2222-4222-8222-222222222222";
  it("reserves destination during dispatch and recovery without overwriting original call times", async () => {
    seeded();
    let release!: () => void, entered!: () => void;
    const reached = new Promise<void>(r => (entered = r));
    mocks.reschedule.mockImplementation(async () => {
      entered();
      return new Promise(
        r =>
          (release = () =>
            r({
              ok: false,
              code: "UNCERTAIN",
              message: "Timeout",
              uncertain: true,
            }))
      );
    });
    const moving = caller().reschedule({
      requestId: mutationId,
      callId: 31,
      expectedVersion: 1,
      startAt: start,
      endAt: end,
    });
    await reached;
    expect(tables.staff_calls[0].startAt.getTime()).not.toBe(start.getTime());
    expect(
      (
        await caller().availability({
          hostUserId: 7,
          format: "one_to_one",
          agentIds: [12],
          from: start,
          to: end,
        })
      ).slots
    ).toEqual([]);
    await expect(caller().book(bookingInput())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mocks.create).not.toHaveBeenCalled();
    release();
    expect(await moving).toMatchObject({ state: "needs_recovery" });
    expect(
      (
        await caller().availability({
          hostUserId: 7,
          format: "one_to_one",
          agentIds: [12],
          from: start,
          to: end,
        })
      ).slots
    ).toEqual([]);
    const pending = tables.staff_call_history.find(
      h => h.action === "reschedule.pending"
    );
    expect(pending.beforeState.startAt).toBe("2020-01-02T12:00:00.000Z");
    expect(pending.afterState.startAt).toBe(pending.beforeState.startAt);
  });
  it("rechecks destination reservations after serialized host lock under READ COMMITTED", async () => {
    afterHostLock = () => {
      tables.staff_calls.push(call({ id: 31, activeOperationId: 77 }));
      tables.staff_call_operations.push({
        id: 77,
        callId: 31,
        kind: "reschedule",
        state: "pending",
        payload: { startAt: start.toISOString(), endAt: end.toISOString() },
      });
    };
    await expect(caller().book(bookingInput())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(transactionOptions[0]).toEqual({ isolationLevel: "read committed" });
    expect(locks).toContain("staff_call_operations");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rechecks actor grant after acquiring the host lock, before creating ledger", async () => {
    afterHostLock = () => {
      tables.staff_role_assignments = [];
    };
    await expect(caller().book(bookingInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(tables.staff_call_operations).toEqual([]);
  });
  it.each(["book", "cancel", "reschedule"] as const)(
    "sends no %s provider write when authority is revoked after ledger commit",
    async kind => {
      if (kind !== "book") seeded();
      afterCommit = () => {
        tables.staff_role_assignments = [];
      };
      const operation =
        kind === "book"
          ? caller().book(bookingInput())
          : kind === "cancel"
            ? caller().cancel({
                requestId: mutationId,
                callId: 31,
                expectedVersion: 1,
                reason: "Unavailable",
              })
            : caller().reschedule({
                requestId: mutationId,
                callId: 31,
                expectedVersion: 1,
                startAt: start,
                endAt: end,
              });
      await expect(operation).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.cancel).not.toHaveBeenCalled();
      expect(mocks.reschedule).not.toHaveBeenCalled();
      expect(tables.staff_call_operations.at(-1).state).toBe("pending");
      expect(tables.staff_calls[0].activeOperationId).not.toBeNull();
    }
  );
  it.each(["actor", "host", "participant", "owner", "state", "link"])(
    "fresh cancellation dispatch denies changed %s after commit",
    async changed => {
      seeded();
      afterCommit = () => {
        if (changed === "actor") tables.users[0].isActive = false;
        else if (changed === "host") tables.staff_calls[0].hostUserId = 20;
        else if (changed === "participant") tables.users[1].archiveId = 77;
        else if (changed === "owner")
          tables.staff_calls[0].activeOperationId = 999;
        else if (changed === "state")
          tables.staff_call_operations.at(-1).state = "needs_recovery";
        else tables.staff_calls[0].providerBookingUid = "different";
      };
      await expect(
        caller().cancel({
          requestId: mutationId,
          callId: 31,
          expectedVersion: 1,
          reason: "Unavailable",
        })
      ).rejects.toBeDefined();
      expect(mocks.cancel).not.toHaveBeenCalled();
    }
  );
  it("group dispatch rechecks active operation between seats and retains immediate acceptance", async () => {
    tables.users.push(eligible(13));
    const original = mocks.create.getMockImplementation()!;
    mocks.create.mockImplementation(async input => {
      const result = await original(input);
      afterCommit = () => {
        tables.staff_calls[0].activeOperationId = 999;
      };
      return result;
    });
    await expect(
      caller().book({ ...bookingInput(), format: "group", agentIds: [12, 13] })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(tables.staff_call_participants[0].providerSeatUid).toBe("seat-1");
    expect(tables.staff_call_participants[1].providerSeatUid).toBeNull();
  });
  it("deferred signed C-before-B chain converges to authenticated accepted C even after cancelled B", async () => {
    await caller().book(bookingInput());
    Object.assign(tables.staff_call_participants[0], {
      attendance: "no_show",
      privateNotes: "Keep internal",
      sharedSummary: "Already shared",
      sharedAt: ended,
    });
    const base = {
      event: "BOOKING_RESCHEDULED",
      createdAt: start.toISOString(),
      eventTypeId: 42,
      start: start.toISOString(),
      end: end.toISOString(),
      identity: { callId: 1, participantId: 1, operationId: requestId },
      hostUserId: 7,
    };
    mocks.verify.mockReturnValue({
      ok: true,
      ignored: false,
      value: {
        ...base,
        receiptHash: "c".repeat(64),
        bookingUid: "uid-C",
        previousBookingUid: "uid-B",
      },
    });
    await handleStaffCallsWebhook(Buffer.from("C"), {});
    expect(tables.staff_call_webhook_inbox[0].state).toBe("received");
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.get.mockImplementation(async link => ({
      ok: true,
      value: {
        ...link,
        previousBookingUid: link.bookingUid === "uid-C" ? "uid-B" : "b-new",
        providerBookingId: 101,
        eventTypeId: 42,
        providerHostUserId: 70,
        meetingUrl: null,
        start: start.toISOString(),
        end: end.toISOString(),
        status: link.bookingUid === "uid-C" ? "accepted" : "cancelled",
      },
    }));
    mocks.verify.mockReturnValue({
      ok: true,
      ignored: false,
      value: {
        ...base,
        receiptHash: "b".repeat(64),
        bookingUid: "uid-B",
        previousBookingUid: "b-new",
      },
    });
    await handleStaffCallsWebhook(Buffer.from("B"), {});
    expect(tables.staff_calls[0]).toMatchObject({
      providerBookingUid: "uid-B",
      status: "cancelled",
    });
    await reconcileStaffCallsBatch({ limit: 2 });
    expect(tables.staff_calls[0]).toMatchObject({
      providerBookingUid: "uid-C",
      status: "booked",
    });
    expect(tables.staff_call_webhook_inbox.map(r => r.state)).toEqual([
      "processed",
      "processed",
    ]);
    expect(tables.staff_call_participants[0]).toMatchObject({
      status: "active",
      attendance: "no_show",
      privateNotes: "Keep internal",
      sharedSummary: "Already shared",
    });
  });
  it("signed metadata alone cannot jump to an unrelated authenticated provider UID", async () => {
    await caller().book(bookingInput());
    const event = {
      receiptHash: "c".repeat(64),
      event: "BOOKING_RESCHEDULED",
      createdAt: start.toISOString(),
      bookingUid: "unrelated",
      previousBookingUid: "b-new",
      eventTypeId: 42,
      start: start.toISOString(),
      end: end.toISOString(),
      identity: { callId: 1, participantId: 1, operationId: requestId },
      hostUserId: 7,
    };
    mocks.verify.mockReturnValue({ ok: true, ignored: false, value: event });
    mocks.get.mockResolvedValue({
      ok: true,
      value: {
        ...event.identity,
        hostUserId: 7,
        kind: "oneToOne",
        bookingUid: "unrelated",
        previousBookingUid: "not-current",
        eventTypeId: 42,
        start: start.toISOString(),
        end: end.toISOString(),
        status: "accepted",
      },
    });
    await handleStaffCallsWebhook(Buffer.from("{}"), {});
    expect(tables.staff_calls[0].providerBookingUid).toBe("b-new");
    expect(tables.staff_call_webhook_inbox[0].state).toBe("received");
  });
  it("pending local operation owns call even when a valid external reschedule receipt arrives", async () => {
    await caller().book(bookingInput());
    tables.staff_calls[0].activeOperationId = 99;
    const event = {
      receiptHash: "c".repeat(64),
      event: "BOOKING_RESCHEDULED",
      createdAt: start.toISOString(),
      bookingUid: "other",
      previousBookingUid: "b-new",
      eventTypeId: 42,
      start: start.toISOString(),
      end: end.toISOString(),
      identity: { callId: 1, participantId: 1, operationId: requestId },
      hostUserId: 7,
    };
    mocks.verify.mockReturnValue({ ok: true, ignored: false, value: event });
    await handleStaffCallsWebhook(Buffer.from("{}"), {});
    expect(mocks.get).not.toHaveBeenCalled();
    expect(tables.staff_calls[0].providerBookingUid).toBe("b-new");
    expect(tables.staff_call_webhook_inbox[0].state).toBe("received");
  });
  function workerSeed(n = 3, group = false) {
    const s = new Date(Date.now() + 3600000),
      e = new Date(Date.now() + 5400000);
    tables.staff_calls = group
      ? [
          call({
            id: 1,
            format: "group",
            startAt: s,
            endAt: e,
            providerBookingUid: "group-one",
          }),
        ]
      : Array.from({ length: n }, (_, i) =>
          call({
            id: i + 1,
            startAt: s,
            endAt: e,
            providerBookingUid: `booking-${i + 1}`,
          })
        );
    tables.staff_call_participants = Array.from({ length: n }, (_, i) =>
      participant({
        id: i + 1,
        callId: group ? 1 : i + 1,
        ...(group ? { providerSeatUid: `seat-${i + 1}` } : {}),
      })
    );
    tables.staff_call_operations = (
      group ? [1] : Array.from({ length: n }, (_, i) => i + 1)
    ).map(id => ({
      id,
      requestId: `original-${id}`,
      actorId: 7,
      kind: "book",
      callId: id,
      state: "succeeded",
      updatedAt: ended,
      result: null,
    }));
    mocks.get.mockImplementation(async link => ({
      ok: true,
      value: {
        ...link,
        status: "accepted",
        eventTypeId: 42,
        start: s.toISOString(),
        end: e.toISOString(),
        meetingUrl: null,
      },
    }));
  }
  it("unchanged known calls rotate beyond first bounded batch without business revisions", async () => {
    workerSeed();
    await reconcileStaffCallsBatch({ limit: 2 });
    await reconcileStaffCallsBatch({ limit: 2 });
    expect(mocks.get.mock.calls.map(c => c[0].callId)).toEqual([1, 2, 3, 1]);
    expect(tables.staff_calls.map(c => c.version)).toEqual([1, 1, 1]);
    expect(tables.staff_call_history).toEqual([]);
  });
  it("failed known reads rotate rather than starving later calls", async () => {
    workerSeed();
    mocks.get.mockResolvedValue({
      ok: false,
      code: "UNAVAILABLE",
      uncertain: false,
      message: "Unavailable",
    });
    await reconcileStaffCallsBatch({ limit: 2 });
    await reconcileStaffCallsBatch({ limit: 2 });
    expect(mocks.get.mock.calls.map(c => c[0].callId)).toEqual([1, 2, 3, 1]);
    expect(tables.staff_call_history).toEqual([]);
  });
  it("revoked original operations stay denied but attempts rotate past them", async () => {
    workerSeed(1);
    tables.users.push(eligible(8));
    tables.staff_call_operations.unshift({
      id: 10,
      callId: 10,
      requestId: "revoked",
      actorId: 8,
      kind: "book",
      state: "pending",
      updatedAt: new Date(0),
    });
    await reconcileStaffCallsBatch({ limit: 1 });
    expect(mocks.get).not.toHaveBeenCalled();
    await reconcileStaffCallsBatch({ limit: 1 });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(tables.staff_call_operations[0].state).toBe("pending");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("deferred inbox attempts rotate processedAt and do not permanently block a rooted later receipt", async () => {
    workerSeed(1);
    const base = {
      receiptHash: "x".repeat(64),
      event: "BOOKING_RESCHEDULED",
      createdAt: start.toISOString(),
      eventTypeId: 42,
      start: start.toISOString(),
      end: end.toISOString(),
      identity: { callId: 1, participantId: 1, operationId: "original-1" },
      hostUserId: 7,
    };
    tables.staff_call_webhook_inbox = [
      {
        id: 1,
        state: "received",
        processedAt: null,
        event: { ...base, bookingUid: "C", previousBookingUid: "B" },
      },
      {
        id: 2,
        state: "received",
        processedAt: null,
        event: { ...base, bookingUid: "B", previousBookingUid: "booking-1" },
      },
    ];
    mocks.get.mockImplementation(async link => ({
      ok: true,
      value: {
        ...link,
        previousBookingUid: "booking-1",
        eventTypeId: 42,
        status: "cancelled",
        start: start.toISOString(),
        end: end.toISOString(),
        meetingUrl: null,
      },
    }));
    await reconcileStaffCallsBatch({ limit: 1 });
    expect(tables.staff_call_webhook_inbox[0].processedAt).toBeInstanceOf(Date);
    expect(mocks.get).not.toHaveBeenCalled();
    await reconcileStaffCallsBatch({ limit: 1 });
    expect(mocks.get).toHaveBeenCalledWith(
      expect.objectContaining({ bookingUid: "B" })
    );
  });
  it("50-seat known group persists first 25 reads and completes remaining seats next batch", async () => {
    workerSeed(50, true);
    const first = await reconcileStaffCallsBatch({ limit: 25 });
    expect(first).toMatchObject({ checked: 25, recovered: 0, skipped: 1 });
    expect(
      Object.keys(tables.staff_call_operations[0].result.knownRefresh.seats)
    ).toHaveLength(25);
    expect(tables.staff_calls[0].version).toBe(1);
    const second = await reconcileStaffCallsBatch({ limit: 25 });
    expect(second).toMatchObject({ checked: 25, recovered: 1 });
    expect(mocks.get.mock.calls.map(c => c[0].participantId)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    );
    expect(tables.staff_call_operations[0].result.knownRefresh).toBeNull();
    expect(tables.staff_call_history).toEqual([]);
  });
  it("partial 50-seat refresh never promotes recovery to booked before all exact seats are read", async () => {
    workerSeed(50, true);
    tables.staff_calls[0].status = "needs_recovery";
    await reconcileStaffCallsBatch({ limit: 25 });
    expect(tables.staff_calls[0].status).toBe("needs_recovery");
    await reconcileStaffCallsBatch({ limit: 25 });
    expect(tables.staff_calls[0].status).toBe("booked");
  });
  it("group create and seat cancellation send full durable cohort and fresh known mappings including cancelled seats", async () => {
    tables.users.push(eligible(13));
    await caller().book({
      ...bookingInput(),
      format: "group",
      agentIds: [12, 13],
    });
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      invitedParticipantIds: [1, 2],
      knownSeats: [],
    });
    expect(mocks.create.mock.calls[1][0]).toMatchObject({
      invitedParticipantIds: [1, 2],
      knownSeats: [{ participantId: 1, seatUid: "seat-1" }],
      expectedBookingUid: "b-new",
    });
    mocks.cancel.mockImplementation(async link => ({
      ok: true,
      value: {
        ...link,
        eventTypeId: 42,
        status: "cancelled",
        start: start.toISOString(),
        end: end.toISOString(),
      },
    }));
    await caller().cancelParticipant({
      requestId: mutationId,
      callId: 1,
      participantId: 1,
      expectedVersion: tables.staff_calls[0].version,
      reason: "Unavailable",
    });
    await caller().cancel({
      requestId: "33333333-3333-4333-8333-333333333333",
      callId: 1,
      expectedVersion: tables.staff_calls[0].version,
      reason: "Cancelled",
    });
    expect(mocks.cancel.mock.calls[1][0]).toMatchObject({
      invitedParticipantIds: [1, 2],
      knownSeats: [
        { participantId: 1, seatUid: "seat-1" },
        { participantId: 2, seatUid: "seat-2" },
      ],
      operationId: requestId,
      participantId: 2,
    });
    expect(mocks.cancel.mock.calls.every(c => c[1] === "seat")).toBe(true);
  });
  it("group read-only recovery sends original metadata and durable full cohort/known seats", async () => {
    tables.users.push(eligible(13));
    mocks.create.mockRejectedValue(new Error("timeout"));
    await caller().book({
      ...bookingInput(),
      format: "group",
      agentIds: [12, 13],
    });
    await caller().reconcile({ requestId });
    expect(mocks.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: requestId,
        invitedParticipantIds: [1, 2],
        knownSeats: [],
      })
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("group dispatch has total deadline, retains accepted seat, and never continues blind writes", async () => {
    tables.users.push(eligible(13));
    const original = mocks.create.getMockImplementation()!;
    const base = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(base);
    mocks.create.mockImplementation(async input => {
      const result = await original(input);
      clock.mockReturnValue(base + 90_001);
      return result;
    });
    try {
      expect(
        await caller().book({
          ...bookingInput(),
          format: "group",
          agentIds: [12, 13],
        })
      ).toMatchObject({ state: "needs_recovery" });
      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(tables.staff_call_participants[0].providerSeatUid).toBe("seat-1");
    } finally {
      clock.mockRestore();
    }
  });
  it("mine includes fresh actor binding without exposing extra participant data", async () => {
    seeded();
    const own = await caller(12).mine({
      from: new Date("2020-01-01"),
      to: new Date("2020-01-03"),
    });
    expect(own.actorId).toBe(12);
    expect(own.items).toHaveLength(1);
    expect(own.items[0]).not.toHaveProperty("privateNotes");
  });
});

describe("bounded recovery edge regressions", () => {
  it("known group with pending seat remains recovery even with other accepted seats", async () => {
    const s = new Date(Date.now() + 3600000),
      e = new Date(Date.now() + 5400000);
    tables.staff_calls = [
      call({
        id: 1,
        format: "group",
        startAt: s,
        endAt: e,
        status: "needs_recovery",
        providerBookingUid: "g",
      }),
    ];
    tables.staff_call_participants = [
      participant({ id: 1, callId: 1, providerSeatUid: "s1" }),
      participant({ id: 2, callId: 1, providerSeatUid: "s2" }),
    ];
    tables.staff_call_operations = [
      {
        id: 1,
        callId: 1,
        actorId: 7,
        kind: "book",
        state: "succeeded",
        requestId: "original",
        result: null,
      },
    ];
    mocks.get.mockImplementation(async link => ({
      ok: true,
      value: {
        ...link,
        eventTypeId: 42,
        start: s.toISOString(),
        end: e.toISOString(),
        status: link.participantId === 1 ? "accepted" : "pending",
      },
    }));
    await reconcileStaffCallsBatch({ limit: 2 });
    expect(tables.staff_calls[0].status).toBe("needs_recovery");
  });
  it("50-seat pending recovery rotates cursor durably and confirms only after all original-operation scans", async () => {
    const s = new Date(Date.now() + 3600000),
      e = new Date(Date.now() + 5400000);
    tables.users.push(
      ...Array.from({ length: 49 }, (_, i) => eligible(i + 100))
    );
    tables.staff_calls = [
      call({
        id: 1,
        format: "group",
        startAt: s,
        endAt: e,
        status: "needs_recovery",
        activeOperationId: 1,
        providerBookingUid: null,
        providerEventTypeId: null,
        bookedAt: null,
      }),
    ];
    tables.staff_call_participants = Array.from({ length: 50 }, (_, i) =>
      participant({
        id: i + 1,
        callId: 1,
        agentId: i === 0 ? 12 : i + 99,
        providerSeatUid: null,
        bookedAt: null,
      })
    );
    tables.staff_call_operations = [
      {
        id: 1,
        callId: 1,
        actorId: 7,
        kind: "book",
        state: "needs_recovery",
        requestId,
        payload: { startAt: s.toISOString(), endAt: e.toISOString() },
        result: null,
        lastError: "Uncertain",
        updatedAt: ended,
      },
    ];
    mocks.scan.mockImplementation(async link => ({
      ok: true,
      value: {
        complete: true,
        bookings: [
          {
            ...link,
            bookingUid: "g",
            seatUid: `s${link.participantId}`,
            eventTypeId: 42,
            providerBookingId: 99,
            providerHostUserId: 70,
            status: "accepted",
            meetingUrl: null,
          },
        ],
      },
    }));
    expect(await reconcileStaffCallsBatch({ limit: 25 })).toMatchObject({
      checked: 25,
      recovered: 0,
    });
    expect(tables.staff_call_operations[0].result.reconcileCursor).toBe(25);
    expect(tables.staff_calls[0].status).toBe("needs_recovery");
    expect(await reconcileStaffCallsBatch({ limit: 25 })).toMatchObject({
      checked: 25,
      recovered: 1,
    });
    expect(mocks.scan.mock.calls.map(c => c[0].participantId)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    );
    expect(tables.staff_calls[0].status).toBe("booked");
  });
  it("known polling preserves revoked original actor denial and rotates attempt without writes", async () => {
    const s = new Date(Date.now() + 3600000),
      e = new Date(Date.now() + 5400000);
    tables.users.push(eligible(8));
    tables.staff_calls = [call({ startAt: s, endAt: e })];
    tables.staff_call_participants = [participant()];
    tables.staff_call_operations = [
      {
        id: 1,
        callId: 31,
        actorId: 8,
        kind: "book",
        state: "succeeded",
        requestId: "original",
      },
    ];
    await reconcileStaffCallsBatch({ limit: 1 });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(tables.staff_calls[0].updatedAt).not.toEqual(ended);
    expect(tables.staff_calls[0].version).toBe(1);
    expect(tables.staff_call_history).toEqual([]);
  });
});

// Permanent copies of the independent closure review's four safe-behavior assertions.
// The actual service and actual adapter use only the per-instance factory/fetch seam.
describe("final write and selection closure boundaries", () => {
  it("eligible known call is not starved behind active-operation call rows", async () => {
    const s = new Date(Date.now() + 3_600_000),
      e = new Date(Date.now() + 5_400_000);
    tables.staff_calls = [
      call({
        id: 1,
        startAt: s,
        endAt: e,
        status: "needs_recovery",
        activeOperationId: 11,
        updatedAt: new Date(0),
      }),
      call({
        id: 2,
        startAt: s,
        endAt: e,
        status: "needs_recovery",
        activeOperationId: 12,
        updatedAt: new Date(0),
      }),
      call({
        id: 3,
        startAt: s,
        endAt: e,
        updatedAt: new Date(1),
        providerBookingUid: "known-3",
      }),
    ];
    tables.staff_call_participants = [participant({ id: 3, callId: 3 })];
    tables.staff_call_operations = [
      {
        id: 11,
        callId: 1,
        requestId: "denied-1",
        actorId: 8,
        kind: "book",
        state: "pending",
        updatedAt: new Date(0),
      },
      {
        id: 12,
        callId: 2,
        requestId: "denied-2",
        actorId: 8,
        kind: "book",
        state: "pending",
        updatedAt: new Date(0),
      },
      {
        id: 13,
        callId: 3,
        requestId: "original-3",
        actorId: 7,
        kind: "book",
        state: "succeeded",
        updatedAt: new Date(1),
      },
    ];
    mocks.get.mockImplementation(async (link: any) => ({
      ok: true,
      value: {
        ...link,
        eventTypeId: 42,
        status: "accepted",
        start: s.toISOString(),
        end: e.toISOString(),
      },
    }));
    for (let i = 0; i < 4; i++) await reconcileStaffCallsBatch({ limit: 2 });
    expect(
      mocks.get.mock.calls.map(c => c[0].callId),
      "known call 3 must make progress despite revoked pending operations"
    ).toContain(3);
    expect(
      tables.staff_call_operations.slice(0, 2).every(o => o.state === "pending")
    ).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("eligible known calls progress past older unlinked rows before the bounded SQL selection", async () => {
    const s = new Date(Date.now() + 3_600_000),
      e = new Date(Date.now() + 5_400_000);
    tables.staff_calls = [
      call({
        id: 1,
        startAt: s,
        endAt: e,
        status: "needs_recovery",
        providerBookingUid: null,
        updatedAt: new Date(0),
      }),
      call({
        id: 2,
        startAt: s,
        endAt: e,
        providerBookingUid: null,
        updatedAt: new Date(0),
      }),
      call({
        id: 3,
        startAt: s,
        endAt: e,
        providerBookingUid: "known-3",
        updatedAt: new Date(1),
      }),
      call({
        id: 4,
        startAt: s,
        endAt: e,
        providerBookingUid: "known-4",
        updatedAt: new Date(2),
      }),
    ];
    tables.staff_call_participants = [
      participant({ id: 3, callId: 3 }),
      participant({ id: 4, callId: 4 }),
    ];
    tables.staff_call_operations = [3, 4].map(id => ({
      id,
      callId: id,
      requestId: `original-${id}`,
      actorId: 7,
      kind: "book",
      state: "succeeded",
    }));
    mocks.get.mockImplementation(async (link: any) => ({
      ok: true,
      value: {
        ...link,
        eventTypeId: 42,
        status: "accepted",
        start: s.toISOString(),
        end: e.toISOString(),
      },
    }));
    expect(await reconcileStaffCallsBatch({ limit: 2 })).toMatchObject({
      checked: 2,
      recovered: 2,
    });
    expect(mocks.get.mock.calls.map(c => c[0].callId)).toEqual([3, 4]);
    expect(
      queries.some(
        q =>
          q.includes("`staff_calls`.`activeOperationId` is null") &&
          q.includes("`staff_calls`.`providerBookingUid` is not null")
      )
    ).toBe(true);
    expect(tables.staff_calls.slice(0, 2).map(c => c.updatedAt)).toEqual([
      new Date(0),
      new Date(0),
    ]);
    expect(tables.staff_calls.map(c => c.version)).toEqual([1, 1, 1, 1]);
    expect(tables.staff_call_history).toEqual([]);
  });
  it.each(["book", "cancel", "reschedule"] as const)(
    "fresh grant must still be valid immediately before actual %s POST after adapter preflight",
    async kind => {
      const actual = await vi.importActual<
        typeof import("./staff-calls-provider")
      >("./staff-calls-provider");
      vi.stubEnv(
        "JLT_STAFF_CAL_HOSTS_JSON",
        JSON.stringify({
          "7": {
            apiKey: "cal_mock_CLOSURE_KEY_1234",
            expectedCalUserId: 123,
            oneToOne: { eventTypeId: 11, durationMinutes: 30 },
          },
        })
      );
      if (kind !== "book") {
        tables.staff_calls = [
          call({ providerEventTypeId: "11", providerHostId: "123" }),
        ];
        tables.staff_call_participants = [participant()];
        tables.staff_call_operations = [
          {
            id: 1,
            requestId: "old-book",
            actorId: 7,
            kind: "book",
            callId: 31,
            state: "succeeded",
            payload: {},
            result: null,
            createdAt: ended,
            updatedAt: ended,
          },
        ];
      }
      const posts: string[] = [];
      let revoked = false;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = new URL(String(input));
        const json = (data: any) =>
          new Response(JSON.stringify({ status: "success", data }), {
            headers: { "content-type": "application/json" },
          });
        const metadata = {
          jltNamespace: "jlt-staff-calls",
          jltHostUserId: "7",
          jltCallId: kind === "book" ? "1" : "31",
          jltParticipantId: kind === "book" ? "1" : "51",
          jltOperationId: kind === "book" ? requestId : "old-book",
        };
        const b = (
          status: string,
          uid = "booking31",
          st = tables.staff_calls[0]?.startAt.toISOString(),
          en = tables.staff_calls[0]?.endAt.toISOString()
        ) => ({
          id: 99,
          uid,
          eventType: { id: 11 },
          hosts: [{ id: 123 }],
          status,
          start: st,
          end: en,
          duration: 30,
          metadata,
          attendees: [{ name: "Person 12", email: "p12@example.test" }],
        });
        if (init?.method === "POST") {
          posts.push(url.pathname);
          return json(
            kind === "cancel"
              ? b("cancelled")
              : kind === "reschedule"
                ? {
                    ...b(
                      "accepted",
                      "moved",
                      start.toISOString(),
                      end.toISOString()
                    ),
                    rescheduledFromUid: "booking31",
                  }
                : b(
                    "accepted",
                    "created",
                    start.toISOString(),
                    end.toISOString()
                  )
          );
        }
        if (url.pathname === "/v2/me") return json({ id: 123 });
        if (url.pathname === "/v2/event-types/11") {
          if (
            kind === "book" &&
            tables.staff_call_operations.some(o => o.state === "pending")
          ) {
            tables.staff_role_assignments = [];
            revoked = true;
          }
          return json({
            id: 11,
            ownerId: 123,
            users: [{ id: 123 }],
            lengthInMinutes: 30,
            isInstantEvent: false,
            recurrence: null,
            seatsPerTimeSlot: null,
            seats: null,
          });
        }
        if (url.pathname === "/v2/slots")
          return json({
            "2090-01-02": [
              { start: start.toISOString(), end: end.toISOString() },
            ],
          });
        if (url.pathname === "/v2/bookings/booking31") {
          tables.staff_role_assignments = [];
          revoked = true;
          return json(b("accepted"));
        }
        throw new Error("Unexpected mocked route " + url.pathname);
      });
      const service = createStaffCallsService({
        providerFactory: resolveParticipant =>
          new actual.StaffCallsProvider({ resolveParticipant, fetch }),
      });
      try {
        const pending =
          kind === "book"
            ? service.book(7, bookingInput())
            : kind === "cancel"
              ? service.cancel(7, {
                  requestId: "22222222-2222-4222-8222-222222222222",
                  callId: 31,
                  expectedVersion: 1,
                  reason: "Unavailable",
                })
              : service.reschedule(7, {
                  requestId: "22222222-2222-4222-8222-222222222222",
                  callId: 31,
                  expectedVersion: 1,
                  startAt: start,
                  endAt: end,
                });
        await expect(pending).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(revoked).toBe(true);
        expect(
          posts,
          "no provider write after revocation during authenticated preflight"
        ).toEqual([]);
        expect(tables.staff_call_operations.at(-1).state).toBe("pending");
        expect(tables.staff_calls[0].activeOperationId).toBe(
          tables.staff_call_operations.at(-1).id
        );
        expect(
          tables.staff_call_history.some(h =>
            /\.(succeeded|failed|needs_recovery)$/.test(h.action)
          )
        ).toBe(false);
      } finally {
        vi.unstubAllEnvs();
      }
    }
  );
});

describe("per-write core authorization capability", () => {
  it.each([
    "actor",
    "grant",
    "host",
    "participant",
    "participant_status",
    "op_actor",
    "active_operation",
    "operation_state",
    "link",
  ] as const)(
    "final cancellation guard rejects changed %s inside provider preflight without recording uncertainty",
    async changed => {
      await caller().book(bookingInput());
      const posts: number[] = [];
      mocks.cancel.mockImplementation(async (_link, _scope, guard) => {
        expect(guard).toBeTypeOf("function");
        if (changed === "actor") tables.users[0].isActive = false;
        else if (changed === "grant") tables.staff_role_assignments = [];
        else if (changed === "host") tables.staff_calls[0].hostUserId = 20;
        else if (changed === "participant") tables.users[1].archiveId = 99;
        else if (changed === "participant_status")
          tables.staff_call_participants[0].status = "cancelled";
        else if (changed === "op_actor")
          tables.staff_call_operations.at(-1).actorId = 20;
        else if (changed === "active_operation")
          tables.staff_calls[0].activeOperationId = 999;
        else if (changed === "operation_state")
          tables.staff_call_operations.at(-1).state = "needs_recovery";
        else tables.staff_calls[0].providerBookingUid = "changed-link";
        await guard();
        posts.push(1);
        throw new Error("Guard incorrectly allowed a write");
      });
      const beforeHistory = tables.staff_call_history.length;
      await expect(
        caller().cancel({
          requestId: "22222222-2222-4222-8222-222222222222",
          callId: 1,
          expectedVersion: tables.staff_calls[0].version,
          reason: "Unavailable",
        })
      ).rejects.toMatchObject({
        code: ["actor", "grant", "host", "participant"].includes(changed)
          ? "FORBIDDEN"
          : changed === "participant_status"
            ? "BAD_REQUEST"
            : "CONFLICT",
      });
      expect(posts).toEqual([]);
      expect(tables.staff_call_operations.at(-1).state).toBe(
        changed === "operation_state" ? "needs_recovery" : "pending"
      );
      expect(
        tables.staff_call_history.slice(beforeHistory).map(h => h.action)
      ).toEqual(["cancel.pending"]);
    }
  );
  it.each(["book", "cancel", "reschedule"] as const)(
    "every group %s seat receives its own final guard; a denial retains accepted first-seat progress and stops later writes",
    async kind => {
      tables.users.push(eligible(13), eligible(14));
      const input = {
        ...bookingInput(),
        format: "group" as const,
        agentIds: [12, 13, 14],
      };
      if (kind !== "book") await caller().book(input);
      const posts: number[] = [];
      const guards: unknown[] = [];
      const method = async (link: any, guard: () => Promise<void>) => {
        expect(guard).toBeTypeOf("function");
        guards.push(guard);
        if (guards.length === 2) tables.staff_role_assignments = [];
        await guard();
        posts.push(link.participantId);
        return {
          ok: true,
          value: {
            ...link,
            bookingUid: "b-new",
            seatUid: `seat-${link.participantId}`,
            providerBookingId: 99,
            eventTypeId: 42,
            start: start.toISOString(),
            end: end.toISOString(),
            status: kind === "cancel" ? "cancelled" : "accepted",
          },
        };
      };
      mocks.create.mockImplementation(async (input, guard) =>
        method(input, guard)
      );
      mocks.cancel.mockImplementation(async (link, _scope, guard) =>
        method(link, guard)
      );
      mocks.reschedule.mockImplementation(async (link, _start, guard) =>
        method(link, guard)
      );
      const pending =
        kind === "book"
          ? caller().book(input)
          : kind === "cancel"
            ? caller().cancel({
                requestId: "22222222-2222-4222-8222-222222222222",
                callId: 1,
                expectedVersion: tables.staff_calls[0].version,
                reason: "Unavailable",
              })
            : caller().reschedule({
                requestId: "22222222-2222-4222-8222-222222222222",
                callId: 1,
                expectedVersion: tables.staff_calls[0].version,
                startAt: start,
                endAt: end,
              });
      await expect(pending).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(posts).toEqual([1]);
      expect(guards).toHaveLength(2);
      expect(guards[0]).not.toBe(guards[1]);
      const op = tables.staff_call_operations.at(-1);
      expect(op.state).toBe("pending");
      expect(Object.keys(op.result.seats)).toEqual(["1"]);
      expect(tables.staff_calls[0].activeOperationId).toBe(op.id);
      expect(tables.staff_call_participants[0].providerSeatUid).toBe("seat-1");
      expect(op.result.seats["1"].operationId).toBe(requestId);
      if (kind === "book")
        expect(tables.staff_call_participants[1].providerSeatUid).toBeNull();
      if (kind === "cancel") {
        expect(tables.staff_call_participants[0].status).toBe("cancelled");
        expect(tables.staff_call_participants[1].status).toBe("active");
      }
    }
  );
  it("group participant cancellation receives the final exact original-link guard", async () => {
    tables.users.push(eligible(13));
    await caller().book({
      ...bookingInput(),
      format: "group",
      agentIds: [12, 13],
    });
    const posts: number[] = [];
    mocks.cancel.mockImplementation(async (link, scope, guard) => {
      expect(link).toMatchObject({
        participantId: 2,
        seatUid: "seat-2",
        operationId: requestId,
      });
      expect(scope).toBe("seat");
      tables.staff_call_participants[1].providerSeatUid = "changed-seat";
      await guard();
      posts.push(link.participantId);
      throw new Error("Guard incorrectly allowed a write");
    });
    await expect(
      caller().cancelParticipant({
        requestId: "22222222-2222-4222-8222-222222222222",
        callId: 1,
        participantId: 2,
        expectedVersion: tables.staff_calls[0].version,
        reason: "Unavailable",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(posts).toEqual([]);
    expect(tables.staff_call_operations.at(-1).state).toBe("pending");
    expect(tables.staff_call_participants.map(p => p.status)).toEqual([
      "active",
      "active",
    ]);
  });
});
