// CSV Parser Web Worker
// Uses PapaParse for robust RFC 4180 parsing (handles multi-line quoted fields,
// large files, BOM, etc.) without blocking the main thread.

import Papa from "papaparse";

export type CsvParseMessage = {
  type: "parse";
  buffer: ArrayBuffer;
};

export type CsvParseResult =
  | {
      type: "done";
      rows: Record<string, string>[];
      rowCount: number;
    }
  | {
      type: "error";
      message: string;
    };

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

      // Use PapaParse — handles quoted multi-line fields, BOM, empty rows, etc.
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
        transform: (v) => v.trim(),
      });

      if (result.errors && result.errors.length > 0) {
        // Log errors but don't fail — PapaParse recovers from most errors
        console.warn("[csvParser.worker] PapaParse warnings:", result.errors.slice(0, 5));
      }

      // Strip unused columns to minimise postMessage payload
      const rows = (result.data as Record<string, string>[]).map((row) => {
        const slim: Record<string, string> = {};
        for (const key of Object.keys(row)) {
          if (NEEDED_COLUMNS.has(key)) slim[key] = row[key] ?? "";
        }
        return slim;
      });

      const out: CsvParseResult = {
        type: "done",
        rows,
        rowCount: rows.length,
      };
      self.postMessage(out);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown parsing error";
      const out: CsvParseResult = { type: "error", message };
      self.postMessage(out);
    }
  }
};
