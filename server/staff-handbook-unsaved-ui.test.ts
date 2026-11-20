// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyHandbookContent } from "../shared/staff-handbook";

const mocks = vi.hoisted(() => ({
  queryError: null as unknown,
  mutationError: null as unknown,
  mutate: vi.fn(),
  fetchArticle: vi.fn(),
  invalidate: vi.fn(),
  onNavigate: vi.fn(),
}));
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any =>
    new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useUtils") return () => node();
          if (key === "useQuery")
            return () => ({
              data: undefined,
              isError: !!mocks.queryError,
              error: mocks.queryError,
              isLoading: false,
            });
          if (key === "useMutation")
            return () => ({
              isPending: false,
              error: mocks.mutationError,
              mutateAsync: (input: any) => mocks.mutate(path, input),
            });
          if (key === "fetch")
            return (...args: any[]) => mocks.fetchArticle(path, ...args);
          if (key === "invalidate") return mocks.invalidate;
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
  return { trpc: node() };
});
vi.mock("@/components/RichEmailEditor", () => ({
  RichEmailEditor: (props: any) =>
    React.createElement("textarea", {
      "aria-label": props.ariaLabel,
      value: props.value,
      disabled: props.disabled,
      onChange: (event: any) => props.onChange(event.target.value),
    }),
}));
// Mount the actual sidebar group and Wouter Link, but never unrelated portal APIs.
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/ViewModeContext", () => ({ useViewMode: () => ({}) }));
vi.mock("@/components/GlobalSearch", () => ({ default: () => null }));
vi.mock("@/components/TermsSigningBanner", () => ({
  TermsSigningBanner: () => null,
}));
vi.mock("@/pages/staff/StaffWorkspace", () => ({
  useStaffAccess: () => ({ access: {} }),
}));
vi.mock("@/pages/business/BusinessStaffPortalLayout", () => ({
  BusinessStaffPortalLayout: ({ children }: any) => children,
  useBusinessStaffPortalAuthority: () => null,
}));
import { SidebarGroup } from "../client/src/components/PortalLayout";
import { ArticlePanel } from "../client/src/pages/admin/StaffHandbookArticle";
import { HandbookAccessBoundary } from "../client/src/pages/admin/StaffHandbookComponents";
import { useHandbookUnsavedWork } from "../client/src/pages/admin/useHandbookUnsavedWork";

