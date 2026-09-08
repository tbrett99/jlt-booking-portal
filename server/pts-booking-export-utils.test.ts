import { describe, expect, it } from "vitest";
import { buildPtsBookingCsv, canExportPtsBooking, isPtsExportEligibleStage, PTS_BOOKING_EXPORT_HEADERS, splitClientName } from "./pts-booking-export-utils";

describe("PTS booking CSV mapping", () => {
  it("splits recognised titles and multi-part surnames", () => {
    expect(splitClientName("Mrs Anna Marie Smith-Jones")).toEqual({
      title: "Mrs",
      firstName: "Anna",
      lastName: "Marie Smith-Jones",
    });
  });

  it("defaults a missing client title to Mr so the mandatory import field is never blank", () => {
    expect(splitClientName("Anna Marie Smith-Jones")).toEqual({
      title: "Mr",
      firstName: "Anna",
      lastName: "Marie Smith-Jones",
    });
    expect(splitClientName("").title).toBe("Mr");
  });

  it("uses the agreed fixed values and existing Orbit reference", () => {
    const csv = buildPtsBookingCsv([{
      bookingId: 12,
      clientName: "Dr Taylor Reed",
      agentName: "Alex Agent",
      agentEmail: "alex@example.test",
      country: "Cape Verde",
      departureDate: "2027-02-09T00:00:00.000Z",
      passengers: 2,
      numberOfNights: 7,
      orbitRef: "JLT-6578",
    }]);
    const [header, row] = csv.split("\r\n");
    expect(header.replaceAll('"', "").split(",")).toEqual([...PTS_BOOKING_EXPORT_HEADERS]);
    expect(row).toContain('"000000000000"');
    expect(row).toContain('"Website"');
    expect(row).toContain('"aaa JLT Admin"');
    expect(row).toContain('"Alex Agent"');
    expect(row).toContain('"09/02/2027"');
    expect(row).toContain('"Flight Only"');
    expect(row).toContain('"JLT-6578"');
  });

  it("neutralises cells that spreadsheets could interpret as formulas", () => {
    const csv = buildPtsBookingCsv([{
      bookingId: 13,
      clientName: "=Formula Example",
      agentName: "Agent",
      agentEmail: "agent@example.test",
      country: "UK",
      departureDate: "2027-02-09T00:00:00.000Z",
      passengers: 1,
      numberOfNights: 1,
      orbitRef: "@unsafe",
    }]);
    expect(csv).toContain(`"'=Formula"`);
    expect(csv).toContain(`"'@unsafe"`);
  });

  it("includes only the operational columns that still require addition to PTS", () => {
    expect(isPtsExportEligibleStage("New Booking")).toBe(true);
    expect(isPtsExportEligibleStage("DP")).toBe(true);
    expect(isPtsExportEligibleStage("Creating own PTS file")).toBe(false);
    expect(isPtsExportEligibleStage("Added to PTS")).toBe(false);
    expect(isPtsExportEligibleStage("Commission Claimable")).toBe(false);
  });

  it("excludes a booking once a PTS reference has been saved", () => {
    expect(canExportPtsBooking({ ptsRef: null })).toBe(true);
    expect(canExportPtsBooking({ ptsRef: "   " })).toBe(true);
    expect(canExportPtsBooking({ ptsRef: "2T0141312" })).toBe(false);
  });
});
