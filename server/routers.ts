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
  getBookingWithAgent,
  getPtsMissingPaymentDate,
  getCommissionClaimableMissingPaymentDate,
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
  getCancellationsByBooking,
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
  deleteCommissionClaim,
  updateCommissionVat,
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
  createPasswordResetToken,
  getPasswordResetToken,
  markPasswordResetTokenUsed,
  updateUserProfile,
  areNotificationsPaused,
  setSystemSetting,
  markNotesReadByAdmin,
  getBookingsWithUnreadAgentNotes,
  getReimbursementDocs,
  addReimbursementDoc,
  getLastAdminNoteAuthor,
  getAllMessageThreads,
  getTotalUnreadMessageCount,
  markAllAgentNotesAsRead,
  getUnreadBookingIds,
  getUnreadAgentNoteCountForBooking,
  getAdminNotifPrefs,
  upsertAdminNotifPref,
  isAdminEmailEnabledForTrigger,
  createAdminTask,
  getAllAdminTasks,
  getAdminTaskById,
  updateAdminTask,
  deleteAdminTask,
  getAdminTaskComments,
  addAdminTaskComment,
  deleteBooking,
  mergeBookings,
  deleteReimbursementDoc,
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  getTasksDueForReminder,
  markCalendarReminderSent,
  deleteCalendarEvent,
  createReimbursementItems,
  getReimbursementsByBooking,
  getReimbursementsAdmin,
  updateReimbursementStatus,
  scheduleReimbursementsForBooking,
  getReimbursementDashboardStats,
  getImapConfig,
  upsertImapConfig,
  getCachedEmailCount,
  getLastImportTime,
  createInboxAuditLog,
  listInboxAuditLogs,
  linkEmailToBooking,
  unlinkEmailFromBooking,
  getLinkedEmailsForBooking,
  getCachedEmailByUid,
  activatePortalAccess,
} from "./db";
import { encryptOptional, decryptOptional } from "./encryption";
import {
  searchCachedEmails,
  importInbox,
  encryptPassword,
  decryptPassword,
} from "./imap";
import { sendNotificationEmail, sendCredentialsEmail, sendPasswordResetEmail, sendDirectEmail } from "./email";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { ENV } from "./_core/env";
import { crmRouter } from "./crm-router";
import { remittanceRouter } from "./remittance-router";
import { flightRequestsRouter } from "./flight-requests-router";
import { paymentsRouter } from "./payments-router";
import { joinRouter } from "./join-router";
import {
  createBillingRequest,
  createBillingRequestFlow,
  calcSubscriptionStartDate,
  createSubscription,
} from "./gocardless";
import {
  createGcMandate,
  createGcSubscription,
  getGcMandateByUserId,
  getGcSubscriptionByUserId,
  getAllGcMandates,
  getPaymentEventsByUserId,
  getRecentFailedPayments,
} from "./gocardless-db";

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
    subject: "Booking Added to PTS — Reference: {{ptsRef}}",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Great news — your booking for <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) has been added to PTS.</p><p><strong>Your PTS Reference is: {{ptsRef}}</strong></p><p>Please keep this reference to hand, as you will need it in two important situations:</p><ul><li><strong>Bank transfer payments:</strong> If your client is paying by bank transfer, they should use <strong>{{ptsRef}}</strong> as the payment reference so the funds are matched correctly.</li><li><strong>PPS payment links:</strong> If you are generating a payment link via PPS, please enter <strong>{{ptsRef}}</strong> in the <em>Order Description</em> field when creating the link.</li></ul><p>If you have any questions, please don't hesitate to get in touch.</p><p>The JLT Group Team</p>`,
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
  {
    triggerKey: "creating_own_pts_file",
    label: "Creating Own PTS File",
    subject: "Action Required: Add PTS Reference & Payment Date",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Your booking for <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) has been moved to <strong>Creating own PTS file</strong>.</p><p>Please log in to the portal and update the following details on your booking as soon as possible:</p><ul><li><strong>PTS Reference</strong></li><li><strong>Final Supplier Payment Date</strong></li></ul><p>Once these are added, the JLT team will move your booking to Added to PTS and it will continue through the normal process.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
  },
  {
    triggerKey: "reimbursement_scheduled",
    label: "Reimbursement Scheduled",
    subject: "Your Reimbursement Has Been Scheduled",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Your reimbursement for <strong>{{supplierName}}</strong> (amount: {{amount}}) on booking <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) has been scheduled for payment.</p><p>You will be notified once it has been processed.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
  },
  {
    triggerKey: "commission_paid",
    label: "Commission Paid",
    subject: "Your Commission Has Been Paid",
    bodyHtml: `<p>Hi {{agentName}},</p><p>Great news — your commission for booking <strong>{{clientName}}</strong> (Booking ID: {{bookingId}}) has been marked as paid.</p><p>Please log in to the portal to view your commission history.</p><p>The JLT Group Team</p>`,
    recipientType: "agent" as const,
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
    // Self-registration for new agents (post-GoCardless onboarding flow)
    selfRegister: publicProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        email: z.string().email(),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }))
      .mutation(async ({ input, ctx }) => {
        // Check if email already exists
        const existing = await getUserByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists. Please sign in instead." });
        }
        const hashed = await bcrypt.hash(input.password, 12);
        const newUser = await createAgentUser({ name: input.name, email: input.email, hashedPassword: hashed });
        // Immediately log them in
        const token = await sdk.createSessionToken(newUser.openId, { name: newUser.name ?? newUser.email ?? "" });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, cookieOptions);
        return { success: true };
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
    // Forgot password — sends a reset link to the agent's email
    forgotPassword: publicProcedure
      .input(z.object({ email: z.string().email(), origin: z.string().url() }))
      .mutation(async ({ input }) => {
        // Always return success to avoid user enumeration
        const user = await getUserByEmail(input.email);
        if (!user || !user.isActive || user.loginMethod !== "password") {
          return { success: true };
        }
        const token = nanoid(48);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await createPasswordResetToken(user.id, token, expiresAt);
        const resetUrl = `${input.origin}/reset-password?token=${token}`;
        await sendPasswordResetEmail({
          toEmail: user.email!,
          toName: user.name ?? user.email!,
          resetUrl,
        });
        return { success: true };
      }),
    // Reset password — validates token and sets new password
    resetPassword: publicProcedure
      .input(z.object({ token: z.string(), newPassword: z.string().min(8) }))
      .mutation(async ({ input }) => {
        const record = await getPasswordResetToken(input.token);
        if (!record) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired reset link" });
        if (record.usedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "This reset link has already been used" });
        if (new Date() > record.expiresAt) throw new TRPCError({ code: "BAD_REQUEST", message: "This reset link has expired" });
        const hashed = await bcrypt.hash(input.newPassword, 12);
        await updateUserPassword(record.userId, hashed);
        await markPasswordResetTokenUsed(record.id);
        return { success: true };
      }),
    // Update own profile (name, email, phone)
    updateProfile: protectedProcedure
      .input(z.object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await updateUserProfile(ctx.user.id, input);
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
    // Lightweight list of all bookable users for dropdowns/matching (agents + admins, not super_admins)
    listAgents: adminProcedure.query(async () => {
      const all = await getAllUsers();
      return all
        .filter((u) => u.role === "agent" || u.role === "admin")
        .map((u) => ({ id: u.id, name: u.name ?? "", email: u.email ?? "", role: u.role, phone: (u as any).phone ?? "", credentialsSentAt: (u as any).credentialsSentAt ?? null }));
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
        // Batch size 50 — large enough to be fast, small enough not to overwhelm SMTP
        const BATCH_SIZE = 50;

        for (let i = 0; i < input.userIds.length; i += BATCH_SIZE) {
          const batch = input.userIds.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (userId) => {
              try {
                const user = await getUserById(userId);
                if (!user || !user.email) {
                  return { userId, success: false, error: "no_email" };
                }
                // Skip users who already received credentials in a previous send
                if ((user as any).credentialsSentAt) {
                  return { userId, success: true };
                }
                const tempPassword = nanoid(12);
                // bcrypt cost 8: ~60ms per hash (vs 400ms at cost 12) — still secure for temp passwords
                const hashed = await bcrypt.hash(tempPassword, 8);
                await updateUserPassword(user.id, hashed);
                await sendCredentialsEmail({ toEmail: user.email, toName: user.name ?? user.email, tempPassword });
                await markCredentialsSent(user.id);
                return { userId, success: true };
              } catch (err: any) {
                return { userId, success: false, error: err?.message ?? "unknown" };
              }
            })
          );
          results.push(...batchResults);
        }
        return { results };
      }),

    // Impersonate an agent — super admin only
    impersonate: superAdminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const target = await getUserById(input.userId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        if (target.role === "super_admin") throw new TRPCError({ code: "FORBIDDEN", message: "Cannot impersonate another super admin" });
        // Sign a short-lived session for the target user
        const impersonationToken = await sdk.createSessionToken(
          target.openId,
          { name: target.name ?? "", expiresInMs: 1000 * 60 * 60 * 4 }
        );
        // Back up the admin's current session cookie so we can restore it later
        const rawCookies = ctx.req.headers.cookie ?? "";
        const originalToken = rawCookies
          .split(";")
          .map((c) => c.trim())
          .find((c) => c.startsWith(COOKIE_NAME + "="))
          ?.slice(COOKIE_NAME.length + 1) ?? "";
        const cookieOpts = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, impersonationToken, { ...cookieOpts, maxAge: 1000 * 60 * 60 * 4 });
        ctx.res.cookie("app_session_admin_backup", originalToken, { ...cookieOpts, maxAge: 1000 * 60 * 60 * 4 });
        // Non-httpOnly flag cookie so the client JS can detect impersonation mode
        ctx.res.cookie("is_impersonating", "1", { ...cookieOpts, httpOnly: false, maxAge: 1000 * 60 * 60 * 4 });
        return { success: true, targetName: target.name ?? target.email };
      }),

    // Activate portal access for an agent (admin only)
    activatePortalAccess: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        await activatePortalAccess(input.userId);
        return { success: true };
      }),

    stopImpersonating: protectedProcedure.mutation(async ({ ctx }) => {
      const rawCookies = ctx.req.headers.cookie ?? "";
      const cookieMap = Object.fromEntries(
        rawCookies.split(";").map((c) => {
          const [k, ...v] = c.trim().split("=");
          return [k, v.join("=")];
        })
      );
      const adminToken = cookieMap["app_session_admin_backup"];
      if (!adminToken) throw new TRPCError({ code: "BAD_REQUEST", message: "No active impersonation session" });
      const cookieOpts = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, adminToken, { ...cookieOpts, maxAge: 1000 * 60 * 60 * 24 * 365 });
      ctx.res.clearCookie("app_session_admin_backup", cookieOpts);
      ctx.res.clearCookie("is_impersonating", cookieOpts);
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
        const rows = await getAllBookings(input);
        const allUsers = await getAllUsers();
        const userMap = new Map(allUsers.map((u) => [u.id, u]));
        return (rows as any[]).map((b) => ({
          ...b,
          agentName: userMap.get(b.agentId)?.name ?? null,
        }));
      }),
    ptsMissingPaymentDate: adminProcedure.query(async () => {
      return getPtsMissingPaymentDate();
    }),
    commissionClaimableMissingPaymentDate: adminProcedure.query(async () => {
      return getCommissionClaimableMissingPaymentDate();
    }),
    quickSearch: protectedProcedure
      .input(z.object({ query: z.string().min(1).max(100) }))
      .query(async ({ input, ctx }) => {
        const all = ctx.user.role === 'agent'
          ? await getBookingsByAgent(ctx.user.id)
          : await getAllBookings();
        const q = input.query.toLowerCase();
        const results = (all as any[]).filter((b) =>
          (b.clientName ?? '').toLowerCase().includes(q) ||
          (b.ptsRef ?? '').toLowerCase().includes(q) ||
          (b.topdogRef ?? '').toLowerCase().includes(q) ||
          String(b.id).includes(q)
        );
        return results.slice(0, 10);
      }),
    byId: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const booking = await getBookingWithAgent(input.id);
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
          bookedDate: z.date().optional(),
          topdogRef: z.string().optional(),
          reimbursementsRequired: z.boolean(),
          reimbursementDocUrl: z.string().optional(),
          expectedCommission: z.number().min(0).optional(),
          grossCost: z.number().min(0).optional(),
          destination: z.string().optional(),
          passengers: z.number().int().min(1).optional(),
          numberOfNights: z.number().int().min(0).optional(),
          isPersonalBooking: z.boolean().optional(),
          isHistoricBooking: z.boolean().optional(),
          reimbursementItems: z.array(z.object({
            supplierName: z.string().min(1),
            amount: z.number().positive(),
          })).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Duplicate guard: reject if same agent submitted same client name + departure date within 10 minutes
        const recentBookings = await getBookingsByAgent(ctx.user.id);
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const inputDeparture = input.departureDate.toISOString().slice(0, 10);
        const duplicate = recentBookings.find((b) => {
          const bDeparture = b.departureDate ? new Date(b.departureDate).toISOString().slice(0, 10) : null;
          const bCreated = b.createdAt ? new Date(b.createdAt as any) : null;
          return (
            b.clientName?.trim().toLowerCase() === input.clientName.trim().toLowerCase() &&
            bDeparture === inputDeparture &&
            bCreated !== null && bCreated > tenMinutesAgo
          );
        });
        if (duplicate) {
          const minsAgo = Math.round((Date.now() - new Date(duplicate.createdAt as any).getTime()) / 60000);
          throw new TRPCError({
            code: "CONFLICT",
            message: `A booking for "${input.clientName}" with that departure date was already submitted ${minsAgo} minute(s) ago (Booking #${duplicate.id}). If this is a different booking, please wait a few minutes before resubmitting.`,
          });
        }
        const booking = await createBooking({ ...input, agentId: ctx.user.id });
        // Create reimbursement items if provided
        if (booking?.id && input.reimbursementItems && input.reimbursementItems.length > 0) {
          await createReimbursementItems(
            input.reimbursementItems.map((item) => ({
              bookingId: booking.id,
              agentId: ctx.user.id,
              supplierName: item.supplierName,
              amount: item.amount,
              isLate: false,
            }))
          );
        }
        // If historic booking, move immediately to "Added to PTS" and auto-schedule reimbursements
        if (input.isHistoricBooking && booking?.id) {
          await updateBookingStage(booking.id, "Added to PTS", ctx.user.id);
          await scheduleReimbursementsForBooking(booking.id);
          await createNote({
            bookingId: booking.id,
            authorId: ctx.user.id,
            content: `[System] Historic booking — automatically moved to "Added to PTS" by ${ctx.user.name ?? "Agent"}.`,
            isInternal: false,
          });
        }
        // Notify all admins of new booking
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: booking?.id,
            message: `New booking registered by ${ctx.user.name}: ${input.clientName}`,
            linkUrl: `/bookings/${booking?.id}`,
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
        // Upload to S3 and store in reimbursement_docs table (multi-doc support)
        const buffer = Buffer.from(input.fileBase64, "base64");
        const key = `reimb-docs/${input.bookingId}-${nanoid(8)}-${input.fileName}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        await addReimbursementDoc({
          bookingId: input.bookingId,
          uploadedById: ctx.user.id,
          fileUrl: url,
          fileName: input.fileName,
          mimeType: input.mimeType,
        });
        // Also update the legacy reimbursementDocUrl field for backwards compatibility
        await uploadReimbursementDoc(input.bookingId, url, false);

        // Create a system audit note for the doc upload (no amendment record — docs are tracked in reimbursement_docs table)
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: `[System] Reimbursement document uploaded by ${ctx.user.name ?? "Agent"}: ${input.fileName}.`,
          isInternal: false,
        });

        // Notify all admins in-app about the doc upload
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: input.bookingId,
            message: `📎 Reimbursement docs uploaded for booking #${input.bookingId} (${booking.clientName}) by ${ctx.user.name ?? "Agent"} — please set up reimbursement ASAP`,
            linkUrl: `/bookings/${input.bookingId}`,
          });
        }
        await sendDirectEmail({
          toEmail: "support@thejltgroup.co.uk",
          toName: "JLT Support",
          subject: `Reimbursement docs uploaded — ${booking.clientName} (Booking #${input.bookingId})`,
          html: `<p>Hi team,</p>
<p><strong>${ctx.user.name ?? "An agent"}</strong> has uploaded reimbursement documents for booking <strong>#${input.bookingId} — ${booking.clientName}</strong>.</p>
<p>Please set up the reimbursement as soon as possible.</p>
<p><a href="https://portal.thejltgroup.co.uk/bookings/${input.bookingId}" style="background:#70FFE8;color:#414141;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;margin-top:8px;">View Booking &rarr;</a></p>`,
        });
        return { success: true };
      }),
    listReimbDocs: protectedProcedure
      .input(z.object({ bookingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return getReimbursementDocs(input.bookingId);
      }),
    moveStage: adminProcedure
      .input(z.object({ bookingId: z.number(), toStage: z.string(), queryMessage: z.string().optional(), vatAmount: z.number().nullable().optional() }))
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

        // Pre-auth auto-claim: if moving to Commission Claimable and agent has pre-authorised,
        // skip the claimable stage and auto-create the commission claim, then move straight to Commission Claimed
        if (input.toStage === "Commission Claimable" && (booking as any).commissionPreAuthorised) {
          // Auto-create the commission claim with optional VAT
          const grossAmount = (booking as any).expectedCommission ? parseFloat((booking as any).expectedCommission) : undefined;
          const claim = await createCommissionClaim(booking.id, booking.agentId, "other", grossAmount);
          if (claim && input.vatAmount !== undefined && input.vatAmount !== null) {
            await updateCommissionVat(claim.id, input.vatAmount);
          }
          // Move directly to Commission Claimed
          const updated = await updateBookingStage(input.bookingId, "Commission Claimed", ctx.user.id);
          // Notify agent that commission was auto-processed
          const agent = await getUserById(booking.agentId);
          if (agent?.email) {
            await sendNotificationEmail({
              triggerKey: "commission_claimed",
              toEmail: agent.email,
              toName: agent.name ?? "Agent",
              variables: { clientName: booking.clientName, ptsRef: (booking as any).ptsRef ?? "", bookingId: String(booking.id) },
              bookingId: booking.id,
            });
            await createInAppNotification({
              userId: booking.agentId,
              bookingId: booking.id,
              message: `Your commission for "${booking.clientName}" has been automatically processed via pre-authorisation.`,
              linkUrl: `/bookings/${booking.id}`,
            });
          }
          await createNote({
            bookingId: booking.id,
            authorId: ctx.user.id,
            content: `[System] Commission auto-processed via pre-authorisation by ${ctx.user.name ?? "Admin"}. Booking moved directly to Commission Claimed.`,
            isInternal: true,
          });
          return updated;
        }

        const updated = await updateBookingStage(input.bookingId, input.toStage, ctx.user.id);

        // Store admin-entered VAT on the booking when marking Commission Claimable
        // so it is pre-populated on the commission claim when the agent submits
        if (input.toStage === "Commission Claimable" && input.vatAmount !== undefined) {
          await updateBookingAdminFields(input.bookingId, { commissionVat: input.vatAmount ?? null });
        }

        // Auto-schedule pending reimbursements when booking moves to "Added to PTS"
        if (input.toStage === "Added to PTS") {
          await scheduleReimbursementsForBooking(input.bookingId);
        }

        // Trigger notifications based on stage
        const agent = await getUserById(booking.agentId);
        const stageToTrigger: Record<string, string> = {
          "Not on Topdog": "not_on_topdog",
          Query: "query",
          "Reimb Docs Missing": "reimb_docs_missing",
          "Creating own PTS file": "creating_own_pts_file",
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
            variables: {
              clientName: booking.clientName,
              ptsRef: (booking as any).ptsRef ?? "",
            },
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
    togglePreAuth: protectedProcedure
      .input(z.object({ bookingId: z.number(), preAuthorised: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const db = await import("./db").then((m) => m.getDb());
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { bookings: bookingsTable } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(bookingsTable).set({ commissionPreAuthorised: input.preAuthorised }).where(eq(bookingsTable.id, input.bookingId));
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: `[System] Commission pre-authorisation ${input.preAuthorised ? 'enabled' : 'disabled'} by ${ctx.user.name ?? 'Agent'}.`,
          isInternal: false,
        });
        return { success: true };
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
    toggleSuppliersAndDocs: adminProcedure
      .input(z.object({ bookingId: z.number(), value: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        const db = await import("./db").then((m) => m.getDb());
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { bookings: bookingsTable } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(bookingsTable).set({ suppliersAndDocsAddedToPts: input.value } as any).where(eq(bookingsTable.id, input.bookingId));
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: `[System] "Suppliers & Docs Added to PTS" ${input.value ? 'marked complete' : 'unmarked'} by ${ctx.user.name ?? 'Admin'}.`,
          isInternal: true,
        });
        return { success: true };
      }),
    updateAdminFields: adminProcedure
      .input(
        z.object({
          bookingId: z.number(),
          ptsRef: z.string().optional(),
          topdogRef: z.string().optional(),
          destination: z.string().optional(),
          finalSupplierPaymentDate: z.date().nullable().optional(),
          expectedCommission: z.number().optional(),
          grossCost: z.number().optional(),
          passengers: z.number().int().min(1).optional(),
          numberOfNights: z.number().int().min(0).optional(),
          clientName: z.string().min(1).optional(),
          clientEmail: z.string().email().nullable().optional(),
          departureDate: z.date().optional(),
          bookedDate: z.date().nullable().optional(),
          isPersonalBooking: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { bookingId, ...data } = input;
        const result = await updateBookingAdminFields(bookingId, data as any);
        const booking = await getBookingById(bookingId);
        if (booking) {
          // Auto-move from "Creating own PTS file" to "Added to PTS" when ptsRef is set
          if (input.ptsRef && booking.currentStage === 'Creating own PTS file') {
            await updateBookingStage(bookingId, 'Added to PTS', ctx.user.id);
          }
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
          if (input.destination !== undefined) changes.push(`Destination set to "${input.destination}"`);
          if (input.expectedCommission !== undefined) changes.push(`Expected Commission set to £${input.expectedCommission}`);
          if (input.grossCost !== undefined) changes.push(`Gross Cost set to £${input.grossCost}`);
          if (input.clientName !== undefined) changes.push(`Client Name updated to "${input.clientName}"`);
          if (input.departureDate !== undefined) changes.push(`Departure Date updated to ${input.departureDate.toLocaleDateString('en-GB')}`);
          if (input.bookedDate !== undefined) changes.push(`Booked Date updated to ${input.bookedDate ? input.bookedDate.toLocaleDateString('en-GB') : 'cleared'}`);
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

    // Agent-only: update PTS ref and final supplier payment date
    // Only allowed when booking is in "Creating own PTS file" stage
    updatePtsDetails: protectedProcedure
      .input(z.object({
        bookingId: z.number(),
        ptsRef: z.string().min(1).optional(),
        finalSupplierPaymentDate: z.date().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: 'NOT_FOUND' });
        // Agents can only update their own bookings
        if (ctx.user.role === 'agent' && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN' });
        }
        // Allowed in "Creating own PTS file" stage, OR when ptsRef has not been set yet (e.g. historic imports)
        const ptsRefMissing = !booking.ptsRef;
        if (booking.currentStage !== 'Creating own PTS file' && !ptsRefMissing) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'PTS details can only be edited when the booking is in "Creating own PTS file" stage.' });
        }
        await updateBookingAdminFields(input.bookingId, {
          ...(input.ptsRef !== undefined ? { ptsRef: input.ptsRef } : {}),
          ...(input.finalSupplierPaymentDate !== undefined ? { finalSupplierPaymentDate: input.finalSupplierPaymentDate } : {}),
        });
        // Auto-move from "Creating own PTS file" to "Added to PTS" when ptsRef is provided
        if (input.ptsRef && booking.currentStage === 'Creating own PTS file') {
          await updateBookingStage(input.bookingId, 'Added to PTS', ctx.user.id);
        }
        const changes: string[] = [];
        if (input.ptsRef) changes.push(`PTS Ref set to "${input.ptsRef}"`);
        if (input.finalSupplierPaymentDate) changes.push(`Final Supplier Payment Date set to ${input.finalSupplierPaymentDate.toLocaleDateString('en-GB')}`);
        if (changes.length > 0) {
          await createNote({
            bookingId: input.bookingId,
            authorId: ctx.user.id,
            content: `[System] Agent updated PTS details: ${changes.join('; ')}.`,
            isInternal: false,
          });
        }
        return { success: true };
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
            grossCost: z.number().optional(),
            finalSupplierPaymentDate: z.date().optional(),
          })
        )
      )
      .mutation(async ({ input, ctx }) => {
        const results: Array<{ clientName: string; success: boolean; bookingId?: number; error?: string; skipped?: boolean }> = [];
        // Load all existing bookings once for deduplication
        const existingBookings = await getAllBookings({});
        const existingTopdogRefs = new Set(existingBookings.map((b) => b.topdogRef).filter(Boolean));
        const existingPtsRefs = new Set(existingBookings.map((b) => b.ptsRef).filter(Boolean));
        for (const row of input) {
          try {
            // Deduplication: skip if topdogRef or ptsRef already exists
            if (row.topdogRef && existingTopdogRefs.has(row.topdogRef)) {
              results.push({ clientName: row.clientName, success: true, skipped: true, error: `duplicate_topdog_ref:${row.topdogRef}` });
              continue;
            }
            if (row.ptsRef && existingPtsRefs.has(row.ptsRef)) {
              results.push({ clientName: row.clientName, success: true, skipped: true, error: `duplicate_pts_ref:${row.ptsRef}` });
              continue;
            }
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
            // Track new refs for within-batch deduplication
            if (row.topdogRef) existingTopdogRefs.add(row.topdogRef);
            if (row.ptsRef) existingPtsRefs.add(row.ptsRef);
            // Apply extra fields (stage, ptsRef, commission, gross cost, payment date)
            const adminUpdates: Record<string, unknown> = {};
            if (row.ptsRef) adminUpdates.ptsRef = row.ptsRef;
            if (row.expectedCommission !== undefined) adminUpdates.expectedCommission = row.expectedCommission;
            if (row.grossCost !== undefined) adminUpdates.grossCost = row.grossCost;
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

    // Bulk move multiple bookings to a given stage (admin only)
    bulkMoveStage: adminProcedure
      .input(z.object({
        bookingIds: z.array(z.number()).min(1),
        toStage: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const STAGES_REQUIRING_PAYMENT_DATE = [
          "Added to PTS",
          "Commission Claimable",
          "Commission Claimed",
          "Holding Accounts",
        ];
        const results: Array<{ bookingId: number; success: boolean; error?: string }> = [];
        for (const bookingId of input.bookingIds) {
          try {
            const booking = await getBookingById(bookingId);
            if (!booking) { results.push({ bookingId, success: false, error: "not_found" }); continue; }
            if (STAGES_REQUIRING_PAYMENT_DATE.includes(input.toStage) && !booking.finalSupplierPaymentDate) {
              results.push({ bookingId, success: false, error: "missing_payment_date" }); continue;
            }
            await updateBookingStage(bookingId, input.toStage, ctx.user.id);
            await createNote({
              bookingId,
              authorId: ctx.user.id,
              content: `[System] Booking stage bulk-moved from "${booking.currentStage}" to "${input.toStage}" by ${ctx.user.name ?? "Admin"}.`,
              isInternal: true,
            });
            // Notify agent
            const stageToTrigger: Record<string, string> = {
              "Commission Claimable": "commission_claimable",
              "Commission Claimed": "commission_claimed",
            };
            const triggerKey = stageToTrigger[input.toStage];
            const agent = await getUserById(booking.agentId);
            if (triggerKey && agent?.email) {
              await sendNotificationEmail({
                triggerKey,
                toEmail: agent.email,
                toName: agent.name ?? "Agent",
                variables: { clientName: booking.clientName, ptsRef: (booking as any).ptsRef ?? "" },
                bookingId: booking.id,
              });
              await createInAppNotification({
                userId: booking.agentId,
                bookingId: booking.id,
                message: `Your booking "${booking.clientName}" has moved to: ${input.toStage}`,
                linkUrl: `/bookings/${booking.id}`,
              });
            }
            results.push({ bookingId, success: true });
          } catch (err: any) {
            results.push({ bookingId, success: false, error: err?.message ?? "unknown" });
          }
        }
         const succeeded = results.filter((r) => r.success).length;
        return { results, total: input.bookingIds.length, succeeded };
      }),
    // Super admin: hard delete a booking and all related records
    delete: superAdminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.id);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        await deleteBooking(input.id);
        return { success: true, deletedId: input.id, clientName: booking.clientName };
      }),
    // Super admin: merge source booking into target booking
    merge: superAdminProcedure
      .input(z.object({ sourceId: z.number(), targetId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (input.sourceId === input.targetId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Source and target must be different bookings" });
        }
        const source = await getBookingById(input.sourceId);
        const target = await getBookingById(input.targetId);
        if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Source booking not found" });
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Target booking not found" });
        await mergeBookings(input.sourceId, input.targetId);
        // Add audit note to target booking
        await createNote({
          bookingId: input.targetId,
          authorId: ctx.user.id,
          content: `[System] Booking #${input.sourceId} (${source.clientName}) was merged into this booking by ${ctx.user.name ?? "Super Admin"}. All documents, notes, amendments, refunds, and cancellations have been moved here.`,
          isInternal: true,
        });
        return { success: true, mergedId: input.sourceId, targetId: input.targetId };
      }),
    // Delete a single reimbursement document
    deleteReimbDoc: protectedProcedure
      .input(z.object({ docId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // deleteReimbursementDoc returns the row or null
        const doc = await deleteReimbursementDoc(input.docId);
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
        // Agents can only delete their own uploads; admins/super_admins can delete any
        if (ctx.user.role === "agent" && doc.uploadedById !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return { success: true, docId: input.docId };
      }),
    // Agent/Admin: upload a document to attach to a message (not a reimbursement doc)
    uploadMessageDoc: protectedProcedure
      .input(z.object({
        bookingId: z.number(),
        fileBase64: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const buffer = Buffer.from(input.fileBase64, "base64");
        const key = `msg-attachments/${input.bookingId}-${nanoid(8)}-${input.fileName}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url, fileName: input.fileName };
      }),
  }),
  // ── Notes ─────────────────────────────────────────────────────────────────
  notes: router({
    // Admin: get all bookings with unread agent messages
    unreadAgentMessages: adminProcedure.query(async () => {
      return getBookingsWithUnreadAgentNotes();
    }),
    // Admin: get booking IDs with unread agent messages (lightweight, for Kanban badges)
    unreadBookingIds: adminProcedure.query(async () => {
      return getUnreadBookingIds();
    }),
    // Admin: all message threads (for Messages page)
    allThreads: adminProcedure.query(async () => {
      return getAllMessageThreads();
    }),
    // Admin: total count of bookings with unread agent messages (for sidebar badge)
    totalUnreadCount: adminProcedure.query(async () => {
      return getTotalUnreadMessageCount();
    }),
    // Admin: mark ALL unread agent notes as read ("Mark all as read" button on Messages page)
    markAllRead: adminProcedure.mutation(async () => {
      await markAllAgentNotesAsRead();
      return { success: true };
    }),
    // Admin: get unread agent note count for a specific booking (for booking detail page indicator)
    getUnreadCountForBooking: adminProcedure
      .input(z.object({ bookingId: z.number() }))
      .query(async ({ input }) => {
        const count = await getUnreadAgentNoteCountForBooking(input.bookingId);
        return { count };
      }),
    // Admin: mark all notes on a booking as read
    markBookingNotesRead: adminProcedure
      .input(z.object({ bookingId: z.number() }))
      .mutation(async ({ input }) => {
        await markNotesReadByAdmin(input.bookingId);
        return { success: true };
      }),
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
                // Also send email to the mentioned admin (fire-and-forget)
                if (mentioned.email) {
                  const mentionerName = ctx.user.name ?? "An admin";
                  const notePreview = input.content.length > 300 ? input.content.slice(0, 300) + "..." : input.content;
                  void sendDirectEmail({
                    toEmail: mentioned.email,
                    toName: mentioned.name ?? mentioned.email,
                    subject: `You were mentioned in a note — ${booking.clientName}`,
                    html: `
                      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                        <div style="background:#1a1a2e;padding:20px;border-radius:8px 8px 0 0;">
                          <h2 style="color:#70FFE8;margin:0;font-size:18px;">You were mentioned in a note</h2>
                        </div>
                        <div style="background:#f9f9f9;padding:20px;border:1px solid #e0e0e0;">
                          <p style="margin:0 0 12px;"><strong>${mentionerName}</strong> mentioned you in an internal note on booking <strong>${booking.clientName}</strong>.</p>
                          <div style="background:#fff;border-left:4px solid #70FFE8;padding:12px 16px;border-radius:4px;margin:12px 0;font-style:italic;color:#333;">
                            ${notePreview.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}
                          </div>
                          <p style="margin-top:16px;">
                            <a href="https://portal.thejltgroup.co.uk/bookings/${input.bookingId}" style="display:inline-block;background:#70FFE8;color:#1a1a2e;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">View Booking &rarr;</a>
                          </p>
                        </div>
                        <div style="background:#e8e8e8;padding:12px 20px;border-radius:0 0 8px 8px;font-size:12px;color:#666;">
                          JLT Group Booking Portal &bull; Internal notification
                        </div>
                      </div>`,
                  });
                }
              }
            }
          }
        }

        // Notify the other party for shared notes
        if (!input.isInternal) {
          if (ctx.user.role === "agent") {
            // Agent sent a message — notify all admins in-app, but only email the last admin who replied
            const allUsers = await getAllUsers();
            const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
            for (const admin of admins) {
              await createInAppNotification({
                userId: admin.id,
                bookingId: input.bookingId,
                message: `${ctx.user.name} left a note on booking "${booking.clientName}"`,
                linkUrl: `/bookings/${input.bookingId}`,
              });
            }
            // Email only the last admin who replied on this booking (or support@ as fallback) — fire-and-forget
            const lastAdminReply = await getLastAdminNoteAuthor(input.bookingId);
            const replyToEmail = lastAdminReply?.email ?? "support@thejltgroup.co.uk";
            const replyToName = lastAdminReply?.name ?? "JLT Support";
            void sendDirectEmail({
              toEmail: replyToEmail,
              toName: replyToName,
              subject: `New message from ${ctx.user.name} — Booking: ${booking.clientName}`,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                  <h2 style="color:#1a1a2e;">New Agent Message</h2>
                  <p><strong>${ctx.user.name}</strong> has left a message on booking <strong>${booking.clientName}</strong> (Booking #${input.bookingId}).</p>
                  <div style="background:#f5f5f5;border-left:4px solid #70FFE8;padding:12px 16px;margin:16px 0;border-radius:4px;">
                    <p style="margin:0;color:#333;">${input.content.replace(/\n/g, '<br>')}</p>
                  </div>
                  <a href="https://portal.thejltgroup.co.uk/bookings/${input.bookingId}" style="display:inline-block;background:#70FFE8;color:#1a1a2e;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">View Booking &amp; Reply</a>
                  <p style="color:#888;font-size:12px;margin-top:24px;">JLT Group Booking Portal</p>
                </div>
              `,
            });
          } else {
            // Admin sent a message — notify the agent (in-app + email)
            await createInAppNotification({
              userId: booking.agentId,
              bookingId: input.bookingId,
              message: `Admin left a note on your booking "${booking.clientName}"`,
              linkUrl: `/bookings/${input.bookingId}`,
            });
            // Email the agent (fire-and-forget)
            const agent = await getUserById(booking.agentId);
            if (agent?.email) {
              void sendDirectEmail({
                toEmail: agent.email,
                toName: agent.name ?? "Agent",
                subject: `New message on your booking: ${booking.clientName}`,
                html: `
                  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                    <h2 style="color:#1a1a2e;">New Message from JLT Group</h2>
                    <p>There is a new message on your booking for <strong>${booking.clientName}</strong> (Booking #${input.bookingId}).</p>
                    <div style="background:#f5f5f5;border-left:4px solid #70FFE8;padding:12px 16px;margin:16px 0;border-radius:4px;">
                      <p style="margin:0;color:#333;">${input.content.replace(/\n/g, '<br>')}</p>
                    </div>
                    <a href="https://portal.thejltgroup.co.uk/bookings/${input.bookingId}" style="display:inline-block;background:#70FFE8;color:#1a1a2e;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">View Booking &amp; Reply</a>
                    <p style="color:#888;font-size:12px;margin-top:24px;">JLT Group Booking Portal</p>
                  </div>
                `,
              });
            }
            // Mark existing unread agent notes as read (fire-and-forget)
            void markNotesReadByAdmin(input.bookingId);
          }
        }
        return { success: true };
      }),
  }),

  // ── Amendments ────────────────────────────────────────────────────────────
  amendments: router({
    submit: protectedProcedure
      .input(z.object({
        bookingId: z.number(),
        details: z.string().min(1),
        lineItems: z.array(z.object({
          type: z.enum(["add_supplier", "remove_supplier", "change_cost", "other"]),
          supplierName: z.string().optional().nullable(),
          cost: z.string().optional().nullable(),
          oldCost: z.string().optional().nullable(),
          notes: z.string().optional().nullable(),
        })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await createAmendment({ ...input, agentId: ctx.user.id, lineItems: input.lineItems });
        // System audit note — show structured summary if line items present
        const summaryLines = (input.lineItems ?? []).map((li) => {
          const typeLabel = li.type === "add_supplier" ? "Add" : li.type === "remove_supplier" ? "Remove" : li.type === "change_cost" ? "Change Cost" : "Other";
          const parts = [typeLabel];
          if (li.supplierName) parts.push(li.supplierName);
          if (li.cost) parts.push(`£${li.cost}`);
          return parts.join(": ");
        });
        const auditContent = summaryLines.length > 0
          ? `[System] Amendment submitted by ${ctx.user.name ?? "Agent"}: ${summaryLines.join(" | ")}.`
          : `[System] Amendment submitted by ${ctx.user.name ?? "Agent"}: ${input.details.slice(0, 120)}.`;
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: auditContent,
          isInternal: false,
        });
        // Notify admins in-app + email support@ for workflow events
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: input.bookingId,
            message: `Amendment submitted for booking "${booking.clientName}" by ${ctx.user.name}`,
            linkUrl: `/bookings/${input.bookingId}`,
          });
        }
        // Admin email notification disabled — admins use dashboard + in-app notifications
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
    getLineItems: protectedProcedure
      .input(z.object({ amendmentId: z.number() }))
      .query(async ({ input }) => {
        const { getLineItemsByAmendment } = await import("./db");
        return getLineItemsByAmendment(input.amendmentId);
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
        const updated = await updateAmendmentPipeline(amendmentId, { ...data, actionedById: ctx.user.id } as any);
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
        // Notify admins in-app + email support@ for workflow events
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: input.bookingId,
            message: `Cancellation requested for booking "${booking.clientName}" by ${ctx.user.name}`,
            linkUrl: `/bookings/${input.bookingId}`,
          });
        }
        // Admin email notification disabled — admins use dashboard + in-app notifications
        return { success: true };
      }),
    all: adminProcedure.query(async () => getAllCancellations()),
    byBooking: adminProcedure
      .input(z.object({ bookingId: z.number() }))
      .query(async ({ input }) => {
        return getCancellationsByBooking(input.bookingId);
      }),
    markActioned: adminProcedure
      .input(z.object({ cancellationId: z.number(), moveToCancelled: z.boolean().optional() }))
      .mutation(async ({ input, ctx }) => {
        const db = await import("./db").then((m) => m.getDb());
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { cancellations: cancellationsTable } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        // Fetch the cancellation to get bookingId
        const [cancellation] = await db.select().from(cancellationsTable).where(eq(cancellationsTable.id, input.cancellationId));
        if (!cancellation) throw new TRPCError({ code: "NOT_FOUND" });
        await db
          .update(cancellationsTable)
          .set({ status: "actioned", processedById: ctx.user.id, processedAt: new Date() })
          .where(eq(cancellationsTable.id, input.cancellationId));
        // Optionally move the booking to the Cancelled stage
        if (input.moveToCancelled) {
          await updateBookingStage(cancellation.bookingId, "Cancelled", ctx.user.id);
          // Notify the agent
          const booking = await getBookingById(cancellation.bookingId);
          if (booking) {
            const agent = await getUserById(booking.agentId);
            if (agent?.email) {
              await sendNotificationEmail({
                triggerKey: "cancelled",
                toEmail: agent.email,
                toName: agent.name ?? "Agent",
                variables: { clientName: booking.clientName },
                bookingId: booking.id,
              });
            }
            await createInAppNotification({
              userId: booking.agentId,
              bookingId: booking.id,
              message: `Your booking "${booking.clientName}" has been marked as Cancelled.`,
              linkUrl: `/bookings/${booking.id}`,
            });
            await createNote({
              bookingId: booking.id,
              authorId: ctx.user.id,
              content: `[System] Booking moved to Cancelled stage by ${ctx.user.name ?? "Admin"} after cancellation request was actioned.`,
              isInternal: true,
            });
          }
        }
        return { success: true };
      }),
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
        // Notify admins in-app + email support@ for workflow events
        const allUsers = await getAllUsers();
        const admins = allUsers.filter((u) => u.role === "admin" || u.role === "super_admin");
        for (const admin of admins) {
          await createInAppNotification({
            userId: admin.id,
            bookingId: input.bookingId,
            message: `Refund request submitted for booking "${booking.clientName}" by ${ctx.user.name}`,
          });
        }
        // Admin email notification disabled — admins use dashboard + in-app notifications
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
        pipelineStage: z.enum(["New Refund Request", "Query", "Acknowledged by Supplier", "Refund Sent to PTS", "Refund Received in JLT", "Refund Processed"]).optional(),
        assignedToId: z.number().nullable().optional(),
        queryMessage: z.string().optional(), // message to send to agent when moving to Query
      }))
      .mutation(async ({ input, ctx }) => {
        const { refundId, queryMessage, ...data } = input;
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
            if (data.pipelineStage === "Query" && queryMessage) {
              // Send query message to agent via in-app notification and email
              await createInAppNotification({
                userId: booking.agentId,
                bookingId: booking.id,
                message: `Query on your refund for "${booking.clientName}": ${queryMessage}`,
                linkUrl: `/bookings/${booking.id}`,
              });
              // Also send email to agent
              const agent = await getUserById(booking.agentId);
              if (agent?.email) {
                await sendNotificationEmail({
                  triggerKey: "refund_query",
                  toEmail: agent.email,
                  toName: agent.name ?? "Agent",
                  variables: {
                    clientName: booking.clientName ?? "your client",
                    ptsRef: booking.ptsRef ?? "",
                    queryMessage,
                    adminName: ctx.user.name ?? "Admin",
                    bookingUrl: `/bookings/${booking.id}`,
                  },
                });
              }
              // Add the query message as a shared note on the booking (visible to agent in Messages tab)
              await createNote({
                bookingId: booking.id,
                authorId: ctx.user.id,
                content: `[Refund Query] ${queryMessage}`,
                isInternal: false,
              });
            } else {
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
    sendShortFundsMessage: adminProcedure
      .input(z.object({
        bookingId: z.number(),
        message: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const booking = await getBookingById(input.bookingId);
        if (!booking) throw new TRPCError({ code: 'NOT_FOUND' });
        const allUsers = await getAllUsers();
        const agent = allUsers.find((u) => u.id === booking.agentId);
        if (!agent) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
        // Post as a visible note on the booking (agent can see it)
        await createNote({
          bookingId: input.bookingId,
          authorId: ctx.user.id,
          content: input.message,
          isInternal: false,
        });
        // Send in-app notification to the agent
        await createInAppNotification({
          userId: agent.id,
          bookingId: input.bookingId,
          message: `Action required on booking #${input.bookingId} (${booking.clientName}): ${input.message.slice(0, 120)}${input.message.length > 120 ? '...' : ''}`,
          linkUrl: `/bookings/${input.bookingId}`,
        });
        // Send email to agent
        if (agent.email) {
          await sendDirectEmail({
            toEmail: agent.email,
            toName: agent.name ?? 'Agent',
            subject: `Action required — Booking #${input.bookingId} (${booking.clientName})`,
            html: `<p>Hi ${agent.name ?? 'there'},</p>
<p>${input.message.replace(/\n/g, '<br/>')}</p>
<p>If you have any questions, please contact us at <a href="mailto:memberships@thejltgroup.co.uk">memberships@thejltgroup.co.uk</a>.</p>
<p>The JLT Group Team</p>`,
          });
        }
        return { success: true };
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
        grossAmount: z.number().positive({ message: "Please enter your expected gross commission amount" }),
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
        const claim = await createCommissionClaim(input.bookingId, ctx.user.id, input.bookingType, input.grossAmount);
        // Auto-apply admin-set VAT to the claim if it was recorded when the booking was marked claimable
        if (claim && (booking as any).commissionVat != null) {
          await updateCommissionVat(claim.id, parseFloat(String((booking as any).commissionVat)));
        }
        // Sync the booking's expectedCommission with the gross amount the agent declared
        await updateBookingAdminFields(input.bookingId, { expectedCommission: input.grossAmount });
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
            linkUrl: `/bookings/${input.bookingId}`,
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
    // Agent: earnings summary for dashboard
    myEarningsSummary: protectedProcedure.query(async ({ ctx }) => {
      const claims = await getCommissionClaimsByAgent(ctx.user.id);
      const agentBookings = await getBookingsByAgent(ctx.user.id);
      const bookingMap = new Map(agentBookings.map((b) => [b.id, b]));
      let paidTotal = 0;
      let awaitingPaymentTotal = 0;
      let processingTotal = 0;
      let claimableTotal = 0;
      let pendingTotal = 0;
      const claimedBookingIds = new Set(claims.map((c) => c.bookingId));
      for (const claim of claims) {
        const booking = bookingMap.get(claim.bookingId);
        const amount = Number(booking?.expectedCommission ?? 0);
        if (claim.status === 'paid') {
          paidTotal += amount;
        } else if (claim.status === 'awaiting_payment') {
          awaitingPaymentTotal += amount;
        } else if (claim.status === 'processing') {
          processingTotal += amount;
        }
      }
      // Bookings with no claim record
      for (const b of agentBookings) {
        if (claimedBookingIds.has(b.id) || b.currentStage === 'Cancelled') continue;
        const amount = Number(b.expectedCommission ?? 0);
        if (!amount) continue;
        if (b.currentStage === 'Commission Claimable') {
          claimableTotal += amount;
        } else if (b.currentStage === 'Commission Claimed') {
          // Claimed stage but no claim record — treat as paid/processed
          paidTotal += amount;
        } else {
          pendingTotal += amount;
        }
      }
      const grandTotal = paidTotal + awaitingPaymentTotal + processingTotal + claimableTotal + pendingTotal;
      return { paidTotal, awaitingPaymentTotal, processingTotal, claimableTotal, pendingTotal, grandTotal };
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

    // Admin: delete a commission claim (e.g. test claims or holding accounts)
    deleteClaim: adminProcedure
      .input(z.object({ claimId: z.number() }))
      .mutation(async ({ input }) => {
        // Also revert the booking back to Commission Claimable so the agent can re-claim if needed
        const allClaims = await getAllCommissionClaims();
        const claim = allClaims.find((c) => c.id === input.claimId);
        if (claim) {
          await updateBookingStage(claim.bookingId, "Commission Claimable", 0);
        }
        await deleteCommissionClaim(input.claimId);
        return { success: true };
      }),

    // Admin: update VAT amount on a claim
    updateVat: adminProcedure
      .input(z.object({ claimId: z.number(), vatAmount: z.number().nonnegative().nullable() }))
      .mutation(async ({ input }) => {
        await updateCommissionVat(input.claimId, input.vatAmount);
        return { success: true };
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
            message: `Your commission for booking "${booking.clientName}" has been claimed and will be paid to you in the next payment run. Please note, claims processed after Wednesday may fall into next week's payment run.`,
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
            content: `[System] Commission claimed in PTS by ${ctx.user.name ?? "Admin"}.`,
            isInternal: false,
          });
        }
        return { success: true };
      }),

    // Admin: preview VAT backfill from a CSV (match by topdogRef/ptsRef → booking → claim)
    previewVatFromCsv: adminProcedure
      .input(z.object({
        rows: z.array(z.object({
          ref: z.string(),
          clientName: z.string(),
          vat: z.number(),
        })),
      }))
      .query(async ({ input }) => {
        const { getDb } = await import('./db');
        const { bookings: bookingsTable, commissionClaims: claimsTable } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) return [];
        const results: Array<{
          ref: string;
          csvClient: string;
          vat: number;
          status: 'matched' | 'no_booking' | 'no_claim';
          claimId: number | null;
          claimStatus: string | null;
          currentVat: number | null;
          bookingClient: string | null;
        }> = [];
        for (const row of input.rows) {
          const ref = row.ref.trim();
          if (!ref) continue;
          // Match booking by topdogRef first, then ptsRef
          let bookingRows = await db
            .select({ id: bookingsTable.id, clientName: bookingsTable.clientName })
            .from(bookingsTable)
            .where(eq(bookingsTable.topdogRef, ref))
            .limit(1);
          if (bookingRows.length === 0) {
            bookingRows = await db
              .select({ id: bookingsTable.id, clientName: bookingsTable.clientName })
              .from(bookingsTable)
              .where(eq(bookingsTable.ptsRef, ref))
              .limit(1);
          }
          if (bookingRows.length === 0) {
            results.push({ ref, csvClient: row.clientName, vat: row.vat, status: 'no_booking', claimId: null, claimStatus: null, currentVat: null, bookingClient: null });
            continue;
          }
          const booking = bookingRows[0];
          const claimRows = await db
            .select({ id: claimsTable.id, vatAmount: claimsTable.vatAmount, status: claimsTable.status })
            .from(claimsTable)
            .where(eq(claimsTable.bookingId, booking.id))
            .orderBy(claimsTable.createdAt)
            .limit(1);
          if (claimRows.length === 0) {
            results.push({ ref, csvClient: row.clientName, vat: row.vat, status: 'no_claim', claimId: null, claimStatus: null, currentVat: null, bookingClient: booking.clientName });
            continue;
          }
          const claim = claimRows[0];
          const currentVat = claim.vatAmount !== null ? parseFloat(String(claim.vatAmount)) : null;
          results.push({ ref, csvClient: row.clientName, vat: row.vat, status: 'matched', claimId: claim.id, claimStatus: claim.status, currentVat, bookingClient: booking.clientName });
        }
        return results;
      }),

    // Admin: apply VAT figures from CSV to matched commission claims
    applyVatFromCsv: adminProcedure
      .input(z.object({
        updates: z.array(z.object({
          claimId: z.number(),
          vat: z.number(),
        })),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import('./db');
        const { commissionClaims: claimsTable } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        let updated = 0;
        for (const u of input.updates) {
          await db
            .update(claimsTable)
            .set({ vatAmount: u.vat.toFixed(2) })
            .where(eq(claimsTable.id, u.claimId));
          updated++;
        }
        return { updated };
      }),

    // Agent: self-serve mark their own awaiting_payment commission as paid
    markAgentPaid: protectedProcedure
      .input(z.object({ claimIds: z.array(z.number()).min(1) }))
      .mutation(async ({ input, ctx }) => {
        const { markCommissionAgentPaid } = await import("./db");
        const allClaims = await getAllCommissionClaims();
        for (const claimId of input.claimIds) {
          const claim = allClaims.find((c) => c.id === claimId);
          if (!claim) continue;
          // Agents can only mark their own claims
          if (ctx.user.role === "agent" && claim.agentId !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
          if (claim.status !== "awaiting_payment") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Claim is not in awaiting payment status" });
          }
        }
        await markCommissionAgentPaid(input.claimIds);
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

  // ── System Settings ────────────────────────────────────────────────────────────────────────────────────────
  settings: router({
    getNotificationsPaused: adminProcedure.query(async () => {
      return { paused: await areNotificationsPaused() };
    }),
    setNotificationsPaused: adminProcedure
      .input(z.object({ paused: z.boolean() }))
      .mutation(async ({ input }) => {
        await setSystemSetting("notifications_paused", input.paused ? "true" : "false");
        return { paused: input.paused };
      }),
  }),
  // ── Admin Notification Preferences ─────────────────────────────────────────────────────────────────────────
  notifPrefs: router({
    // Get own notification preferences
    list: adminProcedure.query(async ({ ctx }) => {
      return getAdminNotifPrefs(ctx.user.id);
    }),
    // Toggle a specific trigger key on/off
    update: adminProcedure
      .input(z.object({ triggerKey: z.string(), emailEnabled: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        await upsertAdminNotifPref(ctx.user.id, input.triggerKey, input.emailEnabled);
        return { success: true };
      }),
  }),
  // ── Admin Tasks ─────────────────────────────────────────────────────────────────────────────────────────────
  tasks: router({
    list: adminProcedure.query(async () => {
      const tasks = await getAllAdminTasks();
      // Enrich with assignee and creator names
      const enriched = await Promise.all(tasks.map(async (t) => {
        const assignee = t.assigneeId ? await getUserById(t.assigneeId) : null;
        const creator = await getUserById(t.createdById);
        return {
          ...t,
          assigneeName: assignee?.name ?? null,
          creatorName: creator?.name ?? null,
        };
      }));
      return enriched;
    }),
    create: adminProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        assigneeId: z.number().optional(),
        dueDate: z.date().optional(),
        linkedType: z.enum(["booking", "amendment", "refund", "cancellation", "none"]).optional(),
        linkedId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const task = await createAdminTask({ ...input, createdById: ctx.user.id });
        // Notify assignee if different from creator
        if (input.assigneeId && input.assigneeId !== ctx.user.id) {
          await createInAppNotification({
            userId: input.assigneeId,
            message: `You have been assigned a new task: "${input.title}" by ${ctx.user.name ?? "Admin"}`,
            linkUrl: `/admin/tasks`,
          });
        }
        return task;
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        status: z.enum(["open", "in_progress", "done"]).optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        assigneeId: z.number().nullable().optional(),
        dueDate: z.date().nullable().optional(),
        linkedType: z.enum(["booking", "amendment", "refund", "cancellation", "none"]).optional(),
        linkedId: z.number().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const existing = await getAdminTaskById(id);
        const updated = await updateAdminTask(id, data as any);
        // Notify new assignee if changed
        if (data.assigneeId && data.assigneeId !== existing?.assigneeId && data.assigneeId !== ctx.user.id) {
          await createInAppNotification({
            userId: data.assigneeId,
            message: `You have been assigned task: "${updated?.title ?? input.title}" by ${ctx.user.name ?? "Admin"}`,
            linkUrl: `/admin/tasks`,
          });
        }
        return updated;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteAdminTask(input.id);
        return { success: true };
      }),
    getComments: adminProcedure
      .input(z.object({ taskId: z.number() }))
      .query(async ({ input }) => {
        const comments = await getAdminTaskComments(input.taskId);
        const enriched = await Promise.all(comments.map(async (c) => {
          const author = await getUserById(c.authorId);
          return { ...c, authorName: author?.name ?? "Admin" };
        }));
        return enriched;
      }),
    addComment: adminProcedure
      .input(z.object({ taskId: z.number(), content: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const task = await getAdminTaskById(input.taskId);
        if (!task) throw new TRPCError({ code: "NOT_FOUND" });
        await addAdminTaskComment({ taskId: input.taskId, authorId: ctx.user.id, content: input.content });
        // Auto-mirror to booking notes if task is linked to a booking
        if (task.linkedType === "booking" && task.linkedId) {
          await createNote({
            bookingId: task.linkedId,
            authorId: ctx.user.id,
            content: `[Task: ${task.title}] ${ctx.user.name ?? "Admin"}: ${input.content}`,
            isInternal: true,
          });
        }
        // Notify assignee of new comment (if not the commenter)
        if (task.assigneeId && task.assigneeId !== ctx.user.id) {
          await createInAppNotification({
            userId: task.assigneeId,
            message: `New comment on task "${task.title}" by ${ctx.user.name ?? "Admin"}`,
            linkUrl: `/admin/tasks`,
          });
        }
        // Notify creator of new comment (if not the commenter and not the assignee)
        if (task.createdById !== ctx.user.id && task.createdById !== task.assigneeId) {
          await createInAppNotification({
            userId: task.createdById,
            message: `New comment on your task "${task.title}" by ${ctx.user.name ?? "Admin"}`,
            linkUrl: `/admin/tasks`,
          });
        }
        return { success: true };
      }),
    // Count of open tasks assigned to the current user (for sidebar badge)
    myOpenCount: adminProcedure.query(async ({ ctx }) => {
      const tasks = await getAllAdminTasks();
      return tasks.filter((t) => t.assigneeId === ctx.user.id && t.status !== "done").length;
    }),
  }),
  // ─── Calendar ──────────────────────────────────────────────────────────────
  calendar: router({
    list: adminProcedure
      .input(
        z.object({
          from: z.date(),
          to: z.date(),
        })
      )
      .query(async ({ input }) => {
        return getCalendarEvents(input.from, input.to);
      }),

    create: adminProcedure
      .input(
        z.object({
          title: z.string().min(1),
          description: z.string().optional(),
          type: z.enum(["holiday", "event", "task"]),
          startDate: z.date(),
          endDate: z.date(),
          allDay: z.boolean().default(true),
          assigneeId: z.number().nullable().optional(),
          recurrenceRule: z.enum(["none", "daily", "weekly", "monthly", "yearly"]).default("none"),
          recurrenceEndDate: z.date().nullable().optional(),
          dueDate: z.date().nullable().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        return createCalendarEvent({ ...input, createdById: ctx.user.id });
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          type: z.enum(["holiday", "event", "task"]).optional(),
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          allDay: z.boolean().optional(),
          assigneeId: z.number().nullable().optional(),
          recurrenceRule: z.enum(["none", "daily", "weekly", "monthly", "yearly"]).optional(),
          recurrenceEndDate: z.date().nullable().optional(),
          dueDate: z.date().nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateCalendarEvent(id, data);
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteCalendarEvent(input.id);
        return { success: true };
      }),

    // Called by a scheduled job (or manually) to send due-date reminders for tasks due tomorrow
    sendTaskReminders: adminProcedure.mutation(async () => {
      const tasks = await getTasksDueForReminder();
      let sent = 0;
      for (const task of tasks) {
        if (task.assigneeId) {
          const dueDateStr = task.dueDate
            ? new Date(task.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : "tomorrow";
          await createInAppNotification({
            userId: task.assigneeId,
            message: `Reminder: Task "${task.title}" is due ${dueDateStr}.`,
            linkUrl: `/admin/calendar`,
          });
          await markCalendarReminderSent(task.id);
          sent++;
        }
      }
      return { sent };
    }),
  }),

  reimbursements: router({
    // Agent: get reimbursements for their own booking
    getByBooking: protectedProcedure
      .input(z.object({ bookingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const items = await getReimbursementsByBooking(input.bookingId);
        // Agents can only see their own booking's reimbursements
        if (ctx.user.role === "agent" && items.length > 0 && items[0].agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return items;
      }),

    // Admin: list all reimbursements with optional status filter
    list: adminProcedure
      .input(z.object({ status: z.enum(["pending", "scheduled", "paid"]).optional() }))
      .query(async ({ input }) => {
        return getReimbursementsAdmin(input);
      }),

    // Admin: dashboard stats
    dashboardStats: adminProcedure.query(async () => {
      return getReimbursementDashboardStats();
    }),

    // Admin: update status (pending→scheduled or scheduled→paid)
    updateStatus: adminProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "scheduled", "paid"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const item = await updateReimbursementStatus(input.id, input.status, ctx.user.id);
        // If a late reimbursement is moved to scheduled, notify the agent
        if (item && item.isLate && input.status === "scheduled") {
          await createInAppNotification({
            userId: item.agentId,
            message: `Your reimbursement for "${item.supplierName}" has been scheduled for payment.`,
            linkUrl: `/agent/bookings/${item.bookingId}`,
          });
          // Also send email notification
          try {
            const agent = await getUserById(item.agentId);
            const { getBookingById: _getBookingForEmail } = await import("./db");
            const bookingForEmail = await _getBookingForEmail(item.bookingId);
            if (agent?.email) {
              await sendNotificationEmail({
                triggerKey: "reimbursement_scheduled",
                toEmail: agent.email,
                toName: agent.name ?? "Agent",
                bookingId: item.bookingId,
                variables: {
                  supplierName: item.supplierName,
                  amount: `£${Number(item.amount).toFixed(2)}`,
                  clientName: bookingForEmail?.clientName ?? "your client",
                },
              });
            }
          } catch { /* email failure is non-fatal */ }
        }
        return { success: true };
      }),

    // Agent: add late reimbursement items to an existing booking
    addLate: protectedProcedure
      .input(z.object({
        bookingId: z.number(),
        items: z.array(z.object({
          supplierName: z.string().min(1),
          amount: z.number().positive(),
        })).min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verify booking belongs to this agent
        const { getBookingById: getBooking } = await import("./db");
        const booking = await getBooking(input.bookingId);
        if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && booking.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        // Determine if this is late (booking already at Added to PTS or later)
        const lateStages = ["Added to PTS", "Commission Claimable", "Commission Claimed", "Cancelled", "Holding Accounts"];
        const isLate = lateStages.includes(booking.currentStage);
        const created = await createReimbursementItems(
          input.items.map((item) => ({
            bookingId: input.bookingId,
            agentId: booking.agentId,
            supplierName: item.supplierName,
            amount: item.amount,
            isLate,
          }))
        );
        // Notify admins of late reimbursement
        if (isLate) {
          const admins = (await getAllUsers()).filter((u) => u.role === "admin" || u.role === "super_admin");
          for (const admin of admins) {
            await createInAppNotification({
              userId: admin.id,
              message: `Late reimbursement added to booking #${input.bookingId} (${booking.clientName}) by ${ctx.user.name ?? "agent"}.`,
              linkUrl: `/bookings/${input.bookingId}`,
            });
          }
        }
        return created;
      }),

    // Agent/Admin: upload a document for a specific reimbursement item
    uploadItemDoc: protectedProcedure
      .input(z.object({
        reimbursementItemId: z.number(),
        bookingId: z.number(),
        // Accept either a full URL (already uploaded) or a base64 data URL
        fileUrl: z.string().min(1),
        fileKey: z.string(),
        fileName: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { addReimbursementItemDoc } = await import("./db");
        // Verify the reimbursement item exists and belongs to this agent (if agent)
        const items = await getReimbursementsByBooking(input.bookingId);
        const item = items.find((i) => i.id === input.reimbursementItemId);
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role === "agent" && item.agentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        // If the client sent a base64 data URL, upload it to S3 first
        let finalUrl = input.fileUrl;
        if (input.fileUrl.startsWith("data:")) {
          const { storagePut } = await import("./storage");
          const matches = input.fileUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid file data" });
          const [, mimeType, b64] = matches;
          const buffer = Buffer.from(b64, "base64");
          const { url } = await storagePut(input.fileKey, buffer, mimeType);
          finalUrl = url;
        }
        const docs = await addReimbursementItemDoc({
          reimbursementItemId: input.reimbursementItemId,
          bookingId: input.bookingId,
          fileUrl: finalUrl,
          fileKey: input.fileKey,
          fileName: input.fileName,
          uploadedById: ctx.user.id,
        });
        // Keep the legacy reimbursementDocUrl field in sync so Kanban badges stay accurate
        await uploadReimbursementDoc(input.bookingId, finalUrl, false);
        // Notify admins when an agent uploads a doc
        if (ctx.user.role === "agent") {
          const admins = (await getAllUsers()).filter((u) => u.role === "admin" || u.role === "super_admin");
          for (const admin of admins) {
            await createInAppNotification({
              userId: admin.id,
              message: `Document uploaded for reimbursement "${item.supplierName}" on booking #${input.bookingId}.`,
              linkUrl: `/bookings/${input.bookingId}`,
            });
          }
        }
        return docs;
      }),

    // Agent/Admin: get docs for a specific reimbursement item
    getItemDocs: protectedProcedure
      .input(z.object({ reimbursementItemId: z.number(), bookingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const { getReimbursementItemDocs } = await import("./db");
        // Verify ownership for agents
        if (ctx.user.role === "agent") {
          const items = await getReimbursementsByBooking(input.bookingId);
          const item = items.find((i) => i.id === input.reimbursementItemId);
          if (!item || item.agentId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        }
        return getReimbursementItemDocs(input.reimbursementItemId);
      }),

    // Admin: assign a reimbursement item to an admin user
    assign: adminProcedure
      .input(z.object({ id: z.number(), assignedToId: z.number().nullable() }))
      .mutation(async ({ input }) => {
        const { updateReimbursementAssignee } = await import("./db");
        await updateReimbursementAssignee(input.id, input.assignedToId);
        return { success: true };
      }),

    // Admin: mark a late reimbursement as actioned
    markActioned: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { markReimbursementActioned } = await import("./db");
        await markReimbursementActioned(input.id);
        return { success: true };
      }),

    // Admin: get all admin users for assignee dropdown
    listAdminsForAssign: adminProcedure.query(async () => {
      const allUsers = await getAllUsers();
      return allUsers.filter((u) => u.role === "admin" || u.role === "super_admin").map((u) => ({ id: u.id, name: u.name ?? u.email }));
    }),

    // Agent: get bookings that have at least one reimbursement item with no docs
    myBookingsWithMissingDocs: protectedProcedure.query(async ({ ctx }) => {
      const { getReimbItemsWithMissingDocsByAgent } = await import("./db");
      return getReimbItemsWithMissingDocsByAgent(ctx.user.id);
    }),

    // Admin: count of outstanding reimbursements (pending, not yet scheduled)
    outstandingCount: adminProcedure.query(async () => {
      const { getOutstandingReimbursementsCount } = await import("./db");
      return getOutstandingReimbursementsCount();
    }),

    // Admin: count of late reimbursements that are unactioned (isLate=true, not scheduled/paid)
    lateUnactionedCount: adminProcedure.query(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return 0;
      const { reimbursementItems } = await import("../drizzle/schema");
      const { and, eq, ne } = await import("drizzle-orm");
      const rows = await db
        .select({ id: reimbursementItems.id })
        .from(reimbursementItems)
        .where(
          and(
            eq(reimbursementItems.isLate, true),
            ne(reimbursementItems.status, "scheduled"),
            ne(reimbursementItems.status, "paid")
          )
        );
      return rows.length;
    }),

    // Admin: delete a reimbursement item and all its associated docs
    deleteItem: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { deleteReimbursementItem } = await import("./db");
        await deleteReimbursementItem(input.id);
        return { success: true };
      }),
  }),

  // ─── Inbox / Booking Documents ───────────────────────────────────────────────
  crm: crmRouter,
  remittance: remittanceRouter,
  flightRequests: flightRequestsRouter,
  payments: paymentsRouter,
  join: joinRouter,

  // ─── GoCardless Direct Debit ───────────────────────────────────────────────
  gocardless: router({
    /**
     * Initiate DD setup: creates a GoCardless Billing Request + Flow and returns
     * the authorisation URL to redirect the agent to.
     */
    initDdSetup: protectedProcedure
      .input(
        z.object({
          preferredPaymentDay: z.number().int().min(1).max(28),
          origin: z.string().url(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = ctx.user;
        // Build name parts from full name
        const nameParts = (user.name ?? "").trim().split(/\s+/);
        const givenName = nameParts[0] ?? "";
        const familyName = nameParts.slice(1).join(" ") || undefined;

        // Create GoCardless billing request
        const brq = await createBillingRequest({
          givenName,
          familyName,
          email: user.email ?? undefined,
        });

        // Create the hosted flow
        const flow = await createBillingRequestFlow({
          billingRequestId: brq.id,
          redirectUri: `${input.origin}/dd-complete`,
          exitUri: `${input.origin}/dd-setup`,
        });

        // Store locally
        await createGcMandate({
          userId: user.id,
          billingRequestId: brq.id,
          billingRequestFlowId: flow.id,
          preferredPaymentDay: input.preferredPaymentDay,
          joiningFeePaidAt: new Date(), // treat now as joining fee date
        });

        return { authorisationUrl: flow.authorisation_url };
      }),

    /**
     * Get the current agent's mandate + subscription status.
     */
    getMyDdStatus: protectedProcedure.query(async ({ ctx }) => {
      const mandate = await getGcMandateByUserId(ctx.user.id);
      const subscription = await getGcSubscriptionByUserId(ctx.user.id);
      return { mandate, subscription };
    }),

    /**
     * Admin: list all mandates.
     */
    adminListMandates: adminProcedure.query(async () => {
      return getAllGcMandates();
    }),

    /**
     * Admin: get payment events for a specific agent.
     */
    adminGetPaymentEvents: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .query(async ({ input }) => {
        return getPaymentEventsByUserId(input.userId);
      }),

    /**
     * Admin: get all recent failed payments across all agents.
     */
    adminGetRecentFailedPayments: adminProcedure.query(async () => {
      return getRecentFailedPayments(50);
    }),

    /**
     * Admin: get mandate + subscription status for a specific agent.
     */
    adminGetDdStatus: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .query(async ({ input }) => {
        const mandate = await getGcMandateByUserId(input.userId);
        const subscription = await getGcSubscriptionByUserId(input.userId);
        // Also fetch preferredPaymentDay from CRM profile as the authoritative source
        const { getAgentCrmProfile } = await import("./agent-crm-db");
        const crmProfile = await getAgentCrmProfile(input.userId);
        const preferredPaymentDay = mandate?.preferredPaymentDay ?? crmProfile?.preferredPaymentDay ?? null;
        // If mandate row has stale preferredPaymentDay (hardcoded 1), sync it from CRM profile
        if (mandate && crmProfile?.preferredPaymentDay && mandate.preferredPaymentDay !== crmProfile.preferredPaymentDay) {
          const { updateGcMandate: updateMandate } = await import("./gocardless-db");
          await updateMandate(mandate.id, { preferredPaymentDay: crmProfile.preferredPaymentDay });
        }
        return { mandate: mandate ? { ...mandate, preferredPaymentDay } : null, subscription };
      }),

    /**
     * Admin: manually create a GoCardless subscription for an agent.
     * Used when the automatic subscription creation failed or was skipped.
     */
    adminCreateSubscription: adminProcedure
      .input(z.object({
        userId: z.number().int(),
        dayOfMonth: z.number().int().min(1).max(28),
        mandateId: z.string().optional(), // optional override when no DB mandate row exists
      }))
      .mutation(async ({ input, ctx }) => {
        const mandate = await getGcMandateByUserId(input.userId);
        // Allow proceeding if admin provides a mandate ID directly (no DB row required)
        const effectiveMandateId = input.mandateId ?? mandate?.mandateId;
        if (!effectiveMandateId) throw new TRPCError({ code: "NOT_FOUND", message: "No mandate found — please enter the GoCardless Mandate ID from the GC dashboard" });
        // Allow subscription creation for any non-cancelled/expired mandate status
        if (mandate && (mandate.status === "cancelled" || mandate.status === "expired") && !input.mandateId) throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot create subscription: mandate is ${mandate.status}.` });
        const existingSub = await getGcSubscriptionByUserId(input.userId);
        if (existingSub) throw new TRPCError({ code: "CONFLICT", message: "Agent already has an active subscription" });

        // Get agent profile for tier/amount
        const { getAgentCrmProfile } = await import("./agent-crm-db");
        const profile = await getAgentCrmProfile(input.userId);
        const { getMonthlyAmount: getAmt, TIER_LABELS } = await import("../shared/membership");
        const tier = (profile?.membershipTier ?? "business_class") as import("../shared/membership").MembershipTier;
        // Look up membership type (solo/duo/trio) from join session
        const { joinSessions: jsSessions } = await import("../drizzle/schema");
        const { eq: eqJs } = await import("drizzle-orm");
        const { getDb: getDbJs } = await import("./db");
        const dbJs = await getDbJs();
        const [jsRow] = dbJs ? await dbJs.select({ membershipType: jsSessions.membershipType })
          .from(jsSessions).where(eqJs(jsSessions.userId, input.userId)).limit(1) : [];
        const membershipType = ((jsRow?.membershipType ?? "solo") as import("../shared/membership").MembershipType);
        const amountPence = getAmt(tier, membershipType);
        const tierLabel = TIER_LABELS[tier] ?? tier;

        const startDate = calcSubscriptionStartDate(
          mandate?.joiningFeePaidAt ?? new Date(),
          input.dayOfMonth
        );

        const sub = await createSubscription({
          mandateId: effectiveMandateId,
          amountPence,
          name: `JLT ${tierLabel} Membership`,
          startDate,
          dayOfMonth: input.dayOfMonth,
        });

        await createGcSubscription({
          userId: input.userId,
          mandateId: effectiveMandateId,
          subscriptionId: sub.id,
          amount: sub.amount,
          startDate,
          dayOfMonth: input.dayOfMonth,
          nextChargeDate: (sub as any).upcoming_payments?.[0]?.charge_date,
        });

        // Update preferred payment day on mandate row
        const { getDb } = await import("./db");
        const { gcMandates: gcMandatesTable, users: usersTable } = await import("../drizzle/schema");
        const { eq: eqFn } = await import("drizzle-orm");
        const dbInst = await getDb();
        if (!dbInst) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        await dbInst
          .update(gcMandatesTable)
          .set({ preferredPaymentDay: input.dayOfMonth, updatedAt: new Date() })
          .where(eqFn(gcMandatesTable.userId, input.userId));

        // Notify support@
        const { sendSupportEmail } = await import("./email");
        const [agent] = await dbInst.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eqFn(usersTable.id, input.userId)).limit(1);
        await sendSupportEmail({
          subject: `DD Subscription Created — ${agent?.name ?? input.userId}`,
          html: `<p>Admin <strong>${ctx.user.name}</strong> manually created a GoCardless subscription for agent <strong>${agent?.name}</strong> (${agent?.email}).</p><p>Subscription ID: <code>${sub.id}</code> | Amount: £${(amountPence / 100).toFixed(2)}/mo | Start: ${startDate} | Day: ${input.dayOfMonth}</p>`,
        });

        return { success: true, subscriptionId: sub.id, startDate, amount: amountPence };
      }),

    /**
     * Admin: refresh mandate status from GoCardless API and update DB row.
     * Useful when the mandates.active webhook was delayed or missed.
     */
    adminRefreshMandateStatus: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .mutation(async ({ input }) => {
        const mandate = await getGcMandateByUserId(input.userId);
        if (!mandate) throw new TRPCError({ code: "NOT_FOUND", message: "No mandate row found for this agent" });
        const { getMandate, getBillingRequest } = await import("./gocardless");
        const { getDb } = await import("./db");
        const { gcMandates: gcMandatesTable } = await import("../drizzle/schema");
        const { eq: eqFn } = await import("drizzle-orm");
        const dbInst = await getDb();
        if (!dbInst) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        // If mandateId is missing, try to resolve it from the billing request
        let resolvedMandateId = mandate.mandateId;
        if (!resolvedMandateId && mandate.billingRequestId) {
          try {
            const brq = await getBillingRequest(mandate.billingRequestId);
            resolvedMandateId = brq?.links?.mandate_request_mandate ?? brq?.links?.mandate ?? null;
            if (resolvedMandateId) {
              // Persist the resolved mandateId so future lookups work
              await dbInst.update(gcMandatesTable)
                .set({ mandateId: resolvedMandateId, updatedAt: new Date() })
                .where(eqFn(gcMandatesTable.id, mandate.id));
            }
          } catch (brqErr: any) {
            console.warn("[adminRefreshMandateStatus] Could not fetch billing request:", brqErr.message);
          }
        }
        if (!resolvedMandateId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No GoCardless mandate ID found. The billing request may not have been fulfilled yet." });
        }
        const gcMandate = await getMandate(resolvedMandateId);
        const validStatuses = ["pending", "pending_submission", "submitted", "active", "cancelled", "failed", "expired"] as const;
        type MandateStatus = typeof validStatuses[number];
        const newStatus: MandateStatus = validStatuses.includes(gcMandate.status as MandateStatus)
          ? (gcMandate.status as MandateStatus)
          : "pending";
        await dbInst
          .update(gcMandatesTable)
          .set({ status: newStatus, mandateId: resolvedMandateId, updatedAt: new Date() })
          .where(eqFn(gcMandatesTable.id, mandate.id));
        return { status: gcMandate.status, mandateId: resolvedMandateId };
      }),
  }),

  inbox: router({
    // Admin: get IMAP config (password masked)
    getConfig: adminProcedure.query(async () => {
      const config = await getImapConfig();
      if (!config) return null;
      return {
        host: config.host,
        port: config.port,
        email: config.email,
        useSsl: config.useSsl,
        agentAccessEnabled: config.agentAccessEnabled,
        isConfigured: !!config.host,
        updatedAt: config.updatedAt,
      };
    }),

    // Admin: save IMAP config (encrypts password)
    saveConfig: adminProcedure
      .input(
        z.object({
          host: z.string().min(1),
          port: z.number().int().min(1).max(65535),
          email: z.string().email(),
          password: z.string().optional(),
          useSsl: z.boolean(),
          agentAccessEnabled: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        let passwordEncrypted = "";
        if (input.password && input.password.length > 0) {
          passwordEncrypted = encryptPassword(input.password);
        } else {
          const existing = await getImapConfig();
          passwordEncrypted = existing?.passwordEncrypted ?? "";
        }
        await upsertImapConfig({
          host: input.host,
          port: input.port,
          email: input.email,
          passwordEncrypted,
          useSsl: input.useSsl,
          agentAccessEnabled: input.agentAccessEnabled ?? false,
        });
        return { success: true };
      }),

    // Admin: test IMAP connection
    testConnection: adminProcedure
      .input(
        z.object({
          host: z.string().min(1),
          port: z.number().int(),
          email: z.string().email(),
          password: z.string().optional(),
          useSsl: z.boolean(),
        })
      )
      .mutation(async ({ input }) => {
        let password = input.password ?? "";
        if (!password) {
          const existing = await getImapConfig();
          password = existing ? decryptPassword(existing.passwordEncrypted) : "";
        }
        const imapsLib = await import("imap-simple");
        try {
          const conn = await imapsLib.connect({
            imap: {
              user: input.email,
              password,
              host: input.host,
              port: input.port,
              tls: input.useSsl,
              tlsOptions: { rejectUnauthorized: false },
              authTimeout: 8000,
              connTimeout: 10000,
            },
          });
          conn.end();
          return { success: true, message: "Connection successful" };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, message: `Connection failed: ${msg}` };
        }
      }),

    // Admin: import status
    importStatus: adminProcedure.query(async () => {
      const [count, lastImport] = await Promise.all([getCachedEmailCount(), getLastImportTime()]);
      return {
        cachedEmailCount: count,
        lastImportedAt: lastImport,
      };
    }),

    // Admin: trigger manual import
    triggerImport: adminProcedure.mutation(async () => {
      const config = await getImapConfig();
      if (!config || !config.host) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "IMAP is not configured. Please configure it first.",
        });
      }
      const password = decryptPassword(config.passwordEncrypted);
      const imapConn = { host: config.host, port: config.port, email: config.email, password, useSsl: config.useSsl };
      try {
        // Full import — no sinceDate, fetches entire mailbox history
        const stats = await importInbox(imapConn, undefined, undefined);
        return { success: true, ...stats };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Import failed: ${msg}` });
      }
    }),

    // Admin: list audit logs
    auditLogs: adminProcedure
      .input(z.object({ limit: z.number().default(100), offset: z.number().default(0) }))
      .query(async ({ input }) => {
        return listInboxAuditLogs(input.limit, input.offset);
      }),

    // Agent/Admin: search booking documents
    // Agents can only access if agentAccessEnabled is true
    search: protectedProcedure
      .input(
        z.object({
          guestName: z.string().min(2),
          departureDate: z.string().min(1),
          bookingReference: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Check feature flag for agents
        if (ctx.user.role === "agent") {
          const config = await getImapConfig();
          if (!config?.agentAccessEnabled) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Booking Documents search is not yet available. Please contact an administrator.",
            });
          }
        }

        const cachedCount = await getCachedEmailCount();
        if (cachedCount === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No emails have been imported yet. Please ask an administrator to run an import.",
          });
        }

        const results = await searchCachedEmails({
          guestName: input.guestName,
          departureDate: input.departureDate,
          bookingReference: input.bookingReference,
        });

        // Audit log
        await createInboxAuditLog({
          userId: ctx.user.id,
          guestName: input.guestName,
          departureDate: input.departureDate,
          bookingReference: input.bookingReference ?? null,
          resultsCount: results.length,
        });

        return results.map((r) => ({
          uid: r.uid,
          subject: r.subject,
          from: r.from,
          date: r.date,
          snippet: r.snippet,
          bodyText: r.bodyText,
          bodyHtml: r.bodyHtml,
          attachments: r.attachments,
          matchReasons: r.matchReasons,
          score: r.score,
        }));
      }),

    // Agent/Admin: check if inbox search is available
    isAvailable: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role === "admin" || ctx.user.role === "super_admin") return true;
      const config = await getImapConfig();
      return config?.agentAccessEnabled ?? false;
    }),

    // Agent/Admin: link a cached email to a booking
    linkEmail: protectedProcedure
      .input(
        z.object({
          bookingId: z.number().int(),
          emailUid: z.string().min(1),
          note: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const email = await getCachedEmailByUid(input.emailUid);
        if (!email) throw new TRPCError({ code: "NOT_FOUND", message: "Email not found in cache." });
        const link = await linkEmailToBooking({
          bookingId: input.bookingId,
          cachedEmailId: email.id,
          linkedBy: ctx.user.id,
          note: input.note,
        });
        return { success: true, linkId: link?.id };
      }),

    // Agent/Admin: unlink a cached email from a booking
    unlinkEmail: protectedProcedure
      .input(z.object({ linkId: z.number().int() }))
      .mutation(async ({ input, ctx }) => {
        await unlinkEmailFromBooking(input.linkId, ctx.user.id);
        return { success: true };
      }),

    // Agent/Admin: get all emails linked to a booking
    getLinkedEmails: protectedProcedure
      .input(z.object({ bookingId: z.number().int() }))
      .query(async ({ input }) => {
        const rows = await getLinkedEmailsForBooking(input.bookingId);
        return rows.map((r) => ({
          linkId: r.linkId,
          note: r.note,
          linkedAt: r.linkedAt,
          linkedByName: r.linkedByName,
          emailId: r.emailId,
          uid: r.uid,
          subject: r.subject,
          fromAddress: r.fromAddress,
          fromName: r.fromName,
          emailDate: r.emailDate,
          snippet: r.snippet,
          bodyHtml: r.bodyHtml ?? "",
          hasAttachments: r.hasAttachments,
          attachmentNames: r.attachmentNames ? JSON.parse(r.attachmentNames) as string[] : [],
          s3Keys: r.s3Keys
            ? (JSON.parse(r.s3Keys) as Array<{ filename: string; contentType: string; s3Key: string; s3Url: string; size: number }>)
            : [],
        }));
      }),

    // Agent/Admin: get a signed download URL for an attachment by s3Key
    getAttachmentUrl: protectedProcedure
      .input(z.object({ emailUid: z.string(), s3Key: z.string() }))
      .query(async ({ input }) => {
        const email = await getCachedEmailByUid(input.emailUid);
        if (!email) throw new TRPCError({ code: "NOT_FOUND", message: "Email not found." });
        const s3Keys: Array<{ filename: string; contentType: string; s3Key: string; s3Url: string; size: number }> =
          email.s3Keys ? JSON.parse(email.s3Keys) : [];
        const att = s3Keys.find((a) => a.s3Key === input.s3Key);
        if (!att) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });
        // S3 bucket is public — return the direct URL
        return { url: att.s3Url, filename: att.filename, contentType: att.contentType };
      }),

    // Agent/Admin: get the full email body for download as .eml-style text
    getEmailBody: protectedProcedure
      .input(z.object({ emailUid: z.string() }))
      .query(async ({ input }) => {
        const email = await getCachedEmailByUid(input.emailUid);
        if (!email) throw new TRPCError({ code: "NOT_FOUND", message: "Email not found." });
        return {
          subject: email.subject,
          fromName: email.fromName,
          fromAddress: email.fromAddress,
          emailDate: email.emailDate,
          bodyText: email.bodyText ?? "",
          bodyHtml: email.bodyHtml ?? "",
          attachmentNames: email.attachmentNames ? JSON.parse(email.attachmentNames) as string[] : [],
          s3Keys: email.s3Keys
            ? (JSON.parse(email.s3Keys) as Array<{ filename: string; contentType: string; s3Key: string; s3Url: string; size: number }>)
            : [],
        };
      }),
  }),
});
export type AppRouter = typeof appRouter;
