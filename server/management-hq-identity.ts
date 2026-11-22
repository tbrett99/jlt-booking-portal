import { eq } from "drizzle-orm";
import { agentCrmProfiles, users } from "../drizzle/schema";
import { getAgentMergeTarget } from "./agent-merge-identity";
import type { HqIdentityDirectory } from "./management-hq-engine";

/** Namespace spellings must be agreed with Orbit. No live defaults, email joins or identity creation. */
export function createPortalHqDirectory(db: any, namespaces: { portalUserId: string; uniqueAgentId: string }, mergeTarget = (id: number) => getAgentMergeTarget(id, true)): HqIdentityDirectory {
  if (!db || !namespaces.portalUserId || !namespaces.uniqueAgentId || namespaces.portalUserId === namespaces.uniqueAgentId) throw new Error("HQ identity namespaces require approval");
  return {
    async resolve(evidence) {
      if (evidence.state !== "verified" || !evidence.id || !evidence.source) return null;
      let userId: number;
      if (evidence.namespace === namespaces.portalUserId) {
        if (!/^[1-9]\d{0,9}$/.test(evidence.id)) return null;
        userId = Number(evidence.id);
        if (!Number.isSafeInteger(userId) || userId > 2_147_483_647) return null;
      } else if (evidence.namespace === namespaces.uniqueAgentId) {
        if (evidence.id.length > 20) return null;
        const found = await db.select({ userId: agentCrmProfiles.userId }).from(agentCrmProfiles).where(eq(agentCrmProfiles.uniqueAgentId, evidence.id)).limit(2);
        if (found.length !== 1) return null;
        userId = found[0].userId;
      } else return null;
      // Historical performance only: never transfer sign-in/session authority.
      userId = (await mergeTarget(userId)) ?? userId;
      const identities = await db.select({ id: users.id, name: users.name, role: users.role, uniqueAgentId: agentCrmProfiles.uniqueAgentId }).from(users).leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id)).where(eq(users.id, userId)).limit(2);
      if (identities.length !== 1) return null;
      const identity = identities[0];
      return { userId: identity.id, uniqueAgentId: identity.uniqueAgentId ?? null, name: identity.name ?? `Member ${identity.id}`, role: identity.role };
    },
  };
}
