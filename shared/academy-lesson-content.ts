function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function visibleText(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
}

function asListItem(value: string) {
  const match = visibleText(value).match(/^\s*(?:[-*•‣▪]|\d+[.)])\s+(.+)$/);
  if (!match) return null;
  // Preserve any pre-existing safe inline formatting after the list marker.
  return value.replace(/^\s*(?:[-*•‣▪]|\d+[.)])\s+/, "").trim();
}

function looksLikeHeading(value: string) {
  const text = visibleText(value);
  if (text.length > 76 || /[.!?:;]$/.test(text)) return false;
  const words = text.replace(/[’']/g, "").split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 10 && words.every((word) =>
    /^(?:[A-Z][A-Za-z’'-]*|[A-Z]{2,}|&|and|or|the|to|of|for|in|on|with|a|an|at|by|from)$/.test(word),
  );
}

function hasHtmlMarkup(value: string) {
  return /<\/?[a-z][\w-]*(?:\s[^>]*)?>/i.test(value);
}

function hasStructuredHtml(value: string) {
  return /<\/?(?:ul|ol|li|table|thead|tbody|tr|th|td|blockquote|pre|code|img|iframe|video|details|summary)\b/i.test(value);
}

function legacyLines(source: string) {
  // Older lessons were sometimes saved as rich-editor paragraph/line-break
  // markup but without real list tags. Treat those as copyable legacy text so
  // a "What you'll learn" paragraph followed by short lines becomes a list.
  if (!hasHtmlMarkup(source) || hasStructuredHtml(source)) return source;
  return source
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6])>\s*/gi, "\n")
    .replace(/<(?:p|div|h[1-6])(?:\s[^>]*)?>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}

function renderInline(value: string, preserveInlineMarkup: boolean) {
  // Lesson content is sanitised when saved. Retaining its existing inline
  // markup preserves author emphasis while this compatibility layer supplies
  // missing semantic blocks for legacy records.
  return preserveInlineMarkup ? value.trim() : escapeHtml(value.trim());
}

/**
 * Older Academy lessons were saved as raw plain text or as simple rich-editor
 * paragraph markup. Render those records as safe semantic HTML without
 * changing the stored source. Modern rich text containing proper structural
 * elements (lists, tables, media, etc.) is passed through unchanged because
 * it is sanitised on save.
 */
export function normaliseAcademyLessonContent(content: string | null | undefined) {
  const source = content?.replace(/\r/g, "").trim() ?? "";
  if (!source || hasStructuredHtml(source)) return source;

  const preserveInlineMarkup = hasHtmlMarkup(source);
  const lines = legacyLines(source).split("\n").map((line) => line.trim());
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;

    const item = asListItem(line);
    if (item) {
      const items = [item];
      const ordered = /^\s*\d+[.)]\s+/.test(visibleText(line));
      while (index + 1 < lines.length) {
        const next = asListItem(lines[index + 1]);
        if (!next) break;
        items.push(next);
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.map((entry) => `<li>${renderInline(entry, preserveInlineMarkup)}</li>`).join("")}</${tag}>`);
      continue;
    }

    const text = visibleText(line);
    if (text.endsWith(":")) {
      const items: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && lines[cursor] && !looksLikeHeading(lines[cursor]) && visibleText(lines[cursor]).length <= 110) {
        items.push(asListItem(lines[cursor]) ?? lines[cursor]);
        cursor += 1;
      }
      blocks.push(`<p><strong>${renderInline(line, preserveInlineMarkup)}</strong></p>`);
      if (items.length >= 2) {
        blocks.push(`<ul>${items.map((entry) => `<li>${renderInline(entry, preserveInlineMarkup)}</li>`).join("")}</ul>`);
        index = cursor - 1;
      }
      continue;
    }

    if (looksLikeHeading(line)) {
      blocks.push(`<h2>${renderInline(line, preserveInlineMarkup)}</h2>`);
      continue;
    }

    // A source newline in a legacy record is deliberate. Keeping each line as
    // a paragraph makes existing lessons readable without rewriting their data.
    blocks.push(`<p>${renderInline(line, preserveInlineMarkup)}</p>`);
  }

  return blocks.join("");
}
