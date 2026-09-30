import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "client/src/pages/admin/AdminDashboard.tsx"),
  "utf8",
);

const dataSource = fs.readFileSync(
  path.join(process.cwd(), "server/dashboard-router.ts"),
  "utf8",
);

describe("Admin Dashboard operational workboard", () => {
  it("uses the dedicated compact workboard payload rather than the previous broad dashboard query", () => {
    expect(source).toContain("trpc.dashboard.workboard.useQuery");
    expect(dataSource).toContain("workboard: adminProcedure.query");
    expect(dataSource).toContain("buildPipelineHealth");
  });

  it("makes task ownership and inbox zero the primary daily work", () => {
    expect(source).toContain("My task focus");
    expect(source).toContain("Team task board");
    expect(source).toContain("Message inbox zero");
    expect(source).toContain("New task");
  });

  it("opens dashboard task cards in the task workbench rather than a linked booking", () => {
    expect(source).toContain("const taskHref = `/admin/tasks?task=${task.id}`");
    expect(source).toContain('title="Open task in the task workbench"');
  });

  it("keeps only the requested controls and replaces the former generic urgent block", () => {
    expect(source).toContain("PTS files missing payment date");
    expect(source).toContain("Claimable files missing payment date");
    expect(source).toContain("Mandate without Direct Debit");
    expect(source).not.toContain("Requires Immediate Attention");
    expect(source).not.toContain("Departures — Next 14 Days");
    expect(source).not.toContain("Recent Bookings");
  });

  it("adds calendar, queue ageing, membership, change request and Agent Win work", () => {
    expect(source).toContain("Today at JLT");
    expect(source).toContain("Active queues");
    expect(source).toContain("Pipeline stage health");
    expect(source).toContain("Membership dates to watch");
    expect(source).toContain("Change requests");
    expect(source).toContain("Latest Agent Wins");
  });

  it("keeps the live calendar card fresh and formats timed events in UK time", () => {
    expect(source).toContain('timeZone: "Europe/London"');
    expect(source).toContain("refetchOnMount: \"always\"");
    expect(source).toContain("refetchInterval: 30_000");
    expect(source).toContain("formatJltEventTime(event.startDate)");
    expect(dataSource).toContain("getCalendarEvents(todayWindow.start, todayWindow.end)");
    expect(dataSource).toContain("expandCalendarOccurrences(event, todayWindow.start, todayWindow.end)");
  });

  it("shows cancellation requests alongside the daily operational work", () => {
    expect(source).toContain("Cancellation requests");
    expect(source).toContain('href="/cancellations"');
    expect(dataSource).toContain("WHERE c.status = 'pending'");
    expect(dataSource).toContain("cancellations: {");
  });

  it("provides a persistent jump bar for every major dashboard section", () => {
    expect(source).toContain("WORKBOARD_SECTIONS");
    expect(source).toContain('aria-label="Jump to dashboard section"');
    expect(source).toContain('id="tasks"');
    expect(source).toContain('id="messages"');
    expect(source).toContain('id="calendar"');
    expect(source).toContain('id="cancellations"');
    expect(source).toContain('id="checks"');
    expect(source).toContain('id="queues"');
    expect(source).toContain('id="membership"');
    expect(source).toContain('id="wins"');
  });
});
