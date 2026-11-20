export type AcademyPdfResource = {
  id?: number;
  attachmentUrl?: string | null;
  attachmentKey?: string | null;
  embedPdf?: boolean | null;
};

/** Teaching uploads only: never assessment templates, submissions or HTML embeds. */
export function isAcademyPdfResource(resource: AcademyPdfResource): boolean {
  const key = resource.attachmentKey;
  const source = resource.attachmentUrl;
  if (!key || !source || !/^academy\/\d+\/[a-f0-9-]{36}-[a-z0-9._-]+\.pdf$/i.test(key)) return false;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
    const privatePath = `/api/academy/course-attachment/${encodeURIComponent(key)}`;
    if (url.pathname.startsWith("/api/")) {
      return url.origin === "https://portal.thejltgroup.co.uk" && url.pathname === privatePath;
    }
    // The server additionally checks the exact configured storage origin/base.
    // Client-side recognition is deliberately not an authorization decision.
    return url.pathname.endsWith(`/${key}`);
  } catch {
    return false;
  }
}

export function academyPdfViewerUrl(resource: AcademyPdfResource): string | null {
  if (resource.embedPdf !== true || !isAcademyPdfResource(resource)) return null;
  const url = new URL(resource.attachmentUrl!);
  if (url.pathname.startsWith("/api/academy/course-attachment/")) {
    if (!Number.isSafeInteger(resource.id) || resource.id! < 1) return null;
    // Keep cookie-authenticated private viewing on this Portal's own origin.
    return `${url.pathname}?view=inline&lessonId=${resource.id}`;
  }
  return url.href;
}
