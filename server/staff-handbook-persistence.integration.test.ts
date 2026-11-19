import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import * as schema from "../drizzle/schema";
const connection = vi.hoisted(() => ({ db: null as any }));
vi.mock("./db", () => ({ getDb: async () => connection.db }));
vi.mock("./storage", () => ({
  storagePutEncrypted: () => {
    throw new Error("Storage must not run in rollback-only probe");
  },
}));
import {
  saveHandbookArticle,
  saveAndPublishHandbookArticle,
  handbookArticle,
} from "./staff-handbook-articles";
import { emptyHandbookContent } from "../shared/staff-handbook";
const enabled = process.env.HANDBOOK_VALIDATION_DB_TEST === "1";
/** Deliberately excluded from normal tests. Only managed validation DB; NEVER Railway. */
describe.skipIf(!enabled)(
  "rollback-only handbook real-driver persistence",
  () => {
    it("executes the complete save/read/edit/publish path with exact JSON/dates and restores every synthetic row by rollback", async () => {
      const url = process.env.DATABASE_URL ?? "";
      if (
        new URL(url).hostname !== "gateway02.us-east-1.prod.aws.tidbcloud.com"
      )
        throw new Error("Unexpected database target; validation stopped");
      const pool = createPool({
        uri: url,
        connectionLimit: 1,
        timezone: "+00:00",
      });
      const db = drizzle(pool, { schema, mode: "default" });
      const rollback = new Error("SYNTHETIC_HANDBOOK_ROLLBACK");
      const token = randomUUID();
      let newUserId = 0,
        draftId = 0,
        publishedId = 0;
      try {
        try {
          await db.transaction(async tx => {
            const [person] = await tx
              .insert(schema.users)
              .values({
                openId: "handbook-probe-" + token,
                name: "Synthetic handbook validation administrator",
                role: "admin",
                isActive: true,
                portalStatus: "active",
                mustChangePassword: false,
              })
              .$returningId();
            newUserId = person.id;
            connection.db = tx; // Nested savepoints stay on this one rollback-only connection.
            const actor = {
              id: person.id,
              role: "admin",
              isActive: true,
              portalStatus: "active",
              mustChangePassword: false,
            };
            const content = {
              ...emptyHandbookContent(person.id),
              title: "Synthetic real-driver handbook guide",
              format: "article" as const,
              tags: ["synthetic", "rollback-only"],
              contentHtml: "<p>Generic validation process only.</p>",
              reviewedAt: new Date("2026-11-19T00:00:00Z"),
              nextReviewAt: new Date("2027-01-19T00:00:00Z"),
            };
            const created = await saveHandbookArticle(actor, {
              createToken: token,
              content,
              changeSummary: "",
            });
            draftId = created.id;
          const fresh = await handbookArticle(actor, created.id);
          expect(fresh.draft?.content).toEqual(content);
          expect(fresh.published).toBeNull();
          await expect(saveHandbookArticle(actor, { createToken: token, content: { ...content, title: "Changed after a lost save response" }, changeSummary: "" })).rejects.toMatchObject({ code: "CONFLICT" });
          expect((await handbookArticle(actor, created.id)).draft?.content).toEqual(content);
          const updatedContent = {
            ...content,
            title: "Updated synthetic real-driver guide",
            };
            const edited = await saveHandbookArticle(actor, {
              id: created.id,
              expectedVersion: created.version,
              content: updatedContent,
              changeSummary: "",
            });
            expect(edited.version).toBe(created.version + 1);
            expect(
              (await handbookArticle(actor, created.id)).draft?.content.title
            ).toBe(updatedContent.title);
            const publishInput = {
              createToken: randomUUID(),
              content: {
                ...content,
                title: "Synthetic atomic internal publication",
              },
              changeSummary: "",
            };
            const published = await saveAndPublishHandbookArticle(
              actor,
              publishInput
            );
            publishedId = published.id;
            const live = await handbookArticle(actor, published.id);
            expect(live.article.publishedRevisionId).toBe(
              live.article.draftRevisionId
            );
            expect(live.published?.content).toEqual(publishInput.content);
            expect(
              await saveAndPublishHandbookArticle(actor, publishInput)
            ).toEqual(published);
            await expect(
              saveAndPublishHandbookArticle(actor, {
                createToken: randomUUID(),
                content: { ...content, sensitivity: "financial" },
                changeSummary: "",
              })
            ).rejects.toMatchObject({ code: "FORBIDDEN" });
            console.log(
              "Managed validation DB: complete handbook save/readback/edit/atomic publication, dates/JSON, idempotent retry and sensitive-review denial passed; rolling back all synthetic rows."
            );
            throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
        // Read ONLY exact synthetic IDs to prove the root transaction left nothing behind.
        expect(
          await db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.id, newUserId))
        ).toEqual([]);
        for (const id of [draftId, publishedId]) {
          expect(
            await db
              .select({ id: schema.staffHandbookArticles.id })
              .from(schema.staffHandbookArticles)
              .where(eq(schema.staffHandbookArticles.id, id))
          ).toEqual([]);
          expect(
            await db
              .select({ id: schema.staffHandbookRevisions.id })
              .from(schema.staffHandbookRevisions)
              .where(eq(schema.staffHandbookRevisions.articleId, id))
          ).toEqual([]);
        }
      } finally {
        connection.db = null;
        await pool.end();
      }
    }, 120000);
  }
);
