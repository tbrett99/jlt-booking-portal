import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";
import { DEFAULT_AMENDMENT_FILTERS, amendmentFilterOptions, type AmendmentListFilters as Filters, type AmendmentListRow } from "@shared/amendment-list";

/** One clock per page, not per card; local calendar windows stay fresh overnight. */
export function useAmendmentFilterClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    const refresh = () => setNow(new Date());
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  return now;
}
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
export default function AmendmentListFilters({ filters, onChange, rows, currentUserId, matchedCount, totalCount }: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  rows: readonly AmendmentListRow[];
  currentUserId?: number;
  matchedCount: number;
  totalCount: number;
}) {
  const id = useId();
  const agents = useMemo(() => amendmentFilterOptions(rows, "agent"), [rows]);
  const assignees = useMemo(() => amendmentFilterOptions(rows, "assignee"), [rows]);
  const change = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const changed = Object.keys(DEFAULT_AMENDMENT_FILTERS).some(key => filters[key as keyof Filters] !== DEFAULT_AMENDMENT_FILTERS[key as keyof Filters]);
  return (
    <section aria-label="Amendment filters and sorting" className="rounded-lg border bg-card p-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="space-y-1.5 xl:col-span-2">
          <Label htmlFor={`${id}-search`}>Search amendments</Label>
          <Input id={`${id}-search`} value={filters.search} onChange={event => change("search", event.target.value)} placeholder="Client, agent, reference or request details" className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-stage`}>Stage</Label>
          <select id={`${id}-stage`} className={selectClass} value={filters.stage} onChange={event => change("stage", event.target.value as Filters["stage"])}>
            <option value="all">All stages</option><option value="pending">Pending only</option><option value="To Do">To Do</option><option value="In Progress">In Progress</option><option value="Actioned">Actioned</option><option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-agent`}>Agent</Label>
          <select id={`${id}-agent`} className={selectClass} value={filters.agent} onChange={event => change("agent", event.target.value)}>
            <option value="all">All agents</option>
            {agents.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            {filters.agent !== "all" && !agents.some(option => option.value === filters.agent) && <option value={filters.agent}>Selected agent #{filters.agent} (no current requests)</option>}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-assignee`}>Assigned to</Label>
          <select id={`${id}-assignee`} className={selectClass} value={filters.assignee} onChange={event => change("assignee", event.target.value)}>
            <option value="all">All assignments</option><option value="unassigned">Unassigned</option>
            {currentUserId != null && <option value="me">Assigned to me</option>}
            {assignees.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            {filters.assignee !== "all" && filters.assignee !== "unassigned" && filters.assignee !== "me" && !assignees.some(option => option.value === filters.assignee) && <option value={filters.assignee}>Selected staff #{filters.assignee} (no current requests)</option>}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-departure`}>Departure window</Label>
          <select id={`${id}-departure`} className={selectClass} value={filters.departure} onChange={event => change("departure", event.target.value as Filters["departure"])}>
            <option value="all">All departure dates</option><option value="today">Departs today</option><option value="next_7">Next 7 days, including today</option><option value="next_14">Next 14 days, including today</option><option value="next_30">Next 30 days, including today</option><option value="departed">Already departed</option><option value="missing">No departure date</option>
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1 xl:col-span-2">
          <Label htmlFor={`${id}-sort`}>Sort by</Label>
          <select id={`${id}-sort`} className={selectClass} value={filters.sort} onChange={event => change("sort", event.target.value as Filters["sort"])}>
            <option value="departure_soonest">Closest departure first</option><option value="departure_latest">Latest departure first</option><option value="submitted_oldest">Oldest submitted first</option><option value="submitted_newest">Newest submitted first</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground space-y-1">
          <p aria-live="polite">{matchedCount} of {totalCount} amendments shown</p>
          <p>{filters.sort === "departure_soonest" ? "Upcoming departures first; already departed and missing dates follow. Ties show oldest requests first." : "Missing or invalid dates are shown last. Departure windows use your local calendar date."}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!changed} onClick={() => onChange({ ...DEFAULT_AMENDMENT_FILTERS })}><RotateCcw size={13} />Clear filters</Button>
      </div>
    </section>
  );
}
