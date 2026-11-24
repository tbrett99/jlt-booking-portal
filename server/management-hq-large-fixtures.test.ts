import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HqWireBookingPayload,
  HqWirePageQuery,
  HqWireReader,
} from "../shared/management-hq-wire";
import {
  createHqLargeSyntheticReader,
  getHqLargeSyntheticFixtureSizing,
  HQ_LARGE_SYNTHETIC_DEFAULTS,
} from "./management-hq-large-fixtures";
import {
  HQ_WIRE_MAX_PAYLOAD_BYTES,
  validateHqWireBookingPage,
  validateHqWireBusinessPage,
  validateHqWireCataloguePage,
  validateHqWireChangePage,
  validateHqWireStatus,
  validateHqWireCapabilities,
} from "./management-hq-wire-contract";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  validateHqImplementedSyncState,
} from "./management-hq-ingestion";
import { getHqReport } from "./management-hq-engine";
import {
  hqAssignedStaffSourceCandidate,
  hqCurrentOwnerSourceCandidate,
} from "./management-hq-projection";

const options = { bookingCount: 5, paddingBytes: 0, generationId: 700000021 };
const noNetwork = vi.fn(() => {
  throw new Error("Network forbidden in offline fixture tests");
});
beforeEach(() => {
  noNetwork.mockClear();
  vi.stubGlobal("fetch", noNetwork);
});
afterEach(() => {
  expect(noNetwork).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

async function collect(
  reader: HqWireReader,
  type: "booking" | "business",
  catalogue = false
) {
  const items: {
    entityType: "booking" | "business";
    entityId: number;
    revision: number;
  }[] = [];
  let query: HqWirePageQuery = { generationId: options.generationId, limit: 2 };
  const status = await reader.status();
  do {
    const page = catalogue
      ? await reader.catalogue(type, query)
      : type === "booking"
        ? await reader.bookings(query)
        : await reader.businessMappings(query);
    const validated = catalogue
      ? validateHqWireCataloguePage(page)
      : type === "booking"
        ? validateHqWireBookingPage(page)
        : validateHqWireBusinessPage(page);
    expect(validated).toEqual(page);
    expect(page).toMatchObject({
      generationId: status.generationId,
      counts: status.counts,
      changeUpper: status.changeUpper,
    });
    expect(page.items.length).toBeLessThanOrEqual(2);
    expect(page.complete).toBe(page.nextCursor === null);
    expect(page.resumeCursor).toBe((await reader.bookings()).resumeCursor);
    items.push(
      ...page.items.map(({ entityType, entityId, revision }) => ({
        entityType,
        entityId,
        revision,
      }))
    );
    if (page.nextCursor === null) return items;
    query = { cursor: page.nextCursor, limit: 2 };
  } while (true);
}

describe("large wholly synthetic offline HQ reader", () => {
  it("validates every wire response and reconciles both complete catalogue memberships and counts", async () => {
    const reader = createHqLargeSyntheticReader(options);
    const status = await reader.status();
    expect(validateHqWireStatus(status)).toEqual(status);
    const capabilities = await reader.capabilities();
    expect(validateHqWireCapabilities(capabilities)).toEqual(capabilities);
    expect(capabilities).toMatchObject({
      quotes: false,
      sourceWrites: false,
      providerCalls: false,
    });
    const bookings = await collect(reader, "booking");
    const businesses = await collect(reader, "business");
    expect(await collect(reader, "booking", true)).toEqual(bookings);
    expect(await collect(reader, "business", true)).toEqual(businesses);
    expect(status.counts).toEqual({
      bookingCount: bookings.length,
      businessCount: businesses.length,
    });
    expect(new Set(bookings.map(item => item.entityId)).size).toBe(
      options.bookingCount
    );
    const businessPage = await reader.businessMappings();
    const page = await reader.bookings();
    for (const item of page.items) {
      const payload = item.payload as HqWireBookingPayload;
      const business = businessPage.items.find(
        item => item.entityId === payload.orbitTenantId
      )!;
      expect(payload.identity).toEqual(business.payload.identity);
      expect(hqCurrentOwnerSourceCandidate(payload.identity)).not.toBeNull();
      expect(hqAssignedStaffSourceCandidate(payload.identity)).not.toBeNull();
      expect(payload.bookingRef).toMatch(/^SYNTHETIC-LARGE-/);
    }
    const changes = await reader.changes(page.resumeCursor, 100);
    expect(validateHqWireChangePage(changes)).toEqual(changes);
    expect(changes.items).toEqual([]);
    expect(changes.resumeCursor).toBe(page.resumeCursor);
  });

  it("defaults to 100 items and resumes reproducibly with a fresh reader, without mutation leakage", async () => {
    const largeOptions = { ...options, bookingCount: 101 };
    const reader = createHqLargeSyntheticReader(largeOptions);
    const first = await reader.bookings();
    expect(first.items).toHaveLength(100);
    expect(first.complete).toBe(false);
    const second = await createHqLargeSyntheticReader(largeOptions).bookings({
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.generationId).toBe(first.generationId);
    expect(second.resumeCursor).toBe(first.resumeCursor);
    expect(second.items[0].entityId).toBeGreaterThan(
      first.items.at(-1)!.entityId
    );
    const catalogue = await reader.catalogue("booking");
    expect(catalogue.items).toHaveLength(100);
    expect(
      (await reader.catalogue("booking", { cursor: catalogue.nextCursor! }))
        .items
    ).toEqual(
      second.items.map(({ entityType, entityId, revision }) => ({
        entityType,
        entityId,
        revision,
      }))
    );
    (first.items[0].payload as HqWireBookingPayload).products.length = 0;
    expect((await reader.bookings()).items[0].payload.products).toHaveLength(1);
    expect(await reader.bookings({ cursor: first.nextCursor! })).toEqual(
      second
    );
  });

  it("rejects drifted pins, mixed queries, bad limits, cross-endpoint and checkpoint-as-page cursors", async () => {
    const reader = createHqLargeSyntheticReader(options);
    for (const read of [
      reader.bookings,
      reader.businessMappings,
      (query?: HqWirePageQuery) => reader.catalogue("booking", query),
      (query?: HqWirePageQuery) => reader.catalogue("business", query),
    ]) {
      await expect(
        read({ generationId: options.generationId + 1 })
      ).rejects.toMatchObject({ code: "RESTART_REQUIRED", status: 410 });
      await expect(read({ limit: 101 })).rejects.toMatchObject({
        code: "INVALID_QUERY",
      });
    }
    for (const limit of [0, -1, 1.5, NaN])
      await expect(reader.bookings({ limit })).rejects.toMatchObject({
        code: "INVALID_QUERY",
      });
    const page = await reader.bookings({ limit: 2 });
    await expect(
      reader.bookings({
        cursor: page.nextCursor!,
        generationId: options.generationId,
      })
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(
      reader.businessMappings({ cursor: page.nextCursor! })
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(
      reader.catalogue("booking", { cursor: page.nextCursor! })
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(
      reader.bookings({ cursor: page.resumeCursor })
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(reader.changes(page.nextCursor!)).rejects.toMatchObject({
      code: "RESTART_REQUIRED",
    });
    await expect(
      createHqLargeSyntheticReader({ ...options, paddingBytes: 1 }).bookings({
        cursor: page.nextCursor!,
      })
    ).rejects.toMatchObject({ code: "RESTART_REQUIRED" });
    for (const invalid of [
      { bookingCount: -1 },
      { paddingBytes: 24577 },
      { generationId: 0 },
    ])
      expect(() => createHqLargeSyntheticReader(invalid)).toThrow(
        "Invalid offline synthetic HQ fixture options"
      );
  });

  it("works with staged engine resume, preserves raw registered-pending, and keeps earned/cash coverage confirmed-only", async () => {
    const store = createHqImplementedMemoryStore();
    let calls = 0;
    const first = createHqImplementedEngine(
      createHqLargeSyntheticReader(options),
      store,
      { shouldContinue: () => ++calls <= 3 }
    );
    expect((await first.backfill()).status).toBe("yielded");
    const staged = await store.readSync();
    expect(staged?.published).toBeNull();
    expect(staged?.stage?.phase).toBe("business");
    validateHqImplementedSyncState(staged);
    const engine = createHqImplementedEngine(
      createHqLargeSyntheticReader(options),
      store
    );
    const result = await engine.backfill();
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error(result.code);
    expect(result.pages).toBe(4);
    expect(result.recordsRead).toBe(2 * (5 + 3));
    validateHqImplementedSyncState(await store.readSync());
    const pending = Object.values(result.state.entities).find(
      record =>
        record.entity.entityType === "booking" &&
        record.entity.payload.status === "pending"
    )!.entity.payload as HqWireBookingPayload;
    expect(pending).toMatchObject({
      status: "pending",
      dates: { portalRegisteredAt: "2026-02-03T09:00:00.000Z" },
      eligibility: { activeSalesHeadline: false },
      financials: { headlineEligible: true },
    });
    const report = await getHqReport(
      result.state,
      {
        async resolve() {
          return null;
        },
      },
      { year: 2026 }
    );
    expect(report.status).toBe("available");
    expect(report.bookings).toHaveLength(5);
    expect(report.totals.bookingCount).toBe(3);
    expect(report.totals.grossSales.knownSum).toBe((1200 * 3).toFixed(2));
    expect(report.totals.grossProfit).toMatchObject({
      knownSum: (300 * 2).toFixed(2),
      coveredCount: 2,
    });
    expect(report.totals.weightedMargin).toMatchObject({
      fraction: "0.250000",
      coveredCount: 2,
      coveredGross: (1200 * 2).toFixed(2),
    });
    expect(report.totals.baselineAgentCommission.knownSum).toBe(
      (192 * 2).toFixed(2)
    );
    expect(report.totals.settledJltIncome.knownSum).toBeNull();
    expect(report.totals.completeAgentCommission.knownSum).toBeNull();
    expect(report.cohorts).toMatchObject({
      pendingCount: 2,
      cancelledCount: 1,
    });
    expect(report.monthly[1].totals.bookingCount).toBe(1);
    const caughtUp = await engine.catchup();
    expect(caughtUp).toMatchObject({ status: "applied", unchanged: true });
  });

  it("sizes the exact legacy published container pagewise and keeps ASCII padding bounded and outside reports", async () => {
    const paddedOptions = { ...options, paddingBytes: 8000 };
    const reader = createHqLargeSyntheticReader(paddedOptions);
    const page = await reader.bookings();
    const diagnostic = page.items[0].payload.syntheticDiagnostics as {
      padding: string[];
    };
    expect(
      diagnostic.padding.reduce(
        (bytes, text) => bytes + Buffer.byteLength(text),
        0
      )
    ).toBe(8000);
    expect(
      diagnostic.padding.every(text => text.length <= 4096 && /^S+$/.test(text))
    ).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(
      HQ_WIRE_MAX_PAYLOAD_BYTES
    );
    const store = createHqImplementedMemoryStore();
    expect(
      (await createHqImplementedEngine(reader, store).backfill()).status
    ).toBe("applied");
    const sizing = await getHqLargeSyntheticFixtureSizing(paddedOptions);
    expect(sizing.legacyPublishedContainerBytes).toBe(
      Buffer.byteLength(JSON.stringify(await store.readSync()))
    );
    expect(sizing.maxBookingPageBytes).toBe(
      Buffer.byteLength(JSON.stringify(page))
    );
    expect(
      2 *
        HQ_LARGE_SYNTHETIC_DEFAULTS.bookingCount *
        HQ_LARGE_SYNTHETIC_DEFAULTS.paddingBytes
    ).toBeGreaterThan(16 * 1024 * 1024);
    const report = await getHqReport(
      (await store.readSync())!.published!,
      {
        async resolve() {
          return null;
        },
      },
      { year: 2026 }
    );
    expect(report.status).toBe("available");
    expect(JSON.stringify(report)).not.toContain("syntheticDiagnostics");
    expect(JSON.stringify(report)).not.toContain("S".repeat(100));
    const maxPadding = await createHqLargeSyntheticReader({
      bookingCount: 100,
      paddingBytes: 24576,
    }).bookings();
    expect(Buffer.byteLength(JSON.stringify(maxPadding))).toBeLessThan(
      HQ_WIRE_MAX_PAYLOAD_BYTES
    );
  });

  it("handles an empty synthetic generation as four complete empty feeds/catalogues", async () => {
    const reader = createHqLargeSyntheticReader({
      ...options,
      bookingCount: 0,
    });
    expect((await reader.status()).counts).toEqual({
      bookingCount: 0,
      businessCount: 0,
    });
    const result = await createHqImplementedEngine(
      reader,
      createHqImplementedMemoryStore()
    ).backfill();
    expect(result).toMatchObject({
      status: "applied",
      pages: 4,
      recordsRead: 0,
    });
  });
});
