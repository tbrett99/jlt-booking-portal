export const POLICY_TABS = [
  "terms",
  "conduct",
  "privacy",
  "appendices",
] as const;
export type PolicyTab = (typeof POLICY_TABS)[number];

export function policyTabFromSearch(search: string): PolicyTab {
  const value = new URLSearchParams(search).get("section");
  return POLICY_TABS.find(tab => tab === value) ?? "terms";
}

export function policyTabLink(tab: PolicyTab): string {
  return `/terms?section=${tab}`;
}
