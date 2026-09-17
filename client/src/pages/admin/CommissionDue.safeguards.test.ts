import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "client/src/pages/admin/CommissionDue.tsx"), "utf8");
const routerSource = fs.readFileSync(path.join(process.cwd(), "server/routers.ts"), "utf8");

describe("Commission Due financial and supplier safeguards", () => {
  it("loads Orbit snapshots and saved supplier declarations for due bookings", () => {
    expect(routerSource).toContain("orbitFinancialSnapshotByBookingId");
    expect(routerSource).toContain("commissionClaimByBookingId");
    expect(routerSource).toContain("orbitFinancialSnapshot:");
    expect(routerSource).toContain("commissionClaim:");
  });

  it("shows a manual Orbit comparison and never implies automatic PTS matching", () => {
    expect(source).toContain("Orbit financial snapshot");
    expect(source).toContain("Orbit total net");
    expect(source).toContain("Net cost incomplete");
    expect(source).toContain("Compare the complete net total to PTS manually.");
    expect(source).not.toContain("PTS matched");
  });

  it("shows the saved key-supplier declaration or a neutral undeclared state", () => {
    expect(source).toContain("Check PTS suppliers");
    expect(source).toContain("No key suppliers declared");
    expect(source).toContain("Not declared yet");
    expect(source).toContain("Suntransfers / Transferz / Holiday Extras");
  });
});
