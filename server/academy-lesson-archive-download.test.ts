import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Express, Request, Response } from "express";
import {
  academyAccess,
  academyAssessmentAttempts,
  academyEnrollments,
  academyLessons,
  academyModules,
  staffAcademyUploads,
  type User,
} from "../drizzle/schema";
import { academyMockDb } from "./academy-staff-test-db";

type SyntheticUser = Pick<User, "id" | "role" | "isActive" | "portalStatus"> & {
  isInstructor?: boolean;
};
const external = vi.hoisted(() => ({
  db: null as ReturnType<typeof academyMockDb>["db"] | null,
  user: null as SyntheticUser | null,
  grants: [] as number[],
  authenticate: vi.fn(),
  getDb: vi.fn(),
  storage: vi.fn(),
  requireCourse: vi.fn(),
  selfReview: vi.fn(),
}));
vi.mock("./db", () => ({
  getDb: external.getDb,
  getRawDbPool: vi.fn(() => {
    throw new Error("Live database access is forbidden in this suite");
  }),
}));
vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: external.authenticate },
}));
vi.mock("./storage", () => ({ storageGetDecrypted: external.storage }));
vi.mock("./staff-access", () => ({
  isFullAdmin: (user: SyntheticUser) =>
    ["admin", "super_admin"].includes(user.role),
  requireInstructorCourse: external.requireCourse,
  assertNotSelfReview: external.selfReview,
}));
import {
  createAcademyDocumentDownloadUrl,
  registerAcademyDocumentDownloadRoutes,
} from "./academy-document-download-routes";

type Tables = {
  academy_modules: (typeof academyModules.$inferInsert)[];
  academy_lessons: (typeof academyLessons.$inferInsert)[];
  academy_enrollments: (typeof academyEnrollments.$inferInsert)[];
  academy_access: (typeof academyAccess.$inferInsert)[];
  academy_assessment_attempts: (typeof academyAssessmentAttempts.$inferInsert)[];
  staff_academy_uploads: (typeof staffAcademyUploads.$inferInsert)[];
};
const learner: SyntheticUser = {
  id: 10,
  role: "agent",
  isActive: true,
  portalStatus: "active",
};
const instructor: SyntheticUser = { ...learner, id: 90, isInstructor: true };
const archivedAt = new Date("2026-10-01T12:00:00.000Z");
const plaintext = Buffer.from("Synthetic private assessment bytes");
const attachmentKey = "synthetic/private-resource";
function initialTables(): Tables {
  return {
    academy_modules: [
      { id: 22, courseId: 33, title: "Synthetic module" },
      { id: 23, courseId: 34, title: "Other course" },
    ],
    academy_lessons: [
      {
        id: 11,
        moduleId: 22,
        title: "Document lesson",
        archivedAt: null,
        assessmentMode: "document_upload",
        assessmentTemplateKey: "synthetic/current-template",
        assessmentTemplateName: "current.pdf",
        assessmentTemplateMimeType: "application/pdf",
        attachmentKey,
        attachmentName: "lesson-resource.pdf",
      },
    ],
    academy_enrollments: [
      {
        id: 44,
        courseId: 33,
        agentId: 10,
        enrolledById: 99,
        status: "completed",
        completedAt: archivedAt,
      },
    ],
    academy_access: [
      { id: 55, agentId: 10, status: "active", grantedById: 99 },
    ],
    academy_assessment_attempts: [
      {
        id: 66,
        enrollmentId: 44,
        lessonId: 11,
        status: "feedback_acknowledged",
        score: 95,
        passed: true,
        answers: [],
        feedbackAcknowledgedAt: archivedAt,
        assessmentTemplateKey: "synthetic/historic-template",
        assessmentTemplateName: "historic-template.pdf",
        assessmentTemplateMimeType: "application/pdf",
        submissionFileKey: "synthetic/submitted-file",
        submissionFileName: "submitted-work.pdf",
        submissionMimeType: "application/pdf",
      },
    ],
    staff_academy_uploads: [
      {
        id: 77,
        userId: 90,
        courseId: 33,
        kind: "attachment",
        objectKey: attachmentKey,
      },
    ],
  };
}
// Capture the callbacks passed to Express registration, then invoke those real
// production handlers directly: no HTTP listener, network, database or storage.
type DownloadHandler = (req: Request, res: Response) => void | Promise<void>;
let routes: Record<string, DownloadHandler>;
let mock: ReturnType<typeof academyMockDb>;
function responseFixture() {
  return {
    headersSent: false,
    statusCode: 0,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    end: vi.fn(),
    send: vi.fn(),
    set: vi.fn(),
  };
}
async function invoke(path: string, params: Record<string, string>) {
  const res = responseFixture();
  await routes[path](
    { params } as unknown as Request,
    res as unknown as Response
  );
  return res;
}
type Payload = Parameters<typeof createAcademyDocumentDownloadUrl>[0];
function mint(overrides: Partial<Payload> = {}) {
  const url = createAcademyDocumentDownloadUrl(
    {
      scope: "agent",
      userId: 10,
      enrollmentId: 44,
      lessonId: 11,
      kind: "template",
      ...overrides,
    },
    "https://synthetic.example.test"
  );
  return url.slice(url.lastIndexOf("/") + 1);
}
const document = (token: string) =>
  invoke("/api/academy/assessment-document/:token", { token });
