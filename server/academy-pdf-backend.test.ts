import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Express, Request, Response } from "express";
import { academyMockDb } from "./academy-staff-test-db";

const state = vi.hoisted(() => ({ db: null as any, user: null as any, grants: [] as number[], managed: false, businessActive: true, businessAcademy: true,
  put: vi.fn(), encrypted: vi.fn(), decrypted: vi.fn(), raw: vi.fn(), authenticate: vi.fn(), requireCourse: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => state.db, getRawDbPool: async () => ({ execute: state.raw }), createInAppNotification: vi.fn(), getUpcomingAgentEvents: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: state.put, storagePutEncrypted: state.encrypted, storageGetDecrypted: state.decrypted }));
vi.mock("./email", () => ({ sendDirectEmail: vi.fn(), sendSupportEmail: vi.fn() }));
vi.mock("./agent-development-router", () => ({ assignAcceleratorEntryActions: vi.fn(), releaseAvailableJourneyActions: vi.fn() }));
vi.mock("./academy-email-alerts", () => ({ ACADEMY_ALERT_EVENTS: ["course_assigned"], academyAlertAllowsModuleScope: vi.fn(), academyAlertTemplateHint: vi.fn(), dispatchAcademyEmailAlerts: vi.fn(), hasActiveAcademySupportAlert: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: state.authenticate } }));
vi.mock("./business-staff-access", () => ({ getBusinessStaffAuthority: async () => ({ managed: state.managed, active: state.businessActive, membership: { permissions: { academyAccess: state.businessAcademy } } }), assertBusinessStaffRouteAllowed: vi.fn() }));
vi.mock("./staff-access", () => ({ isFullAdmin: (user: any) => ["admin", "super_admin"].includes(user.role), requireInstructorCourse: state.requireCourse,
  getInstructorCourseIds: async (user: any) => user.role === "admin" ? null : state.grants, assertNotSelfReview: vi.fn(), recordStaffOperation: vi.fn() }));
import { academyRouter } from "./academy-router";
import { academyPrivateAttachmentUrl } from "./academy-staff-access";
import { isCanonicalAcademyPdfAttachment, isMissingAcademyPdfColumn, registerAcademyDocumentDownloadRoutes, createAcademyDocumentDownloadUrl } from "./academy-document-download-routes";
import { systemRouter } from "./_core/systemRouter";

