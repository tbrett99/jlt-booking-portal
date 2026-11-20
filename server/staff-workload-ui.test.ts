// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Window as HappyDOMWindow } from "happy-dom";
import type {
  StaffWorkRange,
  StaffWorkloadReport,
  StaffWorkloadDetails,
  StaffWorkloadDrillInput,
} from "../shared/staff-workload";
import {
  addWorkloadDays,
  parseWorkloadDate,
  validateWorkloadCustom,
  workloadCustomRange,
  workloadLondonToday,
  workloadMonday,
  workloadPresetRange,
} from "../client/src/lib/staff-workload-dates";

const mocks = vi.hoisted(() => ({
  role: "super_admin",
  authLoading: false,
  loading: false,
  fetching: false,
  error: null as null | { message: string },
  placeholder: false,
  detailsLoading: false,
  detailsFetching: false,
  detailsError: null as null | { message: string },
  detailsPlaceholder: false,
  summaryTransform: null as
    | null
    | ((report: StaffWorkloadReport) => StaffWorkloadReport),
  detailsTransform: null as
    | null
    | ((report: StaffWorkloadDetails) => StaffWorkloadDetails),
  queries: [] as { path: string; input: any; options: any }[],
  mutations: [] as string[],
  summaryRefetch: vi.fn(),
  detailsRefetch: vi.fn(),
  chartData: [] as any[],
  lines: [] as any[],
}));
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any =>
    new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useMutation")
            return () => {
              mocks.mutations.push(path);
              throw new Error(`Mutation forbidden: ${path}`);
            };
          if (key === "useQuery")
            return (input: any, options: any) => {
              mocks.queries.push({ path, input, options });
              if (path === "auth.me")
                return {
                  data: { role: mocks.role },
                  isLoading: mocks.authLoading,
                  error: null,
                };
              if (path === "superAdmin.workloadSummary") {
                const response = summary(input);
                return {
                  data: mocks.summaryTransform
                    ? mocks.summaryTransform(response)
                    : response,
                  isLoading: mocks.loading,
                  isFetching: mocks.fetching,
                  error: mocks.error,
                  isPlaceholderData: mocks.placeholder,
                  refetch: mocks.summaryRefetch,
                };
              }
              if (path === "superAdmin.workloadDetails") {
                const response = details(input);
                return {
                  data: mocks.detailsTransform
                    ? mocks.detailsTransform(response)
                    : response,
                  isLoading: mocks.detailsLoading,
                  isFetching: mocks.detailsFetching,
                  error: mocks.detailsError,
                  isPlaceholderData: mocks.detailsPlaceholder,
                  refetch: mocks.detailsRefetch,
                };
              }
              throw new Error(`Unexpected query ${path}`);
            };
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
  return { trpc: node() };
});
// Layout measurements do not exist in happy-dom; only Recharts' rendering is replaced.
// Controls, tables and the accessible Radix dialog are real DOM components.
vi.mock("recharts", async () => {
  const { createElement } = await import("react");
  return {
    ResponsiveContainer: ({ children }: any) =>
      createElement("div", null, children),
    LineChart: ({ data, children }: any) => {
      mocks.chartData = data;
      return createElement("div", { "data-testid": "daily-chart" }, children);
    },
    Line: (props: any) => {
      mocks.lines.push(props);
      return null;
    },
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});
vi.mock("wouter", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ href, children, ...props }: any) =>
      createElement("a", { href, ...props }, children),
  };
});
import StaffWorkloadReportView from "../client/src/components/StaffWorkloadReport";

