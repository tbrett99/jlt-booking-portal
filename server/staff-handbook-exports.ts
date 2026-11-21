import { Buffer } from "node:buffer";
import { and, desc, eq, inArray, isNotNull, isNull, like, ne, or, sql } from "drizzle-orm";
import {
  users,
  staffHandbookArticles as articles,
  staffHandbookRevisions as revisions,
  staffHandbookImportSources as importSources,
  staffKnowledgeRequests as requests,
} from "../drizzle/schema";
import { KNOWLEDGE_REQUEST_STATUS_LABELS, type KnowledgeRequestStatus } from "../shared/staff-handbook";
import { handbookGuideUrl, serializeHandbookCsv } from "../shared/staff-handbook-csv";
import { likeSearch, revisionContent, withHandbookRead, type HandbookDb, type RevisionRow } from "./staff-handbook-core";
import { articleState, fail, OPEN_REQUEST_STATUSES, type HandbookAccount } from "./staff-handbook-policy";

export const HANDBOOK_EXPORT_MAX_ROWS = 2_000;
export const HANDBOOK_EXPORT_MAX_BYTES = 10 * 1024 * 1024;
export type HandbookExport = { csv: string; rowCount: number; snapshot: string; generatedAt: string };
export type HandbookGuideExportInput = {
  search?: string;
  category?: string;
  view: "all" | "published" | "drafts" | "archived";
};
export type HandbookRequestExportInput = {
  search?: string;
  category?: string;
  status?: "all" | "open" | KnowledgeRequestStatus;
  assigneeId?: number | null;
};

export const HANDBOOK_GUIDE_EXPORT_HEADERS = [
  "guide_id", "guide_url", "version", "revision_id", "revision_number", "snapshot", "state", "external_reference",
  "title", "category", "guidance_type", "editor_format", "summary", "tags", "is_pinned", "owner_id", "owner_name",
  "created_at", "updated_at", "revision_created_at", "archived_at", "last_reviewed_at", "next_review_at",
  "content", "when_to_use", "checks_before_starting", "steps", "suggested_reply", "when_to_ask_for_help", "related_guidance",
];
export const HANDBOOK_REQUEST_EXPORT_HEADERS = [
  "request_id", "title", "description", "category", "urgency", "status", "status_label", "assignee_id", "assignee_name",
  "submitted_at", "article_id", "article_url", "linked_guide_snapshot", "linked_guide_state", "answered_or_closed_at",
];

// Explicit allowlists: no creation tokens, approval identities, attachment IDs,
// hashes, private keys, audit/comments, user contact details or agent tables.
const articleProjection = {
  id: articles.id,
  version: articles.version,
  draftRevisionId: articles.draftRevisionId,
  publishedRevisionId: articles.publishedRevisionId,
  submittedAt: articles.submittedAt,
  archivedAt: articles.archivedAt,
  createdAt: articles.createdAt,
  updatedAt: articles.updatedAt,
};
const revisionProjection = {
  id: revisions.id,
  articleId: revisions.articleId,
  revisionNumber: revisions.revisionNumber,
  content: revisions.content,
  createdAt: revisions.createdAt,
};
type GuideRow = {
  article: Pick<typeof articles.$inferSelect, keyof typeof articleProjection>;
  revision: Pick<RevisionRow, keyof typeof revisionProjection>;
};
type RequestExportRow = Pick<typeof requests.$inferSelect,
  "id" | "title" | "description" | "category" | "priority" | "status" | "assigneeId" | "createdAt" | "articleId" | "resolvedAt">;

