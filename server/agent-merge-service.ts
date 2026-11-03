import { TRPCError } from "@trpc/server";
import type { PoolConnection } from "mysql2/promise";
import { getRawDbPool } from "./db";
import { MERGE_OWNERS, identifiersValid, makeMergeToken, mergeDigest, stable, uniqueCollision, verifyMergeToken, type OwnerPolicy, type Row } from "./agent-merge-policy";
import { reduceMembershipPaymentEvents } from "./membership-payment-policy";
import type { MergeAccount, MergeHistoryEntry, MergePreview } from "./agent-merge-contract";

type Queryable = { query: (query: string, values?: any[]) => Promise<any> };
type Loaded = { tables: Map<string, Set<string>>; rows: Map<string, Row[]>; uniqueKeys: Map<string, string[][]>; aliases: Row[]; source: Row; primary: Row; control: Row | null };
type Change = { policy: OwnerPolicy; ids: number[]; preserved: Array<{ id: number; hash: string }> };
type Plan = { preview: MergePreview; digest: string; loaded: Loaded; changes: Change[] };
const q = (identifier: string) => { if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(identifier)) throw new Error("Invalid internal merge identifier"); return `\`${identifier}\``; };
const rows = async (db: Queryable, sql: string, args: any[] = []): Promise<Row[]> => { const [result] = await db.query(sql, args); return result as Row[]; };
const isSource = (row: Row, policy: OwnerPolicy, source: number) => Number(row[policy.owner]) === source && (!policy.agentRecipient || row.recipientType === "agent");
const secret = () => process.env.JWT_SECRET ?? "";
const dateIso = (value: any): string | null => value == null ? null : new Date(value).toISOString();
const nowExpired = (value: any) => value && new Date(value).getTime() > Date.now();
function error(message: string, code: "CONFLICT" | "PRECONDITION_FAILED" | "NOT_FOUND" | "BAD_REQUEST" = "CONFLICT"): never { throw new TRPCError({ code, message }); }
function recordSet(loaded: Loaded, table: string, owner: string, id: number) { return (loaded.rows.get(table) ?? []).filter(r => Number(r[owner]) === id); }
function redactedUser(user: Row) {
  const { tempPassword: _password, openId: _openId, ...identity } = user;
  return identity;
}
function safeRowHash(row: Row, owner: string) { const { [owner]: _owner, ...content } = row; return mergeDigest(content); }

