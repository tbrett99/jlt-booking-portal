/**
 * community-db.ts
 * Database helpers for the JLT Community & Communications Hub.
 */

import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, not, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  communityComments,
  communityConfirmationReminders,
  communityConfirmations,
  communityDigests,
  communityPostViews,
  communityPosts,
  communityReactions,
  type CommunityPost,
} from "../drizzle/schema";

// ─── Category helpers ─────────────────────────────────────────────────────────

export const FIRST_CLASS_CATEGORY = "first_class_lounge";
export const AGENT_WRITABLE_CATEGORIES = ["agent_win", "jlt_stay_story"] as const;
export const ADMIN_ONLY_CATEGORIES = [
  "business_update",
  "supplier_news_deals",
  "news_announcements",
  "events",
  "training_webinars",
  "mindset",
  "first_class_lounge",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
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

export const EMOJI_MAP: Record<string, string> = {
  thumbs_up: "👍",
  heart: "❤️",
  celebrate: "🎉",
  fire: "🔥",
  plane: "✈️",
};

// ─── List posts ───────────────────────────────────────────────────────────────

export async function listCommunityPosts(opts: {
  userId: number;
  userRole: string;
  membershipTier?: string | null;
  categories?: string[];
  supplierSubCategory?: string;
  supplierPostType?: string;
  search?: string;
  unreadOnly?: boolean;
  unconfirmedOnly?: boolean;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { posts: [], total: 0 };
  const {
    userId,
    userRole,
    membershipTier,
    categories,
    limit = 20,
    offset = 0,
  } = opts;

  const isAdmin = userRole === "admin" || userRole === "super_admin";
  const isFirstClass =
    isAdmin ||
    (membershipTier?.toLowerCase().includes("first class") ?? false);

  // Build base query
  const rows = await db
    .select()
    .from(communityPosts)
    .where(
      and(
        // Hide drafts from agents
        isAdmin ? undefined : eq(communityPosts.isDraft, false),
        // Hide hidden posts from agents
        isAdmin ? undefined : eq(communityPosts.isHidden, false),
        // First Class gating
        isFirstClass
          ? undefined
          : not(eq(communityPosts.category, "first_class_lounge" as any)),
        // Category filter
        categories && categories.length > 0
          ? inArray(communityPosts.category, categories as any)
          : undefined,
        // Supplier sub-category filter
        opts.supplierSubCategory
          ? eq(communityPosts.supplierSubCategory, opts.supplierSubCategory)
          : undefined,
        // Supplier post type filter
        opts.supplierPostType
          ? eq(communityPosts.supplierPostType, opts.supplierPostType as any)
          : undefined,
        // Search
        opts.search
          ? or(
              sql`${communityPosts.title} LIKE ${"%" + opts.search + "%"}`,
              sql`${communityPosts.bodyHtml} LIKE ${"%" + opts.search + "%"}`
            )
          : undefined,
        // Expired posts hidden
        or(
          isNull(communityPosts.expiresAt),
          gt(communityPosts.expiresAt, new Date())
        )
      )
    )
    .orderBy(desc(communityPosts.isPinned), desc(communityPosts.createdAt))
    .limit(limit)
    .offset(offset);

  // Enrich with reactions, comment counts, view status, confirmation status
  const postIds = rows.map((r) => r.id);
  if (postIds.length === 0) return { posts: [], total: 0 };

  const [reactions, comments, views, confirmations] = await Promise.all([
    db
      .select()
      .from(communityReactions)
      .where(inArray(communityReactions.postId, postIds)),
    db
      .select({
        postId: communityComments.postId,
        count: sql<number>`COUNT(*)`,
      })
      .from(communityComments)
      .where(
        and(
          inArray(communityComments.postId, postIds),
          eq(communityComments.isDeleted, false)
        )
      )
      .groupBy(communityComments.postId),
    db
      .select({ postId: communityPostViews.postId })
      .from(communityPostViews)
      .where(
        and(
          inArray(communityPostViews.postId, postIds),
          eq(communityPostViews.userId, userId)
        )
      ),
    db
      .select({ postId: communityConfirmations.postId })
      .from(communityConfirmations)
      .where(
        and(
          inArray(communityConfirmations.postId, postIds),
          eq(communityConfirmations.userId, userId)
        )
      ),
  ]);

  const viewedSet = new Set(views.map((v) => v.postId));
  const confirmedSet = new Set(confirmations.map((c) => c.postId));
  const commentCountMap = new Map(comments.map((c) => [c.postId, Number(c.count)]));

  // Group reactions by postId
  const reactionsByPost = new Map<number, typeof reactions>();
  for (const r of reactions) {
    if (!reactionsByPost.has(r.postId)) reactionsByPost.set(r.postId, []);
    reactionsByPost.get(r.postId)!.push(r);
  }

  const enriched = rows.map((post) => {
    const postReactions = reactionsByPost.get(post.id) ?? [];
    const reactionCounts: Record<string, number> = {};
    let myReaction: string | null = null;
    for (const r of postReactions) {
      reactionCounts[r.emoji] = (reactionCounts[r.emoji] ?? 0) + 1;
      if (r.userId === userId) myReaction = r.emoji;
    }
    return {
      ...post,
      reactionCounts,
      myReaction,
      commentCount: commentCountMap.get(post.id) ?? 0,
      isViewed: viewedSet.has(post.id),
      isConfirmed: confirmedSet.has(post.id),
      isLocked:
        post.category === "first_class_lounge" && !isFirstClass,
    };
  });

  // Apply unread / unconfirmed filters post-enrichment
  let filtered = enriched;
  if (opts.unreadOnly) filtered = filtered.filter((p) => !p.isViewed);
  if (opts.unconfirmedOnly)
    filtered = filtered.filter(
      (p) => p.requiresConfirmation && !p.isConfirmed
    );

  // Total count (approximate — for pagination)
  const db2 = await getDb();
  if (!db2) return { posts: filtered, total: filtered.length };
  const [{ total }] = await db2
    .select({ total: sql<number>`COUNT(*)` })
    .from(communityPosts)
    .where(
      and(
        isAdmin ? undefined : eq(communityPosts.isDraft, false),
        isAdmin ? undefined : eq(communityPosts.isHidden, false),
        isFirstClass
          ? undefined
          : not(eq(communityPosts.category, "first_class_lounge" as any)),
        or(
          isNull(communityPosts.expiresAt),
          gt(communityPosts.expiresAt, new Date())
        )
      )
    );

  return { posts: filtered, total: Number(total) };
}

// ─── Get single post ──────────────────────────────────────────────────────────

export async function getCommunityPost(postId: number) {
  const db = await getDb();
  if (!db) return null;
  const [post] = await db
    .select()
    .from(communityPosts)
    .where(eq(communityPosts.id, postId));
  return post ?? null;
}

// ─── Create post ──────────────────────────────────────────────────────────────

export async function createCommunityPost(data: {
  authorId: number;
  authorName: string;
  category: CommunityPost["category"];
  supplierSubCategory?: string;
  supplierPostType?: "news" | "deal";
  title: string;
  bodyHtml: string;
  loomUrl?: string;
  imageUrls?: string[];
  attachmentUrls?: { name: string; url: string; key: string }[];
  isPinned?: boolean;
  isDraft?: boolean;
  requiresConfirmation?: boolean;
  expiresAt?: Date;
}) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.insert(communityPosts).values({
    ...data,
    imageUrls: data.imageUrls ? JSON.stringify(data.imageUrls) : null,
    attachmentUrls: data.attachmentUrls
      ? JSON.stringify(data.attachmentUrls)
      : null,
    requiresConfirmation:
      data.requiresConfirmation ?? data.category === "business_update",
  } as any);
  return (result as any).insertId as number;
}

// ─── Update post ──────────────────────────────────────────────────────────────

export async function updateCommunityPost(
  postId: number,
  data: Partial<{
    title: string;
    bodyHtml: string;
    loomUrl: string;
    imageUrls: string[];
    attachmentUrls: { name: string; url: string; key: string }[];
    isPinned: boolean;
    isHidden: boolean;
    isDraft: boolean;
    requiresConfirmation: boolean;
    expiresAt: Date | null;
    supplierSubCategory: string;
    supplierPostType: "news" | "deal";
  }>
) {
  const db = await getDb();
  if (!db) return;
  const updateData: any = { ...data };
  if (data.imageUrls !== undefined)
    updateData.imageUrls = JSON.stringify(data.imageUrls);
  if (data.attachmentUrls !== undefined)
    updateData.attachmentUrls = JSON.stringify(data.attachmentUrls);
  await db
    .update(communityPosts)
    .set(updateData)
    .where(eq(communityPosts.id, postId));
}

// ─── Delete post ──────────────────────────────────────────────────────────────

export async function deleteCommunityPost(postId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(communityPosts).where(eq(communityPosts.id, postId));
}

// ─── Record view ──────────────────────────────────────────────────────────────

export async function recordPostView(postId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  // Upsert — only record first view
  const [existing] = await db
    .select({ id: communityPostViews.id })
    .from(communityPostViews)
    .where(
      and(
        eq(communityPostViews.postId, postId),
        eq(communityPostViews.userId, userId)
      )
    );
  if (!existing) {
    await db.insert(communityPostViews).values({ postId, userId });
    await db
      .update(communityPosts)
      .set({ viewCount: sql`${communityPosts.viewCount} + 1` })
      .where(eq(communityPosts.id, postId));
  }
}

// ─── Reactions ────────────────────────────────────────────────────────────────

export async function toggleReaction(
  postId: number,
  userId: number,
  emoji: "thumbs_up" | "heart" | "celebrate" | "fire" | "plane"
) {
  const db = await getDb();
  if (!db) return null;
  const [existing] = await db
    .select()
    .from(communityReactions)
    .where(
      and(
        eq(communityReactions.postId, postId),
        eq(communityReactions.userId, userId)
      )
    );

  if (existing) {
    if (existing.emoji === emoji) {
      // Remove reaction
      await db
        .delete(communityReactions)
        .where(eq(communityReactions.id, existing.id));
      return null;
    } else {
      // Replace reaction
      await db
        .update(communityReactions)
        .set({ emoji })
        .where(eq(communityReactions.id, existing.id));
      return emoji;
    }
  } else {
    await db.insert(communityReactions).values({ postId, userId, emoji });
    return emoji;
  }
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export async function listComments(postId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(communityComments)
    .where(eq(communityComments.postId, postId))
    .orderBy(communityComments.createdAt);
}

export async function createComment(data: {
  postId: number;
  authorId: number;
  authorName: string;
  content: string;
}) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.insert(communityComments).values(data);
  return (result as any).insertId as number;
}

export async function deleteComment(commentId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(communityComments)
    .set({ isDeleted: true })
    .where(eq(communityComments.id, commentId));
}

// ─── Confirmations ────────────────────────────────────────────────────────────

export async function confirmPost(postId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  const [existing] = await db
    .select({ id: communityConfirmations.id })
    .from(communityConfirmations)
    .where(
      and(
        eq(communityConfirmations.postId, postId),
        eq(communityConfirmations.userId, userId)
      )
    );
  if (!existing) {
    await db.insert(communityConfirmations).values({ postId, userId });
  }
}

export async function getConfirmationStatus(postId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(communityConfirmations)
    .where(
      and(
        eq(communityConfirmations.postId, postId),
        eq(communityConfirmations.userId, userId)
      )
    );
  return row ?? null;
}

// ─── Compliance: get all agents and their confirmation status for a post ──────

export async function getComplianceReport(postId: number) {
  const db = await getDb();
  if (!db) return [];
  // Get all active agents
  const { users } = await import("../drizzle/schema");
  const agents = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      lastSignedIn: users.lastSignedIn,
    })
    .from(users)
    .where(
      and(
        eq(users.role, "agent"),
        eq(users.isActive, true)
      )
    );

  // Get all confirmations for this post
  const confirmations = await db
    .select()
    .from(communityConfirmations)
    .where(eq(communityConfirmations.postId, postId));

  const confirmedMap = new Map(
    confirmations.map((c) => [c.userId, c.confirmedAt])
  );

  return agents.map((agent) => ({
    ...agent,
    confirmed: confirmedMap.has(agent.id),
    confirmedAt: confirmedMap.get(agent.id) ?? null,
  }));
}

