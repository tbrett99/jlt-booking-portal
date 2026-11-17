import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { BUSINESS_STAFF_ORBIT_NOTICE } from "../shared/business-staff";

const guards = vi.hoisted(() => ({ pool: vi.fn(), authority: vi.fn(), boundary: vi.fn(async () => {}) }));
vi.mock("./db", () => ({ getRawDbPool: guards.pool }));
vi.mock("./business-staff-access", () => ({ getBusinessStaffAuthority: guards.authority, assertBusinessStaffRouteAllowed: guards.boundary }));
import { businessStaffRouter } from "./business-staff-management-router";
import { createBusinessStaffManagement } from "./business-staff-management";

type Row = Record<string, any>;
const defaultPermissions = { viewBookings:true,viewCustomerAmounts:false,addBookingNotes:false,academyAccess:true };
const why = "Synthetic administrative test reason";
const link = () => ({ ownerUserId:20,staffUserId:30,permissions:{...defaultPermissions},orbitRequested:false,reason:why,restrictedStaffOnlyConfirmed:true as const,preserveExistingDataConfirmed:true as const });
const create = () => ({ ownerUserId:20,name:"Synthetic Staff",email:"new-staff@example.test",permissions:{...defaultPermissions},orbitRequested:false,reason:why,restrictedStaffOnlyConfirmed:true as const,preserveExistingDataConfirmed:true as const });
const request = () => ({ membershipId:1,revision:1,reason:why });
const columnFixtures: Record<string,string[]> = {
  users:["id","name","email","role","isActive","portalStatus","loginMethod","openId","tempPassword","mustChangePassword","crmAccess"],
  agent_crm_profiles:["id","userId","agentStatus"],agent_record_merges:["id","sourceUserId","sourceEmail"],staff_role_assignments:["id","userId","staffRole","isActive"],
  business_staff_memberships:["id","ownerUserId","staffUserId","status","permissions","orbitRequested","revision","createdById","createdAt","updatedAt","revokedAt"],
  business_staff_audit:["id","membershipId","actorUserId","action","reason","beforeState","afterState","createdAt"],
  business_staff_booking_notes:["id","bookingId","ownerUserId","authorUserId","membershipId","text","createdAt"],password_reset_tokens:["id","userId","token","expiresAt","usedAt","createdAt"],
};
const fkFixtures = [
  ["business_staff_memberships","ownerUserId","users"],["business_staff_memberships","staffUserId","users"],["business_staff_memberships","createdById","users"],
  ["business_staff_audit","membershipId","business_staff_memberships"],["business_staff_audit","actorUserId","users"],
  ["business_staff_booking_notes","bookingId","bookings"],["business_staff_booking_notes","ownerUserId","users"],["business_staff_booking_notes","authorUserId","users"],["business_staff_booking_notes","membershipId","business_staff_memberships"],
].map(([tableName,columnName,referencedTable])=>({tableName,columnName,referencedTable,referencedColumn:"id"}));
function account(id:number, role="agent", status="active") {
  return { id,name:`Synthetic Account ${id}`,email:`account-${id}@example.test`,role,portalStatus:status,isActive:1,loginMethod:"password",openId:`synthetic-${id}`,tempPassword:"INERT_EXISTING_HASH",mustChangePassword:0,crmAccess:0,privateBank:"INERT_BANK_SHOULD_NOT_LEAK",privateHistory:{academy:"retained",billing:"retained",signing:"retained"} };
}
class RawFixture {
  users: Row[] = [account(10,"admin"),account(20),account(30,"agent","onboarding"),account(40)];
  profiles: Row[] = [{id:1,userId:20,agentStatus:"active",bankAccountNumber:"INERT_BANK"}];
  merges: Row[]=[]; assignments:Row[]=[]; members:Row[]=[]; audit:Row[]=[]; tokens:Row[]=[];
  calls:{sql:string,args:any[]}[]=[]; snapshot:any; columns=structuredClone(columnFixtures); fk=structuredClone(fkFixtures);
  unique=true; failSql:string|null=null; failCode="ER_NO_SUCH_TABLE"; failCas=false; timezone="+02:00";
  beginTransaction=vi.fn(async()=>{this.snapshot=structuredClone({users:this.users,profiles:this.profiles,merges:this.merges,assignments:this.assignments,members:this.members,audit:this.audit,tokens:this.tokens});});
  commit=vi.fn(async()=>{this.snapshot=null;});
  rollback=vi.fn(async()=>{if(this.snapshot) Object.assign(this,this.snapshot);this.snapshot=null;});
  release=vi.fn(); destroy=vi.fn();
  seed(status="active") { this.members.push({id:1,ownerUserId:20,staffUserId:30,status,revision:1,permissions:JSON.stringify(defaultPermissions),orbitRequested:0,createdAt:"2026-01-01 00:00:00",revokedAt:status==="revoked"?"2026-01-02 00:00:00":null,privateSecret:"INERT_MEMBER_SECRET"}); }
  async query(sql:string,args:any[]=[]):Promise<any> {
    this.calls.push({sql,args:structuredClone(args)});
    if (this.failSql && sql.includes(this.failSql)) throw Object.assign(new Error("PRIVATE QUERY ERROR email=private@example.test hash=INERT"),{code:this.failCode});
    if(sql==="SELECT @@session.time_zone AS timeZone") return [[{timeZone:this.timezone}],[]];
    if(sql.startsWith("SET time_zone")) {this.timezone=args[0]??"+00:00";return [[],[]];}
    if(sql.startsWith("SET TRANSACTION")) return [[],[]];
    if(sql.includes("information_schema.COLUMNS")) return [Object.entries(this.columns).flatMap(([tableName,fields])=>fields.map(columnName=>({tableName,columnName}))),[]];
    if(sql.includes("information_schema.STATISTICS")) return [this.unique?[{indexName:"member_unique",columnName:"staffUserId",ordinal:1}]:[],[]];
    if(sql.includes("information_schema.KEY_COLUMN_USAGE")) return [this.fk,[]];
    if(sql==="SELECT id,email FROM users ORDER BY id FOR UPDATE") return [structuredClone(this.users.map(({id,email})=>({id,email})).sort((a,b)=>a.id-b.id)),[]];
    if(sql.includes("FROM users WHERE id=? FOR UPDATE")) return [structuredClone(this.users.filter(u=>u.id===args[0])),[]];
    if(sql.includes("FROM agent_record_merges WHERE sourceUserId=?")) return [structuredClone(this.merges.filter(m=>m.sourceUserId===args[0])),[]];
    if(sql.includes("FROM agent_record_merges WHERE LOWER(TRIM(sourceEmail))")) return [structuredClone(this.merges.filter(m=>m.sourceEmail?.trim().toLowerCase()===args[0])),[]];
    if(sql.includes("FROM staff_role_assignments WHERE userId=?")) return [structuredClone(this.assignments.filter(j=>j.userId===args[0])),[]];
    if(sql.includes("FROM agent_crm_profiles WHERE userId=?")) return [structuredClone(this.profiles.filter(p=>p.userId===args[0])),[]];
    if(sql.includes("FROM business_staff_memberships WHERE ownerUserId=? OR staffUserId=?")) return [structuredClone(this.members.filter(m=>m.ownerUserId===args[0]||m.staffUserId===args[1])),[]];
    if(sql.startsWith("SELECT id,ownerUserId,staffUserId") && sql.includes("WHERE id=?")) return [structuredClone(this.members.filter(m=>m.id===args[0])),[]];
    if(sql.startsWith("INSERT INTO users")) {
      const [openId,name,email,tempPassword]=args;const id=Math.max(...this.users.map(u=>u.id))+1;
      this.users.push({...account(id),openId,name,email,tempPassword,mustChangePassword:1,portalStatus:"active",crmAccess:0});return [{affectedRows:1,insertId:id},[]];
    }
    if(sql.startsWith("INSERT INTO business_staff_memberships")) {
      const [ownerUserId,staffUserId,permissions,orbitRequested,createdById]=args;
      if(this.members.some(m=>m.staffUserId===staffUserId)) throw Object.assign(new Error("duplicate"),{code:"ER_DUP_ENTRY"});
      const id=this.members.length+1;this.members.push({id,ownerUserId,staffUserId,permissions,orbitRequested,createdById,status:"active",revision:1,createdAt:"2026-01-01 00:00:00"});return [{affectedRows:1,insertId:id},[]];
    }
    if(sql.startsWith("INSERT INTO business_staff_audit")) {this.audit.push({membershipId:args[0],actorUserId:args[1],action:args[2],reason:args[3],beforeState:args[4],afterState:args[5]});return [{affectedRows:1,insertId:this.audit.length},[]];}
    if(sql.startsWith("UPDATE business_staff_memberships")) {
      const memberId=args[args.length-2],revision=args[args.length-1];const m=this.members.find(m=>m.id===memberId&&m.revision===revision);
      if(this.failCas||!m) return [{affectedRows:0},[]];
      if(sql.includes("SET permissions")) {m.permissions=args[0];m.orbitRequested=args[1];}
      if(sql.includes("SET status")) {m.status=args[0];m.revokedAt=args[0]==="revoked"?"2026-01-02 00:00:00":null;}
      m.revision++;return [{affectedRows:1},[]];
    }
    if(sql.startsWith("UPDATE password_reset_tokens")) {for(const t of this.tokens) if(t.userId===args[0]&&t.usedAt===null) t.usedAt="2026-01-01 00:00:00";return [{affectedRows:1},[]];}
    if(sql.startsWith("INSERT INTO password_reset_tokens")) {this.tokens.push({userId:args[0],token:args[1],usedAt:null,expiresAt:"2026-01-01 01:00:00"});return [{affectedRows:1,insertId:this.tokens.length},[]];}
    if(sql.startsWith("SELECT m.id")) {
      let found=this.members.filter(m=>sql.includes("WHERE m.id=?")?m.id===args[0]:!sql.includes("m.status=?")||m.status===args[0]);
      if(sql.includes("m.ownerUserId=?")) found=found.filter(m=>m.ownerUserId===args[sql.includes("m.status=?")?1:0]);
      const joined=found.map(m=>{const o=this.users.find(u=>u.id===m.ownerUserId)!,s=this.users.find(u=>u.id===m.staffUserId)!;return {...structuredClone(m),ownerName:o.name,ownerEmail:o.email,staffName:s.name,staffEmail:s.email};});
      return [sql.includes("LIMIT ?")?joined.slice(args[args.length-1],args[args.length-1]+args[args.length-2]):joined,[]];
    }
    if(sql.startsWith("SELECT u.id")) {
      const owners=sql.includes("SELECT COUNT(*) FROM agent_crm_profiles");
      const eligible=this.users.filter(u=>u.role==="agent"&&u.isActive===1&&!this.merges.some(m=>m.sourceUserId===u.id)&&!this.assignments.some(j=>j.userId===u.id)&&!this.members.some(m=>m.staffUserId===u.id)&&(owners?(u.portalStatus==="active"&&this.profiles.filter(p=>p.userId===u.id).length===1&&this.profiles.some(p=>p.userId===u.id&&p.agentStatus==="active")):(["active","onboarding"].includes(u.portalStatus)&&!this.members.some(m=>m.ownerUserId===u.id))));
      return [eligible.slice(args[4],args[4]+args[3]).map(u=>({id:u.id,name:u.name,email:u.email,portalStatus:u.portalStatus})),[]];
    }
    throw new Error(`Unexpected synthetic SQL: ${sql}`);
  }
}
let fixture:RawFixture;
const caller=(session:Row|null=account(10,"admin"))=>businessStaffRouter.createCaller({user:session as any,req:{} as any,res:{} as any});
const rejectsCode=(promise:Promise<any>,code:string)=>expect(promise).rejects.toMatchObject({code});
beforeEach(()=>{fixture=new RawFixture();guards.pool.mockReset();guards.pool.mockResolvedValue({getConnection:async()=>fixture});guards.authority.mockReset();guards.boundary.mockClear();});

