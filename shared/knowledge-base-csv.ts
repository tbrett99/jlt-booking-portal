import { parseCsvRows } from "./academy-quiz-csv";
import { parseLoomEmbedId } from "./loom-embed";

export type ImportedKnowledgeBaseArticle = {
  title: string;
  summary: string | null;
  category: string;
  tags: string[];
  status: "draft" | "published";
  isFeatured: boolean;
  contentHtml: string;
  loomUrl: string | null;
  sopUrl: string | null;
  sopLabel: string | null;
};

export class KnowledgeBaseCsvImportError extends Error {
  constructor(message: string, readonly rowErrors: string[]) {
    super(message);
  }
}

export const MAX_KNOWLEDGE_BASE_IMPORT_ROWS = 500;

const HEADER_ALIASES = {
  title: new Set(["title", "articletitle"]),
  summary: new Set(["summary", "shortsummary", "description"]),
  category: new Set(["category", "topic"]),
  tags: new Set(["tags", "tag"]),
  status: new Set(["status", "publishstatus"]),
  featured: new Set(["featured", "isfeatured"]),
  contentHtml: new Set(["contenthtml", "articlehtml", "content"]),
  loomUrl: new Set(["loomurl", "loomlink", "video", "videourl"]),
  sopUrl: new Set(["sopurl", "onlinesopurl", "processurl"]),
  sopLabel: new Set(["soplabel", "onlinesoplabel", "processlabel"]),
};

function normaliseHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function columnFor(headers: string[], aliases: Set<string>) {
  const index = headers.findIndex((header) => aliases.has(header));
  return index < 0 ? undefined : index;
}

function valueAt(row: string[], column: number | undefined) {
  return column === undefined ? "" : (row[column] ?? "").trim();
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character] ?? character));
}

function parseBoolean(value: string, rowNumber: number, label: string, errors: string[]) {
  if (!value) return false;
  if (["yes", "y", "true", "1"].includes(value.toLocaleLowerCase())) return true;
  if (["no", "n", "false", "0"].includes(value.toLocaleLowerCase())) return false;
  errors.push(`Row ${rowNumber}: ${label} must be Yes or No.`);
  return false;
}

function appendMigratedLinks(contentHtml: string, loomUrl: string | null, sopUrl: string | null, sopLabel: string | null) {
  const additions: string[] = [];
  if (loomUrl) {
    // LibraryBrowser replaces this durable marker with a verified Loom player.
    additions.push(`<p data-library-loom="true"><a href="${escapeHtml(loomUrl)}" target="_blank" rel="noreferrer">Watch video on Loom</a></p>`);
  }
  if (sopUrl) {
    additions.push(`<p><a href="${escapeHtml(sopUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sopLabel || "Open the online SOP")}</a></p>`);
  }
  return [contentHtml.trim(), ...additions].filter(Boolean).join("\n");
}

/**
 * Parses a staff-created Knowledge Base migration CSV before any row is saved.
 * CSV fields may contain quoted commas and newlines, including full HTML body
 * content. Importing is create-only, so an existing article can never be
 * silently replaced by a bulk upload.
 */
