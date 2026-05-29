import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Pin, Search, Plus, ChevronDown, ChevronUp, MessageCircle,
  Lock, CheckCircle2, AlertCircle, Paperclip, ExternalLink,
  MoreVertical, Pencil, EyeOff, Trash2, X, Filter,
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
  { id: "events", label: "Events", emoji: "🥂", adminOnly: true },
  { id: "training_webinars", label: "Training & Webinars", emoji: "🎓", adminOnly: true },
  { id: "mindset", label: "Mindset", emoji: "🧠", adminOnly: true },
  { id: "first_class_lounge", label: "First Class Lounge", emoji: "💎", firstClassOnly: true },
];

const EMOJI_MAP: Record<string, string> = {
  thumbs_up: "👍",
  heart: "❤️",
  celebrate: "🎉",
  fire: "🔥",
  plane: "✈️",
};

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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Community() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

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
  const LIMIT = 15;

  // Sync search with debounce
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset offset on filter change
  useEffect(() => { setOffset(0); }, [selectedCategory, search, supplierSubCategory, supplierPostType]);
  // Reset supplier filters when leaving supplier category
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

  // ─── Mutations ────────────────────────────────────────────────────────────────

  const reactMutation = trpc.community.react.useMutation({
    onSuccess: () => refetch(),
  });

  const confirmMutation = trpc.community.confirm.useMutation({
    onSuccess: () => { refetch(); toast.success("Confirmed! Thank you."); },
  });

  const deleteMutation = trpc.community.delete.useMutation({
    onSuccess: () => { refetch(); toast.success("Post removed."); },
  });

  const hideMutation = trpc.community.delete.useMutation({
    onSuccess: () => { refetch(); toast.success("Post hidden."); },
  });

  return (
    <div className="flex h-full min-h-screen bg-background">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-border bg-card p-4 gap-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
          Community
        </p>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left w-full",
              selectedCategory === cat.id
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted"
            )}
          >
            <span className="text-base">{cat.emoji}</span>
            <span className="flex-1 truncate">{cat.label}</span>
            {cat.firstClassOnly && <Lock className="w-3 h-3 opacity-60" />}
          </button>
        ))}
      </aside>

      {/* ── Main Feed ───────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 lg:px-6 py-3 flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search posts..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          {/* Mobile category filter */}
          <div className="lg:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="w-4 h-4 mr-1" />
                  {CATEGORIES.find((c) => c.id === selectedCategory)?.label ?? "All"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {CATEGORIES.map((cat) => (
                  <DropdownMenuItem key={cat.id} onClick={() => setSelectedCategory(cat.id)}>
                    {cat.emoji} {cat.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* New post button */}
          {(isAdmin || ["agent_win", "jlt_stay_story"].includes(selectedCategory)) && (
            <Button size="sm" onClick={() => { setEditingPost(null); setShowComposer(true); }}>
              <Plus className="w-4 h-4 mr-1" /> New Post
            </Button>
          )}
          {!isAdmin && selectedCategory === "all" && (
            <Button size="sm" onClick={() => { setEditingPost(null); setShowComposer(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Share
            </Button>
          )}
        </div>

        {/* Category heading */}
        <div className="px-4 lg:px-6 pt-4 pb-2">
          <h1 className="text-xl font-semibold text-foreground">
            {CATEGORIES.find((c) => c.id === selectedCategory)?.emoji}{" "}
            {CATEGORIES.find((c) => c.id === selectedCategory)?.label ?? "Community"}
          </h1>
          {total > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">{total} post{total !== 1 ? "s" : ""}</p>
          )}
        </div>

        {/* Supplier sub-tag filters */}
        {selectedCategory === "supplier_news_deals" && (
          <div className="px-4 lg:px-6 pb-3 flex flex-wrap gap-2">
            {/* Post type chips */}
            {(["news", "deal"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setSupplierPostType(supplierPostType === type ? undefined : type)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
                  supplierPostType === type
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                )}
              >
                {type === "news" ? "📰 News" : "🏷️ Deals"}
              </button>
            ))}
            <div className="w-px h-5 bg-border self-center mx-1" />
            {/* Sub-category chips */}
            {["cruise", "disney", "tour_operators", "flights", "hotels", "other"].map((sub) => (
              <button
                key={sub}
                onClick={() => setSupplierSubCategory(supplierSubCategory === sub ? undefined : sub)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-semibold border transition-colors capitalize",
                  supplierSubCategory === sub
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                )}
              >
                {sub === "tour_operators" ? "Tour Operators" : sub.charAt(0).toUpperCase() + sub.slice(1)}
              </button>
            ))}
            {(supplierSubCategory || supplierPostType) && (
              <button
                onClick={() => { setSupplierSubCategory(undefined); setSupplierPostType(undefined); }}
                className="px-3 py-1 rounded-full text-xs font-semibold border border-dashed border-muted-foreground text-muted-foreground hover:bg-muted transition-colors flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Clear filters
              </button>
            )}
          </div>
        )}

        {/* Posts */}
        <div className="flex-1 px-4 lg:px-6 pb-8 space-y-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))
          ) : posts.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-4xl mb-3">💬</p>
              <p className="font-medium">No posts yet</p>
              <p className="text-sm mt-1">Be the first to share something!</p>
            </div>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                isAdmin={isAdmin}
                currentUserId={user?.id}
                expanded={expandedPostId === post.id}
                onToggleExpand={() => setExpandedPostId(expandedPostId === post.id ? null : post.id)}
                onReact={(emoji) => reactMutation.mutate({ postId: post.id, emoji: emoji as any })}
                onConfirm={() => confirmMutation.mutate({ postId: post.id })}
                onEdit={() => { setEditingPost(post); setShowComposer(true); }}
                onHide={() => hideMutation.mutate({ postId: post.id, hide: true })}
                onDelete={() => {
                  if (confirm("Delete this post permanently?")) {
                    deleteMutation.mutate({ postId: post.id, hide: false });
                  }
                }}
                onViewCompliance={() => setCompliancePostId(post.id)}
              />
            ))
          )}

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground self-center">
                {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + LIMIT >= total}
                onClick={() => setOffset(offset + LIMIT)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* ── Post Composer Dialog ─────────────────────────────────────────────── */}
      {showComposer && (
        <PostComposer
          isAdmin={isAdmin}
          initialData={editingPost}
          defaultCategory={selectedCategory !== "all" ? selectedCategory : undefined}
          onClose={() => { setShowComposer(false); setEditingPost(null); }}
          onSuccess={() => { setShowComposer(false); setEditingPost(null); refetch(); }}
        />
      )}

      {/* ── Compliance Log Dialog ────────────────────────────────────────────── */}
      {compliancePostId && (
        <ComplianceLog
          postId={compliancePostId}
          onClose={() => setCompliancePostId(null)}
        />
      )}
    </div>
  );
}

