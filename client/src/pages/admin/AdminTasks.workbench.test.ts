import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "client/src/pages/admin/AdminTasks.tsx"),
  "utf8",
);

describe("Admin Tasks workbench", () => {
  it("leads staff with a personal focus view and accountable team queue", () => {
    expect(source).toContain('type TaskView = "focus" | "team" | "done"');
    expect(source).toContain("My focus");
    expect(source).toContain("Team queue");
    expect(source).toContain("Make the next action obvious.");
  });

  it("surfaces acknowledgement, today and overdue signals before the long list", () => {
    expect(source).toContain("Needs your acknowledgement");
    expect(source).toContain("Due today");
    expect(source).toContain("Team tasks overdue");
    expect(source).toContain("Act on these first");
  });

  it("uses explicit start and complete actions instead of an opaque status cycle", () => {
    expect(source).toContain("Acknowledge & start");
    expect(source).toContain("Mark complete");
    expect(source).toContain("Task acknowledged and moved to In Progress");
  });

  it("keeps useful context, update history and booking links in each task card", () => {
    expect(source).toContain("linkedBookingClientName");
    expect(source).toContain("Add a useful progress update");
    expect(source).toContain("Updated {format(new Date(lastActivity)");
  });

  it("does not misrepresent a task-query failure or an empty personal queue as zero work", () => {
    expect(source).toContain("Tasks could not be loaded");
    expect(source).toContain("The task list has not been treated as empty");
    expect(source).toContain("No tasks are assigned to you yet.");
    expect(source).toContain("Showing the active team queue instead");
    expect(source).toContain("retry: 2");
  });
});
