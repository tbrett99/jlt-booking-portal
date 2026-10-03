import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb, createInAppNotification, getUpcomingAgentEvents } from "./db";
import { sendDirectEmail } from "./email";
import { storagePut } from "./storage";
import {
  academyAccess,
  academyAssessmentAttempts,
  academyAuditLog,
  academyCourses,
  academyEnrollments,
  academyLessonProgress,
  academyLessons,
  academyModules,
  academyQuestions,
  adminOnboardingChecklist,
  agentCrmProfiles,
  users,
} from "../drizzle/schema";
import { getAccreditationEligibility, safeHttpsUrl, summariseAcademyProgress } from "../shared/academy-utils";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

const courseInput = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().trim().min(2).max(255),
  summary: z.string().trim().max(10_000).nullable().optional(),
  coverImageUrl: z.string().trim().url().max(10_000).nullable().optional(),
  isCoreAcademy: z.boolean().default(false),
  estimatedMinutes: z.number().int().min(0).max(10_000).default(0),
});

const lessonInput = z.object({
  id: z.number().int().positive().optional(),
  moduleId: z.number().int().positive(),
  title: z.string().trim().min(2).max(255),
  summary: z.string().trim().max(10_000).nullable().optional(),
  contentHtml: z.string().max(500_000).nullable().optional(),
  videoUrl: z.string().trim().max(1200).nullable().optional(),
  attachmentUrl: z.string().trim().max(10_000).nullable().optional(),
  attachmentKey: z.string().trim().max(600).nullable().optional(),
  attachmentName: z.string().trim().max(255).nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(1_440).default(5),
  isRequired: z.boolean().default(true),
  requiresAcknowledgement: z.boolean().default(false),
  requiresAssessment: z.boolean().default(false),
  assessmentPassMark: z.number().int().min(1).max(100).default(80),
});

function normaliseOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Staff-created lesson HTML is stored separately from external content. */
function sanitiseLessonHtml(value: string | null | undefined) {
  if (!value?.trim()) return null;
  return value
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|svg|math)[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src)\s*=\s*(?:javascript:|data:)[^\s>]*/gi, "")
    .trim();
}

function asOptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function addAudit(input: {
  agentId?: number | null;
  courseId?: number | null;
  enrollmentId?: number | null;
  actorId?: number | null;
  action: string;
  summary: string;
  metadata?: unknown;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(academyAuditLog).values({
    agentId: input.agentId ?? null,
    courseId: input.courseId ?? null,
    enrollmentId: input.enrollmentId ?? null,
    actorId: input.actorId ?? null,
    action: input.action,
    summary: input.summary,
    metadata: input.metadata ?? null,
  } as any);
}

async function courseStructure(courseId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const modules = await db.select().from(academyModules)
    .where(eq(academyModules.courseId, courseId)).orderBy(asc(academyModules.sortOrder), asc(academyModules.id));
  const moduleIds = modules.map((module) => module.id);
  const lessons = moduleIds.length
    ? await db.select().from(academyLessons).where(inArray(academyLessons.moduleId, moduleIds))
      .orderBy(asc(academyLessons.sortOrder), asc(academyLessons.id))
    : [];
  const lessonIds = lessons.map((lesson) => lesson.id);
  const questions = lessonIds.length
    ? await db.select().from(academyQuestions).where(inArray(academyQuestions.lessonId, lessonIds))
      .orderBy(asc(academyQuestions.sortOrder), asc(academyQuestions.id))
    : [];

  return {
    modules: modules.map((module) => ({
      ...module,
      lessons: lessons.filter((lesson) => lesson.moduleId === module.id).map((lesson) => ({
        ...lesson,
        questions: questions.filter((question) => question.lessonId === lesson.id),
      })),
    })),
    lessons,
  };
}

async function enrolAgentInCourse(params: {
  agentId: number;
  courseId: number;
  enrolledById: number;
  dueDate?: Date | null;
  notify?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, params.courseId)).limit(1);
  if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
  if (course.status !== "published") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Publish the course before enrolling agents" });
  }
  const [agent] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive, portalStatus: users.portalStatus })
    .from(users).where(eq(users.id, params.agentId)).limit(1);
  if (!agent || agent.role !== "agent" || !agent.isActive || !["onboarding", "active"].includes(agent.portalStatus)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Academy courses can only be assigned to current agent accounts" });
  }

  const [existing] = await db.select().from(academyEnrollments)
    .where(and(eq(academyEnrollments.agentId, params.agentId), eq(academyEnrollments.courseId, params.courseId))).limit(1);
  if (existing) {
    if (params.dueDate && existing.status !== "completed" && existing.status !== "waived") {
      await db.update(academyEnrollments).set({ dueDate: params.dueDate }).where(eq(academyEnrollments.id, existing.id));
    }
    return { enrollment: existing, created: false };
  }

  const result = await db.insert(academyEnrollments).values({
    agentId: params.agentId,
    courseId: params.courseId,
    enrolledById: params.enrolledById,
    dueDate: params.dueDate ?? null,
  } as any);
  const enrollmentId = Number((result as any).insertId);
  const [enrollment] = await db.select().from(academyEnrollments).where(eq(academyEnrollments.id, enrollmentId)).limit(1);
  await addAudit({
    agentId: params.agentId,
    courseId: params.courseId,
    enrollmentId,
    actorId: params.enrolledById,
    action: "enrolled",
    summary: `Assigned ${course.title} to ${agent.name ?? "agent"}`,
    metadata: { dueDate: params.dueDate?.toISOString() ?? null },
  });

  if (params.notify !== false) {
    const portalUrl = "https://portal.thejltgroup.co.uk/academy";
    await createInAppNotification({
      userId: params.agentId,
      message: `You have been enrolled in ${course.title}. Open the Academy to begin.`,
      linkUrl: "/academy",
      isUrgent: true,
    });
    if (agent.email) {
      void sendDirectEmail({
        toEmail: agent.email,
        toName: agent.name ?? "JLT Agent",
        subject: `Your JLT Academy access is ready — ${course.title}`,
        html: `<p>Hi ${(agent.name ?? "there").split(" ")[0]},</p><p>You have been enrolled in <strong>${course.title}</strong>.</p>${params.dueDate ? `<p>Please complete it by <strong>${params.dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</strong>.</p>` : ""}<p><a href="${portalUrl}">Open JLT Academy</a></p>`,
      });
    }
  }
  return { enrollment, created: true };
}

