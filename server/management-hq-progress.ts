import type { Pool, RowDataPacket } from "mysql2/promise";
import type { HqLiveConfig } from "./management-hq-live-config";
import { hqReadDeadline } from "./management-hq-read-deadline";
import {
  HqLiveError,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
  parseHqLiveControlRow,
  type HqLiveControl,
} from "./management-hq-live-store";

/** One coherent statement; bounded scalars/control only. No reporting payload,
 * chunks, transaction, FOR UPDATE, provider access, or validated-read claim. */
export const HQ_PROGRESS_SQL = `SELECT
 c.datasetId AS controlDatasetId,c.mode AS controlMode,c.ownerUserId AS controlOwnerUserId,c.stateVersion AS controlStateVersion,
 CASE WHEN OCTET_LENGTH(CAST(c.state AS CHAR))<=4096 THEN c.state ELSE NULL END AS controlState,
 s.datasetId AS syncDatasetId,s.mode AS syncMode,s.ownerUserId AS syncOwnerUserId,s.stateVersion AS syncStateVersion,
 LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.state,'$.format')),65) AS syncFormat,
 LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.state,'$.sourceFingerprint')),65) AS syncFingerprint,
 LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.state,'$.sync.version')),33) AS syncVersion,
 LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.state,'$.syncVersion')),33) AS manifestVersion,
 JSON_TYPE(JSON_EXTRACT(s.state,'$.sync.published')) AS publishedType,
 JSON_TYPE(JSON_EXTRACT(s.state,'$.sync.stage')) AS stageType,
 LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.state,'$.sync.stage.kind')),33) AS stageKind,
 LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.state,'$.sync.stage.phase')),33) AS stagePhase,
 LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.state,'$.sync.stage.pages')),33) AS stagePages,
 LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.state,'$.sync.stage.recordsRead')),33) AS stageRecordsRead,
 CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS databaseNowMs
 FROM (SELECT ? AS controlId,? AS syncId) a
 LEFT JOIN management_hq_datasets c ON c.datasetId=a.controlId
 LEFT JOIN management_hq_datasets s ON s.datasetId=a.syncId`;

export interface HqProgressSnapshot {
  payloadIntegrity: "unchecked";
  control: HqLiveControl | null;
  stateVersion: number | null;
  hasPublished: boolean;
  progress: {
    kind: "backfill" | "catchup";
    phase: string;
    pages: number;
    recordsRead: number;
  } | null;
  databaseNowMs: number;
}
const bad = (): never => {
  throw new HqLiveError("INVALID_PERSISTED_STATE");
};
function number(value: unknown, minimum: number, maximum: number): number {
  if (
    !(
      typeof value === "number" ||
      (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value))
    )
  )
    return bad();
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum || n > maximum) return bad();
  return n;
}
export async function readHqProgressSnapshot(
  pool: Pool,
  config: HqLiveConfig
): Promise<HqProgressSnapshot> {
  const original = config.sourceFingerprint();
  const check = () => {
    const status = config.status();
    const current = config.sourceFingerprint();
    if (
      !status.configured ||
      !status.syncEnabled ||
      status.readEnabled ||
      !current
    )
      throw new HqLiveError("CONFIG_INVALID");
    if (current !== original) throw new HqLiveError("SOURCE_BINDING_CHANGED");
  };
  check();
  let rows: RowDataPacket[];
  try {
    [rows] = await hqReadDeadline(() =>
      pool.execute<RowDataPacket[]>(HQ_PROGRESS_SQL, [
        HQ_LIVE_CONTROL_DATASET_ID,
        HQ_LIVE_SYNC_DATASET_ID,
      ])
    );
  } catch {
    check();
    throw new HqLiveError("STORE_UNAVAILABLE");
  }
  check();
  if (rows.length !== 1) return bad();
  const row = rows[0];
  const databaseNowMs = number(row.databaseNowMs, 1, Number.MAX_SAFE_INTEGER);
  let control: HqLiveControl | null = null;
  if (row.controlDatasetId !== null) {
    control = parseHqLiveControlRow({
      datasetId: row.controlDatasetId,
      mode: row.controlMode,
      ownerUserId: row.controlOwnerUserId,
      stateVersion: row.controlStateVersion,
      state: row.controlState,
    } as RowDataPacket);
    if (control.sourceFingerprint !== original)
      throw new HqLiveError("SOURCE_BINDING_CHANGED");
  }
  let stateVersion: number | null = null;
  let hasPublished = false;
  let progress: HqProgressSnapshot["progress"] = null;
  if (row.syncDatasetId !== null) {
    if (
      !control ||
      row.syncDatasetId !== HQ_LIVE_SYNC_DATASET_ID ||
      row.syncMode !== "live" ||
      number(row.syncOwnerUserId, 0, 0) !== 0 ||
      !["hq-live-sync-v1", "hq-live-sync-manifest-v2"].includes(row.syncFormat)
    )
      return bad();
    if (row.syncFingerprint !== original)
      throw new HqLiveError("SOURCE_BINDING_CHANGED");
    stateVersion = number(row.syncStateVersion, 1, 2_147_483_646);
    if (number(row.syncVersion, 1, 2_147_483_646) !== stateVersion)
      return bad();
    if (
      row.syncFormat === "hq-live-sync-manifest-v2" &&
      number(row.manifestVersion, 1, 2_147_483_646) !== stateVersion
    )
      return bad();
    if (!["NULL", "OBJECT"].includes(row.publishedType)) return bad();
    if (!["NULL", "OBJECT"].includes(row.stageType)) return bad();
    hasPublished = row.publishedType === "OBJECT";
    if (row.stageType === "OBJECT") {
      if (
        !["backfill", "catchup"].includes(row.stageKind) ||
        ![
          "bookings",
          "business",
          "catalogue_booking",
          "catalogue_business",
          "changes",
          "finish",
        ].includes(row.stagePhase) ||
        (row.stageKind === "backfill" && row.stagePhase === "changes") ||
        (row.stageKind === "catchup" &&
          !["changes", "finish"].includes(row.stagePhase))
      )
        return bad();
      progress = {
        kind: row.stageKind,
        phase: row.stagePhase,
        pages: number(row.stagePages, 0, 1000),
        recordsRead: number(row.stageRecordsRead, 0, 100000),
      };
    }
  }
  check();
  return {
    payloadIntegrity: "unchecked",
    control,
    stateVersion,
    hasPublished,
    progress,
    databaseNowMs,
  };
}
