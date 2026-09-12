import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, gt, inArray, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  agentCrmProfiles,
  publicAgentProfileChanges,
  publicAgentProfileTags,
  publicAgentProfiles,
  publicEnquiries,
  publicHolidayShowcaseEditRequests,
  publicHolidayShowcaseEvents,
  publicHolidayShowcases,
  publicPartnerProfiles,
  publicSpecialityTags,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { sendDirectEmail } from "./email";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { isApprovedPublicUrl, isPublicAgentProfileVisible, matchesPublicDirectoryTags, publicEnquiryAdmission, toPublicAgentResponse } from "./consumer-site-logic";
import { holidayShowcaseEditDraftSchema, isPublicShowcaseVisible, toPublicShowcaseCard, toPublicShowcaseDetail, type HolidayShowcaseEditDraft } from "./holiday-showcase-logic";

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

const partnerDraftSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(255),
  category: z.string().trim().max(120).optional().nullable(),
  summary: z.string().trim().min(20).max(1_500).optional().nullable(),
  logoUrl: z.string().trim().max(2_000).optional().nullable(),
  websiteUrl: z.string().trim().max(1_000).optional().nullable(),
  isPublished: z.boolean(),
  sortOrder: z.number().int().min(0).max(9_999),
});

const showcaseIdSchema = z.object({ id: z.number().int().positive() });

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function imageUrls(value: unknown): string[] {
  const images = jsonValue(value);
  if (!Array.isArray(images)) return [];
  return images.flatMap((image) => image && typeof image === "object" && typeof (image as Record<string, unknown>).url === "string"
    ? [(image as Record<string, unknown>).url as string]
    : []);
}

function showcaseSourceImageUrls(value: unknown): string[] {
  const snapshot = jsonValue(value);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const source = snapshot as Record<string, unknown>;
  const heroImage = source.heroImage && typeof source.heroImage === "object" && typeof (source.heroImage as Record<string, unknown>).url === "string"
    ? [(source.heroImage as Record<string, unknown>).url as string]
    : [];
  const sectionImages = Array.isArray(jsonValue(source.curatedSections))
    ? (jsonValue(source.curatedSections) as unknown[]).flatMap((section) => section && typeof section === "object" ? imageUrls((section as Record<string, unknown>).images) : [])
    : [];
  const legacyItineraryImages = Array.isArray(jsonValue(source.itinerary))
    ? (jsonValue(source.itinerary) as unknown[]).flatMap((item) => item && typeof item === "object" ? imageUrls([(item as Record<string, unknown>).image]) : [])
    : [];
  const accommodationImages = Array.isArray(jsonValue(source.accommodationOptions))
    ? (jsonValue(source.accommodationOptions) as unknown[]).flatMap((item) => item && typeof item === "object" ? imageUrls([(item as Record<string, unknown>).image]) : [])
    : [];
  return [...heroImage, ...imageUrls(source.itineraryImages), ...sectionImages, ...legacyItineraryImages, ...accommodationImages];
}

function showcaseDraftImageUrls(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const draft = value as Record<string, unknown>;
  const heroUrl = draft.heroImage && typeof draft.heroImage === "object" && typeof (draft.heroImage as Record<string, unknown>).url === "string"
    ? [(draft.heroImage as Record<string, unknown>).url as string]
    : [];
  const sectionUrls = Array.isArray(draft.curatedSections)
    ? draft.curatedSections.flatMap((section) => section && typeof section === "object" ? imageUrls((section as Record<string, unknown>).images) : [])
    : [];
  return [...heroUrl, ...imageUrls(draft.itineraryImages), ...sectionUrls];
}

function showcaseEditValues(draft: HolidayShowcaseEditDraft, showcase: typeof publicHolidayShowcases.$inferSelect) {
  return {
    title: draft.title,
    summary: draft.summary,
    destination: draft.destination,
    travelPeriodLabel: draft.travelPeriodLabel ?? null,
    durationNights: draft.durationNights ?? null,
    priceMode: draft.priceAmount === null ? null : "from" as const,
    priceAmount: draft.priceAmount === null ? null : String(draft.priceAmount),
    priceCurrency: draft.priceAmount === null ? null : "GBP",
    pricePerPerson: true,
    heroImageUrl: draft.heroImage?.url ?? null,
    heroImageSource: draft.heroImage?.source ?? null,
    itineraryImages: draft.itineraryImages.map(({ url, source, label, category }) => ({ url, source, label, category })),
    curatedSections: draft.curatedSections ? draft.curatedSections.map(({ id, kind, title, summary, facts, images }) => ({
      id, kind, title, summary, facts,
      images: images.map(({ url, source, label, category }) => ({ url, source, label, category })),
    })) : showcase.curatedSections,
    editorialTags: draft.editorialTags,
    inclusions: draft.inclusions,
    practicalNotes: draft.practicalNotes,
  };
}

