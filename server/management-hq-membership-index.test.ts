import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HqWireReader } from "../shared/management-hq-wire";
import { canonicalHqJson } from "./management-hq-engine";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedOptions,
  type HqImplementedStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const token = "opaque-membership-next";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(() => vi.restoreAllMocks());

/** Three real-schema bookings; deliberately different feed/catalogue order and
 * one exact cross-page feed retry. Traversal tokens are shared across phases. */
async function tinyReader(): Promise<HqWireReader> {
  const base = createHqImplementedSampleReader("initial");
  const booking = await base.bookings();
  const business = await base.businessMappings();
  const catalogue = await base.catalogue("booking");
  const businessCatalogue = await base.catalogue("business");
  const counts = { bookingCount: 3, businessCount: 1 };
  const entities = [3, 1, 2].map(entityId => {
    const entity = copy(booking.items[0]);
    entity.entityId = entityId;
    Object.assign(entity.payload, {
      orbitBookingId: entityId,
      membershipProbe: {
        money: "001.00",
        number: 1e-7,
        nil: null,
        text: "£😀",
      },
    });
    return entity;
  });
  const entries = entities.map(({ entityType, entityId, revision }) => ({
    entityType,
    entityId,
    revision,
  }));
  return {
    ...base,
    status: async () => ({ ...(await base.status()), counts }),
    bookings: async query => ({
      ...copy(booking),
      counts,
      items: copy(
        query?.cursor ? [entities[1], entities[2]] : entities.slice(0, 2)
      ),
      complete: !!query?.cursor,
      nextCursor: query?.cursor ? null : token,
    }),
    businessMappings: async () => ({ ...copy(business), counts }),
    catalogue: async (type, query) =>
      type === "business"
        ? { ...copy(businessCatalogue), counts }
        : {
            ...copy(catalogue),
            counts,
            items: copy(
              query?.cursor ? [entries[0], entries[2]] : [entries[1]]
            ),
            complete: !!query?.cursor,
            nextCursor: query?.cursor ? null : token,
          },
  };
}

function capture(initial: HqImplementedSyncState | null = null) {
  const memory = createHqImplementedMemoryStore(initial);
  const writes: HqImplementedSyncState[] = [];
  const json: string[] = [];
  const canonical: string[] = [];
  const store: HqImplementedStore = {
    readSync: () => memory.readSync(),
    async compareAndSwapSync(expected, next) {
      if (!(await memory.compareAndSwapSync(expected, next))) return false;
      writes.push(copy(next));
      json.push(JSON.stringify(next));
      canonical.push(canonicalHqJson(next));
      return true;
    },
  };
  return { store, writes, json, canonical };
}
const cooperative: HqImplementedOptions = {
  cooperativeCheckpoint: async () => {},
};
async function firstPage(reader: HqWireReader, target: HqImplementedStore) {
  let budget = 3;
  expect(
    await createHqImplementedEngine(reader, target, {
      shouldContinue: () => budget-- > 0,
    }).sync()
  ).toEqual({ status: "yielded", code: "BATCH_YIELDED", state: null });
  return (await target.readSync())!;
}

// Baseline hashes are recorded from the pre-index engine, including every CAS.
const baselineJsonHash =
  "63ca412f14da0b443f1d4265f209730f20809d9431907be4553119453cfbdde1";
const baselineCanonicalHash =
  "69598b439c338d57b7ed01a88080e8f0e5c187c049ef5bc793b7fb1f79affaba";

