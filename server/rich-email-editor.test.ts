import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  resolve(process.cwd(), "client/src/components/RichEmailEditor.tsx"),
  "utf8",
);

describe("RichEmailEditor configuration", () => {
  it("does not pass undefined editor props to ordinary email editors", () => {
    expect(editorSource).toContain("...(preserveClipboardFormatting ? {");
    expect(editorSource).toContain("} : {}),");
    expect(editorSource).not.toContain("editorProps: preserveClipboardFormatting ?");
  });

  it("keeps the enhanced clipboard handler scoped to Academy lessons", () => {
    expect(editorSource).toContain("transformPastedHTML: normaliseClipboardHtml");
    expect(editorSource).toContain("insertLessonHtmlIntoView(view, plainTextToLessonHtml(text))");
  });
});
