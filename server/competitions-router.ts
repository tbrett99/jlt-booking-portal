/**
 * Competitions / Incentive Leaderboard tRPC router
 *
 * Agent procedures: listActive, getLeaderboard, submitEntry, myEntries
 * Admin procedures: listAll, create, update, listEntries, verifyEntry, bulkApprove, deleteEntry, exportEntries
 */
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "./db";
import { competitions, competitionEntries, users } from "../drizzle/schema";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAdmin(role: string) {
  return role === "admin" || role === "super_admin";
}

async function getCompetitionOrThrow(id: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, id));
  if (!comp) throw new TRPCError({ code: "NOT_FOUND", message: "Competition not found" });
  return comp;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const competitionsRouter = router({
  // ── AGENT: list active competitions ──────────────────────────────────────
  listActive: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(competitions)
      .where(eq(competitions.status, "active"))
      .orderBy(asc(competitions.endDate));
    return rows;
  }),

  // ── AGENT: get leaderboard for a competition ──────────────────────────────
  getLeaderboard: protectedProcedure
    .input(z.object({ competitionId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const comp = await getCompetitionOrThrow(input.competitionId);

      // Approved ticket counts per agent
      const ticketCounts = await db
        .select({
          agentId: competitionEntries.agentId,
          tickets: sql<number>`COUNT(*)`.as("tickets"),
        })
        .from(competitionEntries)
        .where(
          and(
            eq(competitionEntries.competitionId, input.competitionId),
            eq(competitionEntries.verifiedStatus, "approved")
          )
        )
        .groupBy(competitionEntries.agentId)
        .orderBy(desc(sql`COUNT(*)`));

      // Fetch agent names
      const agentIds = ticketCounts.map((r: { agentId: number; tickets: number }) => r.agentId);
      const agentMap: Record<number, string> = {};
      if (agentIds.length > 0) {
        const dbInst = await getDb();
        const agentRows = dbInst ? await dbInst
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, agentIds)) : [];
        for (const a of agentRows) {
          agentMap[a.id] = a.name ?? `Agent #${a.id}`;
        }
      }

      const leaderboard = ticketCounts.map((row: { agentId: number; tickets: number }, idx: number) => ({
        rank: idx + 1,
        agentId: row.agentId,
        agentName: agentMap[row.agentId] ?? `Agent #${row.agentId}`,
        tickets: Number(row.tickets),
      }));

      return { competition: comp, leaderboard };
    }),

  // ── AGENT: submit a booking reference entry ───────────────────────────────
  submitEntry: protectedProcedure
    .input(
      z.object({
        competitionId: z.number(),
        bookingReference: z.string().min(1).max(100).trim(),
        bookingDate: z.string(), // ISO date string from client
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const comp = await getCompetitionOrThrow(input.competitionId);

      if (comp.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This competition is not currently active." });
      }

      const bookingDate = new Date(input.bookingDate);
      if (isNaN(bookingDate.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid booking date." });
      }

      // Validate booking date is within competition window
      const startDate = new Date(comp.startDate);
      const endDate = new Date(comp.endDate);
      // Set end of day for endDate comparison
      endDate.setHours(23, 59, 59, 999);

      if (bookingDate < startDate || bookingDate > endDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Booking date must be between ${startDate.toLocaleDateString("en-GB")} and ${endDate.toLocaleDateString("en-GB")}.`,
        });
      }

      // Check for duplicate booking reference within this competition
      const [existing] = await db
        .select({ id: competitionEntries.id })
        .from(competitionEntries)
        .where(
          and(
            eq(competitionEntries.competitionId, input.competitionId),
            eq(competitionEntries.bookingReference, input.bookingReference.toUpperCase())
          )
        );

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This booking reference has already been submitted for this competition.",
        });
      }

      await db.insert(competitionEntries).values({
        competitionId: input.competitionId,
        agentId: ctx.user.id,
        bookingReference: input.bookingReference.toUpperCase(),
        bookingDate,
        submittedAt: new Date(),
        verifiedStatus: "pending",
      });

      return { success: true };
    }),

  // ── AGENT: get own entries for a competition ──────────────────────────────
  myEntries: protectedProcedure
    .input(z.object({ competitionId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(competitionEntries)
        .where(
          and(
            eq(competitionEntries.competitionId, input.competitionId),
            eq(competitionEntries.agentId, ctx.user.id)
          )
        )
        .orderBy(desc(competitionEntries.submittedAt));
      return rows;
    }),

  // ── AGENT: get own ticket summary across all active competitions ──────────
  myTicketSummary: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const activeComps = await db
      .select()
      .from(competitions)
      .where(eq(competitions.status, "active"));

    if (activeComps.length === 0) return [];

    const compIds = activeComps.map((c: typeof competitions.$inferSelect) => c.id);

    const approvedCounts = await db
      .select({
        competitionId: competitionEntries.competitionId,
        approved: sql<number>`SUM(CASE WHEN ${competitionEntries.verifiedStatus} = 'approved' THEN 1 ELSE 0 END)`.as("approved"),
        pending: sql<number>`SUM(CASE WHEN ${competitionEntries.verifiedStatus} = 'pending' THEN 1 ELSE 0 END)`.as("pending"),
      })
      .from(competitionEntries)
      .where(
        and(
          inArray(competitionEntries.competitionId, compIds),
          eq(competitionEntries.agentId, ctx.user.id)
        )
      )
      .groupBy(competitionEntries.competitionId);

    const countMap: Record<number, { approved: number; pending: number }> = {};
    for (const row of approvedCounts) {
      countMap[row.competitionId] = {
        approved: Number(row.approved),
        pending: Number(row.pending),
      };
    }

    return activeComps.map((comp: typeof competitions.$inferSelect) => ({
      competition: comp,
      approvedTickets: countMap[comp.id]?.approved ?? 0,
      pendingTickets: countMap[comp.id]?.pending ?? 0,
    }));
  }),

  // ── ADMIN: list all competitions ──────────────────────────────────────────
  adminListAll: protectedProcedure.query(async ({ ctx }) => {
    if (!isAdmin(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) return [];
    return db.select().from(competitions).orderBy(desc(competitions.createdAt));
  }),

  // ── ADMIN: create competition ─────────────────────────────────────────────
  adminCreate: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        prizeDescription: z.string().min(1).max(255),
        startDate: z.string(),
        endDate: z.string(),
        status: z.enum(["draft", "active", "closed"]).default("draft"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!isAdmin(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid dates." });
      }
      if (endDate <= startDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End date must be after start date." });
      }
      const [result] = await db.insert(competitions).values({
        title: input.title,
        description: input.description ?? null,
        prizeDescription: input.prizeDescription,
        startDate,
        endDate,
        status: input.status,
        createdById: ctx.user.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { id: (result as any).insertId };
    }),

  // ── ADMIN: update competition ─────────────────────────────────────────────
  adminUpdate: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        prizeDescription: z.string().min(1).max(255).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.enum(["draft", "active", "closed"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!isAdmin(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await getCompetitionOrThrow(input.id);
      const updates: Partial<typeof competitions.$inferInsert> = {};
      if (input.title !== undefined) updates.title = input.title;
      if (input.description !== undefined) updates.description = input.description;
      if (input.prizeDescription !== undefined) updates.prizeDescription = input.prizeDescription;
      if (input.startDate !== undefined) updates.startDate = new Date(input.startDate);
      if (input.endDate !== undefined) updates.endDate = new Date(input.endDate);
      if (input.status !== undefined) updates.status = input.status;
      await db.update(competitions).set(updates).where(eq(competitions.id, input.id));
      return { success: true };
    }),

  // ── ADMIN: list entries for a competition ─────────────────────────────────
  adminListEntries: protectedProcedure
    .input(z.object({ competitionId: z.number() }))
    .query(async ({ input, ctx }) => {
      if (!isAdmin(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return [];
      const entries = await db
        .select({
          entry: competitionEntries,
          agentName: users.name,
          agentEmail: users.email,
        })
        .from(competitionEntries)
        .leftJoin(users, eq(competitionEntries.agentId, users.id))
        .where(eq(competitionEntries.competitionId, input.competitionId))
        .orderBy(desc(competitionEntries.submittedAt));
      return entries;
    }),

  // ── ADMIN: verify (approve/reject) an entry ───────────────────────────────
  adminVerifyEntry: protectedProcedure
    .input(
      z.object({
        entryId: z.number(),
        status: z.enum(["approved", "rejected"]),
        adminNotes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!isAdmin(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(competitionEntries)
        .set({
          verifiedStatus: input.status,
          verifiedById: ctx.user.id,
          verifiedAt: new Date(),
          adminNotes: input.adminNotes ?? null,
        })
        .where(eq(competitionEntries.id, input.entryId));
      return { success: true };
    }),

  // ── ADMIN: bulk approve entries ───────────────────────────────────────────
  adminBulkApprove: protectedProcedure
    .input(z.object({ entryIds: z.array(z.number()).min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (!isAdmin(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(competitionEntries)
        .set({
          verifiedStatus: "approved",
          verifiedById: ctx.user.id,
          verifiedAt: new Date(),
        })
        .where(inArray(competitionEntries.id, input.entryIds));
      return { success: true, count: input.entryIds.length };
    }),

  // ── ADMIN: delete an entry ────────────────────────────────────────────────
  adminDeleteEntry: protectedProcedure
    .input(z.object({ entryId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (!isAdmin(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(competitionEntries).where(eq(competitionEntries.id, input.entryId));
      return { success: true };
    }),

  // ── ADMIN: export entries as weighted draw list ───────────────────────────
  // Returns one row per approved entry (so the list can be used directly for a draw)
  adminExportEntries: protectedProcedure
    .input(z.object({ competitionId: z.number() }))
    .query(async ({ input, ctx }) => {
      if (!isAdmin(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return [];
      const entries = await db
        .select({
          entryId: competitionEntries.id,
          bookingReference: competitionEntries.bookingReference,
          bookingDate: competitionEntries.bookingDate,
          submittedAt: competitionEntries.submittedAt,
          verifiedStatus: competitionEntries.verifiedStatus,
          adminNotes: competitionEntries.adminNotes,
          agentId: users.id,
          agentName: users.name,
          agentEmail: users.email,
        })
        .from(competitionEntries)
        .leftJoin(users, eq(competitionEntries.agentId, users.id))
        .where(
          and(
            eq(competitionEntries.competitionId, input.competitionId),
            eq(competitionEntries.verifiedStatus, "approved")
          )
        )
        .orderBy(asc(users.name));
      return entries;
    }),
});
