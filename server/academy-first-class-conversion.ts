import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Request } from "express";
import { academyAuditLog, academyCourses, academyLessons, academyModules, staffAcademyUploads, users, type AcademyCourse, type AcademyLesson, type User } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { academyPrivateAttachmentUrl } from "./academy-staff-access";
import { MAX_ACADEMY_DOCUMENT_BYTES, isAcademyDocumentMimeType, validateAcademyDocument } from "./academy-document-assessment";
import { isFullAdmin } from "./staff-access";
import { decryptPrivateStoragePayload, storageGetRawBounded, storagePutEncrypted } from "./storage";

// Bounds apply to distinct source files, not every reference to a reused file.
// Three workers cap simultaneous plaintext buffers; completed preparations retain
// only keys/hashes. No storage work or global DB helpers run inside the cutover.
export const FIRST_CLASS_CONVERSION_MAX_FILES = 100;
export const FIRST_CLASS_CONVERSION_PREPARATION_MS = 120_000;
export const FIRST_CLASS_CONVERSION_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_SCOPE_ROWS = 1000;
const PRIVATE_ENVELOPE_BYTES = 34;
const teachingKey = /^academy\/[1-9]\d*\/([a-z0-9][a-z0-9._-]*)$/i;
const canonicalPrivateKey = /^academy\/[1-9]\d*\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-[a-z0-9._-]+$/i;
const mimeByExtension: Record<string, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain", csv: "text/csv",
};
type Database = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
type QueryDb = Pick<Database, "select">;
export type AcademyTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Shared serialization point: all course-content writers lock course before
 * module/lesson rows. Provider work must finish before acquiring this lock. */
export async function lockAcademyCourse(tx: AcademyTransaction, courseId: number) {
  const [course] = await tx.select().from(academyCourses).where(eq(academyCourses.id, courseId)).limit(1).for("update");
  if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
  return course;
}
type Snapshot = { course: AcademyCourse; modules: Array<typeof academyModules.$inferSelect>; lessons: AcademyLesson[]; uploads: Array<typeof staffAcademyUploads.$inferSelect> };
type Source = { key: string; basename: string; mimeType: string; lesson: AcademyLesson };
type Prepared = { sourceKey: string; key: string; size: number; hash: string };
export type FirstClassCoursePayload = Pick<AcademyCourse, "title" | "summary" | "coverImageUrl" | "isCoreAcademy" | "isAcceleratorJourney" | "isFirstClassTraining" | "estimatedMinutes" | "updatedById">;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const conflict = () => new TRPCError({ code: "CONFLICT", message: "This course or its resources changed while saving. Refresh the course and try again." });
function resourceError(lesson: AcademyLesson, reason: string) {
  const name = (lesson.attachmentName || lesson.title || `Lesson ${lesson.id}`).replace(/[\x00-\x1f<>]/g, " ").slice(0, 80);
  return new TRPCError({ code: "BAD_REQUEST", message: `Cannot make resource “${name}” private: ${reason}. No course changes were saved.` });
}
const present = (value: string | null | undefined) => !!value?.trim();
const stable = (value: unknown) => JSON.stringify(value);

