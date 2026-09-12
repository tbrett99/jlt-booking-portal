import { beforeEach, describe, expect, it, vi } from "vitest";

const selectResults: unknown[][] = [];
const selectChain = () => {
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: vi.fn(async () => selectResults.shift() ?? []),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve, reject),
  };
  return chain;
};
const insertValues = vi.fn(async () => [{ insertId: 9001 }]);
const updateWhere = vi.fn(async () => undefined);
const updateSet = vi.fn(() => ({ where: updateWhere }));
const db = {
  select: vi.fn(() => selectChain()),
  insert: vi.fn(() => ({ values: insertValues })),
  update: vi.fn(() => ({ set: updateSet })),
  delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
};

vi.mock("./db", () => ({ getDb: vi.fn(async () => db) }));
vi.mock("./email", () => ({ sendDirectEmail: vi.fn(async () => ({ success: true })) }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));

import { consumerSiteRouter } from "./consumer-site-router";
import { sendDirectEmail } from "./email";

const visibleProfile = {
  id: 77,
  userId: 19,
  isPublished: true,
  publicSlug: "alex-travel-19",
  publishedSnapshot: {
    displayName: "Alex Travel",
    businessName: "Alex Travel Co",
    biography: "I create thoughtful tailor-made holidays for families and special celebrations.",
    profilePhotoUrl: null,
    listingTown: "Chester",
    townLatitude: "53.1900",
    townLongitude: "-2.8900",
    websiteUrl: "https://alex.example.co.uk",
    instagramUrl: "https://instagram.com/alextravel",
    tiktokUrl: null,
    facebookUrl: null,
    linkedinUrl: null,
    youtubeUrl: null,
    pinterestUrl: null,
  },
  publishedTagIds: [1],
  publishedEnquiryDeliveryEmail: "private.agent@example.co.uk",
};

function publicCaller() {
  return consumerSiteRouter.createCaller({ req: { ip: "198.51.100.9" }, res: {} } as any);
}

function agentCaller() {
  return consumerSiteRouter.createCaller({
    user: { id: 19, role: "agent", name: "Alex Travel", email: "alex@example.test" },
    req: { ip: "198.51.100.9" },
    res: {},
  } as any);
}

function adminCaller(role: "admin" | "super_admin" = "super_admin") {
  return consumerSiteRouter.createCaller({
    user: { id: 1, role, name: "Max Kelly", email: "max@thejltgroup.co.uk" },
    req: { ip: "198.51.100.9" },
    res: {},
  } as any);
}

const completedDraft = {
  displayName: "Alex Travel",
  businessName: "Alex Travel Co",
  biography: "I create thoughtful tailor-made holidays for families and special celebrations around the world.",
  listingTown: "Chester",
  enquiryDeliveryEmail: "alex@example.test",
  websiteUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
  facebookUrl: null,
  linkedinUrl: null,
  youtubeUrl: null,
  pinterestUrl: null,
  townLatitude: null,
  townLongitude: null,
  specialityTagIds: [],
  consentConfirmed: true as const,
};

