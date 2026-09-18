import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");

describe("Agent CRM supplier access", () => {
  it("offers Ambassador Cruises in the existing supplier portal toggle list", () => {
    expect(source).toMatch(/const SUPPLIERS = \[[\s\S]*"Ace Rooms",\s*"Ambassador Cruises",\s*"Aviate",/);
  });

  it("uses the existing optimistic supplier-login access workflow", () => {
    expect(source).toContain("addLogin.mutate({ userId, supplierName: supplier })");
    expect(source).toContain("deleteLogin.mutate({ id: login.id })");
  });
});
