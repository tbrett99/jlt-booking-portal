/**
 * Shared upload validation — enforced on both server and client.
 * Only PDF, JPG, and PNG are permitted for all portal file uploads.
 */

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

/** Human-readable label shown in error messages and UI hints */
export const ALLOWED_TYPES_LABEL = "PDF, JPG, or PNG";

/** The `accept` string for HTML <input type="file"> elements */
export const FILE_INPUT_ACCEPT = ".pdf,.jpg,.jpeg,.png";

/**
 * Returns true if the given MIME type is permitted.
 * Falls back to extension check if mimeType is empty/generic.
 */
export function isAllowedMimeType(mimeType: string, fileName?: string): boolean {
  const mime = mimeType.toLowerCase().trim();
  if (ALLOWED_MIME_TYPES.includes(mime as AllowedMimeType)) return true;
  // Fallback: check file extension (some browsers report empty/generic MIME for PDFs)
  if (fileName) {
    const ext = ("." + fileName.split(".").pop()?.toLowerCase()) as string;
    return ALLOWED_EXTENSIONS.includes(ext);
  }
  return false;
}
