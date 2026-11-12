import type { CurrentPolicyRevision } from "./policy-revision";

export interface TermsReviewSection {
  title: string;
  content: string;
}

export interface TermsReviewChange {
  id: string;
  title: string;
  references: string[];
  summary: string;
}

export interface TermsReviewApproval {
  id: string;
  title: string;
  details: string;
  references: string[];
  status: "pending";
}

export interface TermsReviewDraft {
  id: "2026-11-12-clause-and-appendix-review";
  status: "archived_proposal";
  preparedDate: "2026-11-12";
  /** Historical baseline, not a claim about today's published source. */
  publishedBaseline: "May 2026";
  /** The archived proposal itself has no publication or effective date. */
  publicationDate: null;
  effectiveDate: null;
  currentPublishedRevision: CurrentPolicyRevision;
  baselineSha256: string;
  draftSha256: string;
  terms: TermsReviewSection[];
  conduct: TermsReviewSection[];
  appendices: TermsReviewSection[];
  changes: TermsReviewChange[];
  approvals: TermsReviewApproval[];
  unchangedComplianceReferences: string[];
  notice: string;
}
