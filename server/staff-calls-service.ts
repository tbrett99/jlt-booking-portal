import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  users,
  agentCrmProfiles,
  agentRecordMerges,
  businessStaffMemberships,
  staffRoleAssignments,
  staffCalls,
  staffCallParticipants,
  staffCallHistory,
  staffCallOperations,
  staffCallWebhookInbox,
  staffCallActionSources,
  academyActionPlans,
  academyActionPlanTargets,
  type StaffCall,
  type StaffCallParticipant,
  type StaffCallOperation,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  STAFF_CALL_REASONS,
  type StaffCallSummary,
  type StaffCallParticipantDto,
  type StaffCallOperationResult,
  staffCallBookInput,
  staffCallRescheduleInput,
  staffCallCancelInput,
  staffCallCancelParticipantInput,
  staffCallAvailabilityInput,
  staffCallDiaryInput,
  staffCallWindowInput,
  staffCallAgentsInput,
  staffCallNotesInput,
  staffCallShareInput,
  staffCallFollowUpInput,
  staffCallAgentHistoryInput,
} from "../shared/staff-calls";
import {
  StaffCallsProvider,
  verifyStaffCallWebhook,
  type StaffCallBooking,
  type StaffCallLink,
  type StaffCallIdentity,
  type StaffProviderResult,
  type StaffCallLifecycleEvent,
  type StaffCallWriteGuard,
} from "./staff-calls-provider";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type StaffCallDb = Pick<Database, "select" | "insert" | "update">;
export type StaffCallActor = {
  id: number;
  name: string | null;
  role: "agent" | "admin" | "super_admin";
  isAdmin: boolean;
  engagement: boolean;
};
function fail(
  code:
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "BAD_REQUEST"
    | "PRECONDITION_FAILED"
    | "INTERNAL_SERVER_ERROR",
  message: string
): never {
  throw new TRPCError({ code, message });
}
export function staffCallCurrentAgentFilter() {
  return and(
    eq(users.role, "agent"),
    eq(users.isActive, true),
    eq(users.portalStatus, "active"),
    sql`NOT EXISTS (SELECT 1 FROM agent_record_merges sc_merge WHERE sc_merge.sourceUserId = ${users.id})`,
    sql`NOT EXISTS (SELECT 1 FROM agent_crm_profiles sc_profile WHERE sc_profile.userId = ${users.id} AND COALESCE(sc_profile.agentStatus, 'active') <> 'active')`,
    sql`NOT EXISTS (SELECT 1 FROM business_staff_memberships sc_business WHERE sc_business.staffUserId = ${users.id})`
  )!;
}
/** Uses only the supplied ORM/transaction; stale sessions never confer authority. */
export async function requireStaffCallActor(
  db: StaffCallDb,
  actorId: number,
  options: { manage?: boolean; admin?: boolean } = {}
): Promise<StaffCallActor> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      portalStatus: users.portalStatus,
      mustChangePassword: users.mustChangePassword,
      crmStatus: agentCrmProfiles.agentStatus,
      archiveId: agentRecordMerges.id,
      businessId: businessStaffMemberships.id,
    })
    .from(users)
    .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
    .leftJoin(agentRecordMerges, eq(agentRecordMerges.sourceUserId, users.id))
    .leftJoin(
      businessStaffMemberships,
      eq(businessStaffMemberships.staffUserId, users.id)
    )
    .where(eq(users.id, actorId))
    .limit(1);
  if (!row || !row.isActive || row.mustChangePassword || row.businessId != null)
    fail("FORBIDDEN", "An active authorised account is required");
  const isAdmin = row.role === "admin" || row.role === "super_admin";
  if (
    !isAdmin &&
    (row.role !== "agent" ||
      row.portalStatus !== "active" ||
      row.archiveId != null ||
      (row.crmStatus && row.crmStatus !== "active"))
  )
    fail("FORBIDDEN", "An active authorised account is required");
  let engagement = false;
  if (!isAdmin) {
    const grants = await db
      .select({ id: staffRoleAssignments.id })
      .from(staffRoleAssignments)
      .where(
        and(
          eq(staffRoleAssignments.userId, row.id),
          eq(staffRoleAssignments.staffRole, "agent_engagement"),
          eq(staffRoleAssignments.isActive, true)
        )
      )
      .limit(1);
    engagement = grants.length > 0;
  }
  if (options.admin && !isAdmin)
    fail("FORBIDDEN", "Administrator access required");
  if (options.manage && !isAdmin && !engagement)
    fail("FORBIDDEN", "Agent Engagement staff access required");
  return { id: row.id, name: row.name, role: row.role, isAdmin, engagement };
}
export function staffCallPayloadHash(value: unknown): string {
  const canonical = (v: any): any =>
    v instanceof Date
      ? v.toISOString()
      : Array.isArray(v)
        ? v.map(canonical)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .filter(k => v[k] !== undefined)
                .map(k => [k, canonical(v[k])])
            )
          : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
