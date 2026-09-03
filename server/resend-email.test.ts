import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { getConfirmedUnsubscribedEmailSet, isUnsubscribed, processUnsubscribe } from "./resend-email";

vi.mock("./db", () => ({ getDb: vi.fn() }));

describe("marketing unsubscribe confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not suppress an address when its unsubscribe token has not been confirmed", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 7, email: "prospect@example.com", unsubscribedAt: null }]);
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit }) }),
      }),
    } as any);

    await expect(isUnsubscribed("prospect@example.com")).resolves.toBe(false);
  });

  it("sets the unsubscribe timestamp only after the recipient uses their token", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 7, email: "prospect@example.com", unsubscribedAt: null }]);
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit }) }),
      }),
      update,
    } as any);

    await expect(processUnsubscribe("valid-token")).resolves.toBe("prospect@example.com");
    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ unsubscribedAt: expect.any(Date) }));
  });

  it("returns only addresses with an explicit unsubscribe timestamp for campaign suppression", async () => {
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { email: "OptedOut@example.com" },
          ]),
        }),
      }),
    } as any);

    await expect(getConfirmedUnsubscribedEmailSet()).resolves.toEqual(new Set(["optedout@example.com"]));
  });
});
