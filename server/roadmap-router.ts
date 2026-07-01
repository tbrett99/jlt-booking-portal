/**
 * roadmap-router.ts
 * Procedures for the public Roadmap and community Suggestions features.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";

// ─── Roadmap Items ────────────────────────────────────────────────────────────

export const roadmapRouter = router({
  // Public list — only visible items, no internalNotes
  listPublic: protectedProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return [];
    const { roadmapItems } = await import("../drizzle/schema");
    const { eq, asc } = await import("drizzle-orm");
    const items = await db
      .select({
        id: roadmapItems.id,
        title: roadmapItems.title,
        description: roadmapItems.description,
        category: roadmapItems.category,
        status: roadmapItems.status,
        timeframe: roadmapItems.timeframe,
        progressPct: roadmapItems.progressPct,
        fromSuggestionId: roadmapItems.fromSuggestionId,
        sortOrder: roadmapItems.sortOrder,
        releasedAt: roadmapItems.releasedAt,
        createdAt: roadmapItems.createdAt,
      })
      .from(roadmapItems)
      .where(eq(roadmapItems.isVisible, true))
      .orderBy(asc(roadmapItems.sortOrder), asc(roadmapItems.createdAt));
    return items;
  }),

  // Admin list — all items including hidden, with internal notes
  listAdmin: adminProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return [];
    const { roadmapItems } = await import("../drizzle/schema");
    const { asc } = await import("drizzle-orm");
    return db
      .select()
      .from(roadmapItems)
      .orderBy(asc(roadmapItems.sortOrder), asc(roadmapItems.createdAt));
  }),

  // Create a new roadmap item (admin)
  create: adminProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        category: z.enum(["Bookings", "Payments", "CRM", "Reports", "Commissions", "Community", "Mobile", "Admin", "Other"]).default("Other"),
        status: z.enum(["under_consideration", "planned", "in_progress", "released"]).default("planned"),
        timeframe: z.string().max(100).optional(),
        progressPct: z.number().int().min(0).max(100).default(0),
        internalNotes: z.string().optional(),
        effort: z.enum(["small", "medium", "large", "xl"]).optional(),
        priorityScore: z.number().int().default(0),
        isVisible: z.boolean().default(true),
        sortOrder: z.number().int().default(0),
        releasedAt: z.date().optional(),
        fromSuggestionId: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapItems } = await import("../drizzle/schema");
      const result = await db.insert(roadmapItems).values({
        ...input,
        releasedAt: input.releasedAt ?? (input.status === "released" ? new Date() : undefined),
      });
      return { id: (result as any).insertId as number };
    }),

  // Update a roadmap item (admin)
  update: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        category: z.enum(["Bookings", "Payments", "CRM", "Reports", "Commissions", "Community", "Mobile", "Admin", "Other"]).optional(),
        status: z.enum(["under_consideration", "planned", "in_progress", "released"]).optional(),
        timeframe: z.string().max(100).optional().nullable(),
        progressPct: z.number().int().min(0).max(100).optional(),
        internalNotes: z.string().optional().nullable(),
        effort: z.enum(["small", "medium", "large", "xl"]).optional().nullable(),
        priorityScore: z.number().int().optional(),
        isVisible: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
        releasedAt: z.date().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapItems } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { id, ...data } = input;
      // Auto-set releasedAt when status becomes released
      const updateData: any = { ...data };
      if (data.status === "released" && data.releasedAt === undefined) {
        updateData.releasedAt = new Date();
      }
      await db.update(roadmapItems).set(updateData).where(eq(roadmapItems.id, id));
      return { success: true };
    }),

  // Delete a roadmap item (admin)
  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapItems, roadmapItemNotes } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(roadmapItemNotes).where(eq(roadmapItemNotes.itemId, input.id));
      await db.delete(roadmapItems).where(eq(roadmapItems.id, input.id));
      return { success: true };
    }),

  // Add internal note to a roadmap item (admin)
  addNote: adminProcedure
    .input(z.object({ itemId: z.number().int(), note: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapItemNotes } = await import("../drizzle/schema");
      await db.insert(roadmapItemNotes).values({
        itemId: input.itemId,
        authorId: ctx.user.id,
        note: input.note,
      });
      return { success: true };
    }),

  // List internal notes for a roadmap item (admin)
  listNotes: adminProcedure
    .input(z.object({ itemId: z.number().int() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [];
      const { roadmapItemNotes, users } = await import("../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      return db
        .select({
          id: roadmapItemNotes.id,
          note: roadmapItemNotes.note,
          createdAt: roadmapItemNotes.createdAt,
          authorName: users.name,
        })
        .from(roadmapItemNotes)
        .leftJoin(users, eq(roadmapItemNotes.authorId, users.id))
        .where(eq(roadmapItemNotes.itemId, input.itemId))
        .orderBy(desc(roadmapItemNotes.createdAt));
    }),

  // ─── Suggestions ─────────────────────────────────────────────────────────────

  // List all suggestions with vote totals and current user's vote
  listSuggestions: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return [];
    const { roadmapSuggestions, roadmapVotes, users } = await import("../drizzle/schema");
    const { desc, eq, sql } = await import("drizzle-orm");

    const suggestions = await db
      .select({
        id: roadmapSuggestions.id,
        title: roadmapSuggestions.title,
        description: roadmapSuggestions.description,
        status: roadmapSuggestions.status,
        convertedToItemId: roadmapSuggestions.convertedToItemId,
        createdAt: roadmapSuggestions.createdAt,
        userId: roadmapSuggestions.userId,
        submitterName: users.name,
      })
      .from(roadmapSuggestions)
      .leftJoin(users, eq(roadmapSuggestions.userId, users.id))
      .orderBy(desc(roadmapSuggestions.createdAt));

    // Get all votes
    const allVotes = await db.select().from(roadmapVotes);
    const voteMap = new Map<number, { total: number; myVote: number }>();
    for (const v of allVotes) {
      const entry = voteMap.get(v.suggestionId) ?? { total: 0, myVote: 0 };
      entry.total += v.value;
      if (v.userId === ctx.user.id) entry.myVote = v.value;
      voteMap.set(v.suggestionId, entry);
    }

    const isAdmin = ctx.user.role === "admin" || ctx.user.role === "super_admin";
    return suggestions.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      status: s.status,
      convertedToItemId: s.convertedToItemId,
      createdAt: s.createdAt,
      isOwn: s.userId === ctx.user.id,
      // Only admins see the submitter name
      submitterName: isAdmin ? (s.submitterName ?? "Unknown") : null,
      votes: voteMap.get(s.id)?.total ?? 0,
      myVote: voteMap.get(s.id)?.myVote ?? 0,
    }));
  }),

  // Submit a new suggestion (any agent)
  submitSuggestion: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(255), description: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapSuggestions } = await import("../drizzle/schema");
      const result = await db.insert(roadmapSuggestions).values({
        userId: ctx.user.id,
        title: input.title,
        description: input.description ?? null,
      });
      return { id: (result as any).insertId as number };
    }),

  // Vote on a suggestion (+1 or -1); cannot vote on own suggestion
  vote: protectedProcedure
    .input(z.object({ suggestionId: z.number().int(), value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapSuggestions, roadmapVotes } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");

      // Check not own suggestion
      const [suggestion] = await db
        .select({ userId: roadmapSuggestions.userId })
        .from(roadmapSuggestions)
        .where(eq(roadmapSuggestions.id, input.suggestionId))
        .limit(1);
      if (!suggestion) throw new TRPCError({ code: "NOT_FOUND" });
      if (suggestion.userId === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot vote on your own suggestion" });
      }

      // Remove existing vote
      await db
        .delete(roadmapVotes)
        .where(and(eq(roadmapVotes.userId, ctx.user.id), eq(roadmapVotes.suggestionId, input.suggestionId)));

      // Insert new vote (value 0 = remove vote only)
      if (input.value !== 0) {
        await db.insert(roadmapVotes).values({
          userId: ctx.user.id,
          suggestionId: input.suggestionId,
          value: input.value,
        });
      }
      return { success: true };
    }),

  // Delete a suggestion (admin only)
  deleteSuggestion: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapSuggestions, roadmapVotes } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(roadmapVotes).where(eq(roadmapVotes.suggestionId, input.id));
      await db.delete(roadmapSuggestions).where(eq(roadmapSuggestions.id, input.id));
      return { success: true };
    }),

  // Update suggestion status (admin)
  updateSuggestionStatus: adminProcedure
    .input(z.object({ id: z.number().int(), status: z.enum(["open", "under_review", "planned", "declined"]) }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapSuggestions } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(roadmapSuggestions).set({ status: input.status }).where(eq(roadmapSuggestions.id, input.id));
      return { success: true };
    }),

  // ─── Suggestion Replies ───────────────────────────────────────────────────────

  // List replies for a suggestion (visible to all authenticated users)
  listReplies: protectedProcedure
    .input(z.object({ suggestionId: z.number().int() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [];
      const { roadmapSuggestionReplies, users } = await import("../drizzle/schema");
      const { eq, asc } = await import("drizzle-orm");
      return db
        .select({
          id: roadmapSuggestionReplies.id,
          body: roadmapSuggestionReplies.body,
          createdAt: roadmapSuggestionReplies.createdAt,
          updatedAt: roadmapSuggestionReplies.updatedAt,
          authorName: users.name,
        })
        .from(roadmapSuggestionReplies)
        .leftJoin(users, eq(roadmapSuggestionReplies.authorId, users.id))
        .where(eq(roadmapSuggestionReplies.suggestionId, input.suggestionId))
        .orderBy(asc(roadmapSuggestionReplies.createdAt));
    }),

  // Add a reply to a suggestion (admin only)
  addReply: adminProcedure
    .input(z.object({ suggestionId: z.number().int(), body: z.string().min(1).max(5000) }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapSuggestionReplies } = await import("../drizzle/schema");
      const result = await db.insert(roadmapSuggestionReplies).values({
        suggestionId: input.suggestionId,
        authorId: ctx.user.id,
        body: input.body,
      });
      return { id: (result as any).insertId as number };
    }),

  // Edit a reply (admin only — own replies only, or super_admin can edit any)
  editReply: adminProcedure
    .input(z.object({ replyId: z.number().int(), body: z.string().min(1).max(5000) }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapSuggestionReplies } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const [existing] = await db
        .select({ authorId: roadmapSuggestionReplies.authorId })
        .from(roadmapSuggestionReplies)
        .where(eq(roadmapSuggestionReplies.id, input.replyId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.authorId !== ctx.user.id && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await db
        .update(roadmapSuggestionReplies)
        .set({ body: input.body })
        .where(eq(roadmapSuggestionReplies.id, input.replyId));
      return { success: true };
    }),

  // Delete a reply (admin only)
  deleteReply: adminProcedure
    .input(z.object({ replyId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapSuggestionReplies } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [existing] = await db
        .select({ authorId: roadmapSuggestionReplies.authorId })
        .from(roadmapSuggestionReplies)
        .where(eq(roadmapSuggestionReplies.id, input.replyId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.authorId !== ctx.user.id && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await db
        .delete(roadmapSuggestionReplies)
        .where(eq(roadmapSuggestionReplies.id, input.replyId));
      return { success: true };
    }),

  // Convert a suggestion to a roadmap item (admin)
  convertSuggestion: adminProcedure
    .input(
      z.object({
        suggestionId: z.number().int(),
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        category: z.enum(["Bookings", "Payments", "CRM", "Reports", "Commissions", "Community", "Mobile", "Admin", "Other"]).default("Other"),
        status: z.enum(["under_consideration", "planned", "in_progress", "released"]).default("planned"),
        timeframe: z.string().max(100).optional(),
        isVisible: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { roadmapItems, roadmapSuggestions } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const result = await db.insert(roadmapItems).values({
        title: input.title,
        description: input.description ?? null,
        category: input.category,
        status: input.status,
        timeframe: input.timeframe ?? null,
        isVisible: input.isVisible,
        fromSuggestionId: input.suggestionId,
      });
      const newItemId = (result as any).insertId as number;

      // Update suggestion status to "planned" and link to item
      await db
        .update(roadmapSuggestions)
        .set({ status: "planned", convertedToItemId: newItemId })
        .where(eq(roadmapSuggestions.id, input.suggestionId));

      return { id: newItemId };
    }),
});
