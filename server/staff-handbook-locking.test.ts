import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName } from "drizzle-orm";
const state = vi.hoisted(() => ({
  users: [] as any[],
  calls: [] as any[],
  attempts: 0,
  failures: [] as any[],
  committed: [] as string[],
  pending: [] as string[],
  db: null as any,
}));
vi.mock("./db", () => ({ getDb: async () => state.db }));
import {
  withHandbookRead,
  withHandbookWrite,
  isRetryableHandbookLockError,
} from "./staff-handbook-core";
import { getHandbookAccountLockPlan } from "./staff-handbook-lock-plan";
import { assertFreshStaffHandbookAccount } from "./staff-handbook-policy";
const dialect = new MySqlDialect();
function actor(id = 11) {
  return {
    id,
    role: "admin",
    isActive: true,
    portalStatus: "active",
    mustChangePassword: false,
  };
}
function database(transactional = false): any {
  return {
    select: (fields: any) => {
      let condition: any,
        hint: any,
        ordering = false,
        limit = 0;
      const chain: any = {
        from: (table: any, onIndex: any) => {
          expect(getTableName(table)).toBe("users");
          hint = onIndex;
          return chain;
        },
        where: (value: any) => {
          condition = value;
          return chain;
        },
        orderBy: () => {
          ordering = true;
          return chain;
        },
        limit: (count: number) => {
          limit = count;
          return chain;
        },
        for: async (mode: string) => {
          const params = dialect.sqlToQuery(condition).params;
          state.calls.push({
            kind: "lock",
            hint,
            ordering,
            limit,
            params,
            mode,
          });
          if (hint?.forceIndex === "PRIMARY" && state.failures.length)
            throw state.failures.shift();
          return rows(fields, params);
        },
        then: (resolve: any, reject: any) => {
          const params = dialect.sqlToQuery(condition).params;
          state.calls.push({
            kind: "read",
            fields: Object.keys(fields),
            params,
          });
          return Promise.resolve(rows(fields, params)).then(resolve, reject);
        },
      };
      return chain;
    },
    transaction: async (work: any) => {
      expect(transactional).toBe(false);
      state.attempts++;
      state.pending = [];
      try {
        const result = await work(database(true));
        state.committed.push(...state.pending);
        return result;
      } catch (error) {
        state.pending = [];
        throw error;
      }
    },
  };
}
function rows(fields: any, params: any[]) {
  if (Object.keys(fields).length === 1) {
    const ids = params.filter(value => typeof value === "number");
    return state.users
      .filter(user =>
        ids.length
          ? ids.includes(user.id)
          : user.role === "admin" &&
            user.isActive &&
            user.portalStatus === "active" &&
            !user.mustChangePassword
      )
      .slice()
      .reverse()
      .map(user => ({ id: user.id }));
  }
  return state.users.filter(user => user.id === params[0]);
}
beforeEach(() => {
  state.users = [actor(11), actor(22), { ...actor(33), role: "agent" }];
  state.calls = [];
  state.attempts = 0;
  state.failures = [];
  state.committed = [];
  state.pending = [];
  state.db = database();
});
describe("handbook transaction ordering and retries", () => {
  it("locks only the exact eligible administrator IDs in sorted primary-key order before work", async () => {
    const result = await withHandbookWrite(actor(), async (tx: any, id) => {
      const plan = getHandbookAccountLockPlan(tx);
      expect(Array.from(plan!)).toEqual([11, 22]);
      expect(id).toBe(11);
      state.calls.push({ kind: "work" });
      return { saved: true };
    });
    expect(result).toEqual({ saved: true });
    const first = state.calls.find(call => call.kind === "lock");
    expect(first).toMatchObject({
      hint: { forceIndex: "PRIMARY" },
      ordering: true,
      params: [11, 22],
      mode: "update",
    });
    expect(first.params).not.toContain(33);
    expect(state.calls.findIndex(call => call.kind === "work")).toBeGreaterThan(
      state.calls.findIndex(call => call.kind === "lock")
    );
  });
  it("keeps owner/reviewer checks within the preordered account plan", async () => {
    await expect(
      withHandbookWrite(actor(), async (tx: any) => {
        await assertFreshStaffHandbookAccount(tx, 22, true);
        state.pending.push("saved");
      })
    ).resolves.toBeUndefined();
    expect(state.committed).toEqual(["saved"]);
  });
  it("rejects a newly introduced administrator before taking an unplanned row lock", async () => {
    await expect(
      withHandbookWrite(actor(), async (tx: any) => {
        state.users.push(actor(44));
        await assertFreshStaffHandbookAccount(tx, 44, true);
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      state.calls.some(call => call.kind === "lock" && call.params.includes(44))
    ).toBe(false);
    expect(state.committed).toEqual([]);
  });
  it.each([
    { code: "ER_LOCK_DEADLOCK" },
    { errno: 1205 },
    { cause: { code: "ER_LOCK_WAIT_TIMEOUT" } },
  ])(
    "retries a complete rollback for a recognized lock failure %j",
    async failure => {
      state.failures = [failure];
      await withHandbookWrite(actor(), async () => {
        state.pending.push("one audit");
        return "ok";
      });
      expect(state.attempts).toBe(2);
      expect(state.committed).toEqual(["one audit"]);
    }
  );
  it("rolls back partial writes and repeats the whole callback rather than a single write", async () => {
    let run = 0;
    await withHandbookWrite(actor(), async () => {
      state.pending.push("audit");
      if (run++ === 0) throw { code: "ER_LOCK_DEADLOCK" };
      state.pending.push("notification");
    });
    expect(state.attempts).toBe(2);
    expect(state.committed).toEqual(["audit", "notification"]);
  });
  it("bounds lock retries to three and returns only a safe error", async () => {
    state.failures = [{ errno: 1213 }, { errno: 1213 }, { errno: 1213 }];
    await expect(
      withHandbookWrite(actor(), async () => "never")
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The internal handbook operation could not be completed.",
    });
    expect(state.attempts).toBe(3);
    expect(state.committed).toEqual([]);
  });
  it("does not retry business conflicts or arbitrary database errors", async () => {
    await expect(
      withHandbookWrite(actor(), async () => {
        throw new Error("private query secret");
      })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(state.attempts).toBe(1);
  });
  it("does not retry stale-version conflicts", async () => {
    const { fail } = await import("./staff-handbook-policy");
    await expect(
      withHandbookWrite(actor(), async () =>
        fail("CONFLICT", "This record changed.")
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.attempts).toBe(1);
  });
  it("rejects revoked access before acquiring any lock", async () => {
    state.users[0].isActive = false;
    await expect(
      withHandbookWrite(actor(), async () => "never")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.attempts).toBe(0);
    expect(state.calls.some(call => call.kind === "lock")).toBe(false);
  });
  it("withholds a slow read if access changes while it is running", async () => {
    await expect(
      withHandbookRead(actor(), async () => {
        state.users[0].role = "agent";
        return "private content";
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("caps the internal team rather than silently taking a partial lock plan", async () => {
    state.users = Array.from({ length: 501 }, (_, index) => actor(index + 1));
    await expect(
      withHandbookWrite(actor(), async () => "never")
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(state.calls.some(call => call.kind === "lock")).toBe(false);
  });
  it("detects nested driver lock errors without following cycles or parsing messages", () => {
    const cyclic: any = { code: "OTHER" };
    cyclic.cause = cyclic;
    expect(isRetryableHandbookLockError(cyclic)).toBe(false);
    expect(
      isRetryableHandbookLockError(
        new Error("ER_LOCK_DEADLOCK in private text")
      )
    ).toBe(false);
    expect(
      isRetryableHandbookLockError({ cause: { cause: { errno: 1213 } } })
    ).toBe(true);
  });
});

it("emits primary-key point locks in ascending order with the real MySQL builder", async () => {
  const { drizzle } = await import("drizzle-orm/mysql2");
  const { users } = await import("../drizzle/schema");
  const { asc, inArray } = await import("drizzle-orm");
  const query = drizzle
    .mock()
    .select({ id: users.id })
    .from(users, { forceIndex: "PRIMARY" })
    .where(inArray(users.id, [11, 22]))
    .orderBy(asc(users.id))
    .limit(500)
    .for("update")
    .toSQL();
  expect(query.sql).toContain("FORCE INDEX (PRIMARY)");
  expect(query.sql).toMatch(/where `users`\.`id` in \(\?, \?\)/);
  expect(query.sql).toContain("order by `users`.`id` asc");
  expect(query.sql).toContain("for update");
  expect(query.params).toEqual([11, 22, 500]);
});

it("rechecks author authority before commit and rolls back if it changes during a write", async () => {
  await expect(
    withHandbookWrite(actor(), async () => {
      state.pending.push("guide revision");
      state.users[0].role = "agent";
      return { id: 1, version: 2 };
    })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(state.committed).toEqual([]);
});
it("does not query authority again after a committed save", async () => {
  const base = state.db;
  state.db = {
    ...base,
    transaction: async (work: any) => {
      const result = await base.transaction(work);
      state.calls.push({ kind: "committed" });
      state.db = {
        select: () => {
          throw new Error("post-commit database outage sentinel");
        },
      };
      return result;
    },
  };
  await expect(
    withHandbookWrite(actor(), async () => {
      state.pending.push("verified guide");
      return { id: 1, version: 2 };
    })
  ).resolves.toEqual({ id: 1, version: 2 });
  expect(state.committed).toEqual(["verified guide"]);
  expect(state.calls[state.calls.length - 1].kind).toBe("committed");
});