describe("consumerSite public API", () => {
  beforeEach(() => {
    selectResults.splice(0, selectResults.length);
    vi.clearAllMocks();
  });

  it("returns only explicitly approved public fields from the public list endpoint", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active", inContract: false, accountRole: "agent" }],
      [{ id: 1, label: "Caribbean", category: "destination", slug: "caribbean" }],
    );
    const response = await publicCaller().public.listAgents({ tagIds: [] });
    expect(response).toHaveLength(1);
    expect(response[0]).toMatchObject({ slug: "alex-travel-19", displayName: "Alex Travel", listingTown: "Chester" });
    for (const privateField of [
      "enquiryDeliveryEmail", "publishedEnquiryDeliveryEmail", "uniqueAgentId", "jltEmail", "personalEmail", "businessEmail", "mobile",
      "addressLine1", "addressLine2", "city", "postcode", "ukRegion", "bankSortCode", "bankAccountNumber", "bankAccountName",
      "membershipTier", "monthlySub", "retailerCode", "supplierPassword", "paymentExempt", "paymentExemptReason", "preferredPaymentDay",
      "emergencyContactName", "emergencyContactPhone", "idDocUrl", "idDocKey", "proofOfAddressUrl", "proofOfAddressKey", "documentUrl",
      "internalNotes", "adminNotes", "cancelChecklist", "noticeEndsAt", "cancelledAt", "suspendedAt", "suspensionReason", "inContract",
    ]) expect(response[0]).not.toHaveProperty(privateField);
  });

  it("returns the same strict allow-list from the public agent-detail endpoint", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active", inContract: false, accountRole: "agent" }],
      [{ id: 1, label: "Caribbean", category: "destination" }],
    );
    const response = await publicCaller().public.getAgent({ slug: "alex-travel-19" });
    for (const privateField of [
      "enquiryDeliveryEmail", "publishedEnquiryDeliveryEmail", "uniqueAgentId", "jltEmail", "personalEmail", "businessEmail", "mobile",
      "addressLine1", "addressLine2", "city", "postcode", "ukRegion", "bankSortCode", "bankAccountNumber", "bankAccountName",
      "membershipTier", "monthlySub", "retailerCode", "supplierPassword", "paymentExempt", "paymentExemptReason", "preferredPaymentDay",
      "emergencyContactName", "emergencyContactPhone", "idDocUrl", "idDocKey", "proofOfAddressUrl", "proofOfAddressKey", "documentUrl",
      "internalNotes", "adminNotes", "cancelChecklist", "noticeEndsAt", "cancelledAt", "suspendedAt", "suspensionReason", "inContract", "reviewNote",
    ]) {
      expect(response).not.toHaveProperty(privateField);
    }
    expect(response).toMatchObject({ slug: "alex-travel-19", listingTown: "Chester", tags: [{ label: "Caribbean" }] });
  });

  it("returns only sanitised public itinerary-gallery fields from the Holiday Showcase detail endpoint", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active", inContract: false, accountRole: "agent" }],
      [{
        id: 501,
        publicProfileId: 77,
        publicSlug: "miami-escape",
        externalPublicationId: "internal-orbit-publication-id",
        title: "Miami Escape",
        summary: "A considered city and beach escape with room to make every day your own.",
        destination: "Miami",
        travelPeriodLabel: null,
        durationNights: 5,
        priceAmount: "1895.00",
        priceCurrency: "GBP",
        pricePerPerson: true,
        heroImageUrl: "https://supplier.example/hero.jpg",
        itineraryImages: [{ url: "https://supplier.example/elser.jpg", source: "supplier", label: "The Elser Hotel Miami", category: "hotel", orbitProductId: "private-product-id" }],
        itinerary: [], accommodationOptions: [], inclusions: [], practicalNotes: [],
        sourceSnapshot: { quoteReference: "private-quote-reference" },
        isPublished: true, deletedAt: null, expiresAt: null,
      }],
      [],
    );
    const response = await publicCaller().public.getShowcase({ agentSlug: "alex-travel-19", showcaseSlug: "miami-escape" });
    expect(response.showcase.itineraryImages).toEqual([{ url: "https://supplier.example/elser.jpg", label: "The Elser Hotel Miami", category: "hotel" }]);
    const publicPayload = JSON.stringify(response);
    expect(publicPayload).not.toContain("private-product-id");
    expect(publicPayload).not.toContain("private-quote-reference");
    expect(publicPayload).not.toContain("externalPublicationId");
  });

  it("rejects a public enquiry when the target profile is unavailable", async () => {
    selectResults.push([]);
    await expect(publicCaller().public.submitEnquiry({
      slug: "missing-agent",
      customerName: "Sam Customer",
      customerEmail: "sam@example.com",
      customerPhone: null,
      travelBrief: "I would like help arranging a special family holiday next summer.",
      consentConfirmed: true,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sendDirectEmail).not.toHaveBeenCalled();
  });

  it("records a successful direct-to-agent enquiry and sends a separate customer acknowledgement", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active", inContract: false, accountRole: "agent" }],
      [],
    );
    await expect(publicCaller().public.submitEnquiry({
      slug: "alex-travel-19",
      customerName: "Sam Customer",
      customerEmail: "sam@example.com",
      customerPhone: "07123456789",
      travelBrief: "I would like help arranging a special family holiday next summer.",
      consentConfirmed: true,
    })).resolves.toEqual({ success: true });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 19,
      profileId: 77,
      customerEmail: "sam@example.com",
      customerName: "Sam Customer",
      consentConfirmedAt: expect.any(Date),
    }));
    expect(sendDirectEmail).toHaveBeenCalledTimes(2);
    expect(sendDirectEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({ toEmail: "private.agent@example.co.uk" }));
    expect(sendDirectEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({ toEmail: "sam@example.com", subject: expect.stringContaining("passed your travel enquiry") }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: "sent", deliveredAt: expect.any(Date) }));
  });

  it("records a failed agent delivery while keeping the customer acknowledgement path independent", async () => {
    vi.mocked(sendDirectEmail).mockResolvedValueOnce({ success: false, error: "Recipient rejected" } as any).mockResolvedValueOnce({ success: true } as any);
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active", inContract: false, accountRole: "agent" }],
      [],
    );
    await expect(publicCaller().public.submitEnquiry({
      slug: "alex-travel-19", customerName: "Sam Customer", customerEmail: "sam@example.com", customerPhone: null,
      travelBrief: "I would like help arranging a special family holiday next summer.", consentConfirmed: true,
    })).resolves.toEqual({ success: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: "failed", deliveryError: "Recipient rejected" }));
    expect(sendDirectEmail).toHaveBeenCalledTimes(2);
  });

  it("does not turn a successfully recorded enquiry into an error when customer acknowledgement delivery fails", async () => {
    vi.mocked(sendDirectEmail).mockResolvedValueOnce({ success: true } as any).mockRejectedValueOnce(new Error("Acknowledgement unavailable"));
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active", inContract: false, accountRole: "agent" }],
      [],
    );
    await expect(publicCaller().public.submitEnquiry({
      slug: "alex-travel-19", customerName: "Sam Customer", customerEmail: "sam@example.com", customerPhone: null,
      travelBrief: "I would like help arranging a special family holiday next summer.", consentConfirmed: true,
    })).resolves.toEqual({ success: true });
  });

  it("rate-limits a fourth public enquiry from the same IP window before sending email", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active", inContract: false, accountRole: "agent" }],
      [{ id: 1 }, { id: 2 }, { id: 3 }],
    );
    await expect(publicCaller().public.submitEnquiry({
      slug: "alex-travel-19",
      customerName: "Sam Customer",
      customerEmail: "sam@example.com",
      customerPhone: null,
      travelBrief: "I would like help arranging a special family holiday next summer.",
      consentConfirmed: true,
    })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(sendDirectEmail).not.toHaveBeenCalled();
  });
});

