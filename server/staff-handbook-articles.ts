import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  staffHandbookArticles as articles,
  staffHandbookRevisions as revisions,
  staffHandbookResources as resources,
  staffKnowledgeRequests as requests,
  staffHandbookAudit as audit,
  inAppNotifications,
  users,
} from "../drizzle/schema";
import {
  STAFF_HANDBOOK_CATEGORIES,
  type HandbookContent,
} from "../shared/staff-handbook";
import {
  activeStaff,
  actorToken,
  appendRevision,
  auditHistory,
  bumpArticle,
  bumpRequest,
  countRows,
  getArticle,
  getRevision,
  HISTORY_LIMIT,
  insertId,
  likeSearch,
  lockArticle,
  PAGE_SIZE,
  recordAudit,
  revisionContent,
  revisionDto,
  snapshotIds,
  staffEligibility,
  withHandbookRead,
  withHandbookWrite,
  type ArticleRow,
  type HandbookDb,
} from "./staff-handbook-core";
import {
  articleState,
  assertFreshStaffHandbookAccount,
  assertIndependentReviewer,
  assertPublishable,
  fail,
  OPEN_REQUEST_STATUSES,
  requiresCycleReview,
  normaliseSubmittedContent,
  type HandbookAccount,
} from "./staff-handbook-policy";
import {
  handbookResourceDto,
  retireUnreferencedResources,
} from "./staff-handbook-resources";