function toAgentShowcaseResponse(showcase: typeof publicHolidayShowcases.$inferSelect) {
  return {
    id: showcase.id,
    publicSlug: showcase.publicSlug,
    title: showcase.title,
    destination: showcase.destination,
    travelPeriodLabel: showcase.travelPeriodLabel,
    durationNights: showcase.durationNights,
    priceAmount: showcase.priceAmount ? Number(showcase.priceAmount) : null,
    priceCurrency: showcase.priceCurrency,
    heroImageUrl: showcase.heroImageUrl,
    isPublished: showcase.isPublished,
    expiresAt: showcase.expiresAt,
    deletedAt: showcase.deletedAt,
    sortOrder: showcase.sortOrder,
    createdAt: showcase.createdAt,
    updatedAt: showcase.updatedAt,
  };
}

async function requireOwnedShowcase(showcaseId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [showcase] = await db.select().from(publicHolidayShowcases)
    .where(and(eq(publicHolidayShowcases.id, showcaseId), eq(publicHolidayShowcases.agentId, userId)))
    .limit(1);
  if (!showcase) throw new TRPCError({ code: "NOT_FOUND", message: "Holiday showcase not found." });
  return { db, showcase };
}

async function recordShowcaseEvent(params: {
  showcaseId: number;
  agentId: number;
  action: "received" | "hidden" | "unpublished" | "reordered" | "expiry_set" | "expired" | "deleted" | "edit_submitted" | "edit_approved" | "edit_rejected";
  actorUserId?: number | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(publicHolidayShowcaseEvents).values({
    showcaseId: params.showcaseId,
    agentId: params.agentId,
    action: params.action,
    actorUserId: params.actorUserId ?? null,
    note: params.note ?? null,
    metadata: params.metadata ?? null,
  });
}

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
      const [availableTag] = await db.select({ id: publicSpecialityTags.id }).from(publicSpecialityTags).where(eq(publicSpecialityTags.isActive, true)).limit(1);
      if (availableTag && !selectedTags.length) {
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

  showcases: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const items = await db.select().from(publicHolidayShowcases)
        .where(eq(publicHolidayShowcases.agentId, ctx.user.id))
        .orderBy(asc(publicHolidayShowcases.sortOrder), desc(publicHolidayShowcases.createdAt));
      return items.map(toAgentShowcaseResponse);
    }),

    editable: protectedProcedure.input(showcaseIdSchema).query(async ({ input, ctx }) => {
      const { db, showcase } = await requireOwnedShowcase(input.id, ctx.user.id);
      if (showcase.deletedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted showcases cannot be edited." });
      const detail = toPublicShowcaseDetail(showcase);
      const pending = await db.select().from(publicHolidayShowcaseEditRequests).where(and(
        eq(publicHolidayShowcaseEditRequests.showcaseId, showcase.id),
        eq(publicHolidayShowcaseEditRequests.agentId, ctx.user.id),
        eq(publicHolidayShowcaseEditRequests.status, "pending"),
      )).orderBy(desc(publicHolidayShowcaseEditRequests.updatedAt)).limit(1);
      const currentDraft = {
        title: showcase.title,
        summary: showcase.summary,
        destination: showcase.destination,
        travelPeriodLabel: showcase.travelPeriodLabel,
        durationNights: showcase.durationNights,
        priceAmount: showcase.priceAmount === null ? null : Number(showcase.priceAmount),
        heroImage: showcase.heroImageUrl ? { url: showcase.heroImageUrl, source: showcase.heroImageSource ?? "supplier" } : null,
        itineraryImages: detail.itineraryImages.map((image) => ({ ...image, source: "supplier" as const })),
        curatedSections: detail.curatedSections.map((section) => ({
          ...section,
          images: section.images.map((image) => ({ ...image, source: "supplier" as const })),
        })),
        editorialTags: detail.editorialTags,
        inclusions: detail.inclusions,
        practicalNotes: detail.practicalNotes,
      };
      return { showcase: toAgentShowcaseResponse(showcase), draft: currentDraft, pending: null };
    }),

    uploadEditorImage: protectedProcedure.input(showcaseIdSchema.extend({
      fileBase64: z.string().min(1),
      fileName: z.string().min(1).max(255),
      mimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
    })).mutation(async ({ input, ctx }) => {
      const { showcase } = await requireOwnedShowcase(input.id, ctx.user.id);
      if (showcase.deletedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted showcases cannot receive new images." });
      const decoded = Buffer.from(input.fileBase64, "base64");
      if (decoded.length > 6 * 1024 * 1024) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Holiday Showcase images must be 6 MB or smaller." });
      const extension = input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
      const { url } = await storagePut(`consumer-holiday-showcases/${ctx.user.id}/${showcase.id}/${nanoid(14)}.${extension}`, decoded, input.mimeType === "image/jpg" ? "image/jpeg" : input.mimeType);
      return { url, source: "agent_upload" as const };
    }),

    submitEdit: protectedProcedure.input(showcaseIdSchema.extend({
      draft: holidayShowcaseEditDraftSchema,
      agentNote: z.string().trim().max(500).optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      const { db, showcase } = await requireOwnedShowcase(input.id, ctx.user.id);
      if (showcase.deletedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted showcases cannot be edited." });
      const [existing] = await db.select({ id: publicHolidayShowcaseEditRequests.id, draft: publicHolidayShowcaseEditRequests.draft }).from(publicHolidayShowcaseEditRequests).where(and(
        eq(publicHolidayShowcaseEditRequests.showcaseId, showcase.id),
        eq(publicHolidayShowcaseEditRequests.agentId, ctx.user.id),
        eq(publicHolidayShowcaseEditRequests.status, "pending"),
      )).orderBy(desc(publicHolidayShowcaseEditRequests.updatedAt)).limit(1);
      const currentExternalUrls = new Set<string>([
        ...(showcase.heroImageUrl ? [showcase.heroImageUrl] : []),
        ...imageUrls(showcase.itineraryImages),
        ...(Array.isArray(showcase.curatedSections) ? showcase.curatedSections.flatMap((section) => section && typeof section === "object" ? imageUrls((section as Record<string, unknown>).images) : []) : []),
        ...showcaseSourceImageUrls(showcase.sourceSnapshot),
        ...showcaseDraftImageUrls(existing?.draft),
      ]);
      const uploadPrefix = `/manus-storage/consumer-holiday-showcases/${ctx.user.id}/${showcase.id}/`;
      const images = [input.draft.heroImage, ...input.draft.itineraryImages, ...(input.draft.curatedSections ?? []).flatMap((section) => section.images)].filter((image): image is NonNullable<typeof image> => Boolean(image));
      if (images.some((image) => !currentExternalUrls.has(image.url) && !(image.source === "agent_upload" && image.url.startsWith(uploadPrefix)))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Use an image already on this showcase or upload a new image through the Portal." });
      }
      if (existing) {
        await db.update(publicHolidayShowcaseEditRequests).set({
          status: "approved",
          reviewNote: "Superseded by the agent’s later immediate public Showcase edit.",
          reviewedAt: new Date(),
        }).where(eq(publicHolidayShowcaseEditRequests.id, existing.id));
      }
      await db.update(publicHolidayShowcases).set(showcaseEditValues(input.draft, showcase)).where(eq(publicHolidayShowcases.id, showcase.id));
      await recordShowcaseEvent({ showcaseId: showcase.id, agentId: showcase.agentId, action: "edit_approved", actorUserId: ctx.user.id, note: "Agent saved customer-safe Holiday Showcase edits directly to the public page." });
      return { success: true, published: true };
    }),

    setPublished: protectedProcedure.input(showcaseIdSchema.extend({ isPublished: z.boolean() })).mutation(async ({ input, ctx }) => {
      const { db, showcase } = await requireOwnedShowcase(input.id, ctx.user.id);
      if (showcase.deletedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted showcases cannot be republished. Please create a new showcase in Orbit." });
      await db.update(publicHolidayShowcases).set({
        isPublished: input.isPublished,
        unpublishedAt: input.isPublished ? null : new Date(),
        unpublishedById: input.isPublished ? null : ctx.user.id,
        unpublishedReason: input.isPublished ? null : "agent_unpublished",
      }).where(eq(publicHolidayShowcases.id, showcase.id));
      await recordShowcaseEvent({
        showcaseId: showcase.id,
        agentId: showcase.agentId,
        action: input.isPublished ? "hidden" : "unpublished",
        actorUserId: ctx.user.id,
        note: input.isPublished ? "Agent restored the Portal-owned holiday showcase." : "Agent unpublished the holiday showcase.",
      });
      return { success: true };
    }),

    setExpiry: protectedProcedure.input(showcaseIdSchema.extend({ expiresAt: z.coerce.date().optional().nullable() })).mutation(async ({ input, ctx }) => {
      const { db, showcase } = await requireOwnedShowcase(input.id, ctx.user.id);
      await db.update(publicHolidayShowcases).set({ expiresAt: input.expiresAt ?? null }).where(eq(publicHolidayShowcases.id, showcase.id));
      await recordShowcaseEvent({ showcaseId: showcase.id, agentId: showcase.agentId, action: "expiry_set", actorUserId: ctx.user.id, note: input.expiresAt ? `Expiry set for ${input.expiresAt.toISOString()}.` : "Expiry date cleared." });
      return { success: true };
    }),

    reorder: protectedProcedure.input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const owned = await db.select({ id: publicHolidayShowcases.id }).from(publicHolidayShowcases)
        .where(and(eq(publicHolidayShowcases.agentId, ctx.user.id), inArray(publicHolidayShowcases.id, input.ids)));
      if (owned.length !== input.ids.length) throw new TRPCError({ code: "FORBIDDEN", message: "You can only reorder your own holiday showcases." });
      await Promise.all(input.ids.map((id, index) => db.update(publicHolidayShowcases).set({ sortOrder: index }).where(eq(publicHolidayShowcases.id, id))));
      await Promise.all(input.ids.map((id) => recordShowcaseEvent({ showcaseId: id, agentId: ctx.user.id, action: "reordered", actorUserId: ctx.user.id, note: "Agent changed holiday showcase display order." })));
      return { success: true };
    }),

    remove: protectedProcedure.input(showcaseIdSchema).mutation(async ({ input, ctx }) => {
      const { db, showcase } = await requireOwnedShowcase(input.id, ctx.user.id);
      await db.update(publicHolidayShowcases).set({
        isPublished: false,
        deletedAt: new Date(),
        deletedById: ctx.user.id,
        unpublishedAt: new Date(),
        unpublishedById: ctx.user.id,
        unpublishedReason: "agent_deleted",
      }).where(eq(publicHolidayShowcases.id, showcase.id));
      await recordShowcaseEvent({ showcaseId: showcase.id, agentId: showcase.agentId, action: "deleted", actorUserId: ctx.user.id, note: "Agent removed the Portal-owned holiday showcase." });
      return { success: true };
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
      const [account] = await db.select({ role: users.role }).from(users).where(eq(users.id, input.userId)).limit(1);
      const [crmProfile] = await db.select({ agentStatus: agentCrmProfiles.agentStatus, inContract: agentCrmProfiles.inContract }).from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, input.userId)).limit(1);
      const isStaffAccount = account?.role === "admin" || account?.role === "super_admin";

      if (input.action === "publish") {
        if (!isStaffAccount && (crmProfile?.agentStatus !== "active" || crmProfile.inContract)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only agents listed as Active and not In Contract can have a public profile published." });
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

    listShowcaseEditRequests: adminProcedure.input(z.object({
      status: z.enum(["pending", "approved", "changes_requested", "rejected"]).default("pending"),
    }).optional()).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        request: publicHolidayShowcaseEditRequests,
        showcaseTitle: publicHolidayShowcases.title,
        destination: publicHolidayShowcases.destination,
        agentName: users.name,
      }).from(publicHolidayShowcaseEditRequests)
        .innerJoin(publicHolidayShowcases, eq(publicHolidayShowcaseEditRequests.showcaseId, publicHolidayShowcases.id))
        .innerJoin(users, eq(publicHolidayShowcaseEditRequests.agentId, users.id))
        .where(eq(publicHolidayShowcaseEditRequests.status, input?.status ?? "pending"))
        .orderBy(desc(publicHolidayShowcaseEditRequests.updatedAt));
    }),

    reviewShowcaseEdit: adminProcedure.input(z.object({
      id: z.number().int().positive(),
      action: z.enum(["approve", "request_changes", "reject"]),
      note: z.string().trim().max(500).optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [request] = await db.select().from(publicHolidayShowcaseEditRequests).where(eq(publicHolidayShowcaseEditRequests.id, input.id)).limit(1);
      if (!request || request.status !== "pending") throw new TRPCError({ code: "NOT_FOUND", message: "That Holiday Showcase edit is no longer awaiting review." });
      const [showcase] = await db.select().from(publicHolidayShowcases).where(and(
        eq(publicHolidayShowcases.id, request.showcaseId),
        eq(publicHolidayShowcases.agentId, request.agentId),
      )).limit(1);
      if (!showcase || showcase.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "The related Holiday Showcase is no longer available." });
      const reviewNote = normaliseOptional(input.note);
      if (input.action === "approve") {
        const parsed = holidayShowcaseEditDraftSchema.safeParse(request.draft);
        if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "The saved Holiday Showcase edit no longer meets the public-content rules." });
        const draft = parsed.data;
        await db.update(publicHolidayShowcases).set({
          title: draft.title,
          summary: draft.summary,
          destination: draft.destination,
          travelPeriodLabel: draft.travelPeriodLabel ?? null,
          durationNights: draft.durationNights ?? null,
          priceMode: draft.priceAmount === null ? null : "from",
          priceAmount: draft.priceAmount === null ? null : String(draft.priceAmount),
          priceCurrency: draft.priceAmount === null ? null : "GBP",
          pricePerPerson: draft.priceAmount === null ? true : true,
          heroImageUrl: draft.heroImage?.url ?? null,
          heroImageSource: draft.heroImage?.source ?? null,
          itineraryImages: draft.itineraryImages.map(({ url, source, label, category }) => ({ url, source, label, category })),
          curatedSections: draft.curatedSections ? draft.curatedSections.map(({ id, kind, title, summary, facts, images }) => ({
            id, kind, title, summary, facts,
            images: images.map(({ url, source, label, category }) => ({ url, source, label, category })),
          })) : showcase.curatedSections,
          editorialTags: draft.editorialTags,
          inclusions: draft.inclusions,
          practicalNotes: draft.practicalNotes,
        }).where(eq(publicHolidayShowcases.id, showcase.id));
        await db.update(publicHolidayShowcaseEditRequests).set({ status: "approved", reviewNote, reviewedById: ctx.user.id, reviewedAt: new Date() }).where(eq(publicHolidayShowcaseEditRequests.id, request.id));
        await recordShowcaseEvent({ showcaseId: showcase.id, agentId: showcase.agentId, action: "edit_approved", actorUserId: ctx.user.id, note: reviewNote ?? "JLT approved the agent's customer-facing Holiday Showcase edits." });
      } else {
        const status = input.action === "request_changes" ? "changes_requested" : "rejected";
        await db.update(publicHolidayShowcaseEditRequests).set({ status, reviewNote: reviewNote ?? (status === "changes_requested" ? "Please update the public showcase copy and resubmit." : "JLT did not approve this public showcase edit."), reviewedById: ctx.user.id, reviewedAt: new Date() }).where(eq(publicHolidayShowcaseEditRequests.id, request.id));
        await recordShowcaseEvent({ showcaseId: showcase.id, agentId: showcase.agentId, action: "edit_rejected", actorUserId: ctx.user.id, note: reviewNote ?? "JLT did not approve the agent's Holiday Showcase edits." });
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

    listPartners: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(publicPartnerProfiles).orderBy(asc(publicPartnerProfiles.sortOrder), asc(publicPartnerProfiles.name));
    }),

    savePartner: adminProcedure.input(partnerDraftSchema).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const values = {
        name: input.name.trim(),
        category: normaliseOptional(input.category),
        summary: normaliseOptional(input.summary),
        logoUrl: safeUrl(normaliseOptional(input.logoUrl)),
        websiteUrl: safeUrl(normaliseOptional(input.websiteUrl)),
        isPublished: input.isPublished,
        sortOrder: input.sortOrder,
      };
      if (input.id) {
        const [existing] = await db.select({ id: publicPartnerProfiles.id }).from(publicPartnerProfiles).where(eq(publicPartnerProfiles.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Partner profile not found." });
        await db.update(publicPartnerProfiles).set(values).where(eq(publicPartnerProfiles.id, input.id));
        return { id: input.id, created: false };
      }
      const slug = `${slugify(input.name)}-${nanoid(5).toLowerCase()}`;
      const [result] = await db.insert(publicPartnerProfiles).values({ ...values, slug });
      return { id: Number((result as any).insertId), created: true };
    }),

    uploadPartnerLogo: adminProcedure.input(z.object({
      fileBase64: z.string().min(1),
      fileName: z.string().min(1).max(255),
      mimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
    })).mutation(async ({ input }) => {
      const decoded = Buffer.from(input.fileBase64, "base64");
      if (decoded.length > 3 * 1024 * 1024) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Partner logos must be 3 MB or smaller." });
      const extension = input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
      const { url } = await storagePut(`consumer-partners/${nanoid(14)}.${extension}`, decoded, input.mimeType === "image/jpg" ? "image/jpeg" : input.mimeType);
      return { url };
    }),
  }),

  public: router({
    listPartners: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        name: publicPartnerProfiles.name,
        slug: publicPartnerProfiles.slug,
        category: publicPartnerProfiles.category,
        summary: publicPartnerProfiles.summary,
        logoUrl: publicPartnerProfiles.logoUrl,
        websiteUrl: publicPartnerProfiles.websiteUrl,
      }).from(publicPartnerProfiles).where(eq(publicPartnerProfiles.isPublished, true)).orderBy(asc(publicPartnerProfiles.sortOrder), asc(publicPartnerProfiles.name));
    }),

    listAgents: publicProcedure.input(z.object({
      tagIds: z.array(z.number().int().positive()).max(8).default([]),
      search: z.string().trim().max(120).optional(),
      town: z.string().trim().max(120).optional(),
    }).optional()).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const profiles = await db.select({ profile: publicAgentProfiles, agentStatus: agentCrmProfiles.agentStatus, inContract: agentCrmProfiles.inContract, accountRole: users.role })
        .from(publicAgentProfiles)
        .innerJoin(users, eq(publicAgentProfiles.userId, users.id))
        .leftJoin(agentCrmProfiles, eq(publicAgentProfiles.userId, agentCrmProfiles.userId))
        .where(eq(publicAgentProfiles.isPublished, true));
      const allTagRows = await db.select({ id: publicSpecialityTags.id, label: publicSpecialityTags.label, category: publicSpecialityTags.category, slug: publicSpecialityTags.slug }).from(publicSpecialityTags).where(eq(publicSpecialityTags.isActive, true));
      const tagMap = new Map(allTagRows.map((tag) => [tag.id, tag]));
      const query = input?.search?.trim().toLowerCase();
      const town = input?.town?.trim().toLowerCase();
      return profiles.flatMap(({ profile, agentStatus, inContract, accountRole }) => {
        const ids = Array.isArray(profile.publishedTagIds) ? profile.publishedTagIds.map(Number).filter(Number.isInteger) : [];
        if (!matchesPublicDirectoryTags(ids, input?.tagIds ?? [], allTagRows)) return [];
        const tags = ids.map((id) => tagMap.get(id)).filter((tag): tag is NonNullable<typeof tag> => !!tag);
        const payload = publicProfilePayload(profile, tags);
        if (!payload || !isPublicAgentProfileVisible({ isPublished: profile.isPublished, agentStatus, inContract, accountRole, hasPublishedSnapshot: true, hasPublicSlug: Boolean(profile.publicSlug) })) return [];
        const searchable = `${payload.displayName} ${payload.businessName ?? ""} ${payload.listingTown} ${tags.map((tag) => tag.label).join(" ")}`.toLowerCase();
        if (query && !searchable.includes(query)) return [];
        if (town && !payload.listingTown.toLowerCase().includes(town)) return [];
        return [payload];
      }).sort((a, b) => a.displayName.localeCompare(b.displayName));
    }),

    getAgent: publicProcedure.input(z.object({ slug: z.string().min(3).max(180) })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [result] = await db.select({ profile: publicAgentProfiles, agentStatus: agentCrmProfiles.agentStatus, inContract: agentCrmProfiles.inContract, accountRole: users.role })
        .from(publicAgentProfiles)
        .innerJoin(users, eq(publicAgentProfiles.userId, users.id))
        .leftJoin(agentCrmProfiles, eq(publicAgentProfiles.userId, agentCrmProfiles.userId))
        .where(and(eq(publicAgentProfiles.publicSlug, input.slug), eq(publicAgentProfiles.isPublished, true)))
        .limit(1);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "This travel-agent profile is not available." });
      if (!isPublicAgentProfileVisible({ isPublished: result.profile.isPublished, agentStatus: result.agentStatus, inContract: result.inContract, accountRole: result.accountRole, hasPublishedSnapshot: Boolean(readSnapshot(result.profile.publishedSnapshot)), hasPublicSlug: Boolean(result.profile.publicSlug) })) throw new TRPCError({ code: "NOT_FOUND", message: "This travel-agent profile is not available." });
      const ids = Array.isArray(result.profile.publishedTagIds) ? result.profile.publishedTagIds.map(Number).filter(Number.isInteger) : [];
      const tags = ids.length ? await db.select({ id: publicSpecialityTags.id, label: publicSpecialityTags.label, category: publicSpecialityTags.category }).from(publicSpecialityTags).where(inArray(publicSpecialityTags.id, ids)) : [];
      const payload = publicProfilePayload(result.profile, tags);
      if (!payload) throw new TRPCError({ code: "NOT_FOUND", message: "This travel-agent profile is not available." });
      return payload;
    }),

    listShowcasesForAgent: publicProcedure.input(z.object({ agentSlug: z.string().min(3).max(180) })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const [result] = await db.select({ profile: publicAgentProfiles, agentStatus: agentCrmProfiles.agentStatus, inContract: agentCrmProfiles.inContract, accountRole: users.role })
        .from(publicAgentProfiles).innerJoin(users, eq(publicAgentProfiles.userId, users.id))
        .leftJoin(agentCrmProfiles, eq(publicAgentProfiles.userId, agentCrmProfiles.userId))
        .where(and(eq(publicAgentProfiles.publicSlug, input.agentSlug), eq(publicAgentProfiles.isPublished, true))).limit(1);
      if (!result || !isPublicAgentProfileVisible({ isPublished: result.profile.isPublished, agentStatus: result.agentStatus, inContract: result.inContract, accountRole: result.accountRole, hasPublishedSnapshot: Boolean(readSnapshot(result.profile.publishedSnapshot)), hasPublicSlug: Boolean(result.profile.publicSlug) })) return [];
      const now = new Date();
      const rows = await db.select().from(publicHolidayShowcases).where(and(
        eq(publicHolidayShowcases.publicProfileId, result.profile.id),
        eq(publicHolidayShowcases.isPublished, true),
        isNull(publicHolidayShowcases.deletedAt),
        or(isNull(publicHolidayShowcases.expiresAt), gt(publicHolidayShowcases.expiresAt, now)),
      )).orderBy(asc(publicHolidayShowcases.sortOrder), desc(publicHolidayShowcases.createdAt));
      return rows.filter((row) => isPublicShowcaseVisible(row, now)).map(toPublicShowcaseCard);
    }),

    listShowcases: publicProcedure.input(z.object({
      search: z.string().trim().max(120).optional(),
      destination: z.string().trim().max(120).optional(),
      travelPeriod: z.string().trim().max(120).optional(),
      priceBand: z.enum(["under_1000", "1000_1999", "2000_2999", "3000_plus", "price_on_request"]).optional(),
      durationBand: z.enum(["short_break", "week", "longer", "flexible"]).optional(),
    }).optional()).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const now = new Date();
      const rows = await db.select({ showcase: publicHolidayShowcases, profile: publicAgentProfiles, agentStatus: agentCrmProfiles.agentStatus, inContract: agentCrmProfiles.inContract, accountRole: users.role })
        .from(publicHolidayShowcases)
        .innerJoin(publicAgentProfiles, eq(publicHolidayShowcases.publicProfileId, publicAgentProfiles.id))
        .innerJoin(users, eq(publicAgentProfiles.userId, users.id))
        .leftJoin(agentCrmProfiles, eq(publicAgentProfiles.userId, agentCrmProfiles.userId))
        .where(and(
          eq(publicHolidayShowcases.isPublished, true),
          eq(publicAgentProfiles.isPublished, true),
          isNull(publicHolidayShowcases.deletedAt),
          or(isNull(publicHolidayShowcases.expiresAt), gt(publicHolidayShowcases.expiresAt, now)),
        ))
        .orderBy(asc(publicHolidayShowcases.sortOrder), desc(publicHolidayShowcases.createdAt));
      const search = input?.search?.toLowerCase();
      const destination = input?.destination?.toLowerCase();
      const travelPeriod = input?.travelPeriod?.toLowerCase();
      return rows.flatMap(({ showcase, profile, agentStatus, inContract, accountRole }) => {
        if (!isPublicShowcaseVisible(showcase, now)) return [];
        if (!isPublicAgentProfileVisible({ isPublished: profile.isPublished, agentStatus, inContract, accountRole, hasPublishedSnapshot: Boolean(readSnapshot(profile.publishedSnapshot)), hasPublicSlug: Boolean(profile.publicSlug) })) return [];
        const agent = publicProfilePayload(profile, []);
        if (!agent) return [];
        const card = toPublicShowcaseCard(showcase);
        const searchable = `${card.title} ${card.summary} ${card.destination} ${card.editorialTags.join(" ")} ${agent.displayName}`.toLowerCase();
        if (search && !searchable.includes(search)) return [];
        if (destination && !card.destination.toLowerCase().includes(destination)) return [];
        if (travelPeriod && !(card.travelPeriodLabel ?? "").toLowerCase().includes(travelPeriod)) return [];
        if (input?.priceBand === "price_on_request" && card.price) return [];
        if (input?.priceBand === "under_1000" && (!card.price || card.price.amount >= 1_000)) return [];
        if (input?.priceBand === "1000_1999" && (!card.price || card.price.amount < 1_000 || card.price.amount >= 2_000)) return [];
        if (input?.priceBand === "2000_2999" && (!card.price || card.price.amount < 2_000 || card.price.amount >= 3_000)) return [];
        if (input?.priceBand === "3000_plus" && (!card.price || card.price.amount < 3_000)) return [];
        if (input?.durationBand === "flexible" && card.durationNights !== null) return [];
        if (input?.durationBand === "short_break" && (card.durationNights === null || card.durationNights > 4)) return [];
        if (input?.durationBand === "week" && (card.durationNights === null || card.durationNights < 5 || card.durationNights > 9)) return [];
        if (input?.durationBand === "longer" && (card.durationNights === null || card.durationNights < 10)) return [];
        return [{ ...card, agent: { slug: agent.slug, displayName: agent.displayName } }];
      });
    }),

    getShowcase: publicProcedure.input(z.object({ agentSlug: z.string().min(3).max(180), showcaseSlug: z.string().min(3).max(220) })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [result] = await db.select({ profile: publicAgentProfiles, agentStatus: agentCrmProfiles.agentStatus, inContract: agentCrmProfiles.inContract, accountRole: users.role })
        .from(publicAgentProfiles).innerJoin(users, eq(publicAgentProfiles.userId, users.id))
        .leftJoin(agentCrmProfiles, eq(publicAgentProfiles.userId, agentCrmProfiles.userId))
        .where(and(eq(publicAgentProfiles.publicSlug, input.agentSlug), eq(publicAgentProfiles.isPublished, true))).limit(1);
      if (!result || !isPublicAgentProfileVisible({ isPublished: result.profile.isPublished, agentStatus: result.agentStatus, inContract: result.inContract, accountRole: result.accountRole, hasPublishedSnapshot: Boolean(readSnapshot(result.profile.publishedSnapshot)), hasPublicSlug: Boolean(result.profile.publicSlug) })) throw new TRPCError({ code: "NOT_FOUND", message: "This holiday showcase is not available." });
      const [showcase] = await db.select().from(publicHolidayShowcases).where(and(
        eq(publicHolidayShowcases.publicProfileId, result.profile.id),
        eq(publicHolidayShowcases.publicSlug, input.showcaseSlug),
      )).limit(1);
      if (!showcase || !isPublicShowcaseVisible(showcase)) throw new TRPCError({ code: "NOT_FOUND", message: "This holiday showcase is not available." });
      const tags = await getProfileTagRows(result.profile.id);
      const agent = publicProfilePayload(result.profile, tags);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "This holiday showcase is not available." });
      return { agent, showcase: toPublicShowcaseDetail(showcase) };
    }),

    submitEnquiry: publicProcedure.input(z.object({
      slug: z.string().min(3).max(180),
      customerName: z.string().trim().min(2).max(255),
      customerEmail: z.string().trim().email().max(320),
      customerPhone: z.string().trim().max(40).optional().nullable(),
      travelBrief: z.string().trim().min(20).max(4_000),
      showcaseSlug: z.string().trim().min(3).max(220).optional(),
      consentConfirmed: z.literal(true),
    })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [result] = await db.select({ profile: publicAgentProfiles, agentStatus: agentCrmProfiles.agentStatus, inContract: agentCrmProfiles.inContract, accountRole: users.role })
        .from(publicAgentProfiles)
        .innerJoin(users, eq(publicAgentProfiles.userId, users.id))
        .leftJoin(agentCrmProfiles, eq(publicAgentProfiles.userId, agentCrmProfiles.userId))
        .where(and(eq(publicAgentProfiles.publicSlug, input.slug), eq(publicAgentProfiles.isPublished, true)))
        .limit(1);
      if (!result || !result.profile.publishedEnquiryDeliveryEmail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This travel-agent profile is not available." });
      }
      const profileVisible = isPublicAgentProfileVisible({ isPublished: result.profile.isPublished, agentStatus: result.agentStatus, inContract: result.inContract, accountRole: result.accountRole, hasPublishedSnapshot: Boolean(readSnapshot(result.profile.publishedSnapshot)), hasPublicSlug: Boolean(result.profile.publicSlug) });
      if (publicEnquiryAdmission({ profileVisible, recentSubmissionCount: 0 }) === "profile_unavailable") {
        throw new TRPCError({ code: "NOT_FOUND", message: "This travel-agent profile is not available." });
      }
      let showcase: typeof publicHolidayShowcases.$inferSelect | null = null;
      if (input.showcaseSlug) {
        const [found] = await db.select().from(publicHolidayShowcases).where(and(
          eq(publicHolidayShowcases.publicProfileId, result.profile.id),
          eq(publicHolidayShowcases.publicSlug, input.showcaseSlug),
        )).limit(1);
        if (!found || !isPublicShowcaseVisible(found)) throw new TRPCError({ code: "NOT_FOUND", message: "This holiday showcase is not available." });
        showcase = found;
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
        showcaseId: showcase?.id ?? null,
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
      const safeShowcaseTitle = showcase ? escapeHtml(showcase.title) : null;

      const delivery = await sendDirectEmail({
        toEmail: result.profile.publishedEnquiryDeliveryEmail,
        toName: agentName,
        userId: result.profile.userId,
        triggerKey: "consumer_agent_enquiry",
        subject: `${safeShowcaseTitle ? `Holiday showcase enquiry: ${showcase!.title}` : "New website enquiry"} from ${input.customerName.trim()}`,
        html: `<p>Hello ${escapeHtml(agentName)},</p><p>You have received a new enquiry through your JLT public profile.${safeShowcaseTitle ? ` The customer is responding to your holiday showcase: <strong>${safeShowcaseTitle}</strong>.` : ""}</p><p><strong>Name:</strong> ${safeName}<br /><strong>Email:</strong> ${safeEmail}<br /><strong>Phone:</strong> ${safePhone}</p><p><strong>Travel plans:</strong><br />${safeBrief}</p><p>Please reply directly to the customer using the details above.</p>`,
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
