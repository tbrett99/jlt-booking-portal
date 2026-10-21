import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schemaSource = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("./suppliers-router.ts", import.meta.url), "utf8");
const directorySource = readFileSync(
  new URL("../client/src/pages/SupplierDirectory.tsx", import.meta.url),
  "utf8"
);
const formSource = readFileSync(
  new URL("../client/src/pages/admin/SupplierFormDialog.tsx", import.meta.url),
  "utf8"
);

describe("supplier emergency and out-of-hours support", () => {
  it("stores nullable urgent contact fields separately from ordinary supplier contacts", () => {
    expect(schemaSource).toContain('outOfHoursContactName: varchar("outOfHoursContactName"');
    expect(schemaSource).toContain('outOfHoursPhone: varchar("outOfHoursPhone"');
    expect(schemaSource).toContain('outOfHoursEmail: varchar("outOfHoursEmail"');
    expect(schemaSource).toContain('outOfHoursNotes: text("outOfHoursNotes")');
  });

  it("accepts urgent support details on both supplier create and update", () => {
    expect((routerSource.match(/outOfHoursContactName: z\.string\(\)\.max\(255\)\.nullable\(\)\.optional\(\)/g) ?? []).length).toBe(2);
    expect((routerSource.match(/outOfHoursPhone: z\.string\(\)\.max\(500\)\.nullable\(\)\.optional\(\)/g) ?? []).length).toBe(2);
    expect((routerSource.match(/outOfHoursEmail: z\.string\(\)\.max\(320\)\.nullable\(\)\.optional\(\)/g) ?? []).length).toBe(2);
  });

  it("gives staff a clearly labelled emergency section when editing supplier details", () => {
    expect(formSource).toContain("Emergency &amp; Out-of-Hours Support");
    expect(formSource).toContain("Urgent Phone");
    expect(formSource).toContain("When to use / instructions");
  });

  it("shows agents urgent support with direct call and email actions", () => {
    expect(directorySource).toContain("Emergency &amp; Out-of-Hours Support");
    expect(directorySource).toContain("Urgent use only");
    expect(directorySource).toContain("href={`tel:${supplier.outOfHoursPhone.replace");
    expect(directorySource).toContain("href={`mailto:${supplier.outOfHoursEmail}`}");
  });
});