describe("consumerSite agent profile submission", () => {
  beforeEach(() => {
    selectResults.splice(0, selectResults.length);
    vi.clearAllMocks();
  });

  it("allows a complete profile to enter review before staff have configured any speciality tags", async () => {
    selectResults.push(
      [],
      [{ id: 9001, userId: 19, ...completedDraft, consentConfirmedAt: new Date() }],
      [],
      [],
    );

    await expect(agentCaller().profile.submitForReview(completedDraft)).resolves.toEqual({ success: true });
  });

  it("requires a selected speciality only after staff have configured active tag choices", async () => {
    selectResults.push(
      [],
      [{ id: 9001, userId: 19, ...completedDraft, consentConfirmedAt: new Date() }],
      [],
      [{ id: 5 }],
    );

    await expect(agentCaller().profile.submitForReview(completedDraft)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Select at least one destination or travel-type speciality before submitting.",
    });
  });
});

describe("consumerSite staff profile eligibility", () => {
  beforeEach(() => {
    selectResults.splice(0, selectResults.length);
    vi.clearAllMocks();
  });

  it("allows a super-admin profile to publish without an Active agent CRM record", async () => {
    const staffProfile = {
      id: 88,
      userId: 1,
      displayName: "Max Kelly",
      biography: "I help customers arrange carefully considered holidays with clear advice, personal service and thoughtful travel planning.",
      listingTown: "Chester",
      enquiryDeliveryEmail: "max@thejltgroup.co.uk",
      consentConfirmedAt: new Date(),
      publicSlug: null,
    };
    selectResults.push(
      [staffProfile],
      [{ role: "super_admin" }],
      [],
      [{ id: 1, label: "Worldwide", category: "destination" }],
    );

    await expect(adminCaller().admin.reviewProfile({ userId: 1, action: "publish", note: null })).resolves.toEqual({ success: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ isPublished: true, reviewStatus: "published" }));
  });

  it("allows a super admin without an agent CRM record to load, save, and submit their own profile", async () => {
    selectResults.push([]);
    await expect(adminCaller().profile.mine()).resolves.toEqual({ profile: null, selectedTagIds: [], history: [] });

    selectResults.push([]);
    await expect(adminCaller().profile.saveDraft(completedDraft)).resolves.toEqual({ success: true, profileId: 9001 });

    selectResults.push(
      [],
      [{ id: 9001, userId: 1, ...completedDraft, consentConfirmedAt: new Date() }],
      [],
      [],
    );
    await expect(adminCaller().profile.submitForReview(completedDraft)).resolves.toEqual({ success: true });
  });

  it("allows a plain admin without an agent CRM record to load, save, and submit their own profile", async () => {
    const caller = adminCaller("admin");
    selectResults.push([]);
    await expect(caller.profile.mine()).resolves.toEqual({ profile: null, selectedTagIds: [], history: [] });

    selectResults.push([]);
    await expect(caller.profile.saveDraft(completedDraft)).resolves.toEqual({ success: true, profileId: 9001 });

    selectResults.push(
      [],
      [{ id: 9001, userId: 1, ...completedDraft, consentConfirmedAt: new Date() }],
      [],
      [],
    );
    await expect(caller.profile.submitForReview(completedDraft)).resolves.toEqual({ success: true });
  });
});

