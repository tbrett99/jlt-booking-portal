/**
 * Friends & Family Voucher Router
 *
 * Procedures:
 *   fnf.getBalance          — agent: get own voucher balance + renewal date
 *   fnf.getBalanceForAgent  — admin: get balance for any agent
 *   fnf.applyToBooking      — agent/admin: apply a voucher to a booking
 *   fnf.removeFromBooking   — admin only: remove a voucher from a booking (returns it)
 *   fnf.topUp               — admin only: grant extra vouchers to an agent
 *   fnf.getUseLog           — admin: full audit log for an agent
 *   fnf.seedAllAgents       — admin: seed all existing agents with renewal 1 Jun 2027 (idempotent)
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admins only" });
  }
  return next({ ctx });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getActiveAllocation(db: any, agentId: number) {
  const {
    fnfVoucherAllocations,
    fnfVoucherUses,
  } = await import("../drizzle/schema");
  const { eq, and, isNull, desc } = await import("drizzle-orm");

  const now = new Date();

  // Get the most recent allocation for this agent (filter expiry in JS to avoid timezone issues)
  const allocs = await db
    .select()
    .from(fnfVoucherAllocations)
    .where(eq(fnfVoucherAllocations.agentId, agentId))
    .orderBy(desc(fnfVoucherAllocations.renewsAt))
    .limit(5);

  // Find the first non-expired allocation
  const alloc = allocs.find((a: any) => {
    const renewsAt = a.renewsAt instanceof Date ? a.renewsAt : new Date(a.renewsAt);
    return renewsAt > now;
  });

  if (!alloc) return null;

  // Count active uses (not removed) against this allocation
  const uses = await db
    .select()
    .from(fnfVoucherUses)
    .where(
      and(
        eq(fnfVoucherUses.allocationId, alloc.id),
        isNull(fnfVoucherUses.removedAt),
      )
    );

  return {
    allocation: alloc,
    used: uses.length,
    remaining: alloc.totalGranted - uses.length,
    uses,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

/** Standalone helper — call from other routers (e.g. create booking) */
export async function applyFnfVoucherToBooking(bookingId: number, appliedById: number, appliedByName: string): Promise<{ remaining: number }> {
  const { getDb } = await import('./db');
  const db = await getDb();
  if (!db) throw new Error('DB unavailable');
  const { bookings, fnfVoucherUses } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) throw new Error('Booking not found');
  if (booking.fnfVoucherUsed) throw new Error('Voucher already applied');
  const result = await getActiveAllocation(db, booking.agentId);
  if (!result || result.remaining <= 0) throw new Error('No F&F vouchers remaining');
  await db.insert(fnfVoucherUses).values({ allocationId: result.allocation.id, agentId: booking.agentId, bookingId, appliedById });
  await db.update(bookings).set({ fnfVoucherUsed: true } as any).where(eq(bookings.id, bookingId));
  return { remaining: result.remaining - 1 };
}

