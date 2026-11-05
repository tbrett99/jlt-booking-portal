import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { academyMockDb } from "./academy-staff-test-db";

const state = vi.hoisted(() => ({ db: null as any, courseIds: [1] as number[], audit: vi.fn(), put: vi.fn(), encrypted: vi.fn(), decrypted: vi.fn(), notify: vi.fn(), email: vi.fn(), user: null as any }));
vi.mock("./db", () => ({ getDb: async () => state.db, getRawDbPool: vi.fn(() => { throw new Error("No real/raw database calls in mock tests"); }), createInAppNotification: (...args: any[]) => state.notify(...args), getUpcomingAgentEvents: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: (...args: any[]) => state.put(...args), storagePutEncrypted: (...args: any[]) => state.encrypted(...args), storageGetDecrypted: (...args: any[]) => state.decrypted(...args) }));
vi.mock("./email", () => ({ sendDirectEmail: (...args: any[]) => state.email(...args), sendSupportEmail: vi.fn() }));
vi.mock("./agent-development-router", () => ({ assignAcceleratorEntryActions: vi.fn(), releaseAvailableJourneyActions: vi.fn() }));
vi.mock("./academy-email-alerts", () => ({ ACADEMY_ALERT_EVENTS: ["course_assigned"], academyAlertAllowsModuleScope: vi.fn(), academyAlertTemplateHint: vi.fn(), dispatchAcademyEmailAlerts: vi.fn(), hasActiveAcademySupportAlert: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: async () => state.user } }));
vi.mock("./staff-access", () => ({
  isFullAdmin: (user: any) => ["admin", "super_admin"].includes(user.role),
  getInstructorCourseIds: async (user: any) => ["admin", "super_admin"].includes(user.role) ? null : state.courseIds,
  requireInstructorCourse: async (user: any, courseId: number) => {
    if (!["admin", "super_admin"].includes(user.role) && !state.courseIds.includes(courseId)) throw new TRPCError({ code: "FORBIDDEN" });
  },
  assertNotSelfReview: (user: any, learnerId: number) => { if (!["admin", "super_admin"].includes(user.role) && user.id === learnerId) throw new TRPCError({ code: "FORBIDDEN" }); },
  recordStaffOperation: async (...args: any[]) => { if (!["admin", "super_admin"].includes(args[0].role)) await state.audit(...args); },
}));
import { academyRouter } from "./academy-router";
import { assertAcademyLessonFiles } from "./academy-staff-access";
import { createAcademyDocumentDownloadUrl, registerAcademyDocumentDownloadRoutes } from "./academy-document-download-routes";

const agent = { id: 10, name: "Instructor", email: "staff@example.test", role: "agent", isActive: true, portalStatus: "active", mustChangePassword: false } as any;
const admin = { ...agent, id: 99, role: "admin" };
const caller = (user = agent) => academyRouter.createCaller({ user, req: {}, res: {} } as any).admin;
let mock: ReturnType<typeof academyMockDb>;
const attempt = (id: number, enrollmentId: number, lessonId: number) => ({ id, enrollmentId, lessonId, status: "awaiting_marking", takenAt: new Date(), answers: [{ confidentialSnapshot: true }], submissionFileKey: `private/${id}`, submissionFileName: "work.pdf", submissionMimeType: "application/pdf", assessmentTemplateKey: `template/${id}` });
const courseInput = { id: 1, title: "Updated teaching", summary: "Teaching", estimatedMinutes: 30, isCoreAcademy: true, isAcceleratorJourney: false };
const grade = { attemptId: 1, feedback: "Reviewed carefully", responses: [{ questionId: 1, score: 95, feedback: "Strong answer" }] };

