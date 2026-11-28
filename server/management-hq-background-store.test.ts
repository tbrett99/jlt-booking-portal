import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { HqLiveError } from "./management-hq-live-store";
import {
  createHqBackgroundStore,
  HQ_BACKGROUND_DATASET_ID,
  HQ_BACKGROUND_RUN_MS,
  HQ_BACKGROUND_LEASE_MS,
  type HqBackgroundJob,
  type HqBackgroundOutcome,
} from "./management-hq-background-store";
import { offlineHqBackgroundPool } from "./management-hq-background-fixture";

const BINDING = "a".repeat(64),
  FOREIGN = "b".repeat(64);
const AUTH = async () => {};
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function setup() {
  const f = offlineHqBackgroundPool();
  return { f, store: createHqBackgroundStore(f.pool) };
}
function saved(f: ReturnType<typeof offlineHqBackgroundPool>) {
  return copy(Array.from(f.rows));
}
function originalHash(f: ReturnType<typeof offlineHqBackgroundPool>) {
  return createHash("sha256")
    .update(
      JSON.stringify(saved(f).filter(([id]) => id !== HQ_BACKGROUND_DATASET_ID))
    )
    .digest("hex");
}
function replace(
  f: ReturnType<typeof offlineHqBackgroundPool>,
  patch: Partial<HqBackgroundJob>
) {
  const row = f.rows.get(HQ_BACKGROUND_DATASET_ID)!;
  const job = { ...JSON.parse(row.state), ...patch };
  row.state = JSON.stringify(job);
  row.stateVersion = job.version;
  return job as HqBackgroundJob;
}
async function running(s: ReturnType<typeof setup>) {
  await s.store.start(7, BINDING, AUTH);
  const claim = await s.store.claim(BINDING, AUTH);
  if (claim.kind !== "claimed")
    throw new Error("synthetic claimed job expected");
  return claim.job;
}
async function safeFailure(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    e => e
  );
  expect(error).toBeInstanceOf(HqLiveError);
  expect(error).toMatchObject({ code, message: code });
  expect(String(error)).not.toContain("synthetic provider");
}
function originals(f: ReturnType<typeof offlineHqBackgroundPool>) {
  for (const id of [
    "live:company:orbit:v1:sync",
    "live:company:orbit:v1:control",
    "live:company:orbit:v2:chunk:synthetic",
  ]) {
    f.rows.set(id, {
      datasetId: id,
      mode: "live",
      ownerUserId: 0,
      stateVersion: 71,
      state: "synthetic original bytes untouched",
      updatedAt: "2026-11-28T10:00:00Z",
    });
  }
  return saved(f);
}

