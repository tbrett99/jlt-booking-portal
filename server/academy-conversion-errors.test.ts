import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { academyMockDb } from "./academy-staff-test-db";
import { router } from "./_core/trpc";

const state = vi.hoisted(() => ({ db: null as any, authenticate: vi.fn(), send: vi.fn(), email: vi.fn(), notify: vi.fn(), external: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = state.send; },
  GetObjectCommand: class { operation = "get"; constructor(public input: any) {} },
  PutObjectCommand: class { operation = "put"; constructor(public input: any) {} },
}));
vi.mock("./db", () => ({ getDb: async () => state.db, getRawDbPool: async () => { throw new Error("No real DB access"); }, createInAppNotification: state.notify, getUpcomingAgentEvents: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: state.authenticate } }));
vi.mock("./email", () => ({ sendDirectEmail: state.email, sendSupportEmail: state.email }));
vi.mock("./agent-development-router", () => ({ assignAcceleratorEntryActions: vi.fn(), releaseAvailableJourneyActions: vi.fn() }));
vi.mock("./academy-email-alerts", () => ({ ACADEMY_ALERT_EVENTS: [], academyAlertAllowsModuleScope: vi.fn(), academyAlertTemplateHint: vi.fn(), dispatchAcademyEmailAlerts: state.email, hasActiveAcademySupportAlert: vi.fn() }));
vi.mock("./staff-access", () => ({ isFullAdmin: (user: any) => ["admin", "super_admin"].includes(user.role), requireInstructorCourse: async () => {}, getInstructorCourseIds: async () => [33], assertNotSelfReview: vi.fn(), recordStaffOperation: vi.fn() }));
vi.mock("./business-staff-access", () => ({ getBusinessStaffAuthority: async () => ({ managed: false }), assertBusinessStaffRouteAllowed: vi.fn() }));
import { academyRouter } from "./academy-router";
import { MAX_ACADEMY_DOCUMENT_BYTES } from "./academy-document-assessment";
import { FIRST_CLASS_CONVERSION_PREPARATION_MS } from "./academy-first-class-conversion";
import { StorageReadError, encryptPrivateStoragePayload, storageGetRawBounded } from "./storage";
import { classifyAcademyConversionError } from "./academy-conversion-errors";

const routes = router({ academy: academyRouter });
const admin = { id: 99, role: "admin", isActive: true, portalStatus: "active", openId: "offline-admin" };
const key = "academy/90/1699999999999-guide.pdf";
const otherKey = "academy/90/1699999999998-second.pdf";
const pdf = Buffer.from("%PDF-1.7\nSynthetic diagnostic test bytes\n%%EOF");
const secret = "SENTINEL-SECRET-NEVER-ECHO";
const rawMessage = `https://provider.example.test/${secret}?access_key=${secret} object=${key}`;
const providerError = (name = "Error", status?: number, code?: string) => Object.assign(new Error(rawMessage), { name, code, $metadata: { httpStatusCode: status }, stack: `RAW-STACK-${secret}` });
let mock: ReturnType<typeof academyMockDb>;
let objects: Map<string, Buffer>;
let log: ReturnType<typeof vi.spyOn>;
const stream = (bytes: Buffer, length: number | undefined = bytes.length) => ({ ContentLength: length, Body: { async *[Symbol.asyncIterator]() { yield bytes; }, destroy: vi.fn() } });
const save = () => routes.createCaller({ user: admin, req: { headers: { cookie: `SESSION-${secret}`, "x-request-id": rawMessage } }, res: {} } as any).academy.admin.saveCourse({ id: 33, title: "Saved", isFirstClassTraining: true });
function gate() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; }

beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries({ JWT_SECRET: "synthetic-only", S3_ENDPOINT: "https://offline.example.test", S3_ACCESS_KEY_ID: "offline", S3_SECRET_ACCESS_KEY: "offline", S3_BUCKET: "offline", S3_PUBLIC_URL: "https://storage.example.test" })) vi.stubEnv(name, value);
  state.external.mockImplementation(() => { throw new Error("No network"); }); vi.stubGlobal("fetch", state.external);
  state.authenticate.mockResolvedValue({ ...admin });
  mock = academyMockDb({
    academy_courses: [{ id: 33, title: "Original", isCoreAcademy: false, isAcceleratorJourney: false, isFirstClassTraining: false, updatedById: 90 }],
    academy_modules: [{ id: 22, courseId: 33 }],
    academy_lessons: [{ id: 11, moduleId: 22, title: "Original lesson", attachmentKey: key, attachmentUrl: `https://storage.example.test/${key}`, attachmentName: "Stage4Validate-Reviews.pdf", embedPdf: true }],
    staff_academy_uploads: [], users: [{ ...admin }], academy_audit_log: [],
    academy_enrollments: [{ id: 44, courseId: 33, status: "completed" }],
    academy_lesson_progress: [{ id: 45, lessonId: 11, status: "completed" }],
    academy_assessment_attempts: [{ id: 46, responseText: "Synthetic evidence unchanged" }],
  });
  state.db = mock.db; objects = new Map([[key, pdf], [otherKey, pdf]]);
  state.send.mockImplementation(async (command: any) => {
    expect(mock.locks).toEqual([]);
    if (command.operation === "put") { objects.set(command.input.Key, Buffer.from(command.input.Body)); return {}; }
    const bytes = objects.get(command.input.Key); if (!bytes) throw providerError("NoSuchKey", 404);
    return stream(bytes);
  });
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  expect(state.external).not.toHaveBeenCalled(); expect(state.email).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret); expect(JSON.stringify(log.mock.calls)).not.toContain(key);
  log.mockRestore(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers();
});

async function assertFailure(code: string, stage: string, reason: string, before = structuredClone(mock.tables), result = save()) {
  const error = await result.catch(error => error);
  expect(error).toBeInstanceOf(TRPCError);
  expect(error).toMatchObject({ code: "BAD_REQUEST", message: `Cannot make resource “Stage4Validate-Reviews.pdf” private: ${reason}. No course changes were saved.` });
  expect(error.cause).toBeUndefined(); expect(error.message).not.toContain(secret); expect(error.message).not.toContain(key); expect(error.message).not.toContain("https://");
  expect(log.mock.calls).toEqual([["[AcademyConversion]", { code, stage, courseId: 33, lessonId: 11 }]]);
  expect(mock.tables).toEqual(before); expect(mock.writes).toEqual([]); expect(mock.locks).toEqual([]); expect(state.authenticate).not.toHaveBeenCalled();
}

