import { createHmac } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STAFF_CAL_API_VERSIONS,
  StaffCallsProvider,
  verifyStaffCallWebhook,
  type StaffCallIdentity,
  type StaffCallLink,
  type StaffCallWriteGuard,
} from "./staff-calls-provider";

const start = "2026-12-01T10:00:00.000Z",
  end = "2026-12-01T10:30:00.000Z";
const identity: StaffCallIdentity = {
  callId: 7,
  participantId: 9,
  operationId: "op-unique-1",
};
const target = { hostUserId: 42, kind: "oneToOne" as const };
const person = { name: "Exact Agent Name", email: "agent@example.com" };
// Explicit mock-only authorization; no provider defaults or failure-test bypasses.
const allowTestWrite: StaffCallWriteGuard = async () => {};
const link: StaffCallLink = {
  ...target,
  ...identity,
  bookingUid: "booking-actual-1",
};
const groupLink: StaffCallLink = {
  ...link,
  kind: "group",
  invitedParticipantIds: [9, 10],
  seatUid: "seat-actual-1",
};
const meta = (overrides = {}) => ({
  jltNamespace: "jlt-staff-calls",
  jltHostUserId: "42",
  jltCallId: "7",
  jltParticipantId: "9",
  jltOperationId: "op-unique-1",
  ...overrides,
});
function config(overrides = {}) {
  return {
    "42": {
      apiKey: "cal_mock_HOST_KEY_1234",
      expectedCalUserId: 123,
      oneToOne: { eventTypeId: 11, durationMinutes: 30 },
      group: {
        eventTypeId: 12,
        durationMinutes: 30,
        capacity: 4,
        seatedWritesEnabled: true,
      },
      ...overrides,
    },
  };
}
function event(group = false, overrides = {}) {
  return {
    id: group ? 12 : 11,
    ownerId: 123,
    users: [{ id: 123, name: "Private host" }],
    lengthInMinutes: 30,
    isInstantEvent: false,
    recurrence: null,
    seatsPerTimeSlot: group ? 4 : null,
    seats: group
      ? {
          seatsPerTimeSlot: 4,
          showAttendeeInfo: false,
          showAvailabilityCount: true,
        }
      : null,
    title: "Private sensitive title",
    destinationCalendar: { externalId: "private@example.com" },
    ...overrides,
  };
}
function booking(group = false, overrides = {}) {
  return {
    id: 1001,
    uid: "booking-actual-1",
    eventType: { id: group ? 12 : 11 },
    eventTypeId: group ? 12 : 11,
    hosts: [{ id: 123, email: "private-host@example.com" }],
    status: "accepted",
    start,
    end,
    duration: 30,
    metadata: meta(),
    attendees: [
      {
        ...person,
        ...(group
          ? {
              seatUid: "seat-actual-1",
              metadata: meta(),
              confirmationStatus: "accepted",
            }
          : {}),
      },
    ],
    ...(group ? { seatUid: "seat-actual-1" } : {}),
    title: "Very private title",
    description: "Private notes",
    location: "https://private-meeting.example/secret",
    absentHost: false,
    ...overrides,
  };
}
function json(data: unknown, status = 200, extra = {}) {
  return new Response(JSON.stringify({ status: "success", data, ...extra }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function mockProvider(
  handler?: (url: URL, init: RequestInit) => Response | Promise<Response>
) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.cal.com")
      throw new Error("No network permitted");
    if (handler) return handler(url, init!);
    if (url.pathname === "/v2/me")
      return json({ id: 123, email: "private@example.com" });
    if (url.pathname.startsWith("/v2/event-types/"))
      return json(event(url.pathname.endsWith("/12")));
    if (url.pathname === "/v2/slots")
      return json({ "2026-12-01": [{ start, end }] });
    if (url.pathname === "/v2/bookings" && init!.method === "GET")
      return json([], 200, {
        pagination: { nextCursor: null, hasMore: false },
      });
    return json(booking(url.pathname.includes("by-seat")));
  });
  const resolveParticipant = vi.fn(async () => person);
  return {
    provider: new StaffCallsProvider({ fetch, resolveParticipant }),
    fetch,
    resolveParticipant,
  };
}
function routes(
  write: (url: URL, init: RequestInit) => Response | Promise<Response>,
  type = event()
) {
  return (url: URL, init: RequestInit) =>
    url.pathname === "/v2/me"
      ? json({ id: 123 })
      : url.pathname.startsWith("/v2/event-types/")
        ? json(type)
        : write(url, init);
}
beforeEach(() => {
  vi.stubEnv("JLT_STAFF_CAL_HOSTS_JSON", JSON.stringify(config()));
  vi.stubEnv(
    "JLT_STAFF_CAL_WEBHOOK_SECRET",
    "staff-secret-distinct-32-characters-long"
  );
  // All tests reject accidental real fetch, including adapters constructed without the seam.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network prohibited in provider tests");
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("consented per-host configuration and verification", () => {
  it("exports exact current versions", () => {
    expect(STAFF_CAL_API_VERSIONS).toEqual({
      slots: "2024-09-04",
      booking: "2026-02-25",
      list: "2026-05-01",
      eventType: "2026-06-12",
    });
  });
  it.each([
    undefined,
    "",
    "{broken",
    "[]",
    JSON.stringify({ "042": config()["42"] }),
    JSON.stringify({ "0": config()["42"] }),
    JSON.stringify(config({ apiKey: "https://attacker.invalid/token" })),
    JSON.stringify(config({ url: "https://attacker.invalid" })),
    JSON.stringify(config({ expectedCalUserId: "123" })),
    JSON.stringify(
      config({ oneToOne: { eventTypeId: -1, durationMinutes: 30 } })
    ),
    JSON.stringify({ ...config(), "43": config()["42"] }),
  ])("fails closed without requests for invalid env %s", async value => {
    if (value === undefined) delete process.env.JLT_STAFF_CAL_HOSTS_JSON;
    else process.env.JLT_STAFF_CAL_HOSTS_JSON = value;
    const { provider, fetch } = mockProvider();
    expect(await provider.getConnectionStatus(42)).toEqual({
      state: "UNCONNECTED",
      hostUserId: 42,
      oneToOne: { ready: false },
      group: { ready: false },
      busyTimes: "UNAVAILABLE",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never falls back to recruitment/global credentials", async () => {
    delete process.env.JLT_STAFF_CAL_HOSTS_JSON;
    vi.stubEnv("CALCOM_API_KEY", "cal_recruitment_key");
    const { provider, fetch } = mockProvider();
    expect(
      await provider.createBooking(
        { ...target, ...identity, start },
        allowTestWrite
      )
    ).toMatchObject({ ok: false, code: "UNCONNECTED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("checks exact /me data.id, not nested data.user or owner assertions", async () => {
    for (const me of [{ id: 999 }, { user: { id: 123 } }, [{ id: 123 }]]) {
      const { provider, fetch } = mockProvider(() => json(me));
      expect((await provider.getConnectionStatus(42)).state).toBe(
        "UNCONNECTED"
      );
      expect(
        fetch.mock.calls.every(([url]) => String(url).endsWith("/v2/me"))
      ).toBe(true);
    }
  });
  it.each([
    { ownerId: 999 },
    { users: [{ id: 999 }] },
    { users: [{ id: 123 }, { id: 999 }] },
    { teamId: 1 },
    { schedulingType: "MANAGED" },
    { recurrence: { count: 2 } },
    { isInstantEvent: true },
    { lengthInMinutes: 45 },
    { lengthInMinutesOptions: [30, 60] },
    { seatsPerTimeSlot: 2 },
    { id: 999 },
  ])("rejects non-owned/unsupported event %s", async overrides => {
    const { provider } = mockProvider(
      routes(() => json({}), event(false, overrides))
    );
    expect(
      await provider.getBookableSlots({ ...target, start, end })
    ).toMatchObject({ ok: false, code: "UNCONNECTED" });
  });
  it("only projects safe ready status and fixed host-scoped credentials", async () => {
    const { provider, fetch } = mockProvider();
    const status = await provider.getConnectionStatus(42);
    expect(status).toEqual({
      state: "READY",
      hostUserId: 42,
      oneToOne: { ready: true, durationMinutes: 30 },
      group: { ready: true, durationMinutes: 30, capacity: 4 },
      busyTimes: "UNAVAILABLE",
    });
    expect(JSON.stringify(status)).not.toMatch(
      /cal_|email|calendar|title|token/i
    );
    for (const [url, init] of fetch.mock.calls) {
      expect(String(url).startsWith("https://api.cal.com/v2/")).toBe(true);
      expect(init).toMatchObject({
        redirect: "manual",
        credentials: "omit",
        headers: { Authorization: "Bearer cal_mock_HOST_KEY_1234" },
      });
      if (String(url).includes("event-types"))
        expect(init!.headers).toMatchObject({
          "cal-api-version": "2026-06-12",
        });
      else expect(init!.headers).not.toHaveProperty("cal-api-version");
    }
  });
  it("does not let one host key silently serve another host", async () => {
    const { provider, fetch } = mockProvider();
    expect((await provider.getConnectionStatus(43)).state).toBe("UNCONNECTED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { seatsPerTimeSlot: 5 },
    {
      seats: {
        seatsPerTimeSlot: 4,
        disabled: true,
        showAttendeeInfo: false,
        showAvailabilityCount: true,
      },
    },
    {
      seats: {
        seatsPerTimeSlot: 4,
        showAttendeeInfo: true,
        showAvailabilityCount: true,
      },
    },
    {
      seats: {
        seatsPerTimeSlot: 4,
        showAttendeeInfo: false,
        showAvailabilityCount: false,
      },
    },
  ])("fails closed for invalid seating %s", async overrides => {
    const { provider } = mockProvider(
      routes(() => json({}), event(true, overrides))
    );
    expect(
      await provider.createBooking({ ...groupLink, start }, allowTestWrite)
    ).toMatchObject({ ok: false, code: "UNCONNECTED" });
  });
  it("defaults group writes off even when reads are configured", async () => {
    process.env.JLT_STAFF_CAL_HOSTS_JSON = JSON.stringify(
      config({ group: { eventTypeId: 12, durationMinutes: 30, capacity: 4 } })
    );
    const { provider, fetch } = mockProvider();
    expect(
      await provider.createBooking({ ...groupLink, start }, allowTestWrite)
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(
      await provider.cancelBooking(groupLink, "seat", allowTestWrite)
    ).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("bounded UTC slot projection", () => {
  it("requests bookable range slots with correct version and strips private fields", async () => {
    const { provider, fetch } = mockProvider(
      routes(() =>
        json({
          "2026-12-01": [
            {
              start: "2026-12-01T11:00:00+01:00",
              end: "2026-12-01T11:30:00+01:00",
              title: "private",
            },
          ],
        })
      )
    );
    expect(await provider.getBookableSlots({ ...target, start, end })).toEqual({
      ok: true,
      value: [{ start, end }],
    });
    const [url, init] = fetch.mock.calls.at(-1)!;
    expect(new URL(String(url)).searchParams.get("format")).toBe("range");
    expect(new URL(String(url)).searchParams.get("timeZone")).toBe("UTC");
    expect(init!.headers).toMatchObject({ "cal-api-version": "2024-09-04" });
  });
  it.each([
    "2026-02-30T10:00:00Z",
    "2026-12-01",
    "2026-12-01T10:00:00",
    "2026-12-01T25:00:00Z",
    "2026-12-01T10:00:00+99:00",
  ])("rejects invalid date %s without requests", async badStart => {
    const { provider, fetch } = mockProvider();
    expect(
      await provider.getBookableSlots({ ...target, start: badStart, end })
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds the requested range", async () => {
    const { provider, fetch } = mockProvider();
    expect(
      await provider.getBookableSlots({
        ...target,
        start,
        end: "2027-02-01T10:00:00Z",
      })
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { start, end: "2026-12-01T11:00:00Z" },
    { start: "2026-02-30T10:00:00Z", end },
    { start, end, bookingUid: "unexpected" },
  ])("rejects invalid or mismatched provider slot %s", async row => {
    const { provider } = mockProvider(
      routes(() => json({ "2026-12-01": [row] }))
    );
    expect(
      await provider.getBookableSlots({ ...target, start, end })
    ).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
  it("projects seated capacity and provider meeting UID", async () => {
    const { provider } = mockProvider(
      routes(
        () =>
          json({
            "2026-12-01": [
              {
                start,
                end,
                attendeesCount: 2,
                bookingUid: "meeting-1",
                attendeeEmails: ["secret"],
              },
            ],
          }),
        event(true)
      )
    );
    expect(
      await provider.getBookableSlots({ ...groupLink, start, end })
    ).toEqual({
      ok: true,
      value: [{ start, end, remainingSeats: 2, bookingUid: "meeting-1" }],
    });
  });
  it.each([
    { attendeesCount: 4, bookingUid: "meeting-1" },
    { attendeesCount: -1 },
    { attendeesCount: 1 },
    { attendeesCount: 1, bookingUid: "https://attacker.invalid" },
  ])("rejects invalid seated slots %s", async extra => {
    const { provider } = mockProvider(
      routes(
        () => json({ "2026-12-01": [{ start, end, ...extra }] }),
        event(true)
      )
    );
    expect(
      await provider.getBookableSlots({ ...groupLink, start, end })
    ).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
  it("does not fake entitled busy-time access", async () => {
    const { provider, fetch } = mockProvider();
    expect(
      await provider.getBusyTimes({ ...target, start, end })
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("exact server identity and actual booking/seat IDs", () => {
  it("creates with resolver identity and namespaced IDs, ignoring surplus caller name/email/url", async () => {
    const { provider, fetch, resolveParticipant } = mockProvider(
      routes(() => json(booking(), 201))
    );
    const result = await provider.createBooking(
      {
        ...target,
        ...identity,
        start,
        name: "Wrong",
        email: "wrong@invalid.example",
        url: "https://attacker.invalid",
      } as never,
      allowTestWrite
    );
    expect(result).toEqual({
      ok: true,
      value: {
        provider: "cal.com",
        providerBookingId: 1001,
        providerHostUserId: 123,
        meetingUrl: "https://private-meeting.example/secret",
        ...link,
        eventTypeId: 11,
        start,
        end,
        status: "accepted",
      },
    });
    expect(resolveParticipant).toHaveBeenCalledWith(identity, 42);
    const [url, init] = fetch.mock.calls.at(-1)!;
    expect(url).toBe("https://api.cal.com/v2/bookings");
    expect(init!.headers).toMatchObject({ "cal-api-version": "2026-02-25" });
    expect(JSON.parse(init!.body as string)).toEqual({
      eventTypeId: 11,
      start,
      attendee: { ...person, timeZone: "UTC", language: "en" },
      metadata: meta(),
    });
    expect(JSON.stringify(result)).not.toMatch(/email|location|title|absent/);
  });
  it.each([
    "http://meet.example/room",
    "javascript:alert(1)",
    "https://user:pass@meet.example/room",
    "https://127.0.0.1/room",
    "https://localhost/room",
    "https://calendar.internal/room",
    "https://meet.example:444/room",
    "not a URL",
  ])("nulls unsafe meeting URL %s without fetching it", async location => {
    const { provider, fetch } = mockProvider(
      routes(() => json(booking(false, { location }), 201))
    );
    expect(
      await provider.createBooking(
        { ...target, ...identity, start },
        allowTestWrite
      )
    ).toMatchObject({
      ok: true,
      value: { meetingUrl: null, hostUserId: 42, providerHostUserId: 123 },
    });
    expect(
      fetch.mock.calls.every(([url]) =>
        String(url).startsWith("https://api.cal.com/")
      )
    ).toBe(true);
  });
  it("marks later group-seat creation uncertain when provider returns a different meeting", async () => {
    const { provider, fetch } = mockProvider(
      routes(
        (_url, init) =>
          json(
            init.method === "POST"
              ? booking(true)
              : booking(true, { seatUid: undefined, attendees: [] })
          ),
        event(true)
      )
    );
    expect(
      await provider.createBooking(
        {
          ...groupLink,
          start,
          expectedBookingUid: "other-session",
        },
        allowTestWrite
      )
    ).toMatchObject({ code: "UNCERTAIN" });
    expect(
      fetch.mock.calls.filter(([, init]) => init!.method === "POST")
    ).toHaveLength(0);
    // An actual later seat requires a different already-invited participant.
    const other = booking(true, {
      seatUid: undefined,
      metadata: meta({ jltParticipantId: "10" }),
      attendees: [
        {
          name: "Prior invited",
          seatUid: "prior-seat",
          metadata: meta({ jltParticipantId: "10" }),
          confirmationStatus: "accepted",
        },
      ],
    });
    let written = false;
    const later = mockProvider(
      routes((_url, init) => {
        if (init.method === "POST") written = true;
        return json(
          written
            ? booking(true, {
                metadata: other.metadata,
                attendees: [...other.attendees, ...booking(true).attendees],
              })
            : other
        );
      }, event(true))
    );
    expect(
      await later.provider.createBooking(
        {
          ...groupLink,
          start,
          expectedBookingUid: groupLink.bookingUid,
        },
        allowTestWrite
      )
    ).toMatchObject({ ok: true, value: { bookingUid: groupLink.bookingUid } });
  });
  it("fails without a server participant identity and makes no request", async () => {
    const fetch = vi.fn();
    const provider = new StaffCallsProvider({
      fetch,
      resolveParticipant: async () => null,
    });
    expect(
      await provider.createBooking(
        { ...target, ...identity, start },
        allowTestWrite
      )
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { uid: "https://attacker.invalid" },
    { id: -1 },
    { hosts: [{ id: 999 }] },
    { eventType: { id: 999 } },
    { status: "awaiting_host" },
    { metadata: meta({ jltParticipantId: "10" }) },
    { start: "2026-12-01T10:01:00Z" },
    { end: "2026-12-01T10:45:00Z" },
    { duration: 45 },
    { attendees: [{ ...person, name: "Wrong" }] },
  ])(
    "marks malformed/mismatched create success uncertain %s",
    async overrides => {
      const { provider, fetch } = mockProvider(
        routes(() => json(booking(false, overrides), 201))
      );
      expect(
        await provider.createBooking(
          { ...target, ...identity, start },
          allowTestWrite
        )
      ).toMatchObject({ code: "UNCERTAIN", uncertain: true });
      expect(
        fetch.mock.calls.filter(([, init]) => init!.method === "POST")
      ).toHaveLength(1);
    }
  );
  it("projects exact new group seat metadata instead of the first booker's session metadata", async () => {
    let written = false;
    const { provider } = mockProvider(
      routes((_url, init) => {
        if (init.method === "POST") written = true;
        return json(
          booking(true, {
            metadata: meta({ jltParticipantId: "10" }),
            ...(written ? {} : { seatUid: undefined, attendees: [] }),
          }),
          201
        );
      }, event(true))
    );
    expect(
      await provider.createBooking({ ...groupLink, start }, allowTestWrite)
    ).toMatchObject({ code: "UNCERTAIN" });
    written = false;
    expect(
      await provider.createBooking(
        {
          ...groupLink,
          start,
          expectedBookingUid: groupLink.bookingUid,
        },
        allowTestWrite
      )
    ).toMatchObject({
      ok: true,
      value: {
        bookingUid: "booking-actual-1",
        seatUid: "seat-actual-1",
        participantId: 9,
      },
    });
  });
  it("does not silently accept a first seat in an existing outsider session", async () => {
    const { provider } = mockProvider(
      routes(
        () =>
          json(
            booking(true, {
              attendees: [
                {
                  ...person,
                  seatUid: "seat-actual-1",
                  metadata: meta(),
                  confirmationStatus: "accepted",
                },
                { name: "Outsider", seatUid: "outsider-seat", metadata: {} },
              ],
            }),
            201
          ),
        event(true)
      )
    );
    expect(
      await provider.createBooking({ ...groupLink, start }, allowTestWrite)
    ).toMatchObject({ code: "UNCERTAIN" });
  });
  it("fails closed if seated creation cannot identify one exact seat", async () => {
    const { provider } = mockProvider(
      routes(
        () =>
          json(
            booking(true, { attendees: [{ ...person, seatUid: "seat-1" }] }),
            201
          ),
        event(true)
      )
    );
    expect(
      await provider.createBooking({ ...groupLink, start }, allowTestWrite)
    ).toMatchObject({ code: "UNCERTAIN" });
  });
  it("gets a cancelled seat with by-seat UID, not a guessed ID or whole roster", async () => {
    const { provider, fetch } = mockProvider(
      routes(
        () =>
          json(
            booking(true, {
              seatUid: undefined,
              attendees: [
                {
                  ...person,
                  metadata: meta(),
                  seatUid: "seat-actual-1",
                  status: "cancelled",
                },
              ],
            })
          ),
        event(true)
      )
    );
    expect(await provider.getBooking(groupLink)).toMatchObject({
      ok: true,
      value: { status: "cancelled", seatUid: "seat-actual-1" },
    });
    expect(
      fetch.mock.calls.some(
        ([url]) =>
          url === "https://api.cal.com/v2/bookings/by-seat/seat-actual-1"
      )
    ).toBe(true);
    expect(fetch.mock.calls.at(-1)![0]).toBe(
      "https://api.cal.com/v2/bookings/booking-actual-1"
    );
  });
  it("refuses to mutate an unrelated booking even if a caller knows its UID", async () => {
    const { provider, fetch } = mockProvider(
      routes(() => json(booking(false, { metadata: meta({ jltCallId: "8" }) })))
    );
    expect(
      await provider.cancelBooking(link, "meeting", allowTestWrite)
    ).toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
    expect(fetch.mock.calls.some(([, init]) => init!.method === "POST")).toBe(
      false
    );
  });
  it("cancels one seat without cancelling the meeting", async () => {
    let cancelled = false;
    const { provider, fetch } = mockProvider(
      routes((_url, init) => {
        if (init.method === "POST") {
          cancelled = true;
          return json(booking(true, { seatUid: undefined, attendees: [] }));
        }
        return json(
          booking(true, {
            seatUid: undefined,
            attendees: [
              {
                ...person,
                metadata: meta(),
                seatUid: groupLink.seatUid,
                ...(cancelled
                  ? { status: "cancelled" }
                  : { confirmationStatus: "accepted" }),
              },
            ],
          })
        );
      }, event(true))
    );
    expect(
      await provider.cancelBooking(groupLink, "seat", allowTestWrite)
    ).toMatchObject({
      ok: true,
      value: { status: "cancelled" },
    });
    const [, init] = fetch.mock.calls.find(
      ([, init]) => init!.method === "POST"
    )!;
    expect(JSON.parse(init!.body as string)).toEqual({
      cancellationReason: "Cancelled in JLT Portal",
      seatUid: "seat-actual-1",
    });
  });
  it("never cancels a whole group meeting even with verified host credentials", async () => {
    let cancelled = false;
    const { provider, fetch } = mockProvider(
      routes((_url, init) => {
        if (init.method === "POST") cancelled = true;
        return json(
          booking(true, { status: cancelled ? "cancelled" : "accepted" })
        );
      }, event(true))
    );
    expect(
      await provider.cancelBooking(groupLink, "meeting", allowTestWrite)
    ).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not declare whole group cancellation complete from a cancelled seat alone", async () => {
    const { provider } = mockProvider(
      routes(
        (_url, init) =>
          json(
            booking(
              true,
              init.method === "POST"
                ? {}
                : {
                    attendees: [
                      {
                        ...person,
                        metadata: meta(),
                        seatUid: groupLink.seatUid,
                        status: "cancelled",
                      },
                    ],
                  }
            )
          ),
        event(true)
      )
    );
    expect(
      await provider.cancelBooking(groupLink, "meeting", allowTestWrite)
    ).toMatchObject({
      code: "UNAVAILABLE",
    });
  });
  it("validates reschedule time and returns actual replacement UID", async () => {
    const newStart = "2026-12-02T10:00:00.000Z";
    const { provider, fetch } = mockProvider(
      routes((_url, init) =>
        json(
          init.method === "POST"
            ? booking(false, {
                uid: "replacement-uid",
                id: 2002,
                rescheduledFromUid: link.bookingUid,
                start: newStart,
                end: "2026-12-02T10:30:00.000Z",
              })
            : booking()
        )
      )
    );
    expect(
      await provider.rescheduleBooking(link, newStart, allowTestWrite)
    ).toMatchObject({
      ok: true,
      value: {
        bookingUid: "replacement-uid",
        providerBookingId: 2002,
        start: newStart,
      },
    });
    expect(fetch.mock.calls.at(-1)![0]).toBe(
      "https://api.cal.com/v2/bookings/booking-actual-1/reschedule"
    );
  });
  it("reschedules a group participant with actual seatUID and accepts replacement seat UID", async () => {
    const newStart = "2026-12-02T10:00:00.000Z";
    let moved = false;
    const { provider, fetch } = mockProvider(
      routes((_url, init) => {
        if (init.method === "POST") moved = true;
        return json(
          moved
            ? booking(true, {
                uid: "new-meeting",
                rescheduledFromUid: link.bookingUid,
                start: newStart,
                end: "2026-12-02T10:30:00.000Z",
                seatUid: "new-seat",
                attendees: [
                  {
                    ...person,
                    seatUid: "new-seat",
                    metadata: meta(),
                    confirmationStatus: "accepted",
                  },
                ],
              })
            : booking(true)
        );
      }, event(true))
    );
    expect(
      await provider.rescheduleBooking(groupLink, newStart, allowTestWrite)
    ).toMatchObject({
      ok: true,
      value: { bookingUid: "new-meeting", seatUid: "new-seat" },
    });
    expect(
      JSON.parse(
        fetch.mock.calls.find(([, init]) => init!.method === "POST")![1]!
          .body as string
      )
    ).toEqual({
      start: newStart,
      seatUid: "seat-actual-1",
    });
  });
  it("marks a replacement UID without its documented previous linkage uncertain", async () => {
    const { provider } = mockProvider(
      routes((_url, init) =>
        json(
          init.method === "POST"
            ? booking(false, { uid: "unlinked-new" })
            : booking()
        )
      )
    );
    expect(
      await provider.rescheduleBooking(link, start, allowTestWrite)
    ).toMatchObject({
      code: "UNCERTAIN",
    });
  });
  it.each([
    "../other",
    "https://attacker.invalid",
    "booking?secret",
    "x".repeat(129),
  ])(
    "rejects caller UID traversal/oversize %s without requests",
    async bookingUid => {
      const { provider, fetch } = mockProvider();
      expect(await provider.getBooking({ ...link, bookingUid })).toMatchObject({
        code: "INVALID_INPUT",
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  );
});

describe("bounded transport and safe uncertainty", () => {
  it.each([
    [401, "FORBIDDEN"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [429, "RATE_LIMITED"],
    [400, "INVALID_INPUT"],
    [408, "UNCERTAIN"],
    [503, "UNCERTAIN"],
    [302, "UNCERTAIN"],
  ] as const)(
    "maps %s to fixed error %s without sensitive body",
    async (status, code) => {
      const { provider } = mockProvider(
        routes(
          () =>
            new Response("PRIVATE cal_token https://secret.invalid", { status })
        )
      );
      const result = await provider.createBooking(
        {
          ...target,
          ...identity,
          start,
        },
        allowTestWrite
      );
      expect(result).toMatchObject({ ok: false, code });
      expect(JSON.stringify(result)).not.toMatch(
        /PRIVATE|cal_token|secret.invalid/
      );
    }
  );
  it("bounds hung creates, aborts and never retries", async () => {
    vi.useFakeTimers();
    const { provider, fetch } = mockProvider(
      routes(() => new Promise<Response>(() => {}))
    );
    const promise = provider.createBooking(
      { ...target, ...identity, start },
      allowTestWrite
    );
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await promise).toMatchObject({ code: "UNCERTAIN", uncertain: true });
    expect(
      fetch.mock.calls.filter(([, init]) => init!.method === "POST")
    ).toHaveLength(1);
    expect(fetch.mock.calls.at(-1)![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds hung response bodies, not only response headers", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const { provider } = mockProvider(
      routes(
        () =>
          new Response(new ReadableStream({ cancel }), {
            headers: { "content-type": "application/json" },
          })
      )
    );
    const promise = provider.createBooking(
      { ...target, ...identity, start },
      allowTestWrite
    );
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await promise).toMatchObject({ code: "UNCERTAIN" });
    expect(cancel).toHaveBeenCalled();
  });
  it("classifies preflight read timeout as definite no-write failure", async () => {
    vi.useFakeTimers();
    const { provider, fetch } = mockProvider(
      () => new Promise<Response>(() => {})
    );
    const promise = provider.createBooking(
      { ...target, ...identity, start },
      allowTestWrite
    );
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await promise).toMatchObject({
      code: "PROVIDER_FAILURE",
      uncertain: false,
    });
    expect(fetch.mock.calls.some(([, init]) => init!.method === "POST")).toBe(
      false
    );
  });
  it.each([
    new Response("broken", { headers: { "content-type": "application/json" } }),
    new Response("html", { headers: { "content-type": "text/html" } }),
    new Response("{}", {
      headers: {
        "content-type": "application/json",
        "content-length": "999999",
      },
    }),
    new Response("x".repeat(262_145), {
      headers: { "content-type": "application/json" },
    }),
  ])(
    "bounds and validates body even if Content-Length absent",
    async response => {
      const { provider } = mockProvider(routes(() => response));
      expect(
        await provider.createBooking(
          { ...target, ...identity, start },
          allowTestWrite
        )
      ).toMatchObject({ code: "UNCERTAIN" });
    }
  );
  it("swallows transport exceptions without logging provider details", async () => {
    const log = vi.spyOn(console, "error"),
      warn = vi.spyOn(console, "warn");
    const { provider } = mockProvider(
      routes(() => {
        throw new Error("cal_secret http://private/path");
      })
    );
    expect(
      await provider.createBooking(
        { ...target, ...identity, start },
        allowTestWrite
      )
    ).toMatchObject({ code: "UNCERTAIN" });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("bounded current-version operation reconciliation", () => {
  it("uses limit/cursor version and projects only exact operation identity", async () => {
    const { provider, fetch } = mockProvider(
      routes(() =>
        json(
          [
            booking(false, { metadata: meta({ jltOperationId: "unrelated" }) }),
            booking(),
          ],
          200,
          { pagination: { hasMore: false, nextCursor: null } }
        )
      )
    );
    expect(
      await provider.reconcileOperation({ ...target, ...identity, start, end })
    ).toMatchObject({
      ok: true,
      value: {
        complete: true,
        bookings: [{ operationId: identity.operationId }],
      },
    });
    const [url, init] = fetch.mock.calls.at(-1)!;
    expect(new URL(String(url)).searchParams.get("limit")).toBe("50");
    expect(String(url)).not.toMatch(/skip|take|attendeeEmail/);
    expect(init!.headers).toMatchObject({ "cal-api-version": "2026-05-01" });
  });
  it("stops after three pages and reports incomplete, not definite absence", async () => {
    let page = 0;
    const { provider, fetch } = mockProvider(
      routes(() =>
        json([], 200, {
          pagination: { hasMore: true, nextCursor: `cursor-${++page}` },
        })
      )
    );
    expect(
      await provider.reconcileOperation({ ...target, ...identity, start, end })
    ).toEqual({ ok: true, value: { bookings: [], complete: false } });
    expect(
      fetch.mock.calls.filter(([url]) => String(url).includes("bookings?"))
    ).toHaveLength(3);
  });
  it("rejects pagination cycles", async () => {
    const { provider } = mockProvider(
      routes(() =>
        json([], 200, { pagination: { hasMore: true, nextCursor: "repeated" } })
      )
    );
    expect(
      await provider.reconcileOperation({ ...target, ...identity, start, end })
    ).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
});

function webhook(overrides = {}, payloadOverrides = {}) {
  return {
    triggerEvent: "BOOKING_CREATED",
    createdAt: "2026-11-21T16:00:00Z",
    payload: {
      uid: link.bookingUid,
      eventTypeId: 11,
      organizer: { id: 123, email: "private@example.com" },
      metadata: meta(),
      startTime: start,
      endTime: end,
      status: "ACCEPTED",
      title: "Private title",
      attendees: [{ email: person.email }],
      absentHost: false,
      ...payloadOverrides,
    },
    ...overrides,
  };
}
function signed(body: unknown) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = createHmac(
    "sha256",
    process.env.JLT_STAFF_CAL_WEBHOOK_SECRET!
  )
    .update(raw)
    .digest("hex");
  return { raw, signature };
}
describe("signed raw-body lifecycle projection", () => {
  it("validates HMAC and exact linkage while returning minimal stable dedupe receipt", () => {
    const { raw, signature } = signed(webhook());
    const linked = vi.fn(() => true);
    const result = verifyStaffCallWebhook(raw, signature, linked);
    expect(result).toMatchObject({
      ok: true,
      ignored: false,
      value: {
        event: "BOOKING_CREATED",
        hostUserId: 42,
        bookingUid: link.bookingUid,
        identity,
        start,
        end,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /email|title|absent|attendee|private|attendance/
    );
    expect(verifyStaffCallWebhook(raw, signature, linked)).toEqual(result);
  });
  it.each([
    undefined,
    "",
    "0".repeat(64),
    "sha256=" + "a".repeat(64),
    "a".repeat(63),
  ])("rejects invalid/malformed signature %s before linkage", signature => {
    const { raw } = signed(webhook());
    const linked = vi.fn(() => true);
    expect(verifyStaffCallWebhook(raw, signature, linked)).toEqual({
      ok: false,
      code: "INVALID_SIGNATURE",
    });
    expect(linked).not.toHaveBeenCalled();
  });
  it("uses exact bytes, rejecting modified raw JSON", () => {
    const { raw, signature } = signed(webhook());
    expect(
      verifyStaffCallWebhook(
        Buffer.concat([raw, Buffer.from(" ")]),
        signature,
        () => true
      )
    ).toMatchObject({ code: "INVALID_SIGNATURE" });
  });
  it("ignores unknown or unlinked events rather than matching emails", () => {
    for (const body of [
      webhook({ triggerEvent: "MEETING_ENDED" }),
      webhook({}, { metadata: {} }),
      webhook({}, { organizer: { id: 999 } }),
      webhook({}, { eventTypeId: 999 }),
    ]) {
      const { raw, signature } = signed(body);
      const linked = vi.fn(() => true);
      expect(verifyStaffCallWebhook(raw, signature, linked)).toMatchObject({
        ok: true,
        ignored: true,
      });
      expect(linked).not.toHaveBeenCalled();
    }
    const { raw, signature } = signed(webhook());
    expect(verifyStaffCallWebhook(raw, signature, () => false)).toMatchObject({
      ok: true,
      ignored: true,
    });
    expect(
      verifyStaffCallWebhook(raw, signature, () => {
        throw new Error("private");
      })
    ).toMatchObject({ ok: true, ignored: true });
  });
  it("ignores group lifecycle missing explicit seat identity", () => {
    const { raw, signature } = signed(
      webhook({}, { eventTypeId: 12, seatsPerTimeSlot: 4 })
    );
    expect(verifyStaffCallWebhook(raw, signature, () => true)).toMatchObject({
      ignored: true,
    });
  });
  it("preserves explicit seat UID without treating it as the whole roster", () => {
    const { raw, signature } = signed(
      webhook(
        {},
        {
          eventTypeId: 12,
          seatsPerTimeSlot: 4,
          attendeeSeatId: "seat-actual-1",
          attendees: [{ seatUid: "seat-actual-1", metadata: meta() }],
        }
      )
    );
    expect(verifyStaffCallWebhook(raw, signature, () => true)).toMatchObject({
      ignored: false,
      value: { seatUid: "seat-actual-1", identity },
    });
  });
  it("does not use first-booker session metadata for another triggering seat", () => {
    const { raw, signature } = signed(
      webhook(
        {},
        {
          eventTypeId: 12,
          seatsPerTimeSlot: 4,
          attendeeSeatId: "seat-actual-1",
          attendees: [
            {
              seatUid: "seat-actual-1",
              metadata: meta({ jltParticipantId: "999" }),
            },
          ],
        }
      )
    );
    expect(verifyStaffCallWebhook(raw, signature, () => true)).toMatchObject({
      ignored: true,
    });
  });
  it("validates reschedule old/new IDs and times", () => {
    const { raw, signature } = signed(
      webhook(
        { triggerEvent: "BOOKING_RESCHEDULED" },
        {
          uid: "new-booking",
          rescheduleUid: link.bookingUid,
          rescheduleStartTime: start,
          rescheduleEndTime: end,
        }
      )
    );
    expect(verifyStaffCallWebhook(raw, signature, () => true)).toMatchObject({
      ignored: false,
      value: { bookingUid: "new-booking", previousBookingUid: link.bookingUid },
    });
    const missing = signed(webhook({ triggerEvent: "BOOKING_RESCHEDULED" }));
    expect(
      verifyStaffCallWebhook(missing.raw, missing.signature, () => true)
    ).toMatchObject({ code: "INVALID_BODY" });
  });
  it.each([
    { startTime: "2026-02-30T10:00:00Z" },
    { uid: "https://attacker.invalid" },
    { status: "NO_SHOW" },
    { endTime: "2026-12-01T11:00:00Z" },
  ])("rejects malformed linked lifecycle %s", payload => {
    const { raw, signature } = signed(webhook({}, payload));
    expect(verifyStaffCallWebhook(raw, signature, () => true)).toMatchObject({
      code: "INVALID_BODY",
    });
  });
  it("caps raw body before signature work and rejects signed invalid JSON", () => {
    expect(
      verifyStaffCallWebhook(Buffer.alloc(262_145), "a".repeat(64), () => true)
    ).toMatchObject({ code: "INVALID_BODY" });
    const raw = Buffer.from("{broken");
    const signature = createHmac(
      "sha256",
      process.env.JLT_STAFF_CAL_WEBHOOK_SECRET!
    )
      .update(raw)
      .digest("hex");
    expect(verifyStaffCallWebhook(raw, signature, () => true)).toMatchObject({
      code: "INVALID_BODY",
    });
  });
  it("never falls back to the recruitment secret", () => {
    const { raw, signature } = signed(webhook());
    delete process.env.JLT_STAFF_CAL_WEBHOOK_SECRET;
    vi.stubEnv(
      "CALCOM_WEBHOOK_SECRET",
      "staff-secret-distinct-32-characters-long"
    );
    expect(verifyStaffCallWebhook(raw, signature, () => true)).toEqual({
      ok: false,
      code: "UNCONNECTED",
    });
  });
});

describe("durable private invited-cohort proof (security BLOCKER2)", () => {
  const priorAttendee = () => ({
    name: "Prior invited",
    email: "prior@example.test",
    seatUid: "prior-seat",
    metadata: meta({ jltParticipantId: "10" }),
    confirmationStatus: "accepted",
  });
  const ownAttendee = () => booking(true).attendees[0];
  const full = (
    attendees: unknown[] = [priorAttendee(), ownAttendee()],
    overrides = {}
  ) =>
    booking(true, {
      seatUid: undefined,
      metadata: meta({ jltParticipantId: "10" }),
      attendees,
      ...overrides,
    });
  const laterInput = () => ({
    ...groupLink,
    start,
    expectedBookingUid: groupLink.bookingUid,
    knownSeats: [{ participantId: 10, seatUid: "prior-seat" }],
  });
  const outsider = () => ({
    name: "PRIVATE outsider",
    email: "PRIVATE@outsider.test",
    seatUid: "outsider-seat",
    metadata: { jltNamespace: "not-jlt" },
    confirmationStatus: "accepted",
  });
  const badRosterCases: [string, () => unknown[]][] = [
    ["outsider namespace", () => [priorAttendee(), outsider()]],
    [
      "unknown participant",
      () => [
        { ...priorAttendee(), metadata: meta({ jltParticipantId: "999" }) },
      ],
    ],
    [
      "noncanonical participant",
      () => [
        { ...priorAttendee(), metadata: meta({ jltParticipantId: "010" }) },
      ],
    ],
    [
      "numeric participant metadata",
      () => [{ ...priorAttendee(), metadata: meta({ jltParticipantId: 10 }) }],
    ],
    [
      "wrong call",
      () => [
        {
          ...priorAttendee(),
          metadata: meta({ jltParticipantId: "10", jltCallId: "8" }),
        },
      ],
    ],
    [
      "wrong host",
      () => [
        {
          ...priorAttendee(),
          metadata: meta({ jltParticipantId: "10", jltHostUserId: "43" }),
        },
      ],
    ],
    [
      "wrong original operation",
      () => [
        {
          ...priorAttendee(),
          metadata: meta({
            jltParticipantId: "10",
            jltOperationId: "other-op",
          }),
        },
      ],
    ],
    [
      "duplicate seat",
      () => [priorAttendee(), { ...ownAttendee(), seatUid: "prior-seat" }],
    ],
    [
      "duplicate participant",
      () => [priorAttendee(), { ...priorAttendee(), seatUid: "another-seat" }],
    ],
    ["missing seat", () => [{ ...priorAttendee(), seatUid: undefined }]],
    [
      "malformed attendee status",
      () => [{ ...priorAttendee(), status: "active" }],
    ],
    [
      "missing attendee confirmation",
      () => [{ ...priorAttendee(), confirmationStatus: undefined }],
    ],
    ["primitive roster entry", () => [null]],
  ];

  it.each(badRosterCases)(
    "stops later create before POST for %s",
    async (_name, roster) => {
      const { provider, fetch } = mockProvider(
        routes(() => json(full(roster())), event(true))
      );
      const result = await provider.createBooking(laterInput(), allowTestWrite);
      expect(result).toMatchObject({
        ok: false,
        code: "UNCERTAIN",
        uncertain: true,
      });
      expect(fetch.mock.calls.some(([, init]) => init!.method === "POST")).toBe(
        false
      );
      expect(JSON.stringify(result)).not.toMatch(
        /PRIVATE|outsider|email|attendees|prior-seat/
      );
    }
  );

  it.each(
    [
      undefined,
      [],
      [9, 9],
      [10],
      [9, 0],
      [9, "10"],
      [9, 1.5],
      [9, ...Array.from({ length: 100 }, (_, i) => i + 10)],
    ].map(invitedParticipantIds => ({ invitedParticipantIds }))
  )(
    "requires a valid durable cohort on every group operation %s",
    async ({ invitedParticipantIds }) => {
      const { provider, fetch } = mockProvider();
      const invalid = { ...groupLink, invitedParticipantIds } as StaffCallLink;
      const results = [
        await provider.createBooking({ ...invalid, start }, allowTestWrite),
        await provider.getBooking(invalid),
        await provider.cancelBooking(invalid, "seat", allowTestWrite),
        await provider.rescheduleBooking(invalid, start, allowTestWrite),
        await provider.reconcileOperation({ ...invalid, start, end }),
      ];
      for (const result of results)
        expect(result).toMatchObject({ code: "UNCERTAIN" });
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each(
    [
      [{ participantId: 999, seatUid: "seat-x" }],
      [
        { participantId: 9, seatUid: "seat-x" },
        { participantId: 9, seatUid: "seat-y" },
      ],
      [
        { participantId: 9, seatUid: "seat-x" },
        { participantId: 10, seatUid: "seat-x" },
      ],
      [{ participantId: 9, seatUid: "https://attacker.invalid" }],
    ].map(knownSeats => ({ knownSeats }))
  )(
    "rejects malformed durable known-seat mapping %s",
    async ({ knownSeats }) => {
      const { provider, fetch } = mockProvider();
      expect(
        await provider.createBooking(
          { ...laterInput(), knownSeats },
          allowTestWrite
        )
      ).toMatchObject({ code: "UNCERTAIN" });
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    { jltNamespace: "other" },
    { jltHostUserId: "43" },
    { jltCallId: "8" },
    { jltOperationId: "cancel-or-reschedule-op" },
    { jltParticipantId: "999" },
  ])(
    "rejects the wrong original session before later-seat create %s",
    async change => {
      const { provider, fetch } = mockProvider(
        routes(
          () => json(full([priorAttendee()], { metadata: meta(change) })),
          event(true)
        )
      );
      expect(
        await provider.createBooking(laterInput(), allowTestWrite)
      ).toMatchObject({
        code: "UNCERTAIN",
      });
      expect(fetch.mock.calls.some(([, init]) => init!.method === "POST")).toBe(
        false
      );
    }
  );

  it("accepts multiple durable invited seats and distinct known IDs without projecting a roster", async () => {
    const { provider } = mockProvider(
      routes(
        url =>
          json(
            url.pathname.includes("by-seat") ? full([ownAttendee()]) : full()
          ),
        event(true)
      )
    );
    const result = await provider.getBooking({
      ...groupLink,
      knownSeats: [
        { participantId: 9, seatUid: "seat-actual-1" },
        { participantId: 10, seatUid: "prior-seat" },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: { participantId: 9, seatUid: "seat-actual-1" },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /prior@example|Prior invited|invitedParticipantIds|knownSeats|attendees/
    );
  });

  it("rejects known participant seat substitution before writes", async () => {
    const { provider, fetch } = mockProvider(
      routes(() => json(full([priorAttendee()])), event(true))
    );
    expect(
      await provider.createBooking(
        {
          ...laterInput(),
          knownSeats: [{ participantId: 10, seatUid: "stored-different-seat" }],
        },
        allowTestWrite
      )
    ).toMatchObject({ code: "UNCERTAIN" });
    expect(fetch.mock.calls.some(([, init]) => init!.method === "POST")).toBe(
      false
    );
  });

  it("reproduces outsider appearing after later create: one write, uncertain, no compensation", async () => {
    let written = false;
    const { provider, fetch } = mockProvider(
      routes((_url, init) => {
        if (init.method === "POST") {
          written = true;
          return json(full(), 201);
        }
        return json(
          written
            ? full([priorAttendee(), ownAttendee(), outsider()])
            : full([priorAttendee()])
        );
      }, event(true))
    );
    expect(
      await provider.createBooking(laterInput(), allowTestWrite)
    ).toMatchObject({
      code: "UNCERTAIN",
    });
    expect(
      fetch.mock.calls.filter(([, init]) => init!.method === "POST")
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.some(([url]) => String(url).includes("/cancel"))
    ).toBe(false);
  });

  it("classifies later-create success carrying an outsider uncertain immediately", async () => {
    const { provider, fetch } = mockProvider(
      routes(
        (_url, init) =>
          json(
            init.method === "POST"
              ? full([priorAttendee(), ownAttendee(), outsider()])
              : full([priorAttendee()])
          ),
        event(true)
      )
    );
    expect(
      await provider.createBooking(laterInput(), allowTestWrite)
    ).toMatchObject({
      code: "UNCERTAIN",
    });
    expect(
      fetch.mock.calls.filter(([, init]) => init!.method === "POST")
    ).toHaveLength(1);
  });

  it.each(["read", "cancel", "reschedule"])(
    "requires full meeting roster even when by-seat %s looks exact",
    async action => {
      const { provider, fetch } = mockProvider(
        routes(
          url =>
            json(
              url.pathname.includes("by-seat")
                ? full([ownAttendee()])
                : full([priorAttendee(), ownAttendee(), outsider()])
            ),
          event(true)
        )
      );
      const result =
        action === "read"
          ? await provider.getBooking(groupLink)
          : action === "cancel"
            ? await provider.cancelBooking(groupLink, "seat", allowTestWrite)
            : await provider.rescheduleBooking(
                groupLink,
                start,
                allowTestWrite
              );
      expect(result).toMatchObject({ code: "UNCERTAIN" });
      expect(fetch.mock.calls.some(([, init]) => init!.method === "POST")).toBe(
        false
      );
      expect(
        fetch.mock.calls.some(
          ([url]) => url === "https://api.cal.com/v2/bookings/booking-actual-1"
        )
      ).toBe(true);
    }
  );

  it("fails closed when authenticated full-meeting read is unavailable", async () => {
    const { provider, fetch } = mockProvider(
      routes(
        url =>
          url.pathname.includes("by-seat")
            ? json(full([ownAttendee()]))
            : new Response("PRIVATE roster unavailable", { status: 404 }),
        event(true)
      )
    );
    expect(
      await provider.cancelBooking(groupLink, "seat", allowTestWrite)
    ).toMatchObject({
      code: "UNCERTAIN",
    });
    expect(fetch.mock.calls.some(([, init]) => init!.method === "POST")).toBe(
      false
    );
  });

  it("preserves cancelled selected IDs in proof while cancelling only one's own seat", async () => {
    let cancelled = false;
    const { provider, fetch } = mockProvider(
      routes((url, init) => {
        if (init.method === "POST") {
          cancelled = true;
          return json(full([priorAttendee()]));
        }
        const own = cancelled
          ? { ...ownAttendee(), status: "cancelled" }
          : ownAttendee();
        return json(
          full(
            url.pathname.includes("by-seat")
              ? [own]
              : cancelled
                ? [priorAttendee()]
                : [priorAttendee(), own]
          )
        );
      }, event(true))
    );
    expect(
      await provider.cancelBooking(
        {
          ...groupLink,
          knownSeats: [
            { participantId: 9, seatUid: "seat-actual-1" },
            { participantId: 10, seatUid: "prior-seat" },
          ],
        },
        "seat",
        allowTestWrite
      )
    ).toMatchObject({ ok: true, value: { status: "cancelled" } });
    const writes = fetch.mock.calls.filter(
      ([, init]) => init!.method === "POST"
    );
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1]!.body as string)).toEqual({
      cancellationReason: "Cancelled in JLT Portal",
      seatUid: "seat-actual-1",
    });
  });

  it("marks seat cancellation successful-but-outsider response uncertain, never cancels others", async () => {
    const { provider, fetch } = mockProvider(
      routes(
        (_url, init) =>
          json(init.method === "POST" ? full([outsider()]) : full()),
        event(true)
      )
    );
    expect(
      await provider.cancelBooking(groupLink, "seat", allowTestWrite)
    ).toMatchObject({
      code: "UNCERTAIN",
    });
    expect(
      fetch.mock.calls.filter(([, init]) => init!.method === "POST")
    ).toHaveLength(1);
    expect(
      JSON.parse(
        fetch.mock.calls.find(([, init]) => init!.method === "POST")![1]!
          .body as string
      )
    ).toHaveProperty("seatUid", "seat-actual-1");
  });

  it("marks a reschedule replacement into outsider session uncertain without a second write", async () => {
    const newStart = "2026-12-02T10:00:00.000Z";
    const { provider, fetch } = mockProvider(
      routes(
        (_url, init) =>
          json(
            init.method === "POST"
              ? full(
                  [
                    { ...ownAttendee(), seatUid: "replacement-seat" },
                    outsider(),
                  ],
                  {
                    uid: "replacement-meeting",
                    rescheduledFromUid: link.bookingUid,
                    start: newStart,
                    end: "2026-12-02T10:30:00.000Z",
                  }
                )
              : full()
          ),
        event(true)
      )
    );
    expect(
      await provider.rescheduleBooking(groupLink, newStart, allowTestWrite)
    ).toMatchObject({ code: "UNCERTAIN" });
    expect(
      fetch.mock.calls.filter(([, init]) => init!.method === "POST")
    ).toHaveLength(1);
  });

  it.each(badRosterCases)(
    "rejects exact-seat recovery with %s",
    async (_name, roster) => {
      const bad = full([ownAttendee(), ...roster()]);
      const { provider, fetch } = mockProvider(
        routes(
          url =>
            url.search
              ? json([bad], 200, {
                  pagination: { hasMore: false, nextCursor: null },
                })
              : json(bad),
          event(true)
        )
      );
      expect(
        await provider.reconcileOperation({ ...groupLink, start, end })
      ).toMatchObject({ code: "UNCERTAIN" });
      expect(fetch.mock.calls.some(([, init]) => init!.method === "POST")).toBe(
        false
      );
    }
  );

  it.each([
    { jltNamespace: "other" },
    { jltHostUserId: "43" },
    { jltCallId: "8" },
    { jltOperationId: "new-reschedule-op" },
    { jltParticipantId: "999" },
  ])(
    "rejects exact-seat recovery with wrong original session %s",
    async change => {
      const bad = full(undefined, { metadata: meta(change) });
      const { provider } = mockProvider(
        routes(
          () =>
            json([bad], 200, {
              pagination: { hasMore: false, nextCursor: null },
            }),
          event(true)
        )
      );
      expect(
        await provider.reconcileOperation({ ...groupLink, start, end })
      ).toMatchObject({ code: "UNCERTAIN" });
    }
  );

  it("recovery authenticates the full roster rather than trusting an exact-seat list subset", async () => {
    const { provider, fetch } = mockProvider(
      routes(
        url =>
          url.search
            ? json([full([ownAttendee()])], 200, {
                pagination: { hasMore: false, nextCursor: null },
              })
            : json(full([ownAttendee(), outsider()])),
        event(true)
      )
    );
    expect(
      await provider.reconcileOperation({ ...groupLink, start, end })
    ).toMatchObject({ code: "UNCERTAIN" });
    expect(
      fetch.mock.calls.some(
        ([url]) => url === "https://api.cal.com/v2/bookings/booking-actual-1"
      )
    ).toBe(true);
  });

  it("accepts recovered private invited session only after authenticated roster proof", async () => {
    const { provider } = mockProvider(
      routes(
        url =>
          url.search
            ? json([full()], 200, {
                pagination: { hasMore: false, nextCursor: null },
              })
            : json(full()),
        event(true)
      )
    );
    expect(
      await provider.reconcileOperation({ ...groupLink, start, end })
    ).toMatchObject({
      ok: true,
      value: {
        complete: true,
        bookings: [{ participantId: 9, operationId: identity.operationId }],
      },
    });
  });

  it("bounds recovery full-meeting proof to three reads and reports incomplete", async () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      full(undefined, { uid: `meeting-${i}`, id: 1001 + i })
    );
    const { provider, fetch } = mockProvider(
      routes(
        url =>
          url.search
            ? json(rows, 200, {
                pagination: { hasMore: false, nextCursor: null },
              })
            : json(rows[Number(url.pathname.split("-").at(-1))]),
        event(true)
      )
    );
    const result = await provider.reconcileOperation({
      ...groupLink,
      start,
      end,
    });
    expect(result).toMatchObject({ ok: true, value: { complete: false } });
    if (result.ok) expect(result.value.bookings).toHaveLength(3);
    expect(
      fetch.mock.calls.filter(([url]) =>
        new URL(String(url)).pathname.startsWith("/v2/bookings/")
      )
    ).toHaveLength(3);
  });
});

describe("authenticated booking predecessor projection", () => {
  it("projects only provider rescheduledFromUid on authenticated read, ignoring caller predecessor", async () => {
    const { provider } = mockProvider(
      routes(() =>
        json(booking(false, { rescheduledFromUid: "authenticated-old" }))
      )
    );
    expect(
      await provider.getBooking({
        ...link,
        previousBookingUid: "caller-forged",
      } as StaffCallLink)
    ).toMatchObject({
      ok: true,
      value: { previousBookingUid: "authenticated-old" },
    });
  });
  it("never manufactures a predecessor when provider omits it", async () => {
    const { provider } = mockProvider(routes(() => json(booking())));
    const result = await provider.getBooking({
      ...link,
      previousBookingUid: "caller-forged",
    } as StaffCallLink);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).not.toHaveProperty("previousBookingUid");
  });
  it.each(["https://attacker.invalid", "../other", link.bookingUid, 42])(
    "fails closed on malformed/self authenticated predecessor %s",
    async rescheduledFromUid => {
      const { provider } = mockProvider(
        routes(() => json(booking(false, { rescheduledFromUid })))
      );
      expect(await provider.getBooking(link)).toMatchObject({
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
  );
  it("preserves authenticated predecessor during exact metadata reconciliation", async () => {
    const { provider } = mockProvider(
      routes(() =>
        json(
          [booking(false, { rescheduledFromUid: "authenticated-old" })],
          200,
          { pagination: { hasMore: false, nextCursor: null } }
        )
      )
    );
    expect(
      await provider.reconcileOperation({ ...target, ...identity, start, end })
    ).toMatchObject({
      ok: true,
      value: { bookings: [{ previousBookingUid: "authenticated-old" }] },
    });
  });
  it("group reschedule does not trust a POST predecessor if full meeting contradicts it", async () => {
    let moved = false;
    const newStart = "2026-12-02T10:00:00.000Z";
    const replacement = () =>
      booking(true, {
        uid: "replacement-meeting",
        seatUid: "replacement-seat",
        start: newStart,
        end: "2026-12-02T10:30:00.000Z",
        attendees: [
          { ...booking(true).attendees[0], seatUid: "replacement-seat" },
        ],
      });
    const { provider, fetch } = mockProvider(
      routes((_url, init) => {
        if (init.method === "POST") {
          moved = true;
          return json({
            ...replacement(),
            rescheduledFromUid: link.bookingUid,
          });
        }
        return json(
          moved
            ? { ...replacement(), rescheduledFromUid: "unrelated-old" }
            : booking(true)
        );
      }, event(true))
    );
    expect(
      await provider.rescheduleBooking(groupLink, newStart, allowTestWrite)
    ).toMatchObject({ code: "UNCERTAIN" });
    expect(
      fetch.mock.calls.filter(([, init]) => init!.method === "POST")
    ).toHaveLength(1);
  });
});

describe("malformed proof and bounded full-meeting read", () => {
  it("rejects sparse invitation and known-seat arrays without requests or exceptions", async () => {
    const { provider, fetch } = mockProvider();
    const invitedParticipantIds = new Array<number>(2);
    invitedParticipantIds[0] = 9;
    expect(
      await provider.getBooking({ ...groupLink, invitedParticipantIds })
    ).toMatchObject({ code: "UNCERTAIN" });
    const knownSeats = new Array<{ participantId: number; seatUid: string }>(1);
    expect(
      await provider.getBooking({ ...groupLink, knownSeats })
    ).toMatchObject({ code: "UNCERTAIN" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds a hung full-meeting proof and never proceeds to a cancellation write", async () => {
    vi.useFakeTimers();
    const { provider, fetch } = mockProvider(
      routes(
        url =>
          url.pathname.includes("by-seat")
            ? json(booking(true))
            : new Promise<Response>(() => {}),
        event(true)
      )
    );
    const result = provider.cancelBooking(groupLink, "seat", allowTestWrite);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await result).toMatchObject({ code: "UNCERTAIN" });
    expect(fetch.mock.calls.some(([, init]) => init!.method === "POST")).toBe(
      false
    );
    expect(fetch.mock.calls.at(-1)![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("fresh core authorization at the actual POST boundary", () => {
  const newStart = "2026-12-02T10:00:00.000Z";
  type WriteCase = {
    label: string;
    action: "create" | "cancel" | "reschedule";
    group: boolean;
    later?: boolean;
  };
  const cases: WriteCase[] = [
    { label: "one-to-one create", action: "create", group: false },
    { label: "one-to-one cancel", action: "cancel", group: false },
    { label: "one-to-one reschedule", action: "reschedule", group: false },
    { label: "first group seat create", action: "create", group: true },
    {
      label: "later group seat create",
      action: "create",
      group: true,
      later: true,
    },
    { label: "group seat cancel", action: "cancel", group: true },
    { label: "group seat reschedule", action: "reschedule", group: true },
  ];
  const prior = () => ({
    name: "Prior invited",
    email: "prior@example.test",
    seatUid: "prior-seat",
    metadata: meta({ jltParticipantId: "10" }),
    confirmationStatus: "accepted",
  });
  const own = () => booking(true).attendees[0];
  const full = (attendees: unknown[], overrides = {}) =>
    booking(true, {
      seatUid: undefined,
      metadata: meta({ jltParticipantId: "10" }),
      attendees,
      ...overrides,
    });
  function input(c: WriteCase): StaffCallLink {
    return c.group
      ? {
          ...groupLink,
          knownSeats:
            c.action === "create"
              ? c.later
                ? [{ participantId: 10, seatUid: "prior-seat" }]
                : []
              : [
                  { participantId: 9, seatUid: "seat-actual-1" },
                  { participantId: 10, seatUid: "prior-seat" },
                ],
        }
      : link;
  }
  function invoke(
    provider: StaffCallsProvider,
    c: WriteCase,
    guard?: StaffCallWriteGuard
  ) {
    const selected = input(c);
    return c.action === "create"
      ? provider.createBooking(
          {
            ...selected,
            start,
            ...(c.later ? { expectedBookingUid: selected.bookingUid } : {}),
          },
          guard
        )
      : c.action === "cancel"
        ? provider.cancelBooking(selected, c.group ? "seat" : "meeting", guard)
        : provider.rescheduleBooking(selected, newStart, guard);
  }
  function expectedReads(c: WriteCase) {
    return [
      "/v2/me",
      `/v2/event-types/${c.group ? 12 : 11}`,
      ...(c.action !== "create" && c.group
        ? ["/v2/bookings/by-seat/seat-actual-1"]
        : []),
      ...(c.action !== "create" || c.later
        ? ["/v2/bookings/booking-actual-1"]
        : []),
    ];
  }
  function harness(c: WriteCase, onFinalRead = () => {}) {
    const timeline: string[] = [];
    const posts: string[] = [];
    const reads = expectedReads(c);
    let written = false;
    const { provider, fetch, resolveParticipant } = mockProvider(
      (url, init) => {
        timeline.push(`${init.method} ${url.pathname}`);
        if (init.method === "POST") {
          written = true;
          posts.push(url.pathname);
        } else if (!written && url.pathname === reads.at(-1)) onFinalRead();
        if (url.pathname === "/v2/me") return json({ id: 123 });
        if (url.pathname.startsWith("/v2/event-types/"))
          return json(event(c.group));
        if (!c.group) {
          return json(
            booking(false, {
              ...(written && c.action === "cancel"
                ? { status: "cancelled" }
                : {}),
              ...(written && c.action === "reschedule"
                ? {
                    uid: "replacement-meeting",
                    rescheduledFromUid: link.bookingUid,
                    start: newStart,
                    end: "2026-12-02T10:30:00.000Z",
                  }
                : {}),
            })
          );
        }
        if (c.action === "create") {
          return json(
            c.later
              ? full(written ? [prior(), own()] : [prior()])
              : booking(true)
          );
        }
        if (c.action === "cancel") {
          return json(
            full([
              prior(),
              { ...own(), ...(written ? { status: "cancelled" } : {}) },
            ])
          );
        }
        return json(
          written
            ? full([prior(), { ...own(), seatUid: "replacement-seat" }], {
                uid: "replacement-meeting",
                rescheduledFromUid: link.bookingUid,
                start: newStart,
                end: "2026-12-02T10:30:00.000Z",
              })
            : full([prior(), own()])
        );
      }
    );
    return { provider, fetch, resolveParticipant, timeline, posts };
  }

  describe.each(cases)("$label", c => {
    it.each(["FORBIDDEN", "CONFLICT"] as const)(
      "propagates the exact core %s after final preflight and sends zero POSTs",
      async code => {
        let granted = true;
        const h = harness(c, () => {
          granted = false;
        });
        const denial = new TRPCError({ code, message: "Fresh core denial" });
        const guard = vi.fn<StaffCallWriteGuard>(async () => {
          h.timeline.push("guard");
          expect(granted).toBe(false);
          expect(h.posts).toEqual([]);
          throw denial;
        });
        await expect(invoke(h.provider, c, guard)).rejects.toBe(denial);
        expect(guard).toHaveBeenCalledTimes(1);
        expect(h.timeline).toEqual([
          ...expectedReads(c).map(path => `GET ${path}`),
          "guard",
        ]);
        expect(h.posts).toEqual([]);
        expect(
          h.fetch.mock.calls.some(([, init]) => init?.method === "POST")
        ).toBe(false);
      }
    );

    it("invokes an allowed guard once after all preflight, then begins fetch without another await", async () => {
      const h = harness(c);
      let release!: () => void;
      let entered!: () => void;
      const atBoundary = new Promise<void>(resolve => {
        entered = resolve;
      });
      const authorization = new Promise<void>(resolve => {
        release = () => {
          resolve();
          // Provider's already-registered await continuation must dispatch fetch
          // before this next microtask: any extra await would fail this assertion.
          queueMicrotask(() => {
            h.timeline.push("next-microtask");
          });
        };
      });
      const guard = vi.fn<StaffCallWriteGuard>(() => {
        h.timeline.push("guard");
        entered();
        return authorization;
      });
      const pending = invoke(h.provider, c, guard);
      await atBoundary;
      const before = [...expectedReads(c).map(path => `GET ${path}`), "guard"];
      expect(h.timeline).toEqual(before);
      expect(h.posts).toEqual([]);
      if (c.action === "create")
        expect(h.resolveParticipant).toHaveBeenCalledTimes(1);
      release();
      const result = await pending;
      expect(result).toMatchObject({ ok: true });
      expect(guard).toHaveBeenCalledTimes(1);
      const postPath =
        c.action === "create"
          ? "/v2/bookings"
          : `/v2/bookings/${link.bookingUid}/${c.action}`;
      expect(h.posts).toEqual([postPath]);
      expect(h.timeline.slice(0, before.length + 2)).toEqual([
        ...before,
        `POST ${postPath}`,
        "next-microtask",
      ]);
      if (c.group && c.action !== "create") {
        const post = h.fetch.mock.calls.find(
          ([, init]) => init?.method === "POST"
        )!;
        expect(JSON.parse(post[1]!.body as string)).toHaveProperty(
          "seatUid",
          groupLink.seatUid
        );
      }
    });

    it("fails closed with FORBIDDEN and zero POSTs when the guard is absent", async () => {
      const h = harness(c);
      expect(await invoke(h.provider, c)).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
        uncertain: false,
      });
      expect(h.timeline).toEqual(expectedReads(c).map(path => `GET ${path}`));
      expect(h.posts).toEqual([]);
    });

    it("fails closed for a non-function guard, never treating it as authorization", async () => {
      const h = harness(c);
      expect(
        await invoke(h.provider, c, {} as StaffCallWriteGuard)
      ).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
        uncertain: false,
      });
      expect(h.posts).toEqual([]);
    });

    it("propagates a synchronous guard exception unchanged with zero POSTs", async () => {
      const h = harness(c);
      const denial = new Error("Core guard failure");
      const guard = vi.fn<StaffCallWriteGuard>(() => {
        throw denial;
      });
      await expect(invoke(h.provider, c, guard)).rejects.toBe(denial);
      expect(guard).toHaveBeenCalledTimes(1);
      expect(h.posts).toEqual([]);
    });
  });

  it("does not require a write guard for any pure read method", async () => {
    const { provider, fetch } = mockProvider();
    expect(await provider.getConnectionStatus(42)).toMatchObject({
      state: "READY",
    });
    expect(
      await provider.getBookableSlots({ ...target, start, end })
    ).toMatchObject({ ok: true });
    expect(
      await provider.getBusyTimes({ ...target, start, end })
    ).toMatchObject({ code: "UNAVAILABLE" });
    expect(await provider.getBooking(link)).toMatchObject({ ok: true });
    expect(
      await provider.reconcileOperation({ ...target, ...identity, start, end })
    ).toMatchObject({ ok: true });
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
      true
    );
  });

  it("does not invoke or require a guard when an authenticated group seat is already cancelled", async () => {
    const { provider, fetch } = mockProvider(
      routes(
        () =>
          json(
            booking(true, {
              attendees: [{ ...own(), status: "cancelled" }],
            })
          ),
        event(true)
      )
    );
    const guard = vi.fn<StaffCallWriteGuard>(async () => {
      throw new Error("No write allowed");
    });
    expect(
      await provider.cancelBooking(groupLink, "seat", guard)
    ).toMatchObject({ ok: true, value: { status: "cancelled" } });
    expect(await provider.cancelBooking(groupLink, "seat")).toMatchObject({
      ok: true,
      value: { status: "cancelled" },
    });
    expect(guard).not.toHaveBeenCalled();
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
      true
    );
  });
});
