import type { User } from "../drizzle/schema";
/** Authentication reads keep hashes internally; responses never do. */
export function publicAuthIdentity(user: User, businessStaffOnly = false) {
  return {
    id: user.id, openId: user.openId, name: user.name, email: user.email,
    loginMethod: user.loginMethod, role: user.role, isActive: user.isActive,
    mustChangePassword: user.mustChangePassword, phone: user.phone,
    credentialsSentAt: user.credentialsSentAt, portalStatus: user.portalStatus,
    crmAccess: businessStaffOnly ? false : user.crmAccess,
    crmEmail: businessStaffOnly ? null : user.crmEmail,
    ...(businessStaffOnly ? {} : { commissionRatePct: user.commissionRatePct }),
    suspendedAt: user.suspendedAt, suspensionReason: user.suspensionReason,
    createdAt: user.createdAt, updatedAt: user.updatedAt, lastSignedIn: user.lastSignedIn,
  };
}
