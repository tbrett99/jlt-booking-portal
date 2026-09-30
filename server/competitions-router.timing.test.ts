import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./competitions-router.ts", import.meta.url)), "utf8");

describe("competition deadline enforcement", () => {
  it("excludes elapsed active records from agent competition views", () => {
    expect(source).toContain("return rows.filter((competition) => isCompetitionOpen(competition.endDate))");
    expect(source).toContain(".filter((competition) => isCompetitionOpen(competition.endDate));");
  });

  it("blocks submissions after the UK midnight deadline while preserving the configured date window", () => {
    expect(source).toContain("if (!isCompetitionOpen(comp.endDate))");
    expect(source).toContain("This competition closed at midnight UK time.");
    expect(source).toContain("const startDate = competitionStartsAt(comp.startDate)");
    expect(source).toContain("const endDate = competitionClosesAt(comp.endDate)");
  });

  it("stores future competition date selections as timezone-neutral calendar dates", () => {
    expect(source).toContain("startDate: competitionCalendarStart(input.startDate)");
    expect(source).toContain("endDate: competitionCalendarEnd(input.endDate)");
    expect(source).toContain("updates.startDate = competitionCalendarStart(input.startDate)");
    expect(source).toContain("updates.endDate = competitionCalendarEnd(input.endDate)");
  });
});
