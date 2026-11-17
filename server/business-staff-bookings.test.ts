import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { type SQL, getTableName } from "drizzle-orm";
import {
  agentCrmProfiles, agentRecordMerges, bookings, businessStaffAudit,
  businessStaffBookingNotes, businessStaffMemberships, staffRoleAssignments, users, type User,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { businessStaffBookingsRouter } from "./business-staff-bookings";
import { router } from "./_core/trpc";
const mounted = router({ businessBookings: businessStaffBookingsRouter });
const dialect = new MySqlDialect();
const permissions = { viewBookings: true, viewCustomerAmounts: false, addBookingNotes: true, academyAccess: true };
const epoch = new Date(0);
function agent(overrides: Partial<User> = {}): User {
  return {
    id: 20, openId: "synthetic-staff", name: "Synthetic Staff", email: "staff@example.invalid", loginMethod: "test",
    role: "agent", isActive: true, tempPassword: null, mustChangePassword: false, phone: null,
    credentialsSentAt: null, portalStatus: "onboarding", crmAccess: false, crmEmail: null, commissionRatePct: 80,
    suspendedAt: null, suspensionReason: null, createdAt: epoch, updatedAt: epoch, lastSignedIn: epoch,
    ...overrides,
  };
}
function caller(user: User | null = agent()) {
  const context: TrpcContext = { user, req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
  return mounted.createCaller(context).businessBookings;
}
function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 100, agentId: 10, isPersonalBooking: false, clientName: "Synthetic Traveller", departureDate: epoch,
    bookedDate: epoch, topdogRef: "TD-TEST", ptsRef: "PTS-TEST", crmRef: "CRM-TEST", destination: "Synthetic Island",
    passengers: 2, numberOfNights: 7, currentStage: "New Booking",
    expectedCommission: "SECRET-COMMISSION", grossCost: "SECRET-NET", orbitMarginPct: "SECRET-MARGIN",
    commissionVat: "SECRET-VAT", commissionPreAuthorised: true, finalSupplierPaymentDate: epoch,
    clientEmail: "private@example.invalid", reimbursementDocUrl: "https://secret.invalid/document", privateNote: "SECRET-NOTE",
    ...overrides,
  };
}
function member(overrides: Record<string, unknown> = {}) {
  return { id: 50, ownerUserId: 10, staffUserId: 20, status: "active", revision: 1, permissions, orbitRequested: false, ...overrides };
}
type Row = Record<string, any>;
type State = { accounts: Row[]; members: Row[]; profiles: Row[]; merges: Row[]; roles: Row[]; bookings: Row[]; notes: Row[]; audits: Row[] };
type Event = { kind: string; table?: unknown; fields?: Record<string, any>; sql?: string; params?: unknown[]; locked?: boolean; transactional: boolean; value?: Row; limit?: number; offset?: number };
type Fault = "read" | "booking-read" | "note" | "audit" | "commit";

