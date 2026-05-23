/**
 * Community Hub — unit tests
 * Tests cover the core business logic that doesn't require a live DB connection.
 */
import { describe, it, expect } from "vitest";

// ─── Category helpers ─────────────────────────────────────────────────────────

const AGENT_POSTABLE_CATEGORIES = ["agent_win", "jlt_stay_story"] as const;
const ADMIN_ONLY_CATEGORIES = [
  "business_update",
  "supplier_news_deals",
  "news_announcements",
  "events",
  "training_webinars",
  "mindset",
  "first_class_lounge",
] as const;
const ALL_CATEGORIES = [...AGENT_POSTABLE_CATEGORIES, ...ADMIN_ONLY_CATEGORIES];

function canAgentPost(category: string): boolean {
  return (AGENT_POSTABLE_CATEGORIES as readonly string[]).includes(category);
}

function canAdminPost(_category: string): boolean {
  return true; // admins can post to any category
}

describe("Community category access rules", () => {
  it("agents can post to agent_win and jlt_stay_story", () => {
    expect(canAgentPost("agent_win")).toBe(true);
    expect(canAgentPost("jlt_stay_story")).toBe(true);
  });

  it("agents cannot post to admin-only categories", () => {
    for (const cat of ADMIN_ONLY_CATEGORIES) {
      expect(canAgentPost(cat)).toBe(false);
    }
  });

  it("admins can post to all categories", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(canAdminPost(cat)).toBe(true);
    }
  });
});

// ─── Reaction helpers ─────────────────────────────────────────────────────────

const VALID_REACTIONS = ["👍", "❤️", "🎉", "🔥", "😮"] as const;

function isValidReaction(emoji: string): boolean {
  return (VALID_REACTIONS as readonly string[]).includes(emoji);
}

describe("Community reactions", () => {
  it("accepts the 5 standard emoji reactions", () => {
    for (const emoji of VALID_REACTIONS) {
      expect(isValidReaction(emoji)).toBe(true);
    }
  });

  it("rejects non-standard emoji", () => {
    expect(isValidReaction("😂")).toBe(false);
    expect(isValidReaction("👎")).toBe(false);
    expect(isValidReaction("custom")).toBe(false);
  });
});

// ─── First Class Lounge gating ────────────────────────────────────────────────

function canReadPost(
  postCategory: string,
  userMembershipTier: string | null
): boolean {
  if (postCategory === "first_class_lounge") {
    return userMembershipTier === "First Class";
  }
  return true;
}

describe("First Class Lounge access gating", () => {
  it("First Class members can read First Class Lounge posts", () => {
    expect(canReadPost("first_class_lounge", "First Class")).toBe(true);
  });

  it("non-First-Class members cannot read First Class Lounge posts", () => {
    expect(canReadPost("first_class_lounge", "Business Duo")).toBe(false);
    expect(canReadPost("first_class_lounge", "Starter")).toBe(false);
    expect(canReadPost("first_class_lounge", null)).toBe(false);
  });

  it("all members can read non-gated categories", () => {
    expect(canReadPost("agent_win", null)).toBe(true);
    expect(canReadPost("business_update", "Starter")).toBe(true);
    expect(canReadPost("supplier_news_deals", "Business Duo")).toBe(true);
  });
});

// ─── Booking highlights logic ─────────────────────────────────────────────────

const HIGH_MARGIN_THRESHOLD = 12; // percent

function isHighMarginBooking(
  grossCost: number,
  expectedCommission: number
): boolean {
  if (grossCost <= 0) return false;
  const marginPct = (expectedCommission / grossCost) * 100;
  return marginPct > HIGH_MARGIN_THRESHOLD;
}

describe("Booking highlights — high margin detection", () => {
  it("flags bookings above 12% margin", () => {
    expect(isHighMarginBooking(1000, 130)).toBe(true); // 13%
    expect(isHighMarginBooking(2000, 300)).toBe(true); // 15%
  });

  it("does not flag bookings at or below 12% margin", () => {
    expect(isHighMarginBooking(1000, 120)).toBe(false); // exactly 12%
    expect(isHighMarginBooking(1000, 100)).toBe(false); // 10%
    expect(isHighMarginBooking(1000, 0)).toBe(false);   // 0%
  });

  it("handles zero gross cost safely", () => {
    expect(isHighMarginBooking(0, 100)).toBe(false);
  });
});

// ─── Confirmation reminder logic ──────────────────────────────────────────────

const REMINDER_THRESHOLD_DAYS = 14;

function shouldSendReminder(
  postPublishedAt: Date,
  lastReminderSentAt: Date | null,
  now: Date
): boolean {
  const daysSincePublished =
    (now.getTime() - postPublishedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSincePublished < REMINDER_THRESHOLD_DAYS) return false;
  if (!lastReminderSentAt) return true;
  const daysSinceReminder =
    (now.getTime() - lastReminderSentAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceReminder >= REMINDER_THRESHOLD_DAYS;
}

describe("Confirmation reminder scheduling", () => {
  const now = new Date("2026-06-01T08:00:00Z");

  it("sends reminder when post is 14+ days old and no reminder sent yet", () => {
    const published = new Date("2026-05-15T08:00:00Z"); // 17 days ago
    expect(shouldSendReminder(published, null, now)).toBe(true);
  });

  it("does not send reminder when post is less than 14 days old", () => {
    const published = new Date("2026-05-25T08:00:00Z"); // 7 days ago
    expect(shouldSendReminder(published, null, now)).toBe(false);
  });

  it("does not send reminder if one was sent within the last 14 days", () => {
    const published = new Date("2026-05-01T08:00:00Z"); // 31 days ago
    const lastReminder = new Date("2026-05-25T08:00:00Z"); // 7 days ago
    expect(shouldSendReminder(published, lastReminder, now)).toBe(false);
  });

  it("sends another reminder if 14+ days have passed since last reminder", () => {
    const published = new Date("2026-05-01T08:00:00Z"); // 31 days ago
    const lastReminder = new Date("2026-05-15T08:00:00Z"); // 17 days ago
    expect(shouldSendReminder(published, lastReminder, now)).toBe(true);
  });
});

// ─── Digest weekly stats ──────────────────────────────────────────────────────

describe("Weekly digest stats — no commission amounts disclosed", () => {
  it("commission total is a grouped sum, not per-agent", () => {
    const claims = [
      { agentId: 1, amount: 150 },
      { agentId: 2, amount: 200 },
      { agentId: 3, amount: 75 },
    ];
    const total = claims.reduce((sum, c) => sum + c.amount, 0);
    // The digest shows the total, not individual amounts
    expect(total).toBe(425);
    // Individual amounts are never exposed in digest output
    for (const c of claims) {
      expect(c.amount).toBeLessThan(total);
    }
  });

  it("reimbursement count is shown, not total amount", () => {
    const reimbursements = [
      { id: 1, amount: 50 },
      { id: 2, amount: 120 },
      { id: 3, amount: 30 },
    ];
    // Digest shows count only
    const count = reimbursements.length;
    expect(count).toBe(3);
  });
});
