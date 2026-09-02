export type CommissionSortOrder = "oldest" | "newest";

export function sortRowsByDate<T>(
  rows: T[],
  getDate: (row: T) => Date | string | null | undefined,
  order: CommissionSortOrder,
) {
  return rows.slice().sort((a, b) => {
    const aDate = new Date(getDate(a) ?? 0).getTime();
    const bDate = new Date(getDate(b) ?? 0).getTime();
    return order === "oldest" ? aDate - bDate : bDate - aDate;
  });
}

export function getPage<T>(rows: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    safePage,
    totalPages,
    start,
  };
}

/** Claims held for an In Contract agent must never enter a payment-selection batch. */
export function getSelectableCommissionRows<T extends { inContract?: boolean }>(rows: T[]) {
  return rows.filter((row) => !row.inContract);
}
