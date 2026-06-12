import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link, useLocation } from "wouter";
import {
  ChevronLeft, ChevronRight, TrendingUp, TrendingDown,
  Users, CreditCard, BookOpen, PoundSterling, UserPlus, Mail,
  AlertCircle, CheckCircle2, Clock, ArrowRight, Activity, FileEdit, RotateCcw,
  Timer, X, BarChart2, Calendar, Target, Percent, Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function formatWeekLabel(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${monday.toLocaleDateString("en-GB", opts)} – ${sunday.toLocaleDateString("en-GB", opts)}`;
}
function getFirstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}
function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}
function fmt(n: number | undefined | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-GB");
}
function fmtGbp(n: number | undefined | null): string {
  if (n == null) return "—";
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmtPct(n: number | undefined | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}
function wow(current: number, prev: number) {
  if (prev === 0) return { pct: 0, dir: "flat" as const };
  const pct = Math.round(((current - prev) / prev) * 100);
  const dir = pct > 0 ? "up" as const : pct < 0 ? "down" as const : "flat" as const;
  return { pct: Math.abs(pct), dir };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function WoWBadge({ current, prev, invert = false, label = "WoW" }: { current: number; prev: number; invert?: boolean; label?: string }) {
  const { pct, dir } = wow(current, prev);
  if (dir === "flat") return <span className="text-xs text-muted-foreground">—</span>;
  const isGood = invert ? dir === "down" : dir === "up";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isGood ? "text-emerald-600" : "text-rose-600"}`}>
      {dir === "up" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {pct}% {label}
    </span>
  );
}

