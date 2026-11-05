// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MutationOptions = {
  onSuccess?: (data: unknown) => unknown;
  onError?: (error: Error) => unknown;
  onSettled?: () => unknown;
};
const notifyPath = "commissionClaims.agentNotifyTopUpComplete";
const mocks = vi.hoisted(() => ({
  bookings: [] as any[],
  loading: false,
  pending: false,
  calls: [] as { path: string; input: unknown }[],
  options: new Map<string, MutationOptions>(),
  invalidate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  fetch: vi.fn(),
  scroll: vi.fn(),
}));

vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any =>
    new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useUtils") return () => node();
          if (key === "invalidate") return () => mocks.invalidate(path);
          if (key === "useQuery")
            return () => ({
              data:
                path === "commissionClaims.myCommissions"
                  ? mocks.loading
                    ? undefined
                    : mocks.bookings
                  : path === "commissionClaims.myTopUpRequests"
                    ? mocks.bookings
                        .filter(b => b.claim?.status === "top_up_required")
                        .map(b => ({ ...b.claim, booking: b }))
                    : [], // Remittances and timeline are distinct empty arrays, never booking rows.
              isLoading:
                path === "commissionClaims.myCommissions" && mocks.loading,
              error: null,
            });
          if (key === "useMutation")
            return (options: MutationOptions = {}) => {
              mocks.options.set(path, options);
              return {
                isPending:
                  path === "commissionClaims.agentNotifyTopUpComplete" &&
                  mocks.pending,
                mutate: (input: unknown) => mocks.calls.push({ path, input }),
              };
            };
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
  return { trpc: node() };
});
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, warning: mocks.warning },
}));
vi.mock("wouter", () => ({
  useSearch: () => window.location.search.slice(1),
  Link: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

import AgentCommissions from "../client/src/pages/agent/AgentCommissions";

let root: Root;
let container: HTMLDivElement;
let restoreScroll: (() => void) | undefined;
function booking(id = 101, overrides: Record<string, unknown> = {}) {
  return {
    id,
    clientName: id === 101 ? "Alice Example" : "Bob Example",
    departureDate: "2026-10-01T12:00:00Z",
    currentStage: "Commission Due",
    expectedCommission: 250,
    totalBookingValue: 1500,
    grossCommission: 250,
    netCommission: 200,
    ptsFee: 25,
    agentSplit: 80,
    claim: {
      id: id + 400,
      status: "top_up_required",
      claimedAt: "2026-10-10T12:00:00Z",
      paidAt: null,
      topUpAmountPence: 12345,
      topUpNote: "Supplier balance needs covering.",
    },
    ...overrides,
  };
}
function button(text: string, scope: ParentNode = document) {
  const matches = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button")
  ).filter(el => el.textContent?.trim() === text);
  expect(matches, `button ${text}`).toHaveLength(1);
  return matches[0]!;
}
function row(id = 101) {
  const found = document.getElementById(`agent-top-up-booking-${id}`);
  expect(found, `top-up booking ${id}`).not.toBeNull();
  return found!;
}
function dialog() {
  const matches = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  expect(matches).toHaveLength(1);
  return matches[0]!;
}
function activeTab() {
  return container
    .querySelector('[role="tab"][aria-selected="true"]')
    ?.textContent?.trim();
}
async function render() {
  await act(async () => root.render(React.createElement(AgentCommissions)));
}
async function click(text: string, scope: ParentNode = document) {
  await act(async () => button(text, scope).click());
}
async function openTopUp(id = 101) {
  await click("View top-ups & notify JLT");
  await click("I've topped up — notify JLT", row(id));
}
async function settle(kind: "onSuccess" | "onError", value: unknown) {
  const options = mocks.options.get(notifyPath)!;
  await act(async () => {
    if (kind === "onSuccess") await options.onSuccess?.(value);
    else await options.onError?.(value as Error);
    await options.onSettled?.();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React); // Page components use classic JSX in this test runner.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockImplementation(() => {
    throw new Error("Provider/network access is forbidden in this UI test");
  });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.bookings = [booking(), booking(102)];
  mocks.loading = false;
  mocks.pending = false;
  mocks.calls = [];
  mocks.options.clear();
  window.history.replaceState({}, "", "/commissions");
  const oldScroll = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView"
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: function (this: HTMLElement, options: unknown) {
      mocks.scroll(this.id, options);
    },
  });
  restoreScroll = () => {
    if (oldScroll)
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", oldScroll);
    else delete (HTMLElement.prototype as any).scrollIntoView;
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  restoreScroll?.();
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("agent top-up confirmation rendered UI", () => {
  it("puts the actionable banner after the page heading and before pre-auth, then opens and scrolls the top-up section without submitting", async () => {
    await render();
    const text = container.textContent!;
    expect(text.indexOf("Already topped up?")).toBeGreaterThan(
      text.indexOf("My Commissions")
    );
    expect(text.indexOf("Already topped up?")).toBeLessThan(
      text.indexOf("Commission Pre-Authorisation — scheduled after travel")
    );
    expect(activeTab()).toContain("Ready to Claim");
    const cta = button("View top-ups & notify JLT");
    expect(cta.className).toContain("bg-[#02E6D2]");
    await click("View top-ups & notify JLT");
    expect(activeTab()).toMatch(/Top-ups required|Top-ups \/ Files in Minus/);
    expect(document.getElementById("agent-top-up-requests")).not.toBeNull();
    expect(mocks.scroll).toHaveBeenCalledWith(
      "agent-top-up-requests",
      expect.objectContaining({ block: "start" })
    );
    expect(mocks.calls).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("omits the banner and notification actions when no claim has a pending top-up, and defaults invalid queries to claimable", async () => {
    mocks.bookings = [
      booking(101, { claim: null, currentStage: "Commission Claimable" }),
      booking(102, { claim: { ...booking(102).claim, status: "processing" } }),
    ];
    window.history.replaceState(
      {},
      "",
      "/commissions?tab=invalid&booking=not-a-number"
    );
    await render();
    expect(activeTab()).toContain("Ready to Claim");
    expect(container.textContent).not.toContain("Already topped up?");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        b => b.textContent?.trim() === "View top-ups & notify JLT"
      )
    ).toBe(false);
    expect(container.querySelector('[id^="agent-top-up-booking-"]')).toBeNull();
    expect(mocks.calls).toEqual([]);
  });

  it("honours /commissions?tab=top-up&booking=101 after data loading and highlights only that booking, never auto-confirming", async () => {
    window.history.replaceState({}, "", "/commissions?tab=top-up&booking=101");
    mocks.loading = true;
    await render();
    expect(container.textContent).not.toContain("My Commissions");
    expect(mocks.calls).toEqual([]);
    mocks.loading = false;
    await render();
    expect(activeTab()).toMatch(/Top-ups required|Top-ups \/ Files in Minus/);
    expect(row(101).className).toContain("ring-2");
    expect(row(102).className).not.toContain("ring-2");
    expect(mocks.scroll).toHaveBeenCalledWith(
      "agent-top-up-booking-101",
      expect.objectContaining({ block: "start" })
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.calls).toEqual([]);
  });

  it("uses a large responsive teal row action to open a contextual confirmation with no financial editors, and cancels without mutation", async () => {
    await render();
    await openTopUp();
    const action = button("I've topped up — notify JLT", row());
    expect(action.className).toContain("bg-[#02E6D2]");
    expect(action.className).toContain("min-h-12");
    expect(action.className).toContain("w-full");
    expect(action.className).toContain("whitespace-normal");
    expect(action.className).not.toContain("border-input");
    expect(row().className).toContain("sm:flex-row");
    const modal = dialog();
    expect(
      document.getElementById(modal.getAttribute("aria-labelledby")!)
        ?.textContent
    ).toBe("Confirm your top-up");
    expect(
      document.getElementById(modal.getAttribute("aria-describedby")!)
        ?.textContent
    ).toContain("Only confirm once");
    expect(modal.textContent).toContain("Alice Example");
    expect(modal.textContent).toContain("Booking #101");
    expect(modal.textContent).toContain("£123.45");
    expect(modal.textContent).toContain("Supplier balance needs covering.");
    expect(modal.textContent).toMatch(
      /does not charge|does not take another payment/i
    );
    expect(modal.querySelector("input, textarea, select")).toBeNull();
    expect(mocks.calls).toEqual([]);
    await click("Cancel", modal);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.calls).toEqual([]);
  });

  it("requires explicit confirmation, sends only the existing claimId, and disables further submits while pending", async () => {
    await render();
    await openTopUp(102);
    expect(mocks.calls).toEqual([]);
    await click("Confirm top-up & notify JLT", dialog());
    expect(mocks.calls).toEqual([
      { path: notifyPath, input: { claimId: 502 } },
    ]);
    // Repeated clicks even before the mutation hook refreshes cannot create a duplicate.
    await click("Confirm top-up & notify JLT", dialog());
    expect(mocks.calls).toHaveLength(1);
    mocks.pending = true;
    await render();
    expect(button("Confirm top-up & notify JLT", dialog()).disabled).toBe(true);
    expect(button("I've topped up — notify JLT", row(102)).disabled).toBe(true);
    await click("Confirm top-up & notify JLT", dialog());
    expect(mocks.calls).toHaveLength(1);
  });

  it("clears the saved confirmation, invalidates both agent lists and accurately reports review, preserving all finance fields", async () => {
    const before = JSON.stringify(mocks.bookings);
    await render();
    await openTopUp();
    await click("Confirm top-up & notify JLT", dialog());
    expect(mocks.success).not.toHaveBeenCalled();
    await settle("onSuccess", { success: true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.invalidate.mock.calls.map(([path]) => path).sort()).toEqual([
      "commissionClaims.myCommissions",
      "commissionClaims.myTopUpRequests",
    ]);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.success.mock.calls[0][0]).toMatch(
      /reported to JLT.*awaiting review/i
    );
    expect(mocks.success.mock.calls[0][0]).not.toMatch(
      /payment (?:verified|received)|claim (?:paid|approved)|money has arrived/i
    );
    expect(JSON.stringify(mocks.bookings)).toBe(before);
    expect(mocks.calls).toEqual([
      { path: notifyPath, input: { claimId: 501 } },
    ]);
    await click("I've topped up — notify JLT", row(102));
    expect(dialog().textContent).toContain("Bob Example");
    expect(dialog().textContent).not.toContain("Alice Example");
  });

  it("keeps the dialog and shows the actual mutation error without success or invalidation, then permits a deliberate retry", async () => {
    await render();
    await openTopUp();
    await click("Confirm top-up & notify JLT", dialog());
    await settle("onError", new Error("No top-up is pending for this claim"));
    expect(dialog().textContent).toContain("Alice Example");
    expect(mocks.error).toHaveBeenCalledWith(
      "No top-up is pending for this claim"
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    await click("Confirm top-up & notify JLT", dialog());
    expect(mocks.calls).toEqual([
      { path: notifyPath, input: { claimId: 501 } },
      { path: notifyPath, input: { claimId: 501 } },
    ]);
  });

  it("does not submit a stale dialog when a refreshed claim is no longer top_up_required", async () => {
    await render();
    await openTopUp();
    mocks.bookings = [
      booking(101, { claim: { ...booking().claim, status: "pending" } }),
      booking(102),
    ];
    await render();
    const modal = document.querySelector('[role="dialog"]');
    if (modal) await click("Confirm top-up & notify JLT", modal);
    expect(mocks.calls).toEqual([]);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
