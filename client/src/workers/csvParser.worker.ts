// CSV Parser Web Worker
// Runs off the main thread to avoid blocking the UI on large files

export type CsvParseMessage = {
  type: "parse";
  buffer: ArrayBuffer;
};

export type CsvParseResult = {
  type: "done";
  rows: Record<string, string>[];
  rowCount: number;
} | {
  type: "error";
  message: string;
};

/**
 * RFC 4180-compliant CSV parser that handles:
 * - Quoted fields with embedded commas
 * - Quoted fields with embedded newlines (like GHL's Notes column)
 * - Escaped double-quotes ("") inside quoted fields
 */
function parseCsv(text: string): Record<string, string>[] {
  const tokens: string[][] = [[]];
  let current = "";
  let inQuotes = false;
  const n = text.length;

  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          // Escaped quote inside quoted field
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        tokens[tokens.length - 1].push(current);
        current = "";
      } else if (ch === '\n' || (ch === '\r' && i + 1 < n && text[i + 1] === '\n')) {
        if (ch === '\r') i++; // skip \n of \r\n
        tokens[tokens.length - 1].push(current);
        current = "";
        tokens.push([]);
      } else {
        current += ch;
      }
    }
  }
  // Push last field
  tokens[tokens.length - 1].push(current);

  // Remove empty trailing rows
  const nonEmpty = tokens.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length < 2) return [];

  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").trim();
    });
    return row;
  });
}

// Only the columns we actually use — strip Notes and other large/unused columns
// to keep the postMessage payload small (< 1 MB vs 11+ MB for full rows)
const NEEDED_COLUMNS = new Set([
  "Opportunity Name",
  "Contact Name",
  "Lead Pax Name",
  "stage",
  "Stage",
  "Departure Date",
  "Close Date",
  "Lead Value",
  "Amount",
  "PTS Booking Reference",
  "Topdog Booking Reference",
  "2T Number",
  "Final Supplier Payment Date",
  "Do you require any reimbursements?",
  "Name",
]);

self.onmessage = (event: MessageEvent<CsvParseMessage>) => {
  if (event.data.type === "parse") {
    try {
      // Decode the transferred ArrayBuffer to a string inside the worker
      const text = new TextDecoder("utf-8").decode(event.data.buffer);
      const allRows = parseCsv(text);
      // Strip unused columns to minimise postMessage payload
      const rows = allRows.map((row) => {
        const slim: Record<string, string> = {};
        for (const key of Object.keys(row)) {
          if (NEEDED_COLUMNS.has(key)) slim[key] = row[key];
        }
        return slim;
      });
      const result: CsvParseResult = {
        type: "done",
        rows,
        rowCount: rows.length,
      };
      self.postMessage(result);
    } catch (err: any) {
      const result: CsvParseResult = {
        type: "error",
        message: err?.message ?? "Unknown parsing error",
      };
      self.postMessage(result);
    }
  }
};
