// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  query: {} as any,
  useQuery: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    staffCalls: {
      agentHistory: {
        useQuery: (...args: any[]) => {
          fixture.useQuery(...args);
          return { ...fixture.query, refetch: fixture.refetch };
        },
      },
    },
  },
}));
import StaffCallCrmHistory from "../client/src/components/StaffCallCrmHistory";
let root: Root, container: HTMLDivElement;
const call = {
  id: 101,
  participantId: 501,
  hostUserId: 77,
  hostName: "Synthetic support host",
  reasonKey: "business_review",
  reasonExplanation: null,
  format: "one_to_one",
  startAt: new Date("2026-11-20T12:00:00Z"),
  endAt: new Date("2026-11-20T12:30:00Z"),
  status: "booked",
  version: 2,
  participantCount: 1,
  meetingUrl: null,
  attendance: "attended",
  outcome: "completed",
  privateNotes: "Synthetic exact-agent notes\nSecond line",
  sharedSummary: null,
  sharedAt: null,
};
async function render(agentId = 42) {
  await act(async () =>
    root.render(React.createElement(StaffCallCrmHistory, { agentId }))
  );
}
beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  fixture.query = {
    data: { items: [], nextCall: null, nextCursor: null },
    isLoading: false,
    error: null,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
describe("CRM exact-agent support call history", () => {
  it("uses exact canonical CRM ID and prominently links booking to that agent", async () => {
    await render();
    expect(fixture.useQuery).toHaveBeenCalledWith(
      { agentId: 42, limit: 8 },
      expect.objectContaining({
        retry: false,
        staleTime: 0,
        refetchOnWindowFocus: true,
      })
    );
    const link = Array.from(container.querySelectorAll("a")).find(item =>
      item.textContent?.includes("Book a call")
    );
    expect(link?.getAttribute("href")).toBe("/admin/staff-calls?agentId=42");
    expect(
      container.querySelector('[aria-label="Agent support calls"]')
    ).toBeTruthy();
  });
  it("shows honest empty history, not invented appointments", async () => {
    await render();
    expect(container.textContent).toContain("No future confirmed support call");
    expect(container.textContent).toContain("No call history");
    expect(container.querySelectorAll("article")).toHaveLength(0);
  });
  it("shows a separately queried next confirmed appointment and exact record link", async () => {
    fixture.query.data.nextCall = {
      ...call,
      id: 202,
      startAt: new Date("2026-12-01T12:00:00Z"),
    };
    await render();
    expect(container.textContent).toContain("Next booked call");
    expect(container.textContent).toContain("Synthetic support host");
    expect(
      container.querySelector('a[href="/admin/staff-calls?callId=202"]')
    ).toBeTruthy();
  });
  it("renders this agent's manual attendance, outcome and internal notes with line breaks", async () => {
    fixture.query.data.items = [call];
    await render();
    expect(container.textContent).toContain("attended · completed");
    expect(container.textContent).toContain("Internal call notes");
    const notes = Array.from(container.querySelectorAll("p")).find(item =>
      item.textContent?.includes("Second line")
    );
    expect(notes?.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(
      container.querySelector('a[href="/admin/staff-calls?callId=101"]')
    ).toBeTruthy();
  });
  it("never interprets private notes as HTML or script", async () => {
    fixture.query.data.items = [
      {
        ...call,
        privateNotes: '<img src=x onerror="alert(1)"><script>bad()</script>',
      },
    ];
    await render();
    expect(container.querySelector("img,script")).toBeNull();
    expect(container.textContent).toContain("<script>bad()</script>");
  });
  it("withholds cached notes and upcoming appointment after a denied refresh", async () => {
    fixture.query.data = { items: [call], nextCall: call, nextCursor: null };
    fixture.query.error = new Error("Forbidden");
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "No cached notes"
    );
    expect(container.textContent).not.toContain("Synthetic exact-agent");
    expect(container.textContent).not.toContain("Next booked call");
    await act(async () => container.querySelector("button")!.click());
    expect(fixture.refetch).toHaveBeenCalledOnce();
  });
  it("withholds old data during the initial load of a different record", async () => {
    fixture.query.data = { items: [call], nextCall: call, nextCursor: null };
    fixture.query.isLoading = true;
    await render(99);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Loading call history"
    );
    expect(container.textContent).not.toContain("Synthetic exact-agent");
    expect(fixture.useQuery.mock.calls.at(-1)?.[0].agentId).toBe(99);
  });
  it("does not present a cancelled or unrecorded invitation as attendance", async () => {
    fixture.query.data.items = [
      {
        ...call,
        status: "cancelled",
        attendance: "awaiting",
        outcome: null,
        privateNotes: null,
      },
    ];
    await render();
    expect(container.textContent).toContain("Attendance: awaiting");
    expect(container.textContent).toContain("cancelled");
    expect(container.textContent).not.toContain("Internal call notes");
  });
  it("keeps group history agent-specific without displaying a group roster", async () => {
    fixture.query.data.items = [
      { ...call, format: "group", participantCount: 4 },
    ];
    fixture.query.data.nextCursor = 5;
    await render();
    expect(container.textContent).toContain("Group call");
    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(container.textContent).toContain("Open diary for more calls");
  });
});
