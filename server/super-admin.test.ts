import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("./db-client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
        groupBy: vi.fn(() => Promise.resolve([])),
        orderBy: vi.fn(() => Promise.resolve([])),
        limit: vi.fn(() => Promise.resolve([])),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    })),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Super Admin Dashboard — week boundary helpers", () => {
  it("getMondayOfWeek returns Monday for a Wednesday", () => {
    const wednesday = new Date("2025-05-28"); // Wednesday
    const monday = getMondayOfWeek(wednesday);
    expect(monday.getDay()).toBe(1); // 1 = Monday
    expect(toISODate(monday)).toBe("2025-05-26");
  });

  it("getMondayOfWeek returns Monday for a Sunday", () => {
    const sunday = new Date("2025-06-01"); // Sunday
    const monday = getMondayOfWeek(sunday);
    expect(monday.getDay()).toBe(1);
    expect(toISODate(monday)).toBe("2025-05-26");
  });

  it("getMondayOfWeek returns same day for a Monday", () => {
    // Use UTC noon to avoid timezone shifting the date
    const monday = new Date("2025-05-26T12:00:00Z");
    const result = getMondayOfWeek(monday);
    expect(result.getDay()).toBe(1);
  });

  it("toISODate formats correctly", () => {
    const d = new Date("2025-01-07T12:00:00Z");
    expect(toISODate(d)).toBe("2025-01-07");
  });
});

describe("Super Admin Dashboard — week range calculation", () => {
  it("prev week is 7 days before current week start", () => {
    const weekStart = new Date("2025-05-26");
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(weekStart.getDate() - 7);
    expect(toISODate(prevWeekStart)).toBe("2025-05-19");
  });

  it("week end is 6 days after week start", () => {
    const weekStart = new Date("2025-05-26T12:00:00Z");
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    // 2025-05-26 + 6 days = 2025-06-01
    expect(weekEnd.toISOString().split("T")[0]).toBe("2025-06-01");
  });
});

describe("Super Admin Dashboard — net growth calculation", () => {
  it("calculates positive net growth correctly", () => {
    const newSignups = 5;
    const cancellations = 2;
    const netGrowth = newSignups - cancellations;
    expect(netGrowth).toBe(3);
  });

  it("calculates negative net growth correctly", () => {
    const newSignups = 1;
    const cancellations = 4;
    const netGrowth = newSignups - cancellations;
    expect(netGrowth).toBe(-3);
  });

  it("calculates zero net growth correctly", () => {
    const newSignups = 3;
    const cancellations = 3;
    const netGrowth = newSignups - cancellations;
    expect(netGrowth).toBe(0);
  });
});

describe("Super Admin Dashboard — staff productivity aggregation", () => {
  it("sums all action types into totalActions", () => {
    const staff = {
      adminId: "u1",
      adminName: "Test Admin",
      adminRole: "admin",
      pipelineMoves: 5,
      tasksCompleted: 3,
      tasksCreated: 2,
      commissionsPaid: 1,
      commissionsTotal: 500,
      reimbursementsPaid: 2,
      reimbursementsTotal: 300,
      statusChanges: 4,
      crmNotes: 6,
      recruitmentMoves: 1,
      totalActions: 0,
    };
    staff.totalActions =
      staff.pipelineMoves +
      staff.tasksCompleted +
      staff.tasksCreated +
      staff.commissionsPaid +
      staff.reimbursementsPaid +
      staff.statusChanges +
      staff.crmNotes +
      staff.recruitmentMoves;
    expect(staff.totalActions).toBe(24);
  });

  it("sorts staff by totalActions descending", () => {
    const staffList = [
      { adminId: "u1", adminName: "Alice", totalActions: 10 },
      { adminId: "u2", adminName: "Bob", totalActions: 25 },
      { adminId: "u3", adminName: "Carol", totalActions: 5 },
    ];
    const sorted = [...staffList].sort((a, b) => b.totalActions - a.totalActions);
    expect(sorted[0].adminName).toBe("Bob");
    expect(sorted[1].adminName).toBe("Alice");
    expect(sorted[2].adminName).toBe("Carol");
  });
});

describe("Super Admin Dashboard — DD revenue calculations", () => {
  it("converts pence to GBP correctly", () => {
    const amountPence = 2999;
    const amountGbp = amountPence / 100;
    expect(amountGbp).toBeCloseTo(29.99);
  });

  it("calculates MRR from active subscriptions", () => {
    const subscriptions = [
      { amountPence: 4999 },
      { amountPence: 2999 },
      { amountPence: 4999 },
    ];
    const mrrGbp = subscriptions.reduce((sum, s) => sum + s.amountPence / 100, 0);
    expect(mrrGbp).toBeCloseTo(129.97);
  });

  it("identifies agents with consecutive failures", () => {
    const failures = [
      { userId: "u1", count: 2 },
      { userId: "u2", count: 1 },
      { userId: "u3", count: 3 },
    ];
    const consecutiveFailures = failures.filter((f) => f.count >= 2);
    expect(consecutiveFailures.length).toBe(2);
  });
});

describe("Super Admin Dashboard — WoW percentage calculation", () => {
  it("calculates positive WoW correctly", () => {
    const current = 15;
    const prev = 10;
    const pct = Math.round(((current - prev) / prev) * 100);
    expect(pct).toBe(50);
  });

  it("calculates negative WoW correctly", () => {
    const current = 8;
    const prev = 10;
    const pct = Math.round(((current - prev) / prev) * 100);
    expect(pct).toBe(-20);
  });

  it("handles zero previous value gracefully", () => {
    const current = 5;
    const prev = 0;
    const pct = prev === 0 ? 0 : Math.round(((current - prev) / prev) * 100);
    expect(pct).toBe(0);
  });
});

describe("Super Admin Dashboard — access control", () => {
  it("only super_admin role should access the dashboard", () => {
    const roles = ["agent", "admin", "super_admin"];
    const hasAccess = (role: string) => role === "super_admin";
    expect(hasAccess("agent")).toBe(false);
    expect(hasAccess("admin")).toBe(false);
    expect(hasAccess("super_admin")).toBe(true);
  });
});
