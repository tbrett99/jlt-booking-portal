import { TRPCError } from "@trpc/server";
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import type { HqState } from "./management-hq-engine";

export type HqActor = { id: number; role: string };
const MAX_STATE_BYTES = 16 * 1024 * 1024;
export function hqSampleEnabled() {
  // Production activation and live API configuration are deliberately not part of this milestone.
  return process.env.NODE_ENV !== "production" && process.env.HQ_SAMPLE_PILOT_DISABLED !== "1";
}
export function requireHqSampleEnabled() {
  if (!hqSampleEnabled()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The sample Management HQ pilot is disabled in this environment. No live connection is configured." });
}
export async function requireFreshHqSuperAdmin(db: any, actor: HqActor) {
  if (!actor || actor.role !== "super_admin" || !Number.isSafeInteger(actor.id) || actor.id < 1) throw new TRPCError({ code: "FORBIDDEN", message: "Active Super Admin access required." });
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Management HQ access could not be verified." });
  const rows = await db.select({ id: users.id, role: users.role, isActive: users.isActive, portalStatus: users.portalStatus }).from(users).where(eq(users.id, actor.id)).limit(2);
  if (rows.length !== 1 || rows[0].id !== actor.id || rows[0].role !== "super_admin" || rows[0].isActive !== true || rows[0].portalStatus !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Active Super Admin access required." });
}
async function lockHqActor(connection: PoolConnection, actor: HqActor) {
  const [rows] = await connection.execute<RowDataPacket[]>("SELECT id,role,isActive,portalStatus FROM users WHERE id = ? FOR UPDATE", [actor.id]);
  if (actor.role !== "super_admin" || rows.length !== 1 || rows[0].role !== "super_admin" || Number(rows[0].isActive) !== 1 || rows[0].portalStatus !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Active Super Admin access required." });
}
export type StoredHqSample = { state: HqState; stateVersion: number; updatedAt: Date };
/** Only this actor's synthetic sample namespace is writable; no arbitrary dataset or live mode input. */
export function createHqSampleStore(pool: Pool, actor: HqActor) {
  if (!Number.isSafeInteger(actor.id) || actor.id < 1) throw new Error("Invalid HQ sample actor");
  const datasetId = `sample:${actor.id}`;
  return {
    async read(): Promise<StoredHqSample | null> {
      const [rows] = await pool.execute<RowDataPacket[]>("SELECT state,stateVersion,updatedAt FROM management_hq_datasets WHERE datasetId = ? AND mode = 'sample' AND ownerUserId = ?", [datasetId, actor.id]);
      if (!rows.length) return null;
      if (rows.length !== 1) throw new Error("Invalid HQ sample generation");
      const serialized = typeof rows[0].state === "string" ? rows[0].state : JSON.stringify(rows[0].state);
      if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new Error("HQ sample state limit exceeded");
      return { state: JSON.parse(serialized), stateVersion: Number(rows[0].stateVersion), updatedAt: new Date(rows[0].updatedAt) };
    },
    async publish(expectedVersion: number | null, state: HqState): Promise<boolean> {
      requireHqSampleEnabled();
      const serialized = JSON.stringify(state);
      if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new Error("HQ sample state limit exceeded");
      if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= 2_147_483_646)) throw new Error("Invalid HQ sample version");
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await lockHqActor(connection, actor);
        requireHqSampleEnabled();
        let result: ResultSetHeader;
        if (expectedVersion === null) {
          [result] = await connection.execute<ResultSetHeader>("INSERT IGNORE INTO management_hq_datasets (datasetId,mode,ownerUserId,stateVersion,state,updatedAt) VALUES (?,'sample',?,1,?,UTC_TIMESTAMP(3))", [datasetId, actor.id, serialized]);
        } else {
          [result] = await connection.execute<ResultSetHeader>("UPDATE management_hq_datasets SET stateVersion = stateVersion + 1,state = ?,updatedAt = UTC_TIMESTAMP(3) WHERE datasetId = ? AND mode = 'sample' AND ownerUserId = ? AND stateVersion = ?", [serialized, datasetId, actor.id, expectedVersion]);
        }
        await connection.commit();
        return result.affectedRows === 1;
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
    },
  };
}
