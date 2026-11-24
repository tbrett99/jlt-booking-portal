import { describe, expect, it, vi } from "vitest";
import type {
  HqWireReader,
  HqWireEntity,
  HqWireChange,
  HqWireMetadata,
} from "../shared/management-hq-wire";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  validateHqImplementedSyncState,
  type HqImplementedSyncState,
  type HqImplementedStore,
} from "./management-hq-ingestion";
import {
  createHqImplementedSampleReader,
  createHqImplementedSampleDirectory,
} from "./management-hq-implemented-fixtures";
import { getHqReport, canonicalHqJson } from "./management-hq-engine";
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const scope = "company_all_real_and_unattributed";
async function seed() {
  const store = createHqImplementedMemoryStore();
  const result = await createHqImplementedEngine(
    createHqImplementedSampleReader("initial"),
    store
  ).backfill();
  expect(result.status).toBe("applied");
  return store;
}
async function visible(store: HqImplementedStore) {
  return (await store.readSync())?.published ?? null;
}
function unavailable(code: string, status?: number): never {
  throw Object.assign(new Error("secret-cookie payload URL must not escape"), {
    code,
    status,
  });
}
function mapReader(
  base: HqWireReader,
  map: (page: any, endpoint: string) => any
): HqWireReader {
  return {
    async status() {
      return map(await base.status(), "status");
    },
    async capabilities() {
      return map(await base.capabilities(), "capabilities");
    },
    async bookings(q) {
      return map(await base.bookings(q), "bookings");
    },
    async businessMappings(q) {
      return map(await base.businessMappings(q), "business");
    },
    async catalogue(type, q) {
      return map(await base.catalogue(type, q), `catalogue_${type}`);
    },
    async changes(cursor, limit) {
      return map(await base.changes(cursor, limit), "changes");
    },
  };
}
async function changesReader(
  items: HqWireChange[],
  generationId = 2,
  changeUpper = 2
): Promise<HqWireReader> {
  const reader = createHqImplementedSampleReader("amended");
  const page = await reader.changes(
    (await createHqImplementedSampleReader("initial").bookings()).resumeCursor
  );
  return {
    ...reader,
    async changes() {
      return {
        ...copy(page),
        generationId,
        changeUpper,
        items: copy(items),
        resumeCursor: `opaque-test-committed-${generationId}-${changeUpper}`,
      };
    },
  };
}
async function amendment(): Promise<HqWireChange> {
  return (
    await createHqImplementedSampleReader("amended").changes(
      (await createHqImplementedSampleReader("initial").bookings()).resumeCursor
    )
  ).items[0];
}

