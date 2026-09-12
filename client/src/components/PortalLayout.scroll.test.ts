import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./PortalLayout.tsx", import.meta.url)), "utf8");

describe("PortalLayout route scrolling", () => {
  it("resets the actual overflow content element for every route, including lazy-loaded pages", () => {
    expect(source).toContain('const contentScrollRef = useRef<HTMLElement>(null)');
    expect(source).toContain('window.history.scrollRestoration = "manual"');
    expect(source).toContain('contentScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" })');
    expect(source).toContain('data-portal-primary-scroll-root');
    expect(source).toContain('const lazyRouteFollowUp = window.setTimeout(resetPortalContentScroll, 500)');
    expect(source).toContain('}, [location]);');
  });
});
