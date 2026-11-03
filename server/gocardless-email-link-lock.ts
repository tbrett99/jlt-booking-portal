import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import { getRawDbPool } from "./db";

/** Server-scoped lock for the single-agent and bulk email-link paths. */
export async function withGoCardlessEmailLinkLock<T>(
  work: (database: any) => Promise<T>,
  dependencies?: { pool: any; makeDatabase: (connection: any) => any },
): Promise<T> {
  const pool = dependencies?.pool ?? await getRawDbPool();
  const connection = await pool.getConnection();
  let acquired = false;
  let destroyed = false;
  try {
    const [rows] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", ["jlt-gc-email-links", 10]);
    acquired = Number(rows?.[0]?.acquired) === 1;
    if (!acquired) throw new TRPCError({ code: "CONFLICT", message: "Another GoCardless link is being reviewed. No records have been changed; please try again shortly." });
    // work must await its transaction's commit before we release the lock.
    return await work(dependencies?.makeDatabase(connection) ?? drizzle(connection));
  } finally {
    if (acquired) {
      try {
        const [rows] = await connection.query("SELECT RELEASE_LOCK(?) AS released", ["jlt-gc-email-links"]);
        if (Number(rows?.[0]?.released) !== 1) throw new Error("Link lock release was not acknowledged");
      } catch {
        // A session-scoped lock must never return to the reusable pool.
        connection.destroy();
        destroyed = true;
      }
    }
    if (!destroyed) connection.release();
  }
}
