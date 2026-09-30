import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routerSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "remittance-router.ts"),
  "utf8",
);
const pageSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "../client/src/pages/admin/RemittanceManagement.tsx"),
  "utf8",
);

describe("pushed remittance list", () => {
  it("provides an admin-only, paginated endpoint scoped to pushed rows", () => {
    expect(routerSource).toContain("getPushedLines: protectedProcedure");
    expect(routerSource).toContain("eq(remittanceLines.pushedToAgent, true)");
    expect(routerSource).toContain("pageSize: z.number().int().min(10).max(100).default(50)");
    expect(routerSource).toContain(".limit(input.pageSize)");
    expect(routerSource).toContain(".offset(offset)");
  });

  it("searches pushed rows by PTS reference or client name", () => {
    expect(routerSource).toContain("like(remittanceLines.ptsRef, pattern)");
    expect(routerSource).toContain("like(remittanceLines.clientName, pattern)");
    expect(routerSource).toContain("orderBy(desc(remittanceLines.pushedAt), desc(remittanceLines.id))");
  });

  it("renders an immediately accessible searchable, paginated pushed-history view", () => {
    expect(pageSource).toContain("function PushedLinesView");
    expect(pageSource).toContain("trpc.remittance.getPushedLines.useQuery");
    expect(pageSource).toContain("Search client name or PTS reference");
    expect(pageSource).toContain("TabsTrigger value=\"pushed\"");
    expect(pageSource).toContain("Search pushed history");
    expect(pageSource).toContain("Pushed remittance history");
    expect(pageSource).toContain("Page {currentPage} of {totalPages}");
  });
});
