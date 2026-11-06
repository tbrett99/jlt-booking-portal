import { createHash } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentCrmProfiles,
  agentSupplierLogins,
  systemSettings,
  users,
} from "../drizzle/schema";
import {
  DEFAULT_SUPPLIER_ACCESS_NAMES,
  SUPPLIER_ACCESS_NAME_MAX,
  buildSupplierAccessOptions,
  cleanSupplierAccessName,
  isValidSupplierAccessName,
  supplierAccessIdentity,
} from "../shared/supplier-access-catalog";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
// This factory must replace the DB module entirely: never import its live pool.
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import {
  SUPPLIER_ACCESS_SETTING_PREFIX,
  addSupplierAccessOption,
  getSupplierAccessCatalog,
  supplierAccessSettingKey,
} from "./supplier-access-catalog";

const DEFAULTS = [
  "Ace Rooms",
  "Ambassador Cruises",
  "Aviate",
  "Easyjet",
  "Etihad Holidays",
  "Every Holiday",
  "Gold Medal",
  "Holiday Best",
  "Koveli",
  "Major Travel",
  "MSC",
  "NCL",
  "P&O Cruises",
  "Royal Caribbean/Celebrity",
  "Virgin Voyages",
];
const NOW = "2026-11-06T10:20:30.456Z";
const UNAVAILABLE =
  "The supplier list is temporarily unavailable. Please retry; no agent access has been changed.";
const UNREADABLE =
  "The supplier list could not be read. Please contact support; existing agent access has not been changed.";
const PRIVATE_VALUE = "PRIVATE_DATABASE_VALUE_password=never-expose";
const dialect = new MySqlDialect();
type Setting = { key: string; value: string };
type DbOptions = {
  initial?: Setting[];
  readErrorAt?: number;
  writeError?: boolean;
  dropWrites?: boolean;
  replaceWrittenValue?: string;
  concurrentInitialReads?: number;
};

function setting(name: string, createdById = 17, createdAt = NOW): Setting {
  return {
    key: supplierAccessSettingKey(name),
    value: JSON.stringify({ version: 1, name, createdById, createdAt }),
  };
}

/** A keyed store, not a live-DB integration test. Drizzle predicates are compiled
 * locally and interpreted against fixtures; no SQL is executed. Conflict updates
 * apply the requested set literally, so overwriting audit values fails tests. */