// ─── Unconfirmed Business Updates for a user ─────────────────────────────────

export async function getUnconfirmedBusinessUpdates(userId: number) {
  const db = await getDb();
  if (!db) return [];
  // Get all published, non-hidden, non-expired business update posts
  const posts = await db
    .select()
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.category, "business_update"),
        eq(communityPosts.isDraft, false),
        eq(communityPosts.isHidden, false),
        eq(communityPosts.requiresConfirmation, true),
        or(
          isNull(communityPosts.expiresAt),
          gt(communityPosts.expiresAt, new Date())
        )
      )
    );

  if (posts.length === 0) return [];

  const postIds = posts.map((p) => p.id);
  const confirmations = await db
    .select({ postId: communityConfirmations.postId })
    .from(communityConfirmations)
    .where(
      and(
        inArray(communityConfirmations.postId, postIds),
        eq(communityConfirmations.userId, userId)
      )
    );

  const confirmedSet = new Set(confirmations.map((c) => c.postId));
  return posts.filter((p) => !confirmedSet.has(p.id));
}

// ─── Recent community posts for dashboard widget ──────────────────────────────

export async function getRecentCommunityPostsForDashboard(opts: {
  userId: number;
  isFirstClass: boolean;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const { userId, isFirstClass, limit = 3 } = opts;

  const posts = await db
    .select()
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.isDraft, false),
        eq(communityPosts.isHidden, false),
        not(eq(communityPosts.category, "business_update")),
        isFirstClass
          ? undefined
          : not(eq(communityPosts.category, "first_class_lounge" as any)),
        or(
          isNull(communityPosts.expiresAt),
          gt(communityPosts.expiresAt, new Date())
        )
      )
    )
    .orderBy(desc(communityPosts.createdAt))
    .limit(limit);

  if (posts.length === 0) return [];

  const postIds = posts.map((p) => p.id);
  const views = await db
    .select({ postId: communityPostViews.postId })
    .from(communityPostViews)
    .where(
      and(
        inArray(communityPostViews.postId, postIds),
        eq(communityPostViews.userId, userId)
      )
    );
  const viewedSet = new Set(views.map((v) => v.postId));

  const reactions = await db
    .select({
      postId: communityReactions.postId,
      count: sql<number>`COUNT(*)`,
    })
    .from(communityReactions)
    .where(inArray(communityReactions.postId, postIds))
    .groupBy(communityReactions.postId);
  const reactionCountMap = new Map(reactions.map((r) => [r.postId, Number(r.count)]));

  const comments = await db
    .select({
      postId: communityComments.postId,
      count: sql<number>`COUNT(*)`,
    })
    .from(communityComments)
    .where(
      and(
        inArray(communityComments.postId, postIds),
        eq(communityComments.isDeleted, false)
      )
    )
    .groupBy(communityComments.postId);
  const commentCountMap = new Map(comments.map((c) => [c.postId, Number(c.count)]));

  return posts.map((p) => ({
    ...p,
    isViewed: viewedSet.has(p.id),
    totalReactions: reactionCountMap.get(p.id) ?? 0,
    commentCount: commentCountMap.get(p.id) ?? 0,
  }));
}

