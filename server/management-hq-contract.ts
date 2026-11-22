import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  HQ_CONTRACT_VERSION,
  type HqAmount,
  type HqBooking,
  type HqBookingPage,
  type HqChange,
  type HqChangePage,
  type HqCommissionResult,
  type HqEnvelope,
} from "../shared/management-hq-types";
import { HQ_CONTRACT_SCHEMAS } from "./management-hq-schemas";

export { HQ_CONTRACT_VERSION } from "../shared/management-hq-types";
export const HQ_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const HQ_MAX_PAGE_RECORDS = 500;
export const HQ_MAX_TOKEN_LENGTH = 2048;

export type HqContractErrorCode =
  | "INVALID_PAYLOAD"
  | "PAYLOAD_TOO_LARGE"
  | "CONTRACT_VERSION_MISMATCH"
  | "INVALID_SEMANTICS"
  | "SCOPE_MISMATCH"
  | "CLIENT_DISABLED"
  | "INVALID_CONFIGURATION"
  | "INVALID_QUERY"
  | "AUTH_DENIED"
  | "RESTART_REQUIRED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "REDIRECT_REJECTED"
  | "TIMEOUT"
  | "TRANSPORT_FAILURE";

const ERROR_CODES = new Set<HqContractErrorCode>([
  "INVALID_PAYLOAD",
  "PAYLOAD_TOO_LARGE",
  "CONTRACT_VERSION_MISMATCH",
  "INVALID_SEMANTICS",
  "SCOPE_MISMATCH",
  "CLIENT_DISABLED",
  "INVALID_CONFIGURATION",
  "INVALID_QUERY",
  "AUTH_DENIED",
  "RESTART_REQUIRED",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "REDIRECT_REJECTED",
  "TIMEOUT",
  "TRANSPORT_FAILURE",
]);

/** No remote messages, validation paths, input values, URLs or credentials are retained. */
export class HqContractError extends Error {
  readonly code: HqContractErrorCode;
  readonly safeRetryAfter?: number;
  constructor(code: HqContractErrorCode, safeRetryAfter?: number) {
    const safeCode = ERROR_CODES.has(code) ? code : "INVALID_PAYLOAD";
    super(safeCode);
    this.name = "HqContractError";
    this.code = safeCode;
    if (
      safeCode === "RATE_LIMITED" &&
      Number.isSafeInteger(safeRetryAfter) &&
      safeRetryAfter! >= 0 &&
      safeRetryAfter! <= 3600
    ) {
      this.safeRetryAfter = safeRetryAfter;
    }
  }
}
const fail = (code: HqContractErrorCode = "INVALID_SEMANTICS"): never => {
  throw new HqContractError(code);
};

// Preserve the exact exported source schemas. Resolve all declared component refs in
// JSON Schema 2020-12 $defs and add resource bounds without coercion/default/removal.
function boundedSchema(value: unknown, field = ""): unknown {
  if (Array.isArray(value)) return value.map(v => boundedSchema(v, field));
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    if (key === "$ref")
      out[key] = (item as string).replace("#/components/schemas/", "#/$defs/");
    else if (key === "properties")
      out[key] = Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([k, v]) => [
          k,
          boundedSchema(v, k),
        ])
      );
    else out[key] = boundedSchema(item, field);
  }
  const types = Array.isArray(input.type) ? input.type : [input.type];
  if (types.includes("string")) {
    out.maxLength = Math.min(
      typeof input.maxLength === "number" ? input.maxLength : 4096,
      /^(revision|mappingRevision|amount|fraction|agentFraction|jltFraction)$/.test(
        field
      )
        ? 40
        : /^(cursor|nextCursor|position|watermark|upperWatermark)$/.test(field)
          ? HQ_MAX_TOKEN_LENGTH
          : 4096
    );
    if (/^(revision|mappingRevision)$/.test(field)) out.pattern = "^[0-9]+$";
    if (field === "currency") out.pattern = "^[A-Z]{3}$";
    if (field === "agentFraction" || field === "jltFraction")
      out.pattern = "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$";
  }
  if (types.includes("integer")) {
    out.minimum = Math.max(
      typeof input.minimum === "number" ? input.minimum : 0,
      0
    );
    out.maximum = field === "passengerCount" ? 10000 : Number.MAX_SAFE_INTEGER;
  }
  if (types.includes("array"))
    out.maxItems = field === "records" ? HQ_MAX_PAGE_RECORDS : 5000;
  if (field === "contractVersion") out.const = HQ_CONTRACT_VERSION;
  return out;
}