describe("durable initial background job: synthetic SQL only", () => {
  it.each([
    ["ER_LOCK_DEADLOCK", 1213],
    ["ER_DUP_ENTRY", 1062],
  ])(
    "one proven %s rolls back and starts at most one fresh job-only transaction",
    async (code, errno) => {
      const { f, store } = setup();
      let inserts = 0;
      f.setHook(stage => {
        if (stage === "insert" && ++inserts === 1)
          throw Object.assign(new Error("private SQL text"), { code, errno });
      });
      expect((await store.start(7, BINDING, AUTH)).status).toBe("queued");
      expect(inserts).toBe(2);
      expect(f.rows.size).toBe(1);
      expect(f.rollbacks()).toBe(1);
      expect(f.commits()).toBe(1);
    }
  );
  it("repeated proven contention is bounded to two transactions, not a retry loop", async () => {
    const { f, store } = setup();
    f.setHook(stage => {
      if (stage === "insert")
        throw Object.assign(new Error("private"), {
          code: "ER_LOCK_DEADLOCK",
          errno: 1213,
        });
    });
    await safeFailure(store.start(7, BINDING, AUTH), "STORE_UNAVAILABLE");
    expect(f.trace.filter(t => t.sql.startsWith("INSERT"))).toHaveLength(2);
    expect(f.rows.size).toBe(0);
    expect(f.rollbacks()).toBe(2);
  });
  it.each(["authority", "rollback", "commit"])(
    "does not retry contention when %s is denied, failed or uncertain",
    async kind => {
      const { f, store } = setup();
      let allowed = true;
      f.setHook(stage => {
        if (stage === (kind === "commit" ? "commit" : "insert")) {
          if (kind === "authority") allowed = false;
          if (kind === "rollback") f.failNext("rollback");
          throw Object.assign(new Error("private"), {
            code: "ER_LOCK_DEADLOCK",
            errno: 1213,
          });
        }
      });
      await safeFailure(
        store.start(7, BINDING, async () => {
          if (!allowed) throw new HqLiveError("AUTH_DENIED");
        }),
        kind === "authority" ? "AUTH_DENIED" : "STORE_UNAVAILABLE"
      );
      expect(f.trace.filter(t => t.sql.startsWith("INSERT"))).toHaveLength(1);
      expect(f.rows.size).toBe(0);
    }
  );
  it.each([
    ["ER_LOCK_DEADLOCK", 1062],
    ["ER_DUP_ENTRY", 1213],
    ["ER_LOCK_WAIT_TIMEOUT", 1205],
  ])("does not retry unproven code/errno pair %s/%s", async (code, errno) => {
    const { f, store } = setup();
    f.setHook(stage => {
      if (stage === "insert")
        throw Object.assign(new Error("private"), { code, errno });
    });
    await safeFailure(store.start(7, BINDING, AUTH), "STORE_UNAVAILABLE");
    expect(f.trace.filter(t => t.sql.startsWith("INSERT"))).toHaveLength(1);
  });
  it("reads absent metadata without transaction, write, reporting tree or source access", async () => {
    const { f, store } = setup();
    const before = originals(f);
    expect(await store.read()).toEqual({ job: null, databaseNowMs: f.now() });
    expect(saved(f)).toEqual(before);
    expect(f.commits()).toBe(0);
    expect(f.trace).toHaveLength(1);
    expect(f.trace.every(t => t.sql.startsWith("SELECT"))).toBe(true);
    expect(f.trace[0].args).toEqual([HQ_BACKGROUND_DATASET_ID]);
    expect(f.trace[0].sql).not.toContain("FOR UPDATE");
    expect(f.trace[0].sql).toContain("<= 4096");
    expect(f.trace[0].sql).toContain("CURRENT_TIMESTAMP(3)");
  });
  it("creates the exact fixed row, 24-hour window and counters without touching originals", async () => {
    const { f, store } = setup();
    const before = originals(f),
      now = f.now();
    const job = await store.start(7, BINDING, AUTH);
    expect(job).toEqual({
      format: "hq-initial-background-v1",
      version: 1,
      sourceBinding: BINDING,
      actorId: 7,
      status: "queued",
      startedAtMs: now,
      updatedAtMs: now,
      expiresAtMs: now + HQ_BACKGROUND_RUN_MS,
      attempts: 0,
      consecutiveErrors: 0,
      nextDueAtMs: now,
      token: null,
      leaseUntilMs: null,
      lastErrorCode: null,
    });
    expect((await store.read()).job).toEqual(job);
    expect(saved(f).filter(([id]) => id !== HQ_BACKGROUND_DATASET_ID)).toEqual(
      before
    );
    const writes = f.trace.filter(t => /^(INSERT|UPDATE)/.test(t.sql));
    expect(writes).toHaveLength(1);
    expect(writes[0].args).toEqual([
      HQ_BACKGROUND_DATASET_ID,
      "live",
      0,
      1,
      JSON.stringify(job),
    ]);
    expect(Buffer.byteLength(JSON.stringify(job))).toBeLessThanOrEqual(4096);
    expect(f.trace.find(t => t.sql.endsWith("FOR UPDATE"))?.args).toEqual([
      HQ_BACKGROUND_DATASET_ID,
    ]);
    expect(
      f.trace.filter(t => t.sql.includes("CURRENT_TIMESTAMP(3)")).length
    ).toBeGreaterThanOrEqual(2);
    job.actorId = 999;
    expect((await store.read()).job?.actorId).toBe(7);
  });
  it("coherent metadata remains nonblocking on a separate connection while the exact job row is locked", async () => {
    const { f, store } = setup();
    const started = await store.start(7, BINDING, AUTH);
    let observed: HqBackgroundJob | null = null;
    f.setAfterHook(async stage => {
      if (stage === "update")
        observed = (await createHqBackgroundStore(f.pool).read()).job;
    });
    const paused = await store.pause(AUTH);
    expect(observed).toEqual(started); // uncommitted writer draft never leaks
    expect(paused?.status).toBe("paused");
  });
  it("all lifecycle operations and rollback preserve original root/control/chunk fixture hashes", async () => {
    const { f, store } = setup();
    originals(f);
    const hash = originalHash(f);
    await store.start(7, BINDING, AUTH);
    let c = await store.claim(BINDING, AUTH);
    await store.settle(
      c.job!.token!,
      { status: "queued", errorCode: "TIMEOUT" },
      AUTH
    );
    await store.pause(AUTH);
    await store.start(8, FOREIGN, AUTH);
    c = await store.claim(FOREIGN, AUTH);
    const before = saved(f);
    let denied = false;
    f.setAfterHook(stage => {
      if (stage === "update") denied = true;
    });
    await safeFailure(
      store.settle(c.job!.token!, { status: "completed" }, async () => {
        if (denied) throw new HqLiveError("CONFIG_INVALID");
      }),
      "CONFIG_INVALID"
    );
    expect(saved(f)).toEqual(before);
    expect(originalHash(f)).toBe(hash);
    expect(
      f.trace
        .filter(t => t.sql.startsWith("UPDATE"))
        .every(t => t.args[2] === HQ_BACKGROUND_DATASET_ID)
    ).toBe(true);
  });
  it("two independent connections starting together produce one original run", async () => {
    const { f, store } = setup(),
      other = createHqBackgroundStore(f.pool);
    const [a, b] = await Promise.all([
      store.start(7, BINDING, AUTH),
      other.start(9, BINDING, AUTH),
    ]);
    expect(a).toEqual(b);
    expect(a.actorId).toBe(7);
    expect(f.trace.filter(t => t.sql.startsWith("INSERT"))).toHaveLength(1);
    expect(
      new Set(f.stages.filter(t => t.stage === "begin").map(t => t.connection))
        .size
    ).toBe(2);
  });
  it("claim has one winner across independent connections and uses a fixed non-renewable 10-minute lease", async () => {
    const { f, store } = setup(),
      other = createHqBackgroundStore(f.pool);
    const start = await store.start(7, BINDING, AUTH);
    f.advance(10);
    const [a, b] = await Promise.all([
      store.claim(BINDING, AUTH),
      other.claim(BINDING, AUTH),
    ]);
    expect(a.kind).toBe("claimed");
    expect(b.kind).toBe("idle");
    expect(a.job).toEqual(b.job);
    expect(a.job).toMatchObject({
      status: "running",
      attempts: 1,
      version: 2,
      startedAtMs: start.startedAtMs,
      expiresAtMs: start.expiresAtMs,
    });
    expect(a.job!.leaseUntilMs).toBe(f.now() + HQ_BACKGROUND_LEASE_MS);
    expect(a.job!.token).toMatch(/^[0-9a-f-]{36}$/);
    const before = saved(f);
    f.advance(100);
    expect(await store.start(10, BINDING, AUTH)).toEqual(a.job);
    expect((await store.claim(BINDING, AUTH)).kind).toBe("idle");
    expect(saved(f)).toEqual(before);
  });
  it("an absent/nonactive claim is idle and does not create a job", async () => {
    const { f, store } = setup();
    expect(await store.claim(BINDING, AUTH)).toEqual({
      kind: "idle",
      job: null,
    });
    await store.start(7, BINDING, AUTH);
    await store.pause(AUTH);
    const before = saved(f);
    expect(await store.claim(FOREIGN, AUTH)).toEqual({
      kind: "idle",
      job: (await store.read()).job,
    });
    expect(saved(f)).toEqual(before);
  });
  it("same-binding active starts are idempotent and foreign active starts/claims fail closed", async () => {
    const { f, store } = setup();
    const start = await store.start(7, BINDING, AUTH);
    const before = saved(f);
    f.advance(60_000);
    expect(await store.start(999, BINDING, AUTH)).toEqual(start);
    await safeFailure(store.start(999, FOREIGN, AUTH), "CONFIG_INVALID");
    await safeFailure(store.claim(FOREIGN, AUTH), "CONFIG_INVALID");
    expect(saved(f)).toEqual(before);
    f.advance(HQ_BACKGROUND_RUN_MS);
    await safeFailure(store.claim(FOREIGN, AUTH), "CONFIG_INVALID");
    expect(saved(f)).toEqual(before);
  });
  it("paused/failed explicit restarts get a new 24-hour run with cleared budgets and fresh binding/actor", async () => {
    const { f, store } = setup();
    const run = await running({ f, store });
    await store.settle(
      run.token!,
      { status: "queued", errorCode: "TIMEOUT" },
      AUTH
    );
    await store.pause(AUTH);
    f.advance(1000);
    const restarted = await store.start(8, FOREIGN, AUTH);
    expect(restarted).toMatchObject({
      actorId: 8,
      sourceBinding: FOREIGN,
      status: "queued",
      attempts: 0,
      consecutiveErrors: 0,
      lastErrorCode: null,
      token: null,
      leaseUntilMs: null,
    });
    expect(restarted.startedAtMs).toBe(f.now());
    expect(restarted.expiresAtMs).toBe(f.now() + HQ_BACKGROUND_RUN_MS);
    const c = await store.claim(FOREIGN, AUTH);
    await store.settle(
      c.job!.token!,
      { status: "failed", errorCode: "TIMEOUT" },
      AUTH
    );
    f.advance(1000);
    const next = await store.start(10, BINDING, AUTH);
    expect(next.attempts).toBe(0);
    expect(next.consecutiveErrors).toBe(0);
    expect(next.startedAtMs).toBe(f.now());
    expect(next.version).toBe(restarted.version + 3);
  });
  it("completed runs refuse explicit restart and retain history", async () => {
    const { f, store } = setup(),
      job = await running({ f, store });
    const completed = await store.settle(
      job.token!,
      { status: "completed" },
      AUTH
    );
    expect(completed).toMatchObject({
      status: "completed",
      attempts: 1,
      token: null,
      leaseUntilMs: null,
    });
    const before = saved(f);
    await safeFailure(store.start(10, BINDING, AUTH), "CONFIG_INVALID");
    await safeFailure(store.start(10, FOREIGN, AUTH), "CONFIG_INVALID");
    expect((await store.claim(BINDING, AUTH)).kind).toBe("idle");
    expect(await store.pause(AUTH)).toEqual(completed);
    expect(saved(f)).toEqual(before);
  });
  it("expired active start first fails the old run, never silently extends it", async () => {
    const { f, store } = setup();
    const job = await store.start(7, BINDING, AUTH);
    f.advance(HQ_BACKGROUND_RUN_MS);
    const failed = await store.start(8, BINDING, AUTH);
    expect(failed).toMatchObject({
      status: "failed",
      lastErrorCode: "SOURCE_EXPIRED",
      actorId: 7,
      startedAtMs: job.startedAtMs,
      expiresAtMs: job.expiresAtMs,
      attempts: 0,
    });
    f.advance(1);
    const restarted = await store.start(8, BINDING, AUTH);
    expect(restarted.startedAtMs).toBe(f.now());
    expect(restarted.expiresAtMs).toBe(f.now() + HQ_BACKGROUND_RUN_MS);
  });
  it("claim expiry fails the old run, and metadata reads never repair expiry", async () => {
    const { f, store } = setup(),
      job = await running({ f, store });
    f.advance(HQ_BACKGROUND_RUN_MS);
    const before = saved(f);
    expect((await store.read()).job).toEqual(job);
    expect(saved(f)).toEqual(before);
    const idle = await store.claim(BINDING, AUTH);
    expect(idle.kind).toBe("idle");
    expect(idle.job).toMatchObject({
      status: "failed",
      lastErrorCode: "SOURCE_EXPIRED",
      attempts: 1,
      startedAtMs: job.startedAtMs,
      expiresAtMs: job.expiresAtMs,
      token: null,
      leaseUntilMs: null,
    });
  });
  it("future due jobs idle without spending attempts", async () => {
    const { f, store } = setup(),
      job = await running({ f, store });
    const due = f.now() + 12345;
    const queued = await store.settle(
      job.token!,
      { status: "queued", nextDueAtMs: due },
      AUTH
    );
    const before = saved(f);
    expect(await store.claim(BINDING, AUTH)).toEqual({
      kind: "idle",
      job: queued,
    });
    expect(saved(f)).toEqual(before);
    f.advance(12345);
    const next = await store.claim(BINDING, AUTH);
    expect(next.kind).toBe("claimed");
    expect(next.job?.attempts).toBe(2);
  });
  it("expired running lease reclaims with new token and retained attempt/error history", async () => {
    const { f, store } = setup(),
      first = await running({ f, store });
    await store.settle(
      first.token!,
      { status: "queued", errorCode: "TIMEOUT" },
      AUTH
    );
    const second = await store.claim(BINDING, AUTH);
    f.advance(HQ_BACKGROUND_LEASE_MS);
    const reclaimed = await store.claim(BINDING, AUTH);
    expect(reclaimed.kind).toBe("claimed");
    expect(reclaimed.job).toMatchObject({
      attempts: 3,
      consecutiveErrors: 1,
      lastErrorCode: "TIMEOUT",
      expiresAtMs: first.expiresAtMs,
    });
    expect(reclaimed.job?.token).not.toBe(second.job?.token);
    const before = saved(f);
    expect(
      await store.settle(second.job!.token!, { status: "completed" }, AUTH)
    ).toEqual(reclaimed.job);
    expect(saved(f)).toEqual(before);
  });
  it("lease is capped to remaining overall time and cannot be renewed", async () => {
    const { f, store } = setup();
    const started = await store.start(7, BINDING, AUTH);
    f.advance(HQ_BACKGROUND_RUN_MS - 60_000);
    const claimed = await store.claim(BINDING, AUTH);
    expect(claimed.kind).toBe("claimed");
    expect(claimed.job?.leaseUntilMs).toBe(started.expiresAtMs);
    expect(Object.keys(store)).toEqual([
      "read",
      "start",
      "pause",
      "claim",
      "settle",
    ]);
  });
  it("queued error budget reaches three exactly, successful queues reset it, fixed history persists", async () => {
    const { f, store } = setup();
    const started = await store.start(7, BINDING, AUTH);
    for (let n = 1; n <= 2; n++) {
      const c = await store.claim(BINDING, AUTH);
      const settled = await store.settle(
        c.job!.token!,
        { status: "queued", errorCode: "TIMEOUT" },
        AUTH
      );
      expect(settled).toMatchObject({
        status: "queued",
        attempts: n,
        consecutiveErrors: n,
      });
    }
    const success = await store.claim(BINDING, AUTH);
    expect(
      await store.settle(success.job!.token!, { status: "queued" }, AUTH)
    ).toMatchObject({ consecutiveErrors: 0, lastErrorCode: null });
    for (let n = 1; n <= 3; n++) {
      const c = await store.claim(BINDING, AUTH);
      const settled = await store.settle(
        c.job!.token!,
        { status: "queued", errorCode: "UNAVAILABLE" },
        AUTH
      );
      expect(settled).toMatchObject({
        status: n === 3 ? "failed" : "queued",
        attempts: 3 + n,
        consecutiveErrors: n,
        expiresAtMs: started.expiresAtMs,
      });
    }
    const idle = await store.claim(BINDING, AUTH);
    expect(idle.kind).toBe("idle");
    expect(idle.job?.attempts).toBe(6);
  });
  it.each(["attempts", "consecutiveErrors"] as const)(
    "claim fails persisted exhausted %s without resetting counters",
    async counter => {
      const { f, store } = setup();
      await store.start(7, BINDING, AUTH);
      const patched = replace(f, {
        [counter]: counter === "attempts" ? 200 : 3,
        lastErrorCode: "TIMEOUT",
      });
      const c = await store.claim(BINDING, AUTH);
      expect(c.kind).toBe("idle");
      expect(c.job).toMatchObject({
        status: "failed",
        attempts: patched.attempts,
        consecutiveErrors: patched.consecutiveErrors,
        token: null,
        leaseUntilMs: null,
        lastErrorCode: "TIMEOUT",
      });
    }
  );
  it("attempt 200 may finish, but cannot queue infinite work", async () => {
    const { f, store } = setup();
    await store.start(7, BINDING, AUTH);
    replace(f, { attempts: 199 });
    const c = await store.claim(BINDING, AUTH);
    expect(c.kind).toBe("claimed");
    expect(c.job?.attempts).toBe(200);
    expect(
      await store.settle(c.job!.token!, { status: "queued" }, AUTH)
    ).toMatchObject({ status: "failed", attempts: 200 });
  });
  it("pause is guarded, clears the token, preserves all history, and no-op pauses do not bump version", async () => {
    const { f, store } = setup();
    expect(await store.pause(AUTH)).toBe(null);
    const first = await running({ f, store });
    await store.settle(
      first.token!,
      { status: "queued", errorCode: "TIMEOUT", nextDueAtMs: f.now() },
      AUTH
    );
    const c = await store.claim(BINDING, AUTH);
    const paused = await store.pause(AUTH);
    expect(paused).toEqual({
      ...c.job,
      version: c.job!.version + 1,
      status: "paused",
      token: null,
      leaseUntilMs: null,
    });
    const before = saved(f);
    expect(await store.pause(AUTH)).toEqual(paused);
    expect(
      await store.settle(c.job!.token!, { status: "completed" }, AUTH)
    ).toEqual(paused);
    expect(saved(f)).toEqual(before);
  });
  it("late workers cannot settle after explicit restart, wrong tokens or expired leases/runs", async () => {
    const { f, store } = setup(),
      c = await running({ f, store });
    const wrong = "00000000-0000-4000-8000-000000000001",
      before = saved(f);
    expect(await store.settle(wrong, { status: "completed" }, AUTH)).toEqual(c);
    expect(saved(f)).toEqual(before);
    f.advance(HQ_BACKGROUND_LEASE_MS);
    expect(await store.settle(c.token!, { status: "completed" }, AUTH)).toEqual(
      c
    );
    expect(saved(f)).toEqual(before);
    await store.pause(AUTH);
    const restarted = await store.start(8, FOREIGN, AUTH);
    expect(await store.settle(c.token!, { status: "failed" }, AUTH)).toEqual(
      restarted
    );
    const latest = await store.claim(FOREIGN, AUTH);
    f.advance(HQ_BACKGROUND_RUN_MS);
    const expiryBefore = saved(f);
    expect(
      await store.settle(latest.job!.token!, { status: "completed" }, AUTH)
    ).toEqual(latest.job);
    expect(saved(f)).toEqual(expiryBefore);
  });
  it("settlement captures inputs before awaits and preserves run timestamps and attempts", async () => {
    const { f, store } = setup(),
      job = await running({ f, store });
    const outcome: HqBackgroundOutcome = {
      status: "failed",
      errorCode: "TIMEOUT",
    };
    f.setAfterHook(stage => {
      if (stage === "select") {
        outcome.status = "completed";
        outcome.errorCode = "AUTH_DENIED";
      }
    });
    const settled = await store.settle(job.token!, outcome, AUTH);
    expect(settled).toMatchObject({
      status: "failed",
      lastErrorCode: "TIMEOUT",
      attempts: 1,
      startedAtMs: job.startedAtMs,
      expiresAtMs: job.expiresAtMs,
    });
  });
});

