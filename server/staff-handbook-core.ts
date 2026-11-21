import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  users,
  staffHandbookArticles as articles,
  staffHandbookRevisions as revisions,
  staffHandbookAudit as audit,
  staffKnowledgeRequests as requests,
} from "../drizzle/schema";
import { getDb } from "./db";
import type { HandbookContent } from "../shared/staff-handbook";
import { setHandbookAccountLockPlan } from "./staff-handbook-lock-plan";
import {
  assertStaffHandbookAccount,
  assertFreshStaffHandbookAccount,
  assertVersion,
  fail,
  normaliseContent,
  plainHandbookText,
  safeHandbookError,
  type HandbookAccount,
} from "./staff-handbook-policy";
export type HandbookDb = any;
export type ArticleRow = typeof articles.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;
export type RequestRow = typeof requests.$inferSelect;
export const PAGE_SIZE = 25;
export const HISTORY_LIMIT = 100;
export const STAFF_LIMIT = 500;
export const staffEligibility = and(
  inArray(users.role, ["admin", "super_admin"]),
  eq(users.isActive, true),
  eq(users.portalStatus, "active"),
  eq(users.mustChangePassword, false)
);

export async function withHandbookRead<T>(
  actor: HandbookAccount,
  work: (db: HandbookDb, actorId: number) => Promise<T>
): Promise<T> {
  assertStaffHandbookAccount(actor);
  try {
    const db = await getDb();
    if (!db)
      fail(
        "INTERNAL_SERVER_ERROR",
        "The internal handbook is temporarily unavailable."
      );
    await assertFreshStaffHandbookAccount(db, actor.id);
    const result = await work(db, actor.id);
    await assertFreshStaffHandbookAccount(db, actor.id);
    return result;
  } catch (error) {
    throw safeHandbookError(error);
  }
}
export async function withHandbookWrite<T>(
  actor: HandbookAccount,
  work: (tx: HandbookDb, actorId: number) => Promise<T>
): Promise<T> {
  assertStaffHandbookAccount(actor);
  try {
    const db = await getDb();
    if (!db)
      fail(
        "INTERNAL_SERVER_ERROR",
        "The internal handbook is temporarily unavailable."
      );
    await assertFreshStaffHandbookAccount(db, actor.id);
    const actorId = actor.id;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await db.transaction(async (tx: HandbookDb) => {
          // The small internal editorial team shares one deterministic lock plan.
          // Lock eligible administrator accounts in ID order BEFORE any guide,
          // report, owner or reviewer row. This deliberately serializes handbook
          // writes and prevents actor/owner and guide/report lock inversions.
          // It does not serialize ordinary agent, booking or financial workflows.
          const team = await tx
            .select({ id: users.id })
            .from(users)
            .where(staffEligibility)
            .orderBy(asc(users.id))
            .limit(STAFF_LIMIT + 1);
          if (team.length > STAFF_LIMIT)
            fail(
              "INTERNAL_SERVER_ERROR",
              "The internal handbook team exceeds its supported limit."
            );
          const ids: number[] = team
            .map((member: { id: number }) => member.id)
            .sort((a: number, b: number) => a - b);
          if (!ids.includes(actorId))
            fail("FORBIDDEN", "Active JLT administrator access is required.");
          // Primary-key point ranges avoid a filtered FOR UPDATE table scan and
          // prevent secondary-index/filesort order from changing lock order.
          await tx
            .select({ id: users.id })
            .from(users, { forceIndex: "PRIMARY" })
            .where(inArray(users.id, ids))
            .orderBy(asc(users.id))
            .limit(STAFF_LIMIT)
            .for("update");
          setHandbookAccountLockPlan(tx, ids);
          await assertFreshStaffHandbookAccount(tx, actorId, true);
          const result = await work(tx, actorId);
          // Authorization and verified write readback complete BEFORE commit.
          // The locked actor row prevents revocation crossing this commit point.
          // Never turn an already-committed save into failure with a later read.
          await assertFreshStaffHandbookAccount(tx, actorId, true);
          return result;
        });
      } catch (error) {
        if (attempt === 2 || !isRetryableHandbookLockError(error)) throw error;
        // Retry the complete rolled-back DB transaction, not one partial write.
        // All callbacks here are DB-only: uploads happen before this wrapper and
        // notifications/audits are inserts inside the same transaction.
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    return fail(
      "INTERNAL_SERVER_ERROR",
      "The internal handbook operation could not be completed."
    );
  } catch (error) {
    throw safeHandbookError(error);
  }
}
export function isRetryableHandbookLockError(error: unknown): boolean {
  let candidate = error;
  const seen = new Set<unknown>();
  for (
    let depth = 0;
    depth < 8 &&
    candidate &&
    typeof candidate === "object" &&
    !seen.has(candidate);
    depth++
  ) {
    seen.add(candidate);
    const value = candidate as {
      code?: unknown;
      errno?: unknown;
      cause?: unknown;
    };
    if (
      value.code === "ER_LOCK_DEADLOCK" ||
      value.code === "ER_LOCK_WAIT_TIMEOUT" ||
      value.errno === 1213 ||
      value.errno === 1205
    )
      return true;
    candidate = value.cause;
  }
  return false;
}
export function actorToken(actorId: number, token: string, scope: string) {
  return createHash("sha256")
    .update(`staff-handbook:${scope}:${actorId}:${token}`)
    .digest("hex");
}
export async function insertId(
  db: HandbookDb,
  table: any,
  values: any
): Promise<number> {
  const [created] = await db.insert(table).values(values).$returningId();
  if (!Number.isSafeInteger(created?.id) || created.id < 1)
    fail(
      "INTERNAL_SERVER_ERROR",
      "The internal handbook operation could not be completed."
    );
  return created.id;
}
export async function getArticle(
  db: HandbookDb,
  id: number,
  lock = false
): Promise<ArticleRow> {
  const query = db.select().from(articles).where(eq(articles.id, id)).limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row) fail("NOT_FOUND", "Guide not found.");
  return row;
}
export async function lockArticle(
  db: HandbookDb,
  id: number,
  expectedVersion: number
) {
  const article = await getArticle(db, id, true);
  assertVersion(article.version, expectedVersion);
  return article;
}
export async function getRequest(
  db: HandbookDb,
  id: number,
  lock = false
): Promise<RequestRow> {
  const query = db.select().from(requests).where(eq(requests.id, id)).limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row) fail("NOT_FOUND", "Knowledge request not found.");
  return row;
}
export async function lockRequest(
  db: HandbookDb,
  id: number,
  expectedVersion: number
) {
  const row = await getRequest(db, id, true);
  assertVersion(row.version, expectedVersion);
  return row;
}
export async function getRevision(
  db: HandbookDb,
  articleId: number,
  id: number | null
): Promise<RevisionRow | null> {
  if (!id) return null;
  const [row] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, id), eq(revisions.articleId, articleId)))
    .limit(1);
  if (!row) fail("INTERNAL_SERVER_ERROR", "The guide snapshot is unavailable.");
  return row;
}
function date(value: unknown): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isFinite(d.getTime()) ? d : null;
}
export function revisionContent(row: RevisionRow): HandbookContent {
  const stored = row.content as HandbookContent;
  return normaliseContent({
    ...stored,
    reviewedAt: date(stored.reviewedAt),
    nextReviewAt: date(stored.nextReviewAt),
  });
}
export function revisionDto(row: RevisionRow | null) {
  return row
    ? {
        id: row.id,
        articleId: row.articleId,
        revisionNumber: row.revisionNumber,
        content: revisionContent(row),
        resourceIds: snapshotIds(row.resourceIds),
        contributorIds: snapshotIds(row.contributorIds),
        createdById: row.createdById,
        changeSummary: plainHandbookText(row.changeSummary),
        createdAt: row.createdAt,
      }
    : null;
}
export function snapshotIds(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    value.some(x => !Number.isSafeInteger(x) || x < 1)
  )
    fail("INTERNAL_SERVER_ERROR", "The guide snapshot is unavailable.");
  return Array.from(new Set(value as number[]));
}
export async function recordAudit(
  db: HandbookDb,
  entityType: "article" | "request" | "resource",
  entityId: number,
  actorId: number,
  action: string,
  summary: string,
  metadata: Record<string, unknown> = {}
) {
  await db.insert(audit).values({
    entityType,
    entityId,
    actorId,
    action,
    summary: plainHandbookText(summary).slice(0, 500),
    metadata,
  });
}
export async function auditHistory(
  db: HandbookDb,
  entityType: "article" | "request",
  entityId: number
) {
  return db
    .select({
      id: audit.id,
      action: audit.action,
      actorId: audit.actorId,
      summary: audit.summary,
      createdAt: audit.createdAt,
    })
    .from(audit)
    .where(and(eq(audit.entityType, entityType), eq(audit.entityId, entityId)))
    .orderBy(desc(audit.id))
    .limit(HISTORY_LIMIT);
}
export async function countRows(db: HandbookDb, table: any, condition?: any) {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(table)
    .where(condition);
  return Number(row?.total ?? 0);
}
export async function bumpArticle(
  db: HandbookDb,
  row: ArticleRow,
  patch: Partial<typeof articles.$inferInsert>
) {
  const result = await db
    .update(articles)
    .set({ ...patch, version: row.version + 1, updatedAt: new Date() })
    .where(and(eq(articles.id, row.id), eq(articles.version, row.version)));
  if (result?.[0]?.affectedRows !== 1)
    fail(
      "CONFLICT",
      "The guide update was not confirmed. Refresh the guide before retrying."
    );
  return { id: row.id, version: row.version + 1 };
}
export async function bumpRequest(
  db: HandbookDb,
  row: RequestRow,
  patch: Partial<typeof requests.$inferInsert>
) {
  await db
    .update(requests)
    .set({ ...patch, version: row.version + 1, updatedAt: new Date() })
    .where(and(eq(requests.id, row.id), eq(requests.version, row.version)));
  return { id: row.id, version: row.version + 1 };
}
/** No UPDATE/DELETE of revisions exists anywhere: published pointers retain immutable payloads. */
export async function appendRevision(
  db: HandbookDb,
  article: ArticleRow,
  actorId: number,
  content: HandbookContent,
  resourceIds: number[],
  changeSummary: string
) {
  const previous = await getRevision(db, article.id, article.draftRevisionId);
  const continuingCycle =
    previous && article.draftRevisionId !== article.publishedRevisionId;
  const published =
    article.publishedRevisionId === article.draftRevisionId
      ? previous
      : await getRevision(db, article.id, article.publishedRevisionId);
  const previousContent = previous?.content as
    | (HandbookContent & { _cycleRequiresReview?: boolean })
    | undefined;
  const publishedContent = published?.content as HandbookContent | undefined;
  // Ignore the prior cycle's flag after publication, but protect a downgrade of
  // a non-operational published guide. Client flags never enter this decision.
  const cycleRequiresReview =
    content.sensitivity !== "operational" ||
    (!!publishedContent && publishedContent.sensitivity !== "operational") ||
    (!!continuingCycle &&
      (previousContent?._cycleRequiresReview === true ||
        previousContent?.sensitivity !== "operational"));
  const cycleContributors =
    previous && article.draftRevisionId !== article.publishedRevisionId
      ? snapshotIds(previous.contributorIds)
      : [];
  const contributorIds = Array.from(new Set([...cycleContributors, actorId]));
  if (contributorIds.length > 1000 || resourceIds.length > 100)
    fail("BAD_REQUEST", "This guide has reached its snapshot limit.");
  const [last] = await db
    .select({ revisionNumber: revisions.revisionNumber })
    .from(revisions)
    .where(eq(revisions.articleId, article.id))
    .orderBy(desc(revisions.revisionNumber))
    .limit(1);
  const revisionNumber = (last?.revisionNumber ?? 0) + 1;
  const searchText = [
    content.title,
    content.summary,
    content.category,
    ...content.tags,
    plainHandbookText(content.contentHtml),
    ...Object.values(content.sections).map(plainHandbookText),
  ].join("\n");
  const id = await insertId(db, revisions, {
    articleId: article.id,
    revisionNumber,
    title: content.title,
    summary: content.summary,
    category: content.category,
    content: { ...content, _cycleRequiresReview: cycleRequiresReview },
    searchText,
    resourceIds,
    contributorIds,
    createdById: actorId,
    changeSummary: plainHandbookText(changeSummary).slice(0, 500),
  });
  return id;
}
export async function activeStaff(
  db: HandbookDb
): Promise<{ id: number; name: string | null }[]> {
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(staffEligibility)
    .orderBy(asc(users.name), asc(users.id))
    .limit(STAFF_LIMIT + 1);
  if (rows.length > STAFF_LIMIT)
    fail(
      "BAD_REQUEST",
      "The handbook staff directory exceeds the supported limit."
    );
  return rows;
}
export function requestDto(row: RequestRow) {
  // createToken is an internal idempotency secret, not a client-visible request field.
  const { createToken: _token, ...dto } = row;
  return dto;
}
export function likeSearch(value: string) {
  return `%${value.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}
/** Bare integer ORDER BY keys are column ordinals in MySQL: zero is invalid.
 * A blank search has no relevance key; keep identical browse/export ordering.
 */
export function handbookGuideOrderBy(search?: string) {
  const needle = search?.trim();
  return [
    desc(sql`JSON_EXTRACT(${revisions.content}, '$.isPinned') = true`),
    ...(needle
      ? [desc(sql<number>`case when ${revisions.title} = ${needle} then 3 when ${revisions.title} like ${likeSearch(needle)} then 2 else 0 end`)]
      : []),
    desc(articles.updatedAt),
    desc(articles.id),
  ];
}
