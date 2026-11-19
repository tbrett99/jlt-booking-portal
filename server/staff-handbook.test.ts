import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName, type SQL } from "drizzle-orm";
import {
  users,
  staffHandbookArticles as articles,
  staffHandbookRevisions as revisions,
  staffHandbookResources as resources,
  staffKnowledgeRequests as requests,
  staffKnowledgeComments as comments,
  staffHandbookAudit as audit,
  inAppNotifications,
} from "../drizzle/schema";
import {
  emptyHandbookContent,
  type HandbookContent,
} from "../shared/staff-handbook";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), encrypted: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./storage", () => ({
  storagePutEncrypted: mocks.encrypted,
  storagePut: () => {
    throw new Error("Public storage sentinel");
  },
  storageGet: () => {
    throw new Error("Public URL sentinel");
  },
}));
vi.mock("./_core/llm", () => ({
  invokeLLM: () => {
    throw new Error("Agent AI sentinel");
  },
}));
import {
  assertFreshStaffHandbookAccount,
  assertStaffHandbookAccount,
  assertPublishable,
  normaliseContent,
  requiresSecondReview,
  sanitiseHandbookHtml,
  safeHandbookHref,
} from "./staff-handbook-policy";
import {
  appendRevision,
  withHandbookRead,
  withHandbookWrite,
} from "./staff-handbook-core";
import {
  handbookArticleAction,
  saveHandbookArticle,
  handbookArticle,
  browseHandbook,
} from "./staff-handbook-articles";
import {
  uploadHandbookResource,
  removeHandbookResource,
  validateHandbookUpload,
} from "./staff-handbook-resources";
import {
  addKnowledgeComment,
  createKnowledgeRequest,
  updateKnowledgeRequest,
  createGuideFromKnowledgeRequest,
} from "./staff-handbook-requests";
import { staffHandbookRouter } from "./staff-handbook-router";
const admin = (id = 1, overrides = {}) => ({
  id,
  role: "admin",
  isActive: true,
  portalStatus: "active",
  mustChangePassword: false,
  name: `Admin ${id}`,
  ...overrides,
});
const NOW = new Date("2026-11-19T12:00:00Z");
const content = (patch: Partial<HandbookContent> = {}): HandbookContent => ({
  ...emptyHandbookContent(1),
  title: "Synthetic internal guide",
  format: "article",
  contentHtml: "<p>Synthetic private process.</p>",
  ...patch,
});
const allowed = [
  users,
  articles,
  revisions,
  resources,
  requests,
  comments,
  audit,
  inAppNotifications,
];
const dialect = new MySqlDialect();
/** Synthetic SQL evaluation ONLY: SQL and params are generated locally by Drizzle, never executed. */
function conditionMatches(condition: SQL | undefined, row: any) {
  if (!condition) return true;
  const q = dialect.sqlToQuery(condition);
  let index = 0;
  let expression = q.sql
    .replace(/\?/g, () => `p[${index++}]`)
    .replace(
      /`[^`]+`\.`([^`]+)`/g,
      (_match, name) => `r[${JSON.stringify(name)}]`
    );
  expression = expression.replace(
    /JSON_UNQUOTE\(JSON_EXTRACT\((r\["[^"]+"\]), '\$\.nextReviewAt'\)\)/g,
    (_m, prop) =>
      `(${prop}?.nextReviewAt ? new Date(${prop}.nextReviewAt).toISOString() : null)`
  );
  expression = expression
    .replace(
      /(r\["[^"]+"\]) not in \(([^)]+)\)/g,
      (_m, prop, list) => `!([${list}].includes(${prop}))`
    )
    .replace(
      /(r\["[^"]+"\]) in \(([^)]+)\)/g,
      (_m, prop, list) => `([${list}].includes(${prop}))`
    );
  expression = expression
    .replace(/ is not null/g, " != null")
    .replace(/ is null/g, " == null")
    .replace(/ = /g, " === ")
    .replace(/ <> /g, " !== ")
    .replace(/ and /g, " && ")
    .replace(/ or /g, " || ");
  try {
    return Function("r", "p", `return !!(${expression});`)(row, q.params);
  } catch {
    throw new Error(`Unsupported synthetic predicate: ${q.sql}`);
  }
}
function syntheticDb(accounts = [admin(), admin(2), admin(3)]) {
  let state: Record<string, any[]> = Object.fromEntries(
    allowed.map(t => [getTableName(t), []])
  );
  state.users = structuredClone(accounts);
  const reads: any[] = [],
    writes: any[] = [];
  let beforeTransaction: (() => void) | undefined;
  let afterAccountPlanSnapshot: (() => void) | undefined;
  function ensure(table: any) {
    if (!allowed.includes(table))
      throw new Error("Financial/agent KB/AI table sentinel");
    return getTableName(table);
  }
  function rows(table: any) {
    return state[ensure(table)];
  }
  function project(row: any, fields: any): any {
    if (!fields) return structuredClone(row);
    return Object.fromEntries(
      Object.entries(fields).map(([key, value]: [string, any]) => {
        if (value?.name) return [key, structuredClone(row[value.name])];
        if (value && allowed.includes(value))
          return [key, structuredClone(row)];
        if (value && typeof value === "object" && !value.queryChunks)
          return [key, project(row, value)];
        return [key, row[key]];
      })
    );
  }
  // SQL is a type only; projection needs only direct columns or count/metadata fields.
  const db: any = {
    select: vi.fn((fields?: any) => {
      let table: any,
        condition: SQL | undefined,
        maximum: number | undefined,
        skip = 0,
        locked = false,
        ordering: any[] = [],
        joined: any,
        joinCondition: SQL | undefined;
      const chain: any = {
        from(t: any) {
          ensure(t);
          table = t;
          return chain;
        },
        where(c: SQL) {
          condition = c;
          return chain;
        },
        limit(n: number) {
          maximum = n;
          return chain;
        },
        offset(n: number) {
          skip = n;
          return chain;
        },
        for(mode: string) {
          locked = mode === "update";
          return chain;
        },
        orderBy(...order: any[]) {
          ordering = order;
          return chain;
        },
        innerJoin(t: any, c: SQL) {
          ensure(t);
          joined = t;
          joinCondition = c;
          return chain;
        },
        leftJoin(t: any) {
          ensure(t);
          return chain;
        },
        groupBy() {
          return chain;
        },
        then(resolve: any, reject: any) {
          return Promise.resolve()
            .then(() => {
              const q = condition
                ? dialect.sqlToQuery(condition)
                : { sql: "", params: [] };
              reads.push({
                table,
                fields,
                limit: maximum,
                skip,
                ordering: ordering.map(order => dialect.sqlToQuery(order).sql),
                locked,
                sql: q.sql,
                params: q.params,
              });
              if (joined) {
                const join = dialect.sqlToQuery(joinCondition!);
                const usesPublished = join.sql.includes("publishedRevisionId");
                let matches = rows(table)
                  .flatMap(article =>
                    rows(joined)
                      .filter(
                        revision =>
                          revision.id ===
                          article[
                            usesPublished
                              ? "publishedRevisionId"
                              : "draftRevisionId"
                          ]
                      )
                      .map(revision => ({
                        article,
                        revision,
                        ...article,
                        ...revision,
                        id: article.id,
                      }))
                  )
                  .filter(row => conditionMatches(condition, row));
                if (fields?.total) return [{ total: matches.length }];
                matches = matches.slice(
                  skip,
                  maximum === undefined ? undefined : skip + maximum
                );
                return matches.map(row => ({
                  article: structuredClone(row.article),
                  revision: structuredClone(row.revision),
                }));
              }
              let result = rows(table).filter(r =>
                conditionMatches(condition, r)
              );
              if (
                table === users &&
                locked &&
                Object.keys(fields ?? {}).join() === "id"
              ) {
                const hook = afterAccountPlanSnapshot;
                afterAccountPlanSnapshot = undefined;
                hook?.();
              }
              if (fields?.total) return [{ total: result.length }];
              if (ordering.length)
                result = result
                  .slice()
                  .sort(
                    (a, b) =>
                      (b.revisionNumber ?? b.id) - (a.revisionNumber ?? a.id)
                  );
              result = result.slice(
                skip,
                maximum === undefined ? undefined : skip + maximum
              );
              return result.map(r => project(r, fields));
            })
            .then(resolve, reject);
        },
      };
      return chain;
    }),
    insert(table: any) {
      ensure(table);
      let values: any;
      const chain: any = {
        values(v: any) {
          values = v;
          return chain;
        },
        async $returningId() {
          return execute();
        },
        then(resolve: any, reject: any) {
          return Promise.resolve().then(execute).then(resolve, reject);
        },
      };
      function execute() {
        const added = (Array.isArray(values) ? values : [values]).map(v => {
          const id = rows(table).reduce((max, r) => Math.max(max, r.id), 0) + 1;
          const defaults =
            table === articles
              ? {
                  version: 1,
                  draftRevisionId: null,
                  publishedRevisionId: null,
                  reviewedRevisionId: null,
                  reviewedById: null,
                  submittedAt: null,
                  archivedAt: null,
                }
              : table === requests
                ? {
                    version: 1,
                    assigneeId: null,
                    articleId: null,
                    resolvedRevisionId: null,
                    duplicateOfId: null,
                    closureReason: null,
                    resolvedAt: null,
                  }
                : table === resources
                  ? { removedAt: null }
                  : {};
          const row = {
            ...defaults,
            id,
            createdAt: NOW,
            updatedAt: NOW,
            ...structuredClone(v),
          };
          rows(table).push(row);
          writes.push({ table, row: structuredClone(row), action: "insert" });
          return { id };
        });
        return added;
      }
      return chain;
    },
    update(table: any) {
      ensure(table);
      if (table === revisions || table === audit || table === comments)
        throw new Error("Immutable row update sentinel");
      let patch: any, condition: SQL;
      const chain: any = {
        set(p: any) {
          patch = p;
          return chain;
        },
        where(c: SQL) {
          condition = c;
          return chain;
        },
        then(resolve: any, reject: any) {
          return Promise.resolve()
            .then(() => {
              const matched = rows(table).filter(r => conditionMatches(condition, r));
              matched.forEach(r => {
                Object.assign(r, structuredClone(patch));
                writes.push({ table, patch, action: "update" });
              });
              return [{ affectedRows: matched.length }];
            })
            .then(resolve, reject);
        },
      };
      return chain;
    },
    async transaction(work: any) {
      beforeTransaction?.();
      const snapshot = structuredClone(state);
      try {
        return await work(db);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
  };
  const fixture = {
    db,
    rows,
    reads,
    writes,
    revokeBeforeTransaction(fn: () => void) {
      beforeTransaction = fn;
    },
    changeAfterAccountPlanSnapshot(fn: () => void) {
      afterAccountPlanSnapshot = fn;
    },
  };
  mocks.getDb.mockResolvedValue(db);
  return fixture;
}
// Test projection implementation avoids relying on runtime SQL class identity.
async function createGuide(
  c = content(),
  token = "synthetic_article_token_001"
) {
  return saveHandbookArticle(admin(), {
    createToken: token,
    content: c,
    changeSummary: "Synthetic creation",
  });
}
async function action(
  id: number,
  version: number,
  verb: "submit_review" | "approve" | "publish" | "archive" | "restore",
  actor = admin()
) {
  return handbookArticleAction(actor, {
    id,
    expectedVersion: version,
    action: verb,
  });
}
async function edit(
  id: number,
  version: number,
  c = content(),
  actor = admin()
) {
  return saveHandbookArticle(actor, {
    id,
    expectedVersion: version,
    content: c,
    changeSummary: "Synthetic edit",
  });
}
async function createRequest(token = "synthetic_request_token_001") {
  return createKnowledgeRequest(admin(), {
    createToken: token,
    title: "Synthetic report",
    description: "Missing steps",
    category: "General",
    kind: "missing_process",
    checkedGuidance: "Checked handbook",
    impact: "Recurrent questions",
    priority: "normal",
  });
}
function requestUpdate(id: number, version: number, patch = {}) {
  return {
    id,
    expectedVersion: version,
    status: "triaged" as const,
    priority: "normal" as const,
    assigneeId: null,
    articleId: null,
    duplicateOfId: null,
    closureReason: null,
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.encrypted.mockImplementation(async (key: string) => ({ key }));
});
describe("staff handbook strict role and fresh account boundary", () => {
  for (const role of [
    "agent",
    "business_staff",
    "instructor",
    "agent_engagement",
    "staff",
    "Admin",
  ])
    it(`denies ${role} before any read`, async () => {
      expect(() => assertStaffHandbookAccount(admin(1, { role }))).toThrow(
        "administrator"
      );
      await expect(
        withHandbookRead(admin(1, { role }), async () => 1)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocks.getDb).not.toHaveBeenCalled();
    });
  for (const patch of [
    { isActive: false },
    { portalStatus: "onboarding" },
    { portalStatus: "paused" },
    { portalStatus: "suspended" },
    { portalStatus: "in_notice" },
    { portalStatus: "cancelled" },
    { mustChangePassword: true },
    { mustChangePassword: undefined },
    { id: 0 },
  ])
    it(`denies ineligible account ${JSON.stringify(patch)}`, () =>
      expect(() => assertStaffHandbookAccount(admin(1, patch))).toThrow());
  it("accepts only exact real admin and super_admin roles", () => {
    assertStaffHandbookAccount(admin());
    assertStaffHandbookAccount(admin(2, { role: "super_admin" }));
  });
  it("fresh revocation blocks reads before content", async () => {
    const f = syntheticDb([admin(1, { isActive: false })]);
    await expect(handbookArticle(admin(), 7)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(f.reads.map(r => r.table)).toEqual([users]);
    expect(Object.keys(f.reads[0].fields)).toEqual([
      "id",
      "name",
      "role",
      "isActive",
      "portalStatus",
      "mustChangePassword",
    ]);
  });
  it("same transaction locked fresh recheck prevents midflight revocation", async () => {
    const f = syntheticDb();
    f.revokeBeforeTransaction(() => {
      f.rows(users)[0].mustChangePassword = true;
    });
    await expect(createGuide()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.rows(articles)).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
    expect(f.reads.some(r => r.table === users)).toBe(true);
  });
  it("sanitizes DB and transaction errors without cause/query/body leakage", async () => {
    mocks.getDb.mockRejectedValue(
      new Error("SELECT private title secret connection DATABASE_URL")
    );
    await expect(handbookArticle(admin(), 1)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The internal handbook operation could not be completed.",
      cause: undefined,
    });
  });
});
describe("parser rendering and classification policy", () => {
  it("strips active HTML, remote images, arbitrary src, data URLs, SVG and unsafe links", () => {
    const html = sanitiseHandbookHtml(
      '<p onclick="attack()" style="background:url(secret)">safe</p><script>secret</script><img src="https://remote.invalid/pixel"><svg><script>bad</script></svg><iframe src="/private"></iframe><a href="jav&#97;script:alert(1)">bad</a><a href="//remote.invalid">protocol</a><a href="http://unsafe.invalid">http</a><a href="/api/internal?raw=secret">query</a>'
    );
    expect(html).not.toMatch(
      /onclick|style=|<script|<img|<svg|<iframe|javascript|http:|\/api\//i
    );
    expect(html).toContain("safe");
  });
  it("keeps safe formatting, safe admin links and HTTPS without tracking embeds", () => {
    expect(
      sanitiseHandbookHtml(
        '<h2>Steps</h2><a href="https://example.invalid">safe</a><a href="/admin/staff-handbook">local</a>'
      )
    ).toContain('rel="noopener noreferrer"');
  });
  it("requires real text body or nonblank process steps before publishing", () => {
    expect(() =>
      assertPublishable(content({ contentHtml: "<p>&nbsp;&#32;</p>" }))
    ).toThrow();
    expect(() =>
      assertPublishable(
        content({
          format: "process",
          sections: {
            ...emptyHandbookContent(1).sections,
            checks: "checks",
            steps: "<p><br></p>",
          },
        })
      )
    ).toThrow();
    assertPublishable(
      content({
        format: "process",
        sections: {
          ...emptyHandbookContent(1).sections,
          steps: "<p>Do this</p>",
        },
      })
    );
  });
  it("does not force financial categories; downgrade still requires review", () => {
    expect(
      normaliseContent(content({ category: "Commission Administration" }))
        .sensitivity
    ).toBe("operational");
    expect(
      requiresSecondReview(content(), content({ sensitivity: "financial" }))
    ).toBe(true);
    for (const sensitivity of ["financial", "legal", "policy"] as const)
      expect(requiresSecondReview(content({ sensitivity }), null)).toBe(true);
  });
});
describe("append-only publication, author accumulation and exact approval", () => {
  it("operational author can publish; stale publish has no side effects", async () => {
    const f = syntheticDb();
    const a = await createGuide();
    const published = await action(a.id, a.version, "publish");
    expect(f.rows(articles)[0].publishedRevisionId).toBe(
      f.rows(revisions)[0].id
    );
    const before = f.rows(audit).length;
    await expect(action(a.id, a.version, "publish")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(f.rows(audit)).toHaveLength(before);
    expect(f.rows(inAppNotifications)).toHaveLength(0);
    expect(published.version).toBe(2);
  });
  it("sensitive author and every accumulated contributor cannot approve; exact independent approval publishes", async () => {
    const f = syntheticDb();
    const a = await createGuide(content({ sensitivity: "financial" }));
    await expect(action(a.id, 1, "publish")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const e = await edit(
      a.id,
      1,
      content({ sensitivity: "financial" }),
      admin(2)
    );
    const s = await action(a.id, e.version, "submit_review");
    for (const reviewer of [admin(), admin(2)])
      await expect(
        action(a.id, s.version, "approve", reviewer)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const approved = await action(a.id, s.version, "approve", admin(3));
    await action(a.id, approved.version, "publish");
    expect(f.rows(revisions)[1].contributorIds).toEqual([1, 2]);
    expect(f.rows(articles)[0].publishedRevisionId).toBe(
      f.rows(revisions)[1].id
    );
  });
  it("fresh approver revocation blocks publication", async () => {
    const f = syntheticDb();
    const a = await createGuide(content({ sensitivity: "legal" }));
    const s = await action(a.id, 1, "submit_review"),
      approved = await action(a.id, s.version, "approve", admin(2));
    f.rows(users).find(r => r.id === 2).portalStatus = "suspended";
    await expect(
      action(a.id, approved.version, "publish")
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.rows(articles)[0].publishedRevisionId).toBeNull();
  });
  it("save clears submission/approval, preserves published snapshot and resets contributor cycle after publish", async () => {
    const f = syntheticDb();
    const a = await createGuide();
    const pub = await action(a.id, 1, "publish");
    const old = structuredClone(f.rows(revisions)[0]);
    const e = await edit(
      a.id,
      pub.version,
      content({ sensitivity: "policy" }),
      admin(2)
    );
    expect(f.rows(revisions)[1].contributorIds).toEqual([2]);
    const s = await action(a.id, e.version, "submit_review", admin(2));
    const approved = await action(a.id, s.version, "approve");
    const changed = await edit(
      a.id,
      approved.version,
      content({ sensitivity: "policy", contentHtml: "<p>Changed body</p>" }),
      admin(2)
    );
    expect(f.rows(revisions)[0]).toEqual(old);
    expect(f.rows(articles)[0].publishedRevisionId).toBe(old.id);
    expect(f.rows(articles)[0]).toMatchObject({
      reviewedRevisionId: null,
      reviewedById: null,
      submittedAt: null,
    });
    await expect(
      action(a.id, changed.version, "publish", admin(2))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("prior sensitive published guide cannot bypass review by downgrading classification", async () => {
    const f = syntheticDb();
    const a = await createGuide(content({ sensitivity: "financial" }));
    const s = await action(a.id, 1, "submit_review"),
      approved = await action(a.id, s.version, "approve", admin(2)),
      pub = await action(a.id, approved.version, "publish");
    const e = await edit(
      a.id,
      pub.version,
      content({ sensitivity: "operational" })
    );
    await expect(action(a.id, e.version, "publish")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(f.rows(articles)[0].publishedRevisionId).toBe(
      f.rows(revisions)[0].id
    );
  });
  it("creation token retry does not duplicate article, snapshot or audit; tokens are actor-bound", async () => {
    const f = syntheticDb();
    const a = await createGuide();
    const retry = await createGuide();
    expect(retry).toEqual(a);
    await expect(createGuide(content({ title: "Different retry payload" }))).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("these changed edits have not been saved") });
    expect(f.rows(articles)).toHaveLength(1);
    expect(f.rows(revisions)).toHaveLength(1);
    expect(f.rows(audit)).toHaveLength(1);
    const other = await saveHandbookArticle(admin(2), {
      createToken: "synthetic_article_token_001",
      content: content(),
      changeSummary: "Other actor",
    });
    expect(other.id).not.toBe(a.id);
  });
});
describe("request lifecycle, comments, duplicates and transactional generic notification", () => {
  it("request creation retries are idempotent and comments stale-version retry cannot duplicate", async () => {
    const f = syntheticDb();
    const r = await createRequest();
    expect(await createRequest()).toEqual(r);
    const c = await addKnowledgeComment(admin(), {
      id: r.id,
      expectedVersion: r.version,
      body: "Synthetic comment",
    });
    await expect(
      addKnowledgeComment(admin(), {
        id: r.id,
        expectedVersion: r.version,
        body: "Synthetic comment",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(c.version).toBe(2);
    expect(f.rows(comments)).toHaveLength(1);
    expect(f.rows(requests)).toHaveLength(1);
  });
  it("rejects assignee agents, empty closure, unresolved drafts, self duplicates and cycles", async () => {
    const f = syntheticDb([admin(), admin(2, { role: "agent" })]);
    const r = await createRequest();
    await expect(
      updateKnowledgeRequest(admin(), requestUpdate(r.id, 1, { assigneeId: 2 }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      updateKnowledgeRequest(
        admin(),
        requestUpdate(r.id, 1, { status: "closed" })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      updateKnowledgeRequest(
        admin(),
        requestUpdate(r.id, 1, { status: "resolved" })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      updateKnowledgeRequest(
        admin(),
        requestUpdate(r.id, 1, {
          status: "closed",
          closureReason: "Duplicate",
          duplicateOfId: r.id,
        })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const second = await createRequest("synthetic_second_request_token");
    f.rows(requests).find(x => x.id === second.id).duplicateOfId = r.id;
    await expect(
      updateKnowledgeRequest(
        admin(),
        requestUpdate(r.id, 1, {
          status: "closed",
          closureReason: "Duplicate",
          duplicateOfId: second.id,
        })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.rows(requests)[0].version).toBe(1);
  });
  it("draft guide creation stays open and exact token retry is idempotent", async () => {
    const f = syntheticDb();
    const r = await createRequest();
    const input = {
      id: r.id,
      expectedVersion: 1,
      createToken: "synthetic_request_guide_token",
    };
    const result = await createGuideFromKnowledgeRequest(admin(), input);
    expect(await createGuideFromKnowledgeRequest(admin(), input)).toEqual(
      result
    );
    expect(f.rows(requests)[0]).toMatchObject({
      status: "drafting",
      resolvedRevisionId: null,
      articleId: result.articleId,
    });
    expect(f.rows(articles)).toHaveLength(1);
    expect(f.rows(inAppNotifications)).toHaveLength(0);
  });
  it("publication resolves linked open requests with exact snapshot and generic admin-only notification once", async () => {
    const f = syntheticDb();
    const r = await createRequest();
    const a = await createGuide();
    await updateKnowledgeRequest(
      admin(),
      requestUpdate(r.id, 1, { articleId: a.id })
    );
    await action(a.id, 1, "publish");
    expect(f.rows(requests)[0]).toMatchObject({
      status: "resolved",
      resolvedRevisionId: f.rows(revisions)[0].id,
    });
    expect(f.rows(inAppNotifications)[0]).toMatchObject({
      userId: 1,
      message: "Your internal knowledge request has guidance available",
      linkUrl: `/admin/staff-handbook?tab=handbook&article=${a.id}`,
    });
    expect(JSON.stringify(f.rows(inAppNotifications))).not.toContain(
      "Synthetic internal guide"
    );
    await expect(action(a.id, 1, "publish")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(f.rows(inAppNotifications)).toHaveLength(1);
  });
  it("revoked/agent reporters never receive notifications and reason-only outcomes must use closed", async () => {
    const f = syntheticDb();
    const r = await createRequest(),
      a = await createGuide();
    f.rows(requests)[0].reporterId = 3;
    f.rows(users).find(x => x.id === 3).role = "agent";
    await updateKnowledgeRequest(
      admin(),
      requestUpdate(r.id, 1, { articleId: a.id })
    );
    await action(a.id, 1, "publish");
    expect(f.rows(inAppNotifications)).toHaveLength(0);
    const another = await createRequest("synthetic_closure_reason_token");
    await updateKnowledgeRequest(
      admin(),
      requestUpdate(another.id, 1, {
        status: "closed",
        closureReason: "No guidance required; documented outcome",
      })
    );
    expect(f.rows(requests).find(x => x.id === another.id).status).toBe(
      "closed"
    );
  });
});

describe("independent review fixes through actual handbook router", () => {
  const caller = (actor = admin()) =>
    staffHandbookRouter.createCaller({ user: actor, req: {}, res: {} } as any);
  const routerSave = (
    patch: Partial<HandbookContent> = {},
    token = "synthetic_review_fix_article"
  ) =>
    caller().saveArticle({
      createToken: token,
      content: content(patch),
      changeSummary: "Regression creation",
    });

  it("financial to operational before first publication stays review-required and excludes all contributors", async () => {
    const f = syntheticDb();
    const created = await routerSave({ sensitivity: "financial" });
    const changed = await caller(admin(2)).saveArticle({
      id: created.id,
      expectedVersion: 1,
      content: content(),
      changeSummary: "Operational downgrade",
    });
    const detail = await caller().article({ id: created.id });
    expect(detail.article.requiresIndependentReview).toBe(true);
    expect(detail.draft?.content.sensitivity).toBe("operational");
    expect(f.rows(revisions)[1].content._cycleRequiresReview).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("_cycleRequiresReview");
    await expect(
      caller().articleAction({
        id: created.id,
        expectedVersion: changed.version,
        action: "publish",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const submitted = await caller().articleAction({
      id: created.id,
      expectedVersion: changed.version,
      action: "submit_review",
    });
    for (const actor of [admin(), admin(2)]) {
      await expect(
        caller(actor).articleAction({
          id: created.id,
          expectedVersion: submitted.version,
          action: "approve",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const approved = await caller(admin(3)).articleAction({
      id: created.id,
      expectedVersion: submitted.version,
      action: "approve",
    });
    await caller().articleAction({
      id: created.id,
      expectedVersion: approved.version,
      action: "publish",
    });
    expect(f.rows(articles)[0].publishedRevisionId).toBe(detail.draft?.id);
  });

  it("operational published to financial to operational stays sticky, then resets after operational publication", async () => {
    const f = syntheticDb();
    const created = await routerSave();
    const firstPub = await action(created.id, 1, "publish");
    const financial = await caller(admin(2)).saveArticle({
      id: created.id,
      expectedVersion: firstPub.version,
      content: content({ sensitivity: "financial" }),
      changeSummary: "Financial draft",
    });
    const operational = await caller().saveArticle({
      id: created.id,
      expectedVersion: financial.version,
      content: content(),
      changeSummary: "Operational revision",
    });
    expect(
      (await caller().article({ id: created.id })).article
        .requiresIndependentReview
    ).toBe(true);
    expect(f.rows(revisions)[2].contributorIds).toEqual([2, 1]);
    await expect(
      action(created.id, operational.version, "publish")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const submitted = await action(
      created.id,
      operational.version,
      "submit_review"
    );
    const approved = await action(
      created.id,
      submitted.version,
      "approve",
      admin(3)
    );
    const secondPub = await action(created.id, approved.version, "publish");
    const next = await caller(admin(2)).saveArticle({
      id: created.id,
      expectedVersion: secondPub.version,
      content: content(),
      changeSummary: "Next clean cycle",
    });
    expect(f.rows(revisions)[3].content._cycleRequiresReview).toBe(false);
    expect(f.rows(revisions)[3].contributorIds).toEqual([2]);
    expect(
      (await caller().article({ id: created.id })).article
        .requiresIndependentReview
    ).toBe(false);
    await action(created.id, next.version, "publish", admin(2));
  });

  it("client-supplied review flags are stripped and cannot force or bypass policy", async () => {
    const f = syntheticDb();
    const created = await caller().saveArticle({
      createToken: "synthetic_client_review_flag",
      content: {
        ...content({ sensitivity: "financial" }),
        _cycleRequiresReview: false,
      } as any,
      changeSummary: "Untrusted flag",
    });
    expect(f.rows(revisions)[0].content._cycleRequiresReview).toBe(true);
    await expect(
      action(created.id, created.version, "publish")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const operational = await caller().saveArticle({
      createToken: "synthetic_client_force_flag",
      content: { ...content(), _cycleRequiresReview: true } as any,
      changeSummary: "Untrusted flag",
    });
    expect(f.rows(revisions)[1].content._cycleRequiresReview).toBe(false);
    expect(
      (await caller().article({ id: operational.id })).article
        .requiresIndependentReview
    ).toBe(false);
  });

  it("literal angle placeholders round-trip in title, summary, category and tags without read mutation", async () => {
    const f = syntheticDb();
    const created = await routerSave({
      title: "Use <reference>",
      summary: "Summary <reference>",
      category: "Category <reference>",
      tags: ["<reference>", "A & B"],
      contentHtml:
        "<p>Keep &lt;reference&gt;</p><script>private attack</script>",
    });
    const before = structuredClone(f.rows(revisions)[0]);
    for (let i = 0; i < 3; i++) {
      const dto = await caller().article({ id: created.id });
      expect(dto.draft?.content).toMatchObject({
        title: "Use <reference>",
        summary: "Summary <reference>",
        category: "Category <reference>",
        tags: ["<reference>", "A & B"],
      });
      expect(dto.draft?.content.contentHtml).not.toMatch(
        /script|private attack/
      );
      expect(normaliseContent(normaliseContent(dto.draft!.content))).toEqual(
        dto.draft!.content
      );
    }
    await action(created.id, 1, "publish");
    const dto = await caller().article({ id: created.id });
    expect(dto.published?.content.title).toBe("Use <reference>");
    expect(f.rows(revisions)[0]).toEqual(before);
    const attached = await caller().uploadResource({
      articleId: created.id,
      expectedVersion: 2,
      fileName: "literal.txt",
      fileBase64: Buffer.from("Private").toString("base64"),
      mimeType: "text/plain",
    });
    expect(
      (await caller().article({ id: created.id })).draft?.content.title
    ).toBe("Use <reference>");
    expect(attached.version).toBe(3);
    const current = (await caller().article({ id: created.id })).draft!.content;
    await caller().saveArticle({
      id: created.id,
      expectedVersion: attached.version,
      content: {
        ...current,
        contentHtml: "<p>Edited safely</p><script>attack</script>",
      },
      changeSummary: "Plain fields unchanged",
    });
    const roundTrip = (await caller().article({ id: created.id })).draft!
      .content;
    expect(roundTrip).toMatchObject({
      title: "Use <reference>",
      summary: "Summary <reference>",
      tags: ["<reference>", "A & B"],
    });
    expect(roundTrip.contentHtml).toBe("<p>Edited safely</p>");
  });

  it.each(["<reference>", "&lt;reference&gt;", "&amp;lt;reference&amp;gt;", "<table>"])("preserves changed plain metadata and literal entity spellings through save/publish: %s", async placeholder => {
    const f = syntheticDb();
    const created = await routerSave({ title: `Use ${placeholder}`, summary: `Summary ${placeholder}`, category: `Category ${placeholder}`, tags: [placeholder, "A & B"] });
    const initial = (await caller().article({ id: created.id })).draft!.content;
    expect(initial.title).toBe(`Use ${placeholder}`);
    const changed = { ...initial, title: `${initial.title} now`, summary: `${initial.summary} updated`, category: `${initial.category} updated`, tags: [`${placeholder} updated`, "A & B updated"] };
    const saved = await caller().saveArticle({ id: created.id, expectedVersion: created.version, content: changed, changeSummary: "Update placeholder instructions" });
    for (let read = 0; read < 2; read++) {
      const value = (await caller().article({ id: created.id })).draft!.content;
      expect(value).toMatchObject(changed);
      expect(normaliseContent(normaliseContent(value))).toEqual(value);
    }
    const before = structuredClone(f.rows(revisions)[1]);
    await action(created.id, saved.version, "publish");
    expect((await caller().article({ id: created.id })).published!.content).toMatchObject(changed);
    expect(f.rows(revisions)[1]).toEqual(before);
  });

  it("allows only canonical same-app article/request queries and strips arbitrary or duplicated queries", () => {
    expect(
      safeHandbookHref("/admin/staff-handbook?article=12&tab=handbook")
    ).toBe("/admin/staff-handbook?tab=handbook&article=12");
    expect(
      safeHandbookHref("/admin/staff-handbook?tab=requests&request=7")
    ).toBe("/admin/staff-handbook?tab=requests&request=7");
    const safe = sanitiseHandbookHtml(
      '<a href="/admin/staff-handbook?tab=handbook&amp;article=12">Related guide</a>'
    );
    expect(safe).toContain(
      'href="/admin/staff-handbook?tab=handbook&amp;article=12"'
    );
    for (const url of [
      "/admin/staff-handbook?tab=handbook&article=0",
      "/admin/staff-handbook?tab=handbook&article=-1",
      "/admin/staff-handbook?tab=handbook&article=01",
      "/admin/staff-handbook?tab=handbook&article=2147483648",
      "/admin/staff-handbook?tab=handbook&article=2&secret=x",
      "/admin/staff-handbook?tab=handbook&tab=handbook",
      "/admin/staff-handbook?article=1&article=2",
      "/admin/staff-handbook?tab=requests&article=1",
      "/admin/staff-handbook?tab=handbook&article=%31",
      "/admin/staff-handbook?tab=handbook&article=1#private",
      "/admin/other?tab=handbook&article=1",
      "//evil.invalid/admin/staff-handbook?tab=handbook&article=1",
    ]) {
      expect(safeHandbookHref(url)).toBeNull();
      expect(
        sanitiseHandbookHtml(
          `<a href="${url.replace(/&/g, "&amp;")}">No link</a>`
        )
      ).not.toContain("href=");
    }
  });

  it("resolved rejects missing/draft guidance even with a closure reason while closed accepts reason-only", async () => {
    const f = syntheticDb();
    const guide = await routerSave();
    const request = await createRequest();
    for (const articleId of [null, guide.id]) {
      await expect(
        caller().updateRequest(
          requestUpdate(request.id, 1, {
            status: "resolved",
            articleId,
            closureReason: "Documented reason",
          })
        )
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(f.rows(requests)[0]).toMatchObject({
      status: "new",
      version: 1,
      resolvedRevisionId: null,
    });
    const closed = await caller().updateRequest(
      requestUpdate(request.id, 1, {
        status: "closed",
        closureReason: "Reason-only outcome",
      })
    );
    expect(closed.version).toBe(2);
    expect(f.rows(requests)[0]).toMatchObject({
      status: "closed",
      closureReason: "Reason-only outcome",
      resolvedRevisionId: null,
    });
  });

  it("resolved snapshots active current published guidance, never a newer draft, and rejects archived guidance", async () => {
    const f = syntheticDb();
    const guide = await routerSave();
    const published = await action(guide.id, 1, "publish");
    const edited = await edit(
      guide.id,
      published.version,
      content({ title: "New unpublished guidance" })
    );
    const request = await createRequest();
    await caller().updateRequest(
      requestUpdate(request.id, 1, {
        status: "resolved",
        articleId: guide.id,
        closureReason: "Not the resolution",
      })
    );
    expect(f.rows(requests)[0]).toMatchObject({
      resolvedRevisionId: f.rows(revisions)[0].id,
      closureReason: null,
    });
    await action(guide.id, edited.version, "archive");
    const second = await createRequest("synthetic_archived_request");
    await expect(
      caller().updateRequest(
        requestUpdate(second.id, 1, {
          status: "resolved",
          articleId: guide.id,
          closureReason: "No bypass",
        })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("historical and retired resource metadata stays immutable without a download URL", async () => {
    const f = syntheticDb();
    const guide = await routerSave();
    const upload = await caller().uploadResource({
      articleId: guide.id,
      expectedVersion: 1,
      fileName: "immutable-original.txt",
      fileBase64: Buffer.from("Private file").toString("base64"),
      mimeType: "text/plain",
    });
    const published = await action(guide.id, upload.version, "publish");
    const removed = await caller().removeResource({
      articleId: guide.id,
      resourceId: upload.resourceId,
      expectedVersion: published.version,
    });
    let dto = await caller().article({ id: guide.id });
    expect(dto.resources[0]).toMatchObject({
      id: upload.resourceId,
      fileName: "immutable-original.txt",
      available: true,
      url: `/api/staff-handbook/resource/${upload.resourceId}`,
    });
    await action(guide.id, removed.version, "publish");
    dto = await caller().article({ id: guide.id });
    expect(dto.resources[0]).toMatchObject({
      id: upload.resourceId,
      fileName: "immutable-original.txt",
      available: false,
    });
    expect(dto.resources[0]).not.toHaveProperty("url");
    expect(
      dto.revisions.find(r => r.id === f.rows(revisions)[1].id)?.resourceIds
    ).toEqual([upload.resourceId]);
    f.rows(resources)[0].removedAt = null; // historical-only alone must never grant URL access.
    expect(
      (await caller().article({ id: guide.id })).resources[0].available
    ).toBe(false);
    expect(
      (await caller().article({ id: guide.id })).resources[0]
    ).not.toHaveProperty("url");
  });

  it("current snapshots pointing to removed files and archived guides never advertise download availability", async () => {
    const f = syntheticDb();
    const guide = await routerSave();
    const upload = await caller().uploadResource({
      articleId: guide.id,
      expectedVersion: 1,
      fileName: "removed.txt",
      fileBase64: Buffer.from("Private file").toString("base64"),
      mimeType: "text/plain",
    });
    f.rows(resources)[0].removedAt = NOW;
    let dto = await caller().article({ id: guide.id });
    expect(dto.resources[0].available).toBe(false);
    expect(dto.resources[0]).not.toHaveProperty("url");
    f.rows(resources)[0].removedAt = null;
    await action(guide.id, upload.version, "archive");
    dto = await caller().article({ id: guide.id });
    expect(dto.resources[0].available).toBe(false);
    expect(dto.resources[0]).not.toHaveProperty("url");
    expect(JSON.stringify(dto.resources)).not.toMatch(
      /fileKey|sha256|removedAt|uploadedById/
    );
  });

  it("needsReview returns submitted active pending changed drafts only and applies SQL before paging", async () => {
    const f = syntheticDb();
    const fixtures = [
      { submittedAt: NOW, publishedRevisionId: null, reviewedRevisionId: null },
      {
        submittedAt: null,
        publishedRevisionId: null,
        reviewedRevisionId: null,
      },
      {
        submittedAt: NOW,
        publishedRevisionId: null,
        reviewedRevisionId: null,
        archivedAt: NOW,
      },
      {
        submittedAt: NOW,
        publishedRevisionId: "self",
        reviewedRevisionId: null,
      },
      {
        submittedAt: NOW,
        publishedRevisionId: null,
        reviewedRevisionId: "self",
      },
    ];
    for (let i = 0; i < fixtures.length; i++) {
      const guide = await routerSave(
        { title: `Review fixture ${i}` },
        `synthetic_review_fixture_${i}`
      );
      const row = f.rows(articles).find(r => r.id === guide.id);
      const fixture = fixtures[i];
      Object.assign(row, fixture, {
        publishedRevisionId:
          fixture.publishedRevisionId === "self"
            ? row.draftRevisionId
            : fixture.publishedRevisionId,
        reviewedRevisionId:
          fixture.reviewedRevisionId === "self"
            ? row.draftRevisionId
            : fixture.reviewedRevisionId,
      });
    }
    const result = await caller().browse({ needsReview: true, page: 1 });
    expect(result.items.map(item => item.id)).toEqual([1]);
    expect(result.total).toBe(1);
    const query = f.reads.filter(r => r.table === articles).at(-1);
    expect(query).toMatchObject({ limit: 25, skip: 0 });
    expect(query.sql).toMatch(/submittedAt.*is not null/);
    expect(query.sql).toContain("reviewedRevisionId");
  });

  it("dueReview returns only active overdue current published content, not overdue drafts or future/null dates", async () => {
    const f = syntheticDb();
    const past = new Date("2000-01-01T00:00:00Z"),
      future = new Date("2100-01-01T00:00:00Z");
    for (let i = 0; i < 4; i++) {
      const guide = await routerSave(
        { nextReviewAt: i === 0 || i === 3 ? past : i === 1 ? future : null },
        `synthetic_due_fixture_${i}`
      );
      const published = await action(guide.id, 1, "publish");
      if (i === 1)
        await edit(
          guide.id,
          published.version,
          content({ nextReviewAt: past })
        );
      if (i === 3) await action(guide.id, published.version, "archive");
    }
    await routerSave({ nextReviewAt: past }, "synthetic_due_unpublished");
    const result = await caller().browse({
      dueReview: true,
      view: "drafts",
      page: 1,
    });
    expect(result.items.map(item => item.id)).toEqual([1]);
    expect(result.total).toBe(1);
    expect(f.reads.filter(r => r.table === articles).at(-1).sql).toContain(
      "JSON_UNQUOTE(JSON_EXTRACT"
    );
  });

  it("open request query includes all five open states and excludes resolved/closed; open is not a mutation enum", async () => {
    const f = syntheticDb();
    const statuses = [
      "new",
      "triaged",
      "assigned",
      "drafting",
      "in_review",
      "resolved",
      "closed",
    ];
    for (let i = 0; i < statuses.length; i++) {
      const report = await createRequest(`synthetic_open_fixture_${i}`);
      f.rows(requests).find(row => row.id === report.id).status = statuses[i];
    }
    const result = await caller().requests({ status: "open", page: 1 });
    expect(result.total).toBe(5);
    expect(result.items.map(item => item.status).sort()).toEqual(
      statuses.slice(0, 5).sort()
    );
    await expect(
      caller().updateRequest(requestUpdate(1, 1, { status: "open" }) as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("newly eligible unplanned owner fails CONFLICT before any article lock or owner query", async () => {
    const f = syntheticDb([
      admin(),
      admin(2),
      admin(3),
      admin(4, { isActive: false }),
    ]);
    f.changeAfterAccountPlanSnapshot(() => {
      f.rows(users).find(row => row.id === 4).isActive = true;
    });
    await expect(routerSave({ ownerId: 4 })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(f.reads.some(read => read.table === articles && read.locked)).toBe(
      false
    );
    expect(
      f.reads.some(
        read =>
          read.table === users &&
          read.params.length === 1 &&
          read.params[0] === 4
      )
    ).toBe(false);
    expect(f.rows(articles)).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
  });

  it("newly eligible unplanned reviewer fails CONFLICT before any article lock or reviewer query", async () => {
    const f = syntheticDb([
      admin(),
      admin(2),
      admin(3),
      admin(4, { isActive: false }),
    ]);
    const guide = await routerSave({ sensitivity: "financial" });
    f.rows(articles)[0].reviewedById = 4;
    f.rows(articles)[0].reviewedRevisionId =
      f.rows(articles)[0].draftRevisionId;
    const before = f.reads.length;
    f.changeAfterAccountPlanSnapshot(() => {
      f.rows(users).find(row => row.id === 4).isActive = true;
    });
    await expect(
      caller().articleAction({
        id: guide.id,
        expectedVersion: 1,
        action: "publish",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const reads = f.reads.slice(before);
    expect(reads.some(read => read.table === articles && read.locked)).toBe(
      false
    );
    expect(
      reads.some(
        read =>
          read.table === users &&
          read.params.length === 1 &&
          read.params[0] === 4
      )
    ).toBe(false);
    expect(f.rows(articles)[0].publishedRevisionId).toBeNull();
  });
});
describe("private attachment bounds and review invalidation", () => {
  it("validates base64, max10MB, MIME-extension/signature and denies active/executable file types", () => {
    expect(
      validateHandbookUpload(
        "test.txt",
        Buffer.from("Plain private file").toString("base64"),
        "text/plain"
      ).bytes.length
    ).toBeGreaterThan(0);
    for (const [file, body, mime] of [
      ["bad.svg", "<svg/>", "image/svg+xml"],
      ["bad.txt", "<html>bad</html>", "text/plain"],
      ["bad.pdf", "notpdf", "application/pdf"],
      [
        "bad.docx",
        "PKxx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      ["bad.png", "notpng", "image/png"],
      ["bad.jpg", "notjpeg", "image/jpeg"],
      ["../bad.txt", "plain", "text/plain"],
    ])
      expect(() =>
        validateHandbookUpload(file, Buffer.from(body).toString("base64"), mime)
      ).toThrow();
    expect(() =>
      validateHandbookUpload(
        "big.txt",
        Buffer.alloc(10 * 1024 * 1024 + 1, 65).toString("base64"),
        "text/plain"
      )
    ).toThrow();
    expect(() =>
      validateHandbookUpload("bad.txt", "abc!", "text/plain")
    ).toThrow();
  });
  it("permission denial happens before decoding or slow storage", async () => {
    syntheticDb();
    await expect(
      uploadHandbookResource(admin(1, { role: "agent" }), {
        articleId: 1,
        expectedVersion: 1,
        fileName: "x.txt",
        fileBase64: "invalid",
        mimeType: "text/plain",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.encrypted).not.toHaveBeenCalled();
  });
  it("upload is encrypted in private namespace, appends snapshot and invalidates exact pending approval", async () => {
    const f = syntheticDb();
    const a = await createGuide(content({ sensitivity: "policy" }));
    const s = await action(a.id, 1, "submit_review"),
      approved = await action(a.id, s.version, "approve", admin(2));
    const result = await uploadHandbookResource(admin(), {
      articleId: a.id,
      expectedVersion: approved.version,
      fileName: "private.txt",
      fileBase64: Buffer.from("Private attachment").toString("base64"),
      mimeType: "text/plain",
    });
    expect(mocks.encrypted.mock.calls[0][0]).toMatch(/^staff-handbook\//);
    expect(Buffer.isBuffer(mocks.encrypted.mock.calls[0][1])).toBe(true);
    expect(f.rows(articles)[0]).toMatchObject({
      reviewedRevisionId: null,
      reviewedById: null,
      submittedAt: null,
    });
    expect(f.rows(revisions)[1].resourceIds).toEqual([result.resourceId]);
    await expect(action(a.id, result.version, "publish")).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
  });
  it("revocation during slow encrypted upload prevents association and audit writes", async () => {
    const f = syntheticDb();
    const a = await createGuide();
    mocks.encrypted.mockImplementation(async (key: string) => {
      f.rows(users)[0].isActive = false;
      return { key };
    });
    await expect(
      uploadHandbookResource(admin(), {
        articleId: a.id,
        expectedVersion: 1,
        fileName: "private.txt",
        fileBase64: Buffer.from("Private").toString("base64"),
        mimeType: "text/plain",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.rows(resources)).toHaveLength(0);
    expect(f.rows(revisions)).toHaveLength(1);
  });
  it("draft attachment removal preserves current published payload until publish retires it", async () => {
    const f = syntheticDb();
    const a = await createGuide();
    const u = await uploadHandbookResource(admin(), {
      articleId: a.id,
      expectedVersion: 1,
      fileName: "private.txt",
      fileBase64: Buffer.from("Private").toString("base64"),
      mimeType: "text/plain",
    });
    const pub = await action(a.id, u.version, "publish");
    const old = structuredClone(f.rows(revisions)[1]);
    const removed = await removeHandbookResource(admin(), {
      articleId: a.id,
      resourceId: u.resourceId,
      expectedVersion: pub.version,
    });
    expect(f.rows(resources)[0].removedAt).toBeNull();
    expect(f.rows(revisions)[1]).toEqual(old);
    expect(f.rows(revisions)[2].resourceIds).toEqual([]);
    await action(a.id, removed.version, "publish");
    expect(f.rows(resources)[0].removedAt).toBeInstanceOf(Date);
    expect(f.rows(revisions)[1]).toEqual(old);
    expect(
      f
        .rows(audit)
        .some(x => x.entityType === "resource" && x.action === "retired")
    ).toBe(true);
  });
});
describe("API boundary and bounded SQL separation sentinels", () => {
  it("executes actual router mutation and detail contracts with append-only snapshots", async () => {
    const f = syntheticDb();
    const caller = staffHandbookRouter.createCaller({
      user: admin(),
      req: {},
      res: {},
    } as any);
    const created = await caller.saveArticle({
      createToken: "synthetic_router_article_token",
      content: content(),
      changeSummary: "Router fixture",
    });
    expect(created).toEqual({ id: 1, version: 1 });
    const pub = await caller.articleAction({
      id: created.id,
      expectedVersion: created.version,
      action: "publish",
    });
    const dto = await caller.article({ id: created.id });
    expect(pub.version).toBe(2);
    expect(dto.published?.content.title).toBe("Synthetic internal guide");
    expect(dto.article.publishedRevisionId).toBe(dto.draft?.id);
    expect(f.rows(revisions)).toHaveLength(1);
    const report = await caller.createRequest({
      createToken: "synthetic_router_request_token",
      title: "Report",
      description: "Missing",
      category: "General",
      kind: "missing_process",
      checkedGuidance: "",
      impact: "",
      priority: "normal",
    });
    const comment = await caller.addComment({
      id: report.id,
      expectedVersion: report.version,
      body: "<script>secret</script>Safe comment",
    });
    expect(comment).toEqual({ id: report.id, version: 2 });
    expect((await caller.request({ id: report.id })).comments[0].body).toBe(
      "Safe comment"
    );
  });
  it("revocation after a slow read prevents content return", async () => {
    const f = syntheticDb();
    await expect(
      withHandbookRead(admin(), async () => {
        f.rows(users)[0].portalStatus = "paused";
        return { content: "INTERNAL PRIVATE CONTENT" };
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.reads).toHaveLength(2);
  });
  it("exports exactly the requested method namespace", () =>
    expect(Object.keys(staffHandbookRouter._def.procedures).sort()).toEqual(
      [
        "overview",
        "browse",
        "article",
        "saveArticle",
        "saveAndPublishArticle",
        "articleAction",
        "uploadResource",
        "removeResource",
        "requests",
        "request",
        "createRequest",
        "updateRequest",
        "createGuideFromRequest",
        "addComment",
      ].sort()
    ));
  it("malformed API body returns generic error rather than raw input/query", async () => {
    syntheticDb();
    const caller = staffHandbookRouter.createCaller({
      user: admin(),
      req: {},
      res: {},
    } as any);
    await expect(
      caller.saveArticle({ content: { title: "INTERNAL SECRET BODY" } } as any)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Invalid internal handbook input.",
    });
  });
  it("browse uses body search, weighted title, DB max25 paging and no agent/financial table reads", async () => {
    const f = syntheticDb();
    const result = await browseHandbook(admin(), {
      search: "secret body",
      view: "drafts",
      page: 3,
    });
    expect(result.pageSize).toBe(25);
    const reads = f.reads.filter(r => r.table === articles);
    expect(reads[reads.length - 1]).toMatchObject({ limit: 25, skip: 50 });
    expect(reads[reads.length - 1].sql).toContain("searchText");
    expect(f.writes).toHaveLength(0);
  });
  it("article DTO hides all storage keys and token and honestly bounds historical revisions", async () => {
    const f = syntheticDb();
    const a = await createGuide();
    for (let i = 0; i < 105; i++) await edit(a.id, i + 1);
    const dto = await handbookArticle(admin(), a.id);
    expect(dto.revisions).toHaveLength(100);
    expect(dto.history.revisionTotal).toBe(106);
    expect(JSON.stringify(dto)).not.toContain("createToken");
    expect(JSON.stringify(dto)).not.toContain("fileKey");
    expect(
      f.reads
        .filter(r => r.table === revisions && !r.fields)
        .every(r => r.limit !== undefined)
    ).toBe(true);
  });
});

describe("simple handbook save and atomic internal publication", () => {
  const caller = (actor = admin()) => staffHandbookRouter.createCaller({ user: actor, req: {}, res: {} } as any);
  it("saves title and body without requiring a separate change summary, and returns verified stored content", async () => {
    const f = syntheticDb();
    const result = await caller().saveArticle({ createToken: "simple_save_token_01", content: content() } as any);
    const row = f.rows(articles).find(r => r.id === result.id);
    const revision = f.rows(revisions).find(r => r.id === row.draftRevisionId);
    expect(row.version).toBe(result.version);
    expect(revision.content.title).toBe("Synthetic internal guide");
    expect(revision.changeSummary).toBe("Guide created");
    expect(row.publishedRevisionId).toBeNull();
    const all = await caller().browse({ view: "all" });
    expect(all.items.map(i => i.id)).toContain(result.id);
    expect((await caller().browse({ view: "published" })).items).toEqual([]);
  });
  it("saves and publishes an operational guide as one transaction and one immutable revision", async () => {
    const f = syntheticDb();
    const result = await caller().saveAndPublishArticle({ createToken: "simple_publish_token_01", content: content(), changeSummary: "" });
    const row = f.rows(articles)[0];
    expect(row.id).toBe(result.id);
    expect(row.publishedRevisionId).toBe(row.draftRevisionId);
    expect(row.version).toBe(result.version);
    expect(f.rows(revisions)).toHaveLength(1);
    expect(f.rows(audit).map(r => r.action)).toEqual(["created", "publish"]);
    expect(f.rows(inAppNotifications)).toEqual([]);
    expect((await caller().browse({ view: "published" })).items).toHaveLength(1);
  });
  it.each(["financial", "legal", "policy"] as const)("does not turn quick publication into an independent-review bypass for %s content", async sensitivity => {
    const f = syntheticDb();
    await expect(caller().saveAndPublishArticle({ createToken: "sensitive_quick_publish_01", content: content({ sensitivity }), changeSummary: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.rows(articles)).toEqual([]);
    expect(f.rows(revisions)).toEqual([]);
    expect(f.rows(audit)).toEqual([]);
  });
  it("rolls back a saved-guide quick-publish attempt that downgrades financial classification", async () => {
    const f = syntheticDb(); const saved = await createGuide(content({ sensitivity: "financial" }));
    await expect(caller().saveAndPublishArticle({ id: saved.id, expectedVersion: saved.version, content: content({ sensitivity: "operational" }), changeSummary: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.rows(articles)[0].version).toBe(saved.version);
    expect(f.rows(articles)[0].publishedRevisionId).toBeNull();
    expect(f.rows(revisions)).toHaveLength(1);
    expect(f.rows(revisions)[0].content.sensitivity).toBe("financial");
  });
  it("retains the previous draft when quick publication lacks a body", async () => {
    const f = syntheticDb(); const saved = await createGuide();
    await expect(caller().saveAndPublishArticle({ id: saved.id, expectedVersion: saved.version, content: content({ contentHtml: "" }), changeSummary: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.rows(articles)[0].version).toBe(saved.version);
    expect(f.rows(revisions)).toHaveLength(1);
  });
  it("reconciles an identical new-guide publication retry without duplicating guide, revisions, audit or publication", async () => {
    const f = syntheticDb(); const input = { createToken: "idempotent_quick_publish_01", content: content(), changeSummary: "" };
    const first = await caller().saveAndPublishArticle(input); const second = await caller().saveAndPublishArticle(input);
    expect(second).toEqual(first); expect(f.rows(articles)).toHaveLength(1); expect(f.rows(revisions)).toHaveLength(1); expect(f.rows(audit)).toHaveLength(2);
  });
  it("does not publish different content on a reused creation token", async () => {
    const f = syntheticDb(); const input = { createToken: "reused_quick_publish_token", content: content(), changeSummary: "" };
    await caller().saveArticle(input);
    await expect(caller().saveAndPublishArticle({ ...input, content: content({ title: "Different title" }) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.rows(articles)[0].publishedRevisionId).toBeNull(); expect(f.rows(revisions)).toHaveLength(1);
  });
  it("rejects a stale edit without producing another snapshot or audit", async () => {
    const f = syntheticDb(); const saved = await createGuide(); await edit(saved.id, saved.version);
    const count = f.rows(revisions).length;
    await expect(caller().saveAndPublishArticle({ id: saved.id, expectedVersion: saved.version, content: content(), changeSummary: "" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.rows(revisions)).toHaveLength(count); expect(f.rows(articles)[0].publishedRevisionId).toBeNull();
  });
  it("rejects an unconfirmed zero-row guide update and rolls back the provisional snapshot", async () => {
    const f = syntheticDb(); const saved = await createGuide(); const update = f.db.update.bind(f.db);
    f.db.update = (table: any) => { const q = update(table); const then = q.then.bind(q); q.then = (resolve: any, reject: any) => then(() => resolve([{ affectedRows: 0 }]), reject); return q; };
    await expect(edit(saved.id, saved.version)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.rows(articles)[0].version).toBe(saved.version); expect(f.rows(revisions)).toHaveLength(1);
  });
  it.each(["agent", "instructor", "engagement"])("denies the quick-publish endpoint to %s identities before content is read or written", async role => {
    const f = syntheticDb(); await expect(caller(admin(1, { role })).saveAndPublishArticle({ createToken: "denied_publish_token", content: content(), changeSummary: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.reads).toEqual([]); expect(f.writes).toEqual([]);
  });
});
