import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import { TRPCError } from "@trpc/server";
const source = fs.readFileSync(new URL("./crm-router.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("crm-router.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let callback: ts.ArrowFunction | undefined;
function find(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(tree) === "deleteNewSignUp") {
    function visit(child: ts.Node) {
      if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === "mutation" && child.arguments[0] && ts.isArrowFunction(child.arguments[0])) callback = child.arguments[0];
      ts.forEachChild(child, visit);
    }
    visit(node);
  }
  ts.forEachChild(node, find);
}
find(tree);
if (!callback) throw new Error("Actual onboarding deletion callback not found");
const script = ts.transpileModule("const callback = " + callback.getText(tree).replace('await import("./db")', 'deps.db').replace('await import("../drizzle/schema")', 'deps.schema').replace('await import("drizzle-orm")', 'deps.orm') + ";", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const make = new Function("deps", "assertAgentNotMerged", "TRPCError", script + "return callback;");
const tables = Object.fromEntries(["users", "agentCrmProfiles", "adminOnboardingChecklist", "joinSessions", "userDeletions", "recruitmentSignupLinks"].map(name => [name, { name, id: "id", userId: "userId" }]));
const user = { id: 22, role: "agent", portalStatus: "onboarding", email: "synthetic@example.test", name: "Synthetic Person" };
let events: string[], linked: boolean, person: typeof user | undefined, failDelete: boolean;
const merged = vi.fn();
const tx: any = {
  select: () => { let table: any; const chain: any = { from: (value: any) => { table = value; return chain; }, where: () => chain, limit: () => chain, for: (lock: string) => { events.push("lock:" + table.name + ":" + lock); return chain; }, then: (resolve: any, reject: any) => Promise.resolve(table === tables.users ? person ? [person] : [] : linked ? [{ id: 99 }] : []).then(resolve, reject) }; return chain; },
  insert: (table: any) => ({ values: async () => { events.push("insert:" + table.name); } }),
  delete: (table: any) => ({ where: async () => { events.push("delete:" + table.name); if (failDelete && table === tables.joinSessions) throw new Error("Injected FK/storage failure"); } }),
};
const db = { transaction: async (fn: any) => { events.push("begin"); try { const result = await fn(tx); events.push("commit"); return result; } catch (error) { events.push("rollback"); throw error; } } };
const invoke = () => make({ db: { getDb: async () => db }, schema: tables, orm: { eq: () => "bound-id-only" } }, merged, TRPCError)({ input: { userId: 22 }, ctx: { user: { id: 1, email: "staff@example.test", name: "Staff" } } });
beforeEach(() => { events = []; linked = false; person = { ...user }; failDelete = false; merged.mockReset().mockResolvedValue(undefined); });
describe("actual onboarding deletion callback, fully offline", () => {
  it("blocks a linked onboarding agent before audit/profile/signing/user writes", async () => { linked = true; await expect(invoke()).rejects.toMatchObject({ code: "CONFLICT" }); expect(events).toEqual(["begin", "lock:users:update", "rollback"]); });
  it("locks the user before cleanup and commits all ordinary unlinked cleanup together", async () => { expect(await invoke()).toEqual({ ok: true }); expect(events).toEqual(["begin", "lock:users:update", "insert:userDeletions", "delete:adminOnboardingChecklist", "delete:agentCrmProfiles", "delete:joinSessions", "delete:users", "commit"]); });
  it("rolls back prior cleanup if signing-row/FK deletion fails, rather than leaving a missing profile", async () => { failDelete = true; await expect(invoke()).rejects.toThrow("Injected FK/storage failure"); expect(events.at(-1)).toBe("rollback"); expect(events).not.toContain("commit"); expect(events).not.toContain("delete:users"); });
  it("blocks active agents before any delete or audit effects", async () => { person = { ...user, portalStatus: "active" }; await expect(invoke()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(events).toEqual(["begin", "lock:users:update", "rollback"]); });
  it("blocks administrator accounts before any delete or audit effects", async () => { person = { ...user, role: "admin" }; await expect(invoke()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(events).toEqual(["begin", "lock:users:update", "rollback"]); });
  it("blocks missing users without creating misleading audit rows", async () => { person = undefined; await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(events).toEqual(["begin", "lock:users:update", "rollback"]); });
  it("blocks merged archive IDs before any database transaction", async () => { merged.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" })); await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(events).toEqual([]); });
});
