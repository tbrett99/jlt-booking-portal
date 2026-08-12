import { describe, expect, it } from "vitest";
import { flightRequestActions } from "../drizzle/schema";

describe("flight request action audit schema", () => {
  it("stores the request, action, performer, status transition, and timestamp", () => {
    expect(Object.keys(flightRequestActions)).toEqual(expect.arrayContaining([
      "id",
      "flightRequestId",
      "bookingId",
      "action",
      "previousStatus",
      "newStatus",
      "performedById",
      "details",
      "createdAt",
    ]));
  });
});
