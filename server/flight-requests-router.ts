import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, asc, count } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { flightRequests, bookings, users } from "../drizzle/schema";
import { createInAppNotification, createNote } from "./db";
import { sendNotificationEmail } from "./email";

export const flightRequestsRouter = router({
  // ─── Agent: create a new flight request ──────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        requestType: z.enum(["ticketing", "cancellation", "both"]),
        supplier: z.enum(["Aviate", "Lime", "VA Flight Store"]),
        // Ticketing fields (also used as the primary set for single-type requests)
        pnr: z.string().min(1).max(50),
        departureDate: z.date(),
        ticketingDeadline: z.date(),
        // Flight cost fields
        flightCost: z.number().min(0).optional(),
        // Cancellation-specific fields (required when requestType = 'both')
        cancellationPnr: z.string().max(50).optional(),
        cancellationDepartureDate: z.date().optional(),
        cancellationTicketingDeadline: z.date().optional(),
        cancellationFlightCost: z.number().min(0).optional(),
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
      if (input.requestType === "both") {
        if (!input.cancellationPnr || !input.cancellationDepartureDate || !input.cancellationTicketingDeadline) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cancellation PNR, departure date and ticketing deadline are required when request type is Both." });
        }
      }
      const result = await db.insert(flightRequests).values({
        bookingId: input.bookingId,
        agentId: ctx.user.id,
        requestType: input.requestType,
        supplier: input.supplier,
        pnr: input.pnr,
        departureDate: input.departureDate,
        ticketingDeadline: input.ticketingDeadline,
        flightCost: input.flightCost != null ? String(input.flightCost) : null,
        cancellationPnr: input.cancellationPnr ?? null,
        cancellationDepartureDate: input.cancellationDepartureDate ?? null,
        cancellationTicketingDeadline: input.cancellationTicketingDeadline ?? null,
        cancellationFlightCost: input.cancellationFlightCost != null ? String(input.cancellationFlightCost) : null,
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
        cancellationPnr: flightRequests.cancellationPnr,
        cancellationDepartureDate: flightRequests.cancellationDepartureDate,
        cancellationTicketingDeadline: flightRequests.cancellationTicketingDeadline,
        status: flightRequests.status,
        cancellationStatus: flightRequests.cancellationStatus,
        invoiceAddedToPts: flightRequests.invoiceAddedToPts,
        queryMessage: flightRequests.queryMessage,
        flightCost: flightRequests.flightCost,
        priceIncreaseAmount: flightRequests.priceIncreaseAmount,
        priceIncreaseNote: flightRequests.priceIncreaseNote,
        priceIncreaseNotifiedAt: flightRequests.priceIncreaseNotifiedAt,
        priceIncreaseAcceptedAt: flightRequests.priceIncreaseAcceptedAt,
        priceIncreaseDeclinedAt: flightRequests.priceIncreaseDeclinedAt,
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
        flightCost: flightRequests.flightCost,
        cancellationPnr: flightRequests.cancellationPnr,
        cancellationDepartureDate: flightRequests.cancellationDepartureDate,
        cancellationTicketingDeadline: flightRequests.cancellationTicketingDeadline,
        cancellationFlightCost: flightRequests.cancellationFlightCost,
        status: flightRequests.status,
        cancellationStatus: flightRequests.cancellationStatus,
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

  // ─── Admin: count pending flight requests (for dashboard) ───────────────
  pendingCount: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const [row] = await db
      .select({ count: count() })
      .from(flightRequests)
      .where(eq(flightRequests.status, "pending"));
    return (row?.count as number) ?? 0;
  }),

  // ─── Admin: update status ────────────────────────────────────────────────
  updateStatus: adminProcedure
    .input(
      z.object({
        id: z.number(),
        // For 'both' requests, 'status' = ticketing status, 'cancellationStatus' = cancellation status
        status: z.enum(["pending", "ticketed", "cancelled", "query", "completed"]).optional(),
        cancellationStatus: z.enum(["pending", "cancelled"]).optional(),
        queryMessage: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [req] = await db
        .select({
          id: flightRequests.id,
          agentId: flightRequests.agentId,
          bookingId: flightRequests.bookingId,
          pnr: flightRequests.pnr,
          cancellationPnr: flightRequests.cancellationPnr,
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

      // Build the update object — only update fields that were provided
      const updateFields: Record<string, unknown> = {};
      if (input.status !== undefined) {
        updateFields.status = input.status;
        if (input.status === "query") {
          updateFields.queryMessage = input.queryMessage;
        } else {
          updateFields.queryMessage = null;
        }
      }
      if (input.cancellationStatus !== undefined) {
        updateFields.cancellationStatus = input.cancellationStatus;
      }

      if (Object.keys(updateFields).length > 0) {
        await db
          .update(flightRequests)
          .set(updateFields)
          .where(eq(flightRequests.id, input.id));
      }

      // Notify agent based on what changed
      const notifications: string[] = [];
      if (input.status === "ticketed") {
        notifications.push(`Your ticketing request for "${req.clientName}" (PNR: ${req.pnr}) has been ticketed.`);
      } else if (input.status === "cancelled" && req.requestType !== "both") {
        notifications.push(`Your cancellation request for "${req.clientName}" (PNR: ${req.pnr}) has been cancelled.`);
      } else if (input.status === "query") {
        notifications.push(`Admin has a query on your flight request for "${req.clientName}" (PNR: ${req.pnr}): ${input.queryMessage}`);
      }
      if (input.cancellationStatus === "cancelled" && req.requestType === "both") {
        const cancelPnr = req.cancellationPnr ?? req.pnr;
        notifications.push(`Your cancellation request for "${req.clientName}" (PNR: ${cancelPnr}) has been cancelled.`);
      }

      for (const notifMessage of notifications) {
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
              requestType: req.requestType === "both" ? "Ticketing & Cancellation" : req.requestType,
              status: input.status ?? input.cancellationStatus ?? "",
              message: input.queryMessage ?? "",
            },
            bookingId: req.bookingId,
          });
        }
      }

      // If this is a query, write the message as a shared note on the booking (visible in Messages tab)
      if (input.status === "query" && input.queryMessage?.trim() && req.bookingId) {
        await createNote({
          bookingId: req.bookingId,
          authorId: ctx.user.id,
          content: `[Flight Query] ${input.queryMessage.trim()}`,
          isInternal: false,
        });
      }

      const [updated] = await db
        .select()
        .from(flightRequests)
        .where(eq(flightRequests.id, input.id));
      return updated;
    }),

  // ─── Admin: notify agent of a price increase ──────────────────────────────
  notifyPriceIncrease: adminProcedure
    .input(
      z.object({
        id: z.number(),
        newPrice: z.number().min(0),        // new total flight cost quoted by supplier
        note: z.string().optional(),        // optional context note for the agent
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [req] = await db
        .select({
          id: flightRequests.id,
          agentId: flightRequests.agentId,
          bookingId: flightRequests.bookingId,
          pnr: flightRequests.pnr,
          flightCost: flightRequests.flightCost,
          status: flightRequests.status,
          clientName: bookings.clientName,
          agentName: users.name,
          agentEmail: users.email,
        })
        .from(flightRequests)
        .innerJoin(bookings, eq(flightRequests.bookingId, bookings.id))
        .innerJoin(users, eq(flightRequests.agentId, users.id))
        .where(eq(flightRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      const originalPrice = Number(req.flightCost ?? 0);
      const increase = input.newPrice - originalPrice;

      // Update the flight request with price increase details and set status to price_increase_pending
      await db
        .update(flightRequests)
        .set({
          priceIncreaseAmount: String(input.newPrice),
          priceIncreaseNote: input.note ?? null,
          priceIncreaseNotifiedAt: new Date(),
          priceIncreaseAcceptedAt: null,
          priceIncreaseAcceptedBy: null,
          priceIncreaseDeclinedAt: null,
          status: "price_increase_pending",
        } as any)
        .where(eq(flightRequests.id, input.id));

      // Send urgent in-app notification to agent
      const increaseFormatted = `£${increase.toFixed(2)}`;
      const newPriceFormatted = `£${input.newPrice.toFixed(2)}`;
      const notifMessage = `⚠️ Price increase on your flight request for "${req.clientName}" (PNR: ${req.pnr}). The price has increased by ${increaseFormatted} to ${newPriceFormatted}. Please review and accept or decline.`;

      await createInAppNotification({
        userId: req.agentId,
        bookingId: req.bookingId,
        message: notifMessage,
        linkUrl: `/bookings/${req.bookingId}`,
        isUrgent: true,
      });

      // Also send email notification
      if (req.agentEmail) {
        await sendNotificationEmail({
          triggerKey: "flight_price_increase",
          toEmail: req.agentEmail,
          toName: req.agentName ?? "Agent",
          variables: {
            clientName: req.clientName,
            pnr: req.pnr,
            originalPrice: `£${originalPrice.toFixed(2)}`,
            newPrice: newPriceFormatted,
            increase: increaseFormatted,
            note: input.note ?? "",
          },
          bookingId: req.bookingId,
        });
      }

      // Log as a shared note on the booking
      await createNote({
        bookingId: req.bookingId,
        authorId: ctx.user.id,
        content: `[Flight Price Increase] Price for PNR ${req.pnr} has increased from £${originalPrice.toFixed(2)} to ${newPriceFormatted} (+${increaseFormatted}). Agent notified and awaiting acceptance.${input.note ? ` Note: ${input.note}` : ""}`,
        isInternal: false,
      });

      const [updated] = await db.select().from(flightRequests).where(eq(flightRequests.id, input.id));
      return updated;
    }),

  // ─── Agent: accept a price increase ─────────────────────────────────────────
  acceptPriceIncrease: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [req] = await db
        .select({
          id: flightRequests.id,
          agentId: flightRequests.agentId,
          bookingId: flightRequests.bookingId,
          pnr: flightRequests.pnr,
          priceIncreaseAmount: flightRequests.priceIncreaseAmount,
          status: flightRequests.status,
          clientName: bookings.clientName,
        })
        .from(flightRequests)
        .innerJoin(bookings, eq(flightRequests.bookingId, bookings.id))
        .where(eq(flightRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role === "agent" && req.agentId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (req.status !== "price_increase_pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No pending price increase on this request." });
      }

      const now = new Date();
      // Accept: update flightCost to the new price, clear increase fields, revert to pending
      await db
        .update(flightRequests)
        .set({
          flightCost: req.priceIncreaseAmount,  // update the agreed price
          priceIncreaseAcceptedAt: now,
          priceIncreaseAcceptedBy: ctx.user.id,
          priceIncreaseDeclinedAt: null,
          status: "pending",  // back to pending so admin can proceed with ticketing
        } as any)
        .where(eq(flightRequests.id, input.id));

      // Log acceptance as a note
      await createNote({
        bookingId: req.bookingId,
        authorId: ctx.user.id,
        content: `[Flight Price Increase Accepted] ${ctx.user.name ?? "Agent"} accepted the price increase for PNR ${req.pnr}. New agreed price: £${Number(req.priceIncreaseAmount ?? 0).toFixed(2)}.`,
        isInternal: false,
      });

      const [updated] = await db.select().from(flightRequests).where(eq(flightRequests.id, input.id));
      return updated;
    }),

  // ─── Agent: decline a price increase ────────────────────────────────────────
  declinePriceIncrease: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [req] = await db
        .select({
          id: flightRequests.id,
          agentId: flightRequests.agentId,
          bookingId: flightRequests.bookingId,
          pnr: flightRequests.pnr,
          status: flightRequests.status,
          clientName: bookings.clientName,
        })
        .from(flightRequests)
        .innerJoin(bookings, eq(flightRequests.bookingId, bookings.id))
        .where(eq(flightRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role === "agent" && req.agentId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (req.status !== "price_increase_pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No pending price increase on this request." });
      }

      const now = new Date();
      await db
        .update(flightRequests)
        .set({
          priceIncreaseDeclinedAt: now,
          priceIncreaseAcceptedAt: null,
          status: "query",  // move to query so admin is alerted
          queryMessage: `Agent declined the price increase for PNR ${req.pnr}.`,
        } as any)
        .where(eq(flightRequests.id, input.id));

      // Log decline as a note
      await createNote({
        bookingId: req.bookingId,
        authorId: ctx.user.id,
        content: `[Flight Price Increase Declined] ${ctx.user.name ?? "Agent"} declined the price increase for PNR ${req.pnr}. Please contact the agent to discuss next steps.`,
        isInternal: false,
      });

      const [updated] = await db.select().from(flightRequests).where(eq(flightRequests.id, input.id));
      return updated;
    }),

  // ─── Admin: delete a flight request ──────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [req] = await db
        .select({ id: flightRequests.id })
        .from(flightRequests)
        .where(eq(flightRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Flight request not found" });
      await db.delete(flightRequests).where(eq(flightRequests.id, input.id));
      return { success: true };
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