const snapshot = (v: unknown) => JSON.parse(JSON.stringify(v));
const groupProof = (ps: StaffCallParticipant[]) => ({
  invitedParticipantIds: ps.map(p => p.id),
  knownSeats: ps
    .filter(p => p.providerSeatUid)
    .map(p => ({ participantId: p.id, seatUid: p.providerSeatUid! })),
});
/** The active ledger owns a reschedule destination until confirmed or definitively failed. */
async function rescheduleReservations(
  db: StaffCallDb,
  hostUserId: number,
  excludeCallId?: number
) {
  const calls = await db
    .select()
    .from(staffCalls)
    .where(
      and(
        eq(staffCalls.hostUserId, hostUserId),
        excludeCallId ? sql`${staffCalls.id} <> ${excludeCallId}` : undefined
      )
    );
  const owned = calls.filter(c => c.activeOperationId != null);
  if (!owned.length) return [] as { startAt: Date; endAt: Date }[];
  const operations = await db
    .select()
    .from(staffCallOperations)
    .where(
      and(
        inArray(
          staffCallOperations.callId,
          owned.map(c => c.id)
        ),
        eq(staffCallOperations.kind, "reschedule"),
        inArray(staffCallOperations.state, ["pending", "needs_recovery"])
      )
    );
  return operations
    .filter(o =>
      owned.some(c => c.id === o.callId && c.activeOperationId === o.id)
    )
    .map(o => {
      const payload = o.payload as { startAt?: string; endAt?: string };
      return {
        startAt: new Date(payload.startAt ?? ""),
        endAt: new Date(payload.endAt ?? ""),
      };
    })
    .filter(r => Number.isFinite(r.startAt.getTime()) && r.endAt > r.startAt);
}
const summaryColumns = {
  id: staffCalls.id,
  hostUserId: staffCalls.hostUserId,
  reasonKey: staffCalls.reasonKey,
  reasonExplanation: staffCalls.reasonExplanation,
  format: staffCalls.format,
  startAt: staffCalls.startAt,
  endAt: staffCalls.endAt,
  status: staffCalls.status,
  version: staffCalls.version,
  meetingUrl: staffCalls.meetingUrl,
  participantCount: sql<number>`(SELECT COUNT(*) FROM staff_call_participants sc_count WHERE sc_count.callId = ${staffCalls.id} AND sc_count.status = 'active')`,
};
type SummaryRow = Omit<StaffCallSummary, "hostName">;
export interface StaffCallsServiceDependencies {
  getDb?: typeof getDb;
  now?: () => Date;
  providerFactory?: (
    resolveParticipant: (
      identity: StaffCallIdentity,
      hostUserId: number
    ) => Promise<{ name: string; email: string } | null>
  ) => StaffCallsProvider;
}
export function createStaffCallsService(
  deps: StaffCallsServiceDependencies = {}
) {
  const now = deps.now ?? (() => new Date());
  const database = async (): Promise<Database> => {
    const db = await (deps.getDb ?? getDb)();
    if (!db) fail("INTERNAL_SERVER_ERROR", "Diary storage is unavailable");
    return db;
  };
  const history = async (
    db: StaffCallDb,
    callId: number,
    actorId: number | null,
    action: string,
    before: unknown,
    after: unknown,
    participantId: number | null = null
  ) => {
    await db.insert(staffCallHistory).values({
      callId,
      participantId,
      actorId,
      action,
      beforeState: before == null ? null : snapshot(before),
      afterState: snapshot(after),
      createdAt: now(),
    });
  };
  const exactAgents = async (
    db: StaffCallDb,
    ids: number[],
    requireIdentity = false
  ) => {
    if (!ids.length || new Set(ids).size !== ids.length)
      fail("BAD_REQUEST", "Choose exact unique agent identities");
    const rows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(staffCallCurrentAgentFilter(), inArray(users.id, ids)));
    if (
      rows.length !== ids.length ||
      ids.some(id => !rows.some(r => r.id === id))
    )
      fail("FORBIDDEN", "Only current active nonarchived agents are available");
    if (
      requireIdentity &&
      rows.some(
        r =>
          !r.name?.trim() ||
          !r.email?.trim() ||
          !z.string().email().safeParse(r.email).success
      )
    )
      fail(
        "PRECONDITION_FAILED",
        "A selected agent has no confirmed booking identity"
      );
    return rows;
  };
  const hostAuthority = async (
    db: StaffCallDb,
    actor: StaffCallActor,
    hostUserId: number
  ) => {
    if (!actor.isAdmin && hostUserId !== actor.id)
      fail("FORBIDDEN", "Only your own diary is available");
    return requireStaffCallActor(db, hostUserId, { manage: true });
  };
  const callFor = async (
    db: StaffCallDb,
    actor: StaffCallActor,
    callId: number,
    locked = false
  ) => {
    const query = db
      .select()
      .from(staffCalls)
      .where(eq(staffCalls.id, callId))
      .limit(1);
    const [call] = await (locked ? query.for("update") : query);
    if (!call) fail("NOT_FOUND", "Call not found");
    if (!actor.isAdmin && (!actor.engagement || call.hostUserId !== actor.id))
      fail("FORBIDDEN", "Only your own diary is available");
    return call;
  };
  const participantsFor = async (
    db: StaffCallDb,
    callId: number,
    activeOnly = false
  ) =>
    db
      .select()
      .from(staffCallParticipants)
      .where(
        and(
          eq(staffCallParticipants.callId, callId),
          activeOnly ? eq(staffCallParticipants.status, "active") : undefined
        )
      )
      .orderBy(asc(staffCallParticipants.id));
  const scopeParticipants = async (
    db: StaffCallDb,
    actor: StaffCallActor,
    ps: { agentId: number }[]
  ) => {
    if (!actor.isAdmin && ps.length)
      await exactAgents(
        db,
        ps.map(p => p.agentId)
      );
  };
  const participantFor = async (
    db: StaffCallDb,
    actor: StaffCallActor,
    call: StaffCall,
    participantId: number,
    expectedVersion: number
  ) => {
    const [p] = await db
      .select()
      .from(staffCallParticipants)
      .where(
        and(
          eq(staffCallParticipants.callId, call.id),
          eq(staffCallParticipants.id, participantId)
        )
      )
      .limit(1)
      .for("update");
    if (!p) fail("NOT_FOUND", "Call participant not found");
    await scopeParticipants(db, actor, [p]);
    if (p.version !== expectedVersion)
      fail("CONFLICT", "Participant changed; reload before saving");
    return p;
  };
  const safeSummary = async (
    db: StaffCallDb,
    call: SummaryRow,
    safe: boolean,
    ownStatus?: "active" | "cancelled"
  ): Promise<StaffCallSummary> => {
    const [host] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, call.hostUserId))
      .limit(1);
    const status =
      safe && ownStatus === "cancelled" ? "cancelled" : call.status;
    return {
      id: call.id,
      hostUserId: call.hostUserId,
      hostName: host?.name ?? null,
      reasonKey: call.reasonKey,
      reasonExplanation: safe ? null : call.reasonExplanation,
      format: call.format,
      startAt: call.startAt,
      endAt: call.endAt,
      status,
      version: call.version,
      participantCount: safe ? 1 : Number(call.participantCount),
      meetingUrl: status === "booked" ? call.meetingUrl : null,
    };
  };
  const resolveParticipant = async (
    identity: StaffCallIdentity,
    hostUserId: number
  ) => {
    const db = await database();
    const [op] = await db
      .select()
      .from(staffCallOperations)
      .where(eq(staffCallOperations.requestId, identity.operationId))
      .limit(1);
    if (!op || op.callId !== identity.callId || op.state !== "pending")
      return null;
    const actor = await requireStaffCallActor(db, op.actorId, { manage: true });
    const call = await callFor(db, actor, identity.callId);
    if (
      call.hostUserId !== hostUserId ||
      call.activeOperationId !== op.id ||
      op.kind !== "book"
    )
      return null;
    await hostAuthority(db, actor, hostUserId);
    const [p] = await db
      .select()
      .from(staffCallParticipants)
      .where(
        and(
          eq(staffCallParticipants.id, identity.participantId),
          eq(staffCallParticipants.callId, identity.callId),
          eq(staffCallParticipants.status, "active")
        )
      )
      .limit(1);
    if (!p) return null;
    const [agent] = await exactAgents(db, [p.agentId], true);
    return { name: agent!.name!, email: agent!.email! };
  };
  const provider = deps.providerFactory
    ? deps.providerFactory(resolveParticipant)
    : new StaffCallsProvider({ resolveParticipant });
  const connection = async (hostUserId: number) => {
    const status = await provider.getConnectionStatus(hostUserId);
    return {
      connected: status.state === "READY",
      message:
        status.state === "READY"
          ? "Verified provider connection"
          : "Diary provider is not connected or verified",
    };
  };
  const checkedSlots = async (
    db: StaffCallDb,
    actor: StaffCallActor,
    input: z.infer<typeof staffCallAvailabilityInput>
  ) => {
    await hostAuthority(db, actor, input.hostUserId);
    await exactAgents(db, input.agentIds, true);
    const status = await provider.getConnectionStatus(input.hostUserId);
    if (input.format === "group" && !status.group.ready)
      return {
        connected: false,
        message: "Verified seated group provider connection is required",
        slots: [] as { startAt: Date; endAt: Date; capacity: number }[],
      };
    const result = await provider.getBookableSlots({
      hostUserId: input.hostUserId,
      kind: input.format === "group" ? "group" : "oneToOne",
      start: input.from.toISOString(),
      end: input.to.toISOString(),
    });
    if (!result.ok)
      return {
        connected: false,
        message: result.message,
        slots: [] as { startAt: Date; endAt: Date; capacity: number }[],
      };
    const slots = result.value
      .filter(
        s =>
          Number.isFinite(Date.parse(s.start)) &&
          Number.isFinite(Date.parse(s.end)) &&
          new Date(s.start) >= input.from &&
          new Date(s.end) <= input.to
      )
      .filter(
        s =>
          input.format !== "group" ||
          (!s.bookingUid &&
            (s.remainingSeats ?? 0) >= input.agentIds.length &&
            (s.remainingSeats ?? 0) === status.group.capacity)
      )
      .map(s => ({
        startAt: new Date(s.start),
        endAt: new Date(s.end),
        capacity: input.format === "group" ? (s.remainingSeats ?? 0) : 1,
      }));
    const reservations = await db
      .select({ startAt: staffCalls.startAt, endAt: staffCalls.endAt })
      .from(staffCalls)
      .where(
        and(
          eq(staffCalls.hostUserId, input.hostUserId),
          inArray(staffCalls.status, ["pending", "booked", "needs_recovery"]),
          lt(staffCalls.startAt, input.to),
          gt(staffCalls.endAt, input.from)
        )
      );
    reservations.push(...(await rescheduleReservations(db, input.hostUserId)));
    return {
      connected: true,
      message:
        "Provider-confirmed slots; availability is rechecked when booking",
      slots: slots.filter(
        s => !reservations.some(r => r.startAt < s.endAt && r.endAt > s.startAt)
      ),
    };
  };
  return {
    async context(actorId: number) {
      const db = await database();
      const actor = await requireStaffCallActor(db, actorId);
      return {
        actorId,
        canManage: actor.isAdmin || actor.engagement,
        canViewTeam: actor.isAdmin,
        reasons: STAFF_CALL_REASONS.map(r => ({ ...r })),
        provider:
          actor.isAdmin || actor.engagement
            ? await connection(actor.id)
            : {
                connected: false,
                message: "Bookings are managed by authorised staff",
              },
      };
    },
    async hosts(actorId: number) {
      const db = await database();
      const actor = await requireStaffCallActor(db, actorId, { manage: true });
      if (!actor.isAdmin) return [{ id: actor.id, name: actor.name }];
      const rows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          and(
            eq(users.isActive, true),
            eq(users.mustChangePassword, false),
            sql`NOT EXISTS (SELECT 1 FROM business_staff_memberships sc_b WHERE sc_b.staffUserId = ${users.id})`,
            sql`(${users.role} IN ('admin', 'super_admin') OR (${staffCallCurrentAgentFilter()} AND EXISTS (SELECT 1 FROM staff_role_assignments sc_grant WHERE sc_grant.userId = ${users.id} AND sc_grant.staffRole = 'agent_engagement' AND sc_grant.isActive = true)))`
          )
        )
        .orderBy(asc(users.id))
        .limit(500);
      return rows;
    },
    async agents(actorId: number, input: z.infer<typeof staffCallAgentsInput>) {
      const db = await database();
      await requireStaffCallActor(db, actorId, { manage: true });
      const rows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          and(
            staffCallCurrentAgentFilter(),
            input.cursor ? gt(users.id, input.cursor) : undefined,
            input.query
              ? like(users.name, `%${input.query.replace(/[\\%_]/g, "\\$&")}%`)
              : undefined
          )
        )
        .orderBy(asc(users.id))
        .limit(input.limit + 1);
      const items = rows.slice(0, input.limit);
      return {
        items,
        nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
      };
    },
    async diary(actorId: number, input: z.infer<typeof staffCallDiaryInput>) {
      const db = await database();
      const actor = await requireStaffCallActor(db, actorId, { manage: true });
      const host = input.hostUserId ?? (actor.isAdmin ? undefined : actor.id);
      if (host) await hostAuthority(db, actor, host);
      const rows = await db
        .select(summaryColumns)
        .from(staffCalls)
        .where(
          and(
            host ? eq(staffCalls.hostUserId, host) : undefined,
            lt(staffCalls.startAt, input.to),
            gt(staffCalls.endAt, input.from),
            input.cursor ? gt(staffCalls.id, input.cursor) : undefined
          )
        )
        .orderBy(asc(staffCalls.id))
        .limit(input.limit + 1);
      const items: StaffCallSummary[] = [];
      for (const r of rows.slice(0, input.limit)) {
        if (!actor.isAdmin)
          await scopeParticipants(db, actor, await participantsFor(db, r.id));
        items.push(await safeSummary(db, r, false));
      }
      return {
        items,
        nextCursor:
          rows.length > input.limit ? rows[input.limit - 1]!.id : null,
      };
    },
    async mine(actorId: number, input: z.infer<typeof staffCallWindowInput>) {
      const db = await database();
      await requireStaffCallActor(db, actorId);
      const rows = await db
        .select({
          ...summaryColumns,
          ownParticipantStatus: staffCallParticipants.status,
        })
        .from(staffCalls)
        .innerJoin(
          staffCallParticipants,
          and(
            eq(staffCallParticipants.callId, staffCalls.id),
            eq(staffCallParticipants.agentId, actorId)
          )
        )
        .where(
          and(
            lt(staffCalls.startAt, input.to),
            gt(staffCalls.endAt, input.from),
            input.cursor ? gt(staffCalls.id, input.cursor) : undefined
          )
        )
        .orderBy(asc(staffCalls.id))
        .limit(input.limit + 1);
      const items = await Promise.all(
        rows
          .slice(0, input.limit)
          .map(r => safeSummary(db, r, true, r.ownParticipantStatus))
      );
      return {
        actorId,
        items,
        nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
      };
    },
    async get(actorId: number, callId: number) {
      const db = await database();
      const actor = await requireStaffCallActor(db, actorId);
      const [call] = await db
        .select(summaryColumns)
        .from(staffCalls)
        .where(eq(staffCalls.id, callId))
        .limit(1);
      if (!call) fail("NOT_FOUND", "Call not found");
      const canManage =
        actor.isAdmin || (actor.engagement && call.hostUserId === actor.id);
      if (!canManage) {
        const [p] = await db
          .select({
            id: staffCallParticipants.id,
            agentId: staffCallParticipants.agentId,
            attendance: staffCallParticipants.attendance,
            sharedSummary: staffCallParticipants.sharedSummary,
            sharedAt: staffCallParticipants.sharedAt,
            status: staffCallParticipants.status,
            version: staffCallParticipants.version,
          })
          .from(staffCallParticipants)
          .where(
            and(
              eq(staffCallParticipants.callId, callId),
              eq(staffCallParticipants.agentId, actor.id)
            )
          )
          .limit(1);
        if (!p) fail("NOT_FOUND", "Call not found");
        const dto: StaffCallParticipantDto = {
          ...p,
          name: actor.name,
          sharedSummary: p.sharedAt ? p.sharedSummary : null,
        };
        return {
          call: await safeSummary(db, call, true, p.status),
          participants: [dto],
          history: [] as (typeof staffCallHistory.$inferSelect)[],
          followUps: [] as { planId: number; participantId: number }[],
        };
      }
      const ps = await participantsFor(db, callId);
      await scopeParticipants(db, actor, ps);
      const participants: StaffCallParticipantDto[] = [];
      for (const p of ps) {
        const [agent] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, p.agentId))
          .limit(1);
        participants.push({
          id: p.id,
          agentId: p.agentId,
          name: agent?.name ?? null,
          attendance: p.attendance,
          outcome: p.outcome,
          privateNotes: p.privateNotes,
          sharedSummary: p.sharedSummary,
          sharedAt: p.sharedAt,
          version: p.version,
          status: p.status,
        });
      }
      const revisions = await db
        .select()
        .from(staffCallHistory)
        .where(eq(staffCallHistory.callId, callId))
        .orderBy(desc(staffCallHistory.id))
        .limit(100);
      const followUps = await db
        .select({
          planId: staffCallActionSources.planId,
          participantId: staffCallActionSources.participantId,
        })
        .from(staffCallActionSources)
        .where(eq(staffCallActionSources.callId, callId))
        .limit(100);
      return {
        call: await safeSummary(db, call, false),
        participants,
        history: revisions,
        followUps,
      };
    },
    async availability(
      actorId: number,
      input: z.infer<typeof staffCallAvailabilityInput>
    ) {
      const db = await database();
      const actor = await requireStaffCallActor(db, actorId, { manage: true });
      return checkedSlots(db, actor, input);
    },
    async agentHistory(
      actorId: number,
      input: z.infer<typeof staffCallAgentHistoryInput>
    ) {
      const db = await database();
      await requireStaffCallActor(db, actorId, { admin: true });
      const columns = {
        ...summaryColumns,
        participantId: staffCallParticipants.id,
        attendance: staffCallParticipants.attendance,
        outcome: staffCallParticipants.outcome,
        privateNotes: staffCallParticipants.privateNotes,
        sharedSummary: staffCallParticipants.sharedSummary,
        sharedAt: staffCallParticipants.sharedAt,
      };
      const rows = await db
        .select(columns)
        .from(staffCalls)
        .innerJoin(
          staffCallParticipants,
          and(
            eq(staffCallParticipants.callId, staffCalls.id),
            eq(staffCallParticipants.agentId, input.agentId)
          )
        )
        .where(input.cursor ? lt(staffCalls.id, input.cursor) : undefined)
        .orderBy(desc(staffCalls.id))
        .limit(input.limit + 1);
      const items = await Promise.all(
        rows.slice(0, input.limit).map(async r => ({
          ...(await safeSummary(db, r, false)),
          participantId: r.participantId,
          attendance: r.attendance,
          outcome: r.outcome,
          privateNotes: r.privateNotes,
          sharedSummary: r.sharedSummary,
          sharedAt: r.sharedAt,
        }))
      );
      const [next] = await db
        .select(summaryColumns)
        .from(staffCalls)
        .innerJoin(
          staffCallParticipants,
          and(
            eq(staffCallParticipants.callId, staffCalls.id),
            eq(staffCallParticipants.agentId, input.agentId)
          )
        )
        .where(
          and(
            eq(staffCalls.status, "booked"),
            eq(staffCallParticipants.status, "active"),
            gt(staffCalls.startAt, now())
          )
        )
        .orderBy(asc(staffCalls.startAt), asc(staffCalls.id))
        .limit(1);
      return {
        items,
        nextCursor:
          rows.length > input.limit ? rows[input.limit - 1]!.id : null,
        nextCall: next ? await safeSummary(db, next, false) : null,
      };
    },
    async saveNotes(
      actorId: number,
      input: z.infer<typeof staffCallNotesInput>
    ) {
      const db = await database();
      return db.transaction(async tx => {
        const actor = await requireStaffCallActor(tx, actorId, {
          manage: true,
        });
        const call = await callFor(tx, actor, input.callId, true);
        if (call.endAt > now())
          fail(
            "PRECONDITION_FAILED",
            "Record manual attendance and notes after the call ends"
          );
        if (
          call.activeOperationId ||
          call.status === "pending" ||
          call.status === "needs_recovery"
        )
          fail(
            "CONFLICT",
            "Reconcile the provider operation before recording outcomes"
          );
        const p = await participantFor(
          tx,
          actor,
          call,
          input.participantId,
          input.expectedVersion
        );
        const after = {
          ...p,
          attendance: input.attendance,
          outcome: input.outcome,
          privateNotes: input.privateNotes,
          version: p.version + 1,
          updatedAt: now(),
        };
        await tx
          .update(staffCallParticipants)
          .set({
            attendance: after.attendance,
            outcome: after.outcome,
            privateNotes: after.privateNotes,
            version: after.version,
            updatedAt: after.updatedAt,
          })
          .where(
            and(
              eq(staffCallParticipants.id, p.id),
              eq(staffCallParticipants.version, p.version)
            )
          );
        await history(tx, call.id, actor.id, "notes.saved", p, after, p.id);
        return { participantId: p.id, version: after.version };
      });
    },
    async shareRecap(
      actorId: number,
      input: z.infer<typeof staffCallShareInput>
    ) {
      const db = await database();
      return db.transaction(async tx => {
        const actor = await requireStaffCallActor(tx, actorId, {
          manage: true,
        });
        const call = await callFor(tx, actor, input.callId, true);
        if (call.endAt > now())
          fail("PRECONDITION_FAILED", "Share a recap after the call ends");
        const p = await participantFor(
          tx,
          actor,
          call,
          input.participantId,
          input.expectedVersion
        );
        if (p.attendance === "awaiting" || !p.privateNotes)
          fail(
            "PRECONDITION_FAILED",
            "Record manual attendance and internal notes before sharing"
          );
        const sharedAt = now();
        const after = {
          ...p,
          sharedSummary: input.sharedSummary,
          sharedAt,
          version: p.version + 1,
          updatedAt: sharedAt,
        };
        await tx
          .update(staffCallParticipants)
          .set({
            sharedSummary: after.sharedSummary,
            sharedAt,
            version: after.version,
            updatedAt: sharedAt,
          })
          .where(
            and(
              eq(staffCallParticipants.id, p.id),
              eq(staffCallParticipants.version, p.version)
            )
          );
        await history(tx, call.id, actor.id, "recap.shared", p, after, p.id);
        return { participantId: p.id, version: after.version, sharedAt };
      });
    },
    async draftFollowUp(
      actorId: number,
      input: z.infer<typeof staffCallFollowUpInput>
    ) {
      const db = await database();
      return db.transaction(async tx => {
        const actor = await requireStaffCallActor(tx, actorId, {
          manage: true,
        });
        const call = await callFor(tx, actor, input.callId, true);
        if (call.endAt > now())
          fail("PRECONDITION_FAILED", "Create a follow-up after the call ends");
        const p = await participantFor(
          tx,
          actor,
          call,
          input.participantId,
          input.expectedVersion
        );
        await exactAgents(tx, [p.agentId]);
        if (!p.privateNotes || p.attendance === "awaiting")
          fail(
            "PRECONDITION_FAILED",
            "Record manual attendance and notes first"
          );
        const [created] = await tx
          .insert(academyActionPlans)
          .values({
            title: input.title,
            instructions: input.instructions,
            dueAt: input.dueAt ?? null,
            actionType: "ad_hoc",
            audience: "selected_agents",
            assignmentTrigger: "immediate",
            status: "draft",
            courseId: null,
            courseWeek: null,
            requiresNote: input.requiresNote,
            requiresUrl: input.requiresUrl,
            requiresUpload: input.requiresUpload,
            staffReviewRequired: input.staffReviewRequired,
            momentumAwardMode: "off",
            momentumPoints: 0,
            createdById: actor.id,
            updatedById: actor.id,
          })
          .$returningId();
        await tx
          .insert(academyActionPlanTargets)
          .values({ planId: created!.id, agentId: p.agentId });
        await tx.insert(staffCallActionSources).values({
          callId: call.id,
          participantId: p.id,
          planId: created!.id,
          createdById: actor.id,
        });
        const after = { ...p, version: p.version + 1, updatedAt: now() };
        await tx
          .update(staffCallParticipants)
          .set({ version: after.version, updatedAt: after.updatedAt })
          .where(eq(staffCallParticipants.id, p.id));
        await history(
          tx,
          call.id,
          actor.id,
          "follow_up.drafted",
          p,
          { ...after, planId: created!.id },
          p.id
        );
        return { planId: created!.id, status: "draft" as const };
      });
    },
    ...createProviderOperations({
      database,
      now,
      provider,
      history,
      exactAgents,
      hostAuthority,
      callFor,
      participantsFor,
      scopeParticipants,
      checkedSlots,
    }),
  };
}

