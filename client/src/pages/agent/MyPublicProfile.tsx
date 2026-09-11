import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, Clock3, FileImage, Globe2, Info, MapPin, Send, ShieldCheck, Sparkles, Upload } from "lucide-react";

const initialForm = {
  displayName: "",
  businessName: "",
  biography: "",
  listingTown: "",
  enquiryDeliveryEmail: "",
  websiteUrl: "",
  instagramUrl: "",
  tiktokUrl: "",
  facebookUrl: "",
  linkedinUrl: "",
  youtubeUrl: "",
  pinterestUrl: "",
};

const channels = [
  ["websiteUrl", "Website"],
  ["instagramUrl", "Instagram"],
  ["tiktokUrl", "TikTok"],
  ["facebookUrl", "Facebook"],
  ["linkedinUrl", "LinkedIn"],
  ["youtubeUrl", "YouTube"],
  ["pinterestUrl", "Pinterest"],
] as const;

type FormState = typeof initialForm;

const statusStyle: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  in_review: "bg-amber-50 text-amber-800 border-amber-200",
  changes_requested: "bg-rose-50 text-rose-800 border-rose-200",
  published: "bg-emerald-50 text-emerald-800 border-emerald-200",
  hidden: "bg-slate-100 text-slate-700 border-slate-200",
};

