import { describe, expect, it } from "vitest";
import { isApprovedPublicUrl, isPublicAgentProfileVisible, publicEnquiryAdmission, toPublicAgentResponse } from "./consumer-site-logic";

describe("consumer public-profile visibility", () => {
  const approvedProfile = {
    isPublished: true,
    agentStatus: "active",
    inContract: false,
    hasPublishedSnapshot: true,
    hasPublicSlug: true,
  };

  it("only exposes a currently Active approved profile with a published snapshot", () => {
    expect(isPublicAgentProfileVisible(approvedProfile)).toBe(true);
    expect(isPublicAgentProfileVisible({ ...approvedProfile, isPublished: false })).toBe(false);
    expect(isPublicAgentProfileVisible({ ...approvedProfile, hasPublishedSnapshot: false })).toBe(false);
    expect(isPublicAgentProfileVisible({ ...approvedProfile, hasPublicSlug: false })).toBe(false);
  });

  it("hides profiles for every non-Active status and In Contract agents", () => {
    for (const agentStatus of ["paused", "in_notice", "suspended", "cancelled", null]) {
      expect(isPublicAgentProfileVisible({ ...approvedProfile, agentStatus })).toBe(false);
    }
    expect(isPublicAgentProfileVisible({ ...approvedProfile, inContract: true })).toBe(false);
  });
});

describe("consumer public-link validation", () => {
  it("accepts absent links and secure links on their approved platform", () => {
    expect(isApprovedPublicUrl(null)).toBe(true);
    expect(isApprovedPublicUrl("https://www.instagram.com/jlt.travel", ["instagram.com"])).toBe(true);
    expect(isApprovedPublicUrl("https://travel.example.co.uk")).toBe(true);
  });

  it("rejects insecure, malformed, and cross-platform social links", () => {
    expect(isApprovedPublicUrl("http://instagram.com/jlt", ["instagram.com"])).toBe(false);
    expect(isApprovedPublicUrl("not-a-url", ["instagram.com"])).toBe(false);
    expect(isApprovedPublicUrl("https://example.com/jlt", ["instagram.com"])).toBe(false);
  });
});

describe("consumer public-profile response contract", () => {
  it("allow-lists only the approved public profile fields", () => {
    const source = {
      publicSlug: "alex-travel-42",
      displayName: "Alex Travel",
      businessName: "Alex Travel Co",
      biography: "Tailor-made travel for couples and families.",
      profilePhotoUrl: "https://media.example/photo.jpg",
      listingTown: "Chester",
      townLatitude: "53.1900",
      townLongitude: "-2.8900",
      websiteUrl: "https://example.co.uk",
      instagramUrl: "https://instagram.com/alex",
      tiktokUrl: null,
      facebookUrl: null,
      linkedinUrl: null,
      youtubeUrl: null,
      pinterestUrl: null,
      enquiryDeliveryEmail: "private@example.co.uk",
      personalEmail: "personal@example.co.uk",
      mobile: "07123456789",
      addressLine1: "1 Private Road",
      bankAccountNumber: "00000000",
      internalNotes: "Never publish",
      paymentExempt: true,
    };
    const response = toPublicAgentResponse(source, [{ id: 1, label: "Caribbean" }]);
    expect(response).toMatchObject({ slug: "alex-travel-42", displayName: "Alex Travel", listingTown: "Chester", townLatitude: 53.19 });
    expect(response).not.toHaveProperty("enquiryDeliveryEmail");
    expect(response).not.toHaveProperty("personalEmail");
    expect(response).not.toHaveProperty("mobile");
    expect(response).not.toHaveProperty("addressLine1");
    expect(response).not.toHaveProperty("bankAccountNumber");
    expect(response).not.toHaveProperty("internalNotes");
    expect(response).not.toHaveProperty("paymentExempt");
  });
});

describe("consumer enquiry admission", () => {
  it("rejects unavailable profiles before accepting an enquiry", () => {
    expect(publicEnquiryAdmission({ profileVisible: false, recentSubmissionCount: 0 })).toBe("profile_unavailable");
  });

  it("limits an IP to three submissions in the configured time window", () => {
    expect(publicEnquiryAdmission({ profileVisible: true, recentSubmissionCount: 2 })).toBe("accepted");
    expect(publicEnquiryAdmission({ profileVisible: true, recentSubmissionCount: 3 })).toBe("rate_limited");
  });
});
