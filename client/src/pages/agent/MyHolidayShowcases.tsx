import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Eye, EyeOff, ExternalLink, ImagePlus, MapPin, PenLine, PlaneTakeoff, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type GalleryImage = { url: string; source: "supplier" | "agent_upload"; label: string; category: "hotel" | "cruise" | "experience" };
type ShowcaseDraft = {
  title: string;
  summary: string;
  destination: string;
  travelPeriodLabel: string | null;
  durationNights: number | null;
  priceAmount: number | null;
  heroImage: { url: string; source: "supplier" | "agent_upload" } | null;
  itineraryImages: GalleryImage[];
  editorialTags: string[];
  inclusions: string[];
  practicalNotes: string[];
};

const emptyDraft: ShowcaseDraft = { title: "", summary: "", destination: "", travelPeriodLabel: null, durationNights: null, priceAmount: null, heroImage: null, itineraryImages: [], editorialTags: [], inclusions: [], practicalNotes: [] };

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

function asDraft(value: unknown): ShowcaseDraft {
  if (!value || typeof value !== "object") return emptyDraft;
  const source = value as Partial<ShowcaseDraft>;
  return {
    title: source.title ?? "", summary: source.summary ?? "", destination: source.destination ?? "",
    travelPeriodLabel: source.travelPeriodLabel ?? null, durationNights: source.durationNights ?? null, priceAmount: source.priceAmount ?? null,
    heroImage: source.heroImage ?? null,
    itineraryImages: Array.isArray(source.itineraryImages) ? source.itineraryImages as GalleryImage[] : [],
    editorialTags: Array.isArray(source.editorialTags) ? source.editorialTags : [],
    inclusions: Array.isArray(source.inclusions) ? source.inclusions : [],
    practicalNotes: Array.isArray(source.practicalNotes) ? source.practicalNotes : [],
  };
}

