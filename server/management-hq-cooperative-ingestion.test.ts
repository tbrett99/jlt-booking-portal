import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HqWireReader } from "../shared/management-hq-wire";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  cloneHqJsonAsync,
  validateHqImplementedSyncState,
  validateHqImplementedSyncStateAsync,
  type HqImplementedOptions,
  type HqImplementedState,
  type HqImplementedStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import { canonicalHqJson, getHqReport } from "./management-hq-engine";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const exactBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const noNetwork = vi.fn(() => {
  throw new Error("Offline HQ tests forbid network");
});
beforeEach(() => {
  noNetwork.mockClear();
  vi.stubGlobal("fetch", noNetwork);
});
afterEach(() => {
  expect(noNetwork).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
function cooperative(checkpoint = async () => {}): HqImplementedOptions {
  return {
    cooperativeCheckpoint: checkpoint,
    measureStateBytes: exactBytes,
    measureStateBytesAsync: async value => exactBytes(value),
  };
}
function mapReader(
  base: HqWireReader,
  map: (page: any, method: string) => any
): HqWireReader {
  return {
    status: async () => map(await base.status(), "status"),
    capabilities: async () => map(await base.capabilities(), "capabilities"),
    bookings: async q => map(await base.bookings(q), "bookings"),
    businessMappings: async q =>
      map(await base.businessMappings(q), "business"),
    catalogue: async (type, q) =>
      map(await base.catalogue(type, q), `catalogue_${type}`),
    changes: async (cursor, limit) =>
      map(await base.changes(cursor, limit), "changes"),
  };
}
async function seed(large = false): Promise<HqImplementedSyncState> {
  const store = createHqImplementedMemoryStore();
  const result = await createHqImplementedEngine(
    large
      ? createHqLargeSyntheticReader({ bookingCount: 130, paddingBytes: 32 })
      : createHqImplementedSampleReader("initial"),
    store
  ).backfill();
  expect(result.status).toBe("applied");
  return (await store.readSync())!;
}
function initialStage(value: HqImplementedSyncState) {
  value.stage = {
    kind: "backfill",
    phase: "bookings",
    basePublishedVersion: value.published!.version,
    metadata: null,
    cursor: null,
    pendingResumeCursor: null,
    entities: copy(value.published!.entities),
    seqProofs: {},
    feedKeys: { booking: [], business: [] },
    catalogueKeys: { booking: [], business: [] },
    cursors: [],
    pages: 0,
    recordsRead: 0,
    lastSeq: null,
  };
  return value;
}
async function parity(
  readerFactory: () => HqWireReader,
  initial: HqImplementedSyncState | null = null,
  method: "sync" | "backfill" | "catchup" = "sync"
) {
  const outcomes = [];
  for (const options of [{}, cooperative()]) {
    const store = createHqImplementedMemoryStore(initial);
    const calls: string[] = [];
    const reader = mapReader(readerFactory(), (page, name) => {
      calls.push(name);
      return page;
    });
    const result = await createHqImplementedEngine(reader, store, options)[
      method
    ]();
    outcomes.push({ result, durable: await store.readSync(), calls });
  }
  expect(JSON.stringify(outcomes[1])).toBe(JSON.stringify(outcomes[0]));
  return outcomes[1];
}

describe("opt-in cooperative HQ durable parity and unchanged source-method budget", () => {
  it("matches complete synthetic backfill/catchup, cancelled and registered-pending raw statuses and report coverage", async () => {
    const { durable, result } = await parity(() =>
      createHqLargeSyntheticReader({ bookingCount: 130, paddingBytes: 64 })
    );
    expect(result.status).toBe("applied");
    expect(durable!.stage).toBeNull();
    const pending = Object.values(durable!.published!.entities).find(
      record =>
        record.entity.payload.status === "pending" &&
        (record.entity.payload as any).dates.portalRegisteredAt !== null
    )!;
    expect(pending.entity.payload).toMatchObject({
      status: "pending",
      eligibility: { activeSalesHeadline: false },
      financials: { headlineEligible: true },
    });
    const report = await getHqReport(
      durable!.published!,
      { resolve: async () => null },
      { year: 2026 }
    );
    expect(report.cohorts.pendingCount).toBeGreaterThan(0);
    expect(report.cohorts.cancelledCount).toBeGreaterThan(0);
    expect(report.totals.grossProfit.coveredCount).toBeLessThan(
      report.totals.bookingCount
    );
    const unchanged = await parity(
      () =>
        createHqLargeSyntheticReader({ bookingCount: 130, paddingBytes: 64 }),
      durable,
      "catchup"
    );
    expect(unchanged.result).toMatchObject({
      status: "applied",
      unchanged: true,
    });
  });

  it("matches every durable amendment/cancellation/registration step and historical replay proof", async () => {
    let state = await seed();
    for (const scenario of ["amended", "cancelled", "registered"] as const) {
      const result = await parity(
        () => createHqImplementedSampleReader(scenario),
        state,
        "catchup"
      );
      expect(result.result.status).toBe("applied");
      state = result.durable!;
    }
    expect(Object.keys(state.published!.seqProofs)).toEqual(["2", "3", "4"]);
  });

  it("preserves raw extra fields, money strings/numbers, null, surrogate strings and replacement semantics", async () => {
    const reader = () =>
      mapReader(createHqImplementedSampleReader("initial"), (page, method) => {
        if (method !== "bookings") return page;
        page.items[0].rawEnvelopeExtra = {
          z: "001.00",
          a: 1e-7,
          zero: -0,
          nil: null,
        };
        page.items[0].payload.rawDiagnostics = {
          escaped: '\ud800"\\\n',
          nested: [null, { text: "£😀" }],
        };
        return page;
      });
    const { durable } = await parity(reader, null, "backfill");
    const entity = durable!.published!.entities["booking:1"].entity as any;
    expect(entity.rawEnvelopeExtra).toEqual({
      z: "001.00",
      a: 1e-7,
      zero: 0,
      nil: null,
    });
    expect(entity.payload.bookingTotal).toBe("10000.00");
    expect(durable!.published!.entities["booking:1"].canonicalPayload).toBe(
      canonicalHqJson(entity)
    );
  });

  it("preserves JSON omission, array null conversion and numeric spelling in validated stage/record extensions", async () => {
    const initial = initialStage(await seed());
    const extra = {
      omitted: undefined,
      values: [undefined, , null, -0, 1e-7, NaN, Infinity],
      text: "001.00",
      nested: { x: undefined, y: null },
    };
    (initial.stage as any).extra = extra;
    for (const part of [initial.published, initial.stage])
      (part!.entities["booking:1"] as any).diagnostics = extra;
    validateHqImplementedSyncState(initial);
    await validateHqImplementedSyncStateAsync(
      initial,
      cooperative(),
      async () => {}
    );
    const outcomes = [];
    for (const options of [{}, cooperative()]) {
      let state = structuredClone(initial);
      const writes: HqImplementedSyncState[] = [];
      const store: HqImplementedStore = {
        readSync: async () => structuredClone(state),
        compareAndSwapSync: async (expected, next) => {
          if (state.version !== expected) return false;
          writes.push(copy(next));
          state = copy(next);
          return true;
        },
      };
      let methods = 0;
      const result = await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        store,
        {
          ...options,
          shouldContinue: () => ++methods <= 3,
        }
      ).sync();
      outcomes.push({ result, writes, state, methods });
    }
    expect(JSON.stringify(outcomes[1])).toBe(JSON.stringify(outcomes[0]));
    expect(outcomes[1].writes[0].stage).toMatchObject({
      extra: { values: [null, null, null, 0, 1e-7, null, null] },
    });
    expect(
      Object.hasOwn((outcomes[1].writes[0].stage as any).extra, "omitted")
    ).toBe(false);
    expect(initial.stage!.phase).toBe("bookings");
  });

  it("matches controlled 410 expiry, durable backfill intent and bounded recovery source calls", async () => {
    const initial = await seed();
    const { result, calls } = await parity(
      () => ({
        ...createHqImplementedSampleReader("amended"),
        changes: async () => {
          throw Object.assign(new Error("secret"), {
            code: "RESTART_REQUIRED",
            status: 410,
          });
        },
      }),
      initial
    );
    expect(result.status).toBe("applied");
    // The wrapping map records successful methods; changes throws before map observes it.
    expect(calls).toEqual([
      "status",
      "capabilities",
      "status",
      "capabilities",
      "bookings",
      "business",
      "catalogue_booking",
      "catalogue_business",
    ]);
  });

  it.each([false, true])(
    "removes only the duplicate initial read (cooperative=%s), retaining failed CAS reread",
    async enabled => {
      let reads = 0;
      const memory = createHqImplementedMemoryStore();
      const store: HqImplementedStore = {
        readSync: async () => {
          reads++;
          return memory.readSync();
        },
        compareAndSwapSync: (expected, next) =>
          memory.compareAndSwapSync(expected, next),
      };
      let starts = 0;
      const result = await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        store,
        {
          ...(enabled ? cooperative() : {}),
          shouldContinue: () => ++starts <= 3,
        }
      ).sync();
      expect(result.status).toBe("yielded");
      expect(reads).toBe(1);
      expect(starts).toBe(4);
      const winner = await seed();
      reads = 0;
      const conflict = await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        {
          readSync: async () => (++reads === 1 ? null : copy(winner)),
          compareAndSwapSync: async () => false,
        },
        enabled ? cooperative() : {}
      ).sync();
      expect(conflict).toMatchObject({
        status: "unavailable",
        code: "CAS_CONFLICT",
        state: winner.published,
      });
      expect(reads).toBe(2);
    }
  );

  it("keeps named engine cap errors identical and opts in only with a checkpoint", async () => {
    const initial = await seed();
    for (const caps of [
      { maxPages: 1 },
      { maxRecords: 1 },
      { maxStateBytes: 1 },
    ]) {
      const outcomes = [];
      for (const mode of [{}, cooperative()]) {
        const store = createHqImplementedMemoryStore(initial);
        outcomes.push(
          await createHqImplementedEngine(
            createHqImplementedSampleReader("amended"),
            store,
            { ...mode, ...caps }
          ).sync()
        );
      }
      expect(outcomes[1]).toEqual(outcomes[0]);
    }
    const asyncMeasure = vi.fn(async (value: unknown) => exactBytes(value));
    const syncMeasure = vi.fn(exactBytes);
    expect(
      (
        await createHqImplementedEngine(
          createHqImplementedSampleReader("initial"),
          createHqImplementedMemoryStore(),
          {
            ...cooperative(),
            measureStateBytes: syncMeasure,
            measureStateBytesAsync: asyncMeasure,
          }
        ).sync()
      ).status
    ).toBe("applied");
    expect(asyncMeasure).toHaveBeenCalled();
    expect(syncMeasure).not.toHaveBeenCalled();
    asyncMeasure.mockClear();
    expect(
      (
        await createHqImplementedEngine(
          createHqImplementedSampleReader("initial"),
          createHqImplementedMemoryStore(),
          {
            measureStateBytes: syncMeasure,
            measureStateBytesAsync: asyncMeasure,
          }
        ).sync()
      ).status
    ).toBe("applied");
    expect(asyncMeasure).not.toHaveBeenCalled();
    expect(syncMeasure).toHaveBeenCalled();
  });
});

