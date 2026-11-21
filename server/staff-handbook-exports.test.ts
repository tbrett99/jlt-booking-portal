import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, getTableName, inArray, isNull, like, ne, or, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { parse } from "csv-parse/sync";
import { users, staffHandbookArticles as articles, staffHandbookRevisions as revisions, staffKnowledgeRequests as requests,
  staffHandbookImportSources as importSources } from "../drizzle/schema";
import { emptyHandbookContent, KNOWLEDGE_REQUEST_STATUSES, type HandbookContent } from "../shared/staff-handbook";
import { handbookGuideUrl, serializeHandbookCsv } from "../shared/staff-handbook-csv";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { exportHandbookGuides, exportHandbookRequests, HANDBOOK_EXPORT_MAX_BYTES, HANDBOOK_EXPORT_MAX_ROWS,
  type HandbookGuideExportInput, type HandbookRequestExportInput } from "./staff-handbook-exports";
import { likeSearch } from "./staff-handbook-core";
import { OPEN_REQUEST_STATUSES } from "./staff-handbook-policy";

const NOW = new Date("2026-11-21T12:00:00Z");
const admin = (patch = {}) => ({ id: 1, role: "admin", isActive: true, portalStatus: "active", mustChangePassword: false, name: "Synthetic Admin", ...patch });
const dialect = new MySqlDialect();
const allowed = [users, articles, revisions, requests, importSources];
type State = Record<string, any[]>;
type Read = { table: any; fields: any; sql: string; params: unknown[]; limit?: number; order: string[]; joins: string[]; transaction: boolean };
const records = (csv: string): Record<string, string>[] => parse(csv, { bom: true, columns: true });
function sqlLike(value: unknown, pattern: string): boolean {
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\") { const literal = pattern[++i]; source += literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    else if (char === "%") source += "[\\s\\S]*";
    else if (char === "_") source += "[\\s\\S]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return value != null && new RegExp(source + "$", "i").test(String(value));
}
/** Synthetic evaluation of Drizzle-generated predicates, NEVER executed on a DB. */
const predicateCache = new WeakMap<SQL, (env: Record<string, any>) => boolean>();
function matches(condition: SQL | undefined, env: Record<string, any>): boolean {
  if (!condition) return true;
  const cached = predicateCache.get(condition);
  if (cached) return cached(env);
  const q = dialect.sqlToQuery(condition);
  let index = 0;
  let expression = q.sql.replace(/\?/g, () => `p[${index++}]`)
    .replace(/`([^`]+)`\.`([^`]+)`/g, (_m, table, column) => `r["${table}"]["${column}"]`);
  const prop = '(r\\["[^" ]+"\\]\\["[^" ]+"\\])';
  expression = expression
    .replace(new RegExp(prop + " in \\(([^)]+)\\)", "g"), (_m, field, list) => `[${list}].includes(${field})`)
    .replace(new RegExp(prop + " like (p\\[\\d+\\])", "g"), (_m, field, value) => `like(${field},${value})`)
    .replace(/ is not null/g, " != null").replace(/ is null/g, " == null")
    .replace(/ = /g, " === ").replace(/ <> /g, " !== ").replace(/ and /g, " && ").replace(/ or /g, " || ");
  const evaluate = Function("r", "p", "like", `return !!(${expression});`);
  const predicate = (row: Record<string, any>) => evaluate(row, q.params, sqlLike);
  predicateCache.set(condition, predicate);
  return predicate(env);
}
function fixture() {
  const live: State = Object.fromEntries(allowed.map(table => [getTableName(table), []]));
  live.users = [admin(), admin({ id: 2, name: "Owner two", isActive: false }), admin({ id: 3, name: null }), admin({ id: 999, name: "Unrelated private user" })];
  const reads: Read[] = [], transactions: any[] = [], writes: string[] = [];
  let beforeTransaction: (() => void) | undefined, afterCount: (() => void) | undefined, afterTransaction: (() => void) | undefined;
  let countOverride: number | undefined, dropRow = false;
  let aggregateOverride: { rows: any[] } | undefined;
  let corruptRows: ((rows: any[]) => any[]) | undefined;
  const ensure = (table: any) => { if (!allowed.includes(table)) throw new Error("Private/financial/agent/attachment table sentinel"); return getTableName(table); };
  const project = (fields: any, env: any): any => Object.fromEntries(Object.entries(fields).map(([key, field]: [string, any]) => {
    if (field?.table && field?.name) return [key, env[getTableName(field.table)]?.[field.name] ?? null];
    if (field?.queryChunks) throw new Error("Unsupported synthetic projection");
    return [key, project(field, env)];
  }));
  function connection(data: State, transaction: boolean): any {
    const db: any = {
      select(fields: any) {
        if (!fields) throw new Error("Unbounded private projection sentinel");
        let table: any, condition: SQL | undefined, limit: number | undefined;
        const joins: { table: any; condition: SQL }[] = [], ordering: SQL[] = [];
        const chain: any = {
          from(t: any) { ensure(t); table = t; return chain; },
          where(c?: SQL) { condition = c; return chain; },
          innerJoin(t: any, c: SQL) { ensure(t); joins.push({ table: t, condition: c }); return chain; },
          limit(n: number) { limit = n; return chain; },
          orderBy(...order: SQL[]) { ordering.push(...order); return chain; },
          offset() { throw new Error("Paged export sentinel"); },
          for() { throw new Error("SELECT FOR UPDATE sentinel"); },
          then(resolve: any, reject: any) {
            return Promise.resolve().then(() => {
              const q = condition ? dialect.sqlToQuery(condition) : { sql: "", params: [] };
              reads.push({ table, fields, sql: q.sql, params: q.params, limit, transaction, order: ordering.map(o => dialect.sqlToQuery(o).sql), joins: joins.map(j => dialect.sqlToQuery(j.condition).sql) });
              if (ordering.some(order => /^0\s+desc$/i.test(dialect.sqlToQuery(order).sql)))
                throw new Error("MySQL invalid ORDER BY zero ordinal sentinel");
              let envs = data[ensure(table)].map(row => ({ [getTableName(table)]: row }));
              for (const join of joins) {
                const joinSql = dialect.sqlToQuery(join.condition).sql;
                const pointer = joinSql.includes("publishedRevisionId") ? "publishedRevisionId" : "draftRevisionId";
                const indexed = new Map(data[ensure(join.table)].map(row => [row.id, row]));
                envs = envs.flatMap(env => {
                  const revision = indexed.get(env[getTableName(table)][pointer]);
                  if (!revision) return [];
                  const joined = { ...env, [getTableName(join.table)]: revision };
                  return matches(join.condition, joined) ? [joined] : [];
                });
              }
              envs = envs.filter(env => matches(condition, env));
              if (fields.total) {
                const total = countOverride ?? envs.length;
                const payloadBytes = envs.reduce((bytes, env) => {
                  if (table === articles) return bytes + Buffer.byteLength(JSON.stringify(env[getTableName(revisions)].content), "utf8");
                  const row = env[getTableName(requests)];
                  return bytes + Buffer.byteLength(row.title + row.description + row.category, "utf8");
                }, 0);
                const hook = afterCount; afterCount = undefined; hook?.();
                return aggregateOverride?.rows ?? [{ total, payloadBytes }];
              }
              if (ordering.length) envs.sort((a, b) => {
                const aRow = a[getTableName(table)], bRow = b[getTableName(table)];
                if (table === articles && joins.length) {
                  const aRev = a[getTableName(revisions)], bRev = b[getTableName(revisions)];
                  const pin = Number(bRev.content.isPinned) - Number(aRev.content.isPinned); if (pin) return pin;
                  const titleQuery = dialect.sqlToQuery(ordering[1]);
                  if (titleQuery.params.length) {
                    const [exact, pattern] = titleQuery.params;
                    const weight = (r: any) => r.title === exact ? 3 : sqlLike(r.title, String(pattern)) ? 2 : 0;
                    const diff = weight(bRev) - weight(aRev); if (diff) return diff;
                  }
                }
                if (table === requests) { const weights: any = { high: 3, normal: 2, low: 1 }; const diff = weights[bRow.priority] - weights[aRow.priority]; if (diff) return diff; }
                return new Date(bRow.updatedAt ?? NOW).getTime() - new Date(aRow.updatedAt ?? NOW).getTime() || bRow.id - aRow.id;
              });
              if (limit !== undefined) envs = envs.slice(0, limit);
              if (dropRow && transaction && (table === articles || table === requests)) envs = envs.slice(1);
              const projected = envs.map(env => structuredClone(project(fields, env)));
              return corruptRows && transaction && (table === articles || table === requests) ? corruptRows(projected) : projected;
            }).then(resolve, reject);
          },
        };
        return chain;
      },
      insert() { writes.push("insert"); throw new Error("Write sentinel"); },
      update() { writes.push("update"); throw new Error("Write sentinel"); },
      delete() { writes.push("delete"); throw new Error("Write sentinel"); },
      execute() { writes.push("execute"); throw new Error("Raw SQL sentinel"); },
    };
    return db;
  }
  const db = connection(live, false);
  db.transaction = async (work: any, config: any) => {
    transactions.push(config); beforeTransaction?.();
    const value = await work(connection(structuredClone(live), true)); afterTransaction?.(); return value;
  };
  mocks.getDb.mockResolvedValue(db);
  return { db, live, reads, transactions, writes,
    beforeTransaction(fn: () => void) { beforeTransaction = fn; }, afterCount(fn: () => void) { afterCount = fn; },
    afterTransaction(fn: () => void) { afterTransaction = fn; }, count(value: number) { countOverride = value; }, dropRow() { dropRow = true; },
    aggregate(rows: any[]) { aggregateOverride = { rows }; }, corrupt(fn: (rows: any[]) => any[]) { corruptRows = fn; } };
}
function guide(f: ReturnType<typeof fixture>, id = 1, patch: any = {}, draft: Partial<HandbookContent> = {}, published?: Partial<HandbookContent>) {
  const makeContent = (extra: Partial<HandbookContent>) => ({ ...emptyHandbookContent(2), title: `Guide ${id}`, format: "article", contentHtml: "<p>Draft body</p>", ...extra });
  const current = makeContent(draft);
  f.live[getTableName(articles)].push({ id, version: 4, draftRevisionId: id * 10 + 2, publishedRevisionId: published ? id * 10 + 1 : null,
    submittedAt: null, archivedAt: null, createdAt: new Date("2026-01-01T09:00:00Z"), updatedAt: NOW, createToken: "PRIVATE_GUIDE_TOKEN", reviewedById: 777, ...patch });
  const revision = (revisionId: number, revisionNumber: number, c: any) => ({ id: revisionId, articleId: id, revisionNumber,
    title: c.title, category: c.category, content: { ...c, _cycleRequiresReview: true },
    searchText: [c.title, c.summary, c.category, ...c.tags, c.contentHtml, ...Object.values(c.sections)].join("\n"),
    createdAt: NOW, resourceIds: [777], contributorIds: [888], changeSummary: "PRIVATE_CHANGE_HISTORY" });
  f.live[getTableName(revisions)].push(revision(id * 10 + 2, 2, current));
  if (published) f.live[getTableName(revisions)].push(revision(id * 10 + 1, 1, makeContent(published)));
}
function report(f: ReturnType<typeof fixture>, id = 1, patch: any = {}) {
  f.live[getTableName(requests)].push({ id, title: `Report ${id}`, description: "Description", category: "General", priority: "normal", status: "new",
    assigneeId: null, articleId: null, createdAt: new Date("2026-02-01T09:00:00Z"), updatedAt: NOW, resolvedAt: null,
    checkedGuidance: "", impact: "", createToken: "PRIVATE_REQUEST_TOKEN", reporterId: 999, closureReason: "PRIVATE_CLOSURE_REASON", ...patch });
}
const exports = [
  ["guides", (actor: any) => exportHandbookGuides(actor, { view: "all" })],
  ["requests", (actor: any) => exportHandbookRequests(actor, {})],
] as const;
beforeEach(() => vi.clearAllMocks());

