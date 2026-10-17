export type AgentBookingSearchRecord = {
  clientName: string;
  topdogRef?: string | null;
  ptsRef?: string | null;
};

/**
 * The request centre deliberately returns no default booking list. Agents use
 * Orbit to manage live files and search here only when they need portal help.
 */
export function findAgentBookingMatches<T extends AgentBookingSearchRecord>(
  bookings: readonly T[],
  rawSearch: string,
  limit = 12,
): T[] {
  const search = rawSearch.trim().toLowerCase();
  if (!search) return [];

  return bookings.filter((booking) => [
    booking.clientName,
    booking.topdogRef ?? "",
    booking.ptsRef ?? "",
  ].some((value) => value.toLowerCase().includes(search))).slice(0, limit);
}
