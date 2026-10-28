import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

describe("production bundle optimisation", () => {
  it("keeps development-only JSX location instrumentation out of Railway builds", () => {
    expect(viteConfig).toContain('const isProductionBuild = process.env.NODE_ENV === "production";');
    expect(viteConfig).toContain('...(isProductionBuild ? [] : [jsxLocPlugin(), vitePluginManusDebugCollector()]),');
  });

  it("continues to load the runtime integration in production", () => {
    expect(viteConfig).toContain("vitePluginManusRuntime(),");
  });
});
