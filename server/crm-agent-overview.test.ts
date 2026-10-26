import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(resolve(process.cwd(), "server/crm-router.ts"), "utf8");
const pageSource = readFileSync(resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");

describe("CRM agent-record overview", () => {
  it("provides a bounded, admin-only overview without exposing sensitive bank or supplier fields", () => {
    expect(routerSource).toContain("getOverview: adminProcedure");
    expect(routerSource).toContain("Bounded operational snapshot");
    expect(routerSource).toContain("gcPaymentFailures");
    expect(routerSource).toContain("latestPaymentEvent");
    expect(routerSource).toContain("latestNote");
    expect(routerSource).toContain("latestInteraction");
    expect(routerSource).toContain("academy: { access");
    expect(routerSource).not.toContain("getOverview: adminProcedure\n      .input(z.object({ userId: z.number().int().positive() }))\n      .query(async ({ input }) => {\n        const { getDb } = await import(\"./db\");\n        const db = await getDb();\n        if (!db) throw new TRPCError({ code: \"INTERNAL_SERVER_ERROR\", message: \"Database unavailable\" });\n        const profile = await decryptAgentBankDetails");
  });

  it("uses truthful payment language and leaves live collection schedules in Direct Debit detail", () => {
    expect(routerSource).toContain("retry dates must never");
    expect(pageSource).toContain("Mandate, subscription and payment events are deliberately shown as different things.");
    expect(pageSource).toContain("A mandate is bank authority, not proof of payment");
    expect(pageSource).toContain("Current failed-collection run");
    expect(pageSource).toContain("recorded next charge");
    expect(pageSource).toContain("explicit live collection schedule");
  });

  it("replaces the hidden horizontal tab strip with the six visible record sections", () => {
    expect(pageSource).toContain("CRM_AGENT_RECORD_SECTIONS");
    for (const label of ["Overview", "Relationship", "Membership & payments", "Academy", "Operations", "Record & history"]) {
      expect(pageSource).toContain(`label: \"${label}\"`);
    }
    expect(pageSource).toContain("AgentRecordNavigation");
    expect(pageSource).toContain("RecordDetailGroup");
    expect(pageSource).toContain("AgentOverviewTab");
    expect(pageSource).not.toContain("function ScrollableTabs");
  });

  it("keeps legacy destination names safely mapped to their new grouped section", () => {
    expect(pageSource).toContain('onboarding: "operations"');
    expect(pageSource).toContain('dd: "membership-payments"');
    expect(pageSource).toContain('notes: "relationship"');
    expect(pageSource).toContain('profile: "record-history"');
    expect(pageSource).toContain('?? "overview"');
  });
});
