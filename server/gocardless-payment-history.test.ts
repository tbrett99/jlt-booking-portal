import { describe, expect, it } from "vitest";
import { dedupePaymentEventHistory } from "./gocardless-db";

describe("GoCardless CRM payment event history", () => {
  it("shows one lifecycle update for each payment while retaining different payments and states", () => {
    const rows = dedupePaymentEventHistory([
      { id: 9, paymentId: "PM-1", eventType: "payments_paid_out", gocardlessEventId: null },
      { id: 8, paymentId: "PM-1", eventType: "payments_paid_out", gocardlessEventId: null },
      { id: 7, paymentId: "PM-1", eventType: "payments_confirmed", gocardlessEventId: null },
      { id: 6, paymentId: "PM-2", eventType: "payments_paid_out", gocardlessEventId: null },
    ]);

    expect(rows.map((row) => row.id)).toEqual([9, 7, 6]);
  });

  it("deduplicates provider-event replays with no payment reference", () => {
    const rows = dedupePaymentEventHistory([
      { id: 4, paymentId: null, eventType: "mandates_cancelled", gocardlessEventId: "EV-1" },
      { id: 3, paymentId: null, eventType: "mandates_cancelled", gocardlessEventId: "EV-1" },
      { id: 2, paymentId: null, eventType: "mandates_cancelled", gocardlessEventId: "EV-2" },
    ]);

    expect(rows.map((row) => row.id)).toEqual([4, 2]);
  });
});
