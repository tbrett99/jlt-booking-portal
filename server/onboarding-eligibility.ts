export function isOnboardingEligible(role: string | null | undefined, portalStatus: string | null | undefined) {
  return role === "agent" && portalStatus === "onboarding";
}
