// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HqBookingDrilldown,
  HqMoneyCoverage,
  HqReport,
  HqReportTotals,
} from "@shared/management-hq-report";

// Only auth/tRPC are mocked: the page, React DOM, tables, selects and Buttons are real.
const mock = vi.hoisted(() => ({
  user: {
    id: 47,
    role: "super_admin",
    isActive: true,
    portalStatus: "active",
  } as any,
  loading: false,
  authError: null as any,
  data: {} as Record<string, any>,
  errors: {} as Record<string, any>,
  fetching: {} as Record<string, boolean>,
  queryWait: {} as Record<string, Promise<void>>,
  mutationWait: undefined as Promise<void> | undefined,
  mutationError: null as any,
  autoFilters: true,
  hooks: [] as { path: string; input: any; options: any }[],
  mutations: [] as any[],
  refetch: vi.fn(),
  cancel: vi.fn(),
  csv: vi.fn(),
  network: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mock.user,
    loading: mock.loading,
    error: mock.authError,
  }),
}));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const read = (path: string, input?: any) =>
    path === "auth.me"
      ? (mock.data[path] ?? mock.user)
      : path === "managementHq.report" && mock.autoFilters && mock.data[path]
        ? {
            ...mock.data[path],
            filters: { year: input.year, month: input.month ?? null },
          }
        : mock.data[path];
  const nodes = new Map<string, any>();
  const node = (path = ""): any => {
    if (nodes.has(path)) return nodes.get(path);
    const proxy = new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useUtils") return () => node("utils");
          if (key === "cancel") return (input: any) => mock.cancel(path, input);
          if (key === "fetch")
            return () => {
              throw new Error("Shared export query cache must never be used");
            };
          if (key === "query" && path === "utils.client.managementHq.exportCsv")
            return (input: any) => mock.csv(input);
          if (key === "useQuery")
            return (input: any, options: any = {}) => {
              mock.hooks.push({ path, input, options });
              const [fresh, setFresh] = react.useState(false);
              react.useEffect(() => {
                if (options.enabled === false) return;
                let mounted = true;
                void Promise.resolve(mock.queryWait[path]).then(() => {
                  if (mounted) setFresh(true);
                });
                return () => {
                  mounted = false;
                };
              }, [options.enabled]);
              return {
                data: read(path, input),
                error: mock.errors[path] ?? null,
                isLoading: false,
                isFetching: !!mock.fetching[path],
                isFetchedAfterMount: fresh,
                refetch: async (options: any) => {
                  const override = await mock.refetch(path, options);
                  return (
                    override ?? {
                      data: read(path, input),
                      error: mock.errors[path] ?? null,
                    }
                  );
                },
              };
            };
          if (key === "useMutation")
            return () => {
              const [isPending, setPending] = react.useState(false);
              return {
                isPending,
                mutateAsync: async (input: any) => {
                  mock.mutations.push(structuredClone(input));
                  setPending(true);
                  try {
                    await mock.mutationWait;
                    if (mock.mutationError) throw mock.mutationError;
                    mock.data["managementHq.status"] = {
                      ...mock.data["managementHq.status"],
                      hasSample: true,
                      stateVersion: (input.expectedVersion ?? 0) + 1,
                    };
                    return { stateVersion: (input.expectedVersion ?? 0) + 1 };
                  } finally {
                    setPending(false);
                  }
                },
              };
            };
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
    nodes.set(path, proxy);
    return proxy;
  };
  return { trpc: node() };
});
import ManagementHq, { formatHqMoney } from "./ManagementHq";

