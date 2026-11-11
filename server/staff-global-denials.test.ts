import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db");
vi.mock("./staff-access", async importOriginal => {
  const actual = await importOriginal<typeof import("./staff-access")>();
  return {
    ...actual,
    getStaffAccessSnapshot: vi
      .fn()
      .mockResolvedValue({
        instructor: true,
        engagement: true,
        courseIds: [41],
        schemaAvailable: true,
      }),
    getInstructorCourseIds: vi.fn().mockResolvedValue([41]),
    requireInstructorCourse: vi.fn(),
    requireEngagementStaff: vi.fn(),
    recordStaffOperation: vi.fn(),
  };
});
import { appRouter } from "./routers";
import { getDb, getRawDbPool } from "./db";

function caller() {
  const ctx = {
    user: {
      id: 17,
      role: "agent",
      name: "Synthetic agent instructor",
      email: "staff@example.invalid",
      openId: "synthetic",
      isActive: true,
      mustChangePassword: false,
      portalStatus: "active",
    },
    req: { headers: {} },
    res: {},
  } as unknown as TrpcContext;
  return appRouter.createCaller(ctx);
}
beforeEach(() => {
  vi.mocked(getDb).mockRejectedValue(new Error("Unexpected database read"));
  vi.mocked(getRawDbPool).mockRejectedValue(
    new Error("Unexpected raw database read")
  );
  vi.mocked(getDb).mockClear();
  vi.mocked(getRawDbPool).mockClear();
});
const denied: [string, (c: ReturnType<typeof caller>) => Promise<unknown>][] = [
  ["CRM agent profile", c => c.crm.agentCrm.get({ userId: 99 })],
  ["Membership overview", c => c.crm.agentCrm.getMembershipsOverview()],
  ["Commission workload forecast", c => c.commissionDue.forecast({ startDate: "2026-11-11", endDate: "2027-02-07", groupBy: "week" })],
  [
    "GoCardless mandate administration",
    c => c.gocardless.adminGetDdStatus({ userId: 99 }),
  ],
  [
    "Super Admin weekly reports",
    c => c.superAdmin.weeklyStats({ weekStart: "2026-11-02" }),
  ],
  [
    "GoCardless paid-out income",
    c =>
      c.superAdmin.paidOutIncome({
        rangeStart: "2026-11-02",
        rangeEnd: "2026-11-08",
      }),
  ],
  [
    "Remittance import",
    c =>
      c.remittance.uploadBatch({
        name: "Synthetic",
        weekOf: "2026-11-02",
        rows: [],
      }),
  ],
  [
    "Base role elevation",
    c => c.users.updateRole({ userId: 17, role: "admin" }),
  ],
  ["Portal access approval", c => c.users.activatePortalAccess({ userId: 99 })],
  [
    "Academy access administration",
    c => c.academy.admin.setAccess({ agentId: 99, enabled: true }),
  ],
  [
    "Academy enrolment administration",
    c => c.academy.admin.enroll({ agentId: 99, courseId: 41 }),
  ],
  [
    "Staff assignment management",
    c =>
      c.staffAccess.adminSave({
        userId: 17,
        staffRole: "instructor",
        enabled: true,
        courseIds: [42],
        reason: "Synthetic elevation attempt",
      }),
  ],
  ["Staff assignment directory", c => c.staffAccess.adminList()],
];
describe("delegated staff cannot inherit broad admin rights", () => {
  it.each(denied)(
    "denies %s even when both delegated capabilities are present",
    async (_name, request) => {
      await expect(request(caller())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(getDb).not.toHaveBeenCalled();
      expect(getRawDbPool).not.toHaveBeenCalled();
    }
  );
});