const key = "academy/90/12345678-abcd-abcd-abcd-123456789012-guide.pdf";
const publicUrl = `https://objects.example.test/${key}`;
const privateUrl = academyPrivateAttachmentUrl(key);
const pdf = Buffer.from("%PDF-1.7\nSynthetic offline PDF body\n%%EOF");
const learner = { id: 10, role: "agent", isActive: true, portalStatus: "active" };
const admin = { ...learner, id: 99, role: "admin" };
const instructor = { ...learner, id: 90 };
let mock: ReturnType<typeof academyMockDb>;
let routes: Record<string, (req: Request, res: Response) => any>;
const caller = (user: any = admin) => academyRouter.createCaller({ user, req: {}, res: {} } as any);
const draft = (extra: Record<string, any> = {}) => ({ id: 11, moduleId: 22, title: "Updated PDF teaching", attachmentKey: key, attachmentUrl: publicUrl, attachmentName: "Editable display title, not a file extension", ...extra });
function response() {
  return { statusCode: 0, headersSent: false, headers: {} as Record<string, string>, status(code: number) { this.statusCode = code; return this; },
    set(headers: Record<string, string>) { Object.assign(this.headers, headers); return this; }, end: vi.fn(), send: vi.fn() };
}
async function request(query: Record<string, any> = { view: "inline", lessonId: "11" }, objectKey = key) {
  const res = response();
  await routes["/api/academy/course-attachment/:objectKey"]({ params: { objectKey }, query } as unknown as Request, res as unknown as Response);
  return res;
}
async function denied(query?: Record<string, any>, objectKey?: string) {
  const res = await request(query, objectKey);
  expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled(); expect(state.decrypted).not.toHaveBeenCalled();
}
function historic() {
  return structuredClone(Object.fromEntries(["academy_enrollments", "academy_lesson_progress", "academy_assessment_attempts", "academy_assessment_responses", "academy_assessment_question_resets", "academy_questions"].map(name => [name, mock.tables[name]])));
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("S3_PUBLIC_URL", "https://objects.example.test"); vi.stubEnv("JWT_SECRET", "offline-pdf-only-test-secret");
  state.user = learner; state.grants = []; state.managed = false; state.businessActive = true; state.businessAcademy = true;
  state.authenticate.mockReset().mockImplementation(async () => state.user);
  state.requireCourse.mockReset().mockImplementation(async (user: any, courseId: number) => { if (!["admin", "super_admin"].includes(user.role) && !state.grants.includes(courseId)) throw new TRPCError({ code: "FORBIDDEN" }); });
  state.put.mockReset().mockImplementation(async (objectKey: string) => ({ key: objectKey, url: `https://objects.example.test/${objectKey}` }));
  state.encrypted.mockReset().mockImplementation(async (objectKey: string) => ({ key: objectKey }));
  state.decrypted.mockReset().mockResolvedValue(pdf);
  mock = academyMockDb({
    academy_courses: [{ id: 33, title: "Synthetic", status: "published", isAcceleratorJourney: false }],
    academy_modules: [{ id: 22, courseId: 33, title: "Module", releaseWeek: 0, sortOrder: 0 }],
    academy_lessons: [{ id: 11, moduleId: 22, title: "PDF", attachmentKey: key, attachmentUrl: privateUrl, attachmentName: "Guide.pdf", embedPdf: true, archivedAt: null, assessmentMode: "quiz", assessmentTemplateKey: null, assessmentTemplateName: null, assessmentTemplateMimeType: null, assessmentTemplateSize: null, isRequired: true, sortOrder: 0 }],
    academy_enrollments: [{ id: 44, agentId: 10, courseId: 33, status: "assigned", journeyStartedAt: new Date("2026-01-01T00:00:00Z") }],
    academy_access: [{ id: 55, agentId: 10, status: "active" }],
    academy_lesson_progress: [], academy_questions: [], academy_assessment_attempts: [], academy_assessment_responses: [], academy_assessment_question_resets: [],
    staff_academy_uploads: [{ id: 77, userId: 90, courseId: 33, objectKey: key, kind: "attachment" }], academy_audit_log: [],
  }); state.db = mock.db;
  // Native insert is a strict offline mock and records the actual SQL values.
  state.raw.mockReset().mockImplementation(async (query: string, values: any[]) => {
    if (!query.trim().startsWith("INSERT INTO academy_lessons")) throw new Error("Unexpected raw SQL in offline suite");
    const columns = query.match(/\(([^)]+)\)/)![1].split(",").map(item => item.trim());
    expect((query.match(/\?/g) ?? []).length).toBe(values.length); expect(columns.length).toBe(values.length);
    await mock.db.insert((await import("../drizzle/schema")).academyLessons).values(Object.fromEntries(columns.map((column, i) => [column, values[i]])));
    return [{ insertId: 12 }];
  });
  mock.db.session.client.execute = state.raw;
  routes = {}; registerAcademyDocumentDownloadRoutes({ get(path: string, handler: any) { routes[path] = handler; } } as unknown as Express);
});
afterEach(() => vi.unstubAllEnvs());