export function parseKnowledgeBaseArticleCsv(input: string): ImportedKnowledgeBaseArticle[] {
  if (!input.trim()) throw new KnowledgeBaseCsvImportError("Choose a CSV with a header row and at least one Knowledge Base article.", []);
  const rows = parseCsvRows(input).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length < 2) throw new KnowledgeBaseCsvImportError("The CSV needs a header row and at least one article row.", []);
  if (rows.length - 1 > MAX_KNOWLEDGE_BASE_IMPORT_ROWS) {
    throw new KnowledgeBaseCsvImportError(`One import can contain up to ${MAX_KNOWLEDGE_BASE_IMPORT_ROWS} articles. Split this migration into smaller CSV files.`, []);
  }

  const headers = rows[0].map(normaliseHeader);
  const columns = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, columnFor(headers, aliases)])) as Record<keyof typeof HEADER_ALIASES, number | undefined>;
  const missing = ["title", "category", "contentHtml"].filter((key) => columns[key as keyof typeof HEADER_ALIASES] === undefined);
  if (missing.length) throw new KnowledgeBaseCsvImportError("The CSV headings need attention.", missing.map((key) => `Add a ${key === "contentHtml" ? "Content HTML" : key[0]?.toUpperCase() + key.slice(1)} column.`));

  const errors: string[] = [];
  const titles = new Set<string>();
  const articles = rows.slice(1).flatMap((row, rowOffset) => {
    const rowNumber = rowOffset + 2;
    const title = valueAt(row, columns.title);
    const summary = valueAt(row, columns.summary);
    const category = valueAt(row, columns.category);
    const rawTags = valueAt(row, columns.tags);
    const rawStatus = valueAt(row, columns.status).toLocaleLowerCase() || "draft";
    const contentHtml = valueAt(row, columns.contentHtml);
    const loomUrl = valueAt(row, columns.loomUrl);
    const sopUrl = valueAt(row, columns.sopUrl);
    const sopLabel = valueAt(row, columns.sopLabel);
    const isFeatured = parseBoolean(valueAt(row, columns.featured), rowNumber, "Featured", errors);

    if (title.length < 2 || title.length > 255) errors.push(`Row ${rowNumber}: Title must be between 2 and 255 characters.`);
    if (!category || category.length > 120) errors.push(`Row ${rowNumber}: Category is required and must be 120 characters or fewer.`);
    if (summary.length > 10_000) errors.push(`Row ${rowNumber}: Summary is too long.`);
    if (!contentHtml || contentHtml.length > 600_000) errors.push(`Row ${rowNumber}: Content HTML is required and must be 600,000 characters or fewer.`);
    if (rawStatus !== "draft" && rawStatus !== "published") errors.push(`Row ${rowNumber}: Status must be Draft or Published.`);
    if (loomUrl && !parseLoomEmbedId(loomUrl)) errors.push(`Row ${rowNumber}: Loom URL must be a secure loom.com share or embed URL.`);
    if (sopUrl && !isHttpsUrl(sopUrl)) errors.push(`Row ${rowNumber}: SOP URL must be a valid HTTPS URL.`);

    const tags = Array.from(new Set(rawTags.split(/[,|]/).map((tag) => tag.trim()).filter(Boolean)));
    if (tags.length > 30 || tags.some((tag) => tag.length > 80)) errors.push(`Row ${rowNumber}: Use up to 30 tags, each no more than 80 characters.`);
    const titleKey = `${category.toLocaleLowerCase()}::${title.toLocaleLowerCase()}`;
    if (titles.has(titleKey)) errors.push(`Row ${rowNumber}: This title and category duplicate an earlier row in the same CSV.`);
    titles.add(titleKey);

    if (errors.some((error) => error.startsWith(`Row ${rowNumber}:`))) return [];
    return [{
      title,
      summary: summary || null,
      category,
      tags,
      status: rawStatus as "draft" | "published",
      isFeatured,
      contentHtml: appendMigratedLinks(contentHtml, loomUrl || null, sopUrl || null, sopLabel || null),
      loomUrl: loomUrl || null,
      sopUrl: sopUrl || null,
      sopLabel: sopLabel || null,
    }];
  });

  if (errors.length) {
    const displayed = errors.slice(0, 20);
    const suffix = errors.length > displayed.length ? ` Plus ${errors.length - displayed.length} more row issue${errors.length - displayed.length === 1 ? "" : "s"}.` : "";
    throw new KnowledgeBaseCsvImportError(`The CSV was not imported. ${displayed.join(" ")}${suffix}`, displayed);
  }
  return articles;
}

export const knowledgeBaseArticleCsvTemplate = `Title,Summary,Category,Tags,Status,Featured,Content HTML,Loom URL,SOP URL,SOP Label
"Cancelling a LIVE hotel booking","How to cancel a live hotel booking in Orbit","Bookings","Orbit,Bookings,Bedbank",Draft,No,"<p>Use this guide before changing a live hotel booking.</p><h2>Before you begin</h2><ul><li>Confirm the booking reference.</li><li>Check the supplier terms.</li></ul>","https://www.loom.com/share/replacewithyourvideoid","https://example.com/your-online-sop","Open the cancellation SOP"`;