const workspaceUrl = "/admin/staff-handbook?tab=handbook&article=7";
let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;
let originalPush: History["pushState"];
let originalReplace: History["replaceState"];
let bypass: <T>(work: () => T) => T;
let navigate: (
  to: string,
  options?: { replace?: boolean; state?: unknown }
) => void;
let fakeNavigation: EventTarget;
function Workspace({ enabled }: { enabled: boolean }) {
  bypass = useHandbookUnsavedWork(enabled);
  return React.createElement("textarea", {
    "aria-label": "Private work",
    defaultValue: "Synthetic private report/comment",
  });
}
function Shell({
  enabled = true,
  mounted = true,
  article = false,
}: {
  enabled?: boolean;
  mounted?: boolean;
  article?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  navigate = setLocation;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "aside",
      null,
      React.createElement(SidebarGroup, {
        group: {
          label: "Daily Work",
          pinned: true,
          icon: null,
          items: [
            {
              label: "Dashboard",
              href: "/dashboard",
              icon: React.createElement("span", null, "nested icon"),
            },
          ],
        },
        location,
        collapsed: false,
        onNavigate: mocks.onNavigate,
        preferenceScope: "synthetic-unsaved-sidebar",
      })
    ),
    React.createElement(
      "output",
      { "data-location": true },
      `${location}?${search}`
    ),
    mounted &&
      location === "/admin/staff-handbook" &&
      (article
        ? React.createElement(ArticlePanel, {
            id: "new",
            userId: 99,
            categories: ["General"],
            staff: [{ id: 99, name: "Synthetic staff" }],
            startEditing: true,
            onClose: () => setLocation("/admin/staff-handbook?tab=handbook"),
            onSaved: (id: number) =>
              setLocation(`/admin/staff-handbook?tab=handbook&article=${id}`),
          })
        : React.createElement(
            HandbookAccessBoundary,
            null,
            React.createElement(Workspace, { enabled })
          ))
  );
}
async function render(props: Parameters<typeof Shell>[0] = {}) {
  await act(async () =>
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: cache },
        React.createElement(Shell, props)
      )
    )
  );
}
async function sidebarClick(init: MouseEventInit = {}) {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  // Happy DOM navigates modified/middle clicks in this document. Suppress only
  // that test-environment default; ordinary Wouter Link clicks remain real.
  const skipNativeDefault = (click: MouseEvent) => {
    if (
      click.button !== 0 ||
      click.ctrlKey ||
      click.metaKey ||
      click.shiftKey ||
      click.altKey
    )
      click.preventDefault();
  };
  const anchor = container.querySelector("aside a")!;
  anchor.addEventListener("click", skipNativeDefault as EventListener);
  await act(async () =>
    container.querySelector("aside a span")!.dispatchEvent(event)
  );
  anchor.removeEventListener("click", skipNativeDefault as EventListener);
  return event;
}
function beforeUnload() {
  const event = new Event("beforeunload", {
    cancelable: true,
  }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}
async function nativeLink(
  href: string,
  attrs: Record<string, string> = {},
  init: MouseEventInit = {}
) {
  const link = document.createElement("a");
  link.href = href;
  for (const [name, value] of Object.entries(attrs))
    link.setAttribute(name, value);
  const proceeded = vi.fn((event: MouseEvent) => event.preventDefault());
  // Stop native navigation in the test only; no production or external network.
  link.addEventListener("click", proceeded);
  container.appendChild(link);
  await act(async () =>
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...init,
      })
    )
  );
  link.remove();
  return proceeded;
}
async function typeArticle(label: string, value: string) {
  const el = (
    label === "Title"
      ? container.querySelector("input[placeholder='How to update a booking']")
      : container.querySelector(`textarea[aria-label='${label}']`)
  ) as HTMLInputElement | HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el.tagName === "INPUT"
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype,
      "value"
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function button(label: string) {
  const el = Array.from(container.querySelectorAll("button")).find(
    item => item.textContent?.trim() === label
  );
  expect(el).toBeTruthy();
  await act(async () => el!.click());
}
function denied() {
  return Object.assign(new Error("Synthetic permission denied"), {
    data: { code: "FORBIDDEN" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No network permitted");
    })
  );
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  window.happyDOM.setURL(`https://portal.example.test${workspaceUrl}`);
  originalPush = history.pushState;
  originalReplace = history.replaceState;
  history.replaceState({ untouched: "current-state" }, "", workspaceUrl);
  fakeNavigation = new EventTarget();
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: fakeNavigation,
  });
  vi.spyOn(window, "confirm").mockReturnValue(false);
  mocks.queryError = null;
  mocks.mutationError = null;
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.mutate.mockResolvedValue({ id: 8, version: 1 });
  mocks.fetchArticle.mockResolvedValue({ article: { id: 8, version: 1 } });
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(history.pushState).toBe(originalPush);
  expect(history.replaceState).toBe(originalReplace);
  expect(fetch).not.toHaveBeenCalled();
  container.remove();
  cache.clear();
  delete (window as any).navigation;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("scoped staff handbook unsaved work in the DOM", () => {
  it("declines a real sidebar Wouter Link click before sidebar callbacks or route changes", async () => {
    await render();
    const state = history.state;
    const length = history.length;
    const event = await sidebarClick();
    expect(event.defaultPrevented).toBe(true);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.onNavigate).not.toHaveBeenCalled();
    expect(location.pathname + location.search).toBe(workspaceUrl);
    expect(history.state).toEqual(state);
    expect(history.length).toBe(length);
    expect(container.querySelector("textarea")?.value).toContain(
      "Synthetic private"
    );
  });
  it("accepts a sidebar Link once, navigates, and removes every guard on route unmount", async () => {
    await render();
    vi.mocked(window.confirm).mockReturnValue(true);
    await sidebarClick();
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.onNavigate).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe("/dashboard");
    expect(container.querySelector("textarea")).toBeNull();
    expect(history.pushState).toBe(originalPush);
    expect(beforeUnload().defaultPrevented).toBe(false);
  });
  it("declines query-only anchor changes even when pathname is unchanged", async () => {
    await render();
    const proceeded = await nativeLink(
      "/admin/staff-handbook?tab=requests&request=4"
    );
    expect(proceeded).not.toHaveBeenCalled();
    expect(location.pathname + location.search).toBe(workspaceUrl);
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });
  it.each(["/pipeline", "https://outside.example.test/leave", workspaceUrl])(
    "guards same-tab native anchor %s",
    async href => {
      await render();
      expect(await nativeLink(href)).not.toHaveBeenCalled();
      vi.mocked(window.confirm).mockReturnValue(true);
      expect(await nativeLink(href)).toHaveBeenCalledTimes(1);
      expect(window.confirm).toHaveBeenCalledTimes(2);
      // The test's own canceled native link must not suppress a subsequent reload.
      expect(beforeUnload().defaultPrevented).toBe(true);
    }
  );
  it.each([
    { target: "_blank" },
    { target: "report-window" },
    { download: "" },
  ])("ignores anchor target/download attributes %j", async attrs => {
    await render();
    expect(
      await nativeLink("https://outside.example.test/file", attrs)
    ).toHaveBeenCalledTimes(1);
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])(
    "leaves a modified sidebar click alone: %s",
    async modifier => {
      await render();
      await sidebarClick({ [modifier]: true });
      expect(window.confirm).not.toHaveBeenCalled();
      expect(mocks.onNavigate).not.toHaveBeenCalled();
      expect(location.pathname + location.search).toBe(workspaceUrl);
    }
  );
  it("ignores middle clicks, same-document hash anchors and non-document protocols", async () => {
    await render();
    await sidebarClick({ button: 1 });
    for (const href of [
      workspaceUrl + "#steps",
      "#steps",
      "mailto:staff@example.test",
      "tel:1234",
    ])
      expect(await nativeLink(href)).toHaveBeenCalledTimes(1);
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it("respects an inherited base target that opens another browsing context", async () => {
    const base = document.createElement("base");
    base.target = "_blank";
    document.head.appendChild(base);
    try {
      await render();
      expect(await nativeLink("/pipeline")).toHaveBeenCalledTimes(1);
      expect(window.confirm).not.toHaveBeenCalled();
    } finally {
      base.remove();
    }
  });
  it("uses browser beforeunload rather than a custom reload confirmation", async () => {
    await render();
    const event = beforeUnload();
    expect(event.defaultPrevented).toBe(true);
    expect(event.returnValue).toBe("");
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "guards Wouter programmatic query navigation, replace=%s",
    async replace => {
      await render();
      const oldState = history.state;
      const length = history.length;
      await act(async () =>
        navigate("/admin/staff-handbook?tab=requests", {
          replace,
          state: { future: true },
        })
      );
      expect(location.pathname + location.search).toBe(workspaceUrl);
      expect(history.state).toEqual(oldState);
      expect(history.length).toBe(length);
      vi.mocked(window.confirm).mockReturnValue(true);
      await act(async () =>
        navigate("/admin/staff-handbook?tab=requests", {
          replace,
          state: { future: true },
        })
      );
      expect(location.search).toBe("?tab=requests");
      expect(history.state).toEqual({ future: true });
      expect(window.confirm).toHaveBeenCalledTimes(2);
    }
  );
  it("allows state-only and hash history updates without confirmation or private-state injection", async () => {
    await render();
    const length = history.length;
    history.replaceState({ untouched: "replacement-state" }, "");
    history.replaceState(history.state, "", workspaceUrl + "#steps");
    expect(history.state).toEqual({ untouched: "replacement-state" });
    expect(history.length).toBe(length);
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it("bypasses only synchronous authorized navigation, including dirty=false/pending=true", async () => {
    await render();
    await act(async () =>
      bypass(() => navigate("/admin/staff-handbook?tab=handbook&article=8"))
    );
    expect(location.search).toContain("article=8");
    expect(window.confirm).not.toHaveBeenCalled();
    await act(async () => navigate("/dashboard"));
    expect(location.pathname).toBe("/admin/staff-handbook");
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(beforeUnload().defaultPrevented).toBe(true);
  });
  it("restores the bypass after a throwing callback", async () => {
    await render();
    expect(() =>
      bypass(() => {
        throw new Error("Synthetic callback failed");
      })
    ).toThrow();
    await sidebarClick();
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(location.pathname + location.search).toBe(workspaceUrl);
  });
  it("removes wrappers and listeners immediately when protection is disabled", async () => {
    await render();
    expect(history.pushState).not.toBe(originalPush);
    await render({ enabled: false });
    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
    expect(beforeUnload().defaultPrevented).toBe(false);
    await sidebarClick();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/dashboard");
  });
  it("removes protection when access-boundary cache invalidation clears private content, without prompting", async () => {
    await render();
    const key = [
      ["staffHandbook", "article"],
      { input: { id: 7 }, type: "query" },
    ];
    await act(async () => {
      cache.setQueryData(key, { title: "Synthetic private cache" });
      cache
        .getQueryCache()
        .find({ queryKey: key })!
        .setState({ error: denied(), status: "error" });
    });
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("unsaved edits have been cleared");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(history.pushState).toBe(originalPush);
    expect(beforeUnload().defaultPrevented).toBe(false);
    await sidebarClick();
    expect(location.pathname).toBe("/dashboard");
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it("does not store private content or modify history at hook activation or teardown", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    const length = history.length;
    const state = history.state;
    await render();
    await render({ mounted: false });
    expect(local).not.toHaveBeenCalled();
    expect(history.state).toEqual(state);
    expect(history.length).toBe(length);
    expect(location.pathname + location.search).toBe(workspaceUrl);
    expect(beforeUnload().defaultPrevented).toBe(false);
  });
  it.each(["back", "forward"])(
    "cancels Navigation API %s before popstate, preserving current URL/state with no history edits",
    async direction => {
      await render();
      const url = location.href;
      const state = history.state;
      const length = history.length;
      const destination =
        direction === "back"
          ? "/dashboard"
          : "/admin/staff-handbook?tab=requests";
      const traversal = () => {
        const event = new Event("navigate", { cancelable: true });
        Object.assign(event, {
          navigationType: "traverse",
          destination: {
            url: `https://portal.example.test${destination}`,
            sameDocument: true,
          },
        });
        fakeNavigation.dispatchEvent(event);
        // Model the browser contract: preventDefault leaves the active entry
        // untouched; accepted traversal commits before dispatching popstate.
        if (!event.defaultPrevented) {
          window.happyDOM.setURL(`https://portal.example.test${destination}`);
          window.dispatchEvent(
            new PopStateEvent("popstate", { state: { destination: true } })
          );
        }
        return event;
      };
      let event!: Event;
      await act(async () => {
        event = traversal();
      });
      expect(event.defaultPrevented).toBe(true);
      expect(location.href).toBe(url);
      expect(history.state).toEqual(state);
      expect(history.length).toBe(length);
      expect(container.querySelector("textarea")).toBeTruthy();
      vi.mocked(window.confirm).mockReturnValue(true);
      await act(async () => {
        event = traversal();
      });
      expect(event.defaultPrevented).toBe(false);
      expect(location.pathname + location.search).toBe(destination);
      expect(window.confirm).toHaveBeenCalledTimes(2);
    }
  );
  it("does not rewrite unknown history entries in legacy browsers without Navigation API", async () => {
    delete (window as any).navigation;
    // Spy before mounting so teardown restores the spies before mockRestore;
    // spying on a live guard would resurrect that obsolete guard afterward.
    const replace = vi.spyOn(history, "replaceState");
    const push = vi.spyOn(history, "pushState");
    await render();
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: { unrelated: true } })
    );
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(beforeUnload().defaultPrevented).toBe(true);
    await render({ mounted: false });
    replace.mockRestore();
    push.mockRestore();
  });
});

describe("article workspace integration with actual router navigation", () => {
  it("protects a typed new guide through sidebar navigation and reload", async () => {
    await render({ article: true });
    expect(beforeUnload().defaultPrevented).toBe(false);
    await typeArticle("Title", "Synthetic unsaved guide");
    await typeArticle("Content", "<p>Synthetic private draft</p>");
    await sidebarClick();
    expect(location.pathname + location.search).toBe(workspaceUrl);
    expect(container.querySelector("textarea")?.value).toContain(
      "Synthetic private draft"
    );
    expect(beforeUnload().defaultPrevented).toBe(true);
  });
  it("confirms the internal Back once and bypasses the subsequent route change", async () => {
    await render({ article: true });
    await typeArticle("Title", "Synthetic unsaved guide");
    await button("Back to guides");
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(location.search).toContain("article=7");
    vi.mocked(window.confirm).mockReturnValue(true);
    await button("Back to guides");
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(location.pathname + location.search).toBe(
      "/admin/staff-handbook?tab=handbook"
    );
  });
  it("allows verified post-save navigation despite pending/dirty closures before rerender", async () => {
    await render({ article: true });
    await typeArticle("Title", "Synthetic saved guide");
    await button("Save draft");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(location.search).toContain("article=8");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(beforeUnload().defaultPrevented).toBe(false);
  });
  it("warns while a save is pending but permits its authorized success navigation", async () => {
    let resolve!: (value: { id: number; version: number }) => void;
    mocks.mutate.mockReturnValue(
      new Promise(res => {
        resolve = res;
      })
    );
    await render({ article: true });
    await typeArticle("Title", "Synthetic pending guide");
    await button("Save draft");
    expect(beforeUnload().defaultPrevented).toBe(true);
    await sidebarClick();
    expect(location.search).toContain("article=7");
    vi.mocked(window.confirm).mockClear();
    await act(async () => resolve({ id: 8, version: 1 }));
    expect(location.search).toContain("article=8");
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it("cleans up a typed guide on mutation access denial without removal confirmation", async () => {
    await render({ article: true });
    await typeArticle("Title", "Synthetic private guide");
    mocks.mutate.mockRejectedValue(denied());
    await button("Save draft");
    expect(container.querySelector("[data-handbook-article]")).toBeNull();
    expect(container.textContent).toContain("unsaved edits have been cleared");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(history.pushState).toBe(originalPush);
    expect(beforeUnload().defaultPrevented).toBe(false);
    await sidebarClick();
    expect(location.pathname).toBe("/dashboard");
  });
});
