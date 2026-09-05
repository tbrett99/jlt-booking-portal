import { describe, expect, it } from "vitest";
import { isVersionedBuildAsset } from "./vite";

describe("production static asset caching", () => {
  it("identifies Vite build assets as safe for immutable caching", () => {
    expect(isVersionedBuildAsset("/app/dist/public/assets/index-DPsokLG6.js")).toBe(true);
    expect(isVersionedBuildAsset("assets/AdminCommissions-9c6d1.js")).toBe(true);
  });

  it("does not mark the HTML entrypoint or public files as immutable assets", () => {
    expect(isVersionedBuildAsset("/app/dist/public/index.html")).toBe(false);
    expect(isVersionedBuildAsset("/app/dist/public/favicon.ico")).toBe(false);
  });
});
