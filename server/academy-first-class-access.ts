import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { academyAccess, academyCourses, academyEnrollments, academyLessonProgress, academyLessons, academyModules, agentCrmProfiles, agentTeams } from "../drizzle/schema";
import { FIRST_CLASS_UPGRADE_MESSAGE, firstClassModuleRelease, isFirstClassMembershipTier, isFirstClassRecap } from "../shared/academy-first-class";
import { buildAcademyLearningPath } from "../shared/academy-learning-path";
import { isAcceleratorWeekAvailable } from "./academy-journey";
import { getDb } from "./db";

export async function hasCurrentFirstClassMembership(agentId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [profile] = await db.select({ membershipTier: agentCrmProfiles.membershipTier, teamId: agentCrmProfiles.teamId }).from(agentCrmProfiles)
    .where(eq(agentCrmProfiles.userId, agentId)).limit(1);
  // Only the learner's own current CRM link can select a team; never inherit
  // a business owner's profile or infer entitlement from historic records.
  if (!profile) return false;
  let tier = profile.membershipTier;
  if (typeof profile.teamId === "number" && Number.isSafeInteger(profile.teamId) && profile.teamId > 0) {
    const [team] = await db.select({ membershipTier: agentTeams.membershipTier }).from(agentTeams)
      .where(eq(agentTeams.id, profile.teamId)).limit(1);
    // Missing/blank team tiers use the saved profile, matching CRM display.
    // Unknown nonblank tiers override it and deny. Read errors must propagate,
    // never masquerade as a missing team or fall back to stale entitlement.
    if (team?.membershipTier?.trim()) tier = team.membershipTier;
  }
  return isFirstClassMembershipTier(tier);
}

export async function requireFirstClassCourseMembership(course: { isFirstClassTraining?: boolean }, agentId: number) {
  if (course.isFirstClassTraining === true && !await hasCurrentFirstClassMembership(agentId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: FIRST_CLASS_UPGRADE_MESSAGE });
  }
}

/** Shared private-download authorization. Call again after fetching storage.
 * This is a learner gate, never an Instructor/admin preview entitlement. */
export async function requireAcademyLearnerResourceAccess(agentId: number, enrollmentId: number, lessonId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [enrollment] = await db.select().from(academyEnrollments)
    .where(and(eq(academyEnrollments.id, enrollmentId), eq(academyEnrollments.agentId, agentId))).limit(1);
  const [access] = await db.select({ status: academyAccess.status }).from(academyAccess).where(eq(academyAccess.agentId, agentId)).limit(1);
  if (!enrollment || access?.status !== "active" || !["assigned", "in_progress", "completed", "waived"].includes(enrollment.status)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Academy resource not available" });
  }
  const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, enrollment.courseId)).limit(1);
  if (!course || course.status !== "published") throw new TRPCError({ code: "NOT_FOUND", message: "Course not available" });
  await requireFirstClassCourseMembership(course, agentId);
  // Preserve pre-existing non-First-Class waived download behavior.
  if (enrollment.status === "waived" && !course.isFirstClassTraining) throw new TRPCError({ code: "NOT_FOUND", message: "Academy resource not available" });
  const modules = await db.select({ id: academyModules.id, sortOrder: academyModules.sortOrder, releaseWeek: academyModules.releaseWeek }).from(academyModules)
    .where(eq(academyModules.courseId, course.id)).orderBy(asc(academyModules.sortOrder), asc(academyModules.id));
  const lessons = modules.length ? await db.select({ id: academyLessons.id, moduleId: academyLessons.moduleId, isRequired: academyLessons.isRequired, sortOrder: academyLessons.sortOrder }).from(academyLessons)
    .where(and(inArray(academyLessons.moduleId, modules.map(module => module.id)), isNull(academyLessons.archivedAt)))
    .orderBy(asc(academyLessons.sortOrder), asc(academyLessons.id)) : [];
  const target = lessons.find(lesson => lesson.id === lessonId);
  const module = modules.find(module => module.id === target?.moduleId);
  if (!target || !module) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not available" });
  if (course.isAcceleratorJourney && !isAcceleratorWeekAvailable(enrollment.journeyStartedAt, module.releaseWeek)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This section has not been released" });
  }
  if (course.isFirstClassTraining && firstClassModuleRelease(enrollment, modules, module.id).releaseLocked) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This section has not been released" });
  }
  const progress = await db.select({ lessonId: academyLessonProgress.lessonId, completedAt: academyLessonProgress.completedAt }).from(academyLessonProgress)
    .where(eq(academyLessonProgress.enrollmentId, enrollment.id));
  const completed = new Set(progress.filter(item => !!item.completedAt).map(item => item.lessonId));
  const path = buildAcademyLearningPath(modules.flatMap(module => lessons.filter(item => item.moduleId === module.id)).map(item => ({ id: item.id, isRequired: item.isRequired, completed: completed.has(item.id) })));
  if (!isFirstClassRecap(course, enrollment) && path.lockedLessonIds.has(lessonId)) throw new TRPCError({ code: "FORBIDDEN", message: "Complete the current lesson before continuing" });
  return { enrollment, course, target };
}
