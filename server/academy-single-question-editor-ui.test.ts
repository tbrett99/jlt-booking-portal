// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademyQuestionRichTextEditor } from "../client/src/components/AcademyQuestionRichTextEditor";
import {
  formatAcademyQuestionPrompt,
  splitAcademyQuestionInlineFormatting,
} from "../shared/academy-question-format";
import {
  academyQuestionHtmlToText,
  academyQuestionTextToHtml,
} from "../shared/academy-question-rich-text";

const legacyQuestion = [
  "# Client scenario",
  "",
  "Use **key evidence** and *explain why*.",
  "Keep this line with the paragraph.",
  "",
  "A separate paragraph.",
  "",
  "- Identify the risk",
  "- Explain the next step",
  "",
  "1. Check the booking",
  "2. Record your decision",
].join("\n");

let root: Root;
let container: HTMLDivElement;
let onChange: ReturnType<typeof vi.fn>;
let network: ReturnType<typeof vi.fn>;
let previousSettings: Record<string, boolean>;
let rangeRect: PropertyDescriptor | undefined;
let rangeRects: PropertyDescriptor | undefined;

async function render(value = legacyQuestion, disabled = false) {
  await act(async () => {
    root.render(
      React.createElement(AcademyQuestionRichTextEditor, {
        value,
        onChange,
        disabled,
        placeholder: "Write a question",
        label: "Question prompt",
      })
    );
  });
}

function editableBox() {
  const boxes = container.querySelectorAll<HTMLElement>(".ProseMirror");
  expect(boxes).toHaveLength(1);
  return boxes[0]!;
}

function editor() {
  // TipTap attaches its actual Editor instance to its DOM element. No editor,
  // serializer, toolbar or EditorContent implementation is mocked in this suite.
  return (editableBox() as HTMLElement & { editor: Editor }).editor;
}

async function toolbar(title: string) {
  const control = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${title}"]`
  );
  expect(control).toBeTruthy();
  expect(control!.type).toBe("button");
  await act(async () => control!.click());
}

async function selectText(text: string) {
  let from = -1;
  editor().state.doc.descendants((node, position) => {
    if (!node.isText || from >= 0) return;
    const index = node.text!.indexOf(text);
    if (index >= 0) from = position + index;
  });
  expect(from, `actual editor selection for '${text}'`).toBeGreaterThanOrEqual(0);
  await act(async () => {
    editor().commands.setTextSelection({ from, to: from + text.length });
  });
}