describe("request-local HQ ingestion membership indexes", () => {
  it("preserves every ordered persisted array, raw record and canonical/JSON byte", async () => {
    const reader = await tinyReader();
    const target = capture();
    const result = await createHqImplementedEngine(reader, target.store).sync();
    expect(result).toMatchObject({
      status: "applied",
      pages: 6,
      recordsRead: 9,
    });
    expect(
      target.writes.map(
        write =>
          write.stage && {
            feed: write.stage.feedKeys,
            catalogue: write.stage.catalogueKeys,
            cursors: write.stage.cursors,
          }
      )
    ).toEqual([
      {
        feed: { booking: ["booking:3", "booking:1"], business: [] },
        catalogue: { booking: [], business: [] },
        cursors: [`bookings:${token}`],
      },
      {
        feed: {
          booking: ["booking:3", "booking:1", "booking:2"],
          business: [],
        },
        catalogue: { booking: [], business: [] },
        cursors: [`bookings:${token}`],
      },
      {
        feed: {
          booking: ["booking:3", "booking:1", "booking:2"],
          business: ["business:90052"],
        },
        catalogue: { booking: [], business: [] },
        cursors: [`bookings:${token}`],
      },
      {
        feed: {
          booking: ["booking:3", "booking:1", "booking:2"],
          business: ["business:90052"],
        },
        catalogue: { booking: ["booking:1"], business: [] },
        cursors: [`bookings:${token}`, `catalogue_booking:${token}`],
      },
      {
        feed: {
          booking: ["booking:3", "booking:1", "booking:2"],
          business: ["business:90052"],
        },
        catalogue: {
          booking: ["booking:1", "booking:3", "booking:2"],
          business: [],
        },
        cursors: [`bookings:${token}`, `catalogue_booking:${token}`],
      },
      {
        feed: {
          booking: ["booking:3", "booking:1", "booking:2"],
          business: ["business:90052"],
        },
        catalogue: {
          booking: ["booking:1", "booking:3", "booking:2"],
          business: ["business:90052"],
        },
        cursors: [`bookings:${token}`, `catalogue_booking:${token}`],
      },
      null,
    ]);
    expect([
      hash(target.json.join("\n")),
      hash(target.canonical.join("\n")),
    ]).toEqual([baselineJsonHash, baselineCanonicalHash]);
    const record = (await target.store.readSync())!.published!.entities[
      "booking:3"
    ];
    expect(record.entity).toEqual((await reader.bookings()).items[0]);
    expect(record.canonicalPayload).toBe(canonicalHqJson(record.entity));
    const asyncTarget = capture();
    expect(
      (
        await createHqImplementedEngine(
          await tinyReader(),
          asyncTarget.store,
          cooperative
        ).sync()
      ).status
    ).toBe("applied");
    expect(asyncTarget.json).toEqual(target.json);
    expect(asyncTarget.canonical).toEqual(target.canonical);
  });

  it("removes membership includes scans on cold and new-engine/new-request resumed paths", async () => {
    const nativeIncludes = Array.prototype.includes;
    let scans = 0;
    vi.spyOn(Array.prototype, "includes").mockImplementation(function (
      this: unknown[],
      value: unknown,
      fromIndex?: number
    ) {
      if (
        typeof value === "string" &&
        /^(?:booking|business):\d+$|^(?:bookings|business|catalogue_booking|catalogue_business|changes):opaque-membership-/.test(
          value
        )
      )
        scans++;
      return nativeIncludes.call(this, value, fromIndex);
    });
    for (const options of [{}, cooperative]) {
      const reader = await tinyReader();
      const target = capture();
      const persisted = await firstPage(reader, target.store);
      const restored = capture(copy(persisted));
      const engine = createHqImplementedEngine(
        await tinyReader(),
        restored.store,
        options
      );
      expect((await engine.sync()).status).toBe("applied");
      const cold = capture();
      expect(
        (
          await createHqImplementedEngine(
            await tinyReader(),
            cold.store,
            options
          ).sync()
        ).status
      ).toBe("applied");
      expect([...target.json, ...restored.json]).toEqual(cold.json);
      expect([...target.canonical, ...restored.canonical]).toEqual(
        cold.canonical
      );
      expect((await engine.backfill()).status).toBe("applied");
      expect(JSON.stringify(await restored.store.readSync())).not.toContain(
        "membershipIndex"
      );
    }
    expect(scans).toBe(0);
  });

  it("rejects a conflicting resumed feed retry without persisting the failed page", async () => {
    const reader = await tinyReader();
    const target = capture();
    const persisted = await firstPage(reader, target.store);
    const restored = capture(persisted);
    const page = await reader.bookings({ cursor: token });
    Object.assign(page.items[0].payload, { bookingRef: "conflicting retry" });
    expect(
      await createHqImplementedEngine(
        { ...reader, bookings: async () => copy(page) },
        restored.store
      ).sync()
    ).toMatchObject({ status: "unavailable", code: "REVISION_CONFLICT" });
    expect(await restored.store.readSync()).toEqual(persisted);
    expect(restored.writes).toEqual([]);
  });

  it("rejects an already-catalogued member after a persisted new-engine resume", async () => {
    const reader = await tinyReader();
    const target = capture();
    let budget = 6;
    expect(
      (
        await createHqImplementedEngine(reader, target.store, {
          shouldContinue: () => budget-- > 0,
        }).sync()
      ).status
    ).toBe("yielded");
    const persisted = (await target.store.readSync())!;
    expect(persisted.stage!.catalogueKeys.booking).toEqual(["booking:1"]);
    const restored = capture(persisted);
    const page = await reader.catalogue("booking", { cursor: token });
    page.items = [{ entityType: "booking", entityId: 1, revision: 1 }];
    expect(
      await createHqImplementedEngine(
        { ...reader, catalogue: async () => copy(page) },
        restored.store,
        cooperative
      ).sync()
    ).toMatchObject({
      status: "unavailable",
      code: "DUPLICATE_CATALOGUE_ENTRY",
    });
    expect(await restored.store.readSync()).toEqual(persisted);
    expect(restored.writes).toEqual([]);
  });

  it("rejects a historical cursor after resume even when it differs from the current cursor", async () => {
    const reader = await tinyReader();
    const target = capture();
    const persisted = await firstPage(reader, target.store);
    persisted.stage!.cursor = "opaque-membership-current";
    const restored = capture(persisted);
    const page = await reader.bookings();
    expect(
      await createHqImplementedEngine(
        { ...reader, bookings: async () => copy(page) },
        restored.store
      ).sync()
    ).toMatchObject({ status: "unavailable", code: "CURSOR_LOOP" });
    expect(await restored.store.readSync()).toEqual(persisted);
    expect(restored.writes).toEqual([]);
  });

  it("still rejects duplicate persisted feed, catalogue and cursor arrays before reader calls", async () => {
    const reader = await tinyReader();
    const target = capture();
    const good = await firstPage(reader, target.store);
    for (const member of ["feed", "catalogue", "cursor"] as const) {
      const damaged = copy(good);
      if (member === "feed") damaged.stage!.feedKeys.booking.push("booking:1");
      if (member === "catalogue")
        damaged.stage!.catalogueKeys.booking = ["booking:1", "booking:1"];
      if (member === "cursor") {
        damaged.stage!.cursors.push(`bookings:${token}`);
        damaged.stage!.pages = 2;
      }
      const source = await tinyReader();
      const status = vi.spyOn(source, "status");
      const restored = capture(damaged);
      expect(
        await createHqImplementedEngine(source, restored.store).sync()
      ).toMatchObject({
        status: "unavailable",
        code: "INVALID_PERSISTED_STATE",
        state: null,
      });
      expect(status).not.toHaveBeenCalled();
      expect(await restored.store.readSync()).toEqual(damaged);
      expect(restored.writes).toEqual([]);
    }
  });

  it("does not share membership across interleaved stores or repeated requests on one engine", async () => {
    const left = capture(),
      right = capture();
    const leftEngine = createHqImplementedEngine(
      await tinyReader(),
      left.store,
      cooperative
    );
    const rightEngine = createHqImplementedEngine(
      await tinyReader(),
      right.store,
      cooperative
    );
    expect(
      (await Promise.all([leftEngine.backfill(), rightEngine.backfill()])).map(
        result => result.status
      )
    ).toEqual(["applied", "applied"]);
    expect(left.json).toEqual(right.json);
    const before = (await left.store.readSync())!.published;
    expect(await leftEngine.backfill()).toMatchObject({
      status: "applied",
      unchanged: true,
    });
    expect((await left.store.readSync())!.published).toEqual(before);
    expect((await right.store.readSync())!.version).toBe(7);
  });

  it("discards unpersisted membership additions on cooperative denial and rebuilds for the next request", async () => {
    const reader = await tinyReader();
    const target = capture();
    const persisted = await firstPage(reader, target.store);
    const restored = capture(persisted);
    let itemsUntilDenial = 0;
    const bookings = reader.bookings;
    const interrupted: HqWireReader = {
      ...reader,
      bookings: async query => {
        const page = await bookings(query);
        itemsUntilDenial = 2; // Deny after booking:2 is added, not the booking:1 retry.
        return page;
      },
    };
    const result = await createHqImplementedEngine(
      interrupted,
      restored.store,
      {
        cooperativeCheckpoint: async () => {
          if (itemsUntilDenial > 0 && --itemsUntilDenial === 0) {
            throw Object.assign(new Error("offline denial"), {
              code: "AUTH_DENIED",
            });
          }
        },
      }
    ).sync();
    expect(result).toMatchObject({
      status: "unavailable",
      code: "AUTH_DENIED",
    });
    expect(await restored.store.readSync()).toEqual(persisted);
    expect(restored.writes).toEqual([]);
    expect(
      (
        await createHqImplementedEngine(
          await tinyReader(),
          restored.store,
          cooperative
        ).sync()
      ).status
    ).toBe("applied");
    expect(restored.writes[0].stage!.feedKeys.booking).toEqual([
      "booking:3",
      "booking:1",
      "booking:2",
    ]);
  });
});
