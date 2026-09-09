import { describe, expect, it } from "vitest";
import {
  formatDiscoveryCallDate,
  renderRecruitmentWorkflowTemplate,
} from "./recruitment-workflow-utils";

describe("recruitment workflow templates", () => {
  it("renders all supported branded workflow variables", () => {
    const rendered = renderRecruitmentWorkflowTemplate(
      "Hi {{firstName}} {{lastName}} — {{email}} — {{applicationLink}} — {{discoveryCallDate}}",
      {
        firstName: "Grace",
        lastName: "Fryer",
        email: "grace@example.com",
        applicationLink: "https://portal.example/apply/form?token=abc",
        discoveryCallDate: "Friday, 12 September 2026 at 10:00",
      }
    );

    expect(rendered).toBe(
      "Hi Grace Fryer — grace@example.com — https://portal.example/apply/form?token=abc — Friday, 12 September 2026 at 10:00"
    );
  });

  it("uses a safe call-date fallback when no appointment exists", () => {
    expect(formatDiscoveryCallDate(null)).toBe("your scheduled time");
    expect(formatDiscoveryCallDate("not-a-date")).toBe("your scheduled time");
  });
});
