import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { createInAppNotification, getDb } from "./db";
import { sendDirectEmail } from "./email";
import { awardMomentum } from "./momentum";
import { storagePut } from "./storage";
import {
  calendarEvents,
  knowledgeBaseArticles,
  libraryAuditLog,
  libraryContentActivity,
  libraryResources,
  users,
  webinarLibraryItems,
} from "../drizzle/schema";

const CONTENT_STATUSES = ["draft", "published", "archived"] as const;
const CONTENT_TYPES = ["article", "webinar"] as const;
const PORTAL_URL = "https://portal.thejltgroup.co.uk";

const adminContentInput = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().trim().min(2).max(255),
  summary: z.string().trim().max(10_000).nullable().optional(),
  contentHtml: z.string().max(600_000).nullable().optional(),
  category: z.string().trim().min(1).max(120),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  status: z.enum(CONTENT_STATUSES),
  isFeatured: z.boolean().default(false),
  notifyAgents: z.boolean().default(false),
});

const adminWebinarInput = adminContentInput.extend({
  videoUrl: z.string().trim().max(1200).nullable().optional(),
  privateTranscript: z.string().max(1_000_000).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(1_440).nullable().optional(),
  recordedAt: z.coerce.date().nullable().optional(),
  linkedEventId: z.number().int().positive().nullable().optional(),
});

const resourceInput = z.object({
  contentType: z.enum(CONTENT_TYPES),
  contentId: z.number().int().positive(),
  fileName: z.string().trim().min(1).max(255),
  fileBase64: z.string().min(1).max(20_000_000),
  mimeType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
  ]),
});

type ContentType = (typeof CONTENT_TYPES)[number];

function optionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normaliseTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim().replace(/\s+/g, " ")).filter(Boolean))).slice(0, 30);
}

function tagsFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? tagsFromUnknown(parsed) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Staff-authored rich content is kept expressive, but active content is removed. */
export function sanitiseLibraryHtml(value: string | null | undefined) {
  if (!value?.trim()) return null;
  return value
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|svg|math)[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src)\s*=\s*(?:"\s*(?:javascript:|data:)[^"]*"|'\s*(?:javascript:|data:)[^']*'|(?:javascript:|data:)[^\s>]*)/gi, "")
    .trim();
}

