import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parse } from "csv-parse/sync";
import { eq, inArray } from "drizzle-orm";
import { staffHandbookImportSources as sources } from "../drizzle/schema";
import { STAFF_HANDBOOK_CATEGORIES, STAFF_HANDBOOK_SENSITIVITIES, emptyHandbookContent, type HandbookContent } from "../shared/staff-handbook";
import { HANDBOOK_IMPORT_COLUMNS, HANDBOOK_IMPORT_MAX_BYTES, HANDBOOK_IMPORT_MAX_ROWS, type HandbookImportPreview, type HandbookImportRow, type HandbookImportReceipt, type HandbookImportReceiptRow } from "../shared/staff-handbook-import";
import { HandbookError, assertStaffHandbookAccount, fail, normaliseContent, plainHandbookText, type HandbookAccount } from "./staff-handbook-policy";
import { getArticle, getRevision, recordAudit, revisionContent, snapshotIds, withHandbookRead, withHandbookWrite, type HandbookDb } from "./staff-handbook-core";
import { createArticleInTransaction } from "./staff-handbook-articles";

const guideUrl = (id: number) => `/admin/staff-handbook?tab=handbook&article=${id}`;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const sectionColumns = {
  when_to_use: "whenToUse", checks_before_starting: "checks", steps: "steps",
  suggested_reply: "agentWording", when_to_ask_for_help: "exceptions", related_guidance: "related",
} as const;
type ParsedRow = HandbookImportRow & { payloadHash: string };

