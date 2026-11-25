import {
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
} from "./management-hq-live-store";

/** Offline SQL model only. JSON.parse here emulates SQL JSON projection; it is
 * not production application work and cannot establish real MySQL latency. */
export function projectHqProgressFixture(
  rows: ReadonlyMap<
    string,
    {
      datasetId: string;
      mode: string;
      ownerUserId: number;
      stateVersion: number;
      state: string;
    }
  >,
  now: number
) {
  const control = rows.get(HQ_LIVE_CONTROL_DATASET_ID);
  const root = rows.get(HQ_LIVE_SYNC_DATASET_ID);
  const json = root ? JSON.parse(root.state) : null;
  const scalar = (value: unknown, max: number) =>
    value === undefined
      ? null
      : (typeof value === "string" ? value : JSON.stringify(value)).slice(
          0,
          max
        );
  const kind = (value: unknown) =>
    value === undefined
      ? null
      : value === null
        ? "NULL"
        : Array.isArray(value)
          ? "ARRAY"
          : typeof value === "object"
            ? "OBJECT"
            : typeof value === "string"
              ? "STRING"
              : typeof value === "number"
                ? "INTEGER"
                : "BOOLEAN";
  return [
    {
      controlDatasetId: control?.datasetId ?? null,
      controlMode: control?.mode ?? null,
      controlOwnerUserId: control?.ownerUserId ?? null,
      controlStateVersion: control?.stateVersion ?? null,
      controlState:
        control && Buffer.byteLength(control.state) <= 4096
          ? control.state
          : null,
      syncDatasetId: root?.datasetId ?? null,
      syncMode: root?.mode ?? null,
      syncOwnerUserId: root?.ownerUserId ?? null,
      syncStateVersion: root?.stateVersion ?? null,
      syncFormat: scalar(json?.format, 65),
      syncFingerprint: scalar(json?.sourceFingerprint, 65),
      syncVersion: scalar(json?.sync?.version, 33),
      manifestVersion: scalar(json?.syncVersion, 33),
      publishedType: kind(json?.sync?.published),
      stageType: kind(json?.sync?.stage),
      stageKind: scalar(json?.sync?.stage?.kind, 33),
      stagePhase: scalar(json?.sync?.stage?.phase, 33),
      stagePages: scalar(json?.sync?.stage?.pages, 33),
      stageRecordsRead: scalar(json?.sync?.stage?.recordsRead, 33),
      databaseNowMs: now,
    },
  ];
}