describe("shared synchronous/cooperative persisted validation", () => {
  it("matches every corrupt record, metadata, progress, replay and byte cap error without mutation", async () => {
    const good = await seed();
    const cases: unknown[] = [
      null,
      undefined,
      false,
      0,
      "",
      [],
      {},
      { version: 1, published: false, stage: null },
      good,
      initialStage(copy(good)),
    ];
    const mutations: Array<(v: HqImplementedSyncState) => void> = [
      v => {
        v.version = -1;
      },
      v => {
        v.published!.scope = "other" as any;
      },
      v => {
        v.published!.entities["booking:1"].canonicalPayload = "{}";
      },
      v => {
        (v.published!.entities["booking:1"].entity.payload as any).dates.month =
          "2025-01";
      },
      v => {
        (
          v.published!.entities["booking:1"].entity.payload as any
        ).financials.headlineEligible = "bad";
      },
      v => {
        v.published!.seqProofs["0"] = "a".repeat(64);
      },
      v => {
        initialStage(v).stage!.basePublishedVersion = 999;
      },
      v => {
        initialStage(v).stage!.entities["booking:1"].absent = true;
      },
      v => {
        initialStage(v).stage!.feedKeys.booking = ["booking:1"];
      },
    ];
    for (const mutate of mutations) {
      const value = copy(good);
      mutate(value);
      cases.push(value);
    }
    for (const value of cases) {
      const before = value === undefined ? undefined : JSON.stringify(value);
      for (const options of [
        {},
        { maxStateBytes: 1 },
        { maxRecords: 1 },
        { maxPages: 0 },
      ]) {
        let expected: string | null = null;
        try {
          validateHqImplementedSyncState(value, options);
        } catch (error) {
          expected = (error as Error).message;
        }
        let actual: string | null = null;
        try {
          await validateHqImplementedSyncStateAsync(
            value,
            options,
            async () => {}
          );
        } catch (error) {
          actual = (error as Error).message;
        }
        expect(actual).toBe(expected);
        expect(value === undefined ? undefined : JSON.stringify(value)).toBe(
          before
        );
      }
    }
  });

  it("retains exact restored cursor, membership, phase and sequence acceptance", async () => {
    const memory = createHqImplementedMemoryStore(await seed());
    let starts = 0;
    await createHqImplementedEngine(
      createHqImplementedSampleReader("amended"),
      memory,
      {
        shouldContinue: () => ++starts <= 3,
      }
    ).backfill();
    const good = (await memory.readSync())!;
    const mutate = [
      (v: HqImplementedSyncState) => {
        v.stage!.phase = "changes";
      },
      (v: HqImplementedSyncState) => {
        v.stage!.pages = -1;
      },
      (v: HqImplementedSyncState) => {
        v.stage!.lastSeq = 999;
      },
      (v: HqImplementedSyncState) => {
        v.stage!.pendingResumeCursor = "bad\n";
      },
      (v: HqImplementedSyncState) => {
        v.stage!.cursors = ["same", "same"];
        v.stage!.pages = 2;
      },
      (v: HqImplementedSyncState) => {
        v.stage!.feedKeys.booking = ["booking:999"];
      },
      (v: HqImplementedSyncState) => {
        v.stage!.feedKeys.booking = ["booking:1", "booking:1"];
      },
      (v: HqImplementedSyncState) => {
        v.stage!.catalogueKeys.business = ["booking:1"];
      },
      (v: HqImplementedSyncState) => {
        v.stage!.cursors = new Array(1);
      },
      (v: HqImplementedSyncState) => {
        v.stage!.feedKeys.booking = new Array(1);
      },
    ];
    for (const change of [() => {}, ...mutate]) {
      const value = structuredClone(good);
      change(value);
      let syncError: string | null = null,
        asyncError: string | null = null;
      try {
        validateHqImplementedSyncState(value);
      } catch (error) {
        syncError = (error as Error).message;
      }
      try {
        await validateHqImplementedSyncStateAsync(
          value,
          cooperative(),
          async () => {}
        );
      } catch (error) {
        asyncError = (error as Error).message;
      }
      expect(asyncError).toBe(syncError);
    }
  });

  it("uses the async byte profile exactly, brackets it with checkpoints and keeps byte acceptance identical", async () => {
    const state = await seed();
    const bytes = exactBytes(state);
    const order: string[] = [];
    const syncMeasure = vi.fn(() => {
      throw new Error("Must not use synchronous byte profile");
    });
    await validateHqImplementedSyncStateAsync(
      state,
      {
        maxStateBytes: bytes,
        measureStateBytes: syncMeasure,
        measureStateBytesAsync: async (value, maximum) => {
          order.push("measure");
          expect(value).toBe(state);
          expect(maximum).toBe(bytes);
          return exactBytes(value);
        },
      },
      async () => {
        order.push("checkpoint");
      }
    );
    expect(order.slice(0, 3)).toEqual(["checkpoint", "measure", "checkpoint"]);
    expect(syncMeasure).not.toHaveBeenCalled();
    for (const measured of [-1, NaN, Infinity, 1.5, bytes + 1]) {
      expect(() =>
        validateHqImplementedSyncState(state, {
          maxStateBytes: bytes,
          measureStateBytes: () => measured,
        })
      ).toThrow("INVALID_PERSISTED_STATE");
      await expect(
        validateHqImplementedSyncStateAsync(
          state,
          {
            maxStateBytes: bytes,
            measureStateBytesAsync: async () => measured,
          },
          async () => {}
        )
      ).rejects.toThrow("INVALID_PERSISTED_STATE");
    }
  });

  it("yields through large record/proof/container walks and interrupts before completion without a terminal sync revalidation", async () => {
    const state = initialStage(await seed(true));
    state.published!.metadata.changeUpper = 200;
    for (let seq = 1; seq <= 200; seq++)
      state.published!.seqProofs[String(seq)] = "a".repeat(64);
    validateHqImplementedSyncState(state);
    let heartbeats = 0;
    const heartbeat = setInterval(() => {
      heartbeats++;
    }, 0);
    let calls = 0;
    try {
      await validateHqImplementedSyncStateAsync(
        state,
        cooperative(),
        async () => {
          calls++;
          if (calls % 64 === 0)
            await new Promise<void>(resolve => setImmediate(resolve));
        }
      );
    } finally {
      clearInterval(heartbeat);
    }
    expect(calls).toBeGreaterThan(500);
    expect(heartbeats).toBeGreaterThan(0);
    const denial = Object.assign(new Error("private authority details"), {
      code: "LEASE_LOST",
    });
    calls = 0;
    await expect(
      validateHqImplementedSyncStateAsync(state, cooperative(), async () => {
        if (++calls === 100) throw denial;
      })
    ).rejects.toBe(denial);
    expect(calls).toBe(100);
  });
});

