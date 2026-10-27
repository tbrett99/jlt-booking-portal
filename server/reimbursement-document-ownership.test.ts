import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("reimbursement document ownership", () => {
  const db = read("server/db.ts");
  const router = read("server/routers.ts");
  const agentBookingDetail = read("client/src/pages/agent/AgentBookingDetail.tsx");
  const adminBookingDetail = read("client/src/pages/admin/AdminBookingDetail.tsx");

  it("returns only the exact items just created, in the same order as the submission", () => {
    expect(db).toContain("const createdIds: number[] = []");
    expect(db).toContain("await connection.beginTransaction()");
    expect(db).toContain("createdIds.push(id)");
    expect(db).toContain("where(inArray(reimbursementItems.id, createdIds))");
    expect(db).toContain("return createdIds.map((id) => {");
    expect(db).not.toContain("return db.select().from(reimbursementItems).where(eq(reimbursementItems.bookingId, items[0].bookingId));");
    expect(agentBookingDetail).toContain("const itemId = createdItems[idx]?.id");
  });

  it("allows only staff to correct a mislinked document and records both sides of the correction", () => {
    expect(db).toContain("export async function moveReimbursementItemDoc");
    expect(db).toContain("LIMIT 1 FOR UPDATE");
    expect(db).toContain("document_reassigned_out");
    expect(db).toContain("document_reassigned_in");
    expect(db).toContain("The document could not be reassigned safely");
    expect(router).toContain("moveItemDoc: adminProcedure");
    expect(router).toContain("fromReimbursementItemId: z.number().int().positive()");
    expect(router).toContain("toReimbursementItemId: z.number().int().positive()");
  });

  it("makes historic corrections deliberate and visible in the booking reimbursement workspace", () => {
    expect(adminBookingDetail).toContain("Move reimbursement document");
    expect(adminBookingDetail).toContain("Move &amp; record correction");
    expect(adminBookingDetail).toContain("document_reassigned_out");
    expect(adminBookingDetail).toContain("document_reassigned_in");
    expect(adminBookingDetail).toContain("Document reassigned and recorded in reimbursement activity");
  });
});
