import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { agentSupportRouter, assistantSystemPrompt, isAssistantUnavailableAnswer } from "./agent-support-router";
import { AGENT_PORTAL_PROCEDURE_SOURCES } from "./agent-support-portal-procedures";
import {
  buildSupplierAgentSupportText,
  retrieveAgentSupportChunks,
  sensitiveSupplierFieldsAreExcluded,
  stripAgentSupportHtml,
  type AgentSupportSource,
  uniqueSourceCitations,
} from "./agent-support-utils";

function makeContext(role: "agent" | "admin" | "super_admin" | null): TrpcContext {
  return {
    user: role ? {
      id: 123,
      openId: `test-${role}`,
      name: "Test user",
      email: "test@example.com",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as NonNullable<TrpcContext["user"]> : null,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("Agent Support Assistant safety helpers", () => {
  it("retrieves only relevant approved passages and produces deduplicated citations", () => {
    const sources: AgentSupportSource[] = [
      { key: "kb:1", kind: "knowledge_base", title: "Booking amendments", text: "Use the amendment request form in the Portal for a booking amendment.", href: "/knowledge-base?article=1" },
      { key: "supplier:7", kind: "supplier", title: "Example Travel", text: "Family beach holidays and trade website guidance.", href: "/suppliers?supplier=7" },
    ];
    const chunks = retrieveAgentSupportChunks(sources, "How do I request a booking amendment?");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.key).toBe("kb:1");
    expect(uniqueSourceCitations(chunks)).toEqual([expect.objectContaining({ key: "kb:1", href: "/knowledge-base?article=1" })]);
  });

  it("strips markup from approved source content before retrieval", () => {
    expect(stripAgentSupportHtml("<p><strong>Read this</strong> &amp; use the <a href='/x'>Portal</a>.</p><script>ignore()</script>")).toBe("Read this & use the Portal.");
  });

  it("uses a positive supplier allow-list so confidential fields cannot enter model text", () => {
    const source = buildSupplierAgentSupportText({
      name: "Example Travel",
      shortDescription: "Luxury tailor-made holidays.",
      aiSummary: "Good for milestone trips.",
      bookingTips: "Check passport validity.",
    });
    expect(source).toContain("Luxury tailor-made holidays.");
    expect(source).not.toContain("FIN-SECRET");
    expect(sensitiveSupplierFieldsAreExcluded({
      name: "Example Travel",
      shortDescription: "Luxury tailor-made holidays.",
    })).toBe(true);
    expect(sensitiveSupplierFieldsAreExcluded({ name: "Example Travel", generalNotes: "PRIVATE-SECRET" })).toBe(false);
  });

  it("permits sourced generic booking and cancellation procedures while still blocking individual records", () => {
    const prompt = assistantSystemPrompt();
    expect(prompt).toContain("How do I cancel a booking in Orbit?");
    expect(prompt).toContain("Do not refuse merely because the topic contains words such as booking, cancellation, refund or payment.");
    expect(prompt).toContain("specific booking, client, payment, commission claim");
  });

  it("recognises a stock unavailable reply so relevant evidence gets one recovery pass", () => {
    expect(isAssistantUnavailableAnswer("I can’t confirm that from the approved agent-facing Portal content. Please check support.")).toBe(true);
    expect(isAssistantUnavailableAnswer("I can't confirm that from the approved agent-facing Portal content. Please check support.")).toBe(true);
    expect(isAssistantUnavailableAnswer("Open the booking in Orbit and follow the cancellation process [S1].")).toBe(false);
  });

  it("retrieves the curated, non-record reimbursement procedure for both claim and setup questions", () => {
    const claimChunks = retrieveAgentSupportChunks(AGENT_PORTAL_PROCEDURE_SOURCES, "How do I claim a reimbursement?");
    const setupChunks = retrieveAgentSupportChunks(AGENT_PORTAL_PROCEDURE_SOURCES, "How do I set up a reimbursement?");

    expect(claimChunks).toEqual([expect.objectContaining({ key: "portal-procedure:reimbursement-request-v1", kind: "portal_procedure" })]);
    expect(setupChunks).toEqual([expect.objectContaining({ key: "portal-procedure:reimbursement-request-v1", kind: "portal_procedure" })]);
    expect(AGENT_PORTAL_PROCEDURE_SOURCES[0]?.text).not.toContain("bookingId");
    expect(AGENT_PORTAL_PROCEDURE_SOURCES[0]?.text).not.toContain("clientName");
  });
});

describe("Agent Support Assistant admin-only pilot gate", () => {
  it("refuses an anonymous caller before it can reach a source loader or model", async () => {
    const caller = agentSupportRouter.createCaller(makeContext(null));
    await expect(caller.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an agent caller before it can reach a source loader or model", async () => {
    const caller = agentSupportRouter.createCaller(makeContext("agent"));
    await expect(caller.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
