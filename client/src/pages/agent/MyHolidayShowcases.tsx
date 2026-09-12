import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Eye, EyeOff, ExternalLink, ImagePlus, MapPin, PenLine, PlaneTakeoff, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ImageCategory = "hotel" | "cruise" | "experience";
type SectionKind = "flight" | "stay" | "transfer" | "cruise" | "experience" | "note";
type GalleryImage = { url: string; source: "supplier" | "agent_upload"; label: string; category: ImageCategory };
type CuratedSection = { id: string; kind: SectionKind; title: string; summary: string; facts: string[]; images: GalleryImage[] };
type ShowcaseDraft = {
  title: string;
  summary: string;
  destination: string;
  travelPeriodLabel: string | null;
  durationNights: number | null;
  priceAmount: number | null;
  heroImage: { url: string; source: "supplier" | "agent_upload" } | null;
  itineraryImages: GalleryImage[];
  curatedSections: CuratedSection[];
  editorialTags: string[];
  inclusions: string[];
  practicalNotes: string[];
};

const emptyDraft: ShowcaseDraft = { title: "", summary: "", destination: "", travelPeriodLabel: null, durationNights: null, priceAmount: null, heroImage: null, itineraryImages: [], curatedSections: [], editorialTags: [], inclusions: [], practicalNotes: [] };
const showcaseAutosaveKey = (id: number) => `jlt:holiday-showcase-editor:${id}`;

function asDateInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount === null) return null;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency ?? "GBP", maximumFractionDigits: 0 }).format(amount);
}

function textLines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function withDefaultImageLabel(image: GalleryImage): GalleryImage {
  return { ...image, label: image.label?.trim() || "Holiday image" };
}

function asDraft(value: unknown): ShowcaseDraft {
  if (!value || typeof value !== "object") return emptyDraft;
  const source = value as Partial<ShowcaseDraft>;
  return {
    title: source.title ?? "",
    summary: source.summary ?? "",
    destination: source.destination ?? "",
    travelPeriodLabel: source.travelPeriodLabel ?? null,
    durationNights: source.durationNights ?? null,
    priceAmount: source.priceAmount ?? null,
    heroImage: source.heroImage ?? null,
    itineraryImages: Array.isArray(source.itineraryImages) ? (source.itineraryImages as GalleryImage[]).map(withDefaultImageLabel) : [],
    curatedSections: Array.isArray(source.curatedSections) ? (source.curatedSections as CuratedSection[]).map((section) => ({ ...section, images: Array.isArray(section.images) ? section.images.map(withDefaultImageLabel) : [] })) : [],
    editorialTags: Array.isArray(source.editorialTags) ? source.editorialTags : [],
    inclusions: Array.isArray(source.inclusions) ? source.inclusions : [],
    practicalNotes: Array.isArray(source.practicalNotes) ? source.practicalNotes : [],
  };
}

function loadAutosavedDraft(id: number): { draft: ShowcaseDraft; agentNote: string; savedAt: number } | null {
  try {
    const stored = window.localStorage.getItem(showcaseAutosaveKey(id));
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { draft?: unknown; agentNote?: unknown; savedAt?: unknown };
    if (!parsed.draft) return null;
    return { draft: asDraft(parsed.draft), agentNote: typeof parsed.agentNote === "string" ? parsed.agentNote : "", savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now() };
  } catch {
    return null;
  }
}

function defaultCategory(kind: SectionKind): ImageCategory {
  if (kind === "stay") return "hotel";
  if (kind === "cruise") return "cruise";
  return "experience";
}

