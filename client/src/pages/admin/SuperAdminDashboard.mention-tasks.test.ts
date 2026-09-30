import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "client/src/pages/admin/SuperAdminDashboard.tsx"),
  "utf8",
);

describe("SuperAdminDashboard outstanding mention task oversight", () => {
  it("loads the dedicated live outstanding-task report", () => {
    expect(source).toContain("trpc.superAdmin.outstandingMentionTasks.useQuery");
  });

  it("shows the agreed accountability states and booking queue", () => {
    expect(source).toContain("Outstanding Admin Tasks");
    expect(source).toContain("Unacknowledged");
    expect(source).toContain("In Progress");
    expect(source).toContain("Requested action");
  });
});
