export const BULK_ACADEMY_COMPLETION_STAGES = [
  "Agent Accelerator",
  "Accredited",
] as const;

export type BulkAcademyMigrationDisposition = "complete" | "manual_progress";
export type AcademyMigrationStageReviewCategory =
  | "training"
  | "missing"
  | "legacy"
  | "automatic";

export function normaliseAcademyTrainingStage(
  trainingStage: string | null | undefined
) {
  const normalised = trainingStage?.trim();
  return normalised || null;
}

/**
 * Training is a deliberate manual-progress stage. Empty or historical values
 * need staff classification before they can be trusted by the migration.
 */
export function getAcademyMigrationStageReviewCategory(
  trainingStage: string | null | undefined
): AcademyMigrationStageReviewCategory {
  const normalised = normaliseAcademyTrainingStage(trainingStage);
  if (!normalised) return "missing";
  if (normalised === "Training") return "training";
  if (BULK_ACADEMY_COMPLETION_STAGES.includes(
    normalised as (typeof BULK_ACADEMY_COMPLETION_STAGES)[number]
  )) {
    return "automatic";
  }
  return "legacy";
}

/**
 * The original JLT training has already covered the current Academy pathway for
 * these two established stages. Training agents are intentionally enrolled but
 * remain incomplete so staff can record only the parts they have actually done.
 */
export function getBulkAcademyMigrationDisposition(
  trainingStage: string | null | undefined
): BulkAcademyMigrationDisposition {
  return BULK_ACADEMY_COMPLETION_STAGES.includes(
    normaliseAcademyTrainingStage(
      trainingStage
    ) as (typeof BULK_ACADEMY_COMPLETION_STAGES)[number]
  )
    ? "complete"
    : "manual_progress";
}

export function isBulkAcademyCompletionStage(
  trainingStage: string | null | undefined
) {
  return getBulkAcademyMigrationDisposition(trainingStage) === "complete";
}
