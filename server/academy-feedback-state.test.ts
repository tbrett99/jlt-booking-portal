import { describe, expect, it } from "vitest";
import {
  getActionableAcademyFeedbackAttempts,
  isActionableAcademyFeedback,
  type AcademyFeedbackAttempt,
  type AcademyFeedbackLesson,
  type AcademyFeedbackProgress,
} from "../shared/academy-feedback-state";

const gradedAt = new Date("2026-10-01T10:00:00Z");
const completedAt = new Date("2026-10-02T10:00:00Z");

type Attempt = AcademyFeedbackAttempt & {
  id: number;
  score: number;
  passed: boolean;
  graderFeedback: string;
  gradedAt: Date;
  answers: readonly string[];
  submissionFileKey: string | null;
};
type Lesson = AcademyFeedbackLesson & {
  assessmentMode: "quiz" | "document_upload";
};

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return freeze({
    id: 1,
    enrollmentId: 101,
    lessonId: 11,
    status: "feedback_pending",
    feedbackAcknowledgedAt: null,
    score: 94,
    passed: true,
    graderFeedback: "Keep this original staff feedback in assessment history.",
    gradedAt,
    answers: ["A synthetic written response"],
    submissionFileKey: null,
    ...overrides,
  });
}

const writtenLesson: Lesson = freeze({ id: 11, requiresAssessment: true, assessmentMode: "quiz" });
const documentLesson: Lesson = freeze({ id: 12, requiresAssessment: true, assessmentMode: "document_upload" });

function input(
  attempts: readonly Attempt[],
  lessons: readonly Lesson[] = [writtenLesson, documentLesson],
  progress: readonly AcademyFeedbackProgress[] = [],
) {
  return freeze({ attempts, lessons, progress });
}

const assessmentCases = [
  { label: "written", lesson: writtenLesson, submissionFileKey: null },
  { label: "document", lesson: documentLesson, submissionFileKey: "synthetic/document.pdf" },
] as const;

describe("isActionableAcademyFeedback", () => {
  for (const { label, lesson } of assessmentCases) {
    it.each([null, undefined])(`counts ${label} feedback with completedAt %s and assessment enabled`, (completion) => {
      const pending = attempt({ lessonId: lesson.id, feedbackAcknowledgedAt: undefined });
      expect(isActionableAcademyFeedback(pending, freeze({ ...lesson, completedAt: completion }))).toBe(true);
    });
  }

  it("excludes completed lessons without changing pending assessment history", () => {
    const pending = attempt();
    const before = structuredClone(pending);
    expect(isActionableAcademyFeedback(pending, freeze({ ...writtenLesson, completedAt }))).toBe(false);
    expect(pending).toEqual(before);
    expect(pending.status).toBe("feedback_pending");
    expect(pending.feedbackAcknowledgedAt).toBeNull();
  });

  it.each([null, undefined])("excludes a removed or missing lesson (%s)", (lesson) => {
    expect(isActionableAcademyFeedback(attempt(), lesson)).toBe(false);
  });

  it("excludes a lesson that no longer requires an assessment", () => {
    expect(isActionableAcademyFeedback(attempt(), freeze({ requiresAssessment: false, completedAt: null }))).toBe(false);
  });

  it.each(["feedback_acknowledged", "awaiting_marking", "auto_graded"])("does not count status %s", (status) => {
    expect(isActionableAcademyFeedback(attempt({ status }), writtenLesson)).toBe(false);
  });

  it("does not count acknowledged feedback even if the stored status is still pending", () => {
    expect(isActionableAcademyFeedback(attempt({ feedbackAcknowledgedAt: completedAt }), writtenLesson)).toBe(false);
  });
});

