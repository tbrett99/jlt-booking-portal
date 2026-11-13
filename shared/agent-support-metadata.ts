import { SUPPORT_CONDITION_RELATION_LABELS, SUPPORT_VALIDATION_DIAGNOSTIC_LABELS } from "./agent-support-pilot";
import type {
  SupportAnswerEnvelope,
  SupportCitation,
  SupportConditionCheck,
  SupportDisposition,
  SupportValidationDiagnostic,
} from "./agent-support-pilot";

const validationDiagnostics = new Set<string>(
  Object.keys(SUPPORT_VALIDATION_DIAGNOSTIC_LABELS)
);
export function readSupportValidationDiagnostic(
  value: unknown
): SupportValidationDiagnostic | null {
  return typeof value === "string" && validationDiagnostics.has(value)
    ? (value as SupportValidationDiagnostic)
    : null;
}

const dispositions = new Set<SupportDisposition>([
  "answered",
  "partial",
  "clarify",
  "escalated",
  "privacy_blocked",
  "validation_failed",
  "failed",
]);
const allowedPaths: Record<string, string[]> = {
  "/terms": ["version", "section"],
  "/knowledge-base": ["article"],
  "/webinars": ["webinar"],
  "/suppliers": ["supplier", "supplierId"],
  "/community": ["postId"],
  "/academy": [],
  "/my-bookings": [],
};
export function isSafeSupportHref(href: unknown): href is string {
  if (
    typeof href !== "string" ||
    !href.startsWith("/") ||
    href.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(href)
  )
    return false;
  try {
    const url = new URL(href, "https://portal.thejltgroup.co.uk");
    const keys = allowedPaths[url.pathname];
    if (!keys || url.origin !== "https://portal.thejltgroup.co.uk" || url.hash)
      return false;
    let safe = true;
    url.searchParams.forEach((value, key) => {
      if (!keys.includes(key) || !/^[A-Za-z0-9_-]{1,50}$/.test(value))
        safe = false;
    });
    return safe;
  } catch {
    return false;
  }
}

function citations(value: unknown): SupportCitation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (
      !isSafeSupportHref(row.href) ||
      typeof row.key !== "string" ||
      typeof row.title !== "string" ||
      typeof row.kind !== "string"
    )
      return [];
    return [
      {
        index:
          Number.isSafeInteger(row.index) && Number(row.index) > 0
            ? Number(row.index)
            : index + 1,
        key: row.key.slice(0, 100),
        kind: row.kind.slice(0, 40),
        title: row.title.slice(0, 300),
        href: row.href,
        label:
          typeof row.label === "string"
            ? row.label.slice(0, 400)
            : row.title.slice(0, 300),
        timestampLabel:
          typeof row.timestampLabel === "string"
            ? row.timestampLabel.slice(0, 200)
            : null,
        updatedAt:
          row.updatedAt instanceof Date || typeof row.updatedAt === "string"
            ? row.updatedAt
            : null,
      },
    ];
  });
}

