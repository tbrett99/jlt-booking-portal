import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { TRPCError } from "@trpc/server";
import type { Express, Request, Response } from "express";
import type { BusinessStaffAuthority } from "./business-staff-access";
import type { User } from "../drizzle/schema";
import { academyMockDb } from "./academy-staff-test-db";

const external = vi.hoisted(() => ({ authenticate: vi.fn(), getDb: vi.fn(), storage: vi.fn(), authority: vi.fn(), requireCourse: vi.fn(), selfReview: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: external.authenticate } }));
vi.mock("./db", () => ({ getDb: external.getDb, getRawDbPool: () => { throw new Error("Real DB forbidden"); } }));
vi.mock("./storage", () => ({ storageGetDecrypted: external.storage }));
// Authority internals are exercised with the real helper in the boundary suite.
// This suite intentionally isolates HTTP registration and fresh authority order.
vi.mock("./business-staff-access", () => ({ getBusinessStaffAuthority: external.authority }));
vi.mock("./staff-access", () => ({
  isFullAdmin: (user: User) => ["admin", "super_admin"].includes(user.role),
  requireInstructorCourse: external.requireCourse, assertNotSelfReview: external.selfReview,
}));
import { createAcademyDocumentDownloadUrl, registerAcademyDocumentDownloadRoutes } from "./academy-document-download-routes";

