import { describe, expect, it } from "vitest";
import { buildStaffWorkAnalysis, buildStaffWorkDetails, STAFF_WORK_SOURCE_LIMIT, type StaffWorkData, type WorkHistory, type WorkRequest } from "./staff-workload-report";
import { STAFF_WORK_DOMAINS, STAFF_WORK_METRICS, type StaffWorkDomain } from "../shared/staff-workload";
const now = new Date("2026-11-20T12:00:00Z");
const range = { rangeStart: "2026-11-01", rangeEnd: "2026-11-21" };
function empty(): StaffWorkData { return { domains: { amendment: { current: [], ledger: [], legacy: [] }, flight: { current: [], ledger: [], legacy: [] }, reimbursement: { current: [], ledger: [], legacy: [] } }, people: [{ id: 10, name: "Former staff" }, { id: 20, name: "Current assignee" }], historyTrackingReady: true }; }
function request(id: number, patch: Partial<WorkRequest> = {}): WorkRequest { return { id, bookingId: id + 1000, status: "pending", createdAt: "2026-10-01T09:00:00Z", ...patch }; }
function event(id: number, requestId: number, patch: Partial<WorkHistory> = {}): WorkHistory { return { id, requestId, bookingId: requestId + 1000, eventType: "status_changed", beforeStatus: "pending", afterStatus: "completed", actorId: 10, actorRole: "admin", occurredAt: "2026-11-04T10:00:00Z", ...patch }; }
const summary = (analysis: ReturnType<typeof buildStaffWorkAnalysis>, domain: StaffWorkDomain) => analysis.report.summaries.find(s => s.domain === domain)!;
describe("honest staff workload report aggregation", () => {
  it("counts any genuine closure during period once; repeats are a subset and survive reopened current state", () => {
    const data = empty();
    data.domains.flight.current = [request(1, { status: "ticketed", requestType: "both" }), request(2, { status: "completed" }), request(3, { status: "cancelled", requestType: "cancellation" })];
    data.domains.flight.legacy = [
      event(1, 1, { eventType: "ticketed", actorRole: null, occurredAt: "2026-10-02T09:00:00Z" }),
      event(2, 1, { eventType: "ticketed", actorRole: null, beforeStatus: "completed", afterStatus: "ticketed", occurredAt: "2026-11-02T09:00:00Z" }),
      event(3, 1, { eventType: "ticketed", actorRole: null, actorId: 10, beforeStatus: "ticketed", occurredAt: "2026-11-03T09:00:00Z" }),
      event(4, 1, { eventType: "ticketed", actorRole: null, actorId: 20, beforeStatus: "completed", occurredAt: "2026-11-04T09:00:00Z" }), // same-status save
      event(5, 1, { eventType: "reopened", actorRole: null, beforeStatus: "completed", afterStatus: "pending", occurredAt: "2026-11-05T09:00:00Z" }),
      event(6, 1, { eventType: "completed", actorRole: null, actorId: 20, occurredAt: "2026-11-06T09:00:00Z" }),
      event(7, 1, { eventType: "cancellation_completed", actorRole: null, beforeStatus: "pending", afterStatus: "cancelled", occurredAt: "2026-11-07T09:00:00Z" }),
      event(8, 3, { eventType: "cancelled", actorRole: null, afterStatus: "cancelled" }),
      event(9, 2, { eventType: "ticketed", actorRole: null, beforeStatus: "ticketed" }),
    ];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "flight")).toMatchObject({ completed: 2, reprocessed: 1, outstanding: 2, unassigned: null });
    expect(a.report.staff.find(s => s.actorId === 10)).toMatchObject({ flightsCompleted: 2, reprocessed: 1 });
    expect(a.report.staff.find(s => s.actorId === 20)).toMatchObject({ flightsCompleted: 0 });
    const drill = buildStaffWorkDetails(a, { ...range, domain: "flight", metric: "completed" });
    expect(drill.total).toBe(2); expect(drill.rows.find(r => r.requestId === 1)).toMatchObject({ actionAt: "2026-11-03T09:00:00.000Z", actorId: 10, currentStatus: "ticketed" });
    expect(buildStaffWorkDetails(a, { ...range, domain: "flight", metric: "reprocessed" }).total).toBe(1);
    expect(a.report.daily.reduce((n, d) => n + d.completed, 0)).toBe(2);
    // Old first closure is not replaced with time to reclosure in the turnaround sample.
    expect(summary(a, "flight").turnaroundSampleCount).toBe(1);
  });
  it("handles cancellation-only, both, ticketed, cancelled and missing closure dates honestly", () => {
    const data = empty();
    data.domains.flight.current = [request(1, { requestType: "cancellation", status: "completed" }), request(2, { requestType: "both", status: "ticketed" }), request(3, { status: "completed" }), request(4, { status: "price_increase_pending" }), request(5, { status: "query" }), request(6, { status: "cancelled" })];
    data.domains.flight.legacy = [event(1, 1, { eventType: "ticketed", actorRole: null }), event(2, 2, { eventType: "cancellation_completed", actorRole: null, afterStatus: "cancelled" }), event(3, 2, { eventType: "ticketed", actorRole: null, afterStatus: "ticketed" })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "flight")).toMatchObject({ completed: 1, outstanding: 4, waiting: 2, unassigned: null });
    expect(a.report.coverage.find(c => c.domain === "flight")!.unknownCompletionDate).toBe(1);
    expect(buildStaffWorkDetails(a, { ...range, domain: "flight", metric: "completed" }).rows[0].title).toContain("cancellation");
  });
  it("excludes agent submissions and price acceptance/decline from staff touched, retains former staff", () => {
    const data = empty();
    data.domains.flight.legacy = [event(1, 1, { eventType: "submitted", actorRole: null, afterStatus: "pending" }), event(2, 2, { eventType: "price_increase_accepted", actorRole: null, beforeStatus: "price_increase_pending", afterStatus: "pending" }), event(3, 3, { eventType: "price_increase_declined", actorRole: null, beforeStatus: "price_increase_pending", afterStatus: "query" }), event(4, 4, { eventType: "queried", actorRole: null, afterStatus: "query" })];
    data.domains.flight.ledger = [event(5, 5, { actorRole: "agent", afterStatus: "query", eventType: "queried" })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "flight").touched).toBe(1);
    expect(a.report.staff).toHaveLength(1); expect(a.report.staff[0].actorName).toBe("Former staff");
  });
  it("distinct touched is requests, not event/note counts; per-staff unions can overlap", () => {
    const data = empty();
    data.domains.flight.ledger = [event(1, 1, { afterStatus: "query", eventType: "queried" }), event(2, 1, { beforeStatus: "query", afterStatus: "pending", actorId: 20 }), event(3, 1, { actorId: 20 }), event(4, 1, { beforeStatus: "completed", afterStatus: "completed" })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "flight").touched).toBe(1);
    expect(a.report.staff.map(s => s.touched)).toEqual([1, 1]);
    expect(buildStaffWorkDetails(a, { ...range, domain: "flight", metric: "touched", actorId: 20 }).total).toBe(1);
  });
  it("retains genuine same-status recorded query/chase/price notifications but excludes no-op status saves", () => {
    const data = empty();
    data.domains.reimbursement.legacy = [event(1, 1, { eventType: "agent_chased", actorRole: null, beforeStatus: "awaiting_agent", afterStatus: "awaiting_agent" }), event(2, 2, { actorRole: null, beforeStatus: "scheduled", afterStatus: "scheduled" })];
    data.domains.reimbursement.ledger = [event(3, 3, { eventType: "queried", beforeStatus: "awaiting_agent", afterStatus: "awaiting_agent" })];
    data.domains.flight.ledger = [event(4, 4, { eventType: "queried", beforeStatus: "query", afterStatus: "query" }), event(5, 5, { eventType: "price_notified", beforeStatus: "price_increase_pending", afterStatus: "price_increase_pending" }), event(6, 6, { beforeStatus: "completed", afterStatus: "completed" })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "reimbursement")).toMatchObject({ touched: 2, completed: 0 });
    expect(summary(a, "flight")).toMatchObject({ touched: 2, completed: 0 });
    expect(a.report.staff.find(s => s.actorId === 10)!.touched).toBe(4);
    expect(buildStaffWorkDetails(a, { ...range, domain: "reimbursement", metric: "touched", actorId: 10 }).total).toBe(2);
  });
  it("counts amendment urgency only for outstanding genuine requests departing today through seven UK days", () => {
    const data = empty();
    data.domains.amendment.current = [request(1, { departureDate: "2026-11-20T00:00:00Z" }), request(2, { departureDate: "2026-11-27T23:59:59Z" }), request(3, { departureDate: "2026-11-28T00:00:00Z" }), request(4, { departureDate: "2026-11-19T23:59:59Z" }), request(5, { departureDate: null }), request(6, { status: "rejected", departureDate: "2026-11-20T00:00:00Z" }), request(7, { pipelineStage: "Actioned", departureDate: "2026-11-20T00:00:00Z" }), request(8, { isReimbursementDoc: true, departureDate: "2026-11-20T00:00:00Z" })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "amendment")).toMatchObject({ outstanding: 5, urgent: 2, oldestDays: 50 });
    expect(a.report.coverage[0].warnings.join(" ")).toContain("seven London calendar days");
  });
  it("dedupes ledger source IDs and event keys before classifying repeats", () => {
    const data = empty();
    data.domains.flight.legacy = [event(10, 1, { eventType: "ticketed", actorRole: null })];
    data.domains.flight.ledger = [event(101, 1, { eventKey: "flight:audit:10", sourceEventId: 10 }), event(102, 1, { eventKey: "flight:audit:10", sourceEventId: 10 }), event(103, 1, { eventKey: "duplicate-source", sourceEventId: 10 })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "flight")).toMatchObject({ completed: 1, reprocessed: 0, touched: 1 });
    expect(a.entities[0].actions.filter(a => a.completion)).toHaveLength(1);
  });
  it("uses explicit amendment stages for queue but retained latest action dates after reopen", () => {
    const data = empty();
    data.domains.amendment.current = [request(1, { status: "actioned", pipelineStage: "To Do", actionedAt: "2026-11-03T10:00:00Z", actionedById: null, assignedToId: 20 }), request(2, { status: "actioned", pipelineStage: null, actionedAt: "2026-11-04T10:00:00Z", actionedById: 10 }), request(3, { status: "rejected", pipelineStage: "Actioned", rejectedAt: "2026-11-05T10:00:00Z", rejectedById: 10 }), request(4, { isReimbursementDoc: true, status: "actioned", pipelineStage: "Actioned", actionedAt: "2026-11-05T10:00:00Z" }), request(5, { status: "actioned", pipelineStage: "Actioned" })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "amendment")).toMatchObject({ completed: 2, rejected: 1, outstanding: 1, unassigned: 0 });
    expect(a.report.coverage.find(c => c.domain === "amendment")).toMatchObject({ unknownCompletionActor: 1, unknownCompletionDate: 1 });
    expect(buildStaffWorkDetails(a, { ...range, domain: "amendment", metric: "completed", actorId: null }).rows).toMatchObject([{ requestId: 1, actorId: null, actorName: "Unknown actor", evidence: "legacy_record" }]);
    expect(buildStaffWorkDetails(a, { ...range, domain: "amendment", metric: "completed", actorId: 20 }).total).toBe(0);
    expect(buildStaffWorkDetails(a, { ...range, domain: "amendment", metric: "outstanding", actorId: 20 }).total).toBe(1);
  });
  it("prefers amendment ledger/baseline and rejects contradicted retained date without erasing older closure", () => {
    const data = empty();
    data.domains.amendment.current = [request(1, { pipelineStage: "To Do", actionedAt: "2026-11-06T10:00:00Z" }), request(2, { actionedAt: "2026-11-05T10:00:00Z" }), request(3, { pipelineStage: "To Do" })];
    data.domains.amendment.ledger = [event(1, 1, { eventType: "baseline_completed", beforeStatus: null, afterStatus: "Actioned", occurredAt: "2026-10-04T10:00:00Z" }), event(2, 1, { beforeStatus: "Actioned", afterStatus: "To Do" }), event(3, 2, { beforeStatus: "To Do", afterStatus: "In Progress", occurredAt: "2026-11-05T10:00:00Z" }), event(4, 3, { beforeStatus: "To Do", afterStatus: "Actioned" }), event(5, 3, { beforeStatus: "Actioned", afterStatus: "To Do", occurredAt: "2026-11-10T10:00:00Z" })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "amendment")).toMatchObject({ completed: 1, reprocessed: 0, outstanding: 3 });
    expect(a.entities.find(e => e.id === 1)!.actions.filter(a => a.completion)).toHaveLength(1);
    expect(a.entities.find(e => e.id === 2)!.actions.filter(a => a.completion)).toHaveLength(0);
  });
  it("counts supplier items, schedule operationally, pay separately, retained fallback never uses assignee", () => {
    const data = empty();
    data.domains.reimbursement.current = [request(1, { bookingId: 88, status: "paid", scheduledAt: "2026-11-04T10:00:00Z", paidAt: "2026-11-05T10:00:00Z", paidById: 20, assignedToId: 20 }), request(2, { bookingId: 88, status: "scheduled", scheduledAt: "2026-11-06T10:00:00Z", assignedToId: 20 }), request(3, { status: "scheduled", scheduledAt: "2026-11-07T10:00:00Z" })];
    data.domains.reimbursement.legacy = [event(1, 1, { actorRole: null, afterStatus: "scheduled", occurredAt: "2026-10-05T10:00:00Z" }), event(2, 1, { actorRole: null, beforeStatus: "scheduled", afterStatus: "pending", occurredAt: "2026-11-03T10:00:00Z" }), event(3, 1, { actorRole: null, afterStatus: "scheduled" }), event(4, 1, { actorRole: null, actorId: 20, beforeStatus: "scheduled", afterStatus: "paid", occurredAt: "2026-11-05T10:00:00Z" }), event(5, 3, { actorRole: null, beforeStatus: "scheduled", afterStatus: "scheduled", occurredAt: "2026-11-07T10:00:00Z" })];
    data.domains.reimbursement.ledger = [event(100, 1, { sourceEventId: 3, afterStatus: "scheduled" }), event(101, 1, { sourceEventId: 4, actorId: 20, beforeStatus: "scheduled", afterStatus: "paid", occurredAt: "2026-11-05T10:00:00Z" })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "reimbursement")).toMatchObject({ completed: 2, reprocessed: 1, paid: 1, outstanding: 0 });
    expect(buildStaffWorkDetails(a, { ...range, domain: "reimbursement", metric: "completed", actorId: null }).rows[0]).toMatchObject({ requestId: 2, actorId: null });
    expect(buildStaffWorkDetails(a, { ...range, domain: "reimbursement", metric: "completed", actorId: 20 }).total).toBe(0);
    expect(a.report.staff.find(s => s.actorId === 20)!.recordedPaid).toBe(1);
  });
  it("current reimbursement queue and overdue followups require pending/awaiting and strictly earlier than asOf", () => {
    const data = empty();
    data.domains.reimbursement.current = [request(1, { status: "pending", nextFollowUpAt: "2026-11-19T09:00:00Z" }), request(2, { status: "awaiting_agent", assignedToId: 20, nextFollowUpAt: "2026-11-20T11:00:00Z" }), request(3, { status: "scheduled", nextFollowUpAt: "2026-11-18T09:00:00Z" }), request(4, { status: "paid", nextFollowUpAt: "2026-11-18T09:00:00Z" }), request(5, { status: "pending", nextFollowUpAt: now })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "reimbursement")).toMatchObject({ outstanding: 3, waiting: 1, overdueFollowUps: 2, urgent: 2, unassigned: 2 });
  });
  it("received independent of closure, UK boundaries exclusive, prior/after history classify backdated completion", () => {
    const data = empty();
    data.domains.flight.current = [request(1, { createdAt: "2026-10-24T22:59:59Z" }), request(2, { createdAt: "2026-10-24T23:00:00Z" }), request(3, { createdAt: "2026-10-26T00:00:00Z" })];
    data.domains.flight.ledger = [event(1, 1, { occurredAt: "2026-10-01T12:00:00Z" }), event(2, 1, { occurredAt: "2026-10-25T23:30:00Z", recordedAt: "2026-11-10T10:00:00Z" }), event(3, 2, { occurredAt: "2026-10-26T00:00:00Z" }), event(4, 3, { occurredAt: "2026-11-21T00:00:00Z" })];
    const a = buildStaffWorkAnalysis(data, { rangeStart: "2026-10-25", rangeEnd: "2026-10-26" }, now);
    expect(summary(a, "flight")).toMatchObject({ received: 1, completed: 1, reprocessed: 1 });
    expect(a.report.daily).toMatchObject([{ date: "2026-10-25", received: 1, completed: 1, reprocessed: 1 }]);
    expect(buildStaffWorkDetails(a, { rangeStart: "2026-10-25", rangeEnd: "2026-10-26", domain: "flight", metric: "received" }).rows[0].requestId).toBe(2);
  });
  it("preserves deleted history and intake snapshots with generic titles and exact historical booking IDs", () => {
    const data = empty();
    data.domains.amendment.ledger = [event(1, 91, { beforeStatus: "To Do", afterStatus: "Actioned", actorId: null, actorRole: null, receivedAt: "2026-11-01T09:00:00Z", bookingId: 44 }), event(2, 92, { beforeStatus: "To Do", afterStatus: "Actioned", bookingId: null })];
    const a = buildStaffWorkAnalysis(data, range, now);
    const d = buildStaffWorkDetails(a, { ...range, domain: "amendment", metric: "completed" }, [{ id: 45, clientName: "Wrong booking", reference: "WRONG" }]);
    expect(d.rows.every(r => r.isDeleted && r.clientName === null && r.reference === null)).toBe(true);
    expect(d.rows.find(r => r.requestId === 91)).toMatchObject({ bookingId: 44, title: "Amendment #91", actorId: null });
    expect(summary(a, "amendment")).toMatchObject({ completed: 2, received: 1, outstanding: 0 });
    expect(a.report.coverage[0].warnings.join(" ")).toContain("lack recorded intake");
  });
  it("excludes deleted reimbursement-document ledger tasks and labels baseline import as legacy evidence", () => {
    const data = empty();
    data.domains.amendment.ledger = [event(1, 1, { eventType: "baseline_completed", beforeStatus: null, afterStatus: "Actioned", requestType: "amendment", actorRole: null }), event(2, 2, { beforeStatus: "To Do", afterStatus: "Actioned", requestType: "reimbursement_doc" })];
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "amendment")).toMatchObject({ completed: 1, touched: 1 });
    expect(buildStaffWorkDetails(a, { ...range, domain: "amendment", metric: "completed" }).rows).toMatchObject([{ requestId: 1, evidence: "legacy_record", eventLabel: "Retained latest completion (legacy timestamp)", isDeleted: true }]);
  });
  it("zero counts stay zero, unavailable assignments/turnaround are null, missing table warns", () => {
    const data = empty(); data.historyTrackingReady = false;
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(summary(a, "flight")).toMatchObject({ completed: 0, unassigned: null, oldestDays: null, medianTurnaroundHours: null, turnaroundSampleCount: 0 });
    expect(summary(a, "amendment").unassigned).toBe(0);
    expect(a.report.historyTrackingReady).toBe(false); expect(a.report.warnings.join(" ")).toContain("missing");
  });
  it("all domain drills equal summary totals and all pages are exact non-overlapping distinct rows", () => {
    const data = empty();
    for (const domain of STAFF_WORK_DOMAINS) {
      data.domains[domain].current = Array.from({ length: 7 }, (_, i) => request(i + 1, { createdAt: "2026-11-01T09:00:00Z" }));
      data.domains[domain].ledger = Array.from({ length: 7 }, (_, i) => event(i + 1, i + 1, { actorId: i % 2 ? null : 10, afterStatus: domain === "flight" ? "completed" : domain === "amendment" ? "Actioned" : "scheduled" }));
    }
    const a = buildStaffWorkAnalysis(data, range, now);
    for (const domain of STAFF_WORK_DOMAINS) for (const metric of STAFF_WORK_METRICS) {
      const d = buildStaffWorkDetails(a, { ...range, domain, metric });
      expect(d.total).toBe(summary(a, domain)[metric]);
      const pages = [1, 2, 3].flatMap(page => buildStaffWorkDetails(a, { ...range, domain, metric, page, pageSize: 3 }).rows.map(row => row.requestId));
      expect(new Set(pages).size).toBe(d.total);
      expect(pages).toHaveLength(d.total);
    }
    expect(buildStaffWorkDetails(a, { ...range, domain: "flight", metric: "completed", actorId: null }).total).toBe(3);
    expect(buildStaffWorkDetails(a, { ...range, domain: "flight", metric: "completed", actorId: undefined }).total).toBe(7);
    expect(buildStaffWorkDetails(a, { ...range, domain: "flight", metric: "completed", page: 10 }).rows).toEqual([]);
    expect(() => buildStaffWorkDetails(a, { ...range, domain: "flight", metric: "completed", pageSize: 101 })).toThrow();
    for (const domain of STAFF_WORK_DOMAINS) {
      const key = domain === "flight" ? "flightsCompleted" : domain === "amendment" ? "amendmentsCompleted" : "reimbursementsProcessed";
      expect(a.report.staff.reduce((n, s) => n + s[key], 0)).toBe(summary(a, domain).completed);
    }
  });
  it("hard source caps fail closed, never return partial or zero totals", () => {
    const data = empty(); data.domains.flight.current = Array.from({ length: STAFF_WORK_SOURCE_LIMIT + 1 }, (_, i) => request(i + 1));
    expect(() => buildStaffWorkAnalysis(data, range, now)).toThrow("No partial totals");
  });
  it("handles near-cap history without argument-stack overflow or quadratic actor aggregation", () => {
    const data = empty();
    data.domains.flight.ledger = Array.from({ length: 100_000 }, (_, i) => event(i + 1, 1, { eventType: "queried", beforeStatus: "query", afterStatus: "query", actorId: i % 1000 + 1, occurredAt: "2026-10-01T09:00:00Z" }));
    data.domains.flight.legacy = Array.from({ length: 100_000 }, (_, i) => event(i + 1, 2, { eventType: "queried", beforeStatus: "query", afterStatus: "query", actorRole: null, occurredAt: "2026-10-02T09:00:00Z" }));
    const a = buildStaffWorkAnalysis(data, range, now);
    expect(a.report.coverage.find(c => c.domain === "flight")!.earliestRecordedAction).toBe("2026-10-01T09:00:00.000Z");
    expect(summary(a, "flight")).toMatchObject({ touched: 0, completed: 0 });
  });
});
