import { describe, expect, it } from "vitest";
import { AGENT_HOME_TILES, countAgentBookingActions } from "../shared/agent-home";

describe("agent home hub", () => {
  it("keeps Academy, Knowledge Base and Webinar Library live", () => {
    const academy = AGENT_HOME_TILES.find((tile) => tile.key === "academy");
    const knowledgeBase = AGENT_HOME_TILES.find((tile) => tile.key === "knowledge_base");
    const webinars = AGENT_HOME_TILES.find((tile) => tile.key === "webinars");

    expect(academy).toMatchObject({ title: "JLT Academy", href: "/academy" });
    expect(academy?.comingSoon).toBeUndefined();
    expect(knowledgeBase).toMatchObject({ title: "Knowledge Base", href: "/knowledge-base" });
    expect(knowledgeBase?.comingSoon).toBeUndefined();
    expect(webinars).toMatchObject({ title: "Webinar Library", href: "/webinars" });
    expect(webinars?.comingSoon).toBeUndefined();
  });

  it("offers all of the current live agent destinations from the new home grid", () => {
    expect(AGENT_HOME_TILES.filter((tile) => tile.href).map((tile) => tile.href)).toEqual([
      "/academy",
      "/knowledge-base",
      "/webinars",
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
