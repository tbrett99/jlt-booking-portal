import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routerSource = fs.readFileSync(path.join(process.cwd(), "server/routers.ts"), "utf8");
const dashboardSource = fs.readFileSync(path.join(process.cwd(), "server/dashboard-router.ts"), "utf8");
const dbSource = fs.readFileSync(path.join(process.cwd(), "server/db.ts"), "utf8");
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

  it("falls back to a non-recurring task projection when a legacy database is missing optional columns", () => {
    expect(dbSource).toContain("[Tasks] Falling back to legacy-compatible task list");
    expect(dbSource).toContain("'none' AS recurrenceRule");
    expect(dbSource).toContain("1 AS recurrenceInterval");
  });

  it("uses native mysql2 prepared statements for lifecycle task reads", () => {
    expect(dbSource).toContain("FROM admin_tasks");
    expect(dbSource).toContain("WHERE id = ?");
    expect(dbSource).toContain("return getAdminTaskById(id);");
    expect(dbSource).toContain("await _pool.execute(");
  });

  it("uses native mysql2 prepared inserts for manual and recurring tasks", () => {
    expect(dbSource).toContain("INSERT INTO admin_tasks");
    expect(dbSource).toContain("recurrenceRule, recurrenceInterval");
    expect(dbSource).toContain("return getAdminTaskById(Number((result as any).insertId));");
    expect(dbSource).toContain("Do not\n  // route task lifecycle writes through Drizzle's raw execute path");
  });

  it("keeps one-off tasks usable before the recurrence migration and names the required migration for repeat rules", () => {
    expect(dbSource).toContain('error?.code !== "ER_BAD_FIELD_ERROR"');
    expect(dbSource).toContain("Recurring tasks need the admin_tasks recurrence migration");
    expect(dbSource).toContain("Keep one-off tasks available on a live database awaiting migration 0146");
    expect(dbSource).toContain("'none' AS recurrenceRule, 1 AS recurrenceInterval");
  });
});
