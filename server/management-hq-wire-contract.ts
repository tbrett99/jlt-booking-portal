import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type {
  HqWireBookingPage,
  HqWireBusinessPage,
  HqWireChangePage,
  HqWireCataloguePage,
  HqWireStatus,
  HqWireCapabilities,
  HqWireBookingPayload,
  HqWireBusinessPayload,
  HqWireMetadata,
} from "../shared/management-hq-wire";
import {
  HqContractError,
  type HqContractErrorCode,
} from "./management-hq-contract";
import { HQ_WIRE_SCHEMAS } from "./management-hq-wire-schemas";
export { HqContractError } from "./management-hq-contract";
export const HQ_WIRE_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
export const HQ_WIRE_MAX_PAGE_ITEMS = 100;
export const HQ_WIRE_MAX_TOKEN_LENGTH = 2048;
export const HQ_WIRE_MAX_TEXT_LENGTH = 4096;
export const HQ_WIRE_MAX_DEPTH = 32;
export const HQ_WIRE_MAX_NODES = 200000;
export const HQ_WIRE_MAX_ARRAY_ITEMS = 5000;
export type HqWireSchemaName = keyof typeof HQ_WIRE_SCHEMAS;
const fail = (code: HqContractErrorCode = "INVALID_SEMANTICS"): never => {
  throw new HqContractError(code);
};

