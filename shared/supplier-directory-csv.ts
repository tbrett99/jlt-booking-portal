export type SupplierDirectoryCsvRow = {
  name: string;
  categories: string | null;
  locations: string | null;
  isPreferredPartner: boolean | number | null;
};

const csvCell = (value: string | number | boolean | null | undefined) => {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  // Prevent spreadsheet formula interpretation in values maintained in the directory.
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
};

/** Builds an operational, non-sensitive supplier directory export for staff. */
export function buildSupplierDirectoryCsv(rows: SupplierDirectoryCsvRow[]) {
  const header = ["Supplier Name", "Supplier Type(s)", "Locations", "Preferred Partner"];
  const body = rows.map((supplier) => [
    supplier.name,
    supplier.categories?.split(";").map((category) => category.trim()).filter(Boolean).join("; ") ?? "",
    supplier.locations?.split(";").map((location) => location.trim()).filter(Boolean).join("; ") ?? "",
    supplier.isPreferredPartner ? "Yes" : "No",
  ]);
  return [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
