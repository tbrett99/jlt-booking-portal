// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  incomeCsv,
  type PaidOutIncomeReport,
  type PaidOutIncomeRow,
  type IncomeCurrencySummary,
} from "../shared/gocardless-income-report";

const mocks = vi.hoisted(() => ({
  data: undefined as PaidOutIncomeReport | undefined,
  flags: {
    isFetching: false,
    isPending: false,
    isLoading: false,
    isError: false,
  },
  error: null as Error | null,
  calls: [] as {
    input: { rangeStart: string; rangeEnd: string; refreshKey?: number };
    options: Record<string, unknown>;
  }[],
  refetch: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    superAdmin: {
      paidOutIncome: {
        useQuery: (input: any, options: any) => {
          mocks.calls.push({ input, options });
          return {
            data: mocks.data,
            ...mocks.flags,
            error: mocks.error,
            refetch: mocks.refetch,
          };
        },
      },
    },
  },
}));
import GoCardlessIncomeReport from "../client/src/pages/admin/GoCardlessIncomeReport";

let root: Root;
let container: HTMLDivElement;
const defaultRange = { rangeStart: "2026-10-19", rangeEnd: "2026-10-25" };
function row(overrides: Partial<PaidOutIncomeRow> = {}): PaidOutIncomeRow {
  return {
    paymentId: "PM-JOIN-1",
    payoutId: "PO-PAID-1",
    paidOutAt: "2026-10-20T23:30:00Z",
    chargeDate: "2026-10-15",
    amountMinor: 10001,
    currency: "GBP",
    category: "joining_fee",
    categoryEvidence: "Recorded joining-fee payment reference",
    agentId: 7,
    agentName: "Team Lead Ada",
    identityStatus: "matched",
    sources: ["Facebook", "Referral"],
    sourceEvidence: "CRM multi-selected referral sources",
    description: "Joining fee paid by team lead",
    currentStatus: "paid_out",
    reviewReason: null,
    ...overrides,
  };
}
function fixture(
  overrides: Partial<PaidOutIncomeReport> = {}
): PaidOutIncomeReport {
  const rows = overrides.rows ?? [
    row(),
    row({ paymentId: "PM-JOIN-2", amountMinor: 10002, sources: ["Referral"] }),
    row({
      paymentId: "PM-MEMBER-1",
      category: "membership",
      amountMinor: 3999,
      categoryEvidence: "Membership subscription",
      sources: [],
    }),
    row({
      paymentId: "PM-MEMBER-2",
      category: "membership",
      amountMinor: 4001,
      categoryEvidence: "Membership subscription",
      sources: [],
    }),
    row({
      paymentId: "PM-OTHER-USD",
      category: "other",
      amountMinor: 12345,
      currency: "USD",
      currentStatus: "refunded",
      reviewReason: "Later refund; paid-out event retained",
      sources: [],
    }),
    row({
      paymentId: "PM-UNKNOWN",
      category: "unclassified",
      amountMinor: null,
      currency: null,
      agentId: null,
      agentName: '=HYPERLINK("https://example.invalid","payer")',
      identityStatus: "unmatched",
      sources: ["@unverified"],
      sourceEvidence: "Unverified provider metadata",
      categoryEvidence: "No category evidence",
      reviewReason: "Identity and gross amount unknown",
      payoutId: null,
    }),
    row({
      paymentId: "PM-EUR",
      category: "membership",
      amountMinor: 101,
      currency: "EUR",
      sources: [],
    }),
    row({
      paymentId: "PM-UNMATCHED-JOIN",
      amountMinor: 1234,
      agentId: null,
      agentName: null,
      identityStatus: "unmatched",
      sources: [],
      sourceEvidence: "No source evidence",
      reviewReason: "Payer not matched",
    }),
  ];
  const summaries = new Map<string, IncomeCurrencySummary>();
  for (const payment of rows) {
    if (!payment.currency || payment.amountMinor === null) continue;
    let summary = summaries.get(payment.currency);
    if (!summary) {
      summary = {
        currency: payment.currency,
        joiningCount: 0,
        joiningGrossMinor: 0,
        membershipCount: 0,
        membershipGrossMinor: 0,
        otherCount: 0,
        otherGrossMinor: 0,
        unclassifiedCount: 0,
        unclassifiedGrossMinor: 0,
        totalCount: 0,
        totalGrossMinor: 0,
      };
      summaries.set(payment.currency, summary);
    }
    const prefix =
      payment.category === "joining_fee" ? "joining" : payment.category;
    summary[`${prefix}Count`] += 1;
    summary[`${prefix}GrossMinor`] += payment.amountMinor;
    summary.totalCount += 1;
    summary.totalGrossMinor += payment.amountMinor;
  }
  return {
    ...defaultRange,
    asOf: "2026-10-26T08:15:12.345Z",
    providerEnvironment: "sandbox",
    source: "gocardless_paid_out_events",
    rows,
    currencies: [...summaries.values()],
    referralBreakdown: [
      { source: "Facebook", joiningPaymentCount: 1 },
      { source: "Referral", joiningPaymentCount: 2 },
      { source: "Unknown", joiningPaymentCount: 1 },
    ],
    uniqueMatchedJoiners: 1,
    reviewCount: rows.filter(payment => !!payment.reviewReason).length,
    eventCount: rows.length,
    earliestAvailableDate: "2025-04-19",
    complete: true,
    ...overrides,
  };
}
function button(text: string) {
  const match = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).find(
    element =>
      element.textContent?.trim() === text ||
      element.getAttribute("aria-label") === text
  );
  expect(match, `button ${text}`).toBeTruthy();
  return match!;
}
function field(id: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  expect(input, id).toBeTruthy();
  return input!;
}
async function fill(id: string, value: string) {
  const input = field(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function render() {
  await act(async () =>
    root.render(React.createElement(GoCardlessIncomeReport))
  );
}
async function submit() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
async function load(report = fixture()) {
  mocks.data = report;
  await render();
  await submit();
}
const results = () =>
  container.querySelector('[data-testid="income-report-results"]');
const lastCall = () => mocks.calls.at(-1)!;
const tableRows = () =>
  container.querySelectorAll(
    'table[aria-label="GoCardless paid-out payments"] tbody tr'
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // London is already Monday while UTC is still Sunday. No provider/browser reads are made.
  vi.setSystemTime(new Date("2026-10-18T23:30:00Z"));
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.data = undefined;
  mocks.flags = {
    isFetching: false,
    isPending: false,
    isLoading: false,
    isError: false,
  };
  mocks.error = null;
  mocks.calls = [];
  mocks.refetch.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GoCardless paid-out income rendered UI (synthetic reports only)", () => {
  it("starts on the current London Monday–Sunday with the provider query disabled until Load report", async () => {
    mocks.data = fixture(); // Even an available cached result must not appear before applying.
    await render();
    expect(container.querySelector("h2")?.textContent).toBe(
      "GoCardless paid-out income"
    );
    expect(field("income-start").value).toBe("2026-10-19");
    expect(field("income-end").value).toBe("2026-10-25");
    expect(lastCall()).toEqual({
      input: defaultRange,
      options: {
        enabled: false,
        retry: false,
        staleTime: 300000,
        refetchOnWindowFocus: false,
      },
    });
    expect(mocks.calls.every(call => call.options.enabled === false)).toBe(
      true
    );
    expect(results()).toBeNull();
    expect(button("Export CSV").disabled).toBe(true);
    expect(button("Refresh from GoCardless").disabled).toBe(true);
    expect(container.textContent).toContain(
      "No GoCardless report has been requested"
    );
  });

  it("keeps this/last week, previous/next and a picked Wednesday normalized to Monday as drafts only", async () => {
    await render();
    await click("Last week");
    expect(field("income-start").value).toBe("2026-10-12");
    expect(field("income-end").value).toBe("2026-10-18");
    await click("Previous week");
    expect(field("income-start").value).toBe("2026-10-05");
    await click("Next week");
    expect(field("income-start").value).toBe("2026-10-12");
    await click("This week");
    expect(field("income-start").value).toBe("2026-10-19");
    await fill("income-week", "2026-10-14");
    expect(field("income-week").value).toBe("2026-10-12");
    expect(field("income-end").value).toBe("2026-10-18");
    expect(mocks.calls.every(call => call.options.enabled === false)).toBe(
      true
    );
  });

  it("applies custom inclusive dates only on submit and labels actual report range/asOf/environment", async () => {
    await render();
    await fill("income-start", "2026-10-13");
    await fill("income-end", "2026-10-16");
    expect(lastCall().options.enabled).toBe(false);
    mocks.data = fixture({ rangeStart: "2026-10-13", rangeEnd: "2026-10-16" });
    await submit();
    expect(lastCall().input).toEqual({
      rangeStart: "2026-10-13",
      rangeEnd: "2026-10-16",
    });
    expect(lastCall().options.enabled).toBe(true);
    expect(results()).not.toBeNull();
    const label = container.querySelector(
      '[data-testid="income-applied-label"]'
    )!.textContent;
    expect(label).toContain("13 Oct 2026 – 16 Oct 2026");
    expect(label).toContain("26/10/2026, 08:15:12 (London)");
    expect(
      container.querySelector('[title="UTC: 2026-10-26T08:15:12.345Z"]')
    ).not.toBeNull();
    expect(label).toContain("Sandbox GoCardless environment — not live income");
    await fill("income-start", "2026-10-05");
    await fill("income-end", "2026-10-11");
    expect(lastCall().input).toEqual({
      rangeStart: "2026-10-13",
      rangeEnd: "2026-10-16",
    });
    expect(
      container.querySelector('[data-testid="income-applied-label"]')!
        .textContent
    ).toBe(label);
    expect(container.textContent).toContain("Unapplied date changes");
  });

  it("validates inverted, archived and future ranges before enabling any report query", async () => {
    await render();
    await fill("income-start", "2026-10-16");
    await fill("income-end", "2026-10-15");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "end on or after the start"
    );
    await fill("income-start", "2024-01-01");
    await fill("income-end", "2024-01-07");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "18 months"
    );
    await fill("income-start", "2026-12-01");
    await fill("income-end", "2026-12-07");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "cannot start in the future"
    );
    expect(mocks.calls.every(call => call.options.enabled === false)).toBe(
      true
    );
  });

  it("counts individual payments rather than distinct people, preserves exact decimals, and never merges currencies", async () => {
    await load();
    const gbp = container.querySelector(
      '[data-testid="income-currency-GBP"]'
    )!.textContent!;
    expect(gbp).toContain("3 joining-fee payments");
    expect(gbp).toContain("2 individual membership payments"); // Both paid by the same agent.
    expect(gbp).toContain("£212.37");
    expect(gbp).toContain("£80.00");
    expect(gbp).toContain("£292.37");
    expect(gbp).toContain("5 payments, including other / unclassified");
    expect(
      container.querySelector('[data-testid="income-currency-USD"]')!
        .textContent
    ).toContain("US$123.45");
    expect(
      container.querySelector('[data-testid="income-currency-EUR"]')!
        .textContent
    ).toContain("€1.01");
    expect(
      container.querySelectorAll('[data-testid^="income-currency-"]')
    ).toHaveLength(3);
    expect(
      container.querySelector('[data-testid="income-report-totals"]')!
        .textContent
    ).toContain("8 paid-out payment rows");
    expect(container.textContent).toContain("Counts are payments, not people");
  });

  it("shows actual London paid-out dates, source evidence and CRM links only for confirmed identities", async () => {
    await load();
    expect(tableRows()).toHaveLength(3);
    const first = tableRows()[0];
    expect(first.textContent).toContain("Team Lead Ada");
    expect(first.textContent).toContain("Facebook; Referral");
    expect(first.textContent).toContain("CRM multi-selected referral sources");
    expect(first.textContent).toContain("£100.01");
    expect(first.textContent).toContain("2026-10-21 (London)"); // BST means next calendar day.
    expect(first.textContent).toContain("PO-PAID-1");
    expect(first.textContent).not.toContain("2026-10-15"); // Charge date is not payout date.
    expect(first.querySelector("a")?.getAttribute("href")).toBe(
      "/crm/agents?agent=7"
    );
    const unmatched = tableRows()[2];
    expect(unmatched.textContent).toContain("Unknown payer");
    expect(unmatched.textContent).toContain("Unknown source");
    expect(unmatched.textContent).toContain("Payer not matched");
    expect(unmatched.querySelector("a")).toBeNull();
    expect(container.textContent).toContain(
      "team lead paying for someone else"
    );
    expect(container.textContent).toContain("not bank statement confirmation");
    expect(container.textContent).toContain(
      "does not deduct fees, refunds or chargebacks"
    );
  });

  it("offers Membership and Other + needs review without guessing identities, amounts or classification", async () => {
    mocks.data = fixture();
    // An ambiguous row with an apparent ID must still never link to a guessed CRM record.
    mocks.data.rows[5].agentId = 99;
    mocks.data.rows[5].identityStatus = "ambiguous";
    await render();
    await submit();
    await click("Membership");
    expect(tableRows()).toHaveLength(3);
    expect(
      Array.from(tableRows()).every(element =>
        element.textContent?.includes("Membership fee")
      )
    ).toBe(true);
    await click("Other + needs review");
    expect(tableRows()).toHaveLength(3);
    const unknown = Array.from(tableRows()).find(element =>
      element.textContent?.includes("PM-UNKNOWN")
    )!;
    expect(unknown.textContent).toContain("Needs classification");
    expect(unknown.textContent).toContain("Ambiguous identity — needs review");
    expect(unknown.textContent).toContain("Unknown gross / currency");
    expect(unknown.textContent).toContain("Unverified provider metadata");
    expect(unknown.querySelector("a")).toBeNull();
    expect(
      container.querySelector('a[href="/crm/agents?agent=99"]')
    ).toBeNull();
    expect(container.textContent).toContain("Current status: refunded");
    expect(container.textContent).toContain(
      "Later refund; paid-out event retained"
    );
    expect(container.textContent).toContain(
      "Missing values are not assumed to be zero"
    );
  });

  it("explains multi-source overlap and counts each joining payment under every selected source", async () => {
    await load();
    const breakdown = container.querySelector(
      '[aria-label="Referral source payment counts"]'
    )!;
    expect(breakdown.textContent).toContain("Facebook: 1 payments");
    expect(breakdown.textContent).toContain("Referral: 2 payments");
    expect(breakdown.textContent).toContain("Unknown: 1 payments");
    expect(container.textContent).toContain("Multi-selected sources overlap");
    expect(container.textContent).toContain(
      "must not be added as a unique payment or person total"
    );
  });

  it("paginates 25 rows, searches payer/ID/source, and leaves full-report totals and breakdown unchanged", async () => {
    const report = fixture({
      rows: Array.from({ length: 31 }, (_, index) =>
        row({ paymentId: `PM-PAGE-${index + 1}`, amountMinor: 101 })
      ),
    });
    await load(report);
    expect(tableRows()).toHaveLength(25);
    expect(container.textContent).toContain("1–25 of 31 matching rows");
    const totals = container.querySelector(
      '[data-testid="income-currency-GBP"]'
    )!.textContent;
    const breakdown = container.querySelector(
      '[aria-label="Referral source payment counts"]'
    )!.textContent;
    expect(totals).toContain("31 joining-fee payments");
    expect(totals).toContain("£31.31");
    await click("Next page");
    expect(tableRows()).toHaveLength(6);
    expect(container.textContent).toContain("26–31 of 31 matching rows");
    await fill("income-search", "PM-PAGE-31");
    expect(tableRows()).toHaveLength(1);
    expect(container.textContent).toContain("Page 1 of 1");
    expect(
      container.querySelector('[data-testid="income-currency-GBP"]')!
        .textContent
    ).toBe(totals);
    expect(
      container.querySelector('[aria-label="Referral source payment counts"]')!
        .textContent
    ).toBe(breakdown);
    await fill("income-search", "no such payer");
    expect(container.textContent).toContain(
      "No payments match this table view"
    );
    expect(button("Export CSV").disabled).toBe(false);
    await fill("income-search", "team lead ada");
    expect(container.textContent).toContain("of 31 matching rows");
    await fill("income-search", "facebook");
    expect(container.textContent).toContain("of 31 matching rows");
  });

  it.each(["isFetching", "isPending", "isLoading"] as const)(
    "withholds cached totals, table and CSV while %s",
    async flag => {
      await load();
      expect(results()).not.toBeNull();
      mocks.flags[flag] = true;
      await render();
      expect(results()).toBeNull();
      expect(container.querySelector("table")).toBeNull();
      expect(container.textContent).not.toContain("£292.37");
      expect(container.textContent).toContain(
        "Previous results are withheld while loading"
      );
      expect(button("Export CSV").disabled).toBe(true);
      expect(button("Refresh from GoCardless").disabled).toBe(true);
      expect(button("Load report").disabled).toBe(true);
    }
  );

  it("withholds cached success on error rather than reporting true zero, and allows explicit retry", async () => {
    await load();
    mocks.flags.isError = true;
    mocks.error = new Error("Synthetic provider timeout");
    await render();
    expect(results()).toBeNull();
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Synthetic provider timeout");
    expect(container.textContent).toContain("not a zero-income result");
    expect(container.textContent).not.toContain(
      "No paid-out payment events were returned"
    );
    expect(button("Export CSV").disabled).toBe(true);
    expect(button("Load report").disabled).toBe(false);
    await submit();
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("does not treat absent, incomplete, or different-range cached data as success or zero", async () => {
    await render();
    await submit();
    expect(results()).toBeNull();
    expect(container.textContent).toContain("Awaiting a complete report");
    mocks.data = fixture({ rangeStart: "2026-10-12", rangeEnd: "2026-10-18" });
    await render();
    expect(results()).toBeNull();
    mocks.data = { ...fixture(), complete: false } as any;
    await render();
    expect(results()).toBeNull();
    expect(button("Export CSV").disabled).toBe(true);
    expect(container.textContent).not.toContain(
      "No paid-out payment events were returned"
    );
  });

  it("only presents a true empty result after a successful complete applied report", async () => {
    await load(
      fixture({
        rows: [],
        currencies: [],
        referralBreakdown: [],
        eventCount: 0,
        reviewCount: 0,
      })
    );
    expect(results()).not.toBeNull();
    expect(container.textContent).toContain(
      "No paid-out payment events were returned for this applied range"
    );
    expect(container.textContent).toContain("0 paid-out payment rows");
    expect(button("Export CSV").disabled).toBe(true);
  });

  it("Refresh from GoCardless uses a new Date.now key for the applied range, not draft edits", async () => {
    await load();
    await fill("income-start", "2026-10-12");
    await fill("income-end", "2026-10-18");
    const now = Date.now();
    mocks.flags.isFetching = true;
    await click("Refresh from GoCardless");
    expect(lastCall().input).toEqual({ ...defaultRange, refreshKey: now });
    expect(results()).toBeNull();
    mocks.flags.isFetching = false;
    mocks.data = fixture({ asOf: "2026-10-26T09:30:00.000Z" });
    await render();
    expect(
      container.querySelector('[data-testid="income-applied-label"]')!
        .textContent
    ).toContain("26/10/2026, 09:30:00 (London)");
    vi.setSystemTime(new Date("2026-10-18T23:30:01Z"));
    await click("Refresh from GoCardless");
    expect(lastCall().input.refreshKey).toBe(Date.now());
    expect(lastCall().input.refreshKey).not.toBe(now);
  });

  it("exports incomeCsv with all rows including unknowns, not the page/search/category, and the actual range filename", async () => {
    const base = fixture();
    const report = fixture({
      rows: [
        ...base.rows,
        ...Array.from({ length: 26 }, (_, index) =>
          row({
            paymentId: `PM-EXTRA-${index}`,
            category: "membership",
            amountMinor: 101,
          })
        ),
      ],
    });
    let exportedBlob: Blob | undefined;
    let downloadName: string | undefined;
    const createObjectURL = vi.fn((blob: Blob) => {
      exportedBlob = blob;
      return "blob:synthetic-income-csv";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL })
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloadName = this.download;
    });
    await load(report);
    await click("All");
    expect(tableRows()).toHaveLength(25);
    await click("Joining fees");
    await fill("income-search", "PM-JOIN-1");
    expect(tableRows()).toHaveLength(1);
    await fill("income-start", "2026-10-12");
    await fill("income-end", "2026-10-18");
    await click("Export CSV");
    expect(downloadName).toBe(
      "gocardless-paid-out-income-2026-10-19-to-2026-10-25.csv"
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-income-csv");
    expect(exportedBlob?.type).toBe("text/csv;charset=utf-8");
    const csv = await exportedBlob!.text();
    expect(csv).toBe(incomeCsv(report));
    expect(csv).toContain('"PM-UNKNOWN"');
    expect(csv).toContain('"PM-EXTRA-25"');
    expect(csv).toContain('"123.45","USD"');
    expect(csv).toContain('"1.01","EUR"');
    expect(csv).toContain(
      '"\'=HYPERLINK(""https://example.invalid"",""payer"")"'
    );
    expect(csv).toContain('"\'@unverified"');
    expect(csv).toContain('"unmatched"');
    expect(csv).toContain("\r\n");
  });

  it("explains on-demand 18-month history and archived support reports without offering upload/bank/provider actions", async () => {
    await load();
    const details = Array.from(container.querySelectorAll("details")).find(
      element =>
        element.querySelector("summary")?.textContent ===
        "History and read-only scope"
    )!;
    expect(details.textContent).toContain("18 months of API event history");
    expect(details.textContent).toContain("read automatically on demand");
    expect(details.textContent).toContain(
      "Earliest available London date: 2025-04-19"
    );
    expect(details.textContent).toContain(
      "archived reports from GoCardless support"
    );
    expect(details.textContent).toContain(
      "does not automatically recover archives, generate receipts, send mail, upload files, confirm bank deposits or change the ledger"
    );
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelectorAll('a[href^="http"]')).toHaveLength(0);
    expect(container.textContent).not.toContain(
      "bank reconciliation confirmed"
    );
  });

  it("labels a verified GoCardless joining payer without implying Portal association or exposing ambiguous ownership names", async () => {
    const report = fixture({
      rows: [
        row({
          paymentId: "PM-PROVIDER-PAYER",
          agentId: null,
          agentName: "Verified Provider Payer",
          identityStatus: "unmatched",
          sources: ["Not recorded"],
          sourceEvidence:
            "Verified GoCardless customer name; no acquisition source",
          reviewReason: "Payer not linked to one verified Portal agent",
        }),
        row({
          paymentId: "PM-AMBIGUOUS",
          agentId: null,
          agentName: "Must Not Display Provider Name",
          identityStatus: "ambiguous",
          reviewReason: "Portal payer ownership conflicts",
        }),
      ],
    });
    await load(report);
    const provider = tableRows()[0];
    expect(provider.textContent).toContain("Verified Provider Payer");
    expect(provider.textContent).toContain(
      "GoCardless payer · not linked to one Portal agent"
    );
    expect(provider.querySelector("a")).toBeNull();
    const ambiguous = tableRows()[1];
    expect(ambiguous.textContent).toContain(
      "Ambiguous identity — needs review"
    );
    expect(ambiguous.textContent).not.toContain(
      "Must Not Display Provider Name"
    );
    expect(ambiguous.querySelector("a")).toBeNull();
    expect(container.textContent).toContain(
      "current CRM/form attribution, not a historical snapshot"
    );
  });

  it("includes missing joining sources in needs-review view and labels verified totals as a lower bound when amounts are unknown", async () => {
    await load(
      fixture({
        rows: [
          row({
            paymentId: "PM-NO-SOURCE",
            sources: ["Not recorded"],
            sourceEvidence: "No verified acquisition-source record",
            reviewReason: null,
          }),
          row({
            paymentId: "PM-UNKNOWN-GBP",
            amountMinor: null,
            reviewReason: "Missing payment amount",
          }),
          row({
            paymentId: "PM-UNCLASSIFIED-GBP",
            category: "unclassified",
            amountMinor: 123,
            categoryEvidence: "No classification evidence",
            reviewReason: "Needs classification",
          }),
        ],
      })
    );
    const totals = container.querySelector(
      '[data-testid="income-currency-GBP"]'
    )!.textContent!;
    expect(totals).toContain("Verified gross amounts");
    expect(totals).toContain("£101.24");
    expect(totals).toContain("Unclassified: 1 payments · £1.23");
    expect(totals).toContain(
      "only rows with verified gross amounts and currency"
    );
    expect(container.textContent).toContain(
      "a lower bound, not a complete monetary total"
    );
    expect(container.textContent).toContain(
      "Missing values are not assumed to be zero"
    );
    expect(container.textContent).toContain(
      "Paid-out event pagination is complete"
    );
    await click("Other + needs review");
    expect(tableRows()).toHaveLength(3);
    expect(container.querySelector("table")!.textContent).toContain(
      "PM-NO-SOURCE"
    );
    expect(container.querySelector("table")!.textContent).toContain(
      "PM-UNKNOWN-GBP"
    );
  });
});
