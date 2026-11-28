import "dotenv/config";
import { createPool, type RowDataPacket } from "mysql2/promise";
import {
  createHqBackgroundCoordinator,
  hqBackgroundEnabled,
} from "../server/management-hq-background";
import { HqLiveError } from "../server/management-hq-live-store";
import { hqReadDeadline } from "../server/management-hq-read-deadline";

/** Dedicated Railway Cron start command. No web-server import, schema migration,
 * operational scheduler, setInterval, detached promise, or provider write. */
async function main() {
  if (!hqBackgroundEnabled()) {
    console.log("[HQ initial background] disabled; no import started.");
    return;
  }
  if (!process.env.DATABASE_URL) throw new HqLiveError("STORE_UNAVAILABLE");
  const pool = createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: 3,
    waitForConnections: true,
    queueLimit: 10,
    connectTimeout: 10000,
    timezone: "Z",
  });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const coordinator = createHqBackgroundCoordinator({
      pool,
      authorize: async actorId => {
        if (stopped) throw new HqLiveError("AUTH_DENIED");
        const [rows] = await hqReadDeadline(() =>
          pool.execute<RowDataPacket[]>(
            "SELECT id,role,isActive,portalStatus FROM users WHERE id = ? LIMIT 2",
            [actorId]
          )
        );
        if (
          stopped ||
          rows.length !== 1 ||
          Number(rows[0].id) !== actorId ||
          rows[0].role !== "super_admin" ||
          Number(rows[0].isActive) !== 1 ||
          rows[0].portalStatus !== "active"
        )
          throw new HqLiveError("AUTH_DENIED");
      },
    });
    const result = await coordinator.run();
    console.log(
      `[HQ initial background] ${result.status}; bounded batches: ${result.batches}.`
    );
    if (result.status === "failed") process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await pool.end();
  }
}
main().catch(() => {
  // Never log arbitrary database/provider errors, credential-bearing URIs, or data.
  console.error(
    "[HQ initial background] stopped; check protected Management HQ status."
  );
  process.exitCode = 1;
});