// ─── PostCard ─────────────────────────────────────────────────────────────────

function PostCard({
  post,
  isAdmin,
  currentUserId,
  expanded,
  onToggleExpand,
  onReact,
  onConfirm,
  onEdit,
  onHide,
  onDelete,
  onViewCompliance,
}: {
  post: any;
  isAdmin: boolean;
  currentUserId?: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onReact: (emoji: string) => void;
  onConfirm: () => void;
  onEdit: () => void;
  onHide: () => void;
  onDelete: () => void;
  onViewCompliance: () => void;
}) {
  const isOwner = post.authorId === currentUserId;
  const canEdit = isAdmin || isOwner;
  const catColour = CATEGORY_COLOURS[post.category] ?? "bg-gray-100 text-gray-700 border-gray-200";
  const catLabel = CATEGORIES.find((c) => c.id === post.category)?.label ?? post.category;
  const catEmoji = CATEGORIES.find((c) => c.id === post.category)?.emoji ?? "";
  function parseJsonField<T>(val: unknown): T[] {
    if (Array.isArray(val)) return val as T[];
    if (typeof val === "string" && val.trim().startsWith("[")) {
      try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
    }
    return [];
  }
  const imageUrls: string[] = parseJsonField<string>(post.imageUrls);
  const attachments: { name: string; url: string }[] = parseJsonField<{ name: string; url: string }>(post.attachmentUrls);

  // Reaction totals
  const reactionTotals: Record<string, number> = {};
  let myReaction: string | null = null;
  if (Array.isArray(post.reactions)) {
    for (const r of post.reactions) {
      reactionTotals[r.emoji] = (reactionTotals[r.emoji] ?? 0) + 1;
      if (r.userId === currentUserId) myReaction = r.emoji;
    }
  }

  const needsConfirmation = post.requiresConfirmation && !post.isConfirmed;
  const confirmedByMe = post.isConfirmed;

  return (
    <article
      className={cn(
        "bg-card border border-border rounded-xl overflow-hidden transition-shadow hover:shadow-md",
        post.isPinned && "ring-2 ring-primary/20",
        needsConfirmation && "ring-2 ring-amber-400/40"
      )}
    >
      {/* Card header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <Avatar className="w-9 h-9 shrink-0">
              <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                {(post.authorName ?? "?").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-sm text-foreground">{post.authorName}</span>
                <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", catColour)}>
                  {catEmoji} {catLabel}
                </span>
                {post.supplierPostType && (
                  <Badge variant="outline" className="text-xs capitalize">{post.supplierPostType}</Badge>
                )}
                {post.supplierSubCategory && (
                  <Badge variant="outline" className="text-xs capitalize">{post.supplierSubCategory}</Badge>
                )}
                {post.isPinned && (
                  <span className="flex items-center gap-1 text-xs text-primary font-medium">
                    <Pin className="w-3 h-3" /> Pinned
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(post.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", year: "numeric",
                })}
                {post.updatedAt !== post.createdAt && " · edited"}
              </p>
            </div>
          </div>
          {/* Admin / owner actions */}
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="w-4 h-4 mr-2" /> Edit post
                </DropdownMenuItem>
                {isAdmin && post.requiresConfirmation && (
                  <DropdownMenuItem onClick={onViewCompliance}>
                    <CheckCircle2 className="w-4 h-4 mr-2" /> View compliance log
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <DropdownMenuItem onClick={onHide} className="text-amber-600">
                    <EyeOff className="w-4 h-4 mr-2" /> Hide post
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <DropdownMenuItem onClick={onDelete} className="text-destructive">
                    <Trash2 className="w-4 h-4 mr-2" /> Delete post
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Title */}
        <h2 className="font-semibold text-base text-foreground mt-3 leading-snug">{post.title}</h2>

        {/* Body preview / full */}
        <div
          className={cn(
            "prose prose-sm max-w-none text-foreground mt-2",
            !expanded && "line-clamp-4"
          )}
          dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
        />
        {post.bodyHtml && post.bodyHtml.length > 300 && (
          <button
            onClick={onToggleExpand}
            className="text-xs text-primary hover:underline mt-1 flex items-center gap-1"
          >
            {expanded ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Read more</>}
          </button>
        )}

        {/* Loom embed */}
        {post.loomUrl && expanded && (
          <div className="mt-3 rounded-lg overflow-hidden border border-border">
            <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
              <iframe
                src={`https://www.loom.com/embed/${post.loomUrl.match(/loom\.com\/share\/([a-zA-Z0-9]+)/)?.[1] ?? ""}`}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: 0 }}
                allowFullScreen
              />
            </div>
          </div>
        )}

        {/* Images */}
        {imageUrls.length > 0 && (
          <div className={cn("mt-3 grid gap-2", imageUrls.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
            {imageUrls.slice(0, expanded ? undefined : 2).map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                <img
                  src={url}
                  alt=""
                  className="rounded-lg w-full object-contain bg-muted cursor-zoom-in"
                  style={{ maxHeight: "480px" }}
                />
              </a>
            ))}
          </div>
        )}

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary bg-primary/5 hover:bg-primary/10 px-3 py-1.5 rounded-full border border-primary/20 transition-colors"
              >
                <Paperclip className="w-3 h-3" />
                {a.name}
                <ExternalLink className="w-3 h-3 opacity-60" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation banner */}
      {post.requiresConfirmation && (
        <div className={cn(
          "mx-4 mb-3 px-4 py-3 rounded-lg border flex items-center justify-between gap-3",
          confirmedByMe
            ? "bg-green-50 border-green-200 text-green-700"
            : "bg-amber-50 border-amber-200 text-amber-700"
        )}>
          {confirmedByMe ? (
            <span className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" /> You have confirmed this update
            </span>
          ) : (
            <>
              <span className="flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="w-4 h-4" /> Please confirm you have read and understood this update
              </span>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                onClick={onConfirm}
              >
                Confirm
              </Button>
            </>
          )}
        </div>
      )}

      {/* Reactions + comment count */}
      <div className="px-4 pb-3 flex items-center gap-1 flex-wrap">
        {Object.entries(EMOJI_MAP).map(([key, emoji]) => {
          const count = reactionTotals[key] ?? 0;
          const isActive = myReaction === key;
          return (
            <button
              key={key}
              onClick={() => onReact(key)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-full text-sm border transition-all",
                isActive
                  ? "bg-primary/10 border-primary/30 text-primary font-semibold"
                  : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
              )}
            >
              <span>{emoji}</span>
              {count > 0 && <span className="text-xs">{count}</span>}
            </button>
          );
        })}
        <button
          onClick={onToggleExpand}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border bg-muted/50 border-border text-muted-foreground hover:bg-muted transition-all ml-1"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          <span className="text-xs">{post.commentCount ?? 0}</span>
        </button>
      </div>

      {/* Comments section (expanded) */}
      {expanded && <CommentsSection postId={post.id} currentUserId={currentUserId} isAdmin={isAdmin} />}
    </article>
  );
}

