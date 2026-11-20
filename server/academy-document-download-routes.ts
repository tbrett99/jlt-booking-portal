import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { storageGetDecrypted } from "./storage";
import { TRPCError } from "@trpc/server";
import { assertNotSelfReview, isFullAdmin, requireInstructorCourse } from "./staff-access";
import { getBusinessStaffAuthority } from "./business-staff-access";
import { isAcademyPdfResource } from "../shared/academy-pdf";
import { isAcceleratorWeekAvailable } from "./academy-journey";
import { requireAcademyLearnerResourceAccess } from "./academy-first-class-access";
import {
  academyAccess,
  academyAssessmentAttempts,
  academyCourses,
  academyEnrollments,
  academyLessons,
  academyModules,
  staffAcademyUploads,
} from "../drizzle/schema";

type DocumentKind = "template" | "submission";
type DownloadScope = "agent" | "staff";
type DownloadPayload = {
  version: 1;
  kind: DocumentKind;
  scope: DownloadScope;
  userId: number;
  enrollmentId: number;
  lessonId: number;
  attemptId?: number;
  expiresAt: number;
};

const tokenSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Document download signing is not configured");
  return secret;
};

function sign(encodedPayload: string) {
  return createHmac("sha256", tokenSecret()).update(encodedPayload).digest("base64url");
}

export function createAcademyDocumentDownloadUrl(payload: Omit<DownloadPayload, "version" | "expiresAt">, origin: string) {
  const signed: DownloadPayload = { ...payload, version: 1, expiresAt: Date.now() + 5 * 60 * 1000 };
  const encoded = Buffer.from(JSON.stringify(signed)).toString("base64url");
  return `${origin.replace(/\/+$/, "")}/api/academy/assessment-document/${encoded}.${sign(encoded)}`;
}

function parseToken(token: string): DownloadPayload | null {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = sign(encoded);
  if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DownloadPayload;
    if (payload.version !== 1 || !["template", "submission"].includes(payload.kind) || !["agent", "staff"].includes(payload.scope)) return null;
    if (![payload.userId, payload.enrollmentId, payload.lessonId].every((id) => Number.isSafeInteger(id) && id > 0) || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt < Date.now()) return null;
    if (payload.kind === "submission" && !Number.isSafeInteger(payload.attemptId)) return null;
    return payload;
  } catch {
    return null;
  }
}

