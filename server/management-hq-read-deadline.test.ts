import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hqReadDeadline } from "./management-hq-read-deadline";
import { createHqLiveConfig } from "./management-hq-live-config";
import { createHqLiveService } from "./management-hq-live-service";
import { createHqLiveStore } from "./management-hq-live-store";
import {
  HQ_PROGRESS_SQL,
  readHqProgressSnapshot,
} from "./management-hq-progress";
import { offlineHqV2Pool } from "./management-hq-storage-v2-pool";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const configuration = () =>
  createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://orbit.thejltgroup.co.uk/api/reporting/v1",
    HQ_ORBIT_REPORTING_API_KEY: "offline-deadline-key-" + "a".repeat(40),
    HQ_PORTAL_SYNC_TOKEN: "offline-deadline-token-" + "b".repeat(40),
  });
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HQ read-only Promise.race deadline", () => {
  it("fails closed at the default ten-second boundary, without repeating or cancelling work", async () => {
    const read = deferred<string>();
    const query = vi.fn(() => read.promise);
    const outcome = hqReadDeadline(query).then(
      value => ({ value }),
      error => ({ error })
    );
    await vi.advanceTimersByTimeAsync(9999);
    expect(query).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await outcome;
    expect(result).toMatchObject({ error: { message: "HQ_READ_DEADLINE" } });
    expect(vi.getTimerCount()).toBe(0);
    read.resolve("late authoritative-looking data");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60000);
    expect(await outcome).toBe(result);
    expect(query).toHaveBeenCalledOnce();
  });

  it("ignores a late query rejection after timeout and never retries", async () => {
    const read = deferred<string>();
    const query = vi.fn(() => read.promise);
    const outcome = hqReadDeadline(query).catch(error => error);
    await vi.advanceTimersByTimeAsync(10000);
    const timeout = await outcome;
    expect(timeout.message).toBe("HQ_READ_DEADLINE");
    read.reject(new Error("late private SQL failure"));
    await vi.advanceTimersByTimeAsync(20000);
    expect(await outcome).toBe(timeout);
    expect(query).toHaveBeenCalledOnce();
  });

  it("returns an immediate result once and clears the losing deadline", async () => {
    const value = { allowed: true };
    const query = vi.fn(async () => value);
    expect(await hqReadDeadline(query)).toBe(value);
    expect(query).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(query).toHaveBeenCalledOnce();
  });

  it("returns a normal pending result before the boundary and cleans up", async () => {
    const read = deferred<number>();
    const query = vi.fn(() => read.promise);
    const outcome = hqReadDeadline(query);
    await vi.advanceTimersByTimeAsync(9999);
    read.resolve(47);
    expect(await outcome).toBe(47);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledOnce();
  });

  it.each(["throw", "reject"] as const)(
    "preserves an immediate %s failure and removes its timer",
    async kind => {
      const failure = new Error("original read failure");
      const query = vi.fn((): Promise<never> => {
        if (kind === "throw") throw failure;
        return Promise.reject(failure);
      });
      await expect(hqReadDeadline(query)).rejects.toBe(failure);
      expect(query).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10000);
    }
  );

  it("preserves a normally delayed rejection and clears the timer", async () => {
    const read = deferred<never>();
    const failure = new Error("normal read rejection");
    const query = vi.fn(() => read.promise);
    const outcome = hqReadDeadline(query).catch(error => error);
    await vi.advanceTimersByTimeAsync(8500);
    read.reject(failure);
    expect(await outcome).toBe(failure);
    expect(query).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors a private explicit deadline without changing the ten-second default", async () => {
    const read = deferred<never>();
    const outcome = hqReadDeadline(() => read.promise, 25).catch(
      error => error
    );
    await vi.advanceTimersByTimeAsync(24);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await outcome).message).toBe("HQ_READ_DEADLINE");
  });
});

describe("actual readOFF progress deadline integration, offline only", () => {
  it("times out one bounded observational SQL query with no transaction, retry or late status acceptance", async () => {
    const f = offlineHqV2Pool();
    const saved = Array.from(f.rows);
    const read = deferred<any>();
    const execute = vi
      .spyOn(f.pool, "execute")
      .mockImplementation(() => read.promise);
    const connection = vi.spyOn(f.pool, "getConnection");
    const store = createHqLiveStore(f.pool, configuration());
    const reader = vi.fn();
    const service = createHqLiveService({
      config: configuration(),
      createStore: () => store,
      createReader: reader,
      now: f.now,
    });
    const outcome = service.getStatus();
    await vi.advanceTimersByTimeAsync(9999);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(HQ_PROGRESS_SQL, [
      "live:company:orbit:v1:control",
      "live:company:orbit:v1:sync",
    ]);
    await vi.advanceTimersByTimeAsync(1);
    const status = await outcome;
    expect(status).toMatchObject({
      health: "needs_attention",
      lastErrorCode: "STORE_UNAVAILABLE",
      hasPublished: false,
      readEnabled: false,
    });
    read.resolve([
      [{ databaseNowMs: f.now(), controlDatasetId: null, syncDatasetId: null }],
    ]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(await outcome).toBe(status);
    expect(execute).toHaveBeenCalledOnce();
    expect(connection).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
    expect(Array.from(f.rows)).toEqual(saved);
    expect(f.commits.mock.calls).toHaveLength(0);
  });

  it("returns a normal actual offline progress observation and leaves no timer", async () => {
    const f = offlineHqV2Pool();
    const result = await readHqProgressSnapshot(f.pool, configuration());
    expect(result).toMatchObject({
      payloadIntegrity: "unchecked",
      hasPublished: false,
      control: null,
      stateVersion: null,
      databaseNowMs: f.now(),
    });
    expect(f.trace).toHaveLength(1);
    expect(f.trace[0]).toMatchObject({ sql: HQ_PROGRESS_SQL, transaction: 0 });
    expect(f.commits.mock.calls).toHaveLength(0);
  });
});
