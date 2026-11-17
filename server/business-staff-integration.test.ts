import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { TRPCError } from "@trpc/server";
import { and, eq, getTableName, inArray, or, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";
import { summariseAcademyProgress } from "../shared/academy-utils";
import { DIRECT_DEBIT_CONCERN_MEMBERSHIP_STATUSES } from "./membership-payment-concern-policy";

const guards = vi.hoisted(() => ({
  getDb: vi.fn(),
  pool: vi.fn(() => {
    throw new Error("Real database access forbidden");
  }),
}));
vi.mock("./db", () => ({ getDb: guards.getDb, getRawDbPool: guards.pool }));
import {
  assertBusinessStaffIdentityNotDeleted,
  getRetainedBusinessStaffIds,
} from "./business-staff-identity-protection";
import { buildMergePlan, loadMergeScope } from "./agent-merge-service";

const dialect = new MySqlDialect();
const sourceFor = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8");

/** Execute the actual AST body; the only body substitutions are dynamic imports.
 * No whole router/server is imported, and no database SQL is executed here. */
function extract(
  file: string,
  name: string,
  kind: "function" | "query" | "mutation" = "function"
) {
  const text = sourceFor(file);
  const tree = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const found: Array<ts.FunctionDeclaration | ts.ArrowFunction> = [];
  function visit(node: ts.Node) {
    if (
      kind === "function" &&
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    )
      found.push(node);
    if (
      kind !== "function" &&
      ts.isPropertyAssignment(node) &&
      node.name.getText(tree) === name
    ) {
      function callback(child: ts.Node) {
        if (
          ts.isCallExpression(child) &&
          ts.isPropertyAccessExpression(child.expression) &&
          child.expression.name.text === kind &&
          child.arguments[0] &&
          ts.isArrowFunction(child.arguments[0])
        )
          found.push(child.arguments[0]);
        ts.forEachChild(child, callback);
      }
      callback(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (found.length !== 1)
    throw new Error(
      `Expected one actual ${file}:${name}, found ${found.length}`
    );
  const node = found[0];
  const expression = ts.isFunctionDeclaration(node)
    ? ts.factory.createFunctionExpression(
        node.modifiers?.filter(m => m.kind === ts.SyntaxKind.AsyncKeyword),
        node.asteriskToken,
        undefined,
        node.typeParameters,
        node.parameters,
        node.type,
        node.body!
      )
    : node;
  const imports: Record<string, string> = {
    "./db": "db",
    "../drizzle/schema": "schema",
    "drizzle-orm": "orm",
    "@trpc/server": "trpc",
    "./business-staff-identity-protection": "identity",
  };
  const transformed = ts.transform(expression, [
    context => root => {
      const rewrite: ts.Visitor = child => {
        if (
          ts.isCallExpression(child) &&
          child.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
          const module = child.arguments[0];
          if (!ts.isStringLiteral(module) || !imports[module.text])
            throw new Error(`Unmocked dynamic import in ${name}`);
          return ts.factory.createPropertyAccessExpression(
            ts.factory.createIdentifier("deps"),
            imports[module.text]
          );
        }
        return ts.visitEachChild(child, rewrite, context);
      };
      return ts.visitNode(root, rewrite) as typeof root;
    },
  ]);
  const printed = ts
    .createPrinter()
    .printNode(ts.EmitHint.Expression, transformed.transformed[0], tree);
  transformed.dispose();
  const script = ts.transpileModule(`const extracted = (${printed});`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  return (bindings: Record<string, unknown> = {}) =>
    new Function(
      "deps",
      ...Object.keys(bindings),
      `${script}\nreturn extracted;`
    )(
      {
        db: { getDb: guards.getDb },
        schema,
        orm: { eq, or },
        trpc: { TRPCError },
        identity: {
          getRetainedBusinessStaffIds,
          assertBusinessStaffIdentityNotDeleted,
        },
      },
      ...Object.values(bindings)
    ) as (...args: any[]) => Promise<any>;
}

const roleUpdate = extract("./db.ts", "updateUserRole");
const ownerSummary = extract(
  "./business-staff-management-router.ts",
  "ownerSummary",
  "query"
);
const bookableAgents = extract("./routers.ts", "listAgents", "query");
const deleteSignup = extract("./crm-router.ts", "deleteNewSignUp", "mutation");
const completeCourse = extract("./academy-router.ts", "recalculateCompletion");
const operationalBooking = extract(
  "./business-staff-bookings.ts",
  "operationalBooking"
);
const bookingAmounts = extract("./business-staff-bookings.ts", "amounts");
const issueBase = extract("./membership-payment-issues-router.ts", "issueBase");
const bookingScope = extract("./business-staff-bookings.ts", "bookingScope");

function bookingConstant(name: string) {
  const source = sourceFor("./business-staff-bookings.ts");
  const tree = ts.createSourceFile(
    "business-staff-bookings.ts",
    source,
    ts.ScriptTarget.Latest,
    true
  );
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name)
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!initializer)
    throw new Error(`Actual booking constant ${name} not found`);
  const script = ts.transpileModule(
    `const value = ${initializer.getText(tree)};`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    }
  ).outputText;
  return new Function("bookings", script + "return value;")(schema.bookings);
}

/** A fixture read/write spy, NOT a SQL engine or a transaction/DB simulation. */
function fixtureDb(records: Map<any, any[]>) {
  const events: string[] = [];
  const reads: Array<{
    table: any;
    fields: any;
    predicate?: any;
    lock?: string;
  }> = [];
  const writes: Array<{ table: any; values: any }> = [];
  const tx: any = {
    select: (fields?: any) => {
      const read: any = { fields };
      const chain: any = {
        from: (table: any) => {
          read.table = table;
          return chain;
        },
        where: (predicate: any) => {
          read.predicate = predicate;
          return chain;
        },
        limit: () => chain,
        for: (lock: string) => {
          read.lock = lock;
          events.push(`lock:${getTableName(read.table)}:${lock}`);
          return chain;
        },
        then: (resolve: any, reject: any) => {
          reads.push(read);
          events.push(`read:${getTableName(read.table)}`);
          return Promise.resolve(records.get(read.table) ?? []).then(
            resolve,
            reject
          );
        },
      };
      return chain;
    },
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => {
          writes.push({ table, values });
          events.push(`update:${getTableName(table)}`);
          for (const row of records.get(table) ?? [])
            Object.assign(row, values);
        },
      }),
    }),
    insert: (table: any) => ({
      values: async (values: any) => {
        writes.push({ table, values });
        events.push(`insert:${getTableName(table)}`);
      },
    }),
    delete: (table: any) => ({
      where: async () => {
        writes.push({ table, values: "deleted" });
        events.push(`delete:${getTableName(table)}`);
      },
    }),
  };
  const db = {
    ...tx,
    transaction: async (callback: any) => {
      events.push("begin");
      try {
        const result = await callback(tx);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    },
  };
  return { db, tx, events, reads, writes };
}
const owner = {
  id: 10,
  role: "agent",
  isActive: true,
  portalStatus: "active",
  name: "Synthetic owner",
  email: "owner@example.test",
};
const membership = (overrides: Record<string, unknown> = {}) => ({
  id: 30,
  ownerUserId: 10,
  staffUserId: 20,
  status: "active",
  ...overrides,
});
const ormQuery = (predicate: any) => dialect.sqlToQuery(predicate);
const assertAgentNotMerged = vi.fn(async () => undefined);
beforeEach(() => {
  guards.getDb.mockReset();
  guards.pool.mockClear();
  assertAgentNotMerged.mockClear();
});

