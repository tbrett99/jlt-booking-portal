import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { users } from "../drizzle/schema";
import { getHandbookAccountLockPlan } from "./staff-handbook-lock-plan";
import {
  canUseStaffHandbook,
  STAFF_HANDBOOK_SENSITIVITIES,
  type HandbookContent,
} from "../shared/staff-handbook";

export type HandbookAccount = Parameters<typeof canUseStaffHandbook>[0];
/** Only errors created here may cross the handbook boundary. Never return a DB/storage cause. */
export class HandbookError extends TRPCError {}
export function fail(
  code:
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "BAD_REQUEST"
    | "INTERNAL_SERVER_ERROR",
  message: string
): never {
  throw new HandbookError({ code, message });
}
export function assertStaffHandbookAccount(
  user: HandbookAccount
): asserts user is NonNullable<HandbookAccount> {
  if (!canUseStaffHandbook(user))
    fail("FORBIDDEN", "Active JLT administrator access is required.");
}
export async function assertFreshStaffHandbookAccount(
  db: any,
  userId: number,
  lock = false
) {
  if (!Number.isSafeInteger(userId) || userId <= 0)
    fail("FORBIDDEN", "Active JLT administrator access is required.");
  const plan = lock ? getHandbookAccountLockPlan(db) : undefined;
  if (plan && !plan.has(userId))
    fail(
      "CONFLICT",
      "Administrator access changed. Refresh before trying again."
    );
  try {
    const query = db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        portalStatus: users.portalStatus,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const [account] = await (lock ? query.for("update") : query);
    assertStaffHandbookAccount(account);
    return account as NonNullable<HandbookAccount> & { name: string | null };
  } catch (error) {
    throw safeHandbookError(error);
  }
}
export function safeHandbookError(error: unknown): HandbookError {
  if (error instanceof HandbookError) return error;
  if (error instanceof TRPCError && error.cause instanceof HandbookError)
    return error.cause;
  return new HandbookError({
    code: "INTERNAL_SERVER_ERROR",
    message: "The internal handbook operation could not be completed.",
  });
}
export const idSchema = z.number().int().positive().max(2147483647);
export const versionSchema = idSchema;
export const tokenSchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
export const pageSchema = z.number().int().min(1).max(100000).default(1);
export const categorySchema = z.string().trim().min(1).max(120);
export const contentSchema = z.object({
  title: z.string().max(255),
  summary: z.string().max(4000),
  category: categorySchema,
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
  format: z.enum(["article", "process"]),
  contentHtml: z.string().max(200000),
  sections: z.object({
    whenToUse: z.string().max(30000),
    checks: z.string().max(30000),
    steps: z.string().max(60000),
    agentWording: z.string().max(30000),
    exceptions: z.string().max(30000),
    related: z.string().max(30000),
  }),
  ownerId: idSchema,
  sensitivity: z.enum(STAFF_HANDBOOK_SENSITIVITIES),
  isPinned: z.boolean(),
  reviewedAt: z.date().nullable(),
  nextReviewAt: z.date().nullable(),
});
/** Query-bearing same-app links are limited to the mounted handbook detail routes. */
export function safeHandbookHref(value: string): string | null {
  const href = value.trim();
  if (!href || /[\\\x00-\x20%#]/.test(href)) return null;
  try {
    if (href.startsWith("https://") || href.startsWith("mailto:")) {
      const parsed = new URL(href);
      return !parsed.username &&
        !parsed.password &&
        (parsed.protocol === "https:" || parsed.protocol === "mailto:")
        ? href
        : null;
    }
    if (!href.startsWith("/admin/")) return null;
    if (!href.includes("?")) return href;
    const match = /^\/admin\/staff-handbook\?([^?]+)$/.exec(href);
    if (!match) return null;
    const parts = match[1].split("&");
    if (parts.length !== 2) return null;
    const params = new URLSearchParams(match[1]);
    const tab = params.get("tab");
    const key =
      tab === "handbook" ? "article" : tab === "requests" ? "request" : null;
    if (
      !key ||
      parts.some(p => !p.startsWith("tab=") && !p.startsWith(`${key}=`))
    )
      return null;
    const id = params.get(key);
    return id &&
      /^[1-9]\d*$/.test(id) &&
      Number.isSafeInteger(Number(id)) &&
      Number(id) <= 2147483647
      ? `/admin/staff-handbook?tab=${tab}&${key}=${id}`
      : null;
  } catch {
    return null;
  }
}
/** No images, frames, CSS, arbitrary src, scripts or remote embeds. Files are download-only. */
export function sanitiseHandbookHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "a",
      "hr",
    ],
    allowedAttributes: {
      a: ["href", "title", "rel"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      ol: ["start"],
    },
    allowedSchemes: ["https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs) => {
        const href = safeHandbookHref(attrs.href ?? "");
        return {
          tagName: "a",
          attribs: {
            ...(href ? { href } : {}),
            ...(attrs.title ? { title: attrs.title } : {}),
            rel: "noopener noreferrer",
          },
        };
      },
    },
  }).trim();
}
export function plainHandbookText(value: string): string {
  const parsed = sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  });
  // HTML parsing is the security boundary; decoding only the parser's output
  // yields real plain text for React/text DTOs and meaningful-body validation.
  return parsed
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}
/** Metadata inputs are plain text on BOTH create and edit. Never parse them as HTML.
 * React/text DTOs escape metadata on display; only the actual rich-body fields
 * belong to the HTML sanitizer. Entity spellings typed into an input are literal.
 */
