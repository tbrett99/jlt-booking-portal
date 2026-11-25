/** Offline BUILD/TEST only. Never start the app, create a real DB/source, or use timers as a fake performance clock.
 * Run from the repository: env -i PATH="$PATH" HOME=/home/ubuntu node_modules/.bin/tsx scripts/management-hq-responsiveness-benchmark.ts --baseline
 * Use --current after integration; --case unpadded4000|padded4000|growing6000 selects one isolated case.
 * Renewal outputs are isolated from historical current/pre-renewal artifacts. --lease-case
 * keeps only lease/renewal-focused phase records; --realtime-db-clock is a separate
 * monotonic model-clock check, not a real DB/SLA measurement.
 * --smoke uses 100 retained records to check wiring only. Outputs are outside the repository.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { AsyncLocalStorage } from "node:async_hooks";
import * as net from "node:net";
import * as tls from "node:tls";
import * as http from "node:http";
import * as https from "node:https";
import * as dgram from "node:dgram";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const esbuild = require("esbuild");
const HEAD = "07c273b526bc4d55ddf274e82bac033b6a59ff09";
const args = process.argv.slice(2);
const baseline = !args.includes("--current");
const mode = baseline ? "baseline" : "current";
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = baseline
  ? "/home/ubuntu/hq-responsiveness-baseline-src"
  : project;
const guardLatencyAt = args.indexOf("--guard-latency-ms");
const guardLatencyMs =
  guardLatencyAt >= 0 ? Number(args[guardLatencyAt + 1]) : 0;
assert.ok(
  guardLatencyMs === 0 || guardLatencyMs === 1,
  "Guard latency must be 0 or 1 ms"
);
const leaseCase = args.includes("--lease-case");
const realtimeDbClock = args.includes("--realtime-db-clock");
const suffix = [
  "renewal",
  guardLatencyMs ? "guard1ms" : "",
  leaseCase ? "lease" : "",
  realtimeDbClock ? "realtime-db-clock" : "",
]
  .filter(Boolean)
  .join("-");
const output = `/home/ubuntu/hq-responsiveness-${mode}-${suffix}.json`;
const work = `/home/ubuntu/hq-responsiveness-${mode}-${suffix}-work`;
const cases = {
  unpadded4000: { retained: 4000, padding: 0 },
  padded4000: { retained: 4000, padding: 8000 },
  growing6000: { retained: 6000, padding: 4000 },
  smoke: { retained: 100, padding: 0 },
} as const;
type CaseName = keyof typeof cases;
const caseAt = args.indexOf("--case");
const caseName = (
  args.includes("--smoke") ? "smoke" : caseAt >= 0 ? args[caseAt + 1] : null
) as CaseName | null;

// Defense in depth: remove bindings, and deny network APIs before importing any HQ code.
for (const key of Object.keys(process.env))
  if (/DATABASE|^HQ_|TOKEN|SECRET|API_KEY|BINDING/.test(key))
    delete process.env[key];
const deny = () => {
  throw new Error("OFFLINE_BENCHMARK_NETWORK_DENIED");
};
(globalThis as any).fetch = deny;
for (const [moduleName, names] of [
  ["node:net", ["connect", "createConnection", "createServer"]],
  ["node:tls", ["connect", "createServer"]],
  ["node:http", ["request", "get", "createServer"]],
  ["node:https", ["request", "get", "createServer"]],
  ["node:dgram", ["createSocket"]],
] as const)
  for (const name of names) require(moduleName)[name] = deny;
// Hold namespaces above so the intent is visible even under bundlers; no sockets are constructed.
void [net, tls, http, https, dgram];
require("node:module").syncBuiltinESMExports();
mkdirSync(work, { recursive: true });

if (!caseName) {
  const result: any = {
    syntheticOnly: true,
    mode,
    baselineHead: HEAD,
    caveat:
      "Invented retained backfill fixtures. Actual HQ CPU and existing offline SQL model, not production root-cause evidence, a latency SLA, or real MySQL contention proof. Cases run serially in fresh processes. DB clock is fixed independently of real performance/heartbeat timers.",
    startedAt: new Date().toISOString(),
    cases: [],
  };
  for (const name of ["unpadded4000", "padded4000", "growing6000"]) {
    console.info(`CASE_START ${mode} ${name}`);
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        baseline ? "--baseline" : "--current",
        "--case",
        name,
        "--guard-latency-ms",
        String(guardLatencyMs),
        ...(leaseCase ? ["--lease-case"] : []),
        ...(realtimeDbClock ? ["--realtime-db-clock"] : []),
      ],
      {
        cwd: project,
        env: { PATH: process.env.PATH, HOME: "/home/ubuntu" },
        stdio: "inherit",
        timeout: 900000,
      }
    );
    if (child.status !== 0)
      throw new Error(
        `Case failed: ${name}; status=${child.status}; signal=${child.signal}`
      );
    result.cases.push(JSON.parse(readFileSync(`${work}/${name}.json`, "utf8")));
    writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  }
  result.finishedAt = new Date().toISOString();
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.info(`RESULT ${output}`);
} else {
  assert.ok(cases[caseName], "Unknown case");
  await runCase(caseName);
}

async function compileApi() {
  const names = [
    "ingestion",
    "storage-v2",
    "large-fixtures",
    "engine",
    "live-config",
    "live-store",
    "live-service",
    "storage-v2-pool",
  ];
  if (!baseline) names.push("cooperative");
  let entry = names
    .map(
      name =>
        `export * from ${JSON.stringify(`${sourceRoot}/server/management-hq-${name}.ts`)};`
    )
    .join("\n");
  if (!baseline)
    entry +=
      '\nexport { encodeHqLiveV2Sync as frozenBaselineEncode } from "/home/ubuntu/hq-responsiveness-baseline-src/server/management-hq-storage-v2.ts";';
  const tracked = new Set([
    "encodeHqLiveV2Sync",
    "decodeHqLiveV2Sync",
    "encodeHqLiveV2SyncAsync",
    "decodeHqLiveV2SyncAsync",
    "validateHqImplementedSyncState",
    "validateHqImplementedSyncStateAsync",
    "validContainer",
    "validContainerAsync",
    "validateHqWireEntity",
    "validateHqV2Chunk",
    "validateHqV2Manifest",
    "compactPart",
    "compactPartAsync",
    "hqJsonUtf8Bytes",
    "hqJsonUtf8BytesAsync",
    "digestJson",
    "digestJsonAsync",
    "canonicalBytesEqual",
    "canonicalBytesEqualAsync",
  ]);
  const bundle = `${work}/api-${caseName}.mjs`;
  const sourceHashes: Record<string, string> = {};
  await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: sourceRoot,
      sourcefile: "offline-benchmark-entry.ts",
      loader: "ts",
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: bundle,
    logLevel: "silent",
    plugins: [
      {
        name: "count-actual-boundaries-without-changing-source",
        setup(build: any) {
          build.onLoad({ filter: /management-hq-.*\.ts$/ }, (input: any) => {
            const raw = readFileSync(input.path, "utf8");
            if (
              input.path.startsWith(
                "/home/ubuntu/hq-responsiveness-baseline-src/"
              )
            ) {
              const manifest = readFileSync(
                "/home/ubuntu/hq-responsiveness-baseline-src/SHA256SUMS",
                "utf8"
              );
              const expected = manifest
                .split("\n")
                .find((line: string) => line.endsWith(`  ${input.path}`))
                ?.split("  ")[0];
              assert.equal(
                createHash("sha256").update(raw).digest("hex"),
                expected,
                "Frozen baseline source drift"
              );
            }
            sourceHashes[input.path] = createHash("sha256")
              .update(raw)
              .digest("hex");
            const ast = ts.createSourceFile(
              input.path,
              raw,
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.TS
            );
            const edits: { at: number; text: string }[] = [];
            const visit = (node: any) => {
              if (
                ts.isFunctionDeclaration(node) &&
                node.name &&
                node.body &&
                tracked.has(node.name.text)
              ) {
                const label =
                  input.path.split("/").pop() + ":" + node.name.text;
                const asyncFn = node.modifiers?.some(
                  (modifier: any) =>
                    modifier.kind === ts.SyntaxKind.AsyncKeyword
                );
                // A token per active call also supports cooperative awaits; async elapsed includes waiting.
                edits.push({
                  at: node.body.getStart(ast) + 1,
                  text: ` const __hqToken = globalThis.__hqBenchmarkProfile?.enter(${JSON.stringify(label)}, ${!!asyncFn}); try { `,
                });
                edits.push({
                  at: node.body.end - 1,
                  text: ` } finally { globalThis.__hqBenchmarkProfile?.leave(__hqToken); } `,
                });
              }
              ts.forEachChild(node, visit);
            };
            visit(ast);
            let contents = raw;
            for (const edit of edits.sort((a, b) => b.at - a.at))
              contents =
                contents.slice(0, edit.at) +
                edit.text +
                contents.slice(edit.at);
            return { contents, loader: "ts" };
          });
        },
      },
    ],
  });
  // Resolve only installed existing node_modules from this outside-project build directory.
  const { existsSync, symlinkSync } = require("node:fs");
  if (!existsSync(`${work}/node_modules`))
    symlinkSync(`${project}/node_modules`, `${work}/node_modules`);
  return { api: await import(pathToFileURL(bundle).href), sourceHashes };
}

function sleep(ms: number) {
  return new Promise<void>(done => setTimeout(done, ms));
}
function immediate() {
  return new Promise<void>(done => setImmediate(done));
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function runCase(name: CaseName) {
  const setupStart = performance.now();
  const { api: a, sourceHashes } = await compileApi();
  const options = cases[name];
  const fixture = await directFixture(a, options.retained, options.padding);
  const c = a.createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://offline-synthetic.probe.tld/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "offline-invented-key-" + "a".repeat(40),
    HQ_PORTAL_SYNC_TOKEN: "offline-invented-token-" + "b".repeat(40),
  });
  assert.equal(c.status().readEnabled, false);
  const fingerprint = c.sourceFingerprint();
  a.validateHqImplementedSyncState(
    fixture.state,
    a.HQ_LIVE_V2_VALIDATION_OPTIONS
  );
  const expandedBytes = a.hqJsonUtf8Bytes(
    fixture.state,
    a.HQ_LIVE_V2_EXPANDED_BYTES
  );
  const seed = a.encodeHqLiveV2Sync(fixture.state, fingerprint);
  const seedMap = new Map(
    seed.chunks.map((row: any) => [row.id, row.serialized])
  );
  const initial = a.decodeHqLiveV2Sync(seed.manifest, seedMap, fingerprint);
  assertExact(initial, fixture.state);
  const f = a.offlineHqV2Pool();
  const realtimeClockStartedAt = performance.now();
  const realtimeClockBase = f.now();
  assert.equal(a.HQ_LIVE_LEASE_SECONDS, 30, "Native ordinary lease cap drift");
  assert.equal(a.HQ_LIVE_MAX_LEASE_SECONDS, 95, "Native hard lease cap drift");
  assert.equal(
    a.HQ_LIVE_METHOD_START_DEADLINE_MS,
    75000,
    "Native method deadline drift"
  );
  assert.equal(
    a.HQ_LIVE_MAX_SOURCE_METHODS,
    25,
    "Native source method cap drift"
  );
  let realtimeClockElapsedMs = 0;
  if (realtimeDbClock) {
    // Advance the offline SQL model from monotonic elapsed time immediately before
    // each modeled SQL operation. Floor cumulative elapsed, not each individual
    // delta: preserve sub-ms remainder without ever passing fractional DB times.
    // Explicit deterministic advances below remain additive and are not reset.
    // This is deliberately not a real DB or SLA claim.
    f.setHook(() => {
      const elapsedMs = Math.floor(performance.now() - realtimeClockStartedAt);
      const delta = elapsedMs - realtimeClockElapsedMs;
      if (delta > 0) f.advance(delta);
      realtimeClockElapsedMs = elapsedMs;
    });
  }
  const control = {
    format: "hq-live-control-v1",
    version: 1,
    sourceFingerprint: fingerprint,
    fencingNumber: 0,
    leaseToken: null,
    leaseExpiresAtMs: null,
    leaseHardExpiresAtMs: null,
    nextDueAtMs: 0,
    consecutiveFailures: 0,
    lastAttemptAtMs: null,
    lastSuccessAtMs: null,
    lastPublishAtMs: null,
    lastErrorCode: null,
    stageStatus: "progress",
  };
  const row = (id: string, version: number, state: string) => ({
    datasetId: id,
    mode: "live",
    ownerUserId: 0,
    stateVersion: version,
    state,
    updatedAt: new Date(f.now()).toISOString(),
  });
  f.rows.set(
    a.HQ_LIVE_CONTROL_DATASET_ID,
    row(a.HQ_LIVE_CONTROL_DATASET_ID, 1, JSON.stringify(control))
  );
  f.rows.set(
    a.HQ_LIVE_SYNC_DATASET_ID,
    row(
      a.HQ_LIVE_SYNC_DATASET_ID,
      fixture.state.version,
      JSON.stringify(seed.manifest)
    )
  );
  for (const chunk of seed.chunks)
    f.rows.set(chunk.id, row(chunk.id, 1, chunk.serialized));
  const sqlSamples: any[] = [];
  const storeSamples: any[] = [];
  const fenceTimeline: any[] = [];
  const sqlClockSamples: any[] = [];
  const controlUpdateSamples: any[] = [];
  const updateModelTimes = new Map<number, number>();
  const storeContext = new AsyncLocalStorage<{ method: string }>();
  const dbClockSql =
    "SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS nowMs";
  const controlUpdateSql =
    "UPDATE management_hq_datasets SET stateVersion = ?,state = ?,updatedAt = UTC_TIMESTAMP(3) WHERE datasetId = ? AND mode = 'live' AND ownerUserId = 0 AND stateVersion = ?";
  // Observe the actual offline UPDATE timestamp from its draft row, never a
  // later f.now() value. This hook does not mutate model rows or the clock.
  f.setAfterHook((sql: string, values: any[], draft: Map<string, any>) => {
    if (sql === controlUpdateSql && values[2] === a.HQ_LIVE_CONTROL_DATASET_ID)
      updateModelTimes.set(
        f.trace.length - 1,
        Date.parse(draft.get(a.HQ_LIVE_CONTROL_DATASET_ID).updatedAt)
      );
  });
  let latestRenewFinishedAt: number | null = null;
  let guards = 0;
  const freshGuard = async () => {
    guards++;
    if (guardLatencyMs) await sleep(guardLatencyMs);
  };
  const rawStore = a.createHqLiveStore(f.pool, c, {
    cooperativeGuard: freshGuard,
  });
  const pool = f.pool as any;
  const getConnection = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const connection = await getConnection();
    let began = 0,
      lockAt: number | null = null,
      sqlMs = 0,
      queryCount = 0,
      controlLocks = 0;
    let transactionId: number | null = null;
    let lockedControl: any = null;
    let lastDbClockSample: any = null;
    const transactionUpdates: any[] = [];
    const begin = connection.beginTransaction.bind(connection);
    connection.beginTransaction = async () => {
      began = performance.now();
      return begin();
    };
    const execute = connection.execute.bind(connection);
    connection.execute = async (sql: string, values: any[]) => {
      const at = performance.now();
      queryCount++;
      const isControlLock =
        sql.endsWith("FOR UPDATE") &&
        values?.[0] === a.HQ_LIVE_CONTROL_DATASET_ID;
      if (isControlLock) {
        controlLocks++;
        lockAt ??= at;
      }
      const sinceLastRenewCompletionMs =
        latestRenewFinishedAt === null ? null : at - latestRenewFinishedAt;
      try {
        // The offline execute records its trace synchronously before resolving.
        // Capture its index immediately so overlapping awaited wrappers cannot
        // accidentally associate this response with a different SQL operation.
        const pending = execute(sql, values);
        const traceIndex = f.trace.length - 1;
        const traceEntry = f.trace[traceIndex];
        const result = await pending;
        const finishedAtMs = performance.now();
        transactionId = traceEntry.transaction;
        const observation = {
          traceIndex,
          transaction: transactionId,
          storeMethod: storeContext.getStore()?.method ?? "rawStore",
          atMs: at,
          finishedAtMs,
          sinceLastRenewCompletionMs,
        };
        if (sql === dbClockSql) {
          lastDbClockSample = {
            ...observation,
            databaseNowMs: Number(result[0]?.[0]?.nowMs),
          };
          sqlClockSamples.push(lastDbClockSample);
          fenceTimeline.push({
            point: "sqlDbClockSample",
            ...lastDbClockSample,
          });
        }
        if (isControlLock) {
          lockedControl = result[0]?.[0]
            ? JSON.parse(result[0][0].state)
            : null;
          fenceTimeline.push({
            point: "sqlControlLock",
            ...observation,
            control: clone(lockedControl),
          });
        }
        if (
          sql === controlUpdateSql &&
          values[2] === a.HQ_LIVE_CONTROL_DATASET_ID
        ) {
          const nextControl = JSON.parse(values[1]);
          const kind =
            lockedControl?.leaseToken === null &&
            nextControl.leaseToken !== null
              ? "grant"
              : lockedControl?.leaseToken !== null &&
                  nextControl.leaseToken === null
                ? "completion"
                : "renewal";
          const sample = {
            ...observation,
            kind,
            renewalSource:
              kind === "renewal"
                ? observation.storeMethod === "store.renew"
                  ? "ordinary"
                  : "cpu"
                : null,
            sql,
            args: clone(values),
            affectedRows: result[0]?.affectedRows,
            transactionOutcome: "pending",
            databaseNowMs: lastDbClockSample?.databaseNowMs ?? null,
            dbClockTraceIndex: lastDbClockSample?.traceIndex ?? null,
            updateDatabaseNowMs: updateModelTimes.get(traceIndex) ?? null,
            beforeControl: clone(lockedControl),
            control: nextControl,
          };
          controlUpdateSamples.push(sample);
          transactionUpdates.push(sample);
          fenceTimeline.push({ point: "sqlControlUpdate", ...sample });
          if (kind === "renewal" && sample.affectedRows === 1) {
            latestRenewFinishedAt = finishedAtMs;
            fenceTimeline.push({
              point: "sqlControlRenewalUpdate.completed",
              ...sample,
              atMs: finishedAtMs,
              sinceLastRenewCompletionMs: 0,
            });
          }
          // Same-transaction CPU work can renew repeatedly before committing.
          lockedControl = clone(nextControl);
        }
        return result;
      } finally {
        sqlMs += performance.now() - at;
      }
    };
    for (const method of ["commit", "rollback"]) {
      const fn = connection[method].bind(connection);
      connection[method] = async () => {
        const at = performance.now();
        try {
          const result = await fn();
          for (const sample of transactionUpdates)
            sample.transactionOutcome =
              method === "commit" ? "committed" : "rolledBack";
          if (
            method === "commit" &&
            transactionUpdates.some(
              (sample: any) =>
                sample.kind === "renewal" && sample.affectedRows === 1
            )
          ) {
            latestRenewFinishedAt = performance.now();
            fenceTimeline.push({
              point: "sqlControlRenewalTransaction.committed",
              transaction: transactionId,
              atMs: latestRenewFinishedAt,
              sinceLastRenewCompletionMs: 0,
            });
          }
          return result;
        } finally {
          sqlSamples.push({
            method,
            transaction: transactionId,
            transactionWallMs: performance.now() - began,
            modeledControlLockWallMs:
              lockAt === null ? 0 : performance.now() - lockAt,
            fakePoolSqlMs: sqlMs,
            fakePoolFinishMs: performance.now() - at,
            queryCount,
            controlLocks,
          });
        }
      };
    }
    return connection;
  };
  const store = new Proxy(rawStore, {
    get(target: any, key: string) {
      if (key === "fencedSyncStore")
        return (lease: any) => {
          const fenced = target.fencedSyncStore(lease);
          return wrapMethods(fenced, "fenced", storeSamples, storeContext);
        };
      const value = target[key];
      if (typeof value !== "function") return value;
      return async (...values: any[]) => {
        const at = performance.now();
        try {
          return await storeContext.run({ method: `store.${key}` }, () =>
            value.apply(target, values)
          );
        } finally {
          const ended = performance.now();
          if (
            key === "renew" ||
            key === "renewCooperative" ||
            key === "acquireInitialPublication" ||
            key === "acquire" ||
            key === "complete"
          )
            fenceTimeline.push({
              point: `store.${key}.completed`,
              atMs: ended,
              sinceLastRenewCompletionMs:
                latestRenewFinishedAt === null
                  ? null
                  : ended - latestRenewFinishedAt,
            });
          storeSamples.push({
            method: `store.${key}`,
            wallMs: ended - at,
            startedAtMs: at,
            finishedAtMs: ended,
          });
        }
      };
    },
  });
  const methods: Record<string, number> = {};
  const source = new Proxy(fixture.reader, {
    get(target: any, key: string) {
      const value = target[key];
      return typeof value !== "function"
        ? value
        : (...values: any[]) => {
            methods[key] = (methods[key] ?? 0) + 1;
            return value.apply(target, values);
          };
    },
  });
  const service = a.createHqLiveService({
    config: c,
    createStore: () => store,
    createReader: () => source,
    now: f.now,
    onlyInitialPublication: true,
    maxSourceMethods: 3,
    initialImportGuard: freshGuard,
  });
  const phases: any[] = [];
  const metrics: any = {
    syntheticOnly: true,
    mode,
    baselineHead: HEAD,
    name,
    retainedRecords: options.retained,
    retainedPages: options.retained / 100,
    paddingBytesPerBooking: options.padding,
    expandedBytes,
    compactBytes: seed.manifest.compactBytes,
    chunkCount: seed.chunks.length,
    setupWallMs: performance.now() - setupStart,
    setupRssBytes: process.memoryUsage().rss,
    sourceHashes,
    phases,
    measurement: realtimeDbClock
      ? "Monotonic elapsed performance.now/CPU/resource usage with an offline SQL model clock advanced before modeled SQL operations; this is not a real DB, MySQL contention, or SLA measurement."
      : "Real performance.now/CPU/resource usage and 10ms timer heartbeat; fake SQL clock fixed. Instrumented original validations, no skipped fences. Inclusive timings overlap; synchronous self timings subtract nested instrumented work. SQL model copies/clones rows and its overhead is included and reported, not real DB timing.",
    renewalMode: true,
    leaseCase,
    realtimeDbClock,
    dbClockModel: {
      baseDatabaseNowMs: realtimeClockBase,
      monotonicStartedAtMs: realtimeClockStartedAt,
      elapsedRounding: "cumulative integer floor milliseconds",
      explicitAdvancesAreAdditive: true,
    },
    nativeLeaseSeconds: a.HQ_LIVE_LEASE_SECONDS,
    nativeMaxLeaseSeconds: a.HQ_LIVE_MAX_LEASE_SECONDS,
  };
  console.info(
    `FIXTURE_READY ${mode} ${name} ${JSON.stringify({ expandedBytes, compactBytes: metrics.compactBytes, setupWallMs: metrics.setupWallMs })}`
  );
  const measure = async <T>(
    phase: string,
    operation: () => Promise<T> | T
  ): Promise<T> => {
    // Lease-focused runs still execute and validate codec work, but do not spend
    // output space or timing budget on the expected encode/decode phases.
    if (leaseCase && (phase === "encode" || phase === "decode"))
      return await operation();
    console.info(`PHASE_START ${name} ${phase}`);
    const profile: Record<string, any> = {};
    const stack: any[] = [];
    (globalThis as any).__hqBenchmarkProfile = {
      enter(label: string, asyncFn: boolean) {
        const token = { label, at: performance.now(), children: 0, asyncFn };
        stack.push(token);
        return token;
      },
      leave(token: any) {
        if (!token) return;
        const elapsed = performance.now() - token.at;
        const current = (profile[token.label] ??= {
          calls: 0,
          inclusiveMs: 0,
          syncSelfMs: 0,
          async: token.asyncFn,
        });
        current.calls++;
        current.inclusiveMs += elapsed;
        if (!token.asyncFn)
          current.syncSelfMs += Math.max(0, elapsed - token.children);
        const index = stack.lastIndexOf(token);
        if (index >= 0) stack.splice(index, 1);
        if (stack.length) stack[stack.length - 1].children += elapsed;
      },
    };
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    let last = performance.now(),
      heartbeatMaxGapMs = 0,
      heartbeatSamples = 0;
    let rssPeak = process.memoryUsage().rss;
    const beat = setInterval(() => {
      const now = performance.now();
      heartbeatMaxGapMs = Math.max(heartbeatMaxGapMs, now - last);
      last = now;
      heartbeatSamples++;
      rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    }, 10);
    await sleep(25);
    heartbeatMaxGapMs = 0;
    heartbeatSamples = 0;
    last = performance.now();
    const guardsFrom = guards;
    const timelineFrom = fenceTimeline.length;
    const clockFrom = sqlClockSamples.length;
    const updatesFrom = controlUpdateSamples.length;
    const sqlFrom = sqlSamples.length,
      storeFrom = storeSamples.length,
      traceFrom = f.trace.length;
    const cpu = process.cpuUsage(),
      usage = process.resourceUsage(),
      rssStart = process.memoryUsage().rss;
    const at = performance.now();
    let result: T;
    try {
      result = await operation();
    } finally {
      const wallMs = performance.now() - at,
        cpuDelta = process.cpuUsage(cpu);
      rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
      await immediate();
      await sleep(25);
      clearInterval(beat);
      delay.disable();
      delete (globalThis as any).__hqBenchmarkProfile;
      const sql = sqlSamples.slice(sqlFrom),
        trace = f.trace.slice(traceFrom);
      const record = {
        phase,
        authorityGuardCalls: guards - guardsFrom,
        authorityGuardInjectedLatencyMs: guardLatencyMs,
        fenceTimeline: fenceTimeline.slice(timelineFrom),
        sqlClockSamples: sqlClockSamples.slice(clockFrom),
        controlUpdates: controlUpdateSamples.slice(updatesFrom),
        maxRealElapsedSinceRenewCompletionAtSqlFenceMs: Math.max(
          0,
          ...fenceTimeline
            .slice(timelineFrom)
            .filter(
              (item: any) =>
                item.point === "sqlDbClockSample" ||
                item.point === "sqlControlLock"
            )
            .map((item: any) => item.sinceLastRenewCompletionMs ?? 0)
        ),
        wallMs,
        cpuUserMs: cpuDelta.user / 1000,
        cpuSystemMs: cpuDelta.system / 1000,
        heartbeatMaxGapMs,
        heartbeatMaxLatenessMs: Math.max(0, heartbeatMaxGapMs - 10),
        heartbeatSamples,
        eventLoopMaxDelayMs: delay.max / 1e6,
        eventLoopP99DelayMs: delay.percentile(99) / 1e6,
        rssStartBytes: rssStart,
        rssEndBytes: process.memoryUsage().rss,
        sampledRssPeakBytes: rssPeak,
        processLifetimeMaxRssBytes: process.resourceUsage().maxRSS * 1024,
        maxRssIncreaseBytes:
          (process.resourceUsage().maxRSS - usage.maxRSS) * 1024,
        sqlQueries: trace.length,
        sqlResponseBytes: trace.reduce(
          (sum: number, item: any) => sum + (item.responseBytes ?? 0),
          0
        ),
        controlForUpdateQueries: sql.reduce(
          (sum: number, item: any) => sum + item.controlLocks,
          0
        ),
        modeledLockMaxMs: Math.max(
          0,
          ...sql.map((item: any) => item.modeledControlLockWallMs)
        ),
        fakePoolSqlMs: sql.reduce(
          (sum: number, item: any) =>
            sum + item.fakePoolSqlMs + item.fakePoolFinishMs,
          0
        ),
        sqlTransactions: sql,
        storeCalls: storeSamples.slice(storeFrom),
        boundaries: profile,
      };
      phases.push(record);
      writeFileSync(
        `${work}/${name}.json`,
        JSON.stringify(metrics, null, 2) + "\n"
      );
      console.info(
        `PHASE_DONE ${name} ${phase} ${JSON.stringify({ wallMs, heartbeatMaxGapMs, eventLoopMaxDelayMs: record.eventLoopMaxDelayMs, modeledLockMaxMs: record.modeledLockMaxMs, sqlQueries: trace.length, rssPeak })}`
      );
    }
    return result!;
  };
  const encoded = await measure("encode", () =>
    !baseline && a.encodeHqLiveV2SyncAsync
      ? a.encodeHqLiveV2SyncAsync(
          fixture.state,
          fingerprint,
          a.createHqCpuCheckpoint()
        )
      : a.encodeHqLiveV2Sync(fixture.state, fingerprint)
  );
  assert.deepEqual(encoded, seed);
  const decoded = await measure("decode", () =>
    !baseline && a.decodeHqLiveV2SyncAsync
      ? a.decodeHqLiveV2SyncAsync(
          seed.manifest,
          seedMap,
          fingerprint,
          a.createHqCpuCheckpoint()
        )
      : a.decodeHqLiveV2Sync(seed.manifest, seedMap, fingerprint)
  );
  assertExact(decoded, fixture.state);
  const rowsBefore = clone(Array.from(f.rows));
  const snapshot = await measure("readSnapshot", () => store.readSnapshot());
  assertExact(snapshot.sync, fixture.state);
  const status = await measure("getStatus", () => service.getStatus());
  assert.deepEqual(status.progress, {
    kind: "backfill",
    phase: "bookings",
    pages: options.retained / 100,
    recordsRead: options.retained,
  });
  assert.equal(status.hasPublished, false);
  assert.equal(status.readEnabled, false);
  if (!baseline && typeof rawStore.readProgressSnapshot === "function") {
    assert.equal(status.payloadIntegrity, "unchecked");
    const observed = phases.find((item: any) => item.phase === "getStatus");
    assert.equal(observed.sqlQueries, 1);
    assert.equal(observed.controlForUpdateQueries, 0);
    assert.equal(observed.sqlTransactions.length, 0);
    assert.ok(
      !Object.keys(observed.boundaries).some((label: string) =>
        /decodeHq|validateHqImplemented/.test(label)
      )
    );
  }
  assert.deepEqual(Array.from(f.rows), rowsBefore);
  const invocation = await measure("boundedManualImportPage", () =>
    service.invoke()
  );
  assert.deepEqual(invocation, { status: "progress" });
  assert.deepEqual(methods, { status: 1, capabilities: 1, bookings: 1 });
  // In real-clock mode, the lengthy untimed byte-parity work can exceed the
  // honest 60-second cooldown. Test not-due now, not after that work.
  const beforeNotdue = clone(Array.from(f.rows));
  const notdue = await measure("notdueZeroSource", () => service.invoke());
  assert.deepEqual(notdue, { status: "notdue" });
  assert.deepEqual(Array.from(f.rows), beforeNotdue);
  assert.deepEqual(methods, { status: 1, capabilities: 1, bookings: 1 });
  // Exact expected next durable state is constructed outside timing, with the original synthetic reader.
  const nextPage = await fixture.reader.bookings({
    cursor: fixture.state.stage.cursor,
    limit: 100,
  });
  const expected = clone(fixture.state);
  expected.version++;
  expected.stage.pages++;
  expected.stage.recordsRead += nextPage.items.length;
  for (const entity of nextPage.items) {
    const key = `${entity.entityType}:${entity.entityId}`;
    expected.stage.entities[key] = {
      entity: clone(entity),
      canonicalPayload: a.canonicalHqJson(entity),
      absent: false,
    };
    expected.stage.feedKeys.booking.push(key);
  }
  expected.stage.cursor = null;
  expected.stage.phase = "business";
  expected.stage.pendingResumeCursor = nextPage.resumeCursor;
  const final = await rawStore.readSnapshot();
  assertExact(final.sync, expected);
  const expectedEncoded = a.encodeHqLiveV2Sync(expected, fingerprint);
  if (!baseline) {
    console.info(
      `EQUALITY_BASELINE_CODEC ${name} before+after exact bytes (outside timed phases)`
    );
    assert.deepEqual(seed, a.frozenBaselineEncode(fixture.state, fingerprint));
    assert.deepEqual(
      expectedEncoded,
      a.frozenBaselineEncode(expected, fingerprint)
    );
    metrics.crossVersionDurableBytesExact = true;
  }
  const durableArtifact = {
    before: seed,
    after: expectedEncoded,
    progress: {
      version: expected.version,
      pages: expected.stage.pages,
      recordsRead: expected.stage.recordsRead,
      phase: expected.stage.phase,
    },
  };
  const baselineDurablePath = `/home/ubuntu/hq-responsiveness-baseline-work/${name}-durable.json`;
  if (baseline) {
    writeFileSync(baselineDurablePath, JSON.stringify(durableArtifact) + "\n");
  } else if (require("node:fs").existsSync(baselineDurablePath)) {
    const previous = JSON.parse(readFileSync(baselineDurablePath, "utf8"));
    // Exact canonical payload and serialized chunk strings, not a hash-only proof.
    assert.deepEqual(durableArtifact, previous);
    metrics.crossVersionDurableBytesExact = true;
  }
  assert.deepEqual(
    JSON.parse(f.rows.get(a.HQ_LIVE_SYNC_DATASET_ID).state),
    expectedEncoded.manifest
  );
  const expectedIds = new Set([
    a.HQ_LIVE_CONTROL_DATASET_ID,
    a.HQ_LIVE_SYNC_DATASET_ID,
    ...expectedEncoded.chunks.map((item: any) => item.id),
  ]);
  assert.equal(f.rows.size, expectedIds.size);
  for (const chunk of expectedEncoded.chunks)
    assert.equal(f.rows.get(chunk.id).state, chunk.serialized);
  const exactControlUpdates = assertControlUpdateSamples(
    controlUpdateSamples,
    sqlClockSamples,
    f.trace,
    control,
    a.HQ_LIVE_CONTROL_DATASET_ID,
    controlUpdateSql,
    dbClockSql,
    a.HQ_LIVE_LEASE_SECONDS * 1000,
    a.HQ_LIVE_MAX_LEASE_SECONDS * 1000
  );
  const grantSqlNowMs = exactControlUpdates.grant.databaseNowMs;
  const completionSqlNowMs = exactControlUpdates.completion.databaseNowMs;
  assert.deepEqual(final.control, {
    ...control,
    // Control version is derived from the actual traced control-row UPDATEs;
    // renewal differences are never accepted via an arbitrary expected value.
    version: 1 + exactControlUpdates.count,
    fencingNumber: 1,
    lastAttemptAtMs: grantSqlNowMs,
    nextDueAtMs: completionSqlNowMs + 60000,
    stageStatus: "progress",
  });
  assert.equal(
    f.rows.get(a.HQ_LIVE_CONTROL_DATASET_ID).updatedAt,
    new Date(exactControlUpdates.completion.updateDatabaseNowMs).toISOString()
  );
  metrics.equality = {
    originalDecodeExact: true,
    readSnapshotExact: true,
    statusNoMutation: true,
    onePageDurableExact: true,
    manifestAndChunkBytesExact: true,
    controlExact: true,
    controlUpdatePayloadsExact: true,
    renewalOrdinaryAndHardDeadlinesExact: true,
    sqlClockValuesAreInteger: true,
    zeroSourceNotdueNoMutation: true,
    beforeManifestSha256: seed.manifest.sha256,
    afterManifestSha256: expectedEncoded.manifest.sha256,
    sourceMethods: methods,
    authorityChecks: guards,
    controlUpdateCount: exactControlUpdates.count,
    ordinaryRenewalUpdateCount: exactControlUpdates.ordinaryRenewals,
    cpuRenewalUpdateCount: exactControlUpdates.cpuRenewals,
    grantSqlNowMs,
    completionSqlNowMs,
    originalLeaseHardExpiresAtMs:
      exactControlUpdates.grant.control.leaseHardExpiresAtMs,
    finalProgress: {
      version: expected.version,
      phase: expected.stage.phase,
      pages: expected.stage.pages,
      recordsRead: expected.stage.recordsRead,
    },
    finalControl: {
      version: final.control.version,
      fencingNumber: final.control.fencingNumber,
      lastAttemptAtMs: final.control.lastAttemptAtMs,
      stageStatus: final.control.stageStatus,
      leaseToken: final.control.leaseToken,
      leaseExpiresAtMs: final.control.leaseExpiresAtMs,
      leaseHardExpiresAtMs: final.control.leaseHardExpiresAtMs,
      nextDueAtMs: final.control.nextDueAtMs,
    },
  };
  // Separate deterministic DB-clock lease check: no fake Date/performance/timers and no source.
  f.advance(60000);
  const acquired = await rawStore.acquire();
  assert.equal(acquired.status, "acquired");
  f.advance(30001);
  const expiryRows = clone(Array.from(f.rows));
  await assert.rejects(
    () =>
      rawStore.complete(acquired.lease, {
        status: "progress",
        delaySeconds: 60,
      }),
    (error: any) => error.code === "LEASE_LOST"
  );
  assert.deepEqual(Array.from(f.rows), expiryRows);
  metrics.equality.fakeDbClockExpiredHolderCompletionRejectedNoMutation = true;
  metrics.finishedAt = new Date().toISOString();
  writeFileSync(
    `${work}/${name}.json`,
    JSON.stringify(metrics, null, 2) + "\n"
  );
  if (!baseline) {
    const { existsSync } = require("node:fs");
    const combined = existsSync(output)
      ? JSON.parse(readFileSync(output, "utf8"))
      : { syntheticOnly: true, mode, baselineHead: HEAD, cases: [] };
    combined.cases = combined.cases.filter((item: any) => item.name !== name);
    combined.cases.push(metrics);
    writeFileSync(output, JSON.stringify(combined, null, 2) + "\n");
  }
  console.info(`CASE_DONE ${mode} ${name} equality=PASS ${work}/${name}.json`);
}

function assertControlUpdateSamples(
  updates: any[],
  clocks: any[],
  trace: any[],
  initialControl: any,
  controlId: string,
  updateSql: string,
  clockSql: string,
  ordinaryLeaseMs: number,
  hardLeaseMs: number
) {
  const tracedUpdates = trace.flatMap((item: any, traceIndex: number) =>
    item.sql === updateSql && item.args?.[2] === controlId
      ? [{ ...item, traceIndex }]
      : []
  );
  assert.equal(
    updates.length,
    tracedUpdates.length,
    "Every control UPDATE must be captured"
  );
  for (const sample of clocks) {
    assert.ok(
      Number.isSafeInteger(sample.databaseNowMs) && sample.databaseNowMs > 0,
      "SQL clock response must be an integer millisecond value"
    );
    assert.equal(trace[sample.traceIndex].sql, clockSql);
    assert.equal(trace[sample.traceIndex].transaction, sample.transaction);
  }
  let previous = clone(initialControl);
  let grant: any = null;
  let completion: any = null;
  let ordinaryRenewals = 0;
  let cpuRenewals = 0;
  for (const [index, update] of updates.entries()) {
    const traced = tracedUpdates[index];
    assert.equal(update.traceIndex, traced.traceIndex);
    assert.equal(update.transaction, traced.transaction);
    assert.deepEqual(
      update.args,
      traced.args,
      "Exact serialized UPDATE arguments"
    );
    assert.equal(
      update.affectedRows,
      1,
      "Control CAS must update exactly one row"
    );
    assert.equal(
      update.transactionOutcome,
      "committed",
      "No rollback may count as a durable update"
    );
    assert.deepEqual(
      update.beforeControl,
      previous,
      "Exact control state before each UPDATE"
    );
    assert.equal(update.args[0], previous.version + 1);
    assert.equal(update.args[3], previous.version);
    assert.equal(update.control.version, update.args[0]);
    assert.equal(update.args[1], JSON.stringify(update.control));
    const clock = clocks.find(
      (sample: any) => sample.traceIndex === update.dbClockTraceIndex
    );
    assert.ok(
      clock,
      "Control update needs an actual returned SQL clock response"
    );
    assert.equal(clock.transaction, update.transaction);
    assert.equal(clock.databaseNowMs, update.databaseNowMs);
    assert.ok(clock.traceIndex < update.traceIndex);
    assert.equal(
      clocks
        .filter(
          (sample: any) =>
            sample.transaction === update.transaction &&
            sample.traceIndex < update.traceIndex
        )
        .at(-1)?.traceIndex,
      clock.traceIndex,
      "Use the latest SQL clock in this transaction, not a later f.now()"
    );
    assert.ok(Number.isSafeInteger(update.updateDatabaseNowMs));
    assert.ok(update.updateDatabaseNowMs >= clock.databaseNowMs);
    const now = clock.databaseNowMs;
    let expectedControl: any;
    if (update.kind === "grant") {
      assert.equal(
        grant,
        null,
        "Exactly one lease grant in the successful one-page invocation"
      );
      assert.equal(previous.leaseToken, null);
      assert.ok(previous.nextDueAtMs <= now);
      assert.match(update.control.leaseToken, /^[a-f0-9-]{36}$/);
      assert.ok(
        update.storeMethod === "store.acquire" ||
          update.storeMethod === "store.acquireInitialPublication"
      );
      expectedControl = {
        ...previous,
        version: previous.version + 1,
        fencingNumber: previous.fencingNumber + 1,
        leaseToken: update.control.leaseToken,
        lastAttemptAtMs: now,
        leaseExpiresAtMs: now + ordinaryLeaseMs,
        leaseHardExpiresAtMs: now + hardLeaseMs,
        stageStatus: "running",
      };
      grant = update;
    } else {
      assert.ok(
        grant && !completion,
        "Only renewals and completion follow this grant"
      );
      assert.equal(previous.leaseToken, grant.control.leaseToken);
      assert.equal(previous.fencingNumber, grant.control.fencingNumber);
      assert.equal(
        previous.leaseHardExpiresAtMs,
        grant.databaseNowMs + hardLeaseMs
      );
      assert.ok(
        now < previous.leaseExpiresAtMs,
        "Never accept an expired ordinary holder"
      );
      assert.ok(
        now < previous.leaseHardExpiresAtMs,
        "Never accept an expired hard holder"
      );
      if (update.kind === "renewal") {
        expectedControl = {
          ...previous,
          version: previous.version + 1,
          leaseExpiresAtMs: Math.min(
            now + ordinaryLeaseMs,
            grant.databaseNowMs + hardLeaseMs
          ),
        };
        if (update.renewalSource === "ordinary") ordinaryRenewals++;
        else {
          assert.equal(update.renewalSource, "cpu");
          assert.ok(
            previous.leaseExpiresAtMs - now <= 20000,
            "CPU renewal is low-headroom only"
          );
          // CPU renewals retain the old deadline through UPDATE and the final
          // post-authority SQL sample; a replacement expiry cannot forgive it.
          const nextUpdateIndex =
            updates[index + 1]?.traceIndex ?? trace.length;
          const postClocks = clocks.filter(
            (sample: any) =>
              sample.transaction === update.transaction &&
              sample.traceIndex > update.traceIndex &&
              sample.traceIndex < nextUpdateIndex
          );
          assert.ok(
            postClocks.length >= 2,
            "CPU renewal must retain post-UPDATE and final SQL clock checks"
          );
          for (const sample of postClocks) {
            assert.ok(
              sample.databaseNowMs < previous.leaseExpiresAtMs,
              "CPU renewal crossed old ordinary expiry"
            );
            assert.ok(
              sample.databaseNowMs < previous.leaseHardExpiresAtMs,
              "CPU renewal crossed original hard expiry"
            );
          }
          cpuRenewals++;
        }
      } else {
        assert.equal(update.kind, "completion");
        assert.equal(update.storeMethod, "store.complete");
        expectedControl = {
          ...previous,
          version: previous.version + 1,
          stageStatus: "progress",
          nextDueAtMs: now + 60000,
          lastErrorCode: null,
          consecutiveFailures: 0,
          leaseToken: null,
          leaseExpiresAtMs: null,
          leaseHardExpiresAtMs: null,
        };
        completion = update;
      }
    }
    assert.deepEqual(
      update.control,
      expectedControl,
      "Exact grant/renewal/completion control payload"
    );
    previous = clone(expectedControl);
  }
  assert.ok(
    grant && completion,
    "Successful import requires SQL-sampled grant and completion"
  );
  return {
    count: tracedUpdates.length,
    ordinaryRenewals,
    cpuRenewals,
    grant,
    completion,
  };
}

function wrapMethods(
  target: any,
  prefix: string,
  samples: any[],
  context: AsyncLocalStorage<{ method: string }>
) {
  return new Proxy(target, {
    get(object, key: string) {
      const value = object[key];
      return typeof value !== "function"
        ? value
        : async (...args: any[]) => {
            const at = performance.now();
            try {
              return await context.run({ method: `${prefix}.${key}` }, () =>
                value.apply(object, args)
              );
            } finally {
              samples.push({
                method: `${prefix}.${key}`,
                wallMs: performance.now() - at,
              });
            }
          };
    },
  });
}
function assertExact(left: any, right: any) {
  // Equal records, tokens, membership, proofs and metadata, not merely equal hashes.
  // Null-prototype codec maps are semantically equivalent JSON objects.
  assert.deepEqual(
    JSON.parse(JSON.stringify(left)),
    JSON.parse(JSON.stringify(right))
  );
}
async function directFixture(a: any, retained: number, padding: number) {
  assert.equal(retained % 100, 0);
  const reader = a.createHqLargeSyntheticReader({
    bookingCount: retained + 100,
    paddingBytes: padding,
  });
  const { ready: _ready, ...metadata } = await reader.status();
  const stage: any = {
    kind: "backfill",
    phase: "bookings",
    basePublishedVersion: null,
    metadata,
    cursor: null,
    pendingResumeCursor: null,
    entities: {},
    seqProofs: {},
    feedKeys: { booking: [], business: [] },
    catalogueKeys: { booking: [], business: [] },
    cursors: [],
    pages: 0,
    recordsRead: 0,
    lastSeq: null,
  };
  for (let offset = 0; offset < retained; offset += 100) {
    const page = await reader.bookings(
      stage.cursor
        ? { cursor: stage.cursor, limit: 100 }
        : { generationId: metadata.generationId, limit: 100 }
    );
    for (const entity of page.items) {
      const key = `${entity.entityType}:${entity.entityId}`;
      stage.entities[key] = {
        entity,
        canonicalPayload: a.canonicalHqJson(entity),
        absent: false,
      };
      stage.feedKeys.booking.push(key);
    }
    stage.pages++;
    stage.recordsRead += page.items.length;
    stage.cursor = page.nextCursor;
    stage.pendingResumeCursor = page.resumeCursor;
    assert.notEqual(stage.cursor, null);
    stage.cursors.push(`bookings:${stage.cursor}`);
    if (stage.pages % 10 === 0) {
      console.info(`FIXTURE_BUILD ${retained} pages=${stage.pages}`);
      await immediate();
    }
  }
  return { reader, state: { version: retained / 100, published: null, stage } };
}
