export type PublicAgentVisibilityInput = {
  isPublished: boolean;
  agentStatus: string | null | undefined;
  inContract: boolean | null | undefined;
  accountRole?: string | null | undefined;
  hasPublishedSnapshot: boolean;
  hasPublicSlug: boolean;
};

/** Staff accounts may be expressly approved; standard agent accounts must remain Active and not In Contract. */
export function isPublicAgentProfileVisible(input: PublicAgentVisibilityInput): boolean {
  const isStaffAccount = input.accountRole === "admin" || input.accountRole === "super_admin";
  return Boolean(
    input.isPublished
      && (isStaffAccount || (input.agentStatus === "active" && !input.inContract))
      && input.hasPublishedSnapshot
      && input.hasPublicSlug
  );
}

/** Public links must be secure and, where requested, match an approved platform. */
export function isApprovedPublicUrl(value: string | null | undefined, allowedHosts?: string[]): boolean {
  if (!value?.trim()) return true;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return false;
    if (!allowedHosts?.length) return true;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return allowedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export type PublicDirectoryTag = {
  id: number;
  category: "destination" | "travel_type";
  slug: string;
};

/**
 * A Worldwide destination tag is broad coverage: it matches any selected specific destination,
 * but remains an explicit option when a customer selects Worldwide itself. Travel-type filters
 * always retain exact matching.
 */
export function matchesPublicDirectoryTags(profileTagIds: number[], selectedTagIds: number[], tags: PublicDirectoryTag[]): boolean {
  if (!selectedTagIds.length) return true;
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const worldwideTagId = tags.find((tag) => tag.category === "destination" && tag.slug === "worldwide")?.id;

  return selectedTagIds.every((selectedTagId) => {
    const selectedTag = tagsById.get(selectedTagId);
    if (!selectedTag) return false;
    if (selectedTag.category === "destination" && selectedTag.slug !== "worldwide") {
      return profileTagIds.includes(selectedTagId) || (worldwideTagId !== undefined && profileTagIds.includes(worldwideTagId));
    }
    return profileTagIds.includes(selectedTagId);
  });
}

export type PublicProfileSource = {
  publicSlug: string | null | undefined;
  displayName: string | null | undefined;
  businessName: string | null | undefined;
  biography: string | null | undefined;
  profilePhotoUrl: string | null | undefined;
  listingTown: string | null | undefined;
  townLatitude: string | number | null | undefined;
  townLongitude: string | number | null | undefined;
  websiteUrl: string | null | undefined;
  instagramUrl: string | null | undefined;
  tiktokUrl: string | null | undefined;
  facebookUrl: string | null | undefined;
  linkedinUrl: string | null | undefined;
  youtubeUrl: string | null | undefined;
  pinterestUrl: string | null | undefined;
};

/** Deliberate allow-list: never spread a CRM/profile database row into a public response. */
export function toPublicAgentResponse<TTag>(source: PublicProfileSource, tags: TTag[]) {
  return {
    slug: source.publicSlug ?? "",
    displayName: source.displayName ?? "JLT Travel Agent",
    businessName: source.businessName ?? null,
    biography: source.biography ?? "",
    profilePhotoUrl: source.profilePhotoUrl ?? null,
    listingTown: source.listingTown ?? "",
    townLatitude: source.townLatitude === null || source.townLatitude === undefined ? null : Number(source.townLatitude),
    townLongitude: source.townLongitude === null || source.townLongitude === undefined ? null : Number(source.townLongitude),
    websiteUrl: source.websiteUrl ?? null,
    instagramUrl: source.instagramUrl ?? null,
    tiktokUrl: source.tiktokUrl ?? null,
    facebookUrl: source.facebookUrl ?? null,
    linkedinUrl: source.linkedinUrl ?? null,
    youtubeUrl: source.youtubeUrl ?? null,
    pinterestUrl: source.pinterestUrl ?? null,
    tags,
  };
}

export function publicEnquiryAdmission(params: { profileVisible: boolean; recentSubmissionCount: number }): "accepted" | "profile_unavailable" | "rate_limited" {
  if (!params.profileVisible) return "profile_unavailable";
  return params.recentSubmissionCount >= 3 ? "rate_limited" : "accepted";
}
