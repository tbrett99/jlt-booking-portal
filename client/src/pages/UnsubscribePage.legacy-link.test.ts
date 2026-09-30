import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "client/src/pages/UnsubscribePage.tsx"),
  "utf8",
);

describe("UnsubscribePage legacy link support", () => {
  it("forwards existing page-based token links to the server-side opt-out route", () => {
    expect(source).toContain('const token = params.get("token")');
    expect(source).toContain('window.location.replace(`/api/unsubscribe?token=${encodeURIComponent(token)}`)');
  });
});
