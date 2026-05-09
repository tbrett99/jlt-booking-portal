import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  BookOpen, Users, FileText, TrendingUp, Bell, ArrowRight,
  AlertTriangle, Sparkles, AlertCircle, Calendar, Clock,
  CheckCircle2, Banknote, RefreshCw, ChevronRight, Upload, BellOff,
  XCircle, ChevronDown, ChevronUp, PoundSterling, ClipboardList,
  Flame, TriangleAlert, Plane, UserPlus
} from "lucide-react";
import { format, differenceInDays, addDays } from "date-fns";

const STAGE_COLORS: Record<string, string> = {
  "New Booking": "#3b82f6",
  "Creating own PTS file": "#6366f1",
  "Not on Topdog": "#f59e0b",
  "Query": "#eab308",
  "Reimb Docs Missing": "#ef4444",
  "Urgent/Reimb": "#dc2626",
  "T/O Package": "#a855f7",
  "DP": "#d946ef",
  "Added to PTS": "#10b981",
  "Commission Claimable": "#02E6D2",
  "Commission Claimed": "#059669",
  "Cancelled": "#9ca3af",
  "Holding Accounts": "#d97706",
};

const STAGE_ORDER = [
  "New Booking", "Creating own PTS file", "Not on Topdog", "Query",
  "Reimb Docs Missing", "Urgent/Reimb", "T/O Package", "DP",
  "Added to PTS", "Commission Claimable", "Commission Claimed",
  "Cancelled", "Holding Accounts",
];

const URGENT_STAGES = new Set(["Reimb Docs Missing", "Urgent/Reimb", "Query"]);

function RefRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return <span className="text-[10px] text-muted-foreground">{label}: <span className="font-medium">{value}</span></span>;
}

