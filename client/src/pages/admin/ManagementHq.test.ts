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
  connectionResult: undefined as any,
  autoFilters: true,
  hooks: [] as { path: string; input: any; options: any }[],
  mutations: [] as any[],
  mutationCalls: [] as { path: string; actorId: number; input: any }[],
  mutationResets: [] as { path: string; actorId: number }[],
  connectionMutateAsync: vi.fn(),
  importMutateAsync: vi.fn(),
  validationMutateAsync: vi.fn(),
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
              const actorId = react.useRef(mock.user.id).current;
              const reset = react.useRef(() => {
                mock.mutationResets.push({ path, actorId });
                setPending(false);
              }).current;
              return {
                isPending,
                mutateAsync: async (input?: any) => {
                  mock.mutationCalls.push({ path, actorId, input });
                  mock.mutations.push(
                    input === undefined ? undefined : structuredClone(input)
                  );
                  setPending(true);
                  try {
                    if (path === "managementHq.checkConnection")
                      return await mock.connectionMutateAsync(input);
                    if (path === "managementHq.importInitialBatch")
                      return await mock.importMutateAsync(input);
                    if (path === "managementHq.validateInitialImport")
                      return await mock.validationMutateAsync(input);
                    await mock.mutationWait;
                    if (mock.mutationError) throw mock.mutationError;
                    if (input === undefined) return mock.connectionResult;
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
                reset,
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
    sourceMode: "sample",
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
  mock.mutationCalls = [];
  mock.mutationResets = [];
  mock.mutationWait = undefined;
  mock.mutationError = null;
  mock.connectionMutateAsync.mockReset();
  mock.importMutateAsync.mockReset();
  mock.validationMutateAsync.mockReset();
  mock.connectionMutateAsync.mockImplementation(async () => {
    await mock.mutationWait;
    if (mock.mutationError) throw mock.mutationError;
    return mock.connectionResult;
  });
  mock.connectionResult = {
    outcome: "ready",
    message:
      "Portal can connect to Orbit. No bookings have been imported or HQ switched on.",
    checkedAt: "2026-11-24T12:00:00.000Z",
    generationId: 12,
    sourcePublishedAt: null,
    sourceObservationAt: null,
  };
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
      "January booking changes from £10,000 to £11,000"
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
  it("keeps provisional current owner and assigned staff separate from null seller and admin processor", async () => {
    const owner = { ...seller, name: "Synthetic Current Owner" };
    const staff = {
      userId: 102,
      uniqueAgentId: "JLT102",
      name: "Synthetic Assigned Staff",
      role: "staff",
    };
    const file = {
      ...booking(),
      seller: null,
      sellerReason: "Current ownership does not establish original seller",
      currentOwner: owner,
      assignedStaff: staff,
      attributionState: "provisional_current_owner",
    };
    mock.data["managementHq.report"].bookings = [file];
    mock.data["managementHq.report"].undatedExceptions = [];
    mock.data["managementHq.report"].agents = [
      {
        agent: owner,
        attributionState: "provisional_current_owner",
        totals: totals(),
        pendingCount: 0,
        cancelledCount: 0,
      },
    ];
    mock.data["managementHq.report"].watermark = "NEVER-RENDER-OPAQUE-CURSOR";
    mock.data["managementHq.report"].snapshotId = "NEVER-RENDER-GENERATION-KEY";
    await render();
    const table = container.querySelector(
      '[aria-label="Booking drilldown"] table'
    )!;
    const headers = [...table.querySelectorAll("thead th")].map(
      item => item.textContent
    );
    const cells = [...table.querySelectorAll("tbody tr:first-child > *")];
    expect(cells[headers.indexOf("Seller")]?.textContent).toContain(
      "Unattributed"
    );
    expect(cells[headers.indexOf("Seller")]?.textContent).not.toContain(
      owner.name
    );
    expect(cells[headers.indexOf("Current owner")]?.textContent).toContain(
      owner.name
    );
    expect(cells[headers.indexOf("Current owner")]?.textContent).toContain(
      "Provisional current owner · not original seller"
    );
    expect(cells[headers.indexOf("Assigned staff")]?.textContent).toContain(
      staff.name
    );
    expect(cells[headers.indexOf("Admin processor")]?.textContent).toContain(
      processor.name
    );
    expect(
      cells[headers.indexOf("Admin processor")]?.textContent
    ).not.toContain(staff.name);
    await click("Agent Activity");
    const activity = container.querySelector('[aria-label="Agent activity"]')!;
    expect(activity.textContent).toContain(
      "Provisional current owner · not original seller"
    );
    expect(activity.textContent).not.toContain(staff.name);
    expect(activity.textContent).not.toContain(processor.name);
    await click("Source values for SAMPLE-1");
    const attribution = container.querySelector(
      '[aria-label="Booking attribution"]'
    )!;
    expect(attribution.textContent).toContain("Current owner");
    expect(attribution.textContent).toContain("Assigned staff");
    expect(attribution.textContent).toContain("SellerUnattributed");
    expect(container.textContent).not.toContain("NEVER-RENDER");
  });
  it.each(["initial", "amended", "cancelled", "registered"] as const)(
    "renders the actual implemented %s scenario without inventing a verified seller",
    async scenario => {
      const {
        runHqImplementedSampleScenario,
        createHqImplementedSampleDirectory,
      } = await import("../../../../server/management-hq-implemented-fixtures");
      const { getHqReport } = await import(
        "../../../../server/management-hq-engine"
      );
      const state = await runHqImplementedSampleScenario(scenario);
      mock.data["managementHq.report"] = await getHqReport(
        state,
        createHqImplementedSampleDirectory(),
        { year: 2026 }
      );
      mock.data["managementHq.report"].sourceMode = "sample";
      await render();
      const table = container.querySelector(
        '[aria-label="Booking drilldown"]'
      )!;
      expect(table.textContent).toContain("SYN-HQ-1");
      expect(table.textContent).toContain(
        scenario === "initial" ? "£10,000.00" : "£11,000.00"
      );
      expect(table.textContent).toContain(
        scenario === "registered" ? "2026-02-03" : "2026-01-10"
      );
      expect(table.textContent).toContain(
        "Original seller unavailable; current owner provisional"
      );
      expect(table.textContent).toContain("Synthetic Assigned Staff");
      expect(table.textContent).not.toContain("Synthetic Admin Processor");
      const cancelled = scenario === "cancelled" || scenario === "registered";
      const kpis = container.querySelector('[aria-label="Executive KPIs"]')!;
      const bookings = [...kpis.querySelectorAll("div")].find(
        item => item.querySelector("h2")?.textContent === "Active bookings"
      );
      expect(bookings?.querySelector("strong")?.textContent).toBe(
        cancelled ? "0" : "1"
      );
      if (!cancelled)
        expect(kpis.textContent).toContain(
          scenario === "initial" ? "£1,500.00" : "£2,500.00"
        );
      await click("Agent Activity");
      expect(
        container.querySelector('[aria-label="Agent activity"]')?.textContent
      ).toContain("Provisional current owner · not original seller");
      expect(container.textContent).not.toContain(state.resumeCursor);
    }
  );
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
    expect(button("Replay value amendment").disabled).toBe(true);
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
    expect(button("Replay value amendment").disabled).toBe(true);
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
    await click("Replay value amendment");
    expect(mock.mutations).toEqual([
      { scenario: "amended", expectedVersion: 4 },
    ]);
    expect(currentReport()).toBeNull();
    for (const text of [
      "Load initial sample",
      "Replay value amendment",
      "Replay sample cancellation",
      "Replay later registration",
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
    await click("Replay value amendment");
    expect(currentReport()).toBeNull();
    expect(container.textContent).toContain("Refresh before replaying");
    expect(button("Replay value amendment").disabled).toBe(true);
    mock.mutationError = null;
    await click("Refresh");
    expect(currentReport()).toBeTruthy();
    await click("Replay value amendment");
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
    "register",
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
    if (changeType === "register") await click("Replay later registration");
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
  it("checks Orbit only after a click, sends no input, and renders a safe ready result", async () => {
    await render();
    expect(mock.mutations).toHaveLength(0);
    expect(button("Check Orbit connection").disabled).toBe(false);
    await click("Check Orbit connection");
    expect(mock.mutations).toEqual([undefined]);
    expect(container.textContent).toContain("Portal can connect to Orbit.");
    expect(container.textContent).not.toContain("source health only");
    expect(container.textContent).not.toContain("HQ_ORBIT");
    expect(container.textContent).not.toContain("https://");
    expect(currentReport()).toBeTruthy();
  });
  it("locks duplicate connection clicks and shows plain missing-key failure", async () => {
    const pending = deferred<any>();
    mock.mutationWait = pending.promise;
    await render();
    await click("Check Orbit connection");
    expect(mock.mutations).toEqual([undefined]);
    expect(button("Checking…").disabled).toBe(true);
    await click("Checking…");
    expect(mock.mutations).toHaveLength(1);
    mock.mutationWait = undefined;
    mock.connectionResult = {
      outcome: "missing_key",
      message: "Orbit connection is not configured on the server.",
      checkedAt: "2026-11-24T12:01:00.000Z",
      generationId: null,
      sourcePublishedAt: null,
      sourceObservationAt: null,
    };
    await act(async () => pending.resolve());
    expect(container.textContent).toContain(
      "Orbit connection is not configured"
    );
    expect(container.textContent).not.toContain("secret");
    expect(container.textContent).not.toContain("https://");
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

function liveFixture(patch: Record<string, any> = {}) {
  const live = {
    syncEnabled: true,
    readEnabled: true,
    configured: true,
    configurationCode: null,
    intervalSeconds: 300,
    freshnessSeconds: 900,
    freshnessTargetSeconds: 900,
    health: "ready",
    hasPublished: true,
    stateVersion: 8,
    generationId: 12,
    lastAttemptAt: "2026-11-24T12:01:00Z",
    lastSuccessfulCheckAt: "2026-11-24T12:00:00Z",
    lastPublishedAt: "2026-11-24T11:00:00Z",
    nextDueAt: "2026-11-24T12:05:00Z",
    lastErrorCode: null,
    recoveryGuidance: null,
    stageStatus: "applied",
    progress: null,
    sourceObservationAt: "2026-11-24T11:59:50Z",
    sourcePublishedAt: "2026-11-24T11:59:51Z",
    sourceAgeSeconds: 10,
    isStale: false,
    ...patch,
  };
  mock.data["managementHq.status"] = {
    sampleEnabled: false,
    liveConfigured: live.configured,
    hasSample: false,
    stateVersion: live.stateVersion,
    updatedAt: live.lastPublishedAt,
    reportMode: "live",
    live,
  };
  const data = report();
  data.sourceMode = "live";
  data.stateVersion = live.stateVersion;
  data.stale = live.isStale;
  data.sourceAgeSeconds = live.sourceAgeSeconds;
  data.limitations = [
    "Orbit reporting import; semantic acceptance not yet verified",
  ];
  data.bookings = [
    {
      ...booking(),
      bookingRef: "OFFLINE-LIVE-FIXTURE",
      seller: null,
      processor: null,
      attributionState: "provisional_current_owner",
    },
  ];
  data.undatedExceptions = [];
  data.agents = [];
  mock.data["managementHq.report"] = data;
  mock.csv.mockResolvedValue({
    csv: "Reference,Status\nOFFLINE-LIVE-FIXTURE,confirmed\n",
    filename: "management-hq-LIVE-2026.csv",
  });
  return live;
}
function assertNoSampleControls() {
  expect(
    container.querySelector('[aria-label="Sample data warning"]')
  ).toBeNull();
  expect(container.querySelector('[aria-label="Sample scenarios"]')).toBeNull();
  expect(container.textContent).not.toContain("Load initial sample");
  expect(container.textContent).not.toContain("Replay value amendment");
  expect(mock.mutations).toHaveLength(0);
}
describe("Management HQ production wiring on actual DOM", () => {
  it.each([
    {
      configured: false,
      health: "needs_attention",
      hasPublished: false,
      configurationCode: "CONFIG_INCOMPLETE",
    },
    {
      configured: false,
      health: "needs_attention",
      hasPublished: false,
      configurationCode: "CONFIG_INVALID",
    },
    {
      hasPublished: false,
      health: "no_data",
      generationId: null,
      stateVersion: null,
      sourceAgeSeconds: null,
    },
    { readEnabled: false, hasPublished: false, health: "progress" },
  ])(
    "awaiting connection/import/read approval is unavailable, never zero %j",
    async patch => {
      liveFixture(patch);
      await render();
      assertNoSampleControls();
      expect(currentReport()).toBeNull();
      expect(container.textContent).toContain("unavailable, not zero");
      expect(
        container.querySelector('[aria-label="Executive KPIs"]')
      ).toBeNull();
      expect(mock.csv).not.toHaveBeenCalled();
    }
  );
  it("disabled production hides sample controls and cached financial values", async () => {
    mock.data["managementHq.status"] = {
      reportMode: "disabled",
      sampleEnabled: false,
      hasSample: false,
      stateVersion: null,
      liveConfigured: false,
    };
    await render();
    assertNoSampleControls();
    expect(container.textContent).toContain(
      "disabled pending connection and acceptance"
    );
    expect(currentReport()).toBeNull();
  });
  it("partial import without publication shows progress, not a zero report", async () => {
    liveFixture({
      health: "progress",
      hasPublished: false,
      progress: {
        kind: "backfill",
        phase: "business",
        pages: 3,
        recordsRead: 210,
      },
    });
    await render();
    assertNoSampleControls();
    expect(container.textContent).toContain("3 pages · 210 records read");
    expect(container.textContent).toContain(
      "Partial records are not published"
    );
    expect(currentReport()).toBeNull();
  });
  it.each(["progress", "backoff", "stale", "needs_attention"])(
    "last-good %s remains clearly qualified and source errors use safe staff wording",
    async health => {
      liveFixture({
        health,
        isStale: true,
        sourceAgeSeconds: 1800,
        lastErrorCode:
          health === "needs_attention"
            ? "AUTH_DENIED"
            : health === "backoff"
              ? "TIMEOUT"
              : null,
        progress:
          health === "progress"
            ? { kind: "catchup", phase: "changes", pages: 2, recordsRead: 60 }
            : null,
      });
      await render();
      assertNoSampleControls();
      expect(currentReport()).toBeTruthy();
      expect(container.textContent).toContain("last-good complete publication");
      expect(container.textContent).toContain("Stale source warning");
      expect(container.textContent).not.toContain("AUTH_DENIED");
      expect(container.textContent).not.toContain("TIMEOUT");
      expect(container.textContent).toContain("Last successful check");
      expect(container.textContent).toContain("Portal report publication");
      expect(container.textContent).toContain("1800 seconds");
      expect(container.textContent).not.toContain("Latest restated sample");
      if (health === "backoff")
        expect(container.textContent).toContain("Bounded retry");
      if (health === "needs_attention")
        expect(container.textContent).toContain("protected investigation");
    }
  );
  it.each([
    "STORE_UNAVAILABLE",
    "INVALID_PERSISTED_STATE",
    "SOURCE_BINDING_CHANGED",
    "CONFIG_INVALID",
    "SOURCE_OR_STORE_UNAVAILABLE",
  ])("%s suppresses all cached report and exportability", async code => {
    liveFixture();
    await render();
    expect(currentReport()).toBeTruthy();
    mock.data["managementHq.status"].live.lastErrorCode = code;
    mock.data["managementHq.status"].live.health = "needs_attention";
    await render();
    assertNoSampleControls();
    expect(currentReport()).toBeNull();
    expect(container.textContent).not.toContain("OFFLINE-LIVE-FIXTURE");
    expect(container.textContent).not.toContain(code);
    expect(mock.csv).not.toHaveBeenCalled();
  });
  it("all three views remain available in live mode without source writes", async () => {
    liveFixture();
    await render();
    assertNoSampleControls();
    expect(
      container.querySelector('[aria-label="Executive KPIs"]')
    ).toBeTruthy();
    await click("Financial Performance");
    expect(
      container.querySelector('[aria-label="Financial performance"]')
    ).toBeTruthy();
    await click("Agent Activity");
    expect(
      container.querySelector('[aria-label="Agent activity"]')
    ).toBeTruthy();
    expect(container.textContent).toContain(
      "not evidence of the original seller"
    );
    await click("Refresh");
    expect(mock.refetch).toHaveBeenCalledWith("managementHq.status", {
      cancelRefetch: true,
    });
    expect(mock.mutations).toHaveLength(0);
    expect(mock.hooks.some(hook => hook.options?.refetchInterval)).toBe(false);
  });
  it("live UI refuses cached sample report and sample UI refuses cached live report", async () => {
    const sample = report();
    liveFixture();
    mock.data["managementHq.report"] = sample;
    await render();
    assertNoSampleControls();
    expect(currentReport()).toBeNull();
    const live = { ...report(), sourceMode: "live", stateVersion: 8 };
    mock.data["managementHq.status"] = {
      reportMode: "sample",
      sampleEnabled: true,
      hasSample: true,
      stateVersion: 8,
    };
    mock.data["managementHq.report"] = live;
    await render();
    expect(currentReport()).toBeNull();
    expect(container.textContent).not.toContain("£6,000.00");
  });
  it("mode/state-version remount blocks previous generation until matching fresh report", async () => {
    liveFixture();
    await render();
    expect(currentReport()).toBeTruthy();
    mock.data["managementHq.status"].stateVersion = 9;
    await render();
    expect(currentReport()).toBeNull();
    mock.data["managementHq.report"].stateVersion = 9;
    await render();
    expect(currentReport()).toBeTruthy();
  });
  it("LIVE CSV download is click-only and labelled LIVE", async () => {
    liveFixture();
    await render();
    expect(mock.csv).not.toHaveBeenCalled();
    await click("Export all filtered records");
    expect(downloads.map(download => download.filename)).toEqual([
      "management-hq-LIVE-2026.csv",
    ]);
    expect(mock.csv.mock.calls).toEqual([[{ year: 2026 }]]);
  });
  it("live CSV result with SAMPLE filename is rejected and clears report", async () => {
    liveFixture();
    mock.csv.mockResolvedValue({
      csv: "wrong mode",
      filename: "management-hq-SAMPLE-2026.csv",
    });
    await render();
    await click("Export all filtered records");
    expect(downloads).toHaveLength(0);
    expect(currentReport()).toBeNull();
  });
  it.each([
    "actor",
    "route",
    "filter",
    "mode",
    "status-error",
    "read-off",
    "generation",
  ])("late LIVE CSV cannot download after %s changes", async changeType => {
    liveFixture();
    await render();
    const pending = deferred<any>();
    mock.csv.mockReturnValue(pending.promise);
    await click("Export all filtered records");
    if (changeType === "actor") {
      mock.user = { ...mock.user, id: 48 };
      await render();
    }
    if (changeType === "route")
      await act(async () =>
        window.history.replaceState({}, "", "/super-admin")
      );
    if (changeType === "filter") await change("Reporting month", "2");
    if (changeType === "mode") {
      mock.data["managementHq.status"].reportMode = "sample";
      mock.data["managementHq.status"].sampleEnabled = true;
      mock.data["managementHq.status"].hasSample = true;
      await render();
    }
    if (changeType === "status-error") {
      mock.errors["managementHq.status"] = { message: "secret source error" };
      await render();
    }
    if (changeType === "read-off") {
      mock.data["managementHq.status"].live.readEnabled = false;
      await render();
    }
    if (changeType === "generation") {
      mock.data["managementHq.status"].stateVersion = 9;
      await render();
    }
    await act(async () =>
      pending.resolve({
        csv: "stale private result",
        filename: "management-hq-LIVE-2026.csv",
      })
    );
    expect(downloads).toHaveLength(0);
    expect(createUrl).not.toHaveBeenCalled();
  });
  it("current UTC year defaults dynamically with a broad history selector", async () => {
    liveFixture();
    await render();
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Reporting year"]'
    )!;
    expect(select.value).toBe(String(new Date().getUTCFullYear()));
    expect([...select.options].map(option => option.value)).toContain("2000");
    expect([...select.options].map(option => option.value)).toContain("2100");
  });
});

const READY_CONNECTION_TEXT =
  "Portal can connect to Orbit. No bookings have been imported or HQ switched on.";
function connectionPanel() {
  return container.querySelector('[aria-label="Orbit connection check"]')!;
}
function connectionChecks() {
  return mock.mutationCalls.filter(
    call => call.path === "managementHq.checkConnection"
  );
}
function sampleMutations() {
  return mock.mutationCalls.filter(call => call.path === "managementHq.sample");
}
function connectionPayload(patch: Record<string, unknown> = {}) {
  return {
    outcome: "ready",
    message: READY_CONNECTION_TEXT,
    checkedAt: "2026-11-24T12:01:00.000Z",
    generationId: 12,
    sourcePublishedAt: "2026-11-24T12:00:00.000Z",
    sourceObservationAt: "2026-11-24T11:59:00.000Z",
    ...patch,
  };
}
async function connectionBoundaryChange(changeType: string) {
  if (changeType === "actor") mock.user = { ...mock.user, id: 48 };
  if (changeType === "revoked") mock.user = { ...mock.user, isActive: false };
  if (changeType === "auth-pending") mock.fetching["auth.me"] = true;
  if (changeType === "mode")
    mock.data["managementHq.status"].reportMode = "disabled";
  if (changeType === "status-error")
    mock.errors["managementHq.status"] = {
      data: { code: "INTERNAL_SERVER_ERROR" },
      message: "NEVER-RENDER raw SQL bearer https://private.invalid",
    };
  if (changeType === "status-pending")
    mock.fetching["managementHq.status"] = true;
  if (changeType === "generation")
    mock.data["managementHq.status"].stateVersion++;
  if (changeType === "read-off")
    mock.data["managementHq.status"].live.readEnabled = false;
  if (changeType === "settings")
    mock.data["managementHq.status"].live.intervalSeconds = 600;
  if (changeType === "freshness-settings")
    mock.data["managementHq.status"].live.freshnessSeconds = 1800;
  if (changeType === "sync-settings")
    mock.data["managementHq.status"].live.syncEnabled = false;
  if (changeType === "configuration-error")
    mock.data["managementHq.status"].live.configurationCode = "CONFIG_INVALID";
  if (changeType === "live-configured")
    mock.data["managementHq.status"].liveConfigured = false;
  if (changeType === "unmount") {
    await act(async () => root.render(null));
    return;
  }
  if (changeType === "route") {
    await act(async () => window.history.replaceState({}, "", "/super-admin"));
    return;
  }
  // A queued change event can arrive after the controls have been disabled.
  // Dispatch the real DOM event to exercise request-period invalidation too.
  if (changeType === "month") {
    await change("Reporting month", "2");
    return;
  }
  if (changeType === "year") {
    await change("Reporting year", "2027");
    return;
  }
  await render();
}

describe("Orbit connection check dedicated lifecycle DOM regressions", () => {
  it("never checks on mount, rerender, focus, Refresh, period change, polling time or storage", async () => {
    const storageGet = vi.spyOn(Storage.prototype, "getItem");
    const storageSet = vi.spyOn(Storage.prototype, "setItem");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");
    await render();
    await render();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await click("Refresh");
    await change("Reporting month", "2");
    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600_000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(connectionChecks()).toHaveLength(0);
    expect(mock.connectionMutateAsync).not.toHaveBeenCalled();
    expect(
      mock.hooks.some(hook => hook.path === "managementHq.checkConnection")
    ).toBe(false);
    expect(mock.hooks.some(hook => hook.options?.refetchInterval)).toBe(false);
    expect(storageGet).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("is usable with HQ disabled, and a ready result enables neither report reads nor sample imports", async () => {
    mock.data["managementHq.status"] = {
      reportMode: "disabled",
      sampleEnabled: false,
      hasSample: false,
      stateVersion: null,
      liveConfigured: false,
    };
    await render();
    expect(button("Check Orbit connection").disabled).toBe(false);
    const before = structuredClone(mock.data["managementHq.status"]);
    await click("Check Orbit connection");
    expect(connectionChecks()).toEqual([
      { path: "managementHq.checkConnection", actorId: 47, input: undefined },
    ]);
    expect(mock.data["managementHq.status"]).toEqual(before);
    expect(connectionPanel().textContent).toContain(READY_CONNECTION_TEXT);
    expect(currentReport()).toBeNull();
    expect(
      container.querySelector('[aria-label="Sample scenarios"]')
    ).toBeNull();
    expect(mock.hooks.some(hook => hook.path === "managementHq.report")).toBe(
      false
    );
    expect(sampleMutations()).toHaveLength(0);
    expect(mock.refetch).not.toHaveBeenCalled();
    expect(mock.csv).not.toHaveBeenCalled();
  });

  it.each([
    { readEnabled: false },
    { hasPublished: false },
    { configured: false },
  ])(
    "a ready health result does not override live approval/publication/configuration %j",
    async patch => {
      liveFixture(patch);
      await render();
      await click("Check Orbit connection");
      expect(connectionPanel().textContent).toContain(READY_CONNECTION_TEXT);
      expect(currentReport()).toBeNull();
      expect(mock.hooks.some(hook => hook.path === "managementHq.report")).toBe(
        false
      );
      expect(sampleMutations()).toHaveLength(0);
      expect(mock.refetch).not.toHaveBeenCalled();
    }
  );

  it("locks same-tick duplicate clicks plus Refresh, every sample action and both period controls during its flight", async () => {
    const pending = deferred<any>();
    mock.connectionMutateAsync.mockReturnValue(pending.promise);
    await render();
    const check = button("Check Orbit connection");
    await act(async () => {
      check.click();
      check.click();
    });
    expect(connectionChecks()).toHaveLength(1);
    expect(mock.connectionMutateAsync.mock.calls).toEqual([[undefined]]);
    for (const label of [
      "Checking…",
      "Refresh",
      "Load initial sample",
      "Replay value amendment",
      "Replay sample cancellation",
      "Replay later registration",
    ]) {
      expect(button(label).disabled).toBe(true);
      await click(label);
    }
    for (const label of ["Reporting year", "Reporting month"])
      expect(
        container.querySelector<HTMLSelectElement>(
          `select[aria-label="${label}"]`
        )!.disabled
      ).toBe(true);
    expect(sampleMutations()).toHaveLength(0);
    expect(mock.refetch).not.toHaveBeenCalled();
    await act(async () => pending.resolve(connectionPayload()));
    expect(button("Check Orbit connection").disabled).toBe(false);
    expect(button("Refresh").disabled).toBe(false);
    expect(button("Replay value amendment").disabled).toBe(false);
    expect(
      container.querySelector<HTMLSelectElement>(
        'select[aria-label="Reporting month"]'
      )!.disabled
    ).toBe(false);
  });

  it("clears its prior result immediately on a new attempt and leaves existing sample authority unchanged", async () => {
    await render();
    await click("Check Orbit connection");
    expect(connectionPanel().textContent).toContain(READY_CONNECTION_TEXT);
    const before = structuredClone(mock.data["managementHq.status"]);
    const pending = deferred<any>();
    mock.connectionMutateAsync.mockReturnValue(pending.promise);
    await click("Check Orbit connection");
    expect(connectionPanel().textContent).not.toContain(READY_CONNECTION_TEXT);
    expect(connectionPanel().textContent).not.toContain("Checked ");
    expect(connectionPanel().textContent).toContain(
      "Checking the Orbit connection…"
    );
    await act(async () =>
      pending.resolve(connectionPayload({ outcome: "missing_key" }))
    );
    expect(connectionPanel().textContent).toContain(
      "Orbit connection is not configured on the server."
    );
    expect(connectionPanel().textContent).not.toContain(READY_CONNECTION_TEXT);
    expect(mock.data["managementHq.status"]).toEqual(before);
    expect(currentReport()).toBeTruthy();
    expect(sampleMutations()).toHaveLength(0);
    expect(mock.refetch).not.toHaveBeenCalled();
  });

  it.each([
    ["ready", READY_CONNECTION_TEXT],
    [
      "stale",
      "Orbit is connected, but its latest reporting data is out of date.",
    ],
    ["not_ready", "Orbit’s reporting data is not ready yet."],
    ["missing_key", "Orbit connection is not configured on the server."],
    ["invalid_settings", "Orbit connection settings are invalid."],
    ["key_rejected", "Orbit reporting key was rejected."],
    ["unavailable", "Portal could not complete the Orbit connection check."],
  ])(
    "renders only fixed staff wording for %s, never response messages or source payload",
    async (outcome, expected) => {
      mock.connectionMutateAsync.mockResolvedValue(
        connectionPayload({
          outcome,
          message:
            "NEVER-RENDER SQL secret Bearer https://private.invalid HQ_ORBIT_REPORTING_API_KEY",
          generationId: "NEVER-RENDER generation",
          sourcePublishedAt: "NEVER-RENDER timestamp",
          sourceObservationAt: "NEVER-RENDER observation",
          checkedAt: "NEVER-RENDER bad date",
          source: { customer: "NEVER-RENDER", apiKey: "NEVER-RENDER" },
        })
      );
      await render();
      await click("Check Orbit connection");
      expect(connectionPanel().textContent).toContain(expected);
      expect(
        connectionPanel().querySelector(
          outcome === "ready" ? '[role="status"]' : '[role="alert"]'
        )
      ).toBeTruthy();
      expect(connectionPanel().textContent).toContain("Checked ");
      expect(container.textContent).not.toContain("NEVER-RENDER");
      expect(container.textContent).not.toContain("Invalid Date");
      expect(container.textContent).not.toContain("HQ_ORBIT");
      expect(currentReport()).toBeTruthy();
      expect(sampleMutations()).toHaveLength(0);
    }
  );

  it.each([
    null,
    undefined,
    {},
    { outcome: "__proto__", message: "NEVER-RENDER" },
  ])(
    "handles a malformed result safely without invented readiness %j",
    async payload => {
      mock.connectionMutateAsync.mockResolvedValue(payload);
      await render();
      await click("Check Orbit connection");
      expect(connectionPanel().textContent).toContain(
        "Portal could not complete the Orbit connection check."
      );
      expect(connectionPanel().textContent).not.toContain(
        READY_CONNECTION_TEXT
      );
      expect(container.textContent).not.toContain("NEVER-RENDER");
      expect(button("Check Orbit connection").disabled).toBe(false);
    }
  );

  it.each([
    new Error("NEVER-RENDER SQL Bearer https://private.invalid"),
    {
      data: { code: "INTERNAL_SERVER_ERROR" },
      message: "NEVER-RENDER SQL credentials",
    },
    { code: "TIMEOUT", message: "NEVER-RENDER provider detail" },
  ])(
    "sanitizes ordinary rejected promises without changing existing mutation guards %j",
    async error => {
      mock.connectionMutateAsync.mockRejectedValue(error);
      await render();
      await click("Check Orbit connection");
      expect(connectionPanel().textContent).toContain(
        "Portal could not complete the Orbit connection check."
      );
      expect(container.textContent).not.toContain("NEVER-RENDER");
      expect(currentReport()).toBeTruthy();
      expect(button("Replay value amendment").disabled).toBe(false);
      expect(sampleMutations()).toHaveLength(0);
      expect(button("Check Orbit connection").disabled).toBe(false);
    }
  );

  it.each([
    "actor",
    "revoked",
    "auth-pending",
    "unmount",
    "route",
    "month",
    "year",
    "mode",
    "status-error",
    "status-pending",
    "generation",
    "read-off",
    "settings",
  ])(
    "withholds a late ready result after %s, and settles its own flight despite display invalidation",
    async changeType => {
      liveFixture();
      const pending = deferred<any>();
      mock.connectionMutateAsync.mockReturnValue(pending.promise);
      await render();
      await click("Check Orbit connection");
      await connectionBoundaryChange(changeType);
      await act(async () => pending.resolve(connectionPayload()));
      expect(container.textContent).not.toContain(READY_CONNECTION_TEXT);
      expect(container.textContent).not.toContain("NEVER-RENDER");
      expect(container.textContent).not.toContain(
        "Checking the Orbit connection…"
      );
      expect(
        container.querySelector(
          '[aria-label="Orbit connection check"] [role="alert"]'
        )
      ).toBeNull();
      if (changeType === "status-pending") {
        expect(button("Refresh").disabled).toBe(true);
        mock.fetching["managementHq.status"] = false;
        await render();
      }
      if (!["revoked", "auth-pending", "unmount"].includes(changeType)) {
        expect(button("Refresh").disabled).toBe(false);
        expect(button("Check Orbit connection").disabled).toBe(false);
        mock.connectionMutateAsync.mockResolvedValue(connectionPayload());
        await click("Check Orbit connection");
        expect(connectionChecks()).toHaveLength(2);
        expect(connectionPanel().textContent).toContain(READY_CONNECTION_TEXT);
      }
    }
  );

  it.each(["route", "mode", "status-error", "month"])(
    "withholds even a late authorization rejection after %s instead of revoking a different boundary",
    async changeType => {
      const pending = deferred<any>();
      mock.connectionMutateAsync.mockReturnValue(pending.promise);
      await render();
      await click("Check Orbit connection");
      await connectionBoundaryChange(changeType);
      await act(async () =>
        pending.reject({
          data: { code: "FORBIDDEN" },
          message: "NEVER-RENDER stale actor",
        })
      );
      expect(container.textContent).not.toContain(
        "Management HQ access could not be verified."
      );
      expect(container.textContent).not.toContain("NEVER-RENDER");
      expect(button("Refresh").disabled).toBe(false);
    }
  );

  it.each([
    "actor",
    "revoked",
    "auth-pending",
    "mode",
    "status-error",
    "status-pending",
    "generation",
    "read-off",
    "settings",
    "freshness-settings",
    "sync-settings",
    "configuration-error",
    "live-configured",
    "month",
    "year",
  ])(
    "clears a stored result when the %s authority/mode/settings/status/period boundary changes",
    async changeType => {
      liveFixture();
      await render();
      await click("Check Orbit connection");
      expect(connectionPanel().textContent).toContain(READY_CONNECTION_TEXT);
      await connectionBoundaryChange(changeType);
      expect(container.textContent).not.toContain(READY_CONNECTION_TEXT);
      expect(container.textContent).not.toContain("NEVER-RENDER");
    }
  );

  it("clears stored health evidence on Refresh and on a sample state mutation", async () => {
    await render();
    await click("Check Orbit connection");
    await click("Refresh");
    expect(connectionPanel().textContent).not.toContain(READY_CONNECTION_TEXT);
    await click("Check Orbit connection");
    await click("Replay value amendment");
    expect(connectionPanel().textContent).not.toContain(READY_CONNECTION_TEXT);
    expect(sampleMutations()).toHaveLength(1);
  });

  it.each([
    { data: { code: "FORBIDDEN" }, message: "NEVER-RENDER revoked actor" },
    { data: { code: "UNAUTHORIZED" }, message: "NEVER-RENDER expired session" },
    { code: "UNAUTHENTICATED", message: "NEVER-RENDER expired cookie" },
    {
      data: { code: "PRECONDITION_FAILED" },
      message: "Management HQ access could not be verified.",
    },
    {
      data: { code: "PRECONDITION_FAILED" },
      message:
        "Management HQ data or access could not be verified. Values are unavailable, not zero. No partial totals have been returned.",
    },
    {
      data: { code: "PRECONDITION_FAILED" },
      message: "NEVER-RENDER arbitrary provider/SQL message",
    },
    {
      data: { code: "INTERNAL_SERVER_ERROR" },
      message: "Management HQ access could not be verified.",
    },
  ])(
    "revokes cached report/export permission on a current access-gate rejection until a fresh successful Refresh %j",
    async error => {
      liveFixture();
      const csv = deferred<any>();
      const check = deferred<any>();
      mock.csv.mockReturnValue(csv.promise);
      mock.connectionMutateAsync.mockReturnValue(check.promise);
      await render();
      await click("Check Orbit connection");
      // The CSV starts in this check's epoch, so discarding it proves revoked
      // report permission, rather than just check-start epoch invalidation.
      await click("Export all filtered records");
      await act(async () => check.reject(error));
      expect(container.textContent).toContain(
        "Management HQ access could not be verified."
      );
      expect(container.textContent).not.toContain("NEVER-RENDER");
      expect(currentReport()).toBeNull();
      expect(container.textContent).not.toContain("OFFLINE-LIVE-FIXTURE");
      expect(
        container.querySelector('[aria-label="Live reporting connection"]')
      ).toBeNull();
      expect(connectionPanel().textContent).not.toContain(
        "Portal could not complete"
      );
      expect(button("Check Orbit connection").disabled).toBe(true);
      await act(async () =>
        csv.resolve({
          csv: "Must not download",
          filename: "management-hq-LIVE-2026.csv",
        })
      );
      expect(downloads).toHaveLength(0);
      expect(createUrl).not.toHaveBeenCalled();
      await render();
      expect(currentReport()).toBeNull();
      expect(button("Check Orbit connection").disabled).toBe(true);
      const fresh = deferred<any>();
      mock.refetch.mockReturnValue(fresh.promise);
      await click("Refresh");
      expect(currentReport()).toBeNull();
      await act(async () =>
        fresh.resolve({ data: mock.data["managementHq.status"], error: null })
      );
      expect(currentReport()).toBeTruthy();
      expect(button("Check Orbit connection").disabled).toBe(false);
      expect(sampleMutations()).toHaveLength(0);
    }
  );

  it.each(["FORBIDDEN", "UNAUTHORIZED"])(
    "a %s status denial keeps health checks and existing sample mutations locked until Refresh",
    async code => {
      await render();
      mock.errors["managementHq.status"] = {
        data: { code },
        message: "NEVER-RENDER raw",
      };
      await render();
      expect(currentReport()).toBeNull();
      expect(button("Check Orbit connection").disabled).toBe(true);
      expect(
        container.querySelector('[aria-label="Sample scenarios"]')
      ).toBeNull();
      mock.errors["managementHq.status"] = null;
      await render();
      expect(currentReport()).toBeNull();
      expect(button("Check Orbit connection").disabled).toBe(true);
      expect(button("Replay value amendment").disabled).toBe(true);
      await click("Check Orbit connection");
      await click("Replay value amendment");
      expect(mock.mutations).toHaveLength(0);
      await click("Refresh");
      expect(currentReport()).toBeTruthy();
      expect(button("Check Orbit connection").disabled).toBe(false);
      expect(button("Replay value amendment").disabled).toBe(false);
    }
  );

  it("a failed Refresh does not clear a connection access revocation", async () => {
    await render();
    mock.connectionMutateAsync.mockRejectedValue({
      data: { code: "FORBIDDEN" },
    });
    await click("Check Orbit connection");
    mock.refetch.mockResolvedValue({
      data: undefined,
      error: { data: { code: "UNAUTHORIZED" } },
    });
    await click("Refresh");
    expect(currentReport()).toBeNull();
    expect(button("Check Orbit connection").disabled).toBe(true);
    expect(button("Replay value amendment").disabled).toBe(true);
    expect(sampleMutations()).toHaveLength(0);
  });

  it.each(["resolve", "reject"])(
    "actor A's late %s cannot reset actor B's hook or unlock B's independent in-flight operation",
    async settlement => {
      const actorA = deferred<any>();
      const actorB = deferred<any>();
      mock.connectionMutateAsync
        .mockImplementationOnce(() => actorA.promise)
        .mockImplementationOnce(() => actorB.promise);
      await render();
      await click("Check Orbit connection");
      mock.user = { ...mock.user, id: 48 };
      await render();
      await click("Check Orbit connection");
      const resetsBefore = mock.mutationResets.filter(
        reset => reset.actorId === 48
      ).length;
      expect(connectionChecks().map(call => call.actorId)).toEqual([47, 48]);
      await act(async () => {
        if (settlement === "resolve") actorA.resolve(connectionPayload());
        else
          actorA.reject({
            data: { code: "FORBIDDEN" },
            message: "NEVER-RENDER old actor",
          });
      });
      expect(
        mock.mutationResets.filter(reset => reset.actorId === 48)
      ).toHaveLength(resetsBefore);
      expect(connectionPanel().textContent).not.toContain(
        READY_CONNECTION_TEXT
      );
      expect(container.textContent).not.toContain(
        "Management HQ access could not be verified."
      );
      expect(button("Checking…").disabled).toBe(true);
      expect(button("Refresh").disabled).toBe(true);
      expect(button("Replay value amendment").disabled).toBe(true);
      await click("Checking…");
      await click("Refresh");
      await click("Replay value amendment");
      expect(connectionChecks()).toHaveLength(2);
      expect(mock.refetch).not.toHaveBeenCalled();
      expect(sampleMutations()).toHaveLength(0);
      await act(async () =>
        actorB.resolve(connectionPayload({ outcome: "missing_key" }))
      );
      expect(connectionPanel().textContent).toContain(
        "Orbit connection is not configured on the server."
      );
      expect(button("Check Orbit connection").disabled).toBe(false);
      expect(button("Refresh").disabled).toBe(false);
      expect(currentReport()?.getAttribute("data-actor")).toBe("48");
    }
  );
});

function firstImportFixture(patch: Record<string, any> = {}) {
  return liveFixture({
    readEnabled: false,
    hasPublished: false,
    health: "no_data",
    progress: null,
    generationId: null,
    stateVersion: null,
    nextDueAt: null,
    ...patch,
  });
}
function importPayload(patch: Record<string, unknown> = {}) {
  return {
    status: "progress",
    message: "NEVER-RENDER secret message",
    nextDueAt: null,
    hasPublished: false,
    progress: { pages: 1, recordsRead: 25 },
    errorCode: null,
    ...patch,
  };
}
function validationPayload(patch: Record<string, unknown> = {}) {
  return {
    status: "checks_ready",
    message: "NEVER-RENDER message",
    generationId: 12,
    checkedAt: "2026-11-24T12:01:00.000Z",
    sourcePublishedAt: "2026-11-24T12:00:00.000Z",
    isStale: false,
    manualChecksPending: true,
    limitations: ["NEVER-RENDER private URL"],
    years: [
      {
        year: 2026,
        activeBookings: 4,
        grossSales: "900719925474099312345678.1234",
        grossSalesMissing: 2,
        grossProfit: null,
        grossProfitMissing: 4,
        cancelledBookings: 2,
        pendingBookings: 1,
        undatedBookings: 3,
        unattributedBookings: 4,
      },
    ],
    ...patch,
  };
}
function firstPanel() {
  return container.querySelector(
    '[aria-label="First Orbit import and checks"]'
  );
}
function initialCalls(kind: "importInitialBatch" | "validateInitialImport") {
  return mock.mutationCalls.filter(
    call => call.path === `managementHq.${kind}`
  );
}
function assertNoDashboardActivation() {
  expect(currentReport()).toBeNull();
  expect(mock.hooks.some(hook => hook.path === "managementHq.report")).toBe(
    false
  );
  expect(mock.csv).not.toHaveBeenCalled();
  expect(sampleMutations()).toHaveLength(0);
  expect(mock.data["managementHq.status"].sampleEnabled).toBe(false);
  expect(mock.data["managementHq.status"].live.readEnabled).toBe(false);
}

describe("Manual first Orbit import and validation on actual DOM", () => {
  it.each([
    { configured: false, configurationCode: "CONFIG_INCOMPLETE" },
    { configurationCode: "CONFIG_INCOMPLETE" },
    { lastErrorCode: "CONFIG_INCOMPLETE" },
    { syncEnabled: false },
    { readEnabled: true },
  ])(
    "shows setup guidance without actions unless approved live sync-only setup is present %j",
    async patch => {
      firstImportFixture(patch);
      await render();
      expect(firstPanel()?.textContent).toContain(
        "Awaiting approved server setup"
      );
      expect(firstPanel()?.querySelector("button")).toBeNull();
      expect(container.querySelector("input, textarea, form")).toBeNull();
      expect(initialCalls("importInitialBatch")).toHaveLength(0);
      expect(initialCalls("validateInitialImport")).toHaveLength(0);
    }
  );

  it("disabled production shows plain setup guidance without assuming Railway approval", async () => {
    mock.data["managementHq.status"] = {
      reportMode: "disabled",
      sampleEnabled: false,
      hasSample: false,
      liveConfigured: false,
      stateVersion: null,
    };
    await render();
    expect(firstPanel()?.textContent).toContain(
      "Awaiting approved server setup"
    );
    expect(firstPanel()?.querySelector("button")).toBeNull();
    expect(mock.mutationCalls).toHaveLength(0);
  });

  it("never imports or validates on mount, rerender, focus, Refresh, filter changes, elapsed time or browser storage", async () => {
    firstImportFixture();
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    await render();
    await render();
    await act(async () => window.dispatchEvent(new Event("focus")));
    await click("Refresh");
    await change("Reporting month", "2");
    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900_000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(mock.mutationCalls).toHaveLength(0);
    expect(mock.hooks.some(hook => hook.options?.refetchInterval)).toBe(false);
    expect(
      mock.hooks.some(hook =>
        /importInitialBatch|validateInitialImport/.test(hook.path)
      )
    ).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    assertNoDashboardActivation();
  });

  it("same-tick double click runs exactly one void batch, locks competing controls and refreshes status once", async () => {
    firstImportFixture();
    const pending = deferred<any>();
    mock.importMutateAsync.mockReturnValue(pending.promise);
    await render();
    const start = button("Import Orbit figures");
    await act(async () => {
      start.click();
      start.click();
    });
    expect(initialCalls("importInitialBatch")).toEqual([
      {
        path: "managementHq.importInitialBatch",
        actorId: 47,
        input: undefined,
      },
    ]);
    for (const label of [
      "Importing…",
      "Refresh",
      "Check Orbit connection",
      "Executive Dashboard",
      "Financial Performance",
      "Agent Activity",
    ])
      expect(button(label).disabled).toBe(true);
    for (const label of ["Reporting year", "Reporting month"])
      expect(
        container.querySelector<HTMLSelectElement>(
          `select[aria-label="${label}"]`
        )!.disabled
      ).toBe(true);
    await click("Importing…");
    await click("Refresh");
    await click("Check Orbit connection");
    expect(mock.mutationCalls).toHaveLength(1);
    await act(async () => pending.resolve(importPayload()));
    expect(firstPanel()?.textContent).toContain("One import step completed");
    expect(firstPanel()?.textContent).toContain("1 pages · 25 records read");
    expect(button("Continue first import").disabled).toBe(false);
    expect(mock.refetch.mock.calls).toEqual([
      ["managementHq.status", { cancelRefetch: true }],
    ]);
    expect(initialCalls("validateInitialImport")).toHaveLength(0);
    expect(container.textContent).not.toContain("NEVER-RENDER");
    assertNoDashboardActivation();
  });

  it("continues only once per explicit click and never guesses completion after 25 records", async () => {
    firstImportFixture();
    mock.importMutateAsync.mockResolvedValue(importPayload());
    await render();
    await click("Import Orbit figures");
    await render();
    expect(initialCalls("importInitialBatch")).toHaveLength(1);
    expect(button("Continue first import").disabled).toBe(false);
    await click("Continue first import");
    expect(initialCalls("importInitialBatch")).toHaveLength(2);
    expect(initialCalls("validateInitialImport")).toHaveLength(0);
    expect(firstPanel()?.textContent).not.toContain("First import complete");
    assertNoDashboardActivation();
  });

  it("notdue shows a local wait and elapsed time never auto-continues", async () => {
    firstImportFixture();
    const due = new Date(Date.now() + 60_000).toISOString();
    mock.importMutateAsync.mockResolvedValue(
      importPayload({ status: "notdue", nextDueAt: due, progress: null })
    );
    await render();
    await click("Import Orbit figures");
    expect(firstPanel()?.textContent).toContain(
      `Wait until ${new Date(due).toLocaleString()}, then continue`
    );
    expect(button("Continue first import").disabled).toBe(true);
    await click("Continue first import");
    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(initialCalls("importInitialBatch")).toHaveLength(1);
    expect(initialCalls("validateInitialImport")).toHaveLength(0);
    assertNoDashboardActivation();
  });

  it.each(["applied", "already_complete"])(
    "%s disables first import, handles its own published version refresh and checks only on explicit click",
    async status => {
      firstImportFixture();
      mock.importMutateAsync.mockResolvedValue(
        importPayload({ status, hasPublished: true, progress: null })
      );
      mock.refetch.mockImplementation(async () => {
        mock.data["managementHq.status"].stateVersion = 9;
        Object.assign(mock.data["managementHq.status"].live, {
          stateVersion: 9,
          generationId: 12,
          hasPublished: true,
          health: "ready",
          sourcePublishedAt: "2026-11-24T12:00:00Z",
        });
        return { data: mock.data["managementHq.status"], error: null };
      });
      mock.validationMutateAsync.mockResolvedValue(validationPayload());
      await render();
      await click("Import Orbit figures");
      expect(firstPanel()?.textContent).toContain("First import complete");
      expect(firstPanel()?.textContent).not.toContain("Continue first import");
      expect(button("Check imported figures").disabled).toBe(false);
      expect(initialCalls("validateInitialImport")).toHaveLength(0);
      expect(mock.refetch).toHaveBeenCalledTimes(1);
      await click("Check imported figures");
      expect(initialCalls("validateInitialImport")).toEqual([
        {
          path: "managementHq.validateInitialImport",
          actorId: 47,
          input: undefined,
        },
      ]);
      const summary = firstPanel()?.querySelector(
        '[aria-label="Imported figures summary"]'
      );
      expect(summary?.textContent).toContain(
        "£900,719,925,474,099,312,345,678.1234"
      );
      expect(summary?.textContent).toContain(
        "2 missing · known source sum only"
      );
      expect(summary?.textContent).toContain("Missing4 missing");
      expect(firstPanel()?.textContent).toContain(
        "Manual amendment checks and cancellation financial checks remain pending"
      );
      expect(firstPanel()?.textContent).toContain(
        "This is not passed live acceptance"
      );
      expect(container.textContent).not.toContain("NEVER-RENDER");
      expect(mock.refetch).toHaveBeenCalledTimes(1);
      assertNoDashboardActivation();
    }
  );

  it("validation double clicks lock once, remove previous private summary immediately, and never automatically reread", async () => {
    firstImportFixture({ hasPublished: true });
    mock.validationMutateAsync.mockResolvedValue(validationPayload());
    await render();
    await click("Check imported figures");
    expect(
      firstPanel()?.querySelector('[aria-label="Imported figures summary"]')
    ).toBeTruthy();
    const pending = deferred<any>();
    mock.validationMutateAsync.mockReturnValue(pending.promise);
    const check = button("Check imported figures");
    await act(async () => {
      check.click();
      check.click();
    });
    expect(initialCalls("validateInitialImport")).toHaveLength(2);
    expect(
      firstPanel()?.querySelector('[aria-label="Imported figures summary"]')
    ).toBeNull();
    expect(button("Checking imported figures…").disabled).toBe(true);
    expect(button("Refresh").disabled).toBe(true);
    await act(async () =>
      pending.resolve(validationPayload({ isStale: true }))
    );
    expect(firstPanel()?.textContent).toContain("Stale source warning");
    expect(mock.refetch).not.toHaveBeenCalled();
    assertNoDashboardActivation();
  });

  it.each(["disabled", "busy", "needs_attention"])(
    "%s import result has fixed staff text, not source messages",
    async status => {
      firstImportFixture();
      mock.importMutateAsync.mockResolvedValue(importPayload({ status }));
      await render();
      await click("Import Orbit figures");
      expect(container.textContent).not.toContain("NEVER-RENDER");
      expect(initialCalls("importInitialBatch")).toHaveLength(1);
      expect(initialCalls("validateInitialImport")).toHaveLength(0);
      assertNoDashboardActivation();
    }
  );

  it.each([
    null,
    undefined,
    {},
    { status: "__proto__" },
    importPayload({ progress: { pages: "NEVER-RENDER", recordsRead: -1 } }),
    importPayload({ status: "applied", hasPublished: false }),
    importPayload({ nextDueAt: "NEVER-RENDER" }),
  ])(
    "malformed import DTO never invents completion or displays raw fields %j",
    async payload => {
      firstImportFixture();
      mock.importMutateAsync.mockResolvedValue(payload);
      await render();
      await click("Import Orbit figures");
      expect(firstPanel()?.textContent).toContain(
        "first import needs attention"
      );
      expect(firstPanel()?.textContent).not.toContain("First import complete");
      expect(container.textContent).not.toContain("NEVER-RENDER");
      assertNoDashboardActivation();
    }
  );

  it.each([
    null,
    undefined,
    {},
    validationPayload({ checkedAt: "NEVER-RENDER" }),
    validationPayload({ manualChecksPending: false }),
    validationPayload({ years: "NEVER-RENDER" }),
    validationPayload({
      years: [{ ...validationPayload().years[0], activeBookings: -1 }],
    }),
    validationPayload({
      years: [{ ...validationPayload().years[0], grossSales: "NEVER-RENDER" }],
    }),
    validationPayload({ isStale: "NEVER-RENDER" }),
  ])(
    "malformed validation DTO safely withholds the entire summary %j",
    async payload => {
      firstImportFixture({ hasPublished: true });
      mock.validationMutateAsync.mockResolvedValue(payload);
      await render();
      await click("Check imported figures");
      expect(firstPanel()?.textContent).toContain(
        "could not be checked safely"
      );
      expect(
        firstPanel()?.querySelector('[aria-label="Imported yearly figures"]')
      ).toBeNull();
      expect(container.textContent).not.toContain("NEVER-RENDER");
      assertNoDashboardActivation();
    }
  );

  it.each(["awaiting_import", "needs_attention"])(
    "%s validation never displays partial money rows",
    async status => {
      firstImportFixture({ hasPublished: true });
      mock.validationMutateAsync.mockResolvedValue(
        validationPayload({ status })
      );
      await render();
      await click("Check imported figures");
      expect(
        firstPanel()?.querySelector('[aria-label="Imported yearly figures"]')
      ).toBeNull();
      expect(firstPanel()?.textContent).not.toContain("900,719");
      assertNoDashboardActivation();
    }
  );
});

describe("First import and checks dedicated lifecycle DOM regressions", () => {
  it.each(["import", "check"] as const)(
    "%s stays unavailable until both fresh authority and status observers succeed",
    async kind => {
      firstImportFixture({ hasPublished: kind === "check" });
      const pending = deferred();
      mock.queryWait["managementHq.status"] = pending.promise;
      await render();
      expect(firstPanel()).toBeNull();
      expect(mock.mutationCalls).toHaveLength(0);
      await act(async () => pending.resolve());
      expect(
        button(
          kind === "import" ? "Import Orbit figures" : "Check imported figures"
        ).disabled
      ).toBe(false);
    }
  );

  it.each(["import", "check"] as const)(
    "%s cannot start with denied cached current authority",
    async kind => {
      firstImportFixture({ hasPublished: kind === "check" });
      mock.data["auth.me"] = { ...mock.user, role: "admin" };
      await render();
      expect(firstPanel()).toBeNull();
      expect(mock.mutationCalls).toHaveLength(0);
    }
  );

  for (const kind of ["import", "check"] as const) {
    it.each([
      "actor",
      "revoked",
      "auth-pending",
      "unmount",
      "route",
      "month",
      "year",
      "mode",
      "status-error",
      "status-pending",
      "generation",
      "settings",
      "freshness-settings",
      "sync-settings",
      "configuration-error",
      "live-configured",
      "source",
    ])(
      `late ${kind} result is withheld after %s and cannot automatically refresh or check`,
      async changeType => {
        firstImportFixture({ hasPublished: kind === "check" });
        const pending = deferred<any>();
        (kind === "import"
          ? mock.importMutateAsync
          : mock.validationMutateAsync
        ).mockReturnValue(pending.promise);
        await render();
        await click(
          kind === "import" ? "Import Orbit figures" : "Check imported figures"
        );
        if (changeType === "source") {
          mock.data["managementHq.status"].live.sourcePublishedAt =
            "2026-11-24T12:02:00Z";
          await render();
        } else await connectionBoundaryChange(changeType);
        await act(async () =>
          pending.resolve(
            kind === "import" ? importPayload() : validationPayload()
          )
        );
        expect(container.textContent).not.toContain(
          "One import step completed"
        );
        expect(container.textContent).not.toContain(
          "Imported yearly figures are ready"
        );
        expect(container.textContent).not.toContain("NEVER-RENDER");
        expect(mock.refetch).not.toHaveBeenCalled();
        expect(initialCalls("importInitialBatch")).toHaveLength(
          kind === "import" ? 1 : 0
        );
        expect(initialCalls("validateInitialImport")).toHaveLength(
          kind === "check" ? 1 : 0
        );
        if (
          !["revoked", "auth-pending", "unmount", "status-pending"].includes(
            changeType
          )
        )
          expect(button("Refresh").disabled).toBe(false);
      }
    );

    it.each(["route", "mode", "month", "settings"])(
      `late ${kind} access rejection after %s does not revoke a different boundary`,
      async changeType => {
        firstImportFixture({ hasPublished: kind === "check" });
        const pending = deferred<any>();
        (kind === "import"
          ? mock.importMutateAsync
          : mock.validationMutateAsync
        ).mockReturnValue(pending.promise);
        await render();
        await click(
          kind === "import" ? "Import Orbit figures" : "Check imported figures"
        );
        await connectionBoundaryChange(changeType);
        await act(async () =>
          pending.reject({
            data: { code: "FORBIDDEN" },
            message: "NEVER-RENDER",
          })
        );
        expect(container.textContent).not.toContain(
          "Management HQ access could not be verified."
        );
        expect(button("Refresh").disabled).toBe(false);
        expect(mock.refetch).not.toHaveBeenCalled();
      }
    );

    it.each([
      "FORBIDDEN",
      "UNAUTHORIZED",
      "UNAUTHENTICATED",
      "PRECONDITION_FAILED",
    ])(
      `current ${kind} %s rejection suppresses all HQ actions until fresh successful Refresh`,
      async code => {
        firstImportFixture({ hasPublished: kind === "check" });
        (kind === "import"
          ? mock.importMutateAsync
          : mock.validationMutateAsync
        ).mockRejectedValue({ data: { code }, message: "NEVER-RENDER" });
        await render();
        await click(
          kind === "import" ? "Import Orbit figures" : "Check imported figures"
        );
        expect(firstPanel()).toBeNull();
        expect(container.textContent).toContain(
          "Management HQ access could not be verified."
        );
        expect(
          container.querySelector('[aria-label="Live reporting connection"]')
        ).toBeNull();
        expect(button("Check Orbit connection").disabled).toBe(true);
        expect(container.textContent).not.toContain("NEVER-RENDER");
        mock.refetch.mockResolvedValueOnce({
          data: undefined,
          error: { data: { code: "FORBIDDEN" } },
        });
        await click("Refresh");
        expect(firstPanel()).toBeNull();
        await click("Refresh");
        expect(firstPanel()).toBeTruthy();
        expect(button("Check Orbit connection").disabled).toBe(false);
        assertNoDashboardActivation();
      }
    );

    it.each(["resolve", "reject"])(
      `actor A's late ${kind} %s never resets or unlocks B's pending action`,
      async settlement => {
        firstImportFixture({ hasPublished: kind === "check" });
        const actorA = deferred<any>();
        const actorB = deferred<any>();
        (kind === "import"
          ? mock.importMutateAsync
          : mock.validationMutateAsync
        )
          .mockImplementationOnce(() => actorA.promise)
          .mockImplementationOnce(() => actorB.promise);
        await render();
        await click(
          kind === "import" ? "Import Orbit figures" : "Check imported figures"
        );
        mock.user = { ...mock.user, id: 48 };
        await render();
        await click(
          kind === "import" ? "Import Orbit figures" : "Check imported figures"
        );
        const before = mock.mutationResets.filter(
          reset => reset.actorId === 48
        ).length;
        await act(async () =>
          settlement === "resolve"
            ? actorA.resolve(
                kind === "import" ? importPayload() : validationPayload()
              )
            : actorA.reject({
                data: { code: "FORBIDDEN" },
                message: "NEVER-RENDER",
              })
        );
        expect(
          mock.mutationResets.filter(reset => reset.actorId === 48)
        ).toHaveLength(before);
        expect(button("Refresh").disabled).toBe(true);
        expect(
          button(
            kind === "import" ? "Importing…" : "Checking imported figures…"
          ).disabled
        ).toBe(true);
        expect(container.textContent).not.toContain(
          "Management HQ access could not be verified."
        );
        expect(mock.refetch).not.toHaveBeenCalled();
        await act(async () =>
          actorB.resolve(
            kind === "import" ? importPayload() : validationPayload()
          )
        );
        expect(button("Refresh").disabled).toBe(false);
        expect(
          initialCalls(
            kind === "import" ? "importInitialBatch" : "validateInitialImport"
          ).map(call => call.actorId)
        ).toEqual([47, 48]);
      }
    );
  }

  it.each([
    "actor",
    "revoked",
    "auth-pending",
    "mode",
    "status-error",
    "status-pending",
    "generation",
    "settings",
    "freshness-settings",
    "sync-settings",
    "configuration-error",
    "live-configured",
    "month",
    "year",
    "source",
    "refresh",
    "health-check",
    "view",
  ])(
    "stored validation summary is invalidated on %s rather than becoming read/export authority",
    async changeType => {
      firstImportFixture({ hasPublished: true });
      mock.validationMutateAsync.mockResolvedValue(validationPayload());
      await render();
      await click("Check imported figures");
      expect(
        firstPanel()?.querySelector('[aria-label="Imported yearly figures"]')
      ).toBeTruthy();
      if (changeType === "source") {
        mock.data["managementHq.status"].live.sourceObservationAt =
          "2026-11-24T12:02:00Z";
        await render();
      } else if (changeType === "refresh") await click("Refresh");
      else if (changeType === "health-check")
        await click("Check Orbit connection");
      else if (changeType === "view") await click("Financial Performance");
      else await connectionBoundaryChange(changeType);
      expect(
        firstPanel()?.querySelector('[aria-label="Imported yearly figures"]') ??
          null
      ).toBeNull();
      expect(container.textContent).not.toContain("900,719");
      expect(mock.csv).not.toHaveBeenCalled();
    }
  );

  it.each(["import", "check"] as const)(
    "settings invalidation clears %s UI busy before settlement, and old flight cannot unlock the next action",
    async kind => {
      firstImportFixture({ hasPublished: kind === "check" });
      const old = deferred<any>();
      const next = deferred<any>();
      (kind === "import"
        ? mock.importMutateAsync
        : mock.validationMutateAsync
      ).mockReturnValue(old.promise);
      await render();
      await click(
        kind === "import" ? "Import Orbit figures" : "Check imported figures"
      );
      await connectionBoundaryChange("settings");
      expect(button("Refresh").disabled).toBe(false);
      mock.connectionMutateAsync.mockReturnValue(next.promise);
      await click("Check Orbit connection");
      expect(button("Refresh").disabled).toBe(true);
      await act(async () =>
        old.resolve(kind === "import" ? importPayload() : validationPayload())
      );
      expect(button("Refresh").disabled).toBe(true);
      expect(button("Checking…").disabled).toBe(true);
      expect(mock.refetch).not.toHaveBeenCalled();
      await act(async () => next.resolve(connectionPayload()));
      expect(button("Refresh").disabled).toBe(false);
    }
  );

  it("a failed status refresh after an import exposes no guessed totals and no second batch", async () => {
    firstImportFixture();
    mock.importMutateAsync.mockResolvedValue(importPayload());
    mock.refetch.mockResolvedValue({
      data: undefined,
      error: {
        data: { code: "INTERNAL_SERVER_ERROR" },
        message: "NEVER-RENDER",
      },
    });
    await render();
    await click("Import Orbit figures");
    expect(firstPanel()?.textContent).toContain("first import needs attention");
    expect(initialCalls("importInitialBatch")).toHaveLength(1);
    expect(initialCalls("validateInitialImport")).toHaveLength(0);
    expect(mock.refetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("NEVER-RENDER");
    assertNoDashboardActivation();
  });
});

describe("First import final manual-only boundary checks", () => {
  it("a wait can be continued after its due time only by another manual click", async () => {
    firstImportFixture();
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    const due = new Date(start + 60_000).toISOString();
    mock.importMutateAsync
      .mockResolvedValueOnce(
        importPayload({ status: "notdue", nextDueAt: due, progress: null })
      )
      .mockResolvedValueOnce(
        importPayload({ progress: { pages: 2, recordsRead: 50 } })
      );
    await render();
    await click("Import Orbit figures");
    expect(button("Continue first import").disabled).toBe(true);
    now.mockReturnValue(start + 60_001);
    await render();
    expect(initialCalls("importInitialBatch")).toHaveLength(1);
    expect(button("Continue first import").disabled).toBe(false);
    await click("Continue first import");
    expect(initialCalls("importInitialBatch")).toHaveLength(2);
    expect(firstPanel()?.textContent).toContain("2 pages · 50 records read");
    assertNoDashboardActivation();
  });

  it("a stored validation summary disappears when the route changes and renders again", async () => {
    firstImportFixture({ hasPublished: true });
    mock.validationMutateAsync.mockResolvedValue(validationPayload());
    await render();
    await click("Check imported figures");
    expect(
      firstPanel()?.querySelector('[aria-label="Imported yearly figures"]')
    ).toBeTruthy();
    await act(async () => window.history.replaceState({}, "", "/super-admin"));
    await render();
    expect(
      firstPanel()?.querySelector('[aria-label="Imported yearly figures"]') ??
        null
    ).toBeNull();
    expect(container.textContent).not.toContain("900,719");
    expect(mock.csv).not.toHaveBeenCalled();
  });

  it("own status fetch may temporarily become pending and publish a new version without losing fixed completed-import copy", async () => {
    firstImportFixture();
    mock.importMutateAsync.mockResolvedValue(
      importPayload({ status: "applied", hasPublished: true, progress: null })
    );
    const statusRead = deferred<any>();
    mock.refetch.mockReturnValue(statusRead.promise);
    await render();
    await click("Import Orbit figures");
    mock.fetching["managementHq.status"] = true;
    await render();
    expect(firstPanel()).toBeNull();
    expect(button("Refresh").disabled).toBe(true);
    mock.fetching["managementHq.status"] = false;
    Object.assign(mock.data["managementHq.status"], { stateVersion: 9 });
    Object.assign(mock.data["managementHq.status"].live, {
      hasPublished: true,
      stateVersion: 9,
      generationId: 12,
    });
    await render();
    await act(async () =>
      statusRead.resolve({
        data: mock.data["managementHq.status"],
        error: null,
      })
    );
    expect(firstPanel()?.textContent).toContain("First import complete");
    expect(button("Check imported figures").disabled).toBe(false);
    expect(mock.refetch).toHaveBeenCalledTimes(1);
    expect(initialCalls("validateInitialImport")).toHaveLength(0);
    assertNoDashboardActivation();
  });

  it("a settings change during the owned post-import status fetch clears busy and suppresses late completion", async () => {
    firstImportFixture();
    mock.importMutateAsync.mockResolvedValue(importPayload());
    const statusRead = deferred<any>();
    mock.refetch.mockReturnValue(statusRead.promise);
    await render();
    await click("Import Orbit figures");
    await connectionBoundaryChange("sync-settings");
    expect(button("Refresh").disabled).toBe(false);
    expect(firstPanel()?.textContent).toContain(
      "Awaiting approved server setup"
    );
    await act(async () =>
      statusRead.resolve({
        data: mock.data["managementHq.status"],
        error: null,
      })
    );
    expect(firstPanel()?.textContent).not.toContain(
      "One import step completed"
    );
    expect(initialCalls("importInitialBatch")).toHaveLength(1);
    expect(initialCalls("validateInitialImport")).toHaveLength(0);
    expect(button("Refresh").disabled).toBe(false);
  });
});

describe("Owned post-import status refresh access failures", () => {
  it.each(["FORBIDDEN", "PRECONDITION_FAILED"])(
    "fresh %s status rejection suppresses first-import/check panel until successful Refresh",
    async code => {
      firstImportFixture();
      mock.importMutateAsync.mockResolvedValue(importPayload());
      mock.refetch.mockResolvedValueOnce({
        data: undefined,
        error: { data: { code }, message: "NEVER-RENDER" },
      });
      await render();
      await click("Import Orbit figures");
      expect(firstPanel()).toBeNull();
      expect(button("Check Orbit connection").disabled).toBe(true);
      expect(container.textContent).toContain(
        "Management HQ access could not be verified."
      );
      expect(container.textContent).not.toContain("NEVER-RENDER");
      await click("Refresh");
      expect(firstPanel()).toBeTruthy();
      assertNoDashboardActivation();
    }
  );
});
