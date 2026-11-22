import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import supplied from "./fixtures/management-hq-implemented-http-examples.json";
import {
  createHqImplementedSampleDirectory,
  createHqImplementedSampleReader,
  HQ_IMPLEMENTED_SAMPLE_PROVENANCE,
  runHqImplementedSampleScenario,
  type HqImplementedSampleStage,
} from "./management-hq-implemented-fixtures";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
} from "./management-hq-ingestion";
import {
  exportHqReportCsv,
  getHqReport,
  canonicalHqJson,
} from "./management-hq-engine";
import { HqOrbitClient } from "./management-hq-orbit-client";
import type {
  HqWireBookingPayload,
  HqWireBusinessPayload,
  HqWireMemberLink,
  HqWirePageQuery,
  HqWireReader,
} from "../shared/management-hq-wire";

const STAGES: HqImplementedSampleStage[] = [
  "initial",
  "amended",
  "cancelled",
  "registered",
];
const KEYS = {
  initial: "beforeAmendment",
  amended: "afterAmendment",
  cancelled: "afterCancellation",
  registered: "afterLaterRegistration",
} as const;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
// Public dummy fixture value, not a retrieved/configured service credential.
const TEST_ONLY_KEY = "offline-fixture-not-a-real-key-000000000";
function client(fetcher: typeof fetch) {
  return new HqOrbitClient({
    baseUrl: "https://management-hq-fixture.test/api/reporting/v1",
    apiKey: TEST_ONLY_KEY,
    scopeId: "company_all_real_and_unattributed",
    enabled: true,
    fetcher,
    allowFixtureTransport: true,
  });
}
function transport(reader: HqWireReader) {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    expect(url.hostname).toBe("management-hq-fixture.test");
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
    });
    expect(new Headers(init?.headers).get("X-Orbit-Reporting-Key")).toBe(
      TEST_ONLY_KEY
    );
    const query: HqWirePageQuery = {};
    if (url.searchParams.has("cursor"))
      query.cursor = url.searchParams.get("cursor")!;
    if (url.searchParams.has("generationId"))
      query.generationId = Number(url.searchParams.get("generationId"));
    if (url.searchParams.has("limit"))
      query.limit = Number(url.searchParams.get("limit"));
    const endpoint = url.pathname.split("/").at(-1);
    const body =
      endpoint === "status"
        ? await reader.status()
        : endpoint === "capabilities"
          ? await reader.capabilities()
          : endpoint === "bookings"
            ? await reader.bookings(query)
            : endpoint === "business-mappings"
              ? await reader.businessMappings(query)
              : endpoint === "catalogue"
                ? await reader.catalogue(
                    url.searchParams.get("entityType") as
                      | "booking"
                      | "business",
                    query
                  )
                : endpoint === "changes"
                  ? await reader.changes(query.cursor!, query.limit)
                  : (() => {
                      throw new Error("Unexpected fixture endpoint");
                    })();
    return jsonResponse(body);
  };
  return { reader: client(fetcher), requests };
}
const forbiddenNetwork = vi.fn(() => {
  throw new Error("Real network prohibited in offline fixture tests");
});
beforeEach(() => {
  forbiddenNetwork.mockClear();
  vi.stubGlobal("fetch", forbiddenNetwork);
});
afterEach(() => {
  expect(forbiddenNetwork).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("implemented Management HQ supplied versus derived fixture provenance", () => {
  it("retains the exact immutable original file and labels synthesized scaffolding separately", () => {
    const bytes = readFileSync(
      new URL(
        "./fixtures/management-hq-implemented-http-examples.json",
        import.meta.url
      )
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      HQ_IMPLEMENTED_SAMPLE_PROVENANCE.sourceSha256
    );
    expect(
      HQ_IMPLEMENTED_SAMPLE_PROVENANCE.actualSuppliedResponses
    ).toHaveLength(4);
    expect(
      HQ_IMPLEMENTED_SAMPLE_PROVENANCE.derivedFixtureResponses.join(" ")
    ).toContain("seq 3/4 upserts");
    expect(HQ_IMPLEMENTED_SAMPLE_PROVENANCE.liveReady).toBe(false);
  });

  it.each(STAGES)(
    "passes actual supplied %s HTTP response unmodified through the real HqOrbitClient",
    async stage => {
      const example = supplied[KEYS[stage]];
      const fetcher = vi.fn<typeof fetch>(async () =>
        jsonResponse(example.body, example.httpStatus)
      );
      const actual = client(fetcher);
      const result =
        stage === "amended"
          ? await actual.changes(
              supplied.beforeAmendment.body.resumeCursor,
              100
            )
          : await actual.bookings({ limit: 100 });
      expect(result).toEqual(example.body);
      expect(result.generationId).toBe(example.body.generationId);
      expect(result.resumeCursor).toBe(example.body.resumeCursor);
      expect(fetcher).toHaveBeenCalledTimes(1);
      if (stage === "amended") {
        const request = new URL(String(fetcher.mock.calls[0][0]));
        expect(request.searchParams.get("cursor")).toBe(
          supplied.beforeAmendment.body.resumeCursor
        );
        expect(result.items[0]).toEqual(supplied.afterAmendment.body.items[0]);
      }
    }
  );

  it("passes the supplied unauthorised HTTP example through the actual client as an access failure", async () => {
    const actual = client(async () =>
      jsonResponse(supplied.unauthorized.body, supplied.unauthorized.httpStatus)
    );
    await expect(actual.status()).rejects.toMatchObject({
      code: "AUTH_DENIED",
    });
  });

  it.each(STAGES)(
    "pins derived %s business/catalogue/status metadata to the exact supplied generation",
    async stage => {
      const reader = createHqImplementedSampleReader(stage);
      const example = supplied[KEYS[stage]].body;
      const status = await reader.status();
      const business = await reader.businessMappings({
        generationId: example.generationId,
      });
      const catalogue = await reader.catalogue("business", {
        generationId: example.generationId,
      });
      const bookings = await reader.bookings({
        generationId: example.generationId,
      });
      const bookingCatalogue = await reader.catalogue("booking", {
        generationId: example.generationId,
      });
      for (const page of [
        status,
        business,
        catalogue,
        bookings,
        bookingCatalogue,
      ]) {
        expect(page.generationId).toBe(example.generationId);
        expect(page.changeUpper).toBe(example.changeUpper);
        expect(page.sourceObservationWindow).toEqual(
          example.sourceObservationWindow
        );
        expect(page.counts).toEqual({ bookingCount: 1, businessCount: 1 });
      }
      expect(business.resumeCursor).toBe(example.resumeCursor);
      expect(business.items).toHaveLength(1);
      expect(business.items[0]).toMatchObject({
        entityType: "business",
        entityId: 90052,
        revision: 1,
      });
      expect(
        (business.items[0].payload as HqWireBusinessPayload).identity
      ).toEqual(supplied.beforeAmendment.body.items[0].payload.identity);
      expect(catalogue.items).toEqual([
        { entityType: "business", entityId: 90052, revision: 1 },
      ]);
      expect(bookingCatalogue.items).toEqual([
        {
          entityType: "booking",
          entityId: 1,
          revision: example.items[0].revision,
        },
      ]);
      expect(await reader.capabilities()).toMatchObject({
        apiVersion: "1.0.0",
        quotes: false,
        sourceWrites: false,
        providerCalls: false,
      });
    }
  );

  it("uses only known opaque checkpoint strings and exact seq 2 plus derived seq 3/4 upserts", async () => {
    const amendment = await createHqImplementedSampleReader("amended").changes(
      supplied.beforeAmendment.body.resumeCursor,
      100
    );
    expect(amendment).toEqual(supplied.afterAmendment.body);
    for (const stage of ["cancelled", "registered"] as const) {
      const index = STAGES.indexOf(stage);
      const previous = supplied[KEYS[STAGES[index - 1]]].body.resumeCursor;
      const page = await createHqImplementedSampleReader(stage).changes(
        previous,
        100
      );
      const example = supplied[KEYS[stage]].body;
      expect(page.items).toEqual([
        { ...example.items[0], seq: example.changeUpper, operation: "upsert" },
      ]);
      expect(page.resumeCursor).toBe(example.resumeCursor);
    }
    const reader = createHqImplementedSampleReader("initial");
    await expect(reader.changes("invented.checkpoint")).rejects.toMatchObject({
      status: 410,
    });
    await expect(
      reader.bookings({ cursor: supplied.beforeAmendment.body.resumeCursor })
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(
      reader.businessMappings({ generationId: 2 })
    ).rejects.toMatchObject({ status: 410 });
    await expect(reader.bookings({ limit: 101 })).rejects.toMatchObject({
      code: "INVALID_QUERY",
    });
    expect(
      (await reader.changes(supplied.beforeAmendment.body.resumeCursor)).items
    ).toEqual([]);
  });
});

describe("implemented Management HQ fixture replay through real ingestion and report", () => {
  it("replays all four stages through injected HTTP transport, real client, engine and atomic memory container", async () => {
    const store = createHqImplementedMemoryStore();
    for (const [index, stage] of STAGES.entries()) {
      const http = transport(createHqImplementedSampleReader(stage));
      const engine = createHqImplementedEngine(http.reader, store);
      const result =
        index === 0 ? await engine.backfill() : await engine.catchup();
      expect(result.status).toBe("applied");
      if (result.status !== "applied") throw new Error(result.code);
      const state = result.state;
      const example = supplied[KEYS[stage]].body;
      expect(state.version).toBe(index + 1);
      expect(state.metadata.generationId).toBe(example.generationId);
      expect(state.resumeCursor).toBe(example.resumeCursor);
      expect(state.entities["booking:1"].entity).toEqual({
        entityType: "booking",
        entityId: 1,
        revision: example.items[0].revision,
        payload: example.items[0].payload,
      });
      expect(state.entities["booking:1"].canonicalPayload).toBe(
        canonicalHqJson(state.entities["booking:1"].entity)
      );
      expect(state.entities["business:90052"].absent).toBe(false);
      const persisted = await store.readSync();
      expect(persisted?.published).toEqual(state);
      expect(persisted?.stage).toBeNull();
      expect(http.requests.map(url => url.pathname.split("/").at(-1))).toEqual(
        index === 0
          ? [
              "status",
              "capabilities",
              "bookings",
              "business-mappings",
              "catalogue",
              "catalogue",
            ]
          : ["status", "capabilities", "changes"]
      );
      if (index === 0) {
        for (const url of http.requests.slice(3))
          expect(url.searchParams.get("generationId")).toBe("1");
      } else {
        expect(http.requests.at(-1)?.searchParams.get("cursor")).toBe(
          supplied[KEYS[STAGES[index - 1]]].body.resumeCursor
        );
        expect(state.seqProofs[String(example.changeUpper)]).toBeDefined();
      }
    }
  });

  it.each(STAGES)(
    "runs %s using actual source gross/profit/date values, keeping original seller and unsettled cash unavailable",
    async stage => {
      const state = await runHqImplementedSampleScenario(stage);
      const directory = createHqImplementedSampleDirectory();
      const report = await getHqReport(state, directory, { year: 2026 });
      expect(report.status).toBe("available");
      expect(report.bookings).toHaveLength(1);
      expect(report.liveReady).toBe(false);
      expect(report.watermark).toBe("");
      expect(JSON.stringify(report)).not.toContain(state.resumeCursor);
      const payload = state.entities["booking:1"].entity
        .payload as HqWireBookingPayload;
      const file = report.bookings[0];
      expect(file.financials.gross).toBe(
        stage === "initial" ? "10000.00" : "11000.00"
      );
      expect(file.reportingDate).toBe(
        stage === "registered" ? "2026-02-03" : "2026-01-10"
      );
      expect(file.dateSource).toBe(
        stage === "registered" ? "portal_registered_at" : "booked_on"
      );
      expect(file.seller).toBeNull();
      expect(file.processor).toBeNull();
      expect(file.currentOwner).toMatchObject({
        userId: 101,
        uniqueAgentId: "SYN-MEMBER-1",
      });
      expect(file.assignedStaff).toMatchObject({
        userId: 102,
        uniqueAgentId: "SYN-STAFF-1",
      });
      expect(file.attributionState).toBe("provisional_current_owner");
      expect(report.agents[0].attributionState).toBe(
        "provisional_current_owner"
      );
      expect(report.agents.map(row => row.agent.userId)).toEqual([101]);
      expect(payload.identity.portalVerified).toBe(false);
      expect(payload.identity.historicalSellingRelationshipVerified).toBe(
        false
      );
      for (const key of [
        "actualCardFees",
        "completeAgentCommission",
        "completeJltRetainedCommission",
        "settledJltIncome",
      ] as const) {
        expect(file.financials[key]).toBeNull();
        expect(report.totals[key].knownSum).toBeNull();
      }
      const cancelled = stage === "cancelled" || stage === "registered";
      expect(report.totals.bookingCount).toBe(cancelled ? 0 : 1);
      expect(report.cohorts.cancelledCount).toBe(cancelled ? 1 : 0);
      expect(report.totals.grossSales.knownSum).toBe(
        cancelled ? null : stage === "initial" ? "10000.00" : "11000.00"
      );
      expect(report.totals.grossProfit.knownSum).toBe(
        cancelled ? null : stage === "initial" ? "1500.00" : "2500.00"
      );
      expect(report.totals.baselineAgentCommission.knownSum).toBe(
        cancelled ? null : stage === "initial" ? "979.28" : "1644.69"
      );
      expect(report.totals.baselineJltRetainedCommission.knownSum).toBe(
        cancelled ? null : stage === "initial" ? "244.82" : "411.17"
      );
      expect(report.totals.weightedMargin.coveredGross).toBe(
        cancelled ? null : stage === "initial" ? "10000.00" : "11000.00"
      );
      expect(report.monthly[3].totals.bookingCount).toBe(0);
      if (stage === "registered") {
        expect(report.monthly[0].cancelledCount).toBe(0);
        expect(report.monthly[1].cancelledCount).toBe(1);
        expect(
          (await getHqReport(state, directory, { year: 2026, month: 1 }))
            .bookings
        ).toEqual([]);
        expect(
          (await getHqReport(state, directory, { year: 2026, month: 2 }))
            .bookings
        ).toHaveLength(1);
      }
      const csv = exportHqReportCsv(report);
      expect(csv).toContain("SYN-HQ-1");
      expect(csv).not.toContain(state.resumeCursor);
      if (cancelled) expect(csv).toContain("cancelled");
    }
  );

  it("returns isolated copies and idempotently reapplies the same checkpoint without inventing a new source generation", async () => {
    const store = createHqImplementedMemoryStore();
    const engine = createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      store
    );
    const first = await engine.backfill();
    const repeat = await engine.catchup();
    expect(first.status).toBe("applied");
    expect(repeat.status).toBe("applied");
    if (first.status !== "applied" || repeat.status !== "applied")
      throw new Error("Sample unavailable");
    expect(repeat.unchanged).toBe(true);
    expect(repeat.state.version).toBe(first.state.version);
    first.state.entities["booking:1"].absent = true;
    expect(
      (await store.readSync())?.published?.entities["booking:1"].absent
    ).toBe(false);
    const reader = createHqImplementedSampleReader("initial");
    const one = await reader.bookings();
    (one.items[0].payload as HqWireBookingPayload).products.length = 0;
    expect((await reader.bookings()).items[0].payload.products).toHaveLength(1);
  });

  it("resolves only coherent synthetic current-owner/staff crosswalks, never a legacy verified seller", async () => {
    const directory = createHqImplementedSampleDirectory();
    const link = copy(
      supplied.beforeAmendment.body.items[0].payload.identity
    ) as HqWireMemberLink;
    const owner = await directory.resolveCurrentOwner(link);
    const staff = await directory.resolveAssignedStaff(link);
    expect(owner?.userId).toBe(101);
    expect(staff?.userId).toBe(102);
    expect(owner?.userId).not.toBe(staff?.userId);
    expect(
      await directory.resolve({
        state: "verified",
        namespace: "portal_user_id",
        id: "101",
        source: "synthetic",
      })
    ).toBeNull();
    link.memberJltOpenId = "wrong-owner-open-id";
    expect(await directory.resolveCurrentOwner(link)).toBeNull();
    const mismatch = copy(
      supplied.beforeAmendment.body.items[0].payload.identity
    ) as HqWireMemberLink;
    mismatch.assignedStaff.jltAgentId = "SYN-MEMBER-1";
    expect(await directory.resolveAssignedStaff(mismatch)).toBeNull();
    const duplicates = copy(
      supplied.beforeAmendment.body.items[0].payload.identity
    ) as HqWireMemberLink;
    duplicates.ownerCandidates.push(copy(duplicates.ownerCandidates[0]));
    expect(await directory.resolveCurrentOwner(duplicates)).toBeNull();
  });
});
