import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  agentCrmProfiles,
  publicAgentProfileChanges,
  publicAgentProfileTags,
  publicAgentProfiles,
  publicEnquiries,
  publicSpecialityTags,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { sendDirectEmail } from "./email";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { isApprovedPublicUrl, isPublicAgentProfileVisible, publicEnquiryAdmission, toPublicAgentResponse } from "./consumer-site-logic";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

const socialFields = [
  "websiteUrl",
  "instagramUrl",
  "tiktokUrl",
  "facebookUrl",
  "linkedinUrl",
  "youtubeUrl",
  "pinterestUrl",
] as const;

type SocialField = (typeof socialFields)[number];
type PublicSnapshot = {
  displayName: string;
  businessName: string | null;
  biography: string;
  profilePhotoUrl: string | null;
  listingTown: string;
  townLatitude: string | null;
  townLongitude: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  youtubeUrl: string | null;
  pinterestUrl: string | null;
};

const profileDraftSchema = z.object({
  displayName: z.string().trim().min(2).max(255),
  businessName: z.string().trim().max(255).optional().nullable(),
  biography: z.string().trim().min(80).max(2_000),
  listingTown: z.string().trim().min(2).max(120),
  townLatitude: z.number().min(-90).max(90).optional().nullable(),
  townLongitude: z.number().min(-180).max(180).optional().nullable(),
  enquiryDeliveryEmail: z.string().trim().email().max(320),
  websiteUrl: z.string().trim().max(1_000).optional().nullable(),
  instagramUrl: z.string().trim().max(1_000).optional().nullable(),
  tiktokUrl: z.string().trim().max(1_000).optional().nullable(),
  facebookUrl: z.string().trim().max(1_000).optional().nullable(),
  linkedinUrl: z.string().trim().max(1_000).optional().nullable(),
  youtubeUrl: z.string().trim().max(1_000).optional().nullable(),
  pinterestUrl: z.string().trim().max(1_000).optional().nullable(),
  specialityTagIds: z.array(z.number().int().positive()).max(12),
  consentConfirmed: z.literal(true),
});

function normaliseOptional(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
  return slug || "jlt-travel-agent";
}

function safeUrl(value: string | null, hosts?: string[]): string | null {
  if (!value) return null;
  if (!isApprovedPublicUrl(value, hosts)) {
    let parsed: URL | null = null;
    try { parsed = new URL(value); } catch { /* handled below */ }
    if (!parsed) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Please enter a complete secure website address beginning with https://." });
    }
    if (parsed.protocol !== "https:") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Public website and social links must use https://." });
    }
    throw new TRPCError({ code: "BAD_REQUEST", message: "This link does not match the selected social platform." });
  }
  try {
    const url = new URL(value);
    return url.toString();
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Please enter a complete secure website address beginning with https://." });
  }
}

function normaliseDraft(input: z.infer<typeof profileDraftSchema>) {
  return {
    displayName: input.displayName.trim(),
    businessName: normaliseOptional(input.businessName),
    biography: input.biography.trim(),
    listingTown: input.listingTown.trim(),
    townLatitude: input.townLatitude === null || input.townLatitude === undefined ? null : String(input.townLatitude),
    townLongitude: input.townLongitude === null || input.townLongitude === undefined ? null : String(input.townLongitude),
    enquiryDeliveryEmail: input.enquiryDeliveryEmail.trim().toLowerCase(),
    websiteUrl: safeUrl(normaliseOptional(input.websiteUrl)),
    instagramUrl: safeUrl(normaliseOptional(input.instagramUrl), ["instagram.com"]),
    tiktokUrl: safeUrl(normaliseOptional(input.tiktokUrl), ["tiktok.com"]),
    facebookUrl: safeUrl(normaliseOptional(input.facebookUrl), ["facebook.com", "fb.com"]),
    linkedinUrl: safeUrl(normaliseOptional(input.linkedinUrl), ["linkedin.com"]),
    youtubeUrl: safeUrl(normaliseOptional(input.youtubeUrl), ["youtube.com", "youtu.be"]),
    pinterestUrl: safeUrl(normaliseOptional(input.pinterestUrl), ["pinterest.com", "pin.it"]),
  };
}