// Work on a copy. Keep exported source component declarations byte-for-byte in meaning.
function boundedSchema(value: unknown, field = ""): unknown {
  if (Array.isArray(value)) return value.map(v => boundedSchema(v, field));
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (key === "$ref")
      out[key] = (child as string).replace("#/components/schemas/", "#/$defs/");
    else if (key === "properties")
      out[key] = Object.fromEntries(
        Object.entries(child as Record<string, unknown>).map(([k, v]) => [
          k,
          boundedSchema(v, k),
        ])
      );
    else out[key] = boundedSchema(child, field);
  }
  const types = Array.isArray(input.type) ? input.type : [input.type];
  if (types.includes("string"))
    out.maxLength = Math.min(
      typeof input.maxLength === "number"
        ? input.maxLength
        : HQ_WIRE_MAX_TEXT_LENGTH,
      /^(?:cursor|nextCursor|resumeCursor)$/.test(field)
        ? HQ_WIRE_MAX_TOKEN_LENGTH
        : HQ_WIRE_MAX_TEXT_LENGTH
    );
  if (types.includes("integer")) {
    out.minimum = Math.max(
      typeof input.minimum === "number"
        ? input.minimum
        : -Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER
    );
    out.maximum = Math.min(
      typeof input.maximum === "number"
        ? input.maximum
        : Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER
    );
  }
  if (types.includes("array"))
    out.maxItems =
      field === "items" ? HQ_WIRE_MAX_PAGE_ITEMS : HQ_WIRE_MAX_ARRAY_ITEMS;
  return out;
}
const ajv = new Ajv2020({
  strict: true,
  allowUnionTypes: true,
  allErrors: false,
  validateFormats: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv, { mode: "full" });
const schemaId = "urn:jlt:management-hq:implemented-v1";
ajv.addSchema({
  $id: schemaId,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: boundedSchema(HQ_WIRE_SCHEMAS),
});
const validators = Object.fromEntries(
  Object.keys(HQ_WIRE_SCHEMAS).map(name => [
    name,
    ajv.compile({ $ref: `${schemaId}#/$defs/${name}` }),
  ])
) as Record<HqWireSchemaName, ValidateFunction>;
const integerField = (key: string) =>
  /(?:pence|minor)$/i.test(key) ||
  /^(?:id|seq|revision|generationId|changeUpper|sourceAgeSeconds|(?:orbit|owner|assigned|supplier|tenant|booking|product|payment|user|business).*Id)$/i.test(
    key
  );
const moneyFields = new Set([
  "price",
  "netPrice",
  "bookingTotal",
  "grossBookingValue",
  "headlineGrossBookingValue",
  "activeProductGrossValue",
  "activeProductGrossSubtotal",
  "totalNetCost",
  "netCostSubtotal",
  "grossBookingProfit",
  "grossMargin",
  "grossCommissionBeforeVat",
  "grossCommissionAfterVat",
  "vatDeduction",
  "computedDeduction",
  "estimatedPtsFees",
  "actualPtsFees",
  "estimatedCardProcessingFees",
  "knownPpsFeeEstimateSubtotal",
  "actualCardProcessingFees",
  "netDistributableCommission",
  "agentCommission",
  "agentExpectedCommission",
  "jltRetainedCommission",
  "retainedCancellationIncome",
  "settledJltIncome",
  "amount",
  "storedAmount",
]);
function money(value: unknown): void {
  if (value === null) return;
  let text: string;
  if (typeof value === "string") {
    if (!/^-?[0-9]+(?:\.[0-9]{1,2})?$/.test(value) || value.length > 32) fail();
    text = value;
  } else {
    if (typeof value !== "number" || !Number.isFinite(value)) fail();
    text = String(value);
  }
  // Decimal text arithmetic avoids rounded multiplication crossing the safe-pence boundary.
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:e([+-]?[0-9]+))?$/i.exec(text);
  if (!match) fail();
  const digits = BigInt(match![2] + (match![3] ?? ""));
  const scale = 2 + Number(match![4] ?? 0) - (match![3]?.length ?? 0);
  if (Math.abs(scale) > 400) fail();
  const factor = BigInt("1" + "0".repeat(Math.abs(scale)));
  if (scale < 0 && digits % factor !== BigInt(0)) fail();
  const pence = scale < 0 ? digits / factor : digits * factor;
  if (pence > BigInt(Number.MAX_SAFE_INTEGER)) fail();
}
/** Snapshot JSON without calling getters/toJSON. Apply bounds even inside schema-loose diagnostic objects. */
function cloneJson(value: unknown): unknown {
  try {
    let nodes = 0;
    const seen = new WeakSet<object>();
    const visit = (v: unknown, depth: number, key = ""): void => {
      if (++nodes > HQ_WIRE_MAX_NODES || depth > HQ_WIRE_MAX_DEPTH)
        fail("PAYLOAD_TOO_LARGE");
      if (v === null) return;
      if (
        (integerField(key) || (typeof v === "number" && /Id$/i.test(key))) &&
        (typeof v !== "number" || !Number.isSafeInteger(v))
      )
        fail("INVALID_PAYLOAD");
      if (
        moneyFields.has(key) &&
        (typeof v === "number" || typeof v === "string")
      )
        money(v);
      if (typeof v === "string") {
        if (
          v.length >
          (/^(?:cursor|nextCursor|resumeCursor)$/.test(key)
            ? HQ_WIRE_MAX_TOKEN_LENGTH
            : HQ_WIRE_MAX_TEXT_LENGTH)
        )
          fail("PAYLOAD_TOO_LARGE");
        return;
      }
      if (typeof v === "boolean") return;
      if (typeof v === "number") {
        if (
          !Number.isFinite(v) ||
          Math.abs(v) > Number.MAX_SAFE_INTEGER ||
          (Number.isInteger(v) && !Number.isSafeInteger(v))
        )
          fail("INVALID_PAYLOAD");
        return;
      }
      if (!v || typeof v !== "object") fail("INVALID_PAYLOAD");
      const object = v as object;
      if (seen.has(object)) fail("INVALID_PAYLOAD");
      seen.add(object);
      const array = Array.isArray(v);
      if (
        array &&
        v.length >
          (key === "items" ? HQ_WIRE_MAX_PAGE_ITEMS : HQ_WIRE_MAX_ARRAY_ITEMS)
      )
        fail("PAYLOAD_TOO_LARGE");
      if (
        !array &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null
      )
        fail("INVALID_PAYLOAD");
      if (Object.getOwnPropertySymbols(v).length) fail("INVALID_PAYLOAD");
      for (const [k, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(v)
      )) {
        if (array && k === "length") continue;
        if (k.length > 256) fail("PAYLOAD_TOO_LARGE");
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
          fail("INVALID_PAYLOAD");
        if (array && (!/^(?:0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length))
          fail("INVALID_PAYLOAD");
        visit(descriptor.value, depth + 1, k);
      }
      if (array && Object.keys(v).length !== v.length) fail("INVALID_PAYLOAD");
      seen.delete(object);
    };
    visit(value, 0);
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, "utf8") > HQ_WIRE_MAX_PAYLOAD_BYTES)
      fail("PAYLOAD_TOO_LARGE");
    return JSON.parse(json);
  } catch (error) {
    if (error instanceof HqContractError) throw error;
    return fail("INVALID_PAYLOAD");
  }
}
export function validateHqWireDeclaredSchema(
  name: HqWireSchemaName,
  value: unknown
): void {
  const input = cloneJson(value);
  if (!Object.hasOwn(validators, name) || !validators[name](input))
    fail("INVALID_PAYLOAD");
}
function parse<T>(name: HqWireSchemaName, value: unknown): T {
  const input = cloneJson(value);
  if (!validators[name](input)) fail("INVALID_PAYLOAD");
  return input as T;
}
function validCalendar(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const time = new Date(0);
  time.setUTCFullYear(year, month - 1, day);
  return (
    year >= 1 &&
    time.getUTCFullYear() === year &&
    time.getUTCMonth() === month - 1 &&
    time.getUTCDate() === day
  );
}
function calendar(value: string): string {
  if (!validCalendar(value)) fail();
  return value;
}
const london = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function londonDate(value: string): string {
  calendar(value.slice(0, 10));
  if (!ajv.formats["date-time"] || !Number.isFinite(Date.parse(value))) fail();
  const parts = london.formatToParts(new Date(value));
  const part = (type: string) =>
    parts.find(p => p.type === type)?.value ?? fail();
  return calendar(`${part("year")}-${part("month")}-${part("day")}`);
}
function metadata(value: HqWireMetadata): void {
  for (const instant of [
    value.sourceObservationWindow.from,
    value.sourceObservationWindow.to,
    value.publishedAt,
    value.expiresAt,
  ])
    calendar(instant.slice(0, 10));
  if (
    Date.parse(value.sourceObservationWindow.from) >
      Date.parse(value.sourceObservationWindow.to) ||
    Date.parse(value.sourceObservationWindow.to) >
      Date.parse(value.publishedAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.publishedAt)
  )
    fail();
}
function booking(value: HqWireBookingPayload): void {
  const d = value.dates;
  if (d.managementDate !== null) calendar(d.managementDate);
  const fallback =
    d.bookedOn !== null && validCalendar(d.bookedOn) ? d.bookedOn : null;
  const selected =
    d.portalRegisteredAt !== null ? londonDate(d.portalRegisteredAt) : fallback;
  const source =
    d.portalRegisteredAt !== null
      ? "portal_registered_at"
      : fallback !== null
        ? "booked_on"
        : "unavailable";
  if (
    d.managementDate !== selected ||
    d.dateSource !== source ||
    d.month !== (selected === null ? null : selected.slice(0, 7))
  )
    fail();
  const e = value.eligibility;
  if (
    e.pending !== (value.status === "pending") ||
    e.cancelled !== (value.status === "cancelled") ||
    e.undated !== (selected === null)
  )
    fail();
  if (
    e.activeSalesHeadline &&
    (value.status !== "confirmed" || selected === null)
  )
    fail();
  if (
    value.identity.orbitTenantId !== value.orbitTenantId ||
    value.identity.assignedStaff.orbitTenantUserId !==
      value.assignedTenantUserId
  )
    fail();
  if (new Set(value.products.map(p => p.id)).size !== value.products.length)
    fail();
  const f = value.financials;
  // Diagnostics may be absent. If supplied, they must agree with required status/eligibility.
  if (Object.hasOwn(f, "bookingStatus") && f.bookingStatus !== value.status)
    fail();
  if (Object.hasOwn(f, "cancelled") && f.cancelled !== e.cancelled) fail();
  if (
    Object.hasOwn(f, "headlineEligible") &&
    f.headlineEligible !== e.activeSalesHeadline
  )
    fail();
  if (
    value.status === "cancelled" &&
    (f.grossBookingProfit !== null ||
      f.grossMarginPct !== null ||
      f.weightedMarginContribution.profitPence !== null ||
      f.weightedMarginContribution.coveredGrossPence !== null ||
      f.baselineEstimate.status !== "excluded" ||
      f.completeness.economicsStatus !== "excluded")
  )
    fail();
}
function business(value: HqWireBusinessPayload): void {
  if (value.identity.orbitTenantId !== value.orbitTenantId) fail();
}
function entity(value: any, changes: boolean): void {
  const p = value.payload;
  const tombstone = p.deleted === true;
  if (changes && (value.operation === "delete") !== tombstone) fail();
  if (tombstone) {
    if (
      p.entityType !== value.entityType ||
      p.entityId !== value.entityId ||
      Object.hasOwn(p, "orbitBookingId") ||
      Object.hasOwn(p, "orbitTenantId")
    )
      fail();
  } else if (value.entityType === "booking") {
    if (p.orbitBookingId !== value.entityId || !Object.hasOwn(p, "products"))
      fail();
    booking(p);
  } else {
    if (
      p.orbitTenantId !== value.entityId ||
      Object.hasOwn(p, "orbitBookingId") ||
      !Object.hasOwn(p, "account")
    )
      fail();
    business(p);
  }
}
function page<
  T extends HqWireBookingPage | HqWireChangePage | HqWireCataloguePage,