async function readSnapshot(db: QueryDb, courseId: number, lock = false): Promise<Snapshot> {
  const finish = <T extends { for: (mode: "update") => any }>(query: T): any => lock ? query.for("update") : query;
  const [course] = await finish(db.select().from(academyCourses).where(eq(academyCourses.id, courseId)).limit(1));
  if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
  const modules = await finish(db.select().from(academyModules).where(eq(academyModules.courseId, courseId)).orderBy(asc(academyModules.id)).limit(MAX_SCOPE_ROWS + 1));
  if (modules.length > MAX_SCOPE_ROWS) throw new TRPCError({ code: "BAD_REQUEST", message: "This course is too large for an automatic resource conversion" });
  const moduleIds = modules.map((row: typeof academyModules.$inferSelect) => row.id);
  const lessons = moduleIds.length ? await finish(db.select().from(academyLessons).where(inArray(academyLessons.moduleId, moduleIds)).orderBy(asc(academyLessons.id)).limit(MAX_SCOPE_ROWS + 1)) : [];
  if (lessons.length > MAX_SCOPE_ROWS) throw new TRPCError({ code: "BAD_REQUEST", message: "This course is too large for an automatic resource conversion" });
  const keys = Array.from(new Set<string>(lessons.filter((row: AcademyLesson) => present(row.attachmentKey)).map((row: AcademyLesson) => row.attachmentKey!)));
  // Do not filter registry by expected course/kind: a conflicting actual row must
  // be refused, not mistaken for an unregistered historical administrator upload.
  const uploads = keys.length ? await finish(db.select().from(staffAcademyUploads).where(inArray(staffAcademyUploads.objectKey, keys)).orderBy(asc(staffAcademyUploads.id))) : [];
  return { course, modules, lessons, uploads };
}
function sourcesFor(snapshot: Snapshot): Source[] {
  const sources = new Map<string, Source>();
  const base = process.env.S3_PUBLIC_URL?.replace(/\/+$/, "");
  for (const lesson of snapshot.lessons) {
    const key = lesson.attachmentKey;
    const url = lesson.attachmentUrl;
    if (!present(key) && !present(url)) continue;
    if (!key || !url || key !== key.trim() || url !== url.trim()) throw resourceError(lesson, "the saved file key and URL must both be valid");
    const uploads = snapshot.uploads.filter(row => row.objectKey === key);
    if (snapshot.lessons.some(row => row.assessmentTemplateKey === key)) throw resourceError(lesson, "assessment templates are not teaching attachments");
    if (uploads.length > 1 || uploads.some(row => row.courseId !== snapshot.course.id || row.kind !== "attachment")) throw resourceError(lesson, "the upload belongs to another course or is not a teaching attachment");
    if (url === academyPrivateAttachmentUrl(key)) {
      if (!canonicalPrivateKey.test(key) || uploads.length !== 1) throw resourceError(lesson, "the private upload is not registered for this course");
      continue; // Preserve the original private key/name/embedding exactly.
    }
    const match = key.match(teachingKey);
    if (!match || key.length > 600 || !base || url !== `${base}/${key}` || match[1].includes("..")) throw resourceError(lesson, "only ordinary Academy uploads at the configured storage URL can be converted");
    const basename = match[1];
    const extension = basename.split(".").at(-1)?.toLowerCase() ?? "";
    const mimeType = mimeByExtension[extension];
    if (!mimeType || (lesson.attachmentName && lesson.attachmentName.split(".").at(-1)?.toLowerCase() !== extension)) throw resourceError(lesson, "supported formats are PDF, DOCX, XLSX, TXT and CSV with matching filenames");
    sources.set(key, sources.get(key) ?? { key, basename, mimeType, lesson });
  }
  if (sources.size > FIRST_CLASS_CONVERSION_MAX_FILES) throw resourceError(Array.from(sources.values())[0].lesson, `at most ${FIRST_CLASS_CONVERSION_MAX_FILES} distinct files can be converted per save`);
  return Array.from(sources.values());
}
function assertActor(user: User | null | undefined, expected: User) {
  if (!user || user.id !== expected.id || user.role !== expected.role || !isFullAdmin(user)
    || user.isActive !== true || ["cancelled", "paused", "suspended"].includes(String(user.portalStatus))) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Your administrator account or session is no longer authorized. Sign in again before saving." });
  }
}

/** Full-admin First Class saves always validate and commit under the course lock,
 * including empty/all-private courses. Never return to a gap-prone route fallback.
 * All source authorization is based on actual DB relationships, not client files. */
