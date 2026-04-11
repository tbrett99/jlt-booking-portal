import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, Users, FileText, TrendingUp, Bell, ArrowRight,
  AlertTriangle, Sparkles, AlertCircle, Calendar, Clock,
  CheckCircle2, Banknote, RefreshCw, ChevronRight, Upload, BellOff,
  MessageSquare, CheckCheck, XCircle, ChevronDown, ChevronUp,
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

function ExpandablePanel({
  title, count, color, bg, icon: Icon, linkHref, linkLabel, children, emptyText,
}: {
  title: string; count: number; color: string; bg: string; icon: React.ElementType;
  linkHref: string; linkLabel: string; children: React.ReactNode; emptyText: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Card className="border-l-4" style={{ borderLeftColor: color }}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-2 text-left flex-1"
            onClick={() => setOpen((o) => !o)}
          >
            <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: count > 0 ? color + '22' : '#f3f4f6' }}>
              <Icon size={13} style={{ color: count > 0 ? color : '#9ca3af' }} />
            </div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              {title}
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                style={{ background: count > 0 ? bg : '#f3f4f6', color: count > 0 ? color : '#9ca3af' }}>
                {count}
              </span>
            </CardTitle>
            {open ? <ChevronUp size={13} className="text-muted-foreground ml-1" /> : <ChevronDown size={13} className="text-muted-foreground ml-1" />}
          </button>
          <Link href={linkHref}>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 flex-shrink-0" style={{ color }}>
              {linkLabel} <ArrowRight size={11} />
            </Button>
          </Link>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4">
          {count === 0 ? (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <CheckCircle2 size={14} className="text-emerald-400" /> {emptyText}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {children}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function AdminDashboard() {
  const { data: bookings = [], isLoading } = trpc.bookings.all.useQuery({});
  const { data: agentList = [] } = trpc.users.listAgents.useQuery();
  const { data: adminList = [] } = trpc.users.listAdmins.useQuery();
  const { data: amendments = [] } = trpc.amendments.all.useQuery();
  const { data: refunds = [] } = trpc.refunds.all.useQuery();
  const { data: cancellations = [] } = trpc.cancellations.all.useQuery();
  const { data: notifications = [] } = trpc.notifications.myNotifications.useQuery();
  const { data: claims = [] } = trpc.commissionClaims.all.useQuery();
  const utils = trpc.useUtils();
  const { data: notifSettings } = trpc.settings.getNotificationsPaused.useQuery();
  const notificationsPaused = notifSettings?.paused ?? false;
  const setNotifPaused = trpc.settings.setNotificationsPaused.useMutation({
    onSuccess: () => utils.settings.getNotificationsPaused.invalidate(),
  });
  const { data: unreadMessages = [], refetch: refetchUnread } = trpc.notes.unreadAgentMessages.useQuery();
  const markRead = trpc.notes.markBookingNotesRead.useMutation({
    onSuccess: () => refetchUnread(),
  });

  const agents = agentList;
  const activeBookings = bookings.filter((b) => b.currentStage !== "Cancelled");
  // Amendments: pending = To Do or In Progress (not Actioned), excluding reimbursement doc entries
  const pendingAmendments = (amendments as any[]).filter(
    (a) => a.pipelineStage !== "Actioned" && !a.isReimbursementDoc
  );
  const reimbAmendments = (amendments as any[]).filter(
    (a) => a.pipelineStage !== "Actioned" && a.isReimbursementDoc
  );
  const pendingRefunds = (refunds as any[]).filter(
    (r) => r.pipelineStage !== "Refund Processed"
  );
  const pendingCancellations = (cancellations as any[]).filter((c) => !c.processed);
  const unreadNotifs = notifications.filter((n) => !n.isRead);
  const commissionReady = bookings.filter((b) => b.currentStage === "Commission Claimable");
  const urgentBookings = bookings.filter((b) => URGENT_STAGES.has(b.currentStage));
  const missingPaymentDate = activeBookings.filter(
    (b) => !b.finalSupplierPaymentDate && !(b as any).paymentDateDismissed && b.currentStage !== "Cancelled"
  );
  const pendingClaims = (claims as any[]).filter((c) => c.status === "claimed_not_paid");

  const now = new Date();
  const in14 = addDays(now, 14);
  const upcomingDepartures = activeBookings
    .filter((b) => { const d = new Date(b.departureDate); return d >= now && d <= in14; })
    .sort((a, b) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());

  const stageCount: Record<string, number> = {};
  for (const b of bookings) stageCount[b.currentStage] = (stageCount[b.currentStage] ?? 0) + 1;

  const recentBookings = [...bookings]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  const lowMarginBookings = activeBookings.filter((b) => {
    const gc = Number((b as any).grossCost || 0);
    const ec = Number(b.expectedCommission || 0);
    if (!gc || !ec) return false;
    return (ec / gc) * 100 < 5;
  });

  const thisMonth = bookings.filter((b) => {
    const d = new Date(b.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const totalPendingActions = pendingAmendments.length + reimbAmendments.length + pendingRefunds.length + pendingCancellations.length + pendingClaims.length;

  return (
    <div className="space-y-4 p-1">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground text-xs mt-0.5">{format(now, "EEEE d MMMM yyyy")}</p>
        </div>
        <div className="flex gap-2">
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

      {/* ── KEY METRICS (moved to top) ── */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Active Bookings", value: activeBookings.length, icon: BookOpen, color: "#70FFE8", textColor: "#414141" },
          { label: "Agents", value: agents.length, icon: Users, color: "#FFC3BC", textColor: "#414141" },
          { label: "This Month", value: thisMonth.length, icon: Calendar, color: "#e0e7ff", textColor: "#4338ca" },
          { label: "Amendments", value: pendingAmendments.length, icon: FileText, color: pendingAmendments.length > 0 ? "#fef3c7" : "#f3f4f6", textColor: pendingAmendments.length > 0 ? "#92400e" : "#6b7280" },
          { label: "Refunds", value: pendingRefunds.length, icon: RefreshCw, color: pendingRefunds.length > 0 ? "#fce7f3" : "#f3f4f6", textColor: pendingRefunds.length > 0 ? "#9d174d" : "#6b7280" },
          { label: "Comm. Ready", value: commissionReady.length, icon: Sparkles, color: commissionReady.length > 0 ? "#d1fae5" : "#f3f4f6", textColor: commissionReady.length > 0 ? "#065f46" : "#6b7280" },
        ].map(({ label, value, icon: Icon, color, textColor }) => (
          <Card key={label} className="cursor-default">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color }}>
                  <Icon size={15} style={{ color: textColor }} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-none">{value}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">{label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── PENDING ACTIONS ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Clock size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Pending Actions</h2>
          {totalPendingActions > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
              style={{ background: '#fef3c7', color: '#92400e' }}>
              {totalPendingActions} outstanding
            </span>
          )}
        </div>
        <div className="grid lg:grid-cols-2 gap-3">

          {/* Amendments */}
          <ExpandablePanel
            title="Amendments to Review"
            count={pendingAmendments.length}
            color="#92400e" bg="#fef3c7" icon={FileText}
            linkHref="/amendments/pipeline" linkLabel="Amendment Pipeline"
            emptyText="No pending amendments"
          >
            {pendingAmendments.map((a: any) => (
              <Link key={a.id} href={`/amendments/pipeline`}>
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-amber-50/40 hover:bg-amber-50 transition-colors cursor-pointer">
                  <FileText size={11} className="flex-shrink-0 text-amber-700" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold truncate">{a.clientName ?? `Booking #${a.bookingId}`}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5"
                        style={{ borderColor: a.pipelineStage === 'In Progress' ? '#f59e0b' : '#d1d5db', color: a.pipelineStage === 'In Progress' ? '#92400e' : '#6b7280' }}>
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
                        Assigned to: <span className="font-medium">{a.assignedToName}</span>
                      </p>
                    )}
                  </div>
                  <ChevronRight size={11} className="text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
            ))}
          </ExpandablePanel>

          {/* Reimbursement docs */}
          <ExpandablePanel
            title="Reimbursement Docs Submitted"
            count={reimbAmendments.length}
            color="#dc2626" bg="#fef2f2" icon={AlertCircle}
            linkHref="/amendments/pipeline" linkLabel="Amendment Pipeline"
            emptyText="No reimbursement docs pending"
          >
            {reimbAmendments.map((a: any) => (
              <Link key={a.id} href={`/amendments/pipeline`}>
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-red-50/40 hover:bg-red-50 transition-colors cursor-pointer">
                  <AlertCircle size={11} className="flex-shrink-0 text-red-600" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold truncate">{a.clientName ?? `Booking #${a.bookingId}`}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5"
                        style={{ borderColor: '#fca5a5', color: '#dc2626' }}>
                        {a.pipelineStage}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <RefRow label="PTS" value={a.ptsRef} />
                      <RefRow label="TD" value={a.topdogRef} />
                    </div>
                    {a.assignedToName && (
                      <p className="text-[10px] mt-0.5" style={{ color: '#dc2626' }}>
                        Assigned to: <span className="font-medium">{a.assignedToName}</span>
                      </p>
                    )}
                  </div>
                  <ChevronRight size={11} className="text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
            ))}
          </ExpandablePanel>

          {/* Refunds */}
          <ExpandablePanel
            title="Refunds to Process"
            count={pendingRefunds.length}
            color="#9d174d" bg="#fce7f3" icon={RefreshCw}
            linkHref="/refunds/pipeline" linkLabel="Refund Pipeline"
            emptyText="No pending refunds"
          >
            {pendingRefunds.map((r: any) => (
              <Link key={r.id} href={`/refunds/pipeline`}>
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-pink-50/40 hover:bg-pink-50 transition-colors cursor-pointer">
                  <RefreshCw size={11} className="flex-shrink-0 text-pink-700" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold truncate">{r.clientName ?? `Booking #${r.bookingId}`}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5"
                        style={{ borderColor: '#f9a8d4', color: '#9d174d' }}>
                        {r.pipelineStage}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <RefRow label="PTS" value={r.ptsRef} />
                      <RefRow label="TD" value={r.topdogRef} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Type: {r.refundType} · {r.refundReason ? r.refundReason.slice(0, 60) : ""}
                    </p>
                    {r.assignedToName && (
                      <p className="text-[10px] mt-0.5" style={{ color: '#9d174d' }}>
                        Assigned to: <span className="font-medium">{r.assignedToName}</span>
                      </p>
                    )}
                  </div>
                  <ChevronRight size={11} className="text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
            ))}
          </ExpandablePanel>

          {/* Cancellations */}
          <ExpandablePanel
            title="Cancellation Requests"
            count={pendingCancellations.length}
            color="#7c3aed" bg="#f5f3ff" icon={XCircle}
            linkHref="/pipeline" linkLabel="View Pipeline"
            emptyText="No pending cancellation requests"
          >
            {pendingCancellations.map((c: any) => (
              <Link key={c.id} href={`/bookings/${c.bookingId}`}>
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-violet-50/40 hover:bg-violet-50 transition-colors cursor-pointer">
                  <XCircle size={11} className="flex-shrink-0 text-violet-700" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold truncate block">{c.clientName ?? `Booking #${c.bookingId}`}</span>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <RefRow label="PTS" value={c.ptsRef} />
                      <RefRow label="TD" value={c.topdogRef} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Requested: {format(new Date(c.confirmedAt), "dd MMM yyyy, HH:mm")}
                    </p>
                  </div>
                  <ChevronRight size={11} className="text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
            ))}
          </ExpandablePanel>

        </div>
      </div>

      {/* Alert banners */}
      {(urgentBookings.length > 0 || missingPaymentDate.length > 0 || pendingClaims.length > 0 || lowMarginBookings.length > 0) && (
        <div className="space-y-2">
          {urgentBookings.length > 0 && (
            <div className="rounded-lg border-l-4 px-4 py-2.5 flex items-center gap-3"
              style={{ borderLeftColor: '#dc2626', background: '#fef2f2' }}>
              <AlertCircle size={15} style={{ color: '#dc2626' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#991b1b' }}>
                  {urgentBookings.length} booking{urgentBookings.length > 1 ? "s" : ""} need urgent attention
                </span>
                <span className="text-xs ml-2 opacity-70" style={{ color: '#991b1b' }}>
                  {urgentBookings.slice(0, 3).map((b) => b.clientName).join(", ")}
                  {urgentBookings.length > 3 && ` +${urgentBookings.length - 3} more`}
                </span>
              </div>
              <Link href="/pipeline"><Button size="sm" variant="ghost" className="text-xs text-red-700 h-7 px-2">View</Button></Link>
            </div>
          )}
          {missingPaymentDate.length > 0 && (
            <div className="rounded-lg border-l-4 px-4 py-2.5 flex items-center gap-3"
              style={{ borderLeftColor: '#f59e0b', background: '#fffbeb' }}>
              <AlertTriangle size={15} style={{ color: '#f59e0b' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#92400e' }}>
                  {missingPaymentDate.length} booking{missingPaymentDate.length > 1 ? "s" : ""} missing a Final Supplier Payment Date
                </span>
              </div>
              <Link href="/pts-missing-payment"><Button size="sm" variant="ghost" className="text-xs text-amber-700 h-7 px-2">Review</Button></Link>
            </div>
          )}
          {pendingClaims.length > 0 && (
            <div className="rounded-lg border-l-4 px-4 py-2.5 flex items-center gap-3"
              style={{ borderLeftColor: '#02E6D2', background: '#ecfdf5' }}>
              <Banknote size={15} style={{ color: '#02E6D2' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#065f46' }}>
                  {pendingClaims.length} commission claim{pendingClaims.length > 1 ? "s" : ""} awaiting payment
                </span>
              </div>
              <Link href="/commissions-admin"><Button size="sm" variant="ghost" className="text-xs text-emerald-700 h-7 px-2">Process</Button></Link>
            </div>
          )}
          {lowMarginBookings.length > 0 && (
            <div className="rounded-lg border-l-4 px-4 py-2.5 flex items-center gap-3"
              style={{ borderLeftColor: '#7c3aed', background: '#f5f3ff' }}>
              <TrendingUp size={15} style={{ color: '#7c3aed' }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs" style={{ color: '#4c1d95' }}>
                  {lowMarginBookings.length} booking{lowMarginBookings.length > 1 ? 's' : ''} with margin below 5%
                </span>
                <span className="text-xs ml-2 opacity-70" style={{ color: '#4c1d95' }}>
                  {lowMarginBookings.slice(0, 3).map((b) => b.clientName).join(', ')}
                  {lowMarginBookings.length > 3 && ` +${lowMarginBookings.length - 3} more`}
                </span>
              </div>
              <Link href="/pipeline"><Button size="sm" variant="ghost" className="text-xs h-7 px-2" style={{ color: '#7c3aed' }}>Review</Button></Link>
            </div>
          )}
        </div>
      )}

      {/* Main content: pipeline + activity */}
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
                const pct = Math.round((count / Math.max(bookings.length, 1)) * 100);
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
              {bookings.length === 0 && <p className="text-xs text-muted-foreground col-span-2 text-center py-4">No bookings yet</p>}
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
                    <p className="text-[10px] text-muted-foreground mt-0.5">{format(new Date(n.createdAt), "dd MMM, HH:mm")}</p>
                  </div>
                </div>
              ))}
              {notifications.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No activity yet</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Unread agent messages */}
      {unreadMessages.length > 0 && (
        <Card className="border-l-4" style={{ borderLeftColor: '#f59e0b' }}>
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <MessageSquare size={13} style={{ color: '#f59e0b' }} />
              Agent Messages Awaiting Reply
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-1" style={{ background: '#fef3c7', color: '#92400e' }}>
                {unreadMessages.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {(unreadMessages as any[]).map((msg) => (
                <div key={msg.bookingId} className="flex items-start gap-3 p-2.5 rounded-lg border bg-amber-50/50 hover:bg-amber-50 transition-colors">
                  <MessageSquare size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/bookings/${msg.bookingId}`}>
                        <span className="text-xs font-semibold hover:underline cursor-pointer">{msg.clientName}</span>
                      </Link>
                      <span className="text-[10px] text-muted-foreground">from {msg.authorName}</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(msg.latestMessageAt), "dd MMM, HH:mm")}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{msg.latestMessage}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Link href={`/bookings/${msg.bookingId}`}>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1">Reply</Button>
                    </Link>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1 text-muted-foreground"
                      onClick={() => markRead.mutate({ bookingId: msg.bookingId })} title="Mark as read">
                      <CheckCheck size={11} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bottom row: departures + recent bookings */}
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
                  const days = differenceInDays(new Date(b.departureDate), now);
                  return (
                    <Link key={b.id} href={`/bookings/${b.id}`}>
                      <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                        <div className="text-center w-10 flex-shrink-0">
                          <p className="text-sm font-bold leading-none" style={{ color: days <= 3 ? '#dc2626' : '#02E6D2' }}>{days}</p>
                          <p className="text-[9px] text-muted-foreground">days</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{b.clientName}</p>
                          <p className="text-[10px] text-muted-foreground">{format(new Date(b.departureDate), "dd MMM yyyy")}</p>
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
    </div>
  );
}
