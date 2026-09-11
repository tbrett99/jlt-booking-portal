export type PublicProfileForm = {
  displayName: string;
  businessName: string;
  biography: string;
  listingTown: string;
  enquiryDeliveryEmail: string;
  websiteUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  facebookUrl: string;
  linkedinUrl: string;
  youtubeUrl: string;
  pinterestUrl: string;
};

export const publicProfileInitialForm: PublicProfileForm = {
  displayName: "",
  businessName: "",
  biography: "",
  listingTown: "",
  enquiryDeliveryEmail: "",
  websiteUrl: "",
  instagramUrl: "",
  tiktokUrl: "",
  facebookUrl: "",
  linkedinUrl: "",
  youtubeUrl: "",
  pinterestUrl: "",
};

/** Build the exact complete-draft payload used by both Save draft and Submit for review. */
export function buildPublicProfileDraftPayload(form: PublicProfileForm, selectedTagIds: number[], consent: true) {
  return {
    ...form,
    townLatitude: null,
    townLongitude: null,
    specialityTagIds: selectedTagIds,
    consentConfirmed: consent,
  };
}

/** A photo upload may update the stored photo, but must never replace unsaved form fields. */
export function preserveDraftDuringPhotoUpload(form: PublicProfileForm, photoUrl: string) {
  return { form: { ...form }, photoUrl };
}
