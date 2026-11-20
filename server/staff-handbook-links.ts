import { and, asc, eq, isNull, like, ne, or, sql } from "drizzle-orm";
import {
  staffHandbookArticles as articles,
  staffHandbookRevisions as revisions,
  staffKnowledgeRequests as requests,
} from "../drizzle/schema";
import { likeSearch, PAGE_SIZE, withHandbookRead } from "./staff-handbook-core";
import type { HandbookAccount } from "./staff-handbook-policy";

export type HandbookLinkOption = {
  id: number;
  title: string;
  category: string;
  state: string;
};
export type HandbookLinkOptionsInput = {
  type: "guides" | "reports";
  scope?: "active" | "published";
  search?: string;
  page?: number;
  selectedId?: number | null;
  excludeId?: number;
};

/** Labels only. The mutation still locks and validates every exact linked target. */
export async function handbookLinkOptions(
  actor: HandbookAccount,
  input: HandbookLinkOptionsInput
): Promise<{
  items: HandbookLinkOption[];
  selected: HandbookLinkOption | null;
  total: number;
  page: number;
  pageSize: number;
}> {
  return withHandbookRead(actor, async db => {
    const page = input.page ?? 1;
    const search = input.search?.trim();
    const guides = input.type === "guides";
    const table = guides ? articles : requests;
    const id = guides ? articles.id : requests.id;
    const title = guides ? revisions.title : requests.title;
    const category = guides ? revisions.category : requests.category;
    const pointer =
      input.scope === "published"
        ? articles.publishedRevisionId
        : sql<number>`coalesce(${articles.draftRevisionId}, ${articles.publishedRevisionId})`;
    // Bind BOTH the revision pointer and its guide, never a historical snapshot
    // or a revision belonging to another guide. An inner join excludes missing
    // current revisions (including never-published guides in published scope).
    const join = and(
      eq(revisions.id, pointer),
      eq(revisions.articleId, articles.id)
    );
    const eligibility = and(
      guides ? isNull(articles.archivedAt) : undefined,
      input.excludeId !== undefined ? ne(id, input.excludeId) : undefined
    );
    const matching = and(
      eligibility,
      search
        ? or(
            like(title, likeSearch(search)),
            like(category, likeSearch(search))
          )
        : undefined
    );
    // Reports intentionally include closed and duplicate reports: the existing
    // locked duplicate validator remains responsible for rejecting cycles.
    const fields = {
      id,
      title,
      category,
      state: guides
        ? input.scope === "published"
          ? sql<string>`'published'`
          : sql<string>`case when coalesce(${articles.draftRevisionId}, ${articles.publishedRevisionId}) = ${articles.publishedRevisionId} and ${articles.publishedRevisionId} is not null then 'published' when ${articles.submittedAt} is not null then 'in_review' when ${articles.publishedRevisionId} is not null then 'changes' else 'draft' end`
        : requests.status,
    };
    const query = (projection: Record<string, unknown>) => {
      const base = db.select(projection).from(table);
      return guides ? base.innerJoin(revisions, join) : base;
    };
    const [count] = await query({ total: sql<number>`count(*)` }).where(
      matching
    );
    const items: HandbookLinkOption[] = await query(fields)
      .where(matching)
      .orderBy(asc(title), asc(id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    // Selection is independent of search/page, but never of visibility scope.
    // Do not load the guide/report body just to resolve its label.
    const selected: HandbookLinkOption | null = input.selectedId
      ? ((
          await query(fields)
            .where(and(eligibility, eq(id, input.selectedId)))
            .limit(1)
        )[0] ?? null)
      : null;
    return {
      items,
      selected,
      total: Number(count?.total ?? 0),
      page,
      pageSize: PAGE_SIZE,
    };
  });
}
