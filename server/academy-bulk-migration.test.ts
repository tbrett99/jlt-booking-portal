import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAcademyMigrationStageReviewCategory,
  getBulkAcademyMigrationDisposition,
  isBulkAcademyCompletionStage,
} from "./academy-bulk-migration";

const router = readFileSync(
  resolve(process.cwd(), "server/academy-router.ts"),
  "utf8"
);
const insights = readFileSync(
  resolve(process.cwd(), "client/src/pages/admin/AdminAcademyProgressInsights.tsx"),
  "utf8"
);

describe("Academy bulk original-training migration", () => {
  it("auto-completes only established Agent Accelerator and Accredited stages", () => {
    expect(getBulkAcademyMigrationDisposition("Agent Accelerator")).toBe("complete");
    expect(getBulkAcademyMigrationDisposition("Accredited")).toBe("complete");
    expect(isBulkAcademyCompletionStage("Training")).toBe(false);
    expect(getBulkAcademyMigrationDisposition(null)).toBe("manual_progress");
    expect(getBulkAcademyMigrationDisposition("Legacy stage")).toBe("manual_progress");
  });

  it("separates deliberate Training progress from missing and legacy stage tags", () => {
    expect(getAcademyMigrationStageReviewCategory("Training")).toBe("training");
    expect(getAcademyMigrationStageReviewCategory(null)).toBe("missing");
    expect(getAcademyMigrationStageReviewCategory("  ")).toBe("missing");
    expect(getAcademyMigrationStageReviewCategory("Previous pathway")).toBe("legacy");
    expect(getAcademyMigrationStageReviewCategory("Agent Accelerator")).toBe("automatic");
    expect(getAcademyMigrationStageReviewCategory("Accredited")).toBe("automatic");
  });

  it("uses the CRM membership status as the authoritative exclusion guard", () => {
    const helper = router.slice(
      router.indexOf("async function getBulkAcademyMigrationCandidates"),
      router.indexOf("async function getBulkAcademyMigrationPreview")
    );
    expect(helper).toContain('agent.agentStatus === "in_notice"');
    expect(helper).toContain('agent.agentStatus === "cancelled"');
    expect(helper).toContain("portalStatus alone would incorrectly enrol them");
  });

  it("requires a published course and an exact staff confirmation before applying a bulk migration", () => {
    expect(router).toContain("bulkMigrationPreview: adminProcedure");
    expect(router).toContain("bulkMigrateOriginalTraining: adminProcedure");
    expect(router).toContain('confirmation: z.literal("BULK ENROL")');
    expect(router).toContain("Publish the course before using bulk enrolment");
  });

  it("uses one transaction, preserves genuine history and records all lessons without fabricating assessments", () => {
    const helper = router.slice(
      router.indexOf("async function applyBulkAcademyMigration"),
      router.indexOf("async function resolveEnrollmentForAgent")
    );
    expect(helper).toContain("await connection.beginTransaction()");
    expect(helper).toContain("await connection.rollback()");
    expect(helper).toContain("academy_lesson_progress");
    expect(helper).toContain("ON DUPLICATE KEY UPDATE");
    expect(helper).toContain("bulk_original_training_completion");
    expect(helper).toContain("bulk_enrolled_for_manual_progress");
    expect(helper).toContain("waivedPreserved");
    expect(helper).toContain('if (enrollment.status === "waived")');
    expect(helper).toContain("lessonIds = structure.lessons.map");
    expect(helper).not.toContain("academy_assessment_attempts");
    expect(helper).not.toContain("sendDirectEmail");
    expect(helper).not.toContain("agentCrmProfiles).set");
  });

  it("prevents normal core-course completion from resetting established agent stages", () => {
    const completion = router.slice(
      router.indexOf("async function recalculateCompletion"),
      router.indexOf("export const academyRouter")
    );
    expect(completion).toContain("const entersAccelerator");
    expect(completion).toContain('profile.trainingStage === "Training"');
    expect(completion).toContain("if (entersAccelerator)");
    expect(completion).toContain("retain their stage and existing personalised journey start date");
  });

  it("places the scalable preview in Learners and clearly distinguishes automatic from manual progress", () => {
    expect(insights).toContain("Original-training migration");
    expect(insights).toContain("Review and enrol all");
    expect(insights).toContain("bulkMigrationPreview.useQuery");
    expect(insights).toContain("bulkMigrateOriginalTraining.useMutation");
    expect(insights).toContain("In Notice and cancelled agents are excluded.");
    expect(insights).toContain("no agent emails are sent");
  });

  it("provides a paginated stage-review queue without including established completed stages", () => {
    const helper = router.slice(
      router.indexOf("async function getAcademyMigrationStageReviewQueue"),
      router.indexOf("async function classifyAcademyMigrationTrainingStage")
    );
    expect(helper).toContain('item.reviewCategory !== "automatic"');
    expect(helper).toContain("pageSize");
    expect(helper).toContain("reviewCategory");
    expect(router).toContain("migrationStageReviewQueue: adminProcedure");
    expect(insights).toContain("Stage review queue");
    expect(insights).toContain("Search name, email or recorded stage");
    expect(insights).toContain("Missing tag");
  });

  it("only bulk-classifies missing or legacy tags as Training with a typed confirmation and audit trail", () => {
    expect(router).toContain("bulkClassifyMigrationTrainingStage: adminProcedure");
    expect(router).toContain('confirmation: z.literal("CLASSIFY AS TRAINING")');
    expect(router).toContain("migration_training_stage_bulk_classified");
    expect(router).toContain("academy_migration_stage_queue_bulk");
    expect(router).toContain("Only current agents can be classified here");
    expect(router).toContain("academyAcceleratorStartedAt");
    expect(insights).toContain("CLASSIFY AS TRAINING");
    expect(insights).toContain("Set Accelerator + complete");
  });

  it("offers selected current agents all three stages while reserving legacy completion for Accelerator or Accredited", () => {
    const helper = router.slice(
      router.indexOf("async function bulkUpdateAcademyMigrationStages"),
      router.indexOf("async function applyBulkAcademyMigration")
    );
    expect(router).toContain("bulkUpdateMigrationTrainingStages: adminProcedure");
    expect(router).toContain('confirmation: z.literal("UPDATE SELECTED STAGES")');
    expect(helper).toContain('params.trainingStage === "Agent Accelerator" || params.trainingStage === "Accredited"');
    expect(helper).toContain("academy_lesson_progress");
    expect(helper).toContain("migration_training_stage_selected_update");
    expect(helper).toContain("academy_migration_stage_queue_selected");
    expect(helper).toContain("One or more selected agents are no longer current");
    expect(helper).not.toContain("INSERT INTO academy_assessment_attempts");
    expect(insights).toContain("Set Accredited + complete");
    expect(insights).toContain("Set Accelerator + complete");
    expect(insights).toContain("Select all on this page");
    expect(insights).toContain("UPDATE SELECTED STAGES");
  });
});
