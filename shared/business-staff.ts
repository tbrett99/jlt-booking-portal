const LEGACY_BUSINESS_STAFF_PERMISSION_KEYS = ["viewBookings", "viewCustomerAmounts", "addBookingNotes", "academyAccess"] as const;
const RESOURCE_BUSINESS_STAFF_PERMISSION_KEYS = [...LEGACY_BUSINESS_STAFF_PERMISSION_KEYS, "resourceAccess"] as const;
export const BUSINESS_STAFF_PERMISSION_KEYS = [...RESOURCE_BUSINESS_STAFF_PERMISSION_KEYS, "manageBookings"] as const;
export type BusinessStaffPermissions = Record<typeof BUSINESS_STAFF_PERMISSION_KEYS[number], boolean>;
export const DEFAULT_BUSINESS_STAFF_PERMISSIONS: BusinessStaffPermissions = { viewBookings: true, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: true, resourceAccess: true, manageBookings: true };
export const BUSINESS_STAFF_PERMISSION_LABELS: Record<keyof BusinessStaffPermissions, string> = {
  viewBookings: "View this business owner's non-personal bookings using the normal booking pages (including booking figures)",
  viewCustomerAmounts: "Legacy simplified-view selling-price permission",
  addBookingNotes: "Post notes in the separate legacy business-staff channel",
  academyAccess: "Use their own enrolled Academy courses (existing course access rules still apply)",
  resourceAccess: "Browse supplier information, published Knowledge Base, webinars and fees (no supplier credentials or owner finances)",
  manageBookings: "Message support, upload booking documents and submit/manage normal booking requests (no commission claims)",
};
export function readBusinessStaffPermissions(value: unknown): BusinessStaffPermissions {
  let parsed = value;
  if (typeof value === "string") { try { parsed = JSON.parse(value); } catch { parsed = null; } }
  const result: BusinessStaffPermissions = { viewBookings: false, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: false, resourceAccess: false, manageBookings: false };
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const permissions = parsed as Record<string, unknown>;
    for (const key of LEGACY_BUSINESS_STAFF_PERMISSION_KEYS) result[key] = permissions[key] === true;
    const keys = Object.keys(permissions);
    const properLegacyValues = LEGACY_BUSINESS_STAFF_PERMISSION_KEYS.every(key => Object.prototype.hasOwnProperty.call(permissions, key) && typeof permissions[key] === "boolean");
    const isLegacy = keys.length === LEGACY_BUSINESS_STAFF_PERMISSION_KEYS.length && keys.every(key => (LEGACY_BUSINESS_STAFF_PERMISSION_KEYS as readonly string[]).includes(key));
    const isResourceVersion = keys.length === RESOURCE_BUSINESS_STAFF_PERMISSION_KEYS.length && keys.every(key => (RESOURCE_BUSINESS_STAFF_PERMISSION_KEYS as readonly string[]).includes(key)) && typeof permissions.resourceAccess === "boolean";
    const isCurrent = keys.length === BUSINESS_STAFF_PERMISSION_KEYS.length && keys.every(key => (BUSINESS_STAFF_PERMISSION_KEYS as readonly string[]).includes(key)) && typeof permissions.resourceAccess === "boolean" && typeof permissions.manageBookings === "boolean";
    result.resourceAccess = properLegacyValues && (isLegacy || ((isResourceVersion || isCurrent) && permissions.resourceAccess === true));
    // The owner-approved normal staff-booking policy applies to complete existing
    // links. An explicitly saved current false is retained; malformed data grants
    // no new capability. Read-only settings remain available through this toggle.
    result.manageBookings = properLegacyValues && (isLegacy || isResourceVersion || (isCurrent && permissions.manageBookings === true));
  }
  if (!result.viewBookings) { result.viewCustomerAmounts = false; result.addBookingNotes = false; result.manageBookings = false; }
  return result;
}
export const BUSINESS_STAFF_ORBIT_NOTICE = "Orbit business-staff sign-in is awaiting Orbit-side support. Staff must retain their own identity; this must not sign them in as the business owner.";
