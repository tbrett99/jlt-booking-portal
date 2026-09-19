import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("reimbursement Awaiting agent workflow", () => {
  const schema = read("drizzle/schema.ts");
  const db = read("server/db.ts");
  const router = read("server/routers.ts");
  const adminList = read("client/src/pages/admin/AdminReimbursements.tsx");
  const bookingDetail = read("client/src/pages/admin/AdminBookingDetail.tsx");
  const agentBookingDetail = read("client/src/pages/agent/AgentBookingDetail.tsx");

  it("persists Awaiting agent and follow-up metadata without changing historical statuses", () => {
    expect(schema).toContain('mysqlEnum("status", ["pending", "awaiting_agent", "scheduled", "paid"])');
    expect(schema).toContain('nextFollowUpAt: timestamp("nextFollowUpAt")');
    expect(schema).toContain('lastChasedAt: timestamp("lastChasedAt")');
    expect(schema).toContain('lastChasedById: int("lastChasedById")');
    expect(schema).toContain('index("reimbursement_items_status_followup_idx")');
  });

  it("requires chase details and writes immutable reimbursement activity", () => {
    expect(db).toContain("export async function setReimbursementAwaitingAgent");
    expect(db).toContain('action: "agent_chased"');
    expect(db).toContain('updates.nextFollowUpAt = null');
    expect(router).toContain("awaitAgent: adminProcedure");
    expect(router).toContain('note: z.string().trim().min(3).max(3000)');
    expect(router).toContain("Reimbursement information needed — ${item.supplierName}");
    expect(router).toContain("Please reply to this message once the information has been provided");
    expect(router).toContain("Reimbursement information is needed for ${item.supplierName}");
  });

  it("keeps staff chase notes internal to administrators", () => {
    expect(router).toContain('.filter((entry) => entry.action === "status_changed")');
    expect(router).toContain("Chase notes and staff follow-up dates are internal");
    expect(agentBookingDetail).toContain("Awaiting agent");
    expect(agentBookingDetail).toContain("Please check your Messages and upload any requested evidence here.");
    expect(read("client/src/components/ReimbursementAwaitingAgentDialog.tsx")).toContain("Send request & set Awaiting agent");
  });

  it("makes latest chase note and next follow-up directly visible on the existing list", () => {
    expect(db).toContain("latestChaseByItemId");
    expect(db).toContain("lastChaseNote");
    expect(db).toContain("Audit summaries enhance the list but must never hide the reimbursement queue.");
    expect(adminList).toContain("Latest chase");
    expect(adminList).toContain("Next follow-up");
    expect(adminList).toContain("Follow-up overdue");
    expect(adminList).toContain("Chase again");
    expect(adminList).toContain("Mark Scheduled");
  });

  it("shows chronological chase activity on the booking reimbursement section", () => {
    expect(bookingDetail).toContain("Reimbursement Activity");
    expect(bookingDetail).toContain("set this reimbursement to");
    expect(bookingDetail).toContain("Next follow-up:");
    expect(bookingDetail).toContain("ReimbursementAwaitingAgentDialog");
  });
});
