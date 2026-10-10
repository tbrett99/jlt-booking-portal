import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb, getRawDbPool, createInAppNotification, getUpcomingAgentEvents } from "./db";
import { sendDirectEmail } from "./email";
import { storagePut } from "./storage";
import {
  academyAccess,
  academyAssessmentAttempts,
  academyAssessmentResponses,
  academyAssessmentQuestionResets,
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
import { parseMultipleChoiceQuizCsv, QuizCsvImportError } from "../shared/academy-quiz-csv";

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

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function asResponses(value: unknown): Array<{ questionId: number; selectedIndex: number | null; responseText: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const questionId = Number(record.questionId);
    if (!Number.isSafeInteger(questionId) || questionId < 1) return [];
    const selectedIndex = record.selectedIndex === undefined || record.selectedIndex === null ? null : Number(record.selectedIndex);
    return [{
      questionId,
      selectedIndex: Number.isSafeInteger(selectedIndex) ? selectedIndex : null,
      responseText: typeof record.responseText === "string" ? record.responseText : null,
    }];
  });
}

const MAX_QUESTION_ATTEMPTS = 3;

type QuestionResitState = {
  questionId: number;
  attemptCount: number;
  passed: boolean;
  awaitingMarking: boolean;
  feedbackPending: boolean;
  supportRequired: boolean;
  lastScore: number | null;
};

/**
 * Passed questions stay complete; only unsuccessful questions return in a resit.
 * An admin reset opens a fresh three-attempt cycle without deleting history.
 */
