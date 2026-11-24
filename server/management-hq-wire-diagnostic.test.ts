import { describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import examples from "./fixtures/management-hq-wire-http-examples.json";
import type {
  HqWireBookingPage,
  HqWireBookingPayload,
  HqWireChangePage,
  HqWirePageQuery,
} from "../shared/management-hq-wire";
import type { HqContractErrorCode } from "./management-hq-contract";
import {
  HqContractError,
  createHqWireFailure,
  getHqWireFailureRule,
  copyHqWireFailureRule,
  validateHqWireBookingPage,
  validateHqWireBusinessPage,
  validateHqWireChangePage,
  validateHqWireCataloguePage,
  validateHqWireEntity,
  validateHqWireDeclaredSchema,
  validateHqWireStatus,
  validateHqWireCapabilities,
  type HqWireFailureRule,
} from "./management-hq-wire-contract";
import { HqOrbitClient } from "./management-hq-orbit-client";

// Existing synthetic examples only, isolated in-memory HTTP fixtures only.
// No live provider, application/configuration, database, browser or release calls.
const PRIVATE_SENTINEL =
  "PRIVATE_SENTINEL private@example.test https://secret.test/provider KEY_SECRET";
const TEST_KEY = "SYNTHETIC-DIAGNOSTIC-KEY-32-CHARS-ONLY";
const bookingPage = (): HqWireBookingPage =>
  structuredClone(examples.beforeAmendment.body) as HqWireBookingPage;
const cancellationPage = (): HqWireBookingPage =>
  structuredClone(examples.afterCancellation.body) as HqWireBookingPage;
const changePage = (): HqWireChangePage =>
  structuredClone(examples.afterAmendment.body) as HqWireChangePage;
const payload = (page: HqWireBookingPage | HqWireChangePage) =>
  page.items[0].payload as HqWireBookingPayload;
const storedEntity = (page: HqWireBookingPage) =>
  structuredClone(page.items[0]);
const asChange = (page: HqWireBookingPage): HqWireChangePage => {
  const result = changePage();
  result.items[0].entityId = page.items[0].entityId;
  result.items[0].payload = structuredClone(page.items[0].payload);
  return result;
};
const businessPage = () => {
  const page = bookingPage();
  page.entityType = "business";
  page.items = [
    {
      entityType: "business",
      entityId: 90052,
      revision: 1,
      payload: {
        orbitTenantId: 90052,
        isActive: true,
        account: {},
        identity: structuredClone(payload(bookingPage()).identity),
        configuredCardFeeRates: {},
        membershipHistoryAvailable: false,
        portalMembershipJoinDate: null,
      },
    },
  ];
  return page;
};
const statusBody = () => {
  const { items: _items, ...page } = bookingPage();
  return { ...page, ready: true };
};
const capabilitiesBody = () => ({
  apiVersion: "1.0.0",
  endpoints: [
    "bookings",
    "changes",
    "catalogue",
    "business-mappings",
    "status",
    "capabilities",
  ],
  quotes: false,
  sourceWrites: false,
  providerCalls: false,
});
function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected synthetic rejection");
}
async function rejected(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected synthetic rejection");
}
function diagnostic(
  error: unknown,
  code: HqContractErrorCode,
  rule: HqWireFailureRule | null
): asserts error is HqContractError {
  expect(error).toBeInstanceOf(HqContractError);
  const contractError = error as HqContractError;
  expect(contractError.code).toBe(code);
  expect(contractError.message).toBe(code);
  expect(getHqWireFailureRule(error)).toBe(rule);
  const generic = new HqContractError(code, contractError.safeRetryAfter);
  expect(Object.keys(error as object)).toEqual(Object.keys(generic));
  expect(Object.getOwnPropertyNames(error)).toEqual(
    Object.getOwnPropertyNames(generic)
  );
  expect(Object.getOwnPropertySymbols(error)).toEqual([]);
  expect(Object.hasOwn(contractError, "rule")).toBe(false);
  expect(Object.hasOwn(contractError, "cause")).toBe(false);
  expect(JSON.stringify(error)).toBe(JSON.stringify(generic));
  const visible = `${JSON.stringify(error)} ${contractError.message} ${inspect(error, { showHidden: true })}`;
  if (rule !== null) expect(visible).not.toContain(rule);
  expect(visible).not.toMatch(
    /PRIVATE_SENTINEL|private@example|secret\.test|KEY_SECRET|SYNTHETIC-DIAGNOSTIC-KEY|fixture\.test|bookingRef|orbitBookingId|entityId|instancePath|schemaPath|params|provider/
  );
}
function invalidBooking(
  mutate: (page: HqWireBookingPage) => void,
  rule: HqWireFailureRule,
  code: HqContractErrorCode = "INVALID_SEMANTICS"
) {
  const page = bookingPage();
  (page as unknown as Record<string, unknown>).diagnostic = PRIVATE_SENTINEL;
  mutate(page);
  const error = caught(() => validateHqWireBookingPage(page));
  diagnostic(error, code, rule);
  return error;
}
function fixtureClient(fetcher: typeof fetch) {
  return new HqOrbitClient({
    baseUrl: "https://fixture.test/api/reporting/v1",
    apiKey: TEST_KEY,
    scopeId: "company_all_real_and_unattributed",
    enabled: true,
    allowFixtureTransport: true,
    fetcher,
  });
}
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