const TODAY = "2026-11-20";
function summary(range: StaffWorkRange): StaffWorkloadReport {
  return {
    ...range,
    timezone: "Europe/London",
    asOf: "2026-11-20T15:00:00.000Z",
    historyTrackingReady: false,
    summaries: (["amendment", "flight", "reimbursement"] as const).map(
      (domain, index) => ({
        domain,
        received: index + 2,
        completed: index + 4,
        reprocessed: index + 1,
        paid: domain === "reimbursement" ? 2 : 0,
        rejected: 1,
        touched: 9,
        outstanding: 8,
        waiting: 3,
        unassigned: domain === "flight" ? null : 2,
        urgent: 1,
        overdueFollowUps: 2,
        oldestDays: 10,
        medianTurnaroundHours: 20,
        turnaroundSampleCount: 4,
      })
    ),
    daily: [
      { date: range.rangeStart, received: 9, completed: 15, reprocessed: 6 },
    ],
    staff: [
      {
        actorId: 7,
        actorName: "Test staff",
        amendmentsCompleted: 4,
        flightsCompleted: 5,
        reimbursementsProcessed: 6,
        reprocessed: 3,
        touched: 8,
        recordedPaid: 2,
      },
      {
        actorId: null,
        actorName: "Unknown actor",
        amendmentsCompleted: 2,
        flightsCompleted: 0,
        reimbursementsProcessed: 1,
        reprocessed: 1,
        touched: 1,
        recordedPaid: 1,
      },
    ],
    coverage: (["amendment", "flight", "reimbursement"] as const).map(
      domain => ({
        domain,
        earliestRecordedAction:
          domain === "flight" ? null : "2025-01-03T12:00:00.000Z",
        unknownCompletionDate: 3,
        unknownCompletionActor: 2,
        warnings: ["Older records have incomplete attribution."],
      })
    ),
    warnings: ["Unknown completion dates cannot be assigned to a period."],
  };
}
function details(input: StaffWorkloadDrillInput): StaffWorkloadDetails {
  const page = input.page ?? 1;
  return {
    page,
    pageSize: input.pageSize ?? 25,
    total: 26,
    asOf: "2026-11-20T16:00:00.000Z",
    warnings: ["Current status can differ from the recorded action."],
    rows: [
      {
        requestId: page === 1 ? 81 : 82,
        bookingId: 101,
        domain: input.domain,
        title: page === 1 ? "Test request first" : "Test request second page",
        clientName: "Test client",
        reference: "PTS-101",
        receivedAt: "2025-12-01T12:00:00.000Z",
        actionAt: "2026-11-18T14:00:00.000Z",
        actorId: input.actorId === null ? null : 7,
        actorName:
          input.actorId === null ? "Unknown actor" : "Actual action actor",
        currentStatus: "Waiting",
        eventLabel: "Completed",
        evidence: "recorded_history",
        isDeleted: false,
      },
      ...(page === 1
        ? [
            {
              requestId: 83,
              bookingId: 102,
              domain: input.domain,
              title: "Deleted booking context",
              clientName: null,
              reference: null,
              receivedAt: null,
              actionAt: null,
              actorId: null,
              actorName: "Unknown actor",
              currentStatus: "Deleted",
              eventLabel: "Legacy completion",
              evidence: "legacy_record" as const,
              isDeleted: true,
            },
          ]
        : []),
    ],
  };
}
let container: HTMLDivElement;
let root: Root;
const text = (element: Element | null = document.body) =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();
async function render() {
  await act(async () =>
    root.render(React.createElement(StaffWorkloadReportView))
  );
}
function button(label: string) {
  const result = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button")
  ).find(item => (item.getAttribute("aria-label") ?? text(item)) === label);
  expect(result, `button ${label}`).toBeTruthy();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function setInput(id: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(id)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const summaryCalls = () =>
  mocks.queries.filter(call => call.path === "superAdmin.workloadSummary");
const detailCalls = () =>
  mocks.queries.filter(call => call.path === "superAdmin.workloadDetails");
const lastSummary = () => summaryCalls().at(-1)!;
const lastDetail = () => detailCalls().at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TODAY + "T15:00:00.000Z"));
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden in offline DOM tests");
    })
  );
  const domWindow = window as unknown as HappyDOMWindow;
  domWindow.happyDOM.settings.disableJavaScriptFileLoading = true;
  domWindow.happyDOM.settings.disableCSSFileLoading = true;
  domWindow.happyDOM.settings.enableJavaScriptEvaluation = false;
  mocks.role = "super_admin";
  mocks.authLoading = false;
  mocks.loading = mocks.fetching = mocks.placeholder = false;
  mocks.error = null;
  mocks.detailsLoading =
    mocks.detailsFetching =
    mocks.detailsPlaceholder =
      false;
  mocks.detailsError = null;
  mocks.summaryTransform = mocks.detailsTransform = null;
  mocks.queries = [];
  mocks.mutations = [];
  mocks.chartData = [];
  mocks.lines = [];
  mocks.summaryRefetch.mockResolvedValue({ error: null });
  mocks.detailsRefetch.mockResolvedValue({ error: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(mocks.mutations).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
  expect(
    mocks.queries.every(call =>
      [
        "auth.me",
        "superAdmin.workloadSummary",
        "superAdmin.workloadDetails",
      ].includes(call.path)
    )
  ).toBe(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Workload calendar-only helpers", () => {
  it("uses London today at BST midnight and both DST changes independently of process timezone", () => {
    expect(workloadLondonToday(new Date("2026-06-01T23:30:00Z"))).toBe(
      "2026-06-02"
    );
    expect(workloadLondonToday(new Date("2026-03-29T00:30:00Z"))).toBe(
      "2026-03-29"
    );
    expect(workloadLondonToday(new Date("2026-03-29T23:30:00Z"))).toBe(
      "2026-03-30"
    );
    expect(workloadLondonToday(new Date("2026-10-25T00:30:00Z"))).toBe(
      "2026-10-25"
    );
    expect(workloadLondonToday(new Date("2026-10-25T23:30:00Z"))).toBe(
      "2026-10-25"
    );
    expect(addWorkloadDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addWorkloadDays("2026-10-25", 1)).toBe("2026-10-26");
  });
  it("handles Monday and Sunday presets, last week Mon–Sun, and month starts without future zeros", () => {
    expect(workloadMonday("2026-11-16")).toBe("2026-11-16");
    expect(workloadMonday("2026-11-22")).toBe("2026-11-16");
    expect(workloadPresetRange("thisWeek", "2026-11-16")).toEqual({
      rangeStart: "2026-11-16",
      rangeEnd: "2026-11-17",
    });
    expect(workloadPresetRange("thisWeek", "2026-11-22")).toEqual({
      rangeStart: "2026-11-16",
      rangeEnd: "2026-11-23",
    });
    expect(workloadPresetRange("lastWeek", "2026-11-22")).toEqual({
      rangeStart: "2026-11-09",
      rangeEnd: "2026-11-16",
    });
    expect(workloadPresetRange("thisMonth", "2026-11-20")).toEqual({
      rangeStart: "2026-11-01",
      rangeEnd: "2026-11-21",
    });
    expect(workloadPresetRange("today", TODAY)).toEqual({
      rangeStart: TODAY,
      rangeEnd: "2026-11-21",
    });
  });
  it("rejects impossible, missing, reversed, future and >366-day custom dates; accepts leap days and one day", () => {
    expect(parseWorkloadDate("2026-02-29")).toBeNull();
    expect(parseWorkloadDate("2024-02-29")).not.toBeNull();
    expect(parseWorkloadDate("2026-04-31")).toBeNull();
    expect(parseWorkloadDate("2026-13-01")).toBeNull();
    expect(validateWorkloadCustom("", TODAY, TODAY)).toMatch(/valid From/);
    expect(validateWorkloadCustom(TODAY, "2026-11-01", TODAY)).toMatch(
      /on or after/
    );
    expect(validateWorkloadCustom("2025-01-01", "2026-01-02", TODAY)).toMatch(
      /366 days/
    );
    expect(validateWorkloadCustom(TODAY, "2026-11-21", TODAY)).toMatch(
      /today or earlier/
    );
    expect(
      validateWorkloadCustom("2025-01-01", "2026-01-01", TODAY)
    ).toBeNull();
    expect(workloadCustomRange(TODAY, TODAY, TODAY)).toEqual({
      rangeStart: TODAY,
      rangeEnd: "2026-11-21",
    });
    expect(() => workloadCustomRange("2026-02-30", TODAY, TODAY)).toThrow(
      /valid From/
    );
  });
});

describe("Staff Workload real DOM with mocked tRPC, no network", () => {
  it("defaults to clipped this week and renders actual server totals, not completed plus repeat work", async () => {
    await render();
    expect(lastSummary().input).toEqual({
      rangeStart: "2026-11-16",
      rangeEnd: "2026-11-21",
    });
    expect(lastSummary().options).toMatchObject({
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
      retry: false,
      placeholderData: undefined,
    });
    expect(text()).toContain("So far, through today");
    const summaryText = text(
      document.querySelector('[aria-label="Workload summary"]')
    );
    expect(summaryText).toContain("Completed in period15");
    expect(summaryText).not.toContain("Completed in period21");
    expect(text()).toContain("Repeat work is a subset of completed requests");
    expect(text()).toContain("requests, not tickets");
    expect(text()).toContain("Not tracked");
    expect(document.querySelector("time")!.getAttribute("datetime")).toBe(
      "2026-11-20T15:00:00.000Z"
    );
    expect(mocks.chartData).toEqual(summary(lastSummary().input).daily);
    expect(mocks.lines.map(line => line.dataKey)).toEqual([
      "received",
      "completed",
    ]);
  });
  it("shows explicit All-work-type chart and staff table when domain summaries are filtered", async () => {
    await render();
    await click("Flights");
    const body = document.querySelector("#workload-breakdown tbody")!;
    expect(body.querySelectorAll("tr")).toHaveLength(1);
    expect(text(body)).toContain("Flights");
    expect(text()).toContain("Daily received vs completed · All work types");
    expect(text()).toContain(
      "this chart does not change with the work type filter"
    );
    expect(text()).toContain("Staff recorded activity · All work types");
    expect(mocks.chartData[0].received).toBe(9);
  });
  it("preserves controls and applies valid custom inclusive dates only on Apply", async () => {
    await render();
    await click("Today");
    expect(lastSummary().input).toEqual({
      rangeStart: TODAY,
      rangeEnd: "2026-11-21",
    });
    await click("Last week");
    expect(lastSummary().input).toEqual({
      rangeStart: "2026-11-09",
      rangeEnd: "2026-11-16",
    });
    await click("This month");
    expect(lastSummary().input.rangeStart).toBe("2026-11-01");
    const prior = lastSummary().input;
    await setInput("#workload-from", "2026-11-03");
    await setInput("#workload-to", "2026-11-05");
    expect(lastSummary().input).toEqual(prior);
    expect(text()).toContain("Draft dates not applied");
    await click("Apply custom dates");
    expect(lastSummary().input).toEqual({
      rangeStart: "2026-11-03",
      rangeEnd: "2026-11-06",
    });
    expect(text()).toContain("3 Nov 2026 – 5 Nov 2026 (inclusive)");
  });
  it("validates custom drafts without submitting invalid ranges or erasing applied controls", async () => {
    await render();
    const prior = lastSummary().input;
    await setInput("#workload-from", "2026-11-20");
    await setInput("#workload-to", "2026-11-01");
    await click("Apply custom dates");
    expect(text()).toContain("To must be on or after From");
    expect(lastSummary().input).toEqual(prior);
    await setInput("#workload-from", "");
    await click("Apply custom dates");
    expect(text()).toContain("Choose valid From");
    await setInput("#workload-from", "2025-01-01");
    await setInput("#workload-to", TODAY);
    await click("Apply custom dates");
    expect(text()).toContain("366 days");
    expect(lastSummary().input).toEqual(prior);
    expect(
      (document.querySelector("#workload-from") as HTMLInputElement).value
    ).toBe("2025-01-01");
  });
  it("reports incomplete history, earliest action and unknown dates/actors without fabricated history", async () => {
    await render();
    expect(text()).toContain(
      "History tracking update awaiting setup; existing historical report is still usable"
    );
    const coverage = document.querySelector("details")!;
    await act(async () => {
      coverage.open = true;
      coverage.dispatchEvent(new Event("toggle"));
    });
    expect(coverage.open).toBe(true);
    expect(text(coverage)).toContain(
      "3 completion dates unknown · 2 completion actors unknown"
    );
    expect(text(coverage)).toContain(
      "Flights · Earliest recorded action: Not recorded"
    );
    expect(text(coverage)).toContain("not the first-ever request");
    expect(text(coverage)).toContain(
      "Older records have incomplete attribution"
    );
  });
  it("separates PTS processing from recorded paid and sends exact all-staff domain metrics", async () => {
    await render();
    await click("Reimbursements: Processed in PTS (scheduled)");
    expect(lastDetail().input).toEqual({
      rangeStart: "2026-11-16",
      rangeEnd: "2026-11-21",
      domain: "reimbursement",
      metric: "completed",
      page: 1,
      pageSize: 25,
    });
    expect(Object.hasOwn(lastDetail().input, "actorId")).toBe(false);
    expect(text(document.querySelector('[role="dialog"]'))).toContain(
      "Processed in PTS (scheduled)"
    );
    await click("Close");
    await click("Reimbursements: Recorded paid");
    expect(lastDetail().input.metric).toBe("paid");
    expect(text(document.querySelector('[role="dialog"]'))).toContain(
      "not confirmation of bank settlement"
    );
    expect(lastDetail().options.placeholderData).toBeUndefined();
  });
  it("sends staff actorId exactly including null for unknown attribution", async () => {
    await render();
    await click("Test staff: Flights completed");
    expect(lastDetail().input).toMatchObject({
      actorId: 7,
      domain: "flight",
      metric: "completed",
    });
    await click("Close");
    await click("Unknown actor (attribution unknown): Amendments completed");
    expect(lastDetail().input).toMatchObject({
      actorId: null,
      domain: "amendment",
      metric: "completed",
    });
    expect(Object.hasOwn(lastDetail().input, "actorId")).toBe(true);
    expect(text(document.querySelector('[role="dialog"]'))).toContain(
      "attribution unknown"
    );
  });
  it("staff repeat-work aggregate asks for exact work type before querying, retaining actor", async () => {
    await render();
    await click("Test staff: Repeat work across all work types");
    expect(detailCalls()).toHaveLength(0);
    expect(text(document.querySelector('[role="dialog"]'))).toContain(
      "Choose a work type"
    );
    const flight = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
    ).find(item => text(item) === "Flights")!;
    await act(async () => flight.click());
    expect(lastDetail().input).toMatchObject({
      actorId: 7,
      domain: "flight",
      metric: "reprocessed",
      page: 1,
    });
  });
  it("shows requests touched and drills the exact staff/domain activity including unknown actors", async () => {
    await render();
    expect(text(document.querySelector("#workload-staff"))).toContain("Requests touched");
    expect(text()).toContain("several staff can touch the same request");
    for (const [name, actorId] of [["Test staff", 7], ["Unknown actor (attribution unknown)", null]] as const) {
      await click(`${name}: Requests touched across all work types`);
      const reimbursement = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(item => text(item) === "Reimbursements")!;
      await act(async () => reimbursement.click());
      expect(lastDetail().input).toMatchObject({ actorId, domain: "reimbursement", metric: "touched", page: 1 });
      await click("Close");
    }
  });
  it("renders request evidence, actual actor versus current status and deleted nonlinked context", async () => {
    await render();
    await click("Amendments: Completed in period");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(dialog.querySelector('a[href="/bookings/101"]')).toBeTruthy();
    expect(dialog.querySelector('a[href="/bookings/102"]')).toBeNull();
    expect(text(dialog)).toContain("Actual action actor");
    expect(text(dialog)).toContain("Waiting");
    expect(text(dialog)).toContain("Recorded history");
    expect(text(dialog)).toContain("Legacy record");
    expect(text(dialog)).toContain("Deleted context · link unavailable");
    expect(text(dialog)).toContain("1 Dec 2025");
    expect(text(dialog)).toContain("18 Nov 2026");
    expect(text(dialog)).toContain("Not recorded");
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("uses server pagination and resets drawer/paging on metric, domain and applied period changes", async () => {
    await render();
    await click("Amendments: Completed in period");
    expect(text(document.querySelector('[role="dialog"]'))).toContain(
      "Page 1 of 2"
    );
    expect(button("Previous requests").disabled).toBe(true);
    await click("Next requests");
    expect(lastDetail().input.page).toBe(2);
    expect(text(document.querySelector("#workload-requests"))).toContain(
      "second page"
    );
    expect(text(document.querySelector("#workload-requests"))).not.toContain(
      "first"
    );
    await click("Close");
    await click("Flights: Received in period");
    expect(lastDetail().input).toMatchObject({
      page: 1,
      domain: "flight",
      metric: "received",
    });
    // External period change through React (Radix correctly prevents outside mouse clicks).
    await act(async () => button("Today").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("Flights: Received in period");
    expect(lastDetail().input.rangeStart).toBe(TODAY);
    await act(async () => button("Reimbursements").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("shows a fresh queue total/asOf that need not match summary and handles an empty page", async () => {
    mocks.detailsTransform = report => ({ ...report, rows: [], total: 0 });
    await render();
    await click("Amendments: Outstanding now");
    expect(text(document.querySelector('[role="dialog"]'))).toContain(
      "0 matching requests · Fresh detail as of 20 Nov 2026, 16:00"
    );
    expect(text(document.querySelector('[role="dialog"]'))).toContain(
      "need not match the earlier count"
    );
    expect(text(document.querySelector("#workload-requests"))).toContain(
      "No recorded matches for these filters"
    );
    expect(button("Next requests").disabled).toBe(true);
  });
  it.each(["loading", "fetching", "error", "placeholder", "wrong-period"])(
    "withholds stale summary, chart/staff rows on %s and preserves controls",
    async state => {
      await render();
      if (state === "loading") mocks.loading = true;
      if (state === "fetching") mocks.fetching = true;
      if (state === "error") mocks.error = { message: "Server unavailable" };
      if (state === "placeholder") mocks.placeholder = true;
      if (state === "wrong-period")
        mocks.summaryTransform = report => ({
          ...report,
          rangeStart: "2020-01-01",
        });
      await render();
      expect(
        document.querySelector('[aria-label="Workload summary"]')
      ).toBeNull();
      expect(
        document.querySelector(
          "#workload-staff, #workload-breakdown, [data-testid=daily-chart]"
        )
      ).toBeNull();
      expect(document.querySelector("time")).toBeNull();
      expect(document.querySelector("#workload-from")).toBeTruthy();
      if (state === "error") {
        expect(text()).toContain("Counts are unavailable, not zero");
        await click("Retry report");
        expect(mocks.summaryRefetch).toHaveBeenCalledOnce();
      }
    }
  );
  it("withholds stale cached summary after a failed manual refresh even when the hook still retains data", async () => {
    await render();
    await click("Amendments: Completed in period");
    mocks.summaryRefetch.mockRejectedValueOnce(new Error("Offline failure"));
    await act(async () => button("Refresh report").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("#workload-staff")).toBeNull();
    expect(text()).toContain("Counts are unavailable, not zero");
    await click("Retry report");
    expect(document.querySelector("#workload-staff")).toBeTruthy();
  });
  it("withholds first-page rows while the next server page loads, including a stale page response", async () => {
    await render();
    await click("Flights: Completed in period");
    mocks.detailsFetching = true;
    await click("Next requests");
    expect(lastDetail().input.page).toBe(2);
    expect(document.querySelector("#workload-requests")).toBeNull();
    expect(text(document.querySelector('[role="dialog"]'))).not.toContain(
      "Test request first"
    );
    mocks.detailsFetching = false;
    mocks.detailsTransform = report => ({ ...report, page: 1 });
    await render();
    expect(document.querySelector("#workload-requests")).toBeNull();
    mocks.detailsTransform = null;
    await render();
    expect(text(document.querySelector("#workload-requests"))).toContain(
      "second page"
    );
  });
  it.each(["loading", "fetching", "error", "placeholder", "wrong-page"])(
    "withholds previous request rows/totals during %s",
    async state => {
      await render();
      await click("Flights: Completed in period");
      if (state === "loading") mocks.detailsLoading = true;
      if (state === "fetching") mocks.detailsFetching = true;
      if (state === "error") mocks.detailsError = { message: "Unavailable" };
      if (state === "placeholder") mocks.detailsPlaceholder = true;
      if (state === "wrong-page")
        mocks.detailsTransform = report => ({ ...report, page: 9 });
      await render();
      expect(document.querySelector("#workload-requests")).toBeNull();
      expect(text(document.querySelector('[role="dialog"]'))).not.toContain(
        "26 matching requests"
      );
      if (state === "error") {
        await click("Retry requests");
        expect(mocks.detailsRefetch).toHaveBeenCalledOnce();
      }
    }
  );
  it("withholds retained detail cache after failed refresh, then explicit retry restores success", async () => {
    await render();
    await click("Flights: Completed in period");
    mocks.detailsRefetch.mockResolvedValueOnce({
      error: { message: "No database" },
    });
    await click("Refresh requests");
    expect(document.querySelector("#workload-requests")).toBeNull();
    expect(text(document.querySelector('[role="dialog"]'))).toContain(
      "Previous rows and totals are withheld"
    );
    await click("Retry requests");
    expect(document.querySelector("#workload-requests")).toBeTruthy();
  });
  it("distinguishes successful empty staff/daily data from an error without inferring no work", async () => {
    mocks.summaryTransform = report => ({ ...report, staff: [], daily: [] });
    await render();
    expect(text()).toContain("No recorded staff activity in this period");
    expect(text()).toContain("does not establish that no work occurred");
    expect(text()).toContain("No daily activity returned");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it.each(["admin", "staff", "agent", "instructor", "engagement"])(
    "does not mount workload query or controls for %s",
    async role => {
      mocks.role = role;
      await render();
      expect(summaryCalls()).toHaveLength(0);
      expect(detailCalls()).toHaveLength(0);
      expect(text()).toBe(
        "Workload & Productivity is available to Super Admins only."
      );
      expect(document.querySelector("input, table, time")).toBeNull();
    }
  );
  it("waits for identity before mounting any workload data query", async () => {
    mocks.authLoading = true;
    await render();
    expect(text()).toBe("Checking access…");
    expect(summaryCalls()).toHaveLength(0);
    mocks.authLoading = false;
    await render();
    expect(summaryCalls()).not.toHaveLength(0);
  });
});