export function stripLibraryHtml(value: string | null | undefined) {
  return (value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function isSafeHttpsUrl(value: string | null | undefined) {
  if (!value?.trim()) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function matchesLibrarySearch(item: { title: string; summary: string | null; category: string; tags: unknown }, search: string) {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [item.title, item.summary ?? "", item.category, ...tagsFromUnknown(item.tags)]
    .join(" ")
    .toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function canPublishLibraryContent(input: { title: string; summary?: string | null; videoUrl?: string | null }, type: ContentType) {
  if (!input.title.trim()) return "A title is required before publishing.";
  if (type === "webinar" && !isSafeHttpsUrl(input.videoUrl)) return "A published webinar needs a valid HTTPS recording link.";
  return null;
}

function displayType(type: ContentType) {
  return type === "article" ? "Knowledge Base article" : "webinar";
}

function contentLink(type: ContentType, id: number) {
  return type === "article" ? `/knowledge-base?article=${id}` : `/webinars?webinar=${id}`;
}

function escapeHtml(value: string | null | undefined) {
  return (value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character] ?? character));
}

async function addAudit(params: {
  entityType: "article" | "webinar" | "resource";
  entityId: number;
  action: string;
  summary: string;
  actorId: number;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(libraryAuditLog).values({
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    summary: params.summary,
    actorId: params.actorId,
    metadata: params.metadata ?? null,
  });
}

async function assertContentExists(type: ContentType, contentId: number, publishedOnly = false) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const table = type === "article" ? knowledgeBaseArticles : webinarLibraryItems;
  const [content] = await db.select().from(table).where(eq(table.id, contentId)).limit(1);
  if (!content || (publishedOnly && content.status !== "published")) {
    throw new TRPCError({ code: "NOT_FOUND", message: publishedOnly ? "This content is not currently available." : "Library content not found." });
  }
  return content;
}

async function resourcesForContent(type: ContentType, contentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(libraryResources).where(and(eq(libraryResources.contentType, type), eq(libraryResources.contentId, contentId))).orderBy(desc(libraryResources.createdAt));
}

async function getActivity(userId: number, type: ContentType, contentId: number) {
  const db = await getDb();
  if (!db) return null;
  const [activity] = await db.select().from(libraryContentActivity)
    .where(and(eq(libraryContentActivity.userId, userId), eq(libraryContentActivity.contentType, type), eq(libraryContentActivity.contentId, contentId)))
    .limit(1);
  return activity ?? null;
}

async function recordView(userId: number, type: ContentType, contentId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const now = new Date();
  await db.insert(libraryContentActivity).values({ userId, contentType: type, contentId, firstViewedAt: now, lastViewedAt: now })
    .onDuplicateKeyUpdate({ set: { lastViewedAt: now } });
}

async function announceToActiveAgents(params: { type: ContentType; id: number; title: string; actorId: number }) {
  const db = await getDb();
  if (!db) return { notified: 0, emailed: 0 };
  const agents = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.role, "agent"), eq(users.isActive, true), eq(users.portalStatus, "active")));
  const message = `New ${displayType(params.type)}: ${params.title}`;
  const linkUrl = contentLink(params.type, params.id);
  const safeTitle = escapeHtml(params.title);
  const safeType = params.type === "article" ? "Knowledge Base article" : "recorded webinar";
  const deliveries = await Promise.all(agents.map(async (agent) => {
    try {
      await createInAppNotification({ userId: agent.id, message, linkUrl, isUrgent: false });
      if (!agent.email) return { email: false };
      const result = await sendDirectEmail({
        toEmail: agent.email,
        toName: agent.name ?? "JLT Agent",
        userId: agent.id,
        triggerKey: `library_published_${params.type}_${params.id}`,
        subject: `New in the JLT Portal: ${params.title}`,
        html: `<p>Hi ${escapeHtml((agent.name ?? "there").split(" ")[0])},</p><p>A new ${safeType} is now available in the JLT Portal:</p><p style="margin:18px 0;padding:14px 16px;border-left:4px solid #02E6D2;background:#f0fffe;"><strong>${safeTitle}</strong></p><p><a href="${PORTAL_URL}${linkUrl}" style="display:inline-block;background:#02E6D2;color:#1a1a2e;padding:10px 18px;border-radius:6px;font-weight:700;text-decoration:none;">Open in the Portal &rarr;</a></p>`,
      });
      return { email: result.success };
    } catch (error) {
      console.error("[Library] Could not send publication notification", error);
      return { email: false };
    }
  }));
  await addAudit({
    entityType: params.type,
    entityId: params.id,
    actorId: params.actorId,
    action: "agents_notified",
    summary: `Sent publication notification to ${agents.length} active agents for ${params.title}`,
    metadata: { activeAgentCount: agents.length, emailDeliveredCount: deliveries.filter((item) => item.email).length },
  });
  return { notified: agents.length, emailed: deliveries.filter((item) => item.email).length };
}

async function listPublishedContent(ctxUserId: number, input?: { search?: string; category?: string | null }) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [articles, webinars, activities] = await Promise.all([
    db.select().from(knowledgeBaseArticles).where(eq(knowledgeBaseArticles.status, "published")).orderBy(desc(knowledgeBaseArticles.isFeatured), desc(knowledgeBaseArticles.publishedAt)),
    db.select().from(webinarLibraryItems).where(eq(webinarLibraryItems.status, "published")).orderBy(desc(webinarLibraryItems.isFeatured), desc(webinarLibraryItems.publishedAt)),
    db.select().from(libraryContentActivity).where(eq(libraryContentActivity.userId, ctxUserId)),
  ]);
  const byActivityKey = new Map(activities.map((activity) => [`${activity.contentType}:${activity.contentId}`, activity]));
  const search = input?.search ?? "";
  const category = input?.category?.trim() || null;
  const decorate = <T extends { id: number; title: string; summary: string | null; category: string; tags: unknown }>(type: ContentType, item: T) => ({
    ...item,
    tags: tagsFromUnknown(item.tags),
    activity: byActivityKey.get(`${type}:${item.id}`) ?? null,
  });
  const visibleArticles = articles
    .filter((item) => (!category || item.category === category) && matchesLibrarySearch(item, search))
    .map((item) => decorate("article", item));
  const visibleWebinars = webinars
    .filter((item) => (!category || item.category === category) && matchesLibrarySearch(item, search))
    .map((item) => decorate("webinar", item));
  const categories = Array.from(new Set([...articles, ...webinars].map((item) => item.category))).sort((a, b) => a.localeCompare(b));
  return { articles: visibleArticles, webinars: visibleWebinars, categories };
}

