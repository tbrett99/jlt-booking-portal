import { TRPCError } from "@trpc/server";
import type { RowDataPacket } from "mysql2/promise";
import { getRawDbPool } from "./db";

type MergeIdentityRow = RowDataPacket & { sourceUserId: number; primaryUserId: number };

/** Read only the additive table: old users projections remain migration-safe. */
async function readMergeIdentities(): Promise<Map<number, number>> {
  const pool = await getRawDbPool();
  let rows: MergeIdentityRow[];
  try {
    [rows] = await pool.execute<MergeIdentityRow[]>(
      "SELECT sourceUserId, primaryUserId FROM agent_record_merges",
    );
  } catch (error) {
    // Rolling deployment only. Connection/permission/column errors must fail closed.
    if (error && typeof error === "object" && "code" in error && error.code === "ER_NO_SUCH_TABLE") {
      return new Map();
    }
    throw error;
  }
  const targets = new Map<number, number>();
  for (const row of rows) {
    const source = Number(row.sourceUserId);
    const primary = Number(row.primaryUserId);
    if (!Number.isSafeInteger(source) || source <= 0 || !Number.isSafeInteger(primary) || primary <= 0 || targets.has(source)) {
      throw new Error("Invalid agent merge identity history");
    }
    targets.set(source, primary);
  }
  // Invalid history must not silently become a canonical identity or login.
  const checked = new Set<number>();
  for (const source of Array.from(targets.keys())) {
    const path = new Set<number>();
    let current = source;
    while (targets.has(current) && !checked.has(current)) {
      if (path.has(current)) throw new Error("Cycle in agent merge identity history");
      path.add(current);
      current = targets.get(current)!;
    }
    path.forEach((id) => checked.add(id));
  }
  return targets;
}

/** Final primary for historical reads only; null means this ID is not archived. Never use for login. */
export async function getAgentMergeTarget(id: number): Promise<number | null> {
  const targets = await readMergeIdentities();
  if (!targets.has(id)) return null;
  let current = id;
  while (targets.has(current)) current = targets.get(current)!;
  return current;
}

/** Reject the original ID rather than transferring credentials/session authority to its primary. */
export async function assertAgentNotMerged(id: number): Promise<void> {
  if (await getAgentMergeTarget(id) !== null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This agent record is a merged archive and cannot be used or modified." });
  }
}

export async function getArchivedAgentMergeIds(): Promise<number[]> {
  return Array.from((await readMergeIdentities()).keys());
}

/** Primary plus every source whose historical chain terminates at it, for read-only history. */
export async function getAgentMergeHistoryIds(primary: number): Promise<number[]> {
  const targets = await readMergeIdentities();
  const ids = [primary];
  for (const source of Array.from(targets.keys())) {
    let current = source;
    while (targets.has(current)) current = targets.get(current)!;
    if (current === primary) ids.push(source);
  }
  return ids;
}
