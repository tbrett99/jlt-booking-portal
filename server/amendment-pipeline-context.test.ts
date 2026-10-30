import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const database = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
const pipeline = readFileSync(
  resolve(process.cwd(), "client/src/pages/admin/AdminAmendmentKanban.tsx"),
  "utf8"
);

describe("Amendment pipeline booking context", () => {
  it("returns the booking agent and departure date in a bounded amendment-list enrichment", () => {
    const helper = database.slice(
      database.indexOf("export async function getAllAmendments"),
      database.indexOf("export async function actionAmendment")
    );

    expect(helper).toContain("agentId: bookings.agentId");
    expect(helper).toContain("departureDate: bookings.departureDate");
    expect(helper).toContain("const bookingAgentRows");
    expect(helper).toContain("agentName: bookingAgentMap.get");
    expect(helper).toContain("departureDate: bookingMap.get(a.bookingId)?.departureDate");
  });

  it("labels agent, departure and the local submitted timestamp on amendment cards", () => {
    expect(pipeline).toContain("export function AmendmentBookingContext");
    expect(pipeline).toContain(">Agent</span>");
    expect(pipeline).toContain(">Departure</span>");
    expect(pipeline).toContain(">Submitted</span>");
    expect(pipeline).toContain('format(submittedAt, "dd MMM yyyy, HH:mm")');
    expect(pipeline).toContain("<AmendmentBookingContext amendment={amendment} />");
  });
});
