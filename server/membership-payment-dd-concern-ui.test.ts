import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  new URL(
    "../client/src/pages/crm/MembershipPaymentIssues.tsx",
    import.meta.url
  ),
  "utf8"
);
const parsed = ts.createSourceFile(
  "MembershipPaymentIssues.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const lastImport = parsed.statements.filter(ts.isImportDeclaration).at(-1)!;
// Execute the actual page and exported DD cell with presentation/query mocks only.
// No browser, router, database, provider or mutation implementation is imported.
const compiledUi = ts.transpileModule(source.slice(lastImport.end), {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

const baseAccount = {
  userId: 42,
  name: "Cancelled member with obligations",
  email: "cancelled@example.test",
  uniqueAgentId: "AGENT-42",
  agentStatus: "cancelled",
  portalStatus: "cancelled",
  isActive: false,
  accountPresent: true,
  outstandingCount: 2,
  outstandingPence: 17400,
  amountUnknown: false,
  failedAttempts: 2,
  mandateStatus: "cancelled",
  mandateId: "MD_CANCELLED",
  subscriptionStatus: "cancelled",
  subscriptionId: "SB_CANCELLED",
  ddIssue: false,
  onboardingDd: false,
  paymentExempt: false,
  pendingFeeCount: 1,
  deliveryIssueCount: 1,
  mailPendingCount: 2,
  mailAcceptedCount: 3,
  historyReviewRequired: true,
  reviewIssue: true,
  lastSyncedAt: "2026-11-03T10:00:00Z",
  lastError: null,
  suspensionReason: null,
  crmHref: "/crm/agents/42",
};

function loadUi(accounts = [baseAccount]) {
  const mutate = vi.fn();
  const refetch = vi.fn();
  const query = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch,
  });
  const useMutation = () => ({
    mutate,
    reset: vi.fn(),
    isPending: false,
    error: null,
  });
  const element =
    (tag: string) =>
    ({ children, className, disabled, ...props }: any) =>
      React.createElement(
        tag,
        {
          className,
          ...(tag === "button" ? { disabled } : {}),
          ...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {}),
        },
        children
      );
  const noIcon = () => null;
  const symbols = {
    exports: {},
    React,
    useMemo: React.useMemo,
    useState: React.useState,
    useAuth: () => ({ user: { role: "admin" } }),
    trpc: {
      useUtils: () => ({}),
      membershipPayments: {
        overview: { useQuery: () => query({}) },
        listIssues: {
          useQuery: () =>
            query({
              items: accounts,
              total: accounts.length,
              page: 1,
              totalPages: 1,
            }),
        },
        refreshFromProvider: { useMutation },
        setAutomation: { useMutation },
        approveFeePolicy: { useMutation },
      },
    },
    Link: element("a"),
    ...Object.fromEntries(
      [
        ["Alert", "div"],
        ["AlertDescription", "div"],
        ["AlertTitle", "h3"],
        ["Badge", "span"],
        ["Button", "button"],
        ["Card", "section"],
        ["CardContent", "div"],
        ["CardHeader", "header"],
        ["CardTitle", "h3"],
        ["Dialog", "div"],
        ["DialogContent", "div"],
        ["DialogDescription", "p"],
        ["DialogHeader", "header"],
        ["DialogTitle", "h3"],
        ["Input", "input"],
        ["Select", "div"],
        ["SelectContent", "div"],
        ["SelectItem", "div"],
        ["SelectTrigger", "div"],
        ["SelectValue", "span"],
        ["Table", "table"],
        ["TableBody", "tbody"],
        ["TableCell", "td"],
        ["TableHead", "th"],
        ["TableHeader", "thead"],
        ["TableRow", "tr"],
      ].map(([name, tag]) => [name, element(tag)])
    ),
    ...Object.fromEntries(
      [
        "AlertTriangle",
        "ArrowRight",
        "ChevronLeft",
        "ChevronRight",
        "Clock",
        "Loader2",
        "RefreshCw",
        "Search",
        "ShieldCheck",
      ].map(name => [name, noIcon])
    ),
  };
  const ui = new Function(
    ...Object.keys(symbols),
    `${compiledUi}\nreturn exports;`
  )(...Object.values(symbols));
  return { ui, mutate, refetch };
}

function renderCell(overrides: Partial<typeof baseAccount> = {}) {
  const { ui } = loadUi();
  return renderToStaticMarkup(
    React.createElement(
      "table",
      null,
      React.createElement(
        "tbody",
        null,
        React.createElement(
          "tr",
          null,
          React.createElement(ui.MembershipPaymentDirectDebitCell, {
            account: { ...baseAccount, ...overrides },
          })
        )
      )
    )
  );
}

const expectedCancellation =
  "Mandate cancelled — expected for a cancelled membership";

