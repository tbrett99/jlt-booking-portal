import { describe, expect, it } from "vitest";
import { getPage, getSelectableCommissionRows, sortRowsByDate } from "../client/src/lib/commission-list-utils";

describe("commission list controls", () => {
  const claims = [
    { id: 3, claimedAt: "2026-08-03T09:00:00Z" },
    { id: 1, claimedAt: "2026-08-01T09:00:00Z" },
    { id: 2, claimedAt: "2026-08-02T09:00:00Z" },
  ];

  it("orders claims oldest first and newest first", () => {
    expect(sortRowsByDate(claims, (claim) => claim.claimedAt, "oldest").map((claim) => claim.id)).toEqual([1, 2, 3]);
    expect(sortRowsByDate(claims, (claim) => claim.claimedAt, "newest").map((claim) => claim.id)).toEqual([3, 2, 1]);
  });

  it("returns a safe, bounded page of paid claims", () => {
    const page = getPage([1, 2, 3, 4, 5], 2, 2);
    expect(page.rows).toEqual([3, 4]);
    expect(page.safePage).toBe(2);
    expect(page.totalPages).toBe(3);

    expect(getPage([1, 2, 3], 99, 2).safePage).toBe(2);
  });

  it("excludes only future-travel In Contract records from Commission Due and Management bulk actions", () => {
    const rows = [
      { id: 1, inContract: true, inContractHold: false },
      { id: 2, inContract: true, inContractHold: true },
      { id: 3, inContract: false },
    ];

    expect(getSelectableCommissionRows(rows).map((row) => row.id)).toEqual([1, 3]);
  });
});
