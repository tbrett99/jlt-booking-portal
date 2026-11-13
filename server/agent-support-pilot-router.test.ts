import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import type {
  SupportAnswerEnvelope,
  SupportCitation,
  SupportTurnResult,
} from "../shared/agent-support-pilot";
import {
  agentSupportRouter,
  loadAdminPilotSupportSources,
} from "./agent-support-router";
import { SUPPORT_PRIVACY_MESSAGE } from "./agent-support-privacy";

const guards = vi.hoisted(() => ({
  getDb: vi.fn(),
  generate: vi.fn(),
  llm: vi.fn(),
  sources: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: guards.getDb }));
vi.mock("./agent-support-generation", () => ({
  generateSupportTurn: guards.generate,
  assistantSystemPrompt: vi.fn(() => "Mock-only prompt"),
}));
vi.mock("./_core/llm", () => ({ invokeLLM: guards.llm }));
vi.mock("./agent-support-sources", async importOriginal => ({
  ...(await importOriginal<typeof import("./agent-support-sources")>()),
  loadAdminPilotSupportSources: guards.sources,
}));
const realSources = await vi.importActual<
  typeof import("./agent-support-sources")
>("./agent-support-sources");
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");

const NOW = new Date("2026-11-13T12:00:00.000Z");
const OLD = new Date("2026-10-10T12:00:00.000Z");
const FUTURE = new Date("2026-12-10T12:00:00.000Z");
const ACTOR = 123;
const OMISSION =
  "[Private details omitted. Please ask a general process question.]";
const LABELLED_IDENTIFIERS = [
  "booking reference: ABCD-123",
  "client id: CUST-A12",
  "claim reference: CLM-AB12",
] as const;
const SOURCE_TABLES = [
  "knowledge_base_articles",
  "webinar_library_items",
  "suppliers",
  "community_posts",
  "academy_lessons",
];
const citation = (index = 1, key = "kb:7"): SupportCitation => ({
  index,
  key,
  kind: "knowledge_base",
  title: "Generic cancellation procedure",
  href: "/knowledge-base?article=7",
  label: "Knowledge Base: Generic cancellation procedure",
  timestampLabel: null,
  updatedAt: OLD,
});
const envelope = (
  overrides: Partial<SupportAnswerEnvelope> = {}
): SupportAnswerEnvelope => ({
  version: 2,
  sources: [citation()],
  disposition: "answered",
  verified: true,
  inputScreened: true,
  modelCalls: 1,
  latencyMs: 25,
  ...overrides,
});
const generated = (
  overrides: Partial<SupportTurnResult> = {}
): SupportTurnResult => ({
  answer: "Read the generic cancellation procedure [S1].",
  sources: [citation()],
  disposition: "answered",
  verified: true,
  status: "answered",
  unresolvedReason: null,
  model: "mock-only",
  promptTokens: 10,
  completionTokens: 12,
  modelCalls: 1,
  latencyMs: 25,
  ...overrides,
});
function context(role: string | null = "admin", id = ACTOR): TrpcContext {
  return {
    user: role
      ? ({
          id,
          role,
          openId: `offline-${id}`,
          name: "Synthetic staff",
          email: "staff@example.test",
          createdAt: OLD,
          updatedAt: OLD,
          lastSignedIn: OLD,
        } as NonNullable<TrpcContext["user"]>)
      : null,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
const caller = (role: string | null = "admin", id = ACTOR) =>
  agentSupportRouter.createCaller(context(role, id));
const timestamp = (value: Date) =>
  value.toISOString().replace("T", " ").replace("Z", "");
type Trace = { sql: string; params: unknown[]; transaction: number };

/**
 * Offline full-stub adapter: production MySQL Drizzle query compilation and row
 * decoding, executed only against an ephemeral SQLite :memory: fixture. No
 * mysql2 pool, application getDb, network, model or persistent database is used.
 * Minimal dialect adaptation handles DEFAULT, upsert and FOR UPDATE syntax;
 * predicates/projections/joins are executed rather than silently ignored.
 */
function offlineDatabase() {
  const memory = new DatabaseSync(":memory:");
  memory.function("JSON_UNQUOTE", (value: any) => value);
  const tables = [
    schema.agentSupportConversations,
    schema.agentSupportMessages,
    schema.agentSupportFeedback,
    schema.knowledgeBaseArticles,
    schema.webinarLibraryItems,
    schema.suppliers,
    schema.communityPosts,
    schema.users,
    schema.academyLessons,
    schema.academyModules,
    schema.academyCourses,
  ];
  const configs = new Map(
    tables.map(table => [getTableName(table), getTableConfig(table)])
  );
  for (const [name, config] of configs) {
    const fields = config.columns.map(
      column =>
        `\`${column.name}\` ${column.primary && column.autoIncrement ? "INTEGER PRIMARY KEY AUTOINCREMENT" : column.dataType === "number" || column.dataType === "boolean" ? "NUMERIC" : "TEXT"}`
    );
    if (name === "agent_support_feedback")
      fields.push("UNIQUE (`messageId`, `userId`)");
    memory.exec(`CREATE TABLE \`${name}\` (${fields.join(", ")})`);
  }
  const trace: Trace[] = [];
  let activeTransaction = 0;
  let transactionSequence = 0;
  let failure: ((sql: string) => boolean) | null = null;
  let beforeQuery: ((sql: string) => void) | null = null;
  const defaultLiteral = (table: string, name: string) => {
    const column = configs
      .get(table)
      ?.columns.find(candidate => candidate.name === name);
    if (name === "createdAt" || name === "updatedAt" || name === "startedAt")
      return `'${timestamp(NOW)}'`;
    if (typeof column?.default === "string")
      return `'${column.default.replace(/'/g, "''")}'`;
    if (typeof column?.default === "number") return String(column.default);
    if (typeof column?.default === "boolean") return column.default ? "1" : "0";
    return "null";
  };
  const adapt = (sql: string) => {
    let adapted = sql.replace(/\s+for update\b/gi, "");
    const insert = adapted.match(
      /^insert into `([^`]+)` \(([^)]+)\) values (.*?)(?= on duplicate key update|$)/i
    );
    if (insert) {
      const columns = insert[2]
        .split(",")
        .map(value => value.trim().replace(/`/g, ""));
      const values = insert[3].replace(
        /\(([^()]*)\)/g,
        (_tuple, inside: string) =>
          `(${inside
            .split(",")
            .map((part, index) =>
              part.trim().toLowerCase() === "default"
                ? defaultLiteral(insert[1], columns[index])
                : part
            )
            .join(", ")})`
      );
      adapted = adapted.replace(
        insert[0],
        `insert into \`${insert[1]}\` (${insert[2]}) values ${values}`
      );
    }
    return adapted.replace(
      /on duplicate key update/i,
      "on conflict (`messageId`, `userId`) do update set"
    );
  };
  const db = drizzle(async (sql, params, method) => {
    trace.push({ sql, params: [...params], transaction: activeTransaction });
    if (failure?.(sql))
      throw new Error(
        "synthetic raw database failure: password=DATABASE_PRIVATE_SENTINEL provider@example.test"
      );
    beforeQuery?.(sql);
    const statement = memory.prepare(adapt(sql));
    const bindings = params.map(value =>
      value instanceof Date
        ? timestamp(value)
        : typeof value === "boolean"
          ? Number(value)
          : value
    ) as any[];
    if (method === "all") {
      statement.setReturnArrays(true);
      // mysql2 parses JSON before Drizzle receives it; MySqlJson deliberately
      // has no mapFromDriverValue JSON parser. Preserve that driver contract.
      const columns = statement.columns();
      const decoded = (statement.all(...bindings) as unknown[][]).map(row =>
        row.map((value, index) => {
          const field = columns[index];
          const isJson = configs
            .get(field.table ?? "")
            ?.columns.some(
              column =>
                column.name === field.column && column.dataType === "json"
            );
          return isJson && typeof value === "string"
            ? JSON.parse(value)
            : value;
        })
      );
      return { rows: decoded };
    }
    const result = statement.run(...bindings);
    return {
      rows: [
        {
          insertId: Number(result.lastInsertRowid),
          affectedRows: Number(result.changes),
        },
      ],
    };
  });
  const transaction = vi.fn(
    async (work: (tx: typeof db) => Promise<unknown>) => {
      if (activeTransaction)
        throw new Error("Unexpected nested fixture transaction");
      activeTransaction = ++transactionSequence;
      memory.exec("BEGIN");
      try {
        const result = await work(db);
        memory.exec("COMMIT");
        return result;
      } catch (error) {
        memory.exec("ROLLBACK");
        throw error;
      } finally {
        activeTransaction = 0;
      }
    }
  );
  Object.assign(db, { transaction });
  const seed = (table: string, row: Record<string, unknown>) => {
    const fields = Object.keys(row);
    const values = Object.values(row).map(value =>
      value instanceof Date
        ? timestamp(value)
        : typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : value
    ) as any[];
    memory
      .prepare(
        `INSERT INTO \`${table}\` (${fields.map(field => `\`${field}\``).join(",")}) VALUES (${fields.map(() => "?").join(",")})`
      )
      .run(...values);
  };
  const rows = (table: string) =>
    memory.prepare(`SELECT * FROM \`${table}\` ORDER BY id`).all() as Record<
      string,
      any
    >[];
  return {
    db,
    trace,
    transaction,
    seed,
    rows,
    close: () => memory.close(),
    fail: (predicate: (sql: string) => boolean) => {
      failure = predicate;
    },
    beforeQuery: (callback: (sql: string) => void) => {
      beforeQuery = callback;
    },
    mutate: (sql: string, ...params: any[]) =>
      memory.prepare(sql).run(...params),
  };
}
type Fixture = ReturnType<typeof offlineDatabase>;
let fixture: Fixture;
let errorLog: ReturnType<typeof vi.spyOn>;
let warningLog: ReturnType<typeof vi.spyOn>;
const writes = () =>
  fixture.trace.filter(query => /^(insert|update|delete)\b/i.test(query.sql));
