import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { adminTasks, staffAccessAudit, users } from "../drizzle/schema";
import { adminProcedure, router } from "./_core/trpc";
import { nextRecurringTaskDate, TASK_RECURRENCE_RULES } from "../shared/task-recurrence";
import { resolveEquivalentTaskOwnerIds } from "../shared/task-identity";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb, getCalendarEvents: vi.fn(async () => []) }));
import { ADMIN_TASK_IDENTITY_ACTION, assertNewAdminTaskAssignee, buildActiveAdminTaskOwners, getEquivalentAdminTaskOwnerIds, isMissingTaskIdentityAuditTable, listActiveAdminTaskOwners, validateAdminTaskHistoryLinks } from "./admin-task-identity";
import { dashboardRouter } from "./dashboard-router";

const primary = { id: 47, name: "Max", email: "max@thejltgroup.co.uk", role: "super_admin", isActive: true };
const retired = { ...primary, id: 760, email: null, isActive: false };
const taskIds = [150036, 150265, 150281, 150282, 150283, 150286, 150290, 150292];
const metadata = { primaryUserId: 47, retiredUserId: 760, historyOnlyLink: true, taskIds, taskCount: 8 };
const audit = { actorId: 47, targetUserId: 760, action: ADMIN_TASK_IDENTITY_ACTION, metadata };
function dbDouble(accounts = [primary, retired], audits: any[] = [audit], fault?: unknown, foundIds = taskIds) {
  return { select: vi.fn(() => ({ from: (table: unknown) => ({ where: vi.fn(async () => {
    if (table === users) return accounts;
    if (table === staffAccessAudit) { if (fault) throw fault; return audits; }
    if (table === adminTasks) return foundIds.map((id) => ({ id }));
    throw new Error("Unexpected table");
  }) }) })) };
}
beforeEach(() => mocks.getDb.mockReset());

