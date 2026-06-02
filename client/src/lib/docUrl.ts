/**
 * Converts a Manus CloudFront document URL to a proxied URL that works on Railway.
 * Files uploaded before the Railway migration are stored in Manus built-in storage
 * (d2xsxph8kpxj0f.cloudfront.net) and require server-side authentication to access.
 * The /api/doc-proxy endpoint handles this transparently.
 *
 * R2 URLs (pub-*.r2.dev) are publicly accessible and returned as-is.
 */
export function resolveDocUrl(url: string | null | undefined, key?: string | null): string | null {
  if (!url) return null;

  // Manus CloudFront URLs need to go through the proxy
  if (url.includes('d2xsxph8kpxj0f.cloudfront.net')) {
    // Prefer the key if available (cleaner), otherwise extract from URL
    const fileKey = key ?? url.split('/').slice(3).join('/');
    return `/api/doc-proxy?key=${encodeURIComponent(fileKey)}`;
  }

  // R2 and other public URLs are fine as-is
  return url;
}
