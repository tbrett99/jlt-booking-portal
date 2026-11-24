/** Initial publication checks only; never a normal report or an acceptance switch.
 * GBP values are the existing report engine's known exact-decimal sums, not
 * complete totals when coverage is missing. No source rows or people are exposed.
 */
export interface HqInitialValidationResult {
  status: "awaiting_import" | "checks_ready" | "needs_attention";
  message: string;
  generationId: number | null;
  checkedAt: string;
  sourcePublishedAt: string | null;
  isStale: boolean | null;
  years: Array<{
    year: number;
    activeBookings: number;
    grossSales: string | null;
    grossSalesMissing: number;
    grossProfit: string | null;
    grossProfitMissing: number;
    cancelledBookings: number;
    pendingBookings: number;
    undatedBookings: number;
    unattributedBookings: number;
  }>;
  manualChecksPending: true;
  limitations: string[];
}