function toSnapshot(profile: typeof publicAgentProfiles.$inferSelect): PublicSnapshot {
  return {
    displayName: profile.displayName ?? "JLT Travel Agent",
    businessName: profile.businessName ?? null,
    biography: profile.biography ?? "",
    profilePhotoUrl: profile.profilePhotoUrl ?? null,
    listingTown: profile.listingTown ?? "",
    townLatitude: profile.townLatitude ? String(profile.townLatitude) : null,
    townLongitude: profile.townLongitude ? String(profile.townLongitude) : null,
    websiteUrl: profile.websiteUrl ?? null,
    instagramUrl: profile.instagramUrl ?? null,
    tiktokUrl: profile.tiktokUrl ?? null,
    facebookUrl: profile.facebookUrl ?? null,
    linkedinUrl: profile.linkedinUrl ?? null,
    youtubeUrl: profile.youtubeUrl ?? null,
    pinterestUrl: profile.pinterestUrl ?? null,
  };
}

function readSnapshot(value: unknown): PublicSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<PublicSnapshot>;
  if (!record.displayName || !record.biography || !record.listingTown) return null;
  return {
    displayName: record.displayName,
    businessName: record.businessName ?? null,
    biography: record.biography,
    profilePhotoUrl: record.profilePhotoUrl ?? null,
    listingTown: record.listingTown,
    townLatitude: record.townLatitude ?? null,
    townLongitude: record.townLongitude ?? null,
    websiteUrl: record.websiteUrl ?? null,
    instagramUrl: record.instagramUrl ?? null,
    tiktokUrl: record.tiktokUrl ?? null,
    facebookUrl: record.facebookUrl ?? null,
    linkedinUrl: record.linkedinUrl ?? null,
    youtubeUrl: record.youtubeUrl ?? null,
    pinterestUrl: record.pinterestUrl ?? null,
  };
}

function publicProfilePayload(profile: typeof publicAgentProfiles.$inferSelect, tags: Array<{ id: number; label: string; category: "destination" | "travel_type" }>) {
  const snapshot = readSnapshot(profile.publishedSnapshot);
  if (!snapshot || !profile.publicSlug) return null;
  return toPublicAgentResponse({ publicSlug: profile.publicSlug, ...snapshot }, tags);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

async function getProfileTagRows(profileId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ id: publicSpecialityTags.id, label: publicSpecialityTags.label, category: publicSpecialityTags.category })
    .from(publicAgentProfileTags)
    .innerJoin(publicSpecialityTags, eq(publicAgentProfileTags.specialityTagId, publicSpecialityTags.id))
    .where(eq(publicAgentProfileTags.profileId, profileId));
  return rows;
}

