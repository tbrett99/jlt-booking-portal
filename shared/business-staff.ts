const LEGACY_BUSINESS_STAFF_PERMISSION_KEYS = ["viewBookings", "viewCustomerAmounts", "addBookingNotes", "academyAccess"] as const;
export const BUSINESS_STAFF_PERMISSION_KEYS = [...LEGACY_BUSINESS_STAFF_PERMISSION_KEYS, "resourceAccess"] as const;
export type BusinessStaffPermissions = Record<typeof BUSINESS_STAFF_PERMISSION_KEYS[number], boolean>;
export const DEFAULT_BUSINESS_STAFF_PERMISSIONS: BusinessStaffPermissions = { viewBookings: true, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: true, resourceAccess: true };
export const BUSINESS_STAFF_PERMISSION_LABELS: Record<keyof BusinessStaffPermissions, string> = {
  viewBookings: "View this business owner's non-personal bookings",
  viewCustomerAmounts: "View customer selling prices (not commission or supplier net costs)",
  addBookingNotes: "Post notes in the separate business-staff booking channel",
  academyAccess: "Use their own enrolled Academy courses (existing course access rules still apply)",
  resourceAccess: "Browse supplier information, published Knowledge Base, webinars and fees (no supplier credentials or owner finances)",
};
export function readBusinessStaffPermissions(value: unknown): BusinessStaffPermissions {
  let parsed = value;
  if (typeof value === "string") { try { parsed = JSON.parse(value); } catch { parsed = null; } }
  const result: BusinessStaffPermissions = { viewBookings: false, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: false, resourceAccess: false };
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const permissions = parsed as Record<string, unknown>;
    // Retain the existing exact-true behavior for the original four permissions.
    for (const key of LEGACY_BUSINESS_STAFF_PERMISSION_KEYS) result[key] = permissions[key] === true;
    const keys = Object.keys(permissions);
    const properLegacyValues = LEGACY_BUSINESS_STAFF_PERMISSION_KEYS.every(key => Object.prototype.hasOwnProperty.call(permissions, key) && typeof permissions[key] === "boolean");
    const isLegacy = keys.length === LEGACY_BUSINESS_STAFF_PERMISSION_KEYS.length && keys.every(key => (LEGACY_BUSINESS_STAFF_PERMISSION_KEYS as readonly string[]).includes(key));
    const isCurrent = keys.length === BUSINESS_STAFF_PERMISSION_KEYS.length && keys.every(key => (BUSINESS_STAFF_PERMISSION_KEYS as readonly string[]).includes(key)) && typeof permissions.resourceAccess === "boolean";
    // Only a complete, known boolean object receives the compatibility default.
    // Explicit current false is never replaced, and partial/malformed objects fail closed.
    result.resourceAccess = properLegacyValues && (isLegacy || (isCurrent && permissions.resourceAccess === true));
  }
  if (!result.viewBookings) { result.viewCustomerAmounts = false; result.addBookingNotes = false; }
  return result;
}
export const BUSINESS_STAFF_ORBIT_NOTICE = "Orbit business-staff sign-in is awaiting Orbit-side support. Staff must retain their own identity; this must not sign them in as the business owner.";
