import { describe, it, expect } from "vitest";

describe("orbit-sync environment", () => {
  it("ORBIT_WEBHOOK_SECRET is set", () => {
    expect(process.env.ORBIT_WEBHOOK_SECRET).toBeTruthy();
  });

  it("mapClaimStatus preserves the Portal commission lifecycle for Orbit", async () => {
    const { mapClaimStatus } = await import("./orbit-sync");
    expect(mapClaimStatus("paid")).toBe("paid");
    expect(mapClaimStatus("awaiting_payment")).toBe("awaiting_payment");
    expect(mapClaimStatus("processing")).toBe("processing");
    expect(mapClaimStatus("pending")).toBe("pending");
    expect(mapClaimStatus("notice_hold")).toBe("notice_hold");
    expect(mapClaimStatus("top_up_required")).toBe("top_up_required");
    expect(mapClaimStatus(null)).toBe("unclaimed");
    expect(mapClaimStatus(undefined)).toBe("unclaimed");
    expect(mapClaimStatus("unknown")).toBe("pending");
  });
});