describe("retained business-staff identities: actual functions, entirely offline", () => {
  it.each([
    { userId: 20, role: "admin", status: "active", identity: "employee" },
    {
      userId: 20,
      role: "super_admin",
      status: "revoked",
      identity: "revoked employee",
    },
    { userId: 10, role: "admin", status: "revoked", identity: "owner" },
  ])(
    "blocks $identity promotion to $role after locking both retained identities",
    async ({ userId, role, status }) => {
      const person = { id: userId, role: "agent" };
      const link = membership({ status });
      const f = fixtureDb(
        new Map([
          [schema.users, [person]],
          [schema.businessStaffMemberships, [link]],
        ])
      );
      guards.getDb.mockResolvedValue(f.db);
      const update = roleUpdate({
        assertAgentNotMerged,
        getDb: guards.getDb,
        users: schema.users,
        eq,
        writableAgentUser: (id: number) => eq(schema.users.id, id),
      });
      await expect(update(userId, role)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(person.role).toBe("agent");
      expect(link).toEqual(membership({ status }));
      expect(f.writes).toEqual([]);
      expect(f.events).toEqual([
        "begin",
        "lock:users:update",
        "read:users",
        "lock:business_staff_memberships:update",
        "read:business_staff_memberships",
        "rollback",
      ]);
      const predicate = ormQuery(f.reads[1].predicate);
      expect(predicate.sql).toContain(" or ");
      expect(predicate.params).toEqual([userId, userId]);
    }
  );

  it("preserves ordinary role updates and retained agent-role edits without deleting relationships", async () => {
    for (const retained of [false, true]) {
      const person = { id: 20, role: "agent" };
      const link = membership({ status: "revoked" });
      const f = fixtureDb(
        new Map([
          [schema.users, [person]],
          [schema.businessStaffMemberships, retained ? [link] : []],
        ])
      );
      guards.getDb.mockResolvedValue(f.db);
      const update = roleUpdate({
        assertAgentNotMerged,
        getDb: guards.getDb,
        users: schema.users,
        eq,
        writableAgentUser: (id: number) => eq(schema.users.id, id),
      });
      await update(20, retained ? "agent" : "admin");
      expect(person.role).toBe(retained ? "agent" : "admin");
      expect(f.writes).toEqual([
        { table: schema.users, values: { role: person.role } },
      ]);
      expect(f.events.at(-1)).toBe("commit");
      expect(link).toEqual(membership({ status: "revoked" }));
    }
  });

  it("reads all retained employee IDs with the real helper, excluding neither revoked rows nor financial-history users", async () => {
    const f = fixtureDb(
      new Map([
        [
          schema.businessStaffMemberships,
          [
            membership(),
            membership({ id: 31, staffUserId: 21, status: "revoked" }),
            membership({ id: 32 }),
          ],
        ],
      ])
    );
    guards.getDb.mockResolvedValue(f.db);
    expect([...(await getRetainedBusinessStaffIds())].sort()).toEqual([20, 21]);
    expect(f.reads).toHaveLength(1);
    expect(f.reads[0].predicate).toBeUndefined();
    expect(Object.keys(f.reads[0].fields)).toEqual(["staffUserId"]);
    guards.getDb.mockResolvedValue(null);
    await expect(getRetainedBusinessStaffIds()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it.each([20, 10])(
    "actual onboarding deletion blocks retained employee/owner %s before cleanup or audit writes",
    async userId => {
      const person = { ...owner, id: userId, portalStatus: "onboarding" };
      const f = fixtureDb(
        new Map([
          [schema.users, [person]],
          [schema.recruitmentSignupLinks, []],
          [
            schema.businessStaffMemberships,
            [membership({ status: "revoked" })],
          ],
        ])
      );
      guards.getDb.mockResolvedValue(f.db);
      await expect(
        deleteSignup({ assertAgentNotMerged, TRPCError })({
          input: { userId },
          ctx: { user: owner },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.writes).toEqual([]);
      expect(f.events.at(-1)).toBe("rollback");
      expect(f.events.indexOf("lock:users:update")).toBeLessThan(
        f.events.indexOf("read:business_staff_memberships")
      );
      const predicate = ormQuery(
        f.reads.find(r => r.table === schema.businessStaffMemberships)!
          .predicate
      );
      expect(predicate.sql).toContain(" or ");
      expect(predicate.params).toEqual([userId, userId]);
    }
  );

  it("ownerSummary derives its owner ID exclusively from authenticated ctx and returns only hasStaff", async () => {
    const f = fixtureDb(
      new Map([
        [schema.businessStaffMemberships, [membership({ status: "revoked" })]],
      ])
    );
    guards.getDb.mockResolvedValue(f.db);
    const invoke = ownerSummary();
    expect(
      await invoke({ ctx: { user: owner }, input: { ownerUserId: 999 } })
    ).toEqual({ hasStaff: true });
    const query = ormQuery(f.reads[0].predicate);
    expect(query.sql).toContain("ownerUserId");
    expect(query.params).toEqual([owner.id]);
    guards.getDb.mockClear();
    expect(
      await invoke({ ctx: { user: { ...owner, portalStatus: "onboarding" } } })
    ).toEqual({ hasStaff: false });
    expect(guards.getDb).not.toHaveBeenCalled();
    guards.getDb.mockResolvedValue(null);
    await expect(invoke({ ctx: { user: owner } })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("actual users.listAgents removes active and revoked employee IDs, keeps the owner, and never leaks financial fields", async () => {
    const f = fixtureDb(
      new Map([
        [
          schema.businessStaffMemberships,
          [membership(), membership({ staffUserId: 21, status: "revoked" })],
        ],
      ])
    );
    guards.getDb.mockResolvedValue(f.db);
    const users = [
      owner,
      { ...owner, id: 20 },
      { ...owner, id: 21 },
      { ...owner, id: 99, role: "admin" },
    ].map(user => ({
      ...user,
      grossCost: "SECRET",
      commissionRatePct: "SECRET",
      bankAccountNumber: "SECRET",
      tempPassword: "SECRET",
    }));
    const originals = structuredClone(users);
    const getAllUsers = vi.fn(async () => users);
    const result = await bookableAgents({ getAllUsers })();
    expect(result.map((user: any) => user.id)).toEqual([10, 99]);
    expect(Object.keys(result[0]).sort()).toEqual([
      "credentialsSentAt",
      "email",
      "id",
      "name",
      "phone",
      "role",
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(users).toEqual(originals); // Financial-history source is untouched, not globally filtered.
    expect(getAllUsers).toHaveBeenCalledOnce();
    expect(guards.pool).not.toHaveBeenCalled();
  });
});

describe("booking operational DTO and price boundary", () => {
  it("actual sanitizer hides financial stages and the separate amount lookup reads only permitted gross customer price", async () => {
    const sanitize = operationalBooking();
    for (const currentStage of [
      "Claimable",
      "Commission Paid",
      "Paid",
      "Unknown financial stage",
    ]) {
      expect(sanitize({ id: 100, currentStage })).toEqual({
        id: 100,
        currentStage: "Booking recorded",
      });
    }
    expect(sanitize({ id: 100, currentStage: "Awaiting Documents" })).toEqual({
      id: 100,
      currentStage: "Awaiting Documents",
    });
    const f = fixtureDb(
      new Map([[schema.bookings, [{ id: 100, grossPrice: "2500.00" }]]])
    );
    const fields = bookingConstant("operationalFields");
    expect(Object.keys(fields).sort()).toEqual([
      "bookedDate",
      "clientName",
      "crmRef",
      "currentStage",
      "departureDate",
      "destination",
      "id",
      "numberOfNights",
      "passengers",
      "ptsRef",
      "topdogRef",
    ]);
    expect(bookingConstant("customerGrossPriceColumn")).toBe(
      schema.bookings.grossCost
    );
    const amounts = bookingAmounts({
      bookings: schema.bookings,
      customerGrossPriceColumn: bookingConstant("customerGrossPriceColumn"),
      and,
      inArray,
      bookingScope: bookingScope({ bookings: schema.bookings, and, eq }),
    });
    expect((await amounts(f.db, 10, [100], false)).size).toBe(0);
    expect(f.reads).toEqual([]);
    expect(await amounts(f.db, 10, [100], true)).toEqual(
      new Map([[100, "2500.00"]])
    );
    expect(f.reads[0].fields).toEqual({
      id: schema.bookings.id,
      grossPrice: schema.bookings.grossCost,
    });
    expect(ormQuery(f.reads[0].predicate).params).toEqual([10, false, 100]);
  });
});

function completionFixture(employeeStatus: string | null, completed = true) {
  const enrollment = {
    id: 40,
    agentId: 20,
    courseId: 50,
    status: "in_progress",
  };
  const profile = {
    userId: 20,
    trainingStage: "Training",
    academyAcceleratorStartedAt: null,
  };
  const f = fixtureDb(
    new Map([
      [schema.academyEnrollments, [enrollment]],
      [
        schema.academyLessonProgress,
        [
          { lessonId: 60, completedAt: new Date("2026-01-01") },
          {
            lessonId: 61,
            completedAt: completed ? new Date("2026-01-01") : null,
          },
          { lessonId: 999, completedAt: new Date("2026-01-01") },
        ],
      ],
      [
        schema.businessStaffMemberships,
        employeeStatus ? [membership({ status: employeeStatus })] : [],
      ],
      [
        schema.academyCourses,
        [{ id: 50, title: "Synthetic Academy", isCoreAcademy: true }],
      ],
      [schema.agentCrmProfiles, [profile]],
      [schema.users, [{ ...owner, id: 20 }]],
    ])
  );
  guards.getDb.mockResolvedValue(f.db);
  const journeys = vi.fn(async () => undefined),
    actions = vi.fn(async () => undefined),
    notify = vi.fn(async () => undefined),
    audit = vi.fn(async () => undefined),
    email = vi.fn(async () => undefined);
  const invoke = completeCourse({
    getDb: guards.getDb,
    academyEnrollments: schema.academyEnrollments,
    academyLessonProgress: schema.academyLessonProgress,
    academyCourses: schema.academyCourses,
    agentCrmProfiles: schema.agentCrmProfiles,
    users: schema.users,
    eq,
    summariseAcademyProgress,
    courseStructure: vi.fn(async () => ({
      lessons: [
        { id: 60, isRequired: true },
        { id: 61, isRequired: true },
        { id: 62, isRequired: false },
      ],
    })),
    enrolAgentInAcceleratorJourneys: journeys,
    assignAcceleratorEntryActions: actions,
    createInAppNotification: notify,
    addAudit: audit,
    dispatchAcademyEmailAlerts: email,
  });
  return {
    ...f,
    enrollment,
    profile,
    journeys,
    actions,
    notify,
    audit,
    email,
    invoke,
  };
}

describe("actual Academy completion outcomes", () => {
  it.each(["active", "revoked"])(
    "completes %s employee learning and audit without CRM stage/journeys/actions",
    async status => {
      const f = completionFixture(status);
      expect(await f.invoke(40, 99)).toMatchObject({
        status: "completed",
        completedAt: expect.any(Date),
      });
      expect(f.enrollment.status).toBe("completed");
      expect(f.profile).toEqual({
        userId: 20,
        trainingStage: "Training",
        academyAcceleratorStartedAt: null,
      });
      expect(f.journeys).not.toHaveBeenCalled();
      expect(f.actions).not.toHaveBeenCalled();
      expect(f.writes.map(write => write.table)).toEqual([
        schema.academyEnrollments,
      ]);
      expect(f.writes[0].values).toMatchObject({
        completionOutcomeAppliedAt: expect.any(Date),
      });
      expect(f.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 20,
          message: "You have completed Synthetic Academy.",
        })
      );
      expect(f.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 20,
          actorId: 99,
          enrollmentId: 40,
          action: "completed",
          summary: "Completed Synthetic Academy",
        })
      );
      expect(f.email).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "course_completed", agentId: 20 })
      );
      expect(f.events.indexOf("read:business_staff_memberships")).toBeLessThan(
        f.events.indexOf("update:academy_enrollments")
      );
      expect(
        ormQuery(
          f.reads.find(read => read.table === schema.businessStaffMemberships)!
            .predicate
        ).params
      ).toEqual([20]);
    }
  );

  it("ordinary Training agents still enter Accelerator after required lessons, despite an unfinished optional lesson", async () => {
    const f = completionFixture(null);
    await f.invoke(40, 99);
    expect(f.profile.trainingStage).toBe("Agent Accelerator");
    expect(f.journeys).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 20,
        actorId: 99,
        startedAt: expect.any(Date),
      })
    );
    expect(f.actions).toHaveBeenCalledWith(20, 99);
    expect(f.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "Completed JLT Academy and moved to Agent Accelerator",
      })
    );
  });

  it("a missing required lesson never applies completion or outcomes, even with unrelated completed progress", async () => {
    const f = completionFixture("active", false);
    expect(await f.invoke(40, 99)).toMatchObject({ status: "in_progress" });
    expect(f.writes).toEqual([]);
    for (const effect of [f.journeys, f.actions, f.notify, f.audit, f.email])
      expect(effect).not.toHaveBeenCalled();
    expect(
      f.reads.some(read => read.table === schema.businessStaffMemberships)
    ).toBe(false);
  });
});

