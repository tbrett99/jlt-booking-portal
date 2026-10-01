import { describe, expect, it } from "vitest";
import {
  expectedRefundDateFromInput,
  expectedRefundDateInputValue,
  formatExpectedRefundDate,
  refundChaseTiming,
} from "../shared/refund-chase-utils";

describe("refund chase date helpers", () => {
  it("keeps a date-only expected refund date stable in the UK across daylight saving time", () => {
    const stored = expectedRefundDateFromInput("2026-10-01");

    expect(stored).toEqual(new Date("2026-10-01T12:00:00.000Z"));
    expect(expectedRefundDateInputValue(stored)).toBe("2026-10-01");
    expect(formatExpectedRefundDate(stored)).toBe("1 Oct 2026");
  });

  it("classifies expected dates relative to the current UK calendar day", () => {
    const now = new Date("2026-10-01T08:30:00.000Z");

    expect(refundChaseTiming("2026-09-30T12:00:00.000Z", now)).toBe("overdue");
    expect(refundChaseTiming("2026-10-01T12:00:00.000Z", now)).toBe("today");
    expect(refundChaseTiming("2026-10-02T12:00:00.000Z", now)).toBe("upcoming");
    expect(refundChaseTiming(null, now)).toBe("unscheduled");
  });

  it("allows the expected date to be cleared but rejects malformed staff input", () => {
    expect(expectedRefundDateFromInput("")).toBeNull();
    expect(() => expectedRefundDateFromInput("1 October 2026")).toThrow("calendar date");
  });
});
