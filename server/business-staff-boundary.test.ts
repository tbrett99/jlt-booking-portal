import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  agentCrmProfiles, agentRecordMerges, businessStaffMemberships, staffRoleAssignments, users, type User,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const external = vi.hoisted(() => ({ getDb: vi.fn(), model: vi.fn(), secret: "synthetic-business-staff-prelink-jwt-secret" }));
vi.mock("./db", () => ({ getDb: external.getDb, getRawDbPool: () => { throw new Error("Real DB forbidden"); } }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: external.secret } }));
import { assertBusinessStaffRouteAllowed, getBusinessStaffAuthority, requireBusinessStaffCapability } from "./business-staff-access";
import { legacyExternalSignInAllowed } from "./business-staff-external-access";
import { publicAuthIdentity } from "./public-auth-identity";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { oauth2Router } from "./oauth2-server";

const epoch = new Date("2026-01-01T00:00:00.000Z");
const permissions = { viewBookings: true, viewCustomerAmounts: true, addBookingNotes: true, academyAccess: true };
function syntheticUser(overrides: Partial<User> = {}): User {
  return {
    id: 20, openId: "synthetic-business-staff", name: "Synthetic Staff", email: "staff@example.test", loginMethod: "password",
    role: "agent", isActive: true, tempPassword: "SYNTHETIC-HASH-NOT-A-CREDENTIAL", mustChangePassword: false,
    phone: null, credentialsSentAt: null, portalStatus: "onboarding", crmAccess: true, crmEmail: "synthetic-crm@example.test",
    commissionRatePct: 83, suspendedAt: null, suspensionReason: null, createdAt: epoch, updatedAt: epoch, lastSignedIn: epoch,
    ...overrides,
  };
}
type Row = Record<string, any>;
type State = { people: Row[]; members: Row[]; profiles: Row[]; merges: Row[]; roles: Row[] };
function member(overrides: Row = {}): Row {
  return { id: 50, ownerUserId: 10, staffUserId: 20, status: "active", revision: 1, permissions: { ...permissions }, orbitRequested: true, ...overrides };
}
const dialect = new MySqlDialect();
/** Executes the real projected eq/IN predicates, including retained revoked rows.
 * Unknown tables/operators and every write/raw SQL fail immediately. */
