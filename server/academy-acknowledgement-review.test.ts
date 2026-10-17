import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const courseSource = readFileSync(resolve(process.cwd(), "client/src/pages/academy/AcademyCourse.tsx"), "utf8");
const adminSource = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");

describe("Academy acknowledgement and staff review", () => {
  it("records acknowledgement as a separate durable learner action before lesson completion", () => {
    expect(routerSource).toContain("acknowledgeLesson: protectedProcedure");
    expect(routerSource).toContain('action: "lesson_acknowledged"');
    expect(routerSource).toContain("if (lesson.requiresAcknowledgement && !existing?.acknowledgedAt)");
    expect(routerSource).toContain("Please acknowledge this lesson before submitting the knowledge check");
    expect(courseSource).toContain("trpc.academy.agent.acknowledgeLesson.useMutation");
    expect(courseSource).toContain("I acknowledge this lesson");
    expect(courseSource).toContain("Acknowledge this lesson above before marking it complete.");
  });

  it("exposes a staff-only learner review containing durable progress, answer and feedback history", () => {
    expect(routerSource).toContain("learnerReview: adminProcedure");
    expect(routerSource).toContain("selectedAnswer:");
    expect(routerSource).toContain("correctAnswer:");
    expect(routerSource).toContain("feedbackAcknowledgedAt:");
    expect(routerSource).toContain("academyAuditLog");
    expect(adminSource).toContain("Learner review");
    expect(adminSource).toContain("Lesson progress and assessment history");
    expect(adminSource).toContain("Saved acknowledgements show that the learner explicitly confirmed a lesson or feedback.");
  });
});
