import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, asc } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { flightRequests, bookings, users } from "../drizzle/schema";
import { createInAppNotification } from "./db";
import { sendNotificationEmail } from "./email";

export const flightRequestsRouter = router({
  // ─── Agent: create a new flight request ──────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        requestType: z.enum(["ticketing", "cancellation", "both"]),
        supplier: z.enum(["Aviate", "Lime", "VA Flight Store"]),
        pnr: z.string().min(1).max(50),
        departureDate: z.date(),
        ticketingDeadline: z.date(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Verify the booking belongs to this agent (or user is admin)
      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId));
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const result = await db.insert(flightRequests).values({
        bookingId: input.bookingId,
        agentId: ctx.user.id,
        requestType: input.requestType,
        supplier: input.supplier,
        pnr: input.pnr,
        departureDate: input.departureDate,
        ticketingDeadline: input.ticketingDeadline,
        status: "pending",
        invoiceAddedToPts: false,
      });
      const insertId = (result as any)[0]?.insertId ?? (result as any).insertId;
      const [created] = await db
        .select()
        .from(flightRequests)
        .where(eq(flightRequests.id, insertId));
      return created;
    }),

  // ─── Agent: list their own flight requests ───────────────────────────────
  myRequests: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const rows = await db
      .select({
        id: flightRequests.id,
        bookingId: flightRequests.bookingId,
        requestType: flightRequests.requestType,
        supplier: flightRequests.supplier,
        pnr: flightRequests.pnr,
        departureDate: flightRequests.departureDate,
        ticketingDeadline: flightRequests.ticketingDeadline,
        status: flightRequests.status,
        invoiceAddedToPts: flightRequests.invoiceAddedToPts,
        queryMessage: flightRequests.queryMessage,
        createdAt: flightRequests.createdAt,
        updatedAt: flightRequests.updatedAt,
        clientName: bookings.clientName,
        ptsRef: bookings.ptsRef,
        topdogRef: bookings.topdogRef,
        currentStage: bookings.currentStage,
      })
      .from(flightRequests)
      .innerJoin(bookings, eq(flightRequests.bookingId, bookings.id))
      .where(eq(flightRequests.agentId, ctx.user.id))
      .orderBy(desc(flightRequests.createdAt));
    return rows;
  }),

  // ─── Agent: list requests for a specific booking ─────────────────────────
  byBooking: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId));
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return db
        .select()
        .from(flightRequests)
        .where(eq(flightRequests.bookingId, input.bookingId))
        .orderBy(desc(flightRequests.createdAt));
    }),

  // ─── Admin: list all flight requests ────────────────────────────────────
  adminList: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const agentAlias = users;
    const rows = await db
      .select({
        id: flightRequests.id,
        bookingId: flightRequests.bookingId,
        requestType: flightRequests.requestType,
        supplier: flightRequests.supplier,
        pnr: flightRequests.pnr,
        departureDate: flightRequests.departureDate,
        ticketingDeadline: flightRequests.ticketingDeadline,
        status: flightRequests.status,
        invoiceAddedToPts: flightRequests.invoiceAddedToPts,
        queryMessage: flightRequests.queryMessage,
        createdAt: flightRequests.createdAt,
        updatedAt: flightRequests.updatedAt,
        clientName: bookings.clientName,
        ptsRef: bookings.ptsRef,
        topdogRef: bookings.topdogRef,
        currentStage: bookings.currentStage,
        agentId: flightRequests.agentId,
        agentName: agentAlias.name,
        agentEmail: agentAlias.email,
      })
      .from(flightRequests)
      .innerJoin(bookings, eq(flightRequests.bookingId, bookings.id))
      .innerJoin(agentAlias, eq(flightRequests.agentId, agentAlias.id))
      .orderBy(asc(flightRequests.createdAt)); // oldest first
    return rows;
  }),

  // ─── Admin: update status ────────────────────────────────────────────────
  updateStatus: adminProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["pending", "ticketed", "cancelled", "query"]),
        queryMessage: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [req] = await db
        .select({
          id: flightRequests.id,
          agentId: flightRequests.agentId,
          bookingId: flightRequests.bookingId,
          pnr: flightRequests.pnr,
          requestType: flightRequests.requestType,
          clientName: bookings.clientName,
          agentName: users.name,
          agentEmail: users.email,
        })
        .from(flightRequests)
        .innerJoin(bookings, eq(flightRequests.bookingId, bookings.id))
        .innerJoin(users, eq(flightRequests.agentId, users.id))
        .where(eq(flightRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      if (input.status === "query" && !input.queryMessage?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A message is required when setting status to Query." });
      }

      await db
        .update(flightRequests)
        .set({
          status: input.status,
          ...(input.status === "query" ? { queryMessage: input.queryMessage } : { queryMessage: null }),
        })
        .where(eq(flightRequests.id, input.id));

      // Notify agent
      const typeLabel = req.requestType === "both" ? "Ticketing & Cancellation" : req.requestType.charAt(0).toUpperCase() + req.requestType.slice(1);
      let notifMessage = "";
      if (input.status === "ticketed") {
        notifMessage = `Your flight ${typeLabel} request for "${req.clientName}" (PNR: ${req.pnr}) has been ticketed.`;
      } else if (input.status === "cancelled") {
        notifMessage = `Your flight ${typeLabel} request for "${req.clientName}" (PNR: ${req.pnr}) has been cancelled.`;
      } else if (input.status === "query") {
        notifMessage = `Admin has a query on your flight ${typeLabel} request for "${req.clientName}" (PNR: ${req.pnr}): ${input.queryMessage}`;
      }

      if (notifMessage) {
        await createInAppNotification({
          userId: req.agentId,
          bookingId: req.bookingId,
          message: notifMessage,
          linkUrl: `/bookings/${req.bookingId}`,
        });
        if (req.agentEmail) {
          await sendNotificationEmail({
            triggerKey: "flight_request_update",
            toEmail: req.agentEmail,
            toName: req.agentName ?? "Agent",
            variables: {
              clientName: req.clientName,
              pnr: req.pnr,
              requestType: typeLabel,
              status: input.status,
              message: input.queryMessage ?? "",
            },
            bookingId: req.bookingId,
          });
        }
      }

      const [updated] = await db
        .select()
        .from(flightRequests)
        .where(eq(flightRequests.id, input.id));
      return updated;
    }),

  // ─── Admin: toggle invoice checkbox ─────────────────────────────────────
  toggleInvoice: adminProcedure
    .input(z.object({ id: z.number(), invoiceAddedToPts: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(flightRequests)
        .set({ invoiceAddedToPts: input.invoiceAddedToPts })
        .where(eq(flightRequests.id, input.id));
      return { success: true };
    }),
});
