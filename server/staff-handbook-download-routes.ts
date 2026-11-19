import { createHash } from "node:crypto";
import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { storageGetDecrypted } from "./storage";
import { staffHandbookArticles, staffHandbookResources, staffHandbookRevisions, users } from "../drizzle/schema";
import { canUseStaffHandbook, STAFF_HANDBOOK_FILE_MIMES, STAFF_HANDBOOK_MAX_FILE_BYTES } from "../shared/staff-handbook";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
function resourceIds(value: unknown): number[] {
  try {
    const list: unknown = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(list) && list.length <= 100 && list.every(id => Number.isSafeInteger(id) && id > 0) ? list : [];
  } catch { return []; }
}
async function freshAdmin(db: Database, userId: number): Promise<boolean> {
  const [user] = await db.select({ id: users.id, role: users.role, isActive: users.isActive, portalStatus: users.portalStatus, mustChangePassword: users.mustChangePassword }).from(users).where(eq(users.id, userId)).limit(1);
  return canUseStaffHandbook(user);
}
async function currentResource(db: Database, id: number) {
  const [row] = await db.select({ resource: staffHandbookResources, article: { id: staffHandbookArticles.id, archivedAt: staffHandbookArticles.archivedAt, draftRevisionId: staffHandbookArticles.draftRevisionId, publishedRevisionId: staffHandbookArticles.publishedRevisionId } })
    .from(staffHandbookResources).innerJoin(staffHandbookArticles, eq(staffHandbookArticles.id, staffHandbookResources.articleId)).where(eq(staffHandbookResources.id, id)).limit(1);
  if (!row || row.resource.removedAt || row.article.archivedAt || !STAFF_HANDBOOK_FILE_MIMES.some(mime => mime === row.resource.mimeType) || !Number.isSafeInteger(row.resource.byteSize) || row.resource.byteSize < 1 || row.resource.byteSize > STAFF_HANDBOOK_MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(row.resource.sha256)) return null;
  const prefix = `staff-handbook/${row.article.id}/`;
  if (!row.resource.fileKey.startsWith(prefix) || row.resource.fileKey.length > 600 || /[\\\x00-\x20?#]/.test(row.resource.fileKey) || row.resource.fileKey.split("/").some(part => !part || part === "." || part === "..")) return null;
  const ids = [row.article.draftRevisionId, row.article.publishedRevisionId].filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
  if (!ids.length) return null;
  const revisions = await db.select({ id: staffHandbookRevisions.id, articleId: staffHandbookRevisions.articleId, resourceIds: staffHandbookRevisions.resourceIds }).from(staffHandbookRevisions).where(and(eq(staffHandbookRevisions.articleId, row.article.id), inArray(staffHandbookRevisions.id, ids))).limit(2);
  if (!revisions.some(revision => revision.articleId === row.article.id && ids.includes(revision.id) && resourceIds(revision.resourceIds).includes(id))) return null;
  return row.resource;
}
export function registerStaffHandbookDownloadRoutes(app: Express) {
  app.get("/api/staff-handbook/resource/:resourceId", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    try {
      const rawId = String(req.params.resourceId ?? "");
      if (!/^[1-9]\d{0,14}$/.test(rawId)) { res.status(404).end(); return; }
      const id = Number(rawId);
      const account = await sdk.authenticateRequest(req).catch(() => null);
      if (!Number.isSafeInteger(id) || !canUseStaffHandbook(account)) { res.status(404).end(); return; }
      const db = await getDb();
      if (!db) { res.status(503).send("Internal document service is temporarily unavailable."); return; }
      if (!await freshAdmin(db, account!.id)) { res.status(404).end(); return; }
      const resource = await currentResource(db, id);
      if (!resource) { res.status(404).end(); return; }
      const body = await storageGetDecrypted(resource.fileKey);
      // A slow storage request cannot preserve access after account revocation,
      // archive, attachment removal or replacement of the current snapshots.
      if (!await freshAdmin(db, account!.id)) { res.status(404).end(); return; }
      const current = await currentResource(db, id);
      if (!current || current.articleId !== resource.articleId || current.fileKey !== resource.fileKey || current.sha256 !== resource.sha256 || current.byteSize !== resource.byteSize || current.mimeType !== resource.mimeType || body.length !== current.byteSize || createHash("sha256").update(body).digest("hex") !== current.sha256) { res.status(404).end(); return; }
      const name = current.fileName.replace(/[\\/\r\n"\x00-\x1f\x7f]/g, "-").trim().slice(0,255) || "handbook-document";
      const asciiName = name.replace(/[^\x20-\x7e]/g, "_");
      const encodedName = encodeURIComponent(name).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      res.setHeader("Content-Type", current.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);
      res.setHeader("Content-Length", String(body.length));
      res.end(body);
    } catch {
      // Never expose object keys, document text, account details or storage errors.
      res.status(503).send("Internal document service is temporarily unavailable.");
    }
  });
}
