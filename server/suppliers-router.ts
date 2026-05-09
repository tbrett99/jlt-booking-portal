/**
 * Supplier Directory tRPC router
 * Handles supplier CRUD, stage-based credential access, and agent stage management.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import {
  suppliers,
  agentSupplierStages,
} from "../drizzle/schema";
import { eq, like, or, and, asc, desc, sql } from "drizzle-orm";

// ─── Helper: get agent's current stage ───────────────────────────────────────
async function getAgentStage(userId: number): Promise<number> {
  const { getDb } = await import("./db");
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  const rows = await db
    .select({ stage: agentSupplierStages.stage })
    .from(agentSupplierStages)
    .where(eq(agentSupplierStages.userId, userId))
    .limit(1);
  return rows[0]?.stage ?? 1;
}

// ─── Helper: strip credentials based on stage ────────────────────────────────
function applyStageFilter(
  supplier: typeof suppliers.$inferSelect,
  agentStage: number,
  isAdmin: boolean
) {
  if (isAdmin) return supplier; // admins see everything
  const canSeeCredentials = agentStage >= supplier.credentialStage;
  return {
    ...supplier,
    loginUsername: canSeeCredentials ? supplier.loginUsername : null,
    loginPassword: canSeeCredentials ? supplier.loginPassword : null,
    agencyId: canSeeCredentials ? supplier.agencyId : null,
    tradeWebsite: canSeeCredentials ? supplier.tradeWebsite : null,
    adminUsername: null,  // agents never see admin credentials
    adminPassword: null,
    adminNotes: null,
  };
}

export const suppliersRouter = router({
  // ── List suppliers (with search/filter) ────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        category: z.string().optional(),
        location: z.string().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(24),
      })
    )
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.user.role === "admin";
      const agentStage = isAdmin ? 3 : await getAgentStage(ctx.user.id);

      const conditions = [eq(suppliers.isActive, 1)];

      if (input.search) {
        const term = `%${input.search}%`;
        conditions.push(
          or(
            like(suppliers.name, term),
            like(suppliers.description, term),
            like(suppliers.categories, term),
            like(suppliers.accountManager, term)
          )!
        );
      }

      if (input.category) {
        conditions.push(like(suppliers.categories, `%${input.category}%`));
      }

      if (input.location) {
        conditions.push(like(suppliers.locations, `%${input.location}%`));
      }

      const offset = (input.page - 1) * input.pageSize;

        const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(suppliers)
          .where(and(...conditions))
          .orderBy(asc(suppliers.sortOrder), asc(suppliers.name))
          .limit(input.pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(suppliers)
          .where(and(...conditions)),
      ]);

      const total = Number(countResult[0]?.count ?? 0);

      return {
        suppliers: rows.map((s: typeof suppliers.$inferSelect) => applyStageFilter(s, agentStage, isAdmin)),
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
        agentStage,
      };
    }),

  // ── Get single supplier ─────────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.user.role === "admin";
      const agentStage = isAdmin ? 3 : await getAgentStage(ctx.user.id);

      const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, input.id), eq(suppliers.isActive, 1)))
        .limit(1);

      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return applyStageFilter(rows[0], agentStage, isAdmin);
    }),

  // ── Get all unique categories ───────────────────────────────────────────────
  categories: protectedProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .select({ categories: suppliers.categories })
      .from(suppliers)
      .where(eq(suppliers.isActive, 1));

    const cats = new Set<string>();
    for (const row of rows) {
      if (row.categories) {
        row.categories.split(";").forEach((c: string) => {
          const t = c.trim();
          if (t) cats.add(t);
        });
      }
    }
    return Array.from(cats).sort();
  }),

  // ── Get all unique locations ────────────────────────────────────────────────
  locations: protectedProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .select({ locations: suppliers.locations })
      .from(suppliers)
      .where(eq(suppliers.isActive, 1));

    const locs = new Set<string>();
    for (const row of rows) {
      if (row.locations) {
        row.locations.split(";").forEach((l: string) => {
          const t = l.trim();
          if (t) locs.add(t);
        });
      }
    }
    return Array.from(locs).sort();
  }),

  // ── Get all suppliers for dropdown (name + id only) ─────────────────────────
  dropdown: protectedProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        categories: suppliers.categories,
        imageUrl: suppliers.imageUrl,
      })
      .from(suppliers)
      .where(eq(suppliers.isActive, 1))
      .orderBy(asc(suppliers.name));
  }),

  // ── Admin: Create supplier ──────────────────────────────────────────────────
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        shortDescription: z.string().optional(),
        publicWebsite: z.string().optional(),
        tradeWebsite: z.string().optional(),
        additionalWebsite: z.string().optional(),
        agencyId: z.string().optional(),
        loginUsername: z.string().optional(),
        loginPassword: z.string().optional(),
        commission: z.string().optional(),
        facebookUrl: z.string().optional(),
        accountManager: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        generalNotes: z.string().optional(),
        video1: z.string().optional(),
        video2: z.string().optional(),
        video3: z.string().optional(),
        categories: z.string().optional(),
        locations: z.string().optional(),
        imageUrl: z.string().optional(),
        adminUsername: z.string().optional(),
        adminPassword: z.string().optional(),
        adminNotes: z.string().optional(),
        credentialStage: z.number().int().min(1).max(3).default(2),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [result] = await db.insert(suppliers).values({
        ...input,
        isActive: 1,
        sortOrder: 0,
      });
      return { id: (result as any).insertId };
    }),

  // ── Admin: Update supplier ──────────────────────────────────────────────────
  update: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        shortDescription: z.string().optional(),
        publicWebsite: z.string().optional(),
        tradeWebsite: z.string().optional(),
        additionalWebsite: z.string().optional(),
        agencyId: z.string().optional(),
        loginUsername: z.string().optional(),
        loginPassword: z.string().optional(),
        commission: z.string().optional(),
        facebookUrl: z.string().optional(),
        accountManager: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        generalNotes: z.string().optional(),
        video1: z.string().optional(),
        video2: z.string().optional(),
        video3: z.string().optional(),
        categories: z.string().optional(),
        locations: z.string().optional(),
        imageUrl: z.string().optional(),
        adminUsername: z.string().optional(),
        adminPassword: z.string().optional(),
        adminNotes: z.string().optional(),
        credentialStage: z.number().int().min(1).max(3).optional(),
        isActive: z.number().int().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { id, ...data } = input;
      await db.update(suppliers).set(data).where(eq(suppliers.id, id));
      return { ok: true };
    }),

  // ── Admin: Delete supplier (soft delete) ────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .update(suppliers)
        .set({ isActive: 0 })
        .where(eq(suppliers.id, input.id));
      return { ok: true };
    }),

  // ── Get agent's supplier stage ──────────────────────────────────────────────
  getAgentStage: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      // Agents can only query their own stage; admins can query any
      if (ctx.user.role !== "admin" && ctx.user.id !== input.userId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const stage = await getAgentStage(input.userId);
      return { stage };
    }),

  // ── Admin: Set agent's supplier stage ──────────────────────────────────────
  setAgentStage: adminProcedure
    .input(
      z.object({
        userId: z.number().int(),
        stage: z.number().int().min(1).max(3),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Upsert: delete existing then insert
      await db
        .delete(agentSupplierStages)
        .where(eq(agentSupplierStages.userId, input.userId));
      await db.insert(agentSupplierStages).values({
        userId: input.userId,
        stage: input.stage,
        unlockedById: ctx.user.id,
      });
      return { ok: true };
    }),

  // ── Admin: Get stage for a specific agent ──────────────────────────────────────────
  getAgentStageFor: adminProcedure
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select({ stage: agentSupplierStages.stage })
        .from(agentSupplierStages)
        .where(eq(agentSupplierStages.userId, input.userId))
        .limit(1);
      return { stage: rows[0]?.stage ?? 1 };
    }),

  // ── Admin: Get all agents with their stages ───────────────────────────────────────────────
  allAgentStages: adminProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db
      .select()
      .from(agentSupplierStages)
      .orderBy(desc(agentSupplierStages.unlockedAt));
  }),
});
