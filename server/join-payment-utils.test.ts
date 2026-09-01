import { describe, expect, it } from "vitest";
import { completesJoinFlow } from "./join-payment-utils";

describe("completesJoinFlow", () => {
  it("accepts the normal fulfilled billing-request webhook", () => {
    expect(completesJoinFlow({ resourceType: "billing_requests", action: "fulfilled" })).toBe(true);
  });

  it("accepts a confirmed joining-fee payment linked to a billing request", () => {
    expect(completesJoinFlow({
      resourceType: "payments",
      action: "confirmed",
      billingRequestId: "BRQ01M1E0A8AB2XRCMENNJM1GGZ8P",
    })).toBe(true);
  });

  it("does not treat unrelated payment confirmations as completed join flows", () => {
    expect(completesJoinFlow({ resourceType: "payments", action: "confirmed" })).toBe(false);
    expect(completesJoinFlow({ resourceType: "payments", action: "failed", billingRequestId: "BRQ123" })).toBe(false);
  });
});
