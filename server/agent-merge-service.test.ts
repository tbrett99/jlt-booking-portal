import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MERGE_OWNERS, identifiersValid, makeMergeToken, mergeDigest, uniqueCollision, verifyMergeToken, type Row } from "./agent-merge-policy";
import * as service from "./agent-merge-service";
import { agentMergeRouter } from "./agent-merge-router";
import type { TrpcContext } from "./_core/context";

const guards = vi.hoisted(() => ({
  pool: vi.fn(() => { throw new Error("Real database access forbidden"); }),
  imported: vi.fn((name: string) => { throw new Error(`Side-effect module imported: ${name}`); }),
}));
vi.mock("./db", () => ({ getRawDbPool: guards.pool }));
vi.mock("./email", () => { guards.imported("email"); return {}; });
vi.mock("./resend-email", () => { guards.imported("resend-email"); return {}; });
vi.mock("./gocardless", () => { guards.imported("gocardless"); return {}; });
vi.mock("./gocardless-db", () => { guards.imported("gocardless-db"); return {}; });
vi.mock("./membership-payment-service", () => { guards.imported("membership-payment-service"); return {}; });
vi.mock("./payment-failure-notices", () => { guards.imported("payment-failure-notices"); return {}; });
vi.mock("mysql2/promise", () => { guards.imported("mysql2/promise"); return {}; });

const SOURCE = 20, PRIMARY = 10, ACTOR = 99;
const NOW = new Date("2026-01-15T12:00:00.000Z").getTime();
const STAMP = new Date("2025-12-01T09:15:30.123Z");
const SECRET = "offline-merge-test-only-signing-secret";
type Loaded = Awaited<ReturnType<typeof service.loadMergeScope>>;
const copy = <T,>(value: T): T => structuredClone(value);

function addTable(loaded: Loaded, table: string, records: Row[], keys: string[][] = []) {
  const policy = MERGE_OWNERS.find(p => p.table === table);
  loaded.tables.set(table, new Set(["id", ...(policy ? [policy.owner] : []), ...records.flatMap(r => Object.keys(r))]));
  loaded.rows.set(table, copy(records));
  loaded.uniqueKeys.set(table, keys);
  return loaded;
}

function fixture(): Loaded {
  const user = (id: number) => ({
    id, name: id === PRIMARY ? "Primary Agent" : "Duplicate Agent", email: `${id}@example.test`,
    role: "agent", commissionRatePct: "70.00", isActive: 1, crmAccess: 1, portalStatus: "active",
    lastSignedIn: STAMP, createdAt: STAMP, updatedAt: STAMP,
    // Synthetic authentication values must never enter persisted identity snapshots.
    openId: `offline-original-${id}`, tempPassword: `offline-password-${id}`,
  });
  const loaded: Loaded = {
    source: user(SOURCE), primary: user(PRIMARY), aliases: [],
    control: { id: 1, enabled: 0, syncLockedUntil: null },
    tables: new Map(), rows: new Map(), uniqueKeys: new Map(),
  };
  addTable(loaded, "users", [loaded.primary, loaded.source]);
  addTable(loaded, "agent_record_merges", []);
  addTable(loaded, "agent_crm_profiles", [SOURCE, PRIMARY].map((userId, index) => ({
    id: 30 + index, userId, uniqueAgentId: `JLT-${userId}`, agentStatus: "active", teamId: 7,
    paymentExempt: 0, bankAccountName: "Verified Same Person", bankSortCode: "000000",
    bankAccountNumber: "00000000", internalNotes: `original-${userId}`, updatedAt: STAMP,
  })), [["userId"]]);
  addTable(loaded, "bookings", []);
  addTable(loaded, "gc_mandates", []);
  addTable(loaded, "gc_subscriptions", []);
  addTable(loaded, "membership_payment_accounts", []);
  addTable(loaded, "membership_payment_control", [loaded.control!]);
  return loaded;
}

function providers(loaded: Loaded) {
  addTable(loaded, "gc_mandates", [SOURCE, PRIMARY].map((userId, index) => ({
    id: 201 + index, userId, mandateId: "MD-SAME", status: "active", preferredPaymentDay: 5, updatedAt: STAMP,
  })), [["id"]]);
  addTable(loaded, "gc_subscriptions", [SOURCE, PRIMARY].map((userId, index) => ({
    id: 211 + index, userId, subscriptionId: "SB-SAME", mandateId: "MD-SAME", amount: 8700,
    currency: "GBP", dayOfMonth: 5, startDate: "2025-01-05", status: "active", updatedAt: STAMP,
  })), [["id"]]);
  for (const table of ["gc_mandates", "gc_subscriptions"]) loaded.rows.set(`${table}:owners`, copy(loaded.rows.get(table)!));
  return loaded;
}

