import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./AdminCommissions.tsx", import.meta.url)), "utf8");

describe("Commission Management search and agent filtering", () => {
  it("filters every commission status by the selected agent and search term", () => {
    expect(source).toContain('const [commissionSearch, setCommissionSearch] = useState("")');
    expect(source).toContain('const [agentFilter, setAgentFilter] = useState("all")');
    expect(source).toContain("const filteredClaims = useMemo");
    expect(source).toContain("claimMatchesCommissionSearch(claim, commissionSearch)");
    expect(source).toContain("filteredClaims.filter((c) => c.status === \"processing\")");
    expect(source).toContain("filteredClaims.filter((c) => c.status === \"paid\")");
  });

  it("searches client and agent names plus PTS, Topdog and booking references", () => {
    expect(source).toContain("claim.booking?.clientName");
    expect(source).toContain("claim.agentName");
    expect(source).toContain("claim.booking?.ptsRef");
    expect(source).toContain("claim.booking?.topdogRef");
    expect(source).toContain("Client, agent, PTS ref, Topdog ref or booking ID");
  });

  it("constrains the agent cell so email addresses do not widen the tables", () => {
    expect(source).toContain("function AgentCell");
    expect(source).toContain('className="w-36 max-w-[9rem] sm:w-40 sm:max-w-[10rem]"');
    expect(source).toContain('className="truncate text-xs text-muted-foreground"');
  });
});
