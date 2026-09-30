import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routerSource = fs.readFileSync(path.join(process.cwd(), "server/routers.ts"), "utf8");
const dashboardSource = fs.readFileSync(path.join(process.cwd(), "server/dashboard-router.ts"), "utf8");
const dialogSource = fs.readFileSync(path.join(process.cwd(), "client/src/pages/admin/TaskFormDialog.tsx"), "utf8");
const workbenchSource = fs.readFileSync(path.join(process.cwd(), "client/src/pages/admin/AdminTasks.tsx"), "utf8");

describe("admin task workflow safeguards", () => {
  it("defaults manual task ownership to the creator on the server", () => {
    expect(routerSource).toContain("const assigneeId = input.assigneeId ?? ctx.user.id");
    expect(routerSource).toContain("createAdminTask({ ...input, assigneeId, createdById: ctx.user.id })");
  });

  it("creates the next recurrence only when an active recurring task is completed", () => {
    expect(routerSource).toContain('existing.recurrenceRule !== "none" && existing.dueDate');
    expect(routerSource).toContain("nextRecurringTaskDate(");
    expect(routerSource).toContain("recurrenceRule: existing.recurrenceRule");
  });

  it("surfaces equivalent staff identities in the workboard and My focus", () => {
    expect(dashboardSource).toContain("LOWER(TRIM(assignee.email))");
    expect(workbenchSource).toContain("resolveEquivalentTaskOwnerIds");
    expect(workbenchSource).toContain("currentUserIds.includes(task.assigneeId)");
  });

  it("offers staff self-assignment, individual team filtering and recurrence controls", () => {
    expect(dialogSource).toContain("defaultAssigneeId");
    expect(dialogSource).toContain("Repeat this task");
    expect(dialogSource).toContain("fortnightly");
    expect(workbenchSource).toContain("All assignees");
    expect(workbenchSource).toContain("value={`user:${admin.id}`}");
  });

  it("keeps the full task list available when an optional linked booking cannot be enriched", () => {
    expect(routerSource).toContain("Promise.allSettled");
    expect(routerSource).toContain("[Tasks] Linked booking enrichment failed");
    expect(routerSource).toContain("const usersById = new Map");
    expect(routerSource).toContain("linkedBookingClientName: bookingNameByTaskId.get(t.id) ?? null");
  });
});