// ─── 14-day reminder: find agents who need a reminder ────────────────────────

export async function getAgentsNeedingConfirmationReminder() {
  const db = await getDb();
  if (!db) return [];
  const { users } = await import("../drizzle/schema");

  // All published business update posts requiring confirmation
  const posts = await db
    .select()
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.category, "business_update"),
        eq(communityPosts.isDraft, false),
        eq(communityPosts.isHidden, false),
        eq(communityPosts.requiresConfirmation, true),
        or(
          isNull(communityPosts.expiresAt),
          gt(communityPosts.expiresAt, new Date())
        )
      )
    );

  if (posts.length === 0) return [];

  const postIds = posts.map((p) => p.id);

  // All active agents who haven't logged in for 14+ days
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const agents = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      lastSignedIn: users.lastSignedIn,
    })
    .from(users)
    .where(
      and(
        eq(users.role, "agent"),
        eq(users.isActive, true),
        lt(users.lastSignedIn, fourteenDaysAgo)
      )
    );

  if (agents.length === 0) return [];

  const agentIds = agents.map((a) => a.id);

  // Already confirmed
  const confirmations = await db
    .select()
    .from(communityConfirmations)
    .where(
      and(
        inArray(communityConfirmations.postId, postIds),
        inArray(communityConfirmations.userId, agentIds)
      )
    );
  const confirmedKey = new Set(
    confirmations.map((c) => `${c.postId}-${c.userId}`)
  );

  // Already reminded in the last 14 days
  const recentReminders = await db
    .select()
    .from(communityConfirmationReminders)
    .where(
      and(
        inArray(communityConfirmationReminders.postId, postIds),
        inArray(communityConfirmationReminders.userId, agentIds),
        gt(communityConfirmationReminders.sentAt, fourteenDaysAgo)
      )
    );
  const remindedKey = new Set(
    recentReminders.map((r) => `${r.postId}-${r.userId}`)
  );

  const results: { post: typeof posts[0]; agent: typeof agents[0] }[] = [];
  for (const post of posts) {
    for (const agent of agents) {
      const key = `${post.id}-${agent.id}`;
      if (!confirmedKey.has(key) && !remindedKey.has(key)) {
        results.push({ post, agent });
      }
    }
  }
  return results;
}

