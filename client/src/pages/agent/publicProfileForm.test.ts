import { describe, expect, it } from "vitest";
import {
  buildPublicProfileDraftPayload,
  getPublicProfileSubmissionIssue,
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

  it("explains exactly how many biography characters are still required before attempting submission", () => {
    const result = getPublicProfileSubmissionIssue({
      ...publicProfileInitialForm,
      displayName: "Alex Carter",
      biography: "A thoughtful travel expert.",
      listingTown: "Chester",
      enquiryDeliveryEmail: "alex@example.test",
    }, [4], true, true);

    expect(result).toBe("Please add 53 more characters to About you before continuing.");
  });

  it("allows complete content with a speciality and consent to reach the review request", () => {
    const result = getPublicProfileSubmissionIssue({
      ...publicProfileInitialForm,
      displayName: "Alex Carter",
      biography: "I arrange thoughtful tailor-made holidays for families, couples and celebration trips around the world.",
      listingTown: "Chester",
      enquiryDeliveryEmail: "alex@example.test",
    }, [4], true, true);

    expect(result).toBeNull();
  });

  it("allows the first profile to be submitted before JLT has configured any specialities", () => {
    const result = getPublicProfileSubmissionIssue({
      ...publicProfileInitialForm,
      displayName: "Alex Carter",
      biography: "I arrange thoughtful tailor-made holidays for families, couples and celebration trips around the world.",
      listingTown: "Chester",
      enquiryDeliveryEmail: "alex@example.test",
    }, [], true, false);

    expect(result).toBeNull();
  });

  it("explains the twelve-speciality maximum before attempting a submission", () => {
    const result = getPublicProfileSubmissionIssue({
      ...publicProfileInitialForm,
      displayName: "Alex Carter",
      biography: "I arrange thoughtful tailor-made holidays for families, couples and celebration trips around the world.",
      listingTown: "Chester",
      enquiryDeliveryEmail: "alex@example.test",
    }, Array.from({ length: 13 }, (_, index) => index + 1), true, true);

    expect(result).toBe("You can select up to 12 specialities. Please remove one or more before submitting for review.");
  });
});
