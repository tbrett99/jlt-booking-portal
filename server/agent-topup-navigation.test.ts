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
function assertLink(link: Element | null, id: number) {
  expect(link).not.toBeNull();
  expect(link?.getAttribute("href")).toBe(`/commissions?tab=top-up&booking=${id}`);
  expect(link?.textContent).toBe("I’ve topped up — notify JLT");
  expect(link?.getAttribute("aria-label")).toContain(`booking #${id}`);
  expect(link?.className).toContain("w-full");
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.bookingId = "101";
  state.booking = booking(101);
  state.bookings = [];
  state.requests = [];
  state.topUpError = false;
  state.bookingLoading = false;
  state.mutate.mockClear();
  state.topUpQuery.mockClear();
});

describe("agent top-up confirmation navigation", () => {
  it("puts every own top-up on the dashboard above attention, even when other actions fill the preview", () => {
    state.bookings = Array.from({ length: 6 }, (_, index) => booking(200 + index, "Query"));
    state.requests = [request(101), request(102, 1)];
    const document = render(AgentDashboard);
    const section = notice(document, "dashboard");
    expect(section?.textContent).toContain("Already topped up? Tell JLT");
    expect(section?.textContent).toContain("must report it to JLT");
    expect(section?.textContent).toContain("pending review");
    expect(section?.textContent).toContain("Requested top-up: £123.45");
    expect(section?.textContent).toContain("Requested top-up: £0.01");
    for (const id of [101, 102]) {
      expect(section?.textContent).toContain(`Synthetic Traveller ${id}`);
      expect(section?.textContent).toContain(`Booking #${id}`);
      assertLink(section?.querySelector(`a[href$="booking=${id}"]`) as Element, id);
    }
    const headings = Array.from(document.querySelectorAll("h2")).map((heading) => heading.textContent);
    expect(headings.indexOf("Already topped up? Tell JLT")).toBeLessThan(headings.indexOf("Your attention"));
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it.each([null, 0, -1, NaN, Infinity, 12.5, "1250"])("does not invent a requested amount for invalid pence %s", (amount) => {
    state.requests = [request(101, amount)];
    expect(notice(render(AgentDashboard), "dashboard")?.textContent).not.toContain("Requested top-up:");
  });

  it.each([AgentDashboard, AgentBookingDetail])("does not show a top-up notice when no own open request is returned", (Page) => {
    const document = render(Page);
    expect(document.querySelector('[id$="-top-up-heading"]')).toBeNull();
    expect(document.querySelector('a[href*="tab=top-up"]')).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it.each([AgentDashboard, AgentBookingDetail, AgentBookings])("suppresses top-up actions on query error, even with stale data", (Page) => {
    state.requests = [request(101)];
    state.topUpError = true;
    const document = render(Page);
    expect(document.querySelector('a[href*="tab=top-up"]')).toBeNull();
    expect(document.querySelector('[id$="-top-up-heading"]')).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("shows only the current booking's request below its header and before booking details", () => {
    state.requests = [request(102, 700), request(101)];
    const document = render(AgentBookingDetail);
    const section = notice(document, "booking");
    expect(section?.textContent).toContain("Booking #101");
    expect(section?.textContent).toContain("£123.45");
    expect(section?.textContent).not.toContain("£7.00");
    assertLink(section?.querySelector("a") as Element, 101);
    expect(state.topUpQuery).toHaveBeenCalledWith(undefined, { enabled: true });
    expect(state.mutate).not.toHaveBeenCalled();
    expect(document.body.innerHTML.indexOf('booking-top-up-heading')).toBeGreaterThan(document.body.innerHTML.indexOf("<h1"));
    expect(document.body.innerHTML.indexOf('booking-top-up-heading')).toBeLessThan(document.body.innerHTML.indexOf("Booking Progress"));
  });

  it("does not show a notice for another booking's request or pending booking stage alone", () => {
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

  it.each([AgentDashboard, AgentBookings])("routes only the top-up action to confirmation and keeps query actions on the booking", (Page) => {
    state.requests = [request(101)];
    state.bookings = [booking(202, "Query")];
    const document = render(Page);
    const links = Array.from(document.querySelectorAll("a"));
    expect(links.some((link) => link.getAttribute("href") === "/bookings/202" && link.textContent?.includes("Booking query needs your reply"))).toBe(true);
    expect(links.some((link) => link.getAttribute("href") === "/commissions?tab=top-up&booking=101" && link.textContent?.includes("Already topped up? Notify JLT"))).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("keeps the added top-up notices free of mutation handlers", () => {
    for (const name of ["AgentDashboard", "AgentBookingDetail"]) {
      const source = readFileSync(new URL(`../client/src/pages/agent/${name}.tsx`, import.meta.url), "utf8");
      const section = source.slice(source.indexOf('<section aria-labelledby="'), source.indexOf("</section>", source.indexOf('<section aria-labelledby="')));
      expect(section).toContain("/commissions?tab=top-up&booking=");
      expect(section).not.toMatch(/onClick|\.mutate|useMutation/);
    }
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
