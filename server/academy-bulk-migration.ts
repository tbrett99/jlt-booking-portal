export const BULK_ACADEMY_COMPLETION_STAGES = [
  "Agent Accelerator",
  "Accredited",
] as const;

export type BulkAcademyMigrationDisposition = "complete" | "manual_progress";

/**
 * The original JLT training has already covered the current Academy pathway for
 * these two established stages. Training agents are intentionally enrolled but
 * remain incomplete so staff can record only the parts they have actually done.
 */
export function getBulkAcademyMigrationDisposition(
  trainingStage: string | null | undefined
): BulkAcademyMigrationDisposition {
  return BULK_ACADEMY_COMPLETION_STAGES.includes(
    trainingStage as (typeof BULK_ACADEMY_COMPLETION_STAGES)[number]
  )
    ? "complete"
    : "manual_progress";
}

export function isBulkAcademyCompletionStage(
  trainingStage: string | null | undefined
) {
  return getBulkAcademyMigrationDisposition(trainingStage) === "complete";
}
