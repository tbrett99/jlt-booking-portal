const LOOM_HOSTS = new Set(["loom.com", "www.loom.com"]);

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
