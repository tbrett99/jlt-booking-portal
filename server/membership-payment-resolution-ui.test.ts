// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "admin" as string,
  detail: null as any,
  detailFetching: false,
  settlement: vi.fn(),
  feeSettlement: vi.fn(),
  ignore: vi.fn(),
  invalidate: vi.fn(),
  queries: [] as { path: string; options: unknown }[],
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: mocks.role } }),
}));
vi.mock("@/lib/trpc", () => {
  const query = (data: unknown, isFetching = false) => ({
    data,
    isLoading: false,
    isFetching,
    error: null,
    refetch: vi.fn(),
  });
  const node = (path = ""): unknown =>
    new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useUtils") return () => node();
          if (key === "invalidate")
            return (...args: unknown[]) => mocks.invalidate(path, ...args);
          if (key === "useMutation")
            return () => ({
              mutateAsync:
                path === "membershipPayments.recordSettlement"
                  ? mocks.settlement
                  : path === "membershipPayments.recordFeeSettlement"
                    ? mocks.feeSettlement
                    : mocks.ignore,
              mutate: vi.fn(),
              reset: vi.fn(),
              isPending: false,
              error: null,
            });
          if (key === "useQuery")
            return (_input: unknown, options: unknown) => {
              mocks.queries.push({ path, options });
              if (path === "membershipPayments.accountDetail")
                return query(mocks.detail, mocks.detailFetching);
              if (path === "membershipPayments.overview")
                return query({
                  health: {
                    enabled: false,
                    activatedAt: null,
                    controlPresent: true,
                  },
                  counts: {},
                  readAt: new Date("2026-10-01T00:00:00Z"),
                });
              return query({
                items: [mocks.detail.account],
                total: 1,
                page: 1,
                totalPages: 1,
              });
            };
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
  return { trpc: node() };
});
import MembershipPaymentIssues, {
  canIgnoreOutstandingPayment,
} from "../client/src/pages/crm/MembershipPaymentIssues";

