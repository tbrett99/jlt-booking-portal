// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportCitation, SupportConversationMessage } from "../shared/agent-support-pilot";

const mocks = vi.hoisted(() => ({
  overview: {} as any, conversations: {} as any, gaps: {} as any,
  queries: [] as { path: string; input: unknown; options: unknown }[],
  ask: vi.fn(), feedback: vi.fn(), history: vi.fn(), invalidate: vi.fn(),
  refetchOverview: vi.fn(), refetchConversations: vi.fn(), refetchGaps: vi.fn(),
  toastError: vi.fn(), toastSuccess: vi.fn(),
}));
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any => new Proxy({}, { get: (_target, key: string) => {
    if (key === "useUtils") return () => node();
    if (key === "invalidate") return mocks.invalidate;
    if (key === "fetch" && path === "agentSupport.conversation") return mocks.history;
    if (key === "useMutation") return () => {
      if (path === "agentSupport.ask") return { mutateAsync: mocks.ask, isPending: false };
      if (path === "agentSupport.feedback") return { mutateAsync: mocks.feedback, isPending: false };
      throw new Error(`Unexpected mutation: ${path}`);
    };
    if (key === "useQuery") return (input: unknown, options: unknown) => {
      mocks.queries.push({ path, input, options });
      if (path === "agentSupport.overview") return { ...mocks.overview, refetch: mocks.refetchOverview };
      if (path === "agentSupport.conversations") return { ...mocks.conversations, refetch: mocks.refetchConversations };
      if (path === "agentSupport.recentGaps") return { ...mocks.gaps, refetch: mocks.refetchGaps };
      throw new Error(`Unexpected query: ${path}`);
    };
    return node(path ? `${path}.${key}` : key);
  } });
  return { trpc: node() };
});
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
// Streamdown imports KaTeX CSS through an external Node module. Stub only that
// third-party renderer; the actual Admin page, AIChatBox and all controls remain real.
vi.mock("streamdown", async () => {
  const { createElement } = await import("react");
  return {
    Streamdown: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
    defaultRemarkPlugins: { gfm: () => undefined },
  };
});

import AdminAgentSupport from "../client/src/pages/admin/AdminAgentSupport";
import { AIChatBox, type Message } from "../client/src/components/AIChatBox";