describe("shared handbook CSV safety", () => {
  it("uses BOM, all-quoted cells, escaped quotes, CRLF, Unicode and embedded newlines", () => {
    const csv = serializeHandbookCsv(["id", "text", "empty"], [[1, 'Été, 東京 "quoted"\r\nnext', null], [2, "line\nnext", undefined]]);
    expect(csv).toBe('\uFEFF"id","text","empty"\r\n"1","Été, 東京 ""quoted""\r\nnext",""\r\n"2","line\nnext",""\r\n');
    expect(records(csv)[0].text).toBe('Été, 東京 "quoted"\r\nnext');
  });
  it.each(["=SUM(1,2)", "+cmd", "-1", "@SUM(A1)", " \t=evil", "\r\n+evil", "\x00\x1f-evil", "\u00a0\u2003@evil", "\x7f\x85=evil"])("neutralises formula prefix %j without discarding original text", value => {
    expect(records(serializeHandbookCsv(["cell"], [[value]]))[0].cell).toBe(`'${value}`);
  });
  it("protects headers too and leaves safe text unchanged", () => {
    expect(serializeHandbookCsv([" =header"], [["a=1"], [false], [0]])).toContain('"\' =header"');
    expect(records(serializeHandbookCsv(["cell"], [["a=1"], [false], [0]])).map(r => r.cell)).toEqual(["a=1", "false", "0"]);
  });
  it("builds only stable numeric relative canonical guide URLs", () => {
    expect(handbookGuideUrl(17)).toBe("/admin/staff-handbook?tab=handbook&article=17");
    for (const id of [0, -1, 1.5, NaN, Infinity, 2147483648]) expect(() => handbookGuideUrl(id)).toThrow();
  });
});

