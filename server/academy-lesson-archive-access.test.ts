import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const state = vi.hoisted(() => ({ db: null as any, legacyColumn: null as string | null, archive: vi.fn(), notify: vi.fn(), email: vi.fn(), alerts: vi.fn(), llm: vi.fn(), storage: vi.fn(), historyUrl: vi.fn(), external: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => state.db, getRawDbPool: vi.fn(() => { throw new Error("Raw/live database access prohibited in synthetic tests"); }), createInAppNotification: (...args: any[]) => state.notify(...args), getUpcomingAgentEvents: async () => [] }));
vi.mock("./academy-lesson-archive", () => ({ setAcademyLessonArchived: (...args: any[]) => state.archive(...args) }));
vi.mock("./email", () => ({ sendDirectEmail: (...args: any[]) => state.email(...args), sendSupportEmail: (...args: any[]) => state.email(...args) }));
vi.mock("./storage", () => ({ storagePut: (...args: any[]) => state.storage(...args), storagePutEncrypted: (...args: any[]) => state.storage(...args) }));
vi.mock("./agent-development-router", () => ({ assignAcceleratorEntryActions: vi.fn(), releaseAvailableJourneyActions: vi.fn() }));
vi.mock("./academy-email-alerts", () => ({ ACADEMY_ALERT_EVENTS: ["course_assigned"], academyAlertAllowsModuleScope: vi.fn(), academyAlertTemplateHint: vi.fn(), dispatchAcademyEmailAlerts: (...args: any[]) => state.alerts(...args), hasActiveAcademySupportAlert: vi.fn() }));
vi.mock("./_core/llm", () => ({ invokeLLM: (...args: any[]) => state.llm(...args) }));
// Issuance is captured at the router boundary: no real signing secret, SDK,
// storage lookup or external URL is used. Only our synthetic history payloads
// are accepted; unexpected issuer calls remain fail-closed.
vi.mock("./academy-document-download-routes", () => ({ createAcademyDocumentDownloadUrl: (...args: any[]) => state.historyUrl(...args) }));
import { academyRouter } from "./academy-router";
import { getStaffAccessSnapshot } from "./staff-access";

