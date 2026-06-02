/**
 * Converts a Manus CloudFront document URL to a proxied URL that works on Railway.
 * Files uploaded before the Railway migration are stored in Manus built-in storage
 * (d2xsxph8kpxj0f.cloudfront.net) and require server-side authentication to access.
 * The /api/doc-proxy endpoint handles this transparently.
 *
 * R2 URLs (pub-*.r2.dev) are publicly accessible and returned as-is.
 */
export function resolveDocUrl(url: string | null | undefined, _key?: string | null): string | null {
  if (!url) return null;

  // Manus CloudFront URLs need to go through the proxy
  // Always extract the full path from the URL (e.g. "310419663026820811/PdcDVQRp8zC2FzsyWBWptW/filename")
  // The stored fileKey is often just the filename, not the full path
  if (url.includes('d2xsxph8kpxj0f.cloudfront.net')) {
    const fullPath = url.split('cloudfront.net/')[1];
    return `/api/doc-proxy?key=${encodeURIComponent(fullPath)}`;
  }

  // R2 and other public URLs are fine as-is
  return url;
}