describe("membership payment Direct Debit concern presentation", () => {
  it("renders a cancelled membership with arrears neutrally without hiding its other obligations", () => {
    const { ui, mutate, refetch } = loadUi();
    const html = renderToStaticMarkup(React.createElement(ui.default));
    const ddCell = html.match(
      /<td[^>]*><p[^>]*>Mandate cancelled[^]*?<\/td>/
    )?.[0];
    expect(ddCell).toBeDefined();
    expect(ddCell).toContain(expectedCancellation);
    expect(ddCell).not.toContain("text-destructive");
    expect(ddCell).not.toContain("Current DD issue");
    expect(html).toContain(baseAccount.name);
    expect(html).toContain("2 payment(s)");
    expect(html).toContain("£174.00");
    expect(html).toContain("1 fee(s) pending / review");
    expect(html).toContain("1 mail issue(s) · 2 queued");
    expect(html).toContain("Historical review required");
    expect(html).toContain("Review refs");
    expect(html).toContain("Portal access disabled");
    expect(mutate).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("does not describe a cancelled CRM membership as suspended from stale portal status", () => {
    const { ui } = loadUi([{ ...baseAccount, portalStatus: "suspended" }]);
    const html = renderToStaticMarkup(React.createElement(ui.default));
    expect(html).toContain(expectedCancellation);
    expect(html).not.toContain("Suspended:");
    expect(html).not.toContain("Access unchanged.");
    expect(html).toContain("£174.00");
    expect(html).toContain("Historical review required");
  });

  it("still renders suspension information for an effective suspended CRM membership", () => {
    const { ui } = loadUi([
      {
        ...baseAccount,
        agentStatus: "suspended",
        portalStatus: "active",
        ddIssue: true,
      },
    ]);
    const html = renderToStaticMarkup(React.createElement(ui.default));
    expect(html).toContain("Suspended: reason not recorded. Access unchanged.");
    expect(html).toContain("Current DD issue: cancelled");
  });

  it.each(["active", "suspended", "paused"])(
    "keeps a cancelled mandate flagged for %s CRM membership when the server reports ddIssue",
    agentStatus => {
      const html = renderCell({ agentStatus, ddIssue: true });
      expect(html).toContain(
        '<p class="text-destructive font-medium">Current DD issue: cancelled</p>'
      );
      expect(html).not.toContain(expectedCancellation);
      expect(html).toContain("MD_CANCELLED");
      expect(html).toContain("Subscription: cancelled");
      expect(html).toContain("SB_CANCELLED");
    }
  );

  it("keeps server ddIssue authoritative instead of suppressing an explicitly reported concern", () => {
    const html = renderCell({ ddIssue: true });
    expect(html).toContain("Current DD issue: cancelled");
    expect(html).toContain("text-destructive");
    expect(html).not.toContain(expectedCancellation);
  });

  it("preserves payment exemption precedence and neutral styling", () => {
    const html = renderCell({ paymentExempt: true });
    expect(html).toContain("Payment exempt");
    expect(html).not.toContain(expectedCancellation);
    expect(html).not.toContain("Current DD issue");
    expect(html).not.toContain("text-destructive");
  });

  it("preserves onboarding presentation instead of describing it as expected cancellation", () => {
    const html = renderCell({ agentStatus: "onboarding", onboardingDd: true });
    expect(html).toContain("Onboarding — DD setup needed");
    expect(html).not.toContain(expectedCancellation);
    expect(html).not.toContain("text-destructive");
    expect(renderCell({ onboardingDd: true })).toContain(
      "Onboarding — DD setup needed"
    );
  });

  it.each(["active", null])(
    "does not infer an expected cancellation for mandate status %s",
    mandateStatus => {
      const html = renderCell({ mandateStatus });
      expect(html).toContain(`Mandate: ${mandateStatus ?? "not recorded"}`);
      expect(html).not.toContain(expectedCancellation);
    }
  );

  it("does not independently infer ddIssue from membership or mandate status", () => {
    const html = renderCell({ agentStatus: "active", ddIssue: false });
    expect(html).toContain("Mandate: cancelled");
    expect(html).not.toContain("Current DD issue");
    expect(html).not.toContain("text-destructive");
  });

  it("renders the deployment guidance while retaining existing filters", () => {
    const { ui } = loadUi();
    const html = renderToStaticMarkup(React.createElement(ui.default));
    expect(html).toContain(
      "Cancelled CRM memberships are excluded from Direct Debit concerns."
    );
    expect(html).toContain(
      "Active, suspended and paused CRM memberships with cancelled mandates remain Direct Debit concerns unless payment exempt."
    );
    expect(html).toContain(
      "Cancelled memberships can still appear for outstanding payments, fees, mail issues or historical review."
    );
    for (const filter of [
      "All current issues",
      "Outstanding payments",
      "Direct Debit &amp; onboarding",
      "Mail issues &amp; queue",
      "Needs review",
      "Resolved / clear accounts",
    ])
      expect(html).toContain(filter);
  });
});
