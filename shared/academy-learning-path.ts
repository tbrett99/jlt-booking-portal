export type AcademyLearningPathItem = {
  id: number;
  isRequired: boolean;
  completed: boolean;
};

export type AcademyLearningPath = {
  currentRequiredLessonId: number | null;
  lockedLessonIds: Set<number>;
};

/**
 * Academy lessons are completed in their canonical course order. A learner may
 * revisit completed material, but cannot begin unfinished material after the
 * first unfinished required lesson.
 */
export function buildAcademyLearningPath(items: AcademyLearningPathItem[]): AcademyLearningPath {
  const currentIndex = items.findIndex((item) => item.isRequired && !item.completed);
  if (currentIndex < 0) {
    return { currentRequiredLessonId: null, lockedLessonIds: new Set() };
  }

  return {
    currentRequiredLessonId: items[currentIndex]!.id,
    lockedLessonIds: new Set(items
      .slice(currentIndex + 1)
      .filter((item) => !item.completed)
      .map((item) => item.id)),
  };
}
