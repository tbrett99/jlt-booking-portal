import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./MyProfile.tsx", import.meta.url)), "utf8");

describe("agent bank detail guidance", () => {
  it("makes the payment scope clear in the profile bank section", () => {
    expect(source).toContain("For commission and reimbursement payments only");
    expect(source).toContain("commission and reimbursement payments");
    expect(source).toContain("It does <strong>not</strong> update the bank account used for your monthly Direct Debit");
    expect(source).toContain("mailto:support@thejltgroup.co.uk");
  });

  it("repeats the Direct Debit guidance before submitting a bank change request", () => {
    expect(source).toContain('form.fieldName.startsWith("bank")');
    expect(source).toContain("This update is for <strong>commission and reimbursement payments only</strong>");
  });
});
