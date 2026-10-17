/**
 * Community records created before attachment fields were normalised may contain
 * a JSON string, a single URL, or an array. Rendering must tolerate every form.
 */
export function asCommunityArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    // Older posts can contain a single URL rather than JSON. Preserve it safely.
    return /^(https?:\/\/|\/)/i.test(value.trim()) ? [value] as T[] : [];
  }
}
