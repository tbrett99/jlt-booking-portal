import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BookOpen, Users, FileText, TrendingUp, Bell, ArrowRight,
  AlertTriangle, Sparkles, AlertCircle, Calendar
} from "lucide-react";
import { format, differenceInDays } from "date-fns";

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

const URGENT_STAGES = new Set(["Reimb Docs Missing", "Urgent/Reimb", "Query"]);

export default function AdminDashboard() {
  const { data: bookings = [], isLoading } = trpc.bookings.all.useQuery({});
  const { data: users = [] } = trpc.users.list.useQuery();
  const { data: amendments = [] } = trpc.amendments.all.useQuery();
  const { data: notifications = [] } = trpc.notifications.myNotifications.useQuery();

  const agents = users.filter((u) => u.role === "agent");
  const activeBookings = bookings.filter((b) => b.currentStage !== "Cancelled");
  const pendingAmendments = amendments.filter((a) => a.status === "pending");
  const unreadNotifs = notifications.filter((n) => !n.isRead);
  const commissionReady = bookings.filter((b) => b.currentStage === "Commission Claimable");
  const urgentBookings = bookings.filter((b) => URGENT_STAGES.has(b.currentStage));
  const missingPaymentDate = bookings.filter(
    (b) => !b.finalSupplierPaymentDate && b.currentStage !== "Cancelled"
  );

  // Stage distribution
  const stageCount: Record<string, number> = {};
  for (const b of bookings) {
    stageCount[b.currentStage] = (stageCount[b.currentStage] ?? 0) + 1;
  }

  // Recent bookings
  const recentBookings = [...bookings]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of all bookings and activity</p>
      </div>

      {/* Action banners */}
      {urgentBookings.length > 0 && (
        <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
          style={{ borderLeftColor: '#dc2626', background: '#fef2f2' }}>
          <AlertCircle size={18} style={{ color: '#dc2626' }} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm" style={{ color: '#991b1b' }}>
              {urgentBookings.length} booking{urgentBookings.length > 1 ? "s" : ""} require urgent attention
            </p>
            <p className="text-xs mt-0.5 opacity-80" style={{ color: '#991b1b' }}>
              {urgentBookings.map((b) => b.clientName).join(", ")}
            </p>
          </div>
          <Link href="/pipeline">
            <Button size="sm" variant="outline" className="flex-shrink-0 text-xs border-red-300 text-red-700 hover:bg-red-50">
              View Pipeline <ArrowRight size={12} className="ml-1" />
            </Button>
          </Link>
        </div>
      )}

      {missingPaymentDate.length > 0 && (
        <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
          style={{ borderLeftColor: '#f59e0b', background: '#fffbeb' }}>
          <AlertTriangle size={18} style={{ color: '#f59e0b' }} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm" style={{ color: '#92400e' }}>
              {missingPaymentDate.length} booking{missingPaymentDate.length > 1 ? "s" : ""} missing a Final Supplier Payment Date
            </p>
            <p className="text-xs mt-0.5 opacity-80" style={{ color: '#92400e' }}>
              Required before moving to "Added to PTS" or later stages.
            </p>
          </div>
          <Link href="/pipeline">
            <Button size="sm" variant="outline" className="flex-shrink-0 text-xs border-amber-300 text-amber-700 hover:bg-amber-50">
              Review <ArrowRight size={12} className="ml-1" />
            </Button>
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#70FFE8' }}>
                <BookOpen size={20} style={{ color: '#414141' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeBookings.length}</p>
                <p className="text-xs text-muted-foreground">Active Bookings</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#FFC3BC' }}>
                <Users size={20} style={{ color: '#414141' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{agents.length}</p>
                <p className="text-xs text-muted-foreground">Active Agents</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={pendingAmendments.length > 0 ? "border-amber-300" : ""}>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#fef3c7' }}>
                <FileText size={20} style={{ color: '#92400e' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{pendingAmendments.length}</p>
                <p className="text-xs text-muted-foreground">Pending Amendments</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={commissionReady.length > 0 ? "border-[#02E6D2]" : ""}>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#d1fae5' }}>
                <Sparkles size={20} style={{ color: '#02E6D2' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{commissionReady.length}</p>
                <p className="text-xs text-muted-foreground">Commission Ready</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Pipeline overview */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Pipeline Overview</CardTitle>
            <Link href="/pipeline">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                View Kanban <ArrowRight size={14} />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(stageCount)
                .sort((a, b) => b[1] - a[1])
                .map(([stage, count]) => (
                  <div key={stage} className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: STAGE_COLORS[stage] ?? '#9ca3af' }} />
                    <span className="text-sm flex-1 truncate">{stage}</span>
                    {URGENT_STAGES.has(stage) && (
                      <AlertCircle size={12} style={{ color: '#dc2626' }} />
                    )}
                    <span className="text-sm font-semibold tabular-nums">{count}</span>
                    <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{
                          width: `${(count / Math.max(bookings.length, 1)) * 100}%`,
                          background: STAGE_COLORS[stage] ?? '#9ca3af'
                        }} />
                    </div>
                  </div>
                ))}
              {bookings.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No bookings yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell size={16} />
              Recent Activity
              {unreadNotifs.length > 0 && (
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: '#70FFE8', color: '#414141' }}>
                  {unreadNotifs.length} new
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {notifications.slice(0, 6).map((n) => (
                <div key={n.id} className="text-sm">
                  <p className={`${n.isRead ? 'text-muted-foreground' : 'text-foreground font-medium'} leading-snug`}>
                    {n.message}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(n.createdAt), "dd MMM, HH:mm")}
                  </p>
                </div>
              ))}
              {notifications.length === 0 && (
                <div className="text-center py-6">
                  <Bell size={24} className="mx-auto text-muted-foreground opacity-30 mb-2" />
                  <p className="text-sm text-muted-foreground">No notifications yet</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent bookings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Recent Bookings</CardTitle>
          <Link href="/pipeline">
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              View All <ArrowRight size={14} />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#70FFE8' }} />
            </div>
          ) : (
            <div className="space-y-2">
              {recentBookings.map((booking) => {
                const daysUntil = differenceInDays(new Date(booking.departureDate), new Date());
                const isUrgent = URGENT_STAGES.has(booking.currentStage);
                return (
                  <Link key={booking.id} href={`/bookings/${booking.id}`}>
                    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all hover:shadow-sm cursor-pointer ${
                      isUrgent ? "border-red-200 bg-red-50/50" : "border-border hover:border-[#70FFE8]/50"
                    }`}>
                      <div className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: STAGE_COLORS[booking.currentStage] ?? '#9ca3af' }} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{booking.clientName}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Calendar size={10} />
                            {format(new Date(booking.departureDate), "dd MMM yyyy")}
                            {daysUntil > 0 && <span className="opacity-60">({daysUntil}d)</span>}
                          </span>
                          {booking.topdogRef && (
                            <span className="text-xs text-muted-foreground">TD: {booking.topdogRef}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isUrgent && <AlertCircle size={14} style={{ color: '#dc2626' }} />}
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium hidden sm:inline-block"
                          style={{
                            background: `${STAGE_COLORS[booking.currentStage] ?? '#9ca3af'}20`,
                            color: STAGE_COLORS[booking.currentStage] ?? '#9ca3af'
                          }}>
                          {booking.currentStage}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
              {recentBookings.length === 0 && (
                <div className="text-center py-8">
                  <BookOpen size={32} className="mx-auto text-muted-foreground opacity-30 mb-2" />
                  <p className="text-sm text-muted-foreground">No bookings yet</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
