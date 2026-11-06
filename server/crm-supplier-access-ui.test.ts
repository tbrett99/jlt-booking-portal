// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SUPPLIER_ACCESS_NAMES, SUPPLIER_ACCESS_NAME_MAX } from "../shared/supplier-access-catalog";

const mocks = vi.hoisted(() => ({
  catalog: { data: undefined, error: null, isLoading: false, isFetching: false } as any,
  refetch: vi.fn(), addOption: vi.fn(), addLogin: vi.fn(), deleteLogin: vi.fn(),
  invalidateCatalog: vi.fn(), invalidateMemberships: vi.fn(),
  success: vi.fn(), info: vi.fn(), error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, info: mocks.info, error: mocks.error } }));
vi.mock("@/lib/trpc", () => {
  const mutations: Record<string, any> = {
    "crm.agentCrm.addSupplierAccessOption": mocks.addOption,
    "crm.agentCrm.addSupplierLogin": mocks.addLogin,
    "crm.agentCrm.deleteSupplierLogin": mocks.deleteLogin,
  };
  const node = (path = ""): any => new Proxy({}, { get: (_target, key: string) => {
    if (key === "useUtils") return () => node();
    if (key === "useQuery") {
      if (path !== "crm.agentCrm.getSupplierAccessCatalog") throw new Error(`Unexpected query: ${path}`);
      return () => ({ ...mocks.catalog, refetch: mocks.refetch });
    }
    if (key === "useMutation") {
      if (!mutations[path]) throw new Error(`Unexpected mutation: ${path}`);
      return () => ({ mutateAsync: mutations[path], isPending: false });
    }
    if (key === "invalidate") {
      if (path === "crm.agentCrm.getSupplierAccessCatalog") return mocks.invalidateCatalog;
      if (path === "crm.agentCrm.getMembershipsOverview") return mocks.invalidateMemberships;
      throw new Error(`Unexpected invalidation: ${path}`);
    }
    return node(path ? `${path}.${key}` : key);
  } });
  return { trpc: node() };
});
import { CrmSupplierAccess } from "../client/src/components/CrmSupplierAccess";

