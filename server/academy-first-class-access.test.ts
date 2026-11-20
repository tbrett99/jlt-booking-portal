import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Express } from "express";
import { academyMockDb } from "./academy-staff-test-db";
import { FIRST_CLASS_UPGRADE_MESSAGE, FIRST_CLASS_WEEK_MS, firstClassModuleRelease, isFirstClassMembershipTier } from "../shared/academy-first-class";
import { agentCrmProfiles, agentTeams } from "../drizzle/schema";

const state = vi.hoisted(() => ({ db: null as any, user: null as any, grants: [] as number[], managed: false, employeeAccess: true,
  decrypted: vi.fn(), encrypted: vi.fn(), raw: vi.fn(), authenticate: vi.fn(), requireCourse: vi.fn(), emails: vi.fn(), notify: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => state.db, getRawDbPool: async () => ({ execute: state.raw }), createInAppNotification: state.notify, getUpcomingAgentEvents: async () => [] }));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storagePutEncrypted: state.encrypted, storageGetDecrypted: state.decrypted }));
vi.mock("./email", () => ({ sendDirectEmail: state.emails, sendSupportEmail: state.emails }));
vi.mock("./agent-development-router", () => ({ assignAcceleratorEntryActions: vi.fn(), releaseAvailableJourneyActions: vi.fn() }));
vi.mock("./academy-email-alerts", () => ({ ACADEMY_ALERT_EVENTS: ["course_assigned"], academyAlertAllowsModuleScope: vi.fn(), academyAlertTemplateHint: vi.fn(), dispatchAcademyEmailAlerts: vi.fn(), hasActiveAcademySupportAlert: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: state.authenticate } }));
vi.mock("./business-staff-access", () => ({ getBusinessStaffAuthority: async () => ({ managed: state.managed, active: state.employeeAccess, membership: { permissions: { academyAccess: state.employeeAccess } } }), assertBusinessStaffRouteAllowed: vi.fn() }));
vi.mock("./staff-access", () => ({ isFullAdmin: (user: any) => ["admin", "super_admin"].includes(user.role), requireInstructorCourse: state.requireCourse,
  getInstructorCourseIds: async (user: any) => user.role === "admin" ? null : state.grants, assertNotSelfReview: (user: any, learnerId: number) => { if (user.role === "agent" && user.id === learnerId) throw new TRPCError({ code: "FORBIDDEN" }); }, recordStaffOperation: vi.fn() }));
import { academyRouter } from "./academy-router";
import { academyPrivateAttachmentUrl } from "./academy-staff-access";
import { createAcademyDocumentDownloadUrl, registerAcademyDocumentDownloadRoutes } from "./academy-document-download-routes";
import { hasCurrentFirstClassMembership } from "./academy-first-class-access";

