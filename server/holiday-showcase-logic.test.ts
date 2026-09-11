import { describe, expect, it } from "vitest";
import { isPublicShowcaseVisible, orbitHolidayShowcaseSchema, toPublicShowcaseCard } from "./holiday-showcase-logic";

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

  it("rejects client, internal, supplier-token, and margin fields", () => {
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, clientName: "Private client" })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, margin: 33 })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, supplierToken: "private" })).toThrow();
  });

  it("rejects Google and unknown image sources", () => {
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, heroImage: { url: "https://example.com/photo.jpg", source: "google" } })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, heroImage: { url: "http://example.com/photo.jpg", source: "supplier" } })).toThrow();
    expect(() => orbitHolidayShowcaseSchema.parse({ ...validPayload, heroImage: { url: "https://maps.google.com/photo.jpg", source: "supplier" } })).toThrow();
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
});