describe("Management HQ static first-rejected wire diagnostics (offline only)", () => {
  it("labels recursive exact money and minor-unit failures without changing their codes", () => {
    const mutations: ((page: HqWireBookingPage) => void)[] = [
      page => (payload(page).financials.vatDeduction = 1.001),
      page => (payload(page).products[0].price = "100.001"),
      page =>
        (payload(page).financials.baselineEstimate.financials!.grossMargin =
          1.001),
      page =>
        ((
          payload(page).financials.bookingVatOverride as Record<string, unknown>
        ).storedAmount = "90071992547409.92"),
      page => (payload(page).financials.grossBookingValue = Infinity),
      page => (payload(page).financials.grossBookingValue = NaN),
      page =>
        (payload(page).financials.grossBookingValue = Number.MAX_SAFE_INTEGER),
      page => (payload(page).paymentSummary.amount = "1e3"),
    ];
    for (const mutate of mutations) invalidBooking(mutate, "exact_money_pence");
    for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1])
      invalidBooking(
        page => (payload(page).paymentSummary.amountMinor = value),
        "exact_money_pence",
        "INVALID_PAYLOAD"
      );
  });

  it("labels schema rejections at parse and standalone declared-schema positions", () => {
    invalidBooking(
      page => delete (page as Partial<HqWireBookingPage>).projectionVersion,
      "declared_schema",
      "INVALID_PAYLOAD"
    );
    invalidBooking(
      page => (payload(page).dates.portalRegisteredAt = "not-a-date"),
      "declared_schema",
      "INVALID_PAYLOAD"
    );
    invalidBooking(
      page => (payload(page).dates.portalRegisteredAt = "2026-02-30T09:00:00Z"),
      "declared_schema",
      "INVALID_PAYLOAD"
    );
    diagnostic(
      caught(() => validateHqWireDeclaredSchema("BookingPage", {})),
      "INVALID_PAYLOAD",
      "declared_schema"
    );
    diagnostic(
      caught(() => validateHqWireEntity({})),
      "INVALID_PAYLOAD",
      "declared_schema"
    );
    diagnostic(
      caught(() => validateHqWireStatus({ ...statusBody(), ready: false })),
      "INVALID_PAYLOAD",
      "declared_schema"
    );
    diagnostic(
      caught(() =>
        validateHqWireCapabilities({ ...capabilitiesBody(), quotes: true })
      ),
      "INVALID_PAYLOAD",
      "declared_schema"
    );
  });

  it("labels recursive clone structure, identity-number bounds, getters and clone catch safely", () => {
    invalidBooking(
      page => (payload(page).identity.members[0].externalDiagnosticId = 1.5),
      "payload_structure_or_bounds",
      "INVALID_PAYLOAD"
    );
    invalidBooking(
      page =>
        ((page as unknown as Record<string, unknown>).diagnostic = "x".repeat(
          4097
        )),
      "payload_structure_or_bounds",
      "PAYLOAD_TOO_LARGE"
    );
    invalidBooking(
      page => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        (page as unknown as Record<string, unknown>).diagnostic = cycle;
      },
      "payload_structure_or_bounds",
      "INVALID_PAYLOAD"
    );
    const getter = vi.fn(() => PRIVATE_SENTINEL);
    invalidBooking(
      page =>
        Object.defineProperty(page, "privateDiagnostic", {
          enumerable: true,
          get: getter,
        }),
      "payload_structure_or_bounds",
      "INVALID_PAYLOAD"
    );
    expect(getter).not.toHaveBeenCalled();
    const proxy = new Proxy(bookingPage(), {
      getPrototypeOf() {
        throw new Error(PRIVATE_SENTINEL);
      },
    });
    diagnostic(
      caught(() => validateHqWireBookingPage(proxy)),
      "INVALID_PAYLOAD",
      "payload_structure_or_bounds"
    );
  });

  it("distinguishes calendar, registration and reporting-date selection without accepting bad dates", () => {
    invalidBooking(
      page => (payload(page).dates.managementDate = "2026-02-30"),
      "calendar_date"
    );
    // The declared date-time format permits year zero; the existing semantic
    // calendar guard rejects it before reporting-date selection.
    invalidBooking(
      page => (payload(page).dates.portalRegisteredAt = "0000-01-10T00:00:00Z"),
      "registration_timestamp"
    );
    for (const mutate of [
      (page: HqWireBookingPage) =>
        (payload(page).dates.managementDate = "2026-01-11"),
      (page: HqWireBookingPage) => (payload(page).dates.month = "2026-02"),
      (page: HqWireBookingPage) =>
        (payload(page).dates.dateSource = "portal_registered_at"),
    ])
      invalidBooking(mutate, "reporting_date_selection");
  });

  it("shares status and identity labels across booking, change, entity and business validators", () => {
    for (const [rule, mutate] of [
      [
        "status_eligibility",
        (page: HqWireBookingPage) => (payload(page).eligibility.pending = true),
      ],
      [
        "identity_consistency",
        (page: HqWireBookingPage) => (payload(page).identity.orbitTenantId = 8),
      ],
      [
        "identity_consistency",
        (page: HqWireBookingPage) =>
          (payload(page).identity.assignedStaff.orbitTenantUserId = 8),
      ],
    ] as const) {
      const page = bookingPage();
      mutate(page);
      for (const run of [
        () => validateHqWireBookingPage(page),
        () => validateHqWireChangePage(asChange(page)),
        () => validateHqWireEntity(storedEntity(page)),
      ])
        diagnostic(caught(run), "INVALID_SEMANTICS", rule);
    }
    const page = businessPage();
    (
      page.items[0].payload as { identity: { orbitTenantId: number | null } }
    ).identity.orbitTenantId = 8;
    diagnostic(
      caught(() => validateHqWireBusinessPage(page)),
      "INVALID_SEMANTICS",
      "identity_consistency"
    );
    diagnostic(
      caught(() => validateHqWireEntity(storedEntity(page))),
      "INVALID_SEMANTICS",
      "identity_consistency"
    );
  });

  it("labels duplicate products, financial status and cancelled financial guards independently", () => {
    invalidBooking(
      page =>
        payload(page).products.push(structuredClone(payload(page).products[0])),
      "duplicate_product"
    );
    invalidBooking(
      page => (payload(page).financials.bookingStatus = "cancelled"),
      "financial_status_consistency"
    );
    invalidBooking(
      page => (payload(page).financials.cancelled = true),
      "financial_status_consistency"
    );
    const cancelled = cancellationPage();
    payload(cancelled).financials.headlineEligible = true;
    diagnostic(
      caught(() => validateHqWireBookingPage(cancelled)),
      "INVALID_SEMANTICS",
      "cancelled_financial_eligibility"
    );
    payload(cancelled).financials.headlineEligible = false;
    payload(cancelled).financials.grossBookingProfit = 1.1;
    diagnostic(
      caught(() => validateHqWireBookingPage(cancelled)),
      "INVALID_SEMANTICS",
      "cancelled_economics"
    );
  });

  it("labels page metadata, completeness, cursors, entity kinds, duplicates, identities and replay sequence", () => {
    invalidBooking(
      page => (page.sourceObservationWindow.from = "2026-11-22T12:00:01Z"),
      "metadata_window"
    );
    invalidBooking(
      page => (page.nextCursor = "opaque"),
      "pagination_completeness"
    );
    invalidBooking(
      page => (page.resumeCursor = "opaque\nPRIVATE_SENTINEL"),
      "cursor_shape"
    );
    invalidBooking(page => (page.entityType = "mixed"), "page_entity_type");
    invalidBooking(
      page => (page.items[0].entityType = "business"),
      "page_entity_type"
    );
    invalidBooking(
      page => page.items.push(structuredClone(page.items[0])),
      "duplicate_entity"
    );
    invalidBooking(page => (page.items[0].entityId = 8), "entity_identity");
    const change = changePage();
    change.items.push(structuredClone(change.items[0]));
    diagnostic(
      caught(() => validateHqWireChangePage(change)),
      "INVALID_SEMANTICS",
      "change_sequence"
    );
    change.items.pop();
    change.items[0].operation = "delete";
    diagnostic(
      caught(() => validateHqWireChangePage(change)),
      "INVALID_SEMANTICS",
      "entity_identity"
    );
    const catalogue = bookingPage();
    catalogue.entityType = "mixed";
    catalogue.items = [];
    diagnostic(
      caught(() => validateHqWireCataloguePage(catalogue)),
      "INVALID_SEMANTICS",
      "page_entity_type"
    );
  });

  it("reports the existing first rejection rather than a later simultaneous violation", () => {
    const page = bookingPage();
    payload(page).financials.vatDeduction = 1.001;
    delete (page as Partial<HqWireBookingPage>).projectionVersion;
    page.expiresAt = page.publishedAt;
    page.nextCursor = "opaque";
    page.resumeCursor = "";
    page.entityType = "mixed";
    page.items[0].entityId = 8;
    payload(page).dates.managementDate = "2026-02-30";
    payload(page).dates.month = "2026-02";
    payload(page).eligibility.pending = true;
    payload(page).identity.orbitTenantId = 8;
    payload(page).products.push(structuredClone(payload(page).products[0]));
    payload(page).financials.bookingStatus = "cancelled";
    const check = (
      rule: HqWireFailureRule,
      code: HqContractErrorCode = "INVALID_SEMANTICS"
    ) =>
      diagnostic(
        caught(() => validateHqWireBookingPage(page)),
        code,
        rule
      );
    check("exact_money_pence");
    payload(page).financials.vatDeduction =
      payload(bookingPage()).financials.vatDeduction;
    check("declared_schema", "INVALID_PAYLOAD");
    page.projectionVersion = "1.0.0";
    check("metadata_window");
    page.expiresAt = bookingPage().expiresAt;
    check("pagination_completeness");
    page.nextCursor = null;
    check("cursor_shape");
    page.resumeCursor = bookingPage().resumeCursor;
    check("page_entity_type");
    page.entityType = "booking";
    check("entity_identity");
    page.items[0].entityId = bookingPage().items[0].entityId;
    check("calendar_date");
    payload(page).dates.managementDate =
      payload(bookingPage()).dates.managementDate;
    check("reporting_date_selection");
    payload(page).dates.month = payload(bookingPage()).dates.month;
    check("status_eligibility");
    payload(page).eligibility.pending = false;
    check("identity_consistency");
    payload(page).identity.orbitTenantId =
      payload(bookingPage()).identity.orbitTenantId;
    check("duplicate_product");
    payload(page).products.pop();
    check("financial_status_consistency");
    payload(page).financials.bookingStatus = payload(page).status;
    expect(validateHqWireBookingPage(page)).toEqual(page);
  });

  it("preserves validator rules through actual injected client HTTP response sanitization", async () => {
    const page = bookingPage();
    payload(page).products[0].price = PRIVATE_SENTINEL;
    const original = caught(() => validateHqWireBookingPage(page));
    diagnostic(original, "INVALID_SEMANTICS", "exact_money_pence");
    const fetcher = vi.fn(async () => jsonResponse(page));
    const client = fixtureClient(fetcher);
    const sanitized = await rejected(() => client.bookings({ limit: 100 }));
    diagnostic(sanitized, "INVALID_SEMANTICS", "exact_money_pence");
    expect(sanitized).not.toBe(original);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.length).toBeGreaterThan(0);
  });

  it("uses the same safe labels for first-page status and capabilities errors in client catch", async () => {
    const status = statusBody();
    status.expiresAt = status.publishedAt;
    const statusFetcher = vi.fn(async () => jsonResponse(status));
    diagnostic(
      await rejected(() => fixtureClient(statusFetcher).status()),
      "INVALID_SEMANTICS",
      "metadata_window"
    );
    expect(statusFetcher).toHaveBeenCalledTimes(1);
    const capsFetcher = vi.fn(async () =>
      jsonResponse({
        ...capabilitiesBody(),
        quotes: true,
        diagnostic: PRIVATE_SENTINEL,
      })
    );
    diagnostic(
      await rejected(() => fixtureClient(capsFetcher).capabilities()),
      "INVALID_PAYLOAD",
      "declared_schema"
    );
    expect(capsFetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects local query shape, generation, limit and cursor failures before fixture transport", () => {
    const fetcher = vi.fn(async () => jsonResponse(bookingPage()));
    const client = fixtureClient(fetcher);
    const cases: [unknown, HqWireFailureRule][] = [
      [null, "query_structure"],
      [{ unexpected: PRIVATE_SENTINEL }, "query_structure"],
      [{ cursor: "opaque", generationId: 1 }, "query_generation"],
      [{ generationId: 0 }, "query_generation"],
      [{ generationId: 1.5 }, "query_generation"],
      [{ limit: 0 }, "query_limit"],
      [{ limit: 101 }, "query_limit"],
      [{ limit: 1.5 }, "query_limit"],
      [{ cursor: "opaque\nPRIVATE_SENTINEL" }, "cursor_shape"],
    ];
    for (const [query, rule] of cases)
      diagnostic(
        caught(() => client.bookings(query as HqWirePageQuery)),
        "INVALID_QUERY",
        rule
      );
    const getter = vi.fn(() => PRIVATE_SENTINEL);
    const query = {};
    Object.defineProperty(query, "limit", { enumerable: true, get: getter });
    diagnostic(
      caught(() => client.bookings(query)),
      "INVALID_QUERY",
      "query_structure"
    );
    expect(getter).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves client response generation, requested limit and catalogue kind labels", async () => {
    const fetcher = vi.fn(async () => jsonResponse(bookingPage()));
    diagnostic(
      await rejected(() =>
        fixtureClient(fetcher).bookings({ generationId: 2 })
      ),
      "INVALID_SEMANTICS",
      "query_generation"
    );
    const page = bookingPage();
    const second = structuredClone(page.items[0]);
    second.entityId = 2;
    (second.payload as HqWireBookingPayload).orbitBookingId = 2;
    page.items.push(second);
    const limitFetcher = vi.fn(async () => jsonResponse(page));
    diagnostic(
      await rejected(() => fixtureClient(limitFetcher).bookings({ limit: 1 })),
      "INVALID_SEMANTICS",
      "query_limit"
    );
    const catalogue = bookingPage();
    catalogue.items = [];
    const catalogueFetcher = vi.fn(async () => jsonResponse(catalogue));
    diagnostic(
      await rejected(() =>
        fixtureClient(catalogueFetcher).catalogue("business")
      ),
      "INVALID_SEMANTICS",
      "page_entity_type"
    );
    for (const mock of [fetcher, limitFetcher, catalogueFetcher])
      expect(mock).toHaveBeenCalledTimes(1);
  });

  it("never trusts forged properties, codes, clones, getters or malformed unknown errors", () => {
    const getter = vi.fn(() => {
      throw new Error(PRIVATE_SENTINEL);
    });
    const untrusted = {};
    Object.defineProperties(untrusted, {
      rule: { get: getter },
      code: { get: getter },
    });
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const forged = Object.assign(new HqContractError("INVALID_SEMANTICS"), {
      rule: "exact_money_pence",
    });
    const actual = invalidBooking(
      page => (payload(page).financials.vatDeduction = 1.001),
      "exact_money_pence"
    );
    for (const unknownError of [
      undefined,
      null,
      false,
      1,
      "exact_money_pence",
      Symbol("private"),
      untrusted,
      proxy,
      {},
      forged,
      new Error(PRIVATE_SENTINEL),
      { code: "INVALID_SEMANTICS", rule: "exact_money_pence" },
      JSON.parse(JSON.stringify(actual)),
      structuredClone(actual),
    ]) {
      expect(getHqWireFailureRule(unknownError)).toBeNull();
      const target = new HqContractError("INVALID_SEMANTICS");
      copyHqWireFailureRule(unknownError, target);
      diagnostic(target, "INVALID_SEMANTICS", null);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("copies only trusted static rule metadata into fresh sanitized errors and rejects arbitrary labels", () => {
    const original = invalidBooking(
      page => (payload(page).financials.vatDeduction = 1.001),
      "exact_money_pence"
    );
    Object.assign(original, {
      rule: PRIVATE_SENTINEL,
      provider: PRIVATE_SENTINEL,
      cause: new Error(PRIVATE_SENTINEL),
    });
    original.message = PRIVATE_SENTINEL;
    const sanitized = new HqContractError(
      original.code,
      original.safeRetryAfter
    );
    copyHqWireFailureRule(original, sanitized);
    diagnostic(sanitized, "INVALID_SEMANTICS", "exact_money_pence");
    const second = new HqContractError(sanitized.code);
    copyHqWireFailureRule(sanitized, second);
    diagnostic(second, "INVALID_SEMANTICS", "exact_money_pence");
    diagnostic(
      createHqWireFailure(PRIVATE_SENTINEL as HqWireFailureRule),
      "INVALID_SEMANTICS",
      null
    );
    diagnostic(
      createHqWireFailure("query_limit", "INVALID_QUERY"),
      "INVALID_QUERY",
      "query_limit"
    );
  });

  it("keeps untagged provider HTTP and transport errors generic with no raw leakage or retry", async () => {
    const forged = Object.assign(new HqContractError("INVALID_SEMANTICS"), {
      rule: "exact_money_pence",
      provider: PRIVATE_SENTINEL,
      cause: new Error(PRIVATE_SENTINEL),
    });
    const cases: [() => Promise<Response>, HqContractErrorCode][] = [
      [
        async () => new Response(PRIVATE_SENTINEL, { status: 503 }),
        "UNAVAILABLE",
      ],
      [
        async () =>
          new Response(PRIVATE_SENTINEL, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        "INVALID_PAYLOAD",
      ],
      [
        async () => {
          throw new Error(PRIVATE_SENTINEL);
        },
        "TRANSPORT_FAILURE",
      ],
      [
        async () => {
          throw forged;
        },
        "INVALID_SEMANTICS",
      ],
    ];
    for (const [response, code] of cases) {
      const fetcher = vi.fn(response);
      diagnostic(
        await rejected(() => fixtureClient(fetcher).bookings({ limit: 100 })),
        code,
        null
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
