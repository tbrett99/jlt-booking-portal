import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { bookingDocuments, notes, reimbursementItemDocs, reimbursementItems } from "../drizzle/schema";
import { createHash } from "node:crypto";
import { sdk } from "./_core/sdk";
import { getBookingById, getDb } from "./db";
import { getBusinessStaffAuthority } from "./business-staff-access";
import { assertBookingActorAccess, getBookingActorScope, withBookingActorWrite } from "./business-staff-booking-scope";
import { storageGetDecrypted, storagePutEncrypted } from "./storage";
import { nanoid } from "nanoid";
import { isAllowedMimeType } from "../shared/uploadValidation";
import type { BookingScopeContext } from "./business-staff-booking-scope";

// Only these server-issued namespaces hold shared, encrypted booking material.
// Message receipts use the existing booking_documents table, not a new channel.
export const SHARED_BOOKING_DOCUMENT_PREFIX = "booking-private/shared-documents";
export const SHARED_BOOKING_MESSAGE_PREFIX = "booking-private/shared-messages";
export const BOOKING_DOCUMENT_CLOUDFRONT_ORIGIN = "https://d2xsxph8kpxj0f.cloudfront.net";
export const BOOKING_DOCUMENT_TENANT_PREFIX = "310419663026820811/PdcDVQRp8zC2FzsyWBWptW";

type DocumentMetadata = { id: number; bookingId: number; fileKey: string; fileUrl: string; mimeType?: string | null; displayName?: string | null };
export const bookingDocumentDownloadUrl = (id: number) => `/api/booking-documents/${id}/download`;

/** Staff receipts never accept a caller's object key or an already-uploaded URL. */
export async function uploadPrivateStaffBookingDocument<T>(
  ctx: BookingScopeContext,
  input: { bookingId: number; fileBase64: string; fileName: string; mimeType: string },
  register: (writer: any, doc: { id: number; fileKey: string; url: string }) => Promise<T>,
) {
  const scope = await getBookingActorScope(ctx, "operate");
  if (!scope.managed) throw new TRPCError({ code: "FORBIDDEN" });
  const booking = await getBookingById(input.bookingId);
  if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
  await assertBookingActorAccess(ctx, booking, "operate");
  if (!isAllowedMimeType(input.mimeType, input.fileName)) throw new TRPCError({ code: "BAD_REQUEST", message: "This document type is not allowed." });
  const buffer = Buffer.from(input.fileBase64, "base64");
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Document must contain 1 byte to 20 MB." });
  const key = `${SHARED_BOOKING_DOCUMENT_PREFIX}/${input.bookingId}/${nanoid(24)}.enc`;
  await storagePutEncrypted(key, buffer);
  return withBookingActorWrite(ctx, input.bookingId, async writer => {
    const result = await writer.insert(bookingDocuments).values({ bookingId: input.bookingId, uploadedById: ctx.user!.id, uploadedByName: ctx.user!.name ?? null, docType: "Other", displayName: input.fileName, fileKey: key, fileUrl: "", mimeType: input.mimeType, fileSize: buffer.length });
    const id = Number((result as any)[0]?.insertId ?? (result as any).insertId);
    if (!Number.isSafeInteger(id) || id < 1) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The uploaded document could not be registered." });
    const url = bookingDocumentDownloadUrl(id);
    await writer.update(bookingDocuments).set({ fileUrl: url }).where(eq(bookingDocuments.id, id));
    return register(writer, { id, fileKey: key, url });
  }, "operate", { operation: "booking_document_uploaded" });
}

export function isSharedMessageReceipt(doc: Pick<DocumentMetadata, "fileKey" | "bookingId">) {
  return new RegExp(`^${SHARED_BOOKING_MESSAGE_PREFIX}/${doc.bookingId}/[A-Za-z0-9_-]{12,64}\\.enc$`).test(doc.fileKey);
}
export function isEncryptedBookingDocument(doc: Pick<DocumentMetadata, "fileKey" | "bookingId">) {
  return new RegExp(`^booking-private/shared-(?:documents|messages)/${doc.bookingId}/[A-Za-z0-9_-]{12,64}\\.enc$`).test(doc.fileKey);
}

