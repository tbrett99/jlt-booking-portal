export type HqConnectionCheckOutcome =
  | "ready"
  | "stale"
  | "not_ready"
  | "missing_key"
  | "invalid_settings"
  | "key_rejected"
  | "unavailable";

/** Strict health-only projection. It intentionally contains no source payload or binding data. */
export type HqConnectionCheckResult = {
  outcome: HqConnectionCheckOutcome;
  message: string;
  checkedAt: string;
  generationId: number | null;
  sourcePublishedAt: string | null;
  sourceObservationAt: string | null;
};