function executionFixture() {
  const loaded = fixture();
  addTable(loaded, "bookings", [
    { id: 101, agentId: SOURCE, bookingReference: "SRC-BOOKING", totalPrice: "1234.56", commissionAmount: "86.42", createdBy: SOURCE, status: "confirmed", updatedAt: STAMP },
    { id: 102, agentId: PRIMARY, bookingReference: "PRIMARY-BOOKING", totalPrice: "765.43", commissionAmount: "53.58", createdBy: PRIMARY, status: "confirmed", updatedAt: STAMP },
  ]);
  addTable(loaded, "gc_payment_events", [{
    id: 301, userId: SOURCE, eventId: "EV-ORIGINAL", paymentId: "PM-ORIGINAL", action: "failed", amountPence: 8700,
    currency: "GBP", rawPayload: '{"id":"EV-ORIGINAL","amount":8700,"evidence":"original bytes"}', occurredAt: STAMP, updatedAt: STAMP,
  }]);
  // Present for the pure cache read; absent optional tables are tested separately in loadMergeScope.
  addTable(loaded, "membership_payment_inbox", []);
  addTable(loaded, "academy_enrollments", [
    { id: 401, agentId: SOURCE, courseId: 7, status: "completed", completedAt: STAMP, updatedAt: STAMP },
    { id: 402, agentId: PRIMARY, courseId: 7, status: "in_progress", completedAt: null, updatedAt: STAMP },
  ], [["agentId", "courseId"]]);
  addTable(loaded, "academy_assessment_attempts", [
    { id: 411, enrollmentId: 401, score: 98, passed: true, answers: { original: "source" }, markedBy: 88, updatedAt: STAMP },
    { id: 412, enrollmentId: 402, score: 40, passed: false, answers: { original: "primary" }, markedBy: 89, updatedAt: STAMP },
  ]);
  return loaded;
}

const SQL = {
  columns: "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()",
  indexes: "SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS ordinal FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0 ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
  archive: "UPDATE users SET isActive=0, crmAccess=0, portalStatus='cancelled', suspensionReason=? WHERE id=? AND role='agent'",
  insert: "INSERT INTO agent_record_merges (sourceUserId,primaryUserId,sourceName,sourceEmail,sourceJltId,actorId,actorName,reason,previewDigest,manifestJson,mergedAt) VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))",
  cacheEvents: "SELECT * FROM membership_payment_inbox WHERE userId = ? AND status <> 'ignored' AND paymentId IS NOT NULL ORDER BY occurredAt,eventId",
};

