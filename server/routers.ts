import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { sdk } from "./_core/sdk";
import {
  getAllUsers,
  getUserByEmail,
  getUserById,
  createAgentUser,
  updateUserRole,
  toggleUserActive,
  deleteUser,
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
  updateAmendmentPipeline,
  createCancellation,
  getAllCancellations,
  createRefund,
  getRefundsByBooking,
  getAllRefunds,
  updateRefundPipeline,
  getCommissionDueBookings,
  createCommissionClaim,
  getCommissionClaimsByAgent,
  getAllCommissionClaims,
  markCommissionPaid,
  getCommissionClaimByBooking,
  getNotificationTemplates,
  getNotificationTemplate,
  upsertNotificationTemplate,
  createInAppNotification,
  getInAppNotifications,
  markNotificationsRead,
  getUnreadNotificationCount,
  upsertUser,
  bulkCreateAgentUsers,
  markCredentialsSent,
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
        // Issue JWT session cookie using the SDK so the token format matches verifySession
        const token = await sdk.createSessionToken(user.openId, { name: user.name ?? user.email ?? "" });
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
    list: adminProcedure
      .input(z.object({
        search: z.string().optional(),
        role: z.enum(["super_admin", "admin", "agent"]).optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(200).default(50),
      }).optional())
      .query(async ({ input }) => {
        const all = await getAllUsers();
        let filtered = all;
        if (input?.role) filtered = filtered.filter((u) => u.role === input.role);
        if (input?.search) {
          const q = input.search.toLowerCase();
          filtered = filtered.filter((u) =>
            (u.name ?? "").toLowerCase().includes(q) ||
            (u.email ?? "").toLowerCase().includes(q)
          );
        }
        const page = input?.page ?? 1;
        const pageSize = input?.pageSize ?? 50;
        const total = filtered.length;
        const items = filtered.slice((page - 1) * pageSize, page * pageSize);
        return {
          items: items.map((u) => ({ ...u, tempPassword: undefined })),
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),
    // Lightweight list of all agents for dropdowns/matching (no pagination needed, names only)
    listAgents: adminProcedure.query(async () => {
      const all = await getAllUsers();
      return all
        .filter((u) => u.role === "agent")
        .map((u) => ({ id: u.id, name: u.name ?? "", email: u.email ?? "", phone: (u as any).phone ?? "", credentialsSentAt: (u as any).credentialsSentAt ?? null }));
    }),
    listAdmins: protectedProcedure.query(async () => {
      const all = await getAllUsers();
      return all
        .filter((u) => u.role === "admin" || u.role === "super_admin")
        .map((u) => ({ id: u.id, name: u.name ?? "", email: u.email }));
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
    delete: superAdminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // Prevent deleting yourself
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot delete your own account" });
        }
        await deleteUser(input.userId);
        return { success: true };
      }),

    // Bulk create agent accounts silently (no credentials email)
    bulkCreate: adminProcedure
      .input(
        z.array(
          z.object({
            name: z.string().min(1),
            email: z.string().email(),
            phone: z.string().optional(),
          })
        )
      )
      .mutation(async ({ input }) => {
        const agentsWithPasswords = await Promise.all(
          input.map(async (agent) => {
            const tempPassword = nanoid(12);
            const hashed = await bcrypt.hash(tempPassword, 12);
            return { name: agent.name, email: agent.email, phone: agent.phone, hashedPassword: hashed, tempPassword };
          })
        );
        const results = await bulkCreateAgentUsers(
          agentsWithPasswords.map(({ name, email, phone, hashedPassword }) => ({ name, email, phone, hashedPassword }))
        );
        return { results };
      }),

    // Send login credentials to a specific agent
    sendCredentials: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        const user = await getUserById(input.userId);
        if (!user) throw new TRPCError({ code: "NOT_FOUND" });
        if (!user.email) throw new TRPCError({ code: "BAD_REQUEST", message: "User has no email" });
        // Generate a fresh temp password and re-hash
        const tempPassword = nanoid(12);
        const hashed = await bcrypt.hash(tempPassword, 12);
        // updateUserPassword sets mustChangePassword=false, so we set it back manually
        await updateUserPassword(user.id, hashed);
        await sendCredentialsEmail({ toEmail: user.email, toName: user.name ?? user.email, tempPassword });
        await markCredentialsSent(user.id);
        return { success: true };
      }),

    // Bulk send credentials to all agents who haven't received them yet
    bulkSendCredentials: adminProcedure
      .input(z.object({ userIds: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        const results: Array<{ userId: number; success: boolean; error?: string }> = [];
        for (const userId of input.userIds) {
          try {
            const user = await getUserById(userId);
            if (!user || !user.email) {
              results.push({ userId, success: false, error: "no_email" });
              continue;
            }
            const tempPassword = nanoid(12);
            const hashed = await bcrypt.hash(tempPassword, 12);
            await updateUserPassword(user.id, hashed);
            await sendCredentialsEmail({ toEmail: user.email, toName: user.name ?? user.email, tempPassword });
            await markCredentialsSent(user.id);
            results.push({ userId, success: true });
          } catch (err: any) {
            results.push({ userId, success: false, error: err?.message ?? "unknown" });
          }
        }
        return { results };
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
          expectedCommission: z.number().min(0).optional(),
          grossCost: z.number().min(0).optional(),
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
            linkUrl: `/admin/bookings/${booking?.id}`,
          });
        }
        // System audit note
        if (booking?.id) {
          await createNote({
            bookingId: booking.id,
            authorId: ctx.user.id,
            content: `[System] Booking created by ${ctx.user.name ?? "Agent"}.`,
            isInternal: false,
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
              linkUrl: `/admin/bookings/${input.bookingId}`,
            });
          }
          await createNote({
            bookingId: input.bookingId,
            authorId: ctx.user.id,
            content: `[System] Reimbursement document uploaded late by ${ctx.user.name ?? "Agent"}.`,
            isInternal: true,
          });
        } else {
          await createNote({
            bookingId: input.bookingId,
            authorId: ctx.user.id,
            content: `[System] Reimbursement document uploaded by ${ctx.user.name ?? "Agent"}.`,
            isInternal: false,
          });
        }
        return { success: true, isLate };
      }),
    moveStage: adminProcedure
      .input(z.object({ bookingId: z.number(), toStage: z.string(), queryMessage: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });

        // Guardrail: final supplier payment date required for "Added to PTS" and all later stages
        const STAGES_REQUIRING_PAYMENT_DATE = [
          "Added to PTS",
          "Commission Claimable",
          "Commission Claimed",
          "Holding Accounts",
        ];
        if (STAGES_REQUIRING_PAYMENT_DATE.includes(input.toStage) && !booking.finalSupplierPaymentDate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A Final Supplier Payment Date must be set on this booking before it can be moved to \"" + input.toStage + "\". Please open the booking, add the date, then try again.",
          });
        }

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
            linkUrl: `/bookings/${booking.id}`,
          });
        }
        // If moving to Query and a message was provided, post it as a shared note visible to the agent
        if (input.toStage === "Query" && input.queryMessage?.trim()) {
          await createNote({
            bookingId: booking.id,
            authorId: ctx.user.id,
            content: input.queryMessage.trim(),
            isInternal: false,
          });
        }

        // System audit note for stage change
        await createNote({
          bookingId: booking.id,
          authorId: ctx.user.id,
          content: `[System] Booking stage moved from "${booking.currentStage}" to "${input.toStage}" by ${ctx.user.name ?? "Admin"}.`,
          isInternal: true,
        });
        return updated;
      }),
    updateCommission: protectedProcedure
      .input(z.object({ bookingId: z.number(), expectedCommission: z.number().min(0) }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await updateBookingAdminFields(input.bookingId, { expectedCommission: input.expectedCommission });
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: `[System] Expected commission set to £${input.expectedCommission.toFixed(2)} by ${ctx.user.name ?? "Agent"}.`,
          isInternal: false,
        });
        return { success: true };
      }),
    updateAdminFields: adminProcedure
      .input(
        z.object({
          bookingId: z.number(),
          ptsRef: z.string().optional(),
          topdogRef: z.string().optional(),
          finalSupplierPaymentDate: z.date().nullable().optional(),
          expectedCommission: z.number().optional(),
          grossCost: z.number().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { bookingId, ...data } = input;
        const result = await updateBookingAdminFields(bookingId, data as any);
        const booking = await getBookingById(bookingId);
        if (booking) {
          const changes: string[] = [];
          if (input.ptsRef !== undefined) changes.push(`PTS Ref set to "${input.ptsRef}"`);
          if (input.topdogRef !== undefined) changes.push(`Topdog Ref set to "${input.topdogRef}"`);
          if (input.finalSupplierPaymentDate !== undefined) {
            const dateStr = input.finalSupplierPaymentDate
              ? input.finalSupplierPaymentDate.toLocaleDateString('en-GB')
              : 'cleared';
            changes.push(`Final Supplier Payment Date set to ${dateStr}`);
            if (input.finalSupplierPaymentDate) {
              await createInAppNotification({
                userId: ctx.user.id,
                bookingId,
                message: `Reminder: Final supplier payment date set to ${dateStr} for booking "${booking.clientName}"`,
              });
            }
          }
          if (input.expectedCommission !== undefined) changes.push(`Expected Commission set to £${input.expectedCommission}`);
          if (input.grossCost !== undefined) changes.push(`Gross Cost set to £${input.grossCost}`);
          if (changes.length > 0) {
            await createNote({
              bookingId,
              authorId: ctx.user.id,
              content: `[System] Admin updated booking details: ${changes.join('; ')}.`,
              isInternal: true,
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

    // Bulk import bookings from CSV (admin only)
    bulkImport: adminProcedure
      .input(
        z.array(
          z.object({
            agentId: z.number(),
            clientName: z.string().min(1),
            departureDate: z.date(),
            topdogRef: z.string().optional(),
            ptsRef: z.string().optional(),
            currentStage: z.string().optional(),
            reimbursementsRequired: z.boolean().default(false),
            expectedCommission: z.number().optional(),
            finalSupplierPaymentDate: z.date().optional(),
          })
        )
      )
      .mutation(async ({ input, ctx }) => {
        const results: Array<{ clientName: string; success: boolean; bookingId?: number; error?: string }> = [];
        for (const row of input) {
          try {
            // Security: validate agentId is a real agent account
            const agentUser = await getUserById(row.agentId);
            if (!agentUser || agentUser.role !== "agent") {
              results.push({ clientName: row.clientName, success: false, error: "invalid_agent_id" });
              continue;
            }
            const booking = await createBooking({
              agentId: row.agentId,
              clientName: row.clientName,
              departureDate: row.departureDate,
              topdogRef: row.topdogRef,
              reimbursementsRequired: row.reimbursementsRequired,
            });
            if (!booking?.id) throw new Error("Insert failed");
            // Apply extra fields (stage, ptsRef, commission, payment date)
            const adminUpdates: Record<string, unknown> = {};
            if (row.ptsRef) adminUpdates.ptsRef = row.ptsRef;
            if (row.expectedCommission !== undefined) adminUpdates.expectedCommission = row.expectedCommission;
            if (row.finalSupplierPaymentDate) adminUpdates.finalSupplierPaymentDate = row.finalSupplierPaymentDate;
            if (Object.keys(adminUpdates).length > 0) {
              await updateBookingAdminFields(booking.id, adminUpdates as any);
            }
            // Set stage if not default
            const stage = row.currentStage ?? "New Booking";
            if (stage !== "New Booking") {
              await updateBookingStage(booking.id, stage, ctx.user.id);
            }
            // System note
            await createNote({
              bookingId: booking.id,
              authorId: ctx.user.id,
              content: `[System] Booking imported from CSV by ${ctx.user.name ?? "Admin"}.`,
              isInternal: true,
            });
            results.push({ clientName: row.clientName, success: true, bookingId: booking.id });
          } catch (err: any) {
            results.push({ clientName: row.clientName, success: false, error: err?.message ?? "unknown" });
          }
        }
        return { results, total: input.length, succeeded: results.filter((r) => r.success).length };
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
            return {
              ...n,
              authorName: author?.name ?? "Unknown",
              authorRole: author?.role ?? "agent",
            };
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

        // Parse @mentions in internal notes and notify mentioned admins
        if (input.isInternal) {
          const mentionRegex = /@([A-Za-z][A-Za-z0-9 ]*?)(?=\s+[a-z]|\s*$|[^A-Za-z0-9 ])/g;
          const mentions = Array.from(input.content.matchAll(mentionRegex)).map((m) => m[1].trim());
          if (mentions.length > 0) {
            const allUsers = await getAllUsers();
            const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
            for (const mentionedName of mentions) {
              const mentioned = admins.find(
                (u) => (u.name ?? "").toLowerCase() === mentionedName.toLowerCase()
              );
              if (mentioned && mentioned.id !== ctx.user.id) {
                await createInAppNotification({
                  userId: mentioned.id,
                  bookingId: input.bookingId,
                  message: `${ctx.user.name ?? "Admin"} mentioned you in a note on booking "${booking.clientName}"`,
                  linkUrl: `/bookings/${input.bookingId}`,
                });
              }
            }
          }
        }

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
        // System audit note
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: `[System] Amendment submitted by ${ctx.user.name ?? "Agent"}: ${input.details.slice(0, 120)}.`,
          isInternal: false,
        });
        // Notify admins
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: input.bookingId,
            message: `Amendment submitted for booking "${booking.clientName}" by ${ctx.user.name}`,
            linkUrl: `/admin/bookings/${input.bookingId}`,
          });
        }
        return { success: true };
      }),
    byBooking: protectedProcedure
      .input(z.object({ bookingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        // Agents can only see amendments for their own bookings
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const amendments = await getAmendmentsByBooking(input.bookingId);
        // Enrich with assignee name
        const allUsers = await getAllUsers();
        const userMap = new Map(allUsers.map((u) => [u.id, u]));
        return amendments.map((a) => ({
          ...a,
          assignedToName: a.assignedToId ? (userMap.get(a.assignedToId)?.name ?? null) : null,
        }));
      }),
    all: adminProcedure.query(async () => {
      const amendments = await getAllAmendments();
      // Enrich with booking details
      const enriched = await Promise.all(
        amendments.map(async (a) => {
          const booking = await getBookingById(a.bookingId);
          return {
            ...a,
            clientName: booking?.clientName ?? null,
            ptsRef: booking?.ptsRef ?? null,
            topdogRef: booking?.topdogRef ?? null,
          };
        })
      );
      return enriched;
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
            linkUrl: `/bookings/${booking.id}`,
          });
          // System audit note
          await createNote({
            bookingId: booking.id,
            authorId: ctx.user.id,
            content: `[System] Amendment actioned by ${ctx.user.name ?? "Admin"}.`,
            isInternal: true,
          });
        }
        return { success: true };
      }),
    updatePipeline: adminProcedure
      .input(z.object({
        amendmentId: z.number(),
        bookingId: z.number().optional(),
        pipelineStage: z.enum(["To Do", "In Progress", "Actioned"]).optional(),
        assignedToId: z.number().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { amendmentId, bookingId: bId, ...data } = input;
        const updated = await updateAmendmentPipeline(amendmentId, data as any);
        // Notify agent when assigned or actioned
        const resolvedBookingId = bId ?? updated?.bookingId;
        if (resolvedBookingId) {
          const booking = await getBookingById(resolvedBookingId);
          if (booking) {
            if (data.assignedToId) {
              const assignee = await getUserById(data.assignedToId);
              await createInAppNotification({
                userId: booking.agentId,
                bookingId: booking.id,
                message: `Your amendment for "${booking.clientName}" has been assigned to ${assignee?.name ?? "an admin"} and is being reviewed`,
                linkUrl: `/bookings/${booking.id}`,
              });
            }
            if (data.pipelineStage === "Actioned") {
              await createInAppNotification({
                userId: booking.agentId,
                bookingId: booking.id,
                message: `Your amendment for "${booking.clientName}" has been actioned by ${ctx.user.name ?? "Admin"}`,
                linkUrl: `/bookings/${booking.id}`,
              });
            }
          }
        }
        return updated;
      }),
  }),

  // ── Cancellations ─────────────────────────────────────────────────────────
  cancellations: router({
    submit: protectedProcedure
      .input(z.object({ bookingId: z.number(), reason: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await createCancellation({ bookingId: input.bookingId, agentId: ctx.user.id });
        await updateBookingStage(input.bookingId, "Cancelled", ctx.user.id);
        // System audit note
        const reasonText = input.reason ? ` Reason: ${input.reason}` : "";
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: `[System] Cancellation submitted by ${ctx.user.name ?? "Agent"}.${reasonText}`,
          isInternal: false,
        });
        // Notify admins
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: input.bookingId,
            message: `Cancellation requested for booking "${booking.clientName}" by ${ctx.user.name}`,
            linkUrl: `/admin/bookings/${input.bookingId}`,
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
        // System audit note
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: `[System] Refund request submitted by ${ctx.user.name ?? "Agent"} (type: ${input.refundType}, reason: ${input.refundReason.slice(0, 80)}).`,
          isInternal: false,
        });
        return { success: true, refundId };
      }),
    byBooking: protectedProcedure
      .input(z.object({ bookingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const refundRows = await getRefundsByBooking(input.bookingId);
        const allUsers = await getAllUsers();
        const userMap = new Map(allUsers.map((u) => [u.id, u]));
        return refundRows.map((r) => ({
          // Only expose bank details to admins
          ...r,
          clientBankName: ctx.user.role !== "agent" ? decryptOptional(r.clientBankName) : undefined,
          clientSortCode: ctx.user.role !== "agent" ? decryptOptional(r.clientSortCode) : undefined,
          clientAccountNumber: ctx.user.role !== "agent" ? decryptOptional(r.clientAccountNumber) : undefined,
          assignedToName: r.assignedToId ? (userMap.get(r.assignedToId)?.name ?? null) : null,
        }));
      }),
    byBookingAdmin: adminProcedure
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
    all: adminProcedure.query(async () => {
      const refunds = await getAllRefunds();
      const enriched = await Promise.all(
        refunds.map(async (r) => {
          const booking = await getBookingById(r.bookingId);
          return {
            ...r,
            clientBankName: decryptOptional(r.clientBankName),
            clientSortCode: decryptOptional(r.clientSortCode),
            clientAccountNumber: decryptOptional(r.clientAccountNumber),
            clientName: booking?.clientName ?? null,
            ptsRef: booking?.ptsRef ?? null,
            topdogRef: booking?.topdogRef ?? null,
          };
        })
      );
      return enriched;
    }),
    updatePipeline: adminProcedure
      .input(z.object({
        refundId: z.number(),
        pipelineStage: z.enum(["New Refund Request", "Acknowledged by Supplier", "Refund Sent to PTS", "Refund Received in JLT", "Refund Processed"]).optional(),
        assignedToId: z.number().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { refundId, ...data } = input;
        const updated = await updateRefundPipeline(refundId, data as any);
        // System audit note if stage changed
        if (data.pipelineStage && updated?.bookingId) {
          await createNote({
            bookingId: updated.bookingId,
            authorId: ctx.user.id,
            content: `[System] Refund stage moved to "${data.pipelineStage}" by ${ctx.user.name ?? "Admin"}.`,
            isInternal: true,
          });
          // Notify agent
          const booking = await getBookingById(updated.bookingId);
          if (booking) {
            const stageMessages: Record<string, string> = {
              "Acknowledged by Supplier": `Your refund request for "${booking.clientName}" has been acknowledged by the supplier`,
              "Refund Sent to PTS": `Your refund for "${booking.clientName}" has been sent to PTS`,
              "Refund Received in JLT": `Your refund for "${booking.clientName}" has been received by JLT`,
              "Refund Processed": `Your refund for "${booking.clientName}" has been fully processed`,
            };
            const msg = stageMessages[data.pipelineStage];
            if (msg) {
              await createInAppNotification({
                userId: booking.agentId,
                bookingId: booking.id,
                message: msg,
                linkUrl: `/bookings/${booking.id}`,
              });
            }
          }
        }
        if (data.assignedToId && updated?.bookingId) {
          const booking = await getBookingById(updated.bookingId);
          if (booking) {
            const assignee = await getUserById(data.assignedToId);
            await createInAppNotification({
              userId: booking.agentId,
              bookingId: booking.id,
              message: `Your refund request for "${booking.clientName}" has been assigned to ${assignee?.name ?? "an admin"} and is being reviewed`,
              linkUrl: `/bookings/${booking.id}`,
            });
          }
        }
        return updated;
      }),
  }),

  // ── Commission Due ────────────────────────────────────────────────────────
  commissionDue: router({
    list: adminProcedure.query(async () => {
      const dueBookings = await getCommissionDueBookings();
      const allUsers = await getAllUsers();
      const userMap = new Map(allUsers.map((u) => [u.id, u]));
      return dueBookings.map((b) => ({
        ...b,
        agentName: userMap.get(b.agentId)?.name ?? "Unknown",
        agentEmail: userMap.get(b.agentId)?.email ?? "",
      }));
    }),
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

  // ── Commission Claims ──────────────────────────────────────────────────────
  commissionClaims: router({
    // Agent: claim commission on a claimable booking
    claim: protectedProcedure
      .input(z.object({
        bookingId: z.number(),
        bookingType: z.enum(["lapland", "cruise", "disney", "other"]).default("other"),
      }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        if (booking.currentStage !== "Commission Claimable") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Booking is not in Commission Claimable stage" });
        }
        const claim = await createCommissionClaim(input.bookingId, ctx.user.id, input.bookingType);
        // Move booking to Commission Claimed
        await updateBookingStage(input.bookingId, "Commission Claimed", ctx.user.id);
        // System audit note
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: `[System] Commission claimed by ${ctx.user.name ?? "Agent"}.`,
          isInternal: false,
        });
        // Notify admins
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: input.bookingId,
            message: `Commission claimed by ${ctx.user.name} for booking "${booking.clientName}"`,
            linkUrl: `/admin/bookings/${input.bookingId}`,
          });
        }
        return claim;
      }),

    // Agent: get own commission claims with booking info
    myCommissions: protectedProcedure.query(async ({ ctx }) => {
      const agentBookings = await getBookingsByAgent(ctx.user.id);
      const claims = await getCommissionClaimsByAgent(ctx.user.id);
      const claimMap = new Map(claims.map((c) => [c.bookingId, c]));
      return agentBookings.map((b) => ({
        ...b,
        claim: claimMap.get(b.id) ?? null,
      }));
    }),

    // Admin: get all commission claims with booking and agent info
    all: adminProcedure.query(async () => {
      const claims = await getAllCommissionClaims();
      const allUsers = await getAllUsers();
      const allBookingsRaw = await getAllBookings();
      const userMap = new Map(allUsers.map((u) => [u.id, u]));
      const bookingMap = new Map(allBookingsRaw.map((b) => [b.id, b]));
      return claims.map((c) => ({
        ...c,
        agentName: userMap.get(c.agentId)?.name ?? "Unknown",
        agentEmail: userMap.get(c.agentId)?.email ?? "",
        booking: bookingMap.get(c.bookingId) ?? null,
        paidByName: c.paidById ? (userMap.get(c.paidById)?.name ?? "Admin") : null,
      }));
    }),

    // Admin: mark one or more claims as paid
    markPaid: adminProcedure
      .input(z.object({ claimIds: z.array(z.number()).min(1) }))
      .mutation(async ({ input, ctx }) => {
        await markCommissionPaid(input.claimIds, ctx.user.id);
        // Notify each affected agent
        const allClaims = await getAllCommissionClaims();
        for (const claimId of input.claimIds) {
          const claim = allClaims.find((c) => c.id === claimId);
          if (!claim) continue;
          const booking = await getBookingById(claim.bookingId);
          if (!booking) continue;
          const agent = await getUserById(claim.agentId);
          // In-app notification
          await createInAppNotification({
            userId: claim.agentId,
            bookingId: claim.bookingId,
            message: `Your commission for booking "${booking.clientName}" has been marked as paid.`,
            linkUrl: `/commissions`,
          });
          // Email notification
          if (agent?.email) {
            await sendNotificationEmail({
              triggerKey: "commission_paid",
              toEmail: agent.email,
              toName: agent.name ?? "Agent",
              variables: { clientName: booking.clientName },
              bookingId: booking.id,
            });
          }
          // System audit note
          await createNote({
            bookingId: claim.bookingId,
            authorId: ctx.user.id,
            content: `[System] Commission marked as paid by ${ctx.user.name ?? "Admin"}.`,
            isInternal: false,
          });
        }
        return { success: true };
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
