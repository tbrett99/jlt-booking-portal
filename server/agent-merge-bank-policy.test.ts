import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareMergePayoutBanks, mergePayoutBankStatus } from "./agent-merge-bank-policy";
import { encrypt } from "./encryption";

const blankValues = [null, undefined, "", " ", "\t\n", "\u00a0", " -- "];
beforeEach(() => vi.stubEnv("JWT_SECRET", "offline-bank-comparison-test-only"));
afterEach(() => vi.unstubAllEnvs());
describe("bank destination comparison only", () => {
  it.each(blankValues)("does not block bank fields containing only %j", value => {
    const source = Object.freeze({ bankAccountName: "Original holder", bankSortCode: value, bankAccountNumber: value });
    const primary = Object.freeze({ bankAccountName: "Current holder", bankSortCode: null, bankAccountNumber: "" });
    expect(compareMergePayoutBanks(source, primary).conflict).toBe(false);
    expect(mergePayoutBankStatus(source)).toBe("not_recorded");
    expect(source.bankSortCode).toBe(value);expect(primary.bankAccountNumber).toBe("");
  });
  it("treats holder names alone as a warning, not a bank destination or a blocker", () => {
    const comparison = compareMergePayoutBanks({ bankAccountName: "Original surname" }, { bankAccountName: "Current surname" });
    expect(comparison.conflict).toBe(false);expect(comparison.warnings.join(" ")).toContain("account-holder name only");
    expect(mergePayoutBankStatus({ bankAccountName: "Original surname" })).toBe("not_recorded");
  });
  it("allows an empty source without removing the primary's existing bank destination", () => {
    const primary = Object.freeze({ bankAccountName: "Verified holder", bankSortCode: "00-01-02", bankAccountNumber: "00123456" });
    expect(compareMergePayoutBanks(null, primary).conflict).toBe(false);
    expect(mergePayoutBankStatus(primary)).toBe("recorded");expect(primary.bankAccountNumber).toBe("00123456");
  });
  it("normalises spacing/hyphens for comparison without changing original values or leading zeros", () => {
    const source = Object.freeze({ bankAccountName: " Former Surname ", bankSortCode: "00-01-02", bankAccountNumber: "00 123 456" });
    const primary = Object.freeze({ bankAccountName: "Current Surname", bankSortCode: "000102", bankAccountNumber: "00123456" });
    const result = compareMergePayoutBanks(source, primary);
    expect(result.conflict).toBe(false);expect(result.warnings.join(" ")).toContain("account-holder names differ");
    expect(source.bankSortCode).toBe("00-01-02");expect(primary.bankAccountNumber).toBe("00123456");
  });
  it.each([
    [{ bankSortCode: "000102" }, {}],
    [{ bankAccountNumber: "00123456" }, {}],
    [{ bankSortCode: "000102" }, { bankSortCode: "000103" }],
    [{ bankAccountNumber: "00123456" }, { bankAccountNumber: "00123457" }],
    [{ bankAccountNumber: "00123456" }, { bankAccountNumber: "123456" }],
    [{ bankAccountNumber: "NULL" }, {}],
    [{ bankAccountNumber: "N/A" }, {}],
    [{ bankAccountNumber: "••••••••" }, { bankAccountNumber: "00123456" }],
  ])("still blocks a recorded or unknown source identifier absent/different on primary: %j", (source, primary) => {
    expect(compareMergePayoutBanks(source, primary).conflict).toBe(true);
    expect(mergePayoutBankStatus(source)).toBe("partial");
  });
  it("never equates different letters by stripping arbitrary characters", () => {
    expect(compareMergePayoutBanks({ bankAccountNumber: "0012X456" }, { bankAccountNumber: "00123456" }).conflict).toBe(true);
  });
  it("compares independently encrypted matching destinations, not random ciphertext", () => {
    const source = Object.freeze({ bankSortCode: encrypt("00-01-02"), bankAccountNumber: encrypt("00 123 456") });
    const primary = Object.freeze({ bankSortCode: encrypt("000102"), bankAccountNumber: encrypt("00123456") });
    expect(source.bankSortCode).not.toBe(primary.bankSortCode);
    expect(compareMergePayoutBanks(source, primary).conflict).toBe(false);
    expect(mergePayoutBankStatus(source)).toBe("recorded");
  });
  it("recognises successfully decoded whitespace as absent without clearing its ciphertext", () => {
    const source = Object.freeze({ bankSortCode: encrypt(" \t "), bankAccountNumber: encrypt("\n ") });
    expect(compareMergePayoutBanks(source, null).conflict).toBe(false);
    expect(mergePayoutBankStatus(source)).toBe("not_recorded");
    expect(source.bankSortCode).toContain(":");
  });
  it("never calls undecodable ciphertext missing, even if both records appear blank in the CRM", () => {
    const source = { bankSortCode: "invalid:encrypted:value" };
    expect(compareMergePayoutBanks(source, {}).unreadable).toBe(true);
    expect(compareMergePayoutBanks(source, {}).conflict).toBe(true);
    expect(mergePayoutBankStatus(source)).toBe("unverified");
  });
  it("holds encrypted fields when the decryption key is not configured", () => {
    const source = { bankSortCode: encrypt("000102") };
    vi.stubEnv("JWT_SECRET", "");
    expect(mergePayoutBankStatus(source)).toBe("unverified");
  });
  it("does not silently erase zero-width or masked unknown content", () => {
    expect(compareMergePayoutBanks({ bankAccountNumber: "\u200b" }, {}).conflict).toBe(true);
  });
});
