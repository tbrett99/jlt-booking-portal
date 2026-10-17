import { DEPARTURE_REASON_KEYS, DEPARTURE_REASON_LABELS, type DepartureReasonKey } from "./departure-reasons";

const reasonKeySet = new Set<string>(DEPARTURE_REASON_KEYS);

type DepartureReasonBreakdownRow = {
  reasonKey: DepartureReasonKey | "not_recorded";
  label: string;
  count: number;
};

export function normaliseDepartureReasons(value: unknown): DepartureReasonKey[] {
  const source = typeof value === "string"
    ? (() => { try { return JSON.parse(value); } catch { return []; } })()
    : value;
  if (!Array.isArray(source)) return [];
  return source.filter((reason): reason is DepartureReasonKey => typeof reason === "string" && reasonKeySet.has(reason));
}

export function buildDepartureReasonBreakdown(rows: Array<{ departureReasons: unknown }>) {
  const counts = new Map<string, number>();
  let notRecorded = 0;
  for (const row of rows) {
    const reasons = normaliseDepartureReasons(row.departureReasons);
    if (reasons.length === 0) {
      notRecorded += 1;
      continue;
    }
    for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const breakdown: DepartureReasonBreakdownRow[] = Array.from(counts.entries())
    .map(([reasonKey, count]) => ({
      reasonKey: reasonKey as DepartureReasonKey,
      label: DEPARTURE_REASON_LABELS[reasonKey as DepartureReasonKey],
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (notRecorded > 0) breakdown.push({ reasonKey: "not_recorded", label: "Not recorded (before this process)", count: notRecorded });
  return breakdown;
}
