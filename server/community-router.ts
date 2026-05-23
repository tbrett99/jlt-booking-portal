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
import { getDb, getUpcomingAgentEvents } from "./db";
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

        // ── Collect community posts grouped by category ──────────────────────────
        const categoryLabel: Record<string, string> = {
          business_update: "Business Updates",
          supplier_news_deals: "Supplier News & Deals",
          news_announcements: "News & Announcements",
          agent_win: "Agent Wins",
          jlt_stay_story: "JLT Stay & Story",
          events: "Events",
          training_webinars: "Training & Webinars",
          mindset: "Mindset",
          first_class_lounge: "First Class Lounge",
        };
        const categoryEmoji: Record<string, string> = {
          business_update: "📊",
          supplier_news_deals: "✈️",
          news_announcements: "📢",
          agent_win: "🏆",
          jlt_stay_story: "🌍",
          events: "📅",
          training_webinars: "🎓",
          mindset: "💡",
          first_class_lounge: "💎",
        };
        const categoryColor: Record<string, string> = {
          business_update: "#02E6D2",
          supplier_news_deals: "#70FFE8",
          news_announcements: "#FFC3BC",
          agent_win: "#FFD700",
          jlt_stay_story: "#70FFE8",
          events: "#FFC3BC",
          training_webinars: "#02E6D2",
          mindset: "#FFF6ED",
          first_class_lounge: "#FFD700",
        };

        const postsByCategory: Record<string, Array<{ id: number; title: string; authorName: string; bodyHtml: string; category: string }>> = {};
        // Fetch all posts — no cap so business_update and news_announcements all appear
        for (const postId of includedIds) {
          const post = await getCommunityPost(postId);
          if (!post || post.isDraft || post.isHidden) continue;
          const cat = post.category ?? "news_announcements";
          if (!postsByCategory[cat]) postsByCategory[cat] = [];
          postsByCategory[cat].push(post as any);
        }

        // Build community snapshot bar (category counts + top post title)
        const snapshotOrder = ["business_update", "news_announcements", "supplier_news_deals", "training_webinars", "agent_win", "jlt_stay_story", "mindset", "first_class_lounge"];
        const snapshotCells = snapshotOrder
          .filter(cat => postsByCategory[cat]?.length > 0)
          .map(cat => {
            const count = postsByCategory[cat].length;
            const label = categoryLabel[cat] ?? cat;
            const emoji = categoryEmoji[cat] ?? "📌";
            const color = categoryColor[cat] ?? "#70FFE8";
            return `<td style="padding:10px 8px;text-align:center;vertical-align:top;">
              <div style="background:${color}22;border:1px solid ${color};border-radius:8px;padding:10px 8px;">
                <div style="font-size:20px;">${emoji}</div>
                <div style="font-size:18px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">${count}</div>
                <div style="font-size:10px;color:#666;font-family:'Poppins',sans-serif;line-height:1.3;">${label}</div>
              </div>
            </td>`;
          });
        const snapshotHtml = snapshotCells.length > 0 ? `
          <div style="margin-bottom:28px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #70FFE8;padding-bottom:6px;">
              <span style="font-size:18px;">📊</span>
              <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">This Week in the Community</h3>
            </div>
            <table style="width:100%;border-collapse:collapse;"><tr>${snapshotCells.join("")}</tr></table>
          </div>
        ` : "";

        // Strip HTML tags for plain-text excerpt
        const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const excerpt = (html: string, len = 160) => {
          const plain = stripHtml(html);
          return plain.length > len ? plain.slice(0, len).trimEnd() + "…" : plain;
        };

        // Build categorised posts HTML
        let postsHtml = "";
        for (const [cat, catPosts] of Object.entries(postsByCategory)) {
          const label = categoryLabel[cat] ?? cat;
          const emoji = categoryEmoji[cat] ?? "📌";
          const accentColor = categoryColor[cat] ?? "#70FFE8";
          postsHtml += `
            <div style="margin-bottom:28px;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid ${accentColor};padding-bottom:6px;">
                <span style="font-size:18px;">${emoji}</span>
                <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">${label}</h3>
              </div>
              ${catPosts.map(p => `
                <div style="background:#ffffff;border:1px solid #e8e8e8;border-left:4px solid ${accentColor};border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:10px;">
                  <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#414141;font-family:'Poppins',sans-serif;">${p.title}</p>
                  <p style="margin:0 0 8px;font-size:12px;color:#888;font-family:'Poppins',sans-serif;">By ${p.authorName}</p>
                  <p style="margin:0 0 10px;font-size:13px;color:#555;line-height:1.5;font-family:'Poppins',sans-serif;">${excerpt(p.bodyHtml ?? "")}</p>
                  <a href="${input.origin}/community?postId=${p.id}" style="font-size:12px;font-weight:600;color:#02E6D2;text-decoration:none;font-family:'Poppins',sans-serif;">Read full post →</a>
                </div>
              `).join("")}
            </div>
          `;
        }
        if (!postsHtml) postsHtml = `<p style="color:#888;font-family:'Poppins',sans-serif;">No community posts this week.</p>`;

        // ── Upcoming events (next week only: Mon–Sun) ──────────────────────────
        // Compute start of next Monday and end of next Sunday
        const todayForEvents = new Date();
        const dayOfWeek = todayForEvents.getDay(); // 0=Sun, 1=Mon...
        const daysUntilNextMon = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
        const nextMonday = new Date(todayForEvents);
        nextMonday.setDate(todayForEvents.getDate() + daysUntilNextMon);
        nextMonday.setHours(0, 0, 0, 0);
        const nextSunday = new Date(nextMonday);
        nextSunday.setDate(nextMonday.getDate() + 6);
        nextSunday.setHours(23, 59, 59, 999);
        const allUpcoming = await getUpcomingAgentEvents(14);
        const upcomingEvents = allUpcoming.filter(ev => {
          const d = new Date(ev.startDate);
          return d >= nextMonday && d <= nextSunday;
        });
        let eventsHtml = "";
        if (upcomingEvents.length > 0) {
          const eventRows = upcomingEvents.map(ev => {
            const d = new Date(ev.startDate);
            const dateStr = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
            const timeStr = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
            const catLabel = categoryLabel[ev.eventCategory ?? ""] ?? (ev.eventCategory ?? "Event");
            return `
              <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">
                  <div style="font-size:13px;font-weight:600;color:#414141;font-family:'Poppins',sans-serif;">${ev.title}</div>
                  <div style="font-size:11px;color:#888;margin-top:2px;font-family:'Poppins',sans-serif;">${catLabel}</div>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;">
                  <div style="font-size:12px;font-weight:600;color:#02E6D2;font-family:'Poppins',sans-serif;">${dateStr}</div>
                  <div style="font-size:11px;color:#888;font-family:'Poppins',sans-serif;">${timeStr}</div>
                </td>
              </tr>
            `;
          }).join("");
          const nextWeekLabel = nextMonday.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " – " + nextSunday.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
          eventsHtml = `
            <div style="margin-bottom:32px;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #70FFE8;padding-bottom:6px;">
                <span style="font-size:18px;">📅</span>
                <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">Coming Up Next Week (${nextWeekLabel})</h3>
              </div>
              <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
                <tbody>${eventRows}</tbody>
              </table>
              <p style="margin:8px 0 0;font-size:12px;color:#888;font-family:'Poppins',sans-serif;">
                <a href="${input.origin}/events" style="color:#02E6D2;text-decoration:none;">View full calendar →</a>
              </p>
            </div>
          `;
        }

        // ── Stats block ───────────────────────────────────────────────────────────
        let statsHtml = "";
        if (stats) {
          const bookings = stats.bookingsThisWeek ?? stats.bookingsCount ?? 0;
          const commission = stats.totalCommissionClaimed ?? stats.commissionTotal ?? 0;
          const reimbs = stats.reimbursementsCount ?? 0;
          statsHtml = `
            <div style="margin-bottom:28px;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #70FFE8;padding-bottom:6px;">
                <span style="font-size:18px;">📈</span>
                <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">This Week's Numbers</h3>
              </div>
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="width:33%;padding:0 6px 0 0;">
                    <div style="background:linear-gradient(135deg,#70FFE8 0%,#02E6D2 100%);border-radius:10px;padding:16px;text-align:center;">
                      <div style="font-size:28px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">${bookings}</div>
                      <div style="font-size:11px;font-weight:600;color:#414141;margin-top:4px;font-family:'Poppins',sans-serif;">Bookings Registered</div>
                    </div>
                  </td>
                  <td style="width:33%;padding:0 3px;">
                    <div style="background:linear-gradient(135deg,#FFC3BC 0%,#ffada4 100%);border-radius:10px;padding:16px;text-align:center;">
                      <div style="font-size:28px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">£${Number(commission).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</div>
                      <div style="font-size:11px;font-weight:600;color:#414141;margin-top:4px;font-family:'Poppins',sans-serif;">Commission Claimed</div>
                    </div>
                  </td>
                  <td style="width:33%;padding:0 0 0 6px;">
                    <div style="background:linear-gradient(135deg,#FFF6ED 0%,#ffe8d0 100%);border-radius:10px;padding:16px;text-align:center;">
                      <div style="font-size:28px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">${reimbs}</div>
                      <div style="font-size:11px;font-weight:600;color:#414141;margin-top:4px;font-family:'Poppins',sans-serif;">Reimbursements</div>
                    </div>
                  </td>
                </tr>
              </table>
            </div>
          `;
        }

        // ── Agent highlights (tiered margins + first bookings + commission) ─────────
        let highlightsHtml = "";
        if (highlights && digest.includeBookingHighlights) {
          const items: string[] = [];

          // First bookings — most special, shown first
          for (const h of highlights.firstBookings ?? []) {
            items.push(`<tr style="background:#f0fff8;"><td style="padding:10px 14px;font-size:13px;color:#414141;font-family:'Poppins',sans-serif;border-bottom:1px solid #e8f8f0;">🎉 <strong>${h.agentName}</strong> registered their <strong>first ever booking</strong> — welcome to the JLT journey!</td></tr>`);
          }

          // Tiered high-margin bookings — grouped by tier
          const tierOrder = ["20%+", "15–20%", "12–15%", "10–12%"];
          const tierEmoji: Record<string, string> = { "20%+": "🥇", "15–20%": "🥈", "12–15%": "🥉", "10–12%": "🎯" };
          const tierColor: Record<string, string> = { "20%+": "#FFD700", "15–20%": "#C0C0C0", "12–15%": "#CD7F32", "10–12%": "#02E6D2" };
          const byTier: Record<string, Array<{ type: string; agentName: string; bookingId: number; marginPct: number; tier: string }>> = {};
          for (const h of highlights.highMargin ?? []) {
            if (!byTier[h.tier]) byTier[h.tier] = [];
            byTier[h.tier].push(h);
          }
          for (const tier of tierOrder) {
            const group = byTier[tier];
            if (!group || group.length === 0) continue;
            const emoji = tierEmoji[tier] ?? "💰";
            const color = tierColor[tier] ?? "#70FFE8";
            const names = group.map(h => `<strong>${h.agentName}</strong> (${h.marginPct}%)`).join(", ");
            items.push(`<tr><td style="padding:10px 14px;font-size:13px;color:#414141;font-family:'Poppins',sans-serif;border-bottom:1px solid #f5f5f5;border-left:4px solid ${color};">${emoji} <span style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;">${tier} margin</span><br/>${names}</td></tr>`);
          }

          // Commission paid out
          if ((highlights.commissionClaimed?.agentNames?.length ?? 0) > 0) {
            const names = highlights.commissionClaimed.agentNames.join(", ");
            const total = highlights.commissionClaimed.totalAmount ?? 0;
            items.push(`<tr><td style="padding:10px 14px;font-size:13px;color:#414141;font-family:'Poppins',sans-serif;">🏆 Commission paid out to <strong>${names}</strong> — total: <strong>£${Number(total).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</strong></td></tr>`);
          }

          if (items.length > 0) {
            highlightsHtml = `
              <div style="margin-bottom:28px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #FFD700;padding-bottom:6px;">
                  <span style="font-size:18px;">🌟</span>
                  <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">Celebrating Our Agents</h3>
                </div>
                <table style="width:100%;border-collapse:collapse;background:#fffdf0;border:1px solid #ffe88a;border-radius:8px;overflow:hidden;">
                  <tbody>${items.join("")}</tbody>
                </table>
              </div>
            `;
          }
        }

        const weekLabel = new Date(digest.weekStarting).toLocaleDateString(
          "en-GB",
          { day: "numeric", month: "long", year: "numeric" }
        );
        const introText = input.customIntro || (digest as any).introText || "";

        const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>JLT Group Weekly Update</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Poppins',Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;background:#f5f5f5;padding:24px 16px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#414141 0%,#2a2a2a 100%);border-radius:16px 16px 0 0;padding:32px 32px 24px;text-align:center;">
      <div style="display:inline-block;background:#70FFE8;border-radius:8px;padding:6px 16px;margin-bottom:16px;">
        <span style="font-size:12px;font-weight:700;color:#414141;letter-spacing:0.1em;text-transform:uppercase;">JLT Group</span>
      </div>
      <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#ffffff;line-height:1.2;">Weekly Update</h1>
      <p style="margin:0;font-size:13px;color:#70FFE8;font-weight:500;">Week of ${weekLabel}</p>
    </div>

    <!-- Body -->
    <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px 32px;">

      ${introText ? `
      <!-- Intro message -->
      <div style="background:#FFF6ED;border-left:4px solid #FFC3BC;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:28px;">
        <p style="margin:0;font-size:14px;color:#414141;line-height:1.6;">${introText}</p>
      </div>
      ` : ""}

      ${statsHtml}
      ${highlightsHtml}
      ${eventsHtml}
      ${snapshotHtml}

      <!-- Community Posts -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;border-bottom:2px solid #70FFE8;padding-bottom:6px;">
          <span style="font-size:18px;">🗞️</span>
          <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">From the Community Hub</h3>
        </div>
        ${postsHtml}
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-top:32px;padding-top:24px;border-top:1px solid #f0f0f0;">
        <a href="${input.origin}/community"
           style="display:inline-block;background:linear-gradient(135deg,#70FFE8 0%,#02E6D2 100%);color:#414141;font-weight:700;font-size:14px;padding:14px 32px;border-radius:50px;text-decoration:none;font-family:'Poppins',sans-serif;">
          Visit the Community Hub
        </a>
        <p style="margin:12px 0 0;font-size:12px;color:#aaa;">
          <a href="${input.origin}/events" style="color:#02E6D2;text-decoration:none;">View Calendar</a>
          &nbsp;·&nbsp;
          <a href="${input.origin}/community" style="color:#02E6D2;text-decoration:none;">Community Hub</a>
        </p>
      </div>

    </div>

    <!-- Footer -->
    <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#aaa;font-family:'Poppins',sans-serif;">
      JLT Group Agent Portal — You're receiving this as an active JLT agent.<br/>
      © ${new Date().getFullYear()} JLT Group. All rights reserved.
    </p>

  </div>
