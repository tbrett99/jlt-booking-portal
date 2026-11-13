// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSafeSupportHref } from "../shared/agent-support-metadata";
import type { SupportCitation, SupportConversationMessage } from "../shared/agent-support-pilot";
import { safeStoredSupportText } from "./agent-support-privacy";

// Load the installed, unmodified ESM implementation through Vite's documented
// inline query so its side-effect KaTeX CSS import is handled by Vite, not Node.
// This is the actual Streamdown renderer, NOT a React/Markdown renderer stub.
vi.mock("streamdown", () => import("../node_modules/streamdown/dist/index.js?inline"));

const mocks = vi.hoisted(() => ({ history: vi.fn(), ask: vi.fn(), feedback: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ agentSupport: {
    conversation: { fetch: mocks.history },
    overview: { invalidate: mocks.invalidate }, conversations: { invalidate: mocks.invalidate }, recentGaps: { invalidate: mocks.invalidate },
  } }),
  agentSupport: {
    overview: { useQuery: () => ({ data: {
      retentionDays: 90, sourceCounts: { knowledge_base: 2 },
      metrics: { questions: 1, answered: 1, unresolved: 0, helpful: 0, notHelpful: 0 },
    }, isLoading: false, isError: false }) },
    conversations: { useQuery: () => ({ data: [{ id: 7, updatedAt: "2026-11-13T10:00:00.000Z" }], isLoading: false, isError: false }) },
    recentGaps: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
    ask: { useMutation: () => ({ mutateAsync: mocks.ask }) },
    feedback: { useMutation: () => ({ mutateAsync: mocks.feedback }) },
  },
} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { Streamdown, defaultRehypePlugins } from "streamdown";
import { AIChatBox, type AIChatBoxProps } from "../client/src/components/AIChatBox";
import AdminAgentSupport from "../client/src/pages/admin/AdminAgentSupport";

let root: Root;
let container: HTMLDivElement;
let storageWrite: ReturnType<typeof vi.spyOn>;
const unsafeElements = "img, picture, source, iframe, script, style, video, audio, object, embed, svg, math, link";
const text = () => container.textContent ?? "";
const anchors = () => [...container.querySelectorAll<HTMLAnchorElement>("a")];
const hrefs = () => anchors().map(anchor => anchor.getAttribute("href"));
async function renderChat(content: string, supportPilotMarkdown: boolean | undefined = true, extra: Partial<AIChatBoxProps> = {}) {
  await act(async () => root.render(React.createElement(AIChatBox, {
    messages: [{ role: "assistant", content }], onSendMessage: vi.fn(), supportPilotMarkdown, ...extra,
  })));
}
function expectNoActiveContent() {
  // Check untrusted Markdown, not the surrounding trusted Lucide icons or
  // Radix ScrollArea's own style tags. No UI/renderer components are stubbed.
  const markdown = [...container.querySelectorAll(".prose")];
  expect(markdown.length).toBeGreaterThan(0);
  for (const scope of markdown) {
    expect(scope.querySelectorAll(unsafeElements)).toHaveLength(0);
    expect(scope.querySelectorAll("[src], [srcset], [onerror], [onclick], [style*='url(']")).toHaveLength(0);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React); // Existing repository Vitest uses classic JSX.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden: synthetic renderer regressions only"); }));
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.feedback.mockResolvedValue({ success: true });
  storageWrite = vi.spyOn(Storage.prototype, "setItem");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(fetch).not.toHaveBeenCalled();
  expect(storageWrite).not.toHaveBeenCalled();
  storageWrite.mockRestore();
  vi.unstubAllGlobals();
});