describe.each(exports)("actual %s export authorization and read-only boundary", (_name, run) => {
  it.each(["agent", "business_staff", "instructor", "agent_engagement", "staff", "Admin", "superadmin"])("denies role %s before DB access", async role => {
    fixture(); await expect(run(admin({ role }))).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each([{ isActive: false }, { portalStatus: "suspended" }, { mustChangePassword: true }, { mustChangePassword: undefined }, { id: 0 }])("denies ineligible session %j before reads", async patch => {
    fixture(); await expect(run(admin(patch))).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("accepts exact super_admin and reads fresh account before and after read-only transaction", async () => {
    const f = fixture(); f.live.users[0].role = "super_admin";
    const out = await run(admin({ role: "super_admin" }));
    expect(out.rowCount).toBe(0); expect(records(out.csv)).toEqual([]); expect(out.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(f.transactions).toEqual([{ isolationLevel: "repeatable read" }]);
    expect(f.reads[0]).toMatchObject({ table: users, transaction: false, params: [1] });
    expect(f.reads.at(-1)).toMatchObject({ table: users, transaction: false, params: [1] });
    expect(f.reads.filter(r => r.transaction && r.table === users)).toEqual([]); expect(f.writes).toEqual([]);
  });
  it("fresh precheck denies revoked session without touching content", async () => {
    const f = fixture(); f.live.users[0].isActive = false;
    await expect(run(admin())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.reads.map(r => r.table)).toEqual([users]); expect(f.transactions).toEqual([]);
  });
  it("fresh postcheck blocks CSV after account revoked during snapshot", async () => {
    const f = fixture(); guide(f); report(f);
    f.afterCount(() => { f.live.users[0].portalStatus = "suspended"; });
    await expect(run(admin())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.reads.at(-1)).toMatchObject({ table: users, transaction: false }); expect(f.writes).toEqual([]);
  });
  it("rejects row cap before loading rows or names; never silently truncates", async () => {
    const f = fixture(); f.count(HANDBOOK_EXPORT_MAX_ROWS + 1);
    await expect(run(admin())).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Narrow the filters") });
    expect(f.reads.filter(r => r.transaction)).toHaveLength(1); expect(f.writes).toEqual([]);
  });
  it.each([[], [{}], [{ total: null, payloadBytes: 0 }], [{ total: undefined, payloadBytes: 0 }], [{ total: -1, payloadBytes: 0 }], [{ total: 1.5, payloadBytes: 0 }]].map(rows => ({ rows })))("missing or invalid counts $rows fail closed before rows", async ({ rows }) => {
    const f = fixture(); f.aggregate(rows);
    await expect(run(admin())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: expect.stringContaining("count could not be verified") });
    expect(f.reads.filter(r => r.transaction)).toHaveLength(1);
  });
  it.each([undefined, null, -1, 1.5, NaN])("invalid payload byte count %j fails closed before payload load", async payloadBytes => {
    const f = fixture(); f.aggregate([{ total: 0, payloadBytes }]);
    await expect(run(admin())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: expect.stringContaining("size could not be verified") });
    expect(f.reads.filter(r => r.transaction)).toHaveLength(1);
  });
  it("oversized stored payload fails before selecting bodies/names, using portable octet_length", async () => {
    const f = fixture(); f.aggregate([{ total: 1, payloadBytes: HANDBOOK_EXPORT_MAX_BYTES + 1 }]);
    await expect(run(admin())).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Narrow the filters") });
    const reads = f.reads.filter(r => r.transaction); expect(reads).toHaveLength(1);
    expect(dialect.sqlToQuery(reads[0].fields.payloadBytes).sql).toContain("octet_length("); expect(f.writes).toEqual([]);
  });
  it("row IDs outside signed MySQL INT fail closed before context lookups", async () => {
    const f = fixture(); guide(f); report(f);
    f.corrupt(rows => rows.map(row => row.article ? { ...row, article: { ...row.article, id: 2147483648 } } : { ...row, id: 2147483648 }));
    await expect(run(admin())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: expect.stringContaining("No partial export") });
    expect(f.reads.filter(r => r.transaction && r.table === users)).toEqual([]);
  });
  it("rejects incoherent count/row sets instead of returning partial data", async () => {
    const f = fixture(); guide(f); report(f); f.dropRow();
    await expect(run(admin())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: expect.stringContaining("No partial export") });
  });
  it("sanitises DB errors without leaking SQL, tokens, body or cause", async () => {
    mocks.getDb.mockRejectedValue(new Error("SELECT privateSecretToken FROM agent_secret"));
    await expect(run(admin())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "The internal handbook operation could not be completed.", cause: undefined });
  });
  it("does not fall back outside the snapshot when its transaction fails", async () => {
    const f = fixture(); f.db.transaction = vi.fn().mockRejectedValue(new Error("Snapshot transaction unavailable private SQL"));
    await expect(run(admin())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); expect(f.db.transaction).toHaveBeenCalledTimes(1); expect(f.writes).toEqual([]);
  });
});