// Local adapter adds LEFT JOIN, deterministic ordering and captured SQL to the
// shared staff fixture approach. Every handler's real Drizzle
// predicate is evaluated against synthetic rows (never canned query results).
function archiveMockDb(initial: Record<string, any[]>) {
  const tables = structuredClone(initial);
  const reads: Array<{ table: string; projection: any; sql?: string }> = [];
  const writes: Array<{ table: string; operation: string; values?: any }> = [];
  const dialect = new MySqlDialect();
  const column = (item: any) => !!item?.table && typeof item.name === "string";
  const value = (item: any, bindings: Record<string, any>): any => {
    if (column(item)) {
      const row = bindings[getTableName(item.table)];
      return row === null ? null : row?.[item.name];
    }
    if (Array.isArray(item)) return item.map(part => value(part, bindings));
    if (item && "encoder" in item) return item.value;
    return item;
  };
  function matches(predicate: any, bindings: Record<string, any>): boolean {
    if (!predicate) return true;
    const chunks: any[] = predicate.queryChunks ?? [];
    const at = chunks.findIndex(column);
    if (at >= 0) {
      const op = chunks[at + 1]?.value?.join("").trim();
      const left = value(chunks[at], bindings);
      const right = value(chunks[at + 2], bindings);
      if (op === "is null") return left === null;
      if (op === "=") return left === right;
      if (op === "<>") return left !== right;
      if (op === "in") return right.includes(left);
      if (op === "<=") return left <= right;
      throw new Error(`Unsupported synthetic operator: ${op}`);
    }
    const nested = chunks.filter(chunk => !!chunk?.queryChunks);
    if (nested.length) return nested.every(chunk => matches(chunk, bindings));
    throw new Error("Unsupported synthetic SQL expression");
  }
  function project(projection: any, bindings: Record<string, any>, base: string): any {
    if (!projection) return { ...bindings[base] };
    if (column(projection)) return value(projection, bindings);
    if (projection?.[Symbol.for("drizzle:IsDrizzleTable")]) return bindings[getTableName(projection)] ? { ...bindings[getTableName(projection)] } : null;
    return Object.fromEntries(Object.entries(projection).map(([key, field]) => [key, project(field, bindings, base)]));
  }
  const db: any = {
    select(projection?: any) {
      let base = "";
      let bindings: Record<string, any>[] = [];
      let predicate: any;
      let max = Infinity;
      let ordering: any[] = [];
      let read: typeof reads[number];
      const join = (table: any, condition: any, left: boolean) => {
        const name = getTableName(table);
        bindings = bindings.flatMap(binding => {
          const joined = (tables[name] ?? []).map(row => ({ ...binding, [name]: row })).filter(next => matches(condition, next));
          return joined.length || !left ? joined : [{ ...binding, [name]: null }];
        });
        return query;
      };
      const query: any = {
        from(table: any) { base = getTableName(table); read = { table: base, projection }; reads.push(read); bindings = (tables[base] ?? []).map(row => ({ [base]: row })); return query; },
        innerJoin(table: any, condition: any) { return join(table, condition, false); },
        leftJoin(table: any, condition: any) { return join(table, condition, true); },
        where(condition: any) { predicate = condition; if (condition) read.sql = dialect.sqlToQuery(condition).sql; return query; },
        orderBy(...items: any[]) { ordering = items; return query; },
        limit(n: number) { max = n; return query; },
        then(resolve: any, reject: any) {
          return Promise.resolve().then(() => {
            if (base === "academy_lessons" && !projection && state.legacyColumn) throw { code: "ER_BAD_FIELD_ERROR", message: `Unknown column '${state.legacyColumn}' in 'field list'` };
            const rows = bindings.filter(binding => matches(predicate, binding));
            rows.sort((a, b) => {
              for (const item of ordering) {
                const chunks: any[] = item.queryChunks ?? [];
                const field = chunks.find(column);
                const direction = chunks.some(chunk => chunk?.value?.join("").trim() === "desc") ? -1 : 1;
                const left = value(field, a); const right = value(field, b);
                if (left < right) return -direction;
                if (left > right) return direction;
              }
              return 0;
            });
            return rows.slice(0, max).map(binding => project(projection, binding, base));
          }).then(resolve, reject);
        },
      };
      return query;
    },
    update(table: any) {
      const name = getTableName(table);
      return { set(values: any) { return { async where(predicate: any) {
        writes.push({ table: name, operation: "update", values });
        (tables[name] ?? []).filter(row => matches(predicate, { [name]: row })).forEach(row => Object.assign(row, values));
        return { affectedRows: 1 };
      } }; } };
    },
    insert(table: any) {
      const name = getTableName(table);
      return { async values(values: any) {
        writes.push({ table: name, operation: "insert", values });
        const rows = tables[name] ??= [];
        const id = rows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1;
        (Array.isArray(values) ? values : [values]).forEach((row, index) => rows.push({ id: id + index, ...row }));
        return { insertId: id };
      } };
    },
    delete(table: any) {
      const name = getTableName(table);
      return { async where(predicate: any) {
        writes.push({ table: name, operation: "delete" });
        tables[name] = (tables[name] ?? []).filter(row => !matches(predicate, { [name]: row }));
      } };
    },
  };
  return { db, tables, reads, writes };
}

const learner = { id: 10, role: "agent", name: "Synthetic learner", email: "learner@example.test", isActive: true, portalStatus: "active", mustChangePassword: false } as any;
const admin = { ...learner, id: 99, role: "admin" };
const caller = (user = learner) => academyRouter.createCaller({ user, req: {}, res: {} } as any);
const archivedAt = new Date("2026-10-20T12:00:00Z");
const historicalAt = new Date("2026-10-21T12:00:00Z");
const completedAt = new Date("2026-10-01T12:00:00Z");
const academyOrigin = "https://portal.thejltgroup.co.uk";
const syntheticHistoryUrl = (kind: string, userId: number, attemptId: number) => `${academyOrigin}/api/academy/assessment-document/synthetic-${kind}-staff-${userId}-enrollment-1-lesson-5-attempt-${attemptId}`;
const lesson = (id: number, moduleId: number, archive: Date | null = null) => ({ id, moduleId, archivedAt: archive, title: `Lesson ${id}`, sortOrder: id, isRequired: true, requiresAcknowledgement: true, requiresAssessment: false, assessmentMode: "quiz", assessmentPassMark: 90, assessmentTemplateKey: null, estimatedMinutes: 5, contentHtml: "<p>Synthetic lesson</p>", videoTranscript: "Staff-only source" });
const attempt = (id: number, lessonId: number, status: string, passed = false) => ({ id, enrollmentId: 1, lessonId, status, passed, score: passed ? 95 : 50, graderFeedback: "Saved feedback", takenAt: historicalAt, gradedAt: historicalAt, feedbackAcknowledgedAt: status === "feedback_acknowledged" ? historicalAt : null });
const question = (id: number, lessonId: number) => ({ id, lessonId, sortOrder: 0, questionType: "free_text", prompt: `Question ${id}`, explanation: "Synthetic staff guide", maxWords: 250, answerOptions: [], correctAnswerIndex: 0 });
let mock: ReturnType<typeof archiveMockDb>;

