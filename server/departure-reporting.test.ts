import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDepartureReasonBreakdown, normaliseDepartureReasons } from "../shared/departure-reporting";

const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
const crmRouter = readFileSync(resolve(process.cwd(), "server/crm-router.ts"), "utf8");
const crmPage = readFileSync(resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");
const biRouter = readFileSync(resolve(process.cwd(), "server/super-admin-router.ts"), "utf8");
const biPage = readFileSync(resolve(process.cwd(), "client/src/pages/admin/SuperAdminDashboard.tsx"), "utf8");

describe("Agent departure reason capture and reporting", () => {
  it("retains only recognised reason keys from stored JSON", () => {
    expect(normaliseDepartureReasons(JSON.stringify(["not_enough_time", "other", "unknown_reason"]))).toEqual(["not_enough_time", "other"]);
    expect(normaliseDepartureReasons("not valid JSON")).toEqual([]);
  });

  it("reports legacy records honestly without inferring a reason", () => {
    expect(buildDepartureReasonBreakdown([
      { departureReasons: JSON.stringify(["not_enough_time", "financial_pressure"]) },
      { departureReasons: ["not_enough_time"] },
      { departureReasons: null },
    ])).toEqual([
      { reasonKey: "not_enough_time", label: "Not enough time to run the business", count: 2 },
      { reasonKey: "financial_pressure", label: "Financial pressure / cost of membership", count: 1 },
      { reasonKey: "not_recorded", label: "Not recorded (before this process)", count: 1 },
    ]);
  });

  it("makes the reason mandatory in both the UI and protected server procedure", () => {
    expect(schema).toContain('departureReasons: json("departureReasons")');
    expect(schema).toContain('departureDetails: text("departureDetails")');
    expect(crmRouter).toContain('input.newStatus === "in_notice" && (!input.departureReasons || input.departureReasons.length === 0)');
    expect(crmPage).toContain('Why is the agent leaving?');
    expect(crmPage).toContain('departureReasons.length === 0');
  });

  it("exposes detailed retention reporting in both weekly and monthly Business Intelligence views", () => {
    expect(biRouter).toContain('departureReasons: superAdminProcedure');
    expect(biRouter).toContain('eq(agentStatusEvents.toStatus, "in_notice")');
    expect(biPage).toContain('DepartureReasonInsights rangeStart={monthStart}');
    expect(biPage).toContain('DepartureReasonInsights rangeStart={weekStartStr}');
    expect(biPage).toContain('the Portal does not infer a reason retrospectively');
  });
});
