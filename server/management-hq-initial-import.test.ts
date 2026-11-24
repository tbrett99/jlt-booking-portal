import { describe, expect, it, vi } from "vitest";
import { createHqLiveConfig } from "./management-hq-live-config";
import { createHqLiveService } from "./management-hq-live-service";
import { createHqLiveStore } from "./management-hq-live-store";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import { importHqInitialBatch } from "./management-hq-initial-import";
import type { HqWireReader } from "../shared/management-hq-wire";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const settings = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://orbit.thejltgroup.co.uk/api/reporting/v1",
  HQ_ORBIT_REPORTING_API_KEY: "SYNTHETIC-REPORTING-KEY-" + "a".repeat(32),
  HQ_PORTAL_SYNC_TOKEN: "SYNTHETIC-PORTAL-TOKEN-" + "b".repeat(32),
  ...overrides,
});
function offlinePool() {
  const rows = new Map<string, any>();
  let clock = Date.parse("2026-11-22T12:00:00Z"),
    tail = Promise.resolve();
  const pool: any = {
    execute: vi.fn(() => {
      throw new Error("no nontransactional SQL");
    }),
    getConnection: vi.fn(async () => {
      let draft: Map<string, any>,
        unlock = () => {},
        started = false;
      return {
        async beginTransaction() {
          const previous = tail;
          tail = new Promise<void>(resolve => {
            unlock = resolve;
          });
          await previous;
          started = true;
          draft = new Map(Array.from(rows, ([k, v]) => [k, clone(v)]));
        },
        async execute(sql: string, args: any[] = []) {
          if (!started) throw new Error("transaction required");
          if (sql.startsWith("SELECT CAST")) return [[{ nowMs: clock }]];
          if (sql.startsWith("SELECT datasetId"))
            return [draft.has(args[0]) ? [clone(draft.get(args[0]))] : []];
          if (sql.startsWith("INSERT IGNORE")) {
            if (draft.has(args[0])) return [{ affectedRows: 0 }];
            draft.set(args[0], {
              datasetId: args[0],
              mode: "live",
              ownerUserId: 0,
              stateVersion: 1,
              state: args[1],
              updatedAt: new Date(clock).toISOString(),
            });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith("UPDATE management_hq_datasets")) {
            const row = draft.get(args[2]);
            if (
              !row ||
              row.mode !== "live" ||
              row.ownerUserId !== 0 ||
              row.stateVersion !== args[3]
            )
              return [{ affectedRows: 0 }];
            draft.set(args[2], {
              ...row,
              stateVersion: args[0],
              state: args[1],
              updatedAt: new Date(clock).toISOString(),
            });
            return [{ affectedRows: 1 }];
          }
          throw new Error("unexpected SQL");
        },
        async commit() {
          rows.clear();
          for (const [k, v] of draft) rows.set(k, clone(v));
          started = false;
          unlock();
        },
        async rollback() {
          if (started) {
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
    }),
  };
  return {
    pool,
    rows,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
function setup(
  reader = createHqImplementedSampleReader("initial"),
  maxSourceMethods?: number
) {
  const env = settings(),
    config = createHqLiveConfig(env),
    fixture = offlinePool();
  const store = createHqLiveStore(fixture.pool, config);
  const createReader = vi.fn(() => reader),
    guard = vi.fn(async () => {});
  const services: ReturnType<typeof createHqLiveService>[] = [];
  const createService = vi.fn(
    (options: Parameters<typeof createHqLiveService>[0]) => {
      const service = createHqLiveService({
        ...options,
        createStore: () => store,
        createReader,
        now: fixture.now,
        maxSourceMethods,
      });
      vi.spyOn(service, "invoke");
      services.push(service);
      return service;
    }
  );
  const click = () =>
    importHqInitialBatch({ env, config, guard, createService });
  return {
    env,
    config,
    fixture,
    store,
    createReader,
    createService,
    guard,
    services,
    click,
  };
}
const safe = (value: unknown) =>
  expect(JSON.stringify(value)).not.toMatch(
    /SYNTHETIC|customer@|SELECT|https:|resumeCursor|leaseToken|sourceFingerprint|bookingRef|apiKey|private_payload/
  );
describe("manual first-import helper with real live runner and real fenced store", () => {
  it.each([
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_LIVE_SYNC_ENABLED: "TRUE" },
    { HQ_PORTAL_SYNC_TOKEN: undefined },
    { HQ_ORBIT_REPORTING_API_KEY: "short" },
  ])(
    "strict actual settings reject %j without store or source",
    async overrides => {
      const env = settings(overrides),
        createService = vi.fn();
      const response = await importHqInitialBatch({
        env,
        guard: async () => {},
        createService,
      });
      expect(["disabled", "needs_attention"]).toContain(response.status);
      expect(createService).not.toHaveBeenCalled();
      safe(response);
    }
  );
  it("construction does no source import; one click publishes; later clicks never refresh even after due", async () => {
    const s = setup();
    expect(s.createReader).not.toHaveBeenCalled();
    expect(s.fixture.rows.size).toBe(0);
    const response = await s.click();
    expect(response.status).toBe("applied");
    safe(response);
    const published = clone(await s.store.readPublished());
    expect(await s.services[0].readPublished()).toBeNull();
    expect(await s.services[0].readValidationSnapshot()).toEqual(published);
    s.fixture.advance(3600000);
    expect((await s.click()).status).toBe("already_complete");
    expect(s.services[1].invoke).not.toHaveBeenCalled();
    expect(s.createReader).toHaveBeenCalledOnce();
    expect(await s.store.readPublished()).toEqual(published);
  });
  it("one click starts at most 25 source methods, preserves staging and honors next due", async () => {
    const base = createHqImplementedSampleReader("initial"),
      first = await base.bookings();
    const bookings = vi.fn(async (q?: any) => {
      const index = q?.cursor ? Number(q.cursor.slice(5)) : 0;
      return {
        ...clone(first),
        items: index ? [] : first.items,
        complete: index === 28,
        nextCursor: index === 28 ? null : `page-${index + 1}`,
      };
    });
    const s = setup({ ...base, bookings });
    expect(await s.click()).toMatchObject({
      status: "progress",
      hasPublished: false,
      progress: { pages: 23, recordsRead: 1 },
    });
    expect(bookings).toHaveBeenCalledTimes(23);
    const stage = clone((await s.store.readSnapshot()).sync);
    expect((await s.click()).status).toBe("notdue");
    expect((await s.store.readSnapshot()).sync).toEqual(stage);
    expect(bookings).toHaveBeenCalledTimes(23);
    s.fixture.advance(60000);
    expect((await s.click()).status).toBe("applied");
    expect(bookings).toHaveBeenCalledTimes(29);
  });
  it("successive sub-30s GETs yield at the unchanged 75s method-start deadline with no extra source method", async () => {
    const s = setup(),
      base = createHqImplementedSampleReader("initial");
    let calls = 0;
    const read = async <T>(work: () => Promise<T>) => {
      calls++;
      s.fixture.advance(15000);
      return work();
    };
    s.createReader.mockReturnValue({
      status: () => read(() => base.status()),
      capabilities: () => read(() => base.capabilities()),
      bookings: q => read(() => base.bookings(q)),
      businessMappings: q => read(() => base.businessMappings(q)),
      catalogue: (t, q) => read(() => base.catalogue(t, q)),
      changes: (cursor, limit) => read(() => base.changes(cursor, limit)),
    });
    expect(await s.click()).toMatchObject({
      status: "progress",
      hasPublished: false,
    });
    expect(calls).toBe(5);
    const snapshot = await s.store.readSnapshot();
    expect(snapshot.control).toMatchObject({
      stageStatus: "progress",
      leaseToken: null,
    });
    expect(snapshot.sync?.stage).not.toBeNull();
    expect(snapshot.sync?.published).toBeNull();
  });
  it("a slow immediate pre-GET authority await cannot start a method after 75 seconds", async () => {
    const s = setup(),
      base = createHqImplementedSampleReader("initial");
    const status = vi.fn(base.status);
    let afterReader = false,
      gates = 0;
    s.createReader.mockImplementation(() => {
      afterReader = true;
      return { ...base, status };
    });
    s.guard.mockImplementation(async () => {
      // Engine read pre/post, renew pre/post, then the immediate source pre-gate.
      if (afterReader && ++gates === 5) s.fixture.advance(75000);
    });
    expect((await s.click()).status).toBe("needs_attention");
    expect(status).not.toHaveBeenCalled();
    expect(await s.store.readPublished()).toBeNull();
  });
  it("75-second method-start boundary yields without starting another method and keeps fencing limits", async () => {
    const s = setup(),
      base = createHqImplementedSampleReader("initial"),
      capabilities = vi.fn(base.capabilities);
    s.createReader.mockReturnValue({
      ...base,
      status: async () => {
        s.fixture.advance(75000);
        return base.status();
      },
      capabilities,
    });
    // An overlong pending source method loses the renewable 30s lease safely.
    expect((await s.click()).status).toBe("needs_attention");
    expect(capabilities).not.toHaveBeenCalled();
    expect(await s.store.readPublished()).toBeNull();
  });
  it("busy and terminal attention do not construct another source or reset checkpoints", async () => {
    const busy = setup();
    await busy.store.acquire();
    expect((await busy.click()).status).toBe("busy");
    expect(busy.createReader).not.toHaveBeenCalled();
    const base = createHqImplementedSampleReader("initial");
    const fail = vi.fn(async () => {
      throw Object.assign(new Error("SELECT private_payload"), {
        code: "INVALID_PAYLOAD",
      });
    });
    const terminal = setup({ ...base, businessMappings: fail });
    expect((await terminal.click()).status).toBe("needs_attention");
    const state = clone((await terminal.store.readSnapshot()).sync);
    terminal.fixture.advance(4000000);
    const response = await terminal.click();
    expect(response.status).toBe("needs_attention");
    safe(response);
    expect(terminal.services[1].invoke).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
    expect((await terminal.store.readSnapshot()).sync).toEqual(state);
  });
  it("transient safe backoff preserves due delay and never immediately retries", async () => {
    const base = createHqImplementedSampleReader("initial"),
      status = vi.fn(async () => {
        throw Object.assign(new Error("SELECT private_payload"), {
          code: "RATE_LIMITED",
          safeRetryAfter: 120,
        });
      });
    const s = setup({ ...base, status });
    const response = await s.click();
    expect(response).toMatchObject({
      status: "progress",
      errorCode: "RATE_LIMITED",
    });
    safe(response);
    expect((await s.click()).status).toBe("notdue");
    expect(status).toHaveBeenCalledOnce();
  });
  it("publication appearing during acquire is checked under the acquired renewable fence before reader construction", async () => {
    const s = setup(),
      otherStore = createHqLiveStore(s.fixture.pool, s.config);
    const other = createHqLiveService({
      config: s.config,
      createStore: () => otherStore,
      createReader: () => createHqImplementedSampleReader("initial"),
      now: s.fixture.now,
    });
    const acquire = s.store.acquire.bind(s.store);
    vi.spyOn(s.store, "acquire").mockImplementationOnce(async () => {
      expect((await other.invoke()).status).toBe("applied");
      s.fixture.advance(300000);
      return acquire();
    });
    const complete = vi.spyOn(s.store, "complete");
    const response = await s.click();
    expect(response).toMatchObject({
      status: "already_complete",
      hasPublished: true,
    });
    safe(response);
    expect(s.createReader).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    const publication = clone(await s.store.readPublished());
    s.fixture.advance(30001);
    expect((await s.click()).status).toBe("already_complete");
    expect(await s.store.readPublished()).toEqual(publication);
  });
  it.each([false, true])(
    "raw source/token/settings drift after %s source failure denies and stages no raw payload",
    async fails => {
      const s = setup(),
        base = createHqImplementedSampleReader("initial");
      const complete = vi.spyOn(s.store, "complete");
      let beforeFailure: unknown;
      s.createReader.mockReturnValue({
        ...base,
        status: async () => {
          beforeFailure = clone((await s.store.readSnapshot()).control);
          s.env.HQ_PORTAL_SYNC_TOKEN = "rotated-" + "x".repeat(40);
          if (fails) throw new Error("SELECT private_payload");
          return base.status();
        },
      });
      await expect(s.click()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(await s.store.readPublished()).toBeNull();
      expect(complete).not.toHaveBeenCalled();
      expect((await s.store.readSnapshot()).control).toEqual(beforeFailure);
    }
  );
  it("fresh actor revocation after failed source await denies the action result", async () => {
    const s = setup(),
      base = createHqImplementedSampleReader("initial");
    let active = true;
    const complete = vi.spyOn(s.store, "complete");
    let beforeFailure: unknown;
    s.guard.mockImplementation(async () => {
      if (!active)
        throw Object.assign(new Error("fixed denied"), { code: "AUTH_DENIED" });
    });
    s.createReader.mockReturnValue({
      ...base,
      status: async () => {
        beforeFailure = clone((await s.store.readSnapshot()).control);
        active = false;
        throw new Error("SELECT private_payload");
      },
    });
    await expect(s.click()).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(await s.store.readPublished()).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect((await s.store.readSnapshot()).control).toEqual(beforeFailure);
  });
  it.each([
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_PORTAL_SYNC_TOKEN: undefined },
  ])(
    "private validation snapshot rejects %j before store construction",
    async overrides => {
      const createStore = vi.fn();
      const service = createHqLiveService({
        config: createHqLiveConfig(settings(overrides)),
        createStore,
      });
      await expect(service.readValidationSnapshot()).rejects.toBeDefined();
      expect(createStore).not.toHaveBeenCalled();
    }
  );
});
