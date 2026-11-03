// Concern-list presentation only. Never changes membership, debt or provider records.
export const DIRECT_DEBIT_CONCERN_MEMBERSHIP_STATUSES = [
  "active", "suspended", "paused",
] as const;

export function resolveMembershipConcernStatus(
  crmStatus: string | null | undefined,
  portalStatus: string | null | undefined,
): string {
  return (crmStatus?.trim() || portalStatus?.trim() || "").toLowerCase();
}

export function isDirectDebitConcernMembership(
  crmStatus: string | null | undefined,
  portalStatus: string | null | undefined,
): boolean {
  const status = resolveMembershipConcernStatus(crmStatus, portalStatus);
  return DIRECT_DEBIT_CONCERN_MEMBERSHIP_STATUSES.some(candidate => candidate === status);
}