describe("merge retained identity scope", () => {
  it("loads minimal owner OR employee relationships on both identities and blocks a revoked-only actual merge plan", async () => {
    const users = [10, 20].map(id => ({
      id,
      role: "agent",
      name: `Synthetic ${id}`,
      email: `${id}@example.test`,
      commissionRatePct: "70.00",
      portalStatus: "active",
    }));
    const columns: Record<string, string[]> = {
      users: ["id", "role"],
      agent_record_merges: ["id"],
      agent_crm_profiles: ["id", "userId"],
      business_staff_memberships: [
        "id",
        "ownerUserId",
        "staffUserId",
        "status",
      ],
    };
    const links = [membership({ status: "revoked" })];
    const query = vi.fn(
      async (statement: string, params?: number[]): Promise<any> => {
        if (statement.includes("information_schema.COLUMNS"))
          return [
            Object.entries(columns).flatMap(([tableName, names]) =>
              names.map(columnName => ({ tableName, columnName }))
            ),
            [],
          ];
        if (statement.includes("information_schema.STATISTICS"))
          return [[], []];
        if (statement.startsWith("SELECT * FROM users")) return [users, []];
        if (statement.startsWith("SELECT * FROM agent_record_merges"))
          return [[], []];
        if (statement.includes("FROM `agent_crm_profiles`"))
          return [
            users.map(user => ({
              id: user.id + 100,
              userId: user.id,
              uniqueAgentId: `JLT-${user.id}`,
            })),
            [],
          ];
        if (
          statement ===
          "SELECT id,ownerUserId,staffUserId,status FROM business_staff_memberships WHERE ownerUserId IN (?, ?) OR staffUserId IN (?, ?) ORDER BY id LIMIT 10001 FOR UPDATE"
        ) {
          expect(params).toEqual([20, 10, 20, 10]);
          return [links, []];
        }
        throw new Error(`Unexpected offline SQL: ${statement}`);
      }
    );
    const loaded = await loadMergeScope({ query }, 20, 10, true);
    expect(loaded.rows.get("business_staff_memberships")).toEqual(links);
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "synthetic-offline-merge-signing-secret";
    try {
      expect(
        buildMergePlan(
          {
            ...loaded,
            rows: new Map(
              [...loaded.rows].filter(
                ([name]) => name !== "business_staff_memberships"
              )
            ),
          },
          99
        ).preview.canMerge
      ).toBe(true);
      const plan = buildMergePlan(loaded, 99);
      expect(plan.preview.canMerge).toBe(false);
      expect(plan.preview.blockers).toEqual([
        expect.stringMatching(/preserved business-staff relationships/),
      ]);
      expect(links).toEqual([membership({ status: "revoked" })]);
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
    expect(
      query.mock.calls.every(([statement]) => statement.startsWith("SELECT"))
    ).toBe(true);
    expect(guards.pool).not.toHaveBeenCalled();
  });
});

describe("membership cohort SQL STRUCTURE only (no MySQL execution or database simulation)", () => {
  it("compiled actual base query excludes only staff without positive CRM/payment evidence, never blanket-filters retained IDs", async () => {
    const base = issueBase({
      ...schema,
      accounts: schema.membershipPaymentAccounts,
      obligations: schema.membershipPaymentObligations,
      fees: schema.membershipPaymentFees,
      inbox: schema.membershipPaymentInbox,
      outbox: schema.membershipPaymentOutbox,
      settlements: schema.membershipPaymentSettlements,
      sql,
      getArchivedAgentMergeIds: async () => [],
      DIRECT_DEBIT_CONCERN_MEMBERSHIP_STATUSES,
    });
    const compiled = dialect.sqlToQuery(await base()).sql.replace(/\s+/g, " ");
    const start = compiled.indexOf(
      "AND (NOT EXISTS (SELECT 1 FROM `business_staff_memberships`"
    );
    expect(start).toBeGreaterThan(-1);
    const guard = compiled.slice(start);
    expect(guard).toContain("bsm.staffUserId = `users`.`id`)");
    expect(guard).toContain(
      "OR `agent_crm_profiles`.`userId` IS NOT NULL OR `membership_payment_accounts`.`userId` IS NOT NULL"
    );
    for (const [table, alias] of [
      ["gc_mandates", "bm"],
      ["gc_subscriptions", "bs"],
      ["membership_payment_obligations", "bo"],
      ["membership_payment_fees", "bf"],
      ["membership_payment_inbox", "bi"],
      ["membership_payment_outbox", "bx"],
      ["membership_payment_settlements", "bst"],
    ]) {
      expect(guard).toContain(
        `OR EXISTS (SELECT 1 FROM \`${table}\` ${alias} WHERE ${alias}.userId = \`users\`.\`id\`)`
      );
    }
    expect(guard).not.toMatch(/bsm\.(?:status|ownerUserId)/);
    expect(guard).not.toMatch(/NOT IN|AND NOT EXISTS/);
    expect(guards.getDb).not.toHaveBeenCalled();
  });
});
