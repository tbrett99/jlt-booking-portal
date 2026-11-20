import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  users,
  staffHandbookArticles as articles,
  staffHandbookRevisions as revisions,
  staffKnowledgeRequests as requests,
  staffHandbookAudit as audit,
} from "../drizzle/schema";
import { emptyHandbookContent } from "../shared/staff-handbook";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./storage", () => ({
  storagePutEncrypted: vi.fn(() => {
    throw new Error("Storage must not be used");
  }),
}));
import { handbookLinkOptions } from "./staff-handbook-links";
import { staffHandbookRouter } from "./staff-handbook-router";
import {
  createKnowledgeRequest,
  createGuideFromKnowledgeRequest,
  recoverKnowledgeRequest,
  updateRecoveredKnowledgeRequest,
  updateKnowledgeRequest,
} from "./staff-handbook-requests";
import { actorToken, requestDto } from "./staff-handbook-core";

const dialect = new MySqlDialect();
const PRIVATE = "SYNTHETIC-PRIVATE-BODY-SENTINEL";
const actor = (patch = {}) => ({
  id: 1,
  name: "Synthetic administrator",
  role: "admin",
  isActive: true,
  portalStatus: "active",
  mustChangePassword: false,
  ...patch,
});
const allowed = [users, articles, revisions, requests, audit];

