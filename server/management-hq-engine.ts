import type { HqAmount, HqBooking, HqBookingPage, HqChangePage, HqCommissionResult, HqEnvelope, HqIdentity } from '../shared/management-hq-types';
import type { HqReader } from './management-hq-orbit-client';
import { validateHqBookingPage, validateHqChangePage } from './management-hq-contract';
import type { HqAgentReportRow, HqBookingDrilldown, HqCommissionPassthrough, HqMoneyCoverage, HqReport, HqReportPerson, HqReportTotals } from '../shared/management-hq-report';
export type { HqReport } from '../shared/management-hq-report';

export interface HqStoredRecord {
  revision: string;
  tombstone: boolean;
  booking: HqBooking | null;
  /** Full locally canonicalized payload, not an untrusted source hash. */
  canonicalPayload: string;
  tombstoneReason: string | null;
}
export interface HqState {
  version: number;
  scopeId: string;
  watermark: string;
  envelope: HqEnvelope;
  records: Record<string, HqStoredRecord>;
}
export interface HqStore {
  read(): Promise<HqState | null>;
  /** Must atomically replace the entire state only if the persisted version matches. */
  compareAndSwap(expectedVersion: number | null, next: HqState): Promise<boolean>;
}
export interface HqIdentityDirectory {
  /** Parent owns approved namespace resolution and strict historical canonical merging. */
  resolve(evidence: HqIdentity): Promise<HqReportPerson | null>;
}
export type HqIngestionResult = { status: 'applied'; state: HqState; pages: number; recordsRead: number; unchanged: boolean } | { status: 'unavailable'; code: string; state: HqState | null };
export interface HqEngineOptions {
  /** Exact principal-bound scope identifier; wildcard scopes are forbidden. */
  scopeId: string;
  maxPages?: number;
  maxRecords?: number;
  maxStateBytes?: number;
}
class Unavailable extends Error { constructor(readonly code: string) { super(code); } }
const fail = (code: string): never => { throw new Unavailable(code); };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function canonicalHqJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalHqJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalHqJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
function revision(value: string): bigint {
  if (!/^[0-9]+$/.test(value) || value.length > 256) return fail('INVALID_REVISION');
  return BigInt(value);
}
function generationMetadata(page: HqBookingPage | HqChangePage): HqEnvelope {
  // Pin ALL supplied metadata, including future extension fields. Pagination alone may vary.
  const { records: _records, ...rest } = page;
  const result = { ...rest } as Record<string, unknown>;
  delete result.upperWatermark;
  delete result.nextCursor;
  delete result.hasMore;
  return { ...result, nextCursor: null, hasMore: false } as unknown as HqEnvelope;
}
function ensureBooking(booking: HqBooking, envelope: HqEnvelope) {
  if (!booking.childMembershipComplete) fail('INCOMPLETE_CHILD_MEMBERSHIP');
  if (booking.dates.dateRuleVersion !== envelope.dateRuleVersion || booking.eligibility.statusRuleVersion !== envelope.statusRuleVersion || booking.financials.policyVersion !== envelope.financialPolicyVersion) fail('ROW_RULE_DRIFT');
  revision(booking.revision);
}
function applyBooking(records: Record<string, HqStoredRecord>, booking: HqBooking) {
  const current = records[booking.id];
  const payload = canonicalHqJson(booking);
  if (current) {
    const order = revision(booking.revision) - revision(current.revision);
    if (order < BigInt(0)) fail('STALE_REVISION');
    if (order === BigInt(0)) {
      if (current.canonicalPayload !== payload || (current.tombstone && current.tombstoneReason !== 'absent_from_complete_backfill')) fail('REVISION_CONFLICT');
      if (!current.tombstone) return;
    }
  }
  records[booking.id] = { revision: booking.revision, tombstone: false, booking: clone(booking), canonicalPayload: payload, tombstoneReason: null };
}
/** Memory-only helper. No database, network, environment or operational imports. */
export function createHqMemoryStore(initial: HqState | null = null): HqStore {
  let state = clone(initial);
  return {
    async read() { return clone(state); },
    async compareAndSwap(expectedVersion, next) {
      if ((state?.version ?? null) !== expectedVersion) return false;
      state = clone(next);
      return true;
    },
  };
}
export function createHqEngine(reader: HqReader, store: HqStore, options: HqEngineOptions) {
  const { scopeId } = options;
  if (!scopeId.trim() || scopeId.includes('*')) throw new Error('Exact configured HQ scope required');
  const maxPages = options.maxPages ?? 1000;
  const maxRecords = options.maxRecords ?? 100000;
  const maxStateBytes = options.maxStateBytes ?? 64 * 1024 * 1024;
  for (const n of [maxPages, maxRecords, maxStateBytes]) if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid HQ ingestion cap');
  async function ingest(mode: 'backfill' | 'catchup', after?: string, initialCursor?: string): Promise<HqIngestionResult> {
    let base: HqState | null = null;
    try {
      base = await store.read();
      if (base && base.scopeId !== scopeId) fail('STATE_SCOPE_MISMATCH');
      // An arbitrary continuation cannot prove we consumed the generation's beginning.
      if (initialCursor !== undefined) fail('CURSOR_REQUIRES_STAGED_GENERATION');
      if (mode === 'catchup' && (!base || after !== base.watermark)) fail('CHECKPOINT_MISMATCH');
      const records: Record<string, HqStoredRecord> = clone(base?.records ?? {});
      const seenIds = new Set<string>();
      const seenCursors = new Set<string>();
      const positions = new Map<string, string>();
      let pinned: HqEnvelope | null = null;
      let upper: string | null = null;
      let cursor: string | undefined;
      let pages = 0;
      let recordsRead = 0;
      do {
        if (++pages > maxPages) fail('PAGE_CAP_EXCEEDED');
        const raw = mode === 'backfill' ? await reader.bookings(cursor) : await reader.changes(after!, cursor);
        // Full AJV validators are shared with the real reader; fixtures use the same path.
        const page = mode === 'backfill' ? validateHqBookingPage(raw) : validateHqChangePage(raw);
        if (page.scopeId !== scopeId) fail('SOURCE_SCOPE_MISMATCH');
        if (page.dataset !== (mode === 'backfill' ? 'bookings' : 'changes')) fail('DATASET_MISMATCH');
        if (!page.snapshotId || !page.watermark || !page.sourceObservationCompletedAt || !page.projectionPublishedAt) fail('INCOMPLETE_GENERATION');
        const metadata = generationMetadata(page);
        if (mode === 'catchup' && base && (metadata.dateRuleVersion !== base.envelope.dateRuleVersion || metadata.statusRuleVersion !== base.envelope.statusRuleVersion || metadata.financialPolicyVersion !== base.envelope.financialPolicyVersion)) fail('RULE_CHANGE_REQUIRES_BACKFILL');
        if (pinned && canonicalHqJson(pinned) !== canonicalHqJson(metadata)) fail('GENERATION_METADATA_DRIFT');
        pinned ??= metadata;
        if (mode === 'catchup') {
          const fixed = (page as HqChangePage).upperWatermark;
          if (!fixed) fail('MISSING_UPPER_WATERMARK');
          if (upper !== null && upper !== fixed) fail('UPPER_WATERMARK_DRIFT');
          upper = fixed;
        }
        if ((recordsRead += page.records.length) > maxRecords) fail('RECORD_CAP_EXCEEDED');
        if (mode === 'backfill') {
          for (const booking of (page as HqBookingPage).records) {
            ensureBooking(booking, pinned);
            applyBooking(records, booking);
            seenIds.add(booking.id);
          }
        } else {
          for (const change of (page as HqChangePage).records) {
            if (change.entityType !== 'booking') fail(`UNSUPPORTED_${change.entityType.toUpperCase()}_CHANGE`);
            if (change.reason === 'mapping_changed') fail('UNSUPPORTED_BUSINESS_MAPPING_CHANGE');
            revision(change.revision);
            const canonicalChange = canonicalHqJson(change);
            if (positions.has(change.position) && positions.get(change.position) !== canonicalChange) fail('POSITION_CONFLICT');
            positions.set(change.position, canonicalChange);
            if (change.operation === 'upsert') {
              if (!change.booking || change.mapping !== null || change.quote !== null || change.booking.id !== change.id || change.booking.revision !== change.revision) fail('CHANGE_PAYLOAD_MISMATCH');
              ensureBooking(change.booking!, pinned);
              applyBooking(records, change.booking!);
            } else {
              if (change.booking !== null || change.mapping !== null || change.quote !== null) fail('TOMBSTONE_PAYLOAD_PRESENT');
              const old = records[change.id];
              if (old && revision(change.revision) < revision(old.revision)) fail('STALE_REVISION');
              const canonicalPayload = canonicalHqJson({ entityType: 'booking', id: change.id, revision: change.revision, operation: 'tombstone', reason: change.reason });
              if (old && revision(change.revision) === revision(old.revision) && (!old.tombstone || old.canonicalPayload !== canonicalPayload)) fail('REVISION_CONFLICT');
              records[change.id] = { revision: change.revision, tombstone: true, booking: null, canonicalPayload, tombstoneReason: change.reason };
            }
          }
        }
        if (page.hasMore) {
          if (!page.nextCursor || seenCursors.has(page.nextCursor)) fail('CURSOR_LOOP');
          if (page.nextCursor!.length > 2048) fail('CURSOR_TOO_LONG');
          seenCursors.add(page.nextCursor!);
          cursor = page.nextCursor!;
        } else {
          if (page.nextCursor !== null) fail('PAGINATION_INCONSISTENT');
          cursor = undefined;
        }
      } while (cursor !== undefined);
      if (!pinned) fail('INCOMPLETE_GENERATION');
      // Absence only means out of the completed full population. Retain revision history.
      if (mode === 'backfill') for (const [id, old] of Object.entries(records)) {
        if (!seenIds.has(id) && !old.tombstone) records[id] = { ...old, booking: null, tombstone: true, tombstoneReason: 'absent_from_complete_backfill' };
      }
      if (Object.keys(records).length > maxRecords) fail('STATE_RECORD_CAP_EXCEEDED');
      if (base && !Number.isSafeInteger(base.version + 1)) fail('STATE_VERSION_OVERFLOW');
      const next: HqState = { version: (base?.version ?? 0) + 1, scopeId, watermark: mode === 'backfill' ? pinned.watermark : upper!, envelope: pinned, records };
      if (Buffer.byteLength(JSON.stringify(next)) > maxStateBytes) fail('STATE_BYTE_CAP_EXCEEDED');
      const unchanged = base !== null && canonicalHqJson({ ...base, version: 0 }) === canonicalHqJson({ ...next, version: 0 });
      // Even idempotent publication checks CAS: never return a stale state after a concurrent writer.
      if (unchanged) next.version = base!.version;
      if (!await store.compareAndSwap(base?.version ?? null, next)) fail('CAS_CONFLICT');
      return { status: 'applied', state: next, pages, recordsRead, unchanged };
    } catch (error) {
      const candidate = error as { code?: unknown; status?: unknown };
      const code = error instanceof Unavailable ? error.code : candidate?.status === 410 || candidate?.code === 'SNAPSHOT_EXPIRED' || candidate?.code === 'CURSOR_EXPIRED' || candidate?.code === 'RESTART_REQUIRED' ? 'SOURCE_EXPIRED' : 'SOURCE_OR_STORE_UNAVAILABLE';
      return { status: 'unavailable', code, state: base };
    }
  }
  return { backfill: (cursor?: string) => ingest('backfill', undefined, cursor), catchup: (after: string, cursor?: string) => ingest('catchup', after, cursor) };
}

