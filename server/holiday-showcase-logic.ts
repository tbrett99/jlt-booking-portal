import { z } from "zod";

export const HOLIDAY_SHOWCASE_FALLBACK_IMAGE = "/manus-storage/jlt-editorial-reference-hero_30c23fe4.jpg";

const publicText = (min: number, max: number) => z.string().trim().min(min).max(max);
const isPermittedPublicImageUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && !host.endsWith("google.com") && !host.endsWith("googleusercontent.com") && !host.endsWith("gstatic.com");
  } catch {
    return false;
  }
};

const publicImageSchema = z.object({
  url: z.string().url().max(2_000).refine(isPermittedPublicImageUrl, "Images must use https:// and cannot use Google-hosted sources."),
  source: z.enum(["supplier", "agent_upload"]),
}).strict();

const itineraryGalleryImageSchema = publicImageSchema.extend({
  label: publicText(2, 255),
  category: z.enum(["hotel", "cruise", "experience"]),
}).strict();

const curatedSectionSchema = z.object({
  // Publication-local opaque UUIDs only; Orbit product identifiers are never accepted.
  id: z.string().uuid(),
  kind: z.enum(["flight", "stay", "transfer", "cruise", "experience", "note"]),
  title: publicText(2, 180),
  summary: publicText(2, 600),
  facts: z.array(publicText(2, 240)).max(5).default([]),
  images: z.array(itineraryGalleryImageSchema).max(6).default([]),
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
  itineraryImages: z.array(itineraryGalleryImageSchema).max(24).default([]),
  // Optional v2 public story. Consumer rendering preserves this exact order.
  curatedSections: z.array(curatedSectionSchema).min(1).max(60).optional(),
  // Legacy content is required only when no curated public story is provided.
  itinerary: z.array(itineraryItemSchema).max(60).default([]),
  accommodationOptions: z.array(accommodationOptionSchema).max(20).default([]),
  inclusions: z.array(publicText(2, 300)).max(40).default([]),
  practicalNotes: z.array(publicText(2, 500)).max(40).default([]),
  enquiryContext: z.object({ showcaseId: z.string().uuid() }).strict().optional(),
}).strict().superRefine((payload, ctx) => {
  if (!payload.curatedSections?.length && payload.itinerary.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 1,
      inclusive: true,
      origin: "array",
      path: ["itinerary"],
      message: "Provide at least one itinerary item when curatedSections is omitted.",
    });
  }
});

export type OrbitHolidayShowcasePayload = z.infer<typeof orbitHolidayShowcaseSchema>;

export function toSafePublicValidationIssues(issues: z.ZodIssue[]) {
  return issues.slice(0, 20).map((issue) => {
    const path = issue.path.length > 0
      ? issue.path.map((segment) => typeof segment === "number" ? `[${segment}]` : segment).join(".").replace(/\.\[/g, "[")
      : "payload";
    const message = issue.code === "unrecognized_keys"
      ? "Unexpected field; remove fields not defined by the public showcase contract."
      : issue.code === "invalid_type"
        ? "Expected the documented public field type."
        : issue.code === "invalid_value"
          ? "Value is not one of the allowed public contract options."
          : issue.code === "too_big"
            ? "Value exceeds the public contract limit."
            : issue.code === "too_small"
              ? "Required public field is missing or below the minimum length."
              : "Public field does not meet the showcase contract.";
    return { path, code: issue.code, message };
  });
}

type PublicItineraryGalleryImage = {
  url: string;
  label: string;
  category: "hotel" | "cruise" | "experience";
};

type PublicCuratedSection = {
  id: string;
  kind: "flight" | "stay" | "transfer" | "cruise" | "experience" | "note";
  title: string;
  summary: string;
  facts: string[];
  images: PublicItineraryGalleryImage[];
};

function toPublicItineraryGalleryImages(value: unknown): PublicItineraryGalleryImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((image): PublicItineraryGalleryImage[] => {
    if (!image || typeof image !== "object") return [];
    const candidate = image as Record<string, unknown>;
    const category = candidate.category;
    if (typeof candidate.url !== "string" || !isPermittedPublicImageUrl(candidate.url) || typeof candidate.label !== "string" || !["hotel", "cruise", "experience"].includes(String(category))) return [];
    return [{ url: candidate.url, label: candidate.label, category: category as PublicItineraryGalleryImage["category"] }];
  });
}

function toPublicCuratedSections(value: unknown): PublicCuratedSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((section): PublicCuratedSection[] => {
    if (!section || typeof section !== "object") return [];
    const candidate = section as Record<string, unknown>;
    const rawImages = Array.isArray(candidate.images) ? candidate.images : [];
    const parsed = curatedSectionSchema.safeParse({
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      facts: candidate.facts,
      images: rawImages.map((image) => {
        const raw = image && typeof image === "object" ? image as Record<string, unknown> : {};
        return { url: raw.url, source: raw.source, label: raw.label, category: raw.category };
      }),
    });
    if (!parsed.success) return [];
    return [{
      id: parsed.data.id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      summary: parsed.data.summary,
      facts: parsed.data.facts,
      images: parsed.data.images.map(({ url, label, category }) => ({ url, label, category })),
    }];
  });
}

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
  itineraryImages?: unknown;
  curatedSections?: unknown;
  itinerary: unknown;
  accommodationOptions: unknown;
  inclusions: unknown;
  practicalNotes: unknown;
}) {
  return {
    ...toPublicShowcaseCard(showcase),
    itineraryImages: toPublicItineraryGalleryImages(showcase.itineraryImages),
    curatedSections: toPublicCuratedSections(showcase.curatedSections),
    itinerary: Array.isArray(showcase.itinerary) ? showcase.itinerary : [],
    accommodationOptions: Array.isArray(showcase.accommodationOptions) ? showcase.accommodationOptions : [],
    inclusions: Array.isArray(showcase.inclusions) ? showcase.inclusions : [],
    practicalNotes: Array.isArray(showcase.practicalNotes) ? showcase.practicalNotes : [],
  };
}
