import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, inArray, sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import { HANDBOOK_IMPORT_COLUMNS } from "../shared/staff-handbook-import";
const connection = vi.hoisted(() => ({ db: null as any }));
vi.mock("./db", () => ({ getDb: async () => connection.db }));
vi.mock("./storage", () => ({ storagePutEncrypted: () => { throw new Error("Private storage must not run in CSV validation"); } }));
import { previewHandbookImport, commitHandbookImport } from "./staff-handbook-import";
import { exportHandbookGuides, exportHandbookRequests } from "./staff-handbook-exports";
import { handbookArticle, saveHandbookArticle, handbookArticleAction } from "./staff-handbook-articles";
import { createKnowledgeRequest } from "./staff-handbook-requests";
const enabled = process.env.HANDBOOK_CSV_VALIDATION_DB_TEST === "1";

/** Explicit opt-in, fixed managed-validation host; no Railway or committed test rows. */
describe.skipIf(!enabled)("rollback-only real-driver staff handbook CSV", () => {
  it("roundtrips both formats, cross-staff retries, changed references and coherent exports, then verifies every synthetic identity absent", async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (new URL(url).hostname !== "gateway02.us-east-1.prod.aws.tidbcloud.com") throw new Error("Unexpected database target; CSV validation stopped");
    const pool = createPool({ uri: url, connectionLimit: 1, timezone: "+00:00" });
    const db = drizzle(pool, { schema, mode: "default" });
    const token = randomUUID().toUpperCase();
    const refs = [`CSV-PROBE-${token}-1`, `CSV-PROBE-${token}-2`];
    const userIds: number[] = [], guideIds: number[] = [], revisionIds: number[] = [];
    let reportId = 0;
    const rollback = new Error("SYNTHETIC_CSV_ROOT_ROLLBACK");
    const rows = [
      [refs[0], `Synthetic CSV validation ${token}`, "Client & Supplier Payments", "operational", "article", "Generic validation only", "synthetic|csv", '<h2>Checks</h2><p>Quoted "text", £10 and café.</p>', "", "", "", "", "", ""],
      [refs[1], `Synthetic process validation ${token}`, "Travel Regulations & Financial Protection", "financial", "process", "Generic validation only", "synthetic|process", "", "<p>When needed.</p>", "<ul><li>Check.</li></ul>", "<ol><li>First.</li><li>Second.</li></ol>", "<p>Confirmed wording.</p>", "<p>Ask staff.</p>", ""],
    ];
    const csv = (input = rows) => "\uFEFF" + [[...HANDBOOK_IMPORT_COLUMNS], ...input].map(row => row.map(value => '"' + value.replace(/"/g, '""') + '"').join(",")).join("\r\n") + "\r\n";
    try {
      // This separately exercises the actual portable repeatable-read characteristic;
      // export queries below use nested savepoints inside the rollback-only root.
      await db.transaction(async tx => { const [result] = await tx.execute(sql`select 1 as csv_validation_snapshot`); expect((result as any)[0].csv_validation_snapshot).toBe(1); }, { isolationLevel: "repeatable read" });
      try {
        await db.transaction(async tx => {
          for (let index = 0; index < 2; index++) {
            const [person] = await tx.insert(schema.users).values({ openId: `handbook-csv-probe-${token}-${index}`, name: `Synthetic CSV validation administrator ${index}`, role: "admin", isActive: true, portalStatus: "active", mustChangePassword: false }).$returningId();
            userIds.push(person.id);
          }
          connection.db = tx;
          const actor = (id: number) => ({ id, role: "admin", isActive: true, portalStatus: "active", mustChangePassword: false });
          const first = actor(userIds[0]), second = actor(userIds[1]);
          const preview = await previewHandbookImport(first, { csv: csv() });
          expect(preview.readyCount).toBe(2);
          const receipt = await commitHandbookImport(first, { csv: csv(), previewHash: preview.previewHash, rows: [2, 3] });
          expect(receipt.createdCount).toBe(2);
          guideIds.push(...receipt.rows.map(row => row.articleId!));
          for (const id of guideIds) {
            const detail = await handbookArticle(first, id);
            revisionIds.push(detail.draft!.id);
            expect(detail.published).toBeNull(); expect(detail.draft?.resourceIds).toEqual([]);
          }
          const process = await handbookArticle(first, guideIds[1]);
          expect(process.draft?.content.sections.steps).toBe("<ol><li>First.</li><li>Second.</li></ol>");
          expect(process.article.requiresIndependentReview).toBe(true);
          await expect(handbookArticleAction(first, { id: guideIds[1], expectedVersion: 1, action: "publish" })).rejects.toMatchObject({ code: "FORBIDDEN" });
          const detail = await handbookArticle(first, guideIds[0]);
          const changed = await saveHandbookArticle(first, { id: guideIds[0], expectedVersion: 1, content: { ...detail.draft!.content, contentHtml: "<p>Later manual edit.</p>" }, changeSummary: "Synthetic validation edit" });
          revisionIds.push((await handbookArticle(first, guideIds[0])).draft!.id);
          const retryPreview = await previewHandbookImport(second, { csv: csv() });
          expect(retryPreview.skippedCount).toBe(2);
          const retry = await commitHandbookImport(second, { csv: csv(), previewHash: retryPreview.previewHash, rows: [2, 3] });
          expect(retry.skippedCount).toBe(2);
          expect((await handbookArticle(first, guideIds[0])).draft!.content.contentHtml).toBe("<p>Later manual edit.</p>");
          const altered = rows.map(row => [...row]); altered[0][1] = `Changed source ${token}`;
          const conflictPreview = await previewHandbookImport(second, { csv: csv(altered) });
          expect(conflictPreview.rows[0].status).toBe("conflict");
          const conflict = await commitHandbookImport(second, { csv: csv(altered), previewHash: conflictPreview.previewHash, rows: [2] });
          expect(conflict.rows[0].outcome).toBe("conflict");
          expect((await handbookArticle(first, guideIds[0])).article.version).toBe(changed.version);
          const exported = await exportHandbookGuides(first, { search: token, view: "all" });
          expect(exported.rowCount).toBe(2); expect(exported.snapshot).toBe("Working draft");
          expect(exported.csv).toContain(refs[0]); expect(exported.csv).toContain("Later manual edit."); expect(exported.csv).not.toContain("payloadHash");
          expect((await exportHandbookGuides(first, { search: token, view: "published" })).rowCount).toBe(0);
          const report = await createKnowledgeRequest(first, { createToken: randomUUID(), title: `Synthetic gap ${token}`, description: "Generic staff checklist missing.", category: "Complaints & Disputes", kind: "missing_process", checkedGuidance: "", impact: "", priority: "high", articleId: guideIds[0] });
          reportId = report.id;
          const reportExport = await exportHandbookRequests(first, { search: token, status: "open", assigneeId: null });
          expect(reportExport.rowCount).toBe(1); expect(reportExport.csv).toContain("Working draft"); expect(reportExport.csv).toContain("answered_or_closed_at");
          throw rollback;
        });
      } catch (error) { if (error !== rollback) throw error; }
      if (userIds.length !== 2 || guideIds.length !== 2 || !reportId) throw new Error("Incomplete synthetic CSV probe");
      expect(await db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, userIds))).toEqual([]);
      expect(await db.select({ id: schema.staffHandbookArticles.id }).from(schema.staffHandbookArticles).where(inArray(schema.staffHandbookArticles.id, guideIds))).toEqual([]);
      expect(await db.select({ id: schema.staffHandbookRevisions.id }).from(schema.staffHandbookRevisions).where(inArray(schema.staffHandbookRevisions.id, revisionIds))).toEqual([]);
      expect(await db.select({ ref: schema.staffHandbookImportSources.externalReference }).from(schema.staffHandbookImportSources).where(inArray(schema.staffHandbookImportSources.externalReference, refs))).toEqual([]);
      expect(await db.select({ id: schema.staffKnowledgeRequests.id }).from(schema.staffKnowledgeRequests).where(eq(schema.staffKnowledgeRequests.id, reportId))).toEqual([]);
      expect(await db.select({ id: schema.staffHandbookAudit.id }).from(schema.staffHandbookAudit).where(inArray(schema.staffHandbookAudit.entityId, [...guideIds, reportId]))).toEqual([]);
    } finally { connection.db = null; await pool.end(); }
  }, 90000);
});
