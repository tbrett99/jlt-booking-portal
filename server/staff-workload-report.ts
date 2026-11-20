import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import { amendmentStage } from "../shared/amendment-list";
import { staffWorkLondonDate, validateStaffWorkRange } from "../shared/staff-workload-periods";
import { STAFF_WORK_DOMAINS, STAFF_WORK_METRICS, type StaffWorkDomain, type StaffWorkMetric, type StaffWorkRange, type StaffWorkloadReport, type StaffWorkloadDrillInput, type StaffWorkloadDetails, type StaffWorkloadDetail } from "../shared/staff-workload";

export const STAFF_WORK_SOURCE_LIMIT = 25_000;
export const STAFF_WORK_HISTORY_LIMIT = 100_000;
const BATCH = 1_000;
export type WorkDate = Date | string | null | undefined;
export interface WorkRequest {
  id: number; bookingId: number | null; createdAt: WorkDate; status: string;
  pipelineStage?: string | null; isReimbursementDoc?: boolean; assignedToId?: number | null;
  actionedAt?: WorkDate; actionedById?: number | null; rejectedAt?: WorkDate; rejectedById?: number | null;
  requestType?: string | null; ticketingDeadline?: WorkDate; cancellationTicketingDeadline?: WorkDate;
  scheduledAt?: WorkDate; paidAt?: WorkDate; paidById?: number | null; nextFollowUpAt?: WorkDate;
  departureDate?: WorkDate;
}
export interface WorkHistory {
  id: number; requestId: number; bookingId: number | null; eventType: string;
  beforeStatus?: string | null; afterStatus?: string | null; actorId?: number | null;
  actorRole?: string | null; actorName?: string | null; occurredAt: WorkDate;
  recordedAt?: WorkDate; receivedAt?: WorkDate; eventKey?: string; requestType?: string | null;
  sourceEventId?: number | null; component?: string | null;
  beforeAssigneeId?: number | null; afterAssigneeId?: number | null;
  beforeInvoiceAdded?: boolean | number | null; afterInvoiceAdded?: boolean | number | null;
}
export interface WorkDomainData { current: WorkRequest[]; ledger: WorkHistory[]; legacy: WorkHistory[] }
export interface StaffWorkData {
  domains: Record<StaffWorkDomain, WorkDomainData>;
  people: { id: number; name: string | null }[];
  historyTrackingReady: boolean;
}
interface Action extends WorkHistory {
  at: Date; actorId: number | null; evidence: "recorded_history" | "legacy_record";
  completion: boolean; paid: boolean; rejected: boolean; touched: boolean;
}
interface Entity {
  id: number; domain: StaffWorkDomain; bookingId: number | null; current?: WorkRequest;
  receivedAt: Date | null; actions: Action[]; status: string; requestType?: string | null;
}
interface Selection { entity: Entity; action: Action | null }
export type StaffWorkAnalysis = ReturnType<typeof buildStaffWorkAnalysis>;
function date(value: WorkDate): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}
const staffRoles = new Set(["admin", "super_admin"]);
const completionStatus = (domain: StaffWorkDomain, value?: string | null) => domain === "amendment" ? value === "Actioned" || value === "actioned" : value === (domain === "flight" ? "completed" : "scheduled");
const legacyFlightStaff = new Set(["completed", "ticketed", "cancelled", "queried", "price_increase_notified", "reopened", "status_updated", "cancellation_completed", "cancellation_reopened", "deleted", "invoice_marked_added", "invoice_marked_not_added"]);
const legacyReimbursementStaff = new Set(["status_changed", "agent_chased", "assigned", "unassigned", "deleted", "note_added", "admin_note_added"]);
const ledgerStaff = new Set(["status_changed", "reopened", "assigned", "deleted", "queried", "price_notified", "invoice_updated", "baseline_completed"]);
const isDoc = (value?: string | null) => !!value && /reimbursement.*doc|doc.*reimbursement|document_task/.test(value.toLowerCase());
function normalize(domain: StaffWorkDomain, row: WorkHistory, ledger: boolean, asOf: Date): Action | null {
  const at = date(row.occurredAt);
  if (!at || at > asOf || (date(row.recordedAt) && date(row.recordedAt)! > asOf)) return null;
  const transition = row.beforeStatus !== row.afterStatus;
  const statusEvent = ledger ? ["status_changed", "reopened", "queried", "price_notified", "baseline_completed"].includes(row.eventType) : domain === "flight" ? legacyFlightStaff.has(row.eventType) && !row.eventType.startsWith("invoice_") && row.eventType !== "deleted" : row.eventType === "status_changed" || row.eventType === "agent_chased";
  const component = row.component === "cancellation" || row.eventType.startsWith("cancellation_");
  const completion = !component && statusEvent && (transition || row.eventType === "baseline_completed") && completionStatus(domain, row.afterStatus) && !completionStatus(domain, row.beforeStatus);
  const paid = domain === "reimbursement" && statusEvent && transition && row.afterStatus === "paid";
  const rejected = domain === "amendment" && statusEvent && transition && row.afterStatus === "rejected";
  let touched = ledger ? ledgerStaff.has(row.eventType) && (row.actorRole == null || staffRoles.has(row.actorRole)) : (domain === "flight" ? legacyFlightStaff : legacyReimbursementStaff).has(row.eventType);
  // No-op status saves are not work; a recorded message/chase can be work without a status change.
  const communication = ["queried", "agent_chased", "price_notified", "price_increase_notified"].includes(row.eventType);
  if (statusEvent && !transition && row.eventType !== "baseline_completed" && !communication) touched = false;
  if (ledger && row.eventType === "assigned" && row.beforeAssigneeId === row.afterAssigneeId) touched = false;
  if (ledger && row.eventType === "invoice_updated" && row.beforeInvoiceAdded === row.afterInvoiceAdded) touched = false;
  // Explicitly recorded agent actions must never masquerade as staff processing.
  const actorId = row.actorRole != null && !staffRoles.has(row.actorRole) ? null : row.actorId ?? null;
  return { ...row, at, actorId, evidence: row.eventType === "baseline_completed" ? "legacy_record" : "recorded_history", completion, paid, rejected, touched };
}
function retainedAction(entity: Entity, at: Date, actorId: number | null, kind: "completion" | "paid" | "rejected"): Action {
  return { id: -1, requestId: entity.id, bookingId: entity.bookingId, eventType: `retained_${kind}`, occurredAt: at, at, actorId, evidence: "legacy_record", completion: kind === "completion", paid: kind === "paid", rejected: kind === "rejected", touched: true };
}
function exactTime(a: Date, b: Date) { return Math.floor(a.getTime() / 1_000) === Math.floor(b.getTime() / 1_000); }
function entitiesFor(domain: StaffWorkDomain, data: WorkDomainData, asOf: Date): Entity[] {
  const entities = new Map<number, Entity>();
  const docIds = new Set(data.current.filter(row => row.isReimbursementDoc).map(row => row.id));
  for (const row of data.ledger) if (isDoc(row.requestType)) docIds.add(row.requestId);
  const retainedMatches = new Set<string>();
  if (domain === "reimbursement") for (const row of [...data.legacy, ...data.ledger]) {
    const at = date(row.occurredAt);
    if (at && at <= asOf && (!date(row.recordedAt) || date(row.recordedAt)! <= asOf)) retainedMatches.add(`${row.requestId}:${row.afterStatus}:${Math.floor(at.getTime() / 1000)}`);
  }
  const get = (id: number, bookingId: number | null): Entity => {
    if (!entities.has(id)) entities.set(id, { id, domain, bookingId, receivedAt: null, actions: [], status: "deleted" });
    const entity = entities.get(id)!;
    if (entity.bookingId == null) entity.bookingId = bookingId;
    return entity;
  };
  for (const current of data.current) {
    if ((domain === "amendment" && docIds.has(current.id)) || (date(current.createdAt) && date(current.createdAt)! > asOf)) continue;
    const entity = get(current.id, current.bookingId);
    entity.current = current;
    entity.status = domain === "amendment" ? amendmentStage({ id: current.id, bookingId: current.bookingId ?? 0, status: current.status, pipelineStage: current.pipelineStage }) : current.status;
    entity.receivedAt = date(current.createdAt);
    entity.requestType = current.requestType;
  }
  const eventKeys = new Set<string>();
  const sourceIds = new Set<number>();
  for (const row of [...data.ledger].sort((a, b) => a.id - b.id)) {
    if (domain === "amendment" && docIds.has(row.requestId)) continue;
    if (row.eventKey && eventKeys.has(row.eventKey)) continue;
    const action = normalize(domain, row, true, asOf);
    if (!action) continue;
    if (row.eventKey) eventKeys.add(row.eventKey);
    if (row.sourceEventId != null) {
      if (sourceIds.has(row.sourceEventId)) continue;
      sourceIds.add(row.sourceEventId);
    }
    const entity = get(row.requestId, row.bookingId);
    entity.actions.push(action);
    if (!entity.current && !entity.receivedAt) entity.receivedAt = date(row.receivedAt) ?? (row.eventType === "created" ? action.at : null);
    if (!entity.requestType) entity.requestType = row.requestType;
  }
  const legacyIds = new Set<number>();
  for (const row of data.legacy) {
    if (sourceIds.has(row.id) || legacyIds.has(row.id)) continue;
    const action = normalize(domain, row, false, asOf);
    if (!action) continue;
    legacyIds.add(row.id);
    const entity = get(row.requestId, row.bookingId);
    entity.actions.push(action);
    if (!entity.current && !entity.receivedAt && ["submitted", "created"].includes(row.eventType)) entity.receivedAt = action.at;
  }
  for (const entity of Array.from(entities.values())) {
    const current = entity.current;
    if (!current) continue;
    const valid = (value: WorkDate) => { const d = date(value); return d && d <= asOf ? d : null; };
    if (domain === "amendment") {
      const at = valid(current.actionedAt);
      const ledgerActions = entity.actions.filter(a => a.id >= 0);
      const contradicted = at && ledgerActions.some(a => exactTime(a.at, at) && a.beforeStatus !== a.afterStatus && !completionStatus(domain, a.afterStatus));
      // Retained latest evidence survives a reopen; neither updatedAt nor current stage invents a date.
      if (at && !ledgerActions.some(a => a.completion) && !contradicted) entity.actions.push(retainedAction(entity, at, current.actionedById ?? null, "completion"));
      const rejectedAt = valid(current.rejectedAt);
      if (rejectedAt && !entity.actions.some(a => a.rejected && exactTime(a.at, rejectedAt))) entity.actions.push(retainedAction(entity, rejectedAt, current.rejectedById ?? null, "rejected"));
    }
    if (domain === "reimbursement") {
      const at = valid(current.scheduledAt);
      // Include no-op audits in this match: a repeated save must not create a fallback completion.
      const scheduleMatch = at && retainedMatches.has(`${entity.id}:scheduled:${Math.floor(at.getTime() / 1000)}`);
      if (at && !scheduleMatch) entity.actions.push(retainedAction(entity, at, null, "completion"));
      const paidAt = valid(current.paidAt);
      const paidMatch = paidAt && retainedMatches.has(`${entity.id}:paid:${Math.floor(paidAt.getTime() / 1000)}`);
      if (paidAt && !paidMatch) entity.actions.push(retainedAction(entity, paidAt, current.paidById ?? null, "paid"));
    }
  }
  for (const entity of Array.from(entities.values())) entity.actions.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);
  return Array.from(entities.values());
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/** Pure policy, shared by summary and drill-down. No providers, writes, or current-role filtering. */
export function buildStaffWorkAnalysis(data: StaffWorkData, range: StaffWorkRange, asOf = new Date()) {
  const period = validateStaffWorkRange(range, asOf);
  for (const domain of STAFF_WORK_DOMAINS) {
    if (data.domains[domain].current.length > STAFF_WORK_SOURCE_LIMIT || data.domains[domain].ledger.length > STAFF_WORK_HISTORY_LIMIT || data.domains[domain].legacy.length > STAFF_WORK_HISTORY_LIMIT) throw new Error("Staff workload exceeds the safe history limit. No partial totals are shown.");
  }
  const entities = STAFF_WORK_DOMAINS.flatMap(domain => entitiesFor(domain, data.domains[domain], asOf));
  const inPeriod = (at: Date) => at >= period.start && at < period.end && at <= asOf;
  const selected = new Map<string, Selection[]>();
  const add = (metric: StaffWorkMetric, entity: Entity, action: Action | null) => {
    const key = `${entity.domain}:${metric}`;
    if (!selected.has(key)) selected.set(key, []);
    selected.get(key)!.push({ entity, action });
  };
  const staffSelections = new Map<number | null, Map<string, Selection>>();
  const names = new Map(data.people.map(p => [p.id, p.name]));
  const nameOf = (id: number | null, snapshot?: string | null) => id == null ? "Unknown actor" : snapshot?.trim() || names.get(id)?.trim() || `Staff #${id} (name unavailable)`;
  for (const entity of entities) {
    if (entity.receivedAt && inPeriod(entity.receivedAt)) add("received", entity, null);
    const completions = entity.actions.filter(a => a.completion);
    const completed = completions.find(a => inPeriod(a.at));
    if (completed) add("completed", entity, completed);
    const repeat = completions.find((a, i) => i > 0 && inPeriod(a.at));
    if (repeat) add("reprocessed", entity, repeat);
    for (const metric of ["paid", "rejected", "touched"] as const) {
      const action = entity.actions.find(a => a[metric] && inPeriod(a.at));
      if (action) add(metric, entity, action);
    }
    for (const action of entity.actions.filter(a => a.touched && inPeriod(a.at))) {
      if (!staffSelections.has(action.actorId)) staffSelections.set(action.actorId, new Map());
      const own = staffSelections.get(action.actorId)!;
      const key = `${entity.domain}:${entity.id}`;
      if (!own.has(key)) own.set(key, { entity, action });
    }
    const outstanding = !!entity.current && (entity.domain === "amendment" ? !["Actioned", "rejected"].includes(entity.status) : entity.domain === "flight" ? entity.status !== "completed" : ["pending", "awaiting_agent"].includes(entity.status));
    if (outstanding) {
      add("outstanding", entity, null);
      if ((entity.domain === "flight" && ["query", "price_increase_pending"].includes(entity.status)) || (entity.domain === "reimbursement" && entity.status === "awaiting_agent")) add("waiting", entity, null);
    }
  }
  const list = (domain: StaffWorkDomain, metric: StaffWorkMetric) => selected.get(`${domain}:${metric}`) ?? [];
  const coverage = STAFF_WORK_DOMAINS.map(domain => {
    const items = entities.filter(e => e.domain === domain);
    const actions = items.flatMap(e => e.actions).filter(a => a.evidence === "recorded_history" || a.evidence === "legacy_record");
    const earliestTime = actions.reduce((min, action) => Math.min(min, action.at.getTime()), Infinity);
    const earliest = Number.isFinite(earliestTime) ? new Date(earliestTime).toISOString() : null;
    const unknownCompletionDate = items.filter(e => e.current && (domain === "amendment" ? e.status === "Actioned" : domain === "flight" ? e.status === "completed" : ["scheduled", "paid"].includes(e.status)) && !e.actions.some(a => a.completion)).length;
    const unknownCompletionActor = list(domain, "completed").filter(s => s.action?.actorId == null).length;
    const warnings = ["Completion history is first observed evidence, not proof of the first-ever completion. Reprocessed is a subset of completed, not additional work.", "Turnaround is elapsed time from recorded intake to first observed reliable completion, not staff work hours; missing intake/completion dates are excluded.", "Current queues are as of now, not historical opening or closing backlog."];
    if (domain === "amendment") warnings.push("Legacy amendment actionedAt/actionedById retain only the latest recorded action. Reimbursement document tasks are excluded; no updatedAt inference is used. Urgent means an outstanding amendment whose booking departs today through the next seven London calendar days, inclusive; missing booking/departure context cannot establish urgency.");
    if (domain === "flight") warnings.push("Flights count requests (including both), not tickets or travellers. Cancellation component and ticketed are not closure; current assignment is unavailable. Urgent means an outstanding request with a ticketing deadline overdue or within the next 24 elapsed hours (either component for both).");
    if (domain === "reimbursement") warnings.push("Intake is item createdAt (recorded incoming), not evidence-ready. Scheduled is operational completion; paid is a separate administrative record. Retained scheduledAt is unknown-actor latest evidence and may have been overwritten. Urgent means an outstanding pending/awaiting-agent item with follow-up strictly earlier than asOf.");
    const deleted = items.filter(e => !e.current).length;
    const missingIntake = items.filter(e => !e.receivedAt).length;
    if (deleted || missingIntake) warnings.push(`${deleted} deleted requests have retained history; ${missingIntake} requests lack recorded intake. Older deleted intake/work without retained history cannot be recovered.`);
    if (unknownCompletionDate) warnings.push(`${unknownCompletionDate} currently closed/paid requests have no reliable recorded operational completion date and are excluded from period completion totals.`);
    if (unknownCompletionActor) warnings.push(`${unknownCompletionActor} completed requests in this period have unknown processor attribution; they remain included.`);
    if (!data.historyTrackingReady) warnings.push("Append-only work history storage is unavailable. Read-only legacy fallback has incomplete coverage, especially amendments and deleted requests.");
    return { domain, earliestRecordedAction: earliest, unknownCompletionDate, unknownCompletionActor, warnings };
  });
  const summaries = STAFF_WORK_DOMAINS.map(domain => {
    const queue = list(domain, "outstanding");
    const ages = queue.flatMap(s => s.entity.receivedAt ? [(asOf.getTime() - s.entity.receivedAt.getTime()) / 86_400_000] : []);
    const durations = entities.filter(e => e.domain === domain).flatMap(entity => {
      const first = entity.actions.find(a => a.completion);
      return first && inPeriod(first.at) && entity.receivedAt && first.at >= entity.receivedAt ? [(first.at.getTime() - entity.receivedAt.getTime()) / 3_600_000] : [];
    });
    const counts = Object.fromEntries(STAFF_WORK_METRICS.map(metric => [metric, list(domain, metric).length])) as Record<StaffWorkMetric, number>;
    const unassigned = domain === "flight" ? null : queue.filter(s => s.entity.current?.assignedToId == null).length;
    const overdueFollowUps = domain === "reimbursement" ? queue.filter(s => { const followup = date(s.entity.current?.nextFollowUpAt); return followup && followup < asOf; }).length : 0;
    const today = staffWorkLondonDate(asOf);
    const todayCalendar = new Date(`${today}T00:00:00Z`).getTime();
    const urgent = domain === "flight" ? queue.filter(s => [date(s.entity.current?.ticketingDeadline), ...(s.entity.requestType === "both" ? [date(s.entity.current?.cancellationTicketingDeadline)] : [])].some(d => d && d.getTime() <= asOf.getTime() + 86_400_000)).length : domain === "amendment" ? queue.filter(s => {
      const departure = date(s.entity.current?.departureDate);
      if (!departure) return false;
      const dayOffset = (new Date(`${staffWorkLondonDate(departure)}T00:00:00Z`).getTime() - todayCalendar) / 86_400_000;
      return dayOffset >= 0 && dayOffset <= 7;
    }).length : overdueFollowUps;
    const oldestDays = ages.length ? Math.floor(ages.reduce((max, age) => Math.max(max, age), 0)) : null;
    return { domain, ...counts, unassigned, urgent, overdueFollowUps, oldestDays, medianTurnaroundHours: median(durations), turnaroundSampleCount: durations.length };
  });
  const daily = period.dates.map(day => ({ date: day, received: 0, completed: 0, reprocessed: 0 }));
  const days = new Map(daily.map(d => [d.date, d]));
  for (const domain of STAFF_WORK_DOMAINS) for (const metric of ["received", "completed", "reprocessed"] as const) for (const s of list(domain, metric)) {
    const at = s.action?.at ?? s.entity.receivedAt;
    if (at) days.get(staffWorkLondonDate(at))![metric]++;
  }
  const staffIds = new Set<number | null>(staffSelections.keys());
  for (const domain of STAFF_WORK_DOMAINS) for (const metric of ["completed", "reprocessed", "paid"] as const) for (const s of list(domain, metric)) staffIds.add(s.action!.actorId);
  const actorCounts = new Map<string, number>();
  for (const domain of STAFF_WORK_DOMAINS) for (const metric of ["completed", "reprocessed", "paid"] as const) for (const s of list(domain, metric)) {
    const key = `${s.action!.actorId}:${domain}:${metric}`;
    actorCounts.set(key, (actorCounts.get(key) ?? 0) + 1);
  }
  const snapshots = new Map<number | null, string>();
  for (const entity of entities) for (const action of entity.actions) if (action.actorName && !snapshots.has(action.actorId)) snapshots.set(action.actorId, action.actorName);
  const staff = Array.from(staffIds).map(actorId => {
    const count = (domain: StaffWorkDomain, metric: StaffWorkMetric) => actorCounts.get(`${actorId}:${domain}:${metric}`) ?? 0;
    const snapshot = snapshots.get(actorId);
    return { actorId, actorName: nameOf(actorId, snapshot), amendmentsCompleted: count("amendment", "completed"), flightsCompleted: count("flight", "completed"), reimbursementsProcessed: count("reimbursement", "completed"), reprocessed: STAFF_WORK_DOMAINS.reduce((n, d) => n + count(d, "reprocessed"), 0), touched: staffSelections.get(actorId)?.size ?? 0, recordedPaid: count("reimbursement", "paid") };
  }).sort((a, b) => a.actorId == null ? 1 : b.actorId == null ? -1 : a.actorName.localeCompare(b.actorName) || a.actorId - b.actorId);
  const warnings = ["Daily counts assign each distinct request once per selected-period metric (first matching action that period); daily sums equal summary totals.", "Staff touched is the distinct union of requests acted on by each recorded staff actor; multiple actors may touch the same request. No productivity ranking or score is inferred.", "Historical action/intake coverage can be incomplete; absence of recorded work is not proof that no work happened."];
  if (!data.historyTrackingReady) warnings.unshift("New work history table is missing; append-only tracking is not ready. Legacy evidence only, with visible coverage gaps.");
  const report: StaffWorkloadReport = { ...range, timezone: "Europe/London", asOf: asOf.toISOString(), summaries, daily, staff, coverage, historyTrackingReady: data.historyTrackingReady, warnings };
  return { report, entities, list, staffSelections, nameOf, inPeriod };
}

