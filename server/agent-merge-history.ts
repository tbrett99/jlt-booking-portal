import { TRPCError } from "@trpc/server";
import { getRawDbPool } from "./db";
const iso = (v: any): string | null => v ? new Date(v).toISOString() : null;
function movedIds(manifest: any, table: string): number[] { return (manifest.changes?.find((c: any)=>c.table===table)?.rows??[]).map((r: any)=>Number(r.id)).filter((id: number)=>Number.isSafeInteger(id)&&id>0).slice(0,500); }
function safeLink(value: unknown): value is string { return typeof value==="string" && (/^https?:\/\//i.test(value)||/^\/(?!\/)/.test(value)); }
export async function archivedAgentDetails(sourceUserId: number) {
  const pool = await getRawDbPool();
  const [mergeRows]: any = await pool.query("SELECT sourceUserId,primaryUserId,manifestJson FROM agent_record_merges WHERE sourceUserId=? LIMIT 1",[sourceUserId]);
  if (!mergeRows[0]) throw new TRPCError({code:"NOT_FOUND",message:"This record is not a merged archive."});
  const mapping=mergeRows[0], primaryUserId=Number(mapping.primaryUserId), manifest=JSON.parse(mapping.manifestJson), original=manifest.sourceIdentity??{}, p=manifest.sourceProfile??{};
  const fields: [string,string][]=[["Original name",original.name],["Original login email",original.email],["Original JLT ID",p.uniqueAgentId],["Original membership status",p.agentStatus??original.portalStatus],["Original membership tier",p.membershipTier],["Original business name",p.businessName],["Original personal email",p.personalEmail],["Original business email",p.businessEmail],["Original JLT email",p.jltEmail],["Original training stage",p.trainingStage],["Original team ID",p.teamId],["Original correspondence choice",p.correspondenceEmailKind]];
  const profile=fields.filter(([,v])=>v!==null&&v!==undefined&&v!=="").map(([label,value])=>({label,value:String(value)}));
  const documents=[{label:"Original ID document",url:p.idDocUrl},{label:"Original proof of address",url:p.proofOfAddressUrl}].filter((d): d is {label:string;url:string}=>safeLink(d.url));
  const [tables]: any=await pool.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
  const has=new Set(tables.map((r:any)=>r.name));
  const read=async(query:string,args:any[]=[])=>{const [r]:any=await pool.query(query,args);return r as any[];};
  const notesIds=movedIds(manifest,"agent_crm_notes"), courseIds=movedIds(manifest,"academy_enrollments"), actionIds=movedIds(manifest,"academy_action_assignments");
  const scope=(owner:string, ids:number[])=>`(${owner}=?${ids.length?` OR id IN (${ids.map(()=>"?").join(",")})`:""})`;
  const notes=has.has("agent_crm_notes")?await read(`SELECT id,content,authorName,createdAt FROM agent_crm_notes WHERE ${scope("agentUserId",notesIds)} AND agentUserId IN (?,?) ORDER BY createdAt DESC,id DESC LIMIT 100`,[sourceUserId,...notesIds,sourceUserId,primaryUserId]):[];
  const enrolments=has.has("academy_enrollments")?await read(`SELECT id,courseId,status,completedAt FROM academy_enrollments WHERE ${scope("agentId",courseIds)} AND agentId IN (?,?) ORDER BY id DESC LIMIT 100`,[sourceUserId,...courseIds,sourceUserId,primaryUserId]):[];
  const courses=[] as Array<{enrollmentId:number;title:string;status:string;completedAt:string|null;attempts:number}>;
  for(const e of enrolments){const course=has.has("academy_courses")?(await read("SELECT title FROM academy_courses WHERE id=? LIMIT 1",[e.courseId]))[0]:null;const count=has.has("academy_assessment_attempts")?(await read("SELECT COUNT(*) AS n FROM academy_assessment_attempts WHERE enrollmentId=?",[e.id]))[0]?.n:0;courses.push({enrollmentId:Number(e.id),title:course?.title??`Course ${e.courseId}`,status:e.status,completedAt:iso(e.completedAt),attempts:Number(count??0)});}
  const actions=has.has("academy_action_assignments")?await read(`SELECT id,planId,status,submittedAt FROM academy_action_assignments WHERE ${scope("agentId",actionIds)} AND agentId IN (?,?) ORDER BY id DESC LIMIT 100`,[sourceUserId,...actionIds,sourceUserId,primaryUserId]):[];
  const actionSummaries=[] as Array<{id:number;title:string;status:string;submittedAt:string|null}>;
  for(const a of actions){const plan=has.has("academy_action_plans")?(await read("SELECT title FROM academy_action_plans WHERE id=? LIMIT 1",[a.planId]))[0]:null;actionSummaries.push({id:Number(a.id),title:plan?.title??`Action ${a.planId}`,status:a.status,submittedAt:iso(a.submittedAt)});}
  const contracts=[] as Array<{kind:string;name:string|null;signedAt:string|null}>;
  if(has.has("contract_signatures"))for(const r of await read("SELECT signerName,signedAt FROM contract_signatures WHERE userId=? ORDER BY signedAt DESC,id DESC LIMIT 100",[sourceUserId]))contracts.push({kind:"Original signed contract",name:r.signerName,signedAt:iso(r.signedAt)});
  if(has.has("terms_signings"))for(const r of await read("SELECT signedName,signedAt FROM terms_signings WHERE userId=? ORDER BY signedAt DESC,id DESC LIMIT 100",[sourceUserId]))contracts.push({kind:"Original signed terms",name:r.signedName,signedAt:iso(r.signedAt)});
  return {sourceUserId,primaryUserId,profile,documents,notes:notes.map(n=>({...n,createdAt:iso(n.createdAt)!})),courses,contracts,actions:actionSummaries};
}
