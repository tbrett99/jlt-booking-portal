import { describe, expect, it } from "vitest";
import {
  competitionCalendarEnd,
  competitionCalendarStart,
  competitionClosesAt,
  competitionClosingLabel,
  competitionStartsAt,
  isCompetitionOpen,
} from "../shared/competition-timing";

describe("UK competition calendar windows", () => {
  it("keeps a 30 September competition open until midnight in the UK", () => {
    const middayUk = new Date("2026-09-30T10:11:00.000Z"); // 11:11 BST
    const afterMidnightUk = new Date("2026-09-30T23:00:00.000Z"); // 00:00 BST, 1 Oct

    expect(competitionStartsAt("2026-09-30").toISOString()).toBe("2026-09-29T23:00:00.000Z");
    expect(competitionClosesAt("2026-09-30").toISOString()).toBe("2026-09-30T22:59:59.999Z");
    expect(isCompetitionOpen("2026-09-30", middayUk)).toBe(true);
    expect(competitionClosingLabel("2026-09-30", middayUk)).toBe("Closes tonight");
    expect(isCompetitionOpen("2026-09-30", afterMidnightUk)).toBe(false);
  });

  it("treats persisted competition timestamps as calendar dates rather than browser-local instants", () => {
    const persistedEnd = new Date("2026-09-30T23:59:59.000Z");
    const duringTheFinalUkDay = new Date("2026-09-30T21:30:00.000Z"); // 22:30 BST

    expect(isCompetitionOpen(persistedEnd, duringTheFinalUkDay)).toBe(true);
    expect(competitionClosingLabel(persistedEnd, duringTheFinalUkDay)).toBe("Closes tonight");
  });

  it("uses 23:59:59.999 UTC for a winter UK closing date", () => {
    expect(competitionClosesAt("2026-12-31").toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });

  it("stores selected competition calendar dates without baking in a browser timezone", () => {
    expect(competitionCalendarStart("2026-09-30").toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(competitionCalendarEnd("2026-09-30").toISOString()).toBe("2026-09-30T23:59:59.999Z");
  });
});
