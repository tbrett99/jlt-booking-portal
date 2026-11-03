import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { COOKIE_NAME } from "@shared/const";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), createPool: vi.fn(), drizzle: vi.fn(),
  select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  rows: [] as any[],
}));
vi.mock("mysql2/promise", () => ({ default: { createPool: mocks.createPool } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: mocks.drizzle }));
vi.mock("./_core/env", () => ({ ENV: {
  cookieSecret: "offline-merge-test-only-secret-not-a-real-secret",
  appId: "offline-tests", ownerOpenId: "none", oAuthServerUrl: "",
} }));

let db: typeof import("./db");
let identity: typeof import("./agent-merge-identity");
let sdk: typeof import("./_core/sdk")["sdk"];
let crm: typeof import("./agent-crm-db");
let correspondence: typeof import("./agent-correspondence");
const primary = { id: 10, openId: "agent_primary", email: "same@example.test", name: "Primary", tempPassword: "PRIMARY-ONLY", isActive: true, portalStatus: "active", role: "agent" };
const secondary = { id: 20, openId: "agent_secondary", email: primary.email, name: "Secondary", tempPassword: "SECONDARY-ONLY", isActive: true, portalStatus: "active", role: "agent" };

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "mock://no-real-database");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.rows = [];
  mocks.execute.mockResolvedValue([[{ sourceUserId: 20, primaryUserId: 10 }], []]);
  mocks.createPool.mockReturnValue({ execute: mocks.execute });
  const chain: any = {};
  for (const method of ["from", "where", "limit", "orderBy", "leftJoin", "innerJoin"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: any, reject: any) => Promise.resolve(mocks.rows).then(resolve, reject);
  mocks.select.mockReturnValue(chain);
  mocks.drizzle.mockReturnValue({ select: mocks.select, insert: mocks.insert, update: mocks.update, delete: mocks.delete });
  db = await import("./db");
  identity = await import("./agent-merge-identity");
  sdk = (await import("./_core/sdk")).sdk;
  crm = await import("./agent-crm-db");
  correspondence = await import("./agent-correspondence");
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  // Every raw SQL operation is a mock and must be read-only and table-scoped.
  for (const [query] of mocks.execute.mock.calls) {
    expect(query).toBe("SELECT sourceUserId, primaryUserId FROM agent_record_merges");
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("immutable additive identity reads", () => {
  it("returns no alias for a primary and resolves historical source chains only", async () => {
    mocks.execute.mockResolvedValue([[{ sourceUserId: 30, primaryUserId: 20 }, { sourceUserId: 20, primaryUserId: 10 }], []]);
    expect(await identity.getAgentMergeTarget(10)).toBeNull();
    expect(await identity.getAgentMergeTarget(30)).toBe(10);
    expect(await identity.getArchivedAgentMergeIds()).toEqual([30, 20]);
    expect(await identity.getAgentMergeHistoryIds(10)).toEqual([10, 30, 20]);
    await expect(identity.assertAgentNotMerged(30)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(identity.assertAgentNotMerged(10)).resolves.toBeUndefined();
  });
  it("tolerates only the exact missing additive table error during rolling deployment", async () => {
    mocks.execute.mockRejectedValue({ code: "ER_NO_SUCH_TABLE" });
    expect(await identity.getAgentMergeTarget(20)).toBeNull();
    expect(await identity.getArchivedAgentMergeIds()).toEqual([]);
    expect(await identity.getAgentMergeHistoryIds(10)).toEqual([10]);
  });
  it.each(["ER_BAD_FIELD_ERROR", "ER_TABLEACCESS_DENIED_ERROR", "ECONNREFUSED", "ER_NO_SUCH_TABLE_OTHER"])("fails closed on %s", async (code) => {
    mocks.execute.mockRejectedValue({ code });
    await expect(identity.assertAgentNotMerged(20)).rejects.toEqual({ code });
  });
  it("does not disguise pool failures as migration fallback", async () => {
    mocks.createPool.mockImplementation(() => { throw new Error("offline pool failure"); });
    await expect(identity.getArchivedAgentMergeIds()).rejects.toThrow("Database unavailable");
  });
  it.each([
    [{ sourceUserId: 20, primaryUserId: 20 }],
    [{ sourceUserId: 20, primaryUserId: 10 }, { sourceUserId: 10, primaryUserId: 20 }],
  ])("rejects cycles rather than canonicalizing login", async (...rows) => {
    mocks.execute.mockResolvedValue([rows, []]);
    await expect(identity.getAgentMergeTarget(20)).rejects.toThrow("Cycle");
  });
});

describe("archived source mutation guards", () => {
  const cases = [
    ["activate", () => db.activatePortalAccess(20)],
    ["toggle active", () => db.toggleUserActive(20, true)],
    ["toggle inactive", () => db.toggleUserActive(20, false)],
    ["delete", () => db.deleteUser(20)],
    ["role", () => db.updateUserRole(20, "admin")],
    ["password", () => db.updateUserPassword(20, "new")],
    ["credentials", () => db.markCredentialsSent(20)],
    ["profile", () => db.updateUserProfile(20, { email: "changed@example.test" })],
    ["reset token", () => db.createPasswordResetToken(20, "token", new Date())],
    ["CRM profile", () => crm.upsertAgentCrmProfile(20, { agentStatus: "active" })],
  ] as const;
  it.each(cases)("blocks %s before any write", async (_name, mutate) => {
    await expect(mutate()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("prevents OAuth/session upsert from updating archive original profile", async () => {
    mocks.rows = [secondary];
    await expect(db.upsertUser({ openId: secondary.openId, email: "new@example.test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("never falls back to sending correspondence to an archive", async () => {
    await expect(correspondence.resolveAgentCorrespondence({ userId: 20, fallbackEmail: "fallback@example.test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("keeps unmerged user writes functional", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    mocks.update.mockReturnValue({ set });
    await db.toggleUserActive(10, true);
    expect(set).toHaveBeenCalledWith({ isActive: true });
  });
});

describe("login identity separation", () => {
  it("selects primary sharing email even when archive appears first; registration remains unchanged", async () => {
    mocks.rows = [secondary, primary];
    expect(await db.getUserForLoginByEmail(primary.email)).toBe(primary);
    expect((await db.getUserForLoginByEmail(primary.email))?.tempPassword).toBe("PRIMARY-ONLY");
    expect(await db.getUserByEmail(primary.email)).toBe(secondary);
  });
  it("rejects nonarchive duplicate ambiguity, even if one candidate is inactive", async () => {
    mocks.rows = [primary, { ...primary, id: 40, isActive: false }, secondary];
    expect(await db.getUserForLoginByEmail(primary.email)).toBeUndefined();
  });
  it("does not authorize source-only email through its primary target", async () => {
    mocks.rows = [{ ...secondary, email: "source-only@example.test" }];
    expect(await db.getUserForLoginByEmail("source-only@example.test")).toBeUndefined();
  });
  it("removes archives from user and CRM dropdown lists without altering profiles", async () => {
    mocks.rows = [secondary, primary];
    expect(await db.getAllUsers()).toEqual([primary]);
    expect((await crm.listAgentsWithCrm()).map((user) => user.id)).toEqual([10]);
    expect(secondary.email).toBe(primary.email);
    expect(secondary.openId).toBe("agent_secondary");
  });
  it("blocks a still-valid active secondary JWT before lastSignedIn write, without primary impersonation", async () => {
    mocks.rows = [secondary];
    const token = await sdk.signSession({ openId: secondary.openId, appId: "offline-tests", name: secondary.name });
    expect(await sdk.verifySession(token)).toMatchObject({ openId: secondary.openId });
    await expect(sdk.authenticateRequest({ headers: { cookie: `${COOKIE_NAME}=${token}` } } as Request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuses new session issuance for archived original openId", async () => {
    mocks.rows = [secondary];
    await expect(sdk.createSessionToken(secondary.openId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps primary session issuance on its original openId", async () => {
    mocks.rows = [primary];
    const token = await sdk.createSessionToken(primary.openId);
    expect(await sdk.verifySession(token)).toMatchObject({ openId: primary.openId });
  });
});
