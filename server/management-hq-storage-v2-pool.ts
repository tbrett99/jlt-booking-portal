import type { Pool } from "mysql2/promise";

/** Independent offline SQL model. No connection, schema, provider, or environment access.
 * Serializes transactions locally; this is NOT proof of real MySQL locking semantics.
 */
export interface HqV2OfflineRow {
  datasetId: string;
  mode: string;
  ownerUserId: number;
  stateVersion: number;
  state: string;
  updatedAt: string;
}
export interface HqV2OfflineTrace {
  sql: string;
  args: any[];
  transaction: number;
  responseBytes?: number;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export type HqV2OfflineHook = (
  sql: string,
  args: any[],
  draft: Map<string, HqV2OfflineRow>
) => void;
function recorder() {
  const fn = (...args: any[]) => {
    fn.mock.calls.push(args);
  };
  fn.mock = { calls: [] as any[][] };
  return fn;
}
export function offlineHqV2Pool() {
  const rows = new Map<string, HqV2OfflineRow>();
  const trace: HqV2OfflineTrace[] = [];
  const commits = recorder(),
    rollbacks = recorder();
  let clock = Date.parse("2026-11-22T12:00:00Z");
  let tail = Promise.resolve(),
    transactionNumber = 0;
  let hook: HqV2OfflineHook | null = null;
  let afterHook: HqV2OfflineHook | null = null;
  let rowHook:
    | ((
        sql: string,
        args: any[],
        selected: HqV2OfflineRow[]
      ) => HqV2OfflineRow[])
    | null = null;
  const pool = {
    execute() {
      throw new Error("offline model requires an explicit transaction");
    },
    async getConnection() {
      const transaction = ++transactionNumber;
      let draft = new Map<string, HqV2OfflineRow>();
      let started = false,
        unlock = () => {};
      return {
        async beginTransaction() {
          const previous = tail;
          tail = new Promise<void>(resolve => {
            unlock = resolve;
          });
          await previous;
          started = true;
          draft = new Map(Array.from(rows, ([id, row]) => [id, clone(row)]));
        },
        async execute(sql: string, args: any[] = []) {
          if (!started) throw new Error("offline transaction not started");
          if (/\b(?:LIKE|REGEXP|TRUNCATE|ALTER|CREATE|DROP)\b/i.test(sql))
            throw new Error("offline model denies scans and schema operations");
          hook?.(sql, args, draft);
          const entry: HqV2OfflineTrace = {
            sql,
            args: clone(args),
            transaction,
          };
          trace.push(entry);
          let result: unknown;
          if (
            sql ===
            "SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS nowMs"
          ) {
            result = [[{ nowMs: clock }]];
          } else if (
            sql.startsWith(
              "SELECT datasetId,mode,ownerUserId,stateVersion,state,updatedAt FROM management_hq_datasets WHERE datasetId"
            )
          ) {
            const inBatch = sql.includes("datasetId IN (");
            if (inBatch) {
              if (
                args.length < 1 ||
                args.length > 4 ||
                sql !==
                  `SELECT datasetId,mode,ownerUserId,stateVersion,state,updatedAt FROM management_hq_datasets WHERE datasetId IN (${args.map(() => "?").join(",")}) FOR UPDATE`
              )
                throw new Error(
                  "offline model requires a bounded exact row batch"
                );
            } else if (
              sql !==
                "SELECT datasetId,mode,ownerUserId,stateVersion,state,updatedAt FROM management_hq_datasets WHERE datasetId = ?" &&
              sql !==
                "SELECT datasetId,mode,ownerUserId,stateVersion,state,updatedAt FROM management_hq_datasets WHERE datasetId = ? FOR UPDATE"
            ) {
              throw new Error("offline model requires exact IDs");
            }
            let selected = args.flatMap(id =>
              draft.has(id) ? [clone(draft.get(id)!)] : []
            );
            if (rowHook) selected = rowHook(sql, args, selected);
            entry.responseBytes = selected.reduce(
              (sum, row) => sum + Buffer.byteLength(row.state),
              0
            );
            result = [selected];
          } else if (
            sql ===
            "INSERT IGNORE INTO management_hq_datasets (datasetId,mode,ownerUserId,stateVersion,state,updatedAt) VALUES (?,'live',0,1,?,UTC_TIMESTAMP(3))"
          ) {
            if (draft.has(args[0])) result = [{ affectedRows: 0 }];
            else {
              draft.set(args[0], {
                datasetId: args[0],
                mode: "live",
                ownerUserId: 0,
                stateVersion: 1,
                state: args[1],
                updatedAt: new Date(clock).toISOString(),
              });
              result = [{ affectedRows: 1 }];
            }
          } else if (
            sql ===
            "UPDATE management_hq_datasets SET stateVersion = ?,state = ?,updatedAt = UTC_TIMESTAMP(3) WHERE datasetId = ? AND mode = 'live' AND ownerUserId = 0 AND stateVersion = ?"
          ) {
            const row = draft.get(args[2]);
            if (
              !row ||
              row.mode !== "live" ||
              row.ownerUserId !== 0 ||
              row.stateVersion !== args[3]
            )
              result = [{ affectedRows: 0 }];
            else {
              draft.set(args[2], {
                ...row,
                stateVersion: args[0],
                state: args[1],
                updatedAt: new Date(clock).toISOString(),
              });
              result = [{ affectedRows: 1 }];
            }
          } else if (
            sql ===
            "DELETE FROM management_hq_datasets WHERE datasetId = ? AND mode = 'live' AND ownerUserId = 0 AND stateVersion = 1"
          ) {
            const row = draft.get(args[0]);
            if (
              !row ||
              row.mode !== "live" ||
              row.ownerUserId !== 0 ||
              row.stateVersion !== 1
            )
              result = [{ affectedRows: 0 }];
            else {
              draft.delete(args[0]);
              result = [{ affectedRows: 1 }];
            }
          } else throw new Error("unsupported offline SQL");
          afterHook?.(sql, args, draft);
          return result;
        },
        async commit() {
          if (!started) throw new Error("offline transaction not started");
          rows.clear();
          draft.forEach((row, id) => rows.set(id, clone(row)));
          commits(transaction);
          started = false;
          unlock();
        },
        async rollback() {
          if (started) {
            rollbacks(transaction);
            started = false;
            unlock();
          }
        },
        release() {
          if (started) {
            started = false;
            unlock();
          }
        },
      };
    },
  };
  return {
    pool: pool as unknown as Pool,
    rows,
    trace,
    commits,
    rollbacks,
    now: () => clock,
    advance(ms: number) {
      clock += ms;
    },
    setHook(value: HqV2OfflineHook | null) {
      hook = value;
    },
    setAfterHook(value: HqV2OfflineHook | null) {
      afterHook = value;
    },
    setRowHook(value: typeof rowHook) {
      rowHook = value;
    },
  };
}
