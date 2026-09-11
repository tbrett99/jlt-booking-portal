import { describe, expect, it } from "vitest";
import { prepareCommunityDigestDelivery } from "./community-digest-delivery-utils";

describe("community digest test delivery", () => {
  it("keeps the exact live monthly body, title, period, and Orbit card when preparing a test email", () => {
    const renderedMonthlyHtml = "<h1>Monthly Review</h1><p>August 2026</p><a href=\"https://orbit.thejltgroup.co.uk/travel-updates\">Open Orbit</a>";
    const live = prepareCommunityDigestDelivery({
      html: renderedMonthlyHtml,
      digestTitle: "Monthly Review",
      periodLabel: "August 2026",
      isTest: false,
    });
    const test = prepareCommunityDigestDelivery({
      html: renderedMonthlyHtml,
      digestTitle: "Monthly Review",
      periodLabel: "August 2026",
      isTest: true,
    });

    expect(test.html).toBe(live.html);
    expect(test.html).toContain("Monthly Review");
    expect(test.html).toContain("August 2026");
    expect(test.html).toContain("Open Orbit");
    expect(test.subject).toBe("[TEST] JLT Group Monthly Review — August 2026");
  });

  it("keeps the exact live weekly body while prefixing only the test subject", () => {
    const renderedWeeklyHtml = "<h1>Weekly Update</h1><p>1 Sep – 7 Sep 2026</p><a>Open Orbit</a>";
    const live = prepareCommunityDigestDelivery({
      html: renderedWeeklyHtml,
      digestTitle: "Weekly Update",
      periodLabel: "1 Sep – 7 Sep 2026",
      customSubject: "This week's update",
      isTest: false,
    });
    const test = prepareCommunityDigestDelivery({
      html: renderedWeeklyHtml,
      digestTitle: "Weekly Update",
      periodLabel: "1 Sep – 7 Sep 2026",
      customSubject: "This week's update",
      isTest: true,
    });

    expect(test.html).toBe(live.html);
    expect(test.html).toContain("Weekly Update");
    expect(test.html).toContain("Open Orbit");
    expect(test.subject).toBe("[TEST] This week's update");
  });
});