describe("transaction authority, await and deadline fences (offline)", () => {
  it.each(["start", "pause", "claim", "settle"] as const)(
    "%s rejects a missing guard before opening SQL",
    async method => {
      const { f, store } = setup();
      const missing = undefined as unknown as () => Promise<void>;
      const p =
        method === "start"
          ? store.start(7, BINDING, missing)
          : method === "claim"
            ? store.claim(BINDING, missing)
            : method === "pause"
              ? store.pause(missing)
              : store.settle(
                  "00000000-0000-4000-8000-000000000001",
                  { status: "completed" },
                  missing
                );
      await safeFailure(p, "CONFIG_INVALID");
      expect(f.stages).toHaveLength(0);
    }
  );
  it.each(["connection", "begin", "select", "clock", "insert"] as const)(
    "fresh auth denial immediately after %s await rolls back all bytes",
    async stage => {
      const { f, store } = setup(),
        before = originals(f);
      let denied = false,
        checked = 0;
      f.setAfterHook(s => {
        if (s === stage) denied = true;
      });
      await safeFailure(
        store.start(7, BINDING, async () => {
          checked++;
          if (denied) throw new HqLiveError("AUTH_DENIED");
        }),
        "AUTH_DENIED"
      );
      expect(checked).toBeGreaterThan(0);
      expect(saved(f)).toEqual(before);
      expect(f.commits()).toBe(0);
    }
  );
  it.each(["pause", "claim", "settle"] as const)(
    "%s postwrite settings drift rolls back exact job bytes",
    async method => {
      const s = setup(),
        c = await running(s),
        before = saved(s.f);
      if (method === "claim") {
        await s.store.settle(c.token!, { status: "queued" }, AUTH);
      }
      const actualBefore = method === "claim" ? saved(s.f) : before;
      let drift = false;
      s.f.setAfterHook(stage => {
        if (stage === "update") drift = true;
      });
      const guard = async () => {
        if (drift) throw new HqLiveError("CONFIG_INVALID");
      };
      const p =
        method === "pause"
          ? s.store.pause(guard)
          : method === "claim"
            ? s.store.claim(BINDING, guard)
            : s.store.settle(c.token!, { status: "completed" }, guard);
      await safeFailure(p, "CONFIG_INVALID");
      expect(saved(s.f)).toEqual(actualBefore);
    }
  );
  it("denial remains permanently latched even if a guard would recover during rollback", async () => {
    const { f, store } = setup();
    let armed = false,
      failures = 0,
      recoveredChecks = 0;
    f.setAfterHook(stage => {
      if (stage === "insert") armed = true;
    });
    await safeFailure(
      store.start(7, BINDING, async () => {
        if (armed && failures === 0) {
          failures++;
          throw new HqLiveError("AUTH_DENIED");
        }
        if (armed) recoveredChecks++;
      }),
      "AUTH_DENIED"
    );
    expect(recoveredChecks).toBeGreaterThan(0);
    expect(f.rows.size).toBe(0);
    expect(f.commits()).toBe(0);
  });
  it("rechecks authority after failed SQL awaits, sanitizes SQL and rollback failures", async () => {
    const { f, store } = setup();
    let armed = false,
      refreshed = false;
    f.setHook(stage => {
      if (stage === "insert") armed = true;
    });
    f.failNext("insert");
    await safeFailure(
      store.start(7, BINDING, async () => {
        if (armed) {
          refreshed = true;
          throw new HqLiveError("AUTH_DENIED");
        }
      }),
      "AUTH_DENIED"
    );
    expect(refreshed).toBe(true);
    expect(f.rows.size).toBe(0);
    f.setHook(null);
    armed = false;
    f.setAfterHook(stage => {
      if (stage === "insert") {
        armed = true;
        f.failNext("rollback");
      }
    });
    await safeFailure(
      store.start(7, BINDING, async () => {
        if (armed) throw new HqLiveError("CONFIG_INVALID");
      }),
      "CONFIG_INVALID"
    );
    expect(f.rows.size).toBe(0);
    expect(f.stages.some(s => s.stage === "rollback")).toBe(true);
  });
  it.each([
    "connection",
    "begin",
    "select",
    "clock",
    "insert",
    "commit",
  ] as const)(
    "%s provider failure cannot return success or expose SQL details",
    async stage => {
      const { f, store } = setup(),
        before = originals(f);
      f.failNext(stage);
      await safeFailure(store.start(7, BINDING, AUTH), "STORE_UNAVAILABLE");
      expect(saved(f)).toEqual(before);
      expect(f.commits()).toBe(0);
    }
  );
  it("post-commit guard denial is reported as failure, never claimed as a rollback success", async () => {
    const { f, store } = setup();
    let denied = false;
    f.setAfterHook(stage => {
      if (stage === "commit") denied = true;
    });
    await safeFailure(
      store.start(7, BINDING, async () => {
        if (denied) throw new HqLiveError("AUTH_DENIED");
      }),
      "AUTH_DENIED"
    );
    // COMMIT has already completed: no adapter can honestly promise to undo it.
    expect(f.commits()).toBe(1);
    expect(f.rows.size).toBe(1);
  });
  it("catchable clock expiry during claim UPDATE rolls back instead of issuing an expired token", async () => {
    const { f, store } = setup();
    await store.start(7, BINDING, AUTH);
    const before = saved(f);
    f.setAfterHook(stage => {
      if (stage === "update") f.advance(HQ_BACKGROUND_LEASE_MS);
    });
    await safeFailure(store.claim(BINDING, AUTH), "STORE_UNAVAILABLE");
    expect(saved(f)).toEqual(before);
  });
  it("run expiry during start INSERT rolls back rather than extending the fixed window", async () => {
    const { f, store } = setup(),
      before = originals(f);
    f.setAfterHook(stage => {
      if (stage === "insert") f.advance(HQ_BACKGROUND_RUN_MS);
    });
    await safeFailure(store.start(7, BINDING, AUTH), "STORE_UNAVAILABLE");
    expect(saved(f)).toEqual(before);
  });
  it("settle must recheck the old worker deadline after the write and final guard", async () => {
    const { f, store } = setup(),
      job = await running({ f, store }),
      before = saved(f);
    f.setAfterHook(stage => {
      if (stage === "update") f.advance(HQ_BACKGROUND_LEASE_MS);
    });
    await safeFailure(
      store.settle(job.token!, { status: "completed" }, AUTH),
      "STORE_UNAVAILABLE"
    );
    expect(saved(f)).toEqual(before);
    f.setAfterHook(null);
    const next = await store.claim(BINDING, AUTH);
    const nextBefore = saved(f);
    let clockReads = 0,
      finalGuard = false;
    f.setAfterHook(stage => {
      if (stage === "clock" && ++clockReads === 2) finalGuard = true;
    });
    await safeFailure(
      store.settle(next.job!.token!, { status: "completed" }, async () => {
        if (finalGuard) throw new HqLiveError("CONFIG_INVALID");
      }),
      "CONFIG_INVALID"
    );
    expect(saved(f)).toEqual(nextBefore);
  });
  it("release failures are sanitized and are not returned as success", async () => {
    const { f, store } = setup();
    f.failNext("release");
    await safeFailure(store.read(), "STORE_UNAVAILABLE");
  });
  it("version exhaustion and regressing database clocks refuse all mutations", async () => {
    const { f, store } = setup();
    await store.start(7, BINDING, AUTH);
    replace(f, { version: 2_147_483_646 });
    const before = saved(f);
    await safeFailure(store.claim(BINDING, AUTH), "INVALID_PERSISTED_STATE");
    await safeFailure(store.pause(AUTH), "INVALID_PERSISTED_STATE");
    expect(saved(f)).toEqual(before);
    replace(f, { version: 1 });
    const regressedBefore = saved(f);
    f.advance(-1);
    await safeFailure(store.claim(BINDING, AUTH), "INVALID_PERSISTED_STATE");
    expect(saved(f)).toEqual(regressedBefore);
  });
});