async function paste(text: string, html = "") {
  const transfer = new DataTransfer();
  transfer.setData("text/plain", text);
  if (html) transfer.setData("text/html", html);
  const event = new ClipboardEvent("paste", {
    clipboardData: transfer,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    editableBox().dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
}

function storedValue() {
  expect(onChange).toHaveBeenCalled();
  const value = onChange.mock.calls.at(-1)![0] as string;
  expect(value).toBe(academyQuestionHtmlToText(editor().getHTML()));
  return value;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  network = vi.fn(() => {
    throw new Error("Network is forbidden in offline question editor tests");
  });
  vi.stubGlobal("fetch", network);
  const settings = (window as any).happyDOM.settings;
  previousSettings = {
    disableIframePageLoading: settings.disableIframePageLoading,
    enableFileSystemHttpRequests: settings.enableFileSystemHttpRequests,
    disableCSSFileLoading: settings.disableCSSFileLoading,
  };
  settings.disableIframePageLoading = true;
  settings.enableFileSystemHttpRequests = false;
  settings.disableCSSFileLoading = true;
  // Real focus/selection commands ask for layout, which happy-dom does not supply.
  const rect = () => new DOMRect(0, 0, 800, 20);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rect);
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(
    () => [rect()] as any
  );
  rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
  rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: rect,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [rect()],
  });
  onChange = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Object.assign((window as any).happyDOM.settings, previousSettings);
  if (rangeRect) Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeRect);
  else delete (Range.prototype as any).getBoundingClientRect;
  if (rangeRects) Object.defineProperty(Range.prototype, "getClientRects", rangeRects);
  else delete (Range.prototype as any).getClientRects;
  expect(network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Academy single-box question rich editor", () => {
  it("opens legacy formatted text as one directly editable box without raw Markdown markers", async () => {
    await render();
    const box = editableBox();
    expect(box.getAttribute("contenteditable")).toBe("true");
    expect(box.getAttribute("aria-label")).toBe("Question prompt");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelectorAll('[role="toolbar"]')).toHaveLength(1);
    expect(container.textContent).toContain(
      "Edit directly in this box — formatting appears as you type."
    );
    expect(container.textContent).toContain("Paste from Word, Google Docs or ChatGPT");
    expect(Array.from(box.children, child => child.tagName)).toEqual([
      "H2", "P", "P", "UL", "OL",
    ]);
    expect(box.querySelector("h2")?.textContent).toBe("Client scenario");
    expect(box.querySelector("strong")?.textContent).toBe("key evidence");
    expect(box.querySelector("em")?.textContent).toBe("explain why");
    expect(box.querySelectorAll("ul > li")).toHaveLength(2);
    expect(box.querySelectorAll("ol > li")).toHaveLength(2);
    expect(box.querySelectorAll(":scope > p")).toHaveLength(2);
    expect(box.querySelectorAll(":scope > p > br")).toHaveLength(1);
    expect(box.textContent).not.toMatch(/#{1,3}\s|\*|^\s*-\s|\b[12]\.\s/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("scopes renderer-matching typography, list markers and block gaps to the actual editable DOM", async () => {
    await render();
    // happy-dom is not a browser layout engine. Assert the utilities on the real
    // ProseMirror element rather than assuming UA list/heading styles or reading JSX.
    const expected = [
      "text-sm", "leading-6", "min-h-[180px]",
      "[&>*+*]:mt-3", "[&_h2]:text-sm", "[&_h2]:font-semibold",
      "[&_ul]:list-disc", "[&_ul]:pl-5", "[&_ol]:list-decimal", "[&_ol]:pl-5",
      "[&_li+li]:mt-1", "[&_strong]:font-bold", "[&_em]:italic",
    ];
    const box = editableBox();
    for (const utility of expected) expect(box.classList.contains(utility), utility).toBe(true);
    expect(box.className).not.toContain("[&_p]:");
    expect(box.className).not.toContain("[&_br]:");
    const toolbarElement = container.querySelector('[role="toolbar"]')!;
    const helper = box.closest(".border")!.lastElementChild!;
    for (const utility of expected.filter(item => item.startsWith("[&"))) {
      expect(toolbarElement.classList.contains(utility)).toBe(false);
      expect(helper.classList.contains(utility)).toBe(false);
    }
  });

  it("does not emit or normalize on mount, disabled transitions or external value synchronization", async () => {
    await render();
    const initialHtml = editor().getHTML();
    await render(legacyQuestion, true);
    expect(editor().isEditable).toBe(false);
    expect(editableBox().getAttribute("contenteditable")).toBe("false");
    expect(editor().getHTML()).toBe(initialHtml);
    for (const button of container.querySelectorAll("button")) expect(button.disabled).toBe(true);
    await toolbar("Bold");
    expect(editor().getHTML()).toBe(initialHtml);
    expect(onChange).not.toHaveBeenCalled();
    const external = "## Updated server question\n\nKeep **server evidence** unchanged.";
    await render(external, true);
    expect(editableBox().querySelector("strong")?.textContent).toBe("server evidence");
    await render(external, false);
    expect(editor().isEditable).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { editor().commands.insertContent("A deliberate edit "); });
    expect(storedValue()).toContain("A deliberate edit");
  });

  it("round-trips real toolbar heading, bold, italic, bullet and numbered-list edits through existing text storage and the learner formatter", async () => {
    await render("Scenario\n\nUse evidence and explain.\n\nRisk\n\nStep");
    expect(onChange).not.toHaveBeenCalled();
    await selectText("Scenario");
    await toolbar("Heading");
    await selectText("evidence");
    await toolbar("Bold");
    await selectText("explain");
    await toolbar("Italic");
    await selectText("Risk");
    await toolbar("Bullet list");
    await selectText("Step");
    await toolbar("Numbered list");
    const stored = storedValue();
    expect(stored).toBe("## Scenario\n\nUse **evidence** and *explain*.\n\n- Risk\n\n1. Step");
    expect(stored).not.toMatch(/<\/?(?:p|h2|strong|em|ul|ol|li)\b/);
    expect(formatAcademyQuestionPrompt(stored)).toEqual([
      { type: "heading", text: "Scenario" },
      { type: "paragraph", text: "Use **evidence** and *explain*." },
      { type: "bullet_list", items: ["Risk"] },
      { type: "numbered_list", items: ["Step"] },
    ]);
    expect(splitAcademyQuestionInlineFormatting("Use **evidence** and *explain*.")).toEqual([
      { text: "Use ", bold: false, italic: false },
      { text: "evidence", bold: true, italic: false },
      { text: " and ", bold: false, italic: false },
      { text: "explain", bold: false, italic: true },
      { text: ".", bold: false, italic: false },
    ]);
    const changes = onChange.mock.calls.length;
    await render(stored);
    expect(onChange).toHaveBeenCalledTimes(changes);
    expect(editableBox().querySelector("h2")?.textContent).toBe("Scenario");
    expect(editableBox().querySelector("strong")?.textContent).toBe("evidence");
    expect(editableBox().querySelector("em")?.textContent).toBe("explain");
    expect(editableBox().querySelector("ul li")?.textContent).toBe("Risk");
    expect(editableBox().querySelector("ol li")?.textContent).toBe("Step");
  });

  it("preserves plain-text paste line breaks and paragraphs while treating pasted markup as literal text", async () => {
    await render("");
    await paste("Tell us:\nWho is travelling?\nWhat are their ages?\n\nExplain **why**.");
    expect(editableBox().querySelectorAll(":scope > p")).toHaveLength(2);
    expect(editableBox().querySelectorAll("br")).toHaveLength(2);
    expect(editableBox().querySelector("strong")?.textContent).toBe("why");
    expect(storedValue()).toBe("Tell us:\nWho is travelling?\nWhat are their ages?\n\nExplain **why**.");
    // This harness does not feed onChange back as a controlled value. Change the
    // external prop before clearing, rather than re-rendering the same empty prop.
    await render("External reset");
    await render("");
    const literal = '<img src="https://clipboard.example.test/tracker" onerror="alert(1)">';
    await paste(literal);
    expect(editableBox().textContent).toBe(literal);
    expect(editableBox().querySelector("img, iframe, script, [onerror], [src]")).toBeNull();
    expect(storedValue()).toBe(literal);
  });

  it("retains supported HTML paste formatting and persists text rather than arbitrary clipboard HTML or remote references", async () => {
    await render("");
    await paste("Clipboard scenario\nUse evidence and explain.\nRisk\nStep", [
      "<h2>Clipboard scenario</h2>",
      '<p style="color:red" onclick="alert(1)">Use <strong>evidence</strong> and <em>explain</em>.</p>',
      "<ul><li>Risk</li></ul><ol><li>Step</li></ol>",
      '<img src="https://clipboard.example.test/tracker" onerror="alert(1)">',
      '<iframe src="https://clipboard.example.test/frame"></iframe>',
      "<script>alert(1)</script>",
    ].join(""));
    const box = editableBox();
    expect(box.querySelector("h2")?.textContent).toBe("Clipboard scenario");
    expect(box.querySelector("strong")?.textContent).toBe("evidence");
    expect(box.querySelector("em")?.textContent).toBe("explain");
    expect(box.querySelector("ul li")?.textContent).toBe("Risk");
    expect(box.querySelector("ol li")?.textContent).toBe("Step");
    expect(box.querySelector("img, iframe, script, [src], [onclick], [onerror], [style]")).toBeNull();
    const stored = storedValue();
    expect(stored).toBe("## Clipboard scenario\n\nUse **evidence** and *explain*.\n\n- Risk\n\n1. Step");
    expect(stored).not.toMatch(/clipboard\.example|<|alert\(1\)/);
    // Re-open via the same legacy converter, not a new HTML persistence path.
    await render("Different external value");
    const changes = onChange.mock.calls.length;
    await render(stored);
    expect(onChange).toHaveBeenCalledTimes(changes);
    expect(editor().getHTML()).toContain(academyQuestionTextToHtml("## Clipboard scenario"));
    expect(editableBox().querySelector("img, iframe, script, [src], [href]")).toBeNull();
  });
});
