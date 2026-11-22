import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { HQ_WIRE_SCHEMAS } from "./management-hq-wire-schemas";
import {
  HqContractError,
  HQ_WIRE_MAX_PAYLOAD_BYTES,
  HQ_WIRE_MAX_NODES,
  validateHqWireBookingPage,
  validateHqWireBusinessPage,
  validateHqWireChangePage,
  validateHqWireCataloguePage,
  validateHqWireStatus,
  validateHqWireCapabilities,
  validateHqWireError,
  validateHqWireDeclaredSchema,
  type HqWireSchemaName,
} from "./management-hq-wire-contract";
const openapi = JSON.parse(
  readFileSync(
    new URL("./fixtures/management-hq-wire-openapi.json", import.meta.url),
    "utf8"
  )
);
const examples = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/management-hq-wire-http-examples.json",
      import.meta.url
    ),
    "utf8"
  )
);
const booking = (): any => structuredClone(examples.beforeAmendment.body);
const changes = (): any => structuredClone(examples.afterAmendment.body);
const business = (): any => {
  const p = booking();
  p.entityType = "business";
  p.items = [
    {
      entityType: "business",
      entityId: 90052,
      revision: 1,
      payload: {
        orbitTenantId: 90052,
        isActive: true,
        account: {},
        identity: p.items[0].payload.identity,
        configuredCardFeeRates: {},
        membershipHistoryAvailable: false,
        portalMembershipJoinDate: null,
      },
    },
  ];
  return p;
};
const catalogue = (): any => {
  const p = booking();
  p.items = p.items.map(({ entityType, entityId, revision }: any) => ({
    entityType,
    entityId,
    revision,
  }));
  return p;
};
function sample(schema: any): any {
  if (schema.$ref)
    return sample((HQ_WIRE_SCHEMAS as any)[schema.$ref.split("/").at(-1)]);
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map(sample));
  if (schema.oneOf) return sample(schema.oneOf[0]);
  if (schema.enum) return schema.enum[0];
  if (Array.isArray(schema.type))
    return schema.type.includes("null")
      ? null
      : sample({ ...schema, type: schema.type[0] });
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([k, v]) => [k, sample(v)])
    );
  if (schema.type === "array") return [];
  if (schema.type === "integer" || schema.type === "number") return 1;
  if (schema.type === "boolean") return false;
  if (schema.type === "null") return null;
  if (schema.format === "date-time") return "2026-01-10T12:00:00Z";
  return "synthetic";
}
function bad(
  value: unknown,
  validate: (v: unknown) => unknown = validateHqWireBookingPage,
  code?: string
) {
  let error: unknown;
  try {
    validate(value);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(HqContractError);
  if (code) expect((error as HqContractError).code).toBe(code);
  expect((error as HqContractError).message).toBe(
    (error as HqContractError).code
  );
  expect(JSON.stringify(error)).not.toMatch(/SECRET|private@|https:\/\/secret/);
}
describe("implemented OpenAPI verbatim wire contract", () => {
  it("copies every actual supplied component exactly (input has 18, not 19)", () => {
    expect(HQ_WIRE_SCHEMAS).toEqual(openapi.components.schemas);
    expect(Object.keys(HQ_WIRE_SCHEMAS)).toHaveLength(18);
  });
  it.each(Object.keys(HQ_WIRE_SCHEMAS) as HqWireSchemaName[])(
    "compiles and validates component %s without coercion",
    name => {
      validateHqWireDeclaredSchema(name, sample(HQ_WIRE_SCHEMAS[name]));
      bad([], v => validateHqWireDeclaredSchema(name, v), "INVALID_PAYLOAD");
    }
  );
  it.each([
    "beforeAmendment",
    "afterAmendment",
    "afterCancellation",
    "afterLaterRegistration",
  ])("accepts actual supplied 200 body %s unchanged", name => {
    const raw = examples[name].body;
    const validate =
      name === "afterAmendment"
        ? validateHqWireChangePage
        : validateHqWireBookingPage;
    const result = validate(raw);
    expect(result).toEqual(raw);
    expect(result).not.toBe(raw);
    expect(result.items[0].payload).not.toBe(raw.items[0].payload);
  });
  it("accepts the nested unauthorized error and never invents requestId", () => {
    expect(validateHqWireError(examples.unauthorized.body)).toEqual(
      examples.unauthorized.body
    );
    expect(
      validateHqWireError({
        error: { code: "unavailable", message: "Synthetic" },
      })
    ).toEqual({ error: { code: "unavailable", message: "Synthetic" } });
    for (const raw of [
      { code: "unauthorized", message: "flat" },
      { error: { code: 401, message: "wrong" } },
      { error: { code: "x" } },
    ])
      bad(raw, validateHqWireError);
  });
  it("accepts business, both catalogue kinds, status and minimal capabilities", () => {
    expect(validateHqWireBusinessPage(business())).toEqual(business());
    const cat = catalogue();
    expect(validateHqWireCataloguePage(cat)).toEqual(cat);
    cat.entityType = "business";
    cat.items[0].entityType = "business";
    expect(validateHqWireCataloguePage(cat)).toEqual(cat);
    const status = { ...booking(), ready: true };
    delete status.items;
    expect(validateHqWireStatus(status).ready).toBe(true);
    const caps = {
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
    };
    expect(validateHqWireCapabilities(caps)).toEqual(caps);
    bad({ ...caps, quotes: true }, validateHqWireCapabilities);
    bad({ ...status, ready: false }, validateHqWireStatus);
  });
  it("requires schema fields only, not additional source diagnostic fields", () => {
    const strip = (value: any, schema: any): any => {
      if (schema.$ref)
        return strip(
          value,
          (HQ_WIRE_SCHEMAS as any)[schema.$ref.split("/").at(-1)]
        );
      if (schema.allOf)
        return Object.assign(
          {},
          ...schema.allOf.map((s: any) => strip(value, s))
        );
      if (value === null) return null;
      if (Array.isArray(value))
        return value.map(v => strip(v, schema.items ?? {}));
      if (schema.oneOf) return strip(value, schema.oneOf[0]);
      if (value && typeof value === "object" && schema.properties)
        return Object.fromEntries(
          Object.entries(schema.properties)
            .filter(([k]) => Object.hasOwn(value, k))
            .map(([k, s]) => [k, strip(value[k], s)])
        );
      return value;
    };
    const minimal = strip(booking(), HQ_WIRE_SCHEMAS.BookingPage);
    expect(minimal.items[0].payload).not.toHaveProperty("bookingTotal");
    expect(minimal.items[0].payload.financials).not.toHaveProperty(
      "bookingStatus"
    );
    expect(validateHqWireBookingPage(minimal)).toEqual(minimal);
  });
  it("preserves bounded legal diagnostics without retaining references", () => {
    const p = booking();
    p.items[0].payload.payments = [
      { id: 5, amountMinor: 250, diagnostic: { code: "synthetic" } },
    ];
    const result = validateHqWireBookingPage(p);
    p.items[0].payload.payments[0].diagnostic.code = "mutated";
    expect((result.items[0].payload as any).payments[0].diagnostic.code).toBe(
      "synthetic"
    );
  });
});
describe("implemented wire semantics and hard bounds", () => {
  const invalid: [string, (p: any) => void][] = [
    [
      "legacy version/envelope",
      p => {
        delete p.projectionVersion;
        p.contractVersion = "1.0.0-proposed";
      },
    ],
    ["numeric ID string not coerced", p => (p.items[0].entityId = "1")],
    [
      "unsafe nested source ID",
      p =>
        (p.items[0].payload.payments = [{ id: Number.MAX_SAFE_INTEGER + 1 }]),
    ],
    [
      "fractional nested ID",
      p => (p.items[0].payload.identity.members[0].id = 1.5),
    ],
    [
      "unsafe nested pence",
      p =>
        (p.items[0].payload.financials.baselineEstimate.splitRoundingResidualPence =
          Number.MAX_SAFE_INTEGER + 1),
    ],
    [
      "fractional nested minor units",
      p => (p.items[0].payload.paymentSummary.amountMinor = 1.5),
    ],
    [
      "non-finite money",
      p => (p.items[0].payload.financials.grossBookingValue = Infinity),
    ],
    [
      "money precision",
      p => (p.items[0].payload.financials.vatDeduction = 1.001),
    ],
    [
      "money range",
      p =>
        (p.items[0].payload.financials.grossBookingValue =
          Number.MAX_SAFE_INTEGER),
    ],
    [
      "raw product decimal string",
      p => (p.items[0].payload.products[0].price = "100.001"),
    ],
    [
      "product exponential money",
      p => (p.items[0].payload.products[0].netPrice = "1e3"),
    ],
    ["missing children", p => delete p.items[0].payload.payments],
    ["incomplete children", p => (p.items[0].payload.childrenComplete = false)],
    ["envelope ID mismatch", p => (p.items[0].entityId = 2)],
    [
      "payload identity tenant mismatch",
      p => (p.items[0].payload.identity.orbitTenantId = 8),
    ],
    [
      "assigned staff mismatch",
      p => (p.items[0].payload.identity.assignedStaff.orbitTenantUserId = 8),
    ],
    ["mixed wrong entity payload", p => (p.items[0].entityType = "business")],
    ["wrong page entity type", p => (p.entityType = "mixed")],
    ["duplicate page member", p => p.items.push(structuredClone(p.items[0]))],
    [
      "duplicate product",
      p =>
        p.items[0].payload.products.push(
          structuredClone(p.items[0].payload.products[0])
        ),
    ],
    ["complete with next cursor", p => (p.nextCursor = "opaque")],
    ["incomplete missing cursor", p => (p.complete = false)],
    ["empty resume", p => (p.resumeCursor = "")],
    [
      "empty next",
      p => {
        p.complete = false;
        p.nextCursor = "";
      },
    ],
    ["control cursor", p => (p.resumeCursor = "opaque\nSECRET")],
    ["overlong cursor", p => (p.resumeCursor = "x".repeat(2049))],
    [
      "illegal booked calendar",
      p => (p.items[0].payload.dates.bookedOn = "2026-02-30"),
    ],
    [
      "illegal management calendar",
      p => (p.items[0].payload.dates.managementDate = "2026-02-30"),
    ],
    [
      "illegal registration",
      p =>
        (p.items[0].payload.dates.portalRegisteredAt = "2026-02-30T00:00:00Z"),
    ],
    [
      "registration lacks offset",
      p =>
        (p.items[0].payload.dates.portalRegisteredAt = "2026-01-10T00:00:00"),
    ],
    [
      "wrong selected source",
      p => (p.items[0].payload.dates.dateSource = "portal_registered_at"),
    ],
    ["wrong month", p => (p.items[0].payload.dates.month = "2026-02")],
    [
      "wrong pending flag",
      p => (p.items[0].payload.eligibility.pending = true),
    ],
    [
      "wrong cancelled flag",
      p => (p.items[0].payload.eligibility.cancelled = true),
    ],
    [
      "wrong undated flag",
      p => (p.items[0].payload.eligibility.undated = true),
    ],
    [
      "pending headline",
      p => {
        p.items[0].payload.status = "pending";
        p.items[0].payload.eligibility.pending = true;
      },
    ],
    [
      "diagnostic status mismatch",
      p => (p.items[0].payload.financials.bookingStatus = "cancelled"),
    ],
    [
      "reversed observation window",
      p => (p.sourceObservationWindow.from = "2026-11-22T12:00:01Z"),
    ],
    ["expiry before publication", p => (p.expiresAt = "2026-11-21T12:00:00Z")],
  ];
  it.each(invalid)("rejects %s", (_, mutate) => {
    const p = booking();
    mutate(p);
    bad(p);
  });
  it("rejects business and catalogue envelope mismatches", () => {
    const b = business();
    b.items[0].payload.identity.orbitTenantId = 5;
    bad(b, validateHqWireBusinessPage);
    const c = catalogue();
    c.entityType = "mixed";
    bad(c, validateHqWireCataloguePage);
    c.entityType = "booking";
    c.items[0].entityType = "business";
    bad(c, validateHqWireCataloguePage);
  });
  it("allows signed finite profits without recomputing commissions", () => {
    const p = booking();
    p.items[0].payload.financials.grossBookingProfit = -123.45;
    p.items[0].payload.financials.weightedMarginContribution.profitPence =
      -12345;
    expect(
      (validateHqWireBookingPage(p).items[0].payload as any).financials
        .grossBookingProfit
    ).toBe(-123.45);
  });
  it("checks London DST and registration precedence; permits an undated exception", () => {
    const p = booking();
    const d = p.items[0].payload.dates;
    Object.assign(d, {
      portalRegisteredAt: "2026-06-30T23:30:00Z",
      managementDate: "2026-07-01",
      month: "2026-07",
      dateSource: "portal_registered_at",
    });
    expect(
      (validateHqWireBookingPage(p).items[0].payload as any).dates.month
    ).toBe("2026-07");
    d.managementDate = "2026-06-30";
    bad(p);
    Object.assign(d, {
      portalRegisteredAt: null,
      bookedOn: null,
      managementDate: null,
      month: null,
      dateSource: "unavailable",
    });
    p.items[0].payload.eligibility.undated = true;
    p.items[0].payload.eligibility.activeSalesHeadline = false;
    delete p.items[0].payload.financials.headlineEligible;
    expect(
      (validateHqWireBookingPage(p).items[0].payload as any).dates
        .managementDate
    ).toBeNull();
  });
  it("requires operation/tombstone/entity consistency and handles real mixed replacements", () => {
    const p = changes();
    const i = p.items[0];
    i.operation = "delete";
    bad(p, validateHqWireChangePage);
    i.payload = {
      deleted: true,
      reason: "source_absent_or_now_explicit_demo",
      entityType: "booking",
      entityId: 1,
    };
    expect(validateHqWireChangePage(p)).toEqual(p);
    i.operation = "upsert";
    bad(p, validateHqWireChangePage);
    i.operation = "delete";
    i.payload.entityId = 8;
    bad(p, validateHqWireChangePage);
    const mixed = changes();
    const b = business().items[0];
    mixed.changeUpper = 3;
    mixed.items.push({ ...b, revision: 3, seq: 3, operation: "upsert" });
    expect(validateHqWireChangePage(mixed).items).toHaveLength(2);
    mixed.items[1].payload = mixed.items[0].payload;
    bad(mixed, validateHqWireChangePage);
  });
  it.each(["seq", "revision", "entityId"])(
    "bounds change %s and rejects duplicate/out-of-order seq",
    key => {
      const p = changes();
      p.items[0][key] = Number.MAX_SAFE_INTEGER + 1;
      bad(p, validateHqWireChangePage);
      const duplicate = changes();
      duplicate.items.push(structuredClone(duplicate.items[0]));
      bad(duplicate, validateHqWireChangePage);
    }
  );
  it("rejects page 101 and accepts exactly 100 distinct safe entities", () => {
    const p = booking();
    p.items = Array.from({ length: 100 }, (_, n) => {
      const i = structuredClone(p.items[0]);
      i.entityId = n + 1;
      i.payload.orbitBookingId = n + 1;
      return i;
    });
    expect(validateHqWireBookingPage(p).items).toHaveLength(100);
    p.items.push(structuredClone(p.items[0]));
    bad(p, validateHqWireBookingPage, "PAYLOAD_TOO_LARGE");
  });
  it("bounds loose diagnostics by depth, text, array length, total nodes and total bytes", () => {
    const p = booking();
    let deep: any = {};
    p.diagnostic = deep;
    for (let n = 0; n < 34; n++) deep = deep.child = {};
    bad(p, validateHqWireBookingPage, "PAYLOAD_TOO_LARGE");
    p.diagnostic = "x".repeat(4097);
    bad(p, validateHqWireBookingPage, "PAYLOAD_TOO_LARGE");
    p.diagnostic = new Array(5001).fill(null);
    bad(p, validateHqWireBookingPage, "PAYLOAD_TOO_LARGE");
    p.diagnostic = Array.from(
      { length: Math.ceil(HQ_WIRE_MAX_NODES / 5000) },
      () => new Array(5000).fill(null)
    );
    bad(p, validateHqWireBookingPage, "PAYLOAD_TOO_LARGE");
    p.diagnostic = new Array(Math.ceil(HQ_WIRE_MAX_PAYLOAD_BYTES / 4096)).fill(
      "x".repeat(4096)
    );
    bad(p, validateHqWireBookingPage, "PAYLOAD_TOO_LARGE");
  });
  it("rejects getters, toJSON, cycles, symbols, sparse arrays and exotic objects without invocation", () => {
    const p = booking();
    const getter = vi.fn(() => "SECRET");
    Object.defineProperty(p, "extra", { enumerable: true, get: getter });
    bad(p);
    expect(getter).not.toHaveBeenCalled();
    for (const value of [
      new Date(),
      { toJSON: vi.fn() },
      { [Symbol("secret")]: true },
    ])
      bad(value);
    const cycle: any = {};
    cycle.self = cycle;
    bad(cycle);
    const sparse = booking();
    sparse.items = new Array(1);
    bad(sparse);
  });
});

describe("wire compatibility regressions: source revisions are independent of replay seq", () => {
  it("accepts revision10 seq2 and stale revision1 seq3 for downstream revision handling", () => {
    const p = changes();
    p.items[0].revision = 10;
    expect(validateHqWireChangePage(p).items[0].revision).toBe(10);
    p.items[0].revision = 1;
    p.items[0].seq = 3;
    p.changeUpper = 3;
    expect(validateHqWireChangePage(p).items[0].revision).toBe(1);
    p.items[0].seq = 4;
    bad(p, validateHqWireChangePage);
  });
  it("accepts catalogue/backfill revision above changeUpper and schema-valid backfill tombstones", () => {
    const c = catalogue();
    c.items[0].revision = 10;
    expect(validateHqWireCataloguePage(c).items[0].revision).toBe(10);
    const p = booking();
    p.items[0].revision = 10;
    expect(validateHqWireBookingPage(p).items[0].revision).toBe(10);
    p.items[0].payload = {
      deleted: true,
      reason: "source_absent_or_now_explicit_demo",
      entityType: "booking",
      entityId: 1,
    };
    expect(validateHqWireBookingPage(p).items[0].payload).toEqual(
      p.items[0].payload
    );
    p.items[0].payload.entityId = 2;
    bad(p);
  });
  it.each([
    "2026-02-30",
    "unparseable raw source date",
    "2026-01-10T00:00:00Z",
  ])(
    "retains invalid raw bookedOn %s as unavailable, not a selected date",
    bookedOn => {
      const p = booking();
      Object.assign(p.items[0].payload.dates, {
        bookedOn,
        managementDate: null,
        month: null,
        dateSource: "unavailable",
        issues: ["invalid_booked_on"],
      });
      Object.assign(p.items[0].payload.eligibility, {
        undated: true,
        activeSalesHeadline: false,
      });
      delete p.items[0].payload.financials.headlineEligible;
      expect(
        (validateHqWireBookingPage(p).items[0].payload as any).dates.bookedOn
      ).toBe(bookedOn);
    }
  );
  it("validates safe pence boundary using decimal spelling, not rounded binary multiplication", () => {
    const p = booking();
    p.items[0].payload.products[0].price = "90071992547409.91";
    expect(
      (validateHqWireBookingPage(p).items[0].payload as any).products[0].price
    ).toBe("90071992547409.91");
    p.items[0].payload.products[0].price = "90071992547409.92";
    bad(p);
    p.items[0].payload.products[0].price = 0.1 + 0.2;
    bad(p);
  });
});

describe("loose diagnostic numeric identifiers", () => {
  it("rejects fractional undeclared IDs while allowing the declared string member namespace", () => {
    const p = booking();
    p.items[0].payload.identity.members[0].externalDiagnosticId = 1.5;
    bad(p);
    p.items[0].payload.identity.members[0].externalDiagnosticId =
      Number.MAX_SAFE_INTEGER;
    expect(
      (validateHqWireBookingPage(p).items[0].payload as any).identity
        .memberJltAgentId
    ).toBe("SYN-MEMBER-1");
  });
});

describe("standalone stored entity validation", () => {
  it("restores booking/business envelopes and allows matching tombstones", async () => {
    const { validateHqWireEntity } = await import(
      "./management-hq-wire-contract"
    );
    const b = booking().items[0];
    expect(validateHqWireEntity(b)).toEqual(b);
    expect(validateHqWireEntity(b)).not.toBe(b);
    expect(validateHqWireEntity(business().items[0])).toEqual(
      business().items[0]
    );
    const tombstone = {
      entityType: "booking",
      entityId: 1,
      revision: 10,
      payload: {
        deleted: true,
        reason: "source_absent_or_now_explicit_demo",
        entityType: "booking",
        entityId: 1,
      },
    };
    expect(validateHqWireEntity(tombstone)).toEqual(tombstone);
    tombstone.payload.entityId = 2;
    bad(tombstone, validateHqWireEntity);
    b.entityId = 2;
    bad(b, validateHqWireEntity);
    bad({}, validateHqWireEntity, "INVALID_PAYLOAD");
  });
});
