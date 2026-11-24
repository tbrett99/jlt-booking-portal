import { afterEach, describe, expect, it, vi } from "vitest";
import type { HqWireEntity, HqWireReader } from "../shared/management-hq-wire";
import * as canonicalEngine from "./management-hq-engine";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  validateHqImplementedSyncState,
  type HqImplementedRecord,
  type HqImplementedStage,
  type HqImplementedState,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import { HQ_LIVE_V2_VALIDATION_OPTIONS } from "./management-hq-storage-v2";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Change object insertion order at every depth, but never reorder arrays. */
function reverseObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseObjectKeys) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([name, child]) => [name, reverseObjectKeys(child)])
  ) as T;
}

type Extension = {
  nested: { alpha: string; beta: { enabled: boolean; value: number } };
  ordered: { label: string; value: number }[];
  optional: null | { present: boolean };
};
type ExtendedRecord = HqImplementedRecord & {
  localExtra?: { note: string; labels: string[] };
};
function extension(record: HqImplementedRecord): Extension {
  return record.entity.payload.equalityRegression as Extension;
}
function bookingRecord(state: HqImplementedState | HqImplementedStage) {
  return Object.values(state.entities).find(
    record => record.entity.entityType === "booking"
  )! as ExtendedRecord;
}
function recanonicalize(record: HqImplementedRecord) {
  record.canonicalPayload = canonicalEngine.canonicalHqJson(record.entity);
}
function extendedReader(): HqWireReader {
  const base = createHqImplementedSampleReader("initial");
  return {
    ...base,
    async bookings(query) {
      const page = await base.bookings(query);
      return {
        ...page,
        items: page.items.map(entity => ({
          ...entity,
          payload: {
            ...entity.payload,
            equalityRegression: {
              nested: {
                alpha: "unchanged",
                beta: { enabled: true, value: 0 },
              },
              ordered: [
                { label: "first", value: 1 },
                { label: "second", value: 2 },
              ],
              optional: null,
            },
          },
        })) as HqWireEntity[],
      };
    },
  };
}
async function publishedContainer(
  reader: HqWireReader = extendedReader()
): Promise<HqImplementedSyncState> {
  const store = createHqImplementedMemoryStore();
  const result = await createHqImplementedEngine(
    reader,
    store,
    HQ_LIVE_V2_VALIDATION_OPTIONS
  ).backfill();
  expect(result.status).toBe("applied");
  const container = (await store.readSync())!;
  // Existing ingestion validation permits record extensions; equality must not
  // silently reduce full records to only their declared fields or payloads.
  bookingRecord(container.published!).localExtra = {
    note: "retained record extension",
    labels: ["one", "two"],
  };
  return container;
}
function withInitialStage(
  container: HqImplementedSyncState
): HqImplementedSyncState {
  const value = copy(container);
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
function withFinishedStage(
  container: HqImplementedSyncState
): HqImplementedSyncState {
  const value = withInitialStage(container);
  Object.assign(value.stage!, {
    kind: "catchup",
    phase: "finish",
    metadata: copy(value.published!.metadata),
    pendingResumeCursor: value.published!.resumeCursor,
    seqProofs: copy(value.published!.seqProofs),
    pages: 1,
  });
  return value;
}
function nextPublication(value: HqImplementedSyncState): HqImplementedState {
  return {
    wireVersion: "1.0.0",
    version: value.published!.version + 1,
    scope: value.published!.scope,
    resumeCursor: value.stage!.pendingResumeCursor!,
    metadata: value.stage!.metadata!,
    entities: value.stage!.entities,
    seqProofs: value.stage!.seqProofs,
  };
}
function canonicalPublicationEqual(value: HqImplementedSyncState): boolean {
  return (
    canonicalEngine.canonicalHqJson({ ...value.published!, version: 0 }) ===
    canonicalEngine.canonicalHqJson({ ...nextPublication(value), version: 0 })
  );
}

afterEach(() => vi.restoreAllMocks());

describe("storage-v2 initial-stage exact canonical equality", () => {
  it("accepts reordered map, record and nested object keys without changing arrays or canonical payload spelling", async () => {
    const value = withInitialStage(await publishedContainer());
    value.stage!.entities = reverseObjectKeys(value.stage!.entities);
    expect(JSON.stringify(value.stage!.entities)).not.toBe(
      JSON.stringify(value.published!.entities)
    );
    expect(canonicalEngine.canonicalHqJson(value.stage!.entities)).toBe(
      canonicalEngine.canonicalHqJson(value.published!.entities)
    );
    const before = copy(value);
    expect(() =>
      validateHqImplementedSyncState(value, HQ_LIVE_V2_VALIDATION_OPTIONS)
    ).not.toThrow();
    const reader = extendedReader();
    const status = vi.spyOn(reader, "status");
    const store = createHqImplementedMemoryStore(value);
    const write = vi.spyOn(store, "compareAndSwapSync");
    expect(
      await createHqImplementedEngine(reader, store, {
        ...HQ_LIVE_V2_VALIDATION_OPTIONS,
        shouldContinue: () => false,
      }).sync()
    ).toEqual({
      status: "yielded",
      code: "BATCH_YIELDED",
      state: value.published,
    });
    expect(status).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(value).toEqual(before);
    expect(await store.readSync()).toEqual(before);
  });

  const mismatches: [string, (value: HqImplementedSyncState) => void][] = [
    [
      "nested extension value",
      value => {
        const record = bookingRecord(value.stage!);
        extension(record).nested.beta.value = 1;
        recanonicalize(record);
      },
    ],
    [
      "extension array order",
      value => {
        const record = bookingRecord(value.stage!);
        extension(record).ordered.reverse();
        recanonicalize(record);
      },
    ],
    [
      "nested array item value",
      value => {
        const record = bookingRecord(value.stage!);
        extension(record).ordered[1].value = 3;
        recanonicalize(record);
      },
    ],
    [
      "null versus object extension",
      value => {
        const record = bookingRecord(value.stage!);
        extension(record).optional = { present: true };
        recanonicalize(record);
      },
    ],
    [
      "record extra added",
      value => {
        Object.assign(bookingRecord(value.stage!), { anotherExtra: true });
      },
    ],
    [
      "record extra removed",
      value => {
        delete bookingRecord(value.stage!).localExtra;
      },
    ],
    [
      "record extra changed",
      value => {
        bookingRecord(value.stage!).localExtra!.labels.reverse();
      },
    ],
    [
      "canonical payload spelling",
      value => {
        const record = bookingRecord(value.stage!);
        record.canonicalPayload = JSON.stringify(
          JSON.parse(record.canonicalPayload),
          null,
          2
        );
        expect(JSON.parse(record.canonicalPayload)).toEqual(record.entity);
      },
    ],
    [
      "absence flag",
      value => {
        bookingRecord(value.stage!).absent = true;
      },
    ],
    [
      "entity-map member removed",
      value => {
        const id = Object.keys(value.stage!.entities)[0];
        delete value.stage!.entities[id];
      },
    ],
  ];
  it.each(mismatches)(
    "rejects a changed %s before source calls or writes",
    async (_name, mutate) => {
      const value = withInitialStage(await publishedContainer());
      mutate(value);
      expect(canonicalEngine.canonicalHqJson(value.stage!.entities)).not.toBe(
        canonicalEngine.canonicalHqJson(value.published!.entities)
      );
      const before = copy(value);
      expect(() =>
        validateHqImplementedSyncState(value, HQ_LIVE_V2_VALIDATION_OPTIONS)
      ).toThrow("INVALID_PERSISTED_STATE");
      const reader = extendedReader();
      const status = vi.spyOn(reader, "status");
      const store = createHqImplementedMemoryStore(value);
      const write = vi.spyOn(store, "compareAndSwapSync");
      expect(
        await createHqImplementedEngine(
          reader,
          store,
          HQ_LIVE_V2_VALIDATION_OPTIONS
        ).sync()
      ).toMatchObject({
        status: "unavailable",
        code: "INVALID_PERSISTED_STATE",
        state: null,
      });
      expect(status).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(value).toEqual(before);
      expect(await store.readSync()).toEqual(before);
    }
  );
});

describe("storage-v2 completed ingestion publication equality", () => {
  it("ignores object key order and only the local publication version, retaining full-record extras on unchanged publication", async () => {
    const value = withFinishedStage(await publishedContainer());
    value.published = reverseObjectKeys(value.published);
    value.stage!.entities = reverseObjectKeys(value.stage!.entities);
    value.stage!.metadata = reverseObjectKeys(value.stage!.metadata);
    value.stage!.seqProofs = reverseObjectKeys(value.stage!.seqProofs);
    expect(canonicalPublicationEqual(value)).toBe(true);
    expect(() =>
      validateHqImplementedSyncState(value, HQ_LIVE_V2_VALIDATION_OPTIONS)
    ).not.toThrow();
    const reader = extendedReader();
    const bookings = vi.spyOn(reader, "bookings");
    const changes = vi.spyOn(reader, "changes");
    const store = createHqImplementedMemoryStore(value);
    const write = vi.spyOn(store, "compareAndSwapSync");
    const result = await createHqImplementedEngine(
      reader,
      store,
      HQ_LIVE_V2_VALIDATION_OPTIONS
    ).sync();
    expect(result).toMatchObject({
      status: "applied",
      unchanged: true,
      pages: 1,
      recordsRead: 0,
      state: { version: value.published!.version },
    });
    expect(bookings).not.toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledOnce();
    const stored = (await store.readSync())!;
    expect(stored.version).toBe(value.version + 1);
    expect(stored.stage).toBeNull();
    expect(stored.published).toEqual(value.published);
    expect(bookingRecord(stored.published!).localExtra).toEqual(
      bookingRecord(value.published!).localExtra
    );
  });

  const changes: [string, (value: HqImplementedSyncState) => void][] = [
    [
      "nested extension value",
      value => {
        const record = bookingRecord(value.stage!);
        extension(record).nested.beta.value = 2;
        recanonicalize(record);
      },
    ],
    [
      "extension array order",
      value => {
        const record = bookingRecord(value.stage!);
        extension(record).ordered.reverse();
        recanonicalize(record);
      },
    ],
    [
      "nested array item value",
      value => {
        const record = bookingRecord(value.stage!);
        extension(record).ordered[0].label = "changed";
        recanonicalize(record);
      },
    ],
    [
      "record extra added",
      value => {
        Object.assign(bookingRecord(value.stage!), { anotherExtra: false });
      },
    ],
    [
      "record extra removed",
      value => {
        delete bookingRecord(value.stage!).localExtra;
      },
    ],
    [
      "record extra changed",
      value => {
        bookingRecord(value.stage!).localExtra!.note =
          "changed record extension";
      },
    ],
    [
      "absence flag",
      value => {
        bookingRecord(value.stage!).absent = true;
      },
    ],
    [
      "metadata health",
      value => {
        value.stage!.metadata!.sourceAgeSeconds += 1;
      },
    ],
    [
      "nested metadata extension",
      value => {
        value.stage!.metadata!.counts = {
          ...value.stage!.metadata!.counts,
          equalityRegression: { ordered: ["second", "first"] },
        };
      },
    ],
    [
      "resume cursor",
      value => {
        value.stage!.pendingResumeCursor = "offline-new-completed-checkpoint";
      },
    ],
    [
      "replay proof",
      value => {
        value.stage!.seqProofs["1"] = "a".repeat(64);
      },
    ],
    [
      "published whole-state extra removed by publication",
      value => {
        Object.assign(value.published!, {
          localPublicationExtra: { retained: true },
        });
      },
    ],
  ];
  it.each(changes)(
    "publishes a changed %s with a new version, rather than declaring it unchanged",
    async (_name, mutate) => {
      const value = withFinishedStage(await publishedContainer());
      mutate(value);
      // Each candidate is independently valid. These are equality decisions, not
      // errors accidentally caught by wire or persisted-record validation.
      expect(() =>
        validateHqImplementedSyncState(value, HQ_LIVE_V2_VALIDATION_OPTIONS)
      ).not.toThrow();
      expect(canonicalPublicationEqual(value)).toBe(false);
      const expected = copy(nextPublication(value));
      const store = createHqImplementedMemoryStore(value);
      const write = vi.spyOn(store, "compareAndSwapSync");
      const result = await createHqImplementedEngine(
        extendedReader(),
        store,
        HQ_LIVE_V2_VALIDATION_OPTIONS
      ).sync();
      expect(result).toMatchObject({ status: "applied", unchanged: false });
      if (result.status !== "applied")
        throw new Error("Offline publication failed");
      expect(result.state).toEqual(expected);
      expect(result.state.version).toBe(value.published!.version + 1);
      expect(write).toHaveBeenCalledOnce();
      const stored = (await store.readSync())!;
      expect(stored).toEqual({
        version: value.version + 1,
        published: expected,
        stage: null,
      });
      expect(() =>
        validateHqImplementedSyncState(stored, HQ_LIVE_V2_VALIDATION_OPTIONS)
      ).not.toThrow();
    }
  );

  it("rejects semantically identical but noncanonical payload spelling in a finished stage before publication", async () => {
    const value = withFinishedStage(await publishedContainer());
    const record = bookingRecord(value.stage!);
    record.canonicalPayload = JSON.stringify(
      JSON.parse(record.canonicalPayload),
      null,
      2
    );
    expect(JSON.parse(record.canonicalPayload)).toEqual(record.entity);
    expect(() =>
      validateHqImplementedSyncState(value, HQ_LIVE_V2_VALIDATION_OPTIONS)
    ).toThrow("INVALID_PERSISTED_STATE");
    const store = createHqImplementedMemoryStore(value);
    const write = vi.spyOn(store, "compareAndSwapSync");
    const reader = extendedReader();
    const status = vi.spyOn(reader, "status");
    expect(
      await createHqImplementedEngine(
        reader,
        store,
        HQ_LIVE_V2_VALIDATION_OPTIONS
      ).sync()
    ).toMatchObject({ status: "unavailable", code: "INVALID_PERSISTED_STATE" });
    expect(status).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(await store.readSync()).toEqual(value);
  });
});

describe("storage-v2 equality does not canonicalize aggregate state strings", () => {
  it.each(["initial-stage validation", "unchanged publication"] as const)(
    "keeps %s canonical serialization bounded to one record or scalar",
    async operation => {
      const reader = createHqLargeSyntheticReader({
        bookingCount: 12,
        paddingBytes: 256,
      });
      const base = await publishedContainer(reader);
      const value =
        operation === "initial-stage validation"
          ? withInitialStage(base)
          : withFinishedStage(base);
      value.stage!.entities = reverseObjectKeys(value.stage!.entities);
      const perRecordBound = Math.max(
        Buffer.byteLength(
          canonicalEngine.canonicalHqJson(base.published!.metadata)
        ),
        ...Object.values(base.published!.entities).map(record =>
          Math.max(
            Buffer.byteLength(canonicalEngine.canonicalHqJson(record.entity)),
            Buffer.byteLength(JSON.stringify(record.canonicalPayload))
          )
        )
      );
      expect(
        Buffer.byteLength(
          canonicalEngine.canonicalHqJson(value.stage!.entities)
        )
      ).toBeGreaterThan(perRecordBound * 2);
      // Spy only on the public canonical serializer imported by ingestion. Its
      // own recursive calls stay internal; existing JSON-copy behavior remains
      // allowed. Reintroducing either aggregate canonical comparison fails this.
      const serializer = vi.spyOn(canonicalEngine, "canonicalHqJson");
      if (operation === "initial-stage validation") {
        expect(() =>
          validateHqImplementedSyncState(value, HQ_LIVE_V2_VALIDATION_OPTIONS)
        ).not.toThrow();
      } else {
        const store = createHqImplementedMemoryStore(value);
        expect(
          await createHqImplementedEngine(
            reader,
            store,
            HQ_LIVE_V2_VALIDATION_OPTIONS
          ).sync()
        ).toMatchObject({ status: "applied", unchanged: true });
      }
      expect(serializer).toHaveBeenCalled();
      for (const [argument] of serializer.mock.calls) {
        if (argument === null || typeof argument !== "object") continue;
        expect(Object.hasOwn(argument, "entities")).toBe(false);
        expect(
          Object.keys(argument).some(name => /^(booking|business):/.test(name))
        ).toBe(false);
      }
      for (const result of serializer.mock.results) {
        expect(result.type).toBe("return");
        expect(typeof result.value).toBe("string");
        expect(Buffer.byteLength(result.value)).toBeLessThanOrEqual(
          perRecordBound
        );
      }
    }
  );
});
