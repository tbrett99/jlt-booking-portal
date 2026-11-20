import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { reimbursementAuditLogs, staffWorkEvents } from "../drizzle/schema";

export type WorkActor = { id: number | null; role?: string | null; name?: string | null };
export type WorkMetadata = {
  component?: "ticketing" | "cancellation";
  beforeAssigneeId?: number | null;
  afterAssigneeId?: number | null;
  beforeFollowUpAt?: string | null;
  afterFollowUpAt?: string | null;
  beforeInvoiceAdded?: boolean;
  afterInvoiceAdded?: boolean;
};
export type WorkEventInput = {
  domain: "amendment" | "flight" | "reimbursement";
  requestId: number;
  bookingId?: number | null;
  eventType: "created" | "status_changed" | "reopened" | "assigned" | "deleted" | "queried" | "price_notified" | "invoice_updated" | "baseline_completed";
  beforeStatus?: string | null;
  afterStatus?: string | null;
  actor?: WorkActor | null;
  occurredAt?: Date;
  receivedAt?: Date | null;
  requestType?: string | null;
  sourceEventId?: number | null;
  eventKey?: string;
  metadata?: WorkMetadata | null;
};

/** Reuse a caller's transaction; ordinary mutations create their own. Never swallow ledger errors. */
export async function withWorkTransaction<T>(db: any, writer: any | undefined, work: (tx: any) => Promise<T>): Promise<T> {
  return writer ? work(writer) : db.transaction(work);
}

/** Lock the actual entity, not a stale join or a client-supplied booking. */
export async function lockWorkRequest(tx: any, table: any, id: number, expectedBookingId?: number) {
  const [row] = await tx.select().from(table).where(eq(table.id, id)).limit(1).for("update");
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
  if (expectedBookingId !== undefined && row.bookingId !== expectedBookingId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Request does not belong to this booking" });
  }
  return row;
}

export function workEventValues(input: WorkEventInput) {
  const metadata: WorkMetadata = {};
  // Runtime allowlist as well as a narrow type: never persist arbitrary handler data.
  for (const key of ["component", "beforeAssigneeId", "afterAssigneeId", "beforeFollowUpAt", "afterFollowUpAt", "beforeInvoiceAdded", "afterInvoiceAdded"] as const) {
    if (input.metadata?.[key] !== undefined) (metadata as any)[key] = input.metadata[key];
  }
  const role = input.actor?.role ?? null;
  return {
    eventKey: input.eventKey ?? (input.sourceEventId != null
      ? `${input.domain}:audit:${input.sourceEventId}` : `${input.domain}:${input.requestId}:${randomUUID()}`),
    domain: input.domain, requestId: input.requestId, bookingId: input.bookingId ?? null,
    eventType: input.eventType, beforeStatus: input.beforeStatus ?? null, afterStatus: input.afterStatus ?? null,
    actorId: input.actor?.id ?? null, actorRole: role,
    actorName: role === "admin" || role === "super_admin" ? input.actor?.name?.slice(0, 255) ?? null : null,
    occurredAt: input.occurredAt ?? new Date(), recordedAt: new Date(),
    requestType: input.requestType ?? null, sourceEventId: input.sourceEventId ?? null,
    receivedAt: input.receivedAt ?? null, metadata: Object.keys(metadata).length ? metadata : null,
  };
}

export async function appendStaffWorkEvent(tx: any, input: WorkEventInput) {
  await tx.insert(staffWorkEvents).values(workEventValues(input));
}

/** Compatibility creation path uses the same prepared connection and its transaction. */
export async function appendRawStaffWorkEvent(connection: any, input: WorkEventInput) {
  const values = workEventValues(input);
  const keys = Object.keys(values);
  await connection.execute(
    `INSERT INTO staff_work_events (${keys.map(key => `\`${key}\``).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    keys.map(key => key === "metadata" && values.metadata ? JSON.stringify(values.metadata) : (values as any)[key]),
  );
}

function reliableWorkDate(value: unknown, asOf: Date): Date | null {
  if (value == null || value === "") return null;
  const at = value instanceof Date ? value : new Date(value as string);
  return Number.isFinite(at.getTime()) && at <= asOf ? at : null;
}
function workSecond(at: Date): number { return Math.floor(at.getTime() / 1_000); }
const amendmentComplete = (status: string | null | undefined) => status === "Actioned" || status === "actioned";
const amendmentStatusEvents = new Set(["status_changed", "reopened", "queried", "price_notified", "baseline_completed"]);

async function retainedAmendmentHistory(tx: any, requestId: number, asOf: Date) {
  const rows = await tx.select({ eventType: staffWorkEvents.eventType, beforeStatus: staffWorkEvents.beforeStatus,
    afterStatus: staffWorkEvents.afterStatus, occurredAt: staffWorkEvents.occurredAt,
    recordedAt: staffWorkEvents.recordedAt, metadata: staffWorkEvents.metadata }).from(staffWorkEvents).where(and(
    eq(staffWorkEvents.domain, "amendment"), eq(staffWorkEvents.requestId, requestId),
  ));
  return rows.filter((event: any) => reliableWorkDate(event.occurredAt, asOf) &&
    (!event.recordedAt || reliableWorkDate(event.recordedAt, asOf)));
}

