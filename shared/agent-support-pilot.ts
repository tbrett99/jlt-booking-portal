export type SupportDisposition =
  | "answered"
  | "partial"
  | "clarify"
  | "escalated"
  | "privacy_blocked"
  | "validation_failed"
  | "failed";
export type SupportCitation = {
  index: number;
  key: string;
  kind: string;
  title: string;
  href: string;
  label: string;
  timestampLabel: string | null;
  updatedAt: Date | string | null;
};
export type SupportAnswerEnvelope = {
  version: 2;
  sources: SupportCitation[];
  disposition: SupportDisposition;
  verified: boolean;
  inputScreened: true;
  modelCalls: number;
  latencyMs: number;
};
export type SupportHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};
export type SupportTurnResult = {
  answer: string;
  sources: SupportCitation[];
  disposition: SupportDisposition;
  verified: boolean;
  status: "answered" | "insufficient_sources" | "failed";
  unresolvedReason: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  modelCalls: number;
  latencyMs: number;
};
export type SupportConversationMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: Date | string;
  sources: SupportCitation[];
  disposition: SupportDisposition;
  verified: boolean;
  feedback: "helpful" | "not_helpful" | null;
};
export const SUPPORT_DISPOSITION_LABELS: Record<SupportDisposition, string> = {
  answered: "Source-checked guidance",
  partial: "Partial guidance",
  clarify: "Clarification needed",
  escalated: "Support needed",
  privacy_blocked: "Private details omitted",
  validation_failed: "Answer withheld",
  failed: "Temporarily unavailable",
};