/** Used by onboarding approval and the Academy Manager; keeps access and course assignment in sync. */
export async function grantAcademyAccess(params: { agentId: number; actorId: number; note?: string | null }) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [agent] = await db.select({ id: users.id, name: users.name, role: users.role })
    .from(users).where(eq(users.id, params.agentId)).limit(1);
  if (!agent || agent.role !== "agent") throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });

  const [existing] = await db.select().from(academyAccess).where(eq(academyAccess.agentId, params.agentId)).limit(1);
  if (existing) {
    await db.update(academyAccess).set({ status: "active", grantedById: params.actorId, grantedAt: new Date(), revokedAt: null, revokedById: null, note: normaliseOptionalText(params.note) })
      .where(eq(academyAccess.id, existing.id));
  } else {
    await db.insert(academyAccess).values({ agentId: params.agentId, grantedById: params.actorId, note: normaliseOptionalText(params.note) } as any);
  }
  const [checklist] = await db.select({ id: adminOnboardingChecklist.id }).from(adminOnboardingChecklist)
    .where(eq(adminOnboardingChecklist.userId, params.agentId)).limit(1);
  if (checklist) {
    await db.update(adminOnboardingChecklist).set({ academyAccessApproved: true, updatedById: params.actorId }).where(eq(adminOnboardingChecklist.id, checklist.id));
  } else {
    await db.insert(adminOnboardingChecklist).values({ userId: params.agentId, academyAccessApproved: true, updatedById: params.actorId } as any);
  }

  const coreCourses = await db.select().from(academyCourses)
    .where(and(eq(academyCourses.status, "published"), eq(academyCourses.isCoreAcademy, true)));
  const enrolments = [];
  for (const course of coreCourses) {
    enrolments.push(await enrolAgentInCourse({ agentId: params.agentId, courseId: course.id, enrolledById: params.actorId }));
  }
  await addAudit({ agentId: params.agentId, actorId: params.actorId, action: "access_granted", summary: `Academy access approved for ${agent.name ?? "agent"}`, metadata: { note: normaliseOptionalText(params.note) } });
  return { enrolled: enrolments.filter((item) => item.created).length };
}

async function resolveEnrollmentForAgent(enrollmentId: number, agentId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [enrollment] = await db.select().from(academyEnrollments)
    .where(and(eq(academyEnrollments.id, enrollmentId), eq(academyEnrollments.agentId, agentId))).limit(1);
  if (!enrollment) throw new TRPCError({ code: "NOT_FOUND", message: "Academy enrolment not found" });
  return enrollment;
}

async function recalculateCompletion(enrollmentId: number, actorId: number) {
  const db = await getDb();
  if (!db) return null;
  const [enrollment] = await db.select().from(academyEnrollments).where(eq(academyEnrollments.id, enrollmentId)).limit(1);
  if (!enrollment || enrollment.status === "completed" || enrollment.status === "waived") return enrollment ?? null;
  const { lessons } = await courseStructure(enrollment.courseId);
  const requiredLessonIds = lessons.filter((lesson) => lesson.isRequired).map((lesson) => lesson.id);
  const progress = await db.select().from(academyLessonProgress).where(eq(academyLessonProgress.enrollmentId, enrollmentId));
  const summary = summariseAcademyProgress(requiredLessonIds, progress.filter((item) => item.completedAt).map((item) => item.lessonId));
  if (!summary.isComplete) return enrollment;

  const now = new Date();
  await db.update(academyEnrollments).set({ status: "completed", completedAt: now, completionOutcomeAppliedAt: now })
    .where(eq(academyEnrollments.id, enrollmentId));
  const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, enrollment.courseId)).limit(1);
  if (course?.isCoreAcademy) {
    await db.update(agentCrmProfiles).set({ trainingStage: "Agent Accelerator", academyAcceleratorStartedAt: now })
      .where(eq(agentCrmProfiles.userId, enrollment.agentId));
  }
  await createInAppNotification({
    userId: enrollment.agentId,
    message: course?.isCoreAcademy
      ? "You have completed JLT Academy and have moved to Agent Accelerator."
      : `You have completed ${course?.title ?? "your Academy course"}.`,
    linkUrl: "/academy",
    isUrgent: false,
  });
  await addAudit({
    agentId: enrollment.agentId,
    courseId: enrollment.courseId,
    enrollmentId,
    actorId,
    action: "completed",
    summary: course?.isCoreAcademy ? "Completed JLT Academy and moved to Agent Accelerator" : `Completed ${course?.title ?? "Academy course"}`,
  });
  return { ...enrollment, status: "completed" as const, completedAt: now };
}

