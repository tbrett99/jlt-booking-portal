import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MergeAccount,
  MergePreview,
} from "../../../server/agent-merge-contract";

const mocks = vi.hoisted(() => ({
  role: "super_admin" as string,
  stateOverrides: [] as unknown[],
  candidates: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  history: vi.fn(),
  archivedDetails: vi.fn(),
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) =>
      actual.useState(
        mocks.stateOverrides.length ? mocks.stateOverrides.shift() : initial
      ),
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: mocks.role } }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    agentMerge: {
      candidates: { useQuery: mocks.candidates },
      preview: { useQuery: mocks.preview },
      execute: { useMutation: mocks.execute },
      history: { useQuery: mocks.history },
      archivedDetails: { useQuery: mocks.archivedDetails },
    },
  },
}));
vi.mock("@/components/ui/dialog", async () => {
  const { createElement } = await import("react");
  const component = ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children);
  return {
    Dialog: component,
    DialogContent: component,
    DialogHeader: component,
    DialogTitle: component,
    DialogDescription: component,
    DialogFooter: component,
    useDialogComposition: () => ({
      isComposing: () => false,
      setComposing: () => {},
      justEndedComposing: () => false,
      markCompositionEnd: () => {},
    }),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

import {
  AgentMergeDialog,
  canExecuteAgentMerge,
  type MergeConfirmation,
} from "./AgentMergeDialog";
import { AgentMergeHistory, formatMergeTimestamp } from "./AgentMergeHistory";

const source: MergeAccount = {
  id: 12,
  name: "Duplicate Agent",
  email: "duplicate@example.test",
  jltId: "JLT12",
  status: "active",
  lastSignedIn: "2026-10-01T10:00:00Z",
  bookings: 3,
  courses: 2,
  mandates: [{ id: "MD12", status: "active" }],
  subscriptions: [{ id: "SB12", status: "cancelled" }],
};
const primary: MergeAccount = {
  ...source,
  id: 34,
  name: "Primary Agent",
  email: "primary@example.test",
  jltId: "JLT34",
};
const preview: MergePreview = {
  source,
  primary,
  token: "current-preview-token",
  expiresAt: "2099-01-01T00:00:00Z",
  canMerge: true,
  moves: [{ table: "bookings", label: "Bookings", count: 3 }],
  retained: [
    {
      table: "academyEnrollments",
      label: "Original Academy courses",
      count: 2,
      reason: "Preserved under original identity",
    },
  ],
  blockers: [],
  warnings: ["Review the primary payout account."],
};
const review: MergeConfirmation = {
  reason: "Verified matching identity",
  confirmation: "MERGE 12 INTO 34",
  samePersonConfirmed: true,
  primaryChoicesConfirmed: true,
  archivedLearningConfirmed: true,
};

beforeEach(() => {
  mocks.role = "super_admin";
  mocks.stateOverrides = [];
  vi.clearAllMocks();
  mocks.candidates.mockReturnValue({
    data: [source, primary],
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  mocks.preview.mockReturnValue({
    data: preview,
    isError: false,
    isFetching: false,
    isFetchedAfterMount: true,
    refetch: vi.fn(),
  });
  mocks.execute.mockReturnValue({ isPending: false, mutate: vi.fn() });
  mocks.history.mockReturnValue({
    data: { archivedInto: null, entries: [] },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  mocks.archivedDetails.mockReturnValue({
    data: {
      sourceUserId: 12,
      primaryUserId: 34,
      profile: [{ label: "Email", value: source.email }],
      notes: [
        {
          id: 1,
          content: "Original source note",
          authorName: "Admin",
          createdAt: "2026-10-01T10:00:00Z",
        },
      ],
      documents: [{ label: "Original ID", url: "https://example.test/id.pdf" }],
      courses: [
        {
          enrollmentId: 1,
          title: "Original course",
          status: "completed",
          completedAt: "2026-10-01T10:00:00Z",
          attempts: 2,
        },
      ],
      contracts: [
        {
          kind: "Agent contract",
          name: "Original signer",
          signedAt: "2026-10-01T10:00:00Z",
        },
      ],
      actions: [
        {
          id: 1,
          title: "Original Action",
          status: "submitted",
          submittedAt: "2026-10-01T10:00:00Z",
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

function renderDialog(withReview = false) {
  mocks.stateOverrides = [
    "34",
    primary,
    false,
    withReview ? review.reason : "",
    withReview ? review.confirmation : "",
    withReview,
    withReview,
    withReview,
    false,
    null,
    Date.now(),
  ];
  return renderToStaticMarkup(
    React.createElement(AgentMergeDialog, {
      open: true,
      onOpenChange: vi.fn(),
      sourceUserId: 12,
      sourceName: source.name!,
      onMerged: vi.fn(),
    })
  );
}
function submitButton(html: string) {
  return html.match(/<button[^>]*>Merge source #12 into #34<\/button>/)?.[0];
}

describe("agent merge confirmation safeguards", () => {
  it("allows only the exact pair, fresh unblocked token and all confirmations", () => {
    expect(canExecuteAgentMerge(preview, 12, 34, review)).toBe(true);
    for (const key of [
      "samePersonConfirmed",
      "primaryChoicesConfirmed",
      "archivedLearningConfirmed",
    ] as const)
      expect(
        canExecuteAgentMerge(preview, 12, 34, { ...review, [key]: false })
      ).toBe(false);
    for (const confirmation of [
      "merge 12 into 34",
      "MERGE 34 INTO 12",
      " MERGE 12 INTO 34",
      "MERGE 12 INTO 34 ",
    ])
      expect(
        canExecuteAgentMerge(preview, 12, 34, { ...review, confirmation })
      ).toBe(false);
    expect(
      canExecuteAgentMerge(preview, 12, 34, { ...review, reason: " short " })
    ).toBe(false);
    expect(canExecuteAgentMerge(preview, 34, 12, review)).toBe(false);
    expect(canExecuteAgentMerge(preview, 12, 12, review)).toBe(false);
    expect(canExecuteAgentMerge(undefined, 12, 34, review)).toBe(false);
  });
  it("rejects missing, expired or invalid tokens, server refusal and blockers", () => {
    for (const patch of [
      { token: "" },
      { token: " " },
      { expiresAt: "2000-01-01T00:00:00Z" },
      { expiresAt: "invalid" },
      { canMerge: false },
      { blockers: ["Two active mandates"] },
    ])
      expect(
        canExecuteAgentMerge({ ...preview, ...patch }, 12, 34, review)
      ).toBe(false);
    expect(
      canExecuteAgentMerge(
        preview,
        12,
        34,
        review,
        Date.parse(preview.expiresAt)
      )
    ).toBe(false);
  });
});

describe("mocked merge UI renders", () => {
  it.each(["admin", "agent", "consumer"])(
    "does not mount merge queries or controls for %s",
    role => {
      mocks.role = role;
      expect(
        renderToStaticMarkup(
          React.createElement(AgentMergeDialog, {
            open: true,
            onOpenChange: vi.fn(),
            sourceUserId: 12,
            sourceName: "Duplicate",
            onMerged: vi.fn(),
          })
        )
      ).toBe("");
      expect(mocks.candidates).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
    }
  );
  it("only enables candidate search for open dialogs with at least two characters", () => {
    renderToStaticMarkup(
      React.createElement(AgentMergeDialog, {
        open: true,
        onOpenChange: vi.fn(),
        sourceUserId: 12,
        sourceName: "Duplicate",
        onMerged: vi.fn(),
      })
    );
    expect(mocks.candidates).toHaveBeenCalledWith(
      { search: "" },
      expect.objectContaining({ enabled: false })
    );
    renderDialog();
    expect(mocks.candidates).toHaveBeenLastCalledWith(
      { search: "34" },
      expect.objectContaining({ enabled: true })
    );
  });
  it("renders account evidence, mandate references, archive semantics and disabled confirmation", () => {
    const html = renderDialog();
    expect(html).toContain("SOURCE — duplicate to archive");
    expect(html).toContain("PRIMARY — account to KEEP");
    expect(html).toContain("MD12");
    expect(html).toContain("SB12");
    expect(html).toContain("3 bookings · 2 courses");
    expect(html).toContain("not blended");
    expect(html).toContain("payout bank details");
    expect(html).toContain("MERGE 12 INTO 34");
    expect(submitButton(html)).toContain(' disabled=""');
  });
  it("enables submission only after all confirmations", () => {
    expect(submitButton(renderDialog(true))).not.toContain(' disabled=""');
  });
  it.each([
    { isFetchedAfterMount: false },
    { isFetching: true },
    { data: { ...preview, blockers: ["Resolve active subscriptions"] } },
    { data: { ...preview, expiresAt: "2000-01-01T00:00:00Z" } },
    { data: { ...preview, primary: source } },
    { isError: true, error: { message: "Merge schema pending" } },
  ])(
    "disables execution for stale, blocked, expired or failed previews: %j",
    patch => {
      mocks.preview.mockReturnValue({
        data: preview,
        isError: false,
        isFetching: false,
        isFetchedAfterMount: true,
        refetch: vi.fn(),
        ...patch,
      });
      expect(submitButton(renderDialog(true))).toContain(' disabled=""');
    }
  );
});

describe("merge history", () => {
  it("does not mount history queries for other roles", () => {
    mocks.role = "agent";
    expect(
      renderToStaticMarkup(
        React.createElement(AgentMergeHistory, { userId: 12 })
      )
    ).toBe("");
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it.each(["admin", "super_admin"])(
    "renders immutable history and source links for %s",
    role => {
      mocks.role = role;
      mocks.history.mockReturnValue({
        data: {
          archivedInto: 34,
          entries: [
            {
              id: 1,
              sourceUserId: 12,
              primaryUserId: 34,
              sourceName: source.name,
              sourceEmail: source.email,
              sourceJltId: source.jltId,
              actorName: "SuperAdmin",
              reason: review.reason,
              mergedAt: "2026-11-03 19:00:00",
              moves: preview.moves,
              retained: preview.retained,
            },
          ],
        },
      });
      const html = renderToStaticMarkup(
        React.createElement(AgentMergeHistory, { userId: 12 })
      );
      expect(html).toContain("Archived duplicate");
      expect(html).toContain(review.reason);
      expect(html).not.toContain("/admin/academy/insights?agent=12");
      expect(html).not.toContain("/crm/agents?agent=12");
      expect(html).toContain("View original CRM, Academy &amp; Actions — read-only");
      expect(html).toContain("read-only history");
      expect(html).not.toContain("snapshot");
    }
  );
  it("renders the admin-only archived modal as immutable source provenance, never edits", () => {
    mocks.stateOverrides = [12];
    const html = renderToStaticMarkup(
      React.createElement(AgentMergeHistory, { userId: 34 })
    );
    expect(mocks.archivedDetails).toHaveBeenCalledWith(
      { sourceUserId: 12 },
      { retry: false }
    );
    expect(html).toContain("Original source note");
    expect(html).toContain("Original ID");
    expect(html).toContain("Original course");
    expect(html).toContain("Original Action");
    expect(html).toContain("Original signer");
    expect(html).toContain("not been re-signed");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("Close read-only record");
  });
  it("shows an actionable archived-details error rather than false empty sections", () => {
    mocks.stateOverrides = [12];
    mocks.archivedDetails.mockReturnValue({
      isError: true,
      error: { message: "Merge schema pending" },
      refetch: vi.fn(),
    });
    const html = renderToStaticMarkup(
      React.createElement(AgentMergeHistory, { userId: 34 })
    );
    expect(html).toContain("Archived source details are unavailable");
    expect(html).toContain("Retry archived details");
    expect(html).not.toContain("No source courses recorded");
  });
  it("does not pretend a pending schema or failed query is empty history", () => {
    mocks.history.mockReturnValue({
      isError: true,
      error: { message: "Merge schema pending" },
      refetch: vi.fn(),
    });
    const html = renderToStaticMarkup(
      React.createElement(AgentMergeHistory, { userId: 12 })
    );
    expect(html).toContain("Merge history is unavailable");
    expect(html).toContain("complete the database migration");
    expect(html).toContain("Retry merge history");
    expect(html).not.toContain("No merges are recorded");
  });
  it("treats timezone-less stored timestamps as UTC and renders local timezone", () => {
    expect(formatMergeTimestamp("2026-11-03 19:00:00")).toBe(
      formatMergeTimestamp("2026-11-03T19:00:00Z")
    );
    expect(formatMergeTimestamp("invalid")).toBe("Date unavailable");
    expect(formatMergeTimestamp(null)).toBe("Not recorded");
  });
});
