// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  pending: false,
  error: undefined as unknown,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      staffHandbook: {
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
  mocks.mutate.mockResolvedValue({ id: 8, version: 1 });
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
  it("keeps title, description and category primary with optional details collapsed", async () => {
    await render();
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent?.trim()).toBe(
      "Optional details"
    );
    for (const label of [titleLabel, descriptionLabel, "Category"]) {
      expect(field(label).closest("details")).toBeNull();
    }
    for (const label of [
      "Priority",
      "Request kind",
      "Guidance already checked",
      "Impact on staff or service",
      "Related guide ID (optional)",
    ]) {
      expect(field(label).closest("details")).toBe(details);
      expect(field(label).hasAttribute("required")).toBe(false);
    }
    expect(field("Priority").value).toBe("normal");
    expect(field("Request kind").value).toBe("missing_process");
    expect(field("Guidance already checked").value).toBe("");
    expect(field("Impact on staff or service").value).toBe("");
    expect(container.textContent).toContain(
      "No customer details, payment data or credentials."
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("submits title and description alone using all strict-API defaults", async () => {
    await render(["Operations"]);
    expect(field("Category").value).toBe("General");
    await input(titleLabel, "  Synthetic missing guidance  ");
    await input(descriptionLabel, "  Synthetic staff process description  ");
    expect(button("Submit knowledge request").disabled).toBe(false);
    await act(async () => button("Submit knowledge request").click());
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
    await act(async () => button("Submit knowledge request").click());
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

  it("retains all edits on failure and reuses the creation token across an edited retry", async () => {
    mocks.mutate.mockRejectedValueOnce(new Error("Synthetic service failure"));
    await render();
    await fillPrimary();
    await openOptional();
    await input("Category", "Operations");
    await input("Priority", "high");
    await input("Request kind", "unclear");
    await input("Guidance already checked", "  Synthetic search  ");
    await input("Impact on staff or service", "  Synthetic impact  ");
    await input("Related guide ID (optional)", "7");
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
    expect(field("Priority").value).toBe("high");
    expect(field("Request kind").value).toBe("unclear");
    expect(field("Guidance already checked").value).toBe(
      "  Synthetic search  "
    );
    expect(field("Impact on staff or service").value).toBe(
      "  Synthetic impact  "
    );
    expect(field("Related guide ID (optional)").value).toBe("7");
    expect(button("Submit knowledge request").disabled).toBe(false);
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
    expect(button("Reporting…").disabled).toBe(true);
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
    expect(button("Reporting…").disabled).toBe(true);
    await submit();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("does not create another report when saving succeeded but refreshing failed", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Synthetic refresh failure"));
    await render();
    await fillPrimary();
    const form = container.querySelector("form")!;
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Request #8 was saved, but refresh failed"
    );
    expect(container.querySelector("form")).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () => submitEvent(form));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    await act(async () => button("Open saved request #8").click());
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

  it("asks before discarding optional-only edits", async () => {
    await render();
    await openOptional();
    await input("Impact on staff or service", "Synthetic optional impact");
    vi.mocked(window.confirm).mockReturnValue(false);
    await act(async () => button("Cancel report").click());
    expect(window.confirm).toHaveBeenCalledWith("Discard this unsaved report?");
    expect(onCancel).not.toHaveBeenCalled();
    expect(field("Impact on staff or service").value).toBe(
      "Synthetic optional impact"
    );
  });
});
