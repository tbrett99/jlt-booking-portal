export const FIRST_CLASS_UPGRADE_MESSAGE = "This training is available to current First Class members. Please contact JLT support to upgrade your membership.";
export const FIRST_CLASS_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Exact CRM labels with CRM's case/separator normalization, never substrings.
 * Keep the security allowlist independent of the client CRM list filters. */
export function isFirstClassMembershipTier(tier: unknown): boolean {
  if (typeof tier !== "string") return false;
  const canonical = tier.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  return canonical === "first_class" || canonical === "first_class_duo" || canonical === "first_class_trio";
}

function validAnchor(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  // Serialized dates must be unambiguous instants, not permissively parsed text.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
  const date = new Date(value);
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return date;
}

export function firstClassModuleRelease<T extends { id: number; sortOrder: number }>(
  enrollment: { enrolledAt?: unknown; status?: string }, modules: T[], moduleId: number, now = new Date(),
): { releaseAt: Date | null; releaseLocked: boolean; releaseLabel: string } {
  const sorted = [...modules].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const rank = sorted.findIndex(module => module.id === moduleId);
  const anchor = validAnchor(enrollment.enrolledAt);
  if (!anchor || rank < 0 || !Number.isFinite(now.getTime()) || anchor.getTime() > now.getTime()) {
    return { releaseAt: null, releaseLocked: true, releaseLabel: "Release date unavailable — please contact JLT support" };
  }
  const releaseAt = new Date(anchor.getTime() + rank * FIRST_CLASS_WEEK_MS);
  if (!Number.isFinite(releaseAt.getTime())) return { releaseAt: null, releaseLocked: true, releaseLabel: "Release date unavailable — please contact JLT support" };
  const recap = enrollment.status === "completed" || enrollment.status === "waived";
  return {
    releaseAt,
    releaseLocked: !recap && releaseAt.getTime() > now.getTime(),
    releaseLabel: releaseAt.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  };
}

export function isFirstClassRecap(course: { isFirstClassTraining?: boolean }, enrollment: { status?: string }) {
  return course.isFirstClassTraining === true && ["completed", "waived"].includes(enrollment.status ?? "");
}

export function assertExclusiveAcademyCourseDesignation(course: { isCoreAcademy?: boolean; isAcceleratorJourney?: boolean; isFirstClassTraining?: boolean }) {
  return [course.isCoreAcademy, course.isAcceleratorJourney, course.isFirstClassTraining].filter(Boolean).length <= 1;
}
