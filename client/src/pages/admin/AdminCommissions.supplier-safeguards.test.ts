import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./AdminCommissions.tsx", import.meta.url)), "utf8");

describe("commission management supplier safeguard", () => {
  it("flags manual claims containing the specified transfer or ancillary suppliers", () => {
    expect(source).toContain("hasKeyTransferSupplier?: boolean");
    expect(source).toContain("Key suppliers");
    expect(source).toContain("Check PTS suppliers");
    expect(source).toContain("Suntransfers / Transferz / Holiday Extras");
  });

  it("shows a manual Orbit financial comparison without claiming an automatic PTS match", () => {
    expect(source).toContain("Orbit financials");
    expect(source).toContain("Orbit total net:");
    expect(source).toContain("Net cost incomplete");
    expect(source).toContain("Do not use this as the full PTS comparison figure.");
    expect(source).toContain("Compare the complete net total to PTS manually.");
    expect(source).not.toContain("PTS matched");
  });
});
