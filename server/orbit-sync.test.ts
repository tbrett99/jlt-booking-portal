import { describe, it, expect } from "vitest";

describe("orbit-sync environment", () => {
  it("ORBIT_WEBHOOK_SECRET is set", () => {
    expect(process.env.ORBIT_WEBHOOK_SECRET).toBeTruthy();
  });

  it("mapClaimStatus maps portal statuses to Orbit statuses correctly", async () => {
    const { mapClaimStatus } = await import("./orbit-sync");
    expect(mapClaimStatus("paid")).toBe("claimed");
    expect(mapClaimStatus("awaiting_payment")).toBe("partial");
    expect(mapClaimStatus("processing")).toBe("pending");
    expect(mapClaimStatus("pending")).toBe("pending");
    expect(mapClaimStatus("notice_hold")).toBe("pending");
    expect(mapClaimStatus("top_up_required")).toBe("pending");
    expect(mapClaimStatus(null)).toBe("unclaimed");
    expect(mapClaimStatus(undefined)).toBe("unclaimed");
    expect(mapClaimStatus("unknown")).toBe("unclaimed");
  });
});
