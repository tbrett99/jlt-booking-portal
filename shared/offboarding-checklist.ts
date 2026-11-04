/**
 * Offboarding has historically been supplier-wide, keyed by the exact supplier
 * name. Multiple credential rows do not create independently saved checkboxes.
 * Keep that evidence contract: a supplier tick confirms ALL its recorded logins.
 * No credential/access mutation or automatic conversion of legacy generic ticks.
 */
export const OFFBOARDING_SYSTEM_ITEMS = [
  "Topdog login removed",
  "WhatsApp access removed",
  "Learnworlds access removed",
  "JLT email deactivated",
  "Portal access removed",
] as const;

export type OffboardingSupplier = { id: number; supplierName: string };

export function readOffboardingChecklist(value: unknown): string[] {
  if (typeof value === "string") {
    try { return readOffboardingChecklist(JSON.parse(value)); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function getOffboardingChecklist(suppliers: readonly OffboardingSupplier[], evidence: unknown) {
  const grouped = new Map<string, { key: string; supplierName: string; loginIds: number[] }>();
  for (const supplier of suppliers) {
    const key = `Revoke: ${supplier.supplierName}`;
    const group = grouped.get(key) ?? { key, supplierName: supplier.supplierName, loginIds: [] };
    if (!group.loginIds.includes(supplier.id)) group.loginIds.push(supplier.id);
    grouped.set(key, group);
  }
  const supplierTasks = Array.from(grouped.values());
  const items = [...supplierTasks.map(task => task.key), ...OFFBOARDING_SYSTEM_ITEMS];
  const ticked = new Set(readOffboardingChecklist(evidence));
  const completed = items.filter(item => ticked.has(item)).length;
  return { supplierTasks, items, completed, total: items.length, complete: items.every(item => ticked.has(item)) };
}

/** Change one current task while retaining all unrelated/legacy string evidence. */
export function toggleOffboardingItem(evidence: unknown, item: string): string[] {
  const saved = readOffboardingChecklist(evidence);
  return saved.includes(item) ? saved.filter(value => value !== item) : [...saved, item];
}
