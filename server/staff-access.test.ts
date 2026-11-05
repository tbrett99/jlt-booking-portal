import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { type SQL } from "drizzle-orm";
import {
  agentCrmProfiles,
  agentRecordMerges,
  staffAccessAudit,
  staffInstructorCourses,
  staffRoleAssignments,
  users,
  type User,
} from "../drizzle/schema";
import {
  normaliseStaffCourseIds,
  staffAccountEligible,
} from "../shared/staff-access";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import {
  assertNotSelfReview,
  getInstructorCourseIds,
  getStaffAccessSnapshot,
  isFullAdmin,
  isMissingStaffSchemaError,
  recordStaffOperation,
  requireEngagementStaff,
  requireInstructorCourse,
} from "./staff-access";

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

type Account = ReturnType<typeof account>;
function account(overrides: Record<string, unknown> = {}) {
  return { ...agent(), crmStatus: "active", archiveId: null, ...overrides };
}
type Assignment = {
  id: number;
  userId: number;
  staffRole: string;
  isActive: boolean;
};
type Scope = { assignmentId: number; courseId: number };
const dialect = new MySqlDialect();

// This double renders Drizzle predicates locally; it never connects to or executes SQL.
// Restricting table identities also makes unexpected financial/profile reads fail loudly.
function syntheticDb(
  options: {
    accounts?: Account[];
    assignments?: Assignment[];
    scopes?: Scope[];
    readError?: unknown;
    auditError?: unknown;
  } = {}
) {
  const state = {
    accounts: structuredClone(options.accounts ?? [account()]),
    assignments: structuredClone(options.assignments ?? []),
    scopes: structuredClone(options.scopes ?? []),
    audits: [] as Record<string, unknown>[],
  };
  const reads: {
    table: unknown;
    fields: Record<string, any> | undefined;
    sql: string;
    params: unknown[];
  }[] = [];
  const db = {
    select: vi.fn((fields?: Record<string, any>) => {
      let table: unknown;
      let condition: SQL | undefined;
      let maximum: number | undefined;
      const chain = {
        from: (value: unknown) => {
          table = value;
          return chain;
        },
        leftJoin: (value: unknown) => {
          expect([agentCrmProfiles, agentRecordMerges]).toContain(value);
          return chain;
        },
        where: (value: SQL) => {
          condition = value;
          return chain;
        },
        limit: (value: number) => {
          maximum = value;
          return chain;
        },
        then: (
          resolve: (value: unknown[]) => unknown,
          reject: (error: unknown) => unknown
        ) => {
          return Promise.resolve()
            .then(() => {
              const query = condition
                ? dialect.sqlToQuery(condition)
                : { sql: "", params: [] };
              reads.push({
                table,
                fields,
                sql: query.sql,
                params: query.params,
              });
              if (options.readError) throw options.readError;
              let rows: Record<string, unknown>[];
              if (table === staffRoleAssignments) {
                expect(query.sql).toContain(
                  "`staff_role_assignments`.`userId` = ?"
                );
                expect(query.sql).toContain(
                  "`staff_role_assignments`.`isActive` = ?"
                );
                expect(query.params[1]).toBe(true);
                rows = state.assignments.filter(
                  row => row.userId === query.params[0] && row.isActive
                );
              } else if (table === users) {
                expect(query.sql).toContain("`users`.`id` = ?");
                rows = state.accounts.filter(row => row.id === query.params[0]);
              } else if (table === staffInstructorCourses) {
                expect(query.sql).toContain(
                  "`staff_instructor_courses`.`assignmentId` = ?"
                );
                rows = state.scopes.filter(
                  row => row.assignmentId === query.params[0]
                );
              } else {
                throw new Error(
                  "Unexpected table read: no CRM/financial data queries are allowed"
                );
              }
              if (maximum !== undefined) rows = rows.slice(0, maximum);
              return fields
                ? rows.map(row =>
                    Object.fromEntries(
                      Object.entries(fields).map(([key, column]) => [
                        key,
                        row[
                          key === "crmStatus" || key === "archiveId"
                            ? key
                            : column.name
                        ],
                      ])
                    )
                  )
                : rows;
            })
            .then(resolve, reject);
        },
      };
      return chain;
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (value: Record<string, unknown>) => {
        expect(table).toBe(staffAccessAudit);
        if (options.auditError) throw options.auditError;
        state.audits.push(value);
      }),
    })),
    update: vi.fn(() => {
      throw new Error("Existing user updates are forbidden");
    }),
    execute: vi.fn(() => {
      throw new Error("Raw/live SQL is forbidden");
    }),
  };
  mocks.getDb.mockResolvedValue(db);
  return { db, state, reads };
}
const instructor = {
  id: 51,
  userId: 11,
  staffRole: "instructor",
  isActive: true,
};
const engagement = {
  id: 52,
  userId: 11,
  staffRole: "agent_engagement",
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(null);
});