describe("getActionableAcademyFeedbackAttempts", () => {
  for (const { label, lesson, submissionFileKey } of assessmentCases) {
    it.each([null, undefined])(`counts ${label} feedback with incomplete progress (%s)`, (completion) => {
      const pending = attempt({ lessonId: lesson.id, submissionFileKey });
      const fixtures = input([pending], [lesson], [{ enrollmentId: 101, lessonId: lesson.id, completedAt: completion }]);
      expect(getActionableAcademyFeedbackAttempts(fixtures)).toEqual([pending]);
    });

    it(`excludes completed ${label} feedback without mutating the attempt, grade, or acknowledgement`, () => {
      const pending = attempt({ lessonId: lesson.id, submissionFileKey });
      const fixtures = input([pending], [lesson], [{ enrollmentId: 101, lessonId: lesson.id, completedAt }]);
      const before = structuredClone(fixtures);
      expect(getActionableAcademyFeedbackAttempts(fixtures)).toEqual([]);
      expect(fixtures).toEqual(before);
      expect(pending).toMatchObject({ status: "feedback_pending", score: 94, passed: true, feedbackAcknowledgedAt: null, gradedAt });
      expect(pending.graderFeedback).toBe(before.attempts[0].graderFeedback);
    });
  }

  it("does not let completing one learner hide another learner's feedback for the same lesson", () => {
    const first = attempt({ id: 1, enrollmentId: 101 });
    const second = attempt({ id: 2, enrollmentId: 102 });
    const fixtures = input([first, second], [writtenLesson], [
      { enrollmentId: 101, lessonId: 11, completedAt },
      { enrollmentId: 102, lessonId: 11, completedAt: null },
    ]);
    expect(getActionableAcademyFeedbackAttempts(fixtures)).toEqual([second]);
    expect(first.status).toBe("feedback_pending");
    expect(second.status).toBe("feedback_pending");
  });

  it("does not let completion of a different lesson hide an incomplete lesson for the same enrollment", () => {
    const written = attempt();
    const document = attempt({ id: 2, lessonId: 12, submissionFileKey: "synthetic/document.pdf" });
    const fixtures = input([written, document], undefined, [
      { enrollmentId: 101, lessonId: 11, completedAt },
      { enrollmentId: 101, lessonId: 12, completedAt: null },
    ]);
    expect(getActionableAcademyFeedbackAttempts(fixtures)).toEqual([document]);
  });

  it("brings legitimate feedback back after reopening with completedAt null, without changing history", () => {
    const pending = attempt();
    const closed = input([pending], [writtenLesson], [{ enrollmentId: 101, lessonId: 11, completedAt }]);
    const reopened = input([pending], [writtenLesson], [{ enrollmentId: 101, lessonId: 11, completedAt: null }]);
    expect(getActionableAcademyFeedbackAttempts(closed)).toEqual([]);
    const result = getActionableAcademyFeedbackAttempts(reopened);
    expect(result).toEqual([pending]);
    expect(result[0]).toBe(pending);
    expect(pending.feedbackAcknowledgedAt).toBeNull();
    expect(pending.status).toBe("feedback_pending");
    expect(closed.progress[0].completedAt).toBe(completedAt);
  });

  it("counts pending feedback when no progress record has yet been recorded", () => {
    const pending = attempt();
    expect(getActionableAcademyFeedbackAttempts(input([pending], [writtenLesson]))).toEqual([pending]);
  });

  it("returns no feedback for empty attempts or an empty/removed lesson set", () => {
    expect(getActionableAcademyFeedbackAttempts(input([]))).toEqual([]);
    expect(getActionableAcademyFeedbackAttempts(input([attempt()], []))).toEqual([]);
    expect(getActionableAcademyFeedbackAttempts(input([attempt({ lessonId: 999 })]))).toEqual([]);
  });

  it("excludes assessment-disabled lessons, acknowledged attempts, and attempts still awaiting marking", () => {
    const fixtures = input([
      attempt({ id: 1, lessonId: 12 }),
      attempt({ id: 2, status: "feedback_acknowledged", feedbackAcknowledgedAt: completedAt }),
      attempt({ id: 3, feedbackAcknowledgedAt: completedAt }),
      attempt({ id: 4, status: "awaiting_marking" }),
    ], [writtenLesson, freeze({ ...documentLesson, requiresAssessment: false })]);
    expect(getActionableAcademyFeedbackAttempts(fixtures)).toEqual([]);
  });

  it("preserves input order and original references with zero side effects across repeated calls", () => {
    const first = attempt({ id: 30, enrollmentId: 102, lessonId: 12 });
    const hidden = attempt({ id: 1, enrollmentId: 101 });
    const second = attempt({ id: 20, enrollmentId: 102 });
    const third = attempt({ id: 10, enrollmentId: 103 });
    const fixtures = input([first, hidden, second, third], undefined, [{ enrollmentId: 101, lessonId: 11, completedAt }]);
    const before = structuredClone(fixtures);
    const result = getActionableAcademyFeedbackAttempts(fixtures);
    expect(result.map((item) => item.id)).toEqual([30, 20, 10]);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(second);
    expect(result[2]).toBe(third);
    expect(result).not.toBe(fixtures.attempts);
    result.pop(); // Mutating the returned array must not change the source or a later result.
    expect(getActionableAcademyFeedbackAttempts(fixtures)).toEqual([first, second, third]);
    expect(fixtures).toEqual(before);
    expect(Object.isFrozen(fixtures)).toBe(true);
    expect(Object.isFrozen(fixtures.attempts)).toBe(true);
    expect(Object.isFrozen(hidden)).toBe(true);
  });
});
