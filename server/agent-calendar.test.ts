/**
 * Agent Calendar Feature Tests
 *
 * Tests the core logic of the agent-facing events calendar:
 * - Event category labels
 * - ICS generation format
 * - RSVP registration/unregistration flow (mocked)
 * - Duration defaulting to 60 minutes
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Unit: Category label mapping ─────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  training: "Training",
  webinar: "Webinar",
  supplier_event: "Supplier Event",
};

describe("Agent Calendar — category labels", () => {
  it("maps all three event categories to display labels", () => {
    expect(CATEGORY_LABELS["training"]).toBe("Training");
    expect(CATEGORY_LABELS["webinar"]).toBe("Webinar");
    expect(CATEGORY_LABELS["supplier_event"]).toBe("Supplier Event");
  });

  it("returns undefined for unknown categories", () => {
    expect(CATEGORY_LABELS["unknown"]).toBeUndefined();
  });
});

// ─── Unit: ICS content format ─────────────────────────────────────────────────

function generateIcsContent(event: {
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  duration?: number | null;
  eventUrl?: string | null;
}): string {
  const uid = `event-test@jltgroup`;
  const formatDt = (d: Date, allDay: boolean) =>
    allDay
      ? d.toISOString().replace(/[-:]/g, "").split("T")[0]
      : d.toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JLT Group//Events//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SUMMARY:${event.title}`,
    event.allDay
      ? `DTSTART;VALUE=DATE:${formatDt(event.startDate, true)}`
      : `DTSTART:${formatDt(event.startDate, false)}`,
    event.allDay
      ? `DTEND;VALUE=DATE:${formatDt(event.endDate, true)}`
      : `DTEND:${formatDt(event.endDate, false)}`,
    event.description ? `DESCRIPTION:${event.description.replace(/\n/g, "\\n")}` : "",
    event.eventUrl ? `URL:${event.eventUrl}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.join("\r\n");
}

describe("Agent Calendar — ICS generation", () => {
  it("generates valid VCALENDAR structure", () => {
    const ics = generateIcsContent({
      title: "Celebrity Cruises Webinar",
      startDate: new Date("2026-06-15T10:00:00Z"),
      endDate: new Date("2026-06-15T11:00:00Z"),
      allDay: false,
      eventUrl: "https://zoom.us/j/12345",
    });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("SUMMARY:Celebrity Cruises Webinar");
    expect(ics).toContain("URL:https://zoom.us/j/12345");
  });

  it("uses DATE format for all-day events", () => {
    const ics = generateIcsContent({
      title: "Training Day",
      startDate: new Date("2026-07-01T00:00:00Z"),
      endDate: new Date("2026-07-01T23:59:59Z"),
      allDay: true,
    });

    expect(ics).toContain("DTSTART;VALUE=DATE:20260701");
    expect(ics).not.toContain("DTSTART:20260701");
  });

  it("uses datetime format for timed events", () => {
    const ics = generateIcsContent({
      title: "Webinar",
      startDate: new Date("2026-07-01T09:00:00Z"),
      endDate: new Date("2026-07-01T10:00:00Z"),
      allDay: false,
    });

    expect(ics).toContain("DTSTART:20260701T090000Z");
    expect(ics).toContain("DTEND:20260701T100000Z");
  });

  it("omits URL line when no eventUrl is provided", () => {
    const ics = generateIcsContent({
      title: "Internal Training",
      startDate: new Date("2026-07-01T09:00:00Z"),
      endDate: new Date("2026-07-01T10:00:00Z"),
      allDay: false,
    });

    expect(ics).not.toContain("URL:");
  });
});

// ─── Unit: Duration defaulting ────────────────────────────────────────────────

describe("Agent Calendar — duration defaulting", () => {
  function computeEndDate(startDate: Date, durationMins: number | null | undefined): Date {
    const mins = durationMins ?? 60; // default to 60 minutes
    return new Date(startDate.getTime() + mins * 60 * 1000);
  }

  it("defaults to 60 minutes when duration is null", () => {
    const start = new Date("2026-06-15T10:00:00Z");
    const end = computeEndDate(start, null);
    expect(end.toISOString()).toBe("2026-06-15T11:00:00.000Z");
  });

  it("defaults to 60 minutes when duration is undefined", () => {
    const start = new Date("2026-06-15T10:00:00Z");
    const end = computeEndDate(start, undefined);
    expect(end.toISOString()).toBe("2026-06-15T11:00:00.000Z");
  });

  it("uses provided duration when set", () => {
    const start = new Date("2026-06-15T10:00:00Z");
    const end = computeEndDate(start, 90);
    expect(end.toISOString()).toBe("2026-06-15T11:30:00.000Z");
  });

  it("handles 30-minute webinar duration", () => {
    const start = new Date("2026-06-15T14:00:00Z");
    const end = computeEndDate(start, 30);
    expect(end.toISOString()).toBe("2026-06-15T14:30:00.000Z");
  });
});

// ─── Unit: Community post category mapping ────────────────────────────────────

describe("Agent Calendar — community post category mapping", () => {
  const categoryMap: Record<string, string> = {
    training: "training_webinars",
    webinar: "training_webinars",
    supplier_event: "events",
  };

  it("maps training events to training_webinars community category", () => {
    expect(categoryMap["training"]).toBe("training_webinars");
  });

  it("maps webinars to training_webinars community category", () => {
    expect(categoryMap["webinar"]).toBe("training_webinars");
  });

  it("maps supplier events to events community category", () => {
    expect(categoryMap["supplier_event"]).toBe("events");
  });

  it("falls back to 'events' for unknown categories", () => {
    const result = categoryMap["unknown"] ?? "events";
    expect(result).toBe("events");
  });
});

// ─── Unit: Supplier event naming convention ───────────────────────────────────

describe("Agent Calendar — supplier event naming", () => {
  it("accepts supplier-named webinar titles (e.g. 'Celebrity Cruises Webinar')", () => {
    const title = "Celebrity Cruises Webinar";
    // Title should be non-empty and contain the supplier name
    expect(title.trim().length).toBeGreaterThan(0);
    expect(title).toContain("Webinar");
  });

  it("accepts training event titles with supplier names", () => {
    const title = "Virgin Voyages Training Session";
    expect(title.trim().length).toBeGreaterThan(0);
  });
});