beforeEach(() => {
  vi.clearAllMocks(); state.audit.mockReset(); state.audit.mockResolvedValue(undefined); state.courseIds = [1]; state.user = agent;
  process.env.JWT_SECRET = "test-only-document-secret"; process.env.S3_PUBLIC_URL = "https://objects.example.test";
  state.put.mockImplementation(async (key: string) => ({ key, url: `https://objects.example.test/${key}` }));
  state.encrypted.mockImplementation(async (key: string) => ({ key })); state.decrypted.mockResolvedValue(Buffer.from("private plaintext"));
  mock = academyMockDb({
    academy_courses: [{ id: 1, title: "Assigned", status: "published", isCoreAcademy: true, isAcceleratorJourney: false, coverImageUrl: null }, { id: 2, title: "Other", status: "published", isCoreAcademy: true, isAcceleratorJourney: false }],
    academy_modules: [{ id: 1, courseId: 1 }, { id: 2, courseId: 2 }, { id: 3, courseId: 1 }],
    academy_lessons: [{ id: 1, moduleId: 1, title: "Written", assessmentMode: "quiz", assessmentPassMark: 90, attachmentKey: "existing/resource", attachmentUrl: "https://existing.example/resource", contentHtml: "", assessmentTemplateKey: null }, { id: 2, moduleId: 2, title: "Other", assessmentMode: "document_upload" }, { id: 3, moduleId: 1, title: "Document", assessmentMode: "document_upload", assessmentPassMark: 90, assessmentTemplateKey: "template/3" }],
    academy_enrollments: [{ id: 1, courseId: 1, agentId: 20 }, { id: 2, courseId: 2, agentId: 20 }, { id: 3, courseId: 1, agentId: 10 }, { id: 4, courseId: 1, agentId: 20 }],
    academy_assessment_attempts: [attempt(1, 1, 1), attempt(2, 2, 2), attempt(3, 3, 1), attempt(4, 2, 1), attempt(5, 4, 3), attempt(6, 3, 3)],
    academy_questions: [{ id: 1, lessonId: 1, questionType: "free_text", prompt: "Explain the topic", explanation: "Teaching guide", maxWords: 250, answerOptions: [], correctAnswerIndex: 0, sortOrder: 0 }, { id: 2, lessonId: 2, questionType: "free_text" }],
    academy_assessment_responses: [{ id: 1, attemptId: 1, questionId: 1, responseText: "Learner response", score: null }],
    users: [{ id: 20, name: "Learner", email: "learner@example.test", passwordHash: "NEVER_EXPOSE", phone: "private", notes: "CRM_SECRET" }, { id: 10, name: "Instructor", email: "staff@example.test" }],
    academy_access: [{ id: 1, agentId: 10, status: "active" }], staff_academy_uploads: [], academy_audit_log: [], academy_assessment_question_resets: [], academy_lesson_progress: [],
  });
  state.db = mock.db;
});

