function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function asListItem(value: string) {
  return value.match(/^\s*(?:[-*•‣▪]|\d+[.)])\s+(.+)$/)?.[1]?.trim() ?? null;
}

function looksLikeHeading(value: string) {
  if (value.length > 76 || /[.!?:;]$/.test(value)) return false;
  const words = value.replace(/[’']/g, "").split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 10 && words.every((word) =>
    /^(?:[A-Z][A-Za-z’'-]*|[A-Z]{2,}|&|and|or|the|to|of|for|in|on|with|a|an|at|by|from)$/.test(word),
  );
}

function hasHtmlMarkup(value: string) {
  return /<\/?[a-z][\w-]*(?:\s[^>]*)?>/i.test(value);
}

/**
 * Older Academy lessons were saved as raw plain text. Render those records as
 * safe semantic HTML without changing the stored source. New rich-text lesson
 * HTML is passed through unchanged because it is sanitised on save.
 */
export function normaliseAcademyLessonContent(content: string | null | undefined) {
  const source = content?.replace(/\r/g, "").trim() ?? "";
  if (!source || hasHtmlMarkup(source)) return source;

  const lines = source.split("\n").map((line) => line.trim());
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;

    const item = asListItem(line);
    if (item) {
      const items = [item];
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      while (index + 1 < lines.length) {
        const next = asListItem(lines[index + 1]);
        if (!next) break;
        items.push(next);
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (line.endsWith(":")) {
      const items: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && lines[cursor] && !looksLikeHeading(lines[cursor]) && lines[cursor].length <= 110) {
        items.push(asListItem(lines[cursor]) ?? lines[cursor]);
        cursor += 1;
      }
      blocks.push(`<p><strong>${escapeHtml(line)}</strong></p>`);
      if (items.length >= 2) {
        blocks.push(`<ul>${items.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`);
        index = cursor - 1;
      }
      continue;
    }

    if (looksLikeHeading(line)) {
      blocks.push(`<h2>${escapeHtml(line)}</h2>`);
      continue;
    }

    // A source newline in a legacy record is deliberate. Keeping each line as
    // a paragraph makes existing lessons readable without rewriting their data.
    blocks.push(`<p>${escapeHtml(line)}</p>`);
  }

  return blocks.join("");
}
