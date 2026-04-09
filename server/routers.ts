import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
const { sign } = jwt;
import {
  getAllUsers,
  getUserByEmail,
  getUserById,
  createAgentUser,
  updateUserRole,
  toggleUserActive,
  updateUserPassword,
  createBooking,
  getBookingById,
  getBookingsByAgent,
  getAllBookings,
  updateBookingStage,
  updateBookingAdminFields,
  uploadReimbursementDoc,
  getPipelineHistory,
  createNote,
  getNotesByBooking,
  createAmendment,
  getAmendmentsByBooking,
  getAllAmendments,
  actionAmendment,
  createCancellation,
  getAllCancellations,
  createRefund,
  getRefundsByBooking,
  getAllRefunds,
  getNotificationTemplates,
  getNotificationTemplate,
  upsertNotificationTemplate,
  createInAppNotification,
  getInAppNotifications,
  markNotificationsRead,
  getUnreadNotificationCount,
  upsertUser,
} from "./db";
import { encryptOptional, decryptOptional } from "./encryption";
import { sendNotificationEmail, sendCredentialsEmail } from "./email";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { ENV } from "./_core/env";

// ─── Role middleware ──────────────────────────────────────────────────────────

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Super admin access required" });
  }
  return next({ ctx });
});

// ─── Default notification templates seed ─────────────────────────────────────