function tooLarge(): never {
  return fail("BAD_REQUEST", "This handbook export exceeds 2,000 rows or 10 MiB. Narrow the filters and try again.");
}
function verifiedTotal(value: unknown): number {
  const total = value == null ? NaN : Number(value);
  if (!Number.isSafeInteger(total) || total < 0)
    fail("INTERNAL_SERVER_ERROR", "The handbook export count could not be verified.");
  if (total > HANDBOOK_EXPORT_MAX_ROWS) tooLarge();
  return total;
}
function verifyPayloadBytes(value: unknown) {
  const bytes = value == null ? NaN : Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    fail("INTERNAL_SERVER_ERROR", "The handbook export size could not be verified.");
  if (bytes > HANDBOOK_EXPORT_MAX_BYTES) tooLarge();
}
function validId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
}
function verifyRows(total: number, ids: number[]) {
  if (ids.length > HANDBOOK_EXPORT_MAX_ROWS) tooLarge();
  if (ids.length !== total || new Set(ids).size !== ids.length || ids.some(id => !validId(id)))
    fail("INTERNAL_SERVER_ERROR", "The handbook export snapshot could not be verified. No partial export is available.");
}
function iso(value: Date | string | null): string {
  if (value === null) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail("INTERNAL_SERVER_ERROR", "The handbook export date could not be verified.");
  return date.toISOString();
}
function result(headers: string[], rows: unknown[][], snapshot: string, generatedAt: string): HandbookExport {
  const csv = serializeHandbookCsv(headers, rows);
  if (Buffer.byteLength(csv, "utf8") > HANDBOOK_EXPORT_MAX_BYTES) tooLarge();
  return { csv, rowCount: rows.length, snapshot, generatedAt };
}
async function people(db: HandbookDb, involved: number[]): Promise<Map<number, string | null>> {
  const ids = Array.from(new Set(involved));
  if (!ids.length) return new Map();
  const rows: { id: number; name: string | null }[] = await db.select({ id: users.id, name: users.name })
    .from(users).where(inArray(users.id, ids)).limit(ids.length + 1);
  if (rows.length > ids.length || new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => !ids.includes(row.id)))
    fail("INTERNAL_SERVER_ERROR", "The handbook export staff names could not be verified.");
  // Historical/missing names stay visible without requiring current eligibility.
  return new Map(rows.map(row => [row.id, row.name]));
}
function staffName(names: Map<number, string | null>, id: number | null): string {
  return id === null ? "Unassigned" : names.get(id)?.trim() || `Staff #${id} (name unavailable)`;
}

/** Same predicates, snapshot pointer and ranking as browseHandbook, without paging.
 * Fresh authorization runs outside the repeatable-read snapshot before AND after
 * the work, so an account revoked during export cannot receive the CSV.
 * Every query here is SELECT-only; use the portable transaction characteristic
 * also used by workload reporting. TiDB rejects MySQL's READ ONLY syntax.
 */
export async function exportHandbookGuides(actor: HandbookAccount, input: HandbookGuideExportInput): Promise<HandbookExport> {
  return withHandbookRead(actor, db => db.transaction(async (tx: HandbookDb) => {
    const generatedAt = new Date().toISOString();
    const snapshot = input.view === "published" ? "Published" : "Working draft";
    const pointer = input.view === "published" ? articles.publishedRevisionId : articles.draftRevisionId;
    const conditions = [input.view === "archived" ? isNotNull(articles.archivedAt) : isNull(articles.archivedAt)];
    if (input.view === "drafts") conditions.push(or(isNull(articles.publishedRevisionId), ne(articles.draftRevisionId, articles.publishedRevisionId))!);
    if (input.category) conditions.push(eq(revisions.category, input.category));
    const search = input.search?.trim();
    if (search) conditions.push(like(revisions.searchText, likeSearch(search)));
    const condition = and(...conditions);
    // Measure stored payload before bringing up to 2,000 rich revisions into
    // memory. Final CSV size also includes quoting, names, metadata and the BOM.
    const [count] = await tx.select({ total: sql<number>`count(*)`, payloadBytes: sql<number>`coalesce(sum(octet_length(${revisions.content})), 0)` }).from(articles)
      .innerJoin(revisions, eq(revisions.id, pointer)).where(condition);
    const total = verifiedTotal(count?.total);
    verifyPayloadBytes(count?.payloadBytes);
    const titleWeight = search
      ? sql<number>`case when ${revisions.title} = ${search} then 3 when ${revisions.title} like ${likeSearch(search)} then 2 else 0 end`
      : sql<number>`0`;
    const rows: GuideRow[] = await tx.select({ article: articleProjection, revision: revisionProjection }).from(articles)
      .innerJoin(revisions, eq(revisions.id, pointer)).where(condition)
      .orderBy(desc(sql`JSON_EXTRACT(${revisions.content}, '$.isPinned') = true`), desc(titleWeight), desc(articles.updatedAt), desc(articles.id))
      .limit(HANDBOOK_EXPORT_MAX_ROWS + 1);
    verifyRows(total, rows.map(row => row.article.id));
    if (rows.some(({ article: a, revision: r }) => !validId(r.id) || r.articleId !== a.id ||
      r.id !== (input.view === "published" ? a.publishedRevisionId : a.draftRevisionId)))
      fail("INTERNAL_SERVER_ERROR", "The handbook export snapshot could not be verified. No partial export is available.");
    const content = rows.map(row => revisionContent(row.revision as RevisionRow));
    const names = await people(tx, content.map(c => c.ownerId));
    const ids = rows.map(row => row.article.id);
    const sources: { articleId: number; externalReference: string }[] = ids.length
      ? await tx.select({ articleId: importSources.articleId, externalReference: importSources.externalReference })
        .from(importSources).where(inArray(importSources.articleId, ids)).limit(ids.length + 1)
      : [];
    if (sources.length > ids.length || new Set(sources.map(row => row.articleId)).size !== sources.length || sources.some(row => !ids.includes(row.articleId)))
      fail("INTERNAL_SERVER_ERROR", "The handbook export references could not be verified.");
    const references = new Map(sources.map(row => [row.articleId, row.externalReference]));
    return result(HANDBOOK_GUIDE_EXPORT_HEADERS, rows.map(({ article: a, revision: r }, i) => {
      const c = content[i];
      return [a.id, handbookGuideUrl(a.id), a.version, r.id, r.revisionNumber, snapshot, articleState(a), references.get(a.id) ?? "",
        c.title, c.category, c.sensitivity, c.format, c.summary, c.tags.join("|"), c.isPinned, c.ownerId, staffName(names, c.ownerId),
        iso(a.createdAt), iso(a.updatedAt), iso(r.createdAt), iso(a.archivedAt), iso(c.reviewedAt), iso(c.nextReviewAt),
        c.contentHtml, c.sections.whenToUse, c.sections.checks, c.sections.steps, c.sections.agentWording, c.sections.exceptions, c.sections.related];
    }), snapshot, generatedAt);
  }, { isolationLevel: "repeatable read" }));
}

