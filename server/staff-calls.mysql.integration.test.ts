import { readFile, writeFile } from "node:fs/promises";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { and, eq, getTableName, is, SQL } from "drizzle-orm";
import { getTableConfig, MySqlDialect } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";
import {
  staffCallBookInput,
  staffCallFollowUpInput,
} from "../shared/staff-calls";
import type {
  StaffCallBooking,
  StaffCallIdentity,
  StaffCallsProvider,
} from "./staff-calls-provider";

const fixture = vi.hoisted(() => ({ db: null as any, dbReads: 0 }));
vi.mock("./db", () => ({
  getDb: async () => {
    fixture.dbReads++;
    if (!fixture.db)
      throw new Error(
        "No root fixture transaction; global DB escape forbidden"
      );
    return fixture.db;
  },
}));
// No real provider constructor/config/secret lookup/network implementation is loaded.
vi.mock("./staff-calls-provider", () => ({
  StaffCallsProvider: class {
    constructor() {}
    getConnectionStatus() {
      throw new Error("Uninjected provider forbidden");
    }
    getBookableSlots() {
      throw new Error("Uninjected provider forbidden");
    }
    createBooking() {
      throw new Error("Uninjected provider forbidden");
    }
    getBooking() {
      throw new Error("Uninjected provider forbidden");
    }
    cancelBooking() {
      throw new Error("Uninjected provider forbidden");
    }
    rescheduleBooking() {
      throw new Error("Uninjected provider forbidden");
    }
    reconcileOperation() {
      throw new Error("Uninjected provider forbidden");
    }
  },
  verifyStaffCallWebhook: () => {
    throw new Error("Webhooks forbidden in this probe");
  },
}));
import { createStaffCallsService } from "./staff-calls-service";
import { getStaffCallReport } from "./staff-calls-reporting";

const enabled = process.env.JLT_STAFF_CALLS_LOCAL_MYSQL_TEST === "1";
const SOCKET = "/home/ubuntu/staff-calls-mysql-probe/mysql.sock";
const DATABASE = "jlt_staff_calls_probe";
const NOW = new Date("2026-11-21T12:00:00.123Z");
const PAST = new Date("2026-11-20T10:00:00.456Z");
const END = new Date("2026-11-20T10:30:00.456Z");
const FUTURE = new Date("2026-11-22T10:00:00.789Z");
const FUTURE_END = new Date("2026-11-22T10:30:00.789Z");
const {
  users,
  staffRoleAssignments,
  staffCalls,
  staffCallParticipants,
  staffCallHistory,
  staffCallOperations,
  staffCallWebhookInbox,
  staffCallActionSources,
  academyActionPlans,
  academyActionPlanTargets,
} = schema;
const ancillary = [
  users,
  schema.agentCrmProfiles,
  schema.agentRecordMerges,
  staffRoleAssignments,
  schema.businessStaffMemberships,
  academyActionPlans,
  academyActionPlanTargets,
];
const feature = [
  staffCalls,
  staffCallParticipants,
  staffCallHistory,
  staffCallOperations,
  staffCallWebhookInbox,
  staffCallActionSources,
];
const allTables = [...ancillary, ...feature];
const dialect = new MySqlDialect();
const quote = (s: string) => `\`${s.replace(/`/g, "``")}\``;

/** Column types, defaults, generated IDs, uniques/indexes and declared foreign keys
 * come from Drizzle only for the seven ancillary tables. The six feature CREATEs
 * are the reviewed single-statement SQL artifacts, not an existing migrator. */