/** Exact SQL allowlist, isolated transaction state, no driver or real pool. */
function connectionFor(loaded: Loaded, options: { failUpdate?: string; corruptEvidence?: boolean; shortUpdate?: boolean } = {}) {
  let state = new Map(Array.from(loaded.rows.entries()).filter(([table]) => !table.endsWith(":owners")).map(([table, records]) => [table, copy(records)]));
  state.set("users", copy([loaded.primary, loaded.source]));
  state.set("agent_record_merges", copy(loaded.aliases));
  let before: Map<string, Row[]> | undefined;
  const present = (table: string) => {
    if (!loaded.tables.has(table)) throw Object.assign(new Error(`Missing offline table ${table}`), { code: "ER_NO_SUCH_TABLE" });
    return state.get(table) ?? [];
  };
  const result = (records: any) => [copy(records), []];
  const connection = {
    records: (table: string) => copy(state.get(table) ?? []),
    beginTransaction: vi.fn(async () => { before = copy(state); }),
    commit: vi.fn(async () => { before = undefined; }),
    rollback: vi.fn(async () => { if (before) state = copy(before); before = undefined; }),
    release: vi.fn(), destroy: vi.fn(),
    query: vi.fn(async (sql: string, args: any[] = []): Promise<any> => {
      if (sql === "SELECT GET_LOCK(?,10) AS acquired") { expect(args).toEqual(["jlt-gc-email-links"]); return result([{ acquired: 1 }]); }
      if (sql === "SELECT RELEASE_LOCK(?) AS released") { expect(args).toEqual(["jlt-gc-email-links"]); return result([{ released: 1 }]); }
      if (sql === "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE" || sql === "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ") return result([]);
      if (sql === SQL.columns) return result(Array.from(loaded.tables).flatMap(([tableName, columns]) => Array.from(columns, columnName => ({ tableName, columnName }))));
      if (sql === SQL.indexes) return result(Array.from(loaded.uniqueKeys).flatMap(([tableName, keys]) => keys.flatMap((columns, index) => columns.map((columnName, position) => ({ tableName, indexName: `unique_${index}`, columnName, ordinal: position + 1 })))));
      if (sql === "SELECT * FROM agent_record_merges WHERE sourceUserId = ? FOR UPDATE") return result(present("agent_record_merges").filter(r => r.sourceUserId === args[0]));
      for (const suffix of ["", " FOR UPDATE"]) {
        if (sql === `SELECT * FROM users WHERE id IN (?, ?) ORDER BY id${suffix}`) return result(present("users").filter(r => args.includes(r.id)).sort((a, b) => a.id - b.id));
        if (sql === `SELECT * FROM agent_record_merges WHERE sourceUserId IN (?, ?) OR primaryUserId = ?${suffix}`) return result(present("agent_record_merges").filter(r => args.slice(0, 2).includes(r.sourceUserId) || r.primaryUserId === args[2]));
        if (sql === `SELECT * FROM membership_payment_control WHERE id = 1${suffix}`) return result(present("membership_payment_control"));
        for (const policy of MERGE_OWNERS) {
          const order = loaded.tables.get(policy.table)?.has("id") ? "id" : policy.owner;
          const selected = `SELECT * FROM \`${policy.table}\` WHERE \`${policy.owner}\` IN (?, ?)${policy.agentRecipient ? " AND recipientType = 'agent'" : ""} ORDER BY \`${order}\` LIMIT 10001${suffix}`;
          if (sql === selected) return result(present(policy.table).filter(r => args.includes(Number(r[policy.owner])) && (!policy.agentRecipient || r.recipientType === "agent")).sort((a, b) => Number(a[order]) - Number(b[order])));
        }
        for (const [table, reference] of [["gc_mandates", "mandateId"], ["gc_subscriptions", "subscriptionId"]]) {
          if (sql === `SELECT * FROM \`${table}\` WHERE \`${reference}\` IN (${args.map(() => "?").join(",")}) ORDER BY id${suffix}`) return result(present(table).filter(r => args.includes(r[reference])).sort((a, b) => a.id - b.id));
        }
      }
      if (sql === "SELECT userId FROM membership_payment_accounts WHERE userId IN (?, ?) ORDER BY userId FOR UPDATE") return result(present("membership_payment_accounts").filter(r => args.includes(r.userId)).map(r => ({ userId: r.userId })));
      if (sql === SQL.insert) {
        const names = ["sourceUserId", "primaryUserId", "sourceName", "sourceEmail", "sourceJltId", "actorId", "actorName", "reason", "previewDigest", "manifestJson"];
        present("agent_record_merges").push({ id: 901, ...Object.fromEntries(names.map((name, index) => [name, args[index]])), mergedAt: new Date(NOW) });
        return result({ affectedRows: 1 });
      }
      if (sql === SQL.archive) {
        expect(args).toEqual([`merged_into:${PRIMARY}`, SOURCE]);
        const source = present("users").find(r => r.id === args[1] && r.role === "agent")!;
        Object.assign(source, { isActive: 0, crmAccess: 0, portalStatus: "cancelled", suspensionReason: args[0] });
        return result({ affectedRows: 1 });
      }
      for (const policy of MERGE_OWNERS.filter(p => p.mode === "move")) {
        const ids = args.slice(1, -1);
        const preserveTime = loaded.tables.get(policy.table)?.has("updatedAt") ? ", updatedAt=updatedAt" : "";
        if (sql === `UPDATE \`${policy.table}\` SET \`${policy.owner}\`=?${preserveTime} WHERE id IN (${ids.map(() => "?").join(",")}) AND \`${policy.owner}\`=?`) {
          if (options.failUpdate === policy.table) throw new Error(`Injected late UPDATE failure: ${policy.table}`);
          const moving = present(policy.table).filter(r => ids.includes(r.id) && r[policy.owner] === args.at(-1));
          for (const row of moving) { row[policy.owner] = args[0]; if (options.corruptEvidence && policy.table === "gc_payment_events") row.rawPayload = "corrupted"; }
          return result({ affectedRows: options.shortUpdate ? 0 : moving.length });
        }
        if (sql === `SELECT * FROM \`${policy.table}\` WHERE id IN (${args.map(() => "?").join(",")}) ORDER BY id`) return result(present(policy.table).filter(r => args.includes(r.id)).sort((a, b) => a.id - b.id));
      }
      if (sql === SQL.cacheEvents) return result(present("membership_payment_inbox").filter(r => r.userId === args[0] && r.status !== "ignored" && r.paymentId != null));
      throw new Error(`Unexpected offline SQL: ${sql}`);
    }),
  };
  return connection;
}

