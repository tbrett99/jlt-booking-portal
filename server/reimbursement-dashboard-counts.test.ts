import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("reimbursement dashboard status semantics", () => {
  it("counts only pending reimbursements as outstanding", () => {
    const dashboardRouter = readProjectFile("server/dashboard-router.ts");
    const db = readProjectFile("server/db.ts");

    expect(dashboardRouter).toContain("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS outstanding");
    expect(dashboardRouter).toContain("SUM(CASE WHEN isLate = 1 AND status = 'pending' THEN 1 ELSE 0 END) AS lateUnactioned");
    expect(dashboardRouter).not.toContain("status IN ('pending','awaiting_agent') THEN 1 ELSE 0 END) AS outstanding");
    expect(db).toContain('.where(eq(reimbursementItems.status, "pending"));');
  });

  it("keeps Late only as a combinable filter beside the status filter", () => {
    const reimbursementPage = readProjectFile("client/src/pages/admin/AdminReimbursements.tsx");

    expect(reimbursementPage).toContain("const [lateOnly, setLateOnly] = useState(false);");
    expect(reimbursementPage).toContain("const items = lateOnly ? statusItems.filter((item) => item.isLate) : statusItems;");
    expect(reimbursementPage).toContain("Late only");
  });
});