function ancillaryCreate(table: any): string {
  const c = getTableConfig(table);
  const cols = c.columns.map(column => {
    const value = column.default;
    const defaultSql =
      value === undefined
        ? ""
        : is(value, SQL)
          ? dialect.sqlToQuery(value).sql
          : typeof value === "boolean"
            ? String(Number(value))
            : typeof value === "number"
              ? String(value)
              : `'${String(value).replace(/'/g, "''")}'`;
    return (
      `${quote(column.name)} ${column.getSQLType()} ${column.notNull ? "NOT NULL" : "NULL"}` +
      ((column as any).autoIncrement ? " AUTO_INCREMENT" : "") +
      (column.primary ? " PRIMARY KEY" : "") +
      (column.isUnique ? " UNIQUE" : "") +
      (defaultSql ? ` DEFAULT ${defaultSql}` : "")
    );
  });
  for (const index of c.indexes) {
    const i = index.config;
    cols.push(
      `${i.unique ? "UNIQUE " : ""}KEY ${quote(i.name)} (${i.columns.map((x: any) => quote(x.name)).join(", ")})`
    );
  }
  for (const fk of c.foreignKeys) {
    const ref = fk.reference();
    cols.push(
      `CONSTRAINT ${quote(fk.getName())} FOREIGN KEY (${ref.columns.map(x => quote(x.name)).join(", ")}) REFERENCES ${quote(getTableName(ref.foreignTable))} (${ref.foreignColumns.map(x => quote(x.name)).join(", ")})`
    );
  }
  return `CREATE TABLE ${quote(c.name)} (${cols.join(", ")}) ENGINE=InnoDB`;
}

/** A rollback-only transaction on ONE fixed-socket connection. Injecting the
 * actual root tx means nested service transactions really issue SAVEPOINTs.
 * No pool exists. No synthetic seed is ever committed. */
