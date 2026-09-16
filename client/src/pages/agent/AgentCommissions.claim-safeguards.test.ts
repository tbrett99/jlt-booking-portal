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

  it("explains that pre-authorised claims wait until seven days after departure", () => {
    expect(source).toContain("seven full days have passed after the client’s departure date");
    expect(source).toContain("Claims wait until seven full days after departure");
  });
});
