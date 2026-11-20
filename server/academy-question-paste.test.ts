import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { academyMockDb } from "./academy-staff-test-db";

const state = vi.hoisted(() => ({
  db: null as any,
  courseIds: [1] as number[],
  audit: vi.fn(),
  execute: vi.fn(),
  notify: vi.fn(),
  email: vi.fn(),
}));
vi.mock("./db", () => ({
  getDb: async () => state.db,
  // A strictly in-memory stub, only enabled by the learner tampering test.
  getRawDbPool: async () => ({ execute: (...args: any[]) => state.execute(...args) }),
  createInAppNotification: (...args: any[]) => state.notify(...args),
  getUpcomingAgentEvents: vi.fn(),
}));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storagePutEncrypted: vi.fn(), storageGetDecrypted: vi.fn() }));
vi.mock("./email", () => ({ sendDirectEmail: (...args: any[]) => state.email(...args), sendSupportEmail: vi.fn() }));
vi.mock("./agent-development-router", () => ({ assignAcceleratorEntryActions: vi.fn(), releaseAvailableJourneyActions: vi.fn() }));
vi.mock("./academy-email-alerts", () => ({
  ACADEMY_ALERT_EVENTS: ["course_assigned"],
  academyAlertAllowsModuleScope: vi.fn(),
  academyAlertTemplateHint: vi.fn(),
  dispatchAcademyEmailAlerts: vi.fn().mockResolvedValue(undefined),
  hasActiveAcademySupportAlert: vi.fn().mockResolvedValue(true),
}));
// Match the staff-access test pattern while exercising real lesson-parent
// authorization, procedure middleware, Zod parsing and Academy route handlers.
vi.mock("./staff-access", () => ({
  isFullAdmin: (user: any) => ["admin", "super_admin"].includes(user.role),
  getInstructorCourseIds: async (user: any) => ["admin", "super_admin"].includes(user.role) ? null : state.courseIds,
  requireInstructorCourse: async (user: any, courseId: number) => {
    if (!["admin", "super_admin"].includes(user.role) && !state.courseIds.includes(courseId)) throw new TRPCError({ code: "FORBIDDEN" });
  },
  assertNotSelfReview: vi.fn(),
  recordStaffOperation: async (...args: any[]) => {
    if (!["admin", "super_admin"].includes(args[0].role)) await state.audit(...args);
  },
}));
import { academyRouter } from "./academy-router";

