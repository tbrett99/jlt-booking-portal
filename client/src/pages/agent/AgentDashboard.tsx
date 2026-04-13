import { useState, useMemo } from "react";
import CopyableRef from "@/components/CopyableRef";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  BookOpen, XCircle, Bell, Plus, TrendingUp, Search,
  Calendar, ChevronRight, AlertCircle, CheckCircle2, Clock, Sparkles, Filter
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { format, differenceInDays, isPast } from "date-fns";

const STAGE_BADGE: Record<string, { label: string; color: string; bg: string; icon?: React.ReactNode }> = {
  "New Booking":          { label: "New",              color: "#414141", bg: "#FFF6ED" },
  "Creating own PTS file":{ label: "Creating PTS",     color: "#414141", bg: "#e0e7ff" },
  "Not on Topdog":        { label: "Not on Topdog",    color: "#92400e", bg: "#fef3c7" },
  "Query":                { label: "Query — Action Needed", color: "#92400e", bg: "#fef9c3" },
  "Reimb Docs Missing":   { label: "Docs Missing",     color: "#991b1b", bg: "#fee2e2" },
  "Urgent/Reimb":         { label: "Urgent",           color: "#991b1b", bg: "#fecaca" },
  "T/O Package":          { label: "T/O Package",      color: "#5b21b6", bg: "#ede9fe" },
  "DP":                   { label: "DP",               color: "#9d174d", bg: "#fce7f3" },
  "Added to PTS":         { label: "Added to PTS",     color: "#065f46", bg: "#d1fae5" },
  "Commission Claimable": { label: "Commission Ready", color: "#065f46", bg: "#70FFE8" },
  "Commission Claimed":   { label: "Commission Claimed", color: "#064e3b", bg: "#a7f3d0" },
  "Cancelled":            { label: "Cancelled",        color: "#6b7280", bg: "#f3f4f6" },
  "Holding Accounts":     { label: "Holding",          color: "#92400e", bg: "#fef3c7" },
};

// Only highlight bookings where agent genuinely needs to act
const ATTENTION_STAGES = new Set(["Query", "Reimb Docs Missing"]);

const STATUS_FILTERS = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Needs Action", value: "attention" },
  { label: "Commission Ready", value: "commission" },
  { label: "Cancelled", value: "cancelled" },
];

