export const STAFF_ROLES = ["instructor", "agent_engagement"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  instructor: "Instructor",
  agent_engagement: "Agent Engagement",
};
export type StaffAccessSnapshot = {
  instructor: boolean;
  engagement: boolean;
  courseIds: number[];
  schemaAvailable: boolean;
};
export const NO_STAFF_ACCESS: StaffAccessSnapshot = {
  instructor: false,
  engagement: false,
  courseIds: [],
  schemaAvailable: true,
};
export function staffAccountEligible(account: {
  role: string;
  isActive: boolean;
  portalStatus: string;
  mustChangePassword: boolean;
  crmStatus?: string | null;
  archived?: boolean;
}): boolean {
  const crm = account.crmStatus?.trim().toLowerCase();
  return (
    account.role === "agent" &&
    account.isActive === true &&
    account.portalStatus === "active" &&
    account.mustChangePassword === false &&
    !account.archived &&
    (!crm || crm === "active")
  );
}
export function normaliseStaffCourseIds(ids: number[]): number[] {
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1))
    throw new Error("Invalid staff course scope");
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}
