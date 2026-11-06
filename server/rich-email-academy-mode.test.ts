// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadHook: vi.fn(),
  upload: vi.fn(),
  editor: null as Editor | null,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { crm: { emailBranding: { uploadImage: { useMutation: mocks.uploadHook } } } },
}));
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      mocks.editor = editor;
      return editor;
    },
  };
});
import { RichEmailEditor } from "../client/src/components/RichEmailEditor";

type Props = React.ComponentProps<typeof RichEmailEditor>;
let root: Root;
let container: HTMLDivElement;
let onChange: ReturnType<typeof vi.fn>;
let onSubmit: ReturnType<typeof vi.fn>;
async function render(props: Partial<Props> = {}) {
  await act(async () => {
    root.render(React.createElement("form", {
      onSubmit: (event: React.FormEvent) => { event.preventDefault(); onSubmit(); },
    }, React.createElement(RichEmailEditor, {
      value: "<p>Lesson text</p>", onChange, restrictedAcademy: true, ...props,
    })));
  });
}
function toolbarButton(title: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  expect(button, title).not.toBeNull();
  return button!;
}
async function click(title: string) {
  await act(async () => toolbarButton(title).click());
}
function content() {
  return container.querySelector<HTMLElement>(".ProseMirror")!;
}
async function paste(html: string, text = "") {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => type === "text/html" ? html : text, files: [] },
  });
  await act(async () => content().dispatchEvent(event));
}
async function uploadFile() {
  vi.stubGlobal("FileReader", class {
    onload: ((event: unknown) => unknown) | null = null;
    readAsDataURL() { this.onload?.({ target: { result: "data:image/png;base64,c3ludGhldGlj" } }); }
  });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic"], "lesson.png", { type: "image/png" })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).React = React;
  vi.clearAllMocks();
  mocks.editor = null;
  mocks.upload.mockReset().mockResolvedValue({ url: "https://example.test/uploaded.png" });
  mocks.uploadHook.mockImplementation(() => ({ mutateAsync: mocks.upload }));
  onChange = vi.fn();
  onSubmit = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("RichEmailEditor restricted Academy mode", () => {
  it("never instantiates the CRM upload hook and keeps all safe formatting tools", async () => {
    mocks.uploadHook.mockImplementation(() => { throw new Error("Academy must not mount CRM uploads"); });
    await render({ showProspectLinks: true, ariaLabel: "Lesson content" });
    expect(mocks.uploadHook).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    for (const title of ["Bold", "Italic", "Underline", "Strikethrough", "Text Colour", "Font Size", "Heading 1", "Heading 2", "Heading 3", "Bullet List", "Numbered List", "Align Left", "Align Center", "Align Right", "Insert Link", "Insert Divider", "Undo", "Redo"]) toolbarButton(title);
    for (const title of ["Insert Image from URL", "Upload Image from Computer", "Embed Loom Video", "Insert CTA Button", "Insert Personalisation Tag"]) {
      expect(container.querySelector(`button[title="${title}"]`)).toBeNull();
    }
    expect(content().getAttribute("aria-label")).toBe("Lesson content");
    expect(content().getAttribute("aria-multiline")).toBe("true");
    expect(container.querySelector('[role="toolbar"]')?.getAttribute("aria-label")).toBe("Rich text formatting");
    expect(mocks.editor!.isEditable).toBe(true);
  });

  it("preserves saved and pasted tables, formatting and images without CRM access", async () => {
    await render({ value: '<p>Saved</p><table><tbody><tr><td>Saved cell</td></tr></tbody></table><img src="https://example.test/saved.png" />' });
    expect(content().querySelector("td")?.textContent).toBe("Saved cell");
    expect(content().querySelector("img")?.getAttribute("src")).toBe("https://example.test/saved.png");
    await act(async () => mocks.editor!.commands.setTextSelection(mocks.editor!.state.doc.content.size - 1));
    await paste('<h2>Pasted heading</h2><table><tbody><tr><th>Column</th></tr><tr><td><strong>Cell</strong></td></tr></tbody></table><script>alert(1)</script><p onclick="bad()">Safe</p>');
    const html = mocks.editor!.getHTML();
    expect(html).toContain("Pasted heading</h2>");
    expect(html).toContain("<strong>Cell</strong>");
    expect(html).toContain("Column</p></th>");
    expect(html).not.toMatch(/script|onclick|alert\(1\)/);
    expect(mocks.uploadHook).not.toHaveBeenCalled();
  });

  it("starts disabled, tracks disabled changes, suppresses updates and still syncs external content", async () => {
    await render({ disabled: true });
    expect(mocks.editor!.isEditable).toBe(false);
    expect(content().getAttribute("contenteditable")).toBe("false");
    expect(content().getAttribute("aria-label")).toBe("Rich text content");
    expect((container.querySelector('[role="toolbar"]') as HTMLFieldSetElement).disabled).toBe(true);
    onChange.mockClear();
    await act(async () => mocks.editor!.commands.insertContent("Blocked notification"));
    expect(onChange).not.toHaveBeenCalled();
    await render({ disabled: true, value: "<p>Server refresh</p>", ariaLabel: "Updated label" });
    expect(content().textContent).toBe("Server refresh");
    expect(content().getAttribute("aria-label")).toBe("Updated label");
    expect(onChange).not.toHaveBeenCalled();
    await render({ disabled: false, value: "<p>Server refresh</p>" });
    expect(mocks.editor!.isEditable).toBe(true);
    expect(content().getAttribute("contenteditable")).toBe("true");
    await act(async () => mocks.editor!.commands.insertContent("Editable"));
    expect(onChange).toHaveBeenCalled();
    await render({ disabled: true });
    onChange.mockClear();
    await paste("", "Must not paste");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("makes toolbar and dialog actions non-submitting and prevents input Enter submissions", async () => {
    await render();
    await click("Text Colour");
    for (const button of container.querySelectorAll("button")) expect(button.type).toBe("button");
    await click("Insert Link");
    const dialog = container.querySelector('[role="dialog"]')!;
    for (const button of dialog.querySelectorAll("button")) expect(button.type).toBe("button");
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => dialog.querySelector("input")!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    await render({ disabled: true });
    expect((container.querySelector('[role="dialog"]') as HTMLFieldSetElement).disabled).toBe(true);
    for (const control of container.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[role="dialog"] input, [role="dialog"] button')) expect(control.disabled).toBe(true);
  });
});

describe("ordinary email builder compatibility", () => {
  it("defaults to ordinary controls and retains its distinct plain-text paste behavior", async () => {
    await render({ restrictedAcademy: undefined, showProspectLinks: true });
    expect(mocks.uploadHook).toHaveBeenCalled();
    for (const title of ["Insert Image from URL", "Upload Image from Computer", "Embed Loom Video", "Insert CTA Button", "Insert Personalisation Tag"]) toolbarButton(title);
    expect(mocks.editor!.schema.nodes.table).toBeUndefined();
    await paste("", "Marketing Heading\n\nNormal email paragraph.");
    expect(mocks.editor!.getHTML()).not.toContain("<h2>");
    await click("Insert CTA Button");
    expect(container.textContent).toContain("Use secure application link");
    for (const button of container.querySelectorAll("button")) expect(button.type).toBe("button");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => container.querySelector('[role="dialog"] input')!.dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    await render({ restrictedAcademy: undefined, disabled: true, showProspectLinks: true });
    expect((container.querySelector('[role="dialog"]') as HTMLFieldSetElement).disabled).toBe(true);
  });

  it.each([false, true])("retains ordinary upload and base64 fallback (failure: %s)", async (failure) => {
    if (failure) mocks.upload.mockRejectedValue(new Error("Synthetic storage failure"));
    await render({ restrictedAcademy: false });
    await uploadFile();
    expect(mocks.upload).toHaveBeenCalledWith({ fileName: "lesson.png", fileBase64: "c3ludGhldGlj", mimeType: "image/png" });
    expect(content().querySelector("img")?.getAttribute("src")).toBe(failure ? "data:image/png;base64,c3ludGhldGlj" : "https://example.test/uploaded.png");
  });

  it.each(["disabled", "restricted"])("does not insert a late ordinary upload after becoming %s", async (mode) => {
    let resolve!: (result: { url: string }) => void;
    mocks.upload.mockReturnValue(new Promise((done) => { resolve = done; }));
    await render({ restrictedAcademy: false });
    await uploadFile();
    expect(mocks.upload).toHaveBeenCalledOnce();
    await render(mode === "restricted" ? { restrictedAcademy: true } : { restrictedAcademy: false, disabled: true });
    const hookCalls = mocks.uploadHook.mock.calls.length;
    onChange.mockClear();
    await act(async () => resolve({ url: "https://example.test/late.png" }));
    expect(content().querySelector("img")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    if (mode === "restricted") expect(mocks.uploadHook.mock.calls.length).toBe(hookCalls);
  });
});