/** No parser/provider input or raw exception text crosses the handbook boundary. */
export function parseHandbookImport(csv: string, actorId: number): ParsedRow[] {
  if (typeof csv !== "string" || !csv.trim() || Buffer.byteLength(csv, "utf8") > HANDBOOK_IMPORT_MAX_BYTES)
    fail("BAD_REQUEST", "Choose a UTF-8 CSV file no larger than 5 MiB.");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.test(csv))
    fail("BAD_REQUEST", "The CSV contains invalid text or unsupported control characters. Save it as UTF-8.");
  let records: string[][];
  let recordCount = 0;
  try {
    records = parse(csv, { bom: true, skip_empty_lines: true, relax_column_count: true, max_record_size: 400000, on_record: (record: string[]) => {
      if (++recordCount > HANDBOOK_IMPORT_MAX_ROWS + 1) fail("BAD_REQUEST", "The CSV must contain no more than 100 guide rows. Split larger files into batches.");
      return record;
    } });
  } catch (error) {
    if (error instanceof HandbookError) throw error;
    fail("BAD_REQUEST", "The CSV could not be read. Check quoted cells, commas and line breaks.");
  }
  const header = records.shift();
  if (!header || header.length !== HANDBOOK_IMPORT_COLUMNS.length || new Set(header).size !== header.length || HANDBOOK_IMPORT_COLUMNS.some(column => !header.includes(column)))
    fail("BAD_REQUEST", "Use the template's exact 14 column names, with no missing, repeated or extra columns.");
  if (!records.length || records.length > HANDBOOK_IMPORT_MAX_ROWS)
    fail("BAD_REQUEST", "The CSV must contain between 1 and 100 guide rows. Split larger files into batches.");
  const result: ParsedRow[] = records.map((cells, index) => {
    const raw = Object.fromEntries(header.map((column, i) => [column, (cells[i] ?? "").replace(/\r\n?/g, "\n")]));
    const externalReference = raw.external_reference.trim();
    const row: ParsedRow = { rowNumber: index + 2, externalReference, title: raw.title.trim().slice(0, 255), status: "ready", errors: [], warnings: [], articleId: null, guideUrl: null, content: null, payloadHash: "" };
    if (cells.length !== header.length) row.errors.push("This row must contain exactly 14 cells.");
    if (!/^[A-Z0-9][A-Z0-9._-]{0,79}$/.test(externalReference)) row.errors.push("Use a unique uppercase reference of 1–80 letters, digits, dots, underscores or hyphens, starting with a letter or digit.");
    if (!raw.title.trim() || raw.title.length > 255) row.errors.push("A title of 1–255 characters is required.");
    if (!(STAFF_HANDBOOK_CATEGORIES as readonly string[]).includes(raw.category.trim())) row.errors.push("Choose an exact supported category name.");
    if (!(STAFF_HANDBOOK_SENSITIVITIES as readonly string[]).includes(raw.guidance_type.trim())) row.errors.push("Guidance type must be operational, financial, legal or policy.");
    if (raw.editor_format.trim() !== "article" && raw.editor_format.trim() !== "process") row.errors.push("Editor format must be article or process.");
    if (raw.summary.length > 4000) row.errors.push("Summary must not exceed 4,000 characters.");
    const tagParts = raw.tags.trim() ? raw.tags.split("|").map(tag => tag.trim()) : [];
    if (tagParts.length > 30 || tagParts.some(tag => !tag || tag.length > 80)) row.errors.push("Use up to 30 nonempty pipe-separated tags, each no longer than 80 characters.");
    if (raw.content.length > 200000) row.errors.push("Article content must not exceed 200,000 characters.");
    for (const column of Object.keys(sectionColumns) as (keyof typeof sectionColumns)[]) {
      if (raw[column].length > (column === "steps" ? 60000 : 30000)) row.errors.push(column === "steps" ? "Steps must not exceed 60,000 characters." : "A process section must not exceed 30,000 characters.");
    }
    if (raw.editor_format.trim() === "article" && Object.keys(sectionColumns).some(column => raw[column].trim())) row.errors.push("Free-form guides use content only; leave all six process sections empty.");
    if (raw.editor_format.trim() === "process" && raw.content.trim()) row.errors.push("Process guides use the section columns; leave content empty.");
    // Canonical RAW accepted import payload, not today's editable draft or actor identity.
    const canonical = HANDBOOK_IMPORT_COLUMNS.map(column => [column, column === "external_reference" ? externalReference : raw[column]]);
    row.payloadHash = sha(JSON.stringify(canonical));
    if (!row.errors.length) {
      const candidate: HandbookContent = {
        ...emptyHandbookContent(actorId), title: raw.title, category: raw.category.trim(), summary: raw.summary,
        sensitivity: raw.guidance_type.trim() as HandbookContent["sensitivity"], format: raw.editor_format.trim() as HandbookContent["format"],
        tags: tagParts, contentHtml: raw.content,
        sections: Object.fromEntries(Object.entries(sectionColumns).map(([column, key]) => [key, raw[column]])) as HandbookContent["sections"],
      };
      const normal = normaliseContent(candidate);
      const rich = normal.format === "article" ? normal.contentHtml : normal.sections.steps;
      // HTML-only/whitespace/nonbreaking-space content cannot masquerade as a meaningful guide.
      if (!plainHandbookText(rich).replace(/&(?:nbsp|#160|#xA0);/gi, " ").trim()) row.errors.push(normal.format === "article" ? "Meaningful article content is required." : "Meaningful process steps are required.");
      if (normal.contentHtml !== raw.content.trim() || Object.entries(sectionColumns).some(([column, key]) => normal.sections[key as keyof HandbookContent["sections"]] !== raw[column].trim()))
        row.warnings.push("Formatting or links were normalised or removed. Check the safe content preview before importing.");
      row.content = normal;
    }
    if (row.errors.length) { row.status = "invalid"; row.content = null; }
    return row;
  });
  const counts = new Map<string, number>();
  for (const row of result) if (row.externalReference) counts.set(row.externalReference, (counts.get(row.externalReference) ?? 0) + 1);
  for (const row of result) if ((counts.get(row.externalReference) ?? 0) > 1) {
    row.status = "invalid"; row.content = null;
    row.errors.push("This reference appears more than once in this file. Keep one row per guide reference.");
  }
  return result;
}
function previewSignature(csv: string, actorId: number, rows: ParsedRow[]) {
  const secret = process.env.JWT_SECRET;
  if (!secret) fail("INTERNAL_SERVER_ERROR", "The import preview is temporarily unavailable.");
  // Bind this exact file, actor, validated content and sanitisation result. DB duplicate
  // status deliberately excluded: a lost response must still be safely retryable.
  return createHmac("sha256", secret).update(JSON.stringify({ scope: "handbook-csv-v1", actorId, csvHash: sha(csv), rows: rows.map(row => ({ rowNumber: row.rowNumber, payloadHash: row.payloadHash, content: row.content, errors: row.errors, warnings: row.warnings })) })).digest("hex");
}
function verifiedId(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647; }
async function knownSources(db: HandbookDb, rows: ParsedRow[], lock = false) {
  const refs = rows.filter(row => row.status === "ready").map(row => row.externalReference);
  if (!refs.length) return [];
  const query = db.select().from(sources).where(inArray(sources.externalReference, refs)).limit(HANDBOOK_IMPORT_MAX_ROWS + 1);
  const found = await (lock ? query.for("update") : query);
  if (found.length > HANDBOOK_IMPORT_MAX_ROWS || found.some((source: typeof sources.$inferSelect) => !verifiedId(source.articleId) || !/^[a-f0-9]{64}$/.test(source.payloadHash)))
    fail("INTERNAL_SERVER_ERROR", "The import reference records could not be verified.");
  return found as (typeof sources.$inferSelect)[];
}
export async function previewHandbookImport(actor: HandbookAccount, input: { csv: string }): Promise<HandbookImportPreview> {
  assertStaffHandbookAccount(actor);
  return withHandbookRead(actor, async (db, actorId) => {
    const rows = parseHandbookImport(input.csv, actorId);
    const previewHash = previewSignature(input.csv, actorId, rows);
    const known = await knownSources(db, rows);
    for (const row of rows) {
      const source = known.find(source => source.externalReference === row.externalReference);
      if (!source || row.status !== "ready") continue;
      const existing = await getArticle(db, source.articleId);
      row.articleId = existing.id; row.guideUrl = guideUrl(existing.id);
      if (source.payloadHash === row.payloadHash) {
        row.status = "already_imported";
        row.warnings.push(existing.archivedAt ? "Already imported; this guide is archived. Importing will not restore or overwrite it." : "Already imported. Later Portal edits are kept unchanged.");
      } else {
        row.status = "conflict";
        row.errors.push("This reference belongs to an existing guide with a different import payload. Bulk updates are not supported; edit the guide in the Portal.");
      }
    }
    return { previewHash, rows: rows.map(({ payloadHash: _hash, ...row }) => row), readyCount: rows.filter(row => row.status === "ready").length, skippedCount: rows.filter(row => row.status === "already_imported").length, errorCount: rows.filter(row => row.status === "invalid" || row.status === "conflict").length };
  });
}
function receipt(row: ParsedRow, outcome: HandbookImportReceiptRow["outcome"], message: string, articleId: number | null = null): HandbookImportReceiptRow {
  return { rowNumber: row.rowNumber, externalReference: row.externalReference, title: row.title, outcome, articleId, guideUrl: articleId ? guideUrl(articleId) : null, message };
}
async function importRow(db: HandbookDb, actorId: number, row: ParsedRow): Promise<HandbookImportReceiptRow> {
  // Locking current read after the deterministic account lock plan, NOT a stale
  // repeatable-read snapshot. Unique reference/article keys remain the DB backstop.
  const [source] = await db.select().from(sources).where(eq(sources.externalReference, row.externalReference)).limit(1).for("update");
  if (source) {
    if (!verifiedId(source.articleId) || !/^[a-f0-9]{64}$/.test(source.payloadHash)) fail("INTERNAL_SERVER_ERROR", "The import reference could not be verified.");
    await getArticle(db, source.articleId, true);
    return source.payloadHash === row.payloadHash
      ? receipt(row, "already_imported", "Already imported. No guide content, review or publication was changed.", source.articleId)
      : receipt(row, "conflict", "This reference already exists with a different import payload. Update the guide manually; no changes were made.", source.articleId);
  }
  if (!row.content) fail("BAD_REQUEST", "This row has no valid draft content.");
  const token = sha(`handbook-csv-v1:${row.externalReference}`);
  const created = await createArticleInTransaction(db, actorId, token, row.content, "Draft created from staff handbook CSV import");
  if (!created.created) fail("CONFLICT", "An earlier creation attempt could not be matched. No new guide was created; contact an administrator.");
  const article = await getArticle(db, created.id, true);
  const revision = await getRevision(db, article.id, article.draftRevisionId);
  if (!revision || article.version !== 1 || article.publishedRevisionId !== null || article.reviewedRevisionId !== null || article.reviewedById !== null || article.submittedAt !== null || article.archivedAt !== null || JSON.stringify(revisionContent(revision)) !== JSON.stringify(row.content) || snapshotIds(revision.resourceIds).length || JSON.stringify(snapshotIds(revision.contributorIds)) !== JSON.stringify([actorId]))
    fail("INTERNAL_SERVER_ERROR", "The imported draft could not be verified. This row has not been committed.");
  await db.insert(sources).values({ externalReference: row.externalReference, articleId: article.id, payloadHash: row.payloadHash, importedById: actorId });
  const [stored] = await db.select().from(sources).where(eq(sources.externalReference, row.externalReference)).limit(1);
  if (!stored || stored.articleId !== article.id || stored.payloadHash !== row.payloadHash || stored.importedById !== actorId)
    fail("INTERNAL_SERVER_ERROR", "The import reference could not be verified. This row has not been committed.");
  await recordAudit(db, "article", article.id, actorId, "csv_imported", "Unpublished draft imported from CSV.", { rowNumber: row.rowNumber, externalReference: row.externalReference, payloadHash: row.payloadHash, revisionId: revision.id });
  return receipt(row, "created", "Unpublished draft created. Review and publish it separately.", article.id);
}
export async function commitHandbookImport(actor: HandbookAccount, input: { csv: string; previewHash: string; rows: number[] }): Promise<HandbookImportReceipt> {
  assertStaffHandbookAccount(actor);
  // Fresh read is required even for files with no writeable rows.
  const parsed = await withHandbookRead(actor, async (db, actorId) => {
    const rows = parseHandbookImport(input.csv, actorId);
    const expected = previewSignature(input.csv, actorId, rows);
    if (!/^[a-f0-9]{64}$/.test(input.previewHash) || !timingSafeEqual(Buffer.from(input.previewHash, "hex"), Buffer.from(expected, "hex")))
      fail("CONFLICT", "The file or preview changed. Preview this file again before importing.");
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > HANDBOOK_IMPORT_MAX_ROWS || new Set(input.rows).size !== input.rows.length || input.rows.some(number => !Number.isInteger(number) || !rows.some(row => row.rowNumber === number && row.status === "ready")))
      fail("BAD_REQUEST", "Select valid rows from the preview before importing.");
    const known = await knownSources(db, rows);
    for (const row of rows) {
      const source = known.find(source => source.externalReference === row.externalReference);
      if (!source || row.status !== "ready" || input.rows.includes(row.rowNumber)) continue;
      row.status = source.payloadHash === row.payloadHash ? "already_imported" : "conflict";
      row.articleId = source.articleId; row.guideUrl = guideUrl(source.articleId);
    }
    return rows;
  });
  const outcomes: HandbookImportReceiptRow[] = [];
  for (const row of parsed) {
    if (row.status === "invalid") { outcomes.push(receipt(row, "invalid", row.errors.join(" "))); continue; }
    if (row.status === "already_imported") { outcomes.push(receipt(row, "already_imported", "Already imported. Existing Portal edits and publication remain unchanged.", row.articleId)); continue; }
    if (row.status === "conflict") { outcomes.push(receipt(row, "conflict", "This reference exists with a different import payload. Edit the guide manually.", row.articleId)); continue; }
    if (!input.rows.includes(row.rowNumber)) { outcomes.push(receipt(row, "not_selected", "Not selected; no changes were made.")); continue; }
    try {
      outcomes.push(await withHandbookWrite(actor, (db, actorId) => importRow(db, actorId, row)));
    } catch (error) {
      // A revocation must suppress the entire private response, not be a row error.
      if (error && typeof error === "object" && "code" in error && (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED")) throw error;
      outcomes.push(receipt(row, "failed", "The save could not be confirmed. Retry this same file safely; previously committed references will not be duplicated."));
    }
  }
  return withHandbookRead(actor, async () => ({ rows: outcomes, createdCount: outcomes.filter(row => row.outcome === "created").length, skippedCount: outcomes.filter(row => row.outcome === "already_imported").length, errorCount: outcomes.filter(row => ["invalid", "conflict", "failed"].includes(row.outcome)).length }));
}
