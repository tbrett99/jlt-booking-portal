import { describe, expect, it, vi } from "vitest";
import { createPool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { desc, eq, getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { parse } from "csv-parse/sync";
import * as schema from "../drizzle/schema";
import { emptyHandbookContent } from "../shared/staff-handbook";
const connection = vi.hoisted(() => ({ db: null as any }));
vi.mock("./db", () => ({ getDb: async () => connection.db }));
vi.mock("./storage", () => ({ storagePutEncrypted: () => { throw new Error("Storage forbidden in ordering probe"); } }));
import { browseHandbook } from "./staff-handbook-articles";
import { exportHandbookGuides } from "./staff-handbook-exports";

const socket = "/home/ubuntu/handbook-mysql-probe/mysql.sock";
const enabled = process.env.HANDBOOK_LOCAL_MYSQL_ORDER_TEST === "1";
const { staffHandbookArticles: articles, staffHandbookRevisions: revisions, staffHandbookImportSources: sources } = schema;
const actor = { id: 1, role: "admin", isActive: true, portalStatus: "active", mustChangePassword: false };
const NOW = new Date("2026-11-21T12:00:00Z");
const csvIds = (csv: string): number[] => parse(csv, { bom: true, columns: true }).map((row: any) => Number(row.guide_id));

/** Explicit opt-in, fixed local Unix socket ONLY: never consumes DATABASE_URL.
 * The finite external harness starts empty MySQL 8 with networking disabled.
 * Tables reproduce column types for SELECT/JSON mapping, not migration/concurrency validation.
 * Every seeded row is root-rolled back and absence is verified before closing.
 */
describe.skipIf(!enabled)("local-only real MySQL guide ordering", () => {
  it("reproduces the old zero ordinal and validates blank/searched browse/export, views, paging, JSON and rollback", async () => {
    const pool = createPool({ socketPath: socket, user: "root", database: "jlt_handbook_order_probe", connectionLimit: 1, timezone: "+00:00" });
    const db = drizzle(pool, { schema, mode: "default" });
    const rollback = new Error("LOCAL_SYNTHETIC_ORDERING_ROOT_ROLLBACK");
    try {
      const [engine] = await pool.query("SELECT VERSION() AS version, DATABASE() AS db");
      expect((engine as any)[0]).toMatchObject({ version: expect.stringMatching(/^8\.0\./), db: "jlt_handbook_order_probe" });
      await pool.query("CREATE TABLE IF NOT EXISTS users (id INT PRIMARY KEY, name TEXT, role VARCHAR(30), isActive BOOLEAN, portalStatus VARCHAR(30), mustChangePassword BOOLEAN) ENGINE=InnoDB");
      for (const table of [articles, revisions, sources]) {
        const config = getTableConfig(table);
        const columns = config.columns.map(column => `\`${column.name}\` ${column.getSQLType()} ${column.notNull ? "NOT NULL" : "NULL"} ${column.primary ? "PRIMARY KEY" : ""}`).join(", ");
        await pool.query(`CREATE TABLE IF NOT EXISTS \`${config.name}\` (${columns}) ENGINE=InnoDB`);
      }
      for (const table of [schema.users, articles, revisions, sources]) {
        const [count] = await pool.query(`SELECT COUNT(*) AS total FROM \`${getTableName(table)}\``);
        expect((count as any)[0].total).toBe(0);
      }
      // The exact old Drizzle/mysql2 ORDER BY output fails even on an empty table.
      const old = db.select({ id: articles.id }).from(articles).innerJoin(revisions, eq(revisions.id, articles.draftRevisionId))
        .orderBy(desc(sql`JSON_EXTRACT(${revisions.content}, '$.isPinned') = true`), desc(sql<number>`0`), desc(articles.updatedAt), desc(articles.id)).toSQL();
      expect(old.sql).toContain(", 0 desc,");
      await expect(pool.query(old.sql, old.params)).rejects.toMatchObject({ code: "ER_BAD_FIELD_ERROR", errno: 1054, sqlState: "42S22" });
      console.log("Local MySQL 8 confirmed old blank-search ORDER BY fails with ER_BAD_FIELD_ERROR / 1054; no production connection used.");
      try {
        await db.transaction(async tx => {
          await tx.execute(sql`INSERT INTO users (id, name, role, isActive, portalStatus, mustChangePassword) VALUES (1, 'Synthetic Admin', 'admin', true, 'active', false)`);
          connection.db = tx;
          for (const view of ["all", "published", "drafts", "archived"] as const) {
            expect((await browseHandbook(actor, { view })).items).toEqual([]);
            expect((await exportHandbookGuides(actor, { view })).rowCount).toBe(0);
          }
          for (let id = 1; id <= 32; id++) {
            const c = { ...emptyHandbookContent(1), title: id === 2 ? "needle" : id === 3 ? "needle guide" : `Guide ${id}`, category: "General", format: "article" as const, contentHtml: "<p>needle body and 50%_\\value</p>", isPinned: id === 1 };
            await tx.insert(articles).values({ id, createToken: `local-order-${id}`, version: 1, draftRevisionId: id, publishedRevisionId: id === 32 ? id : null, archivedAt: id === 31 ? NOW : null, createdById: 1, createdAt: NOW, updatedAt: id === 30 ? new Date(NOW.getTime() - 1000) : NOW });
            await tx.insert(revisions).values({ id, articleId: id, revisionNumber: 1, title: c.title, summary: "", category: c.category, content: c, searchText: `${c.title}\n${c.contentHtml}`, resourceIds: [], contributorIds: [1], createdById: 1, changeSummary: "Synthetic ordering probe", createdAt: NOW });
          }
          const active = [1, 32, ...Array.from({ length: 29 }, (_, i) => 30 - i).filter(id => id !== 30), 30];
          const expected = { all: active, drafts: active.filter(id => id !== 32), published: [32], archived: [31] };
          for (const view of ["all", "published", "drafts", "archived"] as const) {
            for (const search of [undefined, "", "   ", "\t\n"]) {
              const first = await browseHandbook(actor, { view, search, category: "General" });
              const second = await browseHandbook(actor, { view, search, category: "General", page: 2 });
              expect(first.total).toBe(expected[view].length);
              expect(first.items.map(item => item.id)).toEqual(expected[view].slice(0, 25));
              expect(second.items.map(item => item.id)).toEqual(expected[view].slice(25));
              const exported = await exportHandbookGuides(actor, { view, search, category: "General" });
              expect(csvIds(exported.csv)).toEqual(expected[view]);
              expect(exported.snapshot).toBe(view === "published" ? "Published" : "Working draft");
            }
          }
          const searched = [1, 2, 3, 32, ...Array.from({ length: 27 }, (_, i) => 30 - i).filter(id => id !== 30), 30];
          const browse = await browseHandbook(actor, { view: "all", search: " needle " });
          expect(browse.items.map(item => item.id)).toEqual(searched.slice(0, 25));
          expect(csvIds((await exportHandbookGuides(actor, { view: "all", search: " needle " })).csv)).toEqual(searched);
          // Literal %, underscore and backslash continue using escaped LIKE parameters.
          expect((await browseHandbook(actor, { view: "all", search: "50%_\\value" })).total).toBe(31);
          expect((await exportHandbookGuides(actor, { view: "all", search: "50%_\\value" })).rowCount).toBe(31);
          // Fresh account authority still rejects a revoked administrator.
          await tx.execute(sql`UPDATE users SET isActive = false WHERE id = 1`);
          await expect(browseHandbook(actor, { view: "all" })).rejects.toMatchObject({ code: "FORBIDDEN" });
          await expect(exportHandbookGuides(actor, { view: "all" })).rejects.toMatchObject({ code: "FORBIDDEN" });
          throw rollback;
        }, { isolationLevel: "repeatable read" });
      } catch (error) { if (error !== rollback) throw error; }
      for (const table of [schema.users, articles, revisions, sources]) {
        const [count] = await pool.query(`SELECT COUNT(*) AS total FROM \`${getTableName(table)}\``);
        expect((count as any)[0].total).toBe(0);
      }
      console.log("Local-only real browse/export ordering probe passed; every synthetic row verified absent after root rollback.");
    } finally { connection.db = null; await pool.end(); }
  }, 30000);
});
