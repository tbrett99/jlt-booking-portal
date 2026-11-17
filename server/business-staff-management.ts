import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getRawDbPool } from "./db";
import { BUSINESS_STAFF_ORBIT_NOTICE, readBusinessStaffPermissions, type BusinessStaffPermissions } from "../shared/business-staff";

const id = z.number().int().positive().max(2147483647);
const reason = z.string().trim().min(10).max(1000);
export const permissionsInput = z.object({ viewBookings: z.boolean(), viewCustomerAmounts: z.boolean(), addBookingNotes: z.boolean(), academyAccess: z.boolean(), resourceAccess: z.boolean().default(true) }).strict().superRefine((p, ctx) => {
  if (!p.viewBookings && (p.viewCustomerAmounts || p.addBookingNotes)) ctx.addIssue({ code: "custom", message: "Customer amounts and booking notes require booking access" });
});
const pagination = { page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(50).default(25) };
export const adminListInput = z.object({ ...pagination, search: z.string().trim().max(100).default(""), status: z.enum(["active", "revoked"]).optional(), ownerUserId: id.optional() }).strict().default({ page: 1, pageSize: 25, search: "" });
export const peopleSearchInput = z.object({ ...pagination, search: z.string().trim().min(2).max(100) }).strict();
const confirmed = { restrictedStaffOnlyConfirmed: z.literal(true), preserveExistingDataConfirmed: z.literal(true) };
const linkFields = { ownerUserId: id, permissions: permissionsInput, orbitRequested: z.boolean(), reason, ...confirmed };
export const linkExistingInput = z.object({ ...linkFields, staffUserId: id }).strict().refine(i => i.ownerUserId !== i.staffUserId, "Owner and staff must be separate identities");
export const createStaffInput = z.object({ ...linkFields, name: z.string().trim().min(2).max(255), email: z.string().trim().toLowerCase().min(3).max(320).email() }).strict();
const revisionFields = { membershipId: id, revision: id, reason };
export const updatePermissionsInput = z.object({ ...revisionFields, permissions: permissionsInput, orbitRequested: z.boolean() }).strict();
export const setStatusInput = z.object({ ...revisionFields, status: z.enum(["active", "revoked"]) }).strict();
export const createSetupLinkInput = z.object(revisionFields).strict();

