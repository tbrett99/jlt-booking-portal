const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const EMBED_HOSTS = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Only individual videos on recognised HTTPS YouTube hosts may be iframed. */
function youtubeVideoUrl(value: string | null | undefined): { url: URL; id: string } | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (SHORT_HOSTS.has(host)) {
      id = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
    } else if (YOUTUBE_HOSTS.has(host)) {
      if (url.pathname === "/watch" && url.searchParams.getAll("v").length === 1) {
        id = url.searchParams.get("v");
      } else {
        id = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
      }
    } else if (EMBED_HOSTS.has(host)) {
      id = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
    }
    return id && VIDEO_ID.test(id) ? { url, id } : null;
  } catch {
    return null;
  }
}

export function parseYouTubeEmbedId(value: string | null | undefined): string | null {
  return youtubeVideoUrl(value)?.id ?? null;
}

/** Normal share timestamps only; never forward user-supplied iframe parameters. */
function timestampSeconds(value: string | null): number | null {
  if (!value) return null;
  let seconds: number;
  if (/^\d{1,8}s?$/i.test(value)) {
    seconds = Number(value.replace(/s$/i, ""));
  } else {
    const match = value.match(/^(?:(\d{1,4})h)?(?:(\d{1,4})m)?(?:(\d{1,4})s)?$/i);
    if (!match || !match.slice(1).some(Boolean)) return null;
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  }
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 604800 ? seconds : null;
}

export function youtubeEmbedUrl(value: string | null | undefined): string | null {
  const parsed = youtubeVideoUrl(value);
  if (!parsed) return null;
  const params = new URLSearchParams({ rel: "0" });
  const hash = new URLSearchParams(parsed.url.hash.replace(/^#/, ""));
  const start = timestampSeconds(parsed.url.searchParams.get("start"))
    ?? timestampSeconds(parsed.url.searchParams.get("t"))
    ?? timestampSeconds(hash.get("t"));
  if (start !== null && start > 0) params.set("start", String(start));
  return `https://www.youtube-nocookie.com/embed/${parsed.id}?${params.toString()}`;
}
