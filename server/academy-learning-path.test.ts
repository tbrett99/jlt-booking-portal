import { describe, expect, it } from "vitest";
import { buildAcademyLearningPath } from "../shared/academy-learning-path";

describe("Academy ordered learning path", () => {
  it("allows review of completed lessons but locks unfinished content after the current required lesson", () => {
    const path = buildAcademyLearningPath([
      { id: 10, isRequired: true, completed: true },
      { id: 11, isRequired: false, completed: false },
      { id: 12, isRequired: true, completed: false },
      { id: 13, isRequired: true, completed: false },
      { id: 14, isRequired: false, completed: false },
      { id: 15, isRequired: true, completed: false },
    ]);

    expect(path.currentRequiredLessonId).toBe(12);
    expect(path.lockedLessonIds).toEqual(new Set([13, 14, 15]));
    expect(path.lockedLessonIds.has(10)).toBe(false);
    expect(path.lockedLessonIds.has(11)).toBe(false);
  });

  it("unlocks the full course once every required lesson is complete", () => {
    const path = buildAcademyLearningPath([
      { id: 10, isRequired: true, completed: true },
      { id: 11, isRequired: false, completed: false },
      { id: 12, isRequired: true, completed: true },
    ]);

    expect(path.currentRequiredLessonId).toBeNull();
    expect(path.lockedLessonIds).toEqual(new Set());
  });
});
