import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AMENDMENT_FILTERS,
  amendmentDate,
  amendmentDepartureDays,
  amendmentDepartureLabel,
  amendmentFilterOptions,
  amendmentMatches,
  amendmentStage,
  filterAndSortAmendments,
  type AmendmentListFilters,
  type AmendmentListRow,
} from "../shared/amendment-list";

// Explicit local-calendar fixtures: never rely on the machine's current date.
const NOW = new Date(2026, 10, 19, 12, 0, 0);
const localDeparture = (offset: number, hour = 0, minute = 0, second = 0, millisecond = 0) =>
  new Date(2026, 10, 19 + offset, hour, minute, second, millisecond);
const row = (overrides: Partial<AmendmentListRow> = {}): AmendmentListRow => ({
  id: 1,
  bookingId: 1001,
  agentId: 20,
  bookingAgentId: 30,
  agentName: "Alex Agent",
  clientName: "Jamie Client",
  assignedToId: 40,
  assignedToName: "Sam Staff",
  pipelineStage: "To Do",
  status: "pending",
  createdAt: new Date(2026, 10, 1, 9),
  departureDate: localDeparture(1),
  ...overrides,
});
const filters = (overrides: Partial<AmendmentListFilters> = {}): AmendmentListFilters => ({
  ...DEFAULT_AMENDMENT_FILTERS,
  ...overrides,
});
const matches = (overrides: Partial<AmendmentListRow>, selected: Partial<AmendmentListFilters>, userId?: number) =>
  amendmentMatches(row(overrides), filters(selected), NOW, userId);
const sortedIds = (rows: readonly AmendmentListRow[], selected: Partial<AmendmentListFilters> = {}) =>
  filterAndSortAmendments(rows, filters(selected), NOW).map((item) => item.id);