async function writeProfileChange(params: {
  profileId: number;
  agentId: number;
  action: "draft_saved" | "submitted" | "published" | "changes_requested" | "hidden_manual" | "hidden_status" | "reactivation_review";
  actorUserId?: number | null;
  note?: string | null;
  snapshot?: Record<string, unknown> | null;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(publicAgentProfileChanges).values({
    profileId: params.profileId,
    agentId: params.agentId,
    action: params.action,
    actorUserId: params.actorUserId ?? null,
    note: params.note ?? null,
    snapshot: params.snapshot ?? null,
  });
}

async function savePublicProfileDraft(input: z.infer<typeof profileDraftSchema>, userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const normalised = normaliseDraft(input);
  const validTags = input.specialityTagIds.length
    ? await db.select({ id: publicSpecialityTags.id }).from(publicSpecialityTags)
      .where(and(eq(publicSpecialityTags.isActive, true), inArray(publicSpecialityTags.id, input.specialityTagIds)))
    : [];
  if (validTags.length !== input.specialityTagIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "One or more selected speciality tags are no longer available." });
  }
  const [existing] = await db.select().from(publicAgentProfiles).where(eq(publicAgentProfiles.userId, userId)).limit(1);
  const update = {
    ...normalised,
    consentConfirmedAt: new Date(),
    reviewStatus: existing?.isPublished ? existing.reviewStatus : "draft" as const,
    reviewNote: null,
  };
  let profileId: number;
  if (existing) {
    await db.update(publicAgentProfiles).set(update).where(eq(publicAgentProfiles.id, existing.id));
    profileId = existing.id;
  } else {
    const [result] = await db.insert(publicAgentProfiles).values({ userId, ...update });
    profileId = Number((result as any).insertId);
  }
  await db.delete(publicAgentProfileTags).where(eq(publicAgentProfileTags.profileId, profileId));
  if (input.specialityTagIds.length) {
    await db.insert(publicAgentProfileTags).values(input.specialityTagIds.map((specialityTagId) => ({ profileId, specialityTagId })));
  }
  await writeProfileChange({ profileId, agentId: userId, action: "draft_saved", actorUserId: userId, note: "Agent saved public-profile draft." });
  return { profileId };
}

/** Called only by the CRM's authoritative status update procedure. */
export async function enforcePublicProfileVisibilityForStatus(params: {
  userId: number;
  agentStatus: "active" | "paused" | "in_notice" | "cancelled" | "suspended";
  actorUserId?: number | null;
}) {
  const db = await getDb();
  if (!db) return { updated: false };
  const [profile] = await db.select().from(publicAgentProfiles).where(eq(publicAgentProfiles.userId, params.userId)).limit(1);
  if (!profile) return { updated: false };

  if (params.agentStatus === "active") {
    if (!profile.isPublished) {
      await db.update(publicAgentProfiles).set({
        reviewStatus: "in_review",
        hiddenReason: "reactivated_requires_review",
      }).where(eq(publicAgentProfiles.id, profile.id));
      await writeProfileChange({
        profileId: profile.id,
        agentId: params.userId,
        action: "reactivation_review",
        actorUserId: params.actorUserId,
        note: "Agent returned to Active. Public profile remains hidden until staff publish it again.",
      });
      return { updated: true, action: "reactivation_review" as const };
    }
    return { updated: false };
  }

  await db.update(publicAgentProfiles).set({
    isPublished: false,
    reviewStatus: "hidden",
    hiddenAt: new Date(),
    hiddenReason: `agent_status_${params.agentStatus}`,
  }).where(eq(publicAgentProfiles.id, profile.id));
  await writeProfileChange({
    profileId: profile.id,
    agentId: params.userId,
    action: "hidden_status",
    actorUserId: params.actorUserId,
    note: `Profile hidden automatically because the agent status changed to ${params.agentStatus}.`,
  });
  return { updated: true, action: "hidden_status" as const };
}

/** Called when the separate In Contract flag is enabled on an otherwise Active agent. */
export async function enforcePublicProfileVisibilityForInContract(params: {
  userId: number;
  actorUserId?: number | null;
}) {
  const db = await getDb();
  if (!db) return { updated: false };
  const [profile] = await db.select().from(publicAgentProfiles).where(eq(publicAgentProfiles.userId, params.userId)).limit(1);
  if (!profile) return { updated: false };
  await db.update(publicAgentProfiles).set({
    isPublished: false,
    reviewStatus: "hidden",
    hiddenAt: new Date(),
    hiddenReason: "agent_in_contract",
  }).where(eq(publicAgentProfiles.id, profile.id));
  await writeProfileChange({
    profileId: profile.id,
    agentId: params.userId,
    action: "hidden_status",
    actorUserId: params.actorUserId,
    note: "Profile hidden automatically because the agent was marked In Contract.",
  });
  return { updated: true, action: "hidden_status" as const };
}

