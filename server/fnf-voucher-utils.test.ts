import { describe, expect, it } from "vitest";
import { isCountableFnfVoucherUse, selectCurrentFnfVoucherAllocation } from "./fnf-voucher-utils";

describe("selectCurrentFnfVoucherAllocation", () => {
  it("selects the newest allocation when active allocations share a renewal date", () => {
    const result = selectCurrentFnfVoucherAllocation([
      { id: 66, totalGranted: 2, renewsAt: "2027-06-01T00:00:00.000Z", createdAt: "2026-07-07T16:01:10.000Z" },
      { id: 666, totalGranted: 1, renewsAt: "2027-06-01T00:00:00.000Z", createdAt: "2026-09-01T16:59:14.000Z" },
      { id: 671, totalGranted: 1, renewsAt: "2027-06-01T00:00:00.000Z", createdAt: "2026-09-08T16:24:29.000Z" },
    ], new Date("2026-09-08T17:00:00.000Z"));

    expect(result?.id).toBe(671);
  });

  it("does not select an expired allocation", () => {
    expect(selectCurrentFnfVoucherAllocation([
      { id: 1, totalGranted: 2, renewsAt: "2026-06-01T00:00:00.000Z", createdAt: "2025-06-01T00:00:00.000Z" },
    ], new Date("2026-09-08T17:00:00.000Z"))).toBeNull();
  });

  it("does not count removed or missing-booking uses, while retaining the manual cancellation policy", () => {
    expect(isCountableFnfVoucherUse({ removedAt: null, bookingId: 100, bookingStage: "New Booking" })).toBe(true);
    expect(isCountableFnfVoucherUse({ removedAt: null, bookingId: 101, bookingStage: "Cancelled" })).toBe(true);
    expect(isCountableFnfVoucherUse({ removedAt: new Date("2026-09-08"), bookingId: 100, bookingStage: "New Booking" })).toBe(false);
    expect(isCountableFnfVoucherUse({ removedAt: null, bookingId: null, bookingStage: null })).toBe(false);
  });
});
