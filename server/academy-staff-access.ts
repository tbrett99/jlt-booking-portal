import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import type { User } from "../drizzle/schema";
import { academyAssessmentAttempts, academyCourses, academyEnrollments, academyLessons, academyModules, staffAcademyUploads } from "../drizzle/schema";
import { getDb } from "./db";
import { assertNotSelfReview, isFullAdmin, requireInstructorCourse } from "./staff-access";
import { instructorHtmlImageSources } from "./academy-staff-html";

const forbidden = (message = "This Academy item is outside your teaching scope") => new TRPCError({ code: "FORBIDDEN", message });
async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

/** Resolve actual stored parents, never authorize solely by the submitted parent. */
export async function requireAcademyModule(user: User, moduleId: number, expectedCourseId?: number) {
  const db = await database();
  const [module] = await db.select({ id: academyModules.id, courseId: academyModules.courseId })
    .from(academyModules).where(eq(academyModules.id, moduleId)).limit(1);
  if (!module) throw new TRPCError({ code: "NOT_FOUND", message: "Module not found" });
  await requireInstructorCourse(user, module.courseId);
  if (expectedCourseId !== undefined && module.courseId !== expectedCourseId) throw forbidden("Modules cannot be moved between courses");
  return module;
}

export async function requireAcademyLesson(user: User, lessonId: number, expectedModuleId?: number) {
  const db = await database();
  const [lesson] = await db.select({ id: academyLessons.id, moduleId: academyLessons.moduleId })
    .from(academyLessons).where(eq(academyLessons.id, lessonId)).limit(1);
  if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
  const module = await requireAcademyModule(user, lesson.moduleId);
  if (expectedModuleId !== undefined && lesson.moduleId !== expectedModuleId) throw forbidden("Lessons cannot be moved between modules");
  return { ...lesson, courseId: module.courseId };
}

