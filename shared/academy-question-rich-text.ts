function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function inlineMarkdownToHtml(value: string) {
  return escapeHtml(value)
    .replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>");
}

/**
 * Renders the legacy Markdown-like Academy question format into safe editor HTML.
 * Existing prompts therefore open correctly in the rich editor without migration.
 */
export function academyQuestionTextToHtml(value: string) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    const content = paragraph.map((line) => line.trim()).filter(Boolean).join("<br>").trim();
    if (content) blocks.push(`<p>${content}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push(`<${list.type}>${list.items.map((item) => `<li>${item}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(`<h2>${inlineMarkdownToHtml(heading[1].trim())}</h2>`);
      continue;
    }

    const bullet = line.match(/^(?:[-*•])\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? "ul" : "ol";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(inlineMarkdownToHtml((bullet?.[1] ?? numbered?.[1] ?? "").trim()));
      continue;
    }

    flushList();
    paragraph.push(inlineMarkdownToHtml(rawLine.trimEnd()));
  }

  flushParagraph();
  flushList();
  return blocks.join("") || "<p></p>";
}

function inlineHtmlToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const content = Array.from(element.childNodes).map(inlineHtmlToMarkdown).join("");
  switch (element.tagName.toLowerCase()) {
    case "br": return "\n";
    case "strong":
    case "b": return `**${content}**`;
    case "em":
    case "i": return `*${content}*`;
    default: return content;
  }
}

/**
 * Converts rich editor output back to the safe text representation stored in the
 * existing question columns. This deliberately does not store arbitrary HTML.
 */
export function academyQuestionHtmlToText(html: string) {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const container = document.createElement("div");
  container.innerHTML = html;
  const blocks: string[] = [];

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) blocks.push(text);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const text = inlineHtmlToMarkdown(element).trim();
      if (text) blocks.push(`## ${text}`);
      continue;
    }
    if (tag === "ul") {
      const items = Array.from(element.querySelectorAll(":scope > li"))
        .map((item) => inlineHtmlToMarkdown(item).trim())
        .filter(Boolean);
      if (items.length) blocks.push(items.map((item) => `- ${item}`).join("\n"));
      continue;
    }
    if (tag === "ol") {
      const items = Array.from(element.querySelectorAll(":scope > li"))
        .map((item) => inlineHtmlToMarkdown(item).trim())
        .filter(Boolean);
      if (items.length) blocks.push(items.map((item, index) => `${index + 1}. ${item}`).join("\n"));
      continue;
    }

    const text = inlineHtmlToMarkdown(element).trim();
    if (text) blocks.push(text);
  }

  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
