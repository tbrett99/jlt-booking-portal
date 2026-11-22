import { describe, expect, it, vi } from 'vitest';
import type { HqBooking, HqBookingPage, HqChange, HqChangePage, HqReader } from '../shared/management-hq-types';
import { canonicalHqJson, createHqEngine, createHqMemoryStore, exportHqReportCsv, getHqReport, hqCsvCell, hqDecimal, hqPennies, type HqState, type HqStore } from './management-hq-engine';
import { createHqSampleAmendment, createHqSampleBooking, createHqSampleCancellation, createHqSampleChange, createHqSampleDirectory, createHqSampleEnvelope, createHqSampleReader, HQ_SAMPLE_SCOPE, hqSampleAmount, hqSampleIdentity, runHqSampleScenario } from './management-hq-fixtures';
import { validateHqBookingPage, validateHqChangePage } from './management-hq-contract';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bp = (records: HqBooking[] = [createHqSampleBooking()], overrides: Partial<HqBookingPage> = {}): HqBookingPage => ({ ...createHqSampleEnvelope(), records, ...overrides });
const cp = (records: HqChange[] = [createHqSampleChange(createHqSampleAmendment())], overrides: Partial<HqChangePage> = {}): HqChangePage => ({ ...createHqSampleEnvelope('amended', 'changes'), upperWatermark: 'opaque-SAMPLE-amended-watermark', records, ...overrides });
function reader(bookings: HqBookingPage[] = [bp()], changes: HqChangePage[] = [cp()]): HqReader {
  let bi = 0, ci = 0;
  return { async bookings() { return copy(bookings[bi++] ?? bookings[bookings.length - 1]); }, async changes() { return copy(changes[ci++] ?? changes[changes.length - 1]); } };
}
async function seed(page = bp()) { const store = createHqMemoryStore(); const r = await createHqEngine(reader([page]), store, { scopeId: HQ_SAMPLE_SCOPE }).backfill(); expect(r.status).toBe('applied'); return store; }
async function reportBooking(booking: HqBooking) { const store = await seed(bp([booking])); return getHqReport((await store.read())!, createHqSampleDirectory(), { year: 2026 }); }
function tombstone(id = '9000001', revision = '2'): HqChange { return { position: 'opaque-tombstone', entityType: 'booking', id, revision, operation: 'tombstone', reason: 'source_deleted', observedAt: null, publishedAt: null, booking: null, mapping: null, quote: null }; }

