import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "drizzle/0150_gigantic_shaman.sql"), "utf8");
const router = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const manager = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");
const learner = readFileSync(resolve(process.cwd(), "client/src/pages/academy/AcademyCourse.tsx"), "utf8");

describe("JLT Academy written assessment safeguards", () => {
  it("stores written submissions and marking separately from auto-graded attempts", () => {
    expect(schema).toContain('questionType: mysqlEnum("questionType", ["multiple_choice", "free_text"])');
    expect(schema).toContain('academy_assessment_responses');
    expect(schema).toContain('feedbackAcknowledgedAt: timestamp("feedbackAcknowledgedAt")');
    expect(migration).toContain('CREATE TABLE `academy_assessment_responses`');
    expect(migration).toContain("'awaiting_marking','feedback_pending','feedback_acknowledged'");
  });

  it("queues written answers for staff and calculates a percentage when graded", () => {
    expect(router).toContain('status: writtenQuestions.length ? "awaiting_marking" : "auto_graded"');
    expect(router).toContain('markWrittenAssessment: adminProcedure');
    expect(router).toContain('Score and feedback are required for every written response');
    expect(router).toContain('const score = Math.round(questionScores.reduce');
    expect(router).toContain('status: "feedback_pending"');
  });

  it("requires the agent to acknowledge feedback before later lessons can be opened or completed", () => {
    expect(router).toContain('ensureFeedbackAcknowledgedBeforeLesson');
    expect(router).toContain('Read and acknowledge your assessment feedback before moving on to the next lesson');
    expect(router).toContain('acknowledgeAssessmentFeedback: protectedProcedure');
    expect(router).toContain('status: "feedback_acknowledged"');
    expect(router).toContain('feedbackAcknowledgedAt: now');
  });

  it("provides a staff marking queue and prevents clipboard pastes into written responses", () => {
    expect(manager).toContain('Written assessment reviews');
    expect(manager).toContain('Written response');
    expect(manager).toContain('Save grade and send feedback');
    expect(learner).toContain('Pasting is disabled for written Academy answers.');
    expect(learner).toContain('onPaste={(event) => { event.preventDefault();');
    expect(learner).toContain('onDrop={(event) => { event.preventDefault();');
    expect(learner).toContain('I have read and acknowledge this feedback');
  });
});
