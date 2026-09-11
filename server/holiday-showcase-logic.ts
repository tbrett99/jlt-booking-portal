import { z } from "zod";

export const HOLIDAY_SHOWCASE_FALLBACK_IMAGE = "/manus-storage/jlt-editorial-reference-hero_30c23fe4.jpg";

const publicText = (min: number, max: number) => z.string().trim().min(min).max(max);
const isPermittedPublicImageUrl = (value: string) => {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:" && !host.endsWith("google.com") && !host.endsWith("googleusercontent.com") && !host.endsWith("gstatic.com");
};

const publicImageSchema = z.object({
  url: z.string().url().max(2_000).refine(isPermittedPublicImageUrl, "Images must use https:// and cannot use Google-hosted sources."),
  source: z.enum(["supplier", "agent_upload"]),
}).strict();

const itineraryItemSchema = z.object({
  day: z.number().int().min(1).max(60).optional(),
  title: publicText(2, 180),
  description: publicText(2, 2_000).optional(),
  highlights: z.array(publicText(2, 240)).max(10).default([]),
  image: publicImageSchema.optional(),
}).strict();

const accommodationOptionSchema = z.object({
  name: publicText(2, 255),
  location: publicText(2, 255).optional(),
  room: publicText(2, 255).optional(),
  board: publicText(2, 180).optional(),
  description: publicText(2, 1_500).optional(),
  image: publicImageSchema.optional(),
}).strict();

export const orbitHolidayShowcaseSchema = z.object({
  // Standard agents use their CRM JLT identifier. Approved staff public profiles
  // may instead use their numeric Portal account ID when no CRM profile exists.
  agentId: z.union([
    z.string().trim().regex(/^JLT-[A-Za-z0-9-]+$/, "agentId must use the JLT- identifier format").max(80),
    z.number().int().positive(),
  ]),
  externalPublicationId: z.string().uuid(),
  title: publicText(4, 255),
  summary: publicText(20, 2_000),
  destination: publicText(2, 255),
  travelPeriodLabel: publicText(2, 140).optional(),
  durationNights: z.number().int().min(1).max(60).optional(),
  price: z.object({
    mode: z.literal("from"),
    amount: z.number().positive().max(1_000_000),
    currency: z.literal("GBP"),
    perPerson: z.literal(true),
  }).strict().optional(),
  heroImage: publicImageSchema.optional(),
  itinerary: z.array(itineraryItemSchema).min(1).max(60),
  accommodationOptions: z.array(accommodationOptionSchema).max(20).default([]),
  inclusions: z.array(publicText(2, 300)).max(40).default([]),
  practicalNotes: z.array(publicText(2, 500)).max(40).default([]),
  enquiryContext: z.object({ showcaseId: z.string().uuid() }).strict().optional(),
}).strict();

export type OrbitHolidayShowcasePayload = z.infer<typeof orbitHolidayShowcaseSchema>;

export function slugifyShowcase(value: string): string {
  const slug = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 190);
  return slug || "holiday-inspiration";
}

export function isPublicShowcaseVisible(showcase: {
  isPublished: boolean;
  expiresAt?: Date | string | null;
  deletedAt?: Date | string | null;
}, now = new Date()): boolean {
  if (!showcase.isPublished || showcase.deletedAt) return false;
  if (!showcase.expiresAt) return true;
  return new Date(showcase.expiresAt).getTime() > now.getTime();
}

export function toPublicShowcaseCard(showcase: {
  publicSlug: string;
  title: string;
  summary: string;
  destination: string;
  travelPeriodLabel?: string | null;
  durationNights?: number | null;
  priceAmount?: string | number | null;
  priceCurrency?: string | null;
  pricePerPerson?: boolean | null;
  heroImageUrl?: string | null;
}) {
  return {
    slug: showcase.publicSlug,
    title: showcase.title,
    summary: showcase.summary,
    destination: showcase.destination,
    travelPeriodLabel: showcase.travelPeriodLabel ?? null,
    durationNights: showcase.durationNights ?? null,
    price: showcase.priceAmount === null || showcase.priceAmount === undefined ? null : {
      mode: "from" as const,
      amount: Number(showcase.priceAmount),
      currency: showcase.priceCurrency ?? "GBP",
      perPerson: showcase.pricePerPerson ?? true,
    },
    heroImageUrl: showcase.heroImageUrl ?? HOLIDAY_SHOWCASE_FALLBACK_IMAGE,
  };
}

export function toPublicShowcaseDetail(showcase: {
  publicSlug: string;
  title: string;
  summary: string;
  destination: string;
  travelPeriodLabel?: string | null;
  durationNights?: number | null;
  priceAmount?: string | number | null;
  priceCurrency?: string | null;
  pricePerPerson?: boolean | null;
  heroImageUrl?: string | null;
  itinerary: unknown;
  accommodationOptions: unknown;
  inclusions: unknown;
  practicalNotes: unknown;
}) {
  return {
    ...toPublicShowcaseCard(showcase),
    itinerary: Array.isArray(showcase.itinerary) ? showcase.itinerary : [],
    accommodationOptions: Array.isArray(showcase.accommodationOptions) ? showcase.accommodationOptions : [],
    inclusions: Array.isArray(showcase.inclusions) ? showcase.inclusions : [],
    practicalNotes: Array.isArray(showcase.practicalNotes) ? showcase.practicalNotes : [],
  };
}
