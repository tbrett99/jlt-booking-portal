import type { BusinessStaffActor } from "./business-staff-access";
import { getBusinessStaffAuthority } from "./business-staff-access";
/** The legacy Orbit/OAuth flows have no distinct employee and owner scope. */
export async function legacyExternalSignInAllowed(user: BusinessStaffActor): Promise<boolean> {
  if ((user.isActive !== true && user.isActive !== 1) || ["cancelled", "paused", "suspended"].includes(user.portalStatus ?? "") || user.mustChangePassword === true) return false;
  const authority = await getBusinessStaffAuthority(user);
  return !authority.managed;
}