describe("implemented Management HQ complete pinned ingestion", () => {
  it("runs status, capabilities, bookings, business and both catalogues before checkpoint publication", async () => {
    const base = createHqImplementedSampleReader("initial"),
      store = createHqImplementedMemoryStore();
    const calls: string[] = [];
    const reader = mapReader(base, (p, endpoint) => {
      calls.push(endpoint);
      return p;
    });
    const result = await createHqImplementedEngine(reader, store).backfill();
    expect(result.status).toBe("applied");
    expect(calls).toEqual([
      "status",
      "capabilities",
      "bookings",
      "business",
      "catalogue_booking",
      "catalogue_business",
    ]);
    const state = (await visible(store))!;
    expect(Object.keys(state.entities)).toEqual([
      "booking:1",
      "business:90052",
    ]);
    expect(state.resumeCursor).toBe((await base.bookings()).resumeCursor);
    expect(state.metadata.scope).toBe(scope);
    expect((await store.readSync())?.stage).toBeNull();
  });
  it("pins the same numeric generation for business and each catalogue, never derives it from a cursor", async () => {
    const base = createHqImplementedSampleReader("initial");
    const business = vi.spyOn(base, "businessMappings");
    const catalogue = vi.spyOn(base, "catalogue");
    expect(
      (
        await createHqImplementedEngine(
          base,
          createHqImplementedMemoryStore()
        ).backfill()
      ).status
    ).toBe("applied");
    expect(business).toHaveBeenCalledWith({ generationId: 1, limit: 100 });
    expect(catalogue.mock.calls).toEqual([
      ["booking", { generationId: 1, limit: 100 }],
      ["business", { generationId: 1, limit: 100 }],
    ]);
  });
  it("continues a short page and uses only its opaque nextCursor for that route", async () => {
    const base = createHqImplementedSampleReader("initial"),
      page = await base.bookings();
    const calls: any[] = [];
    const reader: HqWireReader = {
      ...base,
      async bookings(q) {
        calls.push(q);
        return q?.cursor
          ? { ...copy(page), items: [] }
          : {
              ...copy(page),
              complete: false,
              nextCursor: "opaque-short-page",
              resumeCursor: "pending-not-committed",
            };
      },
    };
    const result = await createHqImplementedEngine(
      reader,
      createHqImplementedMemoryStore()
    ).backfill();
    expect(result.status).toBe("applied");
    expect(calls).toEqual([
      { limit: 100 },
      { cursor: "opaque-short-page", limit: 100 },
    ]);
    if (result.status === "applied") expect(result.pages).toBe(5);
  });
  it("allows age/stale to change without mistaking them for immutable generation identity", async () => {
    let age = 0;
    const reader = mapReader(
      createHqImplementedSampleReader("initial"),
      (p, endpoint) =>
        endpoint === "capabilities"
          ? p
          : { ...p, sourceAgeSeconds: (age += 300), stale: age > 900 }
    );
    const result = await createHqImplementedEngine(
      reader,
      createHqImplementedMemoryStore()
    ).backfill();
    expect(result.status).toBe("applied");
    if (result.status === "applied") {
      expect(result.state.metadata.sourceAgeSeconds).toBeGreaterThan(900);
      expect(result.state.metadata.stale).toBe(true);
    }
  });
  it.each([
    "generationId",
    "changeUpper",
    "publishedAt",
    "expiresAt",
    "sourceObservationWindow",
    "counts",
    "scope",
  ])("rejects cross-route generation metadata drift in %s", async field => {
    const base = createHqImplementedSampleReader("initial");
    const reader = mapReader(base, (p, endpoint) => {
      if (endpoint !== "business") return p;
      const value =
        field === "scope"
          ? "foreign"
          : field === "sourceObservationWindow"
            ? { ...p.sourceObservationWindow, from: "2026-11-22T11:00:00.000Z" }
            : field === "counts"
              ? { bookingCount: 1, businessCount: 2 }
              : field.endsWith("At")
                ? "2026-11-23T11:00:00.000Z"
                : p[field] + 1;
      return { ...p, [field]: value };
    });
    const store = createHqImplementedMemoryStore();
    expect(
      (await createHqImplementedEngine(reader, store).backfill()).status
    ).toBe("unavailable");
    expect(await visible(store)).toBeNull();
  });
  it("does not publish after a partial business feed or catalogue failure", async () => {
    for (const endpoint of ["businessMappings", "catalogue"] as const) {
      const store = await seed(),
        before = await visible(store),
        base = createHqImplementedSampleReader("amended");
      const reader = {
        ...base,
        [endpoint]: async () => unavailable("UNAVAILABLE", 503),
      } as HqWireReader;
      const result = await createHqImplementedEngine(reader, store).backfill();
      expect(result).toMatchObject({
        status: "unavailable",
        code: "UNAVAILABLE",
      });
      expect(await visible(store)).toEqual(before);
      expect((await store.readSync())!.stage).not.toBeNull();
    }
  });
  it("serializes staging across a failed page and resumes without refetching or skipping the applied first page", async () => {
    const store = await seed(),
      before = await visible(store),
      base = createHqImplementedSampleReader("amended"),
      page = await base.bookings();
    const interrupted: HqWireReader = {
      ...base,
      async bookings(q) {
        if (q?.cursor) unavailable("UNAVAILABLE", 503);
        return {
          ...copy(page),
          nextCursor: "opaque-resume-page",
          complete: false,
          resumeCursor: "DO-NOT-COMMIT",
        };
      },
    };
    expect(
      (await createHqImplementedEngine(interrupted, store).backfill()).status
    ).toBe("unavailable");
    expect(await visible(store)).toEqual(before);
    const persisted = JSON.parse(
      JSON.stringify(await store.readSync())
    ) as HqImplementedSyncState;
    expect(persisted.stage?.cursor).toBe("opaque-resume-page");
    expect(persisted.published?.resumeCursor).toBe(before!.resumeCursor);
    const restored = createHqImplementedMemoryStore(persisted),
      calls: any[] = [];
    const resumed: HqWireReader = {
      ...base,
      async bookings(q) {
        calls.push(q);
        return { ...copy(page), items: [] };
      },
    };
    const done = await createHqImplementedEngine(resumed, restored).backfill();
    expect(done.status).toBe("applied");
    expect(calls).toEqual([{ cursor: "opaque-resume-page", limit: 100 }]);
    expect(
      (await visible(restored))!.entities["booking:1"].entity.revision
    ).toBe(2);
  });
  it("keeps staged changes and pending cursor invisible until every catchup page is applied", async () => {
    const store = await seed(),
      before = await visible(store),
      base = createHqImplementedSampleReader("amended"),
      page = await base.changes(before!.resumeCursor);
    const interrupted: HqWireReader = {
      ...base,
      async changes(cursor) {
        if (cursor !== before!.resumeCursor) unavailable("UNAVAILABLE", 503);
        expect(await visible(store)).toEqual(before);
        return {
          ...copy(page),
          complete: false,
          nextCursor: "opaque-change-page",
          resumeCursor: "PENDING",
        };
      },
    };
    expect(
      (await createHqImplementedEngine(interrupted, store).catchup()).status
    ).toBe("unavailable");
    expect(await visible(store)).toEqual(before);
    const restored = createHqImplementedMemoryStore(
        copy((await store.readSync())!)
      ),
      calls: string[] = [];
    const resumed: HqWireReader = {
      ...base,
      async changes(cursor) {
        calls.push(cursor);
        return { ...copy(page), items: [] };
      },
    };
    expect(
      (await createHqImplementedEngine(resumed, restored).sync()).status
    ).toBe("applied");
    expect(calls).toEqual(["opaque-change-page"]);
    expect((await visible(restored))!.resumeCursor).toBe(page.resumeCursor);
  });
  it("rejects catalogue revision mismatch without removing a last-good booking", async () => {
    const store = await seed(),
      before = await visible(store);
    const reader = mapReader(
      createHqImplementedSampleReader("initial"),
      (p, endpoint) =>
        endpoint === "catalogue_booking"
          ? { ...p, items: [{ ...p.items[0], revision: 2 }] }
          : p
    );
    expect(
      await createHqImplementedEngine(reader, store).backfill()
    ).toMatchObject({
      status: "unavailable",
      code: "CATALOGUE_REVISION_MISMATCH",
    });
    expect(await visible(store)).toEqual(before);
  });
  it("rejects a missing or duplicated catalogue member, rather than reconciling partial membership", async () => {
    for (const mode of ["missing", "duplicate"]) {
      const reader = mapReader(
        createHqImplementedSampleReader("initial"),
        (p, endpoint) =>
          endpoint === "catalogue_booking"
            ? {
                ...p,
                items: mode === "missing" ? [] : [p.items[0], p.items[0]],
              }
            : p
      );
      const store = createHqImplementedMemoryStore();
      expect(
        (await createHqImplementedEngine(reader, store).backfill()).status
      ).toBe("unavailable");
      expect(await visible(store)).toBeNull();
    }
  });
  it("performs absence removal only after complete booking/business feeds and both catalogues", async () => {
    const store = await seed();
    const reader = mapReader(
      createHqImplementedSampleReader("amended"),
      (p, endpoint) =>
        endpoint === "capabilities"
          ? p
          : {
              ...p,
              counts: { bookingCount: 0, businessCount: 1 },
              ...(endpoint === "bookings" || endpoint === "catalogue_booking"
                ? { items: [] }
                : {}),
            }
    );
    const result = await createHqImplementedEngine(reader, store).backfill();
    expect(result.status).toBe("applied");
    const state = (await visible(store))!;
    expect(state.entities["booking:1"].absent).toBe(true);
    expect(state.entities["booking:1"].entity.revision).toBe(1);
    expect(state.entities["business:90052"].absent).toBe(false);
  });
  it.each(["page", "record", "bytes", "proof"])(
    "fails closed at the %s bound",
    async cap => {
      const store = await seed(),
        before = await visible(store);
      const options =
        cap === "page"
          ? { maxPages: 1 }
          : cap === "record"
            ? { maxRecords: 1 }
            : cap === "bytes"
              ? { maxStateBytes: 20 }
              : { maxRecords: 1 };
      const result = await createHqImplementedEngine(
        createHqImplementedSampleReader("amended"),
        store,
        options
      ).backfill();
      expect(result.status).toBe("unavailable");
      expect(await visible(store)).toEqual(before);
    }
  );
  it("rejects a cursor loop even across process-restored staging", async () => {
    const base = createHqImplementedSampleReader("initial"),
      page = await base.bookings();
    const reader: HqWireReader = {
      ...base,
      async bookings() {
        return { ...copy(page), complete: false, nextCursor: "loop" };
      },
    };
    const store = createHqImplementedMemoryStore();
    expect(
      await createHqImplementedEngine(reader, store).backfill()
    ).toMatchObject({ code: "CURSOR_LOOP" });
    expect(await visible(store)).toBeNull();
  });
  it("rejects torn checkpoints and a different operation while a traversal is staged", async () => {
    const store = await seed(),
      before = (await store.readSync())!,
      base = createHqImplementedSampleReader("amended");
    const reader: HqWireReader = {
      ...base,
      async businessMappings() {
        unavailable("UNAVAILABLE");
      },
    };
    await createHqImplementedEngine(reader, store).backfill();
    expect(
      await createHqImplementedEngine(base, store).catchup()
    ).toMatchObject({ code: "STAGED_MODE_MISMATCH" });
    const torn = (await store.readSync())!;
    torn.stage!.basePublishedVersion = 99;
    expect(
      await createHqImplementedEngine(
        base,
        createHqImplementedMemoryStore(torn)
      ).sync()
    ).toMatchObject({ code: "INVALID_PERSISTED_STATE" });
    expect(before.published?.resumeCursor).toBe(
      (await visible(store))?.resumeCursor
    );
  });
  it("checks CAS on every durable step and returns the newer last-good view on conflict", async () => {
    const winnerStore = await seed(),
      winner = (await winnerStore.readSync())!;
    let calls = 0;
    const store: HqImplementedStore = {
      async readSync() {
        return calls ? copy(winner) : null;
      },
      async compareAndSwapSync() {
        calls++;
        return false;
      },
    };
    expect(
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        store
      ).backfill()
    ).toMatchObject({ code: "CAS_CONFLICT", state: winner.published });
    expect(calls).toBe(1);
  });
});