</body>
</html>`;

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

    // Send test digest to a single email address
    sendTest: adminProcedure
      .input(
        z.object({
          digestId: z.number(),
          origin: z.string().url(),
          toEmail: z.string().email(),
          customSubject: z.string().optional(),
          customIntro: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const digest = await getDigest(input.digestId);
        if (!digest) throw new TRPCError({ code: "NOT_FOUND" });

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

        const categoryLabel: Record<string, string> = { business_update: "Business Updates", supplier_news_deals: "Supplier News & Deals", news_announcements: "News & Announcements", agent_win: "Agent Wins", jlt_stay_story: "JLT Stay & Story", events: "Events", training_webinars: "Training & Webinars", mindset: "Mindset", first_class_lounge: "First Class Lounge" };
        const categoryEmoji: Record<string, string> = { business_update: "📊", supplier_news_deals: "✈️", news_announcements: "📢", agent_win: "🏆", jlt_stay_story: "🌍", events: "📅", training_webinars: "🎓", mindset: "💡", first_class_lounge: "💎" };
        const categoryColor: Record<string, string> = { business_update: "#02E6D2", supplier_news_deals: "#70FFE8", news_announcements: "#FFC3BC", agent_win: "#FFD700", jlt_stay_story: "#70FFE8", events: "#FFC3BC", training_webinars: "#02E6D2", mindset: "#FFF6ED", first_class_lounge: "#FFD700" };

        const postsByCategory: Record<string, Array<{ id: number; title: string; authorName: string; bodyHtml: string; category: string }>> = {};
        for (const postId of includedIds) {
          const post = await getCommunityPost(postId);
          if (!post || post.isDraft || post.isHidden) continue;
          const cat = post.category ?? "news_announcements";
          if (!postsByCategory[cat]) postsByCategory[cat] = [];
          postsByCategory[cat].push(post as any);
        }

        const snapshotOrder = ["business_update", "news_announcements", "supplier_news_deals", "training_webinars", "agent_win", "jlt_stay_story", "mindset", "first_class_lounge"];
        const snapshotCells = snapshotOrder.filter(cat => postsByCategory[cat]?.length > 0).map(cat => {
          const count = postsByCategory[cat].length;
          const color = categoryColor[cat] ?? "#70FFE8";
          return `<td style="padding:10px 8px;text-align:center;vertical-align:top;"><div style="background:${color}22;border:1px solid ${color};border-radius:8px;padding:10px 8px;"><div style="font-size:20px;">${categoryEmoji[cat] ?? "📌"}</div><div style="font-size:18px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">${count}</div><div style="font-size:10px;color:#666;font-family:'Poppins',sans-serif;line-height:1.3;">${categoryLabel[cat] ?? cat}</div></div></td>`;
        });
        const snapshotHtml = snapshotCells.length > 0 ? `<div style="margin-bottom:28px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #70FFE8;padding-bottom:6px;"><span style="font-size:18px;">📊</span><h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">This Week in the Community</h3></div><table style="width:100%;border-collapse:collapse;"><tr>${snapshotCells.join("")}</tr></table></div>` : "";

        const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const excerpt = (html: string, len = 160) => { const p = stripHtml(html); return p.length > len ? p.slice(0, len).trimEnd() + "\u2026" : p; };

        let postsHtml = "";
        for (const [cat, catPosts] of Object.entries(postsByCategory)) {
          const accentColor = categoryColor[cat] ?? "#70FFE8";
          postsHtml += `<div style="margin-bottom:28px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid ${accentColor};padding-bottom:6px;"><span style="font-size:18px;">${categoryEmoji[cat] ?? "📌"}</span><h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">${categoryLabel[cat] ?? cat}</h3></div>${catPosts.map(p => `<div style="background:#ffffff;border:1px solid #e8e8e8;border-left:4px solid ${accentColor};border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:10px;"><p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#414141;font-family:'Poppins',sans-serif;">${p.title}</p><p style="margin:0 0 8px;font-size:12px;color:#888;font-family:'Poppins',sans-serif;">By ${p.authorName}</p><p style="margin:0 0 10px;font-size:13px;color:#555;line-height:1.5;font-family:'Poppins',sans-serif;">${excerpt(p.bodyHtml ?? "")}</p><a href="${input.origin}/community?postId=${p.id}" style="font-size:12px;font-weight:600;color:#02E6D2;text-decoration:none;font-family:'Poppins',sans-serif;">Read full post \u2192</a></div>`).join("")}</div>`;
        }
        if (!postsHtml) postsHtml = `<p style="color:#888;font-family:'Poppins',sans-serif;">No community posts this week.</p>`;

        const todayForEvents = new Date();
        const dow = todayForEvents.getDay();
        const daysUntilNextMon = dow === 0 ? 1 : 8 - dow;
        const nextMonday = new Date(todayForEvents);
        nextMonday.setDate(todayForEvents.getDate() + daysUntilNextMon);
        nextMonday.setHours(0, 0, 0, 0);
        const nextSunday = new Date(nextMonday);
        nextSunday.setDate(nextMonday.getDate() + 6);
        nextSunday.setHours(23, 59, 59, 999);
        const allUpcoming = await getUpcomingAgentEvents(14);
        const upcomingEvents = allUpcoming.filter(ev => { const d = new Date(ev.startDate); return d >= nextMonday && d <= nextSunday; });
        let eventsHtml = "";
        if (upcomingEvents.length > 0) {
          const nextWeekLabel = nextMonday.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " \u2013 " + nextSunday.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
          const eventRows = upcomingEvents.map(ev => { const d = new Date(ev.startDate); return `<tr><td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;"><div style="font-size:13px;font-weight:600;color:#414141;font-family:'Poppins',sans-serif;">${ev.title}</div><div style="font-size:11px;color:#888;margin-top:2px;font-family:'Poppins',sans-serif;">${categoryLabel[ev.eventCategory ?? ""] ?? (ev.eventCategory ?? "Event")}</div></td><td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;"><div style="font-size:12px;font-weight:600;color:#02E6D2;font-family:'Poppins',sans-serif;">${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div><div style="font-size:11px;color:#888;font-family:'Poppins',sans-serif;">${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div></td></tr>`; }).join("");
          eventsHtml = `<div style="margin-bottom:32px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #70FFE8;padding-bottom:6px;"><span style="font-size:18px;">📅</span><h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">Coming Up Next Week (${nextWeekLabel})</h3></div><table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;"><tbody>${eventRows}</tbody></table><p style="margin:8px 0 0;font-size:12px;color:#888;font-family:'Poppins',sans-serif;"><a href="${input.origin}/events" style="color:#02E6D2;text-decoration:none;">View full calendar \u2192</a></p></div>`;
        }

        let statsHtml = "";
        if (stats) {
          const bookings = stats.bookingsThisWeek ?? stats.bookingsCount ?? 0;
          const commission = stats.totalCommissionClaimed ?? stats.commissionTotal ?? 0;
          const reimbs = stats.reimbursementsCount ?? 0;
          statsHtml = `<div style="margin-bottom:28px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #70FFE8;padding-bottom:6px;"><span style="font-size:18px;">📈</span><h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">This Week's Numbers</h3></div><table style="width:100%;border-collapse:collapse;"><tr><td style="width:33%;padding:0 6px 0 0;"><div style="background:linear-gradient(135deg,#70FFE8 0%,#02E6D2 100%);border-radius:10px;padding:16px;text-align:center;"><div style="font-size:28px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">${bookings}</div><div style="font-size:11px;font-weight:600;color:#414141;margin-top:4px;font-family:'Poppins',sans-serif;">Bookings Registered</div></div></td><td style="width:33%;padding:0 3px;"><div style="background:linear-gradient(135deg,#FFC3BC 0%,#ffada4 100%);border-radius:10px;padding:16px;text-align:center;"><div style="font-size:28px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">\u00a3${Number(commission).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</div><div style="font-size:11px;font-weight:600;color:#414141;margin-top:4px;font-family:'Poppins',sans-serif;">Commission Claimed</div></div></td><td style="width:33%;padding:0 0 0 6px;"><div style="background:linear-gradient(135deg,#FFF6ED 0%,#ffe8d0 100%);border-radius:10px;padding:16px;text-align:center;"><div style="font-size:28px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">${reimbs}</div><div style="font-size:11px;font-weight:600;color:#414141;margin-top:4px;font-family:'Poppins',sans-serif;">Reimbursements</div></div></td></tr></table></div>`;
        }

        let highlightsHtml = "";
        if (highlights && digest.includeBookingHighlights) {
          const items: string[] = [];
          for (const h of (highlights as any).firstBookings ?? []) {
            items.push(`<tr style="background:#f0fff8;"><td style="padding:10px 14px;font-size:13px;color:#414141;font-family:'Poppins',sans-serif;border-bottom:1px solid #e8f8f0;">\uD83C\uDF89 <strong>${(h as any).agentName}</strong> registered their <strong>first ever booking</strong> \u2014 welcome to the JLT journey!</td></tr>`);
          }
          const tierOrder2 = ["20%+", "15\u201320%", "12\u201315%", "10\u201312%"];
          const tierEmoji2: Record<string, string> = { "20%+": "\uD83E\uDD47", "15\u201320%": "\uD83E\uDD48", "12\u201315%": "\uD83E\uDD49", "10\u201312%": "\uD83C\uDFAF" };
          const tierColor2: Record<string, string> = { "20%+": "#FFD700", "15\u201320%": "#C0C0C0", "12\u201315%": "#CD7F32", "10\u201312%": "#02E6D2" };
          const byTier2: Record<string, Array<{ agentName: string; marginPct: number; tier: string }>> = {};
          for (const h of (highlights as any).highMargin ?? []) { if (!byTier2[(h as any).tier]) byTier2[(h as any).tier] = []; byTier2[(h as any).tier].push(h as any); }
          for (const tier of tierOrder2) {
            const group = byTier2[tier];
            if (!group?.length) continue;
            const names = group.map(h => `<strong>${h.agentName}</strong> (${h.marginPct}%)`).join(", ");
            items.push(`<tr><td style="padding:10px 14px;font-size:13px;color:#414141;font-family:'Poppins',sans-serif;border-bottom:1px solid #f5f5f5;border-left:4px solid ${tierColor2[tier]};">${tierEmoji2[tier]} <span style="font-size:11px;font-weight:700;color:${tierColor2[tier]};text-transform:uppercase;letter-spacing:0.06em;">${tier} margin</span><br/>${names}</td></tr>`);
          }
          const cc = (highlights as any).commissionClaimed;
          if ((cc?.agentNames?.length ?? 0) > 0) {
            items.push(`<tr><td style="padding:10px 14px;font-size:13px;color:#414141;font-family:'Poppins',sans-serif;">\uD83C\uDFC6 Commission paid out to <strong>${cc.agentNames.join(", ")}</strong> \u2014 total: <strong>\u00a3${Number(cc.totalAmount ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</strong></td></tr>`);
          }
          if (items.length > 0) {
            highlightsHtml = `<div style="margin-bottom:28px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #FFD700;padding-bottom:6px;"><span style="font-size:18px;">\uD83C\uDF1F</span><h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">Celebrating Our Agents</h3></div><table style="width:100%;border-collapse:collapse;background:#fffdf0;border:1px solid #ffe88a;border-radius:8px;overflow:hidden;"><tbody>${items.join("")}</tbody></table></div>`;
          }
        }

        const weekLabel = new Date(digest.weekStarting).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
        const introText = input.customIntro || (digest as any).introText || "";
        const emailHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>JLT Group Weekly Update</title><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"/></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:'Poppins',Arial,sans-serif;"><div style="max-width:620px;margin:0 auto;background:#f5f5f5;padding:24px 16px;"><div style="background:linear-gradient(135deg,#414141 0%,#2a2a2a 100%);border-radius:16px 16px 0 0;padding:32px 32px 24px;text-align:center;"><div style="display:inline-block;background:#70FFE8;border-radius:8px;padding:6px 16px;margin-bottom:16px;"><span style="font-size:12px;font-weight:700;color:#414141;letter-spacing:0.1em;text-transform:uppercase;">JLT Group</span></div><h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#ffffff;line-height:1.2;">Weekly Update</h1><p style="margin:0;font-size:13px;color:#70FFE8;font-weight:500;">Week of ${weekLabel}</p></div><div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px 32px;">${introText ? `<div style="background:#FFF6ED;border-left:4px solid #FFC3BC;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:28px;"><p style="margin:0;font-size:14px;color:#414141;line-height:1.6;">${introText}</p></div>` : ""}${statsHtml}${highlightsHtml}${eventsHtml}${snapshotHtml}<div style="margin-bottom:28px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;border-bottom:2px solid #70FFE8;padding-bottom:6px;"><span style="font-size:18px;">\uD83D\uDDDE\uFE0F</span><h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">From the Community Hub</h3></div>${postsHtml}</div><div style="text-align:center;margin-top:32px;padding-top:24px;border-top:1px solid #f0f0f0;"><a href="${input.origin}/community" style="display:inline-block;background:linear-gradient(135deg,#70FFE8 0%,#02E6D2 100%);color:#414141;font-weight:700;font-size:14px;padding:14px 32px;border-radius:50px;text-decoration:none;font-family:'Poppins',sans-serif;">Visit the Community Hub</a><p style="margin:12px 0 0;font-size:12px;color:#aaa;"><a href="${input.origin}/events" style="color:#02E6D2;text-decoration:none;">View Calendar</a> \u00b7 <a href="${input.origin}/community" style="color:#02E6D2;text-decoration:none;">Community Hub</a></p></div></div><p style="margin:16px 0 0;text-align:center;font-size:11px;color:#aaa;font-family:'Poppins',sans-serif;">JLT Group Agent Portal \u2014 You're receiving this as an active JLT agent.<br/>\u00a9 ${new Date().getFullYear()} JLT Group. All rights reserved.</p></div></body></html>`;

        await sendDirectEmail({
          toEmail: input.toEmail,
          toName: input.toEmail,
          subject: `[TEST] ${input.customSubject || `JLT Group Weekly Update \u2014 ${weekLabel}`}`,
          html: emailHtml,
        });
        return { sent: true };
      }),

    // Get booking highlights for digest preview
    bookingHighlights: adminProcedure
      .input(z.object({ weekAgo: z.date() }))
      .query(async ({ input }) => {
        return getBookingHighlights(input.weekAgo);
      }),
  }),
});