type Row = Record<string, any>;
export type BusinessStaffConnection = { query: (sql: string, args?: any[]) => Promise<any>; beginTransaction: () => Promise<any>; commit: () => Promise<any>; rollback: () => Promise<any>; release: () => void; destroy?: () => void };
export type BusinessStaffDependencies = { getPool: () => Promise<{ getConnection: () => Promise<BusinessStaffConnection> }> };
export type BusinessStaffMember = { id: number; membershipId: number; ownerUserId: number; staffUserId: number; owner: { id: number; name: string | null; email: string | null }; staff: { id: number; name: string | null; email: string | null }; status: "active" | "revoked"; revision: number; permissions: BusinessStaffPermissions; orbitRequested: boolean; orbitReady: false; orbitNotice: string; createdAt: string };
const orbit = { orbitReady: false as const, orbitNotice: BUSINESS_STAFF_ORBIT_NOTICE };
function fail(code: "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "PRECONDITION_FAILED", message: string): never { throw new TRPCError({ code, message }); }
const select = async (db: BusinessStaffConnection, sql: string, args: any[] = []): Promise<Row[]> => (await db.query(sql, args))[0];
const changed = async (db: BusinessStaffConnection, sql: string, args: any[]) => (await db.query(sql, args))[0] as { affectedRows: number; insertId: number };
const columns: Record<string, string[]> = {
  users: ["id", "name", "email", "role", "isActive", "portalStatus", "loginMethod", "openId", "tempPassword", "mustChangePassword", "crmAccess"],
  agent_crm_profiles: ["id", "userId", "agentStatus"], agent_record_merges: ["id", "sourceUserId", "sourceEmail"],
  staff_role_assignments: ["id", "userId", "staffRole", "isActive"],
  business_staff_memberships: ["id", "ownerUserId", "staffUserId", "status", "permissions", "orbitRequested", "revision", "createdById", "createdAt", "updatedAt", "revokedAt"],
  business_staff_audit: ["id", "membershipId", "actorUserId", "action", "reason", "beforeState", "afterState", "createdAt"],
  business_staff_booking_notes: ["id", "bookingId", "ownerUserId", "authorUserId", "membershipId", "text", "createdAt"],
  password_reset_tokens: ["id", "userId", "token", "expiresAt", "usedAt", "createdAt"],
};
/** Never interpret missing entitlement/identity tables as an ordinary independent agent. */
export async function assertBusinessStaffManagementReady(db: BusinessStaffConnection) {
  const names = Object.keys(columns);
  const metadata = await select(db, `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")})`, names);
  const found = new Set(metadata.map(r => `${r.tableName}.${r.columnName}`));
  if (Object.entries(columns).some(([table, fields]) => fields.some(field => !found.has(`${table}.${field}`)))) fail("PRECONDITION_FAILED", "Business staff and identity schema must be fully migrated before management is available. No changes were made.");
  const keys = await select(db, "SELECT INDEX_NAME AS indexName, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS ordinal FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='business_staff_memberships' AND NON_UNIQUE=0 ORDER BY INDEX_NAME, SEQ_IN_INDEX");
  const indexes = new Map<string, string[]>();
  for (const key of keys) { if (!indexes.has(key.indexName)) indexes.set(key.indexName, []); indexes.get(key.indexName)!.push(key.columnName); }
  if (!Array.from(indexes.values()).some(fields => fields.length === 1 && fields[0] === "staffUserId")) fail("PRECONDITION_FAILED", "The permanent unique staff identity constraint is required. No changes were made.");
  const foreignKeys = await select(db, "SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,REFERENCED_TABLE_NAME AS referencedTable,REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('business_staff_memberships','business_staff_audit','business_staff_booking_notes') AND REFERENCED_TABLE_NAME IS NOT NULL");
  const fk = new Set(foreignKeys.map(r => `${r.tableName}.${r.columnName}:${r.referencedTable}.${r.referencedColumn}`));
  const required = ["business_staff_memberships.ownerUserId:users.id", "business_staff_memberships.staffUserId:users.id", "business_staff_memberships.createdById:users.id", "business_staff_audit.membershipId:business_staff_memberships.id", "business_staff_audit.actorUserId:users.id", "business_staff_booking_notes.bookingId:bookings.id", "business_staff_booking_notes.ownerUserId:users.id", "business_staff_booking_notes.authorUserId:users.id", "business_staff_booking_notes.membershipId:business_staff_memberships.id"];
  if (required.some(key => !fk.has(key))) fail("PRECONDITION_FAILED", "Business staff foreign-key integrity constraints must be installed. No changes were made.");
}
function publicMember(r: Row): BusinessStaffMember {
  return { id: Number(r.id), membershipId: Number(r.id), ownerUserId: Number(r.ownerUserId), staffUserId: Number(r.staffUserId), owner: { id: Number(r.ownerUserId), name: r.ownerName ?? null, email: r.ownerEmail ?? null }, staff: { id: Number(r.staffUserId), name: r.staffName ?? null, email: r.staffEmail ?? null }, status: r.status, revision: Number(r.revision), permissions: readBusinessStaffPermissions(r.permissions), orbitRequested: Number(r.orbitRequested) === 1, ...orbit, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : new Date(`${String(r.createdAt).replace(" ", "T")}${/[zZ]|[+-]\d\d:\d\d$/.test(String(r.createdAt)) ? "" : "Z"}`).toISOString() };
}
function auditState(r: Row) {
  return { ownerUserId: Number(r.ownerUserId), staffUserId: Number(r.staffUserId), status: r.status, revision: Number(r.revision), permissions: readBusinessStaffPermissions(r.permissions), orbitRequested: Number(r.orbitRequested) === 1, orbitReady: false };
}
const projection = "SELECT m.id,m.ownerUserId,m.staffUserId,m.status,m.revision,m.permissions,m.orbitRequested,m.createdAt,o.name AS ownerName,o.email AS ownerEmail,s.name AS staffName,s.email AS staffEmail FROM business_staff_memberships m JOIN users o ON o.id=m.ownerUserId JOIN users s ON s.id=m.staffUserId";
const escapeLike = (s: string) => `%${s.replace(/[!%_]/g, "!$&")}%`;

export function createBusinessStaffManagement(dependencies?: BusinessStaffDependencies) {
  async function transaction<T>(actorId: number, work: (db: BusinessStaffConnection) => Promise<T>): Promise<T> {
    if (!id.safeParse(actorId).success) fail("BAD_REQUEST", "A valid current account identifier is required.");
    let db: BusinessStaffConnection | undefined, begun = false, previousZone: string | undefined, destroy = false;
    try {
      db = await (await (dependencies?.getPool ? dependencies.getPool() : getRawDbPool())).getConnection();
      const zone = await select(db, "SELECT @@session.time_zone AS timeZone");
      if (typeof zone[0]?.timeZone !== "string") fail("PRECONDITION_FAILED", "Database timestamp handling could not be verified.");
      previousZone = zone[0].timeZone;
      await db.query("SET time_zone = '+00:00'");
      await db.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      await db.beginTransaction(); begun = true;
      await assertBusinessStaffManagementReady(db);
      const result = await work(db);
      await db.commit(); begun = false;
      return result;
    } catch (e: any) {
      if (db && begun) { try { await db.rollback(); } catch { destroy = true; } }
      if (e instanceof TRPCError || e instanceof z.ZodError) throw e;
      if (["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(e?.code) || [1062, 1213, 1205].includes(e?.errno)) fail("CONFLICT", "The account or membership changed concurrently. Refresh and try again; no duplicate account was created.");
      if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_NO_REFERENCED_ROW_2"].includes(e?.code)) fail("PRECONDITION_FAILED", "Business staff storage or identity integrity is unavailable. No changes were made.");
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Business staff management could not be completed safely." });
    } finally {
      if (db) {
        if (previousZone !== undefined) { try { await db.query("SET time_zone = ?", [previousZone]); } catch { destroy = true; } }
        if (destroy) db.destroy?.(); else db.release();
      }
    }
  }
  async function lockUsers(db: BusinessStaffConnection, ids: number[]) {
    // Explicit single-row locks in ascending order, independent of optimizer plan.
    const users = new Map<number, Row>();
    for (const userId of Array.from(new Set(ids)).sort((a,b) => a-b)) {
      id.parse(userId);
      const [user] = await select(db, "SELECT id,name,email,role,isActive,portalStatus,loginMethod,mustChangePassword FROM users WHERE id=? FOR UPDATE", [userId]);
      if (!user) fail("NOT_FOUND", "A selected account no longer exists. Refresh your selection.");
      users.set(userId, user);
    }
    return users;
  }
  async function identity(db: BusinessStaffConnection, userId: number) {
    const archived = await select(db, "SELECT id FROM agent_record_merges WHERE sourceUserId=? FOR UPDATE", [userId]);
    const assignments = await select(db, "SELECT id FROM staff_role_assignments WHERE userId=? ORDER BY id FOR UPDATE", [userId]);
    const memberships = await select(db, "SELECT id,ownerUserId,staffUserId,status FROM business_staff_memberships WHERE ownerUserId=? OR staffUserId=? ORDER BY id FOR UPDATE", [userId,userId]);
    return { archived: archived.length > 0, jltStaff: assignments.length > 0, memberships };
  }
  async function assertActor(db: BusinessStaffConnection, actor: Row) {
    const state = await identity(db, Number(actor.id));
    if (!["admin", "super_admin"].includes(actor.role) || Number(actor.isActive) !== 1 || actor.portalStatus !== "active" || Number(actor.mustChangePassword) !== 0 || state.archived || state.memberships.some(m => Number(m.staffUserId) === Number(actor.id))) fail("FORBIDDEN", "A current active administrator account with completed password setup is required.");
  }
  async function assertOwner(db: BusinessStaffConnection, owner: Row) {
    const state = await identity(db, Number(owner.id));
    const profiles = await select(db, "SELECT id,agentStatus FROM agent_crm_profiles WHERE userId=? ORDER BY id FOR UPDATE", [owner.id]);
    if (owner.role !== "agent" || Number(owner.isActive) !== 1 || owner.portalStatus !== "active" || state.archived || state.jltStaff || state.memberships.some(m => Number(m.staffUserId) === Number(owner.id)) || profiles.length !== 1 || profiles[0].agentStatus !== "active") fail("PRECONDITION_FAILED", "The business owner must be an active, unmerged independent agent with one active CRM profile and no staff-only or JLT staff assignment.");
  }
  async function assertStaff(db: BusinessStaffConnection, staff: Row, membershipId?: number) {
    const state = await identity(db, Number(staff.id));
    if (staff.role !== "agent" || Number(staff.isActive) !== 1 || !["active", "onboarding"].includes(staff.portalStatus) || state.archived || state.jltStaff || state.memberships.some(m => Number(m.ownerUserId) === Number(staff.id))) fail("PRECONDITION_FAILED", "Staff must be a separate active/onboarding, unmerged agent login, not a business owner or JLT staff member. Existing account status is never changed.");
    if (state.memberships.some(m => Number(m.staffUserId) === Number(staff.id) && Number(m.id) !== membershipId)) fail("CONFLICT", "This account is already a retained staff-only identity. Use its existing membership; it cannot be relinked or transferred.");
  }
  async function audit(db: BusinessStaffConnection, actorId: number, membership: Row, action: string, why: string, before: Row | null) {
    await changed(db, "INSERT INTO business_staff_audit (membershipId,actorUserId,action,reason,beforeState,afterState,createdAt) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP())", [membership.id,actorId,action,why,before ? JSON.stringify(auditState(before)) : null,JSON.stringify(auditState(membership))]);
  }
  async function member(db: BusinessStaffConnection, membershipId: number) {
    const result = await select(db, `${projection} WHERE m.id=?`, [membershipId]);
    if (result.length !== 1) fail("PRECONDITION_FAILED", "The membership identity could not be verified.");
    return publicMember(result[0]);
  }
  async function insertMembership(db: BusinessStaffConnection, actorId: number, ownerUserId: number, staffUserId: number, input: { permissions: BusinessStaffPermissions; orbitRequested: boolean; reason: string }, action: string) {
    const result = await changed(db, "INSERT INTO business_staff_memberships (ownerUserId,staffUserId,status,permissions,orbitRequested,revision,createdById,createdAt,updatedAt) VALUES (?,?,'active',?, ?,1,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())", [ownerUserId,staffUserId,JSON.stringify(input.permissions),input.orbitRequested ? 1 : 0,actorId]);
    const membership = { id: Number(result.insertId),ownerUserId,staffUserId,status:"active",permissions:input.permissions,orbitRequested:input.orbitRequested ? 1 : 0,revision:1 };
    if (!Number.isSafeInteger(membership.id) || membership.id <= 0) fail("PRECONDITION_FAILED", "Membership creation could not be verified.");
    await audit(db,actorId,membership,action,input.reason,null);
    return membership;
  }
  async function setup(db: BusinessStaffConnection, staff: Row) {
    if (staff.loginMethod !== "password") fail("PRECONDITION_FAILED", "Only an existing password-login account can receive a password setup link. The login method is never changed.");
    const token = randomBytes(36).toString("base64url");
    // The existing /reset-password flow consumes token + expiresAt + usedAt.
    // Retain consumed records; invalidate prior unused links instead of deleting evidence.
    await changed(db, "UPDATE password_reset_tokens SET usedAt=UTC_TIMESTAMP() WHERE userId=? AND usedAt IS NULL", [staff.id]);
    await changed(db, "INSERT INTO password_reset_tokens (userId,token,expiresAt,usedAt,createdAt) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR),NULL,UTC_TIMESTAMP())", [staff.id,token]);
    return `/reset-password?token=${encodeURIComponent(token)}`;
  }
  async function loadRevision(db: BusinessStaffConnection, actorId: number, input: { membershipId: number; revision: number }, requireEligible: boolean) {
    const [peek] = await select(db, "SELECT id,ownerUserId,staffUserId FROM business_staff_memberships WHERE id=?", [input.membershipId]);
    if (!peek) fail("NOT_FOUND", "This staff membership no longer exists.");
    if (Number(peek.ownerUserId) === Number(peek.staffUserId)) fail("PRECONDITION_FAILED", "Invalid membership identity.");
    const users = await lockUsers(db,[actorId,Number(peek.ownerUserId),Number(peek.staffUserId)]);
    await assertActor(db, users.get(actorId)!);
    const [current] = await select(db, "SELECT id,ownerUserId,staffUserId,status,revision,permissions,orbitRequested FROM business_staff_memberships WHERE id=? FOR UPDATE", [input.membershipId]);
    if (!current || Number(current.ownerUserId) !== Number(peek.ownerUserId) || Number(current.staffUserId) !== Number(peek.staffUserId) || Number(current.revision) !== input.revision) fail("CONFLICT", "The membership revision changed. Refresh before saving.");
    if (requireEligible) { await assertOwner(db,users.get(Number(current.ownerUserId))!); await assertStaff(db,users.get(Number(current.staffUserId))!,Number(current.id)); }
    return { current, staff: users.get(Number(current.staffUserId))! };
  }
  async function searchPeople(actorId: number, raw: z.input<typeof peopleSearchInput>, owners: boolean) {
    const input = peopleSearchInput.parse(raw);
    return transaction(actorId,async db => {
      const actors = await lockUsers(db,[actorId]); await assertActor(db,actors.get(actorId)!);
      const like = escapeLike(input.search);
      const common = "u.role='agent' AND u.isActive=1 AND NOT EXISTS (SELECT 1 FROM agent_record_merges a WHERE a.sourceUserId=u.id) AND NOT EXISTS (SELECT 1 FROM staff_role_assignments j WHERE j.userId=u.id) AND NOT EXISTS (SELECT 1 FROM business_staff_memberships m WHERE m.staffUserId=u.id)";
      const eligibility = owners ? "u.portalStatus='active' AND (SELECT COUNT(*) FROM agent_crm_profiles p WHERE p.userId=u.id)=1 AND EXISTS (SELECT 1 FROM agent_crm_profiles p WHERE p.userId=u.id AND p.agentStatus='active')" : "u.portalStatus IN ('active','onboarding') AND NOT EXISTS (SELECT 1 FROM business_staff_memberships m WHERE m.ownerUserId=u.id)";
      const result = await select(db, `SELECT u.id,u.name,u.email,u.portalStatus FROM users u WHERE ${common} AND ${eligibility} AND (u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!' OR CAST(u.id AS CHAR)=?) ORDER BY u.id LIMIT ? OFFSET ?`, [like,like,input.search,input.pageSize+1,(input.page-1)*input.pageSize]);
      return { items: result.slice(0,input.pageSize).map(r=>({ id:Number(r.id), name:r.name??null,email:r.email??null,status:r.portalStatus })), page:input.page,pageSize:input.pageSize,hasMore:result.length>input.pageSize,candidateType:owners ? "businessOwner" as const : "existingAccount" as const,...orbit };
    });
  }
  return {
    async adminList(actorId: number, raw?: z.input<typeof adminListInput>) {
      const input = adminListInput.parse(raw);
      return transaction(actorId,async db => {
        const actors = await lockUsers(db,[actorId]); await assertActor(db,actors.get(actorId)!);
        const where = ["1=1"], args: any[] = [];
        if (input.status) { where.push("m.status=?"); args.push(input.status); }
        if (input.ownerUserId) { where.push("m.ownerUserId=?"); args.push(input.ownerUserId); }
        if (input.search) { where.push("(o.name LIKE ? ESCAPE '!' OR o.email LIKE ? ESCAPE '!' OR s.name LIKE ? ESCAPE '!' OR s.email LIKE ? ESCAPE '!' OR CAST(o.id AS CHAR)=? OR CAST(s.id AS CHAR)=?)"); args.push(...Array(4).fill(escapeLike(input.search)),input.search,input.search); }
        const result = await select(db, `${projection} WHERE ${where.join(" AND ")} ORDER BY m.id DESC LIMIT ? OFFSET ?`, [...args,input.pageSize+1,(input.page-1)*input.pageSize]);
        return { items:result.slice(0,input.pageSize).map(publicMember),page:input.page,pageSize:input.pageSize,hasMore:result.length>input.pageSize,...orbit };
      });
    },
    searchOwners: (actorId: number, input: z.input<typeof peopleSearchInput>) => searchPeople(actorId,input,true),
    searchAccounts: (actorId: number, input: z.input<typeof peopleSearchInput>) => searchPeople(actorId,input,false),
    async linkExisting(actorId: number, raw: z.input<typeof linkExistingInput>) {
      const input = linkExistingInput.parse(raw);
      return transaction(actorId,async db => {
        const users = await lockUsers(db,[actorId,input.ownerUserId,input.staffUserId]);
        await assertActor(db,users.get(actorId)!); await assertOwner(db,users.get(input.ownerUserId)!); await assertStaff(db,users.get(input.staffUserId)!);
        const saved = await insertMembership(db,actorId,input.ownerUserId,input.staffUserId,input,"link_existing");
        return { success:true as const,membership:await member(db,saved.id),...orbit };
      });
    },
    async createStaff(actorId: number, raw: z.input<typeof createStaffInput>) {
      const input = createStaffInput.parse(raw);
      return transaction(actorId,async db => {
        // Full normalized-email account scan locks the complete users range in ID order,
        // including archived/deactivated users and empty email gaps. Concurrent creators
        // either observe the committed duplicate or get a retryable CONFLICT; never relink.
        const accounts = await select(db, "SELECT id,email FROM users ORDER BY id FOR UPDATE");
        const users = await lockUsers(db,[actorId,input.ownerUserId]);
        await assertActor(db,users.get(actorId)!); await assertOwner(db,users.get(input.ownerUserId)!);
        const archiveEmails = await select(db, "SELECT id FROM agent_record_merges WHERE LOWER(TRIM(sourceEmail))=? ORDER BY id FOR UPDATE", [input.email]);
        if (accounts.some(u => typeof u.email === "string" && u.email.trim().toLowerCase() === input.email) || archiveEmails.length) fail("CONFLICT", "An account or archived identity already uses this email. Select an eligible existing account; no account was created.");
        const hashedPassword = await bcrypt.hash(randomBytes(48).toString("base64url"),12);
        const openId = `business_staff_${randomBytes(18).toString("hex")}`;
        const created = await changed(db, "INSERT INTO users (openId,name,email,loginMethod,role,isActive,portalStatus,tempPassword,mustChangePassword,crmAccess) VALUES (?,?,?,'password','agent',1,'active',?,1,0)", [openId,input.name,input.email,hashedPassword]);
        const staffUserId = Number(created.insertId);
        if (!Number.isSafeInteger(staffUserId) || staffUserId <= 0) fail("PRECONDITION_FAILED", "Account creation could not be verified.");
        const saved = await insertMembership(db,actorId,input.ownerUserId,staffUserId,input,"create_staff");
        const setupUrl = await setup(db,{ id:staffUserId,loginMethod:"password" });
        return { success:true as const,membership:await member(db,saved.id),setupUrl,...orbit };
      });
    },
    async updatePermissions(actorId: number, raw: z.input<typeof updatePermissionsInput>) {
      const input = updatePermissionsInput.parse(raw);
      return transaction(actorId,async db => {
        const { current } = await loadRevision(db,actorId,input,true);
        if (JSON.stringify(readBusinessStaffPermissions(current.permissions)) === JSON.stringify(readBusinessStaffPermissions(input.permissions)) && (Number(current.orbitRequested) === 1) === input.orbitRequested) return { success:true as const,unchanged:true,membership:await member(db,current.id),...orbit };
        const result = await changed(db,"UPDATE business_staff_memberships SET permissions=?,orbitRequested=?,revision=revision+1,updatedAt=UTC_TIMESTAMP() WHERE id=? AND revision=?",[JSON.stringify(input.permissions),input.orbitRequested ? 1 : 0,input.membershipId,input.revision]);
        if (Number(result.affectedRows) !== 1) fail("CONFLICT", "The membership revision changed. Refresh before saving.");
        await audit(db,actorId,{...current,permissions:input.permissions,orbitRequested:input.orbitRequested ? 1 : 0,revision:input.revision+1},"update_permissions",input.reason,current);
        return { success:true as const,unchanged:false,membership:await member(db,current.id),...orbit };
      });
    },
    async setStatus(actorId: number, raw: z.input<typeof setStatusInput>) {
      const input = setStatusInput.parse(raw);
      return transaction(actorId,async db => {
        // Revocation must remain possible when owner/staff is suspended, merged or
        // otherwise ineligible. Reactivation rechecks every current eligibility rule.
        const { current } = await loadRevision(db,actorId,input,input.status === "active");
        if (current.status === input.status) return { success:true as const,unchanged:true,membership:await member(db,current.id),...orbit };
        const result = await changed(db,"UPDATE business_staff_memberships SET status=?,revokedAt=CASE WHEN ?='revoked' THEN UTC_TIMESTAMP() ELSE NULL END,revision=revision+1,updatedAt=UTC_TIMESTAMP() WHERE id=? AND revision=?",[input.status,input.status,input.membershipId,input.revision]);
        if (Number(result.affectedRows) !== 1) fail("CONFLICT", "The membership revision changed. Refresh before saving.");
        await audit(db,actorId,{...current,status:input.status,revision:input.revision+1},input.status === "active" ? "reactivate" : "revoke",input.reason,current);
        return { success:true as const,unchanged:false,membership:await member(db,current.id),...orbit };
      });
    },
    async createSetupLink(actorId: number, raw: z.input<typeof createSetupLinkInput>) {
      const input = createSetupLinkInput.parse(raw);
      return transaction(actorId,async db => {
        const { current,staff } = await loadRevision(db,actorId,input,true);
        if (current.status !== "active") fail("PRECONDITION_FAILED", "Reactivate the eligible staff membership before issuing a setup link.");
        // CAS makes double-submit with the same revision fail before creating another secret.
        const result = await changed(db,"UPDATE business_staff_memberships SET revision=revision+1,updatedAt=UTC_TIMESTAMP() WHERE id=? AND revision=?",[input.membershipId,input.revision]);
        if (Number(result.affectedRows) !== 1) fail("CONFLICT", "The membership revision changed. Refresh before issuing another setup link.");
        const setupUrl = await setup(db,staff);
        await audit(db,actorId,{...current,revision:input.revision+1},"create_setup_link",input.reason,current);
        return { success:true as const,membership:await member(db,current.id),setupUrl,...orbit };
      });
    },
  };
}
export const businessStaffManagement = createBusinessStaffManagement();
