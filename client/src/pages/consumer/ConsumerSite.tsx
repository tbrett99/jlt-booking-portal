import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { MapView } from "@/components/Map";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowRight, ChevronRight, Facebook, Globe2, HeartHandshake, Instagram, Landmark, Linkedin, Mail, MapPin, Menu, Music2, PinIcon, Search, ShieldCheck, Sparkles, UsersRound, X, Youtube } from "lucide-react";

const HERO_IMAGE = "/manus-storage/jlt-consumer-hero_c29aac69.jpg";

type Agent = {
  slug: string;
  displayName: string;
  businessName: string | null;
  biography: string;
  profilePhotoUrl: string | null;
  listingTown: string;
  townLatitude: number | null;
  townLongitude: number | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  youtubeUrl: string | null;
  pinterestUrl: string | null;
  tags: Array<{ id: number; label: string; category: "destination" | "travel_type" }>;
};

const NAV_ITEMS = [
  { label: "Find an agent", href: "/find-an-agent" },
  { label: "Why JLT", href: "/why-jlt" },
  { label: "Your protection", href: "/your-protection" },
  { label: "Partners", href: "/partners" },
];

function publicPrefix() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/consumer") ? "/consumer" : "";
}

function publicHref(path: string) {
  const prefix = publicPrefix();
  return `${prefix}${path === "/" ? "" : path}` || "/";
}

export default function ConsumerSite() {
  const prefix = publicPrefix();
  const [location] = useLocation();
  useEffect(() => {
    const publicPath = location.startsWith("/consumer") ? location.slice("/consumer".length) || "/" : location;
    const pageTitles: Record<string, string> = {
      "/": "The JLT Group | Travel, personally arranged",
      "/find-an-agent": "Find a JLT travel expert | The JLT Group",
      "/why-jlt": "Why book with JLT | The JLT Group",
      "/your-protection": "Your travel protection | The JLT Group",
      "/partners": "Travel partners | The JLT Group",
      "/privacy": "Privacy notice | The JLT Group",
      "/terms": "Website terms | The JLT Group",
    };
    document.title = publicPath.startsWith("/travel-agents/") ? "JLT travel expert | The JLT Group" : (pageTitles[publicPath] ?? "The JLT Group");
    const description = "Meet independent JLT travel experts and discover a more personal way to arrange your next trip.";
    let descriptionMeta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!descriptionMeta) { descriptionMeta = document.createElement("meta"); descriptionMeta.name = "description"; document.head.appendChild(descriptionMeta); }
    descriptionMeta.content = description;
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
    canonical.href = `https://www.thejltgroup.co.uk${publicPath === "/" ? "" : publicPath}`;
    let robots = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!robots) { robots = document.createElement("meta"); robots.name = "robots"; document.head.appendChild(robots); }
    robots.content = "index,follow";
  }, [location]);
  return <div className="min-h-screen bg-[#fcfcfa] text-[#13242f] font-sans">
    <ConsumerHeader />
    <main>
      <Switch>
        <Route path={`${prefix}/`} component={ConsumerHome} />
        <Route path={`${prefix}/find-an-agent`} component={FindAnAgent} />
        <Route path={`${prefix}/travel-agents/:slug`}>{({ slug }) => <AgentProfile slug={slug} />}</Route>
        <Route path={`${prefix}/why-jlt`} component={WhyJlt} />
        <Route path={`${prefix}/your-protection`} component={ProtectionPage} />
        <Route path={`${prefix}/partners`} component={PartnersPage} />
        <Route path={`${prefix}/privacy`} component={PrivacyPage} />
        <Route path={`${prefix}/terms`} component={PublicTermsPage} />
        <Route component={ConsumerNotFound} />
      </Switch>
    </main>
    <ConsumerFooter />
  </div>;
}

