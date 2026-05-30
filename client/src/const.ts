export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Returns the login page URL.
// On Railway (no Manus OAuth), this points to the built-in email/password login page.
// The optional returnTo param is preserved so agents land back where they were.
export const getLoginUrl = (returnTo?: string): string => {
  const base = "/login";
  if (returnTo) {
    return `${base}?returnTo=${encodeURIComponent(returnTo)}`;
  }
  return base;
};
