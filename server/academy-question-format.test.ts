import { describe, expect, it } from "vitest";
import { formatAcademyQuestionPrompt, splitAcademyQuestionEmphasis, splitAcademyQuestionInlineFormatting } from "../shared/academy-question-format";
import { academyQuestionTextToHtml } from "../shared/academy-question-rich-text";

describe("Academy written-question formatting", () => {
  it("keeps headings, paragraph breaks, bullets and numbered steps separate", () => {
    const blocks = formatAcademyQuestionPrompt([
      "# Client scenario",
      "",
      "Read the case study before answering.",
      "",
      "- Identify the risk",
      "- Explain the next step",
      "",
      "1. Check the booking",
      "2. Record your decision",
    ].join("\n"));

    expect(blocks).toEqual([
      { type: "heading", text: "Client scenario" },
      { type: "paragraph", text: "Read the case study before answering." },
      { type: "bullet_list", items: ["Identify the risk", "Explain the next step"] },
      { type: "numbered_list", items: ["Check the booking", "Record your decision"] },
    ]);
  });

  it("recognises simple bold labels without admitting HTML", () => {
    expect(splitAcademyQuestionEmphasis("Explain **why this matters** to the client.")).toEqual([
      { text: "Explain ", strong: false },
      { text: "why this matters", strong: true },
      { text: " to the client.", strong: false },
    ]);
  });

  it("retains rich-editor bold and italic markers for agent and staff rendering", () => {
    expect(splitAcademyQuestionInlineFormatting("Use **key evidence** and *explain why*.")).toEqual([
      { text: "Use ", bold: false, italic: false },
      { text: "key evidence", bold: true, italic: false },
      { text: " and ", bold: false, italic: false },
      { text: "explain why", bold: false, italic: true },
      { text: ".", bold: false, italic: false },
    ]);
  });

  it("keeps every single pasted line break inside an Academy prompt", () => {
    expect(academyQuestionTextToHtml("Tell us:\nWho is travelling?\nWhat are their ages?")).toBe(
      "<p>Tell us:<br>Who is travelling?<br>What are their ages?</p>",
    );
  });
});
