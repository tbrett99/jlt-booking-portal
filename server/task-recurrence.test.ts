import { describe, expect, it } from "vitest";
import { resolveEquivalentTaskOwnerIds } from "../shared/task-identity";
import { nextRecurringTaskDate } from "../shared/task-recurrence";

describe("task owner identity and recurrence", () => {
  it("treats active legacy accounts with the same email as one task owner", () => {
    const ids = resolveEquivalentTaskOwnerIds(
      { id: 47, email: "max@thejltgroup.co.uk" },
      [
        { id: 47, email: "max@thejltgroup.co.uk", identityUserIds: [47, 760] },
        { id: 760, email: "MAX@thejltgroup.co.uk" },
        { id: 634, email: "hannah@thejltgroup.co.uk" },
      ],
    );

    expect(ids).toEqual([47, 760]);
  });

  it("preserves a one-off account identity when no email match is available", () => {
    expect(resolveEquivalentTaskOwnerIds({ id: 47, email: null }, [{ id: 760, email: null }])).toEqual([47]);
  });

  it("calculates the next daily, weekly and fortnightly due dates", () => {
    const due = new Date("2026-09-30T00:00:00.000Z");
    expect(nextRecurringTaskDate(due, "daily").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(nextRecurringTaskDate(due, "weekly").toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(nextRecurringTaskDate(due, "fortnightly").toISOString()).toBe("2026-10-14T00:00:00.000Z");
  });

  it("keeps monthly tasks on the last valid day of shorter months", () => {
    const due = new Date("2026-01-31T00:00:00.000Z");
    expect(nextRecurringTaskDate(due, "monthly").toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
});
