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
  Calendar, ChevronRight, AlertCircle, CheckCircle2, Clock,
  Sparkles, Filter, Plane, Zap, RefreshCw, FileText,
  ArrowRight, Banknote, Activity, ReceiptText, Edit3, RotateCcw, Wallet,
  ShieldAlert, Newspaper, Users, Heart
} from "lucide-react";
import { format, differenceInDays, isPast, isWithinInterval, addDays } from "date-fns";

const STAGE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  "New Booking":          { label: "New",              color: "#414141", bg: "#FFF6ED" },
  "Creating own PTS file":{ label: "Creating PTS",     color: "#414141", bg: "#e0e7ff" },
  "Incomplete Booking":        { label: "Incomplete Booking",    color: "#92400e", bg: "#fef3c7" },
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

const ATTENTION_STAGES = new Set(["Query", "Reimb Docs Missing"]);

const STATUS_FILTERS = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Needs Action", value: "attention" },
  { label: "Commission Ready", value: "commission" },
  { label: "Cancelled", value: "cancelled" },
];

function flightStatusLabel(status: string) {
  if (status === "pending") return { label: "Pending", color: "#92400e", bg: "#fef3c7" };
  if (status === "ticketed") return { label: "Ticketed", color: "#065f46", bg: "#d1fae5" };
  if (status === "cancelled") return { label: "Cancelled", color: "#6b7280", bg: "#f3f4f6" };
  if (status === "query") return { label: "Query", color: "#991b1b", bg: "#fee2e2" };
  return { label: status, color: "#414141", bg: "#f3f4f6" };
}

