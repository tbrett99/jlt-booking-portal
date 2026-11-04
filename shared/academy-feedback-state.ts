export type AcademyFeedbackAttempt = {
  enrollmentId: number;
  lessonId: number;
  status: string;
  feedbackAcknowledgedAt?: unknown;
};

export type AcademyFeedbackLesson = {
  id: number;
  requiresAssessment: boolean;
};

export type AcademyFeedbackProgress = {
  enrollmentId: number;
  lessonId: number;
  completedAt?: unknown;
};

/**
 * Operational feedback is not the same as immutable assessment history. Staff
 * completion deliberately closes a lesson without pretending the learner read
 * its old feedback. Keep that attempt unchanged, but do not ask the learner to
 * acknowledge a panel which no longer exists on their completed lesson.
 */
export function isActionableAcademyFeedback(
  attempt: Pick<AcademyFeedbackAttempt, "status" | "feedbackAcknowledgedAt">,
  lesson: { requiresAssessment: boolean; completedAt?: unknown } | null | undefined,
): boolean {
  return attempt.status === "feedback_pending"
    && !attempt.feedbackAcknowledgedAt
    && !!lesson?.requiresAssessment
    && !lesson.completedAt;
}

/** Enrolment-scoped progress keys prevent one learner's completion hiding another's feedback. */
export function getActionableAcademyFeedbackAttempts<T extends AcademyFeedbackAttempt>(input: {
  attempts: readonly T[];
  lessons: readonly AcademyFeedbackLesson[];
  progress: readonly AcademyFeedbackProgress[];
}): T[] {
  const lessons = new Map(input.lessons.map(lesson => [lesson.id, lesson]));
  const completed = new Set(input.progress.filter(item => !!item.completedAt)
    .map(item => `${item.enrollmentId}:${item.lessonId}`));
  return input.attempts.filter(attempt => {
    const lesson = lessons.get(attempt.lessonId);
    return isActionableAcademyFeedback(attempt, lesson ? {
      requiresAssessment: lesson.requiresAssessment,
      completedAt: completed.has(`${attempt.enrollmentId}:${attempt.lessonId}`),
    } : null);
  });
}
