import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Pin, Search, Plus, ChevronDown, ChevronUp, MessageCircle,
  Lock, CheckCircle2, AlertCircle, Paperclip, ExternalLink,
  MoreVertical, Pencil, EyeOff, Trash2, X, Filter, Sparkles, Trophy,
  CalendarDays, ArrowRight, Newspaper, Zap, Medal, ListFilter,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PostComposer } from "./community/PostComposer";
import { ComplianceLog } from "./community/ComplianceLog";

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = {
  id: string;
  label: string;
  emoji: string;
  adminOnly?: boolean;
  firstClassOnly?: boolean;
};

const CATEGORIES: Category[] = [
  { id: "all", label: "All Posts", emoji: "🏠" },
  { id: "business_update", label: "Business Updates", emoji: "📢", adminOnly: true },
  { id: "supplier_news_deals", label: "Supplier News & Deals", emoji: "✈️", adminOnly: true },
  { id: "news_announcements", label: "News & Announcements", emoji: "📰", adminOnly: true },
  { id: "agent_win", label: "Agent Wins", emoji: "🏆" },
  { id: "jlt_stay_story", label: "JLT Stays & Stories", emoji: "⭐" },
  { id: "events", label: "Events", emoji: "🎉", adminOnly: true },
  { id: "training_webinars", label: "Training & Webinars", emoji: "🎓", adminOnly: true },
  { id: "mindset", label: "Mindset", emoji: "🧠", adminOnly: true },
  { id: "first_class_lounge", label: "First Class Lounge", emoji: "💎", firstClassOnly: true },
];

const CATEGORY_COLOURS: Record<string, string> = {
  business_update: "bg-red-100 text-red-700 border-red-200",
  supplier_news_deals: "bg-blue-100 text-blue-700 border-blue-200",
  news_announcements: "bg-purple-100 text-purple-700 border-purple-200",
  agent_win: "bg-yellow-100 text-yellow-700 border-yellow-200",
  jlt_stay_story: "bg-amber-100 text-amber-700 border-amber-200",
  events: "bg-pink-100 text-pink-700 border-pink-200",
  training_webinars: "bg-green-100 text-green-700 border-green-200",
  mindset: "bg-violet-100 text-violet-700 border-violet-200",
  first_class_lounge: "bg-slate-100 text-slate-700 border-slate-200",
};

