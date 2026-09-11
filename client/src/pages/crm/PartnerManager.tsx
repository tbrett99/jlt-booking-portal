import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Building2, ExternalLink, ImageUp, Pencil, Plus, Save, X } from "lucide-react";

type Partner = {
  id: number;
  name: string;
  category: string | null;
  summary: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  isPublished: boolean;
  sortOrder: number;
};

type PartnerForm = {
  id?: number;
  name: string;
  category: string;
  summary: string;
  logoUrl: string;
  websiteUrl: string;
  isPublished: boolean;
  sortOrder: number;
};

const emptyForm = (): PartnerForm => ({ name: "", category: "", summary: "", logoUrl: "", websiteUrl: "", isPublished: false, sortOrder: 0 });

function toForm(partner: Partner): PartnerForm {
  return {
    id: partner.id,
    name: partner.name,
    category: partner.category ?? "",
    summary: partner.summary ?? "",
    logoUrl: partner.logoUrl ?? "",
    websiteUrl: partner.websiteUrl ?? "",
    isPublished: partner.isPublished,
    sortOrder: partner.sortOrder,
  };
}

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The logo could not be read."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export default function PartnerManager() {
  const utils = trpc.useUtils();
  const { data: partners = [], isLoading } = trpc.consumerSite.admin.listPartners.useQuery();
  const [form, setForm] = useState<PartnerForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const save = trpc.consumerSite.admin.savePartner.useMutation({
    onSuccess: ({ created }) => {
      toast.success(created ? "Partner saved as a draft." : "Partner details updated.");
      utils.consumerSite.admin.listPartners.invalidate();
      setForm(emptyForm());
      setShowForm(false);
    },
    onError: (error) => toast.error(error.message),
  });
  const upload = trpc.consumerSite.admin.uploadPartnerLogo.useMutation({
    onSuccess: ({ url }) => { setForm(current => ({ ...current, logoUrl: url })); toast.success("Logo uploaded. Remember to save the partner."); },
    onError: (error) => toast.error(error.message),
  });
  const update = <K extends keyof PartnerForm>(key: K, value: PartnerForm[K]) => setForm(current => ({ ...current, [key]: value }));
  const selectPartner = (partner: Partner) => { setForm(toForm(partner)); setShowForm(true); };
  const close = () => { setForm(emptyForm()); setShowForm(false); };
  const onLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) return toast.error("Use a JPG, PNG or WebP partner logo.");
    if (file.size > 3 * 1024 * 1024) return toast.error("Partner logos must be 3 MB or smaller.");
    try { upload.mutate({ fileBase64: await readAsBase64(file), fileName: file.name, mimeType: file.type as "image/jpeg" | "image/jpg" | "image/png" | "image/webp" }); } catch (error) { toast.error(error instanceof Error ? error.message : "The logo could not be read."); }
  };

  return <Card className="rounded-2xl border-slate-200 shadow-sm">
    <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
      <div><CardTitle className="flex items-center gap-2"><Building2 size={18} className="text-[#02b9a6]" /> Partners on the consumer website</CardTitle><CardDescription className="mt-1">Add a partner as a private draft, then choose when it is ready to appear publicly.</CardDescription></div>
      <Button size="sm" onClick={() => { setForm(emptyForm()); setShowForm(true); }}><Plus size={16} className="mr-1.5" /> Add partner</Button>
    </CardHeader>
    <CardContent className="space-y-4">
      {showForm && <form onSubmit={(event) => { event.preventDefault(); save.mutate({ id: form.id, name: form.name, category: form.category || null, summary: form.summary || null, logoUrl: form.logoUrl || null, websiteUrl: form.websiteUrl || null, isPublished: form.isPublished, sortOrder: Number(form.sortOrder) || 0 }); }} className="rounded-2xl border border-[#a8e4da] bg-[#f5fffd] p-5">
        <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{form.id ? "Edit partner" : "Add a partner"}</p><p className="mt-1 text-xs text-muted-foreground">Only tick public when the name, logo, link and copy have all been approved.</p></div><Button type="button" variant="ghost" size="icon" onClick={close} aria-label="Close partner editor"><X size={18} /></Button></div>
        <div className="mt-5 grid gap-4 md:grid-cols-2"><Field label="Partner name"><Input required value={form.name} onChange={event => update("name", event.target.value)} placeholder="e.g. Example Travel Co." /></Field><Field label="Category or destination coverage"><Input value={form.category} onChange={event => update("category", event.target.value)} placeholder="e.g. Tour operator · Indian Ocean" /></Field><Field label="Website address"><Input type="url" value={form.websiteUrl} onChange={event => update("websiteUrl", event.target.value)} placeholder="https://" /></Field><Field label="Display order"><Input type="number" min={0} value={form.sortOrder} onChange={event => update("sortOrder", Number(event.target.value))} /></Field></div>
        <div className="mt-4"><Field label="Short description"><Textarea value={form.summary} onChange={event => update("summary", event.target.value)} rows={4} placeholder="A concise, approved explanation of how this partner may help customers." /></Field></div>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]"><div><Label htmlFor="partner-logo">Partner logo</Label><div className="mt-1.5 flex items-center gap-3"><div className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white">{form.logoUrl ? <img src={form.logoUrl} alt="Partner logo preview" className="max-h-full max-w-full object-contain p-1" /> : <ImageUp className="text-slate-400" size={20} />}</div><Input id="partner-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogoChange} disabled={upload.isPending} className="max-w-sm" /></div><p className="mt-1.5 text-xs text-muted-foreground">PNG, JPG or WebP up to 3 MB. Upload only approved brand assets.</p></div><label className="flex items-center gap-2 self-center rounded-lg border bg-white px-3 py-2.5 text-sm font-medium cursor-pointer"><Checkbox checked={form.isPublished} onCheckedChange={value => update("isPublished", value === true)} /> Show on website</label></div>
        <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={save.isPending || !form.name.trim()}><Save size={16} className="mr-1.5" />{save.isPending ? "Saving…" : form.isPublished ? "Save & publish" : "Save draft"}</Button></div>
      </form>}
      {isLoading ? <div className="h-28 animate-pulse rounded-xl bg-slate-100" /> : partners.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-7 text-center"><Building2 className="mx-auto text-slate-400" size={24} /><p className="mt-3 text-sm font-medium">No partners added yet</p><p className="mt-1 text-xs text-muted-foreground">Use “Add partner” to create the first approved partner profile.</p></div> : <div className="grid gap-3 md:grid-cols-2">{partners.map(partner => <div key={partner.id} className="flex gap-3 rounded-xl border border-slate-200 p-3"><div className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-50">{partner.logoUrl ? <img src={partner.logoUrl} alt="" className="max-h-full max-w-full object-contain p-1" /> : <Building2 className="text-slate-400" size={19} />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-sm font-semibold">{partner.name}</p><Badge variant="outline" className={partner.isPublished ? "border-emerald-200 text-emerald-700" : "border-slate-200 text-slate-600"}>{partner.isPublished ? "Public" : "Draft"}</Badge></div><p className="mt-0.5 text-xs text-muted-foreground">{partner.category || "Uncategorised"} · Order {partner.sortOrder}</p>{partner.websiteUrl && <a href={partner.websiteUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-[#047d71] hover:underline">Visit link <ExternalLink size={11} /></a>}</div><Button variant="ghost" size="icon" className="shrink-0" onClick={() => selectPartner(partner)} aria-label={`Edit ${partner.name}`}><Pencil size={16} /></Button></div>)}</div>}
    </CardContent>
  </Card>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium"><span>{label}</span>{children}</label>; }