const REPORT_MAX_ROWS = 20000;
const REPORT_MAX_BYTES = 16 * 1024 * 1024;
const REPORT_MAX_TEXT = 512;
export function hqPennies(value: string): bigint {
  if (!/^-?[0-9]+\.[0-9]{2}$/.test(value) || value.length > 128) throw new Error('Invalid exact HQ money');
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split('.');
  const pennies = BigInt(whole) * BigInt(100) + BigInt(fraction);
  return negative ? -pennies : pennies;
}
export function hqDecimal(pennies: bigint): string {
  const negative = pennies < BigInt(0);
  const positive = negative ? -pennies : pennies;
  return `${negative ? '-' : ''}${positive / BigInt(100)}.${(positive % BigInt(100)).toString().padStart(2, '0')}`;
}
function ratio(numerator: bigint, denominator: bigint): string | null {
  if (denominator === BigInt(0)) return null;
  const negative = (numerator < BigInt(0)) !== (denominator < BigInt(0));
  const n = numerator < BigInt(0) ? -numerator : numerator;
  const d = denominator < BigInt(0) ? -denominator : denominator;
  // Six-place presentation only; retain exact covered numerator/denominator alongside it.
  const scaled = (n * BigInt(1000000) + d / BigInt(2)) / d;
  return `${negative && scaled !== BigInt(0) ? '-' : ''}${scaled / BigInt(1000000)}.${(scaled % BigInt(1000000)).toString().padStart(6, '0')}`;
}
function known(amount: HqAmount, booking: HqBooking): bigint | null {
  if (booking.currency !== 'GBP' || booking.currencyBasis !== 'validated_GBP' || amount.currency !== 'GBP' || ['missing', 'invalid'].includes(amount.state) || amount.amount === null) return null;
  if (amount.state === 'not_applicable' && (!/^-?0+\.00$/.test(amount.amount) || !amount.source?.trim())) return null;
  try { return hqPennies(amount.amount); } catch { return null; }
}
function metric(bookings: HqBooking[], select: (b: HqBooking) => HqAmount, gate: (b: HqBooking) => boolean = () => true): HqMoneyCoverage {
  let sum = BigInt(0), coveredCount = 0, estimatedCount = 0, actualRecordedCount = 0, notApplicableCount = 0, missingCount = 0;
  for (const b of bookings) {
    const a = select(b), value = gate(b) ? known(a, b) : null;
    notApplicableCount += Number(a.state === 'not_applicable');
    if (value !== null) { sum += value; coveredCount++; estimatedCount += Number(a.state === 'estimated'); actualRecordedCount += Number(a.state === 'actual_recorded'); }
    else if (a.state !== 'not_applicable') missingCount++;
  }
  return { knownSum: coveredCount ? hqDecimal(sum) : null, coveredCount, eligibleCount: bookings.length, missingCount, notApplicableCount, estimatedCount, actualRecordedCount };
}
function headline(b: HqBooking) { return b.status === 'confirmed' && b.eligibility.headlineCount === true; }
function totals(bookings: HqBooking[]): HqReportTotals {
  const counts = bookings.filter(headline);
  const grossEligible = bookings.filter(b => b.status === 'confirmed' && b.eligibility.headlineGrossSales === true);
  let profit = BigInt(0), gross = BigInt(0), covered = 0;
  for (const b of grossEligible) {
    const g = known(b.financials.grossBookingValue, b), p = known(b.financials.grossBookingProfit, b);
    if (b.financials.completeGrossAndCost && g !== null && p !== null) { gross += g; profit += p; covered++; }
  }
  const fin = grossEligible;
  return {
    bookingCount: counts.length,
    passengerCount: counts.reduce((sum, b) => sum + (b.passengerCount ?? 0), 0),
    unknownPassengerCount: counts.filter(b => b.passengerCount === null).length,
    grossSales: metric(fin, b => b.financials.grossBookingValue),
    supplierNetCost: metric(fin, b => b.financials.supplierNetCost, b => b.financials.completeGrossAndCost),
    knownSupplierNetSubtotal: metric(fin, b => b.financials.knownSupplierNetSubtotal),
    grossProfit: metric(fin, b => b.financials.grossBookingProfit, b => b.financials.completeGrossAndCost),
    weightedMargin: { fraction: covered ? ratio(profit, gross) : null, coveredCount: covered, coveredGross: covered ? hqDecimal(gross) : null, coveredProfit: covered ? hqDecimal(profit) : null },
    applicableVat: metric(fin, b => b.financials.applicableVat),
    ptsFees: metric(fin, b => b.financials.ptsFees),
    actualCardFees: metric(fin, b => b.financials.actualCardProcessingFees, b => b.financials.actualCardProcessingFees.state === 'actual_recorded'),
    estimatedCardFees: metric(fin, b => b.financials.estimatedCardProcessingFees, b => b.financials.estimatedCardProcessingFees.state === 'estimated'),
    baselineAgentCommission: metric(fin, b => b.financials.orbitCommissionBaseline.agentCommission),
    baselineJltRetainedCommission: metric(fin, b => b.financials.orbitCommissionBaseline.jltRetainedCommission),
    completeAgentCommission: metric(fin, b => b.financials.policyCompleteCommission.agentCommission, b => b.financials.completeApprovedDeductions && b.financials.policyCompleteCommission.complete && b.financials.policyCompleteCommission.terms.state === 'verified'),
    completeJltRetainedCommission: metric(fin, b => b.financials.policyCompleteCommission.jltRetainedCommission, b => b.financials.completeApprovedDeductions && b.financials.policyCompleteCommission.complete && b.financials.policyCompleteCommission.terms.state === 'verified'),
    settledJltIncome: metric(fin, b => b.financials.settledJltIncome, b => b.financials.settledJltIncome.state === 'actual_recorded' && b.financials.settledJltIncome.evidenceIds.length > 0),
  };
}
function validDate(date: string | null): date is string {
  return !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
function cohort(b: HqBooking): HqBookingDrilldown['cohort'] {
  return b.status === 'cancelled' ? 'cancelled' : b.status === 'pending' ? 'pending' : headline(b) ? 'headline' : 'exception';
}
function boundedPerson(person: HqReportPerson | null): HqReportPerson | null {
  if (!person) return null;
  if (!Number.isSafeInteger(person.userId) || person.userId < 1 || person.name.length > REPORT_MAX_TEXT || (person.uniqueAgentId?.length ?? 0) > REPORT_MAX_TEXT || person.role.length > 64) throw new Error('Invalid directory identity');
  return { userId: person.userId, uniqueAgentId: person.uniqueAgentId, name: person.name, role: person.role };
}
function financeTextBound(value: unknown): boolean {
  if (typeof value === 'string') return value.length <= REPORT_MAX_TEXT;
  if (Array.isArray(value)) return value.length <= 100 && value.every(financeTextBound);
  if (value !== null && typeof value === 'object') return Object.values(value).every(financeTextBound);
  return true;
}
function commissionPassthrough(c: HqCommissionResult, b: HqBooking): HqCommissionPassthrough {
  const a = (amount: HqAmount) => known(amount, b) === null ? null : amount.amount;
  return { basis: c.basis, complete: c.complete, netDistributableCommission: a(c.netDistributableCommission), agentCommission: a(c.agentCommission), jltRetainedCommission: a(c.jltRetainedCommission), cardProcessingFeesIncluded: c.cardProcessingFeesIncluded, vatIncluded: c.vatIncluded, ptsIncluded: c.ptsIncluded, terms: { agentFraction: c.terms.agentFraction, jltFraction: c.terms.jltFraction, state: c.terms.state }, roundingBasis: c.roundingBasis, roundingResidual: a(c.roundingResidual), limitations: [...c.limitations] };
}
export async function getHqReport(state: HqState, directory: HqIdentityDirectory, filters: { year: number; month?: number }): Promise<HqReport> {
  if (!Number.isInteger(filters.year) || filters.year < 1900 || filters.year > 9999 || (filters.month !== undefined && (!Number.isInteger(filters.month) || filters.month < 1 || filters.month > 12))) throw new Error('Invalid HQ report period');
  const result: HqReport = {
    status: 'available', unavailableReason: null, liveReady: false,
    scopeId: state.scopeId, watermark: state.watermark, snapshotId: state.envelope.snapshotId,
    filters: { year: filters.year, month: filters.month ?? null }, currency: 'GBP', totals: totals([]),
    cohorts: { pendingCount: 0, cancelledCount: 0, exceptionCount: 0, undatedCount: 0, unmatchedBusinessCount: 0, unattributedCount: 0, excludedDemoCount: 0, tombstoneCount: 0, unsupportedCurrencyCount: 0 },
    monthly: [], agents: [], bookings: [], undatedExceptions: [], exportComplete: true,
    limitations: ['Proposed contract; no verified live deployment or approved identity namespace.', 'Current restated booking values, not an amendment/event ledger.', 'Pending excluded until approval; cancellations retained in their selected cohort.', 'GBP totals only on validated GBP basis; native/unverified currencies excluded from monetary sums.', 'Baseline commission is source passthrough, not policy-complete entitlement or settled cash.', 'Business mapping is not evidence of seller ownership; verified original seller with agent role required.', 'Quotes and independent business-mapping change events are unsupported; activity means booking cohort counts only.', ...state.envelope.coverage.limitations],
  };
  const unavailable = (reason: string) => ({ ...result, status: 'unavailable' as const, unavailableReason: reason, totals: totals([]), monthly: [], agents: [], bookings: [], undatedExceptions: [], exportComplete: false });
  if (state.scopeId !== state.envelope.scopeId || state.envelope.hasMore || state.envelope.nextCursor !== null || !state.envelope.sourceObservationCompletedAt) return unavailable('INCOMPLETE_OR_UNBOUND_STATE');
  if (Object.keys(state.records).length > REPORT_MAX_ROWS) return unavailable('REPORT_ROW_CAP_EXCEEDED');
  const active = Object.values(state.records).filter(r => !r.tombstone && r.booking !== null).map(r => r.booking!);
  result.cohorts.tombstoneCount = Object.values(state.records).filter(r => r.tombstone).length;
  result.cohorts.excludedDemoCount = active.filter(b => b.currentOwningBusiness.accountType === 'demo').length;
  const real = active.filter(b => b.currentOwningBusiness.accountType === 'real');
  const undated = real.filter(b => !validDate(b.dates.managementReportingDate) || !b.eligibility.dated);
  const selected = real.filter(b => validDate(b.dates.managementReportingDate) && b.eligibility.dated && Number(b.dates.managementReportingDate.slice(0, 4)) === filters.year && (filters.month === undefined || Number(b.dates.managementReportingDate.slice(5, 7)) === filters.month));
  result.cohorts.undatedCount = undated.length;
  const sellers = new Map<string, HqReportPerson | null>();
  try {
    for (const b of [...selected, ...undated]) {
      if (b.bookingRef.length > REPORT_MAX_TEXT || b.currentOwningBusiness.name.length > REPORT_MAX_TEXT || b.qualityIssues.length > 100 || b.qualityIssues.some(s => s.length > REPORT_MAX_TEXT) || !financeTextBound(b.financials)) return unavailable('REPORT_FIELD_CAP_EXCEEDED');
      const e = b.originalSellingAgent;
      const resolved = e.state === 'verified' && e.id && e.namespace ? boundedPerson(await directory.resolve(e)) : null;
      const seller = resolved?.role === 'agent' ? resolved : null;
      const p = b.processingAdministrator;
      const processor = p.state === 'verified' && p.id && p.namespace ? boundedPerson(await directory.resolve(p)) : null;
      sellers.set(b.id, seller);
      const a = (amount: HqAmount) => known(amount, b) === null ? null : amount.amount;
      const f = b.financials;
      const row: HqBookingDrilldown = {
        id: b.id, bookingRef: b.bookingRef, revision: b.revision, status: b.status,
        reportingDate: validDate(b.dates.managementReportingDate) && b.eligibility.dated ? b.dates.managementReportingDate : null,
        dateSource: b.dates.dateSource, cohort: validDate(b.dates.managementReportingDate) && b.eligibility.dated ? cohort(b) : 'exception',
        business: { orbitTenantId: b.currentOwningBusiness.orbitTenantId, name: b.currentOwningBusiness.name, mappingStatus: b.currentOwningBusiness.mappingStatus, portalBusinessId: b.currentOwningBusiness.portalBusinessId },
        seller, sellerReason: seller ? null : resolved ? 'RESOLVED_MEMBER_NOT_AGENT' : e.state !== 'verified' ? 'ORIGINAL_SELLER_NOT_VERIFIED' : 'ORIGINAL_SELLER_UNRESOLVED', processor,
        passengerCount: b.passengerCount, currency: b.currency, currencyBasis: b.currencyBasis,
        financials: {
          gross: a(f.grossBookingValue), supplierNet: f.completeGrossAndCost ? a(f.supplierNetCost) : null, knownSupplierNetSubtotal: a(f.knownSupplierNetSubtotal), grossProfit: f.completeGrossAndCost ? a(f.grossBookingProfit) : null,
          applicableVat: a(f.applicableVat), ptsFees: a(f.ptsFees), actualCardFees: f.actualCardProcessingFees.state === 'actual_recorded' ? a(f.actualCardProcessingFees) : null, estimatedCardFees: f.estimatedCardProcessingFees.state === 'estimated' ? a(f.estimatedCardProcessingFees) : null,
          baselineAgentCommission: a(f.orbitCommissionBaseline.agentCommission), baselineJltRetainedCommission: a(f.orbitCommissionBaseline.jltRetainedCommission),
          completeAgentCommission: f.completeApprovedDeductions && f.policyCompleteCommission.complete && f.policyCompleteCommission.terms.state === 'verified' ? a(f.policyCompleteCommission.agentCommission) : null,
          completeJltRetainedCommission: f.completeApprovedDeductions && f.policyCompleteCommission.complete && f.policyCompleteCommission.terms.state === 'verified' ? a(f.policyCompleteCommission.jltRetainedCommission) : null,
          settledJltIncome: f.settledJltIncome.state === 'actual_recorded' && f.settledJltIncome.evidenceIds.length ? a(f.settledJltIncome) : null,
          cancellationCharges: a(f.cancellationCharges), cancellationRetainedCommission: a(f.cancellationRetainedCommission), baselineComplete: f.orbitCommissionBaseline.complete, policyComplete: f.completeApprovedDeductions && f.policyCompleteCommission.complete && f.policyCompleteCommission.terms.state === 'verified',
          grossMargin: { ...f.grossBookingMargin }, baseline: commissionPassthrough(f.orbitCommissionBaseline, b), policy: commissionPassthrough(f.policyCompleteCommission, b),
          otherDeductions: f.otherDeductions?.map(d => ({ code: d.code, amount: a(d.amount), currency: d.amount.currency, state: d.amount.state, applicability: d.applicability, alreadyIncludedElsewhere: d.alreadyIncludedElsewhere, policySource: d.policySource })) ?? null,
          policyVersion: f.policyVersion, ptsFeeBasis: f.ptsFeeBasis, ptsAssumptions: [...f.ptsAssumptions], completeGrossAndCost: f.completeGrossAndCost, completeApprovedDeductions: f.completeApprovedDeductions, warnings: [...f.warnings],
          amountStates: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && typeof v === 'object' && 'amount' in v && 'state' in v).map(([key, value]) => { const amount = value as HqAmount; return [key, { state: amount.state, currency: amount.currency, reason: amount.reason }]; })),
        }, qualityIssues: [...b.qualityIssues],
      };
      (row.reportingDate === null ? result.undatedExceptions : result.bookings).push(row);
    }
  } catch { return unavailable('IDENTITY_DIRECTORY_UNAVAILABLE'); }
  result.bookings.sort((a, b) => a.id.localeCompare(b.id));
  result.undatedExceptions.sort((a, b) => a.id.localeCompare(b.id));
  result.totals = totals(selected);
  result.cohorts.pendingCount = selected.filter(b => b.status === 'pending').length;
  result.cohorts.cancelledCount = selected.filter(b => b.status === 'cancelled').length;
  result.cohorts.exceptionCount = selected.filter(b => cohort(b) === 'exception').length;
  result.cohorts.unmatchedBusinessCount = selected.filter(b => b.currentOwningBusiness.mappingStatus !== 'verified').length;
  result.cohorts.unattributedCount = selected.filter(b => !sellers.get(b.id)).length;
  result.cohorts.unsupportedCurrencyCount = selected.filter(b => b.currency !== 'GBP' || b.currencyBasis !== 'validated_GBP').length;
  result.monthly = Array.from({ length: 12 }, (_, i) => {
    const rows = selected.filter(b => Number(b.dates.managementReportingDate!.slice(5, 7)) === i + 1);
    return { month: i + 1, totals: totals(rows), pendingCount: rows.filter(b => b.status === 'pending').length, cancelledCount: rows.filter(b => b.status === 'cancelled').length, exceptionCount: rows.filter(b => cohort(b) === 'exception').length };
  });
  const agents = new Map<number, { person: HqReportPerson; rows: HqBooking[] }>();
  for (const b of selected) {
    const seller = sellers.get(b.id);
    if (!seller) continue;
    if (!agents.has(seller.userId)) agents.set(seller.userId, { person: seller, rows: [] });
    const group = agents.get(seller.userId)!;
    if (canonicalHqJson(group.person) !== canonicalHqJson(seller)) return unavailable('DIRECTORY_CANONICAL_IDENTITY_CONFLICT');
    group.rows.push(b);
  }
  result.agents = Array.from(agents.values()).map(({ person, rows }): HqAgentReportRow => ({ agent: person, totals: totals(rows), pendingCount: rows.filter(b => b.status === 'pending').length, cancelledCount: rows.filter(b => b.status === 'cancelled').length })).sort((a, b) => a.agent.userId - b.agent.userId);
  if (Buffer.byteLength(JSON.stringify(result)) > REPORT_MAX_BYTES) return unavailable('REPORT_BYTE_CAP_EXCEEDED');
  return result;
}
/** Always quote cells and neutralize formula-like TEXT. Never truncates an export. */
export function hqCsvCell(value: string | number | null, text = true): string {
  let s = value === null ? '' : String(value);
  if (text && /^[\s\u0000-\u001f]*[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function exportHqReportCsv(report: HqReport): string {
  if (report.status !== 'available' || !report.exportComplete) throw new Error('HQ export unavailable; complete bounded report required');
  const rows = [...report.bookings, ...report.undatedExceptions];
  if (rows.length > REPORT_MAX_ROWS) throw new Error('HQ export row cap exceeded');
  const header = ['Booking ID', 'Reference', 'Reporting date', 'Status', 'Cohort', 'Business', 'Seller user ID', 'Seller agent ID', 'Seller', 'Processor', 'Passengers', 'Currency', 'Gross GBP', 'Gross profit GBP', 'Baseline agent commission GBP', 'Policy-complete agent commission GBP', 'Settled JLT income GBP'];
  const csv = [header.map(v => hqCsvCell(v)).join(','), ...rows.map(b => [b.id, b.bookingRef, b.reportingDate, b.status, b.cohort, b.business.name, b.seller?.userId ?? null, b.seller?.uniqueAgentId ?? null, b.seller?.name ?? null, b.processor?.name ?? null, b.passengerCount, b.currency, b.financials.gross, b.financials.grossProfit, b.financials.baselineAgentCommission, b.financials.completeAgentCommission, b.financials.settledJltIncome].map(v => hqCsvCell(v)).join(','))].join('\r\n') + '\r\n';
  if (Buffer.byteLength(csv) > REPORT_MAX_BYTES) throw new Error('HQ export byte cap exceeded');
  return csv;
}