function needsReviewCondition() {
  return and(
    isNull(articles.archivedAt),
    isNotNull(articles.submittedAt),
    or(
      isNull(articles.publishedRevisionId),
      ne(articles.draftRevisionId, articles.publishedRevisionId)
    ),
    or(
      isNull(articles.reviewedRevisionId),
      ne(articles.reviewedRevisionId, articles.draftRevisionId)
    )
  );
}
function dueReviewCondition(now: Date) {
  return sql`JSON_UNQUOTE(JSON_EXTRACT(${revisions.content}, '$.nextReviewAt')) < ${now.toISOString()}`;
}
export async function handbookOverview(actor: HandbookAccount) {
  return withHandbookRead(actor, async db => {
    const [requestMetrics] = await db
      .select({
        newRequests: sql<number>`sum(${requests.status} = 'new')`,
        unassignedRequests: sql<number>`sum(${requests.assigneeId} is null and ${requests.status} in ('new','triaged','assigned','drafting','in_review'))`,
        openRequests: sql<number>`sum(${requests.status} in ('new','triaged','assigned','drafting','in_review'))`,
      })
      .from(requests);
    const awaitingReview = await countRows(
      db,
      articles,
      needsReviewCondition()
    );
    const [guideMetrics] = await db
      .select({
        publishedGuides: sql<number>`count(*)`,
        overdueGuides: sql<number>`sum(${dueReviewCondition(new Date())})`,
      })
      .from(articles)
      .innerJoin(revisions, eq(revisions.id, articles.publishedRevisionId))
      .where(isNull(articles.archivedAt));
    const categoryRows = await db
      .select({ category: revisions.category })
      .from(revisions)
      .innerJoin(
        articles,
        or(
          eq(revisions.id, articles.draftRevisionId),
          eq(revisions.id, articles.publishedRevisionId)
        )
      )
      .groupBy(revisions.category)
      .orderBy(asc(revisions.category))
      .limit(501);
    const requestCategories = await db
      .select({ category: requests.category })
      .from(requests)
      .groupBy(requests.category)
      .orderBy(asc(requests.category))
      .limit(501);
    const staffRows = await activeStaff(db);
    const byAssignee = await db
      .select({
        id: requests.assigneeId,
        name: users.name,
        count: sql<number>`count(*)`,
      })
      .from(requests)
      .leftJoin(users, eq(users.id, requests.assigneeId))
      .where(inArray(requests.status, [...OPEN_REQUEST_STATUSES]))
      .groupBy(requests.assigneeId, users.name)
      .orderBy(desc(sql`count(*)`))
      .limit(501);
    const byCategory = await db
      .select({ category: requests.category, count: sql<number>`count(*)` })
      .from(requests)
      .where(inArray(requests.status, [...OPEN_REQUEST_STATUSES]))
      .groupBy(requests.category)
      .orderBy(desc(sql`count(*)`))
      .limit(501);
    if (
      categoryRows.length > 500 ||
      requestCategories.length > 500 ||
      byAssignee.length > 500 ||
      byCategory.length > 500
    )
      fail(
        "BAD_REQUEST",
        "The handbook overview exceeds the supported grouping limit."
      );
    return {
      metrics: {
        newRequests: Number(requestMetrics?.newRequests ?? 0),
        unassignedRequests: Number(requestMetrics?.unassignedRequests ?? 0),
        awaitingReview,
        overdueGuides: Number(guideMetrics?.overdueGuides ?? 0),
        openRequests: Number(requestMetrics?.openRequests ?? 0),
        publishedGuides: Number(guideMetrics?.publishedGuides ?? 0),
      },
      categories: Array.from(
        new Set([...categoryRows, ...requestCategories].map(r => r.category))
      ).sort(),
      staff: staffRows.map((r: any) => ({
        id: r.id,
        name: r.name ?? "JLT administrator",
      })),
      byAssignee: byAssignee.map((r: any) => ({
        id: r.id,
        name: r.id === null ? "Unassigned" : (r.name ?? "JLT administrator"),
        count: Number(r.count),
      })),
      byCategory: byCategory.map((r: any) => ({
        ...r,
        count: Number(r.count),
      })),
    };
  });
}
export async function browseHandbook(
  actor: HandbookAccount,
  input: {
    search?: string;
    category?: string;
    view?: "all" | "published" | "drafts" | "archived";
    needsReview?: boolean;
    dueReview?: boolean;
    page?: number;
  } = {}
) {
  return withHandbookRead(actor, async db => {
    const view = input.dueReview
        ? "published"
        : input.needsReview
          ? "drafts"
          : (input.view ?? "published"),
      page = input.page ?? 1;
    const pointer =
      view === "published"
        ? articles.publishedRevisionId
        : articles.draftRevisionId;
    const conditions: any[] = [
      view === "archived"
        ? isNotNull(articles.archivedAt)
        : isNull(articles.archivedAt),
    ];
    if (view === "drafts")
      conditions.push(
        or(
          isNull(articles.publishedRevisionId),
          ne(articles.draftRevisionId, articles.publishedRevisionId)
        )
      );
    if (input.needsReview) conditions.push(needsReviewCondition());
    if (input.dueReview) conditions.push(dueReviewCondition(new Date()));
    if (input.category) conditions.push(eq(revisions.category, input.category));
    const search = input.search?.trim();
    if (search) conditions.push(like(revisions.searchText, likeSearch(search)));
    const condition = and(...conditions);
    const [count] = await db
      .select({ total: sql<number>`count(*)` })
      .from(articles)
      .innerJoin(revisions, eq(revisions.id, pointer))
      .where(condition);
    const titleWeight = search
      ? sql<number>`case when ${revisions.title} = ${search} then 3 when ${revisions.title} like ${likeSearch(search)} then 2 else 0 end`
      : sql<number>`0`;
    // SQL filtering, ordering and paging (including body text) precede every DTO load.
    const rows = await db
      .select({ article: articles, revision: revisions })
      .from(articles)
      .innerJoin(revisions, eq(revisions.id, pointer))
      .where(condition)
      .orderBy(
        desc(sql`JSON_EXTRACT(${revisions.content}, '$.isPinned') = true`),
        desc(titleWeight),
        desc(articles.updatedAt),
        desc(articles.id)
      )
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const items = rows.map(
      ({
        article,
        revision,
      }: {
        article: ArticleRow;
        revision: typeof revisions.$inferSelect;
      }) => {
        const c = revisionContent(revision);
        return {
          id: article.id,
          version: article.version,
          title: c.title,
          summary: c.summary,
          category: c.category,
          tags: c.tags,
          sensitivity: c.sensitivity,
          format: c.format,
          isPinned: c.isPinned,
          nextReviewAt: c.nextReviewAt,
          updatedAt: article.updatedAt,
          state: articleState(article),
        };
      }
    );
    return {
      items,
      total: Number(count?.total ?? 0),
      page,
      pageSize: PAGE_SIZE,
    };
  });
}
export async function handbookArticle(actor: HandbookAccount, id: number) {
  return withHandbookRead(actor, async db => {
    const article = await getArticle(db, id);
    const draft = await getRevision(db, id, article.draftRevisionId),
      published = await getRevision(db, id, article.publishedRevisionId);
    const history = await db
      .select()
      .from(revisions)
      .where(eq(revisions.articleId, id))
      .orderBy(desc(revisions.revisionNumber))
      .limit(HISTORY_LIMIT);
    // Only current draft/published resources have authorized download URLs. History
    // retains exact resource IDs honestly, but never advertises retired downloads.
    const currentResourceIds = Array.from(
      new Set([
        ...(draft ? snapshotIds(draft.resourceIds) : []),
        ...(published ? snapshotIds(published.resourceIds) : []),
      ])
    );
    const resourceIds = Array.from(
      new Set([
        ...currentResourceIds,
        ...history.flatMap((revision: typeof revisions.$inferSelect) =>
          snapshotIds(revision.resourceIds)
        ),
      ])
    );
    if (resourceIds.length > 1000)
      fail(
        "BAD_REQUEST",
        "The guide resource history exceeds the supported limit."
      );
    const rows = resourceIds.length
      ? await db
          .select({
            id: resources.id,
            fileName: resources.fileName,
            mimeType: resources.mimeType,
            byteSize: resources.byteSize,
            removedAt: resources.removedAt,
          })
          .from(resources)
          .where(
            and(eq(resources.articleId, id), inArray(resources.id, resourceIds))
          )
          .limit(1000)
      : [];
    const {
      createToken: _token,
      createdAt: _createdAt,
      ...articleDto
    } = article;
    return {
      article: {
        ...articleDto,
        requiresIndependentReview:
          !!draft &&
          requiresCycleReview(
            draft.content as HandbookContent & {
              _cycleRequiresReview?: boolean;
            },
            published ? revisionContent(published) : null
          ),
      },
      draft: revisionDto(draft),
      published: revisionDto(published),
      revisions: history.map(revisionDto),
      resources: rows.map((r: any) =>
        handbookResourceDto(r, currentResourceIds, article.archivedAt)
      ),
      audit: await auditHistory(db, "article", id),
      history: {
        limit: HISTORY_LIMIT,
        revisionTotal: await countRows(
          db,
          revisions,
          eq(revisions.articleId, id)
        ),
        auditTotal: await countRows(
          db,
          audit,
          and(eq(audit.entityType, "article"), eq(audit.entityId, id))
        ),
      },
    };
  });
}
export async function createArticleInTransaction(
  db: HandbookDb,
  actorId: number,
  token: string,
  content: HandbookContent,
  changeSummary: string
) {
  await assertFreshStaffHandbookAccount(db, content.ownerId, true);
  const createToken = actorToken(actorId, token, "article");
  const [existing] = await db
    .select()
    .from(articles)
    .where(eq(articles.createToken, createToken))
    .limit(1)
    .for("update");
  if (existing) {
    if (existing.createdById !== actorId)
      fail("CONFLICT", "The creation token is not available.");
    return { id: existing.id, version: existing.version, created: false };
  }
  const id = await insertId(db, articles, {
    createToken,
    createdById: actorId,
    version: 1,
  });
  const row = await getArticle(db, id, true);
  const revisionId = await appendRevision(
    db,
    row,
    actorId,
    content,
    [],
    changeSummary
  );
  await db
    .update(articles)
    .set({ draftRevisionId: revisionId })
    .where(eq(articles.id, id));
  await recordAudit(
    db,
    "article",
    id,
    actorId,
    "created",
    "Internal guide created.",
    { revisionId }
  );
  return { id, version: 1, created: true };
}
export type HandbookArticleSaveInput = {
  id?: number;
  expectedVersion?: number;
  createToken?: string;
  content: HandbookContent;
  changeSummary: string;
};
async function saveArticleInTransaction(
  db: HandbookDb,
  actorId: number,
  input: HandbookArticleSaveInput
) {
  const changeSummary =
    input.changeSummary.trim() ||
    (input.id ? "Guide updated" : "Guide created");
  if (!input.id) {
    const content = normaliseSubmittedContent(input.content);
    if (!input.createToken)
      fail("BAD_REQUEST", "A creation token is required.");
    const result = await createArticleInTransaction(
      db,
      actorId,
      input.createToken,
      content,
      changeSummary
    );
    const stored = await getArticle(db, result.id);
    const revision = await getRevision(db, result.id, stored.draftRevisionId);
    if (
      !revision ||
      stored.version !== result.version
    )
      fail(
        "INTERNAL_SERVER_ERROR",
        "The guide save could not be verified. Your changes have not been committed."
      );
    if (JSON.stringify(revisionContent(revision)) !== JSON.stringify(content)) {
      if (!result.created)
        fail("CONFLICT", `Guide #${result.id} already exists from this save attempt, but these changed edits have not been saved. Your edits are retained; keep a copy before opening the existing guide.`);
      fail("INTERNAL_SERVER_ERROR", "The guide save could not be verified. Your changes have not been committed.");
    }
    return { id: result.id, version: result.version };
  }
  if (input.expectedVersion === undefined)
    fail("BAD_REQUEST", "A record version is required.");
  await assertFreshStaffHandbookAccount(db, input.content.ownerId, true);
  const article = await lockArticle(db, input.id, input.expectedVersion);
  if (article.archivedAt)
    fail("BAD_REQUEST", "Restore this guide before editing it.");
  const draft = await getRevision(db, article.id, article.draftRevisionId);
  const content = normaliseSubmittedContent(
    input.content,
    draft ? revisionContent(draft) : undefined
  );
  const revisionId = await appendRevision(
    db,
    article,
    actorId,
    content,
    draft ? snapshotIds(draft.resourceIds) : [],
    changeSummary
  );
  const result = await bumpArticle(db, article, {
    draftRevisionId: revisionId,
    reviewedRevisionId: null,
    reviewedById: null,
    submittedAt: null,
  });
  await recordAudit(
    db,
    "article",
    article.id,
    actorId,
    "saved",
    changeSummary,
    { revisionId }
  );
  const stored = await getArticle(db, article.id);
  const revision = await getRevision(db, article.id, stored.draftRevisionId);
  if (
    !revision ||
    stored.draftRevisionId !== revisionId ||
    stored.version !== result.version ||
    JSON.stringify(revisionContent(revision)) !== JSON.stringify(content)
  )
    fail(
      "INTERNAL_SERVER_ERROR",
      "The guide save could not be verified. Your changes have not been committed."
    );
  return result;
}
export async function saveHandbookArticle(
  actor: HandbookAccount,
  input: HandbookArticleSaveInput
) {
  return withHandbookWrite(actor, (db, actorId) =>
    saveArticleInTransaction(db, actorId, input)
  );
}
/** An explicit user action: draft save, checks, publication and linked-report resolution are one atomic DB transaction. */
export async function saveAndPublishHandbookArticle(
  actor: HandbookAccount,
  input: HandbookArticleSaveInput
) {
  return withHandbookWrite(actor, async (db, actorId) => {
    const result = await saveArticleInTransaction(db, actorId, input);
    const article = await getArticle(db, result.id);
    const draft = await getRevision(db, result.id, article.draftRevisionId);
    if (article.archivedAt || !draft)
      fail("BAD_REQUEST", "Restore this guide before publishing it.");
    // A create-token retry must never publish different content from what the staff member submitted.
    if (
      JSON.stringify(revisionContent(draft)) !==
      JSON.stringify(normaliseSubmittedContent(input.content))
    )
      fail(
        "CONFLICT",
        "This guide was already saved with different content. Open the saved guide before publishing it."
      );
    if (article.publishedRevisionId === draft.id) return result;
    return articleActionInTransaction(db, actorId, {
      id: result.id,
      expectedVersion: result.version,
      action: "publish",
    });
  });
}
/** Bounded pages, all updates and the generic admin-only notification in the publish transaction. */
async function resolveLinkedRequests(
  db: HandbookDb,
  articleId: number,
  revisionId: number,
  actorId: number
) {
  let afterId = 0;
  for (;;) {
    const batch = await db
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.articleId, articleId),
          inArray(requests.status, [...OPEN_REQUEST_STATUSES]),
          sql`${requests.id} > ${afterId}`
        )
      )
      .orderBy(asc(requests.id))
      .limit(100)
      .for("update");
    if (!batch.length) break;
    for (const request of batch) {
      await bumpRequest(db, request, {
        status: "resolved",
        resolvedRevisionId: revisionId,
        resolvedAt: new Date(),
        closureReason: null,
      });
      await recordAudit(
        db,
        "request",
        request.id,
        actorId,
        "resolved_by_publication",
        "Guidance published for this internal request.",
        { articleId, revisionId }
      );
      const [reporter] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, request.reporterId), staffEligibility))
        .limit(1)
        .for("update");
      if (reporter)
        await db.insert(inAppNotifications).values({
          userId: reporter.id,
          message: "Your internal knowledge request has guidance available",
          linkUrl: `/admin/staff-handbook?tab=handbook&article=${articleId}`,
          isRead: false,
          isUrgent: false,
        });
    }
    afterId = batch[batch.length - 1].id;
  }
}
export async function handbookArticleAction(
  actor: HandbookAccount,
  input: {
    id: number;
    expectedVersion: number;
    action: "submit_review" | "approve" | "publish" | "archive" | "restore";
  }
) {
  return withHandbookWrite(actor, (db, actorId) =>
    articleActionInTransaction(db, actorId, input)
  );
}
async function articleActionInTransaction(
  db: HandbookDb,
  actorId: number,
  input: {
    id: number;
    expectedVersion: number;
    action: "submit_review" | "approve" | "publish" | "archive" | "restore";
  }
) {
  if (input.action === "publish") {
    // Read-only preflight prevents an unplanned newly-eligible reviewer lock
    // after the first guide lock. The locked row is still rechecked below.
    const preflight = await getArticle(db, input.id);
    if (preflight.reviewedById)
      await assertFreshStaffHandbookAccount(db, preflight.reviewedById, true);
  }
  const article = await lockArticle(db, input.id, input.expectedVersion);
  let patch: Partial<typeof articles.$inferInsert>;
  if (input.action === "archive") {
    if (article.archivedAt)
      fail("BAD_REQUEST", "This guide is already archived.");
    patch = { archivedAt: new Date() };
  } else if (input.action === "restore") {
    if (!article.archivedAt) fail("BAD_REQUEST", "This guide is not archived.");
    patch = { archivedAt: null };
  } else {
    if (article.archivedAt) fail("BAD_REQUEST", "Restore this guide first.");
    const draft = await getRevision(db, article.id, article.draftRevisionId);
    if (!draft) fail("BAD_REQUEST", "Save a guide draft first.");
    if (article.draftRevisionId === article.publishedRevisionId)
      fail(
        "BAD_REQUEST",
        "Save changes before starting another publication cycle."
      );
    const content = revisionContent(draft);
    assertPublishable(content);
    const published = await getRevision(
      db,
      article.id,
      article.publishedRevisionId
    );
    const sensitive = requiresCycleReview(
      draft.content as HandbookContent & { _cycleRequiresReview?: boolean },
      published ? revisionContent(published) : null
    );
    if (input.action === "submit_review") {
      if (article.submittedAt)
        fail("BAD_REQUEST", "This revision has already been submitted.");
      patch = {
        submittedAt: new Date(),
        reviewedRevisionId: null,
        reviewedById: null,
      };
    } else if (input.action === "approve") {
      if (!article.submittedAt)
        fail("BAD_REQUEST", "Submit this revision for review first.");
      assertIndependentReviewer(snapshotIds(draft.contributorIds), actorId);
      if (article.reviewedRevisionId === draft.id)
        fail("BAD_REQUEST", "This revision has already been approved.");
      patch = { reviewedRevisionId: draft.id, reviewedById: actorId };
    } else {
      if (sensitive) {
        if (article.reviewedRevisionId !== draft.id || !article.reviewedById)
          fail(
            "FORBIDDEN",
            "This exact revision requires independent approval before publication."
          );
        await assertFreshStaffHandbookAccount(db, article.reviewedById, true);
        assertIndependentReviewer(
          snapshotIds(draft.contributorIds),
          article.reviewedById
        );
      }
      patch = { publishedRevisionId: draft.id, submittedAt: null };
      await resolveLinkedRequests(db, article.id, draft.id, actorId);
      await retireUnreferencedResources(
        db,
        article.id,
        snapshotIds(draft.resourceIds),
        snapshotIds(draft.resourceIds),
        actorId
      );
    }
  }
  const result = await bumpArticle(db, article, patch);
  await recordAudit(
    db,
    "article",
    article.id,
    actorId,
    input.action,
    `Internal guide action: ${input.action}.`,
    { revisionId: article.draftRevisionId }
  );
  const stored = await getArticle(db, article.id);
  if (
    stored.version !== result.version ||
    (input.action === "publish" &&
      stored.publishedRevisionId !== article.draftRevisionId)
  )
    fail(
      "INTERNAL_SERVER_ERROR",
      "The guide update could not be verified. Your changes have not been committed."
    );
  return result;
}
