import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { academyMockDb } from "./academy-staff-test-db";
import { router } from "./_core/trpc";

const state = vi.hoisted(() => ({ db: null as any, fresh: null as any, authenticate: vi.fn(), send: vi.fn(), email: vi.fn(), notify: vi.fn(), operation: vi.fn(), external: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = state.send; },
  GetObjectCommand: class { operation = "get"; constructor(public input: any) {} },
  PutObjectCommand: class { operation = "put"; constructor(public input: any) {} },
}));
vi.mock("./db", () => ({ getDb: async () => state.db, getRawDbPool: async () => { throw new Error("Raw SQL prohibited in conversion"); }, createInAppNotification: state.notify, getUpcomingAgentEvents: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: state.authenticate } }));
vi.mock("./email", () => ({ sendDirectEmail: state.email, sendSupportEmail: state.email }));
vi.mock("./agent-development-router", () => ({ assignAcceleratorEntryActions: vi.fn(), releaseAvailableJourneyActions: vi.fn() }));
vi.mock("./academy-email-alerts", () => ({ ACADEMY_ALERT_EVENTS: [], academyAlertAllowsModuleScope: vi.fn(), academyAlertTemplateHint: vi.fn(), dispatchAcademyEmailAlerts: state.email, hasActiveAcademySupportAlert: vi.fn() }));
vi.mock("./staff-access", () => ({ isFullAdmin: (user: any) => ["admin", "super_admin"].includes(user.role), requireInstructorCourse: async (user: any) => { if (!["admin", "super_admin", "instructor"].includes(user.role)) throw new TRPCError({ code: "FORBIDDEN" }); }, getInstructorCourseIds: async () => [33], assertNotSelfReview: vi.fn(), recordStaffOperation: state.operation }));
vi.mock("./business-staff-access", () => ({ getBusinessStaffAuthority: async () => ({ managed: false }), assertBusinessStaffRouteAllowed: vi.fn() }));
import { academyRouter } from "./academy-router";
import { academyPrivateAttachmentUrl } from "./academy-staff-access";
import { decryptPrivateStoragePayload, encryptPrivateStoragePayload, storageGetRawBounded, storagePutEncrypted } from "./storage";
import { convertFirstClassCourseResources, FIRST_CLASS_CONVERSION_MAX_FILES, FIRST_CLASS_CONVERSION_PREPARATION_MS } from "./academy-first-class-conversion";
import { MAX_ACADEMY_DOCUMENT_BYTES } from "./academy-document-assessment";

