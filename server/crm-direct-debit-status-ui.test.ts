import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { canLinkGoCardlessMandate } from "../shared/gocardless-mandate-status";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(projectDir, "client/src/pages/crm/AgentCrm.tsx"), "utf8");
// Execute only the actual Direct Debit UI, without importing the unrelated CRM page,
// mounting a browser, or calling any server/database/provider code.
const directDebitSource = source.slice(
  source.indexOf("function DirectDebitTab("),
  source.indexOf("// ─── Admin Onboarding Checklist Tab")
);
const compiledUi = ts.transpileModule(directDebitSource, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const liveSchedule = {
  items: [{ chargeDate: "2026-11-15", amount: 8700, currency: "GBP", source: "subscription_schedule" }],
};
const linkedMandate = { mandateId: "MD_CURRENT_AGENT", status: "active", preferredPaymentDay: 15 };
const subscription = { subscriptionId: "SB_CURRENT_AGENT", amount: 8700, startDate: "2026-01-15", nextChargeDate: "2026-11-15" };
const readableStatus = { mandate: linkedMandate, subscription, replacements: [], replacementHistoryAvailable: true };

type QueryResult = {
  data?: any;
  isLoading?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  error?: Error;
};

function renderTab({
  status = { data: readableStatus },
  schedule = { data: liveSchedule },
  initialMandate = null,
  openForms = false,
}: {
  status?: QueryResult;
  schedule?: QueryResult;
  initialMandate?: any;
  openForms?: boolean;
} = {}) {
  const queryResult = (result: QueryResult) => ({ isLoading: false, isFetching: false, isError: false, refetch: vi.fn(), ...result });
  const useMutation = () => ({ mutate: vi.fn(), isPending: false, error: null });
  const gocardless = {
    adminGetDdStatus: { useQuery: () => queryResult(status) },
    adminGetPaymentSchedule: { useQuery: () => queryResult(schedule) },
    adminGetPaymentEvents: { useQuery: () => queryResult({ data: [] }) },
    ...Object.fromEntries([
      "adminCreateSubscription", "adminRefreshMandateStatus", "adminRequestMandateReplacement",
      "adminLinkReplacementMandate", "sendReceipt", "linkByEmail",
    ].map((name) => [name, { useMutation }])),
  };
  const trpc = {
    useUtils: () => ({ gocardless: { adminListMandates: { invalidate: vi.fn() } } }),
    gocardless,
    crm: { agentCrm: { updateProfile: { useMutation } } },
  };
  const element = (tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children);
  const Dialog = ({ open, children }: any) => open ? React.createElement("div", null, children) : null;
  const noIcon = () => null;
  const symbols = {
    React,
    // Force already-open action forms to verify a query failure cannot leave them actionable.
    useState: (initial: any) => React.useState(openForms && initial === false ? true : initial),
    useEffect: React.useEffect,
    trpc,
    canLinkGoCardlessMandate,
    toast: { success: vi.fn(), error: vi.fn() },
    Button: element("button"),
    Badge: element("span"),
    Dialog,
    DialogContent: element("section"),
    DialogHeader: element("header"),
    DialogTitle: element("h4"),
    DialogDescription: element("p"),
    DialogFooter: element("footer"),
    Label: element("label"),
    Input: element("input"),
    Select: element("div"),
    SelectTrigger: element("div"),
    SelectValue: noIcon,
    SelectContent: element("div"),
    SelectItem: element("div"),
    Checkbox: noIcon,
    Switch: noIcon,
    CreditCard: noIcon,
    Calendar: noIcon,
    Mail: noIcon,
    Clock: noIcon,
    ShieldOff: noIcon,
  };
  const DirectDebitTab = new Function(...Object.keys(symbols), `${compiledUi}\nreturn DirectDebitTab;`)(...Object.values(symbols));
  return renderToStaticMarkup(React.createElement(DirectDebitTab, { userId: 42, mandate: initialMandate }));
}

function expectNoSetupActions(html: string) {
  expect(html).not.toContain("No Direct Debit mandate");
  expect(html).not.toContain("Set Up Direct Debit Manually");
  expect(html).not.toContain("Create Subscription Manually");
  expect(html).not.toContain("Link GC Subscription by Email");
  expect(html).not.toContain("Confirm &amp; Create");
  expect(html).not.toContain("Replace Direct Debit mandate</h4>");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Replace mandate<\/button>/);
}