export async function recordConfirmationReminder(
  postId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(communityConfirmationReminders)
    .values({ postId, userId });
}

// ─── Digest helpers ───────────────────────────────────────────────────────────

export async function getOrCreateWeeklyDigestDraft(weekStarting: Date) {
  const db = await getDb();
  if (!db) return null;
  const [existing] = await db
    .select()
    .from(communityDigests)
    .where(
      and(
        eq(communityDigests.weekStarting, weekStarting),
        eq(communityDigests.status, "draft")
      )
    );
  // If a draft already exists, refresh its stats and posts so Regenerate works
  // Auto-generate: collect posts from weekStarting up to now (current week)
  const weekAgo = new Date(weekStarting.getTime() - 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const posts = await db
    .select({ id: communityPosts.id })
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.isDraft, false),
        eq(communityPosts.isHidden, false),
        gt(communityPosts.createdAt, weekStarting),
        lt(communityPosts.createdAt, now)
      )
    )
    .orderBy(desc(communityPosts.createdAt));

  const postIds = posts.map((p) => p.id);

  // Stats snapshot — count bookings by bookedDate within the Fri–Fri window
  // weekStarting is the Friday the digest covers; weekEnd is the following Friday
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(weekStarting.getTime() + 7 * 24 * 60 * 60 * 1000);
  const { bookings, commissionClaims, reimbursementItems } = await import("../drizzle/schema");
  const [bookingCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(bookings)
    .where(and(
      isNotNull(bookings.bookedDate),
      gte(bookings.bookedDate, weekStarting),
      lt(bookings.bookedDate, weekEnd)
    ));

  const claimedThisWeek = await db
    .select({ grossAmount: commissionClaims.grossAmount })
    .from(commissionClaims)
    .where(
      and(
        gt(commissionClaims.claimedAt, sevenDaysAgo),
        lt(commissionClaims.claimedAt, now),
        or(
          eq(commissionClaims.status, "paid"),
          eq(commissionClaims.status, "awaiting_payment")
        )
      )
    );
  const commissionTotal = claimedThisWeek.reduce(
    (sum, c) => sum + Number(c.grossAmount ?? 0),
    0
  );

  // Count reimbursement items moved to scheduled status in the last 7 days
  const [reimbCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(reimbursementItems)
    .where(
      and(
        eq(reimbursementItems.status, "scheduled"),
        gt(reimbursementItems.scheduledAt, sevenDaysAgo),
        lt(reimbursementItems.scheduledAt, now)
      )
    );

  const statsSnapshot = {
    // Use field names the frontend expects
    bookingsThisWeek: Number(bookingCount.count),
    totalCommissionClaimed: commissionTotal,
    reimbursementsCount: Number(reimbCount.count),
  };

  // Fetch booking highlights using the same Mon–Sun week window
  const highlights = await getBookingHighlights(weekStarting, weekEnd);

  if (existing) {
    // Refresh stats, posts, and highlights on the existing draft
    await db
      .update(communityDigests)
      .set({
        includedPostIds: postIds,
        statsSnapshot: statsSnapshot,
        bookingHighlightsOverride: highlights,
        includeBookingHighlights: true,
      } as any)
      .where(eq(communityDigests.id, existing.id));
    const [refreshed] = await db
      .select()
      .from(communityDigests)
      .where(eq(communityDigests.id, existing.id));
    return refreshed;
  }

  const [result] = await db.insert(communityDigests).values({
    weekStarting,
    status: "draft",
    includedPostIds: postIds,
    includeBookingHighlights: true,
    bookingHighlightsOverride: highlights,
    statsSnapshot: statsSnapshot,
  } as any);

  const insertId = (result as any).insertId as number;
  const [created] = await db
    .select()
    .from(communityDigests)
    .where(eq(communityDigests.id, insertId));
  return created;
}

export async function updateDigest(
  digestId: number,
  data: Partial<{
    introText: string;
    includedPostIds: number[];
    includeBookingHighlights: boolean;
    bookingHighlightsOverride: any;
    statsSnapshot: any;
  }>
) {
  const db = await getDb();
  const updateData: any = { ...data };
  // JSON columns — Drizzle serialises them automatically, do not double-stringify
  // (includedPostIds, bookingHighlightsOverride, statsSnapshot are json() columns in schema)
  if (!db) return;
  await db
    .update(communityDigests)
    .set(updateData)
    .where(eq(communityDigests.id, digestId));
}

export async function markDigestSent(
  digestId: number,
  sentById: number,
  recipientCount: number
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(communityDigests)
    .set({ status: "sent", sentAt: new Date(), sentById, recipientCount })
    .where(eq(communityDigests.id, digestId));
}

export async function listDigests() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(communityDigests)
    .orderBy(desc(communityDigests.weekStarting));
}

