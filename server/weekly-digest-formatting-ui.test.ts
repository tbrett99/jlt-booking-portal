// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use the real admin page, rich editor, toolbar, and paste handler. All API hooks
// are in-memory mocks: these tests never load database, email, or provider code.
const mock = vi.hoisted(() => ({
  digests: [] as any[],
  hooks: [] as string[],
  mutations: [] as { path: string; input: any }[],
  refetch: vi.fn(async () => undefined),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => {
  const proxy = (parts: string[] = []): any => new Proxy(() => undefined, {
    get: (_target, property: string) => {
      if (property === "useQuery") return () => {
        const path = parts.join(".");
        mock.hooks.push(path);
        if (path !== "community.digest.list") throw new Error(`Unexpected query: ${path}`);
        return { data: mock.digests, isLoading: false, refetch: mock.refetch };
      };
      if (property === "useMutation") return (options: any = {}) => {
        const path = parts.join(".");
        mock.hooks.push(path);
        const mutateAsync = async (input: unknown) => {
          mock.mutations.push({ path, input: structuredClone(input) });
          if (path !== "community.digest.send") throw new Error(`Unexpected write: ${path}`);
          const result = { sent: 1, sentCount: 1, isTest: Boolean((input as any).testToEmail) };
          await options.onSuccess?.(result);
          return result;
        };
        return { isPending: false, mutateAsync, mutate: (input: unknown) => { void mutateAsync(input); } };
      };
      return proxy([...parts, property]);
    },
  });
  return { trpc: proxy() };
});

import WeeklyDigestAdmin from "../client/src/pages/community/WeeklyDigestAdmin";
import {
  digestTextToEditorHtml,
  formatDigestIntro,
  sanitizeDigestEditorHtml,
} from "../shared/community-digest-format";

// Screenshot-like sample is invented, not copied from a private message.
const clipboardMarkdown =
  "Hello synthetic team,\n\nThank you for a **brilliant period** and thoughtful work.\n\n" +
  "## Fictional achievements\n\n- Morgan Vale: **£1,240** commission\n" +
  "- Ellis Brook: **£860** commission\n\nKeep the momentum going.";
const clipboardHtml =
  '<p class="document-paragraph">Hello synthetic team,</p>' +
  '<p>Thank you for a <b>brilliant period</b> and thoughtful work.</p>' +
  '<h2 class="document-heading">Fictional achievements</h2>' +
  '<ul><li><p>Morgan Vale: <strong>£1,240</strong> commission</p></li>' +
  '<li><p>Ellis Brook: <strong>£860</strong> commission</p></li></ul>' +
  '<p>Keep the momentum going.</p>';
const oldIntro = "Welcome back, synthetic team.\n\nAn **existing draft**.\n\n## Old heading\n\n- Existing item";
let container: HTMLDivElement;
let root: Root;
let previousSettings: Record<string, unknown>;
let initialDigests: string;

function syntheticDraft(digestType: "weekly" | "monthly", introText = oldIntro) {
  return {
    id: digestType === "weekly" ? 801 : 802,
    digestType,
    weekStarting: new Date(digestType === "weekly" ? "2026-11-02T00:00:00Z" : "2026-10-01T00:00:00Z"),
    periodEnd: new Date(digestType === "weekly" ? "2026-11-09T00:00:00Z" : "2026-11-01T00:00:00Z"),
    status: "draft", introText,
    includedPostIds: [],
    statsSnapshot: { bookingsThisWeek: 8, totalCommissionClaimed: 2100, reimbursementsCount: 2 },
    bookingHighlightsOverride: null,
    includeBookingHighlights: false,
  };
}
async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
}
async function render() {
  await act(async () => {
    root.render(React.createElement(WeeklyDigestAdmin));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  await flush();
}
function button(text: string, scope: ParentNode = document.body) {
  const control = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item =>
    item.textContent?.trim() === text
  );
  expect(control, `rendered button '${text}'`).toBeTruthy();
  return control!;
}
async function click(text: string, scope: ParentNode = document.body) {
  await act(async () => button(text, scope).click());
  await flush();
}
function richField() {
  const element = container.querySelector<HTMLElement>('.ProseMirror[aria-label="Personal intro message"]');
  expect(element, "actual accessible TipTap intro editor").toBeTruthy();
  expect(element!.getAttribute("contenteditable")).toBe("true");
  return element!;
}
function actualEditor(element = richField()): Editor {
  // TipTap's DOM-attached Editor is used only to arrange selection/clearing;
  // formatting changes and clipboard insertion go through real DOM controls.
  const editor = (element as HTMLElement & { editor?: Editor }).editor;
  expect(editor, "actual TipTap Editor attached to DOM").toBeTruthy();
  return editor!;
}
async function paste(html: string, text = "") {
  const element = richField();
  const clipboardData = new DataTransfer();
  if (html) clipboardData.setData("text/html", html);
  if (text) clipboardData.setData("text/plain", text);
  await act(async () => {
    actualEditor(element).commands.selectAll();
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await flush();
}
async function changeInput(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}
function dialog(title: string) {
  const element = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].find(item =>
    [...item.querySelectorAll("h2")].some(heading => heading.textContent === title)
  );
  expect(element, `actual '${title}' dialog`).toBeTruthy();
  return element!;
}
async function closeDialog() {
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await flush();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
}
async function previewIntro(content: string) {
  await click("Preview");
  const preview = dialog("Digest Preview");
  const expectedHtml = formatDigestIntro(content, "html");
  const normalised = document.createElement("div");
  normalised.innerHTML = expectedHtml;
  const intro = [...preview.querySelectorAll<HTMLElement>("div")].find(item => item.innerHTML === normalised.innerHTML);
  expect(intro, "preview renders exactly shared safe intro HTML").toBeTruthy();
  expect(intro!.tagName).toBe("DIV");
  expect(intro!.querySelector("p ul, p ol, p h2, p p")).toBeNull();
  return intro!;
}
function assertScreenshotFormatting(element: ParentNode) {
  expect(element.querySelector("h2")?.textContent).toBe("Fictional achievements");
  expect([...element.querySelectorAll("strong")].map(item => item.textContent)).toEqual(
    expect.arrayContaining(["brilliant period", "£1,240", "£860"])
  );
  expect([...element.querySelectorAll("ul li")].map(item => item.textContent)).toEqual([
    "Morgan Vale: £1,240 commission", "Ellis Brook: £860 commission",
  ]);
  expect(element.querySelectorAll("p").length).toBeGreaterThanOrEqual(3);
  expect(element.textContent).not.toContain("**brilliant period**");
  expect(element.textContent).not.toContain("## Fictional achievements");
}
function expectedPayload(content: string, digestId = 801) {
  return {
    digestId,
    origin: window.location.origin,
    customSubject: undefined,
    customIntro: content,
    customIntroFormat: "html",
  };
}
async function sendTest() {
  await click("Send Test Email");
  const scope = dialog("Send Test Email");
  const input = scope.querySelector<HTMLInputElement>('input[type="email"]');
  expect(input).toBeTruthy();
  await changeInput(input!, "reviewer@example.test");
  await click("Send Test", scope);
}
async function sendLive(digestType: "weekly" | "monthly" = "weekly") {
  await click("Send to All Agents");
  await click("Yes, Send Now", dialog(`Send ${digestType === "weekly" ? "Weekly Update" : "Monthly Review"}?`));
}
async function toolbar(title: string) {
  const element = richField();
  const scope = element.parentElement?.parentElement ?? container;
  const control = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item =>
    item.title === title || item.getAttribute("aria-label") === title
  );
  expect(control, `actual toolbar '${title}'`).toBeTruthy();
  expect(control!.type).toBe("button");
  await act(async () => control!.click());
  await flush();
}
function assertNoSideEffects() {
  expect(mock.hooks.every(path => path.startsWith("community.digest."))).toBe(true);
  expect(mock.mutations.every(mutation => mutation.path === "community.digest.send")).toBe(true);
  expect(JSON.stringify(mock.digests)).toBe(initialDigests);
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector("iframe")).toBeNull();
}

beforeEach(() => {
  (globalThis as any).React = React; // Existing Vitest classic-JSX transform.
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  const settings = (window as any).happyDOM.settings;
  previousSettings = {
    disableIframePageLoading: settings.disableIframePageLoading,
    disableCSSFileLoading: settings.disableCSSFileLoading,
    disableJavaScriptFileLoading: settings.disableJavaScriptFileLoading,
    enableFileSystemHttpRequests: settings.enableFileSystemHttpRequests,
  };
  settings.disableIframePageLoading = true;
  settings.disableCSSFileLoading = true;
  settings.disableJavaScriptFileLoading = true;
  settings.enableFileSystemHttpRequests = false;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in synthetic digest UI tests"); }));
  const rect = () => new DOMRect(0, 0, 800, 20);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rect);
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [rect()] as any);
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: rect });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [rect()] });
  mock.digests = [syntheticDraft("weekly"), syntheticDraft("monthly", "Monthly **existing draft**.\n\n- Monthly item")];
  initialDigests = JSON.stringify(mock.digests);
  mock.hooks = [];
  mock.mutations = [];
  mock.refetch.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  assertNoSideEffects();
  await act(async () => root.unmount());
  container.remove();
  Object.assign((window as any).happyDOM.settings, previousSettings);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("weekly/monthly digest formatting on the actual admin DOM", () => {
  it("loads an existing draft as Markdown without changing or saving it on mount/rerender", async () => {
    await render();
    const content = richField();
    expect(content.querySelector("strong")?.textContent).toBe("existing draft");
    expect(content.querySelector("h2")?.textContent).toBe("Old heading");
    expect(content.querySelectorAll("ul li")).toHaveLength(1);
    expect(container.querySelector('textarea[aria-label="Personal intro message"]')).toBeNull();
    const initialHtml = actualEditor(content).getHTML();
    // TipTap normalizes list-item paragraphs and trailing empty paragraphs.
    // Mounting must not emit these normalizations back into the parent draft.
    const untouchedDraftHtml = digestTextToEditorHtml(oldIntro);
    await render();
    expect(actualEditor().getHTML()).toBe(initialHtml);
    expect(mock.mutations).toEqual([]);
    expect(mock.refetch).not.toHaveBeenCalled();
    await previewIntro(untouchedDraftHtml);
    expect(mock.mutations).toEqual([]);
    await closeDialog();
    await sendTest();
    expect(mock.mutations).toEqual([{
      path: "community.digest.send",
      input: { ...expectedPayload(untouchedDraftHtml), testToEmail: "reviewer@example.test" },
    }]);
  });

  it.each(["plain Markdown", "rich HTML", "rich HTML with plain-text bullets"])("pastes screenshot-like %s paragraphs, bold heading/list amounts and uses the same HTML in preview/test/live payloads", async source => {
    await render();
    if (source === "plain Markdown") await paste("", clipboardMarkdown);
    else if (source === "rich HTML with plain-text bullets") await paste(clipboardHtml, "Hello synthetic team,\n\nThank you for a brilliant period and thoughtful work.\n\nFictional achievements\n\n• Morgan Vale: £1,240 commission\n• Ellis Brook: £860 commission\n\nKeep the momentum going.");
    else await paste(clipboardHtml, "Hello synthetic team,\nThank you for a brilliant period and thoughtful work.\nFictional achievements\nMorgan Vale: £1,240 commission\nEllis Brook: £860 commission\nKeep the momentum going.");
    assertScreenshotFormatting(richField());
    expect(mock.mutations).toEqual([]);
    const html = sanitizeDigestEditorHtml(actualEditor().getHTML());
    assertScreenshotFormatting(await previewIntro(html));
    await closeDialog();
    await sendTest();
    expect(mock.mutations).toEqual([{
      path: "community.digest.send",
      input: { ...expectedPayload(html), testToEmail: "reviewer@example.test" },
    }]);
    await sendLive();
    expect(mock.mutations[1]).toEqual({ path: "community.digest.send", input: expectedPayload(html) });
    expect(formatDigestIntro(mock.mutations[0].input.customIntro, mock.mutations[0].input.customIntroFormat))
      .toBe(formatDigestIntro(mock.mutations[1].input.customIntro, mock.mutations[1].input.customIntroFormat));
  });

  it("interprets explicit Markdown when copied HTML wrappers still contain raw markers", async () => {
    await render();
    await paste(
      "<p>Hello synthetic team,</p><p>Thank you for a **brilliant period** and thoughtful work.</p>" +
      "<p>## Fictional achievements</p><p>- Morgan Vale: **£1,240** commission</p>" +
      "<p>- Ellis Brook: **£860** commission</p><p>Keep the momentum going.</p>",
      clipboardMarkdown
    );
    assertScreenshotFormatting(richField());
    const html = sanitizeDigestEditorHtml(actualEditor().getHTML());
    assertScreenshotFormatting(await previewIntro(html));
    expect(mock.mutations).toEqual([]);
  });

  it("prefers and sanitizes rich clipboard HTML without activating pasted code or remote content", async () => {
    await render();
    const unsafe = clipboardHtml +
      '<p onclick="alert(1)">Safe literal &lt;script&gt; text.</p>' +
      '<script>DROP_THIS_SCRIPT</script><iframe src="https://external.example.test"></iframe>' +
      '<img src="https://external.example.test/tracker" onerror="alert(1)">' +
      '<p><a href="javascript:alert(1)">Unsafe link label</a></p>';
    await paste(unsafe, "PLAIN CLIPBOARD FALLBACK MUST NOT WIN");
    assertScreenshotFormatting(richField());
    expect(richField().querySelector("script, iframe, img, [onclick], [onerror], [href^='javascript:']")).toBeNull();
    expect(richField().textContent).not.toContain("DROP_THIS_SCRIPT");
    expect(richField().textContent).not.toContain("PLAIN CLIPBOARD FALLBACK MUST NOT WIN");
    expect(richField().textContent).toContain("Safe literal <script> text.");
    const html = sanitizeDigestEditorHtml(actualEditor().getHTML());
    const preview = await previewIntro(html);
    expect(preview.querySelector("script, iframe, img, [onclick], [onerror]")).toBeNull();
    await closeDialog();
    await sendTest();
    expect(mock.mutations[0].input.customIntro).toBe(html);
  });

  it("retains Markdown inline code and escaped literal markers rather than applying unintended bold/emphasis", async () => {
    await render();
    await paste("", "Keep `**literal code**` and \\*literal marker\\* visible.\n\nUse **actual bold** only here.");
    // The digest editor intentionally has no code toolbar/mark. Its clipboard
    // parser must nevertheless retain the protected literal wording unchanged.
    expect(richField().textContent).toContain("**literal code**");
    expect(richField().textContent).toContain("*literal marker*");
    expect([...richField().querySelectorAll("strong")].map(item => item.textContent)).toEqual(["actual bold"]);
    expect(richField().querySelector("em")).toBeNull();
    const html = sanitizeDigestEditorHtml(actualEditor().getHTML());
    const preview = await previewIntro(html);
    expect(preview.textContent).toContain("**literal code**");
    await closeDialog();
    await sendTest();
    expect(mock.mutations[0].input.customIntro).toBe(html);
  });

  it("applies real toolbar edits without submitting and preserves them in preview and send", async () => {
    await render();
    await paste("", "Toolbar sample amount £480.");
    await act(async () => actualEditor().commands.setTextSelection({ from: 1, to: 15 }));
    await toolbar("Bold");
    await toolbar("Italic");
    expect(richField().querySelector("strong")?.textContent).toBe("Toolbar sample");
    expect(richField().querySelector("em")?.textContent).toBe("Toolbar sample");
    await toolbar("Bullet list");
    expect(richField().querySelectorAll("ul li")).toHaveLength(1);
    const beforeUndo = actualEditor().getHTML();
    await toolbar("Undo");
    expect(actualEditor().getHTML()).not.toBe(beforeUndo);
    await toolbar("Redo");
    expect(actualEditor().getHTML()).toBe(beforeUndo);
    for (const control of container.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')) {
      expect(control.type, control.title).toBe("button");
    }
    expect(mock.mutations).toEqual([]);
    const html = sanitizeDigestEditorHtml(actualEditor().getHTML());
    expect((await previewIntro(html)).querySelector("strong")?.textContent).toBe("Toolbar sample");
    await closeDialog();
    await sendLive();
    expect(mock.mutations).toEqual([{ path: "community.digest.send", input: expectedPayload(html) }]);
  });

  it("intentionally clearing the editor sends an explicit empty HTML override in test and live modes", async () => {
    await render();
    expect(richField().textContent).toContain("existing draft");
    await act(async () => actualEditor().commands.clearContent());
    await flush();
    expect(richField().textContent).toBe("");
    expect(mock.mutations).toEqual([]);
    await click("Preview");
    const preview = dialog("Digest Preview");
    expect(preview.textContent).not.toContain("existing draft");
    expect(preview.textContent).not.toContain("Old heading");
    await closeDialog();
    await sendTest();
    expect(mock.mutations[0]).toEqual({
      path: "community.digest.send",
      input: { ...expectedPayload(""), testToEmail: "reviewer@example.test" },
    });
    await sendLive();
    expect(mock.mutations[1]).toEqual({ path: "community.digest.send", input: expectedPayload("") });
  });

  it("switches to the monthly legacy intro without leaking the weekly edit and sends the monthly HTML payload", async () => {
    await render();
    await paste("", "Unsaved weekly **only** intro.");
    await click("Monthly Review", container);
    expect(richField().textContent).toContain("Monthly existing draft.");
    expect(richField().querySelector("strong")?.textContent).toBe("existing draft");
    expect(richField().textContent).not.toContain("Unsaved weekly");
    expect(mock.mutations).toEqual([]);
    const html = digestTextToEditorHtml(mock.digests[1].introText);
    await previewIntro(html);
    await closeDialog();
    await sendTest();
    expect(mock.mutations[0]).toEqual({
      path: "community.digest.send",
      input: { ...expectedPayload(html, 802), testToEmail: "reviewer@example.test" },
    });
    await sendLive("monthly");
    expect(mock.mutations[1]).toEqual({ path: "community.digest.send", input: expectedPayload(html, 802) });
  });
});
