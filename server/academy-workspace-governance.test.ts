import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const router = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const alerts = readFileSync(resolve(process.cwd(), "server/academy-email-alerts.ts"), "utf8");
const actions = readFileSync(resolve(process.cwd(), "server/agent-development-router.ts"), "utf8");
const manager = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");
const actionManager = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademyActions.tsx"), "utf8");
const learnerOperations = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademyProgressInsights.tsx"), "utf8");
const navigation = readFileSync(resolve(process.cwd(), "client/src/components/PortalLayout.tsx"), "utf8");
const workspaceNav = readFileSync(resolve(process.cwd(), "client/src/components/AcademyWorkspaceNav.tsx"), "utf8");

describe("Academy workspace and governance overhaul", () => {
  it("uses one staff workspace navigator across content, learners and Actions, with a direct agent Action link", () => {
    expect(workspaceNav).toContain("Courses");
    expect(workspaceNav).toContain("Learners & Support");
    expect(workspaceNav).toContain("Journey & Actions");
    expect(workspaceNav).toContain("Notifications");
    expect(manager).toContain('<AcademyWorkspaceNav active="courses"');
    expect(learnerOperations).toContain('<AcademyWorkspaceNav active="learners"');
    expect(actionManager).toContain('<AcademyWorkspaceNav active="actions"');
    expect(navigation).toContain('{ label: "My Academy Actions", href: "/academy/actions"');
  });

  it("blocks publishing a knowledge check with no questions and keeps 100% as the authoring default", () => {
    expect(router).toContain("incompleteKnowledgeChecks");
    expect(router).toContain("Add at least one question before publishing");
    expect(router).toContain("assessmentPassMark: z.number().int().min(1).max(100).default(100)");
    expect(manager).toContain("assessmentPassMark: 100");
  });

  it("keeps destructive actions and assessment rewrites protected while allowing staff to revise evidenced lesson content", () => {
    expect(router).toContain("async function hasAcademyLearnerEvidence");
    expect(router).toContain("cannot be deleted");
    expect(router).toContain("knowledge check has learner evidence");
    expect(router).toContain("Create a replacement lesson");
    const lessonSaveSection = router.slice(router.indexOf("saveLesson:"), router.indexOf("deleteLesson:"));
    expect(lessonSaveSection).toContain("Updated lesson after learner activity");
    expect(lessonSaveSection).toContain("learnerEvidencePresent: true");
    expect(lessonSaveSection).not.toContain("if (hasLearnerEvidence &&");
  });

  it("allows only presentation-only assessment question edits after learner activity", () => {
    const assessmentSaveSection = router.slice(router.indexOf("replaceQuestions:"), router.indexOf("importMultipleChoiceQuestions:"));
    expect(assessmentSaveSection).toContain("isFormattingOnlyAssessmentQuestionRevision");
    expect(assessmentSaveSection).toContain('action: "assessment_formatting_updated"');
    expect(assessmentSaveSection).toContain("presentation-only changes to question text and private marking guides");
    expect(assessmentSaveSection).toContain("answers, marking settings, question order and substantive wording are protected");
  });

  it("makes staff overrides use the same Accelerator journey and entry-Action hand-off as normal completion", () => {
    const overrideSection = router.slice(router.indexOf("overrideCompletion:"), router.indexOf("approveAccreditation:"));
    expect(overrideSection).toContain("await enrolAgentInAcceleratorJourneys");
    expect(overrideSection).toContain("await assignAcceleratorEntryActions");
  });

  it("keeps Accelerator reminders personalised to an assignment deadline and requires an explicit early publish", () => {
    expect(actions).toContain("assignmentDueAt: assignment.dueAt");
    expect(actions).toContain("options: { publishNow?: boolean }");
    expect(actions).toContain("use the explicit Publish now control");
    expect(actionManager).toContain("Publish now");
    expect(actionManager).toContain("Publish it now and notify eligible agents instead?");
  });

  it("validates alert scope, avoids duplicate fixed Support delivery and retains alert delivery history", () => {
    expect(alerts).toContain("ACADEMY_MODULE_SCOPED_ALERT_EVENTS");
    expect(alerts).toContain("hasActiveAcademySupportAlert");
    expect(router).toContain("academyAlertAllowsModuleScope");
    expect(router).toContain("emailAlertActivity:");
    expect(router).toContain("configuredSupportAlert");
    expect(manager).toContain("Recent alert delivery");
    expect(manager).toContain("emailAlertActivity");
  });

  it("gives staff a visual Week 0–8 Accelerator map with learning modules and linked Actions", () => {
    expect(actionManager).toContain("Accelerator journey planner");
    expect(actionManager).toContain("Array.from({ length: 9 }");
    expect(actionManager).toContain("Add Week {week} Action");
    expect(actionManager).toContain("Friday release");
  });
});
