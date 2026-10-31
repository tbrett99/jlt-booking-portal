import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACADEMY_ALERT_EVENTS,
  academyAlertAllowsModuleScope,
  academyAlertTemplateHint,
} from "./academy-email-alerts";

const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
const router = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const alerts = readFileSync(resolve(process.cwd(), "server/academy-email-alerts.ts"), "utf8");
const manager = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "drizzle/0169_academy-knowledge-check-pass-alert.sql"), "utf8");

describe("Academy knowledge-check pass email alerts", () => {
  it("defines a lesson-specific event rather than broadening existing course or module rules", () => {
    expect(ACADEMY_ALERT_EVENTS).toContain("knowledge_check_passed");
    expect(academyAlertAllowsModuleScope("knowledge_check_passed")).toBe(false);
    expect(schema).toContain('lessonId: int("lessonId")');
    expect(schema).toContain('"knowledge_check_passed"');
    expect(migration).toContain("ADD `lessonId` int");
    expect(migration).toContain("'knowledge_check_passed'");
    expect(migration).not.toMatch(/\b(DROP|DELETE|UPDATE|INSERT)\b/i);
  });

  it("requires an exact quiz lesson and retrieves only rules for that lesson", () => {
    expect(router).toContain('isKnowledgeCheckPassAlert && !input.lessonId');
    expect(router).toContain('Choose the specific knowledge-check lesson that must be passed');
    expect(router).toContain('lesson.lesson.assessmentMode !== "quiz"');
    expect(alerts).toContain('eq(academyEmailAlerts.lessonId, context.lessonId!)');
    expect(alerts).toContain('A knowledge-check pass alert requires a lesson target');
  });

  it("dispatches only when all questions in the automatic knowledge check have passed", () => {
    expect(router).toContain('if (assessmentPassed) {');
    expect(router).toContain('eventType: "knowledge_check_passed"');
    expect(router).toContain('eventKey: `knowledge-check-passed-${lesson.id}-${attemptId}`');
    expect(router).toContain('lessonId: lesson.id');
    expect(router).toContain('lessonTitle: lesson.title');
  });

  it("lets staff select the exact knowledge check and use its title in the email", () => {
    expect(manager).toContain('A specific knowledge check is passed');
    expect(manager).toContain('Specific knowledge check');
    expect(manager).toContain('Choose a knowledge check…');
    expect(manager).toContain('lessonId: alertRequiresKnowledgeCheckScope');
    expect(academyAlertTemplateHint()).toContain("{{lesson_title}}");
  });
});
