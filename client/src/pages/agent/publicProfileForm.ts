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

export function getPublicProfileDraftIssue(form: PublicProfileForm, consent: boolean) {
  if (form.displayName.trim().length < 2) return "Please add the name you would like customers to see.";
  const biographyLength = form.biography.trim().length;
  if (biographyLength < 80) return `Please add ${80 - biographyLength} more character${80 - biographyLength === 1 ? "" : "s"} to About you before continuing.`;
  if (form.listingTown.trim().length < 2) return "Please add the town you would like shown on the agent map.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.enquiryDeliveryEmail.trim())) return "Please enter a valid private enquiry delivery email address.";
  if (!consent) return "Please confirm the public-profile consent statement before continuing.";
  return null;
}

export function getPublicProfileSubmissionIssue(form: PublicProfileForm, selectedTagIds: number[], consent: boolean, hasAvailableSpecialityTags: boolean) {
  const draftIssue = getPublicProfileDraftIssue(form, consent);
  if (draftIssue) return draftIssue;
  if (selectedTagIds.length > 12) return "You can select up to 12 specialities. Please remove one or more before submitting for review.";
  if (hasAvailableSpecialityTags && !selectedTagIds.length) return "Please select at least one destination or travel-type speciality before submitting for review.";
  return null;
}

/** A photo upload may update the stored photo, but must never replace unsaved form fields. */
export function preserveDraftDuringPhotoUpload(form: PublicProfileForm, photoUrl: string) {
  return { form: { ...form }, photoUrl };
}