export async function loadMergeScope(db: Queryable, sourceId: number, primaryId: number, lock = false): Promise<Loaded> {
  identifiersValid(sourceId, primaryId);
  const metadata = await rows(db, "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()");
  const tables = new Map<string, Set<string>>();
  for (const r of metadata) { if (!tables.has(r.tableName)) tables.set(r.tableName, new Set()); tables.get(r.tableName)!.add(r.columnName); }
  if (!tables.has("agent_record_merges")) error("Apply the Agent CRM merge history SQL to the Railway database before using merge. No account has been changed.", "PRECONDITION_FAILED");
  // Payment processor obtains its account mutex before locking user/profile rows.
  if (lock && tables.has("membership_payment_accounts")) await rows(db, "SELECT userId FROM membership_payment_accounts WHERE userId IN (?, ?) ORDER BY userId FOR UPDATE", [sourceId, primaryId]);
  const users = await rows(db, `SELECT * FROM users WHERE id IN (?, ?) ORDER BY id${lock ? " FOR UPDATE" : ""}`, [sourceId, primaryId]);
  const source = users.find(r => Number(r.id) === sourceId), primary = users.find(r => Number(r.id) === primaryId);
  if (!source || !primary) error("One of the two agent accounts no longer exists. Refresh the CRM.", "NOT_FOUND");
  if (source.role !== "agent" || primary.role !== "agent") error("Only two agent accounts can be merged; staff/admin accounts cannot be merged.", "BAD_REQUEST");
  const aliases = await rows(db, `SELECT * FROM agent_record_merges WHERE sourceUserId IN (?, ?) OR primaryUserId = ?${lock ? " FOR UPDATE" : ""}`, [sourceId, primaryId, sourceId]);
  const uniqueRows = await rows(db, "SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS ordinal FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0 ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX");
  const indexMap = new Map<string, string[]>();
  for (const r of uniqueRows) { const key = `${r.tableName}:${r.indexName}`; if (!indexMap.has(key)) indexMap.set(key, []); indexMap.get(key)!.push(r.columnName); }
  const uniqueKeys = new Map<string, string[][]>();
  for (const [key, columns] of Array.from(indexMap.entries())) { const table = key.split(":")[0]; if (!uniqueKeys.has(table)) uniqueKeys.set(table, []); uniqueKeys.get(table)!.push(columns); }
  const data = new Map<string, Row[]>();
  for (const policy of MERGE_OWNERS) {
    if (!tables.has(policy.table)) continue;
    if (!tables.get(policy.table)!.has(policy.owner)) error(`The live ${policy.table} ownership schema is incomplete. No automatic merge is safe.`, "PRECONDITION_FAILED");
    const order = tables.get(policy.table)!.has("id") ? "id" : policy.owner;
    const selected = await rows(db, `SELECT * FROM ${q(policy.table)} WHERE ${q(policy.owner)} IN (?, ?)${policy.agentRecipient ? " AND recipientType = 'agent'" : ""} ORDER BY ${q(order)} LIMIT 10001${lock ? " FOR UPDATE" : ""}`, [sourceId, primaryId]);
    if (selected.length > 10000) error(`This account has more than 10,000 ${policy.label.toLowerCase()}. A separately reviewed large-record merge is required.`, "PRECONDITION_FAILED");
    data.set(policy.table, selected);
  }
  const control = tables.has("membership_payment_control") ? (await rows(db, `SELECT * FROM membership_payment_control WHERE id = 1${lock ? " FOR UPDATE" : ""}`))[0] ?? null : null;
  // Check source-led pending invite/automation routes, without ever reparenting a credential token.
  if (tables.has("team_invites")) data.set("team_invites", await rows(db, `SELECT * FROM team_invites WHERE leaderId = ? AND status = 'pending'${lock ? " FOR UPDATE" : ""}`, [sourceId]));
  // Get complete external-resource owner sets: no third-person mandate can be swept into this merge.
  for (const [table, reference] of [["gc_mandates", "mandateId"], ["gc_subscriptions", "subscriptionId"]]) {
    const ids = Array.from(new Set((data.get(table) ?? []).map(r => r[reference]).filter(Boolean)));
    if (ids.length) data.set(`${table}:owners`, await rows(db, `SELECT * FROM ${q(table)} WHERE ${q(reference)} IN (${ids.map(() => "?").join(",")}) ORDER BY id${lock ? " FOR UPDATE" : ""}`, ids));
  }
  return { tables, rows: data, uniqueKeys, aliases, source, primary, control };
}

function account(loaded: Loaded, id: number): MergeAccount {
  const user = id === Number(loaded.source.id) ? loaded.source : loaded.primary;
  const profile = recordSet(loaded, "agent_crm_profiles", "userId", id)[0];
  return { id, name: user.name, email: user.email, jltId: profile?.uniqueAgentId ?? null, status: profile?.agentStatus ?? user.portalStatus, lastSignedIn: dateIso(user.lastSignedIn), bookings: recordSet(loaded, "bookings", "agentId", id).length, courses: recordSet(loaded, "academy_enrollments", "agentId", id).length, mandates: recordSet(loaded, "gc_mandates", "userId", id).map(r => ({ id: r.mandateId ?? null, status: r.status })), subscriptions: recordSet(loaded, "gc_subscriptions", "userId", id).map(r => ({ id: r.subscriptionId ?? null, status: r.status })) };
}

