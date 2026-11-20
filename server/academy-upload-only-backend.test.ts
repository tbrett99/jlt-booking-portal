import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { academyMockDb } from "./academy-staff-test-db";

const state = vi.hoisted(() => ({
  db: null as any, grants: [] as number[], raw: vi.fn(), encrypted: vi.fn(), publicPut: vi.fn(),
  directEmail: vi.fn(), supportEmail: vi.fn(), alerts: vi.fn(), supportConfigured: vi.fn(),
  notify: vi.fn(), external: vi.fn(), operation: vi.fn(),
  authenticate: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: async () => state.db, getRawDbPool: async () => ({ execute: state.raw }), createInAppNotification: state.notify, getUpcomingAgentEvents: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: state.publicPut, storagePutEncrypted: state.encrypted, storageGetDecrypted: vi.fn() }));
vi.mock("./email", () => ({ sendDirectEmail: state.directEmail, sendSupportEmail: state.supportEmail }));
vi.mock("./agent-development-router", () => ({ assignAcceleratorEntryActions: vi.fn(), releaseAvailableJourneyActions: vi.fn() }));
vi.mock("./academy-email-alerts", () => ({ ACADEMY_ALERT_EVENTS: ["written_assessment_ready"], academyAlertAllowsModuleScope: vi.fn(), academyAlertTemplateHint: vi.fn(), dispatchAcademyEmailAlerts: state.alerts, hasActiveAcademySupportAlert: state.supportConfigured }));
vi.mock("./business-staff-access", () => ({ getBusinessStaffAuthority: async () => ({ managed: false }), assertBusinessStaffRouteAllowed: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: state.authenticate } }));
vi.mock("./staff-access", () => ({
  isFullAdmin: (user: any) => ["admin", "super_admin"].includes(user.role),
  getInstructorCourseIds: async (user: any) => ["admin", "super_admin"].includes(user.role) ? null : state.grants,
  requireInstructorCourse: async (user: any, courseId: number) => {
    if (!["admin", "super_admin"].includes(user.role) && !state.grants.includes(courseId)) throw new TRPCError({ code: "FORBIDDEN" });
  },
  assertNotSelfReview: (user: any, learnerId: number) => { if (user.id === learnerId) throw new TRPCError({ code: "FORBIDDEN" }); },
  recordStaffOperation: state.operation,
}));
import { academyRouter } from "./academy-router";
import { systemRouter } from "./_core/systemRouter";
import { academyAssessmentAttempts, academyLessons } from "../drizzle/schema";

const learner = { id: 10, role: "agent", name: "Offline learner", email: "learner@example.test", isActive: true, portalStatus: "active", mustChangePassword: false };
const admin = { ...learner, id: 99, role: "admin" };
const instructor = { ...learner, id: 90, name: "Offline instructor" };
const pdf = Buffer.from("%PDF-1.7\nOffline synthetic assessment\n%%EOF");
const templateKey = "academy/document-assessments/templates/90/33/synthetic-template.pdf";
const template = { assessmentTemplateKey: templateKey, assessmentTemplateName: "Template.pdf", assessmentTemplateMimeType: "application/pdf", assessmentTemplateSize: 100 };
const emptyTemplate = { assessmentTemplateKey: null, assessmentTemplateName: null, assessmentTemplateMimeType: null, assessmentTemplateSize: null };
const draft = (overrides: Record<string, any> = {}) => ({ moduleId: 22, title: "Upload-only assessment", requiresAssessment: true, assessmentMode: "document_upload" as const, ...overrides });
const submission = (overrides: Record<string, any> = {}) => ({ enrollmentId: 44, lessonId: 11, fileName: "Completed.pdf", fileBase64: pdf.toString("base64"), mimeType: "application/pdf" as const, ...overrides });
const caller = (user: any = admin) => academyRouter.createCaller({ user, req: {}, res: {} } as any);
let mock: ReturnType<typeof academyMockDb>;
const lesson = () => mock.tables.academy_lessons[0];
const historyTables = ["academy_enrollments", "academy_lesson_progress", "academy_assessment_attempts", "academy_assessment_responses", "academy_assessment_question_resets", "academy_questions"];
const history = () => structuredClone(Object.fromEntries(historyTables.map(name => [name, mock.tables[name]])));
const noSubmissionSideEffects = () => {
  expect(state.encrypted).not.toHaveBeenCalled(); expect(state.publicPut).not.toHaveBeenCalled();
  expect(state.raw).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]);
  expect(state.directEmail).not.toHaveBeenCalled(); expect(state.supportEmail).not.toHaveBeenCalled();
  expect(state.alerts).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled();
};
function evidence(kind: "progress" | "attempt" | "both" = "both") {
  const at = new Date("2026-01-01T00:00:00Z");
  if (kind !== "attempt") mock.tables.academy_lesson_progress.push({ id: 5, enrollmentId: 44, lessonId: 11, startedAt: at, acknowledgedAt: at, completedAt: at });
  if (kind !== "progress") {
    mock.tables.academy_assessment_attempts.push({ id: 6, enrollmentId: 44, lessonId: 11, status: "feedback_acknowledged", score: 95, passed: true, answers: [{ snapshot: "Original learner work" }], graderFeedback: "Original feedback", gradedAt: at, takenAt: at, feedbackAcknowledgedAt: at,
      assessmentTemplateKey: templateKey, assessmentTemplateName: "Template.pdf", assessmentTemplateMimeType: "application/pdf", submissionFileKey: "synthetic/historical-encrypted-submission.pdf", submissionFileName: "Original.pdf", submissionMimeType: "application/pdf", submissionFileSize: pdf.length });
    mock.tables.academy_assessment_responses.push({ id: 7, attemptId: 6, questionId: 8, responseText: "Original response", feedback: "Original response feedback", score: 95 });
    mock.tables.academy_assessment_question_resets.push({ id: 9, enrollmentId: 44, lessonId: 11, questionId: 8, reason: "Original reset", createdAt: at });
  }
}