function coverage(
  sum: string | null,
  overrides: Partial<HqMoneyCoverage> = {}
): HqMoneyCoverage {
  return {
    knownSum: sum,
    coveredCount: sum === null ? 0 : 1,
    eligibleCount: 2,
    missingCount: sum === null ? 2 : 1,
    actualRecordedCount: 0,
    estimatedCount: 0,
    ...overrides,
  };
}
function totals(): HqReportTotals {
  return {
    bookingCount: 2,
    passengerCount: 4,
    unknownPassengerCount: 1,
    grossSales: coverage("6000.00"),
    supplierNetCost: coverage(null),
    knownSupplierNetSubtotal: coverage("3000.00"),
    grossProfit: coverage("2000.00"),
    weightedMargin: {
      fraction: "0.333333",
      coveredCount: 1,
      coveredGross: "6000.00",
      coveredProfit: "2000.00",
    },
    applicableVat: coverage(null),
    ptsFees: coverage("12.50", { estimatedCount: 1 }),
    actualCardFees: coverage(null),
    estimatedCardFees: coverage("18.00", { estimatedCount: 1 }),
    baselineAgentCommission: coverage("1600.00"),
    baselineJltRetainedCommission: coverage("400.00"),
    completeAgentCommission: coverage(null),
    completeJltRetainedCommission: coverage(null),
    settledJltIncome: coverage(null),
  };
}
const seller = {
  userId: 101,
  uniqueAgentId: "JLT101",
  name: "Synthetic Seller One",
  role: "agent",
};
const processor = {
  userId: 47,
  uniqueAgentId: null,
  name: "Synthetic Admin Processor",
  role: "super_admin",
};
function booking(
  index = 1,
  status: HqBookingDrilldown["status"] = "confirmed"
): HqBookingDrilldown {
  return {
    id: `sample-file-${index}`,
    bookingRef: `SAMPLE-${index}`,
    revision: "r2",
    status,
    reportingDate: "2026-01-15",
    dateSource: "portal_registered_at",
    cohort: status === "cancelled" ? "cancelled" : "headline",
    business: {
      name: "Synthetic business",
      orbitTenantId: "NEVER-RENDER-BUSINESS-TENANT",
      portalBusinessId: "NEVER-RENDER-BUSINESS-ID",
      mappingStatus: "verified",
    },
    seller: index === 2 ? null : seller,
    sellerReason: index === 2 ? "Selling identity unmatched" : null,
    processor,
    passengerCount: 2,
    currency: "GBP",
    currencyBasis: "validated_GBP",
    financials: {
      gross: "6000.00",
      supplierNet: null,
      knownSupplierNetSubtotal: "3000.00",
      grossProfit: "2000.00",
      applicableVat: null,
      ptsFees: "12.50",
      actualCardFees: null,
      estimatedCardFees: "18.00",
      baselineAgentCommission: "1600.00",
      baselineJltRetainedCommission: "400.00",
      completeAgentCommission: null,
      completeJltRetainedCommission: null,
      settledJltIncome: null,
      cancellationCharges: status === "cancelled" ? "25.00" : null,
      cancellationRetainedCommission: null,
      baselineComplete: true,
      policyComplete: false,
      grossMargin: {
        fraction: "0.333333",
        state: "calculated",
        denominator: "gross_booking_value",
      },
      baseline: {
        basis: "orbit_baseline",
        complete: true,
        netDistributableCommission: "2000.00",
        agentCommission: "1600.00",
        jltRetainedCommission: "400.00",
        cardProcessingFeesIncluded: false,
        vatIncluded: false,
        ptsIncluded: false,
        terms: { agentFraction: "0.8", jltFraction: "0.2", state: "verified" },
        roundingBasis: "source",
        roundingResidual: "0.00",
        limitations: ["Baseline excludes deductions"],
      },
      policy: {
        basis: "policy_complete",
        complete: false,
        netDistributableCommission: null,
        agentCommission: null,
        jltRetainedCommission: null,
        cardProcessingFeesIncluded: false,
        vatIncluded: false,
        ptsIncluded: false,
        terms: { agentFraction: "0.8", jltFraction: "0.2", state: "verified" },
        roundingBasis: "source",
        roundingResidual: null,
        limitations: ["Missing approved deductions"],
      },
      otherDeductions: null,
      policyVersion: "synthetic-policy",
      ptsFeeBasis: "source estimate",
      ptsAssumptions: ["Synthetic PTS estimate"],
      completeGrossAndCost: false,
      completeApprovedDeductions: false,
      warnings: [],
      amountStates: {
        gross: { state: "source_recorded", currency: "GBP", reason: null },
      },
    },
    qualityIssues: ["No recorded settlement evidence"],
  };
}
function report(): HqReport {
  return {
    status: "available",
    unavailableReason: null,
    liveReady: false,
    scopeId: "sample-only",
    watermark: "sample-watermark",
    snapshotId: "sample-r2",
    filters: { year: 2026, month: null },
    currency: "GBP",
    totals: totals(),
    cohorts: {
      pendingCount: 1,
      cancelledCount: 1,
      exceptionCount: 1,
      undatedCount: 1,
      unmatchedBusinessCount: 1,
      unattributedCount: 1,
      excludedDemoCount: 1,
      tombstoneCount: 0,
      unsupportedCurrencyCount: 1,
    },
    monthly: [
      {
        month: 1,
        totals: totals(),
        pendingCount: 1,
        cancelledCount: 1,
        exceptionCount: 0,
      },
      {
        month: 4,
        totals: {
          ...totals(),
          bookingCount: 0,
          grossSales: coverage(null, { eligibleCount: 0, missingCount: 0 }),
        },
        pendingCount: 0,
        cancelledCount: 0,
        exceptionCount: 0,
      },
    ],
    agents: [
      { agent: seller, totals: totals(), pendingCount: 0, cancelledCount: 1 },
    ],
    bookings: [booking(), booking(2, "cancelled")],
    undatedExceptions: [
      {
        ...booking(3),
        reportingDate: null,
        dateSource: "none",
        cohort: "exception",
      },
    ],
    exportComplete: true,
    limitations: ["Synthetic sample only; settlement evidence incomplete"],
  };
}
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let container: HTMLDivElement;
let root: Root;
let downloads: { filename: string; href: string }[];
let createUrl: ReturnType<typeof vi.spyOn>;
let revokeUrl: ReturnType<typeof vi.spyOn>;
async function render() {
  await act(async () => {
    root.render(React.createElement(ManagementHq));
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
function button(text: string) {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].filter(item => item.textContent?.trim() === text);
  expect(found, text).toHaveLength(1);
  return found[0]!;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
}
async function change(label: string, value: string) {
  const control = container.querySelector<HTMLSelectElement>(
    `select[aria-label="${label}"]`
  )!;
  expect(control).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )!.set!.call(control, value);
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function currentReport() {
  return container.querySelector('[aria-label="Current Management HQ report"]');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mock.network);
  mock.network.mockImplementation(() => {
    throw new Error("Real network prohibited in offline HQ tests");
  });
  mock.user = {
    id: 47,
    role: "super_admin",
    isActive: true,
    portalStatus: "active",
  };
  mock.loading = false;
  mock.authError = null;
  mock.errors = {};
  mock.fetching = {};
  mock.queryWait = {};
  mock.hooks = [];
  mock.mutations = [];
  mock.mutationWait = undefined;
  mock.mutationError = null;
  mock.autoFilters = true;
  mock.data = {
    "managementHq.status": {
      sampleEnabled: true,
      liveConfigured: false,
      hasSample: true,
      stateVersion: 4,
      updatedAt: new Date("2026-04-01"),
    },
    "managementHq.report": report(),
  };
  mock.cancel.mockResolvedValue(undefined);
  mock.refetch.mockResolvedValue(undefined);
  mock.csv.mockResolvedValue({
    csv: "Booking,Status\nSAMPLE-1,confirmed\n",
    filename: "management-hq-SAMPLE-2026.csv",
  });
  downloads = [];
  createUrl = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:synthetic-hq");
  revokeUrl = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    downloads.push({ filename: this.download, href: this.href });
  });
  window.history.replaceState({}, "", "/admin/management-hq");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(mock.network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Management HQ on actual DOM", () => {
  it.each([
    { role: "admin" },
    { role: "agent" },
    { isActive: false },
    { portalStatus: "suspended" },
    { portalStatus: "pending" },
  ])("denies changed current authority %j before querying HQ", async patch => {
    Object.assign(mock.user, patch);
    await render();
    expect(container.textContent).toContain("Access denied");
    expect(currentReport()).toBeNull();
    expect(
      mock.hooks.filter(hook => hook.path.startsWith("managementHq."))
    ).toHaveLength(0);
  });
  it("withholds cached data until fresh auth finishes and rejects disagreement with useAuth", async () => {
    const pending = deferred();
    mock.queryWait["auth.me"] = pending.promise;
    await render();
    expect(currentReport()).toBeNull();
    expect(container.textContent).toContain("Checking current");
    mock.data["auth.me"] = { ...mock.user, id: 48 };
    await act(async () => pending.resolve());
    expect(currentReport()).toBeNull();
    expect(container.textContent).toContain("Access denied");
  });
  it("shows all three views, separate coverage and monthly restatement without private IDs", async () => {
    mock.data["managementHq.report"].totals.applicableVat = coverage(null, {
      eligibleCount: 0,
      missingCount: 0,
      notApplicableCount: 2,
    });
    await render();
    expect(container.querySelector("h1")?.textContent).toBe("Management HQ");
    expect(container.textContent).toContain("Sample data — not live Orbit");
    expect(
      container.querySelector('[aria-label="Executive KPIs"]')
    ).toBeTruthy();
    expect(container.textContent).toContain(
      "January booking changes from £5,000 to £6,000 in April"
    );
    expect(container.textContent).toContain("January 2026");
    expect(container.textContent).toContain("April 2026");
    await click("Financial Performance");
    expect(
      container.querySelector('[aria-label="Financial performance"]')
    ).toBeTruthy();
    expect(container.querySelector('[aria-label="Executive KPIs"]')).toBeNull();
    expect(container.textContent).toContain("2 not applicable");
    for (const text of [
      "Actual card fees",
      "Estimated card fees",
      "PTS fees",
      "Baseline agent commission",
      "Policy-complete agent commission",
      "Settled JLT income",
      "Incomplete · 2 missing",
      "0/2 covered",
    ])
      expect(container.textContent).toContain(text);
    const financialRows = [
      ...container.querySelectorAll(
        '[aria-label="Financial performance"] tbody tr'
      ),
    ];
    expect(
      financialRows.find(row => row.textContent?.includes("Settled JLT income"))
        ?.textContent
    ).toContain("Missing");
    expect(
      financialRows
        .find(row => row.textContent?.includes("Settled JLT income"))
        ?.querySelector("strong")?.textContent
    ).toBe("Missing");
    await click("Agent Activity");
    const agents = container.querySelector('[aria-label="Agent activity"]')!;
    expect(agents.textContent).toContain("Synthetic Seller One");
    expect(agents.textContent).toContain("#101 · JLT101");
    expect(agents.textContent).toContain(
      "Unattributed sellers: 1 · unmatched businesses: 1"
    );
    expect(agents.textContent).not.toContain("Synthetic Admin Processor");
    expect(container.textContent).not.toContain("NEVER-RENDER");
    expect(container.querySelector('a[href="/super-admin"]')).toBeTruthy();
    expect(
      container.querySelector("input[type=file], textarea, form")
    ).toBeNull();
  });
  it("preserves cancelled records, reporting dates, processing-only attribution and sourced drilldown", async () => {
    await render();
    const table = container.querySelector('[aria-label="Booking drilldown"]')!;
    expect(table.textContent).toContain("cancelled");
    expect(table.textContent).toContain("2026-01-15");
    expect(table.textContent).toContain("Admin processor");
    expect(table.textContent).toContain("Processing only");
    await click("Source values for SAMPLE-2");
    const detail = container.querySelector("#hq-source-detail")!;
    expect(detail.textContent).toContain(
      "cancelled · reporting date 2026-01-15"
    );
    expect(detail.textContent).toContain("Source cancellation charges£25.00");
    expect(detail.textContent).toContain("policy complete: no");
    expect(detail.textContent).toContain("Actual card feesMissing");
    expect(detail.textContent).toContain("No recorded settlement evidence");
    await click("Close source detail");
    expect(container.querySelector("#hq-source-detail")).toBeNull();
  });
  it.each(["managementHq.status", "managementHq.report", "auth.me"])(
    "withholds last successful data after %s fails",
    async path => {
      await render();
      expect(currentReport()).toBeTruthy();
      mock.errors[path] = {
        data: { code: "FORBIDDEN" },
        message: "Synthetic authority changed",
      };
      await render();
      expect(currentReport()).toBeNull();
      expect(container.textContent).not.toContain("Synthetic Seller One");
      expect(container.textContent).not.toContain("SAMPLE-1");
      expect(mock.csv).not.toHaveBeenCalled();
    }
  );
  it("withholds cached report during pending refresh and always refetches on focus", async () => {
    await render();
    for (const path of [
      "auth.me",
      "managementHq.status",
      "managementHq.report",
    ]) {
      const hook = mock.hooks.filter(item => item.path === path).at(-1)!;
      expect(hook.options).toMatchObject({
        refetchOnWindowFocus: "always",
        refetchOnMount: "always",
        staleTime: 0,
        gcTime: 0,
      });
      expect(hook.options).not.toHaveProperty("placeholderData");
    }
    mock.fetching["managementHq.report"] = true;
    await render();
    expect(currentReport()).toBeNull();
    expect(button("Refresh").disabled).toBe(true);
    mock.fetching["managementHq.report"] = false;
    await render();
    const pending = deferred<any>();
    mock.refetch.mockImplementation(() => pending.promise);
    await click("Refresh");
    expect(currentReport()).toBeNull();
    expect(button("Refresh").disabled).toBe(true);
    expect(button("Replay April value change").disabled).toBe(true);
    await act(async () =>
      pending.resolve({ data: mock.data["managementHq.status"], error: null })
    );
    expect(currentReport()).toBeTruthy();
    expect(mock.refetch).toHaveBeenCalledWith("managementHq.status", {
      cancelRefetch: true,
    });
    expect(mock.cancel).toHaveBeenCalledWith(
      "utils.managementHq.report",
      undefined
    );
    expect(mock.mutations).toHaveLength(0);
  });
  it("does not show a previous identity's cached report until its own fresh observer succeeds", async () => {
    await render();
    const pending = deferred();
    mock.queryWait["managementHq.report"] = pending.promise;
    mock.user = { ...mock.user, id: 48 };
    await render();
    expect(currentReport()).toBeNull();
    expect(container.textContent).not.toContain("Synthetic Seller One");
    await act(async () => pending.resolve());
    expect(currentReport()?.getAttribute("data-actor")).toBe("48");
  });
  it("shows disabled and absent samples as unavailable, never fake zero/live data", async () => {
    mock.data["managementHq.status"].sampleEnabled = false;
    await render();
    expect(currentReport()).toBeNull();
    expect(container.textContent).toContain("Sample reporting is disabled");
    expect(button("Load initial sample").disabled).toBe(true);
    mock.data["managementHq.status"].sampleEnabled = true;
    mock.data["managementHq.status"].hasSample = false;
    mock.data["managementHq.status"].stateVersion = null;
    await render();
    expect(container.textContent).toContain("No sample loaded");
    expect(button("Load initial sample").disabled).toBe(false);
    expect(button("Replay April value change").disabled).toBe(true);
    await click("Load initial sample");
    expect(mock.mutations).toEqual([
      { scenario: "initial", expectedVersion: null },
    ]);
    expect(currentReport()).toBeTruthy();
  });
  it("sends only scenario/CAS payloads and prevents repeated actions while pending", async () => {
    await render();
    const pending = deferred();
    mock.mutationWait = pending.promise;
    await click("Replay April value change");
    expect(mock.mutations).toEqual([
      { scenario: "amended", expectedVersion: 4 },
    ]);
    expect(currentReport()).toBeNull();
    for (const text of [
      "Load initial sample",
      "Replay April value change",
      "Replay sample cancellation",
      "Refresh",
    ])
      expect(button(text).disabled).toBe(true);
    await click("Replay sample cancellation");
    expect(mock.mutations).toHaveLength(1);
    await act(async () => pending.resolve());
    await click("Replay sample cancellation");
    expect(mock.mutations[1]).toEqual({
      scenario: "cancelled",
      expectedVersion: 5,
    });
    expect(container.textContent).toContain("State version: 6");
  });
  it("withholds values on CAS conflict and requires refresh before another replay", async () => {
    await render();
    mock.mutationError = { data: { code: "CONFLICT" } };
    await click("Replay April value change");
    expect(currentReport()).toBeNull();
    expect(container.textContent).toContain("Refresh before replaying");
    expect(button("Replay April value change").disabled).toBe(true);
    mock.mutationError = null;
    await click("Refresh");
    expect(currentReport()).toBeTruthy();
    await click("Replay April value change");
    expect(mock.mutations.at(-1)).toEqual({
      scenario: "amended",
      expectedVersion: 4,
    });
  });
  it("uses exact annual/monthly filters, withholds mismatched data and exports only on click", async () => {
    await render();
    expect(
      mock.hooks.filter(hook => hook.path === "managementHq.report").at(-1)
        ?.input
    ).toEqual({ year: 2026 });
    expect(mock.csv).not.toHaveBeenCalled();
    await change("Reporting month", "4");
    await change("Reporting year", "2027");
    expect(
      mock.hooks.filter(hook => hook.path === "managementHq.report").at(-1)
        ?.input
    ).toEqual({ year: 2027, month: 4 });
    await click("Export all filtered records");
    expect(mock.csv).toHaveBeenCalledWith({ year: 2027, month: 4 });
    mock.autoFilters = false;
    await render();
    expect(currentReport()).toBeNull();
  });
  it("paginates retained records at 25 and exports all filtered records with URL/anchor cleanup", async () => {
    mock.data["managementHq.report"].bookings = Array.from(
      { length: 28 },
      (_, index) => booking(index + 1)
    );
    mock.data["managementHq.report"].undatedExceptions = [];
    await render();
    const table = container.querySelector(
      '[aria-label="Booking drilldown"] table'
    )!;
    expect(table.querySelectorAll("tbody tr")).toHaveLength(25);
    expect(button("Source values for SAMPLE-25")).toBeTruthy();
    await click("Next bookings");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(3);
    await click("Export all filtered records");
    expect(mock.csv.mock.calls[0][0]).toEqual({ year: 2026 });
    expect(downloads).toEqual([
      { filename: "management-hq-SAMPLE-2026.csv", href: "blob:synthetic-hq" },
    ]);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith("blob:synthetic-hq");
    expect(document.querySelector("a[download]")).toBeNull();
  });
  it("prevents exporting a server-incomplete report", async () => {
    mock.data["managementHq.report"].exportComplete = false;
    await render();
    expect(button("Export all filtered records").disabled).toBe(true);
    expect(container.textContent).toContain("not a complete file");
    await click("Export all filtered records");
    expect(mock.csv).not.toHaveBeenCalled();
  });
  it.each([
    "actor",
    "revoked",
    "filter",
    "route",
    "cancel",
    "refresh",
    "query-error",
    "unmount",
  ])("discards a late export after %s changes", async changeType => {
    await render();
    const pending = deferred<any>();
    mock.csv.mockReturnValue(pending.promise);
    await click("Export all filtered records");
    expect(button("Preparing CSV…").disabled).toBe(true);
    if (changeType === "actor") {
      mock.user = { ...mock.user, id: 48 };
      await render();
    }
    if (changeType === "revoked") {
      mock.user = { ...mock.user, isActive: false };
      await render();
    }
    if (changeType === "filter") await change("Reporting month", "4");
    if (changeType === "route")
      await act(async () =>
        window.history.replaceState({}, "", "/super-admin")
      );
    if (changeType === "cancel") await click("Replay sample cancellation");
    if (changeType === "refresh") await click("Refresh");
    if (changeType === "query-error") {
      mock.errors["managementHq.report"] = { data: { code: "FORBIDDEN" } };
      await render();
    }
    if (changeType === "unmount") await act(async () => root.render(null));
    await act(async () =>
      pending.resolve({ csv: "Must never download", filename: "stale.csv" })
    );
    expect(downloads).toHaveLength(0);
    expect(createUrl).not.toHaveBeenCalled();
  });
  it("makes two separate uncached requests when actor B exports actor A's pending period", async () => {
    const actorA = deferred<any>();
    const actorB = deferred<any>();
    mock.csv
      .mockImplementationOnce(() => actorA.promise)
      .mockImplementationOnce(() => actorB.promise);
    await render();
    await click("Export all filtered records");
    mock.user = { ...mock.user, id: 48 };
    await render();
    await click("Export all filtered records");
    expect(mock.csv).toHaveBeenCalledTimes(2);
    expect(mock.csv.mock.calls).toEqual([[{ year: 2026 }], [{ year: 2026 }]]);
    await act(async () =>
      actorA.resolve({ csv: "ACTOR-A", filename: "actor-A.csv" })
    );
    expect(downloads).toHaveLength(0);
    await act(async () =>
      actorB.resolve({ csv: "ACTOR-B", filename: "actor-B.csv" })
    );
    expect(downloads.map(download => download.filename)).toEqual([
      "actor-B.csv",
    ]);
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe("ACTOR-B");
  });
  it("withholds the report after a current export access error rather than preserving stale totals", async () => {
    await render();
    mock.csv.mockRejectedValue({ data: { code: "FORBIDDEN" } });
    await click("Export all filtered records");
    expect(currentReport()).toBeNull();
    expect(container.textContent).toContain("Report or export access failed");
    expect(downloads).toHaveLength(0);
  });
  it("renders huge and precise source money strings without Number coercion", () => {
    expect(formatHqMoney("900719925474099312345678.12")).toBe(
      "£900,719,925,474,099,312,345,678.12"
    );
    expect(formatHqMoney("1234.5678")).toBe("£1,234.5678");
    expect(formatHqMoney("-12.5")).toBe("-£12.50");
    expect(formatHqMoney("0")).toBe("£0.00");
    expect(formatHqMoney(null)).toBe("Missing");
    expect(formatHqMoney("Infinity")).toBe("Unavailable");
  });
});
