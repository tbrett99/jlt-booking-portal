// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Option = { id: number; title: string; category: string; state: string };
type LinkInput = {
  type: "guides" | "reports";
  scope: "active" | "published";
  selectedId?: number | null;
  page: number;
  search?: string;
  excludeId?: number;
};
type LinkData = {
  items: Option[];
  selected: Option | null;
  total: number;
  page: number;
  pageSize: number;
};
const mocks = vi.hoisted(() => ({
  state: {} as {
    data?: LinkData;
    isError?: boolean;
    isLoading?: boolean;
    isFetching?: boolean;
    error?: unknown;
  },
  queries: [] as {
    input: LinkInput;
    options: {
      placeholderData?: unknown;
      staleTime?: number;
      enabled?: boolean;
    };
  }[],
  refetch: vi.fn(),
  invalidateAuth: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    staffHandbook: {
      linkOptions: {
        useQuery: (
          input: LinkInput,
          options: {
            placeholderData?: unknown;
            staleTime?: number;
            enabled?: boolean;
          }
        ) => {
          mocks.queries.push({ input, options });
          return {
            isError: false,
            isLoading: false,
            isFetching: false,
            refetch: mocks.refetch,
            ...mocks.state,
          };
        },
      },
    },
    useUtils: () => ({ auth: { me: { invalidate: mocks.invalidateAuth } } }),
  },
}));
import { StaffHandbookLinkedItem } from "./StaffHandbookLinkedItem";
import { HandbookLinkPicker } from "./StaffHandbookLinkPicker";
import { HandbookAccessBoundary } from "./StaffHandbookComponents";

const publishedTitle = "Reimbursement documents checklist";
const draftTitle = "Supplier escalation working notes";
const reportTitle = "Which reimbursement documents should we ask for?";
const warning =
  "This report was answered before, but its linked guide is not currently published. Check or replace the guide.";
