export const TASK_RECURRENCE_RULES = ["none", "daily", "weekly", "fortnightly", "monthly"] as const;
export type TaskRecurrenceRule = typeof TASK_RECURRENCE_RULES[number];

export function nextRecurringTaskDate(
  dueDate: Date,
  rule: Exclude<TaskRecurrenceRule, "none">,
  interval = 1,
) {
  const safeInterval = Math.max(1, Math.floor(interval) || 1);
  const next = new Date(dueDate);

  if (rule === "daily") {
    next.setUTCDate(next.getUTCDate() + safeInterval);
    return next;
  }

  if (rule === "weekly" || rule === "fortnightly") {
    const weeks = rule === "fortnightly" ? 2 : 1;
    next.setUTCDate(next.getUTCDate() + weeks * 7 * safeInterval);
    return next;
  }

  const originalDay = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + safeInterval);
  const lastDayOfTargetMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return next;
}
