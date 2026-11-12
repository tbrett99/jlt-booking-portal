/**
 * Metadata for the prepared current policy source. This is not an acceptance,
 * notice or billing instruction, and does not vary an existing agreement.
 * Deployment/publication is a separate owner-controlled step.
 */
export const CURRENT_POLICY_REVISION = {
  id: "2026-11-12-agent-terms",
  publicationDate: "2026-11-12",
  publicationLabel: "12 November 2026",
  sourceReviewId: "2026-11-12-clause-and-appendix-review",
  url: "/terms?version=2026-11",
  sourceSha256: "ebb021f685dfbe6bcfb16841806c645a48f9912f7cc663a97b06dba96e4ccfa0",
} as const;

export type CurrentPolicyRevision = typeof CURRENT_POLICY_REVISION;

export const MAY_2026_POLICY_BASELINE = {
  id: "2026-05",
  publicationLabel: "May 2026",
  url: "/terms?version=2026-05",
  sourceSha256: "1f7e7ff1e35e35ce5e1fe381ec1bfbbb5ae45e473a32fd578051e36045b40066",
} as const;

/** Privacy content was not part of the approved terms revision. */
export const PRIVACY_POLICY_LAST_UPDATED = "May 2026" as const;