const routes = router({ academy: academyRouter });
const admin = { id: 99, role: "admin", openId: "offline-admin", isActive: true, portalStatus: "active", name: "Offline Admin" };
const req = { headers: { cookie: "offline-synthetic-session-only" } };
const key = "academy/90/12345678-abcd-abcd-abcd-123456789012-guide.pdf";
const legacyKey = "academy/90/1699999999999-guide.pdf";
const privateKey = "academy/90/12345678-abcd-abcd-abcd-123456789013-private.pdf";
const pdf = Buffer.from("%PDF-1.7\nSynthetic teaching bytes only\n%%EOF");
const stamp = new Date("2020-01-02T03:04:05Z");
const courseSave = (extra = {}) => ({ id: 33, title: "Saved full payload", summary: "  New summary  ", coverImageUrl: "https://example.test/new-cover.png", estimatedMinutes: 47, isFirstClassTraining: true, ...extra });
const caller = (actor: any = admin) => routes.createCaller({ user: actor, req, res: {} } as any).academy.admin;
const publicUrl = (objectKey: string) => `https://storage.example.test/${objectKey}`;
let mock: ReturnType<typeof academyMockDb>;
let objects: Map<string, Buffer>;
let commands: Array<{ operation: string; input: any }>;
let locks: string[];
let txActive: boolean;
let transactions: number;
let failWriteTable: string | undefined;
let beforeLock: (() => void) | undefined;
let beforeTransaction: (() => Promise<void>) | undefined;
let beforeLockedRead: ((table: string) => Promise<void>) | undefined;
let transactionTail: Promise<unknown>;
let missingTranscript: boolean;
let missingTransactionAdapter: boolean;
let preparedSql: Array<{ query: string; values: any[] }>;
const lesson = () => mock.tables.academy_lessons[0];
const course = () => mock.tables.academy_courses[0];
const history = () => Object.fromEntries(["academy_enrollments", "academy_lesson_progress", "academy_questions", "academy_assessment_attempts", "academy_assessment_responses", "academy_assessment_question_resets"].map(table => [table, mock.tables[table]]));
function stream(bytes: Buffer, contentLength: number | undefined = bytes.length) {
  return { ContentLength: contentLength, Body: { async *[Symbol.asyncIterator]() { for (let offset = 0; offset < bytes.length; offset += 65536) yield bytes.subarray(offset, offset + 65536); }, destroy: vi.fn() } };
}
function installTransactions() {
  const select = mock.db.select.bind(mock.db);
  const insert = mock.db.insert.bind(mock.db);
  const update = mock.db.update.bind(mock.db);
  mock.db.select = (projection: any) => {
    expect(txActive, "global SELECT escaped the transaction connection").toBe(false);
    return select(projection);
  };
  mock.db.transaction = async (callback: any, config: any) => {
    if (beforeTransaction) { const pause = beforeTransaction; beforeTransaction = undefined; await pause(); }
    expect(config).toEqual({ isolationLevel: "repeatable read" });
    const previous = transactionTail;
    let release!: () => void;
    transactionTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    expect(txActive).toBe(false);
    transactions++;
    const before = structuredClone(mock.tables); const writesBefore = mock.writes.length;
    const txLocks: string[] = [];
    const tx = {
      select(projection: any) {
        const query = select(projection);
        const from = query.from;
        const then = query.then;
        let table = ""; let locked = false;
        query.from = (schema: any) => { table = getTableName(schema); return from(schema); };
        query.for = (mode: string) => {
          expect(mode).toBe("update"); expect(txActive).toBe(true);
          if (!txLocks.length) expect(table, "course must be locked before actor/module/lesson").toBe("academy_courses");
          locked = true; txLocks.push(table); locks.push(table);
          if (beforeLock) { const fn = beforeLock; beforeLock = undefined; fn(); }
          return query;
        };
        query.then = (resolve: any, reject: any) => Promise.resolve().then(async () => {
          if (locked && beforeLockedRead) await beforeLockedRead(table);
          return new Promise((done, fail) => then(done, fail));
        }).then(resolve, reject);
        return query;
      },
      insert(schema: any) {
        const operation = insert(schema);
        return { values: async (values: any) => {
          expect(txActive).toBe(true); expect(txLocks[0]).toBe("academy_courses");
          if (failWriteTable === getTableName(schema)) throw new Error("Synthetic transaction insert failure");
          return operation.values(values);
        } };
      },
      update(schema: any) { expect(txActive).toBe(true); expect(txLocks[0]).toBe("academy_courses"); return mock.db.update === update ? update(schema) : mock.db.update(schema); },
      session: { client: { execute: async (query: string, values: any[]) => {
        expect(txActive).toBe(true); expect(txLocks.slice(0, 2)).toEqual(["academy_courses", "academy_modules"]);
        expect(query.trim().startsWith("INSERT INTO academy_lessons")).toBe(true);
        preparedSql.push({ query, values });
        if (missingTranscript && query.includes("videoTranscript")) throw { code: "ER_BAD_FIELD_ERROR", message: "Unknown column videoTranscript" };
        const columns = query.match(/\(([^)]+)\)/)![1].split(",").map(column => column.trim());
        expect(columns).toHaveLength(values.length); expect(query.match(/\?/g)).toHaveLength(values.length); expect(values).not.toContain(undefined);
        const schema = (await import("../drizzle/schema")).academyLessons;
        return [await insert(schema).values(Object.fromEntries(columns.map((column, index) => [column, values[index]])))];
      } } },
    };
    if (missingTransactionAdapter) (tx as any).session = undefined;
    txActive = true;
    try { return await callback(tx); }
    catch (error) { for (const name of Object.keys(mock.tables)) delete mock.tables[name]; Object.assign(mock.tables, before); mock.writes.splice(writesBefore); throw error; }
    finally { txActive = false; release(); }
  };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("JWT_SECRET", "synthetic-offline-encryption-key"); vi.stubEnv("S3_ENDPOINT", "https://offline-r2.example.test"); vi.stubEnv("S3_ACCESS_KEY_ID", "offline"); vi.stubEnv("S3_SECRET_ACCESS_KEY", "offline"); vi.stubEnv("S3_BUCKET", "offline"); vi.stubEnv("S3_PUBLIC_URL", "https://storage.example.test");
  state.external.mockReset().mockImplementation(() => { throw new Error("Network fetch prohibited"); }); vi.stubGlobal("fetch", state.external);
  state.fresh = { ...admin }; state.authenticate.mockReset().mockImplementation(async () => state.fresh);
  objects = new Map([[key, pdf], [legacyKey, pdf], [privateKey, encryptPrivateStoragePayload(pdf)]]); commands = []; locks = []; txActive = false; transactions = 0; failWriteTable = undefined; beforeLock = undefined; beforeTransaction = undefined; beforeLockedRead = undefined; transactionTail = Promise.resolve(); missingTranscript = false; missingTransactionAdapter = false; preparedSql = [];
  state.send.mockReset().mockImplementation(async (command: any) => {
    expect(txActive).toBe(false); commands.push(command);
    if (command.operation === "put") { expect(command.input.ContentType).toBe("application/octet-stream"); expect(command.input.CacheControl).toBe("no-store"); objects.set(command.input.Key, Buffer.from(command.input.Body)); return {}; }
    const bytes = objects.get(command.input.Key); if (!bytes) throw new Error("Synthetic NoSuchKey"); return stream(bytes);
  });
  mock = academyMockDb({
    academy_courses: [{ id: 33, title: "Original course", summary: "original summary", coverImageUrl: "https://example.test/old-cover.png", isCoreAcademy: false, isAcceleratorJourney: false, isFirstClassTraining: false, estimatedMinutes: 5, status: "published", createdById: 90, updatedById: 90, createdAt: stamp, updatedAt: stamp, publishedAt: stamp, archivedAt: null }, { id: 34, title: "Other course", isFirstClassTraining: false }],
    academy_modules: [{ id: 22, courseId: 33, title: "Original module", sortOrder: 0, releaseWeek: 0, updatedAt: stamp }, { id: 23, courseId: 34, title: "Other module" }],
    academy_lessons: [{ id: 11, moduleId: 22, title: "Original lesson", summary: "lesson summary", sortOrder: 0, attachmentKey: key, attachmentUrl: publicUrl(key), attachmentName: "Guide.pdf", embedPdf: true, contentHtml: "<p>Original content</p>", videoTranscript: "Original transcript", videoUrl: "https://www.youtube.com/watch?v=synthetic", archivedAt: null, createdAt: stamp, updatedAt: stamp, assessmentMode: "quiz", requiresAssessment: false, isRequired: true }, { id: 12, moduleId: 23, title: "Other lesson", attachmentKey: key, attachmentUrl: publicUrl(key) }],
    staff_academy_uploads: [], users: [{ ...admin }], academy_audit_log: [],
    academy_enrollments: [{ id: 44, courseId: 33, enrolledAt: stamp, completedAt: stamp, status: "completed" }],
    academy_lesson_progress: [{ id: 1, lessonId: 11, enrollmentId: 44, status: "completed", completedAt: stamp }],
    academy_questions: [{ id: 55, lessonId: 11, prompt: "Original question", correctAnswerIndex: 0 }],
    academy_assessment_attempts: [{ id: 66, lessonId: 11, enrollmentId: 44, answers: [{ original: "private evidence" }], submissionFileKey: "academy/document-assessments/submissions/44/11/original.pdf", takenAt: stamp }],
    academy_assessment_responses: [{ id: 77, attemptId: 66, responseText: "Original response" }], academy_assessment_question_resets: [{ id: 88, lessonId: 11 }],
  }); state.db = mock.db; installTransactions();
});
afterEach(() => { expect(state.external).not.toHaveBeenCalled(); expect(state.email).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled(); expect(commands.every(command => ["get", "put"].includes(command.operation))).toBe(true); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const untouched = (before: any) => { expect(mock.tables).toEqual(before); expect(mock.writes).toEqual([]); };

describe("actual course save automatic First Class conversion with raw SDK storage", () => {
  it.each(["admin", "super_admin"])("converts reused archived legacy PDFs as %s, retains private references and all history bytes", async role => {
    Object.assign(mock.tables.users[0], { role }); state.fresh.role = role;
    Object.assign(lesson(), { attachmentKey: legacyKey, attachmentUrl: publicUrl(legacyKey) });
    mock.tables.academy_lessons.push({ ...lesson(), id: 13, attachmentName: "Archived Guide.pdf", archivedAt: stamp }, { ...lesson(), id: 14, attachmentKey: privateKey, attachmentUrl: academyPrivateAttachmentUrl(privateKey), attachmentName: "Private.pdf" });
    mock.tables.staff_academy_uploads.push({ id: 9, userId: 90, courseId: 33, objectKey: privateKey, kind: "attachment" });
    const before = structuredClone(mock.tables); const originalHistoryBytes = JSON.stringify(history());
    expect(await caller({ ...admin, role }).saveCourse(courseSave())).toEqual({ id: 33 });
    expect(transactions).toBe(1); expect(state.operation).not.toHaveBeenCalled(); expect(state.authenticate).toHaveBeenCalledOnce(); expect(state.authenticate).toHaveBeenCalledWith(req);
    expect(locks).toEqual(expect.arrayContaining(["users", "academy_courses", "academy_modules", "academy_lessons", "staff_academy_uploads"]));
    expect(commands.filter(command => command.operation === "put")).toHaveLength(1);
    const target = lesson().attachmentKey;
    expect(target).toMatch(/^academy\/99\/[a-f0-9-]{36}-1699999999999-guide\.pdf$/); expect(target).not.toBe(legacyKey);
    expect(lesson().attachmentUrl).toBe(academyPrivateAttachmentUrl(target)); expect(mock.tables.academy_lessons[2].attachmentKey).toBe(target);
    for (const index of [0, 2]) { const { attachmentKey: _k, attachmentUrl: _u, ...saved } = mock.tables.academy_lessons[index]; const { attachmentKey: _oldK, attachmentUrl: _oldU, ...original } = before.academy_lessons[index]; expect(saved).toEqual(original); }
    expect(mock.tables.academy_lessons[1]).toEqual(before.academy_lessons[1]); expect(mock.tables.academy_lessons[3]).toEqual(before.academy_lessons[3]);
    expect(JSON.stringify(history())).toBe(originalHistoryBytes); expect(decryptPrivateStoragePayload(objects.get(target)!)).toEqual(pdf); expect(objects.get(legacyKey)).toEqual(pdf);
    expect(mock.tables.staff_academy_uploads).toHaveLength(2); expect(mock.tables.staff_academy_uploads[0]).toEqual(before.staff_academy_uploads[0]);
    expect(course()).toEqual({ ...before.academy_courses[0], title: "Saved full payload", summary: "New summary", coverImageUrl: "https://example.test/new-cover.png", estimatedMinutes: 47, isFirstClassTraining: true, updatedById: 99 });
    expect(mock.tables.academy_audit_log).toHaveLength(1); const audit = mock.tables.academy_audit_log[0];
    expect(audit.metadata).toMatchObject({ convertedFileCount: 1, convertedReferenceCount: 2, convertedBytes: pdf.length, learnerEvidencePreserved: true, historicalPublicObjectsUntouched: true });
    expect(JSON.stringify(audit)).not.toMatch(/Original|Guide\.pdf|academy\/90|private evidence|New summary/);
  });
  it("supports multiple distinct sources and authenticated readback without public puts", async () => {
    mock.tables.academy_lessons.push({ ...lesson(), id: 13, attachmentKey: legacyKey, attachmentUrl: publicUrl(legacyKey) });
    await caller().saveCourse(courseSave()); expect(commands.filter(command => command.operation === "put")).toHaveLength(2); expect(mock.tables.staff_academy_uploads).toHaveLength(2);
  });
  it.each(["pdf", "docx", "xlsx", "txt", "csv"])("converts current %s format with exact original byte equality", async extension => {
    const source = `academy/90/1699999999999-guide.${extension}`; const bytes = ["docx", "xlsx"].includes(extension) ? Buffer.from("PK\x03\x04synthetic office archive") : extension === "pdf" ? pdf : Buffer.from("Original text,unchanged\n");
    objects.set(source, bytes); Object.assign(lesson(), { attachmentKey: source, attachmentUrl: publicUrl(source), attachmentName: `Guide.${extension}`, embedPdf: extension === "pdf" });
    await caller().saveCourse(courseSave()); expect(decryptPrivateStoragePayload(objects.get(lesson().attachmentKey)!)).toEqual(bytes); expect(objects.get(source)).toEqual(bytes);
  });
  it.each(["none", "private"])("serializes %s resource save with the same locked cutover and exact return contract", async mode => {
    Object.assign(lesson(), mode === "none" ? { attachmentKey: null, attachmentUrl: null } : { attachmentKey: privateKey, attachmentUrl: academyPrivateAttachmentUrl(privateKey) });
    if (mode === "private") mock.tables.staff_academy_uploads.push({ id: 9, courseId: 33, userId: 90, objectKey: privateKey, kind: "attachment" });
    expect(await caller().saveCourse(courseSave())).toEqual({ id: 33 }); expect(course().isFirstClassTraining).toBe(true); expect(commands).toEqual([]); expect(transactions).toBe(1); expect(state.authenticate).toHaveBeenCalledOnce();
  });
  it("retains omitted old-editor flag and converts resources when a flagged course is saved", async () => {
    course().isFirstClassTraining = true;
    await caller().saveCourse(courseSave({ isFirstClassTraining: undefined })); expect(course().isFirstClassTraining).toBe(true); expect(commands.filter(command => command.operation === "put")).toHaveLength(1);
  });
  it("leaves ordinary course public attachment saves unchanged", async () => {
    await caller().saveCourse(courseSave({ isFirstClassTraining: false })); expect(lesson().attachmentKey).toBe(key); expect(commands).toEqual([]); expect(transactions).toBe(0);
  });
  it.each(["enable", "exclusive"])("retains permission and exclusive flag denial: %s", async mode => {
    const before = structuredClone(mock.tables);
    await expect((mode === "enable" ? caller({ ...admin, role: "instructor" }) : caller()).saveCourse(courseSave(mode === "exclusive" ? { isCoreAcademy: true } : {}))).rejects.toMatchObject({ code: mode === "enable" ? "FORBIDDEN" : "BAD_REQUEST" }); untouched(before); expect(commands).toEqual([]);
  });
  it("does not authorize another requested course from attachment metadata", async () => {
    const before = structuredClone(mock.tables);
    await expect(caller().saveCourse(courseSave({ id: 999 }))).rejects.toMatchObject({ code: "NOT_FOUND" }); untouched(before); expect(commands).toEqual([]);
  });
});

describe("refuses unsafe, malformed and out-of-scope resource snapshots before storage", () => {
  it.each(["external", "query", "fragment", "redirect-url", "alternate-origin", "url-only", "key-only", "path-traversal", "actor-zero", "unsupported-doc", "unsupported-xls", "filename-mismatch", "private-unregistered", "private-wrong-course", "private-wrong-kind", "public-wrong-course", "public-wrong-kind", "template", "legacy-template", "submission", "handbook", "financial", "template-same-key"])("refuses %s with a short resource error and no changes", async mode => {
    if (mode === "external") lesson().attachmentUrl = "https://evil.example/guide.pdf";
    if (mode === "query") lesson().attachmentUrl += "?redirect=1";
    if (mode === "fragment") lesson().attachmentUrl += "#pdf";
    if (mode === "redirect-url") lesson().attachmentUrl = "http://127.0.0.1/redirect";
    if (mode === "alternate-origin") lesson().attachmentUrl = `https://storage.example.test.evil.example/${key}`;
    if (mode === "url-only") lesson().attachmentKey = null;
    if (mode === "key-only") lesson().attachmentUrl = null;
    if (mode === "filename-mismatch") lesson().attachmentName = "Guide.docx";
    const bad: Record<string, string> = { "path-traversal": "academy/90/../guide.pdf", "actor-zero": "academy/0/guide.pdf", "unsupported-doc": "academy/90/guide.doc", "unsupported-xls": "academy/90/guide.xls", template: "academy/document-assessments/templates/90/33/guide.pdf", "legacy-template": "academy/templates/90/guide.pdf", submission: "academy/document-assessments/submissions/44/11/guide.pdf", handbook: "staff-handbook/90/guide.pdf", financial: "users/90/financial/guide.pdf" };
    if (bad[mode]) { lesson().attachmentKey = bad[mode]; lesson().attachmentUrl = publicUrl(bad[mode]); }
    if (mode.startsWith("private")) lesson().attachmentUrl = academyPrivateAttachmentUrl(key);
    if (mode.includes("wrong-course") || mode.includes("wrong-kind")) mock.tables.staff_academy_uploads.push({ id: 1, userId: 90, objectKey: key, courseId: mode.includes("wrong-course") ? 34 : 33, kind: mode.includes("wrong-kind") ? "document_template" : "attachment" });
    if (mode === "template-same-key") lesson().assessmentTemplateKey = key;
    const before = structuredClone(mock.tables);
    await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Guide") }); untouched(before); expect(commands).toEqual([]);
  });
  it("prevalidates archived references before preparing otherwise valid files", async () => {
    mock.tables.academy_lessons.push({ ...lesson(), id: 13, archivedAt: stamp, attachmentUrl: "https://external.example/guide.pdf" });
    const before = structuredClone(mock.tables); await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "BAD_REQUEST" }); untouched(before); expect(commands).toEqual([]);
  });
  it("bounds distinct file count before reads, not repeated references", async () => {
    for (let index = 0; index < FIRST_CLASS_CONVERSION_MAX_FILES; index++) mock.tables.academy_lessons.push({ ...lesson(), id: 100 + index, attachmentKey: `academy/90/${index}-guide.pdf`, attachmentUrl: publicUrl(`academy/90/${index}-guide.pdf`) });
    const before = structuredClone(mock.tables); await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("100") }); untouched(before); expect(commands).toEqual([]);
  });
  it.each(["missing", "oversize-metadata", "oversize-stream", "empty", "malformed-pdf", "malformed-docx", "malformed-xlsx", "readback-corrupt", "readback-different-valid-bytes"])("rejects %s without any committed metadata, flag or lesson changes", async mode => {
    if (mode === "missing") objects.delete(key);
    if (mode === "empty") objects.set(key, Buffer.alloc(0));
    if (mode === "malformed-pdf") objects.set(key, Buffer.from("not a PDF"));
    if (["malformed-docx", "malformed-xlsx"].includes(mode)) { const extension = mode.split("-")[1]; const source = `academy/90/guide.${extension}`; objects.set(source, pdf); Object.assign(lesson(), { attachmentKey: source, attachmentUrl: publicUrl(source), attachmentName: `Guide.${extension}` }); }
    const send = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (command: any, options: any) => {
      if (command.operation === "get" && command.input.Key === key && mode.startsWith("oversize")) { commands.push(command); return stream(Buffer.alloc(mode === "oversize-stream" ? MAX_ACADEMY_DOCUMENT_BYTES + 1 : 1), mode === "oversize-stream" ? 1 : MAX_ACADEMY_DOCUMENT_BYTES + 1); }
      if (command.operation === "get" && command.input.Key !== key && mode.startsWith("readback")) { commands.push(command); return stream(mode === "readback-corrupt" ? Buffer.from("corrupt") : encryptPrivateStoragePayload(Buffer.from("%PDF-1.7\nDIFFERENT\n%%EOF"))); }
      return send(command, options);
    });
    const before = structuredClone(mock.tables); await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Guide") }); untouched(before); expect(transactions).toBe(0);
  });
  it("enforces aggregate bytes separately from the per-file 10 MB bound", async () => {
    mock.tables.academy_lessons = [];
    const bytes = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_ACADEMY_DOCUMENT_BYTES - 5)]);
    for (let index = 0; index < 11; index++) { const source = `academy/90/${index}-guide.pdf`; objects.set(source, bytes); mock.tables.academy_lessons.push({ id: index + 1, moduleId: 22, title: "Guide", attachmentKey: source, attachmentUrl: publicUrl(source), attachmentName: "Guide.pdf", updatedAt: stamp }); }
    const before = structuredClone(mock.tables); await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "BAD_REQUEST" }); untouched(before); expect(transactions).toBe(0);
  });
});

