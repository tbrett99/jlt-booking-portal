import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  listCommunityPosts,
  getCommunityPost,
  createCommunityPost,
  updateCommunityPost,
  deleteCommunityPost,
  recordPostView,
  toggleReaction,
  listComments,
  createComment,
  deleteComment,
  confirmPost,
  getConfirmationStatus,
  getComplianceReport,
  getUnconfirmedBusinessUpdates,
  getRecentCommunityPostsForDashboard,
  getAgentsNeedingConfirmationReminder,
  recordConfirmationReminder,
  getOrCreateWeeklyDigestDraft,
  updateDigest,
  markDigestSent,
  listDigests,
  getDigest,
  getBookingHighlights,
} from "./community-db";
import { storagePut } from "./storage";
import { sendDirectEmail } from "./email";
import { getDb } from "./db";
import { users, agentCrmProfiles } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMembershipTier(user: { membershipTier?: string | null }): string {
  return user.membershipTier ?? "";
}

function isFirstClassMember(tier: string): boolean {
  return tier.toLowerCase().includes("first class");
}

// ─── Category enum ────────────────────────────────────────────────────────────

const CATEGORIES = [
  "business_update",
  "supplier_news_deals",
  "news_announcements",
  "agent_win",
  "jlt_stay_story",
  "events",
  "training_webinars",
  "mindset",
  "first_class_lounge",
] as const;

type Category = typeof CATEGORIES[number];

// ─── Router ───────────────────────────────────────────────────────────────────

