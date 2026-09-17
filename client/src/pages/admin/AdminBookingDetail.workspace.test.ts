import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./AdminBookingDetail.tsx", import.meta.url)), "utf8");

describe("admin booking workspace overview", () => {
  it("uses a wider desktop workspace with a sticky, accessible action overview", () => {
    expect(source).toContain('max-w-[96rem]');
    expect(source).toContain('xl:grid-cols-[minmax(0,1fr)_21rem]');
    expect(source).toContain('function BookingWorkspaceOverview');
    expect(source).toContain('aria-label="Booking quick overview"');
    expect(source).toContain('xl:sticky xl:top-5');
  });

  it("provides in-page navigation to the booking records staff need to review", () => {
    expect(source).toContain('document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })');
    expect(source).toContain('id: "booking-notes"');
    expect(source).toContain('id: "booking-cancellations"');
    expect(source).toContain('id: "booking-amendments"');
    expect(source).toContain('id: "booking-refunds"');
    expect(source).toContain('id: "booking-reimbursements"');
    expect(source).toContain('id: "booking-documents"');
    expect(source).toContain('id: "booking-history"');
  });

  it("shows the stored manual commission declarations directly on the booking record", () => {
    expect(source).toContain('trpc.commissionClaims.byBooking.useQuery');
    expect(source).toContain('id="commission-claim-audit"');
    expect(source).toContain("Commission claim confirmation");
    expect(source).toContain("File complete:");
    expect(source).toContain("Suntransfers, Transferz, or Holiday Extras:");
    expect(source).toContain("immutable internal audit note");
  });
});
