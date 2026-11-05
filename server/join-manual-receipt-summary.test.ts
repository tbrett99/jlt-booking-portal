import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manualJoinReceiptLabel } from "../shared/join-manual-receipt-summary";

const routerSource = readFileSync(
  new URL("./join-router.ts", import.meta.url),
  "utf8"
);

const validReceipt = {
  version: 1,
  kind: "external_manual_joining_fee",
  currency: "GBP",
  amountMinor: 69700,
  receivedDate: "2026-11-05",
  method: "stripe_card",
};

const procedure = (name: string, nextName: string) => {
  const start = routerSource.indexOf(`${name}: publicProcedure`);
  const end = routerSource.indexOf(`${nextName}: publicProcedure`);
  return routerSource.slice(start, end === -1 ? undefined : end);
};

describe("manualJoinReceiptLabel", () => {
  it("returns no label for null or undefined external evidence", () => {
    expect(manualJoinReceiptLabel(null)).toBeNull();
    expect(manualJoinReceiptLabel(undefined)).toBeNull();
  });

  it("formats a valid object as a visible GBP Stripe-card receipt label", () => {
    expect(manualJoinReceiptLabel(validReceipt)).toBe(
      "£697.00 received — Stripe card, 2026-11-05 (date only; not GoCardless)"
    );
  });

  it("formats the same valid receipt when serialized as JSON", () => {
    expect(manualJoinReceiptLabel(JSON.stringify(validReceipt))).toBe(
      "£697.00 received — Stripe card, 2026-11-05 (date only; not GoCardless)"
    );
  });

  it("shows a visible review label for malformed JSON instead of fabricating an amount", () => {
    const label = manualJoinReceiptLabel('{"amountMinor":69700');
    expect(label).toBe("External receipt needs review");
    expect(label).not.toContain("£697");
  });

  it.each([
    ["zero amount", { ...validReceipt, amountMinor: 0 }],
    ["non-integer amount", { ...validReceipt, amountMinor: 69700.5 }],
    ["negative amount", { ...validReceipt, amountMinor: -69700 }],
    ["wrong currency", { ...validReceipt, currency: "USD" }],
    ["wrong kind", { ...validReceipt, kind: "paid_joining_fee" }],
  ])("does not make a paid claim for %s", (_name, value) => {
    const label = manualJoinReceiptLabel(value);
    expect(label).toBe("External receipt needs review");
    expect(label).not.toMatch(/received|£\d/);
  });

  it("rejects non-object receipt values visibly", () => {
    expect(manualJoinReceiptLabel([])).toBe("External receipt needs review");
    expect(manualJoinReceiptLabel("paid in full")).toBe(
      "External receipt needs review"
    );
  });

  it("accepts date-only text only as a calendar date, not merely a YYYY-MM-DD shape", () => {
    expect(
      manualJoinReceiptLabel({ ...validReceipt, receivedDate: "2026-02-30" })
    ).toBe("External receipt needs review");
  });
});

describe("join router manual-receipt guards", () => {
  it("blocks initiatePayment for any non-null manual receipt before GoCardless request creation", () => {
    const source = procedure("initiatePayment", "getPricing");
    const guard = source.indexOf("session.joiningFeeManualReceipt != null");
    const create = source.indexOf("createJoinBillingRequest(");
    expect(guard).toBeGreaterThan(-1);
    expect(source).toContain('session.step === "complete"');
    expect(source).toContain("session.joiningFeePaidAt");
    expect(create).toBeGreaterThan(guard);
  });

  it("blocks contract signing when the session is complete or has any manual receipt", () => {
    const source = procedure("signContract", "initiatePayment");
    const guard = source.indexOf(
      'session.step === "complete" || session.joiningFeeManualReceipt != null'
    );
    const hash = source.indexOf("createHash");
    expect(guard).toBeGreaterThan(-1);
    expect(hash).toBeGreaterThan(guard);
  });
});
