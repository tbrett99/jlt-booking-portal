import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { eq, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { agentCrmProfiles, joinSessions, users } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({
  pool: {},
  createPool: vi.fn(),
  makeDatabase: vi.fn(),
}));
vi.mock("mysql2/promise", () => ({ default: { createPool: mocks.createPool } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: mocks.makeDatabase }));
import { createAgentUser } from "./db";

const input = {
  name: "Synthetic Agent",
  email: "  Agent@Example.Test  ",
  hashedPassword: "synthetic-password-hash",
  phone: "+440000000000",
};
const duplicateMessage = "An account already exists for this email. No duplicate account was created.";
type Row = { id: number; email: string | null; openId?: string; [key: string]: unknown };
let rows: Row[];
let trace: string[];
let predicates: Array<{ sql: string; params: unknown[] }>;
let readbackFailure: "missing" | "reject" | undefined;
let insertFailure: Error | undefined;
let tx: ReturnType<typeof transactionConnection>;
const dialect = new MySqlDialect();

// Outer-connection reads/writes intentionally fail: every operation must use tx.
const database = {
  select: vi.fn(() => { throw new Error("Unexpected read outside transaction"); }),
  insert: vi.fn(() => { throw new Error("Unexpected insert outside transaction"); }),
  update: vi.fn(() => { throw new Error("Unexpected update outside transaction"); }),
  transaction: vi.fn(),
};
function transactionConnection() {
  return {
    select: vi.fn(() => {
      let predicate: { sql: string; params: unknown[] };
      const chain = {
        from: vi.fn((table: unknown) => { expect(table).toBe(users); return chain; }),
        where: vi.fn((condition: SQL) => {
          predicate = dialect.sqlToQuery(condition);
          predicates.push(predicate);
          return chain;
        }),
        // Identity scan must not have a LIMIT; readback must use original openId.
        for: vi.fn(async (mode: string) => {
          expect(mode).toBe("update");
          expect(predicate.sql).toBe("LOWER(TRIM(`users`.`email`)) = ?");
          expect(predicate.params).toEqual(["agent@example.test"]);
          trace.push("locking-read");
          return rows.filter(row => row.email?.trim().toLowerCase() === predicate.params[0]);
        }),
        limit: vi.fn(async (limit: number) => {
          expect(limit).toBe(1);
          expect(predicate.sql).toBe("`users`.`openId` = ?");
          trace.push("readback");
          if (readbackFailure === "reject") throw new Error("Synthetic readback failure");
          if (readbackFailure === "missing") return [];
          return rows.filter(row => row.openId === predicate.params[0]).slice(0, limit);
        }),
      };
      return chain;
    }),
    insert: vi.fn((table: unknown) => {
      expect(table).toBe(users);
      return { values: vi.fn(async (value: Record<string, unknown>) => {
        trace.push("insert");
        if (insertFailure) throw insertFailure;
        // Represent defaults in the test database, not in the production payload.
        rows.push({ id: 8001, email: null, portalStatus: "onboarding", ...value });
      }) };
    }),
    update: vi.fn(() => { throw new Error("Existing accounts must never be updated"); }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = []; trace = []; predicates = [];
  readbackFailure = undefined; insertFailure = undefined;
  tx = transactionConnection();
  mocks.createPool.mockReturnValue(mocks.pool);
  mocks.makeDatabase.mockReturnValue(database);
  vi.stubEnv("DATABASE_URL", "mysql://mock-only/mock");
  database.transaction.mockImplementation(async (work: (connection: typeof tx) => Promise<unknown>, config: unknown) => {
    expect(config).toEqual({ isolationLevel: "serializable" });
    const snapshot = structuredClone(rows);
    trace.push("begin");
    try {
      const result = await work(tx);
      trace.push("commit");
      return result;
    } catch (error) {
      rows = snapshot;
      trace.push("rollback");
      throw error;
    }
  });
});
afterEach(() => vi.unstubAllEnvs());

function expectNoWrites() {
  expect(tx.insert).not.toHaveBeenCalled();
  expect(tx.update).not.toHaveBeenCalled();
  expect(database.select).not.toHaveBeenCalled();
  expect(database.insert).not.toHaveBeenCalled();
  expect(database.update).not.toHaveBeenCalled();
}

describe("createAgentUser identity boundary (mock database only)", () => {
  it("locks the normalized email, inserts and reads back on the same SERIALIZABLE transaction", async () => {
    const user = await createAgentUser(input);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "serializable" });
    expect(trace).toEqual(["begin", "locking-read", "insert", "readback", "commit"]);
    expect(tx.select).toHaveBeenCalledTimes(2);
    const identityScan = tx.select.mock.results[0].value;
    expect(identityScan.for).toHaveBeenCalledWith("update");
    expect(identityScan.limit).not.toHaveBeenCalled();
    expect(user).toMatchObject({
      id: 8001, name: input.name, email: "agent@example.test", tempPassword: input.hashedPassword,
      phone: input.phone, role: "agent", isActive: true, loginMethod: "password",
      mustChangePassword: true, portalStatus: "onboarding",
    });
    expect(user.openId).toMatch(/^agent_\d+_[a-z0-9]+$/);
    expect(user.lastSignedIn).toBeInstanceOf(Date);
    const payload = tx.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(payload).not.toHaveProperty("portalStatus"); // Preserve schema onboarding default.
    expect(predicates[1].params).toEqual([user.openId]);
    expect(database.select).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("preserves an omitted phone as null", async () => {
    const { phone: _phone, ...withoutPhone } = input;
    expect(await createAgentUser(withoutPhone)).toMatchObject({ phone: null });
  });

  it("matches the entire normalized email, not unrelated addresses or null", async () => {
    rows.push({ id: 1, email: "other@example.test" }, { id: 2, email: "xagent@example.test" },
      { id: 3, email: "agent@example.test.extra" }, { id: 4, email: null });
    const original = structuredClone(rows);
    await createAgentUser(input);
    expect(rows.slice(0, 4)).toEqual(original);
    expect(rows).toHaveLength(5);
  });

  it.each([
    { label: "mixed case", email: "AGENT@EXAMPLE.TEST", role: "agent", isActive: true },
    { label: "surrounding spaces", email: "  Agent@Example.Test  ", role: "agent", isActive: true },
    { label: "inactive/archived", email: "agent@example.test", role: "agent", isActive: false },
    { label: "admin", email: "agent@example.test", role: "admin", isActive: true },
    { label: "super admin", email: "agent@example.test", role: "super_admin", isActive: true },
  ])("refuses any existing $label account without reusing or changing it", async existing => {
    const { label: _label, ...record } = existing;
    rows.push({ id: 41, openId: "existing-account", ...record });
    const original = structuredClone(rows);
    await expect(createAgentUser(input)).rejects.toThrow(new Error(duplicateMessage));
    expectNoWrites();
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(rows).toEqual(original);
    expect(trace).toEqual(["begin", "locking-read", "rollback"]);
    expect(duplicateMessage).not.toContain("agent@example.test");
  });

  it("refuses multiple matching records rather than selecting or assigning an owner", async () => {
    rows.push({ id: 41, email: "Agent@Example.Test" }, { id: 42, email: " AGENT@EXAMPLE.TEST " });
    await expect(createAgentUser(input)).rejects.toThrow(duplicateMessage);
    expectNoWrites();
    expect(rows.map(row => row.id)).toEqual([41, 42]);
    expect(tx.select.mock.results[0].value.limit).not.toHaveBeenCalled();
  });

  it.each(["missing", "reject"] as const)("rejects and rolls back when readback is %s", async failure => {
    readbackFailure = failure;
    await expect(createAgentUser(input)).rejects.toThrow(failure === "missing"
      ? "Account creation could not be verified. No account was created."
      : "Synthetic readback failure");
    expect(rows).toEqual([]);
    expect(trace).toEqual(["begin", "locking-read", "insert", "readback", "rollback"]);
  });

  it("propagates a unique-key collision and rolls back without reading back or reusing a user", async () => {
    insertFailure = Object.assign(new Error("Synthetic unique collision"), { code: "ER_DUP_ENTRY" });
    await expect(createAgentUser(input)).rejects.toBe(insertFailure);
    expect(rows).toEqual([]);
    expect(trace).toEqual(["begin", "locking-read", "insert", "rollback"]);
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "missing-at.example.test", "agent@", "@example.test", "agent@example", "agent name@example.test", `${"a".repeat(310)}@example.test`])(
    "rejects invalid input %j before opening a transaction or inserting", async email => {
      await expect(createAgentUser({ ...input, email })).rejects.toThrow("A valid email address is required.");
      expect(database.transaction).not.toHaveBeenCalled();
      expectNoWrites();
      expect(rows).toEqual([]);
    },
  );

  it("stops the actual webhook creation block after a manual recovery commits despite its stale unlinked session", async () => {
    // Snapshot read before manual recovery: webhook believes no account is linked.
    const staleSession = { id: 9001, userId: null, email: input.email, signerName: input.name, membershipTier: "business_class" };
    // Recovery commits a user and session link before the webhook reaches createAgentUser.
    rows.push({ id: 7001, email: "agent@example.test", openId: "manual-recovered-account", role: "agent" });
    const persistedSession = { ...staleSession, userId: 7001 };
    const originalRows = structuredClone(rows);
    const source = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");
    const start = source.indexOf("          // Create the agent user account");
    const end = source.indexOf("          // Auto-link team:", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain("await createAgentUser(");
    expect(block).toContain("db.insert(agentCrmProfiles)");
    const downstreamDb = { update: vi.fn(), insert: vi.fn() };
    const generateUniqueAgentIdForUser = vi.fn();
    const logger = { error: vi.fn() };
    const symbols = {
      sessions: [staleSession], createAgentUser, db: downstreamDb,
      bcrypt: { hash: vi.fn().mockResolvedValue(input.hashedPassword) },
      generateUniqueAgentIdForUser, joinSessions, agentCrmProfiles, eq, console: logger,
    };
    // Execute only the source-backed creation block; never import/start the server.
    const compiled = ts.transpileModule(`async function run() { for (const session of sessions) { ${block} } }`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const run = new Function(...Object.keys(symbols), `${compiled}\nreturn run;`)(...Object.values(symbols));
    await run();
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), duplicateMessage);
    expect(downstreamDb.update).not.toHaveBeenCalled(); // No stale session overwrite.
    expect(downstreamDb.insert).not.toHaveBeenCalled(); // No second CRM profile.
    expect(generateUniqueAgentIdForUser).not.toHaveBeenCalled();
    expectNoWrites();
    expect(rows).toEqual(originalRows);
    expect(persistedSession.userId).toBe(7001);
    expect(staleSession.userId).toBeNull();
    expect(trace).toEqual(["begin", "locking-read", "rollback"]);
  });
});