export default function MyHolidayShowcases() {
  const utils = trpc.useUtils();
  const { data: showcases = [], isLoading } = trpc.consumerSite.showcases.mine.useQuery();
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ShowcaseDraft>(emptyDraft);
  const [agentNote, setAgentNote] = useState("");
  const [autosaveReadyForId, setAutosaveReadyForId] = useState<number | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<number | null>(null);
  const { data: editable, isLoading: isLoadingEditor } = trpc.consumerSite.showcases.editable.useQuery({ id: editingId ?? 1 }, { enabled: editingId !== null });
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
  const uploadEditorImage = trpc.consumerSite.showcases.uploadEditorImage.useMutation({ onError: (error) => toast.error(error.message) });
  const submitEdit = trpc.consumerSite.showcases.submitEdit.useMutation({
    onSuccess: () => {
      if (editingId !== null) window.localStorage.removeItem(showcaseAutosaveKey(editingId));
      toast.success("Your customer-safe Holiday Showcase changes are now live.");
      utils.consumerSite.showcases.mine.invalidate();
      utils.consumerSite.showcases.editable.invalidate();
      setEditOpen(false);
      setEditingId(null);
    },
    onError: (error) => toast.error(error.message),
  });
  const active = useMemo(() => showcases.filter((showcase) => !showcase.deletedAt), [showcases]);

  useEffect(() => {
    if (!editable || editingId === null) return;
    const autosaved = loadAutosavedDraft(editingId);
    setDraft(autosaved?.draft ?? asDraft(editable.draft));
    setAgentNote(autosaved?.agentNote ?? "");
    setAutosavedAt(autosaved?.savedAt ?? null);
    setAutosaveReadyForId(editingId);
  }, [editable, editingId]);

  useEffect(() => {
    if (!editOpen || editingId === null || autosaveReadyForId !== editingId) return;
    const savedAt = Date.now();
    window.localStorage.setItem(showcaseAutosaveKey(editingId), JSON.stringify({ draft, agentNote, savedAt }));
    setAutosavedAt(savedAt);
  }, [agentNote, autosaveReadyForId, draft, editOpen, editingId]);

  const move = (id: number, direction: -1 | 1) => {
    const index = active.findIndex((item) => item.id === id);
    const replacement = index + direction;
    if (index < 0 || replacement < 0 || replacement >= active.length) return;
    const ordered = [...active];
    [ordered[index], ordered[replacement]] = [ordered[replacement], ordered[index]];
    reorder.mutate({ ids: ordered.map((item) => item.id) });
  };

  const openEditor = (id: number) => { setEditingId(id); setDraft(emptyDraft); setAgentNote(""); setAutosavedAt(null); setAutosaveReadyForId(null); setEditOpen(true); };
  const uploadImage = (file: File | undefined, target: "hero" | "gallery" | { sectionId: string }) => {
    if (!file || editingId === null) return;
    if (!( ["image/jpeg", "image/jpg", "image/png", "image/webp"] as string[]).includes(file.type)) return toast.error("Use a JPG, PNG, or WEBP image.");
    if (file.size > 6 * 1024 * 1024) return toast.error("Holiday Showcase images must be 6 MB or smaller.");
    const reader = new FileReader();
    reader.onload = () => {
      const fileBase64 = typeof reader.result === "string" ? reader.result.split(",")[1] : null;
      if (!fileBase64) return toast.error("The image could not be read.");
      uploadEditorImage.mutate({ id: editingId, fileBase64, fileName: file.name, mimeType: file.type as "image/jpeg" | "image/jpg" | "image/png" | "image/webp" }, {
        onSuccess: ({ url, source }) => setDraft((current) => {
          if (target === "hero") return { ...current, heroImage: { url, source } };
          if (target === "gallery") return { ...current, itineraryImages: [...current.itineraryImages, { url, source, label: "Holiday moment", category: "experience" }] };
          return {
            ...current,
            curatedSections: current.curatedSections.map((section) => section.id === target.sectionId
              ? { ...section, images: [...section.images, { url, source, label: "A closer look", category: defaultCategory(section.kind) }] }
              : section),
          };
        }),
      });
    };
    reader.readAsDataURL(file);
  };

  const saveEditor = () => {
    if (editingId === null) return;
    if (!draft.title.trim() || !draft.summary.trim() || !draft.destination.trim()) return toast.error("Add a customer-friendly title, description, and destination before submitting.");
    submitEdit.mutate({
      id: editingId,
      draft: {
        ...draft,
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        destination: draft.destination.trim(),
        travelPeriodLabel: draft.travelPeriodLabel?.trim() || null,
        editorialTags: draft.editorialTags.map((item) => item.trim()).filter(Boolean),
        inclusions: draft.inclusions.map((item) => item.trim()).filter(Boolean),
        practicalNotes: draft.practicalNotes.map((item) => item.trim()).filter(Boolean),
        curatedSections: draft.curatedSections.map((section) => ({
          ...section,
          title: section.title.trim(),
          summary: section.summary.trim(),
          facts: section.facts.map((item) => item.trim()).filter(Boolean),
          images: section.images.map((image) => ({ ...image, label: image.label.trim() || "Holiday image" })),
        })),
      },
      agentNote: agentNote.trim() || null,
    });
  };

  return <div className="mx-auto max-w-6xl space-y-7 p-4 md:p-6">
    <section className="overflow-hidden rounded-3xl bg-[#102632] px-6 py-8 text-white shadow-sm sm:px-9">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#70ffe8]"><PlaneTakeoff size={15} /> Portal-owned snapshots</p><h1 className="mt-3 font-serif text-4xl tracking-[-.04em] sm:text-5xl">My Holiday Showcases</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Create an itinerary in Orbit, then choose <strong className="text-white">Create public showcase</strong>. You can refine customer-facing wording, imagery, tags, inclusions and each itinerary section here; safe changes update your live holiday page straight away.</p></div><div className="rounded-2xl bg-white/10 px-5 py-4"><p className="text-xs text-slate-300">Currently visible</p><p className="mt-1 font-serif text-4xl text-[#70ffe8]">{active.filter((item) => item.isPublished && (!item.expiresAt || new Date(item.expiresAt) > new Date())).length}</p></div></div>
    </section>
    <section className="rounded-2xl border border-[#bdebe3] bg-[#effbf8] p-5 text-sm leading-6 text-[#315d59]"><strong className="text-[#102632]">A safe public edit layer:</strong> your original Orbit snapshot remains on file. You can improve each visible itinerary section for customers, including room wording, board basis and photos—without changing the original source record.</section>
    {isLoading ? <div className="grid gap-5 md:grid-cols-2">{[1, 2].map((item) => <div key={item} className="h-72 animate-pulse rounded-3xl bg-slate-100" />)}</div> : active.length === 0 ? <section className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><PlaneTakeoff className="mx-auto text-[#008e81]" size={32} /><h2 className="mt-5 font-serif text-3xl text-[#102632]">No holiday showcases yet.</h2><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#64747d]">Your public holiday ideas begin in Orbit. When you create a public showcase there, it will appear here as a fixed snapshot ready to manage on your profile.</p></section> : <section className="grid gap-5 md:grid-cols-2">{active.map((showcase, index) => {
      const expired = showcase.expiresAt ? new Date(showcase.expiresAt) <= new Date() : false;
      const visible = showcase.isPublished && !expired;
      return <article key={showcase.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="relative h-44 bg-[#eafbf8]">{showcase.heroImageUrl ? <img src={showcase.heroImageUrl} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <div className="grid h-full place-items-center bg-[#102632] text-[#70ffe8]"><PlaneTakeoff size={30} /></div>}<span className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-semibold ${visible ? "bg-[#70ffe8] text-[#102632]" : "bg-white text-[#596971]"}`}>{expired ? "Expired" : visible ? "Visible" : "Hidden"}</span></div><div className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="inline-flex items-center gap-1 text-xs font-medium text-[#008e81]"><MapPin size={13} /> {showcase.destination}</p><h2 className="mt-2 font-serif text-2xl leading-tight text-[#102632]">{showcase.title}</h2></div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" disabled={index === 0 || reorder.isPending} aria-label="Move showcase up" onClick={() => move(showcase.id, -1)}><ArrowUp size={17} /></Button><Button variant="ghost" size="icon" disabled={index === active.length - 1 || reorder.isPending} aria-label="Move showcase down" onClick={() => move(showcase.id, 1)}><ArrowDown size={17} /></Button></div></div><p className="mt-3 text-sm text-[#64747d]">{showcase.durationNights ? `${showcase.durationNights} nights` : "Itinerary"}{showcase.travelPeriodLabel ? ` · ${showcase.travelPeriodLabel}` : ""}{formatMoney(showcase.priceAmount, showcase.priceCurrency) ? ` · From ${formatMoney(showcase.priceAmount, showcase.priceCurrency)} pp` : ""}</p><div className="mt-5 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openEditor(showcase.id)}><PenLine size={15} className="mr-1.5" /> Edit public copy</Button><Button size="sm" variant={visible ? "outline" : "default"} disabled={setPublished.isPending} onClick={() => setPublished.mutate({ id: showcase.id, isPublished: !showcase.isPublished })}>{visible ? <><EyeOff size={15} className="mr-1.5" /> Hide</> : <><Eye size={15} className="mr-1.5" /> Show on website</>}</Button><a href={`/consumer/travel-agents/holiday-showcases/${showcase.publicSlug}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md px-2 text-sm font-medium text-[#007e72] hover:underline"><ExternalLink size={15} className="mr-1.5" /> Preview</a><Button size="sm" variant="ghost" className="ml-auto text-red-700 hover:bg-red-50 hover:text-red-800" disabled={remove.isPending} onClick={() => { if (window.confirm("Remove this showcase from the website? It cannot be restored; create a new one in Orbit if needed.")) remove.mutate({ id: showcase.id }); }}><Trash2 size={15} className="mr-1.5" /> Remove</Button></div><label className="mt-5 block border-t border-slate-100 pt-4 text-xs font-semibold text-[#52636c]"><span className="flex items-center gap-1.5"><CalendarClock size={14} /> Automatically hide after (optional)</span><Input type="date" defaultValue={asDateInput(showcase.expiresAt)} className="mt-2 max-w-[210px]" onBlur={(event) => { const date = event.target.value ? new Date(`${event.target.value}T23:59:59.999Z`) : null; if (asDateInput(showcase.expiresAt) !== event.target.value) setExpiry.mutate({ id: showcase.id, expiresAt: date }); }} /></label></div></article>;
    })}</section>}
    <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditingId(null); }}><DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle className="font-serif text-3xl text-[#102632]">Refine your public holiday idea</DialogTitle><DialogDescription>Your work is autosaved in this browser while you edit. When you publish, customer-safe changes update the live page immediately; do not include rate codes, product IDs, supplier data or Orbit references.</DialogDescription></DialogHeader>{isLoadingEditor || !editable ? <div className="h-80 animate-pulse rounded-2xl bg-slate-100" /> : <div className="space-y-6 py-2"><div className="grid gap-4 sm:grid-cols-2"><EditorField label="Holiday title"><Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></EditorField><EditorField label="Destination"><Input value={draft.destination} onChange={(event) => setDraft((current) => ({ ...current, destination: event.target.value }))} /></EditorField></div><EditorField label="Customer description" hint="Explain the feel of the holiday in plain English."><Textarea value={draft.summary} rows={5} maxLength={2000} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></EditorField><div className="grid gap-4 sm:grid-cols-3"><EditorField label="Travel period"><Input value={draft.travelPeriodLabel ?? ""} onChange={(event) => setDraft((current) => ({ ...current, travelPeriodLabel: event.target.value || null }))} placeholder="e.g. May 2027" /></EditorField><EditorField label="Nights"><Input type="number" min={1} max={60} value={draft.durationNights ?? ""} onChange={(event) => setDraft((current) => ({ ...current, durationNights: event.target.value ? Number(event.target.value) : null }))} /></EditorField><EditorField label="From price per person"><Input type="number" min={1} value={draft.priceAmount ?? ""} onChange={(event) => setDraft((current) => ({ ...current, priceAmount: event.target.value ? Number(event.target.value) : null }))} /></EditorField></div><CuratedSectionEditor sections={draft.curatedSections} uploading={uploadEditorImage.isPending} onUpload={(file, sectionId) => uploadImage(file, { sectionId })} onChange={(curatedSections) => setDraft((current) => ({ ...current, curatedSections }))} /><div className="grid gap-4 lg:grid-cols-2"><ListEditor label="Included" hint="One clear inclusion per line." items={draft.inclusions} onChange={(inclusions) => setDraft((current) => ({ ...current, inclusions }))} /><ListEditor label="Good to know" hint="One customer-friendly note per line." items={draft.practicalNotes} onChange={(practicalNotes) => setDraft((current) => ({ ...current, practicalNotes }))} /></div><EditorField label="Holiday tags" hint="Separate ideas with commas, for example Beach, Family, Culture."><Input value={draft.editorialTags.join(", ")} onChange={(event) => setDraft((current) => ({ ...current, editorialTags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} /></EditorField><section className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium text-[#102632]">Hero image</h3><p className="mt-1 text-xs text-slate-500">Add a new photo or keep the image supplied with the original showcase.</p></div><Label htmlFor="showcase-hero-upload" className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#102632] px-3 py-2 text-sm font-medium text-white"><Upload size={15} /> Upload image</Label><Input id="showcase-hero-upload" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => uploadImage(event.target.files?.[0], "hero")} /></div>{draft.heroImage && <div className="relative mt-4 overflow-hidden rounded-xl bg-slate-100"><img src={draft.heroImage.url} alt="Current showcase hero" className="aspect-[16/7] w-full object-cover" /><Button type="button" variant="secondary" size="sm" className="absolute right-3 top-3" onClick={() => setDraft((current) => ({ ...current, heroImage: null }))}><X size={14} className="mr-1" /> Remove</Button></div>}</section><section className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium text-[#102632]">General gallery images</h3><p className="mt-1 text-xs text-slate-500">For images not connected with an individual itinerary section.</p></div><Label htmlFor="showcase-gallery-upload" className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#008e81] px-3 py-2 text-sm font-medium text-[#007e72]"><ImagePlus size={15} /> Add image</Label><Input id="showcase-gallery-upload" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => uploadImage(event.target.files?.[0], "gallery")} /></div><div className="mt-4 grid gap-4 sm:grid-cols-2">{draft.itineraryImages.map((image, index) => <ImageEditor key={`${image.url}-${index}`} image={image} index={index} onChange={(next) => setDraft((current) => ({ ...current, itineraryImages: current.itineraryImages.map((item, itemIndex) => itemIndex === index ? next : item) }))} onRemove={() => setDraft((current) => ({ ...current, itineraryImages: current.itineraryImages.filter((_, itemIndex) => itemIndex !== index) }))} />)}</div>{draft.itineraryImages.length === 0 && <p className="mt-4 text-sm text-slate-500">No general gallery images yet.</p>}</section><EditorField label="Optional private note" hint="A personal reminder for yourself; it is not published."><Textarea value={agentNote} maxLength={500} rows={3} onChange={(event) => setAgentNote(event.target.value)} /></EditorField><div className="rounded-xl bg-[#f2faf8] p-3 text-xs leading-5 text-[#35635d]">Autosave is on — closing this window will not lose your work.{autosavedAt ? ` Last saved at ${new Date(autosavedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` : ""}</div></div>}<DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button><Button className="bg-[#008e81] hover:bg-[#00776d]" disabled={isLoadingEditor || submitEdit.isPending || uploadEditorImage.isPending} onClick={saveEditor}>{submitEdit.isPending ? "Publishing…" : <><Plus size={16} className="mr-1.5" /> Publish safe changes</>}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function CuratedSectionEditor({ sections, uploading, onUpload, onChange }: { sections: CuratedSection[]; uploading: boolean; onUpload: (file: File | undefined, sectionId: string) => void; onChange: (sections: CuratedSection[]) => void }) {
  const update = (sectionId: string, patch: Partial<CuratedSection>) => onChange(sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section));
  const move = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= sections.length) return;
    const next = [...sections];
    [next[index], next[destination]] = [next[destination], next[index]];
    onChange(next);
  };
  const remove = (sectionId: string) => onChange(sections.filter((section) => section.id !== sectionId));
  if (sections.length === 0) return null;
  return <section className="rounded-2xl border border-[#bdebe3] bg-[#f7fffd] p-4 sm:p-5">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#008e81]">Itinerary sections</p>
      <h3 className="mt-1 font-serif text-2xl text-[#102632]">Edit each customer-facing part of the trip</h3>
      <p className="mt-1 text-sm leading-6 text-[#61727a]">For a stay, use the details list for items such as <em>Grand Suite with extra bed</em> and <em>Bed &amp; Breakfast</em>. Add photos directly to the relevant section. The order below is the order customers see.</p>
    </div>
    <div className="mt-5 space-y-5">
      {sections.map((section, sectionIndex) => <article key={section.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#007e72]">{String(sectionIndex + 1).padStart(2, "0")} · {section.kind}</p>
          <div className="flex items-center gap-1">
            <span className="mr-1 rounded-full bg-[#eafbf8] px-3 py-1 text-xs font-medium text-[#2d746d]">Public section</span>
            <Button type="button" variant="ghost" size="icon" disabled={sectionIndex === 0} aria-label={`Move ${section.title} up`} onClick={() => move(sectionIndex, -1)}><ArrowUp size={16} /></Button>
            <Button type="button" variant="ghost" size="icon" disabled={sectionIndex === sections.length - 1} aria-label={`Move ${section.title} down`} onClick={() => move(sectionIndex, 1)}><ArrowDown size={16} /></Button>
            <Button type="button" variant="ghost" size="icon" className="text-red-700 hover:bg-red-50 hover:text-red-800" aria-label={`Delete ${section.title}`} onClick={() => { if (window.confirm(`Remove “${section.title}” from this public itinerary?`)) remove(section.id); }}><Trash2 size={16} /></Button>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <EditorField label="Section title"><Input value={section.title} onChange={(event) => update(section.id, { title: event.target.value })} /></EditorField>
          <EditorField label="Customer details" hint="One short fact per line; maximum five."><Textarea value={section.facts.join("\n")} rows={4} onChange={(event) => update(section.id, { facts: textLines(event.target.value).slice(0, 5) })} /></EditorField>
        </div>
        <EditorField label="Section description"><Textarea value={section.summary} rows={4} maxLength={600} onChange={(event) => update(section.id, { summary: event.target.value })} /></EditorField>
        <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm font-medium text-[#102632]">Images for this section</p><p className="mt-1 text-xs text-slate-500">Up to six customer-facing images. Use a short plain-English label.</p></div>
            <Label htmlFor={`showcase-section-upload-${section.id}`} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#008e81] px-3 py-2 text-sm font-medium text-[#007e72]"><ImagePlus size={15} /> Add image</Label>
            <Input id={`showcase-section-upload-${section.id}`} className="sr-only" type="file" disabled={uploading || section.images.length >= 6} accept="image/jpeg,image/png,image/webp" onChange={(event) => onUpload(event.target.files?.[0], section.id)} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{section.images.map((image, imageIndex) => <ImageEditor key={`${image.url}-${imageIndex}`} image={image} index={imageIndex} onChange={(next) => update(section.id, { images: section.images.map((item, itemIndex) => itemIndex === imageIndex ? next : item) })} onRemove={() => update(section.id, { images: section.images.filter((_, itemIndex) => itemIndex !== imageIndex) })} />)}</div>
          {section.images.length === 0 && <p className="mt-3 text-sm text-slate-500">No images attached to this section yet.</p>}
        </div>
      </article>)}
    </div>
  </section>;
}

function ImageEditor({ image, index, onChange, onRemove }: { image: GalleryImage; index: number; onChange: (image: GalleryImage) => void; onRemove: () => void }) {
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><img src={image.url} alt="Gallery preview" className="aspect-[16/9] w-full object-cover" /><div className="space-y-2 p-3"><Input value={image.label} aria-label={`Gallery image ${index + 1} label`} onChange={(event) => onChange({ ...image, label: event.target.value })} /><select value={image.category} aria-label={`Gallery image ${index + 1} category`} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => onChange({ ...image, category: event.target.value as ImageCategory })}><option value="hotel">Hotel</option><option value="cruise">Cruise</option><option value="experience">Experience</option></select><Button type="button" variant="ghost" size="sm" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={onRemove}><Trash2 size={14} className="mr-1.5" /> Remove image</Button></div></div>;
}

function EditorField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}{hint && <p className="text-xs leading-5 text-slate-500">{hint}</p>}</div>;
}

function ListEditor({ label, hint, items, onChange }: { label: string; hint: string; items: string[]; onChange: (items: string[]) => void }) {
  return <EditorField label={label} hint={hint}><Textarea value={items.join("\n")} rows={6} onChange={(event) => onChange(textLines(event.target.value))} /></EditorField>;
}
