// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  user: {
    id: 9,
    role: "admin",
    isActive: true,
    mustChangePassword: false,
    portalStatus: "active",
  } as any,
  data: {} as Record<string, any>,
  errors: {} as Record<string, any>,
  fetching: {} as Record<string, boolean>,
  hooks: [] as { path: string; input: any; enabled: boolean }[],
  mutations: [] as { path: string; input: any }[],
  reject: {} as Record<string, string>,
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: mock.user, loading: false }),
}));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const proxy = (parts: string[] = []): any =>
    new Proxy(() => undefined, {
      get: (_target, property: string) => {
        if (property === "useQuery")
          return (input: unknown, options: any = {}) => {
            const path = parts.join(".");
            mock.hooks.push({
              path,
              input,
              enabled: options.enabled !== false,
            });
            return {
              data: mock.data[path],
              error: mock.errors[path] ?? null,
              isLoading: false,
              isFetching: !!mock.fetching[path],
              refetch: vi.fn(async () => ({ data: mock.data[path] })),
            };
          };
        if (property === "useMutation")
          return () => {
            const path = parts.join(".");
            const [error, setError] = react.useState<any>(null);
            const [isPending, setPending] = react.useState(false);
            return {
              error,
              isPending,
              reset: () => setError(null),
              mutateAsync: async (input: any) => {
                mock.mutations.push({ path, input });
                setPending(true);
                try {
                  if (mock.reject[path]) throw new Error(mock.reject[path]);
                  if (
                    path.endsWith("saveNotes") ||
                    path.endsWith("shareRecap")
                  ) {
                    const result = {
                      participantId: input.participantId,
                      version: input.expectedVersion + 1,
                      sharedAt: new Date("2026-11-01T12:00:00Z"),
                    };
                    const record = mock.data[
                      "staffCalls.get"
                    ]?.participants.find(
                      (p: any) => p.id === input.participantId
                    );
                    if (record)
                      Object.assign(record, input, {
                        version: result.version,
                        ...(path.endsWith("shareRecap")
                          ? { sharedAt: result.sharedAt }
                          : {}),
                      });
                    return result;
                  }
                  if (path.endsWith("draftFollowUp"))
                    return { planId: 87, status: "draft" };
                  return {
                    requestId: input.requestId,
                    callId: 41,
                    state: "succeeded",
                    status: path.includes("cancel") ? "cancelled" : "booked",
                    message: "Provider confirmed",
                  };
                } catch (failure) {
                  setError(failure);
                  throw failure;
                } finally {
                  setPending(false);
                }
              },
            };
          };
        return proxy([...parts, property]);
      },
    });
  return { trpc: proxy() };
});
import StaffCalls from "@/pages/staff/StaffCalls";
import AgentCalls from "@/pages/agent/AgentCalls";
import StaffCallReports from "@/pages/admin/StaffCallReports";
import BookCall from "./BookCall";
import CallDetail from "./CallDetail";
import CallScheduling from "./CallScheduling";
import { safeMeetingUrl } from "./CallUI";
import { STAFF_CALL_REASONS } from "@shared/staff-calls";
import { calculateStaffCallReport } from "@shared/staff-call-reporting";

