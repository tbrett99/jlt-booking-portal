import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import {
  staffKnowledgeRequests as requests,
  staffKnowledgeComments as comments,
  staffHandbookArticles as articles,
  staffHandbookAudit as audit,
} from "../drizzle/schema";
import {
  emptyHandbookContent,
  type KnowledgeRequestStatus,
} from "../shared/staff-handbook";
import {
  actorToken,
  auditHistory,
  bumpRequest,
  countRows,
  getArticle,
  getRequest,
  getRevision,
  HISTORY_LIMIT,
  insertId,
  likeSearch,
  lockRequest,
  PAGE_SIZE,
  recordAudit,
  requestDto,
  withHandbookRead,
  withHandbookWrite,
  type HandbookDb,
} from "./staff-handbook-core";
import {
  assertFreshStaffHandbookAccount,
  assertVersion,
  fail,
  isOpenRequest,
  OPEN_REQUEST_STATUSES,
  plainHandbookText,
  type HandbookAccount,
} from "./staff-handbook-policy";
import { createArticleInTransaction } from "./staff-handbook-articles";
export async function browseKnowledgeRequests(
  actor: HandbookAccount,
  input: {
    search?: string;
    status?: "all" | "open" | KnowledgeRequestStatus;
    assigneeId?: number | null;
    category?: string;
    page?: number;
  } = {}
) {
  return withHandbookRead(actor, async db => {
    const conditions: any[] = [],
      page = input.page ?? 1;
    if (input.status === "open")
      conditions.push(inArray(requests.status, [...OPEN_REQUEST_STATUSES]));
    else if (input.status && input.status !== "all")
      conditions.push(eq(requests.status, input.status));
    if (input.assigneeId !== undefined)
      conditions.push(
        input.assigneeId === null
          ? isNull(requests.assigneeId)
          : eq(requests.assigneeId, input.assigneeId)
      );
    if (input.category) conditions.push(eq(requests.category, input.category));
    const search = input.search?.trim();
    if (search)
      conditions.push(
        or(
          like(requests.title, likeSearch(search)),
          like(requests.description, likeSearch(search)),
          like(requests.checkedGuidance, likeSearch(search)),
          like(requests.impact, likeSearch(search))
        )
      );
    const condition = and(...conditions);
    const total = await countRows(db, requests, condition);
    const rows = await db
      .select()
      .from(requests)
      .where(condition)
      .orderBy(
        desc(
          sql`case ${requests.priority} when 'high' then 3 when 'normal' then 2 else 1 end`
        ),
        desc(requests.updatedAt),
        desc(requests.id)
      )
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    return { items: rows.map(requestDto), total, page, pageSize: PAGE_SIZE };
  });
}
export async function knowledgeRequest(actor: HandbookAccount, id: number) {
  return withHandbookRead(actor, async db => {
    const request = await getRequest(db, id);
    const rows = await db
      .select({
        id: comments.id,
        authorId: comments.authorId,
        body: comments.body,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .where(eq(comments.requestId, id))
      .orderBy(desc(comments.id))
      .limit(HISTORY_LIMIT);
    return {
      request: requestDto(request),
      comments: rows.reverse(),
      audit: await auditHistory(db, "request", id),
      history: {
        limit: HISTORY_LIMIT,
        commentsTotal: await countRows(
          db,
          comments,
          eq(comments.requestId, id)
        ),
        auditTotal: await countRows(
          db,
          audit,
          and(eq(audit.entityType, "request"), eq(audit.entityId, id))
        ),
      },
    };
  });
}
function text(value: string, name: string, max: number, required = true) {
  const result = plainHandbookText(value);
  if ((required && !result) || result.length > max)
    fail("BAD_REQUEST", `Invalid ${name}.`);
  return result;
}
async function assertArticleLink(db: HandbookDb, articleId: number | null) {
  if (articleId === null) return null;
  const article = await getArticle(db, articleId, true);
  if (article.archivedAt)
    fail("BAD_REQUEST", "Choose a guide that has not been archived.");
  return article;
}
type CreateKnowledgeRequestInput = {
  createToken: string;
  title: string;
  description: string;
  category: string;
  kind: (typeof requests.$inferSelect)["kind"];
  checkedGuidance: string;
  impact: string;
  priority: (typeof requests.$inferSelect)["priority"];
  articleId?: number | null;
};
function requestPayload(input: CreateKnowledgeRequestInput) {
  return {
    title: text(input.title, "request title", 255),
    description: text(input.description, "request description", 20000),
    category: text(input.category, "request category", 120),
    kind: input.kind,
    checkedGuidance: text(
      input.checkedGuidance,
      "checked guidance",
      10000,
      false
    ),
    impact: text(input.impact, "impact", 10000, false),
    priority: input.priority,
    articleId: input.articleId ?? null,
  };
}
/** Recover only the reporting actor's exact creation attempt, never by report ID. */
export async function recoverKnowledgeRequest(
  actor: HandbookAccount,
  input: { createToken: string }
) {
  return withHandbookRead(actor, async (db, actorId) => {
    const createToken = actorToken(actorId, input.createToken, "request");
    const [request] = await db
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.createToken, createToken),
          eq(requests.reporterId, actorId)
        )
      )
      .limit(1);
    return { request: request ? requestDto(request) : null };
  });
}
/** The reporter explicitly chooses to save edits after a lost creation response. */
export async function updateRecoveredKnowledgeRequest(
  actor: HandbookAccount,
  input: CreateKnowledgeRequestInput & { id: number; expectedVersion: number }
) {
  return withHandbookWrite(actor, async (db, actorId) => {
    const createToken = actorToken(actorId, input.createToken, "request");
    // Scope the locked read itself: an unrelated ID must not reveal existence,
    // current version or staff workflow state through differing error responses.
    const [request] = await db
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.id, input.id),
          eq(requests.createToken, createToken),
          eq(requests.reporterId, actorId)
        )
      )
      .limit(1)
      .for("update");
    if (
      !request ||
      request.createToken !== createToken ||
      request.reporterId !== actorId
    )
      fail("NOT_FOUND", "Saved report not found.");
    if (request.status !== "new" || request.version !== input.expectedVersion)
      fail(
        "CONFLICT",
        "This report has been updated by staff. Open the saved report to add your changes."
      );
    const payload = requestPayload(input);
    await assertArticleLink(db, payload.articleId);
    // Only the eight original report fields change; ownership, workflow,
    // assignment and the creation token remain exactly as locked above.
    const result = await bumpRequest(db, request, payload);
    await recordAudit(
      db,
      "request",
      request.id,
      actorId,
      "updated",
      "Latest report edits saved by the reporting administrator.",
      { articleId: payload.articleId }
    );
    return result;
  });
}
export async function createKnowledgeRequest(
  actor: HandbookAccount,
  input: CreateKnowledgeRequestInput
) {
  return withHandbookWrite(actor, async (db, actorId) => {
    const createToken = actorToken(actorId, input.createToken, "request");
    const payload = requestPayload(input);
    const [existing] = await db
      .select()
      .from(requests)
      .where(eq(requests.createToken, createToken))
      .limit(1)
      .for("update");
    if (existing) {
      if (existing.reporterId !== actorId)
        fail("CONFLICT", "The creation token is not available.");
      if (
        existing.title !== payload.title ||
        existing.description !== payload.description ||
        existing.category !== payload.category ||
        existing.kind !== payload.kind ||
        existing.checkedGuidance !== payload.checkedGuidance ||
        existing.impact !== payload.impact ||
        existing.priority !== payload.priority ||
        existing.articleId !== payload.articleId
      )
        fail(
          "CONFLICT",
          "This report was already submitted with different details. Your changes have not been saved. Check whether your report was saved before trying again."
        );
      return { id: existing.id, version: existing.version };
    }
    await assertArticleLink(db, payload.articleId);
    const id = await insertId(db, requests, {
      createToken,
      reporterId: actorId,
      ...payload,
      status: "new",
      version: 1,
    });
    await recordAudit(
      db,
      "request",
      id,
      actorId,
      "created",
      "Internal knowledge request created."
    );
    return { id, version: 1 };
  });
}
/** Every edge is validated inside the mutation; reject missing targets, self references and bounded-depth cycles. */
export async function assertRequestDuplicate(
  db: HandbookDb,
  requestId: number,
  duplicateOfId: number | null
) {
  const visited = new Set<number>([requestId]);
  let id = duplicateOfId;
  for (let depth = 0; id !== null; depth++) {
    if (visited.has(id))
      fail(
        "BAD_REQUEST",
        "Choose a different report. Duplicate reports cannot link back to this report."
      );
    if (depth >= 50)
      fail(
        "BAD_REQUEST",
        "Too many duplicate reports are linked together. Choose a different report."
      );
    visited.add(id);
    const target = await getRequest(db, id, true);
    id = target.duplicateOfId;
  }
}
export async function updateKnowledgeRequest(
  actor: HandbookAccount,
  input: {
    id: number;
    expectedVersion: number;
    status: KnowledgeRequestStatus;
    priority: (typeof requests.$inferSelect)["priority"];
    assigneeId: number | null;
    articleId: number | null;
    duplicateOfId: number | null;
    closureReason: string | null;
    title?: string;
    description?: string;
    category?: string;
  }
) {
  return withHandbookWrite(actor, async (db, actorId) => {
    const request = await lockRequest(db, input.id, input.expectedVersion);
    if (input.assigneeId !== null)
      await assertFreshStaffHandbookAccount(db, input.assigneeId, true);
    await assertRequestDuplicate(db, request.id, input.duplicateOfId);
    const article = await assertArticleLink(db, input.articleId);
    const closureReason =
      input.closureReason === null
        ? null
        : text(input.closureReason, "closure reason", 10000, false) || null;
    if (
      ["assigned", "drafting", "in_review"].includes(input.status) &&
      input.assigneeId === null
    )
      fail(
        "BAD_REQUEST",
        "Choose an active JLT administrator to work on this report."
      );
    if (
      input.duplicateOfId !== null &&
      (input.status !== "closed" || !closureReason)
    )
      fail("BAD_REQUEST", "Close this duplicate report and add a reason.");
    let resolvedRevisionId: number | null = null;
    if (input.status === "resolved") {
      resolvedRevisionId = article?.publishedRevisionId ?? null;
      if (resolvedRevisionId)
        await getRevision(db, article!.id, resolvedRevisionId);
      if (!resolvedRevisionId)
        fail(
          "BAD_REQUEST",
          "Choose a published guide to answer this report. A draft cannot answer it yet."
        );
    }
    if (input.status === "closed" && !closureReason)
      fail("BAD_REQUEST", "Add a reason for closing this report.");
    const patch: Partial<typeof requests.$inferInsert> = {
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId,
      articleId: input.articleId,
      duplicateOfId: input.duplicateOfId,
      closureReason: input.status === "closed" ? closureReason : null,
      resolvedRevisionId,
      resolvedAt: isOpenRequest(input.status) ? null : new Date(),
    };
    if (input.title !== undefined)
      patch.title = text(input.title, "request title", 255);
    if (input.description !== undefined)
      patch.description = text(input.description, "request description", 20000);
    if (input.category !== undefined)
      patch.category = text(input.category, "request category", 120);
    const result = await bumpRequest(db, request, patch);
    await recordAudit(
      db,
      "request",
      request.id,
      actorId,
      "updated",
      "Internal knowledge request updated.",
      {
        fromStatus: request.status,
        toStatus: input.status,
        articleId: input.articleId,
        revisionId: resolvedRevisionId,
        duplicateOfId: input.duplicateOfId,
        assigneeId: input.assigneeId,
      }
    );
    return result;
  });
}
export async function createGuideFromKnowledgeRequest(
  actor: HandbookAccount,
  input: { id: number; expectedVersion: number; createToken: string }
) {
  return withHandbookWrite(actor, async (db, actorId) => {
    const request = await getRequest(db, input.id, true);
    const token = actorToken(
      actorId,
      input.createToken,
      `request-guide-${request.id}`
    );
    // actorToken here derives a bounded token; createArticleInTransaction binds it again.
    const articleToken = actorToken(actorId, token, "article");
    const [existing] = await db
      .select()
      .from(articles)
      .where(eq(articles.createToken, articleToken))
      .limit(1)
      .for("update");
    if (
      existing &&
      existing.createdById === actorId &&
      request.articleId === existing.id
    )
      return { articleId: existing.id };
    assertVersion(request.version, input.expectedVersion);
    if (!isOpenRequest(request.status))
      fail("BAD_REQUEST", "Reopen this report before creating a guide.");
    if (request.articleId)
      fail("BAD_REQUEST", "This report already has a linked guide.");
    const content = {
      ...emptyHandbookContent(actorId),
      format: "article" as const,
      title: request.title,
      summary: request.description.slice(0, 4000),
      category: request.category,
    };
    const result = await createArticleInTransaction(
      db,
      actorId,
      token,
      content,
      "Draft created from an internal knowledge request."
    );
    await bumpRequest(db, request, {
      articleId: result.id,
      status: "drafting",
      assigneeId: request.assigneeId ?? actorId,
      resolvedAt: null,
      resolvedRevisionId: null,
      closureReason: null,
    });
    await recordAudit(
      db,
      "request",
      request.id,
      actorId,
      "guide_drafted",
      "A draft guide was created; this request remains open.",
      { articleId: result.id }
    );
    return { articleId: result.id };
  });
}
export async function addKnowledgeComment(
  actor: HandbookAccount,
  input: { id: number; expectedVersion: number; body: string }
) {
  return withHandbookWrite(actor, async (db, actorId) => {
    const request = await lockRequest(db, input.id, input.expectedVersion);
    const commentId = await insertId(db, comments, {
      requestId: request.id,
      authorId: actorId,
      body: text(input.body, "comment", 10000),
    });
    const result = await bumpRequest(db, request, {});
    await recordAudit(
      db,
      "request",
      request.id,
      actorId,
      "commented",
      "Comment added to internal knowledge request.",
      { commentId }
    );
    return result;
  });
}