describe("task-only identity policy", () => {
  it("links retired history only through the task-specific audit", () => {
    expect(Array.from(validateAdminTaskHistoryLinks([primary, retired], [audit]))).toEqual([[760, 47]]);
    expect(validateAdminTaskHistoryLinks([primary, retired], [{ ...audit, action: "duplicate_admin_login_retired" }]).size).toBe(0);
    expect(buildActiveAdminTaskOwners([primary, retired], new Map())).toEqual([{ id: 47, name: "Max", email: primary.email, identityUserIds: [47] }]);
  });
  it.each([
    { actorId: 760 }, { targetUserId: 47 }, { metadata: { ...metadata, historyOnlyLink: "true" } },
    { metadata: { ...metadata, historyOnlyLink: 1 } }, { metadata: { ...metadata, retiredUserId: "760" } },
    { metadata: { ...metadata, taskIds: [1, 1], taskCount: 2 } },
    { metadata: { ...metadata, taskIds: [0], taskCount: 1 } },
    { metadata: { ...metadata, taskCount: 7 } }, { metadata: "invalid JSON" },
  ])("rejects invalid or ambiguous audit: %j", (change) => {
    expect(() => validateAdminTaskHistoryLinks([primary, retired], [{ ...audit, ...change }])).toThrow("could not be verified");
  });
  it.each([
    { ...retired, email: "max@thejltgroup.co.uk" }, { ...retired, isActive: true },
    { ...retired, role: "admin" }, { ...retired, role: "agent" },
  ])("requires a null-email inactive same-role archive", (archive) => {
    expect(() => validateAdminTaskHistoryLinks([primary, archive], [audit])).toThrow();
  });
  it("requires an active primary and rejects duplicate or chained mappings", () => {
    expect(validateAdminTaskHistoryLinks([{ ...primary, isActive: false }, retired], [audit]).size).toBe(0);
    expect(() => validateAdminTaskHistoryLinks([primary, retired], [audit, audit])).toThrow();
    expect(() => validateAdminTaskHistoryLinks([primary, retired], [audit, { ...audit, actorId: 760, targetUserId: 47, metadata: { ...metadata, primaryUserId: 760, retiredUserId: 47 } }])).toThrow();
  });
  it("keeps active email equivalents but never infers inactive history", async () => {
    mocks.getDb.mockResolvedValue(dbDouble([primary, retired, { ...primary, id: 48 }, { ...retired, id: 761, email: primary.email }], []));
    expect(await listActiveAdminTaskOwners()).toEqual([{ id: 47, name: "Max", email: primary.email, identityUserIds: [47, 48] }]);
  });
  it("verifies current users and immutable audit, independent of later task deletion", async () => {
    mocks.getDb.mockResolvedValue(dbDouble());
    expect(await getEquivalentAdminTaskOwnerIds(primary)).toEqual([47, 760]);
    await expect(assertNewAdminTaskAssignee(760)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(assertNewAdminTaskAssignee(47)).resolves.toBeUndefined();
    mocks.getDb.mockResolvedValue(dbDouble([primary, retired], [audit], undefined, taskIds.slice(1)));
    expect((await listActiveAdminTaskOwners())[0].identityUserIds).toEqual([47, 760]);
  });
  it("keeps other active assignees usable after a historical primary is deactivated", async () => {
    const other = { ...primary, id: 672, name: "Other staff", email: "other@example.test" };
    mocks.getDb.mockResolvedValue(dbDouble([{ ...primary, isActive: false }, retired, other], [audit]));
    expect(await listActiveAdminTaskOwners()).toEqual([{ id: 672, name: "Other staff", email: other.email, identityUserIds: [672] }]);
    await expect(assertNewAdminTaskAssignee(47)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(assertNewAdminTaskAssignee(672)).resolves.toBeUndefined();
  });
  it("degrades only a genuine exact 1146 audit-table absence, with active owners intact", async () => {
    const absent = { errno: 1146, code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'portal.staff_access_audit' doesn't exist" };
    expect(isMissingTaskIdentityAuditTable({ cause: absent })).toBe(true);
    mocks.getDb.mockResolvedValue(dbDouble([primary, retired], [], absent));
    expect((await listActiveAdminTaskOwners())[0].identityUserIds).toEqual([47]);
    for (const fault of [{ ...absent, errno: 1054 }, { ...absent, sqlMessage: "Table 'portal.users' doesn't exist" }, new Error("secret database hostname")]) {
      mocks.getDb.mockResolvedValue(dbDouble([primary, retired], [], fault));
      await expect(listActiveAdminTaskOwners()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Task owner identities could not be verified. Please try again." });
    }
  });
  it.each([0, -1, 1.2, NaN, Infinity, "47"])("rejects invalid fresh assignee %s", async (id) => {
    await expect(assertNewAdminTaskAssignee(id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});

describe("shared task identity resolver", () => {
  it("honors explicit membership without depending on email", () => {
    const owners = [{ id: 47, email: null, identityUserIds: [47, 760] }];
    expect(resolveEquivalentTaskOwnerIds({ id: 47, email: null }, owners)).toEqual([47, 760]);
    expect(resolveEquivalentTaskOwnerIds({ id: 760, email: null }, owners)).toEqual([760, 47]);
    expect(resolveEquivalentTaskOwnerIds({ id: 90, email: null }, owners)).toEqual([90]);
  });
  it("filters unsafe IDs while preserving current owner and legacy email behavior", () => {
    expect(resolveEquivalentTaskOwnerIds(primary, [{ id: 48, email: " MAX@THEJLTGROUP.CO.UK ", identityUserIds: [0, -2, NaN, 760] }])).toEqual([47, 48, 760]);
    expect(resolveEquivalentTaskOwnerIds({ id: 0 }, [])).toEqual([]);
    expect(resolveEquivalentTaskOwnerIds(null, [])).toEqual([]);
  });
});

// Execute the actual task router source with bounded mocked dependencies; no
// full app imports, database, provider, notifications, or background jobs.
function taskCaller(dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
  const start = source.indexOf("tasks: router({") + "tasks: ".length;
  const end = source.indexOf("  // ─── Calendar", start);
  const expression = source.slice(start, end).trim().replace(/,$/, "");
  const env = { router, adminProcedure, z, TRPCError, TASK_RECURRENCE_RULES, nextRecurringTaskDate, assertNewAdminTaskAssignee, getEquivalentAdminTaskOwnerIds, ...dependencies };
  const js = ts.transpileModule(`return (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const tasks = new Function(...Object.keys(env), js)(...Object.values(env));
  return tasks.createCaller({ user: primary, req: { headers: {} }, res: {} });
}
describe("actual task-router source execution", () => {
  it("rejects changed inactive ownership before recurring task writes or notifications", async () => {
    mocks.getDb.mockResolvedValue(dbDouble());
    const createAdminTask = vi.fn(), updateAdminTask = vi.fn(), createInAppNotification = vi.fn();
    const caller = taskCaller({ getAdminTaskById: vi.fn(async () => ({ id: 10, assigneeId: 47, status: "open", recurrenceRule: "daily", dueDate: new Date() })), createAdminTask, updateAdminTask, createInAppNotification });
    await expect(caller.update({ id: 10, assigneeId: 760, status: "done" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createAdminTask).not.toHaveBeenCalled(); expect(updateAdminTask).not.toHaveBeenCalled(); expect(createInAppNotification).not.toHaveBeenCalled();
  });
  it("preserves unchanged historical ownership on normal updates", async () => {
    const updateAdminTask = vi.fn(async () => ({ id: 10, assigneeId: 760 }));
    const caller = taskCaller({ getAdminTaskById: vi.fn(async () => ({ id: 10, assigneeId: 760, status: "done", recurrenceRule: "none" })), updateAdminTask });
    await expect(caller.update({ id: 10, assigneeId: 760, title: "History" })).resolves.toMatchObject({ assigneeId: 760 });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("counts open audited-source tasks, excludes done and unrelated ownership", async () => {
    mocks.getDb.mockResolvedValue(dbDouble());
    const caller = taskCaller({ getAllAdminTasks: vi.fn(async () => [{ assigneeId: 47, status: "open" }, { assigneeId: 760, status: "open" }, { assigneeId: 760, status: "done" }, { assigneeId: 9, status: "open" }]) });
    expect(await caller.myOpenCount()).toBe(2);
  });
  it("workboard executes parameterized IN matches and preserves unassigned/email branches", async () => {
    const db = dbDouble();
    const queries: { sql: string; params: unknown[] }[] = [];
    const dialect = new MySqlDialect();
    Object.assign(db, { execute: vi.fn(async (query) => { queries.push(dialect.sqlToQuery(query)); throw new Error("Stop before unrelated dashboard reads"); }) });
    mocks.getDb.mockResolvedValue(db);
    await expect(dashboardRouter.createCaller({ user: primary, req: { headers: {} }, res: {} } as any).workboard()).rejects.toThrow();
    const mine = queries.filter((query) => query.sql.includes("t.assigneeId IN"));
    expect(mine).toHaveLength(2);
    for (const query of mine) {
      expect(query.sql).toContain("t.assigneeId IN (?, ?)");
      expect(query.params).toContain(47); expect(query.params).toContain(760);
      expect(query.sql).toContain("t.assigneeId IS NULL AND t.createdById = ?");
      expect(query.sql).toContain("LOWER(TRIM(assignee.email))");
    }
  });
});

function centralWrite(name: "createAdminTask" | "updateAdminTask", env: Record<string, unknown>) {
  const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  const start = source.indexOf(`export async function ${name}(`);
  const end = source.indexOf("\nexport async function ", start + 1);
  const declaration = source.slice(start, end).replace("export async function", "async function");
  const js = ts.transpileModule(`${declaration}\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(env), js)(...Object.values(env));
}
describe("actual central database task-write source execution", () => {
  it.each(["manual", "booking_mention", "recurrence"])("rejects stale inactive fresh %s assignment before insert", async (createdFrom) => {
    mocks.getDb.mockResolvedValue(dbDouble());
    const execute = vi.fn();
    const create = centralWrite("createAdminTask", { assertNewAdminTaskAssignee, getDb: mocks.getDb, _pool: { execute } });
    await expect(create({ title: "Synthetic", createdById: 47, assigneeId: 760, createdFrom })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("retains exact prepared INSERT syntax for an active fresh assignment", async () => {
    mocks.getDb.mockResolvedValue(dbDouble());
    const execute = vi.fn(async () => [{ insertId: 10 }]);
    const create = centralWrite("createAdminTask", { assertNewAdminTaskAssignee, getDb: mocks.getDb, _pool: { execute }, getAdminTaskById: vi.fn(async () => ({ id: 10 })) });
    await expect(create({ title: "Synthetic", createdById: 47, assigneeId: 47 })).resolves.toEqual({ id: 10 });
    expect(execute.mock.calls[0][0]).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    expect(execute.mock.calls[0][1][3]).toBe(47);
  });
  it("central update rejects changed inactive assignment but preserves an unchanged historical owner", async () => {
    const write = vi.fn();
    const db = dbDouble();
    Object.assign(db, { update: vi.fn(() => ({ set: () => ({ where: write }) })) });
    mocks.getDb.mockResolvedValue(db);
    const getAdminTaskById = vi.fn(async () => ({ id: 10, assigneeId: 47 }));
    const update = centralWrite("updateAdminTask", { assertNewAdminTaskAssignee, getDb: mocks.getDb, getAdminTaskById, adminTasks, eq: () => ({}) });
    await expect(update(10, { assigneeId: 760 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(write).not.toHaveBeenCalled();
    getAdminTaskById.mockResolvedValue({ id: 10, assigneeId: 760 });
    await expect(update(10, { assigneeId: 760, title: "History" })).resolves.toEqual({ id: 10, assigneeId: 760 });
    expect(write).toHaveBeenCalledTimes(1);
  });
});
