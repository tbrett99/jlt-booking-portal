import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Clock, CheckCircle, XCircle, AlertCircle, Bell, Plus, TrendingUp } from "lucide-react";
import { format } from "date-fns";

const STAGE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  "New Booking": { label: "New", color: "#414141", bg: "#FFF6ED" },
  "Creating own PTS file": { label: "Creating PTS", color: "#414141", bg: "#e0e7ff" },
  "Not on Topdog": { label: "Not on Topdog", color: "#92400e", bg: "#fef3c7" },
  "Query": { label: "Query", color: "#92400e", bg: "#fef9c3" },
  "Reimb Docs Missing": { label: "Docs Missing", color: "#991b1b", bg: "#fee2e2" },
  "Urgent/Reimb": { label: "Urgent", color: "#991b1b", bg: "#fecaca" },
  "T/O Package": { label: "T/O Package", color: "#5b21b6", bg: "#ede9fe" },
  "DP": { label: "DP", color: "#9d174d", bg: "#fce7f3" },
  "Added to PTS": { label: "Added to PTS", color: "#065f46", bg: "#d1fae5" },
  "Commission Claimable": { label: "Commission Ready", color: "#065f46", bg: "#70FFE8" },
  "Commission Claimed": { label: "Claimed", color: "#064e3b", bg: "#a7f3d0" },
  "Cancelled": { label: "Cancelled", color: "#6b7280", bg: "#f3f4f6" },
  "Holding Accounts": { label: "Holding", color: "#92400e", bg: "#fef3c7" },
};

export default function AgentDashboard() {
  const { user } = useAuth();
  const { data: bookings = [], isLoading } = trpc.bookings.myBookings.useQuery();
  const { data: notifications = [] } = trpc.notifications.myNotifications.useQuery();

  const activeBookings = bookings.filter((b) => b.currentStage !== "Cancelled");
  const cancelledBookings = bookings.filter((b) => b.currentStage === "Cancelled");
  const commissionClaimable = bookings.filter((b) => b.currentStage === "Commission Claimable");
  const unreadNotifs = notifications.filter((n) => !n.isRead);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Welcome back, {user?.name?.split(" ")[0]}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Here's an overview of your bookings</p>
        </div>
        <Link href="/bookings/new">
          <Button style={{ background: '#70FFE8', color: '#414141' }} className="font-semibold gap-2">
            <Plus size={16} />
            Register Booking
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#FFF6ED' }}>
                <BookOpen size={20} style={{ color: '#02E6D2' }} />
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
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#d1fae5' }}>
                <TrendingUp size={20} style={{ color: '#065f46' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{commissionClaimable.length}</p>
                <p className="text-xs text-muted-foreground">Commission Ready</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#f3f4f6' }}>
                <XCircle size={20} style={{ color: '#6b7280' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{cancelledBookings.length}</p>
                <p className="text-xs text-muted-foreground">Cancelled</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#FFC3BC', opacity: 0.5 }}>
                <Bell size={20} style={{ color: '#414141' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{unreadNotifs.length}</p>
                <p className="text-xs text-muted-foreground">Notifications</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent notifications */}
      {unreadNotifs.length > 0 && (
        <Card className="border-l-4" style={{ borderLeftColor: '#02E6D2' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Bell size={16} style={{ color: '#02E6D2' }} />
              Recent Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {unreadNotifs.slice(0, 5).map((n) => (
              <div key={n.id} className="flex items-start gap-3 text-sm">
                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#70FFE8' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-foreground">{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(n.createdAt), "dd MMM yyyy, HH:mm")}
                  </p>
                </div>
                {n.bookingId && (
                  <Link href={`/bookings/${n.bookingId}`}>
                    <Button variant="ghost" size="sm" className="text-xs h-6 px-2">View</Button>
                  </Link>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Commission Claim placeholder */}
      <Card className="border-dashed border-2" style={{ borderColor: '#70FFE8' }}>
        <CardContent className="py-6 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: '#70FFE8' }}>
            <TrendingUp size={20} style={{ color: '#414141' }} />
          </div>
          <h3 className="font-semibold text-foreground">Commission Claims</h3>
          <p className="text-sm text-muted-foreground mt-1">Coming soon — you'll be able to submit commission claims directly from here.</p>
          <Badge className="mt-3" style={{ background: '#FFF6ED', color: '#414141' }}>Coming Soon</Badge>
        </CardContent>
      </Card>

      {/* Bookings table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#70FFE8' }} />
            </div>
          ) : bookings.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen size={40} className="mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No bookings yet.</p>
              <Link href="/bookings/new">
                <Button className="mt-4" style={{ background: '#70FFE8', color: '#414141' }}>Register your first booking</Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-semibold text-muted-foreground">Client</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden sm:table-cell">Departure</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden md:table-cell">Topdog Ref</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Status</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden lg:table-cell">Commission</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bookings.map((booking) => {
                    const badge = STAGE_BADGE[booking.currentStage] ?? { label: booking.currentStage, color: "#414141", bg: "#f3f4f6" };
                    return (
                      <tr key={booking.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 font-medium">{booking.clientName}</td>
                        <td className="py-3 text-muted-foreground hidden sm:table-cell">
                          {format(new Date(booking.departureDate), "dd MMM yyyy")}
                        </td>
                        <td className="py-3 text-muted-foreground hidden md:table-cell">
                          {booking.topdogRef ?? <span className="text-muted-foreground/50 italic">Not set</span>}
                        </td>
                        <td className="py-3">
                          <span
                            className="inline-block px-2 py-1 rounded-full text-xs font-medium"
                            style={{ background: badge.bg, color: badge.color }}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-3 hidden lg:table-cell">
                          {booking.expectedCommission ? (
                            <span className="font-medium">£{Number(booking.expectedCommission).toFixed(2)}</span>
                          ) : (
                            <span className="text-muted-foreground/50 italic text-xs">Not set</span>
                          )}
                        </td>
                        <td className="py-3">
                          <Link href={`/bookings/${booking.id}`}>
                            <Button variant="ghost" size="sm" className="text-xs h-7">View</Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