const now = new Date("2026-11-20T12:34:56.789Z");
const anchor = new Date("2026-11-19T12:34:56.789Z");
const key = "academy/90/12345678-abcd-abcd-abcd-123456789012-guide.pdf";
const pdf = Buffer.from("%PDF-1.7\nSynthetic test bytes only\n%%EOF");
const learner = { id: 10, role: "agent", name: "Synthetic learner", email: "learner@example.test", isActive: true, portalStatus: "active" };
const admin = { ...learner, id: 99, role: "admin" };
const instructor = { ...learner, id: 90 };
let mock: ReturnType<typeof academyMockDb>;
let routes: Record<string, (req: any, res: any) => any>;
const caller = (user: any = learner) => academyRouter.createCaller({ user, req: {}, res: {} } as any);
const courseInput = (extra = {}) => ({ id: 33, title: "Synthetic course", ...extra });
function lesson(id: number, moduleId: number) {
  return { id, moduleId, title: `Lesson ${id}`, summary: "Private lesson summary", contentHtml: "<p>Private teaching content</p>", videoUrl: "https://www.youtube.com/watch?v=synthetic", videoTranscript: "Staff only transcript", attachmentKey: key, attachmentUrl: academyPrivateAttachmentUrl(key), attachmentName: "Guide.pdf", embedPdf: true, archivedAt: null, assessmentMode: "document_upload", requiresAssessment: true, requiresAcknowledgement: true, assessmentPassMark: 90, assessmentTemplateKey: "academy/document-assessments/templates/90/template.pdf", assessmentTemplateName: "Template.pdf", assessmentTemplateMimeType: "application/pdf", assessmentTemplateSize: 100, isRequired: true, sortOrder: 0 };
}
function response() {
  return { statusCode: 0, headersSent: false, headers: {} as Record<string, string>, status(code: number) { this.statusCode = code; return this; }, set(headers: Record<string, string>) { Object.assign(this.headers, headers); return this; }, end: vi.fn(), send: vi.fn() };
}
async function http(kind: "inline" | "attachment" | "template" | "submission", lessonId = 11, scope: "agent" | "staff" = "agent") {
  const res = response();
  if (kind === "inline" || kind === "attachment") {
    await routes["/api/academy/course-attachment/:objectKey"]({ params: { objectKey: key }, query: kind === "inline" ? { view: "inline", lessonId: String(lessonId) } : {} }, res);
  } else {
    const url = createAcademyDocumentDownloadUrl({ kind, scope, userId: state.user.id, enrollmentId: 44, lessonId, ...(kind === "submission" ? { attemptId: 66 } : {}) }, "https://example.test");
    await routes["/api/academy/assessment-document/:token"]({ params: { token: url.split("/").at(-1)! }, query: {} }, res);
  }
  return res;
}
function privateOnlyAtLaterLesson() {
  Object.assign(mock.tables.academy_lessons[0], { attachmentKey: null, attachmentUrl: null });
  mock.tables.academy_assessment_attempts[0].lessonId = 12;
}
function history() {
  return structuredClone(Object.fromEntries(["academy_enrollments", "academy_lesson_progress", "academy_assessment_attempts", "academy_assessment_responses", "academy_assessment_question_resets"].map(name => [name, mock.tables[name]])));
}
function linkTeam(membershipTier: string | null | undefined, savedTier = "First Class") {
  Object.assign(mock.tables.agent_crm_profiles[0], { membershipTier: savedTier, teamId: 71 });
  // An unrelated eligible team first ensures the actual ID predicate is tested.
  mock.tables.agent_teams = [{ id: 70, membershipTier: "First Class Trio" }, { id: 71, membershipTier }];
}
function failTeamRead(error = new Error("Synthetic team database read failed")) {
  state.db = { ...mock.db, select(projection: any) {
    const query = mock.db.select(projection);
    const from = query.from;
    query.from = (table: any) => {
      from(table);
      if (table === agentTeams) query.then = (resolve: any, reject: any) => Promise.reject(error).then(resolve, reject);
      return query;
    };
    return query;
  } };
  return error;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv("JWT_SECRET", "synthetic-first-class-test-only-secret");
  state.user = learner; state.grants = []; state.managed = false; state.employeeAccess = true;
  state.authenticate.mockReset().mockImplementation(async () => state.user);
  state.requireCourse.mockReset().mockImplementation(async (user: any, courseId: number) => { if (!["admin", "super_admin"].includes(user.role) && !state.grants.includes(courseId)) throw new TRPCError({ code: "FORBIDDEN" }); });
  state.decrypted.mockReset().mockResolvedValue(pdf); state.encrypted.mockReset().mockImplementation(async (objectKey: string) => ({ key: objectKey }));
  state.raw.mockReset().mockImplementation(async (query: string, values: any[]) => {
    if (!query.trim().startsWith("INSERT INTO academy_courses")) throw new Error("Unexpected raw SQL; live access forbidden");
    const columns = query.match(/\(([^)]+)\)/)![1].split(",").map(item => item.trim());
    expect((query.match(/\?/g) ?? []).length).toBe(values.length); expect(columns.length).toBe(values.length);
    mock.tables.academy_courses.push({ id: 34, ...Object.fromEntries(columns.map((column, i) => [column, values[i]])) });
    return [{ insertId: 34 }];
  });
  mock = academyMockDb({
    agent_crm_profiles: [{ id: 1, userId: 10, membershipTier: "First Class" }, { id: 2, userId: 90, membershipTier: "Business Class" }],
    academy_courses: [{ id: 33, title: "Synthetic course", summary: "Catalog summary", coverImageUrl: null, status: "published", isCoreAcademy: false, isAcceleratorJourney: false, isFirstClassTraining: true }],
    academy_modules: [{ id: 22, courseId: 33, title: "First", sortOrder: 10, releaseWeek: 8 }, { id: 23, courseId: 33, title: "Second", sortOrder: 10, releaseWeek: 0 }, { id: 24, courseId: 33, title: "Third", sortOrder: 99, releaseWeek: 0 }],
    academy_lessons: [lesson(11, 22), lesson(12, 23), lesson(13, 24)],
    academy_enrollments: [{ id: 44, agentId: 10, courseId: 33, status: "assigned", enrolledAt: anchor, journeyStartedAt: new Date("2020-01-01T00:00:00Z"), completedAt: null }],
    academy_access: [{ id: 55, agentId: 10, status: "active" }],
    academy_lesson_progress: [{ id: 5, enrollmentId: 44, lessonId: 11, startedAt: anchor, acknowledgedAt: anchor, completedAt: anchor }],
    academy_questions: [{ id: 8, lessonId: 12, prompt: "Private question", questionType: "free_text", answerOptions: [], sortOrder: 0, maxWords: 100, correctAnswerIndex: 0 }],
    academy_assessment_attempts: [{ id: 66, enrollmentId: 44, lessonId: 11, status: "feedback_pending", passed: false, score: 60, graderFeedback: "Private feedback", takenAt: anchor, submissionFileKey: "academy/document-assessments/submissions/44/work.pdf", submissionFileName: "work.pdf", submissionMimeType: "application/pdf", assessmentTemplateKey: "historic/template.pdf", answers: [{ historic: true }] }],
    academy_assessment_responses: [{ id: 7, attemptId: 66, questionId: 8, responseText: "Historic answer", score: 60, feedback: "Private feedback" }], academy_assessment_question_resets: [],
    staff_academy_uploads: [{ id: 77, userId: 90, courseId: 33, objectKey: key, kind: "attachment" }], academy_audit_log: [], users: [{ ...admin }],
  }); state.db = mock.db; routes = {};
  registerAcademyDocumentDownloadRoutes({ get(path: string, handler: any) { routes[path] = handler; } } as unknown as Express);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("exact current CRM membership and fail-closed elapsed UTC release", () => {
  it.each(["First Class", "First Class Duo", "First Class Trio", "first_class", "first_class_duo", "first_class_trio", " FIRST CLASS DUO ", "first-class", "First-Class-Duo", " FIRST__CLASS--TRIO ", "first\t class\n duo"])("accepts canonical %s", tier => expect(isFirstClassMembershipTier(tier)).toBe(true));
  it.each([null, undefined, "", "Business Class", "Not First Class", "first_class_old", "First Class Plus", "Business First Class Duo", 1, "FirstClass", "First Class Duo cancelled", "first-class-trio-old", "first_class_duo_", "First Class / Duo"])("denies noncanonical %s", tier => expect(isFirstClassMembershipTier(tier)).toBe(false));
  it("uses rank in sortOrder,id order, not releaseWeek, title or numeric gaps", () => {
    const modules = [{ id: 99, sortOrder: 90 }, { id: 23, sortOrder: 4 }, { id: 22, sortOrder: 4 }];
    expect(firstClassModuleRelease({ enrolledAt: anchor }, modules, 22, now).releaseAt).toEqual(anchor);
    expect(firstClassModuleRelease({ enrolledAt: anchor }, modules, 23, now).releaseAt?.getTime()).toBe(anchor.getTime() + FIRST_CLASS_WEEK_MS);
    expect(firstClassModuleRelease({ enrolledAt: anchor }, modules, 99, now).releaseAt?.getTime()).toBe(anchor.getTime() + 2 * FIRST_CLASS_WEEK_MS);
  });
  it.each([null, undefined, "", "garbage", "2026-11-19", "2026-02-30T00:00:00Z", new Date(NaN), new Date("2099-01-01T00:00:00Z")])("fails closed for malformed/future anchor %s even module zero and completed recap", enrolledAt => {
    for (const status of ["assigned", "completed", "waived"]) expect(firstClassModuleRelease({ enrolledAt, status }, [{ id: 22, sortOrder: 0 }], 22, now)).toMatchObject({ releaseAt: null, releaseLocked: true });
  });
  it("exact week threshold is inclusive across DST and arbitrary seconds", () => {
    const enrolledAt = new Date("2026-10-23T09:14:15.123Z"); const modules = [{ id: 1, sortOrder: 0 }, { id: 2, sortOrder: 1 }];
    const releaseAt = new Date(enrolledAt.getTime() + FIRST_CLASS_WEEK_MS);
    expect(releaseAt.toISOString()).toBe("2026-10-30T09:14:15.123Z");
    expect(firstClassModuleRelease({ enrolledAt }, modules, 2, new Date(releaseAt.getTime() - 1)).releaseLocked).toBe(true);
    expect(firstClassModuleRelease({ enrolledAt }, modules, 2, releaseAt).releaseLocked).toBe(false);
  });
});