const instructor = { id: 10, name: "Synthetic Instructor", email: "instructor@example.test", role: "agent", isActive: true, portalStatus: "active", mustChangePassword: false } as any;
const learner = { ...instructor, id: 20, name: "Synthetic Learner", email: "learner@example.test" };
const admin = { ...instructor, id: 99, role: "admin" };
const caller = (user: any = instructor) => academyRouter.createCaller({ user, req: {}, res: {} } as any);
let mock: ReturnType<typeof academyMockDb>;
const written = (id = 11, overrides: Record<string, any> = {}) => ({
  id, lessonId: 1, prompt: "Explain this synthetic topic", questionType: "free_text" as const,
  answerOptions: [], correctAnswerIndex: 0, maxWords: 250, explanation: "Synthetic private marking guide",
  sortOrder: 0, ...overrides,
});
const multipleChoice = (id = 12, overrides: Record<string, any> = {}) => written(id, {
  prompt: "Choose the synthetic answer", questionType: "multiple_choice", answerOptions: ["First", "Second"],
  correctAnswerIndex: 1, sortOrder: 1, ...overrides,
});
const questionInput = (question: ReturnType<typeof written>, overrides: Record<string, any> = {}) => ({
  id: question.id, prompt: question.prompt, questionType: question.questionType,
  answerOptions: question.answerOptions, correctAnswerIndex: question.correctAnswerIndex,
  maxWords: question.maxWords, explanation: question.explanation, ...overrides,
});
const save = (questions: any[], user: any = instructor, lessonId = 1) => caller(user).admin.replaceQuestions({ lessonId, questions });
const questionWrites = () => mock.writes.filter(write => write.table === "academy_questions");
const questionForLesson = () => mock.tables.academy_questions.find(question => question.lessonId === 1);
const auditRow = () => mock.tables.academy_audit_log.at(-1);
const protectedTables = ["academy_assessment_responses", "academy_assessment_attempts", "academy_lesson_progress", "academy_enrollments", "academy_assessment_question_resets"];
function addEvidence(kind: "progress" | "attempt" = "attempt") {
  if (kind === "progress") mock.tables.academy_lesson_progress.push({ id: 31, enrollmentId: 21, lessonId: 1, completedAt: new Date("2026-01-01"), startedAt: new Date("2025-12-31") });
  else {
    mock.tables.academy_assessment_attempts.push({ id: 41, enrollmentId: 21, lessonId: 1, status: "feedback_acknowledged", score: 96, passed: true, answers: [{ questionId: 11, responseText: "SYNTHETIC_PRIVATE_ANSWER" }], graderFeedback: "Synthetic old grade", takenAt: new Date("2026-01-01") });
    mock.tables.academy_assessment_responses.push({ id: 51, attemptId: 41, questionId: 11, responseText: "SYNTHETIC_PRIVATE_ANSWER", score: 96, feedback: "Synthetic old feedback", gradedById: 99 });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  state.courseIds = [1];
  state.audit.mockReset().mockResolvedValue(undefined);
  state.execute.mockReset().mockImplementation(() => { throw new Error("Raw database access is disabled in this isolated test"); });
  mock = academyMockDb({
    business_staff_memberships: [],
    academy_courses: [{ id: 1, title: "Synthetic Assigned Course", status: "published", isAcceleratorJourney: false }, { id: 2, title: "Synthetic Other Course", status: "published" }],
    academy_modules: [{ id: 1, courseId: 1, title: "Synthetic Module", sortOrder: 0 }, { id: 2, courseId: 2 }],
    academy_lessons: [{ id: 1, moduleId: 1, title: "Synthetic Written Lesson", assessmentMode: "quiz", assessmentPassMark: 90, requiresAssessment: true, requiresAcknowledgement: false, isRequired: true, sortOrder: 0, archivedAt: null, videoTranscript: "SYNTHETIC_PRIVATE_TRANSCRIPT", assessmentTemplateKey: "synthetic-private-key" }, { id: 2, moduleId: 2, title: "Synthetic Other Lesson", assessmentMode: "quiz" }],
    academy_questions: [written()],
    academy_enrollments: [{ id: 21, courseId: 1, agentId: 20, status: "assigned" }],
    academy_access: [{ id: 1, agentId: 20, status: "active" }],
    academy_assessment_attempts: [], academy_assessment_responses: [], academy_lesson_progress: [], academy_assessment_question_resets: [], academy_audit_log: [],
    users: [{ id: 20, name: learner.name, email: learner.email }], staff_academy_uploads: [],
  });
  state.db = mock.db;
});

