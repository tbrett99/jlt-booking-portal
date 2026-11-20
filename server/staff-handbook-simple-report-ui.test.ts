// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LinkInput = {
  type: "guides" | "reports";
  scope: "active" | "published";
  search?: string;
  selectedId?: number | null;
  excludeId?: number;
  page: number;
};
const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  updateRecovered: vi.fn(),
  recover: vi.fn(),
  invalidate: vi.fn(),
  queries: [] as { input: LinkInput; options: { enabled: boolean } }[],
  pending: false,
  error: undefined as unknown,
  recoveredPending: false,
  recoveredError: undefined as unknown,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      staffHandbook: {
        recoverRequest: {
          fetch: (...args: unknown[]) => mocks.recover(...args),
        },
        requests: {
          invalidate: (...args: unknown[]) =>
            mocks.invalidate("staffHandbook.requests", ...args),
        },
        overview: {
          invalidate: (...args: unknown[]) =>
            mocks.invalidate("staffHandbook.overview", ...args),
        },
      },
      auth: {
        me: {
          invalidate: (...args: unknown[]) =>
            mocks.invalidate("auth.me", ...args),
        },
      },
    }),
    staffHandbook: {
      createRequest: {
        useMutation: () => ({
          isPending: mocks.pending,
          error: mocks.error,
          mutateAsync: mocks.mutate,
        }),
      },
      updateRecoveredRequest: {
        useMutation: () => ({
          isPending: mocks.recoveredPending,
          error: mocks.recoveredError,
          mutateAsync: mocks.updateRecovered,
        }),
      },
      linkOptions: {
        useQuery: (input: LinkInput, options: { enabled: boolean }) => {
          mocks.queries.push({ input, options });
          const guide = {
            id: 7,
            title: "Synthetic reimbursement checklist",
            category: "Operations",
            state: "published",
          };
          const eligible =
            input.type === "guides" && input.excludeId !== guide.id;
          const items =
            eligible &&
            (!input.search ||
              guide.title.toLowerCase().includes(input.search.toLowerCase()))
              ? [guide]
              : [];
          return {
            isError: false,
            isLoading: false,
            isFetching: false,
            refetch: vi.fn(),
            data: options.enabled
              ? {
                  items,
                  selected:
                    eligible && input.selectedId === guide.id ? guide : null,
                  total: items.length,
                  page: input.page,
                  pageSize: 20,
                }
              : undefined,
          };
        },
      },
    },
  },
}));
import { ReportKnowledge } from "../client/src/pages/admin/StaffHandbookRequests";

let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;
let onCreated: ReturnType<typeof vi.fn>;
let onCancel: ReturnType<typeof vi.fn>;
const titleLabel = "What guidance is missing?";
const descriptionLabel = "What do staff need to know?";
const optionalLabels = [
  "How urgent is this?",
  "What needs improving?",
  "Where have you already looked? (optional)",
  "How is this affecting staff? (optional)",
];