describe("actual own-profile/current-team membership helper", () => {
  it.each(["First Class", "First Class Duo", "First Class Trio", " FIRST--CLASS__DUO ", "first\tclass trio"])("current team %s grants despite stale Business profile", async tier => {
    linkTeam(tier, "Business Class");
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(true);
    expect(mock.reads).toEqual([
      { table: "agent_crm_profiles", projection: { membershipTier: agentCrmProfiles.membershipTier, teamId: agentCrmProfiles.teamId } },
      { table: "agent_teams", projection: { membershipTier: agentTeams.membershipTier } },
    ]);
    expect(mock.writes).toEqual([]);
  });
  it.each(["Business Duo", "Business Class Duo", "Business Trio", "Economy", "Unknown plan", "Not First Class", "first-class-duo-old"])("nonblank current team %s overrides stale First Class profile and denies", async tier => {
    linkTeam(tier);
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(false);
  });
  it.each([null, undefined, "", " \t\n "])("blank team tier %j falls back to the exact saved profile", async tier => {
    linkTeam(tier, " first--class__duo ");
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(true);
    mock.tables.agent_crm_profiles[0].membershipTier = "Business Duo";
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(false);
  });
  it("missing current team row falls back, never selects another eligible team", async () => {
    linkTeam("First Class Duo"); mock.tables.agent_teams.pop();
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(true);
    mock.tables.agent_crm_profiles[0].membershipTier = "Business Duo";
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(false);
  });
  it.each([null, undefined, 0, -1, 1.5, NaN, Infinity, "71"])("no positive valid team ID %j uses only saved own profile", async teamId => {
    linkTeam("Business Duo"); mock.tables.agent_crm_profiles[0].teamId = teamId;
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(true);
    expect(mock.reads.map(read => read.table)).toEqual(["agent_crm_profiles"]);
    mock.tables.agent_crm_profiles[0].membershipTier = "Business Class";
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(false);
  });
  it("re-reads own changed team link and changed current team tier on every check", async () => {
    linkTeam("First Class Duo"); mock.tables.agent_teams.push({ id: 72, membershipTier: "Business Duo" });
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(true);
    mock.tables.agent_crm_profiles[0].teamId = 72;
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(false);
    mock.tables.agent_teams[2].membershipTier = "First Class Trio";
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(true);
  });
  it("no own profile cannot inherit owner's linked First Class team or history", async () => {
    mock.tables.agent_crm_profiles = [{ id: 2, userId: 30, teamId: 71, membershipTier: "First Class" }];
    mock.tables.agent_teams = [{ id: 71, membershipTier: "First Class Duo" }];
    mock.tables.agent_agreements = [{ userId: 10, membershipTier: "First Class" }];
    await expect(hasCurrentFirstClassMembership(10)).resolves.toBe(false);
    expect(mock.reads.map(read => read.table)).toEqual(["agent_crm_profiles"]);
  });
  it("failed team read throws instead of using a saved eligible profile", async () => {
    linkTeam("First Class Duo"); const error = failTeamRead();
    await expect(hasCurrentFirstClassMembership(10)).rejects.toBe(error);
  });
  it("unavailable database fails closed", async () => {
    state.db = null;
    await expect(hasCurrentFirstClassMembership(10)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("actual tRPC learner course, home and mutation access", () => {
  it("redacts unreleased content/questions/files/feedback while exposing Date releaseAt and immediate first module", async () => {
    const dto = await caller().agent.course({ enrollmentId: 44 });
    expect(dto.modules[0]).toMatchObject({ releaseLocked: false, releaseAt: anchor });
    expect(dto.modules[1]).toMatchObject({ releaseLocked: true, releaseAt: new Date(anchor.getTime() + FIRST_CLASS_WEEK_MS) });
    expect(dto.modules[1].lessons[0]).toMatchObject({ locked: true, contentHtml: null, videoUrl: null, attachmentKey: null, attachmentUrl: null, attachmentName: null, assessmentTemplateName: null, hasAssessmentTemplate: false, embedPdf: false, questions: [], attempts: [], progress: null });
    expect(JSON.stringify(dto)).not.toContain("Staff only transcript");
  });
  it("current First Class Duo team grants real course, home and template despite stale Business profile", async () => {
    linkTeam("First Class Duo", "Business Class");
    const dto = await caller().agent.course({ enrollmentId: 44 });
    expect(dto.modules[0]).toMatchObject({ releaseLocked: false });
    expect(dto.modules[0].lessons[0].contentHtml).toBe("<p>Private teaching content</p>");
    expect((await caller().agent.home()).enrolments).toHaveLength(1);
    const template = await caller().agent.getDocumentAssessmentTemplate({ enrollmentId: 44, lessonId: 11, origin: "https://example.test" });
    expect(template.url).toContain("assessment-document/"); expect(mock.writes).toEqual([]);
  });
  it("fresh current-team Business Duo downgrade revokes held course ID and home despite stale First Class profile", async () => {
    linkTeam("First Class Duo"); await caller().agent.course({ enrollmentId: 44 });
    mock.tables.agent_teams[1].membershipTier = "Business Duo";
    await expect(caller().agent.course({ enrollmentId: 44 })).rejects.toMatchObject({ code: "FORBIDDEN", message: FIRST_CLASS_UPGRADE_MESSAGE });
    expect((await caller().agent.home())).toMatchObject({ enrolments: [], firstClassCourses: [{ id: 33, accessState: "upgrade_required" }] });
    expect(mock.tables.agent_crm_profiles[0].membershipTier).toBe("First Class"); expect(mock.writes).toEqual([]);
  });
  it.each(["missing", "blank"])("%s team uses saved own profile for actual tRPC", async mode => {
    linkTeam(" \t "); if (mode === "missing") mock.tables.agent_teams.pop();
    expect((await caller().agent.course({ enrollmentId: 44 })).modules[0].releaseLocked).toBe(false);
    mock.tables.agent_crm_profiles[0].membershipTier = "Business Class";
    await expect(caller().agent.course({ enrollmentId: 44 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await caller().agent.home()).enrolments).toEqual([]);
  });
  it("unknown nonblank team denies actual course/home, not profile fallback", async () => {
    linkTeam("First Class Duo old");
    await expect(caller().agent.course({ enrollmentId: 44 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await caller().agent.home()).enrolments).toEqual([]); expect(mock.writes).toEqual([]);
  });
  it("team database error fails actual tRPC course/home closed without saved-tier fallback", async () => {
    linkTeam("First Class Duo"); failTeamRead();
    await expect(caller().agent.course({ enrollmentId: 44 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    await expect(caller().agent.home()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(mock.writes).toEqual([]); expect(state.raw).not.toHaveBeenCalled();
  });
  it("fresh downgrade blocks held enrollment/course ID and removes all denied enrollments from home", async () => {
    await caller().agent.course({ enrollmentId: 44 }); mock.tables.agent_crm_profiles[0].membershipTier = "Business Class";
    await expect(caller().agent.course({ enrollmentId: 44 })).rejects.toMatchObject({ code: "FORBIDDEN", message: FIRST_CLASS_UPGRADE_MESSAGE });
    const home = await caller().agent.home(); expect(home.enrolments).toEqual([]);
    expect(home.firstClassCourses).toEqual([{ id: 33, title: "Synthetic course", summary: "Catalog summary", coverImageUrl: null, accessState: "upgrade_required" }]);
    expect(JSON.stringify(home)).not.toContain("Private feedback"); expect(JSON.stringify(home)).not.toContain("Private teaching content"); expect(mock.writes).toEqual([]);
  });
  it("eligible enrolled stays ordinary; eligible not-enrolled gets minimal catalog card only", async () => {
    let home = await caller().agent.home(); expect(home.enrolments).toHaveLength(1); expect(home.firstClassCourses).toEqual([]);
    mock.tables.academy_enrollments = []; home = await caller().agent.home(); expect(home.enrolments).toEqual([]);
    expect(home.firstClassCourses).toEqual([{ id: 33, title: "Synthetic course", summary: "Catalog summary", coverImageUrl: null, accessState: "not_enrolled" }]);
    await expect(caller().agent.course({ enrollmentId: 44 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("no Academy access remains safe and unpublished catalog/course never leaks", async () => {
    mock.tables.academy_access[0].status = "revoked"; expect(await caller().agent.home()).toMatchObject({ hasAccess: false, enrolments: [], firstClassCourses: [] });
    mock.tables.academy_access[0].status = "active"; mock.tables.academy_courses[0].status = "draft";
    expect(await caller().agent.home()).toMatchObject({ enrolments: [], firstClassCourses: [] });
    await expect(caller().agent.course({ enrollmentId: 44 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("home nextLesson never links unreleased modules; supplies release label", async () => {
    const home = await caller().agent.home(); expect(home.enrolments[0]).toMatchObject({ nextLesson: null, nextReleaseLabel: expect.any(String) });
    vi.setSystemTime(new Date(anchor.getTime() + FIRST_CLASS_WEEK_MS));
    expect((await caller().agent.home()).enrolments[0].nextLesson).toEqual({ id: 12, title: "Lesson 12" });
  });
  it("distinct learner anchors control the same module independently and exact week opens HTTP and template", async () => {
    mock.tables.agent_crm_profiles.push({ id: 3, userId: 20, membershipTier: "first_class_trio" });
    mock.tables.academy_access.push({ id: 56, agentId: 20, status: "active" });
    mock.tables.academy_enrollments.push({ id: 45, agentId: 20, courseId: 33, status: "assigned", enrolledAt: new Date(now.getTime() - FIRST_CLASS_WEEK_MS) });
    mock.tables.academy_lesson_progress.push({ id: 6, enrollmentId: 45, lessonId: 11, completedAt: anchor });
    expect((await caller({ ...learner, id: 20 }).agent.course({ enrollmentId: 45 })).modules[1].releaseLocked).toBe(false);
    expect((await caller().agent.course({ enrollmentId: 44 })).modules[1].releaseLocked).toBe(true);
    privateOnlyAtLaterLesson(); vi.setSystemTime(new Date(anchor.getTime() + FIRST_CLASS_WEEK_MS));
    const result = await caller().agent.getDocumentAssessmentTemplate({ enrollmentId: 44, lessonId: 12, origin: "https://example.test" }); expect(result.url).toContain("assessment-document/");
    expect((await http("inline", 12)).statusCode).toBe(200);
  });
  const actions: Array<[string, (api: ReturnType<typeof caller>["agent"]) => Promise<any>]> = [
    ["course", api => api.course({ enrollmentId: 44 })],
    ["view", api => api.viewLesson({ enrollmentId: 44, lessonId: 12 })],
    ["activity", api => api.recordActivity({ enrollmentId: 44, lessonId: 12, area: "lesson" })],
    ["acknowledge", api => api.acknowledgeLesson({ enrollmentId: 44, lessonId: 12 })],
    ["complete", api => api.completeLesson({ enrollmentId: 44, lessonId: 12 })],
    ["template", api => api.getDocumentAssessmentTemplate({ enrollmentId: 44, lessonId: 12, origin: "https://example.test" })],
    ["quiz", api => api.submitAssessment({ enrollmentId: 44, lessonId: 12, answers: [{ questionId: 8, responseText: "Synthetic" }] })],
    ["document", api => api.submitDocumentAssessment({ enrollmentId: 44, lessonId: 12, fileName: "Synthetic.pdf", fileBase64: pdf.toString("base64"), mimeType: "application/pdf" })],
    ["failed feedback", api => api.acknowledgeAssessmentFeedback({ attemptId: 66 })],
  ];
  it.each(actions)("denies direct %s for current Business Duo team despite stale First Class profile", async (_name, action) => {
    linkTeam("Business Duo");
    await expect(action(caller().agent)).rejects.toMatchObject({ code: "FORBIDDEN", message: FIRST_CLASS_UPGRADE_MESSAGE });
    expect(mock.writes).toEqual([]); expect(state.raw).not.toHaveBeenCalled(); expect(state.encrypted).not.toHaveBeenCalled(); expect(state.emails).not.toHaveBeenCalled();
  });
  it.each(actions)("denies direct %s on current downgrade before any writes/provider", async (_name, action) => {
    mock.tables.agent_crm_profiles[0].membershipTier = "Business Class";
    await expect(action(caller().agent)).rejects.toMatchObject({ code: "FORBIDDEN", message: FIRST_CLASS_UPGRADE_MESSAGE });
    expect(mock.writes).toEqual([]); expect(state.raw).not.toHaveBeenCalled(); expect(state.encrypted).not.toHaveBeenCalled(); expect(state.emails).not.toHaveBeenCalled();
  });
  it.each(actions.filter(([name]) => name !== "course"))("denies direct %s for unpublished enrollment", async (_name, action) => {
    mock.tables.academy_courses[0].status = "draft";
    await expect(action(caller().agent)).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(mock.writes).toEqual([]); expect(state.raw).not.toHaveBeenCalled();
  });
  it.each(actions.filter(([name]) => name !== "course"))("denies direct unreleased %s even failed-feedback acknowledgement", async (_name, action) => {
    mock.tables.academy_assessment_attempts[0].lessonId = 12;
    await expect(action(caller().agent)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mock.writes).toEqual([]); expect(state.raw).not.toHaveBeenCalled(); expect(state.encrypted).not.toHaveBeenCalled();
  });
  it("rechecks after submission storage downgrade before inserting a historical assessment", async () => {
    vi.setSystemTime(new Date(anchor.getTime() + FIRST_CLASS_WEEK_MS));
    mock.tables.academy_lesson_progress.push({ id: 6, enrollmentId: 44, lessonId: 12, acknowledgedAt: anchor });
    mock.tables.academy_assessment_attempts = [];
    state.encrypted.mockImplementation(async (objectKey: string) => { mock.tables.agent_crm_profiles[0].membershipTier = "Business Class"; return { key: objectKey }; });
    await expect(caller().agent.submitDocumentAssessment({ enrollmentId: 44, lessonId: 12, fileName: "Synthetic.pdf", fileBase64: pdf.toString("base64"), mimeType: "application/pdf" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.encrypted).toHaveBeenCalledOnce(); expect(mock.writes).toEqual([]); expect(state.raw).not.toHaveBeenCalled();
  });
  it.each(["changed team link", "current team downgrade", "team read error"])("rechecks %s during submission storage before historical writes", async mode => {
    linkTeam("First Class Duo"); mock.tables.agent_teams.push({ id: 72, membershipTier: "Business Duo" });
    vi.setSystemTime(new Date(anchor.getTime() + FIRST_CLASS_WEEK_MS));
    mock.tables.academy_lesson_progress.push({ id: 6, enrollmentId: 44, lessonId: 12, acknowledgedAt: anchor });
    mock.tables.academy_assessment_attempts = []; const before = history();
    state.encrypted.mockImplementation(async (objectKey: string) => {
      if (mode === "changed team link") mock.tables.agent_crm_profiles[0].teamId = 72;
      else if (mode === "current team downgrade") mock.tables.agent_teams[1].membershipTier = "Business Duo";
      else failTeamRead();
      return { key: objectKey };
    });
    await expect(caller().agent.submitDocumentAssessment({ enrollmentId: 44, lessonId: 12, fileName: "Synthetic.pdf", fileBase64: pdf.toString("base64"), mimeType: "application/pdf" })).rejects.toMatchObject({ code: mode === "team read error" ? "INTERNAL_SERVER_ERROR" : "FORBIDDEN" });
    expect(state.encrypted).toHaveBeenCalledOnce(); expect(mock.writes).toEqual([]); expect(state.raw).not.toHaveBeenCalled(); expect(history()).toEqual(before);
  });
  it("business employee needs their own tier, not their owner's First Class tier", async () => {
    state.managed = true; mock.tables.agent_crm_profiles[0].membershipTier = "Business Class";
    mock.tables.agent_crm_profiles.push({ id: 4, userId: 30, membershipTier: "First Class Trio" });
    await expect(caller().agent.course({ enrollmentId: 44 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    mock.tables.agent_crm_profiles[0].membershipTier = "First Class Duo"; expect((await caller().agent.course({ enrollmentId: 44 })).modules[0].releaseLocked).toBe(false);
  });
  it("no current profile cannot inherit historic payment/signing/session tier", async () => {
    mock.tables.agent_crm_profiles = [];
    mock.tables.agent_agreements = [{ userId: 10, membershipTier: "First Class" }];
    mock.tables.membership_subscriptions = [{ userId: 10, membershipTier: "first_class" }];
    await expect(caller({ ...learner, membershipTier: "First Class" }).agent.course({ enrollmentId: 44 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await caller().agent.home()).enrolments).toEqual([]);
  });
  it.each([null, new Date(NaN), new Date("2099-01-01T00:00:00Z")])("actual course and home fail closed on invalid/future anchor %s", async enrolledAt => {
    mock.tables.academy_enrollments[0].enrolledAt = enrolledAt;
    const dto = await caller().agent.course({ enrollmentId: 44 }); expect(dto.modules.every(module => module.releaseLocked)).toBe(true);
    expect((await caller().agent.home()).enrolments[0].nextLesson).toBeNull();
    await expect(caller().agent.viewLesson({ enrollmentId: 44, lessonId: 11 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("actual private HTTP token/template/submission/teaching attachment and PDF boundaries", () => {
  it.each(["inline", "attachment", "template", "submission"] as const)("current First Class Duo team grants %s despite stale Business profile", async kind => {
    linkTeam("First Class Duo", "Business Class"); const before = history();
    const res = await http(kind); expect(res.statusCode).toBe(200); expect(res.send).toHaveBeenCalledWith(pdf);
    expect(res.headers["Cache-Control"]).toBe("private, no-store, max-age=0"); expect(history()).toEqual(before); expect(mock.writes).toEqual([]);
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("current Business Duo team denies %s despite stale First Class profile before storage", async kind => {
    linkTeam("Business Duo"); const res = await http(kind);
    expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled(); expect(state.decrypted).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]);
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("unknown nonblank team denies %s without eligible profile fallback", async kind => {
    linkTeam("First Class Duo expired"); const res = await http(kind);
    expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled(); expect(state.decrypted).not.toHaveBeenCalled();
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("missing/blank team tier uses saved own profile for %s", async kind => {
    linkTeam(" \t "); let res = await http(kind); expect(res.statusCode).toBe(200); expect(res.send).toHaveBeenCalledWith(pdf);
    mock.tables.agent_teams.pop(); res = await http(kind); expect(res.statusCode).toBe(200);
    mock.tables.agent_crm_profiles[0].membershipTier = "Business Duo"; state.decrypted.mockClear();
    res = await http(kind); expect(res.statusCode).toBe(404); expect(state.decrypted).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]);
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("failed team database read denies %s before storage, not saved-tier fallback", async kind => {
    linkTeam("First Class Duo"); failTeamRead(); vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await http(kind); expect(res.statusCode).toBe(500); expect(res.send).not.toHaveBeenCalledWith(pdf);
    expect(state.decrypted).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]);
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("rechecks changed own team link during %s storage before returning bytes", async kind => {
    linkTeam("First Class Duo"); mock.tables.agent_teams.push({ id: 72, membershipTier: "Business Duo" }); const before = history();
    state.decrypted.mockImplementation(async () => { mock.tables.agent_crm_profiles[0].teamId = 72; return pdf; });
    const res = await http(kind); expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled(); expect(state.decrypted).toHaveBeenCalledOnce();
    expect(history()).toEqual(before); expect(mock.writes).toEqual([]);
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("rechecks current team downgrade during %s storage despite stale eligible profile", async kind => {
    linkTeam("First Class Duo");
    state.decrypted.mockImplementation(async () => { mock.tables.agent_teams[1].membershipTier = "Business Duo"; return pdf; });
    const res = await http(kind); expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled(); expect(state.decrypted).toHaveBeenCalledOnce();
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("failed team read after %s storage never falls back or releases bytes", async kind => {
    linkTeam("First Class Duo"); vi.spyOn(console, "error").mockImplementation(() => {});
    state.decrypted.mockImplementation(async () => { failTeamRead(); return pdf; });
    const res = await http(kind); expect(res.statusCode).toBe(500); expect(res.send).not.toHaveBeenCalledWith(pdf); expect(state.decrypted).toHaveBeenCalledOnce(); expect(mock.writes).toEqual([]);
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("freshly denies %s for membership downgrade before storage", async kind => {
    mock.tables.agent_crm_profiles[0].membershipTier = "Business Class"; const res = await http(kind);
    expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled(); expect(state.decrypted).not.toHaveBeenCalled();
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("denies unreleased %s despite token/object-key knowledge", async kind => {
    privateOnlyAtLaterLesson(); const res = await http(kind, 12); expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled(); expect(state.decrypted).not.toHaveBeenCalled();
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("denies sequentially locked %s even after its release", async kind => {
    privateOnlyAtLaterLesson(); mock.tables.academy_lesson_progress = []; vi.setSystemTime(new Date(anchor.getTime() + FIRST_CLASS_WEEK_MS));
    const res = await http(kind, 12); expect(res.statusCode).toBe(404); expect(state.decrypted).not.toHaveBeenCalled();
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("rechecks %s downgrade after storage and never returns bytes", async kind => {
    state.decrypted.mockImplementation(async () => { mock.tables.agent_crm_profiles[0].membershipTier = "Business Class"; return pdf; });
    const res = await http(kind); expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled(); expect(state.decrypted).toHaveBeenCalledOnce();
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("rechecks %s publication after storage", async kind => {
    state.decrypted.mockImplementation(async () => { mock.tables.academy_courses[0].status = "draft"; return pdf; });
    const res = await http(kind); expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled();
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("rechecks %s enrollment after storage", async kind => {
    state.decrypted.mockImplementation(async () => { mock.tables.academy_enrollments = []; return pdf; });
    const res = await http(kind); expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled();
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("rechecks %s release/prerequisites after storage", async kind => {
    state.decrypted.mockImplementation(async () => { mock.tables.academy_enrollments[0].enrolledAt = new Date("2099-01-01T00:00:00Z"); return pdf; });
    const res = await http(kind); expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled();
  });
  it.each(["inline", "attachment", "template", "submission"] as const)("valid current learner receives %s privately without any record writes", async kind => {
    const before = history(); const res = await http(kind); expect(res.statusCode).toBe(200); expect(res.send).toHaveBeenCalledWith(pdf);
    expect(res.headers["Cache-Control"]).toBe("private, no-store, max-age=0"); expect(history()).toEqual(before); expect(mock.writes).toEqual([]); expect(state.authenticate).toHaveBeenCalledTimes(2);
  });
  it("business employee own tier is rechecked in private endpoints even with eligible owner permission", async () => {
    state.managed = true; mock.tables.agent_crm_profiles[0].membershipTier = "Business Class"; state.grants = [33];
    expect((await http("inline")).statusCode).toBe(404); expect((await http("attachment")).statusCode).toBe(404); expect(state.decrypted).not.toHaveBeenCalled();
  });
  it("already minted agent token loses access after downgrade", async () => {
    const url = createAcademyDocumentDownloadUrl({ kind: "template", scope: "agent", userId: 10, enrollmentId: 44, lessonId: 11 }, "https://example.test");
    mock.tables.agent_crm_profiles[0].membershipTier = "Business Class";
    const res = response(); await routes["/api/academy/assessment-document/:token"]({ params: { token: url.split("/").at(-1)! } }, res);
    expect(res.statusCode).toBe(404); expect(state.decrypted).not.toHaveBeenCalled();
  });
});

describe("designation authority, staff previews and immutable completed/waived recap", () => {
  it("new courses default false and explicit true appears in native prepared SQL", async () => {
    await caller(admin).admin.saveCourse(courseInput({ id: undefined })); expect(mock.tables.academy_courses.at(-1).isFirstClassTraining).toBe(false);
    await caller(admin).admin.saveCourse(courseInput({ id: undefined, isFirstClassTraining: true })); expect(mock.tables.academy_courses.at(-1).isFirstClassTraining).toBe(true);
    expect(state.raw).toHaveBeenCalledWith(expect.stringContaining("isFirstClassTraining"), expect.any(Array));
  });
  it("old editor omission preserves true; only admin can turn designation off/on", async () => {
    state.user = { ...admin };
    await caller(admin).admin.saveCourse(courseInput()); expect(mock.tables.academy_courses[0].isFirstClassTraining).toBe(true);
    await caller(admin).admin.saveCourse(courseInput({ isFirstClassTraining: false })); expect(mock.tables.academy_courses[0].isFirstClassTraining).toBe(false);
    await caller(admin).admin.saveCourse(courseInput({ isFirstClassTraining: true })); expect(mock.tables.academy_courses[0].isFirstClassTraining).toBe(true);
  });
  it.each([{ isCoreAcademy: true, isFirstClassTraining: true }, { isAcceleratorJourney: true, isFirstClassTraining: true }, { isCoreAcademy: true, isAcceleratorJourney: true, isFirstClassTraining: false }])("rejects mutually exclusive combinations before writes %j", async extra => {
    await expect(caller(admin).admin.saveCourse(courseInput(extra))).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.writes).toEqual([]); expect(state.raw).not.toHaveBeenCalled();
  });
  it("assigned instructor can edit with omitted or unchanged designation but cannot change it", async () => {
    state.grants = [33]; await caller(instructor).admin.saveCourse(courseInput()); expect(mock.tables.academy_courses[0].isFirstClassTraining).toBe(true);
    expect(mock.writes.find(write => write.table === "academy_courses")?.values).not.toHaveProperty("isFirstClassTraining");
    await caller(instructor).admin.saveCourse(courseInput({ isFirstClassTraining: true }));
    await expect(caller(instructor).admin.saveCourse(courseInput({ isFirstClassTraining: false }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("full admin preview and assigned instructor draft teaching preview bypass learner membership/release only legitimately", async () => {
    mock.tables.academy_courses[0].status = "draft"; mock.tables.academy_enrollments = []; state.user = admin;
    const dto = await caller(admin).agent.previewCourse({ courseId: 33 }); expect(dto.modules.every(module => !module.releaseLocked)).toBe(true);
    expect((await http("inline", 12)).statusCode).toBe(200);
    state.user = instructor; state.grants = [33]; expect((await caller(instructor).admin.editor({ courseId: 33 })).course.id).toBe(33);
    expect((await http("inline", 12)).statusCode).toBe(200); expect((await http("attachment", 12)).statusCode).toBe(200);
    state.grants = []; expect((await http("inline", 12)).statusCode).toBe(404);
  });
  it.each([admin, instructor])("staff historic marking/download remains available while learner membership downgraded and course unpublished", async user => {
    mock.tables.agent_crm_profiles[0].membershipTier = "Business Class"; mock.tables.academy_courses[0].status = "archived"; mock.tables.academy_lessons[0].archivedAt = now; state.user = user; state.grants = [33];
    const before = history(); const res = await http("submission", 11, "staff"); expect(res.statusCode).toBe(200); expect(history()).toEqual(before); expect(mock.writes).toEqual([]);
  });
  it("staff download freshly rechecks instructor grant after storage", async () => {
    state.user = instructor; state.grants = [33]; state.decrypted.mockImplementation(async () => { state.grants = []; return pdf; });
    const res = await http("submission", 11, "staff"); expect(res.statusCode).toBe(404); expect(res.send).not.toHaveBeenCalled();
  });
  it.each(["completed", "waived"])("%s full enrollment retains all recap release/path access but membership mandatory", async status => {
    mock.tables.academy_enrollments[0].status = status; mock.tables.academy_enrollments[0].completedAt = anchor;
    mock.tables.academy_lesson_progress = []; privateOnlyAtLaterLesson(); const before = history();
    const dto = await caller().agent.course({ enrollmentId: 44 }); expect(dto.modules.every(module => !module.releaseLocked && module.lessons.every(lesson => !lesson.locked))).toBe(true);
    for (const kind of ["inline", "attachment", "template", "submission"] as const) expect((await http(kind, 12)).statusCode).toBe(200);
    expect(history()).toEqual(before); expect(mock.writes).toEqual([]);
    const priorSession = state.user; state.user = { ...admin };
    await caller(admin).admin.saveCourse(courseInput({ isFirstClassTraining: true })); expect(history()).toEqual(before);
    state.user = priorSession;
    mock.tables.agent_crm_profiles[0].membershipTier = "Business Class";
    await expect(caller().agent.course({ enrollmentId: 44 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect((await http("inline", 12)).statusCode).toBe(404);
    expect(history()).toEqual(before);
  });
  it.each(["completed", "waived"])("%s recap view/activity/completion and attempted assessment changes never rewrite records", async status => {
    mock.tables.academy_enrollments[0].status = status;
    const before = history();
    expect(await caller().agent.viewLesson({ enrollmentId: 44, lessonId: 13 })).toEqual({ success: true });
    expect(await caller().agent.recordActivity({ enrollmentId: 44, lessonId: 13, area: "lesson" })).toEqual({ creditedSeconds: 0 });
    expect(await caller().agent.completeLesson({ enrollmentId: 44, lessonId: 13 })).toEqual({ success: true });
    await expect(caller().agent.acknowledgeLesson({ enrollmentId: 44, lessonId: 13 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().agent.submitAssessment({ enrollmentId: 44, lessonId: 13, answers: [{ questionId: 8, responseText: "Synthetic" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().agent.submitDocumentAssessment({ enrollmentId: 44, lessonId: 13, fileName: "Synthetic.pdf", fileBase64: pdf.toString("base64"), mimeType: "application/pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().agent.acknowledgeAssessmentFeedback({ attemptId: 66 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(history()).toEqual(before); expect(mock.writes).toEqual([]); expect(state.encrypted).not.toHaveBeenCalled(); expect(state.raw).not.toHaveBeenCalled(); expect(state.emails).not.toHaveBeenCalled();
  });
  it("never treats title alone as First Class designation", async () => {
    mock.tables.academy_courses[0].title = "First Class Training"; mock.tables.academy_courses[0].isFirstClassTraining = false; mock.tables.agent_crm_profiles[0].membershipTier = "Business Class";
    expect((await caller().agent.course({ enrollmentId: 44 })).course.id).toBe(33); expect((await caller().agent.home()).firstClassCourses).toEqual([]);
  });
});
