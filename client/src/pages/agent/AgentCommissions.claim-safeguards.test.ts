import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./AgentCommissions.tsx", import.meta.url)), "utf8");

describe("agent manual commission claim safeguards", () => {
  it("requires a booking-completion attestation and key-supplier answer before manual submission", () => {
    expect(source).toContain('id="booking-complete-confirmation"');
    expect(source).toContain("I confirm this booking is complete");
    expect(source).toContain("Suntransfers, Transferz, or Holiday Extras");
    expect(source).toContain("hasKeyTransferSupplier === null");
    expect(source).toContain("bookingCompleteConfirmed,");
    expect(source).toContain("hasKeyTransferSupplier,");
  });

  it("uses one consolidated confirmation dialog rather than a separate amendment warning step", () => {
    expect(source).not.toContain("amendmentWarningTarget");
    expect(source).not.toContain("openClaimWithWarning");
    expect(source.match(/<Dialog open=/g)).toHaveLength(1);
    expect(source).toContain("Once you claim commission on a booking");
    expect(source).toContain("new PTS file will need to be created");
  });

  it("splits the declaration and claim-entry content into compact confirmation and details steps", () => {
    expect(source).toContain('useState<"confirmation" | "details">("confirmation")');
    expect(source).toContain("Step 1 of 2 — confirm the booking is ready for commission");
    expect(source).toContain("Continue to claim details");
    expect(source).toContain("Step 2 of 2 — add the claim details");
    expect(source).toContain('onClick={() => setClaimStep("confirmation")}');
    expect(source).toContain("Booking readiness and supplier declaration confirmed.");
  });

  it("explains that pre-authorised claims wait until seven days after departure", () => {
    expect(source).toContain("seven full days have passed after the client’s departure date");
    expect(source).toContain("Claims wait until seven full days after departure");
  });
});