describe("implemented journal replay, tombstones and controlled recovery", () => {
  it("applies amendments, cancellation and later registration from the supplied source payloads", async () => {
    const store = await seed();
    for (const stage of ["amended", "cancelled", "registered"] as const)
      expect(
        (
          await createHqImplementedEngine(
            createHqImplementedSampleReader(stage),
            store
          ).catchup()
        ).status
      ).toBe("applied");
    const report = await getHqReport(
      (await visible(store))!,
      createHqImplementedSampleDirectory(),
      { year: 2026 }
    );
    expect(report.bookings[0].reportingDate).toBe("2026-02-03");
    expect(report.bookings[0].seller).toBeNull();
    expect(report.bookings[0].processor).toBeNull();
  });
  it("dispatches mixed booking/business changes, retaining composite keys and full replacements", async () => {
    const store = await seed(),
      a = await amendment(),
      business = copy(
        (await visible(store))!.entities["business:90052"].entity
      );
    business.revision = 3;
    (business.payload as any).account.businessName = "Changed source business";
    const b = { ...business, seq: 3, operation: "upsert" } as HqWireChange;
    const result = await createHqImplementedEngine(
      await changesReader([a, b], 3, 3),
      store
    ).catchup();
    expect(result.status).toBe("applied");
    expect(
      (await visible(store))!.entities["business:90052"].entity.revision
    ).toBe(3);
    expect((await visible(store))!.entities["booking:1"].entity.revision).toBe(
      2
    );
    const report = await getHqReport(
      (await visible(store))!,
      createHqImplementedSampleDirectory(),
      { year: 2026 }
    );
    expect(report.bookings[0].business.name).toBe("Changed source business");
  });
  it("accepts identical delivery replay without using seq as revision", async () => {
    const store = await seed(),
      a = await amendment();
    a.revision = 10;
    const reader = await changesReader([a]);
    expect(
      (await createHqImplementedEngine(reader, store).catchup()).status
    ).toBe("applied");
    const before = await visible(store),
      repeated = await createHqImplementedEngine(reader, store).catchup();
    expect(repeated.status).toBe("applied");
    if (repeated.status === "applied") expect(repeated.unchanged).toBe(true);
    expect(await visible(store)).toEqual(before);
  });
  it("ignores an exact historically committed event replay even when a later revision is now current", async () => {
    const store = await seed(),
      a = await amendment();
    await createHqImplementedEngine(await changesReader([a]), store).catchup();
    const newer = copy(a);
    newer.seq = 3;
    newer.revision = 3;
    (newer.payload as any).bookingRef = "newer";
    await createHqImplementedEngine(
      await changesReader([newer], 3, 3),
      store
    ).catchup();
    const before = await visible(store);
    expect(
      (
        await createHqImplementedEngine(
          await changesReader([a], 3, 3),
          store
        ).catchup()
      ).status
    ).toBe("applied");
    expect(await visible(store)).toEqual(before);
  });
  it("rejects conflicting replay content at the same seq across requests", async () => {
    const store = await seed(),
      a = await amendment();
    await createHqImplementedEngine(await changesReader([a]), store).catchup();
    const before = await visible(store);
    const conflict = copy(a);
    (conflict.payload as any).bookingRef = "same sequence different content";
    expect(
      await createHqImplementedEngine(
        await changesReader([conflict]),
        store
      ).catchup()
    ).toMatchObject({ code: "SEQUENCE_CONFLICT" });
    expect(await visible(store)).toEqual(before);
  });
  it.each(["stale", "same_revision_conflict", "over_upper", "seq_regression"])(
    "rejects %s without publishing a partial batch",
    async kind => {
      const store = await seed(),
        a = await amendment();
      if (kind === "stale") {
        await createHqImplementedEngine(
          await changesReader([a]),
          store
        ).catchup();
        a.seq = 3;
        a.revision = 1;
      }
      if (kind === "same_revision_conflict") a.revision = 1;
      if (kind === "over_upper") a.seq = 3;
      const items =
        kind === "seq_regression"
          ? ([{ ...copy(a), seq: 3 }, a] as HqWireChange[])
          : [a];
      const before = await visible(store);
      const result = await createHqImplementedEngine(
        await changesReader(
          items,
          kind === "stale" || kind === "seq_regression" ? 3 : 2,
          kind === "stale" || kind === "seq_regression" ? 3 : 2
        ),
        store
      ).catchup();
      expect(result.status).toBe("unavailable");
      expect(await visible(store)).toEqual(before);
    }
  );
  it("uses non-null source tombstones and never resurrects them at a stale revision", async () => {
    const store = await seed();
    const tombstone: HqWireChange = {
      entityType: "booking",
      entityId: 1,
      revision: 2,
      seq: 2,
      operation: "delete",
      payload: {
        deleted: true,
        reason: "source_absent_or_now_explicit_demo",
        entityType: "booking",
        entityId: 1,
      },
    };
    expect(
      (
        await createHqImplementedEngine(
          await changesReader([tombstone]),
          store
        ).catchup()
      ).status
    ).toBe("applied");
    const state = (await visible(store))!;
    expect((state.entities["booking:1"].entity.payload as any).deleted).toBe(
      true
    );
    expect(state.entities["booking:1"].entity.revision).toBe(2);
    const old = await amendment();
    old.seq = 3;
    old.revision = 1;
    expect(
      await createHqImplementedEngine(
        await changesReader([old], 3, 3),
        store
      ).catchup()
    ).toMatchObject({ code: "STALE_REVISION" });
    expect(await visible(store)).toEqual(state);
  });
  it("removes owner attribution after a business tombstone without losing company booking totals", async () => {
    const store = await seed();
    const tombstone: HqWireChange = {
      entityType: "business",
      entityId: 90052,
      revision: 2,
      seq: 2,
      operation: "delete",
      payload: {
        deleted: true,
        reason: "source_absent_or_now_explicit_demo",
        entityType: "business",
        entityId: 90052,
      },
    };
    expect(
      (
        await createHqImplementedEngine(
          await changesReader([tombstone]),
          store
        ).catchup()
      ).status
    ).toBe("applied");
    const report = await getHqReport(
      (await visible(store))!,
      createHqImplementedSampleDirectory(),
      { year: 2026 }
    );
    expect(report.totals.grossSales.knownSum).toBe("10000.00");
    expect(report.bookings[0].currentOwner).toBeNull();
    expect(report.agents).toHaveLength(0);
  });
  it("replaces explicit empty child arrays rather than merging old memberships", async () => {
    const store = await seed(),
      a = await amendment();
    (a.payload as any).products = [];
    (a.payload as any).payments = [];
    (a.payload as any).ppsLinks = [];
    expect(
      (
        await createHqImplementedEngine(
          await changesReader([a]),
          store
        ).catchup()
      ).status
    ).toBe("applied");
    const payload = (await visible(store))!.entities["booking:1"].entity
      .payload as any;
    expect(payload.products).toEqual([]);
    expect(payload.payments).toEqual([]);
    expect(payload.ppsLinks).toEqual([]);
  });
  it("on 410 discards expired staging and sync performs one full pinned reconciliation", async () => {
    const store = await seed(),
      reader = createHqImplementedSampleReader("amended");
    const changes = vi.fn(async () => unavailable("RESTART_REQUIRED", 410));
    const bookings = vi.spyOn(reader, "bookings");
    const result = await createHqImplementedEngine(
      { ...reader, changes },
      store
    ).sync();
    expect(result.status).toBe("applied");
    expect(changes).toHaveBeenCalledOnce();
    expect(bookings).toHaveBeenCalledWith({ limit: 100 });
    expect((await store.readSync())!.stage).toBeNull();
    expect((await visible(store))!.metadata.generationId).toBe(2);
  });
  it("atomically persists backfill intent at the first expired-stage CAS even if the process crashes there", async () => {
    const store = await seed(),
      before = (await store.readSync())!,
      base = createHqImplementedSampleReader("amended"),
      page = await base.changes(before.published!.resumeCursor);
    let remaining = 3;
    await createHqImplementedEngine(
      {
        ...base,
        changes: async () => ({
          ...copy(page),
          complete: false,
          nextCursor: "expired-staged-changes",
        }),
      },
      store,
      { shouldContinue: () => remaining-- > 0 }
    ).catchup();
    const expired = (await store.readSync())!;
    expect(expired.stage).toMatchObject({
      kind: "catchup",
      cursor: "expired-staged-changes",
      pages: 1,
    });
    const writes: HqImplementedSyncState[] = [];
    const crashing: HqImplementedStore = {
      readSync: () => store.readSync(),
      async compareAndSwapSync(expected, next) {
        writes.push(copy(next));
        expect(expected).toBe(expired.version);
        expect(await store.compareAndSwapSync(expected, next)).toBe(true);
        throw new Error(
          "simulated crash immediately after first committed expiry CAS"
        );
      },
    };
    const changes = vi.fn(async (cursor: string) => {
      expect(cursor).toBe("expired-staged-changes");
      unavailable("RESTART_REQUIRED", 410);
    });
    expect(
      await createHqImplementedEngine({ ...base, changes }, crashing).sync()
    ).toMatchObject({ status: "unavailable", code: "CAS_CONFLICT" });
    expect(writes).toHaveLength(1);
    const persisted = (await store.readSync())!;
    expect(persisted.version).toBe(expired.version + 1);
    expect(persisted.published).toEqual(before.published);
    expect(persisted.stage).toEqual({
      kind: "backfill",
      phase: "bookings",
      basePublishedVersion: before.published!.version,
      metadata: null,
      cursor: null,
      pendingResumeCursor: null,
      entities: before.published!.entities,
      seqProofs: {},
      feedKeys: { booking: [], business: [] },
      catalogueKeys: { booking: [], business: [] },
      cursors: [],
      pages: 0,
      recordsRead: 0,
      lastSeq: null,
    });
    expect(() => validateHqImplementedSyncState(persisted)).not.toThrow();
    const restored = createHqImplementedMemoryStore(copy(persisted)),
      bookings = vi.spyOn(base, "bookings");
    expect(
      (await createHqImplementedEngine({ ...base, changes }, restored).sync())
        .status
    ).toBe("applied");
    expect(bookings).toHaveBeenCalledOnce();
    expect(bookings).toHaveBeenCalledWith({ limit: 100 });
    expect(changes).toHaveBeenCalledOnce();
  });
  it("on an expired staged page restarts from the first bookings page, never using the old cursor", async () => {
    const store = await seed(),
      base = createHqImplementedSampleReader("amended"),
      page = await base.bookings();
    const broken: HqWireReader = {
      ...base,
      async bookings(q) {
        if (q?.cursor) unavailable("UNAVAILABLE", 503);
        return {
          ...copy(page),
          complete: false,
          nextCursor: "old-key-traversal",
        };
      },
    };
    await createHqImplementedEngine(broken, store).backfill();
    const calls: any[] = [];
    const rotated: HqWireReader = {
      ...base,
      async bookings(q) {
        calls.push(q);
        if (q?.cursor) unavailable("RESTART_REQUIRED", 410);
        return copy(page);
      },
    };
    expect(
      (await createHqImplementedEngine(rotated, store).sync()).status
    ).toBe("applied");
    expect(calls).toEqual([
      { cursor: "old-key-traversal", limit: 100 },
      { limit: 100 },
    ]);
  });
  it.each([
    "AUTH_DENIED",
    "INVALID_QUERY",
    "RATE_LIMITED",
    "UNAVAILABLE",
    "TIMEOUT",
    "CLIENT_DISABLED",
  ])("retains last-good view and sanitized %s without retries", async code => {
    const store = await seed(),
      before = await visible(store),
      reader = createHqImplementedSampleReader("amended"),
      changes = vi.fn(async () => unavailable(code));
    const result = await createHqImplementedEngine(
      { ...reader, changes },
      store
    ).sync();
    expect(result).toMatchObject({
      status: "unavailable",
      code,
      state: before,
    });
    expect(changes).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("secret-cookie");
  });
  it("requires a complete initial checkpoint for catchup", async () => {
    expect(
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        createHqImplementedMemoryStore()
      ).catchup()
    ).toMatchObject({ code: "CHECKPOINT_REQUIRED" });
  });
  it("rejects source generations older than the applied checkpoint", async () => {
    const store = await seed();
    await createHqImplementedEngine(
      createHqImplementedSampleReader("amended"),
      store
    ).catchup();
    const before = await visible(store);
    expect(
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        store
      ).backfill()
    ).toMatchObject({ code: "GENERATION_REGRESSION" });
    expect(await visible(store)).toEqual(before);
  });
});

