import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canPublishLibraryContent,
  isSafeHttpsUrl,
  matchesLibrarySearch,
  sanitiseLibraryHtml,
  stripLibraryHtml,
} from "./library-router";

const source = readFileSync(resolve(process.cwd(), "server/library-router.ts"), "utf8");
const schemaSource = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");

describe("Knowledge Base and Webinar Library safeguards", () => {
  it("keeps readable article formatting while stripping active HTML", () => {
    expect(sanitiseLibraryHtml(`<h2 onclick="alert(1)">Guide</h2><script>alert(1)</script><p><a href="javascript:alert(1)">Open</a></p>`)).toBe(
      `<h2>Guide</h2>alert(1)<p><a>Open</a></p>`,
    );
    expect(stripLibraryHtml("<h2>Trusted <em>JLT</em> guidance</h2>")).toBe("Trusted JLT guidance");
  });

  it("accepts only HTTPS recording links and requires them before publishing webinars", () => {
    expect(isSafeHttpsUrl("https://www.loom.com/share/abc123")).toBe(true);
    expect(isSafeHttpsUrl("http://www.loom.com/share/abc123")).toBe(false);
    expect(canPublishLibraryContent({ title: "Selling with confidence", videoUrl: null }, "webinar")).toMatch(/HTTPS recording link/);
    expect(canPublishLibraryContent({ title: "Selling with confidence", videoUrl: "https://www.loom.com/share/abc123" }, "webinar")).toBeNull();
  });

  it("searches titles, summaries, categories and staff tags without relying on raw HTML", () => {
    const item = {
      title: "Handling travel amendments",
      summary: "A practical guide for supplier changes.",
      category: "Bookings",
      tags: ["customer care", "changes"],
    };
    expect(matchesLibrarySearch(item, "travel changes")).toBe(true);
    expect(matchesLibrarySearch(item, "bookings customer")).toBe(true);
    expect(matchesLibrarySearch(item, "commission")).toBe(false);
  });

  it("withholds private webinar transcripts from agent detail payloads and awards each completion only once", () => {
    expect(source).toContain("const { privateTranscript: _privateTranscript, ...safeWebinar } = webinar");
    expect(schemaSource).toContain("uniqueIndex(\"library_activity_user_content_unique\"");
    expect(source).toContain("sourceType: input.contentType === \"article\" ? \"knowledge_base_article\" : \"webinar_library_item\"");
    expect(source).toContain("previous?.completedAt");
  });

  it("notifies only active Portal agents when staff deliberately announce a published resource", () => {
    expect(source).toContain('eq(users.role, "agent"), eq(users.isActive, true), eq(users.portalStatus, "active")');
    expect(source).toContain("if (input.status === \"published\" && input.notifyAgents)");
  });
});
