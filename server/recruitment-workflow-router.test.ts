import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEmailBrandingSettings: vi.fn(),
}));

vi.mock("./crm-db", () => ({ getEmailBrandingSettings: mocks.getEmailBrandingSettings }));

import { buildBrandedRecruitmentWorkflowEmailHtml } from "./recruitment-workflow-router";

describe("branded recruitment workflow email preview", () => {
  beforeEach(() => {
    mocks.getEmailBrandingSettings.mockReset();
  });

  it("uses the same configured logo, branded header, body, and footer as the delivered email", async () => {
    mocks.getEmailBrandingSettings.mockResolvedValue({
      logoUrl: "https://cdn.example.com/jlt-logo.png",
    });

    const html = await buildBrandedRecruitmentWorkflowEmailHtml({
      subject: "Welcome to JLT",
      bodyHtml: "<p>Hi Grace</p>",
    });

    expect(html).toContain("https://cdn.example.com/jlt-logo.png");
    expect(html).toContain("background-color:#70FFE8");
    expect(html).toContain("<p>Hi Grace</p>");
    expect(html).toContain("JLT Group. All rights reserved.");
  });
});
