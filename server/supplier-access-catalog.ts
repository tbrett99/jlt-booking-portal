import { createHash } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { systemSettings } from "../drizzle/schema";
import { getDb } from "./db";
import {
  DEFAULT_SUPPLIER_ACCESS_NAMES, cleanSupplierAccessName,
  isValidSupplierAccessName, supplierAccessIdentity,
} from "../shared/supplier-access-catalog";

// Individual hash-keyed settings avoid lost updates from concurrent array saves.
export const SUPPLIER_ACCESS_SETTING_PREFIX = "crm-supplier-access:";
export function supplierAccessSettingKey(name: string): string {
  return SUPPLIER_ACCESS_SETTING_PREFIX + createHash("sha256").update(supplierAccessIdentity(name)).digest("hex");
}
function readEntry(value: string, key: string): { name: string } {
  try {
    const entry = JSON.parse(value);
    if (entry?.version !== 1 || typeof entry.name !== "string"
      || !isValidSupplierAccessName(entry.name) || supplierAccessSettingKey(entry.name) !== key) throw new Error();
    return { name: cleanSupplierAccessName(entry.name) };
  } catch {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The supplier list could not be read. Please contact support; existing agent access has not been changed." });
  }
}
function safeError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The supplier list is temporarily unavailable. Please retry; no agent access has been changed." });
}

export async function getSupplierAccessCatalog(): Promise<{ names: string[] }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Unavailable");
    const rows = await db.select({ key: systemSettings.key, value: systemSettings.value })
      .from(systemSettings).where(like(systemSettings.key, `${SUPPLIER_ACCESS_SETTING_PREFIX}%`));
    const names = rows.map(row => readEntry(row.value, row.key).name)
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    return { names };
  } catch (error) { return safeError(error); }
}

export async function addSupplierAccessOption(name: string, actorId: number): Promise<{ name: string; alreadyExists: boolean }> {
  if (!isValidSupplierAccessName(name)) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a supplier name between 1 and 120 characters, without control characters." });
  const cleaned = cleanSupplierAccessName(name);
  const identity = supplierAccessIdentity(cleaned);
  const builtin = DEFAULT_SUPPLIER_ACCESS_NAMES.find(current => supplierAccessIdentity(current) === identity);
  if (builtin) return { name: builtin, alreadyExists: true };
  try {
    const db = await getDb();
    if (!db) throw new Error("Unavailable");
    const key = supplierAccessSettingKey(cleaned);
    const before = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
    if (before.length) return { ...readEntry(before[0].value, key), alreadyExists: true };
    const value = JSON.stringify({ version: 1, name: cleaned, createdById: actorId, createdAt: new Date().toISOString() });
    // Do not replace the first creator's spelling or audit evidence on conflict.
    await db.insert(systemSettings).values({ key, value }).onDuplicateKeyUpdate({ set: { key } });
    const stored = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
    if (stored.length !== 1) throw new Error("Unverified persistence");
    const entry = readEntry(stored[0].value, key);
    return { ...entry, alreadyExists: stored[0].value !== value };
  } catch (error) { return safeError(error); }
}
