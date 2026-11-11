// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addForecastDays,
  defaultCommissionForecastPeriod,
  forecastMonday,
  forecastUtcDate,
  formatForecastCalendarDate,
  parseForecastCalendarDate,
  type CommissionForecastBucket,
  type CommissionForecastFile,
  type CommissionForecastInput,
  type CommissionForecastResponse,
} from "../shared/commission-workload-forecast";

const mocks = vi.hoisted(() => ({
  role: "admin",
  authLoading: false,
  isFetching: false,
  isLoading: false,
  error: null as null | { message: string },
  transform: null as
    | null
    | ((response: CommissionForecastResponse) => CommissionForecastResponse),
  queries: [] as {
    path: string;
    input: CommissionForecastInput | undefined;
    options: any;
  }[],
  mutationHooks: [] as string[],
  refetch: vi.fn(),
  chartData: [] as any[],
  axis: {} as any,
}));

vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any =>
    new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useMutation")
            return () => {
              mocks.mutationHooks.push(path);
              throw new Error(`Mutation hook forbidden: ${path}`);
            };
          if (key === "useQuery")
            return (
              input: CommissionForecastInput | undefined,
              options: any
            ) => {
              mocks.queries.push({ path, input, options });
              if (path === "auth.me")
                return {
                  data: { role: mocks.role },
                  isLoading: mocks.authLoading,
                };
              if (path !== "commissionDue.forecast")
                throw new Error(`Unexpected query: ${path}`);
              const response = syntheticForecast(input!);
              return {
                data: mocks.transform ? mocks.transform(response) : response,
                isLoading: mocks.isLoading,
                isFetching: mocks.isFetching,
                error: mocks.error,
                refetch: mocks.refetch,
              };
            };
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
  return { trpc: node() };
});
vi.mock("wouter", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ href, children, ...props }: any) =>
      createElement("a", { href, ...props }, children),
  };
});
// Recharts needs layout measurements unavailable in happy-dom. Keep its actual data,
// axis options and Bar click handler observable; the real period controls/table are not mocked.
vi.mock("recharts", async () => {
  const { createElement, createContext, useContext } = await import("react");
  const ChartContext = createContext<any[]>([]);
  return {
    ResponsiveContainer: ({ children }: any) =>
      createElement("div", null, children),
    BarChart: ({ data, children }: any) => {
      mocks.chartData = data;
      return createElement(
        ChartContext.Provider,
        { value: data },
        createElement("div", { "data-testid": "chart" }, children)
      );
    },
    Bar: ({ onClick }: any) => {
      const data = useContext(ChartContext);
      return createElement(
        "div",
        null,
        data.map((entry, index) =>
          createElement(
            "button",
            {
              key: entry.key,
              "data-chart-index": index,
              onClick: () => onClick(entry),
              "aria-label": `Synthetic chart bar ${index}`,
            },
            String(entry.fileCount)
          )
        )
      );
    },
    YAxis: (props: any) => {
      mocks.axis = props;
      return null;
    },
    XAxis: () => null,
    Tooltip: () => null,
    Cell: () => null,
    CartesianGrid: () => null,
  };
});

import CommissionWorkloadForecast from "../client/src/pages/admin/CommissionWorkloadForecast";

const TODAY = "2026-11-11";
const initialPeriod = () =>
  defaultCommissionForecastPeriod(new Date(TODAY + "T15:00:00.000Z"));
