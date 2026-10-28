import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "client/src/pages/library/LibraryBrowser.tsx"),
  "utf8",
);

describe("Library Browser detail navigation", () => {
  it("subscribes to query-string changes so a webinar card opens its detail view", () => {
    expect(source).toContain('import { Link, useLocation, useSearch } from "wouter";');
    expect(source).toContain("const searchParams = useSearch();");
    expect(source).toContain("new URLSearchParams(searchParams).get(paramName)");
    expect(source).toContain("}, [paramName, searchParams]);");
    expect(source).toContain("/webinars?webinar=${item.id}");
  });

  it("keeps the same reactive deep-link behaviour for Knowledge Base articles", () => {
    expect(source).toContain("/knowledge-base?article=${item.id}");
    expect(source).toContain("trpc.library.webinar.useQuery({ id: selectedId ?? 1 }");
    expect(source).toContain("enabled: kind === \"webinar\" && !!selectedId");
  });
});