beforeEach(() => {
  vi.clearAllMocks(); state.legacyColumn = null;
  state.archive.mockResolvedValue({ success: true, lessonId: 2, archivedAt, changed: true });
  state.alerts.mockResolvedValue(undefined);
  state.external.mockImplementation(() => { throw new Error("External access is prohibited in synthetic archive tests"); });
  vi.stubGlobal("fetch", state.external);
  state.historyUrl.mockImplementation((payload: any, origin: string) => {
    const fields = ["kind", "scope", "userId", "enrollmentId", "lessonId", "attemptId"].sort();
    if (origin !== academyOrigin || payload.scope !== "staff"
      || !["submission", "template"].includes(payload.kind)
      || ![99, 100].includes(payload.userId) || payload.enrollmentId !== 1
      || payload.lessonId !== 5 || ![3, 6, 7, 8].includes(payload.attemptId)
      || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(fields)) {
      return state.external();
    }
    return syntheticHistoryUrl(payload.kind, payload.userId, payload.attemptId);
  });
  mock = archiveMockDb({
    academy_courses: [{ id: 1, title: "Synthetic course", status: "published", isCoreAcademy: false, isAcceleratorJourney: false }],
    academy_modules: [{ id: 1, courseId: 1, title: "First module", sortOrder: 0 }, { id: 2, courseId: 1, title: "Next module", sortOrder: 1 }],
    academy_lessons: [lesson(1, 1), { ...lesson(2, 1, archivedAt), requiresAssessment: true }, lesson(3, 1), lesson(4, 2), { ...lesson(5, 2, archivedAt), isRequired: false, requiresAssessment: true, assessmentMode: "document_upload", assessmentTemplateKey: "synthetic/template" }],
    academy_enrollments: [{ id: 1, courseId: 1, agentId: 10, status: "in_progress", enrolledAt: completedAt, startedAt: completedAt, dueDate: null, completedAt: null }],
    academy_access: [{ id: 1, agentId: 10, status: "active" }],
    academy_lesson_progress: [{ id: 1, enrollmentId: 1, lessonId: 1, startedAt: completedAt, completedAt, acknowledgedAt: completedAt }, { id: 2, enrollmentId: 1, lessonId: 2, startedAt: completedAt, completedAt: null, acknowledgedAt: completedAt, lastViewedAt: historicalAt, lessonActiveSeconds: 120, assessmentActiveSeconds: 60 }],
    academy_assessment_attempts: [attempt(1, 2, "feedback_pending"), attempt(2, 2, "awaiting_marking"), { ...attempt(3, 5, "awaiting_marking"), submissionFileKey: "synthetic/private-document", submissionFileName: "history.pdf", submissionMimeType: "application/pdf" }, attempt(4, 2, "feedback_acknowledged", true)],
    academy_questions: [question(20, 2), question(30, 3)],
    academy_assessment_responses: [{ id: 1, attemptId: 1, questionId: 20, responseText: "Preserved learner answer", score: 50, feedback: "Saved response feedback", selectedIndex: null, gradedAt: historicalAt }],
    academy_assessment_question_resets: [],
    academy_audit_log: [{ id: 1, enrollmentId: 1, agentId: 10, action: "assessment_marked", summary: "Historical assessment audit", createdAt: historicalAt }],
    users: [learner, admin], agent_crm_profiles: [], agent_record_merges: [], staff_role_assignments: [], staff_instructor_courses: [], staff_academy_uploads: [],
  });
  state.db = mock.db;
});