// Validate raw syntax BEFORE URL parsing: URL() silently normalises dot paths.
function strictAbsoluteUrl(value: string): URL | null {
  if (typeof value !== "string" || value.trim() !== value || /[\\\x00-\x20\x7f]/.test(value)) return null;
  if (/%(?![0-9a-f]{2})/i.test(value) || /%(?:25|2e|2f|5c|00)/i.test(value)) return null;
  const rawPath = value.replace(/^https:\/\/[^/]+/, "").split(/[?#]/, 1)[0];
  if (rawPath.split("/").some(part => part === "." || part === "..")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) return null;
    if (url.pathname.split("/").some(part => part === "." || part === ".." || /[\\\x00-\x1f\x7f]/.test(decodeURIComponent(part)))) return null;
    return url;
  } catch { return null; }
}

/** A row's original provider is authoritative. Never search for an R2 replacement. */
export function canonicalBookingDocumentProvider(doc: Pick<DocumentMetadata, "fileUrl" | "fileKey">): { kind: "cloudfront" | "public-r2"; url: string } | null {
  const url = strictAbsoluteUrl(doc.fileUrl);
  if (!url) return null;
  if (url.origin === BOOKING_DOCUMENT_CLOUDFRONT_ORIGIN) {
    const prefix = `/${BOOKING_DOCUMENT_TENANT_PREFIX}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const key = url.pathname.slice(prefix.length);
    if (!key || key.split("/").some(part => !part)) return null;
    // Preserve a legitimate encoded filename while deriving a fixed upstream.
    const canonicalPath = key.split("/").map(part => encodeURIComponent(decodeURIComponent(part))).join("/");
    return { kind: "cloudfront", url: `${BOOKING_DOCUMENT_CLOUDFRONT_ORIGIN}${prefix}${canonicalPath}` };
  }
  const base = process.env.S3_PUBLIC_URL ? strictAbsoluteUrl(process.env.S3_PUBLIC_URL.replace(/\/+$/, "")) : null;
  const r2Prefix = base ? `${base.pathname.replace(/\/+$/, "")}/` : "";
  if (base && url.origin === base.origin && url.pathname.startsWith(r2Prefix) && url.pathname !== r2Prefix) {
    // Existing public plaintext objects stay public; this route cannot privatise them.
    return { kind: "public-r2", url: url.href };
  }
  return null;
}

/** Staff cannot turn arbitrary links (or another booking's receipt) into attachments. */
export async function assertSharedBookingAttachmentReferences(content: string, bookingId: number, writer?: any) {
  if (/\/api\/doc-proxy(?:\?|\b)/i.test(content)) throw new TRPCError({ code: "FORBIDDEN", message: "Use a registered shared booking attachment." });
  const matches = Array.from(content.matchAll(/\[Attachment:[^\]]+\]\(([^)]+)\)/g));
  const embedded = Array.from(content.matchAll(/\/api\/booking-documents\/[^\s)]+/g)).map(match => match[0]);
  const urls = Array.from(new Set([...matches.map(match => match[1]), ...embedded]));
  if (!urls.length) return;
  const db = writer ?? await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  for (const url of urls) {
    const match = /^\/api\/booking-documents\/([1-9]\d*)\/download$/.exec(url);
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new TRPCError({ code: "FORBIDDEN", message: "Use a registered shared booking attachment." });
    const [doc] = await db.select({ id: bookingDocuments.id, bookingId: bookingDocuments.bookingId, fileKey: bookingDocuments.fileKey, fileUrl: bookingDocuments.fileUrl })
      .from(bookingDocuments).where(and(eq(bookingDocuments.id, Number(match[1])), eq(bookingDocuments.bookingId, bookingId))).limit(1);
    if (!doc || doc.bookingId !== bookingId || !isEncryptedBookingDocument(doc) || doc.fileUrl !== bookingDocumentDownloadUrl(doc.id)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "This attachment is not registered to this shared booking." });
    }
  }
}

/** Rewrite only URLs already registered as shared booking documents; never launder links. */
export async function sharedBookingNoteAttachments<T extends { content: string; id?: number }>(rows: T[], bookingId: number): Promise<T[]> {
  if (!rows.some(row => row.content.includes("[Attachment:"))) return rows;
  const db = await getDb();
  if (!db) return rows;
  const docs = await db.select({ id: bookingDocuments.id, bookingId: bookingDocuments.bookingId, fileKey: bookingDocuments.fileKey, fileUrl: bookingDocuments.fileUrl })
    .from(bookingDocuments).where(eq(bookingDocuments.bookingId, bookingId));
  const urls = new Map(docs.filter(doc => isEncryptedBookingDocument(doc) || canonicalBookingDocumentProvider(doc)).map(doc => [doc.fileUrl, bookingDocumentDownloadUrl(doc.id)]));
  return rows.map(row => {
    let index = -1;
    return { ...row, content: row.content.replace(/(\[Attachment:[^\]]+\]\()([^)]+)(\))/g, (full, before, url, after) => {
      index++;
      if (urls.has(url)) return `${before}${urls.get(url)}${after}`;
      if (Number.isSafeInteger(row.id) && row.id! > 0 && canonicalBookingDocumentProvider({ fileUrl: url, fileKey: "" })) return `${before}${sharedBookingAttachmentUrl("message", row.id!, index, url)}${after}`;
      return full;
    }) };
  });
}

function safeName(name: string | null | undefined) {
  return (name || "booking-document").replace(/[^\x20-\x7e]|[\\/";]/g, "-").slice(0, 180) || "booking-document";
}

/** Legacy key-only proxy remains unavailable to business staff. */
export function registerLegacyBookingDocumentProxy(app: Express) {
  app.get("/api/doc-proxy", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user || user.id < 1 || user.isActive !== true || ["cancelled", "paused", "suspended"].includes(String(user.portalStatus))) { res.status(401).end(); return; }
      const authority = await getBusinessStaffAuthority(user);
      if (authority.managed) { res.status(403).json({ error: "Business staff cannot use the legacy document proxy." }); return; }
      const key = req.query.key;
      if (typeof key !== "string" || !key || /[\\\x00-\x20\x7f?#]/.test(key) || key.startsWith("/") || key.split("/").some(part => !part || part === "." || part === "..")) { res.status(400).end(); return; }
      const fullKey = key.startsWith(`${BOOKING_DOCUMENT_TENANT_PREFIX}/`) ? key : `${BOOKING_DOCUMENT_TENANT_PREFIX}/${key}`;
      const provider = canonicalBookingDocumentProvider({ fileUrl: `${BOOKING_DOCUMENT_CLOUDFRONT_ORIGIN}/${fullKey}`, fileKey: key });
      if (!provider || provider.kind !== "cloudfront") { res.status(400).end(); return; }
      const headers: Record<string, string> = {};
      if (process.env.BUILT_IN_FORGE_API_KEY) headers["X-Api-Key"] = process.env.BUILT_IN_FORGE_API_KEY;
      const upstream = await fetch(provider.url, { headers, redirect: "manual" });
      if (upstream.status >= 300 && upstream.status < 400) { res.status(502).end(); return; }
      if (!upstream.ok) { res.status(upstream.status).end(); return; }
      const body = Buffer.from(await upstream.arrayBuffer());
      res.set({ "Content-Type": upstream.headers.get("content-type") || "application/octet-stream", "Content-Disposition": `attachment; filename="${safeName(key.split("/").pop())}"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" });
      res.status(200).send(body);
    } catch { if (!res.headersSent) res.status(500).end(); }
  });
}

