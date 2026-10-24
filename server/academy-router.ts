import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb, getRawDbPool, createInAppNotification, getUpcomingAgentEvents } from "./db";
import { sendDirectEmail, sendSupportEmail } from "./email";
import { storagePut } from "./storage";
import {
  academyAccess,
  academyAssessmentAttempts,
  academyAssessmentResponses,
  academyAssessmentQuestionResets,
  academyAuditLog,
  academyCourses,
  academyEmailAlertDeliveries,
  academyEmailAlerts,
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
import { MAX_ACADEMY_ASSESSMENT_QUESTIONS, parseMultipleChoiceQuizCsv, QuizCsvImportError } from "../shared/academy-quiz-csv";
import { buildAcademyLearningPath } from "../shared/academy-learning-path";
import { assignAcceleratorEntryActions, releaseAvailableJourneyActions } from "./agent-development-router";
import { ACCELERATOR_JOURNEY_WEEKS, acceleratorWeekReleaseLabel, isAcceleratorWeekAvailable } from "./academy-journey";
import {
  ACADEMY_ALERT_EVENTS,
  academyAlertAllowsModuleScope,
  academyAlertTemplateHint,
  dispatchAcademyEmailAlerts,
  hasActiveAcademySupportAlert,
} from "./academy-email-alerts";
import {
  ACADEMY_AI_MARKING_MODEL,
  ACADEMY_AI_REVIEW_AUDIT_ACTION,
  buildAcademyAiMarkingPrompt,
  parseAcademyAiMarkingAuditMetadata,
  parseAcademyAiMarkingResponse,
  splitAcademyAiMarkingQuestions,
} from "./academy-ai-marking";

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
  isAcceleratorJourney: z.boolean().default(false),
  estimatedMinutes: z.number().int().min(0).max(10_000).default(0),
});

const lessonInput = z.object({
  id: z.number().int().positive().optional(),
  moduleId: z.number().int().positive(),
  title: z.string().trim().min(2).max(255),
  summary: z.string().trim().max(10_000).nullable().optional(),
  contentHtml: z.string().max(500_000).nullable().optional(),
  videoUrl: z.string().trim().max(1200).nullable().optional(),
  // Preserve Loom's timestamp lines exactly. This private field is never sent
  // to agents; it will form a cited Academy knowledge source for the chatbot.
  videoTranscript: z.string().max(1_000_000).nullable().optional(),
  attachmentUrl: z.string().trim().max(10_000).nullable().optional(),
  attachmentKey: z.string().trim().max(600).nullable().optional(),
  attachmentName: z.string().trim().max(255).nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(1_440).default(5),
  isRequired: z.boolean().default(true),
  requiresAcknowledgement: z.boolean().default(false),
  requiresAssessment: z.boolean().default(false),
  // Academy progression is deliberately 100%. Retain the field for legacy
  // records, but make the authoring contract reflect the actual learner rule.
  assessmentPassMark: z.number().int().min(1).max(100).default(100),
});

function normaliseOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function preserveOptionalTranscript(value: string | null | undefined) {
  return value?.trim() ? value : null;
}

const ACADEMY_PORTAL_URL = "https://portal.thejltgroup.co.uk";

function escapeAcademyEmailHtml(value: string | null | undefined) {
  return (value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function sendAcademySupportAlert(params: {
  subject: string;
  agentName: string | null;
  agentEmail: string | null;
  courseTitle: string;
  lessonTitle: string;
  detail: string;
}) {
  const agentName = escapeAcademyEmailHtml(params.agentName || "Agent");
  const agentEmail = escapeAcademyEmailHtml(params.agentEmail || "No email recorded");
  const courseTitle = escapeAcademyEmailHtml(params.courseTitle);
  const lessonTitle = escapeAcademyEmailHtml(params.lessonTitle);
  const detail = escapeAcademyEmailHtml(params.detail);
  await sendSupportEmail({
    subject: params.subject,
    html: `<h2>Academy support review needed</h2><p><strong>Agent:</strong> ${agentName} (${agentEmail})</p><p><strong>Course:</strong> ${courseTitle}<br/><strong>Lesson:</strong> ${lessonTitle}</p><p>${detail}</p><p><a href="${ACADEMY_PORTAL_URL}/admin/academy">Open Academy Manager</a></p>`,
  });
}

async function sendAcademyAgentEmail(params: {
  userId: number;
  email: string | null;
  name: string | null;
  subject: string;
  html: string;
  triggerKey: string;
}) {
  if (!params.email) return;
  await sendDirectEmail({
    toEmail: params.email,
    toName: params.name ?? "JLT Agent",
    userId: params.userId,
    subject: params.subject,
    html: params.html,
    triggerKey: params.triggerKey,
  });
}

/**
 * Migration 0157 adds private Loom transcripts. A Railway deployment can be
 * serving newer code while its additive column is still awaiting application;
 * the Academy itself must remain readable in that state. Keep the fallback
 * narrow so an unrelated database fault is never hidden.
 */
export function isMissingAcademyTranscriptColumn(error: unknown) {
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();
  let sawMissingColumn = false;
  let sawTranscript = false;
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    const candidate = current as { code?: string; message?: string; cause?: unknown; errors?: unknown[] };
    const detail = `${candidate.code ?? ""}\n${candidate.message ?? ""}`;
    sawMissingColumn ||= candidate.code === "ER_BAD_FIELD_ERROR" || candidate.code === "ER_NO_SUCH_COLUMN" || /unknown column/i.test(detail);
    sawTranscript ||= /videoTranscript/i.test(detail);
    if (candidate.cause) pending.push(candidate.cause);
    if (Array.isArray(candidate.errors)) pending.push(...candidate.errors);
  }
  return sawMissingColumn && sawTranscript;
}

const legacyAcademyLessonColumns = {
  id: academyLessons.id,
  moduleId: academyLessons.moduleId,
  title: academyLessons.title,
  summary: academyLessons.summary,
  contentHtml: academyLessons.contentHtml,
  videoUrl: academyLessons.videoUrl,
  attachmentUrl: academyLessons.attachmentUrl,
  attachmentKey: academyLessons.attachmentKey,
  attachmentName: academyLessons.attachmentName,
  estimatedMinutes: academyLessons.estimatedMinutes,
  isRequired: academyLessons.isRequired,
  requiresAcknowledgement: academyLessons.requiresAcknowledgement,
  requiresAssessment: academyLessons.requiresAssessment,
  assessmentPassMark: academyLessons.assessmentPassMark,
  sortOrder: academyLessons.sortOrder,
  createdAt: academyLessons.createdAt,
  updatedAt: academyLessons.updatedAt,
};

type AcademyLesson = typeof academyLessons.$inferSelect;

async function getAcademyLessonsForModules(moduleIds: number[]): Promise<AcademyLesson[]> {
  if (!moduleIds.length) return [];
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    return await db.select().from(academyLessons).where(inArray(academyLessons.moduleId, moduleIds))
      .orderBy(asc(academyLessons.sortOrder), asc(academyLessons.id));
  } catch (error) {
    if (!isMissingAcademyTranscriptColumn(error)) throw error;
    const legacyLessons = await db.select(legacyAcademyLessonColumns).from(academyLessons)
      .where(inArray(academyLessons.moduleId, moduleIds))
      .orderBy(asc(academyLessons.sortOrder), asc(academyLessons.id));
    // Preserve every pre-existing lesson field. Only the optional private
    // transcript is absent while the additive Railway migration catches up.
    return legacyLessons.map((lesson) => ({ ...lesson, videoTranscript: null } as AcademyLesson));
  }
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
const REQUIRED_ASSESSMENT_SCORE = 100;

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
    // Academy progression is deliberately mastery-based: every automatic or
    // staff-marked answer needs 100% before the learner can move forward.
    const passed = lastScore !== null && lastScore >= REQUIRED_ASSESSMENT_SCORE;
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
  const rawLessons = await getAcademyLessonsForModules(moduleIds);
  // The database lesson query is necessarily cross-module. Rebuild the flat
  // course path module first, then lesson order, so every learner and server
  // prerequisite gate shares one deterministic sequence.
  const lessons = modules.flatMap((module) => rawLessons.filter((lesson) => lesson.moduleId === module.id));
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

/**
 * Course content is evidence once a learner has opened it or submitted an
 * assessment. We keep the original records intact rather than hard-deleting
 * them underneath a learner's progress, feedback or staff audit trail.
 */
async function hasAcademyLearnerEvidence(lessonIds: number[]) {
  if (!lessonIds.length) return false;
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [progress] = await db.select({ id: academyLessonProgress.id })
    .from(academyLessonProgress).where(inArray(academyLessonProgress.lessonId, lessonIds)).limit(1);
  if (progress) return true;
  const [attempt] = await db.select({ id: academyAssessmentAttempts.id })
    .from(academyAssessmentAttempts).where(inArray(academyAssessmentAttempts.lessonId, lessonIds)).limit(1);
  return !!attempt;
}

async function enrolAgentInCourse(params: {
  agentId: number;
  courseId: number;
  enrolledById: number;
  dueDate?: Date | null;
  journeyStartedAt?: Date | null;
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

  // Drizzle's TiDB insert result does not reliably expose insertId here. A
  // valid enrolment ID is required immediately for the learner record and its
  // audit event, so use the provider-compatible prepared insert instead.
  const pool = await getRawDbPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [insertResult] = await pool.execute(
    `INSERT INTO academy_enrollments
      (agentId, courseId, enrolledById, journeyStartedAt, dueDate)
     VALUES (?, ?, ?, ?, ?)`,
    [
      params.agentId,
      params.courseId,
      params.enrolledById,
      course.isAcceleratorJourney ? (params.journeyStartedAt ?? new Date()) : null,
      params.dueDate ?? null,
    ],
  );
  const enrollmentId = Number((insertResult as any).insertId);
  if (!Number.isSafeInteger(enrollmentId) || enrollmentId < 1) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Academy enrolment insert did not return an ID" });
  }
  const [enrollment] = await db.select().from(academyEnrollments).where(eq(academyEnrollments.id, enrollmentId)).limit(1);
  if (!enrollment) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Academy enrolment could not be reloaded after creation" });
  }
  await addAudit({
    agentId: params.agentId,
    courseId: params.courseId,
    enrollmentId,
    actorId: params.enrolledById,
    action: "enrolled",
    summary: `Assigned ${course.title} to ${agent.name ?? "agent"}`,
    metadata: { dueDate: params.dueDate?.toISOString() ?? null, journeyStartedAt: course.isAcceleratorJourney ? (params.journeyStartedAt ?? new Date()).toISOString() : null },
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
        userId: params.agentId,
        subject: `Your JLT Academy access is ready — ${course.title}`,
        html: `<p>Hi ${(agent.name ?? "there").split(" ")[0]},</p><p>You have been enrolled in <strong>${course.title}</strong>.</p>${params.dueDate ? `<p>Please complete it by <strong>${params.dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</strong>.</p>` : ""}<p><a href="${portalUrl}">Open JLT Academy</a></p>`,
      });
    }
  }
  return { enrollment, created: true };
}

