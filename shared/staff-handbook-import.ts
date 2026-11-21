import type { HandbookContent } from "./staff-handbook";

export const HANDBOOK_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const HANDBOOK_IMPORT_MAX_ROWS = 100;
export const HANDBOOK_IMPORT_COLUMNS = [
  "external_reference", "title", "category", "guidance_type", "editor_format",
  "summary", "tags", "content", "when_to_use", "checks_before_starting", "steps",
  "suggested_reply", "when_to_ask_for_help", "related_guidance",
] as const;
export type HandbookImportRow = {
  rowNumber: number;
  externalReference: string;
  title: string;
  status: "ready" | "already_imported" | "invalid" | "conflict";
  errors: string[];
  warnings: string[];
  articleId: number | null;
  guideUrl: string | null;
  content: HandbookContent | null;
};
export type HandbookImportPreview = {
  previewHash: string;
  rows: HandbookImportRow[];
  readyCount: number;
  skippedCount: number;
  errorCount: number;
};
export type HandbookImportReceiptRow = {
  rowNumber: number;
  externalReference: string;
  title: string;
  outcome: "created" | "already_imported" | "invalid" | "conflict" | "not_selected" | "failed";
  articleId: number | null;
  guideUrl: string | null;
  message: string;
};
export type HandbookImportReceipt = {
  rows: HandbookImportReceiptRow[];
  createdCount: number;
  skippedCount: number;
  errorCount: number;
};
/** Formatting examples, not approved JLT guidance. No publication or approval fields. */
export function handbookImportTemplate(): string {
  const rows = [
    [...HANDBOOK_IMPORT_COLUMNS],
    ["JLT-EXAMPLE-001", "EXAMPLE ONLY — decision-making guide", "General", "operational", "article", "Replace all placeholders with verified JLT guidance.", "example|decision-making",
      "<h2>When this applies</h2><p>[Confirmed situation.]</p><h2>Key rules</h2><ul><li>[Approved rule.]</li></ul><h2>How to assess the situation</h2><ol><li>[Confirmed check.]</li></ol><h2>What staff can decide independently</h2><p>[Confirmed authority boundary.]</p><h2>When to escalate</h2><p>[Confirmed escalation route.]</p><h2>Practical examples</h2><p>[Fictional example, not a real case.]</p>", "", "", "", "", "", ""],
    ["JLT-EXAMPLE-002", "EXAMPLE ONLY — step-by-step guide", "General", "operational", "process", "Replace all placeholders with verified JLT instructions.", "example|procedure", "",
      "<p>[When to use this process.]</p>", "<ul><li>[Required information or permission.]</li></ul>", "<ol><li>[First confirmed action.]</li><li>[Next action and success check.]</li></ol>", "<p>[Approved agent-facing wording.]</p>", "<p>[Confirmed exceptions and escalation route.]</p>", "<p>[Verified related guidance.]</p>"],
  ];
  return "\uFEFF" + rows.map(row => row.map(cell => '"' + cell.replace(/"/g, '""') + '"').join(",")).join("\r\n") + "\r\n";
}
