import imaps from "imap-simple";
import { simpleParser, type ParsedMail, type Attachment } from "mailparser";
import crypto from "crypto";
import { upsertCachedEmail, getAllCachedEmails, getCachedEmailByUid, searchCachedEmailsByKeywords } from "./db";
import { storagePut, storageGet } from "./storage";

const ENCRYPTION_KEY_RAW = process.env.JWT_SECRET ?? "fallback-key-32-chars-padding!!";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(ENCRYPTION_KEY_RAW).digest();
const IV_LENGTH = 16;

// ─── Credential encryption helpers ───────────────────────────────────────────

export function encryptPassword(plaintext: string): string {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decryptPassword(encrypted: string): string {
  if (!encrypted) return "";
  try {
    const [ivHex, encHex] = encrypted.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const encryptedBuf = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedBuf), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type MatchReason = "name" | "date" | "reference" | "attachment_name" | "attachment_content";

export interface EmailResult {
  uid: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string;
  attachments: AttachmentMeta[];
  matchReasons: MatchReason[];
  score: number;
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface ImapConnectionConfig {
  host: string;
  port: number;
  email: string;
  password: string;
  useSsl: boolean;
}

/**
 * Agents provide a single departure date.
 * The ±3 day tolerance window is computed server-side and never exposed to agents.
 */
export interface SearchParams {
  guestName: string;
  departureDate: string;   // YYYY-MM-DD — single date from agent
  bookingReference?: string;
}

// ─── Fuzzy / partial name matching ───────────────────────────────────────────

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function fuzzyNameScore(haystack: string, name: string): number {
  if (!name.trim()) return 0;
  const h = normalise(haystack);
  const n = normalise(name);
  if (h.includes(n)) return 1.0;
  const tokens = n.split(" ").filter((t) => t.length > 1);
  if (tokens.length === 0) return 0;
  const matchedTokens = tokens.filter((t) => h.includes(t));
  const ratio = matchedTokens.length / tokens.length;
  if (ratio === 1.0) return 0.9;
  if (ratio >= 0.6) return 0.7;
  if (matchedTokens.length >= 1 && tokens.length <= 2) return 0.5;
  const haystackWords = h.split(" ");
  for (const token of tokens) {
    for (const word of haystackWords) {
      if (word.length < 3) continue;
      const dist = levenshtein(token, word);
      const maxLen = Math.max(token.length, word.length);
      if (dist / maxLen <= 0.25) return 0.3;
    }
  }
  return 0;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ─── Date window helpers ──────────────────────────────────────────────────────

/**
 * Build a ±3 day window around the given date.
 * This is ALWAYS server-side — agents only provide a single date.
 */
export function buildDateWindow(departureDate: string): Date[] {
  const dates: Date[] = [];
  try {
    const center = new Date(departureDate);
    if (isNaN(center.getTime())) return dates;
    for (let offset = -3; offset <= 3; offset++) {
      const d = new Date(center);
      d.setDate(d.getDate() + offset);
      dates.push(d);
    }
  } catch { /* ignore */ }
  return dates;
}

function dateTokensForDate(d: Date): string[] {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  const monthNames = ["january","february","march","april","may","june",
    "july","august","september","october","november","december"];
  const monthName = monthNames[d.getMonth()] ?? "";
  const shortMonth = monthName.slice(0, 3);
  return [
    `${year}-${month}-${day}`,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${day} ${monthName} ${year}`,
    `${day} ${shortMonth} ${year}`,
    `${day}/${month}`,
    `${day}-${month}`,
  ];
}

function dateMatchScore(corpus: string, dates: Date[]): number {
  const h = normalise(corpus);
  for (const d of dates) {
    if (dateTokensForDate(d).some((t) => h.includes(t))) return 1.0;
  }
  return 0;
}

// ─── PDF text extraction ──────────────────────────────────────────────────────

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const mod = await import("pdf-parse");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn: (buf: Buffer) => Promise<{ text: string }> = (mod as any).default ?? mod;
    const result = await fn(buffer);
    return result.text ?? "";
  } catch {
    return "";
  }
}

// ─── Scoring engine (shared by live IMAP scan and cached search) ──────────────

const FUZZY_THRESHOLD = 0.3;

interface RawEmailData {
  uid: string;
  subject: string;
  fromText: string;
  bodyText: string;
  bodyHtml: string;
  dateStr: string;
  pdfTexts: string[];
  attachments: AttachmentMeta[];
  attachmentFilenames: string;
}

function scoreEmail(
  raw: RawEmailData,
  params: SearchParams,
  dateWindow: Date[]
): EmailResult | null {
  const { guestName, bookingReference } = params;
  const corpus = [raw.subject, raw.fromText, raw.bodyText, ...raw.pdfTexts].join(" ");
  const normRef = bookingReference ? normalise(bookingReference) : null;

  const matchReasons: MatchReason[] = [];
  let totalScore = 0;

  // Name match
  const nameScoreBody = fuzzyNameScore(corpus, guestName);
  const nameScoreAtt = fuzzyNameScore(raw.attachmentFilenames, guestName);
  const nameScore = Math.max(nameScoreBody, nameScoreAtt);
  if (nameScore >= FUZZY_THRESHOLD) {
    matchReasons.push("name");
    totalScore += nameScore * 50;
  }

  // Date match (server-computed window)
  const dScore = Math.max(
    dateMatchScore(corpus, dateWindow),
    dateMatchScore(raw.attachmentFilenames, dateWindow)
  );
  if (dScore > 0) {
    matchReasons.push("date");
    totalScore += dScore * 30;
  }

  // Booking reference match
  if (normRef && normRef.length >= 3) {
    if (normalise(corpus).includes(normRef) || normalise(raw.attachmentFilenames).includes(normRef)) {
      matchReasons.push("reference");
      totalScore += 20;
    }
  }

  // PDF attachment content match
  if (raw.pdfTexts.length > 0) {
    const pdfCorpus = raw.pdfTexts.join(" ");
    const pdfNameScore = fuzzyNameScore(pdfCorpus, guestName);
    const pdfDateScore = dateMatchScore(pdfCorpus, dateWindow);
    if (pdfNameScore >= FUZZY_THRESHOLD || pdfDateScore > 0) {
      if (!matchReasons.includes("name") && pdfNameScore >= FUZZY_THRESHOLD) {
        matchReasons.push("attachment_content");
        totalScore += pdfNameScore * 30;
      }
    }
  }

  // Attachment filename match
  if (nameScoreAtt >= FUZZY_THRESHOLD && !matchReasons.includes("name")) {
    matchReasons.push("attachment_name");
    totalScore += nameScoreAtt * 20;
  }

  // Must qualify: name+date, reference alone, or name+reference
  const hasName = matchReasons.some((r) => ["name","attachment_content","attachment_name"].includes(r));
  const hasDate = matchReasons.includes("date");
  const hasRef = matchReasons.includes("reference");
  const qualifies = (hasName && hasDate) || (hasRef && totalScore >= 20) || (hasName && hasRef);
  if (!qualifies) return null;

  return {
    uid: raw.uid,
    subject: raw.subject,
    from: raw.fromText,
    date: raw.dateStr,
    snippet: raw.bodyText.slice(0, 300).replace(/\n+/g, " "),
    bodyText: raw.bodyText,
    bodyHtml: raw.bodyHtml,
    attachments: raw.attachments,
    matchReasons,
    score: Math.min(100, Math.round(totalScore)),
  };
}

// ─── Search cached emails (fast, no IMAP connection needed) ──────────────────

export async function searchCachedEmails(params: SearchParams): Promise<EmailResult[]> {
  const dateWindow = buildDateWindow(params.departureDate);

  // Build SQL pre-filter tokens to avoid loading the entire mailbox into memory
  const nameTokens = normalise(params.guestName).split(" ").filter((t) => t.length >= 3);
  const dateTokens: string[] = [];
  for (const d of dateWindow) {
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = String(d.getFullYear());
    const monthNames = ["january","february","march","april","may","june",
      "july","august","september","october","november","december"];
    const monthName = monthNames[d.getMonth()] ?? "";
    dateTokens.push(
      `${year}-${month}-${day}`,
      `${day}/${month}`,
      `${day} ${monthName.slice(0, 3)}`,
      `${day} ${monthName}`,
    );
  }
  // Deduplicate tokens
  const uniqueDateTokens = Array.from(new Set(dateTokens));

  const rows = await searchCachedEmailsByKeywords(nameTokens, uniqueDateTokens, params.bookingReference);
  const results: EmailResult[] = [];

  for (const row of rows) {
    // Use S3 keys (new path) or fall back to legacy base64 attachmentData
    type S3KeyEntry = { filename: string; contentType: string; s3Key: string; s3Url: string; size: number };
    type LegacyEntry = { filename: string; contentType: string; dataBase64: string };

    const s3KeysData: S3KeyEntry[] = row.s3Keys ? JSON.parse(row.s3Keys) : [];
    const legacyData: LegacyEntry[] = []; // portal schema uses s3Keys only

    // Re-extract PDF texts from S3 attachments (fetch and parse)
    const pdfTexts: string[] = [];
    for (const att of s3KeysData) {
      if (att.contentType.includes("pdf") || att.filename.toLowerCase().endsWith(".pdf")) {
        try {
          const resp = await fetch(att.s3Url);
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            const text = await extractPdfText(buf);
            if (text) pdfTexts.push(text);
          }
        } catch { /* skip */ }
      }
    }
    // Also check legacy base64 PDFs
    for (const att of legacyData) {
      if (att.contentType.includes("pdf") || att.filename.toLowerCase().endsWith(".pdf")) {
        const buf = Buffer.from(att.dataBase64, "base64");
        const text = await extractPdfText(buf);
        if (text) pdfTexts.push(text);
      }
    }

    const attachmentNames: string[] = row.attachmentNames ? JSON.parse(row.attachmentNames) : [];

    // Build AttachmentMeta from S3 keys (preferred) or legacy base64
    const attachments: AttachmentMeta[] = s3KeysData.length > 0
      ? s3KeysData.map((a) => ({
          id: Buffer.from(`${row.uid}::${a.filename}`).toString("base64url"),
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        }))
      : legacyData.map((a) => ({
          id: Buffer.from(`${row.uid}::${a.filename}`).toString("base64url"),
          filename: a.filename,
          contentType: a.contentType,
          size: Buffer.from(a.dataBase64, "base64").length,
        }));

    const raw: RawEmailData = {
      uid: row.uid,
      subject: row.subject,
      fromText: `${row.fromName} <${row.fromAddress}>`,
      bodyText: row.bodyText ?? "",
      bodyHtml: row.bodyHtml ?? "",
      dateStr: row.emailDate.toISOString(),
      pdfTexts,
      attachments,
      attachmentFilenames: attachmentNames.join(" "),
    };

    const result = scoreEmail(raw, params, dateWindow);
    if (result) results.push(result);
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ─── Safe IMAP connect (catches unhandled socket errors that bypass try/catch) ──

async function safeConnect(config: ImapConnectionConfig): Promise<imaps.ImapSimple> {
  const conn = await imaps.connect({
    imap: {
      user: config.email,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.useSsl,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
      connTimeout: 15000,
    },
  });
  // Attach a no-op error listener on the underlying imap Connection so that
  // ECONNRESET / TLS socket errors emitted after the promise resolves do NOT
  // become unhandled 'error' events that crash the Node.js process.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawImap = (conn as unknown as { imap: NodeJS.EventEmitter }).imap;
  if (rawImap && typeof rawImap.on === "function") {
    rawImap.on("error", (err: Error) => {
      console.warn("[IMAP] Connection error (suppressed):", err.message);
    });
  }
  return conn;
}

// ─── Import emails from IMAP into cache ─────────────────────────────────────
// Processes emails in batches of BATCH_SIZE to avoid OOM on large mailboxes.
// By default fetches ALL emails in the mailbox (no date window).
// Pass sinceDate to restrict to emails received on or after that date.

const IMPORT_BATCH_SIZE = 25;

async function processOneMessage(
  msg: { parts: Array<{ which: string; body: unknown }>; attributes?: { uid?: number }; seqno?: number },
  index: number,
  uid: string,
  stats: { imported: number; skipped: number; errors: number }
): Promise<void> {
  const allPart = msg.parts.find((p) => p.which === "");
  if (!allPart) { stats.skipped++; return; }

  const raw = allPart.body as Buffer | string;
  const parsed: ParsedMail = await simpleParser(
    typeof raw === "string" ? Buffer.from(raw) : raw
  );

  const subject = parsed.subject ?? "(no subject)";
  const fromAddress = parsed.from?.value?.[0]?.address ?? "";
  const fromName = parsed.from?.value?.[0]?.name ?? fromAddress;
  const emailDate = parsed.date ?? new Date();
  const bodyText = parsed.text ?? "";
  const bodyHtml: string = parsed.html ? (parsed.html as string) : "";
  const snippet = bodyText.slice(0, 300).replace(/\n+/g, " ");

  const attachmentNames: string[] = [];
  const s3Keys: Array<{ filename: string; contentType: string; s3Key: string; s3Url: string; size: number }> = [];

  for (const att of parsed.attachments ?? []) {
    const fn = att.filename ?? "attachment";
    attachmentNames.push(fn);
    if (att.content && att.content.length > 0) {
      try {
        const safeName = fn.replace(/[^a-zA-Z0-9._-]/g, "_");
        const s3Path = `email-attachments/${uid}/${safeName}`;
        const { key, url } = await storagePut(s3Path, att.content, att.contentType ?? "application/octet-stream");
        s3Keys.push({
          filename: fn,
          contentType: att.contentType ?? "application/octet-stream",
          s3Key: key,
          s3Url: url,
          size: att.content.length,
        });
      } catch (uploadErr) {
        console.warn(`[Import] Failed to upload attachment "${fn}" to S3:`, uploadErr);
      }
    }
  }

  await upsertCachedEmail({
    uid,
    subject,
    fromAddress,
    fromName,
    emailDate,
    bodyText,
    bodyHtml,
    snippet,
    hasAttachments: attachmentNames.length > 0,
    attachmentNames: JSON.stringify(attachmentNames),
    s3Keys: JSON.stringify(s3Keys),
  });

  stats.imported++;
}

export async function importInbox(
  config: ImapConnectionConfig,
  onProgress?: (imported: number, total: number) => void,
  sinceDate?: Date
): Promise<{ imported: number; skipped: number; errors: number }> {
  const stats = { imported: 0, skipped: 0, errors: 0 };

  const searchCriteria: unknown[] = sinceDate
    ? [["SINCE", sinceDate.toUTCString()]]
    : ["ALL"];

  // Step 1: fetch all UIDs only (no bodies) to get the full list without OOM
  const uidConnection = await safeConnect(config);
  let allUids: number[] = [];
  try {
    await uidConnection.openBox("INBOX");
    const uidMessages = await uidConnection.search(
      searchCriteria as Parameters<typeof uidConnection.search>[0],
      { bodies: [], struct: false }
    );
    allUids = uidMessages.map((m) => m.attributes.uid).filter((u) => u > 0);
  } finally {
    uidConnection.end();
  }

  const total = allUids.length;
  console.log(`[Import] Found ${total} messages to process`);
  if (total === 0) return stats;

  // Step 2: process in UID batches — open a fresh connection per batch
  for (let batchStart = 0; batchStart < total; batchStart += IMPORT_BATCH_SIZE) {
    const batchUids = allUids.slice(batchStart, batchStart + IMPORT_BATCH_SIZE);
    // UID range string e.g. "1001,1002,1003,..."
    const uidList = batchUids.join(",");

    let batchConnection: imaps.ImapSimple | null = null;
    try {
      batchConnection = await safeConnect(config);
      await batchConnection.openBox("INBOX");
      const batchMessages = await batchConnection.search(
        [["UID", uidList]] as Parameters<typeof batchConnection.search>[0],
        { bodies: [""], struct: true }
      );

      for (const msg of batchMessages) {
        const uid = String(msg.attributes.uid ?? `${Date.now()}-${batchStart}`);
        try {
          await processOneMessage(msg as Parameters<typeof processOneMessage>[0], batchStart, uid, stats);
          onProgress?.(stats.imported, total);
        } catch (err) {
          console.warn(`[Import] Failed to process message uid=${uid}:`, err);
          stats.errors++;
        }
      }

      const batchEnd = Math.min(batchStart + IMPORT_BATCH_SIZE, total);
      console.log(`[Import] Batch ${batchEnd}/${total} — imported: ${stats.imported}, errors: ${stats.errors}`);
    } catch (batchErr) {
      console.warn(`[Import] Batch ${batchStart}-${batchStart + IMPORT_BATCH_SIZE} failed:`, batchErr);
      stats.errors += batchUids.length;
    } finally {
      batchConnection?.end();
    }

    // Yield to event loop between batches to keep the server responsive
    await new Promise((r) => setTimeout(r, 50));
  }

  return stats;
}

// ─── Live IMAP scan (fallback when no cache or admin testing) ─────────────────

export async function scanInbox(
  config: ImapConnectionConfig,
  params: SearchParams
): Promise<EmailResult[]> {
  const dateWindow = buildDateWindow(params.departureDate);

  const connection = await safeConnect(config);

  try {
    await connection.openBox("INBOX");
    const messages = await connection.search(["ALL"], {
      bodies: [""],
      struct: true,
    });

    const results: EmailResult[] = [];

    for (const msg of messages) {
      try {
        const allPart = msg.parts.find((p: { which: string }) => p.which === "");
        if (!allPart) continue;

        const raw = allPart.body as Buffer | string;
        const parsed: ParsedMail = await simpleParser(
          typeof raw === "string" ? Buffer.from(raw) : raw
        );

        const pdfTexts: string[] = [];
        for (const att of parsed.attachments ?? []) {
          const ct = att.contentType ?? "";
          if (ct.includes("pdf") || (att.filename ?? "").toLowerCase().endsWith(".pdf")) {
            const text = await extractPdfText(att.content);
            if (text) pdfTexts.push(text);
          }
        }

        const uid = String(
          (msg as { attributes?: { uid?: number } }).attributes?.uid ??
          (msg as { seqno?: number }).seqno ??
          Math.random()
        );

        const attachments: AttachmentMeta[] = (parsed.attachments ?? []).map(
          (a: Attachment) => ({
            id: Buffer.from(`${uid}::${a.filename ?? "attachment"}`).toString("base64url"),
            filename: a.filename ?? "attachment",
            contentType: a.contentType ?? "application/octet-stream",
            size: a.size ?? 0,
          })
        );

        const raw2: RawEmailData = {
          uid,
          subject: parsed.subject ?? "",
          fromText: parsed.from?.text ?? "",
          bodyText: parsed.text ?? "",
          bodyHtml: parsed.html ? (parsed.html as string) : "",
          dateStr: parsed.date?.toISOString() ?? "",
          pdfTexts,
          attachments,
          attachmentFilenames: (parsed.attachments ?? []).map((a) => a.filename ?? "").join(" "),
        };

        const result = scoreEmail(raw2, params, dateWindow);
        if (result) results.push(result);
      } catch (msgErr) {
        console.warn("[IMAP] Failed to parse message:", msgErr);
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  } finally {
    connection.end();
  }
}

// ─── Attachment fetcher (from live IMAP) ──────────────────────────────────────

export async function fetchAttachment(
  config: ImapConnectionConfig,
  attachmentId: string
): Promise<{ data: Buffer; filename: string; contentType: string } | null> {
  let uid: string;
  let filename: string;
  try {
    const decoded = Buffer.from(attachmentId, "base64url").toString("utf8");
    const sep = decoded.indexOf("::");
    uid = decoded.slice(0, sep);
    filename = decoded.slice(sep + 2);
  } catch {
    return null;
  }

  const connection = await safeConnect(config);

  try {
    await connection.openBox("INBOX");
    const messages = await connection.search(
      [["UID", uid]],
      { bodies: [""], struct: true }
    );
    if (!messages.length) return null;

    const msg = messages[0];
    const allPart = msg.parts.find((p: { which: string }) => p.which === "");
    if (!allPart) return null;

    const raw = allPart.body as Buffer | string;
    const parsed: ParsedMail = await simpleParser(
      typeof raw === "string" ? Buffer.from(raw) : raw
    );

    const attachment = (parsed.attachments ?? []).find((a) => a.filename === filename);
    if (!attachment) return null;

    return {
      data: attachment.content,
      filename: attachment.filename ?? filename,
      contentType: attachment.contentType ?? "application/octet-stream",
    };
  } finally {
    connection.end();
  }
}

//// ─── Fetch attachment from cache ────────────────────────────────────────────

export async function fetchCachedAttachment(
  attachmentId: string
): Promise<{ data: Buffer; filename: string; contentType: string } | null> {
  let uid: string;
  let filename: string;
  try {
    const decoded = Buffer.from(attachmentId, "base64url").toString("utf8");
    const sep = decoded.indexOf("::");
    uid = decoded.slice(0, sep);
    filename = decoded.slice(sep + 2);
  } catch {
    return null;
  }

  const row = await getCachedEmailByUid(uid);
  if (!row) return null;

  // Try S3 keys first (new storage path)
  if (row.s3Keys) {
    const s3Keys: Array<{ filename: string; contentType: string; s3Key: string; s3Url: string; size: number }> =
      JSON.parse(row.s3Keys);
    const att = s3Keys.find((a) => a.filename === filename);
    if (att) {
      // Fetch the file from S3
      const response = await fetch(att.s3Url);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      return {
        data: Buffer.from(arrayBuffer),
        filename: att.filename,
        contentType: att.contentType,
      };
    }
  }

  // No legacy attachmentData column in this portal schema
  return null;
}