// This mock only executes bounded projected queries against synthetic records.
// No real DB import survives the module mock, no raw SQL/provider/email/storage.
function syntheticDb(initial: Partial<State> = {}, options: { fault?: Fault; beforeTransaction?: (state: State) => void } = {}) {
  let state: State = {
    accounts: [agent({ id: 10, openId: "synthetic-owner", name: "Synthetic Owner", portalStatus: "active" }), agent()],
    members: [member()], profiles: [{ id: 80, userId: 10, agentStatus: "active", bankAccountNumber: "SECRET-BANK" }],
    merges: [], roles: [], bookings: [booking(), booking({ id: 101, isPersonalBooking: true }), booking({ id: 102, agentId: 99 })],
    notes: [], audits: [], ...structuredClone(initial),
  };
  const events: Event[] = [];
  const tableRows = (s: State, table: unknown): Row[] => {
    if (table === users) return s.accounts;
    if (table === businessStaffMemberships) return s.members;
    if (table === agentCrmProfiles) return s.profiles;
    if (table === agentRecordMerges) return s.merges;
    if (table === staffRoleAssignments) return s.roles;
    if (table === bookings) return s.bookings;
    if (table === businessStaffBookingNotes) return s.notes;
    throw new Error("Unexpected provider, financial, document or legacy private-note read");
  };
  function matches(row: Row, query: { sql: string; params: unknown[] }, table: any) {
    const name = getTableName(table);
    const eqPattern = /`([^`]+)`\.`([^`]+)`\s*(=|in|like|is null)\s*(\([^)]*\)|\?|)/gi;
    const tests: boolean[] = [];
    let match: RegExpExecArray | null;
    while ((match = eqPattern.exec(query.sql))) {
      if (match[1] !== name) continue;
      const index = (query.sql.slice(0, match.index).match(/\?/g) ?? []).length;
      const column = match[2], operator = match[3].toLowerCase();
      if (operator === "=") tests.push(row[column] === query.params[index]);
      else if (operator === "in") {
        const count = (match[4].match(/\?/g) ?? []).length;
        tests.push(query.params.slice(index, index + count).includes(row[column]));
      } else if (operator === "is null") tests.push(row[column] == null);
      else {
        const raw = String(query.params[index]);
        const literal = raw.slice(1, -1).replace(/\\([\\%_])/g, "$1");
        tests.push(String(row[column] ?? "").includes(literal));
      }
    }
    // Production search is (scope AND (column LIKE ... OR ...)), never OR scope.
    if (query.sql.includes(" like ")) {
      const scopeTests = tests.slice(0, 2), searchTests = tests.slice(2);
      return scopeTests.every(Boolean) && searchTests.some(Boolean);
    }
    return tests.every(Boolean);
  }
  function connection(current: () => State, transactional: boolean) {
    return {
      select: vi.fn((fields?: Record<string, any>) => {
        expect(fields, "every query must explicitly allowlist its columns").toBeDefined();
        let table: any, condition: SQL | undefined, limit: number | undefined, offset = 0, locked = false, ordered = false;
        const chain = {
          from: (value: any) => { table = value; return chain; },
          where: (value: SQL) => { condition = value; return chain; },
          orderBy: () => { ordered = true; return chain; },
          limit: (value: number) => { limit = value; return chain; },
          offset: (value: number) => { offset = value; return chain; },
          for: (mode: string) => { expect(mode).toBe("update"); expect(transactional).toBe(true); locked = true; return chain; },
          then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => {
            const query = condition ? dialect.sqlToQuery(condition) : { sql: "", params: [] };
            events.push({ kind: "select", table, fields, ...query, locked, transactional, limit, offset });
            if (options.fault === "read" || (options.fault === "booking-read" && table === bookings))
              throw new Error("SELECT SECRET-SQL connection-password https://secret.invalid");
            let rows = tableRows(current(), table).filter(row => matches(row, query, table));
            if (ordered) rows = [...rows].sort((a, b) => b.id - a.id);
            rows = rows.slice(offset, limit === undefined ? undefined : offset + limit);
            return rows.map(row => Object.fromEntries(Object.entries(fields!).map(([key, column]) => [key, row[column.name]])));
          }).then(resolve, reject),
        };
        return chain;
      }),
      insert: vi.fn((table: unknown) => ({ values: (value: Row) => {
        expect(transactional).toBe(true);
        const execute = async () => {
          events.push({ kind: "insert", table, transactional, value });
          if (table === businessStaffBookingNotes) {
            if (options.fault === "note") throw new Error("Synthetic note insert failed");
            const id = 200 + current().notes.length;
            current().notes.push({ id, ...value, createdAt: epoch });
            return [{ id }];
          }
          if (table === businessStaffAudit) {
            if (options.fault === "audit") throw new Error("Synthetic audit failed");
            current().audits.push(value);
            return [];
          }
          throw new Error("Unexpected write: finance, owner change, booking update or notification");
        };
        return { $returningId: execute, then: (resolve: any, reject: any) => execute().then(resolve, reject) };
      } })),
      execute: vi.fn(() => { throw new Error("Raw/live SQL forbidden"); }),
      update: vi.fn(() => { throw new Error("All booking/finance updates forbidden"); }),
      delete: vi.fn(() => { throw new Error("All deletes forbidden"); }),
    };
  }
  const db = {
    ...connection(() => state, false),
    transaction: vi.fn(async (work: (tx: ReturnType<typeof connection>) => Promise<any>, config: unknown) => {
      expect(config).toEqual({ isolationLevel: "serializable" });
      options.beforeTransaction?.(state);
      const staged = structuredClone(state);
      events.push({ kind: "begin", transactional: true });
      try {
        const result = await work(connection(() => staged, true));
        if (options.fault === "commit") throw new Error("Synthetic commit failure");
        state = staged;
        events.push({ kind: "commit", transactional: true });
        return result;
      } catch (error) { events.push({ kind: "rollback", transactional: true }); throw error; }
    }),
  };
  mocks.getDb.mockResolvedValue(db);
  return { db, events, state: () => state };
}