// ─── CommentsSection ──────────────────────────────────────────────────────────

function CommentsSection({
  postId,
  currentUserId,
  isAdmin,
}: {
  postId: number;
  currentUserId?: number;
  isAdmin: boolean;
}) {
  const [newComment, setNewComment] = useState("");
  const { data: comments, refetch } = trpc.community.listComments.useQuery({ postId });

  const addComment = trpc.community.addComment.useMutation({
    onSuccess: () => { setNewComment(""); refetch(); },
    onError: () => toast.error("Failed to add comment"),
  });

  const deleteComment = trpc.community.deleteComment.useMutation({
    onSuccess: () => refetch(),
  });

  return (
    <div className="border-t border-border px-4 py-3 bg-muted/20">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Comments {comments && comments.length > 0 ? `(${comments.length})` : ""}
      </p>
      {comments && comments.length > 0 && (
        <div className="space-y-3 mb-3">
          {comments.filter((c: any) => !c.isDeleted).map((comment: any) => (
            <div key={comment.id} className="flex gap-2.5">
              <Avatar className="w-7 h-7 shrink-0">
                <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                  {(comment.authorName ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="bg-background rounded-lg px-3 py-2 border border-border">
                  <p className="text-xs font-semibold text-foreground">{comment.authorName}</p>
                  <p className="text-sm text-foreground mt-0.5">{comment.content}</p>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">
                    {new Date(comment.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                  {isAdmin && (
                    <button
                      onClick={() => deleteComment.mutate({ commentId: comment.id })}
                      className="text-xs text-destructive hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Add comment */}
      <div className="flex gap-2">
        <Input
          placeholder="Add a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && newComment.trim()) {
              e.preventDefault();
              addComment.mutate({ postId, content: newComment.trim() });
            }
          }}
          className="text-sm"
        />
        <Button
          size="sm"
          disabled={!newComment.trim() || addComment.isPending}
          onClick={() => addComment.mutate({ postId, content: newComment.trim() })}
        >
          Post
        </Button>
      </div>
    </div>
  );
}
