import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";
import { getRecruitmentProspectByApplicationToken } from "./recruitment-db";

describe("getRecruitmentProspectByApplicationToken", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the matching prospect from a direct database lookup", async () => {
    const prospect = { id: 321, email: "applicant@example.com", adminNotes: "APP_TOKEN:abc123" };
    const limit = vi.fn().mockResolvedValue([prospect]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.mocked(getDb).mockResolvedValue({ select } as any);

    await expect(getRecruitmentProspectByApplicationToken("abc123")).resolves.toEqual(prospect);
    expect(where).toHaveBeenCalledOnce();
    expect(limit).toHaveBeenCalledWith(1);
  });

  it("returns null when no token-matched prospect exists", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.mocked(getDb).mockResolvedValue({ select } as any);

    await expect(getRecruitmentProspectByApplicationToken("missing")).resolves.toBeNull();
  });
});