interface OperationDependencies {
  database: () => Promise<Database>;
  now: () => Date;
  provider: StaffCallsProvider;
  history: (
    db: StaffCallDb,
    callId: number,
    actorId: number | null,
    action: string,
    before: unknown,
    after: unknown,
    participantId?: number | null
  ) => Promise<void>;
  exactAgents: (
    db: StaffCallDb,
    ids: number[],
    requireIdentity?: boolean
  ) => Promise<{ id: number; name: string | null; email: string | null }[]>;
  hostAuthority: (
    db: StaffCallDb,
    actor: StaffCallActor,
    hostId: number
  ) => Promise<StaffCallActor>;
  callFor: (
    db: StaffCallDb,
    actor: StaffCallActor,
    callId: number,
    locked?: boolean
  ) => Promise<StaffCall>;
  participantsFor: (
    db: StaffCallDb,
    callId: number,
    activeOnly?: boolean
  ) => Promise<StaffCallParticipant[]>;
  scopeParticipants: (
    db: StaffCallDb,
    actor: StaffCallActor,
    ps: { agentId: number }[]
  ) => Promise<void>;
  checkedSlots: (
    db: StaffCallDb,
    actor: StaffCallActor,
    input: z.infer<typeof staffCallAvailabilityInput>
  ) => Promise<{
    connected: boolean;
    message: string;
    slots: { startAt: Date; endAt: Date; capacity: number }[];
  }>;
}
function createProviderOperations(d: OperationDependencies) {
  const resultFor = (
    operation: StaffCallOperation,
    call: StaffCall
  ): StaffCallOperationResult => ({
    requestId: operation.requestId,
    callId: call.id,
    state: operation.state,
    status: call.status,
    message: operation.lastError,
  });
  const replay = async (
    db: StaffCallDb,
    actor: StaffCallActor,
    requestId: string,
    hash: string,
    locked = false
  ) => {
    const query = db
      .select()
      .from(staffCallOperations)
      .where(eq(staffCallOperations.requestId, requestId))
      .limit(1);
    const [op] = await (locked ? query.for("update") : query);
    if (!op) return null;
    if (op.actorId !== actor.id || op.payloadHash !== hash)
      fail(
        "CONFLICT",
        "Request identity was already used for a different operation"
      );
    const call = await d.callFor(db, actor, op.callId);
    await d.scopeParticipants(db, actor, await d.participantsFor(db, call.id));
    return resultFor(op, call);
  };
  const bookingIdentity = async (
    db: StaffCallDb,
    call: StaffCall,
    p: StaffCallParticipant
  ): Promise<StaffCallLink> => {
    const [original] = await db
      .select()
      .from(staffCallOperations)
      .where(
        and(
          eq(staffCallOperations.callId, call.id),
          eq(staffCallOperations.kind, "book")
        )
      )
      .orderBy(asc(staffCallOperations.id))
      .limit(1);
    if (
      !original ||
      !call.providerBookingUid ||
      (call.format === "group" && !p.providerSeatUid)
    )
      fail(
        "PRECONDITION_FAILED",
        "Provider linkage is not verified; reconcile first"
      );
    const proof =
      call.format === "group"
        ? groupProof(await d.participantsFor(db, call.id))
        : {};
    return {
      hostUserId: call.hostUserId,
      kind: call.format === "group" ? "group" : "oneToOne",
      callId: call.id,
      participantId: p.id,
      operationId: original.requestId,
      bookingUid: call.providerBookingUid,
      ...proof,
      ...(p.providerSeatUid ? { seatUid: p.providerSeatUid } : {}),
    };
  };
  const localAvailability = async (
    db: StaffCallDb,
    hostUserId: number,
    startAt: Date,
    endAt: Date,
    excludeCallId?: number
  ) => {
    const reservations = await db
      .select({ id: staffCalls.id })
      .from(staffCalls)
      .where(
        and(
          eq(staffCalls.hostUserId, hostUserId),
          inArray(staffCalls.status, ["pending", "booked", "needs_recovery"]),
          lt(staffCalls.startAt, endAt),
          gt(staffCalls.endAt, startAt),
          excludeCallId ? sql`${staffCalls.id} <> ${excludeCallId}` : undefined
        )
      )
      .limit(1);
    const destinations = await rescheduleReservations(
      db,
      hostUserId,
      excludeCallId
    );
    if (
      reservations.length ||
      destinations.some(r => r.startAt < endAt && r.endAt > startAt)
    )
      fail(
        "CONFLICT",
        "The diary has another booking or unresolved request in this interval"
      );
  };
  const markResult = async (
    actorId: number,
    requestId: string,
    response: StaffProviderResult<StaffCallBooking>,
    recovery = false
  ): Promise<StaffCallOperationResult> => {
    const db = await d.database();
    return db.transaction(async tx => {
      const actor = await requireStaffCallActor(tx, actorId, { manage: true });
      const [operation] = await tx
        .select()
        .from(staffCallOperations)
        .where(eq(staffCallOperations.requestId, requestId))
        .limit(1)
        .for("update");
      if (!operation || operation.actorId !== actor.id)
        fail("NOT_FOUND", "Diary operation not found");
      const call = await d.callFor(tx, actor, operation.callId, true);
      if (operation.state === "succeeded" || operation.state === "failed")
        return resultFor(operation, call);
      if (call.activeOperationId !== operation.id)
        fail("CONFLICT", "A different operation is active");
      const ps = await d.participantsFor(tx, call.id);
      await d.scopeParticipants(tx, actor, ps);
      const payload = operation.payload as any;
      let accepted = response.ok;
      let uncertain = !response.ok && (response.uncertain || recovery);
      let message: string | null = !response.ok ? response.message : null;
      const booking = response.ok ? response.value : null;
      const expectedParticipant = operation.participantId ?? ps[0]?.id;
      if (
        booking &&
        (booking.callId !== call.id ||
          booking.participantId !== expectedParticipant ||
          booking.hostUserId !== call.hostUserId ||
          booking.kind !== (call.format === "group" ? "group" : "oneToOne") ||
          !booking.bookingUid ||
          (call.format === "group" && !booking.seatUid))
      ) {
        accepted = false;
        uncertain = true;
        message = "Provider identity could not be verified";
      }
      if (
        booking &&
        operation.kind === "book" &&
        booking.operationId !== operation.requestId
      ) {
        accepted = false;
        uncertain = true;
        message = "Provider operation metadata did not match";
      }
      if (
        booking &&
        ["book", "reschedule"].includes(operation.kind) &&
        (new Date(booking.start).getTime() !==
          new Date(payload.startAt).getTime() ||
          new Date(booking.end).getTime() !== new Date(payload.endAt).getTime())
      ) {
        accepted = false;
        uncertain = true;
        message = "Provider times did not match the exact request";
      }
      if (
        booking &&
        ["book", "reschedule"].includes(operation.kind) &&
        booking.status !== "accepted"
      ) {
        accepted = false;
        uncertain = true;
        message = "Provider booking has not been accepted";
      }
      if (
        booking &&
        ["cancel", "cancel_participant"].includes(operation.kind) &&
        booking.status !== "cancelled"
      ) {
        accepted = false;
        uncertain = true;
        message = "Cancellation has not been confirmed";
      }
      const state: StaffCallOperation["state"] = accepted
        ? "succeeded"
        : uncertain
          ? "needs_recovery"
          : "failed";
      const timestamp = d.now();
      const after: StaffCall = {
        ...call,
        version: call.version + 1,
        updatedAt: timestamp,
        status: accepted
          ? operation.kind === "cancel"
            ? "cancelled"
            : operation.kind === "cancel_participant"
              ? ((payload.beforeCall as StaffCall | undefined)?.status ??
                "booked")
              : "booked"
          : uncertain
            ? "needs_recovery"
            : operation.kind === "book"
              ? "cancelled"
              : ((payload.beforeCall as StaffCall | undefined)?.status ??
                "booked"),
        activeOperationId: uncertain ? operation.id : null,
      };
      if (
        accepted &&
        booking &&
        ["book", "reschedule"].includes(operation.kind)
      ) {
        after.providerBookingUid = booking.bookingUid;
        after.providerBookingId = String(booking.providerBookingId);
        after.providerEventTypeId = String(booking.eventTypeId);
        after.providerHostId = String(booking.providerHostUserId);
        after.meetingUrl = booking.meetingUrl;
        after.startAt = new Date(booking.start);
        after.endAt = new Date(booking.end);
        after.bookedAt = call.bookedAt ?? timestamp;
      }
      await tx
        .update(staffCalls)
        .set({
          status: after.status,
          version: after.version,
          updatedAt: after.updatedAt,
          activeOperationId: after.activeOperationId,
          providerBookingUid: after.providerBookingUid,
          providerBookingId: after.providerBookingId,
          providerEventTypeId: after.providerEventTypeId,
          providerHostId: after.providerHostId,
          meetingUrl: after.meetingUrl,
          startAt: after.startAt,
          endAt: after.endAt,
          bookedAt: after.bookedAt,
        })
        .where(eq(staffCalls.id, call.id));
      if (accepted) {
        for (const p of ps) {
          if (
            operation.kind === "cancel_participant" &&
            p.id !== operation.participantId
          )
            continue;
          if (operation.kind === "reschedule" && p.status !== "active")
            continue;
          const pa = {
            ...p,
            version: p.version + 1,
            updatedAt: timestamp,
            status:
              operation.kind === "cancel" ||
              operation.kind === "cancel_participant"
                ? ("cancelled" as const)
                : p.status,
            bookedAt: ["book", "reschedule"].includes(operation.kind)
              ? (p.bookedAt ?? timestamp)
              : p.bookedAt,
            providerSeatUid: booking?.seatUid ?? p.providerSeatUid,
          };
          await tx
            .update(staffCallParticipants)
            .set({
              version: pa.version,
              updatedAt: timestamp,
              status: pa.status,
              bookedAt: pa.bookedAt,
              providerSeatUid: pa.providerSeatUid,
            })
            .where(eq(staffCallParticipants.id, p.id));
          await d.history(
            tx,
            call.id,
            actor.id,
            `${operation.kind}.participant_confirmed`,
            p,
            pa,
            p.id
          );
        }
      }
      const opAfter = {
        ...operation,
        state,
        lastError: message,
        result: booking ? snapshot(booking) : null,
        updatedAt: timestamp,
      };
      await tx
        .update(staffCallOperations)
        .set({
          state,
          lastError: message,
          result: opAfter.result,
          updatedAt: timestamp,
        })
        .where(eq(staffCallOperations.id, operation.id));
      await d.history(
        tx,
        call.id,
        actor.id,
        `${operation.kind}.${state}`,
        call,
        after,
        operation.participantId
      );
      return resultFor(opAfter, after);
    });
  };
  const authorizeDispatch = async (
    actorId: number,
    requestId: string,
    participantId?: number,
    expectedLink?: StaffCallLink
  ) => {
    const db = await d.database();
    const actor = await requireStaffCallActor(db, actorId, { manage: true });
    const [op] = await db
      .select()
      .from(staffCallOperations)
      .where(eq(staffCallOperations.requestId, requestId))
      .limit(1);
    if (!op || op.actorId !== actor.id || op.state !== "pending")
      fail("CONFLICT", "The operation is not an active pending request");
    const call = await d.callFor(db, actor, op.callId);
    if (
      call.activeOperationId !== op.id ||
      call.status !== (op.kind === "book" ? "pending" : "booked")
    )
      fail(
        "CONFLICT",
        "A different operation or recovery state owns this call"
      );
    await d.hostAuthority(db, actor, call.hostUserId);
    const ps = await d.participantsFor(db, call.id);
    const active = ps.filter(p => p.status === "active");
    await d.exactAgents(
      db,
      active.map(p => p.agentId),
      true
    );
    const p = participantId
      ? active.find(p => p.id === participantId)
      : op.participantId
        ? active.find(p => p.id === op.participantId)
        : active[0];
    if (!p) fail("CONFLICT", "The exact active participant changed");
    const payload = op.payload as any;
    if (op.kind === "book") {
      if (
        call.hostUserId !== payload.hostUserId ||
        active.length !== payload.agentIds?.length ||
        active.some(p => !payload.agentIds.includes(p.agentId))
      )
        fail("CONFLICT", "Booking identities changed");
    } else {
      const current = await bookingIdentity(db, call, p);
      const retained =
        (payload.links as StaffCallLink[] | undefined)?.find(
          l => l.participantId === p.id
        ) ?? payload.link;
      const same = (l: StaffCallLink | undefined) =>
        l &&
        l.callId === current.callId &&
        l.hostUserId === current.hostUserId &&
        l.kind === current.kind &&
        l.participantId === current.participantId &&
        l.operationId === current.operationId &&
        l.bookingUid === current.bookingUid &&
        l.seatUid === current.seatUid;
      if (op.participantId && op.participantId !== p.id)
        fail("CONFLICT", "The operation targets a different participant");
      if (!same(retained) || (expectedLink && !same(expectedLink)))
        fail("CONFLICT", "The exact provider linkage changed");
    }
    return { op, call, p, ps };
  };
  const dispatch = async (
    actorId: number,
    requestId: string,
    action: (
      guard: StaffCallWriteGuard
    ) => Promise<StaffProviderResult<StaffCallBooking>>,
    expectedLink?: StaffCallLink,
    participantId?: number
  ) => {
    // Deliberately outside the provider catch: revocation denies dispatch and leaves the safe ledger unresolved.
    await authorizeDispatch(
      actorId,
      requestId,
      participantId ?? expectedLink?.participantId,
      expectedLink
    );
    let authorityFailure: { error: unknown } | undefined;
    const guard: StaffCallWriteGuard = async () => {
      try {
        await authorizeDispatch(
          actorId,
          requestId,
          participantId ?? expectedLink?.participantId,
          expectedLink
        );
      } catch (error) {
        authorityFailure = { error };
        throw error;
      }
    };
    let result: StaffProviderResult<StaffCallBooking>;
    try {
      result = await action(guard);
    } catch {
      // Final-preflight authority denial is not a transport uncertainty or a business edit.
      if (authorityFailure) throw authorityFailure.error;
      result = {
        ok: false,
        code: "UNCERTAIN",
        message:
          "Provider operation may have completed; reconcile before retrying",
        uncertain: true,
      };
    }
    return markResult(actorId, requestId, result);
  };
  const insertOperation = async (
    tx: StaffCallDb,
    actor: StaffCallActor,
    call: StaffCall,
    requestId: string,
    kind: StaffCallOperation["kind"],
    payload: unknown,
    hash: string,
    participantId: number | null = null
  ) => {
    const [created] = await tx
      .insert(staffCallOperations)
      .values({
        requestId,
        actorId: actor.id,
        payloadHash: hash,
        kind,
        callId: call.id,
        participantId,
        payload: snapshot(payload),
        state: "pending",
        createdAt: d.now(),
        updatedAt: d.now(),
      })
      .$returningId();
    const after = {
      ...call,
      activeOperationId: created!.id,
      version: call.version + 1,
      updatedAt: d.now(),
    };
    await tx
      .update(staffCalls)
      .set({
        activeOperationId: after.activeOperationId,
        version: after.version,
        updatedAt: after.updatedAt,
      })
      .where(eq(staffCalls.id, call.id));
    await d.history(
      tx,
      call.id,
      actor.id,
      `${kind}.pending`,
      call,
      after,
      participantId
    );
    return created!.id;
  };
  const saveGroupSeat = async (
    actorId: number,
    requestId: string,
    booking: StaffCallBooking
  ): Promise<boolean> => {
    const db = await d.database();
    return db.transaction(async tx => {
      const actor = await requireStaffCallActor(tx, actorId, { manage: true });
      const [op] = await tx
        .select()
        .from(staffCallOperations)
        .where(eq(staffCallOperations.requestId, requestId))
        .limit(1)
        .for("update");
      if (
        !op ||
        op.actorId !== actor.id ||
        !["pending", "needs_recovery"].includes(op.state)
      )
        fail("CONFLICT", "Group operation changed");
      const call = await d.callFor(tx, actor, op.callId, true);
      const ps = await d.participantsFor(tx, call.id);
      await d.scopeParticipants(tx, actor, ps);
      if (call.activeOperationId !== op.id)
        fail("CONFLICT", "A different operation owns the group call");
      const p = ps.find(p => p.id === booking.participantId);
      if (
        !p ||
        booking.callId !== call.id ||
        booking.hostUserId !== call.hostUserId ||
        booking.kind !== "group" ||
        !booking.seatUid
      )
        fail("CONFLICT", "Exact group seat could not be verified");
      const payload = op.payload as any;
      const existing = (op.result as any)?.seats ?? {};
      const prior = Object.values(existing) as StaffCallBooking[];
      const same = prior.every(
        b =>
          b.participantId === booking.participantId ||
          (b.bookingUid === booking.bookingUid &&
            b.start === booking.start &&
            b.end === booking.end &&
            b.seatUid !== booking.seatUid)
      );
      const timeMatch =
        !["book", "reschedule"].includes(op.kind) ||
        (new Date(booking.start).getTime() ===
          new Date(payload.startAt).getTime() &&
          new Date(booking.end).getTime() ===
            new Date(payload.endAt).getTime());
      const expectedStatus = ["cancel", "cancel_participant"].includes(op.kind)
        ? "cancelled"
        : "accepted";
      const valid =
        booking.status === expectedStatus &&
        timeMatch &&
        same &&
        (op.kind !== "book" || booking.operationId === op.requestId);
      if (
        existing[String(p.id)] &&
        staffCallPayloadHash(existing[String(p.id)]) ===
          staffCallPayloadHash(booking)
      )
        return valid;
      const ts = d.now();
      const after = {
        ...p,
        providerSeatUid: booking.seatUid,
        bookedAt:
          booking.status === "accepted" ? (p.bookedAt ?? ts) : p.bookedAt,
        status:
          booking.status === "cancelled" ? ("cancelled" as const) : p.status,
        version: p.version + 1,
        updatedAt: ts,
      };
      await tx
        .update(staffCallParticipants)
        .set({
          providerSeatUid: after.providerSeatUid,
          bookedAt: after.bookedAt,
          status: after.status,
          version: after.version,
          updatedAt: ts,
        })
        .where(eq(staffCallParticipants.id, p.id));
      await d.history(
        tx,
        call.id,
        actor.id,
        `${op.kind}.seat_confirmed`,
        p,
        after,
        p.id
      );
      const seats = { ...existing, [String(p.id)]: snapshot(booking) };
      await tx
        .update(staffCallOperations)
        .set({
          result: { ...((op.result as any) ?? {}), seats },
          updatedAt: ts,
        })
        .where(eq(staffCallOperations.id, op.id));
      // Save the first known UID immediately, including uncertain partial acceptance.
      if (!call.providerBookingUid) {
        const ca = {
          ...call,
          providerBookingUid: booking.bookingUid,
          providerBookingId: String(booking.providerBookingId),
          providerEventTypeId: String(booking.eventTypeId),
          providerHostId: String(booking.providerHostUserId),
          meetingUrl: booking.meetingUrl,
          version: call.version + 1,
          updatedAt: ts,
        };
        await tx
          .update(staffCalls)
          .set({
            providerBookingUid: ca.providerBookingUid,
            providerBookingId: ca.providerBookingId,
            providerEventTypeId: ca.providerEventTypeId,
            providerHostId: ca.providerHostId,
            meetingUrl: ca.meetingUrl,
            version: ca.version,
            updatedAt: ts,
          })
          .where(eq(staffCalls.id, call.id));
        await d.history(
          tx,
          call.id,
          actor.id,
          "provider.group_linked",
          call,
          ca
        );
      }
      return valid;
    });
  };
  const finishGroup = async (
    actorId: number,
    requestId: string,
    message: string | null = null
  ): Promise<StaffCallOperationResult> => {
    const db = await d.database();
    return db.transaction(async tx => {
      const actor = await requireStaffCallActor(tx, actorId, { manage: true });
      const [op] = await tx
        .select()
        .from(staffCallOperations)
        .where(eq(staffCallOperations.requestId, requestId))
        .limit(1)
        .for("update");
      if (!op || op.actorId !== actor.id)
        fail("NOT_FOUND", "Group operation not found");
      const call = await d.callFor(tx, actor, op.callId, true);
      if (op.state === "succeeded" || op.state === "failed")
        return resultFor(op, call);
      if (call.activeOperationId !== op.id)
        fail("CONFLICT", "A different operation owns the group call");
      const ps = await d.participantsFor(tx, call.id);
      await d.scopeParticipants(tx, actor, ps);
      const payload = op.payload as any;
      const seats = ((op.result as any)?.seats ?? {}) as Record<
        string,
        StaffCallBooking
      >;
      const targets = op.participantId
        ? ps.filter(p => p.id === op.participantId)
        : op.kind === "book"
          ? ps
          : ps.filter(p =>
              ((payload.links as StaffCallLink[]) ?? []).some(
                l => l.participantId === p.id
              )
            );
      const readings = targets.map(p => seats[String(p.id)]).filter(Boolean);
      const first = readings[0];
      const expectedStatus = ["cancel", "cancel_participant"].includes(op.kind)
        ? "cancelled"
        : "accepted";
      const complete =
        targets.length > 0 &&
        readings.length === targets.length &&
        new Set(readings.map(b => b.seatUid)).size === targets.length &&
        readings.every(
          b =>
            b.status === expectedStatus &&
            b.bookingUid === first!.bookingUid &&
            b.start === first!.start &&
            b.end === first!.end &&
            (!["book", "reschedule"].includes(op.kind) ||
              (new Date(b.start).getTime() ===
                new Date(payload.startAt).getTime() &&
                new Date(b.end).getTime() ===
                  new Date(payload.endAt).getTime()))
        );
      const state = complete
        ? ("succeeded" as const)
        : ("needs_recovery" as const);
      const ts = d.now();
      const after = {
        ...call,
        status: complete
          ? op.kind === "cancel"
            ? ("cancelled" as const)
            : ("booked" as const)
          : ("needs_recovery" as const),
        activeOperationId: complete ? null : op.id,
        version: call.version + 1,
        updatedAt: ts,
        bookedAt:
          complete && ["book", "reschedule"].includes(op.kind)
            ? (call.bookedAt ?? ts)
            : call.bookedAt,
        providerBookingUid:
          complete && first ? first.bookingUid : call.providerBookingUid,
        meetingUrl: complete && first ? first.meetingUrl : call.meetingUrl,
        startAt:
          complete && ["book", "reschedule"].includes(op.kind)
            ? new Date(first!.start)
            : call.startAt,
        endAt:
          complete && ["book", "reschedule"].includes(op.kind)
            ? new Date(first!.end)
            : call.endAt,
      };
      await tx
        .update(staffCalls)
        .set({
          status: after.status,
          activeOperationId: after.activeOperationId,
          version: after.version,
          updatedAt: ts,
          bookedAt: after.bookedAt,
          providerBookingUid: after.providerBookingUid,
          meetingUrl: after.meetingUrl,
          startAt: after.startAt,
          endAt: after.endAt,
        })
        .where(eq(staffCalls.id, call.id));
      const lastError = complete
        ? null
        : (message ??
          "Group operation has unconfirmed or inconsistent seats; reconcile exact metadata before any further write");
      await tx
        .update(staffCallOperations)
        .set({ state, lastError, updatedAt: ts })
        .where(eq(staffCallOperations.id, op.id));
      await d.history(
        tx,
        call.id,
        actor.id,
        `${op.kind}.${state}`,
        call,
        after,
        op.participantId
      );
      return resultFor({ ...op, state, lastError }, after);
    });
  };
  const dispatchGroup = async (
    actorId: number,
    requestId: string
  ): Promise<StaffCallOperationResult> => {
    const db = await d.database();
    const actor = await requireStaffCallActor(db, actorId, { manage: true });
    const [op] = await db
      .select()
      .from(staffCallOperations)
      .where(eq(staffCallOperations.requestId, requestId))
      .limit(1);
    if (!op || op.actorId !== actor.id || op.state !== "pending")
      fail("CONFLICT", "Group request must be reconciled, not retried");
    const call = await d.callFor(db, actor, op.callId);
    const payload = op.payload as any;
    const ps = await d.participantsFor(db, call.id);
    const targets = op.participantId
      ? ps.filter(p => p.id === op.participantId)
      : op.kind === "book"
        ? ps
        : ps.filter(p => p.status === "active");
    const deadline = Date.now() + 90_000;
    for (const p of targets) {
      if (Date.now() >= deadline)
        return finishGroup(
          actorId,
          requestId,
          "Group dispatch deadline reached; exact partial progress retained for read-only recovery"
        );
      const link =
        op.kind === "book"
          ? undefined
          : (payload.links as StaffCallLink[]).find(
              l => l.participantId === p.id
            );
      const authorized = await authorizeDispatch(
        actorId,
        requestId,
        p.id,
        link
      );
      const proof = groupProof(authorized.ps);
      let authorityFailure: { error: unknown } | undefined;
      const guard: StaffCallWriteGuard = async () => {
        try {
          await authorizeDispatch(actorId, requestId, p.id, link);
        } catch (error) {
          authorityFailure = { error };
          throw error;
        }
      };
      let response: StaffProviderResult<StaffCallBooking>;
      try {
        if (op.kind === "book") {
          const [latest] = await db
            .select()
            .from(staffCallOperations)
            .where(eq(staffCallOperations.id, op.id))
            .limit(1);
          const confirmed = Object.values(
            (latest?.result as any)?.seats ?? {}
          ) as StaffCallBooking[];
          response = await d.provider.createBooking(
            {
              hostUserId: call.hostUserId,
              kind: "group",
              callId: call.id,
              participantId: p.id,
              operationId: op.requestId,
              ...proof,
              start: new Date(payload.startAt).toISOString(),
              ...(confirmed[0]
                ? { expectedBookingUid: confirmed[0].bookingUid }
                : {}),
            },
            guard
          );
        } else {
          if (!link)
            return finishGroup(
              actorId,
              requestId,
              "Exact retained seat linkage is missing"
            );
          const exact = { ...link, ...proof };
          response =
            op.kind === "reschedule"
              ? await d.provider.rescheduleBooking(
                  exact,
                  new Date(payload.startAt).toISOString(),
                  guard
                )
              : await d.provider.cancelBooking(exact, "seat", guard);
        }
      } catch {
        if (authorityFailure) throw authorityFailure.error;
        response = {
          ok: false,
          code: "UNCERTAIN",
          message: "Provider group operation may have completed",
          uncertain: true,
        };
      }
      if (!response.ok)
        return finishGroup(actorId, requestId, response.message);
      if (!(await saveGroupSeat(actorId, requestId, response.value)))
        return finishGroup(
          actorId,
          requestId,
          "Group response contains pending or inconsistent seat identities; no further seat writes sent"
        );
    }
    return finishGroup(actorId, requestId);
  };
  const reconcileGroup = async (
    actorId: number,
    op: StaffCallOperation,
    call: StaffCall,
    ps: StaffCallParticipant[]
  ): Promise<StaffCallOperationResult> => {
    const payload = op.payload as any;
    const targets = op.participantId
      ? ps.filter(p => p.id === op.participantId)
      : op.kind === "book"
        ? ps
        : ps.filter(p =>
            ((payload.links as StaffCallLink[]) ?? []).some(
              l => l.participantId === p.id
            )
          );
    const offset =
      Number((op.result as any)?.reconcileCursor ?? 0) %
      Math.max(1, targets.length);
    const ordered = [...targets.slice(offset), ...targets.slice(0, offset)];
    for (const p of ordered) {
      let response: StaffProviderResult<StaffCallBooking> | null = null;
      const db = await d.database();
      const proof = groupProof(await d.participantsFor(db, call.id));
      try {
        if (op.kind === "book" || op.kind === "reschedule") {
          const link =
            op.kind === "book"
              ? {
                  hostUserId: call.hostUserId,
                  kind: "group" as const,
                  callId: call.id,
                  participantId: p.id,
                  operationId: op.requestId,
                }
              : (payload.links as StaffCallLink[]).find(
                  l => l.participantId === p.id
                );
          if (!link) continue;
          const scan = await d.provider.reconcileOperation({
            ...link,
            ...proof,
            start: new Date(payload.startAt).toISOString(),
            end: new Date(payload.endAt).toISOString(),
          });
          if (
            scan.ok &&
            scan.value.complete &&
            scan.value.bookings.length === 1
          )
            response = { ok: true, value: scan.value.bookings[0]! };
        } else {
          const link = (payload.links as StaffCallLink[]).find(
            l => l.participantId === p.id
          );
          if (link)
            response = await d.provider.getBooking({ ...link, ...proof });
        }
      } catch {
        break;
      }
      if (response?.ok)
        await saveGroupSeat(actorId, op.requestId, response.value);
      await db.transaction(async tx => {
        const [latest] = await tx
          .select()
          .from(staffCallOperations)
          .where(eq(staffCallOperations.id, op.id))
          .limit(1)
          .for("update");
        if (latest && ["pending", "needs_recovery"].includes(latest.state))
          await tx
            .update(staffCallOperations)
            .set({
              result: {
                ...((latest.result as any) ?? {}),
                reconcileCursor:
                  (targets.findIndex(t => t.id === p.id) + 1) % targets.length,
              },
              updatedAt: d.now(),
            })
            .where(eq(staffCallOperations.id, op.id));
      });
    }
    return finishGroup(actorId, op.requestId);
  };
  const change = async (
    actorId: number,
    kind: "reschedule" | "cancel" | "cancel_participant",
    input:
      | z.infer<typeof staffCallRescheduleInput>
      | z.infer<typeof staffCallCancelInput>
      | z.infer<typeof staffCallCancelParticipantInput>
  ) => {
    const db = await d.database();
    const actor = await requireStaffCallActor(db, actorId, { manage: true });
    const hash = staffCallPayloadHash({ kind, ...input });
    const previous = await replay(db, actor, input.requestId, hash);
    if (previous) return previous;
    const call = await d.callFor(db, actor, input.callId);
    const ps = await d.participantsFor(db, call.id, true);
    await d.scopeParticipants(db, actor, ps);
    await d.exactAgents(
      db,
      ps.map(p => p.agentId),
      true
    );
    await d.hostAuthority(db, actor, call.hostUserId);
    if (
      call.version !== input.expectedVersion ||
      call.activeOperationId ||
      call.status !== "booked"
    )
      fail(
        "CONFLICT",
        "Call changed or requires recovery; reload before continuing"
      );

    const participantId = "participantId" in input ? input.participantId : null;
    const p = participantId ? ps.find(p => p.id === participantId) : ps[0];
    if (!p) fail("NOT_FOUND", "Active participant not found");
    if (kind === "cancel_participant" && call.format !== "group")
      fail("BAD_REQUEST", "Use whole-call cancellation for a one-to-one call");
    const link = await bookingIdentity(db, call, p);
    if (kind === "reschedule") {
      const moving = input as z.infer<typeof staffCallRescheduleInput>;
      if (moving.startAt <= d.now())
        fail("BAD_REQUEST", "Choose a future provider-confirmed slot");
      const slots = await d.provider.getBookableSlots({
        hostUserId: call.hostUserId,
        kind: link.kind,
        start: moving.startAt.toISOString(),
        end: moving.endAt.toISOString(),
      });
      if (
        !slots.ok ||
        !slots.value.some(
          s =>
            new Date(s.start).getTime() === moving.startAt.getTime() &&
            new Date(s.end).getTime() === moving.endAt.getTime() &&
            (call.format !== "group" ||
              (!s.bookingUid && (s.remainingSeats ?? 0) >= ps.length))
        )
      )
        fail("PRECONDITION_FAILED", "The new slot is not provider-confirmed");
      await localAvailability(
        db,
        call.hostUserId,
        moving.startAt,
        moving.endAt,
        call.id
      );
    }
    const prepared = await db.transaction(
      async tx => {
        const fresh = await requireStaffCallActor(tx, actorId, {
          manage: true,
        });
        await d.hostAuthority(tx, fresh, call.hostUserId);
        // Host row serializes operations across overlapping bookings, even on empty diaries.
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, call.hostUserId))
          .limit(1)
          .for("update");
        const currentActor = await requireStaffCallActor(tx, actorId, {
          manage: true,
        });
        await d.hostAuthority(tx, currentActor, call.hostUserId);
        const again = await replay(
          tx,
          currentActor,
          input.requestId,
          hash,
          true
        );
        if (again) return again;
        const locked = await d.callFor(tx, fresh, call.id, true);
        if (
          locked.version !== input.expectedVersion ||
          locked.activeOperationId ||
          locked.status !== "booked"
        )
          fail("CONFLICT", "Call changed; reload before continuing");
        const current = await d.participantsFor(tx, locked.id, true);
        await d.scopeParticipants(tx, fresh, current);
        await d.exactAgents(
          tx,
          current.map(p => p.agentId),
          true
        );
        if (kind === "reschedule") {
          const moving = input as z.infer<typeof staffCallRescheduleInput>;
          await localAvailability(
            tx,
            call.hostUserId,
            moving.startAt,
            moving.endAt,
            call.id
          );
        }
        const links = await Promise.all(
          current.map(p => bookingIdentity(tx, locked, p))
        );
        await insertOperation(
          tx,
          fresh,
          locked,
          input.requestId,
          kind,
          { ...input, beforeCall: locked, link, links },
          hash,
          participantId
        );
      },
      { isolationLevel: "read committed" }
    );
    if (prepared) return prepared;
    if (call.format === "group") return dispatchGroup(actorId, input.requestId);
    return dispatch(
      actorId,
      input.requestId,
      guard =>
        kind === "reschedule"
          ? d.provider.rescheduleBooking(
              link,
              (
                input as z.infer<typeof staffCallRescheduleInput>
              ).startAt.toISOString(),
              guard
            )
          : d.provider.cancelBooking(
              link,
              kind === "cancel_participant" ? "seat" : "meeting",
              guard
            ),
      link
    );
  };
  return {
    async book(
      actorId: number,
      input: z.infer<typeof staffCallBookInput>
    ): Promise<StaffCallOperationResult> {
      const db = await d.database();
      const actor = await requireStaffCallActor(db, actorId, { manage: true });
      const hash = staffCallPayloadHash({
        kind: "book",
        ...input,
        agentIds: [...input.agentIds].sort((a, b) => a - b),
      });
      const previous = await replay(db, actor, input.requestId, hash);
      if (previous) return previous;
      await d.hostAuthority(db, actor, input.hostUserId);
      await d.exactAgents(db, input.agentIds, true);

      if (input.startAt <= d.now()) fail("BAD_REQUEST", "Choose a future slot");
      const available = await d.checkedSlots(db, actor, {
        hostUserId: input.hostUserId,
        format: input.format,
        agentIds: input.agentIds,
        from: input.startAt,
        to: input.endAt,
      });
      if (
        !available.connected ||
        !available.slots.some(
          s =>
            s.startAt.getTime() === input.startAt.getTime() &&
            s.endAt.getTime() === input.endAt.getTime()
        )
      )
        fail(
          "PRECONDITION_FAILED",
          available.connected
            ? "The exact slot is no longer available"
            : available.message
        );
      let callId: number, participantId: number;
      try {
        const created = await db.transaction(
          async tx => {
            const fresh = await requireStaffCallActor(tx, actorId, {
              manage: true,
            });
            await d.hostAuthority(tx, fresh, input.hostUserId);
            await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.id, input.hostUserId))
              .limit(1)
              .for("update");
            const currentActor = await requireStaffCallActor(tx, actorId, {
              manage: true,
            });
            await d.hostAuthority(tx, currentActor, input.hostUserId);
            // Reread request inside the serialized transaction to avoid duplicate concurrent callers.
            const again = await replay(
              tx,
              currentActor,
              input.requestId,
              hash,
              true
            );
            if (again) return { replay: again };
            await d.exactAgents(tx, input.agentIds, true);
            await localAvailability(
              tx,
              input.hostUserId,
              input.startAt,
              input.endAt
            );
            const timestamp = d.now();
            const [createdCall] = await tx
              .insert(staffCalls)
              .values({
                hostUserId: input.hostUserId,
                reasonKey: input.reasonKey,
                reasonExplanation:
                  input.reasonKey === "other" ? input.reasonExplanation! : null,
                format: input.format,
                startAt: input.startAt,
                endAt: input.endAt,
                status: "pending",
                createdById: fresh.id,
                createdAt: timestamp,
                updatedAt: timestamp,
              })
              .$returningId();
            const participantIds: number[] = [];
            for (const agentId of input.agentIds) {
              const [cp] = await tx
                .insert(staffCallParticipants)
                .values({
                  callId: createdCall!.id,
                  agentId,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                })
                .$returningId();
              participantIds.push(cp!.id);
            }
            const [call] = await tx
              .select()
              .from(staffCalls)
              .where(eq(staffCalls.id, createdCall!.id))
              .limit(1);
            await d.history(
              tx,
              call!.id,
              fresh.id,
              "call.created",
              null,
              call!
            );
            const [p] = await tx
              .select()
              .from(staffCallParticipants)
              .where(eq(staffCallParticipants.id, participantIds[0]!))
              .limit(1);
            for (const pid of participantIds) {
              const [pp] = await tx
                .select()
                .from(staffCallParticipants)
                .where(eq(staffCallParticipants.id, pid))
                .limit(1);
              await d.history(
                tx,
                call!.id,
                fresh.id,
                "participant.created",
                null,
                pp!,
                pid
              );
            }
            await insertOperation(
              tx,
              fresh,
              call!,
              input.requestId,
              "book",
              input,
              hash
            );
            return { callId: call!.id, participantId: p!.id };
          },
          { isolationLevel: "read committed" }
        );
        if ("replay" in created) return created.replay!;
        callId = created.callId;
        participantId = created.participantId;
      } catch (error) {
        const again = await replay(db, actor, input.requestId, hash);
        if (again) return again;
        throw error;
      }
      // Committed pending ledger precedes the one and only provider write.
      if (input.format === "group")
        return dispatchGroup(actorId, input.requestId);
      return dispatch(
        actorId,
        input.requestId,
        guard =>
          d.provider.createBooking(
            {
              hostUserId: input.hostUserId,
              kind: "oneToOne",
              callId,
              participantId,
              operationId: input.requestId,
              start: input.startAt.toISOString(),
            },
            guard
          ),
        undefined,
        participantId
      );
    },
    reschedule: (
      actorId: number,
      input: z.infer<typeof staffCallRescheduleInput>
    ) => change(actorId, "reschedule", input),
    cancel: (actorId: number, input: z.infer<typeof staffCallCancelInput>) =>
      change(actorId, "cancel", input),
    cancelParticipant: (
      actorId: number,
      input: z.infer<typeof staffCallCancelParticipantInput>
    ) => change(actorId, "cancel_participant", input),
    async reconcile(
      actorId: number,
      requestId: string
    ): Promise<StaffCallOperationResult> {
      const db = await d.database();
      const actor = await requireStaffCallActor(db, actorId, { manage: true });
      const [operation] = await db
        .select()
        .from(staffCallOperations)
        .where(eq(staffCallOperations.requestId, requestId))
        .limit(1);
      if (!operation || operation.actorId !== actor.id)
        fail("NOT_FOUND", "Diary operation not found");
      const call = await d.callFor(db, actor, operation.callId);
      const ps = await d.participantsFor(db, call.id);
      await d.scopeParticipants(db, actor, ps);
      await d.hostAuthority(db, actor, call.hostUserId);
      if (operation.state === "succeeded" || operation.state === "failed")
        return resultFor(operation, call);
      if (call.activeOperationId !== operation.id)
        fail("CONFLICT", "A different operation owns the call");
      if (call.format === "group")
        return reconcileGroup(actorId, operation, call, ps);
      const payload = operation.payload as any;
      const p = operation.participantId
        ? ps.find(p => p.id === operation.participantId)
        : ps[0];
      if (!p) fail("NOT_FOUND", "Participant not found");
      let response: StaffProviderResult<StaffCallBooking> = {
        ok: false,
        code: "UNCERTAIN",
        message:
          "Exact provider operation remains unresolved; no retry was sent",
        uncertain: true,
      };
      if (operation.kind === "book") {
        const metadata = {
          hostUserId: call.hostUserId,
          kind: "oneToOne" as const,
          callId: call.id,
          participantId: p.id,
          operationId: operation.requestId,
        };
        const scan = await d.provider.reconcileOperation({
          ...metadata,
          start: new Date(payload.startAt).toISOString(),
          end: new Date(payload.endAt).toISOString(),
        });
        if (scan.ok && scan.value.complete && scan.value.bookings.length === 1)
          response = { ok: true, value: scan.value.bookings[0]! };
        // Zero, duplicate, or incomplete matches are not proof of failed dispatch; retain recovery.
      } else {
        const link = payload.link as StaffCallLink;
        if (
          link &&
          link.callId === call.id &&
          link.participantId === p.id &&
          link.hostUserId === call.hostUserId
        )
          response = await d.provider.getBooking(link);
        // A reschedule may replace UID; exact original metadata scan locates the new known-operation UID.
        if (
          operation.kind === "reschedule" &&
          (!response.ok ||
            new Date(response.value.start).getTime() !==
              new Date(payload.startAt).getTime())
        ) {
          const scan = await d.provider.reconcileOperation({
            ...link,
            start: new Date(payload.startAt).toISOString(),
            end: new Date(payload.endAt).toISOString(),
          });
          if (
            scan.ok &&
            scan.value.complete &&
            scan.value.bookings.length === 1
          )
            response = { ok: true, value: scan.value.bookings[0]! };
        }
      }
      return markResult(actorId, requestId, response, true);
    },
  };
}

