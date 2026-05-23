/**
 * db-backup.ts
 *
 * Performs a full logical SQL dump of the portal database and uploads it
 * to S3 (via the Manus storage proxy) as a gzip-compressed file.
 *
 * Backup key format:  db-backups/YYYY-MM-DD_HH-mm-ss_UTC.sql.gz
 * Retention:          30 days — older backups are pruned on each run.
 *
 * Called from:
 *   - POST /api/scheduled/db-backup  (Heartbeat cron, every 4 hours)
 *   - Admin tRPC mutation            (manual trigger from admin UI)
 */

import { ENV } from "./_core/env";
import { storagePut } from "./storage";
import { getDb } from "./db";
import { notifyOwner } from "./_core/notification";
import { createGzip } from "zlib";
import { Readable } from "stream";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackupResult {
  success: boolean;
  key?: string;
  url?: string;
  tables?: number;
  rows?: number;
  compressedBytes?: number;
  durationMs?: number;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function buildBackupKey(): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;
  return `db-backups/${date}_${time}_UTC.sql.gz`;
}

/** Compress a string buffer with gzip and return a Buffer. */
async function gzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gz = createGzip({ level: 9 });
    const readable = Readable.from(input);
    readable.pipe(gz);
    gz.on("data", (chunk: Buffer) => chunks.push(chunk));
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", reject);
  });
}

/** Escape a SQL string value. */
function escapeSqlString(val: string): string {
  return "'" + val.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r") + "'";
}

/** Serialize a single cell value to SQL literal. */
function toSqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "1" : "0";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) return `'${val.toISOString().replace("T", " ").replace(/\.\d+Z$/, "")}'`;
  if (typeof val === "string") return escapeSqlString(val);
  // Fallback for objects / buffers
  return escapeSqlString(JSON.stringify(val));
}

// ─── Core dump function ───────────────────────────────────────────────────────

/**
 * Produces a SQL dump string of all tables in the database.
 * Uses SELECT * per table — no mysqldump binary required.
 */
async function buildSqlDump(): Promise<{ sql: string; tables: number; rows: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Get list of all tables
  const tableRows = await db.execute<{ TABLE_NAME: string }>(
    // @ts-ignore — raw SQL
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`
  );
  const tables: string[] = (tableRows as any[]).map((r: any) => r.TABLE_NAME ?? r.table_name);

  const lines: string[] = [
    "-- JLT Group Booking Portal — Full SQL Backup",
    `-- Generated: ${new Date().toISOString()}`,
    "-- ============================================================",
    "",
    "SET FOREIGN_KEY_CHECKS=0;",
    "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
    "SET NAMES utf8mb4;",
    "",
  ];

  let totalRows = 0;

  for (const table of tables) {
    // Get CREATE TABLE statement
    const createRows = await db.execute<Record<string, string>>(
      // @ts-ignore
      `SHOW CREATE TABLE \`${table}\``
    );
    const createSql: string = (createRows as any[])[0]?.["Create Table"] ?? "";

    lines.push(`-- ── Table: ${table} ──`);
    lines.push(`DROP TABLE IF EXISTS \`${table}\`;`);
    lines.push(createSql + ";");
    lines.push("");

    // Dump rows
    const rows = await db.execute(
      // @ts-ignore
      `SELECT * FROM \`${table}\``
    );
    const rowArr = rows as any[];

    if (rowArr.length > 0) {
      const cols = Object.keys(rowArr[0]).map((c) => `\`${c}\``).join(", ");
      const valueChunks: string[] = [];

      for (const row of rowArr) {
        const vals = Object.values(row).map(toSqlLiteral).join(", ");
        valueChunks.push(`(${vals})`);
        totalRows++;
      }

      // Split into chunks of 500 rows per INSERT for safety
      const CHUNK = 500;
      for (let i = 0; i < valueChunks.length; i += CHUNK) {
        const chunk = valueChunks.slice(i, i + CHUNK);
        lines.push(`INSERT INTO \`${table}\` (${cols}) VALUES`);
        lines.push(chunk.join(",\n") + ";");
      }
    }

    lines.push("");
  }

  lines.push("SET FOREIGN_KEY_CHECKS=1;");
  lines.push("");

  return { sql: lines.join("\n"), tables: tables.length, rows: totalRows };
}

