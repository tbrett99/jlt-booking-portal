import type { HqAmount, HqBooking, HqBookingPage, HqChange, HqChangePage, HqCommissionResult, HqEnvelope, HqIdentity, HqReader } from '../shared/management-hq-types';
import { createHqEngine, createHqMemoryStore, type HqIdentityDirectory, type HqState, type HqStore } from './management-hq-engine';

/** TEST CONVENTIONS ONLY. Awaiting Orbit signoff, never approved production namespaces. */
export const HQ_SAMPLE_SCOPE = 'SAMPLE-ONLY-principal-bound-real-business-scope';
export const HQ_SAMPLE_NAMESPACES = { userId: 'portal.user_id', uniqueAgentId: 'portal.unique_agent_id' } as const;
const DATE_RULE = 'management-current-v1';
const STATUS_RULE = 'confirmed-only-proposed-v1';
const FINANCIAL_RULE = 'v1-source-adapter-approval-pending';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function hqSampleAmount(amount: string | null, state: HqAmount['state'] = amount === null ? 'missing' : 'source_recorded', currency = 'GBP'): HqAmount {
  return { amount, currency, state, source: amount === null ? null : 'SAMPLE-ONLY source fixture; not actual finance', reason: amount === null ? 'Synthetic missing evidence, not zero' : null, evidenceIds: [] };
}
export function hqSampleIdentity(id: string | null, namespace: string | null = HQ_SAMPLE_NAMESPACES.userId, state: HqIdentity['state'] = id === null ? 'missing' : 'verified'): HqIdentity {
  return { namespace: id === null ? null : namespace, id, state, source: id === null ? null : 'SAMPLE-ONLY identity evidence; namespace unapproved' };
}
function commission(basis: string, agent: string | null, jlt: string | null): HqCommissionResult {
  const net = agent === '320.00' ? '400.00' : agent === '160.00' ? '200.00' : agent === '400.00' ? '500.00' : null;
  return {
    basis, complete: false, cardProcessingFeesIncluded: false, vatIncluded: true, ptsIncluded: true,
    netDistributableCommission: hqSampleAmount(net, net === null ? 'missing' : 'estimated'), agentCommission: hqSampleAmount(agent, agent === null ? 'missing' : 'estimated'), jltRetainedCommission: hqSampleAmount(jlt, jlt === null ? 'missing' : 'estimated'),
    terms: { agentFraction: '0.80', jltFraction: '0.20', state: 'stated_default_unverified', source: 'SAMPLE-ONLY baseline terms; not actual profile terms' },
    roundingBasis: 'Source passthrough; no portal finance recomputation', roundingResidual: hqSampleAmount(null), limitations: ['SAMPLE-ONLY prefilled literals, not existing finance helper execution', 'PPS fees/custom terms not evidenced; baseline is not settled cash'],
  };
}
/** Complete synthetic source payload factory, useful for isolated tests. */
export function createHqSampleBooking(overrides: Partial<HqBooking> = {}): HqBooking {
  const b: HqBooking = {
    id: '9000001', bookingRef: 'SAMPLE-ONLY-001', revision: '1', contentHash: 'SAMPLE-untrusted-hash-001',
    sourceUpdatedAt: '2026-01-10T12:00:00Z', sourceObservedAt: '2026-01-11T12:00:00Z', status: 'confirmed',
    dates: { portalRegisteredAt: '2026-01-10T12:00:00Z', bookedOnRaw: '2026-01-08', bookedOn: '2026-01-08', managementReportingDate: '2026-01-10', dateSource: 'portal_registered_at', dateRuleVersion: DATE_RULE, warnings: [] },
    eligibility: { headlineCount: true, headlineGrossSales: true, cancelledCohort: false, pendingCohort: false, dated: true, statusRuleVersion: STATUS_RULE, reason: null },
    currency: 'GBP', currencyBasis: 'validated_GBP', passengerCount: 3, bookingType: 'hotel',
    currentOwningBusiness: { orbitTenantId: '9001001', name: 'SAMPLE Duo Business (not a real agency)', accountType: 'real', active: true, portalBusinessId: 'sample-business-a', mappingStatus: 'verified', mappingRevision: '1', mappingSource: 'SAMPLE-ONLY business evidence; not seller ownership' },
    originalSellingBusiness: hqSampleIdentity(null), originalSellingAgent: hqSampleIdentity('101'), assignedUser: hqSampleIdentity('47', HQ_SAMPLE_NAMESPACES.userId, 'current_assignment'), processingAdministrator: hqSampleIdentity('47'),
    financials: {
      grossBookingValue: hqSampleAmount('5000.00'), supplierNetCost: hqSampleAmount('4500.00'), knownSupplierNetSubtotal: hqSampleAmount('4500.00'), grossBookingProfit: hqSampleAmount('500.00', 'calculated'), grossBookingMargin: { fraction: '0.1', state: 'calculated', denominator: 'Same covered gross before deductions' },
      applicableVat: hqSampleAmount(null, 'not_applicable'), legacyBookingVatOverride: hqSampleAmount(null), ptsFees: hqSampleAmount('20.00', 'estimated'), ptsFeeBasis: 'SAMPLE-ONLY estimated existing-helper-shaped input', ptsAssumptions: ['Synthetic literals; existing tariff helper not executed'], actualCardProcessingFees: hqSampleAmount(null), estimatedCardProcessingFees: hqSampleAmount('15.00', 'estimated'), otherDeductions: null,
      orbitCommissionBaseline: commission('orbit_vat_pts_estimate', '320.00', '80.00'), policyCompleteCommission: commission('approved_all_applicable_deductions_pending', null, null),
      settledJltIncome: hqSampleAmount(null), cancellationCharges: hqSampleAmount(null), cancellationRetainedCommission: hqSampleAmount(null), completeGrossAndCost: true, completeApprovedDeductions: false, policyVersion: FINANCIAL_RULE, warnings: ['Actual fees, applicable terms and settlement evidence not supplied'],
    },
    products: [{ id: '9003001', productType: 'hotel', rawBookingStatus: 'confirmed', financialActive: true, supplierId: null, supplierName: 'SAMPLE Supplier', grossValue: hqSampleAmount('5000.00'), netCost: hqSampleAmount('4500.00'), allocationBasis: 'Single product; no passenger multiplier', vatApplicable: null, vatOverride: null, isReimbursement: false, sourceUpdatedAt: '2026-01-10T12:00:00Z' }],
    payments: [], childMembershipComplete: true, qualityIssues: ['SYNTHETIC_FIXTURE_ONLY', 'ACTUAL_CARD_FEE_SOURCE_UNMAPPED'],
  };
  return copy({ ...b, ...overrides });
}
export function createHqSampleEnvelope(stage = 'initial', dataset = 'bookings'): HqEnvelope {
  const published = stage === 'initial' ? '2026-01-31T12:00:00Z' : stage === 'amended' ? '2026-04-20T12:00:00Z' : '2026-05-20T12:00:00Z';
  return {
    contractVersion: '1.0.0-proposed', dataset, snapshotId: `SAMPLE-generation-${stage}`, watermark: `opaque-SAMPLE-${stage}-watermark`, projectionPublishedAt: published, sourceObservationStartedAt: published, sourceObservationCompletedAt: published,
    dateRuleVersion: DATE_RULE, statusRuleVersion: STATUS_RULE, financialPolicyVersion: FINANCIAL_RULE, scopeId: HQ_SAMPLE_SCOPE,
    coverage: { status: 'unverified', requestedFrom: '2026-01-01', verifiedFrom: null, verifiedThrough: null, population: 'SAMPLE-ONLY fixtures; zero live history verified', undatedCount: 1, unmatchedBusinessCount: 1, limitations: ['No deployed Orbit HQ source', 'All people/businesses/values are synthetic; test namespaces awaiting Orbit approval'] }, nextCursor: null, hasMore: false,
  };
}
export function createHqSampleRecords(): HqBooking[] {
  const main = createHqSampleBooking();
  const second = createHqSampleBooking({ id: '9000002', bookingRef: 'SAMPLE-ONLY-002', passengerCount: 2, originalSellingAgent: hqSampleIdentity('JLT-0002', HQ_SAMPLE_NAMESPACES.uniqueAgentId) });
  second.dates.portalRegisteredAt = null;
  second.dates.managementReportingDate = '2026-01-08';
  second.dates.dateSource = 'booked_on';
  second.dates.warnings = ['BOOKED_DATE_FALLBACK'];
  second.financials.grossBookingValue = hqSampleAmount('2000.00');
  second.financials.supplierNetCost = hqSampleAmount('1700.00');
  second.financials.knownSupplierNetSubtotal = hqSampleAmount('1700.00');
  second.financials.grossBookingProfit = hqSampleAmount('300.00', 'calculated');
  second.financials.grossBookingMargin.fraction = '0.15';
  second.financials.orbitCommissionBaseline = commission('orbit_vat_pts_estimate', '160.00', '40.00');
  second.products[0] = { ...second.products[0], id: '9003002', grossValue: hqSampleAmount('2000.00'), netCost: hqSampleAmount('1700.00') };
  const unmatched = createHqSampleBooking({ id: '9000003', bookingRef: 'SAMPLE-ONLY-UNMATCHED', originalSellingAgent: hqSampleIdentity(null), passengerCount: null });
  unmatched.currentOwningBusiness = { ...unmatched.currentOwningBusiness, orbitTenantId: '9001002', name: 'SAMPLE Unmatched Real Business', portalBusinessId: null, mappingStatus: 'unmatched', mappingRevision: null, mappingSource: null };
  unmatched.financials.grossBookingValue = hqSampleAmount('750.00');
  unmatched.financials.supplierNetCost = hqSampleAmount(null);
  unmatched.financials.knownSupplierNetSubtotal = hqSampleAmount('300.00');
  unmatched.financials.grossBookingProfit = hqSampleAmount(null);
  unmatched.financials.grossBookingMargin = { fraction: null, state: 'missing', denominator: 'Missing complete cost' };
  unmatched.financials.completeGrossAndCost = false;
  unmatched.financials.orbitCommissionBaseline = commission('orbit_vat_pts_estimate', null, null);
  unmatched.products = [];
  const undated = copy(unmatched);
  undated.id = '9000004'; undated.bookingRef = 'SAMPLE-ONLY-UNDATED';
  undated.currentOwningBusiness = copy(main.currentOwningBusiness);
  undated.dates = { ...undated.dates, portalRegisteredAt: null, bookedOnRaw: null, bookedOn: null, managementReportingDate: null, dateSource: 'none', warnings: ['UNDATED_EXCEPTION'] };
  undated.eligibility = { ...undated.eligibility, dated: false, headlineCount: false, headlineGrossSales: false, reason: 'UNDATED_EXCEPTION' };
  undated.financials.grossBookingValue = hqSampleAmount('450.00');
  const pending = createHqSampleBooking({ id: '9000005', bookingRef: 'SAMPLE-ONLY-PENDING', status: 'pending' });
  pending.eligibility = { ...pending.eligibility, headlineCount: null, headlineGrossSales: null, pendingCohort: true, reason: 'PENDING_APPROVAL_OUTSTANDING' };
  pending.financials.grossBookingValue = hqSampleAmount('900.00');
  pending.products = [];
  const demo = createHqSampleBooking({ id: '9000006', bookingRef: 'SAMPLE-ONLY-DEMO' });
  demo.currentOwningBusiness.accountType = 'demo'; demo.currentOwningBusiness.name = 'SAMPLE Demo Excluded';
  return [main, second, unmatched, undated, pending, demo];
}
export function createHqSampleAmendment(): HqBooking {
  const b = createHqSampleBooking({ revision: '2', contentHash: 'SAMPLE-untrusted-hash-002', sourceUpdatedAt: '2026-04-20T10:00:00Z', sourceObservedAt: '2026-04-20T11:00:00Z' });
  b.financials.grossBookingValue = hqSampleAmount('6000.00');
  b.financials.supplierNetCost = hqSampleAmount('5400.00');
  b.financials.knownSupplierNetSubtotal = hqSampleAmount('5400.00');
  b.financials.grossBookingProfit = hqSampleAmount('600.00', 'calculated');
  b.financials.orbitCommissionBaseline = commission('orbit_vat_pts_estimate', '400.00', '100.00');
  b.products[0].grossValue = hqSampleAmount('6000.00'); b.products[0].netCost = hqSampleAmount('5400.00');
  b.originalSellingAgent = hqSampleIdentity('JLT-0001', HQ_SAMPLE_NAMESPACES.uniqueAgentId);
  return b;
}
export function createHqSampleCancellation(): HqBooking {
  const b = createHqSampleAmendment();
  b.revision = '3'; b.contentHash = 'SAMPLE-untrusted-hash-003'; b.status = 'cancelled';
  b.sourceUpdatedAt = '2026-05-20T10:00:00Z'; b.sourceObservedAt = '2026-05-20T11:00:00Z';
  b.eligibility = { ...b.eligibility, headlineCount: false, headlineGrossSales: false, cancelledCohort: true, reason: 'CANCELLED_EXCLUDED_HEADLINES' };
  b.products[0].rawBookingStatus = 'cancelled'; b.products[0].financialActive = false;
  return b;
}
export function createHqSampleChange(booking: HqBooking, position = `opaque-change-${booking.revision}`): HqChange {
  return { position, entityType: 'booking', id: booking.id, revision: booking.revision, operation: 'upsert', reason: 'current_state_changed', observedAt: booking.sourceObservedAt, publishedAt: null, booking: copy(booking), mapping: null, quote: null };
}
/** Synthetic aliases use ONLY existing user-ID/uniqueAgentID fields; no profiles are created. */
export function createHqSampleDirectory(options: { merge102Into101?: boolean } = {}): HqIdentityDirectory {
  const people = {
    101: { userId: 101, uniqueAgentId: 'JLT-0001', name: 'SAMPLE Agent One', role: 'agent' },
    102: { userId: 102, uniqueAgentId: 'JLT-0002', name: 'SAMPLE Agent Two', role: 'agent' },
    47: { userId: 47, uniqueAgentId: null, name: 'SAMPLE Admin', role: 'admin' },
  };
  return { async resolve(e) {
    if (e.state !== 'verified') return null;
    let id = e.namespace === HQ_SAMPLE_NAMESPACES.userId && /^(101|102|47)$/.test(e.id ?? '') ? Number(e.id) : e.namespace === HQ_SAMPLE_NAMESPACES.uniqueAgentId ? e.id === 'JLT-0001' ? 101 : e.id === 'JLT-0002' ? 102 : null : null;
    if (id === 102 && options.merge102Into101) id = 101; // Explicit synthetic historical merge, never login authority.
    return id === 101 || id === 102 || id === 47 ? copy(people[id]) : null;
  } };
}
/** Memory reader; engine validates every page with the full proposed AJV schemas. */
export function createHqSampleReader(stage: 'initial' | 'amended' | 'cancelled'): HqReader {
  const all = createHqSampleRecords();
  const replacement = stage === 'amended' ? createHqSampleAmendment() : createHqSampleCancellation();
  const generation = createHqSampleEnvelope(stage, 'changes');
  return {
    async bookings(cursor) {
      if (cursor !== undefined && cursor !== 'opaque-SAMPLE-page-two') throw Object.assign(new Error('SAMPLE expired cursor'), { code: 'CURSOR_EXPIRED' });
      const page: HqBookingPage = { ...createHqSampleEnvelope(), records: copy(cursor ? all.slice(3) : all.slice(0, 3)), nextCursor: cursor ? null : 'opaque-SAMPLE-page-two', hasMore: !cursor };
      return page;
    },
    async changes(after, cursor) {
      const expected = createHqSampleEnvelope(stage === 'cancelled' ? 'amended' : 'initial').watermark;
      if (after !== expected || cursor !== undefined) throw Object.assign(new Error('SAMPLE invalid checkpoint'), { code: 'INVALID_QUERY' });
      const page: HqChangePage = { ...generation, upperWatermark: generation.watermark, records: stage === 'initial' ? [] : [createHqSampleChange(replacement)] };
      return copy(page);
    },
  };
}
/** Replay from scratch through the identical engine. Optional store gets ONE final CAS.
 * Replays are demonstrations, not instructions to rewind a live checkpoint.
 */
