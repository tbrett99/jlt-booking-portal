import { describe, expect, it } from "vitest";
import {
  buildPublicProfileDraftPayload,
  preserveDraftDuringPhotoUpload,
  publicProfileInitialForm,
} from "./publicProfileForm";

describe("public profile draft form", () => {
  it("keeps every unsaved field unchanged when a profile photograph upload completes", () => {
    const draft = {
      ...publicProfileInitialForm,
      displayName: "Alex Carter",
      businessName: "Alex Carter Travel",
      biography: "I arrange thoughtful tailor-made holidays for families, couples and celebration trips around the world.",
      listingTown: "Chester",
      enquiryDeliveryEmail: "alex@example.test",
      instagramUrl: "https://instagram.com/alexcartertravel",
    };

    const result = preserveDraftDuringPhotoUpload(draft, "https://storage.example.test/profile.jpg");

    expect(result.form).toEqual(draft);
    expect(result.form).not.toBe(draft);
    expect(result.photoUrl).toBe("https://storage.example.test/profile.jpg");
  });

  it("builds a complete submission payload from the fields currently on screen", () => {
    const payload = buildPublicProfileDraftPayload({
      ...publicProfileInitialForm,
      displayName: "Alex Carter",
      biography: "I arrange thoughtful tailor-made holidays for families, couples and celebration trips around the world.",
      listingTown: "Chester",
      enquiryDeliveryEmail: "alex@example.test",
    }, [4, 8], true);

    expect(payload).toMatchObject({
      displayName: "Alex Carter",
      specialityTagIds: [4, 8],
      consentConfirmed: true,
      townLatitude: null,
      townLongitude: null,
    });
  });
});