const hosts = [
  { id: 9, name: "Host Nine" },
  { id: 10, name: "Other Host" },
];
const agents = [
  { id: 3, name: "Exact Agent" },
  { id: 4, name: "Second Agent" },
];
const context = {
  actorId: 9,
  canManage: true,
  canViewTeam: true,
  reasons: [...STAFF_CALL_REASONS],
  provider: { connected: true, message: "Host verification required per slot" },
};
const slot = {
  startAt: new Date("2026-12-01T10:00:00Z"),
  endAt: new Date("2026-12-01T10:30:00Z"),
  capacity: 5,
};
const call = {
  id: 41,
  hostUserId: 9,
  hostName: "Host Nine",
  reasonKey: "business_review",
  reasonExplanation: null,
  format: "group",
  startAt: new Date("2026-01-01T10:00:00Z"),
  endAt: new Date("2026-01-01T10:30:00Z"),
  status: "booked",
  version: 7,
  participantCount: 2,
  meetingUrl: "https://meet.example.test/session",
} as any;
const participant = {
  id: 101,
  agentId: 3,
  name: "Exact Agent",
  attendance: "awaiting",
  outcome: null,
  privateNotes: null,
  sharedSummary: null,
  sharedAt: null,
  version: 2,
  status: "active",
};
let container: HTMLDivElement;
let root: Root;
async function render(element: React.ReactNode) {
  await act(async () => {
    root.render(element);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
async function click(text: string) {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(item => item.textContent?.trim() === text);
  expect(button, text).toBeTruthy();
  await act(async () => {
    button!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
function button(text: string) {
  const result = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(item => item.textContent?.trim() === text);
  expect(result, text).toBeTruthy();
  return result!;
}
function field(label: string) {
  const result = [...container.querySelectorAll("label")]
    .find(item => item.querySelector("span")?.textContent === label)
    ?.querySelector<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input,select,textarea");
  expect(result, label).toBeTruthy();
  return result!;
}
async function change(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string
) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value
    );
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      })
    );
    if (!(element instanceof HTMLSelectElement))
      element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function checkAgent(id: number) {
  const label = [...container.querySelectorAll("label")].find(item =>
    item.textContent?.trim().endsWith(`· #${id}`)
  );
  expect(label).toBeTruthy();
  await act(async () => {
    label!.querySelector<HTMLInputElement>("input")!.click();
  });
}
async function pickSlot() {
  const item = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(item => item.textContent?.includes("capacity 5"));
  expect(item).toBeTruthy();
  await act(async () => item!.click());
}
function bookElement(value = context, initialAgentId?: number) {
  return React.createElement(BookCall, {
    context: value as any,
    hosts,
    initialAgentId,
    close: vi.fn(),
    onBooked: vi.fn(),
  });
}
function enabledPaths() {
  return mock.hooks.filter(item => item.enabled).map(item => item.path);
}
beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mock.user = {
    id: 9,
    role: "admin",
    isActive: true,
    mustChangePassword: false,
    portalStatus: "active",
  };
  mock.data = {
    "staffCalls.context": context,
    "staffCalls.hosts": hosts,
    "staffCalls.agents": { items: agents, nextCursor: null },
    "staffCalls.availability": {
      connected: true,
      message: "Verified",
      slots: [slot],
    },
    "staffCalls.diary": { items: [call], nextCursor: null },
    "staffCalls.mine": { items: [call], nextCursor: null },
    "staffCalls.get": {
      call: { ...call },
      participants: [
        { ...participant },
        { ...participant, id: 102, agentId: 4, name: "Second Agent" },
      ],
      history: [],
      followUps: [],
    },
  };
  mock.errors = {};
  mock.fetching = {};
  mock.hooks = [];
  mock.mutations = [];
  mock.reject = {};
  localStorage.clear();
  window.history.replaceState(null, "", "/admin/staff-calls");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("real DOM provider booking guards", () => {
  it("disables disconnected booking and never fabricates slots", async () => {
    mock.data["staffCalls.availability"] = {
      connected: false,
      message: "No connected calendar",
      slots: [],
    };
    await render(
      bookElement({
        ...context,
        canViewTeam: false,
        provider: { connected: false, message: "Provider unconnected" },
      })
    );
    await change(field("Call host"), "9");
    await change(field("Required call reason"), "business_review");
    await checkAgent(3);
    expect(button("Confirm provider booking").disabled).toBe(true);
    expect(container.textContent).toContain(
      "empty diary does not verify availability"
    );
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(enabledPaths()).not.toContain("staffCalls.availability");
    expect(mock.mutations).toEqual([]);
  });
  it("requires dropdown reason and an explicit Other explanation", async () => {
    await render(bookElement());
    await change(field("Call host"), "9");
    await checkAgent(3);
    await pickSlot();
    expect(button("Confirm provider booking").disabled).toBe(true);
    await change(field("Required call reason"), "other");
    expect(button("Confirm provider booking").disabled).toBe(true);
    await change(field("Explain Other reason"), "Discuss support needs");
    expect(button("Confirm provider booking").disabled).toBe(false);
    await click("Confirm provider booking");
    expect(mock.mutations[0]).toMatchObject({
      path: "staffCalls.book",
      input: {
        hostUserId: 9,
        agentIds: [3],
        format: "one_to_one",
        reasonKey: "other",
        reasonExplanation: "Discuss support needs",
        startAt: slot.startAt,
        endAt: slot.endAt,
      },
    });
    expect(mock.mutations[0].input.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("does not turn typed search into an attendee and hydrates CRM IDs only from real records", async () => {
    await render(bookElement(context, 3));
    expect(container.textContent).toContain("Remove Exact Agent · #3");
    await change(field("Search exact Portal agents"), "made-up@example.test");
    expect(mock.mutations).toEqual([]);
    expect(mock.hooks.at(-1)?.path).toBeTruthy();
  });
  it("does not attach an unavailable CRM-linked agent", async () => {
    await render(bookElement(context, 999));
    expect(container.textContent).toContain("linked agent is not available");
    expect(container.textContent).not.toContain("Remove Agent · #999");
  });
  it("requires deliberate group choice for multiple exact agent records", async () => {
    await render(bookElement());
    await change(field("Call host"), "9");
    await change(field("Required call reason"), "training_follow_up");
    await checkAgent(3);
    await checkAgent(4);
    expect(button("Confirm provider booking").disabled).toBe(true);
    expect(container.textContent).toContain("A 1:1 needs exactly one agent");
    await change(field("Call format"), "group");
    await pickSlot();
    await click("Confirm provider booking");
    expect(mock.mutations[0].input).toMatchObject({
      agentIds: [3, 4],
      format: "group",
    });
  });
  it("hides stale availability after a connection/query failure", async () => {
    await render(bookElement());
    await change(field("Call host"), "9");
    await change(field("Required call reason"), "business_review");
    await checkAgent(3);
    await pickSlot();
    mock.errors["staffCalls.availability"] = { message: "Provider down" };
    await render(bookElement());
    expect(button("Confirm provider booking").disabled).toBe(true);
    expect(container.textContent).toContain("No stored slots are offered");
  });
  it("preserves frozen payload and request ID across an uncertain response and remount", async () => {
    await render(bookElement());
    await change(field("Call host"), "9");
    await change(field("Required call reason"), "business_review");
    await checkAgent(3);
    await pickSlot();
    mock.reject["staffCalls.book"] = "Response lost after provider request";
    await click("Confirm provider booking");
    const first = mock.mutations[0].input;
    expect(container.textContent).toContain("Do not create another booking");
    expect(field("Call host").closest("fieldset")?.disabled).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(bookElement());
    await click("Retry this booking request");
    expect(mock.mutations[1].input).toEqual(first);
    expect(localStorage.getItem("jlt-call-book:9")).toContain(first.requestId);
    await click("Check booking status");
    expect(mock.mutations.at(-1)).toEqual({
      path: "staffCalls.reconcile",
      input: { requestId: first.requestId },
    });
  });
});
describe("private records and separate sharing", () => {
  it("requires manual per-person attendance, outcome and private notes; ordinary save never shares", async () => {
    await render(
      React.createElement(CallDetail, {
        callId: 41,
        context: context as any,
        close: vi.fn(),
        refresh: vi.fn(),
      })
    );
    expect(button("Save private call record").disabled).toBe(true);
    await change(field("Attendance for agent #3"), "attended");
    await change(field("Outcome for agent #3"), "follow_up_required");
    await change(
      field("Required private internal notes for agent #3"),
      "Private assessment of needs"
    );
    await click("Save private call record");
    expect(mock.mutations).toEqual([
      {
        path: "staffCalls.saveNotes",
        input: {
          callId: 41,
          participantId: 101,
          expectedVersion: 2,
          attendance: "attended",
          outcome: "follow_up_required",
          privateNotes: "Private assessment of needs",
        },
      },
    ]);
    expect(field("Shared recap for agent #3").value).toBe("");
  });
  it("shares only separate recap after explicit per-agent confirmation", async () => {
    Object.assign(mock.data["staffCalls.get"].participants[0], {
      attendance: "attended",
      privateNotes: "Already saved private notes",
    });
    await render(
      React.createElement(CallDetail, {
        callId: 41,
        context: context as any,
        close: vi.fn(),
        refresh: vi.fn(),
      })
    );
    await change(field("Shared recap for agent #3"), "Agreed next steps");
    await click("Share recap explicitly");
    expect(mock.mutations).toEqual([]);
    await click("Confirm share with this agent");
    expect(mock.mutations).toEqual([
      {
        path: "staffCalls.shareRecap",
        input: {
          callId: 41,
          participantId: 101,
          expectedVersion: 2,
          sharedSummary: "Agreed next steps",
        },
      },
    ]);
    expect(mock.mutations[0].input).not.toHaveProperty("privateNotes");
  });
  it("retains failed notes and original version despite a query refresh", async () => {
    await render(
      React.createElement(CallDetail, {
        callId: 41,
        context: context as any,
        close: vi.fn(),
        refresh: vi.fn(),
      })
    );
    await change(field("Attendance for agent #3"), "no_show");
    await change(field("Outcome for agent #3"), "no_contact");
    await change(
      field("Required private internal notes for agent #3"),
      "No contact; retain my draft"
    );
    mock.reject["staffCalls.saveNotes"] = "Version conflict";
    await click("Save private call record");
    mock.data["staffCalls.get"].participants[0].version = 5;
    await render(
      React.createElement(CallDetail, {
        callId: 41,
        context: context as any,
        close: vi.fn(),
        refresh: vi.fn(),
      })
    );
    expect(field("Required private internal notes for agent #3").value).toBe(
      "No contact; retain my draft"
    );
    expect(container.textContent).toContain("server now has version 5");
    expect(mock.mutations[0].input.expectedVersion).toBe(2);
    expect(field("Attendance for agent #3").closest("fieldset")?.disabled).toBe(
      true
    );
  });
  it("creates an explicit linked Academy draft without publishing or course completion", async () => {
    Object.assign(mock.data["staffCalls.get"].participants[0], {
      attendance: "attended",
      privateNotes: "Already saved private notes",
    });
    await render(
      React.createElement(CallDetail, {
        callId: 41,
        context: context as any,
        close: vi.fn(),
        refresh: vi.fn(),
      })
    );
    await change(field("Action title for agent #3"), "Practice follow-up");
    await change(
      field("Action instructions for agent #3"),
      "Write a reflection"
    );
    await click("Create separate Academy Action draft");
    expect(mock.mutations[0]).toMatchObject({
      path: "staffCalls.draftFollowUp",
      input: {
        participantId: 101,
        callId: 41,
        expectedVersion: 2,
        title: "Practice follow-up",
        instructions: "Write a reflection",
        dueAt: null,
      },
    });
    expect(mock.mutations).toHaveLength(1);
    expect(container.textContent).toContain("Draft #87 created");
    expect(mock.mutations[0].input).not.toHaveProperty("courseId");
  });
});
describe("group scheduling and role/privacy boundaries", () => {
  it("participant cancellation uses call version and never cancels the shared session", async () => {
    await render(
      React.createElement(CallScheduling, {
        detail: mock.data["staffCalls.get"],
        actorId: 9,
        connected: true,
        refresh: vi.fn(),
      })
    );
    await click("Cancel invitation for Exact Agent");
    await change(field("Cancellation reason"), "Participant cannot attend");
    expect(mock.mutations).toEqual([]);
    await click("Confirm participant-only cancellation");
    expect(mock.mutations[0]).toMatchObject({
      path: "staffCalls.cancelParticipant",
      input: {
        callId: 41,
        participantId: 101,
        expectedVersion: 7,
        reason: "Participant cannot attend",
      },
    });
    expect(mock.mutations).toHaveLength(1);
  });
  it("whole-session cancellation has separate all-participant confirmation", async () => {
    await render(
      React.createElement(CallScheduling, {
        detail: mock.data["staffCalls.get"],
        actorId: 9,
        connected: true,
        refresh: vi.fn(),
      })
    );
    await click("Cancel whole session");
    expect(container.textContent).toContain(
      "All 2 active participant invitations"
    );
    await change(field("Cancellation reason"), "Host unavailable");
    await click("Confirm whole-session cancellation");
    expect(mock.mutations[0].path).toBe("staffCalls.cancel");
    expect(mock.mutations[0].input).not.toHaveProperty("participantId");
  });
  it("reschedules only using verified slots and expected scheduling version", async () => {
    await render(
      React.createElement(CallScheduling, {
        detail: mock.data["staffCalls.get"],
        actorId: 9,
        connected: true,
        refresh: vi.fn(),
      })
    );
    await click("Choose a reschedule slot");
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    await pickSlot();
    await click("Review new time");
    expect(mock.mutations).toEqual([]);
    await click("Confirm provider reschedule");
    expect(mock.mutations[0]).toMatchObject({
      path: "staffCalls.reschedule",
      input: {
        callId: 41,
        expectedVersion: 7,
        startAt: slot.startAt,
        endAt: slot.endAt,
      },
    });
  });
  it("instructor-only management refusal mounts no diary, hosts or booking hooks", async () => {
    mock.user.role = "agent";
    mock.data["staffCalls.context"] = {
      ...context,
      canManage: false,
      canViewTeam: false,
    };
    await render(React.createElement(StaffCalls));
    expect(container.textContent).toContain(
      "Instructor-only access does not grant"
    );
    expect(enabledPaths()).toEqual(["staffCalls.context"]);
  });
  it("restricted engagement staff query only their own host and never broad CRM", async () => {
    mock.user.role = "agent";
    mock.data["staffCalls.context"] = { ...context, canViewTeam: false };
    await render(React.createElement(StaffCalls));
    expect(
      mock.hooks.find(item => item.path === "staffCalls.diary")?.input
        .hostUserId
    ).toBe(9);
    expect(container.textContent).not.toContain("Other Host");
    expect(enabledPaths().some(path => /crm\.|report/.test(path))).toBe(false);
  });
  it("agent detail excludes other roster/private notes, unpublished recap and reason explanation even if returned", async () => {
    mock.user.role = "agent";
    mock.user.id = 3;
    mock.data["staffCalls.get"].call.reasonExplanation = "PRIVATE REASON";
    mock.data["staffCalls.get"].participants[0].privateNotes = "PRIVATE NOTES";
    mock.data["staffCalls.get"].participants[0].sharedSummary =
      "UNPUBLISHED RECAP";
    mock.data["staffCalls.get"].participants[1].privateNotes =
      "OTHER PERSON PRIVATE";
    mock.data["staffCalls.mine"].actorId = 3;
    await render(React.createElement(AgentCalls));
    await click("Open call #41");
    expect(container.textContent).not.toMatch(
      /PRIVATE REASON|PRIVATE NOTES|UNPUBLISHED RECAP|Second Agent|OTHER PERSON PRIVATE/
    );
    expect(container.textContent).toContain("not explicitly shared");
    expect(enabledPaths()).not.toContain("staffCalls.diary");
    expect(container.querySelector("textarea")).toBeNull();
    mock.data["staffCalls.get"].participants[0].sharedAt = new Date();
    mock.data["staffCalls.get"].participants[0].sharedSummary =
      "OWN SHARED RECAP";
    await render(React.createElement(AgentCalls));
    expect(container.textContent).toContain("OWN SHARED RECAP");
  });
  it("withholds another account's cached own-appointment list after switching users", async () => {
    mock.user.role = "agent";
    mock.user.id = 3;
    mock.data["staffCalls.mine"].actorId = 3;
    await render(React.createElement(AgentCalls));
    expect(container.textContent).toContain("Open call #41");
    mock.user.id = 4;
    await render(React.createElement(AgentCalls));
    expect(container.textContent).not.toContain("Open call #41");
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    mock.data["staffCalls.mine"] = { actorId: 4, items: [], nextCursor: null };
    await render(React.createElement(AgentCalls));
    expect(container.textContent).toContain("No matching call records");
  });
  it("withholds cached management authority belonging to another account", async () => {
    mock.user.id = 20;
    await render(React.createElement(StaffCalls));
    expect(container.textContent).toContain("Checking this account");
    expect(enabledPaths()).toEqual(["staffCalls.context"]);
    expect(container.textContent).not.toContain("Host Nine");
  });
  it("does not display any meeting link for a cancelled own group seat", async () => {
    mock.user.role = "agent";
    mock.user.id = 3;
    mock.data["staffCalls.mine"].actorId = 3;
    mock.data["staffCalls.get"].participants[0].status = "cancelled";
    await render(React.createElement(AgentCalls));
    await click("Open call #41");
    expect(
      container.querySelector('a[href="https://meet.example.test/session"]')
    ).toBeNull();
    expect(container.textContent).toContain("Appointment status: cancelled");
  });
  it("withholds cached call headers and meeting URLs with no exact own participant", async () => {
    mock.user.role = "agent";
    mock.user.id = 3;
    mock.data["staffCalls.mine"].actorId = 3;
    mock.data["staffCalls.get"].participants = [
      { ...participant, agentId: 99 },
    ];
    await render(React.createElement(AgentCalls));
    await click("Open call #41");
    expect(container.textContent).toContain(
      "not been verified for your account"
    );
    expect(container.textContent).not.toContain("Host Nine");
    expect(
      container.querySelector('a[href="https://meet.example.test/session"]')
    ).toBeNull();
  });
  it("only permits HTTPS links without embedded credentials", () => {
    expect(safeMeetingUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeMeetingUrl("http://meet.test")).toBeUndefined();
    expect(safeMeetingUrl("https://user:pass@meet.test")).toBeUndefined();
    expect(safeMeetingUrl("https://meet.test/session")).toBe(
      "https://meet.test/session"
    );
  });
});
describe("admin reports", () => {
  it("does not mount reporting data for restricted staff", async () => {
    mock.user.role = "agent";
    await render(React.createElement(StaffCallReports));
    expect(enabledPaths()).toEqual([]);
    expect(container.textContent).toContain(
      "Administrator reporting access required"
    );
  });
  it("labels session/invitation counts and attendance denominator; errors hide stale report", async () => {
    mock.data["staffCalls.report"] = calculateStaffCallReport(
      { rangeStart: "2026-11-01", rangeEnd: "2026-12-01", basis: "scheduled" },
      [],
      []
    );
    await render(React.createElement(StaffCallReports));
    expect(container.textContent).toContain("Participant invitations");
    expect(container.textContent).toContain("Attended ÷ (attended + no-show)");
    expect(container.textContent).toContain("Not measurable (denominator 0)");
    expect(
      mock.hooks.find(item => item.path === "staffCalls.report")?.input.rangeEnd
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    mock.errors["staffCalls.report"] = { message: "Report permission revoked" };
    await render(React.createElement(StaffCallReports));
    expect(container.textContent).toContain(
      "Previously loaded data is not shown"
    );
    expect(container.textContent).not.toContain("Participant invitations");
  });
});