const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  validateFormats: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv, { mode: "full" });
const schemaId = "urn:jlt:management-hq:proposed-v1";
ajv.addSchema({
  $id: schemaId,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: boundedSchema(HQ_CONTRACT_SCHEMAS),
});
export type HqSchemaName = keyof typeof HQ_CONTRACT_SCHEMAS;
const validators = Object.fromEntries(
  Object.keys(HQ_CONTRACT_SCHEMAS).map(name => [
    name,
    ajv.compile({ $ref: `${schemaId}#/$defs/${name}` }),
  ])
) as Record<HqSchemaName, ValidateFunction>;

/** Accept JSON data only. Snapshot before validation so returned objects cannot retain extras or input references. */
function cloneJson(value: unknown): unknown {
  try {
    const seen = new WeakSet<object>();
    let nodes = 0;
    const visit = (v: unknown, depth: number): void => {
      if (++nodes > 1000000 || depth > 32) fail("PAYLOAD_TOO_LARGE");
      if (v === null || typeof v === "boolean") return;
      if (typeof v === "string") {
        if (Buffer.byteLength(v, "utf8") > HQ_MAX_PAYLOAD_BYTES)
          fail("PAYLOAD_TOO_LARGE");
        return;
      }
      if (typeof v === "number") {
        if (!Number.isFinite(v)) fail("INVALID_PAYLOAD");
        return;
      }
      if (!v || typeof v !== "object") fail("INVALID_PAYLOAD");
      const obj = v as object;
      if (seen.has(obj)) fail("INVALID_PAYLOAD");
      seen.add(obj);
      if (
        !Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null
      )
        fail("INVALID_PAYLOAD");
      if (Object.getOwnPropertySymbols(v).length) fail("INVALID_PAYLOAD");
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(v)
      )) {
        if (Array.isArray(v) && key === "length") continue;
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
          fail("INVALID_PAYLOAD");
        visit(descriptor.value, depth + 1);
      }
      seen.delete(obj);
    };
    visit(value, 0);
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, "utf8") > HQ_MAX_PAYLOAD_BYTES)
      fail("PAYLOAD_TOO_LARGE");
    return JSON.parse(json);
  } catch (error) {
    if (error instanceof HqContractError) throw error;
    return fail("INVALID_PAYLOAD");
  }
}

/** Also compiles and checks optional modules; no unvalidated $refs or ignored formats. */
export function validateHqDeclaredSchema(
  name: HqSchemaName,
  value: unknown
): void {
  const parsed = cloneJson(value);
  if (!Object.hasOwn(validators, name) || !validators[name](parsed))
    fail("INVALID_PAYLOAD");
}

const ENVELOPE_FIELDS = Object.keys(HQ_CONTRACT_SCHEMAS.Envelope.properties);
function page<T extends HqEnvelope>(
  value: unknown,
  name: "BookingPage" | "ChangePage",
  dataset: string
): T {
  const parsed = cloneJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    fail("INVALID_PAYLOAD");
  const input = parsed as Record<string, unknown>;
  if (input.contractVersion !== HQ_CONTRACT_VERSION)
    fail("CONTRACT_VERSION_MISMATCH");
  if (!validators[name](input)) fail("INVALID_PAYLOAD");
  if (input.dataset !== dataset) fail();
  // Envelope extensions are legal in the proposed spec but never enter storage.
  const projected = Object.fromEntries(
    [
      ...ENVELOPE_FIELDS,
      "records",
      ...(name === "ChangePage" ? ["upperWatermark"] : []),
    ].map(key => [key, input[key]])
  ) as unknown as T;
  if (
    (projected.hasMore &&
      (typeof projected.nextCursor !== "string" ||
        projected.nextCursor.length === 0)) ||
    (!projected.hasMore && projected.nextCursor !== null)
  )
    fail();
  for (const key of [
    "snapshotId",
    "watermark",
    "scopeId",
    "dateRuleVersion",
    "statusRuleVersion",
    "financialPolicyVersion",
  ] as const) {
    if (!projected[key].trim()) fail();
  }
  return projected;
}

const londonDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function registrationDate(instant: string): string {
  const time = new Date(instant);
  if (!Number.isFinite(time.getTime())) return fail();
  const parts = londonDate.formatToParts(time);
  const part = (type: string) =>
    parts.find(p => p.type === type)?.value ?? fail();
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function amount(value: HqAmount, currency?: string | null): void {
  const carries = value.amount !== null;
  if (carries && (value.state === "missing" || value.state === "invalid"))
    fail();
  if (
    value.state === "not_applicable" &&
    carries &&
    !/^-?0+\.00$/.test(value.amount!)
  )
    fail();
  if (
    !carries &&
    (value.state === "source_recorded" ||
      value.state === "actual_recorded" ||
      value.state === "calculated" ||
      value.state === "estimated")
  )
    fail();
  if (carries && (!value.currency || !value.source?.trim())) fail();
  if (
    currency !== undefined &&
    value.currency !== null &&
    value.currency !== currency
  )
    fail();
  if (carries && currency === null) fail();
}
function amountsIn(value: unknown, currency?: string | null): void {
  if (!value || typeof value !== "object") return;
  if (
    !Array.isArray(value) &&
    Object.hasOwn(value, "amount") &&
    Object.hasOwn(value, "evidenceIds")
  ) {
    amount(value as HqAmount, currency);
    return;
  }
  for (const child of Object.values(value)) amountsIn(child, currency);
}
function commission(value: HqCommissionResult, policyComplete: boolean): void {
  const outputs = [
    value.netDistributableCommission,
    value.agentCommission,
    value.jltRetainedCommission,
  ];
  if (
    value.complete &&
    (outputs.some(v => v.amount === null) ||
      value.terms.state === "missing" ||
      value.terms.agentFraction === null ||
      value.terms.jltFraction === null)
  )
    fail();
  if (policyComplete && value.complete && value.terms.state !== "verified")
    fail();
}
function booking(value: HqBooking, envelope: HqEnvelope): void {
  if (!value.childMembershipComplete) fail();
  const d = value.dates;
  const e = value.eligibility;
  if (
    d.dateRuleVersion !== envelope.dateRuleVersion ||
    e.statusRuleVersion !== envelope.statusRuleVersion ||
    value.financials.policyVersion !== envelope.financialPolicyVersion
  )
    fail();
  if (d.portalRegisteredAt !== null) {
    if (
      d.dateSource !== "portal_registered_at" ||
      d.managementReportingDate !== registrationDate(d.portalRegisteredAt)
    )
      fail();
  } else if (d.bookedOn !== null) {
    if (
      d.dateSource !== "booked_on" ||
      d.managementReportingDate !== d.bookedOn
    )
      fail();
  } else if (d.dateSource !== "none" || d.managementReportingDate !== null)
    fail();
  if (e.dated !== (d.managementReportingDate !== null)) fail();
  if (!e.dated && (e.headlineCount === true || e.headlineGrossSales === true))
    fail();
  if (
    e.cancelledCohort !== (value.status === "cancelled") ||
    e.pendingCohort !== (value.status === "pending")
  )
    fail();
  if (
    value.status === "cancelled" &&
    (e.headlineCount !== false || e.headlineGrossSales !== false)
  )
    fail();
  // Pending policy has not been approved. Preserve explicit exclusion/unknown;
  // never silently convert pending into confirmed headline eligibility.
  if (
    value.status === "pending" &&
    (e.headlineCount === true || e.headlineGrossSales === true)
  )
    fail();
  if (value.currencyBasis === "validated_GBP" && value.currency !== "GBP")
    fail();
  if (value.currencyBasis === "verified_native" && value.currency === null)
    fail();
  amountsIn(value, value.currency);
  const f = value.financials;
  if (
    e.headlineGrossSales === true &&
    (f.grossBookingValue.amount === null ||
      value.currencyBasis === "unverified")
  )
    fail();
  if (
    f.grossBookingMargin.state !== "calculated" &&
    f.grossBookingMargin.fraction !== null
  )
    fail();
  if (
    f.grossBookingMargin.state === "calculated" &&
    f.grossBookingMargin.fraction === null
  )
    fail();
  if (
    f.completeGrossAndCost &&
    (f.grossBookingValue.amount === null ||
      f.supplierNetCost.amount === null ||
      value.products.some(
        p =>
          p.financialActive &&
          (p.netCost.amount === null || p.grossValue.amount === null)
      ))
  )
    fail();
  commission(f.orbitCommissionBaseline, false);
  commission(f.policyCompleteCommission, true);
  if (!f.completeApprovedDeductions && f.policyCompleteCommission.complete)
    fail();
  if (
    f.completeApprovedDeductions &&
    (!f.policyCompleteCommission.complete ||
      f.otherDeductions === null ||
      f.otherDeductions.some(
        deduction =>
          deduction.applicability === "unknown" ||
          (deduction.applicability === "applicable" &&
            deduction.amount.amount === null)
      ))
  )
    fail();
  for (const result of [
    f.orbitCommissionBaseline,
    f.policyCompleteCommission,
  ]) {
    if (
      result.complete &&
      (!f.completeGrossAndCost ||
        (result.vatIncluded &&
          f.applicableVat.amount === null &&
          f.applicableVat.state !== "not_applicable") ||
        (result.ptsIncluded &&
          f.ptsFees.amount === null &&
          f.ptsFees.state !== "not_applicable") ||
        (result.cardProcessingFeesIncluded &&
          f.actualCardProcessingFees.amount === null &&
          f.actualCardProcessingFees.state !== "not_applicable"))
    )
      fail();
  }
  // Source assertions are checked, never recomputed into our own commission engine.
  const uniqueIds = (items: { id: string }[]) =>
    new Set(items.map(p => p.id)).size === items.length;
  if (!uniqueIds(value.products) || !uniqueIds(value.payments)) fail();
}
function change(value: HqChange, envelope: HqEnvelope): void {
  if (!value.position.trim()) fail();
  const payloads = [value.booking, value.mapping, value.quote].filter(
    v => v !== null
  );
  if (value.operation === "tombstone") {
    if (payloads.length) fail();
    return;
  }
  if (payloads.length !== 1) fail();
  if (value.reason === "source_deleted" || value.reason === "out_of_scope")
    fail();
  if (value.entityType === "booking") {
    if (
      !value.booking ||
      value.booking.id !== value.id ||
      value.booking.revision !== value.revision
    )
      fail();
    booking(value.booking!, envelope);
  } else if (value.entityType === "business_mapping") {
    if (
      !value.mapping ||
      value.mapping.orbitTenantId !== value.id ||
      (value.mapping.mappingRevision !== null &&
        value.mapping.mappingRevision !== value.revision)
    )
      fail();
  } else {
    if (
      !value.quote ||
      value.quote.id !== value.id ||
      value.quote.revision !== value.revision
    )
      fail();
    amountsIn(value.quote);
  }
}

export function validateHqBookingPage(value: unknown): HqBookingPage {
  const result = page<HqBookingPage>(value, "BookingPage", "bookings");
  for (const record of result.records) booking(record, result);
  if (new Set(result.records.map(r => r.id)).size !== result.records.length)
    fail();
  return result;
}
export function validateHqChangePage(value: unknown): HqChangePage {
  const result = page<HqChangePage>(value, "ChangePage", "changes");
  if (!result.upperWatermark.trim()) fail();
  for (const record of result.records) change(record, result);
  if (
    new Set(result.records.map(r => r.position)).size !== result.records.length
  )
    fail();
  return result;
}
