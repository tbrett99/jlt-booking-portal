// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No backend, database, real people, or financial service is used. Render the
// actual component, ReactDOM, shadcn/Radix dialog, inputs and wouter links.
const mock = vi.hoisted(() => ({
  state: {
    data: undefined as unknown,
    error: null as Error | null,
    isLoading: false,
    isFetching: false,
  },
  search: {
    data: undefined as unknown,
    error: null as Error | null,
    isLoading: false,
    isFetching: false,
  },
  preview: {
    data: undefined as unknown,
    error: null as Error | null,
    isLoading: false,
    isFetching: false,
  },
  hooks: [] as Array<{
    path: string;
    input: unknown;
    options: Record<string, unknown>;
  }>,
  save: vi.fn(),
  stateRefetch: vi.fn(),
  searchRefetch: vi.fn(),
  previewRefetch: vi.fn(),
  invalidations: {
    getProspect: vi.fn(),
    signupLinkState: vi.fn(),
    stageCounts: vi.fn(),
    listProspectsFiltered: vi.fn(),
    listProspects: vi.fn(),
    analytics: vi.fn(),
  },
  updatedAt: 1,
}));
vi.mock("@/lib/trpc", () => {
  function query(path: "state" | "search" | "preview", procedure: string) {
    return {
      useQuery: (input: unknown, options: Record<string, unknown> = {}) => {
        mock.hooks.push({ path: procedure, input, options });
        return {
          ...mock[path],
          dataUpdatedAt: mock.updatedAt,
          refetch: mock[`${path}Refetch`],
        };
      },
    };
  }
  return {
    trpc: {
      useUtils: () => ({
        recruitment: Object.fromEntries(
          Object.entries(mock.invalidations).map(([name, invalidate]) => [
            name,
            { invalidate },
          ])
        ),
      }),
      recruitment: {
        signupLinkState: query("state", "signupLinkState"),
        searchCompletedSignups: query("search", "searchCompletedSignups"),
        previewSignupLink: query("preview", "previewSignupLink"),
        confirmSignupLink: {
          useMutation: () => ({ mutateAsync: mock.save, isPending: false }),
        },
      },
    },
  };
});
import RecruitmentSignupLink from "../client/src/pages/crm/RecruitmentSignupLink";