// ── Urgency Action Card ────────────────────────────────────────────────────────
function UrgencyCard({
  title, count, color, bg, borderColor, icon: Icon, href, linkLabel, children, emptyText, priority,
}: {
  title: string; count: number; color: string; bg: string; borderColor: string;
  icon: React.ElementType; href: string; linkLabel: string;
  children: React.ReactNode; emptyText: string;
  priority: "critical" | "high" | "normal";
}) {
  const [open, setOpen] = useState(count > 0);
  const priorityRing = priority === "critical" && count > 0
    ? "ring-2 ring-red-400 ring-offset-1"
    : priority === "high" && count > 0
      ? "ring-1 ring-amber-300 ring-offset-1"
      : "";

  return (
    <Card className={`border-l-4 ${priorityRing}`} style={{ borderLeftColor: borderColor }}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <button
            className="flex items-center gap-2 text-left flex-1 min-w-0"
            onClick={() => setOpen((o) => !o)}
          >
            <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: count > 0 ? borderColor + '22' : '#f3f4f6' }}>
              <Icon size={13} style={{ color: count > 0 ? borderColor : '#9ca3af' }} />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <CardTitle className="text-sm font-semibold truncate">{title}</CardTitle>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold flex-shrink-0 ${count > 0 ? "animate-none" : ""}`}
                style={{ background: count > 0 ? bg : '#f3f4f6', color: count > 0 ? color : '#9ca3af' }}>
                {count}
              </span>
            </div>
            {open ? <ChevronUp size={12} className="text-muted-foreground ml-auto flex-shrink-0" /> : <ChevronDown size={12} className="text-muted-foreground ml-auto flex-shrink-0" />}
          </button>
          <Link href={href}>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 flex-shrink-0" style={{ color }}>
              {linkLabel} <ArrowRight size={11} />
            </Button>
          </Link>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-3">
          {count === 0 ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <CheckCircle2 size={13} className="text-emerald-400" /> {emptyText}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {children}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function AdminDashboard() {
  // ── Optimised single stats query (replaces bookings.all + recruitmentStageCounts + reimbStats) ──
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery();
  // staleTime: 2 min — avoids re-fetching on every navigation since PortalLayout
  // now uses dashboard.urgentCounts for the badge counts.
  const { data: amendments = [] } = trpc.amendments.all.useQuery(undefined, { staleTime: 120000 });
  const { data: refunds = [] } = trpc.refunds.all.useQuery(undefined, { staleTime: 120000 });
  const { data: cancellations = [] } = trpc.cancellations.all.useQuery();
  const { data: notifications = [] } = trpc.notifications.myNotifications.useQuery();
  const { data: claims = [] } = trpc.commissionClaims.all.useQuery();
  const utils = trpc.useUtils();
  const { data: notifSettings } = trpc.settings.getNotificationsPaused.useQuery();
  const { data: allReimbs = [] } = trpc.reimbursements.list.useQuery({});
  const { data: adminUsersForAssign = [] } = trpc.reimbursements.listAdminsForAssign.useQuery();
  const { data: commissionDueList = [] } = trpc.commissionDue.list.useQuery();
  const { data: pendingFlightCount = 0 } = trpc.flightRequests.pendingCount.useQuery();
  const newApplicationsCount = stats?.stageBreakdown?.["application_received"] ?? 0;
  const assignReimb = trpc.reimbursements.assign.useMutation({ onSuccess: () => utils.reimbursements.list.invalidate() });
  const scheduleReimb = trpc.reimbursements.updateStatus.useMutation({ onSuccess: () => utils.reimbursements.list.invalidate() });
  const notificationsPaused = notifSettings?.paused ?? false;
  const setNotifPaused = trpc.settings.setNotificationsPaused.useMutation({
    onSuccess: () => utils.settings.getNotificationsPaused.invalidate(),
  });
  const [cancelConfirmId, setCancelConfirmId] = useState<number | null>(null);
  const markCancellationActioned = trpc.cancellations.markActioned.useMutation({
    onSuccess: () => {
      utils.cancellations.all.invalidate();
      utils.bookings.all.invalidate();
      setCancelConfirmId(null);
    },
  });

  // ── Derived data (from stats query + local filters on smaller datasets) ────
  const now = new Date();

  // From stats (server-computed, no large arrays in browser)
  const urgentBookings: any[] = stats?.urgentBookings ?? [];
  const upcomingDepartures: any[] = stats?.upcomingDepartures ?? [];
  const recentBookings: any[] = stats?.recentBookings ?? [];
  const missingPaymentDate: any[] = stats?.missingPaymentDateBookings ?? [];
  const commissionClaimableMissingDate: any[] = stats?.commissionClaimableMissingDateBookings ?? [];
  const lowMarginBookings: any[] = stats?.lowMarginBookings ?? [];
  const stageCount: Record<string, number> = stats?.stageBreakdown ?? {};

  // Local filters on smaller datasets (amendments, refunds, cancellations, reimbursements)
  const pendingAmendments = (amendments as any[]).filter(
    (a) => a.pipelineStage !== "Actioned" && !a.isReimbursementDoc
  );
  const newAmendments = (amendments as any[]).filter(
    (a) => a.pipelineStage === "To Do" && !a.isReimbursementDoc
  );
  const reimbAmendments = (amendments as any[]).filter(
    (a) => a.pipelineStage !== "Actioned" && a.isReimbursementDoc
  );
  const pendingRefunds = (refunds as any[]).filter(
    (r) => r.pipelineStage !== "Refund Processed"
  );
  const newRefunds = (refunds as any[]).filter(
    (r) => r.pipelineStage === "New Refund Request"
  );
  const pendingCancellations = (cancellations as any[]).filter((c) => c.status !== "actioned");
  const unreadNotifs = notifications.filter((n) => !n.isRead);
  const pendingClaims = (claims as any[]).filter((c) => c.status === "processing");
  const lateUnactioned = (allReimbs as any[]).filter((r) => r.isLate && !r.actionedAt && r.status !== "scheduled" && r.status !== "paid");
  const outstandingReimbs = (allReimbs as any[]).filter((r) => r.status === "pending");

  // Total critical actions count (for the header badge)
  const criticalCount = urgentBookings.length + lateUnactioned.length + reimbAmendments.length;
  const totalPendingActions = pendingAmendments.length + reimbAmendments.length + pendingRefunds.length + pendingCancellations.length + pendingClaims.length + lateUnactioned.length;

  return (
    <div className="space-y-5 p-1">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">Admin Dashboard</h1>
            {criticalCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold animate-pulse"
                style={{ background: '#fef2f2', color: '#dc2626' }}>
                <Flame size={11} /> {criticalCount} urgent
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-xs mt-0.5">{format(now, "EEEE d MMMM yyyy")}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm" variant="outline"
            className={`gap-1.5 text-xs ${notificationsPaused ? 'border-amber-400 text-amber-700 bg-amber-50' : 'text-muted-foreground'}`}
            onClick={() => setNotifPaused.mutate({ paused: !notificationsPaused })}
            disabled={setNotifPaused.isPending}
            title={notificationsPaused ? 'Notifications are paused — click to resume' : 'Notifications are active — click to pause'}
          >
            <BellOff size={13} />
            {notificationsPaused ? 'Notifs Paused' : 'Notifs Active'}
          </Button>
          {newApplicationsCount > 0 && (
            <Link href="/crm/recruitment?stage=application_received">
              <Button
                size="sm"
                className="gap-1.5 text-xs font-semibold animate-pulse"
                style={{ background: '#02E6D2', color: '#1a1a1a', borderColor: '#02E6D2' }}
                title={`${newApplicationsCount} new agent application${newApplicationsCount > 1 ? 's' : ''} awaiting review`}
              >
                <UserPlus size={13} />
                {newApplicationsCount} New Application{newApplicationsCount > 1 ? 's' : ''}
              </Button>
            </Link>
          )}
          <Link href="/import">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <Upload size={13} /> Import CSV
            </Button>
          </Link>
          <Link href="/pipeline">
            <Button size="sm" className="gap-1.5 text-xs" style={{ background: '#70FFE8', color: '#414141' }}>
              View Pipeline <ArrowRight size={13} />
            </Button>
          </Link>
        </div>
      </div>

      {/* ── SECTION 1: CRITICAL ALERTS (always visible, red/amber) ── */}
      {(urgentBookings.length > 0 || missingPaymentDate.length > 0 || pendingClaims.length > 0 || lateUnactioned.length > 0) && (
        <div className="rounded-xl border-2 border-red-200 bg-red-50/50 p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <TriangleAlert size={15} style={{ color: '#dc2626' }} />
            <h2 className="text-sm font-bold" style={{ color: '#991b1b' }}>Requires Immediate Attention</h2>
          </div>
          {urgentBookings.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 border border-red-200 bg-white">
              <AlertCircle size={14} style={{ color: '#dc2626' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#991b1b' }}>
                  {urgentBookings.length} booking{urgentBookings.length > 1 ? "s" : ""} in urgent stage
                </span>
                <p className="text-[10px] opacity-70 mt-0.5 truncate" style={{ color: '#991b1b' }}>
                  {urgentBookings.slice(0, 4).map((b) => b.clientName).join(", ")}
                  {urgentBookings.length > 4 && ` +${urgentBookings.length - 4} more`}
                </p>
              </div>
              <Link href="/pipeline"><Button size="sm" variant="ghost" className="text-xs text-red-700 h-7 px-2 flex-shrink-0">View</Button></Link>
            </div>
          )}
          {lateUnactioned.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 border border-red-200 bg-white">
              <PoundSterling size={14} style={{ color: '#dc2626' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#991b1b' }}>
                  {lateUnactioned.length} late reimbursement request{lateUnactioned.length > 1 ? "s" : ""} unactioned
                </span>
              </div>
              <Link href="/admin/reimbursements"><Button size="sm" variant="ghost" className="text-xs text-red-700 h-7 px-2 flex-shrink-0">Process</Button></Link>
            </div>
          )}
          {missingPaymentDate.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 border border-amber-200 bg-white">
              <AlertTriangle size={14} style={{ color: '#f59e0b' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#92400e' }}>
                  {missingPaymentDate.length} Added to PTS booking{missingPaymentDate.length > 1 ? "s" : ""} missing Final Supplier Payment Date
                </span>
              </div>
              <Link href="/pts-missing-payment"><Button size="sm" variant="ghost" className="text-xs text-amber-700 h-7 px-2 flex-shrink-0">Review</Button></Link>
            </div>
          )}
          {commissionClaimableMissingDate.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 border border-blue-200 bg-white">
              <AlertTriangle size={14} style={{ color: '#3b82f6' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#1e3a5f' }}>
                  {commissionClaimableMissingDate.length} Commission Claimable booking{commissionClaimableMissingDate.length > 1 ? "s" : ""} missing Final Supplier Payment Date
                </span>
              </div>
              <Link href="/commission-claimable-missing-payment"><Button size="sm" variant="ghost" className="text-xs text-blue-700 h-7 px-2 flex-shrink-0">Review</Button></Link>
            </div>
          )}
          {pendingClaims.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 border border-teal-200 bg-white">
              <Banknote size={14} style={{ color: '#02E6D2' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#065f46' }}>
                  {pendingClaims.length} commission claim{pendingClaims.length > 1 ? "s" : ""} awaiting payment
                </span>
              </div>
              <Link href="/commissions-admin"><Button size="sm" variant="ghost" className="text-xs text-emerald-700 h-7 px-2 flex-shrink-0">Process</Button></Link>
            </div>
          )}
          {(pendingFlightCount as number) > 0 && (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 border border-sky-200 bg-white">
              <Plane size={14} style={{ color: '#0284c7' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#0c4a6e' }}>
                  {pendingFlightCount as number} flight request{(pendingFlightCount as number) > 1 ? 's' : ''} pending
                </span>
              </div>
              <Link href="/flights"><Button size="sm" variant="ghost" className="text-xs text-sky-700 h-7 px-2 flex-shrink-0">Review</Button></Link>
            </div>
          )}
          {lowMarginBookings.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 border border-violet-200 bg-white">
              <TrendingUp size={14} style={{ color: '#7c3aed' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#4c1d95' }}>
                  {lowMarginBookings.length} booking{lowMarginBookings.length > 1 ? 's' : ''} with margin below 5%
                </span>
                <p className="text-[10px] opacity-70 mt-0.5 truncate" style={{ color: '#4c1d95' }}>
                  {lowMarginBookings.slice(0, 3).map((b) => b.clientName).join(', ')}
                  {lowMarginBookings.length > 3 && ` +${lowMarginBookings.length - 3} more`}
                </p>
              </div>
              <Link href="/pipeline"><Button size="sm" variant="ghost" className="text-xs h-7 px-2 flex-shrink-0" style={{ color: '#7c3aed' }}>Review</Button></Link>
            </div>
          )}
        </div>
      )}

      {/* ── SECTION 2: KEY METRICS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {[
          { label: "Active Bookings", value: stats?.activeBookings ?? 0, icon: BookOpen, href: "/pipeline", color: "#70FFE8", textColor: "#414141", urgent: false },
          { label: "To Add to PTS", value: stats?.filesToAddToPts ?? 0, icon: ClipboardList, href: "/pipeline", color: (stats?.filesToAddToPts ?? 0) > 0 ? "#fef3c7" : "#f3f4f6", textColor: (stats?.filesToAddToPts ?? 0) > 0 ? "#92400e" : "#6b7280", urgent: (stats?.filesToAddToPts ?? 0) > 0 },
          { label: "New Amendments", value: stats?.newAmendments ?? newAmendments.length, icon: FileText, href: "/amendments/pipeline", color: (stats?.newAmendments ?? newAmendments.length) > 0 ? "#fef3c7" : "#f3f4f6", textColor: (stats?.newAmendments ?? newAmendments.length) > 0 ? "#92400e" : "#6b7280", urgent: (stats?.newAmendments ?? newAmendments.length) > 0 },
          { label: "New Refunds", value: stats?.newRefunds ?? newRefunds.length, icon: RefreshCw, href: "/refunds/pipeline", color: (stats?.newRefunds ?? newRefunds.length) > 0 ? "#fce7f3" : "#f3f4f6", textColor: (stats?.newRefunds ?? newRefunds.length) > 0 ? "#9d174d" : "#6b7280", urgent: (stats?.newRefunds ?? newRefunds.length) > 0 },
          { label: "Outstanding Reimb.", value: stats?.outstandingReimbs ?? outstandingReimbs.length, icon: PoundSterling, href: "/admin/reimbursements", color: (stats?.outstandingReimbs ?? outstandingReimbs.length) > 0 ? "#dbeafe" : "#f3f4f6", textColor: (stats?.outstandingReimbs ?? outstandingReimbs.length) > 0 ? "#1e3a5f" : "#6b7280", urgent: false },
          { label: "Commission Due", value: stats?.commissionReady ?? commissionDueList.length, icon: Sparkles, href: "/commission-due", color: (stats?.commissionReady ?? commissionDueList.length) > 0 ? "#d1fae5" : "#f3f4f6", textColor: (stats?.commissionReady ?? commissionDueList.length) > 0 ? "#065f46" : "#6b7280", urgent: false },
        ].map(({ label, value, icon: Icon, href, color, textColor, urgent }) => (
          <Link key={label} href={href}>
            <Card className={`cursor-pointer hover:shadow-md transition-shadow ${urgent && (value as number) > 0 ? "ring-1 ring-amber-300" : ""}`}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color }}>
                    <Icon size={14} style={{ color: textColor }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-bold leading-none">{value}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* ── SECTION 3: PENDING ACTIONS (expandable) ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-bold">Pending Actions</h2>
          {totalPendingActions > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
              style={{ background: '#fef3c7', color: '#92400e' }}>
              {totalPendingActions} outstanding
            </span>
          )}
        </div>
        <div className="grid lg:grid-cols-2 gap-3">

          {/* Amendments */}
          <UrgencyCard
            title="Amendments to Review"
            count={pendingAmendments.length}
            color="#92400e" bg="#fef3c7" borderColor="#f59e0b" icon={FileText}
            href="/amendments/pipeline" linkLabel="Pipeline"
            emptyText="No pending amendments"
            priority={newAmendments.length > 0 ? "high" : "normal"}
          >
            {pendingAmendments.map((a: any) => (
              <Link key={a.id} href={`/amendments/pipeline`}>
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-amber-50/40 hover:bg-amber-50 transition-colors cursor-pointer">
                  <FileText size={11} className="flex-shrink-0 text-amber-700" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold truncate">{a.clientName ?? `Booking #${a.bookingId}`}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1"
                        style={{ borderColor: a.pipelineStage === 'To Do' ? '#ef4444' : a.pipelineStage === 'In Progress' ? '#f59e0b' : '#d1d5db', color: a.pipelineStage === 'To Do' ? '#dc2626' : a.pipelineStage === 'In Progress' ? '#92400e' : '#6b7280' }}>
                        {a.pipelineStage}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <RefRow label="PTS" value={a.ptsRef} />
                      <RefRow label="TD" value={a.topdogRef} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{a.details}</p>
                    {a.assignedToName && (
                      <p className="text-[10px] mt-0.5" style={{ color: '#92400e' }}>
                        → <span className="font-medium">{a.assignedToName}</span>
                      </p>
                    )}
                  </div>
                  <ChevronRight size={11} className="text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
            ))}
          </UrgencyCard>

          {/* Reimbursement docs submitted */}
          <UrgencyCard
            title="Reimbursement Docs Submitted"
            count={reimbAmendments.length}
            color="#dc2626" bg="#fef2f2" borderColor="#dc2626" icon={AlertCircle}
            href="/amendments/pipeline" linkLabel="Pipeline"
            emptyText="No reimbursement docs pending"
            priority="critical"
          >
            {reimbAmendments.map((a: any) => (
              <Link key={a.id} href={`/amendments/pipeline`}>
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-red-50/40 hover:bg-red-50 transition-colors cursor-pointer">
                  <AlertCircle size={11} className="flex-shrink-0 text-red-600" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold truncate">{a.clientName ?? `Booking #${a.bookingId}`}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1" style={{ borderColor: '#fca5a5', color: '#dc2626' }}>
                        {a.pipelineStage}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <RefRow label="PTS" value={a.ptsRef} />
                      <RefRow label="TD" value={a.topdogRef} />
                    </div>
                    {a.assignedToName && (
                      <p className="text-[10px] mt-0.5" style={{ color: '#dc2626' }}>
                        → <span className="font-medium">{a.assignedToName}</span>
                      </p>
                    )}
                  </div>
                  <ChevronRight size={11} className="text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
            ))}
          </UrgencyCard>

          {/* Refunds */}
          <UrgencyCard
            title="Refunds to Process"
            count={pendingRefunds.length}
            color="#9d174d" bg="#fce7f3" borderColor="#ec4899" icon={RefreshCw}
            href="/refunds/pipeline" linkLabel="Pipeline"
            emptyText="No pending refunds"
            priority={newRefunds.length > 0 ? "high" : "normal"}
          >
            {pendingRefunds.map((r: any) => (
              <Link key={r.id} href={`/refunds/pipeline`}>
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-pink-50/40 hover:bg-pink-50 transition-colors cursor-pointer">
                  <RefreshCw size={11} className="flex-shrink-0 text-pink-700" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold truncate">{r.clientName ?? `Booking #${r.bookingId}`}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1" style={{ borderColor: '#f9a8d4', color: '#9d174d' }}>
                        {r.pipelineStage}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <RefRow label="PTS" value={r.ptsRef} />
                      <RefRow label="TD" value={r.topdogRef} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {r.refundType}{r.refundReason ? ` · ${r.refundReason.slice(0, 50)}` : ""}
                    </p>
                    {r.assignedToName && (
                      <p className="text-[10px] mt-0.5" style={{ color: '#9d174d' }}>
                        → <span className="font-medium">{r.assignedToName}</span>
                      </p>
                    )}
                  </div>
                  <ChevronRight size={11} className="text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
            ))}
          </UrgencyCard>

          {/* Cancellations */}
          <UrgencyCard
            title="Cancellation Requests"
            count={pendingCancellations.length}
            color="#7c3aed" bg="#f5f3ff" borderColor="#8b5cf6" icon={XCircle}
            href="/pipeline" linkLabel="Pipeline"
            emptyText="No pending cancellation requests"
            priority="normal"
          >
            {pendingCancellations.map((c: any) => (
              <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg border bg-violet-50/40">
                <XCircle size={11} className="flex-shrink-0 text-violet-700" />
                <div className="flex-1 min-w-0">
                  <Link href={`/bookings/${c.bookingId}`}>
                    <span className="text-xs font-semibold truncate block hover:underline cursor-pointer">{c.clientName ?? `Booking #${c.bookingId}`}</span>
                  </Link>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <RefRow label="PTS" value={c.ptsRef} />
                    <RefRow label="TD" value={c.topdogRef} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Requested: {c.confirmedAt ? format(new Date(c.confirmedAt), "dd MMM yyyy, HH:mm") : "—"}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setCancelConfirmId(c.id); }}
                  disabled={markCancellationActioned.isPending}
                  className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors hover:bg-green-100 text-green-700 border border-green-200"
                >
                  <CheckCircle2 size={10} /> Done
                </button>
              </div>
            ))}
          </UrgencyCard>

          {/* Late Reimbursement Requests */}
          {lateUnactioned.length > 0 && (
            <UrgencyCard
              title="Late Reimbursement Requests"
              count={lateUnactioned.length}
              color="#dc2626" bg="#fff1f2" borderColor="#dc2626" icon={Banknote}
              href="/admin/reimbursements" linkLabel="Reimbursements"
              emptyText="No unactioned late reimbursements"
              priority="critical"
            >
              {lateUnactioned.map((r: any) => (
                <div key={r.id} className="flex items-start gap-2 p-2 rounded-lg border bg-rose-50/60">
                  <Banknote size={11} className="flex-shrink-0 text-rose-600 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link href={`/bookings/${r.bookingId}`}>
                        <span className="text-xs font-semibold hover:underline cursor-pointer">{r.clientName ?? `Booking #${r.bookingId}`}</span>
                      </Link>
                      <Badge variant="outline" className="text-[9px] h-4 px-1" style={{ borderColor: '#fca5a5', color: '#dc2626' }}>Late</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">Supplier: <span className="font-medium">{r.supplierName}</span></span>
                      <span className="text-[10px] text-muted-foreground">£{Number(r.amount).toFixed(2)}</span>
                      {r.agentName && <span className="text-[10px] text-muted-foreground">Agent: {r.agentName}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <select
                        className="text-[10px] border rounded px-1 py-0.5 bg-white"
                        value={r.assignedToId ?? ""}
                        onChange={(e) => assignReimb.mutate({ id: r.id, assignedToId: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">Unassigned</option>
                        {adminUsersForAssign.map((a: any) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => scheduleReimb.mutate({ id: r.id, status: "scheduled" })}
                        disabled={scheduleReimb.isPending}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 transition-colors"
                      >
                        <CheckCircle2 size={10} /> Mark Scheduled
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </UrgencyCard>
          )}

        </div>
      </div>

      {/* ── SECTION 4: PIPELINE + ACTIVITY ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Pipeline Breakdown</CardTitle>
            <Link href="/pipeline">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">Kanban <ArrowRight size={12} /></Button>
            </Link>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              {STAGE_ORDER.filter((s) => stageCount[s] > 0).map((stage) => {
                const count = stageCount[stage] ?? 0;
                const pct = Math.round((count / Math.max(stats?.totalBookings ?? 1, 1)) * 100);
                const isUrgent = URGENT_STAGES.has(stage);
                return (
                  <Link key={stage} href="/pipeline">
                    <div className="flex items-center gap-2 group cursor-pointer hover:opacity-80 transition-opacity">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STAGE_COLORS[stage] ?? '#9ca3af' }} />
                      <span className="text-xs flex-1 truncate">{stage}</span>
                      {isUrgent && <AlertCircle size={10} style={{ color: '#dc2626' }} />}
                      <span className="text-xs font-bold tabular-nums w-5 text-right">{count}</span>
                      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: STAGE_COLORS[stage] ?? '#9ca3af' }} />
                      </div>
                    </div>
                  </Link>
                );
              })}
              {(stats?.totalBookings ?? 0) === 0 && <p className="text-xs text-muted-foreground col-span-2 text-center py-4">No bookings yet</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Bell size={13} /> Activity
              {unreadNotifs.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: '#70FFE8', color: '#414141' }}>
                  {unreadNotifs.length}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
              {notifications.slice(0, 8).map((n) => (
                <div key={n.id} className="flex gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.isRead ? 'bg-muted' : 'bg-[#02E6D2]'}`} />
                  <div className="min-w-0">
                    <p className={`text-xs leading-snug ${n.isRead ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{n.createdAt ? format(new Date(n.createdAt), "dd MMM, HH:mm") : ""}</p>
                  </div>
                </div>
              ))}
              {notifications.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No activity yet</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── SECTION 5: DEPARTURES + RECENT BOOKINGS ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Calendar size={13} /> Departures — Next 14 Days
              {upcomingDepartures.length > 0 && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: '#FFF6ED', color: '#92400e' }}>
                  {upcomingDepartures.length}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {upcomingDepartures.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircle2 size={20} className="mx-auto text-muted-foreground opacity-30 mb-1" />
                <p className="text-xs text-muted-foreground">No departures in the next 14 days</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {upcomingDepartures.map((b) => {
                  const days = b.departureDate ? differenceInDays(new Date(b.departureDate), now) : 0;
                  return (
                    <Link key={b.id} href={`/bookings/${b.id}`}>
                      <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                        <div className="text-center w-10 flex-shrink-0">
                          <p className="text-sm font-bold leading-none" style={{ color: days <= 3 ? '#dc2626' : '#02E6D2' }}>{days}</p>
                          <p className="text-[9px] text-muted-foreground">days</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{b.clientName}</p>
                          <p className="text-[10px] text-muted-foreground">{b.departureDate ? format(new Date(b.departureDate), "dd MMM yyyy") : "—"}</p>
                        </div>
                        <ChevronRight size={12} className="text-muted-foreground flex-shrink-0" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Recent Bookings</CardTitle>
            <Link href="/pipeline">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">All <ArrowRight size={12} /></Button>
            </Link>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: '#70FFE8' }} />
              </div>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {recentBookings.map((booking) => {
                  const isUrgent = URGENT_STAGES.has(booking.currentStage);
                  return (
                    <Link key={booking.id} href={`/bookings/${booking.id}`}>
                      <div className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${isUrgent ? "bg-red-50 hover:bg-red-100" : "hover:bg-muted/50"}`}>
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STAGE_COLORS[booking.currentStage] ?? '#9ca3af' }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{booking.clientName}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{booking.currentStage}</p>
                        </div>
                        {isUrgent && <AlertCircle size={11} style={{ color: '#dc2626' }} />}
                        <ChevronRight size={12} className="text-muted-foreground flex-shrink-0" />
                      </div>
                    </Link>
                  );
                })}
                {recentBookings.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No bookings yet</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cancellation actioned confirmation dialog */}
      <Dialog open={cancelConfirmId !== null} onOpenChange={(open) => { if (!open) setCancelConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark Cancellation as Done</DialogTitle>
            <DialogDescription>
              Would you also like to move this booking to the <strong>Cancelled</strong> stage in the pipeline?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="w-full"
              onClick={() => markCancellationActioned.mutate({ cancellationId: cancelConfirmId!, moveToCancelled: true })}
              disabled={markCancellationActioned.isPending}
            >
              Yes — Mark Done &amp; Move to Cancelled
            </Button>
            <Button
              variant="outline"
              className="w-full bg-background"
              onClick={() => markCancellationActioned.mutate({ cancellationId: cancelConfirmId!, moveToCancelled: false })}
              disabled={markCancellationActioned.isPending}
            >
              No — Just Mark as Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