>(
  name: HqWireSchemaName,
  value: unknown,
  expected?: "booking" | "business"
): T {
  const result = parse<T>(name, value);
  metadata(result);
  if (result.complete !== (result.nextCursor === null)) fail();
  for (const cursor of [result.nextCursor, result.resumeCursor])
    if (
      cursor !== null &&
      (!cursor.length ||
        cursor.length > HQ_WIRE_MAX_TOKEN_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(cursor))
    )
      fail();
  if (expected && result.entityType !== expected) fail();
  const ids = new Set<string>();
  let previousSeq = 0;
  for (const item of result.items) {
    if (result.entityType !== "mixed" && item.entityType !== result.entityType)
      fail();
    if (name === "ChangePage") {
      const change = item as HqWireChangePage["items"][number];
      if (change.seq <= previousSeq || change.seq > result.changeUpper) fail();
      previousSeq = change.seq;
      entity(item, true);
    } else {
      const id = `${item.entityType}:${item.entityId}`;
      if (ids.has(id)) fail();
      ids.add(id);
      if (name !== "CataloguePage") entity(item, false);
    }
  }
  return result;
}
export function validateHqWireBookingPage(value: unknown): HqWireBookingPage {
  return page("BookingPage", value, "booking");
}
export function validateHqWireBusinessPage(value: unknown): HqWireBusinessPage {
  return page("BusinessPage", value, "business");
}
export function validateHqWireChangePage(value: unknown): HqWireChangePage {
  return page("ChangePage", value);
}
export function validateHqWireCataloguePage(
  value: unknown
): HqWireCataloguePage {
  const result = page<HqWireCataloguePage>("CataloguePage", value);
  if (result.entityType === "mixed") fail();
  return result;
}
export function validateHqWireStatus(value: unknown): HqWireStatus {
  const result = parse<HqWireStatus>("Status", value);
  metadata(result);
  return result;
}
export function validateHqWireCapabilities(value: unknown): HqWireCapabilities {
  return parse("Capabilities", value);
}
export function validateHqWireError(value: unknown): {
  error: {
    code: string;
    message: string;
    requestId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
} {
  return parse("Error", value);
}

/** Validate a stored/backfill envelope independently of page metadata or replay seq. */
export function validateHqWireEntity(
  value: unknown
): import("../shared/management-hq-wire").HqWireEntity {
  const result = parse<import("../shared/management-hq-wire").HqWireEntity>(
    "Entity",
    value
  );
  entity(result, false);
  return result;
}