/** Evaluate only locally generated Drizzle predicates; no database/network is used. */
function literalLike(value: string, pattern: string) {
  let source = "^";
  const escape = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\") source += escape(pattern[++i] ?? "\\");
    else if (char === "%") source += ".*";
    else if (char === "_") source += ".";
    else source += escape(char);
  }
  return new RegExp(source + "$", "is").test(value ?? "");
}
function matches(condition: SQL | undefined, row: Record<string, any>) {
  if (!condition) return true;
  const query = dialect.sqlToQuery(condition);
  let parameter = 0;
  let expression = query.sql
    .replace(/\?/g, () => `p[${parameter++}]`)
    .replace(
      /`([^`]+)`\.`([^`]+)`/g,
      (_match, table, column) =>
        `r[${JSON.stringify(table)}][${JSON.stringify(column)}]`
    );
  expression = expression
    .replace(
      /coalesce\((r\["[^"]+"\]\["[^"]+"\]), (r\["[^"]+"\]\["[^"]+"\])\)/g,
      (_match, draft, published) => `(${draft} ?? ${published})`
    )
    .replace(
      /(r\["[^"]+"\]\["[^"]+"\]) like (p\[\d+\])/g,
      (_match, column, value) => `like(${column}, ${value})`
    )
    .replace(
      /(r\["[^"]+"\]\["[^"]+"\]) in \(([^)]+)\)/g,
      (_match, column, list) => `([${list}].includes(${column}))`
    )
    .replace(/ is not null/g, " != null")
    .replace(/ is null/g, " == null")
    .replace(/ = /g, " === ")
    .replace(/ <> /g, " !== ")
    .replace(/ and /g, " && ")
    .replace(/ or /g, " || ");
  return Function(
    "r",
    "p",
    "like",
    `return !!(${expression});`
  )(row, query.params, literalLike);
}
function syntheticDatabase() {
  let state: Record<string, any[]> = Object.fromEntries(
    allowed.map(table => [getTableName(table), []])
  );
  state.users = [actor(), actor({ id: 2 })];
  const reads: any[] = [];
  const writes: any[] = [];
  let readHook: ((table: any) => void) | undefined;
  let beforeTransaction: (() => void) | undefined;
  const name = (table: any) => {
    if (!allowed.includes(table))
      throw new Error("Unrelated table access sentinel");
    return getTableName(table);
  };
  const rows = (table: any) => state[name(table)];
  const columnValue = (row: any, field: any) =>
    row[getTableName(field.table)]?.[field.name];
  const project = (row: any, fields: any, table: any) => {
    if (!fields) return structuredClone(row[name(table)]);
    return Object.fromEntries(
      Object.entries(fields).map(([key, field]: [string, any]) => {
        if (field?.name) return [key, structuredClone(columnValue(row, field))];
        if (key === "state") {
          const guide = row[name(articles)];
          if (dialect.sqlToQuery(field).sql === "'published'")
            return [key, "published"];
          return [
            key,
            (guide.draftRevisionId ?? guide.publishedRevisionId) ===
              guide.publishedRevisionId && guide.publishedRevisionId
              ? "published"
              : guide.submittedAt
                ? "in_review"
                : guide.publishedRevisionId
                  ? "changes"
                  : "draft",
          ];
        }
        throw new Error(`Unexpected synthetic projection ${key}`);
      })
    );
  };
  const db: any = {
    select(fields?: any) {
      let table: any;
      let condition: SQL | undefined;
      let joined: any;
      let joinCondition: SQL | undefined;
      let maximum: number | undefined;
      let offset = 0;
      let locked = false;
      let ordering: any[] = [];
      const chain: any = {
        from(value: any) {
          name(value);
          table = value;
          return chain;
        },
        innerJoin(value: any, join: SQL) {
          name(value);
          joined = value;
          joinCondition = join;
          return chain;
        },
        where(value: SQL) {
          condition = value;
          return chain;
        },
        orderBy(...values: any[]) {
          ordering = values;
          return chain;
        },
        limit(value: number) {
          maximum = value;
          return chain;
        },
        offset(value: number) {
          offset = value;
          return chain;
        },
        for(mode: string) {
          locked = mode === "update";
          return chain;
        },
        then(resolve: any, reject: any) {
          return Promise.resolve()
            .then(() => {
              reads.push({
                table,
                fields,
                maximum,
                offset,
                locked,
                condition: condition ? dialect.sqlToQuery(condition) : null,
                join: joinCondition ? dialect.sqlToQuery(joinCondition) : null,
                ordering: ordering.map(order => dialect.sqlToQuery(order).sql),
              });
              let result = rows(table).map(row => ({ [name(table)]: row }));
              if (joined)
                result = result.flatMap(row =>
                  rows(joined)
                    .map(joinedRow => ({ ...row, [name(joined)]: joinedRow }))
                    .filter(candidate => matches(joinCondition, candidate))
                );
              result = result.filter(row => matches(condition, row));
              readHook?.(table);
              if (fields?.total) return [{ total: result.length }];
              if (ordering.length)
                result.sort((a, b) => {
                  for (const order of ordering) {
                    const sql = dialect.sqlToQuery(order).sql;
                    const match = /`([^`]+)`\.`([^`]+)` (asc|desc)/.exec(sql)!;
                    const av = a[match[1]][match[2]],
                      bv = b[match[1]][match[2]];
                    const comparison =
                      typeof av === "string" ? av.localeCompare(bv) : av - bv;
                    if (comparison)
                      return match[3] === "desc" ? -comparison : comparison;
                  }
                  return 0;
                });
              return result
                .slice(
                  offset,
                  maximum === undefined ? undefined : offset + maximum
                )
                .map(row => project(row, fields, table));
            })
            .then(resolve, reject);
        },
      };
      return chain;
    },
    insert(table: any) {
      name(table);
      let values: any;
      const execute = () =>
        (Array.isArray(values) ? values : [values]).map(value => {
          const id =
            rows(table).reduce((maximum, row) => Math.max(maximum, row.id), 0) +
            1;
          const defaults =
            table === articles
              ? {
                  version: 1,
                  draftRevisionId: null,
                  publishedRevisionId: null,
                  archivedAt: null,
                  submittedAt: null,
                }
              : table === requests
                ? {
                    version: 1,
                    articleId: null,
                    duplicateOfId: null,
                    assigneeId: null,
                    closureReason: null,
                    resolvedAt: null,
                    resolvedRevisionId: null,
                  }
                : {};
          const row = { ...defaults, ...structuredClone(value), id };
          rows(table).push(row);
          writes.push({ table, row: structuredClone(row) });
          return { id };
        });
      const chain: any = {
        values(value: any) {
          values = value;
          return chain;
        },
        $returningId: async () => execute(),
        then: (resolve: any, reject: any) =>
          Promise.resolve().then(execute).then(resolve, reject),
      };
      return chain;
    },
    update(table: any) {
      if (table !== articles && table !== requests)
        throw new Error("Immutable update sentinel");
      let patch: any;
      const chain: any = {
        set(value: any) {
          patch = value;
          return chain;
        },
        where: async (condition: SQL) => {
          const changed = rows(table).filter(row =>
            matches(condition, { [name(table)]: row })
          );
          changed.forEach(row => Object.assign(row, structuredClone(patch)));
          writes.push({
            table,
            patch: structuredClone(patch),
            condition: dialect.sqlToQuery(condition),
          });
          return [{ affectedRows: changed.length }];
        },
      };
      return chain;
    },
    async transaction(work: any) {
      beforeTransaction?.();
      const snapshot = structuredClone(state);
      const writeCount = writes.length;
      try {
        return await work(db);
      } catch (error) {
        state = snapshot;
        writes.splice(writeCount);
        throw error;
      }
    },
  };
  mocks.getDb.mockResolvedValue(db);
  return {
    db,
    rows,
    reads,
    writes,
    onRead(hook: (table: any) => void) {
      readHook = hook;
    },
    beforeTransaction(hook: () => void) {
      beforeTransaction = hook;
    },
  };
}
let fixture: ReturnType<typeof syntheticDatabase>;
beforeEach(() => {
  mocks.getDb.mockReset();
  fixture = syntheticDatabase();
});
function seedGuide(id: number, patch = {}) {
  fixture.rows(articles).push({
    id,
    version: 1,
    createdById: 1,
    draftRevisionId: id * 10,
    publishedRevisionId: null,
    archivedAt: null,
    submittedAt: null,
    ...patch,
  });
  fixture.rows(revisions).push({
    id: id * 10,
    articleId: id,
    revisionNumber: 1,
    title: `Guide ${String(id).padStart(3, "0")}`,
    category: "General",
    content: { ...emptyHandbookContent(1), contentHtml: PRIVATE },
    searchText: PRIVATE,
    summary: PRIVATE,
    resourceIds: [900],
    contributorIds: [1],
  });
}
function seedPublished(id: number) {
  seedGuide(id, { publishedRevisionId: id * 10 });
}
function seedReport(id: number, patch = {}) {
  fixture.rows(requests).push({
    id,
    version: 1,
    title: `Report ${String(id).padStart(3, "0")}`,
    category: "General",
    status: "new",
    articleId: null,
    duplicateOfId: null,
    description: PRIVATE,
    checkedGuidance: PRIVATE,
    impact: PRIVATE,
    ...patch,
  });
}
function caller(user: any = actor()) {
  return staffHandbookRouter.createCaller({
    user,
    req: {} as any,
    res: {} as any,
  });
}
const reportInput = (patch = {}) => ({
  createToken: "synthetic_report_token_001",
  title: "Synthetic report",
  description: "Context not guidance",
  category: "General",
  kind: "unclear" as const,
  checkedGuidance: "Checked current guide",
  impact: "Synthetic impact",
  priority: "normal" as const,
  ...patch,
});
const updateInput = (id: number, patch = {}) => ({
  id,
  expectedVersion: 1,
  status: "triaged" as const,
  priority: "normal" as const,
  assigneeId: null,
  articleId: null,
  duplicateOfId: null,
  closureReason: null,
  ...patch,
});

