import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, EyeOff, Globe2, ListChecks, Mail, MapPin, MessageSquareText, Plus, Send, UserRoundCheck, XCircle } from "lucide-react";
import PartnerManager from "./PartnerManager";

type ReviewAction = "publish" | "request_changes" | "hide";

const statusStyles: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  in_review: "bg-amber-100 text-amber-800",
  changes_requested: "bg-rose-100 text-rose-800",
  published: "bg-emerald-100 text-emerald-800",
  hidden: "bg-slate-100 text-slate-700",
};

function humanize(value?: string | null) { return (value ?? "draft").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

export default function PublicProfiles() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"all" | "draft" | "in_review" | "changes_requested" | "published" | "hidden">("in_review");
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [tagLabel, setTagLabel] = useState("");
  const [tagCategory, setTagCategory] = useState<"destination" | "travel_type">("destination");
  const { data: profiles = [], isLoading } = trpc.consumerSite.admin.listProfiles.useQuery({ status: filter });
  const { data: selected } = trpc.consumerSite.admin.profileDetails.useQuery({ userId: selectedAgentId! }, { enabled: selectedAgentId !== null });
  const { data: tags = [] } = trpc.consumerSite.tags.list.useQuery();
  const { data: enquiries = [] } = trpc.consumerSite.admin.listEnquiries.useQuery({ limit: 8 });

  const review = trpc.consumerSite.admin.reviewProfile.useMutation({
    onSuccess: () => {
      toast.success(reviewAction === "publish" ? "Profile published." : reviewAction === "hide" ? "Profile hidden." : "Changes requested from the agent.");
      setReviewAction(null); setReviewNote(""); setSelectedAgentId(null);
      utils.consumerSite.admin.listProfiles.invalidate(); utils.consumerSite.admin.profileDetails.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const createTag = trpc.consumerSite.tags.create.useMutation({
    onSuccess: () => { toast.success("Speciality tag added."); setTagLabel(""); utils.consumerSite.tags.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const setTagActive = trpc.consumerSite.tags.setActive.useMutation({
    onSuccess: () => utils.consumerSite.tags.list.invalidate(),
    onError: error => toast.error(error.message),
  });

  const pendingCount = useMemo(() => profiles.filter(row => row.profile.reviewStatus === "in_review").length, [profiles]);
  const selectedProfile = selected?.profile;

  return <div className="p-6 max-w-7xl mx-auto space-y-6 pb-12">
    <section className="rounded-3xl bg-[#0d1a26] px-6 py-7 text-white sm:px-8">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5"><div><Badge className="border-0 bg-[#70ffe8] text-[#0d1a26] hover:bg-[#70ffe8] mb-3">Consumer website controls</Badge><h1 className="text-2xl sm:text-3xl font-semibold">Public agent profiles</h1><p className="mt-2 max-w-2xl text-slate-300">Review every public profile and link before it goes live. Only agents who remain Active can appear at <span className="text-white font-medium">www.thejltgroup.co.uk</span>.</p></div><div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm"><p className="text-slate-300">Awaiting review</p><p className="text-2xl font-semibold mt-0.5">{pendingCount}</p></div></div>
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardHeader className="flex-row items-center justify-between gap-4 space-y-0"><div><CardTitle>Profile review queue</CardTitle><CardDescription>Edits remain private until you publish the latest approved snapshot.</CardDescription></div><Select value={filter} onValueChange={value => setFilter(value as typeof filter)}><SelectTrigger className="w-[175px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in_review">In review</SelectItem><SelectItem value="published">Published</SelectItem><SelectItem value="changes_requested">Changes requested</SelectItem><SelectItem value="draft">Drafts</SelectItem><SelectItem value="hidden">Hidden</SelectItem><SelectItem value="all">All profiles</SelectItem></SelectContent></Select></CardHeader><CardContent>
          {isLoading ? <div className="space-y-3">{[1, 2, 3].map(n => <div key={n} className="h-28 rounded-xl bg-muted animate-pulse" />)}</div> : profiles.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center"><UserRoundCheck className="mx-auto text-slate-400" /><p className="mt-3 font-medium">No profiles in this view</p><p className="mt-1 text-sm text-muted-foreground">Profiles will appear here once an agent has saved a draft.</p></div> : <div className="space-y-3">{profiles.map(row => <button type="button" key={row.profile.id} onClick={() => setSelectedAgentId(row.profile.userId)} className="block text-left w-full rounded-2xl border border-slate-200 p-4 hover:border-[#02b9a6] hover:bg-[#f4fffd] transition-colors"><div className="flex gap-4"><div className="h-12 w-12 rounded-xl bg-slate-100 overflow-hidden flex shrink-0 items-center justify-center">{row.profile.profilePhotoUrl ? <img src={row.profile.profilePhotoUrl} alt="" className="h-full w-full object-cover" /> : <UserRoundCheck className="text-slate-400" size={21} />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-900 truncate">{row.profile.displayName || row.agentName || "Unnamed agent"}</p><Badge className={statusStyles[row.profile.reviewStatus]}>{humanize(row.profile.reviewStatus)}</Badge><Badge variant="outline" className="text-xs">Agent: {humanize(row.agentStatus ?? "not set")}</Badge></div><p className="text-sm text-slate-600 mt-1 truncate">{row.profile.businessName || "No business name"} {row.profile.listingTown ? `· ${row.profile.listingTown}` : ""}</p><p className="mt-2 text-xs text-muted-foreground">Updated {new Date(row.profile.updatedAt).toLocaleDateString("en-GB")}</p></div></div></button>)}</div>}
        </CardContent></Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><ListChecks size={18} className="text-[#02b9a6]" /> Speciality tags</CardTitle><CardDescription>These controlled tags are the filter choices visible to consumers. Agents can select them but cannot create their own labels.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-col sm:flex-row gap-3"><Input value={tagLabel} onChange={event => setTagLabel(event.target.value)} placeholder="e.g. Caribbean" /><Select value={tagCategory} onValueChange={value => setTagCategory(value as typeof tagCategory)}><SelectTrigger className="sm:w-[180px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="destination">Destination</SelectItem><SelectItem value="travel_type">Travel type</SelectItem></SelectContent></Select><Button onClick={() => createTag.mutate({ label: tagLabel, category: tagCategory })} disabled={tagLabel.trim().length < 2 || createTag.isPending}><Plus size={16} className="mr-2" /> Add tag</Button></div><div className="grid gap-3 md:grid-cols-2">{tags.map(tag => <div key={tag.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5"><div><p className="text-sm font-medium">{tag.label}</p><p className="text-xs text-muted-foreground">{tag.category === "destination" ? "Destination" : "Travel type"}</p></div><Button size="sm" variant="outline" onClick={() => setTagActive.mutate({ id: tag.id, isActive: false })}>Retire</Button></div>)}</div>{tags.length === 0 && <p className="text-sm text-muted-foreground py-3">Add the first speciality tags before asking agents to complete their public profiles.</p>}</CardContent></Card>
        <PartnerManager />
      </div>

      <aside className="space-y-6"><Card className="rounded-2xl border-slate-200 shadow-sm"><CardHeader><CardTitle className="text-base flex items-center gap-2"><MessageSquareText size={17} className="text-[#02b9a6]" /> Recent web enquiries</CardTitle><CardDescription>Internal delivery audit only; agent-specific enquiries are not copied to support.</CardDescription></CardHeader><CardContent className="space-y-3">{enquiries.length === 0 ? <p className="text-sm text-muted-foreground">No consumer enquiries have been received.</p> : enquiries.map(enquiry => <div key={enquiry.id} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium truncate">{enquiry.customerName}</p><Badge variant="outline" className={enquiry.deliveryStatus === "sent" ? "border-emerald-200 text-emerald-700" : "border-rose-200 text-rose-700"}>{enquiry.deliveryStatus}</Badge></div><p className="text-xs text-muted-foreground mt-1 truncate">To {enquiry.agentName ?? "agent"} · {new Date(enquiry.createdAt).toLocaleDateString("en-GB")}</p></div>)}</CardContent></Card></aside>
    </div>

    <Dialog open={selectedAgentId !== null} onOpenChange={open => { if (!open) { setSelectedAgentId(null); setReviewAction(null); } }}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{selectedProfile?.displayName ?? "Public profile review"}</DialogTitle><DialogDescription>Review the draft information, public links, and private delivery address before publishing.</DialogDescription></DialogHeader>{selectedProfile && <div className="space-y-5 py-2"><div className="grid gap-4 sm:grid-cols-[112px_1fr]"><div className="h-28 w-28 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center">{selectedProfile.profilePhotoUrl ? <img src={selectedProfile.profilePhotoUrl} alt="" className="w-full h-full object-cover" /> : <UserRoundCheck className="text-slate-400" />}</div><div className="space-y-2"><div className="flex flex-wrap gap-2"><Badge className={statusStyles[selectedProfile.reviewStatus]}>{humanize(selectedProfile.reviewStatus)}</Badge><Badge variant="outline">Public: {selectedProfile.isPublished ? "Yes" : "No"}</Badge></div><p className="font-medium text-lg">{selectedProfile.businessName || "No business name"}</p><p className="text-sm text-slate-600 flex items-center gap-1.5"><MapPin size={14} /> {selectedProfile.listingTown || "Town not set"}</p><p className="text-sm text-slate-600 flex items-center gap-1.5"><Mail size={14} /> Private delivery: {selectedProfile.enquiryDeliveryEmail || "Not set"}</p></div></div><div><Label>Public biography</Label><p className="mt-1.5 rounded-xl bg-slate-50 border border-slate-100 p-3 text-sm leading-relaxed whitespace-pre-wrap">{selectedProfile.biography || "Not completed"}</p></div><div><Label>Selected specialities</Label><div className="flex flex-wrap gap-2 mt-2">{selected?.tags.length ? selected.tags.map(tag => <Badge key={tag.id} variant="outline">{tag.label}</Badge>) : <span className="text-sm text-muted-foreground">None selected</span>}</div></div><div><Label>Public link preview</Label><div className="grid gap-2 sm:grid-cols-2 mt-2">{(["websiteUrl", "instagramUrl", "tiktokUrl", "facebookUrl", "linkedinUrl", "youtubeUrl", "pinterestUrl"] as const).filter(field => selectedProfile[field]).map(field => <a key={field} href={selectedProfile[field] ?? undefined} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2 text-sm text-[#047d71] hover:bg-[#f4fffd] flex items-center justify-between">{field.replace("Url", "").replace(/^./, c => c.toUpperCase())}<ExternalLink size={14} /></a>)}</div></div>{selectedProfile.reviewNote && <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm"><strong>Current review note:</strong> {selectedProfile.reviewNote}</div>}<div><Label>Profile history</Label><div className="mt-2 divide-y rounded-xl border border-slate-200">{selected?.history?.length ? selected.history.map((event, index) => <div className="flex gap-3 px-3 py-2.5 text-sm" key={`${event.action}-${event.createdAt}-${index}`}><div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#02b9a6]" /><div className="min-w-0"><p className="font-medium text-slate-800">{humanize(event.action)}</p>{event.note && <p className="mt-0.5 text-slate-600 leading-relaxed">{event.note}</p>}<p className="mt-1 text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString("en-GB")}</p></div></div>) : <p className="px-3 py-3 text-sm text-muted-foreground">No profile-history entries yet.</p>}</div></div><div><Label htmlFor="review-note">Review note</Label><Textarea id="review-note" value={reviewNote} onChange={event => setReviewNote(event.target.value)} className="mt-2" placeholder="Add context for the agent, or an internal reason for hiding." rows={3} /></div></div>}<DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:justify-between"><Button variant="outline" onClick={() => setSelectedAgentId(null)}>Close</Button><div className="flex flex-wrap gap-2"><Button variant="outline" className="text-rose-700 border-rose-200 hover:bg-rose-50" onClick={() => setReviewAction("hide")}><EyeOff size={15} className="mr-1.5" /> Hide</Button><Button variant="outline" onClick={() => setReviewAction("request_changes")}><XCircle size={15} className="mr-1.5" /> Request changes</Button><Button className="bg-[#02b9a6] hover:bg-[#019b8c] text-white" onClick={() => setReviewAction("publish")}><CheckCircle2 size={15} className="mr-1.5" /> Publish</Button></div></DialogFooter></DialogContent></Dialog>
    <Dialog open={reviewAction !== null} onOpenChange={open => { if (!open) setReviewAction(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{reviewAction === "publish" ? "Publish this profile?" : reviewAction === "hide" ? "Hide this profile?" : "Request profile changes?"}</DialogTitle><DialogDescription>{reviewAction === "publish" ? "The currently reviewed draft becomes the public snapshot and will only remain visible while the agent is Active." : reviewAction === "hide" ? "The profile will disappear from the agent finder and cannot receive new enquiries." : "The public profile will remain unchanged until the agent updates and submits the draft again."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setReviewAction(null)}>Cancel</Button><Button className={reviewAction === "publish" ? "bg-[#02b9a6] hover:bg-[#019b8c]" : reviewAction === "hide" ? "bg-rose-600 hover:bg-rose-700" : ""} onClick={() => reviewAction && selectedAgentId && review.mutate({ userId: selectedAgentId, action: reviewAction, note: reviewNote || null })} disabled={review.isPending}>{review.isPending ? "Saving…" : reviewAction === "publish" ? "Publish profile" : reviewAction === "hide" ? "Hide profile" : "Send change request"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