let root: Root;
let container: HTMLDivElement;
const payment = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  paymentId: "PM_SYNTHETIC",
  amountPence: 12345,
  currency: "GBP",
  status: "outstanding",
  lastEventAt: new Date("2026-10-01T10:00:45.123Z"),
  lastFailureAt: new Date("2026-10-01T10:00:45.123Z"),
  ...overrides,
});
function deferred() {
  let resolve!: (value?: unknown) => void;
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
function buttons(text: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button")
  ).filter(button => button.textContent?.trim() === text);
}
function button(text: string) {
  const matches = buttons(text);
  expect(matches, `button ${text}`).toHaveLength(1);
  return matches[0];
}
function field(labelText: string) {
  const label = Array.from(document.querySelectorAll("label")).find(label =>
    label.textContent?.includes(labelText)
  );
  expect(label, `label ${labelText}`).toBeTruthy();
  return label!.querySelector<HTMLInputElement>("input")!;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
}
async function fill(label: string, value: string) {
  const input = field(label);
  await act(async () => {
    // Use the native DOM setter, not React's value-tracking setter.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(input.value).toBe(value);
}
async function submit() {
  await act(async () => {
    document
      .querySelector("[role=dialog] form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function render() {
  await act(async () => {
    root.render(React.createElement(MembershipPaymentIssues));
  });
}
async function openReview() {
  await render();
  await click("Review refs");
}
async function openReceipt() {
  await openReview();
  await click("Record payment received");
}
async function receiptDetails(
  at = "2026-10-01T10:00",
  confirmation = " RECORD PAYMENT RECEIVED "
) {
  await fill("Bank transfer reference", " BANK-TEST ");
  await fill("Receipt verification notes", " Verified cleared transfer ");
  await fill("Received at", at);
  await fill("Type RECORD PAYMENT RECEIVED", confirmation);
}
function text() {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.role = "admin";
  mocks.detailFetching = false;
  mocks.queries = [];
  mocks.detail = {
    account: {
      userId: 42,
      name: "Synthetic Test Agent",
      email: "test@example.invalid",
      agentStatus: "active",
      isActive: true,
      crmHref: "/crm/agents/42",
      accountPresent: true,
      outstandingCount: 1,
      outstandingPence: 12345,
      failedAttempts: 1,
      lastFailedAt: new Date("2026-10-01T10:00:45.123Z"),
      lastSyncedAt: new Date("2026-10-01T11:00:00Z"),
      lastError: null,
      suspensionReason: null,
    },
    payments: [payment()],
    fees: [
      {
        id: 9,
        runKey: "synthetic-run",
        triggerEventId: "EV_TEST",
        amountPence: 2500,
        currency: "GBP",
        status: "assessed",
        paymentId: null,
      },
    ],
    mail: [],
    truncated: { payments: false, fees: false, mail: false },
  };
  mocks.settlement.mockResolvedValue({ settlement: { id: 1 } });
  mocks.feeSettlement.mockResolvedValue({ paid: true });
  mocks.ignore.mockResolvedValue({ ignored: true });
  mocks.invalidate.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("receipt form interactions (synthetic data, mocked mutations only)", () => {
  it("uses one bounded, scrollable dialog at a time and returns to account review on cancel", async () => {
    await openReceipt();
    const dialogs = document.querySelectorAll("[role=dialog]");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].className).toContain("max-h-[85dvh]");
    expect(dialogs[0].className).toContain("overflow-y-auto");
    expect(field("Received at").getAttribute("step")).toBe("1");
    expect(text()).toContain(
      "later failed GoCardless retries do not invalidate this receipt"
    );
    await click("Cancel");
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
    expect(text()).toContain("Payment account review");
    expect(mocks.settlement).not.toHaveBeenCalled();
    expect(
      mocks.queries.find(q => q.path === "membershipPayments.accountDetail")
        ?.options
    ).toMatchObject({
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
    });
  });

  it("shows every missing-field reason rather than a silent disabled submit", async () => {
    await openReceipt();
    expect(button("Record verified receipt").disabled).toBe(false);
    await click("Record verified receipt");
    expect(text()).toContain("Enter the verified bank transfer reference");
    expect(text()).toContain("Enter receipt verification notes");
    expect(text()).toContain("Enter a valid received date and time");
    expect(text()).toContain("Type RECORD PAYMENT RECEIVED exactly");
    expect(mocks.settlement).not.toHaveBeenCalled();
  });

  it.each(["2026-10-01T10:00", "2026-10-01T09:59:05"])(
    "accepts actual receipt %s before a later failed attempt, without changing its timestamp",
    async at => {
      await openReceipt();
      await receiptDetails(at);
      await click("Record verified receipt");
      expect(mocks.settlement).toHaveBeenCalledTimes(1);
      expect(mocks.settlement).toHaveBeenCalledWith({
        userId: 42,
        paymentId: "PM_SYNTHETIC",
        amountPence: 12345,
        reference: "BANK-TEST",
        notes: "Verified cleared transfer",
        settledAt: new Date(at).toISOString(),
        confirmation: "RECORD PAYMENT RECEIVED",
      });
      expect(text()).toContain("Receipt recorded. Balances reloaded");
      expect(text()).toContain(
        "membership access and manual suspensions remain unchanged"
      );
      expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
    }
  );

  it("rejects future receipt time and incorrect confirmation visibly", async () => {
    await openReceipt();
    await receiptDetails("2099-10-01T10:00:01", "yes");
    await submit();
    expect(text()).toContain("Received time must not be in the future");
    expect(text()).toContain("Type RECORD PAYMENT RECEIVED exactly");
    expect(mocks.settlement).not.toHaveBeenCalled();
    expect(text()).not.toContain("Balances reloaded");
  });

  it("prevents duplicate requests and dismissal while the mutation and stored-record refresh are pending", async () => {
    const mutation = deferred();
    const refresh = deferred();
    mocks.settlement.mockReturnValue(mutation.promise);
    mocks.invalidate.mockReturnValue(refresh.promise);
    await openReceipt();
    await receiptDetails();
    await click("Record verified receipt");
    expect(button("Recording…").disabled).toBe(true);
    expect(field("Bank transfer reference").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    expect(buttons("Close")).toHaveLength(0);
    await submit();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(text()).toContain("Record payment received");
    expect(mocks.settlement).toHaveBeenCalledTimes(1);
    await act(async () => {
      mutation.resolve({ settlement: { id: 1 } });
    });
    expect(button("Reloading balances…").disabled).toBe(true);
    expect(text()).not.toContain("Balances reloaded");
    await act(async () => {
      refresh.resolve();
    });
    expect(text()).toContain("Receipt recorded. Balances reloaded");
  });

  it("surfaces server rejection without claiming that no uncertain change could have happened", async () => {
    mocks.settlement.mockRejectedValue(
      new Error("Payment is no longer outstanding")
    );
    await openReceipt();
    await receiptDetails();
    await click("Record verified receipt");
    expect(text()).toContain("Payment is no longer outstanding");
    expect(text()).toContain("The change was not confirmed");
    expect(text()).not.toContain("Receipt recorded.");
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(button("Record verified receipt").disabled).toBe(false);
  });

  it("keeps a saved receipt distinct from failed refresh and retries only reads, never a second mutation", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Stored read unavailable"));
    await openReceipt();
    await receiptDetails();
    await click("Record verified receipt");
    expect(text()).toContain("Receipt recorded.");
    expect(text()).toContain("balances could not be reloaded");
    expect(text()).toContain("Displayed balances may be stale");
    expect(text()).not.toContain("Balances reloaded;");
    expect(field("Bank transfer reference").disabled).toBe(true);
    expect(mocks.invalidate).toHaveBeenCalledTimes(6);
    for (const call of mocks.invalidate.mock.calls)
      expect(call.slice(1)).toEqual([
        undefined,
        undefined,
        { throwOnError: true },
      ]);
    mocks.invalidate.mockResolvedValue(undefined);
    await click("Retry balance refresh");
    expect(mocks.settlement).toHaveBeenCalledTimes(1);
    expect(mocks.invalidate).toHaveBeenCalledTimes(12);
    expect(text()).toContain("Receipt recorded. Balances reloaded");
  });

  it("records assessed fee receipts separately without adding a payment timestamp or ignore-fee action", async () => {
    await openReview();
    await click("Record fee received");
    expect(document.querySelector("input[type=datetime-local]")).toBeNull();
    await fill("Bank transfer reference", " FEE-TEST ");
    await fill("Receipt verification notes", " Verified fee transfer ");
    await fill("Type RECORD FEE RECEIVED", "RECORD FEE RECEIVED");
    await click("Record verified receipt");
    expect(mocks.feeSettlement).toHaveBeenCalledTimes(1);
    expect(mocks.feeSettlement).toHaveBeenCalledWith({
      feeId: 9,
      reference: "FEE-TEST",
      notes: "Verified fee transfer",
      confirmation: "RECORD FEE RECEIVED",
    });
    expect(mocks.settlement).not.toHaveBeenCalled();
    expect(mocks.ignore).not.toHaveBeenCalled();
  });
});

describe("payment-only ignore interactions", () => {
  it.each(["admin", "super_admin"])(
    "allows %s a known non-GBP outstanding payment with explicit warnings and exact payload",
    async role => {
      mocks.role = role;
      mocks.detail.payments = [payment({ currency: "EUR" })];
      await openReview();
      expect(buttons("Record payment received")).toHaveLength(0);
      await click("Ignore outstanding payment");
      expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
      expect(text()).toContain(
        "Permanent decision for this exact payment only"
      );
      expect(text()).toContain(
        "No money received. This is not proof of payment"
      );
      expect(text()).toContain(
        "does not cancel GoCardless Direct Debit, provider retries or collections"
      );
      expect(text()).toContain("does not waive fees, reinstate membership");
      await click("Confirm ignore payment");
      expect(text()).toContain("Enter an explicit reason");
      expect(mocks.ignore).not.toHaveBeenCalled();
      await fill(
        "Reason for ignoring this payment",
        " Approved duplicate-payment exception "
      );
      await fill("Type IGNORE OUTSTANDING PAYMENT", "yes");
      await submit();
      expect(mocks.ignore).not.toHaveBeenCalled();
      await fill(
        "Type IGNORE OUTSTANDING PAYMENT",
        " IGNORE OUTSTANDING PAYMENT "
      );
      await click("Confirm ignore payment");
      expect(mocks.ignore).toHaveBeenCalledTimes(1);
      expect(mocks.ignore).toHaveBeenCalledWith({
        userId: 42,
        paymentId: "PM_SYNTHETIC",
        amountPence: 12345,
        reason: "Approved duplicate-payment exception",
        confirmation: "IGNORE OUTSTANDING PAYMENT",
      });
      expect(mocks.settlement).not.toHaveBeenCalled();
      expect(text()).toContain(
        "This outstanding payment was ignored. No money was received or collected. Balances reloaded"
      );
    }
  );

  it("does not expose ignore actions for unknown amounts/currencies or non-outstanding payments", async () => {
    mocks.detail.payments = [
      payment({ amountPence: null }),
      payment({ id: 2, currency: null }),
      payment({ id: 3, status: "paid" }),
      payment({ id: 4, amountPence: 0 }),
    ];
    await openReview();
    expect(buttons("Ignore outstanding payment")).toHaveLength(0);
    for (const role of [undefined, "agent", "finance", "support"])
      expect(canIgnoreOutstandingPayment(role, payment())).toBe(false);
    for (const amountPence of [
      null,
      0,
      -1,
      1.5,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(
        canIgnoreOutstandingPayment("admin", payment({ amountPence }))
      ).toBe(false);
    for (const currency of [null, "", "gbp", "UNKNOWN"])
      expect(canIgnoreOutstandingPayment("admin", payment({ currency }))).toBe(
        false
      );
    for (const status of [
      "settled",
      "ignored",
      "pending",
      "failed",
      "review",
      "paid",
    ])
      expect(
        canIgnoreOutstandingPayment("super_admin", payment({ status }))
      ).toBe(false);
  });

  it("does not expose payment controls to an agent", async () => {
    mocks.role = "agent";
    await render();
    expect(text()).toContain("restricted to authorised staff");
    expect(buttons("Review refs")).toHaveLength(0);
    expect(mocks.ignore).not.toHaveBeenCalled();
  });

  it("keeps an ignored payment distinct from refresh failure and refreshes without repeating the ignore", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Refresh failed"));
    await openReview();
    await click("Ignore outstanding payment");
    await fill("Reason for ignoring this payment", "Approved exception");
    await fill("Type IGNORE OUTSTANDING PAYMENT", "IGNORE OUTSTANDING PAYMENT");
    await click("Confirm ignore payment");
    expect(text()).toContain("Payment ignored; no money received");
    expect(text()).toContain("balances could not be reloaded");
    expect(text()).not.toContain("Balances reloaded;");
    mocks.invalidate.mockResolvedValue(undefined);
    await click("Retry balance refresh");
    expect(mocks.ignore).toHaveBeenCalledTimes(1);
    expect(text()).toContain(
      "No money was received or collected. Balances reloaded"
    );
  });

  it("disables both actions while current account references are refreshing", async () => {
    mocks.detailFetching = true;
    await openReview();
    expect(button("Ignore outstanding payment").disabled).toBe(true);
    expect(button("Record payment received").disabled).toBe(true);
  });
});

describe("stored resolution evidence", () => {
  it("shows receipt evidence and ignored reason without presenting ignore decision time as money received", async () => {
    mocks.detail.payments = [
      payment({
        status: "settled",
        resolutionKind: "received",
        receiptDate: new Date("2026-09-30T09:00:01Z"),
        decisionAt: new Date("2026-10-01T11:00:00Z"),
        resolutionReference: "BANK-AUDIT",
        resolutionNotes: "Verified cleared transfer",
        recordedById: 7,
      }),
      payment({
        id: 2,
        paymentId: "PM_IGNORED",
        status: "ignored",
        resolutionKind: "ignored",
        receiptDate: new Date("2026-10-01T11:00:00Z"),
        decisionAt: new Date("2026-10-01T11:00:00Z"),
        resolutionReference: "IGNORE-AUDIT",
        resolutionNotes: "Approved duplicate exception",
        recordedById: 8,
      }),
    ];
    await openReview();
    const evidence = document.querySelectorAll<HTMLDetailsElement>("details");
    expect(evidence).toHaveLength(2);
    await act(async () => {
      evidence[0].querySelector("summary")!.click();
      evidence[1].querySelector("summary")!.click();
    });
    expect(evidence[0].open).toBe(true);
    expect(evidence[0].textContent).toContain("Actual bank receipt:");
    expect(evidence[0].textContent).toContain("BANK-AUDIT");
    expect(evidence[0].textContent).toContain("Recorded by staff ID: 7");
    expect(evidence[1].textContent).toContain(
      "Ignored payment — no money received."
    );
    expect(evidence[1].textContent).not.toContain("Actual bank receipt:");
    expect(evidence[1].textContent).toContain("Approved duplicate exception");
    expect(evidence[1].textContent).toContain("Decision recorded:");
    expect(buttons("Ignore outstanding payment")).toHaveLength(0);
    expect(buttons("Record payment received")).toHaveLength(0);
    // Unrelated assessed fees remain visible and actionable.
    expect(buttons("Record fee received")).toHaveLength(1);
  });

  it("preserves saved-but-stale receipt feedback when closing after failed balance refresh", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Stored read unavailable"));
    await openReceipt();
    await receiptDetails();
    await click("Record verified receipt");
    // There is the explicit footer Close and a dialog close icon after pending ends.
    const footerClose = document.querySelector<HTMLButtonElement>(
      "[role=dialog] form button[type=button]"
    )!;
    await act(async () => {
      footerClose.click();
    });
    expect(text()).toContain("Payment account review");
    expect(text()).toContain(
      "Receipt recorded. Balance refresh failed; displayed balances may be stale"
    );
    expect(text()).not.toContain("Balances reloaded;");
    expect(mocks.settlement).toHaveBeenCalledTimes(1);
  });
});
