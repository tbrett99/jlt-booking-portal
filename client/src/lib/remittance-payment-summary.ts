type RemittanceVatLine = {
  vatFromPortal?: string | number | null;
  vatFromPts?: string | number | null;
};

/** The recorded VAT deduction, not VAT added to the agent's payment. */
export function paymentSummaryVat(lines: readonly RemittanceVatLine[]): string {
  let totalPence = 0;
  let missing = 0;
  for (const line of lines) {
    // Match the remittance breakdown: an explicit Portal zero overrides PTS VAT.
    const raw = line.vatFromPortal ?? line.vatFromPts;
    const amount = raw === null || raw === undefined || String(raw).trim() === ""
      ? NaN
      : Number(String(raw).replace(/[£,\s]/g, ""));
    if (!Number.isFinite(amount)) {
      missing += 1;
    } else {
      totalPence += Math.round(amount * 100);
    }
  }
  if (lines.length > 0 && missing === lines.length) return "Not recorded";
  const total = `£${(totalPence / 100).toFixed(2)}`;
  return missing > 0
    ? `${total} recorded; VAT missing for ${missing} claim${missing === 1 ? "" : "s"}`
    : total;
}