describe("PDF lesson setting through actual tRPC handlers", () => {
  it("defaults false on new lessons, including native SQL, and leaves old flags absent as false", async () => {
    await caller().admin.saveLesson(draft({ id: undefined }));
    expect(mock.tables.academy_lessons[1].embedPdf).toBe(false);
    expect(state.raw).toHaveBeenCalledWith(expect.stringContaining("embedPdf"), expect.any(Array));
    mock.tables.academy_lessons[0].embedPdf = undefined;
    await caller().admin.saveLesson(draft()); expect(mock.tables.academy_lessons[0].embedPdf).toBe(false);
  });
  it("new enabled lessons store true and canonical configured public URLs are accepted", async () => {
    await caller().admin.saveLesson(draft({ id: undefined, embedPdf: true })); expect(mock.tables.academy_lessons[1].embedPdf).toBe(true);
    expect(isCanonicalAcademyPdfAttachment({ attachmentUrl: publicUrl, attachmentKey: key })).toBe(true);
  });
  it("preserves existing opt-in when omitted on the same file; toggles false/true explicitly", async () => {
    await caller().admin.saveLesson(draft({ attachmentUrl: privateUrl })); expect(mock.tables.academy_lessons[0].embedPdf).toBe(true);
    await caller().admin.saveLesson(draft({ attachmentUrl: privateUrl, embedPdf: false })); expect(mock.tables.academy_lessons[0].embedPdf).toBe(false);
    await caller().admin.saveLesson(draft({ attachmentUrl: privateUrl, embedPdf: true })); expect(mock.tables.academy_lessons[0].embedPdf).toBe(true);
  });
  it.each([{ attachmentKey: "", attachmentUrl: "" }, { attachmentKey: "academy/90/replacement.txt", attachmentUrl: "https://objects.example.test/academy/90/replacement.txt" }, { attachmentKey: key, attachmentUrl: publicUrl }])("legacy removal/replacement resets omitted opt-in", async change => {
    await caller().admin.saveLesson(draft(change)); expect(mock.tables.academy_lessons[0].embedPdf).toBe(false);
  });
  it("does not use an editable filename as PDF evidence", async () => {
    await caller().admin.saveLesson(draft({ embedPdf: true, attachmentName: "Title without extension" })); expect(mock.tables.academy_lessons[0].embedPdf).toBe(true);
    await expect(caller().admin.saveLesson(draft({ embedPdf: true, attachmentKey: key.replace(/pdf$/, "txt"), attachmentUrl: publicUrl.replace(/pdf$/, "txt"), attachmentName: "Forged.pdf" }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it.each(["https://evil.example.test/" + key, "data:application/pdf;base64,JVBERi0=", "javascript:alert(1)", publicUrl + "?token=1", publicUrl + "#view", "https://user:pass@objects.example.test/" + key, publicUrl.replace("guide.pdf", "other.pdf")])("rejects enabled arbitrary/noncanonical URL %s before writes", async attachmentUrl => {
    await expect(caller().admin.saveLesson(draft({ embedPdf: true, attachmentUrl }))).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.writes).toEqual([]);
  });
  it.each(["academy/document-assessments/templates/90/template.pdf", "academy/document-assessments/submissions/10/work.pdf", "staff-handbook/90/guide.pdf", "academy/90/plain.pdf", key + "/../guide.pdf"])("rejects non-teaching upload key %s", async attachmentKey => {
    await expect(caller().admin.saveLesson(draft({ embedPdf: true, attachmentKey, attachmentUrl: `https://objects.example.test/${attachmentKey}` }))).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.writes).toEqual([]);
  });
  it.each(["document_template", "image", "wrong-course", "missing-private"])("requires private same-course attachment registry, not %s", async scenario => {
    if (scenario === "missing-private") mock.tables.staff_academy_uploads = [];
    else if (scenario === "wrong-course") mock.tables.staff_academy_uploads[0].courseId = 34;
    else mock.tables.staff_academy_uploads[0].kind = scenario;
    await expect(caller().admin.saveLesson(draft({ embedPdf: true, attachmentUrl: privateUrl }))).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.writes).toEqual([]);
  });
  it("keeps instructor file ownership binding when setting a PDF embed", async () => {
    state.grants = [33]; await caller(instructor).admin.saveLesson(draft({ embedPdf: true, attachmentUrl: privateUrl }));
    const otherKey = key.replace("guide", "other"); mock.tables.staff_academy_uploads.push({ id: 78, userId: 91, courseId: 33, objectKey: otherKey, kind: "attachment" });
    await expect(caller(instructor).admin.saveLesson(draft({ embedPdf: true, attachmentKey: otherKey, attachmentUrl: academyPrivateAttachmentUrl(otherKey) }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("toggling PDF display on an evidenced document lesson does not rewrite historical results or assessment snapshots", async () => {
    Object.assign(mock.tables.academy_lessons[0], { requiresAssessment: true, assessmentMode: "document_upload", assessmentTemplateKey: "academy/document-assessments/templates/90/template.pdf", assessmentTemplateName: "Template.pdf", assessmentTemplateMimeType: "application/pdf", assessmentTemplateSize: 100 });
    mock.tables.academy_lesson_progress.push({ id: 5, enrollmentId: 44, lessonId: 11, completedAt: new Date("2026-01-02") });
    mock.tables.academy_assessment_attempts.push({ id: 6, enrollmentId: 44, lessonId: 11, status: "feedback_acknowledged", score: 95, passed: true, assessmentTemplateKey: "historic", submissionFileKey: "historic-submission", answers: [{ snapshot: "preserve" }] });
    mock.tables.academy_assessment_responses.push({ id: 7, attemptId: 6, questionId: 8, score: 95, responseText: "preserve" });
    const before = historic();
    const assessment = { requiresAssessment: true, assessmentMode: "document_upload", assessmentTemplateKey: mock.tables.academy_lessons[0].assessmentTemplateKey, assessmentTemplateName: "Template.pdf", assessmentTemplateMimeType: "application/pdf", assessmentTemplateSize: 100 };
    await caller().admin.saveLesson(draft({ ...assessment, embedPdf: false, attachmentUrl: privateUrl }));
    await caller().admin.saveLesson(draft({ ...assessment, embedPdf: true, attachmentUrl: privateUrl }));
    expect(historic()).toEqual(before); expect(mock.writes.map(item => item.table)).toEqual(["academy_lessons", "academy_audit_log", "academy_lessons", "academy_audit_log"]);
  });
  it("fails clearly on absent PDF column rather than retrying a write without the flag", async () => {
    const err = { code: "ER_BAD_FIELD_ERROR", message: "Unknown column 'embedPdf' in 'field list'" };
    state.raw.mockRejectedValue(err);
    await expect(caller().admin.saveLesson(draft({ id: undefined, embedPdf: true }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PDF lesson database update") });
    expect(state.raw).toHaveBeenCalledTimes(1); expect(mock.writes).toEqual([]);
    expect(isMissingAcademyPdfColumn({ message: "Failed query select embedPdf, videoTranscript", cause: { message: "Unknown column 'videoTranscript' in 'field list'" } })).toBe(false);
    expect(isMissingAcademyPdfColumn({ cause: err })).toBe(true);
  });
  it("a missing-column update fails once rather than silently dropping the setting", async () => {
    mock.db.update = vi.fn(() => ({ set: () => ({ where: async () => { throw { code: "ER_BAD_FIELD_ERROR", message: "Unknown column 'embedPdf' in 'field list'" }; } }) }));
    await expect(caller().admin.saveLesson(draft({ embedPdf: true }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mock.db.update).toHaveBeenCalledOnce(); expect(mock.writes).toEqual([]);
  });
  it("a missing-column lesson read produces a clear migration error instead of a false DTO", async () => {
    const select = mock.db.select;
    mock.db.select = (projection: any) => {
      const query = select(projection); const from = query.from;
      query.from = (table: any) => {
        if (table === (projection?.lesson ?? table) && table.embedPdf && !projection) throw { message: "Unknown column 'academy_lessons.embedPdf' in 'field list'" };
        return from(table);
      }; return query;
    };
    await expect(caller().agent.previewCourse({ courseId: 33 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PDF lesson database update") });
    expect(mock.writes).toEqual([]);
  });
  it("returns normalized false and no file on locked learner lessons, normalized flag in preview", async () => {
    mock.tables.academy_lessons.unshift({ id: 9, moduleId: 22, title: "Complete first", isRequired: true, archivedAt: null, embedPdf: undefined, sortOrder: -1 });
    const dto = await caller(learner).agent.course({ enrollmentId: 44 });
    const locked = dto.modules[0].lessons.find(item => item.id === 11)!;
    expect(locked).toMatchObject({ locked: true, embedPdf: false, attachmentUrl: null, attachmentKey: null, attachmentName: null });
    const preview = await caller().agent.previewCourse({ courseId: 33 });
    expect(preview.modules[0].lessons.find(item => item.id === 11)!.embedPdf).toBe(true);
    expect(preview.modules[0].lessons.find(item => item.id === 9)!.embedPdf).toBe(false);
  });
  it("advertises the additive PDF health capability", async () => {
    expect(await systemRouter.createCaller({ user: null, req: {}, res: {} } as any).health({ timestamp: 0 })).toMatchObject({ academyPdfLessonEmbed: 1 });
  });
});

describe("ordinary PDF uploads validate before storage without migrating objects", () => {
  it.each([
    ["bad.pdf", "application/pdf", Buffer.from("<html>not PDF")],
    ["bad.txt", "application/pdf", pdf],
    ["bad.pdf", "text/plain", pdf],
    ["bad.pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf],
  ])("rejects MIME/name/signature mismatch %s / %s", async (fileName, mimeType, bytes) => {
    await expect(caller().admin.uploadAttachment({ fileName: String(fileName), mimeType: mimeType as any, fileBase64: (bytes as Buffer).toString("base64") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.put).not.toHaveBeenCalled(); expect(state.encrypted).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]);
  });
  it("keeps admin PDF uploads public and instructor PDFs encrypted with attachment-only registry", async () => {
    const uploaded = await caller().admin.uploadAttachment({ fileName: "Guide.pdf", mimeType: "application/pdf", fileBase64: pdf.toString("base64") });
    expect(uploaded.url).toBe(`https://objects.example.test/${uploaded.key}`); expect(state.put).toHaveBeenCalledWith(uploaded.key, pdf, "application/pdf"); expect(state.encrypted).not.toHaveBeenCalled();
    state.grants = [33]; const privateUpload = await caller(instructor).admin.uploadAttachment({ courseId: 33, fileName: "Guide.pdf", mimeType: "application/pdf", fileBase64: pdf.toString("base64") });
    expect(privateUpload.url).toBe(academyPrivateAttachmentUrl(privateUpload.key)); expect(state.encrypted).toHaveBeenCalledWith(privateUpload.key, pdf);
    expect(mock.tables.staff_academy_uploads.at(-1)).toMatchObject({ userId: 90, courseId: 33, kind: "attachment", objectKey: privateUpload.key });
  });
  it.each([
    ["guide.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "PK-office"],
    ["guide.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK-office"],
    ["guide.txt", "text/plain", "text"], ["guide.csv", "text/csv", "a,b\n1,2"],
  ])("preserves ordinary %s upload behavior", async (fileName, mimeType, bytes) => {
    await caller().admin.uploadAttachment({ fileName, mimeType: mimeType as any, fileBase64: Buffer.from(bytes).toString("base64") }); expect(state.put).toHaveBeenCalledOnce();
  });
});

describe("registered HTTP private native PDF viewing", () => {
  it.each(["assigned", "in_progress", "completed"])("serves enabled PDF to own %s learner with native inline/security headers", async status => {
    mock.tables.academy_enrollments[0].status = status;
    const before = historic(); const res = await request();
    expect(res.statusCode).toBe(200); expect(res.send).toHaveBeenCalledWith(pdf); expect(res.headers).toMatchObject({ "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Guide.pdf"', "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "frame-ancestors 'self'", "X-Frame-Options": "SAMEORIGIN" });
    expect(state.authenticate).toHaveBeenCalledTimes(2); expect(historic()).toEqual(before); expect(mock.writes).toEqual([]);
  });
  it("ordinary download remains attachment even when the lesson is enabled", async () => {
    const res = await request({}); expect(res.statusCode).toBe(200); expect(res.headers).toMatchObject({ "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="Guide.pdf"' });
  });
  it.each([undefined, "0", "11abc", ["11"], "9007199254740992", "99"])("denies absent or wrong lesson binding %s", async lessonId => { await denied({ view: "inline", lessonId }); });
  it.each(["flag-off", "archived", "wrong-key", "bad-url", "public-url", "wrong-kind", "missing-registry", "nonPDF", "wrong-course", "draft", "revoked", "other-user", "waived", "missing-enrolment", "inactive", "paused", "suspended", "signed-out"])("denies %s before storage", async scenario => {
    const lesson = mock.tables.academy_lessons[0];
    if (scenario === "flag-off") lesson.embedPdf = false;
    if (scenario === "archived") lesson.archivedAt = new Date();
    if (scenario === "wrong-key") lesson.attachmentKey = key.replace("guide", "other");
    if (scenario === "bad-url") lesson.attachmentUrl = `https://evil.example.test/${key}`;
    if (scenario === "public-url") lesson.attachmentUrl = publicUrl;
    if (scenario === "wrong-kind") mock.tables.staff_academy_uploads[0].kind = "document_template";
    if (scenario === "missing-registry") mock.tables.staff_academy_uploads = [];
    if (scenario === "nonPDF") { lesson.attachmentKey = key.replace(/pdf$/, "txt"); lesson.attachmentUrl = academyPrivateAttachmentUrl(lesson.attachmentKey); }
    if (scenario === "wrong-course") mock.tables.staff_academy_uploads[0].courseId = 34;
    if (scenario === "draft") mock.tables.academy_courses[0].status = "draft";
    if (scenario === "revoked") mock.tables.academy_access[0].status = "revoked";
    if (scenario === "other-user") mock.tables.academy_enrollments[0].agentId = 20;
    if (scenario === "waived") mock.tables.academy_enrollments[0].status = "waived";
    if (scenario === "missing-enrolment") mock.tables.academy_enrollments = [];
    if (scenario === "inactive") state.user = { ...learner, isActive: false };
    if (["paused", "suspended"].includes(scenario)) state.user = { ...learner, portalStatus: scenario };
    if (scenario === "signed-out") state.user = null;
    await denied();
  });
  it("denies upcoming release and unfinished prerequisite, but permits completed revisit", async () => {
    mock.tables.academy_courses[0].isAcceleratorJourney = true; mock.tables.academy_modules[0].releaseWeek = 8;
    mock.tables.academy_enrollments[0].journeyStartedAt = new Date("2099-01-01"); await denied();
    mock.tables.academy_courses[0].isAcceleratorJourney = false;
    mock.tables.academy_lessons.unshift({ id: 9, moduleId: 22, title: "First", isRequired: true, archivedAt: null }); await denied();
    mock.tables.academy_lesson_progress.push({ id: 1, enrollmentId: 44, lessonId: 11, completedAt: new Date() }); expect((await request()).statusCode).toBe(200);
  });
  it.each([admin, instructor])("allows assigned instructor/admin draft preview with no learner enrolment", async user => {
    state.user = user; state.grants = [33]; mock.tables.academy_enrollments = []; mock.tables.academy_courses[0].status = "draft";
    expect((await request()).statusCode).toBe(200); expect(state.requireCourse).toHaveBeenCalledTimes(2);
  });
  it("personal instructor flag/unrelated grants do not permit draft or archived viewing", async () => {
    state.user = { ...learner, isInstructor: true }; state.grants = [34]; mock.tables.academy_courses[0].status = "draft"; await denied();
  });
  it.each(["academy-denied", "membership-revoked", "own-learning", "not-enrolled"])("enforces fresh business-staff grant %s", async scenario => {
    state.managed = true; state.grants = [33];
    if (scenario === "academy-denied") state.businessAcademy = false;
    if (scenario === "membership-revoked") state.businessActive = false;
    if (scenario === "not-enrolled") mock.tables.academy_enrollments = [];
    if (scenario === "own-learning") expect((await request()).statusCode).toBe(200); else await denied();
  });
  it.each(["archive", "revoke", "replace", "disable", "user-inactive", "identity-change", "business-revoke", "instructor-revoke", "release-change", "prerequisite-change", "course-unpublish", "registry-kind"])("rechecks %s after storage and never emits the body", async scenario => {
    if (scenario === "instructor-revoke") { state.user = instructor; state.grants = [33]; mock.tables.academy_enrollments = []; }
    if (scenario === "business-revoke") state.managed = true;
    state.decrypted.mockImplementation(async () => {
      if (scenario === "archive") mock.tables.academy_lessons[0].archivedAt = new Date();
      if (scenario === "revoke") mock.tables.academy_access[0].status = "revoked";
      if (scenario === "replace") mock.tables.academy_lessons[0].attachmentKey = key.replace("guide", "new");
      if (scenario === "disable") mock.tables.academy_lessons[0].embedPdf = false;
      if (scenario === "user-inactive") state.user = { ...learner, isActive: false };
      if (scenario === "identity-change") state.user = admin;
      if (scenario === "business-revoke") state.businessAcademy = false;
      if (scenario === "instructor-revoke") state.grants = [];
      if (scenario === "release-change") { mock.tables.academy_courses[0].isAcceleratorJourney = true; mock.tables.academy_modules[0].releaseWeek = 8; mock.tables.academy_enrollments[0].journeyStartedAt = new Date("2099-01-01"); }
      if (scenario === "prerequisite-change") mock.tables.academy_lessons.unshift({ id: 9, moduleId: 22, title: "New prerequisite", isRequired: true, archivedAt: null });
      if (scenario === "course-unpublish") mock.tables.academy_courses[0].status = "draft";
      if (scenario === "registry-kind") mock.tables.staff_academy_uploads[0].kind = "document_template";
      return pdf;
    });
    const res = await request(); expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled(); expect(state.decrypted).toHaveBeenCalledOnce();
  });
  it.each(["html", "plain-private", "storage-error"])("denies %s body without generic HTML or public-object fallback", async scenario => {
    if (scenario === "storage-error") state.decrypted.mockRejectedValue(new Error("not a recognised private Portal document"));
    else state.decrypted.mockResolvedValue(Buffer.from(scenario === "html" ? "<html>not PDF</html>" : "JLT-A1-not-decrypted"));
    const res = await request(); expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled(); expect(res.headers["Content-Type"]).toBeUndefined();
  });
  it("returns clear 503 on pending PDF column without reading storage", async () => {
    const select = mock.db.select;
    mock.db.select = (projection: any) => {
      if (projection?.lesson?.embedPdf) throw { message: "Unknown column 'embedPdf' in 'field list'" };
      return select(projection);
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(); log.mockRestore();
    expect(res.statusCode).toBe(503); expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Academy PDF lesson database update")); expect(state.decrypted).not.toHaveBeenCalled();
  });
  it("assessment-document handler stays attachment-only even with view=inline", async () => {
    Object.assign(mock.tables.academy_lessons[0], { assessmentMode: "document_upload", assessmentTemplateKey: "synthetic/template", assessmentTemplateName: "Template.pdf", assessmentTemplateMimeType: "application/pdf" });
    const url = createAcademyDocumentDownloadUrl({ kind: "template", scope: "agent", userId: 10, enrollmentId: 44, lessonId: 11 }, "https://synthetic.example.test");
    const res = response(); await routes["/api/academy/assessment-document/:token"]({ params: { token: url.split("/").at(-1)! }, query: { view: "inline" } } as any, res as any);
    expect(res.statusCode).toBe(200); expect(res.headers["Content-Disposition"]).toBe('attachment; filename="Template.pdf"');
  });
});
