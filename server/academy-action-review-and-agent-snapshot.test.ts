import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const actionRouter = readFileSync(resolve(process.cwd(), "server/agent-development-router.ts"), "utf8");
const actionPage = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademyActions.tsx"), "utf8");
const workspaceNav = readFileSync(resolve(process.cwd(), "client/src/components/AcademyWorkspaceNav.tsx"), "utf8");
const crmRouter = readFileSync(resolve(process.cwd(), "server/crm-router.ts"), "utf8");
const crmPage = readFileSync(resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");
const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");

describe("Academy Action review queue and CRM 1:1 snapshot", () => {
  it("uses a small server-side oldest-first queue rather than loading every assignment into the Action plan list", () => {
    expect(actionRouter).toContain("actionReviewSummary: adminProcedure");
    expect(actionRouter).toContain("actionReviewQueue: adminProcedure");
    expect(actionRouter).toContain('eq(academyActionAssignments.status, "review")');
    expect(actionRouter).toContain("orderBy(asc(academyActionAssignments.submittedAt), asc(academyActionAssignments.id))");
    expect(actionRouter).toContain("limit(input.limit + 1)");
    expect(schema).toContain('index("academy_action_assignments_review_submitted_idx").on(table.status, table.submittedAt, table.id)');
    const actionPlansSection = actionRouter.slice(actionRouter.indexOf("actionPlans: adminProcedure"), actionRouter.indexOf("actionReviewSummary: adminProcedure"));
    expect(actionPlansSection).toContain("assignmentCounts");
    expect(actionPlansSection).not.toContain("await db.select().from(academyActionAssignments)");
  });

  it("gives staff one filterable review inbox with evidence and safe approve or return controls", () => {
    expect(actionPage).toContain("Review inbox");
    expect(actionPage).toContain("Submitted Actions waiting for staff");
    expect(actionPage).toContain("Search agent or Action title");
    expect(actionPage).toContain("Open link evidence");
    expect(actionPage).toContain("Approve Action");
    expect(actionPage).toContain("Request changes");
    expect(actionPage).toContain("Load next submissions");
    expect(actionPage).toContain("<ActionReviewQueue");
    expect(workspaceNav).toContain("actionReviewSummary.useQuery");
    expect(workspaceNav).toContain("No evidence awaiting review");
  });

  it("returns a bounded, admin-only 1:1 briefing without raw assessment answers or Action evidence", () => {
    const snapshotSection = crmRouter.slice(crmRouter.indexOf("getCallSnapshot: adminProcedure"), crmRouter.indexOf("updateProfile: adminProcedure"));
    expect(crmRouter).toContain("Bounded, read-only briefing");
    expect(snapshotSection).toContain("academyAssessmentAttempts");
    expect(snapshotSection).toContain("academyActionAssignments");
    expect(snapshotSection).toContain("agentEngagementInteractions");
    expect(snapshotSection).toContain("agentCrmNotes");
    expect(snapshotSection).toContain(".limit(6)");
    expect(snapshotSection).not.toContain("academyAssessmentAttempts.answers");
    expect(snapshotSection).not.toContain("academyActionAssignments.completionNote");
    expect(snapshotSection).not.toContain("academyActionAssignments.evidenceFileUrl");
  });

  it("puts a clear 1:1 view in the CRM Overview with routes to the detailed record sections", () => {
    expect(crmPage).toContain("AgentCallSnapshot");
    expect(crmPage).toContain("1:1 call snapshot");
    expect(crmPage).toContain("Learning, accountability and relationship context");
    expect(crmPage).toContain("Open Academy");
    expect(crmPage).toContain("Open relationship");
    expect(crmPage).toContain("not assessment answers or uploaded evidence");
  });
});