describe("consumerSite partner management", () => {
  beforeEach(() => {
    selectResults.splice(0, selectResults.length);
    vi.clearAllMocks();
  });

  const partnerDraft = {
    name: "Example Travel Co",
    category: "Tour operator",
    summary: "A carefully reviewed partner profile prepared for the JLT consumer website.",
    logoUrl: "https://example.test/brand/logo.png",
    websiteUrl: "https://example.test",
    isPublished: false,
    sortOrder: 10,
  };

  it("limits partner management to staff accounts", async () => {
    await expect(agentCaller().admin.listPartners()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(agentCaller().admin.savePartner(partnerDraft)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows staff to create an unpublished partner draft", async () => {
    await expect(adminCaller().admin.savePartner(partnerDraft)).resolves.toEqual({ id: 9001, created: true });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      name: "Example Travel Co",
      isPublished: false,
      websiteUrl: "https://example.test/",
      logoUrl: "https://example.test/brand/logo.png",
    }));
  });

  it("exposes only the approved public partner fields", async () => {
    selectResults.push([{ name: "Example Travel Co", slug: "example-travel-co-a1b2c", category: "Tour operator", summary: "Approved public summary", logoUrl: "https://example.test/logo.png", websiteUrl: "https://example.test" }]);
    const response = await publicCaller().public.listPartners();
    expect(response).toEqual([{ name: "Example Travel Co", slug: "example-travel-co-a1b2c", category: "Tour operator", summary: "Approved public summary", logoUrl: "https://example.test/logo.png", websiteUrl: "https://example.test" }]);
    expect(response[0]).not.toHaveProperty("isPublished");
    expect(response[0]).not.toHaveProperty("sortOrder");
  });

  it("rejects insecure partner URLs before they are stored", async () => {
    await expect(adminCaller().admin.savePartner({ ...partnerDraft, websiteUrl: "http://example.test" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Public website and social links must use https://.",
    });
  });
});

