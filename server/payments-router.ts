import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { paymentLinks, bookings, users } from "../drizzle/schema";
import { buildPpsSignature } from "./pps-signature";
import { ENV } from "./_core/env";
import { randomUUID } from "crypto";

// ─── Payments Router ──────────────────────────────────────────────────────────

export const paymentsRouter = router({
  // ─── Admin: create a payment link ──────────────────────────────────────────
  createLink: adminProcedure
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

      // Fetch booking to get PTS ref
      const [booking] = await db
        .select({ id: bookings.id, ptsRef: bookings.ptsRef, clientName: bookings.clientName, agentId: bookings.agentId })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId));

      if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });

      const ptsRef = booking.ptsRef ?? `JLT-${booking.id}`;
      const amountPence = Math.round(parseFloat(input.amountPounds) * 100);
      if (amountPence <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Amount must be greater than 0" });

      const merchantId = ENV.ppsLiveMode ? ENV.ppsMerchantIdLive : ENV.ppsMerchantIdTest;
      const signingSecret = ENV.ppsSigningSecret;
      const gatewayUrl = ENV.ppsGatewayUrl;

      if (!signingSecret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PPS signing secret not configured" });

      const linkId = randomUUID();
      const transactionUnique = `JLT-${Date.now()}-${linkId.slice(0, 8)}`;

      // Build the redirect and callback URLs
      const redirectUrl = `${input.origin}/payment/result`;
      const callbackUrl = `${input.origin}/api/pps/callback`;

      // Build PPS form fields — only include fields that PPS accepts.
      // callbackURL requires pre-registration in the PPS merchant account;
      // omit it until whitelisted to avoid error #00065539.
      // merchantData is a custom field not supported by default.
      const formFields: Record<string, string> = {
        merchantID: merchantId,
        action: "SALE",
        type: "1",
        currencyCode: "826",
        countryCode: "826",
        amount: String(amountPence),
        transactionUnique,
        orderRef: ptsRef,
        redirectURL: redirectUrl,
      };

      // Generate signature
      const signature = buildPpsSignature(formFields, signingSecret);
      formFields.signature = signature;

      // Persist the payment link record
      await db.insert(paymentLinks).values({
        id: linkId,
        bookingId: input.bookingId,
        createdById: ctx.user.id,
        merchantId,
        transactionUnique,
        amountPence,
        orderRef: ptsRef,
        description: ptsRef,
        redirectUrl: redirectUrl,
        callbackUrl: callbackUrl,
        status: "pending",
      });

      return {
        linkId,
        payUrl: `${input.origin}/api/pay/${linkId}`,
        gatewayUrl,
        formFields,
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
      // callbackURL and merchantData are omitted (not pre-registered with PPS).
      const formFields: Record<string, string> = {
        merchantID: link.merchantId,
        action: "SALE",
        type: "1",
        currencyCode: "826",
        countryCode: "826",
        amount: String(link.amountPence),
        transactionUnique: link.transactionUnique,
        orderRef: link.orderRef,
        redirectURL: link.redirectUrl ?? "",
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

  // ─── Admin: list payment links for a booking ───────────────────────────────
  listForBooking: adminProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
          createdByName: users.name,
        })
        .from(paymentLinks)
        .leftJoin(users, eq(paymentLinks.createdById, users.id))
        .where(eq(paymentLinks.bookingId, input.bookingId))
        .orderBy(desc(paymentLinks.createdAt));

      return links;
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
