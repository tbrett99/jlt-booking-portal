// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFBOARDING_SYSTEM_ITEMS } from "../shared/offboarding-checklist";
const mocks = vi.hoisted(() => ({ save: vi.fn(), invalidate: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/trpc", () => {
  const node = (): any => new Proxy({}, { get: (_target, key) => {
    if (key === "useUtils") return () => node();
    if (key === "invalidate") return mocks.invalidate;
    if (key === "useMutation") return () => ({ mutateAsync: mocks.save, isPending: false });
    return node();
  } });
  return { trpc: node() };
});
import { OffboardingRow } from "../client/src/pages/crm/Memberships";
let root: Root;
let container: HTMLDivElement;
const baseAgent = {
  userId: 101, name: "Synthetic agent", email: "synthetic@example.test", cancelledAt: null,
  supplierLogins: [{ id: 1, supplierName: "Ace Rooms" }, { id: 2, supplierName: "Ace Rooms" }],
  cancelChecklist: [...OFFBOARDING_SYSTEM_ITEMS, "Revoke: Ace Rooms"],
};
let onUpdate: ReturnType<typeof vi.fn>;
async function render(agent: any = baseAgent) {
  await act(async () => root.render(React.createElement(OffboardingRow, { agent, onUpdate })));
}
async function expand() {
  const name = Array.from(container.querySelectorAll("span")).find(el => el.textContent === "Synthetic agent")!;
  await act(async () => name.click());
}
function checkbox(label: string) {
  const el = Array.from(container.querySelectorAll("label")).find(el => el.textContent?.includes(label))!;
  return document.getElementById(el.htmlFor) as HTMLButtonElement;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).React = React;
  vi.clearAllMocks();
  mocks.save.mockReset().mockResolvedValue({ success: true });
  mocks.invalidate.mockResolvedValue(undefined);
  onUpdate = vi.fn().mockResolvedValue({ isError: false });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("rendered offboarding checklist", () => {
  it("shows all checked duplicate-name supplier records as 6/6, one checkbox, and unambiguous scope", async () => {
    await render(); await expand();
    expect(container.textContent).toContain("6/6 done");
    expect(container.textContent).toContain("100%");
    expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(6);
    expect(container.textContent).toContain("All 2 recorded logins");
    const ids = Array.from(container.querySelectorAll('[role="checkbox"]')).map(el => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("ignores stale generic and repeated ticks without hiding a missing current task", async () => {
    await render({ ...baseAgent, cancelChecklist: ["Revoke: Ace Rooms", "Supplier logins revoked", ...Array(10).fill("Topdog login removed")] });
    expect(container.textContent).toContain("2/6 done");
    expect(container.textContent).not.toContain("100%");
  });
  it("reconciles checklist props after a server refresh", async () => {
    await render({ ...baseAgent, cancelChecklist: [] }); await expand();
    expect(checkbox("Ace Rooms").getAttribute("aria-checked")).toBe("false");
    await render();
    expect(checkbox("Ace Rooms").getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("6/6 done");
  });
  it("does not display an unsaved tick after a rejected save", async () => {
    const evidence = [...OFFBOARDING_SYSTEM_ITEMS, "Supplier logins revoked"];
    mocks.save.mockRejectedValue(new Error("Checklist changed"));
    await render({ ...baseAgent, cancelChecklist: evidence }); await expand();
    await act(async () => checkbox("Ace Rooms").click());
    expect(mocks.save).toHaveBeenCalledWith({ userId: 101, expectedChecklist: evidence, checklist: [...evidence, "Revoke: Ace Rooms"] });
    expect(checkbox("Ace Rooms").getAttribute("aria-checked")).toBe("false");
    expect(mocks.error).toHaveBeenCalledWith("Checklist changed");
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("refetches after saving the last task and preserves legacy evidence", async () => {
    const evidence = [...OFFBOARDING_SYSTEM_ITEMS, "Legacy note"];
    await render({ ...baseAgent, cancelChecklist: evidence }); await expand();
    await act(async () => checkbox("Ace Rooms").click());
    expect(mocks.save).toHaveBeenCalledWith({ userId: 101, expectedChecklist: evidence, checklist: [...evidence, "Revoke: Ace Rooms"] });
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(mocks.invalidate).toHaveBeenCalledWith({ userId: 101 });
    expect(container.textContent).toContain("6/6 done");
  });
  it("distinguishes a saved tick from a subsequent failed list refresh", async () => {
    onUpdate.mockResolvedValue({ isError: true });
    await render({ ...baseAgent, cancelChecklist: [...OFFBOARDING_SYSTEM_ITEMS] }); await expand();
    await act(async () => checkbox("Ace Rooms").click());
    expect(checkbox("Ace Rooms").getAttribute("aria-checked")).toBe("true");
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Checklist saved, but the list could not refresh"));
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("blocks repeated submissions while saving and only then shows completion", async () => {
    let resolve!: (value: unknown) => void;
    mocks.save.mockReturnValue(new Promise(res => { resolve = res; }));
    await render({ ...baseAgent, cancelChecklist: [...OFFBOARDING_SYSTEM_ITEMS] }); await expand();
    await act(async () => { checkbox("Ace Rooms").click(); checkbox("Ace Rooms").click(); });
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(checkbox("Ace Rooms").disabled).toBe(true);
    expect(checkbox("Ace Rooms").getAttribute("aria-checked")).toBe("false");
    await act(async () => resolve({ success: true }));
    expect(checkbox("Ace Rooms").getAttribute("aria-checked")).toBe("true");
  });
});