const MOMENTUM_EXPLAINER = [
  { ruleKey: "community_reaction", label: "React to a Community post", description: "React to another agent’s post to show support.", points: 1 },
  { ruleKey: "community_comment", label: "Write a meaningful Community comment", description: "Share a useful thought or helpful answer — short replies do not count.", points: 3 },
  { ruleKey: "community_confirmation", label: "Acknowledge a critical JLT update", description: "Confirm an important JLT business update when asked.", points: 2 },
  { ruleKey: "community_agent_win", label: "Share an Agent Win", description: "Celebrate a genuine achievement or milestone with the Community.", points: 5 },
  { ruleKey: "accountability_action", label: "Complete a selected Accountability Task", description: "Earn the point value shown on an eligible task once its completion criteria are met.", points: 10 },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Community() {
  const { user } = useAuth();
  const [location] = useLocation();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const targetPostId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("postId");
    return value ? parseInt(value, 10) : null;
  }, [location]);

  const [selectedCategory, setSelectedCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [editingPost, setEditingPost] = useState<any>(null);
  const [compliancePostId, setCompliancePostId] = useState<number | null>(null);
  const [expandedPostId, setExpandedPostId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [supplierSubCategory, setSupplierSubCategory] = useState<string | undefined>(undefined);
  const [supplierPostType, setSupplierPostType] = useState<"news" | "deal" | undefined>(undefined);
  const [showArchive, setShowArchive] = useState(false);
  const LIMIT = 15;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => { setOffset(0); }, [selectedCategory, search, supplierSubCategory, supplierPostType]);
  useEffect(() => {
    if (selectedCategory !== "supplier_news_deals") {
      setSupplierSubCategory(undefined);
      setSupplierPostType(undefined);
    }
  }, [selectedCategory]);

  const categories = selectedCategory === "all" ? undefined : [selectedCategory];
  const { data, isLoading, refetch } = trpc.community.list.useQuery({
    categories,
    search: search || undefined,
    supplierSubCategory: selectedCategory === "supplier_news_deals" ? supplierSubCategory : undefined,
    supplierPostType: selectedCategory === "supplier_news_deals" ? supplierPostType : undefined,
    limit: LIMIT,
    offset,
  });
  const posts = data?.posts ?? [];
  const total = data?.total ?? 0;
  const showHub = selectedCategory === "all" && !search && !supplierSubCategory && !supplierPostType && offset === 0 && !showArchive;
  const { data: hubData } = trpc.community.hub.useQuery(undefined, { enabled: showHub });
  const markViewed = trpc.community.markViewed.useMutation({ onSuccess: () => { if (showHub) refetch(); } });

  function openHubPost(post: any) {
    markViewed.mutate({ postId: post.id });
    setSelectedCategory(post.category);
    setShowArchive(true);
    setOffset(0);
    setExpandedPostId(post.id);
  }
  function chooseCategory(category: string) {
    setSelectedCategory(category);
    setShowArchive(category !== "all");
  }

  const reactMutation = trpc.community.react.useMutation({ onSuccess: (result) => { refetch(); if (result.momentumAward?.awarded) toast.success(`+${result.momentumAward.points} Momentum Point${result.momentumAward.points === 1 ? "" : "s"}`); } });
  const confirmMutation = trpc.community.confirm.useMutation({ onSuccess: (result) => { refetch(); if (result.momentumAward?.awarded) toast.success(`Confirmed — +${result.momentumAward.points} Momentum Point${result.momentumAward.points === 1 ? "" : "s"}`); else toast.success("Confirmed! Thank you."); } });
  const deleteMutation = trpc.community.delete.useMutation({ onSuccess: () => { refetch(); toast.success("Post removed."); } });
  const hideMutation = trpc.community.delete.useMutation({ onSuccess: () => { refetch(); toast.success("Post hidden."); } });

  return <div className="flex h-full min-h-screen bg-background">
    <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-border bg-card p-4 gap-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">Community</p>
      {CATEGORIES.map((category) => <button key={category.id} onClick={() => chooseCategory(category.id)} className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left w-full", selectedCategory === category.id ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")}><span className="text-base">{category.emoji}</span><span className="flex-1 truncate">{category.label}</span>{category.firstClassOnly && <Lock className="w-3 h-3 opacity-60" />}</button>)}
    </aside>

    <main className="flex-1 flex flex-col min-w-0">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 lg:px-6 py-3 flex items-center gap-3">
        <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search Community posts..." value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setShowArchive(Boolean(event.target.value.trim())); }} className="pl-9" /></div>
        <div className="lg:hidden"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Filter className="w-4 h-4 mr-1" />{CATEGORIES.find((category) => category.id === selectedCategory)?.label ?? "All"}</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56">{CATEGORIES.map((category) => <DropdownMenuItem key={category.id} onClick={() => chooseCategory(category.id)}>{category.emoji} {category.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>
        {(isAdmin || ["agent_win", "jlt_stay_story"].includes(selectedCategory)) && <Button size="sm" onClick={() => { setEditingPost(null); setShowComposer(true); }}><Plus className="w-4 h-4 mr-1" /> New Post</Button>}
        {!isAdmin && selectedCategory === "all" && <Button size="sm" onClick={() => { setEditingPost(null); setShowComposer(true); }}><Plus className="w-4 h-4 mr-1" /> Share</Button>}
      </div>

      <div className="px-4 lg:px-6 pt-4 pb-2"><h1 className="text-xl font-semibold text-foreground">{showHub ? "🏠 Community Hub" : <>{CATEGORIES.find((category) => category.id === selectedCategory)?.emoji}{" "}{CATEGORIES.find((category) => category.id === selectedCategory)?.label ?? "Community"}</>}</h1>{!showHub && total > 0 && <p className="text-sm text-muted-foreground mt-0.5">{total} post{total !== 1 ? "s" : ""}</p>}</div>

      {selectedCategory === "supplier_news_deals" && <div className="px-4 lg:px-6 pb-3 flex flex-wrap gap-2">{(["news", "deal"] as const).map((type) => <button key={type} onClick={() => setSupplierPostType(supplierPostType === type ? undefined : type)} className={cn("px-3 py-1 rounded-full text-xs font-semibold border transition-colors", supplierPostType === type ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-muted/80")}>{type === "news" ? "📰 News" : "🏷️ Deals"}</button>)}<div className="w-px h-5 bg-border self-center mx-1" />{["cruise", "disney", "tour_operators", "flights", "hotels", "other"].map((sub) => <button key={sub} onClick={() => setSupplierSubCategory(supplierSubCategory === sub ? undefined : sub)} className={cn("px-3 py-1 rounded-full text-xs font-semibold border transition-colors capitalize", supplierSubCategory === sub ? "bg-blue-600 text-white border-blue-600" : "bg-muted text-muted-foreground border-border hover:bg-muted/80")}>{sub === "tour_operators" ? "Tour Operators" : sub.charAt(0).toUpperCase() + sub.slice(1)}</button>)}{(supplierSubCategory || supplierPostType) && <button onClick={() => { setSupplierSubCategory(undefined); setSupplierPostType(undefined); }} className="px-3 py-1 rounded-full text-xs font-semibold border border-dashed border-muted-foreground text-muted-foreground hover:bg-muted transition-colors flex items-center gap-1"><X className="w-3 h-3" /> Clear filters</button>}</div>}

      {showHub && <CommunityHub data={hubData} onOpenPost={openHubPost} onChooseCategory={chooseCategory} onBrowseArchive={() => setShowArchive(true)} />}

      {!showHub && <div className="flex-1 px-4 lg:px-6 pb-8 space-y-4">{isLoading ? <div className="rounded-2xl border bg-card px-5 py-6 text-center text-sm text-muted-foreground">Updating the Community feed…</div> : posts.length === 0 ? <div className="text-center py-16 text-muted-foreground"><p className="text-4xl mb-3">💬</p><p className="font-medium">No posts yet</p><p className="text-sm mt-1">Be the first to share something!</p></div> : posts.map((post) => <PostCard key={post.id} post={post} isAdmin={isAdmin} currentUserId={user?.id} expanded={expandedPostId === post.id} highlighted={targetPostId === post.id} onToggleExpand={() => setExpandedPostId(expandedPostId === post.id ? null : post.id)} onReact={(emoji) => reactMutation.mutate({ postId: post.id, emoji: emoji as any })} onConfirm={() => confirmMutation.mutate({ postId: post.id })} onEdit={() => { setEditingPost(post); setShowComposer(true); }} onHide={() => hideMutation.mutate({ postId: post.id, hide: true })} onDelete={() => { if (confirm("Delete this post permanently?")) deleteMutation.mutate({ postId: post.id, hide: false }); }} onViewCompliance={() => setCompliancePostId(post.id)} />)}{total > LIMIT && <div className="flex justify-center gap-2 pt-4"><Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</Button><span className="text-sm text-muted-foreground self-center">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span><Button variant="outline" size="sm" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Next</Button></div>}</div>}
    </main>

    {showComposer && <PostComposer isAdmin={isAdmin} initialData={editingPost} defaultCategory={selectedCategory !== "all" ? selectedCategory : undefined} onClose={() => { setShowComposer(false); setEditingPost(null); }} onSuccess={() => { setShowComposer(false); setEditingPost(null); refetch(); }} />}
    {compliancePostId && <ComplianceLog postId={compliancePostId} onClose={() => setCompliancePostId(null)} />}
  </div>;
}

function CommunityHub({ data, onOpenPost, onChooseCategory, onBrowseArchive }: { data: any; onOpenPost: (post: any) => void; onChooseCategory: (category: string) => void; onBrowseArchive: () => void }) {
  const featured = data?.featured ?? [];
  const newSinceLastVisit = data?.newSinceLastVisit ?? [];
  const latest = data?.latest ?? [];
  const categories = data?.categories ?? [];
  const momentum = data?.momentum;
  const displayFeatured = featured[0] ?? latest[0];
  const leaderboard = momentum?.leaderboard ?? [];
  const rules = momentum?.rules?.length ? momentum.rules : MOMENTUM_EXPLAINER;
  const stripHtml = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const categoryFor = (id: string) => CATEGORIES.find((category) => category.id === id);
  const ruleIcon = (key: string) => key === "community_agent_win" ? "🏆" : key === "community_comment" ? "💬" : key === "community_confirmation" ? "✅" : key === "accountability_action" ? "🎯" : "👏";

  return <section className="space-y-6 px-4 pb-8 pt-4 lg:px-6">
    <div className="rounded-3xl border border-[#bdeee7] bg-gradient-to-br from-[#edfffb] via-white to-[#f3f0ff] p-5 shadow-sm lg:p-6"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2 text-sm font-bold text-[#047857]"><Newspaper size={17} /> Your JLT Community</div><h2 className="mt-1 text-3xl font-bold tracking-tight text-foreground">What&apos;s happening, made visible.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Important updates, valuable conversations and recognition all have their own place here. The post archive is still available whenever you need it.</p></div><div className="flex flex-wrap gap-2"><Link href="/events"><Button variant="outline" size="sm" className="bg-white"><CalendarDays className="mr-1.5" size={15} /> Events</Button></Link><Link href="/competitions"><Button variant="outline" size="sm" className="bg-white"><Trophy className="mr-1.5" size={15} /> Competitions</Button></Link><Button size="sm" onClick={onBrowseArchive}><ListFilter className="mr-1.5" size={15} /> Browse posts</Button></div></div></div>

    <div className="grid gap-5 md:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
      <div className="space-y-5">{displayFeatured ? <button onClick={() => onOpenPost(displayFeatured)} className="group block min-h-56 w-full overflow-hidden rounded-3xl border border-[#414141] bg-[#414141] p-6 text-left text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"><div className="flex h-full flex-col justify-between gap-5"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-[#70FFE8]"><Pin size={14} /> {displayFeatured.isPinned ? "Featured JLT update" : "Latest Community update"}</div><h3 className="mt-3 max-w-3xl text-2xl font-bold leading-tight">{displayFeatured.title}</h3><p className="mt-3 max-w-3xl line-clamp-3 text-sm leading-6 text-white/75">{stripHtml(displayFeatured.bodyHtml)}</p></div><span className="inline-flex items-center gap-1 text-sm font-bold text-[#70FFE8]">Read update <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" /></span></div></button> : <div className="rounded-3xl border border-dashed p-6 text-muted-foreground"><p className="font-semibold">The next Community update will appear here.</p></div>}
        <div><div className="mb-3 flex items-end justify-between"><div><h3 className="text-lg font-bold">Fresh conversations</h3><p className="text-xs text-muted-foreground">New since you last looked in.</p></div><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">{newSinceLastVisit.length} new</span></div>{newSinceLastVisit.length ? <div className="grid gap-3 md:grid-cols-2">{newSinceLastVisit.slice(0, 4).map((post: any) => <HubPostTile key={post.id} post={post} onClick={() => onOpenPost(post)} />)}</div> : <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">You&apos;re up to date. Check back soon for the next JLT update or community conversation.</div>}</div>
      </div>

      <div className="space-y-5"><div className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-sm font-bold text-violet-800"><Sparkles size={17} /> JLT Momentum</div><h3 className="mt-1 text-xl font-bold text-foreground">Your engagement is recognised.</h3></div><div className="rounded-2xl bg-violet-700 px-3 py-2 text-center text-white"><p className="text-2xl font-bold leading-none">{momentum?.totalPoints ?? 0}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-violet-100">points</p></div></div><p className="mt-3 text-sm leading-6 text-muted-foreground">Earn Momentum Points by taking part in the Portal. Points are a recognition score for now — JLT will announce future rewards and benefits separately.</p>{momentum?.rank && <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-violet-800">You&apos;re #{momentum.rank} on this month&apos;s leaderboard with {momentum.monthPoints} points.</p>}<div className="mt-4 space-y-2">{rules.map((rule: any) => <div key={rule.ruleKey} className="flex items-start gap-2 rounded-xl border border-violet-100 bg-white/80 p-2.5"><span className="mt-0.5 text-base">{ruleIcon(rule.ruleKey)}</span><div className="min-w-0 flex-1"><p className="text-xs font-bold text-foreground">{rule.label} <span className="float-right text-violet-700">+{rule.points}</span></p><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{rule.description}</p></div></div>)}</div></div>
        <div className="rounded-3xl border bg-card p-5"><div className="flex items-center justify-between"><div><div className="flex items-center gap-2 text-sm font-bold text-foreground"><Medal className="text-amber-500" size={18} /> This month&apos;s Momentum leaders</div><p className="mt-1 text-xs text-muted-foreground">A friendly recognition board for active agents.</p></div><Trophy className="text-amber-500" size={20} /></div>{leaderboard.length ? <ol className="mt-4 space-y-2">{leaderboard.map((agent: any, index: number) => <li key={agent.agentId} className={cn("flex items-center gap-3 rounded-xl px-3 py-2", agent.agentId === momentum?.agentId ? "bg-violet-50" : "bg-muted/50")}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold">{agent.agentName}</span><span className="text-sm font-bold text-violet-800">{agent.points}</span></li>)}</ol> : <div className="mt-4 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">Be one of the first agents on this month&apos;s board.</div>}</div>
      </div>
    </div>

    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_340px]"><div className="rounded-3xl border bg-card p-5"><div className="mb-4"><h3 className="text-lg font-bold">Explore Community</h3><p className="mt-1 text-xs text-muted-foreground">Go directly to the conversations and resources that matter to you.</p></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{categories.slice(0, 8).map((category: any) => { const definition = categoryFor(category.id); return <button key={category.id} onClick={() => onChooseCategory(category.id)} className="flex items-center gap-3 rounded-xl border bg-background p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"><span className="text-lg">{definition?.emoji ?? "💬"}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{definition?.label ?? category.id}</span><span className="block text-xs text-muted-foreground">{category.count} recent {category.count === 1 ? "post" : "posts"}</span></span><ArrowRight size={15} className="text-muted-foreground" /></button>; })}</div></div><div className="rounded-3xl border border-[#b6e9df] bg-[#f2fffc] p-5"><div className="flex items-center gap-2 text-sm font-bold text-[#047857]"><Zap size={17} /> Keep your Momentum going</div><p className="mt-2 text-sm leading-6 text-muted-foreground">A useful reaction, a thoughtful comment or sharing a genuine win can all count. Points are awarded automatically when the relevant activity meets the published criteria.</p><Button variant="outline" size="sm" className="mt-4 bg-white" onClick={onBrowseArchive}>Explore the archive <ArrowRight className="ml-1.5" size={14} /></Button></div></div>
  </section>;
}

function HubPostTile({ post, onClick }: { post: any; onClick: () => void }) {
  const category = CATEGORIES.find((item) => item.id === post.category);
  const text = (post.bodyHtml ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return <button onClick={onClick} className="group rounded-2xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><span>{category?.emoji ?? "💬"}</span><span className="truncate">{category?.label ?? post.category}</span></div><h4 className="mt-2 line-clamp-2 font-bold leading-snug text-foreground">{post.title}</h4><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{text}</p><span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary">Open post <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" /></span></button>;
}

// ─── PostCard ─────────────────────────────────────────────────────────────────

function PostCard({ post, isAdmin, currentUserId, expanded, highlighted, onToggleExpand, onReact, onConfirm, onEdit, onHide, onDelete, onViewCompliance }: { post: any; isAdmin: boolean; currentUserId?: number; expanded: boolean; highlighted?: boolean; onToggleExpand: () => void; onReact: (emoji: string) => void; onConfirm: () => void; onEdit: () => void; onHide: () => void; onDelete: () => void; onViewCompliance: () => void; }) {
  const cardRef = useRef<HTMLElement>(null);
  const isOwner = post.authorId === currentUserId;
  useEffect(() => { if (highlighted && cardRef.current) setTimeout(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300); }, [highlighted]);
  const reactionTotals: Record<string, number> = post.reactionCounts ?? {};
  const myReaction: string | null = post.myReaction ?? null;
  const [showComments, setShowComments] = useState(expanded);
  const { data: comments = [] } = trpc.community.listComments.useQuery({ postId: post.id }, { enabled: showComments });
  const addComment = trpc.community.addComment.useMutation({ onSuccess: (result) => toast.success(result.momentumAward?.awarded ? `Comment added — +${result.momentumAward.points} Momentum Point${result.momentumAward.points === 1 ? "" : "s"}` : "Comment added") });
  const [comment, setComment] = useState("");
  const reactions = [{ emoji: "thumbs_up", label: "👍" }, { emoji: "heart", label: "❤️" }, { emoji: "celebrate", label: "🎉" }, { emoji: "fire", label: "🔥" }, { emoji: "plane", label: "✈️" }];
  const category = CATEGORIES.find((item) => item.id === post.category);
  const bodyText = post.bodyHtml ?? "";

  return <article ref={cardRef as any} className={cn("rounded-2xl border bg-card p-5 shadow-sm transition-shadow", highlighted && "ring-2 ring-primary", post.isPinned && "border-primary/40")}><div className="flex items-start gap-3"><Avatar className="h-9 w-9"><AvatarFallback>{(post.authorName || "J").slice(0, 1).toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-sm">{post.authorName}</span>{category && <Badge variant="outline" className={cn("text-[10px]", CATEGORY_COLOURS[post.category])}>{category.emoji} {category.label}</Badge>}{post.isPinned && <Badge className="bg-primary/10 text-primary hover:bg-primary/10"><Pin className="mr-1 h-3 w-3" /> Pinned</Badge>}</div><p className="mt-0.5 text-xs text-muted-foreground">{post.createdAt ? new Date(post.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</p></div>{(isAdmin || isOwner) && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{(isAdmin || isOwner) && <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>}{isAdmin && <DropdownMenuItem onClick={onHide}><EyeOff className="mr-2 h-4 w-4" /> Hide</DropdownMenuItem>}{isAdmin && <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>}{isAdmin && post.requiresConfirmation && <DropdownMenuItem onClick={onViewCompliance}><CheckCircle2 className="mr-2 h-4 w-4" /> View confirmations</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}</div>
    <h2 className="mt-4 text-lg font-bold leading-snug">{post.title}</h2><div className={cn("prose prose-sm mt-3 max-w-none text-foreground prose-p:leading-6", !expanded && "line-clamp-4")} dangerouslySetInnerHTML={{ __html: bodyText }} />{post.loomUrl && <a href={post.loomUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"><ExternalLink size={15} /> Watch video</a>}{post.imageUrls?.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{post.imageUrls.map((url: string) => <img key={url} src={url} alt="Community attachment" className="max-h-72 w-full rounded-xl object-cover" />)}</div>}{post.attachmentUrls?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{post.attachmentUrls.map((attachment: any) => <a key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-muted"><Paperclip size={13} /> {attachment.name}</a>)}</div>}{bodyText.length > 700 && <button onClick={onToggleExpand} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">{expanded ? <><ChevronUp size={15} /> Show less</> : <><ChevronDown size={15} /> Read more</>}</button>}
    {post.requiresConfirmation && <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 text-amber-700" /><div><p className="text-sm font-semibold text-amber-900">Please confirm you have read this update</p><p className="mt-0.5 text-xs text-amber-800">Confirming can earn Momentum Points where enabled.</p></div></div><Button size="sm" onClick={onConfirm}><CheckCircle2 className="mr-1 h-4 w-4" /> Confirm</Button></div>}
    <Separator className="my-4" /><div className="flex flex-wrap items-center gap-2"><div className="flex items-center gap-1">{reactions.map((reaction) => <button key={reaction.emoji} onClick={() => onReact(reaction.emoji)} className={cn("rounded-full border px-2 py-1 text-sm transition-colors hover:bg-muted", myReaction === reaction.emoji && "border-primary bg-primary/10")} aria-label={`React ${reaction.label}`}>{reaction.label}{reactionTotals[reaction.emoji] ? <span className="ml-1 text-xs">{reactionTotals[reaction.emoji]}</span> : null}</button>)}</div><button onClick={() => setShowComments(!showComments)} className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><MessageCircle size={16} /> {comments.length || post.commentCount || 0} comments</button></div>{showComments && <div className="mt-4 space-y-3 border-t pt-4"><ScrollArea className="max-h-64">{comments.length ? <div className="space-y-3 pr-3">{comments.map((item: any) => <div key={item.id} className="rounded-xl bg-muted/50 p-3"><p className="text-xs font-semibold">{item.authorName}</p><p className="mt-1 whitespace-pre-wrap text-sm">{item.content}</p></div>)}</div> : <p className="py-2 text-sm text-muted-foreground">Start the conversation.</p>}</ScrollArea><div className="flex gap-2"><Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a thoughtful comment…" className="min-h-10 resize-none" /><Button disabled={!comment.trim() || addComment.isPending} onClick={() => { addComment.mutate({ postId: post.id, content: comment.trim() }); setComment(""); }}>Send</Button></div></div>}</article>;
}