const attachment = () =>
  invoke("/api/academy/course-attachment/:objectKey", {
    objectKey: attachmentKey,
  });
function expectPrivateSuccess(
  res: ReturnType<typeof responseFixture>,
  name: string
) {
  expect(res.statusCode).toBe(200);
  expect(res.send).toHaveBeenCalledWith(plaintext);
  expect(res.set).toHaveBeenCalledWith(
    expect.objectContaining({
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="${name}"`,
    })
  );
}
function expectDenied(res: ReturnType<typeof responseFixture>) {
  expect(res.statusCode).toBe(404);
  expect(res.end).toHaveBeenCalledOnce();
  expect(res.send).not.toHaveBeenCalled();
  expect(external.storage).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JWT_SECRET", "synthetic-test-only-archive-download-secret");
  external.user = learner;
  external.grants = [];
  external.authenticate
    .mockReset()
    .mockImplementation(async () => external.user);
  external.getDb.mockReset().mockImplementation(async () => external.db);
  external.storage.mockReset().mockResolvedValue(plaintext);
  external.requireCourse
    .mockReset()
    .mockImplementation(async (user: SyntheticUser, courseId: number) => {
      if (
        !["admin", "super_admin"].includes(user.role) &&
        !external.grants.includes(courseId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Synthetic course grant required",
        });
      }
    });
  external.selfReview
    .mockReset()
    .mockImplementation((user: SyntheticUser, learnerId: number) => {
      if (
        !["admin", "super_admin"].includes(user.role) &&
        user.id === learnerId
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Synthetic self review denied",
        });
      }
    });
  mock = academyMockDb(initialTables());
  external.db = mock.db;
  routes = {};
  registerAcademyDocumentDownloadRoutes({
    get(path: string, handler: DownloadHandler) {
      routes[path] = handler;
    },
  } as unknown as Express);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("archived assessment download tokens recheck current lesson visibility", () => {
  it.each(["template", "submission"] as const)(
    "previously minted learner %s token becomes 404 before storage when lesson is archived",
    async kind => {
      const token = mint({
        kind,
        ...(kind === "submission" ? { attemptId: 66 } : {}),
      });
      mock.tables.academy_lessons[0].archivedAt = archivedAt;
      expectDenied(await document(token));
      expect(mock.reads.map(read => read.table)).toEqual([
        "academy_enrollments",
      ]);
      expect(external.requireCourse).not.toHaveBeenCalled();
    }
  );
  it.each(["template", "submission"] as const)(
    "active learner %s download remains functional without staff grants",
    async kind => {
      const token = mint({
        kind,
        ...(kind === "submission" ? { attemptId: 66 } : {}),
      });
      const res = await document(token);
      expectPrivateSuccess(
        res,
        kind === "template" ? "current.pdf" : "submitted-work.pdf"
      );
      expect(external.storage).toHaveBeenCalledWith(
        kind === "template"
          ? "synthetic/current-template"
          : "synthetic/submitted-file"
      );
      expect(external.requireCourse).not.toHaveBeenCalled();
      expect(external.selfReview).not.toHaveBeenCalled();
    }
  );
  it.each(["template", "submission"] as const)(
    "scoped instructor own %s token preserves archived attempt evidence rather than using the current template",
    async kind => {
      external.user = instructor;
      external.grants = [33];
      mock.tables.academy_lessons[0].archivedAt = archivedAt;
      const before = structuredClone(mock.tables);
      const res = await document(
        mint({ scope: "staff", userId: 90, kind, attemptId: 66 })
      );
      expectPrivateSuccess(
        res,
        kind === "template" ? "historic-template.pdf" : "submitted-work.pdf"
      );
      expect(external.storage).toHaveBeenCalledWith(
        kind === "template"
          ? "synthetic/historic-template"
          : "synthetic/submitted-file"
      );
      expect(external.requireCourse).toHaveBeenCalledWith(instructor, 33);
      expect(external.selfReview).toHaveBeenCalledWith(instructor, 10);
      expect(mock.tables).toEqual(before);
      expect(mock.writes).toEqual([]);
    }
  );
  it.each(["template", "submission"] as const)(
    "archived staff %s download still denies self-review before storage",
    async kind => {
      external.user = { ...learner, isInstructor: true };
      external.grants = [33];
      mock.tables.academy_lessons[0].archivedAt = archivedAt;
      expectDenied(
        await document(
          mint({ scope: "staff", userId: 10, kind, attemptId: 66 })
        )
      );
      expect(external.requireCourse).toHaveBeenCalledWith(external.user, 33);
      expect(external.selfReview).toHaveBeenCalledWith(external.user, 10);
    }
  );
  it("an archived staff token is bound to the requesting instructor and their current course scope", async () => {
    external.user = instructor;
    mock.tables.academy_lessons[0].archivedAt = archivedAt;
    const token = mint({
      scope: "staff",
      userId: 90,
      kind: "submission",
      attemptId: 66,
    });
    external.grants = [34];
    expectDenied(await document(token));
    expect(external.requireCourse).toHaveBeenCalledWith(instructor, 33);
    external.grants = [33];
    external.user = { ...instructor, id: 91 };
    expectDenied(await document(token));
    expect(external.requireCourse).toHaveBeenCalledTimes(1);
  });
  it.each(["enrollmentId", "lessonId"] as const)(
    "an archived historic template cannot use an attempt with mismatched %s",
    async field => {
      external.user = instructor;
      external.grants = [33];
      mock.tables.academy_lessons[0].archivedAt = archivedAt;
      mock.tables.academy_assessment_attempts[0][field] = 999;
      expectDenied(
        await document(
          mint({ scope: "staff", userId: 90, kind: "template", attemptId: 66 })
        )
      );
    }
  );
});

describe("archived private course attachments distinguish learners from scoped instructors", () => {
  it("an archived-only attachment denies its enrolled learner through the course guard before storage", async () => {
    mock.tables.academy_lessons[0].archivedAt = archivedAt;
    expectDenied(await attachment());
    expect(external.requireCourse).toHaveBeenCalledWith(learner, 33);
    expect(mock.reads.map(read => read.table)).toEqual([
      "staff_academy_uploads",
      "academy_lessons",
    ]);
  });
  it("a separately scoped instructor may still download an archived teaching attachment", async () => {
    external.user = instructor;
    external.grants = [33];
    mock.tables.academy_lessons[0].archivedAt = archivedAt;
    expectPrivateSuccess(await attachment(), "lesson-resource.pdf");
    expect(external.requireCourse).toHaveBeenCalledWith(instructor, 33);
    expect(external.storage).toHaveBeenCalledWith(attachmentKey);
    expect(external.selfReview).not.toHaveBeenCalled();
  });
  it("an active lesson keeps the ordinary enrolled learner attachment path working", async () => {
    expectPrivateSuccess(await attachment(), "lesson-resource.pdf");
    expect(external.storage).toHaveBeenCalledWith(attachmentKey);
    expect(external.requireCourse).not.toHaveBeenCalled();
  });
  it("a reused key chooses an active same-course lesson even when the archived lesson is returned first", async () => {
    mock.tables.academy_lessons[0].archivedAt = archivedAt;
    mock.tables.academy_lessons.push({
      ...mock.tables.academy_lessons[0],
      id: 12,
      archivedAt: null,
      attachmentName: "active-resource.pdf",
    });
    expectPrivateSuccess(await attachment(), "active-resource.pdf");
    expect(external.requireCourse).not.toHaveBeenCalled();
    expect(external.storage).toHaveBeenCalledWith(attachmentKey);
  });
  it("a reused key in another course does not make an archived course attachment active for its learner", async () => {
    mock.tables.academy_lessons[0].archivedAt = archivedAt;
    mock.tables.academy_lessons.push({
      ...mock.tables.academy_lessons[0],
      id: 12,
      moduleId: 23,
      archivedAt: null,
    });
    expectDenied(await attachment());
    expect(external.requireCourse).toHaveBeenCalledWith(learner, 33);
  });
  it("a personal isInstructor flag and unrelated course grant cannot bypass archived learner denial", async () => {
    external.user = { ...learner, isInstructor: true };
    external.grants = [34];
    mock.tables.academy_lessons[0].archivedAt = archivedAt;
    expectDenied(await attachment());
    expect(external.requireCourse).toHaveBeenCalledWith(external.user, 33);
  });
  it("an instructor's personal active learner attachment still works without a matching staff grant", async () => {
    external.user = { ...learner, isInstructor: true };
    external.grants = [34];
    expectPrivateSuccess(await attachment(), "lesson-resource.pdf");
    expect(external.requireCourse).not.toHaveBeenCalled();
  });
});