describe("shared staff eligibility and exact course normalization", () => {
  it("sorts and deduplicates explicit IDs without mutating the input", () => {
    const ids = [42, 9, 42, 3];
    expect(normaliseStaffCourseIds(ids)).toEqual([3, 9, 42]);
    expect(ids).toEqual([42, 9, 42, 3]);
    expect(normaliseStaffCourseIds([])).toEqual([]);
  });

  it("rejects invalid scopes instead of silently dropping them", () => {
    for (const invalid of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      "9",
      null,
    ]) {
      expect(() => normaliseStaffCourseIds([3, invalid] as number[])).toThrow(
        "Invalid staff course scope"
      );
    }
  });

  it("permits only active agents and normalizes the optional CRM eligibility predicate", () => {
    for (const crmStatus of [null, undefined, "", "  ", "active", " ACTIVE "]) {
      expect(staffAccountEligible({ ...agent(), crmStatus })).toBe(true);
    }
    for (const crmStatus of [
      "paused",
      "suspended",
      "in_notice",
      "cancelled",
      "unknown",
    ]) {
      expect(staffAccountEligible({ ...agent(), crmStatus })).toBe(false);
    }
    expect(staffAccountEligible({ ...agent(), archived: true })).toBe(false);
    expect(staffAccountEligible({ ...agent(), mustChangePassword: true })).toBe(
      false
    );
    expect(staffAccountEligible({ ...agent(), role: "admin" })).toBe(false);
  });
});

