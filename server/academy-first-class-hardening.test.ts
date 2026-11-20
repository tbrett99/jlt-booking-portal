import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { router } from "./_core/trpc";
import { academyMockDb } from "./academy-staff-test-db";

const state = vi.hoisted(() => ({
  db: null as any, freshUser: null as any, managed: false, employeeActive: true, employeePermission: true,
  authenticate: vi.fn(), authority: vi.fn(), boundary: vi.fn(), encrypted: vi.fn(), publicPut: vi.fn(), decrypted: vi.fn(),
  raw: vi.fn(), operation: vi.fn(), directEmail: vi.fn(), supportEmail: vi.fn(), alerts: vi.fn(), notify: vi.fn(), external: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: async () => state.db, getRawDbPool: async () => ({ execute: state.raw }), createInAppNotification: state.notify, getUpcomingAgentEvents: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: state.publicPut, storagePutEncrypted: state.encrypted, storageGetDecrypted: state.decrypted }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: state.authenticate } }));
vi.mock("./business-staff-access", () => ({ getBusinessStaffAuthority: state.authority, assertBusinessStaffRouteAllowed: state.boundary }));
vi.mock("./email", () => ({ sendDirectEmail: state.directEmail, sendSupportEmail: state.supportEmail }));
vi.mock("./agent-development-router", () => ({ assignAcceleratorEntryActions: vi.fn(), releaseAvailableJourneyActions: vi.fn() }));
vi.mock("./academy-email-alerts", () => ({ ACADEMY_ALERT_EVENTS: ["written_assessment_ready"], academyAlertAllowsModuleScope: vi.fn(), academyAlertTemplateHint: vi.fn(), dispatchAcademyEmailAlerts: state.alerts, hasActiveAcademySupportAlert: vi.fn(async () => false) }));
vi.mock("./staff-access", () => ({
  isFullAdmin: (user: any) => ["admin", "super_admin"].includes(user.role),
  requireInstructorCourse: async (user: any) => { if (!["admin", "super_admin"].includes(user.role)) throw new TRPCError({ code: "FORBIDDEN" }); },
  getInstructorCourseIds: async () => null, assertNotSelfReview: vi.fn(), recordStaffOperation: state.operation,
}));
import { academyRouter } from "./academy-router";
import { academyPrivateAttachmentUrl } from "./academy-staff-access";

