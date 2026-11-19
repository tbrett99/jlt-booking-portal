import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { staffHandbookResources as resources } from "../drizzle/schema";
import {
  STAFF_HANDBOOK_FILE_MIMES,
  STAFF_HANDBOOK_MAX_FILE_BYTES,
} from "../shared/staff-handbook";
import { storagePutEncrypted } from "./storage";
import {
  appendRevision,
  bumpArticle,
  getArticle,
  getRevision,
  insertId,
  lockArticle,
  recordAudit,
  revisionContent,
  snapshotIds,
  withHandbookRead,
  withHandbookWrite,
  type ArticleRow,
  type HandbookDb,
} from "./staff-handbook-core";
import {
  assertVersion,
  fail,
  safeHandbookError,
  type HandbookAccount,
} from "./staff-handbook-policy";
export const HANDBOOK_MAX_FILE_BYTES = STAFF_HANDBOOK_MAX_FILE_BYTES;
const FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/csv": "csv",
  "image/png": "png",
  "image/jpeg": "jpg",
};
/** Historical metadata remains visible, but only currently authorized files get URLs. */
export function handbookResourceDto(
  resource: Pick<
    typeof resources.$inferSelect,
    "id" | "fileName" | "mimeType" | "byteSize" | "removedAt"
  >,
  currentResourceIds: number[],
  archivedAt: Date | null
) {
  const available =
    !archivedAt &&
    !resource.removedAt &&
    currentResourceIds.includes(resource.id);
  return {
    id: resource.id,
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    byteSize: resource.byteSize,
    available,
    ...(available
      ? { url: `/api/staff-handbook/resource/${resource.id}` }
      : {}),
  };
}
/** Read bounded ZIP central directory and the actual content-type entry, not a PK-prefix guess. */
function assertOfficeZip(bytes: Buffer, type: "docx" | "xlsx") {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (
    end < 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    fail("BAD_REQUEST", "Invalid Office document.");
  const count = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12),
    start = bytes.readUInt32LE(end + 16);
  if (
    count < 3 ||
    count > 2000 ||
    start + size !== end ||
    end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length
  )
    fail("BAD_REQUEST", "Invalid Office document.");
  const names = new Set<string>();
  let offset = start;
  let totalInflated = 0;
  let contentTypes = "";
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      fail("BAD_REQUEST", "Invalid Office document.");
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10),
      packed = bytes.readUInt32LE(offset + 20),
      unpacked = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28),
      extraLength = bytes.readUInt16LE(offset + 30),
      commentLength = bytes.readUInt16LE(offset + 32),
      local = bytes.readUInt32LE(offset + 42);
    if (
      offset + 46 + nameLength + extraLength + commentLength > end ||
      local + 30 > start ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      flags & 1 ||
      ![0, 8].includes(method)
    )
      fail("BAD_REQUEST", "Invalid Office document.");
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    if (
      names.has(name) ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      /(?:vbaProject|\.exe$|\.dll$|\.js$|\.html?$|\.svg$|embeddings\/)/i.test(
        name
      )
    )
      fail("BAD_REQUEST", "Unsupported Office document payload.");
    names.add(name);
    totalInflated += unpacked;
    const localNameLength = bytes.readUInt16LE(local + 26),
      localExtraLength = bytes.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    if (dataStart + packed > start || totalInflated > 100 * 1024 * 1024)
      fail("BAD_REQUEST", "Office document exceeds safety limits.");
    if (
      bytes
        .subarray(local + 30, local + 30 + localNameLength)
        .toString("utf8") !== name
    )
      fail("BAD_REQUEST", "Invalid Office document.");
    if (name === "[Content_Types].xml") {
      if (unpacked > 262144) fail("BAD_REQUEST", "Invalid Office document.");
      const compressed = bytes.subarray(dataStart, dataStart + packed);
      const xml =
        method === 0
          ? compressed
          : inflateRawSync(compressed, { maxOutputLength: 262144 });
      if (xml.length !== unpacked)
        fail("BAD_REQUEST", "Invalid Office document.");
      contentTypes = new TextDecoder("utf-8", { fatal: true }).decode(xml);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const expectedPart =
    type === "docx" ? "word/document.xml" : "xl/workbook.xml";
  const expectedType =
    type === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  if (
    offset !== end ||
    !names.has("_rels/.rels") ||
    !names.has(expectedPart) ||
    !contentTypes.includes(expectedType) ||
    /macroEnabled|vbaProject/i.test(contentTypes)
  )
    fail(
      "BAD_REQUEST",
      "File signature does not match the Office document type."
    );
}
export function validateHandbookUpload(
  fileName: string,
  fileBase64: string,
  mimeType: string
) {
  const extension = FILE_TYPES[mimeType];
  if (
    !extension ||
    !(STAFF_HANDBOOK_FILE_MIMES as readonly string[]).includes(mimeType) ||
    !fileName.trim() ||
    fileName.length > 255 ||
    /[\x00-\x1f\x7f/\\]/.test(fileName)
  )
    fail("BAD_REQUEST", "Unsupported attachment name or type.");
  const suffix = fileName.toLowerCase().split(".").pop();
  if (
    extension === "jpg"
      ? !["jpg", "jpeg"].includes(suffix ?? "")
      : suffix !== extension
  )
    fail("BAD_REQUEST", "Attachment extension and type must match.");
  if (
    !fileBase64 ||
    fileBase64.length > 4 * Math.ceil(HANDBOOK_MAX_FILE_BYTES / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      fileBase64
    )
  )
    fail("BAD_REQUEST", "Invalid attachment encoding or size.");
  const bytes = Buffer.from(fileBase64, "base64");
  if (
    !bytes.length ||
    bytes.length > HANDBOOK_MAX_FILE_BYTES ||
    bytes.toString("base64") !== fileBase64
  )
    fail("BAD_REQUEST", "Attachment must be between 1 byte and 10 MB.");
  try {
    if (
      extension === "pdf" &&
      (bytes.length < 12 ||
        bytes.subarray(0, 5).toString("ascii") !== "%PDF-" ||
        !bytes
          .subarray(Math.max(0, bytes.length - 1024))
          .includes(Buffer.from("%%EOF")))
    )
      fail("BAD_REQUEST", "Invalid PDF attachment.");
    if (
      extension === "png" &&
      (bytes.length < 33 ||
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.subarray(12, 16).toString("ascii") !== "IHDR")
    )
      fail("BAD_REQUEST", "Invalid PNG attachment.");
    if (
      extension === "jpg" &&
      (bytes.length < 8 ||
        bytes[0] !== 255 ||
        bytes[1] !== 216 ||
        bytes[2] !== 255 ||
        bytes[bytes.length - 2] !== 255 ||
        bytes[bytes.length - 1] !== 217)
    )
      fail("BAD_REQUEST", "Invalid JPEG attachment.");
    if (extension === "txt" || extension === "csv") {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ||
        /^\s*(?:<!doctype\s+html|<html\b|<svg\b|#!)/i.test(text) ||
        bytes.subarray(0, 2).toString("ascii") === "MZ"
      )
        fail("BAD_REQUEST", "Invalid text attachment.");
    }
    if (extension === "docx" || extension === "xlsx")
      assertOfficeZip(bytes, extension);
  } catch (error) {
    if ((error as any)?.code) throw safeHandbookError(error);
    fail("BAD_REQUEST", "Attachment signature does not match its type.");
  }
  return {
    bytes,
    fileName: fileName.trim(),
    mimeType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
async function assertEditable(db: HandbookDb, article: ArticleRow) {
  if (article.archivedAt)
    fail("BAD_REQUEST", "Restore this guide before changing attachments.");
  const draft = await getRevision(db, article.id, article.draftRevisionId);
  if (!draft) fail("BAD_REQUEST", "Save a draft before adding attachments.");
  return draft;
}
export async function retireUnreferencedResources(
  db: HandbookDb,
  articleId: number,
  draftResourceIds: number[],
  publishedResourceIds: number[],
  actorId: number
) {
  const retained = Array.from(
    new Set([...draftResourceIds, ...publishedResourceIds])
  );
  const filter = retained.length
    ? and(
        eq(resources.articleId, articleId),
        isNull(resources.removedAt),
        notInArray(resources.id, retained)
      )
    : and(eq(resources.articleId, articleId), isNull(resources.removedAt));
  for (;;) {
    const batch = await db
      .select({ id: resources.id })
      .from(resources)
      .where(filter)
      .limit(100)
      .for("update");
    if (!batch.length) break;
    await db
      .update(resources)
      .set({ removedAt: new Date() })
      .where(
        inArray(
          resources.id,
          batch.map((r: any) => r.id)
        )
      );
    for (const row of batch)
      await recordAudit(
        db,
        "resource",
        row.id,
        actorId,
        "retired",
        "Private attachment retired after publication.",
        { articleId }
      );
  }
}
export async function uploadHandbookResource(
  actor: HandbookAccount,
  input: {
    articleId: number;
    expectedVersion: number;
    fileName: string;
    fileBase64: string;
    mimeType: string;
  }
) {
  // Permission before CPU-heavy decoding or slow storage; stale/version check before storage too.
  return withHandbookRead(actor, async (db, actorId) => {
    const preflight = await locklessArticlePreflight(
      db,
      input.articleId,
      input.expectedVersion
    );
    await assertEditable(db, preflight);
    const upload = validateHandbookUpload(
      input.fileName,
      input.fileBase64,
      input.mimeType
    );
    let fileKey: string;
    try {
      fileKey = (
        await storagePutEncrypted(
          `staff-handbook/${input.articleId}/${randomUUID()}`,
          upload.bytes
        )
      ).key;
    } catch (error) {
      throw safeHandbookError(error);
    }
    // Storage may succeed but a fresh revocation/version failure deliberately leaves only an
    // encrypted unassociated orphan. No unauthorized resource row or notification is created.
    return withHandbookWrite(actor, async (tx, freshActorId) => {
      const article = await lockArticle(
        tx,
        input.articleId,
        input.expectedVersion
      );
      const draft = await assertEditable(tx, article);
      const ids = snapshotIds(draft.resourceIds);
      if (ids.length >= 100)
        fail("BAD_REQUEST", "This guide has reached its attachment limit.");
      if (!fileKey.startsWith("staff-handbook/"))
        fail("INTERNAL_SERVER_ERROR", "Private attachment storage failed.");
      const resourceId = await insertId(tx, resources, {
        articleId: article.id,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        byteSize: upload.bytes.length,
        sha256: upload.sha256,
        fileKey,
        uploadedById: freshActorId,
      });
      const revisionId = await appendRevision(
        tx,
        article,
        freshActorId,
        revisionContent(draft),
        [...ids, resourceId],
        "Attachment added."
      );
      const result = await bumpArticle(tx, article, {
        draftRevisionId: revisionId,
        reviewedRevisionId: null,
        reviewedById: null,
        submittedAt: null,
      });
      await recordAudit(
        tx,
        "resource",
        resourceId,
        freshActorId,
        "uploaded",
        "Private attachment uploaded.",
        { articleId: article.id, revisionId }
      );
      await recordAudit(
        tx,
        "article",
        article.id,
        freshActorId,
        "resource_added",
        "Private attachment added to draft.",
        { resourceId, revisionId }
      );
      return { ...result, resourceId };
    });
  });
}
async function locklessArticlePreflight(
  db: HandbookDb,
  articleId: number,
  version: number
) {
  const row = await getArticle(db, articleId);
  assertVersion(row.version, version);
  return row;
}
export async function removeHandbookResource(
  actor: HandbookAccount,
  input: { articleId: number; resourceId: number; expectedVersion: number }
) {
  return withHandbookWrite(actor, async (db, actorId) => {
    const article = await lockArticle(
      db,
      input.articleId,
      input.expectedVersion
    );
    const draft = await assertEditable(db, article),
      ids = snapshotIds(draft.resourceIds);
    const [resource] = await db
      .select({ id: resources.id })
      .from(resources)
      .where(
        and(
          eq(resources.id, input.resourceId),
          eq(resources.articleId, article.id),
          isNull(resources.removedAt)
        )
      )
      .limit(1)
      .for("update");
    if (!resource || !ids.includes(input.resourceId))
      fail("NOT_FOUND", "Draft attachment not found.");
    const newIds = ids.filter(id => id !== input.resourceId);
    const revisionId = await appendRevision(
      db,
      article,
      actorId,
      revisionContent(draft),
      newIds,
      "Attachment removed from draft."
    );
    const result = await bumpArticle(db, article, {
      draftRevisionId: revisionId,
      reviewedRevisionId: null,
      reviewedById: null,
      submittedAt: null,
    });
    const published = await getRevision(
      db,
      article.id,
      article.publishedRevisionId
    );
    if (
      !published ||
      !snapshotIds(published.resourceIds).includes(input.resourceId)
    )
      await db
        .update(resources)
        .set({ removedAt: new Date() })
        .where(eq(resources.id, input.resourceId));
    await recordAudit(
      db,
      "resource",
      input.resourceId,
      actorId,
      "removed_from_draft",
      "Private attachment removed from draft.",
      { articleId: article.id, revisionId }
    );
    await recordAudit(
      db,
      "article",
      article.id,
      actorId,
      "resource_removed",
      "Private attachment removed from draft.",
      { resourceId: input.resourceId, revisionId }
    );
    return result;
  });
}
