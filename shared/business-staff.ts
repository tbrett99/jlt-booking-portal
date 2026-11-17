export const BUSINESS_STAFF_PERMISSION_KEYS = ["viewBookings", "viewCustomerAmounts", "addBookingNotes", "academyAccess"] as const;
export type BusinessStaffPermissions = Record<typeof BUSINESS_STAFF_PERMISSION_KEYS[number], boolean>;
export const DEFAULT_BUSINESS_STAFF_PERMISSIONS: BusinessStaffPermissions = { viewBookings: true, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: true };
export const BUSINESS_STAFF_PERMISSION_LABELS: Record<keyof BusinessStaffPermissions, string> = {
  viewBookings: "View this business owner's non-personal bookings",
  viewCustomerAmounts: "View customer selling prices (not commission or supplier net costs)",
  addBookingNotes: "Post notes in the separate business-staff booking channel",
  academyAccess: "Use their own enrolled Academy courses (existing course access rules still apply)",
};
export function readBusinessStaffPermissions(value: unknown): BusinessStaffPermissions {
  let parsed = value;
  if (typeof value === "string") { try { parsed = JSON.parse(value); } catch { parsed = null; } }
  const result = { viewBookings: false, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: false };
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) for (const key of BUSINESS_STAFF_PERMISSION_KEYS) result[key] = (parsed as Record<string, unknown>)[key] === true;
  if (!result.viewBookings) { result.viewCustomerAmounts = false; result.addBookingNotes = false; }
  return result;
}
export const BUSINESS_STAFF_ORBIT_NOTICE = "Orbit business-staff sign-in is awaiting Orbit-side support. Staff must retain their own identity; this must not sign them in as the business owner.";
