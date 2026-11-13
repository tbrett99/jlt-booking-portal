export type SupportDisposition =
  | "answered"
  | "partial"
  | "clarify"
  | "escalated"
  | "privacy_blocked"
  | "validation_failed"
  | "failed";
export type SupportValidationDiagnostic =
  | "input_contract"
  | "context_contract"
  | "context_provenance"
  | "model_contract"
  | "generation_contract"
  | "evidence_mismatch"
  | "citation_invalid"
  | "output_safety"
  | "verification_contract"
  | "claim_not_supported"
  | "conditions_missing"
  | "verification_safety"
  | "relevance_failed"
  | "clarification_failed"
  | "call_budget";
export const SUPPORT_VALIDATION_DIAGNOSTIC_LABELS: Readonly<
  Record<SupportValidationDiagnostic, string>
> = Object.freeze({
  input_contract: "Input contract check failed",
  context_contract: "Context contract check failed",
  context_provenance: "Context provenance check failed",
  model_contract: "Model response contract check failed",
  generation_contract: "Generation contract check failed",
  evidence_mismatch: "Evidence matching check failed",
  citation_invalid: "Citation check failed",
  output_safety: "Output safety check failed",
  verification_contract: "Verification contract check failed",
  claim_not_supported: "Claim support check failed",
  conditions_missing: "Required conditions check failed",
  verification_safety: "Verification safety check failed",
  relevance_failed: "Relevance check failed",
  clarification_failed: "Clarification check failed",
  call_budget: "Model call budget check failed",
});
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
  validationDiagnostic?: SupportValidationDiagnostic | null;
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
  validationDiagnostic?: SupportValidationDiagnostic | null;
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
  validationDiagnostic?: SupportValidationDiagnostic | null;
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
