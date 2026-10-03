export const ACADEMY_ACCELERATOR_WAIT_DAYS = 56;

export type AcademyProgressSummary = {
  requiredLessons: number;
  completedRequiredLessons: number;
  percentage: number;
  isComplete: boolean;
};

/**
 * Completion is intentionally based on required lessons only. Optional reference
 * material remains available but must not block an agent's Academy progression.
 */
export function summariseAcademyProgress(
  requiredLessonIds: number[],
  completedLessonIds: Iterable<number>,
): AcademyProgressSummary {
  const completed = new Set(completedLessonIds);
  const required = Array.from(new Set(requiredLessonIds));
  const completedRequiredLessons = required.filter((lessonId) => completed.has(lessonId)).length;
  const requiredLessons = required.length;
  const percentage = requiredLessons === 0
    ? 0
    : Math.round((completedRequiredLessons / requiredLessons) * 100);

  return {
    requiredLessons,
    completedRequiredLessons,
    percentage,
    isComplete: requiredLessons > 0 && completedRequiredLessons === requiredLessons,
  };
}

/** The CRM stage is deliberately staff-gated for eight full calendar weeks. */
export function getAccreditationEligibility(
  acceleratorStartedAt: Date | string | null | undefined,
  now = new Date(),
): { eligible: boolean; eligibleAt: Date | null; daysRemaining: number | null } {
  if (!acceleratorStartedAt) {
    return { eligible: false, eligibleAt: null, daysRemaining: null };
  }
  const startedAt = new Date(acceleratorStartedAt);
  if (Number.isNaN(startedAt.getTime())) {
    return { eligible: false, eligibleAt: null, daysRemaining: null };
  }
  const eligibleAt = new Date(startedAt.getTime() + ACADEMY_ACCELERATOR_WAIT_DAYS * 24 * 60 * 60 * 1000);
  const remainingMs = eligibleAt.getTime() - now.getTime();
  return {
    eligible: remainingMs <= 0,
    eligibleAt,
    daysRemaining: Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000))),
  };
}

export function safeHttpsUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
