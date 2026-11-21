export type StorageReadCategory = "missing_file" | "permission_denied" | "storage_unconfigured" | "timeout" | "cancelled"
  | "oversize" | "empty" | "truncated" | "unreadable" | "invalid_chunk" | "invalid_metadata" | "invalid_read" | "read_failed";
const storageReadMessages: Record<StorageReadCategory, string> = {
  missing_file: "Document storage file was not found", permission_denied: "Document storage read permission was denied",
  storage_unconfigured: "Document storage is not configured on this server", timeout: "Document read timed out",
  cancelled: "Document read was cancelled", oversize: "Document exceeds the conversion size limit",
  empty: "Document storage returned an empty file", truncated: "Document storage returned an incomplete file",
  unreadable: "Document storage returned no readable file body", invalid_chunk: "Document storage returned an invalid file body",
  invalid_metadata: "Document storage returned invalid file size metadata", invalid_read: "Invalid bounded document read",
  read_failed: "Document storage read failed",
};
/** Carries only a fixed category; deliberately retains no raw error/cause/key. */
export class StorageReadError extends Error {
  constructor(public readonly category: StorageReadCategory) { super(storageReadMessages[category]); this.name = "StorageReadError"; }
}
export class StorageConfigurationError extends Error {
  constructor(public readonly category: "storage_unconfigured" | "private_key_unconfigured") {
    super(category === "private_key_unconfigured" ? "Private document storage requires JWT_SECRET" : "Document storage is not configured on this server");
    this.name = "StorageConfigurationError";
  }
}
/** Exact SDK names/statuses only. Never inspect or copy error messages/stacks. */
export function classifyStorageFailure(error: unknown): StorageReadCategory {
  if (error instanceof StorageReadError) return error.category;
  if (error instanceof StorageConfigurationError) return "storage_unconfigured";
  if (!error || typeof error !== "object") return "read_failed";
  const value = error as { name?: unknown; code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const name = value.name;
  const code = value.code;
  const status = value.$metadata?.httpStatusCode;
  if (name === "NoSuchKey" || name === "NotFound" || status === 404) return "missing_file";
  if (name === "AccessDenied" || name === "Forbidden" || status === 403) return "permission_denied";
  if (name === "TimeoutError" || name === "RequestTimeout" || name === "RequestTimeoutException"
    || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || status === 408 || status === 504) return "timeout";
  if (name === "AbortError" || code === "ABORT_ERR" || code === "ERR_ABORTED") return "cancelled";
  return "read_failed";
}

export type AcademyConversionStage = "source_read" | "validate" | "encrypted_write" | "readback_read" | "readback_decrypt" | "readback_verify" | "preparation";
export type AcademyConversionCode = "missing_file" | "permission_denied" | "storage_unconfigured" | "private_key_unconfigured"
  | "timeout" | "cancelled" | "deadline_exceeded" | "oversize" | "total_oversize" | "empty" | "truncated"
  | "unreadable" | "invalid_chunk" | "invalid_metadata" | "invalid_read" | "invalid_pdf" | "invalid_document"
  | "unexpected_write_key" | "decrypt_failed" | "verification_failed" | "source_read_failed" | "write_failed" | "readback_read_failed" | "preparation_failed";

/** Internal failures contain only a fixed code, never provider messages or causes. */
export class AcademyConversionError extends Error {
  constructor(public readonly code: AcademyConversionCode) { super(code); this.name = "AcademyConversionError"; }
}

export function classifyAcademyConversionError(error: unknown, stage: AcademyConversionStage): AcademyConversionCode {
  if (error instanceof AcademyConversionError) return error.code;
  if (error instanceof StorageConfigurationError) return error.category;
  // A local validator/decrypt/hash failure is not an S3 exception, even if an
  // unexpected exception happens to have a provider-like name/status.
  if (stage === "validate") return "invalid_document";
  if (stage === "readback_decrypt") return "decrypt_failed";
  if (stage === "readback_verify") return "verification_failed";
  const category = classifyStorageFailure(error);
  if (category !== "read_failed") return category;
  return stage === "source_read" ? "source_read_failed"
    : stage === "encrypted_write" ? "write_failed"
    : stage === "readback_read" ? "readback_read_failed" : "preparation_failed";
}

export function academyConversionReason(code: AcademyConversionCode, stage: AcademyConversionStage): string {
  const readingCopy = stage === "readback_read";
  const writingCopy = stage === "encrypted_write";
  switch (code) {
    case "missing_file": return writingCopy ? "storage could not find the destination for the private copy"
      : readingCopy ? "the private copy could not be found for verification" : "the original file could not be found in storage";
    case "permission_denied": return writingCopy ? "storage denied permission to write the private copy"
      : readingCopy ? "storage denied permission to read back the private copy" : "storage denied permission to read the original file";
    case "storage_unconfigured": return "server document storage is not configured; contact support";
    case "private_key_unconfigured": return "private storage encryption is not configured on this server; contact support";
    case "timeout": return writingCopy ? "writing the private copy timed out" : readingCopy ? "reading back the private copy timed out" : "reading the original file timed out";
    case "cancelled": return "resource preparation was cancelled";
    case "deadline_exceeded": return "resource preparation exceeded the 120-second save limit";
    case "oversize": return readingCopy ? "the private copy exceeds its verification size limit" : "the original file exceeds the 10 MB limit";
    case "total_oversize": return "the files exceed the 1000 MB total conversion limit";
    case "empty": return readingCopy ? "storage returned an empty private copy" : "the original file is empty";
    case "truncated": return readingCopy ? "storage returned an incomplete private copy" : "storage returned an incomplete original file";
    case "unreadable": return readingCopy ? "storage returned no readable private copy" : "storage returned no readable original file";
    case "invalid_chunk": return readingCopy ? "storage returned invalid private-copy bytes" : "storage returned invalid original-file bytes";
    case "invalid_metadata": return readingCopy ? "storage returned invalid private-copy size metadata" : "storage returned invalid original-file size metadata";
    case "invalid_read": return "the saved storage reference could not be read safely";
    case "invalid_pdf": return "the original file does not have a valid PDF header";
    case "invalid_document": return "the original file could not be validated as its document type";
    case "unexpected_write_key": return "storage did not confirm the expected private copy";
    case "decrypt_failed": return "the private copy could not be decrypted and authenticated";
    case "verification_failed": return "the private copy did not match the original file bytes";
    case "source_read_failed": return "the original file could not be read from storage";
    case "write_failed": return "the encrypted private copy could not be written to storage";
    case "readback_read_failed": return "the private copy could not be read back from storage";
    case "preparation_failed": return "private resource preparation could not be completed";
  }
}

/** The log payload deliberately excludes filenames, keys, URLs, actors/sessions,
 * file contents, raw exceptions and request headers. */
export function logAcademyConversionFailure(code: AcademyConversionCode, stage: AcademyConversionStage, courseId: number, lessonId?: number) {
  console.error("[AcademyConversion]", { code, stage, courseId, ...(lessonId === undefined ? {} : { lessonId }) });
}
