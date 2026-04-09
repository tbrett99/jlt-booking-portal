// CSV Parser Web Worker
// Runs off the main thread to avoid blocking the UI on large files

export type CsvParseMessage = {
  type: "parse";
  text: string;
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

self.onmessage = (event: MessageEvent<CsvParseMessage>) => {
  if (event.data.type === "parse") {
    try {
      const rows = parseCsv(event.data.text);
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
