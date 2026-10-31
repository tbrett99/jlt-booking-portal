import { randomUUID } from "node:crypto";

export const MAX_ACADEMY_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const academyDocumentMimeTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type AcademyDocumentMimeType = typeof academyDocumentMimeTypes[number];

const extensionByMime: Record<AcademyDocumentMimeType, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

export function safeAcademyDocumentName(name: string) {
  const trimmed = name.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/\s+/g, " ").replace(/^[-. ]+|[-. ]+$/g, "");
  return safe || "academy-assessment-document";
}

export function isAcademyDocumentMimeType(value: string): value is AcademyDocumentMimeType {
  return (academyDocumentMimeTypes as readonly string[]).includes(value);
}

export function validateAcademyDocument(params: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}) {
  const name = safeAcademyDocumentName(params.fileName);
  if (!isAcademyDocumentMimeType(params.mimeType)) {
    throw new Error("Assessment documents must be a PDF, Word document (.docx) or Excel workbook (.xlsx)");
  }
  if (!params.bytes.length || params.bytes.length > MAX_ACADEMY_DOCUMENT_BYTES) {
    throw new Error("Assessment documents must be under 10 MB");
  }
  const expectedExtension = extensionByMime[params.mimeType];
  if (!name.toLowerCase().endsWith(expectedExtension)) {
    throw new Error(`The selected file must use the ${expectedExtension} extension for its document type`);
  }
  const isPdf = params.mimeType === "application/pdf";
  const hasExpectedHeader = isPdf
    ? params.bytes.subarray(0, 5).toString("ascii") === "%PDF-"
    : params.bytes.subarray(0, 2).toString("ascii") === "PK";
  if (!hasExpectedHeader) {
    throw new Error(isPdf ? "This PDF could not be validated" : "This Office document could not be validated");
  }
  return { name, mimeType: params.mimeType, size: params.bytes.length } as const;
}

export function academyDocumentObjectKey(scope: "templates" | "submissions", parts: Array<string | number>, fileName: string) {
  const safeName = safeAcademyDocumentName(fileName);
  return ["academy", "document-assessments", scope, ...parts.map(String), `${randomUUID()}-${safeName}`].join("/");
}