describe("Academy per-question paste policy actual save routes", () => {
  it("defaults new written questions off without an input flag", async () => {
    await save([{ prompt: "A brand new written question", questionType: "free_text" }]);
    expect(questionForLesson()).toMatchObject({ allowPaste: false, questionType: "free_text", maxWords: 250, answerOptions: [], correctAnswerIndex: 0 });
  });

  it.each([true, false])("persists an explicit new written question setting %s", async allowPaste => {
    await save([{ prompt: "A brand new written question", questionType: "free_text", allowPaste }]);
    expect(questionForLesson().allowPaste).toBe(allowPaste);
  });

  it("can toggle existing written permissions on and back off without learner evidence", async () => {
    await save([questionInput(written(), { allowPaste: true })]);
    expect(questionForLesson().allowPaste).toBe(true);
    await save([questionInput(questionForLesson(), { allowPaste: false })]);
    expect(questionForLesson().allowPaste).toBe(false);
    expect(auditRow()).toMatchObject({ action: "assessment_updated", metadata: { pastePolicyChanges: [{ questionId: questionForLesson().id, sortOrder: 0, previousAllowPaste: true, allowPaste: false }] } });
  });

  it("preserves omitted true by submitted existing ID even when replacing and reordering", async () => {
    mock.tables.academy_questions = [written(11, { allowPaste: true }), written(12, { allowPaste: false, sortOrder: 1 })];
    await save([questionInput(mock.tables.academy_questions[1]), questionInput(mock.tables.academy_questions[0])]);
    expect(mock.tables.academy_questions.filter(question => question.lessonId === 1).map(question => question.allowPaste)).toEqual([false, true]);
    expect(auditRow().metadata).not.toHaveProperty("pastePolicyChanges");
  });

  it("does not copy true from an unnamed old question to a new replacement", async () => {
    mock.tables.academy_questions[0].allowPaste = true;
    await save([{ prompt: "A new replacement question", questionType: "free_text" }]);
    expect(questionForLesson().allowPaste).toBe(false);
  });

  it.each([true, false, undefined])("always persists multiple-choice paste permission false for input %s", async allowPaste => {
    mock.tables.academy_questions = [multipleChoice(12, { allowPaste: true })];
    await save([questionInput(mock.tables.academy_questions[0], { allowPaste })]);
    expect(questionForLesson()).toMatchObject({ questionType: "multiple_choice", allowPaste: false, answerOptions: ["First", "Second"], correctAnswerIndex: 1 });
  });

  it("lets a full admin save despite having no instructor grants", async () => {
    state.courseIds = [];
    await save([questionInput(written(), { allowPaste: true })], admin);
    expect(questionForLesson().allowPaste).toBe(true);
    expect(auditRow().actorId).toBe(admin.id);
  });
});

