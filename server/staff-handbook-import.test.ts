import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { users, staffHandbookArticles as articles, staffHandbookRevisions as revisions, staffHandbookImportSources as sources, staffHandbookAudit as audit, staffKnowledgeRequests as requests, staffHandbookResources as resources, inAppNotifications } from "../drizzle/schema";
import { HANDBOOK_IMPORT_COLUMNS, HANDBOOK_IMPORT_MAX_BYTES, handbookImportTemplate } from "../shared/staff-handbook-import";
import { STAFF_HANDBOOK_CATEGORIES } from "../shared/staff-handbook";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./storage", () => ({ storagePutEncrypted: () => { throw new Error("storage sentinel"); }, storageGetEncrypted: () => { throw new Error("storage sentinel"); } }));
import { parseHandbookImport, previewHandbookImport, commitHandbookImport } from "./staff-handbook-import";
import { handbookArticleAction, saveHandbookArticle } from "./staff-handbook-articles";
import { staffHandbookRouter } from "./staff-handbook-router";
const admin = (id = 1, patch = {}) => ({ id, name: `Synthetic admin ${id}`, role: "admin", isActive: true, portalStatus: "active", mustChangePassword: false, ...patch });
const dialect = new MySqlDialect();
function matches(condition: SQL | undefined, row: any) {
  if (!condition) return true;
  const query = dialect.sqlToQuery(condition); let i = 0;
  let expression = query.sql.replace(/\?/g, () => `p[${i++}]`).replace(/`[^`]+`\.`([^`]+)`/g, (_m, name) => `r[${JSON.stringify(name)}]`);
  expression = expression.replace(/(r\["[^"]+"\]) in \(([^)]+)\)/g, (_m, prop, list) => `([${list}].includes(${prop}))`).replace(/ is not null/g, " != null").replace(/ is null/g, " == null").replace(/ = /g, " === ").replace(/ <> /g, " !== ").replace(/ and /g, " && ").replace(/ or /g, " || ");
  return Function("r", "p", `return !!(${expression});`)(row, query.params);
}
function fixture() {
  const allowed = [users, articles, revisions, sources, audit, requests, resources, inAppNotifications];
  let state: Record<string, any[]> = Object.fromEntries(allowed.map(table => [getTableName(table), []]));
  state.users = [admin(), admin(2), admin(3)];
  const reads: any[] = []; let failure: { table: any; ref?: string } | null = null;
  let corruptRead = false; let revokeAfterTransactions = 0; let transactionCount = 0; let tail = Promise.resolve();
  const rows = (table: any) => { if (!allowed.includes(table)) throw new Error("private table sentinel"); return state[getTableName(table)]; };
  const db: any = {
    select(fields?: any) {
      let table: any, condition: SQL | undefined, maximum = 1000, locked = false, ordering: any[] = [];
      const chain: any = {
        from(t: any) { table = t; rows(t); return chain; }, where(c: SQL) { condition = c; return chain; }, limit(n: number) { maximum = n; return chain; }, orderBy(...o: any[]) { ordering = o; return chain; }, for() { locked = true; return chain; },
        then(resolve: any, reject: any) { return Promise.resolve().then(() => {
          reads.push({ table, locked, sql: condition ? dialect.sqlToQuery(condition).sql : "" });
          let result = rows(table).filter(row => matches(condition, row));
          if (ordering.length) result = [...result].sort((a, b) => table === users ? a.id - b.id : (b.revisionNumber ?? b.id) - (a.revisionNumber ?? a.id));
          result = result.slice(0, maximum);
          if (corruptRead && table === sources && result.length) result = result.map(row => ({ ...row, payloadHash: "bad" }));
          return result.map(row => fields ? Object.fromEntries(Object.entries(fields).map(([key, col]: [string, any]) => [key, structuredClone(row[col.name])])) : structuredClone(row));
        }).then(resolve, reject); },
      }; return chain;
    },
    insert(table: any) {
      rows(table); let value: any;
      const run = () => {
        if (failure?.table === table && (!failure.ref || value.externalReference === failure.ref)) throw new Error("RAW DATABASE SECRET");
        if (table === sources && rows(sources).some(row => row.externalReference === value.externalReference || row.articleId === value.articleId)) throw new Error("unique key sentinel");
        const id = Math.max(0, ...rows(table).map(row => row.id ?? 0)) + 1;
        const defaults = table === articles ? { version: 1, draftRevisionId: null, publishedRevisionId: null, reviewedRevisionId: null, reviewedById: null, submittedAt: null, archivedAt: null } : {};
        rows(table).push({ ...defaults, id, createdAt: new Date("2026-11-21T00:00:00Z"), updatedAt: new Date("2026-11-21T00:00:00Z"), ...structuredClone(value) });
        return [{ id }];
      };
      const chain: any = { values(v: any) { value = v; return chain; }, async $returningId() { return run(); }, then(resolve: any, reject: any) { return Promise.resolve().then(run).then(resolve, reject); } }; return chain;
    },
    update(table: any) {
      rows(table); if (table === revisions || table === audit || table === sources) throw new Error("immutable update sentinel");
      let patch: any, condition: SQL; const chain: any = { set(p: any) { patch = p; return chain; }, where(c: SQL) { condition = c; return chain; }, then(resolve: any, reject: any) { return Promise.resolve().then(() => { const target = rows(table).filter(row => matches(condition, row)); target.forEach(row => Object.assign(row, structuredClone(patch))); return [{ affectedRows: target.length }]; }).then(resolve, reject); } }; return chain;
    },
    async transaction(work: any) {
      const previous = tail; let unlock!: () => void; tail = new Promise<void>(resolve => { unlock = resolve; }); await previous;
      const snapshot = structuredClone(state); transactionCount++;
      try { const result = await work(db); if (revokeAfterTransactions && transactionCount === revokeAfterTransactions) state.users[0].isActive = false; return result; }
      catch (error) { state = snapshot; throw error; } finally { unlock(); }
    },
  };
  mocks.getDb.mockResolvedValue(db);
  return { db, rows, reads, failAt(table: any, ref?: string) { failure = { table, ref }; }, clearFailure() { failure = null; }, corrupt() { corruptRead = true; }, revokeAfter(n: number) { revokeAfterTransactions = n; } };
}
function csv(patches: Record<string, string>[] = [{}], columns: readonly string[] = HANDBOOK_IMPORT_COLUMNS) {
  const records = patches.map((patch, i) => ({ external_reference: `JLT-TEST-${i + 1}`, title: "Synthetic CSV guide", category: "General", guidance_type: "operational", editor_format: "article", summary: "", tags: "test|csv", content: "<h2>Checks</h2><p>Synthetic safe text.</p>", when_to_use: "", checks_before_starting: "", steps: "", suggested_reply: "", when_to_ask_for_help: "", related_guidance: "", ...patch }));
  return "\uFEFF" + [columns, ...records.map(row => columns.map(column => (row as Record<string, string>)[column] ?? ""))].map(row => row.map(cell => '"' + cell.replace(/"/g, '""') + '"').join(",")).join("\r\n") + "\r\n";
}
async function commit(data: string, actor = admin(), selected?: number[]) { const preview = await previewHandbookImport(actor, { csv: data }); return commitHandbookImport(actor, { csv: data, previewHash: preview.previewHash, rows: selected ?? preview.rows.filter(row => row.status === "ready").map(row => row.rowNumber) }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("JWT_SECRET", "synthetic-handbook-test-signing-key"); });

describe("exact handbook CSV format", () => {
  it("accepts both template formats without invented policies", () => { const rows = parseHandbookImport(handbookImportTemplate(), 1); expect(rows.map(row => row.status)).toEqual(["ready", "ready"]); expect(rows.every(row => row.title.startsWith("EXAMPLE ONLY"))).toBe(true); expect(rows[1].content?.sections.steps).toContain("First confirmed action"); });
  it("accepts quoted comma, escaped quotes, multiline Unicode and reordered headers", () => { const data = csv([{ title: 'A, "quoted" café', content: "<p>First\nsecond — £10.</p>" }], [...HANDBOOK_IMPORT_COLUMNS].reverse()); const [row] = parseHandbookImport(data, 1); expect(row.status).toBe("ready"); expect(row.title).toBe('A, "quoted" café'); expect(row.content?.contentHtml).toContain("second — £10"); expect(row.rowNumber).toBe(2); });
  it.each(["missing", "extra", "duplicate", "approval"])("rejects %s headers", kind => { const columns = [...HANDBOOK_IMPORT_COLUMNS] as string[]; if (kind === "missing") columns.pop(); else if (kind === "duplicate") columns[1] = columns[0]; else columns.push(kind === "approval" ? "published" : "unknown"); expect(() => parseHandbookImport(csv([{}], columns), 1)).toThrow("14 column"); });
  it("rejects unmatched CSV quoting safely", () => { expect(() => parseHandbookImport('"unclosed', 1)).toThrow("could not be read"); });
  it("rejects empty files, invalid control characters and oversized UTF-8", () => { expect(() => parseHandbookImport("", 1)).toThrow(); expect(() => parseHandbookImport(csv([{ title: "bad\u0000text" }]), 1)).toThrow("invalid text"); expect(() => parseHandbookImport(csv([{ content: "é".repeat(HANDBOOK_IMPORT_MAX_BYTES / 2) }]), 1)).toThrow("5 MiB"); });
  it("bounds 100 records during parsing", () => { expect(parseHandbookImport(csv(Array.from({ length: 100 }, () => ({}))), 1)).toHaveLength(100); expect(() => parseHandbookImport(csv(Array.from({ length: 101 }, () => ({}))), 1)).toThrow("100 guide rows"); });
  it.each(["operational", "financial", "legal", "policy"])("accepts independent %s guidance type", guidance_type => { expect(parseHandbookImport(csv([{ guidance_type }]), 1)[0].content?.sensitivity).toBe(guidance_type); });
  it.each(STAFF_HANDBOOK_CATEGORIES)("accepts exact standard category %s", category => { expect(parseHandbookImport(csv([{ category }]), 1)[0].status).toBe("ready"); });
  it.each([{ category: "Invented" }, { guidance_type: "approved" }, { editor_format: "decision" }, { external_reference: "lowercase" }, { external_reference: "BAD REF" }, { title: "" }, { title: "a".repeat(256) }, { summary: "x".repeat(4001) }, { tags: "a||b" }, { tags: "x".repeat(81) }, { tags: Array.from({ length: 31 }, (_, i) => String(i)).join("|") }, { content: "x".repeat(200001) }, { steps: "x".repeat(60001) }])("keeps other valid rows when a field is invalid", patch => { const rows = parseHandbookImport(csv([patch, {}]), 1); expect(rows[0].status).toBe("invalid"); expect(rows[1].status).toBe("ready"); });
  it.each(["<p></p>", "<p>&nbsp;</p>", "<script>bad()</script>", "   "])("rejects nonmeaningful body %s", content => { expect(parseHandbookImport(csv([{ content }]), 1)[0].status).toBe("invalid"); });
  it("preserves safe formatting but warns about stripped images/scripts/links", () => { const [row] = parseHandbookImport(csv([{ content: '<h2>Title</h2><ol><li>Check</li></ol><img src="https://example.org/i"><script>bad()</script><a href="javascript:bad()">bad link</a>' }]), 1); expect(row.status).toBe("ready"); expect(row.content?.contentHtml).not.toMatch(/<img|<script|javascript:/); expect(row.warnings.length).toBe(1); });
  it("keeps plain metadata literal and deduplicates tags", () => { const [row] = parseHandbookImport(csv([{ title: "<b>literal</b>", summary: "&amp; literal", tags: "test|test|csv" }]), 1); expect(row.content?.title).toBe("<b>literal</b>"); expect(row.content?.summary).toBe("&amp; literal"); expect(row.content?.tags).toEqual(["test", "csv"]); });
  it("rejects mismatched article/process cells and requires meaningful process steps", () => { expect(parseHandbookImport(csv([{ steps: "<p>wrong cell</p>" }]), 1)[0].status).toBe("invalid"); expect(parseHandbookImport(csv([{ editor_format: "process", steps: "<p>Do this</p>" }]), 1)[0].status).toBe("invalid"); expect(parseHandbookImport(csv([{ editor_format: "process", content: "", steps: "<ol><li>Do this</li></ol>" }]), 1)[0].status).toBe("ready"); });
  it("flags every within-file duplicate reference", () => { const rows = parseHandbookImport(csv([{ external_reference: "SAME" }, { external_reference: "SAME" }]), 1); expect(rows.every(row => row.status === "invalid")).toBe(true); });
});

describe("atomic draft import and durable identity", () => {
  it("preview performs no writes and exposes only sanitised bodies", async () => { const f = fixture(); const result = await previewHandbookImport(admin(), { csv: csv([{ content: '<p>safe</p><script>secret()</script>' }]) }); expect(f.rows(articles)).toHaveLength(0); expect(result.rows[0].content?.contentHtml).toBe("<p>safe</p>"); expect(result.rows[0]).not.toHaveProperty("payloadHash"); });
  it("creates guide, revision and reference together, never publishes or answers reports", async () => { const f = fixture(); f.rows(requests).push({ id: 80, status: "new" }); const result = await commit(csv()); expect(result.createdCount).toBe(1); expect(f.rows(articles)[0]).toMatchObject({ publishedRevisionId: null, reviewedRevisionId: null, submittedAt: null }); expect(f.rows(revisions)[0]).toMatchObject({ resourceIds: [], contributorIds: [1] }); expect(f.rows(sources)[0]).toMatchObject({ externalReference: "JLT-TEST-1", articleId: result.rows[0].articleId }); expect(f.rows(requests)[0].status).toBe("new"); expect(f.rows(inAppNotifications)).toHaveLength(0); expect(f.rows(resources)).toHaveLength(0); });
  it("only explicitly selected valid rows create drafts and other outcomes are complete", async () => { const f = fixture(); const result = await commit(csv([{}, { title: "" }, {}]), admin(), [4]); expect(result.rows.map(row => row.outcome)).toEqual(["not_selected", "invalid", "created"]); expect(f.rows(articles)).toHaveLength(1); });
  it("retries identical accepted file across administrators without duplicates or overwrites", async () => { const f = fixture(); const data = csv(); const first = await commit(data); const id = first.rows[0].articleId!; const stored = f.rows(revisions)[0]; stored.content.contentHtml = "<p>Later manual draft edit</p>"; f.rows(articles)[0].archivedAt = new Date(); const before = structuredClone([f.rows(articles), f.rows(revisions), f.rows(audit)]); const preview = await previewHandbookImport(admin(2), { csv: data }); expect(preview.rows[0]).toMatchObject({ status: "already_imported", articleId: id }); const retry = await commitHandbookImport(admin(2), { csv: data, previewHash: preview.previewHash, rows: [2] }); expect(retry.skippedCount).toBe(1); expect([f.rows(articles), f.rows(revisions), f.rows(audit)]).toEqual(before); });
  it("preserves accepted payload identity through reordered header and newline encoding", async () => { const f = fixture(); await commit(csv([{ content: "<p>First\nsecond</p>" }])); const preview = await previewHandbookImport(admin(2), { csv: csv([{ content: "<p>First\r\nsecond</p>" }], [...HANDBOOK_IMPORT_COLUMNS].reverse()) }); expect(preview.rows[0].status).toBe("already_imported"); expect(f.rows(articles)).toHaveLength(1); });
  it("changed known reference conflicts instead of modifying existing draft or publication", async () => { const f = fixture(); await commit(csv()); f.rows(articles)[0].publishedRevisionId = 123; const before = structuredClone(f.rows(articles)); const data = csv([{ title: "Changed" }]); const preview = await previewHandbookImport(admin(2), { csv: data }); expect(preview.rows[0].status).toBe("conflict"); const result = await commitHandbookImport(admin(2), { csv: data, previewHash: preview.previewHash, rows: [2] }); expect(result.rows[0].outcome).toBe("conflict"); expect(f.rows(articles)).toEqual(before); });
  it("keeps duplicate identity in receipt for known unselected rows", async () => { fixture(); await commit(csv()); const result = await commit(csv([{}, {}]), admin(2), [3]); expect(result.rows.map(row => row.outcome)).toEqual(["already_imported", "created"]); expect(result.rows[0].guideUrl).toContain("article="); });
  it("refuses forged, altered-file and cross-actor preview signatures before any writes", async () => { const f = fixture(); const data = csv(); const preview = await previewHandbookImport(admin(), { csv: data }); for (const payload of [{ csv: data, previewHash: "0".repeat(64), rows: [2] }, { csv: csv([{ title: "changed" }]), previewHash: preview.previewHash, rows: [2] }]) await expect(commitHandbookImport(admin(), payload)).rejects.toMatchObject({ code: "CONFLICT" }); await expect(commitHandbookImport(admin(2), { csv: data, previewHash: preview.previewHash, rows: [2] })).rejects.toMatchObject({ code: "CONFLICT" }); expect(f.rows(articles)).toHaveLength(0); });
  it.each([[], [1], [999], [2, 2]])("rejects invalid row selection %j", async rows => { const f = fixture(); const data = csv(); const preview = await previewHandbookImport(admin(), { csv: data }); await expect(commitHandbookImport(admin(), { csv: data, previewHash: preview.previewHash, rows })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.rows(articles)).toHaveLength(0); });
  it("rolls back a failed reference insertion without orphan draft/revision/audit; other rows succeed", async () => { const f = fixture(); f.failAt(sources, "JLT-TEST-1"); const result = await commit(csv([{}, {}])); expect(result.rows.map(row => row.outcome)).toEqual(["failed", "created"]); expect(f.rows(articles)).toHaveLength(1); expect(f.rows(revisions)).toHaveLength(1); expect(f.rows(sources)[0].externalReference).toBe("JLT-TEST-2"); expect(JSON.stringify(result)).not.toContain("RAW DATABASE SECRET"); f.clearFailure(); const retry = await commit(csv([{}, {}]), admin(), [2]); expect(retry.createdCount).toBe(1); expect(retry.skippedCount).toBe(1); expect(f.rows(articles)).toHaveLength(2); });
  it("fails closed on corrupted mapping readback", async () => { const f = fixture(); f.corrupt(); const result = await commit(csv()); expect(result.errorCount).toBe(1); expect(f.rows(articles)).toHaveLength(0); expect(f.rows(revisions)).toHaveLength(0); expect(f.rows(sources)).toHaveLength(0); });
  it("simultaneous different-staff imports settle to one durable guide", async () => { const f = fixture(); const data = csv(); const a = await previewHandbookImport(admin(), { csv: data }); const b = await previewHandbookImport(admin(2), { csv: data }); const results = await Promise.all([commitHandbookImport(admin(), { csv: data, previewHash: a.previewHash, rows: [2] }), commitHandbookImport(admin(2), { csv: data, previewHash: b.previewHash, rows: [2] })]); expect(results.map(r => r.rows[0].outcome).sort()).toEqual(["already_imported", "created"]); expect(f.rows(sources)).toHaveLength(1); expect(f.rows(articles)).toHaveLength(1); });
  it.each(["financial", "legal", "policy"])("keeps exact independent approval requirements for imported %s guidance", async guidance_type => { const f = fixture(); const result = await commit(csv([{ guidance_type }])); const id = result.rows[0].articleId!; expect(f.rows(revisions)[0].content._cycleRequiresReview).toBe(true); await expect(handbookArticleAction(admin(), { id, expectedVersion: 1, action: "publish" })).rejects.toMatchObject({ code: "FORBIDDEN" }); await handbookArticleAction(admin(), { id, expectedVersion: 1, action: "submit_review" }); await expect(handbookArticleAction(admin(), { id, expectedVersion: 2, action: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.rows(articles)[0].publishedRevisionId).toBeNull(); });
  it.each([{ role: "agent" }, { role: "employee" }, { role: "jlt_instructor" }, { role: "jlt_engagement" }, { isActive: false }, { portalStatus: "suspended" }, { mustChangePassword: true }])("denies ineligible session before DB access", async patch => { fixture(); mocks.getDb.mockClear(); await expect(previewHandbookImport(admin(1, patch), { csv: csv() })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mocks.getDb).not.toHaveBeenCalled(); });
  it("revocation after a committed row suppresses private receipt and stops remaining rows", async () => { const f = fixture(); f.revokeAfter(1); await expect(commit(csv([{}, {}]))).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.rows(articles)).toHaveLength(1); });
  it("fresh DB authority denial blocks preview even if cached session claims admin", async () => { const f = fixture(); f.rows(users)[0].mustChangePassword = true; await expect(previewHandbookImport(admin(), { csv: csv() })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.rows(articles)).toHaveLength(0); });
  it("public router refuses added approval/publication fields and anonymous/agent requests", async () => { fixture(); const ctx = (user: any) => ({ user, req: {}, res: {} }) as any; await expect(staffHandbookRouter.createCaller(ctx(null)).previewImport({ csv: csv() })).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(staffHandbookRouter.createCaller(ctx(admin(1, { role: "agent" }))).previewImport({ csv: csv() })).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(staffHandbookRouter.createCaller(ctx(admin())).previewImport({ csv: csv(), published: true } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
});