describe("actual businessStaffRouter synthetic input and permission boundaries",()=>{
  it("exports every agreed endpoint",()=>expect(Object.keys(businessStaffRouter._def.procedures).sort()).toEqual(["mine","ownerSummary","adminList","searchOwners","searchAccounts","linkExisting","createStaff","updatePermissions","setStatus","createSetupLink"].sort()));
  it("requires authenticated administrator access before SQL",async()=>{await rejectsCode(caller(null).adminList(),"FORBIDDEN");expect(guards.pool).not.toHaveBeenCalled();});
  it("delegates mine to the sole parent core authority helper",async()=>{const fresh={managed:true,active:false,owner:null,membership:{id:1,status:"revoked"},orbitReady:false,orbitNotice:BUSINESS_STAFF_ORBIT_NOTICE};guards.authority.mockResolvedValue(fresh);expect(await caller(account(30)).mine()).toEqual(fresh);expect(guards.authority).toHaveBeenCalledWith(expect.objectContaining({id:30}));expect(guards.pool).not.toHaveBeenCalled();});
  it("rejects agent-session management even if database account was promoted",async()=>{await rejectsCode(caller(account(10)).adminList(),"FORBIDDEN");expect(guards.pool).not.toHaveBeenCalled();});
  for(const role of ["agent","admin","super_admin"]) it(`uses fresh database role rather than session ${role}`,async()=>{fixture.users[0].role="agent";await rejectsCode(caller(account(10,role)).adminList(),"FORBIDDEN");});
  it("allows a fresh super administrator",async()=>{fixture.users[0].role="super_admin";expect((await caller().adminList()).items).toEqual([]);});
  for(const status of ["onboarding","paused","suspended","in_notice","cancelled"]) it(`rejects fresh administrator status ${status}`,async()=>{fixture.users[0].portalStatus=status;await rejectsCode(caller().adminList(),"FORBIDDEN");});
  it("rejects deactivated administrator",async()=>{fixture.users[0].isActive=0;await rejectsCode(caller().linkExisting(link()),"FORBIDDEN");});
  it("rejects archived administrator",async()=>{fixture.merges.push({id:1,sourceUserId:10});await rejectsCode(caller().adminList(),"FORBIDDEN");});
  it("rejects an administrator who still requires password setup",async()=>{fixture.users[0].mustChangePassword=1;await rejectsCode(caller().linkExisting(link()),"FORBIDDEN");expect(fixture.members).toEqual([]);expect(fixture.audit).toEqual([]);});
  it("rejects administrator classified as retained staff-only",async()=>{fixture.members.push({id:1,ownerUserId:20,staffUserId:10,status:"revoked"});await rejectsCode(caller().adminList(),"FORBIDDEN");});
  it("rejects missing actor rather than accepting synthetic cron IDs",async()=>{await rejectsCode(caller(account(999,"admin")).adminList(),"NOT_FOUND");});
  for(const bad of [0,-1,1.5,2147483648]) it(`validates actor ID ${bad} before storage`,async()=>{await rejectsCode(caller(account(bad,"admin")).adminList(),"BAD_REQUEST");expect(guards.pool).not.toHaveBeenCalled();});
  for(const field of ["restrictedStaffOnlyConfirmed","preserveExistingDataConfirmed"]) it(`requires explicit ${field}`,async()=>{await rejectsCode(caller().linkExisting({...link(),[field]:false} as any),"BAD_REQUEST");expect(guards.pool).not.toHaveBeenCalled();});
  it("rejects a self-link",async()=>{await rejectsCode(caller().linkExisting({...link(),staffUserId:20}),"BAD_REQUEST");});
  it("rejects arbitrary permission JSON keys",async()=>{await rejectsCode(caller().linkExisting({...link(),permissions:{...defaultPermissions,admin:true}} as any),"BAD_REQUEST");});
  it("rejects amount access without booking permission",async()=>{await rejectsCode(caller().linkExisting({...link(),permissions:{...defaultPermissions,viewBookings:false,viewCustomerAmounts:true}}),"BAD_REQUEST");});
  it("rejects note access without booking permission",async()=>{await rejectsCode(caller().linkExisting({...link(),permissions:{...defaultPermissions,viewBookings:false,addBookingNotes:true}}),"BAD_REQUEST");});
  for(const reason of ["short"," ","x".repeat(1001)]) it(`validates reason length ${reason.length}`,async()=>{await rejectsCode(caller().linkExisting({...link(),reason}),"BAD_REQUEST");});
  for(const name of [" ","x","x".repeat(256)]) it(`validates new name length ${name.length}`,async()=>{await rejectsCode(caller().createStaff({...create(),name}),"BAD_REQUEST");});
  for(const email of ["invalid","a b@example.test","a".repeat(315)+"@example.test"]) it(`validates new synthetic email length ${email.length}`,async()=>{await rejectsCode(caller().createStaff({...create(),email}),"BAD_REQUEST");});
  it("rejects unknown raw fields",async()=>{await rejectsCode(caller().linkExisting({...link(),role:"admin"} as any),"BAD_REQUEST");});
  it("validates service calls independently of tRPC",async()=>{const service=createBusinessStaffManagement({getPool:async()=>({getConnection:async()=>fixture})});await expect(service.linkExisting(10,{...link(),ownerUserId:0})).rejects.toHaveProperty("name","ZodError");});
});