const sourceQueries = () =>
  fixture.trace.filter(query =>
    SOURCE_TABLES.some(table => query.sql.includes(`from \`${table}\``))
  );
const messageContentQueries = () =>
  fixture.trace.filter(
    query =>
      /^select/i.test(query.sql) &&
      query.sql.includes("`content`") &&
      query.sql.includes("agent_support_messages")
  );
const conversation = (overrides: Record<string, unknown> = {}) => {
  const row = {
    id: 10,
    userId: ACTOR,
    pilotScope: "admin_only",
    startedAt: OLD,
    updatedAt: OLD,
    expiresAt: FUTURE,
    ...overrides,
  };
  fixture.seed("agent_support_conversations", row);
  return row;
};
const message = (overrides: Record<string, unknown> = {}) => {
  const row = {
    id: 100,
    conversationId: 10,
    role: "assistant",
    content: "Read the generic procedure [S1].",
    responseStatus: "answered",
    sourceRefs: envelope(),
    createdAt: OLD,
    contextSourceCount: 1,
    ...overrides,
  };
  fixture.seed("agent_support_messages", row);
  return row;
};
function assertNoPrivateFailure(value: unknown) {
  const serialize = (item: unknown) =>
    JSON.stringify(item, (_key, nested) =>
      nested instanceof Error
        ? Object.fromEntries(
            Object.getOwnPropertyNames(nested).map(key => [
              key,
              (nested as unknown as Record<string, unknown>)[key],
            ])
          )
        : nested
    );
  const serialized = serialize(value);
  expect(serialized).not.toContain("DATABASE_PRIVATE_SENTINEL");
  expect(serialized).not.toContain("provider@example.test");
  expect(
    serialize([...errorLog.mock.calls, ...warningLog.mock.calls])
  ).not.toContain("DATABASE_PRIVATE_SENTINEL");
  expect(
    serialize([...errorLog.mock.calls, ...warningLog.mock.calls])
  ).not.toContain("provider@example.test");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fixture = offlineDatabase();
  guards.getDb.mockResolvedValue(fixture.db);
  guards.generate.mockResolvedValue(generated());
  guards.sources.mockImplementation(realSources.loadAdminPilotSupportSources);
  guards.llm.mockImplementation(() => {
    throw new Error("Real model access forbidden");
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden");
    })
  );
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warningLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  expect(guards.llm).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  fixture.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FIRST admin pilot — authorization before any database or model access", () => {
  const operations = [
    ["overview", undefined],
    ["conversations", undefined],
    ["conversation", { conversationId: 10 }],
    ["ask", { question: "How do I cancel a booking?" }],
    ["feedback", { messageId: 100, rating: "helpful" }],
    ["recentGaps", undefined],
  ] as const;
  it.each([null, "agent", "instructor", "academy_instructor", "staff"])(
    "blocks role %s at every pilot operation",
    async role => {
      for (const [name, input] of operations)
        await expect(
          (caller(role)[name] as (value: unknown) => Promise<unknown>)(input)
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(guards.getDb).not.toHaveBeenCalled();
      expect(guards.generate).not.toHaveBeenCalled();
      expect(fixture.trace).toEqual([]);
    }
  );
  it.each(["admin", "super_admin"])(
    "allows %s but returns only their unexpired admin-scope conversation summaries",
    async role => {
      conversation();
      conversation({ id: 11, userId: 999 });
      conversation({ id: 12, expiresAt: OLD });
      conversation({ id: 13, pilotScope: "agent" });
      const result = await caller(role).conversations();
      expect(result).toEqual([{ id: 10, startedAt: OLD, updatedAt: OLD }]);
      expect(Object.keys(result[0]).sort()).toEqual([
        "id",
        "startedAt",
        "updatedAt",
      ]);
      expect(messageContentQueries()).toEqual([]);
      expect(guards.generate).not.toHaveBeenCalled();
    }
  );
});

