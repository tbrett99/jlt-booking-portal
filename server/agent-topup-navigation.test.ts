import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  bookingId: "101",
  bookings: [] as any[],
  booking: undefined as any,
  requests: [] as any[],
  missingDocs: [] as any[],
  flightRequests: [] as any[],
  topUpError: false,
  bookingLoading: false,
  mutate: vi.fn(),
  topUpQuery: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 10, name: "Synthetic Agent", role: "agent" } }),
}));
vi.mock("@/components/CompetitionsWidget", () => ({ CompetitionsWidget: () => null }));
vi.mock("@/components/FlightRequestForm", () => ({ FlightRequestForm: () => null }));
vi.mock("wouter", async () => {
  const React = await import("react");
  return {
    useParams: () => ({ id: state.bookingId }),
    Link: ({ href, children, ...props }: any) => React.createElement("a", { href, ...props }, children),
  };
});
vi.mock("@/lib/trpc", () => {
  const query = (data: unknown, extra = {}) => ({ data, isLoading: false, isError: false, refetch: vi.fn(), ...extra });
  const node = (path = ""): unknown => new Proxy({}, {
    get: (_target, key: string) => {
      if (key === "useUtils") return () => node();
      if (key === "invalidate") return vi.fn();
      if (key === "useMutation") return () => ({ mutate: state.mutate, mutateAsync: state.mutate, isPending: false });
      if (key === "useQuery") return (...args: unknown[]) => {
        if (path === "commissionClaims.myTopUpRequests") {
          state.topUpQuery(...args);
          return query(state.requests, { isError: state.topUpError });
        }
        if (path === "bookings.myBookings") return query(state.bookings);
        if (path === "bookings.byId") return query(state.booking, { isLoading: state.bookingLoading });
        if (path === "reimbursements.myBookingsWithMissingDocs") return query(state.missingDocs);
        if (path === "flightRequests.myRequests") return query(state.flightRequests);
        if (path === "crm.agentCrm.getMyProfile" || path === "reimbursements.agentOutstandingSummary") return query(undefined);
        return query([]);
      };
      return node(path ? `${path}.${key}` : key);
    },
  });
  return { trpc: node() };
});

import AgentDashboard from "../client/src/pages/agent/AgentDashboard";
import AgentBookingDetail from "../client/src/pages/agent/AgentBookingDetail";
import AgentBookings from "../client/src/pages/agent/AgentBookings";

function booking(id: number, currentStage = "Commission Due for Payment") {
  return { id, clientName: `Synthetic Traveller ${id}`, currentStage, departureDate: new Date("2027-01-01T00:00:00Z"), expectedCommission: "20.00", ptsRef: "SYNTHETIC-PTS", topdogRef: "SYNTHETIC-TD" };
}
function request(id: number, amount: unknown = 12345) {
  return { id, bookingId: id, status: "top_up_required", topUpAmountPence: amount, booking: booking(id) };
}
function render(Page: React.ComponentType) {
  const window = new Window();
  window.document.body.innerHTML = renderToStaticMarkup(React.createElement(Page));
  return window.document;
}
function notice(document: ReturnType<typeof render>, prefix: string) {
  return document.querySelector(`section[aria-labelledby="${prefix}-top-up-heading"]`);
}
function assertSmallLink(link: Element | null) {
  expect(link).not.toBeNull();
  expect(link?.tagName).toBe("A");
  expect(link?.getAttribute("data-slot")).toBe("button");
  expect(link?.classList.contains("h-8")).toBe(true);
  expect(link?.classList.contains("w-full")).toBe(false);
  expect(link?.querySelector("button")).toBeNull();
  expect(link?.parentElement?.closest("button")).toBeNull();
}
function assertSummaryLink(document: ReturnType<typeof render>, count: number) {
  const links = document.querySelectorAll('a[href="/commissions?tab=top-up"]');
  expect(links).toHaveLength(1);
  const link = links[0];
  assertSmallLink(link);
  expect(link?.textContent?.trim()).toBe(`Confirm a top-up (${count})`);
  expect(link?.getAttribute("aria-label")).toBe(`Confirm a top-up — ${count} open request${count === 1 ? "" : "s"}`);
  expect(link?.classList.contains("border")).toBe(true);
  expect(link?.classList.contains("bg-transparent")).toBe(true);
  const attentionHeading = Array.from(document.querySelectorAll("h2")).find((heading) => heading.textContent === "Your attention");
  expect(attentionHeading).toBeDefined();
  expect(attentionHeading?.parentElement?.parentElement?.contains(link)).toBe(true);
  expect(notice(document, "dashboard")).toBeNull();
  expect(document.getElementById("dashboard-top-up-heading")).toBeNull();
  return link;
}
function assertBookingLink(link: Element | null, id: number) {
  assertSmallLink(link);
  expect(link?.getAttribute("href")).toBe(`/commissions?tab=top-up&booking=${id}`);
  expect(link?.textContent).toBe("I’ve topped up — notify JLT");
  expect(link?.getAttribute("aria-label")).toContain(`booking #${id}`);
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.bookingId = "101";
  state.booking = booking(101);
  state.bookings = [];
  state.requests = [];
  state.missingDocs = [];
  state.flightRequests = [];
  state.topUpError = false;
  state.bookingLoading = false;
  state.mutate.mockClear();
  state.topUpQuery.mockClear();
});

