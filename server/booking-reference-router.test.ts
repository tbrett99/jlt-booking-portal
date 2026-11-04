import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const functions = new Map<string, any>();
  const fn = (key: string) => {
    if (!functions.has(key)) functions.set(key, vi.fn(async () => undefined));
    return functions.get(key);
  };
  return { fn, functions };
});
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([name, value]) => [name, typeof value === "function" ? mocks.fn(name) : value]));
});
vi.mock("./email", () => ({ sendNotificationEmail: vi.fn(), sendDirectEmail: vi.fn(), sendCredentialsEmail: vi.fn() }));
vi.mock("./agent-merge-identity", () => ({ assertAgentNotMerged: vi.fn(), getArchivedAgentMergeIds: vi.fn(async () => []), getAgentMergeTarget: vi.fn(async () => null) }));
import { BookingReferenceConflictError } from "./booking-reference-guard";
import { appRouter } from "./routers";

function caller(role: "admin" | "agent" = "admin") {
  return appRouter.createCaller({ user: { id: 5, role, name: "Synthetic staff", isActive: true } as any, req: { headers: {}, protocol: "https" } as any, res: {} as any });
}
function noSideEffects() {
  expect(mocks.fn("createNote")).not.toHaveBeenCalled();
  expect(mocks.fn("updateBookingStage")).not.toHaveBeenCalled();
  expect(mocks.fn("createInAppNotification")).not.toHaveBeenCalled();
}

describe("booking reference route boundaries (offline)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Array.from(mocks.functions.values())) fn.mockResolvedValue(undefined);
    mocks.fn("getBookingById").mockResolvedValue({ id: 7, agentId: 5, ptsRef: null, crmRef: null, grossCostLockedAt: null, currentStage: "Creating own PTS file" });
    mocks.fn("getAllBookings").mockResolvedValue([]);
    mocks.fn("getUserById").mockResolvedValue({ id: 5, role: "agent" });
  });

  it("an admin gets the conflicting ID without a partial gross-price lock, note or stage change", async () => {
    mocks.fn("updateBookingAdminFields").mockRejectedValue(new BookingReferenceConflictError("ptsRef", "2T0007", 88));
    await expect(caller().bookings.updateAdminFields({ bookingId: 7, ptsRef: "2T0007", grossCost: 1500 })).rejects.toThrow("Booking #88");
    expect(mocks.fn("updateBookingAdminFields")).toHaveBeenCalledWith(7, expect.objectContaining({ ptsRef: "2T0007", grossCost: 1500, grossCostLockedAt: expect.any(Date) }));
    expect(mocks.fn("getDb")).not.toHaveBeenCalled();
    noSideEffects();
  });

  it.each(["ptsRef", "crmRef"] as const)("an agent sees no other booking ID on a %s conflict", async (field) => {
    mocks.fn("updateBookingAdminFields").mockRejectedValue(new BookingReferenceConflictError(field, "USED-REF", 88));
    const promise = field === "ptsRef" ? caller("agent").bookings.updatePtsDetails({ bookingId: 7, ptsRef: "USED-REF" }) : caller("agent").bookings.setCrmRef({ bookingId: 7, crmRef: "USED-REF" });
    try { await promise; throw new Error("expected rejection"); }
    catch (error: any) { expect(error.code).toBe("CONFLICT"); expect(error.message).toContain("another booking"); expect(error.message).not.toContain("88"); }
    noSideEffects();
  });

  it("ownership is checked before a reference change", async () => {
    mocks.fn("getBookingById").mockResolvedValue({ id: 7, agentId: 9 });
    await expect(caller("agent").bookings.setCrmRef({ bookingId: 7, crmRef: "USED-REF" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.fn("updateBookingAdminFields")).not.toHaveBeenCalled();
    noSideEffects();
  });

  it("a conflicting imported PTS reference is supplied before creation, never as a later orphan update", async () => {
    mocks.fn("createBooking").mockRejectedValue(new BookingReferenceConflictError("ptsRef", "2T0007", 88));
    const result = await caller().bookings.bulkImport([{ agentId: 5, clientName: "Synthetic client", departureDate: new Date(), ptsRef: "2T0007", grossCost: 1500 }]);
    expect(result.succeeded).toBe(0);
    expect(result.results[0].success).toBe(false);
    expect(mocks.fn("createBooking")).toHaveBeenCalledWith(expect.objectContaining({ ptsRef: "2T0007" }));
    expect(mocks.fn("updateBookingAdminFields")).not.toHaveBeenCalled();
    noSideEffects();
  });
});