describe("await-boundary identity, scope, concurrency and atomic failure safety", () => {
  it.each(["inactive", "role-change", "different-actor", "paused", "suspended", "cancelled", "missing-session", "revoked-session", "db-actor-revoked", "db-role-revoked", "course-renamed", "lesson-renamed", "resources-changed", "archived-changed", "module-moved", "lesson-moved", "lesson-added", "lesson-deleted", "registry-changed"])("aborts %s after storage, leaving references and flag unchanged", async mode => {
    const originalSource = objects.get(key);
    const send = state.send.getMockImplementation()!;
    let changed = false; let afterConcurrentChange: any;
    state.send.mockImplementation(async (command: any, options: any) => {
      const result = await send(command, options);
      if (command.operation === "put" && !changed) {
        changed = true;
        if (mode === "inactive") state.fresh.isActive = false;
        if (mode === "role-change") state.fresh.role = "super_admin";
        if (mode === "different-actor") state.fresh.id = 100;
        if (["paused", "suspended", "cancelled"].includes(mode)) state.fresh.portalStatus = mode;
        if (mode === "missing-session") state.fresh = null;
        if (mode === "revoked-session") state.authenticate.mockRejectedValue(new Error("revoked"));
        if (mode === "db-actor-revoked") mock.tables.users[0].isActive = false;
        if (mode === "db-role-revoked") mock.tables.users[0].role = "agent";
        if (mode === "course-renamed") course().title = "Concurrent rename";
        if (mode === "lesson-renamed") lesson().title = "Concurrent rename";
        if (mode === "resources-changed") lesson().attachmentUrl = publicUrl(legacyKey);
        if (mode === "archived-changed") lesson().archivedAt = stamp;
        if (mode === "module-moved") mock.tables.academy_modules[0].courseId = 34;
        if (mode === "lesson-moved") lesson().moduleId = 23;
        if (mode === "lesson-added") mock.tables.academy_lessons.push({ ...lesson(), id: 13 });
        if (mode === "lesson-deleted") mock.tables.academy_lessons.shift();
        if (mode === "registry-changed") mock.tables.staff_academy_uploads.push({ id: 1, userId: 90, courseId: 34, objectKey: key, kind: "attachment" });
        afterConcurrentChange = structuredClone(mock.tables);
      }
      return result;
    });
    await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: ["inactive", "role-change", "different-actor", "paused", "suspended", "cancelled", "missing-session", "revoked-session", "db-actor-revoked", "db-role-revoked"].includes(mode) ? "UNAUTHORIZED" : "CONFLICT" });
    untouched(afterConcurrentChange); expect(objects.get(key)).toBe(originalSource); expect(commands.filter(command => command.operation === "put")).toHaveLength(1); expect(course().isFirstClassTraining).toBe(false);
  });
  it("rechecks DB actor even if the SDK falsely reports stale authorized metadata", async () => {
    beforeLock = () => { mock.tables.users[0].isActive = false; };
    await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(course().isFirstClassTraining).toBe(false); expect(mock.tables.staff_academy_uploads).toEqual([]); expect(mock.writes).toEqual([]);
  });
  it("settles all concurrent preparations after a partial storage failure before rejecting", async () => {
    mock.tables.academy_lessons.push({ ...lesson(), id: 13, attachmentKey: legacyKey, attachmentUrl: publicUrl(legacyKey) });
    let settled = false; const send = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (command: any, options: any) => {
      if (command.operation === "put" && command.input.Key.endsWith("1699999999999-guide.pdf")) throw new Error("Synthetic partial storage failure");
      if (command.operation === "put") { await new Promise(resolve => setTimeout(resolve, 25)); settled = true; }
      return send(command, options);
    });
    const before = structuredClone(mock.tables); await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(settled).toBe(true); untouched(before); expect(transactions).toBe(0); expect(state.authenticate).not.toHaveBeenCalled();
  });
  it.each(["staff_academy_uploads", "academy_audit_log"])("rolls back all metadata, references and full payload on %s insert failure", async table => {
    failWriteTable = table; const before = structuredClone(mock.tables);
    await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); untouched(before); expect(transactions).toBe(1); expect(commands.filter(command => command.operation === "put")).toHaveLength(1); expect(objects.get(key)).toEqual(pdf);
  });
  it("rolls back registry and flag when a reference CAS is ineffective", async () => {
    const update = mock.db.update.bind(mock.db);
    mock.db.update = (schema: any) => getTableName(schema) === "academy_lessons" ? { set: () => ({ where: async () => ({ affectedRows: 0 }) }) } : update(schema);
    const before = structuredClone(mock.tables); await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "CONFLICT" }); untouched(before);
  });
  it("caps storage concurrency at three for distinct source preparation", async () => {
    mock.tables.academy_lessons = [];
    for (let index = 0; index < 8; index++) { const source = `academy/90/${index}-guide.pdf`; objects.set(source, pdf); mock.tables.academy_lessons.push({ id: index + 1, moduleId: 22, title: "Guide", attachmentKey: source, attachmentUrl: publicUrl(source), attachmentName: "Guide.pdf", updatedAt: stamp }); }
    let active = 0; let maximum = 0; const send = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (command: any, options: any) => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 2)); try { return await send(command, options); } finally { active--; } });
    await caller().saveCourse(courseSave()); expect(maximum).toBe(3); expect(active).toBe(0); expect(mock.tables.staff_academy_uploads).toHaveLength(8);
  });
  it("service rejects a mismatched scope rather than trusting payload actor/source claims", async () => {
    const before = structuredClone(mock.tables);
    await expect(convertFirstClassCourseResources({ db: state.db, actor: admin as any, req: req as any, courseId: 34, expectedCourse: course(), payload: { ...course(), updatedById: 99, isFirstClassTraining: true } })).rejects.toMatchObject({ code: "FORBIDDEN" }); untouched(before); expect(commands).toEqual([]);
  });
});

