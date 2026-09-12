import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./DashboardLayout.tsx", import.meta.url)), "utf8");

describe("DashboardLayout route scrolling", () => {
  it("resets the document viewport both immediately and after the next frame whenever location changes", () => {
    expect(source).toContain('window.scrollTo({ top: 0, left: 0, behavior: "auto" })');
    expect(source).toContain('document.documentElement.scrollTop = 0');
    expect(source).toContain('document.body.scrollTop = 0');
    expect(source).toContain('window.history.scrollRestoration = "manual"');
    expect(source).toContain('"[data-portal-scroll-root], [data-portal-route-content]"');
    expect(source).toContain('data-portal-scroll-root');
    expect(source).toContain('data-portal-route-content');
    expect(source).toContain('window.requestAnimationFrame(scrollToTop)');
    expect(source).toContain('}, [location]);');
  });
});
