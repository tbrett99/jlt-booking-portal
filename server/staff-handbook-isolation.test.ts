import { describe, expect, it, beforeEach, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { readFileSync } from "node:fs";
const fixtures=vi.hoisted(()=>({reads:[] as string[],sentinel:"INTERNAL-HANDBOOK-PRIVATE-SENTINEL", db:null as any}));
vi.mock("./db",()=>({getDb:async()=>fixtures.db,createInAppNotification:vi.fn()}));
vi.mock("./email",()=>({sendDirectEmail:vi.fn()}));
vi.mock("./momentum",()=>({awardMomentum:vi.fn()}));
vi.mock("./business-staff-access",()=>({getBusinessStaffAuthority:async()=>({managed:false,active:false,membership:null}),assertBusinessStaffRouteAllowed:async()=>undefined}));
vi.mock("./storage",()=>({storagePut:vi.fn()}));
import { libraryRouter } from "./library-router";
import { loadAdminPilotSupportSources } from "./agent-support-sources";
beforeEach(()=>{
 fixtures.reads=[];
 fixtures.db={select:()=>{let table="";const chain:any={from:(t:any)=>{table=getTableName(t);fixtures.reads.push(table);return chain;},where:()=>chain,innerJoin:()=>chain,leftJoin:()=>chain,orderBy:()=>chain,limit:()=>chain,then:(resolve:any,reject:any)=>Promise.resolve(table.startsWith("staff_handbook")||table.startsWith("staff_knowledge")?[{id:901,title:fixtures.sentinel,summary:fixtures.sentinel,contentHtml:fixtures.sentinel,category:fixtures.sentinel,tags:[fixtures.sentinel],status:"published",resources:[{fileName:fixtures.sentinel}]}]:[]).then(resolve,reject)};return chain;}};
});
function caller(){return libraryRouter.createCaller({user:{id:50,role:"agent",isActive:true,portalStatus:"active",mustChangePassword:false} as any,req:{} as any,res:{} as any});}
describe("structural isolation from agent-facing content",()=>{
 it("does not expose internal titles, content, categories or files in agent browsing",async()=>{const result=await caller().browse({search:fixtures.sentinel});expect(JSON.stringify(result)).not.toContain(fixtures.sentinel);expect(result).toMatchObject({articles:[],webinars:[],categories:[]});expect(fixtures.reads.some(t=>t.startsWith("staff_handbook")||t.startsWith("staff_knowledge"))).toBe(false);});
 it("does not resolve a guessed internal ID through the agent article endpoint",async()=>{await expect(caller().article({id:901})).rejects.toMatchObject({code:"NOT_FOUND"});expect(fixtures.reads).toEqual(["knowledge_base_articles"]);});
 it("does not resolve internal IDs through agent view or completion APIs",async()=>{await expect(caller().recordView({contentType:"article",contentId:901})).rejects.toMatchObject({code:"NOT_FOUND"});await expect(caller().markCompleted({contentType:"article",contentId:901})).rejects.toMatchObject({code:"NOT_FOUND"});expect(fixtures.reads.every(t=>!t.startsWith("staff_"))).toBe(true);});
 it("does not load internal handbook/report text into the support corpus, even for the Admin pilot",async()=>{const sources=await loadAdminPilotSupportSources();expect(sources.length).toBeGreaterThan(0);expect(JSON.stringify(sources)).not.toContain(fixtures.sentinel);expect(sources.every(source=>!source.key.startsWith("staff"))).toBe(true);expect(fixtures.reads.every(t=>!t.startsWith("staff_handbook")&&!t.startsWith("staff_knowledge"))).toBe(true);});
 it("keeps handbook tables absent from all existing agent publication and support modules",()=>{
   for(const file of ["server/library-router.ts","server/agent-support-sources.ts","server/agent-support-router.ts"]){const source=readFileSync(file,"utf8");expect(source).not.toMatch(/staffHandbook|staffKnowledge|staff_handbook|staff_knowledge/);}
 });
 it("keeps the handbook page out of ordinary-agent and delegated-business route branches",()=>{
   const source=readFileSync("client/src/App.tsx","utf8");const normal=source.slice(source.indexOf('// Pure agent — always agent routes'),source.indexOf('// Pure agent — always agent routes')+6500);
   expect(normal).not.toMatch(/component=\{StaffHandbook\}/);
   const start=source.indexOf('if (businessStaff.data.managed)');const end=source.indexOf('// Team members exist',start);
   expect(source.slice(start,end)).not.toMatch(/StaffHandbook/);
   expect(source.match(/path="\/admin\/staff-handbook"/g)).toHaveLength(1);
 });
});
