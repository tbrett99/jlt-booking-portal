import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { HqLiveError } from "./management-hq-live-store";
import { hqReadDeadline } from "./management-hq-read-deadline";
import { HQ_BACKGROUND_STARTUP_DATABASE_URL } from "./management-hq-background-config";

// The pure config module is loaded with the router before application DB startup.
// A later DATABASE_URL change must not silently reuse or switch a reporting pool.
const startupDatabaseUrl = HQ_BACKGROUND_STARTUP_DATABASE_URL;
let pool: Pool | undefined;
export function assertHqBackgroundDatabaseBinding() {
  if (!startupDatabaseUrl || process.env.DATABASE_URL !== startupDatabaseUrl)
    throw new HqLiveError("STORE_UNAVAILABLE");
}
export function getHqBackgroundPool(): Pool {
  assertHqBackgroundDatabaseBinding();
  pool ??= createPool({
    uri: startupDatabaseUrl,
    connectionLimit: 3,
    waitForConnections: true,
    queueLimit: 10,
    connectTimeout: 10000,
    timezone: "Z",
  });
  assertHqBackgroundDatabaseBinding();
  return pool;
}
/** Fresh authority in the SAME reporting database, never a cached session or
 * an operational pool accidentally bound to an earlier DATABASE_URL. */
export async function requireHqBackgroundActor(
  reportingPool: Pool,
  actorId: number
) {
  assertHqBackgroundDatabaseBinding();
  if (!Number.isSafeInteger(actorId) || actorId < 1)
    throw new HqLiveError("AUTH_DENIED");
  let rows: RowDataPacket[];
  try {
    [rows] = await hqReadDeadline(() =>
      reportingPool.execute<RowDataPacket[]>(
        "SELECT id,role,isActive,portalStatus FROM users WHERE id = ? LIMIT 2",
        [actorId]
      )
    );
  } finally {
    assertHqBackgroundDatabaseBinding();
  }
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    Number(rows[0].id) !== actorId ||
    rows[0].role !== "super_admin" ||
    Number(rows[0].isActive) !== 1 ||
    rows[0].portalStatus !== "active"
  )
    throw new HqLiveError("AUTH_DENIED");
}