describe.skipIf(!enabled)(
  "local-only real mysql2/Drizzle staff calls (MySQL 8.0.46)",
  () => {
    let connection: Connection;
    let db: ReturnType<typeof drizzle>;
    let ready = false;
    const statements: string[] = [];
    const fetchForbidden = vi.fn(async () => {
      throw new Error("External fetch forbidden in local MySQL probe");
    });
    const count = async (table: any) => {
      const [rows] = await connection.query(
        `SELECT COUNT(*) AS n FROM ${quote(getTableName(table))}`
      );
      return Number((rows as any)[0].n);
    };
    const assertEmpty = async () => {
      for (const table of allTables)
        expect(await count(table), getTableName(table)).toBe(0);
    };
    beforeAll(async () => {
      // This probe never reads or accepts a URL-based DB connection.
      if (process.env.DATABASE_URL !== undefined)
        throw new Error(
          "Run with DATABASE_URL absent; use the isolated env -i harness"
        );
      vi.stubGlobal("fetch", fetchForbidden);
      connection = await createConnection({
        socketPath: SOCKET,
        user: "root",
        database: DATABASE,
        timezone: "+00:00",
        multipleStatements: false,
        connectTimeout: 3000,
      });
      const [rows] = await connection.query(
        "SELECT VERSION() AS version, DATABASE() AS db, @@socket AS socket, @@skip_networking AS offline"
      );
      expect((rows as any)[0]).toMatchObject({
        version: expect.stringMatching(/^8\.0\.46(?:-|$)/),
        db: DATABASE,
        socket: SOCKET,
        offline: 1,
      });
      await connection.query("SET time_zone = '+00:00'");
      db = drizzle(connection, {
        schema,
        mode: "default",
        logger: {
          logQuery(query) {
            statements.push(query);
          },
        },
      });
      for (const table of ancillary)
        await connection.query(ancillaryCreate(table));
      for (let n = 1; n <= 6; n++) {
        const ddl = await readFile(
          `/home/ubuntu/Railway-Staff-Calls-${n}.sql`,
          "utf8"
        );
        expect(
          ddl
            .trim()
            .startsWith(
              "CREATE TABLE " + quote(getTableName(feature[n - 1])) + " ("
            )
        ).toBe(true);
        expect(ddl.match(/;/g)).toHaveLength(1);
        await connection.query(ddl);
      }
      await assertEmpty();
      ready = true;
      console.log(
        "Safety: MySQL 8.0.46; fixed Unix socket; skip_networking=1; disposable localDB; six reviewed CREATEs; no real provider."
      );
    }, 15000);
    afterAll(async () => {
      fixture.db = null;
      try {
        if (connection && ready) await assertEmpty();
      } finally {
        if (connection) await connection.end();
        vi.unstubAllGlobals();
        await writeFile(
          "/home/ubuntu/staff-calls-mysql-probe/synthetic-sql.log",
          statements.join(";\n") + ";\n"
        );
      }
      expect(fetchForbidden).not.toHaveBeenCalled();
    });

    async function isolated(body: (tx: any) => Promise<void>) {
      const marker = new Error("SYNTHETIC_STAFF_CALLS_ROOT_ROLLBACK");
      const start = statements.length;
      let failure: unknown;
      try {
        await db.transaction(
          async tx => {
            fixture.db = tx;
            await tx.insert(users).values([
              {
                id: 701,
                openId: "synthetic-staff-host",
                name: "Synthetic Host",
                email: "h@example.test",
                portalStatus: "active",
              },
              {
                id: 712,
                openId: "synthetic-agent-p",
                name: "Synthetic Agent P",
                email: "p@example.test",
                portalStatus: "active",
              },
              {
                id: 713,
                openId: "synthetic-agent-q",
                name: "Synthetic Agent Q",
                email: "q@example.test",
                portalStatus: "active",
              },
              {
                id: 720,
                openId: "synthetic-admin",
                name: "Synthetic Admin",
                email: "a@example.test",
                role: "admin",
                portalStatus: "active",
              },
            ]);
            await tx.insert(staffRoleAssignments).values({
              userId: 701,
              staffRole: "agent_engagement",
              grantedById: 720,
            });
            await body(tx);
            throw marker;
          },
          { isolationLevel: "repeatable read" }
        );
      } catch (error) {
        if (error !== marker) failure = error;
      } finally {
        fixture.db = null;
      }
      await assertEmpty();
      const own = statements.slice(start);
      expect(own.filter(s => /^begin$/i.test(s))).toHaveLength(1);
      expect(own.filter(s => /^rollback$/i.test(s))).toHaveLength(1);
      expect(own.some(s => /^commit$/i.test(s))).toBe(false);
      console.log(
        `Root rollback verified absent: all ${allTables.length} fixture tables; ${own.length} real SQL statements.`
      );
      if (failure) throw failure;
    }

    async function seedEnded(tx: any, agents = [712, 713]) {
      const [call] = await tx
        .insert(staffCalls)
        .values({
          hostUserId: 701,
          reasonKey: "other",
          reasonExplanation: "Synthetic private reason",
          format: agents.length > 1 ? "group" : "one_to_one",
          startAt: PAST,
          endAt: END,
          status: "booked",
          createdById: 701,
          bookedAt: PAST,
        })
        .$returningId();
      const ids: number[] = [];
      for (const agentId of agents) {
        const [p] = await tx
          .insert(staffCallParticipants)
          .values({ callId: call.id, agentId, bookedAt: PAST })
          .$returningId();
        ids.push(p.id);
      }
      return { callId: call.id as number, participantIds: ids };
    }

    function service(
      providerFactory?: NonNullable<
        Parameters<typeof createStaffCallsService>[0]
      >["providerFactory"]
    ) {
      return createStaffCallsService({
        getDb: async () => {
          if (!fixture.db)
            throw new Error("Injected DB called outside root transaction");
          return fixture.db;
        },
        now: () => NOW,
        ...(providerFactory ? { providerFactory } : {}),
      });
    }

    function offlineProvider(
      resolve: (
        identity: StaffCallIdentity,
        host: number
      ) => Promise<{ name: string; email: string } | null>
    ) {
      const forbidden = vi.fn(async () => {
        throw new Error("Unexpected offline provider method");
      });
      const reply = (input: any): StaffCallBooking => ({
        ...input,
        provider: "cal.com",
        bookingUid: `synthetic-${input.operationId}`,
        providerBookingId: 9901,
        eventTypeId: 4201,
        providerHostUserId: 7001,
        meetingUrl: "https://meet.example.test/synthetic",
        start: input.start,
        end: new Date(
          new Date(input.start).getTime() + 30 * 60 * 1000
        ).toISOString(),
        status: "accepted",
        ...(input.kind === "group"
          ? { seatUid: `synthetic-seat-${input.participantId}` }
          : {}),
      });
      const create = vi.fn(async (input: any) => {
        expect(await resolve(input, input.hostUserId)).toMatchObject({
          email: expect.stringMatching(/@example\.test$/),
        });
        const [op] = await fixture.db
          .select()
          .from(staffCallOperations)
          .where(eq(staffCallOperations.requestId, input.operationId));
        expect(op.state).toBe("pending");
        return { ok: true as const, value: reply(input) };
      });
      const scan = vi.fn(async (input: any) => ({
        ok: true as const,
        value: { complete: true, bookings: [reply(input)] },
      }));
      const provider = {
        getConnectionStatus: vi.fn(async (hostUserId: number) => ({
          state: "READY",
          hostUserId,
          oneToOne: { ready: true },
          group: { ready: true, capacity: 10 },
          busyTimes: "UNAVAILABLE",
        })),
        getBookableSlots: vi.fn(async (input: any) => ({
          ok: true as const,
          value: [{ start: input.start, end: input.end, remainingSeats: 10 }],
        })),
        createBooking: create,
        reconcileOperation: scan,
        getBooking: forbidden,
        cancelBooking: forbidden,
        rescheduleBooking: forbidden,
      };
      return {
        provider: provider as unknown as StaffCallsProvider,
        create,
        scan,
        forbidden,
      };
    }

    it(
      "uses reviewed tables, generated autoincrement IDs, defaults, timestamp(3), JSON and actual FK restrictions",
      async () =>
        isolated(async tx => {
          const seed = await seedEnded(tx, [712]);
          expect(seed.callId).toBeGreaterThan(0);
          expect(seed.participantIds[0]).toBeGreaterThan(0);
          const [call] = await tx
            .select()
            .from(staffCalls)
            .where(eq(staffCalls.id, seed.callId));
          expect(call.version).toBe(1);
          expect(call.startAt.toISOString()).toBe(PAST.toISOString());
          expect(call.createdAt).toBeInstanceOf(Date);
          const [p] = await tx
            .select()
            .from(staffCallParticipants)
            .where(eq(staffCallParticipants.id, seed.participantIds[0]));
          expect(p).toMatchObject({
            attendance: "awaiting",
            version: 1,
            status: "active",
            sharedAt: null,
            privateNotes: null,
          });
          await tx.insert(staffCallWebhookInbox).values({
            eventKey: "synthetic-local-event",
            payloadHash: "a".repeat(64),
            event: {
              synthetic: true,
              callId: seed.callId,
              nested: { values: [1, 2] },
            },
          });
          const [inbox] = await tx.select().from(staffCallWebhookInbox);
          expect(inbox).toMatchObject({
            state: "received",
            event: { synthetic: true, nested: { values: [1, 2] } },
          });
          await expect(
            tx.delete(staffCalls).where(eq(staffCalls.id, seed.callId))
          ).rejects.toMatchObject({
            cause: { code: "ER_ROW_IS_REFERENCED_2" },
          });
          await expect(
            tx
              .insert(staffCallParticipants)
              .values({ callId: seed.callId, agentId: 712 })
          ).rejects.toMatchObject({ cause: { code: "ER_DUP_ENTRY" } });
        }),
      15000
    );

    it(
      "projects only own agent data and queries exact independently ordered CRM future call",
      async () =>
        isolated(async tx => {
          const seed = await seedEnded(tx);
          await tx
            .update(staffCallParticipants)
            .set({
              privateNotes: "Synthetic internal secret",
              outcome: "completed",
              sharedSummary: "Unpublished synthetic recap",
            })
            .where(eq(staffCallParticipants.id, seed.participantIds[0]));
          const addFuture = async (
            agentId: number,
            startAt: Date,
            status: "booked" | "cancelled",
            participantStatus: "active" | "cancelled" = "active"
          ) => {
            const [c] = await tx
              .insert(staffCalls)
              .values({
                hostUserId: 701,
                reasonKey: "business_review",
                format: "one_to_one",
                startAt,
                endAt: new Date(startAt.getTime() + 1800000),
                status,
                createdById: 701,
                bookedAt: NOW,
                meetingUrl: "https://meet.example.test/synthetic",
              })
              .$returningId();
            await tx.insert(staffCallParticipants).values({
              callId: c.id,
              agentId,
              status: participantStatus,
              bookedAt: NOW,
            });
            return c.id;
          };
          // Insert later before earliest; cancelled seats/sessions and other agents cannot win.
          await addFuture(712, new Date("2026-11-25T10:00:00.111Z"), "booked");
          await addFuture(713, new Date("2026-11-21T13:00:00.111Z"), "booked");
          await addFuture(
            712,
            new Date("2026-11-21T14:00:00.111Z"),
            "cancelled"
          );
          const cancelledSeatCallId = await addFuture(
            712,
            new Date("2026-11-21T15:00:00.111Z"),
            "booked",
            "cancelled"
          );
          const nextId = await addFuture(712, FUTURE, "booked");
          const svc = service();
          const detail = await svc.get(712, seed.callId);
          expect(detail.participants).toHaveLength(1);
          expect(detail.participants[0]).toMatchObject({
            agentId: 712,
            sharedSummary: null,
          });
          expect(detail.participants[0]).not.toHaveProperty("privateNotes");
          expect(detail.participants[0]).not.toHaveProperty("outcome");
          expect(detail.call).toMatchObject({
            participantCount: 1,
            reasonExplanation: null,
          });
          expect(detail.history).toEqual([]);
          expect(detail.followUps).toEqual([]);
          await expect(svc.get(720, seed.callId)).resolves.toMatchObject({
            participants: expect.any(Array),
          });
          await expect(svc.get(701, seed.callId)).resolves.toMatchObject({
            participants: expect.any(Array),
          });
          await expect(svc.get(713, nextId)).rejects.toMatchObject({
            code: "NOT_FOUND",
          });
          expect((await svc.get(712, cancelledSeatCallId)).call).toMatchObject({
            status: "cancelled",
            meetingUrl: null,
          });
          expect((await svc.get(720, cancelledSeatCallId)).call).toMatchObject({
            status: "booked",
            meetingUrl: "https://meet.example.test/synthetic",
          });
          const crm = await svc.agentHistory(720, { agentId: 712, limit: 1 });
          expect(crm.items).toHaveLength(1);
          expect(crm.nextCall).toMatchObject({
            id: nextId,
            status: "booked",
            startAt: FUTURE,
          });
          await expect(
            svc.agentHistory(701, { agentId: 712, limit: 30 })
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
          const mine = await svc.mine(712, {
            from: new Date("2026-11-20T00:00:00Z"),
            to: new Date("2026-11-26T00:00:00Z"),
            limit: 100,
          });
          expect(
            mine.items.every(
              c => c.participantCount === 1 && c.reasonExplanation === null
            )
          ).toBe(true);
          expect(
            mine.items.some(
              c => c.startAt.toISOString() === "2026-11-21T13:00:00.111Z"
            )
          ).toBe(false);
          expect(
            mine.items.find(c => c.id === cancelledSeatCallId)
          ).toMatchObject({ status: "cancelled", meetingUrl: null });
        }),
      15000
    );

    it(
      "saves real notes/recap/draft target-source/history atomically with version conflicts and savepoint failure rollback",
      async () =>
        isolated(async tx => {
          const {
            callId,
            participantIds: [participantId],
          } = await seedEnded(tx, [712]);
          const svc = service();
          const note = {
            callId,
            participantId,
            expectedVersion: 1,
            attendance: "attended" as const,
            outcome: "follow_up_required" as const,
            privateNotes: "Synthetic internal learning notes",
          };
          expect(await svc.saveNotes(701, note)).toEqual({
            participantId,
            version: 2,
          });
          await expect(svc.saveNotes(701, note)).rejects.toMatchObject({
            code: "CONFLICT",
          });
          const [history] = await tx
            .select()
            .from(staffCallHistory)
            .where(eq(staffCallHistory.action, "notes.saved"));
          expect(history.beforeState).toMatchObject({
            privateNotes: null,
            version: 1,
          });
          expect(history.afterState).toMatchObject({
            privateNotes: note.privateNotes,
            version: 2,
            updatedAt: NOW.toISOString(),
          });
          expect(
            await svc.shareRecap(701, {
              callId,
              participantId,
              expectedVersion: 2,
              sharedSummary: "Synthetic agreed next step",
            })
          ).toMatchObject({ version: 3, sharedAt: NOW });
          const draftInput = staffCallFollowUpInput.parse({
            callId,
            participantId,
            expectedVersion: 3,
            title: "Synthetic planning practice",
            instructions: "Synthetic exercise only",
          });
          // Force a genuine downstream source FK failure AFTER plan and target writes.
          // A wrapper delegates every statement and nested TX to the SAME real root tx.
          const broken = (real: any): any =>
            new Proxy(real, {
              get(target, key, receiver) {
                if (key === "transaction")
                  return (fn: any) =>
                    target.transaction((nested: any) => fn(broken(nested)));
                if (key === "insert")
                  return (table: any) =>
                    table === staffCallActionSources
                      ? {
                          values: (value: any) =>
                            target
                              .insert(table)
                              .values({ ...value, participantId: -999 }),
                        }
                      : target.insert(table);
                const value = Reflect.get(target, key, receiver);
                return typeof value === "function" ? value.bind(target) : value;
              },
            });
          const failing = createStaffCallsService({
            getDb: async () => broken(tx),
            now: () => NOW,
          });
          await expect(
            failing.draftFollowUp(701, draftInput)
          ).rejects.toMatchObject({
            cause: { code: "ER_NO_REFERENCED_ROW_2" },
          });
          expect(await tx.select().from(academyActionPlans)).toEqual([]);
          expect(await tx.select().from(academyActionPlanTargets)).toEqual([]);
          expect(await tx.select().from(staffCallActionSources)).toEqual([]);
          const [unchanged] = await tx
            .select()
            .from(staffCallParticipants)
            .where(eq(staffCallParticipants.id, participantId));
          expect(unchanged.version).toBe(3);
          const draft = await svc.draftFollowUp(701, draftInput);
          expect(draft).toMatchObject({
            planId: expect.any(Number),
            status: "draft",
          });
          const [plan] = await tx
            .select()
            .from(academyActionPlans)
            .where(eq(academyActionPlans.id, draft.planId));
          expect(plan).toMatchObject({
            status: "draft",
            actionType: "ad_hoc",
            audience: "selected_agents",
            assignmentTrigger: "immediate",
            momentumAwardMode: "off",
            momentumPoints: 0,
            requiresNote: true,
            publishedAt: null,
          });
          const [target] = await tx.select().from(academyActionPlanTargets);
          const [source] = await tx.select().from(staffCallActionSources);
          expect(target).toMatchObject({ planId: draft.planId, agentId: 712 });
          expect(source).toMatchObject({
            planId: draft.planId,
            callId,
            participantId,
            createdById: 701,
          });
          await expect(
            svc.draftFollowUp(701, draftInput)
          ).rejects.toMatchObject({ code: "CONFLICT" });
          expect(await tx.select().from(academyActionPlans)).toHaveLength(1);
          const agent = await svc.get(712, callId);
          expect(agent.participants[0].sharedSummary).toBe(
            "Synthetic agreed next step"
          );
          expect(agent.participants[0]).not.toHaveProperty("privateNotes");
          expect(statements.some(s => /^savepoint sp1$/i.test(s))).toBe(true);
          expect(
            statements.some(s => /^rollback to savepoint sp1$/i.test(s))
          ).toBe(true);
          expect(
            (await tx.select().from(staffCallHistory)).map((h: any) => h.action)
          ).toEqual(["notes.saved", "recap.shared", "follow_up.drafted"]);
        }),
      15000
    );

    it(
      "books through mock 1:1 provider, replays idempotently, rejects payload reuse and recovers exact metadata without another write",
      async () =>
        isolated(async tx => {
          let mock: ReturnType<typeof offlineProvider>;
          const svc = service(
            resolve => (mock = offlineProvider(resolve)).provider
          );
          const input = staffCallBookInput.parse({
            requestId: "11111111-1111-4111-8111-111111111111",
            hostUserId: 701,
            reasonKey: "business_review",
            format: "one_to_one",
            startAt: FUTURE,
            endAt: FUTURE_END,
            agentIds: [712],
          });
          const booked = await svc.book(701, input);
          expect(booked).toMatchObject({
            state: "succeeded",
            status: "booked",
          });
          expect(await svc.book(701, input)).toEqual(booked);
          expect(mock!.create).toHaveBeenCalledTimes(1);
          await expect(
            svc.book(701, { ...input, reasonKey: "onboarding" })
          ).rejects.toMatchObject({ code: "CONFLICT" });
          const [call] = await tx
            .select()
            .from(staffCalls)
            .where(eq(staffCalls.id, booked.callId));
          const [op] = await tx
            .select()
            .from(staffCallOperations)
            .where(eq(staffCallOperations.requestId, input.requestId));
          expect(call).toMatchObject({
            startAt: FUTURE,
            endAt: FUTURE_END,
            bookedAt: NOW,
            activeOperationId: null,
            version: 3,
          });
          expect(op).toMatchObject({
            state: "succeeded",
            payload: { agentIds: [712], startAt: FUTURE.toISOString() },
            result: { operationId: input.requestId, status: "accepted" },
          });
          mock!.create.mockRejectedValueOnce(
            new Error("Synthetic timeout after possible acceptance")
          );
          const unknown = {
            ...input,
            requestId: "22222222-2222-4222-8222-222222222222",
            startAt: new Date("2026-11-23T10:00:00.789Z"),
            endAt: new Date("2026-11-23T10:30:00.789Z"),
          };
          expect(await svc.book(701, unknown)).toMatchObject({
            state: "needs_recovery",
            status: "needs_recovery",
          });
          expect(await svc.book(701, unknown)).toMatchObject({
            state: "needs_recovery",
          });
          expect(mock!.create).toHaveBeenCalledTimes(2);
          expect(await svc.reconcile(701, unknown.requestId)).toMatchObject({
            state: "succeeded",
            status: "booked",
          });
          expect(mock!.scan).toHaveBeenCalledTimes(1);
          expect(mock!.scan).toHaveBeenCalledWith(
            expect.objectContaining({
              operationId: unknown.requestId,
              hostUserId: 701,
              kind: "oneToOne",
              start: unknown.startAt.toISOString(),
              end: unknown.endAt.toISOString(),
            })
          );
          expect(mock!.create).toHaveBeenCalledTimes(2);
          expect(mock!.forbidden).not.toHaveBeenCalled();
        }),
      15000
    );

    it(
      "retains distinct group seats and JSON seat ledger with idempotent replay",
      async () =>
        isolated(async tx => {
          let mock: ReturnType<typeof offlineProvider>;
          const svc = service(
            resolve => (mock = offlineProvider(resolve)).provider
          );
          const input = staffCallBookInput.parse({
            requestId: "33333333-3333-4333-8333-333333333333",
            hostUserId: 701,
            reasonKey: "business_review",
            format: "group",
            startAt: FUTURE,
            endAt: FUTURE_END,
            agentIds: [712, 713],
          });
          const booked = await svc.book(701, input);
          expect(booked).toMatchObject({
            state: "succeeded",
            status: "booked",
          });
          const ps = await tx
            .select()
            .from(staffCallParticipants)
            .where(eq(staffCallParticipants.callId, booked.callId));
          expect(ps).toHaveLength(2);
          expect(new Set(ps.map((p: any) => p.providerSeatUid)).size).toBe(2);
          expect(
            ps.every(
              (p: any) =>
                p.providerSeatUid === `synthetic-seat-${p.id}` &&
                p.bookedAt.toISOString() === NOW.toISOString()
            )
          ).toBe(true);
          const [op] = await tx
            .select()
            .from(staffCallOperations)
            .where(eq(staffCallOperations.requestId, input.requestId));
          for (const p of ps)
            expect((op.result as any).seats[String(p.id)]).toMatchObject({
              participantId: p.id,
              seatUid: p.providerSeatUid,
            });
          expect(mock!.create.mock.calls[1][0]).toMatchObject({
            expectedBookingUid: `synthetic-${input.requestId}`,
          });
          expect(await svc.book(701, input)).toEqual(booked);
          expect(mock!.create).toHaveBeenCalledTimes(2);
        }),
      15000
    );

    it(
      "runs actual report queries on injected snapshot and excludes private data with booked/scheduled basis",
      async () =>
        isolated(async tx => {
          const { callId, participantIds } = await seedEnded(tx);
          await tx
            .update(staffCallParticipants)
            .set({
              attendance: "attended",
              privateNotes: "Synthetic report secret",
              sharedSummary: "Synthetic recap",
            })
            .where(eq(staffCallParticipants.id, participantIds[0]));
          await tx
            .update(staffCallParticipants)
            .set({ attendance: "no_show" })
            .where(eq(staffCallParticipants.id, participantIds[1]));
          await tx.insert(staffCallHistory).values({
            callId,
            actorId: 701,
            action: "reschedule.succeeded",
            beforeState: { synthetic: true },
            afterState: { synthetic: true },
          });
          const input = {
            rangeStart: "2026-11-20",
            rangeEnd: "2026-11-21",
            basis: "scheduled" as const,
          };
          const report = await getStaffCallReport(720, input);
          expect(report.counts).toMatchObject({
            sessions: 1,
            bookedSessions: 1,
            participantInvitations: 2,
            bookedParticipants: 2,
            attended: 1,
            noShow: 1,
            attendanceDenominator: 2,
            attendanceRate: 0.5,
            rescheduledSessions: 1,
          });
          expect(report.byHost).toMatchObject([
            { hostUserId: 701, hostName: "Synthetic Host" },
          ]);
          expect(JSON.stringify(report)).not.toContain(
            "Synthetic report secret"
          );
          expect(JSON.stringify(report)).not.toContain("Synthetic recap");
          expect(
            (await getStaffCallReport(720, { ...input, basis: "booked" }))
              .counts.sessions
          ).toBe(1);
          await expect(getStaffCallReport(701, input)).rejects.toMatchObject({
            code: "FORBIDDEN",
          });
          expect(fixture.dbReads).toBeGreaterThan(0);
          expect(
            await tx
              .select()
              .from(staffCallParticipants)
              .where(
                and(
                  eq(staffCallParticipants.callId, callId),
                  eq(staffCallParticipants.agentId, 712)
                )
              )
          ).toHaveLength(1);
        }),
      15000
    );
  }
);