export function buildMergePlan(loaded: Loaded, actor: number): Plan {
  const sourceId = Number(loaded.source.id), primaryId = Number(loaded.primary.id);
  identifiersValid(sourceId, primaryId);
  const blockers: string[] = [], warnings: string[] = [];
  if (loaded.aliases.some(r => [sourceId, primaryId].includes(Number(r.sourceUserId)))) blockers.push("One of these accounts is already an archived duplicate; select the current primary record instead.");
  if (loaded.aliases.some(r => Number(r.primaryUserId) === sourceId)) blockers.push("This source already owns merged history. Keep it as primary instead; nested merge chains are not permitted.");
  if (sourceId === actor || primaryId === actor) blockers.push("The operator cannot merge their own staff/login identity.");
  const sp = recordSet(loaded, "agent_crm_profiles", "userId", sourceId)[0], pp = recordSet(loaded, "agent_crm_profiles", "userId", primaryId)[0];
  if (!pp) blockers.push("The selected primary needs a CRM profile and JLT ID first. Choose the established CRM record as primary.");
  if (sp?.teamId && pp?.teamId && sp.teamId !== pp.teamId) blockers.push("These accounts belong to different teams. Resolve their team ownership before merging.");
  if (Number(loaded.source.commissionRatePct) !== Number(loaded.primary.commissionRatePct)) blockers.push("The accounts have different commission rates. Review and align the intended rate before merging; no financial setting is inferred.");
  for (const key of ["bankAccountName", "bankSortCode", "bankAccountNumber"]) if (sp?.[key] && (!pp?.[key] || stable(sp[key]) !== stable(pp[key]))) blockers.push("The source has payout bank details not identical to the primary. Staff must verify/align payout details before ownership can move.");
  if (sp?.paymentExempt !== undefined && pp?.paymentExempt !== undefined && Boolean(sp.paymentExempt) !== Boolean(pp.paymentExempt)) blockers.push("Payment-exemption settings differ. Resolve the membership billing policy before merging.");
  if ((recordSet(loaded, "agent_engagement_cases", "agentId", sourceId).filter(r => r.status !== "closed").length + recordSet(loaded, "agent_engagement_cases", "agentId", primaryId).filter(r => r.status !== "closed").length) > 1) blockers.push("Both records have open engagement cases. Close or review the duplicate case first; conversations are never discarded.");
  if ((loaded.rows.get("team_invites") ?? []).length) blockers.push("The source has an open team invitation. Resolve it before merging; identity tokens are not transferred.");
  if (recordSet(loaded, "agent_change_requests", "userId", sourceId).some(r => r.status === "pending")) blockers.push("The source has pending profile change requests. Review them before merging.");
  if (recordSet(loaded, "public_agent_profiles", "userId", sourceId).some(r => Boolean(r.isPublished))) blockers.push("The source has a published public profile. Hide it first so an old public page cannot keep routing new enquiries to the archived account.");
  for (const table of ["email_sends", "email_drip_enrollments"]) {
    const policy = MERGE_OWNERS.find(p => p.table === table)!;
    if ((loaded.rows.get(table) ?? []).some(r => isSource(r, policy, sourceId) && ["queued", "active"].includes(r.status))) blockers.push(`The source has queued/active ${table === "email_sends" ? "campaign emails" : "email drips"}. Stop or finish these sends before merging; recipients are never silently rerouted.`);
  }
  const financialSource = ["gc_mandates", "gc_subscriptions", "gc_payment_events", "membership_payment_inbox", "membership_payment_obligations", "membership_payment_accounts"].some(t => recordSet(loaded, t, "userId", sourceId).length > 0);
  if (financialSource && (!loaded.control || Boolean(loaded.control.enabled))) blockers.push("Pause membership payment automation in Memberships before merging financial identities. Existing arrears and history are preserved.");
  if (financialSource && nowExpired(loaded.control?.syncLockedUntil)) blockers.push("Payment reconciliation is currently running. Wait for the recovery batch to finish, then refresh the preview.");
  if (recordSet(loaded, "membership_payment_fees", "userId", sourceId).length) blockers.push("The source has administration-fee ledger entries. A reviewed fee-idempotency consolidation is required; merge will not alter or duplicate these charges.");
  if (recordSet(loaded, "membership_payment_outbox", "userId", sourceId).length) blockers.push("The source has payment-email idempotency records. A reviewed notification-ledger consolidation is required; merge will not resend or reroute them.");
  if ((loaded.rows.get("membership_payment_outbox") ?? []).some(r => r.status === "sending" || r.lockToken || nowExpired(r.lockedUntil))) blockers.push("A payment email is in flight. Wait and review its delivery before merging.");
  for (const [table, reference] of [["gc_mandates", "mandateId"], ["gc_subscriptions", "subscriptionId"]]) {
    const all = loaded.rows.get(`${table}:owners`) ?? loaded.rows.get(table) ?? [];
    if (all.some(r => ![sourceId, primaryId].includes(Number(r.userId)))) blockers.push(`A ${reference} is also linked to another or unverified user. Resolve ownership before merging.`);
    const active = all.filter(r => table === "gc_mandates" ? ["active", "pending", "pending_submission", "submitted"].includes(r.status) : ["active", "paused"].includes(r.status));
    if (new Set(active.map(r => r[reference]).filter(Boolean)).size > 1) blockers.push(`There is more than one distinct current ${table === "gc_mandates" ? "mandate" : "subscription"}. Verify which setup should remain current before merging.`);
    const groups = new Map<string, Row[]>(); for (const r of all) { const ref = r[reference]; if (!ref) continue; if (!groups.has(ref)) groups.set(ref, []); groups.get(ref)!.push(r); }
    const fields = table === "gc_subscriptions" ? ["mandateId", "amount", "currency", "dayOfMonth", "startDate", "status"] : ["status", "preferredPaymentDay"];
    for (const copies of Array.from(groups.values())) if (fields.some(k => new Set(copies.map(r => stable(r[k]))).size > 1)) blockers.push(`Duplicate copies of the same ${reference} disagree. Refresh/review provider reference data before merging; no latest-wins rule is used.`);
  }
  // Children must continue to point at a booking owned by one of these exact people.
  const bookingOwners = new Map((loaded.rows.get("bookings") ?? []).map(r => [Number(r.id), Number(r.agentId)]));
  for (const table of ["amendments", "cancellations", "refunds", "commission_claims", "reimbursement_items", "flight_requests", "remittance_lines"]) {
    for (const row of loaded.rows.get(table) ?? []) if (row.bookingId && !bookingOwners.has(Number(row.bookingId))) blockers.push(`${table} row ${row.id} points to a booking outside these two accounts. Review this ownership disagreement first.`);
  }
  const changes: Change[] = [], moves: MergePreview["moves"] = [], retained: MergePreview["retained"] = [];
  const archivedAssignments = new Set<number>();
  for (const policy of MERGE_OWNERS) {
    const all = loaded.rows.get(policy.table) ?? [];
    const sourceRows = all.filter(r => isSource(r, policy, sourceId));
    if (!sourceRows.length) continue;
    const primaryRows = all.filter(r => Number(r[policy.owner]) === primaryId);
    if (policy.mode !== "move") {
      retained.push({ table: policy.table, label: policy.label, count: sourceRows.length, reason: policy.mode === "cache" ? "Original derived cache retained; current primary arrears rebuilt from actual event evidence without financial actions." : "Preserved under the original archived identity; historical evidence is not rewritten." });
      continue;
    }
    const keys = loaded.uniqueKeys.get(policy.table) ?? [];
    const collisions = sourceRows.filter(r => primaryRows.some(p => keys.some(k => uniqueCollision(r, p, k, policy.owner))));
    if (policy.table === "momentum_ledger" && collisions.length) blockers.push("Both accounts have Momentum rewards for the same action/content. Review duplicate points before merging; awards are never deleted or doubled.");
    const moving = sourceRows.filter(r => !collisions.includes(r));
    if (policy.table === "momentum_ledger") for (let i = moving.length - 1; i >= 0; i--) if (moving[i].sourceType === "academy_action_assignment" && archivedAssignments.has(Number(moving[i].sourceId))) { collisions.push(moving[i]); moving.splice(i, 1); }
    if (policy.table === "academy_action_assignments") collisions.forEach(r => archivedAssignments.add(Number(r.id)));
    if (collisions.length) {
      retained.push({ table: policy.table, label: policy.label, count: collisions.length, reason: "Overlapping primary record is retained for current operation; original duplicate evidence stays accessible in merged-record history. No progress, grades, access or points are blended." });
      if (["academy_enrollments", "academy_action_assignments"].includes(policy.table)) warnings.push(`${collisions.length} overlapping ${policy.label.toLowerCase()} remain in original history. The primary's existing course/action state is kept; source completion does not automatically complete or unlock the primary's training.`);
    }
    if (moving.length) {
      if (moving.some(r => !Number.isSafeInteger(Number(r.id)))) blockers.push(`The ${policy.table} records have no supported stable row ID. A reviewed migration is required.`);
      changes.push({ policy, ids: moving.map(r => Number(r.id)), preserved: moving.map(r => ({ id: Number(r.id), hash: safeRowHash(r, policy.owner) })) });
      moves.push({ table: policy.table, label: policy.label, count: moving.length });
    }
  }
  warnings.push("The selected primary keeps its login email/password, JLT ID, contact/correspondence settings, membership/access status, team and payout bank details. Source profile documents and internal notes remain preserved in read-only history.");
  warnings.push("The duplicate's existing login and sessions are disabled. Old login credentials will never log in as the primary. No emails, payments, GoCardless creations/cancellations or course outcomes are triggered by the merge.");
  if (!loaded.tables.has("gc_mandate_replacements")) warnings.push("Mandate replacement-history schema is absent on this database. Merge will not create replacement history or enable replacement controls.");
  const digest = mergeDigest({ source: redactedUser(loaded.source), primary: redactedUser(loaded.primary), rows: Array.from(loaded.rows.entries()), aliases: loaded.aliases, schema: Array.from(loaded.uniqueKeys.entries()), moves, retained, blockers: Array.from(new Set(blockers)), policyVersion: 1 });
  const expiry = Date.now() + 10 * 60 * 1000;
  const preview: MergePreview = { source: account(loaded, sourceId), primary: account(loaded, primaryId), token: makeMergeToken({ source: sourceId, primary: primaryId, actor, digest, expiry }, secret()), expiresAt: new Date(expiry).toISOString(), moves, retained, warnings: Array.from(new Set(warnings)), blockers: Array.from(new Set(blockers)), canMerge: blockers.length === 0 };
  return { preview, digest, loaded, changes };
}