const candidate = {
  joinSessionId: 901,
  userId: 801,
  signerName: "Synthetic Person",
  agentName: "Synthetic Person",
  signupEmail: "synthetic.signup@example.test",
  agentEmail: "synthetic.member@example.test",
  jltId: "JLT-SYNTHETIC-801",
  contractSignedAt: "2026-10-01T10:15:00.000Z",
  joiningFeePaidAt: "2026-10-02T11:45:00.000Z",
  membershipTier: "gold",
  membershipType: "full_time",
  linkedProspectId: null as number | null,
};
const alternate = {
  ...candidate,
  joinSessionId: 902,
  userId: 802,
  agentName: "Synthetic Person Two",
  signerName: "Synthetic Person Two",
  signupEmail: "synthetic.two@example.test",
  jltId: "JLT-SYNTHETIC-802",
};
function makePreview(signup = candidate) {
  return {
    prospect: {
      id: 701,
      name: "Synthetic Person",
      email: "synthetic.enquiry@example.test",
      pipelineStage: "new_enquiry",
      source: "original_referral",
      howHeard: "fictional_event",
    },
    signup,
    duplicate: {
      id: 702,
      name: "Synthetic Person",
      email: "synthetic.signup@example.test",
      pipelineStage: "onboarding_approved",
    },
    conversionAt: "2026-10-02T11:45:00.000Z",
    token: `synthetic-token-${signup.joinSessionId}`,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    alreadyLinked: false,
  };
}
function linkedState() {
  return {
    link: {
      id: 601,
      prospectId: 701,
      joinSessionId: 901,
      userId: 801,
      supersededProspectId: 702,
      linkedByName: "Synthetic Reviewer",
      linkedAt: "2026-10-03T12:00:00.000Z",
      conversionAt: "2026-10-02T11:45:00.000Z",
      reason: "Checked synthetic identity evidence",
      agentName: "Synthetic Person",
      agentEmail: "synthetic.member@example.test",
      signupEmail: "synthetic.signup@example.test",
      jltId: "JLT-SYNTHETIC-801",
    },
    supersededBy: null,
  };
}
let root: Root;
let container: HTMLDivElement;
let network: ReturnType<typeof vi.fn>;
async function render(id = 701) {
  await act(async () =>
    root.render(
      React.createElement(RecruitmentSignupLink, { prospectId: id, key: id })
    )
  );
}
function buttons() {
  return Array.from(
    document.body.querySelectorAll<HTMLButtonElement>("button")
  );
}
function button(text: string) {
  const result = buttons().find(
    element => element.textContent?.trim() === text
  );
  expect(result, `Rendered button: ${text}`).toBeTruthy();
  return result!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function change(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function searchInput() {
  return document.body.querySelector<HTMLInputElement>(
    'input:not([type="checkbox"])'
  )!;
}
function reasonInput() {
  return document.body.querySelector<HTMLTextAreaElement>("textarea")!;
}
function checkbox() {
  return document.body.querySelector<HTMLInputElement>(
    'input[type="checkbox"]'
  )!;
}
function confirmButton() {
  return button("Confirm link and mark Won");
}
function lastHook(path: string) {
  return mock.hooks.filter(hook => hook.path === path).at(-1)!;
}
async function open() {
  await render();
  await click("Link completed signup");
}
async function search(term = "Synthetic Person") {
  await change(searchInput(), term);
  await click("Search");
}
async function review() {
  await open();
  await search();
  await click("Review signup");
}
async function approve(reason = "Verified fictional identity evidence") {
  await change(reasonInput(), reason);
  await act(async () => checkbox().click());
}
function text() {
  return document.body.textContent || "";
}

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mock.hooks = [];
  mock.updatedAt = 1;
  mock.state = {
    data: { link: null, supersededBy: null },
    error: null,
    isLoading: false,
    isFetching: false,
  };
  mock.search = {
    data: { items: [candidate], hasMore: false, nextCursor: null },
    error: null,
    isLoading: false,
    isFetching: false,
  };
  mock.preview = {
    data: makePreview(),
    error: null,
    isLoading: false,
    isFetching: false,
  };
  mock.stateRefetch.mockReset().mockImplementation(async () => ({
    data: mock.state.data,
    error: mock.state.error,
  }));
  mock.searchRefetch.mockReset().mockImplementation(async () => ({
    data: mock.search.data,
    error: mock.search.error,
  }));
  mock.previewRefetch.mockReset().mockImplementation(async () => {
    mock.updatedAt++;
    return { data: mock.preview.data, error: mock.preview.error };
  });
  mock.save.mockReset().mockImplementation(async () => {
    mock.state.data = linkedState();
    return {
      linked: true,
      alreadyLinked: false,
      prospectId: 701,
      userId: 801,
      supersededProspectId: 702,
    };
  });
  for (const invalidate of Object.values(mock.invalidations))
    invalidate.mockReset().mockResolvedValue(undefined);
  // Prohibit every ordinary browser network entry point; resources are disabled.
  const happyWindow = window as unknown as {
    happyDOM: { settings: Record<string, unknown> };
  };
  Object.assign(happyWindow.happyDOM.settings, {
    disableCSSFileLoading: true,
    disableJavaScriptFileLoading: true,
    disableIframePageLoading: true,
  });
  network = vi.fn(() => {
    throw new Error("Network forbidden in recruitment signup UI tests");
  });
  vi.stubGlobal("fetch", network);
  vi.stubGlobal("XMLHttpRequest", network);
  vi.stubGlobal("WebSocket", network);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RecruitmentSignupLink — actual ReactDOM, synthetic identities, network off", () => {
  it("shows a compact unlinked card, with no search or preview before opening", async () => {
    await render();
    expect(text()).toContain("enquiry email and correspondence stay unchanged");
    expect(mock.hooks.map(hook => hook.path)).toEqual(["signupLinkState"]);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("shows loading and truthful link-state errors without a linking action", async () => {
    mock.state.isLoading = true;
    await render();
    expect(text()).toContain("Loading signup link");
    expect(
      buttons().some(element => element.textContent === "Link completed signup")
    ).toBe(false);
    mock.state.isLoading = false;
    mock.state.error = new Error("Not authorised");
    await render();
    expect(text()).toContain("Could not load signup link: Not authorised");
    await click("Refresh link status");
    expect(mock.stateRefetch).toHaveBeenCalledOnce();
  });
  it("renders a read-only superseded card with the canonical original enquiry link", async () => {
    mock.state.data = { link: null, supersededBy: { prospectId: 701 } };
    await render(702);
    expect(
      container.querySelector('a[href="/crm/recruitment/701"]')
    ).toBeTruthy();
    expect(text()).toContain("recruitment correspondence");
    expect(buttons()).toHaveLength(0);
  });
  it("renders linked audit details and the verified existing member deep link", async () => {
    mock.state.data = linkedState();
    await render();
    expect(
      container.querySelector('a[href="/crm/agents?agent=801"]')?.textContent
    ).toContain("Synthetic Person");
    expect(text()).toContain("Synthetic Reviewer");
    expect(text()).toContain("Checked synthetic identity evidence");
    expect(text()).toContain(
      "Original enquiry email, source and recruitment correspondence"
    );
    expect(
      container.querySelector('a[href="/crm/recruitment/702"]')
    ).toBeTruthy();
    expect(buttons()).toHaveLength(0);
  });
  it("requires a committed 2-character search and never loads the member directory", async () => {
    await open();
    expect(searchInput().placeholder).toBe("Name, checkout email or JLT ID");
    expect(lastHook("searchCompletedSignups").options.enabled).toBe(false);
    expect(button("Search").disabled).toBe(true);
    await change(searchInput(), "S");
    expect(button("Search").disabled).toBe(true);
    expect(lastHook("searchCompletedSignups").options.enabled).toBe(false);
    await change(searchInput(), "Sy");
    expect(button("Search").disabled).toBe(false);
    expect(lastHook("searchCompletedSignups").options.enabled).toBe(false);
    await click("Search");
    expect(lastHook("searchCompletedSignups")).toMatchObject({
      input: { search: "Sy" },
      options: { enabled: true },
    });
    expect(
      mock.hooks.every(hook =>
        ["signupLinkState", "searchCompletedSignups"].includes(hook.path)
      )
    ).toBe(true);
    expect(searchInput().maxLength).toBe(150);
  });
  it("supports full names with spaces, trims the input, and has nothing preselected", async () => {
    await open();
    await search("  Synthetic Person  ");
    expect(lastHook("searchCompletedSignups").input).toEqual({
      search: "Synthetic Person",
    });
    expect(button("Review signup").getAttribute("aria-pressed")).toBe("false");
    expect(document.body.querySelector("textarea")).toBeNull();
    expect(mock.hooks.some(hook => hook.path === "previewSignupLink")).toBe(
      false
    );
  });
  it("displays signer/member emails, JLT identity and recorded dates, never financial amounts", async () => {
    await open();
    await search();
    for (const expected of [
      "Contract signer",
      candidate.signupEmail,
      candidate.agentEmail,
      candidate.jltId,
      "Joining fee recorded:",
      "Yes (Portal record)",
      "Portal record, not a new provider settlement check",
      new Date(candidate.contractSignedAt).toLocaleString(),
      new Date(candidate.joiningFeePaidAt).toLocaleString(),
    ])
      expect(text()).toContain(expected);
    expect(text()).not.toMatch(/[£$€]|mandate ID|monthly charge/i);
  });
  it("disables a candidate linked to another enquiry and exposes Open enquiry", async () => {
    mock.search.data = {
      items: [{ ...candidate, linkedProspectId: 799 }],
      hasMore: false,
      nextCursor: null,
    };
    await open();
    await search();
    expect(button("Review signup").disabled).toBe(true);
    expect(
      document.body.querySelector('a[href="/crm/recruitment/799"]')?.textContent
    ).toContain("Open enquiry");
    await click("Review signup");
    expect(mock.hooks.some(hook => hook.path === "previewSignupLink")).toBe(
      false
    );
  });
  it("shows empty results separately from a failed search and supports honest retry", async () => {
    mock.search.data = { items: [], hasMore: false, nextCursor: null };
    await open();
    await search();
    expect(text()).toContain("No completed signups found");
    mock.search.error = new Error("Search unavailable");
    await render();
    expect(text()).toContain("Search failed: Search unavailable");
    expect(text()).not.toContain("No completed signups found");
    await click("Retry search");
    expect(mock.searchRefetch).toHaveBeenCalledOnce();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("shows search loading without stale result selection", async () => {
    await open();
    await search();
    mock.search.isFetching = true;
    await render();
    expect(text()).toContain("Searching completed signups");
    expect(
      document.body.querySelector('[aria-label="Completed signups"]')
    ).toBeNull();
  });
  it("requires the explicit same-person checkbox and a 5–1000 character reason", async () => {
    await review();
    expect(reasonInput().value).toBe("");
    expect(checkbox().checked).toBe(false);
    expect(confirmButton().disabled).toBe(true);
    await change(reasonInput(), "Verified fictional evidence");
    expect(confirmButton().disabled).toBe(true);
    await act(async () => checkbox().click());
    expect(confirmButton().disabled).toBe(false);
    await change(reasonInput(), "    a    ");
    expect(confirmButton().disabled).toBe(true);
    await change(reasonInput(), "x".repeat(1001));
    expect(confirmButton().disabled).toBe(true);
    await change(reasonInput(), "x".repeat(1000));
    expect(confirmButton().disabled).toBe(false);
    expect(reasonInput().maxLength).toBe(1000);
    expect(text()).toContain("Do not include bank or payment details");
  });
  it("does not infer consent from equal names or identical emails", async () => {
    mock.preview.data = {
      ...makePreview(),
      prospect: { ...makePreview().prospect, email: candidate.signupEmail },
    };
    await review();
    expect(checkbox().checked).toBe(false);
    await change(
      reasonInput(),
      "Names and emails checked with independent evidence"
    );
    expect(confirmButton().disabled).toBe(true);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("previews original and selected identity side by side and explains only recruitment effects", async () => {
    await review();
    expect(lastHook("previewSignupLink")).toMatchObject({
      input: { prospectId: 701, joinSessionId: 901 },
      options: {
        enabled: true,
        staleTime: 0,
        gcTime: 0,
        refetchOnMount: "always",
      },
    });
    for (const expected of [
      "Original enquiry #701",
      "Selected signed signup / member",
      "synthetic.enquiry@example.test",
      "Historical source",
      "original referral",
      "marked Won",
      "archived, not deleted",
      "follow-ups are cancelled",
      "No emails are sent",
      "payment and mandate details are not changed",
    ])
      expect(text()).toContain(expected);
  });
  it.each(["prospect", "session", "user", "linkedElsewhere"])(
    "blocks a preview %s identity mismatch",
    async field => {
      const preview = makePreview();
      if (field === "prospect") preview.prospect.id = 999;
      if (field === "session")
        preview.signup = { ...candidate, joinSessionId: 999 };
      if (field === "user") preview.signup = { ...candidate, userId: 999 };
      if (field === "linkedElsewhere")
        preview.signup = { ...candidate, linkedProspectId: 999 };
      mock.preview.data = preview;
      await review();
      await change(reasonInput(), "Verified fictional evidence");
      expect(text()).toContain(
        "does not match the selected enquiry and signup identities"
      );
      expect(checkbox().disabled).toBe(true);
      expect(confirmButton().disabled).toBe(true);
      expect(mock.save).not.toHaveBeenCalled();
    }
  );
  it("blocks preview errors and does not offer a manual alternative to server eligibility", async () => {
    mock.preview.error = new Error("Signup not eligible");
    await review();
    expect(text()).toContain("Cannot link these records: Signup not eligible");
    expect(text()).not.toContain("marked Won");
    expect(confirmButton().disabled).toBe(true);
    await click("Refresh preview");
    expect(mock.previewRefetch).toHaveBeenCalledOnce();
    expect(confirmButton().disabled).toBe(true);
  });
  it("blocks loading and refetching previews even when old data is present", async () => {
    mock.preview.isFetching = true;
    await review();
    expect(text()).toContain("Checking the current records");
    expect(text()).not.toContain("Original enquiry #701");
    expect(confirmButton().disabled).toBe(true);
  });
  it("blocks an expired token and requires a fresh preview plus renewed identity check", async () => {
    mock.preview.data = {
      ...makePreview(),
      expiresAt: new Date(Date.now() - 1).toISOString(),
    };
    await review();
    expect(text()).toContain("This preview has expired");
    expect(confirmButton().disabled).toBe(true);
    mock.preview.data = makePreview();
    await click("Refresh preview");
    await render();
    expect(checkbox().checked).toBe(false);
    await approve();
    expect(confirmButton().disabled).toBe(false);
  });
  it("rechecks expiry on the confirm click even before the display timer runs", async () => {
    await review();
    await approve();
    const future = Date.now() + 11 * 60 * 1000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(future);
    await click("Confirm link and mark Won");
    expect(mock.save).not.toHaveBeenCalled();
    clock.mockRestore();
  });
  it("does not resubmit a server-reported already-linked preview", async () => {
    mock.preview.data = { ...makePreview(), alreadyLinked: true };
    await review();
    expect(text()).toContain("already linked to this enquiry");
    expect(confirmButton().disabled).toBe(true);
  });
  it("resets selection and all consent on search edits, another candidate, and dialog reopening", async () => {
    mock.search.data = {
      items: [candidate, alternate],
      hasMore: false,
      nextCursor: null,
    };
    await review();
    await approve();
    mock.preview.data = makePreview(alternate);
    await click("Review signup");
    expect(lastHook("previewSignupLink").input).toEqual({
      prospectId: 701,
      joinSessionId: 902,
    });
    expect(reasonInput().value).toBe("");
    expect(checkbox().checked).toBe(false);
    await approve();
    await change(searchInput(), "Synthetic new");
    expect(document.body.querySelector("textarea")).toBeNull();
    expect(lastHook("searchCompletedSignups").options.enabled).toBe(false);
    await click("Cancel");
    await click("Link completed signup");
    expect(searchInput().value).toBe("");
    expect(document.body.querySelector("textarea")).toBeNull();
  });
  it("resets all dialog state when the parent keys a different original enquiry", async () => {
    await review();
    await approve();
    await render(703);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await click("Link completed signup");
    expect(searchInput().value).toBe("");
    expect(lastHook("signupLinkState").input).toEqual({ prospectId: 703 });
  });
  it("uses cursor pagination and resets selection on page, cursor error, and a new search", async () => {
    mock.search.data = { items: [candidate], hasMore: true, nextCursor: 30 };
    await review();
    await approve();
    await click("Next");
    expect(lastHook("searchCompletedSignups").input).toEqual({
      search: "Synthetic Person",
      cursor: 30,
    });
    expect(document.body.querySelector("textarea")).toBeNull();
    await click("Review signup");
    await approve();
    mock.search.error = new Error("Cursor no longer valid");
    await render();
    expect(text()).toContain("Cursor no longer valid");
    expect(document.body.querySelector("textarea")).toBeNull();
    mock.search.error = null;
    await change(searchInput(), "synthetic.other@example.test");
    await click("Search");
    expect(lastHook("searchCompletedSignups").input).toEqual({
      search: "synthetic.other@example.test",
    });
    expect(text()).toContain("Page 1");
    expect(button("Previous").disabled).toBe(true);
    await click("Next");
    await click("Previous");
    expect(lastHook("searchCompletedSignups").input).toEqual({
      search: "synthetic.other@example.test",
    });
  });
  it("guards rapid duplicate clicks, keeps the dialog mounted, and freezes fields while saving", async () => {
    let resolve!: (value: unknown) => void;
    mock.save.mockReturnValue(
      new Promise(result => {
        resolve = result;
      })
    );
    await review();
    await approve();
    const confirm = confirmButton();
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(mock.save).toHaveBeenCalledOnce();
    expect(button("Linking…").disabled).toBe(true);
    expect(searchInput().disabled).toBe(true);
    expect(reasonInput().readOnly).toBe(true);
    expect(checkbox().closest("fieldset")?.disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    expect(
      document.body.querySelector('[data-slot="dialog-close"]')
    ).toBeNull();
    // A background search transition must not unmount the in-flight review.
    mock.search.isFetching = true;
    await render();
    expect(button("Linking…")).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
    mock.state.data = linkedState();
    await act(async () =>
      resolve({
        linked: true,
        alreadyLinked: false,
        prospectId: 701,
        userId: 801,
        supersededProspectId: 702,
      })
    );
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
  it("confirms only the reviewed token and reason, invalidates the verified recruitment queries, and reads the fresh card", async () => {
    await review();
    await approve("  Checked fictional evidence  ");
    await click("Confirm link and mark Won");
    expect(mock.save).toHaveBeenCalledOnce();
    expect(mock.save).toHaveBeenCalledWith({
      prospectId: 701,
      joinSessionId: 901,
      token: "synthetic-token-901",
      reason: "Checked fictional evidence",
      samePersonConfirmed: true,
    });
    expect(mock.invalidations.getProspect).toHaveBeenCalledWith({ id: 701 });
    expect(mock.invalidations.signupLinkState).toHaveBeenCalledWith({
      prospectId: 701,
    });
    for (const name of [
      "stageCounts",
      "listProspectsFiltered",
      "listProspects",
      "analytics",
    ] as const)
      expect(mock.invalidations[name]).toHaveBeenCalledOnce();
    expect(mock.stateRefetch).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(
      container.querySelector('a[href="/crm/agents?agent=801"]')
    ).toBeTruthy();
    expect(Object.keys(mock.invalidations)).toHaveLength(6);
    expect(
      mock.hooks.every(hook =>
        [
          "signupLinkState",
          "searchCompletedSignups",
          "previewSignupLink",
        ].includes(hook.path)
      )
    ).toBe(true);
  });
  it("keeps a rejected save's reason, blocks the old token, and permits retry only after refreshed checks", async () => {
    mock.save.mockRejectedValueOnce(
      new Error("Records changed; preview again")
    );
    await review();
    await approve();
    await click("Confirm link and mark Won");
    expect(text()).toContain("Link not saved: Records changed; preview again");
    expect(reasonInput().value).toBe("Verified fictional identity evidence");
    expect(confirmButton().disabled).toBe(true);
    expect(checkbox().checked).toBe(false);
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
    mock.preview.data = { ...makePreview(), token: "synthetic-new-token" };
    await click("Refresh preview");
    await render();
    expect(reasonInput().value).toBe("Verified fictional identity evidence");
    expect(checkbox().checked).toBe(false);
    await act(async () => checkbox().click());
    await click("Confirm link and mark Won");
    expect(mock.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ token: "synthetic-new-token" })
    );
    expect(mock.save).toHaveBeenCalledTimes(2);
  });
  it("reports saved-but-refresh-failed honestly without offering another save or invitation", async () => {
    mock.invalidations.listProspectsFiltered.mockRejectedValue(
      new Error("List refresh unavailable")
    );
    mock.stateRefetch.mockRejectedValueOnce(new Error("Read unavailable"));
    await review();
    await approve();
    await click("Confirm link and mark Won");
    expect(text()).toContain("Link saved, but some views could not refresh");
    expect(text()).toContain("Do not submit it again");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(
      buttons().some(element =>
        /Confirm|Link completed signup|invite|resend|charge/i.test(
          element.textContent || ""
        )
      )
    ).toBe(false);
    expect(mock.save).toHaveBeenCalledOnce();
    await click("Refresh link status");
    expect(text()).not.toContain("could not refresh");
    expect(mock.save).toHaveBeenCalledOnce();
  });
});
