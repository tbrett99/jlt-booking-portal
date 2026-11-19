import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { getTableName } from "drizzle-orm";
import { canUseStaffHandbook } from "../shared/staff-handbook";
const fixture = vi.hoisted(() => ({ sdkUser: null as any, currentUser: null as any, row: null as any, revisions: [] as any[], calls: [] as string[], decrypted: Buffer.from("synthetic internal handbook"), storageError: false, afterStorage: null as null | (() => void), dbError: false }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn(async () => fixture.sdkUser) } }));
vi.mock("./storage", () => ({ storageGetDecrypted: vi.fn(async (key: string) => { fixture.calls.push(`decrypt:${key}`); if(fixture.storageError) throw new Error("secret bucket/key/text"); fixture.afterStorage?.(); return fixture.decrypted; }) }));
vi.mock("./db", () => ({ getDb: vi.fn(async () => {
  if(fixture.dbError) throw new Error("private DB query and credential");
  return { select: () => { let table = ""; const chain: any = { from: (t:any) => { table=getTableName(t); fixture.calls.push(table); return chain; }, innerJoin:()=>chain, where:()=>chain, limit: async()=> {
    if(table==="users") return fixture.currentUser ? [fixture.currentUser] : [];
    if(table==="staff_handbook_resources") return fixture.row ? [fixture.row] : [];
    if(table==="staff_handbook_revisions") return fixture.revisions;
    throw new Error("Unexpected table");
  } }; return chain; } };
}) }));
import { registerStaffHandbookDownloadRoutes } from "./staff-handbook-download-routes";
function user(overrides:Record<string,unknown>={}) { return {id:11,role:"admin",isActive:true,portalStatus:"active",mustChangePassword:false,...overrides}; }
async function request(id="31") {
  let handler: any;
  registerStaffHandbookDownloadRoutes({get:(path:string,fn:any)=>{expect(path).toBe("/api/staff-handbook/resource/:resourceId");handler=fn;}} as any);
  const headers: Record<string,unknown>={};
  const res:any={ statusCode:200,body:undefined,setHeader:(key:string,value:unknown)=>{headers[key]=value;},status:(code:number)=>{res.statusCode=code;return res;},end:(body?:unknown)=>{res.body=body;return res;},send:(body:unknown)=>{res.body=body;return res;} };
  await handler({params:{resourceId:id}},res);
  return {res,headers};
}
beforeEach(()=>{
  fixture.sdkUser=user();fixture.currentUser=user();fixture.calls=[];fixture.storageError=false;fixture.dbError=false;fixture.afterStorage=null;fixture.decrypted=Buffer.from("synthetic internal handbook");
  fixture.row={resource:{id:31,articleId:21,fileName:"private-process.pdf",mimeType:"application/pdf",byteSize:fixture.decrypted.length,sha256:createHash("sha256").update(fixture.decrypted).digest("hex"),fileKey:"staff-handbook/21/fixed-random-document",removedAt:null},article:{id:21,archivedAt:null,draftRevisionId:41,publishedRevisionId:40}};
  fixture.revisions=[{id:41,articleId:21,resourceIds:[31]},{id:40,articleId:21,resourceIds:[31]}];
});
describe("strict handbook account classification",()=>{
  it.each(["admin","super_admin"])("permits only eligible %s",role=>expect(canUseStaffHandbook(user({role}))).toBe(true));
  it.each([null,user({id:-1}),user({role:"agent"}),user({role:"instructor"}),user({role:"agent_engagement"}),user({role:"admin",isActive:false}),user({portalStatus:"onboarding"}),user({portalStatus:"cancelled"}),user({portalStatus:"suspended"}),user({portalStatus:"paused"}),user({mustChangePassword:true}),user({mustChangePassword:undefined})])("rejects noneligible identity %j",identity=>expect(canUseStaffHandbook(identity)).toBe(false));
});
describe("private staff handbook HTTP files",()=>{
  it("streams only a current registered file as an uncached attachment",async()=>{
    const {res,headers}=await request();expect(res.statusCode).toBe(200);expect(res.body).toEqual(fixture.decrypted);expect(headers["Cache-Control"]).toContain("no-store");expect(headers["X-Content-Type-Options"]).toBe("nosniff");expect(headers["Content-Disposition"]).toMatch(/^attachment;/);expect(fixture.calls.filter(c=>c==="users")).toHaveLength(2);expect(fixture.calls.filter(c=>c==="staff_handbook_resources")).toHaveLength(2);
  });
  it.each([null,user({role:"agent"}),user({role:"instructor"}),user({role:"agent_engagement"}),user({isActive:false}),user({portalStatus:"onboarding"}),user({mustChangePassword:true})])("denies forbidden SDK account before table/storage access %j",async identity=>{fixture.sdkUser=identity;const {res}=await request();expect(res.statusCode).toBe(404);expect(fixture.calls).toEqual([]);});
  it("denies a stale administrator session after role change",async()=>{fixture.currentUser=user({role:"agent"});const {res}=await request();expect(res.statusCode).toBe(404);expect(fixture.calls).toEqual(["users"]);});
  it.each(["0","-1","31x","1.1","9007199254740992","../31",""])("rejects malformed ID %s",async id=>{const {res}=await request(id);expect(res.statusCode).toBe(404);expect(fixture.calls).toEqual([]);});
  it.each(["staff-handbook/22/file","booking-private/21/file","staff-handbook/21/../file","staff-handbook/21/a?key=secret","staff-handbook/21/a\\b"])("does not decrypt arbitrary object key %s",async key=>{fixture.row.resource.fileKey=key;const {res}=await request();expect(res.statusCode).toBe(404);expect(fixture.calls.some(c=>c.startsWith("decrypt:"))).toBe(false);});
  it.each(["archive","removed","foreign-revision","historical-only","unsupported-type","oversized"])("denies unavailable or mismatched resource %s",async kind=>{
    if(kind==="archive")fixture.row.article.archivedAt=new Date();
    if(kind==="removed")fixture.row.resource.removedAt=new Date();
    if(kind==="foreign-revision")fixture.revisions=[{id:41,articleId:22,resourceIds:[31]}];
    if(kind==="historical-only")fixture.revisions=[{id:39,articleId:21,resourceIds:[31]}];
    if(kind==="unsupported-type")fixture.row.resource.mimeType="image/svg+xml";
    if(kind==="oversized")fixture.row.resource.byteSize=11*1024*1024;
    const {res}=await request();expect(res.statusCode).toBe(404);expect(fixture.calls.some(c=>c.startsWith("decrypt:"))).toBe(false);
  });
  it("keeps current published attachments accessible while draft removal is awaiting publication",async()=>{fixture.revisions[0].resourceIds=[];const {res}=await request();expect(res.statusCode).toBe(200);});
  it.each(["demote","deactivate","password-reset","archive","remove","unreference","replace"])("rechecks authority after slow storage: %s",async change=>{
    fixture.afterStorage=()=>{
      if(change==="demote")fixture.currentUser=user({role:"agent"});
      if(change==="deactivate")fixture.currentUser=user({isActive:false});
      if(change==="password-reset")fixture.currentUser=user({mustChangePassword:true});
      if(change==="archive")fixture.row.article.archivedAt=new Date();
      if(change==="remove")fixture.row.resource.removedAt=new Date();
      if(change==="unreference")fixture.revisions=[];
      if(change==="replace")fixture.row={...fixture.row,resource:{...fixture.row.resource,fileKey:"staff-handbook/21/changed-file"}};
    };const {res}=await request();expect(res.statusCode).toBe(404);expect(res.body).toBeUndefined();
  });
  it("rejects corrupt decrypted contents rather than streaming them",async()=>{fixture.decrypted=Buffer.from("different private text");const {res}=await request();expect(res.statusCode).toBe(404);expect(res.body).toBeUndefined();});
  it.each(["storage","database"])("sanitizes %s failures",async kind=>{fixture.storageError=kind==="storage";fixture.dbError=kind==="database";const {res}=await request();expect(res.statusCode).toBe(503);expect(String(res.body)).not.toMatch(/secret|credential|query|bucket/);});
  it("sanitizes header injection in filenames",async()=>{fixture.row.resource.fileName='process\r\nX-Secret: value".pdf';const {headers}=await request();expect(String(headers["Content-Disposition"])).not.toMatch(/[\r\n]/);});
});