describe("cooperative interruption and immutable CAS captures", () => {
  it.each(["measurement", "equality"])(
    "rejects a revoked %s continuation before publication CAS",
    async boundary => {
      const initial = await seed();
      const memory = createHqImplementedMemoryStore(initial);
      let armed = false,
        denied = false;
      const denial = Object.assign(new Error("private binding"), {
        code: "SOURCE_BINDING_CHANGED",
      });
      const checkpoint = async () => {
        if (armed && !denied) {
          denied = true;
          throw denial;
        }
      };
      const writes: HqImplementedSyncState[] = [];
      const store: HqImplementedStore = {
        readSync: () => memory.readSync(),
        compareAndSwapSync: async (expected, next) => {
          writes.push(copy(next));
          const applied = await memory.compareAndSwapSync(expected, next);
          if (boundary === "equality" && next.stage?.phase === "finish")
            armed = true;
          return applied;
        },
      };
      const options = cooperative(checkpoint);
      options.measureStateBytesAsync = async value => {
        const bytes = exactBytes(value);
        await new Promise<void>(resolve => setImmediate(resolve));
        if (
          boundary === "measurement" &&
          (value as HqImplementedSyncState)?.stage?.pages === 1
        )
          armed = true;
        return bytes;
      };
      const result = await createHqImplementedEngine(
        createHqImplementedSampleReader("amended"),
        store,
        options
      ).catchup();
      expect(result).toMatchObject({
        status: "unavailable",
        code: "SOURCE_BINDING_CHANGED",
        state: initial.published,
      });
      expect(denied).toBe(true);
      expect(writes).toHaveLength(boundary === "measurement" ? 0 : 1);
      expect((await memory.readSync())!.published).toEqual(initial.published);
      expect(writes.every(write => write.stage !== null)).toBe(true);
    }
  );

  it("exports a cooperative JSON copy with native omission/null/numeric/key semantics and no shared records", async () => {
    const state = initialStage(await seed());
    const extra: any = {
      omitted: undefined,
      arrays: [undefined, , -0, NaN, Infinity, null],
      text: "\ud800£😀",
      number: 1e-7,
    };
    Object.defineProperty(extra, "__proto__", {
      value: { safe: true },
      enumerable: true,
    });
    (state.stage as any).extra = extra;
    (state.stage!.entities["booking:1"] as any).extra = extra;
    const expected = copy(state);
    let checkpoints = 0;
    const clone = await cloneHqJsonAsync(state, async () => {
      checkpoints++;
    });
    expect(JSON.stringify(clone)).toBe(JSON.stringify(expected));
    expect(checkpoints).toBeGreaterThan(10);
    expect(clone.stage).not.toBe(state.stage);
    expect(clone.stage!.entities["booking:1"]).not.toBe(
      state.stage!.entities["booking:1"]
    );
    (clone.stage as any).extra.arrays.push("mutated");
    clone.stage!.entities["booking:1"].absent = true;
    expect(JSON.stringify(state)).toBe(JSON.stringify(expected));
    const denial = Object.assign(new Error("private"), { code: "LEASE_LOST" });
    await expect(
      cloneHqJsonAsync(state, async () => {
        throw denial;
      })
    ).rejects.toBe(denial);
    for (const root of [undefined, () => {}, Symbol("omitted"), BigInt(1)])
      await expect(cloneHqJsonAsync(root, async () => {})).rejects.toThrow();
  });

  it("does not alias current snapshots, earlier page CAS or result state during reconciliation and later catchup", async () => {
    const original = await seed();
    const before = copy(original);
    let state = original;
    const captures: HqImplementedSyncState[] = [];
    const bytesAtWrite: string[] = [];
    const store: HqImplementedStore = {
      // Intentionally return the same object: engine must not mutate supplied current snapshots.
      readSync: async () => state,
      compareAndSwapSync: async (expected, next) => {
        expect(expected).toBe(state.version);
        captures.push(next);
        bytesAtWrite.push(JSON.stringify(next));
        state = next;
        return true;
      },
    };
    const reader = mapReader(
      createHqImplementedSampleReader("amended"),
      (page, method) => {
        if (method === "capabilities") return page;
        return {
          ...page,
          counts: { bookingCount: 0, businessCount: 1 },
          ...(method === "bookings" || method === "catalogue_booking"
            ? { items: [] }
            : {}),
        };
      }
    );
    const result = await createHqImplementedEngine(
      reader,
      store,
      cooperative()
    ).backfill();
    expect(result.status).toBe("applied");
    expect(original).toEqual(before);
    for (let index = 0; index < captures.length; index++)
      expect(JSON.stringify(captures[index])).toBe(bytesAtWrite[index]);
    expect(captures.at(-2)!.stage!.entities["booking:1"].absent).toBe(false);
    expect(state.published!.entities["booking:1"].absent).toBe(true);
    if (result.status !== "applied") throw new Error(result.code);
    result.state.entities["booking:1"].absent = false;
    (
      result.state.entities["business:90052"].entity.payload as any
    ).account.businessName = "mutated return";
    expect(JSON.stringify(state)).toBe(bytesAtWrite.at(-1));
    await createHqImplementedEngine(
      createHqImplementedSampleReader("registered"),
      store,
      cooperative()
    ).catchup();
    for (let index = 0; index < captures.length; index++)
      expect(JSON.stringify(captures[index])).toBe(bytesAtWrite[index]);
  });

  it.each(["LEASE_LOST", "AUTH_DENIED", "SOURCE_BINDING_CHANGED"])(
    "interrupts during clone with %s and no writes/source calls",
    async code => {
      const initial = await seed();
      const memory = createHqImplementedMemoryStore(initial);
      const reader = createHqImplementedSampleReader("amended");
      const status = vi.spyOn(reader, "status");
      const cas = vi.fn((expected, next) =>
        memory.compareAndSwapSync(expected, next)
      );
      const denial = Object.assign(new Error("secret must not escape"), {
        code,
      });
      let armed = false,
        interrupted = false;
      const checkpoint = async () => {
        if (armed && !interrupted) {
          interrupted = true;
          throw denial;
        }
      };
      const originalCaps = reader.capabilities;
      reader.capabilities = async () => {
        const result = await originalCaps();
        armed = true;
        return result;
      };
      const result = await createHqImplementedEngine(
        reader,
        { readSync: () => memory.readSync(), compareAndSwapSync: cas },
        cooperative(checkpoint)
      ).catchup();
      expect(result).toMatchObject({
        status: "unavailable",
        code,
        state: initial.published,
      });
      expect(status).toHaveBeenCalledOnce();
      expect(cas).not.toHaveBeenCalled();
      expect(await memory.readSync()).toEqual(initial);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  );

  it("a latched revocation during page processing cannot commit or retry the page", async () => {
    const initial = await seed();
    const memory = createHqImplementedMemoryStore(initial);
    const reader = createHqImplementedSampleReader("amended");
    let revoked = false;
    const change = reader.changes;
    const changes = vi.fn(
      async (...args: Parameters<HqWireReader["changes"]>) => {
        const page = await change(...args);
        revoked = true;
        return page;
      }
    );
    const cas = vi.fn((expected, next) =>
      memory.compareAndSwapSync(expected, next)
    );
    const checkpoint = async () => {
      if (revoked)
        throw Object.assign(new Error("private"), { code: "AUTH_DENIED" });
    };
    const result = await createHqImplementedEngine(
      { ...reader, changes },
      { readSync: () => memory.readSync(), compareAndSwapSync: cas },
      cooperative(checkpoint)
    ).catchup();
    // Recovery read is still mandatory; the same latch denies its validation as at the old store boundary.
    expect(result).toMatchObject({
      status: "unavailable",
      code: "STORE_UNAVAILABLE",
      state: null,
    });
    expect(changes).toHaveBeenCalledOnce();
    expect(cas).not.toHaveBeenCalled();
    expect(await memory.readSync()).toEqual(initial);
  });

  it("propagates async-measure authority denial from the exported validator without invalid-state relabeling", async () => {
    const denial = Object.assign(new Error("private"), {
      code: "SOURCE_BINDING_CHANGED",
    });
    await expect(
      validateHqImplementedSyncStateAsync(
        await seed(),
        {
          measureStateBytesAsync: async () => {
            throw denial;
          },
        },
        async () => {}
      )
    ).rejects.toBe(denial);
  });
});
