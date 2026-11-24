export interface HqInitialImportResult {
  status:
    | "disabled"
    | "notdue"
    | "busy"
    | "progress"
    | "applied"
    | "already_complete"
    | "needs_attention";
  message: string;
  nextDueAt: string | null;
  hasPublished: boolean;
  progress: { pages: number; recordsRead: number } | null;
  errorCode: string | null;
}