describe("bounded raw R2 SDK helper", () => {
  it("uses GetObject with configured bucket/key and streamed byte limits, never URL fetch", async () => {
    expect(await storageGetRawBounded(key, 100)).toEqual(pdf); expect(commands[0].input).toEqual({ Bucket: "offline", Key: key }); expect(state.send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });
  it.each(["https://evil.example/file", "/academy/90/file.pdf", "academy/90/../file.pdf", "academy/90/file.pdf?x=1", "academy\\90\\file.pdf"])("refuses invalid raw key %s before SDK access", async rawKey => {
    await expect(storageGetRawBounded(rawKey, 100)).rejects.toThrow(); expect(state.send).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])("refuses invalid bound %s", async bound => {
    await expect(storageGetRawBounded(key, bound)).rejects.toThrow(); expect(state.send).not.toHaveBeenCalled();
  });
  it.each(["missing-length", "false-small-length", "oversize-length", "truncated", "unreadable"])("checks real streams and metadata: %s", async mode => {
    const body = stream(pdf); const destroy = body.Body.destroy;
    if (mode === "missing-length") body.ContentLength = undefined;
    if (mode === "false-small-length") body.ContentLength = 1;
    if (mode === "oversize-length") body.ContentLength = 101;
    if (mode === "truncated") body.ContentLength = pdf.length + 1;
    state.send.mockResolvedValue(mode === "unreadable" ? { Body: { transformToByteArray: vi.fn() } } : body);
    if (mode === "missing-length") expect(await storageGetRawBounded(key, 100)).toEqual(pdf);
    else await expect(storageGetRawBounded(key, mode === "false-small-length" ? pdf.length - 1 : 100)).rejects.toThrow();
    if (mode !== "unreadable") expect(destroy).toHaveBeenCalledOnce();
  });
});

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
}
const publicDraft = (extra = {}) => ({ id: 11, moduleId: 22, title: "Old open lesson save", attachmentKey: key, attachmentUrl: publicUrl(key), attachmentName: "Guide.pdf", embedPdf: true, ...extra });

