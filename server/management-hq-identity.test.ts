import { describe, expect, it, vi } from "vitest";
vi.mock("./agent-merge-identity", () => ({
  getAgentMergeTarget: vi.fn(async () => null),
}));
import { createPortalHqDirectory } from "./management-hq-identity";
const namespace = {
  portalUserId: "sample.portal.numeric",
  uniqueAgentId: "sample.portal.jlt",
};
const evidence = (ns: string, id: string, state = "verified") =>
  ({ namespace: ns, id, state, source: "sample evidence" }) as any;
function fixtureDb(sets: any[][]) {
  const select = vi.fn(() => {
    const rows = sets.shift() ?? [];
    const query: any = {
      from: () => query,
      leftJoin: () => query,
      where: () => query,
      limit: async () => rows,
    };
    return query;
  });
  return { select };
}
describe("Management HQ reuses existing identity fields", () => {
  it("does not enable an unagreed namespace convention", () => {
    expect(() =>
      createPortalHqDirectory({}, { portalUserId: "", uniqueAgentId: "" })
    ).toThrow("approval");
  });
  it("reads existing numeric user ID, never name/email or current processor", async () => {
    const db = fixtureDb([
      [
        {
          id: 101,
          name: "Sample member",
          role: "agent",
          uniqueAgentId: "JLT-0001",
        },
      ],
    ]);
    const got = await createPortalHqDirectory(
      db,
      namespace,
      async () => null
    ).resolve(evidence(namespace.portalUserId, "101"));
    expect(got).toEqual({
      userId: 101,
      name: "Sample member",
      role: "agent",
      uniqueAgentId: "JLT-0001",
    });
    expect(db.select).toHaveBeenCalledOnce();
  });
  it("resolves the existing unique CRM JLT identifier", async () => {
    const db = fixtureDb([
      [{ userId: 102 }],
      [
        {
          id: 102,
          name: "Sample Duo member",
          role: "agent",
          uniqueAgentId: "JLT-0002",
        },
      ],
    ]);
    expect(
      (
        await createPortalHqDirectory(db, namespace, async () => null).resolve(
          evidence(namespace.uniqueAgentId, "JLT-0002")
        )
      )?.userId
    ).toBe(102);
  });
  it("uses the existing historical canonical merge seam only for reporting", async () => {
    const db = fixtureDb([
      [
        {
          id: 101,
          name: "Sample primary",
          role: "agent",
          uniqueAgentId: "JLT-0001",
        },
      ],
    ]);
    const merge = vi.fn(async () => 101);
    expect(
      (
        await createPortalHqDirectory(db, namespace, merge).resolve(
          evidence(namespace.portalUserId, "760")
        )
      )?.userId
    ).toBe(101);
    expect(merge).toHaveBeenCalledWith(760);
  });
  it("does not create a fake JLT ID for admin actors", async () => {
    const db = fixtureDb([
      [
        {
          id: 47,
          name: "Sample administrator",
          role: "super_admin",
          uniqueAgentId: null,
        },
      ],
    ]);
    expect(
      await createPortalHqDirectory(db, namespace, async () => null).resolve(
        evidence(namespace.portalUserId, "47")
      )
    ).toMatchObject({ userId: 47, uniqueAgentId: null, role: "super_admin" });
  });
  it.each([
    evidence("email", "same@example.test"),
    evidence(namespace.portalUserId, "101", "current_assignment"),
    evidence(namespace.portalUserId, "0"),
    evidence(namespace.portalUserId, "9007199254740993"),
    evidence(namespace.uniqueAgentId, "JLT-" + "1".repeat(30)),
  ])("rejects unsafe/nonverified identity %j", async ev => {
    const db = fixtureDb([]);
    expect(await createPortalHqDirectory(db, namespace).resolve(ev)).toBeNull();
    expect(db.select).not.toHaveBeenCalled();
  });
  it("holds ambiguous/unmatched JLT IDs rather than choosing first", async () => {
    const db = fixtureDb([[{ userId: 101 }, { userId: 102 }]]);
    expect(
      await createPortalHqDirectory(db, namespace).resolve(
        evidence(namespace.uniqueAgentId, "JLT-0001")
      )
    ).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { users } from "../drizzle/schema";
import { createPortalHqImplementedDirectory } from "./management-hq-identity";
import type { HqWireMemberLink } from "../shared/management-hq-wire";
const supplied = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/management-hq-projection-examples.json",
      import.meta.url
    ),
    "utf8"
  )
);
const ownerLink = (): HqWireMemberLink =>
  JSON.parse(
    JSON.stringify(supplied.beforeAmendment.body.items[0].payload.identity)
  );
const person = (id = 101, role = "agent") => ({
  id,
  name: `Existing ${id}`,
  role,
  uniqueAgentId: `JLT-${id}`,
});
const agentMatch = (id = 101, value = "SYN-MEMBER-1") => ({
  userId: id,
  uniqueAgentId: value,
});
const openMatch = (id = 101, value = "synthetic-owner-open-id") => ({
  userId: id,
  openId: value,
});
function trackedDb(sets: any[][]) {
  const conditions: any[] = [];
  const db = {
    select: vi.fn(() => {
      const rows = sets.shift() ?? [];
      const q: any = {
        from: () => q,
        leftJoin: () => q,
        where: (c: any) => {
          conditions.push(c);
          return q;
        },
        limit: async () => rows,
      };
      return q;
    }),
  };
  return { db, conditions };
}
describe("implemented HQ existing CRM/OAuth identity, never historical seller verification", () => {
  it("independently resolves both exact IDs to the same existing canonical person", async () => {
    const db = fixtureDb([
      [agentMatch()],
      [person()],
      [openMatch()],
      [person()],
    ]);
    const merge = vi.fn(async () => null);
    expect(
      await createPortalHqImplementedDirectory(db, merge).resolveCurrentOwner!(
        ownerLink()
      )
    ).toMatchObject({ userId: 101, role: "agent" });
    expect(db.select).toHaveBeenCalledTimes(4);
    expect(merge).toHaveBeenCalledTimes(2);
  });
  it("refuses conflicting dual IDs, not fallback or first person", async () => {
    const db = fixtureDb([
      [agentMatch()],
      [person()],
      [openMatch(102)],
      [person(102)],
    ]);
    expect(
      await createPortalHqImplementedDirectory(db, async () => null)
        .resolveCurrentOwner!(ownerLink())
    ).toBeNull();
  });
  it.each([
    [],
    [agentMatch(), agentMatch(102)],
    [agentMatch(101, "case-mismatched-id")],
  ])(
    "never falls back a missing/ambiguous/non-exact CRM ID to valid OAuth ID %j",
    async rows => {
      const db = fixtureDb([rows, [person()], [openMatch()], [person()]]);
      expect(
        await createPortalHqImplementedDirectory(db, async () => null)
          .resolveCurrentOwner!(ownerLink())
      ).toBeNull();
      expect(db.select).toHaveBeenCalledOnce();
    }
  );
  it("refuses failed OAuth after CRM resolution; exact casing must match", async () => {
    const db = fixtureDb([
      [agentMatch()],
      [person()],
      [openMatch(101, "SYNTHETIC-OWNER-OPEN-ID")],
    ]);
    expect(
      await createPortalHqImplementedDirectory(db, async () => null)
        .resolveCurrentOwner!(ownerLink())
    ).toBeNull();
  });
  it("permits strict existing historical merges for report canonicalization only", async () => {
    const db = fixtureDb([
      [agentMatch(760)],
      [person(760)],
      [person()],
      [openMatch()],
      [person()],
    ]);
    const merge = vi.fn(async (id: number) => (id === 760 ? 101 : null));
    expect(
      await createPortalHqImplementedDirectory(db, merge).resolveCurrentOwner!(
        ownerLink()
      )
    ).toMatchObject({ userId: 101 });
    expect(merge).toHaveBeenCalledWith(760);
  });
  it("refuses a merge into a missing person", async () => {
    const db = fixtureDb([[agentMatch()], [person()], []]);
    expect(
      await createPortalHqImplementedDirectory(db, async () => 999)
        .resolveCurrentOwner!(ownerLink())
    ).toBeNull();
  });
  it("treats numeric openId as an exact OAuth string, never users.id or sub", async () => {
    const link = ownerLink();
    link.memberJltAgentId = null;
    link.memberJltOpenId = "101";
    for (const m of [...link.ownerCandidates, ...link.members].filter(
      x => x.role === "owner"
    )) {
      m.jltAgentId = null;
      m.jltOpenId = "101";
    }
    const { db, conditions } = trackedDb([
      [openMatch(202, "101")],
      [person(202)],
    ]);
    expect(
      await createPortalHqImplementedDirectory(db, async () => null)
        .resolveCurrentOwner!(link)
    ).toMatchObject({ userId: 202 });
    expect(conditions[0].queryChunks).toContain(users.openId);
    expect(conditions[0].queryChunks).not.toContain(users.id);
  });
  it("numeric OAuth not found remains unresolved even when numeric users.id exists", async () => {
    const link = ownerLink();
    link.memberJltAgentId = null;
    link.memberJltOpenId = "101";
    for (const m of [...link.ownerCandidates, ...link.members].filter(
      x => x.role === "owner"
    )) {
      m.jltAgentId = null;
      m.jltOpenId = "101";
    }
    const db = fixtureDb([[], [person()]]);
    expect(
      await createPortalHqImplementedDirectory(db, async () => null)
        .resolveCurrentOwner!(link)
    ).toBeNull();
    expect(db.select).toHaveBeenCalledOnce();
  });
  it.each([
    "historical_flag",
    "portal_flag",
    "source_flag",
    "candidate_member_mismatch",
    "duplicate_owner",
    "staff_owner",
    "tenant_mismatch",
    "duplicate_member",
  ] as const)(
    "refuses incoherent source link %s before any lookup",
    async mutation => {
      const link: any = ownerLink();
      if (mutation === "historical_flag")
        link.historicalSellingRelationshipVerified = true;
      if (mutation === "portal_flag") link.portalVerified = true;
      if (mutation === "source_flag") link.sourceOnly = false;
      if (mutation === "candidate_member_mismatch")
        link.members[0].jltOpenId = "another";
      if (mutation === "duplicate_owner")
        link.ownerCandidates.push({ ...link.ownerCandidates[0] });
      if (mutation === "staff_owner") {
        link.ownerCandidates[0].role = "staff";
        link.members[0].role = "staff";
      }
      if (mutation === "tenant_mismatch") link.ownerCandidates[0].tenantId++;
      if (mutation === "duplicate_member")
        link.members.push({ ...link.members[0] });
      const db = fixtureDb([]);
      expect(
        await createPortalHqImplementedDirectory(db, async () => null)
          .resolveCurrentOwner!(link)
      ).toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    }
  );
  it("inactive owner can still resolve; no active-only omission of historical current real bookings", async () => {
    const link = ownerLink();
    link.ownerCandidates[0].isActive = false;
    link.members[0].isActive = false;
    const db = fixtureDb([
      [agentMatch()],
      [person()],
      [openMatch()],
      [person()],
    ]);
    expect(
      await createPortalHqImplementedDirectory(db, async () => null)
        .resolveCurrentOwner!(link)
    ).toMatchObject({ userId: 101 });
  });
  it("assigned staff resolves independently and is never an owner fallback", async () => {
    const link = ownerLink();
    link.status = "unresolved";
    link.mappingState = "unresolved";
    link.ownerCandidates = [];
    link.ownerTenantUserId = null;
    link.memberJltAgentId = null;
    link.memberJltOpenId = null;
    const db = fixtureDb([
      [agentMatch(47, "SYN-STAFF-1")],
      [person(47, "staff")],
      [openMatch(47, "synthetic-staff-open-id")],
      [person(47, "staff")],
    ]);
    const directory = createPortalHqImplementedDirectory(db, async () => null);
    expect(await directory.resolveCurrentOwner!(link)).toBeNull();
    expect(db.select).not.toHaveBeenCalled();
    expect(await directory.resolveAssignedStaff!(link)).toMatchObject({
      userId: 47,
      role: "staff",
    });
  });
  it("rejects assigned identity with mismatching member and does not grant legacy seller", async () => {
    const link = ownerLink();
    link.assignedStaff.jltOpenId = "wrong";
    const db = fixtureDb([]);
    const directory = createPortalHqImplementedDirectory(db, async () => null);
    expect(await directory.resolveAssignedStaff!(link)).toBeNull();
    expect(
      await directory.resolve(evidence(namespace.uniqueAgentId, "SYN-MEMBER-1"))
    ).toBeNull();
    expect(db.select).not.toHaveBeenCalled();
  });
});
