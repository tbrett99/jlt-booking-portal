import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const crmDatabaseSource = readFileSync(resolve(process.cwd(), "server/crm-db.ts"), "utf8");
const crmRouterSource = readFileSync(resolve(process.cwd(), "server/crm-router.ts"), "utf8");
const crmUiSource = readFileSync(resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");

describe("CRM agent email history", () => {
  it("filters the existing email log by the selected agent ID", () => {
    expect(crmDatabaseSource).toContain("userId?: number;");
    expect(crmDatabaseSource).toContain("conditions.push(eq(agentEmails.userId, params.userId));");
    expect(crmRouterSource).toContain("userId: z.number().int().positive().optional()");
  });

  it("keeps recent emails within the agent CRM drawer", () => {
    expect(crmUiSource).toContain('<TabsTrigger value="emails"');
    expect(crmUiSource).toContain('<AgentEmailsTab userId={agent.id} />');
    expect(crmUiSource.replace(/\s+/g, " ")).toContain("trpc.crm.agentEmailLog.list.useQuery( { userId, limit: 12, offset: 0 }");
    expect(crmUiSource).toContain("Latest portal emails");
    expect(crmUiSource).toContain("title=\"Email preview\"");
  });
});