export default function AgentDashboard() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bookedFrom, setBookedFrom] = useState("");
  const [bookedTo, setBookedTo] = useState("");

  const { data: bookings = [], isLoading } = trpc.bookings.myBookings.useQuery();
  const { data: notifications = [] } = trpc.notifications.myNotifications.useQuery();
  const { data: missingDocItems = [] } = trpc.reimbursements.myBookingsWithMissingDocs.useQuery();

  const activeBookings = bookings.filter((b) => b.currentStage !== "Cancelled");
  const cancelledBookings = bookings.filter((b) => b.currentStage === "Cancelled");
  const commissionClaimable = bookings.filter((b) => b.currentStage === "Commission Claimable");
  const needsAttention = bookings.filter((b) => ATTENTION_STAGES.has(b.currentStage));
  const unreadNotifs = notifications.filter((n) => !n.isRead);
  // Bookings in "Creating own PTS file" that still need PTS ref or payment date
  const requiresAction = bookings.filter(
    (b) => b.currentStage === "Creating own PTS file" && (!b.ptsRef || !b.finalSupplierPaymentDate)
  );
  // Reimbursement items with no documents uploaded
  const totalNeedsAction = needsAttention.length + requiresAction.length + missingDocItems.length;

  const filteredBookings = useMemo(() => {
    let list = bookings;
    if (statusFilter === "active") list = list.filter((b) => b.currentStage !== "Cancelled");
    else if (statusFilter === "attention") list = list.filter((b) => ATTENTION_STAGES.has(b.currentStage));
    else if (statusFilter === "commission") list = list.filter((b) => b.currentStage === "Commission Claimable");
    else if (statusFilter === "cancelled") list = list.filter((b) => b.currentStage === "Cancelled");
    if (bookedFrom) {
      const from = new Date(bookedFrom);
      list = list.filter((b) => b.bookedDate && new Date(b.bookedDate) >= from);
    }
    if (bookedTo) {
      const to = new Date(bookedTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter((b) => b.bookedDate && new Date(b.bookedDate) <= to);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.clientName.toLowerCase().includes(q) ||
          (b.topdogRef ?? "").toLowerCase().includes(q) ||
          (b.ptsRef ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [bookings, statusFilter, search, bookedFrom, bookedTo]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Welcome back, {user?.name?.split(" ")[0]} 👋
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Here's everything happening with your bookings</p>
        </div>
        <Link href="/bookings/new">
          <Button style={{ background: '#70FFE8', color: '#414141' }} className="font-semibold gap-2 shadow-sm">
            <Plus size={16} />
            Register Booking
          </Button>
        </Link>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setStatusFilter("active")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "active" ? "border-[#70FFE8] shadow-sm" : "border-transparent"}`}
          style={{ background: '#FFF6ED' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <BookOpen size={16} style={{ color: '#02E6D2' }} />
            <span className="text-xs text-muted-foreground font-medium">Active</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: '#414141' }}>{activeBookings.length}</p>
        </button>

        <button
          onClick={() => setStatusFilter("attention")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "attention" ? "border-[#f97316] shadow-sm" : "border-transparent"}`}
          style={{ background: totalNeedsAction > 0 ? '#fff7ed' : '#f9fafb' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={16} style={{ color: totalNeedsAction > 0 ? '#f97316' : '#9ca3af' }} />
            <span className="text-xs text-muted-foreground font-medium">Needs Action</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: totalNeedsAction > 0 ? '#f97316' : '#414141' }}>
            {totalNeedsAction}
          </p>
        </button>

        <button
          onClick={() => setStatusFilter("commission")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "commission" ? "border-[#02E6D2] shadow-sm" : "border-transparent"}`}
          style={{ background: '#ecfdf5' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={16} style={{ color: '#02E6D2' }} />
            <span className="text-xs text-muted-foreground font-medium">Commission Ready</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: '#065f46' }}>{commissionClaimable.length}</p>
        </button>

        <button
          onClick={() => setStatusFilter("all")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "all" ? "border-[#70FFE8] shadow-sm" : "border-transparent"}`}
          style={{ background: '#f9fafb' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Bell size={16} style={{ color: unreadNotifs.length > 0 ? '#f97316' : '#9ca3af' }} />
            <span className="text-xs text-muted-foreground font-medium">Notifications</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: '#414141' }}>{unreadNotifs.length}</p>
        </button>
      </div>

      {/* Attention banner */}
      {needsAttention.length > 0 && (
        <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
          style={{ borderLeftColor: '#f97316', background: '#fff7ed' }}>
          <AlertCircle size={18} style={{ color: '#f97316' }} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm" style={{ color: '#92400e' }}>
              {needsAttention.length} booking{needsAttention.length > 1 ? "s" : ""} need{needsAttention.length === 1 ? "s" : ""} your attention
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#92400e', opacity: 0.8 }}>
              {needsAttention.map((b) => b.clientName).join(", ")}
            </p>
          </div>
          <button
            onClick={() => setStatusFilter("attention")}
            className="text-xs font-semibold underline flex-shrink-0"
            style={{ color: '#92400e' }}
          >
            View
          </button>
        </div>
      )}

      {/* Commission claimable banner */}
      {commissionClaimable.length > 0 && (
        <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
          style={{ borderLeftColor: '#02E6D2', background: '#ecfdf5' }}>
          <Sparkles size={18} style={{ color: '#02E6D2' }} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm" style={{ color: '#065f46' }}>
              You have {commissionClaimable.length} commission{commissionClaimable.length > 1 ? "s" : ""} ready to claim!
            </p>
            <p className="text-xs mt-0.5 opacity-70" style={{ color: '#065f46' }}>
              Go to My Commissions to submit your claim.
            </p>
          </div>
          <Link href="/commissions">
            <button className="text-xs font-semibold underline flex-shrink-0" style={{ color: '#065f46' }}>
              Claim Now
            </button>
          </Link>
        </div>
      )}

      {/* Bookings Requiring Action — Creating own PTS file */}
      {requiresAction.length > 0 && (
        <div className="rounded-xl border-2 p-4 space-y-3" style={{ borderColor: '#FFC3BC', background: '#FFF6ED' }}>
          <div className="flex items-center gap-2">
            <AlertCircle size={18} style={{ color: '#e11d48' }} />
            <p className="font-semibold text-sm" style={{ color: '#9f1239' }}>
              {requiresAction.length} booking{requiresAction.length > 1 ? "s" : ""} require{requiresAction.length === 1 ? "s" : ""} your action
            </p>
          </div>
          <p className="text-xs" style={{ color: '#9f1239', opacity: 0.85 }}>
            The following booking{requiresAction.length > 1 ? "s are" : " is"} in <strong>Creating own PTS file</strong> — please add the PTS reference and final supplier payment date so we can progress {requiresAction.length > 1 ? "them" : "it"} to Added to PTS.
          </p>
          <div className="space-y-2">
            {requiresAction.map((b) => (
              <Link key={b.id} href={`/bookings/${b.id}`}>
                <div className="flex items-center justify-between rounded-lg bg-white border px-3 py-2 hover:shadow-sm transition-shadow cursor-pointer">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: '#414141' }}>{b.clientName}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                      {!b.ptsRef && <span className="text-red-600 font-medium">PTS ref missing</span>}
                      {!b.finalSupplierPaymentDate && <span className="text-red-600 font-medium">Payment date missing</span>}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Reimbursement docs missing panel */}
      {missingDocItems.length > 0 && (
        <div className="rounded-xl border-2 p-4 space-y-3" style={{ borderColor: '#f59e0b', background: '#fffbeb' }}>
          <div className="flex items-center gap-2">
            <AlertCircle size={18} style={{ color: '#d97706' }} />
            <p className="font-semibold text-sm" style={{ color: '#92400e' }}>
              {missingDocItems.length} reimbursement{missingDocItems.length > 1 ? 's' : ''} need{missingDocItems.length === 1 ? 's' : ''} a document
            </p>
          </div>
          <p className="text-xs" style={{ color: '#92400e', opacity: 0.85 }}>
            Please upload a supporting document for each item below. The JLT team cannot process your reimbursement until a document is attached.
          </p>
          <div className="space-y-2">
            {missingDocItems.map((item: any) => (
              <Link key={item.id} href={`/bookings/${item.bookingId}`}>
                <div className="flex items-center justify-between rounded-lg bg-white border border-amber-200 px-3 py-2 hover:shadow-sm transition-shadow cursor-pointer">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: '#414141' }}>{item.clientName ?? `Booking #${item.bookingId}`}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.supplierName} — £{Number(item.amount).toFixed(2)}
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: '#fef3c7', color: '#92400e' }}>Upload doc</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent unread notifications */}
      {unreadNotifs.length > 0 && (
        <Card className="border-l-4" style={{ borderLeftColor: '#FFC3BC' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Bell size={16} style={{ color: '#FFC3BC' }} />
              Unread Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {unreadNotifs.slice(0, 3).map((n) => (
              <div key={n.id} className="flex items-start gap-3 text-sm">
                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#FFC3BC' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-foreground">{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(n.createdAt), "dd MMM yyyy, HH:mm")}
                  </p>
                </div>
                {n.bookingId && (
                  <Link href={`/bookings/${n.bookingId}`}>
                    <Button variant="ghost" size="sm" className="text-xs h-6 px-2 flex-shrink-0">View</Button>
                  </Link>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Bookings list */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <CardTitle className="text-base">Your Bookings</CardTitle>
            <div className="sm:ml-auto flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search bookings..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm w-full sm:w-52"
                />
              </div>
              {/* Booked date range filter */}
              <div className="flex items-center gap-1.5">
                <Filter size={13} className="text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground">Booked:</span>
                <Input
                  type="date"
                  value={bookedFrom}
                  onChange={(e) => setBookedFrom(e.target.value)}
                  className="h-8 text-xs w-32"
                  title="Booked from"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="date"
                  value={bookedTo}
                  onChange={(e) => setBookedTo(e.target.value)}
                  className="h-8 text-xs w-32"
                  title="Booked to"
                />
                {(bookedFrom || bookedTo) && (
                  <button
                    onClick={() => { setBookedFrom(""); setBookedTo(""); }}
                    className="text-xs underline text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex gap-1 flex-wrap">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setStatusFilter(f.value)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                      statusFilter === f.value
                        ? "text-[#414141]"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    style={statusFilter === f.value ? { background: '#70FFE8' } : {}}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#70FFE8' }} />
            </div>
          ) : filteredBookings.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen size={40} className="mx-auto text-muted-foreground mb-3 opacity-40" />
              {bookings.length === 0 ? (
                <>
                  <p className="font-medium text-foreground">No bookings yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Register your first booking to get started.</p>
                  <Link href="/bookings/new">
                    <Button className="mt-4" style={{ background: '#70FFE8', color: '#414141' }}>
                      Register a Booking
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <p className="font-medium text-foreground">No bookings match your filter</p>
                  <button onClick={() => { setStatusFilter("all"); setSearch(""); }}
                    className="text-sm underline mt-2" style={{ color: '#02E6D2' }}>
                    Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredBookings.map((booking) => {
                const badge = STAGE_BADGE[booking.currentStage] ?? { label: booking.currentStage, color: "#414141", bg: "#f3f4f6" };
                const daysUntilDeparture = differenceInDays(new Date(booking.departureDate), new Date());
                const departed = isPast(new Date(booking.departureDate));
                const needsAction = ATTENTION_STAGES.has(booking.currentStage);

                return (
                  <Link key={booking.id} href={`/bookings/${booking.id}`}>
                    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all hover:shadow-sm cursor-pointer ${
                      needsAction ? "border-orange-200" : "border-border hover:border-[#70FFE8]/50"
                    }`}
                      style={{ background: needsAction ? '#fff7ed' : 'white' }}>
                      {/* Status dot */}
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: badge.bg === "#f3f4f6" ? "#9ca3af" : badge.color }} />

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm truncate">{booking.clientName}</p>
                          {needsAction && (
                            <AlertCircle size={13} style={{ color: '#f97316' }} className="flex-shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Calendar size={10} />
                            {departed ? "Departed" : `${daysUntilDeparture}d`} — {format(new Date(booking.departureDate), "dd MMM yyyy")}
                          </span>
                          {(booking as any).bookedDate && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              Booked: {format(new Date((booking as any).bookedDate), "dd MMM yyyy")}
                            </span>
                          )}
                          {booking.topdogRef && (
                            <CopyableRef value={booking.topdogRef} label="Topdog ref" />
                          )}
                          {booking.ptsRef && (
                            <CopyableRef value={booking.ptsRef} label="PTS ref" />
                          )}
                          {(booking as any).destination && (
                            <span className="text-xs text-muted-foreground">{(booking as any).destination}</span>
                          )}
                        </div>
                      </div>

                      {/* Right: badge + commission + arrow */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {booking.expectedCommission && (
                          <span className="text-xs font-semibold hidden sm:block" style={{ color: '#02E6D2' }}>
                            £{Number(booking.expectedCommission).toFixed(0)}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium hidden sm:inline-block"
                          style={{ background: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                        <ChevronRight size={16} className="text-muted-foreground" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
