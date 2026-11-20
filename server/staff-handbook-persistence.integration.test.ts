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
import {
  createKnowledgeRequest,
  createGuideFromKnowledgeRequest,
  knowledgeRequest,
  recoverKnowledgeRequest,
  updateRecoveredKnowledgeRequest,
} from "./staff-handbook-requests";
import { handbookLinkOptions } from "./staff-handbook-links";
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
        publishedId = 0,
        reportId = 0,
        reportGuideId = 0;
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
            await expect(
              saveHandbookArticle(actor, {
                createToken: token,
                content: {
                  ...content,
                  title: "Changed after a lost save response",
                },
                changeSummary: "",
              })
            ).rejects.toMatchObject({ code: "CONFLICT" });
            expect(
              (await handbookArticle(actor, created.id)).draft?.content
            ).toEqual(content);
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
            const reportInput = {
              createToken: randomUUID(),
              title: "Synthetic report " + token,
              description: "Synthetic staff need a generic checklist.",
              category: "General",
              kind: "missing_process" as const,
              checkedGuidance: "",
              impact: "",
              priority: "normal" as const,
              articleId: null,
            };
            let report = await createKnowledgeRequest(actor, reportInput);
            reportId = report.id;
            expect(await createKnowledgeRequest(actor, reportInput)).toEqual(
              report
            );
            await expect(
              createKnowledgeRequest(actor, {
                ...reportInput,
                description: "Changed after an uncertain response",
              })
            ).rejects.toMatchObject({ code: "CONFLICT" });
            const recovered = await recoverKnowledgeRequest(actor, {
              createToken: reportInput.createToken,
            });
            expect(recovered.request?.id).toBe(report.id);
            const recoveryPayload = {
              ...reportInput,
              id: report.id,
              expectedVersion: report.version,
              description:
                "Updated after recovering the synthetic saved report.",
            };
            report = await updateRecoveredKnowledgeRequest(
              actor,
              recoveryPayload
            );
            expect(
              (await knowledgeRequest(actor, report.id)).request.description
            ).toBe(recoveryPayload.description);
            const generated = await createGuideFromKnowledgeRequest(actor, {
              id: report.id,
              expectedVersion: report.version,
              createToken: randomUUID(),
            });
            reportGuideId = generated.articleId;
            const generatedDraft = await handbookArticle(
              actor,
              generated.articleId
            );
            expect(generatedDraft.draft?.content.format).toBe("article");
            expect(generatedDraft.published).toBeNull();
            expect(
              (await knowledgeRequest(actor, report.id)).request.status
            ).toBe("drafting");
            await expect(
              updateRecoveredKnowledgeRequest(actor, {
                ...recoveryPayload,
                expectedVersion: report.version,
              })
            ).rejects.toMatchObject({ code: "CONFLICT" });
            const draftChoices = await handbookLinkOptions(actor, {
              type: "guides",
              scope: "active",
              search: token,
              selectedId: generated.articleId,
            });
            expect(draftChoices.items.map(item => item.id)).toEqual([
              generated.articleId,
            ]);
            expect(draftChoices.selected?.title).toBe(reportInput.title);
            const unpublishedChoices = await handbookLinkOptions(actor, {
              type: "guides",
              scope: "published",
              search: token,
              selectedId: generated.articleId,
            });
            expect(unpublishedChoices.items).toEqual([]);
            expect(unpublishedChoices.selected).toBeNull();
            await saveAndPublishHandbookArticle(actor, {
              id: generated.articleId,
              expectedVersion: generatedDraft.article.version,
              content: {
                ...generatedDraft.draft!.content,
                contentHtml: "<p>Synthetic checked steps for staff.</p>",
              },
              changeSummary: "",
            });
            const publishedChoices = await handbookLinkOptions(actor, {
              type: "guides",
              scope: "published",
              search: token,
              selectedId: generated.articleId,
            });
            expect(publishedChoices.selected?.state).toBe("published");
            expect(
              (await knowledgeRequest(actor, report.id)).request.status
            ).toBe("resolved");
            const reportChoices = await handbookLinkOptions(actor, {
              type: "reports",
              search: token,
              selectedId: report.id,
            });
            expect(reportChoices.selected?.title).toBe(reportInput.title);
            expect(
              (
                await handbookLinkOptions(actor, {
                  type: "reports",
                  search: token,
                  selectedId: report.id,
                  excludeId: report.id,
                })
              ).selected
            ).toBeNull();
            console.log(
              "Managed validation DB: guide saves, report retry safety, simple guide-from-report, named draft/published choices and publication resolving the report passed; rolling back all synthetic rows."
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
        expect(
          await db
            .select({ id: schema.staffKnowledgeRequests.id })
            .from(schema.staffKnowledgeRequests)
            .where(eq(schema.staffKnowledgeRequests.id, reportId))
        ).toEqual([]);
        for (const id of [draftId, publishedId, reportGuideId]) {
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
