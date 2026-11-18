// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FinancialsIncome } from "../shared/financials-income";
import FinancialsIncomeCard from "../client/src/pages/admin/FinancialsIncomeCard";

let root: Root;
let container: HTMLDivElement;

function recordedIncome(overrides: Partial<FinancialsIncome> = {}): FinancialsIncome {
  return {
    available: true,
    reason: null,
    gcGrossMinor: 12000,
    gcVatMinor: 2000,
    gcExVatMinor: 10000,
    commissionMinor: 5000,
    grossIncomeMinor: 17000,
    incomeAfterVatMinor: 15000,
    paymentCount: 1,
    ...overrides,
  };
}

async function render(income: FinancialsIncome | null | undefined, periodLabel: "This Week" | "This Month" = "This Week") {
  await act(async () => root.render(React.createElement(FinancialsIncomeCard, { income, periodLabel })));
}

function breakdown(label: string): string | null {
  const term = Array.from(container.querySelectorAll("dt")).find(element => element.textContent === label);
  expect(term, label).toBeTruthy();
  return term!.nextElementSibling!.textContent;
}

beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Financials income after VAT card", () => {
  it("deducts only GoCardless VAT from the recorded total and leaves the commission share unchanged", async () => {
    await render(recordedIncome());
    expect(container.textContent).toContain("Income after VAT · This Week");
    expect(container.querySelector(".text-3xl")?.textContent).toBe("£150.00");
    expect(breakdown("Gross recorded income")).toBe("£170.00");
    expect(breakdown("GoCardless paid out (gross)")).toBe("£120.00");
    expect(breakdown("GoCardless VAT deduction (20%)")).toBe("-£20.00");
    expect(breakdown("GoCardless income excluding VAT")).toBe("£100.00");
    expect(breakdown("JLT commission share (no VAT deducted)")).toBe("£50.00");
  });

  it("retains nonzero pennies in every displayed amount and supports the monthly headline", async () => {
    await render(recordedIncome({
      gcGrossMinor: 12005,
      gcVatMinor: 2001,
      gcExVatMinor: 10004,
      commissionMinor: 5007,
      grossIncomeMinor: 17012,
      incomeAfterVatMinor: 15011,
    }), "This Month");
    expect(container.textContent).toContain("Income after VAT · This Month");
    expect(container.querySelector(".text-3xl")?.textContent).toBe("£150.11");
    expect(breakdown("Gross recorded income")).toBe("£170.12");
    expect(breakdown("GoCardless paid out (gross)")).toBe("£120.05");
    expect(breakdown("GoCardless VAT deduction (20%)")).toBe("-£20.01");
    expect(breakdown("GoCardless income excluding VAT")).toBe("£100.04");
    expect(breakdown("JLT commission share (no VAT deducted)")).toBe("£50.07");
  });

  it("displays a legitimate empty period as £0.00 rather than unavailable", async () => {
    await render(recordedIncome({
      gcGrossMinor: 0,
      gcVatMinor: 0,
      gcExVatMinor: 0,
      commissionMinor: 0,
      grossIncomeMinor: 0,
      incomeAfterVatMinor: 0,
      paymentCount: 0,
    }));
    expect(container.querySelector(".text-3xl")?.textContent).toBe("£0.00");
    expect(container.textContent).not.toContain("unavailable");
    expect(Array.from(container.querySelectorAll("dd")).map(element => element.textContent))
      .toEqual(["£0.00", "£0.00", "£0.00", "£0.00", "£0.00"]);
  });

  it("does not deduct VAT from a commission-only period", async () => {
    await render(recordedIncome({
      gcGrossMinor: 0,
      gcVatMinor: 0,
      gcExVatMinor: 0,
      commissionMinor: 5007,
      grossIncomeMinor: 5007,
      incomeAfterVatMinor: 5007,
      paymentCount: 0,
    }));
    expect(container.querySelector(".text-3xl")?.textContent).toBe("£50.07");
    expect(breakdown("JLT commission share (no VAT deducted)")).toBe("£50.07");
    expect(breakdown("GoCardless VAT deduction (20%)")).toBe("£0.00");
  });

  it.each([undefined, null])("shows no false amount when the new field is %s", async income => {
    await render(income);
    expect(container.textContent).toContain("Income after VAT unavailable");
    expect(container.textContent).not.toContain("£");
    expect(container.querySelector("dl")).toBeNull();
  });

  const reasons: Exclude<FinancialsIncome["reason"], null>[] = [
    "missing_payment_evidence",
    "conflicting_payment_evidence",
    "non_gbp_income",
    "invalid_commission",
    "too_many_events",
    "unavailable",
  ];
  it.each(reasons)("shows only a generic unavailable message for %s without leaking partial amounts", async reason => {
    // Even a stale payload containing amounts must not be shown as trustworthy.
    await render(recordedIncome({ available: false, reason }));
    expect(container.textContent).toContain("Income after VAT unavailable");
    expect(container.textContent).toContain("Recorded income cannot be reliably calculated for this period.");
    expect(container.textContent).not.toContain("£");
    expect(container.querySelector("dl")).toBeNull();
    if (reason !== "unavailable") expect(container.textContent).not.toContain(reason);
  });

  it("fails closed for incomplete amounts even if the payload claims availability", async () => {
    await render(recordedIncome({ gcVatMinor: null }));
    expect(container.textContent).toContain("Income after VAT unavailable");
    expect(container.textContent).not.toContain("£");
  });

  it("does not silently round invalid fractional minor units", async () => {
    await render(recordedIncome({ incomeAfterVatMinor: 15000.5 }));
    expect(container.textContent).toContain("Income after VAT unavailable");
    expect(container.textContent).not.toContain("£");
  });

  it("explains the VAT scope, recorded sources, batch date, exclusions, and reconciliation limitations", async () => {
    const note = "20% VAT deducted from GoCardless only; commission share unchanged. Recorded GoCardless paid-out income and PTS remittance share by batch date. Before fees/refunds/chargebacks; not profit or a bank reconciliation.";
    await render(recordedIncome());
    expect(container.textContent).toContain(note);
    await render(undefined);
    expect(container.textContent).toContain(note);
  });
});

