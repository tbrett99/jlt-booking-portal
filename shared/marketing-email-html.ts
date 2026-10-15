const MERGE_TOKEN = String.raw`\{\{(?:first_name|full_name|email|application_link|applicationLink|discovery_call_link|discoveryCallLink)\}\}`;
const MERGE_TOKEN_RE = new RegExp(MERGE_TOKEN, "gi");

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function decodeBasicHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'");
}

function textFromHtml(value: string) {
  return decodeBasicHtml(value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
}

function attributeValue(attributes: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attributes.match(new RegExp(`\\b${escapedName}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? undefined;
}

function styleValue(attributes: string, property: string) {
  const style = attributeValue(attributes, "style") ?? "";
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = style.match(new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]+)`, "i"));
  return match?.[1]?.trim();
}

function safeCssColor(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const normalised = value.trim();
  return /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]{1,80}\)|[a-z]{3,20})$/i.test(normalised)
    ? normalised
    : fallback;
}

function normaliseParagraphMargins(html: string) {
  return html
    .replace(/<p\b([^>]*)>/gi, (_match, attrs) => `<p${attrs} style="${attributeValue(attrs, "style") ?? ""};margin:0 0 18px 0;mso-line-height-rule:exactly;">`)
    .replace(/<h([1-3])\b([^>]*)>/gi, (_match, level, attrs) => {
      const fontSize = level === "1" ? "26px" : level === "2" ? "21px" : "17px";
      return `<h${level}${attrs} style="${attributeValue(attrs, "style") ?? ""};margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:${fontSize};line-height:1.3;color:#414141;">`;
    })
    .replace(/<(ul|ol)\b([^>]*)>/gi, (_match, tag, attrs) => `<${tag}${attrs} style="${attributeValue(attrs, "style") ?? ""};margin:0 0 18px 0;padding-left:24px;">`)
    .replace(/<li\b([^>]*)>/gi, (_match, attrs) => `<li${attrs} style="${attributeValue(attrs, "style") ?? ""};margin:0 0 7px 0;">`);
}

function renderCtaButton(attributes: string, innerHtml: string) {
  const anchor = innerHtml.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
  const anchorAttributes = anchor?.[1] ?? "";
  const dataLabel = attributeValue(attributes, "data-button-label");
  const label = textFromHtml(dataLabel ?? innerHtml) || "Open link";
  const href = attributeValue(anchorAttributes, "href") ?? attributeValue(attributes, "data-button-href") ?? "#";
  const background = safeCssColor(
    styleValue(anchorAttributes, "background-color") ?? styleValue(anchorAttributes, "background") ?? attributeValue(attributes, "data-button-bg"),
    "#02E6D2",
  );
  const textColor = safeCssColor(styleValue(anchorAttributes, "color") ?? attributeValue(attributes, "data-button-text-color"), "#414141");

  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:20px auto;"><tr><td align="center" bgcolor="${background}" style="border-radius:6px;background:${background};"><a href="${href}" data-cta="true" style="display:inline-block;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:700;color:${textColor};text-decoration:none;border-radius:6px;background:${background};">${escapeHtml(label)}</a></td></tr></table>`;
}

/**
 * Converts editor HTML into conservative, email-client-safe markup. The helper
 * also repairs legacy editor artifacts before delivery, so previously saved
 * campaign drafts render correctly without needing to be rewritten manually.
 */
export function normaliseMarketingEmailHtml(html: string) {
  if (!html) return "";

  const withoutVisualMergeTags = html.replace(
    new RegExp(`<span\\b[^>]*>\\s*(${MERGE_TOKEN})\\s*<\\/span>`, "gi"),
    "$1",
  );

  const withReliableButtons = withoutVisualMergeTags.replace(
    /<div\b([^>]*\bdata-button-block(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*)>([\s\S]*?)<\/div>/gi,
    (_match, attributes, innerHtml) => renderCtaButton(attributes, innerHtml),
  );

  return normaliseParagraphMargins(withReliableButtons);
}

export function plainTextToMarketingEmailHtml(text: string) {
  const paragraphs = text
    .replace(/\r/g, "")
    .trim()
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export function hasOnlySupportedMergeTokens(value: string) {
  return value.replace(MERGE_TOKEN_RE, "").length < value.length;
}
