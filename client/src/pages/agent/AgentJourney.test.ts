import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bookings = readFileSync(fileURLToPath(new URL("./AgentBookings.tsx", import.meta.url)), "utf8");
const dashboard = readFileSync(fileURLToPath(new URL("./AgentDashboard.tsx", import.meta.url)), "utf8");
const calculator = readFileSync(fileURLToPath(new URL("./PackagePricingCalculator.tsx", import.meta.url)), "utf8");
const competitions = readFileSync(fileURLToPath(new URL("../../components/CompetitionsWidget.tsx", import.meta.url)), "utf8");

describe("agent home journey", () => {
  it("makes booking support request-led, with an on-demand booking search", () => {
    expect(bookings).toContain("Bookings &amp; requests");
    expect(bookings).toContain("What would you like to do?");
    expect(bookings).toContain("Search only when you need a file");
    expect(bookings).toContain("Request an amendment");
    expect(bookings).toContain("Request flights");
    expect(bookings).toContain("Cancel a booking");
  });

  it("makes both fee guides discoverable alongside the package pricing calculator", () => {
    expect(calculator).toContain("Looking for PTS or card fees?");
    expect(calculator).toContain("https://fees.thejltgroup.co.uk");
    expect(calculator).toContain("https://fees.thejltgroup.co.uk/card-fees");
  });

  it("surfaces competitions and the Orbit roadmap from the agent home page", () => {
    expect(dashboard).toContain("<CompetitionsWidget />");
    expect(dashboard).toContain("Orbit roadmap");
    expect(competitions).toContain("Competitions & Wins");
    expect(competitions).toContain("Explore Competitions");
  });
});
