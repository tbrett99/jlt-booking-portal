import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { type SQL } from "drizzle-orm";
import {
  academyCourses,
  agentCrmProfiles,
  agentRecordMerges,
  staffAccessAudit,
  staffInstructorCourses,
  staffRoleAssignments,
  users,
  type User,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { staffAccessRouter } from "./staff-access-router";
import { adminProcedure, router } from "./_core/trpc";

function agent(overrides: Partial<User> = {}): User {
  return {
    id: 11,
    openId: "synthetic-agent-11",
    name: "Synthetic Agent",
    email: "agent@example.invalid",
    loginMethod: "test",
    role: "agent",
    isActive: true,
    tempPassword: null,
    mustChangePassword: false,
    phone: null,
    credentialsSentAt: null,
    portalStatus: "active",
    crmAccess: false,
    crmEmail: null,
    commissionRatePct: 80,
    suspendedAt: null,
    suspensionReason: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSignedIn: new Date(0),
    ...overrides,
  };
}
function context(user: User | null): TrpcContext {
  return {
    user,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
function caller(user: User | null = agent({ id: 1, role: "super_admin" })) {
  return staffAccessRouter.createCaller(context(user));
}
function account(overrides: Record<string, unknown> = {}) {
  return { ...agent(), crmStatus: "active", archiveId: null, ...overrides };
}
type Assignment = {
  id: number;
  userId: number;
  staffRole: string;
  isActive: boolean;
  grantedById: number;
  grantedAt: Date;
  revokedById: number | null;
  revokedAt: Date | null;
};
type State = {
  accounts: ReturnType<typeof account>[];
  courses: { id: number; title: string; status: string }[];
  assignments: Assignment[];
  scopes: { assignmentId: number; courseId: number }[];
  audits: Record<string, any>[];
};
type Fault =
  | "assignment-write"
  | "scope-delete"
  | "scope-insert"
  | "audit"
  | "assignment-readback"
  | "scope-readback"
  | "commit"
  | "read";
const dialect = new MySqlDialect();
const assignment: Assignment = {
  id: 51,
  userId: 11,
  staffRole: "instructor",
  isActive: true,
  grantedById: 1,
  grantedAt: new Date(0),
  revokedById: null,
  revokedAt: null,
};

// A bounded Drizzle chain double: no actual DB, SQL execution, provider, email, or storage code.
// Writes are staged in a cloned transaction state; failed callbacks/commits discard all changes.
function syntheticDb(initial: Partial<State> = {}, fault?: Fault) {
  let state: State = {
    accounts: [account(), account({ id: 22, name: "Other Synthetic Agent" })],
    courses: [
      { id: 9, title: "Existing Course", status: "draft" },
      { id: 42, title: "First Class", status: "published" },
    ],
    assignments: [],
    scopes: [],
    audits: [],
    ...structuredClone(initial),
  };
  const events: {
    kind: string;
    table?: unknown;
    fields?: Record<string, any>;
    sql?: string;
    params?: unknown[];
    transactional: boolean;
    value?: any;
  }[] = [];
  let assignmentWritten = false;
  let scopesDeleted = false;
  function connection(current: () => State, transactional: boolean) {
    const select = vi.fn((fields?: Record<string, any>) => {
      let table: unknown;
      let condition: SQL | undefined;
      let limit: number | undefined;
      let joinedUsers = false;
      const chain = {
        from: (value: unknown) => {
          table = value;
          return chain;
        },
        leftJoin: (value: unknown) => {
          expect([agentCrmProfiles, agentRecordMerges]).toContain(value);
          return chain;
        },
        innerJoin: (value: unknown) => {
          expect(value).toBe(users);
          joinedUsers = true;
          return chain;
        },
        where: (value: SQL) => {
          condition = value;
          return chain;
        },
        limit: (value: number) => {
          limit = value;
          return chain;
        },
        orderBy: () => chain,
        for: (mode: string) => {
          expect(mode).toBe("update");
          events.push({ kind: "lock", table, transactional });
          return chain;
        },
        then: (
          resolve: (rows: any[]) => unknown,
          reject: (error: unknown) => unknown
        ) =>
          Promise.resolve()
            .then(() => {
              const query = condition
                ? dialect.sqlToQuery(condition)
                : { sql: "", params: [] };
              events.push({
                kind: "select",
                table,
                fields,
                sql: query.sql,
                params: query.params,
                transactional,
              });
              if (fault === "read")
                throw new Error(
                  "SELECT financial_secret FROM users connection-password"
                );
              const s = current();
              let rows: Record<string, any>[];
              if (table === users) {
                rows = query.sql.includes("`users`.`id` = ?")
                  ? s.accounts.filter(row => row.id === query.params[0])
                  : s.accounts.filter(
                      row =>
                        row.role === "agent" &&
                        row.isActive &&
                        row.portalStatus === "active" &&
                        row.archiveId === null
                    );
              } else if (table === academyCourses) {
                if (condition)
                  expect(query.sql).toContain("`academy_courses`.`id` in (");
                rows = condition
                  ? s.courses.filter(row => query.params.includes(row.id))
                  : s.courses;
              } else if (table === staffRoleAssignments) {
                rows = s.assignments;
                if (condition) {
                  expect(query.sql).toContain(
                    "`staff_role_assignments`.`userId` = ?"
                  );
                  rows = rows.filter(row => row.userId === query.params[0]);
                  if (
                    query.sql.includes(
                      "`staff_role_assignments`.`staffRole` = ?"
                    )
                  )
                    rows = rows.filter(
                      row => row.staffRole === query.params[1]
                    );
                  if (
                    query.sql.includes(
                      "`staff_role_assignments`.`isActive` = ?"
                    )
                  ) {
                    expect(query.params[1]).toBe(true);
                    rows = rows.filter(row => row.isActive);
                  }
                }
                if (joinedUsers)
                  rows = rows.map(row => {
                    const user = s.accounts.find(
                      user => user.id === row.userId
                    );
                    return { ...row, name: user?.name, email: user?.email };
                  });
                if (fault === "assignment-readback" && assignmentWritten)
                  rows = [];
              } else if (table === staffInstructorCourses) {
                if (condition)
                  expect(query.sql).toContain(
                    "`staff_instructor_courses`.`assignmentId` = ?"
                  );
                rows = condition
                  ? s.scopes.filter(row => row.assignmentId === query.params[0])
                  : s.scopes;
                if (fault === "scope-readback" && scopesDeleted)
                  rows = [{ assignmentId: 51, courseId: 999 }];
              } else {
                throw new Error("Unexpected CRM/financial/private table read");
              }
              if (limit !== undefined) rows = rows.slice(0, limit);
              return fields
                ? rows.map(row =>
                    Object.fromEntries(
                      Object.entries(fields).map(([key, column]) => [
                        key,
                        row[
                          ["crmStatus", "archiveId", "name", "email"].includes(
                            key
                          )
                            ? key
                            : column.name
                        ],
                      ])
                    )
                  )
                : rows.map(row => ({ ...row }));
            })
            .then(resolve, reject),
      };
      return chain;
    });
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn(async (value: any) => {
        expect(transactional).toBe(true);
        events.push({ kind: "insert", table, value, transactional });
        const s = current();
        if (table === staffRoleAssignments) {
          if (fault === "assignment-write")
            throw new Error("Synthetic assignment write failure");
          s.assignments.push({ id: 51, ...value });
          assignmentWritten = true;
        } else if (table === staffInstructorCourses) {
          if (fault === "scope-insert")
            throw new Error("Synthetic scope insert failure");
          s.scopes.push(...value);
        } else if (table === staffAccessAudit) {
          if (fault === "audit") throw new Error("Synthetic audit failure");
          s.audits.push(value);
        } else
          throw new Error(
            "Unexpected insertion, including existing users/financial data"
          );
      }),
    }));
    const update = vi.fn((table: unknown) => ({
      set: (value: any) => ({
        where: async (condition: SQL) => {
          expect(transactional).toBe(true);
          expect(table).toBe(staffRoleAssignments);
          const query = dialect.sqlToQuery(condition);
          expect(query.sql).toContain("`staff_role_assignments`.`id` = ?");
          events.push({
            kind: "update",
            table,
            value,
            transactional,
            ...query,
          });
          if (fault === "assignment-write")
            throw new Error("Synthetic assignment update failure");
          const row = current().assignments.find(
            row => row.id === query.params[0]
          );
          if (row) Object.assign(row, value);
          assignmentWritten = true;
        },
      }),
    }));
    const remove = vi.fn((table: unknown) => ({
      where: async (condition: SQL) => {
        expect(transactional).toBe(true);
        expect(table).toBe(staffInstructorCourses);
        const query = dialect.sqlToQuery(condition);
        expect(query.sql).toContain(
          "`staff_instructor_courses`.`assignmentId` = ?"
        );
        events.push({ kind: "delete", table, transactional, ...query });
        if (fault === "scope-delete")
          throw new Error("Synthetic scope deletion failure");
        current().scopes = current().scopes.filter(
          row => row.assignmentId !== query.params[0]
        );
        scopesDeleted = true;
      },
    }));
    return {
      select,
      insert,
      update,
      delete: remove,
      execute: vi.fn(() => {
        throw new Error("Raw/live SQL is forbidden");
      }),
    };
  }
  const db = {
    ...connection(() => state, false),
    transaction: vi.fn(
      async (
        work: (tx: ReturnType<typeof connection>) => Promise<unknown>,
        config: unknown
      ) => {
        expect(config).toEqual({ isolationLevel: "serializable" });
        const staged = structuredClone(state);
        events.push({ kind: "begin", transactional: true });
        try {
          const result = await work(connection(() => staged, true));
          if (fault === "commit") throw new Error("Synthetic commit failure");
          state = staged;
          events.push({ kind: "commit", transactional: true });
          return result;
        } catch (error) {
          events.push({ kind: "rollback", transactional: true });
          throw error;
        }
      }
    ),
  };
  mocks.getDb.mockResolvedValue(db);
  return { db, events, state: () => state };
}
const saveInput = {
  userId: 11,
  staffRole: "instructor" as const,
  enabled: true,
  courseIds: [9],
  reason: "Approved synthetic scope",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(null);
});

