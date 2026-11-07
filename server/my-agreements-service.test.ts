import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import {
  AGREEMENT_SOURCES,
  type AgreementSource,
} from "../shared/my-agreements";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), history: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./agent-merge-identity", () => ({
  getAgentMergeHistoryIds: mocks.history,
}));

import {
  myAgreementDetail,
  myAgreementSummaries,
} from "./my-agreements-service";
import { myAgreementsRouter } from "./my-agreements-router";

const STORAGE = "https://agreements.example.test/public";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SIGNATURE_URL = `${STORAGE}/crm/contracts/signatures/signer_11.png`;
const PRIVATE = "DO-NOT-EXPOSE-PRIVATE-EVIDENCE";
const TABLES: Record<AgreementSource, string> = {
  join: "join_sessions",
  prospect: "prospect_contracts",
  legacy: "contract_signatures",
  terms: "terms_signings",
};
type Row = Record<string, any>;
type Bindings = Record<string, Row | null>;
type Read = {
  table: string;
  projection: Row;
  where?: { sql: string; params: unknown[] };
  joins: Array<{ table: string; kind: string; sql: string; params: unknown[] }>;
};

/** Test-only chain adapter: executes actual Drizzle predicates/projections against
 * raw table rows. In particular, returning prefiltered/canned owned DTOs would
 * hide missing ownership, signing-date, ID filters or broken joins. */
