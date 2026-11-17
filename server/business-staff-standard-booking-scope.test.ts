import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName } from "drizzle-orm";
import { bookings, users, businessStaffMemberships, businessStaffAudit, agentCrmProfiles, staffRoleAssignments, agentRecordMerges, bookingDocuments, notes, reimbursementItemDocs, reimbursementItems } from "../drizzle/schema";
import { DEFAULT_BUSINESS_STAFF_PERMISSIONS, readBusinessStaffPermissions } from "../shared/business-staff";
import type { TrpcContext } from "./_core/context";
const external = vi.hoisted(() => ({ getDb: vi.fn(), booking: vi.fn(), put: vi.fn(), decrypt: vi.fn(), authenticate: vi.fn() }));
vi.mock("./db", () => ({ getDb: external.getDb, getBookingById: external.booking }));
vi.mock("./storage", () => ({ storagePutEncrypted: external.put, storageGetDecrypted: external.decrypt }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: external.authenticate } }));
import { assertBookingActorAccess, getBookingActorScope, withBookingActorWrite, withoutStaffClaimFields } from "./business-staff-booking-scope";
import { uploadPrivateStaffBookingDocument, registerBookingDocumentDownloadRoutes, canonicalBookingDocumentProvider, assertSharedBookingAttachmentReferences, registerSharedBookingAttachmentDownloadRoutes, sharedBookingAttachmentUrl, sharedBookingNoteAttachments } from "./booking-document-download-routes";
import { assertBusinessStaffRouteAllowed } from "./business-staff-access";
const dialect = new MySqlDialect();
let allowedNetwork = false;
const permissions = { ...DEFAULT_BUSINESS_STAFF_PERMISSIONS };
const owner = { id: 10, role: "agent", isActive: true, portalStatus: "active", mustChangePassword: false, name: "Synthetic Owner" };
const employee = { ...owner, id: 20, name: "Synthetic Employee" };
const booking = { id: 100, agentId: 10, isPersonalBooking: false, currentStage: "Added to PTS" };
const member = { id: 50, staffUserId: 20, ownerUserId: 10, status: "active", permissions, revision: 3 };
const authority = () => ({ managed: true as const, active: true, membership: { ...member, permissions: { ...permissions } }, owner });
const context = () => ({ user: employee, businessStaffAuthority: authority() } as unknown as TrpcContext);
type Rows = Record<string, any>[];
function fixture() {
 const rows = new Map<any, Rows>([[users, [structuredClone(owner), structuredClone(employee)]], [businessStaffMemberships, [structuredClone(member)]], [agentCrmProfiles, [{ id: 1, userId: 10, agentStatus: "active" }]], [staffRoleAssignments, []], [agentRecordMerges, []], [bookings, [structuredClone(booking)]], [businessStaffAudit, []], [bookingDocuments, []], [notes, []], [reimbursementItemDocs, []], [reimbursementItems, []]]);
 const events: any[] = []; let beforeTransaction: (() => void) | undefined; let auditFails = false;
 const matches = (row: any, table: any, condition: any) => {
  if (!condition) return true;
  const query = dialect.sqlToQuery(condition); const name = getTableName(table); const pattern = /`([^`]+)`\.`([^`]+)`\s*=\s*\?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(query.sql))) {
   if (match[1] !== name) continue;
   const index = (query.sql.slice(0, match.index).match(/\?/g) ?? []).length;
   if (row[match[2]] !== query.params[index]) return false;
  }
  return true;
 };
 function connection(state: Map<any, Rows>, transactional: boolean): any {
  return {
   select: (fields?: any) => {
    let table: any, condition: any, limit = Infinity, locked = false;
    const query: any = { from: (value: any) => { table = value; return query; }, where: (value: any) => { condition = value; return query; }, limit: (value: number) => { limit = value; return query; }, orderBy: () => query, for: () => { locked = true; expect(transactional).toBe(true); return query; }, then: (resolve: any, reject: any) => Promise.resolve().then(() => {
     if (!state.has(table)) throw new Error("Unexpected table; live/financial data forbidden");
     events.push({ kind: "select", table: getTableName(table), locked, transactional });
     return state.get(table)!.filter(row => matches(row, table, condition)).slice(0, limit).map(row => fields ? Object.fromEntries(Object.entries(fields).map(([key, column]: any) => [key, row[column.name]])) : { ...row });
    }).then(resolve, reject) }; return query;
   },
   insert: (table: any) => ({ values: async (value: any) => { expect(transactional).toBe(true); if (table === businessStaffAudit && auditFails) throw new Error("Synthetic audit failure"); const id = 200 + state.get(table)!.length; state.get(table)!.push({ id, ...value }); events.push({ kind: "insert", table: getTableName(table), value, transactional }); return [{ insertId: id }]; } }),
   update: (table: any) => ({ set: (values: any) => ({ where: async (condition: any) => { expect(transactional).toBe(true); for (const row of state.get(table)!) if (matches(row, table, condition)) Object.assign(row, values); events.push({ kind: "update", table: getTableName(table), transactional }); } }) }),
   transaction: async (work: any) => { beforeTransaction?.(); const clone = new Map(Array.from(rows, ([table, values]) => [table, structuredClone(values)])); try { const result = await work(connection(clone, true)); for (const [table, values] of Array.from(clone)) rows.set(table, values); events.push({ kind: "commit" }); return result; } catch (error) { events.push({ kind: "rollback" }); throw error; } },
  };
 }
 const db = connection(rows, false); external.getDb.mockResolvedValue(db); external.booking.mockImplementation(async (id: number, writer?: any) => {
  const connection = writer ?? db; const { eq } = await import("drizzle-orm"); const [record] = await connection.select().from(bookings).where(eq(bookings.id, id)); return record;
 });
 return { rows, events, db, member: rows.get(businessStaffMemberships)![0], booking: rows.get(bookings)![0], before: (callback: () => void) => { beforeTransaction = callback; }, failAudit: () => { auditFails = true; } };
}
beforeEach(() => { allowedNetwork = false; vi.clearAllMocks(); external.put.mockResolvedValue({ key: "not-used-as-identity" }); external.decrypt.mockResolvedValue(Buffer.from("synthetic-pdf")); external.authenticate.mockResolvedValue(employee); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); })); });
afterEach(() => { if (!allowedNetwork) expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe("normal business booking scope and atomic employee writes", () => {
 it("separates employee actor from the verified owner", async () => { expect(await getBookingActorScope(context(), "operate")).toEqual({ managed: true, actorUserId: 20, ownerUserId: 10, membershipId: 50 }); });
 it.each([{ agentId: 99, isPersonalBooking: false }, { agentId: 10, isPersonalBooking: true }, { agentId: 10 }, { agentId: 10, isPersonalBooking: null }])("denies wrong business/personal/unknown visibility %j", async record => { await expect(assertBookingActorAccess(context(), record)).rejects.toMatchObject({ code: "FORBIDDEN" }); });
 it("retains read-only mode but does not operate when management is disabled", async () => { const ctx = context(); ctx.businessStaffAuthority!.membership!.permissions.manageBookings = false; await expect(getBookingActorScope(ctx, "read")).resolves.toMatchObject({ ownerUserId: 10 }); await expect(getBookingActorScope(ctx, "operate")).rejects.toMatchObject({ code: "FORBIDDEN" }); });
 it("keeps ordinary agent identity and denies another owner's booking", async () => { const ctx = { user: employee, businessStaffAuthority: null } as any; await expect(getBookingActorScope(ctx)).resolves.toMatchObject({ managed: false, ownerUserId: 20 }); await expect(assertBookingActorAccess(ctx, booking)).rejects.toMatchObject({ code: "FORBIDDEN" }); });
 it("strips only claim pre-authorisation flags, not normal booking figures", () => { expect(withoutStaffClaimFields({ expectedCommission: 50, grossCost: 1000, commissionPreAuthorised: true, commissionPreAuthorisedAt: new Date(), commissionPreAuthorisedById: 10 })).toEqual({ expectedCommission: 50, grossCost: 1000 }); });
 it("commits the actual actor audit and booking work on the same writer", async () => { const f = fixture(); const work = vi.fn(async (writer, scope) => { expect(writer).not.toBe(f.db); expect(scope.actorUserId).toBe(20); return { id: 333 }; }); await withBookingActorWrite(context(), 100, work); expect(work).toHaveBeenCalledOnce(); expect(f.rows.get(businessStaffAudit)![0]).toMatchObject({ membershipId: 50, actorUserId: 20, afterState: { ownerUserId: 10, bookingId: 100, entityId: 333, membershipRevision: 3 } }); expect(f.events.filter(event => event.kind === "select").every(event => event.locked && event.transactional)).toBe(true); });
 it.each(["revoked", "permission", "owner", "personal", "staff-disabled", "owner-disabled", "owner-crm"])("rechecks %s immediately before any committed write", async change => { const f = fixture(); f.before(() => { if (change === "revoked") f.member.status = "revoked"; if (change === "permission") f.member.permissions.manageBookings = false; if (change === "owner") f.member.ownerUserId = 99; if (change === "personal") f.booking.isPersonalBooking = true; if (change === "staff-disabled") f.rows.get(users)![1].isActive = false; if (change === "owner-disabled") f.rows.get(users)![0].portalStatus = "suspended"; if (change === "owner-crm") f.rows.get(agentCrmProfiles)![0].agentStatus = "cancelled"; }); const work = vi.fn(); await expect(withBookingActorWrite(context(), 100, work)).rejects.toBeDefined(); expect(work).not.toHaveBeenCalled(); expect(f.rows.get(businessStaffAudit)).toEqual([]); expect(f.events).toContainEqual({ kind: "rollback" }); });
 it("rolls back a dependent booking change when the audit cannot be recorded", async () => { const f = fixture(); f.failAudit(); const { eq } = await import("drizzle-orm"); await expect(withBookingActorWrite(context(), 100, async writer => { await writer.update(bookings).set({ currentStage: "Amendment Requested" }).where(eq(bookings.id, 100)); return { id: 44 }; })).rejects.toThrow("Synthetic audit"); expect(f.rows.get(bookings)![0].currentStage).toBe("Added to PTS"); expect(f.rows.get(businessStaffAudit)).toEqual([]); });
 it.each(["commissionClaims.create", "commissionClaims.myTopUpRequests", "bookings.togglePreAuth", "payments.manualMarkPaid", "crm.getSsoUrl", "bookings.adminUpdateGrossData"])("does not grant %s by knowing its URL", async path => { fixture(); await expect(assertBusinessStaffRouteAllowed(employee as any, path)).rejects.toMatchObject({ code: "FORBIDDEN" }); });
 it.each(["bookings.myBookings", "bookings.byId", "notes.list", "notes.add", "amendments.submit", "refunds.submit", "cancellations.submit", "flightRequests.create", "reimbursements.addLate", "bookingDocs.upload", "payments.createLink"])("allows exactly the normal permitted %s path", async path => { fixture(); await expect(assertBusinessStaffRouteAllowed(employee as any, path)).resolves.toBeUndefined(); });
 it("does not infer management from malformed permissions or override saved false", () => { expect(readBusinessStaffPermissions({ ...permissions, manageBookings: false }).manageBookings).toBe(false); expect(readBusinessStaffPermissions({ ...permissions, manageBookings: "true" }).manageBookings).toBe(false); expect(readBusinessStaffPermissions({ viewBookings: true }).manageBookings).toBe(false); });
});
describe("private staff booking documents", () => {
 it("generates a private key and registers an owner-booking-bound employee receipt atomically", async () => { const f = fixture(); const result = await uploadPrivateStaffBookingDocument(context(), { bookingId: 100, fileName: "synthetic.pdf", mimeType: "application/pdf", fileBase64: Buffer.from("PDF").toString("base64") }, async (_writer, doc) => doc); expect(external.put.mock.calls[0][0]).toMatch(/^booking-private\/shared-documents\/100\/[\w-]+\.enc$/); expect(result.url).toMatch(/^\/api\/booking-documents\/200\/download$/); expect(f.rows.get(bookingDocuments)![0]).toMatchObject({ bookingId: 100, uploadedById: 20, fileUrl: result.url }); expect(f.rows.get(businessStaffAudit)![0].actorUserId).toBe(20); });
 it("rechecks revoked authority after external upload and registers nothing", async () => { const f = fixture(); external.put.mockImplementationOnce(async () => { f.member.status = "revoked"; return { key: "ignored" }; }); await expect(uploadPrivateStaffBookingDocument(context(), { bookingId: 100, fileName: "synthetic.pdf", mimeType: "application/pdf", fileBase64: "UERG" }, async (_writer, doc) => doc)).rejects.toBeDefined(); expect(f.rows.get(bookingDocuments)).toEqual([]); expect(f.rows.get(businessStaffAudit)).toEqual([]); });
 it("rolls back document registration if its dependent record cannot save", async () => { const f = fixture(); await expect(uploadPrivateStaffBookingDocument(context(), { bookingId: 100, fileName: "synthetic.pdf", mimeType: "application/pdf", fileBase64: "UERG" }, async () => { throw new Error("Synthetic linked item failure"); })).rejects.toThrow("linked item"); expect(f.rows.get(bookingDocuments)).toEqual([]); });
 it("accepts only booking-bound registered attachment references", async () => { const f = fixture(); f.rows.get(bookingDocuments)!.push({ id: 4, bookingId: 100, fileKey: "booking-private/shared-messages/100/abcdefghijklmnopqrstuvwx.enc", fileUrl: "/api/booking-documents/4/download" }); await expect(assertSharedBookingAttachmentReferences("[Attachment: x](/api/booking-documents/4/download)", 100)).resolves.toBeUndefined(); await expect(assertSharedBookingAttachmentReferences("[Attachment: x](/api/booking-documents/99/download)", 100)).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(assertSharedBookingAttachmentReferences("[Attachment: x](/api/booking-documents/4/download)", 999)).rejects.toMatchObject({ code: "FORBIDDEN" }); });
 it.each(["https://evil.example.test/x", "https://d2xsxph8kpxj0f.cloudfront.net/other-project/file", "https://user:pass@d2xsxph8kpxj0f.cloudfront.net/file", "http://evil.example.test/x"])("never fetches an arbitrary provider URL %s", url => { expect(canonicalBookingDocumentProvider({ fileKey: "file.pdf", fileUrl: url })).toBeNull(); });
 it("streams row-bound private bytes and never discloses the storage key", async () => { const f = fixture(); f.rows.get(bookingDocuments)!.push({ id: 200, bookingId: 100, fileKey: "booking-private/shared-documents/100/abcdefghijklmnopqrstuvwx.enc", fileUrl: "/api/booking-documents/200/download", displayName: "synthetic.pdf", mimeType: "application/pdf" }); let handler: any; registerBookingDocumentDownloadRoutes({ get: (_path: string, callback: any) => { handler = callback; } } as any); const response: any = { statusCode: 200, headers: {} as any, set(values: any) { Object.assign(this.headers, values); return this; }, send: vi.fn(), status(code: number) { this.statusCode = code; return this; }, json: vi.fn(), end: vi.fn(), setHeader(name: string, value: any) { this.headers[name] = value; } }; await handler({ params: { id: "200" } }, response); expect(response.statusCode).toBe(200); expect(response.send).toHaveBeenCalledWith(Buffer.from("synthetic-pdf")); expect(response.headers["Cache-Control"]).toBe("private, no-store, max-age=0"); expect(JSON.stringify(response.headers)).not.toContain("booking-private"); });
});

async function downloadFixture(f: ReturnType<typeof fixture>, id = "200") {
 let handler: any;
 registerBookingDocumentDownloadRoutes({ get: (_path: string, callback: any) => { handler = callback; } } as any);
 const response: any = { statusCode: 200, headers: {}, headersSent: false, set(values: any) { Object.assign(this.headers, values); return this; }, status(code: number) { this.statusCode = code; return this; }, json: vi.fn(), end: vi.fn(), send: vi.fn(), redirect: vi.fn() };
 await handler({ params: { id } }, response);
 return response;
}
function seedDocument(f: ReturnType<typeof fixture>) {
 f.rows.get(bookingDocuments)!.push({ id: 200, bookingId: 100, fileKey: "booking-private/shared-documents/100/abcdefghijklmnopqrstuvwx.enc", fileUrl: "/api/booking-documents/200/download", displayName: "synthetic.pdf", mimeType: "application/pdf" });
}
describe("actual private booking HTTP ownership and revocation checks", () => {
 it.each(["another-business", "personal", "revoked", "permission", "missing-row", "wrong-private-key", "wrong-url", "unauthenticated"])("withholds %s without decrypting or leaking file details", async change => {
  const f = fixture(); seedDocument(f);
  if (change === "another-business") f.booking.agentId = 99;
  if (change === "personal") f.booking.isPersonalBooking = true;
  if (change === "revoked") f.member.status = "revoked";
  if (change === "permission") f.member.permissions.viewBookings = false;
  if (change === "missing-row") f.rows.get(bookingDocuments)!.length = 0;
  if (change === "wrong-private-key") f.rows.get(bookingDocuments)![0].fileKey = "booking-private/shared-documents/999/abcdefghijklmnopqrstuvwx.enc";
  if (change === "wrong-url") f.rows.get(bookingDocuments)![0].fileUrl = "/api/booking-documents/999/download";
  if (change === "unauthenticated") external.authenticate.mockResolvedValueOnce(null);
  const response = await downloadFixture(f);
  expect([401, 403, 404]).toContain(response.statusCode); expect(response.send).not.toHaveBeenCalled(); expect(external.decrypt).not.toHaveBeenCalled(); expect(response.redirect).not.toHaveBeenCalled();
 });
 it.each(["revoked", "owner-change", "staff-disabled", "personal"])("rechecks %s after slow private storage, before sending any bytes", async change => {
  const f = fixture(); seedDocument(f);
  external.decrypt.mockImplementationOnce(async () => { if (change === "revoked") f.member.status = "revoked"; if (change === "owner-change") f.booking.agentId = 99; if (change === "staff-disabled") f.rows.get(users)![1].isActive = false; if (change === "personal") f.booking.isPersonalBooking = true; return Buffer.from("private withheld bytes"); });
  const response = await downloadFixture(f); expect(response.statusCode).toBe(403); expect(response.send).not.toHaveBeenCalled(); expect(response.headers).toEqual({});
 });
 it("lets the real business owner download the same staff-uploaded file without impersonating the employee", async () => { const f = fixture(); seedDocument(f); external.authenticate.mockResolvedValueOnce(owner); const response = await downloadFixture(f); expect(response.statusCode).toBe(200); expect(response.send).toHaveBeenCalledWith(Buffer.from("synthetic-pdf")); });
 it.each(["0", "NaN", "200x", "-1", "9007199254740993"])("rejects malformed document identity %s before private storage", async id => { const f = fixture(); seedDocument(f); const response = await downloadFixture(f, id); expect(response.statusCode).toBe(404); expect(external.decrypt).not.toHaveBeenCalled(); });
});

const syntheticProvider = "https://d2xsxph8kpxj0f.cloudfront.net/310419663026820811/PdcDVQRp8zC2FzsyWBWptW/msg-attachments/synthetic.pdf";
function seedShared(f: ReturnType<typeof fixture>, kind: "message" | "reimbursement") {
 if (kind === "message") f.rows.get(notes)!.push({ id: 300, bookingId: 100, isInternal: false, content: `[Attachment: synthetic.pdf](${syntheticProvider})` });
 else { f.rows.get(reimbursementItemDocs)!.push({ id: 300, reimbursementItemId: 400, bookingId: 100, fileUrl: syntheticProvider, fileKey: "synthetic.pdf", fileName: "synthetic.pdf" }); f.rows.get(reimbursementItems)!.push({ id: 400, bookingId: 100, agentId: 10 }); }
}
async function sharedDownload(kind: "message" | "reimbursement", altered: Record<string, any> = {}) {
 let handler: any; registerSharedBookingAttachmentDownloadRoutes({ get: (_path: string, callback: any) => { handler = callback; } } as any);
 const url = new URL(sharedBookingAttachmentUrl(kind, 300, 0, syntheticProvider), "https://synthetic.invalid");
 const response: any = { statusCode: 200, headers: {}, headersSent: false, set(values: any) { Object.assign(this.headers, values); return this; }, status(code: number) { this.statusCode = code; return this; }, send: vi.fn(), end: vi.fn(), redirect: vi.fn() };
 await handler({ params: { kind, id: "300", index: "0", ...(altered.params ?? {}) }, query: { fingerprint: url.searchParams.get("fingerprint"), ...(altered.query ?? {}) } }, response);
 return response;
}
describe("actual normal support/reimbursement row-bound attachment compatibility", () => {
 it.each(["message", "reimbursement"] as const)("streams a known shared %s attachment without a caller-provided key", async kind => { const f = fixture(); seedShared(f, kind); allowedNetwork = true; vi.mocked(fetch).mockImplementation(async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("synthetic shared bytes").buffer }) as Response); const response = await sharedDownload(kind); expect(response.statusCode).toBe(200); expect(response.send).toHaveBeenCalledWith(Buffer.from("synthetic shared bytes")); expect(vi.mocked(fetch).mock.calls[0][0]).toBe(syntheticProvider); expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe("manual"); });
 it("rewrites a staff-visible historic/support note to its real note identity while leaving unapproved URLs unlaundered", async () => { const f = fixture(); seedShared(f, "message"); const result = await sharedBookingNoteAttachments([{ id: 300, content: `[Attachment: synthetic.pdf](${syntheticProvider}) [Attachment: unknown](https://evil.example.invalid/x)` }], 100); expect(result[0].content).toContain(sharedBookingAttachmentUrl("message", 300, 0, syntheticProvider)); expect(result[0].content).toContain("https://evil.example.invalid/x"); });
 it.each(["internal-note", "other-booking", "personal", "revoked", "visibility", "missing-note", "wrong-fingerprint", "invalid-index", "unapproved-provider"])("denies %s before any upstream fetch", async change => { const f = fixture(); seedShared(f, "message"); const altered: any = {};
  if (change === "internal-note") f.rows.get(notes)![0].isInternal = true;
  if (change === "other-booking") f.booking.agentId = 99;
  if (change === "personal") f.booking.isPersonalBooking = true;
  if (change === "revoked") f.member.status = "revoked";
  if (change === "visibility") f.member.permissions.viewBookings = false;
  if (change === "missing-note") f.rows.get(notes)!.length = 0;
  if (change === "wrong-fingerprint") altered.query = { fingerprint: "0".repeat(64) };
  if (change === "invalid-index") altered.params = { index: "999" };
  if (change === "unapproved-provider") f.rows.get(notes)![0].content = "[Attachment: x](https://evil.example.invalid/x)";
  const response = await sharedDownload("message", altered); expect([403, 404]).toContain(response.statusCode); expect(response.send).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
 });
 it.each(["relinked-item", "wrong-owner", "missing-item"])("denies reimbursement evidence with %s before upstream access", async change => { const f = fixture(); seedShared(f, "reimbursement"); if (change === "relinked-item") f.rows.get(reimbursementItems)![0].bookingId = 999; if (change === "wrong-owner") f.rows.get(reimbursementItems)![0].agentId = 99; if (change === "missing-item") f.rows.get(reimbursementItems)!.length = 0; const response = await sharedDownload("reimbursement"); expect([403, 404]).toContain(response.statusCode); expect(fetch).not.toHaveBeenCalled(); });
 it.each(["revoked", "note-hidden", "changed-attachment", "owner-change"])("withholds bytes when %s changes during upstream retrieval", async change => { const f = fixture(); seedShared(f, "message"); allowedNetwork = true; vi.mocked(fetch).mockImplementation(async () => ({ ok: true, status: 200, arrayBuffer: async () => { if (change === "revoked") f.member.status = "revoked"; if (change === "note-hidden") f.rows.get(notes)![0].isInternal = true; if (change === "changed-attachment") f.rows.get(notes)![0].content = `[Attachment: other](${syntheticProvider}x)`; if (change === "owner-change") f.booking.agentId = 99; return new TextEncoder().encode("withheld bytes").buffer; } }) as Response); const response = await sharedDownload("message"); expect([403, 404]).toContain(response.statusCode); expect(response.send).not.toHaveBeenCalled(); expect(response.headers).toEqual({}); });
});