describe("amendment list default controls and safe date parsing", () => {
  it("defaults to all rows and closest upcoming departure, not newest submission", () => {
    expect(DEFAULT_AMENDMENT_FILTERS).toEqual({
      search: "", stage: "all", agent: "all", assignee: "all", departure: "all", sort: "departure_soonest",
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace", " \t\n "],
    ["invalid string", "not-a-date"],
    ["invalid Date", new Date(NaN)],
    ["NaN timestamp", NaN],
  ] as const)("treats %s as missing, never an accidental epoch date", (_name, value) => {
    expect(amendmentDate(value)).toBeNull();
    expect(amendmentDepartureDays(value, NOW)).toBeNull();
  });

  it("accepts valid ISO strings and numeric timestamps, including explicit epoch zero", () => {
    const instant = "2026-11-20T10:30:00.000Z";
    expect(amendmentDate(instant)?.toISOString()).toBe(instant);
    expect(amendmentDate(Date.parse(instant))?.toISOString()).toBe(instant);
    expect(amendmentDate(0)?.getTime()).toBe(0);
  });

  it("copies Date inputs so callers cannot mutate the original through the parsed result", () => {
    const original = localDeparture(1);
    const timestamp = original.getTime();
    const parsed = amendmentDate(original)!;
    expect(parsed).not.toBe(original);
    parsed.setFullYear(2030);
    expect(original.getTime()).toBe(timestamp);
  });

  it("counts local calendar days across midnight rather than elapsed 24-hour intervals", () => {
    const justBeforeMidnight = localDeparture(0, 23, 59, 59, 999);
    expect(amendmentDepartureDays(localDeparture(1), justBeforeMidnight)).toBe(1);
    expect(amendmentDepartureDays(localDeparture(0), justBeforeMidnight)).toBe(0);
    expect(amendmentDepartureDays(localDeparture(-1, 23, 59, 59, 999), NOW)).toBe(-1);
  });

  it("handles month and year rollover using local date parts", () => {
    expect(amendmentDepartureDays(new Date(2027, 0, 1), new Date(2026, 11, 31, 23, 59))).toBe(1);
    expect(amendmentDepartureDays(new Date(2026, 11, 1), new Date(2026, 10, 30))).toBe(1);
  });

  it("fails closed for an invalid reference date", () => {
    expect(amendmentDepartureDays(localDeparture(1), new Date(NaN))).toBeNull();
  });

  it.each([
    ["spring 23-hour day", 2, 29, 23],
    ["autumn 25-hour day", 9, 25, 25],
  ] as const)("uses calendar days during the %s in an isolated timezone process", (_name, month, day, hours) => {
    // TZ is supplied only to this child process; never mutate the worker/global environment.
    const helperUrl = pathToFileURL(resolve(process.cwd(), "shared/amendment-list.ts")).href;
    const script = `
      import { amendmentDepartureDays, amendmentMatches, DEFAULT_AMENDMENT_FILTERS } from ${JSON.stringify(helperUrl)};
      const start = new Date(2026, ${month}, ${day}, 0);
      const end = new Date(2026, ${month}, ${day + 1}, 0);
      const lastIncluded = new Date(2026, ${month}, ${day + 6}, 23, 59, 59, 999);
      const firstExcluded = new Date(2026, ${month}, ${day + 7}, 0);
      const f = { ...DEFAULT_AMENDMENT_FILTERS, departure: "next_7" };
      const makeRow = departureDate => ({ id: 1, bookingId: 1, departureDate });
      console.log(JSON.stringify({
        hours: (end.getTime() - start.getTime()) / 3600000,
        days: amendmentDepartureDays(end, start),
        reverseDays: amendmentDepartureDays(start, end),
        included: amendmentMatches(makeRow(lastIncluded), f, start),
        excluded: amendmentMatches(makeRow(firstExcluded), f, start)
      }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(), env: { ...process.env, TZ: "Europe/London" }, encoding: "utf8", timeout: 15_000,
    }));
    expect(result).toEqual({ hours, days: 1, reverseDays: -1, included: true, excluded: false });
  });

  it.each([
    [null, "No departure date"],
    [-2, "Already departed"],
    [0, "Departs today"],
    [1, "Departs tomorrow"],
    [6, "Departs in 6 days"],
  ] as const)("labels departure offset %s as %s", (offset, label) => {
    expect(amendmentDepartureLabel(row({ departureDate: offset === null ? null : localDeparture(offset) }), NOW)).toBe(label);
  });
});

describe("amendment local-calendar departure filters", () => {
  it.each([["next_7", 7], ["next_14", 14], ["next_30", 30]] as const)(
    "%s includes today through +%i minus one, with exact midnight boundaries",
    (departure, length) => {
      expect(matches({ departureDate: localDeparture(-1, 23, 59, 59, 999) }, { departure })).toBe(false);
      expect(matches({ departureDate: localDeparture(0) }, { departure })).toBe(true);
      expect(matches({ departureDate: localDeparture(length - 1, 23, 59, 59, 999) }, { departure })).toBe(true);
      expect(matches({ departureDate: localDeparture(length) }, { departure })).toBe(false);
      expect(matches({ departureDate: null }, { departure })).toBe(false);
    },
  );

  it("today includes the entire local date and neither adjacent date", () => {
    for (const date of [localDeparture(0), localDeparture(0, 23, 59, 59, 999)]) {
      expect(matches({ departureDate: date }, { departure: "today" })).toBe(true);
    }
    for (const date of [localDeparture(-1, 23, 59, 59, 999), localDeparture(1), null]) {
      expect(matches({ departureDate: date }, { departure: "today" })).toBe(false);
    }
  });

  it("departed means before today, not an earlier time today", () => {
    expect(matches({ departureDate: localDeparture(-1, 23, 59, 59, 999) }, { departure: "departed" })).toBe(true);
    for (const departureDate of [localDeparture(0), localDeparture(1), null]) {
      expect(matches({ departureDate }, { departure: "departed" })).toBe(false);
    }
  });

  it("missing accepts only absent/blank/invalid dates, and all retains them", () => {
    for (const departureDate of [null, undefined, "", "  ", "invalid", new Date(NaN)]) {
      expect(matches({ departureDate }, { departure: "missing" })).toBe(true);
      expect(matches({ departureDate }, { departure: "all" })).toBe(true);
      for (const departure of ["today", "departed", "next_7", "next_14", "next_30"] as const) {
        expect(matches({ departureDate }, { departure })).toBe(false);
      }
    }
    expect(matches({ departureDate: localDeparture(0) }, { departure: "missing" })).toBe(false);
  });
});

describe("amendment stage, agent, and assignee filters", () => {
  const stageRows = [
    row({ id: 1, pipelineStage: "To Do" }),
    row({ id: 2, pipelineStage: "In Progress" }),
    row({ id: 3, pipelineStage: "Actioned", status: "actioned" }),
    row({ id: 4, pipelineStage: "To Do", status: "rejected" }),
    row({ id: 5, pipelineStage: "Actioned", status: "rejected" }),
  ];

  it("supports all, pending, each pipeline stage, and rejected with rejection priority", () => {
    for (const [stage, expected] of [
      ["all", [1, 2, 3, 4, 5]], ["pending", [1, 2]], ["To Do", [1]],
      ["In Progress", [2]], ["Actioned", [3]], ["rejected", [4, 5]],
    ] as const) {
      expect(sortedIds(stageRows, { stage })).toEqual(expected);
    }
    expect(amendmentStage(stageRows[4])).toBe("rejected");
  });

  it("documents unknown or missing stage/status fallback as To Do, unless rejected", () => {
    expect(amendmentStage(row({ pipelineStage: "Unknown", status: "unknown" }))).toBe("To Do");
    expect(amendmentStage(row({ pipelineStage: null, status: null }))).toBe("To Do");
    expect(amendmentStage(row({ pipelineStage: "In Progress", status: "unknown" }))).toBe("In Progress");
    expect(amendmentStage(row({ pipelineStage: "Unknown", status: "rejected" }))).toBe("rejected");
  });

  it("does not treat a legacy actioned-status amendment as pending", () => {
    expect(matches({ status: "actioned", pipelineStage: null }, { stage: "pending" })).toBe(false);
  });

  it("prefers bookingAgentId over the legacy submitting agentId", () => {
    expect(matches({ bookingAgentId: 30, agentId: 20 }, { agent: "30" })).toBe(true);
    expect(matches({ bookingAgentId: 30, agentId: 20 }, { agent: "20" })).toBe(false);
  });

  it("falls back to legacy agentId when bookingAgentId is null or absent", () => {
    for (const bookingAgentId of [null, undefined]) {
      expect(matches({ bookingAgentId, agentId: 20 }, { agent: "20" })).toBe(true);
    }
    expect(matches({ bookingAgentId: null, agentId: null }, { agent: "20" })).toBe(false);
    expect(matches({ bookingAgentId: null, agentId: null }, { agent: "all" })).toBe(true);
  });

  it("filters same-name agents by distinct IDs rather than their display name", () => {
    const rows = [row({ id: 1, bookingAgentId: 30 }), row({ id: 2, bookingAgentId: 31 })];
    expect(sortedIds(rows, { agent: "30" })).toEqual([1]);
    expect(sortedIds(rows, { agent: "31" })).toEqual([2]);
    expect(amendmentFilterOptions(rows, "agent")).toEqual([
      { value: "30", label: "Alex Agent" }, { value: "31", label: "Alex Agent" },
    ]);
  });

  it("assignee all includes assigned and unassigned; unassigned only accepts null/undefined IDs", () => {
    for (const assignedToId of [40, 41, null, undefined]) {
      expect(matches({ assignedToId }, { assignee: "all" })).toBe(true);
      expect(matches({ assignedToId }, { assignee: "unassigned" })).toBe(assignedToId == null);
    }
  });

  it("assigned to me selects only the current user's ID", () => {
    expect(matches({ assignedToId: 40 }, { assignee: "me" }, 40)).toBe(true);
    expect(matches({ assignedToId: 41 }, { assignee: "me" }, 40)).toBe(false);
    expect(matches({ assignedToId: null }, { assignee: "me" }, 40)).toBe(false);
  });

  it("assigned to me fails closed when the current user is undefined", () => {
    expect(matches({ assignedToId: 40 }, { assignee: "me" })).toBe(false);
    expect(matches({ assignedToId: undefined }, { assignee: "me" })).toBe(false);
  });

  it("matches explicit assignee IDs without cross-matching identical names", () => {
    const rows = [row({ id: 1, assignedToId: 40 }), row({ id: 2, assignedToId: 41 })];
    expect(sortedIds(rows, { assignee: "40" })).toEqual([1]);
    expect(sortedIds(rows, { assignee: "41" })).toEqual([2]);
    expect(matches({ assignedToId: null }, { assignee: "40" })).toBe(false);
  });

  it("combines filters conjunctively rather than allowing search to bypass them", () => {
    const selected = { search: "jamie", stage: "pending", agent: "30", assignee: "me", departure: "next_7" } as const;
    expect(matches({}, selected, 40)).toBe(true);
    expect(matches({ status: "rejected" }, selected, 40)).toBe(false);
    expect(matches({ departureDate: localDeparture(7) }, selected, 40)).toBe(false);
    expect(matches({ bookingAgentId: 31 }, selected, 40)).toBe(false);
    expect(matches({ assignedToId: 41 }, selected, 40)).toBe(false);
  });
});

describe("amendment normalized multiword search", () => {
  it("normalizes both query and row text with NFKC and ignores case", () => {
    expect(matches({ clientName: "ＪＡＭＩＥ ＣＬＩＥＮＴ", details: "Office ﬂight" }, { search: "jamie FLIGHT" })).toBe(true);
    expect(matches({ clientName: "Jamie Client" }, { search: "ＪＡＭＩＥ" })).toBe(true);
  });

  it("requires every word, allows cross-field matches, and ignores word order", () => {
    expect(matches({ ptsRef: "PTS-777", details: "change flight" }, { search: " staff\nJAMIE  777\tflight " })).toBe(true);
    expect(matches({ ptsRef: "PTS-777", details: "change flight" }, { search: "jamie unavailable" })).toBe(false);
  });

  it("searches client, agent, assignee, amendment/booking IDs, PTS, Orbit CRM, Topdog, and details", () => {
    const searchable = row({
      id: 8675309, bookingId: 246810, clientName: "ClientNeedle", agentName: "AgentNeedle",
      assignedToName: "StaffNeedle", ptsRef: "PTS-555", crmRef: "ORBIT-666",
      topdogRef: "TOPDOG-777", details: "DetailsNeedle",
    });
    for (const search of ["clientneedle", "agentneedle", "staffneedle", "8675309", "246810", "pts-555", "orbit-666", "topdog-777", "detailsneedle"]) {
      expect(amendmentMatches(searchable, filters({ search }), NOW), search).toBe(true);
    }
  });

  it.each(["agentId", "bookingAgentId", "assignedToId"] as const)("includes the numeric %s in all-ID search", (field) => {
    expect(matches({ [field]: 987654321 }, { search: "987654321" })).toBe(true);
  });

  it("blank search includes rows with missing names and references without stringifying null", () => {
    const unnamed = { clientName: null, agentName: null, assignedToName: null, ptsRef: null, crmRef: null, topdogRef: null, details: null };
    expect(matches(unnamed, { search: " \t\n " })).toBe(true);
    expect(matches(unnamed, { search: "null" })).toBe(false);
    expect(matches(unnamed, { search: "undefined" })).toBe(false);
  });
});

describe("amendment urgency sorting and stable immutable results", () => {
  it("orders today/upcoming ascending, then departed most recent first, then missing/invalid", () => {
    const rows = [
      row({ id: 8, departureDate: null }), row({ id: 5, departureDate: localDeparture(-3) }),
      row({ id: 3, departureDate: localDeparture(6) }), row({ id: 6, departureDate: "bad-date" }),
      row({ id: 2, departureDate: localDeparture(1) }), row({ id: 4, departureDate: localDeparture(-1) }),
      row({ id: 1, departureDate: localDeparture(0) }), row({ id: 7, departureDate: new Date(NaN) }),
    ];
    expect(sortedIds(rows)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("breaks same-local-departure-day ties by oldest submission, then ID, not time of day", () => {
    const rows = [
      row({ id: 3, departureDate: localDeparture(1), createdAt: new Date(2026, 10, 2) }),
      row({ id: 2, departureDate: localDeparture(1, 1), createdAt: new Date(2026, 10, 1) }),
      row({ id: 1, departureDate: localDeparture(1, 23), createdAt: new Date(2026, 10, 1) }),
    ];
    expect(sortedIds(rows)).toEqual([1, 2, 3]);
  });

  it("departure latest orders valid timestamps descending and keeps missing/invalid last", () => {
    const rows = [row({ id: 4, departureDate: null }), row({ id: 2, departureDate: localDeparture(0) }),
      row({ id: 3, departureDate: localDeparture(-1) }), row({ id: 1, departureDate: localDeparture(3) }),
      row({ id: 5, departureDate: "invalid" })];
    expect(sortedIds(rows, { sort: "departure_latest" })).toEqual([1, 2, 3, 4, 5]);
  });

  it.each([ ["submitted_oldest", [1, 2, 3, 4, 5]], ["submitted_newest", [3, 2, 1, 4, 5]] ] as const)(
    "%s orders submissions as requested and keeps missing/invalid submissions last", (sort, expected) => {
      const rows = [row({ id: 5, createdAt: "invalid" }), row({ id: 2, createdAt: new Date(2026, 10, 2) }),
        row({ id: 4, createdAt: null }), row({ id: 3, createdAt: new Date(2026, 10, 3) }),
        row({ id: 1, createdAt: new Date(2026, 10, 1) })];
      expect(sortedIds(rows, { sort })).toEqual(expected);
    },
  );

  it("uses submission then ID even when every departure is invalid or missing", () => {
    const rows = [row({ id: 3, departureDate: new Date(NaN), createdAt: null }),
      row({ id: 2, departureDate: "invalid", createdAt: new Date(2026, 10, 1) }),
      row({ id: 1, departureDate: "", createdAt: new Date(2026, 10, 1) })];
    for (const sort of ["departure_soonest", "departure_latest"] as const) {
      expect(sortedIds(rows, { sort })).toEqual([1, 2, 3]);
    }
  });

  it("returns a new array without mutating source rows, source order, Dates, now, or filters", () => {
    const rows = Object.freeze([Object.freeze(row({ id: 2, departureDate: localDeparture(2) })), Object.freeze(row({ id: 1 }))]);
    const selected = Object.freeze(filters());
    const originalTimes = rows.map((item) => [(item.departureDate as Date).getTime(), (item.createdAt as Date).getTime()]);
    const nowTime = NOW.getTime();
    const result = filterAndSortAmendments(rows, selected, NOW);
    expect(result).not.toBe(rows);
    expect(result.map((item) => item.id)).toEqual([1, 2]);
    expect(rows.map((item) => item.id)).toEqual([2, 1]);
    expect(result[0]).toBe(rows[1]);
    expect(rows.map((item) => [(item.departureDate as Date).getTime(), (item.createdAt as Date).getTime()])).toEqual(originalTimes);
    expect(NOW.getTime()).toBe(nowTime);
    expect(selected).toEqual(DEFAULT_AMENDMENT_FILTERS);
  });

  it("preserves original relative order for completely equal keys", () => {
    const first = { ...row(), marker: "first" };
    const second = { ...row(), marker: "second" };
    expect(filterAndSortAmendments([first, second], filters(), NOW).map((item) => item.marker)).toEqual(["first", "second"]);
  });

  it("returns empty arrays for empty input and for filters with no matches", () => {
    expect(filterAndSortAmendments([], filters(), NOW)).toEqual([]);
    expect(sortedIds([row()], { search: "no-such-value" })).toEqual([]);
  });
});

describe("amendment agent and assignee option lists", () => {
  it("deduplicates agents by preferred owner ID and sorts labels without mutating input", () => {
    const rows = Object.freeze([
      row({ bookingAgentId: 31, agentName: "Zed" }), row({ bookingAgentId: 30, agentName: "Alex" }),
      row({ bookingAgentId: 30, agentName: "Alex" }), row({ bookingAgentId: null, agentId: 32, agentName: "Beth" }),
      row({ bookingAgentId: null, agentId: null }),
    ]);
    expect(amendmentFilterOptions(rows, "agent")).toEqual([
      { value: "30", label: "Alex" }, { value: "32", label: "Beth" }, { value: "31", label: "Zed" },
    ]);
    expect(rows[0].agentName).toBe("Zed");
  });

  it("deduplicates assignees by ID and retains distinct IDs with identical staff names", () => {
    const rows = [row({ assignedToId: 41 }), row({ assignedToId: 40 }), row({ assignedToId: 40 }), row({ assignedToId: null })];
    expect(amendmentFilterOptions(rows, "assignee")).toEqual([
      { value: "40", label: "Sam Staff" }, { value: "41", label: "Sam Staff" },
    ]);
  });

  it("uses generic names for missing/blank labels and upgrades a fallback when a real name appears", () => {
    expect(amendmentFilterOptions([row({ agentName: "  ", assignedToName: null })], "agent")).toEqual([{ value: "30", label: "Agent #30" }]);
    expect(amendmentFilterOptions([row({ assignedToName: "" })], "assignee")).toEqual([{ value: "40", label: "Staff #40" }]);
    expect(amendmentFilterOptions([row({ agentName: null }), row({ agentName: " Alex " })], "agent")).toEqual([{ value: "30", label: "Alex" }]);
    expect(amendmentFilterOptions([], "agent")).toEqual([]);
    expect(amendmentFilterOptions([], "assignee")).toEqual([]);
  });
});

describe("amendment list static query safeguards (no DB/provider imports)", () => {
  const database = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
  const routers = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
  const start = database.indexOf("export async function getAllAmendments()");
  const end = database.indexOf("export async function actionAmendment", start);
  const query = database.slice(start, end);

  it("retains the minimal booking projection with CRM reference and preferred owner ID enrichment", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const projection = query.match(/db\.select\(\{([\s\S]*?)\}\)\.from\(bookings\)/)?.[1];
    expect(projection).toBeDefined();
    const fields = [...projection!.matchAll(/(\w+)\s*:\s*bookings\.(\w+)/g)].map((match) => [match[1], match[2]]);
    expect(fields).toEqual([
      ["id", "id"], ["agentId", "agentId"], ["clientName", "clientName"], ["ptsRef", "ptsRef"],
      ["topdogRef", "topdogRef"], ["crmRef", "crmRef"], ["departureDate", "departureDate"],
    ]);
    expect(query).toMatch(/bookingAgentId:\s*bookingMap\.get\(a\.bookingId\)\?\.agentId\s*\?\?\s*null/);
    expect(query).toMatch(/crmRef:\s*bookingMap\.get\(a\.bookingId\)\?\.crmRef\s*\?\?\s*null/);
    expect(query.match(/db\.select\(\{\s*id:\s*users\.id,\s*name:\s*users\.name\s*\}\)\.from\(users\)/g)).toHaveLength(2);
  });

  it("keeps the all-amendments endpoint behind its adminProcedure gate", () => {
    expect(routers).toMatch(/all:\s*adminProcedure\.query\(async\s*\(\)\s*=>\s*\{\s*return getAllAmendments\(\);\s*\}\)/);
  });

  it("keeps list enrichment read-only without schema writes or unbounded booking selection", () => {
    expect(query).toMatch(/db\.select\(\)\.from\(amendments\)/);
    expect(query).toContain(".where(inArray(bookings.id, bookingIds))");
    expect(query).not.toMatch(/\.(?:insert|update|delete|execute)\s*\(|\b(?:ALTER|CREATE|DROP)\s+TABLE\b/i);
    expect(query).not.toMatch(/db\.select\(\)\.from\(bookings\)/);
  });
});