afterEach(() => {
  expect(state.external).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function expectNoSideEffects() {
  expect(mock.writes).toEqual([]);
  expect(state.archive).not.toHaveBeenCalled();
  expect(state.email).not.toHaveBeenCalled();
  expect(state.notify).not.toHaveBeenCalled();
  expect(state.alerts).not.toHaveBeenCalled();
  expect(state.llm).not.toHaveBeenCalled();
  expect(state.storage).not.toHaveBeenCalled();
}

const flatten = (result: { modules: Array<{ lessons: Array<{ id: number }> }> }) => result.modules.flatMap(module => module.lessons);

describe("active Academy lesson archive access (real router, synthetic DB)", () => {
  it.each([null, "videoTranscript", "assessmentMode"])("excludes archived lessons and questions on normal/legacy loading (%s)", async missingColumn => {
    state.legacyColumn = missingColumn;
    const result = await caller().agent.course({ enrollmentId: 1 });
    expect(flatten(result).map(row => row.id)).toEqual([1, 3, 4]);
    expect(result.progress).toEqual({ requiredLessons: 3, completedRequiredLessons: 1, percentage: 33, isComplete: false });
    expect(flatten(result).find(row => row.id === 3)).toMatchObject({ locked: false, questions: [{ id: 30 }] });
    const lessonReads = mock.reads.filter(read => read.table === "academy_lessons");
    expect(lessonReads).toHaveLength(missingColumn ? 2 : 1);
    for (const read of lessonReads) expect(read.sql).toContain("`academy_lessons`.`archivedAt` is null");
    if (missingColumn) expect(lessonReads[1].projection).toHaveProperty("archivedAt");
    expectNoSideEffects();
  });

  it("does not silently fall back if the archive column itself or an unrelated column is absent", async () => {
    for (const column of ["archivedAt", "unrelatedColumn"]) {
      state.legacyColumn = column;
      await expect(caller().agent.course({ enrollmentId: 1 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    }
    expectNoSideEffects();
  });

  it("unlocks and opens the next active required lesson despite hidden incomplete work and pending feedback", async () => {
    await expect(caller().agent.viewLesson({ enrollmentId: 1, lessonId: 3 })).resolves.toEqual({ success: true });
    expect(mock.tables.academy_lesson_progress.find(row => row.lessonId === 3)).toHaveProperty("startedAt");
    expect(mock.tables.academy_lesson_progress.find(row => row.lessonId === 2)).toMatchObject({ completedAt: null, acknowledgedAt: completedAt, lastViewedAt: historicalAt });
    expect(mock.tables.academy_assessment_attempts[0].status).toBe("feedback_pending");
  });

  it.each(["viewLesson", "recordActivity", "acknowledgeLesson", "completeLesson", "getDocumentAssessmentTemplate", "submitDocumentAssessment", "submitAssessment"] as const)("rejects direct hidden %s before progress, assessment, dates, storage or notifications change", async operation => {
    const input: any = { enrollmentId: 1, lessonId: operation === "submitDocumentAssessment" || operation === "getDocumentAssessmentTemplate" ? 5 : 2, area: "lesson", origin: "https://portal.example.test", fileName: "work.pdf", fileBase64: Buffer.from("%PDF synthetic").toString("base64"), mimeType: "application/pdf", answers: [{ questionId: 20, responseText: "Synthetic answer" }] };
    await expect((caller().agent[operation] as any)(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expectNoSideEffects();
  });

  it.each([false, true])("rejects archived feedback acknowledgement before ANY write (passed=%s)", async passed => {
    mock.tables.academy_assessment_attempts[0].passed = passed;
    await expect(caller().agent.acknowledgeAssessmentFeedback({ attemptId: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mock.tables.academy_assessment_attempts[0].status).toBe("feedback_pending");
    expectNoSideEffects();
  });

  it("still acknowledges failed active feedback without prematurely completing the lesson", async () => {
    mock.tables.academy_assessment_attempts[0].lessonId = 3;
    await expect(caller().agent.acknowledgeAssessmentFeedback({ attemptId: 1 })).resolves.toMatchObject({ success: true, passed: false });
    expect(mock.tables.academy_assessment_attempts[0]).toMatchObject({ status: "feedback_acknowledged", feedbackAcknowledgedAt: expect.any(Date) });
    expect(mock.writes.map(write => write.table)).toEqual(["academy_assessment_attempts", "academy_audit_log"]);
    expect(state.email).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled();
  });

  it("validates a passed feedback lesson's current sequence before acknowledging it", async () => {
    Object.assign(mock.tables.academy_assessment_attempts[0], { lessonId: 4, passed: true });
    await expect(caller().agent.acknowledgeAssessmentFeedback({ attemptId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoSideEffects();
  });

  it("keeps all learner and preview summaries active-only and read-only", async () => {
    const home = await caller().agent.home();
    expect(home.enrolments[0]).toMatchObject({ progress: { requiredLessons: 3, percentage: 33 }, nextLesson: { id: 3 } });
    const previewHome = await caller(admin).agent.previewHome();
    expect(previewHome.enrolments[0].progress.requiredLessons).toBe(3);
    const preview = await caller(admin).agent.previewCourse({ courseId: 1 });
    expect(flatten(preview).map(row => row.id)).toEqual([1, 3, 4]);
    const summary = await caller(admin).admin.agentSummary({ agentId: 10 });
    expect(summary.enrolments[0]).toMatchObject({ completion: { requiredLessons: 3, percentage: 33 }, nextLesson: { id: 3 }, assessment: { awaitingMarking: 0, feedbackPending: 0 }, activeTimeSeconds: 180, lastActivityAt: historicalAt });
    expect(summary.recentActivity).toHaveLength(1);
    expectNoSideEffects();
  });

  it.each([null, "videoTranscript", "assessmentMode"])("editor explicitly includes archived lessons and retains their archive marker (%s)", async missingColumn => {
    state.legacyColumn = missingColumn;
    const editor = await caller(admin).admin.editor({ courseId: 1 });
    expect(flatten(editor).map(row => row.id)).toEqual([1, 2, 3, 4, 5]);
    expect(flatten(editor).find(row => row.id === 2)).toMatchObject({ archivedAt, questions: [{ id: 20 }] });
    expect(mock.reads.filter(read => read.table === "academy_lessons").every(read => !read.sql?.includes("is null"))).toBe(true);
    expectNoSideEffects();
  });
});

describe("historical review and operational queues", () => {
  it.each([false, true])("preserves archived progress, acknowledgements, attempts, responses and audit even when all lessons are archived (%s)", async allArchived => {
    if (allArchived) mock.tables.academy_lessons.forEach(row => { row.archivedAt = archivedAt; });
    const review = await caller(admin).admin.learnerReview({ enrollmentId: 1 });
    expect(review.completion).toEqual({ requiredLessons: allArchived ? 0 : 3, completedRequiredLessons: allArchived ? 0 : 1, percentage: allArchived ? 0 : 33, isComplete: false });
    expect(review.currentRequiredLesson).toEqual(allArchived ? null : { id: 3, title: "Lesson 3" });
    expect(review.modules[0].completion).toEqual({ requiredLessons: allArchived ? 0 : 2, completedRequiredLessons: allArchived ? 0 : 1 });
    const hidden = flatten(review).find(row => row.id === 2);
    expect(hidden).toMatchObject({ archivedAt, progress: { acknowledgedAt: completedAt, lastViewedAt: historicalAt }, attempts: expect.arrayContaining([expect.objectContaining({ id: 1, status: "feedback_pending", graderFeedback: "Saved feedback", responses: [{ questionId: 20, prompt: "Question 20", questionType: "free_text", selectedAnswer: null, correctAnswer: null, responseText: "Preserved learner answer", score: 50, feedback: "Saved response feedback", gradedAt: historicalAt }] }), expect.objectContaining({ id: 4, feedbackAcknowledgedAt: historicalAt })]) });
    expect(flatten(review).find(row => row.id === 5)).toMatchObject({ archivedAt, attempts: [expect.objectContaining({ id: 3, status: "awaiting_marking" })] });
    expect(review.audit).toHaveLength(1);
    expectNoSideEffects();
  });

  it.each([
    { role: "admin", userId: 99 },
    { role: "super_admin", userId: 100 },
  ])("issues exact $role-bound document and original-template history links for archived awaiting-marking work, without returning it to queues", async ({ role, userId }) => {
    const user = { ...admin, id: userId, role };
    const historicalAttempt = mock.tables.academy_assessment_attempts.find(row => row.id === 3)!;
    Object.assign(historicalAttempt, {
      assessmentTemplateKey: "synthetic/original-template-at-submission",
      assessmentTemplateName: "original-history-template.pdf",
      assessmentTemplateMimeType: "application/pdf",
    });
    // The current lesson's template is deliberately different from the saved
    // attempt snapshot, which is the only authority for historical issuance.
    Object.assign(mock.tables.academy_lessons.find(row => row.id === 5)!, {
      assessmentTemplateName: "replacement-current-template.pdf",
    });
    const before = structuredClone(mock.tables);
    const review = await caller(user).admin.learnerReview({ enrollmentId: 1 });
    const history = review.modules.flatMap(module => module.lessons).find(row => row.id === 5)!;
    expect(history).toMatchObject({ archivedAt, attempts: [{
      id: 3, status: "awaiting_marking", submissionFileName: "history.pdf",
      assessmentTemplateName: "original-history-template.pdf",
      submissionDownloadUrl: syntheticHistoryUrl("submission", userId, 3),
      templateDownloadUrl: syntheticHistoryUrl("template", userId, 3),
    }] });
    expect(state.historyUrl.mock.calls).toEqual([
      [{ kind: "submission", scope: "staff", userId, enrollmentId: 1, lessonId: 5, attemptId: 3 }, academyOrigin],
      [{ kind: "template", scope: "staff", userId, enrollmentId: 1, lessonId: 5, attemptId: 3 }, academyOrigin],
    ]);
    expect(JSON.stringify(review)).not.toMatch(/submissionFileKey|assessmentTemplateKey|synthetic\/private-document|synthetic\/original-template-at-submission|synthetic\/template/);
    expect(await caller(user).admin.documentMarkingQueue()).toEqual([]);
    expect(await caller(user).admin.markingQueue()).toEqual([]);
    expect(state.historyUrl).toHaveBeenCalledTimes(2);
    expect(mock.tables).toEqual(before);
    expectNoSideEffects();
  });

  it.each([undefined, null, ""])("does not invent a history link when the respective original attempt key is absent (%s), even with filenames and a current lesson template", async missingKey => {
    Object.assign(mock.tables.academy_assessment_attempts.find(row => row.id === 3)!, {
      assessmentTemplateKey: missingKey,
      assessmentTemplateName: "missing-original-template.pdf",
    });
    mock.tables.academy_assessment_attempts.push({
      ...attempt(6, 5, "awaiting_marking"), submissionFileKey: missingKey,
      submissionFileName: "missing-submission.pdf",
      assessmentTemplateKey: "synthetic/original-only-template",
      assessmentTemplateName: "original-only-template.pdf",
    }, {
      ...attempt(7, 5, "awaiting_marking"), submissionFileKey: missingKey,
      submissionFileName: "missing-both-submission.pdf",
      assessmentTemplateKey: missingKey, assessmentTemplateName: "missing-both-template.pdf",
    });
    const before = structuredClone(mock.tables);
    const review = await caller(admin).admin.learnerReview({ enrollmentId: 1 });
    const history = review.modules.flatMap(module => module.lessons).find(row => row.id === 5)!;
    expect(history.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 3, submissionFileName: "history.pdf", assessmentTemplateName: "missing-original-template.pdf", submissionDownloadUrl: syntheticHistoryUrl("submission", 99, 3), templateDownloadUrl: null }),
      expect.objectContaining({ id: 6, submissionFileName: "missing-submission.pdf", assessmentTemplateName: "original-only-template.pdf", submissionDownloadUrl: null, templateDownloadUrl: syntheticHistoryUrl("template", 99, 6) }),
      expect.objectContaining({ id: 7, submissionDownloadUrl: null, templateDownloadUrl: null }),
    ]));
    expect(history.attempts).toHaveLength(3);
    expect(state.historyUrl.mock.calls).toEqual([
      [{ kind: "submission", scope: "staff", userId: 99, enrollmentId: 1, lessonId: 5, attemptId: 3 }, academyOrigin],
      [{ kind: "template", scope: "staff", userId: 99, enrollmentId: 1, lessonId: 5, attemptId: 6 }, academyOrigin],
    ]);
    expect(JSON.stringify(review)).not.toMatch(/submissionFileKey|assessmentTemplateKey|synthetic\/private-document|synthetic\/original-only-template|synthetic\/template/);
    expect(await caller(admin).admin.documentMarkingQueue()).toEqual([]);
    expect(mock.tables).toEqual(before);
    expectNoSideEffects();
  });

  it("keeps an administrator's own archived history readable but issues no self-bound evidence links", async () => {
    mock.tables.academy_enrollments[0].agentId = admin.id;
    Object.assign(mock.tables.academy_assessment_attempts.find(row => row.id === 3)!, {
      assessmentTemplateKey: "synthetic/self-original-template",
      assessmentTemplateName: "self-original-template.pdf",
    });
    const before = structuredClone(mock.tables);
    const review = await caller(admin).admin.learnerReview({ enrollmentId: 1 });
    expect(review.agent.id).toBe(admin.id);
    const history = review.modules.flatMap(module => module.lessons).find(row => row.id === 5)!;
    expect(history).toMatchObject({ archivedAt, attempts: [{
      id: 3, status: "awaiting_marking", submissionFileName: "history.pdf",
      assessmentTemplateName: "self-original-template.pdf",
      submissionDownloadUrl: null, templateDownloadUrl: null,
    }] });
    expect(state.historyUrl).not.toHaveBeenCalled();
    expect(JSON.stringify(review)).not.toMatch(/submissionFileKey|assessmentTemplateKey|synthetic\/self-original-template|synthetic\/private-document/);
    expect(mock.tables).toEqual(before);
    expectNoSideEffects();
  });

  it("insights filters active awaiting/feedback/support curriculum but retains historical activity and acknowledged totals", async () => {
    mock.tables.academy_assessment_attempts.push(attempt(10, 3, "awaiting_marking"));
    const insights = await caller(admin).admin.insights();
    expect(insights.metrics.assessments).toEqual({ awaitingMarking: 1, feedbackPending: 0, feedbackAcknowledged: 1, supportLocks: 0 });
    expect(insights.learners[0]).toMatchObject({ completion: { requiredLessons: 3 }, lastActivityAt: historicalAt, activeTimeSeconds: 180, assessment: { awaitingMarking: 1, feedbackPending: 0 } });
    expect(insights.curriculum.lessons.map(row => row.id).sort()).toEqual([1, 3, 4]);
    expect(insights.curriculum.questions.map(row => row.id)).toEqual([30]);
    expectNoSideEffects();
  });

  it("written, document and support queues exclude hidden work, including three failed attempts", async () => {
    mock.tables.academy_assessment_attempts.push(attempt(10, 3, "awaiting_marking"));
    mock.tables.academy_assessment_responses.push({ id: 10, attemptId: 10, questionId: 30, responseText: "Active answer", score: null });
    for (const id of [20, 21, 22]) {
      mock.tables.academy_assessment_attempts.push(attempt(id, 2, "auto_graded"));
      mock.tables.academy_assessment_responses.push({ id, attemptId: id, questionId: 20, score: 0 });
    }
    expect((await caller(admin).admin.markingQueue()).map(row => row.attempt.id)).toEqual([10]);
    expect(await caller(admin).admin.documentMarkingQueue()).toEqual([]);
    expect(await caller(admin).admin.supportQueue()).toEqual([]);
    const queueReads = mock.reads.filter(read => read.table === "academy_assessment_attempts" && read.projection?.lesson);
    expect(queueReads).toHaveLength(3);
    queueReads.forEach(read => expect(read.sql).toContain("`academy_lessons`.`archivedAt` is null"));
    expectNoSideEffects();
  });

  it.each(["markWrittenAssessment", "markDocumentAssessment", "generateAiMarkingReview"] as const)("blocks stale hidden %s before grades, AI, audit, feedback email or notifications", async operation => {
    const input = { attemptId: operation === "markDocumentAssessment" ? 3 : 2, score: 95, feedback: "Reviewed carefully", responses: [{ questionId: 20, score: 95, feedback: "Strong answer" }] };
    await expect((caller(admin).admin[operation] as any)(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expectNoSideEffects();
  });

  it("direct hidden support reset cannot reopen progress or send stale support mail", async () => {
    await expect(caller(admin).admin.resetQuestionAttempts({ enrollmentId: 1, lessonId: 2, questionId: 20, reason: "Synthetic support" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expectNoSideEffects();
  });

  it("all archived yields zero percent, never auto-completes, and leaves every historical date untouched", async () => {
    mock.tables.academy_lessons.forEach(row => { row.archivedAt = archivedAt; });
    const before = structuredClone(mock.tables);
    const course = await caller().agent.course({ enrollmentId: 1 });
    const home = await caller().agent.home();
    expect(flatten(course)).toEqual([]);
    expect(course.progress).toEqual({ requiredLessons: 0, completedRequiredLessons: 0, percentage: 0, isComplete: false });
    expect(home.enrolments[0].nextLesson).toBeNull();
    expect(mock.tables).toEqual(before);
    expectNoSideEffects();
  });

  it("an optional active lesson cannot complete an empty required pathway after all required lessons are archived", async () => {
    mock.tables.academy_lessons.forEach(row => { row.archivedAt = archivedAt; });
    Object.assign(mock.tables.academy_lessons[2], { archivedAt: null, isRequired: false });
    mock.tables.academy_lesson_progress.push({ id: 3, enrollmentId: 1, lessonId: 3, acknowledgedAt: completedAt });
    await expect(caller().agent.completeLesson({ enrollmentId: 1, lessonId: 3 })).resolves.toEqual({ success: true });
    expect(mock.tables.academy_enrollments[0]).toMatchObject({ status: "in_progress", completedAt: null });
    expect(mock.writes.every(write => write.table === "academy_lesson_progress")).toBe(true);
    expect(state.email).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled(); expect(state.alerts).not.toHaveBeenCalled();
    const course = await caller().agent.course({ enrollmentId: 1 });
    expect(course.progress).toEqual({ requiredLessons: 0, completedRequiredLessons: 0, percentage: 0, isComplete: false });
  });

  it("completion recalculation keeps a completed enrolment terminal after restored curriculum changes", async () => {
    Object.assign(mock.tables.academy_enrollments[0], { status: "completed", completedAt, completionOutcomeAppliedAt: completedAt });
    // Completing an active step must not reopen the enrolment or rewrite its
    // original dates, even with restored unfinished curriculum elsewhere.
    mock.tables.academy_lessons[4].archivedAt = null;
    mock.tables.academy_lesson_progress.push({ id: 3, enrollmentId: 1, lessonId: 3, acknowledgedAt: completedAt });
    const before = structuredClone(mock.tables.academy_enrollments[0]);
    await expect(caller().agent.completeLesson({ enrollmentId: 1, lessonId: 3 })).resolves.toEqual({ success: true });
    expect(mock.tables.academy_enrollments[0]).toEqual(before);
    expect(mock.writes.every(write => write.table === "academy_lesson_progress")).toBe(true);
    expect(state.email).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled();
  });

  it("a completed enrolment remains terminal when restored lessons are incomplete", async () => {
    Object.assign(mock.tables.academy_enrollments[0], { status: "completed", completedAt, completionOutcomeAppliedAt: completedAt });
    mock.tables.academy_lessons[1].archivedAt = null;
    const before = structuredClone(mock.tables);
    const course = await caller().agent.course({ enrollmentId: 1 });
    expect(course.enrollment).toMatchObject({ status: "completed", completedAt });
    expect(course.progress).toMatchObject({ requiredLessons: 4, completedRequiredLessons: 1, percentage: 25 });
    expect(mock.tables).toEqual(before);
    expectNoSideEffects();
  });
});

describe("admin-only archive delegation", () => {
  it.each(["admin", "super_admin"])("delegates archive and restore to the transaction service using the actual %s identity only", async role => {
    const user = { ...admin, role };
    const before = structuredClone(mock.tables);
    await expect(caller(user).admin.setLessonArchived({ lessonId: 2, archived: true })).resolves.toMatchObject({ success: true, lessonId: 2, archivedAt, changed: true });
    state.archive.mockResolvedValueOnce({ success: true, lessonId: 2, archivedAt: null, changed: true });
    await expect(caller(user).admin.setLessonArchived({ lessonId: 2, archived: false })).resolves.toEqual({ success: true, lessonId: 2, archivedAt: null, changed: true });
    expect(state.archive.mock.calls).toEqual([[{ lessonId: 2, archived: true, actorId: 99 }], [{ lessonId: 2, archived: false, actorId: 99 }]]);
    expect(mock.tables).toEqual(before); expect(mock.writes).toEqual([]);
    expect(state.email).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled(); expect(state.alerts).not.toHaveBeenCalled();
  });

  it.each(["instructor", "engagement", "agent"])("rejects %s archive calls without calling the service or reading/writing records", async capability => {
    if (capability !== "agent") mock.tables.staff_role_assignments.push({ id: 1, userId: 10, staffRole: capability === "engagement" ? "agent_engagement" : "instructor", isActive: true });
    if (capability === "instructor") mock.tables.staff_instructor_courses.push({ id: 1, assignmentId: 1, courseId: 1 });
    const permissions = await getStaffAccessSnapshot(learner);
    expect(permissions.instructor).toBe(capability === "instructor");
    expect(permissions.engagement).toBe(capability === "engagement");
    mock.reads.length = 0;
    await expect(caller().admin.setLessonArchived({ lessonId: 2, archived: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().admin.learnerReview({ enrollmentId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.historyUrl).not.toHaveBeenCalled();
    expect(mock.reads).toEqual([]); expectNoSideEffects();
  });

  it.each([{ lessonId: 0, archived: true }, { lessonId: -1, archived: true }, { lessonId: 1.5, archived: true }, { lessonId: 2, archived: "true" }])("validates archive payload %j before delegation", async input => {
    await expect(caller(admin).admin.setLessonArchived(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectNoSideEffects();
  });

  it("retains the delete evidence guard and directs administrators to archive instead", async () => {
    await expect(caller(admin).admin.deleteLesson({ lessonId: 2 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("Archive it instead") });
    expectNoSideEffects();
  });
});
