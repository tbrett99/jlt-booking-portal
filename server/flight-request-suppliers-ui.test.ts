// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mutate: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: state.error } }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ flightRequests: { byBooking: { invalidate: vi.fn() }, myRequests: { invalidate: vi.fn() } } }),
  flightRequests: { create: { useMutation: () => ({ mutate: state.mutate, isPending: false }) } },
} }));
import { FlightRequestForm } from "../client/src/components/FlightRequestForm";

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network allowed in synthetic UI tests"); }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(FlightRequestForm, { open: true, onOpenChange: vi.fn(), bookingId: 100, clientName: "Synthetic Traveller" })));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
async function openSelect(id: string) {
  const trigger = document.getElementById(id)!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
}
async function select(id: string, name: string) {
  await openSelect(id);
  const option = Array.from(document.querySelectorAll('[role="option"]')).find(el => el.textContent === name) as HTMLElement;
  expect(option, `Rendered option ${name}`).toBeTruthy();
  await act(async () => option.click());
}
async function input(id: string, value: string) {
  const field = document.getElementById(id) as HTMLInputElement;
  expect(field).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function fillPrimary(prefix = "primary") {
  await input(`${prefix}-pnr`, "syn123");
  await input(`${prefix}-dep`, "2027-02-01");
  await input(`${prefix}-deadline`, "2027-01-01");
  await input("flightCost", "100.25");
}
async function submit() {
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

describe("actual shared flight request supplier dropdown", () => {
  it.each(["Ticketing", "Cancellation", "Ticketing & Cancellation (Both)"])("shows Faremine and preserves every existing option for %s", async label => {
    await select("requestType", label);
    await openSelect("supplier");
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(el => el.textContent)).toEqual(["Aviate", "Lime", "VA Flight Store", "Faremine"]);
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it.each(["Ticketing", "Cancellation"])("submits exact Faremine supplier and unchanged fields for %s", async label => {
    await select("requestType", label); await select("supplier", "Faremine"); await fillPrimary(); await submit();
    expect(state.error).not.toHaveBeenCalled();
    expect(state.mutate).toHaveBeenCalledOnce();
    expect(state.mutate).toHaveBeenCalledWith({ bookingId: 100, requestType: label.toLowerCase(), supplier: "Faremine", pnr: "SYN123", departureDate: new Date("2027-02-01"), ticketingDeadline: new Date("2027-01-01"), flightCost: 100.25 });
  });
  it("submits Faremine in Both mode with distinct ticketing and cancellation fields", async () => {
    await select("requestType", "Ticketing & Cancellation (Both)"); await select("supplier", "Faremine"); await fillPrimary("ticketing");
    await input("cancellation-pnr", "can456"); await input("cancellation-dep", "2027-02-02"); await input("cancellation-deadline", "2027-01-02"); await input("cancellationFlightCost", "50.50"); await submit();
    expect(state.mutate).toHaveBeenCalledOnce();
    expect(state.mutate).toHaveBeenCalledWith({ bookingId: 100, requestType: "both", supplier: "Faremine", pnr: "SYN123", departureDate: new Date("2027-02-01"), ticketingDeadline: new Date("2027-01-01"), flightCost: 100.25, cancellationPnr: "CAN456", cancellationDepartureDate: new Date("2027-02-02"), cancellationTicketingDeadline: new Date("2027-01-02"), cancellationFlightCost: 50.5 });
  });
  it.each(["Aviate", "Lime", "VA Flight Store"])("still submits existing supplier %s", async supplier => {
    await select("requestType", "Ticketing"); await select("supplier", supplier); await fillPrimary(); await submit();
    expect(state.mutate).toHaveBeenCalledOnce(); expect(state.mutate.mock.calls[0][0].supplier).toBe(supplier);
  });
  it("still requires the existing request fields after selecting Faremine", async () => {
    await select("requestType", "Ticketing"); await select("supplier", "Faremine"); await submit();
    expect(state.error).toHaveBeenCalledWith("Please fill in all required fields."); expect(state.mutate).not.toHaveBeenCalled();
  });
});