describe("private handbook link options", () => {
  it("defaults to active draft labels, exposes only four fields, and checks fresh access twice", async () => {
    seedPublished(1);
    fixture.rows(articles)[0].draftRevisionId = 11;
    fixture.rows(revisions).push({
      ...fixture.rows(revisions)[0],
      id: 11,
      title: "Latest draft",
      category: "Draft category",
    });
    const result = await caller().linkOptions({ type: "guides" });
    expect(result).toEqual({
      items: [
        {
          id: 1,
          title: "Latest draft",
          category: "Draft category",
          state: "changes",
        },
      ],
      selected: null,
      total: 1,
      page: 1,
      pageSize: 25,
    });
    expect(fixture.reads.filter(read => read.table === users)).toHaveLength(2);
    const projections = fixture.reads.filter(
      read => read.table === articles && !read.fields.total
    );
    expect(
      projections.every(
        read => Object.keys(read.fields).join() === "id,title,category,state"
      )
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });
  it("active scope falls back to a valid current published revision only when there is no draft pointer", async () => {
    seedPublished(1);
    fixture.rows(articles)[0].draftRevisionId = null;
    const result = await caller().linkOptions({
      type: "guides",
      selectedId: 1,
    });
    expect(result).toMatchObject({
      items: [{ id: 1, title: "Guide 001", state: "published" }],
      selected: { id: 1, state: "published" },
      total: 1,
    });
    fixture.rows(articles)[0].draftRevisionId = 999;
    expect(
      await caller().linkOptions({ type: "guides", selectedId: 1 })
    ).toMatchObject({ items: [], selected: null, total: 0 });
    fixture.rows(articles)[0].draftRevisionId = null;
    fixture.rows(revisions)[0].articleId = 2;
    expect(
      await caller().linkOptions({ type: "guides", selectedId: 1 })
    ).toMatchObject({ items: [], selected: null, total: 0 });
  });
  it("published scope labels both choices and exact selection as published despite a newer draft in review", async () => {
    seedPublished(1);
    fixture.rows(articles)[0].draftRevisionId = 11;
    fixture.rows(articles)[0].submittedAt = new Date();
    fixture.rows(revisions).push({
      ...fixture.rows(revisions)[0],
      id: 11,
      title: "Draft awaiting review",
    });
    const result = await caller().linkOptions({
      type: "guides",
      scope: "published",
      selectedId: 1,
    });
    expect(result).toMatchObject({
      items: [{ id: 1, title: "Guide 001", state: "published" }],
      selected: { id: 1, title: "Guide 001", state: "published" },
    });
    expect(
      await caller().linkOptions({
        type: "guides",
        scope: "active",
        selectedId: 1,
      })
    ).toMatchObject({
      selected: { title: "Draft awaiting review", state: "in_review" },
    });
  });
  it("published scope reads only the current published title/category and omits never-published or archived guides", async () => {
    seedPublished(1);
    fixture.rows(revisions)[0].title = "Current published";
    fixture.rows(articles)[0].draftRevisionId = 11;
    fixture
      .rows(revisions)
      .push({ ...fixture.rows(revisions)[0], id: 11, title: "New draft only" });
    seedGuide(2);
    seedPublished(3);
    fixture.rows(articles)[2].archivedAt = new Date();
    const result = await caller().linkOptions({
      type: "guides",
      scope: "published",
      search: "Current published",
      selectedId: 2,
    });
    expect(result.items.map(item => item.title)).toEqual(["Current published"]);
    expect(result.selected).toBeNull();
    expect(
      (
        await caller().linkOptions({
          type: "guides",
          scope: "published",
          search: "New draft only",
        })
      ).total
    ).toBe(0);
  });
  it.each(["active", "published"] as const)(
    "never resolves archived selected labels in %s scope",
    async scope => {
      seedPublished(1);
      fixture.rows(articles)[0].archivedAt = new Date();
      fixture.rows(revisions)[0].title = "Disallowed archived title";
      const result = await caller().linkOptions({
        type: "guides",
        scope,
        selectedId: 1,
      });
      expect(result).toMatchObject({ items: [], selected: null, total: 0 });
      expect(JSON.stringify(result)).not.toContain("Disallowed archived title");
    }
  );
  it("does not accept a missing pointer or another guide's revision", async () => {
    seedGuide(1, { draftRevisionId: 999 });
    seedGuide(2);
    fixture.rows(articles)[0].draftRevisionId = 20;
    expect(
      await caller().linkOptions({ type: "guides", selectedId: 1 })
    ).toMatchObject({ selected: null, total: 1 });
    expect(fixture.reads.find(read => read.join)?.join.sql).toContain(
      "`staff_handbook_revisions`.`articleId` = `staff_handbook_articles`.`id`"
    );
  });
  it.each(["guides", "reports"] as const)(
    "searches only title/category with escaped SQL LIKE for %s",
    async type => {
      if (type === "guides") {
        seedGuide(1);
        seedGuide(2);
      } else {
        seedReport(1);
        seedReport(2);
      }
      const source = fixture.rows(type === "guides" ? revisions : requests);
      source[0].title = "Literal 50%_\\ match";
      source[1].title = "Literal 50abcX match";
      expect(
        (await caller().linkOptions({ type, search: " 50%_\\ " })).items.map(
          item => item.id
        )
      ).toEqual([1]);
      expect(
        fixture.reads.find(read =>
          read.condition?.params.includes("%50\\%\\_\\\\%")
        )
      ).toBeDefined();
      source[1].category = "Unique category";
      expect(
        (
          await caller().linkOptions({ type, search: "Unique category" })
        ).items.map(item => item.id)
      ).toEqual([2]);
      expect(
        (await caller().linkOptions({ type, search: PRIVATE })).total
      ).toBe(0);
      expect(
        fixture.reads
          .filter(read => read.table !== users)
          .every(
            read =>
              !/description|checkedGuidance|impact|searchText|content|summary/.test(
                read.condition?.sql ?? ""
              )
          )
      ).toBe(true);
    }
  );
  it.each(["guides", "reports"] as const)(
    "bounds and deterministically pages %s with an exact off-page selection",
    async type => {
      for (let id = 1; id <= 28; id++)
        type === "guides" ? seedGuide(id) : seedReport(id);
      const result = await caller().linkOptions({
        type,
        page: 2,
        selectedId: 1,
      });
      expect(result.items.map(item => item.id)).toEqual([26, 27, 28]);
      expect(result).toMatchObject({
        total: 28,
        page: 2,
        pageSize: 25,
        selected: { id: 1 },
      });
      const listRead = fixture.reads.find(read => read.offset === 25);
      expect(listRead.maximum).toBe(25);
      expect(listRead.ordering).toHaveLength(2);
      const selectionRead = fixture.reads.find(
        read => read.maximum === 1 && read.table !== users
      );
      expect(selectionRead.condition.params).toEqual([1]);
      const searched = await caller().linkOptions({
        type,
        search: "028",
        selectedId: 1,
      });
      expect(searched).toMatchObject({
        items: [{ id: 28 }],
        total: 1,
        selected: { id: 1 },
      });
      expect(await caller().linkOptions({ type, page: 100000 })).toMatchObject({
        items: [],
        total: 28,
        page: 100000,
      });
    }
  );
  it("includes closed duplicate reports, but excludes the exact report from both list and selection", async () => {
    seedReport(1);
    seedReport(2, { status: "closed", duplicateOfId: 1 });
    seedReport(3, { status: "resolved" });
    const result = await caller().linkOptions({
      type: "reports",
      scope: "published",
      excludeId: 1,
      selectedId: 1,
    });
    expect(result).toMatchObject({ total: 2, selected: null });
    expect(result.items.map(item => [item.id, item.state])).toEqual([
      [2, "closed"],
      [3, "resolved"],
    ]);
    expect(
      fixture.reads
        .filter(read => read.table === requests && !read.fields.total)
        .every(
          read => Object.keys(read.fields).join() === "id,title,category,state"
        )
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });
  it.each(["guides", "reports"] as const)(
    "returns null for missing/null/excluded %s selections",
    async type => {
      type === "guides" ? seedGuide(1) : seedReport(1);
      for (const selectedId of [null, 999])
        expect(await caller().linkOptions({ type, selectedId })).toMatchObject({
          selected: null,
        });
      expect(
        await caller().linkOptions({ type, selectedId: 1, excludeId: 1 })
      ).toMatchObject({ items: [], selected: null, total: 0 });
    }
  );
  it.each([
    { role: "agent" },
    { role: "staff" },
    { isActive: false },
    { portalStatus: "suspended" },
    { mustChangePassword: true },
  ])(
    "denies ineligible context without reading handbook tables: %j",
    async patch => {
      await expect(
        caller(actor(patch)).linkOptions({ type: "guides" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixture.reads).toHaveLength(0);
    }
  );
  it("denies stale administrator context at the first fresh check", async () => {
    fixture.rows(users)[0].role = "agent";
    await expect(
      handbookLinkOptions(actor(), { type: "reports" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.reads.map(read => read.table)).toEqual([users]);
  });
  it.each(["guides", "reports"] as const)(
    "withholds %s results when access is revoked during the lookup",
    async type => {
      type === "guides" ? seedGuide(1) : seedReport(1);
      fixture.onRead(table => {
        if (table !== users) fixture.rows(users)[0].isActive = false;
      });
      await expect(
        caller().linkOptions({ type, selectedId: 1 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixture.reads.filter(read => read.table === users)).toHaveLength(
        2
      );
    }
  );
  it("keeps SQL errors plain and never echoes selected titles or search text", async () => {
    fixture.onRead(table => {
      if (table === requests) throw new Error(PRIVATE);
    });
    await expect(
      caller().linkOptions({ type: "reports", search: PRIVATE })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The internal handbook operation could not be completed.",
    });
  });
  it.each([
    { type: "other" },
    { type: "guides", scope: "archived" },
    { type: "guides", search: "x".repeat(201) },
    { type: "guides", page: 0 },
    { type: "guides", page: 100001 },
    { type: "guides", page: 1.1 },
    { type: "guides", selectedId: 0 },
    { type: "guides", selectedId: -1 },
    { type: "guides", selectedId: 2147483648 },
    { type: "reports", excludeId: null },
    { type: "reports", excludeId: 0 },
    { type: "reports", excludeId: 1.5 },
  ])("rejects invalid lookup inputs with a safe message: %j", async input => {
    await expect(caller().linkOptions(input as any)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Invalid internal handbook input.",
    });
    expect(fixture.reads).toHaveLength(0);
  });
});

describe("report creation retries and fresh current linking", () => {
  it("accepts equal sanitized plain-text payloads without duplicating a report or audit", async () => {
    const first = await createKnowledgeRequest(actor(), reportInput());
    const retry = await createKnowledgeRequest(
      actor(),
      reportInput({
        title: " <b>Synthetic report</b> ",
        description: "<p>Context not guidance</p>",
        category: " <b>General</b> ",
        checkedGuidance: "<p>Checked current guide</p>",
        impact: "<b>Synthetic impact</b>",
        articleId: null,
      })
    );
    expect(retry).toEqual(first);
    expect(fixture.rows(requests)).toHaveLength(1);
    expect(fixture.rows(audit)).toHaveLength(1);
    expect(
      fixture.reads
        .filter(read => read.table === requests)
        .every(read => read.locked && read.maximum === 1)
    ).toBe(true);
  });
  it.each([
    { title: "Changed title" },
    { description: "Changed description" },
    { category: "Changed category" },
    { kind: "outdated" },
    { checkedGuidance: "Changed checked guidance" },
    { impact: "Changed impact" },
    { priority: "high" },
    { articleId: 99 },
  ])(
    "rejects changed normalized creation-token payload and preserves stored text: %j",
    async patch => {
      await createKnowledgeRequest(actor(), reportInput());
      const before = structuredClone(fixture.rows(requests));
      await expect(
        createKnowledgeRequest(actor(), reportInput(patch) as any)
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message:
          "This report was already submitted with different details. Your changes have not been saved. Check whether your report was saved before trying again.",
      });
      expect(fixture.rows(requests)).toEqual(before);
      expect(fixture.rows(audit)).toHaveLength(1);
    }
  );
  it("uses exact normalized equality, not case-insensitive/subset comparison", async () => {
    await createKnowledgeRequest(actor(), reportInput());
    await expect(
      createKnowledgeRequest(
        actor(),
        reportInput({ title: "synthetic report" })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      createKnowledgeRequest(actor(), reportInput({ description: "Context" }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("binds identical creation tokens to the administrator", async () => {
    await createKnowledgeRequest(actor(), reportInput());
    await createKnowledgeRequest(
      actor({ id: 2 }),
      reportInput({ title: "Other administrator report" })
    );
    expect(fixture.rows(requests)).toHaveLength(2);
    expect(fixture.rows(requests)[0].createToken).not.toBe(
      fixture.rows(requests)[1].createToken
    );
  });
  it("creates an article draft with report description only as summary context, preserving the shared empty default", async () => {
    const report = await createKnowledgeRequest(actor(), reportInput());
    const input = {
      id: report.id,
      expectedVersion: 1,
      createToken: "synthetic_report_guide_001",
    };
    const first = await createGuideFromKnowledgeRequest(actor(), input);
    expect(await createGuideFromKnowledgeRequest(actor(), input)).toEqual(
      first
    );
    expect(fixture.rows(articles)).toHaveLength(1);
    expect(fixture.rows(revisions)).toHaveLength(1);
    expect(fixture.rows(revisions)[0].content).toMatchObject({
      format: "article",
      title: "Synthetic report",
      summary: "Context not guidance",
      contentHtml: "",
      sections: {
        whenToUse: "",
        checks: "",
        steps: "",
        agentWording: "",
        exceptions: "",
        related: "",
      },
    });
    expect(fixture.rows(requests)[0]).toMatchObject({
      status: "drafting",
      articleId: first.articleId,
      resolvedRevisionId: null,
      version: 2,
    });
    expect(emptyHandbookContent(1).format).toBe("process");
  });
  it("resolves to the fresh exact published revision, never the draft or a formerly selected publication", async () => {
    seedPublished(1);
    const report = await createKnowledgeRequest(
      actor(),
      reportInput({ articleId: 1 })
    );
    expect(
      await caller().linkOptions({
        type: "guides",
        scope: "published",
        selectedId: 1,
      })
    ).toMatchObject({ selected: { id: 1 } });
    fixture.rows(revisions).push(
      {
        ...fixture.rows(revisions)[0],
        id: 11,
        revisionNumber: 2,
        title: "New current published",
      },
      {
        ...fixture.rows(revisions)[0],
        id: 12,
        revisionNumber: 3,
        title: "Unpublished draft",
      }
    );
    fixture.rows(articles)[0].publishedRevisionId = 11;
    fixture.rows(articles)[0].draftRevisionId = 12;
    await updateKnowledgeRequest(
      actor(),
      updateInput(report.id, { status: "resolved", articleId: 1 })
    );
    expect(fixture.rows(requests)[0]).toMatchObject({
      articleId: 1,
      resolvedRevisionId: 11,
      status: "resolved",
    });
    expect(
      fixture.reads.find(
        read =>
          read.table === articles &&
          read.locked &&
          read.condition.params[0] === 1
      )
    ).toBeDefined();
    expect(
      fixture.reads.find(
        read =>
          read.table === revisions && read.condition.params.join() === "11,1"
      )
    ).toBeDefined();
  });
  it("rejects a target archived after selection on both create and update, preserving the report", async () => {
    seedPublished(1);
    const report = await createKnowledgeRequest(actor(), reportInput());
    expect(
      await caller().linkOptions({ type: "guides", selectedId: 1 })
    ).toMatchObject({ selected: { id: 1 } });
    fixture.rows(articles)[0].archivedAt = new Date();
    const before = structuredClone(fixture.rows(requests));
    await expect(
      createKnowledgeRequest(
        actor(),
        reportInput({
          createToken: "synthetic_second_report_001",
          articleId: 1,
        })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      updateKnowledgeRequest(
        actor(),
        updateInput(report.id, { status: "resolved", articleId: 1 })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows(requests)).toEqual(before);
  });
  it("keeps stale-version, missing guidance and unpublished resolution checks on writes", async () => {
    seedGuide(1);
    const report = await createKnowledgeRequest(actor(), reportInput());
    await expect(
      updateKnowledgeRequest(
        actor(),
        updateInput(report.id, { expectedVersion: 2, articleId: 1 })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      updateKnowledgeRequest(
        actor(),
        updateInput(report.id, { articleId: 999 })
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateKnowledgeRequest(
        actor(),
        updateInput(report.id, { status: "resolved", articleId: 1 })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows(requests)[0]).toMatchObject({
      version: 1,
      articleId: null,
    });
  });
  it("permits safe closed duplicate targets but still locks exact edges and rejects self/cycles", async () => {
    const report = await createKnowledgeRequest(actor(), reportInput());
    seedReport(2, {
      status: "closed",
      duplicateOfId: null,
      closureReason: "Previously closed",
    });
    await updateKnowledgeRequest(
      actor(),
      updateInput(report.id, {
        status: "closed",
        duplicateOfId: 2,
        closureReason: "Same issue",
      })
    );
    expect(fixture.rows(requests)[0]).toMatchObject({
      duplicateOfId: 2,
      status: "closed",
      version: 2,
    });
    expect(
      fixture.reads.find(
        read =>
          read.table === requests &&
          read.locked &&
          read.condition.params[0] === 2
      )
    ).toBeDefined();
    await expect(
      updateKnowledgeRequest(
        actor(),
        updateInput(report.id, {
          expectedVersion: 2,
          status: "closed",
          duplicateOfId: report.id,
          closureReason: "Self",
        })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    fixture.rows(requests)[1].duplicateOfId = report.id;
    await expect(
      updateKnowledgeRequest(
        actor(),
        updateInput(report.id, {
          expectedVersion: 2,
          status: "closed",
          duplicateOfId: 2,
          closureReason: "Cycle",
        })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows(requests)[0].version).toBe(2);
  });
  it.each([
    {
      patch: { status: "resolved", articleId: 1 },
      message:
        "Choose a published guide to answer this report. A draft cannot answer it yet.",
    },
    {
      patch: { status: "assigned" },
      message: "Choose an active JLT administrator to work on this report.",
    },
    {
      patch: { duplicateOfId: 2 },
      message: "Close this duplicate report and add a reason.",
    },
    {
      patch: { status: "closed" },
      message: "Add a reason for closing this report.",
    },
    {
      patch: { status: "closed", duplicateOfId: 1, closureReason: PRIVATE },
      message:
        "Choose a different report. Duplicate reports cannot link back to this report.",
    },
  ])("uses safe plain report terms: $message", async ({ patch, message }) => {
    seedGuide(1);
    const report = await createKnowledgeRequest(actor(), reportInput());
    seedReport(2, { status: "closed" });
    await expect(
      updateKnowledgeRequest(actor(), updateInput(report.id, patch) as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message });
    expect(message).not.toContain(PRIVATE);
    expect(fixture.rows(requests)[0].version).toBe(1);
  });
  it("checks a revoked write actor inside the locked transaction before saving", async () => {
    fixture.beforeTransaction(() => {
      fixture.rows(users)[0].isActive = false;
    });
    await expect(
      createKnowledgeRequest(actor(), reportInput())
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.rows(requests)).toHaveLength(0);
  });
});

const recoveryConflict =
  "This report has been updated by staff. Open the saved report to add your changes.";
const recoveredInput = (id: number, patch = {}) => ({
  id,
  expectedVersion: 1,
  ...reportInput(),
  ...patch,
});

describe("actor-bound lost report response recovery", () => {
  it("recovers the exact actor token only, returns the full DTO without its stored token, and freshly gates both sides", async () => {
    const saved = await caller().createRequest(reportInput());
    await caller().createRequest(
      reportInput({ createToken: "synthetic_unrelated_report_002" })
    );
    fixture.reads.splice(0);
    const before = structuredClone(fixture.rows(requests));
    const writes = fixture.writes.length;
    const result = await caller().recoverRequest({
      createToken: reportInput().createToken,
    });
    expect(result).toEqual({ request: requestDto(fixture.rows(requests)[0]) });
    expect(result.request).toMatchObject({
      id: saved.id,
      version: 1,
      reporterId: 1,
      status: "new",
      title: reportInput().title,
      description: reportInput().description,
      category: reportInput().category,
      kind: reportInput().kind,
      checkedGuidance: reportInput().checkedGuidance,
      impact: reportInput().impact,
      priority: reportInput().priority,
      articleId: null,
    });
    expect(result.request).not.toHaveProperty("createToken");
    expect(JSON.stringify(result)).not.toContain(reportInput().createToken);
    expect(JSON.stringify(result)).not.toContain(before[0].createToken);
    expect(fixture.reads.map(read => read.table)).toEqual([
      users,
      requests,
      users,
    ]);
    const lookup = fixture.reads[1];
    expect(lookup.maximum).toBe(1);
    expect(lookup.locked).toBe(false);
    expect(lookup.condition.params).toEqual([
      actorToken(1, reportInput().createToken, "request"),
      1,
    ]);
    expect(lookup.condition.sql).toContain("`reporterId`");
    expect(fixture.rows(requests)).toEqual(before);
    expect(fixture.writes).toHaveLength(writes);
  });

  it("returns null for absent tokens and another actor's report, but resolves the same raw token independently for each reporter", async () => {
    const first = await caller().createRequest(reportInput());
    expect(
      await caller().recoverRequest({
        createToken: "synthetic_missing_report_000",
      })
    ).toEqual({ request: null });
    expect(
      await caller(actor({ id: 2 })).recoverRequest({
        createToken: reportInput().createToken,
      })
    ).toEqual({ request: null });
    const second = await caller(actor({ id: 2 })).createRequest(
      reportInput({ title: "Second reporter's saved report" })
    );
    expect(
      await caller(actor({ id: 2 })).recoverRequest({
        createToken: reportInput().createToken,
      })
    ).toMatchObject({
      request: { id: second.id, reporterId: 2 },
    });
    expect(
      await caller().recoverRequest({ createToken: reportInput().createToken })
    ).toMatchObject({ request: { id: first.id, reporterId: 1 } });
  });

  it("requires reporter identity even if a stored token is inconsistent with its reporter", async () => {
    await caller().createRequest(reportInput());
    fixture.rows(requests)[0].reporterId = 2;
    expect(
      await caller().recoverRequest({ createToken: reportInput().createToken })
    ).toEqual({ request: null });
  });

  it.each([
    { role: "agent" },
    { role: "staff" },
    { isActive: false },
    { portalStatus: "suspended" },
    { mustChangePassword: true },
  ])(
    "denies ineligible recovery callers without any reads: %j",
    async patch => {
      await expect(
        caller(actor(patch)).recoverRequest({
          createToken: reportInput().createToken,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixture.reads).toHaveLength(0);
    }
  );

  it("rejects stale recovery access before reading reports", async () => {
    fixture.rows(users)[0].role = "agent";
    await expect(
      recoverKnowledgeRequest(actor(), {
        createToken: reportInput().createToken,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.reads.map(read => read.table)).toEqual([users]);
  });

  it.each([true, false])(
    "withholds recovery results if access is revoked during the lookup, including missing tokens (%s)",
    async exists => {
      if (exists) await caller().createRequest(reportInput());
      fixture.reads.splice(0);
      fixture.onRead(table => {
        if (table === requests) fixture.rows(users)[0].isActive = false;
      });
      await expect(
        caller().recoverRequest({ createToken: reportInput().createToken })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixture.reads.map(read => read.table)).toEqual([
        users,
        requests,
        users,
      ]);
    }
  );

  it("keeps recovery database errors plain without echoing a token or stored report content", async () => {
    fixture.onRead(table => {
      if (table === requests)
        throw new Error(PRIVATE + reportInput().createToken);
    });
    await expect(
      caller().recoverRequest({ createToken: reportInput().createToken })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The internal handbook operation could not be completed.",
    });
  });

  it.each([
    {},
    { createToken: "short" },
    { createToken: "x".repeat(65) },
    { createToken: "invalid token with spaces" },
    { createToken: "synthetic_valid_token_001", id: 1 },
  ])("rejects malformed or ID-bearing recovery inputs: %j", async input => {
    await expect(caller().recoverRequest(input as any)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Invalid internal handbook input.",
    });
    expect(fixture.reads).toHaveLength(0);
  });
});

describe("explicit Save latest edits on a recovered report", () => {
  it("requires explicit saving after changed create conflict, updates all eight sanitized fields, preserves ownership/workflow, and inserts no duplicate", async () => {
    seedGuide(1);
    const saved = await caller().createRequest(reportInput());
    Object.assign(fixture.rows(requests)[0], {
      assigneeId: 2,
      duplicateOfId: null,
      closureReason: null,
      resolvedAt: null,
      resolvedRevisionId: null,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    const edits = reportInput({
      title: " <b>Latest report title</b> ",
      description: "<p>Latest report description</p>",
      category: " <b>Latest category</b> ",
      kind: "outdated" as const,
      checkedGuidance: "<p>Latest checks</p>",
      impact: "<b>Latest impact</b>",
      priority: "high" as const,
      articleId: 1,
    });
    const before = structuredClone(fixture.rows(requests)[0]);
    await expect(caller().createRequest(edits)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const recovered = await caller().recoverRequest({
      createToken: edits.createToken,
    });
    expect(recovered.request).toMatchObject({
      id: saved.id,
      version: 1,
      title: reportInput().title,
    });
    // Neither recovery nor retry automatically saves the user's changed form.
    expect(fixture.rows(requests)[0]).toEqual(before);
    fixture.reads.splice(0);
    const writeStart = fixture.writes.length;
    expect(
      await caller().updateRecoveredRequest({
        ...edits,
        id: recovered.request!.id,
        expectedVersion: recovered.request!.version,
      })
    ).toEqual({ id: saved.id, version: 2 });
    expect(fixture.rows(requests)).toHaveLength(1);
    const after = fixture.rows(requests)[0];
    expect(after).toMatchObject({
      title: "Latest report title",
      description: "Latest report description",
      category: "Latest category",
      kind: "outdated",
      checkedGuidance: "Latest checks",
      impact: "Latest impact",
      priority: "high",
      articleId: 1,
      version: 2,
    });
    for (const key of [
      "id",
      "createToken",
      "reporterId",
      "status",
      "assigneeId",
      "duplicateOfId",
      "closureReason",
      "resolvedAt",
      "resolvedRevisionId",
      "createdAt",
    ])
      expect(after[key]).toEqual(before[key]);
    const writes = fixture.writes.slice(writeStart);
    expect(writes).toHaveLength(2);
    const update = writes.find(write => write.table === requests);
    expect(Object.keys(update.patch).sort()).toEqual(
      [
        "title",
        "description",
        "category",
        "kind",
        "checkedGuidance",
        "impact",
        "priority",
        "articleId",
        "version",
        "updatedAt",
      ].sort()
    );
    expect(update.condition.params).toEqual([saved.id, 1]);
    const lock = fixture.reads.find(read => read.table === requests);
    expect(lock.locked).toBe(true);
    expect(lock.maximum).toBe(1);
    expect(lock.condition.params).toEqual([
      saved.id,
      actorToken(1, edits.createToken, "request"),
      1,
    ]);
    expect(fixture.reads.find(read => read.table === articles)).toMatchObject({
      locked: true,
      maximum: 1,
      condition: { params: [1] },
    });
    expect(fixture.rows(audit)).toHaveLength(2);
    expect(fixture.rows(audit)[1]).toMatchObject({
      entityType: "request",
      entityId: saved.id,
      actorId: 1,
      action: "updated",
      summary: "Latest report edits saved by the reporting administrator.",
      metadata: { articleId: 1 },
    });
    expect(JSON.stringify(fixture.rows(audit)[1])).not.toContain(
      edits.createToken
    );
    expect(JSON.stringify(fixture.rows(audit)[1])).not.toContain(
      edits.description
    );
    const accountReads = fixture.reads.filter(
      read => read.table === users && read.maximum === 1
    );
    expect(accountReads.map(read => read.locked)).toEqual([false, true, true]);
    // Original creation token remains strict after recovery saving too.
    await expect(caller().createRequest(reportInput())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await caller().createRequest(edits)).toEqual({
      id: saved.id,
      version: 2,
    });
    expect(fixture.rows(requests)).toHaveLength(1);
    expect(fixture.rows(audit)).toHaveLength(2);
  });

  it.each([
    "triaged",
    "assigned",
    "drafting",
    "in_review",
    "resolved",
    "closed",
  ])(
    "does not overwrite a progressed %s report even with its current version",
    async status => {
      const saved = await caller().createRequest(reportInput());
      Object.assign(fixture.rows(requests)[0], {
        status,
        version: 3,
        assigneeId: 2,
      });
      const recovered = await caller().recoverRequest({
        createToken: reportInput().createToken,
      });
      expect(recovered.request).toMatchObject({ status, version: 3 });
      const before = structuredClone(fixture.rows(requests));
      const writes = fixture.writes.length;
      await expect(
        caller().updateRecoveredRequest(
          recoveredInput(saved.id, {
            expectedVersion: 3,
            title: "Unsaved edits",
          })
        )
      ).rejects.toMatchObject({ code: "CONFLICT", message: recoveryConflict });
      expect(fixture.rows(requests)).toEqual(before);
      expect(fixture.writes).toHaveLength(writes);
    }
  );

  it("checks current locked version after recovery and refuses staff edits even while status remains new", async () => {
    const saved = await caller().createRequest(reportInput());
    const recovered = await caller().recoverRequest({
      createToken: reportInput().createToken,
    });
    fixture.beforeTransaction(() => {
      Object.assign(fixture.rows(requests)[0], {
        version: 2,
        title: "Staff saved title",
      });
    });
    await expect(
      caller().updateRecoveredRequest(
        recoveredInput(saved.id, {
          expectedVersion: recovered.request!.version,
        })
      )
    ).rejects.toMatchObject({ code: "CONFLICT", message: recoveryConflict });
    expect(fixture.rows(requests)[0]).toMatchObject({
      version: 2,
      status: "new",
      title: "Staff saved title",
    });
    expect(fixture.rows(audit)).toHaveLength(1);
  });

  it.each([
    "other-actor",
    "wrong-token",
    "other-report",
    "absent-report",
    "wrong-reporter",
  ])(
    "uses one non-identifying error for mismatched recovery authorization: %s",
    async mismatch => {
      const saved = await caller().createRequest(reportInput());
      const second = await caller().createRequest(
        reportInput({ createToken: "synthetic_second_recovery_002" })
      );
      Object.assign(fixture.rows(requests)[0], {
        status: "closed",
        version: 8,
      });
      let user = actor();
      let input = recoveredInput(saved.id);
      if (mismatch === "other-actor") user = actor({ id: 2 });
      if (mismatch === "wrong-token")
        input = recoveredInput(saved.id, {
          createToken: "synthetic_wrong_recovery_000",
        });
      if (mismatch === "other-report") input = recoveredInput(second.id);
      if (mismatch === "absent-report") input = recoveredInput(999);
      if (mismatch === "wrong-reporter")
        fixture.rows(requests)[0].reporterId = 2;
      const before = structuredClone(fixture.rows(requests));
      const writes = fixture.writes.length;
      await expect(
        caller(user).updateRecoveredRequest(input)
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Saved report not found.",
      });
      expect(fixture.rows(requests)).toEqual(before);
      expect(fixture.writes).toHaveLength(writes);
    }
  );

  it("allows clearing all optional payload values with no implicit partial merge", async () => {
    seedGuide(1);
    const saved = await caller().createRequest(reportInput({ articleId: 1 }));
    await caller().updateRecoveredRequest(
      recoveredInput(saved.id, {
        checkedGuidance: "",
        impact: "",
        articleId: null,
      })
    );
    expect(fixture.rows(requests)[0]).toMatchObject({
      articleId: null,
      checkedGuidance: "",
      impact: "",
      version: 2,
    });
  });

  it.each(["archived", "absent"])(
    "freshly validates the locked article link after recovery and rolls back %s targets",
    async state => {
      seedGuide(1);
      const saved = await caller().createRequest(reportInput());
      await caller().recoverRequest({ createToken: reportInput().createToken });
      if (state === "archived")
        fixture.beforeTransaction(() => {
          fixture.rows(articles)[0].archivedAt = new Date();
        });
      const before = structuredClone(fixture.rows(requests));
      await expect(
        caller().updateRecoveredRequest(
          recoveredInput(saved.id, {
            articleId: state === "archived" ? 1 : 999,
          })
        )
      ).rejects.toMatchObject({
        code: state === "archived" ? "BAD_REQUEST" : "NOT_FOUND",
      });
      expect(fixture.rows(requests)).toEqual(before);
      expect(fixture.rows(audit)).toHaveLength(1);
      expect(
        fixture.reads.filter(read => read.table === articles).at(-1)
      ).toMatchObject({
        locked: true,
        maximum: 1,
      });
    }
  );

  it.each(["before-first-gate", "before-transaction", "during-write"])(
    "denies revoked save access and preserves the report: %s",
    async phase => {
      const saved = await caller().createRequest(reportInput());
      const before = structuredClone(fixture.rows(requests));
      if (phase === "before-first-gate")
        fixture.rows(users)[0].isActive = false;
      if (phase === "before-transaction")
        fixture.beforeTransaction(() => {
          fixture.rows(users)[0].isActive = false;
        });
      if (phase === "during-write")
        fixture.onRead(table => {
          if (table === requests) fixture.rows(users)[0].isActive = false;
        });
      await expect(
        caller().updateRecoveredRequest(
          recoveredInput(saved.id, { title: "Latest edits" })
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixture.rows(requests)).toEqual(before);
      expect(fixture.rows(audit)).toHaveLength(1);
    }
  );

  it.each([
    { createToken: "short" },
    { createToken: "x".repeat(65) },
    { createToken: "invalid token with spaces" },
    { id: 0 },
    { id: 2147483648 },
    { expectedVersion: 0 },
    { expectedVersion: 1.5 },
    { title: "" },
    { title: "x".repeat(256) },
    { description: " " },
    { description: "x".repeat(20001) },
    { category: " " },
    { category: "x".repeat(121) },
    { kind: "other" },
    { checkedGuidance: "x".repeat(10001) },
    { impact: "x".repeat(10001) },
    { priority: "urgent" },
    { articleId: 0 },
    { articleId: 2147483648 },
    { status: "new" },
    { assigneeId: 2 },
    { reporterId: 2 },
    { title: undefined },
    { checkedGuidance: undefined },
    { impact: undefined },
  ])(
    "applies create-equivalent strict bounded payload validation case %#",
    async patch => {
      await expect(
        caller().updateRecoveredRequest(recoveredInput(1, patch) as any)
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Invalid internal handbook input.",
      });
      expect(fixture.reads).toHaveLength(0);
      expect(fixture.writes).toHaveLength(0);
    }
  );

  it.each([
    { title: "<b></b>" },
    { description: "<p></p>" },
    { category: "<i></i>" },
  ])(
    "rejects required text empty after sanitization without writes: %j",
    async patch => {
      const saved = await caller().createRequest(reportInput());
      const before = structuredClone(fixture.rows(requests));
      await expect(
        updateRecoveredKnowledgeRequest(
          actor(),
          recoveredInput(saved.id, patch)
        )
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fixture.rows(requests)).toEqual(before);
      expect(fixture.rows(audit)).toHaveLength(1);
    }
  );
});