export function normaliseSubmittedContent(
  value: HandbookContent,
  _previous?: HandbookContent
): HandbookContent {
  return normaliseContent(value);
}
/** Stored plain fields must only be validated, never silently interpreted as markup again. */
export function normaliseContent(value: HandbookContent): HandbookContent {
  const parsed = contentSchema.safeParse(value);
  if (!parsed.success) fail("BAD_REQUEST", "Invalid handbook content.");
  const v = parsed.data;
  const sections = Object.fromEntries(
    Object.entries(v.sections).map(([key, html]) => [
      key,
      sanitiseHandbookHtml(html),
    ])
  ) as HandbookContent["sections"];
  const title = v.title.trim();
  if (!title || title.length > 255)
    fail("BAD_REQUEST", "A guide title is required.");
  const category = v.category.trim();
  if (!category) fail("BAD_REQUEST", "A guide category is required.");
  return {
    ...v,
    title,
    category,
    summary: v.summary,
    tags: Array.from(new Set(v.tags)),
    contentHtml: sanitiseHandbookHtml(v.contentHtml),
    sections,
  };
}
export function assertPublishable(content: HandbookContent) {
  if (!content.title.trim()) fail("BAD_REQUEST", "A guide title is required.");
  if (
    content.format === "article"
      ? !plainHandbookText(content.contentHtml)
      : !plainHandbookText(content.sections.steps)
  )
    fail(
      "BAD_REQUEST",
      "Guide body or process steps are required before publication."
    );
}
export function requiresSecondReview(
  draft: HandbookContent,
  published: HandbookContent | null
) {
  return (
    draft.sensitivity !== "operational" ||
    (!!published && published.sensitivity !== "operational")
  );
}
/** The server-only cycle flag survives intermediate classification downgrades. */
export function requiresCycleReview(
  draft: HandbookContent & { _cycleRequiresReview?: boolean },
  published: HandbookContent | null
) {
  return (
    draft._cycleRequiresReview === true ||
    requiresSecondReview(draft, published)
  );
}
export function assertIndependentReviewer(
  contributorIds: number[],
  reviewerId: number
) {
  if (contributorIds.includes(reviewerId))
    fail(
      "FORBIDDEN",
      "Review must be completed by an administrator who has not contributed to this draft cycle."
    );
}
export function assertVersion(actual: number, expected: number) {
  if (actual !== expected)
    fail("CONFLICT", "This record changed. Refresh before trying again.");
}
export function articleState(article: {
  archivedAt: Date | null;
  draftRevisionId: number | null;
  publishedRevisionId: number | null;
  submittedAt: Date | null;
}) {
  return article.archivedAt
    ? ("archived" as const)
    : article.draftRevisionId === article.publishedRevisionId &&
        article.publishedRevisionId
      ? ("published" as const)
      : article.submittedAt
        ? ("in_review" as const)
        : article.publishedRevisionId
          ? ("changes" as const)
          : ("draft" as const);
}
export const OPEN_REQUEST_STATUSES = [
  "new",
  "triaged",
  "assigned",
  "drafting",
  "in_review",
] as const;
export const isOpenRequest = (status: string) =>
  (OPEN_REQUEST_STATUSES as readonly string[]).includes(status);
