import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
const router = readFileSync(resolve(process.cwd(), "server/agent-development-router.ts"), "utf8");
const academy = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const scheduler = readFileSync(resolve(process.cwd(), "server/scheduler.ts"), "utf8");
const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
const crm = readFileSync(resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");
const agentDashboard = readFileSync(resolve(process.cwd(), "client/src/pages/agent/AgentDashboard.tsx"), "utf8");
const actionManager = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademyActions.tsx"), "utf8");

describe("Agent accountability and engagement safeguards", () => {
  it("keeps practical Academy actions separate from course progress with one assignment per plan and agent", () => {
    expect(schema).toContain('mysqlTable("academy_action_plans"');
    expect(schema).toContain('mysqlTable("academy_action_assignments"');
    expect(schema).toContain('uniqueIndex("academy_action_assignment_plan_agent_unique")');
  });

  it("does not backfill weekly actions to a new Accelerator agent before their entry action is complete", () => {
    expect(router).toContain('assignmentTrigger, "on_accelerator_entry"');
    expect(router).toContain('status === "completed"');
    expect(router).toContain('assignAcceleratorEntryActions');
    expect(academy).toContain('await assignAcceleratorEntryActions(enrollment.agentId, actorId)');
  });

  it("requires configured evidence before an agent can submit and supports review only when selected", () => {
    expect(router).toContain('row.plan.requiresNote && !note');
    expect(router).toContain('row.plan.requiresUrl && !url');
    expect(router).toContain('row.plan.requiresUpload && !fileUrl');
    expect(router).toContain('row.plan.staffReviewRequired ? "review" : "completed"');
  });

  it("uses native prepared writes for Academy Actions and Engagement records on live TiDB", () => {
    expect(router).toContain('getRawDbPool');
    expect(router).toContain('INSERT INTO academy_action_plans');
    expect(router).toContain('INSERT INTO academy_action_plan_targets');
    expect(router).toContain('INSERT INTO academy_action_assignments');
    expect(router).toContain('INSERT INTO agent_engagement_cases');
    expect(router).toContain('INSERT INTO agent_engagement_interactions');
    expect(router).toContain('UPDATE agent_engagement_cases');
    expect(router).toContain('SELECT id FROM agent_engagement_cases WHERE agentId = ? AND status <> ? LIMIT 1');
  });

  it("publishes scheduled weekly plans once each Monday and keeps an audit-friendly engagement timeline", () => {
    expect(scheduler).toContain('publishScheduledAcademyActionPlans');
    expect(scheduler).toContain('"5 8 * * 1"');
    expect(schema).toContain('mysqlTable("agent_engagement_cases"');
    expect(schema).toContain('mysqlTable("agent_engagement_interactions"');
    expect(router).toContain('[Engagement · ${input.channel}]');
  });

  it("exposes actions to agents and places engagement both in its workboard and CRM profile", () => {
    expect(app).toContain('path="/academy/actions"');
    expect(app).toContain('path="/admin/agent-engagement"');
    expect(crm).toContain('engagement: "relationship"');
    expect(crm).toContain('function AgentEngagementTab');
  });

  it("delivers new Academy Actions through the dashboard, in-app notification and audited email", () => {
    expect(router).toContain('sendAcademyActionEmail');
    expect(router).toContain('New Academy action: ${params.plan.title}');
    expect(router).toContain('linkUrl: "/academy/actions"');
    expect(router).toContain('triggerKey: isReminder ? `academy_action_reminder_${params.plan.id}`');
    expect(agentDashboard).toContain('outstandingAcademyActions');
    expect(agentDashboard).toContain('Your Academy actions need attention');
    expect(agentDashboard).toContain('Academy action');
  });

  it("lets staff send a deliberate reminder to only outstanding Action assignments", () => {
    expect(router).toContain('remindActionPlanAgents');
    expect(router).toContain('["assigned", "needs_revision"]');
    expect(actionManager).toContain('Remind');
    expect(actionManager).toContain('Send an email and Portal reminder');
  });
});
