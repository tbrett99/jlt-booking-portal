import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const communityPage = readFileSync(resolve(process.cwd(), "client/src/pages/Community.tsx"), "utf8");
const portalCss = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

describe("Community rich-post rendering", () => {
  it("uses an explicit renderer rather than optional Typography utilities", () => {
    expect(communityPage).toContain('"community-post-content mt-3 max-w-none text-[15px] leading-7 text-foreground"');
    expect(communityPage).not.toContain('"prose prose-sm mt-3 max-w-none text-foreground prose-p:leading-6"');
  });

  it("restores readable structure for HTML authored in the Community editor", () => {
    expect(portalCss).toContain(".community-post-content p");
    expect(portalCss).toContain(".community-post-content ul { list-style-type: disc !important; }");
    expect(portalCss).toContain(".community-post-content ol { list-style-type: decimal !important; }");
    expect(portalCss).toContain(".community-post-content li");
    expect(portalCss).toContain(".community-post-content h1,");
    expect(portalCss).toContain(".community-post-content blockquote");
    expect(portalCss).toContain(".community-post-content--collapsed");
  });
});
