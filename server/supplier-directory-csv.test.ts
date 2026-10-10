import { describe, expect, it } from "vitest";
import { buildSupplierDirectoryCsv } from "../shared/supplier-directory-csv";

describe("supplier directory CSV export", () => {
  it("exports only operational supplier details with clean category labels", () => {
    const csv = buildSupplierDirectoryCsv([{
      name: "Example Travel Co",
      categories: "Hotels; Luxury ; Tours",
      locations: "Italy; Greece",
      isPreferredPartner: true,
    }]);

    expect(csv.split("\r\n")).toEqual([
      '"Supplier Name","Supplier Type(s)","Locations","Preferred Partner"',
      '"Example Travel Co","Hotels; Luxury; Tours","Italy; Greece","Yes"',
    ]);
  });

  it("escapes spreadsheet formulas and quotes in supplier data", () => {
    const csv = buildSupplierDirectoryCsv([{
      name: '=HYPERLINK("https://unsafe.example")',
      categories: null,
      locations: null,
      isPreferredPartner: false,
    }]);

    expect(csv).toContain('"\'=HYPERLINK(""https://unsafe.example"")"');
    expect(csv).toContain('"No"');
  });
});