/** Distinct rows use exactly the summary policy; staff touched uses the per-actor distinct union. */
export function buildStaffWorkDetails(analysis: StaffWorkAnalysis, input: StaffWorkloadDrillInput, contexts: { id: number; clientName: string | null; reference: string | null }[] = []): StaffWorkloadDetails {
  const page = input.page ?? 1; const pageSize = input.pageSize ?? 25;
  if (!Number.isInteger(page) || page < 1 || page > 100_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Choose a valid report page (1–100000) and page size (1–100).");
  let selections = analysis.list(input.domain, input.metric);
  if (input.actorId !== undefined) {
    if (input.metric === "touched") selections = Array.from(analysis.staffSelections.get(input.actorId)?.values() ?? []).filter(s => s.entity.domain === input.domain);
    else selections = selections.filter(s => s.action ? s.action.actorId === input.actorId : input.metric === "received" ? input.actorId === null : input.domain !== "flight" && (s.entity.current?.assignedToId ?? null) === input.actorId);
  }
  const ordered = [...selections].sort((a, b) => (b.action?.at.getTime() ?? b.entity.receivedAt?.getTime() ?? 0) - (a.action?.at.getTime() ?? a.entity.receivedAt?.getTime() ?? 0) || a.entity.id - b.entity.id);
  const contextMap = new Map(contexts.map(c => [c.id, c]));
  const rows: StaffWorkloadDetail[] = ordered.slice((page - 1) * pageSize, page * pageSize).map(({ entity, action }) => {
    const context = entity.bookingId == null ? undefined : contextMap.get(entity.bookingId);
    const actorId = action?.actorId ?? (input.metric === "outstanding" || input.metric === "waiting" ? entity.current?.assignedToId ?? null : null);
    const label = action?.completion ? action.evidence === "legacy_record" ? "Retained latest completion (legacy timestamp)" : "Recorded completion" : action?.paid ? "Recorded paid" : action?.rejected ? "Recorded rejection" : action?.eventType ?? (input.metric === "received" ? "Recorded intake (not processor-attributed)" : "Current queue (assignee, not processor)");
    return { requestId: entity.id, bookingId: entity.bookingId, domain: entity.domain, title: `${entity.domain === "flight" ? "Flight request" : entity.domain === "amendment" ? "Amendment" : "Reimbursement item"} #${entity.id}${entity.domain === "flight" && entity.requestType ? ` (${entity.requestType})` : ""}`, clientName: context?.clientName ?? null, reference: context?.reference ?? null, receivedAt: entity.receivedAt?.toISOString() ?? null, actionAt: action?.at.toISOString() ?? null, actorId, actorName: analysis.nameOf(actorId, action?.actorName), currentStatus: entity.status, evidence: action?.evidence ?? "legacy_record", eventLabel: label, isDeleted: !entity.current };
  });
  const warnings = [...analysis.report.warnings, ...analysis.report.coverage.find(c => c.domain === input.domain)!.warnings];
  if (["outstanding", "waiting"].includes(input.metric)) warnings.push("Queue staff filters indicate current assignee, not historical processor; flight assignments are unavailable.");
  if (input.metric === "received") warnings.push("Intake has no staff processor attribution: actorId=null selects unknown intake attribution; named staff filters return no rows.");
  return { rows, total: selections.length, page, pageSize, asOf: analysis.report.asOf, warnings };
}

/** Strictly bounded keyset reads: reaching a hard limit checks one extra row and fails closed. */
export async function readStaffWorkBatches(db: any, table: any, projection: any, condition: any, limit: number): Promise<any[]> {
  const result: any[] = []; let last = 0;
  while (true) {
    const size = Math.min(BATCH, limit - result.length + 1);
    const rows = await db.select(projection).from(table).where(and(condition, gt(table.id, last))).orderBy(table.id).limit(size);
    if (rows.length > size || rows.some((row: any, i: number) => !Number.isSafeInteger(row.id) || row.id <= (i ? rows[i - 1].id : last))) throw new Error("Staff workload source order could not be verified. No partial totals are shown.");
    result.push(...rows);
    if (result.length > limit) throw new Error("Staff workload exceeds the safe history limit. No partial totals are shown.");
    if (rows.length < size) return result;
    last = rows[rows.length - 1].id;
  }
}
export function isMissingStaffWorkTable(error: unknown): boolean {
  for (let current: any = error, depth = 0; current && depth < 6; current = current.cause, depth++) {
    if ((current.code === "ER_NO_SUCH_TABLE" || current.errno === 1146) && /staff_work_events/i.test(String(current.sqlMessage ?? current.message ?? ""))) return true;
  }
  return false;
}
/** Minimal involved-ID lookup only; never enumerate user records or require their current role. */
export async function readStaffWorkPeople(db: any, ids: number[]) {
  const unique = Array.from(new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0)));
  if (unique.length > STAFF_WORK_HISTORY_LIMIT) throw new Error("Staff workload actor lookup exceeds the safe limit.");
  const people: { id: number; name: string | null }[] = [];
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const rows = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, batch)).limit(batch.length + 1);
    if (rows.length > batch.length || new Set(rows.map((row: any) => row.id)).size !== rows.length || rows.some((row: any) => !batch.includes(row.id))) throw new Error("Staff workload actor context could not be verified.");
    people.push(...rows);
  }
  return people;
}
export async function readStaffWorkData(db: any, asOf: Date): Promise<StaffWorkData> {
  const domains = Object.fromEntries(STAFF_WORK_DOMAINS.map(d => [d, { current: [], ledger: [], legacy: [] }])) as unknown as Record<StaffWorkDomain, WorkDomainData>;
  const a = schema.amendments; const f = schema.flightRequests; const r = schema.reimbursementItems;
  domains.amendment.current = await readStaffWorkBatches(db, a, { id: a.id, bookingId: a.bookingId, createdAt: a.createdAt, status: a.status, pipelineStage: a.pipelineStage, isReimbursementDoc: a.isReimbursementDoc, assignedToId: a.assignedToId, actionedAt: a.actionedAt, actionedById: a.actionedById, rejectedAt: a.rejectedAt, rejectedById: a.rejectedById }, lte(a.createdAt, asOf), STAFF_WORK_SOURCE_LIMIT);
  domains.flight.current = await readStaffWorkBatches(db, f, { id: f.id, bookingId: f.bookingId, createdAt: f.createdAt, status: f.status, requestType: f.requestType, ticketingDeadline: f.ticketingDeadline, cancellationTicketingDeadline: f.cancellationTicketingDeadline }, lte(f.createdAt, asOf), STAFF_WORK_SOURCE_LIMIT);
  domains.reimbursement.current = await readStaffWorkBatches(db, r, { id: r.id, bookingId: r.bookingId, createdAt: r.createdAt, status: r.status, assignedToId: r.assignedToId, scheduledAt: r.scheduledAt, paidAt: r.paidAt, paidById: r.paidById, nextFollowUpAt: r.nextFollowUpAt }, lte(r.createdAt, asOf), STAFF_WORK_SOURCE_LIMIT);
  const departureIds = Array.from(new Set(domains.amendment.current.filter(row => !row.isReimbursementDoc && !["Actioned", "rejected"].includes(amendmentStage({ id: row.id, bookingId: row.bookingId ?? 0, status: row.status, pipelineStage: row.pipelineStage }))).flatMap(row => row.bookingId == null ? [] : [row.bookingId])));
  const departures = new Map<number, WorkDate>();
  for (let i = 0; i < departureIds.length; i += BATCH) {
    const ids = departureIds.slice(i, i + BATCH);
    const rows = await db.select({ id: schema.bookings.id, departureDate: schema.bookings.departureDate }).from(schema.bookings).where(inArray(schema.bookings.id, ids)).limit(ids.length + 1);
    if (rows.length > ids.length || new Set(rows.map((row: any) => row.id)).size !== rows.length || rows.some((row: any) => !ids.includes(row.id))) throw new Error("Staff workload departure context could not be verified.");
    for (const row of rows) departures.set(row.id, row.departureDate);
  }
  for (const row of domains.amendment.current) row.departureDate = row.bookingId == null ? null : departures.get(row.bookingId) ?? null;
  let historyTrackingReady = !!schema.staffWorkEvents;
  if (historyTrackingReady) {
    const e = schema.staffWorkEvents;
    try {
      for (const domain of STAFF_WORK_DOMAINS) domains[domain].ledger = await readStaffWorkBatches(db, e, {
        id: e.id, eventKey: e.eventKey, requestId: e.requestId, bookingId: e.bookingId, eventType: e.eventType,
        beforeStatus: e.beforeStatus, afterStatus: e.afterStatus, actorId: e.actorId, actorRole: e.actorRole, actorName: e.actorName,
        occurredAt: e.occurredAt, recordedAt: e.recordedAt, requestType: e.requestType, sourceEventId: e.sourceEventId, receivedAt: e.receivedAt,
        component: sql<string | null>`JSON_UNQUOTE(JSON_EXTRACT(${e.metadata}, '$.component'))`,
        beforeAssigneeId: sql<number | null>`JSON_EXTRACT(${e.metadata}, '$.beforeAssigneeId')`, afterAssigneeId: sql<number | null>`JSON_EXTRACT(${e.metadata}, '$.afterAssigneeId')`,
        beforeInvoiceAdded: sql<boolean | null>`JSON_EXTRACT(${e.metadata}, '$.beforeInvoiceAdded')`, afterInvoiceAdded: sql<boolean | null>`JSON_EXTRACT(${e.metadata}, '$.afterInvoiceAdded')`,
      }, and(eq(e.domain, domain), lte(e.occurredAt, asOf), lte(e.recordedAt, asOf)), STAFF_WORK_HISTORY_LIMIT);
    } catch (error) {
      if (!isMissingStaffWorkTable(error)) throw error;
      historyTrackingReady = false;
      for (const domain of STAFF_WORK_DOMAINS) domains[domain].ledger = [];
    }
  }
  const fa = schema.flightRequestActions; const ra = schema.reimbursementAuditLogs;
  domains.flight.legacy = await readStaffWorkBatches(db, fa, { id: fa.id, requestId: fa.flightRequestId, bookingId: fa.bookingId, eventType: fa.action, beforeStatus: fa.previousStatus, afterStatus: fa.newStatus, actorId: fa.performedById, occurredAt: fa.createdAt }, lte(fa.createdAt, asOf), STAFF_WORK_HISTORY_LIMIT);
  domains.reimbursement.legacy = await readStaffWorkBatches(db, ra, { id: ra.id, requestId: ra.reimbursementItemId, bookingId: ra.bookingId, eventType: ra.action, beforeStatus: ra.oldStatus, afterStatus: ra.newStatus, actorId: ra.actedById, occurredAt: ra.actedAt }, lte(ra.actedAt, asOf), STAFF_WORK_HISTORY_LIMIT);
  const ids = STAFF_WORK_DOMAINS.flatMap(domain => [...domains[domain].current.flatMap(row => [row.actionedById, row.rejectedById, row.paidById, row.assignedToId]), ...domains[domain].ledger.map(row => row.actorId), ...domains[domain].legacy.map(row => row.actorId)]).filter((id): id is number => id != null);
  return { domains, people: await readStaffWorkPeople(db, ids), historyTrackingReady };
}
export async function readStaffWorkPageContexts(db: any, bookingIds: number[]) {
  const ids = Array.from(new Set(bookingIds));
  if (!ids.length) return [];
  if (ids.length > 100) throw new Error("Staff workload context lookup exceeds the page limit.");
  const b = schema.bookings;
  const rows = await db.select({ id: b.id, clientName: b.clientName, ptsRef: b.ptsRef, topdogRef: b.topdogRef, crmRef: b.crmRef }).from(b).where(inArray(b.id, ids)).limit(ids.length + 1);
  if (rows.length > ids.length || new Set(rows.map((row: any) => row.id)).size !== rows.length || rows.some((row: any) => !ids.includes(row.id))) throw new Error("Staff workload booking context could not be verified.");
  return rows.map((row: any) => ({ id: row.id, clientName: row.clientName, reference: row.ptsRef || row.topdogRef || row.crmRef || null }));
}
/** Read-only service: the first SELECT establishes one repeatable-read snapshot for all sources.
 * Keep transaction characteristics portable: TiDB does not accept MySQL's READ ONLY syntax.
 * Every query in this service is SELECT-only; it never invokes mutation/provider helpers.
 */
export async function getStaffWorkloadSummary(db: any, range: StaffWorkRange, asOf = new Date()): Promise<StaffWorkloadReport> {
  validateStaffWorkRange(range, asOf);
  return db.transaction(async (tx: any) => buildStaffWorkAnalysis(await readStaffWorkData(tx, asOf), range, asOf).report, { isolationLevel: "repeatable read" });
}
export async function getStaffWorkloadDetails(db: any, input: StaffWorkloadDrillInput, asOf = new Date()): Promise<StaffWorkloadDetails> {
  validateStaffWorkRange(input, asOf);
  return db.transaction(async (tx: any) => {
    const analysis = buildStaffWorkAnalysis(await readStaffWorkData(tx, asOf), input, asOf);
    const page = buildStaffWorkDetails(analysis, input);
    const contexts = await readStaffWorkPageContexts(tx, page.rows.flatMap(row => row.bookingId == null ? [] : [row.bookingId]));
    return buildStaffWorkDetails(analysis, input, contexts);
  }, { isolationLevel: "repeatable read" });
}
