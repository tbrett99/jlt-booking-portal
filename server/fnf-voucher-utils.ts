export type FnfVoucherAllocationForSelection = {
  id: number;
  totalGranted: number;
  renewsAt: Date | string;
  createdAt: Date | string;
};

export function isCountableFnfVoucherUse(use: { removedAt: Date | string | null; bookingId: number | null; bookingStage: string | null }): boolean {
  // Cancellation does not automatically return a voucher: staff issue a replacement
  // where appropriate. A use whose booking has been deleted, however, can no longer
  // represent a redeemed voucher and must not reduce the balance.
  return use.removedAt === null && use.bookingId !== null;
}

export function selectCurrentFnfVoucherAllocation<T extends FnfVoucherAllocationForSelection>(
  allocations: T[],
  now = new Date(),
): T | null {
  return [...allocations]
    .filter((allocation) => new Date(allocation.renewsAt) > now)
    .sort((a, b) => {
      const renewalDifference = new Date(b.renewsAt).getTime() - new Date(a.renewsAt).getTime();
      return renewalDifference !== 0
        ? renewalDifference
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })[0] ?? null;
}