describe("agent top-up confirmation navigation", () => {
  it.each([1, 2])("shows one small outline summary beside Your attention for %s open requests", (count) => {
    state.requests = Array.from({ length: count }, (_, index) => request(101 + index));
    const document = render(AgentDashboard);
    assertSummaryLink(document, count);
    expect(document.body.textContent).not.toContain("Requested top-up:");
    expect(document.body.textContent).not.toContain("£123.45");
    expect(document.body.textContent).not.toMatch(/must report|remains pending review|Already topped up\? Tell JLT/);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("keeps the dashboard DOM bounded for 100 top-ups when booking queries already fill the four-item preview", () => {
    state.bookings = Array.from({ length: 6 }, (_, index) => booking(200 + index, "Query"));
    state.requests = [request(1000, 100000000)];
    const baseline = render(AgentDashboard);
    state.requests = Array.from({ length: 100 }, (_, index) => request(1000 + index, 100000000));
    const document = render(AgentDashboard);
    assertSummaryLink(document, 100);
    expect(document.querySelectorAll('a[href*="tab=top-up"]')).toHaveLength(1);
    expect(document.querySelectorAll("*").length).toBe(baseline.querySelectorAll("*").length);
    expect(document.body.textContent).not.toMatch(/Requested top-up:|£|must report|pending review|Already topped up\?|Top-up required/);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    for (const topUp of state.requests) {
      expect(document.body.textContent).not.toContain(topUp.booking.clientName);
      expect(document.body.textContent).not.toContain(`Booking #${topUp.bookingId}`);
      expect(document.querySelector(`a[href$="booking=${topUp.bookingId}"]`)).toBeNull();
    }
    const queryLinks = Array.from(document.querySelectorAll('a[href^="/bookings/"]'));
    expect(queryLinks.map((link) => link.getAttribute("href"))).toEqual(["/bookings/200", "/bookings/201", "/bookings/202", "/bookings/203"]);
    for (const link of queryLinks) expect(link.textContent).toContain("Booking query needs your reply");
    const bookingActionCard = Array.from(document.querySelectorAll('a[href="/my-bookings"]')).find((link) => link.textContent?.includes("Booking actions to review"));
    expect(bookingActionCard?.textContent).toContain("106");
    const nonTopUpDestinations = (page: ReturnType<typeof render>) => Array.from(page.querySelectorAll("a"))
      .map((link) => link.getAttribute("href")).filter((href) => !href?.includes("tab=top-up"));
    expect(nonTopUpDestinations(document)).toEqual(nonTopUpDestinations(baseline));
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("limits the existing top-up preview to four booking-specific rows without requested amounts", () => {
    state.requests = Array.from({ length: 100 }, (_, index) => request(1000 + index));
    const document = render(AgentDashboard);
    assertSummaryLink(document, 100);
    const links = Array.from(document.querySelectorAll('a[href^="/commissions?tab=top-up&booking="]'));
    expect(links).toHaveLength(4);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([1000, 1001, 1002, 1003].map((id) => `/commissions?tab=top-up&booking=${id}`));
    for (const [index, link] of links.entries()) {
      expect(link.textContent).toBe(`Synthetic Traveller ${1000 + index}Top-up confirmation`);
    }
    expect(document.body.textContent).not.toContain("Synthetic Traveller 1004");
    expect(document.body.textContent).not.toMatch(/£|Requested top-up:|must report|pending review/);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("preserves query, PTS, missing-document and flight actions ahead of top-ups", () => {
    state.bookings = [booking(202, "Query"), { ...booking(203, "Creating own PTS file"), ptsRef: null }];
    state.missingDocs = [{ bookingId: 204, clientName: "Synthetic Document Traveller", supplierName: "Synthetic Supplier" }];
    state.flightRequests = [{ id: 205, bookingId: 205, clientName: "Synthetic Flight Traveller", status: "query" }];
    state.requests = [request(101)];
    const document = render(AgentDashboard);
    assertSummaryLink(document, 1);
    for (const [id, label] of [
      [202, "Booking query needs your reply"],
      [203, "PTS details still needed"],
      [204, "Synthetic Supplier document needed"],
      [205, "Flight request query needs your reply"],
    ] as const) {
      expect(document.querySelector(`a[href="/bookings/${id}"]`)?.textContent).toContain(label);
    }
    expect(document.querySelectorAll('a[href^="/bookings/"]')).toHaveLength(4);
    expect(document.querySelector('a[href*="tab=top-up&booking="]')).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it.each([AgentDashboard, AgentBookingDetail])("does not show top-up navigation when no own open request is returned", (Page) => {
    const document = render(Page);
    expect(document.querySelector('[id$="-top-up-heading"]')).toBeNull();
    expect(document.querySelector('a[href*="tab=top-up"]')).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it.each([AgentDashboard, AgentBookingDetail, AgentBookings])("suppresses top-up actions on query error, even with stale data", (Page) => {
    state.requests = [request(101)];
    state.topUpError = true;
    state.bookings = [booking(202, "Query")];
    const document = render(Page);
    expect(document.querySelector('a[href*="tab=top-up"]')).toBeNull();
    expect(document.querySelector('[id$="-top-up-heading"]')).toBeNull();
    if (Page !== AgentBookingDetail) expect(document.querySelector('a[href="/bookings/202"]')?.textContent).toContain("Booking query needs your reply");
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("shows a compact current-booking row below its header and before booking details", () => {
    state.requests = [request(102, 700), request(101)];
    const document = render(AgentBookingDetail);
    const section = notice(document, "booking");
    expect(section).not.toBeNull();
    for (const className of ["border", "bg-card", "px-4", "py-3", "flex", "flex-wrap"]) {
      expect(section?.classList.contains(className)).toBe(true);
    }
    expect(section?.classList.contains("border-2")).toBe(false);
    expect(section?.querySelector("h2")?.textContent).toBe("Top-up");
    expect(section?.textContent).toContain("If you've made the transfer, let JLT know so we can review it.");
    expect(section?.textContent).toContain("£123.45");
    expect(section?.textContent).not.toContain("£7.00");
    expect(section?.textContent).not.toContain("Synthetic Traveller 102");
    expect(section?.textContent).not.toMatch(/must report|remains pending review|Already topped up\? Tell JLT/);
    expect(section?.querySelector('[role="alert"]')).toBeNull();
    assertBookingLink(section?.querySelector("a") ?? null, 101);
    expect(section?.querySelectorAll("a")).toHaveLength(1);
    expect(state.topUpQuery).toHaveBeenCalledWith(undefined, { enabled: true });
    expect(state.mutate).not.toHaveBeenCalled();
    expect(document.body.innerHTML.indexOf("booking-top-up-heading")).toBeGreaterThan(document.body.innerHTML.indexOf("<h1"));
    expect(document.body.innerHTML.indexOf("booking-top-up-heading")).toBeLessThan(document.body.innerHTML.indexOf("Booking Progress"));
  });

  it.each([[1, "£0.01"], [700, "£7.00"], [12345, "£123.45"]])("formats valid requested pence %s only in booking detail", (amount, formatted) => {
    state.requests = [request(101, amount)];
    const section = notice(render(AgentBookingDetail), "booking");
    expect(section?.textContent).toContain(`Requested top-up: ${formatted}`);
    assertBookingLink(section?.querySelector("a") ?? null, 101);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it.each([null, 0, -1, NaN, Infinity, -Infinity, 12.5, "1250", Number.MAX_SAFE_INTEGER + 1])("does not invent a booking-detail amount for invalid pence %s", (amount) => {
    state.requests = [request(101, amount)];
    const section = notice(render(AgentBookingDetail), "booking");
    expect(section).not.toBeNull();
    expect(section?.textContent).not.toContain("Requested top-up:");
    expect(section?.textContent).not.toContain("£");
    assertBookingLink(section?.querySelector("a") ?? null, 101);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("does not show a detail notice for another booking's request or pending booking stage alone", () => {
    state.requests = [request(102)];
    expect(notice(render(AgentBookingDetail), "booking")).toBeNull();
    state.requests = [];
    expect(notice(render(AgentBookingDetail), "booking")).toBeNull();
  });

  it("does not show a detail notice before its booking finishes loading", () => {
    state.requests = [request(101)];
    state.bookingLoading = true;
    expect(notice(render(AgentBookingDetail), "booking")).toBeNull();
  });

  it.each(["0", "-1", "1.5", "invalid"])("disables the additional query for invalid booking id %s", (id) => {
    state.bookingId = id;
    state.booking = undefined;
    render(AgentBookingDetail);
    expect(state.topUpQuery).toHaveBeenCalledWith(undefined, { enabled: false });
  });

  it.each([AgentDashboard, AgentBookings])("keeps booking-specific top-up navigation and query destinations unchanged", (Page) => {
    state.requests = [request(101)];
    state.bookings = [booking(202, "Query")];
    const document = render(Page);
    expect(document.querySelector('a[href="/bookings/202"]')?.textContent).toContain("Booking query needs your reply");
    const topUp = document.querySelector('a[href="/commissions?tab=top-up&booking=101"]');
    expect(topUp).not.toBeNull();
    expect(topUp?.textContent).toContain(Page === AgentDashboard ? "Top-up confirmation" : "Already topped up? Notify JLT");
    expect(document.querySelector('a[href="/bookings/101"]')).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("keeps the summary and detail navigation free of mutation or click handlers", () => {
    const dashboard = readFileSync(new URL("../client/src/pages/agent/AgentDashboard.tsx", import.meta.url), "utf8");
    expect(dashboard).not.toContain("dashboard-top-up-heading");
    const summaryStart = dashboard.indexOf('<Link href="/commissions?tab=top-up"');
    expect(summaryStart).toBeGreaterThan(-1);
    const summary = dashboard.slice(dashboard.lastIndexOf("<Button", summaryStart), dashboard.indexOf("</Button>", summaryStart));
    expect(summary).toMatch(/\basChild\b/);
    expect(summary).toContain('variant="outline"');
    expect(summary).toContain('size="sm"');
    expect(summary).not.toMatch(/onClick|\.mutate|useMutation/);
    const detail = readFileSync(new URL("../client/src/pages/agent/AgentBookingDetail.tsx", import.meta.url), "utf8");
    const detailStart = detail.indexOf('<section aria-labelledby="booking-top-up-heading"');
    expect(detailStart).toBeGreaterThan(-1);
    const section = detail.slice(detailStart, detail.indexOf("</section>", detailStart));
    expect(section).toContain("/commissions?tab=top-up&booking=");
    expect(section).not.toMatch(/onClick|\.mutate|useMutation/);
  });

  it("keeps the commissions summary compact and its existing view action navigation-only", () => {
    const source = readFileSync(new URL("../client/src/pages/agent/AgentCommissions.tsx", import.meta.url), "utf8");
    const start = source.indexOf('<section aria-label="Top-up confirmation"');
    expect(start).toBeGreaterThan(-1);
    const section = source.slice(start, source.indexOf("</section>", start));
    for (const className of ["border", "bg-card", "px-4", "py-3", "flex-wrap"]) {
      expect(section).toMatch(new RegExp(`\\b${className}\\b`));
    }
    expect(section).not.toMatch(/border-2|bg-amber-50|w-full|size="lg"|role="alert"|must report|Already topped up\? Tell JLT/);
    expect(section).toContain('size="sm"');
    expect(section).toContain('variant="outline"');
    expect(section).toContain("View top-ups & notify JLT");
    expect(section).toContain('setActiveTab("top-up")');
    expect(section).toContain('scrollIntoView?.({ block: "start", behavior: "auto" })');
    expect(section).not.toMatch(/\.mutate|useMutation|setNotifyTopUpId/);
  });
});

describe("legacy top-up message destination", () => {
  it("keeps both agent and personal-admin routes pointing to the exact top-up tab", () => {
    const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
    const routes = app.match(/<Route path="\/my-files-in-minus"><Redirect to="\/commissions\?tab=top-up" replace \/><\/Route>/g);
    expect(routes).toHaveLength(2);
    expect(app).toContain('import { Redirect, Route, Switch, useLocation } from "wouter"');
  });
});
