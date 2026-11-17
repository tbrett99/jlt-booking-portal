import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { getRawDbPool } from "./db";
import { ENV } from "./_core/env";
import { hasManualJoiningFeeReceipt } from "./join-manual-receipt";

type Row = Record<string, any>;
export interface SignupLinkQuery { query(sql: string, args?: any[]): Promise<any>; }
export interface SignupLinkConnection extends SignupLinkQuery {
  beginTransaction(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>; release(): void;
  destroy?(): void;
}
export interface SignupLinkPool extends SignupLinkQuery { getConnection(): Promise<SignupLinkConnection>; }
export type SignupLinkActor = { id: number; role: string; isActive: boolean | number; portalStatus?: string };
export type CompletedSignupItem = {
  joinSessionId: number; userId: number; signerName: string; agentName: string | null;
  signupEmail: string; agentEmail: string | null; jltId: string | null;
  contractSignedAt: string; joiningFeePaidAt: string; membershipTier: string | null;
  membershipType: string | null; linkedProspectId: number | null;
};
const requiredColumns = ["id", "prospectId", "joinSessionId", "userId", "supersededProspectId", "linkedById", "linkedAt", "conversionAt", "reason"];
const uniqueColumns = ["id", "prospectId", "joinSessionId", "userId", "supersededProspectId"];
const foreignKeys: Record<string, string> = { prospectId: "recruitment_prospects", joinSessionId: "join_sessions", userId: "users", supersededProspectId: "recruitment_prospects", linkedById: "users" };
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const iso = (v: any): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:/.test(v) ? v.replace(" ", "T") + "Z" : v);
  return Number.isFinite(d.getTime()) && d.getUTCFullYear() >= 2000 ? d.toISOString() : null;
};
const stable = (v: any): string => v instanceof Date ? JSON.stringify(v.toISOString()) : Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v ?? null);
const digest = (v: any) => createHash("sha256").update(stable(v)).digest("hex");
const conflict = (message: string): never => { throw new TRPCError({ code: "CONFLICT", message }); };
const placeholders = (ids: unknown[]) => ids.map(() => "?").join(",");
const rows = async (db: SignupLinkQuery, sql: string, args: any[] = []): Promise<Row[]> => (await db.query(sql, args))[0];
const dateSql = (field: string, alias: string) => `DATE_FORMAT(${field},'%Y-%m-%dT%H:%i:%s.000Z') AS ${alias}`;
const linkProjection = `id,prospectId,joinSessionId,userId,supersededProspectId,linkedById,${dateSql("linkedAt", "linkedAt")},${dateSql("conversionAt", "conversionAt")},reason`;
const signupProjection = `j.id AS joinSessionId,j.userId,j.signerName,j.email AS signupEmail,u.name AS agentName,u.email AS agentEmail,p.uniqueAgentId AS jltId,p.id AS profileId,j.membershipTier,j.membershipType,${dateSql("j.contractSignedAt", "contractSignedAt")},${dateSql("j.joiningFeePaidAt", "joiningFeePaidAt")},j.step,j.consentConfirmed,u.role,u.isActive,u.portalStatus,p.agentStatus,${dateSql("j.updatedAt", "sessionUpdatedAt")},${dateSql("u.updatedAt", "userUpdatedAt")},${dateSql("p.updatedAt", "profileUpdatedAt")},(LENGTH(TRIM(COALESCE(j.signatureDataUrl,'')))>0) AS hasSignature,(LENGTH(TRIM(COALESCE(j.contractTextSnapshot,'')))>0) AS hasSnapshot,(CHAR_LENGTH(j.contractHash)=64 AND COALESCE(j.contractHash,'') REGEXP '^[0-9a-fA-F]{64}$') AS hasHash,(j.joiningFeeManualReceipt IS NOT NULL) AS hasManualReceipt`;
const signupFrom = "FROM join_sessions j JOIN users u ON u.id=j.userId LEFT JOIN agent_crm_profiles p ON p.userId=u.id";
const signupEligible = `j.step='complete' AND u.role='agent' AND u.isActive=1 AND u.portalStatus IN ('active','onboarding') AND p.id IS NOT NULL AND p.agentStatus='active' AND COALESCE(j.membershipType,'')<>'team_member' AND j.contractSignedAt IS NOT NULL AND YEAR(j.contractSignedAt)>=2000 AND LENGTH(TRIM(COALESCE(j.signerName,'')))>0 AND j.consentConfirmed=1 AND LENGTH(TRIM(COALESCE(j.signatureDataUrl,'')))>0 AND LENGTH(TRIM(COALESCE(j.contractTextSnapshot,'')))>0 AND CHAR_LENGTH(j.contractHash)=64 AND COALESCE(j.contractHash,'') REGEXP '^[0-9a-fA-F]{64}$' AND j.joiningFeePaidAt IS NOT NULL AND YEAR(j.joiningFeePaidAt)>=2000 AND NOT EXISTS (SELECT 1 FROM agent_record_merges m WHERE m.sourceUserId=u.id)`;
const customFields = ["applicationData", "applicationSubmittedAt", "adminNotes", "declineReason", "reviewedById", "reviewedAt", "referredById", "howHeard", "tierInterest", "calComEventId", "discoveryCallAt", "phone"];
const prospectProjection = `id,firstName,lastName,email,pipelineStage,source,howHeard,${dateSql("archivedAt", "archivedAt")},${dateSql("updatedAt", "updatedAt")},(${customFields.map(f => f === "applicationData" || /At$|Id$/.test(f) ? `${f} IS NOT NULL` : `LENGTH(TRIM(COALESCE(${f},'')))>0`).join(" OR ")}) AS hasCustomData,SHA2(CAST(JSON_OBJECT(${customFields.flatMap(f => [`'${f}'`, f]).join(",")}) AS CHAR),256) AS materialHash`;
const publicProspect = (p: Row) => ({ id: Number(p.id), name: `${p.firstName} ${p.lastName}`.trim(), email: p.email, pipelineStage: p.pipelineStage });
export function escapeSignupLike(value: string): string { return value.replace(/[\\%_]/g, c => `\\${c}`); }
export function assertSignupLinkAdmin(actor: SignupLinkActor): void {
  if (!positive(actor.id) || !["admin", "super_admin"].includes(actor.role) || ![true, 1].includes(actor.isActive) || ["cancelled", "paused", "suspended"].includes(actor.portalStatus ?? ""))
    throw new TRPCError({ code: "FORBIDDEN", message: "Only an active Admin or Super Admin can link a completed signup." });
}
function item(s: Row, linkedProspectId: number | null): CompletedSignupItem {
  return { joinSessionId: Number(s.joinSessionId), userId: Number(s.userId), signerName: s.signerName, agentName: s.agentName ?? null, signupEmail: s.signupEmail, agentEmail: s.agentEmail ?? null, jltId: s.jltId ?? null, contractSignedAt: iso(s.contractSignedAt)!, joiningFeePaidAt: iso(s.joiningFeePaidAt)!, membershipTier: s.membershipTier ?? null, membershipType: s.membershipType ?? null, linkedProspectId };
}
function eligible(s: Row): void {
  if (s.step !== "complete" || s.role !== "agent" || ![true, 1].includes(s.isActive) || !["active", "onboarding"].includes(s.portalStatus) || s.agentStatus !== "active" || !positive(Number(s.profileId)) || s.membershipType === "team_member" || !positive(Number(s.userId)) || !s.signerName?.trim() || !iso(s.contractSignedAt) || !iso(s.joiningFeePaidAt) || ![true, 1].includes(s.consentConfirmed) || ![s.hasSignature, s.hasSnapshot, s.hasHash].every(v => v === true || Number(v) === 1))
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Select a current active/onboarding, unmerged agent with a CRM profile, completed signed signup and joining fee recorded. This is Portal completion evidence, not provider settlement verification. Team invites and incomplete signups cannot be linked." });
}
export function validateAutomaticSignupDuplicate(p: Row, history: Row[], userId: number): void {
  if (p.source !== "direct_signup" || p.pipelineStage !== "won" || p.archivedAt || Number(p.hasCustomData) !== 0 || !history.length || history.length > 1000)
    conflict("The other recruitment record contains genuine enquiry or application data. Manual review is required; no records were changed.");
  let owned = false;
  for (const h of history) {
    if (h.changedById != null || !/^System \([^\r\n()]{1,150}\)$/.test(h.changedByName ?? "") || Number(h.noteLength) > 1000) conflict("The other record has staff history or unverified ownership. Manual review is required.");
    const text = h.note ?? "";
    const ids = [...text.matchAll(/user #([1-9][0-9]*)(?![0-9])/g)].map(m => Number(m[1]));
    if (ids.some(id => id !== userId)) conflict("The automatic recruitment record belongs to another agent. Manual review is required.");
    const match = /^Agent account created \(user #([1-9][0-9]*)\) — prospect record created automatically$/.exec(text);
    if (h.changedByName !== "System (account created)" || !match || Number(match[1]) !== userId || h.toStage !== "won" || (h.fromStage != null && h.fromStage !== "won")) conflict("The automatic record has unexpected stage history. Manual review is required.");
    owned = true;
  }
  if (!owned) conflict("The duplicate has no exact system account-created evidence for this agent. Manual review is required.");
}
type Claims = { purpose: string; actor: number; prospectId: number; joinSessionId: number; digest: string; expiry: number };
function tokenFor(claim: Claims, secret: string): string {
  if (!secret) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The Portal signing secret is not configured." });
  const body = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
function readToken(token: string, actor: number, prospectId: number, joinSessionId: number, secret: string, now: number): Claims {
  if (!secret) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The Portal signing secret is not configured." });
  try {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra || token.length > 2000) throw new Error();
    const given = Buffer.from(signature, "base64url"), wanted = createHmac("sha256", secret).update(body).digest();
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw new Error();
    const claim = JSON.parse(Buffer.from(body, "base64url").toString());
    if (claim.purpose !== "recruitment-signup-link-v1" || claim.actor !== actor || claim.prospectId !== prospectId || claim.joinSessionId !== joinSessionId || !Number.isFinite(claim.expiry) || claim.expiry <= now || claim.expiry > now + 600000 || typeof claim.digest !== "string") throw new Error();
    return claim;
  } catch { return conflict("The preview is invalid, expired, or belongs to another administrator. Refresh and review it; nothing was changed."); }
}
function sanitized(error: any): never {
  if (error instanceof TRPCError) throw error;
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Recruitment signup linking is not deployed completely. Apply the Railway SQL migration before using this feature." });
  if (["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error?.code)) conflict("Another administrator changed these records. Refresh the preview; no partial changes were saved.");
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The signup link could not be saved or read reliably. Refresh its state before retrying." });
}
/** Dependencies are injected only for offline tests; never a weaker database fallback. */
export function createRecruitmentSignupLinkService(options: { pool?: SignupLinkPool; getPool?: () => Promise<SignupLinkPool>; secret?: string; now?: () => number } = {}) {
  const now = options.now ?? Date.now, secret = options.secret ?? ENV.cookieSecret;
  const getPool = options.getPool ?? (async () => options.pool ?? await getRawDbPool());
  let readyUntil = 0;
  async function readiness(db: SignupLinkQuery) {
    if (now() < readyUntil) return;
    const columns = await rows(db, "SELECT COLUMN_NAME AS name,IS_NULLABLE AS nullable,DATA_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='recruitment_signup_links'");
    const indexes = await rows(db, "SELECT INDEX_NAME AS name,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS ordinal FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='recruitment_signup_links' AND NON_UNIQUE=0 ORDER BY INDEX_NAME,SEQ_IN_INDEX");
    const fks = await rows(db, "SELECT COLUMN_NAME AS columnName,REFERENCED_TABLE_NAME AS target,REFERENCED_COLUMN_NAME AS targetColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='recruitment_signup_links' AND REFERENCED_TABLE_NAME IS NOT NULL");
    const grouped = new Map<string, string[]>();
    for (const i of indexes) grouped.set(i.name, [...(grouped.get(i.name) ?? []), i.columnName]);
    if (requiredColumns.some(c => !columns.some(r => r.name === c && (c === "supersededProspectId" ? r.nullable === "YES" : r.nullable === "NO") && (c.endsWith("At") ? r.type === "timestamp" : c === "reason" ? r.type === "text" : r.type === "int"))) || uniqueColumns.some(c => !Array.from(grouped.values()).some(v => v.length === 1 && v[0] === c)) || !grouped.get("PRIMARY")?.includes("id") || Object.entries(foreignKeys).some(([c, table]) => !fks.some(f => f.columnName === c && f.target === table && f.targetColumn === "id")))
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Recruitment signup links require the complete Railway SQL migration (columns, unique constraints and foreign keys). Apply it before using this feature." });
    readyUntil = now() + 60000;
  }
  async function utc(db: SignupLinkConnection): Promise<string> {
    const zone = (await rows(db, "SELECT @@session.time_zone AS sessionTimeZone"))[0]?.sessionTimeZone;
    if (typeof zone !== "string" || !zone) throw new Error("Database timezone unavailable");
    await db.query("SET time_zone='+00:00'"); return zone;
  }
  async function finish(db: SignupLinkConnection, zone?: string, broken = false) {
    if (!broken && zone) { try { await db.query("SET time_zone=?", [zone]); } catch { broken = true; } }
    if (broken) db.destroy?.(); else db.release();
  }
  async function actorFresh(db: SignupLinkQuery, actor: SignupLinkActor, lock = false, userId?: number) {
    assertSignupLinkAdmin(actor);
    const ids = Array.from(new Set([actor.id, ...(userId ? [userId] : [])])).sort((a,b) => a-b);
    const users = await rows(db, `SELECT id,name,role,isActive,portalStatus FROM users WHERE id IN (${placeholders(ids)}) ORDER BY id${lock ? " FOR UPDATE" : ""}`, ids);
    const current = users.find(u => Number(u.id) === actor.id);
    if (!current) throw new TRPCError({ code: "FORBIDDEN", message: "Your administrator account is no longer available." });
    assertSignupLinkAdmin(current as SignupLinkActor);
    return current;
  }
  async function historyIds(db: SignupLinkQuery, userId: number, lock = false) {
    const suffix = lock ? " FOR UPDATE" : "";
    if ((await rows(db, `SELECT sourceUserId,primaryUserId FROM agent_record_merges WHERE sourceUserId=?${suffix}`, [userId])).length) conflict("Merged agent archives cannot be linked. Select the current primary agent.");
    const ids = new Set([userId]); let frontier = [userId]; const material: Row[] = [];
    for (let depth = 0; frontier.length; depth++) {
      if (depth >= 50 || ids.size > 1000) conflict("Agent merge history requires manual review.");
      const found = await rows(db, `SELECT sourceUserId,primaryUserId FROM agent_record_merges WHERE primaryUserId IN (${placeholders(frontier)}) ORDER BY sourceUserId LIMIT 1001${suffix}`, frontier);
      if (found.length > 1000) conflict("Agent merge history requires manual review.");
      frontier = [];
      for (const m of found) {
        const id = Number(m.sourceUserId);
        if (!positive(id) || ids.has(id)) conflict("Agent merge history is ambiguous. Manual review is required.");
        ids.add(id); frontier.push(id); material.push(m);
      }
    }
    return { ids: Array.from(ids).sort((a,b) => a-b), material };
  }
  async function history(db: SignupLinkQuery, ids: number[], lock: boolean) {
    const h = await rows(db, `SELECT id,prospectId,fromStage,toStage,changedById,changedByName,LEFT(note,1001) AS note,CHAR_LENGTH(COALESCE(note,'')) AS noteLength,SHA2(COALESCE(note,''),256) AS noteHash,${dateSql("changedAt", "changedAt")} FROM recruitment_stage_history WHERE prospectId IN (${placeholders(ids)}) ORDER BY prospectId,id LIMIT 1001${lock ? " FOR UPDATE" : ""}`, ids);
    if (h.length > 1000) conflict("Recruitment history requires manual review before linking.");
    return h;
  }
  async function scope(db: SignupLinkQuery, actor: SignupLinkActor, prospectId: number, joinSessionId: number, lock = false) {
    if (!positive(prospectId) || !positive(joinSessionId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose valid positive prospect and signup IDs." });
    const initial = (await rows(db, "SELECT userId FROM join_sessions WHERE id=?", [joinSessionId]))[0];
    if (!initial || !positive(Number(initial.userId))) throw new TRPCError({ code: "NOT_FOUND", message: "Completed signup not found." });
    const currentActor = await actorFresh(db, actor, lock, Number(initial.userId));
    // Fingerprints are ephemeral, scope-only state signatures; no private evidence values leave SQL.
    const evidence = "SHA2(CONCAT_WS(':',SHA2(COALESCE(j.signatureDataUrl,''),256),SHA2(COALESCE(j.contractTextSnapshot,''),256),SHA2(COALESCE(j.contractHash,''),256)),256) AS evidenceStateHash";
    const signup = (await rows(db, `SELECT ${signupProjection},${evidence} ${signupFrom} WHERE j.id=?${lock ? " FOR UPDATE" : ""}`, [joinSessionId]))[0];
    if (!signup || Number(signup.userId) !== Number(initial.userId)) conflict("The selected signup changed. Refresh the preview.");
    eligible(signup);
    const aliases = await historyIds(db, Number(signup.userId), lock);
    let receiptMaterial: Row | null = null;
    if (Number(signup.hasManualReceipt) === 1) {
      receiptMaterial = (await rows(db, `SELECT id,userId,email,billingRequestId,contractHash,${dateSql("contractSignedAt", "contractSignedAt")},${dateSql("joiningFeePaidAt", "joiningFeePaidAt")},joiningFeeManualReceipt FROM join_sessions WHERE id=?${lock ? " FOR UPDATE" : ""}`, [joinSessionId]))[0] ?? null;
      try {
        if (!receiptMaterial || !hasManualJoiningFeeReceipt({ ...receiptMaterial, id: Number(receiptMaterial.id), userId: Number(receiptMaterial.userId), email: receiptMaterial.email, billingRequestId: receiptMaterial.billingRequestId, contractHash: receiptMaterial.contractHash, contractSignedAt: iso(receiptMaterial.contractSignedAt) ? new Date(iso(receiptMaterial.contractSignedAt)!) : null, joiningFeePaidAt: iso(receiptMaterial.joiningFeePaidAt) ? new Date(iso(receiptMaterial.joiningFeePaidAt)!) : null, joiningFeeManualReceipt: typeof receiptMaterial.joiningFeeManualReceipt === "string" ? JSON.parse(receiptMaterial.joiningFeeManualReceipt) : receiptMaterial.joiningFeeManualReceipt })) throw new Error();
      } catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The existing manual joining fee receipt is malformed or no longer matches this signed signup. Manual review is required; no provider fallback is permitted." }); }
    }
    const emails = Array.from(new Set([signup.signupEmail, signup.agentEmail].filter(Boolean).map((s: string) => s.trim().toLowerCase())));
    const prospects = await rows(db, `SELECT ${prospectProjection} FROM recruitment_prospects WHERE id=? OR LOWER(TRIM(email)) IN (${placeholders(emails)}) ORDER BY id${lock ? " FOR UPDATE" : ""}`, [prospectId, ...emails]);
    const prospect = prospects.find(p => Number(p.id) === prospectId);
    if (!prospect) throw new TRPCError({ code: "NOT_FOUND", message: "Recruitment enquiry not found." });
    const prospectIds = prospects.map(p => Number(p.id));
    const links = await rows(db, `SELECT ${linkProjection} FROM recruitment_signup_links WHERE prospectId IN (${placeholders(prospectIds)}) OR supersededProspectId IN (${placeholders(prospectIds)}) OR joinSessionId=? OR userId IN (${placeholders(aliases.ids)}) ORDER BY id${lock ? " FOR UPDATE" : ""}`, [...prospectIds, ...prospectIds, joinSessionId, ...aliases.ids]);
    const existing = links.find(l => Number(l.prospectId) === prospectId && Number(l.joinSessionId) === joinSessionId && Number(l.userId) === Number(signup.userId));
    if (links.some(l => !existing || Number(l.id) !== Number(existing.id))) conflict("This enquiry, signup, or agent's merged identity history is already linked to another recruitment record.");
    if (existing) return { prospect, signup, duplicate: null, existing, currentActor, digest: "" };
    if (prospect.archivedAt || prospect.pipelineStage === "archived") conflict("Archived or superseded enquiries cannot be linked.");
    if (["ar_declined", "onboarding_declined", "declined", "waitlisted"].includes(prospect.pipelineStage)) conflict("This enquiry has an existing decline or waitlist decision. Manual review is required before linking.");
    const competitors = await rows(db, `SELECT id FROM join_sessions WHERE userId IN (${placeholders(aliases.ids)}) AND step='complete' AND contractSignedAt IS NOT NULL AND YEAR(contractSignedAt)>=2000 AND LENGTH(TRIM(COALESCE(signerName,'')))>0 AND consentConfirmed=1 AND LENGTH(TRIM(COALESCE(signatureDataUrl,'')))>0 AND LENGTH(TRIM(COALESCE(contractTextSnapshot,'')))>0 AND CHAR_LENGTH(contractHash)=64 AND COALESCE(contractHash,'') REGEXP '^[0-9a-fA-F]{64}$' AND joiningFeePaidAt IS NOT NULL AND YEAR(joiningFeePaidAt)>=2000 ORDER BY id LIMIT 2${lock ? " FOR UPDATE" : ""}`, aliases.ids);
    if (competitors.length !== 1 || Number(competitors[0].id) !== joinSessionId) conflict("This agent has competing completed signed signup applications. Manual review is required.");
    const others = prospects.filter(p => Number(p.id) !== prospectId);
    if (others.length > 1) conflict("Multiple recruitment records share the signup or agent email. Manual review is required; no arbitrary duplicate will be retired.");
    const histories = await history(db, prospectIds, lock);
    const duplicate = others[0] ?? null;
    if (duplicate) validateAutomaticSignupDuplicate(duplicate, histories.filter(h => Number(h.prospectId) === Number(duplicate.id)), Number(signup.userId));
    return { prospect, signup, duplicate, existing: undefined, currentActor, digest: digest({ prospect, signup, duplicate, histories, aliases: aliases.material, links, competitors, receiptMaterial }) };
  }
  async function read<T>(actor: SignupLinkActor, fn: (db: SignupLinkQuery) => Promise<T>): Promise<T> {
    assertSignupLinkAdmin(actor);
    let db: SignupLinkConnection | undefined, zone: string | undefined;
    try { const pool = await getPool(); await readiness(pool); db = await pool.getConnection(); zone = await utc(db); await actorFresh(db, actor); return await fn(db); }
    catch (e) { return sanitized(e); }
    finally { if (db) await finish(db,zone); }
  }
  return {
    signupLinkState(actor: SignupLinkActor, prospectId: number) {
      if (!positive(prospectId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a positive prospect ID." });
      return read(actor, async db => {
        if (!(await rows(db, "SELECT id FROM recruitment_prospects WHERE id=?", [prospectId])).length) throw new TRPCError({ code: "NOT_FOUND", message: "Recruitment enquiry not found." });
        const linked = (await rows(db, `SELECT l.id,l.prospectId,l.joinSessionId,l.userId,l.supersededProspectId,a.name AS linkedByName,${dateSql("l.linkedAt", "linkedAt")},${dateSql("l.conversionAt", "conversionAt")},l.reason,u.name AS agentName,u.email AS agentEmail,p.uniqueAgentId AS jltId,j.email AS signupEmail FROM recruitment_signup_links l JOIN users a ON a.id=l.linkedById JOIN users u ON u.id=l.userId JOIN join_sessions j ON j.id=l.joinSessionId LEFT JOIN agent_crm_profiles p ON p.userId=u.id WHERE l.prospectId=?`, [prospectId]))[0];
        const superseded = (await rows(db, "SELECT prospectId FROM recruitment_signup_links WHERE supersededProspectId=?", [prospectId]))[0];
        return { link: linked ? { id: Number(linked.id), prospectId: Number(linked.prospectId), joinSessionId: Number(linked.joinSessionId), userId: Number(linked.userId), supersededProspectId: linked.supersededProspectId == null ? null : Number(linked.supersededProspectId), linkedByName: linked.linkedByName ?? null, linkedAt: iso(linked.linkedAt)!, conversionAt: iso(linked.conversionAt)!, reason: linked.reason, agentName: linked.agentName ?? null, agentEmail: linked.agentEmail ?? null, jltId: linked.jltId ?? null, signupEmail: linked.signupEmail } : null, supersededBy: superseded ? { prospectId: Number(superseded.prospectId) } : null };
      });
    },
    searchCompletedSignups(actor: SignupLinkActor, input: { search: string; cursor?: number }) {
      const search = input.search.trim();
      if (search.length < 2 || search.length > 150 || (input.cursor != null && !positive(input.cursor))) throw new TRPCError({ code: "BAD_REQUEST", message: "Search must contain 2–150 characters and a valid cursor." });
      return read(actor, async db => {
        const tokens = search.split(/\s+/).map(t => `%${escapeSignupLike(t)}%`);
        const names = tokens.map(() => "(j.signerName LIKE ? ESCAPE '\\\\' OR u.name LIKE ? ESCAPE '\\\\')").join(" AND ");
        const whole = `%${escapeSignupLike(search)}%`;
        const selected = await rows(db, `SELECT ${signupProjection} ${signupFrom} WHERE ${signupEligible} AND j.id>? AND (j.email LIKE ? ESCAPE '\\\\' OR u.email LIKE ? ESCAPE '\\\\' OR p.uniqueAgentId LIKE ? ESCAPE '\\\\' OR (${names})) ORDER BY j.id LIMIT 31`, [input.cursor ?? 0, whole, whole, whole, ...tokens.flatMap(t => [t,t])]);
        const items: CompletedSignupItem[] = [];
        for (const s of selected.slice(0,30)) {
          eligible(s);
          const aliases = await historyIds(db, Number(s.userId));
          const links = await rows(db, `SELECT prospectId FROM recruitment_signup_links WHERE userId IN (${placeholders(aliases.ids)}) OR joinSessionId=? ORDER BY id LIMIT 2`, [...aliases.ids, Number(s.joinSessionId)]);
          if (links.length > 1) conflict("An agent has conflicting historical recruitment links. Manual review is required.");
          items.push(item(s, links[0] ? Number(links[0].prospectId) : null));
        }
        return { items, hasMore: selected.length > 30, nextCursor: selected.length > 30 ? items[items.length-1].joinSessionId : null };
      });
    },
    previewSignupLink(actor: SignupLinkActor, input: { prospectId: number; joinSessionId: number }) {
      return read(actor, async db => {
        const loaded = await scope(db, actor, input.prospectId, input.joinSessionId);
        const expiry = now() + 600000;
        return { prospect: { ...publicProspect(loaded.prospect), source: loaded.prospect.source ?? null, howHeard: loaded.prospect.howHeard ?? null }, signup: item(loaded.signup, loaded.existing ? input.prospectId : null), duplicate: loaded.duplicate ? publicProspect(loaded.duplicate) : null, conversionAt: iso(loaded.existing?.conversionAt ?? loaded.signup.joiningFeePaidAt)!, token: tokenFor({ purpose: "recruitment-signup-link-v1", actor: actor.id, ...input, digest: loaded.digest, expiry }, secret), expiresAt: new Date(expiry).toISOString(), alreadyLinked: !!loaded.existing };
      });
    },
    async confirmSignupLink(actor: SignupLinkActor, input: { prospectId: number; joinSessionId: number; token: string; reason: string; samePersonConfirmed: true }) {
      assertSignupLinkAdmin(actor);
      if (!positive(input.prospectId) || !positive(input.joinSessionId) || input.samePersonConfirmed !== true || typeof input.reason !== "string" || input.reason.trim().length < 5 || input.reason.trim().length > 1000) throw new TRPCError({ code: "BAD_REQUEST", message: "Confirm these are the same person, provide valid IDs and a reason of 5–1000 characters." });
      const claim = readToken(input.token, actor.id, input.prospectId, input.joinSessionId, secret, now());
      let db: SignupLinkConnection | undefined, begun = false, zone: string | undefined, broken = false;
      try {
        const pool = await getPool(); await readiness(pool); db = await pool.getConnection();
        zone = await utc(db);
        await db.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        await db.beginTransaction(); begun = true;
        const loaded = await scope(db, actor, input.prospectId, input.joinSessionId, true);
        readToken(input.token, actor.id, input.prospectId, input.joinSessionId, secret, now());
        const response = (alreadyLinked: boolean, supersededProspectId: number | null) => ({ linked: true as const, alreadyLinked, prospectId: input.prospectId, userId: Number(loaded.signup.userId), supersededProspectId });
        if (loaded.existing) { await db.commit(); begun = false; return response(true, loaded.existing.supersededProspectId == null ? null : Number(loaded.existing.supersededProspectId)); }
        if (claim.digest !== loaded.digest) conflict("These records or their history changed since preview. Refresh and review again; nothing was changed.");
        const duplicateId = loaded.duplicate ? Number(loaded.duplicate.id) : null;
        const timestamp = new Date(now()).toISOString().slice(0,19).replace("T", " ");
        const conversion = iso(loaded.signup.joiningFeePaidAt)!.slice(0,19).replace("T", " ");
        const reason = input.reason.trim();
        const write = async (sql: string, args: any[], count: number) => {
          const [result] = await db!.query(sql,args);
          if (Number(result.affectedRows) !== count) conflict("A guarded recruitment write failed. All signup-link changes were rolled back.");
        };
        await write("INSERT INTO recruitment_signup_links (prospectId,joinSessionId,userId,supersededProspectId,linkedById,linkedAt,conversionAt,reason) VALUES (?,?,?,?,?,?,?,?)", [input.prospectId,input.joinSessionId,Number(loaded.signup.userId),duplicateId,actor.id,timestamp,conversion,reason],1);
        if (loaded.prospect.pipelineStage !== "won") await write("UPDATE recruitment_prospects SET pipelineStage='won',archivedAt=NULL,updatedAt=? WHERE id=? AND pipelineStage=? AND archivedAt IS NULL", [timestamp,input.prospectId,loaded.prospect.pipelineStage],1);
        const note = `Manual completed signup link: session #${input.joinSessionId}, user #${loaded.signup.userId}; joining fee recorded ${iso(loaded.signup.joiningFeePaidAt)} (conversion date, not audit date; Portal completion evidence only, not provider settlement verification). Reason: ${reason}`;
        if (loaded.prospect.pipelineStage !== "won") await write("INSERT INTO recruitment_stage_history (prospectId,fromStage,toStage,changedById,changedByName,note,changedAt) VALUES (?,?,?,?,?,?,?)", [input.prospectId,loaded.prospect.pipelineStage,"won",actor.id,loaded.currentActor.name ?? "Admin",note,timestamp],1);
        if (duplicateId) {
          await write("UPDATE recruitment_prospects SET archivedAt=?,updatedAt=?,pipelineStage='archived' WHERE id=? AND source='direct_signup' AND pipelineStage='won' AND archivedAt IS NULL", [timestamp,timestamp,duplicateId],1);
          await write("INSERT INTO recruitment_stage_history (prospectId,fromStage,toStage,changedById,changedByName,note,changedAt) VALUES (?,?,?,?,?,?,?)", [duplicateId,"won","archived",actor.id,loaded.currentActor.name ?? "Admin",`Automatic signup record superseded by original enquiry #${input.prospectId}; history and emails preserved. ${note}`,timestamp],1);
        }
        const ids = [input.prospectId,...(duplicateId ? [duplicateId] : [])].sort((a,b) => a-b);
        const changed = await rows(db, `SELECT id,pipelineStage,${dateSql("archivedAt", "archivedAt")} FROM recruitment_prospects WHERE id IN (${placeholders(ids)}) ORDER BY id`, ids);
        if (changed.length !== ids.length || changed.some(p => Number(p.id) === input.prospectId ? p.pipelineStage !== "won" || p.archivedAt != null : p.pipelineStage !== "archived" || !iso(p.archivedAt))) conflict("Recruitment stage or archive readback failed. All changes were rolled back.");
        const active = await rows(db, `SELECT id FROM recruitment_workflow_enrollments WHERE prospectId IN (${placeholders(ids)}) AND cancelledAt IS NULL ORDER BY id FOR UPDATE`, ids);
        if (active.length) await write(`UPDATE recruitment_workflow_enrollments SET cancelledAt=?,nextSendAt=NULL WHERE id IN (${placeholders(active)}) AND cancelledAt IS NULL`, [timestamp,...active.map(r => r.id)],active.length);
        if (active.length) {
          const cancelled = await rows(db, `SELECT id,${dateSql("cancelledAt", "cancelledAt")},${dateSql("nextSendAt", "nextSendAt")} FROM recruitment_workflow_enrollments WHERE id IN (${placeholders(active)}) ORDER BY id`, active.map(r => r.id));
          if (cancelled.length !== active.length || cancelled.some(w => !iso(w.cancelledAt) || w.nextSendAt != null)) conflict("Recruitment workflow cancellation readback failed; all changes were rolled back.");
        }
        if ((await rows(db, `SELECT id FROM recruitment_workflow_enrollments WHERE prospectId IN (${placeholders(ids)}) AND cancelledAt IS NULL AND nextSendAt IS NOT NULL`, ids)).length) conflict("Recruitment workflow cancellation could not be verified; all changes were rolled back.");
        const saved = (await rows(db, `SELECT ${linkProjection} FROM recruitment_signup_links WHERE prospectId=?`, [input.prospectId]))[0];
        if (!saved || Number(saved.joinSessionId) !== input.joinSessionId || Number(saved.userId) !== Number(loaded.signup.userId) || Number(saved.linkedById) !== actor.id || (saved.supersededProspectId == null ? null : Number(saved.supersededProspectId)) !== duplicateId || iso(saved.conversionAt) !== iso(loaded.signup.joiningFeePaidAt) || saved.reason !== reason) conflict("The durable signup link could not be verified. All changes were rolled back.");
        await db.commit(); begun = false; return response(false,duplicateId);
      } catch (e) { if (begun && db) { try { await db.rollback(); } catch { broken = true; } } sanitized(e); }
      finally { if (db) await finish(db,zone,broken); }
    },
  };
}
const defaultService = createRecruitmentSignupLinkService();
export const signupLinkState = defaultService.signupLinkState;
export const searchCompletedSignups = defaultService.searchCompletedSignups;
export const previewSignupLink = defaultService.previewSignupLink;
export const confirmSignupLink = defaultService.confirmSignupLink;