// Actual route calls share an exclusive transaction fixture, distinct TX object,
// predicate-aware current rows, course-first locks and native prepared connection.
describe("course-row serialization closes stale lesson and phantom module writes", () => {
  it.each(["update", "insert"])("refuses late public %s after old-course request resumes behind conversion", async mode => {
    expect(course().isFirstClassTraining).toBe(false);
    const paused = gate(); const resume = gate();
    beforeTransaction = async () => { paused.release(); await resume.wait; };
    const stale = caller().saveLesson(publicDraft(mode === "insert" ? { id: undefined } : {}));
    const rejected = expect(stale).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await paused.wait;
    await caller().saveCourse(courseSave());
    const afterActivation = structuredClone(mock.tables);
    resume.release(); await rejected;
    expect(mock.tables).toEqual(afterActivation); expect(course().isFirstClassTraining).toBe(true);
    expect(lesson().attachmentUrl).toBe(academyPrivateAttachmentUrl(lesson().attachmentKey));
    expect(transactions).toBe(2); expect(locks[0]).toBe("academy_courses");
  });
  it.each(["none", "private"])("serializes %s-source activation before rejecting queued public creation", async mode => {
    Object.assign(lesson(), mode === "none" ? { attachmentKey: null, attachmentUrl: null, embedPdf: false } : { attachmentKey: privateKey, attachmentUrl: academyPrivateAttachmentUrl(privateKey) });
    if (mode === "private") mock.tables.staff_academy_uploads.push({ id: 9, userId: 90, courseId: 33, objectKey: privateKey, kind: "attachment" });
    const paused = gate(); const resume = gate();
    beforeTransaction = async () => { paused.release(); await resume.wait; };
    const stale = caller().saveLesson(publicDraft({ id: undefined })); const rejected = expect(stale).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await paused.wait; await caller().saveCourse(courseSave()); resume.release(); await rejected;
    expect(mock.tables.academy_lessons.filter(row => row.moduleId === 22)).toHaveLength(1); expect(commands).toEqual([]); expect(transactions).toBe(2);
  });
  it.each(["none", "private"])("%s-resource activation validates current locked resources rather than returning to a gap write", async mode => {
    Object.assign(lesson(), mode === "none" ? { attachmentKey: null, attachmentUrl: null } : { attachmentKey: privateKey, attachmentUrl: academyPrivateAttachmentUrl(privateKey) });
    if (mode === "private") mock.tables.staff_academy_uploads.push({ id: 9, userId: 90, courseId: 33, objectKey: privateKey, kind: "attachment" });
    beforeTransaction = async () => { Object.assign(lesson(), { attachmentKey: key, attachmentUrl: publicUrl(key) }); };
    await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(course().isFirstClassTraining).toBe(false); expect(mock.writes).toEqual([]); expect(commands).toEqual([]);
  });
  it("writes prepared lesson INSERT on the locked TX connection and conversion includes serialized creation", async () => {
    const saved = await caller().saveLesson(publicDraft({ id: undefined, videoTranscript: "  00:01 exact transcript\n" }));
    expect(saved.id).toBe(13); expect(locks.slice(0, 2)).toEqual(["academy_courses", "academy_modules"]);
    expect(mock.tables.academy_lessons.at(-1).videoTranscript).toBe("  00:01 exact transcript\n");
    await caller().saveCourse(courseSave());
    expect(mock.tables.academy_lessons.filter(row => row.moduleId === 22).every(row => row.attachmentUrl === academyPrivateAttachmentUrl(row.attachmentKey))).toBe(true);
    expect(commands.filter(command => command.operation === "put")).toHaveLength(1);
  });
  it("module creation waits for locked no-source activation and cannot bypass the course barrier", async () => {
    Object.assign(lesson(), { attachmentKey: null, attachmentUrl: null });
    const acquired = gate(); const release = gate(); let once = false;
    beforeLockedRead = async table => { if (table === "academy_courses" && !once) { once = true; acquired.release(); await release.wait; } };
    const activating = caller().saveCourse(courseSave()); await acquired.wait;
    let moduleSaved = false;
    const creating = caller().saveModule({ courseId: 33, title: "New module" }).then(value => { moduleSaved = true; return value; });
    await Promise.resolve(); expect(moduleSaved).toBe(false);
    release.release(); await activating; const created = await creating;
    await expect(caller().saveLesson(publicDraft({ id: undefined, moduleId: created.id }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mock.tables.academy_lessons.filter(row => row.moduleId === created.id)).toEqual([]);
  });
  it.each(["module", "lesson"])("refuses a changed %s parent at the locked write boundary", async mode => {
    beforeTransaction = async () => { if (mode === "module") mock.tables.academy_modules[0].courseId = 34; else lesson().moduleId = 23; };
    await expect(caller().saveLesson(publicDraft())).rejects.toMatchObject({ code: "CONFLICT" }); expect(mock.writes).toEqual([]);
  });
  it("rechecks private registry on TX even after early authorization was valid", async () => {
    Object.assign(course(), { isFirstClassTraining: true });
    mock.tables.staff_academy_uploads.push({ id: 9, userId: 90, courseId: 33, objectKey: privateKey, kind: "attachment" });
    beforeTransaction = async () => { mock.tables.staff_academy_uploads.at(-1).courseId = 34; };
    await expect(caller().saveLesson(publicDraft({ attachmentKey: privateKey, attachmentUrl: academyPrivateAttachmentUrl(privateKey) }))).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.writes).toEqual([]);
  });
  it.each(["none", "private"])("rolls back %s-source activation course payload when audit insertion fails", async mode => {
    Object.assign(lesson(), mode === "none" ? { attachmentKey: null, attachmentUrl: null } : { attachmentKey: privateKey, attachmentUrl: academyPrivateAttachmentUrl(privateKey) });
    if (mode === "private") mock.tables.staff_academy_uploads.push({ id: 9, userId: 90, courseId: 33, objectKey: privateKey, kind: "attachment" });
    failWriteTable = "academy_audit_log"; const before = structuredClone(mock.tables);
    await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); untouched(before);
  });
});