describe("restricted instructor real Academy API handlers", () => {
  it("SQL-filters course and marking queries, excludes self and inconsistent parents, returns minimal identity", async () => {
    expect((await caller().courses()).map(c => c.id)).toEqual([1]);
    const written = await caller().markingQueue(); expect(written.map(row => row.attempt.id)).toEqual([1]);
    expect(written[0].agent).toEqual({ id: 20, name: "Learner", email: "learner@example.test" });
    expect(written[0].attempt).not.toHaveProperty("answers"); expect(written[0].attempt).not.toHaveProperty("submissionFileKey");
    expect(JSON.stringify(written)).not.toContain("NEVER_EXPOSE"); expect(JSON.stringify(written)).not.toContain("CRM_SECRET");
    const documents = await caller().documentMarkingQueue(); expect(documents.map(row => row.attempt.id)).toEqual([5]);
    expect(documents[0].submissionDownloadUrl).toContain("/api/academy/assessment-document/");
  });
  it("no grants means empty lists and forbidden direct editor lookup", async () => {
    state.courseIds = []; expect(await caller().courses()).toEqual([]); expect(await caller().markingQueue()).toEqual([]); expect(await caller().documentMarkingQueue()).toEqual([]);
    await expect(caller().editor({ courseId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mock.reads).toEqual([]);
  });
  it("out-of-scope editor and course save are rejected before content reads", async () => {
    await expect(caller().editor({ courseId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().saveCourse({ ...courseInput, id: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mock.reads).toEqual([]);
  });
  it("cannot create courses, change global flags, delete, publish, enrol or run AI", async () => {
    await expect(caller().saveCourse({ ...courseInput, id: undefined })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().saveCourse({ ...courseInput, isCoreAcademy: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().deleteModule({ moduleId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().deleteLesson({ lessonId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().setCourseStatus({ courseId: 1, status: "published" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().enroll({ courseId: 1, agentId: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().generateAiMarkingReview({ attemptId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mock.writes).toEqual([]);
  });
  it("updates the assigned existing course without resetting other global core flags", async () => {
    expect(await caller().saveCourse(courseInput)).toEqual({ id: 1 });
    expect(mock.tables.academy_courses[1].isCoreAcademy).toBe(true); expect(state.audit).toHaveBeenCalledWith(agent, "academy.course_update", expect.objectContaining({ courseId: 1 }));
    expect(mock.writes.find(write => write.table === "academy_courses")?.values).not.toHaveProperty("isCoreAcademy");
    expect(mock.writes.find(write => write.table === "academy_courses")?.values).not.toHaveProperty("isAcceleratorJourney");
  });
  it("assigned module/lesson/question edits and pass settings run normally under the actual agent identity", async () => {
    mock.tables.academy_lessons[0].assessmentTemplateName = null;
    mock.tables.academy_lessons[0].assessmentTemplateMimeType = null;
    expect(await caller().saveModule({ id: 1, courseId: 1, title: "Edited module" })).toEqual({ id: 1 });
    expect(await caller().saveLesson({ id: 1, moduleId: 1, title: "Edited lesson", requiresAssessment: true, assessmentPassMark: 85 })).toEqual({ id: 1 });
    expect(mock.tables.academy_lessons[0].assessmentPassMark).toBe(85);
    mock.tables.academy_assessment_attempts.length = 0;
    expect(await caller().replaceQuestions({ lessonId: 1, questions: [{ id: 1, questionType: "free_text", prompt: "Revised teaching question" }] })).toMatchObject({ success: true });
    expect(mock.tables.academy_questions.find(row => row.lessonId === 1).prompt).toBe("Revised teaching question");
    expect(state.audit).toHaveBeenCalledTimes(3); expect(mock.writes.filter(write => write.table === "academy_audit_log")).toHaveLength(3);
  });
  it("the real lesson mutation rejects a key substituted from another course before any write", async () => {
    mock.tables.staff_academy_uploads.push({ userId: 10, courseId: 2, kind: "attachment", objectKey: "borrowed/key" });
    await expect(caller().saveLesson({ id: 1, moduleId: 1, title: "Edited lesson", attachmentKey: "borrowed/key", attachmentUrl: "https://portal.thejltgroup.co.uk/api/academy/course-attachment/borrowed%2Fkey" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.writes).toEqual([]);
  });
  it("mixed-parent module and lesson IDs cannot borrow an authorized input parent", async () => {
    await expect(caller().saveModule({ id: 2, courseId: 1, title: "Mixed module" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().saveLesson({ id: 2, moduleId: 1, title: "Mixed lesson" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().saveLesson({ id: 1, moduleId: 3, title: "Moved lesson" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mock.writes).toEqual([]);
  });
  it("guards reorder and question inputs including all child IDs before writes", async () => {
    await expect(caller().reorderModules({ courseId: 2, moduleIds: [2] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().reorderModules({ courseId: 1, moduleIds: [1, 2] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().reorderLessons({ moduleId: 2, lessonIds: [2] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().replaceQuestions({ lessonId: 1, questions: [{ id: 2, prompt: "Mixed question", questionType: "free_text" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().replaceQuestions({ lessonId: 2, questions: [] })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mock.writes).toEqual([]);
  });
  it.each([2, 3, 4])("rejects written marking forbidden/self/inconsistent attempt %i before fetching work or notifying", async (attemptId) => {
    await expect(caller().markWrittenAssessment({ ...grade, attemptId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.reads).toHaveLength(1); expect(mock.reads[0].projection).not.toHaveProperty("attempt"); expect(mock.writes).toEqual([]); expect(state.notify).not.toHaveBeenCalled();
  });
  it.each([2, 6])("rejects document marking forbidden/self attempt %i", async (attemptId) => {
    await expect(caller().markDocumentAssessment({ attemptId, score: 95, feedback: "Reviewed" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mock.writes).toEqual([]); expect(state.notify).not.toHaveBeenCalled();
  });
  it("rejects wrong question IDs and duplicate submitted grades", async () => {
    await expect(caller().markWrittenAssessment({ ...grade, responses: [{ ...grade.responses[0], questionId: 2 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().markWrittenAssessment({ ...grade, responses: [grade.responses[0], grade.responses[0]] })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.writes).toEqual([]);
  });
  it("uses genuine written and document marking logic, actor identity, notifications and both awaited audits", async () => {
    expect(await caller().markWrittenAssessment(grade)).toEqual({ score: 95, passed: true, passMark: 90 });
    expect(mock.tables.academy_assessment_responses[0].gradedById).toBe(10); expect(mock.tables.academy_assessment_attempts[0].status).toBe("feedback_pending"); expect(state.notify).toHaveBeenCalled(); expect(state.email).toHaveBeenCalled();
    expect(await caller().markDocumentAssessment({ attemptId: 5, score: 92, feedback: "Reviewed document" })).toEqual({ score: 92, passed: true, passMark: 90 });
    expect(state.audit).toHaveBeenCalledTimes(2); expect(mock.writes.filter(write => write.table === "academy_audit_log")).toHaveLength(2);
  });
  it("an unavailable mandatory staff audit prevents marking writes and notifications", async () => {
    state.audit.mockRejectedValue(new Error("audit SQL private parameter")); await expect(caller().markDocumentAssessment({ attemptId: 5, score: 95, feedback: "Reviewed" })).rejects.toThrow("The Academy operation is temporarily unavailable"); expect(mock.writes).toEqual([]); expect(state.notify).not.toHaveBeenCalled();
  });
  it("restricted uploads require a course and current grant; admins keep optional-course compatibility", async () => {
    const upload = { fileName: "resource.txt", fileBase64: Buffer.from("teaching").toString("base64"), mimeType: "text/plain" as const };
    await expect(caller().uploadAttachment(upload)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().uploadAttachment({ ...upload, courseId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(state.encrypted).not.toHaveBeenCalled();
    const staffFile = await caller().uploadAttachment({ ...upload, courseId: 1 }); expect(staffFile.url).toContain("/api/academy/course-attachment/"); expect(state.encrypted).toHaveBeenCalledTimes(1);
    expect(mock.tables.staff_academy_uploads[0]).toMatchObject({ userId: 10, courseId: 1, objectKey: staffFile.key, kind: "attachment" });
    const adminFile = await caller(admin).uploadAttachment(upload); expect(adminFile.url).toContain("https://objects.example.test/"); expect(state.put).toHaveBeenCalledTimes(1);
    state.courseIds = []; await expect(caller().uploadAttachment({ ...upload, courseId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("document templates are encrypted and provenance audited by exact course", async () => {
    const result = await caller().uploadDocumentAssessmentTemplate({ courseId: 1, fileName: "template.pdf", fileBase64: Buffer.from("%PDF-1.7\nexample").toString("base64"), mimeType: "application/pdf" });
    expect(result).not.toHaveProperty("url"); expect(mock.tables.staff_academy_uploads[0]).toMatchObject({ userId: 10, courseId: 1, objectKey: result.key, kind: "document_template" }); expect(state.audit).toHaveBeenCalled();
  });
  it("course image upload verifies course, bytes and exact image provenance", async () => {
    const sharp = (await import("sharp")).default;
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    const image = { courseId: 1, fileName: "teaching.png", fileBase64: bytes.toString("base64"), mimeType: "image/png" as const };
    await expect(caller().uploadCourseImage({ ...image, courseId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().uploadCourseImage({ ...image, fileBase64: Buffer.from("not an image").toString("base64") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const result = await caller().uploadCourseImage(image); expect(mock.tables.staff_academy_uploads[0]).toMatchObject({ userId: 10, courseId: 1, objectKey: result.key, kind: "image" });
    await expect(assertAcademyLessonFiles(agent, 1, { contentHtml: `<p><img src="${result.url}"></p>` })).resolves.toBeUndefined();
    await expect(assertAcademyLessonFiles(agent, 2, { contentHtml: `<img src="${result.url}">` })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("unexpected restricted storage errors are generic; full admins retain prior error behavior", async () => {
    const upload = { fileName: "resource.txt", fileBase64: Buffer.from("content").toString("base64"), mimeType: "text/plain" as const };
    state.encrypted.mockRejectedValueOnce(new Error("secret object key provider credential"));
    await expect(caller().uploadAttachment({ ...upload, courseId: 1 })).rejects.toThrow("The Academy operation is temporarily unavailable");
    state.put.mockRejectedValueOnce(new Error("legacy admin error")); await expect(caller(admin).uploadAttachment(upload)).rejects.toThrow("legacy admin error");
  });
  it("save rejects foreign keys, borrowed uploads, forged URLs and unrelated images; preserves exact current files", async () => {
    const existing = mock.tables.academy_lessons[0];
    await expect(assertAcademyLessonFiles(agent, 1, { attachmentKey: "other/key", attachmentUrl: "https://objects.example.test/other/key" }, existing)).rejects.toMatchObject({ code: "FORBIDDEN" });
    mock.tables.staff_academy_uploads.push({ userId: 10, courseId: 2, kind: "document_template", objectKey: "other/template" });
    await expect(assertAcademyLessonFiles(agent, 1, { assessmentTemplateKey: "other/template" }, existing)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertAcademyLessonFiles(agent, 1, { attachmentKey: existing.attachmentKey, attachmentUrl: "https://other.example/bypass" }, existing)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertAcademyLessonFiles(agent, 1, { contentHtml: '<img src="https://objects.example.test/foreign-image">' }, existing)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertAcademyLessonFiles(agent, 1, { attachmentKey: existing.attachmentKey, attachmentUrl: existing.attachmentUrl }, existing)).resolves.toBeUndefined();
  });
  it("full admins still receive global courses, queue snapshots and existing self behavior", async () => {
    expect((await caller(admin).courses()).map(c => c.id)).toEqual([1, 2]);
    const rows = await caller(admin).markingQueue(); expect(rows.map(row => row.attempt.id)).toEqual([1, 3]); expect(rows[0].attempt).toHaveProperty("answers");
  });
});

describe("private Academy Express downloads reauthorize at request time", () => {
  async function download(payload: any) {
    const routes: Record<string, any> = {}; registerAcademyDocumentDownloadRoutes({ get: (path: string, handler: any) => { routes[path] = handler; } } as any);
    const url = createAcademyDocumentDownloadUrl({ scope: "staff", userId: 10, enrollmentId: 1, lessonId: 1, kind: "submission", attemptId: 1, ...payload }, "https://portal.example.test");
    const res: any = { headersSent: false, statusCode: 0, status(code: number) { this.statusCode = code; return this; }, end: vi.fn(), send: vi.fn(), set: vi.fn() };
    await routes["/api/academy/assessment-document/:token"]({ params: { token: url.split("/").pop() } }, res); return res;
  }
  it("current instructor grant authorizes other learner document; revoked grant blocks a still-valid token", async () => {
    expect((await download({ lessonId: 3, enrollmentId: 4, attemptId: 5 })).statusCode).toBe(200); expect(state.decrypted).toHaveBeenCalledWith("private/5");
    state.courseIds = []; state.decrypted.mockClear(); expect((await download({ lessonId: 3, enrollmentId: 4, attemptId: 5 })).statusCode).toBe(404); expect(state.decrypted).not.toHaveBeenCalled();
  });
  it("staff-token self-download and mixed-course parents cannot fetch plaintext", async () => {
    expect((await download({ lessonId: 3, enrollmentId: 3, attemptId: 6 })).statusCode).toBe(404);
    expect((await download({ lessonId: 3, enrollmentId: 2, attemptId: 5 })).statusCode).toBe(404); expect(state.decrypted).not.toHaveBeenCalled();
  });
  it("an instructor's own learner download continues without a current staff grant", async () => {
    state.courseIds = []; expect((await download({ scope: "agent", lessonId: 3, enrollmentId: 3, attemptId: 6 })).statusCode).toBe(200); expect(state.decrypted).toHaveBeenCalledWith("private/6");
  });
  it("token user binding and attempt enrollment/lesson associations are enforced", async () => {
    expect((await download({ userId: 11, lessonId: 3, enrollmentId: 4, attemptId: 5 })).statusCode).toBe(404);
    expect((await download({ lessonId: 3, enrollmentId: 4, attemptId: 6 })).statusCode).toBe(404); expect(state.decrypted).not.toHaveBeenCalled();
  });
  it("private attachment URL never bypasses revoked grants or scope; personal learner access remains independent", async () => {
    const routes: Record<string, any> = {}; registerAcademyDocumentDownloadRoutes({ get: (path: string, handler: any) => { routes[path] = handler; } } as any);
    mock.tables.staff_academy_uploads.push({ userId: 10, courseId: 1, kind: "attachment", objectKey: "private/attachment" }, { userId: 20, courseId: 2, kind: "attachment", objectKey: "other/attachment" });
    async function getAttachment(key: string) {
      const res: any = { headersSent: false, statusCode: 0, status(code: number) { this.statusCode = code; return this; }, end: vi.fn(), send: vi.fn(), set: vi.fn() };
      await routes["/api/academy/course-attachment/:objectKey"]({ params: { objectKey: key } }, res); return res;
    }
    expect((await getAttachment("private/attachment")).statusCode).toBe(200);
    expect((await getAttachment("other/attachment")).statusCode).toBe(404);
    state.courseIds = []; state.decrypted.mockClear(); expect((await getAttachment("private/attachment")).statusCode).toBe(404); expect(state.decrypted).not.toHaveBeenCalled();
    mock.tables.academy_lessons[0].attachmentKey = "private/attachment"; expect((await getAttachment("private/attachment")).statusCode).toBe(200);
  });
});

describe("reviewed Instructor content and scheduling boundaries", () => {
  it("stores parser-sanitized content while retaining only an authorised course image", async () => {
    Object.assign(mock.tables.academy_lessons[0], { assessmentTemplateName: null, assessmentTemplateMimeType: null });
    mock.tables.staff_academy_uploads.push({ userId: 10, courseId: 1, kind: "image", objectKey: "course/own.png" });
    await caller().saveLesson({ id: 1, moduleId: 1, title: "Safe lesson", contentHtml: '<h2>Heading</h2><p>Keep this.</p><a href="java&#x73;cript:INERT">Bad link</a><img src="https://objects.example.test/course/own.png" /onload="INERT">' });
    const stored = mock.tables.academy_lessons[0].contentHtml;
    expect(stored).toContain("<h2>Heading</h2>");
    expect(stored).toContain('src="https://objects.example.test/course/own.png"');
    expect(stored).not.toMatch(/onload|javascript|INERT/);
  });
  it("rejects an unauthorised image after parsing instead of trusting malformed attributes", async () => {
    Object.assign(mock.tables.academy_lessons[0], { assessmentTemplateName: null, assessmentTemplateMimeType: null });
    await expect(caller().saveLesson({ id: 1, moduleId: 1, title: "Unsafe image", contentHtml: '<img src="https://objects.example.test/other-course.png" /onload="INERT">' })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.writes).toEqual([]); expect(state.audit).not.toHaveBeenCalled();
  });
  it("rejects a change from week eight to immediate release on an assigned Accelerator course", async () => {
    mock.tables.academy_courses[0].isAcceleratorJourney = true;
    mock.tables.academy_modules[0].releaseWeek = 8;
    await expect(caller().saveModule({ id: 1, courseId: 1, title: "Edited title", releaseWeek: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.writes).toEqual([]); expect(state.audit).not.toHaveBeenCalled();
  });
  it("retains the stored release schedule when updating module content", async () => {
    mock.tables.academy_courses[0].isAcceleratorJourney = true;
    mock.tables.academy_modules[0].releaseWeek = 8;
    await expect(caller().saveModule({ id: 1, courseId: 1, title: "Edited title", releaseWeek: 8 })).resolves.toEqual({ id: 1 });
    expect(mock.tables.academy_modules[0].releaseWeek).toBe(8);
  });
  it("does not delegate a custom release week when creating a new module", async () => {
    mock.tables.academy_courses[0].isAcceleratorJourney = true;
    await expect(caller().saveModule({ courseId: 1, title: "New module", releaseWeek: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.writes).toEqual([]); expect(state.audit).not.toHaveBeenCalled();
  });
  it("allows the safe initial release-week default for a new module", async () => {
    mock.tables.academy_courses[0].isAcceleratorJourney = true;
    await caller().saveModule({ courseId: 1, title: "New module", releaseWeek: 0 });
    expect(mock.writes.find(write => write.table === "academy_modules")?.values.releaseWeek).toBe(0);
  });
  it("preserves the full Admin's release-schedule control", async () => {
    mock.tables.academy_courses[0].isAcceleratorJourney = true;
    mock.tables.academy_modules[0].releaseWeek = 8;
    await caller(admin).saveModule({ id: 1, courseId: 1, title: "Admin schedule", releaseWeek: 0 });
    expect(mock.tables.academy_modules[0].releaseWeek).toBe(0);
  });
});

describe("final parser and concurrent schedule regressions", () => {
  it("does not mistake src text inside alt/title for an approved existing image", async () => {
    Object.assign(mock.tables.academy_lessons[0], { assessmentTemplateName: null, assessmentTemplateMimeType: null,
      contentHtml: '<img src="https://objects.example.test/current.png">' });
    await expect(caller().saveLesson({ id: 1, moduleId: 1, title: "Alt spoof", contentHtml: `<img src="https://external.example.test/unapproved.png" alt="src='https://objects.example.test/current.png'" title="src='https://objects.example.test/current.png'">` })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.writes).toEqual([]); expect(state.audit).not.toHaveBeenCalled();
  });
  it("keeps an Admin's schedule change made after the Instructor check and before the content write", async () => {
    mock.tables.academy_courses[0].isAcceleratorJourney = true;
    mock.tables.academy_modules[0].releaseWeek = 0;
    state.audit.mockImplementationOnce(async () => { mock.tables.academy_modules[0].releaseWeek = 8; });
    await caller().saveModule({ id: 1, courseId: 1, title: "Content edit", releaseWeek: 0 });
    expect(mock.tables.academy_modules[0].releaseWeek).toBe(8);
    expect(mock.tables.academy_modules[0].title).toBe("Content edit");
    expect(mock.writes.find(write => write.table === "academy_modules")?.values).not.toHaveProperty("releaseWeek");
  });
});