describe("actual guide export snapshots, filters and privacy", () => {
  describe.each(["all", "published", "drafts", "archived"] as const)("MySQL-safe %s export", view => {
    it.each([undefined, "", "   ", "\t\n"])("omits zero ordinal with blank search %j and retains bounded snapshot ordering", async search => {
      const f = fixture();
      guide(f, 1, { archivedAt: view === "archived" ? NOW : null }, { isPinned: true }, { title: "Published snapshot", isPinned: true });
      guide(f, 2, { archivedAt: view === "archived" ? NOW : null }, {}, { title: "Second published snapshot" });
      const out = await exportHandbookGuides(admin(), { view, search });
      expect(records(out.csv).map(row => row.guide_id)).toEqual(["1", "2"]);
      const query = f.reads.find(r => r.transaction && r.table === articles && !r.fields.total)!;
      expect(query.order).toEqual([
        "JSON_EXTRACT(`staff_handbook_revisions`.`content`, '$.isPinned') = true desc",
        "`staff_handbook_articles`.`updatedAt` desc",
        "`staff_handbook_articles`.`id` desc",
      ]);
      expect(query.sql).not.toContain("searchText");
      expect(query.limit).toBe(2001);
      expect(f.transactions).toEqual([{ isolationLevel: "repeatable read" }]);
      expect(f.reads.at(-1)).toMatchObject({ table: users, transaction: false });
      expect(f.writes).toEqual([]);
    });
  });
  it("exports selected published body/metadata despite a changed draft, with reference and dates", async () => {
    const f = fixture(); guide(f, 1, {}, { title: "Draft title", category: "General", contentHtml: "<p>Draft-only secret</p>", ownerId: 3 },
      { title: 'Publié "guide" 東京', category: "Academy", summary: "Published summary", tags: ["one", "two"], contentHtml: "<h2>Published body</h2>", reviewedAt: new Date("2026-10-01T00:00:00Z"), nextReviewAt: new Date("2027-01-01T00:00:00Z") });
    f.live[getTableName(importSources)].push({ articleId: 1, externalReference: "JLT-OPS-001", payloadHash: "PRIVATE_PAYLOAD_HASH", importedById: 999 });
    const out = await exportHandbookGuides(admin(), { view: "published" }); const row = records(out.csv)[0];
    expect(out).toMatchObject({ rowCount: 1, snapshot: "Published" });
    expect(row).toMatchObject({ guide_id: "1", guide_url: handbookGuideUrl(1), version: "4", revision_id: "11", revision_number: "1", snapshot: "Published", state: "changes", external_reference: "JLT-OPS-001",
      title: 'Publié "guide" 東京', category: "Academy", summary: "Published summary", tags: "one|two", owner_id: "2", owner_name: "Owner two", content: "<h2>Published body</h2>",
      created_at: "2026-01-01T09:00:00.000Z", updated_at: NOW.toISOString(), revision_created_at: NOW.toISOString(), last_reviewed_at: "2026-10-01T00:00:00.000Z", next_review_at: "2027-01-01T00:00:00.000Z" });
    expect(out.csv).not.toMatch(/Draft-only|Draft title|PRIVATE_|cycleRequiresReview|resourceIds|contributorIds|reviewedById|createToken/);
    const nameQuery = f.reads.find(r => r.table === users && r.transaction)!;
    expect(Object.keys(nameQuery.fields)).toEqual(["id", "name"]); expect(nameQuery.params).toEqual([2]);
    const refQuery = f.reads.find(r => r.table === importSources)!;
    expect(Object.keys(refQuery.fields)).toEqual(["articleId", "externalReference"]); expect(refQuery.params).toEqual([1]);
  });
  it.each(["all", "drafts", "archived"] as const)("uses working draft in %s view including process fields and missing owner fallback", async view => {
    const f = fixture(); guide(f, 1, { archivedAt: view === "archived" ? NOW : null }, { title: "Draft process", ownerId: 404, format: "process", contentHtml: "",
      sections: { whenToUse: "<p>When</p>", checks: "<p>Checks</p>", steps: "<ol><li>Step</li></ol>", agentWording: "<p>Reply</p>", exceptions: "<p>Help</p>", related: "<p>Related</p>" } }, { title: "Published old" });
    const out = await exportHandbookGuides(admin(), { view });
    expect(out.snapshot).toBe("Working draft"); expect(records(out.csv)[0]).toMatchObject({ title: "Draft process", revision_id: "12", external_reference: "", owner_name: "Staff #404 (name unavailable)", editor_format: "process",
      when_to_use: "<p>When</p>", checks_before_starting: "<p>Checks</p>", steps: "<ol><li>Step</li></ol>", suggested_reply: "<p>Reply</p>", when_to_ask_for_help: "<p>Help</p>", related_guidance: "<p>Related</p>" });
  });
  it("draft and published views match exact pointer, archive and unchanged-draft semantics", async () => {
    const f = fixture(); guide(f, 1); guide(f, 2, {}, {}, {}); guide(f, 3, { draftRevisionId: 31 }, {}, {}); guide(f, 4, { archivedAt: NOW }, {}, {});
    const ids = async (view: HandbookGuideExportInput["view"]) => records((await exportHandbookGuides(admin(), { view })).csv).map(r => r.guide_id);
    expect(await ids("all")).toEqual(["3", "2", "1"]); expect(await ids("drafts")).toEqual(["2", "1"]);
    expect(await ids("published")).toEqual(["3", "2"]); expect(await ids("archived")).toEqual(["4"]);
  });
  it("exports every matching row beyond 25 with exact escaped search/category SQL, body/section matching and ranking", async () => {
    const f = fixture();
    for (let id = 1; id <= 31; id++) guide(f, id, {}, { category: "Academy", title: id === 2 ? "50%_\\value" : `Guide ${id}`, contentHtml: "<p>50%_\\value</p>", isPinned: id === 1 });
    guide(f, 40, {}, { category: "General", contentHtml: "<p>50%_\\value</p>" }); guide(f, 41, {}, { category: "Academy", contentHtml: "<p>50anything-value</p>" });
    const out = await exportHandbookGuides(admin(), { view: "all", category: "Academy", search: " 50%_\\value " });
    expect(out.rowCount).toBe(31); expect(records(out.csv).slice(0, 3).map(r => r.guide_id)).toEqual(["1", "2", "31"]);
    const query = f.reads.find(r => r.transaction && r.table === articles && !r.fields.total)!;
    const expected = dialect.sqlToQuery(and(isNull(articles.archivedAt), eq(revisions.category, "Academy"), like(revisions.searchText, likeSearch("50%_\\value")))!);
    expect({ sql: query.sql, params: query.params }).toEqual({ sql: expected.sql, params: expected.params }); expect(query.limit).toBe(2001); expect(query.order).toHaveLength(4);
    expect(f.reads.filter(r => r.table === articles && r.fields.total)[0].sql).toBe(query.sql);
  });
  it("searches published snapshot only in Published, otherwise draft, with section/category/tag search", async () => {
    const f = fixture(); guide(f, 1, {}, { tags: ["draft needle"], sections: { ...emptyHandbookContent(2).sections, exceptions: "<p>section needle</p>" } }, { summary: "published needle" });
    expect((await exportHandbookGuides(admin(), { view: "published", search: "draft needle" })).rowCount).toBe(0);
    expect((await exportHandbookGuides(admin(), { view: "all", search: "published needle" })).rowCount).toBe(0);
    for (const search of ["draft needle", "section needle", "General"]) expect((await exportHandbookGuides(admin(), { view: "all", search })).rowCount).toBe(1);
  });
  it("retains one coherent count/rows/reference/name snapshot if live data changes after count", async () => {
    const f = fixture(); guide(f); f.live[getTableName(importSources)].push({ articleId: 1, externalReference: "BEFORE" });
    f.afterCount(() => { guide(f, 2); f.live.users[1].name = "Changed live name"; f.live[getTableName(importSources)][0].externalReference = "AFTER"; f.live[getTableName(revisions)][0].content.title = "Changed live title"; });
    const out = await exportHandbookGuides(admin(), { view: "all" }); expect(out.rowCount).toBe(1);
    expect(records(out.csv)[0]).toMatchObject({ title: "Guide 1", owner_name: "Owner two", external_reference: "BEFORE" });
  });
  it.each(["all", "published"] as const)("rejects cross-guide revision, wrong exact %s pointer and invalid revision ID", async view => {
    for (const patch of [{ articleId: 999 }, { id: view === "published" ? 12 : 11 }, { id: 2147483648 }]) {
      const f = fixture(); guide(f, 1, {}, {}, {});
      f.corrupt(rows => rows.map(row => ({ ...row, revision: { ...row.revision, ...patch } })));
      await expect(exportHandbookGuides(admin(), { view })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: expect.stringContaining("No partial export") });
      expect(f.reads.filter(r => r.transaction && r.table === users)).toEqual([]);
    }
  });
  it("allows exactly 2,000 rows without page truncation", async () => {
    const f = fixture(); for (let id = 1; id <= HANDBOOK_EXPORT_MAX_ROWS; id++) guide(f, id);
    const out = await exportHandbookGuides(admin(), { view: "all" }); expect(out.rowCount).toBe(2000); expect(records(out.csv)).toHaveLength(2000);
  });
  it("fails whole guide export above UTF-8 byte cap", async () => {
    const f = fixture(); const body = `<p>${"é".repeat(100000)}</p>`;
    for (let id = 1; id <= 53; id++) guide(f, id, {}, { contentHtml: body });
    await expect(exportHandbookGuides(admin(), { view: "all" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Narrow the filters") }); expect(f.writes).toEqual([]);
  });
});

describe("actual missing-guidance export workflow, filters, bounds and privacy", () => {
  it("uses submitted createdAt and current answered/closed resolvedAt, not updatedAt or invented first-answer time", async () => {
    const f = fixture(); guide(f, 1); guide(f, 2, {}, {}, {}); guide(f, 3, { archivedAt: NOW }, {}, {});
    report(f, 1, { articleId: 1, assigneeId: 3, status: "drafting" });
    report(f, 2, { articleId: 2, assigneeId: 2, status: "resolved", resolvedAt: new Date("2026-11-20T10:00:00Z") });
    report(f, 3, { articleId: 3, status: "closed", resolvedAt: new Date("2026-11-21T11:00:00Z") });
    report(f, 4, { articleId: 404, assigneeId: 404 }); report(f, 5);
    const out = await exportHandbookRequests(admin(), {}); const rows = records(out.csv); const row = (id: string) => rows.find(r => r.request_id === id)!;
    expect(row("1")).toMatchObject({ submitted_at: "2026-02-01T09:00:00.000Z", answered_or_closed_at: "", linked_guide_snapshot: "Working draft", linked_guide_state: "draft", assignee_name: "Staff #3 (name unavailable)", status_label: "Guide being written" });
    expect(row("2")).toMatchObject({ article_id: "2", article_url: handbookGuideUrl(2), linked_guide_snapshot: "Published", assignee_name: "Owner two", status: "resolved", status_label: "Answered", answered_or_closed_at: "2026-11-20T10:00:00.000Z" });
    expect(row("3")).toMatchObject({ status_label: "Closed", answered_or_closed_at: "2026-11-21T11:00:00.000Z", linked_guide_state: "archived" });
    expect(row("4")).toMatchObject({ linked_guide_snapshot: "Unavailable", assignee_name: "Staff #404 (name unavailable)" });
    expect(row("5")).toMatchObject({ assignee_id: "", assignee_name: "Unassigned", article_id: "", article_url: "", linked_guide_snapshot: "" });
    expect(out.csv).not.toMatch(/PRIVATE_|reporterId|closureReason|createToken|first_answer/);
    const names = f.reads.find(r => r.transaction && r.table === users)!; expect(names.params).toEqual([404, 2, 3]); expect(Object.keys(names.fields)).toEqual(["id", "name"]);
    expect(f.reads.find(r => r.transaction && r.table === articles)!.params).toEqual([404, 3, 2, 1]);
    expect(f.reads.some(r => r.table === revisions || r.table === importSources)).toBe(false);
  });
  it("open/category/unassigned predicates match browse, search includes checked guidance and impact, all matching beyond 25", async () => {
    const f = fixture(); for (let id = 1; id <= 29; id++) report(f, id, { status: id % 2 ? "triaged" : "in_review", category: "Academy", checkedGuidance: id % 2 ? "needle%_" : "", impact: id % 2 ? "" : "needle%_" });
    report(f, 40, { status: "closed", category: "Academy", impact: "needle%_" }); report(f, 41, { category: "Academy", assigneeId: 2, impact: "needle%_" }); report(f, 42, { impact: "needle%_" });
    const out = await exportHandbookRequests(admin(), { status: "open", category: "Academy", assigneeId: null, search: " needle%_ " }); expect(out.rowCount).toBe(29);
    const query = f.reads.find(r => r.transaction && r.table === requests && !r.fields.total)!;
    const needle = likeSearch("needle%_");
    const expected = dialect.sqlToQuery(and(inArray(requests.status, [...OPEN_REQUEST_STATUSES]), isNull(requests.assigneeId), eq(requests.category, "Academy"),
      or(like(requests.title, needle), like(requests.description, needle), like(requests.checkedGuidance, needle), like(requests.impact, needle)))!);
    expect({ sql: query.sql, params: query.params }).toEqual({ sql: expected.sql, params: expected.params }); expect(query.limit).toBe(2001); expect(query.order).toHaveLength(3);
    expect(f.reads.filter(r => r.transaction && r.table === users)).toEqual([]);
  });
  it.each(KNOWLEDGE_REQUEST_STATUSES)("matches exact status %s plus specific assignee, not another workflow state", async status => {
    const f = fixture(); KNOWLEDGE_REQUEST_STATUSES.forEach((s, i) => report(f, i + 1, { status: s, assigneeId: 2 })); report(f, 40, { status, assigneeId: 3 });
    const out = await exportHandbookRequests(admin(), { status, assigneeId: 2 }); expect(out.rowCount).toBe(1); expect(records(out.csv)[0].status).toBe(status);
  });
  it("omitted or all status and whitespace-only search impose no hidden open filter", async () => {
    const f = fixture(); KNOWLEDGE_REQUEST_STATUSES.forEach((status, i) => report(f, i + 1, { status }));
    expect((await exportHandbookRequests(admin(), {})).rowCount).toBe(7);
    expect((await exportHandbookRequests(admin(), { status: "all", search: " \t " })).rowCount).toBe(7);
  });
  it("search matches title and description, not category-only", async () => {
    const f = fixture(); report(f, 1, { title: "needle" }); report(f, 2, { description: "needle" }); report(f, 3, { category: "needle" });
    expect(records((await exportHandbookRequests(admin(), { search: "needle" })).csv).map(r => r.request_id)).toEqual(["2", "1"]);
  });
  it("keeps report urgency ordering and neutralises formulas in actual exported plain metadata", async () => {
    const f = fixture(); report(f, 1, { title: "\t=HYPERLINK(1)", priority: "high", description: '+cmd "quoted" 東京', category: "@category", assigneeId: 2 }); f.live.users[1].name = " -name";
    report(f, 2, { priority: "low" }); report(f, 3, { priority: "normal" });
    const rows = records((await exportHandbookRequests(admin(), {})).csv); expect(rows.map(r => r.request_id)).toEqual(["1", "3", "2"]);
    expect(rows[0]).toMatchObject({ title: "'\t=HYPERLINK(1)", description: '\'+cmd "quoted" 東京', category: "'@category", assignee_name: "'-name", urgency: "high" });
  });
  it("returns coherent report, linked guide and name snapshots after live mutations", async () => {
    const f = fixture(); guide(f); report(f, 1, { articleId: 1, assigneeId: 2 });
    f.afterCount(() => { report(f, 2); f.live[getTableName(articles)][0].publishedRevisionId = 12; f.live.users[1].name = "Changed"; f.live[getTableName(requests)][0].resolvedAt = NOW; });
    const out = await exportHandbookRequests(admin(), {}); expect(out.rowCount).toBe(1); expect(records(out.csv)[0]).toMatchObject({ linked_guide_snapshot: "Working draft", assignee_name: "Owner two", answered_or_closed_at: "" });
  });
  it("allows exactly row cap and rejects one additional matching report", async () => {
    const f = fixture(); for (let id = 1; id <= HANDBOOK_EXPORT_MAX_ROWS; id++) report(f, id);
    expect((await exportHandbookRequests(admin(), {})).rowCount).toBe(2000); report(f, 2001);
    await expect(exportHandbookRequests(admin(), {})).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("includes BOM/headers/escaping in exact UTF-8 byte cap; cap succeeds and cap+1 fails whole", async () => {
    const f = fixture(); report(f); const base = await exportHandbookRequests(admin(), {});
    const extra = HANDBOOK_EXPORT_MAX_BYTES - Buffer.byteLength(base.csv, "utf8");
    f.live[getTableName(requests)][0].description += "x".repeat(extra);
    const exact = await exportHandbookRequests(admin(), {}); expect(Buffer.byteLength(exact.csv, "utf8")).toBe(HANDBOOK_EXPORT_MAX_BYTES);
    f.live[getTableName(requests)][0].description += "x";
    await expect(exportHandbookRequests(admin(), {})).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Narrow the filters") }); expect(f.writes).toEqual([]);
  });
  it("exports never read private attachments, audit, comments, agent/financial tables or sensitive projections", async () => {
    const f = fixture(); guide(f); report(f, 1, { assigneeId: 2, articleId: 1 });
    await exportHandbookGuides(admin(), { view: "all" }); await exportHandbookRequests(admin(), {});
    expect(f.writes).toEqual([]);
    const leafKeys = (fields: any): string[] => Object.entries(fields).flatMap(([key, value]: [string, any]) => value?.table || value?.queryChunks ? [key] : leafKeys(value));
    for (const read of f.reads) {
      expect(allowed).toContain(read.table);
      expect(leafKeys(read.fields).join(" ")).not.toMatch(/token|hash|key|email|phone|resourceIds|contributorIds|reviewedBy|reviewedRevision|reporterId|closureReason/i);
      if (read.transaction && read.table === users) expect(Object.keys(read.fields)).toEqual(["id", "name"]);
    }
  });
});