/**
 * Starts every published Agent Accelerator journey for one agent. The unique
 * enrolment key makes stage-save retries and repeated CRM edits harmless.
 */
export async function enrolAgentInAcceleratorJourneys(params: { agentId: number; actorId: number; startedAt?: Date }) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const startedAt = params.startedAt ?? new Date();
  const journeys = await db.select().from(academyCourses).where(and(
    eq(academyCourses.status, "published"),
    eq(academyCourses.isAcceleratorJourney, true),
  ));
  let enrolled = 0;
  for (const course of journeys) {
    const result = await enrolAgentInCourse({
      agentId: params.agentId,
      courseId: course.id,
      enrolledById: params.actorId,
      journeyStartedAt: startedAt,
    });
    if (result.created) enrolled++;
  }
  return { enrolled };
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
  const [access] = await db.select({ status: academyAccess.status }).from(academyAccess)
    .where(eq(academyAccess.agentId, agentId)).limit(1);
  if (access?.status !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Academy access is not active" });
  }
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

/**
 * The learner UI labels locked material, but this server-side guard is the
 * authority. It prevents direct tRPC calls from opening, completing or
 * submitting work for any unfinished material after the current required step.
 */
async function ensureSequentialAcademyLessonAccess(enrollment: { id: number; courseId: number }, lessonId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [course] = await db.select({ isAcceleratorJourney: academyCourses.isAcceleratorJourney }).from(academyCourses).where(eq(academyCourses.id, enrollment.courseId)).limit(1);
  const [fullEnrollment] = await db.select({ journeyStartedAt: academyEnrollments.journeyStartedAt }).from(academyEnrollments).where(eq(academyEnrollments.id, enrollment.id)).limit(1);
  const { lessons, modules } = await courseStructure(enrollment.courseId);
  const target = lessons.find((lesson) => lesson.id === lessonId);
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
  const targetModule = modules.find((module) => module.id === target.moduleId);
  if (course?.isAcceleratorJourney && targetModule && !isAcceleratorWeekAvailable(fullEnrollment?.journeyStartedAt, targetModule.releaseWeek)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This section is scheduled for ${acceleratorWeekReleaseLabel(fullEnrollment?.journeyStartedAt, targetModule.releaseWeek)}.`,
    });
  }

  const progress = await db.select({ lessonId: academyLessonProgress.lessonId, completedAt: academyLessonProgress.completedAt })
    .from(academyLessonProgress).where(eq(academyLessonProgress.enrollmentId, enrollment.id));
  const completedLessonIds = new Set(progress.filter((item) => !!item.completedAt).map((item) => item.lessonId));
  const path = buildAcademyLearningPath(lessons.map((lesson) => ({
    id: lesson.id,
    isRequired: lesson.isRequired,
    completed: completedLessonIds.has(lesson.id),
  })));
  if (path.lockedLessonIds.has(lessonId)) {
    const blockingLesson = lessons.find((lesson) => lesson.id === path.currentRequiredLessonId);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Complete ${blockingLesson?.title ?? "the current lesson"} before continuing.`,
    });
  }
  return { lessons, target, progress, path };
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
    await enrolAgentInAcceleratorJourneys({ agentId: enrollment.agentId, actorId, startedAt: now });
    // A new Accelerator agent receives only the designated entry action. Weekly
    // plans are intentionally not backfilled, so the first week is manageable.
    await assignAcceleratorEntryActions(enrollment.agentId, actorId);
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
  const [agent] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, enrollment.agentId)).limit(1);
  if (course) void dispatchAcademyEmailAlerts({
    eventType: "course_completed",
    eventKey: "course-completed",
    enrollmentId,
    courseId: course.id,
    courseTitle: course.title,
    agentId: enrollment.agentId,
    agentName: agent?.name ?? null,
    agentEmail: agent?.email ?? null,
  }).catch((error) => console.error("[Academy] Course-completion alert dispatch failed:", error));
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
      const lessons = await getAcademyLessonsForModules(moduleIds);
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
     * Read-only Academy home for staff using My Agent View. This mirrors a current
     * agent, while also allowing staff to inspect unpublished draft material,
     * without creating Academy access, enrolments, progress, attempts, notices
     * or CRM-stage changes for the staff account.
     */
    previewHome: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const courses = await db.select().from(academyCourses)
        .where(inArray(academyCourses.status, ["draft", "published"]))
        .orderBy(asc(academyCourses.title));
      const courseIds = courses.map((course) => course.id);
      const modules = courseIds.length
        ? await db.select().from(academyModules).where(inArray(academyModules.courseId, courseIds)).orderBy(asc(academyModules.sortOrder))
        : [];
      const moduleIds = modules.map((module) => module.id);
      const lessons = await getAcademyLessonsForModules(moduleIds);
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
      if (course.isAcceleratorJourney) await releaseAvailableJourneyActions();
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
      const learningPath = buildAcademyLearningPath(structure.lessons.map((lesson) => ({
        id: lesson.id,
        isRequired: lesson.isRequired,
        completed: !!progressByLesson.get(lesson.id)?.completedAt,
      })));
      const requiredLessons = structure.lessons.filter((lesson) => lesson.isRequired).map((lesson) => lesson.id);
      const summary = summariseAcademyProgress(requiredLessons, progress.filter((item) => item.completedAt).map((item) => item.lessonId));
      return {
        enrollment,
        course,
        progress: summary,
        modules: structure.modules.map((module) => {
          const releaseLocked = course.isAcceleratorJourney && !isAcceleratorWeekAvailable(enrollment.journeyStartedAt, module.releaseWeek);
          const releaseLabel = course.isAcceleratorJourney ? acceleratorWeekReleaseLabel(enrollment.journeyStartedAt, module.releaseWeek) : null;
          return {
          ...module,
          releaseLocked,
          releaseLabel,
          lessons: module.lessons.map((lesson) => {
            // The transcript is private staff source material. Do not leak it
            // to agent browsers before chatbot knowledge controls are added.
            const { videoTranscript: _videoTranscript, ...agentLesson } = lesson;
            const locked = releaseLocked || learningPath.lockedLessonIds.has(lesson.id);
            return {
              ...agentLesson,
              summary: locked ? (releaseLocked ? `Available ${releaseLabel}.` : "Complete the current lesson to unlock this section.") : agentLesson.summary,
              contentHtml: locked ? null : agentLesson.contentHtml,
              videoUrl: locked ? null : agentLesson.videoUrl,
              attachmentUrl: locked ? null : agentLesson.attachmentUrl,
              attachmentKey: locked ? null : agentLesson.attachmentKey,
              attachmentName: locked ? null : agentLesson.attachmentName,
              locked,
              lockedReason: releaseLocked ? `Available ${releaseLabel}` : "Complete the current lesson to unlock this section",
              // Correct answer keys and staff-only question explanation stay server-side.
              questions: locked ? [] : lesson.questions.map((question) => {
                const resit = deriveQuestionResitStates({
                  questions: lesson.questions,
                  attempts: attempts.filter((attempt) => attempt.lessonId === lesson.id),
                  responses: responses.filter((response) => response.attemptId && attempts.some((attempt) => attempt.id === response.attemptId && attempt.lessonId === lesson.id)),
                  resets: questionResets.filter((reset) => reset.lessonId === lesson.id),
                  passMark: lesson.assessmentPassMark,
                }).find((state) => state.questionId === question.id)!;
                return { id: question.id, prompt: question.prompt, questionType: question.questionType, answerOptions: asOptions(question.answerOptions), maxWords: question.maxWords, sortOrder: question.sortOrder, resit };
              }),
              progress: locked ? null : progressByLesson.get(lesson.id) ?? null,
              attempts: locked ? [] : (attemptsByLesson.get(lesson.id) ?? []).map((attempt) => ({
                id: attempt.id,
                status: attempt.status,
                score: attempt.score,
                passed: attempt.passed,
                graderFeedback: attempt.graderFeedback,
                feedbackAcknowledgedAt: attempt.feedbackAcknowledgedAt,
                takenAt: attempt.takenAt,
                responses: responses.filter((response) => response.attemptId === attempt.id).map((response) => ({ questionId: response.questionId, responseText: response.responseText, score: response.score, feedback: response.feedback })),
              })),
            };
          }),
          };
        }),
      };
    }),

    /** Read-only draft or published-course preview for My Agent View. Correct answers and staff-only notes remain private. */
    previewCourse: adminProcedure.input(z.object({ courseId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, input.courseId)).limit(1);
      if (!course || !["draft", "published"].includes(course.status)) throw new TRPCError({ code: "NOT_FOUND", message: "Course not available" });

      const structure = await courseStructure(course.id);
      const requiredLessonIds = structure.lessons.filter((lesson) => lesson.isRequired).map((lesson) => lesson.id);
      return {
        isPreview: true,
        enrollment: { id: 0, agentId: null, courseId: course.id, status: "assigned" as const, dueDate: null, completedAt: null },
        course,
        progress: summariseAcademyProgress(requiredLessonIds, []),
        modules: structure.modules.map((module) => ({
          ...module,
          releaseLocked: false,
          releaseLabel: null,
          lessons: module.lessons.map((lesson) => ({
            ...lesson,
            locked: false,
            lockedReason: "",
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
        const { target: lesson } = await ensureSequentialAcademyLessonAccess(enrollment, input.lessonId);
        await ensureFeedbackAcknowledgedBeforeLesson(enrollment, input.lessonId);
        const [existing] = await db.select().from(academyLessonProgress)
          .where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, input.lessonId))).limit(1);
        const now = new Date();
        if (existing) await db.update(academyLessonProgress).set({ lastViewedAt: now, lastActivityAt: now, startedAt: existing.startedAt ?? now }).where(eq(academyLessonProgress.id, existing.id));
        else await db.insert(academyLessonProgress).values({ enrollmentId: enrollment.id, lessonId: input.lessonId, startedAt: now, lastViewedAt: now, lastActivityAt: now } as any);
        if (enrollment.status === "assigned") await db.update(academyEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? now }).where(eq(academyEnrollments.id, enrollment.id));
        const [course] = await db.select({ title: academyCourses.title }).from(academyCourses).where(eq(academyCourses.id, enrollment.courseId)).limit(1);
        const [module] = await db.select({ id: academyModules.id, title: academyModules.title }).from(academyModules).where(eq(academyModules.id, lesson.moduleId)).limit(1);
        if (course && module) void dispatchAcademyEmailAlerts({ eventType: "module_started", eventKey: `module-started-${module.id}`, enrollmentId: enrollment.id, courseId: enrollment.courseId, courseTitle: course.title, moduleId: module.id, moduleTitle: module.title, agentId: ctx.user.id, agentName: ctx.user.name, agentEmail: ctx.user.email }).catch((error) => console.error("[Academy] Module-start alert dispatch failed:", error));
        return { success: true };
      }),

    recordActivity: protectedProcedure.input(z.object({
      enrollmentId: z.number().int().positive(),
      lessonId: z.number().int().positive(),
      area: z.enum(["lesson", "knowledge_check"]),
    })).mutation(async ({ ctx, input }) => {
      const enrollment = await resolveEnrollmentForAgent(input.enrollmentId, ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await ensureSequentialAcademyLessonAccess(enrollment, input.lessonId);
      await ensureFeedbackAcknowledgedBeforeLesson(enrollment, input.lessonId);
      const [existing] = await db.select().from(academyLessonProgress)
        .where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, input.lessonId))).limit(1);
      const now = new Date();
      if (existing?.completedAt) return { creditedSeconds: 0 };
      // Credit only elapsed visible-session time since the preceding heartbeat,
      // capped at one minute so backgrounded/stale tabs cannot inflate totals.
      const elapsedSeconds = existing?.lastActivityAt
        ? Math.max(0, Math.min(60, Math.floor((now.getTime() - existing.lastActivityAt.getTime()) / 1000)))
        : 0;
      if (existing) {
        await db.update(academyLessonProgress).set({
          lastActivityAt: now,
          lastViewedAt: now,
          startedAt: existing.startedAt ?? now,
          ...(input.area === "lesson"
            ? { lessonActiveSeconds: sql`COALESCE(${academyLessonProgress.lessonActiveSeconds}, 0) + ${elapsedSeconds}` }
            : { assessmentActiveSeconds: sql`COALESCE(${academyLessonProgress.assessmentActiveSeconds}, 0) + ${elapsedSeconds}` }),
        }).where(eq(academyLessonProgress.id, existing.id));
      } else {
        await db.insert(academyLessonProgress).values({
          enrollmentId: enrollment.id,
          lessonId: input.lessonId,
          startedAt: now,
          lastViewedAt: now,
          lastActivityAt: now,
          lessonActiveSeconds: 0,
          assessmentActiveSeconds: 0,
        } as any);
      }
      return { creditedSeconds: elapsedSeconds };
    }),

    acknowledgeLesson: protectedProcedure.input(z.object({ enrollmentId: z.number().int().positive(), lessonId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const enrollment = await resolveEnrollmentForAgent(input.enrollmentId, ctx.user.id);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const { target: lesson } = await ensureSequentialAcademyLessonAccess(enrollment, input.lessonId);
        await ensureFeedbackAcknowledgedBeforeLesson(enrollment, lesson.id);
        if (!lesson.requiresAcknowledgement) throw new TRPCError({ code: "BAD_REQUEST", message: "This lesson does not require acknowledgement" });
        const [existing] = await db.select().from(academyLessonProgress)
          .where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, lesson.id))).limit(1);
        const now = new Date();
        if (existing?.acknowledgedAt) return { success: true, acknowledgedAt: existing.acknowledgedAt };
        if (existing) await db.update(academyLessonProgress).set({ acknowledgedAt: now, lastViewedAt: now, startedAt: existing.startedAt ?? now }).where(eq(academyLessonProgress.id, existing.id));
        else await db.insert(academyLessonProgress).values({ enrollmentId: enrollment.id, lessonId: lesson.id, startedAt: now, lastViewedAt: now, acknowledgedAt: now } as any);
        if (enrollment.status === "assigned") await db.update(academyEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? now }).where(eq(academyEnrollments.id, enrollment.id));
        await addAudit({ agentId: ctx.user.id, courseId: enrollment.courseId, enrollmentId: enrollment.id, actorId: ctx.user.id, action: "lesson_acknowledged", summary: `Acknowledged lesson: ${lesson.title}`, metadata: { lessonId: lesson.id } });
        return { success: true, acknowledgedAt: now };
      }),

    completeLesson: protectedProcedure.input(z.object({ enrollmentId: z.number().int().positive(), lessonId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const enrollment = await resolveEnrollmentForAgent(input.enrollmentId, ctx.user.id);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const { target: lesson } = await ensureSequentialAcademyLessonAccess(enrollment, input.lessonId);
        await ensureFeedbackAcknowledgedBeforeLesson(enrollment, lesson.id);
        if (lesson.requiresAssessment) throw new TRPCError({ code: "BAD_REQUEST", message: "Pass the knowledge check before completing this lesson" });
        const [existing] = await db.select().from(academyLessonProgress)
          .where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, lesson.id))).limit(1);
        if (lesson.requiresAcknowledgement && !existing?.acknowledgedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Please acknowledge this lesson before continuing" });
        const now = new Date();
        if (existing) await db.update(academyLessonProgress).set({ completedAt: now, lastViewedAt: now, startedAt: existing.startedAt ?? now }).where(eq(academyLessonProgress.id, existing.id));
        else await db.insert(academyLessonProgress).values({ enrollmentId: enrollment.id, lessonId: lesson.id, startedAt: now, lastViewedAt: now, acknowledgedAt: null, completedAt: now } as any);
        if (enrollment.status === "assigned") await db.update(academyEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? now }).where(eq(academyEnrollments.id, enrollment.id));
        const structure = await courseStructure(enrollment.courseId);
        const module = structure.modules.find((item) => item.id === lesson.moduleId);
        const moduleProgress = await db.select().from(academyLessonProgress).where(eq(academyLessonProgress.enrollmentId, enrollment.id));
        const moduleComplete = !!module && module.lessons.filter((item) => item.isRequired).every((item) => moduleProgress.some((progress) => progress.lessonId === item.id && !!progress.completedAt));
        if (module && moduleComplete) {
          const [course] = await db.select({ title: academyCourses.title }).from(academyCourses).where(eq(academyCourses.id, enrollment.courseId)).limit(1);
          if (course) void dispatchAcademyEmailAlerts({ eventType: "module_completed", eventKey: `module-completed-${module.id}`, enrollmentId: enrollment.id, courseId: enrollment.courseId, courseTitle: course.title, moduleId: module.id, moduleTitle: module.title, agentId: ctx.user.id, agentName: ctx.user.name, agentEmail: ctx.user.email }).catch((error) => console.error("[Academy] Module-completion alert dispatch failed:", error));
        }
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
      })).min(1).max(MAX_ACADEMY_ASSESSMENT_QUESTIONS),
    }))
      .mutation(async ({ ctx, input }) => {
        const enrollment = await resolveEnrollmentForAgent(input.enrollmentId, ctx.user.id);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const { target: lesson } = await ensureSequentialAcademyLessonAccess(enrollment, input.lessonId);
        if (!lesson.requiresAssessment) throw new TRPCError({ code: "BAD_REQUEST", message: "This lesson does not have an assessment" });
        await ensureFeedbackAcknowledgedBeforeLesson(enrollment, lesson.id);
        if (lesson.requiresAcknowledgement) {
          const [lessonProgress] = await db.select().from(academyLessonProgress)
            .where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, lesson.id))).limit(1);
          if (!lessonProgress?.acknowledgedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Please acknowledge this lesson before submitting the knowledge check" });
        }
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
        // A learner can hold an older page that sends every question, including
        // ones already passed. Accept those harmless extra values, but retain
        // only the outstanding answers and reject duplicate or unknown IDs.
        const submittedAnswers = new Map(input.answers.map((answer) => [answer.questionId, answer]));
        const knownQuestionIds = new Set(questions.map((question) => question.id));
        if (submittedAnswers.size !== input.answers.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Each outstanding question can only be submitted once" });
        }
        if (Array.from(submittedAnswers.keys()).some((questionId) => !knownQuestionIds.has(questionId))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This assessment contains an unknown question" });
        }
        if (outstandingQuestions.some((question) => !submittedAnswers.has(question.id))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Please answer each outstanding question before submitting" });
        }
        const answers = new Map(outstandingQuestions.map((question) => [question.id, submittedAnswers.get(question.id)!]));
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
        // Drizzle's TiDB insert result does not reliably expose insertId. The
        // response rows must reference this exact attempt, so use the native
        // parameterised path that is already used for Academy lesson inserts.
        const pool = await getRawDbPool();
        if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const [attemptInsert] = await pool.execute(
          `INSERT INTO academy_assessment_attempts
            (enrollmentId, lessonId, status, score, passed, answers, takenAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            enrollment.id,
            lesson.id,
            writtenQuestions.length ? "awaiting_marking" : "auto_graded",
            score,
            passed,
            JSON.stringify(input.answers),
            now,
          ],
        );
        const attemptId = Number((attemptInsert as any).insertId);
        if (!Number.isSafeInteger(attemptId) || attemptId < 1) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Academy assessment attempt insert did not return an ID" });
        }
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
        const newlyEscalatedQuestions = allQuestionStates.filter((state) => state.supportRequired && !resitStates.find((previous) => previous.questionId === state.questionId)?.supportRequired);
        if (assessmentPassed) {
          const [existing] = await db.select().from(academyLessonProgress).where(and(eq(academyLessonProgress.enrollmentId, enrollment.id), eq(academyLessonProgress.lessonId, lesson.id))).limit(1);
          if (existing) await db.update(academyLessonProgress).set({ completedAt: now, lastViewedAt: now, startedAt: existing.startedAt ?? now }).where(eq(academyLessonProgress.id, existing.id));
          else await db.insert(academyLessonProgress).values({ enrollmentId: enrollment.id, lessonId: lesson.id, startedAt: now, lastViewedAt: now, completedAt: now } as any);
          if (enrollment.status === "assigned") await db.update(academyEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? now }).where(eq(academyEnrollments.id, enrollment.id));
          await recalculateCompletion(enrollment.id, ctx.user.id);
        }
        if (writtenQuestions.length) {
          await addAudit({ agentId: ctx.user.id, courseId: enrollment.courseId, enrollmentId: enrollment.id, actorId: ctx.user.id, action: "assessment_submitted_for_marking", summary: `Submitted ${writtenQuestions.length} outstanding written ${writtenQuestions.length === 1 ? "question" : "questions"} for ${lesson.title}`, metadata: { lessonId: lesson.id, attemptId, writtenQuestions: writtenQuestions.length } });
          const [course] = await db.select({ title: academyCourses.title }).from(academyCourses).where(eq(academyCourses.id, enrollment.courseId)).limit(1);
          const [agent] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
          const [module] = await db.select({ id: academyModules.id, title: academyModules.title }).from(academyModules).where(eq(academyModules.id, lesson.moduleId)).limit(1);
          const configuredSupportAlert = await hasActiveAcademySupportAlert({ courseId: enrollment.courseId, eventType: "written_assessment_ready", moduleId: module?.id });
          if (!configuredSupportAlert) {
            await sendAcademySupportAlert({
              subject: `Academy written assessment ready to mark — ${agent?.name ?? "agent"}`,
              agentName: agent?.name ?? null,
              agentEmail: agent?.email ?? null,
              courseTitle: course?.title ?? "JLT Academy",
              lessonTitle: lesson.title,
              detail: `${writtenQuestions.length} written ${writtenQuestions.length === 1 ? "response has" : "responses have"} been submitted and are waiting in the Academy marking queue.`,
            });
          }
          void dispatchAcademyEmailAlerts({ eventType: "written_assessment_ready", eventKey: `written-assessment-${attemptId}`, enrollmentId: enrollment.id, courseId: enrollment.courseId, courseTitle: course?.title ?? "JLT Academy", moduleId: module?.id, moduleTitle: module?.title, agentId: ctx.user.id, agentName: agent?.name ?? null, agentEmail: agent?.email ?? null }).catch((error) => console.error("[Academy] Written-assessment alert dispatch failed:", error));
          return { attemptId, status: "awaiting_marking" as const, passMark: REQUIRED_ASSESSMENT_SCORE, correct, total: outstandingQuestions.length };
        }
        await addAudit({ agentId: ctx.user.id, courseId: enrollment.courseId, enrollmentId: enrollment.id, actorId: ctx.user.id, action: assessmentPassed ? "assessment_passed" : "assessment_resit_required", summary: `${assessmentPassed ? "Completed" : "Submitted"} ${outstandingQuestions.length === 1 ? "an outstanding question" : `${outstandingQuestions.length} outstanding questions`} for ${lesson.title}`, metadata: { lessonId: lesson.id, score, passed: assessmentPassed, outstandingQuestionIds: allQuestionStates.filter((state) => !state.passed).map((state) => state.questionId) } });
        if (newlyEscalatedQuestions.length) {
          const [course] = await db.select({ title: academyCourses.title }).from(academyCourses).where(eq(academyCourses.id, enrollment.courseId)).limit(1);
          const [agent] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
          const [module] = await db.select({ id: academyModules.id, title: academyModules.title }).from(academyModules).where(eq(academyModules.id, lesson.moduleId)).limit(1);
          const configuredSupportAlert = await hasActiveAcademySupportAlert({ courseId: enrollment.courseId, eventType: "three_attempt_lock", moduleId: module?.id });
          if (!configuredSupportAlert) {
            await sendAcademySupportAlert({
              subject: `Academy support needed: three-attempt lock — ${agent?.name ?? "agent"}`,
              agentName: agent?.name ?? null,
              agentEmail: agent?.email ?? null,
              courseTitle: course?.title ?? "JLT Academy",
              lessonTitle: lesson.title,
              detail: `${newlyEscalatedQuestions.length} knowledge-check ${newlyEscalatedQuestions.length === 1 ? "question has" : "questions have"} reached the three-attempt limit. Please provide support, then reopen the specific question from Academy Manager.`,
            });
          }
          void dispatchAcademyEmailAlerts({ eventType: "three_attempt_lock", eventKey: `three-attempt-lock-${attemptId}`, enrollmentId: enrollment.id, courseId: enrollment.courseId, courseTitle: course?.title ?? "JLT Academy", moduleId: module?.id, moduleTitle: module?.title, agentId: ctx.user.id, agentName: agent?.name ?? null, agentEmail: agent?.email ?? null }).catch((error) => console.error("[Academy] Three-attempt alert dispatch failed:", error));
        }
        return { attemptId, status: "auto_graded" as const, score, passed: assessmentPassed, passMark: REQUIRED_ASSESSMENT_SCORE, correct, total: outstandingQuestions.length };
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
        await ensureSequentialAcademyLessonAccess(row.enrollment, row.lesson.id);
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

    emailAlerts: adminProcedure.input(z.object({ courseId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return db.select().from(academyEmailAlerts)
        .where(eq(academyEmailAlerts.courseId, input.courseId))
        .orderBy(desc(academyEmailAlerts.createdAt));
    }),

    emailAlertActivity: adminProcedure.input(z.object({ courseId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const alerts = await db.select({
        id: academyEmailAlerts.id,
        eventType: academyEmailAlerts.eventType,
        recipientType: academyEmailAlerts.recipientType,
        recipientEmail: academyEmailAlerts.recipientEmail,
      }).from(academyEmailAlerts).where(eq(academyEmailAlerts.courseId, input.courseId));
      if (!alerts.length) return [];
      const alertById = new Map(alerts.map((alert) => [alert.id, alert]));
      const deliveries = await db.select().from(academyEmailAlertDeliveries)
        .where(inArray(academyEmailAlertDeliveries.alertId, alerts.map((alert) => alert.id)))
        .orderBy(desc(academyEmailAlertDeliveries.sentAt), desc(academyEmailAlertDeliveries.id))
        .limit(100);
      return deliveries.map((delivery) => ({
        ...delivery,
        alert: alertById.get(delivery.alertId) ?? null,
      }));
    }),

    saveEmailAlert: adminProcedure.input(z.object({
      id: z.number().int().positive().optional(),
      courseId: z.number().int().positive(),
      moduleId: z.number().int().positive().nullable().optional(),
      eventType: z.enum(ACADEMY_ALERT_EVENTS),
      recipientType: z.enum(["support", "custom"]),
      recipientEmail: z.string().trim().email().max(320).nullable().optional(),
      recipientName: z.string().trim().max(255).nullable().optional(),
      subjectTemplate: z.string().trim().min(3).max(500),
      bodyHtmlTemplate: z.string().trim().min(3).max(100_000),
      isActive: z.boolean().default(true),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      if (input.recipientType === "custom" && !input.recipientEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the custom recipient email address" });
      if (input.moduleId && !academyAlertAllowsModuleScope(input.eventType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This milestone is course-wide, so it cannot be limited to an individual module.",
        });
      }
      if (input.moduleId) {
        const [module] = await db.select().from(academyModules).where(and(eq(academyModules.id, input.moduleId), eq(academyModules.courseId, input.courseId))).limit(1);
        if (!module) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a module in this course" });
      }
      const payload = {
        courseId: input.courseId,
        moduleId: input.moduleId ?? null,
        eventType: input.eventType,
        recipientType: input.recipientType,
        recipientEmail: input.recipientType === "custom" ? input.recipientEmail ?? null : null,
        recipientName: input.recipientType === "custom" ? input.recipientName ?? null : null,
        subjectTemplate: input.subjectTemplate,
        bodyHtmlTemplate: input.bodyHtmlTemplate,
        isActive: input.isActive,
        updatedById: ctx.user.id,
      };
      if (input.id) {
        const [existing] = await db.select().from(academyEmailAlerts).where(and(eq(academyEmailAlerts.id, input.id), eq(academyEmailAlerts.courseId, input.courseId))).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Academy email alert not found" });
        await db.update(academyEmailAlerts).set(payload).where(eq(academyEmailAlerts.id, input.id));
        return { id: input.id };
      }
      const result = await db.insert(academyEmailAlerts).values({ ...payload, createdById: ctx.user.id } as any);
      return { id: Number((result as any).insertId) };
    }),

    archiveEmailAlert: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.update(academyEmailAlerts).set({ isActive: false, updatedById: ctx.user.id }).where(eq(academyEmailAlerts.id, input.id));
      return { success: true };
    }),

    emailAlertTemplateHelp: adminProcedure.query(() => ({ events: ACADEMY_ALERT_EVENTS, templateHint: academyAlertTemplateHint() })),

    /**
     * One staff-only source for operational Academy metrics. The result is
     * deliberately aggregated server-side: the browser receives exactly the
     * current learner / curriculum signals it needs, rather than raw audit and
     * assessment tables that would be expensive and easy to misinterpret.
     */
    insights: adminProcedure.input(z.object({
      courseId: z.number().int().positive().optional(),
      dueSoonDays: z.number().int().min(1).max(60).default(7),
    }).optional()).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const asOf = new Date();
      const dueSoonDays = input?.dueSoonDays ?? 7;
      const courses = await db.select().from(academyCourses).orderBy(asc(academyCourses.status), asc(academyCourses.title));
      const courseScope = input?.courseId ? courses.filter((course) => course.id === input.courseId) : courses;
      const scopedCourseIds = courseScope.map((course) => course.id);
      const allRows = await db.select({ enrollment: academyEnrollments, course: academyCourses, agent: users, profile: agentCrmProfiles })
        .from(academyEnrollments)
        .innerJoin(academyCourses, eq(academyCourses.id, academyEnrollments.courseId))
        .innerJoin(users, eq(users.id, academyEnrollments.agentId))
        .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, academyEnrollments.agentId));
      const rows = allRows.filter((row) => scopedCourseIds.includes(row.course.id));
      const enrollmentIds = rows.map((row) => row.enrollment.id);
      const modules = scopedCourseIds.length ? await db.select().from(academyModules).where(inArray(academyModules.courseId, scopedCourseIds)) : [];
      const lessons = await getAcademyLessonsForModules(modules.map((module) => module.id));
      const lessonIds = lessons.map((lesson) => lesson.id);
      const progress = enrollmentIds.length ? await db.select().from(academyLessonProgress).where(inArray(academyLessonProgress.enrollmentId, enrollmentIds)) : [];
      const attempts = enrollmentIds.length ? await db.select().from(academyAssessmentAttempts).where(inArray(academyAssessmentAttempts.enrollmentId, enrollmentIds)) : [];
      const attemptIds = attempts.map((attempt) => attempt.id);
      const responses = attemptIds.length ? await db.select().from(academyAssessmentResponses).where(inArray(academyAssessmentResponses.attemptId, attemptIds)) : [];
      const questions = lessonIds.length ? await db.select().from(academyQuestions).where(inArray(academyQuestions.lessonId, lessonIds)).orderBy(asc(academyQuestions.sortOrder), asc(academyQuestions.id)) : [];
      const resets = enrollmentIds.length ? await db.select().from(academyAssessmentQuestionResets).where(inArray(academyAssessmentQuestionResets.enrollmentId, enrollmentIds)) : [];
      const terminal = new Set(["completed", "waived"]);
      const dueSoonAt = new Date(asOf.getTime() + dueSoonDays * 24 * 60 * 60 * 1000);
      const assessmentSupportLocks: Array<{ enrollmentId: number; lessonId: number; questionId: number }> = [];

      for (const row of rows) {
        const courseLessonIds = new Set(lessons.filter((lesson) => modules.some((module) => module.id === lesson.moduleId && module.courseId === row.course.id)).map((lesson) => lesson.id));
        const enrollmentAttempts = attempts.filter((attempt) => attempt.enrollmentId === row.enrollment.id && courseLessonIds.has(attempt.lessonId));
        const enrollmentAttemptIds = new Set(enrollmentAttempts.map((attempt) => attempt.id));
        for (const lessonId of Array.from(courseLessonIds)) {
          const lesson = lessons.find((item) => item.id === lessonId)!;
          const lessonQuestions = questions.filter((question) => question.lessonId === lessonId);
          if (!lessonQuestions.length) continue;
          const states = deriveQuestionResitStates({
            questions: lessonQuestions,
            attempts: enrollmentAttempts.filter((attempt) => attempt.lessonId === lessonId),
            responses: responses.filter((response) => enrollmentAttemptIds.has(response.attemptId) && lessonQuestions.some((question) => question.id === response.questionId)),
            resets: resets.filter((reset) => reset.enrollmentId === row.enrollment.id && reset.lessonId === lessonId),
            passMark: lesson.assessmentPassMark,
          });
          states.filter((state) => state.supportRequired).forEach((state) => assessmentSupportLocks.push({ enrollmentId: row.enrollment.id, lessonId, questionId: state.questionId }));
        }
      }

      const learners = rows.map((row) => {
        const courseLessonIds = new Set(lessons.filter((lesson) => modules.some((module) => module.id === lesson.moduleId && module.courseId === row.course.id)).map((lesson) => lesson.id));
        const courseLessons = lessons.filter((lesson) => courseLessonIds.has(lesson.id));
        const enrollmentProgress = progress.filter((item) => item.enrollmentId === row.enrollment.id);
        const enrollmentAttempts = attempts.filter((attempt) => attempt.enrollmentId === row.enrollment.id && courseLessonIds.has(attempt.lessonId));
        const completion = summariseAcademyProgress(courseLessons.filter((lesson) => lesson.isRequired).map((lesson) => lesson.id), enrollmentProgress.filter((item) => item.completedAt).map((item) => item.lessonId));
        const activityDates = [
          ...enrollmentProgress.flatMap((item) => [item.lastActivityAt, item.lastViewedAt, item.startedAt]),
          ...enrollmentAttempts.map((attempt) => attempt.takenAt),
        ].filter((value): value is Date => value instanceof Date);
        const lastActivityAt = activityDates.length ? new Date(Math.max(...activityDates.map((value) => value.getTime()))) : null;
        const inactiveDays = lastActivityAt ? Math.floor((asOf.getTime() - lastActivityAt.getTime()) / 86_400_000) : null;
        const activeTimeSeconds = enrollmentProgress.reduce((total, item) => total + Number(item.lessonActiveSeconds ?? 0) + Number(item.assessmentActiveSeconds ?? 0), 0);
        const overdue = !!row.enrollment.dueDate && !terminal.has(row.enrollment.status) && row.enrollment.dueDate < asOf;
        const dueSoon = !!row.enrollment.dueDate && !terminal.has(row.enrollment.status) && row.enrollment.dueDate >= asOf && row.enrollment.dueDate <= dueSoonAt;
        const currentRequiredLesson = courseLessons.find((lesson) => lesson.isRequired && !enrollmentProgress.some((item) => item.lessonId === lesson.id && item.completedAt)) ?? null;
        return {
          enrollment: row.enrollment,
          learner: { id: row.agent.id, name: row.agent.name, email: row.agent.email, trainingStage: row.profile?.trainingStage ?? null },
          course: { id: row.course.id, title: row.course.title, status: row.course.status },
          completion,
          due: { date: row.enrollment.dueDate, overdue, dueSoon },
          lastActivityAt,
          inactiveDays,
          activeTimeSeconds,
          currentRequiredLesson: currentRequiredLesson ? { id: currentRequiredLesson.id, title: currentRequiredLesson.title } : null,
          assessment: {
            awaitingMarking: enrollmentAttempts.filter((attempt) => attempt.status === "awaiting_marking").length,
            feedbackPending: enrollmentAttempts.filter((attempt) => attempt.status === "feedback_pending").length,
            supportLocks: assessmentSupportLocks.filter((item) => item.enrollmentId === row.enrollment.id).length,
          },
          accreditation: getAccreditationEligibility(row.profile?.academyAcceleratorStartedAt, asOf),
        };
      });

      const nonTerminal = learners.filter((item) => !terminal.has(item.enrollment.status));
      const inProgress = learners.filter((item) => item.enrollment.status === "in_progress");
      const recordedActiveLearners = learners.filter((item) => item.activeTimeSeconds > 0);
      const metrics = {
        enrolments: {
          total: learners.length,
          uniqueLearners: new Set(learners.map((item) => item.learner.id)).size,
          assigned: learners.filter((item) => item.enrollment.status === "assigned").length,
          inProgress: inProgress.length,
          completed: learners.filter((item) => item.enrollment.status === "completed").length,
          waived: learners.filter((item) => item.enrollment.status === "waived").length,
        },
        due: { overdue: nonTerminal.filter((item) => item.due.overdue).length, dueSoon: nonTerminal.filter((item) => item.due.dueSoon).length, dueSoonDays },
        inactivity: {
          inactive7Plus: inProgress.filter((item) => item.inactiveDays !== null && item.inactiveDays >= 7).length,
          inactive14Plus: inProgress.filter((item) => item.inactiveDays !== null && item.inactiveDays >= 14).length,
          inactive30Plus: inProgress.filter((item) => item.inactiveDays !== null && item.inactiveDays >= 30).length,
          noRecordedActivity: inProgress.filter((item) => item.inactiveDays === null).length,
        },
        assessments: {
          awaitingMarking: attempts.filter((attempt) => attempt.status === "awaiting_marking").length,
          feedbackPending: attempts.filter((attempt) => attempt.status === "feedback_pending").length,
          feedbackAcknowledged: attempts.filter((attempt) => attempt.status === "feedback_acknowledged").length,
          supportLocks: assessmentSupportLocks.length,
        },
        activeTime: {
          totalSeconds: learners.reduce((total, item) => total + item.activeTimeSeconds, 0),
          recordedLearners: recordedActiveLearners.length,
          averageSecondsPerRecordedLearner: recordedActiveLearners.length ? Math.round(recordedActiveLearners.reduce((total, item) => total + item.activeTimeSeconds, 0) / recordedActiveLearners.length) : 0,
        },
      };

      const curriculumLessons = lessons.map((lesson) => {
        const module = modules.find((item) => item.id === lesson.moduleId)!;
        const courseLearners = learners.filter((item) => item.course.id === module.courseId);
        const relevantProgress = progress.filter((item) => item.lessonId === lesson.id && courseLearners.some((learner) => learner.enrollment.id === item.enrollmentId));
        const relevantAttempts = attempts.filter((attempt) => attempt.lessonId === lesson.id && courseLearners.some((learner) => learner.enrollment.id === attempt.enrollmentId));
        const started = relevantProgress.filter((item) => item.startedAt || item.lastViewedAt || item.lastActivityAt).length;
        const completed = relevantProgress.filter((item) => item.completedAt).length;
        const activeRecords = relevantProgress.filter((item) => Number(item.lessonActiveSeconds ?? 0) + Number(item.assessmentActiveSeconds ?? 0) > 0);
        return {
          courseId: module.courseId,
          moduleId: module.id,
          moduleTitle: module.title,
          id: lesson.id,
          title: lesson.title,
          sortOrder: lesson.sortOrder,
          isRequired: lesson.isRequired,
          estimatedMinutes: lesson.estimatedMinutes,
          requiresAcknowledgement: lesson.requiresAcknowledgement,
          requiresAssessment: lesson.requiresAssessment,
          enrolled: courseLearners.length,
          started,
          completed,
          completionRate: started ? Math.round((completed / started) * 100) : null,
          averageActiveSeconds: activeRecords.length ? Math.round(activeRecords.reduce((total, item) => total + Number(item.lessonActiveSeconds ?? 0), 0) / activeRecords.length) : 0,
          averageAssessmentSeconds: activeRecords.length ? Math.round(activeRecords.reduce((total, item) => total + Number(item.assessmentActiveSeconds ?? 0), 0) / activeRecords.length) : 0,
          awaitingMarking: relevantAttempts.filter((attempt) => attempt.status === "awaiting_marking").length,
          feedbackPending: relevantAttempts.filter((attempt) => attempt.status === "feedback_pending").length,
          supportLocks: assessmentSupportLocks.filter((item) => item.lessonId === lesson.id).length,
        };
      });

      const curriculumQuestions = questions.map((question) => {
        const lesson = lessons.find((item) => item.id === question.lessonId)!;
        const module = modules.find((item) => item.id === lesson.moduleId)!;
        const courseEnrollmentIds = new Set(learners.filter((item) => item.course.id === module.courseId).map((item) => item.enrollment.id));
        const relevantAttempts = attempts.filter((attempt) => courseEnrollmentIds.has(attempt.enrollmentId) && attempt.lessonId === lesson.id);
        const attemptById = new Map(relevantAttempts.map((attempt) => [attempt.id, attempt]));
        const firstScoredByEnrollment = new Map<number, { score: number; takenAt: Date }>();
        responses.filter((response) => response.questionId === question.id && response.score !== null).forEach((response) => {
          const attempt = attemptById.get(response.attemptId);
          if (!attempt) return;
          const existing = firstScoredByEnrollment.get(attempt.enrollmentId);
          if (!existing || attempt.takenAt < existing.takenAt) firstScoredByEnrollment.set(attempt.enrollmentId, { score: response.score!, takenAt: attempt.takenAt });
        });
        const scores = Array.from(firstScoredByEnrollment.values()).map((item) => item.score);
        const correctRate = scores.length ? Math.round((scores.filter((score) => score >= REQUIRED_ASSESSMENT_SCORE).length / scores.length) * 100) : null;
        return {
          courseId: module.courseId,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          id: question.id,
          questionType: question.questionType,
          prompt: question.prompt,
          scoredLearners: scores.length,
          firstAttemptCorrectRate: correctRate,
          firstAttemptAverageScore: scores.length ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length) : null,
          difficulty: scores.length < 5 ? "insufficient_data" as const : correctRate! < 50 ? "high" as const : correctRate! < 75 ? "medium" as const : "low" as const,
          awaitingMarking: relevantAttempts.filter((attempt) => attempt.status === "awaiting_marking").length,
          supportLocks: assessmentSupportLocks.filter((item) => item.questionId === question.id).length,
        };
      });

      return { asOf, courses: courseScope.map((course) => ({ id: course.id, title: course.title, status: course.status, estimatedMinutes: course.estimatedMinutes })), metrics, learners, curriculum: { lessons: curriculumLessons, questions: curriculumQuestions } };
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
      const enrollmentIds = Array.from(new Set(rows.map((row) => row.enrollment.id)));
      // AI suggestions are an append-only internal audit record. Only the
      // newest recorded review for an awaiting-marking attempt is displayed;
      // previous runs remain preserved in the Academy audit history.
      const aiReviewEvents = enrollmentIds.length
        ? await db.select().from(academyAuditLog)
          .where(and(
            inArray(academyAuditLog.enrollmentId, enrollmentIds),
            eq(academyAuditLog.action, ACADEMY_AI_REVIEW_AUDIT_ACTION),
          ))
          .orderBy(desc(academyAuditLog.createdAt), desc(academyAuditLog.id))
        : [];
      const aiReviewByAttemptId = new Map<number, {
        generatedAt: Date;
        model: string;
        suggestions: NonNullable<ReturnType<typeof parseAcademyAiMarkingAuditMetadata>>["suggestions"];
      }>();
      for (const event of aiReviewEvents) {
        const metadata = parseAcademyAiMarkingAuditMetadata(event.metadata);
        if (!metadata || !attemptIds.includes(metadata.attemptId) || aiReviewByAttemptId.has(metadata.attemptId)) continue;
        aiReviewByAttemptId.set(metadata.attemptId, {
          generatedAt: event.createdAt,
          model: metadata.model,
          suggestions: metadata.suggestions,
        });
      }
      return rows.map((row) => ({
        attempt: row.attempt,
        enrollment: { id: row.enrollment.id, agentId: row.enrollment.agentId, courseId: row.enrollment.courseId },
        course: { id: row.course.id, title: row.course.title },
        lesson: { id: row.lesson.id, title: row.lesson.title, assessmentPassMark: REQUIRED_ASSESSMENT_SCORE },
        agent: { id: row.agent.id, name: row.agent.name, email: row.agent.email },
        aiReview: aiReviewByAttemptId.get(row.attempt.id) ?? null,
        responses: questions.filter((question) => question.lessonId === row.lesson.id && question.questionType === "free_text" && responses.some((item) => item.attemptId === row.attempt.id && item.questionId === question.id)).map((question) => {
          const response = responses.find((item) => item.attemptId === row.attempt.id && item.questionId === question.id);
          // The marking guide is deliberately available only in this admin-only queue.
          return { questionId: question.id, prompt: question.prompt, explanation: question.explanation, responseText: response?.responseText ?? "", maxWords: question.maxWords };
        }),
      }));
    }),

    generateAiMarkingReview: adminProcedure.input(z.object({
      attemptId: z.number().int().positive(),
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
      if (row.attempt.status !== "awaiting_marking") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "AI review is available only while this written assessment awaits staff marking" });
      }

      const questions = await db.select().from(academyQuestions)
        .where(eq(academyQuestions.lessonId, row.lesson.id)).orderBy(asc(academyQuestions.sortOrder));
      const savedResponses = await db.select().from(academyAssessmentResponses)
        .where(eq(academyAssessmentResponses.attemptId, row.attempt.id));
      const writtenQuestions = questions.flatMap((question) => {
        if (question.questionType !== "free_text") return [];
        const response = savedResponses.find((item) => item.questionId === question.id);
        return response ? [{
          questionId: question.id,
          prompt: question.prompt,
          markingGuide: question.explanation,
          responseText: response.responseText,
        }] : [];
      });
      if (!writtenQuestions.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This assessment has no written answers to review" });
      }

      const { invokeLLM } = await import("./_core/llm");
      const suggestions = [] as ReturnType<typeof parseAcademyAiMarkingResponse>;
      try {
        for (const questionBatch of splitAcademyAiMarkingQuestions(writtenQuestions)) {
          const result = await invokeLLM({
            model: ACADEMY_AI_MARKING_MODEL,
            messages: [
              {
                role: "system",
                content: "You provide structured internal review suggestions for trained staff. You never make final learner decisions.",
              },
              {
                role: "user",
                content: buildAcademyAiMarkingPrompt({
                  courseTitle: row.course.title,
                  lessonTitle: row.lesson.title,
                  questions: questionBatch,
                }),
              },
            ],
            response_format: { type: "json_object" },
          });
          const content = result.choices[0]?.message?.content;
          if (typeof content !== "string") throw new Error("The AI review did not return text");
          suggestions.push(...parseAcademyAiMarkingResponse(content, questionBatch.map((question) => question.questionId)));
        }
      } catch (error) {
        console.error("[AcademyAIReview] Review generation failed", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The AI review is temporarily unavailable. No grade or feedback has been changed; please try again.",
        });
      }

      // This AI review is for staff guidance only. It never writes a score,
      // changes assessment status, contacts the learner or grants progression.
      await addAudit({
        agentId: row.agent.id,
        courseId: row.course.id,
        enrollmentId: row.enrollment.id,
        actorId: ctx.user.id,
        action: ACADEMY_AI_REVIEW_AUDIT_ACTION,
        summary: `AI review generated for ${writtenQuestions.length} written ${writtenQuestions.length === 1 ? "response" : "responses"} in ${row.lesson.title}; staff review and release remain required`,
        metadata: {
          version: 1,
          attemptId: row.attempt.id,
          model: ACADEMY_AI_MARKING_MODEL,
          sourceQuestions: writtenQuestions,
          suggestions,
        },
      });
      return { success: true, reviewedResponses: suggestions.length };
    }),

    markWrittenAssessment: adminProcedure.input(z.object({
      attemptId: z.number().int().positive(),
      feedback: z.string().trim().min(3).max(10_000),
      responses: z.array(z.object({ questionId: z.number().int().positive(), score: z.number().int().min(0).max(100), feedback: z.string().trim().min(3).max(10_000) })).min(1).max(MAX_ACADEMY_ASSESSMENT_QUESTIONS),
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
      await sendAcademyAgentEmail({
        userId: row.agent.id,
        email: row.agent.email,
        name: row.agent.name,
        subject: `Your JLT Academy feedback is ready — ${row.lesson.title}`,
        triggerKey: "academy_assessment_feedback_ready",
        html: `<p>Hi ${escapeAcademyEmailHtml((row.agent.name ?? "there").split(" ")[0])},</p><p>Your written assessment feedback for <strong>${escapeAcademyEmailHtml(row.lesson.title)}</strong> is ready in the JLT Academy.</p><p>${passed ? "You achieved the required 100% standard. Please read and acknowledge the feedback to record this lesson as complete." : "Please read the feedback, acknowledge it, then revisit the outstanding response when you are ready."}</p><p><a href="${ACADEMY_PORTAL_URL}/academy/course/${row.enrollment.id}">Open your Academy feedback</a></p>`,
      });
      await addAudit({ agentId: row.agent.id, courseId: row.course.id, enrollmentId: row.enrollment.id, actorId: ctx.user.id, action: "assessment_marked", summary: `Marked ${writtenQuestions.length} written ${writtenQuestions.length === 1 ? "response" : "responses"} for ${row.lesson.title} (${score}% — ${passed ? "passed" : "targeted resit needed"})`, metadata: { attemptId: row.attempt.id, score, passed, passMark: REQUIRED_ASSESSMENT_SCORE, staffApprovedScores: input.responses.map(({ questionId, score: responseScore }) => ({ questionId, score: responseScore })), finalFeedbackReleased: true, outstandingQuestionIds: states.filter((state) => !state.passed).map((state) => state.questionId) } });
      return { score, passed, passMark: REQUIRED_ASSESSMENT_SCORE };
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
      const [lesson] = await db.select(legacyAcademyLessonColumns).from(academyLessons).where(eq(academyLessons.id, input.lessonId)).limit(1);
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
      const [agent] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, enrollment.agentId)).limit(1);
      await sendAcademyAgentEmail({
        userId: enrollment.agentId,
        email: agent?.email ?? null,
        name: agent?.name ?? null,
        subject: `Your JLT Academy question has been reopened — ${lesson.title}`,
        triggerKey: "academy_question_reopened",
        html: `<p>Hi ${escapeAcademyEmailHtml((agent?.name ?? "there").split(" ")[0])},</p><p>Following support from the JLT team, your knowledge-check question in <strong>${escapeAcademyEmailHtml(lesson.title)}</strong> has been reopened.</p><p>You can now return to the lesson and try it again when you are ready.</p><p><a href="${ACADEMY_PORTAL_URL}/academy/course/${enrollment.id}">Continue in JLT Academy</a></p>`,
      });
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
      const payload = { title: input.title, summary: normaliseOptionalText(input.summary), coverImageUrl, isCoreAcademy: input.isCoreAcademy, isAcceleratorJourney: input.isAcceleratorJourney, estimatedMinutes: input.estimatedMinutes, updatedById: ctx.user.id };
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
          (title, summary, coverImageUrl, isCoreAcademy, isAcceleratorJourney, estimatedMinutes, createdById, updatedById)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [payload.title, payload.summary, payload.coverImageUrl, payload.isCoreAcademy, payload.isAcceleratorJourney, payload.estimatedMinutes, ctx.user.id, ctx.user.id],
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
        const incompleteKnowledgeChecks = structure.modules.flatMap((module) => module.lessons)
          .filter((lesson) => lesson.requiresAssessment && lesson.questions.length === 0);
        if (incompleteKnowledgeChecks.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Add at least one question before publishing: ${incompleteKnowledgeChecks.map((lesson) => lesson.title).join(", ")}`,
          });
        }
        if (course.isCoreAcademy) await db.update(academyCourses).set({ isCoreAcademy: false }).where(and(eq(academyCourses.isCoreAcademy, true), eq(academyCourses.status, "published"), ne(academyCourses.id, input.courseId)));
      }
      const now = new Date();
      await db.update(academyCourses).set({ status: input.status, updatedById: ctx.user.id, publishedAt: input.status === "published" ? (course.publishedAt ?? now) : course.publishedAt, archivedAt: input.status === "archived" ? now : null }).where(eq(academyCourses.id, input.courseId));
      await addAudit({ courseId: input.courseId, actorId: ctx.user.id, action: `course_${input.status}`, summary: `${input.status === "published" ? "Published" : input.status === "archived" ? "Archived" : "Moved"} ${course.title} ${input.status === "draft" ? "to draft" : ""}` });
      return { success: true };
    }),

    saveModule: adminProcedure.input(z.object({ id: z.number().int().positive().optional(), courseId: z.number().int().positive(), title: z.string().trim().min(2).max(255), summary: z.string().trim().max(10_000).nullable().optional(), releaseWeek: z.number().int().min(0).max(ACCELERATOR_JOURNEY_WEEKS).default(0) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [course] = await db.select({ isAcceleratorJourney: academyCourses.isAcceleratorJourney }).from(academyCourses).where(eq(academyCourses.id, input.courseId)).limit(1);
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      if (!course.isAcceleratorJourney && input.releaseWeek !== 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Only Agent Accelerator journeys can use scheduled weekly module release" });
      if (input.id) {
        const [module] = await db.select().from(academyModules).where(and(eq(academyModules.id, input.id), eq(academyModules.courseId, input.courseId))).limit(1);
        if (!module) throw new TRPCError({ code: "NOT_FOUND", message: "Module not found" });
        await db.update(academyModules).set({ title: input.title, summary: normaliseOptionalText(input.summary), releaseWeek: input.releaseWeek }).where(and(eq(academyModules.id, input.id), eq(academyModules.courseId, input.courseId)));
        await addAudit({ courseId: input.courseId, actorId: ctx.user.id, action: "module_updated", summary: `Updated module: ${input.title}` });
        return { id: input.id };
      }
      const existing = await db.select().from(academyModules).where(eq(academyModules.courseId, input.courseId)).orderBy(desc(academyModules.sortOrder)).limit(1);
      const result = await db.insert(academyModules).values({ courseId: input.courseId, title: input.title, summary: normaliseOptionalText(input.summary), releaseWeek: input.releaseWeek, sortOrder: (existing[0]?.sortOrder ?? -1) + 1 } as any);
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
      if (await hasAcademyLearnerEvidence(lessonIds)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This module has learner progress or assessment evidence and cannot be deleted. Archive the course or create a replacement module so the learner and audit history remain intact.",
        });
      }
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
      const payload = { title: input.title, summary: normaliseOptionalText(input.summary), contentHtml: sanitiseLessonHtml(input.contentHtml), videoUrl, videoTranscript: preserveOptionalTranscript(input.videoTranscript), attachmentUrl, attachmentKey: normaliseOptionalText(input.attachmentKey), attachmentName: normaliseOptionalText(input.attachmentName), estimatedMinutes: input.estimatedMinutes, isRequired: input.isRequired, requiresAcknowledgement: input.requiresAcknowledgement, requiresAssessment: input.requiresAssessment, assessmentPassMark: input.requiresAssessment ? REQUIRED_ASSESSMENT_SCORE : input.assessmentPassMark };
      const { videoTranscript, ...legacyPayload } = payload;
      if (input.id) {
        const [lesson] = await db.select(legacyAcademyLessonColumns).from(academyLessons).where(and(eq(academyLessons.id, input.id), eq(academyLessons.moduleId, input.moduleId))).limit(1);
        if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
        if (await hasAcademyLearnerEvidence([lesson.id])) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "This lesson has learner evidence and is now preserved as part of the Academy record. Create a replacement lesson for a material revision rather than changing historic learning content.",
          });
        }
        try {
          await db.update(academyLessons).set(payload as any).where(and(eq(academyLessons.id, input.id), eq(academyLessons.moduleId, input.moduleId)));
        } catch (error) {
          if (!isMissingAcademyTranscriptColumn(error)) throw error;
          if (videoTranscript) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Loom transcript storage is not ready on Railway yet. Apply the Academy transcript database update, then save this transcript." });
          await db.update(academyLessons).set(legacyPayload as any).where(and(eq(academyLessons.id, input.id), eq(academyLessons.moduleId, input.moduleId)));
        }
        await addAudit({ courseId: module.courseId, actorId: ctx.user.id, action: "lesson_updated", summary: `Updated lesson: ${input.title}` });
        return { id: input.id };
      }
      const existing = await db.select({ sortOrder: academyLessons.sortOrder }).from(academyLessons).where(eq(academyLessons.moduleId, input.moduleId)).orderBy(desc(academyLessons.sortOrder)).limit(1);
      // TiDB's Drizzle insert result does not reliably expose insertId. Use the
      // native prepared statement so a new lesson can be immediately linked to
      // its knowledge-check questions without sending a NaN lessonId to tRPC.
      const pool = await getRawDbPool();
      if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const insertValues = [
        input.moduleId,
        payload.title,
        payload.summary,
        payload.contentHtml,
        payload.videoUrl,
        payload.videoTranscript,
        payload.attachmentUrl,
        payload.attachmentKey,
        payload.attachmentName,
        payload.estimatedMinutes,
        payload.isRequired,
        payload.requiresAcknowledgement,
        payload.requiresAssessment,
        payload.assessmentPassMark,
        (existing[0]?.sortOrder ?? -1) + 1,
      ];
      let result: unknown;
      try {
        [result] = await pool.execute(
          `INSERT INTO academy_lessons
            (moduleId, title, summary, contentHtml, videoUrl, videoTranscript, attachmentUrl, attachmentKey, attachmentName, estimatedMinutes, isRequired, requiresAcknowledgement, requiresAssessment, assessmentPassMark, sortOrder)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          insertValues,
        );
      } catch (error) {
        if (!isMissingAcademyTranscriptColumn(error)) throw error;
        if (videoTranscript) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Loom transcript storage is not ready on Railway yet. Apply the Academy transcript database update, then save this transcript." });
        const legacyInsertValues = insertValues.filter((_, index) => index !== 5);
        [result] = await pool.execute(
          `INSERT INTO academy_lessons
            (moduleId, title, summary, contentHtml, videoUrl, attachmentUrl, attachmentKey, attachmentName, estimatedMinutes, isRequired, requiresAcknowledgement, requiresAssessment, assessmentPassMark, sortOrder)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          legacyInsertValues,
        );
      }
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
      const [lesson] = await db.select(legacyAcademyLessonColumns).from(academyLessons).where(eq(academyLessons.id, input.lessonId)).limit(1);
      if (!lesson) return { success: true };
      const [module] = await db.select().from(academyModules).where(eq(academyModules.id, lesson.moduleId)).limit(1);
      if (await hasAcademyLearnerEvidence([lesson.id])) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This lesson has learner progress or assessment evidence and cannot be deleted. Create a replacement lesson so existing learning and audit history stay accurate.",
        });
      }
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
      })).max(MAX_ACADEMY_ASSESSMENT_QUESTIONS),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [lesson] = await db.select(legacyAcademyLessonColumns).from(academyLessons).where(eq(academyLessons.id, input.lessonId)).limit(1);
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      if (input.questions.some((question) => question.questionType === "multiple_choice" && (question.answerOptions.length < 2 || question.answerOptions.some((option) => !option.trim()) || question.correctAnswerIndex >= question.answerOptions.length))) throw new TRPCError({ code: "BAD_REQUEST", message: "Each multiple-choice question needs at least two completed answers and one correct answer" });
      if (await hasAcademyLearnerEvidence([lesson.id])) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This knowledge check has learner evidence and its questions are now preserved. Create a replacement lesson for a revised assessment rather than changing historic learner records.",
        });
      }
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
      const [lesson] = await db.select(legacyAcademyLessonColumns).from(academyLessons).where(eq(academyLessons.id, input.lessonId)).limit(1);
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      if (!lesson.requiresAssessment) throw new TRPCError({ code: "BAD_REQUEST", message: "Turn on the knowledge check for this lesson before importing questions" });
      if (await hasAcademyLearnerEvidence([lesson.id])) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This knowledge check has learner evidence and cannot be changed by CSV import. Create a replacement lesson for a revised assessment.",
        });
      }

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
      if (existing.length + questions.length > MAX_ACADEMY_ASSESSMENT_QUESTIONS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `This import would create ${existing.length + questions.length} questions. A knowledge check can contain up to ${MAX_ACADEMY_ASSESSMENT_QUESTIONS} questions.` });
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
      const lessons = await getAcademyLessonsForModules(modules.map((module) => module.id));
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

    learnerReview: adminProcedure.input(z.object({ enrollmentId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.select({ enrollment: academyEnrollments, course: academyCourses, agent: users, profile: agentCrmProfiles })
        .from(academyEnrollments)
        .innerJoin(academyCourses, eq(academyCourses.id, academyEnrollments.courseId))
        .innerJoin(users, eq(users.id, academyEnrollments.agentId))
        .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, academyEnrollments.agentId))
        .where(eq(academyEnrollments.id, input.enrollmentId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Academy enrolment not found" });

      const structure = await courseStructure(row.course.id);
      const lessonIds = structure.lessons.map((lesson) => lesson.id);
      const progress = lessonIds.length ? await db.select().from(academyLessonProgress).where(eq(academyLessonProgress.enrollmentId, row.enrollment.id)) : [];
      const attempts = lessonIds.length ? await db.select().from(academyAssessmentAttempts)
        .where(eq(academyAssessmentAttempts.enrollmentId, row.enrollment.id)).orderBy(desc(academyAssessmentAttempts.takenAt)) : [];
      const attemptIds = attempts.map((attempt) => attempt.id);
      const responses = attemptIds.length ? await db.select().from(academyAssessmentResponses).where(inArray(academyAssessmentResponses.attemptId, attemptIds)) : [];
      const audit = await db.select().from(academyAuditLog)
        .where(eq(academyAuditLog.enrollmentId, row.enrollment.id)).orderBy(desc(academyAuditLog.createdAt)).limit(100);
      const requiredLessonIds = structure.lessons.filter((lesson) => lesson.isRequired).map((lesson) => lesson.id);
      const completion = summariseAcademyProgress(requiredLessonIds, progress.filter((item) => item.completedAt).map((item) => item.lessonId));
      const currentRequiredLesson = structure.lessons.find((lesson) => lesson.isRequired && !progress.some((item) => item.lessonId === lesson.id && item.completedAt)) ?? null;

      return {
        enrollment: row.enrollment,
        agent: { id: row.agent.id, name: row.agent.name, email: row.agent.email, trainingStage: row.profile?.trainingStage ?? null },
        course: { id: row.course.id, title: row.course.title },
        completion,
        currentRequiredLesson: currentRequiredLesson ? { id: currentRequiredLesson.id, title: currentRequiredLesson.title } : null,
        modules: structure.modules.map((module) => ({
          id: module.id,
          title: module.title,
          lessons: module.lessons.map((lesson) => {
            const lessonProgress = progress.find((item) => item.lessonId === lesson.id) ?? null;
            const lessonAttempts = attempts.filter((attempt) => attempt.lessonId === lesson.id);
            return {
              id: lesson.id,
              title: lesson.title,
              isRequired: lesson.isRequired,
              requiresAcknowledgement: lesson.requiresAcknowledgement,
              requiresAssessment: lesson.requiresAssessment,
              progress: lessonProgress,
              attempts: lessonAttempts.map((attempt) => ({
                id: attempt.id,
                status: attempt.status,
                score: attempt.score,
                passed: attempt.passed,
                graderFeedback: attempt.graderFeedback,
                gradedAt: attempt.gradedAt,
                feedbackAcknowledgedAt: attempt.feedbackAcknowledgedAt,
                takenAt: attempt.takenAt,
                responses: responses.filter((response) => response.attemptId === attempt.id).map((response) => {
                  const question = lesson.questions.find((item) => item.id === response.questionId);
                  const options = asOptions(question?.answerOptions);
                  return {
                    questionId: response.questionId,
                    prompt: question?.prompt ?? "Question no longer in this lesson",
                    questionType: question?.questionType ?? "multiple_choice",
                    selectedAnswer: response.selectedIndex === null ? null : options[response.selectedIndex] ?? null,
                    correctAnswer: question?.questionType === "multiple_choice" ? options[question.correctAnswerIndex] ?? null : null,
                    responseText: response.responseText,
                    score: response.score,
                    feedback: response.feedback,
                    gradedAt: response.gradedAt,
                  };
                }),
              })),
            };
          }),
        })),
        audit: audit.map((item) => ({ id: item.id, action: item.action, summary: item.summary, metadata: item.metadata, createdAt: item.createdAt })),
      };
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
      if (course?.isCoreAcademy && input.action !== "reopen") {
        await db.update(agentCrmProfiles).set({ trainingStage: "Agent Accelerator", academyAcceleratorStartedAt: now }).where(eq(agentCrmProfiles.userId, enrollment.agentId));
        // Staff overrides are a deliberate outcome, not a shortcut around the
        // normal progression hand-off. Both operations are idempotent through
        // their enrolment and assignment keys.
        await enrolAgentInAcceleratorJourneys({ agentId: enrollment.agentId, actorId: ctx.user.id, startedAt: now });
        await assignAcceleratorEntryActions(enrollment.agentId, ctx.user.id);
      }
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
          void sendDirectEmail({ toEmail: agent.email, toName: agent.name ?? "JLT Agent", userId: agent.id, subject: `Academy reminder: ${course.title} is due`, html: `<p>Hi ${(agent.name ?? "there").split(" ")[0]},</p><p><strong>${course.title}</strong> is now due. Please complete your remaining learning in the JLT Academy.</p><p><a href="https://portal.thejltgroup.co.uk/academy">Continue learning</a></p>` });
        }
        await db.update(academyEnrollments).set({ lastReminderAt: now }).where(eq(academyEnrollments.id, enrollment.id));
        await addAudit({ agentId: agent.id, courseId: course.id, enrollmentId: enrollment.id, actorId: ctx.user.id, action: "due_reminder_sent", summary: `Sent Academy due reminder for ${course.title}` });
        sent++;
      }
      return { sent };
    }),
  }),
});
