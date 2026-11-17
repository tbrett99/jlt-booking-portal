import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  agentCrmProfiles, agentRecordMerges, agentSupplierStages, businessStaffMemberships,
  knowledgeBaseArticles, libraryContentActivity, libraryResources, staffRoleAssignments,
  supplierAttachments, suppliers, users, webinarLibraryItems, type User,
} from "../drizzle/schema";
import {
  BUSINESS_STAFF_PERMISSION_KEYS, BUSINESS_STAFF_PERMISSION_LABELS,
  DEFAULT_BUSINESS_STAFF_PERMISSIONS, readBusinessStaffPermissions,
} from "../shared/business-staff";
import type { TrpcContext } from "./_core/context";

const external = vi.hoisted(() => ({
  getDb: vi.fn(), award: vi.fn(), email: vi.fn(), model: vi.fn(), storage: vi.fn(), forbiddenResolver: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: external.getDb, getRawDbPool: () => { throw new Error("Live DB forbidden"); }, createInAppNotification: () => { throw new Error("Notifications forbidden"); } }));
vi.mock("./email", () => ({ sendDirectEmail: external.email }));
vi.mock("./momentum", () => ({ awardMomentum: external.award }));
vi.mock("./storage", () => ({ storagePut: external.storage }));
vi.mock("./_core/llm", () => ({ invokeLLM: external.model }));
import { assertBusinessStaffRouteAllowed, getBusinessStaffAuthority } from "./business-staff-access";
import { permissionsInput } from "./business-staff-management";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { suppliersRouter } from "./suppliers-router";
import { libraryRouter } from "./library-router";

const epoch = new Date("2026-01-01T00:00:00.000Z");
const legacy = { viewBookings: true, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: true };
const RESOURCE_PATHS = [
  "library.browse", "library.article", "library.webinar", "library.recordView", "library.markCompleted",
  "suppliers.list", "suppliers.get", "suppliers.categories", "suppliers.locations", "suppliers.preferredPartners", "suppliers.listAttachments",
];
const privateSupplierKeys = ["agencyId", "loginUsername", "loginPassword", "adminUsername", "adminPassword", "adminNotes", "loginRequestNotes"];
type Row = Record<string, any>;
function syntheticUser(id = 20): User {
  return {
    id, openId: `synthetic-${id}`, name: `Synthetic ${id}`, email: `synthetic-${id}@example.test`,
    role: "agent", isActive: true, portalStatus: "active", loginMethod: "password", mustChangePassword: false,
    tempPassword: "SYNTHETIC-HASH", phone: null, credentialsSentAt: null, crmAccess: false, crmEmail: null,
    commissionRatePct: 83, suspendedAt: null, suspensionReason: null, createdAt: epoch, updatedAt: epoch, lastSignedIn: epoch,
  };
}
const dialect = new MySqlDialect();

/** A deliberately small in-memory evaluator for the actual Drizzle predicates.
 * Unknown tables, operators, computed selects and all non-learning writes fail.
 * This never initializes a pool, calls a model/provider or uses network/storage. */