// Mount at the production prefix so the real protected-procedure middleware
// requests the actual Academy permission path, not an unmounted test-only path.
const routes = router({ academy: academyRouter });
const learner = { id: 10, role: "agent", name: "Offline learner", email: "learner@example.test", isActive: true, portalStatus: "active", mustChangePassword: false };
const admin = { ...learner, id: 99, role: "admin" };
const pdf = Buffer.from("%PDF-1.7\nOffline synthetic assessment only\n%%EOF");
const key = "academy/90/12345678-abcd-abcd-abcd-123456789012-guide.pdf";
const publicUrl = `https://storage.example.test/${key}`;
const req = { headers: { cookie: "synthetic-session-only" } };
const caller = (user: any = admin) => routes.createCaller({ user, req, res: {} } as any).academy;
const draft = (extra = {}) => ({ id: 11, moduleId: 22, title: "Offline lesson", ...extra });
const uploadInput = (extra = {}) => ({ courseId: 33, fileName: "Guide.pdf", fileBase64: pdf.toString("base64"), mimeType: "application/pdf" as const, ...extra });
const submission = () => ({ enrollmentId: 44, lessonId: 11, fileName: "Completed.pdf", fileBase64: pdf.toString("base64"), mimeType: "application/pdf" as const });
let mock: ReturnType<typeof academyMockDb>;
const course = () => mock.tables.academy_courses[0];
const lesson = () => mock.tables.academy_lessons[0];
function noWritesOrAlerts() {
  expect(mock.writes).toEqual([]); expect(state.raw).not.toHaveBeenCalled(); expect(state.operation).not.toHaveBeenCalled();
  expect(state.notify).not.toHaveBeenCalled(); expect(state.alerts).not.toHaveBeenCalled();
  expect(state.directEmail).not.toHaveBeenCalled(); expect(state.supportEmail).not.toHaveBeenCalled();
}
function privateResource() {
  Object.assign(lesson(), { attachmentKey: key, attachmentUrl: academyPrivateAttachmentUrl(key), attachmentName: "Guide.pdf" });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("JWT_SECRET", "offline-first-class-hardening-secret"); vi.stubEnv("S3_PUBLIC_URL", "https://storage.example.test");
  state.freshUser = { ...learner }; state.managed = false; state.employeeActive = true; state.employeePermission = true;
  state.authenticate.mockReset().mockImplementation(async () => state.freshUser);
  state.authority.mockReset().mockImplementation(async () => ({ managed: state.managed, active: state.employeeActive, membership: { permissions: { academyAccess: state.employeePermission } } }));
  // Offline authority fixtures, never actual provider or production identities.
  state.boundary.mockReset().mockImplementation(async (_user: any, path: string, authority: any) => {
    if (authority.managed && !(path.startsWith("academy.") && authority.active && authority.membership.permissions.academyAccess)) throw new TRPCError({ code: "FORBIDDEN" });
  });
  state.encrypted.mockReset().mockImplementation(async (objectKey: string) => ({ key: objectKey }));
  state.publicPut.mockReset().mockImplementation(async (objectKey: string) => ({ key: objectKey, url: `https://storage.example.test/${objectKey}` }));
  state.raw.mockReset().mockImplementation(async (query: string, values: any[]) => {
    if (!query.trim().startsWith("INSERT INTO academy_assessment_attempts")) throw new Error("Unexpected raw SQL: offline unit mocks only");
    const columns = query.match(/\(([^)]+)\)/)![1].split(",").map(column => column.trim());
    expect(columns).toHaveLength(values.length); expect(query.match(/\?/g)).toHaveLength(values.length); expect(values).not.toContain(undefined);
    const record = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    await mock.db.insert((await import("../drizzle/schema")).academyAssessmentAttempts).values(record);
    return [{ insertId: 1 }];
  });
  state.alerts.mockReset().mockResolvedValue(undefined); state.directEmail.mockReset().mockResolvedValue(undefined); state.supportEmail.mockReset().mockResolvedValue(undefined);
  state.external.mockReset().mockImplementation(() => { throw new Error("External providers prohibited"); }); vi.stubGlobal("fetch", state.external);
  mock = academyMockDb({
    academy_courses: [{ id: 33, title: "Offline First Class course", isFirstClassTraining: true, isCoreAcademy: false, isAcceleratorJourney: false, status: "published", coverImageUrl: "https://storage.example.test/catalog.png" }],
    academy_modules: [{ id: 22, courseId: 33, title: "Module", sortOrder: 0, releaseWeek: 0 }],
    academy_lessons: [{ id: 11, moduleId: 22, title: "Offline lesson", sortOrder: 0, archivedAt: null, isRequired: true, assessmentMode: "quiz", requiresAssessment: false, requiresAcknowledgement: false, embedPdf: false, attachmentKey: null, attachmentUrl: null }],
    academy_access: [{ id: 55, agentId: 10, status: "active" }],
    academy_enrollments: [{ id: 44, agentId: 10, courseId: 33, status: "assigned", enrolledAt: new Date("2020-01-01T00:00:00Z") }],
    academy_lesson_progress: [], academy_questions: [], academy_assessment_attempts: [], academy_assessment_responses: [], academy_assessment_question_resets: [], academy_audit_log: [],
    agent_crm_profiles: [{ id: 1, userId: 10, membershipTier: "First Class" }],
    staff_academy_uploads: [{ id: 77, userId: 90, courseId: 33, objectKey: key, kind: "attachment" }], users: [learner, admin],
  }); state.db = mock.db;
});
afterEach(() => { expect(state.external).not.toHaveBeenCalled(); expect(state.decrypted).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("First Class configured teaching attachment boundary through actual routes", () => {
  it.each(["designation", "publish"])("denies historical public teaching attachments before %s writes", async action => {
    Object.assign(lesson(), { attachmentKey: key, attachmentUrl: publicUrl });
    if (action === "designation") {
      course().isFirstClassTraining = false;
      await expect(caller().admin.saveCourse({ id: 33, title: "Offline course", isFirstClassTraining: true })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Remove the old teaching resource") });
      expect(course().isFirstClassTraining).toBe(false);
    } else {
      course().status = "draft";
      await expect(caller().admin.setCourseStatus({ courseId: 33, status: "published" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Historical public URLs are not revoked") });
      expect(course().status).toBe("draft");
    }
    noWritesOrAlerts(); expect(state.encrypted).not.toHaveBeenCalled(); expect(state.publicPut).not.toHaveBeenCalled();
  });
  it("does not hide archived configured public resources when designating a course", async () => {
    Object.assign(lesson(), { attachmentKey: key, attachmentUrl: publicUrl, archivedAt: new Date() }); course().isFirstClassTraining = false;
    await expect(caller().admin.saveCourse({ id: 33, title: "Offline course", isFirstClassTraining: true })).rejects.toMatchObject({ code: "BAD_REQUEST" }); noWritesOrAlerts();
  });
  it("encrypts a full-admin First Class attachment and registers the same course/kind without public storage", async () => {
    const uploaded = await caller().admin.uploadAttachment(uploadInput());
    expect(state.encrypted).toHaveBeenCalledOnce(); expect(state.encrypted).toHaveBeenCalledWith(uploaded.key, pdf); expect(state.publicPut).not.toHaveBeenCalled();
    expect(uploaded.url).toBe(academyPrivateAttachmentUrl(uploaded.key));
    expect(mock.tables.staff_academy_uploads.at(-1)).toMatchObject({ userId: 99, courseId: 33, objectKey: uploaded.key, kind: "attachment" });
    await caller().admin.saveLesson(draft({ attachmentUrl: uploaded.url, attachmentKey: uploaded.key, attachmentName: uploaded.name, embedPdf: true }));
    expect(lesson().attachmentUrl).toBe(uploaded.url);
  });
  it.each(["ordinary-course", "global-admin"])("preserves %s public upload behavior", async mode => {
    course().isFirstClassTraining = false;
    if (mode === "global-admin") state.db = null; // Existing global clients need no registry DB.
    const uploaded = await caller().admin.uploadAttachment(uploadInput(mode === "global-admin" ? { courseId: undefined } : {}));
    expect(state.publicPut).toHaveBeenCalledOnce(); expect(state.publicPut).toHaveBeenCalledWith(uploaded.key, pdf, "application/pdf"); expect(state.encrypted).not.toHaveBeenCalled();
    expect(uploaded.url).toBe(`https://storage.example.test/${uploaded.key}`);
  });
  it("keeps First Class catalog image uploads public, not teaching attachments", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=", "base64");
    const image = await caller().admin.uploadCourseImage({ courseId: 33, fileName: "catalog.png", mimeType: "image/png", fileBase64: png.toString("base64") });
    expect(state.publicPut).toHaveBeenCalledOnce(); expect(state.encrypted).not.toHaveBeenCalled();
    expect(image.url).toBe(`https://storage.example.test/${image.key}`);
    expect(mock.tables.staff_academy_uploads.at(-1)).toMatchObject({ courseId: 33, objectKey: image.key, kind: "image" });
  });
  it.each(["public", "url-only", "key-only", "wrong-course", "wrong-kind", "unregistered", "noncanonical", "alternate-origin", "query"])("denies %s teaching attachment on admin saveLesson before writes", async mode => {
    privateResource();
    if (mode === "public") lesson().attachmentUrl = publicUrl;
    if (mode === "url-only") lesson().attachmentKey = null;
    if (mode === "key-only") lesson().attachmentUrl = null;
    if (mode === "wrong-course") mock.tables.staff_academy_uploads[0].courseId = 34;
    if (mode === "wrong-kind") mock.tables.staff_academy_uploads[0].kind = "document_template";
    if (mode === "unregistered") mock.tables.staff_academy_uploads = [];
    if (mode === "noncanonical") { lesson().attachmentKey = "academy/90/not-canonical.pdf"; lesson().attachmentUrl = academyPrivateAttachmentUrl(lesson().attachmentKey); }
    if (mode === "alternate-origin") lesson().attachmentUrl = lesson().attachmentUrl.replace("portal.thejltgroup.co.uk", "example.test");
    if (mode === "query") lesson().attachmentUrl += "?public=1";
    await expect(caller().admin.saveLesson(draft({ attachmentKey: lesson().attachmentKey, attachmentUrl: lesson().attachmentUrl }))).rejects.toMatchObject({ code: "BAD_REQUEST" }); noWritesOrAlerts();
  });
  it.each(["designation", "publish"])("denies another course's canonical private upload before %s", async action => {
    privateResource(); mock.tables.staff_academy_uploads[0].courseId = 34;
    if (action === "designation") await expect(caller().admin.saveCourse({ id: 33, title: "Offline course", isFirstClassTraining: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    else await expect(caller().admin.setCourseStatus({ courseId: 33, status: "published" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    noWritesOrAlerts();
  });
  it("supports removal, designation, private re-upload, save and publish without touching the historical object", async () => {
    course().isFirstClassTraining = false; Object.assign(lesson(), { attachmentKey: key, attachmentUrl: publicUrl, embedPdf: true });
    await caller().admin.saveLesson(draft({ attachmentKey: null, attachmentUrl: null, embedPdf: false }));
    await caller().admin.saveCourse({ id: 33, title: "Offline course", isFirstClassTraining: true, coverImageUrl: course().coverImageUrl });
    const uploaded = await caller().admin.uploadAttachment(uploadInput());
    await caller().admin.saveLesson(draft({ attachmentKey: uploaded.key, attachmentUrl: uploaded.url, videoUrl: "https://www.youtube.com/watch?v=synthetic", contentHtml: '<p>Teaching <img src="https://example.test/content-image.png"></p>' }));
    await caller().admin.setCourseStatus({ courseId: 33, status: "published" });
    expect(state.publicPut).not.toHaveBeenCalled(); expect(state.encrypted).toHaveBeenCalledOnce();
    expect(course().coverImageUrl).toBe("https://storage.example.test/catalog.png"); expect(lesson().videoUrl).toContain("youtube.com");
    expect(mock.tables.staff_academy_uploads[0].objectKey).toBe(key); // Historical registration untouched, not a deletion claim.
  });
  it("keeps ordinary public attachment lesson saves and publication compatible", async () => {
    course().isFirstClassTraining = false;
    await caller().admin.saveLesson(draft({ attachmentKey: key, attachmentUrl: publicUrl }));
    await caller().admin.setCourseStatus({ courseId: 33, status: "published" }); expect(lesson().attachmentUrl).toBe(publicUrl);
  });
});

describe("document submission fresh author/session and Academy permission after encrypted storage", () => {
  beforeEach(() => { Object.assign(lesson(), { requiresAssessment: true, assessmentMode: "document_upload", assessmentPassMark: 90 }); });
  it.each(["inactive", "paused", "suspended", "cancelled", "different-author", "changed-role", "missing-session", "revoked-session", "employee-revoked", "employee-permission-revoked", "authority-unavailable"])("rejects %s after storage before any historical/alert writes", async mode => {
    if (mode.startsWith("employee")) state.managed = true;
    state.encrypted.mockImplementation(async (objectKey: string) => {
      if (mode === "inactive") state.freshUser.isActive = false;
      if (["paused", "suspended", "cancelled"].includes(mode)) state.freshUser.portalStatus = mode;
      if (mode === "different-author") state.freshUser.id = 20;
      if (mode === "changed-role") state.freshUser.role = "admin";
      if (mode === "missing-session") state.freshUser = null;
      if (mode === "revoked-session") state.authenticate.mockRejectedValue(new Error("Synthetic revoked session"));
      if (mode === "employee-revoked") state.employeeActive = false;
      if (mode === "employee-permission-revoked") state.employeePermission = false;
      if (mode === "authority-unavailable") state.authority.mockRejectedValue(new TRPCError({ code: "INTERNAL_SERVER_ERROR" }));
      return { key: objectKey };
    });
    const before = structuredClone(mock.tables);
    await expect(caller(learner).agent.submitDocumentAssessment(submission())).rejects.toMatchObject({ code: mode === "authority-unavailable" ? "INTERNAL_SERVER_ERROR" : mode.startsWith("employee") ? "FORBIDDEN" : "UNAUTHORIZED" });
    expect(state.encrypted).toHaveBeenCalledOnce(); expect(state.authenticate).toHaveBeenCalledOnce(); expect(state.authenticate).toHaveBeenCalledWith(req); expect(state.publicPut).not.toHaveBeenCalled();
    expect(mock.tables).toEqual(before); noWritesOrAlerts();
    if (mode.startsWith("employee")) expect(state.boundary).toHaveBeenLastCalledWith(state.freshUser, "academy.agent.submitDocumentAssessment", expect.objectContaining({ managed: true }));
  });
  it.each([true, false])("retains strict session checks for FirstClass=%s and permits a currently authorized submission", async firstClass => {
    course().isFirstClassTraining = firstClass;
    const result = await caller(learner).agent.submitDocumentAssessment(submission());
    expect(result).toEqual({ attemptId: 1, status: "awaiting_marking" }); expect(state.authenticate).toHaveBeenCalledOnce(); expect(state.authenticate).toHaveBeenCalledWith(req);
    expect(state.authority).toHaveBeenCalledTimes(2); expect(state.boundary).toHaveBeenCalledTimes(2);
    expect(mock.tables.academy_assessment_attempts).toHaveLength(1); expect(mock.tables.academy_audit_log).toHaveLength(1); expect(state.alerts).toHaveBeenCalledOnce();
  });
  it("permits an employee with their own current tier, active authority and current Academy grant", async () => {
    state.managed = true;
    await expect(caller(learner).agent.submitDocumentAssessment(submission())).resolves.toEqual({ attemptId: 1, status: "awaiting_marking" });
    expect(state.authenticate).toHaveBeenCalledOnce(); expect(state.authority).toHaveBeenCalledTimes(2);
    expect(state.boundary).toHaveBeenLastCalledWith(state.freshUser, "academy.agent.submitDocumentAssessment", expect.objectContaining({ managed: true, active: true }));
  });
  it("fails closed on an ordinary-course session revoked during upload too", async () => {
    course().isFirstClassTraining = false; state.encrypted.mockImplementation(async (objectKey: string) => { state.authenticate.mockRejectedValue(new Error("Offline revoked cookie")); return { key: objectKey }; });
    await expect(caller(learner).agent.submitDocumentAssessment(submission())).rejects.toMatchObject({ code: "UNAUTHORIZED" }); noWritesOrAlerts();
  });
});

describe("First Class recap template download permission parity", () => {
  it.each(["completed", "waived"])("allows %s recap template mint with actionable older feedback and no evidence writes", async status => {
    mock.tables.academy_enrollments[0].status = status;
    mock.tables.academy_lessons.push({ ...lesson(), id: 12, sortOrder: 1, requiresAssessment: true, assessmentMode: "document_upload", assessmentTemplateKey: "academy/document-assessments/templates/90/33/template.pdf", assessmentTemplateName: "Template.pdf" });
    Object.assign(lesson(), { requiresAssessment: true, assessmentMode: "document_upload", isRequired: false });
    mock.tables.academy_assessment_attempts.push({ id: 66, enrollmentId: 44, lessonId: 11, status: "feedback_pending", passed: false, takenAt: new Date("2020-01-01T00:00:00Z") });
    const before = structuredClone(mock.tables);
    const template = await caller(learner).agent.getDocumentAssessmentTemplate({ enrollmentId: 44, lessonId: 12, origin: "https://portal.example.test" });
    expect(template.url).toContain("/api/academy/assessment-document/"); expect(template.name).toBe("Template.pdf"); expect(mock.tables).toEqual(before); noWritesOrAlerts();
    mock.tables.academy_enrollments[0].status = "assigned";
    await expect(caller(learner).agent.getDocumentAssessmentTemplate({ enrollmentId: 44, lessonId: 12, origin: "https://portal.example.test" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("feedback") });
  });
});
