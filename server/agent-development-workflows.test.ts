import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
const router = readFileSync(resolve(process.cwd(), "server/agent-development-router.ts"), "utf8");
const academy = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const scheduler = readFileSync(resolve(process.cwd(), "server/scheduler.ts"), "utf8");
const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
const crm = readFileSync(resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");

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
    expect(crm).toContain('TabsTrigger value="engagement"');
    expect(crm).toContain('function AgentEngagementTab');
  });
});