export const academyRouter = router({
  agent: router({
    home: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [access] = await db.select().from(academyAccess).where(eq(academyAccess.agentId, ctx.user.id)).limit(1);
      const hasAccess = access?.status === "active";
      if (!hasAccess) return { hasAccess: false, access, enrolments: [], upcomingSessions: [] };

      const enrollments = await db.select({ enrollment: academyEnrollments, course: academyCourses })
        .from(academyEnrollments).innerJoin(academyCourses, eq(academyCourses.id, academyEnrollments.courseId))
        .where(and(eq(academyEnrollments.agentId, ctx.user.id), eq(academyCourses.status, "published"))).orderBy(asc(academyEnrollments.dueDate), desc(academyEnrollments.enrolledAt));
      const enrollmentIds = enrollments.map((row) => row.enrollment.id);
      const courseIds = enrollments.map((row) => row.course.id);
      const modules = courseIds.length ? await db.select().from(academyModules).where(inArray(academyModules.courseId, courseIds)).orderBy(asc(academyModules.sortOrder)) : [];
      const moduleIds = modules.map((module) => module.id);
      const lessons = moduleIds.length ? await db.select().from(academyLessons).where(inArray(academyLessons.moduleId, moduleIds)).orderBy(asc(academyLessons.sortOrder)) : [];
      const progress = enrollmentIds.length ? await db.select().from(academyLessonProgress).where(inArray(academyLessonProgress.enrollmentId, enrollmentIds)) : [];
      const upcomingSessions = (await getUpcomingAgentEvents(30)).filter((event) => event.eventCategory === "training" || event.eventCategory === "webinar" || event.eventCategory === "supplier_event");
      const now = new Date();

      return {
        hasAccess: true,
        access,
        upcomingSessions,
        enrolments: enrollments.map(({ enrollment, course }) => {
          const courseModules = modules.filter((module) => module.courseId === course.id);
          const courseLessons = lessons.filter((lesson) => courseModules.some((module) => module.id === lesson.moduleId));
          const courseProgress = progress.filter((item) => item.enrollmentId === enrollment.id);
          const progressSummary = summariseAcademyProgress(courseLessons.filter((lesson) => lesson.isRequired).map((lesson) => lesson.id), courseProgress.filter((item) => item.completedAt).map((item) => item.lessonId));
          const nextLesson = courseLessons.find((lesson) => lesson.isRequired && !courseProgress.some((item) => item.lessonId === lesson.id && item.completedAt)) ?? null;
          return {
            ...enrollment,
            course,
            progress: progressSummary,
            nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
            isOverdue: !!enrollment.dueDate && enrollment.status !== "completed" && enrollment.status !== "waived" && enrollment.dueDate < now,
          };
        }),
      };
    }),

    course: protectedProcedure.input(z.object({ enrollmentId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const enrollment = await resolveEnrollmentForAgent(input.enrollmentId, ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, enrollment.courseId)).limit(1);
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      if (course.status !== "published") throw new TRPCError({ code: "NOT_FOUND", message: "Course not available" });
      const structure = await courseStructure(course.id);
      const progress = await db.select().from(academyLessonProgress).where(eq(academyLessonProgress.enrollmentId, enrollment.id));
      const attempts = await db.select().from(academyAssessmentAttempts).where(eq(academyAssessmentAttempts.enrollmentId, enrollment.id)).orderBy(desc(academyAssessmentAttempts.takenAt));
      const progressByLesson = new Map(progress.map((item) => [item.lessonId, item]));
      const attemptsByLesson = new Map<number, typeof attempts>();
      for (const attempt of attempts) attemptsByLesson.set(attempt.lessonId, [...(attemptsByLesson.get(attempt.lessonId) ?? []), attempt]);
      const requiredLessons = structure.lessons.filter((lesson) => lesson.isRequired).map((lesson) => lesson.id);
      const summary = summariseAcademyProgress(requiredLessons, progress.filter((item) => item.completedAt).map((item) => item.lessonId));
      return {
        enrollment,
        course,
        progress: summary,
        modules: structure.modules.map((module) => ({
          ...module,
          lessons: module.lessons.map((lesson) => ({
            ...lesson,
            // Correct answer keys and staff-only question explanation stay server-side.
            questions: lesson.questions.map((question) => ({ id: question.id, prompt: question.prompt, answerOptions: asOptions(question.answerOptions), sortOrder: question.sortOrder })),
            progress: progressByLesson.get(lesson.id) ?? null,
            attempts: (attemptsByLesson.get(lesson.id) ?? []).map((attempt) => ({ id: attempt.id, score: attempt.score, passed: attempt.passed, takenAt: attempt.takenAt })),
          })),
        })),
      };
    }),

    viewLesson: protectedProcedure.input(z.object({ enrollmentId: z.number().int().positive(), lessonId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const enrollment = await resolveEnrollmentForAgent(input.enrollmentId, ctx.user.id);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const { lessons } = await courseStructure(enrollment.courseId);
        if (!lessons.some((lesson) => lesson.id === input.lessonId)) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
        const [existing] = await db.select().from(academyLessonProgress)
          .where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, input.lessonId))).limit(1);
        const now = new Date();
        if (existing) await db.update(academyLessonProgress).set({ lastViewedAt: now, startedAt: existing.startedAt ?? now }).where(eq(academyLessonProgress.id, existing.id));
        else await db.insert(academyLessonProgress).values({ enrollmentId: enrollment.id, lessonId: input.lessonId, startedAt: now, lastViewedAt: now } as any);
        if (enrollment.status === "assigned") await db.update(academyEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? now }).where(eq(academyEnrollments.id, enrollment.id));
        return { success: true };
      }),

    completeLesson: protectedProcedure.input(z.object({ enrollmentId: z.number().int().positive(), lessonId: z.number().int().positive(), acknowledged: z.boolean().default(false) }))
      .mutation(async ({ ctx, input }) => {
        const enrollment = await resolveEnrollmentForAgent(input.enrollmentId, ctx.user.id);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const { lessons } = await courseStructure(enrollment.courseId);
        const lesson = lessons.find((item) => item.id === input.lessonId);
        if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
        if (lesson.requiresAcknowledgement && !input.acknowledged) throw new TRPCError({ code: "BAD_REQUEST", message: "Please confirm the acknowledgement before continuing" });
        if (lesson.requiresAssessment) throw new TRPCError({ code: "BAD_REQUEST", message: "Pass the knowledge check before completing this lesson" });
        const [existing] = await db.select().from(academyLessonProgress)
          .where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, lesson.id))).limit(1);
        const now = new Date();
        if (existing) await db.update(academyLessonProgress).set({ acknowledgedAt: input.acknowledged ? now : existing.acknowledgedAt, completedAt: now, lastViewedAt: now, startedAt: existing.startedAt ?? now }).where(eq(academyLessonProgress.id, existing.id));
        else await db.insert(academyLessonProgress).values({ enrollmentId: enrollment.id, lessonId: lesson.id, startedAt: now, lastViewedAt: now, acknowledgedAt: input.acknowledged ? now : null, completedAt: now } as any);
        if (enrollment.status === "assigned") await db.update(academyEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? now }).where(eq(academyEnrollments.id, enrollment.id));
        await recalculateCompletion(enrollment.id, ctx.user.id);
        return { success: true };
      }),

    submitAssessment: protectedProcedure.input(z.object({ enrollmentId: z.number().int().positive(), lessonId: z.number().int().positive(), answers: z.array(z.object({ questionId: z.number().int().positive(), selectedIndex: z.number().int().min(0).max(20) })).min(1).max(50) }))
      .mutation(async ({ ctx, input }) => {
        const enrollment = await resolveEnrollmentForAgent(input.enrollmentId, ctx.user.id);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const { lessons } = await courseStructure(enrollment.courseId);
        const lesson = lessons.find((item) => item.id === input.lessonId);
        if (!lesson?.requiresAssessment) throw new TRPCError({ code: "BAD_REQUEST", message: "This lesson does not have an assessment" });
        const questions = await db.select().from(academyQuestions).where(eq(academyQuestions.lessonId, lesson.id)).orderBy(asc(academyQuestions.sortOrder));
        if (!questions.length) throw new TRPCError({ code: "BAD_REQUEST", message: "No knowledge-check questions have been added yet" });
        const answers = new Map(input.answers.map((answer) => [answer.questionId, answer.selectedIndex]));
        if (answers.size !== questions.length || questions.some((question) => !answers.has(question.id))) throw new TRPCError({ code: "BAD_REQUEST", message: "Please answer every question before submitting" });
        const correct = questions.filter((question) => answers.get(question.id) === question.correctAnswerIndex).length;
        const score = Math.round((correct / questions.length) * 100);
        const passed = score >= lesson.assessmentPassMark;
        const now = new Date();
        await db.insert(academyAssessmentAttempts).values({ enrollmentId: enrollment.id, lessonId: lesson.id, score, passed, answers: input.answers, takenAt: now } as any);
        if (passed) {
          const [existing] = await db.select().from(academyLessonProgress).where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, lesson.id))).limit(1);
          if (existing) await db.update(academyLessonProgress).set({ completedAt: now, lastViewedAt: now, startedAt: existing.startedAt ?? now }).where(eq(academyLessonProgress.id, existing.id));
          else await db.insert(academyLessonProgress).values({ enrollmentId: enrollment.id, lessonId: lesson.id, startedAt: now, lastViewedAt: now, completedAt: now } as any);
          if (enrollment.status === "assigned") await db.update(academyEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? now }).where(eq(academyEnrollments.id, enrollment.id));
          await recalculateCompletion(enrollment.id, ctx.user.id);
        }
        await addAudit({ agentId: ctx.user.id, courseId: enrollment.courseId, enrollmentId: enrollment.id, actorId: ctx.user.id, action: passed ? "assessment_passed" : "assessment_failed", summary: `${passed ? "Passed" : "Attempted"} ${lesson.title} knowledge check (${score}%)`, metadata: { lessonId: lesson.id, score, passed } });
        return { score, passed, passMark: lesson.assessmentPassMark, correct, total: questions.length };
      }),
  }),

  admin: router({
    courses: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const courses = await db.select().from(academyCourses).orderBy(asc(academyCourses.status), asc(academyCourses.title));
      const enrollments = await db.select().from(academyEnrollments);
      return courses.map((course) => ({
        ...course,
        enrolmentCount: enrollments.filter((enrollment) => enrollment.courseId === course.id).length,
        completionCount: enrollments.filter((enrollment) => enrollment.courseId === course.id && enrollment.status === "completed").length,
      }));
    }),

    editor: adminProcedure.input(z.object({ courseId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, input.courseId)).limit(1);
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      return { course, ...(await courseStructure(course.id)) };
    }),

    saveCourse: adminProcedure.input(courseInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const coverImageUrl = normaliseOptionalText(input.coverImageUrl);
      if (coverImageUrl && !safeHttpsUrl(coverImageUrl)) throw new TRPCError({ code: "BAD_REQUEST", message: "Course cover image must use HTTPS" });
      const payload = { title: input.title, summary: normaliseOptionalText(input.summary), coverImageUrl, isCoreAcademy: input.isCoreAcademy, estimatedMinutes: input.estimatedMinutes, updatedById: ctx.user.id };
      if (input.id) {
        if (input.isCoreAcademy) await db.update(academyCourses).set({ isCoreAcademy: false }).where(and(eq(academyCourses.isCoreAcademy, true), eq(academyCourses.status, "published")));
        await db.update(academyCourses).set(payload as any).where(eq(academyCourses.id, input.id));
        await addAudit({ courseId: input.id, actorId: ctx.user.id, action: "course_updated", summary: `Updated Academy course: ${input.title}` });
        return { id: input.id };
      }
      const result = await db.insert(academyCourses).values({ ...payload, createdById: ctx.user.id } as any);
      const id = Number((result as any).insertId);
      await addAudit({ courseId: id, actorId: ctx.user.id, action: "course_created", summary: `Created Academy course: ${input.title}` });
      return { id };
    }),

    setCourseStatus: adminProcedure.input(z.object({ courseId: z.number().int().positive(), status: z.enum(["draft", "published", "archived"]) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, input.courseId)).limit(1);
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      if (input.status === "published") {
        const structure = await courseStructure(course.id);
        if (!structure.lessons.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one lesson before publishing a course" });
        if (course.isCoreAcademy) await db.update(academyCourses).set({ isCoreAcademy: false }).where(and(eq(academyCourses.isCoreAcademy, true), eq(academyCourses.status, "published"), ne(academyCourses.id, input.courseId)));
      }
      const now = new Date();
      await db.update(academyCourses).set({ status: input.status, updatedById: ctx.user.id, publishedAt: input.status === "published" ? (course.publishedAt ?? now) : course.publishedAt, archivedAt: input.status === "archived" ? now : null }).where(eq(academyCourses.id, input.courseId));
      await addAudit({ courseId: input.courseId, actorId: ctx.user.id, action: `course_${input.status}`, summary: `${input.status === "published" ? "Published" : input.status === "archived" ? "Archived" : "Moved"} ${course.title} ${input.status === "draft" ? "to draft" : ""}` });
      return { success: true };
    }),

    saveModule: adminProcedure.input(z.object({ id: z.number().int().positive().optional(), courseId: z.number().int().positive(), title: z.string().trim().min(2).max(255), summary: z.string().trim().max(10_000).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      if (input.id) {
        await db.update(academyModules).set({ title: input.title, summary: normaliseOptionalText(input.summary) }).where(and(eq(academyModules.id, input.id), eq(academyModules.courseId, input.courseId)));
        return { id: input.id };
      }
      const existing = await db.select().from(academyModules).where(eq(academyModules.courseId, input.courseId)).orderBy(desc(academyModules.sortOrder)).limit(1);
      const result = await db.insert(academyModules).values({ courseId: input.courseId, title: input.title, summary: normaliseOptionalText(input.summary), sortOrder: (existing[0]?.sortOrder ?? -1) + 1 } as any);
      const id = Number((result as any).insertId);
      await addAudit({ courseId: input.courseId, actorId: ctx.user.id, action: "module_created", summary: `Added module: ${input.title}` });
      return { id };
    }),

    deleteModule: adminProcedure.input(z.object({ moduleId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [module] = await db.select().from(academyModules).where(eq(academyModules.id, input.moduleId)).limit(1);
      if (!module) return { success: true };
      const lessons = await db.select({ id: academyLessons.id }).from(academyLessons).where(eq(academyLessons.moduleId, module.id));
      const lessonIds = lessons.map((lesson) => lesson.id);
      if (lessonIds.length) await db.delete(academyQuestions).where(inArray(academyQuestions.lessonId, lessonIds));
      if (lessonIds.length) await db.delete(academyLessons).where(inArray(academyLessons.id, lessonIds));
      await db.delete(academyModules).where(eq(academyModules.id, module.id));
      await addAudit({ courseId: module.courseId, actorId: ctx.user.id, action: "module_deleted", summary: `Deleted module: ${module.title}` });
      return { success: true };
    }),

    saveLesson: adminProcedure.input(lessonInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [module] = await db.select().from(academyModules).where(eq(academyModules.id, input.moduleId)).limit(1);
      if (!module) throw new TRPCError({ code: "NOT_FOUND", message: "Module not found" });
      const videoUrl = normaliseOptionalText(input.videoUrl);
      if (videoUrl && !safeHttpsUrl(videoUrl)) throw new TRPCError({ code: "BAD_REQUEST", message: "Video links must use HTTPS" });
      const attachmentUrl = normaliseOptionalText(input.attachmentUrl);
      const payload = { title: input.title, summary: normaliseOptionalText(input.summary), contentHtml: sanitiseLessonHtml(input.contentHtml), videoUrl, attachmentUrl, attachmentKey: normaliseOptionalText(input.attachmentKey), attachmentName: normaliseOptionalText(input.attachmentName), estimatedMinutes: input.estimatedMinutes, isRequired: input.isRequired, requiresAcknowledgement: input.requiresAcknowledgement, requiresAssessment: input.requiresAssessment, assessmentPassMark: input.assessmentPassMark };
      if (input.id) {
        await db.update(academyLessons).set(payload as any).where(and(eq(academyLessons.id, input.id), eq(academyLessons.moduleId, input.moduleId)));
        return { id: input.id };
      }
      const existing = await db.select().from(academyLessons).where(eq(academyLessons.moduleId, input.moduleId)).orderBy(desc(academyLessons.sortOrder)).limit(1);
      const result = await db.insert(academyLessons).values({ ...payload, moduleId: input.moduleId, sortOrder: (existing[0]?.sortOrder ?? -1) + 1 } as any);
      const id = Number((result as any).insertId);
      await addAudit({ courseId: module.courseId, actorId: ctx.user.id, action: "lesson_created", summary: `Added lesson: ${input.title}` });
      return { id };
    }),

    deleteLesson: adminProcedure.input(z.object({ lessonId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [lesson] = await db.select().from(academyLessons).where(eq(academyLessons.id, input.lessonId)).limit(1);
      if (!lesson) return { success: true };
      const [module] = await db.select().from(academyModules).where(eq(academyModules.id, lesson.moduleId)).limit(1);
      await db.delete(academyQuestions).where(eq(academyQuestions.lessonId, lesson.id));
      await db.delete(academyLessons).where(eq(academyLessons.id, lesson.id));
      await addAudit({ courseId: module?.courseId ?? null, actorId: ctx.user.id, action: "lesson_deleted", summary: `Deleted lesson: ${lesson.title}` });
      return { success: true };
    }),

    reorderModules: adminProcedure.input(z.object({ courseId: z.number().int().positive(), moduleIds: z.array(z.number().int().positive()).min(1).max(200) })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const modules = await db.select({ id: academyModules.id }).from(academyModules).where(eq(academyModules.courseId, input.courseId));
      if (modules.length !== input.moduleIds.length || new Set(input.moduleIds).size !== input.moduleIds.length || modules.some((module) => !input.moduleIds.includes(module.id))) throw new TRPCError({ code: "BAD_REQUEST", message: "Module ordering does not match this course" });
      await Promise.all(input.moduleIds.map((id, sortOrder) => db.update(academyModules).set({ sortOrder }).where(eq(academyModules.id, id))));
      return { success: true };
    }),

    reorderLessons: adminProcedure.input(z.object({ moduleId: z.number().int().positive(), lessonIds: z.array(z.number().int().positive()).min(1).max(500) })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const lessons = await db.select({ id: academyLessons.id }).from(academyLessons).where(eq(academyLessons.moduleId, input.moduleId));
      if (lessons.length !== input.lessonIds.length || new Set(input.lessonIds).size !== input.lessonIds.length || lessons.some((lesson) => !input.lessonIds.includes(lesson.id))) throw new TRPCError({ code: "BAD_REQUEST", message: "Lesson ordering does not match this module" });
      await Promise.all(input.lessonIds.map((id, sortOrder) => db.update(academyLessons).set({ sortOrder }).where(eq(academyLessons.id, id))));
      return { success: true };
    }),

    replaceQuestions: adminProcedure.input(z.object({ lessonId: z.number().int().positive(), questions: z.array(z.object({ id: z.number().int().positive().optional(), prompt: z.string().trim().min(4).max(10_000), answerOptions: z.array(z.string().trim().min(1).max(500)).min(2).max(8), correctAnswerIndex: z.number().int().min(0).max(7), explanation: z.string().trim().max(10_000).nullable().optional() })).max(30) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [lesson] = await db.select().from(academyLessons).where(eq(academyLessons.id, input.lessonId)).limit(1);
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      if (input.questions.some((question) => question.correctAnswerIndex >= question.answerOptions.length)) throw new TRPCError({ code: "BAD_REQUEST", message: "Each question needs a correct answer" });
      await db.delete(academyQuestions).where(eq(academyQuestions.lessonId, input.lessonId));
      if (input.questions.length) await db.insert(academyQuestions).values(input.questions.map((question, sortOrder) => ({ lessonId: input.lessonId, prompt: question.prompt, answerOptions: question.answerOptions, correctAnswerIndex: question.correctAnswerIndex, explanation: normaliseOptionalText(question.explanation), sortOrder })) as any);
      const [module] = await db.select().from(academyModules).where(eq(academyModules.id, lesson.moduleId)).limit(1);
      await addAudit({ courseId: module?.courseId ?? null, actorId: ctx.user.id, action: "assessment_updated", summary: `Updated knowledge check: ${lesson.title}`, metadata: { questionCount: input.questions.length } });
      return { success: true };
    }),

    uploadAttachment: adminProcedure.input(z.object({ fileName: z.string().trim().min(1).max(255), fileBase64: z.string().min(1).max(20_000_000), mimeType: z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain", "text/csv"]) })).mutation(async ({ ctx, input }) => {
      const bytes = Buffer.from(input.fileBase64, "base64");
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Attachments must be under 10 MB" });
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "academy-resource";
      const stored = await storagePut(`academy/${ctx.user.id}/${Date.now()}-${safeName}`, bytes, input.mimeType);
      return { url: stored.url, key: stored.key, name: input.fileName };
    }),

    setAccess: adminProcedure.input(z.object({ agentId: z.number().int().positive(), enabled: z.boolean(), note: z.string().trim().max(10_000).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      if (input.enabled) return grantAcademyAccess({ agentId: input.agentId, actorId: ctx.user.id, note: input.note });
      const [access] = await db.select().from(academyAccess).where(eq(academyAccess.agentId, input.agentId)).limit(1);
      if (access) await db.update(academyAccess).set({ status: "revoked", revokedById: ctx.user.id, revokedAt: new Date(), note: normaliseOptionalText(input.note) }).where(eq(academyAccess.id, access.id));
      const [checklist] = await db.select({ id: adminOnboardingChecklist.id }).from(adminOnboardingChecklist).where(eq(adminOnboardingChecklist.userId, input.agentId)).limit(1);
      if (checklist) await db.update(adminOnboardingChecklist).set({ academyAccessApproved: false, updatedById: ctx.user.id }).where(eq(adminOnboardingChecklist.id, checklist.id));
      await addAudit({ agentId: input.agentId, actorId: ctx.user.id, action: "access_revoked", summary: "Academy access revoked", metadata: { note: normaliseOptionalText(input.note) } });
      return { enrolled: 0 };
    }),

    enroll: adminProcedure.input(z.object({ agentId: z.number().int().positive(), courseId: z.number().int().positive(), dueDate: z.date().nullable().optional() })).mutation(async ({ ctx, input }) => {
      // Enrolment is a deliberate staff action, so it also establishes Academy
      // access where the agent has not yet been approved through onboarding.
      await grantAcademyAccess({ agentId: input.agentId, actorId: ctx.user.id });
      return enrolAgentInCourse({ agentId: input.agentId, courseId: input.courseId, enrolledById: ctx.user.id, dueDate: input.dueDate ?? null });
    }),

    progress: adminProcedure.input(z.object({ courseId: z.number().int().positive().optional(), agentId: z.number().int().positive().optional() }).optional()).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.select({ enrollment: academyEnrollments, course: academyCourses, agent: users, profile: agentCrmProfiles })
        .from(academyEnrollments)
        .innerJoin(academyCourses, eq(academyCourses.id, academyEnrollments.courseId))
        .innerJoin(users, eq(users.id, academyEnrollments.agentId))
        .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, academyEnrollments.agentId))
        .orderBy(desc(academyEnrollments.updatedAt));
      const filtered = rows.filter((row) => (!input?.courseId || row.course.id === input.courseId) && (!input?.agentId || row.agent.id === input.agentId));
      const enrollmentIds = filtered.map((row) => row.enrollment.id);
      const progress = enrollmentIds.length ? await db.select().from(academyLessonProgress).where(inArray(academyLessonProgress.enrollmentId, enrollmentIds)) : [];
      const courseIds = Array.from(new Set(filtered.map((row) => row.course.id)));
      const modules = courseIds.length ? await db.select().from(academyModules).where(inArray(academyModules.courseId, courseIds)) : [];
      const lessons = modules.length ? await db.select().from(academyLessons).where(inArray(academyLessons.moduleId, modules.map((module) => module.id))) : [];
      const now = new Date();
      return filtered.map((row) => {
        const courseLessons = lessons.filter((lesson) => modules.some((module) => module.courseId === row.course.id && module.id === lesson.moduleId));
        const enrollmentProgress = progress.filter((item) => item.enrollmentId === row.enrollment.id);
        const completion = summariseAcademyProgress(courseLessons.filter((lesson) => lesson.isRequired).map((lesson) => lesson.id), enrollmentProgress.filter((item) => item.completedAt).map((item) => item.lessonId));
        return {
          ...row,
          completion,
          overdue: !!row.enrollment.dueDate && row.enrollment.status !== "completed" && row.enrollment.status !== "waived" && row.enrollment.dueDate < now,
          accreditation: getAccreditationEligibility(row.profile?.academyAcceleratorStartedAt, now),
        };
      });
    }),

    overrideCompletion: adminProcedure.input(z.object({ enrollmentId: z.number().int().positive(), action: z.enum(["complete", "reopen", "waive"]), reason: z.string().trim().min(3).max(10_000) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [enrollment] = await db.select().from(academyEnrollments).where(eq(academyEnrollments.id, input.enrollmentId)).limit(1);
      if (!enrollment) throw new TRPCError({ code: "NOT_FOUND", message: "Enrolment not found" });
      const now = new Date();
      const nextStatus = input.action === "reopen" ? "in_progress" : input.action === "waive" ? "waived" : "completed";
      await db.update(academyEnrollments).set({ status: nextStatus, completedAt: input.action === "reopen" ? null : now, completionOutcomeAppliedAt: input.action === "reopen" ? null : now }).where(eq(academyEnrollments.id, enrollment.id));
      const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, enrollment.courseId)).limit(1);
      if (course?.isCoreAcademy && input.action !== "reopen") await db.update(agentCrmProfiles).set({ trainingStage: "Agent Accelerator", academyAcceleratorStartedAt: now }).where(eq(agentCrmProfiles.userId, enrollment.agentId));
      await addAudit({ agentId: enrollment.agentId, courseId: enrollment.courseId, enrollmentId: enrollment.id, actorId: ctx.user.id, action: `completion_${input.action}_override`, summary: `Staff ${input.action} override: ${input.reason}` });
      return { success: true };
    }),

    approveAccreditation: adminProcedure.input(z.object({ agentId: z.number().int().positive(), reason: z.string().trim().min(3).max(10_000) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [profile] = await db.select().from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, input.agentId)).limit(1);
      const eligibility = getAccreditationEligibility(profile?.academyAcceleratorStartedAt);
      if (!eligibility.eligible) {
        throw new TRPCError({ code: "BAD_REQUEST", message: eligibility.eligibleAt ? `Accreditation is available from ${eligibility.eligibleAt.toLocaleDateString("en-GB")}` : "The agent must first move to Agent Accelerator" });
      }
      const now = new Date();
      await db.update(agentCrmProfiles).set({ trainingStage: "Accredited", academyAccreditedAt: now }).where(eq(agentCrmProfiles.userId, input.agentId));
      await createInAppNotification({ userId: input.agentId, message: "Congratulations — you are now an Accredited JLT agent.", linkUrl: "/academy", isUrgent: false });
      await addAudit({ agentId: input.agentId, actorId: ctx.user.id, action: "accredited", summary: `Approved Accredited status: ${input.reason}` });
      return { success: true };
    }),

    sendDueReminders: adminProcedure.input(z.object({ courseId: z.number().int().positive().optional() }).optional()).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.select({ enrollment: academyEnrollments, course: academyCourses, agent: users })
        .from(academyEnrollments).innerJoin(academyCourses, eq(academyCourses.id, academyEnrollments.courseId)).innerJoin(users, eq(users.id, academyEnrollments.agentId));
      const now = new Date();
      const actionable = rows.filter((row) => (!input?.courseId || row.course.id === input.courseId) && row.enrollment.dueDate && row.enrollment.dueDate <= now && !["completed", "waived"].includes(row.enrollment.status));
      let sent = 0;
      for (const { enrollment, course, agent } of actionable) {
        await createInAppNotification({ userId: agent.id, message: `${course.title} is now due. Please continue your Academy learning.`, linkUrl: "/academy", isUrgent: true });
        if (agent.email) {
          void sendDirectEmail({ toEmail: agent.email, toName: agent.name ?? "JLT Agent", subject: `Academy reminder: ${course.title} is due`, html: `<p>Hi ${(agent.name ?? "there").split(" ")[0]},</p><p><strong>${course.title}</strong> is now due. Please complete your remaining learning in the JLT Academy.</p><p><a href="https://portal.thejltgroup.co.uk/academy">Continue learning</a></p>` });
        }
        await db.update(academyEnrollments).set({ lastReminderAt: now }).where(eq(academyEnrollments.id, enrollment.id));
        await addAudit({ agentId: agent.id, courseId: course.id, enrollmentId: enrollment.id, actorId: ctx.user.id, action: "due_reminder_sent", summary: `Sent Academy due reminder for ${course.title}` });
        sent++;
      }
      return { sent };
    }),
  }),
});