export async function previewAgentMerge(source: number, primary: number, actor: number) {
  const pool = await getRawDbPool(); const connection = await pool.getConnection();
  try { await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); await connection.beginTransaction(); const plan = buildMergePlan(await loadMergeScope(connection, source, primary), actor); await connection.rollback(); return plan.preview; }
  catch (e) { await connection.rollback(); throw e; } finally { connection.release(); }
}

async function rebuildPaymentCache(db: Queryable, plan: Plan, primary: number) {
  if (!plan.loaded.tables.has("membership_payment_accounts")) return;
  const events = await rows(db, "SELECT * FROM membership_payment_inbox WHERE userId = ? AND status <> 'ignored' AND paymentId IS NOT NULL ORDER BY occurredAt,eventId", [primary]);
  if (!events.length && !(plan.loaded.rows.get("membership_payment_accounts") ?? []).length) return;
  const settlements = plan.loaded.tables.has("membership_payment_settlements") ? await rows(db, "SELECT * FROM membership_payment_settlements WHERE userId = ? ORDER BY settledAt,id", [primary]) : [];
  const failureRows = plan.loaded.rows.get("gc_payment_failures") ?? [];
  const boundaries = Array.from(new Set(failureRows.map(r => dateIso(r.failureRunResetAt)).filter(Boolean)));
  if (boundaries.length > 1) error("Conflicting failure-run resets require staff review; no debt or reset was changed.");
  const result = reduceMembershipPaymentEvents(events.map(e => ({ eventId: e.eventId, paymentId: e.paymentId, action: e.action, occurredAt: e.occurredAt, amount: e.amountPence ?? undefined, currency: e.currency ?? undefined })), { manualSettlements: settlements.map(s => ({ settlementId: String(s.id), paymentId: s.paymentId, occurredAt: s.settledAt })), ...(boundaries[0] ? { resetAt: boundaries[0] } : {}) });
  const outstanding = result.outstandingAmountsComplete && Object.keys(result.knownOutstandingAmounts).every(c => c === "GBP") ? result.knownOutstandingAmounts.GBP ?? 0 : null;
  // Pure cache-only write. NO processing helpers, fees, access changes or outbox intents.
  await db.query("INSERT INTO membership_payment_accounts (userId,failedAttempts,outstandingPence,outstandingCount,runKey,lastFailedAt,lastSyncedAt,historyReviewRequired,lastError) VALUES (?,?,?,?,?,?,NULL,1,?) ON DUPLICATE KEY UPDATE failedAttempts=VALUES(failedAttempts),outstandingPence=VALUES(outstandingPence),outstandingCount=VALUES(outstandingCount),runKey=VALUES(runKey),lastFailedAt=VALUES(lastFailedAt),lastSyncedAt=NULL,historyReviewRequired=1,lastError=VALUES(lastError)", [primary, result.failureCount, outstanding, result.outstandingPaymentCount, result.currentRunKey ? `membership:${primary}:${result.currentRunKey}` : null, result.lastFailedAt ? new Date(result.lastFailedAt) : null, "Agent records merged: normal provider reconciliation and historical review still required. Merge did not send notices, charge fees or change access."]);
}