export const staffCallsService = createStaffCallsService();

/** Re-reads exact provider linkage under ORM locks; never infers attendance or touches notes. */
async function refreshKnownStaffCall(
  db: Database,
  callId: number,
  event?: StaffCallLifecycleEvent,
  provider = new StaffCallsProvider({ resolveParticipant: async () => null })
): Promise<boolean> {
  return db.transaction(async tx => {
    const [call] = await tx
      .select()
      .from(staffCalls)
      .where(eq(staffCalls.id, callId))
      .limit(1)
      .for("update");
    if (
      !call ||
      call.activeOperationId ||
      !call.providerBookingUid ||
      !call.providerEventTypeId
    )
      return false;
    await requireStaffCallActor(tx, call.hostUserId, { manage: true });
    const [original] = await tx
      .select()
      .from(staffCallOperations)
      .where(
        and(
          eq(staffCallOperations.callId, call.id),
          eq(staffCallOperations.kind, "book")
        )
      )
      .orderBy(asc(staffCallOperations.id))
      .limit(1);
    if (!original) return false;
    await requireStaffCallActor(tx, original.actorId, { manage: true });
    const ps = await tx
      .select()
      .from(staffCallParticipants)
      .where(eq(staffCallParticipants.callId, call.id))
      .orderBy(asc(staffCallParticipants.id));
    if (!ps.length) return false;
    if (
      event &&
      (event.hostUserId !== call.hostUserId ||
        String(event.eventTypeId) !== call.providerEventTypeId ||
        event.identity.callId !== call.id ||
        event.identity.operationId !== original.requestId ||
        !ps.some(
          p =>
            p.id === event.identity.participantId &&
            (call.format !== "group" || p.providerSeatUid === event.seatUid)
        ) ||
        (event.bookingUid !== call.providerBookingUid &&
          event.previousBookingUid !== call.providerBookingUid))
    )
      return false;
    const timestamp = new Date();
    const cache = (original.result as any)?.knownRefresh;
    const key = staffCallPayloadHash({
      version: call.version,
      uid: call.providerBookingUid,
      ps: ps.map(p => ({
        id: p.id,
        seat: p.providerSeatUid,
        status: p.status,
      })),
    });
    const validCache =
      call.format === "group" &&
      cache?.key === key &&
      timestamp.getTime() - Date.parse(cache.startedAt) < 300_000;
    const seats: Record<string, StaffCallBooking> = validCache
      ? { ...cache.seats }
      : {};
    const cursor = validCache ? Number(cache.cursor ?? 0) % ps.length : 0;
    const ordered = [...ps.slice(cursor), ...ps.slice(0, cursor)];
    let nextCursor = cursor;
    let failed = false;
    for (const p of ordered) {
      if (seats[String(p.id)]) continue;
      if (call.format === "group" && !p.providerSeatUid) {
        failed = true;
        break;
      }
      let reading: StaffProviderResult<StaffCallBooking>;
      try {
        reading = await provider.getBooking({
          hostUserId: call.hostUserId,
          kind: call.format === "group" ? "group" : "oneToOne",
          callId: call.id,
          participantId: p.id,
          operationId: original.requestId,
          bookingUid: call.providerBookingUid,
          ...(call.format === "group" ? groupProof(ps) : {}),
          ...(p.providerSeatUid ? { seatUid: p.providerSeatUid } : {}),
        });
      } catch {
        break;
      } // Budget exhaustion keeps verified seat progress, never rolls the whole session back.
      nextCursor = (ps.findIndex(x => x.id === p.id) + 1) % ps.length;
      if (
        !reading.ok ||
        reading.value.eventTypeId !== Number(call.providerEventTypeId) ||
        reading.value.bookingUid !== call.providerBookingUid ||
        reading.value.callId !== call.id ||
        reading.value.participantId !== p.id ||
        reading.value.hostUserId !== call.hostUserId ||
        reading.value.operationId !== original.requestId ||
        (call.format === "group" && reading.value.seatUid !== p.providerSeatUid)
      ) {
        failed = true;
        continue;
      }
      seats[String(p.id)] = snapshot(reading.value);
    }
    const readings = ps.map(p => seats[String(p.id)]).filter(Boolean);
    if (call.format === "group")
      await tx
        .update(staffCallOperations)
        .set({
          result: {
            ...((original.result as any) ?? {}),
            knownRefresh:
              readings.length === ps.length
                ? null
                : {
                    key,
                    startedAt: validCache
                      ? cache.startedAt
                      : timestamp.toISOString(),
                    cursor: nextCursor,
                    seats,
                  },
          },
          updatedAt: timestamp,
        })
        .where(eq(staffCallOperations.id, original.id));
    await tx
      .update(staffCalls)
      .set({ updatedAt: timestamp })
      .where(eq(staffCalls.id, call.id));
    if (readings.length !== ps.length) return false;
    const accepted = readings.filter(b => b.status === "accepted");
    const consistent =
      !failed &&
      readings.every(
        b =>
          b.bookingUid === readings[0]!.bookingUid &&
          b.start === readings[0]!.start &&
          b.end === readings[0]!.end
      ) &&
      (call.format !== "group" ||
        new Set(readings.map(b => b.seatUid)).size === ps.length);
    const status: StaffCall["status"] =
      !consistent || readings.some(b => b.status === "pending")
        ? "needs_recovery"
        : readings.every(
              b => b.status === "cancelled" || b.status === "rejected"
            )
          ? "cancelled"
          : accepted.length
            ? "booked"
            : "needs_recovery";
    const first = readings[0]!;
    const after = {
      ...call,
      status,
      meetingUrl: consistent ? first.meetingUrl : call.meetingUrl,
      providerBookingUid: consistent
        ? first.bookingUid
        : call.providerBookingUid,
      startAt: consistent ? new Date(first.start) : call.startAt,
      endAt: consistent ? new Date(first.end) : call.endAt,
      bookedAt: accepted.length ? (call.bookedAt ?? timestamp) : call.bookedAt,
      updatedAt: timestamp,
      version: call.version + 1,
    };
    const changed =
      call.status !== after.status ||
      call.startAt.getTime() !== after.startAt.getTime() ||
      call.endAt.getTime() !== after.endAt.getTime() ||
      call.providerBookingUid !== after.providerBookingUid;
    if (changed) {
      await tx
        .update(staffCalls)
        .set({
          status: after.status,
          providerBookingUid: after.providerBookingUid,
          meetingUrl: after.meetingUrl,
          startAt: after.startAt,
          endAt: after.endAt,
          bookedAt: after.bookedAt,
          updatedAt: timestamp,
          version: after.version,
        })
        .where(eq(staffCalls.id, call.id));
      await tx.insert(staffCallHistory).values({
        callId: call.id,
        actorId: null,
        action:
          call.startAt.getTime() !== after.startAt.getTime()
            ? "provider.rescheduled"
            : "provider.refreshed",
        beforeState: snapshot(call),
        afterState: snapshot(after),
        createdAt: timestamp,
      });
    }
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!,
        reading = readings[i]!;
      const nextStatus =
        reading.status === "cancelled" || reading.status === "rejected"
          ? ("cancelled" as const)
          : p.status;
      if (
        p.status !== nextStatus ||
        (!p.bookedAt && reading.status === "accepted")
      ) {
        const pa = {
          ...p,
          status: nextStatus,
          bookedAt:
            reading.status === "accepted"
              ? (p.bookedAt ?? timestamp)
              : p.bookedAt,
          version: p.version + 1,
          updatedAt: timestamp,
        };
        await tx
          .update(staffCallParticipants)
          .set({
            status: pa.status,
            bookedAt: pa.bookedAt,
            version: pa.version,
            updatedAt: timestamp,
          })
          .where(eq(staffCallParticipants.id, p.id));
        await tx.insert(staffCallHistory).values({
          callId: call.id,
          participantId: p.id,
          actorId: null,
          action: "provider.participant_refreshed",
          beforeState: snapshot(p),
          afterState: snapshot(pa),
          createdAt: timestamp,
        });
      }
    }
    return true;
  });
}

