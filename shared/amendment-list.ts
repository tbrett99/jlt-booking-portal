export type AmendmentSort = "departure_soonest" | "departure_latest" | "submitted_oldest" | "submitted_newest";
export type AmendmentDepartureFilter = "all" | "today" | "next_7" | "next_14" | "next_30" | "departed" | "missing";
export type AmendmentStageFilter = "all" | "pending" | "To Do" | "In Progress" | "Actioned" | "rejected";
export type AmendmentListFilters = {
  search: string;
  stage: AmendmentStageFilter;
  agent: string;
  assignee: string;
  departure: AmendmentDepartureFilter;
  sort: AmendmentSort;
};
export const DEFAULT_AMENDMENT_FILTERS: AmendmentListFilters = {
  search: "", stage: "all", agent: "all", assignee: "all", departure: "all", sort: "departure_soonest",
};
export type AmendmentListRow = {
  id: number;
  bookingId: number;
  agentId?: number | null;
  bookingAgentId?: number | null;
  agentName?: string | null;
  clientName?: string | null;
  assignedToId?: number | null;
  assignedToName?: string | null;
  pipelineStage?: string | null;
  status?: string | null;
  createdAt?: Date | string | number | null;
  departureDate?: Date | string | number | null;
  ptsRef?: string | null;
  topdogRef?: string | null;
  crmRef?: string | null;
  details?: string | null;
  isReimbursementDoc?: boolean | null;
};
export function amendmentDate(value: AmendmentListRow["departureDate"]): Date | null {
  if (value == null || value === "" || (typeof value === "string" && !value.trim())) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
/** Calendar days in the viewer's local timezone, matching the displayed dates.
 * UTC construction of the local date parts avoids DST-length-day errors.
 */
export function amendmentDepartureDays(value: AmendmentListRow["departureDate"], now: Date): number | null {
  const date = amendmentDate(value);
  if (!date || !Number.isFinite(now.getTime())) return null;
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(date) - day(now)) / 86_400_000);
}
export function amendmentStage(row: AmendmentListRow): Exclude<AmendmentStageFilter, "all" | "pending"> {
  if (row.status === "rejected") return "rejected";
  // Explicit pipeline stages remain authoritative (including deliberate reopen).
  // Legacy rows without a stage must not reopen an already-actioned request.
  if (row.pipelineStage == null && row.status === "actioned") return "Actioned";
  return row.pipelineStage === "Actioned" ? "Actioned" : row.pipelineStage === "In Progress" ? "In Progress" : "To Do";
}
export function amendmentDepartureLabel(row: AmendmentListRow, now: Date): string {
  const days = amendmentDepartureDays(row.departureDate, now);
  if (days == null) return "No departure date";
  if (days < 0) return "Already departed";
  if (days === 0) return "Departs today";
  if (days === 1) return "Departs tomorrow";
  return `Departs in ${days} days`;
}
export function amendmentMatches(row: AmendmentListRow, filters: AmendmentListFilters, now: Date, currentUserId?: number): boolean {
  const stage = amendmentStage(row);
  if (filters.stage === "pending") {
    if (stage !== "To Do" && stage !== "In Progress") return false;
  } else if (filters.stage !== "all" && stage !== filters.stage) return false;
  const ownerId = row.bookingAgentId ?? row.agentId;
  if (filters.agent !== "all" && String(ownerId ?? "missing") !== filters.agent) return false;
  if (filters.assignee === "unassigned") {
    if (row.assignedToId != null) return false;
  } else if (filters.assignee === "me") {
    if (!currentUserId || row.assignedToId !== currentUserId) return false;
  } else if (filters.assignee !== "all" && String(row.assignedToId ?? "unassigned") !== filters.assignee) return false;
  const days = amendmentDepartureDays(row.departureDate, now);
  const limits = { next_7: 7, next_14: 14, next_30: 30 };
  if (filters.departure === "missing" && days != null) return false;
  if (filters.departure === "departed" && (days == null || days >= 0)) return false;
  if (filters.departure === "today" && days !== 0) return false;
  if (filters.departure in limits) {
    const limit = limits[filters.departure as keyof typeof limits];
    if (days == null || days < 0 || days >= limit) return false;
  }
  const words = filters.search.normalize("NFKC").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const text = [row.id, row.bookingId, row.agentId, row.bookingAgentId, row.assignedToId, row.clientName, row.agentName, row.assignedToName, row.ptsRef, row.topdogRef, row.crmRef, row.details]
      .filter(value => value != null).join(" ").normalize("NFKC").toLocaleLowerCase();
    if (!words.every(word => text.includes(word))) return false;
  }
  return true;
}
function compareNullable(a: number | null, b: number | null, direction = 1): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return (a - b) * direction;
}
export function filterAndSortAmendments<T extends AmendmentListRow>(rows: readonly T[], filters: AmendmentListFilters, now: Date, currentUserId?: number): T[] {
  return rows.filter(row => amendmentMatches(row, filters, now, currentUserId)).sort((a, b) => {
    let result = 0;
    if (filters.sort === "departure_soonest") {
      const aDays = amendmentDepartureDays(a.departureDate, now);
      const bDays = amendmentDepartureDays(b.departureDate, now);
      const group = (days: number | null) => days == null ? 2 : days < 0 ? 1 : 0;
      result = group(aDays) - group(bDays);
      // Upcoming dates ascending; most recently departed first in the departed group.
      if (!result) result = compareNullable(aDays, bDays, aDays != null && aDays < 0 ? -1 : 1);
    } else if (filters.sort === "departure_latest") {
      result = compareNullable(amendmentDate(a.departureDate)?.getTime() ?? null, amendmentDate(b.departureDate)?.getTime() ?? null, -1);
    } else {
      result = compareNullable(amendmentDate(a.createdAt)?.getTime() ?? null, amendmentDate(b.createdAt)?.getTime() ?? null, filters.sort === "submitted_oldest" ? 1 : -1);
    }
    // Stable ties: oldest submitted first for departure sorts, then unique ID.
    return result || compareNullable(amendmentDate(a.createdAt)?.getTime() ?? null, amendmentDate(b.createdAt)?.getTime() ?? null) || a.id - b.id;
  });
}
export function amendmentFilterOptions(rows: readonly AmendmentListRow[], key: "agent" | "assignee"): { value: string; label: string }[] {
  const options = new Map<string, string>();
  for (const row of rows) {
    const id = key === "agent" ? row.bookingAgentId ?? row.agentId : row.assignedToId;
    if (id == null) continue;
    const name = key === "agent" ? row.agentName : row.assignedToName;
    const value = String(id);
    const label = name?.trim() || `${key === "agent" ? "Agent" : "Staff"} #${id}`;
    if (!options.has(value) || options.get(value)?.includes(`#${id}`)) options.set(value, label);
  }
  return Array.from(options).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}
