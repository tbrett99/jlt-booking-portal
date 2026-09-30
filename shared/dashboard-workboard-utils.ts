export type PipelineWorkboardRow = {
  id: number;
  clientName: string | null;
  currentStage: string;
  stageEntered: Date | string | null;
};

export type PipelineHealth = {
  stage: string;
  count: number;
  averageAgeDays: number;
  oldestAgeDays: number;
  oldestClientName: string | null;
  overTargetCount: number;
  targetDays: number;
};

/**
 * Phase-one operational target. This is deliberately visible on the dashboard
 * rather than hidden in the query, and can become a settings-backed map later.
 */
export const PIPELINE_STAGE_TARGET_DAYS = 3;

function wholeDaysBetween(start: Date, end: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / millisecondsPerDay));
}

export function buildPipelineHealth(
  rows: PipelineWorkboardRow[],
  now = new Date(),
): PipelineHealth[] {
  const groups = new Map<string, Array<PipelineWorkboardRow & { ageDays: number }>>();

  for (const row of rows) {
    const entered = row.stageEntered ? new Date(row.stageEntered) : now;
    const ageDays = Number.isNaN(entered.getTime()) ? 0 : wholeDaysBetween(entered, now);
    const group = groups.get(row.currentStage) ?? [];
    group.push({ ...row, ageDays });
    groups.set(row.currentStage, group);
  }

  return Array.from(groups.entries())
    .map(([stage, entries]) => {
      const sortedByAge = [...entries].sort((a, b) => b.ageDays - a.ageDays);
      const oldest = sortedByAge[0];
      const totalAge = entries.reduce((sum, entry) => sum + entry.ageDays, 0);
      return {
        stage,
        count: entries.length,
        averageAgeDays: Math.round((totalAge / entries.length) * 10) / 10,
        oldestAgeDays: oldest?.ageDays ?? 0,
        oldestClientName: oldest?.clientName ?? null,
        overTargetCount: entries.filter((entry) => entry.ageDays > PIPELINE_STAGE_TARGET_DAYS).length,
        targetDays: PIPELINE_STAGE_TARGET_DAYS,
      };
    })
    .sort((a, b) => b.overTargetCount - a.overTargetCount || b.oldestAgeDays - a.oldestAgeDays || b.count - a.count);
}

export function taskNeedsAttention(task: {
  status: string;
  acknowledgedAt?: Date | string | null;
  dueDate?: Date | string | null;
}, now = new Date()) {
  if (task.status === "done") return false;
  if (!task.acknowledgedAt) return true;
  if (!task.dueDate) return false;
  const dueDate = new Date(task.dueDate);
  return !Number.isNaN(dueDate.getTime()) && dueDate.getTime() <= now.getTime();
}