async function processStaffCallInbox(
  db: Database,
  inboxId: number,
  provider?: StaffCallsProvider
): Promise<boolean> {
  // The row lock is held across the bounded exact provider read; duplicate workers cannot double-apply.
  return db.transaction(async tx => {
    const [inbox] = await tx
      .select()
      .from(staffCallWebhookInbox)
      .where(eq(staffCallWebhookInbox.id, inboxId))
      .limit(1)
      .for("update");
    if (!inbox || inbox.state !== "received") return false;
    const event = inbox.event as StaffCallLifecycleEvent;
    const [call] = await tx
      .select()
      .from(staffCalls)
      .where(eq(staffCalls.id, event.identity.callId))
      .limit(1)
      .for("update");
    const [p] = await tx
      .select()
      .from(staffCallParticipants)
      .where(
        and(
          eq(staffCallParticipants.id, event.identity.participantId),
          eq(staffCallParticipants.callId, event.identity.callId)
        )
      )
      .limit(1);
    const [op] = await tx
      .select()
      .from(staffCallOperations)
      .where(eq(staffCallOperations.requestId, event.identity.operationId))
      .limit(1);
    const [original] = await tx
      .select()
      .from(staffCallOperations)
      .where(
        and(
          eq(staffCallOperations.callId, event.identity.callId),
          eq(staffCallOperations.kind, "book")
        )
      )
      .orderBy(asc(staffCallOperations.id))
      .limit(1);
    const valid =
      call &&
      p &&
      op &&
      original &&
      op.id === original.id &&
      op.callId === call.id &&
      op.kind === "book" &&
      call.hostUserId === event.hostUserId &&
      call.providerEventTypeId === String(event.eventTypeId) &&
      (call.format === "group"
        ? !!p.providerSeatUid && p.providerSeatUid === event.seatUid
        : !event.seatUid);
    if (!valid) {
      await tx
        .update(staffCallWebhookInbox)
        .set({ state: "ignored", processedAt: new Date() })
        .where(eq(staffCallWebhookInbox.id, inbox.id));
      return false;
    }
    await tx
      .update(staffCallWebhookInbox)
      .set({ processedAt: new Date() })
      .where(eq(staffCallWebhookInbox.id, inbox.id));
    // C-before-B cannot jump A->C based on signed metadata alone. Retain the
    // bounded normalized receipt; a later authenticated A->B read roots it.
    if (
      call.providerBookingUid !== event.bookingUid &&
      call.providerBookingUid !== event.previousBookingUid
    )
      return false;
    // A pending local mutation owns the call. Leave receipt for recovery instead of overriding it.
    if (call.activeOperationId) return false;
    await requireStaffCallActor(tx, call.hostUserId, { manage: true });
    await requireStaffCallActor(tx, op.actorId, { manage: true });
    // Pass the SAME transaction handle into the refresh (no global pool / nested transaction).
    const refreshed = await refreshKnownStaffCallWithinTransaction(
      tx,
      call,
      event,
      op,
      p,
      provider
    );
    if (refreshed)
      await tx
        .update(staffCallWebhookInbox)
        .set({ state: "processed", processedAt: new Date() })
        .where(eq(staffCallWebhookInbox.id, inbox.id));
    return refreshed;
  });
}
async function refreshKnownStaffCallWithinTransaction(
  tx: StaffCallDb,
  call: StaffCall,
  event: StaffCallLifecycleEvent,
  op: StaffCallOperation,
  p: StaffCallParticipant,
  provider = new StaffCallsProvider({ resolveParticipant: async () => null })
): Promise<boolean> {
  // Group lifecycle messages are seat-scoped; update only that exact seat, never cancel the session.
  const ps = await tx
    .select()
    .from(staffCallParticipants)
    .where(eq(staffCallParticipants.callId, call.id));
  const read = await provider.getBooking({
    hostUserId: call.hostUserId,
    kind: call.format === "group" ? "group" : "oneToOne",
    callId: call.id,
    participantId: p.id,
    operationId: op.requestId,
    bookingUid: event.bookingUid,
    ...(call.format === "group" ? groupProof(ps) : {}),
    ...(p.providerSeatUid ? { seatUid: p.providerSeatUid } : {}),
  });
  if (!read.ok || String(read.value.eventTypeId) !== call.providerEventTypeId)
    return false;
  const b = read.value;
  const timestamp = new Date();
  if (
    b.callId !== call.id ||
    b.participantId !== p.id ||
    b.hostUserId !== call.hostUserId ||
    b.operationId !== op.requestId ||
    b.bookingUid !== event.bookingUid ||
    b.kind !== (call.format === "group" ? "group" : "oneToOne") ||
    (call.format === "group" && b.seatUid !== p.providerSeatUid)
  )
    return false;
  const replacement = b.bookingUid !== call.providerBookingUid;
  if (
    replacement &&
    (event.event !== "BOOKING_RESCHEDULED" ||
      event.previousBookingUid !== call.providerBookingUid ||
      b.previousBookingUid !== call.providerBookingUid)
  )
    return false;
  if (
    call.format === "group" &&
    (b.bookingUid !== call.providerBookingUid ||
      new Date(b.start).getTime() !== call.startAt.getTime() ||
      new Date(b.end).getTime() !== call.endAt.getTime())
  )
    return false;
  const status: StaffCall["status"] =
    b.status === "accepted"
      ? "booked"
      : b.status === "cancelled" || b.status === "rejected"
        ? "cancelled"
        : "needs_recovery";
  if (call.format === "one_to_one") {
    const after = {
      ...call,
      status,
      meetingUrl: b.meetingUrl,
      providerBookingUid: b.bookingUid,
      startAt: new Date(b.start),
      endAt: new Date(b.end),
      bookedAt:
        b.status === "accepted" ? (call.bookedAt ?? timestamp) : call.bookedAt,
      version: call.version + 1,
      updatedAt: timestamp,
    };
    if (
      call.status !== after.status ||
      call.startAt.getTime() !== after.startAt.getTime() ||
      call.endAt.getTime() !== after.endAt.getTime() ||
      call.providerBookingUid !== after.providerBookingUid
    ) {
      await tx
        .update(staffCalls)
        .set({
          status: after.status,
          providerBookingUid: after.providerBookingUid,
          meetingUrl: after.meetingUrl,
          startAt: after.startAt,
          endAt: after.endAt,
          bookedAt: after.bookedAt,
          version: after.version,
          updatedAt: timestamp,
        })
        .where(eq(staffCalls.id, call.id));
      await tx.insert(staffCallHistory).values({
        callId: call.id,
        actorId: null,
        action:
          replacement ||
          call.startAt.getTime() !== after.startAt.getTime() ||
          call.endAt.getTime() !== after.endAt.getTime()
            ? "provider.rescheduled"
            : "provider.refreshed",
        beforeState: snapshot(call),
        afterState: snapshot(after),
        createdAt: timestamp,
      });
    }
  }
  const pa = {
    ...p,
    status:
      b.status === "cancelled" || b.status === "rejected"
        ? ("cancelled" as const)
        : call.format === "one_to_one" && replacement && b.status === "accepted"
          ? ("active" as const)
          : p.status,
    bookedAt: b.status === "accepted" ? (p.bookedAt ?? timestamp) : p.bookedAt,
    version: p.version + 1,
    updatedAt: timestamp,
  };
  if (pa.status !== p.status || pa.bookedAt !== p.bookedAt) {
    await tx
      .update(staffCallParticipants)
      .set({
        status: pa.status,
        bookedAt: pa.bookedAt,
        version: pa.version,
        updatedAt: timestamp,
      })
      .where(eq(staffCallParticipants.id, p.id));
    await tx.insert(staffCallHistory).values({
      callId: call.id,
      participantId: p.id,
      actorId: null,
      action: "provider.participant_refreshed",
      beforeState: snapshot(p),
      afterState: snapshot(pa),
      createdAt: timestamp,
    });
  }
  return true;
}