function file(
  bookingId: number,
  patch: Partial<CommissionForecastFile> = {}
): CommissionForecastFile {
  return {
    bookingId,
    clientName: `Synthetic client ${bookingId}`,
    agentId: 71,
    agentName: "Synthetic agent",
    ptsRef: `PTS-${bookingId}`,
    orbitRef: `ORBIT-${bookingId}`,
    stage: "Added to PTS",
    finalSupplierPaymentDate: "2026-11-12",
    departureDate: "2026-11-11",
    reviewDate: "2026-11-12",
    preAuthorised: false,
    inContract: false,
    hasOutstandingRefund: false,
    hasOutstandingAmendment: false,
    hasOutstandingReimbursement: false,
    unscheduledReason: null,
    bucketKey: null,
    category: "upcoming",
    ...patch,
  };
}
function syntheticFiles() {
  return [
    file(101, {
      clientName: "Current future client",
      inContract: true,
      hasOutstandingRefund: true,
      hasOutstandingAmendment: true,
      hasOutstandingReimbursement: true,
    }),
    file(102, {
      clientName: "Pre-authorised client",
      preAuthorised: true,
      finalSupplierPaymentDate: "2026-11-10",
      departureDate: TODAY,
      reviewDate: "2026-11-18",
    }),
    file(103, {
      reviewDate: "2026-11-19",
      finalSupplierPaymentDate: "2026-11-19",
    }),
    file(104, {
      reviewDate: "2026-11-20",
      finalSupplierPaymentDate: "2026-11-20",
    }),
    file(201, {
      clientName: "Overdue backlog client",
      category: "due_now",
      reviewDate: "2026-11-10",
      finalSupplierPaymentDate: "2026-11-10",
    }),
    file(202, {
      clientName: "Due today client",
      category: "due_now",
      reviewDate: TODAY,
      finalSupplierPaymentDate: TODAY,
    }),
    file(301, {
      clientName: "Missing payment client",
      category: "unscheduled",
      finalSupplierPaymentDate: null,
      reviewDate: null,
      unscheduledReason: "missing_payment_date",
    }),
    file(302, {
      clientName: "Missing departure client",
      category: "unscheduled",
      preAuthorised: true,
      departureDate: null,
      reviewDate: null,
      unscheduledReason: "missing_departure_date",
    }),
    file(303, {
      clientName: "Invalid payment client",
      category: "unscheduled",
      finalSupplierPaymentDate: "invalid",
      reviewDate: null,
      unscheduledReason: "invalid_payment_date",
    }),
    file(304, {
      clientName: "Invalid departure client",
      category: "unscheduled",
      preAuthorised: true,
      departureDate: "invalid",
      reviewDate: null,
      unscheduledReason: "invalid_departure_date",
    }),
    file(401, {
      clientName: "Outside range client",
      reviewDate: addForecastDays(initialPeriod().endDate, 200),
      finalSupplierPaymentDate: addForecastDays(initialPeriod().endDate, 200),
    }),
  ];
}
function syntheticForecast(
  period: CommissionForecastInput
): CommissionForecastResponse {
  const buckets: CommissionForecastBucket[] = [];
  let cursor =
    period.groupBy === "week"
      ? forecastMonday(period.startDate)
      : period.startDate.slice(0, 7) + "-01";
  while (cursor <= period.endDate) {
    const start = parseForecastCalendarDate(cursor)!;
    const next =
      period.groupBy === "week"
        ? addForecastDays(cursor, 7)
        : forecastUtcDate(
            new Date(
              Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
            )
          );
    buckets.push({
      key: cursor,
      startDate: cursor < period.startDate ? period.startDate : cursor,
      endDate:
        addForecastDays(next, -1) > period.endDate
          ? period.endDate
          : addForecastDays(next, -1),
      label: "Synthetic calendar period",
      fileCount: 0,
      preAuthorisedCount: 0,
      attentionCount: 0,
    });
    cursor = next;
  }
  const files = syntheticFiles();
  for (const entry of files) {
    if (entry.category !== "upcoming") continue;
    const bucket = buckets.find(
      item =>
        entry.reviewDate! >= item.startDate && entry.reviewDate! <= item.endDate
    );
    if (!bucket) continue;
    entry.bucketKey = bucket.key;
    bucket.fileCount++;
    if (entry.preAuthorised) bucket.preAuthorisedCount++;
    if (
      entry.inContract ||
      entry.hasOutstandingRefund ||
      entry.hasOutstandingAmendment ||
      entry.hasOutstandingReimbursement
    )
      bucket.attentionCount++;
  }
  return {
    asOf: "2026-11-11T15:00:00.000Z",
    today: TODAY,
    period,
    buckets,
    files,
    upcomingCount: files.filter(
      entry => entry.category === "upcoming" && entry.bucketKey
    ).length,
    dueNowCount: 2,
    unscheduledCount: 4,
    outsideRangeCount: files.filter(
      entry => entry.category === "upcoming" && !entry.bucketKey
    ).length,
  };
}

