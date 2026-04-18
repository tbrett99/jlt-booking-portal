import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { paymentLinks, bookings, users } from "../drizzle/schema";
import { buildPpsSignature } from "./pps-signature";
import { ENV } from "./_core/env";
import { randomUUID } from "crypto";

// ─── Payments Router ──────────────────────────────────────────────────────────

export const paymentsRouter = router({
  // ─── Protected: create a payment link (admin/agent — agents restricted to own bookings) ──
  createLink: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        amountPounds: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount e.g. 150.00"),
        origin: z.string().url(), // window.location.origin from frontend
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Fetch booking to verify ownership and get PTS ref
      const [booking] = await db
        .select({ id: bookings.id, ptsRef: bookings.ptsRef, clientName: bookings.clientName, agentId: bookings.agentId })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId));

      if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });

      // Agents can only create links for their own bookings; admins/super_admins can create for any
      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "super_admin";
      if (!isAdmin && booking.agentId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only create payment links for your own bookings" });
      }

      const ptsRef = booking.ptsRef ?? `JLT-${booking.id}`;
      const amountPence = Math.round(parseFloat(input.amountPounds) * 100);
      if (amountPence <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Amount must be greater than 0" });

      const merchantId = ENV.ppsLiveMode ? ENV.ppsMerchantIdLive : ENV.ppsMerchantIdTest;
      const signingSecret = ENV.ppsSigningSecret;
      const gatewayUrl = ENV.ppsGatewayUrl;

      if (!signingSecret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PPS signing secret not configured" });

      const linkId = randomUUID();
      const transactionUnique = `JLT-${Date.now()}-${linkId.slice(0, 8)}`;

      const redirectUrl = `${input.origin}/api/pay/${linkId}/result`;
      const callbackUrl = `${input.origin}/api/pps/callback`;

      // Persist the payment link record (expires 24 hours from now)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.insert(paymentLinks).values({
        id: linkId,
        bookingId: input.bookingId,
        createdById: ctx.user.id,
        merchantId,
        transactionUnique,
        amountPence,
        orderRef: ptsRef,
        description: ptsRef,
        redirectUrl,
        callbackUrl,
        status: "pending",
        expiresAt,
      });

      return {
        linkId,
        payUrl: `${input.origin}/api/pay/${linkId}`,
        gatewayUrl,
        amountPence,
        ptsRef,
        clientName: booking.clientName,
      };
    }),

  // ─── Public: fetch link details for the /pay/:token page ──────────────────
  // No auth required — customer-facing. Returns signed form fields to auto-submit.
  getPublicLink: publicProcedure
    .input(z.object({ linkId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [link] = await db
        .select()
        .from(paymentLinks)
        .where(eq(paymentLinks.id, input.linkId));

      if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "LINK_NOT_FOUND" });
      if (link.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "LINK_CANCELLED" });
      if (link.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "LINK_ALREADY_PAID" });

      // Fetch booking client name
      const [booking] = await db
        .select({ clientName: bookings.clientName })
        .from(bookings)
        .where(eq(bookings.id, link.bookingId));

      const signingSecret = ENV.ppsSigningSecret;
      const gatewayUrl = ENV.ppsGatewayUrl;

      if (!signingSecret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PPS not configured" });

      // Rebuild the exact same form fields that were signed at creation time.
      const formFields: Record<string, string> = {
        merchantID: link.merchantId,
        action: "SALE",
        type: "1",
        currencyCode: "826",
        countryCode: "826",
        amount: String(link.amountPence),
        transactionUnique: link.transactionUnique,
        orderRef: link.orderRef,
        orderDetails: link.orderRef,
        redirectURL: link.redirectUrl ?? "",
        callbackURL: link.callbackUrl ?? "",
      };

      const signature = buildPpsSignature(formFields, signingSecret);
      formFields.signature = signature;

      return {
        gatewayUrl,
        formFields,
        amountPence: link.amountPence,
        orderRef: link.orderRef,
        clientName: booking?.clientName ?? "Your booking",
      };
    }),

  // ─── Protected: list payment links for a booking (agents see own bookings only) ──
  listForBooking: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Verify ownership for agents
      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "super_admin";
      if (!isAdmin) {
        const [booking] = await db
          .select({ agentId: bookings.agentId })
          .from(bookings)
          .where(eq(bookings.id, input.bookingId));
        if (!booking || booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only view payment links for your own bookings" });
        }
      }

      const links = await db
        .select({
          id: paymentLinks.id,
          amountPence: paymentLinks.amountPence,
          orderRef: paymentLinks.orderRef,
          status: paymentLinks.status,
          ppsTransactionId: paymentLinks.ppsTransactionId,
          ppsResponseCode: paymentLinks.ppsResponseCode,
          ppsResponseMessage: paymentLinks.ppsResponseMessage,
          createdAt: paymentLinks.createdAt,
          paidAt: paymentLinks.paidAt,
          expiresAt: paymentLinks.expiresAt,
          createdByName: users.name,
        })
        .from(paymentLinks)
        .leftJoin(users, eq(paymentLinks.createdById, users.id))
        .where(eq(paymentLinks.bookingId, input.bookingId))
        .orderBy(desc(paymentLinks.createdAt));

      return links;
    }),

  // ─── Admin: manually mark a payment link as paid (for callback failures) ────
  manualMarkPaid: adminProcedure
    .input(z.object({
      linkId: z.string(),
      transactionRef: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [link] = await db
        .select()
        .from(paymentLinks)
        .where(eq(paymentLinks.id, input.linkId));

      if (!link) throw new TRPCError({ code: "NOT_FOUND" });
      if (link.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Already marked as paid" });

      await db
        .update(paymentLinks)
        .set({
          status: "paid",
          paidAt: new Date(),
          ppsTransactionId: input.transactionRef ?? "MANUAL",
          ppsResponseCode: "0",
          ppsResponseMessage: `Manually marked paid by admin (${ctx.user.name ?? ctx.user.email})`,
        })
        .where(eq(paymentLinks.id, input.linkId));

      return { success: true };
    }),

  // ─── Admin: cancel a pending payment link ─────────────────────────────────
  cancelLink: adminProcedure
    .input(z.object({ linkId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [link] = await db
        .select({ status: paymentLinks.status })
        .from(paymentLinks)
        .where(eq(paymentLinks.id, input.linkId));

      if (!link) throw new TRPCError({ code: "NOT_FOUND" });
      if (link.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Only pending links can be cancelled" });

      await db
        .update(paymentLinks)
        .set({ status: "cancelled" })
        .where(eq(paymentLinks.id, input.linkId));

      return { success: true };
    }),
});
