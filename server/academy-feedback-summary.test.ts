import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  academyAccess,
  academyAssessmentAttempts,
  academyAssessmentQuestionResets,
  academyAssessmentResponses,
  academyAuditLog,
  academyCourses,
  academyEnrollments,
  academyLessonProgress,
  academyLessons,
  academyModules,
  academyQuestions,
} from "../drizzle/schema";

const guards = vi.hoisted(() => ({
  getDb: vi.fn(),
  rawDb: vi.fn(() => { throw new Error("Live database access is forbidden in this suite"); }),
  external: vi.fn(() => { throw new Error("Email, providers, storage, and notifications are forbidden in this suite"); }),
  write: vi.fn(() => { throw new Error("Academy summaries must be read-only"); }),
}));

// Keep the actual router, tRPC middleware, schema, and feedback/progress helpers.
// Never import live DB, email, storage, auth SDK, or development-router providers.
vi.mock("./db", () => ({
  getDb: guards.getDb,
  getRawDbPool: guards.rawDb,
  createInAppNotification: guards.external,
  getUpcomingAgentEvents: guards.external,
}));
vi.mock("./email", () => ({ sendDirectEmail: guards.external, sendSupportEmail: guards.external }));
vi.mock("./storage", () => ({ storagePut: guards.external, storagePutEncrypted: guards.external }));
vi.mock("./academy-document-download-routes", () => ({ createAcademyDocumentDownloadUrl: guards.external }));
vi.mock("./agent-development-router", () => ({
  assignAcceleratorEntryActions: guards.external,
  releaseAvailableJourneyActions: guards.external,
}));
vi.mock("./academy-email-alerts", () => ({
  ACADEMY_ALERT_EVENTS: [
    "week_released", "module_started", "module_completed", "action_submitted_for_review",
    "action_overdue", "course_completed", "written_assessment_ready", "three_attempt_lock", "knowledge_check_passed",
  ],
  academyAlertAllowsModuleScope: guards.external,
  academyAlertTemplateHint: guards.external,
  dispatchAcademyEmailAlerts: guards.external,
  hasActiveAcademySupportAlert: guards.external,
}));
vi.mock("./_core/llm", () => ({ invokeLLM: guards.external }));

import { academyRouter } from "./academy-router";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const markedAt = new Date("2026-10-01T10:00:00Z");
const completedAt = new Date("2026-10-02T10:00:00Z");
const course = freeze({ id: 1, title: "Synthetic Academy", status: "published", estimatedMinutes: 30 });
const modules = freeze([{ id: 10, courseId: 1, title: "Synthetic module", sortOrder: 0 }]);
const lessonBase = {
  moduleId: 10,
  isRequired: true,
  estimatedMinutes: 10,
  requiresAcknowledgement: false,
  requiresAssessment: true,
  assessmentPassMark: 90,
};
const lessons = freeze([
  { ...lessonBase, id: 11, title: "Written assessment", assessmentMode: "quiz", sortOrder: 0 },
  { ...lessonBase, id: 12, title: "Document assessment", assessmentMode: "document_upload", sortOrder: 1 },
  { ...lessonBase, id: 13, title: "Assessment removed", assessmentMode: "quiz", requiresAssessment: false, sortOrder: 2 },
]);
const rows = freeze([101, 102].map((id, index) => ({
  enrollment: {
    id, agentId: 201 + index, courseId: 1, status: "in_progress",
    dueDate: null, completedAt: null, enrolledAt: markedAt, updatedAt: markedAt,
  },
  course,
  agent: { id: 201 + index, name: `Synthetic learner ${index + 1}`, email: `learner${index + 1}@example.test` },
  profile: { trainingStage: "academy", academyAcceleratorStartedAt: null },
})));