beforeEach(() => { vi.clearAllMocks(); mocks.getDb.mockResolvedValue(null); });

describe("actual businessBookings router: strict operational scope", () => {
  it("requires authentication for every endpoint", async () => {
    const api = caller(null);
    for (const run of [
      () => api.list({}), () => api.detail({ bookingId: 100 }), () => api.listNotes({ bookingId: 100 }),
      () => api.addNote({ bookingId: 100, text: "Synthetic text" }), () => api.ownerNotes({ bookingId: 100 }),
      () => api.ownerAddNote({ bookingId: 100, text: "Synthetic text" }),
    ]) await expect(run()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("allows active/onboarding staff, derives owner scope, and preserves ordinary pipeline labels only", async () => {
    const s = syntheticDb({ bookings: [booking({ currentStage: "Claimable" }), booking({ id: 101, isPersonalBooking: true }), booking({ id: 102, agentId: 99 })] });
    const result = await caller().list({});
    expect(result).toMatchObject({ page: 1, pageSize: 25, hasMore: false });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 100, currentStage: "Booking recorded" });
    expect(await caller().detail({ bookingId: 100 })).toEqual(result.items[0]);
    const query = s.events.find(e => e.table === bookings)!;
    expect(query.sql).toContain("`bookings`.`agentId` = ?");
    expect(query.sql).toContain("`bookings`.`isPersonalBooking` = ?");
    expect(query.params).toEqual([10, false]);
    expect(Object.keys(result.items[0]).sort()).toEqual(["bookedDate", "clientName", "crmRef", "currentStage", "departureDate", "destination", "id", "numberOfNights", "passengers", "ptsRef", "topdogRef"]);
  });
  it("rejects personal, another owner, self-owned staff and absent booking IDs identically", async () => {
    const s = syntheticDb({ bookings: [booking(), booking({ id: 101, isPersonalBooking: true }), booking({ id: 102, agentId: 99 }), booking({ id: 103, agentId: 20 })] });
    for (const bookingId of [101, 102, 103, 999]) {
      await expect(caller().detail({ bookingId })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller().listNotes({ bookingId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(s.db.insert).not.toHaveBeenCalled();
  });
  it("never reads or returns sensitive fields, URLs, financial/provider records even with customer-price permission", async () => {
    const s = syntheticDb({ bookings: [booking({ grossCost: "2500.00" })], members: [member({ permissions: { ...permissions, viewCustomerAmounts: true } })] });
    const result = await caller().detail({ bookingId: 100 });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|private@example|secret.invalid/);
    expect(result).not.toHaveProperty("grossCost");
    expect(result).toHaveProperty("grossPrice", "2500.00"); // Existing grossCost is the verified gross customer price, aliased only when permitted.
    for (const event of s.events.filter(e => e.kind === "select")) {
      expect(event.fields).toBeDefined();
      expect(Object.keys(event.fields!)).not.toEqual(expect.arrayContaining(["expectedCommission"]));
      if (Object.values(event.fields!).some((column: any) => column.name === "grossCost")) expect(Object.keys(event.fields!).sort()).toEqual(["grossPrice", "id"]);
      expect([bookings, users, businessStaffMemberships, agentCrmProfiles, agentRecordMerges, staffRoleAssignments]).toContain(event.table);
    }
    expect(s.db.execute).not.toHaveBeenCalled();
    expect(s.db.update).not.toHaveBeenCalled();
    expect(s.db.delete).not.toHaveBeenCalled();
  });
  it("refreshes revocation and permission changes on the same caller instead of trusting session data", async () => {
    const s = syntheticDb(); const api = caller();
    await expect(api.list({})).resolves.toMatchObject({ items: [{ id: 100 }] });
    s.state().members[0].permissions = { ...permissions, viewBookings: false };
    await expect(api.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    s.state().members[0].permissions = permissions; s.state().members[0].status = "revoked";
    await expect(api.detail({ bookingId: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.ownerNotes({ bookingId: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["admin", "super_admin"] as const)("does not give %s a staff or owner shortcut", async role => {
    const s = syntheticDb(); const api = caller(agent({ role }));
    await expect(api.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.ownerNotes({ bookingId: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(s.events.filter(e => e.table === bookings)).toEqual([]);
  });
  it.each([
    { isActive: false }, { portalStatus: "paused" }, { portalStatus: "suspended" }, { portalStatus: "in_notice" },
  ])("fails closed when the owner account is ineligible: %j", async change => {
    syntheticDb({ accounts: [agent({ id: 10, portalStatus: "active", ...change }), agent()] });
    await expect(caller().list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("fails closed on owner CRM/merge gaps and staff incomplete setup", async () => {
    for (const initial of [
      { profiles: [] }, { profiles: [{ id: 80, userId: 10, agentStatus: "paused" }] },
      { merges: [{ id: 1, sourceUserId: 10 }] },
      { accounts: [agent({ id: 10, portalStatus: "active" }), agent({ mustChangePassword: true })] },
      { members: [] },
    ]) {
      syntheticDb(initial);
      await expect(caller().list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("bounds pagination and rejects owner IDs, financial updates, author IDs and extra inputs", async () => {
    const s = syntheticDb(); const api = caller();
    for (const input of [{ pageSize: 51 }, { pageSize: 0 }, { page: 0 }, { page: 1.5 }, { ownerUserId: 99 }, { search: "x".repeat(101) }])
      await expect(api.list(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const input of [{ bookingId: 100, pageSize: 101 }, { bookingId: 100, ownerUserId: 99 }])
      await expect(api.listNotes(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const input of [{ bookingId: 100, text: "  " }, { bookingId: 100, text: "x".repeat(2001) }, { bookingId: 100, text: "ok", authorUserId: 99 }, { bookingId: 100, text: "ok", expectedCommission: "1" }])
      await expect(api.addNote(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(s.db.transaction).not.toHaveBeenCalled();
  });
  it("uses bounded pages plus a single lookahead without bulk export or total financial aggregation", async () => {
    const s = syntheticDb({ bookings: [booking(), booking({ id: 104 }), booking({ id: 105 })] });
    const api = caller();
    expect(await api.list({ pageSize: 1 })).toMatchObject({ items: [{ id: 105 }], hasMore: true });
    expect(await api.list({ page: 2, pageSize: 1 })).toMatchObject({ items: [{ id: 104 }], hasMore: true });
    expect(await api.list({ page: 3, pageSize: 1 })).toMatchObject({ items: [{ id: 100 }], hasMore: false });
    expect(s.events.filter(e => e.table === bookings).every(e => e.limit === 2)).toBe(true);
    expect(await api.list({ search: "TD-TEST" })).toMatchObject({ items: expect.any(Array) });
    const event = s.events.filter(e => e.table === bookings).at(-1)!;
    expect(event.params).toEqual([10, false, "%TD-TEST%", "%TD-TEST%", "%TD-TEST%", "%TD-TEST%", "%TD-TEST%"]);
  });
});

describe("actual businessBookings router: separate append-only staff channel", () => {
  it("reads only the staff-visible channel with owner/booking predicates and bounded paging", async () => {
    const s = syntheticDb({ notes: [
      { id: 200, bookingId: 100, ownerUserId: 10, authorUserId: 20, text: "Plain <script>not HTML</script>", createdAt: epoch },
      { id: 201, bookingId: 100, ownerUserId: 99, authorUserId: 99, text: "Wrong owner secret", createdAt: epoch },
      { id: 202, bookingId: 102, ownerUserId: 10, authorUserId: 10, text: "Wrong booking secret", createdAt: epoch },
      { id: 203, bookingId: 100, ownerUserId: 10, authorUserId: 10, text: "Owner-visible staff channel", createdAt: epoch },
    ] });
    const api = caller();
    expect(await api.listNotes({ bookingId: 100, pageSize: 1 })).toEqual({ items: [{ id: 203, authorUserId: 10, text: "Owner-visible staff channel", createdAt: epoch }], page: 1, pageSize: 1, hasMore: true });
    expect((await api.listNotes({ bookingId: 100, page: 2, pageSize: 1 })).items[0].text).toBe("Plain <script>not HTML</script>");
    const query = s.events.find(e => e.table === businessStaffBookingNotes)!;
    expect(query.params).toEqual([100, 10]); expect(query.limit).toBe(2);
    expect(await caller(agent({ id: 10, portalStatus: "active" })).ownerNotes({ bookingId: 100, pageSize: 1 })).toMatchObject({ items: [{ id: 203 }] });
  });
  it("notes read permission does not imply add permission; there is no owner/private note fallback", async () => {
    const s = syntheticDb({ members: [member({ permissions: { ...permissions, addBookingNotes: false } })] });
    await expect(caller().listNotes({ bookingId: 100 })).resolves.toMatchObject({ items: [] });
    await expect(caller().addNote({ bookingId: 100, text: "Test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().ownerAddNote({ bookingId: 100, text: "Test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(s.db.transaction).not.toHaveBeenCalled();
  });
  it("locks sorted user rows, fresh membership and scoped booking, then appends note and metadata-only audit atomically", async () => {
    const s = syntheticDb(); const beforeBookings = structuredClone(s.state().bookings);
    const result = await caller().addNote({ bookingId: 100, text: "  Synthetic client text  " });
    expect(result).toEqual({ success: true, noteId: 200 });
    expect(s.state().notes).toEqual([{ id: 200, bookingId: 100, ownerUserId: 10, authorUserId: 20, membershipId: 50, text: "Synthetic client text", createdAt: epoch }]);
    expect(s.state().audits).toEqual([{ membershipId: 50, actorUserId: 20, action: "booking_note", reason: "Business staff note", afterState: { bookingId: 100, noteId: 200 } }]);
    expect(JSON.stringify(s.state().audits)).not.toContain("Synthetic client text");
    const locks = s.events.filter(e => e.kind === "select" && e.locked);
    expect(locks.filter(e => e.table === users).map(e => e.params)).toEqual([[10], [20]]);
    expect(locks[2].table).toBe(businessStaffMemberships);
    expect(locks.at(-1)).toMatchObject({ table: bookings, params: [10, false, 100] });
    expect(s.events.filter(e => e.kind === "insert").map(e => e.table)).toEqual([businessStaffBookingNotes, businessStaffAudit]);
    expect(s.events.filter(e => e.kind === "insert").every(e => e.transactional)).toBe(true);
    expect(s.state().bookings).toEqual(beforeBookings);
    expect(s.events.at(-1)?.kind).toBe("commit");
  });
  it.each([
    "membership-revoked", "permission-revoked", "owner-changed", "membership-removed", "staff-inactive", "staff-password",
    "owner-paused", "owner-crm-paused", "owner-merged", "owner-now-staff", "owner-jlt-staff", "staff-jlt-staff", "personal", "booking-owner-changed",
  ])("rechecks %s after initial authority and rolls back without any note/audit", async change => {
    const s = syntheticDb({}, { beforeTransaction: state => {
      if (change === "membership-revoked") state.members[0].status = "revoked";
      if (change === "permission-revoked") state.members[0].permissions = { ...permissions, addBookingNotes: false };
      if (change === "owner-changed") state.members[0].ownerUserId = 99;
      if (change === "membership-removed") state.members = [];
      if (change === "staff-inactive") state.accounts[1].isActive = false;
      if (change === "staff-password") state.accounts[1].mustChangePassword = true;
      if (change === "owner-paused") state.accounts[0].portalStatus = "paused";
      if (change === "owner-crm-paused") state.profiles[0].agentStatus = "paused";
      if (change === "owner-merged") state.merges = [{ id: 1, sourceUserId: 10 }];
      if (change === "owner-now-staff") state.members.push(member({ id: 51, staffUserId: 10, ownerUserId: 99, status: "revoked" }));
      if (change === "owner-jlt-staff") state.roles = [{ id: 1, userId: 10, revokedAt: null }];
      if (change === "staff-jlt-staff") state.roles = [{ id: 1, userId: 20, revokedAt: null }];
      if (change === "personal") state.bookings[0].isPersonalBooking = true;
      if (change === "booking-owner-changed") state.bookings[0].agentId = 99;
    } });
    await expect(caller().addNote({ bookingId: 100, text: "Do not persist" })).rejects.toBeDefined();
    expect(s.state().notes).toEqual([]); expect(s.state().audits).toEqual([]);
    expect(s.events.at(-1)?.kind).toBe("rollback");
    expect(s.events.filter(e => e.kind === "insert")).toEqual([]);
  });
  it.each(["note", "audit", "commit"] as const)("rolls back both note and membership audit on %s failure", async fault => {
    const s = syntheticDb({}, { fault }); const before = structuredClone(s.state());
    await expect(caller().addNote({ bookingId: 100, text: "Synthetic note" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(s.state()).toEqual(before); expect(s.events.at(-1)?.kind).toBe("rollback");
  });
  it("owner posts only their own nonpersonal booking into the same channel with null membership and their own author", async () => {
    const s = syntheticDb(); const api = caller(agent({ id: 10, portalStatus: "active" }));
    await expect(api.ownerAddNote({ bookingId: 100, text: "Owner staff-visible note" })).resolves.toEqual({ success: true, noteId: 200 });
    expect(s.state().notes[0]).toMatchObject({ ownerUserId: 10, authorUserId: 10, membershipId: null, text: "Owner staff-visible note" });
    expect(s.state().audits).toEqual([]); // Membership audit requires an actual membership; no fabricated link.
    for (const bookingId of [101, 102, 999]) await expect(api.ownerAddNote({ bookingId, text: "No" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(s.state().notes).toHaveLength(1);
    expect(await caller().listNotes({ bookingId: 100 })).toMatchObject({ items: [{ authorUserId: 10, text: "Owner staff-visible note" }] });
  });
  it("owner-only write rechecks a newly retained staff row inside its transaction", async () => {
    const s = syntheticDb({}, { beforeTransaction: state => state.members.push(member({ id: 51, staffUserId: 10, ownerUserId: 99, status: "revoked" })) });
    await expect(caller(agent({ id: 10, portalStatus: "active" })).ownerAddNote({ bookingId: 100, text: "No" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(s.state().notes).toEqual([]); expect(s.events.at(-1)?.kind).toBe("rollback");
  });
  it("does not leak SQL, secrets or connection details on unknown storage errors", async () => {
    // The parent's global boundary executes first; this failure targets the
    // owned booking read/resolver, not the parent's authority error handling.
    syntheticDb({}, { fault: "booking-read" });
    const error = await caller().list({}).catch(error => error);
    expect(error.code).toBe("INTERNAL_SERVER_ERROR"); expect(error.message).not.toMatch(/SELECT|SECRET|password|secret.invalid/);
    mocks.getDb.mockResolvedValue(null);
    await expect(caller().list({})).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("exposes only the six authorized workspace operations and has no notification/provider/raw SQL imports", () => {
    expect(Object.keys(businessStaffBookingsRouter._def.procedures).sort()).toEqual(["addNote", "detail", "list", "listNotes", "ownerAddNote", "ownerNotes"]);
    const source = readFileSync(new URL("./business-staff-bookings.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\.select\(\)|\.execute\(|\.delete\(|\.update\(|sendEmail|sendNotification|generateSpeech|invokeLLM|orbitFinancialSnapshots|bookingDocuments/);
    expect(source).not.toMatch(/from ["'][^"']*(?:provider|email|notification|storage|commission|financial|refund|amendment)[^"']*["']/);
  });
});
