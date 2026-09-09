import { describe, expect, it } from "vitest";
import {
  calculateWorkflowStepSendAt,
  formatDiscoveryCallDate,
  renderRecruitmentWorkflowTemplate,
} from "./recruitment-workflow-utils";

describe("recruitment workflow templates", () => {
  it("renders all supported branded workflow variables", () => {
    const rendered = renderRecruitmentWorkflowTemplate(
      "Hi {{firstName}} {{lastName}} — {{email}} — {{applicationLink}} — {{discoveryCallLink}} — {{joinLink}} — {{discoveryCallDate}}",
      {
        firstName: "Grace",
        lastName: "Fryer",
        email: "grace@example.com",
        applicationLink: "https://portal.example/apply/form?token=abc",
        discoveryCallLink: "https://cal.example/discovery",
        joinLink: "https://portal.example/join",
        discoveryCallDate: "Friday, 12 September 2026 at 10:00",
      }
    );

    expect(rendered).toBe(
      "Hi Grace Fryer — grace@example.com — https://portal.example/apply/form?token=abc — https://cal.example/discovery — https://portal.example/join — Friday, 12 September 2026 at 10:00"
    );
  });

  it("uses a safe call-date fallback when no appointment exists", () => {
    expect(formatDiscoveryCallDate(null)).toBe("your scheduled time");
    expect(formatDiscoveryCallDate("not-a-date")).toBe("your scheduled time");
  });

  it("calculates every scheduled email from workflow stage entry", () => {
    const enteredAt = new Date("2026-09-09T09:00:00.000Z");

    expect(calculateWorkflowStepSendAt(enteredAt, 72).toISOString())
      .toBe("2026-09-12T09:00:00.000Z");
    expect(calculateWorkflowStepSendAt(enteredAt, 0).toISOString())
      .toBe("2026-09-09T09:00:00.000Z");
  });
});