export const consumerSiteRouter = router({
  tags: router({
    list: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: publicSpecialityTags.id,
        category: publicSpecialityTags.category,
        label: publicSpecialityTags.label,
        slug: publicSpecialityTags.slug,
      }).from(publicSpecialityTags).where(eq(publicSpecialityTags.isActive, true)).orderBy(publicSpecialityTags.category, publicSpecialityTags.sortOrder, publicSpecialityTags.label);
    }),
    create: adminProcedure.input(z.object({
      category: z.enum(["destination", "travel_type"]),
      label: z.string().trim().min(2).max(120),
    })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const slug = slugify(input.label);
      try {
        const [result] = await db.insert(publicSpecialityTags).values({ category: input.category, label: input.label.trim(), slug });
        return { id: Number((result as any).insertId), slug };
      } catch (error: any) {
        if (error?.code === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "That speciality tag already exists." });
        throw error;
      }
    }),
    setActive: adminProcedure.input(z.object({ id: z.number().int(), isActive: z.boolean() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.update(publicSpecialityTags).set({ isActive: input.isActive }).where(eq(publicSpecialityTags.id, input.id));
      return { success: true };
    }),
  }),

  profile: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { profile: null, selectedTagIds: [] as number[], history: [] };
      const [profile] = await db.select().from(publicAgentProfiles).where(eq(publicAgentProfiles.userId, ctx.user.id)).limit(1);
      if (!profile) return { profile: null, selectedTagIds: [] as number[], history: [] };
      const [tagRows, history] = await Promise.all([
        db.select({ specialityTagId: publicAgentProfileTags.specialityTagId }).from(publicAgentProfileTags).where(eq(publicAgentProfileTags.profileId, profile.id)),
        db.select({ action: publicAgentProfileChanges.action, note: publicAgentProfileChanges.note, createdAt: publicAgentProfileChanges.createdAt })
          .from(publicAgentProfileChanges).where(eq(publicAgentProfileChanges.profileId, profile.id)).orderBy(desc(publicAgentProfileChanges.createdAt)).limit(12),
      ]);
      return { profile, selectedTagIds: tagRows.map((row) => row.specialityTagId), history };
    }),

    saveDraft: protectedProcedure.input(profileDraftSchema).mutation(async ({ input, ctx }) => {
      const { profileId } = await savePublicProfileDraft(input, ctx.user.id);
      return { success: true, profileId };
    }),

    submitForReview: protectedProcedure.input(profileDraftSchema).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const { profileId } = await savePublicProfileDraft(input, ctx.user.id);
      const [profile] = await db.select().from(publicAgentProfiles).where(eq(publicAgentProfiles.id, profileId)).limit(1);
      if (!profile || !profile.displayName || !profile.biography || !profile.listingTown || !profile.enquiryDeliveryEmail || !profile.consentConfirmedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Complete and save your public profile, including consent, before submitting it for review." });
      }
      const selectedTags = await db.select({ id: publicAgentProfileTags.id }).from(publicAgentProfileTags).where(eq(publicAgentProfileTags.profileId, profile.id));
      if (!selectedTags.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Select at least one destination or travel-type speciality before submitting." });
      }
      await db.update(publicAgentProfiles).set({ reviewStatus: "in_review", submittedAt: new Date(), reviewNote: null }).where(eq(publicAgentProfiles.id, profile.id));
      await writeProfileChange({ profileId: profile.id, agentId: ctx.user.id, action: "submitted", actorUserId: ctx.user.id, note: "Agent submitted profile for staff review." });
      return { success: true };
    }),

    uploadPhoto: protectedProcedure.input(z.object({
      fileBase64: z.string().min(1),
      fileName: z.string().min(1).max(255),
      mimeType: z.enum(["image/jpeg", "image/jpg", "image/png"]),
    })).mutation(async ({ input, ctx }) => {
      const decoded = Buffer.from(input.fileBase64, "base64");
      if (decoded.length > 5 * 1024 * 1024) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Profile photographs must be 5 MB or smaller." });
      }
      const extension = input.mimeType === "image/png" ? "png" : "jpg";
      const key = `consumer-agent-profiles/${ctx.user.id}/${nanoid(14)}.${extension}`;
      const { url } = await storagePut(key, decoded, input.mimeType === "image/jpg" ? "image/jpeg" : input.mimeType);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [profile] = await db.select().from(publicAgentProfiles).where(eq(publicAgentProfiles.userId, ctx.user.id)).limit(1);
      if (profile) {
        await db.update(publicAgentProfiles).set({ profilePhotoUrl: url, profilePhotoKey: key }).where(eq(publicAgentProfiles.id, profile.id));
      } else {
        await db.insert(publicAgentProfiles).values({ userId: ctx.user.id, profilePhotoUrl: url, profilePhotoKey: key });
      }
      return { url };
    }),
  }),

  admin: router({
    listProfiles: adminProcedure.input(z.object({
      status: z.enum(["all", "draft", "in_review", "changes_requested", "published", "hidden"]).default("in_review"),
    }).optional()).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const filter = input?.status ?? "in_review";
      return db.select({
        profile: publicAgentProfiles,
        agentName: users.name,
        agentEmail: users.email,
        agentStatus: agentCrmProfiles.agentStatus,
      }).from(publicAgentProfiles)
        .innerJoin(users, eq(publicAgentProfiles.userId, users.id))
        .leftJoin(agentCrmProfiles, eq(publicAgentProfiles.userId, agentCrmProfiles.userId))
        .where(filter === "all" ? undefined : eq(publicAgentProfiles.reviewStatus, filter))
        .orderBy(desc(publicAgentProfiles.submittedAt), desc(publicAgentProfiles.updatedAt));
    }),

    profileDetails: adminProcedure.input(z.object({ userId: z.number().int() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [profile] = await db.select().from(publicAgentProfiles).where(eq(publicAgentProfiles.userId, input.userId)).limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Public profile not found" });
      const [tags, history] = await Promise.all([
        getProfileTagRows(profile.id),
        db.select().from(publicAgentProfileChanges).where(eq(publicAgentProfileChanges.profileId, profile.id)).orderBy(desc(publicAgentProfileChanges.createdAt)).limit(30),
      ]);
      return { profile, tags, history };
    }),

    reviewProfile: adminProcedure.input(z.object({
      userId: z.number().int(),
      action: z.enum(["publish", "request_changes", "hide"]),
      note: z.string().trim().max(2_000).optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [profile] = await db.select().from(publicAgentProfiles).where(eq(publicAgentProfiles.userId, input.userId)).limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Public profile not found" });
      const [crmProfile] = await db.select({ agentStatus: agentCrmProfiles.agentStatus }).from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, input.userId)).limit(1);

      if (input.action === "publish") {
        if (crmProfile?.agentStatus !== "active") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only agents listed as Active can have a public profile published." });
        }
        if (!profile.displayName || !profile.biography || !profile.listingTown || !profile.enquiryDeliveryEmail || !profile.consentConfirmedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The profile is incomplete and cannot be published." });
        }
        const tagRows = await getProfileTagRows(profile.id);
        if (!tagRows.length) throw new TRPCError({ code: "BAD_REQUEST", message: "The profile needs at least one approved speciality tag." });
        const publicSlug = profile.publicSlug ?? `${slugify(profile.displayName)}-${profile.userId}`;
        const snapshot = toSnapshot(profile);
        await db.update(publicAgentProfiles).set({
          publicSlug,
          publishedSnapshot: snapshot,
          publishedTagIds: tagRows.map((tag) => tag.id),
          publishedEnquiryDeliveryEmail: profile.enquiryDeliveryEmail,
          reviewStatus: "published",
          isPublished: true,
          reviewedById: ctx.user.id,
          reviewedAt: new Date(),
          reviewNote: normaliseOptional(input.note),
          publishedAt: new Date(),
          hiddenAt: null,
          hiddenReason: null,
        }).where(eq(publicAgentProfiles.id, profile.id));
        await writeProfileChange({ profileId: profile.id, agentId: input.userId, action: "published", actorUserId: ctx.user.id, note: normaliseOptional(input.note), snapshot });
      } else if (input.action === "request_changes") {
        await db.update(publicAgentProfiles).set({
          reviewStatus: "changes_requested",
          reviewedById: ctx.user.id,
          reviewedAt: new Date(),
          reviewNote: normaliseOptional(input.note) ?? "Please update your profile and submit it again for review.",
        }).where(eq(publicAgentProfiles.id, profile.id));
        await writeProfileChange({ profileId: profile.id, agentId: input.userId, action: "changes_requested", actorUserId: ctx.user.id, note: normaliseOptional(input.note) });
      } else {
        await db.update(publicAgentProfiles).set({
          isPublished: false,
          reviewStatus: "hidden",
          reviewedById: ctx.user.id,
          reviewedAt: new Date(),
          reviewNote: normaliseOptional(input.note),
          hiddenAt: new Date(),
          hiddenReason: "manual_staff_hide",
        }).where(eq(publicAgentProfiles.id, profile.id));
        await writeProfileChange({ profileId: profile.id, agentId: input.userId, action: "hidden_manual", actorUserId: ctx.user.id, note: normaliseOptional(input.note) });
      }
      return { success: true };
    }),

    listEnquiries: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional()).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: publicEnquiries.id,
        customerName: publicEnquiries.customerName,
        customerEmail: publicEnquiries.customerEmail,
        customerPhone: publicEnquiries.customerPhone,
        travelBrief: publicEnquiries.travelBrief,
        deliveryStatus: publicEnquiries.deliveryStatus,
        deliveredAt: publicEnquiries.deliveredAt,
        createdAt: publicEnquiries.createdAt,
        agentName: users.name,
      }).from(publicEnquiries).innerJoin(users, eq(publicEnquiries.agentId, users.id)).orderBy(desc(publicEnquiries.createdAt)).limit(input?.limit ?? 50);
    }),
  }),

  public: router({
    listAgents: publicProcedure.input(z.object({
      tagIds: z.array(z.number().int().positive()).max(8).default([]),
      search: z.string().trim().max(120).optional(),
      town: z.string().trim().max(120).optional(),
    }).optional()).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const profiles = await db.select({ profile: publicAgentProfiles, agentStatus: agentCrmProfiles.agentStatus })
        .from(publicAgentProfiles)
        .innerJoin(users, eq(publicAgentProfiles.userId, users.id))
        .innerJoin(agentCrmProfiles, eq(publicAgentProfiles.userId, agentCrmProfiles.userId))
        .where(and(eq(publicAgentProfiles.isPublished, true), eq(agentCrmProfiles.agentStatus, "active")));
      const inContractRows = await db.select({ userId: agentCrmProfiles.userId }).from(agentCrmProfiles).where(eq(agentCrmProfiles.inContract, true));
      const inContractUserIds = new Set(inContractRows.map(row => row.userId));
      const allTagRows = await db.select({ id: publicSpecialityTags.id, label: publicSpecialityTags.label, category: publicSpecialityTags.category }).from(publicSpecialityTags).where(eq(publicSpecialityTags.isActive, true));
      const tagMap = new Map(allTagRows.map((tag) => [tag.id, tag]));
      const query = input?.search?.trim().toLowerCase();
      const town = input?.town?.trim().toLowerCase();
      return profiles.flatMap(({ profile }) => {
        const ids = Array.isArray(profile.publishedTagIds) ? profile.publishedTagIds.map(Number).filter(Number.isInteger) : [];
        if (input?.tagIds?.some((id) => !ids.includes(id))) return [];
        const tags = ids.map((id) => tagMap.get(id)).filter((tag): tag is NonNullable<typeof tag> => !!tag);
        const payload = publicProfilePayload(profile, tags);
        if (!payload || !isPublicAgentProfileVisible({ isPublished: profile.isPublished, agentStatus: "active", inContract: inContractUserIds.has(profile.userId), hasPublishedSnapshot: true, hasPublicSlug: Boolean(profile.publicSlug) })) return [];
        const searchable = `${payload.displayName} ${payload.businessName ?? ""} ${payload.listingTown} ${tags.map((tag) => tag.label).join(" ")}`.toLowerCase();
        if (query && !searchable.includes(query)) return [];
        if (town && !payload.listingTown.toLowerCase().includes(town)) return [];
        return [payload];
      }).sort((a, b) => a.displayName.localeCompare(b.displayName));
    }),

    getAgent: publicProcedure.input(z.object({ slug: z.string().min(3).max(180) })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [result] = await db.select({ profile: publicAgentProfiles, agentStatus: agentCrmProfiles.agentStatus })
        .from(publicAgentProfiles)
        .innerJoin(agentCrmProfiles, eq(publicAgentProfiles.userId, agentCrmProfiles.userId))
        .where(and(eq(publicAgentProfiles.publicSlug, input.slug), eq(publicAgentProfiles.isPublished, true), eq(agentCrmProfiles.agentStatus, "active")))
        .limit(1);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "This travel-agent profile is not available." });
      const [currentAgent] = await db.select({ inContract: agentCrmProfiles.inContract }).from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, result.profile.userId)).limit(1);
      if (!isPublicAgentProfileVisible({ isPublished: result.profile.isPublished, agentStatus: result.agentStatus, inContract: currentAgent?.inContract, hasPublishedSnapshot: Boolean(readSnapshot(result.profile.publishedSnapshot)), hasPublicSlug: Boolean(result.profile.publicSlug) })) throw new TRPCError({ code: "NOT_FOUND", message: "This travel-agent profile is not available." });
      const ids = Array.isArray(result.profile.publishedTagIds) ? result.profile.publishedTagIds.map(Number).filter(Number.isInteger) : [];
      const tags = ids.length ? await db.select({ id: publicSpecialityTags.id, label: publicSpecialityTags.label, category: publicSpecialityTags.category }).from(publicSpecialityTags).where(inArray(publicSpecialityTags.id, ids)) : [];
      const payload = publicProfilePayload(result.profile, tags);
      if (!payload) throw new TRPCError({ code: "NOT_FOUND", message: "This travel-agent profile is not available." });
      return payload;
    }),

    submitEnquiry: publicProcedure.input(z.object({
      slug: z.string().min(3).max(180),
      customerName: z.string().trim().min(2).max(255),
      customerEmail: z.string().trim().email().max(320),
      customerPhone: z.string().trim().max(40).optional().nullable(),
      travelBrief: z.string().trim().min(20).max(4_000),
      consentConfirmed: z.literal(true),
    })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [result] = await db.select({ profile: publicAgentProfiles, agentStatus: agentCrmProfiles.agentStatus })
        .from(publicAgentProfiles)
        .innerJoin(agentCrmProfiles, eq(publicAgentProfiles.userId, agentCrmProfiles.userId))
        .where(and(eq(publicAgentProfiles.publicSlug, input.slug), eq(publicAgentProfiles.isPublished, true), eq(agentCrmProfiles.agentStatus, "active")))
        .limit(1);
      if (!result || !result.profile.publishedEnquiryDeliveryEmail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This travel-agent profile is not available." });
      }
      const [currentAgent] = await db.select({ inContract: agentCrmProfiles.inContract }).from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, result.profile.userId)).limit(1);
      const profileVisible = isPublicAgentProfileVisible({ isPublished: result.profile.isPublished, agentStatus: result.agentStatus, inContract: currentAgent?.inContract, hasPublishedSnapshot: Boolean(readSnapshot(result.profile.publishedSnapshot)), hasPublicSlug: Boolean(result.profile.publicSlug) });
      if (publicEnquiryAdmission({ profileVisible, recentSubmissionCount: 0 }) === "profile_unavailable") {
        throw new TRPCError({ code: "NOT_FOUND", message: "This travel-agent profile is not available." });
      }
      const ipSource = `${ctx.req.ip ?? "unknown"}:${process.env.JWT_SECRET ?? "consumer-site"}`;
      const ipHash = createHash("sha256").update(ipSource).digest("hex");
      const windowStart = new Date(Date.now() - 15 * 60 * 1000);
      const recent = await db.select({ id: publicEnquiries.id }).from(publicEnquiries)
        .where(and(eq(publicEnquiries.ipHash, ipHash), gte(publicEnquiries.createdAt, windowStart))).limit(3);
      if (publicEnquiryAdmission({ profileVisible, recentSubmissionCount: recent.length }) === "rate_limited") {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait a few minutes before sending another enquiry." });
      }

      const [insertResult] = await db.insert(publicEnquiries).values({
        profileId: result.profile.id,
        agentId: result.profile.userId,
        customerName: input.customerName.trim(),
        customerEmail: input.customerEmail.trim().toLowerCase(),
        customerPhone: normaliseOptional(input.customerPhone),
        travelBrief: input.travelBrief.trim(),
        consentConfirmedAt: new Date(),
        ipHash,
      });
      const enquiryId = Number((insertResult as any).insertId);
      const snapshot = readSnapshot(result.profile.publishedSnapshot);
      const agentName = snapshot?.displayName ?? "JLT Travel Agent";
      const safeName = escapeHtml(input.customerName.trim());
      const safeEmail = escapeHtml(input.customerEmail.trim().toLowerCase());
      const safePhone = escapeHtml(normaliseOptional(input.customerPhone) ?? "Not supplied");
      const safeBrief = escapeHtml(input.travelBrief.trim()).replace(/\n/g, "<br />");

      const delivery = await sendDirectEmail({
        toEmail: result.profile.publishedEnquiryDeliveryEmail,
        toName: agentName,
        userId: result.profile.userId,
        triggerKey: "consumer_agent_enquiry",
        subject: `New website enquiry from ${input.customerName.trim()}`,
        html: `<p>Hello ${escapeHtml(agentName)},</p><p>You have received a new enquiry through your JLT public profile.</p><p><strong>Name:</strong> ${safeName}<br /><strong>Email:</strong> ${safeEmail}<br /><strong>Phone:</strong> ${safePhone}</p><p><strong>Travel plans:</strong><br />${safeBrief}</p><p>Please reply directly to the customer using the details above.</p>`,
      });
      await db.update(publicEnquiries).set(delivery.success ? {
        deliveryStatus: "sent",
        deliveredAt: new Date(),
        deliveryError: null,
      } : {
        deliveryStatus: "failed",
        deliveryError: (delivery.error ?? "Email delivery failed").slice(0, 500),
      }).where(eq(publicEnquiries.id, enquiryId));

      // Acknowledge receipt without disclosing the agent's private delivery email.
      try {
        await sendDirectEmail({
          toEmail: input.customerEmail.trim().toLowerCase(),
          toName: input.customerName.trim(),
          triggerKey: "consumer_enquiry_acknowledgement",
          subject: "We’ve passed your travel enquiry to your JLT travel expert",
          html: `<p>Hi ${safeName},</p><p>Thank you for getting in touch. Your enquiry has been passed to ${escapeHtml(agentName)}, your JLT travel expert.</p><p>They will be in touch directly to discuss your travel plans.</p><p>Kind regards,<br />The JLT Group</p>`,
        });
      } catch (error) {
        // Agent delivery and its audit record are authoritative. An optional
        // acknowledgement must never make the original enquiry appear to fail.
        console.error("[ConsumerEnquiry] Customer acknowledgement failed", error);
      }
      return { success: true };
    }),
  }),
});
