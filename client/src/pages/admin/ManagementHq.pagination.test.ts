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

// Offline harness copied from ManagementHq.test.ts; the existing suite is untouched.
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
  reportRead: undefined as ((input: any) => any) | undefined,
  hooks: [] as { path: string; input: any; options: any }[],
  mutations: [] as any[],
  mutationCalls: [] as { path: string; actorId: number; input: any }[],
  mutationResets: [] as { path: string; actorId: number }[],
  connectionMutateAsync: vi.fn(),
  importMutateAsync: vi.fn(),
  validationMutateAsync: vi.fn(),
  finishMutateAsync: vi.fn(),
  repairMutateAsync: vi.fn(),
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
      : path === "managementHq.report" && mock.reportRead
        ? mock.reportRead(input)
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
              const queryKey = JSON.stringify(input);
              const [freshKey, setFreshKey] = react.useState<string | null>(
                null
              );
              react.useEffect(() => {
                if (options.enabled === false) return;
                let mounted = true;
                void Promise.resolve(mock.queryWait[path]).then(() => {
                  if (mounted) setFreshKey(queryKey);
                });
                return () => {
                  mounted = false;
                };
              }, [options.enabled, queryKey]);
              return {
                data: read(path, input),
                error: mock.errors[path] ?? null,
                isLoading: false,
                isFetching: !!mock.fetching[path],
                isFetchedAfterMount: freshKey === queryKey,
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
                    if (path === "managementHq.finishInitialImportBatch")
                      return await mock.finishMutateAsync(input);
                    if (path === "managementHq.repairInitialImportCapacity")
                      return await mock.repairMutateAsync(input);
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
import ManagementHq from "./ManagementHq";

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
  mock.finishMutateAsync.mockReset();
  mock.repairMutateAsync.mockReset();
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
  mock.reportRead = undefined;
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
function pagedReport(
  input: { year: number; month?: number; detailPage?: number },
  totalRows = 55
): HqReport {
  const page = input.detailPage ?? 0;
  const result = report();
  const files = Array.from(
    { length: Math.min(25, Math.max(0, totalRows - page * 25)) },
    (_, index) => booking(page * 25 + index + 1)
  );
  result.bookings = files.slice(0, Math.max(0, files.length - 2));
  result.undatedExceptions = files.slice(-2).map(file => ({
    ...file,
    reportingDate: null,
    dateSource: "none",
    cohort: "exception",
  }));
  if (!files.length) result.undatedExceptions = [];
  result.filters = { year: input.year, month: input.month ?? null };
  result.totals.bookingCount = 8115;
  result.totals.grossSales = coverage("123456789.1234");
  result.exportComplete = false;
  return Object.assign(result, {
    detailMode: "page",
    detailPage: { page, pageSize: 25, totalRows, totalsComplete: true },
  });
}
function enablePages(totalRows = 55) {
  mock.reportRead = input => pagedReport(input, totalRows);
}
function lastInput() {
  return mock.hooks.filter(hook => hook.path === "managementHq.report").at(-1)
    ?.input;
}
function bookingRows() {
  return [
    ...container.querySelectorAll('[aria-label="Booking drilldown"] tbody tr'),
  ];
}
function expectWithheld() {
  expect(currentReport()).toBeNull();
  expect(container.querySelector('[aria-label="Executive KPIs"]')).toBeNull();
  expect(
    container.querySelector('[aria-label="Monthly restated totals"]')
  ).toBeNull();
  expect(container.querySelector("#hq-source-detail")).toBeNull();
  expect(container.textContent).not.toContain("£123,456,789.1234");
}
function setLive() {
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
  };
  mock.data["managementHq.status"] = {
    sampleEnabled: false,
    liveConfigured: true,
    hasSample: false,
    stateVersion: 8,
    updatedAt: live.lastPublishedAt,
    reportMode: "live",
    live,
  };
  mock.reportRead = input => ({
    ...pagedReport(input),
    sourceMode: "live",
    stateVersion: mock.data["managementHq.status"].stateVersion,
  });
}