export default function MyHolidayShowcases() {
  const utils = trpc.useUtils();
  const { data: showcases = [], isLoading } = trpc.consumerSite.showcases.mine.useQuery();
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ShowcaseDraft>(emptyDraft);
  const [agentNote, setAgentNote] = useState("");
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
    onSuccess: () => { toast.success("Your Holiday Showcase changes are now waiting for JLT review."); utils.consumerSite.showcases.mine.invalidate(); utils.consumerSite.showcases.editable.invalidate(); setEditOpen(false); setEditingId(null); },
    onError: (error) => toast.error(error.message),
  });
  const active = useMemo(() => showcases.filter((showcase) => !showcase.deletedAt), [showcases]);

  useEffect(() => {
    if (!editable) return;
    setDraft(asDraft(editable.draft));
    setAgentNote(editable.pending?.agentNote ?? "");
  }, [editable]);

  const move = (id: number, direction: -1 | 1) => {
    const index = active.findIndex((item) => item.id === id);
    const replacement = index + direction;
    if (index < 0 || replacement < 0 || replacement >= active.length) return;
    const ordered = [...active];
    [ordered[index], ordered[replacement]] = [ordered[replacement], ordered[index]];
    reorder.mutate({ ids: ordered.map((item) => item.id) });
  };

  const openEditor = (id: number) => { setEditingId(id); setDraft(emptyDraft); setAgentNote(""); setEditOpen(true); };
  const uploadImage = (file: File | undefined, target: "hero" | "gallery") => {
    if (!file || editingId === null) return;
    if (!(["image/jpeg", "image/jpg", "image/png", "image/webp"] as string[]).includes(file.type)) return toast.error("Use a JPG, PNG, or WEBP image.");
    if (file.size > 6 * 1024 * 1024) return toast.error("Holiday Showcase images must be 6 MB or smaller.");
    const reader = new FileReader();
    reader.onload = () => {
      const fileBase64 = typeof reader.result === "string" ? reader.result.split(",")[1] : null;
      if (!fileBase64) return toast.error("The image could not be read.");
      uploadEditorImage.mutate({ id: editingId, fileBase64, fileName: file.name, mimeType: file.type as "image/jpeg" | "image/jpg" | "image/png" | "image/webp" }, {
        onSuccess: ({ url, source }) => setDraft((current) => target === "hero" ? { ...current, heroImage: { url, source } } : { ...current, itineraryImages: [...current.itineraryImages, { url, source, label: "Holiday moment", category: "experience" }] }),
      });
    };
    reader.readAsDataURL(file);
  };

  const saveEditor = () => {
    if (editingId === null) return;
    if (!draft.title.trim() || !draft.summary.trim() || !draft.destination.trim()) return toast.error("Add a customer-friendly title, description, and destination before submitting.");
    submitEdit.mutate({ id: editingId, draft: { ...draft, title: draft.title.trim(), summary: draft.summary.trim(), destination: draft.destination.trim(), travelPeriodLabel: draft.travelPeriodLabel?.trim() || null, editorialTags: draft.editorialTags.map((item) => item.trim()).filter(Boolean), inclusions: draft.inclusions.map((item) => item.trim()).filter(Boolean), practicalNotes: draft.practicalNotes.map((item) => item.trim()).filter(Boolean) }, agentNote: agentNote.trim() || null });
  };

  return <div className="mx-auto max-w-6xl space-y-7 p-4 md:p-6">
    <section className="overflow-hidden rounded-3xl bg-[#102632] px-6 py-8 text-white shadow-sm sm:px-9"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#70ffe8]"><PlaneTakeoff size={15} /> Portal-owned snapshots</p><h1 className="mt-3 font-serif text-4xl tracking-[-.04em] sm:text-5xl">My Holiday Showcases</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Create an itinerary in Orbit, then choose <strong className="text-white">Create public showcase</strong>. You can refine customer-facing wording, imagery, tags and inclusions here; JLT reviews every change before it appears publicly.</p></div><div className="rounded-2xl bg-white/10 px-5 py-4"><p className="text-xs text-slate-300">Currently visible</p><p className="mt-1 font-serif text-4xl text-[#70ffe8]">{active.filter((item) => item.isPublished && (!item.expiresAt || new Date(item.expiresAt) > new Date())).length}</p></div></div></section>
    <section className="rounded-2xl border border-[#bdebe3] bg-[#effbf8] p-5 text-sm leading-6 text-[#315d59]"><strong className="text-[#102632]">A public, staff-reviewed edit layer:</strong> your original Orbit snapshot remains on file. Use the editor for clear customer copy, realistic inclusions and inspiring images—not rate codes, room rules, supplier references or internal booking information.</section>
    {isLoading ? <div className="grid gap-5 md:grid-cols-2">{[1, 2].map((item) => <div key={item} className="h-72 animate-pulse rounded-3xl bg-slate-100" />)}</div> : active.length === 0 ? <section className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><PlaneTakeoff className="mx-auto text-[#008e81]" size={32} /><h2 className="mt-5 font-serif text-3xl text-[#102632]">No holiday showcases yet.</h2><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#64747d]">Your public holiday ideas begin in Orbit. When you create a public showcase there, it will appear here as a fixed snapshot ready to manage on your profile.</p></section> : <section className="grid gap-5 md:grid-cols-2">{active.map((showcase, index) => {
      const expired = showcase.expiresAt ? new Date(showcase.expiresAt) <= new Date() : false;
      const visible = showcase.isPublished && !expired;
      return <article key={showcase.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="relative h-44 bg-[#eafbf8]">{showcase.heroImageUrl ? <img src={showcase.heroImageUrl} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <div className="grid h-full place-items-center bg-[#102632] text-[#70ffe8]"><PlaneTakeoff size={30} /></div>}<span className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-semibold ${visible ? "bg-[#70ffe8] text-[#102632]" : "bg-white text-[#596971]"}`}>{expired ? "Expired" : visible ? "Visible" : "Hidden"}</span></div><div className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="inline-flex items-center gap-1 text-xs font-medium text-[#008e81]"><MapPin size={13} /> {showcase.destination}</p><h2 className="mt-2 font-serif text-2xl leading-tight text-[#102632]">{showcase.title}</h2></div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" disabled={index === 0 || reorder.isPending} aria-label="Move showcase up" onClick={() => move(showcase.id, -1)}><ArrowUp size={17} /></Button><Button variant="ghost" size="icon" disabled={index === active.length - 1 || reorder.isPending} aria-label="Move showcase down" onClick={() => move(showcase.id, 1)}><ArrowDown size={17} /></Button></div></div><p className="mt-3 text-sm text-[#64747d]">{showcase.durationNights ? `${showcase.durationNights} nights` : "Itinerary"}{showcase.travelPeriodLabel ? ` · ${showcase.travelPeriodLabel}` : ""}{formatMoney(showcase.priceAmount, showcase.priceCurrency) ? ` · From ${formatMoney(showcase.priceAmount, showcase.priceCurrency)} pp` : ""}</p><div className="mt-5 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openEditor(showcase.id)}><PenLine size={15} className="mr-1.5" /> Edit public copy</Button><Button size="sm" variant={visible ? "outline" : "default"} disabled={setPublished.isPending} onClick={() => setPublished.mutate({ id: showcase.id, isPublished: !showcase.isPublished })}>{visible ? <><EyeOff size={15} className="mr-1.5" /> Hide</> : <><Eye size={15} className="mr-1.5" /> Show on website</>}</Button><a href={`/consumer/travel-agents/holiday-showcases/${showcase.publicSlug}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md px-2 text-sm font-medium text-[#007e72] hover:underline"><ExternalLink size={15} className="mr-1.5" /> Preview</a><Button size="sm" variant="ghost" className="ml-auto text-red-700 hover:bg-red-50 hover:text-red-800" disabled={remove.isPending} onClick={() => { if (window.confirm("Remove this showcase from the website? It cannot be restored; create a new one in Orbit if needed.")) remove.mutate({ id: showcase.id }); }}><Trash2 size={15} className="mr-1.5" /> Remove</Button></div><label className="mt-5 block border-t border-slate-100 pt-4 text-xs font-semibold text-[#52636c]"><span className="flex items-center gap-1.5"><CalendarClock size={14} /> Automatically hide after (optional)</span><Input type="date" defaultValue={asDateInput(showcase.expiresAt)} className="mt-2 max-w-[210px]" onBlur={(event) => { const date = event.target.value ? new Date(`${event.target.value}T23:59:59.999Z`) : null; if (asDateInput(showcase.expiresAt) !== event.target.value) setExpiry.mutate({ id: showcase.id, expiresAt: date }); }} /></label></div></article>;
    })}</section>}
    <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditingId(null); }}><DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle className="font-serif text-3xl text-[#102632]">Refine your public holiday idea</DialogTitle><DialogDescription>JLT reviews changes before they are published. Keep it inspirational and customer-facing; do not include room rules, rate codes, supplier data, product IDs or Orbit references.</DialogDescription></DialogHeader>{isLoadingEditor || !editable ? <div className="h-80 animate-pulse rounded-2xl bg-slate-100" /> : <div className="space-y-6 py-2"><div className="grid gap-4 sm:grid-cols-2"><EditorField label="Holiday title"><Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></EditorField><EditorField label="Destination"><Input value={draft.destination} onChange={(event) => setDraft((current) => ({ ...current, destination: event.target.value }))} /></EditorField></div><EditorField label="Customer description" hint="Explain the feel of the holiday in plain English."><Textarea value={draft.summary} rows={5} maxLength={2000} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></EditorField><div className="grid gap-4 sm:grid-cols-3"><EditorField label="Travel period"><Input value={draft.travelPeriodLabel ?? ""} onChange={(event) => setDraft((current) => ({ ...current, travelPeriodLabel: event.target.value || null }))} placeholder="e.g. May 2027" /></EditorField><EditorField label="Nights"><Input type="number" min={1} max={60} value={draft.durationNights ?? ""} onChange={(event) => setDraft((current) => ({ ...current, durationNights: event.target.value ? Number(event.target.value) : null }))} /></EditorField><EditorField label="From price per person"><Input type="number" min={1} value={draft.priceAmount ?? ""} onChange={(event) => setDraft((current) => ({ ...current, priceAmount: event.target.value ? Number(event.target.value) : null }))} /></EditorField></div><div className="grid gap-4 lg:grid-cols-2"><ListEditor label="Included" hint="One clear inclusion per line." items={draft.inclusions} onChange={(items) => setDraft((current) => ({ ...current, inclusions: items }))} /><ListEditor label="Good to know" hint="One customer-friendly note per line." items={draft.practicalNotes} onChange={(items) => setDraft((current) => ({ ...current, practicalNotes: items }))} /></div><EditorField label="Holiday tags" hint="Separate ideas with commas, for example Beach, Family, Culture."><Input value={draft.editorialTags.join(", ")} onChange={(event) => setDraft((current) => ({ ...current, editorialTags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} /></EditorField><section className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium text-[#102632]">Hero image</h3><p className="mt-1 text-xs text-slate-500">Add a new photo or keep the image supplied with the original showcase.</p></div><Label htmlFor="showcase-hero-upload" className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#102632] px-3 py-2 text-sm font-medium text-white"><Upload size={15} /> Upload image</Label><Input id="showcase-hero-upload" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => uploadImage(event.target.files?.[0], "hero")} /></div>{draft.heroImage && <div className="relative mt-4 overflow-hidden rounded-xl bg-slate-100"><img src={draft.heroImage.url} alt="Current showcase hero" className="aspect-[16/7] w-full object-cover" /><Button type="button" variant="secondary" size="sm" className="absolute right-3 top-3" onClick={() => setDraft((current) => ({ ...current, heroImage: null }))}><X size={14} className="mr-1" /> Remove</Button></div>}</section><section className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium text-[#102632]">Gallery images</h3><p className="mt-1 text-xs text-slate-500">Add a short label and a category to help customers understand each image.</p></div><Label htmlFor="showcase-gallery-upload" className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#008e81] px-3 py-2 text-sm font-medium text-[#007e72]"><ImagePlus size={15} /> Add image</Label><Input id="showcase-gallery-upload" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => uploadImage(event.target.files?.[0], "gallery")} /></div><div className="mt-4 grid gap-4 sm:grid-cols-2">{draft.itineraryImages.map((image, index) => <div key={`${image.url}-${index}`} className="overflow-hidden rounded-xl border border-slate-200"><img src={image.url} alt="Gallery preview" className="aspect-[16/9] w-full object-cover" /><div className="space-y-2 p-3"><Input value={image.label} aria-label={`Gallery image ${index + 1} label`} onChange={(event) => setDraft((current) => ({ ...current, itineraryImages: current.itineraryImages.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) }))} /><select value={image.category} aria-label={`Gallery image ${index + 1} category`} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setDraft((current) => ({ ...current, itineraryImages: current.itineraryImages.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value as GalleryImage["category"] } : item) }))}><option value="hotel">Hotel</option><option value="cruise">Cruise</option><option value="experience">Experience</option></select><Button type="button" variant="ghost" size="sm" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setDraft((current) => ({ ...current, itineraryImages: current.itineraryImages.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={14} className="mr-1.5" /> Remove image</Button></div></div>)}</div>{draft.itineraryImages.length === 0 && <p className="mt-4 text-sm text-slate-500">No gallery images yet.</p>}</section><EditorField label="Message for JLT review" hint="Optional: tell the team what you changed or why."><Textarea value={agentNote} maxLength={500} rows={3} onChange={(event) => setAgentNote(event.target.value)} /></EditorField>{editable.pending && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">You already have an edit awaiting review. Saving this form updates that submission rather than creating a duplicate.</div>}</div>}<DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button><Button className="bg-[#008e81] hover:bg-[#00776d]" disabled={isLoadingEditor || submitEdit.isPending || uploadEditorImage.isPending} onClick={saveEditor}>{submitEdit.isPending ? "Submitting…" : <><Plus size={16} className="mr-1.5" /> Submit edits for review</>}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function EditorField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}{hint && <p className="text-xs leading-5 text-slate-500">{hint}</p>}</div>;
}

function ListEditor({ label, hint, items, onChange }: { label: string; hint: string; items: string[]; onChange: (items: string[]) => void }) {
  return <EditorField label={label} hint={hint}><Textarea value={items.join("\n")} rows={6} onChange={(event) => onChange(textLines(event.target.value))} /></EditorField>;
}