function fixtures(reopened = false) {
  const progress = [
    { enrollmentId: 101, lessonId: 11, completedAt: reopened ? null : completedAt },
    { enrollmentId: 101, lessonId: 12, completedAt: null },
    { enrollmentId: 102, lessonId: 11, completedAt: null },
    { enrollmentId: 102, lessonId: 12, completedAt },
  ].map((item, index) => ({
    id: index + 1,
    startedAt: markedAt, lastViewedAt: markedAt, lastActivityAt: markedAt,
    lessonActiveSeconds: 10, assessmentActiveSeconds: 5,
    ...item,
  }));
  const attemptBase = {
    status: "feedback_pending", score: 94, passed: true,
    graderFeedback: "Original staff feedback must remain unchanged.",
    gradedById: 1, gradedAt: markedAt, feedbackAcknowledgedAt: null,
    answers: { synthetic: "Original answer" }, submissionFileKey: null,
    takenAt: markedAt,
  };
  const attempts = [
    { ...attemptBase, id: 1, enrollmentId: 101, lessonId: 11 },
    { ...attemptBase, id: 2, enrollmentId: 102, lessonId: 11 },
    { ...attemptBase, id: 3, enrollmentId: 101, lessonId: 12, submissionFileKey: "synthetic/document-one.pdf" },
    { ...attemptBase, id: 4, enrollmentId: 102, lessonId: 12, submissionFileKey: "synthetic/document-two.pdf" },
    { ...attemptBase, id: 5, enrollmentId: 101, lessonId: 13 },
    { ...attemptBase, id: 6, enrollmentId: 101, lessonId: 999 }, // removed lesson
    { ...attemptBase, id: 7, enrollmentId: 102, lessonId: 11, feedbackAcknowledgedAt: completedAt },
    { ...attemptBase, id: 8, enrollmentId: 101, lessonId: 12, status: "feedback_acknowledged", feedbackAcknowledgedAt: completedAt },
    { ...attemptBase, id: 9, enrollmentId: 102, lessonId: 12, status: "awaiting_marking", score: null, passed: null },
  ];
  return freeze({ rows, modules, lessons, progress, attempts });
}

type QueryFixture = { table: unknown; rows: readonly unknown[] };
const queryFixtures: QueryFixture[] = [];

