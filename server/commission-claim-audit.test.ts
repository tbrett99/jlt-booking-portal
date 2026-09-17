import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./routers.ts", import.meta.url)), "utf8");

describe("manual commission claim declaration audit", () => {
  it("records an internal immutable booking note with the claimant's completion and supplier declaration", () => {
    expect(source).toContain("[Commission claim audit]");
    expect(source).toContain("confirmed the booking is complete with no further amendments, reimbursements, or refunds due");
    expect(source).toContain("Suntransfers, Transferz, or Holiday Extras:");
    expect(source).toContain("isInternal: true");
  });

  it("provides an admin-only booking claim lookup without exposing claim declarations to public callers", () => {
    expect(source).toContain("byBooking: adminProcedure");
    expect(source).toContain("getCommissionClaimByBooking(input.bookingId) ?? null");
  });
});
