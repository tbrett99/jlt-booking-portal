import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./App.tsx", import.meta.url)), "utf8");

describe("application-wide route scroll controller", () => {
  it("resets every known Portal scroll root and guards against deferred browser or route restoration", () => {
    expect(source).toContain("function RouteScrollController()");
    expect(source).toContain('window.history.scrollRestoration = "manual"');
    expect(source).toContain('document.scrollingElement as HTMLElement | null');
    expect(source).toContain('"[data-portal-primary-scroll-root], [data-portal-scroll-root], [data-portal-route-content]"');
    expect(source).toContain("document.addEventListener(\"scroll\", enforceInitialRoutePosition, true)");
    expect(source).toContain("[80, 250, 600, 1_000]");
    expect(source).toContain("<RouteScrollController />");
  });
});
