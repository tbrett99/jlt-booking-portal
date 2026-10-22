import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countAgentOpenRequests } from "../shared/agent-open-requests";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("agent dashboard open requests", () => {
  it("keeps every live request type in a separate, visible total", () => {
    expect(countAgentOpenRequests({
      flightRequests: 2,
      amendments: 3,
      reimbursements: 4,
      refunds: 5,
      cancellations: 6,
    })).toBe(20);
  });

  it("returns pending cancellations alongside existing request types", () => {
    const router = read("server/routers.ts");
    expect(router).toContain("agentOutstandingSummary");
    expect(router).toContain("const cancellationRows");
    expect(router).toContain('eq(cancellations.status, "pending")');
    expect(router).toContain("cancellations: cancellationRows.map");
  });

  it("places requests in progress prominently on the agent home dashboard", () => {
    const dashboard = read("client/src/pages/agent/AgentDashboard.tsx");
    expect(dashboard).toContain("agentOutstandingSummary.useQuery");
    expect(dashboard).toContain("Requests in progress");
    expect(dashboard).toContain("Cancellation request");
    expect(dashboard).toContain("No flight requests in progress");
  });
});
