import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { paymentSummaryVat } from "../client/src/lib/remittance-payment-summary";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "../client/src/pages/admin/RemittanceManagement.tsx"), "utf8");

function runSummary(agents: unknown[], batchName?: string) {
  const start = source.indexOf("  const exportPaymentSummary = () => {");
  const end = source.indexOf("  const [confirmPush", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exportToCsv = vi.fn();
  // Execute the actual client export handler with only mock records and a mock download.
  new Function("agents", "batchName", "exportToCsv", "paymentSummaryVat", `${code}\nexportPaymentSummary();`)(
    agents, batchName, exportToCsv, paymentSummaryVat,
  );
  return exportToCsv.mock.calls[0] as [string, Record<string, string>[]];
}

const agent = {
  agentName: "Example Agent",
  agentEmail: "agent@example.test",
  bankAccountName: "Example Account",
  bankSortCode: "00-00-00",
  bankAccountNumber: "00000000",
  lines: [
    { remit80: "80.00", vatFromPortal: "10.00", vatFromPts: "99.00" },
    { remit80: "160.00", vatFromPortal: null, vatFromPts: "20.00" },
  ],
};

describe("remittance payment summary VAT", () => {
  it("uses the same effective recorded deduction as the line breakdown", () => {
    expect(paymentSummaryVat(agent.lines)).toBe("£30.00");
  });

  it("preserves an explicit Portal zero rather than substituting PTS VAT", () => {
    expect(paymentSummaryVat([{ vatFromPortal: 0, vatFromPts: "25.00" }])).toBe("£0.00");
  });

  it("totals decimal currency in pennies", () => {
    expect(paymentSummaryVat([{ vatFromPts: "0.10" }, { vatFromPts: "0.20" }])).toBe("£0.30");
    expect(paymentSummaryVat([{ vatFromPortal: "£1,000.00" }])).toBe("£1000.00");
  });

  it("does not present unknown or invalid VAT as a confirmed zero or full total", () => {
    expect(paymentSummaryVat([{ vatFromPortal: null, vatFromPts: null }])).toBe("Not recorded");
    expect(paymentSummaryVat([{ vatFromPortal: "" }])).toBe("Not recorded");
    expect(paymentSummaryVat([{ vatFromPortal: "invalid", vatFromPts: "50" }])).toBe("Not recorded");
    expect(paymentSummaryVat([{ vatFromPts: "10.00" }, {}])).toBe("£10.00 recorded; VAT missing for 1 claim");
  });

  it("adds VAT to actual agent and TOTAL rows without subtracting it again from payout", () => {
    const [filename, rows] = runSummary([agent], "Example Week");
    expect(filename).toBe("payment-summary-Example Week.csv");
    expect(rows).toEqual([
      {
        "Agent": "Example Agent", "Agent Email": "agent@example.test",
        "Bank Account Name": "Example Account", "Sort Code": "00-00-00", "Account Number": "00000000",
        "Number of Claims": "2", "VAT (deducted)": "£30.00", "Total to Pay (80%)": "£240.00",
      },
      {
        "Agent": "TOTAL", "Agent Email": "", "Bank Account Name": "", "Sort Code": "", "Account Number": "",
        "Number of Claims": "2", "VAT (deducted)": "£30.00", "Total to Pay (80%)": "£240.00",
      },
    ]);
  });

  it("keeps the existing agent groups and payment amounts even with a different commission split", () => {
    const another = { agentName: "Other Agent", agentEmail: "other@example.test", lines: [{ remit80: "90.00", vatFromPortal: "0.00" }] };
    const [, rows] = runSummary([agent, another]);
    expect(rows.map((row) => row["Total to Pay (80%)"])).toEqual(["£240.00", "£90.00", "£330.00"]);
    expect(rows.map((row) => row["VAT (deducted)"])).toEqual(["£30.00", "£0.00", "£30.00"]);
    expect(rows[2]["Number of Claims"]).toBe("3");
  });

  it("does not change a payout when VAT is missing", () => {
    const [, rows] = runSummary([{ agentName: "Missing VAT", lines: [{ remit80: "80.00" }] }]);
    expect(rows[0]["VAT (deducted)"]).toBe("Not recorded");
    expect(rows[1]["VAT (deducted)"]).toBe("Not recorded");
    expect(rows[0]["Total to Pay (80%)"]).toBe("£80.00");
  });

  it("keeps an empty summary at zero and introduces no new data fetching or mutation", () => {
    const [, rows] = runSummary([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]["VAT (deducted)"]).toBe("£0.00");
    expect(rows[0]["Total to Pay (80%)"]).toBe("£0.00");
    expect(source).toContain('title="One row per agent showing recorded VAT deducted and total to pay"');
    const handler = source.slice(source.indexOf("  const exportPaymentSummary"), source.indexOf("  const [confirmPush"));
    expect(handler).not.toMatch(/\.mutate\(|fetch\(|\.useQuery\(/);
  });
});