describe("Management HQ bounded booking detail pagination on actual DOM", () => {
  it("loads first/next/previous 25-row pages using global counts without locally slicing a server page", async () => {
    enablePages();
    await render();
    expect(lastInput()).toEqual({ year: 2026 });
    expect(bookingRows()).toHaveLength(25);
    expect(bookingRows()[0]?.textContent).toContain("SAMPLE-1");
    expect(bookingRows()[24]?.textContent).toContain("SAMPLE-25");
    expect(button("Previous bookings").disabled).toBe(true);
    expect(container.textContent).toContain("55 records · Page 1 of 3");
    await click("Next bookings");
    expect(lastInput()).toEqual({ year: 2026, detailPage: 1 });
    expect(bookingRows()).toHaveLength(25);
    expect(bookingRows()[0]?.textContent).toContain("SAMPLE-26");
    expect(bookingRows()[24]?.textContent).toContain("SAMPLE-50");
    expect(container.textContent).toContain("55 records · Page 2 of 3");
    await click("Previous bookings");
    expect(lastInput()).toEqual({ year: 2026 });
    expect(bookingRows()).toHaveLength(25);
    expect(bookingRows()[0]?.textContent).toContain("SAMPLE-1");
  });
  it("uses the last partial page and global Next/Previous boundaries", async () => {
    enablePages();
    await render();
    await click("Next bookings");
    await click("Next bookings");
    expect(lastInput()).toEqual({ year: 2026, detailPage: 2 });
    expect(bookingRows()).toHaveLength(5);
    expect(bookingRows()[0]?.textContent).toContain("SAMPLE-51");
    expect(bookingRows()[4]?.textContent).toContain("SAMPLE-55");
    expect(button("Next bookings").disabled).toBe(true);
    expect(button("Previous bookings").disabled).toBe(false);
    expect(container.textContent).toContain("55 records · Page 3 of 3");
  });
  it("preserves whole-period KPIs, cohorts, financial precision, monthly and agent figures across pages", async () => {
    enablePages();
    await render();
    const kpis = container.querySelector(
      '[aria-label="Executive KPIs"]'
    )!.textContent;
    const monthly = container.querySelector(
      '[aria-label="Monthly restated totals"]'
    )!.textContent;
    const cohorts = container.querySelector(
      '[aria-label="Reporting limitations"]'
    )!.textContent;
    expect(kpis).toContain("8115");
    expect(kpis).toContain("£123,456,789.1234");
    await click("Financial Performance");
    const financial = container.querySelector(
      '[aria-label="Financial performance"]'
    )!.textContent;
    await click("Agent Activity");
    const agents = container.querySelector(
      '[aria-label="Agent activity"]'
    )!.textContent;
    await click("Next bookings");
    expect(
      container.querySelector('[aria-label="Agent activity"]')!.textContent
    ).toBe(agents);
    await click("Financial Performance");
    expect(
      container.querySelector('[aria-label="Financial performance"]')!
        .textContent
    ).toBe(financial);
    await click("Executive Dashboard");
    expect(
      container.querySelector('[aria-label="Executive KPIs"]')!.textContent
    ).toBe(kpis);
    expect(
      container.querySelector('[aria-label="Monthly restated totals"]')!
        .textContent
    ).toBe(monthly);
    expect(
      container.querySelector('[aria-label="Reporting limitations"]')!
        .textContent
    ).toBe(cohorts);
  });
  it("clears selected details on Next and Previous, including split undated exceptions", async () => {
    enablePages();
    await render();
    await click("Source values for SAMPLE-25");
    expect(container.querySelector("#hq-source-detail")?.textContent).toContain(
      "Undated"
    );
    await click("Next bookings");
    expect(container.querySelector("#hq-source-detail")).toBeNull();
    await click("Source values for SAMPLE-26");
    await click("Previous bookings");
    expect(container.querySelector("#hq-source-detail")).toBeNull();
    expect(
      button("Source values for SAMPLE-25").getAttribute("aria-expanded")
    ).toBe("false");
  });
  it("preserves provisional owner, assigned staff and null original seller in paged records", async () => {
    mock.reportRead = input => {
      const result = pagedReport(input);
      Object.assign(result.bookings[0]!, {
        seller: null,
        currentOwner: { ...seller, name: "Current Owner" },
        assignedStaff: { ...seller, userId: 102, name: "Assigned Staff" },
        attributionState: "provisional_current_owner",
      });
      return result;
    };
    await render();
    expect(bookingRows()[0]?.textContent).toContain(
      "Original seller unavailable; current owner provisional"
    );
    expect(bookingRows()[0]?.textContent).toContain(
      "Provisional current owner · not original seller"
    );
    await click("Source values for SAMPLE-1");
    const attribution = container.querySelector(
      '[aria-label="Booking attribution"]'
    )!;
    expect(attribution.textContent).toContain("SellerUnattributed");
    expect(attribution.textContent).toContain("Current Owner");
    expect(attribution.textContent).toContain("Assigned Staff");
    expect(attribution.textContent).toContain(processor.name);
  });
  it.each([false, true])(
    "disables complete CSV for paged reports even when exportComplete=%s",
    async exportComplete => {
      mock.reportRead = input => ({ ...pagedReport(input), exportComplete });
      await render();
      expect(button("Export all filtered records").disabled).toBe(true);
      expect(container.textContent).toContain(
        "Booking details are paged; figures above cover the full period. A complete CSV is unavailable for this view."
      );
      expect(container.textContent).not.toContain(
        "Report exceeds the server export bound"
      );
      await click("Export all filtered records");
      await click("Next bookings");
      await click("Export all filtered records");
      expect(mock.csv).not.toHaveBeenCalled();
      expect(createUrl).not.toHaveBeenCalled();
    }
  );
  it("leaves full-body local pagination and complete CSV export unchanged", async () => {
    mock.data["managementHq.report"].bookings = Array.from(
      { length: 28 },
      (_, index) => booking(index + 1)
    );
    mock.data["managementHq.report"].undatedExceptions = [];
    await render();
    await click("Source values for SAMPLE-1");
    await click("Next bookings");
    expect(bookingRows()).toHaveLength(3);
    expect(container.querySelector("#hq-source-detail")).toBeNull();
    expect(lastInput()).toEqual({ year: 2026 });
    await click("Export all filtered records");
    expect(mock.csv).toHaveBeenCalledWith({ year: 2026 });
    expect(downloads).toHaveLength(1);
  });
  it("does not prefetch, refetch, mutate or contact a provider without an explicit click", async () => {
    enablePages();
    await render();
    await render();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(
      mock.hooks
        .filter(hook => hook.path === "managementHq.report")
        .every(hook => hook.input.detailPage === undefined)
    ).toBe(true);
    expect(mock.refetch).not.toHaveBeenCalled();
    expect(mock.mutationCalls).toHaveLength(0);
    expect(mock.csv).not.toHaveBeenCalled();
  });
  it("withholds old records and selection during page cancellation and fetching", async () => {
    enablePages();
    await render();
    await click("Source values for SAMPLE-1");
    const cancel = deferred();
    mock.cancel.mockImplementation((_path, input) =>
      input?.detailPage === 1 ? cancel.promise : Promise.resolve()
    );
    mock.fetching["managementHq.report"] = true;
    await click("Next bookings");
    expectWithheld();
    expect(button("Replay sample cancellation").disabled).toBe(true);
    await act(async () => cancel.resolve());
    expectWithheld();
    mock.fetching["managementHq.report"] = false;
    await render();
    expect(bookingRows()).toHaveLength(25);
    expect(container.querySelector("#hq-source-detail")).toBeNull();
  });
  it("withholds old metadata under a later query key until the matching page arrives", async () => {
    let stale = true;
    mock.reportRead = input =>
      pagedReport(stale ? { ...input, detailPage: 0 } : input);
    await render();
    await click("Next bookings");
    expectWithheld();
    stale = false;
    await render();
    expect(bookingRows()[0]?.textContent).toContain("SAMPLE-26");
  });
  it("rejects a full-body DTO as a later page response", async () => {
    mock.reportRead = input =>
      input.detailPage
        ? {
            ...report(),
            filters: { year: input.year, month: input.month ?? null },
          }
        : pagedReport(input);
    await render();
    await click("Next bookings");
    expectWithheld();
  });
  it.each(["query", "cancel", "refresh"])(
    "fails closed after a later-page %s failure",
    async failure => {
      enablePages();
      await render();
      await click("Next bookings");
      await click("Source values for SAMPLE-26");
      if (failure === "query") {
        mock.errors["managementHq.report"] = new Error("secret provider error");
        await render();
      } else if (failure === "cancel") {
        mock.cancel.mockRejectedValue(new Error("secret provider error"));
        await click("Next bookings");
      } else {
        mock.refetch.mockRejectedValue(new Error("secret provider error"));
        await click("Refresh");
      }
      expectWithheld();
      expect(container.textContent).not.toContain("secret provider error");
      expect(mock.csv).not.toHaveBeenCalled();
    }
  );
  it.each([
    ["missing mode", { detailMode: undefined }],
    ["wrong mode", { detailMode: "full" }],
    ["missing metadata", { detailPage: undefined }],
    ["null metadata", { detailPage: null }],
    [
      "fractional page",
      {
        detailPage: {
          page: 0.5,
          pageSize: 25,
          totalRows: 55,
          totalsComplete: true,
        },
      },
    ],
    [
      "negative page",
      {
        detailPage: {
          page: -1,
          pageSize: 25,
          totalRows: 55,
          totalsComplete: true,
        },
      },
    ],
    [
      "oversized page",
      {
        detailPage: {
          page: 800,
          pageSize: 25,
          totalRows: 20000,
          totalsComplete: true,
        },
      },
    ],
    [
      "string page",
      {
        detailPage: {
          page: "0",
          pageSize: 25,
          totalRows: 55,
          totalsComplete: true,
        },
      },
    ],
    [
      "wrong page size",
      {
        detailPage: {
          page: 0,
          pageSize: 24,
          totalRows: 55,
          totalsComplete: true,
        },
      },
    ],
    [
      "string page size",
      {
        detailPage: {
          page: 0,
          pageSize: "25",
          totalRows: 55,
          totalsComplete: true,
        },
      },
    ],
    [
      "fractional total",
      {
        detailPage: {
          page: 0,
          pageSize: 25,
          totalRows: 55.5,
          totalsComplete: true,
        },
      },
    ],
    [
      "negative total",
      {
        detailPage: {
          page: 0,
          pageSize: 25,
          totalRows: -1,
          totalsComplete: true,
        },
      },
    ],
    [
      "excess total",
      {
        detailPage: {
          page: 0,
          pageSize: 25,
          totalRows: 20001,
          totalsComplete: true,
        },
      },
    ],
    [
      "string total",
      {
        detailPage: {
          page: 0,
          pageSize: 25,
          totalRows: "55",
          totalsComplete: true,
        },
      },
    ],
    [
      "incomplete totals",
      {
        detailPage: {
          page: 0,
          pageSize: 25,
          totalRows: 55,
          totalsComplete: false,
        },
      },
    ],
    [
      "missing guarantee",
      { detailPage: { page: 0, pageSize: 25, totalRows: 55 } },
    ],
    [
      "wrong first page",
      {
        detailPage: {
          page: 1,
          pageSize: 25,
          totalRows: 55,
          totalsComplete: true,
        },
      },
    ],
    ["missing bookings", { bookings: undefined }],
    ["missing exceptions", { undatedExceptions: undefined }],
  ])(
    "withholds every figure for malformed page DTO: %s",
    async (_name, patch) => {
      mock.reportRead = input => ({ ...pagedReport(input), ...patch });
      await render();
      expectWithheld();
      expect(mock.csv).not.toHaveBeenCalled();
    }
  );
  it.each(["duplicate", "too many", "too few", "null row"])(
    "rejects %s unified page rows before displaying totals",
    async fault => {
      mock.reportRead = input => {
        const result = pagedReport(input);
        if (fault === "duplicate")
          result.undatedExceptions[0] = result.bookings[0]!;
        if (fault === "too many") result.bookings.push(booking(99));
        if (fault === "too few") result.bookings.pop();
        if (fault === "null row") result.bookings[0] = null as any;
        return result;
      };
      await render();
      expectWithheld();
    }
  );
  it.each(["year", "month", "mode", "version"])(
    "withholds a later page after %s disagrees with the query boundary",
    async mismatch => {
      let bad = false;
      mock.reportRead = input => {
        const result = pagedReport(input);
        if (bad) {
          if (mismatch === "year") result.filters.year++;
          if (mismatch === "month") result.filters.month = 4;
          if (mismatch === "mode") result.sourceMode = "live";
        }
        return result;
      };
      if (mismatch === "version") {
        setLive();
        const read = mock.reportRead!;
        mock.reportRead = input => ({
          ...read(input),
          stateVersion: bad ? 7 : 8,
        });
      }
      await render();
      bad = true;
      await click("Next bookings");
      expectWithheld();
    }
  );
  it.each(["actor", "year", "month", "mode", "version", "unmount"])(
    "resets pages and selections after %s changes",
    async boundary => {
      enablePages();
      await render();
      await click("Next bookings");
      await click("Source values for SAMPLE-26");
      if (boundary === "actor") mock.user = { ...mock.user, id: 48 };
      if (boundary === "year") await change("Reporting year", "2027");
      if (boundary === "month") await change("Reporting month", "4");
      if (boundary === "mode") setLive();
      if (boundary === "version")
        mock.data["managementHq.status"].stateVersion++;
      if (boundary === "unmount") await act(async () => root.render(null));
      await render();
      expect(lastInput()).toEqual({
        year: boundary === "year" ? 2027 : 2026,
        ...(boundary === "month" ? { month: 4 } : {}),
      });
      expect(bookingRows()[0]?.textContent).toContain("SAMPLE-1");
      expect(container.querySelector("#hq-source-detail")).toBeNull();
    }
  );
  it.each([
    "actor",
    "revoked",
    "status-error",
    "configuration",
    "filter",
    "route",
    "unmount",
  ])("cannot reveal a late page response after %s changes", async boundary => {
    enablePages();
    await render();
    const pending = deferred();
    mock.queryWait["managementHq.report"] = pending.promise;
    await click("Next bookings");
    expectWithheld();
    if (boundary === "actor") mock.user = { ...mock.user, id: 48 };
    if (boundary === "revoked") mock.user = { ...mock.user, isActive: false };
    if (boundary === "status-error")
      mock.errors["managementHq.status"] = { data: { code: "FORBIDDEN" } };
    if (boundary === "configuration")
      Object.assign(mock.data["managementHq.status"], {
        sampleEnabled: false,
        reportMode: "disabled",
      });
    if (boundary === "filter") await change("Reporting month", "4");
    if (boundary === "route")
      await act(async () => {
        window.history.replaceState({}, "", "/super-admin");
      });
    if (boundary === "unmount") await act(async () => root.render(null));
    if (!["route", "unmount"].includes(boundary)) await render();
    await act(async () => pending.resolve());
    if (["actor", "filter"].includes(boundary)) {
      expect(lastInput().detailPage).toBeUndefined();
      expect(bookingRows()[0]?.textContent).toContain("SAMPLE-1");
      expect(container.textContent).not.toContain("SAMPLE-26");
    } else expectWithheld();
    expect(mock.csv).not.toHaveBeenCalled();
  });
  it("blocks detached navigation and duplicate clicks while a replay owns the action lock", async () => {
    enablePages();
    await render();
    const next = button("Next bookings");
    const pending = deferred();
    mock.mutationWait = pending.promise;
    await click("Replay sample cancellation");
    await act(async () => {
      next.click();
      next.click();
    });
    expect(lastInput()).toEqual({ year: 2026 });
    expectWithheld();
    await act(async () => pending.resolve());
    expect(lastInput()).toEqual({ year: 2026 });
    expect(bookingRows()[0]?.textContent).toContain("SAMPLE-1");
  });
  it("locks page navigation during a competing connection check", async () => {
    setLive();
    await render();
    const pending = deferred();
    mock.mutationWait = pending.promise;
    await click("Check Orbit connection");
    expect(button("Next bookings").disabled).toBe(true);
    await click("Next bookings");
    expect(lastInput()).toEqual({ year: 2026 });
    await act(async () => pending.resolve());
  });
  it("blocks navigation after route change without a component rerender", async () => {
    enablePages();
    await render();
    const next = button("Next bookings");
    await act(async () => {
      window.history.replaceState({}, "", "/super-admin");
      next.click();
    });
    expect(lastInput()).toEqual({ year: 2026 });
  });
  it.each([
    "incomplete totals",
    "wrong page size",
    "overbound total",
    "missing metadata",
  ])(
    "withholds all previously shown figures when a later page has %s",
    async fault => {
      mock.reportRead = input => {
        const result = pagedReport(input) as HqReport & { detailPage?: any };
        if (input.detailPage) {
          if (fault === "incomplete totals")
            result.detailPage.totalsComplete = false;
          if (fault === "wrong page size") result.detailPage.pageSize = 50;
          if (fault === "overbound total") result.detailPage.totalRows = 20001;
          if (fault === "missing metadata") delete result.detailPage;
        }
        return result;
      };
      await render();
      await click("Source values for SAMPLE-1");
      await click("Next bookings");
      expectWithheld();
      expect(mock.csv).not.toHaveBeenCalled();
    }
  );
  it("locks replay until the current page fetch is fresh, even if the query reports no fetching flag", async () => {
    enablePages();
    await render();
    const pending = deferred();
    mock.queryWait["managementHq.report"] = pending.promise;
    const next = button("Next bookings");
    await act(async () => {
      next.click();
      next.click();
    });
    expect(lastInput()).toEqual({ year: 2026, detailPage: 1 });
    expectWithheld();
    expect(button("Replay sample cancellation").disabled).toBe(true);
    await click("Replay sample cancellation");
    expect(mock.mutationCalls).toHaveLength(0);
    await act(async () => pending.resolve());
    expect(bookingRows()[0]?.textContent).toContain("SAMPLE-26");
    expect(button("Replay sample cancellation").disabled).toBe(false);
  });
  it("supports an empty bounded page without inventing rows or enabling CSV", async () => {
    enablePages(0);
    await render();
    expect(currentReport()).toBeTruthy();
    expect(container.textContent).toContain("0 records · Page 1 of 1");
    expect(container.textContent).toContain(
      "No retained records in this successfully loaded period"
    );
    expect(button("Next bookings").disabled).toBe(true);
    expect(button("Export all filtered records").disabled).toBe(true);
  });
});
