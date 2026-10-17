import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const crmRouterSource = readFileSync(resolve(process.cwd(), "server/crm-router.ts"), "utf8");
const agentCrmSource = readFileSync(resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");
const membershipsSource = readFileSync(resolve(process.cwd(), "client/src/pages/crm/Memberships.tsx"), "utf8");
const appRouterSource = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");

describe("portal-access approval notification", () => {
  it("retires the old Welcome to the JLT Group sender", () => {
    expect(crmRouterSource).not.toContain('subject: "Welcome to the JLT Group! 🎉"');
    expect(crmRouterSource).toContain("This legacy welcome email has been retired");
  });

  it("removes obsolete staff controls that could send the retired email", () => {
    expect(agentCrmSource).not.toContain('label: "Send Welcome Email"');
    expect(agentCrmSource).not.toContain("sendWelcomeEmailMutation");
    expect(membershipsSource).not.toContain("sendWelcomeEmail.useMutation");
    expect(membershipsSource).not.toContain('"Send Welcome"');
  });

  it("retains the single current portal-access notification", () => {
    expect(appRouterSource).toContain('triggerKey: "portal_access_approved"');
    expect(appRouterSource).toContain('subject: "Your JLT Group Portal Access is Now Live! 🌟"');
  });
});
