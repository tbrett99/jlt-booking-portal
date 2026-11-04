import { TRPCError } from "@trpc/server";
import { and, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { bookings } from "../drizzle/schema";
import { getRawDbPool } from "./db";

export type BookingReferenceField = "ptsRef" | "crmRef";
const LABELS = { ptsRef: "PTS", crmRef: "Orbit" } as const;

/** IDs remain strings: never drop leading zeroes or punctuation. */
export function normaliseBookingReference(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

export class BookingReferenceConflictError extends TRPCError {
  constructor(
    readonly field: BookingReferenceField,
    readonly reference: string,
    readonly conflictingBookingId: number,
  ) {
    super({ code: "CONFLICT", message: `${LABELS[field]} reference "${reference}" is already assigned to another booking. Check the reference or contact Support. No changes have been saved.` });
  }
}

/** Only staff/API callers may reveal the conflicting booking ID, never client/agent details. */
export function staffBookingReferenceError(error: unknown): never {
  if (error instanceof BookingReferenceConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: `${LABELS[error.field]} reference "${error.reference}" is already assigned to Booking #${error.conflictingBookingId}. Open that booking and check the reference before saving. No changes have been saved.` });
  }
  throw error;
}

export function bookingReferenceMatch(field: BookingReferenceField, reference: string) {
  if (field === "ptsRef") {
    const escaped = (normaliseBookingReference(reference) ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Historical imports may contain multiple PTS IDs in one comma-separated field.
    return sql`UPPER(${bookings.ptsRef}) REGEXP ${`(^|,)[[:space:]]*${escaped}[[:space:]]*(,|$)`}`;
  }
  return sql`UPPER(TRIM(${bookings[field]})) = ${normaliseBookingReference(reference)}`;
}

function referenceTokens(field: BookingReferenceField, value: string | null | undefined): string[] {
  if (field === "ptsRef") return (value ?? "").split(",").map(normaliseBookingReference).filter((ref): ref is string => ref !== null);
  const reference = normaliseBookingReference(value);
  return reference ? [reference] : [];
}

/** Must run inside the connection lock, before ANY writes in the transaction. */
export async function assertBookingReferencesAvailable(
  database: any,
  proposed: Partial<Record<BookingReferenceField, string | null | undefined>>,
  current?: { id: number; ptsRef?: string | null; crmRef?: string | null },
): Promise<Partial<Record<BookingReferenceField, string | null>>> {
  const result: Partial<Record<BookingReferenceField, string | null>> = {};
  for (const field of ["ptsRef", "crmRef"] as const) {
    if (proposed[field] === undefined) continue;
    const tokens = referenceTokens(field, proposed[field]);
    const reference = tokens.length ? tokens.join(", ") : null;
    const currentTokens = current ? referenceTokens(field, current[field]) : [];
    // Do not rewrite or block an unchanged historical duplicate on an unrelated edit.
    if (current && reference === (currentTokens.length ? currentTokens.join(", ") : null)) {
      result[field] = current[field] ?? null;
      continue;
    }
    if (reference !== null) {
      if (reference.length > 100) throw new TRPCError({ code: "BAD_REQUEST", message: `${LABELS[field]} reference must be 100 characters or fewer.` });
      for (const token of Array.from(new Set(tokens))) {
        if (currentTokens.includes(token)) continue;
        const predicate = bookingReferenceMatch(field, token);
        const matches = await database.select({ id: bookings.id }).from(bookings)
          .where(current ? and(predicate, ne(bookings.id, current.id)) : predicate)
          .orderBy(bookings.id).limit(1);
        if (matches[0]) throw new BookingReferenceConflictError(field, token, Number(matches[0].id));
      }
    }
    result[field] = reference;
    }
  return result;
}

/**
 * All Portal reference writers use one MySQL session lock, on the SAME connection
 * as their transaction. A check-then-save without this lock races across Railway
 * instances. Never silently fall back to an unlocked write.
 */
export async function withBookingReferenceLock<T>(
  work: (database: any) => Promise<T>,
  dependencies?: { pool: any; makeDatabase: (connection: any) => any },
): Promise<T> {
  const pool = dependencies?.pool ?? await getRawDbPool();
  const connection = await pool.getConnection();
  let acquired = false;
  let destroyed = false;
  try {
    const [rows] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", ["jlt-booking-references", 10]);
    acquired = Number(rows?.[0]?.acquired) === 1;
    if (!acquired) throw new TRPCError({ code: "CONFLICT", message: "Another booking reference is being saved. No changes have been saved; please try again shortly." });
    return await work(dependencies?.makeDatabase(connection) ?? drizzle(connection));
  } finally {
    if (acquired) {
      try {
        const [rows] = await connection.query("SELECT RELEASE_LOCK(?) AS released", ["jlt-booking-references"]);
        if (Number(rows?.[0]?.released) !== 1) throw new Error("Reference lock release not acknowledged");
      } catch {
        connection.destroy();
        destroyed = true;
      }
    }
    if (!destroyed) connection.release();
  }
}

/** Fail closed when an API identifier matches more than one historical booking. */
export async function findBookingByUniqueReference(database: any, field: BookingReferenceField, reference: string) {
  const matches = await database.select().from(bookings).where(bookingReferenceMatch(field, reference)).limit(2);
  if (matches.length > 1) throw new TRPCError({ code: "CONFLICT", message: `${LABELS[field]} reference matches multiple bookings. Use the Portal booking ID and have staff correct the duplicate references; no update has been applied.` });
  return matches[0];
}