export default function AgentDashboard() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bookedFrom, setBookedFrom] = useState("");
  const [bookedTo, setBookedTo] = useState("");
  const [bookingTab, setBookingTab] = useState<"active" | "completed">("active");
  const [sortBy, setSortBy] = useState<"departure" | "booked" | "commission">("departure");
  const [filterYear, setFilterYear] = useState<string>("");

  const { data: bookings = [], isLoading } = trpc.bookings.myBookings.useQuery();
  const { data: notifications = [] } = trpc.notifications.myNotifications.useQuery();
  const { data: missingDocItems = [] } = trpc.reimbursements.myBookingsWithMissingDocs.useQuery();
  const { data: flightRequests = [] } = trpc.flightRequests.myRequests.useQuery();
  const { data: earnings } = trpc.commissionClaims.myEarningsSummary.useQuery();
  const { data: outstandingSummary } = trpc.reimbursements.agentOutstandingSummary.useQuery();
  const { data: topUpRequests = [] } = trpc.commissionClaims.myTopUpRequests.useQuery();
  const { data: missingGrossData } = trpc.bookings.countMissingGrossData.useQuery();
  const { data: teamInviteStatus } = trpc.join.getMyTeamInviteStatus.useQuery();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const utils = trpc.useUtils();
  const agentSendInvite = trpc.join.agentSendTeamInvite.useMutation({
    onSuccess: () => {
      setInviteSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setInviteError("");
      utils.join.getMyTeamInviteStatus.invalidate();
    },
    onError: (err) => {
      setInviteError(err.message ?? "Failed to send invite");
    },
  });

  const handleAgentInvite = () => {
    setInviteError("");
    setInviteSuccess("");
    if (!inviteEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
      setInviteError("Please enter a valid email address");
      return;
    }
    agentSendInvite.mutate({ invitedEmail: inviteEmail, origin: window.location.origin });
  };

  // Community hub data
  const { data: unconfirmedUpdates = [], refetch: refetchUnconfirmed } = trpc.community.unconfirmedUpdates.useQuery();
  const { data: communityPosts = [] } = trpc.community.dashboardPosts.useQuery();
  const confirmPost = trpc.community.confirm.useMutation({
    onSuccess: () => refetchUnconfirmed(),
  });

  const now = new Date();
  const next30Days = addDays(now, 30);

  // A booking is "completed" when commission has been claimed AND departure is in the past
  const isCompleted = (b: typeof bookings[0]) =>
    b.currentStage === "Commission Claimed" && isPast(new Date(b.departureDate));

  const activeBookings = bookings.filter((b) => b.currentStage !== "Cancelled" && !isCompleted(b));
  const completedBookings = bookings.filter(isCompleted);
  const cancelledBookings = bookings.filter((b) => b.currentStage === "Cancelled");
  const commissionClaimable = bookings.filter((b) => b.currentStage === "Commission Claimable");
  const needsAttention = bookings.filter((b) => ATTENTION_STAGES.has(b.currentStage));
  const unreadNotifs = notifications.filter((n) => !n.isRead);

  // Bookings in "Creating own PTS file" that still need PTS ref or payment date
  const requiresPtsAction = bookings.filter(
    (b) => b.currentStage === "Creating own PTS file" && (!b.ptsRef || !b.finalSupplierPaymentDate)
  );

  // Flight requests with query status
  const flightQueries = flightRequests.filter((r) => r.status === "query");

  // Pre-auth eligible: bookings with commission set, not yet claimed, not cancelled
  const preAuthEligible = bookings.filter(
    (b) =>
      b.expectedCommission &&
      !(b as any).commissionPreAuthorised &&
      b.currentStage !== "Commission Claimed" &&
      b.currentStage !== "Cancelled"
  );

  // Upcoming departures in next 30 days
  const upcomingDepartures = bookings
    .filter((b) => {
      if (b.currentStage === "Cancelled") return false;
      const dep = new Date(b.departureDate);
      return isWithinInterval(dep, { start: now, end: next30Days });
    })
    .sort((a, b) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());

  // Total actions required count
  const totalActionsRequired =
    needsAttention.length +
    requiresPtsAction.length +
    missingDocItems.length +
    flightQueries.length;

  // Derive available years from completed bookings for the year filter
  const completedYears = useMemo(() => {
    const years = new Set(completedBookings.map((b) => new Date(b.departureDate).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [completedBookings]);

  const filteredBookings = useMemo(() => {
    let list = bookingTab === "completed" ? completedBookings : activeBookings;

    if (bookingTab === "active") {
      if (statusFilter === "attention") list = list.filter((b) => ATTENTION_STAGES.has(b.currentStage));
      else if (statusFilter === "commission") list = list.filter((b) => b.currentStage === "Commission Claimable");
      else if (statusFilter === "cancelled") list = list.filter((b) => b.currentStage === "Cancelled");
    }

    if (filterYear) {
      list = list.filter((b) => new Date(b.departureDate).getFullYear() === Number(filterYear));
    }
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
    // Sort
    return [...list].sort((a, b) => {
      if (sortBy === "commission") return Number(b.expectedCommission ?? 0) - Number(a.expectedCommission ?? 0);
      if (sortBy === "booked") return new Date(b.bookedDate ?? 0).getTime() - new Date(a.bookedDate ?? 0).getTime();
      // Default: departure — active = soonest first, completed = most recent first
      const dir = bookingTab === "completed" ? -1 : 1;
      return dir * (new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());
    });
  }, [bookings, bookingTab, activeBookings, completedBookings, statusFilter, search, bookedFrom, bookedTo, sortBy, filterYear]);

  return (
    <div className="space-y-6">
      {/* ── Business Update Action Required Banner ─────────────────────────── */}
      {unconfirmedUpdates.length > 0 && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-500 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <h3 className="font-semibold text-amber-800 dark:text-amber-300 text-sm">
              Action Required — {unconfirmedUpdates.length} Business Update{unconfirmedUpdates.length !== 1 ? "s" : ""} to Confirm
            </h3>
          </div>
          <div className="space-y-2">
            {(unconfirmedUpdates as any[]).map((update) => (
              <div key={update.id} className="flex items-start justify-between gap-3 bg-white dark:bg-amber-900/20 rounded-lg px-3 py-2.5 border border-amber-200 dark:border-amber-700">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{update.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Posted {new Date(update.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link href={`/community?postId=${update.id}`}>
                    <Button variant="outline" size="sm" className="text-xs h-7 px-2.5">Read</Button>
                  </Link>
                  <Button
                    size="sm"
                    className="text-xs h-7 px-2.5 bg-amber-500 hover:bg-amber-600 text-white border-0"
                    onClick={() => confirmPost.mutate({ postId: update.id })}
                    disabled={confirmPost.isPending}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Confirm
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Team Member Invite Banner ─────────────────────────────────────── */}
      {teamInviteStatus?.isTeam && teamInviteStatus.remainingSlots > 0 && (
        <div className="rounded-xl border-2 border-[#70FFE8] bg-[#f0fffb] dark:bg-[#0a2e2a] dark:border-[#70FFE8]/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#059669] shrink-0" />
            <h3 className="font-semibold text-[#065f46] dark:text-[#70FFE8] text-sm">
              Invite Your Team {teamInviteStatus.remainingSlots === 1 ? "Member" : "Members"}
            </h3>
            <span className="ml-auto text-xs bg-[#70FFE8] text-[#414141] font-semibold px-2 py-0.5 rounded-full">
              {teamInviteStatus.remainingSlots} slot{teamInviteStatus.remainingSlots !== 1 ? "s" : ""} remaining
            </span>
          </div>
          <p className="text-sm text-[#065f46] dark:text-[#70FFE8]/80">
            You signed up as a {teamInviteStatus.maxMembers === 2 ? "Duo" : "Trio"} — send an invitation to your team member{teamInviteStatus.maxMembers > 2 ? "s" : ""}. They'll sign their own contract at no extra cost.
          </p>
          {/* Already sent invites */}
          {teamInviteStatus.invitesSent.length > 0 && (
            <div className="space-y-1">
              {teamInviteStatus.invitesSent.map((inv) => (
                <div key={inv.email} className="flex items-center gap-2 text-xs">
                  {inv.status === "accepted" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#059669]" />
                  ) : inv.expired ? (
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                  )}
                  <span className="text-muted-foreground">{inv.email}</span>
                  <span className={`font-medium ${
                    inv.status === "accepted" ? "text-[#059669]" :
                    inv.expired ? "text-red-400" : "text-amber-600"
                  }`}>
                    {inv.status === "accepted" ? "Joined" : inv.expired ? "Expired" : "Invite sent"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* Invite form */}
          <div className="flex gap-2">
            <Input
              placeholder="teammate@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAgentInvite()}
              className={`bg-white dark:bg-white/10 ${inviteError ? "border-red-400" : "border-[#70FFE8]"}`}
            />
            <Button
              onClick={handleAgentInvite}
              disabled={agentSendInvite.isPending}
              style={{ background: "#70FFE8", color: "#414141" }}
              className="shrink-0 font-semibold"
            >
              {agentSendInvite.isPending ? <RefreshCw className="animate-spin w-4 h-4" /> : "Send Invite"}
            </Button>
          </div>
          {inviteError && <p className="text-xs text-red-500">{inviteError}</p>}
          {inviteSuccess && (
            <div className="flex items-center gap-1.5 text-xs text-[#059669] font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> {inviteSuccess}
            </div>
          )}
        </div>
      )}

      {/* ── What's New in Community ─────────────────────────────────────────── */}
      {communityPosts.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm text-foreground">What's New</h3>
            </div>
            <Link href="/community">
              <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground">
                View all <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="space-y-1.5">
            {(communityPosts as any[]).slice(0, 4).map((post) => (
              <Link key={post.id} href={`/community?postId=${post.id}`}>
                <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                  <span className="text-base shrink-0">
                    {post.category === "Agent Win" ? "🏆" :
                     post.category === "JLT Stay & Story" ? "⭐" :
                     post.category === "Supplier News & Deals" ? "✈️" :
                     post.category === "Events" ? "🎉" :
                     post.category === "Training & Webinars" ? "🎓" :
                     post.category === "Mindset" ? "💡" :
                     post.category === "First Class Lounge" ? "👑" : "📢"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{post.title}</p>
                    <p className="text-xs text-muted-foreground">{post.category} · {new Date(post.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Welcome back, {user?.name?.split(" ")[0]} 👋
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {format(now, "EEEE, d MMMM yyyy")}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/flight-requests">
            <Button variant="outline" className="font-semibold gap-2 shadow-sm text-sm">
              <Plane size={15} />
              Flight Request
            </Button>
          </Link>
          <Link href="/bookings/new">
            <Button style={{ background: '#70FFE8', color: '#414141' }} className="font-semibold gap-2 shadow-sm text-sm">
              <Plus size={15} />
              Register Booking
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Two-column layout ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── LEFT COLUMN (2/3 width) ──────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => setStatusFilter("active")}
              className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "active" ? "border-[#70FFE8] shadow-sm" : "border-transparent"}`}
              style={{ background: '#FFF6ED' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <BookOpen size={15} style={{ color: '#02E6D2' }} />
                <span className="text-xs text-muted-foreground font-medium">Active</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: '#414141' }}>{activeBookings.length}</p>
            </button>

            <button
              onClick={() => setStatusFilter("attention")}
              className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "attention" ? "border-[#f97316] shadow-sm" : "border-transparent"}`}
              style={{ background: totalActionsRequired > 0 ? '#fff7ed' : '#f9fafb' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle size={15} style={{ color: totalActionsRequired > 0 ? '#f97316' : '#9ca3af' }} />
                <span className="text-xs text-muted-foreground font-medium">Actions</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: totalActionsRequired > 0 ? '#f97316' : '#414141' }}>
                {totalActionsRequired}
              </p>
            </button>

            <button
              onClick={() => setStatusFilter("commission")}
              className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "commission" ? "border-[#02E6D2] shadow-sm" : "border-transparent"}`}
              style={{ background: '#ecfdf5' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={15} style={{ color: '#02E6D2' }} />
                <span className="text-xs text-muted-foreground font-medium">Claimable</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: '#065f46' }}>{commissionClaimable.length}</p>
            </button>

            <div
              className="text-left rounded-xl p-4 border-2 border-transparent"
              style={{ background: '#f9fafb' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Bell size={15} style={{ color: unreadNotifs.length > 0 ? '#f97316' : '#9ca3af' }} />
                <span className="text-xs text-muted-foreground font-medium">Unread</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: '#414141' }}>{unreadNotifs.length}</p>
            </div>
          </div>

          {/* Bookings list */}
          <Card>
            <CardHeader className="pb-3">
              {/* Tab switcher */}
              <div className="flex items-center gap-1 mb-3">
                <button
                  onClick={() => { setBookingTab("active"); setStatusFilter("all"); setFilterYear(""); }}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
                    bookingTab === "active" ? "text-[#414141]" : "text-muted-foreground hover:bg-muted"
                  }`}
                  style={bookingTab === "active" ? { background: '#70FFE8' } : {}}
                >
                  Active
                  <span className="ml-1.5 text-xs font-bold opacity-70">({activeBookings.length})</span>
                </button>
                <button
                  onClick={() => { setBookingTab("completed"); setStatusFilter("all"); }}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
                    bookingTab === "completed" ? "text-[#414141]" : "text-muted-foreground hover:bg-muted"
                  }`}
                  style={bookingTab === "completed" ? { background: '#a7f3d0', color: '#064e3b' } : {}}
                >
                  Completed
                  <span className="ml-1.5 text-xs font-bold opacity-70">({completedBookings.length})</span>
                </button>
              </div>

              {/* Filter row */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
                {/* Search */}
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search bookings..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8 text-sm w-full sm:w-44"
                  />
                </div>

                {/* Departure year filter */}
                <div className="flex items-center gap-1.5">
                  <Filter size={12} className="text-muted-foreground flex-shrink-0" />
                  <span className="text-xs text-muted-foreground">Year:</span>
                  <select
                    value={filterYear}
                    onChange={(e) => setFilterYear(e.target.value)}
                    className="h-8 text-xs border border-input rounded-md px-2 bg-background text-foreground"
                  >
                    <option value="">All</option>
                    {(bookingTab === "completed" ? completedYears : Array.from(new Set(activeBookings.map((b) => new Date(b.departureDate).getFullYear()))).sort((a, b) => a - b)).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>

                {/* Sort */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Sort:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="h-8 text-xs border border-input rounded-md px-2 bg-background text-foreground"
                  >
                    <option value="departure">Departure</option>
                    <option value="booked">Booked date</option>
                    <option value="commission">Commission ↓</option>
                  </select>
                </div>

                {/* Booked date range */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Booked:</span>
                  <Input type="date" value={bookedFrom} onChange={(e) => setBookedFrom(e.target.value)} className="h-8 text-xs w-28" title="Booked from" />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input type="date" value={bookedTo} onChange={(e) => setBookedTo(e.target.value)} className="h-8 text-xs w-28" title="Booked to" />
                </div>

                {/* Active-only status pills */}
                {bookingTab === "active" && (
                  <div className="flex gap-1 flex-wrap">
                    {STATUS_FILTERS.filter((f) => f.value !== "all" && f.value !== "active").map((f) => (
                      <button
                        key={f.value}
                        onClick={() => setStatusFilter(statusFilter === f.value ? "all" : f.value)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                          statusFilter === f.value ? "text-[#414141]" : "text-muted-foreground hover:bg-muted"
                        }`}
                        style={statusFilter === f.value ? { background: '#70FFE8' } : {}}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Clear all filters */}
                {(search || bookedFrom || bookedTo || filterYear || statusFilter !== "all") && (
                  <button
                    onClick={() => { setSearch(""); setBookedFrom(""); setBookedTo(""); setFilterYear(""); setStatusFilter("all"); }}
                    className="text-xs underline text-muted-foreground hover:text-foreground ml-auto"
                  >
                    Clear all
                  </button>
                )}
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
                      <button onClick={() => { setStatusFilter("all"); setSearch(""); setFilterYear(""); setBookedFrom(""); setBookedTo(""); }}
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
                    const daysUntilDeparture = differenceInDays(new Date(booking.departureDate), now);
                    const departed = isPast(new Date(booking.departureDate));
                    const needsAction = ATTENTION_STAGES.has(booking.currentStage);
                    const isUrgent = !departed && daysUntilDeparture <= 14;

                    return (
                      <Link key={booking.id} href={`/bookings/${booking.id}`}>
                        <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all hover:shadow-sm cursor-pointer ${
                          needsAction ? "border-orange-200" : isUrgent ? "border-amber-200" : "border-border hover:border-[#70FFE8]/50"
                        }`}
                          style={{ background: needsAction ? '#fff7ed' : isUrgent ? '#fffbeb' : 'white' }}>
                          {/* Status dot */}
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ background: badge.bg === "#f3f4f6" ? "#9ca3af" : badge.color }} />

                          {/* Main info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm truncate">{booking.clientName}</p>
                              {needsAction && (
                                <AlertCircle size={12} style={{ color: '#f97316' }} className="flex-shrink-0" />
                              )}
                              {isUrgent && !needsAction && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                                  style={{ background: '#fef3c7', color: '#92400e' }}>
                                  {daysUntilDeparture}d
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar size={10} />
                                {departed ? "Departed" : `${daysUntilDeparture}d`} — {format(new Date(booking.departureDate), "dd MMM yyyy")}
                              </span>
                              {(booking as any).bookedDate && (
                                <span className="text-xs text-muted-foreground">
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

        {/* ── RIGHT COLUMN (1/3 width) ─────────────────────────────────────── */}
        <div className="space-y-5">

          {/* ── Outstanding Items panel ─────────────────────────────────── */}
          <OutstandingItemsPanel
            needsAttention={needsAttention}
            requiresPtsAction={requiresPtsAction}
            missingDocItems={missingDocItems}
            flightQueries={flightQueries}
            outstandingSummary={outstandingSummary}
          />

          {/* Files in Minus alert */}
          {topUpRequests.length > 0 && (
            <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
              style={{ borderLeftColor: '#ef4444', background: '#fef2f2' }}>
              <AlertCircle size={16} style={{ color: '#ef4444' }} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: '#991b1b' }}>
                  Action required: {topUpRequests.length} file{topUpRequests.length > 1 ? 's' : ''} in minus
                </p>
                <p className="text-xs mt-0.5 opacity-80" style={{ color: '#991b1b' }}>
                  Please top up your account and notify JLT once done.
                </p>
              </div>
              <Link href="/commissions">
                <button className="text-xs font-semibold underline flex-shrink-0" style={{ color: '#991b1b' }}>
                  View
                </button>
              </Link>
            </div>
          )}

          {/* Commission Ready banner */}
          {commissionClaimable.length > 0 && (
            <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
              style={{ borderLeftColor: '#02E6D2', background: '#ecfdf5' }}>
              <Sparkles size={16} style={{ color: '#02E6D2' }} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: '#065f46' }}>
                  {commissionClaimable.length} commission{commissionClaimable.length > 1 ? "s" : ""} ready to claim!
                </p>
                <p className="text-xs mt-0.5 opacity-70" style={{ color: '#065f46' }}>
                  {commissionClaimable.map((b) => b.clientName).join(", ")}
                </p>
              </div>
              <Link href="/commissions">
                <button className="text-xs font-semibold underline flex-shrink-0" style={{ color: '#065f46' }}>
                  Claim
                </button>
              </Link>
            </div>
          )}

          {/* Missing Gross Selling Price alert */}
          {missingGrossData && missingGrossData.count > 0 && (
            <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
              style={{ borderLeftColor: '#f59e0b', background: '#fffbeb' }}>
              <TrendingUp size={16} style={{ color: '#d97706' }} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: '#92400e' }}>
                  {missingGrossData.count} booking{missingGrossData.count > 1 ? 's' : ''} missing pricing data
                </p>
                <p className="text-xs mt-0.5 opacity-80" style={{ color: '#92400e' }}>
                  Add your gross selling price and commission to include {missingGrossData.count > 1 ? 'them' : 'it'} in your margin report.
                </p>
              </div>
              <Link href="/my-margin">
                <button className="text-xs font-semibold underline flex-shrink-0" style={{ color: '#92400e' }}>
                  View report
                </button>
              </Link>
            </div>
          )}

          {/* Friends & Family Voucher Balance */}
          <FnfVoucherCard />

          {/* Earnings Summary */}
          {earnings && earnings.grandTotal > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Banknote size={15} style={{ color: '#02E6D2' }} />
                  My Earnings
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {/* Grand total */}
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <span className="text-xs font-semibold text-foreground">Total commissions</span>
                  <span className="text-base font-bold" style={{ color: '#02E6D2' }}>
                    £{earnings.grandTotal.toFixed(2)}
                  </span>
                </div>
                {/* Breakdown rows — only show non-zero buckets */}
                {earnings.paidTotal > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                      Paid
                    </span>
                    <span className="text-xs font-semibold text-emerald-600">£{earnings.paidTotal.toFixed(2)}</span>
                  </div>
                )}
                {earnings.awaitingPaymentTotal > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-400"></span>
                      Awaiting payment
                    </span>
                    <span className="text-xs font-semibold text-amber-600">£{earnings.awaitingPaymentTotal.toFixed(2)}</span>
                  </div>
                )}
                {earnings.processingTotal > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-400"></span>
                      Processing
                    </span>
                    <span className="text-xs font-semibold text-blue-600">£{earnings.processingTotal.toFixed(2)}</span>
                  </div>
                )}
                {earnings.claimableTotal > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#02E6D2' }}></span>
                      Ready to claim
                    </span>
                    <span className="text-xs font-semibold" style={{ color: '#02E6D2' }}>£{earnings.claimableTotal.toFixed(2)}</span>
                  </div>
                )}
                {earnings.pendingTotal > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-gray-400"></span>
                      Pending
                    </span>
                    <span className="text-xs font-semibold text-muted-foreground">£{earnings.pendingTotal.toFixed(2)}</span>
                  </div>
                )}
                <Link href="/commissions">
                  <button className="text-xs font-semibold underline w-full text-left pt-1" style={{ color: '#02E6D2' }}>
                    View all commissions →
                  </button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Commission Pre-Auth banner */}
          {preAuthEligible.length > 0 && (
            <div className="rounded-xl border p-4 flex items-start gap-3" style={{ background: '#fffbeb', borderColor: '#fcd34d' }}>
              <Zap size={16} className="shrink-0 mt-0.5" style={{ color: '#92400e' }} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: '#92400e' }}>
                  Commission Pre-Authorisation
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#92400e', opacity: 0.85 }}>
                  Enable pre-auth on {preAuthEligible.length} booking{preAuthEligible.length > 1 ? "s" : ""} to let JLT auto-process your commission when ready — no manual claim needed.
                </p>
                <Link href="/commissions">
                  <button className="text-xs font-semibold underline mt-1.5" style={{ color: '#92400e' }}>
                    Set up pre-auth →
                  </button>
                </Link>
              </div>
            </div>
          )}

          {/* Upcoming Departures */}
          {upcomingDepartures.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Plane size={15} style={{ color: '#02E6D2' }} />
                  Upcoming Departures
                  <span className="ml-auto text-xs font-normal text-muted-foreground">Next 30 days</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {upcomingDepartures.slice(0, 5).map((b) => {
                  const daysLeft = differenceInDays(new Date(b.departureDate), now);
                  const isUrgent = daysLeft <= 14;
                  return (
                    <Link key={b.id} href={`/bookings/${b.id}`}>
                      <div className={`flex items-center justify-between rounded-lg px-3 py-2 border hover:shadow-sm transition-shadow cursor-pointer ${isUrgent ? 'border-amber-200 bg-amber-50' : 'border-border bg-card'}`}>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: isUrgent ? '#92400e' : '#414141' }}>
                            {b.clientName}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {format(new Date(b.departureDate), "dd MMM")} — {daysLeft}d
                          </p>
                        </div>
                        {isUrgent && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ml-2"
                            style={{ background: '#fef3c7', color: '#92400e' }}>
                            Soon
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
                {upcomingDepartures.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    +{upcomingDepartures.length - 5} more
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Recent Flight Requests */}
          {flightRequests.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Plane size={15} style={{ color: '#02E6D2' }} />
                  Flight Requests
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {flightRequests.slice(0, 4).map((r) => {
                  const st = flightStatusLabel(r.status);
                  return (
                    <Link key={r.id} href={`/bookings/${r.bookingId}`}>
                      <div className="flex items-center justify-between rounded-lg border px-3 py-2 hover:shadow-sm transition-shadow cursor-pointer bg-card">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: '#414141' }}>{r.clientName}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 capitalize">{r.requestType} · {r.supplier}</p>
                        </div>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ml-2"
                          style={{ background: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                      </div>
                    </Link>
                  );
                })}
                <Link href="/flight-requests">
                  <button className="text-xs font-semibold underline w-full text-left mt-1" style={{ color: '#02E6D2' }}>
                    View all flight requests →
                  </button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Recent Notifications */}
          {unreadNotifs.length > 0 && (
            <Card className="border-l-4" style={{ borderLeftColor: '#FFC3BC' }}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Bell size={14} style={{ color: '#FFC3BC' }} />
                  Notifications
                  <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#FFC3BC', color: '#414141' }}>
                    {unreadNotifs.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {unreadNotifs.slice(0, 3).map((n) => (
                  <div key={n.id} className="flex items-start gap-2 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#FFC3BC' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground leading-snug">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {format(new Date(n.createdAt), "dd MMM, HH:mm")}
                      </p>
                    </div>
                    {n.bookingId && (
                      <Link href={`/bookings/${n.bookingId}`}>
                        <button className="text-[10px] font-semibold underline flex-shrink-0 mt-0.5" style={{ color: '#02E6D2' }}>View</button>
                      </Link>
                    )}
                  </div>
                ))}
                {unreadNotifs.length > 3 && (
                  <Link href="/notifications">
                    <button className="text-xs font-semibold underline w-full text-left mt-1" style={{ color: '#02E6D2' }}>
                      View all notifications →
                    </button>
                  </Link>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Outstanding Items Panel ──────────────────────────────────────────────────
type OutstandingSummary = {
  reimbursements: { id: number; bookingId: number; clientName: string | null; supplierName: string; amount: string | null; status: string; isLate: boolean }[];
  amendments: { id: number; bookingId: number; clientName: string | null; pipelineStage: string; createdAt: Date }[];
  refunds: { id: number; bookingId: number; clientName: string | null; pipelineStage: string; createdAt: Date }[];
  flightRequests: { id: number; bookingId: number; clientName: string | null; requestType: string; supplier: string; status: string; queryMessage: string | null; ticketingDeadline: Date | null; createdAt: Date }[];
};

function OutstandingItemsPanel({
  needsAttention,
  requiresPtsAction,
  missingDocItems,
  flightQueries,
  outstandingSummary,
}: {
  needsAttention: any[];
  requiresPtsAction: any[];
  missingDocItems: any[];
  flightQueries: any[];
  outstandingSummary?: OutstandingSummary;
}) {
  const [expanded, setExpanded] = useState<string | null>("urgent");

  const urgentItems = [
    ...needsAttention.map((b) => ({ type: "booking_query" as const, bookingId: b.id, clientName: b.clientName, label: b.currentStage === "Query" ? "Query — reply needed" : "Docs missing", urgent: true })),
    ...requiresPtsAction.map((b) => ({ type: "pts_action" as const, bookingId: b.id, clientName: b.clientName, label: [!b.ptsRef && "PTS ref missing", !b.finalSupplierPaymentDate && "Payment date missing"].filter(Boolean).join(" · "), urgent: true })),
    ...missingDocItems.map((item: any) => ({ type: "missing_doc" as const, bookingId: item.bookingId, clientName: item.clientName ?? `Booking #${item.bookingId}`, label: `${item.supplierName} — upload doc`, urgent: true })),
    ...(outstandingSummary?.flightRequests.filter((r) => r.status === "query") ?? []).map((r) => ({ type: "flight_query" as const, bookingId: r.bookingId, clientName: r.clientName, label: `Flight query — ${r.queryMessage?.slice(0, 40) ?? ""}`, urgent: true })),
  ];

  const reimbItems = outstandingSummary?.reimbursements ?? [];
  const pendingReimb = reimbItems.filter((r) => r.status === "pending");
  const scheduledReimb = reimbItems.filter((r) => r.status === "scheduled");
  const amendmentItems = outstandingSummary?.amendments ?? [];
  const refundItems = outstandingSummary?.refunds ?? [];
  const pendingFlights = (outstandingSummary?.flightRequests ?? []).filter((r) => r.status !== "query");

  const totalUrgent = urgentItems.length;
  const totalReimb = reimbItems.length;
  const totalAmendments = amendmentItems.length;
  const totalRefunds = refundItems.length;
  const totalFlights = pendingFlights.length;
  const grandTotal = totalUrgent + totalReimb + totalAmendments + totalRefunds + totalFlights;

  if (grandTotal === 0) {
    return (
      <div className="rounded-xl border p-4 flex items-center gap-3" style={{ background: '#ecfdf5', borderColor: '#6ee7b7' }}>
        <CheckCircle2 size={18} style={{ color: '#059669' }} className="flex-shrink-0" />
        <div>
          <p className="font-semibold text-sm" style={{ color: '#065f46' }}>All clear!</p>
          <p className="text-xs mt-0.5" style={{ color: '#065f46', opacity: 0.75 }}>No outstanding items right now.</p>
        </div>
      </div>
    );
  }

  const Section = ({ id, icon, title, count, color, bg, borderColor, children }: {
    id: string; icon: React.ReactNode; title: string; count: number;
    color: string; bg: string; borderColor: string; children: React.ReactNode;
  }) => {
    if (count === 0) return null;
    const isOpen = expanded === id;
    return (
      <div className="rounded-xl border overflow-hidden" style={{ borderColor }}>
        <button
          onClick={() => setExpanded(isOpen ? null : id)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors hover:opacity-90"
          style={{ background: bg }}
        >
          <div className="flex items-center gap-2">
            <span style={{ color }}>{icon}</span>
            <span className="text-xs font-semibold" style={{ color }}>{title}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: color, color: 'white' }}>{count}</span>
            <ChevronRight size={12} style={{ color, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
          </div>
        </button>
        {isOpen && (
          <div className="divide-y divide-border bg-card">
            {children}
          </div>
        )}
      </div>
    );
  };

  const Row = ({ href, primary, secondary, badge }: { href: string; primary: string; secondary: string; badge?: React.ReactNode }) => (
    <Link href={href}>
      <div className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors cursor-pointer">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate text-foreground">{primary}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{secondary}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          {badge}
          <ChevronRight size={12} className="text-muted-foreground" />
        </div>
      </div>
    </Link>
  );

  return (
    <Card className="border-2" style={{ borderColor: totalUrgent > 0 ? '#f97316' : '#e5e7eb' }}>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Activity size={15} style={{ color: totalUrgent > 0 ? '#f97316' : '#6b7280' }} />
          <span style={{ color: totalUrgent > 0 ? '#92400e' : '#374151' }}>My Outstanding Items</span>
          <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: totalUrgent > 0 ? '#f97316' : '#6b7280', color: 'white' }}>
            {grandTotal}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">

        {/* Urgent / Action Required */}
        {totalUrgent > 0 && (
          <Section id="urgent" icon={<AlertCircle size={13} />} title="Action Required" count={totalUrgent} color="#dc2626" bg="#fef2f2" borderColor="#fca5a5">
            {urgentItems.map((item, i) => (
              <Row
                key={i}
                href={`/bookings/${item.bookingId}`}
                primary={item.clientName ?? `Booking #${item.bookingId}`}
                secondary={item.label}
                badge={<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#fee2e2', color: '#dc2626' }}>Urgent</span>}
              />
            ))}
          </Section>
        )}

        {/* Reimbursements */}
        {totalReimb > 0 && (
          <Section id="reimb" icon={<Wallet size={13} />} title="Reimbursements" count={totalReimb} color="#d97706" bg="#fffbeb" borderColor="#fcd34d">
            {pendingReimb.length > 0 && (
              <div className="px-3 py-1.5 bg-amber-50">
                <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Pending ({pendingReimb.length})</p>
              </div>
            )}
            {pendingReimb.map((r) => (
              <Row
                key={r.id}
                href={`/bookings/${r.bookingId}`}
                primary={r.clientName ?? `Booking #${r.bookingId}`}
                secondary={`${r.supplierName}${r.amount ? ` · £${Number(r.amount).toFixed(2)}` : ''}`}
                badge={r.isLate ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Late</span> : undefined}
              />
            ))}
            {scheduledReimb.length > 0 && (
              <div className="px-3 py-1.5 bg-amber-50">
                <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Scheduled ({scheduledReimb.length})</p>
              </div>
            )}
            {scheduledReimb.map((r) => (
              <Row
                key={r.id}
                href={`/bookings/${r.bookingId}`}
                primary={r.clientName ?? `Booking #${r.bookingId}`}
                secondary={`${r.supplierName}${r.amount ? ` · £${Number(r.amount).toFixed(2)}` : ''} · Scheduled`}
              />
            ))}
          </Section>
        )}

        {/* Amendments */}
        {totalAmendments > 0 && (
          <Section id="amendments" icon={<Edit3 size={13} />} title="Amendments" count={totalAmendments} color="#7c3aed" bg="#f5f3ff" borderColor="#c4b5fd">
            {amendmentItems.map((a) => (
              <Row
                key={a.id}
                href={`/bookings/${a.bookingId}`}
                primary={a.clientName ?? `Booking #${a.bookingId}`}
                secondary={a.pipelineStage}
                badge={<span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: '#ede9fe', color: '#7c3aed' }}>{a.pipelineStage}</span>}
              />
            ))}
          </Section>
        )}

        {/* Refunds */}
        {totalRefunds > 0 && (
          <Section id="refunds" icon={<RotateCcw size={13} />} title="Refunds" count={totalRefunds} color="#0891b2" bg="#ecfeff" borderColor="#a5f3fc">
            {refundItems.map((r) => (
              <Row
                key={r.id}
                href={`/bookings/${r.bookingId}`}
                primary={r.clientName ?? `Booking #${r.bookingId}`}
                secondary={r.pipelineStage}
                badge={<span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: '#cffafe', color: '#0891b2' }}>{r.pipelineStage}</span>}
              />
            ))}
          </Section>
        )}

        {/* Flight Requests */}
        {totalFlights > 0 && (
          <Section id="flights" icon={<Plane size={13} />} title="Flight Requests" count={totalFlights} color="#059669" bg="#ecfdf5" borderColor="#6ee7b7">
            {pendingFlights.map((r) => (
              <Row
                key={r.id}
                href={`/bookings/${r.bookingId}`}
                primary={r.clientName ?? `Booking #${r.bookingId}`}
                secondary={`${r.requestType} · ${r.supplier}`}
                badge={<span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full capitalize" style={{ background: '#d1fae5', color: '#065f46' }}>{r.status}</span>}
              />
            ))}
          </Section>
        )}

      </CardContent>
    </Card>
  );
}

// ─── Friends & Family Voucher Balance Card ────────────────────────────────────
function FnfVoucherCard() {
  const { data, isLoading } = trpc.fnf.getBalance.useQuery();

  if (isLoading) return null;
  if (!data || !data.hasAllocation) return null;

  const renewsAt = data.renewsAt ? new Date(data.renewsAt) : null;
  const daysUntilRenewal = renewsAt ? differenceInDays(renewsAt, new Date()) : null;

  const dots = Array.from({ length: data.totalGranted }, (_, i) => i < data.used);

  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: '#fce7f3' }}>
              <Heart size={13} style={{ color: '#db2777' }} />
            </div>
            <span className="text-sm font-bold text-foreground">Friends &amp; Family Vouchers</span>
          </div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: data.remaining > 0 ? '#dcfce7' : '#fee2e2', color: data.remaining > 0 ? '#166534' : '#991b1b' }}>
            {data.remaining} remaining
          </span>
        </div>

        <div className="flex items-center gap-2 mb-3">
          {dots.map((used, i) => (
            <div
              key={i}
              className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all"
              style={{
                borderColor: used ? '#d1d5db' : '#db2777',
                background: used ? '#f3f4f6' : '#fce7f3',
                color: used ? '#9ca3af' : '#db2777',
              }}
            >
              {used ? '✓' : '♥'}
            </div>
          ))}
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>
            <span className="font-medium">{data.used}</span> of <span className="font-medium">{data.totalGranted}</span> used this period
          </p>
          {renewsAt && (
            <p>
              Renews <span className="font-medium">{format(renewsAt, "d MMM yyyy")}</span>
              {daysUntilRenewal !== null && daysUntilRenewal > 0 && (
                <span className="text-muted-foreground"> ({daysUntilRenewal} days)</span>
              )}
            </p>
          )}
          <p className="text-[10px] mt-1 opacity-70">Allows selling at NET rate — PTS fees must still be covered</p>
        </div>
      </div>
    </Card>
  );
}
