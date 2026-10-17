import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { AGENT_HOME_TILES, countAgentBookingActions, type AgentHomeTileKey } from "@shared/agent-home";
import { Link } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  BookOpen,
  Building2,
  Calculator,
  Calendar,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock,
  ExternalLink,
  GraduationCap,
  Library,
  MessageSquare,
  Newspaper,
  Rocket,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { format } from "date-fns";

type TileTone = "mint" | "peach" | "lavender" | "sky";

const HOME_TILE_ICONS: Record<AgentHomeTileKey, React.ElementType> = {
  academy: GraduationCap,
  knowledge_base: Library,
  webinars: Calendar,
  suppliers: Building2,
  bookings: BookOpen,
  commissions: Wallet,
  community: Users,
  pricing: Calculator,
};

function HomeNavigationTile({
  title,
  description,
  icon: Icon,
  href,
  tone = "mint",
  comingSoon = false,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  href?: string;
  tone?: TileTone;
  comingSoon?: boolean;
}) {
  const tones = {
    mint: { background: "#f0fffb", border: "#a7f3e8", icon: "#047857" },
    peach: { background: "#fff7ed", border: "#fed7aa", icon: "#c2410c" },
    lavender: { background: "#f5f3ff", border: "#ddd6fe", icon: "#6d28d9" },
    sky: { background: "#eff6ff", border: "#bfdbfe", icon: "#1d4ed8" },
  } as const;
  const selectedTone = tones[tone];
  const content = (
    <div
      className={`group relative h-full rounded-2xl border p-4 text-left transition-all ${href ? "hover:-translate-y-0.5 hover:shadow-md" : "cursor-default"}`}
      style={{ background: selectedTone.background, borderColor: selectedTone.border }}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm" style={{ color: selectedTone.icon }}>
          <Icon size={19} />
        </div>
        <div className="min-w-0 flex-1 pr-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-bold text-foreground">{title}</h3>
            {comingSoon && <span className="rounded-full bg-[#70FFE8] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#414141]">Coming soon</span>}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        {href ? <ChevronRight size={18} className="mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" /> : <Clock size={16} className="mt-1 shrink-0 text-muted-foreground" />}
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default function AgentDashboard() {
  const { user } = useAuth();
  const { data: bookings = [] } = trpc.bookings.myBookings.useQuery();
  const { data: notifications = [] } = trpc.notifications.myNotifications.useQuery();
  const { data: missingDocItems = [] } = trpc.reimbursements.myBookingsWithMissingDocs.useQuery();
  const { data: flightRequests = [] } = trpc.flightRequests.myRequests.useQuery();
  const { data: topUpRequests = [] } = trpc.commissionClaims.myTopUpRequests.useQuery();
  const { data: unconfirmedUpdates = [], refetch: refetchUnconfirmed } = trpc.community.unconfirmedUpdates.useQuery();
  const { data: communityPosts = [] } = trpc.community.dashboardPosts.useQuery();
  const { data: unansweredThreads = [] } = trpc.notes.myUnansweredThreads.useQuery(undefined, { staleTime: 60_000 });
  const { data: myProfile } = trpc.crm.agentCrm.getMyProfile.useQuery();
  const confirmPost = trpc.community.confirm.useMutation({ onSuccess: () => refetchUnconfirmed() });
  const openOrbit = trpc.sso.generateToken.useMutation();

  const firstName = user?.name?.split(" ")[0] || "there";
  const commissionClaimable = bookings.filter((booking) => booking.currentStage === "Commission Claimable");
  const bookingQueries = bookings.filter((booking) => ["Query", "Reimb Docs Missing"].includes(booking.currentStage));
  const requiresPtsAction = bookings.filter(
    (booking) => booking.currentStage === "Creating own PTS file" && (!booking.ptsRef || !booking.finalSupplierPaymentDate),
  );
  const flightQueries = flightRequests.filter((request) => request.status === "query");
  const unreadNotifications = notifications.filter((notification) => !notification.isRead);
  const bookingActionCount = countAgentBookingActions({
    bookingQueries: bookingQueries.length,
    ptsActions: requiresPtsAction.length,
    missingDocuments: missingDocItems.length,
    flightQueries: flightQueries.length,
    topUps: topUpRequests.length,
  });

  const actionPreview = useMemo(() => [
    ...bookingQueries.map((booking) => ({ bookingId: booking.id, clientName: booking.clientName, label: "Booking query needs your reply" })),
    ...requiresPtsAction.map((booking) => ({ bookingId: booking.id, clientName: booking.clientName, label: "PTS details still needed" })),
    ...missingDocItems.map((item: any) => ({ bookingId: item.bookingId, clientName: item.clientName ?? `Booking #${item.bookingId}`, label: `${item.supplierName} document needed` })),
    ...flightQueries.map((request) => ({ bookingId: request.bookingId, clientName: request.clientName ?? `Booking #${request.bookingId}`, label: "Flight request query needs your reply" })),
    ...topUpRequests.map((request: any) => ({ bookingId: request.bookingId, clientName: request.booking?.clientName ?? "Commission file", label: "Top-up required before commission can be paid" })),
  ].slice(0, 4), [bookingQueries, requiresPtsAction, missingDocItems, flightQueries, topUpRequests]);

  const featuredPost = communityPosts[0] as any | undefined;
  const smallerPosts = (communityPosts as any[]).slice(1, 4);
  const upcomingItem = (communityPosts as any[]).find((post) => ["Events", "Training & Webinars"].includes(post.category)) ?? null;

  const handleOpenOrbit = async () => {
    try {
      const { ssoUrl } = await openOrbit.mutateAsync();
      window.open(ssoUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not open Orbit. Please try again.");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#059669]">Your JLT home</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">Welcome back, {firstName}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Everything you need to stay up to date, get support and make the most of your JLT membership.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {myProfile?.orbitEnabled && (
            <Button onClick={handleOpenOrbit} disabled={openOrbit.isPending} className="gap-2 bg-[#70FFE8] font-semibold text-[#414141] hover:bg-[#54ead4]">
              <ExternalLink size={15} />
              {openOrbit.isPending ? "Opening Orbit..." : "Open Orbit"}
            </Button>
          )}
          <Link href="/my-bookings">
            <Button variant="outline" className="gap-2 font-semibold"><BookOpen size={15} /> My bookings</Button>
          </Link>
          <Link href="/messages">
            <Button variant="outline" className="gap-2 font-semibold"><MessageSquare size={15} /> Message support</Button>
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground">Your attention</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">The things most worth looking at today.</p>
          </div>
          {bookingActionCount === 0 && unconfirmedUpdates.length === 0 && commissionClaimable.length === 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} /> All caught up</span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/community">
            <Card className={`h-full border-l-4 transition-shadow hover:shadow-md ${unconfirmedUpdates.length > 0 ? "border-l-amber-500" : "border-l-slate-300"}`}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-xl bg-amber-100 p-2 text-amber-700"><Bell size={18} /></div>
                <div className="min-w-0 flex-1"><p className="text-2xl font-bold">{unconfirmedUpdates.length}</p><p className="text-xs font-medium text-muted-foreground">Business update{unconfirmedUpdates.length === 1 ? "" : "s"} to read</p></div>
                <ChevronRight size={17} className="text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/my-bookings">
            <Card className={`h-full border-l-4 transition-shadow hover:shadow-md ${bookingActionCount > 0 ? "border-l-orange-500" : "border-l-slate-300"}`}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-xl bg-orange-100 p-2 text-orange-700"><AlertCircle size={18} /></div>
                <div className="min-w-0 flex-1"><p className="text-2xl font-bold">{bookingActionCount}</p><p className="text-xs font-medium text-muted-foreground">Booking action{bookingActionCount === 1 ? "" : "s"} to review</p></div>
                <ChevronRight size={17} className="text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/commissions">
            <Card className={`h-full border-l-4 transition-shadow hover:shadow-md ${commissionClaimable.length > 0 ? "border-l-[#02E6D2]" : "border-l-slate-300"}`}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700"><Sparkles size={18} /></div>
                <div className="min-w-0 flex-1"><p className="text-2xl font-bold">{commissionClaimable.length}</p><p className="text-xs font-medium text-muted-foreground">Commission{commissionClaimable.length === 1 ? "" : "s"} ready to claim</p></div>
                <ChevronRight size={17} className="text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/messages">
            <Card className={`h-full border-l-4 transition-shadow hover:shadow-md ${unansweredThreads.length > 0 ? "border-l-violet-500" : "border-l-slate-300"}`}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-xl bg-violet-100 p-2 text-violet-700"><MessageSquare size={18} /></div>
                <div className="min-w-0 flex-1"><p className="text-2xl font-bold">{unansweredThreads.length}</p><p className="text-xs font-medium text-muted-foreground">Message{unansweredThreads.length === 1 ? "" : "s"} to reply to</p></div>
                <ChevronRight size={17} className="text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </section>

      {unconfirmedUpdates.length > 0 && (
        <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 shadow-sm">
          <div className="mb-3 flex items-start gap-3">
            <div className="rounded-xl bg-amber-200 p-2 text-amber-800"><AlertCircle size={18} /></div>
            <div><h2 className="font-bold text-amber-900">Important business update{unconfirmedUpdates.length === 1 ? "" : "s"}</h2><p className="mt-0.5 text-sm text-amber-800">Please read and confirm these updates so nothing is missed.</p></div>
          </div>
          <div className="grid gap-2">
            {(unconfirmedUpdates as any[]).slice(0, 3).map((update) => (
              <div key={update.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white/90 p-3">
                <div className="min-w-0"><p className="text-sm font-semibold text-foreground">{update.title}</p><p className="mt-0.5 text-xs text-muted-foreground">Posted {format(new Date(update.createdAt), "d MMMM")}</p></div>
                <div className="flex gap-2"><Link href={`/community?postId=${update.id}`}><Button size="sm" variant="outline">Read</Button></Link><Button size="sm" onClick={() => confirmPost.mutate({ postId: update.id })} disabled={confirmPost.isPending} className="bg-amber-500 text-white hover:bg-amber-600"><CheckCircle2 size={14} className="mr-1" />Confirm</Button></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-[#FFF6ED]/65 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div><CardTitle className="flex items-center gap-2 text-base"><Newspaper size={17} className="text-[#c2410c]" /> What&apos;s happening at JLT</CardTitle><p className="mt-1 text-sm font-normal text-muted-foreground">Business news, supplier updates, agent wins and what&apos;s coming up.</p></div>
              <Link href="/community"><Button variant="ghost" size="sm" className="gap-1 text-xs">View all <ArrowRight size={13} /></Button></Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {featuredPost ? (
              <Link href={`/community?postId=${featuredPost.id}`}>
                <div className="border-b p-5 transition-colors hover:bg-muted/35">
                  <span className="inline-flex rounded-full bg-[#70FFE8]/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#065f46]">{featuredPost.category ?? "JLT update"}</span>
                  <h3 className="mt-3 text-lg font-bold text-foreground">{featuredPost.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">Posted {format(new Date(featuredPost.createdAt), "d MMMM yyyy")}</p>
                </div>
              </Link>
            ) : (
              <div className="p-5 text-sm text-muted-foreground">New JLT updates will appear here.</div>
            )}
            {smallerPosts.length > 0 && <div className="divide-y">{smallerPosts.map((post) => <Link key={post.id} href={`/community?postId=${post.id}`}><div className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/35"><span className="text-lg">{post.category === "Agent Win" ? "🏆" : post.category === "Events" ? "🎉" : post.category === "Supplier News & Deals" ? "✈️" : "📢"}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{post.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{post.category} · {format(new Date(post.createdAt), "d MMM")}</p></div><ChevronRight size={16} className="text-muted-foreground" /></div></Link>)}</div>}
          </CardContent>
        </Card>

        <Card className="border-[#a7f3e8] bg-[#f0fffb]">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CircleHelp size={17} className="text-[#047857]" /> Need a hand?</CardTitle></CardHeader>
          <CardContent className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">Your JLT support team is here when you need advice on a booking, process or next step.</p><Link href="/messages"><Button className="w-full gap-2 bg-[#70FFE8] font-semibold text-[#414141] hover:bg-[#54ead4]"><MessageSquare size={15} /> Message support</Button></Link><Link href="/my-bookings"><Button variant="outline" className="w-full gap-2 border-[#a7f3e8] bg-white/70"><BookOpen size={15} /> Find a booking or make a request</Button></Link></CardContent>
        </Card>
      </section>

      <section>
        <div className="mb-3"><h2 className="text-base font-bold text-foreground">Explore your portal</h2><p className="mt-0.5 text-sm text-muted-foreground">Training, tools, supplier support and the places to grow your business.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {AGENT_HOME_TILES.map(({ key, ...tile }) => (
            <HomeNavigationTile key={key} {...tile} icon={HOME_TILE_ICONS[key]} />
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><AlertCircle size={17} className={bookingActionCount > 0 ? "text-orange-600" : "text-emerald-600"} /> Files requiring your attention</CardTitle></CardHeader>
          <CardContent>
            {actionPreview.length > 0 ? <div className="space-y-2">{actionPreview.map((item, index) => <Link key={`${item.bookingId}-${index}`} href={`/bookings/${item.bookingId}`}><div className="flex items-center gap-3 rounded-xl border border-orange-100 bg-orange-50/60 p-3 transition-colors hover:bg-orange-50"><div className="rounded-lg bg-orange-100 p-1.5 text-orange-700"><AlertCircle size={15} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{item.clientName}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.label}</p></div><ChevronRight size={16} className="text-muted-foreground" /></div></Link>)}<Link href="/my-bookings"><Button variant="ghost" size="sm" className="mt-1 gap-1 px-0 text-xs">View all booking actions <ArrowRight size={13} /></Button></Link></div> : <div className="rounded-xl bg-emerald-50 p-4"><div className="flex items-center gap-2 text-emerald-800"><CheckCircle2 size={18} /><p className="font-semibold">No booking actions are waiting for you.</p></div><p className="mt-1 text-sm text-emerald-700">We&apos;ll keep this area up to date whenever a file needs your input.</p></div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Rocket size={17} className="text-[#047857]" /> Coming up</CardTitle></CardHeader>
          <CardContent>
            {upcomingItem ? <Link href={`/community?postId=${upcomingItem.id}`}><div className="flex items-start gap-3 rounded-xl border border-[#a7f3e8] bg-[#f0fffb] p-4 transition-colors hover:bg-[#e5fff9]"><div className="rounded-xl bg-white p-2 text-[#047857]"><Calendar size={18} /></div><div className="min-w-0 flex-1"><span className="text-[10px] font-bold uppercase tracking-wide text-[#047857]">{upcomingItem.category}</span><p className="mt-1 text-sm font-bold text-foreground">{upcomingItem.title}</p><p className="mt-1 text-xs text-muted-foreground">Open to view details and save the date.</p></div><ChevronRight size={16} className="mt-1 text-muted-foreground" /></div></Link> : <Link href="/events"><div className="flex items-start gap-3 rounded-xl border border-[#a7f3e8] bg-[#f0fffb] p-4 transition-colors hover:bg-[#e5fff9]"><div className="rounded-xl bg-white p-2 text-[#047857]"><Calendar size={18} /></div><div className="min-w-0 flex-1"><p className="text-sm font-bold text-foreground">Events and webinars</p><p className="mt-1 text-xs text-muted-foreground">Watch this space for new JLT sessions, events and business-building opportunities.</p></div><ChevronRight size={16} className="mt-1 text-muted-foreground" /></div></Link>}
          </CardContent>
        </Card>
      </section>

      {myProfile?.orbitEnabled && <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#a7f3e8] bg-[#f0fffb] px-5 py-4"><div className="flex min-w-0 items-center gap-3"><div className="rounded-xl bg-white p-2 text-[#047857]"><ExternalLink size={17} /></div><div><p className="text-sm font-bold text-foreground">Orbit is your live booking system</p><p className="mt-0.5 text-xs text-muted-foreground">Use Orbit to make and manage live bookings. Use this Portal for support, requests and your JLT resources.</p></div></div><Button onClick={handleOpenOrbit} disabled={openOrbit.isPending} variant="outline" className="shrink-0 border-[#70FFE8] bg-white">{openOrbit.isPending ? "Opening..." : "Open Orbit"}</Button></div>}

      {unreadNotifications.length > 0 && <p className="text-center text-xs text-muted-foreground">You also have {unreadNotifications.length} unread notification{unreadNotifications.length === 1 ? "" : "s"} in the bell at the top of the page.</p>}
    </div>
  );
}