function safeDownloadName(name: string | null | undefined, fallback: string) {
  const candidate = (name ?? fallback).replace(/[\\/\r\n"]/g, "-").trim();
  return candidate || fallback;
}

/** Recognition is not authorization: additionally pin public sources to this provider. */
export function isCanonicalAcademyPdfAttachment(resource: { attachmentUrl?: string | null; attachmentKey?: string | null }) {
  if (!isAcademyPdfResource(resource)) return false;
  const key = resource.attachmentKey!;
  const privateUrl = `https://portal.thejltgroup.co.uk/api/academy/course-attachment/${encodeURIComponent(key)}`;
  if (resource.attachmentUrl === privateUrl) return true;
  const base = process.env.S3_PUBLIC_URL?.replace(/\/+$/, "");
  return !!base && resource.attachmentUrl === `${base}/${key}`;
}

export function isMissingAcademyPdfColumn(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const item = current as { code?: string; message?: string; sqlMessage?: string; cause?: unknown; errors?: unknown[] };
    // Match the named missing column, not a failed SELECT listing all columns.
    if (/unknown column\s+['`\"](?:academy_lessons\.)?embedPdf['`\"]/i.test(item.sqlMessage ?? item.message ?? "")) return true;
    if (item.cause) pending.push(item.cause);
    if (item.errors) pending.push(...item.errors);
  }
  return false;
}

export function registerAcademyDocumentDownloadRoutes(app: Express) {
  app.get("/api/academy/assessment-document/:token", async (req, res) => {
    try {
      // Authorization encloses token/session, grants, course and file binding;
      // rerun it after storage so a previously minted token is not an entitlement.
      const authorize = async () => {
      const payload = parseToken(String(req.params.token ?? ""));
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!payload || !user || !user.isActive || ["cancelled", "paused", "suspended"].includes(String((user as any).portalStatus))) {
        res.status(404).end();
        return;
      }
      const businessAuthority = await getBusinessStaffAuthority(user);
      if (businessAuthority.managed && (!businessAuthority.active || !businessAuthority.membership?.permissions.academyAccess || payload.scope !== "agent")) {
        res.status(404).end(); return;
      }
      const isStaff = isFullAdmin(user);
      if (payload.scope === "staff") {
        if (user.id !== payload.userId) {
          res.status(404).end();
          return;
        }
      } else if (user.id !== payload.userId || isStaff) {
        // Agent tokens are intentionally bound to the individual learner. Staff
        // use their own staff token so there is no accidental role crossover.
        res.status(404).end();
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(503).send("Document service is temporarily unavailable");
        return;
      }
      const [enrollmentRow] = await db.select({
        enrollment: { id: academyEnrollments.id, agentId: academyEnrollments.agentId, courseId: academyEnrollments.courseId },
        lesson: { id: academyLessons.id, assessmentMode: academyLessons.assessmentMode, archivedAt: academyLessons.archivedAt },
      }).from(academyEnrollments)
        .innerJoin(academyLessons, eq(academyLessons.id, payload.lessonId))
        .innerJoin(academyModules, and(eq(academyModules.id, academyLessons.moduleId), eq(academyModules.courseId, academyEnrollments.courseId)))
        .where(eq(academyEnrollments.id, payload.enrollmentId)).limit(1);
      if (!enrollmentRow || enrollmentRow.lesson.assessmentMode !== "document_upload") {
        res.status(404).end();
        return;
      }
      if (payload.scope === "agent") {
        // Recheck visibility at download time; an already-minted token must
        // not keep an archived lesson available to its learner.
        if (enrollmentRow.lesson.archivedAt != null) {
          res.status(404).end();
          return;
        }
        const [access] = await db.select({ status: academyAccess.status }).from(academyAccess)
          .where(eq(academyAccess.agentId, user.id)).limit(1);
        if (enrollmentRow.enrollment.agentId !== user.id || access?.status !== "active") {
          res.status(404).end();
          return;
        }
        await requireAcademyLearnerResourceAccess(user.id, enrollmentRow.enrollment.id, enrollmentRow.lesson.id);
      }
      if (payload.scope === "staff") {
        await requireInstructorCourse(user, enrollmentRow.enrollment.courseId);
        assertNotSelfReview(user, enrollmentRow.enrollment.agentId);
      }

      let key: string | null = null;
      let name: string | null = null;
      let mimeType: string | null = null;
      if (payload.kind === "template") {
        if (payload.scope === "staff" && payload.attemptId) {
          const [attempt] = await db.select().from(academyAssessmentAttempts)
            .where(and(
              eq(academyAssessmentAttempts.id, payload.attemptId),
              eq(academyAssessmentAttempts.enrollmentId, enrollmentRow.enrollment.id),
              eq(academyAssessmentAttempts.lessonId, enrollmentRow.lesson.id),
            )).limit(1);
          if (!attempt) {
            res.status(404).end();
            return;
          }
          key = attempt.assessmentTemplateKey;
          name = attempt.assessmentTemplateName;
          mimeType = attempt.assessmentTemplateMimeType;
        } else {
          const [template] = await db.select({
            key: academyLessons.assessmentTemplateKey, name: academyLessons.assessmentTemplateName,
            mimeType: academyLessons.assessmentTemplateMimeType,
          }).from(academyLessons).where(eq(academyLessons.id, enrollmentRow.lesson.id)).limit(1);
          key = template?.key ?? null;
          name = template?.name ?? null;
          mimeType = template?.mimeType ?? null;
        }
      } else {
        const [attempt] = await db.select().from(academyAssessmentAttempts)
          .where(and(
            eq(academyAssessmentAttempts.id, payload.attemptId!),
            eq(academyAssessmentAttempts.enrollmentId, enrollmentRow.enrollment.id),
            eq(academyAssessmentAttempts.lessonId, enrollmentRow.lesson.id),
          )).limit(1);
        if (!attempt) {
          res.status(404).end();
          return;
        }
        key = attempt.submissionFileKey;
        name = attempt.submissionFileName;
        mimeType = attempt.submissionMimeType;
      }
      if (!key) {
        res.status(404).end();
        return;
      }
      return { key, name, mimeType, userId: user.id };
      };
      const resource = await authorize();
      if (!resource) return;
      const body = await storageGetDecrypted(resource.key);
      const refreshed = await authorize();
      if (!refreshed) return;
      if (refreshed.key !== resource.key || refreshed.userId !== resource.userId) { res.status(404).end(); return; }
      res.set({
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": refreshed.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeDownloadName(refreshed.name, "academy-assessment-document")}"`,
        "X-Content-Type-Options": "nosniff",
      });
      res.status(200).send(body);
    } catch (error) {
      if (error instanceof TRPCError && ["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(error.code)) {
        if (!res.headersSent) res.status(404).end();
        return;
      }
      console.error("[AcademyDocumentDownload] failed", error);
      if (!res.headersSent) res.status(500).send("Assessment document could not be downloaded");
    }
  });

  // Instructor-created attachments are encrypted at rest, unlike historical
  // global-admin public attachments. Possessing this URL grants no access.
  app.get("/api/academy/course-attachment/:objectKey", async (req, res) => {
    try {
      if (req.query?.view === "inline") {
        res.set({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" });
        const key = String(req.params.objectKey ?? "");
        const requestedId = req.query.lessonId;
        const lessonId = typeof requestedId === "string" && /^[1-9]\d*$/.test(requestedId) ? Number(requestedId) : NaN;
        if (!Number.isSafeInteger(lessonId)) { res.status(404).end(); return; }
        const db = await getDb();
        if (!db) { res.status(503).send("Document service is temporarily unavailable"); return; }
        // Run the same checks again after storage: no stale session, grant,
        // archived lesson, disabled flag or replaced file can release the body.
        const authorize = async () => {
          const user = await sdk.authenticateRequest(req).catch(() => null);
          if (!user || user.isActive !== true || ["cancelled", "paused", "suspended"].includes(String(user.portalStatus))) return null;
          const authority = await getBusinessStaffAuthority(user);
          if (authority.managed && (!authority.active || !authority.membership?.permissions.academyAccess)) return null;
          const [upload] = await db.select({ courseId: staffAcademyUploads.courseId }).from(staffAcademyUploads)
            .where(and(eq(staffAcademyUploads.objectKey, key), eq(staffAcademyUploads.kind, "attachment"))).limit(1);
          if (!upload) return null;
          const [row] = await db.select({ lesson: academyLessons, module: academyModules, course: academyCourses }).from(academyLessons)
            .innerJoin(academyModules, eq(academyModules.id, academyLessons.moduleId))
            .innerJoin(academyCourses, eq(academyCourses.id, academyModules.courseId))
            .where(and(eq(academyLessons.id, lessonId), eq(academyLessons.attachmentKey, key), eq(academyModules.courseId, upload.courseId), isNull(academyLessons.archivedAt))).limit(1);
          if (!row || row.lesson.embedPdf !== true || !isCanonicalAcademyPdfAttachment(row.lesson)
            || row.lesson.attachmentUrl !== `https://portal.thejltgroup.co.uk/api/academy/course-attachment/${encodeURIComponent(key)}`) return null;
          if (!authority.managed) {
            try {
              await requireInstructorCourse(user, upload.courseId);
              return ["draft", "published"].includes(row.course.status) ? { ...row.lesson, userId: user.id } : null;
            } catch (error) {
              if (!(error instanceof TRPCError) || !["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(error.code)) throw error;
            }
          }
          if (row.course.status !== "published") return null;
          const [enrollment] = await db.select({ id: academyEnrollments.id, journeyStartedAt: academyEnrollments.journeyStartedAt }).from(academyEnrollments)
            .innerJoin(academyAccess, and(eq(academyAccess.agentId, academyEnrollments.agentId), eq(academyAccess.status, "active")))
            .where(and(eq(academyEnrollments.agentId, user.id), eq(academyEnrollments.courseId, upload.courseId), inArray(academyEnrollments.status, ["assigned", "in_progress", "completed", "waived"]))).limit(1);
          if (!enrollment || (row.course.isAcceleratorJourney && !isAcceleratorWeekAvailable(enrollment.journeyStartedAt, row.module.releaseWeek))) return null;
          await requireAcademyLearnerResourceAccess(user.id, enrollment.id, lessonId);
          return { ...row.lesson, userId: user.id };
        };
        const lesson = await authorize();
        if (!lesson) { res.status(404).end(); return; }
        let body: Buffer;
        try { body = await storageGetDecrypted(key); }
        catch { res.status(404).end(); return; } // Never treat public/plain/invalid private objects as PDFs.
        if (!Buffer.isBuffer(body) || body.subarray(0, 5).toString("ascii") !== "%PDF-") { res.status(404).end(); return; }
        const refreshed = await authorize();
        if (!refreshed || refreshed.userId !== lesson.userId) { res.status(404).end(); return; }
        res.set({
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeDownloadName(refreshed.attachmentName, "academy-resource.pdf")}"`,
          "Content-Security-Policy": "frame-ancestors 'self'",
          "X-Frame-Options": "SAMEORIGIN",
        });
        res.status(200).send(body);
        return;
      }
      const authorize = async () => {
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user || !user.isActive || ["cancelled", "paused", "suspended"].includes(String(user.portalStatus))) {
        res.status(404).end(); return;
      }
      const businessAuthority = await getBusinessStaffAuthority(user);
      if (businessAuthority.managed && (!businessAuthority.active || !businessAuthority.membership?.permissions.academyAccess)) {
        res.status(404).end(); return;
      }
      const db = await getDb();
      if (!db) { res.status(503).send("Document service is temporarily unavailable"); return; }
      const key = String(req.params.objectKey ?? "");
      const [upload] = await db.select({ courseId: staffAcademyUploads.courseId }).from(staffAcademyUploads)
        .where(and(eq(staffAcademyUploads.objectKey, key), eq(staffAcademyUploads.kind, "attachment"))).limit(1);
      if (!upload) { res.status(404).end(); return; }
      const lessons = await db.select({ id: academyLessons.id, attachmentName: academyLessons.attachmentName, archivedAt: academyLessons.archivedAt }).from(academyLessons)
        .innerJoin(academyModules, eq(academyModules.id, academyLessons.moduleId))
        .where(and(eq(academyLessons.attachmentKey, key), eq(academyModules.courseId, upload.courseId)));
      // A resource may legitimately be reused in another active lesson.
      const lesson = lessons.find((item) => item.archivedAt == null) ?? lessons[0];
      // Keep an instructor's personal learner route independent of their grant.
      const [learner] = lesson && lesson.archivedAt == null ? await db.select({ id: academyEnrollments.id }).from(academyEnrollments)
        .innerJoin(academyAccess, and(eq(academyAccess.agentId, academyEnrollments.agentId), eq(academyAccess.status, "active")))
        .where(and(eq(academyEnrollments.agentId, user.id), eq(academyEnrollments.courseId, upload.courseId))).limit(1) : [];
      if (businessAuthority.managed && !learner) { res.status(404).end(); return; }
      if (learner && !isFullAdmin(user)) {
        // Reused resources are visible only if at least one active owning lesson
        // is released and unlocked. A locked first reference cannot grant access.
        let permitted = false;
        for (const candidate of lessons.filter(item => item.archivedAt == null)) {
          try { await requireAcademyLearnerResourceAccess(user.id, learner.id, candidate.id); permitted = true; break; }
          catch (error) {
            if (!(error instanceof TRPCError) || !["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(error.code)) throw error;
          }
        }
        if (!permitted) {
          // An assigned instructor can legitimately preview separately from
          // their personal learner membership, but never through employee links.
          if (businessAuthority.managed) { res.status(404).end(); return; }
          await requireInstructorCourse(user, upload.courseId);
        }
      } else await requireInstructorCourse(user, upload.courseId);
      return { key, lesson, userId: user.id };
      };
      const resource = await authorize();
      if (!resource) return;
      const body = await storageGetDecrypted(resource.key);
      const refreshed = await authorize();
      if (!refreshed) return;
      if (refreshed.key !== resource.key || refreshed.userId !== resource.userId) { res.status(404).end(); return; }
      res.set({
        "Cache-Control": "private, no-store, max-age=0", "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeDownloadName(refreshed.lesson?.attachmentName, "academy-resource")}"`,
        "X-Content-Type-Options": "nosniff",
      });
      res.status(200).send(body);
    } catch (error) {
      if (error instanceof TRPCError && ["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(error.code)) {
        if (!res.headersSent) res.status(404).end(); return;
      }
      console.error("[AcademyAttachmentDownload] failed", error);
      if (isMissingAcademyPdfColumn(error)) {
        if (!res.headersSent) res.status(503).send("Academy PDF storage is not ready. Apply the Academy PDF lesson database update.");
        return;
      }
      if (!res.headersSent) res.status(500).send("Academy resource could not be downloaded");
    }
  });
}