// Each select consumes one explicit fixture, checks the actual queried table,
// and supports both awaited chains and .limit() chains. An unplanned query fails.
const db = {
  select: vi.fn(() => {
    const fixture = queryFixtures.shift();
    if (!fixture) throw new Error("Unexpected select: no synthetic query fixture remains");
    const chain: any = {
      from: vi.fn((table: unknown) => {
        expect(table).toBe(fixture.table);
        return chain;
      }),
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (rows: readonly unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(fixture.rows).then(resolve, reject),
    };
    return chain;
  }),
  insert: guards.write,
  update: guards.write,
  delete: guards.write,
  execute: guards.rawDb,
  transaction: guards.write,
};

function caller() {
  return academyRouter.createCaller({
    user: { id: 1, role: "admin", name: "Synthetic admin", email: "admin@example.test" },
    req: {}, res: {},
  } as any);
}

function queueInsights(data: ReturnType<typeof fixtures>) {
  queryFixtures.push(
    { table: academyCourses, rows: [course] },
    { table: academyEnrollments, rows: data.rows },
    { table: academyModules, rows: data.modules },
    { table: academyLessons, rows: data.lessons },
    { table: academyLessonProgress, rows: data.progress },
    { table: academyAssessmentAttempts, rows: data.attempts },
    { table: academyAssessmentResponses, rows: [] },
    { table: academyQuestions, rows: [] },
    { table: academyAssessmentQuestionResets, rows: [] },
  );
}

function queueAgentSummary(data: ReturnType<typeof fixtures>, enrollmentId: number) {
  const access = freeze({ status: "active", grantedAt: markedAt, revokedAt: null });
  const audit = freeze({ id: 501, action: "migration_completion_recorded", summary: "Synthetic staff completion", createdAt: completedAt });
  queryFixtures.push(
    { table: academyAccess, rows: [access] },
    { table: academyEnrollments, rows: data.rows.filter((row) => row.enrollment.id === enrollmentId) },
    { table: academyModules, rows: data.modules },
    { table: academyLessons, rows: data.lessons },
    { table: academyLessonProgress, rows: data.progress.filter((item) => item.enrollmentId === enrollmentId) },
    { table: academyAssessmentAttempts, rows: data.attempts.filter((item) => item.enrollmentId === enrollmentId) },
    { table: academyAuditLog, rows: [audit] },
  );
}

beforeEach(() => {
  queryFixtures.length = 0;
  vi.clearAllMocks();
  guards.getDb.mockResolvedValue(db);
  vi.stubGlobal("fetch", guards.external);
});

afterEach(() => {
  try {
    expect(queryFixtures).toHaveLength(0);
    expect(guards.rawDb).not.toHaveBeenCalled();
    expect(guards.external).not.toHaveBeenCalled();
    expect(guards.write).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("academyRouter.admin actionable feedback summaries (offline)", () => {
  it("counts only actionable feedback per learner, overall, and per lesson without rewriting historical grades", async () => {
    const data = fixtures();
    const before = structuredClone(data);
    queueInsights(data);

    const result = await caller().admin.insights();
    expect(result.metrics.assessments).toMatchObject({ feedbackPending: 2, feedbackAcknowledged: 1, awaitingMarking: 1 });
    expect(result.learners.map((learner) => ({
      enrollmentId: learner.enrollment.id,
      pending: learner.assessment.feedbackPending,
      marking: learner.assessment.awaitingMarking,
    }))).toEqual([
      { enrollmentId: 101, pending: 1, marking: 0 },
      { enrollmentId: 102, pending: 1, marking: 1 },
    ]);
    expect(result.curriculum.lessons.map((lesson) => ({
      id: lesson.id, pending: lesson.feedbackPending, completed: lesson.completed, marking: lesson.awaitingMarking,
    }))).toEqual([
      { id: 11, pending: 1, completed: 1, marking: 0 },
      { id: 12, pending: 1, completed: 1, marking: 1 },
      { id: 13, pending: 0, completed: 0, marking: 0 },
    ]);
    expect(db.select).toHaveBeenCalledTimes(9);
    expect(data).toEqual(before);
    expect(data.attempts[0]).toMatchObject({ status: "feedback_pending", score: 94, passed: true, feedbackAcknowledgedAt: null });
    expect(data.attempts[3]).toMatchObject({ status: "feedback_pending", submissionFileKey: "synthetic/document-two.pdf" });
  });

  it("restores feedback after reopening a completed lesson without hiding another learner's same-lesson feedback", async () => {
    const data = fixtures(true);
    const before = structuredClone(data);
    queueInsights(data);

    const result = await caller().admin.insights({ courseId: 1 });
    expect(result.metrics.assessments.feedbackPending).toBe(3);
    expect(result.learners.map((learner) => learner.assessment.feedbackPending)).toEqual([2, 1]);
    expect(result.curriculum.lessons.map((lesson) => lesson.feedbackPending)).toEqual([2, 1, 0]);
    expect(data).toEqual(before);
  });

  it.each([false, true])("keeps agentSummary aligned with learner insights when reopened=%s", async (reopened) => {
    const data = fixtures(reopened);
    const before = structuredClone(data);
    queueInsights(data);
    const insights = await caller().admin.insights();

    for (const [index, enrollmentId] of [101, 102].entries()) {
      queueAgentSummary(data, enrollmentId);
      const result = await caller().admin.agentSummary({ agentId: 201 + index });
      expect(result.access).toMatchObject({ status: "active", grantedAt: markedAt, revokedAt: null });
      expect(result.enrolments).toHaveLength(1);
      expect(result.enrolments[0].enrollment.id).toBe(enrollmentId);
      expect(result.enrolments[0].assessment).toEqual({
        feedbackPending: enrollmentId === 101 && reopened ? 2 : 1,
        awaitingMarking: enrollmentId === 102 ? 1 : 0,
      });
      expect(result.enrolments[0].assessment.feedbackPending).toBe(insights.learners[index].assessment.feedbackPending);
      expect(result.enrolments[0].completion).toEqual(insights.learners[index].completion);
      expect(result.recentActivity).toEqual([{
        id: 501, action: "migration_completion_recorded", summary: "Synthetic staff completion", createdAt: completedAt,
      }]);
    }
    expect(db.select).toHaveBeenCalledTimes(23);
    expect(data).toEqual(before);
    expect(Object.isFrozen(data.attempts)).toBe(true);
  });
});