describe("actual offline course-save diagnostic stages without API or log secrets", () => {
  it.each([
    ["NoSuchKey", 404, "missing_file", "the original file could not be found in storage"],
    ["AccessDenied", 403, "permission_denied", "storage denied permission to read the original file"],
    ["UnknownProviderError", 404, "missing_file", "the original file could not be found in storage"],
    ["UnknownProviderError", 403, "permission_denied", "storage denied permission to read the original file"],
    ["RequestTimeout", undefined, "timeout", "reading the original file timed out"],
    ["AbortError", undefined, "cancelled", "resource preparation was cancelled"],
    ["Error", undefined, "source_read_failed", "the original file could not be read from storage"],
    ["NoSuchKey-with-untrusted-suffix", undefined, "source_read_failed", "the original file could not be read from storage"],
  ])("safely classifies source SDK exception %s / %s", async (name, status, code, reason) => {
    state.send.mockRejectedValue(providerError(String(name), status as number | undefined));
    await assertFailure(String(code), "source_read", String(reason));
  });
  it.each(["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"])("preflights missing %s without provider access", async env => {
    vi.stubEnv(env, ""); await assertFailure("storage_unconfigured", "source_read", "server document storage is not configured; contact support"); expect(state.send).not.toHaveBeenCalled();
  });
  it("reports missing JWT as private encryption configuration without writing", async () => {
    vi.stubEnv("JWT_SECRET", ""); await assertFailure("private_key_unconfigured", "encrypted_write", "private storage encryption is not configured on this server; contact support"); expect(state.send.mock.calls.map(([command]) => command.operation)).toEqual(["get"]);
  });
  it.each(["permission", "missing", "config", "unknown"])("distinguishes encrypted write %s from source read", async mode => {
    const send = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (command: any) => {
      if (command.operation === "put") throw providerError(mode === "permission" ? "AccessDenied" : mode === "missing" ? "NotFound" : "Error", mode === "permission" ? 403 : mode === "missing" ? 404 : undefined);
      const response = await send(command);
      if (mode === "config") vi.stubEnv("S3_BUCKET", "");
      return response;
    });
    await assertFailure(mode === "permission" ? "permission_denied" : mode === "missing" ? "missing_file" : mode === "config" ? "storage_unconfigured" : "write_failed", "encrypted_write", mode === "permission" ? "storage denied permission to write the private copy" : mode === "missing" ? "storage could not find the destination for the private copy" : mode === "config" ? "server document storage is not configured; contact support" : "the encrypted private copy could not be written to storage");
  });
  it("diagnoses invalid PDF header, not an ambiguous copy failure", async () => {
    objects.set(key, Buffer.from("not a PDF")); await assertFailure("invalid_pdf", "validate", "the original file does not have a valid PDF header"); expect(state.send).toHaveBeenCalledOnce();
  });
  it.each([
    ["oversize-metadata", "oversize", "the original file exceeds the 10 MB limit"],
    ["oversize-stream", "oversize", "the original file exceeds the 10 MB limit"],
    ["empty", "empty", "the original file is empty"],
    ["truncated", "truncated", "storage returned an incomplete original file"],
    ["unreadable", "unreadable", "storage returned no readable original file"],
    ["invalid-chunk", "invalid_chunk", "storage returned invalid original-file bytes"],
    ["invalid-metadata", "invalid_metadata", "storage returned invalid original-file size metadata"],
    ["body-permission", "permission_denied", "storage denied permission to read the original file"],
    ["body-error", "source_read_failed", "the original file could not be read from storage"],
  ])("classifies bounded source response %s", async (mode, code, reason) => {
    state.send.mockResolvedValue(mode === "oversize-metadata" ? stream(pdf, MAX_ACADEMY_DOCUMENT_BYTES + 1)
      : mode === "oversize-stream" ? stream(Buffer.alloc(MAX_ACADEMY_DOCUMENT_BYTES + 1), 1)
      : mode === "empty" ? stream(Buffer.alloc(0))
      : mode === "truncated" ? stream(pdf, pdf.length + 1)
      : mode === "unreadable" ? { Body: { transformToByteArray: vi.fn() } }
      : mode === "invalid-metadata" ? stream(pdf, -1)
      : { Body: { async *[Symbol.asyncIterator]() { if (mode === "invalid-chunk") yield "invalid"; else throw providerError(mode === "body-permission" ? "AccessDenied" : "Error", mode === "body-permission" ? 403 : undefined); }, destroy: vi.fn() } });
    await assertFailure(code, "source_read", reason);
  });
  it.each(["missing", "permission", "timeout", "empty", "truncated", "body-permission", "body-error"])("labels private-copy GET %s as readback, not source", async mode => {
    const send = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (command: any) => {
      if (command.operation === "get" && command.input.Key !== key) {
        if (mode === "empty") return stream(Buffer.alloc(0));
        if (mode === "truncated") return stream(Buffer.from("JLT-A1"), pdf.length + 34);
        if (mode.startsWith("body")) return { Body: { async *[Symbol.asyncIterator]() { throw providerError(mode === "body-permission" ? "AccessDenied" : "Error", mode === "body-permission" ? 403 : undefined); }, destroy: vi.fn() } };
        throw providerError(mode === "missing" ? "NoSuchKey" : mode === "permission" ? "AccessDenied" : "TimeoutError");
      }
      return send(command);
    });
    const expected: Record<string, [string, string]> = {
      missing: ["missing_file", "the private copy could not be found for verification"], permission: ["permission_denied", "storage denied permission to read back the private copy"],
      timeout: ["timeout", "reading back the private copy timed out"], empty: ["empty", "storage returned an empty private copy"], truncated: ["truncated", "storage returned an incomplete private copy"],
      "body-permission": ["permission_denied", "storage denied permission to read back the private copy"], "body-error": ["readback_read_failed", "the private copy could not be read back from storage"],
    };
    await assertFailure(expected[mode][0], "readback_read", expected[mode][1]);
  });
  it.each(["bad-header", "tamper", "same-length-different-plaintext"])("verifies exact-byte readback %s after successful encrypted write", async mode => {
    const send = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (command: any) => {
      if (command.operation === "get" && command.input.Key !== key) {
        const payload = Buffer.from(objects.get(command.input.Key)!);
        if (mode === "bad-header") payload[0] ^= 1;
        if (mode === "tamper") payload[payload.length - 1] ^= 1;
        if (mode === "same-length-different-plaintext") { const changed = Buffer.from(pdf); changed[12] ^= 1; return stream(encryptPrivateStoragePayload(changed)); }
        return stream(payload);
      }
      return send(command);
    });
    await assertFailure(mode === "same-length-different-plaintext" ? "verification_failed" : "decrypt_failed", mode === "same-length-different-plaintext" ? "readback_verify" : "readback_decrypt", mode === "same-length-different-plaintext" ? "the private copy did not match the original file bytes" : "the private copy could not be decrypted and authenticated");
  });
  it("treats a stalled source GET as 30-second timeout, not overall deadline", async () => {
    vi.useFakeTimers(); const entered = gate(); const stalled = gate();
    const body = { async *[Symbol.asyncIterator]() { entered.release(); await stalled.wait; }, destroy: vi.fn(() => stalled.release()) };
    state.send.mockResolvedValue({ Body: body });
    const result = save(); const rejected = assertFailure("timeout", "source_read", "reading the original file timed out", structuredClone(mock.tables), result);
    await entered.wait; await vi.advanceTimersByTimeAsync(30_000); await rejected;
    expect(body.destroy).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("treats stalled encrypted write as the shared 120-second deadline", async () => {
    vi.useFakeTimers(); const entered = gate(); const send = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (command: any, options: any) => {
      if (command.operation !== "put") return send(command);
      entered.release(); return new Promise((_resolve, reject) => options.abortSignal.addEventListener("abort", () => reject(providerError("AbortError")), { once: true }));
    });
    const result = save(); const rejected = assertFailure("deadline_exceeded", "encrypted_write", "resource preparation exceeded the 120-second save limit", structuredClone(mock.tables), result);
    await entered.wait; await vi.advanceTimersByTimeAsync(FIRST_CLASS_CONVERSION_PREPARATION_MS); await rejected; expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps primary NoSuchKey even when another worker later rejects on cancellation", async () => {
    mock.tables.academy_lessons.push({ ...mock.tables.academy_lessons[0], id: 13, attachmentKey: otherKey, attachmentUrl: `https://storage.example.test/${otherKey}`, attachmentName: "Second.pdf" });
    const started = gate(); let cancelled = false;
    state.send.mockImplementation(async (command: any, options: any) => {
      if (command.input.Key === key) { await started.wait; throw providerError("NoSuchKey", 404); }
      started.release(); return new Promise((_resolve, reject) => options.abortSignal.addEventListener("abort", () => { cancelled = true; reject(providerError("AbortError")); }, { once: true }));
    });
    await assertFailure("missing_file", "source_read", "the original file could not be found in storage"); expect(cancelled).toBe(true); expect(state.send).toHaveBeenCalledTimes(2);
  });
});

describe("closed diagnostic error contracts", () => {
  it("wraps provider exceptions as categorized storage read errors without raw cause", async () => {
    state.send.mockRejectedValue(providerError("NoSuchKey", 404)); const error = await storageGetRawBounded(key, 100).catch(error => error);
    expect(error).toBeInstanceOf(StorageReadError); expect(error.category).toBe("missing_file"); expect(error.message).not.toContain(secret); expect(error.cause).toBeUndefined(); expect(error.stack).not.toContain(secret);
  });
  it("does not infer provider failures from messages, arbitrary codes or similar names", () => {
    expect(classifyAcademyConversionError(providerError("Error"), "source_read")).toBe("source_read_failed");
    expect(classifyAcademyConversionError(providerError("AccessDeniedExtra", undefined, "AccessDenied"), "encrypted_write")).toBe("write_failed");
    expect(classifyAcademyConversionError(providerError("Error", undefined, "ETIMEDOUT"), "source_read")).toBe("timeout");
  });
});