type Login = { id: number; supplierName: string; notes?: string | null; username?: string | null };
let root: Root;
let container: HTMLDivElement;
let onRefresh: ReturnType<typeof vi.fn>;
async function render(supplierLogins: Login[] = [], userId = 101) {
  await act(async () => root.render(React.createElement(CrmSupplierAccess, { key: userId, userId, supplierLogins, onRefresh })));
}
function checkbox(name: string) {
  const label = Array.from(container.querySelectorAll("label")).find(el => el.textContent === name);
  expect(label, `Label for ${name}`).toBeTruthy();
  const input = document.getElementById(label!.htmlFor) as HTMLInputElement;
  expect(input?.type).toBe("checkbox");
  return input;
}
function supplierLabels() {
  return Array.from(container.querySelectorAll('[role="group"] label')).map(el => el.textContent!);
}
function nameInput() { return container.querySelector('input:not([type="checkbox"])') as HTMLInputElement; }
function button(text: string) {
  const el = Array.from(container.querySelectorAll("button")).find(el => el.textContent === text);
  expect(el, `Button ${text}`).toBeTruthy();
  return el!;
}
async function enterName(value: string) {
  await act(async () => {
    // Native setter bypasses React's tracker, as a real input event does.
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(nameInput(), value);
    nameInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function expectNoAccessChanges() {
  expect(mocks.addLogin).not.toHaveBeenCalled();
  expect(mocks.deleteLogin).not.toHaveBeenCalled();
  expect(mocks.invalidateMemberships).not.toHaveBeenCalled();
  expect(onRefresh).not.toHaveBeenCalled();
}
beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mocks.catalog = { data: { names: [] }, error: null, isLoading: false, isFetching: false };
  mocks.refetch.mockResolvedValue({ data: { names: [] }, isError: false });
  mocks.addOption.mockImplementation(async ({ name }: { name: string }) => ({ name, alreadyExists: false }));
  mocks.addLogin.mockResolvedValue({ id: 501 });
  mocks.deleteLogin.mockResolvedValue({ success: true });
  mocks.invalidateCatalog.mockResolvedValue(undefined);
  mocks.invalidateMemberships.mockResolvedValue(undefined);
  onRefresh = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("rendered CRM supplier access", () => {
  it("keeps defaults unchecked, uses a responsive two-column grid and explains separate global and agent scope", async () => {
    await render();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(DEFAULT_SUPPLIER_ACCESS_NAMES.length);
    for (const name of DEFAULT_SUPPLIER_ACCESS_NAMES) expect(checkbox(name).checked).toBe(false);
    const grid = container.querySelector('[role="group"]')!;
    expect(grid.classList.contains("grid-cols-1")).toBe(true);
    expect(grid.classList.contains("sm:grid-cols-2")).toBe(true);
    expect(container.textContent).toContain("available on all agent records");
    expect(container.textContent).toContain("does not automatically grant access");
    expect(container.textContent).toContain("do not create or revoke supplier accounts");
    expectNoAccessChanges();
  });

  it("renders alphabetically sorted shared options with normalized duplicate identities collapsed", async () => {
    mocks.catalog.data = { names: ["Zulu Supplier", "  ace   rooms ", "ＡＶＩＡＴＥ", "AAA Supplier", "Zulu Supplier"] };
    await render([{ id: 1, supplierName: "  ZULU   Supplier  " }]);
    const labels = supplierLabels();
    expect(labels[0]).toBe("AAA Supplier");
    expect(labels.at(-1)).toBe("Zulu Supplier");
    expect(labels.filter(name => name === "Ace Rooms")).toHaveLength(1);
    expect(labels.filter(name => name === "Aviate")).toHaveLength(1);
    expect(checkbox("Zulu Supplier").checked).toBe(true);
    expectNoAccessChanges();
  });

  it("includes only this agent's legacy names and retains accessible Aviate username text", async () => {
    await render([
      { id: 8, supplierName: "  ＡＶＩＡＴＥ  ", username: "synthetic.aviate@example.test", notes: "Unrelated recorded note" },
      { id: 9, supplierName: "Legacy Independent Supplier" },
    ]);
    const aviate = checkbox("Aviate");
    expect(aviate.checked).toBe(true);
    aviate.focus();
    expect(document.activeElement).toBe(aviate);
    const detail = document.getElementById(aviate.getAttribute("aria-describedby")!)!;
    expect(detail.textContent).toContain("Aviate username: synthetic.aviate@example.test");
    expect(checkbox("Legacy Independent Supplier").checked).toBe(true);
    const ids = Array.from(container.querySelectorAll("input")).map(el => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expectNoAccessChanges();
  });

  it("shows a truthful loading banner while defaults and recorded legacy suppliers remain usable", async () => {
    mocks.catalog = { data: undefined, error: null, isLoading: true, isFetching: true };
    await render([{ id: 1, supplierName: "Legacy Supplier" }]);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading shared supplier list");
    expect(checkbox("Legacy Supplier").checked).toBe(true);
    expect(checkbox("Ace Rooms").disabled).toBe(false);
    expectNoAccessChanges();
  });

  it("shows catalogue failure without hiding known options and offers retry", async () => {
    mocks.catalog = { data: undefined, error: new Error("Synthetic catalogue unavailable"), isLoading: false, isFetching: false };
    await render([{ id: 1, supplierName: "Legacy Supplier" }]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Shared supplier list could not be loaded");
    expect(container.textContent).toContain("other shared options may be missing");
    expect(checkbox("Ace Rooms").checked).toBe(false);
    expect(checkbox("Legacy Supplier").checked).toBe(true);
    await act(async () => button("Retry loading shared list").click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
    mocks.catalog = { data: { names: ["Recovered Supplier"] }, error: null, isLoading: false, isFetching: false };
    await render([{ id: 1, supplierName: "Legacy Supplier" }]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(checkbox("Recovered Supplier").checked).toBe(false);
    expectNoAccessChanges();
  });

  it("retains cached shared names but does not claim a successful catalogue load after an error", async () => {
    mocks.catalog = { data: { names: ["Cached Shared Supplier"] }, error: new Error("Refresh failed"), isLoading: false, isFetching: true };
    await render();
    expect(checkbox("Cached Shared Supplier").checked).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    expect(button("Retrying…").disabled).toBe(true);
  });

  it("adds a global option immediately, normalizes its label, invalidates only the catalogue and never checks it", async () => {
    const refresh = deferred<void>();
    mocks.invalidateCatalog.mockReturnValue(refresh.promise);
    await render();
    await enterName("  Custom   Supplier  ");
    await submit();
    expect(mocks.addOption).toHaveBeenCalledWith({ name: "Custom Supplier" });
    expect(checkbox("Custom Supplier").checked).toBe(false);
    expect(nameInput().value).toBe("");
    expect(mocks.invalidateCatalog).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining("No agent access was changed"));
    expectNoAccessChanges();
    await render(); // A stale catalogue must not discard the just-added option.
    expect(checkbox("Custom Supplier").checked).toBe(false);
    await act(async () => refresh.resolve());
  });

  it("reuses shared options on another agent without transferring recorded access", async () => {
    await render();
    await enterName("Shared Independent Supplier");
    await submit();
    mocks.catalog.data = { names: ["Shared Independent Supplier"] };
    await render([], 202);
    expect(checkbox("Shared Independent Supplier").checked).toBe(false);
    expectNoAccessChanges();
    await act(async () => checkbox("Shared Independent Supplier").click());
    expect(mocks.addLogin).toHaveBeenCalledWith({ userId: 202, supplierName: "Shared Independent Supplier" });
    expect(checkbox("Shared Independent Supplier").checked).toBe(true);
  });

  it("reports a duplicate shared option informationally without granting or removing access", async () => {
    mocks.addOption.mockResolvedValue({ name: "Aviate", alreadyExists: true });
    await render([{ id: 8, supplierName: "Aviate", username: "unchanged.username" }]);
    await enterName("aviate");
    await submit();
    expect(mocks.info).toHaveBeenCalledWith("Aviate is already in the shared supplier list.");
    expect(mocks.success).not.toHaveBeenCalled();
    expect(supplierLabels().filter(name => name === "Aviate")).toHaveLength(1);
    expect(checkbox("Aviate").checked).toBe(true);
    expect(container.textContent).toContain("unchanged.username");
    expectNoAccessChanges();
  });

  it("retains the typed supplier name and announces server validation errors", async () => {
    mocks.addOption.mockRejectedValue(new Error("Cannot save synthetic supplier"));
    await render();
    await enterName("Synthetic Supplier");
    await submit();
    expect(nameInput().value).toBe("Synthetic Supplier");
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Cannot save synthetic supplier");
    expect(mocks.error).toHaveBeenCalledWith("Cannot save synthetic supplier");
    expect(mocks.invalidateCatalog).not.toHaveBeenCalled();
    expect(supplierLabels()).not.toContain("Synthetic Supplier");
    expectNoAccessChanges();
  });

  it.each(["", "   ", "x".repeat(SUPPLIER_ACCESS_NAME_MAX + 1), "Supplier\u0007Name"])(
    "rejects invalid supplier input locally (%j) without any mutation", async value => {
      await render();
      await enterName(value);
      await submit();
      expect(mocks.addOption).not.toHaveBeenCalled();
      expect(nameInput().value).toBe(value);
      expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("1–120 characters"));
      expect(nameInput().getAttribute("aria-invalid")).toBe("true");
      expectNoAccessChanges();
    },
  );

  it("labels the input, sets its maximum length and accepts a name at the boundary", async () => {
    await render();
    expect(nameInput().maxLength).toBe(SUPPLIER_ACCESS_NAME_MAX);
    expect(container.querySelector(`label[for="${nameInput().id}"]`)?.textContent).toBe("Supplier name");
    expect(nameInput().getAttribute("aria-describedby")).toContain("name-limit");
    const name = "x".repeat(SUPPLIER_ACCESS_NAME_MAX);
    await enterName(name);
    await submit();
    expect(mocks.addOption).toHaveBeenCalledWith({ name });
    expect(checkbox(name).checked).toBe(false);
  });

  it("blocks rapid repeated shared-list submissions without blocking agent controls or coupling the operations", async () => {
    const pending = deferred<{ name: string; alreadyExists: boolean }>();
    mocks.addOption.mockReturnValue(pending.promise);
    await render();
    await enterName("Pending Shared Supplier");
    await act(async () => {
      const form = container.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.addOption).toHaveBeenCalledOnce();
    expect(button("Adding supplier…").disabled).toBe(true);
    expect(nameInput().disabled).toBe(true);
    expect(checkbox("Ace Rooms").disabled).toBe(false);
    expectNoAccessChanges();
    await act(async () => pending.resolve({ name: "Pending Shared Supplier", alreadyExists: false }));
    expect(checkbox("Pending Shared Supplier").checked).toBe(false);
    expect(nameInput().disabled).toBe(false);
  });

  it("optimistically checks an explicit toggle, prevents rapid races and uses the returned ID for removal before parent refetch", async () => {
    const pending = deferred<{ id: number }>();
    mocks.addLogin.mockReturnValue(pending.promise);
    await render();
    await act(async () => { checkbox("Ace Rooms").click(); checkbox("Ace Rooms").click(); checkbox("Aviate").click(); });
    expect(mocks.addLogin).toHaveBeenCalledOnce();
    expect(mocks.addLogin).toHaveBeenCalledWith({ userId: 101, supplierName: "Ace Rooms" });
    expect(checkbox("Ace Rooms").checked).toBe(true);
    expect(checkbox("Ace Rooms").disabled).toBe(true);
    expect(checkbox("Aviate").checked).toBe(false);
    await render(); // An unchanged parent snapshot cannot erase a pending toggle.
    expect(checkbox("Ace Rooms").checked).toBe(true);
    await act(async () => pending.resolve({ id: 777 }));
    expect(checkbox("Ace Rooms").checked).toBe(true);
    expect(checkbox("Ace Rooms").disabled).toBe(false);
    expect(mocks.invalidateMemberships).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    await render(); // Confirmed IDs survive a stale refresh too.
    await act(async () => checkbox("Ace Rooms").click());
    expect(mocks.deleteLogin).toHaveBeenCalledWith({ id: 777 });
    expect(checkbox("Ace Rooms").checked).toBe(false);
    expect(mocks.invalidateMemberships).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(mocks.addOption).not.toHaveBeenCalled();
  });

  it("matches normalized recorded labels and removes the actual stored row ID", async () => {
    await render([{ id: 123, supplierName: "  ace   rooms " }]);
    expect(checkbox("Ace Rooms").checked).toBe(true);
    await act(async () => checkbox("Ace Rooms").click());
    expect(mocks.deleteLogin).toHaveBeenCalledWith({ id: 123 });
    expect(checkbox("Ace Rooms").checked).toBe(false);
    expect(mocks.addLogin).not.toHaveBeenCalled();
    await render([{ id: 123, supplierName: "  ace   rooms " }]);
    expect(checkbox("Ace Rooms").checked).toBe(false);
  });

  it("reverts a failed optimistic grant and unlocks controls without invalidating saved data", async () => {
    const pending = deferred<{ id: number }>();
    mocks.addLogin.mockReturnValue(pending.promise);
    await render();
    await act(async () => checkbox("Aviate").click());
    expect(checkbox("Aviate").checked).toBe(true);
    await act(async () => pending.reject(new Error("Synthetic add rejected")));
    expect(checkbox("Aviate").checked).toBe(false);
    expect(checkbox("Aviate").disabled).toBe(false);
    expect(mocks.error).toHaveBeenCalledWith("Synthetic add rejected");
    expect(mocks.invalidateMemberships).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reverts a failed optimistic removal and preserves the recorded Aviate username", async () => {
    const pending = deferred<{ success: boolean }>();
    mocks.deleteLogin.mockReturnValue(pending.promise);
    await render([{ id: 99, supplierName: "Aviate", username: "existing.synthetic.username" }]);
    await act(async () => checkbox("Aviate").click());
    expect(checkbox("Aviate").checked).toBe(false);
    await act(async () => pending.reject(new Error("Synthetic delete rejected")));
    expect(checkbox("Aviate").checked).toBe(true);
    expect(container.textContent).toContain("existing.synthetic.username");
    expect(mocks.error).toHaveBeenCalledWith("Synthetic delete rejected");
    expect(mocks.invalidateMemberships).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reconciles successful changes with parent snapshots without retaining removed records", async () => {
    await render();
    await act(async () => checkbox("Ace Rooms").click());
    await render([{ id: 501, supplierName: "Ace Rooms" }, { id: 600, supplierName: "New Recorded Legacy" }]);
    expect(checkbox("Ace Rooms").checked).toBe(true);
    expect(checkbox("New Recorded Legacy").checked).toBe(true);
    await render([{ id: 600, supplierName: "New Recorded Legacy" }]);
    expect(checkbox("Ace Rooms").checked).toBe(false);
    await act(async () => checkbox("New Recorded Legacy").click());
    await render([]);
    expect(supplierLabels()).not.toContain("New Recorded Legacy");
    await render([{ id: 600, supplierName: "New Recorded Legacy" }]);
    expect(checkbox("New Recorded Legacy").checked).toBe(true);
  });

  it("does not resurrect an earlier saved row when a parent refresh overlaps another pending toggle", async () => {
    await render();
    await act(async () => checkbox("Ace Rooms").click());
    const pending = deferred<{ id: number }>();
    mocks.addLogin.mockReturnValue(pending.promise);
    await act(async () => checkbox("Aviate").click());
    await render([{ id: 501, supplierName: "Ace Rooms" }]);
    await act(async () => pending.resolve({ id: 502 }));
    await render([{ id: 502, supplierName: "Aviate" }]);
    expect(checkbox("Ace Rooms").checked).toBe(false);
    expect(checkbox("Aviate").checked).toBe(true);
    expect(mocks.addLogin).toHaveBeenCalledTimes(2);
  });

  it("disables duplicate normalized recorded rows, explains staff review and never deletes only one", async () => {
    await render([
      { id: 1, supplierName: "Aviate", username: "synthetic.first" },
      { id: 2, supplierName: "  ＡＶＩＡＴＥ ", username: "synthetic.second", notes: "Credentials unverified" },
    ]);
    const input = checkbox("Aviate");
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(true);
    expect(supplierLabels().filter(name => name === "Aviate")).toHaveLength(1);
    const description = document.getElementById(input.getAttribute("aria-describedby")!)!;
    expect(description.textContent).toContain("2 recorded logins — multiple records require staff review");
    expect(description.textContent).toContain("synthetic.first");
    expect(description.textContent).toContain("synthetic.second");
    expect(container.textContent).not.toContain("Credentials unverified");
    expect(container.textContent).not.toContain("Access granted");
    await act(async () => { input.click(); container.querySelector(`label[for="${input.id}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(input.checked).toBe(true);
    expectNoAccessChanges();
  });

  it("keeps list additions independent even while an agent toggle is pending", async () => {
    const pending = deferred<{ id: number }>();
    mocks.addLogin.mockReturnValue(pending.promise);
    await render();
    await act(async () => checkbox("Ace Rooms").click());
    await enterName("Independent Shared Option");
    await submit();
    expect(checkbox("Independent Shared Option").checked).toBe(false);
    expect(checkbox("Ace Rooms").checked).toBe(true);
    expect(mocks.addLogin).toHaveBeenCalledOnce();
    expect(mocks.addOption).toHaveBeenCalledWith({ name: "Independent Shared Option" });
    await act(async () => pending.resolve({ id: 809 }));
    expect(checkbox("Independent Shared Option").checked).toBe(false);
    expect(checkbox("Ace Rooms").checked).toBe(true);
  });

  it("keeps a saved option when catalogue invalidation fails and tells staff it could not refresh", async () => {
    mocks.invalidateCatalog.mockRejectedValue(new Error("Synthetic cache refresh error"));
    await render();
    await enterName("Saved Shared Option");
    await submit();
    expect(checkbox("Saved Shared Option").checked).toBe(false);
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Supplier saved, but the shared list could not refresh"));
    expectNoAccessChanges();
  });

  it("does not roll back a saved supplier record when memberships or agent detail refresh fails", async () => {
    mocks.invalidateMemberships.mockRejectedValue(new Error("Synthetic overview refresh error"));
    onRefresh.mockRejectedValue(new Error("Synthetic detail refresh error"));
    await render();
    await act(async () => checkbox("Ace Rooms").click());
    expect(checkbox("Ace Rooms").checked).toBe(true);
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("memberships overview could not refresh"));
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("agent details could not refresh"));
    expect(mocks.addLogin).toHaveBeenCalledOnce();
  });
});


describe("supplier access persistence verification", () => {
  it.each([0, -1, NaN, undefined, 1.5])("does not show an unverified returned login ID %s as saved", async (id) => {
    mocks.addLogin.mockResolvedValue({ id });
    await render();
    await act(async () => checkbox("Ace Rooms").click());
    expect(checkbox("Ace Rooms").checked).toBe(false);
    expect(mocks.error).toHaveBeenCalledWith("Supplier access could not be verified. Refresh the agent record before retrying.");
    expect(onRefresh).not.toHaveBeenCalled();
    expect(mocks.invalidateMemberships).not.toHaveBeenCalled();
    expect(mocks.deleteLogin).not.toHaveBeenCalled();
  });
});
