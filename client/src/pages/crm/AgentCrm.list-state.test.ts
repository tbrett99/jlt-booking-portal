import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");

describe("Agent CRM list states", () => {
  it("keeps a real query failure distinct from an empty agent list", () => {
    expect(source).toContain("isLoading: agentsLoading");
    expect(source).toContain("isError: agentsError");
    expect(source).toContain("The CRM list could not be loaded.");
    expect(source).toContain("No agent records have been removed.");
    expect(source).toContain("Retry CRM list");
  });

  it("shows a loading state before evaluating the no-agent empty state", () => {
    const loadingIndex = source.indexOf("agentsLoading ? (");
    const errorIndex = source.indexOf("agentsError ? (");
    const emptyIndex = source.indexOf("filtered.length === 0 ? (");

    expect(loadingIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeGreaterThan(loadingIndex);
    expect(emptyIndex).toBeGreaterThan(errorIndex);
    expect(source).toContain("Loading registered agents…");
  });
});
