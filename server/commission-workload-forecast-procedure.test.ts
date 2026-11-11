import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mock = vi.hoisted(() => ({ forecast: vi.fn() }));
vi.mock("./commission-workload-forecast-service", () => ({
  getCommissionWorkloadForecast: mock.forecast,
}));
vi.mock("./db");
import { appRouter } from "./routers";
import { getDb, getRawDbPool } from "./db";

const input = {
  startDate: "2026-11-11",
  endDate: "2027-02-07",
  groupBy: "week" as const,
};
function caller(role: string | null) {
  return appRouter.createCaller({
    user: role
      ? {
          id: 17,
          role,
          isActive: true,
          portalStatus: "active",
          mustChangePassword: false,
        }
      : null,
    req: { headers: {} },
    res: {},
  } as any);
}

beforeEach(() => {
  mock.forecast.mockReset();
  vi.mocked(getDb)
    .mockReset()
    .mockRejectedValue(new Error("Unexpected DB read"));
  vi.mocked(getRawDbPool)
    .mockReset()
    .mockRejectedValue(new Error("Unexpected raw DB read"));
});

describe("commission workload forecast read procedure", () => {
  it.each(["admin", "super_admin"])(
    "allows %s and passes only the requested range to the report service",
    async role => {
      const result = {
        period: input,
        files: [],
        buckets: [],
        dueNowCount: 0,
        upcomingCount: 0,
        unscheduledCount: 0,
      };
      mock.forecast.mockResolvedValue(result);
      expect(await caller(role).commissionDue.forecast(input)).toEqual(result);
      expect(mock.forecast).toHaveBeenCalledTimes(1);
      expect(mock.forecast).toHaveBeenCalledWith(input);
      expect(getDb).not.toHaveBeenCalled();
      expect(getRawDbPool).not.toHaveBeenCalled();
    }
  );
  it.each(["agent", "instructor", "engagement", "user"])(
    "rejects %s before any record read",
    async role => {
      await expect(
        caller(role).commissionDue.forecast(input)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mock.forecast).not.toHaveBeenCalled();
      expect(getDb).not.toHaveBeenCalled();
      expect(getRawDbPool).not.toHaveBeenCalled();
    }
  );
  it("requires authentication", async () => {
    await expect(
      caller(null).commissionDue.forecast(input)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mock.forecast).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, startDate: "2026-02-30" },
    { ...input, endDate: "2026-13-01" },
    { ...input, startDate: "2026-11-11T12:00:00Z" },
    { ...input, startDate: "2028-01-01" },
    { ...input, startDate: "2026-01-01", endDate: "2028-01-01" },
    { ...input, groupBy: "day" },
  ])(
    "rejects malformed, reversed or oversized ranges before record access: %j",
    async badInput => {
      await expect(
        caller("admin").commissionDue.forecast(badInput as any)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mock.forecast).not.toHaveBeenCalled();
      expect(getDb).not.toHaveBeenCalled();
    }
  );
  it("permits a single-day range without changing its calendar dates", async () => {
    const oneDay = { ...input, endDate: input.startDate };
    mock.forecast.mockResolvedValue({ files: [], buckets: [] });
    await caller("admin").commissionDue.forecast(oneDay);
    expect(mock.forecast).toHaveBeenCalledTimes(1);
    expect(mock.forecast).toHaveBeenCalledWith(oneDay);
  });
  it("does not expose failed-query SQL, private values or partial totals", async () => {
    mock.forecast.mockRejectedValue(
      new Error(
        "Failed query SELECT bankAccountNumber WHERE email='private@example.test'"
      )
    );
    await expect(
      caller("admin").commissionDue.forecast(input)
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Commission forecast could not be loaded. No complete forecast is shown; please retry.",
    });
  });
  it("has an admin route/menu and Due-page shortcut without changing queue calculations", () => {
    const app = readFileSync(
      new URL("../client/src/App.tsx", import.meta.url),
      "utf8"
    );
    const layout = readFileSync(
      new URL("../client/src/components/PortalLayout.tsx", import.meta.url),
      "utf8"
    );
    const queue = readFileSync(
      new URL("../client/src/pages/admin/CommissionDue.tsx", import.meta.url),
      "utf8"
    );
    expect(app.match(/<Route path="\/commission-forecast"/g)).toHaveLength(1);
    expect(layout).toContain(
      'label: "Commission Forecast", href: "/commission-forecast"'
    );
    expect(queue).toContain('href="/commission-forecast"');
    expect(queue).toContain("trpc.commissionDue.list.useQuery()");
  });
});
