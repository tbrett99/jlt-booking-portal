import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const source = (relativePath: string) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

describe("agent correspondence delivery wiring", () => {
  it("resolves agent campaign and drip recipients at delivery time", () => {
    const resend = source("server/resend-email.ts");
    expect(resend).toContain('import { resolveAgentCorrespondence } from "./agent-correspondence";');
    expect(resend).toContain('opts.audienceType === "agent" && opts.recipientId');
    expect(resend).toContain('audienceType === "agent" && row.recipientId');
    expect(resend).toContain("recipientEmail: recipient.email");
  });

  it("carries a known agent identity into core operational notices", () => {
    const router = source("server/routers.ts");
    const academy = source("server/academy-router.ts");
    const flights = source("server/flight-requests-router.ts");
    expect(router).toContain("userId: booking.agentId");
    expect(router).toContain("userId: claim.agentId");
    expect(router).toContain("userId: item.agentId");
    expect(academy).toContain("userId: params.agentId");
    expect(flights).toContain("userId: req.agentId");
  });
});
