import { describe, expect, it, vi } from "vitest";
vi.mock("./agent-merge-identity", () => ({ getAgentMergeTarget: vi.fn(async () => null) }));
import { createPortalHqDirectory } from "./management-hq-identity";
const namespace = { portalUserId: "sample.portal.numeric", uniqueAgentId: "sample.portal.jlt" };
const evidence = (ns: string, id: string, state = "verified") => ({ namespace: ns, id, state, source: "sample evidence" }) as any;
function fixtureDb(sets: any[][]) {
  const select = vi.fn(() => { const rows = sets.shift() ?? []; const query: any = { from: () => query, leftJoin: () => query, where: () => query, limit: async () => rows }; return query; });
  return { select };
}
describe("Management HQ reuses existing identity fields", () => {
  it("does not enable an unagreed namespace convention", () => { expect(() => createPortalHqDirectory({}, { portalUserId: "", uniqueAgentId: "" })).toThrow("approval"); });
  it("reads existing numeric user ID, never name/email or current processor", async () => {
    const db = fixtureDb([[{ id: 101, name: "Sample member", role: "agent", uniqueAgentId: "JLT-0001" }]]);
    const got = await createPortalHqDirectory(db, namespace, async () => null).resolve(evidence(namespace.portalUserId, "101"));
    expect(got).toEqual({ userId: 101, name: "Sample member", role: "agent", uniqueAgentId: "JLT-0001" }); expect(db.select).toHaveBeenCalledOnce();
  });
  it("resolves the existing unique CRM JLT identifier", async () => {
    const db = fixtureDb([[{ userId: 102 }], [{ id: 102, name: "Sample Duo member", role: "agent", uniqueAgentId: "JLT-0002" }]]);
    expect((await createPortalHqDirectory(db, namespace, async () => null).resolve(evidence(namespace.uniqueAgentId, "JLT-0002")))?.userId).toBe(102);
  });
  it("uses the existing historical canonical merge seam only for reporting", async () => {
    const db = fixtureDb([[{ id: 101, name: "Sample primary", role: "agent", uniqueAgentId: "JLT-0001" }]]); const merge = vi.fn(async () => 101);
    expect((await createPortalHqDirectory(db, namespace, merge).resolve(evidence(namespace.portalUserId, "760")))?.userId).toBe(101); expect(merge).toHaveBeenCalledWith(760);
  });
  it("does not create a fake JLT ID for admin actors", async () => {
    const db = fixtureDb([[{ id: 47, name: "Sample administrator", role: "super_admin", uniqueAgentId: null }]]);
    expect(await createPortalHqDirectory(db, namespace, async () => null).resolve(evidence(namespace.portalUserId, "47"))).toMatchObject({ userId: 47, uniqueAgentId: null, role: "super_admin" });
  });
  it.each([evidence("email", "same@example.test"), evidence(namespace.portalUserId, "101", "current_assignment"), evidence(namespace.portalUserId, "0"), evidence(namespace.portalUserId, "9007199254740993"), evidence(namespace.uniqueAgentId, "JLT-" + "1".repeat(30))])("rejects unsafe/nonverified identity %j", async ev => {
    const db = fixtureDb([]); expect(await createPortalHqDirectory(db, namespace).resolve(ev)).toBeNull(); expect(db.select).not.toHaveBeenCalled();
  });
  it("holds ambiguous/unmatched JLT IDs rather than choosing first", async () => { const db = fixtureDb([[{ userId: 101 }, { userId: 102 }]]); expect(await createPortalHqDirectory(db, namespace).resolve(evidence(namespace.uniqueAgentId, "JLT-0001"))).toBeNull(); });
});
