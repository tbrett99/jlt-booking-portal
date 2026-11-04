import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bookings } from "../drizzle/schema";

// The real db module must never load, even when DATABASE_URL is absent.
vi.mock("./db", () => ({
  getRawDbPool: vi.fn(() => {
    throw new Error("Live database access is forbidden in these offline tests");
  }),
}));
import { getRawDbPool } from "./db";
import {
  assertBookingReferencesAvailable,
  BookingReferenceConflictError,
  bookingReferenceMatch,
  findBookingByUniqueReference,
  normaliseBookingReference,
  staffBookingReferenceError,
  withBookingReferenceLock,
} from "./booking-reference-guard";

type CompiledQuery = { sql: string; params: unknown[] };
type Row = Record<string, unknown>;
const dialect = new MySqlDialect();
const fields = ["ptsRef", "crmRef"] as const;
const labels = { ptsRef: "PTS", crmRef: "Orbit" } as const;
const otherBooking = {
  id: 987654321,
  agentId: 123456789,
  clientName: "Private Customer",
  clientEmail: "private@example.test",
  destination: "Private Destination",
};

/** Compile the actual Drizzle query, but resolve it from memory only. */
function offlineDatabase(
  resolveRows: (query: CompiledQuery) => Row[] = () => []
) {
  const builderDatabase = drizzle.mock();
  const queries: CompiledQuery[] = [];
  const database = {
    select: vi.fn((selection?: { id: typeof bookings.id }) => ({
      from: vi.fn((table: typeof bookings) => ({
        where: vi.fn((predicate: SQL) => {
          const builder = selection
            ? builderDatabase.select(selection)
            : builderDatabase.select();
          const query = builder.from(table).where(predicate).$dynamic();
          const chain = {
            orderBy: vi.fn((column: typeof bookings.id) => {
              query.orderBy(column);
              return chain;
            }),
            limit: vi.fn(async (limit: number) => {
              const compiled = dialect.sqlToQuery(query.limit(limit).getSQL());
              queries.push(compiled);
              return resolveRows(compiled);
            }),
          };
          return chain;
        }),
      })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  };
  return { database, queries };
}

function expectNoWrites(
  database: ReturnType<typeof offlineDatabase>["database"]
) {
  expect(database.insert).not.toHaveBeenCalled();
  expect(database.update).not.toHaveBeenCalled();
  expect(database.delete).not.toHaveBeenCalled();
  expect(database.execute).not.toHaveBeenCalled();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function lockSetup(
  acquired: number | string | null | undefined | Error = 1,
  released: number | string | null | Error = 1
) {
  const sequence: string[] = [];
  const connection = {
    query: vi.fn(async (query: string, params: unknown[]) => {
      if (query === "SELECT GET_LOCK(?, ?) AS acquired") {
        expect(params).toEqual(["jlt-booking-references", 10]);
        sequence.push("acquire");
        if (acquired instanceof Error) throw acquired;
        return [[{ acquired }]];
      }
      expect(query).toBe("SELECT RELEASE_LOCK(?) AS released");
      expect(params).toEqual(["jlt-booking-references"]);
      sequence.push("unlock");
      if (released instanceof Error) throw released;
      return [[{ released }]];
    }),
    release: vi.fn(() => {
      sequence.push("pool-release");
    }),
    destroy: vi.fn(() => {
      sequence.push("destroy");
    }),
  };
  const transaction = {
    connection,
    insert: vi.fn(async () => {
      sequence.push("write");
    }),
  };
  const database = {
    connection,
    transaction: vi.fn(
      async (work: (tx: typeof transaction) => Promise<unknown>) => {
        sequence.push("begin");
        try {
          const result = await work(transaction);
          sequence.push("commit");
          return result;
        } catch (error) {
          sequence.push("rollback");
          throw error;
        }
      }
    ),
  };
  const pool = { getConnection: vi.fn(async () => connection) };
  const dependencies = {
    pool,
    makeDatabase: vi.fn((actual: unknown) => {
      expect(actual).toBe(connection);
      return database;
    }),
  };
  return { sequence, connection, transaction, database, dependencies };
}

afterEach(() => {
  expect(getRawDbPool).not.toHaveBeenCalled();
  vi.clearAllMocks();
});

describe("normaliseBookingReference", () => {
  it.each([
    ["  abC-001/xy.09  ", "ABC-001/XY.09"],
    ["0000123", "0000123"],
    [" 000-a/b.c_+:# ", "000-A/B.C_+:#"],
    ["a b-c", "A B-C"],
    ["", null],
    [" \t\r\n ", null],
    [null, null],
    [undefined, null],
  ])(
    "normalises %j to %j without numeric or punctuation rewriting",
    (input, expected) => {
      expect(normaliseBookingReference(input)).toBe(expected);
    }
  );
});

describe("assertBookingReferencesAvailable", () => {
  it.each(fields)(
    "rejects duplicate %s with a protected, generic CONFLICT message",
    async field => {
      const { database, queries } = offlineDatabase(() => [otherBooking]);
      const error = await assertBookingReferencesAvailable(database, {
        [field]: " 00-a/b.09 ",
      }).catch(error => error);
      expect(error).toBeInstanceOf(BookingReferenceConflictError);
      expect(error).toMatchObject({
        code: "CONFLICT",
        field,
        reference: "00-A/B.09",
        conflictingBookingId: otherBooking.id,
      });
      expect(error.message).toBe(
        `${labels[field]} reference "00-A/B.09" is already assigned to another booking. Check the reference or contact Support. No changes have been saved.`
      );
      for (const privateValue of Object.values(otherBooking)) {
        expect(error.message).not.toContain(String(privateValue));
      }
      expect(error.message).not.toContain("Booking #");
      expect(database.select).toHaveBeenCalledOnce();
      expect(database.select).toHaveBeenCalledWith({ id: bookings.id });
      expect(queries).toHaveLength(1);
      expectNoWrites(database);
    }
  );

  it("returns canonical available values for both independent reference namespaces", async () => {
    const { database, queries } = offlineDatabase();
    await expect(
      assertBookingReferencesAvailable(database, {
        ptsRef: " 000-ab/12 ",
        crmRef: " 000-ab/12 ",
      })
    ).resolves.toEqual({ ptsRef: "000-AB/12", crmRef: "000-AB/12" });
    expect(queries).toHaveLength(2);
    expect(queries[0].sql).toContain("UPPER(`bookings`.`ptsRef`) REGEXP ?");
    expect(queries[0].sql).not.toContain("`crmRef`");
    expect(queries[1].sql).toContain("UPPER(TRIM(`bookings`.`crmRef`))");
    expect(queries[1].sql).not.toContain("`ptsRef`");
    expectNoWrites(database);
  });

  it.each(fields)(
    "preserves raw unchanged legacy duplicate %s and permits an unrelated save",
    async field => {
      // This database would report a duplicate if queried; unchanged refs must skip it.
      const { database } = offlineDatabase(() => [otherBooking]);
      const current = { id: 41, [field]: " 00-legacy/aBc " };
      const unrelatedSave = vi.fn();
      const result = await assertBookingReferencesAvailable(
        database,
        { [field]: "00-LEGACY/ABC" },
        current
      );
      unrelatedSave({ destination: "Updated Destination", ...result });
      expect(result).toEqual({ [field]: " 00-legacy/aBc " });
      expect(database.select).not.toHaveBeenCalled();
      expect(unrelatedSave).toHaveBeenCalledOnce();
      expect(unrelatedSave).toHaveBeenCalledWith({
        destination: "Updated Destination",
        [field]: " 00-legacy/aBc ",
      });
      expectNoWrites(database);
    }
  );

  it("does not read or rewrite omitted references during an unrelated edit", async () => {
    const { database } = offlineDatabase(() => [otherBooking]);
    await expect(
      assertBookingReferencesAvailable(
        database,
        {},
        {
          id: 41,
          ptsRef: " legacy ",
          crmRef: " legacy ",
        }
      )
    ).resolves.toEqual({});
    await expect(
      assertBookingReferencesAvailable(database, {
        ptsRef: undefined,
        crmRef: undefined,
      })
    ).resolves.toEqual({});
    expect(database.select).not.toHaveBeenCalled();
  });

  it("checks a changed reference even when the other field is an unchanged legacy duplicate", async () => {
    const { database, queries } = offlineDatabase();
    await expect(
      assertBookingReferencesAvailable(
        database,
        {
          ptsRef: "LEGACY",
          crmRef: " new/orbit ",
        },
        { id: 41, ptsRef: " legacy ", crmRef: "old" }
      )
    ).resolves.toEqual({
      ptsRef: " legacy ",
      crmRef: "NEW/ORBIT",
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("`bookings`.`crmRef`");
    expect(queries[0].params).toEqual(["NEW/ORBIT", 41, 1]);
  });

  it.each(["", " \t\n ", null])(
    "accepts blank/null %j without performing duplicate lookups",
    async value => {
      const { database } = offlineDatabase(() => [otherBooking]);
      await expect(
        assertBookingReferencesAvailable(database, {
          ptsRef: value,
          crmRef: value,
        })
      ).resolves.toEqual({ ptsRef: null, crmRef: null });
      await expect(
        assertBookingReferencesAvailable(
          database,
          { ptsRef: value, crmRef: value },
          {
            id: 41,
            ptsRef: "old-pts",
            crmRef: "old-orbit",
          }
        )
      ).resolves.toEqual({ ptsRef: null, crmRef: null });
      expect(database.select).not.toHaveBeenCalled();
      expectNoWrites(database);
    }
  );

  it.each(fields)(
    "rejects overlong new %s before reading or writing",
    async field => {
      const { database } = offlineDatabase();
      await expect(
        assertBookingReferencesAvailable(database, { [field]: "a".repeat(101) })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: `${labels[field]} reference must be 100 characters or fewer.`,
      });
      expect(database.select).not.toHaveBeenCalled();
      expectNoWrites(database);
    }
  );

  it.each(fields)("allows a 100-character %s", async field => {
    const { database } = offlineDatabase();
    await expect(
      assertBookingReferencesAvailable(database, { [field]: "a".repeat(100) })
    ).resolves.toEqual({ [field]: "A".repeat(100) });
    expect(database.select).toHaveBeenCalledOnce();
  });
});

describe("historical PTS token lists", () => {
  it("rejects a single proposed PTS token found in a historical comma-separated field", async () => {
    const duplicate = { ...otherBooking, ptsRef: " 2t1, 2T2 " };
    const { database, queries } = offlineDatabase(() => [duplicate]);
    await expect(
      assertBookingReferencesAvailable(database, { ptsRef: " 2t2 " })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      reference: "2T2",
      conflictingBookingId: otherBooking.id,
    });
    expect(queries[0].params).toEqual([
      "(^|,)[[:space:]]*2T2[[:space:]]*(,|$)",
      1,
    ]);
    expectNoWrites(database);
  });

  it("checks only the new token when adding 2T2 to an unchanged legacy 2T1", async () => {
    const { database, queries } = offlineDatabase();
    await expect(
      assertBookingReferencesAvailable(
        database,
        { ptsRef: " 2t1, 2t2 " },
        {
          id: 41,
          ptsRef: " 2T1 ",
        }
      )
    ).resolves.toEqual({ ptsRef: "2T1, 2T2" });
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([
      "(^|,)[[:space:]]*2T2[[:space:]]*(,|$)",
      41,
      1,
    ]);
    expectNoWrites(database);
  });

  it("preserves the complete raw unchanged PTS list and never queries historical duplicates", async () => {
    const { database } = offlineDatabase(() => [otherBooking]);
    await expect(
      assertBookingReferencesAvailable(
        database,
        { ptsRef: "2T1, 2T2" },
        {
          id: 41,
          ptsRef: " 2t1,   2T2 ",
        }
      )
    ).resolves.toEqual({ ptsRef: " 2t1,   2T2 " });
    expect(database.select).not.toHaveBeenCalled();
    expectNoWrites(database);
  });

  it("checks each distinct new PTS token and ignores empty list entries", async () => {
    const { database, queries } = offlineDatabase();
    await expect(
      assertBookingReferencesAvailable(database, { ptsRef: " 2t1, ,2t2,2T1, " })
    ).resolves.toEqual({ ptsRef: "2T1, 2T2, 2T1" });
    expect(queries.map(query => query.params)).toEqual([
      ["(^|,)[[:space:]]*2T1[[:space:]]*(,|$)", 1],
      ["(^|,)[[:space:]]*2T2[[:space:]]*(,|$)", 1],
    ]);
    expectNoWrites(database);
  });

  it("keeps Orbit comma-containing references as one full-string namespace", async () => {
    const { database, queries } = offlineDatabase();
    await expect(
      assertBookingReferencesAvailable(database, { crmRef: " 2t1, 2t2 " })
    ).resolves.toEqual({ crmRef: "2T1, 2T2" });
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual(["2T1, 2T2", 1]);
    expect(queries[0].sql).toContain("UPPER(TRIM(`bookings`.`crmRef`)) = ?");
    expect(queries[0].sql).not.toContain("REGEXP");
  });
});

describe("staffBookingReferenceError", () => {
  it.each(fields)(
    "reveals only the conflicting booking ID for %s, never customer or agent details",
    async field => {
      const { database } = offlineDatabase(() => [otherBooking]);
      const original = await assertBookingReferencesAvailable(database, {
        [field]: "00-ab",
      }).catch(error => error);
      let staffError: unknown;
      try {
        staffBookingReferenceError(original);
      } catch (error) {
        staffError = error;
      }
      expect(staffError).toBeInstanceOf(TRPCError);
      expect(staffError).not.toBeInstanceOf(BookingReferenceConflictError);
      expect(staffError).toMatchObject({
        code: "CONFLICT",
        message: `${labels[field]} reference "00-AB" is already assigned to Booking #${otherBooking.id}. Open that booking and check the reference before saving. No changes have been saved.`,
      });
      const message = (staffError as Error).message;
      for (const [key, value] of Object.entries(otherBooking)) {
        if (key !== "id") expect(message).not.toContain(String(value));
      }
      expect((staffError as TRPCError).cause).toBeUndefined();
    }
  );

  it("rethrows non-reference errors without changing their identity", () => {
    const original = new Error("unrelated failure");
    let caught: unknown;
    try {
      staffBookingReferenceError(original);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(original);
  });
});

describe("compiled MySQL reference queries", () => {
  it("matches only the Orbit namespace using parameterised UPPER/TRIM", () => {
    expect(
      dialect.sqlToQuery(bookingReferenceMatch("crmRef", " 000-a/'b "))
    ).toMatchObject({
      sql: "UPPER(TRIM(`bookings`.`crmRef`)) = ?",
      params: ["000-A/'B"],
    });
  });

  it("binds a PTS token regex with escaped punctuation rather than interpolating it into SQL", () => {
    const compiled = dialect.sqlToQuery(
      bookingReferenceMatch("ptsRef", " 000-a.b+?()[]{}^$|\\/c'd ")
    );
    expect(compiled).toMatchObject({
      sql: "UPPER(`bookings`.`ptsRef`) REGEXP ?",
      params: [
        String.raw`(^|,)[[:space:]]*000-A\.B\+\?\(\)\[\]\{\}\^\$\|\\/C'D[[:space:]]*(,|$)`,
      ],
    });
    expect(compiled.sql).not.toContain("000-A");
    expect(compiled.sql).not.toContain("crmRef");
  });

  it.each(fields)(
    "excludes the current booking for a changed %s and limits the check to one ID",
    async field => {
      const { database, queries } = offlineDatabase();
      await expect(
        assertBookingReferencesAvailable(
          database,
          { [field]: " 000-new/a " },
          {
            id: 41,
            [field]: "old",
          }
        )
      ).resolves.toEqual({ [field]: "000-NEW/A" });
      const matchSql =
        field === "ptsRef"
          ? "UPPER(`bookings`.`ptsRef`) REGEXP ?"
          : "UPPER(TRIM(`bookings`.`crmRef`)) = ?";
      const matchParameter =
        field === "ptsRef"
          ? "(^|,)[[:space:]]*000-NEW/A[[:space:]]*(,|$)"
          : "000-NEW/A";
      expect(queries).toEqual([
        expect.objectContaining({
          sql: `select \`id\` from \`bookings\` where (${matchSql} and \`bookings\`.\`id\` <> ?) order by \`bookings\`.\`id\` limit ?`,
          params: [matchParameter, 41, 1],
        }),
      ]);
      expectNoWrites(database);
    }
  );

  it("does not add a current-ID exclusion when creating a booking", async () => {
    const { database, queries } = offlineDatabase();
    await assertBookingReferencesAvailable(database, { ptsRef: " ab " });
    expect(queries[0]).toMatchObject({
      sql: "select `id` from `bookings` where UPPER(`bookings`.`ptsRef`) REGEXP ? order by `bookings`.`id` limit ?",
      params: ["(^|,)[[:space:]]*AB[[:space:]]*(,|$)", 1],
    });
  });
});

describe("withBookingReferenceLock", () => {
  it("uses the same connection for lock and transaction and unlocks only after commit", async () => {
    const setup = lockSetup();
    const enteredTransaction = deferred();
    const allowCommit = deferred();
    const result = withBookingReferenceLock(async database => {
      expect(database).toBe(setup.database);
      return database.transaction(async (tx: typeof setup.transaction) => {
        expect(tx.connection).toBe(setup.connection);
        await tx.insert();
        enteredTransaction.resolve();
        await allowCommit.promise;
        return "saved";
      });
    }, setup.dependencies);
    await enteredTransaction.promise;
    expect(setup.sequence).toEqual(["acquire", "begin", "write"]);
    expect(setup.connection.query).toHaveBeenCalledOnce();
    expect(setup.connection.release).not.toHaveBeenCalled();
    allowCommit.resolve();
    await expect(result).resolves.toBe("saved");
    expect(setup.dependencies.pool.getConnection).toHaveBeenCalledOnce();
    expect(setup.dependencies.makeDatabase).toHaveBeenCalledOnce();
    expect(setup.dependencies.makeDatabase).toHaveBeenCalledWith(
      setup.connection
    );
    expect(setup.sequence).toEqual([
      "acquire",
      "begin",
      "write",
      "commit",
      "unlock",
      "pool-release",
    ]);
    expect(setup.connection.destroy).not.toHaveBeenCalled();
  });

  it.each([0, null, "0"])(
    "fails closed when lock acquisition is not acknowledged (%j)",
    async acquired => {
      const setup = lockSetup(acquired);
      const work = vi.fn();
      await expect(
        withBookingReferenceLock(work, setup.dependencies)
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message:
          "Another booking reference is being saved. No changes have been saved; please try again shortly.",
      });
      expect(work).not.toHaveBeenCalled();
      expect(setup.dependencies.makeDatabase).not.toHaveBeenCalled();
      expect(setup.database.transaction).not.toHaveBeenCalled();
      expect(setup.sequence).toEqual(["acquire", "pool-release"]);
      expect(setup.connection.destroy).not.toHaveBeenCalled();
    }
  );

  it("does not fall back to unlocked work when GET_LOCK throws", async () => {
    const failure = new Error("lock transport failed");
    const setup = lockSetup(failure);
    const work = vi.fn();
    await expect(
      withBookingReferenceLock(work, setup.dependencies)
    ).rejects.toBe(failure);
    expect(work).not.toHaveBeenCalled();
    expect(setup.dependencies.makeDatabase).not.toHaveBeenCalled();
    expect(setup.sequence).toEqual(["acquire", "pool-release"]);
  });

  it("performs no work when a connection cannot be leased", async () => {
    const failure = new Error("pool unavailable");
    const work = vi.fn();
    const makeDatabase = vi.fn();
    await expect(
      withBookingReferenceLock(work, {
        pool: { getConnection: vi.fn().mockRejectedValue(failure) },
        makeDatabase,
      })
    ).rejects.toBe(failure);
    expect(work).not.toHaveBeenCalled();
    expect(makeDatabase).not.toHaveBeenCalled();
  });

  it("rolls back and releases the lock when the callback fails, preserving the original error", async () => {
    const setup = lockSetup();
    const failure = new Error("callback failed");
    await expect(
      withBookingReferenceLock(
        database =>
          database.transaction(async () => {
            throw failure;
          }),
        setup.dependencies
      )
    ).rejects.toBe(failure);
    expect(setup.sequence).toEqual([
      "acquire",
      "begin",
      "rollback",
      "unlock",
      "pool-release",
    ]);
    expect(setup.connection.destroy).not.toHaveBeenCalled();
  });

  it.each([0, null, new Error("release failed")])(
    "destroys rather than returns a connection after release failure (%j)",
    async released => {
      const setup = lockSetup(1, released);
      await expect(
        withBookingReferenceLock(
          database => database.transaction(async () => "committed"),
          setup.dependencies
        )
      ).resolves.toBe("committed");
      expect(setup.sequence).toEqual([
        "acquire",
        "begin",
        "commit",
        "unlock",
        "destroy",
      ]);
      expect(setup.connection.destroy).toHaveBeenCalledOnce();
      expect(setup.connection.release).not.toHaveBeenCalled();
    }
  );

  it("preserves a callback failure even when lock release also fails", async () => {
    const setup = lockSetup(1, new Error("unlock failed"));
    const failure = new Error("original callback failure");
    await expect(
      withBookingReferenceLock(async () => {
        throw failure;
      }, setup.dependencies)
    ).rejects.toBe(failure);
    expect(setup.connection.destroy).toHaveBeenCalledOnce();
    expect(setup.connection.release).not.toHaveBeenCalled();
    expect(setup.sequence).toEqual(["acquire", "unlock", "destroy"]);
  });

  it("releases an acquired lock if database construction fails", async () => {
    const setup = lockSetup();
    const failure = new Error("database construction failed");
    setup.dependencies.makeDatabase.mockImplementation(() => {
      throw failure;
    });
    const work = vi.fn();
    await expect(
      withBookingReferenceLock(work, setup.dependencies)
    ).rejects.toBe(failure);
    expect(work).not.toHaveBeenCalled();
    expect(setup.sequence).toEqual(["acquire", "unlock", "pool-release"]);
  });

  it("serialises concurrent saves so the second sees the first committed duplicate and cannot write", async () => {
    const sequence: string[] = [];
    const committed: Row[] = [];
    const firstStaged = deferred();
    const allowFirstCommit = deferred();
    const secondWaiting = deferred();
    let held = false;
    let wake: (() => void) | undefined;
    let connectionCount = 0;
    const databases: ReturnType<typeof offlineDatabase>[] = [];
    const pool = {
      getConnection: vi.fn(async () => {
        const id = ++connectionCount;
        return {
          id,
          query: vi.fn(async (query: string, params: unknown[]) => {
            expect(params[0]).toBe("jlt-booking-references");
            if (query.includes("GET_LOCK")) {
              if (held) {
                sequence.push(`${id}:wait`);
                await new Promise<void>(resolve => {
                  wake = resolve;
                  secondWaiting.resolve();
                });
              }
              held = true;
              sequence.push(`${id}:acquire`);
              return [[{ acquired: 1 }]];
            }
            expect(query).toBe("SELECT RELEASE_LOCK(?) AS released");
            sequence.push(`${id}:unlock`);
            held = false;
            wake?.();
            return [[{ released: 1 }]];
          }),
          release: vi.fn(),
          destroy: vi.fn(),
        };
      }),
    };
    const dependencies = {
      pool,
      makeDatabase: (connection: { id: number }) => {
        const recorded = offlineDatabase(query => {
          sequence.push(`${connection.id}:check`);
          expect(query.params[0]).toBe(
            "(^|,)[[:space:]]*000-RACE/A[[:space:]]*(,|$)"
          );
          return committed.filter(
            row =>
              normaliseBookingReference(row.ptsRef as string) === "000-RACE/A"
          );
        });
        databases.push(recorded);
        return {
          transaction: async (
            work: (tx: typeof recorded.database) => Promise<number>
          ) => {
            const staged: Row[] = [];
            recorded.database.insert.mockImplementation(() => ({
              values: async (row: Row) => {
                staged.push(row);
              },
            }));
            try {
              const result = await work(recorded.database);
              committed.push(...staged);
              sequence.push(`${connection.id}:commit`);
              return result;
            } catch (error) {
              sequence.push(`${connection.id}:rollback`);
              throw error;
            }
          },
        };
      },
    };
    const first = withBookingReferenceLock(
      database =>
        database.transaction(
          async (tx: ReturnType<typeof offlineDatabase>["database"]) => {
            const references = await assertBookingReferencesAvailable(tx, {
              ptsRef: " 000-race/a ",
            });
            await tx.insert(bookings).values({ id: 101, ...references });
            firstStaged.resolve();
            await allowFirstCommit.promise;
            return 101;
          }
        ),
      dependencies
    );
    await firstStaged.promise;
    const second = withBookingReferenceLock(
      database =>
        database.transaction(
          async (tx: ReturnType<typeof offlineDatabase>["database"]) => {
            const references = await assertBookingReferencesAvailable(tx, {
              ptsRef: "000-RACE/A",
            });
            await tx.insert(bookings).values({ id: 102, ...references });
            return 102;
          }
        ),
      dependencies
    );
    const secondRejected = expect(second).rejects.toMatchObject({
      code: "CONFLICT",
      conflictingBookingId: 101,
      reference: "000-RACE/A",
    });
    await secondWaiting.promise;
    expect(committed).toEqual([]);
    expect(sequence).not.toContain("2:check");
    allowFirstCommit.resolve();
    await expect(first).resolves.toBe(101);
    await secondRejected;
    expect(sequence).toEqual([
      "1:acquire",
      "1:check",
      "2:wait",
      "1:commit",
      "1:unlock",
      "2:acquire",
      "2:check",
      "2:rollback",
      "2:unlock",
    ]);
    expect(committed).toEqual([{ id: 101, ptsRef: "000-RACE/A" }]);
    expect(databases[0].database.insert).toHaveBeenCalledOnce();
    expectNoWrites(databases[1].database);
    expect(pool.getConnection).toHaveBeenCalledTimes(2);
  });
});

describe("findBookingByUniqueReference", () => {
  it.each(fields)(
    "fails closed for two historical %s matches, without applying writes",
    async field => {
      const { database, queries } = offlineDatabase(() => [
        otherBooking,
        { ...otherBooking, id: 42 },
      ]);
      const applyUpdate = vi.fn();
      const lookupThenUpdate = async () => {
        const booking = await findBookingByUniqueReference(
          database,
          field,
          " 00-abc "
        );
        applyUpdate(booking);
      };
      await expect(lookupThenUpdate()).rejects.toMatchObject({
        code: "CONFLICT",
        message: `${labels[field]} reference matches multiple bookings. Use the Portal booking ID and have staff correct the duplicate references; no update has been applied.`,
      });
      expect(applyUpdate).not.toHaveBeenCalled();
      expect(queries).toHaveLength(1);
      const matchSql =
        field === "ptsRef"
          ? "UPPER(`bookings`.`ptsRef`) REGEXP ?"
          : "UPPER(TRIM(`bookings`.`crmRef`)) = ?";
      expect(queries[0].sql).toContain(`where ${matchSql} limit ?`);
      expect(queries[0].params).toEqual([
        field === "ptsRef"
          ? "(^|,)[[:space:]]*00-ABC[[:space:]]*(,|$)"
          : "00-ABC",
        2,
      ]);
      expectNoWrites(database);
    }
  );

  it.each(fields)(
    "returns the only %s match unchanged and remains read-only",
    async field => {
      const { database } = offlineDatabase(() => [otherBooking]);
      await expect(
        findBookingByUniqueReference(database, field, "00-abc")
      ).resolves.toBe(otherBooking);
      expectNoWrites(database);
    }
  );

  it.each(fields)(
    "returns undefined when %s has no match and remains read-only",
    async field => {
      const { database } = offlineDatabase();
      await expect(
        findBookingByUniqueReference(database, field, "missing")
      ).resolves.toBeUndefined();
      expectNoWrites(database);
    }
  );
});
