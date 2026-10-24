import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceleratorWeekActionDueAt,
  acceleratorWeekReleaseAt,
  firstAcceleratorFridayReleaseAt,
  isAcceleratorWeekAvailable,
} from "./academy-journey";

const router = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const actions = readFileSync(resolve(process.cwd(), "server/agent-development-router.ts"), "utf8");
const alerts = readFileSync(resolve(process.cwd(), "server/academy-email-alerts.ts"), "utf8");
const scheduler = readFileSync(resolve(process.cwd(), "server/scheduler.ts"), "utf8");
const crm = readFileSync(resolve(process.cwd(), "server/crm-router.ts"), "utf8");
const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");

function london(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

describe("Agent Accelerator eight-week journey", () => {
  it("releases Week 1 on the next Friday at 09:00 UK time, including the same Friday before 09:00", () => {
    expect(london(firstAcceleratorFridayReleaseAt(new Date("2026-10-23T07:30:00.000Z")))).toContain("Friday, 23/10/2026, 09:00");
    // BST is still active on 23 October; 09:00 London is 08:00 UTC.
    expect(firstAcceleratorFridayReleaseAt(new Date("2026-10-23T07:30:00.000Z")).toISOString()).toBe("2026-10-23T08:00:00.000Z");
    expect(firstAcceleratorFridayReleaseAt(new Date("2026-10-23T08:01:00.000Z")).toISOString()).toBe("2026-10-30T09:00:00.000Z");
  });

  it("maintains personal Friday scheduling and a Thursday 20:00 UK deadline across the BST change", () => {
    const started = new Date("2026-10-22T12:00:00.000Z");
    expect(acceleratorWeekReleaseAt(started, 1).toISOString()).toBe("2026-10-23T08:00:00.000Z");
    expect(acceleratorWeekReleaseAt(started, 2).toISOString()).toBe("2026-10-30T09:00:00.000Z");
    expect(acceleratorWeekActionDueAt(started, 1).toISOString()).toBe("2026-10-29T20:00:00.000Z");
    expect(isAcceleratorWeekAvailable(started, 1, new Date("2026-10-23T07:59:59.000Z"))).toBe(false);
    expect(isAcceleratorWeekAvailable(started, 1, new Date("2026-10-23T08:00:00.000Z"))).toBe(true);
  });

  it("keeps the immediate introduction accessible but enforces timed weekly releases at the server boundary", () => {
    expect(router).toContain('isAcceleratorWeekAvailable(fullEnrollment?.journeyStartedAt, targetModule.releaseWeek)');
    expect(router).toContain('This section is scheduled for ${acceleratorWeekReleaseLabel');
    expect(router).toContain('releaseLocked');
    expect(router).toContain('journeyStartedAt: course.isAcceleratorJourney');
  });

  it("starts a journey from both core-course completion and the CRM Agent Accelerator stage", () => {
    expect(router).toContain('await enrolAgentInAcceleratorJourneys({ agentId: enrollment.agentId, actorId, startedAt: now })');
    expect(crm).toContain('data.trainingStage === "Agent Accelerator"');
    expect(crm).toContain('await enrolAgentInAcceleratorJourneys({ agentId: userId, actorId: ctx.user.id })');
  });

  it("assigns course-linked Actions only at each learner’s Friday release with an individual deadline", () => {
    expect(actions).toContain('releaseAvailableJourneyActions');
    expect(actions).toContain('acceleratorWeekActionDueAt(enrollment.journeyStartedAt, week)');
    expect(actions).toContain('plan.courseId && plan.courseWeek ? []');
    expect(schema).toContain('dueAt: timestamp("dueAt")');
    expect(scheduler).toContain('cron.schedule("0 9 * * 5"');
    expect(scheduler).toContain('cron.schedule("10 8 * * 1-5"');
  });

  it("keeps bespoke and support alert delivery auditable and exactly once per rule, learner and event", () => {
    expect(schema).toContain('mysqlTable("academy_email_alerts"');
    expect(schema).toContain('mysqlTable("academy_email_alert_deliveries"');
    expect(schema).toContain('uniqueIndex("academy_email_alert_delivery_unique")');
    expect(alerts).toContain('dispatchAcademyEmailAlerts');
    expect(router).toContain('eventType: "written_assessment_ready"');
    expect(router).toContain('eventType: "three_attempt_lock"');
    expect(router).toContain('eventType: "course_completed"');
    expect(actions).toContain('eventType: "action_submitted_for_review"');
    expect(actions).toContain('eventType: "action_overdue"');
  });
});