export type MergeExecution = { sourceUserId: number; primaryUserId: number; previewToken: string; reason: string; confirmation: string; samePersonConfirmed: boolean; primaryChoicesConfirmed: boolean; archivedLearningConfirmed: boolean };
export async function executeAgentMerge(input: MergeExecution, actor: { id: number; name: string | null }, dependencies?: { connection: any }) {
  identifiersValid(input.sourceUserId, input.primaryUserId);
  if (!input.samePersonConfirmed || !input.primaryChoicesConfirmed || !input.archivedLearningConfirmed || input.confirmation !== `MERGE ${input.sourceUserId} INTO ${input.primaryUserId}` || input.reason.trim().length < 10) error("Review both identities, primary settings and retained learning history, add a reason, and type the exact merge confirmation.", "BAD_REQUEST");
  const connection: PoolConnection = dependencies?.connection ?? await (await getRawDbPool()).getConnection();
  let acquired = false, destroyed = false;
  try {
    const [lockRows] = await connection.query<any[]>("SELECT GET_LOCK(?,10) AS acquired", ["jlt-gc-email-links"]);
    if (Number(lockRows[0]?.acquired) !== 1) error("Another identity/payment operation is running. No records have been changed; try again shortly.");
    acquired = true;
    await connection.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await connection.beginTransaction();
    const existing = await rows(connection, "SELECT * FROM agent_record_merges WHERE sourceUserId = ? FOR UPDATE", [input.sourceUserId]);
    if (existing.length) {
      if (Number(existing[0].primaryUserId) !== input.primaryUserId) error("The duplicate was already merged into a different primary. No second merge is allowed.");
      await connection.rollback(); return { success: true, alreadyMerged: true, primaryUserId: input.primaryUserId };
    }
    const loaded = await loadMergeScope(connection, input.sourceUserId, input.primaryUserId, true);
    const plan = buildMergePlan(loaded, actor.id);
    verifyMergeToken(input.previewToken, { source: input.sourceUserId, primary: input.primaryUserId, actor: actor.id, digest: plan.digest }, secret());
    if (plan.preview.blockers.length) error(plan.preview.blockers.join("\n"), "PRECONDITION_FAILED");
    // Preserve original profile and credential identity. This is duplicate archival,
    // not the cancellation workflow; no cancellation/status-email helpers are called.
    const manifest = { version: 1, sourceIdentity: redactedUser(loaded.source), primaryIdentity: redactedUser(loaded.primary), sourceProfile: recordSet(loaded,"agent_crm_profiles","userId",input.sourceUserId)[0] ?? null, primaryProfile: recordSet(loaded,"agent_crm_profiles","userId",input.primaryUserId)[0] ?? null, moves: plan.preview.moves, retained: plan.preview.retained, changes: plan.changes.map(c => ({ table: c.policy.table, column: c.policy.owner, originalOwner: input.sourceUserId, canonicalOwner: input.primaryUserId, rows: c.preserved })), preservedHashes: Array.from(loaded.rows.entries()).filter(([t])=>!t.endsWith(":owners")).map(([table, rs]) => ({ table, rows: rs.map(r => ({ id: r.id ?? r.userId, hash: mergeDigest(r) })) })), warnings: plan.preview.warnings };
    const sourceProfile = recordSet(loaded,"agent_crm_profiles","userId",input.sourceUserId)[0];
    await connection.query("INSERT INTO agent_record_merges (sourceUserId,primaryUserId,sourceName,sourceEmail,sourceJltId,actorId,actorName,reason,previewDigest,manifestJson,mergedAt) VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))", [input.sourceUserId,input.primaryUserId,loaded.source.name,loaded.source.email,sourceProfile?.uniqueAgentId ?? null,actor.id,actor.name,input.reason.trim(),plan.digest,JSON.stringify(manifest)]);
    await connection.query("UPDATE users SET isActive=0, crmAccess=0, portalStatus='cancelled', suspensionReason=? WHERE id=? AND role='agent'", [`merged_into:${input.primaryUserId}`,input.sourceUserId]);
    // No financial or historic source profile value is modified. CRM archive
    // exclusion uses the dedicated mapping, not a fabricated cancellation event.
    for (const change of plan.changes) {
      const updatedAt = loaded.tables.get(change.policy.table)?.has("updatedAt") ? ", updatedAt=updatedAt" : "";
      const [result] = await connection.query<any>(`UPDATE ${q(change.policy.table)} SET ${q(change.policy.owner)}=?${updatedAt} WHERE id IN (${change.ids.map(()=>"?").join(",")}) AND ${q(change.policy.owner)}=?`, [input.primaryUserId,...change.ids,input.sourceUserId]);
      if (Number(result.affectedRows) !== change.ids.length) error(`Ownership changed unexpectedly in ${change.policy.table}. The entire merge was rolled back.`);
      const after = await rows(connection, `SELECT * FROM ${q(change.policy.table)} WHERE id IN (${change.ids.map(()=>"?").join(",")}) ORDER BY id`,change.ids);
      if (after.length !== change.ids.length || after.some(r => Number(r[change.policy.owner]) !== input.primaryUserId || safeRowHash(r,change.policy.owner) !== change.preserved.find(p=>p.id===Number(r.id))?.hash)) error(`Protected evidence changed in ${change.policy.table}; the entire merge was rolled back.`);
    }
    await rebuildPaymentCache(connection,plan,input.primaryUserId);
    await connection.commit();
    return { success: true, alreadyMerged: false, primaryUserId: input.primaryUserId };
  } catch (e) { await connection.rollback(); throw e; }
  finally {
    if (acquired) { try { const [released] = await connection.query<any[]>("SELECT RELEASE_LOCK(?) AS released",["jlt-gc-email-links"]); if (Number(released[0]?.released)!==1) throw new Error("Identity lock release not acknowledged"); } catch { connection.destroy(); destroyed=true; } }
    if (!destroyed && !dependencies?.connection) connection.release();
  }
}

