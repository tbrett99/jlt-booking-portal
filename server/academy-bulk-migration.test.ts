import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
});
