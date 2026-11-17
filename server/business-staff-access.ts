import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { agentCrmProfiles, agentRecordMerges, businessStaffMemberships, staffRoleAssignments, users } from "../drizzle/schema";
import { readBusinessStaffPermissions, BUSINESS_STAFF_ORBIT_NOTICE, type BusinessStaffPermissions } from "../shared/business-staff";
export type BusinessStaffActor = { id: number; role: string; isActive?: boolean | number; portalStatus?: string; mustChangePassword?: boolean };
export type BusinessStaffAuthority = {
  managed: boolean; active: boolean; orbitReady: false; orbitNotice: string;
  owner: { id: number; name: string | null; email: null } | null;
  membership: { id: number; ownerUserId: number; staffUserId: number; status: "active" | "revoked"; revision: number; permissions: BusinessStaffPermissions; orbitRequested: boolean } | null;
};
const ordinary = (): BusinessStaffAuthority => ({ managed: false, active: false, orbitReady: false, orbitNotice: BUSINESS_STAFF_ORBIT_NOTICE, owner: null, membership: null });
/** Missing storage is never interpreted as an ordinary unrestricted agent. */
async function readBusinessStaffAuthority(user: BusinessStaffActor): Promise<BusinessStaffAuthority> {
  if (user.role !== "agent" || !Number.isSafeInteger(user.id) || user.id < 1) return ordinary();
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Business staff access cannot be verified." });
  const rows = await db.select({ id: businessStaffMemberships.id, ownerUserId: businessStaffMemberships.ownerUserId, staffUserId: businessStaffMemberships.staffUserId, status: businessStaffMemberships.status, permissions: businessStaffMemberships.permissions, orbitRequested: businessStaffMemberships.orbitRequested, revision: businessStaffMemberships.revision }).from(businessStaffMemberships).where(eq(businessStaffMemberships.staffUserId, user.id)).limit(2);
  if (!rows.length) return ordinary();
  if (rows.length !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "Business staff identity requires review." });
  const row = rows[0];
  const membership = { ...row, permissions: readBusinessStaffPermissions(row.permissions), orbitRequested: row.orbitRequested === true };
  const closed: BusinessStaffAuthority = { managed: true, active: false, membership, owner: null, orbitReady: false, orbitNotice: BUSINESS_STAFF_ORBIT_NOTICE };
  const people = await db.select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive, portalStatus: users.portalStatus, mustChangePassword: users.mustChangePassword }).from(users).where(sql`${users.id} IN (${row.staffUserId}, ${row.ownerUserId})`);
  const staff = people.find(p => p.id === row.staffUserId), owner = people.find(p => p.id === row.ownerUserId);
  if (!staff || !owner || staff.id === owner.id || staff.role !== "agent" || owner.role !== "agent" || !staff.isActive || !owner.isActive || !["active", "onboarding"].includes(staff.portalStatus) || owner.portalStatus !== "active") return closed;
  const merges = await db.select({ id: agentRecordMerges.id }).from(agentRecordMerges).where(sql`${agentRecordMerges.sourceUserId} IN (${row.staffUserId}, ${row.ownerUserId})`).limit(1);
  if (merges.length) return closed;
  const ownerStaff = await db.select({ id: businessStaffMemberships.id }).from(businessStaffMemberships).where(eq(businessStaffMemberships.staffUserId, row.ownerUserId)).limit(1);
  if (ownerStaff.length) return closed;
  const staffBusiness = await db.select({ id: businessStaffMemberships.id }).from(businessStaffMemberships).where(eq(businessStaffMemberships.ownerUserId, row.staffUserId)).limit(1);
  if (staffBusiness.length) return closed;
  const roles = await db.select({ id: staffRoleAssignments.id }).from(staffRoleAssignments).where(sql`${staffRoleAssignments.userId} IN (${row.staffUserId}, ${row.ownerUserId})`).limit(1);
  if (roles.length) return closed;
  const profiles = await db.select({ id: agentCrmProfiles.id, agentStatus: agentCrmProfiles.agentStatus }).from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, owner.id)).limit(2);
  if (profiles.length !== 1 || profiles[0].agentStatus !== "active") return closed;
  return { ...closed, active: row.status === "active" && !staff.mustChangePassword, owner: { id: owner.id, name: owner.name, email: null } };
}
export async function getBusinessStaffAuthority(user: BusinessStaffActor): Promise<BusinessStaffAuthority> {
  try { return await readBusinessStaffAuthority(user); }
  catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Business staff access could not be verified. Refresh and try again." });
  }
}
export async function requireBusinessStaffCapability(user: BusinessStaffActor, permission: keyof BusinessStaffPermissions) {
  const authority = await getBusinessStaffAuthority(user);
  if (!authority.managed || !authority.active || !authority.membership?.permissions[permission]) throw new TRPCError({ code: "FORBIDDEN", message: "This business staff permission is not available." });
  return authority;
}
/** Every authenticated procedure, including legacy public procedures, is checked. */
export async function assertBusinessStaffRouteAllowed(user: BusinessStaffActor | null, path: string, verifiedAuthority?: BusinessStaffAuthority): Promise<void> {
  if (path === "auth.logout") return;
  if (!user || user.role !== "agent" || user.id < 1) return;
  const authority = verifiedAuthority ?? await getBusinessStaffAuthority(user);
  if (!authority.managed) return;
  if (["auth.me", "auth.logout", "auth.changePassword", "auth.loginWithPassword", "auth.forgotPassword", "auth.resetPassword", "businessStaff.mine"].includes(path)) return;
  if (path.startsWith("businessBookings.") && authority.active) return;
  if (path.startsWith("academy.") && authority.active && authority.membership?.permissions.academyAccess) return;
  if (path.startsWith("myAgreements.")) return; // Existing self-owned signing history; no signing campaign.
  if (authority.active && authority.membership?.permissions.resourceAccess && [
    "library.browse", "library.article", "library.webinar", "library.recordView", "library.markCompleted",
    "suppliers.list", "suppliers.get", "suppliers.categories", "suppliers.locations", "suppliers.preferredPartners", "suppliers.listAttachments",
  ].includes(path)) return;
  const bookingReads = [
    "bookings.myBookings", "bookings.quickSearch", "bookings.byId", "bookings.listReimbDocs",
    "notes.list", "notes.byAmendment", "notes.myAllThreads", "notes.myUnansweredThreads", "notes.markThreadRead",
    "amendments.byBooking", "amendments.getLineItems", "refunds.byBooking",
    "reimbursements.getByBooking", "reimbursements.getItemDocs", "reimbursements.auditLog", "reimbursements.myBookingsWithMissingDocs", "reimbursements.agentOutstandingSummary",
    "flightRequests.myRequests", "flightRequests.byBooking", "bookingDocs.list", "payments.listForBooking",
  ];
  const bookingWrites = [
    "bookings.create", "bookings.uploadReimbDoc", "bookings.uploadMessageDoc", "bookings.updatePtsDetails", "bookings.setTopdogRef", "bookings.setCrmRef", "bookings.updateCommission", "bookings.updateGrossData",
    "notes.add", "amendments.submit", "cancellations.submit", "refunds.submit", "reimbursements.addLate", "reimbursements.uploadItemDoc",
    "flightRequests.create", "flightRequests.acceptPriceIncrease", "flightRequests.declinePriceIncrease", "bookingDocs.upload", "payments.createLink", "fnf.applyToBooking",
  ];
  if (authority.active && authority.membership?.permissions.viewBookings && (bookingReads.includes(path) || (authority.membership.permissions.manageBookings && bookingWrites.includes(path)))) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "Use the restricted Business staff workspace. This account cannot access owner financial, ordinary agent or JLT staff operations." });
}
export function notBusinessStaffUser(column: any) {
  return sql`NOT EXISTS (SELECT 1 FROM business_staff_memberships bsm WHERE bsm.staffUserId = ${column})`;
}
