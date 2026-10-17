import { describe, expect, it } from "vitest";
import { AGENT_HOME_TILES, countAgentBookingActions } from "../shared/agent-home";

describe("agent home hub", () => {
  it("keeps Academy and Knowledge Base visible as coming-soon placeholders", () => {
    const academy = AGENT_HOME_TILES.find((tile) => tile.key === "academy");
    const knowledgeBase = AGENT_HOME_TILES.find((tile) => tile.key === "knowledge_base");

    expect(academy).toMatchObject({ title: "JLT Academy", comingSoon: true });
    expect(academy?.href).toBeUndefined();
    expect(knowledgeBase).toMatchObject({ title: "Knowledge Base", comingSoon: true });
    expect(knowledgeBase?.href).toBeUndefined();
  });

  it("offers all of the current live agent destinations from the new home grid", () => {
    expect(AGENT_HOME_TILES.filter((tile) => tile.href).map((tile) => tile.href)).toEqual([
      "/events",
      "/suppliers",
      "/my-bookings",
      "/commissions",
      "/community",
      "/pricing-calculator",
    ]);
  });

  it("counts every independent booking action without conflating it with news or commission alerts", () => {
    expect(countAgentBookingActions({
      bookingQueries: 1,
      ptsActions: 2,
      missingDocuments: 3,
      flightQueries: 4,
      topUps: 5,
    })).toBe(15);
  });
});
