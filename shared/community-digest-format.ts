import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

export type DigestIntroFormat = "markdown" | "html";

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: false,
  typographer: false,
}).disable("table");

// Parse image syntax only to keep its readable label: never emit an image or
// its source URL (disabling the image rule would instead turn it into a link).
markdown.renderer.rules.image = (tokens, index, options, env, renderer) =>
  markdown.utils.escapeHtml(
    renderer.renderInlineAsText(tokens[index].children ?? [], options, env)
  );

// These values are owned by the formatter, never copied from input HTML.
const emailStyles: Record<string, string> = {
  p: "margin:0 0 12px;line-height:1.6;",
  h1: "margin:0 0 12px;font-size:26px;line-height:1.3;font-weight:700;",
  h2: "margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;",
  h3: "margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:700;",
  h4: "margin:0 0 12px;font-size:18px;line-height:1.3;font-weight:700;",
  h5: "margin:0 0 12px;font-size:16px;line-height:1.3;font-weight:700;",
  h6: "margin:0 0 12px;font-size:14px;line-height:1.3;font-weight:700;",
  blockquote:
    "margin:0 0 12px;padding-left:16px;border-left:3px solid #d1d5db;",
  ul: "margin:0 0 12px;padding-left:24px;",
  ol: "margin:0 0 12px;padding-left:24px;",
  li: "margin:0 0 4px;line-height:1.6;",
  a: "color:#2563eb;text-decoration:underline;",
  hr: "margin:16px 0;border:0;border-top:1px solid #d1d5db;",
  code: "font-family:monospace;",
  pre: "margin:0 0 12px;white-space:pre-wrap;font-family:monospace;",
};

const allowedTags = [
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "u",
  "s",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "hr",
  "code",
  "pre",
];

const tagAliases = new Map([
  ["b", "strong"],
  ["i", "em"],
  ["del", "s"],
  ["strike", "s"],
]);

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  // Require an explicit scheme, not a relative URL, //host, or a URL whose
  // controls/backslashes could be interpreted differently by an email client.
  if (
    !/^(?:https?:\/\/|mailto:)/i.test(href) ||
    /[\u0000-\u0020\u007f-\u009f\\]/.test(href)
  ) {
    return undefined;
  }
  try {
    const url = new URL(href);
    if (url.protocol === "mailto:") return url.pathname ? href : undefined;
    return url.hostname && ["http:", "https:"].includes(url.protocol)
      ? href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Accept the small semantic subset used by the digest editor. Active/media
 * elements and their contents are removed; other unsupported wrappers are
 * unwrapped. Tables are deliberately unsupported in both input formats.
 */
export function sanitizeDigestEditorHtml(html: string): string {
  if (!html.trim()) return "";
  let hasVisibleText = false;
  const clean = sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      "*": ["style"],
      a: ["href", "style"],
      ol: ["start", "style"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    // Avoid PostCSS's Node-only style parsing in the shared browser bundle.
    // The transform replaces every attribute, including style, beforehand.
    parseStyleAttributes: false,
    nestingLimit: 100,
    nonTextTags: [
      "script",
      "style",
      "textarea",
      "option",
      "svg",
      "math",
      "form",
      "iframe",
      "img",
      "object",
      "embed",
      "video",
      "audio",
      "picture",
      "canvas",
      "template",
      "noscript",
      "input",
      "button",
      "select",
    ],
    transformTags: {
      "*": (tagName, attributes) => {
        const tag = tagAliases.get(tagName) ?? tagName;
        const attribs: Record<string, string> = {};
        if (allowedTags.includes(tag) && emailStyles[tag])
          attribs.style = emailStyles[tag];
        if (tag === "a") {
          const href = safeHref(attributes.href);
          if (href) attribs.href = href;
        }
        if (tag === "ol" && /^\d{1,9}$/.test(attributes.start ?? "")) {
          attribs.start = attributes.start;
        }
        return { tagName: tag, attribs };
      },
    },
    textFilter: text => {
      // A break, rule, empty list or editor's nonbreaking-space placeholder
      // must not produce an otherwise empty email card.
      if (text.replace(/[\s\u200b-\u200d\ufeff]/g, "")) hasVisibleText = true;
      return text;
    },
  }).trim();
  return hasVisibleText ? clean : "";
}

/** Normalize common pasted bullet glyphs, without rewriting fenced/indented code. */
function normalizeUnicodeBullets(text: string): string {
  let fence: { marker: string; length: number } | undefined;
  return text
    .replace(/\r\n?|\n/g, "\n")
    .split("\n")
    .map(line => {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence.marker &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        ) {
          fence = undefined;
        }
        return line;
      }
      if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
        fence = { marker: marker[1][0], length: marker[1].length };
        return line;
      }
      return line.replace(/^( {0,3})[•●▪◦‣⁃][ \t]+/, "$1- ");
    })
    .join("\n");
}

/** No format detection: HTML is interpreted only when explicitly requested. */
export function formatDigestIntro(
  content: string | null | undefined,
  format: DigestIntroFormat = "markdown"
): string {
  if (!content?.trim()) return "";
  return sanitizeDigestEditorHtml(
    format === "html"
      ? content
      : markdown.render(normalizeUnicodeBullets(content))
  );
}

/** Safely migrate legacy Markdown/plain text into the rich-text editor. */
export function digestTextToEditorHtml(text: string): string {
  return formatDigestIntro(text, "markdown");
}
