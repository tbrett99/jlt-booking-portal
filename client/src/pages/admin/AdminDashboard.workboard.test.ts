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
});
