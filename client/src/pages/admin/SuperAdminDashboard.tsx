import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import {
  ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus,
  Users, CreditCard, BookOpen, PoundSterling, UserPlus, BarChart2, Mail,
  AlertCircle, CheckCircle2, Clock, ArrowRight, Activity
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

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

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtGbp(n: number): string {
  return `£${fmt(n)}`;
}

function wow(current: number, prev: number): { pct: number; dir: "up" | "down" | "flat" } {
  if (prev === 0) return { pct: 0, dir: "flat" };
  const pct = Math.round(((current - prev) / prev) * 100);
  return { pct: Math.abs(pct), dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WoWBadge({ current, prev, invert = false }: { current: number; prev: number; invert?: boolean }) {
  const { pct, dir } = wow(current, prev);
  if (dir === "flat") return <span className="text-xs text-muted-foreground">—</span>;
  const isGood = invert ? dir === "down" : dir === "up";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isGood ? "text-emerald-600" : "text-rose-600"}`}>
      {dir === "up" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {pct}% WoW
    </span>
  );
}

function StatCard({
  title, value, sub, icon: Icon, wow: wowProps, accent, link,
}: {
  title: string;
  value: string | number;
  sub?: React.ReactNode;
  icon?: React.ElementType;
  wow?: { current: number; prev: number; invert?: boolean };
  accent?: "green" | "red" | "amber" | "blue" | "purple";
  link?: string;
}) {
  const accentClasses: Record<string, string> = {
    green: "border-l-emerald-500",
    red: "border-l-rose-500",
    amber: "border-l-amber-500",
    blue: "border-l-blue-500",
    purple: "border-l-purple-500",
  };
  const content = (
    <Card className={`border-l-4 ${accent ? accentClasses[accent] : "border-l-transparent"} hover:shadow-md transition-shadow`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide truncate">{title}</p>
            <p className="text-2xl font-bold mt-1 text-foreground">{value}</p>
            {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
            {wowProps && (
              <div className="mt-1">
                <WoWBadge current={wowProps.current} prev={wowProps.prev} invert={wowProps.invert} />
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

// ─── Stage label map ──────────────────────────────────────────────────────────
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SuperAdminDashboard() {
  const { user } = useAuth();

  const [currentMonday, setCurrentMonday] = useState(() => getMondayOfWeek(new Date()));
  const weekStartStr = useMemo(() => toISODate(currentMonday), [currentMonday]);

  const isCurrentWeek = useMemo(() => {
    const thisMonday = getMondayOfWeek(new Date());
    return currentMonday.getTime() === thisMonday.getTime();
  }, [currentMonday]);

  const { data, isLoading, error } = trpc.superAdmin.weeklyStats.useQuery(
    { weekStart: weekStartStr },
    { staleTime: 60_000 }
  );

  function prevWeek() {
    setCurrentMonday((d) => {
      const n = new Date(d);
      n.setDate(d.getDate() - 7);
      return n;
    });
  }

  function nextWeek() {
    if (isCurrentWeek) return;
    setCurrentMonday((d) => {
      const n = new Date(d);
      n.setDate(d.getDate() + 7);
      return n;
    });
  }

  if (user?.role !== "super_admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-3 text-rose-500" size={40} />
          <h2 className="text-lg font-semibold">Access Restricted</h2>
          <p className="text-muted-foreground text-sm mt-1">This dashboard is only available to Super Admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity size={24} className="text-[#1a8a78]" />
            Business Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Weekly performance overview across all business areas</p>
        </div>

        {/* Week selector */}
        <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevWeek}>
            <ChevronLeft size={16} />
          </Button>
          <div className="text-sm font-medium min-w-[180px] text-center">
            {formatWeekLabel(currentMonday)}
            {isCurrentWeek && (
              <Badge variant="secondary" className="ml-2 text-[10px] py-0">This week</Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextWeek} disabled={isCurrentWeek}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {isLoading && <LoadingSkeleton />}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700 text-sm">
          Failed to load dashboard data. Please try again.
        </div>
      )}

      {data && (
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="membership">Membership</TabsTrigger>
            <TabsTrigger value="dd">DD Revenue</TabsTrigger>
            <TabsTrigger value="bookings">Bookings</TabsTrigger>
            <TabsTrigger value="financials">Financials</TabsTrigger>
            <TabsTrigger value="recruitment">Recruitment</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="comms">Communications</TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW TAB ── */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="Active Agents"
                value={fmt(data.membership.totalActiveAgents)}
                icon={Users}
                accent="green"
                sub={`+${data.membership.newSignupsThisWeek} new · -${data.membership.cancellationsThisWeek} left`}
              />
              <StatCard
                title="DD Collected"
                value={fmtGbp(data.ddRevenue.collectedThisWeekGbp)}
                icon={CreditCard}
                accent="blue"
                wow={{ current: data.ddRevenue.collectedThisWeekGbp, prev: data.ddRevenue.collectedPrevWeekGbp }}
                sub={`${data.ddRevenue.paymentsConfirmedThisWeek} payments`}
              />
              <StatCard
                title="New Bookings"
                value={fmt(data.bookings.newBookingsThisWeek)}
                icon={BookOpen}
                accent="purple"
                wow={{ current: data.bookings.newBookingsThisWeek, prev: data.bookings.newBookingsPrevWeek }}
              />
              <StatCard
                title="JLT Revenue"
                value={fmtGbp(data.financials.jltRevenueThisWeek)}
                icon={PoundSterling}
                accent="amber"
                wow={{ current: data.financials.jltRevenueThisWeek, prev: data.financials.jltRevenuePrevWeek }}
                sub="From remittances"
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="New Prospects"
                value={fmt(data.recruitment.newProspectsThisWeek)}
                icon={UserPlus}
                wow={{ current: data.recruitment.newProspectsThisWeek, prev: data.recruitment.newProspectsPrevWeek }}
                sub={`${data.recruitment.wonProspectsThisWeek} won this week`}
              />
              <StatCard
                title="Failed DD Payments"
                value={fmt(data.ddRevenue.failedPaymentsThisWeek)}
                icon={AlertCircle}
                accent={data.ddRevenue.failedPaymentsThisWeek > 0 ? "red" : undefined}
                sub={data.ddRevenue.failedPaymentsThisWeek > 0 ? `${data.ddRevenue.agentsWithConsecutiveFailures} agents with consecutive failures` : "All clear"}
              />
              <StatCard
                title="Emails Sent"
                value={fmt(data.communications?.emailsSentThisWeek ?? 0)}
                icon={Mail}
                wow={{ current: data.communications?.emailsSentThisWeek ?? 0, prev: data.communications?.emailsSentPrevWeek ?? 0 }}
              />
              <StatCard
                title="Pipeline Moves"
                value={fmt(data.bookings.pipelineMovesThisWeek)}
                icon={BarChart2}
                sub={`${data.bookings.amendmentsThisWeek} amendments · ${data.bookings.refundsThisWeek} refunds`}
              />
            </div>

            {/* Staff summary */}
            {data.staffProductivity.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity size={15} />
                    Staff Activity This Week
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Team Member</TableHead>
                        <TableHead className="text-right">Pipeline Moves</TableHead>
                        <TableHead className="text-right">Tasks Done</TableHead>
                        <TableHead className="text-right">Commissions Paid</TableHead>
                        <TableHead className="text-right">Reimbursements</TableHead>
                        <TableHead className="text-right">Status Changes</TableHead>
                        <TableHead className="text-right">CRM Notes</TableHead>
                        <TableHead className="text-right">Recruitment</TableHead>
                        <TableHead className="text-right font-semibold">Total Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.staffProductivity.map((s: any) => (
                        <TableRow key={s.adminId}>
                          <TableCell className="font-medium">
                            {s.adminName}
                            {s.adminRole === "super_admin" && (
                              <Badge variant="secondary" className="ml-2 text-[10px]">Super</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{s.pipelineMoves || "—"}</TableCell>
                          <TableCell className="text-right">{s.tasksCompleted || "—"}</TableCell>
                          <TableCell className="text-right">{s.commissionsPaid || "—"}</TableCell>
                          <TableCell className="text-right">{s.reimbursementsPaid || "—"}</TableCell>
                          <TableCell className="text-right">{s.statusChanges || "—"}</TableCell>
                          <TableCell className="text-right">{s.crmNotes || "—"}</TableCell>
                          <TableCell className="text-right">{s.recruitmentMoves || "—"}</TableCell>
                          <TableCell className="text-right font-bold text-foreground">
                            {s.totalActions}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── MEMBERSHIP TAB ── */}
          <TabsContent value="membership" className="space-y-6">
            <SectionHeader title="Membership & Retention" icon={Users} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="Total Active Agents"
                value={fmt(data.membership.totalActiveAgents)}
                icon={Users}
                accent="green"
              />
              <StatCard
                title="New Sign-Ups"
                value={fmt(data.membership.newSignupsThisWeek)}
                icon={UserPlus}
                accent="green"
                wow={{ current: data.membership.newSignupsThisWeek, prev: data.membership.newSignupsPrevWeek }}
              />
              <StatCard
                title="Cancellations / In Notice"
                value={fmt(data.membership.cancellationsThisWeek)}
                icon={TrendingDown}
                accent={data.membership.cancellationsThisWeek > 0 ? "red" : undefined}
                wow={{ current: data.membership.cancellationsThisWeek, prev: data.membership.cancellationsPrevWeek, invert: true }}
              />
              <StatCard
                title="Net Growth"
                value={`${data.membership.netGrowthThisWeek >= 0 ? "+" : ""}${fmt(data.membership.netGrowthThisWeek)}`}
                accent={data.membership.netGrowthThisWeek >= 0 ? "green" : "red"}
                sub="New minus cancellations"
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatCard
                title="In Notice Period"
                value={fmt(data.membership.inNoticeCount)}
                accent={data.membership.inNoticeCount > 0 ? "amber" : undefined}
                sub="Agents serving notice"
                link="/crm/agents"
              />
              <StatCard
                title="Paused Agents"
                value={fmt(data.membership.pausedCount)}
                accent={data.membership.pausedCount > 0 ? "amber" : undefined}
                sub="Temporarily paused"
                link="/crm/agents"
              />
            </div>

            {/* Tier breakdown */}
            {data.membership.tierBreakdown.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Active Agents by Membership Tier</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.membership.tierBreakdown
                      .sort((a, b) => b.count - a.count)
                      .map((tier) => {
                        const pct = data.membership.totalActiveAgents > 0
                          ? Math.round((tier.count / data.membership.totalActiveAgents) * 100)
                          : 0;
                        return (
                          <div key={tier.tier} className="flex items-center gap-3">
                            <div className="w-32 text-sm font-medium truncate">{tier.tier || "Unknown"}</div>
                            <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                              <div
                                className="h-full bg-[#70FFE8] rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
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

          {/* ── DD REVENUE TAB ── */}
          <TabsContent value="dd" className="space-y-6">
            <SectionHeader title="Direct Debit Revenue (GoCardless)" icon={CreditCard} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="Active Subscriptions"
                value={fmt(data.ddRevenue.activeSubscriptions)}
                icon={CheckCircle2}
                accent="green"
              />
              <StatCard
                title="Monthly Recurring Revenue"
                value={fmtGbp(data.ddRevenue.mrrGbp)}
                icon={PoundSterling}
                accent="blue"
                sub="Based on active subscriptions"
              />
              <StatCard
                title="Collected This Week"
                value={fmtGbp(data.ddRevenue.collectedThisWeekGbp)}
                icon={CreditCard}
                accent="green"
                wow={{ current: data.ddRevenue.collectedThisWeekGbp, prev: data.ddRevenue.collectedPrevWeekGbp }}
                sub={`${data.ddRevenue.paymentsConfirmedThisWeek} payments confirmed`}
              />
              <StatCard
                title="Failed Payments"
                value={fmt(data.ddRevenue.failedPaymentsThisWeek)}
                icon={AlertCircle}
                accent={data.ddRevenue.failedPaymentsThisWeek > 0 ? "red" : undefined}
                sub={`${fmtGbp(data.ddRevenue.failedAmountGbp)} at risk`}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="New Mandates"
                value={fmt(data.ddRevenue.newMandatesThisWeek)}
                icon={UserPlus}
                accent="green"
              />
              <StatCard
                title="Cancelled Mandates"
                value={fmt(data.ddRevenue.cancelledMandatesThisWeek)}
                accent={data.ddRevenue.cancelledMandatesThisWeek > 0 ? "red" : undefined}
              />
              <StatCard
                title="Agents w/ Consecutive Failures"
                value={fmt(data.ddRevenue.agentsWithConsecutiveFailures)}
                icon={AlertCircle}
                accent={data.ddRevenue.agentsWithConsecutiveFailures > 0 ? "amber" : undefined}
                link="/crm/memberships"
              />
            </div>
          </TabsContent>

          {/* ── BOOKINGS TAB ── */}
          <TabsContent value="bookings" className="space-y-6">
            <SectionHeader title="Bookings & Pipeline" icon={BookOpen} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="New Bookings"
                value={fmt(data.bookings.newBookingsThisWeek)}
                icon={BookOpen}
                accent="blue"
                wow={{ current: data.bookings.newBookingsThisWeek, prev: data.bookings.newBookingsPrevWeek }}
              />
              <StatCard
                title="Pipeline Moves"
                value={fmt(data.bookings.pipelineMovesThisWeek)}
                icon={ArrowRight}
                sub="Bookings moved between stages"
              />
              <StatCard
                title="Amendments"
                value={fmt(data.bookings.amendmentsThisWeek)}
                link="/admin/amendments"
              />
              <StatCard
                title="Refunds"
                value={fmt(data.bookings.refundsThisWeek)}
                accent={data.bookings.refundsThisWeek > 0 ? "amber" : undefined}
                link="/admin/refunds"
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatCard
                title="Flight Requests (New)"
                value={fmt(data.bookings.flightRequestsThisWeek)}
              />
              <StatCard
                title="Flight Requests (Pending)"
                value={fmt(data.bookings.flightRequestsPending)}
                accent={data.bookings.flightRequestsPending > 0 ? "amber" : undefined}
                link="/admin/flight-requests"
              />
            </div>

            {/* Pipeline stage distribution */}
            {data.bookings.pipelineStageDistribution.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Current Pipeline Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.bookings.pipelineStageDistribution.map((s) => {
                      const total = data.bookings.pipelineStageDistribution.reduce((a, b) => a + b.count, 0);
                      const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                      const stageColors: Record<string, string> = {
                        "New Booking": "bg-blue-400",
                        "Added to PTS": "bg-emerald-400",
                        "Commission Claimable": "bg-amber-400",
                        "Commission Claimed": "bg-purple-400",
                        "Urgent": "bg-rose-500",
                        "Query": "bg-orange-400",
                        "Cancelled": "bg-gray-400",
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
          </TabsContent>

          {/* ── FINANCIALS TAB ── */}
          <TabsContent value="financials" className="space-y-6">
            <SectionHeader title="Financials" icon={PoundSterling} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="JLT Revenue (Remittance)"
                value={fmtGbp(data.financials.jltRevenueThisWeek)}
                icon={PoundSterling}
                accent="green"
                wow={{ current: data.financials.jltRevenueThisWeek, prev: data.financials.jltRevenuePrevWeek }}
                sub="20% JLT share from PTS"
              />
              <StatCard
                title="Agent Payouts"
                value={fmtGbp(data.financials.agentPayoutsThisWeek)}
                icon={PoundSterling}
                accent="blue"
                sub="80% agent share paid out"
              />
              <StatCard
                title="Commission Claims (New)"
                value={fmt(data.financials.commissionClaimsThisWeek)}
                sub={`${fmtGbp(data.financials.commissionClaimsGrossThisWeek)} gross`}
                link="/commissions"
              />
              <StatCard
                title="Commissions Paid"
                value={fmt(data.financials.commissionClaimsPaidThisWeek)}
                icon={CheckCircle2}
                accent="green"
                sub={`${fmtGbp(data.financials.commissionClaimsPaidGrossThisWeek)} paid out`}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="Reimbursements Paid"
                value={fmt(data.financials.reimbursementsPaidThisWeek)}
                icon={CheckCircle2}
                accent="green"
                sub={`${fmtGbp(data.financials.reimbursementsPaidTotalThisWeek)} total`}
              />
              <StatCard
                title="Reimbursements Pending"
                value={fmt(data.financials.reimbursementsPendingCount)}
                icon={Clock}
                accent={data.financials.reimbursementsPendingCount > 0 ? "amber" : undefined}
                sub={`${fmtGbp(data.financials.reimbursementsPendingTotal)} outstanding`}
                link="/admin/reimbursements"
              />
            </div>
          </TabsContent>

          {/* ── RECRUITMENT TAB ── */}
          <TabsContent value="recruitment" className="space-y-6">
            <SectionHeader title="Recruitment Pipeline" icon={UserPlus} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="New Prospects"
                value={fmt(data.recruitment.newProspectsThisWeek)}
                icon={UserPlus}
                accent="blue"
                wow={{ current: data.recruitment.newProspectsThisWeek, prev: data.recruitment.newProspectsPrevWeek }}
              />
              <StatCard
                title="Won This Week"
                value={fmt(data.recruitment.wonProspectsThisWeek)}
                icon={CheckCircle2}
                accent="green"
                sub="Converted to agents"
              />
              <StatCard
                title="Stage Moves"
                value={fmt(data.recruitment.stageMovesThisWeek)}
                sub="Prospects moved through funnel"
              />
            </div>

            {/* Funnel */}
            {data.recruitment.funnel.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    Current Recruitment Funnel
                    <Link href="/crm/recruitment">
                      <Button variant="ghost" size="sm" className="text-xs h-7">
                        View Pipeline <ArrowRight size={12} className="ml-1" />
                      </Button>
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.recruitment.funnel
                      .sort((a, b) => b.count - a.count)
                      .map((s) => {
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
            <p className="text-sm text-muted-foreground -mt-2">
              Actions recorded for each team member during the selected week.
            </p>

            {data.staffProductivity.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No staff activity recorded for this week.</div>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Team Member</TableHead>
                        <TableHead className="text-right">Pipeline Moves</TableHead>
                        <TableHead className="text-right">Tasks Done</TableHead>
                        <TableHead className="text-right">Tasks Created</TableHead>
                        <TableHead className="text-right">Commissions Paid</TableHead>
                        <TableHead className="text-right">Reimb. Paid</TableHead>
                        <TableHead className="text-right">Status Changes</TableHead>
                        <TableHead className="text-right">CRM Notes</TableHead>
                        <TableHead className="text-right">Recruitment</TableHead>
                        <TableHead className="text-right font-semibold bg-muted/50">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.staffProductivity.map((s: any, idx: number) => (
                        <TableRow key={s.adminId} className={idx === 0 ? "bg-[#70FFE8]/5" : ""}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {idx === 0 && <span className="text-[10px] font-bold text-[#1a8a78] bg-[#70FFE8]/20 px-1.5 py-0.5 rounded">TOP</span>}
                              {s.adminName}
                              {s.adminRole === "super_admin" && (
                                <Badge variant="secondary" className="text-[10px]">Super</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{s.pipelineMoves || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-right">{s.tasksCompleted || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-right">{s.tasksCreated || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-right">
                            {s.commissionsPaid ? (
                              <span title={`£${s.commissionsTotal} gross`}>{s.commissionsPaid}</span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {s.reimbursementsPaid ? (
                              <span title={`£${s.reimbursementsTotal}`}>{s.reimbursementsPaid}</span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right">{s.statusChanges || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-right">{s.crmNotes || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-right">{s.recruitmentMoves || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-right font-bold text-foreground bg-muted/50">
                            {s.totalActions}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <strong>What's counted:</strong> Pipeline moves (booking stage changes), tasks completed, tasks created, commission claims marked paid, reimbursements marked paid, agent status changes (activations, cancellations, pauses), CRM notes written, recruitment stage moves.
            </div>
          </TabsContent>

          {/* ── COMMUNICATIONS TAB ── */}
          <TabsContent value="comms" className="space-y-6">
            <SectionHeader title="Communications" icon={Mail} />
            {data.communications ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    title="Emails Sent (Total)"
                    value={fmt(data.communications.emailsSentThisWeek)}
                    icon={Mail}
                    accent="blue"
                    wow={{ current: data.communications.emailsSentThisWeek, prev: data.communications.emailsSentPrevWeek }}
                  />
                  <StatCard
                    title="Campaign Emails"
                    value={fmt(data.communications.campaignEmailsThisWeek)}
                    sub="Via Resend API"
                  />
                  <StatCard
                    title="Campaign Open Rate"
                    value={`${data.communications.campaignOpenRate}%`}
                    accent={data.communications.campaignOpenRate >= 30 ? "green" : data.communications.campaignOpenRate >= 15 ? "amber" : "red"}
                  />
                  <StatCard
                    title="Campaign Bounce Rate"
                    value={`${data.communications.campaignBounceRate}%`}
                    accent={data.communications.campaignBounceRate > 5 ? "red" : undefined}
                  />
                </div>

                {/* Campaigns sent this week */}
                {data.communications.campaignsSentThisWeek.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold">Campaigns Sent This Week</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Campaign Name</TableHead>
                            <TableHead>Audience</TableHead>
                            <TableHead className="text-right">Recipients</TableHead>
                            <TableHead>Sent By</TableHead>
                            <TableHead>Sent At</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.communications.campaignsSentThisWeek.map((c: any) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-medium">{c.name}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize">{c.audienceType}</Badge>
                              </TableCell>
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

                {/* Email type breakdown */}
                {data.communications.emailTypeBreakdown.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold">Email Volume by Type</CardTitle>
                    </CardHeader>
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
        </Tabs>
      )}
    </div>
  );
}
