import { useMemo } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Eye, EyeOff, ExternalLink, MapPin, PlaneTakeoff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function asDateInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount === null) return null;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency ?? "GBP", maximumFractionDigits: 0 }).format(amount);
}

export default function MyHolidayShowcases() {
  const utils = trpc.useUtils();
  const { data: showcases = [], isLoading } = trpc.consumerSite.showcases.mine.useQuery();
  const setPublished = trpc.consumerSite.showcases.setPublished.useMutation({
    onSuccess: () => { utils.consumerSite.showcases.mine.invalidate(); toast.success("Holiday showcase visibility updated."); },
    onError: (error) => toast.error(error.message),
  });
  const setExpiry = trpc.consumerSite.showcases.setExpiry.useMutation({
    onSuccess: () => { utils.consumerSite.showcases.mine.invalidate(); toast.success("Expiry date updated."); },
    onError: (error) => toast.error(error.message),
  });
  const reorder = trpc.consumerSite.showcases.reorder.useMutation({
    onSuccess: () => utils.consumerSite.showcases.mine.invalidate(),
    onError: (error) => toast.error(error.message),
  });
  const remove = trpc.consumerSite.showcases.remove.useMutation({
    onSuccess: () => { utils.consumerSite.showcases.mine.invalidate(); toast.success("Holiday showcase removed from the website."); },
    onError: (error) => toast.error(error.message),
  });
  const active = useMemo(() => showcases.filter((showcase) => !showcase.deletedAt), [showcases]);

  const move = (id: number, direction: -1 | 1) => {
    const index = active.findIndex((item) => item.id === id);
    const replacement = index + direction;
    if (index < 0 || replacement < 0 || replacement >= active.length) return;
    const ordered = [...active];
    [ordered[index], ordered[replacement]] = [ordered[replacement], ordered[index]];
    reorder.mutate({ ids: ordered.map((item) => item.id) });
  };

  return <div className="mx-auto max-w-6xl space-y-7 p-4 md:p-6">
    <section className="overflow-hidden rounded-3xl bg-[#102632] px-6 py-8 text-white shadow-sm sm:px-9">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#70ffe8]"><PlaneTakeoff size={15} /> Portal-owned snapshots</p><h1 className="mt-3 font-serif text-4xl tracking-[-.04em] sm:text-5xl">My Holiday Showcases</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Create an itinerary in Orbit, then choose <strong className="text-white">Create public showcase</strong>. The finished snapshot appears here for you to publish, hide, reorder, expire or remove.</p></div><div className="rounded-2xl bg-white/10 px-5 py-4"><p className="text-xs text-slate-300">Currently visible</p><p className="mt-1 font-serif text-4xl text-[#70ffe8]">{active.filter((item) => item.isPublished && (!item.expiresAt || new Date(item.expiresAt) > new Date())).length}</p></div></div>
    </section>

    <section className="rounded-2xl border border-[#bdebe3] bg-[#effbf8] p-5 text-sm leading-6 text-[#315d59]">
      <strong className="text-[#102632]">How this works:</strong> Orbit sends one safe, public-only copy of the itinerary to the Portal. Nothing on this page reads live pricing or availability from Orbit. If a holiday changes, create a new public showcase in Orbit rather than editing this snapshot.
    </section>

    {isLoading ? <div className="grid gap-5 md:grid-cols-2">{[1, 2].map((item) => <div key={item} className="h-72 animate-pulse rounded-3xl bg-slate-100" />)}</div> : active.length === 0 ? <section className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><PlaneTakeoff className="mx-auto text-[#008e81]" size={32} /><h2 className="mt-5 font-serif text-3xl text-[#102632]">No holiday showcases yet.</h2><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#64747d]">Your public holiday ideas begin in Orbit. When you create a public showcase there, it will appear here as a fixed snapshot ready to manage on your profile.</p></section> : <section className="grid gap-5 md:grid-cols-2">{active.map((showcase, index) => {
      const expired = showcase.expiresAt ? new Date(showcase.expiresAt) <= new Date() : false;
      const visible = showcase.isPublished && !expired;
      return <article key={showcase.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="relative h-44 bg-[#eafbf8]">{showcase.heroImageUrl ? <img src={showcase.heroImageUrl} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <div className="grid h-full place-items-center bg-[#102632] text-[#70ffe8]"><PlaneTakeoff size={30} /></div>}<span className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-semibold ${visible ? "bg-[#70ffe8] text-[#102632]" : "bg-white text-[#596971]"}`}>{expired ? "Expired" : visible ? "Visible" : "Hidden"}</span></div><div className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="inline-flex items-center gap-1 text-xs font-medium text-[#008e81]"><MapPin size={13} /> {showcase.destination}</p><h2 className="mt-2 font-serif text-2xl leading-tight text-[#102632]">{showcase.title}</h2></div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" disabled={index === 0 || reorder.isPending} aria-label="Move showcase up" onClick={() => move(showcase.id, -1)}><ArrowUp size={17} /></Button><Button variant="ghost" size="icon" disabled={index === active.length - 1 || reorder.isPending} aria-label="Move showcase down" onClick={() => move(showcase.id, 1)}><ArrowDown size={17} /></Button></div></div><p className="mt-3 text-sm text-[#64747d]">{showcase.durationNights ? `${showcase.durationNights} nights` : "Itinerary"}{showcase.travelPeriodLabel ? ` · ${showcase.travelPeriodLabel}` : ""}{formatMoney(showcase.priceAmount, showcase.priceCurrency) ? ` · From ${formatMoney(showcase.priceAmount, showcase.priceCurrency)} pp` : ""}</p><div className="mt-5 flex flex-wrap gap-2"><Button size="sm" variant={visible ? "outline" : "default"} disabled={setPublished.isPending} onClick={() => setPublished.mutate({ id: showcase.id, isPublished: !showcase.isPublished })}>{visible ? <><EyeOff size={15} className="mr-1.5" /> Hide</> : <><Eye size={15} className="mr-1.5" /> Show on website</>}</Button><a href={`/consumer/travel-agents/holiday-showcases/${showcase.publicSlug}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md px-2 text-sm font-medium text-[#007e72] hover:underline"><ExternalLink size={15} className="mr-1.5" /> Preview</a><Button size="sm" variant="ghost" className="ml-auto text-red-700 hover:bg-red-50 hover:text-red-800" disabled={remove.isPending} onClick={() => { if (window.confirm("Remove this showcase from the website? It cannot be restored; create a new one in Orbit if needed.")) remove.mutate({ id: showcase.id }); }}><Trash2 size={15} className="mr-1.5" /> Remove</Button></div><label className="mt-5 block border-t border-slate-100 pt-4 text-xs font-semibold text-[#52636c]"><span className="flex items-center gap-1.5"><CalendarClock size={14} /> Automatically hide after (optional)</span><Input type="date" defaultValue={asDateInput(showcase.expiresAt)} className="mt-2 max-w-[210px]" onBlur={(event) => { const date = event.target.value ? new Date(`${event.target.value}T23:59:59.999Z`) : null; if (asDateInput(showcase.expiresAt) !== event.target.value) setExpiry.mutate({ id: showcase.id, expiresAt: date }); }} /></label></div></article>;
    })}</section>}
  </div>;
}
