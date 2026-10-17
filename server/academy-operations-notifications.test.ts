import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "drizzle/0158_shocking_franklin_storm.sql"), "utf8");
const router = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const learner = readFileSync(resolve(process.cwd(), "client/src/pages/academy/AcademyCourse.tsx"), "utf8");
const manager = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");

describe("Academy operational escalation and active-time tracking", () => {
  it("stores forward-looking lesson and knowledge-check active-time totals", () => {
    expect(schema).toContain('lessonActiveSeconds: int("lessonActiveSeconds").default(0).notNull()');
    expect(schema).toContain('assessmentActiveSeconds: int("assessmentActiveSeconds").default(0).notNull()');
    expect(schema).toContain('lastActivityAt: timestamp("lastActivityAt")');
    expect(migration).toContain('ADD `lessonActiveSeconds` int DEFAULT 0 NOT NULL');
    expect(migration).toContain('ADD `assessmentActiveSeconds` int DEFAULT 0 NOT NULL');
  });

  it("records bounded visible-session pulses without changing course progression", () => {
    expect(router).toContain('recordActivity: protectedProcedure');
    expect(router).toContain('area: z.enum(["lesson", "knowledge_check"])');
    expect(router).toContain('Math.min(60');
    expect(router).toContain('if (existing?.completedAt) return { creditedSeconds: 0 }');
    expect(learner).toContain('window.setInterval(() => recordVisibleActivity(), 30_000)');
    expect(learner).toContain('document.addEventListener("visibilitychange", onVisibilityChange)');
    expect(learner).toContain('area: isWorkingOnKnowledgeCheck ? "knowledge_check" : "lesson"');
  });

  it("emails support for written marking and when an assessment reaches a new three-attempt lock", () => {
    expect(router).toContain('sendAcademySupportAlert');
    expect(router).toContain('Academy written assessment ready to mark');
    expect(router).toContain('newlyEscalatedQuestions');
    expect(router).toContain('Academy support needed: three-attempt lock');
    expect(router).toContain('Open Academy Manager');
  });

  it("emails the learner when feedback is released and after support reopens a question", () => {
    expect(router).toContain('academy_assessment_feedback_ready');
    expect(router).toContain('Your JLT Academy feedback is ready');
    expect(router).toContain('academy_question_reopened');
    expect(router).toContain('Your JLT Academy question has been reopened');
  });

  it("shows both time totals against the specific lesson in staff learner review", () => {
    expect(manager).toContain('function formatActiveDuration');
    expect(manager).toContain('Lesson active {formatActiveDuration(lesson.progress.lessonActiveSeconds)}');
    expect(manager).toContain('Knowledge check active {formatActiveDuration(lesson.progress.assessmentActiveSeconds)}');
  });
});
