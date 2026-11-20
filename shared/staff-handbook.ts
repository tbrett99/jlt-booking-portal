export const STAFF_HANDBOOK_CATEGORIES = ["Bookings & Orbit", "Amendments & Ticketing", "Reimbursements & Refunds", "Commission Administration", "Memberships & Onboarding", "Academy", "Supplier Support", "Escalations", "General"] as const;
export const STAFF_HANDBOOK_SENSITIVITIES = ["operational", "financial", "legal", "policy"] as const;
export type HandbookSensitivity = typeof STAFF_HANDBOOK_SENSITIVITIES[number];
export const STAFF_HANDBOOK_SENSITIVITY_LABELS: Record<HandbookSensitivity, string> = { operational: "Day-to-day work", financial: "Money and payments", legal: "Legal requirements", policy: "Company policy" };
export const KNOWLEDGE_REQUEST_STATUSES = ["new", "triaged", "assigned", "drafting", "in_review", "resolved", "closed"] as const;
export type KnowledgeRequestStatus = typeof KNOWLEDGE_REQUEST_STATUSES[number];
export const KNOWLEDGE_REQUEST_STATUS_LABELS: Record<KnowledgeRequestStatus, string> = { new: "New", triaged: "Ready to write", assigned: "Someone is working on it", drafting: "Guide being written", in_review: "Guide being checked", resolved: "Answered", closed: "Closed" };
export const KNOWLEDGE_REQUEST_KINDS = ["missing_process", "unclear", "outdated", "conflicting", "recurring_question"] as const;
export const KNOWLEDGE_REQUEST_KIND_LABELS: Record<typeof KNOWLEDGE_REQUEST_KINDS[number], string> = { missing_process: "Missing guidance", unclear: "Hard to understand", outdated: "Needs updating", conflicting: "Instructions disagree", recurring_question: "Frequently asked question" };
export type HandbookContent = {
  title: string;
  summary: string;
  category: string;
  tags: string[];
  format: "article" | "process";
  contentHtml: string;
  sections: { whenToUse: string; checks: string; steps: string; agentWording: string; exceptions: string; related: string };
  ownerId: number;
  sensitivity: HandbookSensitivity;
  isPinned: boolean;
  reviewedAt: Date | null;
  nextReviewAt: Date | null;
};
export const EMPTY_HANDBOOK_SECTIONS = { whenToUse: "", checks: "", steps: "", agentWording: "", exceptions: "", related: "" };
export function canUseStaffHandbook(user: { id: number; role: string; isActive: boolean; portalStatus: string; mustChangePassword?: boolean } | null | undefined): boolean {
  return !!user && Number.isSafeInteger(user.id) && user.id > 0 && (user.role === "admin" || user.role === "super_admin") && user.isActive === true && user.portalStatus === "active" && user.mustChangePassword === false;
}
export function needsHandbookSecondReview(sensitivity: HandbookSensitivity): boolean { return sensitivity !== "operational"; }
export function emptyHandbookContent(ownerId: number): HandbookContent {
  return { title: "", summary: "", category: "General", tags: [], format: "process", contentHtml: "", sections: { ...EMPTY_HANDBOOK_SECTIONS }, ownerId, sensitivity: "operational", isPinned: false, reviewedAt: null, nextReviewAt: null };
}

export const STAFF_HANDBOOK_FILE_MIMES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain", "text/csv", "image/png", "image/jpeg"] as const;
export const STAFF_HANDBOOK_MAX_FILE_BYTES = 10 * 1024 * 1024;