function syntheticDb(initial: Partial<State> = {}) {
  const state: State = {
    people: [syntheticUser({ id: 10, openId: "synthetic-owner", name: "Synthetic Owner", portalStatus: "active" }), syntheticUser()],
    members: [member()], profiles: [{ id: 80, userId: 10, agentStatus: "active" }], merges: [], roles: [], ...initial,
  };
  const reads: Array<{ table: unknown; sql: string; params: unknown[]; fields?: Row }> = [];
  const tableRows = (table: unknown): Row[] => {
    if (table === users) return state.people;
    if (table === businessStaffMemberships) return state.members;
    if (table === agentCrmProfiles) return state.profiles;
    if (table === agentRecordMerges) return state.merges;
    if (table === staffRoleAssignments) return state.roles;
    throw new Error("Financial/provider/unknown table access forbidden");
  };
  const db = {
    select: vi.fn((fields?: Row) => {
      let table: any, condition: SQL | undefined, max = Infinity;
      const chain = {
        from(value: unknown) { table = value; return chain; },
        where(value: SQL) { condition = value; return chain; },
        limit(value: number) { max = value; return chain; },
        then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve().then(() => {
            if (!condition) throw new Error("Unbounded query forbidden");
            const query = dialect.sqlToQuery(condition);
            reads.push({ table, ...query, fields });
            const pattern = /`([^`]+)`\.`([^`]+)`\s*(=|in)\s*(\([^)]*\)|\?)/gi;
            const checks: Array<(row: Row) => boolean> = [];
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(query.sql))) {
              if (match[1] !== getTableName(table)) throw new Error("Unexpected joined authority query");
              const index = (query.sql.slice(0, match.index).match(/\?/g) ?? []).length;
              const column = match[2];
              if (match[3].toLowerCase() === "in") {
                const bound = query.params.slice(index, index + (match[4].match(/\?/g) ?? []).length);
                checks.push(row => bound.includes(row[column]));
              } else { const expected = query.params[index]; checks.push(row => row[column] === expected); }
            }
            if (!checks.length || query.sql.includes(" or ")) throw new Error("Unsupported authority predicate");
            return tableRows(table).filter(row => checks.every(check => check(row))).slice(0, max).map(row =>
              fields ? Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[column.name]])) : { ...row }
            );
          }).then(resolve, reject);
        },
      };
      return chain;
    }),
    execute: vi.fn(() => { throw new Error("Raw/live SQL forbidden"); }),
    insert: vi.fn(() => { throw new Error("Writes forbidden"); }),
    update: vi.fn(() => { throw new Error("Writes forbidden"); }),
    delete: vi.fn(() => { throw new Error("Writes forbidden"); }),
  };
  external.getDb.mockResolvedValue(db);
  return { state, reads, db };
}
const resolveModel = () => external.model();
const scoped = router({
  commissionClaims: router({ claim: protectedProcedure.mutation(resolveModel) }),
  payments: router({ create: protectedProcedure.mutation(resolveModel) }),
  crm: router({ getSsoUrl: protectedProcedure.query(resolveModel) }),
  sso: router({ token: publicProcedure.query(resolveModel) }),
  newlyAddedPublic: publicProcedure.input(z.any()).query(resolveModel),
  adminFinancial: adminProcedure.query(resolveModel),
  auth: router({
    me: publicProcedure.query(resolveModel), logout: publicProcedure.mutation(resolveModel),
    loginWithPassword: publicProcedure.mutation(resolveModel), changePassword: protectedProcedure.mutation(resolveModel),
    forgotPassword: publicProcedure.mutation(resolveModel), resetPassword: publicProcedure.mutation(resolveModel),
    seedTemplates: publicProcedure.mutation(resolveModel),
  }),
  businessStaff: router({ mine: protectedProcedure.query(resolveModel), ownerSummary: protectedProcedure.query(resolveModel) }),
  businessBookings: router({ list: protectedProcedure.query(resolveModel) }),
  academy: router({ myCourses: protectedProcedure.query(resolveModel) }),
});
function caller(user: User | null = syntheticUser()) {
  const ctx: TrpcContext = { user, req: { headers: {}, path: "/auth/me", query: { path: "auth.me" } } as unknown as TrpcContext["req"], res: {} as TrpcContext["res"] };
  return scoped.createCaller(ctx);
}
const deniedCalls = (api: ReturnType<typeof caller>) => [
  () => api.commissionClaims.claim(), () => api.payments.create(), () => api.crm.getSsoUrl(), () => api.sso.token(),
  () => api.newlyAddedPublic({ path: "auth.me", ownerUserId: 10, role: "super_admin" }), () => api.adminFinancial(), () => api.auth.seedTemplates(),
  () => api.businessStaff.ownerSummary(),
];
beforeEach(() => { vi.clearAllMocks(); external.getDb.mockResolvedValue(null); external.model.mockResolvedValue("synthetic-result"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("real retained business-staff authority, fully synthetic", () => {
  it("ordinary agents require a successful bounded membership lookup and do not read owners, CRM, merges or JLT roles", async () => {
    const s = syntheticDb({ members: [] });
    expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: false, active: false, membership: null, owner: null });
    expect(s.reads.map(read => read.table)).toEqual([businessStaffMemberships]);
    expect(s.reads[0].params).toEqual([20]);
  });
  it("non-agent and invalid identities do not touch the registry", async () => {
    for (const user of [syntheticUser({ role: "admin" }), syntheticUser({ role: "super_admin" }), syntheticUser({ id: 0 }), syntheticUser({ id: -1 }), syntheticUser({ id: 1.5 })])
      expect(await getBusinessStaffAuthority(user)).toMatchObject({ managed: false });
    expect(external.getDb).not.toHaveBeenCalled();
  });
  it("active/onboarding agent staff with exactly one active owner CRM profile gets only safe owner identity", async () => {
    const s = syntheticDb();
    const result = await getBusinessStaffAuthority(syntheticUser());
    expect(result).toMatchObject({ managed: true, active: true, orbitReady: false, owner: { id: 10, name: "Synthetic Owner", email: null }, membership: { revision: 1, permissions, orbitRequested: true } });
    expect(result.owner).not.toHaveProperty("commissionRatePct");
    expect(s.reads.every(read => read.fields !== undefined)).toBe(true);
    s.state.people[1].portalStatus = "active";
    expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: true });
  });
  it("retained revoked membership is never ordinary, even after owner records disappear", async () => {
    const s = syntheticDb(); s.state.members[0].status = "revoked";
    expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: false, membership: { status: "revoked" } });
    s.state.people = [];
    expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: false, owner: null });
    await expect(requireBusinessStaffCapability(syntheticUser(), "viewBookings")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["staff", "owner"] as const)("rejects every ineligible %s account using fresh records, not stale session flags", async person => {
    for (const change of [{ role: "admin" }, { role: "super_admin" }, { isActive: false }, { portalStatus: "paused" }, { portalStatus: "suspended" }, { portalStatus: "cancelled" }, { portalStatus: "in_notice" }, ...(person === "owner" ? [{ portalStatus: "onboarding" }] : [{ mustChangePassword: true }])]) {
      const s = syntheticDb(); Object.assign(s.state.people[person === "owner" ? 0 : 1], change);
      expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: false });
    }
  });
  it.each([10, 20])("rejects missing or merged actor %i", async id => {
    const s = syntheticDb(); s.state.people = s.state.people.filter(person => person.id !== id);
    expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: false });
    const merged = syntheticDb({ merges: [{ id: 91, sourceUserId: id }] });
    expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: false });
    expect(merged.reads.find(read => read.table === agentRecordMerges)?.params).toEqual([20, 10]);
  });
  it.each([10, 20])("rejects active AND retained/revoked JLT staff assignments for identity %i", async id => {
    for (const revokedAt of [null, epoch]) {
      const s = syntheticDb({ roles: [{ id: 90, userId: id, role: "instructor", revokedAt }] });
      expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: false });
      const read = s.reads.find(read => read.table === staffRoleAssignments)!;
      expect(read.params).toEqual([20, 10]); expect(read.sql).not.toMatch(/revokedAt|is null/i);
    }
  });
  it.each(["active", "revoked"])("rejects owner being staff or staff owning another membership, even %s links", async status => {
    for (const link of [member({ id: 51, ownerUserId: 99, staffUserId: 10, status }), member({ id: 51, ownerUserId: 20, staffUserId: 99, status })]) {
      syntheticDb({ members: [member(), link] });
      expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: false });
    }
  });
  it("requires exactly one active owner CRM profile, ignores unrelated profiles, and denies self-owner identity", async () => {
    for (const profiles of [[], [{ id: 80, userId: 10, agentStatus: "paused" }], [{ id: 80, userId: 10, agentStatus: "active" }, { id: 81, userId: 10, agentStatus: "active" }]]) {
      syntheticDb({ profiles }); expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: false });
    }
    const s = syntheticDb(); s.state.profiles.push({ id: 81, userId: 99, agentStatus: "active" });
    expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ active: true });
    s.state.members[0].ownerUserId = 20;
    expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: false });
  });
  it("duplicate retained memberships require review instead of selecting an arbitrary owner", async () => {
    const s = syntheticDb({ members: [member(), member({ id: 51, status: "revoked", ownerUserId: 99 })] });
    await expect(getBusinessStaffAuthority(syntheticUser())).rejects.toMatchObject({ code: "FORBIDDEN", message: "Business staff identity requires review." });
    expect(s.reads.map(read => read.table)).toEqual([businessStaffMemberships]);
  });
  it.each([null, [], "invalid-json", { viewBookings: "true", academyAccess: 1 }, { viewBookings: false, viewCustomerAmounts: true, addBookingNotes: true }, "{\"viewBookings\":true,\"academyAccess\":true}"])("invalid/untrusted permissions fail closed without truthy coercion: %j", async value => {
    syntheticDb({ members: [member({ permissions: value })] });
    const result = await getBusinessStaffAuthority(syntheticUser());
    const expected = typeof value === "string" && value.startsWith("{") ? { viewBookings: true, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: true } : { viewBookings: false, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: false };
    expect(result.membership?.permissions).toEqual(expected);
    if (!expected.viewBookings) await expect(requireBusinessStaffCapability(syntheticUser(), "viewBookings")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("missing DB, unknown schema, and rejected connection all produce sanitized errors, never ordinary fail-open", async () => {
    for (const setup of [() => external.getDb.mockResolvedValue(null), () => external.getDb.mockResolvedValue({ select: () => { throw new Error("ER_NO_SUCH_TABLE SELECT business_staff_memberships password=SYNTHETIC-SECRET"); } }), () => external.getDb.mockRejectedValue(new Error("mysql://synthetic-password@private.example.test/db"))]) {
      setup(); const error = await getBusinessStaffAuthority(syntheticUser()).catch(error => error);
      expect(error.code).toBe("INTERNAL_SERVER_ERROR"); expect(error.message).not.toMatch(/SELECT|ER_NO|mysql|password|private\.example|SYNTHETIC-SECRET/);
    }
  });
});

describe("actual global public/protected/admin tRPC factories", () => {
  it.each(["active", "revoked"])("blocks %s staff financial, payment, CRM, SSO, public and admin paths before any model resolver", async status => {
    syntheticDb({ members: [member({ status })] }); const api = caller();
    for (const run of deniedCalls(api)) await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(external.model).not.toHaveBeenCalled();
  });
  it("the actual router path cannot be forged through ctx request URL or input", async () => {
    syntheticDb(); const api = caller();
    await expect(api.newlyAddedPublic({ path: "businessBookings.list", academyAccess: true, ownerUserId: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const path of ["businessBookings", "businessBookingsEvil.list", "academyEvil.myCourses", "auth.me.evil", "businessStaff.mine.evil", "crm.getSsoUrl"])
      await expect(assertBusinessStaffRouteAllowed(syntheticUser(), path)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(external.model).not.toHaveBeenCalled();
  });
  it("ordinary agents and anonymous public callers retain legacy behavior; anonymous protected and agent admin still deny", async () => {
    syntheticDb({ members: [] }); const api = caller();
    for (const run of deniedCalls(api).filter((_, index) => index !== 5)) await expect(run()).resolves.toBe("synthetic-result");
    await expect(api.adminFinancial()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(null).sso.token()).resolves.toBe("synthetic-result");
    await expect(caller(null).payments.create()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("admin factories retain their ordinary role check without touching agent membership storage", async () => {
    await expect(caller(syntheticUser({ role: "admin" })).adminFinancial()).resolves.toBe("synthetic-result");
    expect(external.getDb).not.toHaveBeenCalled();
  });
  it("plain agent and anonymous admin rejection precedes an unavailable registry lookup", async () => {
    external.getDb.mockRejectedValue(new Error("Unknown synthetic registry schema"));
    await expect(caller().adminFinancial()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(null).adminFinancial()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(external.getDb).not.toHaveBeenCalled(); expect(external.model).not.toHaveBeenCalled();
  });
  it("registry outage never prevents logout, but auth identity and data/action routes fail closed", async () => {
    external.getDb.mockRejectedValue(new Error("Unknown synthetic registry schema"));
    const api = caller(); await expect(api.auth.logout()).resolves.toBe("synthetic-result");
    expect(external.getDb).not.toHaveBeenCalled(); external.model.mockClear();
    await expect(api.auth.me()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    await expect(api.payments.create()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(external.model).not.toHaveBeenCalled();
  });
  it("auth identity/logout/change-password and membership identity remain reachable for retained revoked staff", async () => {
    syntheticDb({ members: [member({ status: "revoked" })] }); const api = caller();
    for (const run of [() => api.auth.me(), () => api.auth.logout(), () => api.auth.changePassword(), () => api.businessStaff.mine()])
      await expect(run()).resolves.toBe("synthetic-result");
  });
  it.each(["loginWithPassword", "forgotPassword", "resetPassword"] as const)("requested auth.%s recovery exception remains reachable for retained revoked staff", async path => {
    syntheticDb({ members: [member({ status: "revoked" })] });
    await expect(caller().auth[path]()).resolves.toBe("synthetic-result");
  });
  it("same authenticated caller refreshes Academy permission, revocation and owner status each request", async () => {
    const s = syntheticDb(); const api = caller();
    await expect(api.businessBookings.list()).resolves.toBe("synthetic-result"); await expect(api.academy.myCourses()).resolves.toBe("synthetic-result");
    s.state.members[0].permissions.academyAccess = false; external.model.mockClear();
    await expect(api.academy.myCourses()).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(external.model).not.toHaveBeenCalled();
    s.state.members[0].permissions.academyAccess = true; s.state.members[0].status = "revoked";
    await expect(api.businessBookings.list()).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(api.academy.myCourses()).rejects.toMatchObject({ code: "FORBIDDEN" });
    s.state.members[0].status = "active"; s.state.people[0].portalStatus = "suspended";
    await expect(api.businessBookings.list()).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(external.model).not.toHaveBeenCalled();
  });
  it("unknown registry schema prevents even a public resolver and sanitizes tRPC errors", async () => {
    external.getDb.mockRejectedValue(new Error("ER_BAD_FIELD SELECT synthetic-password"));
    const error = await caller().newlyAddedPublic({}).catch(error => error);
    expect(error.code).toBe("INTERNAL_SERVER_ERROR"); expect(error.message).not.toMatch(/ER_BAD|SELECT|password/); expect(external.model).not.toHaveBeenCalled();
  });
});

describe("actual external sign-in authority and legacy prelink JWT userinfo", () => {
  it("a stale ordinary identity becomes restricted after linking, including retained revocation", async () => {
    const s = syntheticDb({ members: [] }); const sameSessionUser = syntheticUser({ portalStatus: "active" });
    expect(await legacyExternalSignInAllowed(sameSessionUser)).toBe(true);
    s.state.members.push(member()); expect(await legacyExternalSignInAllowed(sameSessionUser)).toBe(false);
    s.state.members[0].status = "revoked"; expect(await legacyExternalSignInAllowed(sameSessionUser)).toBe(false);
    external.getDb.mockRejectedValue(new Error("Unknown synthetic schema")); await expect(legacyExternalSignInAllowed(sameSessionUser)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("blocked ordinary identities deny external sign-in before database access", async () => {
    for (const change of [{ isActive: false }, { mustChangePassword: true }, { portalStatus: "paused" }, { portalStatus: "suspended" }, { portalStatus: "cancelled" }])
      expect(await legacyExternalSignInAllowed({ ...syntheticUser(), ...change })).toBe(false);
    expect(external.getDb).not.toHaveBeenCalled();
  });
  it("real OAuth userinfo rejects the exact JWT minted before membership creation and again after revocation", async () => {
    const s = syntheticDb({ members: [] });
    const token = jwt.sign({ sub: "20", email: "staff@example.test", openId: "synthetic-business-staff", role: "agent", aud: "synthetic-crm" }, external.secret, { expiresIn: "1h" });
    const layer = oauth2Router.stack.find((item: any) => item.route?.path === "/userinfo");
    if (!layer?.route) throw new Error("Actual OAuth userinfo route missing");
    const handler = layer.route.stack[0].handle;
    const invoke = async () => {
      const res = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json: vi.fn() };
      await handler({ headers: { authorization: `Bearer ${token}` } } as Request, res as unknown as Response, vi.fn());
      return res;
    };
    const ordinary = await invoke(); expect(ordinary.statusCode).toBe(200); expect(ordinary.json).toHaveBeenCalledWith(expect.objectContaining({ sub: "20" }));
    s.state.members.push(member());
    for (const status of ["active", "revoked"]) {
      s.state.members[0].status = status; const denied = await invoke();
      expect(denied.statusCode).toBe(401); expect(denied.json).toHaveBeenCalledWith(expect.objectContaining({ error: "invalid_token" }));
      expect(denied.json.mock.calls[0][0]).not.toHaveProperty("email");
    }
  });
});

describe("real publicAuthIdentity allowlisted DTO", () => {
  it.each([false, true])("never returns a hash or arbitrary injected secrets (staff-only=%s)", staffOnly => {
    const user = Object.assign(syntheticUser(), { passwordHash: "SYNTHETIC-HASH-2", accessToken: "SYNTHETIC-TOKEN", bankAccountNumber: "SYNTHETIC-BANK" });
    const dto = publicAuthIdentity(user, staffOnly);
    expect(dto).not.toHaveProperty("tempPassword"); expect(dto).not.toHaveProperty("passwordHash"); expect(dto).not.toHaveProperty("accessToken"); expect(dto).not.toHaveProperty("bankAccountNumber");
    expect(JSON.stringify(dto)).not.toMatch(/SYNTHETIC-HASH|SYNTHETIC-TOKEN|SYNTHETIC-BANK/);
    expect(user.tempPassword).toBe("SYNTHETIC-HASH-NOT-A-CREDENTIAL");
  });
  it("staff DTO omits commission percentage and disables CRM while ordinary DTO preserves safe ordinary fields", () => {
    const user = syntheticUser(); const staff = publicAuthIdentity(user, true); const ordinary = publicAuthIdentity(user);
    expect(staff).not.toHaveProperty("commissionRatePct"); expect(staff).toMatchObject({ id: 20, role: "agent", crmAccess: false, crmEmail: null });
    expect(ordinary).toMatchObject({ commissionRatePct: 83, crmAccess: true, crmEmail: "synthetic-crm@example.test" });
  });
});
