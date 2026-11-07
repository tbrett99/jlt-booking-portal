import sanitizeHtml from "sanitize-html";
import type { MyAgreementSummary } from "../shared/my-agreements";

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const MAX_BASE64_CHARS = 4 * Math.ceil(MAX_SIGNATURE_BYTES / 3);

/** Only configured public object storage is trusted; never guess an origin from request headers. */
export function safeAgreementStorageUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > 4096
  )
    return null;
  const configured = process.env.S3_PUBLIC_URL;
  if (
    !configured ||
    !/^https:\/\//i.test(value) ||
    /[\\\s\u0000-\u001f\u007f]/.test(value)
  )
    return null;
  try {
    const base = new URL(configured);
    const url = new URL(value);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      url.protocol !== "https:" ||
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    // Check BEFORE URL normalization: URL would otherwise erase dot-segment traversal.
    const rawPath = value
      .slice(value.indexOf("://") + 3)
      .replace(/^[^/]*\//, "/");
    for (const path of [rawPath, url.pathname, base.pathname]) {
      const decoded = decodeURIComponent(path);
      if (
        /[\\\u0000-\u001f\u007f]/.test(decoded) ||
        /%[0-9a-f]{2}/i.test(decoded) ||
        decoded
          .split("/")
          .some(segment => segment === "." || segment === "..") ||
        /%2f|%5c/i.test(path)
      )
        return null;
    }
    const prefix = `${base.pathname.replace(/\/+$/, "")}/`;
    if (
      !url.pathname.startsWith(prefix) ||
      url.pathname.length <= prefix.length ||
      url.pathname.includes("//")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Data URLs are bounded, canonical PNG/JPEG base64 and must match their declared binary magic. */
export function safeAgreementSignature(
  value: unknown,
  allowStoredUrl = false
): string | null {
  if (typeof value !== "string") return null;
  if (value.length <= MAX_BASE64_CHARS + 32) {
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value
    );
    if (
      match &&
      match[2].length <= MAX_BASE64_CHARS &&
      match[2].length % 4 === 0
    ) {
      const bytes = Buffer.from(match[2], "base64");
      const png =
        bytes.length >= 8 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg =
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff;
      if (
        bytes.length <= MAX_SIGNATURE_BYTES &&
        bytes.toString("base64") === match[2] &&
        ((match[1] === "png" && png) || (match[1] === "jpeg" && jpeg))
      )
        return value;
    }
  }
  if (!allowStoredUrl) return null;
  const url = safeAgreementStorageUrl(value);
  if (!url) return null;
  const base = new URL(process.env.S3_PUBLIC_URL!);
  const key = new URL(url).pathname.slice(
    `${base.pathname.replace(/\/+$/, "")}/`.length
  );
  return /^crm\/contracts\/signatures\/[A-Za-z0-9_-]+\.(?:png|jpeg)$/.test(key)
    ? url
    : null;
}

/** Safe DISPLAY ONLY. This never modifies the stored signing text or verifies original document bytes. */
export function safeAgreementSnapshot(value: unknown): {
  html: string | null;
  kind: MyAgreementSummary["snapshotKind"];
} {
  if (typeof value !== "string" || !value.trim())
    return { html: null, kind: null };
  const html = sanitizeHtml(value, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "div",
      "span",
      "blockquote",
      "hr",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "caption",
      "colgroup",
      "col",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "sup",
      "sub",
      "pre",
      "code",
      "a",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel", "referrerpolicy"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
      ol: ["start"],
      li: ["value"],
    },
    allowedSchemes: ["https"],
    allowProtocolRelative: false,
    nonTextTags: [
      "script",
      "style",
      "textarea",
      "option",
      "iframe",
      "object",
      "embed",
      "svg",
      "math",
      "template",
      "noscript",
    ],
    transformTags: {
      a: (_tag, attributes) => {
        const href = safeAgreementStorageUrl(attributes.href);
        const attribs: Record<string, string> = href
          ? {
              href,
              target: "_blank",
              rel: "noopener noreferrer",
              referrerpolicy: "no-referrer",
            }
          : {};
        return { tagName: "a", attribs };
      },
    },
  }).trim();
  // Empty markup, whitespace and non-text evidence must not advertise a saved text snapshot.
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  if (
    !text
      .replace(/&(?:nbsp|#160|#x0*a0);/gi, " ")
      .replace(/[\s\u200b-\u200d\ufeff]/g, "")
  ) {
    return { html: null, kind: null };
  }
  let documentReference = false;
  // Inspect the sanitized parse, so suppressed active-element links cannot affect classification.
  sanitizeHtml(html, {
    allowedTags: ["a"],
    allowedAttributes: { a: ["href"] },
    transformTags: {
      a: (_tag, attributes) => {
        const href = safeAgreementStorageUrl(attributes.href);
        if (href && /\.pdf$/i.test(new URL(href).pathname))
          documentReference = true;
        return { tagName: "a", attribs: attributes };
      },
    },
  });
  return {
    html,
    kind: documentReference ? "document_reference" : "text_snapshot",
  };
}

/** Stored reference only, NOT a recomputed or verified digest. */
export function safeAgreementStoredHash(value: unknown): string | null {
  return typeof value === "string" && /^[a-f\d]{64}$/i.test(value)
    ? value
    : null;
}

export function agreementSignedAt(value: unknown): string | null {
  if (
    !(value instanceof Date) &&
    (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value
      ))
  )
    return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  // Reject calendar overflow rather than Date silently turning Feb 30 into March.
  if (typeof value === "string") {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (
      calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day
    )
      return null;
  }
  return date.toISOString();
}