export async function handleStaffCallsWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>
): Promise<{ status: number; body: { accepted: boolean; message?: string } }> {
  const signature = headers["x-cal-signature-256"];
  const verified = verifyStaffCallWebhook(
    rawBody,
    typeof signature === "string" ? signature : undefined,
    () => true
  );
  if (!verified.ok)
    return {
      status:
        verified.code === "UNCONNECTED"
          ? 503
          : verified.code === "INVALID_SIGNATURE"
            ? 401
            : 400,
      body: {
        accepted: false,
        message: "Staff-call webhook could not be verified",
      },
    };
  if (verified.ignored) return { status: 202, body: { accepted: true } };
  const event = verified.value;
  const db = await getDb();
  if (!db) return { status: 503, body: { accepted: false } };
  try {
    let inboxId: number;
    try {
      const [created] = await db
        .insert(staffCallWebhookInbox)
        .values({
          eventKey: event.receiptHash,
          payloadHash: staffCallPayloadHash(event),
          event: snapshot(event),
        })
        .$returningId();
      inboxId = created!.id;
    } catch {
      const [existing] = await db
        .select()
        .from(staffCallWebhookInbox)
        .where(eq(staffCallWebhookInbox.eventKey, event.receiptHash))
        .limit(1);
      if (!existing || existing.payloadHash !== staffCallPayloadHash(event))
        return { status: 503, body: { accepted: false } };
      inboxId = existing.id;
    }
    await processStaffCallInbox(db, inboxId);
    return { status: 202, body: { accepted: true } };
  } catch {
    return {
      status: 503,
      body: {
        accepted: false,
        message: "Staff-call webhook storage is unavailable",
      },
    };
  }
}