function fixture() {
  const baseSupplier: Row = {
    id: 1, name: "Synthetic Public Supplier", description: "Public description", shortDescription: "Short public info",
    publicWebsite: "https://supplier.example.test", tradeWebsite: "https://trade.example.test", additionalWebsite: null,
    commission: "Published general policy: 10%", accountManager: "Public Manager", phone: "0123456789", email: "trade@example.test",
    outOfHoursContactName: "Emergency Desk", outOfHoursPhone: "0987654321", outOfHoursEmail: "urgent@example.test", outOfHoursNotes: "Urgent travel only",
    generalNotes: "Agent-facing booking notes", video1: "https://video.example.test/public", video2: null, video3: null, video4: null, video5: null,
    categories: "Tours;Luxury", locations: "France;UK", imageUrl: null, credentialStage: 1, isActive: 1, sortOrder: 1,
    usp: "Public selling points", priceTier: "luxury", notSuitableFor: null, preferredContact: "email", aiSummary: "Existing public summary",
    idealClient: "Couples", bookingTips: "Public booking tips", aiEnrichedAt: null, requiresLoginRequest: true,
    isPreferredPartner: true, preferredPartnerNote: "Published partner terms", facebookUrl: null, instagramUrl: null, mediaAssetsUrl: null,
    createdAt: epoch, updatedAt: epoch,
    ...Object.fromEntries(privateSupplierKeys.map(key => [key, `SYNTHETIC-PRIVATE-${key}`])), futurePrivateColumn: "SYNTHETIC-PRIVATE-future",
  };
  const baseContent: Row = { id: 101, title: "Published Fees", summary: "Published customer fees", category: "Fees", tags: ["fees"], contentHtml: "<p>Public fees: £25</p>", status: "published", isFeatured: false, publishedAt: epoch };
  const rows = new Map<unknown, Row[]>([
    [users, [syntheticUser(10), syntheticUser()]],
    [businessStaffMemberships, [{ id: 50, ownerUserId: 10, staffUserId: 20, status: "active", revision: 1, permissions: { ...legacy }, orbitRequested: false }]],
    [agentCrmProfiles, [{ id: 80, userId: 10, agentStatus: "active", bankAccountNumber: "SYNTHETIC-PRIVATE-OWNER-BANK" }]],
    [agentRecordMerges, []], [staffRoleAssignments, []],
    [agentSupplierStages, [{ id: 60, userId: 20, stage: 3 }, { id: 61, userId: 10, stage: 3 }]],
    [suppliers, [baseSupplier, { ...baseSupplier, id: 2, name: "Inactive", isActive: 0, categories: "PrivateCategory", locations: "PrivateLocation" }, { ...baseSupplier, id: 3, name: "Not preferred", isPreferredPartner: false, credentialStage: 3 }]],
    [supplierAttachments, [{ id: 70, supplierId: 1, fileName: "Published brochure.pdf", fileUrl: "https://files.example.test/brochure.pdf", fileKey: "SYNTHETIC-PRIVATE-KEY", fileSize: 1500, uploadedAt: epoch, uploadedById: 10 }]],
    [knowledgeBaseArticles, [baseContent, { ...baseContent, id: 102, title: "Draft fees", category: "Private draft category", status: "draft" }, { ...baseContent, id: 103, title: "Archived fees", status: "archived" }]],
    [webinarLibraryItems, [
      { ...baseContent, id: 201, title: "Published Webinar", category: "Training", videoUrl: "https://video.example.test/recording", privateTranscript: "SYNTHETIC-PRIVATE-TRANSCRIPT" },
      { ...baseContent, id: 202, title: "Unpublished Webinar", status: "draft", privateTranscript: "SYNTHETIC-PRIVATE-DRAFT-TRANSCRIPT" },
      { ...baseContent, id: 203, title: "Archived Webinar", status: "archived", privateTranscript: "SYNTHETIC-PRIVATE-ARCHIVED-TRANSCRIPT" },
    ]],
    [libraryResources, [{ id: 301, contentType: "article", contentId: 101, title: "Published fee schedule", fileUrl: "https://files.example.test/fees.pdf" }]],
    [libraryContentActivity, [
      { id: 401, userId: 10, contentType: "article", contentId: 101, completedAt: epoch, privateOwnerActivity: "SYNTHETIC-PRIVATE-OWNER-ACTIVITY" },
      { id: 402, userId: 20, contentType: "article", contentId: 101, completedAt: null, firstViewedAt: epoch },
    ]],
  ]);
  const reads: Array<{ table: unknown; fields?: Row; sql: string; params: unknown[] }> = [];
  const writes: Array<{ table: unknown; values: Row; update: Row }> = [];
  const tableRows = (table: unknown) => {
    const result = rows.get(table);
    if (!result) throw new Error("Unknown/financial/provider table forbidden");
    return result;
  };
  const predicate = (table: unknown, condition: SQL) => {
    const query = dialect.sqlToQuery(condition);
    const tokens = query.sql.match(/`[^`]+`\.`[^`]+`|\?|\(|\)|=|,|\b(?:and|or|in|like)\b/gi) ?? [];
    let index = 0, param = 0;
    const atom = (): ((row: Row) => boolean) => {
      if (tokens[index] === "(") { index++; const result = expression(); if (tokens[index++] !== ")") throw new Error("Unsupported predicate grouping"); return result; }
      const column = /^`([^`]+)`\.`([^`]+)`$/.exec(tokens[index++] ?? "");
      if (!column || column[1] !== getTableName(table as any)) throw new Error("Unexpected predicate column/table");
      const op = tokens[index++]?.toLowerCase();
      if (op === "in") {
        if (tokens[index++] !== "(") throw new Error("Unsupported IN");
        const expected: unknown[] = [];
        do { if (tokens[index++] !== "?") throw new Error("Unsupported IN value"); expected.push(query.params[param++]); } while (tokens[index] === "," && ++index);
        if (tokens[index++] !== ")") throw new Error("Unsupported IN end");
        return row => expected.includes(row[column[2]]);
      }
      if (tokens[index++] !== "?") throw new Error("Unsupported comparison value");
      const expected = query.params[param++];
      if (op === "=") return row => row[column[2]] === expected;
      if (op === "like") {
        const pattern = String(expected).split("%").map(piece => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*").replace(/_/g, ".");
        return row => new RegExp(`^${pattern}$`, "i").test(String(row[column[2]] ?? ""));
      }
      throw new Error("Unsupported predicate operator");
    };
    const conjunction = (): ((row: Row) => boolean) => {
      let left = atom();
      while (tokens[index]?.toLowerCase() === "and") { index++; const previous = left, right = atom(); left = row => previous(row) && right(row); }
      return left;
    };
    const expression = (): ((row: Row) => boolean) => {
      let left = conjunction();
      while (tokens[index]?.toLowerCase() === "or") { index++; const previous = left, right = conjunction(); left = row => previous(row) || right(row); }
      return left;
    };
    const result = expression();
    if (index !== tokens.length || param !== query.params.length) throw new Error("Incomplete predicate evaluation");
    return { ...query, test: result };
  };
  const project = (row: Row, fields?: Row) => fields ? Object.fromEntries(Object.entries(fields).map(([key, column]) => {
    if (column instanceof SQL) {
      const { sql, params } = dialect.sqlToQuery(column);
      if (params.length) throw new Error("Unknown projected SQL parameters");
      if (sql === "NULL") return [key, null];
      if (sql === "false") return [key, false];
      if (sql === "3") return [key, 3];
      throw new Error(`Unsafe projected SQL: ${sql}`);
    }
    if (column.table !== undefined && column.table !== tableForColumn(column)) throw new Error("Unknown projected table");
    return [key, row[column.name]];
  })) : { ...row };
  const tableForColumn = (column: any) => [...rows.keys()].find(table => table === column.table);
  const db = {
    select: vi.fn((fields?: Row) => {
      let table: unknown, condition: SQL | undefined, max = Infinity, offset = 0;
      const chain = {
        from(value: unknown) { table = value; tableRows(table); return chain; },
        where(value: SQL) { condition = value; return chain; },
        orderBy(..._args: unknown[]) { return chain; },
        limit(value: number) { max = value; return chain; },
        offset(value: number) { offset = value; return chain; },
        then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve().then(() => {
            if (!condition) throw new Error("Unbounded resource/authority read forbidden");
            const check = predicate(table, condition); reads.push({ table, fields, sql: check.sql, params: check.params });
            const filtered = tableRows(table).filter(check.test);
            if (fields?.count instanceof SQL && dialect.sqlToQuery(fields.count).sql === "COUNT(*)") return [{ count: filtered.length }];
            return filtered.slice(offset, offset + max).map(row => project(row, fields));
          }).then(resolve, reject);
        },
      };
      return chain;
    }),
    insert: vi.fn((table: unknown) => {
      if (table !== libraryContentActivity) throw new Error("Non-learning writes forbidden");
      return { values: (values: Row) => ({ onDuplicateKeyUpdate: async ({ set }: { set: Row }) => {
        writes.push({ table, values: { ...values }, update: { ...set } });
        const found = tableRows(table).find(row => row.userId === values.userId && row.contentType === values.contentType && row.contentId === values.contentId);
        if (found) Object.assign(found, set); else tableRows(table).push({ ...values });
      } }) };
    }),
    execute: () => { throw new Error("Raw SQL forbidden"); }, update: () => { throw new Error("Updates forbidden"); }, delete: () => { throw new Error("Deletes forbidden"); },
  };
  external.getDb.mockResolvedValue(db);
  return { rows, reads, writes, db, member: tableRows(businessStaffMemberships)[0], people: tableRows(users) };
}
const scope = router({
  suppliers: suppliersRouter, library: libraryRouter,
  finance: router({ summary: protectedProcedure.query(external.forbiddenResolver) }),
  commissionClaims: router({ claim: protectedProcedure.mutation(external.forbiddenResolver) }),
  payments: router({ create: protectedProcedure.mutation(external.forbiddenResolver) }),
  crm: router({ getSsoUrl: protectedProcedure.query(external.forbiddenResolver) }),
  globalSearch: publicProcedure.query(external.forbiddenResolver),
});
const caller = (user = syntheticUser()) => scope.createCaller({ user, req: { headers: {} }, res: {} } as TrpcContext);
const resourceReads = (f: ReturnType<typeof fixture>) => f.reads.filter(read => [suppliers, supplierAttachments, knowledgeBaseArticles, webinarLibraryItems, libraryResources, libraryContentActivity].includes(read.table as any));
function expectSafeSupplier(supplier: Row) {
  for (const key of privateSupplierKeys) expect(supplier[key]).toBeNull();
  expect(supplier.requiresLoginRequest).toBe(false);
  expect(supplier).not.toHaveProperty("futurePrivateColumn");
  expect(JSON.stringify(supplier)).not.toMatch(/SYNTHETIC-PRIVATE/);
  expect(supplier).toMatchObject({ commission: "Published general policy: 10%", tradeWebsite: "https://trade.example.test", outOfHoursContactName: "Emergency Desk", outOfHoursPhone: "0987654321", outOfHoursEmail: "urgent@example.test", outOfHoursNotes: "Urgent travel only", generalNotes: "Agent-facing booking notes", video1: "https://video.example.test/public" });
}
beforeEach(() => {
  vi.clearAllMocks();
  external.getDb.mockImplementation(() => { throw new Error("Live DB forbidden without fixture"); });
  for (const spy of [external.email, external.model, external.storage, external.forbiddenResolver]) spy.mockImplementation(() => { throw new Error("External/forbidden operation reached"); });
  external.award.mockResolvedValue({ awarded: true, points: 5 });
});
afterEach(() => {
  expect(external.email).not.toHaveBeenCalled(); expect(external.model).not.toHaveBeenCalled();
  expect(external.storage).not.toHaveBeenCalled(); expect(external.forbiddenResolver).not.toHaveBeenCalled();
});

