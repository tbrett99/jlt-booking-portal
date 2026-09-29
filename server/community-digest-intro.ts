/**
 * Convert the plain-text digest introduction into safe email HTML while keeping
 * the exact line breaks staff entered in the editor. Digest intros are not rich
 * text, so any HTML-like text is escaped before line breaks become <br /> tags.
 */
export function formatCommunityDigestIntro(text: string | null | undefined): string {
  if (!text?.trim()) return "";

  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  return escaped.replace(/\r\n|\r|\n/g, "<br />");
}