describe("actual staffAccess router caller gates and safe read models", () => {
  it("requires authentication on all actual procedures", async () => {
    const api = caller(null);
    for (const call of [
      () => api.mine(),
      () => api.adminOptions(),
      () => api.adminList(),
      () => api.adminSave(saveInput),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("allows management only to Super Admin, not plain agents, assigned staff, or ordinary Admin", async () => {
    const { db } = syntheticDb({
      assignments: [assignment],
      scopes: [{ assignmentId: 51, courseId: 9 }],
    });
    for (const user of [agent(), agent({ role: "admin" })]) {
      const api = caller(user);
      await expect(api.adminOptions()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(api.adminList()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(api.adminSave(saveInput)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("mine returns only safe capabilities for an ordinary agent and missing exact staff schema", async () => {
    syntheticDb();
    expect(await caller(agent()).mine()).toEqual({
      instructor: false,
      engagement: false,
      courseIds: [],
      schemaAvailable: true,
    });
    const chain: any = {
      from: () => chain,
      where: () => chain,
      then: (_resolve: unknown, reject: (error: unknown) => unknown) =>
        Promise.reject({
          code: "ER_NO_SUCH_TABLE",
          sqlMessage: "Table 'synthetic.staff_role_assignments' doesn't exist",
        }).then(undefined, reject),
    };
    mocks.getDb.mockResolvedValue({ select: () => chain });
    expect(await caller(agent()).mine()).toEqual({
      instructor: false,
      engagement: false,
      courseIds: [],
      schemaAvailable: false,
    });
  });

  it("mine refreshes DB state on the same stale caller and never broadens the general Admin procedure", async () => {
    const s = syntheticDb({
      assignments: [assignment],
      scopes: [{ assignmentId: 51, courseId: 9 }],
    });
    const user = agent();
    const api = caller(user);
    expect((await api.mine()).instructor).toBe(true);
    const existingAdminRouter = router({
      privateArea: adminProcedure.query(() => "admin-only"),
    });
    await expect(
      existingAdminRouter.createCaller(context(user)).privateArea()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    s.state().assignments[0].isActive = false;
    expect((await api.mine()).instructor).toBe(false);
    s.state().assignments[0].isActive = true;
    s.state().accounts[0].crmStatus = "in_notice";
    expect((await api.mine()).instructor).toBe(false);
    expect(user.role).toBe("agent");
    await expect(
      existingAdminRouter
        .createCaller(context(agent({ role: "admin" })))
        .privateArea()
    ).resolves.toBe("admin-only");
  });

  it("Super Admin options use explicit minimal agent/course projections, with no automatic title grants", async () => {
    const s = syntheticDb();
    const result = await caller().adminOptions();
    expect(result.agents[0]).toEqual({
      id: 11,
      name: "Synthetic Agent",
      email: "agent@example.invalid",
    });
    expect(result.courses).toEqual([
      { id: 9, title: "Existing Course", status: "draft" },
      { id: 42, title: "First Class", status: "published" },
    ]);
    expect(
      s.events
        .filter(e => e.kind === "select")
        .map(e => Object.keys(e.fields!).sort())
    ).toEqual([
      ["email", "id", "name"],
      ["id", "status", "title"],
    ]);
    expect(s.state().assignments).toEqual([]);
    expect(s.db.insert).not.toHaveBeenCalled();
    expect(s.db.update).not.toHaveBeenCalled();
  });

  it("adminList attaches deduplicated scopes by assignment only and exposes no full user/private fields", async () => {
    const s = syntheticDb({
      assignments: [
        assignment,
        { ...assignment, id: 61, userId: 22, staffRole: "agent_engagement" },
      ],
      scopes: [
        { assignmentId: 51, courseId: 9 },
        { assignmentId: 51, courseId: 9 },
        { assignmentId: 999, courseId: 42 },
      ],
    });
    const result = await caller().adminList();
    expect(
      result.map(row => ({ userId: row.userId, courseIds: row.courseIds }))
    ).toEqual([
      { userId: 11, courseIds: [9] },
      { userId: 22, courseIds: [] },
    ]);
    expect(Object.keys(result[0]).sort()).toEqual([
      "courseIds",
      "email",
      "grantedAt",
      "id",
      "isActive",
      "name",
      "staffRole",
      "userId",
    ]);
    expect(
      s.events
        .filter(e => e.kind === "select")
        .every(e => e.fields !== undefined)
    ).toBe(true);
  });

  it("mine denies unknown database failures without leaking query/connection details", async () => {
    syntheticDb({}, "read");
    await expect(caller(agent()).mine()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Staff permissions could not be verified",
    });
  });

  it.each(["adminOptions", "adminList"] as const)(
    "%s fails closed without leaking database query details",
    async procedure => {
      syntheticDb({}, "read");
      const error = await caller()
        [procedure]()
        .catch(error => error);
      expect(error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(error.message).not.toMatch(
        /SELECT|financial_secret|connection-password/
      );
    }
  );
});

describe("actual adminSave target validation and explicit course scopes", () => {
  it("rejects invalid payloads before any transaction or write", async () => {
    const { db } = syntheticDb();
    for (const input of [
      { ...saveInput, userId: 0 },
      { ...saveInput, staffRole: "admin" },
      { ...saveInput, reason: "no" },
      { ...saveInput, courseIds: [0] },
      { ...saveInput, courseIds: [-1] },
      { ...saveInput, courseIds: [1.5] },
      { ...saveInput, courseIds: Array.from({ length: 101 }, () => 9) },
    ])
      await expect(caller().adminSave(input as any)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("requires explicit instructor courses and rejects course scopes for Engagement", async () => {
    const { db } = syntheticDb();
    await expect(
      caller().adminSave({ ...saveInput, courseIds: [] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().adminSave({ ...saveInput, staffRole: "agent_engagement" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects absent/non-agent, inactive, paused, suspended, merged, forced-password and notice targets", async () => {
    const changes: Record<string, unknown>[] = [
      { role: "admin" },
      { role: "super_admin" },
      { isActive: false },
      { portalStatus: "paused" },
      { portalStatus: "suspended" },
      { portalStatus: "in_notice" },
      { archiveId: 700 },
      { mustChangePassword: true },
      { crmStatus: "paused" },
      { crmStatus: "suspended" },
      { crmStatus: "in_notice" },
    ];
    for (const change of changes) {
      const s = syntheticDb({ accounts: [account(change)] });
      await expect(caller().adminSave(saveInput)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(s.state().assignments).toEqual([]);
      expect(
        s.events.some(event =>
          ["insert", "update", "delete"].includes(event.kind)
        )
      ).toBe(false);
      expect(s.events.at(-1)?.kind).toBe("rollback");
    }
    syntheticDb({ accounts: [] });
    await expect(caller().adminSave(saveInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects missing or archived explicit courses, never substituting a First Class title match", async () => {
    const absent = syntheticDb();
    await expect(
      caller().adminSave({ ...saveInput, courseIds: [999] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(absent.state().assignments).toEqual([]);
    const archived = syntheticDb({
      courses: [{ id: 9, title: "First Class", status: "archived" }],
    });
    await expect(caller().adminSave(saveInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(archived.state().assignments).toEqual([]);
  });

  it("unknown storage failures fail closed and do not leak SQL in adminSave errors", async () => {
    const s = syntheticDb({}, "read");
    const error = await caller()
      .adminSave(saveInput)
      .catch(error => error);
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).not.toMatch(
      /SELECT|financial_secret|connection-password/
    );
    expect(s.state().assignments).toEqual([]);
    expect(s.events.at(-1)?.kind).toBe("rollback");
  });
});

describe("actual adminSave atomic assignment, scope, audit and readback", () => {
  it("creates one user's additive assignment with sorted exact grants and audited readback in SERIALIZABLE transaction", async () => {
    const s = syntheticDb();
    const beforeAccounts = structuredClone(s.state().accounts);
    const admin = agent({ id: 1, role: "super_admin" });
    const result = await caller(admin).adminSave({
      ...saveInput,
      courseIds: [42, 9, 42],
      reason: "  Approved synthetic scope  ",
    });
    expect(result).toEqual({ success: true, assignmentId: 51 });
    expect(s.state().assignments).toEqual([
      expect.objectContaining({
        userId: 11,
        staffRole: "instructor",
        isActive: true,
        grantedById: 1,
        revokedAt: null,
      }),
    ]);
    expect(s.state().scopes).toEqual([
      { assignmentId: 51, courseId: 9 },
      { assignmentId: 51, courseId: 42 },
    ]);
    expect(s.state().audits).toEqual([
      {
        actorId: 1,
        targetUserId: 11,
        action: "staff_access_granted",
        metadata: {
          staffRole: "instructor",
          reason: "Approved synthetic scope",
          previousActive: false,
          previousCourseIds: [],
          courseIds: [9, 42],
        },
      },
    ]);
    expect(s.state().accounts).toEqual(beforeAccounts);
    expect(s.events.every(event => event.transactional)).toBe(true);
    expect(
      s.events.filter(event => event.kind === "lock").map(event => event.table)
    ).toEqual([users, staffRoleAssignments]);
    expect(s.events.at(-1)?.kind).toBe("commit");
    const auditIndex = s.events.findIndex(
      event => event.kind === "insert" && event.table === staffAccessAudit
    );
    expect(
      s.events
        .slice(0, auditIndex)
        .filter(event => event.kind === "select")
        .at(-1)?.table
    ).toBe(staffInstructorCourses);
    expect(s.db.select).not.toHaveBeenCalled();
    expect(s.db.execute).not.toHaveBeenCalled();
    expect(admin.role).toBe("super_admin");
  });

  it("updates only the target assignment and replaces only its scopes, preserving another user's identity and grants", async () => {
    const other = { ...assignment, id: 61, userId: 22 };
    const s = syntheticDb({
      assignments: [assignment, other],
      scopes: [
        { assignmentId: 51, courseId: 42 },
        { assignmentId: 61, courseId: 42 },
      ],
    });
    await caller().adminSave(saveInput);
    expect(s.state().assignments.find(row => row.id === 61)).toEqual(other);
    expect(s.state().scopes).toEqual([
      { assignmentId: 61, courseId: 42 },
      { assignmentId: 51, courseId: 9 },
    ]);
    expect(s.state().audits[0].metadata).toMatchObject({
      previousActive: true,
      previousCourseIds: [42],
      courseIds: [9],
    });
    expect(
      s.events
        .filter(event => event.kind === "update")
        .map(event => event.table)
    ).toEqual([staffRoleAssignments]);
    expect(
      s.events.filter(event => event.kind === "update")[0].value
    ).not.toHaveProperty("role");
    expect(s.state().accounts.every(user => user.role === "agent")).toBe(true);
  });

  it("revokes even a now-ineligible agent safely, clears its old scopes and audits the previous grant", async () => {
    const s = syntheticDb({
      accounts: [
        account({
          portalStatus: "paused",
          crmStatus: "in_notice",
          mustChangePassword: true,
        }),
      ],
      assignments: [assignment],
      scopes: [{ assignmentId: 51, courseId: 9 }],
    });
    await caller().adminSave({ ...saveInput, enabled: false, courseIds: [] });
    expect(s.state().assignments[0]).toMatchObject({
      isActive: false,
      revokedById: 1,
      revokedAt: expect.any(Date),
    });
    expect(s.state().scopes).toEqual([]);
    expect(s.state().audits[0]).toMatchObject({
      action: "staff_access_revoked",
      metadata: { previousActive: true, previousCourseIds: [9], courseIds: [] },
    });
    expect(
      s.events.some(
        event => event.kind === "select" && event.table === academyCourses
      )
    ).toBe(false);
  });

  it("creates a disabled placeholder without automatic course access", async () => {
    const s = syntheticDb();
    await caller().adminSave({ ...saveInput, enabled: false, courseIds: [] });
    expect(s.state().assignments[0]).toMatchObject({
      isActive: false,
      revokedById: 1,
    });
    expect(s.state().scopes).toEqual([]);
    expect((await caller(agent()).mine()).instructor).toBe(false);
  });

  it("grants Engagement to one user with no course rights or base-role changes", async () => {
    const s = syntheticDb();
    await caller().adminSave({
      ...saveInput,
      staffRole: "agent_engagement",
      courseIds: [],
    });
    expect(s.state().assignments[0]).toMatchObject({
      userId: 11,
      staffRole: "agent_engagement",
      isActive: true,
    });
    expect(s.state().scopes).toEqual([]);
    expect(await caller(agent()).mine()).toEqual({
      instructor: false,
      engagement: true,
      courseIds: [],
      schemaAvailable: true,
    });
    expect((await caller(agent({ id: 22 })).mine()).engagement).toBe(false);
    expect(s.state().accounts.every(user => user.role === "agent")).toBe(true);
  });

  it.each([
    "assignment-write",
    "scope-delete",
    "scope-insert",
    "audit",
    "assignment-readback",
    "scope-readback",
    "commit",
  ] as const)(
    "rolls back assignment, scopes and audit together when %s fails",
    async fault => {
      const s = syntheticDb(
        {
          assignments: [assignment],
          scopes: [{ assignmentId: 51, courseId: 42 }],
        },
        fault
      );
      const before = structuredClone(s.state());
      await expect(caller().adminSave(saveInput)).rejects.toBeDefined();
      expect(s.state()).toEqual(before);
      expect(s.events.at(-1)?.kind).toBe("rollback");
      expect(s.events.some(event => event.kind === "commit")).toBe(false);
      expect(
        s.events
          .filter(event => event.kind === "update")
          .every(event => event.table === staffRoleAssignments)
      ).toBe(true);
      expect(
        s.events
          .filter(event => ["insert", "update", "delete"].includes(event.kind))
          .every(event => event.transactional)
      ).toBe(true);
    }
  );
});