async function render(categories = ["General", "Operations"]) {
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: cache },
        React.createElement(ReportKnowledge, {
          categories,
          onCreated,
          onCancel,
        })
      )
    );
  });
}
function field(label: string) {
  const element = Array.from(container.querySelectorAll("label")).find(
    candidate => candidate.textContent?.trim() === label
  );
  expect(element, `field ${label}`).toBeTruthy();
  return document.getElementById(element!.htmlFor)! as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement;
}
async function input(label: string, value: string) {
  const element = field(label);
  await act(async () => {
    const prototype =
      element.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : element.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value
    );
    element.dispatchEvent(
      new Event(element.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      })
    );
  });
}
function button(label: string) {
  const element = Array.from(container.querySelectorAll("button")).find(
    candidate => candidate.textContent?.trim() === label
  );
  expect(element, `button ${label}`).toBeTruthy();
  return element!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function submitEvent(form = container.querySelector("form")!) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
async function submit() {
  await act(async () => submitEvent());
}
async function fillPrimary() {
  await input(titleLabel, "Synthetic missing guidance");
  await input(descriptionLabel, "Synthetic staff process description");
}
async function openOptional() {
  const details = container.querySelector("details")!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  return details;
}
async function chooseGuide() {
  await click("Choose a guide");
  await input("Find a guide by title", "reimbursement");
  const choice = container.querySelector<HTMLButtonElement>(
    '[aria-label="Guide choices"] button'
  )!;
  expect(choice.textContent).toContain("Synthetic reimbursement checklist");
  await act(async () => choice.click());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Synthetic UI tests must not use the network");
    })
  );
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.pending = false;
  mocks.error = undefined;
  mocks.recoveredPending = false;
  mocks.recoveredError = undefined;
  mocks.queries = [];
  mocks.mutate.mockResolvedValue({ id: 8, version: 1 });
  mocks.updateRecovered.mockResolvedValue({ id: 8, version: 2 });
  mocks.recover.mockResolvedValue({ request: null });
  mocks.invalidate.mockResolvedValue(undefined);
  onCreated = vi.fn();
  onCancel = vi.fn();
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  cache.clear();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("simplified missing-guidance report rendered UI", () => {
  it("keeps only title, description and General category mounted until optional details open", async () => {
    await render();
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent?.trim()).toBe(
      "Optional details"
    );
    expect(
      Array.from(container.querySelectorAll("label"), el =>
        el.textContent?.trim()
      )
    ).toEqual([titleLabel, descriptionLabel, "Category"]);
    expect(details.querySelector("input, textarea, select")).toBeNull();
    expect(mocks.queries).toHaveLength(0);
    expect(field("Category").value).toBe("General");
    expect(container.textContent).toContain(
      "Do not include customer details, payment data or passwords."
    );
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(button("Submit report").disabled).toBe(false);
    await openOptional();
    for (const label of optionalLabels) {
      expect(field(label).closest("details")).toBe(details);
      expect(field(label).hasAttribute("required")).toBe(false);
    }
    expect(field("How urgent is this?").value).toBe("normal");
    expect(field("What needs improving?").value).toBe("missing_process");
    expect(field("Where have you already looked? (optional)").value).toBe("");
    expect(field("How is this affecting staff? (optional)").value).toBe("");
    expect(
      container.querySelector(
        '[aria-label="Is this about an existing guide? (optional)"]'
      )
    ).toBeTruthy();
    expect(mocks.queries.at(-1)?.options.enabled).toBe(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("submits title and description alone using all strict-API defaults", async () => {
    await render(["Operations"]);
    expect(field("Category").value).toBe("General");
    await input(titleLabel, "  Synthetic missing guidance  ");
    await input(descriptionLabel, "  Synthetic staff process description  ");
    await click("Submit report");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith({
      createToken: expect.any(String),
      title: "Synthetic missing guidance",
      description: "Synthetic staff process description",
      category: "General",
      kind: "missing_process",
      checkedGuidance: "",
      impact: "",
      priority: "normal",
      articleId: null,
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(8);
    expect(mocks.invalidate.mock.calls).toEqual([
      ["staffHandbook.requests", undefined, undefined, { throwOnError: true }],
      ["staffHandbook.overview", undefined, undefined, { throwOnError: true }],
    ]);
  });

  it("shows visible validation for blank or whitespace-only primary fields", async () => {
    await render();
    await click("Submit report");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Add a title and description"
    );
    expect(field(titleLabel).getAttribute("aria-invalid")).toBe("true");
    expect(field(descriptionLabel).getAttribute("aria-invalid")).toBe("true");
    await input(titleLabel, "  ");
    await input(descriptionLabel, "Synthetic description");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Add a title explaining what guidance is missing"
    );
    await input(titleLabel, "Synthetic title");
    await input(descriptionLabel, " \n ");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Add a description explaining what staff need to know"
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
    await input(descriptionLabel, "Synthetic description");
    expect(field(titleLabel).getAttribute("aria-invalid")).toBe("false");
    expect(field(descriptionLabel).getAttribute("aria-invalid")).toBe("false");
    await submit();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("retains all edits on uncertain failure and reuses the creation token across an edited retry", async () => {
    mocks.mutate.mockRejectedValueOnce(new Error("Synthetic service failure"));
    await render();
    await fillPrimary();
    await openOptional();
    await input("Category", "Operations");
    await input("How urgent is this?", "high");
    await input("What needs improving?", "unclear");
    await input(
      "Where have you already looked? (optional)",
      "  Synthetic search  "
    );
    await input(
      "How is this affecting staff? (optional)",
      "  Synthetic impact  "
    );
    await chooseGuide();
    expect(mocks.queries.at(-1)?.input).toEqual({
      type: "guides",
      scope: "active",
      search: "reimbursement",
      selectedId: 7,
      excludeId: undefined,
      page: 1,
    });
    await submit();
    const first = mocks.mutate.mock.calls[0][0];
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Synthetic service failure Your report is retained."
    );
    expect(field(titleLabel).value).toBe("Synthetic missing guidance");
    expect(field(descriptionLabel).value).toBe(
      "Synthetic staff process description"
    );
    expect(field("Category").value).toBe("Operations");
    expect(field("How urgent is this?").value).toBe("high");
    expect(field("What needs improving?").value).toBe("unclear");
    expect(field("Where have you already looked? (optional)").value).toBe(
      "  Synthetic search  "
    );
    expect(field("How is this affecting staff? (optional)").value).toBe(
      "  Synthetic impact  "
    );
    expect(
      container.querySelector(
        '[aria-label="Is this about an existing guide? (optional)"]'
      )?.textContent
    ).toContain("Synthetic reimbursement checklist");
    expect(button("Submit report").disabled).toBe(false);
    await input(titleLabel, "Synthetic revised missing guidance");
    await submit();
    expect(mocks.mutate.mock.calls[1][0]).toEqual({
      ...first,
      title: "Synthetic revised missing guidance",
      createToken: first.createToken,
      checkedGuidance: "Synthetic search",
      impact: "Synthetic impact",
      articleId: 7,
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(8);
  });

  it("prevents same-tick and in-flight duplicate submissions while disabling report controls", async () => {
    const create = deferred<{ id: number; version: number }>();
    mocks.mutate.mockReturnValue(create.promise);
    await render();
    await fillPrimary();
    const form = container.querySelector("form")!;
    await act(async () => {
      submitEvent(form);
      submitEvent(form);
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect(button("Submitting…").disabled).toBe(true);
    expect(button("Cancel report").disabled).toBe(true);
    await submit();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    await act(async () => {
      create.resolve({ id: 8, version: 1 });
      await create.promise;
    });
    await act(async () => submitEvent(form));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(8);
  });

  it("respects a pending mutation reported by the canonical hook", async () => {
    mocks.pending = true;
    await render();
    expect(button("Submitting…").disabled).toBe(true);
    await submit();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("respects pending recovered-update state from the always-mounted canonical hook", async () => {
    mocks.recoveredPending = true;
    await render();
    expect(button("Submitting…").disabled).toBe(true);
    expect(button("Cancel report").disabled).toBe(true);
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    await submit();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.updateRecovered).not.toHaveBeenCalled();
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it.each(["FORBIDDEN", "UNAUTHORIZED"])(
    "denies and clears the entire form on canonical recovered-update hook %s error",
    async code => {
      await render();
      await fillPrimary();
      cache.setQueryData([["staffHandbook", "recoverRequest"]], {
        private: "Synthetic recovery cache",
      });
      mocks.recoveredError = { shape: { data: { code } } };
      await render();
      expect(
        container.querySelector("form, input, textarea, select")
      ).toBeNull();
      expect(container.textContent).toContain("access could not be authorized");
      expect(container.textContent).not.toContain("Synthetic missing guidance");
      expect(
        cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
      ).toHaveLength(0);
      expect(mocks.invalidate).toHaveBeenCalledWith(
        "auth.me",
        undefined,
        undefined,
        { throwOnError: true }
      );
      mocks.recoveredError = undefined;
      await render();
      expect(container.querySelector("form")).toBeNull();
      expect(mocks.mutate).not.toHaveBeenCalled();
      expect(mocks.updateRecovered).not.toHaveBeenCalled();
      expect(mocks.recover).not.toHaveBeenCalled();
      expect(onCreated).not.toHaveBeenCalled();
    }
  );

  it("does not create another report when saving succeeded but refreshing failed, without exposing IDs", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Synthetic refresh failure"));
    await render();
    await fillPrimary();
    const form = container.querySelector("form")!;
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your report was saved, but the page could not refresh"
    );
    expect(container.textContent).not.toMatch(/#8|request\s+8|report\s+8/i);
    expect(container.querySelector("form")).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () => submitEvent(form));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    await click("View your saved report");
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(8);
  });

  it.each(["FORBIDDEN", "UNAUTHORIZED"])(
    "preserves canonical %s denial handling and clears private report edits/cache",
    async code => {
      mocks.mutate.mockRejectedValue({ data: { code } });
      await render();
      await fillPrimary();
      cache.setQueryData([["staffHandbook", "request"]], {
        private: "Synthetic cached content",
      });
      await submit();
      expect(container.querySelector("form")).toBeNull();
      expect(container.textContent).toContain("access could not be authorized");
      expect(container.textContent).not.toContain("Synthetic missing guidance");
      expect(
        cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
      ).toHaveLength(0);
      expect(mocks.invalidate).toHaveBeenCalledWith(
        "auth.me",
        undefined,
        undefined,
        { throwOnError: true }
      );
      expect(onCreated).not.toHaveBeenCalled();
      mocks.error = undefined;
      await render();
      expect(container.querySelector("form")).toBeNull();
    }
  );

  it("denies a report on canonical mutation-hook authority error before displaying inputs", async () => {
    mocks.error = { shape: { data: { code: "FORBIDDEN" } } };
    await render();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("access could not be authorized");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("asks before discarding optional-only edits and preserves them after cancellation", async () => {
    await render();
    await openOptional();
    await input(
      "How is this affecting staff? (optional)",
      "Synthetic optional impact"
    );
    vi.mocked(window.confirm).mockReturnValue(false);
    await click("Cancel report");
    expect(window.confirm).toHaveBeenCalledWith("Discard this unsaved report?");
    expect(onCancel).not.toHaveBeenCalled();
    expect(field("How is this affecting staff? (optional)").value).toBe(
      "Synthetic optional impact"
    );
  });
});
