// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async importOriginal => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      state.editor = editor;
      return editor;
    },
  };
});
import { AcademyQuestionRichTextEditor } from "../client/src/components/AcademyQuestionRichTextEditor";

let root: Root;
let container: HTMLDivElement;
let onChange: ReturnType<typeof vi.fn>;
async function render(disabled = false, value = "Scenario:\nExplain **why** this matters.") {
  await act(async () => {
    root.render(React.createElement(AcademyQuestionRichTextEditor, {
      value, onChange, disabled, placeholder: "Write a question", label: "Question prompt",
    }));
  });
}
beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.editor = null;
  onChange = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Academy question editor read-only transitions", () => {
  it("never normalises or emits a draft on mount, disable, re-enable or external sync", async () => {
    await render();
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector("strong")?.textContent).toBe("why");
    await render(true);
    expect(state.editor!.isEditable).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    await render(true, "Updated **server** question");
    expect(container.querySelector("strong")?.textContent).toBe("server");
    expect(onChange).not.toHaveBeenCalled();
    await render(false, "Updated **server** question");
    expect(state.editor!.isEditable).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => state.editor!.commands.insertContent("Learner-facing draft"));
    expect(onChange).toHaveBeenCalled();
  });

  it("disables formatting and paste notifications without changing the stored question", async () => {
    await render(true);
    const initialHtml = state.editor!.getHTML();
    for (const button of container.querySelectorAll("button")) {
      expect(button.disabled).toBe(true);
      expect(button.type).toBe("button");
    }
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "Must not paste", files: [] },
    });
    await act(async () => container.querySelector(".ProseMirror")!.dispatchEvent(event));
    expect(state.editor!.getHTML()).toBe(initialHtml);
    expect(onChange).not.toHaveBeenCalled();
  });
});