describe("paste permissions with historical learner evidence", () => {
  it.each(["progress", "attempt"] as const)("toggles only exact existing question IDs with %s evidence and preserves all history", async kind => {
    mock.tables.academy_questions = [written(11, { allowPaste: false }), written(12, { sortOrder: 1, allowPaste: true }), multipleChoice(13)];
    mock.tables.academy_questions.push(written(14, { lessonId: 2, allowPaste: true }));
    addEvidence(kind);
    const historical = structuredClone(Object.fromEntries(protectedTables.map(table => [table, mock.tables[table]])));
    for (const allowPaste of [true, false]) {
      await expect(save([
        questionInput(written(), { allowPaste, prompt: "Revised synthetic question wording" }),
        questionInput(written(12, { sortOrder: 1 }), { allowPaste: !allowPaste }),
        questionInput(multipleChoice(13), { allowPaste: true }),
      ])).resolves.toEqual({ success: true, narrativeRevision: true });
      expect(mock.tables.academy_questions.map(question => question.id)).toEqual([11, 12, 13, 14]);
      expect(mock.tables.academy_questions.map(question => question.allowPaste)).toEqual([allowPaste, !allowPaste, false, true]);
      expect(auditRow()).toMatchObject({ action: "assessment_question_paste_policy_updated", metadata: { lessonId: 1, learnerEvidencePresent: true, pastePolicyChanges: [
        { questionId: 11, previousAllowPaste: !allowPaste, allowPaste },
        { questionId: 12, previousAllowPaste: allowPaste, allowPaste: !allowPaste },
      ] } });
    }
    expect(questionWrites()).toHaveLength(6);
    expect(questionWrites().every(write => write.operation === "update")).toBe(true);
    expect(mock.writes.every(write => ["academy_questions", "academy_audit_log"].includes(write.table))).toBe(true);
    for (const table of protectedTables) expect(mock.tables[table]).toEqual(historical[table]);
    expect(mock.reads.filter(read => ["academy_assessment_responses", "academy_lesson_progress", "academy_assessment_attempts"].includes(read.table)).every(read => read.table !== "academy_assessment_responses" && Object.keys(read.projection).join() === "id")).toBe(true);
    expect(state.audit).toHaveBeenCalledWith(instructor, "academy.question_paste_update", expect.objectContaining({ courseId: 1, lessonId: 1 }));
    expect(JSON.stringify(mock.tables.academy_audit_log)).not.toMatch(/SYNTHETIC_PRIVATE_ANSWER|Synthetic private marking guide|Revised synthetic question wording/);
    expect(JSON.stringify(state.audit.mock.calls)).not.toMatch(/SYNTHETIC_PRIVATE_ANSWER|Synthetic private marking guide|Revised synthetic question wording/);
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
    expect(state.email).not.toHaveBeenCalled();
  });

  it("preserves an omitted true flag and the existing narrative-only audit action", async () => {
    mock.tables.academy_questions[0].allowPaste = true;
    addEvidence();
    await save([questionInput(written(), { prompt: "Narrative-only synthetic update" })]);
    expect(questionForLesson()).toMatchObject({ id: 11, allowPaste: true });
    expect(auditRow()).toMatchObject({ action: "assessment_question_text_updated", metadata: { learnerEvidencePresent: true } });
    expect(auditRow().metadata).not.toHaveProperty("pastePolicyChanges");
    expect(state.audit).toHaveBeenCalledWith(instructor, "academy.question_text_update", expect.not.objectContaining({ pastePolicyChanges: expect.anything() }));
    expect(questionWrites().map(write => write.operation)).toEqual(["update"]);
  });

  it.each([
    ["word limit", { maxWords: 300 }],
    ["type", { questionType: "multiple_choice", answerOptions: ["First", "Second"] }],
    ["options", { answerOptions: ["Changed"] }],
    ["correct answer", { correctAnswerIndex: 1 }],
    ["missing existing ID", { id: undefined }],
  ])("keeps the %s evidence protection even alongside a paste change", async (_name, overrides) => {
    addEvidence();
    await expect(save([questionInput(written(), { ...overrides as any, allowPaste: true })])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mock.writes).toEqual([]);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("protects question order and count after learner evidence", async () => {
    mock.tables.academy_questions.push(written(12, { sortOrder: 1 }));
    addEvidence();
    await expect(save([questionInput(written(12), { allowPaste: true }), questionInput(written())])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(save([questionInput(written(), { allowPaste: true })])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mock.writes).toEqual([]);
  });

  it("prevents policy writes when the mandatory staff operation audit fails", async () => {
    addEvidence();
    state.audit.mockRejectedValue(new Error("synthetic audit failure"));
    await expect(save([questionInput(written(), { allowPaste: true })])).rejects.toThrow("The Academy operation is temporarily unavailable");
    expect(mock.writes).toEqual([]);
  });
});

describe("learner and staff preview paste-policy projections", () => {
  it.each(["learner", "preview"] as const)("returns normalized booleans without private answer keys in %s projection", async view => {
    mock.tables.academy_questions = [
      written(11, { allowPaste: true }), written(12, { allowPaste: false }), written(13),
      written(14, { allowPaste: null }), multipleChoice(15, { allowPaste: true }),
    ];
    const result = view === "learner" ? await caller(learner).agent.course({ enrollmentId: 21 }) : await caller(admin).agent.previewCourse({ courseId: 1 });
    const lesson = result.modules[0].lessons[0];
    expect(lesson.questions.map(question => question.allowPaste)).toEqual([true, false, false, false, false]);
    for (const question of lesson.questions) {
      expect(typeof question.allowPaste).toBe("boolean");
      expect(question).not.toHaveProperty("correctAnswerIndex");
      expect(question).not.toHaveProperty("explanation");
    }
    expect(lesson).not.toHaveProperty("videoTranscript");
    expect(lesson).not.toHaveProperty("assessmentTemplateKey");
    expect(mock.writes).toEqual([]);
  });

  it("retains the stored field in the scoped staff editor projection", async () => {
    mock.tables.academy_questions[0].allowPaste = true;
    const result = await caller().admin.editor({ courseId: 1 });
    expect(result.modules[0].lessons[0].questions[0].allowPaste).toBe(true);
    expect(mock.writes).toEqual([]);
  });
});

describe("paste setting input and authority boundaries", () => {
  it.each(["true", 1, 0, null, {}, []])("rejects the nonboolean setting %j before question writes", async allowPaste => {
    await expect(save([questionInput(written(), { allowPaste })])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mock.writes).toEqual([]);
    expect(state.audit).not.toHaveBeenCalled();
    expect(mock.reads.some(read => read.table === "academy_questions")).toBe(false);
  });

  it("rejects unauthenticated and unassigned callers", async () => {
    await expect(save([questionInput(written(), { allowPaste: true })], null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    state.courseIds = [];
    await expect(save([questionInput(written(), { allowPaste: true })], learner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.reads.some(read => read.table === "academy_questions")).toBe(false);
    expect(mock.writes).toEqual([]);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("denies an instructor's out-of-scope lesson using its actual stored parent", async () => {
    await expect(save([{ prompt: "Synthetic forbidden question", questionType: "free_text", allowPaste: true }], instructor, 2)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.reads.some(read => read.table === "academy_questions")).toBe(false);
    expect(mock.writes).toEqual([]);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("rejects duplicate and borrowed question IDs before writes", async () => {
    mock.tables.academy_questions.push(written(12, { lessonId: 2 }));
    await expect(save([questionInput(written(12), { allowPaste: true })])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(save([questionInput(written()), questionInput(written(), { allowPaste: true })])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mock.writes).toEqual([]);
  });

  it("learner answer submission strips a forged paste setting and never writes question policy", async () => {
    state.courseIds = [];
    state.execute.mockResolvedValue([{ insertId: 71 }]);
    await expect(caller(learner).agent.submitAssessment({
      enrollmentId: 21, lessonId: 1, allowPaste: true,
      answers: [{ questionId: 11, responseText: "Synthetic learner answer", allowPaste: true }],
    } as any)).resolves.toMatchObject({ attemptId: 71, status: "awaiting_marking" });
    expect(questionForLesson()).not.toHaveProperty("allowPaste");
    expect(questionWrites()).toEqual([]);
    expect(JSON.parse(state.execute.mock.calls[0][1][5])).toEqual([{ questionId: 11, responseText: "Synthetic learner answer" }]);
    expect(mock.tables.academy_assessment_responses[0]).not.toHaveProperty("allowPaste");
  });

  it.each([false, true])("keeps the stored written word limit enforced with paste permission %s", async allowPaste => {
    mock.tables.academy_questions[0].allowPaste = allowPaste;
    await expect(caller(learner).agent.submitAssessment({ enrollmentId: 21, lessonId: 1, answers: [{ questionId: 11, responseText: Array(251).fill("synthetic").join(" ") }] })).rejects.toThrow("Written responses must be 250 words or fewer");
    expect(mock.writes).toEqual([]);
    expect(state.execute).not.toHaveBeenCalled();
  });
});

describe("live multiple-choice wording revisions preserve evidence", () => {
  const oldPrompt = "What is the difference between a net rate and a commissionable rate?";
  const revisedPrompt = "Question 8: How does a net rate differ from a commissionable rate?";
  const oldOptions = [
    "A net rate excludes commission; a commissionable rate includes commission.",
    "A net rate includes commission; a commissionable rate excludes commission.",
    "Both rates always include commission.",
    "Both rates are the same.",
  ];
  const revisedOptions = [
    "A net rate is the supplier's price before your markup; a commissionable rate includes the commission paid to you.",
    "A net rate already includes your commission; a commissionable rate is the supplier's price before your markup.",
    "Both rates include the same fixed commission payment.",
    "There is no difference between a net rate and a commissionable rate.",
  ];
  const liveChoice = (id = 18, overrides: Record<string, any> = {}) => multipleChoice(id, {
    prompt: oldPrompt, answerOptions: oldOptions, correctAnswerIndex: 0, sortOrder: 7, ...overrides,
  });
  const historicalBytes = () => JSON.stringify(Object.fromEntries(protectedTables.map(table => [table, mock.tables[table]])));
  const assertSaveBoundary = (history: string) => {
    expect(historicalBytes()).toBe(history);
    expect(mock.writes.every(write => ["academy_questions", "academy_audit_log"].includes(write.table))).toBe(true);
    expect(questionWrites().every(write => write.operation === "update")).toBe(true);
    expect(mock.reads.some(read => read.table === "academy_assessment_responses")).toBe(false);
    expect(mock.reads.filter(read => ["academy_lesson_progress", "academy_assessment_attempts"].includes(read.table)).every(read => Object.keys(read.projection).join() === "id")).toBe(true);
    expect(mock.reads.filter(read => read.table === "academy_lessons").every(read => read.projection && !Object.keys(read.projection).some(key => ["videoTranscript", "assessmentTemplateKey"].includes(key)))).toBe(true);
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
    expect(state.email).not.toHaveBeenCalled();
  };

  it.each([
    { role: "admin", user: admin, kind: "progress" }, { role: "admin", user: admin, kind: "attempt" },
    { role: "instructor", user: instructor, kind: "progress" }, { role: "instructor", user: instructor, kind: "attempt" },
  ] as const)("lets $role revise question 8 wording and options with $kind evidence", async ({ user, kind }) => {
    if (user === admin) state.courseIds = [];
    mock.tables.academy_questions = [
      ...Array.from({ length: 7 }, (_, index) => written(11 + index, { sortOrder: index, ...(index === 0 ? { allowPaste: true } : {}) })),
      liveChoice(18, { allowPaste: true }), written(19, { lessonId: 2 }),
    ];
    addEvidence(kind);
    mock.tables.academy_assessment_question_resets.push({ id: 61, enrollmentId: 21, lessonId: 1, questionId: 11, createdAt: new Date("2025-01-01"), reason: "Synthetic retained reset" });
    const history = historicalBytes();
    const otherLesson = JSON.stringify(mock.tables.academy_questions[8]);
    const inputs = mock.tables.academy_questions.slice(0, 8).map(question => questionInput(question));
    inputs[7] = { id: 18, prompt: revisedPrompt, questionType: "multiple_choice", answerOptions: revisedOptions, explanation: "PRIVATE_REVISED_RATE_GUIDE" } as any;
    await expect(save(inputs, user)).resolves.toEqual({ success: true, narrativeRevision: true });
    expect(mock.tables.academy_questions.map(question => question.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(mock.tables.academy_questions[7]).toMatchObject({ id: 18, prompt: revisedPrompt, answerOptions: revisedOptions, correctAnswerIndex: 0, maxWords: 250, questionType: "multiple_choice", sortOrder: 7, allowPaste: false, explanation: "PRIVATE_REVISED_RATE_GUIDE" });
    expect(mock.tables.academy_questions.slice(0, 7).map(question => question.allowPaste)).toEqual([true, false, false, false, false, false, false]);
    expect(JSON.stringify(mock.tables.academy_questions[8])).toBe(otherLesson);
    expect(questionWrites()).toHaveLength(8);
    expect(questionWrites().slice(0, 7).every(write => !("answerOptions" in write.values))).toBe(true);
    assertSaveBoundary(history);
    const audit = JSON.stringify([mock.tables.academy_audit_log, state.audit.mock.calls]);
    for (const text of [oldPrompt, revisedPrompt, ...oldOptions, ...revisedOptions, "PRIVATE_REVISED_RATE_GUIDE", "Synthetic private marking guide", "SYNTHETIC_PRIVATE_ANSWER"]) expect(audit).not.toContain(text);
  });

  it.each([admin, instructor])("allows prompt/guide-only edits when older options contain whitespace for role $role", async user => {
    mock.tables.academy_questions = [written(11, { allowPaste: true }), liveChoice(18, { answerOptions: oldOptions.map(option => `  ${option} \n`) })];
    addEvidence();
    const history = historicalBytes();
    await expect(save([
      questionInput(mock.tables.academy_questions[0]),
      questionInput(mock.tables.academy_questions[1], { prompt: revisedPrompt, explanation: "PRIVATE_WHITESPACE_GUIDE" }),
    ], user)).resolves.toEqual({ success: true, narrativeRevision: true });
    expect(mock.tables.academy_questions[1]).toMatchObject({ id: 18, prompt: revisedPrompt, answerOptions: oldOptions, explanation: "PRIVATE_WHITESPACE_GUIDE", correctAnswerIndex: 0 });
    expect(mock.tables.academy_questions[0].allowPaste).toBe(true);
    expect(auditRow().action).toBe("assessment_question_text_updated");
    expect(JSON.stringify([mock.tables.academy_audit_log, state.audit.mock.calls])).not.toContain("PRIVATE_WHITESPACE_GUIDE");
    assertSaveBoundary(history);
  });

  it.each([
    ["correct key", { correctAnswerIndex: 1 }],
    ["option removal", { answerOptions: revisedOptions.slice(0, 3) }],
    ["option addition", { answerOptions: [...revisedOptions, "An additional slot"] }],
    ["type", { questionType: "free_text", answerOptions: [] }],
    ["word limit", { maxWords: 300 }],
    ["missing ID", { id: undefined }],
  ])("rejects live MC %s changes before any write", async (_name, overrides) => {
    mock.tables.academy_questions = [liveChoice()];
    addEvidence();
    const history = historicalBytes();
    await expect(save([questionInput(mock.tables.academy_questions[0], { prompt: revisedPrompt, answerOptions: revisedOptions, ...overrides })])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mock.writes).toEqual([]);
    expect(state.audit).not.toHaveBeenCalled();
    expect(historicalBytes()).toBe(history);
  });

  it("keeps stored MC scores and actual learner resit states unchanged after wording edits", async () => {
    mock.tables.academy_questions = [liveChoice(18, { sortOrder: 0 }), liveChoice(19, { sortOrder: 1 })];
    mock.tables.academy_assessment_attempts.push({ id: 41, enrollmentId: 21, lessonId: 1, status: "feedback_acknowledged", score: 50, passed: false, answers: [{ questionId: 18, selectedIndex: 0 }, { questionId: 19, selectedIndex: 1 }], graderFeedback: "Retained historical feedback", takenAt: new Date("2026-01-01") });
    mock.tables.academy_assessment_responses.push(
      { id: 51, attemptId: 41, questionId: 18, selectedIndex: 0, score: 100, feedback: "Retained correct feedback" },
      { id: 52, attemptId: 41, questionId: 19, selectedIndex: 1, score: 0, feedback: "Retained incorrect feedback" },
    );
    const history = historicalBytes();
    const before = await caller(learner).agent.course({ enrollmentId: 21 });
    const beforeLesson = before.modules[0].lessons[0];
    await save(mock.tables.academy_questions.map(question => questionInput(question, { prompt: revisedPrompt, answerOptions: revisedOptions })));
    const after = await caller(learner).agent.course({ enrollmentId: 21 });
    const afterLesson = after.modules[0].lessons[0];
    expect(afterLesson.questions.map(question => question.resit)).toEqual(beforeLesson.questions.map(question => question.resit));
    expect(afterLesson.questions.map(question => question.resit)).toMatchObject([{ questionId: 18, lastScore: 100, passed: true, attemptCount: 1 }, { questionId: 19, lastScore: 0, passed: false, attemptCount: 1 }]);
    expect(afterLesson.attempts).toEqual(beforeLesson.attempts);
    expect(after.progress).toEqual(before.progress);
    expect(historicalBytes()).toBe(history);
    for (const question of afterLesson.questions) {
      expect(question).not.toHaveProperty("correctAnswerIndex");
      expect(question).not.toHaveProperty("explanation");
    }
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
    expect(state.email).not.toHaveBeenCalled();
    expect(mock.writes.every(write => ["academy_questions", "academy_audit_log"].includes(write.table))).toBe(true);
  });
});