describe("implemented restored-state integrity and explicit recovery", () => {
  it.each(["payload", "canonical", "key", "proof", "metadata", "version"])(
    "rejects corrupted persisted %s before calling the source",
    async field => {
      const good = await seed(),
        damaged = (await good.readSync())!;
      if (field === "payload")
        (
          damaged.published!.entities["booking:1"].entity.payload as any
        ).tenantId = 999;
      if (field === "canonical")
        damaged.published!.entities["booking:1"].canonicalPayload = "{}";
      if (field === "key") {
        damaged.published!.entities["booking:2"] =
          damaged.published!.entities["booking:1"];
        delete damaged.published!.entities["booking:1"];
      }
      if (field === "proof")
        damaged.published!.seqProofs["2"] = "not-a-local-proof";
      if (field === "metadata")
        damaged.published!.metadata.scope = "other" as any;
      if (field === "version") damaged.published!.version = -1;
      const source = createHqImplementedSampleReader("amended"),
        status = vi.spyOn(source, "status");
      expect(
        await createHqImplementedEngine(
          source,
          createHqImplementedMemoryStore(damaged)
        ).sync()
      ).toMatchObject({
        status: "unavailable",
        code: "INVALID_PERSISTED_STATE",
        state: null,
      });
      expect(status).not.toHaveBeenCalled();
    }
  );
  it.each(["phase", "sequence", "membership", "cursor", "pages"])(
    "rejects corrupted staged %s before any source request",
    async field => {
      const store = await seed(),
        base = createHqImplementedSampleReader("amended");
      await createHqImplementedEngine(
        {
          ...base,
          async businessMappings() {
            unavailable("UNAVAILABLE");
          },
        },
        store
      ).backfill();
      const damaged = (await store.readSync())!;
      if (field === "phase") damaged.stage!.phase = "changes";
      if (field === "sequence") damaged.stage!.lastSeq = 900;
      if (field === "membership")
        damaged.stage!.feedKeys.booking = ["booking:999"];
      if (field === "cursor")
        damaged.stage!.pendingResumeCursor = "secret\ninvalid";
      if (field === "pages") damaged.stage!.pages = -1;
      const status = vi.spyOn(base, "status");
      expect(
        await createHqImplementedEngine(
          base,
          createHqImplementedMemoryStore(damaged)
        ).sync()
      ).toMatchObject({
        status: "unavailable",
        code: "INVALID_PERSISTED_STATE",
      });
      expect(status).not.toHaveBeenCalled();
    }
  );
  it("explicitly abandons terminal reconciliation staging without deleting the last-good view", async () => {
    const store = await seed(),
      before = await visible(store),
      good = createHqImplementedSampleReader("amended");
    const broken = mapReader(good, (page, endpoint) =>
      endpoint === "catalogue_booking" ? { ...page, items: [] } : page
    );
    expect(
      await createHqImplementedEngine(broken, store).backfill()
    ).toMatchObject({ code: "CATALOGUE_MEMBERSHIP_MISMATCH" });
    expect((await store.readSync())!.stage!.phase).toBe("finish");
    expect(await visible(store)).toEqual(before);
    const bookings = vi.spyOn(good, "bookings");
    const result = await createHqImplementedEngine(
      good,
      store
    ).restartBackfill();
    expect(result.status).toBe("applied");
    expect(bookings).toHaveBeenCalledWith({ limit: 100 });
    expect((await visible(store))!.entities["booking:1"].entity.revision).toBe(
      2
    );
    expect((await store.readSync())!.stage).toBeNull();
  });
});