function agreementDb(initial: Record<string, Row[]>) {
  const tables = structuredClone(initial);
  const reads: Read[] = [];
  const dialect = new MySqlDialect();
  const isColumn = (item: any): boolean =>
    !!item?.table && typeof item.name === "string";
  const value = (item: any, bindings: Bindings): any => {
    if (isColumn(item))
      return bindings[getTableName(item.table)]?.[item.name] ?? null;
    if (Array.isArray(item)) return item.map(part => value(part, bindings));
    if (item && "encoder" in item) return item.value;
    return item;
  };
  function matches(predicate: any, bindings: Bindings): boolean {
    if (!predicate) return true;
    const chunks: any[] = predicate.queryChunks ?? [];
    const column = chunks.find(isColumn);
    if (column) {
      const at = chunks.indexOf(column);
      const operator = chunks[at + 1]?.value?.join("").trim();
      const left = value(column, bindings);
      const right = value(chunks[at + 2], bindings);
      if (operator === "=")
        return left !== null && right !== null && left === right;
      if (operator === "in") return left !== null && right.includes(left);
      if (operator === "is not null")
        return left !== null && left !== undefined;
      throw new Error(`Unsupported test predicate: ${operator}`);
    }
    const nested = chunks.filter(chunk => !!chunk?.queryChunks);
    if (nested.length) return nested.every(part => matches(part, bindings));
    throw new Error("Unsupported test predicate expression");
  }
  function project(item: any, bindings: Bindings): any {
    if (isColumn(item)) return value(item, bindings);
    if (item?.queryChunks) {
      const compiled = dialect.sqlToQuery(item);
      if (
        !/^CASE WHEN .* IS NOT NULL AND TRIM\(.*\) <> '' THEN 1 ELSE 0 END$/.test(
          compiled.sql
        )
      ) {
        throw new Error("Unsupported test SQL projection");
      }
      const column = item.queryChunks.find(isColumn);
      const raw = value(column, bindings);
      return raw !== null && String(raw).trim() !== "" ? 1 : 0;
    }
    return Object.fromEntries(
      Object.entries(item).map(([key, part]) => [key, project(part, bindings)])
    );
  }
  const failWrite = () => {
    throw new Error("Agreement helpers must never write");
  };
  const db = {
    insert: vi.fn(failWrite),
    update: vi.fn(failWrite),
    delete: vi.fn(failWrite),
    execute: vi.fn(failWrite),
    select(projection: Row) {
      let bindings: Bindings[] = [];
      let predicate: any;
      let limit = Infinity;
      let record: Read;
      let ordering: SQL[] = [];
      function join(table: any, condition: SQL, kind: "inner" | "left") {
        const name = getTableName(table);
        const compiled = dialect.sqlToQuery(condition);
        record.joins.push({ table: name, kind, ...compiled });
        bindings = bindings.flatMap(binding => {
          const joined = (tables[name] ?? [])
            .map(row => ({ ...binding, [name]: row }))
            .filter(next => matches(condition, next));
          return joined.length || kind === "inner"
            ? joined
            : [{ ...binding, [name]: null }];
        });
        return query;
      }
      const query = {
        from(table: any) {
          const name = getTableName(table);
          record = { table: name, projection, joins: [] };
          reads.push(record);
          bindings = (tables[name] ?? []).map(row => ({ [name]: row }));
          return query;
        },
        innerJoin(table: any, condition: SQL) {
          return join(table, condition, "inner");
        },
        leftJoin(table: any, condition: SQL) {
          return join(table, condition, "left");
        },
        where(condition: SQL) {
          predicate = condition;
          record.where = dialect.sqlToQuery(condition);
          return query;
        },
        orderBy(...conditions: SQL[]) {
          ordering = conditions;
          return query;
        },
        limit(max: number) {
          limit = max;
          return query;
        },
        then(resolve: any, reject: any) {
          return Promise.resolve()
            .then(() => {
              const filtered = bindings.filter(binding =>
                matches(predicate, binding)
              );
              filtered.sort((a, b) => {
                for (const order of ordering) {
                  const column = order.queryChunks.find(isColumn);
                  const left = value(column, a);
                  const right = value(column, b);
                  if (left < right) return 1;
                  if (left > right) return -1;
                }
                return 0;
              });
              return filtered
                .slice(0, limit)
                .map(binding => project(projection, binding));
            })
            .then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { db, tables, reads };
}

function fixtures(): Record<string, Row[]> {
  const raw = {
    signerName: "Original signer",
    signerAddress: "Original signed address",
    signatureDataUrl: PNG,
    contractTextSnapshot:
      "<h2>Original signing terms</h2><p>Saved at signing, not today's template.</p>",
    contractHash: "a".repeat(64),
    consentConfirmed: true,
    email: "self@example.test",
    signingToken: PRIVATE,
    sessionToken: PRIVATE,
    billingRequestId: PRIVATE,
    billingRequestFlowUrl: PRIVATE,
    mandateId: PRIVATE,
    adminNotes: PRIVATE,
    notes: PRIVATE,
    ipAddress: PRIVATE,
    signingIp: PRIVATE,
    signingUserAgent: PRIVATE,
    userAgent: PRIVATE,
  };
  const variants = [
    { id: 11, userId: 10, signedAt: new Date("2026-01-01T12:00:00Z") },
    { id: 12, userId: 99, signedAt: new Date("2026-01-02T12:00:00Z") },
    { id: 13, userId: 10, signedAt: null },
    { id: 14, userId: null, signedAt: new Date("2026-01-03T12:00:00Z") },
    { id: 15, userId: 20, signedAt: new Date("2026-01-04T12:00:00Z") },
    { id: 17, userId: 30, signedAt: new Date("2026-01-05T12:00:00Z") },
  ];
  return {
    agent_record_merges: [],
    join_sessions: variants.map(row => ({
      ...raw,
      ...row,
      contractSignedAt: row.signedAt,
      membershipType: "solo",
    })),
    prospects: variants.map(row => ({
      id: 1000 + row.id,
      linkedUserId: row.userId,
      email: "self@example.test",
      adminNotes: PRIVATE,
    })),
    prospect_contracts: variants.map(row => ({
      ...raw,
      ...row,
      prospectId: 1000 + row.id,
    })),
    contract_signatures: variants
      .filter(row => row.userId !== null)
      .map(row => ({ ...raw, ...row, contractTemplateId: 101 })),
    terms_signings: [
      ...variants
        .filter(row => row.userId !== null)
        .map(row => ({
          ...raw,
          ...row,
          termsVersionId: 101,
          signedName: "Original terms signer",
          signatureImage: PNG,
        })),
      {
        ...raw,
        id: 16,
        userId: 10,
        signedAt: new Date("2026-01-06T12:00:00Z"),
        termsVersionId: 404,
        signedName: "Deleted-version signer",
        signatureImage: PNG,
      },
    ],
    terms_versions: [
      {
        id: 101,
        versionLabel: "Historical version",
        documentUrl: `${STORAGE}/terms/historical.pdf`,
        description: PRIVATE,
      },
    ],
    contract_templates: [
      {
        id: 101,
        isActive: true,
        name: "CURRENT TEMPLATE MUST NOT BE READ",
        pdfUrl: `${STORAGE}/current.pdf`,
      },
    ],
  };
}

let adapter: ReturnType<typeof agreementDb>;
function caller(role: "agent" | "admin" = "agent", id = 10) {
  // createCaller bypasses HTTP createContext; supply an authenticated, active portal user.
  return myAgreementsRouter.createCaller({
    user: {
      id,
      role,
      email: "self@example.test",
      name: "Current account",
      isActive: true,
      portalStatus: "active",
    },
    req: {},
    res: {},
  } as TrpcContext);
}
const rowsFor = (source: AgreementSource) => adapter.tables[TABLES[source]];
const sourceReads = () =>
  adapter.reads.filter(read => Object.values(TABLES).includes(read.table));
const unavailable = {
  code: "INTERNAL_SERVER_ERROR",
  message: "Agreement records temporarily unavailable",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("S3_PUBLIC_URL", STORAGE);
  adapter = agreementDb(fixtures());
  mocks.getDb.mockResolvedValue(adapter.db);
  mocks.history.mockResolvedValue([10]);
});
afterEach(() => {
  for (const name of ["insert", "update", "delete", "execute"] as const)
    expect(adapter.db[name]).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});

describe("My Agreements executable ownership queries", () => {
  it.each(["agent", "admin"] as const)(
    "%s mine uses self ownership for all four sources, excludes unsigned and same-email records",
    async role => {
      const records = await caller(role).mine();
      expect(records.map(row => `${row.source}:${row.id}`).sort()).toEqual([
        "join:11",
        "legacy:11",
        "prospect:11",
        "terms:11",
        "terms:16",
      ]);
      expect(mocks.history).toHaveBeenCalledWith(10);
      expect(sourceReads()).toHaveLength(4);
      for (const source of AGREEMENT_SOURCES) {
        const read = sourceReads().find(read => read.table === TABLES[source])!;
        const owner =
          source === "prospect"
            ? "`prospects`.`linkedUserId`"
            : `\`${TABLES[source]}\`.\`userId\``;
        const date = source === "join" ? "contractSignedAt" : "signedAt";
        expect(read.where!.sql).toContain(`${owner} in (?)`);
        expect(read.where!.sql).toContain(
          `\`${TABLES[source]}\`.\`${date}\` is not null`
        );
        expect(read.where!.sql).not.toMatch(/email/i);
        expect(read.where!.params).toEqual([10]);
      }
    }
  );

  it.each(AGREEMENT_SOURCES)(
    "%s detail has ownership AND requested-ID SQL predicates",
    async source => {
      expect(await caller().detail({ source, id: 11 })).toMatchObject({
        source,
        id: 11,
        historicalAccount: false,
      });
      const read = sourceReads()[0];
      expect(sourceReads()).toHaveLength(1);
      expect(read.table).toBe(TABLES[source]);
      expect(read.where!.sql).toContain(`\`${TABLES[source]}\`.\`id\` = ?`);
      expect(read.where!.sql).toContain(
        source === "prospect"
          ? "`prospects`.`linkedUserId` in (?)"
          : `\`${TABLES[source]}\`.\`userId\` in (?)`
      );
      expect(read.where!.sql).toContain("is not null");
      expect(read.where!.params).toEqual([10, 11]);
    }
  );

  it.each(AGREEMENT_SOURCES)(
    "%s foreign, unsigned and unknown IDs are unavailable even for administrators",
    async source => {
      for (const id of [12, 13, 15, 999]) {
        await expect(
          caller("admin").detail({ source, id })
        ).rejects.toMatchObject({
          code: "NOT_FOUND",
          message: "Agreement record not found",
        });
      }
    }
  );

  it.each(["join", "prospect"] as const)(
    "%s same email without a durable user link grants no access",
    async source => {
      await expect(caller().detail({ source, id: 14 })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(sourceReads()[0].where!.sql).not.toMatch(/email/i);
      if (source === "prospect")
        expect(sourceReads()[0].joins).toEqual([
          expect.objectContaining({
            table: "prospects",
            kind: "inner",
            sql: "`prospect_contracts`.`prospectId` = `prospects`.`id`",
            params: [],
          }),
        ]);
    }
  );

  it("missing terms versions preserve signing evidence through a LEFT join, not a current document fallback", async () => {
    const record = await caller().detail({ source: "terms", id: 16 });
    expect(record).toMatchObject({
      signerName: "Deleted-version signer",
      signatureImage: PNG,
      signedAt: "2026-01-06T12:00:00.000Z",
      versionLabel: null,
      versionDocumentUrl: null,
      versionDocumentAvailable: false,
      snapshotAvailable: false,
      snapshotKind: null,
      snapshotHtml: null,
    });
    expect(sourceReads()[0].joins).toEqual([
      expect.objectContaining({
        table: "terms_versions",
        kind: "left",
        sql: "`terms_signings`.`termsVersionId` = `terms_versions`.`id`",
      }),
    ]);
  });

  it("legacy evidence never fabricates a snapshot, consent, hash, or current-template fallback", async () => {
    const record = await myAgreementDetail(10, "legacy", 11);
    expect(record).toMatchObject({
      signerName: "Original signer",
      signerAddress: "Original signed address",
      signatureImage: PNG,
      snapshotHtml: null,
      snapshotKind: null,
      snapshotAvailable: false,
      storedHash: null,
      consentConfirmed: null,
      signingDeviceRecorded: false,
      versionDocumentUrl: null,
    });
    expect(
      adapter.reads.some(read => read.table === "contract_templates")
    ).toBe(false);
    expect(sourceReads()[0].projection).not.toHaveProperty("snapshot");
  });

  it("labels team join agreements and retains the actual signed source content", async () => {
    rowsFor("join")[0].membershipType = "team_member";
    const record = await caller().detail({ source: "join", id: 11 });
    expect(record).toMatchObject({
      title: "Team agency agreement",
      signerName: "Original signer",
      signerAddress: "Original signed address",
      snapshotKind: "text_snapshot",
      storedHash: "a".repeat(64),
    });
    expect(record.snapshotHtml).toContain("Original signing terms");
    expect(record.snapshotHtml).not.toContain("CURRENT TEMPLATE");
  });

  it("version-linked terms PDFs are references rather than signing-time snapshots", async () => {
    expect(await myAgreementDetail(10, "terms", 11)).toMatchObject({
      versionLabel: "Historical version",
      versionDocumentUrl: `${STORAGE}/terms/historical.pdf`,
      versionDocumentAvailable: true,
      snapshotKind: null,
      snapshotHtml: null,
      snapshotAvailable: false,
      storedHash: null,
    });
  });

  it("stored hash remains an unverified stored reference when display HTML is sanitized", async () => {
    rowsFor("join")[0].contractTextSnapshot =
      '<p onclick="steal()">Saved terms</p><script>steal()</script>';
    const record = await myAgreementDetail(10, "join", 11);
    expect(record.snapshotHtml).toBe("<p>Saved terms</p>");
    expect(record.storedHash).toBe("a".repeat(64));
    expect(record).not.toHaveProperty("hashVerified");
  });

  it("PDF-link acknowledgments are classified as document references", async () => {
    rowsFor("prospect")[0].contractTextSnapshot =
      `<p>I acknowledge the <a href="${STORAGE}/saved.pdf">saved agreement</a>.</p>`;
    expect(await myAgreementDetail(10, "prospect", 11)).toMatchObject({
      snapshotKind: "document_reference",
      snapshotAvailable: true,
    });
  });

  it("prospect trusted stored signatures display, but foreign signature origins never do", async () => {
    rowsFor("prospect")[0].signatureDataUrl = SIGNATURE_URL;
    expect(await myAgreementDetail(10, "prospect", 11)).toMatchObject({
      signatureAvailable: true,
      signatureImage: SIGNATURE_URL,
    });
    rowsFor("prospect")[0].signatureDataUrl =
      "https://foreign.example.test/crm/contracts/signatures/signer.png";
    expect(await myAgreementDetail(10, "prospect", 11)).toMatchObject({
      signatureAvailable: false,
      signatureImage: null,
    });
    rowsFor("join")[0].signatureDataUrl = SIGNATURE_URL;
    expect(await myAgreementDetail(10, "join", 11)).toMatchObject({
      signatureAvailable: false,
      signatureImage: null,
    });
  });

  it("DTOs project only public evidence fields and presence flags, never tokens/payments/notes/raw IP or UA", async () => {
    const summaryKeys = [
      "source",
      "id",
      "reference",
      "title",
      "signerName",
      "signedAt",
      "versionLabel",
      "snapshotAvailable",
      "snapshotKind",
      "signatureAvailable",
      "versionDocumentAvailable",
      "historicalAccount",
    ].sort();
    const detailKeys = [
      ...summaryKeys,
      "signerAddress",
      "signatureImage",
      "snapshotHtml",
      "consentConfirmed",
      "signingIpRecorded",
      "signingDeviceRecorded",
      "storedHash",
      "versionDocumentUrl",
    ].sort();
    const summaries = await myAgreementSummaries(10);
    for (const summary of summaries)
      expect(Object.keys(summary).sort()).toEqual(summaryKeys);
    for (const source of AGREEMENT_SOURCES) {
      const detail = await myAgreementDetail(10, source, 11);
      expect(Object.keys(detail).sort()).toEqual(detailKeys);
      expect(detail.signingIpRecorded).toBe(true);
      expect(detail.signingDeviceRecorded).toBe(source !== "legacy");
      expect(JSON.stringify(detail)).not.toContain(PRIVATE);
      const projection = sourceReads()
        .filter(read => read.table === TABLES[source])
        .at(-1)!.projection;
      for (const key of [
        "signingToken",
        "sessionToken",
        "billingRequestId",
        "mandateId",
        "adminNotes",
        "notes",
        "ipAddress",
        "signingIp",
        "userAgent",
        "signingUserAgent",
      ]) {
        expect(projection).not.toHaveProperty(key);
      }
    }
    expect(JSON.stringify(summaries)).not.toContain(PRIVATE);
  });

  it("NULL and blank signing metadata produce false presence flags", async () => {
    Object.assign(rowsFor("join")[0], {
      ipAddress: "  ",
      signingUserAgent: null,
    });
    expect(await myAgreementDetail(10, "join", 11)).toMatchObject({
      signingIpRecorded: false,
      signingDeviceRecorded: false,
    });
  });

  it.each(AGREEMENT_SOURCES)(
    "%s malformed owned signedAt fails safely rather than displaying an empty history",
    async source => {
      rowsFor(source)[0][source === "join" ? "contractSignedAt" : "signedAt"] =
        "not-a-date";
      await expect(myAgreementSummaries(10)).rejects.toMatchObject(unavailable);
      await expect(myAgreementDetail(10, source, 11)).rejects.toMatchObject(
        unavailable
      );
    }
  );

  it("foreign malformed dates do not poison a caller's valid records", async () => {
    rowsFor("join")[1].contractSignedAt = "not-a-date";
    expect(await myAgreementSummaries(10)).toHaveLength(5);
  });

  it("sorts newest first with deterministic source and descending-ID tie breakers", async () => {
    rowsFor("join").push({ ...rowsFor("join")[0], id: 18 });
    const records = await myAgreementSummaries(10);
    expect(records.map(row => `${row.source}:${row.id}`)).toEqual([
      "terms:16",
      "join:18",
      "join:11",
      "prospect:11",
      "legacy:11",
      "terms:11",
    ]);
  });
});

describe("independently verified merge ownership", () => {
  function merged() {
    adapter.tables.agent_record_merges.push(
      { sourceUserId: 20, primaryUserId: 10 },
      { sourceUserId: 30, primaryUserId: 20 },
      { sourceUserId: 40, primaryUserId: 50 }
    );
    mocks.history.mockResolvedValue([30, 10, 20]);
    for (const source of AGREEMENT_SOURCES) {
      const historical = rowsFor(source).find(row => row.id === 17)!;
      historical.signerName = "Archived original signer";
      historical.signedName = "Archived original terms signer";
      historical.signerAddress = "Archived signing address";
      historical.contractTextSnapshot =
        "<p>Archived original signing terms</p>";
    }
  }

  it("includes only verified transitive archived ownership while retaining original source and signer", async () => {
    merged();
    const records = await caller().mine();
    expect(records).toHaveLength(13);
    for (const source of AGREEMENT_SOURCES) {
      expect(
        records.find(row => row.source === source && row.id === 15)
      ).toMatchObject({ historicalAccount: true });
      const detail = await caller().detail({ source, id: 17 });
      expect(detail).toMatchObject({
        source,
        id: 17,
        historicalAccount: true,
        reference: `JLT-${source.toUpperCase()}-17`,
      });
      expect(detail.signerName).toBe(
        source === "terms"
          ? "Archived original terms signer"
          : "Archived original signer"
      );
      if (source !== "terms")
        expect(detail.signerAddress).toBe("Archived signing address");
      if (source === "join" || source === "prospect")
        expect(detail.snapshotHtml).toBe(
          "<p>Archived original signing terms</p>"
        );
      const read = sourceReads()
        .filter(read => read.table === TABLES[source])
        .at(-1)!;
      expect(read.where!.params).toEqual([10, 20, 30, 17]);
      expect(read.where!.sql).toContain("in (?, ?, ?)");
    }
    const identityReads = adapter.reads.filter(
      read => read.table === "agent_record_merges"
    );
    expect(identityReads[0].where).toMatchObject({
      sql: "`agent_record_merges`.`sourceUserId` = ?",
      params: [10],
    });
    expect(
      identityReads.some(
        read =>
          read.where?.sql.includes("`primaryUserId` in (?)") &&
          read.where.params[0] === 20
      )
    ).toBe(true);
  });

  it("archived authenticated callers are forbidden, not silently upgraded to the primary account", async () => {
    merged();
    await expect(caller("agent", 20).mine()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Archived accounts cannot access agreement records",
    });
    expect(mocks.history).not.toHaveBeenCalled();
    expect(sourceReads()).toHaveLength(0);
  });

  it.each([
    { name: "unrelated ID", history: [10, 99] },
    { name: "duplicate ID", history: [10, 10] },
    { name: "missing current ID", history: [] },
    { name: "string ID", history: [10, "20"] },
    { name: "invalid zero ID", history: [0, 10] },
    { name: "non-array result", history: null },
  ])(
    "rejects $name in unverified/conflicting helper history",
    async ({ history }) => {
      mocks.history.mockResolvedValue(history);
      await expect(myAgreementSummaries(10)).rejects.toMatchObject(unavailable);
      expect(sourceReads()).toHaveLength(0);
    }
  );

  it("verified local merge rows and helper history must independently agree", async () => {
    merged();
    mocks.history.mockResolvedValue([10, 20]);
    await expect(myAgreementSummaries(10)).rejects.toMatchObject(unavailable);
    expect(sourceReads()).toHaveLength(0);
  });

  it("duplicate/conflicting rows inside the caller's verified graph fail closed", async () => {
    merged();
    adapter.tables.agent_record_merges.push({
      sourceUserId: 20,
      primaryUserId: 30,
    });
    await expect(myAgreementSummaries(10)).rejects.toMatchObject(unavailable);
    expect(sourceReads()).toHaveLength(0);
  });

  it.each([
    "Invalid agent merge identity history",
    "Cycle in agent merge identity history",
  ])(
    "unrelated global corruption (%s) cannot broaden independently scoped history",
    async message => {
      merged();
      // Global helper sees an unrelated graph cycle; scoped queries never traverse it.
      adapter.tables.agent_record_merges.push({
        sourceUserId: 50,
        primaryUserId: 40,
      });
      mocks.history.mockRejectedValue(new Error(message));
      const records = await myAgreementSummaries(10);
      expect(records).toHaveLength(13);
      expect(records.some(row => row.id === 12 || row.id === 14)).toBe(false);
      for (const read of sourceReads())
        expect(read.where!.params).toEqual([10, 20, 30]);
    }
  );

  it("unrelated IDs from a successful global helper fail closed even if they share email", async () => {
    merged();
    mocks.history.mockResolvedValue([10, 20, 99]);
    await expect(myAgreementDetail(10, "join", 12)).rejects.toMatchObject(
      unavailable
    );
    expect(sourceReads()).toHaveLength(0);
  });
});

describe("real My Agreements router validation and safe errors", () => {
  it("a genuinely empty self-owned history is distinct from unavailable evidence", async () => {
    for (const source of AGREEMENT_SOURCES) adapter.tables[TABLES[source]] = [];
    expect(await caller().mine()).toEqual([]);
    await expect(
      caller().detail({ source: "join", id: 11 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("mine accepts omitted/undefined input only", async () => {
    expect(await caller().mine(undefined)).toHaveLength(5);
    for (const input of [
      null,
      {},
      { ownerId: 99 },
      { userId: 99 },
      { email: "self@example.test" },
      99,
    ]) {
      await expect(caller().mine(input as never)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
  });

  it("detail strictly accepts source/id, never owner/userId/email overrides", async () => {
    for (const input of [
      { source: "join", id: 11, userId: 99 },
      { source: "join", id: 11, ownerId: 99 },
      { source: "join", id: 11, email: "self@example.test" },
      { source: "other", id: 11 },
      { source: "join", id: 0 },
      { source: "join", id: -1 },
      { source: "join", id: 1.5 },
      { source: "join", id: "11" },
      { source: "join" },
      null,
    ])
      await expect(caller().detail(input as never)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("anonymous callers are rejected before any database access", async () => {
    const anonymous = myAgreementsRouter.createCaller({
      user: null,
      req: {},
      res: {},
    } as TrpcContext);
    await expect(anonymous.mine()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonymous.detail({ source: "join", id: 11 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
    "invalid current identity %s fails closed",
    async id => {
      await expect(myAgreementSummaries(id)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "A current account is required",
      });
      expect(adapter.reads).toHaveLength(0);
    }
  );

  it("missing DB fails with a safe unavailable response, not an empty list", async () => {
    mocks.getDb.mockResolvedValue(null);
    await expect(caller().mine()).rejects.toMatchObject(unavailable);
  });

  it.each(["connection", "merge helper", "agreement query"])(
    "unexpected %s SQL errors retain no raw message or cause",
    async point => {
      const rawError = new Error(
        `SELECT secretToken FROM users WHERE email='${PRIVATE}'; access denied`
      );
      if (point === "connection") mocks.getDb.mockRejectedValue(rawError);
      if (point === "merge helper") mocks.history.mockRejectedValue(rawError);
      if (point === "agreement query") {
        const original = adapter.db.select.bind(adapter.db);
        vi.spyOn(adapter.db, "select").mockImplementation(projection => {
          if ("signedAt" in projection) throw rawError;
          return original(projection);
        });
      }
      const error = await caller()
        .mine()
        .catch(error => error);
      expect(error).toMatchObject(unavailable);
      expect(error.cause).toBeUndefined();
      expect(error.message).not.toContain(PRIVATE);
      expect(JSON.stringify(error)).not.toContain(PRIVATE);
    }
  );

  it("detail failures also discard raw SQL errors and nested causes", async () => {
    const rawError = new Error(`SQL parameters: ${PRIVATE}`, {
      cause: new Error(`credentials: ${PRIVATE}`),
    });
    mocks.getDb.mockRejectedValue(rawError);
    const error = await caller()
      .detail({ source: "prospect", id: 11 })
      .catch(error => error);
    expect(error).toMatchObject(unavailable);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(PRIVATE);
  });
});