describe("conversion-scoped cancellation and finite overall preparation deadline", () => {
  it("passes shared conversion abort to every GET and encrypted PUT and preserves exact bytes", async () => {
    await caller().saveCourse(courseSave());
    expect(state.send.mock.calls.every(([, options]) => options.abortSignal instanceof AbortSignal)).toBe(true);
    expect(decryptPrivateStoragePayload(objects.get(lesson().attachmentKey)!)).toEqual(pdf);
  });
  it("aborts stalled encrypted PUT at overall deadline, settles, and never cuts DB", async () => {
    vi.useFakeTimers(); const pending = gate(); let aborted = false;
    const send = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (command: any, options: any) => {
      if (command.operation !== "put") return send(command, options);
      commands.push(command); pending.release();
      return new Promise((_resolve, reject) => options.abortSignal.addEventListener("abort", () => { aborted = true; reject(options.abortSignal.reason); }, { once: true }));
    });
    const before = structuredClone(mock.tables); const result = caller().saveCourse(courseSave()); const rejected = expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await pending.wait; await vi.advanceTimersByTimeAsync(FIRST_CLASS_CONVERSION_PREPARATION_MS); await rejected;
    expect(aborted).toBe(true); expect(transactions).toBe(0); untouched(before); expect(state.authenticate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("waits for provider that resolves after abort but refuses late readback/cutover", async () => {
    vi.useFakeTimers(); const pending = gate(); const late = gate(); const send = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (command: any, options: any) => { if (command.operation === "put") { pending.release(); await late.wait; } return send(command, options); });
    let done = false; const result = caller().saveCourse(courseSave()); const rejected = expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" }); result.catch(() => { done = true; });
    await pending.wait; await vi.advanceTimersByTimeAsync(FIRST_CLASS_CONVERSION_PREPARATION_MS + 1); expect(done).toBe(false);
    late.release(); await rejected; expect(commands.filter(command => command.operation === "get")).toHaveLength(1); expect(transactions).toBe(0); expect(mock.writes).toEqual([]);
  });
  it("first worker failure aborts in-flight reads and stops all new source workers", async () => {
    mock.tables.academy_lessons = Array.from({ length: 20 }, (_, index) => ({ ...lesson(), id: 100 + index, moduleId: 22, attachmentKey: `academy/90/${index}-guide.pdf`, attachmentUrl: publicUrl(`academy/90/${index}-guide.pdf`) }));
    const started = gate(); let active = 0; let aborted = 0; let first = true;
    state.send.mockImplementation(async (command: any, options: any) => {
      commands.push(command); active++;
      if (first) { first = false; await started.wait; active--; throw new Error("Synthetic failure"); }
      if (active === 3) started.release();
      return new Promise((_resolve, reject) => options.abortSignal.addEventListener("abort", () => { active--; aborted++; reject(options.abortSignal.reason); }, { once: true }));
    });
    await expect(caller().saveCourse(courseSave())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(commands).toHaveLength(3); expect(aborted).toBe(2); expect(active).toBe(0); expect(transactions).toBe(0); expect(mock.writes).toEqual([]);
  });
  it("100 individually bounded files cannot exceed the shared 120-second preparation budget", async () => {
    vi.useFakeTimers(); const started = gate(); const baseLesson = { ...lesson() };
    mock.tables.academy_lessons = Array.from({ length: 100 }, (_, index) => {
      const source = `academy/90/${index}-guide.pdf`; objects.set(source, pdf);
      return { ...baseLesson, id: 100 + index, attachmentKey: source, attachmentUrl: publicUrl(source) };
    });
    const send = state.send.getMockImplementation()!; let count = 0;
    state.send.mockImplementation(async (command: any, options: any) => {
      count++; started.release();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(options.abortSignal.reason); };
        const timer = setTimeout(() => { options.abortSignal.removeEventListener("abort", abort); resolve(); }, 20_000);
        options.abortSignal.addEventListener("abort", abort, { once: true });
      });
      return send(command, options);
    });
    const result = caller().saveCourse(courseSave()); const rejected = expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await started.wait; await vi.advanceTimersByTimeAsync(FIRST_CLASS_CONVERSION_PREPARATION_MS); await rejected;
    expect(count).toBeLessThan(30); expect(transactions).toBe(0); expect(mock.writes).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });
  it("raw GET has an independent <=30-second timeout and safely destroys a stalled body", async () => {
    vi.useFakeTimers(); const stalled = gate(); const body = { async *[Symbol.asyncIterator]() { await stalled.wait; }, destroy: vi.fn(() => stalled.release()) };
    state.send.mockResolvedValue({ Body: body });
    const result = storageGetRawBounded(key, 100); const rejected = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000); await rejected; expect(body.destroy).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("external abort destroys SDK body, removes listener, and refuses late bytes", async () => {
    const controller = new AbortController(); const stalled = gate(); const entered = gate();
    const body = { async *[Symbol.asyncIterator]() { entered.release(); await stalled.wait; yield pdf; }, destroy: vi.fn(() => stalled.release()) };
    const remove = vi.spyOn(controller.signal, "removeEventListener"); state.send.mockResolvedValue({ Body: body });
    const result = storageGetRawBounded(key, 100, controller.signal); const rejected = expect(result).rejects.toThrow("Offline cancel");
    await entered.wait; controller.abort(new Error("Offline cancel")); await rejected;
    expect(body.destroy).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
  it("already aborted GET/PUT signals never start SDK work; nonconversion encrypted PUT remains compatible", async () => {
    const controller = new AbortController(); controller.abort(new Error("Offline cancel"));
    await expect(storageGetRawBounded(key, 100, controller.signal)).rejects.toThrow("Offline cancel");
    await expect(storagePutEncrypted(privateKey, pdf, controller.signal)).rejects.toThrow("Offline cancel"); expect(state.send).not.toHaveBeenCalled();
    expect(await storagePutEncrypted(privateKey, pdf)).toEqual({ key: privateKey }); expect(decryptPrivateStoragePayload(objects.get(privateKey)!)).toEqual(pdf);
  });
});

describe("same-transaction compatibility and fail-closed auditing", () => {
  it("keeps explicit-column transcript-less prepared INSERT fallback on the locked TX connection", async () => {
    missingTranscript = true;
    await caller().saveLesson(publicDraft({ id: undefined, videoTranscript: null }));
    expect(preparedSql).toHaveLength(2); expect(preparedSql[0].query).toContain("videoTranscript"); expect(preparedSql[1].query).not.toContain("videoTranscript");
    expect(preparedSql[1].values).toHaveLength(20); expect(transactions).toBe(1); expect(locks.slice(0, 2)).toEqual(["academy_courses", "academy_modules"]);
  });
  it("does not discard a nonempty transcript on an unready column", async () => {
    missingTranscript = true; const before = structuredClone(mock.tables);
    await expect(caller().saveLesson(publicDraft({ id: undefined, videoTranscript: "00:00 exact text" }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(preparedSql).toHaveLength(1); untouched(before);
  });
  it("missing transaction adapter never falls back to raw/global pool", async () => {
    missingTransactionAdapter = true; const before = structuredClone(mock.tables);
    await expect(caller().saveLesson(publicDraft({ id: undefined }))).rejects.toThrow(); untouched(before);
  });
  it.each(["update", "insert"])("instructor %s audit failure prevents any lesson or academy audit mutation", async mode => {
    failWriteTable = "staff_access_audit"; const before = structuredClone(mock.tables);
    await expect(caller({ ...admin, role: "instructor" }).saveLesson({ id: mode === "update" ? 11 : undefined, moduleId: 22, title: "Safe instructor edit" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    untouched(before); expect(preparedSql).toEqual([]);
  });
  it("expiration during session revalidation cannot later start database cutover", async () => {
    vi.useFakeTimers(); const entered = gate(); const release = gate();
    state.authenticate.mockImplementation(async () => { entered.release(); await release.wait; return { ...admin }; });
    const result = caller().saveCourse(courseSave()); const rejected = expect(result).rejects.toThrow();
    await entered.wait; await vi.advanceTimersByTimeAsync(FIRST_CLASS_CONVERSION_PREPARATION_MS + 1); release.release(); await rejected;
    expect(transactions).toBe(0); expect(mock.writes).toEqual([]); expect(course().isFirstClassTraining).toBe(false);
  });
});