const conditionRelations = new Set(Object.keys(SUPPORT_CONDITION_RELATION_LABELS));
function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function conditionCitation(value: unknown): SupportCitation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !boundedInteger(row.index, 1, 5) ||
    !boundedText(row.key, 100) || !/^[A-Za-z0-9:_-]+$/.test(row.key) ||
    !boundedText(row.kind, 40) || !/^[a-z_]+$/.test(row.kind) ||
    !boundedText(row.title, 300) || !boundedText(row.label, 400) ||
    !isSafeSupportHref(row.href) || row.href.length > 400 ||
    !(row.timestampLabel === null || boundedText(row.timestampLabel, 200)) ||
    !(row.updatedAt === null ||
      (row.updatedAt instanceof Date && Number.isFinite(row.updatedAt.getTime())) ||
      (boundedText(row.updatedAt, 100) && Number.isFinite(Date.parse(row.updatedAt))))
  ) return null;
  // Reconstruct both levels: no excerpt, raw verifier text or extra snapshot
  // fields can survive the transport/persistence boundary.
  return {
    index: row.index, key: row.key, kind: row.kind, title: row.title,
    href: row.href, label: row.label,
    timestampLabel: row.timestampLabel as string | null,
    updatedAt: row.updatedAt as Date | string | null,
  };
}
export function readSupportConditionChecks(value: unknown): SupportConditionCheck[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    if (
      !(row.target === "question_checklist" || row.target === "claim") ||
      !(row.target === "question_checklist" ? row.claimId === null : boundedInteger(row.claimId, 1, 10)) ||
      typeof row.relation !== "string" || !conditionRelations.has(row.relation) ||
      !boundedInteger(row.chunkIndex, 0, Number.MAX_SAFE_INTEGER) ||
      !boundedInteger(row.start, 0, 1400) || !boundedInteger(row.end, 1, 1400) ||
      row.end <= row.start || row.end - row.start > 1400 ||
      typeof row.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(row.sourceFingerprint)
    ) return [];
    const source = conditionCitation(row.source);
    if (!source) return [];
    return [{
      target: row.target, claimId: row.claimId as number | null,
      relation: row.relation as SupportConditionCheck["relation"], source,
      chunkIndex: row.chunkIndex, start: row.start, end: row.end,
      sourceFingerprint: row.sourceFingerprint,
    }];
  });
}

export function readSupportMetadata(
  value: unknown,
  status = "insufficient_sources"
): {
  sources: SupportCitation[];
  disposition: SupportDisposition;
  verified: boolean;
  inputScreened: boolean;
  validationDiagnostic?: SupportValidationDiagnostic | null;
  conditionChecks?: SupportConditionCheck[];
  modelCalls: number;
  latencyMs: number;
} {
  const fallback =
    status === "failed"
      ? "failed"
      : status === "answered"
        ? "answered"
        : "escalated";
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {
      sources: citations(value),
      disposition: fallback,
      verified: false,
      inputScreened: false,
      modelCalls: 0,
      latencyMs: 0,
    };
  const row = value as Record<string, unknown>;
  const current = row.version === 2 && row.inputScreened === true;
  const disposition =
    current && dispositions.has(row.disposition as SupportDisposition)
      ? (row.disposition as SupportDisposition)
      : fallback;
  const validationDiagnostic =
    disposition === "validation_failed" && status !== "answered"
      ? readSupportValidationDiagnostic(row.validationDiagnostic)
      : null;
  const conditionChecks = current && validationDiagnostic === "conditions_missing"
    ? readSupportConditionChecks(row.conditionChecks) : [];
  return {
    sources: citations(row.sources),
    disposition,
    ...(validationDiagnostic ? { validationDiagnostic } : {}),
    ...(conditionChecks.length ? { conditionChecks } : {}),
    verified:
      current &&
      row.verified === true &&
      (disposition === "answered" || disposition === "partial"),
    inputScreened: current,
    modelCalls:
      current && Number.isSafeInteger(row.modelCalls)
        ? Math.max(0, Math.min(3, Number(row.modelCalls)))
        : 0,
    latencyMs:
      current &&
      typeof row.latencyMs === "number" &&
      Number.isFinite(row.latencyMs)
        ? Math.max(0, row.latencyMs)
        : 0,
  };
}

export function supportEnvelope(
  input: Omit<SupportAnswerEnvelope, "version" | "inputScreened">
): SupportAnswerEnvelope {
  const validationDiagnostic =
    input.disposition === "validation_failed"
      ? readSupportValidationDiagnostic(input.validationDiagnostic)
      : null;
  const conditionChecks = validationDiagnostic === "conditions_missing"
    ? readSupportConditionChecks(input.conditionChecks) : [];
  // Persist only known envelope fields, never arbitrary provider metadata.
  return {
    version: 2,
    inputScreened: true,
    sources: input.sources,
    disposition: input.disposition,
    verified: input.verified,
    modelCalls: input.modelCalls,
    latencyMs: input.latencyMs,
    ...(validationDiagnostic ? { validationDiagnostic } : {}),
    ...(conditionChecks.length ? { conditionChecks } : {}),
  };
}
