import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Users, FileText, TrendingUp, Bell, ArrowRight } from "lucide-react";
import { format } from "date-fns";

const STAGE_COLORS: Record<string, string> = {
  "New Booking": "#3b82f6",
  "Not on Topdog": "#f59e0b",
  "Query": "#eab308",
  "Reimb Docs Missing": "#ef4444",
  "Urgent/Reimb": "#dc2626",
  "Added to PTS": "#10b981",
  "Commission Claimable": "#02E6D2",
  "Commission Claimed": "#059669",
  "Cancelled": "#9ca3af",
  "Holding Accounts": "#d97706",
};

export default function AdminDashboard() {
  const { data: bookings = [], isLoading } = trpc.bookings.all.useQuery({});
  const { data: users = [] } = trpc.users.list.useQuery();
  const { data: amendments = [] } = trpc.amendments.all.useQuery();
  const { data: notifications = [] } = trpc.notifications.myNotifications.useQuery();

  const agents = users.filter((u) => u.role === "agent");
  const activeBookings = bookings.filter((b) => b.currentStage !== "Cancelled");
  const pendingAmendments = amendments.filter((a) => a.status === "pending");
  const unreadNotifs = notifications.filter((n) => !n.isRead);

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
        <Card>
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
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#d1fae5' }}>
                <TrendingUp size={20} style={{ color: '#065f46' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {bookings.filter((b) => b.currentStage === "Commission Claimable").length}
                </p>
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
                    <span className="text-sm font-semibold tabular-nums">{count}</span>
                    <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{
                          width: `${(count / bookings.length) * 100}%`,
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

        {/* Notifications */}
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
                  <p className={`${n.isRead ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>
                    {n.message}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(n.createdAt), "dd MMM, HH:mm")}
                  </p>
                </div>
              ))}
              {notifications.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No notifications</p>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-semibold text-muted-foreground">Client</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden sm:table-cell">Departure</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden md:table-cell">Topdog Ref</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Stage</th>
                    <th className="pb-3 font-semibold text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recentBookings.map((booking) => (
                    <tr key={booking.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 font-medium">{booking.clientName}</td>
                      <td className="py-3 text-muted-foreground hidden sm:table-cell">
                        {format(new Date(booking.departureDate), "dd MMM yyyy")}
                      </td>
                      <td className="py-3 text-muted-foreground hidden md:table-cell">
                        {booking.topdogRef ?? <span className="italic opacity-50">—</span>}
                      </td>
                      <td className="py-3">
                        <span className="text-xs px-2 py-1 rounded-full font-medium"
                          style={{
                            background: `${STAGE_COLORS[booking.currentStage] ?? '#9ca3af'}20`,
                            color: STAGE_COLORS[booking.currentStage] ?? '#9ca3af'
                          }}>
                          {booking.currentStage}
                        </span>
                      </td>
                      <td className="py-3">
                        <Link href={`/bookings/${booking.id}`}>
                          <Button variant="ghost" size="sm" className="text-xs h-7">View</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recentBookings.length === 0 && (
                <p className="text-center py-8 text-muted-foreground">No bookings yet</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