const date = "2026-11-13T10:00:00.000Z";
function source(index: number, title: string, href = `/knowledge-base?article=${index}`): SupportCitation {
  return { index, key: `synthetic:${title}`, kind: "knowledge_base", title, href,
    label: title, timestampLabel: null, updatedAt: date };
}
function turn(id: number, overrides: Partial<SupportConversationMessage> = {}): SupportConversationMessage {
  return { id, role: "assistant", content: `Synthetic saved answer ${id}`, createdAt: date,
    sources: [source(1, `Saved source ${id}`)], disposition: "answered", verified: true, feedback: null, ...overrides };
}
function result(id = 12, overrides: Record<string, unknown> = {}) {
  return { conversationId: 7, messageId: id, userMessageId: id - 1, question: "Synthetic process question",
    answer: `Synthetic answer ${id}`, sources: [source(1, `Source for ${id}`)],
    status: "answered", disposition: "answered", verified: true, ...overrides };
}
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root;
let container: HTMLDivElement;
let storageWrite: ReturnType<typeof vi.spyOn>;
const text = () => container.textContent ?? "";
async function render(key = "initial") {
  await act(async () => root.render(React.createElement(AdminAgentSupport, { key })));
}
function button(label: string, scope: ParentNode = container) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label);
  expect(found, `rendered button '${label}'`).toBeTruthy();
  return found!;
}
async function click(label: string, scope: ParentNode = container) {
  await act(async () => button(label, scope).click());
}
async function typeQuestion(value: string) {
  const input = container.querySelector("textarea")!;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit(value = "Synthetic process question") {
  await typeQuestion(value);
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
async function resume(id: number) {
  const select = container.querySelector<HTMLSelectElement>("#support-conversation")!;
  await act(async () => {
    select.value = String(id);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const footer = (id: number) => container.querySelector<HTMLElement>(`[data-answer-id="${id}"]`)!;
function answerBubble(id: number) {
  expect(footer(id)).toBeTruthy();
  return footer(id).parentElement!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React); // Vitest uses the classic JSX runtime in this repository.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden: synthetic UI regressions only"); }));
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  mocks.queries = [];
  mocks.overview = { data: { pilotScope: "admin_only", retentionDays: 90, sourceCounts: { knowledge_base: 4, portal_procedure: 1 },
    metrics: { questions: 3, answered: 2, unresolved: 1, helpful: 1, notHelpful: 0 } }, isLoading: false, isError: false, isFetching: false };
  mocks.conversations = { data: [{ id: 7, updatedAt: date, startedAt: date }, { id: 8, updatedAt: date, startedAt: date }],
    isLoading: false, isError: false, isFetching: false };
  mocks.gaps = { data: [], isLoading: false, isError: false, isFetching: false };
  mocks.ask.mockReset().mockResolvedValue(result());
  mocks.feedback.mockReset().mockResolvedValue({ success: true });
  mocks.history.mockReset().mockImplementation(async ({ conversationId }: { conversationId: number }) => ({ id: conversationId, messages: [
    turn(9, { role: "user", content: "Synthetic saved question", sources: [], verified: false }), turn(10, { feedback: "helpful" }),
  ] }));
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.refetchOverview.mockResolvedValue({ isError: false });
  mocks.refetchConversations.mockResolvedValue({ isError: false });
  mocks.refetchGaps.mockResolvedValue({ isError: false });
  storageWrite = vi.spyOn(Storage.prototype, "setItem");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(fetch).not.toHaveBeenCalled();
  expect(storageWrite).not.toHaveBeenCalled();
  storageWrite.mockRestore();
  vi.unstubAllGlobals();
});

describe("rendered conversational Admin support pilot", () => {
  it("keeps the privacy warning, admin-only scope, all seven source counts, and optional metrics defaults", async () => {
    await render();
    expect(text()).toContain("Admin and Super Admin only.");
    expect(text()).toContain("Agent access disabled");
    expect(text()).toContain("Do not include client names, booking/payment references, bank details or private documents. This pilot cannot inspect individual records.");
    expect(text()).toContain("not a guarantee that every claim is correct");
    expect(text()).not.toContain("grounded answers");
    for (const [label, count] of [["Knowledge Base", 4], ["JLT Academy", 0], ["Webinar", 0], ["Supplier Directory", 0], ["Community update", 0], ["Terms & Policies", 0], ["Portal procedure", 1]]) {
      const metric = [...container.querySelectorAll("p")].find(item => item.textContent === label)!.parentElement!;
      expect(metric.textContent).toBe(`${count}${label}`);
    }
    for (const label of ["clarifications", "answers withheld", "privacy blocked", "technical failures", "prompt tokens", "completion tokens", "model calls"]) {
      expect([...container.querySelectorAll("p")].find(item => item.textContent === label)!.parentElement!.textContent).toBe(`0${label}`);
    }
    expect(container.querySelector("details")!.open).toBe(false);
    expect([...new Set(mocks.queries.map(item => item.path))]).toEqual(["agentSupport.overview", "agentSupport.conversations", "agentSupport.recentGaps"]);
    expect(mocks.queries.filter(item => item.path === "agentSupport.conversations").every(item => item.input === undefined)).toBe(true);
    expect(mocks.queries.filter(item => item.path === "agentSupport.recentGaps").every(item => (item.options as { enabled: boolean }).enabled === false)).toBe(true);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.feedback).not.toHaveBeenCalled();
  });

  it("still renders every supported source kind when no eligible sources are loaded", async () => {
    mocks.overview.data.sourceCounts = {};
    await render();
    for (const label of ["Knowledge Base", "JLT Academy", "Webinar", "Supplier Directory", "Community update", "Terms & Policies", "Portal procedure"]) {
      const metric = [...container.querySelectorAll("p")].find(item => item.textContent === label)!.parentElement!;
      expect(metric.textContent).toBe(`0${label}`);
    }
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("explains indexed text and exclusions, distinguishes loaded sources from model passages, and suggests generic reimbursement guidance", async () => {
    await render();
    expect(text()).toContain("Indexed: published Knowledge Base text; published, non-archived Academy lesson text; webinar descriptions and staff-approved transcript text; active supplier public descriptions; eligible admin announcements; current policies and curated procedures.");
    expect(text()).toContain("Not indexed: Academy video/audio transcripts or downloadable document contents; draft or archived content, private assessments, or learner, customer or financial data.");
    expect(text()).toContain("Counts show loaded eligible sources, not everything sent to the model. Only relevant passages are sent for each question.");
    expect(text()).toContain("held for 90 days for quality review. Only your own unexpired conversations appear here.");
    expect(button("What is the process for requesting reimbursement?")).toBeTruthy();
    expect(text()).not.toContain("What does the Academy say about client data?");
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("retains each answer's own citations and feedback inside its bubble after more turns", async () => {
    mocks.ask.mockResolvedValueOnce(result(12, { answer: "First synthetic procedure", sources: [source(1, "First approved guide")] }))
      .mockResolvedValueOnce(result(14, { question: "Where do I upload it?", answer: "Second synthetic step", sources: [source(1, "Second approved guide", "/my-bookings")] }));
    await render();
    await submit();
    await click("Helpful", footer(12));
    await submit("Where do I upload it?");
    expect(mocks.ask.mock.calls.map(call => call[0])).toEqual([
      { question: "Synthetic process question", conversationId: undefined }, { question: "Where do I upload it?", conversationId: 7 },
    ]);
    expect(answerBubble(12).textContent).toContain("First synthetic procedure");
    expect(footer(12).querySelector("a")!.getAttribute("href")).toBe("/knowledge-base?article=1");
    expect(footer(12).textContent).not.toContain("Second approved guide");
    expect(button("Helpful", footer(12)).getAttribute("aria-pressed")).toBe("true");
    expect(answerBubble(14).textContent).toContain("Second synthetic step");
    expect(footer(14).querySelector("a")!.getAttribute("href")).toBe("/my-bookings");
    expect(button("Helpful", footer(14)).getAttribute("aria-pressed")).toBe("false");
    await click("Needs work", footer(14));
    expect(mocks.feedback.mock.calls.map(call => call[0])).toEqual([{ messageId: 12, rating: "helpful" }, { messageId: 14, rating: "not_helpful" }]);
    expect(button("Helpful", footer(12)).getAttribute("aria-pressed")).toBe("true");
    expect(button("Needs work", footer(14)).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll('[aria-label="Sources for this answer"]')).toHaveLength(2);
  });

  it("resumes only the selected own conversation and keeps saved sources and feedback on follow-up", async () => {
    await render();
    expect([...container.querySelectorAll("select option")].map(option => option.getAttribute("value"))).toEqual(["", "7", "8"]);
    await resume(7);
    expect(mocks.history).toHaveBeenCalledWith({ conversationId: 7 });
    expect(text()).toContain("Synthetic saved question");
    expect(text()).toContain("Synthetic saved answer 10");
    expect(footer(10).querySelector("a")!.textContent).toContain("Saved source 10");
    expect(button("Helpful", footer(10)).getAttribute("aria-pressed")).toBe("true");
    await submit("Please explain that step more clearly");
    expect(mocks.ask).toHaveBeenCalledWith({ question: "Please explain that step more clearly", conversationId: 7 });
    expect(footer(10)).toBeTruthy();
    expect(footer(12)).toBeTruthy();
  });

  it("new conversation clears transcript, per-answer footer, feedback, and context ID without another history read", async () => {
    await render(); await resume(7);
    await typeQuestion("Unsent synthetic draft");
    await click("New conversation");
    expect(text()).not.toContain("Synthetic saved question");
    expect(container.querySelector("[data-answer-id]")).toBeNull();
    expect(container.querySelector("textarea")!.value).toBe("");
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("");
    await submit("Different generic procedure");
    expect(mocks.ask).toHaveBeenCalledWith({ question: "Different generic procedure", conversationId: undefined });
    expect(mocks.history).toHaveBeenCalledTimes(1);
  });

  it("replaces optimistic raw input with the server-screened question, never persisting browser text", async () => {
    const waiting = deferred(); mocks.ask.mockReturnValueOnce(waiting.promise);
    await render(); await submit("SYNTHETIC_PRIVATE_INPUT_TOKEN");
    expect(text()).toContain("SYNTHETIC_PRIVATE_INPUT_TOKEN");
    await act(async () => waiting.resolve(result(12, {
      question: "[Private details omitted. Please ask a general process question.]", answer: "Ask about the generic process instead.",
      status: "insufficient_sources", disposition: "privacy_blocked", verified: false, sources: [],
    })));
    expect(text()).not.toContain("SYNTHETIC_PRIVATE_INPUT_TOKEN");
    expect(text()).toContain("[Private details omitted. Please ask a general process question.]");
    expect(footer(12).textContent).toContain("Private details omitted");
    expect(footer(12).textContent).not.toContain("Source-checked guidance");
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("preserves successfully saved answers and votes when audit query invalidation fails", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Synthetic refresh failure"));
    await render(); await submit();
    expect(text()).toContain("Synthetic answer 12");
    expect(text()).toContain("Saved successfully, but the pilot summary could not refresh");
    expect(mocks.toastError).not.toHaveBeenCalled();
    await click("Helpful", footer(12));
    expect(button("Helpful", footer(12)).getAttribute("aria-pressed")).toBe("true");
    expect(text()).toContain("Synthetic answer 12");
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("does not replace the current transcript on list refresh, and hides stale list and gaps after query failures", async () => {
    await render(); await submit();
    mocks.conversations = { ...mocks.conversations, isError: true, error: new Error("Synthetic list failure") };
    mocks.gaps = { ...mocks.gaps, data: [{ id: 50, question: "STALE_SYNTHETIC_GAP", reason: "no_relevant_approved_source", createdAt: date }], isError: true };
    await render();
    expect(text()).toContain("Synthetic answer 12");
    expect(text()).toContain("Your conversation list could not load");
    expect(container.querySelectorAll("select option")).toHaveLength(1);
    await click("Retry list"); expect(mocks.refetchConversations).toHaveBeenCalledTimes(1);
    await act(async () => { const details = container.querySelector("details")!; details.open = true; details.dispatchEvent(new Event("toggle")); });
    expect(text()).toContain("Recent gaps could not load");
    expect(text()).not.toContain("STALE_SYNTHETIC_GAP");
    await click("Retry gaps"); expect(mocks.refetchGaps).toHaveBeenCalledTimes(1);
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("shows a failed history read rather than old content, blocks sends, and can retry or reset", async () => {
    await render(); await submit();
    mocks.history.mockRejectedValueOnce(new Error("This assistant conversation is no longer available."));
    await resume(8);
    expect(text()).not.toContain("Synthetic answer 12");
    expect(container.querySelector("[data-answer-id]")).toBeNull();
    expect(text()).toContain("This conversation could not load");
    await submit("Must not send against unavailable history");
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    await click("Retry conversation");
    expect(mocks.history).toHaveBeenLastCalledWith({ conversationId: 8 });
    expect(text()).toContain("Synthetic saved answer 10");
    await click("New conversation");
    expect(text()).not.toContain("Synthetic saved answer 10");
  });

  it("guards same-tick duplicate sends and disables rate, resume and reset while an ask is pending", async () => {
    await render(); await resume(7);
    const waiting = deferred(); mocks.ask.mockReturnValueOnce(waiting.promise);
    await typeQuestion("Where next?");
    await act(async () => {
      const form = container.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    expect(button("New conversation").disabled).toBe(true);
    expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
    expect(button("Helpful", footer(10)).disabled).toBe(true);
    await click("Helpful", footer(10)); await click("New conversation");
    expect(mocks.feedback).not.toHaveBeenCalled();
    await act(async () => waiting.resolve(result()));
    expect(text()).toContain("Synthetic saved answer 10");
    expect(text()).toContain("Synthetic answer 12");
    expect(button("New conversation").disabled).toBe(false);
  });

  it("guards double-click suggested prompts before rerender", async () => {
    const waiting = deferred(); mocks.ask.mockReturnValueOnce(waiting.promise);
    await render();
    await act(async () => {
      const prompt = button("Where can I find guidance on a supplier?"); prompt.click(); prompt.click();
    });
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    await act(async () => waiting.resolve(result()));
  });

  it("blocks mixing during pending feedback and records only the requested answer", async () => {
    await render(); await resume(7);
    const waiting = deferred(); mocks.feedback.mockReturnValueOnce(waiting.promise);
    await act(async () => { const rate = button("Needs work", footer(10)); rate.click(); rate.click(); });
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
    expect(button("New conversation").disabled).toBe(true);
    expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
    await submit("Must wait for feedback"); expect(mocks.ask).not.toHaveBeenCalled();
    await act(async () => waiting.resolve({ success: true }));
    expect(button("Needs work", footer(10)).getAttribute("aria-pressed")).toBe("true");
  });

  it("prevents duplicate history reads and a late history response cannot overwrite a new mounted chat", async () => {
    const waiting = deferred(); mocks.history.mockReturnValueOnce(waiting.promise);
    await render();
    await act(async () => {
      const select = container.querySelector("select")!; select.value = "7";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.value = "8"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(button("New conversation").disabled).toBe(true);
    await submit("Cannot mix with a pending resume"); expect(mocks.ask).not.toHaveBeenCalled();
    // Simulates leaving and returning to the page while its older read is still in flight.
    await render("fresh-page"); await submit("New mounted conversation");
    await act(async () => waiting.resolve({ id: 7, messages: [turn(99, { content: "LATE_SYNTHETIC_HISTORY" })] }));
    expect(text()).toContain("Synthetic answer 12");
    expect(text()).not.toContain("LATE_SYNTHETIC_HISTORY");
    expect(footer(12)).toBeTruthy();
    expect(footer(99)).toBeNull();
  });

  it("rejects mismatched conversation responses without displaying their messages", async () => {
    mocks.history.mockResolvedValueOnce({ id: 999, messages: [turn(99, { content: "FOREIGN_SYNTHETIC_HISTORY" })] });
    await render(); await resume(7);
    expect(text()).toContain("This conversation could not load");
    expect(text()).not.toContain("FOREIGN_SYNTHETIC_HISTORY");
    expect(container.querySelector("[data-answer-id]")).toBeNull();
  });

  it("labels unverified legacy answers honestly, preserves their footers, and disables unsafe source links locally", async () => {
    // These are synthetic, already-screened reader outputs; the browser never reads private records.
    mocks.history.mockResolvedValueOnce({ id: 7, messages: [
      turn(9, { role: "user", content: "[Private details omitted. Please ask a general process question.]", sources: [], verified: false }),
      turn(10, { content: "Synthetic historical explanation", verified: false, feedback: "not_helpful", sources: [
        source(1, "Legacy approved guide"), source(2, "Unsafe scheme", "javascript:alert(1)"),
        source(3, "Unsafe remote", "//example.invalid/private"), source(4, "Unsafe route", "/admin/users"),
        source(5, "Unsafe redirect", "/knowledge-base?article=1&redirect=https://example.invalid"),
      ] }),
      turn(11, { content: "This message is unavailable.", disposition: "failed", sources: [], verified: false }),
    ] });
    await render(); await resume(7);
    expect(footer(10).textContent).toContain("Unverified legacy answer");
    expect(footer(10).textContent).not.toContain("Source-checked guidance");
    expect(button("Needs work", footer(10)).getAttribute("aria-pressed")).toBe("true");
    expect(footer(10).querySelectorAll("a")).toHaveLength(1);
    expect(footer(10).textContent).toContain("Unsafe scheme — link unavailable");
    expect(footer(11).textContent).toContain("Temporarily unavailable");
    expect(text()).toContain("This message is unavailable.");
    await submit("General follow-up");
    expect(footer(10).textContent).toContain("Unverified legacy answer");
    expect(footer(11)).toBeTruthy();
    expect(footer(12).textContent).toContain("Source-checked guidance");
  });

  it("removes failed optimistic input, displays the safe mutation error, and permits retry", async () => {
    mocks.ask.mockRejectedValueOnce(new Error("The assistant pilot has a 30-question-per-hour limit. Please try again shortly."));
    await render(); await submit("SYNTHETIC_FAILED_INPUT");
    expect(text()).not.toContain("SYNTHETIC_FAILED_INPUT");
    expect(mocks.toastError).toHaveBeenCalledWith("The assistant pilot has a 30-question-per-hour limit. Please try again shortly.");
    expect(button("New conversation").disabled).toBe(false);
    await submit(); expect(footer(12)).toBeTruthy();
  });

  it("displays clarification, partial, withheld and unavailable responses without overclaiming source checks", async () => {
    mocks.ask.mockResolvedValueOnce(result(12, { disposition: "clarify", verified: false, sources: [], status: "insufficient_sources", answer: "Is this a new generic request?" }))
      .mockResolvedValueOnce(result(14, { disposition: "partial", verified: true, question: "A new generic request", answer: "Only this generic step is supported." }))
      .mockResolvedValueOnce(result(16, { disposition: "validation_failed", verified: false, sources: [], status: "insufficient_sources", answer: "Unsupported synthetic claims were withheld." }))
      .mockResolvedValueOnce(result(18, { disposition: "failed", verified: false, sources: [], status: "failed", answer: "The assistant is temporarily unavailable." }));
    await render(); await submit();
    expect(footer(12).textContent).toContain("Clarification needed");
    await submit("A new generic request");
    expect(footer(14).textContent).toContain("Partial guidance");
    await submit("Explain another generic step");
    expect(footer(16).textContent).toContain("Answer withheld");
    await submit("Try the generic process again");
    expect(footer(18).textContent).toContain("Temporarily unavailable");
    expect(container.querySelectorAll("[data-answer-id]")).toHaveLength(4);
    expect(text()).not.toContain("Source-checked guidance");
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("fails closed if a successful response omits its screened question", async () => {
    mocks.ask.mockResolvedValueOnce(result(12, { question: undefined }));
    await render(); await submit("SYNTHETIC_RAW_QUESTION_MUST_NOT_REMAIN");
    expect(text()).not.toContain("SYNTHETIC_RAW_QUESTION_MUST_NOT_REMAIN");
    expect(text()).toContain("[Question unavailable.]");
    expect(footer(12)).toBeTruthy();
  });

  it("ignores an obsolete ask response after the page has been remounted", async () => {
    const waiting = deferred(); mocks.ask.mockReturnValueOnce(waiting.promise);
    await render(); await submit("Old mounted question");
    await render("another-page-instance"); await submit("Current mounted question");
    await act(async () => waiting.resolve(result(98, { answer: "LATE_SYNTHETIC_ASK" })));
    expect(text()).not.toContain("LATE_SYNTHETIC_ASK");
    expect(text()).toContain("Synthetic answer 12");
    expect(footer(98)).toBeNull();
  });

  it("keeps the previous saved vote and transcript when feedback persistence fails", async () => {
    mocks.feedback.mockRejectedValueOnce(new Error("This assistant answer is no longer available for feedback."));
    await render(); await resume(7); await click("Needs work", footer(10));
    expect(button("Helpful", footer(10)).getAttribute("aria-pressed")).toBe("true");
    expect(button("Needs work", footer(10)).getAttribute("aria-pressed")).toBe("false");
    expect(text()).toContain("Synthetic saved answer 10");
    expect(button("New conversation").disabled).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith("This assistant answer is no longer available for feedback.");
  });

  it("hides stale overview after a query failure and preserves the saved chat after recovery", async () => {
    await render(); await submit();
    mocks.overview = { ...mocks.overview, isError: true, error: new Error("Synthetic summary error") };
    await render();
    expect(text()).toContain("AI Support Pilot is not ready yet");
    expect(container.querySelector("textarea")).toBeNull();
    expect(text()).not.toContain("Synthetic answer 12");
    await click("Try again"); expect(mocks.refetchOverview).toHaveBeenCalledTimes(1);
    mocks.overview.isError = false; await render();
    expect(text()).toContain("Synthetic answer 12");
    expect(footer(12)).toBeTruthy();
  });
});

describe("backward-compatible shared chat footer", () => {
  it("renders optional footers at original message indexes, leaving system messages hidden", async () => {
    const messages: Message[] = [{ role: "system", content: "SYNTHETIC_SYSTEM" }, { role: "user", content: "Synthetic user" }, { role: "assistant", content: "Synthetic assistant" }];
    const footerRenderer = vi.fn((_message: Message, index: number) => React.createElement("span", null, `Footer ${index}`));
    const send = vi.fn();
    await act(async () => root.render(React.createElement(AIChatBox, { messages, onSendMessage: send, renderMessageFooter: footerRenderer })));
    expect(text()).not.toContain("SYNTHETIC_SYSTEM");
    expect(text()).toContain("Footer 1"); expect(text()).toContain("Footer 2");
    expect(footerRenderer.mock.calls.map(call => call[1])).toEqual([1, 2]);
    footerRenderer.mockClear();
    await act(async () => root.render(React.createElement(AIChatBox, { messages: [messages[2], messages[2]], onSendMessage: send, renderMessageFooter: footerRenderer })));
    expect(footerRenderer.mock.calls.map(call => call[1])).toEqual([0, 1]);
    await act(async () => root.render(React.createElement(AIChatBox, { messages, onSendMessage: send })));
    expect(text()).toContain("Synthetic assistant"); expect(text()).not.toContain("Footer");
    expect(send).not.toHaveBeenCalled();
  });
});
