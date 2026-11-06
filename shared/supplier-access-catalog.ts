export const DEFAULT_SUPPLIER_ACCESS_NAMES = [
  "Ace Rooms", "Ambassador Cruises", "Aviate", "Easyjet", "Etihad Holidays",
  "Every Holiday", "Gold Medal", "Holiday Best", "Koveli", "Major Travel",
  "MSC", "NCL", "P&O Cruises", "Royal Caribbean/Celebrity", "Virgin Voyages",
] as const;

export const SUPPLIER_ACCESS_NAME_MAX = 120;
export function cleanSupplierAccessName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
export function supplierAccessIdentity(value: string): string {
  return cleanSupplierAccessName(value).normalize("NFKC").toLowerCase();
}
export function isValidSupplierAccessName(value: string): boolean {
  // Check original characters before whitespace normalisation, so pasted
  // control characters cannot silently become catalogue entries.
  return !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    && cleanSupplierAccessName(value).length > 0
    && cleanSupplierAccessName(value).length <= SUPPLIER_ACCESS_NAME_MAX;
}

export type SupplierAccessOption = { name: string; identity: string };
/** Global options plus THIS agent's recorded legacy names only. Never changes saved rows. */
export function buildSupplierAccessOptions(customNames: readonly string[], recordedNames: readonly string[] = []): SupplierAccessOption[] {
  const names = new Map<string, string>();
  for (const name of [...DEFAULT_SUPPLIER_ACCESS_NAMES, ...customNames, ...recordedNames]) {
    if (typeof name !== "string" || !name.trim()) continue;
    const identity = supplierAccessIdentity(name);
    if (!names.has(identity)) names.set(identity, cleanSupplierAccessName(name));
  }
  return Array.from(names, ([identity, name]) => ({ identity, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
