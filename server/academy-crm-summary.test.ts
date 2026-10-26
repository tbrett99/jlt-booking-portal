import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const academyRouterSource = readFileSync(
  resolve(process.cwd(), "server/academy-router.ts"),
  "utf8"
);
const progressInsightsSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/admin/AdminAcademyProgressInsights.tsx"),
  "utf8"
);
const agentCrmSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"),
  "utf8"
);

describe("Academy learner operations and CRM summary", () => {
  it("keeps the Academy learner work queue searchable, paginated and in Academy", () => {
    expect(progressInsightsSource).toContain("const learnersPerPage = 25");
    expect(progressInsightsSource).toContain("visibleLearners.map(item =>");
    expect(progressInsightsSource).toContain("Open Academy record");
    expect(progressInsightsSource).toContain("setLearnerPage(1)");
    expect(progressInsightsSource).toContain("Academy work queue");
    expect(progressInsightsSource).toContain("onClick={() => openLearner(item)}");
  });

  it("exposes an admin-only compact Academy summary for one CRM agent", () => {
    expect(academyRouterSource).toContain("agentSummary: adminProcedure");
    expect(academyRouterSource).toContain("academyAuditLog.agentId");
    expect(academyRouterSource).toContain("recentActivity");
    expect(academyRouterSource).toContain("awaitingMarking");
    expect(agentCrmSource).toContain('TabsContent value="academy"');
    expect(agentCrmSource).toContain('TabsTrigger value="academy"');
    expect(agentCrmSource).toContain("agentSummary.useQuery");
    expect(agentCrmSource).toContain("Academy overview");
    expect(agentCrmSource).toContain("Recent Academy activity");
  });
});