export function registerBookingDocumentDownloadRoutes(app: Express) {
  registerSharedBookingAttachmentDownloadRoutes(app);
  app.get("/api/booking-documents/:id/download", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user || user.id < 1 || user.isActive !== true || !["agent", "admin", "super_admin"].includes(user.role) || ["cancelled", "paused", "suspended"].includes(String(user.portalStatus))) { res.status(401).end(); return; }
      const businessStaffAuthority = await getBusinessStaffAuthority(user);
      const ctx = { user, businessStaffAuthority };
      await getBookingActorScope(ctx, "read");
      const id = Number(req.params.id);
      if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id)) { res.status(404).end(); return; }
      const db = await getDb();
      if (!db) { res.status(503).end(); return; }
      const [doc] = await db.select({ id: bookingDocuments.id, bookingId: bookingDocuments.bookingId, fileKey: bookingDocuments.fileKey, fileUrl: bookingDocuments.fileUrl, mimeType: bookingDocuments.mimeType, displayName: bookingDocuments.displayName })
        .from(bookingDocuments).where(eq(bookingDocuments.id, id)).limit(1);
      if (!doc) { res.status(404).end(); return; }
      const booking = await getBookingById(doc.bookingId);
      if (!booking) { res.status(404).end(); return; }
      await assertBookingActorAccess(ctx, booking, "read");
      let body: Buffer;
      if (isEncryptedBookingDocument(doc)) {
        if (doc.fileUrl !== bookingDocumentDownloadUrl(doc.id)) { res.status(404).end(); return; }
        body = await storageGetDecrypted(doc.fileKey);
      } else {
        // A private namespace/key mismatch must never fall back to public signing.
        if (doc.fileKey.startsWith("booking-private/")) { res.status(404).end(); return; }
        const provider = canonicalBookingDocumentProvider(doc);
        if (!provider) { res.status(404).end(); return; }
        if (provider.kind === "public-r2") {
          res.set({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" });
          res.redirect(302, provider.url); return;
        }
        const headers: Record<string, string> = {};
        if (process.env.BUILT_IN_FORGE_API_KEY) headers["X-Api-Key"] = process.env.BUILT_IN_FORGE_API_KEY;
        const upstream = await fetch(provider.url, { headers, redirect: "manual" });
        if (upstream.status >= 300 && upstream.status < 400) { res.status(502).end(); return; }
        if (!upstream.ok) { res.status(502).end(); return; }
        body = Buffer.from(await upstream.arrayBuffer());
      }
      // A slow storage/network read does not keep a revoked staff grant usable.
      const currentBooking = await getBookingById(doc.bookingId);
      if (!currentBooking) { res.status(404).end(); return; }
      await assertBookingActorAccess({ user, businessStaffAuthority: await getBusinessStaffAuthority(user) }, currentBooking, "read");
      res.set({ "Content-Type": doc.mimeType && /^[\w.+-]+\/[\w.+-]+$/.test(doc.mimeType) ? doc.mimeType : "application/octet-stream", "Content-Disposition": `attachment; filename="${safeName(doc.displayName)}"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" });
      res.status(200).send(body);
    } catch (error) {
      if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.code)) { if (!res.headersSent) res.status(403).end(); return; }
      if (!res.headersSent) res.status(500).end();
    }
  });
}

// Normal support messages and legacy item evidence are not always duplicated in
// booking_documents. Bind downloads to their real shared note/item, never to a
// browser-supplied storage key. Existing public files cannot be made private here.
export const sharedBookingAttachmentUrl = (kind: "message" | "reimbursement", id: number, index: number, url: string) =>
  `/api/booking-attachments/${kind}/${id}/${index}/download?fingerprint=${createHash("sha256").update(url).digest("hex")}`;
export function sharedReimbursementAttachmentUrl(doc: { id: number; fileUrl: string; fileKey: string }) {
  return canonicalBookingDocumentProvider(doc) ? sharedBookingAttachmentUrl("reimbursement", doc.id, 0, doc.fileUrl) : doc.fileUrl;
}
async function sharedAttachmentMetadata(kind: "message" | "reimbursement", id: number, index: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  if (kind === "message") {
    const [note] = await db.select({ id: notes.id, bookingId: notes.bookingId, content: notes.content, isInternal: notes.isInternal }).from(notes).where(and(eq(notes.id, id), eq(notes.isInternal, false))).limit(1);
    if (!note || note.isInternal !== false) return null;
    const match = Array.from(note.content.matchAll(/\[Attachment:([^\]]+)\]\(([^)]+)\)/g))[index];
    if (!match) return null;
    const provider = canonicalBookingDocumentProvider({ fileUrl: match[2], fileKey: "" });
    if (!provider) return null;
    return { bookingId: note.bookingId, fileUrl: match[2], fileName: match[1].trim(), provider, itemAgentId: null as number | null };
  }
  if (index !== 0) return null;
  const [doc] = await db.select({ id: reimbursementItemDocs.id, reimbursementItemId: reimbursementItemDocs.reimbursementItemId, bookingId: reimbursementItemDocs.bookingId, fileUrl: reimbursementItemDocs.fileUrl, fileKey: reimbursementItemDocs.fileKey, fileName: reimbursementItemDocs.fileName }).from(reimbursementItemDocs).where(eq(reimbursementItemDocs.id, id)).limit(1);
  if (!doc || doc.fileKey.startsWith("booking-private/")) return null;
  const [item] = await db.select({ bookingId: reimbursementItems.bookingId, agentId: reimbursementItems.agentId }).from(reimbursementItems).where(and(eq(reimbursementItems.id, doc.reimbursementItemId), eq(reimbursementItems.bookingId, doc.bookingId))).limit(1);
  if (!item || item.bookingId !== doc.bookingId) return null;
  const provider = canonicalBookingDocumentProvider(doc);
  return provider ? { bookingId: doc.bookingId, fileUrl: doc.fileUrl, fileName: doc.fileName, provider, itemAgentId: item.agentId } : null;
}
export function registerSharedBookingAttachmentDownloadRoutes(app: Express) {
  app.get("/api/booking-attachments/:kind/:id/:index/download", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user || user.isActive !== true || !["agent", "admin", "super_admin"].includes(user.role) || ["cancelled", "paused", "suspended"].includes(String(user.portalStatus))) { res.status(401).end(); return; }
      const kind = req.params.kind;
      if (!["message", "reimbursement"].includes(kind) || !/^[1-9]\d*$/.test(req.params.id) || !/^(?:0|[1-9]\d?)$/.test(req.params.index) || typeof req.query.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(req.query.fingerprint)) { res.status(404).end(); return; }
      const id = Number(req.params.id), index = Number(req.params.index);
      if (!Number.isSafeInteger(id) || index > 19) { res.status(404).end(); return; }
      const ctx = { user, businessStaffAuthority: await getBusinessStaffAuthority(user) };
      await getBookingActorScope(ctx, "read");
      const metadata = await sharedAttachmentMetadata(kind as "message" | "reimbursement", id, index);
      if (!metadata || createHash("sha256").update(metadata.fileUrl).digest("hex") !== req.query.fingerprint) { res.status(404).end(); return; }
      const booking = await getBookingById(metadata.bookingId);
      if (!booking) { res.status(404).end(); return; }
      await assertBookingActorAccess(ctx, booking, "read");
      if (metadata.itemAgentId !== null && metadata.itemAgentId !== booking.agentId) { res.status(403).end(); return; }
      let body: Buffer | null = null;
      if (metadata.provider.kind === "cloudfront") {
        const headers: Record<string, string> = {};
        if (process.env.BUILT_IN_FORGE_API_KEY) headers["X-Api-Key"] = process.env.BUILT_IN_FORGE_API_KEY;
        const upstream = await fetch(metadata.provider.url, { headers, redirect: "manual" });
        if (!upstream.ok || (upstream.status >= 300 && upstream.status < 400)) { res.status(502).end(); return; }
        body = Buffer.from(await upstream.arrayBuffer());
      }
      const fresh = await sharedAttachmentMetadata(kind as "message" | "reimbursement", id, index);
      const freshBooking = fresh ? await getBookingById(fresh.bookingId) : null;
      if (!fresh || !freshBooking || fresh.bookingId !== metadata.bookingId || fresh.fileUrl !== metadata.fileUrl || fresh.itemAgentId !== metadata.itemAgentId) { res.status(404).end(); return; }
      await assertBookingActorAccess({ user, businessStaffAuthority: await getBusinessStaffAuthority(user) }, freshBooking, "read");
      res.set({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="${safeName(fresh.fileName)}"`, "Content-Type": "application/octet-stream" });
      if (metadata.provider.kind === "public-r2") { res.redirect(302, metadata.provider.url); return; }
      res.status(200).send(body);
    } catch (error) {
      const code = error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.code) ? 403 : 500;
      if (!res.headersSent) res.status(code).end();
    }
  });
}