export const fnfRouter = router({
  /** Agent: get own balance */
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const result = await getActiveAllocation(db, ctx.user.id);
    if (!result) {
      return { hasAllocation: false, totalGranted: 0, used: 0, remaining: 0, renewsAt: null };
    }
    return {
      hasAllocation: true,
      totalGranted: result.allocation.totalGranted,
      used: result.used,
      remaining: result.remaining,
      renewsAt: result.allocation.renewsAt,
    };
  }),

  /** Admin: get balance for any agent */
  getBalanceForAgent: adminProcedure
    .input(z.object({ agentId: z.number().int() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Debug: log raw rows from DB so we can diagnose production issues
      try {
        const { fnfVoucherAllocations } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const rawRows = await db.select().from(fnfVoucherAllocations).where(eq(fnfVoucherAllocations.agentId, input.agentId));
        console.log(`[FnF Debug] agentId=${input.agentId} rawRows=${JSON.stringify(rawRows)} serverNow=${new Date().toISOString()}`);
      } catch (e: any) {
        console.log(`[FnF Debug] raw query failed: ${e?.message}`);
      }

      const result = await getActiveAllocation(db, input.agentId);
      if (!result) {
        return { hasAllocation: false, totalGranted: 0, used: 0, remaining: 0, renewsAt: null };
      }
      return {
        hasAllocation: true,
        totalGranted: result.allocation.totalGranted,
        used: result.used,
        remaining: result.remaining,
        renewsAt: result.allocation.renewsAt,
      };
    }),

  /** Agent or Admin: apply a voucher to a booking */
  applyToBooking: protectedProcedure
    .input(z.object({ bookingId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { bookings, fnfVoucherUses } = await import("../drizzle/schema");
      const { eq, and, isNull } = await import("drizzle-orm");

      // Load booking
      const [booking] = await db.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });

      // Determine which agent owns this booking
      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "super_admin";
      if (!isAdmin && booking.agentId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
      }

      // Check not already applied
      if (booking.fnfVoucherUsed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A Friends & Family voucher is already applied to this booking" });
      }

      // Get the agent's active allocation
      const agentId = booking.agentId;
      const result = await getActiveAllocation(db, agentId);
      if (!result || result.remaining <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No Friends & Family vouchers remaining for this agent" });
      }

      // Record the use
      await db.insert(fnfVoucherUses).values({
        allocationId: result.allocation.id,
        agentId,
        bookingId: input.bookingId,
        appliedById: ctx.user.id,
      });

      // Flag the booking
      await db.update(bookings).set({ fnfVoucherUsed: true }).where(eq(bookings.id, input.bookingId));

      return { success: true, remaining: result.remaining - 1 };
    }),

  /** Admin only: remove a voucher from a booking (returns it to the agent's balance) */
  removeFromBooking: adminProcedure
    .input(z.object({ bookingId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { bookings, fnfVoucherUses } = await import("../drizzle/schema");
      const { eq, and, isNull } = await import("drizzle-orm");

      const [booking] = await db.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
      if (!booking.fnfVoucherUsed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No voucher applied to this booking" });
      }

      // Find the active use record
      const [use] = await db
        .select()
        .from(fnfVoucherUses)
        .where(
          and(
            eq(fnfVoucherUses.bookingId, input.bookingId),
            isNull(fnfVoucherUses.removedAt),
          )
        )
        .limit(1);

      if (use) {
        await db
          .update(fnfVoucherUses)
          .set({ removedAt: new Date(), removedById: ctx.user.id })
          .where(eq(fnfVoucherUses.id, use.id));
      }

      // Unflag the booking
      await db.update(bookings).set({ fnfVoucherUsed: false }).where(eq(bookings.id, input.bookingId));

      return { success: true };
    }),

  /** Admin only: top-up vouchers for an agent (one-off extra grant) */
  topUp: adminProcedure
    .input(z.object({
      agentId: z.number().int(),
      count: z.number().int().min(1).max(20),
      renewsAt: z.string(), // ISO date string e.g. "2027-06-01"
      note: z.string().max(255).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { fnfVoucherAllocations } = await import("../drizzle/schema");

      await db.insert(fnfVoucherAllocations).values({
        agentId: input.agentId,
        totalGranted: input.count,
        renewsAt: new Date(input.renewsAt),
        createdById: ctx.user.id,
        note: input.note ?? `Manual top-up by admin`,
      });

      return { success: true };
    }),

  /** Admin: full audit log for an agent */
  getUseLog: adminProcedure
    .input(z.object({ agentId: z.number().int() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { fnfVoucherUses, fnfVoucherAllocations, bookings, users } = await import("../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");

      const uses = await db
        .select({
          id: fnfVoucherUses.id,
          bookingId: fnfVoucherUses.bookingId,
          clientName: bookings.clientName,
          topdogRef: bookings.topdogRef,
          appliedAt: fnfVoucherUses.appliedAt,
          appliedByName: users.name,
          removedAt: fnfVoucherUses.removedAt,
          allocationRenewsAt: fnfVoucherAllocations.renewsAt,
        })
        .from(fnfVoucherUses)
        .innerJoin(bookings, eq(bookings.id, fnfVoucherUses.bookingId))
        .innerJoin(fnfVoucherAllocations, eq(fnfVoucherAllocations.id, fnfVoucherUses.allocationId))
        .leftJoin(users, eq(users.id, fnfVoucherUses.appliedById))
        .where(eq(fnfVoucherUses.agentId, input.agentId))
        .orderBy(desc(fnfVoucherUses.appliedAt));

      return uses;
    }),

  /** Admin: seed all existing agents with a 1 Jun 2027 allocation (idempotent) */
  seedExistingAgents: adminProcedure.mutation(async ({ ctx }) => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const { users, fnfVoucherAllocations } = await import("../drizzle/schema");
    const { eq, inArray } = await import("drizzle-orm");

    const renewsAt = new Date("2027-06-01T00:00:00.000Z");

    // Get all active agents
    const agents = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "agent"));

    // Get agents who already have an allocation
    const existing = await db
      .select({ agentId: fnfVoucherAllocations.agentId })
      .from(fnfVoucherAllocations);
    const existingIds = new Set(existing.map((e: any) => e.agentId));

    const toSeed = agents.filter((a: any) => !existingIds.has(a.id));

    if (toSeed.length > 0) {
      await db.insert(fnfVoucherAllocations).values(
        toSeed.map((a: any) => ({
          agentId: a.id,
          totalGranted: 2,
          renewsAt,
          createdById: ctx.user.id,
          note: "Initial allocation — existing agents (renews 1 Jun 2027)",
        }))
      );
    }

    return { seeded: toSeed.length, alreadyHad: existingIds.size };
  }),
});