/** Same eligibility as the report: retained dates survive pending/reopened stages unless contradicted. Caller holds the request lock. */
export async function preserveAmendmentCompletion(tx: any, row: any) {
  const asOf = new Date();
  const at = reliableWorkDate(row.actionedAt, asOf);
  if (!at) return;
  const existing = await retainedAmendmentHistory(tx, row.id, asOf);
  const completed = existing.some((event: any) => amendmentStatusEvents.has(event.eventType) &&
    event.metadata?.component !== "cancellation" && amendmentComplete(event.afterStatus) && !amendmentComplete(event.beforeStatus));
  const contradicted = existing.some((event: any) => workSecond(new Date(event.occurredAt)) === workSecond(at) &&
    event.beforeStatus !== event.afterStatus && !amendmentComplete(event.afterStatus));
  if (completed || contradicted) return;
  await appendStaffWorkEvent(tx, {
    domain: "amendment", requestId: row.id, bookingId: row.bookingId,
    eventType: "baseline_completed", afterStatus: "Actioned", occurredAt: at,
    actor: row.actionedById != null ? { id: row.actionedById } : null,
    requestType: row.isReimbursementDoc ? "reimbursement_doc" : null,
    receivedAt: row.createdAt, eventKey: `amendment:${row.id}:baseline_completed`,
  });
}

/** Preserve the report's unmatched known rejection timestamp before overwrite or cascade deletion. */
export async function preserveAmendmentRejection(tx: any, row: any) {
  const asOf = new Date();
  const at = reliableWorkDate(row.rejectedAt, asOf);
  if (!at) return;
  const existing = await retainedAmendmentHistory(tx, row.id, asOf);
  if (existing.some((event: any) => amendmentStatusEvents.has(event.eventType) && event.beforeStatus !== event.afterStatus &&
    event.afterStatus === "rejected" && workSecond(new Date(event.occurredAt)) === workSecond(at))) return;
  await appendStaffWorkEvent(tx, {
    domain: "amendment", requestId: row.id, bookingId: row.bookingId,
    eventType: "baseline_completed", afterStatus: "rejected", occurredAt: at,
    actor: row.rejectedById != null ? { id: row.rejectedById } : null,
    requestType: row.isReimbursementDoc ? "reimbursement_doc" : null,
    receivedAt: row.createdAt, eventKey: `amendment:${row.id}:baseline_rejected:${workSecond(at)}`,
  });
}

/** Keep only unmatched reliable scheduled/paid evidence, including no-op audit matches, at MySQL second precision. Caller holds the item lock. */
export async function preserveReimbursementTimestamps(tx: any, row: any) {
  const asOf = new Date();
  const scheduledAt = reliableWorkDate(row.scheduledAt, asOf);
  const paidAt = reliableWorkDate(row.paidAt, asOf);
  if (!scheduledAt && !paidAt) return;
  const legacy = await tx.select({ afterStatus: reimbursementAuditLogs.newStatus, occurredAt: reimbursementAuditLogs.actedAt })
    .from(reimbursementAuditLogs).where(and(eq(reimbursementAuditLogs.reimbursementItemId, row.id),
      inArray(reimbursementAuditLogs.newStatus, ["scheduled", "paid"])));
  const ledger = await tx.select({ afterStatus: staffWorkEvents.afterStatus, occurredAt: staffWorkEvents.occurredAt,
    recordedAt: staffWorkEvents.recordedAt }).from(staffWorkEvents).where(and(
      eq(staffWorkEvents.domain, "reimbursement"), eq(staffWorkEvents.requestId, row.id),
      inArray(staffWorkEvents.afterStatus, ["scheduled", "paid"]),
    ));
  const matches = new Set<string>();
  for (const event of [...legacy, ...ledger]) {
    const at = reliableWorkDate(event.occurredAt, asOf);
    if (at && (!event.recordedAt || reliableWorkDate(event.recordedAt, asOf))) matches.add(`${event.afterStatus}:${workSecond(at)}`);
  }
  for (const [afterStatus, at] of [["scheduled", scheduledAt], ["paid", paidAt]] as const) {
    if (!at || matches.has(`${afterStatus}:${workSecond(at)}`)) continue;
    await appendStaffWorkEvent(tx, {
      domain: "reimbursement", requestId: row.id, bookingId: row.bookingId,
      eventType: "baseline_completed", afterStatus, occurredAt: at, receivedAt: row.createdAt,
      actor: afterStatus === "paid" && row.paidById != null ? { id: row.paidById } : null,
      eventKey: `reimbursement:${row.id}:baseline_completed:${afterStatus}:${workSecond(at)}`,
    });
  }
}

export function amendmentWorkStatus(row: any): string {
  if (row.status === "rejected") return "rejected";
  if (row.pipelineStage == null && row.status === "actioned") return "Actioned";
  return row.pipelineStage === "Actioned" ? "Actioned" : row.pipelineStage === "In Progress" ? "In Progress" : "To Do";
}

export function flightAuditAction(before: string, after: string): string {
  if (before === "completed" && after !== "completed") return "reopened";
  if (after === "completed") return "completed";
  if (after === "ticketed") return "ticketed";
  if (after === "cancelled") return "cancelled";
  if (after === "query") return "queried";
  if (after === "pending") return "reopened";
  return "status_updated";
}

export function flightWorkEventType(action: string): WorkEventInput["eventType"] {
  if (action === "submitted") return "created";
  if (action === "deleted") return "deleted";
  if (action === "queried") return "queried";
  if (action === "price_increase_notified") return "price_notified";
  if (action.startsWith("invoice_")) return "invoice_updated";
  if (action === "reopened" || action === "cancellation_reopened") return "reopened";
  return "status_changed";
}

export function insertedAuditId(result: any): number {
  const id = Number(result[0]?.insertId ?? result.insertId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Audit insert did not return an ID");
  return id;
}
