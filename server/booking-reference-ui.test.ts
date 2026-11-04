import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (relative: string) => readFileSync(
  fileURLToPath(new URL(`../${relative}`, import.meta.url)),
  "utf8",
);

describe("booking reference uniqueness guidance", () => {
  const adminDetail = source("client/src/pages/admin/AdminBookingDetail.tsx");
  const agentDetail = source("client/src/pages/agent/AgentBookingDetail.tsx");

  it("renders the approved duplicate-prevention guidance in the reference areas", () => {
    expect(adminDetail).toContain("PTS and Orbit references must be unique across bookings.");
    expect(agentDetail).toContain("Do not reuse a reference from another booking.");
    expect(adminDetail).toContain('value={editPts}');
    expect(adminDetail).toContain('value={editCrmRef}');
    expect(agentDetail).toContain('value={ptsRefInput}');
    expect(agentDetail).toContain('value={crmRefInput}');
  });

  it("keeps entered fields intact when the admin save fails and preserves the server message", () => {
    expect(adminDetail).toContain('catch (err: any)');
    expect(adminDetail).toContain('toast.error(err.message || "Failed to save details")');
    expect(adminDetail).not.toContain("setEditPts(\"\")");
    expect(adminDetail).not.toContain("setEditCrmRef(\"\")");
  });
});
