import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(
  resolve(process.cwd(), "server/academy-router.ts"),
  "utf8"
);
const learnerManagerSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"),
  "utf8"
);
const insightsSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/admin/AdminAcademyProgressInsights.tsx"),
  "utf8"
);

describe("Academy original-training completion recording", () => {
  it("allows staff to record either one lesson or the required pathway in one module", () => {
    expect(routerSource).toContain('recordMigrationCompletion: adminProcedure');
    expect(routerSource).toContain('scope: z.enum(["lesson", "module"])');
    expect(routerSource).toContain('module!.lessons.filter((item) => item.isRequired)');
    expect(routerSource).toContain("This module has no required lessons. Record any completed optional lesson individually.");
  });

  it("preserves genuine history, avoids duplicate completion records and records the staff reason", () => {
    expect(routerSource).toContain('const lessonIdsToRecord = targetLessonIds.filter((lessonId) => !completedLessonIds.has(lessonId))');
    expect(routerSource).toContain('ON DUPLICATE KEY UPDATE');
    expect(routerSource).toContain('action: "migration_completion_recorded"');
    expect(routerSource).toContain('source: "original_training_migration"');
    expect(routerSource).toContain('skippedAlreadyCompletedLessonIds');
    expect(routerSource).toContain('reason: input.reason');
    expect(routerSource).toContain('recalculateCompletion(enrollment.id, ctx.user.id)');
  });

  it("shows the dedicated staff controls and a clear historical label in learner review", () => {
    expect(learnerManagerSource).toContain("Record module complete");
    expect(learnerManagerSource).toContain("Record complete");
    expect(learnerManagerSource).toContain("Staff-recorded");
    expect(learnerManagerSource).toContain("Recorded from original training");
    expect(insightsSource).toContain("recordMigrationCompletion.useMutation");
    expect(insightsSource).toContain("This will be kept in the Academy audit history.");
  });

  it("keeps learner reviews inside Academy with collapsed modules and searchable lesson history", () => {
    expect(learnerManagerSource).not.toContain("/crm/agents?agent=");
    expect(learnerManagerSource).toContain("Learner review");
    expect(learnerManagerSource).toContain("Close review");
    expect(learnerManagerSource).toContain("Search a module or lesson…");
    expect(learnerManagerSource).toContain("Modules are collapsed by default. Search opens relevant results only.");
    expect(learnerManagerSource).toContain("expandedModuleIds");
    expect(learnerManagerSource).toContain("aria-expanded={expanded}");
    expect(learnerManagerSource).toContain("No module or lesson matches");
  });
});