describe("resourceAccess shared and strict management compatibility", () => {
  it("exports the permission, label and new default", () => {
    expect(BUSINESS_STAFF_PERMISSION_KEYS).toContain("resourceAccess");
    expect(DEFAULT_BUSINESS_STAFF_PERMISSIONS.resourceAccess).toBe(true);
    expect(BUSINESS_STAFF_PERMISSION_LABELS.resourceAccess).toMatch(/no supplier credentials or owner finances/);
  });
  it.each([legacy, JSON.stringify(legacy), { ...legacy, viewBookings: false, academyAccess: false }])("grants resources to complete four-boolean legacy object %j", value => {
    expect(readBusinessStaffPermissions(value).resourceAccess).toBe(true);
  });
  it.each([false, true])("honors explicit resourceAccess=%s in object and JSON", resourceAccess => {
    for (const value of [{ ...legacy, resourceAccess }, JSON.stringify({ ...legacy, resourceAccess })]) {
      expect(readBusinessStaffPermissions(value)).toEqual({ ...legacy, resourceAccess });
    }
  });
  it.each([null, [], "bad-json", {}, { viewBookings: true }, { ...legacy, academyAccess: 1 }, { ...legacy, admin: false }, { ...legacy, resourceAccess: "true" }, { ...legacy, resourceAccess: true, unknown: false }, { resourceAccess: true }])("never derives resources from malformed or partial %j", value => {
    expect(readBusinessStaffPermissions(value).resourceAccess).toBe(false);
  });
  it("preserves the original exact-true and booking dependency behavior", () => {
    expect(readBusinessStaffPermissions({ viewBookings: true, academyAccess: true, unknown: 1 })).toEqual({ viewBookings: true, academyAccess: true, viewCustomerAmounts: false, addBookingNotes: false, resourceAccess: false });
    expect(readBusinessStaffPermissions({ ...legacy, viewBookings: false, viewCustomerAmounts: true, addBookingNotes: true })).toEqual({ viewBookings: false, viewCustomerAmounts: false, addBookingNotes: false, academyAccess: true, resourceAccess: true });
  });
  it("management defaults omitted resourceAccess true and retains explicit false", () => {
    expect(permissionsInput.parse(legacy)).toEqual({ ...legacy, resourceAccess: true });
    expect(permissionsInput.parse({ ...legacy, resourceAccess: false })).toEqual({ ...legacy, resourceAccess: false });
  });
  it.each([{ ...legacy, unknown: true }, { ...legacy, resourceAccess: "false" }, { viewBookings: true }, { ...legacy, viewBookings: false, viewCustomerAmounts: true }])("strict management rejects %j before storage", value => {
    expect(permissionsInput.safeParse(value).success).toBe(false); expect(external.getDb).not.toHaveBeenCalled();
  });
});

