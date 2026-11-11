import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  academyAuditLog,
  academyAssessmentAttempts,
  academyAssessmentResponses,
  academyEnrollments,
  academyLessonProgress,
  academyLessons,
  academyModules,
  academyQuestions,
} from "../drizzle/schema";
import { academyMockDb } from "./academy-staff-test-db";

const external = vi.hoisted(() => ({
  getDb: vi.fn(),
  email: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("./db", () => ({
  getDb: external.getDb,
  getRawDbPool: vi.fn(() => {
    throw new Error("Live database access is forbidden in this suite");
  }),
  createInAppNotification: external.notify,
}));
vi.mock("./email", () => ({
  sendDirectEmail: external.email,
  sendSupportEmail: external.email,
}));
vi.mock("./academy-email-alerts", () => ({
  dispatchAcademyEmailAlerts: external.email,
}));
import { setAcademyLessonArchived } from "./academy-lesson-archive";

type Tables = {
  academy_lessons: (typeof academyLessons.$inferSelect)[];
  academy_modules: (typeof academyModules.$inferInsert)[];
  academy_questions: (typeof academyQuestions.$inferInsert)[];
  academy_enrollments: (typeof academyEnrollments.$inferInsert)[];
  academy_lesson_progress: (typeof academyLessonProgress.$inferInsert)[];
  academy_assessment_attempts: (typeof academyAssessmentAttempts.$inferInsert)[];
  academy_assessment_responses: (typeof academyAssessmentResponses.$inferInsert)[];
  academy_audit_log: (typeof academyAuditLog.$inferInsert)[];
};
const historic = new Date("2026-01-02T09:00:00.000Z");
const now = new Date("2026-11-11T12:34:56.789Z");
function initialTables(archivedAt: Date | null = null): Tables {
  return {
    academy_lessons: [
      {
        id: 11,
        moduleId: 22,
        title: "Preserved teaching",
        summary: "Original summary",
        contentHtml: "<p>Original lesson body</p>",
        videoUrl: "https://video.example.test/11",
        videoTranscript: "Private teaching transcript",
        attachmentUrl: "/private/resource",
        attachmentKey: "synthetic/attachment",
        attachmentName: "resource.pdf",
        estimatedMinutes: 25,
        isRequired: true,
        requiresAcknowledgement: true,
        requiresAssessment: true,
        assessmentMode: "document_upload",
        assessmentTemplateKey: "synthetic/current-template",
        assessmentTemplateName: "current.pdf",
        assessmentTemplateMimeType: "application/pdf",
        assessmentTemplateSize: 123,
        assessmentPassMark: 80,
        sortOrder: 7,
        archivedAt,
        createdAt: historic,
        updatedAt: historic,
      },
    ],
    academy_modules: [
      {
        id: 22,
        courseId: 33,
        title: "Original module",
        sortOrder: 4,
        releaseWeek: 8,
      },
    ],
    academy_questions: [
      {
        id: 52,
        lessonId: 11,
        prompt: "Second question",
        questionType: "free_text",
        answerOptions: [],
        correctAnswerIndex: 0,
        sortOrder: 8,
      },
      {
        id: 51,
        lessonId: 11,
        prompt: "First question",
        questionType: "multiple_choice",
        answerOptions: ["a", "b"],
        correctAnswerIndex: 1,
        sortOrder: 3,
      },
    ],
    academy_enrollments: [
      {
        id: 61,
        agentId: 71,
        courseId: 33,
        enrolledById: 99,
        status: "completed",
        completedAt: historic,
        completionOutcomeAppliedAt: historic,
      },
      {
        id: 62,
        agentId: 72,
        courseId: 33,
        enrolledById: 99,
        status: "waived",
        completedAt: historic,
      },
      {
        id: 63,
        agentId: 73,
        courseId: 33,
        enrolledById: 99,
        status: "in_progress",
        startedAt: historic,
      },
    ],
    academy_lesson_progress: [
      {
        id: 81,
        enrollmentId: 61,
        lessonId: 11,
        completedAt: historic,
        acknowledgedAt: historic,
        startedAt: historic,
        lessonActiveSeconds: 600,
        assessmentActiveSeconds: 90,
      },
    ],
    academy_assessment_attempts: [
      {
        id: 91,
        enrollmentId: 61,
        lessonId: 11,
        status: "feedback_acknowledged",
        score: 96,
        passed: true,
        answers: [
          { questionId: 51, selectedIndex: 1, prompt: "Immutable snapshot" },
        ],
        graderFeedback: "Terminal feedback",
        gradedById: 99,
        gradedAt: historic,
        feedbackAcknowledgedAt: historic,
        takenAt: historic,
        assessmentTemplateKey: "synthetic/historic-template",
        assessmentTemplateName: "historic.pdf",
        assessmentTemplateMimeType: "application/pdf",
        submissionFileKey: "synthetic/submission",
        submissionFileName: "submitted.pdf",
        submissionMimeType: "application/pdf",
        submissionFileSize: 456,
      },
    ],
    academy_assessment_responses: [
      {
        id: 101,
        attemptId: 91,
        questionId: 51,
        selectedIndex: 1,
        responseText: "Preserved answer",
        score: 96,
        feedback: "Preserved marking",
        gradedById: 99,
        gradedAt: historic,
      },
    ],
    academy_audit_log: [],
  };
}

type Fault =
  | "audit"
  | "readback-missing"
  | "readback-mismatch"
  | "readback-error"
  | "locked-read";
type ServiceTable = typeof academyLessons | typeof academyModules;
/** A single-row FOR UPDATE simulator: readers acquire the same mutex before
 * taking their snapshot, writes remain staged, and only a successful callback
 * publishes them. It is not a claim about a live database's isolation level. */
function transactionFixture(initial = initialTables(), fault?: Fault) {
  let tables = structuredClone(initial);
  let tail: Promise<void> = Promise.resolve();
  const events: {
    tx: number;
    action: string;
    table?: string;
    values?: unknown;
  }[] = [];
  const commits = vi.fn();
  const rollbacks = vi.fn();
  let nextId = 0;
  async function transaction<T>(
    work: (tx: ReturnType<typeof makeTx>) => Promise<T>
  ): Promise<T> {
    const id = ++nextId;
    let staged: ReturnType<typeof academyMockDb> | undefined;
    let release: (() => void) | undefined;
    events.push({ tx: id, action: "begin" });
    function makeTx() {
      return {
        select(projection?: unknown) {
          let table: ServiceTable;
          let predicate: unknown;
          let max = Infinity;
          async function execute(): Promise<Record<string, unknown>[]> {
            if (!staged)
              throw new Error(
                "A locking read is required before transaction data access"
              );
            const name = getTableName(table);
            events.push({ tx: id, action: "select", table: name });
            if (fault === "locked-read")
              throw new Error("ER_PRIVATE SQL secret body and parameter 11");
            const rows: Record<string, unknown>[] = await staged.db
              .select(projection)
              .from(table)
              .where(predicate)
              .limit(max);
            const isReadback =
              name === "academy_lessons" && staged.writes.length > 0;
            if (isReadback && fault === "readback-missing") return [];
            if (isReadback && fault === "readback-mismatch")
              return [{ id: 11, archivedAt: new Date(0) }];
            if (isReadback && fault === "readback-error")
              throw new Error("PRIVATE readback driver failure");
            return rows;
          }
          const query = {
            from(value: ServiceTable) {
              table = value;
              return query;
            },
            where(value: unknown) {
              predicate = value;
              return query;
            },
            limit(value: number) {
              max = value;
              return query;
            },
            async for(mode: string) {
              expect(mode).toBe("update");
              expect(table).toBe(academyLessons);
              const previous = tail;
              tail = new Promise<void>(resolve => {
                release = resolve;
              });
              await previous;
              events.push({
                tx: id,
                action: "lock",
                table: getTableName(table),
              });
              staged = academyMockDb(tables);
              return execute();
            },
            then(
              resolve: (rows: Record<string, unknown>[]) => unknown,
              reject?: (error: unknown) => unknown
            ) {
              return execute().then(resolve, reject);
            },
          };
          return query;
        },
        update(table: typeof academyLessons) {
          expect(table).toBe(academyLessons);
          return {
            set(values: Partial<typeof academyLessons.$inferInsert>) {
              events.push({
                tx: id,
                action: "update",
                table: getTableName(table),
                values,
              });
              if (!staged) throw new Error("Write outside locked transaction");
              return staged.db.update(table).set(values);
            },
          };
        },
        insert(table: typeof academyAuditLog) {
          expect(table).toBe(academyAuditLog);
          return {
            async values(values: typeof academyAuditLog.$inferInsert) {
              events.push({
                tx: id,
                action: "audit",
                table: getTableName(table),
                values,
              });
              if (!staged) throw new Error("Audit outside locked transaction");
              if (fault === "audit")
                throw new Error("PRIVATE audit SQL failure");
              return staged.db.insert(table).values(values);
            },
          };
        },
      };
    }
    try {
      const result = await work(makeTx());
      if (!staged) throw new Error("No row lock acquired");
      tables = staged.tables as Tables;
      events.push({ tx: id, action: "commit" });
      commits();
      return result;
    } catch (error) {
      events.push({ tx: id, action: "rollback" });
      rollbacks();
      throw error;
    } finally {
      release?.();
    }
  }
  const outside = vi.fn(() => {
    throw new Error("Database access must stay inside the transaction");
  });
  return {
    db: { transaction, select: outside, update: outside, insert: outside },
    get tables() {
      return tables;
    },
    events,
    commits,
    rollbacks,
    outside,
  };
}
let fixture: ReturnType<typeof transactionFixture>;
const archive = (archived = true) =>
  setAcademyLessonArchived({ lessonId: 11, actorId: 99, archived });
function expectPreserved(before: Tables, archivedAt: Date | null) {
  expect(fixture.tables).toEqual({
    ...before,
    academy_lessons: before.academy_lessons.map(lesson => ({
      ...lesson,
      archivedAt,
    })),
    academy_audit_log: fixture.tables.academy_audit_log,
  });
  expect(
    fixture.events
      .filter(event => event.action === "update")
      .every(
        event =>
          event.table === "academy_lessons" &&
          Object.keys(event.values as object).join() === "archivedAt"
      )
  ).toBe(true);
  expect(fixture.outside).not.toHaveBeenCalled();
  expect(external.email).not.toHaveBeenCalled();
  expect(external.notify).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now.getTime());
  fixture = transactionFixture();
  external.getDb.mockReset().mockResolvedValue(fixture.db);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("lesson archive transaction preserves curriculum and learner evidence", () => {
  it("archives from null, changes only archivedAt and commits its scoped audit after exact readback", async () => {
    const before = structuredClone(fixture.tables);
    const archivedAt = new Date("2026-11-11T12:34:56.000Z");
    expect(await archive()).toEqual({
      success: true,
      lessonId: 11,
      archivedAt,
      changed: true,
    });
    expectPreserved(before, archivedAt);
    expect(fixture.events.map(event => event.action)).toEqual([
      "begin",
      "lock",
      "select",
      "select",
      "update",
      "select",
      "audit",
      "commit",
    ]);
    expect(
      fixture.events
        .filter(event => event.action === "select")
        .map(event => event.table)
    ).toEqual(["academy_lessons", "academy_modules", "academy_lessons"]);
    expect(fixture.tables.academy_audit_log).toEqual([
      expect.objectContaining({
        courseId: 33,
        actorId: 99,
        action: "lesson_archived",
        metadata: {
          lessonId: 11,
          moduleId: 22,
          previousArchivedAt: null,
          archivedAt: archivedAt.toISOString(),
          learnerEvidencePreserved: true,
        },
      }),
    ]);
    expect(fixture.commits).toHaveBeenCalledOnce();
    expect(fixture.rollbacks).not.toHaveBeenCalled();
  });
  it("restores the same lesson without reopening completed/waived enrolments or terminal assessment history", async () => {
    fixture = transactionFixture(initialTables(historic));
    external.getDb.mockResolvedValue(fixture.db);
    const before = structuredClone(fixture.tables);
    expect(await archive(false)).toEqual({
      success: true,
      lessonId: 11,
      archivedAt: null,
      changed: true,
    });
    expectPreserved(before, null);
    expect(fixture.tables.academy_audit_log[0]).toMatchObject({
      action: "lesson_restored",
      metadata: {
        previousArchivedAt: historic.toISOString(),
        archivedAt: null,
        learnerEvidencePreserved: true,
      },
    });
  });
  it.each([true, false])(
    "already archived=%s is idempotent and emits no update or new audit",
    async archived => {
      fixture = transactionFixture(initialTables(archived ? historic : null));
      external.getDb.mockResolvedValue(fixture.db);
      const before = structuredClone(fixture.tables);
      expect(await archive(archived)).toMatchObject({
        changed: false,
        archivedAt: archived ? historic : null,
      });
      expect(fixture.tables).toEqual(before);
      expect(
        fixture.events.filter(event =>
          ["update", "audit"].includes(event.action)
        )
      ).toEqual([]);
      expect(fixture.events.map(event => event.action)).toEqual([
        "begin",
        "lock",
        "select",
        "select",
        "commit",
      ]);
    }
  );
  it("serializes concurrent archive/archive calls at the row lock and commits exactly one audit", async () => {
    const before = structuredClone(fixture.tables);
    const results = await Promise.all([archive(), archive()]);
    expect(results.map(result => result.changed)).toEqual([true, false]);
    expect(results[0].archivedAt).toEqual(results[1].archivedAt);
    expect(fixture.tables.academy_audit_log).toHaveLength(1);
    const commitIndex = fixture.events.findIndex(
      event => event.tx === 1 && event.action === "commit"
    );
    const secondLockIndex = fixture.events.findIndex(
      event => event.tx === 2 && event.action === "lock"
    );
    expect(secondLockIndex).toBeGreaterThan(commitIndex);
    expectPreserved(before, results[0].archivedAt);
  });
  it("serializes concurrent archive/restore, leaving active curriculum and both ordered audits", async () => {
    const before = structuredClone(fixture.tables);
    const results = await Promise.all([archive(), archive(false)]);
    expect(results.map(result => result.changed)).toEqual([true, true]);
    expect(results[1].archivedAt).toBeNull();
    expect(fixture.tables.academy_audit_log.map(row => row.action)).toEqual([
      "lesson_archived",
      "lesson_restored",
    ]);
    expect(fixture.tables.academy_audit_log[1].metadata).toMatchObject({
      previousArchivedAt: results[0].archivedAt?.toISOString(),
      archivedAt: null,
    });
    expectPreserved(before, null);
  });
});

describe("lesson archive fails closed and rolls back", () => {
  it.each(["lesson", "module"] as const)(
    "a missing %s fails without writing or committing",
    async missing => {
      fixture.tables[
        missing === "lesson" ? "academy_lessons" : "academy_modules"
      ].length = 0;
      const before = structuredClone(fixture.tables);
      await expect(archive()).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(fixture.tables).toEqual(before);
      expect(fixture.rollbacks).toHaveBeenCalledOnce();
      expect(fixture.commits).not.toHaveBeenCalled();
      expect(
        fixture.events.some(event => ["update", "audit"].includes(event.action))
      ).toBe(false);
    }
  );
  it.each([
    "audit",
    "readback-missing",
    "readback-mismatch",
    "readback-error",
    "locked-read",
  ] as const)(
    "%s failure rolls back all staged changes and returns only safe errors",
    async fault => {
      fixture = transactionFixture(initialTables(), fault);
      external.getDb.mockResolvedValue(fixture.db);
      const before = structuredClone(fixture.tables);
      const error = await archive().catch((value: unknown) => value);
      expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      expect(String(error)).not.toMatch(
        /PRIVATE|ER_PRIVATE|secret body|parameter 11/
      );
      expect(fixture.tables).toEqual(before);
      expect(fixture.rollbacks).toHaveBeenCalledOnce();
      expect(fixture.commits).not.toHaveBeenCalled();
      if (fault.startsWith("readback"))
        expect(fixture.events.some(event => event.action === "audit")).toBe(
          false
        );
      expect(external.email).not.toHaveBeenCalled();
      expect(external.notify).not.toHaveBeenCalled();
    }
  );
  it("an unavailable database is a safe service error without a transaction", async () => {
    external.getDb.mockResolvedValue(null);
    await expect(archive()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Lesson visibility is temporarily unavailable",
    });
    expect(fixture.events).toEqual([]);
  });
  it.each(["getDb", "transaction"] as const)(
    "sanitizes %s connection/driver faults",
    async source => {
      const privateError = new Error(
        "ECONNREFUSED mysql://secret:password@host PRIVATE_SQL"
      );
      if (source === "getDb") external.getDb.mockRejectedValue(privateError);
      else
        external.getDb.mockResolvedValue({
          transaction: vi.fn().mockRejectedValue(privateError),
        });
      await expect(archive()).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Lesson visibility could not be saved. Refresh the course to check its current state before trying again.",
      });
      expect(fixture.tables.academy_lessons[0].archivedAt).toBeNull();
      expect(fixture.tables.academy_audit_log).toEqual([]);
    }
  );
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe/non-positive identifier %s before database access",
    async id => {
      for (const field of ["lessonId", "actorId"] as const) {
        await expect(
          setAcademyLessonArchived({
            lessonId: 11,
            actorId: 99,
            archived: true,
            [field]: id,
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      expect(external.getDb).not.toHaveBeenCalled();
      expect(fixture.events).toEqual([]);
    }
  );
});
