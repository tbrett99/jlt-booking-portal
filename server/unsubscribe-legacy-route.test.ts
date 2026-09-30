import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "server/_core/index.ts"),
  "utf8",
);

describe("legacy unsubscribe route forwarding", () => {
  it("forwards historic public page token links through the API handler before the SPA fallback", () => {
    const apiHandler = source.indexOf('app.get("/api/unsubscribe"');
    const legacyHandler = source.indexOf('app.get("/unsubscribe", (req, res, next) =>');
    const staticFallback = source.indexOf('setupStaticServing');

    expect(apiHandler).toBeGreaterThan(-1);
    expect(legacyHandler).toBeGreaterThan(apiHandler);
    expect(legacyHandler).toBeGreaterThan(-1);
    if (staticFallback > -1) expect(legacyHandler).toBeLessThan(staticFallback);
    expect(source).toContain('return res.redirect(`/api/unsubscribe?token=${encodeURIComponent(token)}`)');
  });
});
