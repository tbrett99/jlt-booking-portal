import { eq } from "drizzle-orm";
import { agentCrmProfiles, users } from "../drizzle/schema";
import { getAgentMergeTarget } from "./agent-merge-identity";
import type { HqIdentityDirectory } from "./management-hq-engine";
import type { HqReportPerson } from "../shared/management-hq-report";
import {
  hqAssignedStaffSourceCandidate,
  hqCurrentOwnerSourceCandidate,
} from "./management-hq-projection";

const strictMerge = (id: number) => getAgentMergeTarget(id, true);
/** Legacy internal resolver. Numeric-user namespace remains separate from implemented OAuth IDs. */
export function createPortalHqDirectory(
  db: any,
  namespaces: {
    portalUserId: string;
    uniqueAgentId: string;
    oauthOpenId?: string;
  },
  mergeTarget = strictMerge
): HqIdentityDirectory {
  if (
    !db ||
    !namespaces.portalUserId ||
    !namespaces.uniqueAgentId ||
    namespaces.portalUserId === namespaces.uniqueAgentId ||
    (namespaces.oauthOpenId !== undefined &&
      (!namespaces.oauthOpenId ||
        namespaces.oauthOpenId === namespaces.portalUserId ||
        namespaces.oauthOpenId === namespaces.uniqueAgentId))
  )
    throw new Error("HQ identity namespaces require approval");
  const implemented = createPortalHqImplementedDirectory(db, mergeTarget);
  return {
    resolveCurrentOwner: implemented.resolveCurrentOwner,
    resolveAssignedStaff: implemented.resolveAssignedStaff,
    async resolve(evidence) {
      if (evidence.state !== "verified" || !evidence.id || !evidence.source)
        return null;
      let userId: number;
      if (evidence.namespace === namespaces.portalUserId) {
        if (!/^[1-9]\d{0,9}$/.test(evidence.id)) return null;
        userId = Number(evidence.id);
        if (!Number.isSafeInteger(userId) || userId > 2_147_483_647)
          return null;
      } else if (evidence.namespace === namespaces.uniqueAgentId) {
        if (evidence.id.length > 20) return null;
        const found = await db
          .select({ userId: agentCrmProfiles.userId })
          .from(agentCrmProfiles)
          .where(eq(agentCrmProfiles.uniqueAgentId, evidence.id))
          .limit(2);
        if (found.length !== 1) return null;
        userId = found[0].userId;
      } else if (
        namespaces.oauthOpenId &&
        evidence.namespace === namespaces.oauthOpenId
      ) {
        if (evidence.id.length > 64 || evidence.id !== evidence.id.trim())
          return null;
        const found = await db
          .select({ id: users.id, openId: users.openId })
          .from(users)
          .where(eq(users.openId, evidence.id))
          .limit(2);
        if (found.length !== 1 || found[0].openId !== evidence.id) return null;
        userId = found[0].id;
      } else return null;
      // Historical performance only: never transfer sign-in/session authority.
      userId = (await mergeTarget(userId)) ?? userId;
      const identities = await db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          uniqueAgentId: agentCrmProfiles.uniqueAgentId,
        })
        .from(users)
        .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
        .where(eq(users.id, userId))
        .limit(2);
      if (identities.length !== 1) return null;
      const identity = identities[0];
      return {
        userId: identity.id,
        uniqueAgentId: identity.uniqueAgentId ?? null,
        name: identity.name ?? `Member ${identity.id}`,
        role: identity.role,
      };
    },
  };
}

/** Confirmed wire namespaces: jltAgentId = CRM uniqueAgentId; jltOpenId = users.openId.
 * Independently resolve every supplied identifier. No fallback, new identity or name/email joins.
 * The merge seam canonicalizes existing reporting people only, never sessions or historical sellers.
 */
export function createPortalHqImplementedDirectory(
  db: any,
  mergeTarget = strictMerge
): HqIdentityDirectory {
  if (!db) throw new Error("HQ existing identity directory required");
  const validUserId = (id: unknown): id is number =>
    typeof id === "number" &&
    Number.isSafeInteger(id) &&
    id > 0 &&
    id <= 2_147_483_647;
  async function existingPerson(id: number): Promise<HqReportPerson | null> {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        uniqueAgentId: agentCrmProfiles.uniqueAgentId,
      })
      .from(users)
      .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
      .where(eq(users.id, id))
      .limit(2);
    if (rows.length !== 1 || rows[0].id !== id) return null;
    return {
      userId: id,
      uniqueAgentId: rows[0].uniqueAgentId ?? null,
      name: rows[0].name ?? `Member ${id}`,
      role: rows[0].role,
    };
  }
  async function resolveIds(
    ids: { jltAgentId: string | null; jltOpenId: string | null } | null
  ): Promise<HqReportPerson | null> {
    if (!ids) return null;
    const canonicalPeople: HqReportPerson[] = [];
    for (const kind of ["jltAgentId", "jltOpenId"] as const) {
      const value = ids[kind];
      if (value === null) continue;
      const rows =
        kind === "jltAgentId"
          ? await db
              .select({
                userId: agentCrmProfiles.userId,
                uniqueAgentId: agentCrmProfiles.uniqueAgentId,
              })
              .from(agentCrmProfiles)
              .where(eq(agentCrmProfiles.uniqueAgentId, value))
              .limit(2)
          : await db
              .select({ userId: users.id, openId: users.openId })
              .from(users)
              .where(eq(users.openId, value))
              .limit(2);
      if (
        rows.length !== 1 ||
        !validUserId(rows[0].userId) ||
        (kind === "jltAgentId" ? rows[0].uniqueAgentId : rows[0].openId) !==
          value
      )
        return null;
      const original = await existingPerson(rows[0].userId);
      if (!original) return null;
      const merged = await mergeTarget(original.userId);
      const canonicalId = merged ?? original.userId;
      if (!validUserId(canonicalId)) return null;
      const canonical =
        canonicalId === original.userId
          ? original
          : await existingPerson(canonicalId);
      if (!canonical) return null;
      canonicalPeople.push(canonical);
    }
    if (
      !canonicalPeople.length ||
      canonicalPeople.some(
        p => JSON.stringify(p) !== JSON.stringify(canonicalPeople[0])
      )
    )
      return null;
    return canonicalPeople[0];
  }
  return {
    async resolve() {
      return null;
    },
    async resolveCurrentOwner(link) {
      return resolveIds(hqCurrentOwnerSourceCandidate(link));
    },
    async resolveAssignedStaff(link) {
      return resolveIds(hqAssignedStaffSourceCandidate(link));
    },
  };
}
