export type ComparisonCadence = "weekly" | "monthly";

export type ComparisonPeriod = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

export type ComparisonMetrics = {
  bookingsRegistered: number;
  jltRevenue: number;
  agentPayouts: number;
  commissionClaims: number;
  commissionClaimedValue: number;
  commissionsPaid: number;
  commissionsPaidValue: number;
  newProspects: number;
  newAgents: number;
};

export type ComparisonRow = ComparisonMetrics & {
  period: string;
  periodStart: string;
  periodEnd: string;
};

const zeroMetrics = (): ComparisonMetrics => ({
  bookingsRegistered: 0,
  jltRevenue: 0,
  agentPayouts: 0,
  commissionClaims: 0,
  commissionClaimedValue: 0,
  commissionsPaid: 0,
  commissionsPaidValue: 0,
  newProspects: 0,
  newAgents: 0,
});

function utcDate(year: number, monthIndex: number, day = 1): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatUtcDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Builds a complete calendar-year series. Weekly rows are Monday-based where
 * possible, with a short first/last row only when the year starts or ends
 * mid-week; no metric can therefore leak in from an adjacent year.
 */
export function buildComparisonPeriods(year: number, cadence: ComparisonCadence): ComparisonPeriod[] {
  const yearStart = utcDate(year, 0, 1);
  const yearEnd = utcDate(year + 1, 0, 1);

  if (cadence === "monthly") {
    return Array.from({ length: 12 }, (_, monthIndex) => {
      const start = utcDate(year, monthIndex, 1);
      const end = utcDate(year, monthIndex + 1, 1);
      return {
        key: toIsoDate(start),
        label: start.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }),
        start,
        end,
      };
    });
  }

  const periods: ComparisonPeriod[] = [];
  let start = yearStart;
  let ordinal = 1;

  while (start < yearEnd) {
    const dayOfWeek = start.getUTCDay();
    const daysUntilNextMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
    const end = new Date(Math.min(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + daysUntilNextMonday),
      yearEnd.getTime(),
    ));
    const finalDay = new Date(end);
    finalDay.setUTCDate(finalDay.getUTCDate() - 1);
    periods.push({
      key: toIsoDate(start),
      label: `Week ${ordinal} · ${formatUtcDate(start)}–${formatUtcDate(finalDay)}`,
      start,
      end,
    });
    start = end;
    ordinal += 1;
  }

  return periods;
}

export function initialiseComparisonRows(periods: ComparisonPeriod[]): ComparisonRow[] {
  return periods.map((period) => ({
    period: period.label,
    periodStart: toIsoDate(period.start),
    periodEnd: toIsoDate(period.end),
    ...zeroMetrics(),
  }));
}

export function findComparisonPeriodIndex(periods: ComparisonPeriod[], date: Date | string | null | undefined): number {
  if (!date) return -1;
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return -1;
  return periods.findIndex((period) => time >= period.start.getTime() && time < period.end.getTime());
}

export function addToComparisonRow(
  rows: ComparisonRow[],
  periodIndex: number,
  patch: Partial<ComparisonMetrics>,
): void {
  if (periodIndex < 0 || !rows[periodIndex]) return;
  const row = rows[periodIndex];
  for (const [key, value] of Object.entries(patch) as Array<[keyof ComparisonMetrics, number | undefined]>) {
    if (typeof value === "number" && Number.isFinite(value)) {
      row[key] += value;
    }
  }
}

export function totalComparisonRows(rows: ComparisonRow[]): ComparisonMetrics {
  return rows.reduce<ComparisonMetrics>((totals, row) => {
    for (const key of Object.keys(totals) as Array<keyof ComparisonMetrics>) {
      totals[key] += row[key];
    }
    return totals;
  }, zeroMetrics());
}