beforeEach(() => {
  vi.clearAllMocks(); state.grants = [];
  vi.stubEnv("JWT_SECRET", "offline-upload-only-test-secret");
  state.authenticate.mockReset().mockResolvedValue(learner);
  state.external.mockImplementation(() => { throw new Error("Network prohibited in upload-only tests"); }); vi.stubGlobal("fetch", state.external);
  state.encrypted.mockReset().mockImplementation(async (key: string) => ({ key }));
  state.publicPut.mockReset().mockImplementation(() => { throw new Error("Public assessment storage prohibited"); });
  state.alerts.mockReset().mockResolvedValue(undefined); state.directEmail.mockReset().mockResolvedValue(undefined); state.supportEmail.mockReset().mockResolvedValue(undefined);
  state.supportConfigured.mockReset().mockResolvedValue(false);
  mock = academyMockDb({
    academy_courses: [{ id: 33, title: "Offline course", status: "published", isCoreAcademy: false, isAcceleratorJourney: false }],
    academy_modules: [{ id: 22, courseId: 33, title: "Module", releaseWeek: 0, sortOrder: 0 }],
    academy_lessons: [{ id: 11, moduleId: 22, title: "Document assessment", assessmentMode: "document_upload", requiresAssessment: true, requiresAcknowledgement: false, assessmentPassMark: 90, ...emptyTemplate, archivedAt: null, isRequired: true, sortOrder: 0, embedPdf: false }],
    academy_enrollments: [{ id: 44, agentId: 10, courseId: 33, status: "assigned", journeyStartedAt: new Date("2026-01-01") }],
    academy_access: [{ id: 55, agentId: 10, status: "active" }],
    academy_lesson_progress: [], academy_questions: [], academy_assessment_attempts: [], academy_assessment_responses: [], academy_assessment_question_resets: [],
    staff_academy_uploads: [{ id: 77, userId: 90, courseId: 33, objectKey: templateKey, kind: "document_template" }], academy_audit_log: [], users: [learner, admin, instructor], agent_crm_profiles: [], business_staff_memberships: [],
  }); state.db = mock.db;
  // Only these two native prepared statements may run. Assert placeholders,
  // explicit nulls (mysql2 rejects undefined), and persist synthetic rows only.
  state.raw.mockReset().mockImplementation(async (query: string, values: any[]) => {
    const table = query.trim().startsWith("INSERT INTO academy_lessons") ? academyLessons
      : query.trim().startsWith("INSERT INTO academy_assessment_attempts") ? academyAssessmentAttempts : null;
    if (!table) throw new Error("Unexpected raw SQL in upload-only offline suite");
    const columns = query.match(/\(([^)]+)\)/)![1].split(",").map(column => column.trim());
    expect((query.match(/\?/g) ?? []).length).toBe(values.length); expect(columns).toHaveLength(values.length); expect(values).not.toContain(undefined);
    const result = await mock.db.insert(table).values(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
    return [result];
  });
});
afterEach(() => { expect(state.external).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("optional template lesson saves through actual tRPC and prepared SQL", () => {
  it.each([admin, instructor])("saves a new upload-only assessment as admin or assigned instructor ($id)", async user => {
    state.grants = [33]; const saved = await caller(user).admin.saveLesson(draft());
    expect(saved.id).toBe(12); expect(mock.tables.academy_lessons[1]).toMatchObject({ requiresAssessment: true, assessmentMode: "document_upload", ...emptyTemplate });
    expect(state.raw).toHaveBeenCalledOnce(); expect(state.raw.mock.calls[0][1].slice(15, 19)).toEqual([null, null, null, null]);
  });
  it.each([emptyTemplate, { assessmentTemplateKey: "  ", assessmentTemplateName: "", assessmentTemplateMimeType: "", assessmentTemplateSize: "" }])("normalizes all-null/all-blank fields, never creating a dummy template", async fields => {
    await caller().admin.saveLesson(draft(fields)); expect(mock.tables.academy_lessons[1]).toMatchObject(emptyTemplate);
  });
  it.each([admin, instructor])("adds, updates and removes a template before evidence ($id)", async user => {
    state.grants = [33]; await caller(user).admin.saveLesson(draft({ id: 11, ...template })); expect(lesson()).toMatchObject(template);
    await caller(user).admin.saveLesson(draft({ id: 11, ...template, assessmentTemplateName: "Revised.pdf", assessmentTemplateSize: 101 }));
    expect(lesson().assessmentTemplateName).toBe("Revised.pdf");
    await caller(user).admin.saveLesson(draft({ id: 11, ...emptyTemplate })); expect(lesson()).toMatchObject(emptyTemplate);
    expect(mock.tables.academy_audit_log.at(-1).metadata).toEqual({ lessonId: 11, assessmentTemplateRemoved: true });
  });
  it.each([admin, instructor])("allows a normalized document-to-quiz switch before evidence ($id)", async user => {
    state.grants = [33]; Object.assign(lesson(), template);
    const before = history();
    await caller(user).admin.saveLesson(draft({ id: 11, assessmentMode: "quiz", ...emptyTemplate }));
    expect(lesson()).toMatchObject({ assessmentMode: "quiz", ...emptyTemplate });
    expect(history()).toEqual(before);
    expect(state.encrypted).not.toHaveBeenCalled();
  });
  it.each([admin, instructor])("allows same-mode removal after evidence without altering any historical work ($id)", async user => {
    state.grants = [33]; Object.assign(lesson(), template); evidence();
    const before = history(); const priorAudit = structuredClone(mock.tables.academy_audit_log);
    await caller(user).admin.saveLesson(draft({ id: 11, ...emptyTemplate }));
    expect(lesson()).toMatchObject(emptyTemplate); expect(history()).toEqual(before);
    expect(mock.tables.academy_audit_log.slice(0, priorAudit.length)).toEqual(priorAudit);
    expect(mock.writes.map(write => write.table)).toEqual(["academy_lessons", "academy_audit_log"]);
    expect(mock.tables.academy_audit_log.at(-1).metadata).toEqual({ learnerEvidencePresent: true, contentRevision: true, lessonId: 11, assessmentTemplateRemoved: true });
    expect(state.encrypted).not.toHaveBeenCalled(); expect(state.raw).not.toHaveBeenCalled();
  });
  it.each(["progress", "attempt"] as const)("permits template removal with only %s evidence", async kind => {
    Object.assign(lesson(), template); evidence(kind); const before = history();
    await caller().admin.saveLesson(draft({ id: 11 })); expect(lesson()).toMatchObject(emptyTemplate); expect(history()).toEqual(before);
  });
  it("preserves a retained template on content-only revisions after evidence", async () => {
    Object.assign(lesson(), template); evidence(); const before = history();
    await caller().admin.saveLesson(draft({ id: 11, ...template, contentHtml: "<p>Updated teaching</p>" }));
    expect(lesson()).toMatchObject(template); expect(history()).toEqual(before);
  });
  it.each(["replace-key", "replace-name", "replace-mime", "add-after-removal", "switch-mode"])("blocks %s after evidence, preserving snapshots and docs", async scenario => {
    Object.assign(lesson(), template); evidence(); let fields: Record<string, any> = { ...template };
    if (scenario === "replace-key") fields.assessmentTemplateKey = templateKey.replace("template", "replacement");
    if (scenario === "replace-name") fields.assessmentTemplateName = "Replacement.pdf";
    if (scenario === "replace-mime") fields = { ...template, assessmentTemplateKey: templateKey.replace(/pdf$/, "docx"), assessmentTemplateName: "Template.docx", assessmentTemplateMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    if (scenario === "add-after-removal") Object.assign(lesson(), emptyTemplate);
    if (scenario === "switch-mode") fields = { ...emptyTemplate, assessmentMode: "quiz" };
    const before = history();
    await expect(caller().admin.saveLesson(draft({ id: 11, ...fields }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("cannot be added or replaced") });
    expect(history()).toEqual(before); expect(mock.writes).toEqual([]);
  });
  it("does not treat a mode change plus clearing as authorized removal", async () => {
    evidence("progress"); lesson().assessmentMode = "quiz";
    await expect(caller().admin.saveLesson(draft({ id: 11 }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(mock.writes).toEqual([]);
  });
  it.each(["no-grant", "other-course", "other-user-upload", "wrong-kind", "wrong-upload-course", "wrong-parent"])("keeps instructor role/scope/file binding: %s", async scenario => {
    state.grants = scenario === "no-grant" ? [] : scenario === "other-course" ? [34] : [33];
    let fields: Record<string, any> = {};
    if (scenario.includes("upload") || scenario === "wrong-kind") fields = template;
    if (scenario === "other-user-upload") mock.tables.staff_academy_uploads[0].userId = 91;
    if (scenario === "wrong-kind") mock.tables.staff_academy_uploads[0].kind = "attachment";
    if (scenario === "wrong-upload-course") mock.tables.staff_academy_uploads[0].courseId = 34;
    if (scenario === "wrong-parent") { mock.tables.academy_modules.push({ id: 23, courseId: 33 }); fields = { id: 11, moduleId: 23 }; }
    await expect(caller(instructor).admin.saveLesson(draft(fields))).rejects.toMatchObject({ code: "FORBIDDEN" }); noSubmissionSideEffects();
  });
  it("still requires assessment to be enabled and rejects signed-out saves", async () => {
    await expect(caller().admin.saveLesson(draft({ requiresAssessment: false }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller(null).admin.saveLesson(draft())).rejects.toMatchObject({ code: "UNAUTHORIZED" }); noSubmissionSideEffects();
  });
});

const malformedTemplates = [
  { assessmentTemplateKey: templateKey }, { assessmentTemplateName: "Template.pdf" }, { assessmentTemplateMimeType: "application/pdf" }, { assessmentTemplateSize: 100 },
  ...Object.keys(emptyTemplate).map(field => ({ ...template, [field]: null })),
  { ...template, assessmentTemplateName: " " }, { ...template, assessmentTemplateSize: 0 }, { ...template, assessmentTemplateSize: -1 },
  { ...template, assessmentTemplateSize: 1.5 }, { ...template, assessmentTemplateSize: 10 * 1024 * 1024 + 1 },
  { ...template, assessmentTemplateMimeType: "text/plain" }, { ...template, assessmentTemplateName: "Mismatch.docx" },
  { ...template, assessmentTemplateKey: templateKey.replace(/pdf$/, "xlsx") },
];
describe("reject partial or inconsistent metadata without silently dropping it", () => {
  it.each(malformedTemplates)("rejects malformed new/update save: %j", async fields => {
    await expect(caller().admin.saveLesson(draft(fields))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().admin.saveLesson(draft({ id: 11, ...fields }))).rejects.toMatchObject({ code: "BAD_REQUEST" }); noSubmissionSideEffects();
  });
  it.each(malformedTemplates)("rejects malformed publication: %j", async fields => {
    Object.assign(lesson(), fields); mock.tables.academy_courses[0].status = "draft";
    await expect(caller().admin.setCourseStatus({ courseId: 33, status: "published" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mock.tables.academy_courses[0].status).toBe("draft"); noSubmissionSideEffects();
  });
  it.each(malformedTemplates)("rejects malformed submission before encrypted storage: %j", async fields => {
    Object.assign(lesson(), fields);
    await expect(caller(learner).agent.submitDocumentAssessment(submission())).rejects.toMatchObject({ code: "BAD_REQUEST" }); noSubmissionSideEffects();
  });
  it("does not silently discard malformed metadata when saving another mode", async () => {
    await expect(caller().admin.saveLesson(draft({ assessmentMode: "quiz", assessmentTemplateName: "Partial.pdf" }))).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.writes).toEqual([]);
  });
});

describe("publication and download remain optional-template aware", () => {
  it.each([emptyTemplate, template])("publishes document assessments with optional complete templates: %j", async fields => {
    Object.assign(lesson(), fields); mock.tables.academy_courses[0].status = "draft";
    await expect(caller().admin.setCourseStatus({ courseId: 33, status: "published" })).resolves.toEqual({ success: true }); expect(mock.tables.academy_courses[0].status).toBe("published");
  });
  it("keeps publication admin-only and knowledge checks question-bound", async () => {
    state.grants = [33]; await expect(caller(instructor).admin.setCourseStatus({ courseId: 33, status: "published" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    lesson().assessmentMode = "quiz";
    await expect(caller().admin.setCourseStatus({ courseId: 33, status: "published" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("at least one question") }); expect(mock.writes).toEqual([]);
  });
  it("returns NOT_FOUND on upload-only template downloads without touching storage", async () => {
    await expect(caller(learner).agent.getDocumentAssessmentTemplate({ enrollmentId: 44, lessonId: 11, origin: "https://portal.example.test" })).rejects.toMatchObject({ code: "NOT_FOUND" }); noSubmissionSideEffects();
  });
  it("retained template download still issues its guarded URL", async () => {
    Object.assign(lesson(), template);
    expect(await caller(learner).agent.getDocumentAssessmentTemplate({ enrollmentId: 44, lessonId: 11, origin: "https://portal.example.test" })).toMatchObject({ name: "Template.pdf", url: expect.stringContaining("/api/academy/assessment-document/") }); noSubmissionSideEffects();
  });
  it("advertises upload-only capability without altering live PDF/MC capabilities", async () => {
    expect(await systemRouter.createCaller({ user: null, req: {}, res: {} } as any).health({ timestamp: 0 })).toMatchObject({ academyUploadOnlyAssessment: 1, academyPdfLessonEmbed: 1, academyQuestionPasteToggle: 1, academyLiveQuestionWording: 1 });
  });
});

describe("encrypted upload-only submissions preserve queue, marking and feedback lifecycle", () => {
  it("submits without a download or dummy template; snapshots explicit SQL nulls", async () => {
    const result = await caller(learner).agent.submitDocumentAssessment(submission());
    expect(result).toEqual({ attemptId: 1, status: "awaiting_marking" });
    expect(state.encrypted).toHaveBeenCalledWith(expect.stringMatching(/^academy\/document-assessments\/submissions\/44\/11\//), pdf); expect(state.publicPut).not.toHaveBeenCalled();
    expect(state.raw.mock.calls[0][1].slice(6, 9)).toEqual([null, null, null]);
    expect(mock.tables.academy_assessment_attempts[0]).toMatchObject({ status: "awaiting_marking", score: null, passed: null, assessmentTemplateKey: null, assessmentTemplateName: null, assessmentTemplateMimeType: null, submissionFileName: "Completed.pdf", submissionFileSize: pdf.length });
    expect(state.supportEmail).toHaveBeenCalledOnce(); expect(state.alerts).toHaveBeenCalledWith(expect.objectContaining({ eventType: "written_assessment_ready", eventKey: "document-assessment-1" }));
    expect(mock.tables.academy_lesson_progress).toEqual([]);
  });
  it("normalizes absent/blank lesson template fields to SQL null snapshots", async () => {
    Object.assign(lesson(), { assessmentTemplateKey: undefined, assessmentTemplateName: "", assessmentTemplateMimeType: " ", assessmentTemplateSize: undefined });
    await caller(learner).agent.submitDocumentAssessment(submission()); expect(state.raw.mock.calls[0][1].slice(6, 9)).toEqual([null, null, null]);
  });
  it("snapshots retained templates and historical queue links survive lesson removal", async () => {
    Object.assign(lesson(), template); await caller(learner).agent.submitDocumentAssessment(submission());
    expect(state.raw.mock.calls[0][1].slice(6, 9)).toEqual([templateKey, "Template.pdf", "application/pdf"]);
    const before = history(); await caller().admin.saveLesson(draft({ id: 11 })); expect(history()).toEqual(before);
    const queue = await caller().admin.documentMarkingQueue(); expect(queue[0]).toMatchObject({ attempt: { assessmentTemplateName: "Template.pdf" }, templateDownloadUrl: expect.stringContaining("/api/academy/assessment-document/") });
  });
  it.each([admin, instructor])("keeps upload-only queue/marking/notifications/feedback-completion intact ($id)", async reviewer => {
    state.grants = [33]; state.supportConfigured.mockResolvedValue(true);
    const { attemptId } = await caller(learner).agent.submitDocumentAssessment(submission());
    expect(state.supportEmail).not.toHaveBeenCalled(); const queue = await caller(reviewer).admin.documentMarkingQueue();
    expect(queue).toHaveLength(1); expect(queue[0]).toMatchObject({ attempt: { id: attemptId, assessmentTemplateName: null }, templateDownloadUrl: null, submissionDownloadUrl: expect.stringContaining("/api/academy/assessment-document/") });
    await expect(caller(reviewer).admin.markDocumentAssessment({ attemptId, score: 95, feedback: "Well completed offline work" })).resolves.toMatchObject({ passed: true, score: 95 });
    expect(mock.tables.academy_assessment_attempts[0]).toMatchObject({ status: "feedback_pending", passed: true, graderFeedback: "Well completed offline work", assessmentTemplateKey: null });
    expect(mock.tables.academy_lesson_progress).toEqual([]); expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 10, isUrgent: true }));
    expect(state.directEmail).toHaveBeenCalledWith(expect.objectContaining({ userId: 10, triggerKey: "academy_document_assessment_feedback_ready" }));
    expect(await caller(learner).agent.acknowledgeAssessmentFeedback({ attemptId })).toMatchObject({ passed: true, score: 95 });
    expect(mock.tables.academy_assessment_attempts[0].status).toBe("feedback_acknowledged"); expect(mock.tables.academy_lesson_progress[0].completedAt).toBeInstanceOf(Date);
    expect(mock.tables.academy_enrollments[0].status).toBe("completed"); expect(state.alerts).toHaveBeenCalledWith(expect.objectContaining({ eventType: "course_completed" }));
  });
  it("unsuccessful marked feedback requires acknowledgement then permits resubmission while retaining original files", async () => {
    const { attemptId } = await caller(learner).agent.submitDocumentAssessment(submission());
    await caller().admin.markDocumentAssessment({ attemptId, score: 60, feedback: "Please revise this work" });
    await expect(caller(learner).agent.submitDocumentAssessment(submission())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller(learner).agent.acknowledgeAssessmentFeedback({ attemptId }); expect(mock.tables.academy_lesson_progress).toEqual([]);
    const original = structuredClone(mock.tables.academy_assessment_attempts[0]);
    await caller(learner).agent.submitDocumentAssessment(submission({ fileName: "Revised.pdf" }));
    expect(mock.tables.academy_assessment_attempts[0]).toEqual(original); expect(mock.tables.academy_assessment_attempts).toHaveLength(2);
  });
});

describe("upload-only assessments retain existing direct-call denial boundaries", () => {
  it.each(["signed-out", "revoked", "wrong-learner", "wrong-course-lesson", "archived", "unreleased", "prerequisite", "acknowledgement", "awaiting-marking", "feedback-pending", "quiz", "assessment-off"])("denies %s before file/storage/SQL/email writes", async scenario => {
    let user: any = learner;
    if (scenario === "signed-out") user = null;
    if (scenario === "revoked") mock.tables.academy_access[0].status = "revoked";
    if (scenario === "wrong-learner") mock.tables.academy_enrollments[0].agentId = 20;
    if (scenario === "wrong-course-lesson") lesson().moduleId = 23;
    if (scenario === "archived") lesson().archivedAt = new Date();
    if (scenario === "unreleased") { mock.tables.academy_courses[0].isAcceleratorJourney = true; mock.tables.academy_modules[0].releaseWeek = 8; mock.tables.academy_enrollments[0].journeyStartedAt = new Date("2099-01-01"); }
    if (scenario === "prerequisite") mock.tables.academy_lessons.unshift({ id: 9, moduleId: 22, title: "First required lesson", isRequired: true, archivedAt: null, sortOrder: -1 });
    if (scenario === "acknowledgement") lesson().requiresAcknowledgement = true;
    if (scenario === "awaiting-marking" || scenario === "feedback-pending") mock.tables.academy_assessment_attempts.push({ id: 1, enrollmentId: 44, lessonId: 11, status: scenario === "awaiting-marking" ? "awaiting_marking" : "feedback_pending" });
    if (scenario === "quiz") lesson().assessmentMode = "quiz";
    if (scenario === "assessment-off") lesson().requiresAssessment = false;
    await expect(caller(user).agent.submitDocumentAssessment(submission())).rejects.toBeInstanceOf(TRPCError); noSubmissionSideEffects();
  });
  it("acknowledged lessons still accept uploads", async () => {
    lesson().requiresAcknowledgement = true; mock.tables.academy_lesson_progress.push({ id: 5, enrollmentId: 44, lessonId: 11, acknowledgedAt: new Date() });
    await expect(caller(learner).agent.submitDocumentAssessment(submission())).resolves.toMatchObject({ status: "awaiting_marking" });
  });
  it("prior optional lesson feedback still gates later uploads", async () => {
    mock.tables.academy_lessons.unshift({ id: 9, moduleId: 22, title: "Prior optional lesson", isRequired: false, requiresAssessment: true, assessmentMode: "document_upload", archivedAt: null });
    mock.tables.academy_assessment_attempts.push({ id: 5, enrollmentId: 44, lessonId: 9, status: "feedback_pending", takenAt: new Date(), passed: false });
    await expect(caller(learner).agent.submitDocumentAssessment(submission())).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("acknowledge your assessment feedback") }); noSubmissionSideEffects();
  });
  it.each([
    { fileName: "Unsafe.exe" }, { fileName: "Mismatch.docx" }, { fileBase64: Buffer.from("Not PDF").toString("base64") }, { fileBase64: "!" },
    { mimeType: "text/plain" }, { fileBase64: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(10 * 1024 * 1024)]).toString("base64") },
    { fileName: "Mismatch.pdf", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileBase64: Buffer.from("PKsynthetic").toString("base64") },
  ])("rejects invalid or over-10MB document before encrypted storage ($fileName / $mimeType)", async fields => {
    await expect(caller(learner).agent.submitDocumentAssessment(submission(fields))).rejects.toMatchObject({ code: "BAD_REQUEST" }); noSubmissionSideEffects();
  });
  it.each(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"])("preserves recognized %s Office submissions", async mimeType => {
    const fileName = mimeType.includes("wordprocessingml") ? "Completed.docx" : "Completed.xlsx";
    await caller(learner).agent.submitDocumentAssessment(submission({ mimeType, fileName, fileBase64: Buffer.from("PKsynthetic-offline-office").toString("base64") }));
    expect(state.encrypted).toHaveBeenCalledOnce(); expect(mock.tables.academy_assessment_attempts[0].submissionMimeType).toBe(mimeType);
  });
  it("does not let upload-only learners submit documents through the quiz procedure", async () => {
    await expect(caller(learner).agent.submitAssessment({ enrollmentId: 44, lessonId: 11, responses: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" }); noSubmissionSideEffects();
  });
  it.each(["unassigned", "self-review", "archived", "already-marked"])("retains staff marking denials: %s", async scenario => {
    await caller(learner).agent.submitDocumentAssessment(submission()); vi.clearAllMocks(); mock.writes.length = 0;
    let user: any = instructor; state.grants = [33];
    if (scenario === "unassigned") state.grants = [];
    if (scenario === "self-review") user = learner;
    if (scenario === "archived") lesson().archivedAt = new Date();
    if (scenario === "already-marked") mock.tables.academy_assessment_attempts[0].status = "feedback_pending";
    await expect(caller(user).admin.markDocumentAssessment({ attemptId: 1, score: 95, feedback: "Synthetic marking" })).rejects.toBeInstanceOf(TRPCError); noSubmissionSideEffects();
  });
});