function syntheticDb(options: DbOptions = {}) {
  const store = new Map(
    (options.initial ?? []).map(row => [row.key, row.value])
  );
  const reads: { sql: string; params: unknown[]; limit?: number }[] = [];
  const writes: { table: unknown; row: Setting; set: Partial<Setting> }[] = [];
  let initialReads = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const select = vi.fn((fields: Record<string, unknown>) => {
    let table: unknown;
    let condition: SQL | undefined;
    let maximum: number | undefined;
    const chain = {
      from: vi.fn((value: unknown) => {
        table = value;
        return chain;
      }),
      where: vi.fn((value: SQL) => {
        condition = value;
        return chain;
      }),
      limit: vi.fn((value: number) => {
        maximum = value;
        return chain;
      }),
      then: (
        resolve: (rows: Record<string, unknown>[]) => unknown,
        reject: (error: unknown) => unknown
      ) => {
        const execute = async () => {
          expect(table).toBe(systemSettings);
          expect(condition).toBeDefined();
          expect(
            Object.keys(fields).every(key => key === "key" || key === "value")
          ).toBe(true);
          const compiled = dialect.sqlToQuery(condition!);
          reads.push({ ...compiled, limit: maximum });
          if (options.readErrorAt === reads.length)
            throw new Error(PRIVATE_VALUE);
          expect(compiled.params).toHaveLength(1);
          const requestedKey = String(compiled.params[0]);
          const isPrefix = /\blike\b/i.test(compiled.sql);
          if (isPrefix)
            expect(requestedKey).toBe(`${SUPPLIER_ACCESS_SETTING_PREFIX}%`);
          else {
            expect(compiled.sql).toContain(" = ");
            expect(maximum).toBe(1);
          }
          let rows = Array.from(store, ([key, value]) => ({
            key,
            value,
          })).filter(row =>
            isPrefix
              ? row.key.startsWith(requestedKey.slice(0, -1))
              : row.key === requestedKey
          );
          if (maximum !== undefined) rows = rows.slice(0, maximum);
          // Capture both pre-insert snapshots, then release them together. This
          // deterministically forces the conflict path rather than sequential adds.
          if (
            !isPrefix &&
            options.concurrentInitialReads &&
            initialReads < options.concurrentInitialReads
          ) {
            initialReads += 1;
            if (initialReads === options.concurrentInitialReads) release();
            await gate;
          }
          return rows.map(row =>
            Object.fromEntries(
              Object.keys(fields).map(key => [key, row[key as keyof Setting]])
            )
          );
        };
        return execute().then(resolve, reject);
      },
    };
    return chain;
  });
  const insert = vi.fn((table: unknown) => ({
    values: (row: Setting) => ({
      onDuplicateKeyUpdate: async ({ set }: { set: Partial<Setting> }) => {
        expect(table).toBe(systemSettings);
        writes.push({ table, row: { ...row }, set: { ...set } });
        if (options.writeError) throw new Error(PRIVATE_VALUE);
        if (options.dropWrites) return;
        if (store.has(row.key)) {
          const existing = { key: row.key, value: store.get(row.key)!, ...set };
          store.delete(row.key);
          store.set(existing.key, existing.value);
        } else store.set(row.key, options.replaceWrittenValue ?? row.value);
      },
    }),
  }));
  const update = vi.fn(() => {
    throw new Error("Unexpected update outside catalog settings");
  });
  const deleteRows = vi.fn(() => {
    throw new Error("Unexpected deletion outside catalog settings");
  });
  return { store, reads, writes, select, insert, update, delete: deleteRows };
}