describe("bounded invocation yields and report-boundary persisted validation", () => {
  it("yields before source calls, or after a durable page, without consuming cumulative caps", async () => {
    const reader = createHqImplementedSampleReader("initial"),
      status = vi.spyOn(reader, "status"),
      store = createHqImplementedMemoryStore();
    expect(
      await createHqImplementedEngine(reader, store, {
        shouldContinue: () => false,
      }).sync()
    ).toEqual({ status: "yielded", code: "BATCH_YIELDED", state: null });
    expect(status).not.toHaveBeenCalled();
    expect(await store.readSync()).toBeNull();
    let remaining = 3;
    expect(
      (
        await createHqImplementedEngine(reader, store, {
          shouldContinue: () => remaining-- > 0,
        }).sync()
      ).status
    ).toBe("yielded");
    const state = (await store.readSync())!;
    expect(state.stage).toMatchObject({ phase: "business", pages: 1 });
    expect(() => validateHqImplementedSyncState(state)).not.toThrow();
    const restored = createHqImplementedMemoryStore(state);
    expect(
      (await createHqImplementedEngine(reader, restored).sync()).status
    ).toBe("applied");
  });
  it.each([
    false,
    0,
    "",
    [],
    undefined,
    {},
    { version: 1, published: false, stage: null },
  ])("rejects non-container persisted value %j", value => {
    expect(() => validateHqImplementedSyncState(value)).toThrow(
      "INVALID_PERSISTED_STATE"
    );
  });
  it("validates report-consumption bounds and all persisted records, even if published alone looks valid", async () => {
    const store = await seed(),
      value = (await store.readSync())!;
    expect(() =>
      validateHqImplementedSyncState(value, { maxRecords: 1 })
    ).toThrow("INVALID_PERSISTED_STATE");
    expect(() =>
      validateHqImplementedSyncState(value, { maxStateBytes: 1 })
    ).toThrow("INVALID_PERSISTED_STATE");
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
    expect(() => validateHqImplementedSyncState(value)).not.toThrow();
    value.stage.entities["booking:1"].canonicalPayload = "{}";
    expect(() => validateHqImplementedSyncState(value)).toThrow(
      "INVALID_PERSISTED_STATE"
    );
  });
});