/** Finite externally invoked recovery; no timers/cron registration, no blind provider writes. */
export async function reconcileStaffCallsBatch(
  options: { limit?: number; deadlineMs?: number } = {}
): Promise<{
  checked: number;
  recovered: number;
  processed: number;
  skipped: number;
}> {
  const limit = Math.max(1, Math.min(25, options.limit ?? 25));
  const deadline =
    Date.now() + Math.max(1000, Math.min(90_000, options.deadlineMs ?? 90_000));
  const counts = { checked: 0, recovered: 0, processed: 0, skipped: 0 };
  const db = await getDb();
  if (!db) return counts;
  const budgetProvider = (
    resolveParticipant: (
      identity: StaffCallIdentity,
      hostUserId: number
    ) => Promise<{ name: string; email: string } | null>
  ) => {
    const underlying = new StaffCallsProvider({ resolveParticipant });
    return new Proxy(underlying, {
      get(target, key) {
        const fn = Reflect.get(target, key);
        if (typeof fn !== "function") return fn;
        return async (...args: unknown[]) => {
          if (Date.now() >= deadline || counts.checked >= limit)
            throw new Error("Finite provider read budget exhausted");
          counts.checked++;
          return fn.apply(target, args);
        };
      },
    });
  };
  const recoveryService = createStaffCallsService({
    providerFactory: budgetProvider,
  });
  const reader = budgetProvider(async () => null);
  const timestamp = new Date();
  const operations = await db
    .select()
    .from(staffCallOperations)
    .where(inArray(staffCallOperations.state, ["pending", "needs_recovery"]))
    .orderBy(asc(staffCallOperations.updatedAt), asc(staffCallOperations.id))
    .limit(limit);
  const inbox = await db
    .select()
    .from(staffCallWebhookInbox)
    .where(eq(staffCallWebhookInbox.state, "received"))
    .orderBy(
      asc(staffCallWebhookInbox.processedAt),
      asc(staffCallWebhookInbox.id)
    )
    .limit(limit);
  const calls = await db
    .select()
    .from(staffCalls)
    .where(
      and(
        inArray(staffCalls.status, ["booked", "cancelled", "needs_recovery"]),
        isNull(staffCalls.activeOperationId),
        isNotNull(staffCalls.providerBookingUid),
        gt(staffCalls.endAt, new Date(timestamp.getTime() - 7 * 86_400_000)),
        lt(staffCalls.startAt, new Date(timestamp.getTime() + 31 * 86_400_000))
      )
    )
    .orderBy(asc(staffCalls.updatedAt), asc(staffCalls.id))
    .limit(limit);
  // One shared attempt queue prevents unresolved operations from monopolising every provider-read budget.
  const work = [
    ...operations.map(row => ({
      kind: "operation" as const,
      row,
      at: row.updatedAt,
    })),
    ...inbox.map(row => ({ kind: "inbox" as const, row, at: row.processedAt })),
    ...calls.map(row => ({ kind: "call" as const, row, at: row.updatedAt })),
  ]
    .sort(
      (a, b) =>
        (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0) || a.row.id - b.row.id
    )
    .slice(0, limit);
  for (const item of work) {
    if (counts.checked >= limit || Date.now() >= deadline) break;
    try {
      if (item.kind === "operation") {
        const result = await recoveryService.reconcile(
          item.row.actorId,
          item.row.requestId
        );
        if (result.state === "succeeded") counts.recovered++;
        else counts.skipped++;
      } else if (item.kind === "inbox") {
        if (await processStaffCallInbox(db, item.row.id, reader))
          counts.processed++;
        else counts.skipped++;
      } else if (
        await refreshKnownStaffCall(db, item.row.id, undefined, reader)
      )
        counts.recovered++;
      else counts.skipped++;
    } catch {
      counts.skipped++;
    } finally {
      // Attempt rotation is not a business edit: never increment versions or append history here.
      const attemptedAt = new Date();
      if (item.kind === "operation")
        await db
          .update(staffCallOperations)
          .set({ updatedAt: attemptedAt })
          .where(eq(staffCallOperations.id, item.row.id));
      else if (item.kind === "inbox")
        await db
          .update(staffCallWebhookInbox)
          .set({ processedAt: attemptedAt })
          .where(eq(staffCallWebhookInbox.id, item.row.id));
      else
        await db
          .update(staffCalls)
          .set({ updatedAt: attemptedAt })
          .where(eq(staffCalls.id, item.row.id));
    }
  }
  return counts;
}
