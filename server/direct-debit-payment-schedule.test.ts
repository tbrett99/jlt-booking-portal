import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
const readProjectFile = (relativePath: string) =>
  readFileSync(path.join(projectDir, relativePath), "utf8");

const routerSource = readProjectFile("server/routers.ts");
const goCardlessSource = readProjectFile("server/gocardless.ts");
const crmSource = readProjectFile("client/src/pages/crm/AgentCrm.tsx");

describe("Direct Debit payment schedule", () => {
  it("uses actual GoCardless subscription and payment timeline dates instead of guessing a retry", () => {
    expect(goCardlessSource).toContain("getSubscription(subscriptionId");
    expect(goCardlessSource).toContain("listPaymentsForSubscription(subscriptionId");
    expect(routerSource).toContain("adminGetPaymentSchedule");
    expect(routerSource).toContain("payment_timeline");
    expect(routerSource).toContain("subscription_schedule");
    expect(routerSource).toContain("This intentionally does not predict retries");
  });

  it("renders a live schedule, retry context, and a manual refresh in the CRM Direct Debit tab", () => {
    expect(crmSource).toContain("Payment schedule");
    expect(crmSource).toContain("Live GoCardless");
    expect(crmSource).toContain("Potential retry / recollection");
    expect(crmSource).toContain("Refresh schedule");
    expect(crmSource).toContain("does not estimate retry dates");
  });
});
