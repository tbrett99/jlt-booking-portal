import { describe, expect, it } from "vitest";
import { holidayShowcaseEditDraftSchema, isConsumerSafeShowcaseText, isPublicShowcaseVisible, orbitHolidayShowcaseSchema, toPublicShowcaseCard, toPublicShowcaseDetail, toSafePublicValidationIssues } from "./holiday-showcase-logic";

const validPayload = {
  agentId: "JLT-123",
  externalPublicationId: "b1a2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
  title: "New York and Finger Lakes Escape",
  summary: "A hand-picked autumn itinerary for travellers who want a city stay and a slower countryside escape.",
  destination: "New York and Finger Lakes",
  durationNights: 7,
  price: { mode: "from", amount: 1495, currency: "GBP", perPerson: true },
  heroImage: { url: "https://assets.example.com/hero.jpg", source: "supplier" },
  itinerary: [{ day: 1, title: "Arrive in New York", highlights: ["Private airport transfer"] }],
  accommodationOptions: [],
  inclusions: ["Selected accommodation"],
  practicalNotes: ["Subject to availability"],
};

describe("Orbit holiday showcase payload contract", () => {
  it("accepts the strict public allowlist", () => {
    expect(orbitHolidayShowcaseSchema.parse(validPayload).title).toContain("New York");
  });

  it("accepts Orbit's exact curated flight section without a legacy itinerary", () => {
    const curatedSections = [{
      id: "550e8400-e29b-41d4-a716-446655440000",
      kind: "flight" as const,
      title: "Fly to Cape Town",
      summary: "Start your holiday with a flight to Cape Town.",
      facts: ["Edinburgh to Cape Town", "Economy"],
      images: [],
    }];
    const parsed = orbitHolidayShowcaseSchema.parse({ ...validPayload, itinerary: [], curatedSections });
    expect(parsed.curatedSections).toEqual(curatedSections);
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, itinerary: [] })).toThrow();
  });

  it("rejects client, internal, supplier-token, and margin fields", () => {
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, clientName: "Private client" })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, margin: 33 })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, supplierToken: "private" })).toThrow();
  });

  it("maps rejected payload issues without returning rejected key names or submitted values", () => {
    const result = orbitHolidayShowcaseSchema.safeParse({ ...validPayload, privateQuoteReference: "Orbit-private-782" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = toSafePublicValidationIssues(result.error.issues);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "payload", code: "unrecognized_keys" })]));
    expect(JSON.stringify(issues)).not.toContain("privateQuoteReference");
    expect(JSON.stringify(issues)).not.toContain("Orbit-private-782");
  });

  it("rejects Google and unknown image sources", () => {
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, heroImage: { url: "https://example.com/photo.jpg", source: "google" } })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, heroImage: { url: "http://example.com/photo.jpg", source: "supplier" } })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, heroImage: { url: "https://maps.google.com/photo.jpg", source: "supplier" } })).toThrow();
  });

  it("accepts up to twenty-four labelled public itinerary images and rejects unsafe gallery data", () => {
    const itineraryImages = Array.from({ length: 24 }, (_, index) => ({
      url: `https://assets.example.com/gallery-${index}.jpg`,
      source: "supplier" as const,
      label: `The Elser Hotel Miami ${index + 1}`,
      category: "hotel" as const,
    }));
    expect(orbitHolidayShowcaseSchema.parse({ ...validPayload, itineraryImages }).itineraryImages).toHaveLength(24);
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, itineraryImages: [...itineraryImages, itineraryImages[0]] })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, itineraryImages: [{ ...itineraryImages[0], url: "http://assets.example.com/unsafe.jpg" }] })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, itineraryImages: [{ ...itineraryImages[0], url: "https://lh3.googleusercontent.com/unsafe.jpg" }] })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, itineraryImages: [{ ...itineraryImages[0], source: "orbit" }] })).toThrow();
  });

  it("accepts an ordered curated public story but rejects unsafe section data", () => {
    const sections = [{
      id: "b1a2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
      kind: "stay" as const,
      title: "Cape Town coastal stay",
      summary: "Settle into a relaxed oceanfront base with time to explore the city and peninsula.",
      facts: ["5 nights", "Bed & Breakfast", "Bantry Bay"],
      images: [{ url: "https://assets.example.com/president.jpg", source: "supplier" as const, label: "President Hotel", category: "hotel" as const }],
    }];
    expect(orbitHolidayShowcaseSchema.parse({ ...validPayload, curatedSections: sections }).curatedSections).toHaveLength(1);
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, curatedSections: [{ ...sections[0], orbitProductId: "private" }] })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, curatedSections: [{ ...sections[0], facts: Array.from({ length: 6 }, (_, index) => `Fact ${index + 1}`) }] })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, curatedSections: [{ ...sections[0], images: [{ ...sections[0].images[0], url: "https://lh3.googleusercontent.com/private.jpg" }] }] })).toThrow();
  });

  it("hides unpublished, expired, and deleted snapshots", () => {
    const now = new Date("2026-09-11T12:00:00Z");
    expect(isPublicShowcaseVisible({ isPublished: true }, now)).toBe(true);
    expect(isPublicShowcaseVisible({ isPublished: false }, now)).toBe(false);
    expect(isPublicShowcaseVisible({ isPublished: true, expiresAt: new Date("2026-09-10T12:00:00Z") }, now)).toBe(false);
    expect(isPublicShowcaseVisible({ isPublished: true, deletedAt: new Date() }, now)).toBe(false);
  });

  it("returns only consumer-safe card fields", () => {
    const card = toPublicShowcaseCard({ ...validPayload, publicSlug: "new-york-escape", heroImageUrl: null, priceAmount: "1495.00", priceCurrency: "GBP", pricePerPerson: true });
    expect(card).toEqual(expect.objectContaining({ slug: "new-york-escape", title: validPayload.title, price: expect.objectContaining({ amount: 1495 }) }));
    expect(card).not.toHaveProperty("agentId");
    expect(card).not.toHaveProperty("externalPublicationId");
  });

  it("returns only public gallery fields and strips image source or unknown metadata from detail responses", () => {
    const detail = toPublicShowcaseDetail({
      ...validPayload,
      publicSlug: "new-york-escape",
      heroImageUrl: null,
      priceAmount: null,
      priceCurrency: null,
      pricePerPerson: null,
      itineraryImages: [{
        url: "https://assets.example.com/elser.jpg",
        source: "supplier",
        label: "The Elser Hotel Miami",
        category: "hotel",
        orbitProductId: "private-product-id",
      }],
    });
    expect(detail.itineraryImages).toEqual([{ url: "https://assets.example.com/elser.jpg", label: "The Elser Hotel Miami", category: "hotel" }]);
    expect(JSON.stringify(detail)).not.toContain("orbitProductId");
    expect(JSON.stringify(detail)).not.toContain("supplier");
  });

  it("accepts customer-friendly agent edit drafts but rejects Orbit-derived rate and room wording", () => {
    const safeDraft = {
      title: "Cape Town coastal escape",
      summary: "A relaxed city-and-coast itinerary with plenty of time to explore at your own pace.",
      destination: "Cape Town",
      travelPeriodLabel: "May 2027",
      durationNights: 7,
      priceAmount: 1895,
      heroImage: null,
      itineraryImages: [],
      editorialTags: ["Culture", "Beach"],
      inclusions: ["Seven nights of selected accommodation"],
      practicalNotes: ["Your travel expert will tailor the final arrangements."],
    };
    expect(holidayShowcaseEditDraftSchema.parse(safeDraft).title).toBe("Cape Town coastal escape");
    expect(() => holidayShowcaseEditDraftSchema.parse({ ...safeDraft, editorialTags: ["Deluxe Room–with Extra Bed ~ Non Refundable - Miles Attack: 1102 Miles (AP-TH-HOTDEAL2627 23% - 23%)"] })).toThrow();
    expect(isConsumerSafeShowcaseText("Miles Attack: 1102 Miles (AP-TH-HOTDEAL2627 23%)")).toBe(false);
  });

  it("suppresses legacy room, board, and operational-rate data from public detail responses", () => {
    const detail = toPublicShowcaseDetail({
      ...validPayload,
      publicSlug: "cape-town-safe-copy",
      heroImageUrl: null,
      priceAmount: null,
      priceCurrency: null,
      pricePerPerson: null,
      accommodationOptions: [{
        name: "Ocean-view hotel",
        location: "Cape Town",
        room: "Deluxe Room–with Extra Bed ~ Non Refundable",
        board: "Miles Attack: 1102 Miles (AP-TH-HOTDEAL2627 23% - 23%)",
        description: "A peaceful base near the waterfront.",
      }],
      inclusions: ["Selected accommodation", "AP-TH-HOTDEAL2627 23%"],
      practicalNotes: ["A tailored quote will confirm local taxes.", "Non Refundable rate applies"],
    });
    expect(detail.accommodationOptions).toEqual([{ name: "Ocean-view hotel", location: "Cape Town", description: "A peaceful base near the waterfront." }]);
    expect(detail.inclusions).toEqual(["Selected accommodation"]);
    expect(detail.practicalNotes).toEqual(["A tailored quote will confirm local taxes."]);
    expect(JSON.stringify(detail)).not.toContain("Miles Attack");
    expect(JSON.stringify(detail)).not.toContain("HOTDEAL");
    expect(JSON.stringify(detail)).not.toContain("Non Refundable");
  });

  it("returns only allowlisted curated section fields and leaves legacy snapshots on the fallback path", () => {
    const legacy = toPublicShowcaseDetail({ ...validPayload, publicSlug: "legacy", heroImageUrl: null, priceAmount: null, priceCurrency: null, pricePerPerson: null });
    expect(legacy.curatedSections).toEqual([]);
    const detail = toPublicShowcaseDetail({
      ...validPayload,
      publicSlug: "cape-town",
      heroImageUrl: null,
      priceAmount: null,
      priceCurrency: null,
      pricePerPerson: null,
      curatedSections: [{
        id: "b1a2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
        kind: "stay",
        title: "Cape Town coastal stay",
        summary: "Settle into a relaxed oceanfront base with time to explore the city and peninsula.",
        facts: ["5 nights"],
        images: [{ url: "https://assets.example.com/president.jpg", source: "supplier", label: "President Hotel", category: "hotel", quoteReference: "private" }],
        orbitProductId: "private-product-id",
      }],
    });
    expect(detail.curatedSections).toEqual([{ id: "b1a2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5", kind: "stay", title: "Cape Town coastal stay", summary: "Settle into a relaxed oceanfront base with time to explore the city and peninsula.", facts: ["5 nights"], images: [{ url: "https://assets.example.com/president.jpg", label: "President Hotel", category: "hotel" }] }]);
    expect(JSON.stringify(detail)).not.toContain("private-product-id");
    expect(JSON.stringify(detail)).not.toContain("quoteReference");
    expect(JSON.stringify(detail)).not.toContain("supplier");
  });
});
