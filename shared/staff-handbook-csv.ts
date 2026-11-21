/** Spreadsheet-safe UTF-8 CSV: all cells quoted, CRLF records and a BOM. */
export function serializeHandbookCsv(headers: string[], rows: unknown[][]): string {
  const quote = (value: unknown): string => {
    let text = value == null ? "" : String(value);
    // Quoting alone does not prevent spreadsheet formulas. Check through leading
    // Unicode whitespace and C0/C1 controls, but preserve the original cell text.
    if (/^[\s\x00-\x1f\x7f-\x9f]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + [headers, ...rows].map(row => row.map(quote).join(",")).join("\r\n") + "\r\n";
}

/** Authenticated staff route, not a public or deployment-specific absolute URL. */
export function handbookGuideUrl(id: number): string {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647)
    throw new Error("Invalid handbook guide ID.");
  return `/admin/staff-handbook?tab=handbook&article=${id}`;
}
