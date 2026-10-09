export type AcademyQuestionPromptBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet_list"; items: string[] }
  | { type: "numbered_list"; items: string[] };

const headingPattern = /^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/;
const bulletPattern = /^\s*(?:[-*•])\s+(.+)$/;
const numberedPattern = /^\s*\d+[.)]\s+(.+)$/;

/**
 * Turns a staff-authored written-question prompt into safe, structured blocks.
 * It intentionally accepts the Markdown-like text people commonly paste from
 * ChatGPT, Word and email: headings, blank paragraphs, bullets and numbered steps.
 */
export function formatAcademyQuestionPrompt(prompt: string): AcademyQuestionPromptBlock[] {
  const blocks: AcademyQuestionPromptBlock[] = [];
  let paragraph: string[] = [];
  let list: { type: "bullet_list" | "numbered_list"; items: string[] } | null = null;

  const flushParagraph = () => {
    const text = paragraph.map((line) => line.trim()).filter(Boolean).join("\n").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push(list);
    list = null;
  };

  for (const sourceLine of prompt.replace(/\r\n?/g, "\n").split("\n")) {
    const line = sourceLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(headingPattern);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: heading[1].trim() });
      continue;
    }

    const bullet = line.match(bulletPattern);
    const numbered = line.match(numberedPattern);
    if (bullet || numbered) {
      const type = bullet ? "bullet_list" : "numbered_list";
      const item = (bullet?.[1] ?? numbered?.[1] ?? "").trim();
      flushParagraph();
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(item);
      continue;
    }

    flushList();
    paragraph.push(sourceLine.trimEnd());
  }

  flushParagraph();
  flushList();
  return blocks.length ? blocks : [{ type: "paragraph", text: "" }];
}

/** Plain text labels such as **Key point** are rendered in bold by the client. */
export function splitAcademyQuestionEmphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g).filter(Boolean).map((part) => {
    const strong = (part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"));
    return { text: strong ? part.slice(2, -2) : part, strong };
  });
}
