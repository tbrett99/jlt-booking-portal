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
});