// ─── Prune old backups ────────────────────────────────────────────────────────

const STORAGE_LIST_URL = () => {
  const base = (ENV.forgeApiUrl ?? "").replace(/\/+$/, "");
  return `${base}/v1/storage/list`;
};

const STORAGE_DELETE_URL = (key: string) => {
  const base = (ENV.forgeApiUrl ?? "").replace(/\/+$/, "");
  return `${base}/v1/storage/delete?path=${encodeURIComponent(key)}`;
};

/**
 * Lists all db-backups/ keys and deletes any older than 30 days.
 */
async function pruneOldBackups(): Promise<{ pruned: number }> {
  const apiKey = ENV.forgeApiKey;
  if (!apiKey) return { pruned: 0 };

  try {
    const res = await fetch(`${STORAGE_LIST_URL()}?prefix=db-backups/`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { pruned: 0 };

    const data = await res.json();
    const files: Array<{ key: string; lastModified?: string }> = data.files ?? data.objects ?? data.items ?? [];

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
    let pruned = 0;

    for (const file of files) {
      const modified = file.lastModified ? new Date(file.lastModified).getTime() : 0;
      // Also parse date from filename as fallback: db-backups/YYYY-MM-DD_...
      const match = file.key.match(/db-backups\/(\d{4}-\d{2}-\d{2})/);
      const fileDate = match ? new Date(match[1]).getTime() : modified;

      if (fileDate > 0 && fileDate < cutoff) {
        try {
          await fetch(STORAGE_DELETE_URL(file.key), {
            method: "DELETE",
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          pruned++;
          console.log(`[DBBackup] Pruned old backup: ${file.key}`);
        } catch {
          // Non-fatal — continue
        }
      }
    }

    return { pruned };
  } catch (err: any) {
    console.warn("[DBBackup] Prune failed (non-fatal):", err?.message);
    return { pruned: 0 };
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function runDatabaseBackup(): Promise<BackupResult> {
  const startMs = Date.now();
  const key = buildBackupKey();

  try {
    console.log(`[DBBackup] Starting backup → ${key}`);

    // 1. Build SQL dump
    const { sql, tables, rows } = await buildSqlDump();

    // 2. Compress
    const sqlBuffer = Buffer.from(sql, "utf8");
    const compressed = await gzipBuffer(sqlBuffer);
    console.log(`[DBBackup] Dump complete: ${tables} tables, ${rows} rows, ${compressed.length} bytes compressed`);

    // 3. Upload to S3
    const { url } = await storagePut(key, compressed, "application/gzip");
    console.log(`[DBBackup] Uploaded to S3: ${url}`);

    // 4. Prune old backups
    const { pruned } = await pruneOldBackups();
    if (pruned > 0) console.log(`[DBBackup] Pruned ${pruned} old backup(s)`);

    const durationMs = Date.now() - startMs;
    console.log(`[DBBackup] Backup complete in ${durationMs}ms`);

    return { success: true, key, url, tables, rows, compressedBytes: compressed.length, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    console.error("[DBBackup] Backup failed:", err?.message);

    // Notify owner on failure
    try {
      await notifyOwner({
        title: "⚠️ Database Backup Failed",
        content: `The 4-hourly database backup failed at ${new Date().toISOString()}.\n\nError: ${err?.message ?? "Unknown error"}\n\nPlease check the server logs.`,
      });
    } catch { /* ignore */ }

    return { success: false, error: err?.message, durationMs };
  }
}
