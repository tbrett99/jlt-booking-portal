import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./AdminCommissions.tsx", import.meta.url)), "utf8");

describe("Commission Management top-up reminders", () => {
  it("explains that Top-Up Required does not need a future supplier payment date", () => {
    expect(source).toContain("Files move here immediately when marked in minus. No future supplier payment date is needed.");
  });

  it("provides a send-now action that groups reminders by agent", () => {
    expect(source).toContain("sendTopUpRemindersMutation");
    expect(source).toContain("Send reminders to all agents");
    expect(source).toContain("grouped reminder");
  });

  it("shows the latest top-up request and reminder timestamps", () => {
    expect(source).toContain("Last reminder");
    expect(source).toContain("topUpRequestedAt");
    expect(source).toContain("topUpNotifiedAt");
  });
});