const guide: Option = {
  id: 761,
  title: publishedTitle,
  category: "Operations",
  state: "published",
};
let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;
let onOpen: ReturnType<typeof vi.fn>;
let onChange: ReturnType<typeof vi.fn>;
function result(selected: Option | null, items: Option[] = []): LinkData {
  return { selected, items, total: items.length, page: 1, pageSize: 20 };
}
async function render(element: React.ReactElement) {
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: cache },
        React.createElement(HandbookAccessBoundary, null, element)
      )
    );
  });
}
async function linked(
  props: Partial<React.ComponentProps<typeof StaffHandbookLinkedItem>> = {}
) {
  await render(
    React.createElement(StaffHandbookLinkedItem, {
      type: "guides",
      id: guide.id,
      onOpen,
      ...props,
    })
  );
}
async function picker(
  props: Partial<React.ComponentProps<typeof HandbookLinkPicker>> = {}
) {
  await render(
    React.createElement(HandbookLinkPicker, {
      type: "guides",
      value: guide.id,
      label: "Guide to link",
      onChange,
      ...props,
    })
  );
}
function button(label: string) {
  const found = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).find(el => el.textContent?.replace(/\s+/g, " ").trim() === label);
  expect(found, `button ${label}`).toBeTruthy();
  return found!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function lastQuery() {
  return mocks.queries.at(-1)!;
}
function expectNoIds() {
  expect(container.textContent).not.toMatch(/761|982|#\d+|\bID\b/);
  expect(container.querySelector("a, input[type=number]")).toBeNull();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden");
    })
  );
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => {
    throw new Error("Network forbidden");
  });
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  mocks.queries = [];
  mocks.state = { data: result(guide) };
  mocks.refetch.mockResolvedValue(undefined);
  mocks.invalidateAuth.mockResolvedValue(undefined);
  onOpen = vi.fn();
  onChange = vi.fn();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  cache.clear();
  expect(fetch).not.toHaveBeenCalled();
  expect(XMLHttpRequest.prototype.open).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("readonly private handbook linked items", () => {
  it("resolves the current published guide label and opens only via the parent callback", async () => {
    await linked({ publishedOnly: true });
    expect(lastQuery()).toEqual({
      input: { type: "guides", scope: "published", selectedId: 761, page: 1 },
      options: { placeholderData: undefined, staleTime: 0 },
    });
    expect(container.textContent).toContain("Operations · Published");
    expect(container.textContent).not.toContain(warning);
    expectNoIds();
    await click(`Read ${publishedTitle}`);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(761);
  });

  it("defaults ordinary links to active scope and displays a linked draft without claiming it is published", async () => {
    mocks.state.data = result({ ...guide, title: draftTitle, state: "draft" });
    await linked();
    expect(lastQuery().input).toEqual({
      type: "guides",
      scope: "active",
      selectedId: 761,
      page: 1,
    });
    expect(container.textContent).toContain(`${draftTitle}Operations · Draft`);
    expect(container.textContent).not.toMatch(/Published|guide is available/);
    expectNoIds();
    await click(`Read ${draftTitle}`);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(761);
  });

  it.each(["missing", "draft", "archived"])(
    "never claims an answered guide is available when its current published selection is %s",
    async reason => {
      await linked({ publishedOnly: true });
      mocks.state.data = result(null, [
        { ...guide, title: `Unrelated ${reason} guide` },
      ]);
      await linked({ publishedOnly: true });
      expect(container.textContent).toContain(warning);
      expect(container.textContent).not.toContain(publishedTitle);
      expect(container.textContent).not.toContain(`Unrelated ${reason} guide`);
      expect(container.textContent).not.toContain(
        "A published guide is available"
      );
      expect(container.querySelector("button")).toBeNull();
      expectNoIds();
      expect(onOpen).not.toHaveBeenCalled();
    }
  );

  it.each(["draft", "in_review", "changes", "archived"])(
    "also suppresses unexpected %s labels in published-only scope",
    async state => {
      mocks.state.data = result({
        ...guide,
        title: "Hidden revision title",
        state,
      });
      await linked({ publishedOnly: true });
      expect(container.textContent).toContain(warning);
      expect(container.textContent).not.toContain("Hidden revision title");
      expect(container.querySelector("button")).toBeNull();
    }
  );

  it("uses correct current-availability wording for an ordinary missing guide or report", async () => {
    mocks.state.data = result(null);
    await linked();
    expect(container.textContent).toContain(
      "The linked guide is not currently available here. Check or replace the link."
    );
    expect(container.textContent).not.toContain("answered before");
    await linked({ type: "reports" });
    expect(container.textContent).toContain(
      "The linked report is not currently available here. Check or replace the link."
    );
    expectNoIds();
  });

  it("does not open an archived guide even if an active lookup unexpectedly returns it", async () => {
    mocks.state.data = result({ ...guide, state: "archived" });
    await linked();
    expect(container.textContent).not.toContain(publishedTitle);
    expect(container.textContent).toContain("not currently available here");
    expect(container.querySelector("button")).toBeNull();
  });

  it("follows a named report with category and status, no IDs or imperative URL navigation", async () => {
    mocks.state.data = result({
      id: 982,
      title: reportTitle,
      category: "Operations",
      state: "assigned",
    });
    const previousUrl = window.location.href;
    await linked({ type: "reports", id: 982, publishedOnly: true });
    expect(lastQuery().input).toEqual({
      type: "reports",
      scope: "active",
      selectedId: 982,
      page: 1,
    });
    expect(container.textContent).toContain(
      "Operations · Someone is working on it"
    );
    expectNoIds();
    await click(`Follow report ${reportTitle}`);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(982);
    expect(window.location.href).toBe(previousUrl);
  });

  it("rejects a previous selected ID and does not fall back to a matching item in the list", async () => {
    mocks.state.data = result(guide, [
      { ...guide, id: 982, title: "List-only title" },
    ]);
    await linked({ id: 982, publishedOnly: true });
    expect(container.textContent).toContain(warning);
    expect(container.textContent).not.toContain(publishedTitle);
    expect(container.textContent).not.toContain("List-only title");
    expect(container.querySelector("button")).toBeNull();
  });

  it.each(["guides", "reports"] as const)(
    "withholds cached %s titles while loading and provides no open action",
    async type => {
      mocks.state.isLoading = true;
      await linked({ type });
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        `Loading linked ${type === "guides" ? "guide" : "report"}…`
      );
      expect(container.textContent).not.toContain(publishedTitle);
      expect(container.querySelector("button")).toBeNull();
    }
  );

  it.each(["guides", "reports"] as const)(
    "hides stale %s titles on error and retries inline without opening or mutating",
    async type => {
      await linked({ type });
      expect(container.textContent).toContain(publishedTitle);
      mocks.state = {
        data: result(guide, [{ ...guide, title: "Cached choice title" }]),
        isError: true,
        error: new Error("Private error text must not appear"),
      };
      await linked({ type });
      const itemLabel = type === "guides" ? "guide" : "report";
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        `The linked ${itemLabel} could not be loaded`
      );
      for (const text of [
        publishedTitle,
        "Cached choice title",
        "Private error text",
      ])
        expect(container.textContent).not.toContain(text);
      expectNoIds();
      await click(`Retry linked ${itemLabel}`);
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
      expect(onOpen).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    }
  );

  it.each(["FORBIDDEN", "UNAUTHORIZED"])(
    "revokes all private content and remains denied after a %s error clears",
    async code => {
      await linked();
      cache.setQueryData([["staffHandbook", "linkOptions"]], result(guide));
      cache.setQueryData([["auth", "me"]], { id: 55 });
      mocks.state = {
        data: result(guide),
        isError: true,
        error: { data: { code } },
      };
      await linked();
      expect(container.textContent).toContain("access could not be authorized");
      expect(container.textContent).not.toContain(publishedTitle);
      expect(container.querySelector("button")).toBeNull();
      expect(
        cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
      ).toHaveLength(0);
      expect(cache.getQueryData([["auth", "me"]])).toEqual({ id: 55 });
      expect(mocks.invalidateAuth).toHaveBeenCalledWith(undefined, undefined, {
        throwOnError: true,
      });
      mocks.state = { data: result(guide) };
      await linked();
      expect(container.textContent).toContain("access could not be authorized");
      expect(container.textContent).not.toContain(publishedTitle);
      expect(onOpen).not.toHaveBeenCalled();
    }
  );

  it("shows known current-key data during fetching but disables navigation and honors disabled", async () => {
    mocks.state.isFetching = true;
    await linked();
    expect(container.textContent).toContain(publishedTitle);
    expect(button(`Read ${publishedTitle}`).disabled).toBe(true);
    await click(`Read ${publishedTitle}`);
    mocks.state.isFetching = false;
    await linked({ disabled: true });
    expect(button(`Read ${publishedTitle}`).disabled).toBe(true);
    await click(`Read ${publishedTitle}`);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("selected handbook picker recovery", () => {
  it.each(["guides", "reports"] as const)(
    "offers inline Retry for a selected %s error while the chooser is closed or open",
    async type => {
      await picker({ type });
      mocks.state = {
        data: result(guide, [guide]),
        isError: true,
        error: new Error("Hidden"),
      };
      await picker({ type });
      expect(container.textContent).not.toContain(publishedTitle);
      expect(container.querySelector("input")).toBeNull();
      const label = `Retry linked ${type === "guides" ? "guide" : "report"}`;
      await click(label);
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
      await click("Change selection");
      expect(container.querySelector("input")).not.toBeNull();
      await click(label);
      expect(mocks.refetch).toHaveBeenCalledTimes(2);
      expect(onChange).not.toHaveBeenCalled();
    }
  );

  it("labels a selected guide and choice awaiting review as Awaiting a check, not Draft", async () => {
    mocks.state.data = result({ ...guide, state: "in_review" }, [
      { ...guide, state: "in_review" },
    ]);
    await picker();
    expect(container.textContent).toContain("Operations · Awaiting a check");
    expect(container.textContent).not.toContain("Draft");
    await click("Change selection");
    expect(
      container.querySelector('[aria-label="Guide choices"]')?.textContent
    ).toContain("Operations · Awaiting a check");
    expect(container.textContent).not.toContain("Draft");
  });

  it("uses current rather than historic availability wording for a missing picker selection", async () => {
    mocks.state.data = result(null);
    await picker();
    expect(container.textContent).toContain("not currently available here");
    expect(container.textContent).not.toContain("no longer available");
    expectNoIds();
  });

  it("disables inline retry during fetching or when parent controls are disabled", async () => {
    mocks.state = { data: result(guide), isError: true, isFetching: true };
    await picker();
    expect(button("Retry linked guide").disabled).toBe(true);
    await click("Retry linked guide");
    mocks.state.isFetching = false;
    await picker({ disabled: true });
    expect(button("Retry linked guide").disabled).toBe(true);
    await click("Retry linked guide");
    expect(mocks.refetch).not.toHaveBeenCalled();
  });
});