describe('isolated HQ sealed generation ingestion', () => {
  it('validates complete synthetic payloads through full AJV schemas', async () => {
    const r = createHqSampleReader('amended');
    expect(validateHqBookingPage(await r.bookings()).records).toHaveLength(3);
    expect(validateHqChangePage(await r.changes(createHqSampleEnvelope().watermark)).records).toHaveLength(1);
  });
  it('publishes only after every page, and replays same generation idempotently', async () => {
    const store = createHqMemoryStore();
    const engine = createHqEngine(createHqSampleReader('initial'), store, { scopeId: HQ_SAMPLE_SCOPE });
    const first = await engine.backfill(); const second = await engine.backfill();
    expect(first.status).toBe('applied'); expect(second.status).toBe('applied');
    if (second.status === 'applied') { expect(second.unchanged).toBe(true); expect(second.state.version).toBe(1); expect(Object.keys(second.state.records)).toHaveLength(6); }
    expect(JSON.parse(JSON.stringify(await store.read()))).toEqual(await store.read());
  });
  it('keeps old complete view on second-page failure, without deletion or watermark advance', async () => {
    const store = await seed(); const before = await store.read();
    const r: HqReader = { async bookings(cursor) { if (cursor) throw new Error('secret failure'); return bp([createHqSampleAmendment()], { ...createHqSampleEnvelope('amended'), hasMore: true, nextCursor: 'next' }); }, async changes() { throw new Error(); } };
    const result = await createHqEngine(r, store, { scopeId: HQ_SAMPLE_SCOPE }).backfill();
    expect(result).toMatchObject({ status: 'unavailable', code: 'SOURCE_OR_STORE_UNAVAILABLE' });
    expect(await store.read()).toEqual(before);
  });
  it('staging is invisible until atomic CAS', async () => {
    const store = await seed(); const before = await store.read();
    const r: HqReader = { async bookings(cursor) { expect(await store.read()).toEqual(before); return bp(cursor ? [] : [createHqSampleAmendment()], { ...createHqSampleEnvelope('amended'), hasMore: !cursor, nextCursor: cursor ? null : 'next' }); }, async changes() { throw new Error(); } };
    expect((await createHqEngine(r, store, { scopeId: HQ_SAMPLE_SCOPE }).backfill()).status).toBe('applied');
    expect((await store.read())?.records['9000001'].revision).toBe('2');
  });
  it.each(['SNAPSHOT_EXPIRED', 'CURSOR_EXPIRED', 'RESTART_REQUIRED'])('returns explicit restart-unavailable for %s', async code => {
    const store = await seed(); const before = await store.read();
    const r: HqReader = { async bookings() { throw Object.assign(new Error('do not expose remote text'), { code }); }, async changes() { throw new Error(); } };
    expect(await createHqEngine(r, store, { scopeId: HQ_SAMPLE_SCOPE }).backfill()).toMatchObject({ status: 'unavailable', code: 'SOURCE_EXPIRED' });
    expect(await store.read()).toEqual(before);
  });
  it('refuses independently supplied continuation without a staged generation', async () => {
    const r = createHqSampleReader('initial'); const spy = vi.spyOn(r, 'bookings');
    expect(await createHqEngine(r, createHqMemoryStore(), { scopeId: HQ_SAMPLE_SCOPE }).backfill('some-cursor')).toMatchObject({ status: 'unavailable', code: 'CURSOR_REQUIRES_STAGED_GENERATION' }); expect(spy).not.toHaveBeenCalled();
  });
  it('rejects wildcard and foreign source/store scopes', async () => {
    expect(() => createHqEngine(reader(), createHqMemoryStore(), { scopeId: '*' })).toThrow();
    expect(await createHqEngine(reader([bp([], { scopeId: 'foreign' })]), createHqMemoryStore(), { scopeId: HQ_SAMPLE_SCOPE }).backfill()).toMatchObject({ code: 'SOURCE_SCOPE_MISMATCH' });
    const store = await seed(); expect(await createHqEngine(reader(), store, { scopeId: 'foreign' }).backfill()).toMatchObject({ code: 'STATE_SCOPE_MISMATCH' });
  });
  it.each(['snapshotId', 'watermark', 'dateRuleVersion', 'statusRuleVersion', 'financialPolicyVersion', 'projectionPublishedAt', 'sourceObservationStartedAt', 'sourceObservationCompletedAt'])('pins envelope %s across pages', async key => {
    const a = bp([], { hasMore: true, nextCursor: 'next' }); const b = bp([]);
    (b as any)[key] = key.endsWith('At') ? '2026-01-30T10:00:00Z' : 'drift';
    const store = createHqMemoryStore();
    expect(await createHqEngine(reader([a, b]), store, { scopeId: HQ_SAMPLE_SCOPE }).backfill()).toMatchObject({ status: 'unavailable', code: 'GENERATION_METADATA_DRIFT' }); expect(await store.read()).toBeNull();
  });
  it('pins nested coverage metadata too', async () => {
    const a = bp([], { hasMore: true, nextCursor: 'next' }); const b = bp([]); b.coverage.limitations.push('drift');
    expect(await createHqEngine(reader([a, b]), createHqMemoryStore(), { scopeId: HQ_SAMPLE_SCOPE }).backfill()).toMatchObject({ code: 'GENERATION_METADATA_DRIFT' });
  });
  it('rejects null completed observation/publication and incomplete child reads', async () => {
    for (const page of [bp([], { sourceObservationCompletedAt: null }), bp([], { projectionPublishedAt: null }), bp([createHqSampleBooking({ childMembershipComplete: false })])]) {
      const store = createHqMemoryStore(); expect((await createHqEngine(reader([page]), store, { scopeId: HQ_SAMPLE_SCOPE }).backfill()).status).toBe('unavailable'); expect(await store.read()).toBeNull();
    }
  });
  it('detects cursor loops, page caps, record caps, state caps without partial publication', async () => {
    const looping = bp([], { hasMore: true, nextCursor: 'loop' });
    expect(await createHqEngine(reader([looping]), createHqMemoryStore(), { scopeId: HQ_SAMPLE_SCOPE }).backfill()).toMatchObject({ code: 'CURSOR_LOOP' });
    expect(await createHqEngine(reader([looping, bp([])]), createHqMemoryStore(), { scopeId: HQ_SAMPLE_SCOPE, maxPages: 1 }).backfill()).toMatchObject({ code: 'PAGE_CAP_EXCEEDED' });
    const two = bp([createHqSampleBooking(), createHqSampleBooking({ id: '2' })]);
    expect(await createHqEngine(reader([two]), createHqMemoryStore(), { scopeId: HQ_SAMPLE_SCOPE, maxRecords: 1 }).backfill()).toMatchObject({ code: 'RECORD_CAP_EXCEEDED' });
    expect(await createHqEngine(reader(), createHqMemoryStore(), { scopeId: HQ_SAMPLE_SCOPE, maxStateBytes: 1 }).backfill()).toMatchObject({ code: 'STATE_BYTE_CAP_EXCEEDED' });
  });
  it('does not trust hashes at equal revision; full canonical payload must match', async () => {
    const store = await seed(); const b = createHqSampleBooking(); b.bookingRef = 'changed same hash';
    expect(await createHqEngine(reader([bp([b])]), store, { scopeId: HQ_SAMPLE_SCOPE }).backfill()).toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await store.read())!.records[b.id].booking!.bookingRef).toBe('SAMPLE-ONLY-001');
  });
  it('canonical equality is insensitive to property order but not array contents', () => {
    expect(canonicalHqJson({ z: [1, 2], a: { b: 1, a: 2 } })).toBe(canonicalHqJson({ a: { a: 2, b: 1 }, z: [1, 2] }));
    expect(canonicalHqJson([1, 2])).not.toBe(canonicalHqJson([2, 1]));
  });
  it('allows exact cross-page retryduplicates and rejects conflicting duplicate rows', async () => {
    const b = createHqSampleBooking(); const a = bp([b], { nextCursor: 'next', hasMore: true });
    const store = createHqMemoryStore(); expect((await createHqEngine(reader([a, bp([b])]), store, { scopeId: HQ_SAMPLE_SCOPE }).backfill()).status).toBe('applied');
    expect(Object.keys((await store.read())!.records)).toHaveLength(1);
    const conflict = copy(b); conflict.passengerCount = 4;
    expect(await createHqEngine(reader([a, bp([conflict])]), createHqMemoryStore(), { scopeId: HQ_SAMPLE_SCOPE }).backfill()).toMatchObject({ code: 'REVISION_CONFLICT' });
  });
  it('compares arbitrary large revisions with bigint; timestamps have no order authority', async () => {
    const old = createHqSampleBooking({ revision: '90071992547409920000000000000000000000', sourceUpdatedAt: '2026-12-01T00:00:00Z' }); const store = await seed(bp([old]));
    const next = createHqSampleAmendment(); next.revision = '90071992547409920000000000000000000001'; next.sourceUpdatedAt = '2025-01-01T00:00:00Z';
    expect((await createHqEngine(reader([], [cp([createHqSampleChange(next)])]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup((await store.read())!.watermark)).status).toBe('applied');
    expect((await store.read())!.records[next.id].booking!.sourceUpdatedAt).toBe('2025-01-01T00:00:00Z');
    expect(await createHqEngine(reader([bp([old])]), store, { scopeId: HQ_SAMPLE_SCOPE }).backfill()).toMatchObject({ code: 'STALE_REVISION' });
  });
  it('never lexically or numerically orders opaque watermarks and enforces checkpoint equality', async () => {
    const store = await seed(bp(undefined, { watermark: 'zzz-99' }));
    expect((await createHqEngine(reader([], [cp([], { watermark: 'aaa-1', upperWatermark: 'opaque-0' })]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup('zzz-99')).status).toBe('applied');
    expect((await store.read())!.watermark).toBe('opaque-0');
    expect(await createHqEngine(reader(), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup('zzz-99')).toMatchObject({ code: 'CHECKPOINT_MISMATCH' });
  });
  it('pins catchup upper watermark and publishes no partial changes on drift', async () => {
    const store = await seed(); const before = await store.read();
    const a = cp(undefined, { hasMore: true, nextCursor: 'next' }); const b = cp([], { upperWatermark: 'drift' });
    expect(await createHqEngine(reader([], [a, b]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup(before!.watermark)).toMatchObject({ code: 'UPPER_WATERMARK_DRIFT' }); expect(await store.read()).toEqual(before);
  });
  it('handles cross-page duplicate positions but rejects different payload at same position', async () => {
    const store = await seed(); const a = cp(undefined, { hasMore: true, nextCursor: 'next' }); const b = cp();
    expect((await createHqEngine(reader([], [a, b]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup((await store.read())!.watermark)).status).toBe('applied');
    const otherStore = await seed(); b.records[0].observedAt = '2026-04-19T00:00:00Z';
    expect(await createHqEngine(reader([], [a, b]), otherStore, { scopeId: HQ_SAMPLE_SCOPE }).catchup((await otherStore.read())!.watermark)).toMatchObject({ code: 'POSITION_CONFLICT' });
  });
  it('retains tombstones, excludes them from report and rejects stale resurrection', async () => {
    const store = await seed();
    expect((await createHqEngine(reader([], [cp([tombstone()])]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup((await store.read())!.watermark)).status).toBe('applied');
    const state = (await store.read())!; expect(state.records['9000001']).toMatchObject({ revision: '2', tombstone: true, booking: null });
    expect((await getHqReport(state, createHqSampleDirectory(), { year: 2026 })).totals.bookingCount).toBe(0);
    expect(await createHqEngine(reader([bp()]), store, { scopeId: HQ_SAMPLE_SCOPE }).backfill()).toMatchObject({ code: 'STALE_REVISION' });
    expect(await createHqEngine(reader([bp([createHqSampleAmendment()])]), store, { scopeId: HQ_SAMPLE_SCOPE }).backfill()).toMatchObject({ code: 'REVISION_CONFLICT' });
  });
  it('same tombstone replay is safe, same revision live-to-tombstone conflicts', async () => {
    const store = await seed(); const c = cp([tombstone()]);
    await createHqEngine(reader([], [c]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup((await store.read())!.watermark);
    expect((await createHqEngine(reader([], [c]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup((await store.read())!.watermark)).status).toBe('applied');
    const other = await seed(); expect(await createHqEngine(reader([], [cp([tombstone('9000001', '1')])]), other, { scopeId: HQ_SAMPLE_SCOPE }).catchup((await other.read())!.watermark)).toMatchObject({ code: 'REVISION_CONFLICT' });
  });
  it('absent only after full successful enumeration becomes retained tombstone, never deletion', async () => {
    const store = await seed(); await createHqEngine(reader([bp([], { ...createHqSampleEnvelope('amended') })]), store, { scopeId: HQ_SAMPLE_SCOPE }).backfill();
    expect((await store.read())!.records['9000001']).toMatchObject({ tombstone: true, booking: null, revision: '1', tombstoneReason: 'absent_from_complete_backfill' });
    await createHqEngine(reader([bp()]), store, { scopeId: HQ_SAMPLE_SCOPE }).backfill();
    expect((await store.read())!.records['9000001'].tombstone).toBe(false);
  });
  it.each(['business_mapping', 'quote'] as const)('explicitly rejects %s events, never skips forward', async entityType => {
    const store = await seed(); const before = await store.read(); const c = { ...tombstone('9001001'), entityType };
    expect(await createHqEngine(reader([], [cp([c])]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup(before!.watermark)).toMatchObject({ code: `UNSUPPORTED_${entityType.toUpperCase()}_CHANGE` }); expect(await store.read()).toEqual(before);
  });
  it('mapping_changed booking events also fail closed rather than skip live mapping information', async () => {
    const store = await seed(); const before = await store.read(); const c = createHqSampleChange(createHqSampleAmendment()); c.reason = 'mapping_changed';
    expect(await createHqEngine(reader([], [cp([c])]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup(before!.watermark)).toMatchObject({ code: 'UNSUPPORTED_BUSINESS_MAPPING_CHANGE' }); expect(await store.read()).toEqual(before);
  });
  it('reporting-rule change requires safe full backfill, not a partial catchup restatement', async () => {
    const store = await seed(); const before = await store.read();
    expect(await createHqEngine(reader([], [cp([], { dateRuleVersion: 'new-date-rule' })]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup(before!.watermark)).toMatchObject({ code: 'RULE_CHANGE_REQUIRES_BACKFILL' }); expect(await store.read()).toEqual(before);
  });
  it('CAS conflict preserves concurrently published view, does not retry stale staging', async () => {
    const before = await runHqSampleScenario('initial'); const backing = createHqMemoryStore(before);
    const store: HqStore = { read: backing.read, async compareAndSwap(expected, next) { await backing.compareAndSwap(expected, { ...before, version: before.version + 1, watermark: 'concurrent' }); return false; } };
    expect(await createHqEngine(reader([], [cp()]), store, { scopeId: HQ_SAMPLE_SCOPE }).catchup(before.watermark)).toMatchObject({ code: 'CAS_CONFLICT' }); expect((await backing.read())!.watermark).toBe('concurrent');
  });
  it('rejects malformed deep money/identity/status/date and wrong change ID via AJV and semantics', async () => {
    const b = createHqSampleBooking(); const cases: HqBooking[] = [];
    for (const mutation of [(x: HqBooking) => { x.financials.grossBookingValue.amount = '1.001'; }, (x: HqBooking) => { (x.originalSellingAgent as any).unexpected = true; }, (x: HqBooking) => { x.dates.managementReportingDate = '2026-02-30'; }, (x: HqBooking) => { x.eligibility.cancelledCohort = true; }]) { const x = copy(b); mutation(x); cases.push(x); }
    for (const x of cases) expect(() => validateHqBookingPage(bp([x]))).toThrow();
    const c = createHqSampleChange(createHqSampleAmendment()); c.id = '42'; expect(() => validateHqChangePage(cp([c]))).toThrow();
  });
});

describe('isolated HQ report semantics', () => {
  it('initial->April amendment->cancelled restates January, no April value, gross once not passengers', async () => {
    for (const [scenario, gross, count, cancelled] of [['initial', '7750.00', 3, 0], ['amended', '8750.00', 3, 0], ['cancelled', '2750.00', 2, 1]] as const) {
      const s = await runHqSampleScenario(scenario); const r = await getHqReport(s, createHqSampleDirectory(), { year: 2026 });
      expect(r.totals.grossSales.knownSum).toBe(gross); expect(r.totals.bookingCount).toBe(count); expect(r.monthly[0].totals.grossSales.knownSum).toBe(gross); expect(r.monthly[3].totals.grossSales.knownSum).toBeNull(); expect(r.cohorts.cancelledCount).toBe(cancelled); expect(r.bookings.find(b => b.id === '9000001')!.reportingDate).toBe('2026-01-10');
    }
  });
  it('all views share same month filter; April has no fabricated booking period', async () => {
    const s = await runHqSampleScenario('amended'); const r = await getHqReport(s, createHqSampleDirectory(), { year: 2026, month: 4 });
    expect(r.bookings).toHaveLength(0); expect(r.totals.bookingCount).toBe(0); expect(r.agents).toHaveLength(0); expect(r.monthly.every(m => m.totals.bookingCount === 0)).toBe(true); expect(r.undatedExceptions).toHaveLength(1);
  });
  it('keeps unmatched real business totals, excludes demos and retains undated/pending separately', async () => {
    const r = await getHqReport(await runHqSampleScenario('initial'), createHqSampleDirectory(), { year: 2026 });
    expect(r.cohorts).toMatchObject({ pendingCount: 1, undatedCount: 1, unmatchedBusinessCount: 1, excludedDemoCount: 1, unattributedCount: 1 });
    expect(r.bookings.find(b => b.id === '9000003')!.financials.gross).toBe('750.00'); expect(r.undatedExceptions[0].reportingDate).toBeNull(); expect(r.bookings.find(b => b.status === 'pending')!.cohort).toBe('pending');
  });
  it('weighted margin uses same fully covered gross; missing cost never zero', async () => {
    const r = await getHqReport(await runHqSampleScenario('initial'), createHqSampleDirectory(), { year: 2026 });
    expect(r.totals.grossProfit).toMatchObject({ knownSum: '800.00', coveredCount: 2, eligibleCount: 3, missingCount: 1 });
    expect(r.totals.supplierNetCost.knownSum).toBe('6200.00'); expect(r.totals.knownSupplierNetSubtotal.knownSum).toBe('6500.00');
    expect(r.totals.weightedMargin).toEqual({ fraction: '0.114286', coveredCount: 2, coveredGross: '7000.00', coveredProfit: '800.00' });
  });
  it('baseline/complete/actual/estimate/settlement are separated without independent finance computation', async () => {
    const r = await getHqReport(await runHqSampleScenario('initial'), createHqSampleDirectory(), { year: 2026 });
    expect(r.totals.baselineAgentCommission.knownSum).toBe('480.00'); expect(r.totals.completeAgentCommission.knownSum).toBeNull(); expect(r.totals.settledJltIncome.knownSum).toBeNull(); expect(r.totals.actualCardFees.knownSum).toBeNull(); expect(r.totals.estimatedCardFees).toMatchObject({ knownSum: '45.00', estimatedCount: 3 }); expect(r.liveReady).toBe(false);
  });
  it('incomplete baseline estimates and unverified defaults remain labelled source passthrough', async () => {
    const r = await getHqReport(await runHqSampleScenario('initial'), createHqSampleDirectory(), { year: 2026 });
    expect(r.totals.baselineAgentCommission).toMatchObject({ knownSum: '480.00', coveredCount: 2, missingCount: 1, estimatedCount: 2 });
    expect(r.bookings[0].financials.baseline).toMatchObject({ complete: false, netDistributableCommission: '400.00', agentCommission: '320.00', terms: { state: 'stated_default_unverified' }, cardProcessingFeesIncluded: false });
    expect(r.bookings[0].financials.policy.netDistributableCommission).toBeNull(); expect(r.bookings[0].financials.policyComplete).toBe(false);
  });
  it('drilldown carries source deduction/margin/basis/rounding/warning states, not a new commission calculation', async () => {
    const b = createHqSampleBooking();
    b.financials.otherDeductions = [{ code: 'SAMPLE_DEDUCTION', amount: hqSampleAmount('2.00', 'estimated'), applicability: 'applicable', alreadyIncludedElsewhere: true, policySource: 'SAMPLE-ONLY policy' }];
    const r = await reportBooking(b); const f = r.bookings[0].financials;
    expect(f.otherDeductions).toEqual([{ code: 'SAMPLE_DEDUCTION', amount: '2.00', currency: 'GBP', state: 'estimated', applicability: 'applicable', alreadyIncludedElsewhere: true, policySource: 'SAMPLE-ONLY policy' }]);
    expect(f.grossMargin.fraction).toBe('0.1'); expect(f.ptsFeeBasis).toContain('SAMPLE-ONLY'); expect(f.baseline.roundingBasis).toContain('passthrough'); expect(f.amountStates.actualCardProcessingFees).toMatchObject({ state: 'missing', currency: 'GBP' }); expect(f.baseline.agentCommission).toBe('320.00');
  });
  it('oversized finance annotations are unavailable rather than truncated', async () => {
    const s = await runHqSampleScenario('initial'); s.records['9000001'].booking!.financials.ptsAssumptions = ['x'.repeat(513)];
    expect(await getHqReport(s, createHqSampleDirectory(), { year: 2026 })).toMatchObject({ status: 'unavailable', unavailableReason: 'REPORT_FIELD_CAP_EXCEEDED', exportComplete: false });
  });
  it('verified original sellers attributed individually, admin processor never seller fallback', async () => {
    const r = await getHqReport(await runHqSampleScenario('initial'), createHqSampleDirectory(), { year: 2026 });
    expect(r.agents.map(a => a.agent.userId)).toEqual([101, 102]); expect(r.agents.map(a => a.totals.grossSales.knownSum)).toEqual(['5000.00', '2000.00']);
    expect(r.bookings[0].processor?.name).toBe('SAMPLE Admin'); expect(r.agents.some(a => a.agent.userId === 47)).toBe(false); expect(r.bookings.find(b => b.id === '9000003')!.seller).toBeNull();
  });
  it.each(['current_assignment', 'label_only', 'unverified', 'missing'] as const)('does not attribute %s original-selling evidence', async state => {
    const b = createHqSampleBooking(); b.originalSellingAgent.state = state;
    const r = await reportBooking(b); expect(r.agents).toHaveLength(0); expect(r.bookings[0].seller).toBeNull(); expect(r.totals.grossSales.knownSum).toBe('5000.00');
  });
  it('resolved staff/admin is not an agent owner; business mapping proves no ownership', async () => {
    const b = createHqSampleBooking(); b.originalSellingAgent = hqSampleIdentity('47');
    const r = await reportBooking(b); expect(r.agents).toHaveLength(0); expect(r.bookings[0].sellerReason).toBe('RESOLVED_MEMBER_NOT_AGENT');
    const store = await seed(); const staff = await getHqReport((await store.read())!, { async resolve() { return { userId: 101, uniqueAgentId: 'JLT-0001', name: 'SAMPLE Employee', role: 'staff' }; } }, { year: 2026 }); expect(staff.agents).toHaveLength(0);
  });
  it('unknown namespace is unresolved; canonical aliases and explicit historical merge handled by directory', async () => {
    const b = createHqSampleBooking(); b.originalSellingAgent.namespace = 'unapproved.other'; expect((await reportBooking(b)).agents).toHaveLength(0);
    const s = await runHqSampleScenario('amended');
    const r = await getHqReport(s, createHqSampleDirectory({ merge102Into101: true }), { year: 2026 }); expect(r.agents.map(a => a.agent.userId)).toEqual([101]); expect(r.agents[0].totals.grossSales.knownSum).toBe('8000.00');
  });
  it('currency-native values retained as exceptions and never summed with GBP', async () => {
    const b = createHqSampleBooking(); b.currency = 'EUR'; b.currencyBasis = 'verified_native';
    const replace = (x: any) => { if (!x || typeof x !== 'object') return; if ('amount' in x && 'evidenceIds' in x) x.currency = 'EUR'; else Object.values(x).forEach(replace); }; replace(b);
    const r = await reportBooking(b); expect(r.totals.bookingCount).toBe(1); expect(r.totals.grossSales).toMatchObject({ knownSum: null, coveredCount: 0, missingCount: 1 }); expect(r.cohorts.unsupportedCurrencyCount).toBe(1); expect(r.bookings[0].currency).toBe('EUR');
  });
  it('verified zero differs from missing; signed bigint pennies remain exact beyond float precision', async () => {
    expect(hqPennies('-0.01')).toBe(BigInt(-1)); expect(hqDecimal(BigInt(-101))).toBe('-1.01'); expect(hqDecimal(hqPennies('9007199254740993.01') + hqPennies('0.01'))).toBe('9007199254740993.02');
    const b = createHqSampleBooking(); b.financials.actualCardProcessingFees = hqSampleAmount('0.00', 'actual_recorded'); const r = await reportBooking(b); expect(r.totals.actualCardFees).toMatchObject({ knownSum: '0.00', coveredCount: 1 }); expect(r.totals.settledJltIncome.knownSum).toBeNull();
  });
  it('null N/A is not missing and is never fabricated zero; sourced N/A zero is known', async () => {
    const b = createHqSampleBooking();
    const na = await reportBooking(b); expect(na.totals.applicableVat).toMatchObject({ knownSum: null, coveredCount: 0, missingCount: 0, notApplicableCount: 1 });
    b.financials.applicableVat = hqSampleAmount('0.00', 'not_applicable');
    const zero = await reportBooking(b); expect(zero.totals.applicableVat).toMatchObject({ knownSum: '0.00', coveredCount: 1, missingCount: 0, notApplicableCount: 1 }); expect(zero.bookings[0].financials.applicableVat).toBe('0.00');
    b.financials.applicableVat = hqSampleAmount(null); const missing = await reportBooking(b); expect(missing.totals.applicableVat).toMatchObject({ knownSum: null, coveredCount: 0, missingCount: 1, notApplicableCount: 0 });
  });
  it('no settled cash implied by a source-recorded value without settlement evidence', async () => {
    const b = createHqSampleBooking(); b.financials.settledJltIncome = hqSampleAmount('80.00'); const r = await reportBooking(b); expect(r.totals.settledJltIncome.knownSum).toBeNull(); expect(r.bookings[0].financials.settledJltIncome).toBeNull();
  });
  it('date correction selects new cohort; timestamps alone never move reporting period', async () => {
    const b = createHqSampleAmendment(); b.dates.portalRegisteredAt = '2026-02-01T00:00:00Z'; b.dates.managementReportingDate = '2026-02-01';
    const r = await reportBooking(b); expect(r.monthly[0].totals.bookingCount).toBe(0); expect(r.monthly[1].totals.bookingCount).toBe(1);
  });
  it('London date selection is validated independently from UTC date', async () => {
    const b = createHqSampleBooking(); b.dates.portalRegisteredAt = '2026-04-01T23:30:00Z'; b.dates.managementReportingDate = '2026-04-02'; expect(() => validateHqBookingPage(bp([b]))).not.toThrow();
    b.dates.managementReportingDate = '2026-04-01'; expect(() => validateHqBookingPage(bp([b]))).toThrow();
  });
  it('directory failures/canonical role conflicts return unavailable with no partial report', async () => {
    const s = await runHqSampleScenario('initial'); const r = await getHqReport(s, { async resolve() { throw new Error('private'); } }, { year: 2026 }); expect(r).toMatchObject({ status: 'unavailable', unavailableReason: 'IDENTITY_DIRECTORY_UNAVAILABLE', exportComplete: false }); expect(r.bookings).toHaveLength(0);
  });
  it('report field and row caps are explicit unavailable, never silently truncated', async () => {
    const s = await runHqSampleScenario('initial'); s.records['9000001'].booking!.bookingRef = 'x'.repeat(513); expect(await getHqReport(s, createHqSampleDirectory(), { year: 2026 })).toMatchObject({ status: 'unavailable', unavailableReason: 'REPORT_FIELD_CAP_EXCEEDED', exportComplete: false });
    const huge = await runHqSampleScenario('initial'); const record = copy(huge.records['9000001']); huge.records = Object.fromEntries(Array.from({ length: 20001 }, (_, i) => [String(i), record])); expect(await getHqReport(huge, createHqSampleDirectory(), { year: 2026 })).toMatchObject({ unavailableReason: 'REPORT_ROW_CAP_EXCEEDED' });
  });
  it('DTO/CSV contain no provider IDs, includes all selected plus undated rows and protects formula text', async () => {
    const s = await runHqSampleScenario('initial'); const b = s.records['9000001'].booking!;
    b.bookingRef = '=SUM(A1:A2),"quoted"'; b.payments = [{ id: '9004001', method: 'card', paymentType: 'receipt', recordedReceipt: hqSampleAmount('1.00'), paidAt: null, createdAt: null, ppsLinkId: 'SECRET-PPS', providerTransactionId: 'SECRET-PROVIDER', matchState: 'unverified', feeEvidenceState: 'unmapped' }];
    const r = await getHqReport(s, createHqSampleDirectory(), { year: 2026 }); const csv = exportHqReportCsv(r); expect(JSON.stringify(r)).not.toMatch(/SECRET|providerTransactionId|ppsLinkId/); expect(csv).not.toMatch(/SECRET/); expect(csv.split('\r\n')).toHaveLength(r.bookings.length + r.undatedExceptions.length + 2); expect(csv).toContain('"\'=SUM(A1:A2),""quoted"""'); expect(hqCsvCell('\t@evil')).toBe('"\'\t@evil"'); expect(hqCsvCell('-1.00')).toBe('"\'-1.00"');
    expect(() => exportHqReportCsv({ ...r, exportComplete: false })).toThrow();
  });
  it('optional external sample store gets one final CAS and replay scenario can safely replace its own sample', async () => {
    const store = createHqMemoryStore(); const spy = vi.spyOn(store, 'compareAndSwap'); const first = await runHqSampleScenario('cancelled', store); expect(spy).toHaveBeenCalledTimes(1); expect(first.version).toBe(1);
    const second = await runHqSampleScenario('initial', store); expect(spy).toHaveBeenCalledTimes(2); expect(second.version).toBe(2); expect(second.records['9000001'].revision).toBe('1');
    const bad: HqStore = { async read() { return null; }, async compareAndSwap() { return false; } }; await expect(runHqSampleScenario('initial', bad)).rejects.toThrow('CAS conflict');
  });
  it('rejects invalid period and sample scopes', async () => {
    const s = await runHqSampleScenario('initial'); await expect(getHqReport(s, createHqSampleDirectory(), { year: 2026, month: 13 })).rejects.toThrow();
    const foreign: HqState = { ...s, scopeId: 'foreign' }; await expect(runHqSampleScenario('initial', createHqMemoryStore(foreign))).rejects.toThrow('scope mismatch');
  });
});