describe("consumerSite holiday showcases", () => {
  const showcase = {
    id: 501,
    agentId: 19,
    publicProfileId: 77,
    externalPublicationId: "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
    publicSlug: "new-york-and-finger-lakes-a1b2c",
    title: "New York and Finger Lakes Escape",
    summary: "A public-only itinerary snapshot created to inspire a thoughtful travel conversation.",
    destination: "New York and Finger Lakes",
    travelPeriodLabel: "Autumn 2026",
    durationNights: 7,
    priceAmount: "1495.00",
    priceCurrency: "GBP",
    pricePerPerson: true,
    heroImageUrl: "https://supplier.example/hero.jpg",
    isPublished: true,
    expiresAt: null,
    deletedAt: null,
    sortOrder: 0,
    itinerary: [{ day: 1, title: "Arrive in New York", highlights: ["Private transfer"] }],
    curatedSections: [{
      id: "550e8400-e29b-41d4-a716-446655440000",
      kind: "stay",
      title: "Rembrandt Residences Bangkok",
      summary: "A central hotel with easy access to the city sights, markets and dining scene.",
      facts: ["2 nights", "Grand Suite with Extra Bed", "Bed & Breakfast", "Bangkok – Sukhumvit"],
      images: [{ url: "https://supplier.example/rembrandt.jpg", source: "supplier", label: "Rembrandt Residences Bangkok", category: "hotel" }],
    }],
    accommodationOptions: [],
    inclusions: ["Selected accommodation"],
    practicalNotes: ["Subject to availability"],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    selectResults.splice(0, selectResults.length);
    vi.clearAllMocks();
  });

  it("returns only active, visible public holiday showcase card fields on an approved agent profile", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active", inContract: false, accountRole: "agent" }],
      [showcase],
    );
    const response = await publicCaller().public.listShowcasesForAgent({ agentSlug: "alex-travel-19" });
    expect(response).toEqual([expect.objectContaining({ slug: showcase.publicSlug, title: showcase.title, price: expect.objectContaining({ amount: 1495 }) })]);
    expect(response[0]).not.toHaveProperty("agentId");
    expect(response[0]).not.toHaveProperty("externalPublicationId");
    expect(response[0]).not.toHaveProperty("sourceSnapshot");
  });

  it("lists only safe cards from public, currently eligible agent profiles for the cross-agent holiday directory", async () => {
    selectResults.push([{
      showcase,
      profile: visibleProfile,
      agentStatus: "active",
      inContract: false,
      accountRole: "agent",
    }, {
      showcase: { ...showcase, id: 502, publicSlug: "hidden-private-trip", externalPublicationId: "private-orbit-reference", agentId: 44 },
      profile: { ...visibleProfile, id: 78, userId: 44, publicSlug: "hidden-agent" },
      agentStatus: "in_notice",
      inContract: false,
      accountRole: "agent",
    }]);
    const response = await publicCaller().public.listShowcases({ search: "finger lakes", destination: "new york" });
    expect(response).toEqual([expect.objectContaining({
      slug: showcase.publicSlug,
      title: showcase.title,
      agent: { slug: "alex-travel-19", displayName: "Alex Travel" },
    })]);
    expect(JSON.stringify(response)).not.toContain("private-orbit-reference");
    expect(JSON.stringify(response)).not.toContain("agentId");
  });

  it("filters cross-agent holiday cards by displayed travel period, price range, and duration without weakening visibility safeguards", async () => {
    selectResults.push([{
      showcase,
      profile: visibleProfile,
      agentStatus: "active",
      inContract: false,
      accountRole: "agent",
    }]);
    await expect(publicCaller().public.listShowcases({ travelPeriod: "autumn", priceBand: "1000_1999", durationBand: "week" })).resolves.toHaveLength(1);
    selectResults.push([{
      showcase,
      profile: visibleProfile,
      agentStatus: "active",
      inContract: false,
      accountRole: "agent",
    }]);
    await expect(publicCaller().public.listShowcases({ priceBand: "under_1000" })).resolves.toEqual([]);
  });

  it("stores the selected visible showcase ID on an agent-directed consumer enquiry", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active", inContract: false, accountRole: "agent" }],
      [showcase],
      [],
    );
    await expect(publicCaller().public.submitEnquiry({
      slug: "alex-travel-19", showcaseSlug: showcase.publicSlug, customerName: "Sam Customer", customerEmail: "sam@example.com", customerPhone: null,
      travelBrief: "I would like to adapt this itinerary for a special family holiday next autumn.", consentConfirmed: true,
    })).resolves.toEqual({ success: true });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ showcaseId: 501, agentId: 19, profileId: 77 }));
    expect(sendDirectEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({ toEmail: "private.agent@example.co.uk", subject: expect.stringContaining(showcase.title) }));
  });

  it("lets an agent list and remove only their own received snapshot", async () => {
    selectResults.push([showcase]);
    await expect(agentCaller().showcases.mine()).resolves.toEqual([expect.objectContaining({ id: 501, publicSlug: showcase.publicSlug })]);
    selectResults.push([showcase]);
    await expect(agentCaller().showcases.remove({ id: 501 })).resolves.toEqual({ success: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ isPublished: false, deletedAt: expect.any(Date), deletedById: 19 }));
  });

  it("returns customer-safe curated sections to the owning agent editor, including editable section images and facts", async () => {
    selectResults.push([showcase], []);
    const response = await agentCaller().showcases.editable({ id: 501 });
    expect(response.draft.curatedSections).toEqual([expect.objectContaining({
      title: "Rembrandt Residences Bangkok",
      facts: expect.arrayContaining(["Grand Suite with Extra Bed", "Bed & Breakfast"]),
      images: [expect.objectContaining({ url: "https://supplier.example/rembrandt.jpg", category: "hotel" })],
    })]);
  });

  it("applies an approved section-level edit only through the staff review procedure", async () => {
    const sectionDraft = {
      title: "New York and Finger Lakes Escape",
      summary: "A public-only itinerary snapshot created to inspire a thoughtful travel conversation.",
      destination: "New York and Finger Lakes",
      travelPeriodLabel: "Autumn 2026",
      durationNights: 7,
      priceAmount: 1495,
      heroImage: { url: "https://supplier.example/hero.jpg", source: "supplier" as const },
      itineraryImages: [],
      curatedSections: [{
        id: "550e8400-e29b-41d4-a716-446655440000",
        kind: "stay" as const,
        title: "Rembrandt Residences Bangkok",
        summary: "A central hotel with easy access to the city sights, markets and dining scene.",
        facts: ["2 nights", "Grand Suite with Extra Bed", "Bed & Breakfast", "Bangkok – Sukhumvit"],
        images: [{ url: "https://supplier.example/rembrandt.jpg", source: "supplier" as const, label: "Rembrandt Residences Bangkok", category: "hotel" as const }],
      }],
      editorialTags: ["City break"],
      inclusions: ["Selected accommodation"],
      practicalNotes: ["Your expert will confirm the final arrangements."],
    };
    const request = { id: 611, showcaseId: 501, agentId: 19, status: "pending", draft: sectionDraft };
    selectResults.push([request], [showcase]);
    await expect(adminCaller().admin.reviewShowcaseEdit({ id: 611, action: "approve", note: "Clear customer copy." })).resolves.toEqual({ success: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      curatedSections: [expect.objectContaining({ title: "Rembrandt Residences Bangkok", facts: expect.arrayContaining(["Bed & Breakfast"]) })],
    }));
  });

  it("publishes an owned customer-safe showcase edit immediately and retains a recognised existing section image", async () => {
    selectResults.push([showcase], []);
    const draft = {
      title: "New York and Finger Lakes escape",
      summary: "A relaxed city and countryside holiday idea, shaped around the pace and experiences that suit you.",
      destination: "New York and Finger Lakes",
      travelPeriodLabel: "Autumn 2027",
      durationNights: 8,
      priceAmount: 1795,
      heroImage: { url: "https://supplier.example/hero.jpg", source: "supplier" as const },
      itineraryImages: [],
      curatedSections: [{
        id: "550e8400-e29b-41d4-a716-446655440000",
        kind: "stay" as const,
        title: "Rembrandt Residences Bangkok",
        summary: "A central hotel with easy access to the city sights, markets and dining scene.",
        facts: ["2 nights", "Grand Suite with Extra Bed", "Bed & Breakfast", "Bangkok – Sukhumvit"],
        images: [{ url: "https://supplier.example/rembrandt.jpg", source: "agent_upload" as const, label: "Holiday image", category: "hotel" as const }],
      }],
      editorialTags: ["Culture", "Scenic"],
      inclusions: ["Selected accommodation"],
      practicalNotes: ["Your expert will confirm the final arrangements."],
    };
    await expect(agentCaller().showcases.submitEdit({ id: 501, draft, agentNote: "Updated for customer clarity." })).resolves.toEqual({ success: true, published: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ title: draft.title, curatedSections: expect.arrayContaining([expect.objectContaining({ title: "Rembrandt Residences Bangkok" })]) }));
    expect(insertValues).not.toHaveBeenCalledWith(expect.objectContaining({ showcaseId: 501, agentId: 19, draft }));
  });

  it("accepts a retained section image found in the immutable Orbit source snapshot when the live column no longer contains it", async () => {
    const snapshotOnlyShowcase = {
      ...showcase,
      curatedSections: null,
      sourceSnapshot: { curatedSections: showcase.curatedSections },
    };
    selectResults.push([snapshotOnlyShowcase], []);
    const draft = {
      title: "New York and Finger Lakes escape",
      summary: "A relaxed city and countryside holiday idea, shaped around the pace and experiences that suit you.",
      destination: "New York and Finger Lakes",
      travelPeriodLabel: "Autumn 2027",
      durationNights: 8,
      priceAmount: 1795,
      heroImage: { url: "https://supplier.example/hero.jpg", source: "supplier" as const },
      itineraryImages: [],
      curatedSections: [{
        ...showcase.curatedSections[0],
        images: [{ ...showcase.curatedSections[0].images[0], source: "supplier" as const }],
      }],
      editorialTags: ["Culture"],
      inclusions: ["Selected accommodation"],
      practicalNotes: ["Your expert will confirm the final arrangements."],
    };
    await expect(agentCaller().showcases.submitEdit({ id: 501, draft, agentNote: null })).resolves.toEqual({ success: true, published: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ curatedSections: expect.arrayContaining([expect.objectContaining({ title: "Rembrandt Residences Bangkok" })]) }));
  });
});