describe("CRM Direct Debit status UI", () => {
  it.each([
    ["initial loading", { isLoading: true, isFetching: true }],
    ["refetching cached data", { data: readableStatus, isFetching: true }],
    ["no readable query response", {}],
  ])("does not infer a missing mandate or enable setup during %s", (_label, status) => {
    const html = renderTab({ status, initialMandate: { mandateId: "MD_STALE_PROP", status: "active" }, openForms: true });
    expect(html).toContain("Loading Portal Direct Debit status…");
    expectNoSetupActions(html);
    expect(html).toContain("£87.00");
    expect(html).toContain("Refresh schedule");
    expect(html).not.toContain("MD_STALE_PROP");
  });

  it("shows the actual query error, retry, and an independent live schedule without unsafe actions", () => {
    const html = renderTab({
      status: { data: readableStatus, isError: true, error: new Error("Unexpected status read failure") },
      openForms: true,
    });
    expect(html).toContain("The Portal Direct Debit status could not be loaded.");
    expect(html).toContain("Unexpected status read failure");
    expect(html).toContain("Retry Direct Debit status");
    expect(html).toContain("This does not mean there is no mandate in GoCardless.");
    expect(html).toContain("£87.00");
    expectNoSetupActions(html);
  });

  it("honours a successful null over a stale initial mandate and explains the live £87 collection", () => {
    const html = renderTab({
      status: { data: { ...readableStatus, mandate: null, subscription: null } },
      initialMandate: { mandateId: "MD_STALE_PROP", status: "active" },
    });
    expect(html).toContain("A GoCardless collection schedule is available, but the mandate is not linked in the Portal. Do not set up another Direct Debit.");
    expect(html).not.toContain("MD_STALE_PROP");
    expect(html).not.toContain("Set Up Direct Debit Manually");
    expect(html).toContain("Link GC Subscription by Email");
    expect(html).toContain("£87.00");
  });

  it("describes only the Portal linkage when both mandate and schedule are absent", () => {
    const html = renderTab({
      status: { data: { ...readableStatus, mandate: null, subscription: null } },
      schedule: { data: { items: [] } },
    });
    expect(html).toContain("No Direct Debit mandate is linked in the Portal.");
    expect(html).not.toContain("No Direct Debit mandate set up yet");
    expect(html).toContain("Set Up Direct Debit Manually");
    expect(html).toContain("Link GC Subscription by Email");
  });

  it.each([
    ["loading", { isLoading: true, isFetching: true }],
    ["failed", { error: new Error("Schedule lookup failed") }],
  ])("does not offer new manual setup with a null mandate and %s schedule", (_label, schedule) => {
    const html = renderTab({ status: { data: { ...readableStatus, mandate: null, subscription: null } }, schedule });
    expect(html).not.toContain("Set Up Direct Debit Manually");
    expect(html).toContain("No Direct Debit mandate is linked in the Portal.");
  });

  it("keeps mandate/subscription/schedule visible but disables replacement when its schema is unavailable", () => {
    const html = renderTab({ status: { data: { ...readableStatus, replacementHistoryAvailable: false } }, openForms: true });
    expect(html).toContain("MD_CURRENT_AGENT");
    expect(html).toContain("SB_CURRENT_AGENT");
    expect(html).toContain("£87.00");
    expect(html).toContain("Replacement history is temporarily unavailable in the Portal.");
    expect(html).toContain("disabled until the replacement-history database schema is restored");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Replace mandate<\/button>/);
    expect(html).not.toContain("Replace Direct Debit mandate</h4>");
    expect(html).not.toContain("could not be loaded");
  });

  it("preserves replacement and manual creation for readable, compatible status", () => {
    const html = renderTab({ status: { data: { ...readableStatus, subscription: null } } });
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Replace mandate<\/button>/);
    expect(html).toContain("Create Subscription Manually");
    expect(html).not.toContain("Replacement history is temporarily unavailable");
  });

  it("keys the entire per-agent UI, removes stale mandate fallback, and guards replacement confirmation", () => {
    expect(directDebitSource).toContain("<DirectDebitTabForAgent key={props.userId} {...props} />");
    expect(directDebitSource).toContain("const mandate = ddStatus?.mandate ?? null;");
    expect(directDebitSource).not.toContain("setLocalMandate");
    expect(directDebitSource).not.toContain("initialMandate");
    expect(directDebitSource).toContain("disabled={!canReplaceMandate || !replacementConfirmed");
    expect(directDebitSource).toContain("open={showReplaceMandate && canReplaceMandate}");
    expect(directDebitSource.match(/adminGetPaymentSchedule\.useQuery/g)).toHaveLength(1);
    expect(directDebitSource.match(/adminGetDdStatus\.useQuery/g)).toHaveLength(1);
  });
});
