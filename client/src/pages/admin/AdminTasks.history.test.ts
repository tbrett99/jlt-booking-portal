// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  user: { id: 47, name: "Max", email: "max@example.test" } as any,
  data: {} as Record<string, any>,
  mutations: [] as { path: string; input: any }[],
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => {
  const proxy = (parts: string[] = []): any => new Proxy(() => undefined, {
    get: (_target, property: string) => {
      if (property === "useQuery") return () => ({ data: mock.data[parts.join(".")], isLoading: false, isError: false, refetch: vi.fn() });
      if (property === "useMutation") return (options: any = {}) => ({ isPending: false, mutate: (input: any) => { mock.mutations.push({ path: parts.join("."), input }); options.onSuccess?.({}, input); } });
      if (property === "useUtils") return () => proxy(["utils"]);
      if (property === "invalidate") return vi.fn();
      return proxy([...parts, property]);
    },
  });
  return { trpc: proxy() };
});
// Use a native, accessible select adapter to exercise the page's real state,
// options and events without relying on Radix pointer layout in happy-dom.
vi.mock("@/components/ui/select", async () => {
  const { createContext, useContext } = await import("react");
  const Context = createContext<any>({});
  return {
    Select: ({ value, onValueChange, children }: any) => React.createElement(Context.Provider, { value: { value, onValueChange } }, children),
    SelectTrigger: ({ children, ...props }: any) => React.createElement("div", { "data-select-label": props["aria-label"] }, children),
    SelectValue: () => null,
    SelectContent: ({ children }: any) => {
      const context = useContext(Context);
      return React.createElement("select", { value: context.value ?? "", onChange: (event: any) => context.onValueChange(event.target.value) }, context.value === undefined ? React.createElement("option", { value: "" }, "Keep original owner until selected") : null, children);
    },
    SelectItem: ({ value, children }: any) => React.createElement("option", { value }, children),
  };
});

import AdminTasks from "./AdminTasks";
import AdminDashboard from "./AdminDashboard";

let container: HTMLDivElement;
let root: Root;
const date = new Date("2026-10-10T12:00:00Z");
function task(id: number, assigneeId: number, title: string, status = "done") {
  return { id, title, status, assigneeId, assigneeName: assigneeId === 760 ? "Max original account" : assigneeId === 47 ? "Max" : "Other admin", priority: "medium", description: "Preserved details", createdAt: date, updatedAt: date, dueDate: null, recurrenceRule: "none", linkedType: "none", linkedId: null, completedAt: status === "done" ? date : null, completedById: 760, completedByName: "Original completer", acknowledgedAt: date, acknowledgedById: 23, acknowledgedByName: "Original acknowledger", createdById: 23, creatorName: "Original creator" };
}
async function render(component: typeof AdminTasks | typeof AdminDashboard) {
  await act(async () => root.render(React.createElement(component)));
}
async function click(text: string, scope: ParentNode = document.body) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim().startsWith(text));
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => button!.click());
}
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function ownerFilter() { return container.querySelector<HTMLSelectElement>("select")!; }
function titles() { return [...container.querySelectorAll("h3")].map(item => item.textContent); }
function dialog() { return document.querySelector<HTMLElement>('[role="dialog"]')!; }
async function editHistorical() {
  await render(AdminTasks);
  await click("Completed");
  const edit = container.querySelector<HTMLButtonElement>('#task-2 button[title="Edit task"]')!;
  await act(async () => edit.click());
  expect(dialog()).toBeTruthy();
}

beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/admin/tasks");
  mock.user = { id: 47, name: "Max", email: "max@example.test" };
  mock.mutations = [];
  mock.data = {
    "users.listAdmins": [{ id: 47, name: "Max", email: "max@example.test", identityUserIds: [47, 760] }, { id: 23, name: "Other admin", email: "other@example.test", identityUserIds: [23] }],
    "tasks.list": [task(1, 47, "Current Max completed record"), task(2, 760, "Original historical task title"), task(3, 23, "Other completed record"), task(4, 47, "Current active assignment", "open")],
    "tasks.getComments": [{ id: 90, authorId: 760, authorName: "Original comment author", content: "Original update content", createdAt: date }],
    "bookings.quickSearch": [],
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("rendered preserved task account history", () => {
  it("includes both 47 and 760 in Mine and specific Max completed filters, with one owner entry", async () => {
    await render(AdminTasks);
    await click("Completed");
    const picker = ownerFilter();
    expect([...picker.options].filter(option => option.text === "Max")).toHaveLength(1);
    expect([...picker.options].map(option => option.value)).not.toContain("user:760");
    expect(picker.textContent).toContain("Mine (including preserved history)");
    await choose(picker, "mine");
    expect(titles()).toEqual(["Current Max completed record", "Original historical task title"]);
    await choose(ownerFilter(), "user:47");
    expect(titles()).toEqual(["Current Max completed record", "Original historical task title"]);
    expect(container.textContent).toContain("Audited task-account links");
    expect(container.textContent).toContain("does not merge other account records");
  });
  it("keeps the old title, original assignee, lifecycle actors and comment attribution", async () => {
    const original = structuredClone(mock.data["tasks.list"]);
    await render(AdminTasks);
    await click("Completed");
    const historical = container.querySelector<HTMLElement>("#task-2")!;
    expect(historical.textContent).toContain("Original historical task title");
    expect(historical.textContent).toContain("Max original account · You");
    expect(historical.textContent).toContain("Original account history");
    expect(historical.textContent).toContain("Completed by Original completer");
    expect(historical.textContent).toContain("Acknowledged by Original acknowledger");
    expect(historical.querySelector('[title*="Original assignee:"]')?.getAttribute("title")).toContain("#760");
    await click("1 updates", historical);
    expect(historical.textContent).toContain("Original comment author");
    expect(historical.textContent).toContain("Original update content");
    expect(mock.data["tasks.list"]).toEqual(original);
    expect(mock.mutations).toEqual([]);
    expect(container.querySelector("#task-1")?.textContent).not.toContain("Original account history");
    expect(container.querySelector("#task-3")?.textContent).not.toContain("Original account history");
  });
  it("does not infer inherited history from a matching name or badge an unlinked account", async () => {
    mock.data["users.listAdmins"][0].identityUserIds = [47];
    await render(AdminTasks);
    await click("Completed");
    expect(container.querySelector("#task-2")?.textContent).not.toContain("Original account history");
    await choose(ownerFilter(), "user:47");
    expect(titles()).toEqual(["Current Max completed record"]);
    await choose(ownerFilter(), "mine");
    expect(titles()).toEqual(["Current Max completed record"]);
  });
  it("uses the simple original-history badge for a supplied legacy-email identity too", async () => {
    mock.data["users.listAdmins"][0].identityUserIds.push(761);
    mock.data["tasks.list"].push(task(5, 761, "Legacy email record"));
    await render(AdminTasks);
    await click("Completed");
    await choose(ownerFilter(), "user:47");
    expect(container.querySelector("#task-5")?.textContent).toContain("Original account history");
  });
  it("saves historical edits without submitting any ownership or actor changes", async () => {
    await editHistorical();
    expect(dialog().textContent).toContain("Max original account");
    expect(dialog().textContent).toContain("#760");
    expect(dialog().textContent).toContain("Preserved unless you explicitly choose a new owner");
    expect(dialog().querySelectorAll("select")).toHaveLength(1); // Priority only.
    await click("Save changes", dialog());
    expect(mock.mutations).toEqual([{ path: "tasks.update", input: { id: 2, title: "Original historical task title", description: "Preserved details", priority: "medium" } }]);
  });
  it("opening the new-owner picker alone preserves history and never offers retired 760", async () => {
    await editHistorical();
    await click("Change owner", dialog());
    const picker = dialog().querySelectorAll("select")[1];
    expect([...picker.options].map(option => option.value)).toEqual(["", "unassigned", "47", "23"]);
    await click("Save changes", dialog());
    expect(mock.mutations[0].input).not.toHaveProperty("assigneeId");
  });
  it("changes ownership only when an active owner is explicitly selected", async () => {
    await editHistorical();
    await click("Change owner", dialog());
    await choose(dialog().querySelectorAll("select")[1], "47");
    await click("Save changes", dialog());
    expect(mock.mutations[0].input.assigneeId).toBe(47);
    expect(mock.mutations[0].input).not.toHaveProperty("completedById");
    expect(mock.mutations[0].input).not.toHaveProperty("createdById");
  });
  it("keeps the new-task picker active-only and defaults to primary account 47", async () => {
    await render(AdminTasks);
    await click("New task");
    const picker = [...dialog().querySelectorAll("select")].find(select => [...select.options].some(option => option.value === "47"))!;
    expect(picker.value).toBe("47");
    expect([...picker.options].map(option => option.value)).not.toContain("760");
  });
});

describe("rendered dashboard focus preview", () => {
  it("labels the limited preview, not a total, and exposes a usable full-task link", async () => {
    mock.data["dashboard.workboard"] = {
      myTasks: Array.from({ length: 12 }, (_, index) => task(index + 100, 47, `Preview task ${index}`, "open")),
      navigationCounts: { tasks: 19, messages: 0, today: 0, cancellations: 0, checks: 0, queues: 0, membership: 0, agentWins: 0 },
      unreadMessageCount: 0, cancellations: { count: 0 }, membership: { active: 0, paused: 0, inNotice: 0, suspended: 0 }, changeRequests: { count: 0 },
    };
    await render(AdminDashboard);
    const heading = [...container.querySelectorAll("h2")].find(item => item.textContent === "My task focus")!;
    const header = heading.closest('[class*="px-4"]')!;
    expect(header.textContent).toContain("Showing 12");
    expect(header.textContent).toContain("Up to 12 outstanding tasks · View all tasks");
    expect(header.textContent).not.toContain("12 items");
    const link = [...header.querySelectorAll<HTMLAnchorElement>("a")].find(item => item.textContent === "View all tasks")!;
    expect(link.getAttribute("href")).toBe("/admin/tasks");
    expect(container.textContent).toContain("19 tasks need attention");
    expect(container.querySelector('a[href="/admin/tasks?task=100"]')).toBeTruthy();
    await act(async () => link.click());
    expect(window.location.pathname).toBe("/admin/tasks");
  });
});
