import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Server-only pilot. No request, timer, secret lookup or connection at import time.
const ORIGIN = "https://api.cal.com";
export const STAFF_CAL_API_VERSIONS = Object.freeze({
  slots: "2024-09-04",
  booking: "2026-02-25",
  list: "2026-05-01",
  eventType: "2026-06-12",
});
const LIMIT_BYTES = 256 * 1024;
const TIMEOUT_MS = 5_000;
const NAMESPACE = "jlt-staff-calls";
type Json = Record<string, unknown>;

export type StaffCallKind = "oneToOne" | "group";
/** Core-owned fresh authorization for one POST; never caller input or cached readiness. */
export type StaffCallWriteGuard = () => Promise<void>;
export type StaffProviderErrorCode =
  | "UNCONNECTED"
  | "INVALID_INPUT"
  | "UNAVAILABLE"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PROVIDER_FAILURE"
  | "INVALID_PROVIDER_RESPONSE"
  | "UNCERTAIN";
export type StaffProviderResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: StaffProviderErrorCode;
      message: string;
      uncertain: boolean;
    };
export interface StaffCallIdentity {
  callId: number;
  participantId: number;
  operationId: string;
}
export interface StaffCallTarget {
  hostUserId: number;
  kind: StaffCallKind;
  /** Durable Portal participant record IDs, never provider- or browser-derived. */
  invitedParticipantIds?: readonly number[];
  /** Already linked durable seats; only mappings present in a meeting are checked. */
  knownSeats?: readonly { participantId: number; seatUid: string }[];
}
export interface StaffCallLink extends StaffCallTarget, StaffCallIdentity {
  bookingUid: string;
  seatUid?: string;
}
export interface StaffCallInterval {
  start: string;
  end: string;
}
export interface StaffCallSlot extends StaffCallInterval {
  remainingSeats?: number;
  bookingUid?: string;
}
export interface StaffCallBooking extends StaffCallLink, StaffCallInterval {
  provider: "cal.com";
  providerBookingId: number;
  eventTypeId: number;
  providerHostUserId: number;
  meetingUrl: string | null;
  /** Only the validated authenticated response rescheduledFromUid, never caller input. */
  previousBookingUid?: string;
  status: "accepted" | "pending" | "cancelled" | "rejected";
}
export interface StaffCallConnectionStatus {
  state: "UNCONNECTED" | "READY";
  hostUserId: number;
  oneToOne: { ready: boolean; durationMinutes?: number };
  group: { ready: boolean; durationMinutes?: number; capacity?: number };
  busyTimes: "UNAVAILABLE";
}
export interface StaffParticipantIdentity {
  name: string;
  email: string;
}
export interface StaffCallsProviderDependencies {
  /** Must resolve an authorised server-side record, never browser-submitted identity. */
  resolveParticipant(
    identity: StaffCallIdentity,
    hostUserId: number
  ): Promise<StaffParticipantIdentity | null>;
  /** Mock-only seam. Production uses global fetch; URL is never caller-controlled. */
  fetch?: typeof globalThis.fetch;
}
export interface StaffCallReconciliation {
  bookings: StaffCallBooking[];
  complete: boolean;
}
interface EventConfig {
  eventTypeId: number;
  durationMinutes: number;
  capacity?: number;
  seatedWritesEnabled?: boolean;
}
interface HostConfig {
  apiKey: string;
  expectedCalUserId: number;
  oneToOne: EventConfig;
  group?: EventConfig;
}
interface Ready {
  host: HostConfig;
  event: EventConfig;
}
const MESSAGES: Record<StaffProviderErrorCode, string> = {
  UNCONNECTED: "Staff calendar is not connected.",
  INVALID_INPUT: "Invalid staff-call request.",
  UNAVAILABLE: "This staff-calendar capability is unavailable.",
  FORBIDDEN: "Staff-calendar access was denied.",
  NOT_FOUND: "Staff-call booking was not found.",
  CONFLICT: "The requested booking conflicts with availability.",
  RATE_LIMITED: "Staff-calendar request limit reached.",
  PROVIDER_FAILURE: "Staff-calendar service is unavailable.",
  INVALID_PROVIDER_RESPONSE: "Staff-calendar response could not be verified.",
  UNCERTAIN:
    "The provider operation may have completed. Reconcile before retrying.",
};
function fail<T = never>(code: StaffProviderErrorCode): StaffProviderResult<T> {
  return {
    ok: false,
    code,
    message: MESSAGES[code],
    uncertain: code === "UNCERTAIN",
  };
}
function success<T>(value: T): StaffProviderResult<T> {
  return { ok: true, value };
}
function object(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function uid(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function exactKeys(value: Json, allowed: string[]): boolean {
  return Object.keys(value).every(k => allowed.includes(k));
}
function iso(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    )
  )
    return null;
  // Reject Date.parse's silent normalization of impossible calendar dates.
  const parts = value.slice(0, 19).split(/[-T:]/).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    year < 2000 ||
    year > 2100 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  if (
    value !==
    value.replace(/[+-](\d{2}):(\d{2})$/, (_, h, m) =>
      Number(h) > 23 || Number(m) > 59 ? "INVALID" : `${value.at(-6)}${h}:${m}`
    )
  )
    return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function interval(
  value: StaffCallInterval,
  maxDays = 31
): StaffCallInterval | null {
  const start = iso(value.start),
    end = iso(value.end);
  if (
    !start ||
    !end ||
    Date.parse(end) <= Date.parse(start) ||
    Date.parse(end) - Date.parse(start) > maxDays * 86_400_000
  )
    return null;
  return { start, end };
}
function target(value: StaffCallTarget): boolean {
  return (
    positive(value.hostUserId) &&
    (value.kind === "oneToOne" || value.kind === "group")
  );
}
function identity(value: StaffCallIdentity): boolean {
  return (
    positive(value.callId) &&
    positive(value.participantId) &&
    uid(value.operationId)
  );
}
function linkValid(value: StaffCallLink): boolean {
  return (
    target(value) &&
    identity(value) &&
    uid(value.bookingUid) &&
    (value.kind === "group" ? uid(value.seatUid) : value.seatUid === undefined)
  );
}
function identityOnly(value: StaffCallIdentity): StaffCallIdentity {
  return {
    callId: value.callId,
    participantId: value.participantId,
    operationId: value.operationId,
  };
}
function metadata(
  value: StaffCallTarget & StaffCallIdentity
): Record<string, string> {
  return {
    jltNamespace: NAMESPACE,
    jltHostUserId: String(value.hostUserId),
    jltCallId: String(value.callId),
    jltParticipantId: String(value.participantId),
    jltOperationId: value.operationId,
  };
}
function matchesMetadata(
  value: unknown,
  expected: StaffCallTarget & StaffCallIdentity
): boolean {
  return (
    object(value) &&
    Object.entries(metadata(expected)).every(
      ([key, item]) => value[key] === item
    )
  );
}
function groupProofInput(value: StaffCallTarget & StaffCallIdentity): boolean {
  if (value.kind !== "group") return true;
  const invited = value.invitedParticipantIds;
  if (
    !Array.isArray(invited) ||
    invited.length < 1 ||
    invited.length > 100 ||
    Array.from(invited).some(id => !positive(id)) ||
    new Set(invited).size !== invited.length ||
    !invited.includes(value.participantId)
  )
    return false;
  const seats = value.knownSeats;
  if (seats === undefined) return true;
  return (
    Array.isArray(seats) &&
    seats.length <= invited.length &&
    Array.from(seats).every(
      s =>
        object(s) &&
        positive(s.participantId) &&
        invited.includes(s.participantId) &&
        uid(s.seatUid)
    ) &&
    new Set(seats.map(s => s.participantId)).size === seats.length &&
    new Set(seats.map(s => s.seatUid)).size === seats.length
  );
}
function invitedMetadata(
  value: unknown,
  expected: StaffCallTarget & StaffCallIdentity
): number | null {
  if (!object(value) || typeof value.jltParticipantId !== "string") return null;
  const participantId = Number(value.jltParticipantId);
  return positive(participantId) &&
    String(participantId) === value.jltParticipantId &&
    expected.invitedParticipantIds?.includes(participantId) &&
    matchesMetadata(value, { ...expected, participantId })
    ? participantId
    : null;
}
function groupRosterVerified(
  value: unknown,
  ready: Ready,
  expected: StaffCallTarget & StaffCallIdentity,
  replacementParticipantId?: number
): boolean {
  if (
    !groupProofInput(expected) ||
    !bookingCore(value, ready) ||
    invitedMetadata(value.metadata, expected) === null ||
    !Array.isArray(value.attendees) ||
    value.attendees.length > 100
  )
    return false;
  const participants = new Set<number>(),
    seats = new Set<string>();
  let active = 0;
  for (const attendee of value.attendees) {
    if (!object(attendee) || !uid(attendee.seatUid)) return false;
    const participantId = invitedMetadata(attendee.metadata, expected);
    if (
      participantId === null ||
      participants.has(participantId) ||
      seats.has(attendee.seatUid)
    )
      return false;
    if (
      (attendee.status !== undefined && attendee.status !== "cancelled") ||
      (attendee.confirmationStatus !== undefined &&
        !["pending", "accepted", "rejected"].includes(
          String(attendee.confirmationStatus)
        )) ||
      (attendee.status !== "cancelled" &&
        value.status !== "cancelled" &&
        attendee.confirmationStatus === undefined)
    )
      return false;
    const known = expected.knownSeats?.find(
      s => s.participantId === participantId
    );
    if (
      known &&
      participantId !== replacementParticipantId &&
      known.seatUid !== attendee.seatUid
    )
      return false;
    // Replacement/new seats may never alias another participant's durable seat.
    if (
      expected.knownSeats?.some(
        s => s.participantId !== participantId && s.seatUid === attendee.seatUid
      )
    )
      return false;
    participants.add(participantId);
    seats.add(attendee.seatUid);
    if (
      attendee.status !== "cancelled" &&
      attendee.confirmationStatus !== "rejected"
    )
      active++;
  }
  return active <= ready.event.capacity!;
}
function safeMeetingUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 2_048 ||
    /[\x00-\x20\x7f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !host.includes(".") ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host.startsWith("[")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
function eventConfig(value: unknown, group: boolean): value is EventConfig {
  if (
    !object(value) ||
    !exactKeys(
      value,
      group
        ? ["eventTypeId", "durationMinutes", "capacity", "seatedWritesEnabled"]
        : ["eventTypeId", "durationMinutes"]
    )
  )
    return false;
  return (
    positive(value.eventTypeId) &&
    positive(value.durationMinutes) &&
    value.durationMinutes <= 480 &&
    (!group ||
      (positive(value.capacity) &&
        value.capacity >= 2 &&
        value.capacity <= 100 &&
        (value.seatedWritesEnabled === undefined ||
          typeof value.seatedWritesEnabled === "boolean")))
  );
}
function configs(): Map<number, HostConfig> {
  const empty = new Map<number, HostConfig>();
  try {
    const raw = process.env.JLT_STAFF_CAL_HOSTS_JSON;
    if (!raw || Buffer.byteLength(raw) > 64 * 1024) return empty;
    const all: unknown = JSON.parse(raw);
    if (!object(all) || Object.keys(all).length > 100) return empty;
    const ids = new Set<number>(),
      keys = new Set<string>(),
      events = new Set<number>();
    for (const [key, h] of Object.entries(all)) {
      const hostId = Number(key);
      if (
        !/^[1-9]\d*$/.test(key) ||
        !positive(hostId) ||
        String(hostId) !== key ||
        !object(h) ||
        !exactKeys(h, ["apiKey", "expectedCalUserId", "oneToOne", "group"]) ||
        typeof h.apiKey !== "string" ||
        !/^cal_[A-Za-z0-9_-]{8,252}$/.test(h.apiKey) ||
        !positive(h.expectedCalUserId) ||
        !eventConfig(h.oneToOne, false) ||
        (h.group !== undefined && !eventConfig(h.group, true))
      )
        return new Map();
      if (ids.has(h.expectedCalUserId) || keys.has(h.apiKey)) return new Map();
      ids.add(h.expectedCalUserId);
      keys.add(h.apiKey);
      const one = h.oneToOne as unknown as EventConfig,
        group = h.group as EventConfig | undefined;
      for (const e of [one, group].filter((e): e is EventConfig => !!e)) {
        if (events.has(e.eventTypeId)) return new Map();
        events.add(e.eventTypeId);
      }
      empty.set(hostId, {
        apiKey: h.apiKey,
        expectedCalUserId: h.expectedCalUserId,
        oneToOne: one,
        ...(group ? { group } : {}),
      });
    }
    return empty;
  } catch {
    return new Map();
  }
}
function eventVerified(
  value: unknown,
  host: HostConfig,
  expected: EventConfig,
  kind: StaffCallKind
): boolean {
  if (
    !object(value) ||
    value.id !== expected.eventTypeId ||
    value.ownerId !== host.expectedCalUserId ||
    value.lengthInMinutes !== expected.durationMinutes ||
    !Array.isArray(value.users) ||
    value.users.length !== 1 ||
    !object(value.users[0]) ||
    value.users[0].id !== host.expectedCalUserId
  )
    return false;
  // Personal child links only; managed parents, team pools, recurring and instant writes are excluded.
  if (
    value.teamId != null ||
    value.team != null ||
    value.schedulingType != null ||
    value.isInstantEvent !== false ||
    value.recurrence != null
  )
    return false;
  if (
    value.lengthInMinutesOptions !== undefined &&
    (!Array.isArray(value.lengthInMinutesOptions) ||
      value.lengthInMinutesOptions.some(n => n !== expected.durationMinutes))
  )
    return false;
  if (kind === "oneToOne")
    return (
      value.seatsPerTimeSlot == null &&
      (value.seats == null ||
        (object(value.seats) && value.seats.disabled === true))
    );
  return (
    object(value.seats) &&
    value.seats.disabled !== true &&
    value.seats.seatsPerTimeSlot === expected.capacity &&
    value.seatsPerTimeSlot === expected.capacity &&
    value.seats.showAttendeeInfo === false &&
    value.seats.showAvailabilityCount === true
  );
}
function bookingCore(value: unknown, ready: Ready): value is Json {
  if (
    !object(value) ||
    !positive(value.id) ||
    !uid(value.uid) ||
    (value.rescheduledFromUid != null &&
      (!uid(value.rescheduledFromUid) ||
        value.rescheduledFromUid === value.uid)) ||
    !object(value.eventType) ||
    value.eventType.id !== ready.event.eventTypeId ||
    (value.eventTypeId !== undefined &&
      value.eventTypeId !== ready.event.eventTypeId) ||
    !Array.isArray(value.hosts) ||
    value.hosts.length !== 1 ||
    !object(value.hosts[0]) ||
    value.hosts[0].id !== ready.host.expectedCalUserId ||
    !["accepted", "pending", "cancelled", "rejected"].includes(
      String(value.status)
    )
  )
    return false;
  const times = interval(
    { start: value.start as string, end: value.end as string },
    1
  );
  return (
    !!times &&
    Date.parse(times.end) - Date.parse(times.start) ===
      ready.event.durationMinutes * 60_000 &&
    value.duration === ready.event.durationMinutes &&
    value.recurringBookingUid == null
  );
}
function project(
  value: unknown,
  ready: Ready,
  expected: StaffCallTarget & StaffCallIdentity,
  options: {
    bookingUid?: string;
    seatUid?: string;
    start?: string;
    previousUid?: string;
    person?: StaffParticipantIdentity;
    replacementParticipantId?: number;
  } = {}
): StaffCallBooking | null {
  if (
    !bookingCore(value, ready) ||
    (options.bookingUid && value.uid !== options.bookingUid) ||
    (options.start && iso(value.start) !== options.start) ||
    (options.previousUid &&
      value.uid !== options.previousUid &&
      value.rescheduledFromUid !== options.previousUid)
  )
    return null;
  if (!Array.isArray(value.attendees) || value.attendees.length > 100)
    return null;
  let seatUid: string | undefined,
    status = value.status as StaffCallBooking["status"];
  if (expected.kind === "group") {
    if (
      !groupRosterVerified(
        value,
        ready,
        expected,
        options.replacementParticipantId
      )
    )
      return null;
    const candidates = value.attendees.filter(
      a =>
        object(a) &&
        matchesMetadata(a.metadata, expected) &&
        (!options.seatUid || a.seatUid === options.seatUid)
    );
    if (
      candidates.length !== 1 ||
      !object(candidates[0]) ||
      !uid(candidates[0].seatUid)
    )
      return null;
    const attendee = candidates[0];
    seatUid = attendee.seatUid as string;
    if (value.seatUid !== undefined && value.seatUid !== seatUid) return null;
    if (
      options.person &&
      (attendee.name !== options.person.name ||
        attendee.email !== options.person.email)
    )
      return null;
    if (attendee.status !== undefined && attendee.status !== "cancelled")
      return null;
    if (
      attendee.confirmationStatus !== undefined &&
      !["pending", "accepted", "rejected"].includes(
        String(attendee.confirmationStatus)
      )
    )
      return null;
    if (
      attendee.status !== "cancelled" &&
      status !== "cancelled" &&
      attendee.confirmationStatus === undefined
    )
      return null;
    if (attendee.status === "cancelled") status = "cancelled";
    else if (
      status !== "cancelled" &&
      attendee.confirmationStatus !== undefined
    )
      status = attendee.confirmationStatus as StaffCallBooking["status"];
  } else {
    if (
      !matchesMetadata(value.metadata, expected) ||
      value.seatUid !== undefined ||
      value.attendees.length !== 1 ||
      !object(value.attendees[0]) ||
      value.attendees[0].seatUid !== undefined
    )
      return null;
    if (
      options.person &&
      (value.attendees[0].name !== options.person.name ||
        value.attendees[0].email !== options.person.email)
    )
      return null;
  }
  return {
    provider: "cal.com",
    providerBookingId: value.id as number,
    providerHostUserId: ready.host.expectedCalUserId,
    meetingUrl:
      safeMeetingUrl(value.location) ?? safeMeetingUrl(value.meetingUrl),
    bookingUid: value.uid as string,
    ...(uid(value.rescheduledFromUid)
      ? { previousBookingUid: value.rescheduledFromUid }
      : {}),
    ...(seatUid ? { seatUid } : {}),
    hostUserId: expected.hostUserId,
    kind: expected.kind,
    // Do not project the private cohort/roster; core must rebuild proof from durable rows.
    ...identityOnly(expected),
    eventTypeId: ready.event.eventTypeId,
    start: iso(value.start)!,
    end: iso(value.end)!,
    status,
  };
}

export class StaffCallsProvider {
  private readonly _fetch: typeof globalThis.fetch;
  private readonly _resolve: StaffCallsProviderDependencies["resolveParticipant"];
  constructor(dependencies: StaffCallsProviderDependencies) {
    this._fetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this._resolve = dependencies.resolveParticipant;
  }
  private async _request(
    host: HostConfig,
    path: string,
    version: string | undefined,
    body?: unknown
  ): Promise<StaffProviderResult<{ data: unknown; pagination?: unknown }>> {
    const write = body !== undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const bad = () => fail(write ? "UNCERTAIN" : "INVALID_PROVIDER_RESPONSE");
    try {
      const work = async (): Promise<
        StaffProviderResult<{ data: unknown; pagination?: unknown }>
      > => {
        const payload = write ? JSON.stringify(body) : undefined;
        if (payload && Buffer.byteLength(payload) > 16 * 1024)
          return fail("INVALID_INPUT");
        const response = await this._fetch(`${ORIGIN}${path}`, {
          method: write ? "POST" : "GET",
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${host.apiKey}`,
            Accept: "application/json",
            ...(version ? { "cal-api-version": version } : {}),
            ...(write ? { "Content-Type": "application/json" } : {}),
          },
          ...(payload ? { body: payload } : {}),
        });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          return fail(write ? "UNCERTAIN" : "PROVIDER_FAILURE");
        }
        if (!response.ok) {
          // Never read, return, throw or log provider error bodies/URLs/headers.
          void response.body?.cancel().catch(() => {});
          const code: StaffProviderErrorCode =
            response.status === 401 || response.status === 403
              ? "FORBIDDEN"
              : response.status === 404
                ? "NOT_FOUND"
                : response.status === 409
                  ? "CONFLICT"
                  : response.status === 429
                    ? "RATE_LIMITED"
                    : response.status === 408
                      ? write
                        ? "UNCERTAIN"
                        : "PROVIDER_FAILURE"
                      : response.status >= 400 && response.status < 500
                        ? "INVALID_INPUT"
                        : write
                          ? "UNCERTAIN"
                          : "PROVIDER_FAILURE";
          return fail(code);
        }
        const length = response.headers.get("content-length");
        if (
          (length !== null &&
            (!/^\d+$/.test(length) || Number(length) > LIMIT_BYTES)) ||
          !response.headers
            .get("content-type")
            ?.toLowerCase()
            .includes("application/json") ||
          !response.body
        ) {
          void response.body?.cancel().catch(() => {});
          return bad();
        }
        reader = response.body.getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > LIMIT_BYTES) {
            void reader.cancel().catch(() => {});
            return bad();
          }
          chunks.push(next.value);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return bad();
        }
        if (
          !object(parsed) ||
          parsed.status !== "success" ||
          !Object.hasOwn(parsed, "data")
        )
          return bad();
        return success({
          data: parsed.data,
          ...(parsed.pagination !== undefined
            ? { pagination: parsed.pagination }
            : {}),
        });
      };
      return await Promise.race([
        work(),
        new Promise<StaffProviderResult<{ data: unknown }>>(resolve => {
          timer = setTimeout(() => {
            controller.abort();
            void reader?.cancel().catch(() => {});
            resolve(fail(write ? "UNCERTAIN" : "PROVIDER_FAILURE"));
          }, TIMEOUT_MS);
        }),
      ]);
    } catch {
      return fail(write ? "UNCERTAIN" : "PROVIDER_FAILURE");
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
  private async _ready(
    input: StaffCallTarget,
    write = false
  ): Promise<StaffProviderResult<Ready>> {
    if (!target(input)) return fail("INVALID_INPUT");
    const host = configs().get(input.hostUserId),
      event = host?.[input.kind];
    if (!host || !event) return fail("UNCONNECTED");
    if (write && input.kind === "group" && event.seatedWritesEnabled !== true)
      return fail("UNAVAILABLE");
    const me = await this._request(host, "/v2/me", undefined);
    if (!me.ok) return me;
    if (!object(me.value.data) || me.value.data.id !== host.expectedCalUserId)
      return fail("UNCONNECTED");
    const type = await this._request(
      host,
      `/v2/event-types/${event.eventTypeId}`,
      STAFF_CAL_API_VERSIONS.eventType
    );
    if (!type.ok) return type;
    return eventVerified(type.value.data, host, event, input.kind)
      ? success({ host, event })
      : fail("UNCONNECTED");
  }
  async getConnectionStatus(
    hostUserId: number
  ): Promise<StaffCallConnectionStatus> {
    const status: StaffCallConnectionStatus = {
      state: "UNCONNECTED",
      hostUserId,
      oneToOne: { ready: false },
      group: { ready: false },
      busyTimes: "UNAVAILABLE",
    };
    if (!positive(hostUserId)) return status;
    const one = await this._ready({ hostUserId, kind: "oneToOne" });
    if (one.ok) {
      status.oneToOne = {
        ready: true,
        durationMinutes: one.value.event.durationMinutes,
      };
      status.state = "READY";
    }
    const group = await this._ready({ hostUserId, kind: "group" }, true);
    if (group.ok) {
      status.group = {
        ready: true,
        durationMinutes: group.value.event.durationMinutes,
        capacity: group.value.event.capacity,
      };
      status.state = "READY";
    }
    return status;
  }
  async getBusyTimes(
    input: StaffCallTarget & StaffCallInterval
  ): Promise<StaffProviderResult<StaffCallInterval[]>> {
    if (!target(input) || !interval(input)) return fail("INVALID_INPUT");
    return fail(
      configs().has(input.hostUserId) ? "UNAVAILABLE" : "UNCONNECTED"
    );
  }
  async getBookableSlots(
    input: StaffCallTarget & StaffCallInterval
  ): Promise<StaffProviderResult<StaffCallSlot[]>> {
    const times = interval(input);
    if (!target(input) || !times) return fail("INVALID_INPUT");
    const ready = await this._ready(input);
    if (!ready.ok) return ready;
    const query = new URLSearchParams({
      eventTypeId: String(ready.value.event.eventTypeId),
      start: times.start,
      end: times.end,
      format: "range",
      timeZone: "UTC",
    });
    const response = await this._request(
      ready.value.host,
      `/v2/slots?${query}`,
      STAFF_CAL_API_VERSIONS.slots
    );
    if (!response.ok) return response;
    if (
      !object(response.value.data) ||
      Object.keys(response.value.data).length > 32
    )
      return fail("INVALID_PROVIDER_RESPONSE");
    const slots: StaffCallSlot[] = [],
      seen = new Set<string>();
    for (const [date, rows] of Object.entries(response.value.data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(rows))
        return fail("INVALID_PROVIDER_RESPONSE");
      for (const row of rows) {
        if (slots.length >= 2_000 || !object(row))
          return fail("INVALID_PROVIDER_RESPONSE");
        const slot = interval(
          { start: row.start as string, end: row.end as string },
          1
        );
        if (
          !slot ||
          slot.start.slice(0, 10) !== date ||
          slot.start < times.start ||
          slot.end > times.end ||
          Date.parse(slot.end) - Date.parse(slot.start) !==
            ready.value.event.durationMinutes * 60_000 ||
          seen.has(slot.start)
        )
          return fail("INVALID_PROVIDER_RESPONSE");
        seen.add(slot.start);
        if (input.kind === "group") {
          const capacity = ready.value.event.capacity!;
          const count = row.attendeesCount ?? 0;
          if (
            !Number.isSafeInteger(count) ||
            (count as number) < 0 ||
            (count as number) >= capacity ||
            (row.bookingUid !== undefined &&
              (!uid(row.bookingUid) || row.attendeesCount === undefined)) ||
            ((count as number) > 0 && !uid(row.bookingUid))
          )
            return fail("INVALID_PROVIDER_RESPONSE");
          slots.push({
            ...slot,
            remainingSeats: capacity - (count as number),
            ...(uid(row.bookingUid) ? { bookingUid: row.bookingUid } : {}),
          });
        } else {
          if (row.attendeesCount !== undefined || row.bookingUid !== undefined)
            return fail("INVALID_PROVIDER_RESPONSE");
          slots.push(slot);
        }
      }
    }
    return success(slots.sort((a, b) => a.start.localeCompare(b.start)));
  }
  private async _participant(
    input: StaffCallTarget & StaffCallIdentity
  ): Promise<StaffParticipantIdentity | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const person = await Promise.race([
        this._resolve(identityOnly(input), input.hostUserId),
        new Promise<null>(resolve => {
          timer = setTimeout(() => resolve(null), TIMEOUT_MS);
        }),
      ]);
      if (
        !person ||
        typeof person.name !== "string" ||
        person.name.length < 1 ||
        person.name.length > 200 ||
        person.name.trim() !== person.name ||
        /[\x00-\x1f\x7f]/.test(person.name) ||
        typeof person.email !== "string" ||
        person.email.length > 320 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)
      )
        return null;
      return { name: person.name, email: person.email };
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async createBooking(
    input: StaffCallTarget &
      StaffCallIdentity & { start: string; expectedBookingUid?: string },
    guard?: StaffCallWriteGuard
  ): Promise<StaffProviderResult<StaffCallBooking>> {
    const start = iso(input.start);
    if (
      !target(input) ||
      !identity(input) ||
      !start ||
      (input.expectedBookingUid !== undefined &&
        (input.kind !== "group" || !uid(input.expectedBookingUid)))
    )
      return fail("INVALID_INPUT");
    if (!groupProofInput(input)) return fail("UNCERTAIN");
    const person = await this._participant(input);
    if (!person) return fail("FORBIDDEN");
    const ready = await this._ready(input, true);
    if (!ready.ok) return ready;
    if (input.kind === "group" && input.expectedBookingUid) {
      const before = await this._meeting(
        input,
        ready.value,
        input.expectedBookingUid
      );
      if (!before.ok) return before;
      if (
        iso(before.value.start) !== start ||
        !["accepted", "pending"].includes(String(before.value.status)) ||
        (before.value.attendees as Json[]).some(
          a => invitedMetadata(a.metadata, input) === input.participantId
        )
      )
        return fail("UNCERTAIN");
    }
    if (typeof guard !== "function") return fail("FORBIDDEN");
    // Outside _request's transport catch; core errors propagate unchanged.
    // _request begins fetch synchronously, with no intervening async preflight.
    await guard();
    const response = await this._request(
      ready.value.host,
      "/v2/bookings",
      STAFF_CAL_API_VERSIONS.booking,
      {
        eventTypeId: ready.value.event.eventTypeId,
        start,
        attendee: { ...person, timeZone: "UTC", language: "en" },
        metadata: metadata(input),
      }
    );
    if (!response.ok) return response;
    // The first private-group seat must not silently join a pre-existing session.
    // This is a post-write check: a mismatch enters recovery, never blind retry.
    if (input.kind === "group" && input.expectedBookingUid === undefined) {
      const data = response.value.data;
      if (
        !object(data) ||
        !matchesMetadata(data.metadata, input) ||
        !Array.isArray(data.attendees) ||
        data.attendees.length !== 1
      )
        return fail("UNCERTAIN");
    }
    const booking = project(response.value.data, ready.value, input, {
      start,
      person,
      bookingUid: input.expectedBookingUid,
    });
    if (!booking || !["accepted", "pending"].includes(booking.status))
      return fail("UNCERTAIN");
    if (input.kind === "group") {
      const full = await this._meeting(input, ready.value, booking.bookingUid);
      if (
        !full.ok ||
        (input.expectedBookingUid === undefined &&
          ((full.value.attendees as unknown[]).length !== 1 ||
            !matchesMetadata(full.value.metadata, input)))
      )
        return fail("UNCERTAIN");
      const verified = project(full.value, ready.value, input, {
        start,
        person,
        bookingUid: booking.bookingUid,
        seatUid: booking.seatUid,
      });
      return verified && verified.status === booking.status
        ? success(verified)
        : fail("UNCERTAIN");
    }
    return success(booking);
  }
  /** A by-seat/list response is not evidence of a complete private meeting. */
  private async _meeting(
    input: StaffCallTarget & StaffCallIdentity,
    ready: Ready,
    bookingUid: string,
    replacementParticipantId?: number
  ): Promise<StaffProviderResult<Json>> {
    const response = await this._request(
      ready.host,
      `/v2/bookings/${bookingUid}`,
      STAFF_CAL_API_VERSIONS.booking
    );
    if (!response.ok) return fail("UNCERTAIN");
    const data = response.value.data;
    return groupRosterVerified(data, ready, input, replacementParticipantId) &&
      object(data) &&
      data.uid === bookingUid
      ? success(data)
      : fail("UNCERTAIN");
  }
  private async _get(
    link: StaffCallLink,
    ready: Ready
  ): Promise<StaffProviderResult<StaffCallBooking>> {
    const path =
      link.kind === "group"
        ? `/v2/bookings/by-seat/${link.seatUid}`
        : `/v2/bookings/${link.bookingUid}`;
    const response = await this._request(
      ready.host,
      path,
      STAFF_CAL_API_VERSIONS.booking
    );
    if (!response.ok) return response;
    const booking = project(response.value.data, ready, link, {
      bookingUid: link.bookingUid,
      seatUid: link.seatUid,
    });
    if (link.kind === "group") {
      if (!booking) return fail("UNCERTAIN");
      const full = await this._meeting(link, ready, link.bookingUid);
      if (!full.ok) return full;
      if (
        full.value.id !== booking.providerBookingId ||
        iso(full.value.start) !== booking.start ||
        iso(full.value.end) !== booking.end
      )
        return fail("UNCERTAIN");
      const attendees = full.value.attendees as Json[];
      const selected = attendees.filter(
        a => invitedMetadata(a.metadata, link) === link.participantId
      );
      // Full meeting reads may omit cancelled seats. By-seat proof remains exact,
      // and any surviving occurrence of that participant must still agree.
      if (selected.length === 0 && booking.status === "cancelled")
        return success({
          ...booking,
          previousBookingUid: uid(full.value.rescheduledFromUid)
            ? full.value.rescheduledFromUid
            : undefined,
        });
      const verified = project(full.value, ready, link, {
        bookingUid: link.bookingUid,
        seatUid: link.seatUid,
      });
      return verified && verified.status === booking.status
        ? success(verified)
        : fail("UNCERTAIN");
    }
    return booking ? success(booking) : fail("INVALID_PROVIDER_RESPONSE");
  }
  async getBooking(
    link: StaffCallLink
  ): Promise<StaffProviderResult<StaffCallBooking>> {
    if (!linkValid(link)) return fail("INVALID_INPUT");
    if (!groupProofInput(link)) return fail("UNCERTAIN");
    const ready = await this._ready(link);
    return ready.ok ? this._get(link, ready.value) : ready;
  }
  async cancelBooking(
    link: StaffCallLink,
    scope: "seat" | "meeting",
    guard?: StaffCallWriteGuard
  ): Promise<StaffProviderResult<StaffCallBooking>> {
    if (
      !linkValid(link) ||
      !["seat", "meeting"].includes(scope) ||
      (scope === "seat" && link.kind !== "group")
    )
      return fail("INVALID_INPUT");
    if (!groupProofInput(link)) return fail("UNCERTAIN");
    if (link.kind === "group" && scope === "meeting")
      return fail("UNAVAILABLE");
    const ready = await this._ready(link, true);
    if (!ready.ok) return ready;
    const before = await this._get(link, ready.value);
    if (!before.ok) return before;
    // A cancelled seat does not establish that the whole session is cancelled.
    if (before.value.status === "cancelled" && scope === "seat") return before;
    if (typeof guard !== "function") return fail("FORBIDDEN");
    // No await between fresh core authorization and _request starting fetch.
    await guard();
    const response = await this._request(
      ready.value.host,
      `/v2/bookings/${link.bookingUid}/cancel`,
      STAFF_CAL_API_VERSIONS.booking,
      {
        cancellationReason: "Cancelled in JLT Portal",
        ...(scope === "seat" ? { seatUid: link.seatUid } : {}),
      }
    );
    if (!response.ok) return response;
    if (
      !bookingCore(response.value.data, ready.value) ||
      response.value.data.uid !== link.bookingUid ||
      (scope === "meeting" && response.value.data.status !== "cancelled")
    )
      return fail("UNCERTAIN");
    if (link.kind === "group") {
      if (!groupRosterVerified(response.value.data, ready.value, link))
        return fail("UNCERTAIN");
      const after = await this._get(link, ready.value);
      return after.ok && after.value.status === "cancelled"
        ? after
        : fail("UNCERTAIN");
    }
    const booking = project(response.value.data, ready.value, link, {
      bookingUid: link.bookingUid,
    });
    return booking && booking.status === "cancelled"
      ? success(booking)
      : fail("UNCERTAIN");
  }
  async rescheduleBooking(
    link: StaffCallLink,
    newStart: string,
    guard?: StaffCallWriteGuard
  ): Promise<StaffProviderResult<StaffCallBooking>> {
    const start = iso(newStart);
    if (!linkValid(link) || !start) return fail("INVALID_INPUT");
    if (!groupProofInput(link)) return fail("UNCERTAIN");
    const ready = await this._ready(link, true);
    if (!ready.ok) return ready;
    const before = await this._get(link, ready.value);
    if (!before.ok) return before;
    if (!["accepted", "pending"].includes(before.value.status))
      return fail("CONFLICT");
    if (typeof guard !== "function") return fail("FORBIDDEN");
    // Core FORBIDDEN/CONFLICT must not become sanitized transport uncertainty.
    await guard();
    const response = await this._request(
      ready.value.host,
      `/v2/bookings/${link.bookingUid}/reschedule`,
      STAFF_CAL_API_VERSIONS.booking,
      { start, ...(link.kind === "group" ? { seatUid: link.seatUid } : {}) }
    );
    if (!response.ok) return response;
    const booking = project(response.value.data, ready.value, link, {
      start,
      previousUid: link.bookingUid,
      replacementParticipantId:
        link.kind === "group" ? link.participantId : undefined,
    });
    if (!booking || !["accepted", "pending"].includes(booking.status))
      return fail("UNCERTAIN");
    if (link.kind === "group") {
      const full = await this._meeting(
        link,
        ready.value,
        booking.bookingUid,
        link.participantId
      );
      if (!full.ok) return fail("UNCERTAIN");
      const verified = project(full.value, ready.value, link, {
        bookingUid: booking.bookingUid,
        seatUid: booking.seatUid,
        start,
        previousUid: link.bookingUid,
        replacementParticipantId: link.participantId,
      });
      return verified && verified.status === booking.status
        ? success(verified)
        : fail("UNCERTAIN");
    }
    return success(booking);
  }
  /** Bounded exact-ID reconciliation, never email matching. Incomplete absence is not a failed create. */
  async reconcileOperation(
    input: StaffCallTarget & StaffCallIdentity & StaffCallInterval
  ): Promise<StaffProviderResult<StaffCallReconciliation>> {
    const times = interval(input);
    if (!target(input) || !identity(input) || !times)
      return fail("INVALID_INPUT");
    if (!groupProofInput(input)) return fail("UNCERTAIN");
    const ready = await this._ready(input);
    if (!ready.ok) return ready;
    const bookings: StaffCallBooking[] = [],
      seen = new Set<string>(),
      cursors = new Set<string>();
    let cursor: string | undefined;
    let meetingReads = 0;
    for (let page = 0; page < 3; page++) {
      const query = new URLSearchParams({
        eventTypeId: String(ready.value.event.eventTypeId),
        afterStart: times.start,
        beforeEnd: times.end,
        limit: "50",
        ...(cursor ? { cursor } : {}),
      });
      const response = await this._request(
        ready.value.host,
        `/v2/bookings?${query}`,
        STAFF_CAL_API_VERSIONS.list
      );
      if (!response.ok) return response;
      const rows = response.value.data,
        pagination = response.value.pagination;
      if (
        !Array.isArray(rows) ||
        rows.length > 50 ||
        !object(pagination) ||
        typeof pagination.hasMore !== "boolean" ||
        (pagination.hasMore
          ? typeof pagination.nextCursor !== "string" ||
            pagination.nextCursor.length < 1 ||
            pagination.nextCursor.length > 2_048
          : pagination.nextCursor !== null)
      )
        return fail("INVALID_PROVIDER_RESPONSE");
      for (const row of rows) {
        if (!bookingCore(row, ready.value))
          return fail(
            input.kind === "group" ? "UNCERTAIN" : "INVALID_PROVIDER_RESPONSE"
          );
        const matched =
          matchesMetadata(row.metadata, input) ||
          (input.kind === "group" &&
            Array.isArray(row.attendees) &&
            row.attendees.some(
              a => object(a) && matchesMetadata(a.metadata, input)
            ));
        if (!matched) continue; // discard unrelated private booking fields immediately
        let booking = project(row, ready.value, input);
        if (input.kind === "group") {
          if (!booking) return fail("UNCERTAIN");
          const key = `${booking.bookingUid}:${booking.seatUid}`;
          if (seen.has(key)) continue;
          // Bounded proof budget: no complete/absent assertion if more matches remain.
          if (meetingReads >= 3) return success({ bookings, complete: false });
          meetingReads++;
          const full = await this._meeting(
            input,
            ready.value,
            booking.bookingUid
          );
          if (!full.ok) return fail("UNCERTAIN");
          const verified = project(full.value, ready.value, input, {
            bookingUid: booking.bookingUid,
            seatUid: booking.seatUid,
          });
          if (
            !verified ||
            verified.start !== booking.start ||
            verified.end !== booking.end ||
            verified.providerBookingId !== booking.providerBookingId ||
            verified.status !== booking.status
          )
            return fail("UNCERTAIN");
          booking = verified;
        }
        if (!booking || booking.start < times.start || booking.end > times.end)
          return fail(
            input.kind === "group" ? "UNCERTAIN" : "INVALID_PROVIDER_RESPONSE"
          );
        const key = `${booking.bookingUid}:${booking.seatUid ?? ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          bookings.push(booking);
        }
      }
      if (!pagination.hasMore) return success({ bookings, complete: true });
      cursor = pagination.nextCursor as string;
      if (cursors.has(cursor)) return fail("INVALID_PROVIDER_RESPONSE");
      cursors.add(cursor);
    }
    return success({ bookings, complete: false });
  }
}

export interface StaffCallLifecycleEvent {
  receiptHash: string;
  event: "BOOKING_CREATED" | "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED";
  createdAt: string;
  bookingUid: string;
  previousBookingUid?: string;
  seatUid?: string;
  eventTypeId: number;
  start: string;
  end: string;
  identity: StaffCallIdentity;
  hostUserId: number;
}
export type StaffCallWebhookResult =
  | { ok: true; ignored: true; receiptHash: string }
  | { ok: true; ignored: false; value: StaffCallLifecycleEvent }
  | { ok: false; code: "UNCONNECTED" | "INVALID_SIGNATURE" | "INVALID_BODY" };
/** Raw bytes only. Parent must durably dedupe receiptHash and authoritatively verify stored linkage. */
export function verifyStaffCallWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  linked: (event: StaffCallLifecycleEvent) => boolean
): StaffCallWebhookResult {
  const secret = process.env.JLT_STAFF_CAL_WEBHOOK_SECRET;
  if (
    !secret ||
    Buffer.byteLength(secret) < 32 ||
    Buffer.byteLength(secret) > 1_024
  )
    return { ok: false, code: "UNCONNECTED" };
  if (
    !Buffer.isBuffer(rawBody) ||
    rawBody.byteLength === 0 ||
    rawBody.byteLength > LIMIT_BYTES
  )
    return { ok: false, code: "INVALID_BODY" };
  if (typeof signature !== "string" || !/^[a-fA-F0-9]{64}$/.test(signature))
    return { ok: false, code: "INVALID_SIGNATURE" };
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, "hex");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(expected, supplied)
  )
    return { ok: false, code: "INVALID_SIGNATURE" };
  const receiptHash = createHash("sha256")
    .update(NAMESPACE)
    .update("\0")
    .update(rawBody)
    .digest("hex");
  const ignored: StaffCallWebhookResult = {
    ok: true,
    ignored: true,
    receiptHash,
  };
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { ok: false, code: "INVALID_BODY" };
  }
  if (!object(body)) return { ok: false, code: "INVALID_BODY" };
  if (
    !["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"].includes(
      String(body.triggerEvent)
    )
  )
    return ignored;
  const payload = body.payload;
  if (
    !object(payload) ||
    !object(payload.metadata) ||
    payload.metadata.jltNamespace !== NAMESPACE
  )
    return ignored;
  const m = payload.metadata;
  const hostUserId = Number(m.jltHostUserId),
    callId = Number(m.jltCallId),
    participantId = Number(m.jltParticipantId);
  if (
    !positive(hostUserId) ||
    m.jltHostUserId !== String(hostUserId) ||
    !positive(callId) ||
    m.jltCallId !== String(callId) ||
    !positive(participantId) ||
    m.jltParticipantId !== String(participantId) ||
    !uid(m.jltOperationId)
  )
    return ignored;
  const host = configs().get(hostUserId);
  if (
    !host ||
    !object(payload.organizer) ||
    payload.organizer.id !== host.expectedCalUserId ||
    !positive(payload.eventTypeId)
  )
    return ignored;
  const isGroup = host.group?.eventTypeId === payload.eventTypeId;
  const event = isGroup
    ? host.group!
    : host.oneToOne.eventTypeId === payload.eventTypeId
      ? host.oneToOne
      : null;
  if (!event) return ignored;
  const times = interval(
      { start: payload.startTime as string, end: payload.endTime as string },
      1
    ),
    createdAt = iso(body.createdAt);
  if (payload.schedulingType != null) return ignored;
  if (
    !createdAt ||
    !times ||
    Date.parse(times.end) - Date.parse(times.start) !==
      event.durationMinutes * 60_000 ||
    !uid(payload.uid)
  )
    return { ok: false, code: "INVALID_BODY" };
  if (
    !["ACCEPTED", "PENDING", "CANCELLED", "REJECTED"].includes(
      String(payload.status)
    ) ||
    (body.triggerEvent === "BOOKING_CANCELLED" &&
      payload.status !== "CANCELLED") ||
    (body.triggerEvent !== "BOOKING_CANCELLED" &&
      !["ACCEPTED", "PENDING"].includes(String(payload.status)))
  )
    return { ok: false, code: "INVALID_BODY" };
  // Lifecycle docs do not guarantee seat UID. Do not infer it from attendee email.
  const seatUid = payload.attendeeSeatId;
  if (isGroup && (!uid(seatUid) || payload.seatsPerTimeSlot !== event.capacity))
    return ignored;
  if (isGroup) {
    if (
      event.seatedWritesEnabled !== true ||
      !Array.isArray(payload.attendees) ||
      payload.attendees.length !== 1 ||
      !object(payload.attendees[0])
    )
      return ignored;
    const attendee = payload.attendees[0];
    if (
      attendee.seatUid !== seatUid ||
      !matchesMetadata(attendee.metadata, {
        hostUserId,
        kind: "group",
        callId,
        participantId,
        operationId: m.jltOperationId,
      })
    )
      return ignored;
  }
  if (!isGroup && (seatUid !== undefined || payload.seatsPerTimeSlot != null))
    return ignored;
  const previousBookingUid = payload.rescheduleUid;
  if (body.triggerEvent === "BOOKING_RESCHEDULED" && !uid(previousBookingUid))
    return { ok: false, code: "INVALID_BODY" };
  if (body.triggerEvent === "BOOKING_RESCHEDULED") {
    const previous = interval(
      {
        start: payload.rescheduleStartTime as string,
        end: payload.rescheduleEndTime as string,
      },
      1
    );
    if (
      !previous ||
      Date.parse(previous.end) - Date.parse(previous.start) !==
        event.durationMinutes * 60_000
    )
      return { ok: false, code: "INVALID_BODY" };
  }
  const value: StaffCallLifecycleEvent = {
    receiptHash,
    event: body.triggerEvent as StaffCallLifecycleEvent["event"],
    createdAt,
    bookingUid: payload.uid,
    ...(body.triggerEvent === "BOOKING_RESCHEDULED"
      ? { previousBookingUid: previousBookingUid as string }
      : {}),
    ...(isGroup ? { seatUid: seatUid as string } : {}),
    eventTypeId: payload.eventTypeId,
    ...times,
    identity: { callId, participantId, operationId: m.jltOperationId },
    hostUserId,
  };
  try {
    return linked(value) === true
      ? { ok: true, ignored: false, value }
      : ignored;
  } catch {
    return ignored;
  }
}
