import { describe, expect, it } from "vitest";
import {
  reduceMembershipPaymentEvents,
  type MembershipPaymentEvent,
  type MembershipPaymentPolicyOptions,
} from "./membership-payment-policy";

const event = (
  eventId: string,
  paymentId: string,
  action: string,
  day: number,
  extra: Partial<MembershipPaymentEvent> = {}
): MembershipPaymentEvent => ({
  eventId,
  paymentId,
  action,
  occurredAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`,
  ...extra,
});
const reduce = (
  events: readonly MembershipPaymentEvent[],
  options?: MembershipPaymentPolicyOptions
) => reduceMembershipPaymentEvents(events, options);

describe("reduceMembershipPaymentEvents", () => {
  it("starts clear with no invented balance or suspension", () => {
    expect(reduce([])).toMatchObject({
      failureCount: 0,
      currentRunKey: null,
      lastFailedAt: null,
      shouldSuspend: false,
      settlementState: "clear",
      outstandingPaymentIds: [],
      outstandingPaymentCount: 0,
      knownOutstandingAmounts: {},
      outstandingAmountsComplete: true,
      recoveries: [],
      lastRecoveredAt: null,
    });
  });

  it("counts three retries of one payment as attempts, not three debts", () => {
    const result = reduce([
      event("e1", "oct", "failed", 1, { amount: 1999, currency: "gbp" }),
      event("retry1", "oct", "pending_submission", 2),
      event("e2", "oct", "failed", 3),
      event("retry2", "oct", "submitted", 4),
      event("e3", "oct", "failed", 5),
    ]);
    expect(result.failureCount).toBe(3);
    expect(result.shouldSuspend).toBe(true);
    expect(result.outstandingPaymentIds).toEqual(["oct"]);
    expect(result.outstandingPaymentCount).toBe(1);
    expect(result.knownOutstandingAmounts).toEqual({ GBP: 1999 });
    expect(result.outstandingPayments[0]).toMatchObject({
      failureCount: 3,
      amount: 1999,
    });
    expect(result.failures.map(f => f.failureCount)).toEqual([1, 2, 3]);
    expect(result.failures.map(f => f.runKey)).toEqual(
      Array(3).fill("membership:e1")
    );
    expect(result.failures.map(f => f.shouldSuspend)).toEqual([
      false,
      false,
      true,
    ]);
    expect(result.lastFailedAt).toBe(
      event("e3", "oct", "failed", 5).occurredAt
    );
  });

  it("combines attempts across two months while retaining both outstanding IDs", () => {
    const result = reduce([
      event("sep1", "sep", "failed", 1, { amount: 1000, currency: "GBP" }),
      event("sep2", "sep", "failed", 2),
      event("oct1", "oct", "failed", 3, { amount: 2000, currency: "GBP" }),
    ]);
    expect(result.failureCount).toBe(3);
    expect(result.outstandingPaymentIds).toEqual(["oct", "sep"]);
    expect(result.knownOutstandingAmounts).toEqual({ GBP: 3000 });
    expect(result.shouldSuspend).toBe(true);
  });

  it("emails every distinct failure and marks the second attempt's fee once per run", () => {
    const result = reduce(
      [1, 2, 3, 4, 5].map(day => event(`e${day}`, "oct", "failed", day))
    );
    expect(result.failures.every(f => f.shouldEmail)).toBe(true);
    expect(result.failures.map(f => f.shouldApplyAdminFee)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(result.failures[4].failureCount).toBe(5);
    expect(result.failures[4].shouldSuspend).toBe(true);
    expect(result.failures[1]).not.toHaveProperty("adminFeeAmount");
  });

  it("deduplicates exact event replay by event ID, not payment ID", () => {
    const first = event("e1", "oct", "failed", 1);
    const second = event("e2", "oct", "failed", 2);
    expect(reduce([first, second, { ...first }, second])).toEqual(
      reduce([first, second])
    );
    expect(reduce([first, second, first]).failureCount).toBe(2);
  });

  it("normalises Date/string timestamps and currency before replay deduplication", () => {
    const first = event("e1", "oct", "failed", 1, { currency: "gbp" });
    expect(
      reduce([
        first,
        {
          ...first,
          occurredAt: new Date(first.occurredAt),
          currency: "GBP",
          isMembership: true,
        },
      ]).failureCount
    ).toBe(1);
  });

  it("rejects conflicting copies of an event ID instead of depending on arrival order", () => {
    const first = event("e1", "oct", "failed", 1);
    const conflict = { ...first, action: "confirmed" };
    for (const events of [
      [first, conflict],
      [conflict, first],
    ]) {
      expect(() => reduce(events)).toThrow(
        "Conflicting membership payment ledger ID"
      );
    }
  });

  it("orders by provider time regardless of arrival/input order", () => {
    const events = [
      event("z-first", "sep", "failed", 1),
      event("b-second", "oct", "failed", 2),
      event("a-success", "oct", "confirmed", 3),
      event("c-third", "sep", "failed", 4),
    ];
    const chronological = reduce(events);
    expect(reduce([...events].reverse())).toEqual(chronological);
    expect(reduce([events[2], events[0], events[3], events[1]])).toEqual(
      chronological
    );
    expect(chronological.failures.map(f => f.eventId)).toEqual([
      "z-first",
      "b-second",
      "c-third",
    ]);
    expect(chronological.failureCount).toBe(3);
    expect(chronological.outstandingPaymentIds).toEqual(["sep"]);
  });

  it("has an explicit deterministic event-ID tie-break at equal provider times", () => {
    const events = [
      event("b", "oct", "failed", 1),
      event("a", "sep", "failed", 1),
    ];
    expect(reduce(events)).toEqual(reduce([...events].reverse()));
    expect(reduce(events).failures.map(f => f.eventId)).toEqual(["a", "b"]);
    expect(reduce(events).currentRunKey).toBe("membership:a");
  });

  it("pending same-ID retries retain arrears until confirmed recovery", () => {
    const failed = event("e1", "oct", "failed", 1);
    const pending = event("e2", "oct", "pending_submission", 2);
    expect(reduce([failed, pending])).toMatchObject({
      failureCount: 1,
      outstandingPaymentIds: ["oct"],
      settlementState: "outstanding",
    });
    const result = reduce([
      failed,
      pending,
      event("e3", "oct", "confirmed", 3),
    ]);
    expect(result).toMatchObject({
      failureCount: 0,
      currentRunKey: null,
      outstandingPaymentCount: 0,
      shouldSuspend: false,
      settlementState: "recovered",
      lastRecoveredAt: event("e3", "oct", "confirmed", 3).occurredAt,
    });
    expect(result.recoveries).toHaveLength(1);
    expect(result.recoveries[0]).toMatchObject({
      paymentId: "oct",
      action: "confirmed",
      closedRun: true,
      runKey: "membership:e1",
    });
    expect(result.lastFailedAt).toBe(failed.occurredAt);
  });

  it("paid_out can directly settle its own failed payment", () => {
    const result = reduce([
      event("f", "oct", "failed", 1),
      event("p", "oct", "paid_out", 2),
    ]);
    expect(result.settlementState).toBe("recovered");
    expect(result.recoveries[0].action).toBe("paid_out");
    expect(result.failureCount).toBe(0);
  });

  it("a later month's success never erases earlier month's arrears", () => {
    const result = reduce([
      event("e1", "sep", "failed", 1),
      event("e2", "sep", "failed", 2),
      event("ok", "oct", "confirmed", 3),
      event("payout", "oct", "paid_out", 4),
    ]);
    expect(result.failureCount).toBe(2);
    expect(result.outstandingPaymentIds).toEqual(["sep"]);
    expect(result.currentRunKey).toBe("membership:e1");
    expect(result.recoveries).toEqual([]);
  });

  it("partial recovery retains all run attempts, including those on the cleared ID", () => {
    const events = [
      event("a", "sep", "failed", 1),
      event("b", "oct", "failed", 2),
      event("c", "sep", "failed", 3),
      event("d", "oct", "confirmed", 4),
    ];
    const partial = reduce(events);
    expect(partial.failureCount).toBe(3);
    expect(partial.shouldSuspend).toBe(true);
    expect(partial.outstandingPaymentIds).toEqual(["sep"]);
    expect(partial.recoveries[0].closedRun).toBe(false);
    const full = reduce([...events, event("e", "sep", "paid_out", 5)]);
    expect(full.failureCount).toBe(0);
    expect(full.shouldSuspend).toBe(false);
    expect(full.recoveries.map(r => r.closedRun)).toEqual([false, true]);
  });

  it("paid_out after confirmed does not reset a subsequent failure run", () => {
    const result = reduce([
      event("a", "sep", "failed", 1),
      event("b", "sep", "confirmed", 2),
      event("c", "oct", "failed", 3),
      event("d", "sep", "paid_out", 4),
      event("e", "oct", "failed", 5),
    ]);
    expect(result.failures.map(f => f.failureCount)).toEqual([1, 1, 2]);
    expect(result.failureCount).toBe(2);
    expect(result.currentRunKey).toBe("membership:c");
    expect(result.recoveries).toHaveLength(1);
    expect(result.failures[2].shouldApplyAdminFee).toBe(true);
  });

  it("ignores explicitly unrelated/admin-fee events even with a matching ID", () => {
    const result = reduce([
      event("a", "oct", "failed", 1),
      event("fee-fail", "fee", "failed", 2, {
        isMembership: false,
        amount: 500,
        currency: "GBP",
      }),
      event("fee-ok", "fee", "confirmed", 3, { isMembership: false }),
      event("unrelated", "oct", "paid_out", 4, { isMembership: false }),
      event("b", "oct", "failed", 5),
    ]);
    expect(result.failureCount).toBe(2);
    expect(result.outstandingPaymentIds).toEqual(["oct"]);
    expect(result.recoveries).toEqual([]);
    expect(result.knownOutstandingAmounts).toEqual({});
    expect(result.failures.map(f => f.eventId)).toEqual(["a", "b"]);
  });

  it("a chargeback after earlier success opens fresh arrears and can recover later", () => {
    const events = [
      event("ok", "oct", "confirmed", 1, { amount: 2500, currency: "GBP" }),
      event("paid", "oct", "paid_out", 2),
      event("back", "oct", "charged_back", 3),
    ];
    expect(reduce(events)).toMatchObject({
      failureCount: 1,
      currentRunKey: "membership:back",
      outstandingPaymentIds: ["oct"],
      knownOutstandingAmounts: { GBP: 2500 },
      settlementState: "outstanding",
    });
    expect(reduce(events).failures[0].action).toBe("charged_back");
    expect(
      reduce([...events, event("recover", "oct", "confirmed", 4)])
        .settlementState
    ).toBe("recovered");
  });

  it("a late-delivered older failure is recovered by a later provider-time success", () => {
    const success = event("ok", "oct", "confirmed", 5);
    const late = event("late", "oct", "failed", 1);
    const result = reduce([success, late]);
    expect(result.failureCount).toBe(0);
    expect(result.outstandingPaymentIds).toEqual([]);
    expect(result.failures[0].eventId).toBe("late");
    expect(result.recoveries[0].closedRun).toBe(true);
    // A genuine later failure is not forgiven by an earlier success.
    expect(
      reduce([success, event("new", "oct", "failed", 6)]).outstandingPaymentIds
    ).toEqual(["oct"]);
  });

  it("requires explicit per-payment manual settlements and starts fresh only after all clear", () => {
    const events = [
      event("a", "sep", "failed", 1),
      event("b", "oct", "failed", 2),
    ];
    const first = {
      settlementId: "s1",
      paymentId: "sep",
      occurredAt: event("x", "sep", "", 3).occurredAt,
    };
    const second = {
      settlementId: "s2",
      paymentId: "oct",
      occurredAt: event("x", "oct", "", 4).occurredAt,
    };
    const partial = reduce(events, { manualSettlements: [first, first] });
    expect(partial.failureCount).toBe(2);
    expect(partial.outstandingPaymentIds).toEqual(["oct"]);
    expect(partial.recoveries).toHaveLength(1);
    expect(partial.recoveries[0]).toMatchObject({
      action: "manual_settlement",
      closedRun: false,
    });
    const full = reduce(events, { manualSettlements: [second, first, second] });
    expect(full.settlementState).toBe("recovered");
    expect(full.failureCount).toBe(0);
    const next = reduce(
      [
        ...events,
        event("c", "nov", "failed", 5),
        event("d", "nov", "failed", 6),
      ],
      { manualSettlements: [first, second] }
    );
    expect(next.failures.map(f => f.failureCount)).toEqual([1, 2, 1, 2]);
    expect(
      next.failures.filter(f => f.shouldApplyAdminFee).map(f => f.runKey)
    ).toEqual(["membership:a", "membership:c"]);
  });

  it("settlements of another ID or before failure do not forgive future debts", () => {
    const result = reduce([event("f", "oct", "failed", 3)], {
      manualSettlements: [
        {
          settlementId: "before",
          paymentId: "oct",
          occurredAt: event("x", "oct", "", 1).occurredAt,
        },
        {
          settlementId: "other",
          paymentId: "fee",
          occurredAt: event("x", "fee", "", 4).occurredAt,
        },
      ],
    });
    expect(result.outstandingPaymentIds).toEqual(["oct"]);
    expect(result.recoveries).toEqual([]);
  });

  it("settlements follow provider events at the same timestamp deterministically", () => {
    const fail = event("f", "oct", "failed", 1);
    expect(
      reduce([fail], {
        manualSettlements: [
          { settlementId: "s", paymentId: "oct", occurredAt: fail.occurredAt },
        ],
      }).settlementState
    ).toBe("recovered");
  });

  it("resetAt is an inclusive policy-count boundary, not unrecorded debt forgiveness", () => {
    const events = [
      event("a", "sep", "failed", 1),
      event("b", "sep", "failed", 2),
    ];
    const resetAt = events[1].occurredAt;
    const reset = reduce(events, { resetAt });
    expect(reset).toMatchObject({
      failureCount: 0,
      currentRunKey: null,
      lastFailedAt: null,
      shouldSuspend: false,
      outstandingPaymentIds: ["sep"],
      failures: [],
      settlementState: "outstanding",
    });
    const next = reduce(
      [
        ...events,
        event("c", "oct", "failed", 3),
        event("ok", "oct", "confirmed", 4),
      ],
      { resetAt }
    );
    expect(next.failureCount).toBe(1);
    expect(next.currentRunKey).toBe("membership:c");
    expect(next.outstandingPaymentIds).toEqual(["sep"]);
    expect(next.failures.map(f => f.eventId)).toEqual(["c"]);
  });

  it("does not invent balances for missing amounts/currencies or sum different currencies", () => {
    const result = reduce([
      event("a", "unknown", "failed", 1),
      event("b", "currency-missing", "failed", 2, { amount: 500 }),
      event("c", "gbp", "failed", 3, { amount: 1000, currency: "GBP" }),
      event("d", "usd", "failed", 4, { amount: 2000, currency: "USD" }),
      event("e", "zero", "failed", 5, { amount: 0, currency: "GBP" }),
    ]);
    expect(result.knownOutstandingAmounts).toEqual({ GBP: 1000, USD: 2000 });
    expect(result.unknownAmountPaymentIds).toEqual([
      "currency-missing",
      "unknown",
    ]);
    expect(result.outstandingAmountsComplete).toBe(false);
    expect(
      result.outstandingPayments.find(p => p.paymentId === "unknown")?.amount
    ).toBeNull();
    expect(result).not.toHaveProperty("totalOutstandingAmount");
    const hydrated = reduce([
      event("f", "oct", "failed", 1),
      event("pending", "oct", "pending_submission", 2, {
        amount: 1500,
        currency: "GBP",
      }),
    ]);
    expect(hydrated.knownOutstandingAmounts).toEqual({ GBP: 1500 });
    expect(hydrated.failureCount).toBe(1);
  });

  it("does not mutate its input ledger or timestamp objects", () => {
    const date = new Date("2026-10-01T12:00:00Z");
    const input = Object.freeze([
      Object.freeze(event("a", "oct", "failed", 1, { occurredAt: date })),
    ]);
    const before = date.getTime();
    expect(reduce(input)).toEqual(reduce(input));
    expect(date.getTime()).toBe(before);
    expect(input[0].occurredAt).toBe(date);
  });

  it("rejects invalid timestamps, blank IDs, invalid amounts and conflicting settlements", () => {
    expect(() =>
      reduce([event("a", "oct", "failed", 1, { occurredAt: "not-a-date" })])
    ).toThrow("timestamp");
    expect(() => reduce([], { resetAt: new Date(NaN) })).toThrow("timestamp");
    expect(() => reduce([event("", "oct", "failed", 1)])).toThrow("non-empty");
    expect(() => reduce([event("a", " ", "failed", 1)])).toThrow("non-empty");
    for (const amount of [
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() =>
        reduce([event("a", "oct", "failed", 1, { amount })])
      ).toThrow("minor units");
    }
    expect(() =>
      reduce([], {
        manualSettlements: [
          { settlementId: "s", paymentId: "oct", occurredAt: "2026-10-01" },
          { settlementId: "s", paymentId: "sep", occurredAt: "2026-10-01" },
        ],
      })
    ).toThrow("Conflicting membership payment ledger ID");
  });
});
