import { describe, expect, it } from "vitest";
import { isMissingGoCardlessEventIdColumn } from "./gocardless-db";

describe("GoCardless payment-event schema compatibility", () => {
  it("recognises a Drizzle-wrapped missing event ID column error", () => {
    expect(isMissingGoCardlessEventIdColumn({
      message: "Failed query: select `gocardlessEventId` from `gc_payment_events`",
      cause: {
        code: "ER_BAD_FIELD_ERROR",
        message: "Unknown column 'gocardlessEventId' in 'field list'",
      },
    })).toBe(true);
  });

  it("does not mask unrelated payment-event failures", () => {
    expect(isMissingGoCardlessEventIdColumn({
      message: "Failed query: select `gocardlessEventId` from `gc_payment_events`",
      cause: { code: "ER_ACCESS_DENIED_ERROR", message: "Access denied" },
    })).toBe(false);
  });
});