const epoch = new Date("2026-01-01T00:00:00.000Z");
const jwtSecret = "synthetic-business-staff-document-jwt-secret";
const frozenNow = new Date("2026-11-17T12:00:00.000Z");
const bytes = Buffer.from("Synthetic private learning bytes, not real user data");
const objectKey = "synthetic/business-staff/resource";
function syntheticUser(overrides: Partial<User> = {}): User {
  return {
    id: 20, openId: "synthetic-staff", name: "Synthetic Staff", email: "staff@example.test", loginMethod: "test",
    role: "agent", isActive: true, tempPassword: "SYNTHETIC-HASH", mustChangePassword: false, phone: null,
    credentialsSentAt: null, portalStatus: "onboarding", crmAccess: false, crmEmail: null, commissionRatePct: 80,
    suspendedAt: null, suspensionReason: null, createdAt: epoch, updatedAt: epoch, lastSignedIn: epoch, ...overrides,
  };
}
function managed(overrides: Partial<BusinessStaffAuthority> = {}): BusinessStaffAuthority {
  return {
    managed: true, active: true, orbitReady: false, orbitNotice: "Synthetic scoped-only notice", owner: { id: 10, name: "Synthetic Owner", email: null },
    membership: { id: 50, ownerUserId: 10, staffUserId: 20, status: "active", revision: 1, orbitRequested: false,
      permissions: { viewBookings: true, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: true } }, ...overrides,
  };
}
const ordinary = (): BusinessStaffAuthority => ({ managed: false, active: false, membership: null, owner: null, orbitReady: false, orbitNotice: "Synthetic notice" });
function initialTables() {
  return {
    academy_modules: [{ id: 22, courseId: 33, title: "Synthetic module" }],
    academy_lessons: [{ id: 11, moduleId: 22, title: "Synthetic document lesson", archivedAt: null, assessmentMode: "document_upload",
      assessmentTemplateKey: "synthetic/template", assessmentTemplateName: "template.pdf", assessmentTemplateMimeType: "application/pdf",
      attachmentKey: objectKey, attachmentName: "resource.pdf" }],
    academy_enrollments: [{ id: 44, courseId: 33, agentId: 20, enrolledById: 99, status: "active" }],
    academy_access: [{ id: 55, agentId: 20, status: "active", grantedById: 99 }],
    academy_assessment_attempts: [{ id: 66, enrollmentId: 44, lessonId: 11, status: "submitted", answers: [],
      submissionFileKey: "synthetic/submission", submissionFileName: "submission.pdf", submissionMimeType: "application/pdf" }],
    staff_academy_uploads: [{ id: 77, userId: 90, courseId: 33, kind: "attachment", objectKey }],
  };
}
type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
let user: User | null;
let authority: BusinessStaffAuthority;
let db: ReturnType<typeof academyMockDb>;
let routes: Record<string, Handler>;
function responseFixture() {
  return {
    statusCode: 200, headersSent: false,
    status(code: number) { this.statusCode = code; return this; },
    end: vi.fn(), send: vi.fn(), json: vi.fn(), set: vi.fn(), setHeader: vi.fn(),
  };
}
async function invoke(path: string, params: Record<string, string>) {
  const response = responseFixture();
  await routes[path]({ params } as unknown as Request, response as unknown as Response);
  return response;
}
type Payload = Parameters<typeof createAcademyDocumentDownloadUrl>[0];
function mint(overrides: Partial<Payload> = {}) {
  const url = createAcademyDocumentDownloadUrl({ scope: "agent", userId: 20, enrollmentId: 44, lessonId: 11, kind: "template", ...overrides }, "https://synthetic.example.test");
  return url.slice(url.lastIndexOf("/") + 1);
}
const document = (token: string) => invoke("/api/academy/assessment-document/:token", { token });
const attachment = () => invoke("/api/academy/course-attachment/:objectKey", { objectKey });
function expectDenied(response: ReturnType<typeof responseFixture>) {
  expect(response.statusCode).toBe(404); expect(response.end).toHaveBeenCalledOnce(); expect(response.send).not.toHaveBeenCalled();
  expect(external.storage).not.toHaveBeenCalled();
}
function expectPrivateSuccess(response: ReturnType<typeof responseFixture>, name: string) {
  expect(response.statusCode).toBe(200); expect(response.send).toHaveBeenCalledWith(bytes);
  expect(response.set).toHaveBeenCalledWith(expect.objectContaining({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="${name}"` }));
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(frozenNow); vi.stubEnv("JWT_SECRET", jwtSecret);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected real network attempt forbidden"); }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  user = syntheticUser(); authority = managed(); db = academyMockDb(initialTables());
  external.authenticate.mockReset().mockImplementation(async () => user);
  external.authority.mockReset().mockImplementation(async () => authority);
  external.getDb.mockReset().mockImplementation(async () => db.db);
  external.storage.mockReset().mockResolvedValue(bytes);
  // A permissive synthetic instructor grant deliberately detects unwanted staff fallbacks.
  external.requireCourse.mockReset().mockResolvedValue(undefined); external.selfReview.mockReset().mockReturnValue(undefined);
  routes = {};
  registerAcademyDocumentDownloadRoutes({ get(path: string, handler: Handler) { routes[path] = handler; } } as unknown as Express);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("real Academy registration: current business staff authority before DB/storage", () => {
  it("captures the actual two registered callbacks without HTTP listeners", () => {
    expect(Object.keys(routes).sort()).toEqual(["/api/academy/assessment-document/:token", "/api/academy/course-attachment/:objectKey"]);
  });
  it.each(["template", "submission"] as const)("uses a deterministically signed exact %s token bound to the current individual learner", async kind => {
    const payload: Payload = { scope: "agent", userId: 20, enrollmentId: 44, lessonId: 11, kind, ...(kind === "submission" ? { attemptId: 66 } : {}) };
    const token = mint(payload);
    const encoded = Buffer.from(JSON.stringify({ ...payload, version: 1, expiresAt: frozenNow.getTime() + 5 * 60 * 1000 })).toString("base64url");
    const exactFixture = `${encoded}.${createHmac("sha256", jwtSecret).update(encoded).digest("base64url")}`;
    expect(token).toBe(exactFixture);
    expectPrivateSuccess(await document(token), `${kind}.pdf`);
    expect(external.authority).toHaveBeenCalledWith(user);
    expect(external.authority.mock.invocationCallOrder[0]).toBeLessThan(external.getDb.mock.invocationCallOrder[0]);
    expect(external.getDb.mock.invocationCallOrder[0]).toBeLessThan(external.storage.mock.invocationCallOrder[0]);
    expect(external.requireCourse).not.toHaveBeenCalled(); expect(external.selfReview).not.toHaveBeenCalled(); expect(db.writes).toEqual([]);
  });
  it.each(["permission", "revocation", "owner-ineligible"])("an exact already-minted token is denied after fresh %s change in the same session", async change => {
    const token = mint(); const sameUser = user;
    expectPrivateSuccess(await document(token), "template.pdf");
    if (change === "permission") authority.membership!.permissions.academyAccess = false;
    else { authority.active = false; if (change === "revocation") authority.membership!.status = "revoked"; }
    external.getDb.mockClear(); external.storage.mockClear(); db.reads.length = 0;
    expectDenied(await document(token));
    expect(user).toBe(sameUser); expect(external.authority).toHaveBeenCalledTimes(2); expect(external.getDb).not.toHaveBeenCalled(); expect(db.reads).toEqual([]);
  });
  it.each(["revoked", "permission", "missing-membership"])("attachment denies %s staff authority before getDb or storage", async change => {
    if (change === "revoked") authority = managed({ active: false, membership: { ...authority.membership!, status: "revoked" } });
    if (change === "permission") authority.membership!.permissions.academyAccess = false;
    if (change === "missing-membership") authority.membership = null;
    expectDenied(await attachment()); expect(external.authority).toHaveBeenCalledWith(user); expect(external.getDb).not.toHaveBeenCalled(); expect(db.reads).toEqual([]);
    expect(external.requireCourse).not.toHaveBeenCalled();
  });
  it.each(["document", "attachment"])("unknown authority/schema safely denies %s without DB/storage or secret leakage", async route => {
    external.authority.mockRejectedValue(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Business staff access could not be verified." }));
    const response = route === "document" ? await document(mint()) : await attachment();
    expect(response.statusCode).toBe(500); expect(response.send).toHaveBeenCalledWith(route === "document" ? "Assessment document could not be downloaded" : "Academy resource could not be downloaded");
    expect(external.getDb).not.toHaveBeenCalled(); expect(external.storage).not.toHaveBeenCalled(); expect(db.reads).toEqual([]);
  });
  it("managed staff cannot promote a learner token to staff scope even with a permissive instructor grant", async () => {
    expectDenied(await document(mint({ scope: "staff", userId: 20, kind: "submission", attemptId: 66 })));
    expect(external.getDb).not.toHaveBeenCalled(); expect(external.requireCourse).not.toHaveBeenCalled(); expect(external.selfReview).not.toHaveBeenCalled();
  });
  it("managed staff cannot use owner/another learner token or mismatched enrollment despite a valid signature", async () => {
    for (const id of [10, 99]) { expectDenied(await document(mint({ userId: id }))); expect(external.getDb).not.toHaveBeenCalled(); }
    db.tables.academy_enrollments[0].agentId = 10;
    expectDenied(await document(mint())); expect(external.requireCourse).not.toHaveBeenCalled();
  });
  it("managed staff requires current individual Academy access and an unarchived document lesson", async () => {
    db.tables.academy_access[0].status = "revoked"; expectDenied(await document(mint()));
    db.tables.academy_access[0].status = "active"; db.tables.academy_lessons[0].archivedAt = epoch; expectDenied(await document(mint()));
    expect(external.requireCourse).not.toHaveBeenCalled();
  });
  it("managed attachment succeeds only through the current user's active personal enrollment, never an instructor grant", async () => {
    expectPrivateSuccess(await attachment(), "resource.pdf"); expect(external.storage).toHaveBeenCalledWith(objectKey);
    expect(external.requireCourse).not.toHaveBeenCalled(); expect(external.authority.mock.invocationCallOrder[0]).toBeLessThan(external.getDb.mock.invocationCallOrder[0]);
  });
  it.each(["owner-enrollment", "no-enrollment", "revoked-academy", "archived-lesson"])("managed attachment rejects %s without falling back to staff scope", async change => {
    if (change === "owner-enrollment") db.tables.academy_enrollments[0].agentId = 10;
    if (change === "no-enrollment") db.tables.academy_enrollments.length = 0;
    if (change === "revoked-academy") db.tables.academy_access[0].status = "revoked";
    if (change === "archived-lesson") db.tables.academy_lessons[0].archivedAt = epoch;
    expectDenied(await attachment()); expect(external.requireCourse).not.toHaveBeenCalled(); expect(db.writes).toEqual([]);
  });
  it("ordinary learner and separately scoped instructor legacy paths remain functional", async () => {
    authority = ordinary(); expectPrivateSuccess(await document(mint()), "template.pdf"); expectPrivateSuccess(await attachment(), "resource.pdf");
    user = syntheticUser({ id: 90, portalStatus: "active" });
    expectPrivateSuccess(await document(mint({ scope: "staff", userId: 90, kind: "submission", attemptId: 66 })), "submission.pdf");
    expect(external.requireCourse).toHaveBeenCalledWith(user, 33); expect(external.selfReview).toHaveBeenCalledWith(user, 20);
  });
  it("tampered and expired exact tokens cannot reach authority, DB or private storage", async () => {
    const token = mint(); const [encoded, signature] = token.split(".");
    const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")), userId: 10 })).toString("base64url");
    expectDenied(await document(`${altered}.${signature}`)); vi.advanceTimersByTime(5 * 60 * 1000 + 1); expectDenied(await document(token));
    expect(external.authority).not.toHaveBeenCalled(); expect(external.getDb).not.toHaveBeenCalled();
  });
});

// Extract the actual index.ts callback with the TypeScript AST. Never import the
// entrypoint: doing so would start services. Only dynamic dependency imports are
// substituted; guards, ordering, key validation and response logic are unchanged.
function actualLegacyProxy(): Handler {
  const source = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let callback: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "get" &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "/api/doc-proxy" &&
      node.arguments[1] && ts.isArrowFunction(node.arguments[1])) callback = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!callback) throw new Error("Actual legacy document proxy callback missing");
  const bindings = callback.getText(tree).replace('await import("./sdk")', "deps.sdk").replace('await import("../business-staff-access")', "deps.authority");
  const script = ts.transpileModule(`const callback = ${bindings};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("deps", `${script}return callback;`)({ sdk: { sdk: { authenticateRequest: external.authenticate } }, authority: { getBusinessStaffAuthority: external.authority } }) as Handler;
}
async function proxy(query: Record<string, unknown> = { key: "synthetic/owner-document.pdf" }) {
  const response = responseFixture();
  await actualLegacyProxy()({ query } as unknown as Request, response as unknown as Response);
  return response;
}
describe("actual AST-extracted legacy /api/doc-proxy HTTP callback", () => {
  it.each(["active", "revoked"])("%s managed staff gets 403 before key access or upstream fetch", async status => {
    authority = managed({ active: status === "active", membership: { ...authority.membership!, status: status as "active" | "revoked" } });
    const query = Object.defineProperty({}, "key", { get() { throw new Error("Key must not be examined before staff denial"); } });
    const response = await proxy(query);
    expect(response.statusCode).toBe(403); expect(response.json).toHaveBeenCalledWith({ error: "Business staff cannot use the legacy document proxy." });
    expect(external.authority).toHaveBeenCalledWith(user); expect(fetch).not.toHaveBeenCalled(); expect(external.getDb).not.toHaveBeenCalled(); expect(external.storage).not.toHaveBeenCalled();
  });
  it("unknown schema/storage authority produces only safe 500 and cannot fetch even a valid old key", async () => {
    external.authority.mockRejectedValue(new Error("ER_NO_SUCH_TABLE SELECT business_staff_memberships mysql-password=SYNTHETIC-SECRET"));
    const response = await proxy(); expect(response.statusCode).toBe(500); expect(response.json).toHaveBeenCalledWith({ error: "Error loading document" });
    expect(JSON.stringify(response.json.mock.calls)).not.toMatch(/SELECT|mysql|password|SYNTHETIC-SECRET/); expect(fetch).not.toHaveBeenCalled();
  });
  it("unauthenticated requests still receive 401 before authority or fetch", async () => {
    user = null; const response = await proxy(); expect(response.statusCode).toBe(401); expect(response.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(external.authority).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([undefined, "../synthetic-secret", ["synthetic-file"]])("ordinary invalid key %j preserves 400 without fetch", async key => {
    authority = ordinary(); const response = await proxy({ key }); expect(response.statusCode).toBe(400); expect(response.json).toHaveBeenCalledWith({ error: "Invalid key" }); expect(fetch).not.toHaveBeenCalled();
  });
  it("ordinary authenticated legacy proxy still returns the mocked upstream bytes and original private headers", async () => {
    authority = ordinary(); vi.stubEnv("BUILT_IN_FORGE_API_KEY", "synthetic-api-key-not-live");
    const fetchMock = vi.mocked(fetch); fetchMock.mockResolvedValue(new globalThis.Response(bytes, { status: 200, headers: { "content-type": "application/pdf" } }));
    const response = await proxy({ key: "/synthetic/ordinary-file.pdf" });
    expect(response.statusCode).toBe(200); expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("https://d2xsxph8kpxj0f.cloudfront.net/310419663026820811/PdcDVQRp8zC2FzsyWBWptW/synthetic/ordinary-file.pdf", { headers: { "X-Api-Key": "synthetic-api-key-not-live" } });
    expect(response.end).toHaveBeenCalledWith(bytes); expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(response.setHeader).toHaveBeenCalledWith("Content-Disposition", 'inline; filename="ordinary-file.pdf"'); expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, max-age=300");
    expect(response.setHeader).toHaveBeenCalledWith("Content-Length", bytes.length);
  });
  it("ordinary upstream errors retain the old status while using only a mocked fetch", async () => {
    authority = ordinary(); vi.mocked(fetch).mockResolvedValue(new globalThis.Response(null, { status: 404 }));
    const response = await proxy(); expect(response.statusCode).toBe(404); expect(response.json).toHaveBeenCalledWith({ error: "Could not retrieve document" }); expect(response.end).not.toHaveBeenCalled();
  });
});