function ConsumerHeader() {
  const [open, setOpen] = useState(false);
  return <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#fcfcfa]/95 backdrop-blur">
    <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
      <Link href={publicHref("/")} className="group flex items-center gap-3 no-underline"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#102632] text-[#70ffe8] shadow-sm"><span className="text-base font-black tracking-tight">JLT</span></div><div><p className="font-semibold tracking-[-0.02em] text-[#102632] leading-none">The JLT Group</p><p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[#5f6e76]">Travel, personally arranged</p></div></Link>
      <nav className="hidden items-center gap-7 lg:flex">{NAV_ITEMS.map(item => <Link key={item.href} href={publicHref(item.href)} className="text-sm font-medium text-[#3c4e57] transition-colors hover:text-[#008e81]">{item.label}</Link>)}<Link href={publicHref("/find-an-agent")} className="rounded-full bg-[#102632] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1e3a48]">Find your expert</Link></nav>
      <button onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label="Toggle navigation" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-[#102632] lg:hidden">{open ? <X size={19} /> : <Menu size={20} />}</button>
    </div>
    {open && <nav className="border-t border-slate-200 bg-[#fcfcfa] px-5 py-4 lg:hidden"><div className="mx-auto grid max-w-7xl gap-1">{NAV_ITEMS.map(item => <Link onClick={() => setOpen(false)} key={item.href} href={publicHref(item.href)} className="rounded-lg px-3 py-3 text-sm font-medium text-[#334751] hover:bg-[#eafbf8]">{item.label}</Link>)}<Link onClick={() => setOpen(false)} href={publicHref("/find-an-agent")} className="mt-2 rounded-lg bg-[#102632] px-3 py-3 text-center text-sm font-medium text-white">Find your expert</Link></div></nav>}
  </header>;
}

function ConsumerHome() {
  const { data: agents = [] } = trpc.consumerSite.public.listAgents.useQuery();
  return <>
    <section className="relative isolate overflow-hidden bg-[#102632]">
      <img src={HERO_IMAGE} alt="A couple enjoying a Mediterranean coastal view" className="absolute inset-0 -z-20 h-full w-full object-cover opacity-60" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,27,37,.96)_0%,rgba(10,27,37,.82)_42%,rgba(10,27,37,.24)_100%)]" />
      <div className="mx-auto grid min-h-[610px] max-w-7xl content-center px-5 py-20 lg:grid-cols-[1.1fr_.9fr] lg:px-8 lg:py-24">
        <div className="max-w-2xl"><p className="inline-flex items-center gap-2 rounded-full border border-[#70ffe8]/30 bg-[#70ffe8]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[.15em] text-[#a6fff0]"><Sparkles size={14} /> Made for how you travel</p><h1 className="mt-6 font-serif text-5xl font-medium tracking-[-.045em] text-white sm:text-6xl lg:text-7xl">Travel should feel <em className="font-serif text-[#70ffe8]">entirely</em> yours.</h1><p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-200">Meet a JLT independent travel expert who takes the time to understand your wish list, then makes the details feel effortless.</p><div className="mt-9 flex flex-col gap-3 sm:flex-row"><Link href={publicHref("/find-an-agent")} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#70ffe8] px-6 py-3.5 font-semibold text-[#102632] transition hover:bg-white">Find your travel expert <ArrowRight size={17} /></Link><Link href={publicHref("/why-jlt")} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/35 px-6 py-3.5 font-semibold text-white transition hover:bg-white/10">Discover the JLT difference</Link></div></div>
      </div>
      <div className="border-t border-white/10"><div className="mx-auto grid max-w-7xl grid-cols-1 divide-y divide-white/10 px-5 text-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 lg:px-8"><TrustMetric icon={<UsersRound />} heading="Personal expertise" body="Independent experts who get to know the travel you want." /><TrustMetric icon={<ShieldCheck />} heading="Clearer confidence" body="Protection information explained for the booking you are making." /><TrustMetric icon={<HeartHandshake />} heading="Care beyond booking" body="A real person before, during, and after your trip." /></div></div>
    </section>
    <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28"><div className="grid items-end gap-8 lg:grid-cols-[1fr_.78fr]"><div><Eyebrow>One trusted introduction</Eyebrow><h2 className="mt-4 max-w-3xl font-serif text-4xl tracking-[-.04em] sm:text-5xl">Less searching. More looking forward.</h2></div><p className="max-w-xl text-base leading-relaxed text-[#51636d]">The JLT Group brings thoughtful independent travel experts together with a framework for booking with confidence. Each expert shapes a trip around the people, pace and moments that matter to you.</p></div><div className="mt-12 grid gap-5 md:grid-cols-3"><ValueCard number="01" title="Start with you" body="From a once-in-a-lifetime celebration to an easy family escape, your plans begin with a conversation." /><ValueCard number="02" title="Choose with confidence" body="Your expert brings knowledge, perspective and a carefully considered choice of travel arrangements." /><ValueCard number="03" title="Feel supported" body="Someone who knows your booking is there to help you navigate the details along the way." /></div></section>
    <section className="bg-[#eafbf8] py-20 lg:py-28"><div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-[.9fr_1.1fr] lg:px-8"><div className="rounded-[2.5rem] bg-[#102632] p-8 text-white sm:p-12"><Landmark className="text-[#70ffe8]" size={32} /><h2 className="mt-8 font-serif text-4xl tracking-[-.04em]">Protection is part of a confident booking.</h2><p className="mt-5 leading-relaxed text-slate-300">Travel protection depends on the specific arrangements in your booking. We believe it should be easy to understand, which is why your JLT expert can talk you through the protection relevant to your trip before you book.</p><Link href={publicHref("/your-protection")} className="mt-8 inline-flex items-center gap-2 font-semibold text-[#70ffe8] hover:text-white">Understand your protection <ChevronRight size={18} /></Link></div><div><Eyebrow>Protection, clearly explained</Eyebrow><h2 className="mt-4 font-serif text-4xl tracking-[-.04em] sm:text-5xl">Reassurance without the jargon.</h2><p className="mt-5 max-w-2xl leading-relaxed text-[#51636d]">We work to make the booking process clearer from the outset. Ask your JLT expert about the protection arrangements that apply to your particular holiday, including when flight-inclusive protection applies.</p><div className="mt-8 space-y-4"><CheckLine text="Booking-specific information before you commit" /><CheckLine text="Clear documentation for your arrangements" /><CheckLine text="A named travel expert to guide you through it" /></div></div></div></section>
    <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28"><div className="rounded-[2.5rem] bg-[#f3f0ec] p-8 sm:p-12 lg:p-16"><div className="grid items-center gap-8 lg:grid-cols-[1.15fr_.85fr]"><div><Eyebrow>Find your person</Eyebrow><h2 className="mt-4 font-serif text-4xl tracking-[-.04em] sm:text-5xl">A better trip starts with the right conversation.</h2><p className="mt-5 max-w-xl leading-relaxed text-[#51636d]">Search by destination, travel style or location, then get in touch through a private and secure contact form.</p><Link href={publicHref("/find-an-agent")} className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#102632] px-6 py-3.5 font-semibold text-white transition hover:bg-[#1e3a48]">Explore travel experts <ArrowRight size={17} /></Link></div><div className="rounded-3xl bg-white p-6 shadow-sm"><p className="text-sm font-medium text-[#61727c]">Currently discoverable</p><p className="mt-1 font-serif text-6xl tracking-[-.05em] text-[#102632]">{agents.length}</p><p className="mt-2 text-sm leading-relaxed text-[#61727c]">approved JLT travel {agents.length === 1 ? "expert" : "experts"} available to help plan a more personal holiday.</p><div className="mt-6 flex -space-x-2">{agents.slice(0, 4).map((agent) => agent.profilePhotoUrl ? <img key={agent.slug} src={agent.profilePhotoUrl} alt="" className="h-10 w-10 rounded-full border-2 border-white object-cover" /> : <span key={agent.slug} className="grid h-10 w-10 place-items-center rounded-full border-2 border-white bg-[#d4f8f0] text-xs font-semibold text-[#116e65]">{agent.displayName.split(" ").map(name => name[0]).join("").slice(0, 2)}</span>)}</div></div></div></div></section>
  </>;
}

function FindAnAgent() {
  const { data: tags = [] } = trpc.consumerSite.tags.list.useQuery();
  const [search, setSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const { data: agents = [], isLoading } = trpc.consumerSite.public.listAgents.useQuery({ search: search || undefined, tagIds: selectedTagIds });
  const destinationTags = tags.filter(tag => tag.category === "destination");
  const travelTypeTags = tags.filter(tag => tag.category === "travel_type");
  const toggle = (id: number) => setSelectedTagIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  return <>
    <PageHero eyebrow="Find your travel expert" title="The person behind your next great trip." body="Choose by destination, holiday style or town. Every expert listed here has an approved JLT profile and is currently Active." />
    <section className="mx-auto max-w-7xl px-5 py-12 lg:px-8 lg:py-16"><div className="grid gap-8 lg:grid-cols-[310px_1fr]"><aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Travel expert filters"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="relative"><Search className="absolute left-3 top-3 text-[#70818a]" size={18} aria-hidden="true" /><Input aria-label="Search travel experts by name, town or speciality" value={search} onChange={event => setSearch(event.target.value)} className="h-11 border-slate-200 pl-10" placeholder="Name, town or speciality" /></div><FilterGroup title="Destinations" tags={destinationTags} selected={selectedTagIds} onToggle={toggle} /><FilterGroup title="Travel types" tags={travelTypeTags} selected={selectedTagIds} onToggle={toggle} />{selectedTagIds.length > 0 && <button onClick={() => setSelectedTagIds([])} className="mt-5 text-sm font-medium text-[#007e72] underline underline-offset-4">Clear filters</button>}</div></aside><div><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[#60717a]" aria-live="polite" role="status">{isLoading ? "Finding experts…" : `${agents.length} ${agents.length === 1 ? "expert" : "experts"} found`}</p><p className="inline-flex items-center gap-2 text-xs text-[#60717a]"><ShieldCheck size={14} className="text-[#008e81]" aria-hidden="true" /> Approved profiles only</p></div><AgentMap agents={agents} /><div className="mt-7 grid gap-5 md:grid-cols-2" aria-label="Travel expert results">{isLoading ? [1, 2, 3, 4].map(item => <div key={item} className="h-72 animate-pulse rounded-2xl bg-slate-100" />) : agents.map(agent => <AgentCard key={agent.slug} agent={agent} />)}</div>{!isLoading && agents.length === 0 && <EmptyAgentState hasFilters={Boolean(search || selectedTagIds.length)} />}</div></div></section>
  </>;
}

function AgentProfile({ slug }: { slug: string }) {
  const { data: agent, isLoading, error } = trpc.consumerSite.public.getAgent.useQuery({ slug });
  if (isLoading) return <section className="mx-auto max-w-6xl px-5 py-20 lg:px-8"><div className="h-96 animate-pulse rounded-3xl bg-slate-100" /></section>;
  if (error || !agent) return <ConsumerNotFound />;
  return <>
    <section className="bg-[#eafbf8]"><div className="mx-auto max-w-6xl px-5 py-10 lg:px-8"><Link href={publicHref("/find-an-agent")} className="inline-flex items-center gap-1 text-sm font-medium text-[#047d71] hover:underline">← All travel experts</Link><div className="mt-10 grid gap-8 lg:grid-cols-[270px_1fr]"><div className="aspect-square max-w-[270px] overflow-hidden rounded-[2rem] bg-[#d1f4ed]">{agent.profilePhotoUrl ? <img src={agent.profilePhotoUrl} alt={agent.displayName} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-6xl font-serif text-[#177c71]">{agent.displayName.charAt(0)}</div>}</div><div className="self-center"><p className="inline-flex items-center gap-1.5 text-sm font-medium text-[#047d71]"><MapPin size={16} /> {agent.listingTown}</p><h1 className="mt-3 font-serif text-5xl tracking-[-.045em] sm:text-6xl">{agent.displayName}</h1>{agent.businessName && <p className="mt-2 text-lg text-[#53656e]">{agent.businessName}</p>}<div className="mt-6 flex flex-wrap gap-2">{agent.tags.map(tag => <span key={tag.id} className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-[#2f5452] shadow-sm">{tag.label}</span>)}</div></div></div></div></section>
    <section className="mx-auto grid max-w-6xl gap-12 px-5 py-16 lg:grid-cols-[1fr_380px] lg:px-8 lg:py-20"><article><Eyebrow>Meet your travel expert</Eyebrow><p className="mt-5 whitespace-pre-wrap text-lg leading-8 text-[#41565f]">{agent.biography}</p><div className="mt-10 border-t border-slate-200 pt-8"><h2 className="font-serif text-3xl tracking-[-.04em]">Let’s start planning</h2><p className="mt-3 max-w-2xl leading-relaxed text-[#61727a]">Share some initial ideas and {agent.displayName.split(" ")[0]} will reply directly. Their contact details are kept private; your enquiry is sent securely.</p><EnquiryForm agent={agent} /></div></article><aside className="space-y-5"><div className="rounded-3xl bg-[#102632] p-6 text-white"><p className="text-sm text-slate-300">Why book with a JLT expert?</p><ul className="mt-5 space-y-4 text-sm leading-relaxed text-slate-100"><li className="flex gap-2"><CheckCircle /> Independent advice shaped around you</li><li className="flex gap-2"><CheckCircle /> One expert who understands the details</li><li className="flex gap-2"><CheckCircle /> Protection information made clear</li></ul><Link href={publicHref("/why-jlt")} className="mt-6 inline-flex text-sm font-semibold text-[#70ffe8] hover:text-white">Why JLT <ArrowRight size={15} className="ml-1" /></Link></div><SocialLinks agent={agent} /></aside></section>
  </>;
}

function AgentMap({ agents }: { agents: Agent[] }) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const groupedTowns = useMemo(() => Object.values(agents.reduce<Record<string, Agent[]>>((acc, agent) => { const town = agent.listingTown.trim(); if (town) (acc[town] ??= []).push(agent); return acc; }, {})), [agents]);
  useEffect(() => {
    if (!ready || !mapRef.current || !window.google?.maps || groupedTowns.length === 0) return;
    let cancelled = false;
    const map = mapRef.current;
    const bounds = new window.google.maps.LatLngBounds();
    const geocoder = new window.google.maps.Geocoder();
    const markers: Array<{ setMap: (map: google.maps.Map | null) => void }> = [];
    groupedTowns.forEach((townAgents) => {
      const first = townAgents[0];
      const position = first.townLatitude !== null && first.townLongitude !== null ? { lat: first.townLatitude, lng: first.townLongitude } : null;
      const addMarker = (point: google.maps.LatLngLiteral) => {
        if (cancelled) return;
        const marker = new window.google.maps.Marker({ map, position: point, title: `${townAgents.length} JLT travel ${townAgents.length === 1 ? "expert" : "experts"} in ${first.listingTown}`, label: { text: String(townAgents.length), color: "#102632", fontWeight: "700" }, icon: { path: window.google.maps.SymbolPath.CIRCLE, fillColor: "#70ffe8", fillOpacity: 1, strokeColor: "#102632", strokeWeight: 2, scale: 15 } });
        markers.push(marker); bounds.extend(point);
      };
      if (position) addMarker(position); else geocoder.geocode({ address: `${first.listingTown}, United Kingdom` }, (results, status) => { if (status === "OK" && results?.[0]) addMarker(results[0].geometry.location.toJSON()); });
    });
    const timer = window.setTimeout(() => { if (!cancelled && !bounds.isEmpty()) map.fitBounds(bounds, 72); }, 800);
    return () => { cancelled = true; clearTimeout(timer); markers.forEach(marker => marker.setMap(null)); };
  }, [groupedTowns, ready]);
  if (!agents.length) return null;
  return <section aria-labelledby="agent-map-heading" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4"><div><h2 id="agent-map-heading" className="font-semibold">Where our experts are based</h2><p className="mt-0.5 text-xs text-[#64747d]">Town-level markers only — never an agent’s precise address.</p></div><MapPin className="text-[#008e81]" size={20} aria-hidden="true" /></div><div className="relative h-[330px] bg-[#eafbf8]" aria-label="Map of JLT travel experts by town">{mapError ? <div className="grid h-full place-items-center px-6 text-center text-sm text-[#61727a]">The map is temporarily unavailable. You can still use the accessible expert list below.</div> : <MapView className="h-full w-full" initialCenter={{ lat: 54.5, lng: -3.2 }} initialZoom={5} onMapReady={map => { mapRef.current = map; setReady(true); }} />}</div><div className="flex flex-wrap gap-2 px-5 py-3" aria-label="Town summary">{groupedTowns.map(townAgents => <span key={townAgents[0].listingTown} className="rounded-full bg-[#eafbf8] px-3 py-1 text-xs font-medium text-[#27746c]">{townAgents[0].listingTown} · {townAgents.length}</span>)}</div></section>;
}

function EnquiryForm({ agent }: { agent: Agent }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", brief: "" });
  const [consent, setConsent] = useState(false);
  const submit = trpc.consumerSite.public.submitEnquiry.useMutation({ onSuccess: () => { toast.success("Thank you — your enquiry has been passed to your JLT travel expert."); setForm({ name: "", email: "", phone: "", brief: "" }); setConsent(false); }, onError: error => toast.error(error.message) });
  const onSubmit = (event: React.FormEvent) => { event.preventDefault(); if (!consent) return toast.error("Please confirm that you agree to us passing your enquiry to this travel expert."); submit.mutate({ slug: agent.slug, customerName: form.name, customerEmail: form.email, customerPhone: form.phone || null, travelBrief: form.brief, consentConfirmed: true }); };
  return <form onSubmit={onSubmit} className="mt-7 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="grid gap-4 sm:grid-cols-2"><PublicField label="Your name"><Input required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></PublicField><PublicField label="Email address"><Input required type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} /></PublicField></div><PublicField label="Phone number" optional><Input type="tel" value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} /></PublicField><PublicField label="Tell us about your trip"><Textarea required minLength={20} rows={6} value={form.brief} onChange={event => setForm(current => ({ ...current, brief: event.target.value }))} placeholder="Where would you like to go, who is travelling, and what kind of trip are you dreaming of?" /></PublicField><label className="flex items-start gap-3 cursor-pointer"><Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} className="mt-0.5" /><span className="text-xs leading-relaxed text-[#61727a]">I agree that The JLT Group may securely pass this enquiry and my contact details to {agent.displayName}. I have read the <Link href={publicHref("/privacy")} className="font-medium text-[#007e72] underline">privacy notice</Link>.</span></label><Button disabled={submit.isPending} type="submit" className="w-full rounded-full bg-[#102632] py-6 font-semibold hover:bg-[#1e3a48]">{submit.isPending ? "Sending…" : <>Send a private enquiry <ArrowRight className="ml-2" size={17} /></>}</Button></form>;
}

function WhyJlt() { return <><PageHero eyebrow="Why book through JLT" title="Independent expertise, on your side." body="A JLT travel expert brings a human understanding to the part of travel that cannot be reduced to a filter." /><ContentSection title="A more personal way to travel"><p>Great travel has a different meaning for everyone. It might be quiet time with the people closest to you, a food-led itinerary, space to switch off, or the confidence to try somewhere altogether new.</p><p>Your JLT travel expert starts there. They listen, draw on their experience and help you make thoughtful choices. Rather than a transaction, it is a conversation with someone who has a genuine interest in getting the details right.</p></ContentSection><FeatureBand /><ContentSection title="The freedom to choose what fits"><p>Independent travel expertise means the conversation can remain focused on the needs of your trip. Your JLT expert can help turn a broad idea into an itinerary that feels coherent, considered and true to your priorities.</p><p>Every booking remains subject to its own terms, availability and protection arrangements. Your expert will explain the practical details that apply before you decide to book.</p></ContentSection></> }

function ProtectionPage() { return <><PageHero eyebrow="Your protection" title="Clear information for the trip you are booking." body="Travel arrangements can differ, so the protection that applies should always be explained in the context of your specific booking." /><ContentSection title="Understanding your booking"><p>The JLT Group works with travel-industry protection arrangements and will provide the information relevant to your booking before you commit. Protection may differ according to the type of travel arrangements, supplier and payment structure involved.</p><p>Where flights are included, ATOL protection may apply in the circumstances set out in the applicable booking documentation. Your travel expert will explain the protection applicable to your arrangements and provide the relevant confirmation.</p></ContentSection><section className="bg-[#eafbf8]"><div className="mx-auto grid max-w-7xl gap-5 px-5 py-16 md:grid-cols-3 lg:px-8"><ProtectionCard title="Ask before you book" body="Your travel expert can explain the arrangements and protection relevant to the holiday you are considering." /><ProtectionCard title="Read the documents" body="Your confirmation and booking documents set out the information that applies to your arrangements." /><ProtectionCard title="Keep in touch" body="If something is unclear, speak to your JLT expert before you make a payment or change your plans." /></div></section><ContentSection title="Important information"><p>This page is a general introduction and is not a replacement for the protection information supplied with a particular booking. Financial protection and ATOL applicability depend on the booking circumstances. Please review the documents provided for your holiday and ask your JLT expert if you would like anything explained.</p></ContentSection></> }

function PartnersPage() { return <><PageHero eyebrow="Partners" title="A carefully developing collection." body="We are building a considered showcase of the travel partners our experts work with. Check back soon as this area grows." /><section className="mx-auto max-w-4xl px-5 py-20 text-center lg:px-8 lg:py-28"><div className="rounded-[2.5rem] border border-dashed border-[#9bd5cc] bg-[#eafbf8] p-10 sm:p-16"><Sparkles className="mx-auto text-[#008e81]" size={30} /><h2 className="mt-5 font-serif text-4xl tracking-[-.04em]">Coming soon</h2><p className="mx-auto mt-4 max-w-xl leading-relaxed text-[#5d7078]">We are taking care to curate this space. In the meantime, your JLT travel expert can talk you through the options best suited to your trip.</p><Link href={publicHref("/find-an-agent")} className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#102632] px-5 py-3 font-semibold text-white">Find your expert <ArrowRight size={16} /></Link></div></section></> }

function PrivacyPage() { return <LegalPage title="Privacy notice" updated="September 2026"><p>When you submit an enquiry through an individual JLT travel expert’s public profile, we collect the information you enter in the form so that it can be passed securely to that selected expert and they can respond to your enquiry.</p><p>We do not display the expert’s private delivery email address on the public website. We retain a limited internal delivery record to help us maintain the reliability and security of the enquiry service.</p><p>We use appropriate technical and organisational measures to protect personal data. If you have a query about your data or this notice, please contact The JLT Group through the appropriate published business contact channel.</p></LegalPage> }
function PublicTermsPage() { return <LegalPage title="Website terms" updated="September 2026"><p>This website provides general information about The JLT Group and its independent travel experts. Content is intended as an introduction only and does not constitute an offer, quotation or confirmation of travel arrangements.</p><p>Any travel booking, payment, cancellation, amendment, supplier term or protection arrangement is governed by the specific documents provided in connection with that booking.</p></LegalPage> }

function ConsumerNotFound() { return <section className="mx-auto grid min-h-[55vh] max-w-4xl place-items-center px-5 py-20 text-center"><div><p className="text-sm font-semibold uppercase tracking-[.18em] text-[#008e81]">Page not found</p><h1 className="mt-4 font-serif text-5xl tracking-[-.05em]">Let’s find a better route.</h1><p className="mt-4 text-[#5e7079]">This page may have moved, or the travel expert you are looking for is not currently available.</p><Link href={publicHref("/find-an-agent")} className="mt-8 inline-flex rounded-full bg-[#102632] px-5 py-3 font-semibold text-white">Find a travel expert</Link></div></section> }

function ConsumerFooter() { return <footer className="bg-[#102632] text-white"><div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-[1.1fr_.9fr_.9fr] lg:px-8"><div><p className="font-semibold text-lg">The JLT Group</p><p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-300">Travel, personally arranged. Find an independent travel expert who can help make your next trip feel more like yours.</p></div><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#70ffe8]">Explore</p><div className="mt-4 grid gap-2">{NAV_ITEMS.map(item => <Link key={item.href} href={publicHref(item.href)} className="text-sm text-slate-300 hover:text-white">{item.label}</Link>)}</div></div><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#70ffe8]">Information</p><div className="mt-4 grid gap-2"><Link href={publicHref("/your-protection")} className="text-sm text-slate-300 hover:text-white">Your protection</Link><Link href={publicHref("/privacy")} className="text-sm text-slate-300 hover:text-white">Privacy notice</Link><Link href={publicHref("/terms")} className="text-sm text-slate-300 hover:text-white">Website terms</Link></div></div></div><div className="border-t border-white/10 px-5 py-5 text-center text-xs text-slate-400">© {new Date().getFullYear()} The JLT Group. All rights reserved.</div></footer> }

function AgentCard({ agent }: { agent: Agent }) { return <Link href={publicHref(`/travel-agents/${agent.slug}`)} className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white no-underline shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex gap-4 p-5"><div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#d6f7f1] font-serif text-2xl text-[#177c71]">{agent.profilePhotoUrl ? <img src={agent.profilePhotoUrl} alt={agent.displayName} className="h-full w-full object-cover" /> : agent.displayName.charAt(0)}</div><div className="min-w-0"><p className="font-semibold text-[#102632] group-hover:text-[#007e72]">{agent.displayName}</p>{agent.businessName && <p className="mt-0.5 truncate text-sm text-[#667781]">{agent.businessName}</p>}<p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#54706f]"><MapPin size={13} /> {agent.listingTown}</p></div></div><div className="border-t border-slate-100 px-5 py-4"><div className="flex flex-wrap gap-1.5">{agent.tags.slice(0, 3).map(tag => <span key={tag.id} className="rounded-full bg-[#eafbf8] px-2.5 py-1 text-xs font-medium text-[#24756c]">{tag.label}</span>)}</div><p className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-[#007e72]">View profile <ArrowRight size={15} /></p></div></Link> }
function SocialLinks({ agent }: { agent: Agent }) { const links = [{ key: "websiteUrl", label: "Website", icon: <Globe2 size={18} /> }, { key: "instagramUrl", label: "Instagram", icon: <Instagram size={18} /> }, { key: "tiktokUrl", label: "TikTok", icon: <Music2 size={18} /> }, { key: "facebookUrl", label: "Facebook", icon: <Facebook size={18} /> }, { key: "linkedinUrl", label: "LinkedIn", icon: <Linkedin size={18} /> }, { key: "youtubeUrl", label: "YouTube", icon: <Youtube size={18} /> }, { key: "pinterestUrl", label: "Pinterest", icon: <PinIcon size={18} /> }] as const; const visible = links.filter(link => agent[link.key]); if (!visible.length) return null; return <div className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-sm font-medium text-[#52646d]">Find {agent.displayName.split(" ")[0]} online</p><div className="mt-4 flex flex-wrap gap-2">{visible.map(link => <a key={link.key} href={agent[link.key] ?? undefined} target="_blank" rel="noreferrer" aria-label={`${agent.displayName} on ${link.label}`} className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-[#285b61] transition hover:border-[#008e81] hover:bg-[#eafbf8] hover:text-[#007e72]">{link.icon}</a>)}</div></div> }
function TrustMetric({ icon, heading, body }: { icon: React.ReactElement; heading: string; body: string }) { return <div className="flex gap-3 py-5 sm:px-6 first:pl-0"><div className="mt-0.5 text-[#70ffe8]">{icon}</div><div><p className="font-semibold">{heading}</p><p className="mt-1 text-sm leading-relaxed text-slate-300">{body}</p></div></div> }
function ValueCard({ number, title, body }: { number: string; title: string; body: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-6"><p className="text-sm font-semibold text-[#008e81]">{number}</p><h3 className="mt-8 font-serif text-2xl tracking-[-.03em]">{title}</h3><p className="mt-3 text-sm leading-relaxed text-[#60717a]">{body}</p></div> }
function CheckLine({ text }: { text: string }) { return <p className="flex items-center gap-3 text-sm font-medium text-[#314950]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#70ffe8] text-[#102632]"><ShieldCheck size={14} /></span>{text}</p> }
function CheckCircle() { return <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#70ffe8] text-[#102632] text-[10px] font-bold">✓</span> }
function Eyebrow({ children }: { children: React.ReactNode }) { return <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#008e81]">{children}</p> }
function PageHero({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) { return <section className="bg-[#102632] py-20 text-white sm:py-24"><div className="mx-auto max-w-4xl px-5 text-center lg:px-8"><Eyebrow>{eyebrow}</Eyebrow><h1 className="mt-5 font-serif text-5xl tracking-[-.05em] sm:text-6xl">{title}</h1><p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">{body}</p></div></section> }
function FilterGroup({ title, tags, selected, onToggle }: { title: string; tags: Array<{ id: number; label: string }>; selected: number[]; onToggle: (id: number) => void }) { if (!tags.length) return null; return <div className="mt-6"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#70818a]">{title}</p><div className="mt-3 flex flex-wrap gap-2">{tags.map(tag => <button key={tag.id} onClick={() => onToggle(tag.id)} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${selected.includes(tag.id) ? "border-[#008e81] bg-[#dffaf5] text-[#006f64]" : "border-slate-200 text-[#53656e] hover:border-[#a7cfc9]"}`}>{tag.label}</button>)}</div></div> }
function EmptyAgentState({ hasFilters }: { hasFilters: boolean }) { return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><UsersRound className="mx-auto text-[#78a9a2]" size={30} /><h2 className="mt-4 font-serif text-3xl">{hasFilters ? "No matching experts just yet" : "Our directory is just getting started"}</h2><p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[#60717a]">{hasFilters ? "Try removing a filter or searching for a different destination or travel style." : "As JLT experts complete and receive approval for their public profiles, they will appear here."}</p></div> }
function PublicField({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium text-[#364d56]"><span>{label}{optional && <span className="ml-1 text-xs font-normal text-[#778991]">(optional)</span>}</span>{children}</label> }
function ContentSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="mx-auto grid max-w-7xl gap-8 px-5 py-20 lg:grid-cols-[.7fr_1fr] lg:px-8 lg:py-28"><h2 className="font-serif text-4xl tracking-[-.04em] sm:text-5xl">{title}</h2><div className="space-y-5 text-lg leading-8 text-[#53666f]">{children}</div></section> }
function FeatureBand() { return <section className="bg-[#102632]"><div className="mx-auto grid max-w-7xl gap-px px-5 py-5 md:grid-cols-3 lg:px-8">{[["Independent", "A travel expert who takes a broad view of what will work for you."], ["Personal", "A relationship that can begin long before your holiday is confirmed."], ["Considered", "Details, choices and documentation discussed with care."]].map(([title, body]) => <div key={title} className="p-7 text-white"><p className="font-serif text-3xl">{title}</p><p className="mt-3 text-sm leading-relaxed text-slate-300">{body}</p></div>)}</div></section> }
function ProtectionCard({ title, body }: { title: string; body: string }) { return <div className="rounded-2xl bg-white p-6"><Landmark className="text-[#008e81]" size={22} /><h3 className="mt-5 font-serif text-2xl">{title}</h3><p className="mt-3 text-sm leading-relaxed text-[#60717a]">{body}</p></div> }
function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) { return <section className="mx-auto max-w-3xl px-5 py-16 lg:px-8 lg:py-24"><Eyebrow>Legal information</Eyebrow><h1 className="mt-4 font-serif text-5xl tracking-[-.04em]">{title}</h1><p className="mt-3 text-sm text-[#6b7d85]">Last updated: {updated}</p><div className="mt-10 space-y-5 text-base leading-8 text-[#4f626b]">{children}</div></section> }