describe("actual global route boundary and fresh resource entitlement", () => {
  it("allows exactly the requested resource paths, not namespace/prefix variants", async () => {
    fixture();
    for (const path of RESOURCE_PATHS) await expect(assertBusinessStaffRouteAllowed(syntheticUser(), path)).resolves.toBeUndefined();
    for (const path of ["library", "library.admin.overview", "library.article.extra", "library.future", "suppliers", "suppliers.list.extra", "suppliers.dropdown", "suppliers.getMyLoginRequests", "suppliers.requestLogin", "suppliers.getAgentStage", "suppliers.getAgentStageFor", "suppliers.allAgentStages", "suppliers.setAgentStage", "suppliers.aiSearch", "suppliers.aiChat", "suppliers.create", "suppliers.update", "suppliers.scrapeWebsite", "crm.getSsoUrl", "globalSearch", "finance.summary", "commissionClaims.claim", "payments.create"]) {
      await expect(assertBusinessStaffRouteAllowed(syntheticUser(), path)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("every existing supplier/library procedure outside the exact resource allowlist remains denied by the actual factories", async () => {
    fixture();
    for (const namespace of ["suppliers", "library"] as const) {
      const procedures = namespace === "suppliers" ? suppliersRouter._def.procedures : libraryRouter._def.procedures;
      for (const path of Object.keys(procedures)) {
        if (RESOURCE_PATHS.includes(`${namespace}.${path}`)) continue;
        let method: any = caller()[namespace];
        for (const segment of path.split(".")) method = method[segment];
        await expect(method({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
  });
  it.each(["revoked", "permission_false", "malformed", "owner_inactive", "password_setup"])("denies every resource path when %s and reads no resource tables", async change => {
    const f = fixture();
    if (change === "revoked") f.member.status = "revoked";
    if (change === "permission_false") f.member.permissions = { ...legacy, resourceAccess: false };
    if (change === "malformed") f.member.permissions = { viewBookings: true, resourceAccess: true };
    if (change === "owner_inactive") f.people[0].isActive = false;
    if (change === "password_setup") f.people[1].mustChangePassword = true;
    for (const path of RESOURCE_PATHS) await expect(assertBusinessStaffRouteAllowed(syntheticUser(), path)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().suppliers.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().library.browse()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().library.markCompleted({ contentType: "article", contentId: 101 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(resourceReads(f)).toEqual([]); expect(f.writes).toEqual([]); expect(external.award).not.toHaveBeenCalled();
  });
  it("the same caller immediately loses resources on explicit permission removal and retained revocation", async () => {
    const f = fixture(), api = caller();
    await expect(api.suppliers.get({ id: 1 })).resolves.toMatchObject({ id: 1 });
    f.member.permissions = { ...legacy, resourceAccess: false };
    await expect(api.suppliers.get({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.member.permissions.resourceAccess = true; f.member.status = "revoked";
    await expect(api.library.browse()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await getBusinessStaffAuthority(syntheticUser())).toMatchObject({ managed: true, active: false });
  });
  it("published resource access does not grant finance, payment, commission, CRM or global search", async () => {
    fixture(); const api = caller();
    for (const run of [() => api.finance.summary(), () => api.commissionClaims.claim(), () => api.payments.create(), () => api.crm.getSsoUrl(), () => api.globalSearch()]) await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("actual supplier resource reads use safe positive projections", () => {
  it.each([1, 3])("stage-3 staff cannot see credentials even when supplier credentialStage=%i", async credentialStage => {
    const f = fixture(); f.rows.get(suppliers)![0].credentialStage = credentialStage;
    const api = caller(), list = await api.suppliers.list({}), preferred = await api.suppliers.preferredPartners(), detail = await api.suppliers.get({ id: 1 });
    expect(list.agentStage).toBe(0); expect(list.total).toBe(2); expect(list.suppliers.map(s => s.id)).toEqual([1, 3]);
    expect(preferred.map(s => s.id)).toEqual([1]);
    for (const row of [...list.suppliers, ...preferred, detail]) expectSafeSupplier(row);
    expect(f.reads.some(read => read.table === agentSupplierStages)).toBe(false);
    const supplierRows = f.reads.filter(read => read.table === suppliers && !read.fields?.count);
    expect(supplierRows).toHaveLength(3);
    for (const read of supplierRows) {
      expect(read.fields).toBeDefined();
      for (const key of [...privateSupplierKeys, "credentialStage", "requiresLoginRequest"]) {
        expect(read.fields![key]).toBeInstanceOf(SQL);
        expect(dialect.sqlToQuery(read.fields![key]).sql).not.toMatch(/`suppliers`/);
      }
      expect(Object.values(read.fields!).some(column => column === (suppliers as any).futurePrivateColumn)).toBe(false);
      expect(read.sql).toContain("`suppliers`.`isActive` = ?");
    }
  });
  it("detail and document routes reject inactive/nonexistent suppliers; filters/categories/locations only expose active data", async () => {
    const f = fixture(), api = caller();
    for (const id of [2, 999]) {
      await expect(api.suppliers.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(api.suppliers.listAttachments({ supplierId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await api.suppliers.categories()).toEqual(["Luxury", "Tours"]);
    expect(await api.suppliers.locations()).toEqual(["France", "UK"]);
    expect((await api.suppliers.list({ search: "Public Supplier", category: "Tours", location: "France", pageSize: 1 })).suppliers.map(s => s.id)).toEqual([1]);
    expect((await api.suppliers.list({ page: 2, pageSize: 1 })).suppliers.map(s => s.id)).toEqual([3]);
    expect(f.reads.filter(read => read.table === suppliers && read.fields?.categories && Object.keys(read.fields).length === 1)[0].params).toEqual([1]);
  });
  it("agent-visible attachments retain document metadata but never select/return private keys or uploader IDs", async () => {
    const f = fixture(), attachments = await caller().suppliers.listAttachments({ supplierId: 1 });
    expect(attachments).toEqual([{ id: 70, fileName: "Published brochure.pdf", fileUrl: "https://files.example.test/brochure.pdf", fileKey: null, fileSize: 1500, uploadedAt: epoch, uploadedById: null }]);
    const read = f.reads.find(read => read.table === supplierAttachments)!;
    expect(dialect.sqlToQuery(read.fields!.fileKey).sql).toBe("NULL");
    expect(dialect.sqlToQuery(read.fields!.uploadedById).sql).toBe("NULL");
  });
  it("ordinary stage-3 agents retain existing credentials under their own ID, not an owner's stage", async () => {
    const f = fixture(); f.rows.set(businessStaffMemberships, []);
    const result = await caller().suppliers.get({ id: 1 });
    expect(result.loginUsername).toBe("SYNTHETIC-PRIVATE-loginUsername");
    expect(result.loginPassword).toBe("SYNTHETIC-PRIVATE-loginPassword");
    expect(result.agencyId).toBe("SYNTHETIC-PRIVATE-agencyId");
    expect(result.adminPassword).toBeNull();
    expect(f.reads.find(read => read.table === agentSupplierStages)?.params).toEqual([20]);
  });
});

describe("actual library published-only visibility and self-owned activity", () => {
  it("browse and detail expose published KB fees/webinars, no draft/archived/private transcript or owner activity", async () => {
    fixture(); const api = caller(), browse = await api.library.browse();
    expect(browse.articles.map(item => item.id)).toEqual([101]); expect(browse.webinars.map(item => item.id)).toEqual([201]);
    expect(browse.categories).toEqual(["Fees", "Training"]);
    expect(browse.articles[0].activity).toMatchObject({ userId: 20 });
    const article = await api.library.article({ id: 101 }), webinar = await api.library.webinar({ id: 201 });
    expect(article.resources[0]).toMatchObject({ title: "Published fee schedule" }); expect(article.activity?.userId).toBe(20);
    expect(webinar).not.toHaveProperty("privateTranscript"); expect(browse.webinars[0]).not.toHaveProperty("privateTranscript");
    expect(JSON.stringify({ browse, article, webinar })).not.toMatch(/SYNTHETIC-PRIVATE|Draft fees|Archived fees|Unpublished Webinar|Archived Webinar/);
    expect((await api.library.browse({ search: "fees", category: "Fees" })).articles.map(item => item.id)).toEqual([101]);
  });
  it.each(["article", "webinar"] as const)("unpublished/archived %s cannot be fetched, viewed or completed", async contentType => {
    const f = fixture(), api = caller();
    for (const id of contentType === "article" ? [102, 103, 999] : [202, 203, 999]) {
      await expect(api.library[contentType]({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(api.library.recordView({ contentType, contentId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(api.library.markCompleted({ contentType, contentId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(f.writes).toEqual([]); expect(external.award).not.toHaveBeenCalled();
  });
  it("views and completions preserve staff learning activity only, without independent-agent Momentum points", async () => {
    const f = fixture(), api = caller(), ownerBefore = structuredClone(f.rows.get(libraryContentActivity)![0]);
    await api.library.recordView({ contentType: "article", contentId: 101 });
    const first = await api.library.markCompleted({ contentType: "article", contentId: 101 });
    const second = await api.library.markCompleted({ contentType: "article", contentId: 101 });
    await api.library.markCompleted({ contentType: "webinar", contentId: 201 });
    expect(first.award).toEqual({ awarded: false, reason: "business_staff_resource_only", points: 0 });
    expect(second.completedAt).toEqual(first.completedAt); expect(external.award).not.toHaveBeenCalled();
    expect(f.writes.every(write => write.table === libraryContentActivity && write.values.userId === 20)).toBe(true);
    expect(f.rows.get(libraryContentActivity)![0]).toEqual(ownerBefore);
    expect((await api.library.article({ id: 101 })).activity?.completedAt).toEqual(first.completedAt);
  });
  it("ordinary agents still earn existing first-completion points under their own identity", async () => {
    const f = fixture(); f.rows.set(businessStaffMemberships, []);
    const result = await caller().library.markCompleted({ contentType: "article", contentId: 101 });
    expect(result.award).toEqual({ awarded: true, points: 5 });
    expect(external.award).toHaveBeenCalledWith({ agentId: 20, ruleKey: "knowledge_base_checkpoint", sourceType: "knowledge_base_article", sourceId: 101, sourceLabel: "Published Fees" });
    await caller().library.markCompleted({ contentType: "article", contentId: 101 });
    expect(external.award).toHaveBeenCalledOnce();
  });
});