describe("Financials production integration", () => {
  it("mounts the reusable headline exactly once per Financials tab using only the new weekly or monthly field", () => {
    const source = readFileSync(`${process.cwd()}/client/src/pages/admin/SuperAdminDashboard.tsx`, "utf8");
    const file = ts.createSourceFile("SuperAdminDashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const mounts: ts.JsxSelfClosingElement[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "FinancialsIncomeCard") mounts.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(mounts).toHaveLength(2);
    const wiring = mounts.map(mount => {
      const attrs = mount.attributes.properties;
      expect(attrs).toHaveLength(2);
      const income = attrs.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === "income") as ts.JsxAttribute;
      const period = attrs.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === "periodLabel") as ts.JsxAttribute;
      expect(income.initializer && ts.isJsxExpression(income.initializer)).toBe(true);
      expect(period.initializer && ts.isStringLiteral(period.initializer)).toBe(true);
      let parent: ts.Node | undefined = mount.parent;
      while (parent && !(ts.isJsxElement(parent) && parent.openingElement.tagName.getText(file) === "TabsContent")) parent = parent.parent;
      expect(parent).toBeDefined();
      const tab = parent as ts.JsxElement;
      expect(tab.openingElement.attributes.getText(file)).toContain('value="financials"');
      // The new headline remains above the existing, unchanged commission cards.
      expect(tab.getText(file).indexOf("FinancialsIncomeCard")).toBeLessThan(tab.getText(file).indexOf('title="JLT Revenue (Remittance)"'));
      expect(tab.getText(file)).toContain('title="Agent Payouts"');
      expect(tab.getText(file)).toContain('title="Commission Claims (New)"');
      expect(tab.getText(file)).toContain('title="Commissions Paid"');
      return {
        income: (income.initializer as ts.JsxExpression).expression!.getText(file),
        period: (period.initializer as ts.StringLiteral).text,
      };
    });
    expect(wiring).toEqual([
      { income: "financials.incomeAfterVat", period: "This Month" },
      { income: "data.financials.incomeAfterVat", period: "This Week" },
    ]);
    expect(source).not.toContain("Total Income This Week");
    expect(source).not.toContain("Total Income This Month");
    expect(source).not.toContain("totalIncomeThisWeek");
    expect(source).not.toContain("totalIncomeThisMonth");
  });
});

describe("Financials signed adjustments and exact reconciliation", () => {
  it("preserves a valid negative commission adjustment without applying VAT to it", async () => {
    await render(recordedIncome({ commissionMinor: -5025, grossIncomeMinor: 6975, incomeAfterVatMinor: 4975 }));
    expect(container.querySelector(".text-3xl")?.textContent).toBe("£49.75");
    expect(breakdown("JLT commission share (no VAT deducted)")).toBe("-£50.25");
    expect(breakdown("GoCardless VAT deduction (20%)")).toBe("-£20.00");
  });
  it("displays negative commission-only recorded income rather than silently presenting zero", async () => {
    await render(recordedIncome({ gcGrossMinor: 0, gcVatMinor: 0, gcExVatMinor: 0,
      commissionMinor: -15000, grossIncomeMinor: -15000, incomeAfterVatMinor: -15000 }));
    expect(container.querySelector(".text-3xl")?.textContent).toBe("-£150.00");
  });
  it.each([{ incomeAfterVatMinor: 16000 }, { grossIncomeMinor: 10000 }, { gcExVatMinor: 12000 }, { gcVatMinor: -1 }])
    ("withholds payloads whose breakdown does not reconcile: %s", async invalid => {
      await render(recordedIncome(invalid));
      expect(container.textContent).toContain("Income after VAT unavailable");
      expect(container.textContent).not.toContain("£");
    });
});
