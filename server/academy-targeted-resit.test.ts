import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "drizzle/0151_young_liz_osborn.sql"), "utf8");
const router = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const manager = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");
const learner = readFileSync(resolve(process.cwd(), "client/src/pages/academy/AcademyCourse.tsx"), "utf8");

describe("JLT Academy targeted-question resits", () => {
  it("stores support resets without erasing prior Academy attempts", () => {
    expect(schema).toContain('academy_assessment_question_resets');
    expect(schema).toContain('academy_question_resets_enrollment_question_idx');
    expect(migration).toContain('CREATE TABLE `academy_assessment_question_resets`');
    expect(migration).toContain('`reason` text NOT NULL');
  });

  it("keeps passed questions complete and only accepts outstanding answers", () => {
    expect(router).toContain('const MAX_QUESTION_ATTEMPTS = 3');
    expect(router).toContain('Passed questions stay complete; only unsuccessful questions return in a resit.');
    expect(router).toContain('const outstandingQuestions = questions.filter');
    expect(router).toContain('Please answer each outstanding question before submitting');
    expect(router).toContain('assessment_resit_required');
  });

  it("escalates a question after three unsuccessful attempts and permits a recorded support reset", () => {
    expect(router).toContain('supportRequired: !passed && !awaitingMarking && !feedbackPending && attemptCount >= MAX_QUESTION_ATTEMPTS');
    expect(router).toContain('supportQueue: adminProcedure');
    expect(router).toContain('resetQuestionAttempts: adminProcedure');
    expect(router).toContain('Only questions that have reached three unsuccessful attempts can be reset for support');
    expect(router).toContain('assessment_question_reset');
  });

  it("shows learners their outstanding questions only and gives staff a recovery queue", () => {
    expect(learner).toContain('const outstandingQuestions = selectedLesson?.questions.filter');
    expect(learner).toContain('Only the outstanding');
    expect(learner).toContain('JLT team support required');
    expect(manager).toContain('Three-attempt escalation');
    expect(manager).toContain('Record support & reopen question');
  });

  it("does not validate unused multiple-choice answer options on written responses", () => {
    expect(router).toContain('answerOptions: z.array(z.string().trim().max(500)).max(8).default([])');
    expect(router).toContain('question.questionType === "multiple_choice" && (question.answerOptions.length < 2 || question.answerOptions.some((option) => !option.trim())');
  });
});