function statusLabel(status?: string) {
  return (status ?? "draft").replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

export default function MyPublicProfile() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: profileData, isLoading } = trpc.consumerSite.profile.mine.useQuery();
  const { data: tags = [] } = trpc.consumerSite.tags.list.useQuery();
  const [form, setForm] = useState<FormState>(initialForm);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [consent, setConsent] = useState(false);
  const [initialisedForProfileId, setInitialisedForProfileId] = useState<number | null | undefined>(undefined);

  const profile = profileData?.profile;
  useEffect(() => {
    if (initialisedForProfileId === profile?.id) return;
    setInitialisedForProfileId(profile?.id ?? null);
    setForm({
      displayName: profile?.displayName ?? user?.name ?? "",
      businessName: profile?.businessName ?? "",
      biography: profile?.biography ?? "",
      listingTown: profile?.listingTown ?? "",
      enquiryDeliveryEmail: profile?.enquiryDeliveryEmail ?? "",
      websiteUrl: profile?.websiteUrl ?? "",
      instagramUrl: profile?.instagramUrl ?? "",
      tiktokUrl: profile?.tiktokUrl ?? "",
      facebookUrl: profile?.facebookUrl ?? "",
      linkedinUrl: profile?.linkedinUrl ?? "",
      youtubeUrl: profile?.youtubeUrl ?? "",
      pinterestUrl: profile?.pinterestUrl ?? "",
    });
    setSelectedTagIds(profileData?.selectedTagIds ?? []);
    setConsent(Boolean(profile?.consentConfirmedAt));
  }, [initialisedForProfileId, profile, profileData?.selectedTagIds, user?.name]);

  const saveDraft = trpc.consumerSite.profile.saveDraft.useMutation({
    onSuccess: () => {
      toast.success("Your public-profile draft has been saved.");
      utils.consumerSite.profile.mine.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const submitForReview = trpc.consumerSite.profile.submitForReview.useMutation({
    onSuccess: () => {
      toast.success("Your public profile has been submitted for JLT review.");
      utils.consumerSite.profile.mine.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const uploadPhoto = trpc.consumerSite.profile.uploadPhoto.useMutation({
    onSuccess: () => {
      toast.success("Profile photograph uploaded. Remember to save your draft.");
      utils.consumerSite.profile.mine.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const destinationTags = useMemo(() => tags.filter(tag => tag.category === "destination"), [tags]);
  const travelTypeTags = useMemo(() => tags.filter(tag => tag.category === "travel_type"), [tags]);
  const isSaved = Boolean(profile?.id);
  const liveProfileUrl = profile?.isPublished && profile.publicSlug ? `https://www.thejltgroup.co.uk/travel-agents/${profile.publicSlug}` : null;

  const update = (field: keyof FormState, value: string) => setForm(current => ({ ...current, [field]: value }));
  const toggleTag = (id: number, checked: boolean) => setSelectedTagIds(current => checked ? [...current, id] : current.filter(tagId => tagId !== id));

  const handlePhoto = (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/jpg", "image/png"].includes(file.type)) {
      toast.error("Please upload a JPG or PNG profile photograph.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Profile photographs must be 5 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result.split(",")[1] : null;
      if (!result) return toast.error("The image could not be read.");
      uploadPhoto.mutate({ fileBase64: result, fileName: file.name, mimeType: file.type as "image/jpeg" | "image/jpg" | "image/png" });
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!consent) {
      toast.error("Please confirm that you understand the public-profile consent statement before saving.");
      return;
    }
    saveDraft.mutate({
      ...form,
      townLatitude: null,
      townLongitude: null,
      specialityTagIds: selectedTagIds,
      consentConfirmed: true,
    });
  };

  if (isLoading) {
    return <div className="p-6 space-y-4 max-w-5xl mx-auto">{[1, 2, 3].map(item => <div className="h-40 rounded-2xl bg-muted animate-pulse" key={item} />)}</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 pb-12">
      <section className="relative overflow-hidden rounded-3xl bg-[#0d1a26] text-white px-6 py-8 sm:px-8 sm:py-10">
        <div className="absolute -right-12 -top-10 w-48 h-48 rounded-full bg-[#70ffe8]/15 blur-2xl" />
        <div className="relative max-w-3xl">
          <Badge className="bg-[#70ffe8] text-[#0d1a26] hover:bg-[#70ffe8] border-0 mb-4">JLT Consumer Website</Badge>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Create your public travel profile</h1>
          <p className="mt-3 text-slate-300 leading-relaxed">Tell prospective customers what you specialise in and how you can help. Your draft is never public until the JLT team has reviewed and published it.</p>
          <div className="flex flex-wrap gap-2 mt-5 text-sm">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5"><ShieldCheck size={15} className="text-[#70ffe8]" /> No contact details are published</span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5"><CheckCircle2 size={15} className="text-[#70ffe8]" /> Active agents only</span>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_290px]">
        <div className="space-y-6">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles size={18} className="text-[#02b9a6]" /> Your public introduction</CardTitle>
              <CardDescription>This content will be reviewed by JLT before it can appear on the consumer website.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Display name" required><Input value={form.displayName} onChange={event => update("displayName", event.target.value)} placeholder="Your professional name" /></Field>
                <Field label="Business / trading name"><Input value={form.businessName} onChange={event => update("businessName", event.target.value)} placeholder="Optional" /></Field>
              </div>
              <Field label="About you" hint="At least 80 characters. Describe the kind of holidays you love arranging and the service customers can expect." required>
                <Textarea value={form.biography} onChange={event => update("biography", event.target.value)} rows={7} maxLength={2000} placeholder="For example: I create tailor-made family adventures and special occasion escapes..." />
                <p className="text-xs text-muted-foreground text-right">{form.biography.length}/2,000</p>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Listing town" hint="Only your town will be shown on the map — never your address or postcode." required><Input value={form.listingTown} onChange={event => update("listingTown", event.target.value)} placeholder="e.g. Chester" /></Field>
                <Field label="Private enquiry delivery email" hint="This is not displayed online. Website enquiries are securely sent here." required><Input type="email" value={form.enquiryDeliveryEmail} onChange={event => update("enquiryDeliveryEmail", event.target.value)} placeholder="you@yourbusiness.co.uk" /></Field>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MapPin size={18} className="text-[#02b9a6]" /> Your travel specialities</CardTitle>
              <CardDescription>Choose the destinations and holiday types you want customers to be able to find you for. Select at least one before submitting.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <TagPicker label="Destinations" emptyText="JLT has not added destination tags yet." tags={destinationTags} selectedTagIds={selectedTagIds} onToggle={toggleTag} />
              <TagPicker label="Travel types" emptyText="JLT has not added travel-type tags yet." tags={travelTypeTags} selectedTagIds={selectedTagIds} onToggle={toggleTag} />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Globe2 size={18} className="text-[#02b9a6]" /> Optional website and social links</CardTitle>
              <CardDescription>Use full secure links. Clean icons only appear on your public profile where an approved link has been provided.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {channels.map(([field, label]) => <Field label={label} key={field}><Input type="url" value={form[field]} onChange={event => update(field, event.target.value)} placeholder={field === "websiteUrl" ? "https://yourwebsite.co.uk" : `https://${label.toLowerCase()}.com/...`} /></Field>)}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileImage size={18} className="text-[#02b9a6]" /> Profile photograph</CardTitle>
              <CardDescription>Use a clear, professional headshot. JPG and PNG files up to 5 MB are accepted.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="w-24 h-24 rounded-2xl bg-slate-100 overflow-hidden flex items-center justify-center border border-slate-200 shrink-0">
                {profile?.profilePhotoUrl ? <img src={profile.profilePhotoUrl} alt="Your uploaded profile" className="w-full h-full object-cover" /> : <FileImage className="text-slate-400" size={28} />}
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-photo" className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"><Upload size={16} /> Upload photograph</Label>
                <Input id="profile-photo" className="sr-only" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={event => handlePhoto(event.target.files?.[0])} />
                <p className="text-xs text-muted-foreground">Photographs are shown publicly only after staff approval.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardContent className="pt-6">
              <label className="flex gap-3 cursor-pointer items-start">
                <Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} className="mt-0.5" />
                <span className="text-sm leading-relaxed"><strong>I confirm that this is accurate public-facing information</strong> and I give JLT permission to review and publish it on the JLT consumer website. I understand that my direct email address and personal contact details will not be shown publicly.</span>
              </label>
              <div className="flex flex-col-reverse sm:flex-row gap-3 justify-end mt-6">
                <Button variant="outline" onClick={handleSave} disabled={saveDraft.isPending || uploadPhoto.isPending}>{saveDraft.isPending ? "Saving…" : "Save draft"}</Button>
                <Button className="bg-[#02b9a6] hover:bg-[#019b8c] text-white" onClick={() => submitForReview.mutate()} disabled={!isSaved || submitForReview.isPending}>{submitForReview.isPending ? "Submitting…" : <><Send size={16} className="mr-2" /> Submit for review</>}</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="rounded-2xl border-slate-200 shadow-sm sticky top-6">
            <CardHeader className="pb-3"><CardTitle className="text-base">Publication status</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Badge variant="outline" className={`capitalize ${statusStyle[profile?.reviewStatus ?? "draft"]}`}>{profile?.reviewStatus === "in_review" ? <Clock3 className="mr-1.5" size={13} /> : <Info className="mr-1.5" size={13} />}{statusLabel(profile?.reviewStatus)}</Badge>
              {profile?.reviewNote && <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-sm"><p className="font-medium text-slate-800">JLT review note</p><p className="mt-1 text-slate-600 leading-relaxed">{profile.reviewNote}</p></div>}
              {profile?.isPublished ? <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-900"><p className="font-medium flex items-center gap-1.5"><CheckCircle2 size={15} /> Profile live</p><p className="mt-1 text-emerald-800">Your currently approved profile is visible while your agent status remains Active.</p>{liveProfileUrl && <a href={liveProfileUrl} target="_blank" rel="noreferrer" className="inline-block mt-2 font-medium underline">View public profile</a>}</div> : <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-sm text-slate-600">Your profile is not public yet. It will only go live after a JLT team member approves it and your agent status is Active.</div>}
              <div className="border-t pt-4 text-xs leading-relaxed text-muted-foreground"><p className="font-medium text-slate-700 mb-1">How it works</p><ol className="space-y-2 list-decimal list-inside"><li>Save your draft.</li><li>Submit it for JLT review.</li><li>JLT publishes your approved profile.</li><li>Any later update remains a draft until approved.</li></ol></div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}{required && <span className="text-rose-600"> *</span>}</Label>{children}{hint && <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>}</div>;
}

function TagPicker({ label, emptyText, tags, selectedTagIds, onToggle }: { label: string; emptyText: string; tags: Array<{ id: number; label: string }>; selectedTagIds: number[]; onToggle: (id: number, checked: boolean) => void }) {
  return <div><p className="text-sm font-medium mb-3">{label}</p>{tags.length === 0 ? <p className="text-sm text-muted-foreground">{emptyText}</p> : <div className="flex flex-wrap gap-2">{tags.map(tag => <label key={tag.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${selectedTagIds.includes(tag.id) ? "border-[#02b9a6] bg-[#e6fbf7] text-[#056b61]" : "border-slate-200 hover:border-slate-300 text-slate-700"}`}><Checkbox className="sr-only" checked={selectedTagIds.includes(tag.id)} onCheckedChange={checked => onToggle(tag.id, checked === true)} />{tag.label}</label>)}</div>}</div>;
}
