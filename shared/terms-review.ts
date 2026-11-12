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
  status: "draft_not_published";
  preparedDate: "2026-11-12";
  publishedBaseline: "May 2026";
  publicationDate: null;
  effectiveDate: null;
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
