import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const mocks=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("./db",()=>({getRawDbPool:async()=>({query:mocks.query})}));
import { archivedAgentDetails } from "./agent-merge-history";
import { writableAgentUser } from "./agent-merge-user-write";
beforeEach(()=>{vi.clearAllMocks();mocks.query.mockImplementation(async(sql:string)=>{
 if(sql.includes("FROM agent_record_merges"))return [[{sourceUserId:10,primaryUserId:20,manifestJson:JSON.stringify({sourceIdentity:{name:"Original agent",email:"original@example.test",tempPassword:"must-never-return"},sourceProfile:{bankAccountNumber:"must-never-return",personalEmail:"original@example.test",idDocUrl:"javascript:alert(1)",proofOfAddressUrl:"https://files.example.test/doc.pdf"},changes:[{table:"agent_crm_notes",rows:[{id:9}]}]})}]];
 if(sql.includes("information_schema.TABLES"))return [[{name:"agent_crm_notes"}]];
 if(sql.includes("FROM agent_crm_notes"))return [[{id:9,content:"Original historical note",authorName:"Staff",createdAt:new Date("2026-11-03T12:00:00Z")}]];
 throw new Error("Unrecognised mock-only query: "+sql);
});});
describe("staff-only original merged history",()=>{
 it("returns approved source fields and original note without passwords, bank details or unsafe links",async()=>{
  const result=await archivedAgentDetails(10);
  expect(result.sourceUserId).toBe(10);expect(result.primaryUserId).toBe(20);
  expect(result.notes[0].content).toBe("Original historical note");expect(result.notes[0].createdAt).toBe("2026-11-03T12:00:00.000Z");
  expect(result.documents).toEqual([{label:"Original proof of address",url:"https://files.example.test/doc.pdf"}]);
  expect(JSON.stringify(result)).not.toContain("must-never-return");expect(result.courses).toEqual([]);
 });
 it("scopes moved note identifiers to the exact source and primary owners",async()=>{
  await archivedAgentDetails(10);
  const call=mocks.query.mock.calls.find(c=>c[0].includes("FROM agent_crm_notes"))!;
  expect(call[0]).toContain("agentUserId IN (?,?)");expect(call[1]).toEqual([10,9,10,20]);
  expect(mocks.query.mock.calls.every(c=>c[0].startsWith("SELECT"))).toBe(true);
 });
 it("rejects a nonarchived account rather than returning another original profile",async()=>{
  mocks.query.mockResolvedValueOnce([[]]);await expect(archivedAgentDetails(55)).rejects.toThrow("not a merged archive");
  expect(mocks.query).toHaveBeenCalledOnce();
 });
 it("includes the permanent source marker in the SQL UPDATE/DELETE condition",()=>{
  const compiled=new MySqlDialect().sqlToQuery(writableAgentUser(10)!);
  expect(compiled.sql).toContain("suspensionReason");expect(compiled.sql).toContain("not like");expect(compiled.params).toEqual([10,"merged_into:%"]);
 });
});
