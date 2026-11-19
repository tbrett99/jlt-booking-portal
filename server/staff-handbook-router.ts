import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import {
  KNOWLEDGE_REQUEST_KINDS,
  KNOWLEDGE_REQUEST_STATUSES,
} from "../shared/staff-handbook";
import {
  assertStaffHandbookAccount,
  categorySchema,
  contentSchema,
  fail,
  idSchema,
  pageSchema,
  safeHandbookError,
  tokenSchema,
  versionSchema,
} from "./staff-handbook-policy";
import {
  browseHandbook,
  handbookArticle,
  handbookArticleAction,
  handbookOverview,
  saveHandbookArticle,
  saveAndPublishHandbookArticle,
} from "./staff-handbook-articles";
import {
  addKnowledgeComment,
  browseKnowledgeRequests,
  createGuideFromKnowledgeRequest,
  createKnowledgeRequest,
  knowledgeRequest,
  updateKnowledgeRequest,
} from "./staff-handbook-requests";
import {
  uploadHandbookResource,
  removeHandbookResource,
  HANDBOOK_MAX_FILE_BYTES,
} from "./staff-handbook-resources";

const handbookProcedure = adminProcedure.use(async ({ ctx, next }) => {
  assertStaffHandbookAccount(ctx.user);
  try {
    const result = await next();
    if (!result.ok) throw result.error;
    return result;
  } catch (error) {
    throw safeHandbookError(error);
  }
});
/** Prevent zod issues reflecting internal/user body values in the error response. */
function input<T extends z.ZodType>(schema: T) {
  return {
    parse(value: unknown): z.output<T> {
      const result = schema.safeParse(value);
      if (!result.success)
        fail("BAD_REQUEST", "Invalid internal handbook input.");
      return result.data;
    },
  };
}
const search = z.string().trim().max(200).optional();
const priority = z.enum(["low", "normal", "high"]);
const requestStatus = z.enum(KNOWLEDGE_REQUEST_STATUSES);
const record = z.object({ id: idSchema });
const saveInput = z.object({
  id: idSchema.optional(),
  expectedVersion: versionSchema.optional(),
  createToken: tokenSchema.optional(),
  content: contentSchema,
  changeSummary: z.string().trim().max(500).optional().default(""),
});
export const staffHandbookRouter = router({
  overview: handbookProcedure.query(({ ctx }) => handbookOverview(ctx.user)),
  browse: handbookProcedure
    .input(
      input(
        z
          .object({
            search,
            category: categorySchema.optional(),
            view: z.enum(["all", "published", "drafts", "archived"]).optional(),
            needsReview: z.boolean().optional(),
            dueReview: z.boolean().optional(),
            page: pageSchema,
          })
          .optional()
      )
    )
    .query(({ ctx, input }) => browseHandbook(ctx.user, input)),
  article: handbookProcedure
    .input(input(record))
    .query(({ ctx, input }) => handbookArticle(ctx.user, input.id)),
  saveArticle: handbookProcedure
    .input(input(saveInput))
    .mutation(({ ctx, input }) => saveHandbookArticle(ctx.user, input)),
  saveAndPublishArticle: handbookProcedure
    .input(input(saveInput))
    .mutation(({ ctx, input }) =>
      saveAndPublishHandbookArticle(ctx.user, input)
    ),
  articleAction: handbookProcedure
    .input(
      input(
        z.object({
          id: idSchema,
          expectedVersion: versionSchema,
          action: z.enum([
            "submit_review",
            "approve",
            "publish",
            "archive",
            "restore",
          ]),
        })
      )
    )
    .mutation(({ ctx, input }) => handbookArticleAction(ctx.user, input)),
  uploadResource: handbookProcedure
    .input(
      input(
        z.object({
          articleId: idSchema,
          expectedVersion: versionSchema,
          fileName: z.string().min(1).max(255),
          fileBase64: z
            .string()
            .min(1)
            .max(4 * Math.ceil(HANDBOOK_MAX_FILE_BYTES / 3)),
          mimeType: z.string().min(1).max(180),
        })
      )
    )
    .mutation(({ ctx, input }) => uploadHandbookResource(ctx.user, input)),
  removeResource: handbookProcedure
    .input(
      input(
        z.object({
          articleId: idSchema,
          resourceId: idSchema,
          expectedVersion: versionSchema,
        })
      )
    )
    .mutation(({ ctx, input }) => removeHandbookResource(ctx.user, input)),
  requests: handbookProcedure
    .input(
      input(
        z
          .object({
            search,
            status: z
              .enum(["all", "open", ...KNOWLEDGE_REQUEST_STATUSES])
              .optional(),
            assigneeId: idSchema.nullable().optional(),
            category: categorySchema.optional(),
            page: pageSchema,
          })
          .optional()
      )
    )
    .query(({ ctx, input }) => browseKnowledgeRequests(ctx.user, input)),
  request: handbookProcedure
    .input(input(record))
    .query(({ ctx, input }) => knowledgeRequest(ctx.user, input.id)),
  createRequest: handbookProcedure
    .input(
      input(
        z.object({
          createToken: tokenSchema,
          title: z.string().trim().min(1).max(255),
          description: z.string().trim().min(1).max(20000),
          category: categorySchema,
          kind: z.enum(KNOWLEDGE_REQUEST_KINDS),
          checkedGuidance: z.string().max(10000),
          impact: z.string().max(10000),
          priority,
          articleId: idSchema.nullable().optional(),
        })
      )
    )
    .mutation(({ ctx, input }) => createKnowledgeRequest(ctx.user, input)),
  updateRequest: handbookProcedure
    .input(
      input(
        z.object({
          id: idSchema,
          expectedVersion: versionSchema,
          status: requestStatus,
          priority,
          assigneeId: idSchema.nullable(),
          articleId: idSchema.nullable(),
          duplicateOfId: idSchema.nullable(),
          closureReason: z.string().max(10000).nullable(),
          title: z.string().trim().min(1).max(255).optional(),
          description: z.string().trim().min(1).max(20000).optional(),
          category: categorySchema.optional(),
        })
      )
    )
    .mutation(({ ctx, input }) => updateKnowledgeRequest(ctx.user, input)),
  createGuideFromRequest: handbookProcedure
    .input(
      input(
        z.object({
          id: idSchema,
          expectedVersion: versionSchema,
          createToken: tokenSchema,
        })
      )
    )
    .mutation(({ ctx, input }) =>
      createGuideFromKnowledgeRequest(ctx.user, input)
    ),
  addComment: handbookProcedure
    .input(
      input(
        z.object({
          id: idSchema,
          expectedVersion: versionSchema,
          body: z.string().trim().min(1).max(10000),
        })
      )
    )
    .mutation(({ ctx, input }) => addKnowledgeComment(ctx.user, input)),
});
export {
  assertStaffHandbookAccount,
  assertFreshStaffHandbookAccount,
} from "./staff-handbook-policy";
