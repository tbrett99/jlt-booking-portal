import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const crmRouter = readFileSync(resolve(process.cwd(), "server/crm-router.ts"), "utf8");

describe("CRM status-event compatibility", () => {
  it("uses a prepared native insert for status audit records on TiDB", () => {
    expect(crmRouter).toContain('const { getRawDbPool } = await import("./db")');
    expect(crmRouter).toContain("INSERT INTO agent_status_events");
    expect(crmRouter).toContain("(userId, fromStatus, toStatus, adminId, notes, pauseEndsAt, noticeEndsAt,");
    expect(crmRouter).not.toContain("await db.insert(agentStatusEvents).values({");
  });

  it("serialises both JSON audit fields before sending them to MySQL", () => {
    expect(crmRouter).toContain("JSON.stringify(input.departureReasons)");
    expect(crmRouter).toContain("JSON.stringify(input.cancelChecklist)");
  });
});