describe("actual Streamdown opt-in admin support Markdown", () => {
  it("uses installed renderer and its real default exports, not a Streamdown stub", async () => {
    expect(defaultRehypePlugins.raw).toBeTypeOf("function");
    await act(async () => root.render(React.createElement(Streamdown, { rehypePlugins: [] }, "## Real renderer\n\n- One\n- Two")));
    expect(container.querySelector('[data-streamdown="heading-2"]')?.textContent).toBe("Real renderer");
    expect(container.querySelectorAll('[data-streamdown="list-item"]')).toHaveLength(2);
  });

  const blockedHrefs = [
    "https://example.invalid/login", "http://example.invalid/login", "//example.invalid/login",
    "///example.invalid/login", "https://portal.thejltgroup.co.uk/academy", "/login", "/admin",
    "/admin/agent-support", "/knowledge-base/extra", "/academy#login", "#login", "academy",
    "javascript:alert%281%29", "JaVaScRiPt:alert%281%29", "data:text/html,payload", "vbscript:payload",
    "ftp://example.invalid/login", "tel:123", "mailto:other@example.invalid",
    "mailto:support@thejltgroup.co.uk.evil", "MAILTO:support@thejltgroup.co.uk",
    "mailto:support@thejltgroup.co.uk?subject=help", "mailto:support@thejltgroup.co.uk?bcc=other@example.invalid",
    "mailto:support%40thejltgroup.co.uk", "/%2f%2fexample.invalid/login", "/%252f%252fexample.invalid/login",
    "/%61cademy", "/academy%2f..%2flogin", "/academy?next=//example.invalid", "/academy?article=guide",
    "/knowledge-base?article=%2f%2fexample.invalid", "/knowledge-base?article=%252fexample",
    "/knowledge-base?%61rticle=guide", "/knowledge-base?article=%67uide", "/knowledge-base?article=a%0ab",
    "/knowledge-base?article=a%5cb", "/knowledge-base?article=a&redirect=https://example.invalid",
    "/academy/../login", "/login/../academy", "/%2e%2e/academy", "/./academy", "/academy/.",
    "/academy\\\\example.invalid", "streamdown:incomplete-link",
  ];
  it.each(blockedHrefs)("renders blocked destination %s as readable, non-clickable text", async href => {
    await renderChat(`[Readable guide](${href})`);
    expect(text()).toContain("Readable guide");
    expect(anchors()).toHaveLength(0);
    expectNoActiveContent();
  });

  it.each([
    "/knowledge-base?article=guide_1", "/webinars?webinar=guide-1", "/terms?version=v1&section=privacy",
    "/suppliers?supplier=guide", "/suppliers?supplierId=guide", "/community?postId=guide",
    "/academy", "/my-bookings", "/knowledge-base", "/terms", "/webinars", "/suppliers", "/community",
  ])("retains shared-approved internal navigation %s", async href => {
    expect(isSafeSupportHref(href)).toBe(true);
    await renderChat(`[Approved guide](${href})`);
    expect(hrefs()).toEqual([href]);
    expect(anchors()[0].textContent).toBe("Approved guide");
    expect(anchors()[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchors()[0].getAttribute("target")).toBe("_blank");
    expectNoActiveContent();
  });

  it("allows only the exact fixed support mailbox and not suffixes or query parameters", async () => {
    await renderChat("[JLT Support](mailto:support@thejltgroup.co.uk)\n\n[Lookalike](mailto:support@thejltgroup.co.uk.evil)\n\n[Recipient injection](mailto:support@thejltgroup.co.uk?bcc=other@example.invalid)");
    expect(hrefs()).toEqual(["mailto:support@thejltgroup.co.uk"]);
    expect(anchors()[0].textContent).toBe("JLT Support");
    expect(anchors()[0].getAttribute("target")).toBeNull();
    expect(text()).toContain("Lookalike");
    expect(text()).toContain("Recipient injection");
  });

  it.each([
    "![Readable image](https://example.invalid/pixel.png)", "![Readable image](//example.invalid/pixel.png)",
    "![Readable image](/academy)", "![Readable image](data:image/png;base64,AAAA)",
    "![Readable image][pixel]\n\n[pixel]: https://example.invalid/pixel.png",
    "[![Readable image](https://example.invalid/pixel.png)](https://example.invalid/login)",
    "[![Readable image](https://example.invalid/pixel.png)](/academy)",
  ])("disables Markdown images and downloads while retaining alt text: %s", async content => {
    await renderChat(content);
    expect(text()).toContain("Readable image");
    expectNoActiveContent();
    expect(container.querySelector('[data-streamdown="image-wrapper"]')).toBeNull();
    expect(container.querySelector('button[title="Download image"]')).toBeNull();
    expect(hrefs().every(href => isSafeSupportHref(href))).toBe(true);
  });

  it.each([
    '<img src="https://example.invalid/pixel.png" onerror="alert(1)">',
    '<img src="//example.invalid/pixel.png" srcset="https://example.invalid/second.png 2x">',
    '<a href="https://example.invalid/login">Raw link</a>',
    '<a href="/academy" onclick="alert(1)">Even internal raw HTML is disabled</a>',
    '<iframe src="https://example.invalid/login"></iframe>',
    '<svg><image href="https://example.invalid/pixel.png" /></svg>',
    '<picture><source srcset="https://example.invalid/pixel.png"><img src="/academy"></picture>',
    '<video poster="https://example.invalid/pixel.png"><source src="https://example.invalid/video"></video>',
    '<style>body { background: url(https://example.invalid/pixel.png); }</style>',
    '<script src="https://example.invalid/script.js"></script>',
    '<div style="background-image:url(https://example.invalid/pixel.png)">Raw styled HTML</div>',
  ])("never activates raw HTML: %s", async html => {
    await renderChat(`Before safe text\n\n${html}\n\nAfter safe text`);
    expect(text()).toContain("Before safe text");
    expect(text()).toContain("After safe text");
    expect(anchors()).toHaveLength(0);
    expectNoActiveContent();
  });

  it("blocks GFM bare URLs, angle autolinks, reference links and HTML-entity bypasses", async () => {
    await renderChat([
      "https://example.invalid/login", "<https://example.invalid/login>", "<mailto:other@example.invalid>",
      "[Reference link][bad]", "[bad]: //example.invalid/login", "[Entity link](&#x2f;&#x2f;example.invalid/login)",
      "[Entity script](javascript&#x3a;alert%281%29)", "[Entity separator](/knowledge-base?article=a&#x26;next=evil)",
      "[Entity mail query](mailto:support@thejltgroup.co.uk&#x3f;subject=help)",
    ].join("\n\n"));
    expect(anchors()).toHaveLength(0);
    for (const label of ["Reference link", "Entity link", "Entity script", "Entity separator", "Entity mail query"]) expect(text()).toContain(label);
    expectNoActiveContent();
  });

  it("leaves partial links readable without introducing Streamdown incomplete-link anchors", async () => {
    await renderChat("Use **bold text** and [unfinished guide](https://example.invalid");
    expect(anchors()).toHaveLength(0);
    expect(text()).toContain("unfinished guide");
    expect(text()).toContain("bold text");
  });

  it("retains readable headings, emphasis, lists, quotes, tables, escaped HTML and code", async () => {
    await renderChat([
      "## Approved guidance", "**Important** and *careful* with ~~old wording~~ and `literal code`.",
      "- First item\n- Second item", "1. First step\n2. Second step", "> Check the source.",
      "| Topic | Source |\n| --- | --- |\n| Training | [Academy](/academy) |",
      '```html\n<img src="https://example.invalid/pixel.png">\n```',
      '```mermaid\ngraph TD\nA[<img src="https://example.invalid/pixel.png">] --> B[Read guide]\nclick B "https://example.invalid/login"\n```',
      "&lt;img src=\"https://example.invalid/pixel.png\"&gt;", "---",
    ].join("\n\n"));
    expect(container.querySelector("h2")?.textContent).toBe("Approved guidance");
    expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("Important");
    expect(container.querySelector("em")?.textContent).toBe("careful");
    expect(container.querySelector("del")?.textContent).toBe("old wording");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("blockquote")?.textContent).toContain("Check the source.");
    expect(container.querySelector("table")?.textContent).toContain("Training");
    expect(container.querySelectorAll("pre code")).toHaveLength(2);
    expect(text()).toContain('click B "https://example.invalid/login"');
    expect(container.querySelector("hr")).toBeTruthy();
    expect(hrefs()).toEqual(["/academy"]);
    expect(container.querySelector('[data-streamdown="mermaid-block"]')).toBeNull();
    expectNoActiveContent();
  });

  it("preserves ordinary AIChatBox renderer behavior when the pilot prop is absent or false", async () => {
    const content = "[Ordinary external guide](https://example.invalid/login)\n\n![Ordinary image](https://example.invalid/pixel.png)\n\n<strong>Ordinary HTML</strong>";
    for (const enabled of [undefined, false]) {
      await renderChat(content, false, { supportPilotMarkdown: enabled });
      expect(hrefs()).toEqual(["https://example.invalid/login"]);
      expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.invalid/pixel.png");
      expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("Ordinary HTML");
      expect(container.querySelector('button[title="Download image"]')).toBeTruthy();
    }
  });

  it("changes the actual renderer policy even when content is unchanged, then restores ordinary mode", async () => {
    const content = "[Same guide](https://example.invalid/login)\n\n![Same image](https://example.invalid/pixel.png)";
    await renderChat(content, false);
    expect(anchors()).toHaveLength(1);
    expect(container.querySelector("img")).toBeTruthy();
    await renderChat(content, true);
    expect(anchors()).toHaveLength(0);
    expect(text()).toContain("Same guide");
    expect(text()).toContain("Same image");
    expectNoActiveContent();
    await renderChat(content, false);
    expect(anchors()).toHaveLength(1);
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("applies the policy to newly returned Admin pilot answers and keeps source/support links functional", async () => {
    mocks.ask.mockResolvedValue({ conversationId: 7, userMessageId: 9, messageId: 10, question: "Synthetic process question",
      answer: "[External guide](https://example.invalid/login)\n\n![Tracking pixel](https://example.invalid/pixel.png)\n\n[Approved guide](/academy)\n\n[JLT Support](mailto:support@thejltgroup.co.uk)",
      sources: [citation("/knowledge-base?article=guide")], disposition: "answered", verified: true });
    await act(async () => root.render(React.createElement(AdminAgentSupport)));
    const prompt = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Where can I find guidance on a supplier?")!;
    await act(async () => prompt.click());
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    expect(hrefs()).toEqual(["/academy", "mailto:support@thejltgroup.co.uk", "/knowledge-base?article=guide"]);
    expect(text()).toContain("External guide");
    expect(text()).toContain("Tracking pixel");
    expectNoActiveContent();
  });

  it("protects resumed legacy safeStoredSupportText and preserves citations, warning and feedback", async () => {
    const legacy = "[Legacy external guide](https://example.invalid/login)\n\n[Legacy protocol guide](//example.invalid/login)\n\n![Legacy image](https://example.invalid/pixel.png)\n\n[Approved guide](/academy)\n\n[JLT Support](mailto:support@thejltgroup.co.uk)";
    const screened = safeStoredSupportText(legacy, true);
    expect(screened).toBe(legacy); // Reproduces the independent-review finding.
    const message: SupportConversationMessage = { id: 10, role: "assistant", content: screened, createdAt: "2026-11-13T10:00:00.000Z",
      sources: [citation("/knowledge-base?article=guide"), citation("https://example.invalid/login", 2)],
      disposition: "answered", verified: false, feedback: null };
    mocks.history.mockResolvedValue({ id: 7, messages: [message] });
    await act(async () => root.render(React.createElement(AdminAgentSupport)));
    const select = container.querySelector<HTMLSelectElement>("#support-conversation")!;
    await act(async () => { select.value = "7"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(mocks.history).toHaveBeenCalledWith({ conversationId: 7 });
    expect(hrefs()).toEqual(["/academy", "mailto:support@thejltgroup.co.uk", "/knowledge-base?article=guide"]);
    for (const label of ["Legacy external guide", "Legacy protocol guide", "Legacy image", "Unverified legacy answer", "link unavailable"]) expect(text()).toContain(label);
    expectNoActiveContent();
    const helpful = [...container.querySelectorAll<HTMLButtonElement>("[data-answer-id='10'] button")].find(button => button.textContent?.trim() === "Helpful")!;
    await act(async () => helpful.click());
    expect(mocks.feedback).toHaveBeenCalledWith({ messageId: 10, rating: "helpful" });
    expect(helpful.getAttribute("aria-pressed")).toBe("true");
    expect(mocks.ask).not.toHaveBeenCalled();
  });
});

function citation(href: string, index = 1): SupportCitation {
  return { index, key: `synthetic:guide-${index}`, kind: "knowledge_base", title: `Approved citation ${index}`, href,
    label: "Synthetic approved guide", timestampLabel: null, updatedAt: null };
}
