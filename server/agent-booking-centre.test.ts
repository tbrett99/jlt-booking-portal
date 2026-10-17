import { describe, expect, it } from "vitest";
import { findAgentBookingMatches } from "../shared/agent-booking-centre";

const BOOKINGS = [
  { clientName: "Ava Turner", topdogRef: "TD-1001", ptsRef: "PTS-ALPHA" },
  { clientName: "Morgan Reed", topdogRef: "TD-1002", ptsRef: "PTS-BRAVO" },
  { clientName: "Ava Morgan", topdogRef: null, ptsRef: null },
] as const;

describe("agent booking request centre", () => {
  it("does not return a booking list until the agent searches", () => {
    expect(findAgentBookingMatches(BOOKINGS, "")).toEqual([]);
    expect(findAgentBookingMatches(BOOKINGS, "   ")).toEqual([]);
  });

  it("finds bookings by traveller, Topdog reference, or PTS reference without case sensitivity", () => {
    expect(findAgentBookingMatches(BOOKINGS, "ava").map((booking) => booking.clientName)).toEqual(["Ava Turner", "Ava Morgan"]);
    expect(findAgentBookingMatches(BOOKINGS, "td-1002").map((booking) => booking.clientName)).toEqual(["Morgan Reed"]);
    expect(findAgentBookingMatches(BOOKINGS, "bravo").map((booking) => booking.clientName)).toEqual(["Morgan Reed"]);
  });

  it("keeps the search results concise", () => {
    expect(findAgentBookingMatches(BOOKINGS, "a", 1)).toHaveLength(1);
  });
});