export async function convertFirstClassCourseResources(args: {
  db: Database; actor: User; req: Request; courseId: number; expectedCourse: AcademyCourse; payload: FirstClassCoursePayload;
}): Promise<{ id: number }> {
  if (!isFullAdmin(args.actor) || !Number.isSafeInteger(args.courseId) || args.courseId <= 0 || args.payload.isFirstClassTraining !== true
    || args.payload.isCoreAcademy || args.payload.isAcceleratorJourney || args.payload.updatedById !== args.actor.id || args.expectedCourse.id !== args.courseId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An administrator and existing First Class course save are required" });
  }
  try {
    const snapshot = await readSnapshot(args.db, args.courseId);
    if (stable(snapshot.course) !== stable(args.expectedCourse)) throw conflict();
    const sources = sourcesFor(snapshot); // Validate every reference before any R2 read/write.
    assertActor(args.actor, args.actor);
    const prepared: Prepared[] = [];
    let totalBytes = 0;
    let next = 0;
    let failure: unknown;
    const controller = new AbortController();
    const expiresAt = Date.now() + FIRST_CLASS_CONVERSION_PREPARATION_MS;
    const checkPreparation = () => {
      if (Date.now() >= expiresAt && !controller.signal.aborted) controller.abort(new Error("Private resource preparation deadline exceeded"));
      controller.signal.throwIfAborted();
    };
    const deadline = setTimeout(() => controller.abort(new Error("Private resource preparation deadline exceeded")), FIRST_CLASS_CONVERSION_PREPARATION_MS);
    const worker = async () => {
      while (!failure && !controller.signal.aborted && next < sources.length) {
        const source = sources[next++];
        try {
          checkPreparation();
          const bytes = await storageGetRawBounded(source.key, MAX_ACADEMY_DOCUMENT_BYTES, controller.signal);
          checkPreparation();
          if (!bytes.length || bytes.length > MAX_ACADEMY_DOCUMENT_BYTES) throw new Error("file exceeds 10 MB or is empty");
          totalBytes += bytes.length;
          if (totalBytes > FIRST_CLASS_CONVERSION_MAX_TOTAL_BYTES) throw new Error("files exceed the 100 MB total conversion limit");
          if (isAcademyDocumentMimeType(source.mimeType)) validateAcademyDocument({ fileName: source.basename, mimeType: source.mimeType, bytes });
          const targetKey = `academy/${args.actor.id}/${randomUUID()}-${source.basename.slice(-255)}`;
          const stored = await storagePutEncrypted(targetKey, bytes, controller.signal);
          checkPreparation();
          if (stored.key !== targetKey) throw new Error("private storage returned an unexpected file key");
          const verified = decryptPrivateStoragePayload(await storageGetRawBounded(targetKey, bytes.length + PRIVATE_ENVELOPE_BYTES, controller.signal));
          checkPreparation();
          if (verified.length !== bytes.length || hash(verified) !== hash(bytes) || !verified.equals(bytes)) throw new Error("private copy could not be verified");
          prepared.push({ sourceKey: source.key, key: targetKey, size: bytes.length, hash: hash(bytes) });
        } catch {
          failure ??= resourceError(source.lesson, "the file is missing, too large, invalid or could not be copied and verified");
          controller.abort(failure);
        }
      }
    };
    try {
      // SDK cancellation, not a Promise.race: all workers settle before proceeding.
      // Check after every await as providers may resolve despite cancellation.
      await Promise.all(Array.from({ length: Math.min(3, sources.length) }, worker));
      if (failure) throw failure;
      checkPreparation();
      const fresh = await sdk.authenticateRequest(args.req).catch(() => null);
      checkPreparation();
      assertActor(fresh, args.actor);
      await args.db.transaction(async tx => {
        // SDK is outside the short transaction. Lock and check the current DB actor
        // too, so stale context/SDK mocks are not an authorization assumption.
        await lockAcademyCourse(tx, args.courseId);
        checkPreparation();
        const [actor] = await tx.select().from(users).where(eq(users.id, args.actor.id)).limit(1).for("update");
        assertActor(actor, args.actor);
        const current = await readSnapshot(tx, args.courseId, true);
        if (stable(current) !== stable(snapshot)) throw conflict();
        const replacements = new Map(prepared.map(row => [row.sourceKey, row]));
        if (prepared.length) await tx.insert(staffAcademyUploads).values(prepared.map(row => ({ userId: actor.id, courseId: args.courseId, objectKey: row.key, kind: "attachment" as const })));
        for (const lesson of current.lessons) {
          const replacement = replacements.get(lesson.attachmentKey!);
          if (!replacement) continue;
          await tx.update(academyLessons).set({ attachmentKey: replacement.key, attachmentUrl: academyPrivateAttachmentUrl(replacement.key), updatedAt: lesson.updatedAt })
            .where(and(eq(academyLessons.id, lesson.id), eq(academyLessons.moduleId, lesson.moduleId), eq(academyLessons.attachmentKey, lesson.attachmentKey!), eq(academyLessons.attachmentUrl, lesson.attachmentUrl!)));
        }
        checkPreparation();
        await tx.update(academyCourses).set(args.payload).where(eq(academyCourses.id, args.courseId));
        // Locked range readback also verifies each replacement and all untouched
        // lesson fields. No partial write succeeds if a CAS/update is ineffective.
        const after = await readSnapshot(tx, args.courseId, true);
        const expectedLessons = current.lessons.map(lesson => {
          const row = replacements.get(lesson.attachmentKey!);
          return row ? { ...lesson, attachmentKey: row.key, attachmentUrl: academyPrivateAttachmentUrl(row.key) } : lesson;
        });
        if (stable(after.modules) !== stable(current.modules) || stable(after.lessons) !== stable(expectedLessons)
          || Object.entries(args.payload).some(([field, value]) => stable(after.course[field as keyof AcademyCourse]) !== stable(value))
          || prepared.some(row => !after.uploads.some(upload => upload.objectKey === row.key && upload.courseId === args.courseId && upload.userId === actor.id && upload.kind === "attachment"))) throw conflict();
        await tx.insert(academyAuditLog).values({ courseId: args.courseId, actorId: actor.id, action: "course_updated", summary: prepared.length ? "Updated First Class course and converted its teaching resource references to private uploads" : "Updated First Class course with validated private teaching resources", metadata: { convertedFileCount: prepared.length, convertedReferenceCount: current.lessons.filter(lesson => replacements.has(lesson.attachmentKey!)).length, convertedBytes: totalBytes, learnerEvidencePreserved: true, historicalPublicObjectsUntouched: true } });
        checkPreparation();
      }, { isolationLevel: "repeatable read" });
      return { id: args.courseId };
    } finally {
      clearTimeout(deadline);
      controller.abort();
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The private resource conversion could not be saved. No course changes were committed; refresh and try again." });
  }
}
