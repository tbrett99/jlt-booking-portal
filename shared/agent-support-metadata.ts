import type {
  SupportAnswerEnvelope,
  SupportCitation,
  SupportDisposition,
} from "./agent-support-pilot";

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

export function readSupportMetadata(
  value: unknown,
  status = "insufficient_sources"
): {
  sources: SupportCitation[];
  disposition: SupportDisposition;
  verified: boolean;
  inputScreened: boolean;
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
  return {
    sources: citations(row.sources),
    disposition,
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
  return { ...input, version: 2, inputScreened: true };
}