function deriveQuestionResitStates(params: {
  questions: Array<{ id: number; questionType: "multiple_choice" | "free_text" }>;
  attempts: Array<{ id: number; status: string; takenAt: Date | string }>;
  responses: Array<{ attemptId: number; questionId: number; score: number | null }>;
  resets: Array<{ questionId: number; createdAt: Date | string }>;
  passMark: number;
}): QuestionResitState[] {
  const attemptById = new Map(params.attempts.map((attempt) => [attempt.id, attempt]));
  return params.questions.map((question) => {
    const resetAt = params.resets
      .filter((reset) => reset.questionId === question.id)
      .map((reset) => new Date(reset.createdAt).getTime())
      .reduce((latest, value) => Math.max(latest, value), -Infinity);
    const questionAttempts = params.responses
      .filter((response) => response.questionId === question.id)
      .map((response) => ({ response, attempt: attemptById.get(response.attemptId) }))
      .filter((item): item is { response: typeof item.response; attempt: NonNullable<typeof item.attempt> } => !!item.attempt && new Date(item.attempt.takenAt).getTime() > resetAt)
      .sort((a, b) => new Date(b.attempt.takenAt).getTime() - new Date(a.attempt.takenAt).getTime());
    const latest = questionAttempts[0] ?? null;
    const attemptCount = new Set(questionAttempts.map((item) => item.attempt.id)).size;
    const lastScore = latest?.response.score ?? null;
    // A multiple-choice answer is either right or wrong. Written work follows
    // the lesson pass mark set by the Academy team.
    const passed = lastScore !== null && lastScore >= (question.questionType === "multiple_choice" ? 100 : params.passMark);
    const awaitingMarking = questionAttempts.some((item) => item.attempt.status === "awaiting_marking");
    const feedbackPending = questionAttempts.some((item) => item.attempt.status === "feedback_pending");
    return {
      questionId: question.id,
      attemptCount,
      passed,
      awaitingMarking,
      feedbackPending,
      supportRequired: !passed && !awaitingMarking && !feedbackPending && attemptCount >= MAX_QUESTION_ATTEMPTS,
      lastScore,
    };
  });
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

/** A reviewed written assessment must be read and acknowledged before later lessons can be completed. */
async function ensureFeedbackAcknowledgedBeforeLesson(enrollment: { id: number; courseId: number }, lessonId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const { lessons } = await courseStructure(enrollment.courseId);
  const targetIndex = lessons.findIndex((lesson) => lesson.id === lessonId);
  if (targetIndex < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
  const earlierLessonIds = lessons.slice(0, targetIndex).map((lesson) => lesson.id);
  if (!earlierLessonIds.length) return;
  const attempts = await db.select().from(academyAssessmentAttempts)
    .where(and(
      eq(academyAssessmentAttempts.enrollmentId, enrollment.id),
      eq(academyAssessmentAttempts.status, "feedback_pending"),
      inArray(academyAssessmentAttempts.lessonId, earlierLessonIds),
    ));
  if (attempts.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Read and acknowledge your assessment feedback before moving on to the next lesson",
    });
  }
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

    /**
     * Lets a staff member inspect the Academy exactly as it is presented to an
     * agent, without creating Academy access, enrolments, progress, attempts,
     * notices or CRM-stage changes for the staff account.
     */
    previewHome: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const courses = await db.select().from(academyCourses)
        .where(eq(academyCourses.status, "published"))
        .orderBy(asc(academyCourses.title));
      const courseIds = courses.map((course) => course.id);
      const modules = courseIds.length
        ? await db.select().from(academyModules).where(inArray(academyModules.courseId, courseIds)).orderBy(asc(academyModules.sortOrder))
        : [];
      const moduleIds = modules.map((module) => module.id);
      const lessons = moduleIds.length
        ? await db.select().from(academyLessons).where(inArray(academyLessons.moduleId, moduleIds)).orderBy(asc(academyLessons.sortOrder))
        : [];
      const upcomingSessions = (await getUpcomingAgentEvents(30)).filter((event) => event.eventCategory === "training" || event.eventCategory === "webinar" || event.eventCategory === "supplier_event");

      return {
        hasAccess: true,
        isPreview: true,
        access: null,
        upcomingSessions,
        enrolments: courses.map((course) => {
          const courseModules = modules.filter((module) => module.courseId === course.id);
          const courseLessons = lessons.filter((lesson) => courseModules.some((module) => module.id === lesson.moduleId));
          const requiredLessonIds = courseLessons.filter((lesson) => lesson.isRequired).map((lesson) => lesson.id);
          const nextLesson = courseLessons.find((lesson) => lesson.isRequired) ?? courseLessons[0] ?? null;
          return {
            id: course.id,
            agentId: null,
            courseId: course.id,
            status: "assigned" as const,
            dueDate: null,
            completedAt: null,
            course,
            progress: summariseAcademyProgress(requiredLessonIds, []),
            nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
            isOverdue: false,
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
      const attemptIds = attempts.map((attempt) => attempt.id);
      const responses = attemptIds.length
        ? await db.select().from(academyAssessmentResponses).where(inArray(academyAssessmentResponses.attemptId, attemptIds))
        : [];
      const questionResets = await db.select().from(academyAssessmentQuestionResets)
        .where(eq(academyAssessmentQuestionResets.enrollmentId, enrollment.id));
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
            questions: lesson.questions.map((question) => {
              const resit = deriveQuestionResitStates({
                questions: lesson.questions,
                attempts: attempts.filter((attempt) => attempt.lessonId === lesson.id),
                responses: responses.filter((response) => response.attemptId && attempts.some((attempt) => attempt.id === response.attemptId && attempt.lessonId === lesson.id)),
                resets: questionResets.filter((reset) => reset.lessonId === lesson.id),
                passMark: lesson.assessmentPassMark,
              }).find((state) => state.questionId === question.id)!;
              return { id: question.id, prompt: question.prompt, questionType: question.questionType, answerOptions: asOptions(question.answerOptions), maxWords: question.maxWords, sortOrder: question.sortOrder, resit };
            }),
            progress: progressByLesson.get(lesson.id) ?? null,
            attempts: (attemptsByLesson.get(lesson.id) ?? []).map((attempt) => ({
              id: attempt.id,
              status: attempt.status,
              score: attempt.score,
              passed: attempt.passed,
              graderFeedback: attempt.graderFeedback,
              feedbackAcknowledgedAt: attempt.feedbackAcknowledgedAt,
              takenAt: attempt.takenAt,
              responses: responses.filter((response) => response.attemptId === attempt.id).map((response) => ({ questionId: response.questionId, responseText: response.responseText, score: response.score, feedback: response.feedback })),
            })),
          })),
        })),
      };
    }),

    /** Read-only published-course preview for My Agent View. Correct answers and staff-only notes remain private. */
    previewCourse: adminProcedure.input(z.object({ courseId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, input.courseId)).limit(1);
      if (!course || course.status !== "published") throw new TRPCError({ code: "NOT_FOUND", message: "Course not available" });

      const structure = await courseStructure(course.id);
      const requiredLessonIds = structure.lessons.filter((lesson) => lesson.isRequired).map((lesson) => lesson.id);
      return {
        isPreview: true,
        enrollment: { id: 0, agentId: null, courseId: course.id, status: "assigned" as const, dueDate: null, completedAt: null },
        course,
        progress: summariseAcademyProgress(requiredLessonIds, []),
        modules: structure.modules.map((module) => ({
          ...module,
          lessons: module.lessons.map((lesson) => ({
            ...lesson,
            // Keep the preview safe: answer keys and private marking guides are never sent to the browser.
            questions: lesson.questions.map((question) => ({
              id: question.id,
              prompt: question.prompt,
              questionType: question.questionType,
              answerOptions: asOptions(question.answerOptions),
              maxWords: question.maxWords,
              sortOrder: question.sortOrder,
              resit: { questionId: question.id, attemptCount: 0, passed: false, awaitingMarking: false, feedbackPending: false, supportRequired: false, lastScore: null },
            })),
            progress: null,
            attempts: [],
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
        await ensureFeedbackAcknowledgedBeforeLesson(enrollment, input.lessonId);
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
        await ensureFeedbackAcknowledgedBeforeLesson(enrollment, lesson.id);
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

    submitAssessment: protectedProcedure.input(z.object({
      enrollmentId: z.number().int().positive(),
      lessonId: z.number().int().positive(),
      answers: z.array(z.object({
        questionId: z.number().int().positive(),
        selectedIndex: z.number().int().min(0).max(20).nullable().optional(),
        responseText: z.string().trim().min(1).max(20_000).nullable().optional(),
      })).min(1).max(50),
    }))
      .mutation(async ({ ctx, input }) => {
        const enrollment = await resolveEnrollmentForAgent(input.enrollmentId, ctx.user.id);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const { lessons } = await courseStructure(enrollment.courseId);
        const lesson = lessons.find((item) => item.id === input.lessonId);
        if (!lesson?.requiresAssessment) throw new TRPCError({ code: "BAD_REQUEST", message: "This lesson does not have an assessment" });
        await ensureFeedbackAcknowledgedBeforeLesson(enrollment, lesson.id);
        const questions = await db.select().from(academyQuestions).where(eq(academyQuestions.lessonId, lesson.id)).orderBy(asc(academyQuestions.sortOrder));
        if (!questions.length) throw new TRPCError({ code: "BAD_REQUEST", message: "No knowledge-check questions have been added yet" });
        const priorAttempts = await db.select().from(academyAssessmentAttempts)
          .where(and(eq(academyAssessmentAttempts.enrollmentId, enrollment.id), eq(academyAssessmentAttempts.lessonId, lesson.id)));
        const priorAttemptIds = priorAttempts.map((attempt) => attempt.id);
        const priorResponses = priorAttemptIds.length
          ? await db.select().from(academyAssessmentResponses).where(inArray(academyAssessmentResponses.attemptId, priorAttemptIds))
          : [];
        const questionResets = await db.select().from(academyAssessmentQuestionResets)
          .where(and(eq(academyAssessmentQuestionResets.enrollmentId, enrollment.id), eq(academyAssessmentQuestionResets.lessonId, lesson.id)));
        const resitStates = deriveQuestionResitStates({
          questions,
          attempts: priorAttempts,
          responses: priorResponses,
          resets: questionResets,
          passMark: lesson.assessmentPassMark,
        });
        const outstandingQuestions = questions.filter((question) => {
          const state = resitStates.find((item) => item.questionId === question.id)!;
          return !state.passed;
        });
        if (resitStates.some((state) => state.awaitingMarking || state.feedbackPending)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Wait for assessment feedback and acknowledge it before submitting a resit" });
        }
        if (resitStates.some((state) => state.supportRequired)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This assessment needs JLT team support before another attempt can be made" });
        }
        if (!outstandingQuestions.length) throw new TRPCError({ code: "BAD_REQUEST", message: "All questions in this assessment have already been passed" });
        const answers = new Map(input.answers.map((answer) => [answer.questionId, answer]));
        if (answers.size !== outstandingQuestions.length || outstandingQuestions.some((question) => !answers.has(question.id)) || Array.from(answers.keys()).some((questionId) => !outstandingQuestions.some((question) => question.id === questionId))) throw new TRPCError({ code: "BAD_REQUEST", message: "Please answer each outstanding question before submitting" });
        for (const question of outstandingQuestions) {
          const answer = answers.get(question.id)!;
          if (question.questionType === "free_text") {
            if (!answer.responseText?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Please complete every written response before submitting" });
            if (wordCount(answer.responseText) > question.maxWords) throw new TRPCError({ code: "BAD_REQUEST", message: `Written responses must be ${question.maxWords} words or fewer` });
          } else if (answer.selectedIndex === null || answer.selectedIndex === undefined || answer.selectedIndex >= asOptions(question.answerOptions).length) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Please choose an answer for every multiple-choice question" });
          }
        }
        const writtenQuestions = outstandingQuestions.filter((question) => question.questionType === "free_text");
        const correct = outstandingQuestions.filter((question) => question.questionType === "multiple_choice" && answers.get(question.id)?.selectedIndex === question.correctAnswerIndex).length;
        const score = writtenQuestions.length ? null : Math.round((correct / outstandingQuestions.length) * 100);
        const passed = score === null ? null : correct === outstandingQuestions.length;
        const now = new Date();
        const result = await db.insert(academyAssessmentAttempts).values({
          enrollmentId: enrollment.id,
          lessonId: lesson.id,
          status: writtenQuestions.length ? "awaiting_marking" : "auto_graded",
          score,
          passed,
          answers: input.answers,
          takenAt: now,
        } as any);
        const attemptId = Number((result as any).insertId);
        if (!Number.isSafeInteger(attemptId) || attemptId < 1) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Assessment submission was not assigned an ID" });
        await db.insert(academyAssessmentResponses).values(outstandingQuestions.map((question) => {
          const answer = answers.get(question.id)!;
          return {
            attemptId,
            questionId: question.id,
            selectedIndex: question.questionType === "multiple_choice" ? answer.selectedIndex ?? null : null,
            responseText: question.questionType === "free_text" ? answer.responseText?.trim() ?? null : null,
            score: question.questionType === "multiple_choice" ? (answer.selectedIndex === question.correctAnswerIndex ? 100 : 0) : null,
          };
        }) as any);
        const allAttempts = [...priorAttempts, { id: attemptId, enrollmentId: enrollment.id, lessonId: lesson.id, status: writtenQuestions.length ? "awaiting_marking" : "auto_graded", score, passed, answers: input.answers, takenAt: now }];
        const allResponses = [...priorResponses, ...outstandingQuestions.map((question) => ({
          attemptId,
          questionId: question.id,
          score: question.questionType === "multiple_choice" ? (answers.get(question.id)?.selectedIndex === question.correctAnswerIndex ? 100 : 0) : null,
        }))];
        const allQuestionStates = deriveQuestionResitStates({ questions, attempts: allAttempts, responses: allResponses, resets: questionResets, passMark: lesson.assessmentPassMark });
        const assessmentPassed = allQuestionStates.every((state) => state.passed);
        if (assessmentPassed) {
          const [existing] = await db.select().from(academyLessonProgress).where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, lesson.id))).limit(1);
          if (existing) await db.update(academyLessonProgress).set({ completedAt: now, lastViewedAt: now, startedAt: existing.startedAt ?? now }).where(eq(academyLessonProgress.id, existing.id));
          else await db.insert(academyLessonProgress).values({ enrollmentId: enrollment.id, lessonId: lesson.id, startedAt: now, lastViewedAt: now, completedAt: now } as any);
          if (enrollment.status === "assigned") await db.update(academyEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? now }).where(eq(academyEnrollments.id, enrollment.id));
          await recalculateCompletion(enrollment.id, ctx.user.id);
        }
        if (writtenQuestions.length) {
          await addAudit({ agentId: ctx.user.id, courseId: enrollment.courseId, enrollmentId: enrollment.id, actorId: ctx.user.id, action: "assessment_submitted_for_marking", summary: `Submitted ${writtenQuestions.length} outstanding written ${writtenQuestions.length === 1 ? "question" : "questions"} for ${lesson.title}`, metadata: { lessonId: lesson.id, attemptId, writtenQuestions: writtenQuestions.length } });
          return { attemptId, status: "awaiting_marking" as const, passMark: lesson.assessmentPassMark, correct, total: outstandingQuestions.length };
        }
        await addAudit({ agentId: ctx.user.id, courseId: enrollment.courseId, enrollmentId: enrollment.id, actorId: ctx.user.id, action: assessmentPassed ? "assessment_passed" : "assessment_resit_required", summary: `${assessmentPassed ? "Completed" : "Submitted"} ${outstandingQuestions.length === 1 ? "an outstanding question" : `${outstandingQuestions.length} outstanding questions`} for ${lesson.title}`, metadata: { lessonId: lesson.id, score, passed: assessmentPassed, outstandingQuestionIds: allQuestionStates.filter((state) => !state.passed).map((state) => state.questionId) } });
        return { attemptId, status: "auto_graded" as const, score, passed: assessmentPassed, passMark: lesson.assessmentPassMark, correct, total: outstandingQuestions.length };
      }),

    acknowledgeAssessmentFeedback: protectedProcedure.input(z.object({ attemptId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.select({ attempt: academyAssessmentAttempts, enrollment: academyEnrollments, lesson: academyLessons })
        .from(academyAssessmentAttempts)
        .innerJoin(academyEnrollments, eq(academyEnrollments.id, academyAssessmentAttempts.enrollmentId))
        .innerJoin(academyLessons, eq(academyLessons.id, academyAssessmentAttempts.lessonId))
        .where(and(eq(academyAssessmentAttempts.id, input.attemptId), eq(academyEnrollments.agentId, ctx.user.id))).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Assessment feedback not found" });
      if (row.attempt.status !== "feedback_pending") throw new TRPCError({ code: "BAD_REQUEST", message: "This feedback has already been acknowledged or is not ready yet" });
      const now = new Date();
      await db.update(academyAssessmentAttempts).set({ status: "feedback_acknowledged", feedbackAcknowledgedAt: now }).where(eq(academyAssessmentAttempts.id, row.attempt.id));
      if (row.attempt.passed) {
        const [existing] = await db.select().from(academyLessonProgress).where(and(eq(academyLessonProgress.enrollmentId, row.enrollment.id), eq(academyLessonProgress.lessonId, row.lesson.id))).limit(1);
        if (existing) await db.update(academyLessonProgress).set({ completedAt: now, lastViewedAt: now, startedAt: existing.startedAt ?? now }).where(eq(academyLessonProgress.id, existing.id));
        else await db.insert(academyLessonProgress).values({ enrollmentId: row.enrollment.id, lessonId: row.lesson.id, startedAt: now, lastViewedAt: now, completedAt: now } as any);
        if (row.enrollment.status === "assigned") await db.update(academyEnrollments).set({ status: "in_progress", startedAt: row.enrollment.startedAt ?? now }).where(eq(academyEnrollments.id, row.enrollment.id));
        await recalculateCompletion(row.enrollment.id, ctx.user.id);
      }
      await addAudit({ agentId: ctx.user.id, courseId: row.enrollment.courseId, enrollmentId: row.enrollment.id, actorId: ctx.user.id, action: "assessment_feedback_acknowledged", summary: `Acknowledged feedback for ${row.lesson.title}`, metadata: { attemptId: row.attempt.id, passed: row.attempt.passed, score: row.attempt.score } });
      return { success: true, passed: row.attempt.passed, score: row.attempt.score };
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

    markingQueue: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.select({ attempt: academyAssessmentAttempts, enrollment: academyEnrollments, lesson: academyLessons, course: academyCourses, agent: users })
        .from(academyAssessmentAttempts)
        .innerJoin(academyEnrollments, eq(academyEnrollments.id, academyAssessmentAttempts.enrollmentId))
        .innerJoin(academyLessons, eq(academyLessons.id, academyAssessmentAttempts.lessonId))
        .innerJoin(academyModules, eq(academyModules.id, academyLessons.moduleId))
        .innerJoin(academyCourses, eq(academyCourses.id, academyModules.courseId))
        .innerJoin(users, eq(users.id, academyEnrollments.agentId))
        .where(eq(academyAssessmentAttempts.status, "awaiting_marking"))
        .orderBy(asc(academyAssessmentAttempts.takenAt));
      const attemptIds = rows.map((row) => row.attempt.id);
      const lessonIds = Array.from(new Set(rows.map((row) => row.lesson.id)));
      const responses = attemptIds.length ? await db.select().from(academyAssessmentResponses).where(inArray(academyAssessmentResponses.attemptId, attemptIds)) : [];
      const questions = lessonIds.length ? await db.select().from(academyQuestions).where(inArray(academyQuestions.lessonId, lessonIds)).orderBy(asc(academyQuestions.sortOrder)) : [];
      return rows.map((row) => ({
        attempt: row.attempt,
        enrollment: { id: row.enrollment.id, agentId: row.enrollment.agentId, courseId: row.enrollment.courseId },
        course: { id: row.course.id, title: row.course.title },
        lesson: { id: row.lesson.id, title: row.lesson.title, assessmentPassMark: row.lesson.assessmentPassMark },
        agent: { id: row.agent.id, name: row.agent.name, email: row.agent.email },
        responses: questions.filter((question) => question.lessonId === row.lesson.id && question.questionType === "free_text" && responses.some((item) => item.attemptId === row.attempt.id && item.questionId === question.id)).map((question) => {
          const response = responses.find((item) => item.attemptId === row.attempt.id && item.questionId === question.id);
          // The marking guide is deliberately available only in this admin-only queue.
          return { questionId: question.id, prompt: question.prompt, explanation: question.explanation, responseText: response?.responseText ?? "", maxWords: question.maxWords };
        }),
      }));
    }),

    markWrittenAssessment: adminProcedure.input(z.object({
      attemptId: z.number().int().positive(),
      feedback: z.string().trim().min(3).max(10_000),
      responses: z.array(z.object({ questionId: z.number().int().positive(), score: z.number().int().min(0).max(100), feedback: z.string().trim().min(3).max(10_000) })).min(1).max(50),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.select({ attempt: academyAssessmentAttempts, enrollment: academyEnrollments, lesson: academyLessons, course: academyCourses, agent: users })
        .from(academyAssessmentAttempts)
        .innerJoin(academyEnrollments, eq(academyEnrollments.id, academyAssessmentAttempts.enrollmentId))
        .innerJoin(academyLessons, eq(academyLessons.id, academyAssessmentAttempts.lessonId))
        .innerJoin(academyModules, eq(academyModules.id, academyLessons.moduleId))
        .innerJoin(academyCourses, eq(academyCourses.id, academyModules.courseId))
        .innerJoin(users, eq(users.id, academyEnrollments.agentId))
        .where(eq(academyAssessmentAttempts.id, input.attemptId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Assessment submission not found" });
      if (row.attempt.status !== "awaiting_marking") throw new TRPCError({ code: "BAD_REQUEST", message: "This written assessment has already been marked" });
      const questions = await db.select().from(academyQuestions).where(eq(academyQuestions.lessonId, row.lesson.id)).orderBy(asc(academyQuestions.sortOrder));
      const currentResponses = await db.select().from(academyAssessmentResponses).where(eq(academyAssessmentResponses.attemptId, row.attempt.id));
      const writtenQuestions = questions.filter((question) => question.questionType === "free_text" && currentResponses.some((response) => response.questionId === question.id));
      const grades = new Map(input.responses.map((response) => [response.questionId, response]));
      if (grades.size !== writtenQuestions.length || writtenQuestions.some((question) => !grades.has(question.id))) throw new TRPCError({ code: "BAD_REQUEST", message: "Score and feedback are required for every written response" });
      if (writtenQuestions.some((question) => !currentResponses.some((response) => response.questionId === question.id))) throw new TRPCError({ code: "BAD_REQUEST", message: "One or more written responses could not be found" });
      const now = new Date();
      for (const question of writtenQuestions) {
        const grade = grades.get(question.id)!;
        await db.update(academyAssessmentResponses).set({ score: grade.score, feedback: grade.feedback, gradedById: ctx.user.id, gradedAt: now })
          .where(and(eq(academyAssessmentResponses.attemptId, row.attempt.id), eq(academyAssessmentResponses.questionId, question.id)));
      }
      const attempts = await db.select().from(academyAssessmentAttempts)
        .where(and(eq(academyAssessmentAttempts.enrollmentId, row.enrollment.id), eq(academyAssessmentAttempts.lessonId, row.lesson.id)));
      const attemptIds = attempts.map((attempt) => attempt.id);
      const responses = attemptIds.length ? await db.select().from(academyAssessmentResponses).where(inArray(academyAssessmentResponses.attemptId, attemptIds)) : [];
      const resets = await db.select().from(academyAssessmentQuestionResets)
        .where(and(eq(academyAssessmentQuestionResets.enrollmentId, row.enrollment.id), eq(academyAssessmentQuestionResets.lessonId, row.lesson.id)));
      const currentAttempt = attempts.find((attempt) => attempt.id === row.attempt.id)!;
      const allAttempts = attempts.map((attempt) => attempt.id === row.attempt.id ? { ...attempt, status: "feedback_pending" } : attempt);
      const states = deriveQuestionResitStates({ questions, attempts: allAttempts, responses, resets, passMark: row.lesson.assessmentPassMark });
      const score = Math.round(states.reduce((total, state) => total + (state.lastScore ?? 0), 0) / Math.max(states.length, 1));
      const passed = states.every((state) => state.passed);
      await db.update(academyAssessmentAttempts).set({ status: "feedback_pending", score, passed, graderFeedback: input.feedback, gradedById: ctx.user.id, gradedAt: now }).where(eq(academyAssessmentAttempts.id, currentAttempt.id));
      await createInAppNotification({ userId: row.agent.id, message: `Your ${row.course.title} assessment feedback is ready. Please read and acknowledge it before continuing.`, linkUrl: `/academy/course/${row.enrollment.id}`, isUrgent: true });
      await addAudit({ agentId: row.agent.id, courseId: row.course.id, enrollmentId: row.enrollment.id, actorId: ctx.user.id, action: "assessment_marked", summary: `Marked ${writtenQuestions.length} written ${writtenQuestions.length === 1 ? "response" : "responses"} for ${row.lesson.title} (${score}% — ${passed ? "passed" : "targeted resit needed"})`, metadata: { attemptId: row.attempt.id, score, passed, passMark: row.lesson.assessmentPassMark, outstandingQuestionIds: states.filter((state) => !state.passed).map((state) => state.questionId) } });
      return { score, passed, passMark: row.lesson.assessmentPassMark };
    }),

    supportQueue: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.select({ attempt: academyAssessmentAttempts, enrollment: academyEnrollments, lesson: academyLessons, course: academyCourses, agent: users })
        .from(academyAssessmentAttempts)
        .innerJoin(academyEnrollments, eq(academyEnrollments.id, academyAssessmentAttempts.enrollmentId))
        .innerJoin(academyLessons, eq(academyLessons.id, academyAssessmentAttempts.lessonId))
        .innerJoin(academyModules, eq(academyModules.id, academyLessons.moduleId))
        .innerJoin(academyCourses, eq(academyCourses.id, academyModules.courseId))
        .innerJoin(users, eq(users.id, academyEnrollments.agentId));
      const enrollmentIds = Array.from(new Set(rows.map((row) => row.enrollment.id)));
      const lessonIds = Array.from(new Set(rows.map((row) => row.lesson.id)));
      const attemptIds = rows.map((row) => row.attempt.id);
      const responses = attemptIds.length ? await db.select().from(academyAssessmentResponses).where(inArray(academyAssessmentResponses.attemptId, attemptIds)) : [];
      const questions = lessonIds.length ? await db.select().from(academyQuestions).where(inArray(academyQuestions.lessonId, lessonIds)).orderBy(asc(academyQuestions.sortOrder)) : [];
      const resets = enrollmentIds.length ? await db.select().from(academyAssessmentQuestionResets).where(inArray(academyAssessmentQuestionResets.enrollmentId, enrollmentIds)) : [];
      const grouped = new Map<string, typeof rows>();
      for (const row of rows) {
        const key = `${row.enrollment.id}:${row.lesson.id}`;
        grouped.set(key, [...(grouped.get(key) ?? []), row]);
      }
      return Array.from(grouped.values()).flatMap((group) => {
        const first = group[0]!;
        const lessonQuestions = questions.filter((question) => question.lessonId === first.lesson.id);
        const states = deriveQuestionResitStates({
          questions: lessonQuestions,
          attempts: group.map((item) => item.attempt),
          responses: responses.filter((response) => group.some((item) => item.attempt.id === response.attemptId)),
          resets: resets.filter((reset) => reset.enrollmentId === first.enrollment.id && reset.lessonId === first.lesson.id),
          passMark: first.lesson.assessmentPassMark,
        });
        return states.filter((state) => state.supportRequired).map((state) => {
          const question = lessonQuestions.find((item) => item.id === state.questionId)!;
          return {
            enrollment: { id: first.enrollment.id, agentId: first.enrollment.agentId, courseId: first.enrollment.courseId },
            agent: { id: first.agent.id, name: first.agent.name, email: first.agent.email },
            course: { id: first.course.id, title: first.course.title },
            lesson: { id: first.lesson.id, title: first.lesson.title, assessmentPassMark: first.lesson.assessmentPassMark },
            // Include the private guide so staff can give focused coaching before reopening.
            question: { id: question.id, prompt: question.prompt, explanation: question.explanation, questionType: question.questionType },
            attemptCount: state.attemptCount,
            lastScore: state.lastScore,
          };
        });
      });
    }),

    resetQuestionAttempts: adminProcedure.input(z.object({
      enrollmentId: z.number().int().positive(),
      lessonId: z.number().int().positive(),
      questionId: z.number().int().positive(),
      reason: z.string().trim().min(3).max(10_000),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [enrollment] = await db.select().from(academyEnrollments).where(eq(academyEnrollments.id, input.enrollmentId)).limit(1);
      const [lesson] = await db.select().from(academyLessons).where(eq(academyLessons.id, input.lessonId)).limit(1);
      const [question] = await db.select().from(academyQuestions).where(and(eq(academyQuestions.id, input.questionId), eq(academyQuestions.lessonId, input.lessonId))).limit(1);
      if (!enrollment || !lesson || !question) throw new TRPCError({ code: "NOT_FOUND", message: "Assessment question not found" });
      const [module] = await db.select().from(academyModules).where(and(eq(academyModules.id, lesson.moduleId), eq(academyModules.courseId, enrollment.courseId))).limit(1);
      if (!module) throw new TRPCError({ code: "FORBIDDEN", message: "Question does not belong to this enrolment" });
      const attempts = await db.select().from(academyAssessmentAttempts)
        .where(and(eq(academyAssessmentAttempts.enrollmentId, enrollment.id), eq(academyAssessmentAttempts.lessonId, lesson.id)));
      const attemptIds = attempts.map((attempt) => attempt.id);
      const responses = attemptIds.length ? await db.select().from(academyAssessmentResponses).where(inArray(academyAssessmentResponses.attemptId, attemptIds)) : [];
      const resets = await db.select().from(academyAssessmentQuestionResets)
        .where(and(eq(academyAssessmentQuestionResets.enrollmentId, enrollment.id), eq(academyAssessmentQuestionResets.lessonId, lesson.id)));
      const state = deriveQuestionResitStates({ questions: [question], attempts, responses, resets, passMark: lesson.assessmentPassMark })[0]!;
      if (!state.supportRequired) throw new TRPCError({ code: "BAD_REQUEST", message: "Only questions that have reached three unsuccessful attempts can be reset for support" });
      const now = new Date();
      await db.insert(academyAssessmentQuestionResets).values({ enrollmentId: enrollment.id, lessonId: lesson.id, questionId: question.id, resetById: ctx.user.id, reason: input.reason } as any);
      await db.update(academyLessonProgress).set({ completedAt: null, lastViewedAt: now }).where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, lesson.id)));
      await db.update(academyEnrollments).set({ status: "in_progress", completedAt: null, completionOutcomeAppliedAt: null }).where(eq(academyEnrollments.id, enrollment.id));
      await createInAppNotification({ userId: enrollment.agentId, message: `Your JLT Academy question in ${lesson.title} has been reopened following support. Please try it again when you are ready.`, linkUrl: `/academy/course/${enrollment.id}`, isUrgent: true });
      await addAudit({ agentId: enrollment.agentId, courseId: enrollment.courseId, enrollmentId: enrollment.id, actorId: ctx.user.id, action: "assessment_question_reset", summary: `Reset question after three unsuccessful attempts: ${question.prompt}`, metadata: { lessonId: lesson.id, questionId: question.id, reason: input.reason, previousAttempts: state.attemptCount } });
      return { success: true };
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
      // TiDB accepts this exact prepared statement, while Drizzle's all-column
      // DEFAULT projection has failed on production for newly-created records.
      const pool = await getRawDbPool();
      if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [result] = await pool.execute(
        `INSERT INTO academy_courses
          (title, summary, coverImageUrl, isCoreAcademy, estimatedMinutes, createdById, updatedById)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [payload.title, payload.summary, payload.coverImageUrl, payload.isCoreAcademy, payload.estimatedMinutes, ctx.user.id, ctx.user.id],
      );
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
        const [module] = await db.select().from(academyModules).where(and(eq(academyModules.id, input.id), eq(academyModules.courseId, input.courseId))).limit(1);
        if (!module) throw new TRPCError({ code: "NOT_FOUND", message: "Module not found" });
        await db.update(academyModules).set({ title: input.title, summary: normaliseOptionalText(input.summary) }).where(and(eq(academyModules.id, input.id), eq(academyModules.courseId, input.courseId)));
        await addAudit({ courseId: input.courseId, actorId: ctx.user.id, action: "module_updated", summary: `Updated module: ${input.title}` });
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
        const [lesson] = await db.select().from(academyLessons).where(and(eq(academyLessons.id, input.id), eq(academyLessons.moduleId, input.moduleId))).limit(1);
        if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
        await db.update(academyLessons).set(payload as any).where(and(eq(academyLessons.id, input.id), eq(academyLessons.moduleId, input.moduleId)));
        await addAudit({ courseId: module.courseId, actorId: ctx.user.id, action: "lesson_updated", summary: `Updated lesson: ${input.title}` });
        return { id: input.id };
      }
      const existing = await db.select().from(academyLessons).where(eq(academyLessons.moduleId, input.moduleId)).orderBy(desc(academyLessons.sortOrder)).limit(1);
      // TiDB's Drizzle insert result does not reliably expose insertId. Use the
      // native prepared statement so a new lesson can be immediately linked to
      // its knowledge-check questions without sending a NaN lessonId to tRPC.
      const pool = await getRawDbPool();
      if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [result] = await pool.execute(
        `INSERT INTO academy_lessons
          (moduleId, title, summary, contentHtml, videoUrl, attachmentUrl, attachmentKey, attachmentName, estimatedMinutes, isRequired, requiresAcknowledgement, requiresAssessment, assessmentPassMark, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.moduleId,
          payload.title,
          payload.summary,
          payload.contentHtml,
          payload.videoUrl,
          payload.attachmentUrl,
          payload.attachmentKey,
          payload.attachmentName,
          payload.estimatedMinutes,
          payload.isRequired,
          payload.requiresAcknowledgement,
          payload.requiresAssessment,
          payload.assessmentPassMark,
          (existing[0]?.sortOrder ?? -1) + 1,
        ],
      );
      const id = Number((result as any).insertId);
      if (!Number.isSafeInteger(id) || id < 1) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Academy lesson insert did not return an ID" });
      }
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

    replaceQuestions: adminProcedure.input(z.object({
      lessonId: z.number().int().positive(),
      questions: z.array(z.object({
        id: z.number().int().positive().optional(),
        prompt: z.string().trim().min(4).max(10_000),
        questionType: z.enum(["multiple_choice", "free_text"]).default("multiple_choice"),
        // Written responses deliberately carry no answer options. Validation
        // below requires non-empty choices only when the question uses them.
        answerOptions: z.array(z.string().trim().max(500)).max(8).default([]),
        correctAnswerIndex: z.number().int().min(0).max(7).default(0),
        maxWords: z.number().int().min(10).max(2_000).default(250),
        explanation: z.string().trim().max(10_000).nullable().optional(),
      })).max(30),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [lesson] = await db.select().from(academyLessons).where(eq(academyLessons.id, input.lessonId)).limit(1);
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      if (input.questions.some((question) => question.questionType === "multiple_choice" && (question.answerOptions.length < 2 || question.answerOptions.some((option) => !option.trim()) || question.correctAnswerIndex >= question.answerOptions.length))) throw new TRPCError({ code: "BAD_REQUEST", message: "Each multiple-choice question needs at least two completed answers and one correct answer" });
      await db.delete(academyQuestions).where(eq(academyQuestions.lessonId, input.lessonId));
      if (input.questions.length) await db.insert(academyQuestions).values(input.questions.map((question, sortOrder) => ({
        lessonId: input.lessonId,
        prompt: question.prompt,
        questionType: question.questionType,
        answerOptions: question.questionType === "multiple_choice" ? question.answerOptions : [],
        correctAnswerIndex: question.questionType === "multiple_choice" ? question.correctAnswerIndex : 0,
        maxWords: question.maxWords,
        explanation: normaliseOptionalText(question.explanation),
        sortOrder,
      })) as any);
      const [module] = await db.select().from(academyModules).where(eq(academyModules.id, lesson.moduleId)).limit(1);
      await addAudit({ courseId: module?.courseId ?? null, actorId: ctx.user.id, action: "assessment_updated", summary: `Updated knowledge check: ${lesson.title}`, metadata: { questionCount: input.questions.length } });
      return { success: true };
    }),

    importMultipleChoiceQuestions: adminProcedure.input(z.object({
      lessonId: z.number().int().positive(),
      csvText: z.string().min(1).max(500_000),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [lesson] = await db.select().from(academyLessons).where(eq(academyLessons.id, input.lessonId)).limit(1);
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      if (!lesson.requiresAssessment) throw new TRPCError({ code: "BAD_REQUEST", message: "Turn on the knowledge check for this lesson before importing questions" });

      let questions;
      try {
        questions = parseMultipleChoiceQuizCsv(input.csvText);
      } catch (error) {
        if (error instanceof QuizCsvImportError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: { rowErrors: error.rowErrors } });
        }
        throw error;
      }

      const existing = await db.select({ id: academyQuestions.id, sortOrder: academyQuestions.sortOrder })
        .from(academyQuestions).where(eq(academyQuestions.lessonId, lesson.id)).orderBy(desc(academyQuestions.sortOrder), desc(academyQuestions.id));
      if (existing.length + questions.length > 30) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `This import would create ${existing.length + questions.length} questions. A knowledge check can contain up to 30 questions.` });
      }
      await db.insert(academyQuestions).values(questions.map((question, index) => ({
        lessonId: lesson.id,
        prompt: question.prompt,
        questionType: question.questionType,
        answerOptions: question.answerOptions,
        correctAnswerIndex: question.correctAnswerIndex,
        maxWords: question.maxWords,
        explanation: question.explanation,
        sortOrder: (existing[0]?.sortOrder ?? -1) + index + 1,
      })) as any);
      const [module] = await db.select().from(academyModules).where(eq(academyModules.id, lesson.moduleId)).limit(1);
      await addAudit({ courseId: module?.courseId ?? null, actorId: ctx.user.id, action: "assessment_questions_imported", summary: `Imported ${questions.length} multiple-choice ${questions.length === 1 ? "question" : "questions"} into ${lesson.title}`, metadata: { lessonId: lesson.id, importedQuestionCount: questions.length } });
      return { imported: questions.length, questionCount: existing.length + questions.length };
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
