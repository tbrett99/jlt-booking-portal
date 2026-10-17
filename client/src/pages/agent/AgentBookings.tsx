import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { findAgentBookingMatches } from "@shared/agent-booking-centre";
import CopyableRef from "@/components/CopyableRef";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  Plane,
  Search,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";

const STAGE_BADGE: Record<string, { label: string; color: string; background: string }> = {
  "Query": { label: "Reply needed", color: "#9a3412", background: "#ffedd5" },
  "Reimb Docs Missing": { label: "Documents needed", color: "#991b1b", background: "#fee2e2" },
  "Commission Claimable": { label: "Commission ready", color: "#065f46", background: "#d1fae5" },
  "Commission Due for Payment": { label: "Due for payment", color: "#1d4ed8", background: "#dbeafe" },
  "Commission Paid": { label: "Commission paid", color: "#166534", background: "#dcfce7" },
  "Cancelled": { label: "Cancelled", color: "#6b7280", background: "#f3f4f6" },
};

function RequestAction({
  title,
  description,
  icon: Icon,
  href,
  tone,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  tone: "mint" | "violet" | "sky";
}) {
  const styles = {
    mint: { background: "#f0fffb", border: "#a7f3e8", icon: "#047857" },
    violet: { background: "#f5f3ff", border: "#ddd6fe", icon: "#6d28d9" },
    sky: { background: "#eff6ff", border: "#bfdbfe", icon: "#1d4ed8" },
  } as const;
  const style = styles[tone];
  return (
    <Link href={href}>
      <div className="group h-full rounded-2xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md" style={{ background: style.background, borderColor: style.border }}>
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-white/75 p-2.5" style={{ color: style.icon }}><Icon size={19} /></div>
          <div className="min-w-0 flex-1"><p className="text-sm font-bold text-foreground">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
          <ChevronRight size={17} className="mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

export default function AgentBookings() {
  const [search, setSearch] = useState("");
  const { data: bookings = [], isLoading } = trpc.bookings.myBookings.useQuery();
  const { data: missingDocItems = [] } = trpc.reimbursements.myBookingsWithMissingDocs.useQuery();
  const { data: flightRequests = [] } = trpc.flightRequests.myRequests.useQuery();
  const { data: topUpRequests = [] } = trpc.commissionClaims.myTopUpRequests.useQuery();
  const { data: myProfile } = trpc.crm.agentCrm.getMyProfile.useQuery();
  const openOrbit = trpc.sso.generateToken.useMutation();

  const bookingQueries = bookings.filter((booking) => ["Query", "Reimb Docs Missing"].includes(booking.currentStage));
  const requiresPtsAction = bookings.filter(
    (booking) => booking.currentStage === "Creating own PTS file" && (!booking.ptsRef || !booking.finalSupplierPaymentDate),
  );
  const flightQueries = flightRequests.filter((request) => request.status === "query");
  const matches = useMemo(() => findAgentBookingMatches(bookings, search), [bookings, search]);
  const actionItems = useMemo(() => [
    ...bookingQueries.map((booking) => ({ bookingId: booking.id, clientName: booking.clientName, description: "Booking query needs your reply", severity: "urgent" as const })),
    ...requiresPtsAction.map((booking) => ({ bookingId: booking.id, clientName: booking.clientName, description: "PTS details are still needed", severity: "urgent" as const })),
    ...missingDocItems.map((item: any) => ({ bookingId: item.bookingId, clientName: item.clientName ?? `Booking #${item.bookingId}`, description: `${item.supplierName} document needed`, severity: "urgent" as const })),
    ...flightQueries.map((request) => ({ bookingId: request.bookingId, clientName: request.clientName ?? `Booking #${request.bookingId}`, description: "Flight request query needs your reply", severity: "urgent" as const })),
    ...topUpRequests.map((request: any) => ({ bookingId: request.bookingId, clientName: request.booking?.clientName ?? "Commission file", description: "Top-up required before commission can be paid", severity: "notice" as const })),
  ], [bookingQueries, requiresPtsAction, missingDocItems, flightQueries, topUpRequests]);

  const handleOpenOrbit = async () => {
    try {
      const { ssoUrl } = await openOrbit.mutateAsync();
      window.open(ssoUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not open Orbit. Please try again.");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link href="/dashboard" className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft size={14} /> Back to JLT Home</Link>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Bookings &amp; requests</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Use Orbit to create and manage live bookings. Use this request centre when you need to find a file or ask the JLT team to help with an amendment, cancellation, flight or document.</p>
        </div>
        {myProfile?.orbitEnabled && <Button onClick={handleOpenOrbit} disabled={openOrbit.isPending} className="gap-2 bg-[#70FFE8] font-semibold text-[#414141] hover:bg-[#54ead4]"><ExternalLink size={15} />{openOrbit.isPending ? "Opening Orbit..." : "Open Orbit"}</Button>}
      </div>

      <section>
        <div className="mb-3"><h2 className="text-base font-bold text-foreground">What would you like to do?</h2><p className="mt-0.5 text-sm text-muted-foreground">Start a new request, or find an existing booking below.</p></div>
        <div className="grid gap-3 md:grid-cols-3">
          <RequestAction title="Request an amendment" description="Tell JLT about a change needed on an existing booking." icon={FileText} href="/request-amendment" tone="violet" />
          <RequestAction title="Request flights" description="Ask the team for help with a flight requirement." icon={Plane} href="/flight-requests" tone="sky" />
          <RequestAction title="Cancel a booking" description="Start a cancellation request with the correct booking details." icon={XCircle} href="/cancel-booking" tone="mint" />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="border-[#a7f3e8] shadow-sm">
          <CardHeader className="border-b bg-[#f0fffb]/65 pb-4"><CardTitle className="flex items-center gap-2 text-base"><Search size={18} className="text-[#047857]" /> Find a booking</CardTitle><p className="mt-1 text-sm font-normal text-muted-foreground">Search by traveller name, Topdog reference or PTS reference. Your booking list stays out of the way until you need it.</p></CardHeader>
          <CardContent className="p-5">
            <div className="relative"><Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 pl-10 text-sm" placeholder="Search a traveller or booking reference…" aria-label="Search my bookings" /></div>
            {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading your bookings…</div> : !search.trim() ? <div className="py-10 text-center"><Search size={28} className="mx-auto text-[#047857] opacity-55" /><p className="mt-3 text-sm font-semibold text-foreground">Search only when you need a file</p><p className="mt-1 text-sm text-muted-foreground">For live booking management, head straight to Orbit.</p></div> : matches.length === 0 ? <div className="py-10 text-center"><AlertCircle size={28} className="mx-auto text-muted-foreground opacity-50" /><p className="mt-3 text-sm font-semibold text-foreground">No matching booking found</p><p className="mt-1 text-sm text-muted-foreground">Try the traveller name, Topdog reference or PTS reference.</p></div> : <div className="mt-4 space-y-2">{matches.map((booking) => {
              const badge = STAGE_BADGE[booking.currentStage] ?? { label: booking.currentStage, color: "#374151", background: "#f3f4f6" };
              return <Link key={booking.id} href={`/bookings/${booking.id}`}><div className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:border-[#70FFE8] hover:bg-[#f0fffb]/45"><div className="rounded-lg bg-[#f0fffb] p-2 text-[#047857]"><FileText size={16} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-foreground">{booking.clientName}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{booking.topdogRef && <CopyableRef value={booking.topdogRef} label="Topdog ref" />}{booking.ptsRef && <CopyableRef value={booking.ptsRef} label="PTS ref" />}{booking.departureDate && <span>Departs {format(new Date(booking.departureDate), "d MMM yyyy")}</span>}</div></div><span className="hidden rounded-full px-2 py-0.5 text-[10px] font-bold sm:inline" style={{ background: badge.background, color: badge.color }}>{badge.label}</span><ChevronRight size={16} className="text-muted-foreground" /></div></Link>})}</div>}
          </CardContent>
        </Card>

        <Card className={actionItems.length > 0 ? "border-orange-200" : "border-emerald-200"}>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><AlertCircle size={18} className={actionItems.length > 0 ? "text-orange-600" : "text-emerald-600"} /> Your portal actions</CardTitle><p className="mt-1 text-sm font-normal text-muted-foreground">Only files where the Portal needs something from you.</p></CardHeader>
          <CardContent className="space-y-2">{actionItems.length === 0 ? <div className="rounded-xl bg-emerald-50 p-4"><div className="flex gap-2 text-emerald-800"><CheckCircle2 size={18} className="shrink-0" /><p className="text-sm font-semibold">Nothing is waiting for you right now.</p></div><p className="mt-1 text-sm text-emerald-700">We&apos;ll show action points here when your input is needed.</p></div> : actionItems.slice(0, 6).map((item, index) => <Link key={`${item.bookingId}-${index}`} href={`/bookings/${item.bookingId}`}><div className={`flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/30 ${item.severity === "urgent" ? "border-orange-100 bg-orange-50/60" : "border-amber-100 bg-amber-50/60"}`}><AlertCircle size={16} className={item.severity === "urgent" ? "text-orange-600" : "text-amber-600"} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{item.clientName}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p></div><ChevronRight size={16} className="text-muted-foreground" /></div></Link>)}</CardContent>
        </Card>
      </section>

      {actionItems.length > 6 && <p className="text-center text-sm text-muted-foreground">Use the search above to find and review your other files.</p>}
    </div>
  );
}