export async function agentMergeCandidates(search: string): Promise<MergeAccount[]> {
  const pool = await getRawDbPool();
  try {
    const like = `%${search.replace(/[\\%_]/g,"\\$&")}%`;
    const found = await rows(pool, "SELECT u.id,u.name,u.email,u.portalStatus,u.lastSignedIn,p.uniqueAgentId,p.agentStatus FROM users u LEFT JOIN agent_crm_profiles p ON p.userId=u.id LEFT JOIN agent_record_merges m ON m.sourceUserId=u.id WHERE u.role='agent' AND m.id IS NULL AND (u.name LIKE ? OR u.email LIKE ? OR p.uniqueAgentId LIKE ? OR u.id=?) ORDER BY u.name,u.id LIMIT 25", [like,like,like,Number(search)||0]);
    return found.map(r=>({id:Number(r.id),name:r.name,email:r.email,jltId:r.uniqueAgentId??null,status:r.agentStatus??r.portalStatus,lastSignedIn:dateIso(r.lastSignedIn),bookings:0,courses:0,mandates:[],subscriptions:[]}));
  } catch(e:any) { if(e?.code==="ER_NO_SUCH_TABLE") error("Apply the Agent CRM merge history SQL to Railway before using merge.","PRECONDITION_FAILED"); throw e; }
}
export async function agentMergeHistory(userId: number): Promise<{archivedInto: number|null; entries: MergeHistoryEntry[]}> {
  const pool = await getRawDbPool();
  try {
    const found = await rows(pool,"SELECT * FROM agent_record_merges WHERE primaryUserId=? OR sourceUserId=? ORDER BY mergedAt DESC,id DESC",[userId,userId]);
    return { archivedInto: found.find(r=>Number(r.sourceUserId)===userId)?.primaryUserId ?? null, entries: found.map(r=>{const manifest=JSON.parse(r.manifestJson);return {id:r.id,sourceUserId:r.sourceUserId,primaryUserId:r.primaryUserId,sourceName:r.sourceName,sourceEmail:r.sourceEmail,sourceJltId:r.sourceJltId,actorName:r.actorName,reason:r.reason,mergedAt:dateIso(r.mergedAt)!,moves:manifest.moves??[],retained:manifest.retained??[]};}) };
  } catch(e:any) {if(e?.code==="ER_NO_SUCH_TABLE") error("Merge history SQL has not yet been applied on this database.","PRECONDITION_FAILED"); throw e;}
}