function StatCard({
  title, value, sub, icon: Icon, wow: wowProps, wowLabel, accent, link, onClick,
}: {
  title: string;
  value: string | number;
  sub?: React.ReactNode;
  icon?: React.ElementType;
  wow?: { current: number; prev: number; invert?: boolean };
  wowLabel?: string;
  accent?: "green" | "red" | "amber" | "blue" | "purple";
  link?: string;
  onClick?: () => void;
}) {
  const accentClasses: Record<string, string> = {
    green: "border-l-emerald-500",
    red: "border-l-rose-500",
    amber: "border-l-amber-500",
    blue: "border-l-blue-500",
    purple: "border-l-purple-500",
  };
  const content = (
    <Card className={`border-l-4 ${accent ? accentClasses[accent] : "border-l-transparent"} hover:shadow-md transition-shadow ${onClick || link ? "cursor-pointer" : ""}`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide truncate">{title}</p>
            <p className="text-2xl font-bold mt-1 text-foreground">{value}</p>
            {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
            {wowProps && (
              <div className="mt-1">
                <WoWBadge current={wowProps.current} prev={wowProps.prev} invert={wowProps.invert} label={wowLabel} />
              </div>
            )}
          </div>
          {Icon && (
            <div className="shrink-0 w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
              <Icon size={18} className="text-muted-foreground" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
  if (onClick) return <button className="text-left w-full" onClick={onClick}>{content}</button>;
  if (link) return <Link href={link}>{content}</Link>;
  return content;
}

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-[#70FFE8]/20 flex items-center justify-center">
        <Icon size={16} className="text-[#1a8a78]" />
      </div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((j) => (
            <Skeleton key={j} className="h-24 rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Stage label maps ─────────────────────────────────────────────────────────
const STAGE_LABELS: Record<string, string> = {
  "New Booking": "New Booking",
  "Added to PTS": "Added to PTS",
  "Creating own PTS file": "Creating PTS File",
  "Holding Accounts": "Holding Accounts",
  "Commission Claimable": "Commission Claimable",
  "Commission Claimed": "Commission Claimed",
  "Cancelled": "Cancelled",
  "Urgent": "Urgent",
  "Query": "Query",
};
const RECRUITMENT_STAGE_LABELS: Record<string, string> = {
  new_enquiry: "New Enquiry",
  application_received: "Application Received",
  ar_approved: "AR Approved",
  discovery_call_booked: "Discovery Call Booked",
  rebook_required: "Rebook Required",
  did_not_turn_up: "Did Not Turn Up",
  discovery_call_complete: "Call Complete",
  onboarding_approved: "Onboarding Approved",
  onboarding_declined: "Onboarding Declined",
  won: "Won",
  waitlisted: "Waitlisted",
};

// ─── Drill-down Dialog ────────────────────────────────────────────────────────
type DrillDownType = "signups" | "cancellations" | "ddPayments" | "subscriptions"
  | "refunds" | "reimbursements" | "amendments" | "flightTicketing" | null;

function DrillDownDialog({
  type, weekStart, onClose,
}: {
  type: DrillDownType;
  weekStart: string;
  onClose: () => void;
}) {
  const signupsQ = trpc.superAdmin.drillDownSignups.useQuery({ weekStart }, { enabled: type === "signups" });
  const cancellationsQ = trpc.superAdmin.drillDownCancellations.useQuery({ weekStart }, { enabled: type === "cancellations" });
  const ddPaymentsQ = trpc.superAdmin.drillDownDdPayments.useQuery({ weekStart }, { enabled: type === "ddPayments" });
  const subscriptionsQ = trpc.superAdmin.drillDownSubscriptions.useQuery({}, { enabled: type === "subscriptions" });
  const refundsQ = trpc.superAdmin.drillDownRefunds.useQuery({}, { enabled: type === "refunds" });
  const reimbursementsQ = trpc.superAdmin.drillDownReimbursements.useQuery({}, { enabled: type === "reimbursements" });
  const amendmentsQ = trpc.superAdmin.drillDownAmendments.useQuery({}, { enabled: type === "amendments" });
  const flightQ = trpc.superAdmin.drillDownFlightTicketing.useQuery({}, { enabled: type === "flightTicketing" });

  const titles: Record<NonNullable<DrillDownType>, string> = {
    signups: "New Sign-Ups This Week",
    cancellations: "Cancellations / Notices This Week",
    ddPayments: "DD Payments This Week",
    subscriptions: "All Active Subscriptions",
    refunds: "Open Refunds",
    reimbursements: "Pending & Scheduled Reimbursements",
    amendments: "Open Amendments",
    flightTicketing: "Pending Flight Ticketing Requests",
  };

  const isLoading = type === "signups" ? signupsQ.isLoading
    : type === "cancellations" ? cancellationsQ.isLoading
    : type === "ddPayments" ? ddPaymentsQ.isLoading
    : type === "subscriptions" ? subscriptionsQ.isLoading
    : type === "refunds" ? refundsQ.isLoading
    : type === "reimbursements" ? reimbursementsQ.isLoading
    : type === "amendments" ? amendmentsQ.isLoading
    : type === "flightTicketing" ? flightQ.isLoading
    : false;

  return (
    <Dialog open={!!type} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            {type ? titles[type] : ""}
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7"><X size={14} /></Button>
            </DialogClose>
          </DialogTitle>
        </DialogHeader>

        {isLoading && <Skeleton className="h-40" />}

        {/* Sign-ups */}
        {type === "signups" && !signupsQ.isLoading && (
          signupsQ.data?.length === 0 ? <p className="text-sm text-muted-foreground py-4">No sign-ups this week.</p> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Joined</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {signupsQ.data?.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.changedAt ? new Date(r.changedAt).toLocaleString("en-GB") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Cancellations */}
        {type === "cancellations" && !cancellationsQ.isLoading && (
          cancellationsQ.data?.length === 0 ? <p className="text-sm text-muted-foreground py-4">No cancellations this week.</p> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {cancellationsQ.data?.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell><Badge variant="destructive" className="capitalize">{r.toStatus?.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.createdAt ? new Date(r.createdAt).toLocaleString("en-GB") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* DD Payments */}
        {type === "ddPayments" && !ddPaymentsQ.isLoading && (
          ddPaymentsQ.data?.length === 0 ? <p className="text-sm text-muted-foreground py-4">No DD payments this week.</p> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>Agent</TableHead><TableHead>Event</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Date</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {ddPaymentsQ.data?.map((r: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.agentName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.eventType === "payments_failed" ? "destructive" : "secondary"} className="capitalize text-xs">
                      {r.eventType?.replace("payments_", "").replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">{r.amount ? fmtGbp(Math.round(r.amount / 100)) : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.occurredAt ? new Date(r.occurredAt).toLocaleString("en-GB") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Subscriptions */}
        {type === "subscriptions" && !subscriptionsQ.isLoading && (
          subscriptionsQ.data?.length === 0 ? <p className="text-sm text-muted-foreground py-4">No active subscriptions found.</p> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>Agent</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount/mo</TableHead><TableHead>Since</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {subscriptionsQ.data?.map((r: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.agentName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "active" ? "default" : "secondary"} className="capitalize">{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{r.amount ? fmtGbp(Math.round(r.amount / 100)) : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-GB") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Open Refunds */}
        {type === "refunds" && !refundsQ.isLoading && (
          refundsQ.data?.length === 0 ? <p className="text-sm text-muted-foreground py-4">No open refunds.</p> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Agent</TableHead><TableHead>Stage</TableHead>
              <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Days Open</TableHead><TableHead>Assigned To</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {refundsQ.data?.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{r.clientName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.ptsRef ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.agentName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{r.pipelineStage}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">{r.amountToClient ? fmtGbp(r.amountToClient) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <span className={`font-semibold text-sm ${r.daysOpen > 14 ? "text-rose-600" : r.daysOpen > 7 ? "text-amber-600" : "text-emerald-600"}`}>
                      {r.daysOpen}d
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.assignedAdminName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Pending Reimbursements */}
        {type === "reimbursements" && !reimbursementsQ.isLoading && (
          reimbursementsQ.data?.length === 0 ? <p className="text-sm text-muted-foreground py-4">No pending reimbursements.</p> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Agent</TableHead><TableHead>Supplier</TableHead>
              <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead>
              <TableHead className="text-right">Days Open</TableHead><TableHead>Assigned To</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {reimbursementsQ.data?.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{r.clientName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.ptsRef ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.agentName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.supplierName ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium text-sm">{fmtGbp(r.amount)}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "scheduled" ? "default" : "secondary"} className="capitalize text-xs">{r.status}</Badge>
                    {r.isLate && <Badge variant="destructive" className="ml-1 text-xs">Late</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`font-semibold text-sm ${r.daysOpen > 14 ? "text-rose-600" : r.daysOpen > 7 ? "text-amber-600" : "text-emerald-600"}`}>
                      {r.daysOpen}d
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.assignedAdminName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Open Amendments */}
        {type === "amendments" && !amendmentsQ.isLoading && (
          amendmentsQ.data?.length === 0 ? <p className="text-sm text-muted-foreground py-4">No open amendments.</p> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Agent</TableHead><TableHead>Stage</TableHead>
              <TableHead className="text-right">Days Open</TableHead><TableHead>Assigned To</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {amendmentsQ.data?.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{r.clientName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.ptsRef ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.agentName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{r.pipelineStage}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`font-semibold text-sm ${r.daysOpen > 7 ? "text-rose-600" : r.daysOpen > 3 ? "text-amber-600" : "text-emerald-600"}`}>
                      {r.daysOpen}d
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.assignedAdminName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Flight Ticketing */}
        {type === "flightTicketing" && !flightQ.isLoading && (
          flightQ.data?.length === 0 ? <p className="text-sm text-muted-foreground py-4">No pending flight requests.</p> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Agent</TableHead><TableHead>Supplier</TableHead>
              <TableHead>Departure</TableHead><TableHead>Deadline</TableHead>
              <TableHead className="text-right">Days to Deadline</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {flightQ.data?.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{r.clientName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.ptsRef ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.agentName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.supplier ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.departureDate ? new Date(r.departureDate).toLocaleDateString("en-GB") : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.ticketingDeadline ? new Date(r.ticketingDeadline).toLocaleDateString("en-GB") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`font-semibold text-sm ${r.daysToDeadline < 0 ? "text-rose-600" : r.daysToDeadline <= 3 ? "text-amber-600" : "text-emerald-600"}`}>
                      {r.daysToDeadline < 0 ? `${Math.abs(r.daysToDeadline)}d overdue` : `${r.daysToDeadline}d`}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Commission Margin Tab ────────────────────────────────────────────────────
function CommissionMarginTab() {
  const [, navigate] = useLocation();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<"valueAtRisk" | "margin" | "claims" | "flag">("valueAtRisk");
  const [search, setSearch] = useState("");

  const { data, isLoading } = trpc.superAdmin.agentMarginReport.useQuery(
    { minBookings: 1, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { staleTime: 60_000 }
  );

  const sorted = useMemo(() => {
    if (!data?.agents) return [];
    let agents = data.agents.filter((a) =>
      search === "" || a.agentName.toLowerCase().includes(search.toLowerCase())
    );
    if (sortBy === "margin") agents = [...agents].sort((a, b) => (a.avgMarginPct ?? 999) - (b.avgMarginPct ?? 999));
    else if (sortBy === "claims") agents = [...agents].sort((a, b) => b.totalClaims - a.totalClaims);
    else if (sortBy === "valueAtRisk") agents = [...agents].sort((a, b) => (b.valueAtRisk ?? 0) - (a.valueAtRisk ?? 0));
    else agents = [...agents].sort((a, b) => {
      const order = { red: 0, amber: 1, green: 2 };
      return order[a.flag as keyof typeof order] - order[b.flag as keyof typeof order];
    });
    return agents;
  }, [data, sortBy, search]);

  if (isLoading) return <LoadingSkeleton />;
  if (!data) return null;

  const flagColors = { red: "bg-rose-100 text-rose-700 border-rose-200", amber: "bg-amber-100 text-amber-700 border-amber-200", green: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  const trendIcon = (dir: string) => dir === "up" ? <TrendingUp size={14} className="text-emerald-600" /> : dir === "down" ? <TrendingDown size={14} className="text-rose-600" /> : <span className="text-xs text-muted-foreground">→</span>;

  return (
    <div className="space-y-6">
      <SectionHeader title="Commission Margin by Agent" icon={Percent} />

      {/* Date range filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="text-sm border rounded-md px-3 py-1.5 bg-background h-8 focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="text-sm border rounded-md px-3 py-1.5 bg-background h-8 focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            {(dateFrom || dateTo) && (
              <Button variant="outline" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                Clear filter
              </Button>
            )}
            {(dateFrom || dateTo) && (
              <span className="text-xs text-muted-foreground self-end pb-1.5">
                Showing claims {dateFrom ? `from ${dateFrom}` : ""}{dateTo ? ` to ${dateTo}` : ""}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Agents Reported" value={fmt(data.summary.totalAgentsReported)} icon={Users} accent="blue" />
        <StatCard title="Below 6% Threshold" value={fmt(data.summary.agentsBelowThreshold)} icon={AlertCircle} accent={data.summary.agentsBelowThreshold > 0 ? "red" : undefined} sub="Needs attention" />
        <StatCard title="Amber (6–8%)" value={fmt(data.summary.agentsAmber)} accent={data.summary.agentsAmber > 0 ? "amber" : undefined} />
        <StatCard title="Total Value at Risk" value={fmtGbp((data.summary as any).totalValueAtRisk)} accent={(data.summary as any).totalValueAtRisk > 0 ? "red" : "green"}
          sub="Gross cost on sub-6% claims" />
      </div>

      {/* Agent detail table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-sm font-semibold">Agent Margin Detail</CardTitle>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search agent..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-sm border rounded-md px-3 py-1.5 bg-background h-8 w-48 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="text-sm border rounded-md px-2 py-1.5 bg-background h-8 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="valueAtRisk">Sort: Value at Risk</option>
                <option value="flag">Sort: RAG Status</option>
                <option value="margin">Sort: Lowest Margin</option>
                <option value="claims">Sort: Most Claims</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Avg Margin</TableHead>
                <TableHead className="text-right">Trend</TableHead>
                <TableHead className="text-right">Claims</TableHead>
                <TableHead className="text-right">Bookings</TableHead>
                <TableHead className="text-right">Value at Risk</TableHead>
                <TableHead className="text-right">Total Commission</TableHead>
                <TableHead className="text-right">Gross Cost</TableHead>
                <TableHead className="text-right">Last Claim</TableHead>
                <TableHead>3-Month Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((a) => {
                const lastClaimDaysAgo = a.lastClaimDate
                  ? Math.floor((Date.now() - new Date(a.lastClaimDate).getTime()) / 86400000)
                  : null;
                const lastClaimStale = lastClaimDaysAgo !== null && lastClaimDaysAgo > 60;
                return (
                  <TableRow key={a.agentId} className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/crm/agents?agent=${a.agentId}`)}
                    title="Click to view agent in CRM">
                    <TableCell>
                      <div className="font-medium text-sm">{a.agentName}</div>
                      <div className="text-xs text-muted-foreground">{a.agentEmail}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${flagColors[a.flag as keyof typeof flagColors]}`}>
                        {a.flag === "red" ? "⚠ Below 6%" : a.flag === "amber" ? "~ 6–8%" : "✓ Healthy"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <span className={a.avgMarginPct !== null && a.avgMarginPct < 6 ? "text-rose-600" : a.avgMarginPct !== null && a.avgMarginPct < 8 ? "text-amber-600" : "text-emerald-600"}>
                        {fmtPct(a.avgMarginPct)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end">{trendIcon((a as any).trendDirection ?? "flat")}</div>
                    </TableCell>
                    <TableCell className="text-right">{fmt(a.totalClaims)}</TableCell>
                    <TableCell className="text-right">{fmt((a as any).totalBookingsCount)}</TableCell>
                    <TableCell className="text-right">
                      {(a as any).valueAtRisk > 0
                        ? <span className="text-rose-600 font-semibold">{fmtGbp((a as any).valueAtRisk)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">{fmtGbp(a.totalGrossCommission)}</TableCell>
                    <TableCell className="text-right">{fmtGbp(a.totalGrossCost)}</TableCell>
                    <TableCell className="text-right">
                      {a.lastClaimDate ? (
                        <span className={lastClaimStale ? "text-amber-600 text-xs" : "text-xs text-muted-foreground"}>
                          {new Date(a.lastClaimDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                          {lastClaimStale && <span className="block text-amber-600">{lastClaimDaysAgo}d ago</span>}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell>
                      {a.trend.length > 0 ? (
                        <div className="flex items-end gap-0.5 h-8">
                          {a.trend.map((t) => {
                            const height = Math.max(4, Math.min(32, (t.avgMarginPct / 15) * 32));
                            const color = t.avgMarginPct < 6 ? "bg-rose-400" : t.avgMarginPct < 8 ? "bg-amber-400" : "bg-emerald-400";
                            return (
                              <div key={t.month} title={`${t.month}: ${fmtPct(t.avgMarginPct)} (${t.claimCount} claims)`}
                                className={`w-4 rounded-sm ${color} transition-all`} style={{ height: `${height}px` }} />
                            );
                          })}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">No data</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-8 text-muted-foreground text-sm">No agents found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
        <strong>Margin calculation:</strong> Commission gross amount ÷ booking gross cost × 100. Red = any claim below 6%, Amber = all claims between 6–8%, Green = all claims ≥8%. <strong>Value at Risk</strong> = total gross cost on bookings where margin is below 6% — sorted highest first so the biggest problems appear at the top. Trend arrow compares most recent month to the previous month (±0.5% threshold). Click any row to view the agent in the CRM.
      </div>
    </div>
  );
}

// ─── Monthly View ─────────────────────────────────────────────────────────────
function MonthlyView({ monthStart }: { monthStart: string }) {
  const { data, isLoading, error } = trpc.superAdmin.monthlyStats.useQuery(
    { monthStart },
    { staleTime: 120_000 }
  );
  if (isLoading) return <LoadingSkeleton />;
  if (error) return (
    <Card className="border-rose-200 bg-rose-50">
      <CardContent className="pt-4 text-rose-700 text-sm">Failed to load monthly data. Please try refreshing.</CardContent>
    </Card>
  );
  if (!data) return null;

  const { membership, ddRevenue, bookings, financials, recruitment, staffProductivity, communications, monthlyTrend } = data;

  return (
    <div className="space-y-6">
      {/* Overview strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: "Active Agents", value: fmt(membership.totalActiveAgents), color: "text-emerald-600" },
          { label: "New Sign-Ups", value: fmt(membership.newSignupsThisMonth), color: "text-blue-600" },
          { label: "Cancellations", value: fmt(membership.cancellationsThisMonth), color: "text-rose-600" },
          { label: "MRR", value: fmtGbp(ddRevenue.mrrGbp), color: "text-purple-600" },
          { label: "DD Paid Out", value: fmtGbp(ddRevenue.paidOutThisMonthGbp), color: "text-emerald-600" },
          { label: "New Bookings", value: fmt(bookings.newBookingsThisMonth), color: "text-blue-600" },
          { label: "JLT Revenue", value: fmtGbp(financials.jltRevenueThisMonth), color: "text-emerald-600" },
          { label: "New Prospects", value: fmt(recruitment.newProspectsThisMonth), color: "text-amber-600" },
        ].map((item) => (
          <div key={item.label} className="bg-card border rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className={`text-lg font-bold mt-0.5 ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="membership">
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="membership"><Users size={14} className="mr-1" />Membership</TabsTrigger>
          <TabsTrigger value="dd"><CreditCard size={14} className="mr-1" />DD Revenue</TabsTrigger>
          <TabsTrigger value="bookings"><BookOpen size={14} className="mr-1" />Bookings</TabsTrigger>
          <TabsTrigger value="financials"><PoundSterling size={14} className="mr-1" />Financials</TabsTrigger>
          <TabsTrigger value="recruitment"><UserPlus size={14} className="mr-1" />Recruitment</TabsTrigger>
          <TabsTrigger value="staff"><Activity size={14} className="mr-1" />Staff</TabsTrigger>
          <TabsTrigger value="trends"><BarChart2 size={14} className="mr-1" />Trends</TabsTrigger>
        </TabsList>

        {/* Membership */}
        <TabsContent value="membership" className="space-y-6">
          <SectionHeader title="Membership & Retention" icon={Users} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Total Active Agents" value={fmt(membership.totalActiveAgents)} icon={Users} accent="green" sub={`${fmt(membership.totalPayingAgents)} incl. paused`} />
            <StatCard title="New Sign-Ups" value={fmt(membership.newSignupsThisMonth)} icon={UserPlus} accent="blue"
              wow={{ current: membership.newSignupsThisMonth, prev: membership.newSignupsPrevMonth }} wowLabel="MoM" />
            <StatCard title="Cancellations / In Notice" value={fmt(membership.cancellationsThisMonth)} icon={TrendingDown}
              accent={membership.cancellationsThisMonth > 0 ? "red" : undefined}
              wow={{ current: membership.cancellationsThisMonth, prev: membership.cancellationsPrevMonth, invert: true }} wowLabel="MoM" />
            <StatCard title="Net Growth" value={`${membership.netGrowthThisMonth >= 0 ? "+" : ""}${fmt(membership.netGrowthThisMonth)}`}
              accent={membership.netGrowthThisMonth >= 0 ? "green" : "red"} sub="New minus cancellations" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard title="In Notice Period" value={fmt(membership.inNoticeCount)} accent={membership.inNoticeCount > 0 ? "amber" : undefined} />
            <StatCard title="Paused Agents" value={fmt(membership.pausedCount)} accent={membership.pausedCount > 0 ? "amber" : undefined} />
          </div>
          {membership.tierBreakdown.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Active Agents by Tier</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {membership.tierBreakdown.sort((a, b) => b.count - a.count).map((tier) => {
                    const pct = membership.totalActiveAgents > 0 ? Math.round((tier.count / membership.totalActiveAgents) * 100) : 0;
                    return (
                      <div key={tier.tier} className="flex items-center gap-3">
                        <div className="w-32 text-sm font-medium truncate">{tier.tier || "Unknown"}</div>
                        <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                          <div className="h-full bg-[#70FFE8] rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-sm font-semibold w-16 text-right">{tier.count} <span className="text-muted-foreground font-normal text-xs">({pct}%)</span></div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* DD Revenue */}
        <TabsContent value="dd" className="space-y-6">
          <SectionHeader title="Direct Debit Revenue" icon={CreditCard} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Monthly Recurring Revenue" value={fmtGbp(ddRevenue.mrrGbp)} icon={PoundSterling} accent="blue" sub="Active subscriptions" />
            <StatCard title="DD Paid Out" value={fmtGbp(ddRevenue.paidOutThisMonthGbp)} icon={CheckCircle2} accent="green"
              wow={{ current: ddRevenue.paidOutThisMonthGbp, prev: ddRevenue.paidOutPrevMonthGbp }} wowLabel="MoM"
              sub={`${fmt(ddRevenue.paidOutThisMonthCount)} payments landed`} />
            <StatCard title="DD Confirmed (Total)" value={fmtGbp(ddRevenue.confirmedThisMonthGbp)} icon={CreditCard} accent="green"
              wow={{ current: ddRevenue.confirmedThisMonthGbp, prev: ddRevenue.confirmedPrevMonthGbp }} wowLabel="MoM"
              sub={`${fmt(ddRevenue.confirmedThisMonthCount)} payments total`} />
            <StatCard title="Failed Payments" value={fmt(ddRevenue.failedThisMonthCount)} icon={AlertCircle}
              accent={ddRevenue.failedThisMonthCount > 0 ? "red" : undefined}
              sub={`${fmtGbp(ddRevenue.failedThisMonthGbp)} at risk`} />
          </div>
          {/* DD split: subscription vs joining fees */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Subscription DD Confirmed" value={fmtGbp((ddRevenue as any).subscriptionConfirmedThisMonthGbp)} icon={CreditCard} accent="blue"
              sub={`${fmt((ddRevenue as any).subscriptionConfirmedThisMonthCount)} monthly DD collections`} />
            <StatCard title="Joining Fees Confirmed" value={fmtGbp((ddRevenue as any).joiningFeeConfirmedThisMonthGbp)} icon={UserPlus} accent="green"
              sub={`${fmt((ddRevenue as any).joiningFeeConfirmedThisMonthCount)} new member joining fees`} />
          </div>
        </TabsContent>

        {/* Bookings */}
        <TabsContent value="bookings" className="space-y-6">
          <SectionHeader title="Bookings & Pipeline" icon={BookOpen} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="New Bookings" value={fmt(bookings.newBookingsThisMonth)} icon={BookOpen} accent="blue"
              wow={{ current: bookings.newBookingsThisMonth, prev: bookings.newBookingsPrevMonth }} wowLabel="MoM" />
            <StatCard title="Pipeline Moves" value={fmt(bookings.pipelineMovesThisMonth)} icon={ArrowRight} />
            <StatCard title="Amendments (New)" value={fmt(bookings.amendmentsThisMonth)} icon={FileEdit}
              accent={bookings.amendmentsThisMonth > 0 ? "amber" : undefined} />
            <StatCard title="Amendments Actioned" value={fmt(bookings.amendmentsActionedThisMonth)} icon={CheckCircle2} accent="green" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Refunds (New)" value={fmt(bookings.refundsThisMonth)} icon={RotateCcw}
              accent={bookings.refundsThisMonth > 0 ? "amber" : undefined} />
            <StatCard title="Flight Requests (New)" value={fmt(bookings.flightRequestsThisMonth)} />
            <StatCard title="Flight Requests (Pending)" value={fmt(bookings.flightRequestsPending)}
              accent={bookings.flightRequestsPending > 0 ? "amber" : undefined} />
          </div>
          {bookings.pipelineStageDistribution.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Current Pipeline Distribution</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {bookings.pipelineStageDistribution.map((s) => {
                    const total = bookings.pipelineStageDistribution.reduce((a, b) => a + b.count, 0);
                    const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                    return (
                      <div key={s.stage} className="flex items-center gap-3">
                        <div className="w-40 text-sm font-medium truncate">{STAGE_LABELS[s.stage] ?? s.stage}</div>
                        <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                          <div className="h-full bg-[#70FFE8] rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-sm font-semibold w-16 text-right">{s.count} <span className="text-muted-foreground font-normal text-xs">({pct}%)</span></div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Financials */}
        <TabsContent value="financials" className="space-y-6">
          <SectionHeader title="Financials" icon={PoundSterling} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="JLT Revenue (Remittance)" value={fmtGbp(financials.jltRevenueThisMonth)} icon={PoundSterling} accent="green"
              wow={{ current: financials.jltRevenueThisMonth, prev: financials.jltRevenuePrevMonth }} wowLabel="MoM" sub="20% JLT share from PTS" />
            <StatCard title="Agent Payouts" value={fmtGbp(financials.agentPayoutsThisMonth)} icon={PoundSterling} accent="blue" sub="80% agent share from PTS remittance" />
            <StatCard title="Commission Claims (New)" value={fmt(financials.commissionClaimsThisMonth)} sub={`${fmtGbp(financials.commissionClaimsGrossThisMonth)} gross`} />
            <StatCard title="Commissions Paid" value={fmt(financials.commissionClaimsPaidThisMonth)} icon={CheckCircle2} accent="green"
              sub={`${fmtGbp(financials.commissionClaimsPaidGrossThisMonth)} from expected commission`} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Reimbursements Paid" value={fmt(financials.reimbursementsPaidThisMonth)} icon={CheckCircle2} accent="green"
              sub={`${fmtGbp(financials.reimbursementsPaidTotalThisMonth)} total`} />
            <StatCard title="Reimbursements Scheduled" value={fmt(financials.reimbursementsScheduledCount)} icon={Clock}
              accent={financials.reimbursementsScheduledCount > 0 ? "blue" : undefined}
              sub={`${fmtGbp(financials.reimbursementsScheduledTotal)} scheduled`} />
            <StatCard title="Reimbursements Pending" value={fmt(financials.reimbursementsPendingCount)} icon={Clock}
              accent={financials.reimbursementsPendingCount > 0 ? "amber" : undefined}
              sub={`${fmtGbp(financials.reimbursementsPendingTotal)} outstanding`} />
          </div>
        </TabsContent>

        {/* Recruitment */}
        <TabsContent value="recruitment" className="space-y-6">
          <SectionHeader title="Recruitment Pipeline" icon={UserPlus} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="New Prospects" value={fmt(recruitment.newProspectsThisMonth)} icon={UserPlus} accent="blue"
              wow={{ current: recruitment.newProspectsThisMonth, prev: recruitment.newProspectsPrevMonth }} wowLabel="MoM" />
            <StatCard title="Won This Month" value={fmt(recruitment.wonProspectsThisMonth)} icon={CheckCircle2} accent="green" sub="Converted to agents" />
            <StatCard title="Conversion Rate (All Time)" value={fmtPct(recruitment.conversionRate)} icon={Target} accent="purple" />
            <StatCard title="Avg Time to Sign-Up" value={`${recruitment.avgTimeToSignupDays}d`} icon={Clock} sub="Enquiry to won" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard title="Total Enquiries" value={fmt(recruitment.totalEnquiries)} />
            <StatCard title="Total Applications" value={fmt(recruitment.totalApplications)} />
            <StatCard title="Total Won (All Time)" value={fmt(recruitment.totalWon)} accent="green" />
          </div>
          {recruitment.funnel.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Current Recruitment Funnel</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recruitment.funnel.sort((a, b) => b.count - a.count).map((s) => {
                    const total = recruitment.funnel.reduce((acc, r) => acc + r.count, 0);
                    const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                    return (
                      <div key={s.stage} className="flex items-center gap-3">
                        <div className="w-44 text-sm font-medium truncate">{RECRUITMENT_STAGE_LABELS[s.stage] ?? s.stage}</div>
                        <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                          <div className="h-full bg-[#70FFE8] rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-sm font-semibold w-16 text-right">{s.count} <span className="text-muted-foreground font-normal text-xs">({pct}%)</span></div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Staff */}
        <TabsContent value="staff" className="space-y-6">
          <SectionHeader title="Staff Productivity (This Month)" icon={Activity} />
          {staffProductivity.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No staff activity recorded for this month.</div>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team Member</TableHead>
                      <TableHead className="text-right">Pipeline Moves</TableHead>
                      <TableHead className="text-right">Tasks Done</TableHead>
                      <TableHead className="text-right">Amendments</TableHead>
                      <TableHead className="text-right">Comm. Paid</TableHead>
                      <TableHead className="text-right">Reimb. Paid</TableHead>
                      <TableHead className="text-right">Status Changes</TableHead>
                      <TableHead className="text-right">Notes</TableHead>
                      <TableHead className="text-right">Recruitment</TableHead>
                      <TableHead className="text-right font-semibold bg-muted/50">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staffProductivity.map((s: any, idx: number) => (
                      <TableRow key={s.adminId} className={idx === 0 ? "bg-[#70FFE8]/5" : ""}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {idx === 0 && <span className="text-[10px] font-bold text-[#1a8a78] bg-[#70FFE8]/20 px-1.5 py-0.5 rounded">TOP</span>}
                            {s.adminName}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{s.pipelineMoves || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">{s.tasksCompleted || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">{s.amendmentsActioned || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">{s.commissionsPaid || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">{s.reimbursementsPaid || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">{s.statusChanges || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">{s.bookingNotes || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">{s.recruitmentMoves || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right font-bold text-foreground bg-muted/50">{s.totalActions}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* 12-Month Trends */}
        <TabsContent value="trends" className="space-y-6">
          <SectionHeader title="12-Month Trend Analysis" icon={BarChart2} />
          {monthlyTrend.length > 0 ? (
            <>
              {/* Revenue & DD */}
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Revenue Trends (£)</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={monthlyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => fmtGbp(v)} />
                      <Legend />
                      <Line type="monotone" dataKey="jltRevenue" name="JLT Revenue" stroke="#70FFE8" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="ddPaidOut" name="DD Paid Out" stroke="#6366f1" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Membership */}
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Membership Trends</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={monthlyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="newSignups" name="New Sign-Ups" fill="#70FFE8" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="cancellations" name="Cancellations" fill="#f87171" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Bookings & Recruitment */}
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Bookings & Recruitment Trends</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={monthlyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="newBookings" name="New Bookings" stroke="#60a5fa" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="newProspects" name="New Prospects" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="commissionClaims" name="Commission Claims" stroke="#a78bfa" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Raw data table */}
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Monthly Data Table</CardTitle></CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">New Sign-Ups</TableHead>
                        <TableHead className="text-right">Cancellations</TableHead>
                        <TableHead className="text-right">New Bookings</TableHead>
                        <TableHead className="text-right">DD Paid Out</TableHead>
                        <TableHead className="text-right">JLT Revenue</TableHead>
                        <TableHead className="text-right">Comm. Claims</TableHead>
                        <TableHead className="text-right">New Prospects</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...monthlyTrend].reverse().map((m) => (
                        <TableRow key={m.month}>
                          <TableCell className="font-medium">{m.month}</TableCell>
                          <TableCell className="text-right">{fmt(m.newSignups)}</TableCell>
                          <TableCell className="text-right">{fmt(m.cancellations)}</TableCell>
                          <TableCell className="text-right">{fmt(m.newBookings)}</TableCell>
                          <TableCell className="text-right">{fmtGbp(m.ddPaidOut)}</TableCell>
                          <TableCell className="text-right">{fmtGbp(m.jltRevenue)}</TableCell>
                          <TableCell className="text-right">{fmt(m.commissionClaims)}</TableCell>
                          <TableCell className="text-right">{fmt(m.newProspects)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground text-sm">No trend data available.</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [currentMonday, setCurrentMonday] = useState(() => getMondayOfWeek(new Date()));
  const [currentMonth, setCurrentMonth] = useState(() => getFirstOfMonth(new Date()));
  const [drillDown, setDrillDown] = useState<DrillDownType>(null);
  const weekStartStr = useMemo(() => toISODate(currentMonday), [currentMonday]);
  const monthStartStr = useMemo(() => toISODate(currentMonth), [currentMonth]);

  const isCurrentWeek = useMemo(() => {
    const thisMonday = getMondayOfWeek(new Date());
    return currentMonday.getTime() === thisMonday.getTime();
  }, [currentMonday]);
  const isCurrentMonth = useMemo(() => {
    const thisMonth = getFirstOfMonth(new Date());
    return currentMonth.getTime() === thisMonth.getTime();
  }, [currentMonth]);

  const mandateSyncMutation = trpc.crm.mandateSync.sync.useMutation({
    onSuccess: (result) => {
      toast.success(`Mandate sync complete: ${result.updated} updated, ${result.unchanged} unchanged${result.failed > 0 ? `, ${result.failed} failed` : ""}`);
      mandateSummaryQ.refetch();
    },
    onError: (e) => toast.error(`Sync failed: ${e.message}`),
  });
  const mandateSummaryQ = trpc.crm.mandateSync.summary.useQuery();

  const { data, isLoading, error } = trpc.superAdmin.weeklyStats.useQuery(
    { weekStart: weekStartStr },
    { staleTime: 60_000, enabled: viewMode === "week" }
  );

  function prevWeek() {
    setCurrentMonday((d) => { const n = new Date(d); n.setDate(d.getDate() - 7); return n; });
  }
  function nextWeek() {
    if (isCurrentWeek) return;
    setCurrentMonday((d) => { const n = new Date(d); n.setDate(d.getDate() + 7); return n; });
  }
  function prevMonth() {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1, 0, 0, 0, 0));
  }
  function nextMonth() {
    if (isCurrentMonth) return;
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0));
  }

  if (user?.role !== "super_admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <AlertCircle size={40} className="mx-auto text-rose-500" />
          <p className="text-lg font-semibold">Access Restricted</p>
          <p className="text-sm text-muted-foreground">This area is only accessible to Super Admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Business Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Super Admin — performance overview</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* View mode toggle */}
          <div className="flex items-center bg-muted rounded-lg p-1 gap-1">
            <button
              onClick={() => setViewMode("week")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "week" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Clock size={13} className="inline mr-1" />Weekly
            </button>
            <button
              onClick={() => setViewMode("month")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "month" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Calendar size={13} className="inline mr-1" />Monthly
            </button>
          </div>

          {/* Period navigator */}
          {viewMode === "week" ? (
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevWeek}><ChevronLeft size={16} /></Button>
              <span className="text-sm font-medium min-w-[180px] text-center">
                {isCurrentWeek ? "This Week · " : ""}{formatWeekLabel(currentMonday)}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextWeek} disabled={isCurrentWeek}><ChevronRight size={16} /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}><ChevronLeft size={16} /></Button>
              <span className="text-sm font-medium min-w-[160px] text-center">
                {isCurrentMonth ? "This Month · " : ""}{formatMonthLabel(currentMonth)}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth} disabled={isCurrentMonth}><ChevronRight size={16} /></Button>
            </div>
          )}
        </div>
      </div>

      {/* Monthly view */}
      {viewMode === "month" && <MonthlyView monthStart={monthStartStr} />}

      {/* Weekly view */}
      {viewMode === "week" && (
        <>
          {isLoading && <LoadingSkeleton />}
          {error && (
            <Card className="border-rose-200 bg-rose-50">
              <CardContent className="pt-4 text-rose-700 text-sm">Failed to load dashboard data. Please try refreshing.</CardContent>
            </Card>
          )}

          {data && (
            <>
              {/* Overview strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                {[
                  { label: "Active Agents", value: fmt(data.membership.totalActiveAgents), color: "text-emerald-600" },
                  { label: "New Sign-Ups", value: fmt(data.membership.newSignupsThisWeek), color: "text-blue-600" },
                  { label: "Cancellations", value: fmt(data.membership.cancellationsThisWeek), color: "text-rose-600" },
                  { label: "MRR", value: fmtGbp(data.ddRevenue.mrrGbp), color: "text-purple-600" },
                  { label: "DD Confirmed", value: fmtGbp(data.ddRevenue.confirmedThisWeekGbp), color: "text-emerald-600" },
                  { label: "New Bookings", value: fmt(data.bookings.newBookingsThisWeek), color: "text-blue-600" },
                  { label: "JLT Revenue", value: fmtGbp(data.financials.jltRevenueThisWeek), color: "text-emerald-600" },
                  { label: "New Prospects", value: fmt(data.recruitment.newProspectsThisWeek), color: "text-amber-600" },
                ].map((item) => (
                  <div key={item.label} className="bg-card border rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className={`text-lg font-bold mt-0.5 ${item.color}`}>{item.value}</p>
                  </div>
                ))}
              </div>

              <Tabs defaultValue="membership">
                <TabsList className="flex flex-wrap gap-1 h-auto">
                  <TabsTrigger value="membership"><Users size={14} className="mr-1" />Membership</TabsTrigger>
                  <TabsTrigger value="dd"><CreditCard size={14} className="mr-1" />DD Revenue</TabsTrigger>
                  <TabsTrigger value="bookings"><BookOpen size={14} className="mr-1" />Bookings</TabsTrigger>
                  <TabsTrigger value="financials"><PoundSterling size={14} className="mr-1" />Financials</TabsTrigger>
                  <TabsTrigger value="recruitment"><UserPlus size={14} className="mr-1" />Recruitment</TabsTrigger>
                  <TabsTrigger value="staff"><Activity size={14} className="mr-1" />Staff</TabsTrigger>
                  <TabsTrigger value="comms"><Mail size={14} className="mr-1" />Comms</TabsTrigger>
                  <TabsTrigger value="margin"><Percent size={14} className="mr-1" />Margins</TabsTrigger>
                </TabsList>

                {/* ── MEMBERSHIP TAB ── */}
                <TabsContent value="membership" className="space-y-6">
                  <SectionHeader title="Membership & Retention" icon={Users} />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="Total Active Agents" value={fmt(data.membership.totalActiveAgents)} icon={Users} accent="green"
                      sub={`${fmt(data.membership.totalPayingAgents)} incl. paused`} />
                    <StatCard title="New Sign-Ups" value={fmt(data.membership.newSignupsThisWeek)} icon={UserPlus} accent="blue"
                      wow={{ current: data.membership.newSignupsThisWeek, prev: data.membership.newSignupsPrevWeek }}
                      sub="Joining fee payments confirmed"
                      onClick={() => setDrillDown("signups")} />
                    <StatCard title="Cancellations / In Notice" value={fmt(data.membership.cancellationsThisWeek)} icon={TrendingDown}
                      accent={data.membership.cancellationsThisWeek > 0 ? "red" : undefined}
                      wow={{ current: data.membership.cancellationsThisWeek, prev: data.membership.cancellationsPrevWeek, invert: true }}
                      onClick={() => setDrillDown("cancellations")} />
                    <StatCard title="Net Growth" value={`${data.membership.netGrowthThisWeek >= 0 ? "+" : ""}${fmt(data.membership.netGrowthThisWeek)}`}
                      accent={data.membership.netGrowthThisWeek >= 0 ? "green" : "red"} sub="New minus cancellations" />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <StatCard title="In Notice Period" value={fmt(data.membership.inNoticeCount)} accent={data.membership.inNoticeCount > 0 ? "amber" : undefined}
                      sub="Agents serving notice" link="/crm/agents" />
                    <StatCard title="Paused Agents" value={fmt(data.membership.pausedCount)} accent={data.membership.pausedCount > 0 ? "amber" : undefined}
                      sub="Temporarily paused" link="/crm/agents" />
                  </div>
                  {data.membership.tierBreakdown.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Active Agents by Membership Tier</CardTitle></CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {data.membership.tierBreakdown.sort((a, b) => b.count - a.count).map((tier) => {
                            const pct = data.membership.totalActiveAgents > 0 ? Math.round((tier.count / data.membership.totalActiveAgents) * 100) : 0;
                            return (
                              <div key={tier.tier} className="flex items-center gap-3">
                                <div className="w-32 text-sm font-medium truncate">{tier.tier || "Unknown"}</div>
                                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                                  <div className="h-full bg-[#70FFE8] rounded-full transition-all" style={{ width: `${pct}%` }} />
                                </div>
                                <div className="text-sm font-semibold w-16 text-right">
                                  {tier.count} <span className="text-muted-foreground font-normal text-xs">({pct}%)</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ── DD REVENUE TAB ── */}
                <TabsContent value="dd" className="space-y-6">
                  <SectionHeader title="Direct Debit Revenue (GoCardless)" icon={CreditCard} />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="Active Subscriptions" value={fmt(data.ddRevenue.activeSubscriptions)} icon={CheckCircle2} accent="green"
                      sub={`${fmt(data.ddRevenue.totalGcSubscriptions)} incl. paused`} onClick={() => setDrillDown("subscriptions")} />
                    <StatCard title="Monthly Recurring Revenue" value={fmtGbp(data.ddRevenue.mrrGbp)} icon={PoundSterling} accent="blue" sub="Based on active subscriptions" />
                    <StatCard title="DD Confirmed This Week" value={fmtGbp(data.ddRevenue.confirmedThisWeekGbp)} icon={CreditCard} accent="green"
                      wow={{ current: data.ddRevenue.confirmedThisWeekGbp, prev: data.ddRevenue.confirmedPrevWeekGbp }}
                      sub={`${fmt(data.ddRevenue.paymentsConfirmedThisWeek)} payments submitted to bank`}
                      onClick={() => setDrillDown("ddPayments")} />
                    <StatCard title="Paid Out This Week" value={fmtGbp(data.ddRevenue.paidOutThisWeekGbp)} icon={CheckCircle2} accent="green"
                      sub={`${fmt(data.ddRevenue.paymentsPaidOutThisWeek)} payments landed in bank`} />
                  </div>
                  {/* DD split: subscription vs joining fees */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="Subscription DD Confirmed" value={fmtGbp((data.ddRevenue as any).subscriptionConfirmedThisWeekGbp)} icon={CreditCard} accent="blue"
                      sub={`${fmt((data.ddRevenue as any).subscriptionConfirmedThisWeekCount)} monthly DD collections`} />
                    <StatCard title="Joining Fees Confirmed" value={fmtGbp((data.ddRevenue as any).joiningFeeConfirmedThisWeekGbp)} icon={UserPlus} accent="green"
                      sub={`${fmt((data.ddRevenue as any).joiningFeeConfirmedThisWeekCount)} new member joining fees`} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="Failed Payments" value={fmt(data.ddRevenue.failedPaymentsThisWeek)} icon={AlertCircle}
                      accent={data.ddRevenue.failedPaymentsThisWeek > 0 ? "red" : undefined} sub={`${fmtGbp(data.ddRevenue.failedAmountGbp)} at risk`} />
                    <StatCard title="New Mandates" value={fmt(data.ddRevenue.newMandatesThisWeek)} icon={UserPlus} accent="green" />
                    <StatCard title="Cancelled Mandates" value={fmt(data.ddRevenue.cancelledMandatesThisWeek)} accent={data.ddRevenue.cancelledMandatesThisWeek > 0 ? "red" : undefined} />
                    <StatCard title="Agents w/ Consecutive Failures" value={fmt(data.ddRevenue.agentsWithConsecutiveFailures)} icon={AlertCircle}
                      accent={data.ddRevenue.agentsWithConsecutiveFailures > 0 ? "amber" : undefined} link="/crm/memberships" />
                  </div>
                  <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
                    <div className="text-sm">
                      <span className="font-medium">Mandate Status Sync</span>
                      {mandateSummaryQ.data && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          {mandateSummaryQ.data.total} mandates — {mandateSummaryQ.data.active} active · {mandateSummaryQ.data.pending} pending · {mandateSummaryQ.data.cancelled} cancelled · {mandateSummaryQ.data.failed} failed
                        </span>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => mandateSyncMutation.mutate()} disabled={mandateSyncMutation.isPending}>
                      {mandateSyncMutation.isPending ? "Syncing..." : "Sync Mandates from GoCardless"}
                    </Button>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                    <strong>Confirmed vs Paid Out:</strong> "Confirmed" = GoCardless has submitted the payment to the bank (usually 3–5 business days before settlement). "Paid Out" = funds have actually landed in your JLT bank account. These will differ week-to-week due to settlement timing.
                  </div>
                </TabsContent>

                {/* ── BOOKINGS TAB ── */}
                <TabsContent value="bookings" className="space-y-6">
                  <SectionHeader title="Bookings & Pipeline" icon={BookOpen} />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="New Bookings" value={fmt(data.bookings.newBookingsThisWeek)} icon={BookOpen} accent="blue"
                      wow={{ current: data.bookings.newBookingsThisWeek, prev: data.bookings.newBookingsPrevWeek }} />
                    <StatCard title="Pipeline Moves" value={fmt(data.bookings.pipelineMovesThisWeek)} icon={ArrowRight} sub="Bookings moved between stages" />
                    <StatCard title="Amendments (New)" value={fmt(data.bookings.amendmentsThisWeek)} icon={FileEdit}
                      accent={data.bookings.amendmentsThisWeek > 0 ? "amber" : undefined}
                      onClick={() => setDrillDown("amendments")} />
                    <StatCard title="Amendments Actioned" value={fmt(data.bookings.amendmentsActionedThisWeek)} icon={CheckCircle2} accent="green" />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="Refunds (New)" value={fmt(data.bookings.refundsThisWeek)} icon={RotateCcw}
                      accent={data.bookings.refundsThisWeek > 0 ? "amber" : undefined}
                      onClick={() => setDrillDown("refunds")} />
                    <StatCard title="Flight Requests (New)" value={fmt(data.bookings.flightRequestsThisWeek)} />
                    <StatCard title="Flight Requests (Pending)" value={fmt(data.bookings.flightRequestsPending)}
                      accent={data.bookings.flightRequestsPending > 0 ? "amber" : undefined}
                      onClick={() => setDrillDown("flightTicketing")} />
                  </div>

                  {data.bookings.refundsByStage.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold flex items-center justify-between">
                          <span className="flex items-center gap-2"><RotateCcw size={14} />Open Refunds by Stage</span>
                          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setDrillDown("refunds")}>
                            View All <ArrowRight size={12} className="ml-1" />
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2">
                          {data.bookings.refundsByStage.map((r) => (
                            <div key={r.stage} className="flex items-center gap-1.5 bg-muted rounded-full px-3 py-1 text-xs">
                              <span className="font-medium">{r.stage}</span>
                              <Badge variant="secondary" className="text-xs h-4 px-1.5">{r.count}</Badge>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {data.bookings.pipelineStageDistribution.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Current Pipeline Distribution</CardTitle></CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {data.bookings.pipelineStageDistribution.map((s) => {
                            const total = data.bookings.pipelineStageDistribution.reduce((a, b) => a + b.count, 0);
                            const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                            const stageColors: Record<string, string> = {
                              "New Booking": "bg-blue-400", "Added to PTS": "bg-emerald-400",
                              "Commission Claimable": "bg-amber-400", "Commission Claimed": "bg-purple-400",
                              "Urgent": "bg-rose-500", "Query": "bg-orange-400", "Cancelled": "bg-gray-400",
                            };
                            const barColor = stageColors[s.stage] ?? "bg-[#70FFE8]";
                            return (
                              <div key={s.stage} className="flex items-center gap-3">
                                <div className="w-40 text-sm font-medium truncate">{STAGE_LABELS[s.stage] ?? s.stage}</div>
                                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                                  <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                                </div>
                                <div className="text-sm font-semibold w-16 text-right">
                                  {s.count} <span className="text-muted-foreground font-normal text-xs">({pct}%)</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {data.bookings.pipelineDwellTime && data.bookings.pipelineDwellTime.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Timer size={14} />Average Days Files Sit in Each Stage
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Pipeline Stage</TableHead>
                              <TableHead className="text-right">Avg Days</TableHead>
                              <TableHead className="text-right">Bookings Counted</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.bookings.pipelineDwellTime.sort((a, b) => b.avgDays - a.avgDays).map((row) => (
                              <TableRow key={row.stage}>
                                <TableCell className="font-medium">{STAGE_LABELS[row.stage] ?? row.stage}</TableCell>
                                <TableCell className="text-right">
                                  <span className={`font-semibold ${row.avgDays > 14 ? "text-rose-600" : row.avgDays > 7 ? "text-amber-600" : "text-emerald-600"}`}>
                                    {row.avgDays}d
                                  </span>
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">{row.bookingCount}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <p className="text-xs text-muted-foreground mt-3">Avg time from entering a stage to moving to the next. Red = &gt;14 days, Amber = &gt;7 days.</p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ── FINANCIALS TAB ── */}
                <TabsContent value="financials" className="space-y-6">
                  <SectionHeader title="Financials" icon={PoundSterling} />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="JLT Revenue (Remittance)" value={fmtGbp(data.financials.jltRevenueThisWeek)} icon={PoundSterling} accent="green"
                      wow={{ current: data.financials.jltRevenueThisWeek, prev: data.financials.jltRevenuePrevWeek }} sub="20% JLT share from PTS" />
                    <StatCard title="Agent Payouts" value={fmtGbp(data.financials.agentPayoutsThisWeek)} icon={PoundSterling} accent="blue" sub="80% agent share from PTS remittance" />
                    <StatCard title="Commission Claims (New)" value={fmt(data.financials.commissionClaimsThisWeek)}
                      sub={`${fmtGbp(data.financials.commissionClaimsGrossThisWeek)} gross`} link="/commissions" />
                    <StatCard title="Commissions Paid" value={fmt(data.financials.commissionClaimsPaidThisWeek)} icon={CheckCircle2} accent="green"
                      sub={`${fmtGbp(data.financials.commissionClaimsPaidGrossThisWeek)} from expected commission`} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="Reimbursements Paid" value={fmt(data.financials.reimbursementsPaidThisWeek)} icon={CheckCircle2} accent="green"
                      sub={`${fmtGbp(data.financials.reimbursementsPaidTotalThisWeek)} total`} />
                    <StatCard title="Reimbursements Scheduled" value={fmt(data.financials.reimbursementsScheduledCount)} icon={Clock}
                      accent={data.financials.reimbursementsScheduledCount > 0 ? "blue" : undefined}
                      sub={`${fmtGbp(data.financials.reimbursementsScheduledTotal)} scheduled`}
                      onClick={() => setDrillDown("reimbursements")} />
                    <StatCard title="Reimbursements Pending" value={fmt(data.financials.reimbursementsPendingCount)} icon={Clock}
                      accent={data.financials.reimbursementsPendingCount > 0 ? "amber" : undefined}
                      sub={`${fmtGbp(data.financials.reimbursementsPendingTotal)} outstanding`}
                      onClick={() => setDrillDown("reimbursements")} />
                  </div>
                </TabsContent>

                {/* ── RECRUITMENT TAB ── */}
                <TabsContent value="recruitment" className="space-y-6">
                  <SectionHeader title="Recruitment Pipeline" icon={UserPlus} />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="New Prospects" value={fmt(data.recruitment.newProspectsThisWeek)} icon={UserPlus} accent="blue"
                      wow={{ current: data.recruitment.newProspectsThisWeek, prev: data.recruitment.newProspectsPrevWeek }} />
                    <StatCard title="Won This Week" value={fmt(data.recruitment.wonProspectsThisWeek)} icon={CheckCircle2} accent="green" sub="Converted to agents" />
                    <StatCard title="Stage Moves" value={fmt(data.recruitment.stageMovesThisWeek)} sub="Prospects moved through funnel" />
                  </div>
                  {data.recruitment.funnel.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold flex items-center justify-between">
                          Current Recruitment Funnel
                          <Link href="/crm/recruitment">
                            <Button variant="ghost" size="sm" className="text-xs h-7">View Pipeline <ArrowRight size={12} className="ml-1" /></Button>
                          </Link>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {data.recruitment.funnel.sort((a, b) => b.count - a.count).map((s) => {
                            const total = data.recruitment.funnel.reduce((acc, r) => acc + r.count, 0);
                            const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                            return (
                              <div key={s.stage} className="flex items-center gap-3">
                                <div className="w-44 text-sm font-medium truncate">{RECRUITMENT_STAGE_LABELS[s.stage] ?? s.stage}</div>
                                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                                  <div className="h-full bg-[#70FFE8] rounded-full transition-all" style={{ width: `${pct}%` }} />
                                </div>
                                <div className="text-sm font-semibold w-16 text-right">
                                  {s.count} <span className="text-muted-foreground font-normal text-xs">({pct}%)</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ── STAFF TAB ── */}
                <TabsContent value="staff" className="space-y-6">
                  <SectionHeader title="Staff Productivity" icon={Activity} />
                  <p className="text-sm text-muted-foreground -mt-2">Actions recorded for each team member during the selected week.</p>
                  {data.staffProductivity.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-sm">No staff activity recorded for this week.</div>
                  ) : (
                    <Card>
                      <CardContent className="p-0 overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Team Member</TableHead>
                              <TableHead className="text-right">Pipeline Moves</TableHead>
                              <TableHead className="text-right">Tasks Done</TableHead>
                              <TableHead className="text-right">Tasks Created</TableHead>
                              <TableHead className="text-right">Amendments</TableHead>
                              <TableHead className="text-right">Comm. Paid</TableHead>
                              <TableHead className="text-right">Reimb. Paid</TableHead>
                              <TableHead className="text-right">Reimb. Sched.</TableHead>
                              <TableHead className="text-right">Status Changes</TableHead>
                              <TableHead className="text-right">Notes Written</TableHead>
                              <TableHead className="text-right">Recruitment</TableHead>
                              <TableHead className="text-right font-semibold bg-muted/50">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.staffProductivity.map((s: any, idx: number) => (
                              <TableRow key={s.adminId} className={idx === 0 ? "bg-[#70FFE8]/5" : ""}>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    {idx === 0 && <span className="text-[10px] font-bold text-[#1a8a78] bg-[#70FFE8]/20 px-1.5 py-0.5 rounded">TOP</span>}
                                    {s.adminName}
                                    {s.role === "super_admin" && <Badge variant="secondary" className="text-[10px]">Super</Badge>}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">{s.pipelineMoves || <span className="text-muted-foreground">—</span>}</TableCell>
                                <TableCell className="text-right">{s.tasksCompleted || <span className="text-muted-foreground">—</span>}</TableCell>
                                <TableCell className="text-right">{s.tasksCreated || <span className="text-muted-foreground">—</span>}</TableCell>
                                <TableCell className="text-right">{s.amendmentsActioned || <span className="text-muted-foreground">—</span>}</TableCell>
                                <TableCell className="text-right">
                                  {s.commissionsPaid ? <span title={`£${s.commissionsTotal} gross`}>{s.commissionsPaid}</span> : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-right">
                                  {s.reimbursementsPaid ? <span title={`£${s.reimbursementsTotal} paid`}>{s.reimbursementsPaid}</span> : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-right">{s.reimbursementsScheduled || <span className="text-muted-foreground">—</span>}</TableCell>
                                <TableCell className="text-right">{s.statusChanges || <span className="text-muted-foreground">—</span>}</TableCell>
                                <TableCell className="text-right">{s.bookingNotes || <span className="text-muted-foreground">—</span>}</TableCell>
                                <TableCell className="text-right">{s.recruitmentMoves || <span className="text-muted-foreground">—</span>}</TableCell>
                                <TableCell className="text-right font-bold text-foreground bg-muted/50">{s.totalActions}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}
                  <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                    <strong>What's counted:</strong> Pipeline moves, tasks completed, tasks created, amendments actioned, commission claims marked paid, reimbursements marked paid, reimbursements scheduled, agent status changes, booking notes/messages written, recruitment stage moves.
                  </div>
                </TabsContent>

                {/* ── COMMUNICATIONS TAB ── */}
                <TabsContent value="comms" className="space-y-6">
                  <SectionHeader title="Communications" icon={Mail} />
                  {data.communications ? (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard title="Emails Sent (Total)" value={fmt(data.communications.emailsSentThisWeek)} icon={Mail} accent="blue"
                          wow={{ current: data.communications.emailsSentThisWeek, prev: data.communications.emailsSentPrevWeek }} />
                        <StatCard title="Campaign Emails" value={fmt(data.communications.campaignEmailsThisWeek)} sub="Via Resend API" />
                        <StatCard title="Campaign Open Rate" value={`${data.communications.campaignOpenRate}%`}
                          accent={data.communications.campaignOpenRate >= 30 ? "green" : data.communications.campaignOpenRate >= 15 ? "amber" : "red"} />
                        <StatCard title="Campaign Bounce Rate" value={`${data.communications.campaignBounceRate}%`}
                          accent={data.communications.campaignBounceRate > 5 ? "red" : undefined} />
                      </div>
                      {data.communications.campaignsSentThisWeek.length > 0 && (
                        <Card>
                          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Campaigns Sent This Week</CardTitle></CardHeader>
                          <CardContent>
                            <Table>
                              <TableHeader><TableRow>
                                <TableHead>Campaign Name</TableHead><TableHead>Audience</TableHead>
                                <TableHead className="text-right">Recipients</TableHead><TableHead>Sent By</TableHead><TableHead>Sent At</TableHead>
                              </TableRow></TableHeader>
                              <TableBody>
                                {data.communications.campaignsSentThisWeek.map((c: any) => (
                                  <TableRow key={c.id}>
                                    <TableCell className="font-medium">{c.name}</TableCell>
                                    <TableCell><Badge variant="outline" className="capitalize">{c.audienceType}</Badge></TableCell>
                                    <TableCell className="text-right">{c.totalRecipients ?? "—"}</TableCell>
                                    <TableCell>{c.sentByName ?? "—"}</TableCell>
                                    <TableCell className="text-muted-foreground text-xs">
                                      {c.sentAt ? new Date(c.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </CardContent>
                        </Card>
                      )}
                      {data.communications.emailTypeBreakdown.length > 0 && (
                        <Card>
                          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Email Volume by Type</CardTitle></CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              {data.communications.emailTypeBreakdown.map((e: any) => {
                                const maxCount = Math.max(...data.communications!.emailTypeBreakdown.map((x: any) => x.count));
                                const pct = maxCount > 0 ? Math.round((e.count / maxCount) * 100) : 0;
                                return (
                                  <div key={e.triggerKey} className="flex items-center gap-3">
                                    <div className="w-48 text-xs font-mono text-muted-foreground truncate">{e.triggerKey}</div>
                                    <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                                      <div className="h-full bg-[#70FFE8] rounded-full" style={{ width: `${pct}%` }} />
                                    </div>
                                    <div className="text-sm font-semibold w-10 text-right">{e.count}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">No communications data available.</div>
                  )}
                </TabsContent>

                {/* ── MARGINS TAB ── */}
                <TabsContent value="margin">
                  <CommissionMarginTab />
                </TabsContent>
              </Tabs>

              {/* Drill-down dialog */}
              <DrillDownDialog type={drillDown} weekStart={weekStartStr} onClose={() => setDrillDown(null)} />
            </>
          )}
        </>
      )}
    </div>
  );
}