let root: Root;
let container: HTMLDivElement;
const text = (element: Element | null = container) =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();
async function render() {
  await act(async () =>
    root.render(React.createElement(CommissionWorkloadForecast))
  );
}
function button(label: string) {
  const result = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).find(item => (item.getAttribute("aria-label") ?? text(item)) === label);
  expect(result, `button ${label}`).toBeTruthy();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function setInput(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(id)!;
  expect(input).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const forecastCalls = () =>
  mocks.queries.filter(query => query.path === "commissionDue.forecast");
const lastCall = () => forecastCalls().at(-1)!;
const summary = (label: string) =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Workload summary"] button'
    )
  ).find(item => text(item).startsWith(label))!;
const periods = () =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Select forecast period"] button'
    )
  );
const rows = () =>
  Array.from(container.querySelectorAll("#forecast-files tbody tr"));
async function clickPeriod(index: number) {
  await act(async () => periods()[index].click());
}
async function clickSummary(label: string) {
  await act(async () => summary(label).click());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TODAY + "T15:00:00.000Z"));
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden in synthetic UI tests");
    })
  );
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  mocks.role = "admin";
  mocks.authLoading = false;
  mocks.isFetching = false;
  mocks.isLoading = false;
  mocks.error = null;
  mocks.transform = null;
  mocks.queries = [];
  mocks.mutationHooks = [];
  mocks.chartData = [];
  mocks.axis = {};
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(mocks.mutationHooks).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
  expect(
    mocks.queries.every(query =>
      ["auth.me", "commissionDue.forecast"].includes(query.path)
    )
  ).toBe(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Commission Due Forecast actual DOM with synthetic data", () => {
  it("defaults to the supplied 12-week helper with fresh query settings and a compact workload-only title", async () => {
    await render();
    expect(text(container.querySelector("h1"))).toBe("Commission Due Forecast");
    expect(container.querySelector("h1")!.classList.contains("text-xl")).toBe(
      true
    );
    expect(text()).toContain("Files to check");
    expect(text()).toContain("not a cashflow or payout forecast");
    expect(lastCall().input).toEqual(initialPeriod());
    expect(Object.keys(lastCall().input!)).toEqual([
      "startDate",
      "endDate",
      "groupBy",
    ]);
    expect(lastCall().options).toMatchObject({
      enabled: true,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
    });
    expect(periods()).toHaveLength(12);
    expect(mocks.chartData.map(entry => entry.fileCount)).toEqual([
      1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(mocks.axis.allowDecimals).toBe(false);
    expect(mocks.axis.domain).toEqual([0, 3]);
    expect(summary("Due now").querySelector("strong")!.textContent).toBe("2");
    expect(
      summary("Future arrivals").querySelector("strong")!.textContent
    ).toBe("4");
    expect(summary("Unscheduled").querySelector("strong")!.textContent).toBe(
      "4"
    );
    expect(summary("Busiest").querySelector("strong")!.textContent).toBe("3");
    expect(text()).toContain("1 scheduled future files outside");
    const asOf = container.querySelector("time")!;
    expect(asOf.getAttribute("datetime")).toBe("2026-11-11T15:00:00.000Z");
    expect(text(asOf)).toBe(
      new Date(asOf.getAttribute("datetime")!).toLocaleString("en-GB")
    );
    expect(text()).toContain(
      `${Intl.DateTimeFormat().resolvedOptions().timeZone}, local time`
    );
  });

  it("selects chart bars and accessible period buttons, links client/booking rows, and shows effective pre-authorised dates", async () => {
    await render();
    expect(rows()).toHaveLength(3);
    expect(container.querySelector('a[href="/bookings/102"]')).toBeTruthy();
    const preauth = rows().find(row =>
      text(row).includes("Pre-authorised client")
    )!;
    expect(text(preauth)).toContain("10 Nov 2026");
    expect(text(preauth)).toContain("18 Nov 2026");
    expect(text(preauth)).toContain(
      "later of final supplier payment and departure + 7 days (18 Nov 2026)"
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-chart-index="0"]')!
        .click()
    );
    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])).toContain("Current future client");
    expect(periods()[0].getAttribute("aria-pressed")).toBe("true");
    expect(text(rows()[0])).toContain("In Contract");
    expect(text(rows()[0])).toContain("Outstanding refund");
    expect(text(rows()[0])).toContain("Outstanding amendment");
    expect(text(rows()[0])).toContain("Outstanding reimbursement");
    expect(text(periods()[0])).toContain("11 Nov 2026 – 15 Nov 2026");
    expect(text(periods()[0])).toContain(
      "Remaining period · after 11 Nov 2026"
    );
    expect(text()).toContain("not a full-period comparison");
    await clickPeriod(2);
    expect(text(periods()[2])).toContain("0 new files");
    expect(text(rows()[0])).toBe(
      "No files in this selected period or category."
    );
    expect(text()).toContain("Quietest periods: 0 new files");
    expect(text()).not.toContain("All clear");
  });

  it("drills into response due-now and unscheduled categories without mixing them into future buckets", async () => {
    await render();
    await clickSummary("Due now");
    expect(rows()).toHaveLength(2);
    expect(text(rows()[0])).toContain("Overdue backlog client");
    expect(text(rows()[1])).toContain("Due today client");
    expect(container.querySelector('a[href="/commission-due"]')).toBeTruthy();
    expect(text(container.querySelector("#forecast-files"))).not.toContain(
      "Missing payment client"
    );
    await clickSummary("Unscheduled");
    expect(rows()).toHaveLength(4);
    expect(
      text(rows().find(row => text(row).includes("Missing payment client"))!)
    ).toContain("Missing final supplier payment date");
    expect(
      text(rows().find(row => text(row).includes("Missing departure client"))!)
    ).toContain("Missing departure date for pre-authorised review");
    expect(
      text(rows().find(row => text(row).includes("Invalid payment client"))!)
    ).toContain("Invalid final supplier payment date");
    expect(
      text(rows().find(row => text(row).includes("Invalid departure client"))!)
    ).toContain("Invalid departure date for pre-authorised review");
    expect(text()).toContain(
      "Missing or invalid required dates are unscheduled, not zero workload"
    );
    await clickSummary("Future arrivals");
    expect(rows()).toHaveLength(4);
    expect(text(container.querySelector("#forecast-files"))).not.toMatch(
      /Due today client|Overdue backlog client|Outside range client/
    );
  });

  it("offers the actual UTC Calendar, six calendar months, weekly/monthly grouping and clipped custom dates via Apply", async () => {
    await render();
    await click("Choose start date on calendar");
    expect(document.querySelector('[data-slot="calendar"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="calendar"] table')).toBeTruthy();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    await click("Next 6 months");
    expect(lastCall().input).toEqual({
      startDate: TODAY,
      endDate: "2027-04-30",
      groupBy: "month",
    });
    expect(periods()).toHaveLength(6);
    expect(button("Monthly").getAttribute("aria-pressed")).toBe("true");
    await click("Weekly");
    expect(lastCall().input!.groupBy).toBe("week");
    await click("Next 12 weeks");
    expect(lastCall().input).toEqual(initialPeriod());
    const applied = lastCall().input;
    await setInput("#forecast-start", "2026-11-13");
    await setInput("#forecast-end", "2026-11-17");
    expect(lastCall().input).toBe(applied);
    expect(text()).toContain("Dates not applied");
    await click("Apply");
    expect(lastCall().input).toEqual({
      startDate: "2026-11-13",
      endDate: "2026-11-17",
      groupBy: "week",
    });
    expect(periods()).toHaveLength(2);
    expect(text(periods()[0])).toContain("13 Nov 2026 – 15 Nov 2026");
    expect(text(periods()[1])).toContain("16 Nov 2026 – 17 Nov 2026");
    expect(mocks.chartData[1].chartLabel).toBe("16 Nov–17 Nov");
  });

  it("never sends invalid drafts; rejects reversed, missing and over-730-day ranges while retaining valid input", async () => {
    await render();
    const validInput = lastCall().input;
    await setInput("#forecast-start", "2027-12-31");
    expect(text()).toContain("Start date must be on or before end date");
    expect(lastCall().options.enabled).toBe(false);
    expect(lastCall().input).toBe(validInput);
    expect(button("Apply").disabled).toBe(true);
    expect(button("Refresh").disabled).toBe(true);
    expect(
      container.querySelector('[aria-label="Workload summary"]')
    ).toBeNull();
    await setInput("#forecast-start", "");
    expect(text()).toContain("Choose valid start and end dates");
    expect(lastCall().options.enabled).toBe(false);
    await setInput("#forecast-start", TODAY);
    await setInput("#forecast-end", addForecastDays(TODAY, 730));
    expect(text()).toContain("no more than 730 days");
    expect(lastCall().options.enabled).toBe(false);
    await setInput("#forecast-end", addForecastDays(TODAY, 729));
    expect(button("Apply").disabled).toBe(false);
    await click("Apply");
    expect(lastCall().input).toEqual({
      startDate: TODAY,
      endDate: addForecastDays(TODAY, 729),
      groupBy: "week",
    });
    expect(lastCall().options.enabled).toBe(true);
    for (const call of forecastCalls().filter(query => query.options.enabled)) {
      const input = call.input!;
      expect(parseForecastCalendarDate(input.startDate)).not.toBeNull();
      expect(parseForecastCalendarDate(input.endDate)).not.toBeNull();
      expect(input.startDate <= input.endDate).toBe(true);
      expect(
        (parseForecastCalendarDate(input.endDate)!.getTime() -
          parseForecastCalendarDate(input.startDate)!.getTime()) /
          86_400_000
      ).toBeLessThan(730);
    }
  });

  it("accepts a single day and keeps selected period plus memoized query input stable through search and refetch", async () => {
    await render();
    await clickPeriod(0);
    const input = lastCall().input;
    await setInput('[aria-label="Search selected files"]', "orBit-101");
    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])).toContain("Current future client");
    expect(lastCall().input).toBe(input);
    await click("Refresh");
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    mocks.isFetching = true;
    await render();
    expect(container.querySelector("#forecast-files")).toBeNull();
    mocks.isFetching = false;
    await render();
    expect(periods()[0].getAttribute("aria-pressed")).toBe("true");
    expect(lastCall().input).toBe(input);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Search selected files"]'
      )!.value
    ).toBe("orBit-101");
    await setInput("#forecast-start", TODAY);
    await setInput("#forecast-end", TODAY);
    await click("Apply");
    expect(lastCall().options.enabled).toBe(true);
    expect(periods()).toHaveLength(1);
    expect(mocks.chartData[0].fileCount).toBe(0);
  });

  it.each(["Current future", "Synthetic agent", "PTS-101", "101"])(
    "searches client, agent, reference or booking ID %s without refetching its input",
    async needle => {
      await render();
      await clickPeriod(0);
      const input = lastCall().input;
      await setInput('[aria-label="Search selected files"]', needle);
      expect(rows()).toHaveLength(1);
      expect(container.querySelector('a[href="/bookings/101"]')).toBeTruthy();
      expect(lastCall().input).toBe(input);
      expect(mocks.refetch).not.toHaveBeenCalled();
    }
  );

  it.each(["fetching", "loading", "error", "different-range"])(
    "withholds stale counters, chart and files during %s instead of showing zero/all clear",
    async state => {
      await render();
      if (state === "fetching") mocks.isFetching = true;
      if (state === "loading") mocks.isLoading = true;
      if (state === "error") mocks.error = { message: "INTERNAL_SERVER_ERROR" };
      if (state === "different-range")
        mocks.transform = response => ({
          ...response,
          period: { ...response.period, startDate: "2020-01-01" },
        });
      await render();
      expect(
        container.querySelector('[aria-label="Workload summary"]')
      ).toBeNull();
      expect(container.querySelector('[data-testid="chart"]')).toBeNull();
      expect(container.querySelector("#forecast-files")).toBeNull();
      expect(container.querySelector("time")).toBeNull();
      expect(text()).not.toMatch(/All clear|0 new files|Quietest periods/);
      if (state === "error") {
        expect(text(container.querySelector('[role="alert"]'))).toContain(
          "Unable to load forecast. Counts are unavailable"
        );
        await click("Refresh");
        expect(mocks.refetch).toHaveBeenCalledTimes(1);
      } else if (state === "fetching" || state === "loading") {
        expect(text(container.querySelector('[role="status"]'))).toContain(
          "Counts and files are withheld"
        );
      }
    }
  );

  it("renders all zero future buckets honestly while retaining non-zero backlog/unknown counts", async () => {
    mocks.transform = response => ({
      ...response,
      upcomingCount: 0,
      files: response.files.filter(entry => entry.category !== "upcoming"),
      buckets: response.buckets.map(bucket => ({
        ...bucket,
        fileCount: 0,
        preAuthorisedCount: 0,
        attentionCount: 0,
      })),
    });
    await render();
    expect(mocks.chartData).toHaveLength(12);
    expect(mocks.chartData.every(bucket => bucket.fileCount === 0)).toBe(true);
    expect(mocks.axis.domain).toEqual([0, 1]);
    expect(
      summary("Future arrivals").querySelector("strong")!.textContent
    ).toBe("0");
    expect(summary("Due now").querySelector("strong")!.textContent).toBe("2");
    expect(summary("Unscheduled").querySelector("strong")!.textContent).toBe(
      "4"
    );
    expect(text()).toContain("All periods have the same count");
    expect(text()).not.toContain("All clear");
  });

  it("pages 50 selected rows without expanding a giant file list and resets paging on a new category", async () => {
    mocks.transform = response => {
      const bucket = response.buckets[1];
      const files = Array.from({ length: 105 }, (_, index) =>
        file(1000 + index, {
          reviewDate: "2026-11-18",
          finalSupplierPaymentDate: "2026-11-18",
          bucketKey: bucket.key,
        })
      );
      return {
        ...response,
        files: [
          ...response.files.filter(entry => entry.category !== "upcoming"),
          ...files,
        ],
        upcomingCount: 105,
        buckets: response.buckets.map(entry => ({
          ...entry,
          fileCount: entry.key === bucket.key ? 105 : 0,
        })),
      };
    };
    await render();
    expect(rows()).toHaveLength(50);
    expect(text()).toContain("Page 1 of 3");
    expect(button("Previous").disabled).toBe(true);
    await click("Next");
    expect(rows()).toHaveLength(50);
    expect(container.querySelector('a[href="/bookings/1050"]')).toBeTruthy();
    await click("Next");
    expect(rows()).toHaveLength(5);
    expect(button("Next").disabled).toBe(true);
    await clickSummary("Due now");
    expect(rows()).toHaveLength(2);
    expect(text()).toContain("Page 1 of 1");
  });

  it.each(["agent", "instructor", "engagement", "staff"])(
    "withholds all forecast access for %s users",
    async role => {
      mocks.role = role;
      await render();
      expect(lastCall().options.enabled).toBe(false);
      expect(text()).toBe(
        "Commission Due Forecast is available to administrators only."
      );
      expect(container.querySelector("input, table, time")).toBeNull();
      expect(mocks.refetch).not.toHaveBeenCalled();
    }
  );

  it("allows super administrators but does not enable forecast while auth is loading", async () => {
    mocks.role = "super_admin";
    mocks.authLoading = true;
    await render();
    expect(text()).toBe("Checking access…");
    expect(lastCall().options.enabled).toBe(false);
    mocks.authLoading = false;
    await render();
    expect(lastCall().options.enabled).toBe(true);
    expect(periods()).toHaveLength(12);
  });

  it("is read-only, has no payment or pre-authorisation controls, and states only the handoff-stage exclusion", async () => {
    await render();
    expect(text()).toContain(
      "Only files in Added to PTS or Commission Ready for Review are included"
    );
    expect(text()).toContain("Personal £0 files still need review");
    expect(text()).toContain("review warnings, not exclusions");
    expect(text()).toContain(
      "New bookings, date moves and stage changes can change this forecast"
    );
    const headers = Array.from(
      container.querySelectorAll("#forecast-files th")
    ).map(item => text(item));
    expect(headers).toEqual([
      "Booking / client",
      "Agent",
      "Orbit / PTS",
      "Final supplier payment",
      "Review date / reason",
      "Review warnings",
    ]);
    expect(
      Array.from(container.querySelectorAll("button"))
        .map(item => text(item))
        .join(" ")
    ).not.toMatch(/Pay|Claim|Pre-authorise|Move Date|Export|Save/);
    expect(
      container.querySelector(
        'input[type="checkbox"], input[type="number"], textarea'
      )
    ).toBeNull();
    expect(text()).not.toMatch(
      /bank account|sort code|customer email|cash due|expected commission/i
    );
    expect(mocks.mutationHooks).toEqual([]);
  });
});