describe("conversation ownership and hard retention boundaries", () => {
  it.each(["ownership", "expiry"])(
    "rechecks %s before returning already-loaded conversation contents",
    async boundary => {
      conversation({ expiresAt: new Date(NOW.getTime() + 1_000) });
      message();
      fixture.beforeQuery(sql => {
        if (
          !sql.startsWith("select") ||
          !sql.includes("from `agent_support_messages`") ||
          !sql.includes("`content`")
        )
          return;
        if (boundary === "ownership")
          fixture.mutate(
            "UPDATE agent_support_conversations SET userId = ? WHERE id = ?",
            999,
            10
          );
        else vi.setSystemTime(new Date(NOW.getTime() + 2_000));
      });
      await expect(
        caller().conversation({ conversationId: 10 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(messageContentQueries()).toHaveLength(1);
      expect(writes()).toEqual([]);
    }
  );

  it.each(["foreign", "expired", "at-boundary", "agent-scope", "absent"])(
    "denies %s read and ask before message content or writes",
    async kind => {
      if (kind !== "absent")
        conversation(
          kind === "foreign"
            ? { userId: 999 }
            : kind === "agent-scope"
              ? { pilotScope: "agent" }
              : { expiresAt: kind === "at-boundary" ? NOW : OLD }
        );
      message({
        content: "PRIVATE_HISTORY_SENTINEL synthetic.client@example.test",
      });
      await expect(
        caller().conversation({ conversationId: 10 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller().ask({
          conversationId: 10,
          question: "How do I cancel a booking?",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(messageContentQueries()).toEqual([]);
      expect(writes().filter(query => !/^delete/i.test(query.sql))).toEqual([]);
      expect(guards.generate).not.toHaveBeenCalled();
      expect(sourceQueries()).toEqual([]);
    }
  );

  it.each(["foreign", "expired", "at-boundary", "agent-scope", "user-message"])(
    "denies feedback for %s answers without content access or feedback writes",
    async kind => {
      conversation(
        kind === "foreign"
          ? { userId: 999 }
          : kind === "expired"
            ? { expiresAt: OLD }
            : kind === "at-boundary"
              ? { expiresAt: NOW }
              : kind === "agent-scope"
                ? { pilotScope: "agent" }
                : {}
      );
      message({ role: kind === "user-message" ? "user" : "assistant" });
      await expect(
        caller().feedback({ messageId: 100, rating: "helpful" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(messageContentQueries()).toEqual([]);
      expect(
        writes().filter(query => /agent_support_feedback/i.test(query.sql))
      ).toEqual([]);
    }
  );

  it("requires owner and expiry filtering before a valid conversation message query", async () => {
    conversation();
    message();
    const result = await caller().conversation({ conversationId: 10 });
    expect(result).toMatchObject({
      id: 10,
      messages: [
        expect.objectContaining({
          id: 100,
          content: "Read the generic procedure [S1].",
          verified: true,
        }),
      ],
    });
    const ownerIndex = fixture.trace.findIndex(
      query =>
        /^select/i.test(query.sql) &&
        query.sql.includes("from `agent_support_conversations`") &&
        query.params.includes(ACTOR) &&
        query.params.includes(10) &&
        query.sql.includes("`expiresAt` >")
    );
    const contentsIndex = fixture.trace.findIndex(query =>
      messageContentQueries().includes(query)
    );
    expect(ownerIndex).toBeGreaterThanOrEqual(0);
    expect(contentsIndex).toBeGreaterThan(ownerIndex);
    expect(fixture.rows("agent_support_conversations")[0].expiresAt).toBe(
      timestamp(FUTURE)
    );
    expect(writes()).toEqual([]);
  });

  it("scopes the actual context query to the owned, unexpired admin conversation", async () => {
    conversation();
    conversation({ id: 11, userId: 999 });
    conversation({ id: 12, expiresAt: OLD });
    conversation({ id: 13, pilotScope: "agent" });
    for (const conversationId of [10, 11, 12, 13]) {
      message({
        id: conversationId * 10,
        conversationId,
        role: "user",
        content: `CONVERSATION_${conversationId}_USER: How do I cancel?`,
      });
      message({
        id: conversationId * 10 + 1,
        conversationId,
        content: `CONVERSATION_${conversationId}_ASSISTANT: Read the procedure [S1].`,
      });
    }
    await caller().ask({
      conversationId: 10,
      question: "Which generic step comes next?",
    });
    const [query] = messageContentQueries();
    expect(query.sql).toContain("inner join `agent_support_conversations`");
    expect(query.sql).toContain("`agent_support_conversations`.`id` = ?");
    expect(query.sql).toContain("`agent_support_conversations`.`userId` = ?");
    expect(query.sql).toContain(
      "`agent_support_conversations`.`pilotScope` = ?"
    );
    expect(query.sql).toContain(
      "`agent_support_conversations`.`expiresAt` > ?"
    );
    expect(query.params).toEqual(
      expect.arrayContaining([10, ACTOR, "admin_only", timestamp(NOW)])
    );
    const argument = guards.generate.mock.calls[0]?.[0];
    expect(argument.history).toEqual([
      { role: "user", content: "CONVERSATION_10_USER: How do I cancel?" },
      {
        role: "assistant",
        content: "CONVERSATION_10_ASSISTANT: Read the procedure [S1].",
      },
    ]);
    expect(JSON.stringify(argument.history)).not.toMatch(
      /CONVERSATION_(?:11|12|13)_/
    );
  });

  it.each(["ownership", "expiry"])(
    "never generates when %s changes while the context query loads",
    async boundary => {
      conversation({ expiresAt: new Date(NOW.getTime() + 1_000) });
      message({ id: 1, role: "user", content: "How do I cancel?" });
      message({ id: 2 });
      fixture.beforeQuery(sql => {
        if (
          !sql.startsWith("select") ||
          !sql.includes("from `agent_support_messages`") ||
          !sql.includes("`content`")
        )
          return;
        if (boundary === "ownership")
          fixture.mutate(
            "UPDATE agent_support_conversations SET userId = ? WHERE id = ?",
            999,
            10
          );
        else vi.setSystemTime(new Date(NOW.getTime() + 1_000));
      });
      const result = await caller()
        .ask({ conversationId: 10, question: "Which general step comes next?" })
        .catch((error: unknown) => error);
      expect(result).toMatchObject({
        code: "NOT_FOUND",
        message: "This assistant conversation is no longer available.",
      });
      expect(guards.generate).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);
      expect(fixture.rows("agent_support_messages")).toHaveLength(2);
      assertNoPrivateFailure(result);
    }
  );

  it.each(["ownership", "expiry", "deleted", "scope"])(
    "never generates when %s changes during awaited source loading",
    async boundary => {
      conversation({ expiresAt: new Date(NOW.getTime() + 1_000) });
      message({ id: 1, role: "user", content: "How do I cancel?" });
      message({ id: 2 });
      guards.sources.mockImplementation(async () => {
        const sources = await realSources.loadAdminPilotSupportSources();
        if (boundary === "ownership")
          fixture.mutate(
            "UPDATE agent_support_conversations SET userId = ? WHERE id = ?",
            999,
            10
          );
        else if (boundary === "expiry")
          vi.setSystemTime(new Date(NOW.getTime() + 1_000));
        else if (boundary === "deleted")
          fixture.mutate(
            "DELETE FROM agent_support_conversations WHERE id = ?",
            10
          );
        else
          fixture.mutate(
            "UPDATE agent_support_conversations SET pilotScope = ? WHERE id = ?",
            "agent",
            10
          );
        return sources;
      });
      const result = await caller()
        .ask({ conversationId: 10, question: "Which general step comes next?" })
        .catch((error: unknown) => error);
      expect(result).toMatchObject({
        code: "NOT_FOUND",
        message: "This assistant conversation is no longer available.",
      });
      expect(guards.sources).toHaveBeenCalledOnce();
      expect(guards.generate).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);
      expect(fixture.rows("agent_support_messages")).toHaveLength(2);
      const finalQuery = fixture.trace.at(-1)!;
      expect(finalQuery.sql).toContain("from `agent_support_conversations`");
      expect(finalQuery.sql).toContain("`expiresAt` > ?");
      expect(finalQuery.params).toContain(
        timestamp(boundary === "expiry" ? new Date(NOW.getTime() + 1_000) : NOW)
      );
      assertNoPrivateFailure(result);
    }
  );

  it.each(["inactive", "role", "identity"])(
    "never generates after the request identity is revoked by %s during preparation",
    async boundary => {
      conversation();
      const ctx = context();
      guards.sources.mockImplementation(async () => {
        const sources = await realSources.loadAdminPilotSupportSources();
        if (boundary === "inactive") ctx.user!.isActive = false;
        else if (boundary === "role") ctx.user!.role = "agent";
        else ctx.user!.id = 999;
        return sources;
      });
      const result = await agentSupportRouter
        .createCaller(ctx)
        .ask({ conversationId: 10, question: "How do I cancel a booking?" })
        .catch((error: unknown) => error);
      expect(result).toMatchObject({ code: "FORBIDDEN" });
      expect(guards.generate).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);
      assertNoPrivateFailure(result);
    }
  );

  it("does not generate if the final ownership query itself outlives expiry", async () => {
    conversation({ expiresAt: new Date(NOW.getTime() + 1_000) });
    let prepared = false;
    guards.sources.mockImplementation(async () => {
      const sources = await realSources.loadAdminPilotSupportSources();
      prepared = true;
      return sources;
    });
    fixture.beforeQuery(sql => {
      if (prepared && sql.includes("from `agent_support_conversations`"))
        vi.setSystemTime(new Date(NOW.getTime() + 1_000));
    });
    await expect(
      caller().ask({ conversationId: 10, question: "How do I cancel?" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(guards.generate).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("rechecks ownership at commit after generation and atomically leaves no turn on owner change", async () => {
    conversation();
    guards.generate.mockImplementation(async () => {
      fixture.mutate(
        "UPDATE agent_support_conversations SET userId = ? WHERE id = ?",
        999,
        10
      );
      return generated();
    });
    await expect(
      caller().ask({
        conversationId: 10,
        question: "How do I cancel a booking?",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(guards.generate).toHaveBeenCalledOnce();
    expect(fixture.rows("agent_support_messages")).toEqual([]);
    expect(fixture.rows("agent_support_conversations")[0].updatedAt).toBe(
      timestamp(OLD)
    );
  });

  it("cannot extend a conversation that expires while the model is generating", async () => {
    conversation({ expiresAt: new Date(NOW.getTime() + 1_000) });
    guards.generate.mockImplementation(async () => {
      vi.setSystemTime(new Date(NOW.getTime() + 2_000));
      return generated();
    });
    await expect(
      caller().ask({
        conversationId: 10,
        question: "How do I cancel a booking?",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.rows("agent_support_messages")).toEqual([]);
    await expect(
      caller().ask({
        conversationId: 10,
        question: "How do I cancel a booking?",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(guards.generate).toHaveBeenCalledOnce();
  });
});

describe("current-input privacy and rate-limit ordering", () => {
  it("checks the hourly limit before resolving or creating any conversation", async () => {
    conversation();
    for (let id = 1; id <= 30; id++)
      message({
        id,
        role: "user",
        createdAt: NOW,
        sourceRefs: null,
        content: "How do I cancel?",
      });
    await expect(
      caller().ask({ question: "How do I cancel a booking?" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(writes()).toEqual([]);
    expect(fixture.rows("agent_support_conversations")).toHaveLength(1);
    expect(guards.generate).not.toHaveBeenCalled();
    expect(sourceQueries()).toEqual([]);
  });

  it("checks rate limiting before even looking up an explicitly foreign conversation", async () => {
    conversation();
    conversation({ id: 11, userId: 999 });
    for (let id = 1; id <= 30; id++)
      message({
        id,
        role: "user",
        createdAt: NOW,
        sourceRefs: null,
        content: "How do I cancel?",
      });
    await expect(
      caller().ask({
        conversationId: 11,
        question: "How do I cancel a booking?",
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(
      fixture.trace.some(
        query => /^select/i.test(query.sql) && query.params.includes(11)
      )
    ).toBe(false);
    expect(writes()).toEqual([]);
    expect(guards.generate).not.toHaveBeenCalled();
  });

  it.each([
    "synthetic.client@example.test",
    "booking reference: 123456789",
    ...LABELLED_IDENTIFIERS,
    "my client is Synthetic Person",
    "sort code: 12-34-56",
  ])(
    "blocks raw input %s before source/model use and stores only an omission",
    async privateInput => {
      const result = await caller().ask({
        question: `Please check ${privateInput}`,
      });
      expect(result).toMatchObject({
        disposition: "privacy_blocked",
        verified: false,
        sources: [],
      });
      expect(result.answer).toBe(SUPPORT_PRIVACY_MESSAGE);
      expect(guards.generate).not.toHaveBeenCalled();
      expect(guards.sources).not.toHaveBeenCalled();
      expect(sourceQueries()).toEqual([]);
      const records = fixture.rows("agent_support_messages");
      expect(records.map(row => row.role)).toEqual(["user", "assistant"]);
      expect(records[0].content).toBe(OMISSION);
      expect(JSON.stringify(records)).not.toContain(privateInput);
      expect(JSON.stringify(writes())).not.toContain(privateInput);
      expect(JSON.parse(records[1].sourceRefs)).toMatchObject(
        envelope({
          sources: [],
          disposition: "privacy_blocked",
          verified: false,
          modelCalls: 0,
          latencyMs: 0,
        })
      );
      const messageWrites = writes().filter(query =>
        /insert into `agent_support_messages`/i.test(query.sql)
      );
      expect(messageWrites.every(query => query.transaction > 0)).toBe(true);
      expect(JSON.stringify(result)).not.toContain(privateInput);
      const display = await caller().conversation({
        conversationId: result.conversationId,
      });
      expect(JSON.stringify(display)).not.toContain(privateInput);
      expect(display.messages[0].content).toBe(OMISSION);
    }
  );

  it.each([
    "booking reference",
    "client name",
    "account number",
    "Where is the booking reference field?",
    "Was the general procedure published on 2026-11-13 with a £25 fee?",
    "Was the general procedure published on 13/11/2026 with a £25 fee?",
  ])(
    "does not block general procedure text without an identifier (%s)",
    async question => {
      const result = await caller().ask({ question });
      expect(result.disposition).toBe("answered");
      expect(guards.generate).toHaveBeenCalledOnce();
      expect(guards.generate.mock.calls[0]?.[0].question).toBe(question);
      expect(fixture.rows("agent_support_messages")[0].content).toBe(question);
    }
  );
});

describe("screened new-version context, not unsafe or legacy history", () => {
  it("sanitizes historical display but never includes legacy messages in model context", async () => {
    conversation();
    message({
      id: 1,
      role: "user",
      content: "LEGACY_SAFE_USER: How do I cancel?",
      sourceRefs: null,
    });
    message({
      id: 2,
      content: "LEGACY_SAFE_ASSISTANT: Read the procedure [S1].",
      sourceRefs: [citation()],
    });
    message({
      id: 3,
      role: "user",
      content: "LEGACY_PRIVATE_SENTINEL synthetic.client@example.test",
      sourceRefs: null,
    });
    message({ id: 4, content: SUPPORT_PRIVACY_MESSAGE, sourceRefs: [] });
    const display = await caller().conversation({ conversationId: 10 });
    expect(display.messages.find((row: any) => row.id === 3).content).toBe(
      OMISSION
    );
    expect(display.messages.find((row: any) => row.id === 4).content).toBe(
      SUPPORT_PRIVACY_MESSAGE
    );
    expect(display.messages.find((row: any) => row.id === 2)).toMatchObject({
      verified: false,
      sources: [expect.objectContaining({ key: "kb:7" })],
    });
    await caller().ask({
      conversationId: 10,
      question: "How do I cancel a booking?",
    });
    const argument = guards.generate.mock.calls[0]?.[0];
    expect(argument).toMatchObject({
      question: "How do I cancel a booking?",
      history: [],
    });
    expect(JSON.stringify(argument)).not.toContain("LEGACY_");
    expect(JSON.stringify(argument)).not.toContain(
      "synthetic.client@example.test"
    );
  });

  it("includes only screened version-two user/assistant pairs, rejects unsafe and unsigned history", async () => {
    conversation();
    const addPair = (
      id: number,
      user: string,
      assistant: string,
      refs: unknown = envelope()
    ) => {
      message({
        id,
        role: "user",
        content: user,
        sourceRefs: refs,
        createdAt: new Date(OLD.getTime() + id * 1_000),
      });
      message({
        id: id + 1,
        content: assistant,
        sourceRefs: refs,
        createdAt: new Date(OLD.getTime() + (id + 1) * 1_000),
      });
    };
    addPair(
      1,
      "SAFE_CONTEXT_USER: How do I cancel?",
      "SAFE_CONTEXT_ASSISTANT: Read the generic procedure [S1]."
    );
    addPair(
      3,
      "UNSAFE_PAIR_USER: synthetic.client@example.test",
      "UNSAFE_PAIR_ASSISTANT: Must not enter context."
    );
    addPair(
      5,
      "UNSIGNED_PAIR_USER: How do I cancel?",
      "UNSIGNED_PAIR_ASSISTANT: Must not enter context.",
      { ...envelope(), inputScreened: false }
    );
    addPair(
      7,
      "UNSAFE_ASSISTANT_PAIR_USER: How do I cancel?",
      "UNSAFE_ASSISTANT_PAIR: password: synthetic-only-secret"
    );
    await caller().ask({
      conversationId: 10,
      question: "Which generic cancellation step comes next?",
    });
    const argument = guards.generate.mock.calls[0]?.[0];
    expect(argument.history).toEqual([
      { role: "user", content: "SAFE_CONTEXT_USER: How do I cancel?" },
      {
        role: "assistant",
        content: "SAFE_CONTEXT_ASSISTANT: Read the generic procedure [S1].",
      },
    ]);
    expect(JSON.stringify(argument)).not.toMatch(/UNSAFE_|UNSIGNED_/);
  });

  it.each(
    LABELLED_IDENTIFIERS.flatMap(detail =>
      ["user", "assistant"].map(role => ({ detail, role }))
    )
  )(
    "omits the complete context pair and screens display for a $role containing $detail",
    async ({ detail, role }) => {
      conversation();
      message({ id: 1, role: "user", content: "How do I cancel?" });
      message({ id: 2, content: "Read the generic procedure [S1]." });
      message({
        id: 3,
        role: "user",
        content:
          role === "user" ? detail : "UNSAFE_PAIR_SAFE_USER: How do I cancel?",
      });
      message({
        id: 4,
        content:
          role === "assistant"
            ? detail
            : "UNSAFE_PAIR_SAFE_ASSISTANT: Read the procedure [S1].",
      });
      const display = await caller().conversation({ conversationId: 10 });
      expect(
        display.messages.find(row => row.id === (role === "user" ? 3 : 4))
          ?.content
      ).toBe(OMISSION);
      expect(JSON.stringify(display)).not.toContain(detail);
      await caller().ask({
        conversationId: 10,
        question: "Which general step comes next?",
      });
      const argument = guards.generate.mock.calls[0]?.[0];
      expect(argument.history).toEqual([
        { role: "user", content: "How do I cancel?" },
        { role: "assistant", content: "Read the generic procedure [S1]." },
      ]);
      expect(JSON.stringify(argument)).not.toContain(detail);
      expect(JSON.stringify(argument)).not.toContain("UNSAFE_PAIR_");
    }
  );

  it("requires both sides of a context pair to carry inputScreened version-two metadata", async () => {
    conversation();
    message({
      id: 1,
      role: "user",
      content: "LEGACY_SIDE_USER: How do I cancel?",
      sourceRefs: null,
    });
    message({
      id: 2,
      content: "NEW_SIDE_ASSISTANT: Read the procedure [S1].",
      sourceRefs: envelope(),
    });
    message({
      id: 3,
      role: "user",
      content: "NEW_SIDE_USER: How do I cancel?",
      sourceRefs: envelope(),
    });
    message({
      id: 4,
      content: "LEGACY_SIDE_ASSISTANT: Read the procedure [S1].",
      sourceRefs: [citation()],
    });
    await caller().ask({
      conversationId: 10,
      question: "How do I cancel a booking?",
    });
    expect(guards.generate.mock.calls[0]?.[0].history).toEqual([]);
  });

  it("bounds newest complete context to eight messages and six thousand characters", async () => {
    conversation();
    for (let id = 1; id <= 24; id++)
      message({
        id,
        role: id % 2 ? "user" : "assistant",
        content: `${id % 2 ? "Question" : "Answer"} ${String.fromCharCode(64 + id)}: ${"general process guidance ".repeat(24)}`,
        sourceRefs: envelope(),
        createdAt: new Date(OLD.getTime() + id * 1_000),
      });
    await caller().ask({
      conversationId: 10,
      question: "How do I cancel a booking?",
    });
    const history = guards.generate.mock.calls[0]?.[0].history as Array<{
      role: string;
      content: string;
    }>;
    expect(history.length).toBeGreaterThan(0);
    expect(history.length).toBeLessThanOrEqual(8);
    expect(
      history.reduce((total, turn) => total + turn.content.length, 0)
    ).toBeLessThanOrEqual(6_000);
    expect(history.length % 2).toBe(0);
    expect(history.map(turn => turn.role)).toEqual(
      history.map((_, index) => (index % 2 ? "assistant" : "user"))
    );
    expect(history.at(-1)?.content).toContain("Answer X:");
    expect(JSON.stringify(history)).not.toContain("Question A:");
  });
});

describe("generation metadata, atomic persistence, and safe failure surfaces", () => {
  it("stores precisely the sources actually used by this answer, not retrieved or previous-answer citations", async () => {
    conversation();
    message({
      id: 1,
      role: "user",
      content: "How do I find terms?",
      sourceRefs: envelope({ sources: [citation(1, "policy:prior")] }),
    });
    message({
      id: 2,
      content: "Prior answer [S1].",
      sourceRefs: envelope({ sources: [citation(1, "policy:prior")] }),
    });
    const used = citation(2, "portal-procedure:current-only");
    guards.generate.mockResolvedValue(
      generated({
        answer: "Use this approved process [S2].",
        sources: [used],
        modelCalls: 2,
        latencyMs: 41,
      })
    );
    const result = await caller().ask({
      conversationId: 10,
      question: "How do I cancel a booking?",
    });
    expect(result).toMatchObject({
      sources: [used],
      verified: true,
      disposition: "answered",
    });
    const records = fixture.rows("agent_support_messages");
    const assistant = records.at(-1)!;
    expect(JSON.parse(assistant.sourceRefs)).toEqual(
      envelope({
        sources: [{ ...used, updatedAt: OLD.toISOString() }],
        modelCalls: 2,
        latencyMs: 41,
      })
    );
    expect(assistant.contextSourceCount).toBe(1);
    expect(assistant.model).toBe("mock-only");
    expect(assistant.promptTokens).toBe(10);
    expect(assistant.completionTokens).toBe(12);
    expect(JSON.stringify(JSON.parse(assistant.sourceRefs))).not.toContain(
      "policy:prior"
    );
    const newUser = records.at(-2)!;
    expect(JSON.parse(newUser.sourceRefs)).toMatchObject({
      version: 2,
      inputScreened: true,
    });
    const turnWrites = writes().filter(query =>
      /agent_support_messages|update `agent_support_conversations`/i.test(
        query.sql
      )
    );
    expect(turnWrites.every(query => query.transaction > 0)).toBe(true);
    expect(new Set(turnWrites.map(query => query.transaction)).size).toBe(1);
    expect(fixture.rows("agent_support_conversations")[0]).toMatchObject({
      expiresAt: timestamp(FUTURE),
      updatedAt: timestamp(NOW),
    });
  });

  it("does not report false citations for a validation-failed result", async () => {
    guards.generate.mockResolvedValue(
      generated({
        answer: "This answer was withheld. Please ask JLT Support.",
        sources: [],
        disposition: "validation_failed",
        verified: false,
        status: "failed",
        unresolvedReason: "citation_validation_failed",
      })
    );
    const result = await caller().ask({
      question: "How do I cancel a booking?",
    });
    expect(result).toMatchObject({
      sources: [],
      disposition: "validation_failed",
      verified: false,
      status: "failed",
    });
    expect(
      JSON.parse(fixture.rows("agent_support_messages").at(-1)!.sourceRefs)
    ).toMatchObject({
      version: 2,
      sources: [],
      verified: false,
      disposition: "validation_failed",
    });
    expect(
      fixture.rows("agent_support_messages").at(-1)!.contextSourceCount
    ).toBe(0);
  });

  it("refuses an answered but unverified generation result without persisting either turn", async () => {
    conversation();
    guards.generate.mockResolvedValue(
      generated({ answer: "UNVERIFIED_ANSWER_SENTINEL", verified: false })
    );
    await expect(
      caller().ask({
        conversationId: 10,
        question: "How do I cancel a booking?",
      })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(fixture.rows("agent_support_messages")).toEqual([]);
    expect(fixture.rows("agent_support_conversations")[0].updatedAt).toBe(
      timestamp(OLD)
    );
  });

  it("creates a new conversation with a fixed ninety-day expiry", async () => {
    const result = await caller().ask({
      question: "How do I cancel a booking?",
    });
    expect(result.conversationId).toBeGreaterThan(0);
    const stored = fixture.rows("agent_support_conversations")[0];
    expect(stored).toMatchObject({
      userId: ACTOR,
      pilotScope: "admin_only",
      expiresAt: timestamp(new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1_000)),
    });
    await caller().conversation({ conversationId: result.conversationId });
    await caller().ask({
      conversationId: result.conversationId,
      question: "How do I request a refund?",
    });
    expect(fixture.rows("agent_support_conversations")[0].expiresAt).toBe(
      stored.expiresAt
    );
  });

  it("rolls both messages back if the assistant insert fails", async () => {
    conversation();
    let messageInsertCount = 0;
    fixture.fail(
      sql =>
        /^insert into `agent_support_messages`/i.test(sql) &&
        ++messageInsertCount === 2
    );
    const result = await caller()
      .ask({ conversationId: 10, question: "How do I cancel a booking?" })
      .catch((error: unknown) => error);
    expect(fixture.rows("agent_support_messages")).toEqual([]);
    expect(fixture.rows("agent_support_conversations")[0].updatedAt).toBe(
      timestamp(OLD)
    );
    expect(fixture.transaction).toHaveBeenCalled();
    assertNoPrivateFailure(result);
  });

  it("sanitizes source-query exceptions for both client and log, with no raw question persisted", async () => {
    conversation();
    fixture.fail(sql => sql.includes("from `knowledge_base_articles`"));
    const result = await caller()
      .ask({ conversationId: 10, question: "How do I cancel a booking?" })
      .catch((error: unknown) => error);
    assertNoPrivateFailure(result);
    expect(guards.generate).not.toHaveBeenCalled();
    expect(
      fixture.rows("agent_support_messages").filter(row => row.role === "user")
    ).toEqual([]);
  });

  it("stores a safe model-unavailable generation result with no false source claims", async () => {
    guards.generate.mockResolvedValue(
      generated({
        answer: "Support is temporarily unavailable. No action has been taken.",
        sources: [],
        status: "failed",
        disposition: "failed",
        verified: false,
        model: null,
        promptTokens: null,
        completionTokens: null,
        unresolvedReason: "model_unavailable",
      })
    );
    const result = await caller().ask({
      question: "How do I cancel a booking?",
    });
    expect(result).toMatchObject({
      status: "failed",
      disposition: "failed",
      verified: false,
      sources: [],
    });
    const records = fixture.rows("agent_support_messages");
    expect(records.map(row => row.role)).toEqual(["user", "assistant"]);
    expect(JSON.parse(records[1].sourceRefs)).toMatchObject({
      version: 2,
      inputScreened: true,
      disposition: "failed",
      sources: [],
      verified: false,
    });
  });

  it("sanitizes unexpected generation exceptions without exposing provider text", async () => {
    guards.generate.mockRejectedValue(
      new Error("password=DATABASE_PRIVATE_SENTINEL provider@example.test")
    );
    const result = await caller()
      .ask({ question: "How do I cancel a booking?" })
      .catch((error: unknown) => error);
    assertNoPrivateFailure(result);
    expect(guards.generate).toHaveBeenCalledOnce();
    expect(
      JSON.stringify(fixture.rows("agent_support_messages"))
    ).not.toContain("DATABASE_PRIVATE_SENTINEL");
  });
});

describe("feedback privacy, exact-answer ownership, and gap review", () => {
  it("writes safe feedback on exactly the owned assistant answer and retains no other answer's feedback", async () => {
    conversation();
    message();
    message({ id: 101, content: "Second answer [S1]." });
    await expect(
      caller().feedback({
        messageId: 100,
        rating: "helpful",
        note: "The general steps are clear.",
      })
    ).resolves.toEqual({ success: true });
    await caller().feedback({
      messageId: 100,
      rating: "not_helpful",
      note: "Please make the steps clearer.",
    });
    expect(fixture.rows("agent_support_feedback")).toEqual([
      expect.objectContaining({
        userId: ACTOR,
        messageId: 100,
        rating: "not_helpful",
        note: "Please make the steps clearer.",
      }),
    ]);
    const display = await caller().conversation({ conversationId: 10 });
    expect(display.messages.find((row: any) => row.id === 100).feedback).toBe(
      "not_helpful"
    );
    expect(
      display.messages.find((row: any) => row.id === 101).feedback
    ).toBeNull();
    expect(JSON.stringify(display)).not.toContain(
      "Please make the steps clearer."
    );
  });

  it("does not display another administrator's feedback on the same answer", async () => {
    conversation();
    message();
    fixture.seed("agent_support_feedback", {
      id: 1,
      messageId: 100,
      userId: 999,
      rating: "helpful",
      note: "FOREIGN_NOTE_SENTINEL",
      createdAt: OLD,
      updatedAt: OLD,
    });
    const display = await caller().conversation({ conversationId: 10 });
    expect(display.messages[0].feedback).toBeNull();
    expect(JSON.stringify(display)).not.toContain("FOREIGN_NOTE_SENTINEL");
  });

  it("sanitizes feedback persistence failures and rolls the write back", async () => {
    conversation();
    message();
    fixture.fail(sql => /^insert into `agent_support_feedback`/i.test(sql));
    const result = await caller()
      .feedback({
        messageId: 100,
        rating: "helpful",
        note: "The general process is clear.",
      })
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    assertNoPrivateFailure(result);
    expect(fixture.rows("agent_support_feedback")).toEqual([]);
  });

  it.each([
    "synthetic.client@example.test",
    "booking reference: 123456789",
    ...LABELLED_IDENTIFIERS,
    "password: synthetic-secret",
  ])(
    "rejects unsafe feedback note %s before any feedback write",
    async note => {
      conversation();
      message();
      const result = await caller()
        .feedback({ messageId: 100, rating: "helpful", note })
        .catch((error: unknown) => error);
      expect(result).toMatchObject({ code: "BAD_REQUEST" });
      expect(fixture.rows("agent_support_feedback")).toEqual([]);
      expect(guards.getDb).not.toHaveBeenCalled();
      expect(fixture.trace).toEqual([]);
      expect(JSON.stringify(writes())).not.toContain(note);
      expect(
        JSON.stringify([...errorLog.mock.calls, ...warningLog.mock.calls])
      ).not.toContain(note);
    }
  );

  it.each(LABELLED_IDENTIFIERS)(
    "screens labelled identifier %s out of historical gap review",
    async detail => {
      conversation();
      message({ id: 1, role: "user", content: detail, sourceRefs: null });
      message({
        id: 2,
        responseStatus: "insufficient_sources",
        unresolvedReason: "no_relevant_approved_source",
        sourceRefs: [],
      });
      const result = await caller().recentGaps();
      expect(result).toEqual([
        expect.objectContaining({ id: 2, question: OMISSION }),
      ]);
      expect(JSON.stringify(result)).not.toContain(detail);
    }
  );

  it("returns the original preceding user question for gaps, not the assistant refusal", async () => {
    conversation();
    message({
      id: 1,
      role: "user",
      content: "Where is the general missing process?",
      sourceRefs: envelope({ sources: [] }),
    });
    message({
      id: 2,
      content: "ASSISTANT_REFUSAL_NOT_A_QUESTION",
      responseStatus: "insufficient_sources",
      unresolvedReason: "no_relevant_approved_source",
      sourceRefs: envelope({
        sources: [],
        disposition: "escalated",
        verified: false,
      }),
    });
    const gaps = await caller().recentGaps();
    expect(gaps).toEqual([
      expect.objectContaining({
        id: 2,
        question: "Where is the general missing process?",
      }),
    ]);
    expect(JSON.stringify(gaps)).not.toContain(
      "ASSISTANT_REFUSAL_NOT_A_QUESTION"
    );
  });

  it("sanitizes historical gap questions and omits expired gaps even when purge fails", async () => {
    conversation();
    conversation({ id: 11, expiresAt: OLD });
    message({
      id: 1,
      role: "user",
      content: "synthetic.client@example.test",
      sourceRefs: null,
    });
    message({
      id: 2,
      content: "No approved guidance.",
      responseStatus: "insufficient_sources",
      unresolvedReason: "no_relevant_approved_source",
      sourceRefs: [],
    });
    message({
      id: 3,
      conversationId: 11,
      role: "user",
      content: "EXPIRED_GAP_SENTINEL",
      sourceRefs: null,
    });
    message({
      id: 4,
      conversationId: 11,
      content: "No approved guidance.",
      responseStatus: "insufficient_sources",
      unresolvedReason: "no_relevant_approved_source",
      sourceRefs: [],
    });
    fixture.fail(sql => /^delete/i.test(sql));
    const result = await caller().recentGaps();
    expect(result).toEqual([
      expect.objectContaining({ id: 2, question: OMISSION }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /EXPIRED_GAP_SENTINEL|synthetic\.client@example\.test/
    );
  });
});

describe("retention purge is atomic and expiry is enforced even if cleanup fails", () => {
  function expiredFixture() {
    conversation({ expiresAt: OLD });
    message({ content: "EXPIRED_CONTENT_SENTINEL" });
    fixture.seed("agent_support_feedback", {
      id: 1,
      messageId: 100,
      userId: ACTOR,
      rating: "helpful",
      note: "Private old note",
      createdAt: OLD,
      updatedAt: OLD,
    });
  }
  it("purges feedback, messages, and conversations in one transaction", async () => {
    expiredFixture();
    await caller().overview();
    expect(fixture.rows("agent_support_feedback")).toEqual([]);
    expect(fixture.rows("agent_support_messages")).toEqual([]);
    expect(fixture.rows("agent_support_conversations")).toEqual([]);
    const deletes = writes().filter(query => /^delete/i.test(query.sql));
    expect(
      deletes.map(query => query.sql.match(/delete from `([^`]+)`/i)?.[1])
    ).toEqual([
      "agent_support_feedback",
      "agent_support_messages",
      "agent_support_conversations",
    ]);
    expect(deletes.every(query => query.transaction > 0)).toBe(true);
    expect(new Set(deletes.map(query => query.transaction)).size).toBe(1);
  });
  it("rolls a partial purge back and still filters expired direct reads", async () => {
    expiredFixture();
    fixture.fail(sql => /^delete from `agent_support_messages`/i.test(sql));
    const purgeFailure = await caller()
      .overview()
      .catch((error: unknown) => error);
    assertNoPrivateFailure(purgeFailure);
    await expect(caller().conversations()).resolves.toEqual([]);
    expect(fixture.rows("agent_support_feedback")).toHaveLength(1);
    expect(fixture.rows("agent_support_messages")).toHaveLength(1);
    expect(fixture.rows("agent_support_conversations")).toHaveLength(1);
    await expect(
      caller().conversation({ conversationId: 10 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller().feedback({ messageId: 100, rating: "helpful" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const askFailure = await caller()
      .ask({ conversationId: 10, question: "How do I cancel a booking?" })
      .catch((error: unknown) => error);
    expect(askFailure).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(messageContentQueries()).toEqual([]);
    expect(guards.generate).not.toHaveBeenCalled();
    assertNoPrivateFailure({});
  });
});

describe("source loading remains positive-projection only", () => {
  it("includes learner-visible published library text even without a historical timestamp, never drafts or archives", async () => {
    for (const table of ["knowledge_base_articles", "webinar_library_items"]) {
      for (const [index, status] of ["published", "draft", "archived"].entries()) {
        fixture.seed(table, { id: index + 1, status, publishedAt: null, title: `${table}-${status}`, summary: `VISIBLE_${status}`, ...(table === "knowledge_base_articles" ? { contentHtml: "Published article guidance." } : { descriptionHtml: "Published webinar guidance." }) });
      }
    }
    const sources = await loadAdminPilotSupportSources();
    expect(sources.find(source => source.key === "kb:1")?.text).toContain("VISIBLE_published");
    expect(sources.find(source => source.key === "webinar:1")?.text).toContain("VISIBLE_published");
    expect(sources.some(source => ["kb:2", "kb:3", "webinar:2", "webinar:3"].includes(source.key))).toBe(false);
    expect(writes()).toEqual([]);
  });

  it("includes only published non-archived Academy lesson text and explicitly approved webinar transcripts", async () => {
    fixture.seed("academy_courses", { id: 1, status: "published", title: "Approved course" });
    fixture.seed("academy_courses", { id: 2, status: "draft", title: "Private draft course" });
    fixture.seed("academy_modules", { id: 1, courseId: 1, title: "Guidance module" });
    fixture.seed("academy_modules", { id: 2, courseId: 2, title: "Draft module" });
    for (const [id, moduleId, archivedAt] of [[1, 1, null], [2, 1, NOW], [3, 2, null]] as const) {
      fixture.seed("academy_lessons", { id, moduleId, archivedAt, title: "Reimbursement", contentHtml: "Approved lesson evidence guidance.", videoTranscript: "PRIVATE_ACADEMY_TRANSCRIPT", assessmentTemplateKey: "PRIVATE_TEMPLATE_KEY", attachmentKey: "PRIVATE_RESOURCE_KEY" });
    }
    for (const [id, approved] of [[1, null], [2, NOW]] as const) {
      fixture.seed("webinar_library_items", { id, title: "Published webinar", status: "published", summary: "Webinar summary", privateTranscript: approved ? "APPROVED_TRANSCRIPT" : "UNAPPROVED_TRANSCRIPT", assistantTranscriptApprovedAt: approved });
    }
    const sources = await loadAdminPilotSupportSources();
    expect(sources.find(source => source.key === "academy:1")?.text).toContain("Approved lesson evidence guidance");
    expect(sources.some(source => ["academy:2", "academy:3"].includes(source.key))).toBe(false);
    expect(sources.find(source => source.key === "webinar:2")?.text).toContain("APPROVED_TRANSCRIPT");
    expect(JSON.stringify(sources)).not.toMatch(/PRIVATE_ACADEMY_TRANSCRIPT|PRIVATE_TEMPLATE_KEY|PRIVATE_RESOURCE_KEY|UNAPPROVED_TRANSCRIPT/);
    expect(writes()).toEqual([]);
  });

  it("loads no private supplier, Academy assessment, or community-activity fields", async () => {
    await loadAdminPilotSupportSources();
    const queries = sourceQueries();
    expect(queries).toHaveLength(5);
    const projections = queries
      .map(query => query.sql.split(/\bfrom\b/i)[0])
      .join("\n");
    expect(projections).not.toMatch(/select\s+\*/i);
    expect(projections).not.toMatch(
      /loginPassword|loginUsername|agencyId|adminNotes|generalNotes|accountManager|marking|answers|attempts|learner|storageKey|progress|enrollment|authorId/
    );
    const supplierQuery = queries.find(query =>
      query.sql.includes("from `suppliers`")
    )!;
    expect(supplierQuery.sql.split(/\bfrom\b/i)[0]).not.toMatch(
      /email|phone|outOfHours|adminUsername|adminPassword/
    );
    const webinarQuery = queries.find(query =>
      query.sql.includes("from `webinar_library_items`")
    )!;
    expect(webinarQuery.sql).toContain("assistantTranscriptApprovedAt");
    const communityQuery = queries.find(query =>
      query.sql.includes("from `community_posts`")
    )!;
    expect(communityQuery.params).toEqual(
      expect.arrayContaining(["news_announcements", "admin", "super_admin"])
    );
    expect(guards.generate).not.toHaveBeenCalled();
  });
});
