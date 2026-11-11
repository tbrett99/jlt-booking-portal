import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { storageGetDecrypted } from "./storage";
import { TRPCError } from "@trpc/server";
import { assertNotSelfReview, isFullAdmin, requireInstructorCourse } from "./staff-access";
import {
  academyAccess,
  academyAssessmentAttempts,
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

export function registerAcademyDocumentDownloadRoutes(app: Express) {
  app.get("/api/academy/assessment-document/:token", async (req, res) => {
    try {
      const payload = parseToken(String(req.params.token ?? ""));
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!payload || !user || ["cancelled", "paused", "suspended"].includes(String((user as any).portalStatus))) {
        res.status(404).end();
        return;
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
      const body = await storageGetDecrypted(key);
      res.set({
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeDownloadName(name, "academy-assessment-document")}"`,
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
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user || !user.isActive || ["cancelled", "paused", "suspended"].includes(String(user.portalStatus))) {
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
      if (!learner) await requireInstructorCourse(user, upload.courseId);
      const body = await storageGetDecrypted(key);
      res.set({
        "Cache-Control": "private, no-store, max-age=0", "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeDownloadName(lesson?.attachmentName, "academy-resource")}"`,
        "X-Content-Type-Options": "nosniff",
      });
      res.status(200).send(body);
    } catch (error) {
      if (error instanceof TRPCError && ["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(error.code)) {
        if (!res.headersSent) res.status(404).end(); return;
      }
      console.error("[AcademyAttachmentDownload] failed", error);
      if (!res.headersSent) res.status(500).send("Academy resource could not be downloaded");
    }
  });
}