export async function getDigest(digestId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(communityDigests)
    .where(eq(communityDigests.id, digestId));
  return row ?? null;
}

// ─── Booking highlights for digest ───────────────────────────────────────────

export async function getBookingHighlights(weekStart: Date, weekEnd: Date) {
  const db = await getDb();
  if (!db) return { firstBookings: [], highMargin: [], commissionClaimed: { agentNames: [], totalAmount: 0 } };
  const { bookings, users, commissionClaims } = await import("../drizzle/schema");

  // 1. "First real booking" this week — agents whose 2nd booking (skipping training holding account) falls this week
  const recentBookings = await db
    .select({
      agentId: bookings.agentId,
      agentName: users.name,
      bookingId: bookings.id,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .innerJoin(users, eq(bookings.agentId, users.id))
    .where(and(
      isNotNull(bookings.bookedDate),
      gte(bookings.bookedDate, weekStart),
      lt(bookings.bookedDate, weekEnd)
    ));

  // Collect the earliest booking this week per agent
  const agentBookingThisWeek = new Map<number, typeof recentBookings[0]>();
  for (const b of recentBookings) {
    if (!agentBookingThisWeek.has(b.agentId)) {
      agentBookingThisWeek.set(b.agentId, b);
    }
  }
  // Celebrate agents whose total booking count (including this week) is exactly 2
  // (1 training holding account + 1 real booking = 2 total)
  const firstBookingHighlights: { type: "first_booking"; agentName: string; bookingId: number }[] = [];
  for (const entry of Array.from(agentBookingThisWeek.entries())) {
    const [agentId, booking] = entry;
    const db2 = await getDb();
    if (!db2) continue;
    const [{ count }] = await db2
      .select({ count: sql<number>`COUNT(*)` })
      .from(bookings)
      .where(eq(bookings.agentId, agentId));
    if (Number(count) === 2) {
      firstBookingHighlights.push({
        type: "first_booking",
        agentName: booking.agentName ?? "An agent",
        bookingId: booking.bookingId,
      });
    }
  }

  // 2. Commission claimed this week
  const db4 = await getDb();
  if (!db4) return { firstBookings: firstBookingHighlights, commissionClaimed: { agentNames: [], totalAmount: 0 } };
  const claimedThisWeek = await db4
    .select({
      agentName: users.name,
      grossAmount: commissionClaims.grossAmount,
    })
    .from(commissionClaims)
    .innerJoin(users, eq(commissionClaims.agentId, users.id))
    .where(
      and(
        gte(commissionClaims.claimedAt, weekStart),
        lt(commissionClaims.claimedAt, weekEnd),
        or(
          eq(commissionClaims.status, "paid"),
          eq(commissionClaims.status, "awaiting_payment")
        )
      )
    );

  const commissionTotal = claimedThisWeek.reduce(
    (sum, c) => sum + Number(c.grossAmount ?? 0),
    0
  );
  const agentNames = Array.from(new Set(claimedThisWeek.map((c) => c.agentName ?? "An agent")));

  return {
    firstBookings: firstBookingHighlights,
    commissionClaimed: {
      agentNames,
      totalAmount: commissionTotal,
    },
  };
}