export async function runHqSampleScenario(scenario: 'initial' | 'amended' | 'cancelled', providedStore?: HqStore): Promise<HqState> {
  if (!['initial', 'amended', 'cancelled'].includes(scenario)) throw new Error('Unknown HQ sample scenario');
  const externalBase = providedStore ? await providedStore.read() : null;
  if (externalBase && externalBase.scopeId !== HQ_SAMPLE_SCOPE) throw new Error('Sample store scope mismatch');
  const store = createHqMemoryStore();
  const run = async (mode: 'backfill' | 'catchup', stage: 'initial' | 'amended' | 'cancelled', after?: string) => {
    const engine = createHqEngine(createHqSampleReader(stage), store, { scopeId: HQ_SAMPLE_SCOPE });
    const result = mode === 'backfill' ? await engine.backfill() : await engine.catchup(after!);
    if (result.status !== 'applied') throw new Error(`Sample generation unavailable: ${result.code}`);
    return result.state;
  };
  let state = await run('backfill', 'initial');
  if (scenario !== 'initial') state = await run('catchup', 'amended', state.watermark);
  if (scenario === 'cancelled') state = await run('catchup', 'cancelled', state.watermark);
  if (providedStore) {
    state = { ...state, version: (externalBase?.version ?? 0) + 1 };
    if (!Number.isSafeInteger(state.version) || !await providedStore.compareAndSwap(externalBase?.version ?? null, state)) throw new Error('Sample CAS conflict');
  }
  return state;
}
