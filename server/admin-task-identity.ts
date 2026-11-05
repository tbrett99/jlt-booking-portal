import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { staffAccessAudit, users } from "../drizzle/schema";
import { getDb } from "./db";
import { isPositiveTaskIdentityId, normaliseTaskIdentityEmail, resolveEquivalentTaskOwnerIds } from "../shared/task-identity";

export const ADMIN_TASK_IDENTITY_ACTION = "admin_task_identity_consolidated";
export type AdminTaskIdentityAccount = {
  id: number; name?: string | null; email: string | null; role: string; isActive: boolean | number;
};
export type AdminTaskIdentityAudit = {
  actorId: number; targetUserId: number; action: string; metadata: unknown;
};
export type ActiveAdminTaskOwner = { id: number; name: string; email: string | null; identityUserIds: number[] };

function identityError(): never {
  // Never expose database diagnostics, audit metadata, or account details.
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Task owner identities could not be verified. Please try again." });
}
function isAdmin(account: AdminTaskIdentityAccount) {
  return account.role === "admin" || account.role === "super_admin";
}
function isActive(account: AdminTaskIdentityAccount) {
  return account.isActive === true || account.isActive === 1;
}
function metadataObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* Fail closed below. */ }
  return identityError();
}

/** Pure task-only history validation. Never infer an archive from names or email. */
export function validateAdminTaskHistoryLinks(
  accounts: AdminTaskIdentityAccount[],
  audits: AdminTaskIdentityAudit[],
): Map<number, number> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const links = new Map<number, number>();
  const claimedLinks = new Map<number, number>();
  for (const audit of audits) {
    if (audit.action !== ADMIN_TASK_IDENTITY_ACTION) continue;
    const metadata = metadataObject(audit.metadata);
    const primaryId = metadata.primaryUserId;
    const retiredId = metadata.retiredUserId;
    const taskIds = metadata.taskIds;
    if (!isPositiveTaskIdentityId(primaryId) || !isPositiveTaskIdentityId(retiredId)
      || primaryId === retiredId || audit.actorId !== primaryId || audit.targetUserId !== retiredId
      || metadata.historyOnlyLink !== true || !Array.isArray(taskIds) || taskIds.length === 0
      || !taskIds.every(isPositiveTaskIdentityId) || new Set(taskIds).size !== taskIds.length
      || metadata.taskCount !== taskIds.length || claimedLinks.has(retiredId)) return identityError();
    claimedLinks.set(retiredId, primaryId);
    const primary = byId.get(primaryId);
    const retired = byId.get(retiredId);
    // Revocation removes this history link, without preventing other active staff
    // from using tasks. It cannot grant an inactive primary any access.
    if (primary && !isActive(primary)) continue;
    if (!primary || !retired || !isAdmin(primary) || !isAdmin(retired)
      || primary.role !== retired.role || !isActive(primary)
      || !(retired.isActive === false || retired.isActive === 0) || retired.email !== null) return identityError();
    links.set(retiredId, primaryId);
  }
  // Reject chains and cycles rather than granting transitive task identity.
  for (const primary of Array.from(claimedLinks.values())) if (claimedLinks.has(primary)) return identityError();
  return links;
}

/** Only the exact optional audit-table absence permits an empty history mapping. */
export function isMissingTaskIdentityAuditTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const fault = error as { errno?: unknown; code?: unknown; sqlMessage?: unknown; message?: unknown; cause?: unknown };
  if (fault.errno === 1146 && fault.code === "ER_NO_SUCH_TABLE") {
    const message = typeof fault.sqlMessage === "string" ? fault.sqlMessage : fault.message;
    return typeof message === "string" && /Table ['`](?:[^'`]+\.)?staff_access_audit['`] doesn't exist/i.test(message);
  }
  return fault.cause !== error && fault.cause !== undefined ? isMissingTaskIdentityAuditTable(fault.cause) : false;
}

async function loadAdminTaskIdentity() {
  try {
    const db = await getDb();
    if (!db) return identityError();
    // Direct minimal projection: do not call agent-merge identity or filter broad user history.
    const accounts = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive })
      .from(users).where(inArray(users.role, ["admin", "super_admin"]));
    let audits: AdminTaskIdentityAudit[];
    try {
      audits = await db.select({ actorId: staffAccessAudit.actorId, targetUserId: staffAccessAudit.targetUserId, action: staffAccessAudit.action, metadata: staffAccessAudit.metadata })
        .from(staffAccessAudit).where(eq(staffAccessAudit.action, ADMIN_TASK_IDENTITY_ACTION));
    } catch (error) {
      if (!isMissingTaskIdentityAuditTable(error)) return identityError();
      audits = [];
    }
    const links = validateAdminTaskHistoryLinks(accounts, audits);
    // The recovery transaction verified exact task existence and ownership at the
    // audited decision. Legitimate later task deletion/reassignment must not make
    // the immutable history link or every staff member's task workspace fail.
    return { accounts, links };
  } catch { return identityError(); }
}

/** One active assignment option per legacy active email; retired IDs require explicit task audit. */
export function buildActiveAdminTaskOwners(accounts: AdminTaskIdentityAccount[], links: Map<number, number>): ActiveAdminTaskOwner[] {
  const grouped = new Map<string, ActiveAdminTaskOwner>();
  for (const account of [...accounts].sort((a, b) => a.id - b.id)) {
    if (!isPositiveTaskIdentityId(account.id) || !isAdmin(account) || !isActive(account) || links.has(account.id)) continue;
    const key = normaliseTaskIdentityEmail(account.email) || `user:${account.id}`;
    let owner = grouped.get(key);
    if (!owner) {
      owner = { id: account.id, name: account.name ?? "", email: account.email, identityUserIds: [] };
      grouped.set(key, owner);
    }
    owner.identityUserIds.push(account.id);
    for (const [retired, primary] of Array.from(links)) if (primary === account.id) owner.identityUserIds.push(retired);
    owner.identityUserIds = Array.from(new Set(owner.identityUserIds));
  }
  return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));
}
export async function listActiveAdminTaskOwners(): Promise<ActiveAdminTaskOwner[]> {
  const { accounts, links } = await loadAdminTaskIdentity();
  return buildActiveAdminTaskOwners(accounts, links);
}
/** Read-only task ownership, not an authentication or financial/CRM identity link. */
export async function getEquivalentAdminTaskOwnerIds(currentUser: { id: number; email?: string | null }): Promise<number[]> {
  return resolveEquivalentTaskOwnerIds(currentUser, await listActiveAdminTaskOwners());
}
/** Central guard for all fresh assignments, including mentions and recurring copies. */
export async function assertNewAdminTaskAssignee(assigneeId: unknown): Promise<void> {
  if (assigneeId === undefined || assigneeId === null) return;
  if (!isPositiveTaskIdentityId(assigneeId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an active admin task assignee." });
  }
  const { accounts, links } = await loadAdminTaskIdentity();
  const account = accounts.find((candidate) => candidate.id === assigneeId);
  if (!account || !isAdmin(account) || !isActive(account) || links.has(assigneeId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an active admin task assignee." });
  }
}
