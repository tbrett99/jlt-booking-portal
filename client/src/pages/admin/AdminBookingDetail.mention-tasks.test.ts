import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "client/src/pages/admin/AdminBookingDetail.tsx"),
  "utf8",
);

describe("AdminBookingDetail mention action tasks", () => {
  it("keeps an explicit FYI opt-out for selected mention recipients", () => {
    expect(source).toContain("Create action tasks for tagged colleagues");
    expect(source).toContain("Turn off for an FYI-only tag");
    expect(source).toContain("createMentionTasks");
  });

  it("sends selected recipients and the action task choice with internal notes", () => {
    expect(source).toContain("mentionUserIds");
    expect(source).toContain("createActionTasks: shouldCreateActionTasks");
    expect(source).toContain("setSelectedMentionedAdmins([])");
  });

  it("shows booking-linked mention task states in the note history and overview", () => {
    expect(source).toContain("mentionTasksByNote");
    expect(source).toContain("Awaiting acknowledgement");
    expect(source).toContain("Admin tasks");
  });
});
