import type { Pool } from "mysql2/promise";
import { HQ_BACKGROUND_DATASET_ID } from "./management-hq-background-store";

/** Offline model only. No driver/runtime imports, env access, connection or schema work.
 * Exact-row mutex is a synthetic model, NOT acceptance of real MySQL gap/row locks.
 */
export interface HqBackgroundFixtureRow {
  datasetId: string;
  mode: string;
  ownerUserId: number;
  stateVersion: number;
  state: string;
  updatedAt: string;
}
export interface HqBackgroundFixtureTrace {
  sql: string;
  args: unknown[];
  connection: number;
}
export type HqBackgroundFixtureStage =
  | "connection"
  | "begin"
  | "select"
  | "clock"
  | "insert"
  | "update"
  | "commit"
  | "rollback"
  | "release";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function offlineHqBackgroundPool() {
  const rows = new Map<string, HqBackgroundFixtureRow>();
  const trace: HqBackgroundFixtureTrace[] = [];
  const stages: { stage: HqBackgroundFixtureStage; connection: number }[] = [];
  let clock = Date.parse("2026-11-28T10:48:00Z"),
    serial = 0,
    commits = 0,
    rollbacks = 0;
  let tail = Promise.resolve();
  let hook:
    | ((
        stage: HqBackgroundFixtureStage,
        connection: number
      ) => void | Promise<void>)
    | null = null;
  let afterHook:
    | ((
        stage: HqBackgroundFixtureStage,
        connection: number
      ) => void | Promise<void>)
    | null = null;
  let rowHook:
    | ((selected: Record<string, unknown>[]) => Record<string, unknown>[])
    | null = null;
  let fault: HqBackgroundFixtureStage | null = null;
  async function before(stage: HqBackgroundFixtureStage, connection: number) {
    stages.push({ stage, connection });
    await hook?.(stage, connection);
    if (fault === stage) {
      fault = null;
      throw new Error("synthetic provider detail must never escape");
    }
  }
  const pool = {
    async getConnection() {
      const connection = ++serial;
      await before("connection", connection);
      let started = false,
        locked = false,
        draft: HqBackgroundFixtureRow | undefined;
      let unlock: (() => void) | undefined;
      const finish = () => {
        started = false;
        locked = false;
        unlock?.();
        unlock = undefined;
      };
      async function lock() {
        if (locked) return;
        const previous = tail;
        tail = new Promise<void>(resolve => {
          unlock = resolve;
        });
        await previous;
        locked = true;
        draft = rows.has(HQ_BACKGROUND_DATASET_ID)
          ? clone(rows.get(HQ_BACKGROUND_DATASET_ID)!)
          : undefined;
      }
      await afterHook?.("connection", connection);
      return {
        async beginTransaction() {
          await before("begin", connection);
          if (started) throw new Error("synthetic transaction already started");
          started = true;
          await afterHook?.("begin", connection);
        },
        async execute(sql: string, args: unknown[] = []) {
          if (
            /\b(?:LIKE|REGEXP|TRUNCATE|ALTER|CREATE|DROP|DELETE)\b/i.test(sql)
          )
            throw new Error("synthetic denied SQL");
          trace.push({ sql, args: clone(args), connection });
          if (
            sql ===
            "SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS nowMs"
          ) {
            if (args.length) throw new Error("synthetic unexpected clock args");
            await before("clock", connection);
            const result = [[{ nowMs: clock }]];
            await afterHook?.("clock", connection);
            return result;
          }
          const observe =
            "SELECT clock.nowMs,job.datasetId,job.mode,job.ownerUserId,job.stateVersion,OCTET_LENGTH(CAST(job.state AS CHAR CHARACTER SET utf8mb4)) AS stateBytes,CASE WHEN OCTET_LENGTH(CAST(job.state AS CHAR CHARACTER SET utf8mb4)) <= 4096 THEN job.state ELSE NULL END AS state FROM (SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS nowMs) AS clock LEFT JOIN management_hq_datasets AS job ON job.datasetId = ?";
          if (sql === observe) {
            if (
              args.length !== 1 ||
              args[0] !== HQ_BACKGROUND_DATASET_ID ||
              started
            )
              throw new Error(
                "synthetic observation must be exact and nontransactional"
              );
            await before("select", connection);
            const row = rows.get(HQ_BACKGROUND_DATASET_ID);
            let selected: Record<string, unknown>[] = row
              ? [
                  {
                    ...clone(row),
                    nowMs: clock,
                    stateBytes: Buffer.byteLength(row.state),
                    state:
                      Buffer.byteLength(row.state) <= 4096 ? row.state : null,
                  },
                ]
              : [
                  {
                    nowMs: clock,
                    datasetId: null,
                    mode: null,
                    ownerUserId: null,
                    stateVersion: null,
                    stateBytes: null,
                    state: null,
                  },
                ];
            if (rowHook) selected = rowHook(selected);
            await afterHook?.("select", connection);
            return [selected];
          }
          const select =
            "SELECT datasetId,mode,ownerUserId,stateVersion,OCTET_LENGTH(CAST(state AS CHAR CHARACTER SET utf8mb4)) AS stateBytes,CASE WHEN OCTET_LENGTH(CAST(state AS CHAR CHARACTER SET utf8mb4)) <= 4096 THEN state ELSE NULL END AS state FROM management_hq_datasets WHERE datasetId = ?";
          if (sql === select || sql === select + " FOR UPDATE") {
            if (args.length !== 1 || args[0] !== HQ_BACKGROUND_DATASET_ID)
              throw new Error("synthetic only exact background row permitted");
            if (sql.endsWith(" FOR UPDATE")) {
              if (!started)
                throw new Error("synthetic lock requires transaction");
              await lock();
            }
            await before("select", connection);
            const row = locked ? draft : rows.get(HQ_BACKGROUND_DATASET_ID);
            let selected: Record<string, unknown>[] = row
              ? [
                  {
                    ...clone(row),
                    stateBytes: Buffer.byteLength(row.state),
                    state:
                      Buffer.byteLength(row.state) <= 4096 ? row.state : null,
                  },
                ]
              : [];
            if (rowHook) selected = rowHook(selected);
            await afterHook?.("select", connection);
            return [selected];
          }
          if (!started || !locked)
            throw new Error("synthetic write requires exact row lock");
          if (
            sql ===
            "INSERT INTO management_hq_datasets (datasetId,mode,ownerUserId,stateVersion,state,updatedAt) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))"
          ) {
            if (
              args.length !== 5 ||
              args[0] !== HQ_BACKGROUND_DATASET_ID ||
              args[1] !== "live" ||
              args[2] !== 0 ||
              args[3] !== 1 ||
              typeof args[4] !== "string"
            )
              throw new Error("synthetic invalid insert params");
            await before("insert", connection);
            if (draft) throw new Error("synthetic duplicate key");
            draft = {
              datasetId: HQ_BACKGROUND_DATASET_ID,
              mode: "live",
              ownerUserId: 0,
              stateVersion: 1,
              state: args[4],
              updatedAt: new Date(clock).toISOString(),
            };
            await afterHook?.("insert", connection);
            return [{ affectedRows: 1 }];
          }
          if (
            sql ===
            "UPDATE management_hq_datasets SET stateVersion = ?,state = ?,updatedAt = UTC_TIMESTAMP(3) WHERE datasetId = ? AND mode = ? AND ownerUserId = ? AND stateVersion = ?"
          ) {
            if (
              args.length !== 6 ||
              args[2] !== HQ_BACKGROUND_DATASET_ID ||
              args[3] !== "live" ||
              args[4] !== 0 ||
              typeof args[1] !== "string"
            )
              throw new Error("synthetic invalid update params");
            await before("update", connection);
            const matched =
              !!draft &&
              draft.mode === args[3] &&
              draft.ownerUserId === args[4] &&
              draft.stateVersion === args[5];
            if (matched)
              draft = {
                ...draft!,
                stateVersion: args[0] as number,
                state: args[1],
                updatedAt: new Date(clock).toISOString(),
              };
            await afterHook?.("update", connection);
            return [{ affectedRows: matched ? 1 : 0 }];
          }
          throw new Error("synthetic unsupported SQL");
        },
        async commit() {
          await before("commit", connection);
          if (!started) throw new Error("synthetic no transaction");
          if (locked && draft) rows.set(HQ_BACKGROUND_DATASET_ID, clone(draft));
          commits++;
          finish();
          await afterHook?.("commit", connection);
        },
        async rollback() {
          await before("rollback", connection);
          if (started) {
            rollbacks++;
            finish();
          }
          await afterHook?.("rollback", connection);
        },
        release() {
          stages.push({ stage: "release", connection });
          // Safety unlock even when rollback itself failed; no draft promotion.
          finish();
          if (fault === "release") {
            fault = null;
            throw new Error("synthetic release failure");
          }
        },
      };
    },
  };
  return {
    pool: pool as unknown as Pool,
    rows,
    trace,
    stages,
    now: () => clock,
    advance(ms: number) {
      clock += ms;
    },
    setClock(ms: number) {
      clock = ms;
    },
    commits: () => commits,
    rollbacks: () => rollbacks,
    setHook(value: typeof hook) {
      hook = value;
    },
    setAfterHook(value: typeof afterHook) {
      afterHook = value;
    },
    setRowHook(value: typeof rowHook) {
      rowHook = value;
    },
    failNext(stage: HqBackgroundFixtureStage) {
      fault = stage;
    },
  };
}
