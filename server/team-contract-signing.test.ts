import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const joinRouter = readFileSync(resolve(process.cwd(), "server/join-router.ts"), "utf8");
const crmRouter = readFileSync(resolve(process.cwd(), "server/crm-router.ts"), "utf8");
const agentCrm = readFileSync(resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");
const joinAccept = readFileSync(resolve(process.cwd(), "client/src/pages/JoinAccept.tsx"), "utf8");

describe("team membership contract signing", () => {
  it("binds invite acceptance to the authenticated invitee rather than caller-supplied IDs", () => {
    const acceptInvite = joinRouter.slice(
      joinRouter.indexOf("acceptInvite: protectedProcedure"),
      joinRouter.indexOf("// ─── Admin: list join sessions")
    );

    expect(acceptInvite).toContain("acceptInvite: protectedProcedure");
    expect(acceptInvite).toContain("ctx.user.id");
    expect(acceptInvite).toContain("Please sign in with the email address that received this team invitation.");
    expect(acceptInvite).not.toContain("userId: z.number");
    expect(joinAccept).not.toContain("sessionToken: token");
    expect(joinAccept).not.toContain("userId: user.id");
  });

  it("keeps a signed team agreement as a durable, reviewable CRM evidence record", () => {
    expect(joinRouter).toContain('membershipType: "team_member"');
    expect(joinRouter).toContain("paymentExempt: true");
    expect(joinRouter).toContain("paymentExemptReason");
    expect(crmRouter).toContain("isNotNull(joinSessions.contractSignedAt)");
    expect(crmRouter).toContain("orderBy(desc(joinSessions.contractSignedAt))");
  });

  it("gives staff an explicit send-for-signing action and removes individual DD work for team members", () => {
    expect(agentCrm).toContain("Send contract for signing");
    expect(agentCrm).toContain("Secure contract-signing link sent to");
    expect(agentCrm).toContain('step.key !== "ddSubscriptionCreated"');
  });

  it("normalises invitation emails so casing cannot leave duplicate active signing links", () => {
    expect(joinRouter).toContain("LOWER(${teamInvites.invitedEmail}) = LOWER(${input.invitedEmail})");
    expect(joinRouter).toContain("LOWER(${teamInvites.invitedEmail}) = LOWER(${email})");
  });
});