export const communityRouter = router({
  // ─── List posts (paginated, filtered) ──────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        categories: z.array(z.string()).optional(),
        supplierSubCategory: z.string().optional(),
        supplierPostType: z.enum(["news", "deal"]).optional(),
        search: z.string().optional(),
        unreadOnly: z.boolean().optional(),
        unconfirmedOnly: z.boolean().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { posts: [], total: 0 };
      // Get agent's membership tier from CRM profile
      const [profile] = await db
        .select({ membershipTier: agentCrmProfiles.membershipTier })
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.userId, ctx.user.id));
      const tier = profile?.membershipTier ?? "";
      return listCommunityPosts({
        userId: ctx.user.id,
        userRole: ctx.user.role,
        membershipTier: tier,
        ...input,
      });
    }),

  // ─── Get single post ────────────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ postId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const post = await getCommunityPost(input.postId);
      if (!post) throw new TRPCError({ code: "NOT_FOUND" });
      // First Class gating
      if (post.category === "first_class_lounge") {
      const [profile] = await db
        .select({ membershipTier: agentCrmProfiles.membershipTier })
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.userId, ctx.user.id));
      const tier = profile?.membershipTier ?? "";
      const isAdmin =
        ctx.user.role === "admin" || ctx.user.role === "super_admin";
      if (!isAdmin && !isFirstClassMember(tier)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }
      // Record view
      await recordPostView(input.postId, ctx.user.id);
      return post;
    }),

  // ─── Create post ────────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        category: z.enum(CATEGORIES),
        supplierSubCategory: z.string().optional(),
        supplierPostType: z.enum(["news", "deal"]).optional(),
        title: z.string().min(1).max(300),
        bodyHtml: z.string(),
        loomUrl: z.string().url().optional(),
        imageUrls: z.array(z.string().url()).max(5).optional(),
        attachmentUrls: z
          .array(z.object({ name: z.string(), url: z.string(), key: z.string() }))
          .optional(),
        isPinned: z.boolean().optional(),
        isDraft: z.boolean().optional(),
        requiresConfirmation: z.boolean().optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isAdmin =
        ctx.user.role === "admin" || ctx.user.role === "super_admin";
      // Agent-only categories
      const agentCategories: Category[] = ["agent_win", "jlt_stay_story"];
      if (!isAdmin && !agentCategories.includes(input.category)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      // Admin-only options
      if (!isAdmin && (input.isPinned || input.requiresConfirmation)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const postId = await createCommunityPost({
        ...input,
        authorId: ctx.user.id,
        authorName: ctx.user.name ?? "Agent",
      });
      return { postId };
    }),

  // ─── Update post ────────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        postId: z.number(),
        title: z.string().min(1).max(300).optional(),
        bodyHtml: z.string().optional(),
        loomUrl: z.string().url().optional().nullable(),
        imageUrls: z.array(z.string().url()).max(5).optional(),
        attachmentUrls: z
          .array(z.object({ name: z.string(), url: z.string(), key: z.string() }))
          .optional(),
        isPinned: z.boolean().optional(),
        isHidden: z.boolean().optional(),
        isDraft: z.boolean().optional(),
        requiresConfirmation: z.boolean().optional(),
        expiresAt: z.date().optional().nullable(),
        supplierSubCategory: z.string().optional(),
        supplierPostType: z.enum(["news", "deal"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { postId, ...data } = input;
      const post = await getCommunityPost(postId);
      if (!post) throw new TRPCError({ code: "NOT_FOUND" });
      const isAdmin =
        ctx.user.role === "admin" || ctx.user.role === "super_admin";
      // Agents can only edit their own posts
      if (!isAdmin && post.authorId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      // Only admins can pin, hide, or set requiresConfirmation
      if (!isAdmin && (data.isPinned !== undefined || data.isHidden !== undefined || data.requiresConfirmation !== undefined)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await updateCommunityPost(postId, data as any);
      return { success: true };
    }),

  // ─── Delete / hide post ─────────────────────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ postId: z.number(), hide: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      if (input.hide) {
        await updateCommunityPost(input.postId, { isHidden: true });
      } else {
        await deleteCommunityPost(input.postId);
      }
      return { success: true };
    }),

  // ─── Reactions ──────────────────────────────────────────────────────────────
  react: protectedProcedure
    .input(
      z.object({
        postId: z.number(),
        emoji: z.enum(["thumbs_up", "heart", "celebrate", "fire", "plane"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await toggleReaction(
        input.postId,
        ctx.user.id,
        input.emoji
      );
      return { activeEmoji: result };
    }),

  // ─── Comments ───────────────────────────────────────────────────────────────
  listComments: protectedProcedure
    .input(z.object({ postId: z.number() }))
    .query(async ({ input }) => {
      return listComments(input.postId);
    }),

  addComment: protectedProcedure
    .input(
      z.object({
        postId: z.number(),
        content: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const commentId = await createComment({
        postId: input.postId,
        authorId: ctx.user.id,
        authorName: ctx.user.name ?? "Agent",
        content: input.content,
      });
      return { commentId };
    }),

  deleteComment: adminProcedure
    .input(z.object({ commentId: z.number() }))
    .mutation(async ({ input }) => {
      await deleteComment(input.commentId);
      return { success: true };
    }),

  // ─── Confirmations ──────────────────────────────────────────────────────────
  confirm: protectedProcedure
    .input(z.object({ postId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await confirmPost(input.postId, ctx.user.id);
      return { success: true };
    }),

  confirmationStatus: protectedProcedure
    .input(z.object({ postId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getConfirmationStatus(input.postId, ctx.user.id);
    }),

  // ─── Compliance log (admin) ─────────────────────────────────────────────────
  complianceReport: adminProcedure
    .input(z.object({ postId: z.number() }))
    .query(async ({ input }) => {
      return getComplianceReport(input.postId);
    }),

  // ─── Unconfirmed business updates for current user ──────────────────────────
  unconfirmedUpdates: protectedProcedure.query(async ({ ctx }) => {
    return getUnconfirmedBusinessUpdates(ctx.user.id);
  }),

  // ─── Dashboard: recent posts widget ─────────────────────────────────────────
  dashboardPosts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const [profile] = await db
      .select({ membershipTier: agentCrmProfiles.membershipTier })
      .from(agentCrmProfiles)
      .where(eq(agentCrmProfiles.userId, ctx.user.id));
    const tier = profile?.membershipTier ?? "";
    return getRecentCommunityPostsForDashboard({
      userId: ctx.user.id,
      isFirstClass: isFirstClassMember(tier),
      limit: 5,
    });
  }),

  // ─── Upload attachment ───────────────────────────────────────────────────────
  uploadAttachment: protectedProcedure
    .input(
      z.object({
        fileName: z.string(),
        mimeType: z.string(),
        base64Data: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.base64Data, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "File too large (max 10MB)",
        });
      }
      const suffix = Date.now();
      const key = `community-attachments/${ctx.user.id}/${suffix}-${input.fileName}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url, key, name: input.fileName };
    }),

  // ─── Send confirmation reminders (admin) ────────────────────────────────────
  sendConfirmationReminders: adminProcedure.mutation(async () => {
    const pending = await getAgentsNeedingConfirmationReminder();
    let sent = 0;
    for (const { post, agent } of pending) {
      if (!agent.email) continue;
      await sendDirectEmail({
        toEmail: agent.email,
        toName: agent.name ?? "Agent",
        subject: `Action Required: Please confirm you've read "${post.title}"`,
        html: `
          <p>Hi ${agent.name ?? "there"},</p>
          <p>You have an unread business update that requires your confirmation:</p>
          <h3>${post.title}</h3>
          <p>Please log in to the JLT portal and confirm you have read and understood this update.</p>
          <a href="${process.env.PORTAL_BASE_URL ?? ""}/community?postId=${post.id}" 
             style="background:#1a56db;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:12px;">
            Read &amp; Confirm
          </a>
          <p style="margin-top:16px;color:#6b7280;font-size:13px;">
            This is an automated reminder from the JLT Group portal.
          </p>
        `,
      });
      await recordConfirmationReminder(post.id, agent.id);
      sent++;
    }
    return { sent };
  }),

  // ─── Digest procedures ───────────────────────────────────────────────────────
  digest: router({
    list: adminProcedure.query(async () => {
      return listDigests();
    }),

    get: adminProcedure
      .input(z.object({ digestId: z.number() }))
      .query(async ({ input }) => {
        const digest = await getDigest(input.digestId);
        if (!digest) throw new TRPCError({ code: "NOT_FOUND" });
        return digest;
      }),

    getOrCreateDraft: adminProcedure
      .input(z.object({ weekStarting: z.date() }))
      .mutation(async ({ input }) => {
        const digest = await getOrCreateWeeklyDigestDraft(input.weekStarting);
        if (!digest) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return digest;
      }),

    update: adminProcedure
      .input(
        z.object({
          digestId: z.number(),
          introText: z.string().optional(),
          includedPostIds: z.array(z.number()).optional(),
          includeBookingHighlights: z.boolean().optional(),
          bookingHighlightsOverride: z.any().optional(),
          statsSnapshot: z.any().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { digestId, ...data } = input;
        await updateDigest(digestId, data);
        return { success: true };
      }),

    send: adminProcedure
      .input(
        z.object({
          digestId: z.number(),
          origin: z.string().url(),
          customSubject: z.string().optional(),
          customIntro: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const digest = await getDigest(input.digestId);
        if (!digest) throw new TRPCError({ code: "NOT_FOUND" });
        if (digest.status === "sent") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Digest already sent",
          });
        }

        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // Get all active agents
        const agents = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(and(eq(users.role, "agent"), eq(users.isActive, true)));

        // Get included posts
        const includedIds: number[] = Array.isArray(digest.includedPostIds)
          ? (digest.includedPostIds as number[])
          : typeof digest.includedPostIds === "string"
          ? JSON.parse(digest.includedPostIds)
          : [];
        const stats = digest.statsSnapshot
          ? (typeof digest.statsSnapshot === "string" ? JSON.parse(digest.statsSnapshot) : digest.statsSnapshot)
          : null;
        const highlights = digest.bookingHighlightsOverride
          ? (typeof digest.bookingHighlightsOverride === "string" ? JSON.parse(digest.bookingHighlightsOverride) : digest.bookingHighlightsOverride)
          : null;

        // Build post list HTML
        let postsHtml = "";
        for (const postId of includedIds.slice(0, 20)) {
          const post = await getCommunityPost(postId);
          if (!post || post.isDraft || post.isHidden) continue;
          const categoryLabel: Record<string, string> = {
            business_update: "Business Update",
            supplier_news_deals: "Supplier News & Deals",
            news_announcements: "News & Announcements",
            agent_win: "Agent Win",
            jlt_stay_story: "JLT Stay & Story",
            events: "Events",
            training_webinars: "Training & Webinars",
            mindset: "Mindset",
            first_class_lounge: "First Class Lounge",
          };
          postsHtml += `
            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px;">
              <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#6b7280;letter-spacing:0.05em;">
                ${categoryLabel[post.category] ?? post.category}
              </span>
              <h3 style="margin:8px 0 4px;font-size:16px;color:#111827;">${post.title}</h3>
              <p style="margin:0;color:#374151;font-size:13px;">By ${post.authorName}</p>
              <a href="${input.origin}/community?postId=${post.id}" 
                 style="display:inline-block;margin-top:10px;color:#1a56db;font-size:13px;text-decoration:none;">
                Read more →
              </a>
            </div>
          `;
        }

        // Build stats HTML
        let statsHtml = "";
        if (stats) {
          statsHtml = `
            <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:24px;display:flex;gap:24px;">
              <div style="text-align:center;flex:1;">
                <div style="font-size:24px;font-weight:700;color:#111827;">${stats.bookingsCount ?? 0}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:4px;">Bookings This Week</div>
              </div>
              <div style="text-align:center;flex:1;">
                <div style="font-size:24px;font-weight:700;color:#059669;">£${(stats.commissionTotal ?? 0).toLocaleString()}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:4px;">Commission Claimed</div>
              </div>
              <div style="text-align:center;flex:1;">
                <div style="font-size:24px;font-weight:700;color:#7c3aed;">${stats.reimbursementsCount ?? 0}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:4px;">Reimbursements Processed</div>
              </div>
            </div>
          `;
        }

        // Build highlights HTML
        let highlightsHtml = "";
        if (highlights && digest.includeBookingHighlights) {
          const items: string[] = [];
          for (const h of highlights.firstBookings ?? []) {
            items.push(`🎉 <strong>${h.agentName}</strong> registered their first booking!`);
          }
          for (const h of highlights.highMargin ?? []) {
            items.push(`💰 <strong>${h.agentName}</strong> secured a high-margin booking this week!`);
          }
          if ((highlights.commissionClaimed?.agentNames?.length ?? 0) > 0) {
            const names = highlights.commissionClaimed.agentNames.join(", ");
            const total = highlights.commissionClaimed.totalAmount ?? 0;
            items.push(
              `🏆 Commission claimed this week: <strong>${names}</strong> — total paid out: <strong>£${total.toLocaleString()}</strong>`
            );
          }
          if (items.length > 0) {
            highlightsHtml = `
              <div style="margin-bottom:24px;">
                <h2 style="font-size:18px;color:#111827;margin-bottom:12px;">🌟 Celebrating Our Agents</h2>
                ${items.map((i) => `<p style="margin:8px 0;color:#374151;">${i}</p>`).join("")}
              </div>
            `;
          }
        }

        const weekLabel = new Date(digest.weekStarting).toLocaleDateString(
          "en-GB",
          { day: "numeric", month: "long", year: "numeric" }
        );

        const emailHtml = `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
            <div style="text-align:center;margin-bottom:32px;">
              <h1 style="font-size:22px;color:#111827;">JLT Group Weekly Update</h1>
              <p style="color:#6b7280;font-size:14px;">Week of ${weekLabel}</p>
            </div>
            ${input.customIntro ? `<p style="color:#374151;margin-bottom:24px;">${input.customIntro}</p>` : digest.introText ? `<p style="color:#374151;margin-bottom:24px;">${digest.introText}</p>` : ""}
            ${statsHtml}
            ${highlightsHtml}
            <h2 style="font-size:18px;color:#111827;margin-bottom:16px;">This Week in the Community</h2>
            ${postsHtml || "<p style='color:#6b7280;'>No posts this week.</p>"}
            <div style="margin-top:32px;text-align:center;">
              <a href="${input.origin}/community" 
                 style="background:#1a56db;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
                Visit the Community Hub
              </a>
            </div>
            <p style="margin-top:32px;color:#9ca3af;font-size:12px;text-align:center;">
              JLT Group Agent Portal — You are receiving this as an active JLT agent.
            </p>
          </div>
        `;

        let sent = 0;
        for (const agent of agents) {
          if (!agent.email) continue;
          try {
            await sendDirectEmail({
              toEmail: agent.email,
              toName: agent.name ?? "Agent",
              subject: input.customSubject || `JLT Group Weekly Update — ${weekLabel}`,
              html: emailHtml,
            });
            sent++;
          } catch {
            // Continue sending to others even if one fails
          }
        }

        await markDigestSent(input.digestId, ctx.user.id, sent);
        return { sent, sentCount: sent };
      }),

    // Get booking highlights for digest preview
    bookingHighlights: adminProcedure
      .input(z.object({ weekAgo: z.date() }))
      .query(async ({ input }) => {
        return getBookingHighlights(input.weekAgo);
      }),
  }),
});
