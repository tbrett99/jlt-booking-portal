import { decrypt } from "./encryption";
type PayoutProfile = { bankAccountName?: unknown; bankSortCode?: unknown; bankAccountNumber?: unknown } | null | undefined;
export type MergePayoutBankStatus = "not_recorded" | "partial" | "recorded" | "unverified";
type Identifier = { value: string; unreadable: boolean };

// Comparison only. Never put plaintext back into loaded rows or change either
// profile. Preserve the exact original ciphertext/blank values in the audit.
function text(value: unknown): string { return value == null ? "" : String(value).trim(); }
function bankIdentifier(value: unknown): Identifier {
  const stored = text(value);
  if (!stored) return { value: "", unreadable: false };
  let plaintext = stored;
  if (stored.includes(":")) {
    if (!process.env.JWT_SECRET) return { value: "", unreadable: true };
    try { plaintext = decrypt(stored); }
    catch { return { value: "", unreadable: true }; }
  }
  // Keep strings/leading zeros. Unknown, masked or malformed values are never
  // erased by stripping all non-digits or silently treated as missing.
  return { value: plaintext.replace(/[\s-]/g, ""), unreadable: false };
}
function bankIdentifiers(profile: PayoutProfile) {
  return { sortCode: bankIdentifier(profile?.bankSortCode), accountNumber: bankIdentifier(profile?.bankAccountNumber) };
}
export function mergePayoutBankStatus(profile: PayoutProfile): MergePayoutBankStatus {
  const { sortCode, accountNumber } = bankIdentifiers(profile);
  if (sortCode.unreadable || accountNumber.unreadable) return "unverified";
  if (!sortCode.value && !accountNumber.value) return "not_recorded";
  return sortCode.value && accountNumber.value ? "recorded" : "partial";
}
export function compareMergePayoutBanks(source: PayoutProfile, primary: PayoutProfile): { conflict: boolean; unreadable: boolean; warnings: string[] } {
  const sourceIds = bankIdentifiers(source), primaryIds = bankIdentifiers(primary);
  const unreadable = sourceIds.sortCode.unreadable || sourceIds.accountNumber.unreadable || primaryIds.sortCode.unreadable || primaryIds.accountNumber.unreadable;
  const conflict = unreadable || Boolean(
    (sourceIds.sortCode.value && sourceIds.sortCode.value !== primaryIds.sortCode.value) ||
    (sourceIds.accountNumber.value && sourceIds.accountNumber.value !== primaryIds.accountNumber.value)
  );
  const warnings: string[] = [];
  const sourceName = text(source?.bankAccountName).replace(/\s+/g, " ").toLowerCase();
  const primaryName = text(primary?.bankAccountName).replace(/\s+/g, " ").toLowerCase();
  if (!unreadable && !sourceIds.sortCode.value && !sourceIds.accountNumber.value && sourceName) {
    warnings.push("The source has an account-holder name only, not a payout bank destination. This does not block merging. The primary's bank fields stay unchanged and the source's original fields remain in archived history.");
  } else if (!conflict && sourceName && sourceName !== primaryName) {
    warnings.push("The account-holder names differ or one is blank, but the source's recorded bank identifiers match the primary. The primary's bank fields stay unchanged; the source's original name remains in archived history.");
  }
  return { conflict, unreadable, warnings };
}