export const libraryRouter = router({
  browse: protectedProcedure.input(z.object({ search: z.string().trim().max(200).optional(), category: z.string().trim().max(120).nullable().optional() }).optional())
    .query(async ({ ctx, input }) => listPublishedContent(ctx.user.id, input)),

  article: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const article = await assertContentExists("article", input.id, true);
    const [resources, activity] = await Promise.all([resourcesForContent("article", input.id), getActivity(ctx.user.id, "article", input.id)]);
    return { ...article, tags: tagsFromUnknown(article.tags), resources, activity };
  }),

  webinar: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const webinar = await assertContentExists("webinar", input.id, true) as typeof webinarLibraryItems.$inferSelect;
    const [resources, activity] = await Promise.all([resourcesForContent("webinar", input.id), getActivity(ctx.user.id, "webinar", input.id)]);
    // Deliberately omit privateTranscript from the agent payload.
    const { privateTranscript: _privateTranscript, ...safeWebinar } = webinar;
    return { ...safeWebinar, tags: tagsFromUnknown(webinar.tags), resources, activity };
  }),

  recordView: protectedProcedure.input(z.object({ contentType: z.enum(CONTENT_TYPES), contentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertContentExists(input.contentType, input.contentId, true);
    await recordView(ctx.user.id, input.contentType, input.contentId);
    return { success: true };
  }),

  markCompleted: protectedProcedure.input(z.object({ contentType: z.enum(CONTENT_TYPES), contentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const content = await assertContentExists(input.contentType, input.contentId, true);
    const previous = await getActivity(ctx.user.id, input.contentType, input.contentId);
    const now = new Date();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    await db.insert(libraryContentActivity).values({
      userId: ctx.user.id,
      contentType: input.contentType,
      contentId: input.contentId,
      firstViewedAt: now,
      lastViewedAt: now,
      completedAt: now,
    }).onDuplicateKeyUpdate({ set: { lastViewedAt: now, completedAt: previous?.completedAt ?? now } });
    const completedAt = previous?.completedAt ?? now;
    const award = previous?.completedAt
      ? { awarded: false, reason: "already_completed", points: 0 }
      : await awardMomentum({
          agentId: ctx.user.id,
          ruleKey: input.contentType === "article" ? "knowledge_base_checkpoint" : "webinar_checkpoint",
          sourceType: input.contentType === "article" ? "knowledge_base_article" : "webinar_library_item",
          sourceId: input.contentId,
          sourceLabel: content.title,
        });
    return { completedAt, award };
  }),

  admin: router({
    overview: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [articles, webinars, resources, activity, events] = await Promise.all([
        db.select().from(knowledgeBaseArticles).orderBy(desc(knowledgeBaseArticles.updatedAt)),
        db.select().from(webinarLibraryItems).orderBy(desc(webinarLibraryItems.updatedAt)),
        db.select().from(libraryResources).orderBy(desc(libraryResources.createdAt)),
        db.select().from(libraryContentActivity),
        db.select({ id: calendarEvents.id, title: calendarEvents.title, startDate: calendarEvents.startDate, eventCategory: calendarEvents.eventCategory })
          .from(calendarEvents).where(eq(calendarEvents.agentFacing, true)).orderBy(desc(calendarEvents.startDate)),
      ]);
      const resourcesFor = (type: ContentType, id: number) => resources.filter((resource) => resource.contentType === type && resource.contentId === id);
      const activityFor = (type: ContentType, id: number) => activity.filter((row) => row.contentType === type && row.contentId === id);
      const decorate = <T extends { id: number; tags: unknown }>(type: ContentType, item: T) => ({
        ...item,
        tags: tagsFromUnknown(item.tags),
        resources: resourcesFor(type, item.id),
        completionCount: activityFor(type, item.id).filter((row) => !!row.completedAt).length,
        viewCount: activityFor(type, item.id).length,
      });
      return {
        articles: articles.map((article) => decorate("article", article)),
        webinars: webinars.map((webinar) => decorate("webinar", webinar)),
        eventOptions: events,
        metrics: {
          publishedArticles: articles.filter((item) => item.status === "published").length,
          publishedWebinars: webinars.filter((item) => item.status === "published").length,
          articleCompletions: activity.filter((item) => item.contentType === "article" && !!item.completedAt).length,
          webinarCompletions: activity.filter((item) => item.contentType === "webinar" && !!item.completedAt).length,
        },
      };
    }),

    audit: adminProcedure.input(z.object({ contentType: z.enum(CONTENT_TYPES), contentId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return db.select({ audit: libraryAuditLog, actorName: users.name, actorEmail: users.email })
        .from(libraryAuditLog)
        .leftJoin(users, eq(users.id, libraryAuditLog.actorId))
        .where(and(eq(libraryAuditLog.entityType, input.contentType), eq(libraryAuditLog.entityId, input.contentId)))
        .orderBy(desc(libraryAuditLog.createdAt))
        .limit(100);
    }),

    saveArticle: adminProcedure.input(adminContentInput).mutation(async ({ ctx, input }) => {
      const publishIssue = input.status === "published" ? canPublishLibraryContent(input, "article") : null;
      if (publishIssue) throw new TRPCError({ code: "BAD_REQUEST", message: publishIssue });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const now = new Date();
      const values = {
        title: input.title,
        summary: optionalText(input.summary),
        contentHtml: sanitiseLibraryHtml(input.contentHtml),
        category: input.category.trim(),
        tags: normaliseTags(input.tags),
        status: input.status,
        isFeatured: input.isFeatured,
        updatedById: ctx.user.id,
      };
      let id = input.id;
      let wasPublished = false;
      if (id) {
        const [existing] = await db.select().from(knowledgeBaseArticles).where(eq(knowledgeBaseArticles.id, id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Knowledge Base article not found" });
        wasPublished = existing.status === "published";
        await db.update(knowledgeBaseArticles).set({
          ...values,
          publishedAt: input.status === "published" && !wasPublished ? now : existing.publishedAt,
          publishedById: input.status === "published" && !wasPublished ? ctx.user.id : existing.publishedById,
        }).where(eq(knowledgeBaseArticles.id, id));
      } else {
        const result = await db.insert(knowledgeBaseArticles).values({
          ...values,
          createdById: ctx.user.id,
          publishedAt: input.status === "published" ? now : null,
          publishedById: input.status === "published" ? ctx.user.id : null,
        }).$returningId();
        id = Number(result[0]?.id);
        if (!Number.isSafeInteger(id) || id < 1) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Article was saved but did not return an ID" });
      }
      await addAudit({ entityType: "article", entityId: id, actorId: ctx.user.id, action: input.id ? "updated" : "created", summary: `${input.id ? "Updated" : "Created"} Knowledge Base article: ${input.title}`, metadata: { status: input.status, category: input.category, tags: normaliseTags(input.tags) } });
      let announcement = { notified: 0, emailed: 0 };
      if (input.status === "published" && input.notifyAgents) announcement = await announceToActiveAgents({ type: "article", id, title: input.title, actorId: ctx.user.id });
      return { id, announcement };
    }),

    saveWebinar: adminProcedure.input(adminWebinarInput).mutation(async ({ ctx, input }) => {
      const videoUrl = optionalText(input.videoUrl);
      if (videoUrl && !isSafeHttpsUrl(videoUrl)) throw new TRPCError({ code: "BAD_REQUEST", message: "Webinar recording links must use HTTPS." });
      const publishIssue = input.status === "published" ? canPublishLibraryContent({ ...input, videoUrl }, "webinar") : null;
      if (publishIssue) throw new TRPCError({ code: "BAD_REQUEST", message: publishIssue });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const now = new Date();
      const values = {
        title: input.title,
        summary: optionalText(input.summary),
        descriptionHtml: sanitiseLibraryHtml(input.contentHtml),
        category: input.category.trim(),
        tags: normaliseTags(input.tags),
        videoUrl,
        privateTranscript: optionalText(input.privateTranscript),
        durationMinutes: input.durationMinutes ?? null,
        recordedAt: input.recordedAt ?? null,
        linkedEventId: input.linkedEventId ?? null,
        status: input.status,
        isFeatured: input.isFeatured,
        updatedById: ctx.user.id,
      };
      let id = input.id;
      let wasPublished = false;
      if (id) {
        const [existing] = await db.select().from(webinarLibraryItems).where(eq(webinarLibraryItems.id, id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Webinar not found" });
        wasPublished = existing.status === "published";
        await db.update(webinarLibraryItems).set({
          ...values,
          publishedAt: input.status === "published" && !wasPublished ? now : existing.publishedAt,
          publishedById: input.status === "published" && !wasPublished ? ctx.user.id : existing.publishedById,
        }).where(eq(webinarLibraryItems.id, id));
      } else {
        const result = await db.insert(webinarLibraryItems).values({
          ...values,
          createdById: ctx.user.id,
          publishedAt: input.status === "published" ? now : null,
          publishedById: input.status === "published" ? ctx.user.id : null,
        }).$returningId();
        id = Number(result[0]?.id);
        if (!Number.isSafeInteger(id) || id < 1) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Webinar was saved but did not return an ID" });
      }
      await addAudit({ entityType: "webinar", entityId: id, actorId: ctx.user.id, action: input.id ? "updated" : "created", summary: `${input.id ? "Updated" : "Created"} webinar: ${input.title}`, metadata: { status: input.status, category: input.category, tags: normaliseTags(input.tags), hasPrivateTranscript: !!optionalText(input.privateTranscript) } });
      let announcement = { notified: 0, emailed: 0 };
      if (input.status === "published" && input.notifyAgents) announcement = await announceToActiveAgents({ type: "webinar", id, title: input.title, actorId: ctx.user.id });
      return { id, announcement };
    }),

    uploadResource: adminProcedure.input(resourceInput).mutation(async ({ ctx, input }) => {
      await assertContentExists(input.contentType, input.contentId);
      const bytes = Buffer.from(input.fileBase64, "base64");
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Resources must be under 10 MB." });
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "library-resource";
      const stored = await storagePut(`library/${input.contentType}/${input.contentId}/${ctx.user.id}/${Date.now()}-${safeName}`, bytes, input.mimeType);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const result = await db.insert(libraryResources).values({
        contentType: input.contentType,
        contentId: input.contentId,
        title: input.fileName,
        fileUrl: stored.url,
        fileKey: stored.key,
        mimeType: input.mimeType,
        uploadedById: ctx.user.id,
      }).$returningId();
      const id = Number(result[0]?.id);
      if (!Number.isSafeInteger(id) || id < 1) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Resource upload did not return an ID" });
      await addAudit({ entityType: "resource", entityId: id, actorId: ctx.user.id, action: "resource_added", summary: `Added resource ${input.fileName} to ${displayType(input.contentType)}`, metadata: { contentType: input.contentType, contentId: input.contentId, fileKey: stored.key } });
      return { id, url: stored.url, name: input.fileName };
    }),

    removeResource: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [resource] = await db.select().from(libraryResources).where(eq(libraryResources.id, input.id)).limit(1);
      if (!resource) throw new TRPCError({ code: "NOT_FOUND", message: "Resource not found" });
      // The object store deliberately has no delete API. Removing the durable
      // reference withdraws access while the audit retains traceability.
      await db.delete(libraryResources).where(eq(libraryResources.id, input.id));
      await addAudit({ entityType: "resource", entityId: input.id, actorId: ctx.user.id, action: "resource_removed", summary: `Removed resource ${resource.title} from ${displayType(resource.contentType)}`, metadata: { contentType: resource.contentType, contentId: resource.contentId, fileKey: resource.fileKey } });
      return { success: true };
    }),
  }),
});