describe("fresh owner and staff classification",()=>{
  it("links an onboarding staff account without changing its credentials, CRM or history",async()=>{const before=structuredClone({users:fixture.users,profiles:fixture.profiles});const result=await caller().linkExisting(link());expect(result.membership.staff.id).toBe(30);expect(fixture.users).toEqual(before.users);expect(fixture.profiles).toEqual(before.profiles);expect(fixture.tokens).toEqual([]);});
  it("links an active staff account",async()=>{fixture.users[2].portalStatus="active";expect((await caller().linkExisting(link())).membership.status).toBe("active");});
  for(const status of ["onboarding","paused","suspended","in_notice","cancelled"]) it(`rejects owner status ${status}`,async()=>{fixture.users[1].portalStatus=status;await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  it("rejects inactive owner",async()=>{fixture.users[1].isActive=0;await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  for(const role of ["admin","super_admin"]) it(`rejects owner role ${role}`,async()=>{fixture.users[1].role=role;await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  it("requires owner CRM profile",async()=>{fixture.profiles=[];await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  it("requires exactly one CRM profile",async()=>{fixture.profiles.push({...fixture.profiles[0],id:2});await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  it("requires active owner CRM",async()=>{fixture.profiles[0].agentStatus="paused";await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  for(const userId of [20,30]) it(`rejects archived identity ${userId}`,async()=>{fixture.merges.push({id:1,sourceUserId:userId});await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  for(const userId of [20,30]) for(const staffRole of ["instructor","agent_engagement"]) it(`rejects retained JLT ${staffRole} assignment on ${userId}`,async()=>{fixture.assignments.push({id:1,userId,staffRole,isActive:0,revokedAt:"2026-01-01"});await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  it("rejects retained staff owner even when revoked",async()=>{fixture.members.push({id:5,ownerUserId:40,staffUserId:20,status:"revoked"});await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  it("rejects staff already owning business members",async()=>{fixture.members.push({id:5,ownerUserId:30,staffUserId:40,status:"revoked"});await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  for(const status of ["paused","suspended","in_notice","cancelled"]) it(`does not silently activate staff status ${status}`,async()=>{fixture.users[2].portalStatus=status;await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");expect(fixture.users[2].portalStatus).toBe(status);});
  it("rejects inactive staff",async()=>{fixture.users[2].isActive=0;await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  for(const role of ["admin","super_admin"]) it(`rejects staff role ${role}`,async()=>{fixture.users[2].role=role;await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  it("rejects linking a second membership to a retained revoked identity",async()=>{fixture.seed("revoked");await rejectsCode(caller().linkExisting(link()),"CONFLICT");expect(fixture.members).toHaveLength(1);});
  it("rejects repeat linking with no second audit side effect",async()=>{await caller().linkExisting(link());await rejectsCode(caller().linkExisting(link()),"CONFLICT");expect(fixture.members).toHaveLength(1);expect(fixture.audit).toHaveLength(1);});
  it("rejects a missing selected staff account",async()=>{await rejectsCode(caller().linkExisting({...link(),staffUserId:999}),"NOT_FOUND");});
});

describe("new account and setup tokens have no recruitment/provider side effects",()=>{
  it("creates an active agent password login with no CRM, preserving existing history",async()=>{const original=structuredClone(fixture.users);const result=await caller().createStaff({...create(),name:"  Synthetic Staff  ",email:"  New-Staff@EXAMPLE.TEST  "});const staff=fixture.users.find(u=>u.id===result.membership.staffUserId)!;expect(staff).toMatchObject({role:"agent",isActive:1,portalStatus:"active",crmAccess:0,mustChangePassword:1,name:"Synthetic Staff",email:"new-staff@example.test"});expect(staff.tempPassword).toMatch(/^\$2[aby]\$/);expect(await bcrypt.compare("INERT_TEST_PASSWORD",staff.tempPassword)).toBe(false);expect(fixture.users.slice(0,original.length)).toEqual(original);expect(fixture.profiles).toHaveLength(1);expect(result.setupUrl).toMatch(/^\/reset-password\?token=[A-Za-z0-9_-]{48}$/);expect(fixture.tokens[0].token).toBe(result.setupUrl.split("=")[1]);expect(fixture.audit).toHaveLength(1);expect(JSON.stringify(fixture.audit)).not.toContain(fixture.tokens[0].token);expect(JSON.stringify(result)).not.toContain(staff.tempPassword);});
  it("duplicate normalized active email is CONFLICT, not an arbitrary selected match",async()=>{fixture.users[2].email="  NEW-STAFF@EXAMPLE.TEST  ";await rejectsCode(caller().createStaff(create()),"CONFLICT");expect(fixture.members).toEqual([]);});
  it("duplicate normalized inactive/archive account is CONFLICT",async()=>{fixture.users[2].email="new-staff@example.test";fixture.users[2].isActive=0;fixture.users[2].portalStatus="cancelled";fixture.merges.push({id:1,sourceUserId:30});await rejectsCode(caller().createStaff(create()),"CONFLICT");});
  it("preserved archive sourceEmail also blocks recreation",async()=>{fixture.merges.push({id:1,sourceUserId:999,sourceEmail:" New-Staff@EXAMPLE.TEST "});await rejectsCode(caller().createStaff(create()),"CONFLICT");});
  it("repeat create for same email fails without second account/token/audit",async()=>{await caller().createStaff(create());await rejectsCode(caller().createStaff(create()),"CONFLICT");expect(fixture.users).toHaveLength(5);expect(fixture.members).toHaveLength(1);expect(fixture.tokens).toHaveLength(1);expect(fixture.audit).toHaveLength(1);});
  it("setup link invalidates prior unused tokens but retains consumed evidence",async()=>{fixture.seed();fixture.tokens=[{userId:30,token:"INERT_UNUSED",usedAt:null},{userId:30,token:"INERT_USED",usedAt:"original"},{userId:40,token:"INERT_OTHER",usedAt:null}];const before=structuredClone(fixture.users);const result=await caller().createSetupLink(request());expect(fixture.tokens).toHaveLength(4);expect(fixture.tokens[0].usedAt).not.toBeNull();expect(fixture.tokens[1].usedAt).toBe("original");expect(fixture.tokens[2].usedAt).toBeNull();expect(result.membership.revision).toBe(2);expect(fixture.users).toEqual(before);expect(JSON.stringify(fixture.audit)).not.toContain(fixture.tokens[3].token);});
  it("repeated setup with same revision fails before generating another token",async()=>{fixture.seed();await caller().createSetupLink(request());await rejectsCode(caller().createSetupLink(request()),"CONFLICT");expect(fixture.tokens).toHaveLength(1);expect(fixture.audit).toHaveLength(1);});
  it("does not change OAuth identity to a password login",async()=>{fixture.seed();fixture.users[2].loginMethod="oauth";await rejectsCode(caller().createSetupLink(request()),"PRECONDITION_FAILED");expect(fixture.members[0].revision).toBe(1);expect(fixture.tokens).toEqual([]);});
  it("does not issue a token for revoked membership",async()=>{fixture.seed("revoked");await rejectsCode(caller().createSetupLink(request()),"PRECONDITION_FAILED");});
  it("rolls back new account if token storage fails",async()=>{fixture.failSql="INSERT INTO password_reset_tokens";await rejectsCode(caller().createStaff(create()),"PRECONDITION_FAILED");expect(fixture.users).toHaveLength(4);expect(fixture.members).toEqual([]);expect(fixture.audit).toEqual([]);expect(fixture.rollback).toHaveBeenCalledOnce();});
  it("all mutation and list responses keep Orbit request-only",async()=>{const result=await caller().linkExisting({...link(),orbitRequested:true});expect(result).toMatchObject({orbitReady:false,orbitNotice:BUSINESS_STAFF_ORBIT_NOTICE});expect(result.membership).toMatchObject({orbitRequested:true,orbitReady:false,orbitNotice:BUSINESS_STAFF_ORBIT_NOTICE});expect(fixture.users[2].crmAccess).toBe(0);});
});

describe("revision CAS, retained statuses and narrow lists",()=>{
  it("updates only membership permissions and audit state",async()=>{fixture.seed();const before=structuredClone(fixture.users);const result=await caller().updatePermissions({...request(),permissions:{...defaultPermissions,viewCustomerAmounts:true},orbitRequested:true});expect(result.membership).toMatchObject({revision:2,orbitRequested:true,permissions:{...defaultPermissions,viewCustomerAmounts:true}});expect(fixture.users).toEqual(before);expect(fixture.audit[0].action).toBe("update_permissions");expect(JSON.parse(fixture.audit[0].beforeState).revision).toBe(1);expect(JSON.parse(fixture.audit[0].afterState).revision).toBe(2);});
  it("same permissions no-op does not increment or audit",async()=>{fixture.seed();const result=await caller().updatePermissions({...request(),permissions:{...defaultPermissions},orbitRequested:false});expect(result.unchanged).toBe(true);expect(result.membership.revision).toBe(1);expect(fixture.audit).toEqual([]);});
  it("stale permissions revision fails",async()=>{fixture.seed();await rejectsCode(caller().updatePermissions({...request(),revision:2,permissions:defaultPermissions,orbitRequested:false}),"CONFLICT");});
  it("SQL affectedRows CAS failure rolls back",async()=>{fixture.seed();fixture.failCas=true;await rejectsCode(caller().updatePermissions({...request(),permissions:{...defaultPermissions,academyAccess:false},orbitRequested:false}),"CONFLICT");expect(fixture.audit).toEqual([]);expect(fixture.members[0].revision).toBe(1);});
  it("revocation retains staff identity and original login state",async()=>{fixture.seed();const before=structuredClone(fixture.users);const result=await caller().setStatus({...request(),status:"revoked"});expect(result.membership).toMatchObject({status:"revoked",revision:2});expect(fixture.members).toHaveLength(1);expect(fixture.users).toEqual(before);expect(fixture.audit[0].action).toBe("revoke");});
  it("revocation is allowed even if owner/staff is newly ineligible",async()=>{fixture.seed();fixture.users[1].isActive=0;fixture.users[2].portalStatus="suspended";fixture.profiles=[];fixture.merges.push({id:1,sourceUserId:30});expect((await caller().setStatus({...request(),status:"revoked"})).membership.status).toBe("revoked");});
  it("repeated revocation is a no-op with current revision",async()=>{fixture.seed("revoked");const result=await caller().setStatus({...request(),status:"revoked"});expect(result.unchanged).toBe(true);expect(fixture.audit).toEqual([]);});
  it("reactivates only eligible retained membership",async()=>{fixture.seed("revoked");const result=await caller().setStatus({...request(),status:"active"});expect(result.membership).toMatchObject({status:"active",revision:2});expect(fixture.members[0].revokedAt).toBeNull();expect(fixture.audit[0].action).toBe("reactivate");});
  it("reactivation does not silently restore inactive user",async()=>{fixture.seed("revoked");fixture.users[2].isActive=0;await rejectsCode(caller().setStatus({...request(),status:"active"}),"PRECONDITION_FAILED");expect(fixture.users[2].isActive).toBe(0);expect(fixture.members[0].status).toBe("revoked");});
  it("missing membership returns NOT_FOUND",async()=>{await rejectsCode(caller().setStatus({...request(),status:"revoked"}),"NOT_FOUND");});
  it("narrow admin list includes owner/staff labels but never private columns",async()=>{fixture.seed();const result=await caller().adminList();expect(result.items[0]).toMatchObject({owner:{id:20,name:"Synthetic Account 20",email:"account-20@example.test"},staff:{id:30},status:"active",revision:1,createdAt:"2026-01-01T00:00:00.000Z"});expect(JSON.stringify(result)).not.toMatch(/INERT|tempPassword|openId|privateBank|bankAccountNumber|privateHistory/);});
  it("list bounds page sizes at 50",async()=>{await rejectsCode(caller().adminList({pageSize:51}),"BAD_REQUEST");expect(guards.pool).not.toHaveBeenCalled();});
  it("list uses lookahead rather than returning unbounded rows",async()=>{fixture.seed();const result=await caller().adminList({page:1,pageSize:1});expect(result.items).toHaveLength(1);const query=fixture.calls.find(c=>c.sql.startsWith("SELECT m.id"))!;expect(query.args.slice(-2)).toEqual([2,0]);});
  it("paginates next page with bounded offset",async()=>{fixture.seed();await caller().adminList({page:2,pageSize:25,status:"revoked"});expect(fixture.calls.find(c=>c.sql.startsWith("SELECT m.id"))!.args).toEqual(["revoked",26,25]);});
  it("exact owner filtering precedes pagination",async()=>{fixture.seed();expect((await caller().adminList({ownerUserId:40})).items).toEqual([]);const q=fixture.calls.find(c=>c.sql.startsWith("SELECT m.id"))!;expect(q.sql).toContain("m.ownerUserId=?");expect(q.args).toEqual([40,26,0]);});
  it("lookahead reports another page without disclosing the extra row",async()=>{fixture.seed();fixture.members.push({...fixture.members[0],id:2,staffUserId:40});const result=await caller().adminList({pageSize:1,ownerUserId:20});expect(result.items).toHaveLength(1);expect(result.hasMore).toBe(true);});
  it("non-setup actions never return a setup secret",async()=>{const linked=await caller().linkExisting(link());const updated=await caller().updatePermissions({...request(),permissions:{...defaultPermissions,academyAccess:false},orbitRequested:false});const revoked=await caller().setStatus({...request(),revision:2,status:"revoked"});const list=await caller().adminList();for(const output of [linked,updated,revoked,list])expect(output).not.toHaveProperty("setupUrl");});
  it("list search is parameterized and owner/staff-only",async()=>{fixture.seed();await caller().adminList({search:"%!_"});const q=fixture.calls.find(c=>c.sql.startsWith("SELECT m.id"))!;expect(q.sql).not.toContain("%!_");expect(q.args[0]).toBe("%!%!!!_%");expect(q.sql).not.toMatch(/bank|crm|notes|audit|password/i);});
  for(const endpoint of ["searchOwners","searchAccounts"] as const) it(`${endpoint} requires at least two search chars`,async()=>{await rejectsCode(caller()[endpoint]({search:"x"}),"BAD_REQUEST");expect(guards.pool).not.toHaveBeenCalled();});
  it("searchOwners returns only active CRM owners as narrow candidates",async()=>{const result=await caller().searchOwners({search:"Synthetic"});expect(result.items.map(u=>u.id)).toEqual([20]);expect(result.candidateType).toBe("businessOwner");expect(JSON.stringify(result)).not.toMatch(/INERT|password|bank/i);});
  it("searchAccounts is separate and excludes current owners and retained members",async()=>{fixture.seed("revoked");const result=await caller().searchAccounts({search:"Synthetic"});expect(result.items.map(u=>u.id)).toEqual([40]);expect(result.candidateType).toBe("existingAccount");});
  it("search SQL uses fresh agent/activity/archive/JLT-role exclusion",async()=>{await caller().searchAccounts({search:"Synthetic",pageSize:50});const q=fixture.calls.find(c=>c.sql.startsWith("SELECT u.id"))!;expect(q.sql).toContain("u.role='agent' AND u.isActive=1");expect(q.sql).toContain("agent_record_merges");expect(q.sql).toContain("staff_role_assignments");expect(q.sql).toContain("business_staff_memberships");expect(q.args.slice(-2)).toEqual([51,0]);});
});

describe("transaction/readiness and source safety",()=>{
  it("sets serializable isolation, sorted user locks and restores UTC session",async()=>{await caller().linkExisting(link());const locks=fixture.calls.filter(c=>c.sql.includes("FROM users WHERE id=? FOR UPDATE")).map(c=>c.args[0]);expect(locks).toEqual([10,20,30]);expect(fixture.calls.some(c=>c.sql==="SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")).toBe(true);expect(fixture.calls[fixture.calls.length-1]).toEqual({sql:"SET time_zone = ?",args:["+02:00"]});expect(fixture.timezone).toBe("+02:00");expect(fixture.commit).toHaveBeenCalledOnce();expect(fixture.release).toHaveBeenCalledOnce();});
  it("creation locks complete email race scope in ID order before selected users",async()=>{await caller().createStaff(create());const scan=fixture.calls.findIndex(c=>c.sql==="SELECT id,email FROM users ORDER BY id FOR UPDATE");const lock=fixture.calls.findIndex(c=>c.sql.includes("FROM users WHERE id=? FOR UPDATE"));expect(scan).toBeGreaterThan(0);expect(scan).toBeLessThan(lock);});
  for(const table of ["business_staff_memberships","business_staff_audit","business_staff_booking_notes","staff_role_assignments","agent_record_merges","agent_crm_profiles","password_reset_tokens"]) it(`missing ${table} fails closed`,async()=>{delete fixture.columns[table];await rejectsCode(caller().adminList(),"PRECONDITION_FAILED");expect(fixture.users).toHaveLength(4);expect(fixture.rollback).toHaveBeenCalledOnce();});
  it("missing permanent unique staff constraint fails closed",async()=>{fixture.unique=false;await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");expect(fixture.members).toEqual([]);});
  it("missing foreign-key constraint fails closed",async()=>{fixture.fk.pop();await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");});
  it("partial columns fail closed",async()=>{fixture.columns.business_staff_memberships=fixture.columns.business_staff_memberships.filter(c=>c!=="revision");await rejectsCode(caller().adminList(),"PRECONDITION_FAILED");});
  for(const code of ["ER_DUP_ENTRY","ER_LOCK_DEADLOCK","ER_LOCK_WAIT_TIMEOUT"]) it(`maps ${code} to safe CONFLICT and rolls back`,async()=>{fixture.failSql="INSERT INTO business_staff_memberships";fixture.failCode=code;await rejectsCode(caller().linkExisting(link()),"CONFLICT");expect(fixture.audit).toEqual([]);expect(fixture.members).toEqual([]);});
  it("does not expose raw private SQL errors",async()=>{fixture.failSql="information_schema.COLUMNS";fixture.failCode="PRIVATE_UNKNOWN";try{await caller().adminList();throw new Error("expected failure");}catch(e:any){expect(e.code).toBe("INTERNAL_SERVER_ERROR");expect(e.message).not.toMatch(/private@example|INERT|PRIVATE QUERY/);}});
  it("audit insertion failure rolls back link atomically",async()=>{fixture.failSql="INSERT INTO business_staff_audit";await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");expect(fixture.members).toEqual([]);});
  it("restores timezone on validation failure",async()=>{fixture.users[1].portalStatus="suspended";await rejectsCode(caller().linkExisting(link()),"PRECONDITION_FAILED");expect(fixture.timezone).toBe("+02:00");expect(fixture.rollback).toHaveBeenCalledOnce();expect(fixture.release).toHaveBeenCalledOnce();});
  it("destroys pooled connection when timezone cannot be restored",async()=>{const original=fixture.query.bind(fixture);fixture.query=async(sql,args)=>{if(sql==="SET time_zone = ?")throw new Error("restore failed");return original(sql,args);};await caller().adminList();expect(fixture.destroy).toHaveBeenCalledOnce();expect(fixture.release).not.toHaveBeenCalled();});
  it("no live pool is called when explicitly injected synthetic raw fixture",async()=>{const service=createBusinessStaffManagement({getPool:async()=>({getConnection:async()=>fixture})});await service.adminList(10);expect(guards.pool).not.toHaveBeenCalled();});
  it("source never deletes memberships or calls side-effect account/provider helpers",()=>{const source=readFileSync(new URL("./business-staff-management.ts",import.meta.url),"utf8");expect(source).not.toMatch(/DELETE\s+FROM|createAgentUser|createInAppNotification|send[A-Z]\w*Email|ensureProspectWon|syncRecruitment|createMandate|SSO|crmAccess\s*=\s*1/);expect(source).not.toContain("SELECT *");expect(source).not.toMatch(/UPDATE users|INSERT INTO agent_crm_profiles|INSERT INTO gc_/);});
  it("SQL updates restrict themselves to membership CAS and reset-token invalidation",async()=>{fixture.seed();await caller().setStatus({...request(),status:"revoked"});expect(fixture.calls.filter(c=>c.sql.startsWith("UPDATE ")).every(c=>c.sql.startsWith("UPDATE business_staff_memberships")&&c.sql.includes("AND revision=?"))).toBe(true);});
});