describe("actual staff permission functions with synthetic current DB state", () => {
  it("denies a plain agent regardless of forged session capability or CRM flags", async () => {
    const { reads } = syntheticDb();
    const user = Object.assign(agent({ crmAccess: true }), {
      instructor: true,
      engagement: true,
      courseIds: [9],
    });
    expect(await getStaffAccessSnapshot(user)).toEqual({
      instructor: false,
      engagement: false,
      courseIds: [],
      schemaAvailable: true,
    });
    await expect(requireInstructorCourse(user, 9)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(requireEngagementStaff(user)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(reads.every(read => read.table === staffRoleAssignments)).toBe(true);
    expect(user.role).toBe("agent");
  });

  it("grants only exact assignment/course IDs for the same user; titles never confer rights", async () => {
    const { reads } = syntheticDb({
      assignments: [
        instructor,
        { ...engagement, userId: 22 },
        { ...instructor, id: 61, userId: 22 },
      ],
      scopes: [
        { assignmentId: 51, courseId: 9 },
        { assignmentId: 51, courseId: 9 },
        { assignmentId: 51, courseId: 3 },
        { assignmentId: 61, courseId: 42 },
      ],
    });
    const user = agent();
    const unchanged = structuredClone(user);
    expect(await getInstructorCourseIds(user)).toEqual([3, 9]);
    await expect(requireInstructorCourse(user, 9)).resolves.toBeUndefined();
    await expect(requireInstructorCourse(user, 42)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(requireEngagementStaff(user)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(user).toEqual(unchanged);
    expect(
      reads.every(read =>
        [users, staffRoleAssignments, staffInstructorCourses].includes(
          read.table as any
        )
      )
    ).toBe(true);
  });

  it("a disabled assignment and its leftover course scope grant no authority", async () => {
    syntheticDb({
      assignments: [
        { ...instructor, isActive: false },
        { ...engagement, isActive: false },
      ],
      scopes: [{ assignmentId: 51, courseId: 9 }],
    });
    await expect(requireInstructorCourse(agent(), 9)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(requireEngagementStaff(agent())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("an enabled Instructor placeholder without explicit courses grants no access", async () => {
    syntheticDb({ assignments: [instructor] });
    expect(await getStaffAccessSnapshot(agent())).toEqual({
      instructor: false,
      engagement: false,
      courseIds: [],
      schemaAvailable: true,
    });
    await expect(requireInstructorCourse(agent(), 9)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("re-reads assignment revocation and account changes after a stale caller previously succeeded", async () => {
    const { state } = syntheticDb({
      assignments: [instructor, engagement],
      scopes: [{ assignmentId: 51, courseId: 9 }],
    });
    const staleUser = agent();
    await expect(
      requireInstructorCourse(staleUser, 9)
    ).resolves.toBeUndefined();
    await expect(requireEngagementStaff(staleUser)).resolves.toBeUndefined();
    state.scopes[0].courseId = 42;
    await expect(requireInstructorCourse(staleUser, 9)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      requireInstructorCourse(staleUser, 42)
    ).resolves.toBeUndefined();
    state.assignments[0].isActive = false;
    await expect(requireInstructorCourse(staleUser, 9)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    state.accounts[0].mustChangePassword = true;
    await expect(requireEngagementStaff(staleUser)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(staleUser.mustChangePassword).toBe(false);
  });

  it.each([
    ["no longer an agent", { role: "admin" }],
    ["inactive", { isActive: false }],
    ["paused portal", { portalStatus: "paused" }],
    ["suspended portal", { portalStatus: "suspended" }],
    ["in-notice portal", { portalStatus: "in_notice" }],
    ["forced password", { mustChangePassword: true }],
    ["merged archive", { archiveId: 700 }],
    ["paused CRM", { crmStatus: "paused" }],
    ["suspended CRM", { crmStatus: "suspended" }],
    ["in-notice CRM", { crmStatus: "in_notice" }],
  ])(
    "denies both staff roles when the fresh DB account is %s",
    async (_label, change) => {
      syntheticDb({
        assignments: [instructor, engagement],
        scopes: [{ assignmentId: 51, courseId: 9 }],
        accounts: [account(change)],
      });
      await expect(requireInstructorCourse(agent(), 9)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(requireEngagementStaff(agent())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  );

  it("fails closed if the current account is missing or stored course IDs are corrupt", async () => {
    syntheticDb({ assignments: [instructor], accounts: [] });
    expect(await getInstructorCourseIds(agent())).toEqual([]);
    syntheticDb({
      assignments: [instructor],
      scopes: [{ assignmentId: 51, courseId: -5 }],
    });
    await expect(getInstructorCourseIds(agent())).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Staff permissions could not be verified",
    });
  });

  it("returns only the safe capability snapshot and selects no CRM/financial/private fields", async () => {
    const { reads, db } = syntheticDb({
      assignments: [instructor, engagement],
      scopes: [{ assignmentId: 51, courseId: 9 }],
    });
    expect(await getStaffAccessSnapshot(agent())).toEqual({
      instructor: true,
      engagement: true,
      courseIds: [9],
      schemaAvailable: true,
    });
    const accountRead = reads.find(read => read.table === users)!;
    expect(Object.keys(accountRead.fields!).sort()).toEqual([
      "archiveId",
      "crmStatus",
      "isActive",
      "mustChangePassword",
      "portalStatus",
      "role",
    ]);
    expect(accountRead.fields?.crmStatus).toBe(agentCrmProfiles.agentStatus);
    expect(accountRead.fields?.archiveId).toBe(agentRecordMerges.id);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("preserves full administrator access without consulting staff schema or modifying identity", async () => {
    for (const role of ["admin", "super_admin"] as const) {
      const user = agent({
        role,
        isActive: false,
        portalStatus: "paused",
        mustChangePassword: true,
      });
      expect(isFullAdmin(user)).toBe(true);
      expect(await getInstructorCourseIds(user)).toBeNull();
      await expect(requireInstructorCourse(user, 9)).resolves.toBeUndefined();
      await expect(requireEngagementStaff(user)).resolves.toBeUndefined();
      expect(() => assertNotSelfReview(user, user.id)).not.toThrow();
      await recordStaffOperation(user, "existing_admin", {});
      expect(user.role).toBe(role);
    }
    expect(isFullAdmin(agent())).toBe(false);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("blocks restricted staff self-review but allows review of another learner", () => {
    expect(() => assertNotSelfReview(agent(), 11)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" })
    );
    expect(() => assertNotSelfReview(agent(), 22)).not.toThrow();
  });

  it("rejects invalid course authorization inputs even for administrators", async () => {
    for (const courseId of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        requireInstructorCourse(agent({ role: "admin" }), courseId)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});

describe("schema absence, fail-closed errors, and restricted operation audits", () => {
  it("recognizes only exact missing staff tables, including nested causes and cyclic wrappers", () => {
    for (const table of [
      "role_assignments",
      "instructor_courses",
      "access_audit",
      "academy_uploads",
    ]) {
      expect(
        isMissingStaffSchemaError({
          cause: {
            code: "ER_NO_SUCH_TABLE",
            sqlMessage: `Table 'test.staff_${table}' doesn't exist`,
          },
        })
      ).toBe(true);
    }
    const cyclic: any = {
      code: "ER_ACCESS_DENIED_ERROR",
      message: "staff_role_assignments",
    };
    cyclic.cause = cyclic;
    for (const error of [
      cyclic,
      new Error("staff_role_assignments missing"),
      { code: "ER_NO_SUCH_TABLE", message: "Table 'test.users' doesn't exist" },
      {
        errno: 1146,
        message: "Table 'test.staff_role_assignments_backup' doesn't exist",
      },
    ]) {
      expect(isMissingStaffSchemaError(error)).toBe(false);
    }
  });

  it("missing exact staff schema returns false capabilities but never authorizes either role", async () => {
    syntheticDb({
      readError: {
        cause: {
          errno: 1146,
          sqlMessage: "Table 'test.staff_role_assignments' doesn't exist",
        },
      },
    });
    expect(await getStaffAccessSnapshot(agent())).toEqual({
      instructor: false,
      engagement: false,
      courseIds: [],
      schemaAvailable: false,
    });
    await expect(requireInstructorCourse(agent(), 9)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(requireEngagementStaff(agent())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("unknown and non-staff table failures deny access without exposing SQL or private values", async () => {
    for (const error of [
      new Error("SELECT private_financial_data secret-token"),
      {
        code: "ER_NO_SUCH_TABLE",
        sqlMessage: "Table 'private.users' doesn't exist SELECT secret-token",
      },
      { code: "ER_LOCK_DEADLOCK", message: "UPDATE users secret-token" },
    ]) {
      syntheticDb({ readError: error });
      await expect(getStaffAccessSnapshot(agent())).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Staff permissions could not be verified",
      });
    }
  });

  it("denies permissions when the DB is unavailable", async () => {
    await expect(getStaffAccessSnapshot(agent())).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Staff permissions could not be verified",
    });
    await expect(requireEngagementStaff(agent())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("fails closed and sanitizes database acquisition failures too", async () => {
    mocks.getDb.mockRejectedValue(
      new Error("SELECT financial_secret connection-password")
    );
    await expect(getStaffAccessSnapshot(agent())).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Staff permissions could not be verified",
    });
  });

  it("awaits the restricted audit using the existing agent identity, with no user writes", async () => {
    const { state, db } = syntheticDb();
    const user = agent();
    await recordStaffOperation(user, "instructor_marked_written", {
      courseId: 9,
      learnerId: 22,
    });
    expect(state.audits).toEqual([
      {
        actorId: 11,
        targetUserId: 11,
        action: "instructor_marked_written",
        metadata: { courseId: 9, learnerId: 22 },
      },
    ]);
    expect(db.insert).toHaveBeenCalledWith(staffAccessAudit);
    expect(db.update).not.toHaveBeenCalled();
    expect(user.role).toBe("agent");
  });

  it("does not report a restricted write audit as successful when audit storage fails", async () => {
    const failure = new Error("Synthetic audit failure");
    syntheticDb({ auditError: failure });
    await expect(
      recordStaffOperation(agent(), "instructor_write", {})
    ).rejects.toThrow();
    mocks.getDb.mockResolvedValue(null);
    await expect(
      recordStaffOperation(agent(), "instructor_write", {})
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
