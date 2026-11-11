import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { academyAuditLog, academyLessons, academyModules } from "../drizzle/schema";
import { getDb } from "./db";

/** Only the administrator-gated procedure may call this visibility operation.
 * It does not recalculate completion, grade work, dispatch notices, or rewrite
 * any learner evidence. Archive and its audit record commit or roll back together.
 */
export async function setAcademyLessonArchived(input: {
  lessonId: number;
  actorId: number;
  archived: boolean;
}) {
  if (typeof input.archived !== "boolean" || ![input.lessonId, input.actorId].every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A valid lesson and administrator are required" });
  }
  try {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Lesson visibility is temporarily unavailable" });
    return await db.transaction(async (tx) => {
      const [lesson] = await tx.select({
        id: academyLessons.id,
        moduleId: academyLessons.moduleId,
        title: academyLessons.title,
        archivedAt: academyLessons.archivedAt,
      }).from(academyLessons).where(eq(academyLessons.id, input.lessonId)).limit(1).for("update");
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      const [module] = await tx.select({ id: academyModules.id, courseId: academyModules.courseId })
        .from(academyModules).where(eq(academyModules.id, lesson.moduleId)).limit(1);
      if (!module) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson course not found" });
      if (!!lesson.archivedAt === input.archived) {
        return { success: true as const, lessonId: lesson.id, archivedAt: lesson.archivedAt, changed: false };
      }
      // The existing column uses second-resolution UTC timestamps. Use that
      // same precision so persistence readback is exact on MySQL and TiDB.
      const archivedAt = input.archived ? new Date(Math.floor(Date.now() / 1000) * 1000) : null;
      await tx.update(academyLessons).set({ archivedAt }).where(and(
        eq(academyLessons.id, lesson.id), eq(academyLessons.moduleId, lesson.moduleId),
      ));
      const [saved] = await tx.select({ id: academyLessons.id, archivedAt: academyLessons.archivedAt })
        .from(academyLessons).where(eq(academyLessons.id, lesson.id)).limit(1);
      if (!saved || (saved.archivedAt?.getTime() ?? null) !== (archivedAt?.getTime() ?? null)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Lesson visibility could not be verified; the transaction was rolled back" });
      }
      await tx.insert(academyAuditLog).values({
        courseId: module.courseId,
        actorId: input.actorId,
        action: input.archived ? "lesson_archived" : "lesson_restored",
        summary: `${input.archived ? "Archived lesson from the active learner course" : "Restored lesson to the active learner course"}: ${lesson.title}`,
        metadata: {
          lessonId: lesson.id,
          moduleId: lesson.moduleId,
          previousArchivedAt: lesson.archivedAt?.toISOString() ?? null,
          archivedAt: archivedAt?.toISOString() ?? null,
          learnerEvidencePreserved: true,
        },
      });
      return { success: true as const, lessonId: lesson.id, archivedAt: saved.archivedAt, changed: true };
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    // Never expose query parameters, private content or driver details.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Lesson visibility could not be saved. Refresh the course to check its current state before trying again.",
    });
  }
}