describe("strict <=4096-byte durable metadata parser", () => {
  const corruptions: [string, (j: Record<string, unknown>) => void][] = [
    [
      "unknown key",
      j => {
        j.secret = "not allowed";
      },
    ],
    [
      "missing key",
      j => {
        delete j.token;
      },
    ],
    [
      "format",
      j => {
        j.format = "hq-live-control-v1";
      },
    ],
    [
      "version mismatch",
      j => {
        j.version = 2;
      },
    ],
    [
      "version zero",
      j => {
        j.version = 0;
      },
    ],
    [
      "source binding",
      j => {
        j.sourceBinding = "secret url";
      },
    ],
    [
      "actor zero",
      j => {
        j.actorId = 0;
      },
    ],
    [
      "actor unsafe",
      j => {
        j.actorId = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      "actor string",
      j => {
        j.actorId = "7";
      },
    ],
    [
      "unknown status",
      j => {
        j.status = "staged";
      },
    ],
    [
      "start zero",
      j => {
        j.startedAtMs = 0;
      },
    ],
    [
      "update zero",
      j => {
        j.updatedAtMs = 0;
      },
    ],
    [
      "sliding expiry",
      j => {
        j.expiresAtMs = Number(j.expiresAtMs) + 1;
      },
    ],
    [
      "attempt overflow",
      j => {
        j.attempts = 201;
      },
    ],
    [
      "negative attempts",
      j => {
        j.attempts = -1;
      },
    ],
    [
      "fractional attempts",
      j => {
        j.attempts = 1.1;
      },
    ],
    [
      "error overflow",
      j => {
        j.consecutiveErrors = 4;
      },
    ],
    [
      "negative due",
      j => {
        j.nextDueAtMs = -1;
      },
    ],
    [
      "unknown error",
      j => {
        j.lastErrorCode = "sql secret";
      },
    ],
    [
      "queued token",
      j => {
        j.token = "00000000-0000-4000-8000-000000000001";
      },
    ],
    [
      "queued lease",
      j => {
        j.leaseUntilMs = Number(j.startedAtMs) + 600000;
      },
    ],
    [
      "running no token",
      j => {
        j.status = "running";
        j.attempts = 1;
        j.leaseUntilMs = Number(j.startedAtMs) + 600000;
      },
    ],
    [
      "running malformed UUID",
      j => {
        j.status = "running";
        j.attempts = 1;
        j.token = "---------------------------abcdefghi";
        j.leaseUntilMs = Number(j.startedAtMs) + 600000;
      },
    ],
    [
      "running no lease",
      j => {
        j.status = "running";
        j.attempts = 1;
        j.token = "00000000-0000-4000-8000-000000000001";
      },
    ],
    [
      "running renewed lease",
      j => {
        j.status = "running";
        j.attempts = 1;
        j.token = "00000000-0000-4000-8000-000000000001";
        j.leaseUntilMs = Number(j.updatedAtMs) + 600001;
      },
    ],
    [
      "running no attempt",
      j => {
        j.status = "running";
        j.token = "00000000-0000-4000-8000-000000000001";
        j.leaseUntilMs = Number(j.updatedAtMs) + 600000;
      },
    ],
  ];
  it.each(corruptions)(
    "rejects %s without repair or raw parse errors",
    async (_name, corrupt) => {
      const { f, store } = setup();
      await store.start(7, BINDING, AUTH);
      const row = f.rows.get(HQ_BACKGROUND_DATASET_ID)!;
      const j = JSON.parse(row.state);
      corrupt(j);
      row.state = JSON.stringify(j);
      const before = saved(f);
      await safeFailure(store.read(), "INVALID_PERSISTED_STATE");
      await safeFailure(store.claim(BINDING, AUTH), "INVALID_PERSISTED_STATE");
      expect(saved(f)).toEqual(before);
    }
  );
  it.each([
    "{malformed secret SQL",
    "[]",
    "null",
    '"text"',
    "X".repeat(4097),
    " ".repeat(4097),
  ])("rejects malformed/oversize state sample %#", async state => {
    const { f, store } = setup();
    await store.start(7, BINDING, AUTH);
    f.rows.get(HQ_BACKGROUND_DATASET_ID)!.state = state;
    await safeFailure(store.read(), "INVALID_PERSISTED_STATE");
  });
  it.each(["datasetId", "mode", "ownerUserId", "stateVersion"])(
    "rejects incorrect row envelope %s",
    async key => {
      const { f, store } = setup();
      await store.start(7, BINDING, AUTH);
      f.setRowHook(selected =>
        selected.map(row => ({
          ...row,
          [key]:
            key === "datasetId"
              ? "foreign root"
              : key === "mode"
                ? "sample"
                : key === "ownerUserId"
                  ? 7
                  : 0,
        }))
      );
      await safeFailure(store.read(), "INVALID_PERSISTED_STATE");
    }
  );
  it("rejects duplicate exact rows, dishonest byte columns, and invalid DB time without disclosing details", async () => {
    const { f, store } = setup();
    await store.start(7, BINDING, AUTH);
    f.setRowHook(rows => [...rows, ...rows]);
    await safeFailure(store.read(), "INVALID_PERSISTED_STATE");
    f.setRowHook(rows => rows.map(r => ({ ...r, stateBytes: false })));
    await safeFailure(store.read(), "INVALID_PERSISTED_STATE");
    f.setRowHook(null);
    f.setClock(0);
    await safeFailure(store.read(), "STORE_UNAVAILABLE");
  });
  it("supports driver-decoded JSON and canonical integer columns without weakening exact JSON keys", async () => {
    const { f, store } = setup(),
      job = await store.start(7, BINDING, AUTH);
    f.setRowHook(rows =>
      rows.map(r => ({
        ...r,
        state: JSON.parse(r.state as string),
        stateVersion: "1",
        ownerUserId: "0",
        stateBytes: String(r.stateBytes),
      }))
    );
    expect((await store.read()).job).toEqual(job);
  });
  it("accepts precisely 4096 UTF-8 input bytes and refuses 4097 before parsing", async () => {
    const { f, store } = setup(),
      job = await store.start(7, BINDING, AUTH);
    const row = f.rows.get(HQ_BACKGROUND_DATASET_ID)!;
    row.state += " ".repeat(4096 - Buffer.byteLength(row.state));
    expect((await store.read()).job).toEqual(job);
    row.state += " ";
    await safeFailure(store.read(), "INVALID_PERSISTED_STATE");
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "7"])(
    "invalid actor sample %# opens no SQL",
    async actor => {
      const { f, store } = setup();
      await safeFailure(
        store.start(actor as number, BINDING, AUTH),
        "CONFIG_INVALID"
      );
      expect(f.stages).toHaveLength(0);
    }
  );
  it("invalid binding/token/outcome inputs open no SQL and never expose their values", async () => {
    const { f, store } = setup();
    await safeFailure(store.start(7, "raw credential", AUTH), "CONFIG_INVALID");
    await safeFailure(store.claim("raw credential", AUTH), "CONFIG_INVALID");
    await safeFailure(
      store.settle("raw credential", { status: "completed" }, AUTH),
      "CONFIG_INVALID"
    );
    const token = "00000000-0000-4000-8000-000000000001";
    for (const bad of [
      { status: "queued", nextDueAtMs: -1 },
      { status: "completed", errorCode: "raw secret" },
      { status: "paused" },
      { status: "completed", unknown: 1 },
    ]) {
      await safeFailure(
        store.settle(token, bad as HqBackgroundOutcome, AUTH),
        "CONFIG_INVALID"
      );
    }
    expect(f.stages).toHaveLength(0);
  });
});

describe("metadata-only ten-second read deadline", () => {
  it.each(["connection", "select"] as const)(
    "bounds hung %s without retries, cancellation, writes or late result acceptance",
    async stage => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const { f, store } = setup();
        let unblock!: () => void;
        const gate = new Promise<void>(resolve => {
          unblock = resolve;
        });
        let blocked = 0;
        f.setHook(async current => {
          if (current === stage) {
            blocked++;
            await gate;
          }
        });
        const outcome = store.read().then(
          value => ({ value }),
          error => ({ error })
        );
        await vi.advanceTimersByTimeAsync(9999);
        expect(blocked).toBe(1);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        const failed = await outcome;
        expect(failed).toMatchObject({
          error: { code: "STORE_UNAVAILABLE", message: "STORE_UNAVAILABLE" },
        });
        expect(vi.getTimerCount()).toBe(0);
        unblock();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(await outcome).toBe(failed);
        expect(blocked).toBe(1);
        expect(f.stages.filter(s => s.stage === "connection")).toHaveLength(1);
        expect(f.stages.filter(s => s.stage === "release")).toHaveLength(1);
        expect(f.trace).toHaveLength(stage === "connection" ? 0 : 1);
        expect(
          f.trace.every(
            t => t.sql.startsWith("SELECT") && !t.sql.includes("FOR UPDATE")
          )
        ).toBe(true);
        expect(f.rows.size).toBe(0);
        expect(f.commits()).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    }
  );
  it("normal metadata leaves no deadline timer and mutations never acquire one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { f, store } = setup();
      expect(await store.read()).toEqual({ job: null, databaseNowMs: f.now() });
      expect(vi.getTimerCount()).toBe(0);
      f.setHook(() => {
        expect(vi.getTimerCount()).toBe(0);
      });
      await store.start(7, BINDING, AUTH);
      const c = await store.claim(BINDING, AUTH);
      await store.settle(c.job!.token!, { status: "queued" }, AUTH);
      await store.pause(AUTH);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