/** Load only relationship IDs before access approval; no answers, files or user profiles. */
export async function requireAcademyAttempt(user: User, attemptId: number) {
  const db = await database();
  const [row] = await db.select({
    id: academyAssessmentAttempts.id,
    enrollmentId: academyEnrollments.id,
    learnerId: academyEnrollments.agentId,
    courseId: academyEnrollments.courseId,
    lessonId: academyLessons.id,
    moduleCourseId: academyModules.courseId,
  }).from(academyAssessmentAttempts)
    .innerJoin(academyEnrollments, eq(academyEnrollments.id, academyAssessmentAttempts.enrollmentId))
    .innerJoin(academyLessons, eq(academyLessons.id, academyAssessmentAttempts.lessonId))
    .innerJoin(academyModules, eq(academyModules.id, academyLessons.moduleId))
    .innerJoin(academyCourses, eq(academyCourses.id, academyModules.courseId))
    .where(eq(academyAssessmentAttempts.id, attemptId)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Assessment submission not found" });
  if (row.courseId !== row.moduleCourseId) throw forbidden("Assessment course relationships are inconsistent");
  await requireInstructorCourse(user, row.courseId);
  assertNotSelfReview(user, row.learnerId);
  return row;
}

export async function requireAcademyUploadCourse(user: User, courseId?: number) {
  if (courseId === undefined) {
    if (!isFullAdmin(user)) throw forbidden("A courseId is required for teaching uploads");
    return;
  }
  await requireInstructorCourse(user, courseId);
  const db = await database();
  const [course] = await db.select({ id: academyCourses.id }).from(academyCourses).where(eq(academyCourses.id, courseId)).limit(1);
  if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
}

export async function rememberAcademyUpload(user: User, courseId: number | undefined, objectKey: string, kind: "attachment" | "document_template" | "image") {
  if (courseId === undefined) return; // Existing global-admin clients remain compatible.
  const db = await database();
  await db.insert(staffAcademyUploads).values({ userId: user.id, courseId, objectKey, kind });
}

export function academyPrivateAttachmentUrl(objectKey: string) {
  return `https://portal.thejltgroup.co.uk/api/academy/course-attachment/${encodeURIComponent(objectKey)}`;
}

export async function assertAcademyUploadKey(user: User, courseId: number, kind: "attachment" | "document_template" | "image", key: string | null | undefined, existingKey?: string | null) {
  if (isFullAdmin(user) || !key || key === existingKey) return;
  const db = await database();
  const [upload] = await db.select({ id: staffAcademyUploads.id, objectKey: staffAcademyUploads.objectKey }).from(staffAcademyUploads).where(and(
    eq(staffAcademyUploads.userId, user.id), eq(staffAcademyUploads.courseId, courseId),
    eq(staffAcademyUploads.kind, kind), eq(staffAcademyUploads.objectKey, key),
  )).limit(1);
  if (!upload || upload.objectKey !== key) throw forbidden("Use this lesson's current file or your own upload for this course");
}

export async function assertAcademyImageUrls(user: User, courseId: number, urls: string[], existingUrls: string[]) {
  if (isFullAdmin(user)) return;
  const newUrls = urls.filter((url) => !existingUrls.includes(url));
  if (!newUrls.length) return;
  const base = process.env.S3_PUBLIC_URL?.replace(/\/+$/, "");
  if (!base || newUrls.some((url) => !url.startsWith(`${base}/`))) throw forbidden("Use an image uploaded for this course");
  const keys = newUrls.map((url) => url.slice(base.length + 1));
  const db = await database();
  const uploads = await db.select({ objectKey: staffAcademyUploads.objectKey }).from(staffAcademyUploads).where(and(
    eq(staffAcademyUploads.userId, user.id), eq(staffAcademyUploads.courseId, courseId),
    eq(staffAcademyUploads.kind, "image"), inArray(staffAcademyUploads.objectKey, keys),
  ));
  if (keys.some((key) => !uploads.some((upload) => upload.objectKey === key))) throw forbidden("Use an image uploaded for this course");
}

export async function assertAcademyLessonFiles(user: User, courseId: number, input: {
  attachmentKey?: string | null; attachmentUrl?: string | null; assessmentTemplateKey?: string | null; contentHtml?: string | null;
}, existing?: { attachmentKey?: string | null; attachmentUrl?: string | null; assessmentTemplateKey?: string | null; contentHtml?: string | null }) {
  if (isFullAdmin(user)) return;
  await assertAcademyUploadKey(user, courseId, "attachment", input.attachmentKey, existing?.attachmentKey);
  await assertAcademyUploadKey(user, courseId, "document_template", input.assessmentTemplateKey, existing?.assessmentTemplateKey);
  if (input.attachmentUrl) {
    const preserved = input.attachmentKey === existing?.attachmentKey && input.attachmentUrl === existing?.attachmentUrl;
    const scoped = !!input.attachmentKey && input.attachmentUrl === academyPrivateAttachmentUrl(input.attachmentKey);
    if (!preserved && !scoped) throw forbidden("Attachment URL must match this lesson's file or its scoped upload");
  } else if (input.attachmentKey) {
    throw forbidden("Attachment key requires its matching authorized download URL");
  }
  await assertAcademyImageUrls(user, courseId, instructorHtmlImageSources(input.contentHtml), instructorHtmlImageSources(existing?.contentHtml));
}

/** Explicit teaching DTO: no identity, private storage keys or submission snapshots. */
export function teachingAttempt(attempt: typeof academyAssessmentAttempts.$inferSelect) {
  return { id: attempt.id, enrollmentId: attempt.enrollmentId, lessonId: attempt.lessonId, status: attempt.status,
    score: attempt.score, passed: attempt.passed, takenAt: attempt.takenAt };
}

/** Editing content does not delegate Accelerator release policy, even on an assigned course. */
export function assertInstructorModuleReleaseWeek(user: User, requestedWeek: number, existingWeek = 0): void {
  if (!isFullAdmin(user) && requestedWeek !== existingWeek) {
    throw forbidden("Instructors cannot change module release schedules");
  }
}