/** Current workflow export: resolvedAt is answered/closed time, NOT a first-answer
 * history guarantee. Draft links are labelled and never represented as answers.
 */
export async function exportHandbookRequests(actor: HandbookAccount, input: HandbookRequestExportInput): Promise<HandbookExport> {
  return withHandbookRead(actor, db => db.transaction(async (tx: HandbookDb) => {
    const generatedAt = new Date().toISOString();
    const conditions = [];
    if (input.status === "open") conditions.push(inArray(requests.status, [...OPEN_REQUEST_STATUSES]));
    else if (input.status && input.status !== "all") conditions.push(eq(requests.status, input.status));
    if (input.assigneeId !== undefined) conditions.push(input.assigneeId === null ? isNull(requests.assigneeId) : eq(requests.assigneeId, input.assigneeId));
    if (input.category) conditions.push(eq(requests.category, input.category));
    const search = input.search?.trim();
    if (search) conditions.push(or(like(requests.title, likeSearch(search)), like(requests.description, likeSearch(search)),
      like(requests.checkedGuidance, likeSearch(search)), like(requests.impact, likeSearch(search))));
    const condition = and(...conditions);
    const [count] = await tx.select({ total: sql<number>`count(*)`,
      payloadBytes: sql<number>`coalesce(sum(octet_length(${requests.title}) + octet_length(${requests.description}) + octet_length(${requests.category})), 0)`
    }).from(requests).where(condition);
    const total = verifiedTotal(count?.total);
    verifyPayloadBytes(count?.payloadBytes);
    const rows: RequestExportRow[] = await tx.select({ id: requests.id, title: requests.title, description: requests.description,
      category: requests.category, priority: requests.priority, status: requests.status, assigneeId: requests.assigneeId,
      createdAt: requests.createdAt, articleId: requests.articleId, resolvedAt: requests.resolvedAt }).from(requests).where(condition)
      .orderBy(desc(sql`case ${requests.priority} when 'high' then 3 when 'normal' then 2 else 1 end`), desc(requests.updatedAt), desc(requests.id))
      .limit(HANDBOOK_EXPORT_MAX_ROWS + 1);
    verifyRows(total, rows.map(row => row.id));
    const names = await people(tx, rows.flatMap(row => row.assigneeId === null ? [] : [row.assigneeId]));
    const ids = Array.from(new Set(rows.flatMap(row => row.articleId === null ? [] : [row.articleId])));
    const guides: GuideRow["article"][] = ids.length
      ? await tx.select(articleProjection).from(articles).where(inArray(articles.id, ids)).limit(ids.length + 1)
      : [];
    if (guides.length > ids.length || new Set(guides.map(row => row.id)).size !== guides.length || guides.some(row => !ids.includes(row.id)))
      fail("INTERNAL_SERVER_ERROR", "The handbook export guide links could not be verified.");
    const links = new Map(guides.map(row => [row.id, row]));
    return result(HANDBOOK_REQUEST_EXPORT_HEADERS, rows.map(row => {
      const guide = row.articleId === null ? undefined : links.get(row.articleId);
      const linkedSnapshot = row.articleId === null ? "" : guide?.publishedRevisionId ? "Published" : guide?.draftRevisionId ? "Working draft" : "Unavailable";
      return [row.id, row.title, row.description, row.category, row.priority, row.status, KNOWLEDGE_REQUEST_STATUS_LABELS[row.status],
        row.assigneeId, staffName(names, row.assigneeId), iso(row.createdAt), row.articleId,
        row.articleId === null ? "" : handbookGuideUrl(row.articleId), linkedSnapshot, guide ? articleState(guide) : "", iso(row.resolvedAt)];
    }), "Current missing-guidance workflow", generatedAt);
  }, { isolationLevel: "repeatable read" }));
}