function mergeInput(loaded: Loaded): service.MergeExecution {
  return { sourceUserId: SOURCE, primaryUserId: PRIMARY, previewToken: service.buildMergePlan(loaded, ACTOR).preview.token,
    reason: "Verified duplicate identity; established CRM remains primary.", confirmation: `MERGE ${SOURCE} INTO ${PRIMARY}`,
    samePersonConfirmed: true, primaryChoicesConfirmed: true, archivedLearningConfirmed: true };
}
const actor = { id: ACTOR, name: "Offline Super Admin" };
async function scopedInput(loaded: Loaded): Promise<service.MergeExecution> {
  const scoped = await service.loadMergeScope(connectionFor(loaded), SOURCE, PRIMARY);
  return { ...mergeInput(loaded), previewToken: service.buildMergePlan(scoped, ACTOR).preview.token };
}
const writes = (connection: ReturnType<typeof connectionFor>) => connection.query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT|DELETE)\b/.test(sql));
const evidence = (record: Row, owner: string) => { const { [owner]: _owner, ...protectedFields } = record; return protectedFields; };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JWT_SECRET", SECRET);
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("GOCARDLESS_ACCESS_TOKEN", "");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
});
afterEach(() => {
  expect(guards.pool).not.toHaveBeenCalled();
  expect(guards.imported).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("merge planning and explicit ownership policy", () => {
  it("requires positive, distinct, safe integer identities", () => {
    expect(() => identifiersValid(SOURCE, PRIMARY)).not.toThrow();
    for (const [source, primary] of [[0, PRIMARY], [-1, PRIMARY], [SOURCE, SOURCE], [1.5, PRIMARY], [Number.MAX_SAFE_INTEGER + 1, PRIMARY]]) {
      expect(() => identifiersValid(source, primary)).toThrow("different agent user IDs");
      const loaded = fixture(); loaded.source.id = source; loaded.primary.id = primary;
      expect(() => service.buildMergePlan(loaded, ACTOR)).toThrow();
    }
    expect(service.buildMergePlan(fixture(), ACTOR).preview.canMerge).toBe(true);
  });

  it("moves both provider reference types when duplicate copies belong to exactly source and primary", () => {
    const plan = service.buildMergePlan(providers(fixture()), ACTOR);
    expect(plan.preview.canMerge).toBe(true);
    expect(plan.changes.map(c => [c.policy.table, c.ids])).toEqual([["gc_mandates", [201]], ["gc_subscriptions", [211]]]);
  });

  it.each(["gc_mandates", "gc_subscriptions"])("blocks %s even when a third owner's copy is otherwise identical", (table) => {
    const loaded = providers(fixture());
    loaded.rows.get(`${table}:owners`)!.push({ ...loaded.rows.get(table)![0], id: 999, userId: 77 });
    const preview = service.buildMergePlan(loaded, ACTOR).preview;
    expect(preview.canMerge).toBe(false);
    expect(preview.blockers.join(" ")).toMatch(/another or unverified user/);
  });

  it("holds distinct live subscriptions and contradictory copies rather than choosing latest", () => {
    const loaded = providers(fixture());
    loaded.rows.get("gc_subscriptions:owners")![1].subscriptionId = "SB-OTHER-LIVE";
    expect(service.buildMergePlan(loaded, ACTOR).preview.blockers.join(" ")).toMatch(/more than one distinct current subscription/);
    loaded.rows.get("gc_subscriptions:owners")![1].subscriptionId = "SB-SAME";
    loaded.rows.get("gc_subscriptions:owners")![1].amount = 12700;
    expect(service.buildMergePlan(loaded, ACTOR).preview.blockers.join(" ")).toMatch(/copies of the same subscriptionId disagree/);
  });

  it.each(["commission rate", "bank details", "fee ledger", "outbox", "automation enabled", "automation running"])("blocks unresolved %s", (scenario) => {
    const loaded = providers(fixture());
    const messages: Record<string, RegExp> = { "commission rate": /different commission rates/, "bank details": /payout bank details/,
      "fee ledger": /administration-fee ledger/, outbox: /payment-email idempotency/, "automation enabled": /Pause membership payment automation/, "automation running": /reconciliation is currently running/ };
    if (scenario === "commission rate") loaded.source.commissionRatePct = "80.00";
    if (scenario === "bank details") loaded.rows.get("agent_crm_profiles")![0].bankAccountNumber = "11111111";
    if (scenario === "fee ledger") addTable(loaded, "membership_payment_fees", [{ id: 501, userId: SOURCE, amountPence: 2500 }]);
    if (scenario === "outbox") addTable(loaded, "membership_payment_outbox", [{ id: 502, userId: SOURCE, status: "sent", lockToken: null }]);
    if (scenario === "automation enabled") loaded.control!.enabled = 1;
    if (scenario === "automation running") loaded.control!.syncLockedUntil = new Date(NOW + 60_000);
    const preview = service.buildMergePlan(loaded, ACTOR).preview;
    expect(preview.canMerge).toBe(false);
    expect(preview.blockers.join(" ")).toMatch(messages[scenario]);
  });

  it("retains same-course source evidence with a warning and keeps primary learning state", () => {
    const loaded = executionFixture(), original = copy(loaded.rows);
    const plan = service.buildMergePlan(loaded, ACTOR);
    expect(plan.preview.canMerge).toBe(true);
    expect(plan.preview.retained).toContainEqual(expect.objectContaining({ table: "academy_enrollments", count: 1 }));
    expect(plan.changes.some(c => c.policy.table === "academy_enrollments")).toBe(false);
    expect(plan.preview.warnings.join(" ")).toMatch(/source completion does not automatically complete or unlock/);
    expect(loaded.rows).toEqual(original);
    expect(loaded.rows.get("academy_enrollments")![1].status).toBe("in_progress");
  });

  it("archives every legal/audit policy and excludes all authentication tables from ownership changes", () => {
    const loaded = fixture();
    for (const policy of MERGE_OWNERS.filter(p => p.mode === "archive")) {
      // Source fee/outbox ledgers deliberately block, without ever becoming transfers.
      addTable(loaded, policy.table, [{ id: 601, [policy.owner]: SOURCE, recipientType: "agent", status: "sent", signerId: SOURCE, actorId: SOURCE, updatedAt: STAMP }]);
    }
    const authTables = ["users", "password_reset_tokens", "sso_tokens", "team_invites", "academy_assessment_attempts", "reimbursement_audit_logs", "library_audit_log"];
    const plan = service.buildMergePlan(loaded, ACTOR);
    expect(plan.changes).toEqual([]);
    for (const policy of MERGE_OWNERS.filter(p => p.mode === "archive")) expect(plan.preview.retained).toContainEqual(expect.objectContaining({ table: policy.table, count: 1 }));
    for (const table of authTables) expect(MERGE_OWNERS.some(p => p.table === table && p.mode === "move")).toBe(false);
    for (const table of ["contract_signatures", "terms_signings", "join_sessions", "academy_audit_log", "inbox_audit_logs", "agent_status_events"]) {
      expect(MERGE_OWNERS.find(p => p.table === table)?.mode).toBe("archive");
    }
  });

  it("blocks Momentum identity/action collisions and never blends or doubles awards", () => {
    const loaded = fixture();
    addTable(loaded, "momentum_ledger", [SOURCE, PRIMARY].map((agentId, index) => ({ id: 701 + index, agentId, sourceType: "course", sourceId: 7, points: 25 })), [["agentId", "sourceType", "sourceId"]]);
    const plan = service.buildMergePlan(loaded, ACTOR);
    expect(plan.preview.canMerge).toBe(false);
    expect(plan.preview.blockers.join(" ")).toMatch(/Momentum rewards for the same action\/content/);
    expect(plan.changes.some(c => c.policy.table === "momentum_ledger")).toBe(false);
    expect(uniqueCollision({ agentId: SOURCE, sourceId: null }, { agentId: PRIMARY, sourceId: null }, ["agentId", "sourceId"], "agentId")).toBe(false);
  });

  it("loads a minimal live schema, tolerates absent optional tables, and discovers complete provider owners", async () => {
    const minimal = fixture(), connection = connectionFor(minimal);
    const loaded = await service.loadMergeScope(connection, SOURCE, PRIMARY, true);
    expect(loaded.tables.has("academy_enrollments")).toBe(false);
    expect(loaded.rows.has("gc_mandate_replacements")).toBe(false);
    expect(service.buildMergePlan(loaded, ACTOR).preview.canMerge).toBe(true);
    expect(writes(connection)).toEqual([]);
    const shared = providers(fixture());
    shared.rows.get("gc_mandates")!.push({ ...shared.rows.get("gc_mandates")![0], id: 999, userId: 77 });
    const providerConnection = connectionFor(shared);
    const scoped = await service.loadMergeScope(providerConnection, SOURCE, PRIMARY, true);
    expect(scoped.rows.get("gc_mandates")).toHaveLength(2);
    expect(scoped.rows.get("gc_mandates:owners")).toHaveLength(3);
    expect(service.buildMergePlan(scoped, ACTOR).preview.blockers.join(" ")).toMatch(/another or unverified user/);
    expect(providerConnection.query).toHaveBeenCalledWith("SELECT * FROM `gc_mandates` WHERE `mandateId` IN (?) ORDER BY id FOR UPDATE", ["MD-SAME"]);
  });
});

describe("signed preview freshness and transaction safety", () => {
  it("binds a valid token to source, primary, actor, evidence digest, signature and expiry", () => {
    const expected = { source: SOURCE, primary: PRIMARY, actor: ACTOR, digest: "evidence" };
    const token = makeMergeToken({ ...expected, expiry: NOW + 600_000 }, SECRET);
    expect(() => verifyMergeToken(token, expected, SECRET, NOW)).not.toThrow();
    for (const altered of [{ ...expected, actor: 98 }, { ...expected, source: 21 }, { ...expected, primary: 11 }, { ...expected, digest: "stale" }]) {
      expect(() => verifyMergeToken(token, altered, SECRET, NOW)).toThrow(/changed or the preview expired/);
    }
    expect(() => verifyMergeToken(token, expected, "wrong-signing-secret", NOW)).toThrow(/signature is invalid/);
    expect(() => verifyMergeToken(`${token}.extra`, expected, SECRET, NOW)).toThrow(/Refresh/);
    expect(() => verifyMergeToken(token, expected, SECRET, NOW + 600_000)).toThrow(/preview expired/);
  });

  it.each(["stale", "wrong actor", "signature", "expired"])("rejects %s preview before any writes and rolls back", async (scenario) => {
    const loaded = executionFixture(), input = await scopedInput(loaded);
    let executingActor = actor;
    if (scenario === "stale") loaded.rows.get("bookings")![0].totalPrice = "9999.99";
    if (scenario === "wrong actor") executingActor = { ...actor, id: 98 };
    if (scenario === "signature") input.previewToken = makeMergeToken({ source: SOURCE, primary: PRIMARY, actor: ACTOR, digest: service.buildMergePlan(loaded, ACTOR).digest, expiry: NOW + 600_000 }, "wrong-signing-secret");
    if (scenario === "expired") vi.mocked(Date.now).mockReturnValue(NOW + 600_000);
    const connection = connectionFor(loaded);
    await expect(service.executeAgentMerge(input, executingActor, { connection })).rejects.toThrow(/preview|signature/);
    expect(writes(connection)).toEqual([]);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.query).toHaveBeenLastCalledWith("SELECT RELEASE_LOCK(?) AS released", ["jlt-gc-email-links"]);
  });

  it("moves two evidence records atomically, archives without deletion, retains grades and redacts credential snapshots", async () => {
    const loaded = executionFixture();
    for (const table of ["contract_signatures", "terms_signings", "join_sessions", "academy_audit_log", "agent_status_events", "inbox_audit_logs"]) {
      const policy = MERGE_OWNERS.find(p => p.table === table)!;
      addTable(loaded, table, [{ id: 801, [policy.owner]: SOURCE, signerId: SOURCE, actorId: 88, documentHash: "original-signed-evidence", updatedAt: STAMP }]);
    }
    addTable(loaded, "password_reset_tokens", [{ id: 811, userId: SOURCE, token: "offline-original-reset-token" }]);
    addTable(loaded, "sso_tokens", [{ id: 812, userId: SOURCE, token: "offline-original-sso-token" }]);
    const before = copy(loaded.rows), primaryBefore = copy(loaded.primary), sourceBefore = copy(loaded.source);
    const connection = connectionFor(loaded);
    const plan = service.buildMergePlan(await service.loadMergeScope(connectionFor(loaded), SOURCE, PRIMARY), ACTOR);
    await expect(service.executeAgentMerge(await scopedInput(loaded), actor, { connection })).resolves.toEqual({ success: true, alreadyMerged: false, primaryUserId: PRIMARY });
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.records("users").find(r => r.id === PRIMARY)).toEqual(primaryBefore);
    expect(connection.records("users").find(r => r.id === SOURCE)).toEqual({ ...sourceBefore, isActive: 0, crmAccess: 0, portalStatus: "cancelled", suspensionReason: `merged_into:${PRIMARY}` });
    expect(connection.records("users")).toHaveLength(2);
    const manifest = JSON.parse(connection.records("agent_record_merges")[0].manifestJson);
    expect(manifest.changes.map((c: Row) => [c.table, c.column, c.rows.map((r: Row) => r.id)])).toEqual([["bookings", "agentId", [101]], ["gc_payment_events", "userId", [301]]]);
    expect(connection.records("agent_record_merges")[0].previewDigest).toBe(plan.digest);
    expect(manifest.sourceIdentity).not.toHaveProperty("tempPassword");
    expect(manifest.sourceIdentity).not.toHaveProperty("openId");
    expect(manifest.primaryIdentity).not.toHaveProperty("tempPassword");
    expect(manifest.primaryIdentity).not.toHaveProperty("openId");
    expect(JSON.stringify(manifest)).not.toMatch(/offline-password|offline-original-reset-token|offline-original-sso-token/);
    for (const change of plan.changes) {
      const original = before.get(change.policy.table)!.find(r => r.id === change.ids[0])!;
      const after = connection.records(change.policy.table).find(r => r.id === original.id)!;
      expect(after).toEqual({ ...original, [change.policy.owner]: PRIMARY });
      expect(after.updatedAt).toEqual(STAMP);
      expect(mergeDigest(evidence(after, change.policy.owner))).toBe(change.preserved[0].hash);
      expect(manifest.changes.find((c: Row) => c.table === change.policy.table).rows[0].hash).toBe(change.preserved[0].hash);
      expect(manifest.preservedHashes.find((p: Row) => p.table === change.policy.table).rows.find((r: Row) => r.id === original.id).hash).toBe(mergeDigest(original));
    }
    for (const [table, original] of before) {
      if (["users", "agent_record_merges", "bookings", "gc_payment_events"].includes(table)) continue;
      expect(connection.records(table)).toEqual(original);
      expect(manifest.changes.some((c: Row) => c.table === table)).toBe(false);
    }
    expect(connection.records("bookings")[0].createdBy).toBe(SOURCE);
    expect(connection.records("gc_payment_events")[0].amountPence).toBe(8700);
    expect(connection.records("gc_payment_events")[0].rawPayload).toBe(before.get("gc_payment_events")![0].rawPayload);
    expect(connection.records("academy_assessment_attempts").map(r => r.score)).toEqual([98, 40]);
    expect(writes(connection).map(([sql]) => sql)).toEqual([SQL.insert, SQL.archive,
      "UPDATE `bookings` SET `agentId`=?, updatedAt=updatedAt WHERE id IN (?) AND `agentId`=?",
      "UPDATE `gc_payment_events` SET `userId`=?, updatedAt=updatedAt WHERE id IN (?) AND `userId`=?"]);
  });

  it("executes ownership-only transfer of identical provider copies without creating or cancelling resources", async () => {
    const loaded = providers(fixture());
    addTable(loaded, "membership_payment_inbox", []);
    const connection = connectionFor(loaded);
    await service.executeAgentMerge(await scopedInput(loaded), actor, { connection });
    for (const table of ["gc_mandates", "gc_subscriptions"]) {
      expect(connection.records(table)).toEqual(loaded.rows.get(table)!.map(row => ({ ...row, userId: PRIMARY })));
      expect(connection.records(table)).toHaveLength(2);
    }
    expect(writes(connection)).toHaveLength(4);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("rejects a fresh but financially blocked plan before any history or ownership writes", async () => {
    const loaded = executionFixture();
    addTable(loaded, "membership_payment_fees", [{ id: 501, userId: SOURCE, amountPence: 2500 }]);
    addTable(loaded, "membership_payment_outbox", [{ id: 502, userId: SOURCE, status: "sent" }]);
    const connection = connectionFor(loaded);
    await expect(service.executeAgentMerge(await scopedInput(loaded), actor, { connection })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(writes(connection)).toEqual([]);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("rolls back history insertion, archival and first ownership move after a late UPDATE error", async () => {
    const loaded = executionFixture(), before = copy(loaded.rows), connection = connectionFor(loaded, { failUpdate: "gc_payment_events" });
    await expect(service.executeAgentMerge(await scopedInput(loaded), actor, { connection })).rejects.toThrow("Injected late UPDATE failure");
    expect(connection.query).toHaveBeenCalledWith("UPDATE `bookings` SET `agentId`=?, updatedAt=updatedAt WHERE id IN (?) AND `agentId`=?", [PRIMARY, 101, SOURCE]);
    expect(connection.query).toHaveBeenCalledWith("SELECT * FROM `bookings` WHERE id IN (?) ORDER BY id", [101]);
    expect(connection.query).toHaveBeenCalledWith("UPDATE `gc_payment_events` SET `userId`=?, updatedAt=updatedAt WHERE id IN (?) AND `userId`=?", [PRIMARY, 301, SOURCE]);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    for (const [table, original] of before) expect(connection.records(table)).toEqual(original);
    expect(connection.records("agent_record_merges")).toEqual([]);
  });

  it.each(["protected evidence", "affected row count"])("rolls back on changed %s instead of committing a partial merge", async (scenario) => {
    const loaded = executionFixture(), before = copy(loaded.rows);
    const connection = connectionFor(loaded, { corruptEvidence: scenario === "protected evidence", shortUpdate: scenario === "affected row count" });
    await expect(service.executeAgentMerge(await scopedInput(loaded), actor, { connection })).rejects.toThrow(/entire merge was rolled back/);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    for (const [table, original] of before) expect(connection.records(table)).toEqual(original);
  });

  it("repeating an existing same mapping is idempotent and issues no second INSERT or UPDATE", async () => {
    const loaded = executionFixture(), input = await scopedInput(loaded), connection = connectionFor(loaded);
    await service.executeAgentMerge(input, actor, { connection });
    const firstWrites = writes(connection).length, firstUsers = connection.records("users"), firstBookings = connection.records("bookings");
    // Even an obsolete preview is irrelevant to an already-completed identical mapping.
    input.previewToken = "obsolete-offline-preview";
    await expect(service.executeAgentMerge(input, actor, { connection })).resolves.toEqual({ success: true, alreadyMerged: true, primaryUserId: PRIMARY });
    expect(writes(connection)).toHaveLength(firstWrites);
    expect(connection.records("agent_record_merges")).toHaveLength(1);
    expect(connection.records("users")).toEqual(firstUsers);
    expect(connection.records("bookings")).toEqual(firstBookings);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("refuses an existing mapping to a different primary without updates", async () => {
    const loaded = executionFixture(); loaded.aliases = [{ id: 901, sourceUserId: SOURCE, primaryUserId: 77 }];
    const connection = connectionFor(loaded);
    await expect(service.executeAgentMerge(mergeInput(loaded), actor, { connection })).rejects.toThrow(/different primary/);
    expect(writes(connection)).toEqual([]);
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe("server merge authorization with mocked service functions", () => {
  function caller(role: "admin" | "super_admin") {
    return agentMergeRouter.createCaller({ user: { id: ACTOR, name: actor.name, role }, req: {}, res: {} } as unknown as TrpcContext);
  }
  it("blocks a normal admin from both preview and execution before calling the service", async () => {
    const preview = vi.spyOn(service, "previewAgentMerge").mockResolvedValue(service.buildMergePlan(fixture(), ACTOR).preview);
    const execute = vi.spyOn(service, "executeAgentMerge").mockResolvedValue({ success: true, alreadyMerged: false, primaryUserId: PRIMARY });
    await expect(caller("admin").preview({ sourceUserId: SOURCE, primaryUserId: PRIMARY })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("admin").execute(mergeInput(fixture()))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(preview).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("permits a super admin and passes the actual operator identity to mocked functions", async () => {
    const loaded = fixture(), expected = service.buildMergePlan(loaded, ACTOR).preview, input = mergeInput(loaded);
    const preview = vi.spyOn(service, "previewAgentMerge").mockResolvedValue(expected);
    const execute = vi.spyOn(service, "executeAgentMerge").mockResolvedValue({ success: true, alreadyMerged: false, primaryUserId: PRIMARY });
    await expect(caller("super_admin").preview({ sourceUserId: SOURCE, primaryUserId: PRIMARY })).resolves.toEqual(expected);
    await expect(caller("super_admin").execute(input)).resolves.toEqual({ success: true, alreadyMerged: false, primaryUserId: PRIMARY });
    expect(preview).toHaveBeenCalledWith(SOURCE, PRIMARY, ACTOR);
    expect(execute).toHaveBeenCalledWith(input, actor);
  });
});