const DEFAULT_TEMPLATES = [
  {
    triggerKey: "not_on_topdog",
    label: "Not on Topdog",
    subject: "Action Required: Add Booking to Topdog",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Your booking for <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) has not yet been added to Topdog. Please add it within 24 hours.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
  },
  {
    triggerKey: "query",
    label: "Query",
    subject: "Query on Your Booking",
    bodyHtml: `<p>Hi {{agentName}},</p><p>We have a query regarding your booking for <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}). Please check the notes on your booking in the portal.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
  },
  {
    triggerKey: "reimb_docs_missing",
    label: "Reimbursement Docs Missing",
    subject: "Action Required: Upload Reimbursement Documents",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Reimbursement documents for booking <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) have not been uploaded. Please do this as soon as possible via the portal.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
  },
  {
    triggerKey: "added_to_pts",
    label: "Added to PTS",
    subject: "Booking Added to PTS",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Your booking for <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) has been added to PTS.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
  },
  {
    triggerKey: "commission_claimable",
    label: "Commission Claimable",
    subject: "Your Commission is Ready to Claim",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Your commission for booking <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) is now ready to claim. Please log in to the portal to submit your claim.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
  },
  {
    triggerKey: "commission_claimed",
    label: "Commission Claimed",
    subject: "Commission Marked as Claimed",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Your commission for booking <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) has been marked as claimed.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
  },
  {
    triggerKey: "cancelled",
    label: "Booking Cancelled",
    subject: "Booking Cancelled",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Your booking for <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) has been cancelled.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
  },
  {
    triggerKey: "amendment_actioned",
    label: "Amendment Actioned",
    subject: "Your Amendment Has Been Processed",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Your amendment request for booking <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) has been processed.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
  },
  {
    triggerKey: "supplier_payment_due",
    label: "Final Supplier Payment Due (Admin)",
    subject: "Final Supplier Payment Due – Review Commission",
    bodyHtml: `<p>Hi Admin,</p><p>The final supplier payment date has been reached for booking <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}). Please review the file and move to Commission Claimable when ready.</p>`,
    recipientType: "admin" as const,
  },
  {
    triggerKey: "late_reimb_doc",
    label: "Late Reimbursement Document Upload (Admin)",
    subject: "Reimbursement Document Uploaded Late",
    bodyHtml: `<p>Hi Admin,</p><p>Agent <strong>{{agentName}}</strong> has uploaded a reimbursement document for booking <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) after the initial submission.</p>`,
    recipientType: "admin" as const,
  },
];

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  // ── Auth ──────────────────────────────────────────────────────────────────
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    // Password login for agents (created by admin, no OAuth)
    loginWithPassword: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const user = await getUserByEmail(input.email);
        if (!user || !user.tempPassword || !user.isActive) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
        }
        const valid = await bcrypt.compare(input.password, user.tempPassword);
        if (!valid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
        }
        // Issue JWT session cookie
        const token = sign(
          { userId: user.id, openId: user.openId, role: user.role },
          process.env.JWT_SECRET ?? "secret",
          { expiresIn: "7d" }
        );
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, cookieOptions);
        return { success: true, mustChangePassword: user.mustChangePassword, user };
      }),
    changePassword: protectedProcedure
      .input(z.object({ newPassword: z.string().min(8) }))
      .mutation(async ({ input, ctx }) => {
        const hashed = await bcrypt.hash(input.newPassword, 12);
        await updateUserPassword(ctx.user.id, hashed);
        return { success: true };
      }),
    seedTemplates: publicProcedure.mutation(async () => {
      for (const t of DEFAULT_TEMPLATES) {
        await upsertNotificationTemplate({ ...t, updatedById: 1 });
      }
      return { success: true };
    }),
  }),

  // ── Users ─────────────────────────────────────────────────────────────────
  users: router({
    list: adminProcedure.query(async () => {
      const all = await getAllUsers();
      return all.map((u) => ({ ...u, tempPassword: undefined }));
    }),
    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          email: z.string().email(),
        })
      )
      .mutation(async ({ input }) => {
        // Generate a random temp password
        const tempPassword = nanoid(12);
        const hashed = await bcrypt.hash(tempPassword, 12);
        const user = await createAgentUser({
          name: input.name,
          email: input.email,
          hashedPassword: hashed,
        });
        // Send credentials email
        await sendCredentialsEmail({
          toEmail: input.email,
          toName: input.name,
          tempPassword,
        });
        return { success: true, userId: user?.id };
      }),
    updateRole: superAdminProcedure
      .input(
        z.object({
          userId: z.number(),
          role: z.enum(["super_admin", "admin", "agent"]),
        })
      )
      .mutation(async ({ input }) => {
        await updateUserRole(input.userId, input.role);
        return { success: true };
      }),
    toggleActive: adminProcedure
      .input(z.object({ userId: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        await toggleUserActive(input.userId, input.isActive);
        return { success: true };
      }),
  }),

  // ── Bookings ──────────────────────────────────────────────────────────────
  bookings: router({
    myBookings: protectedProcedure.query(async ({ ctx }) => {
      return getBookingsByAgent(ctx.user.id);
    }),
    all: adminProcedure
      .input(
        z.object({
          agentId: z.number().optional(),
          fromDate: z.date().optional(),
          toDate: z.date().optional(),
        }).optional()
      )
      .query(async ({ input }) => {
        return getAllBookings(input);
      }),
    byId: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const booking = await getBookingById(input.id);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        // Agents can only see their own bookings
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return booking;
      }),
    create: protectedProcedure
      .input(
        z.object({
          clientName: z.string().min(1),
          departureDate: z.date(),
          topdogRef: z.string().optional(),
          reimbursementsRequired: z.boolean(),
          reimbursementDocUrl: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const booking = await createBooking({ ...input, agentId: ctx.user.id });
        // Notify all admins of new booking
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: booking?.id,
            message: `New booking registered by ${ctx.user.name}: ${input.clientName}`,
          });
        }
        return booking;
      }),
    uploadReimbDoc: protectedProcedure
      .input(
        z.object({
          bookingId: z.number(),
          fileBase64: z.string(),
          fileName: z.string(),
          mimeType: z.string(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const isLate = !!booking.reimbursementDocUrl;
        const buffer = Buffer.from(input.fileBase64, "base64");
        const key = `reimb-docs/${input.bookingId}-${nanoid(8)}-${input.fileName}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        await uploadReimbursementDoc(input.bookingId, url, isLate);

        if (isLate) {
          // Notify admins
          const allUsers = await getAllUsers();
          const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
          for (const admin of admins) {
            await createInAppNotification({
              userId: admin.id,
              bookingId: input.bookingId,
              message: `Late reimbursement document uploaded for booking #${input.bookingId} (${booking.clientName}) by ${ctx.user.name}`,
            });
          }
        }
        return { success: true, isLate };
      }),
    moveStage: adminProcedure
      .input(z.object({ bookingId: z.number(), toStage: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        const updated = await updateBookingStage(input.bookingId, input.toStage, ctx.user.id);

        // Trigger notifications based on stage
        const agent = await getUserById(booking.agentId);
        const stageToTrigger: Record<string, string> = {
          "Not on Topdog": "not_on_topdog",
          Query: "query",
          "Reimb Docs Missing": "reimb_docs_missing",
          "Added to PTS": "added_to_pts",
          "Commission Claimable": "commission_claimable",
          "Commission Claimed": "commission_claimed",
          Cancelled: "cancelled",
        };
        const triggerKey = stageToTrigger[input.toStage];
        if (triggerKey && agent?.email) {
          await sendNotificationEmail({
            triggerKey,
            toEmail: agent.email,
            toName: agent.name ?? "Agent",
            variables: { clientName: booking.clientName },
            bookingId: booking.id,
          });
          await createInAppNotification({
            userId: booking.agentId,
            bookingId: booking.id,
            message: `Your booking "${booking.clientName}" has moved to: ${input.toStage}`,
          });
        }
        return updated;
      }),
    updateAdminFields: adminProcedure
      .input(
        z.object({
          bookingId: z.number(),
          ptsRef: z.string().optional(),
          topdogRef: z.string().optional(),
          finalSupplierPaymentDate: z.date().nullable().optional(),
          expectedCommission: z.number().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { bookingId, ...data } = input;
        const result = await updateBookingAdminFields(bookingId, data as any);
        // Notify all admins when final supplier payment date is set
        if (input.finalSupplierPaymentDate) {
          const booking = await getBookingById(bookingId);
          if (booking) {
            const dateStr = input.finalSupplierPaymentDate.toLocaleDateString('en-GB');
            // Notify the acting admin as an internal reminder
            await createInAppNotification({
              userId: ctx.user.id,
              bookingId,
              message: `Reminder: Final supplier payment date set to ${dateStr} for booking "${booking.clientName}"`,
            });
          }
        }
        return result;
      }),
    pipelineHistory: adminProcedure
      .input(z.object({ bookingId: z.number() }))
      .query(async ({ input }) => {
        return getPipelineHistory(input.bookingId);
      }),
  }),

  // ── Notes ─────────────────────────────────────────────────────────────────
  notes: router({
    list: protectedProcedure
      .input(z.object({ bookingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const includeInternal = ctx.user.role !== "agent";
        const noteRows = await getNotesByBooking(input.bookingId, includeInternal);
        // Enrich with author info
        const enriched = await Promise.all(
          noteRows.map(async (n) => {
            const author = await getUserById(n.authorId);
            return { ...n, authorName: author?.name ?? "Unknown" };
          })
        );
        return enriched;
      }),
    add: protectedProcedure
      .input(
        z.object({
          bookingId: z.number(),
          content: z.string().min(1),
          isInternal: z.boolean().default(false),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Agents cannot post internal notes
        if (input.isInternal && ctx.user.role === "agent") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Agents cannot post internal notes" });
        }
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: input.content,
          isInternal: input.isInternal,
        });

        // Notify the other party for shared notes
        if (!input.isInternal) {
          if (ctx.user.role === "agent") {
            // Notify admins
            const allUsers = await getAllUsers();
            const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
            for (const admin of admins) {
              await createInAppNotification({
                userId: admin.id,
                bookingId: input.bookingId,
                message: `${ctx.user.name} left a note on booking "${booking.clientName}"`,
              });
            }
          } else {
            // Notify agent
            await createInAppNotification({
              userId: booking.agentId,
              bookingId: input.bookingId,
              message: `Admin left a note on your booking "${booking.clientName}"`,
            });
          }
        }
        return { success: true };
      }),
  }),

  // ── Amendments ────────────────────────────────────────────────────────────
  amendments: router({
    submit: protectedProcedure
      .input(z.object({ bookingId: z.number(), details: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await createAmendment({ ...input, agentId: ctx.user.id });
        // Notify admins
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: input.bookingId,
            message: `Amendment submitted for booking "${booking.clientName}" by ${ctx.user.name}`,
          });
        }
        return { success: true };
      }),
    byBooking: protectedProcedure
      .input(z.object({ bookingId: z.number() }))
      .query(async ({ input }) => {
        return getAmendmentsByBooking(input.bookingId);
      }),
    all: adminProcedure.query(async () => {
      return getAllAmendments();
    }),
    action: adminProcedure
      .input(z.object({ amendmentId: z.number(), bookingId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await actionAmendment(input.amendmentId, ctx.user.id);
        const booking = await getBookingById(input.bookingId);
        if (booking) {
          const agent = await getUserById(booking.agentId);
          if (agent?.email) {
            await sendNotificationEmail({
              triggerKey: "amendment_actioned",
              toEmail: agent.email,
              toName: agent.name ?? "Agent",
              variables: { clientName: booking.clientName },
              bookingId: booking.id,
            });
          }
          await createInAppNotification({
            userId: booking.agentId,
            bookingId: booking.id,
            message: `Your amendment for booking "${booking.clientName}" has been actioned`,
          });
        }
        return { success: true };
      }),
  }),

  // ── Cancellations ─────────────────────────────────────────────────────────
  cancellations: router({
    submit: protectedProcedure
      .input(z.object({ bookingId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await createCancellation({ bookingId: input.bookingId, agentId: ctx.user.id });
        await updateBookingStage(input.bookingId, "Cancelled", ctx.user.id);
        // Notify admins
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: input.bookingId,
            message: `Cancellation requested for booking "${booking.clientName}" by ${ctx.user.name}`,
          });
        }
        return { success: true };
      }),
    all: adminProcedure.query(async () => getAllCancellations()),
  }),

  // ── Refunds ───────────────────────────────────────────────────────────────
  refunds: router({
    submit: protectedProcedure
      .input(
        z.object({
          bookingId: z.number(),
          refundType: z.enum(["supplier", "customer", "both"]),
          supplierCount: z.number().min(0),
          amountToClient: z.number().optional(),
          refundReason: z.string().min(1),
          clientBankName: z.string().optional(),
          clientSortCode: z.string().optional(),
          clientAccountNumber: z.string().optional(),
          stepsTaken: z.string().min(1),
          suppliers: z.array(
            z.object({ supplierName: z.string(), amountDue: z.number() })
          ),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const refundId = await createRefund({
          ...input,
          agentId: ctx.user.id,
          clientBankName: encryptOptional(input.clientBankName) ?? undefined,
          clientSortCode: encryptOptional(input.clientSortCode) ?? undefined,
          clientAccountNumber: encryptOptional(input.clientAccountNumber) ?? undefined,
        });
        // Notify admins
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: input.bookingId,
            message: `Refund request submitted for booking "${booking.clientName}" by ${ctx.user.name}`,
          });
        }
        return { success: true, refundId };
      }),
    byBooking: adminProcedure
      .input(z.object({ bookingId: z.number() }))
      .query(async ({ input }) => {
        const refundRows = await getRefundsByBooking(input.bookingId);
        // Decrypt bank details for admin
        return refundRows.map((r) => ({
          ...r,
          clientBankName: decryptOptional(r.clientBankName),
          clientSortCode: decryptOptional(r.clientSortCode),
          clientAccountNumber: decryptOptional(r.clientAccountNumber),
        }));
      }),
    all: adminProcedure.query(async () => getAllRefunds()),
  }),

  // ── Notifications ─────────────────────────────────────────────────────────
  notifications: router({
    myNotifications: protectedProcedure.query(async ({ ctx }) => {
      return getInAppNotifications(ctx.user.id);
    }),
    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      return getUnreadNotificationCount(ctx.user.id);
    }),
    markRead: protectedProcedure.mutation(async ({ ctx }) => {
      await markNotificationsRead(ctx.user.id);
      return { success: true };
    }),
    templates: router({
      list: adminProcedure.query(async () => getNotificationTemplates()),
      update: superAdminProcedure
        .input(
          z.object({
            triggerKey: z.string(),
            label: z.string(),
            subject: z.string(),
            bodyHtml: z.string(),
            recipientType: z.enum(["agent", "admin", "both"]),
          })
        )
        .mutation(async ({ input, ctx }) => {
          await upsertNotificationTemplate({ ...input, updatedById: ctx.user.id });
          return { success: true };
        }),
    }),
  }),

  // ── Reporting ─────────────────────────────────────────────────────────────
  reports: router({
    bookings: adminProcedure
      .input(
        z.object({
          agentId: z.number().optional(),
          fromDate: z.date().optional(),
          toDate: z.date().optional(),
        }).optional()
      )
      .query(async ({ input }) => {
        const allBookings = await getAllBookings(input);
        const allUsers = await getAllUsers();
        const userMap = new Map(allUsers.map((u) => [u.id, u]));
        return allBookings.map((b) => ({
          ...b,
          agentName: userMap.get(b.agentId)?.name ?? "Unknown",
          agentEmail: userMap.get(b.agentId)?.email ?? "",
        }));
      }),
  }),
});

export type AppRouter = typeof appRouter;
