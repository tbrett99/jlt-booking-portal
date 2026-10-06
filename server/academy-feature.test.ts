import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const crmSource = readFileSync(resolve(process.cwd(), "server/crm-router.ts"), "utf8");

describe("JLT Academy feature safeguards", () => {
  it("keeps assessment answer keys out of the agent course response", () => {
    expect(source).toContain("Correct answer keys and staff-only question explanation stay server-side");
    expect(source).toContain("answerOptions: asOptions(question.answerOptions)");
    expect(source).not.toContain("questions: lesson.questions.map((question) => ({ ...question" );
  });

  it("promotes core-course completion to Agent Accelerator but keeps accreditation staff-gated", () => {
    expect(source).toContain('trainingStage: "Agent Accelerator"');
    expect(source).toContain("getAccreditationEligibility(profile?.academyAcceleratorStartedAt)");
    expect(source).toContain('trainingStage: "Accredited"');
  });

  it("grants access only through explicit staff approval and enrols published core courses", () => {
    expect(crmSource).toContain("fields.academyAccessApproved === true");
    expect(crmSource).toContain("grantAcademyAccess({ agentId: userId, actorId: ctx.user.id })");
    expect(source).toContain('eq(academyCourses.status, "published")');
    expect(source).toContain('eq(academyCourses.isCoreAcademy, true)');
  });

  it("uses a native prepared insert for new Academy courses on production TiDB", () => {
    expect(source).toContain("getRawDbPool");
    expect(source).toContain("INSERT INTO academy_courses");
    expect(source).toContain("VALUES (?, ?, ?, ?, ?, ?, ?)");
  });

  it("uses a native prepared insert and validates the returned ID for new lessons", () => {
    expect(source).toContain("INSERT INTO academy_lessons");
    expect(source).toContain("Academy lesson insert did not return an ID");
    expect(source).toContain("Number.isSafeInteger(id)");
  });
});
