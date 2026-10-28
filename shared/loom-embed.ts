const LOOM_HOSTS = new Set(["loom.com", "www.loom.com"]);
const LOOM_URL_PATTERN = /https:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/[a-zA-Z0-9]+(?:\?[^\s"'<]*)?/gi;

/** Returns only a valid Loom share/embed ID; arbitrary video URLs are never iframed. */
export function parseLoomEmbedId(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !LOOM_HOSTS.has(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(/^\/(?:share|embed)\/([a-zA-Z0-9]+)\/?$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function loomEmbedUrl(value: string | null | undefined) {
  const id = parseLoomEmbedId(value);
  return id ? `https://www.loom.com/embed/${id}` : null;
}

export type LoomEmbed = {
  id: string;
  embedUrl: string;
  shareUrl: string;
};

/**
 * Finds recognised Loom share URLs in trusted rich text and returns each video
 * once. This lets the Portal turn the email-editor's linked Loom thumbnail
 * into an accessible, in-Portal player without ever iframing an arbitrary URL.
 */
export function extractLoomEmbeds(value: string | null | undefined): LoomEmbed[] {
  if (!value?.trim()) return [];
  const seen = new Set<string>();
  const embeds: LoomEmbed[] = [];
  Array.from(value.matchAll(LOOM_URL_PATTERN)).forEach((match) => {
    const id = parseLoomEmbedId(match[0]);
    if (!id || seen.has(id)) return;
    seen.add(id);
    embeds.push({ id, embedUrl: `https://www.loom.com/embed/${id}`, shareUrl: `https://www.loom.com/share/${id}` });
  });
  return embeds;
}

/**
 * RichEmailEditor deliberately writes a linked thumbnail for email clients.
 * A Knowledge Base article is a web page, so hide just that thumbnail card
 * once an in-Portal player has been rendered above the article content.
 */
export function removeLoomEmailCards(value: string | null | undefined) {
  if (!value?.trim()) return value ?? "";
  return value
    .replace(/<a\b[^>]*href=["']https:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/[a-zA-Z0-9]+[^"']*["'][^>]*>[\s\S]*?<img\b[^>]*\balt=["']Watch video on Loom["'][^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/<p\b[^>]*\bdata-library-loom=["']true["'][^>]*>[\s\S]*?<\/p>/gi, "")
    .replace(/<div\b[^>]*>\s*<\/div>/gi, "");
}
