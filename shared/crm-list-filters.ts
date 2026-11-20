export const CRM_MEMBERSHIP_OPTIONS = [
  { value: "business_class", label: "Business Class" },
  { value: "business_duo", label: "Business Duo" },
  { value: "business_trio", label: "Business Trio" },
  { value: "first_class", label: "First Class" },
  { value: "first_class_duo", label: "First Class Duo" },
  { value: "first_class_trio", label: "First Class Trio" },
  { value: "economy", label: "Economy" },
  { value: "core", label: "CORE" },
  { value: "charter", label: "Charter" },
  { value: "unknown", label: "Other / unknown" },
  { value: "unset", label: "Not set" },
] as const;

export const CRM_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "in_notice", label: "In Notice" },
  { value: "suspended", label: "Suspended" },
  { value: "cancelled", label: "Cancelled" },
  { value: "unknown", label: "Other / unknown" },
] as const;

export type CrmMembershipFilter = typeof CRM_MEMBERSHIP_OPTIONS[number]["value"];
export type CrmStatusFilter = typeof CRM_STATUS_OPTIONS[number]["value"];

export type CrmFilterAgent = {
  name?: string | null;
  email?: string | null;
  portalStatus?: string | null;
  crmProfile?: {
    membershipTier?: string | null;
    agentStatus?: string | null;
    teamId?: number | null;
    uniqueAgentId?: string | null;
    jltEmail?: string | null;
    businessName?: string | null;
  } | null;
};
export type CrmFilterTeam = { id: number; membershipTier?: string | null };

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

export function canonicalCrmMembership(value?: string | null): CrmMembershipFilter {
  if (!value?.trim()) return "unset";
  const key = normalize(value);
  const aliases: Record<string, CrmMembershipFilter> = {
    business_class_duo: "business_duo",
    business_class_trio: "business_trio",
  };
  if (aliases[key]) return aliases[key];
  return CRM_MEMBERSHIP_OPTIONS.find(option => option.value !== "unknown" && option.value !== "unset" && option.value === key)?.value ?? "unknown";
}

/** Only current linked team / CRM fields are used. Never infer a tier from a signed join session or contract. */
export function currentCrmMembership(agent: CrmFilterAgent, teams: readonly CrmFilterTeam[] = []) {
  const team = agent.crmProfile?.teamId != null
    ? teams.find(item => item.id === agent.crmProfile!.teamId)
    : undefined;
  const raw = team?.membershipTier?.trim() ? team.membershipTier : agent.crmProfile?.membershipTier;
  const value = canonicalCrmMembership(raw);
  const label = value === "unknown" ? raw!.trim() : CRM_MEMBERSHIP_OPTIONS.find(option => option.value === value)!.label;
  return { value, label, source: team?.membershipTier?.trim() ? "team" as const : "crm" as const };
}

/** CRM lifecycle is authoritative; a missing status uses the portal lifecycle, then the legacy active default for onboarding. */
export function currentCrmStatus(agent: CrmFilterAgent): CrmStatusFilter {
  const recorded = agent.crmProfile?.agentStatus?.trim();
  const key = recorded ? normalize(recorded) : normalize(agent.portalStatus ?? "active");
  if (!recorded && key === "onboarding") return "active";
  return CRM_STATUS_OPTIONS.find(option => option.value === key)?.value ?? "unknown";
}

export function matchesCrmListFilters(
  agent: CrmFilterAgent,
  filters: { search: string; memberships: readonly CrmMembershipFilter[]; statuses: readonly CrmStatusFilter[] },
  teams: readonly CrmFilterTeam[] = [],
) {
  const q = filters.search.toLowerCase();
  const matchesSearch = !q || [agent.name, agent.email, agent.crmProfile?.uniqueAgentId, agent.crmProfile?.jltEmail, agent.crmProfile?.businessName]
    .some(value => (value ?? "").toLowerCase().includes(q));
  // Empty groups are unrestricted. OR within a group; AND between groups and search.
  return matchesSearch
    && (!filters.memberships.length || filters.memberships.includes(currentCrmMembership(agent, teams).value))
    && (!filters.statuses.length || filters.statuses.includes(currentCrmStatus(agent)));
}
