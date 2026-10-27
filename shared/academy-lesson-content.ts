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

function hasHtmlMarkup(value: string) {
  return /<\/?[a-z][\w-]*(?:\s[^>]*)?>/i.test(value);
}

function decodeComparableHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'");
}

/**
 * A stable representation of what a learner can read and open from a lesson.
 * It deliberately ignores purely presentational markup, whitespace and editor
 * wrappers, while retaining text order plus linked resource destinations. It
 * is used only to allow safe visual formatting corrections after a lesson has
 * learner evidence; substantive lesson or link changes remain protected.
 */
export function academyLessonContentFingerprint(content: string | null | undefined) {
  const source = content ?? "";
  const resourceReferences = Array.from(
    source.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi),
    (match) => decodeComparableHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "").trim(),
  ).filter(Boolean);
  const readableLines = decodeComparableHtmlEntities(
    source
      .replace(/\r/g, "")
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote|pre|details|ul|ol)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim().replace(/^(?:[-*•‣▪]|\d+[.)])\s+/, ""))
    .filter(Boolean);
  return `${readableLines.join("\n")}\n@@resources:${resourceReferences.join("\n")}`;
}

function listKind(value: string): "ordered" | "unordered" | null {
  const text = visibleText(value);
  if (/^\s*\d+[.)]\s+/.test(text)) return "ordered";
  if (/^\s*[-*•‣▪]\s+/.test(text)) return "unordered";
  return null;
}

function removeListMarker(value: string) {
  // The marker can sit inside a preserved inline tag, e.g. <strong>• Important</strong>.
  // Remove it after any leading inline wrappers while retaining the formatting.
  return value.replace(
    /^(\s*(?:(?:<\/?(?:strong|b|em|i|u|s|span|a)(?:\s[^>]*)?>)\s*)*)(?:[-*•‣▪]|\d+[.)])\s+/i,
    "$1",
  ).trim();
}

function looksLikeHeading(value: string) {
  const text = visibleText(value);
  if (text.length > 76 || /[.!?:;]$/.test(text)) return false;
  const words = text.replace(/[’']/g, "").split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 10 && words.every((word) =>
    /^(?:[A-Z][A-Za-z’'-]*|[A-Z]{2,}|&|and|or|the|to|of|for|in|on|with|a|an|at|by|from)$/.test(word),
  );
}

/**
 * Keep genuine rich blocks untouched while normalising the plain / legacy runs
 * around them. Existing lessons often have old p/div/br markup mixed with a
 * real list or table; treating the entire document as already formatted makes
 * the legacy parts collapse into one difficult-to-read block.
 */
function protectStructuredBlocks(source: string) {
  const blocks: string[] = [];
  const token = (index: number) => `@@JLT_ACADEMY_BLOCK_${index}@@`;
  const protectedSource = source.replace(
    /<(?:ul|ol|table|blockquote|pre|details)\b[^>]*>[\s\S]*?<\/(?:ul|ol|table|blockquote|pre|details)\s*>|<(?:img|iframe|video)\b[^>]*>(?:\s*<\/(?:iframe|video)\s*>)?/gi,
    (match) => {
      const index = blocks.push(match) - 1;
      return `\n${token(index)}\n`;
    },
  );
  return { protectedSource, blocks, token };
}

function legacyLines(source: string) {
  if (!hasHtmlMarkup(source)) return source;
  return source
    // Word and browser clipboard markup frequently decorates BR tags. Those
    // still mean a deliberate content break.
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6])\s*>\s*/gi, "\n")
    .replace(/<(?:p|div|h[1-6])(?:\s[^>]*)?>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}

function renderInline(value: string, preserveInlineMarkup: boolean) {
  // Lesson content is sanitised when saved. Retaining existing inline markup
  // preserves author emphasis while this compatibility layer supplies missing
  // semantic blocks for legacy records.
  return preserveInlineMarkup ? value.trim() : escapeHtml(value.trim());
}

function normaliseLegacyRun(source: string, preserveInlineMarkup: boolean, isToken: (value: string) => number | null, resolveToken: (index: number) => string) {
  const lines = legacyLines(source).split("\n").map((line) => line.trim());
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;

    const tokenIndex = isToken(line);
    if (tokenIndex !== null) {
      blocks.push(resolveToken(tokenIndex));
      continue;
    }

    const kind = listKind(line);
    if (kind) {
      const items = [removeListMarker(line)];
      while (index + 1 < lines.length && listKind(lines[index + 1]) === kind) {
        items.push(removeListMarker(lines[index + 1]));
        index += 1;
      }
      const tag = kind === "ordered" ? "ol" : "ul";
      blocks.push(`<${tag}>${items.map((entry) => `<li>${renderInline(entry, preserveInlineMarkup)}</li>`).join("")}</${tag}>`);
      continue;
    }

    const text = visibleText(line);
    if (text.endsWith(":")) {
      const items: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        if (!candidate || isToken(candidate) !== null || looksLikeHeading(candidate) || visibleText(candidate).length > 110 || listKind(candidate) !== null) break;
        // A sequence of short, unmarked lines after a label is the common
        // pasted training-document pattern. Require two to avoid inventing a
        // list from an ordinary sentence.
        items.push(candidate);
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
    // a paragraph makes existing lessons readable without altering stored data.
    blocks.push(`<p>${renderInline(line, preserveInlineMarkup)}</p>`);
  }

  return blocks.join("");
}

/**
 * Render old Academy content with reliable paragraphs, lists and headings.
 * Genuine rich blocks (lists, tables, quotations, code and media) remain
 * untouched; only surrounding legacy p/div/br/plain-text fragments are fixed.
 */
export function normaliseAcademyLessonContent(content: string | null | undefined) {
  const source = content?.replace(/\r/g, "").trim() ?? "";
  if (!source) return "";

  const { protectedSource, blocks, token } = protectStructuredBlocks(source);
  const preserveInlineMarkup = hasHtmlMarkup(protectedSource);
  const tokenPattern = /^@@JLT_ACADEMY_BLOCK_(\d+)@@$/;
  return normaliseLegacyRun(
    protectedSource,
    preserveInlineMarkup,
    (value) => {
      const match = value.match(tokenPattern);
      return match ? Number(match[1]) : null;
    },
    (index) => blocks[index] ?? token(index),
  );
}