async function expectSafeFailure(
  operation: Promise<unknown>,
  message = UNAVAILABLE
) {
  const error = await operation.then(
    () => {
      throw new Error("Expected the operation to fail, not report success");
    },
    error => error
  );
  expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message });
  expect(error.cause).toBeUndefined();
  expect(String(error)).not.toContain(PRIVATE_VALUE);
  expect(JSON.stringify(error)).not.toContain(PRIVATE_VALUE);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDb.mockImplementation(() => {
    throw new Error("Install a synthetic DB explicitly");
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("shared supplier access catalog", () => {
  it("retains exactly the 15 established default spellings", () => {
    expect(DEFAULT_SUPPLIER_ACCESS_NAMES).toEqual(DEFAULTS);
    const options = buildSupplierAccessOptions([]);
    expect(options).toHaveLength(15);
    expect(options.map(option => option.name)).toEqual(DEFAULTS);
    expect(options.map(option => option.identity)).toEqual(
      DEFAULTS.map(supplierAccessIdentity)
    );
  });

  it("sorts defaults and global custom names together without mutating callers", () => {
    const custom = Object.freeze([
      "Zulu Travel",
      "alpha holidays",
      "Beacon Tours",
    ]);
    const result = buildSupplierAccessOptions(custom);
    expect(result.map(option => option.name)).toEqual(
      [...DEFAULTS, ...custom].sort((a, b) =>
        a.localeCompare(b, "en", { sensitivity: "base" })
      )
    );
    expect(custom).toEqual(["Zulu Travel", "alpha holidays", "Beacon Tours"]);
  });

  it("collapses normalized duplicates, with defaults before custom before recorded names", () => {
    const options = buildSupplierAccessOptions(
      [
        "  ace   rooms  ",
        "Ａｔｌａｓ　Ｔｒａｖｅｌ",
        "atlas travel",
        " Atlas\u00a0 Travel ",
      ],
      [
        "ATLAS TRAVEL",
        " ACE ROOMS ",
        "  Legacy  Tours ",
        "legacy tours",
        "",
        "   ",
      ]
    );
    expect(options).toHaveLength(17);
    expect(options.find(option => option.identity === "ace rooms")?.name).toBe(
      "Ace Rooms"
    );
    expect(
      options.find(option => option.identity === "atlas travel")?.name
    ).toBe("Ａｔｌａｓ Ｔｒａｖｅｌ");
    expect(
      options.find(option => option.identity === "legacy tours")?.name
    ).toBe("Legacy Tours");
    expect(new Set(options.map(option => option.identity)).size).toBe(
      options.length
    );
  });

  it("displays THIS agent's legacy supplier without publishing or leaking it to another agent", () => {
    const global = Object.freeze(["Global Travel"]);
    const agentA = Object.freeze([" Agent A  Legacy "]);
    const agentB = Object.freeze(["Agent B Legacy"]);
    const names = (recorded?: readonly string[]) =>
      buildSupplierAccessOptions(global, recorded).map(option => option.name);
    expect(names(agentA)).toContain("Agent A Legacy");
    expect(names(agentA)).not.toContain("Agent B Legacy");
    expect(names(agentB)).toContain("Agent B Legacy");
    expect(names(agentB)).not.toContain("Agent A Legacy");
    expect(names()).not.toContain("Agent A Legacy");
    expect(names()).not.toContain("Agent B Legacy");
    expect(global).toEqual(["Global Travel"]);
    expect(agentA).toEqual([" Agent A  Legacy "]);
  });

  it.each([
    ["  Atlas\u00a0  Travel  ", "atlas travel"],
    ["ＡＴＬＡＳ　ＴＲＡＶＥＬ", "atlas travel"],
    ["Cafe\u0301 Tours", "café tours"],
    ["CAFÉ TOURS", "café tours"],
  ])("normalizes whitespace, NFKC and case for %s", (input, identity) => {
    expect(supplierAccessIdentity(input)).toBe(identity);
  });

  it("cleans display whitespace without rewriting the display name to lowercase or NFKC", () => {
    expect(cleanSupplierAccessName("  Ａｔｌａｓ\u00a0 Travel  ")).toBe(
      "Ａｔｌａｓ Travel"
    );
  });

  it("enforces the cleaned 120-character boundary", () => {
    expect(SUPPLIER_ACCESS_NAME_MAX).toBe(120);
    expect(isValidSupplierAccessName("a".repeat(120))).toBe(true);
    expect(isValidSupplierAccessName(`  ${"a".repeat(120)}  `)).toBe(true);
    expect(isValidSupplierAccessName("a".repeat(121))).toBe(false);
    expect(isValidSupplierAccessName("")).toBe(false);
    expect(isValidSupplierAccessName(" \u00a0 ")).toBe(false);
  });

  it.each([
    ...Array.from({ length: 32 }, (_, i) => i),
    ...Array.from({ length: 33 }, (_, i) => i + 127),
  ])(
    "rejects original control character U+%i before whitespace cleanup",
    code => {
      expect(
        isValidSupplierAccessName(`Atlas${String.fromCharCode(code)}Travel`)
      ).toBe(false);
    }
  );
});

describe("supplier catalog setting keys", () => {
  it("uses SHA-256 of normalized identity and keeps even maximum-length names below the schema key limit", () => {
    const key = supplierAccessSettingKey("  ＡＴＬＡＳ　Travel ");
    expect(key).toBe(
      SUPPLIER_ACCESS_SETTING_PREFIX +
        createHash("sha256").update("atlas travel").digest("hex")
    );
    expect(key).toBe(supplierAccessSettingKey("Atlas Travel"));
    expect(key).not.toBe(supplierAccessSettingKey("Atlas Tours"));
    expect(supplierAccessSettingKey("a".repeat(120)).length).toBeLessThan(100);
    expect(key).not.toContain("Atlas");
  });
});

describe("supplier access catalog service with keyed synthetic storage", () => {
  it("reads an empty custom catalog without writing defaults", async () => {
    const db = syntheticDb();
    mocks.getDb.mockResolvedValue(db);
    await expect(getSupplierAccessCatalog()).resolves.toEqual({ names: [] });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.reads[0].params).toEqual([`${SUPPLIER_ACCESS_SETTING_PREFIX}%`]);
  });

  it.each(DEFAULTS)(
    "recognizes built-in %s, including normalized spelling, without DB reads or writes",
    async name => {
      await expect(
        addSupplierAccessOption(
          `  ${name.toUpperCase().replaceAll(" ", "  ")}  `,
          18
        )
      ).resolves.toEqual({ name, alreadyExists: true });
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );

  it("recognizes NFKC builtin duplicates without rewriting defaults", async () => {
    await expect(
      addSupplierAccessOption("ＡＣＥ　ＲＯＯＭＳ", 18)
    ).resolves.toEqual({ name: "Ace Rooms", alreadyExists: true });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(DEFAULT_SUPPLIER_ACCESS_NAMES).toEqual(DEFAULTS);
  });

  it("persists cleaned name, actor and UTC audit; a fresh read sees it, with unrelated tables untouched", async () => {
    const db = syntheticDb({
      initial: [{ key: "unrelated-system-setting", value: PRIVATE_VALUE }],
    });
    mocks.getDb.mockResolvedValue(db);
    await expect(
      addSupplierAccessOption("  Atlas\u00a0  Travel  ", 9000)
    ).resolves.toEqual({ name: "Atlas Travel", alreadyExists: false });
    const key = supplierAccessSettingKey("Atlas Travel");
    expect(JSON.parse(db.store.get(key)!)).toEqual({
      version: 1,
      name: "Atlas Travel",
      createdById: 9000,
      createdAt: NOW,
    });
    expect(db.writes).toEqual([
      {
        table: systemSettings,
        row: { key, value: db.store.get(key)! },
        set: { key },
      },
    ]);
    expect(db.writes[0].set).not.toHaveProperty("value");
    expect(key.length).toBeLessThan(100);
    expect(db.reads).toHaveLength(2);
    expect(db.reads.map(read => read.params)).toEqual([[key], [key]]);
    expect(db.reads.every(read => read.limit === 1)).toBe(true);
    // Recreate the adapter from persisted rows: no process-local cache can make
    // this test pass when the insert never stored anything.
    const fresh = syntheticDb({
      initial: Array.from(db.store, ([key, value]) => ({ key, value })),
    });
    mocks.getDb.mockResolvedValue(fresh);
    await expect(getSupplierAccessCatalog()).resolves.toEqual({
      names: ["Atlas Travel"],
    });
    expect(db.store.get("unrelated-system-setting")).toBe(PRIVATE_VALUE);
    expect(fresh.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    for (const table of [agentSupplierLogins, agentCrmProfiles, users]) {
      expect(db.insert).not.toHaveBeenCalledWith(table);
      expect(db.update).not.toHaveBeenCalledWith(table);
      expect(db.delete).not.toHaveBeenCalledWith(table);
    }
  });

  it("returns all globally saved custom names sorted, excluding unrelated settings and all agent legacy data", async () => {
    const db = syntheticDb({
      initial: [
        setting("Zulu Tours", 3),
        setting("alpha Travel", 2),
        setting("Beacon Tours", 1),
        { key: "other", value: "not JSON" },
      ],
    });
    mocks.getDb.mockResolvedValue(db);
    await expect(getSupplierAccessCatalog()).resolves.toEqual({
      names: ["alpha Travel", "Beacon Tours", "Zulu Tours"],
    });
    expect(db.select).toHaveBeenCalledWith({
      key: systemSettings.key,
      value: systemSettings.value,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("case/NFKC/whitespace duplicate preserves first creator, timestamp and spelling byte for byte", async () => {
    const original = setting("Atlas Travel", 21, "2025-04-02T01:02:03.004Z");
    const db = syntheticDb({ initial: [original] });
    mocks.getDb.mockResolvedValue(db);
    for (const name of [
      "atlas travel",
      "  ATLAS  TRAVEL ",
      "ＡＴＬＡＳ　ＴＲＡＶＥＬ",
    ]) {
      await expect(addSupplierAccessOption(name, 999)).resolves.toEqual({
        name: "Atlas Travel",
        alreadyExists: true,
      });
    }
    expect(db.store.get(original.key)).toBe(original.value);
    expect(db.store.size).toBe(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("concurrent same-key adds are idempotent and preserve the winner's original audit", async () => {
    const db = syntheticDb({ concurrentInitialReads: 2 });
    mocks.getDb.mockResolvedValue(db);
    const result = await Promise.all([
      addSupplierAccessOption("Atlas Travel", 11),
      addSupplierAccessOption("ＡＴＬＡＳ　ＴＲＡＶＥＬ", 22),
    ]);
    expect(db.writes).toHaveLength(2);
    expect(db.store.size).toBe(1);
    const winner = JSON.parse(db.writes[0].row.value);
    expect(
      JSON.parse(db.store.get(supplierAccessSettingKey("Atlas Travel"))!)
    ).toEqual(winner);
    expect(result.map(item => item.name)).toEqual([winner.name, winner.name]);
    expect(result.map(item => item.alreadyExists).sort()).toEqual([
      false,
      true,
    ]);
    expect(
      db.writes.every(write => Object.keys(write.set).join() === "key")
    ).toBe(true);
    await expect(getSupplierAccessCatalog()).resolves.toEqual({
      names: [winner.name],
    });
  });

  it("concurrent different-key adds retain every entry instead of replacing a shared array", async () => {
    const db = syntheticDb({ concurrentInitialReads: 3 });
    mocks.getDb.mockResolvedValue(db);
    const result = await Promise.all([
      addSupplierAccessOption("Zulu Tours", 1),
      addSupplierAccessOption("Alpha Tours", 2),
      addSupplierAccessOption("Beacon Tours", 3),
    ]);
    expect(result.every(item => item.alreadyExists === false)).toBe(true);
    expect(db.store.size).toBe(3);
    expect(new Set(db.writes.map(write => write.row.key)).size).toBe(3);
    await expect(getSupplierAccessCatalog()).resolves.toEqual({
      names: ["Alpha Tours", "Beacon Tours", "Zulu Tours"],
    });
    expect(
      Array.from(
        db.store.values(),
        value => JSON.parse(value).createdById
      ).sort()
    ).toEqual([1, 2, 3]);
  });

  it.each([
    "",
    "   ",
    "\u00a0",
    "Atlas\nTravel",
    "Atlas\tTravel",
    "Atlas\u0000Travel",
    "Atlas\u007fTravel",
    "Atlas\u0085Travel",
    "a".repeat(121),
  ])(
    "rejects blank, controls or overly long input before obtaining the DB: %j",
    async name => {
      await expect(addSupplierAccessOption(name, 1)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );

  it("accepts a 120-character name with surrounding whitespace and a hash key below 100", async () => {
    const db = syntheticDb();
    mocks.getDb.mockResolvedValue(db);
    await expect(
      addSupplierAccessOption(` ${"a".repeat(120)} `, 1)
    ).resolves.toEqual({ name: "a".repeat(120), alreadyExists: false });
    expect(db.writes[0].row.key.length).toBeLessThan(100);
  });

  it.each([null, undefined])(
    "fails closed for missing DB %j in both read and add",
    async db => {
      mocks.getDb.mockResolvedValue(db);
      await expectSafeFailure(getSupplierAccessCatalog());
      await expectSafeFailure(addSupplierAccessOption("Atlas Travel", 1));
    }
  );

  it("sanitizes a thrown DB acquisition error in read and add", async () => {
    mocks.getDb.mockRejectedValue(new Error(PRIVATE_VALUE));
    await expectSafeFailure(getSupplierAccessCatalog());
    await expectSafeFailure(addSupplierAccessOption("Atlas Travel", 1));
  });

  it.each([
    { phase: "catalog read", options: { readErrorAt: 1 }, catalog: true },
    { phase: "duplicate lookup", options: { readErrorAt: 1 }, catalog: false },
    { phase: "insert", options: { writeError: true }, catalog: false },
    { phase: "readback", options: { readErrorAt: 2 }, catalog: false },
  ])(
    "sanitizes thrown DB messages during $phase",
    async ({ options, catalog }) => {
      const db = syntheticDb(options);
      mocks.getDb.mockResolvedValue(db);
      await expectSafeFailure(
        catalog
          ? getSupplierAccessCatalog()
          : addSupplierAccessOption("Atlas Travel", 1)
      );
      expect(db.update).not.toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
    }
  );

  const corrupted = [
    { reason: "bad JSON", value: `${PRIVATE_VALUE}{` },
    { reason: "null JSON", value: "null" },
    {
      reason: "wrong version",
      value: JSON.stringify({
        version: 2,
        name: "Atlas Travel",
        private: PRIVATE_VALUE,
      }),
    },
    {
      reason: "non-string name",
      value: JSON.stringify({ version: 1, name: 123, private: PRIVATE_VALUE }),
    },
    {
      reason: "blank name",
      value: JSON.stringify({ version: 1, name: " ", private: PRIVATE_VALUE }),
    },
    {
      reason: "control in name",
      value: JSON.stringify({
        version: 1,
        name: "Atlas\nTravel",
        private: PRIVATE_VALUE,
      }),
    },
    {
      reason: "overlong name",
      value: JSON.stringify({
        version: 1,
        name: "a".repeat(121),
        private: PRIVATE_VALUE,
      }),
    },
    {
      reason: "key/name mismatch",
      value: JSON.stringify({
        version: 1,
        name: "Another Supplier",
        private: PRIVATE_VALUE,
      }),
    },
  ];
  it.each(corrupted)(
    "fails closed on $reason in catalog read and duplicate lookup without exposing stored value",
    async ({ value }) => {
      const key = supplierAccessSettingKey("Atlas Travel");
      const db = syntheticDb({ initial: [{ key, value }] });
      mocks.getDb.mockResolvedValue(db);
      await expectSafeFailure(getSupplierAccessCatalog(), UNREADABLE);
      await expectSafeFailure(
        addSupplierAccessOption("Atlas Travel", 1),
        UNREADABLE
      );
      expect(db.store.get(key)).toBe(value);
      expect(db.insert).not.toHaveBeenCalled();
    }
  );

  it("requires readback and cannot report success when the insert stores no row", async () => {
    const db = syntheticDb({ dropWrites: true });
    mocks.getDb.mockResolvedValue(db);
    await expectSafeFailure(addSupplierAccessOption("Atlas Travel", 1));
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.reads).toHaveLength(2);
    expect(db.store.size).toBe(0);
  });

  it("validates persisted readback instead of trusting an insert acknowledgement", async () => {
    const db = syntheticDb({
      replaceWrittenValue: JSON.stringify({
        version: 1,
        name: "Wrong Supplier",
        private: PRIVATE_VALUE,
      }),
    });
    mocks.getDb.mockResolvedValue(db);
    await expectSafeFailure(
      addSupplierAccessOption("Atlas Travel", 1),
      UNREADABLE
    );
    expect(db.reads).toHaveLength(2);
    expect(db.writes).toHaveLength(1);
  });
});
