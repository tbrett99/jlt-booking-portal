import { useState, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ThumbsUp, ThumbsDown, Lightbulb, Rocket, Clock, CheckCircle2, Sparkles, ChevronRight, Plus, Users, ArrowDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type RoadmapItem = {
  id: number;
  title: string;
  description: string | null;
  category: string;
  status: string;
  timeframe: string | null;
  progressPct: number;
  fromSuggestionId: number | null;
  sortOrder: number;
  releasedAt: Date | null;
  createdAt: Date;
};

type Suggestion = {
  id: number;
  title: string;
  description: string | null;
  status: string;
  convertedToItemId: number | null;
  createdAt: Date;
  isOwn: boolean;
  submitterName: string | null;
  votes: number;
  myVote: number;
};

// ─── Category colours ─────────────────────────────────────────────────────────

const CATEGORY_COLOURS: Record<string, string> = {
  Bookings: "bg-blue-100 text-blue-700 border-blue-200",
  Payments: "bg-emerald-100 text-emerald-700 border-emerald-200",
  CRM: "bg-purple-100 text-purple-700 border-purple-200",
  Reports: "bg-amber-100 text-amber-700 border-amber-200",
  Commissions: "bg-orange-100 text-orange-700 border-orange-200",
  Community: "bg-pink-100 text-pink-700 border-pink-200",
  Mobile: "bg-cyan-100 text-cyan-700 border-cyan-200",
  Admin: "bg-slate-100 text-slate-700 border-slate-200",
  Other: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_CONFIG = {
  under_consideration: {
    label: "Under Consideration",
    icon: Lightbulb,
    colour: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
    headerBg: "bg-amber-100",
    dot: "bg-amber-400",
  },
  planned: {
    label: "Planned",
    icon: Clock,
    colour: "text-blue-600",
    bg: "bg-blue-50 border-blue-200",
    headerBg: "bg-blue-100",
    dot: "bg-blue-400",
  },
  in_progress: {
    label: "In Progress",
    icon: Rocket,
    colour: "text-violet-600",
    bg: "bg-violet-50 border-violet-200",
    headerBg: "bg-violet-100",
    dot: "bg-violet-500",
  },
  released: {
    label: "Released",
    icon: CheckCircle2,
    colour: "text-emerald-600",
    bg: "bg-emerald-50 border-emerald-200",
    headerBg: "bg-emerald-100",
    dot: "bg-emerald-500",
  },
};

const SUGGESTION_STATUS_COLOURS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  planned: "bg-violet-100 text-violet-700",
  declined: "bg-red-100 text-red-600",
};

const SUGGESTION_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  under_review: "Under Review",
  planned: "Planned",
  declined: "Declined",
};

// ─── Roadmap Card ─────────────────────────────────────────────────────────────

function RoadmapCard({ item }: { item: RoadmapItem }) {
  const catColour = CATEGORY_COLOURS[item.category] ?? CATEGORY_COLOURS.Other;
  const isInProgress = item.status === "in_progress";
  const [expanded, setExpanded] = useState(false);
  // Estimate if description is long enough to need clamping (>120 chars is a reasonable threshold)
  const isLong = (item.description?.length ?? 0) > 120;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${catColour}`}>
          {item.category}
        </span>
        {item.fromSuggestionId && (
          <span className="inline-flex items-center gap-1 text-xs text-pink-600 bg-pink-50 border border-pink-200 px-2 py-0.5 rounded-full">
            <Users className="w-3 h-3" />
            Community
          </span>
        )}
      </div>
      <h3 className="font-semibold text-gray-900 text-sm leading-snug mb-1 group-hover:text-violet-700 transition-colors">
        {item.title}
      </h3>
      {item.description && (
        <div className="mb-3">
          <p className={`text-xs text-gray-500 leading-relaxed ${!expanded && isLong ? "line-clamp-3" : ""}`}>
            {item.description}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-violet-500 hover:text-violet-700 font-medium mt-1 transition-colors"
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}
      {isInProgress && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progress</span>
            <span className="font-medium text-violet-600">{item.progressPct}%</span>
          </div>
          <Progress value={item.progressPct} className="h-1.5 bg-violet-100 [&>div]:bg-violet-500" />
        </div>
      )}
      {item.timeframe && (
        <div className="flex items-center gap-1 text-xs text-gray-400 mt-2">
          <Clock className="w-3 h-3" />
          <span>{item.timeframe}</span>
        </div>
      )}
    </div>
  );
}

// ─── Suggestion Card ──────────────────────────────────────────────────────────

function SuggestionCard({ suggestion, onVote }: { suggestion: Suggestion; onVote: (id: number, value: 1 | -1 | 0) => void }) {
  const statusColour = SUGGESTION_STATUS_COLOURS[suggestion.status] ?? "bg-gray-100 text-gray-600";
  const statusLabel = SUGGESTION_STATUS_LABELS[suggestion.status] ?? suggestion.status;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex gap-4">
        {/* Vote column */}
        <div className="flex flex-col items-center gap-1 min-w-[48px]">
          <button
            onClick={() => onVote(suggestion.id, suggestion.myVote === 1 ? 0 : 1)}
            disabled={suggestion.isOwn}
            className={`p-1.5 rounded-lg transition-colors ${
              suggestion.myVote === 1
                ? "bg-emerald-100 text-emerald-600"
                : suggestion.isOwn
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-400 hover:bg-emerald-50 hover:text-emerald-600"
            }`}
            title={suggestion.isOwn ? "You cannot vote on your own suggestion" : "Upvote"}
          >
            <ThumbsUp className="w-4 h-4" />
          </button>
          <span className={`text-sm font-bold tabular-nums ${suggestion.votes > 0 ? "text-emerald-600" : suggestion.votes < 0 ? "text-red-500" : "text-gray-500"}`}>
            {suggestion.votes > 0 ? `+${suggestion.votes}` : suggestion.votes}
          </span>
          <button
            onClick={() => onVote(suggestion.id, suggestion.myVote === -1 ? 0 : -1)}
            disabled={suggestion.isOwn}
            className={`p-1.5 rounded-lg transition-colors ${
              suggestion.myVote === -1
                ? "bg-red-100 text-red-500"
                : suggestion.isOwn
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-400 hover:bg-red-50 hover:text-red-500"
            }`}
            title={suggestion.isOwn ? "You cannot vote on your own suggestion" : "Downvote"}
          >
            <ThumbsDown className="w-4 h-4" />
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 text-sm leading-snug">{suggestion.title}</h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusColour}`}>
              {statusLabel}
            </span>
          </div>
          {suggestion.description && (
            <p className="text-xs text-gray-500 leading-relaxed mb-2 line-clamp-3">{suggestion.description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            {suggestion.isOwn && (
              <span className="text-violet-500 font-medium">Your idea</span>
            )}
            {suggestion.convertedToItemId && (
              <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                <CheckCircle2 className="w-3 h-3" />
                Added to roadmap
              </span>
            )}
            <span>{new Date(suggestion.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Roadmap() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"roadmap" | "suggestions">("roadmap");
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const { data: items = [], isLoading: itemsLoading } = trpc.roadmap.listPublic.useQuery();
  const { data: suggestions = [], isLoading: suggestionsLoading } = trpc.roadmap.listSuggestions.useQuery();

  const submitMutation = trpc.roadmap.submitSuggestion.useMutation({
    onSuccess: () => {
      toast.success("Your idea has been submitted!");
      setShowSubmitDialog(false);
      setNewTitle("");
      setNewDesc("");
      utils.roadmap.listSuggestions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const voteMutation = trpc.roadmap.vote.useMutation({
    onMutate: async ({ suggestionId, value }) => {
      await utils.roadmap.listSuggestions.cancel();
      const prev = utils.roadmap.listSuggestions.getData();
      utils.roadmap.listSuggestions.setData(undefined, (old) =>
        (old ?? []).map((s) => {
          if (s.id !== suggestionId) return s;
          const oldVote = s.myVote;
          const newVote = value;
          const delta = newVote - oldVote;
          return { ...s, votes: s.votes + delta, myVote: newVote };
        })
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.roadmap.listSuggestions.setData(undefined, ctx.prev);
      toast.error("Could not record vote");
    },
  });

  // Kanban columns
  const COLUMNS: Array<{ key: string; label: string; icon: React.ElementType; colour: string; bg: string; headerBg: string; dot: string }> = [
    { key: "under_consideration", label: "Under Consideration", icon: Lightbulb, colour: "text-amber-600", bg: "bg-amber-50/60 border-amber-200", headerBg: "bg-amber-100", dot: "bg-amber-400" },
    { key: "planned", label: "Planned", icon: Clock, colour: "text-blue-600", bg: "bg-blue-50/60 border-blue-200", headerBg: "bg-blue-100", dot: "bg-blue-400" },
    { key: "in_progress", label: "In Progress", icon: Rocket, colour: "text-violet-600", bg: "bg-violet-50/60 border-violet-200", headerBg: "bg-violet-100", dot: "bg-violet-500" },
  ];

  const columnItems = useMemo(() => {
    const map: Record<string, RoadmapItem[]> = { under_consideration: [], planned: [], in_progress: [] };
    for (const item of items as RoadmapItem[]) {
      if (item.status !== "released" && map[item.status]) {
        map[item.status].push(item);
      }
    }
    // Sort in_progress by progressPct desc (most advanced first)
    map.in_progress.sort((a, b) => b.progressPct - a.progressPct);
    return map;
  }, [items]);

  const releasedItems = useMemo(
    () => (items as RoadmapItem[]).filter((i) => i.status === "released").sort((a, b) => new Date(b.releasedAt ?? b.createdAt).getTime() - new Date(a.releasedAt ?? a.createdAt).getTime()),
    [items]
  );

  const sortedSuggestions = useMemo(
    () => [...(suggestions as Suggestion[])].sort((a, b) => b.votes - a.votes),
    [suggestions]
  );

  const handleVote = (id: number, value: 1 | -1 | 0) => {
    voteMutation.mutate({ suggestionId: id, value });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFF6ED] via-white to-[#f0fffe] pb-16">
      {/* Hero header */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[#1a1a2e] to-[#16213e] text-white px-6 py-12">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, #70FFE8 0%, transparent 50%), radial-gradient(circle at 80% 20%, #02E6D2 0%, transparent 40%)" }} />
        <div className="relative max-w-5xl mx-auto">
          <div className="flex items-center gap-2 text-[#70FFE8] text-sm font-medium mb-3">
            <Sparkles className="w-4 h-4" />
            <span>JLT Group Portal</span>
          </div>
          <h1 className="text-3xl font-bold mb-2">Product Roadmap</h1>
          <p className="text-gray-300 text-sm max-w-xl">
            See what we're working on, what's coming next, and what we've recently shipped. Your feedback shapes our priorities.
          </p>
          <div className="flex flex-wrap gap-3 mt-6">
            <button
              onClick={() => setTab("roadmap")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "roadmap" ? "bg-[#02E6D2] text-[#1a1a2e]" : "bg-white/10 text-white hover:bg-white/20"}`}
            >
              Roadmap
            </button>
            <button
              onClick={() => setTab("suggestions")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "suggestions" ? "bg-[#02E6D2] text-[#1a1a2e]" : "bg-white/10 text-white hover:bg-white/20"}`}
            >
              Suggestions
              {suggestions.length > 0 && (
                <span className="ml-2 bg-white/20 text-white text-xs px-1.5 py-0.5 rounded-full">{suggestions.length}</span>
              )}
            </button>
            {tab === "roadmap" && releasedItems.length > 0 && (
              <button
                onClick={() => {
                  document.getElementById("recently-released")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Recently Released
                <ArrowDown className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pt-8">
        {/* ── Roadmap Tab ── */}
        {tab === "roadmap" && (
          <div>
            {itemsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-2xl border bg-gray-50 p-4 animate-pulse h-64" />
                ))}
              </div>
            ) : (
              <>
                {/* Kanban */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                  {COLUMNS.map((col) => {
                    const colItems = columnItems[col.key] ?? [];
                    const Icon = col.icon;
                    return (
                      <div key={col.key} className={`rounded-2xl border ${col.bg} flex flex-col`}>
                        {/* Column header */}
                        <div className={`${col.headerBg} rounded-t-2xl px-4 py-3 flex items-center justify-between`}>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${col.dot}`} />
                            <Icon className={`w-4 h-4 ${col.colour}`} />
                            <span className={`text-sm font-semibold ${col.colour}`}>{col.label}</span>
                          </div>
                          <span className="text-xs font-medium text-gray-500 bg-white/60 px-2 py-0.5 rounded-full">
                            {colItems.length}
                          </span>
                        </div>
                        {/* Cards */}
                        <div className="p-3 flex flex-col gap-3 flex-1">
                          {colItems.length === 0 ? (
                            <div className="text-center py-8 text-xs text-gray-400">Nothing here yet</div>
                          ) : (
                            colItems.map((item) => <RoadmapCard key={item.id} item={item} />)
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Recently Released */}
                {releasedItems.length > 0 && (
                  <div id="recently-released">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <h2 className="text-lg font-bold text-gray-900">Recently Released</h2>
                      </div>
                      <div className="flex-1 h-px bg-gradient-to-r from-emerald-200 to-transparent" />
                    </div>
                    <div className="relative">
                      {/* Timeline line */}
                      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-400 to-emerald-100 hidden md:block" />
                      <div className="flex flex-col gap-4">
                        {releasedItems.map((item) => (
                          <div key={item.id} className="flex gap-6 items-start">
                            {/* Timeline dot */}
                            <div className="hidden md:flex flex-col items-center">
                              <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center z-10">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              </div>
                            </div>
                            {/* Card */}
                            <div className="flex-1 bg-white rounded-xl border border-emerald-100 p-4 shadow-sm">
                              <div className="flex items-start justify-between gap-3 mb-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${CATEGORY_COLOURS[item.category] ?? CATEGORY_COLOURS.Other}`}>
                                    {item.category}
                                  </span>
                                  {item.fromSuggestionId && (
                                    <span className="inline-flex items-center gap-1 text-xs text-pink-600 bg-pink-50 border border-pink-200 px-2 py-0.5 rounded-full">
                                      <Users className="w-3 h-3" />
                                      Community
                                    </span>
                                  )}
                                </div>
                                {item.releasedAt && (
                                  <span className="text-xs text-emerald-600 font-medium whitespace-nowrap">
                                    {new Date(item.releasedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                  </span>
                                )}
                              </div>
                              <h3 className="font-semibold text-gray-900 text-sm">{item.title}</h3>
                              {item.description && (
                                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{item.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {Object.values(columnItems).every((c) => c.length === 0) && releasedItems.length === 0 && (
                  <div className="text-center py-20">
                    <Rocket className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-500 mb-1">Roadmap coming soon</h3>
                    <p className="text-sm text-gray-400">Check back shortly — we're adding items now.</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Suggestions Tab ── */}
        {tab === "suggestions" && (
          <div>
            {/* Suggestions CTA banner */}
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Lightbulb className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Have an idea?</h2>
                  <p className="text-sm text-gray-600 mt-0.5">Submit a feature request and let other agents vote on it. The most popular ideas shape our roadmap.</p>
                </div>
              </div>
              <Button
                onClick={() => setShowSubmitDialog(true)}
                className="bg-amber-500 hover:bg-amber-600 text-white font-semibold gap-2 whitespace-nowrap shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Submit Your Idea
              </Button>
            </div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Community Suggestions</h2>
                <p className="text-sm text-gray-500 mt-0.5">Sorted by votes — upvote the features you want most.</p>
              </div>
            </div>

            {suggestionsLoading ? (
              <div className="flex flex-col gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : sortedSuggestions.length === 0 ? (
              <div className="text-center py-20">
                <Lightbulb className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-500 mb-1">No suggestions yet</h3>
                <p className="text-sm text-gray-400 mb-6">Be the first to share an idea!</p>
                <Button onClick={() => setShowSubmitDialog(true)} className="bg-[#02E6D2] hover:bg-[#00c9b8] text-[#1a1a2e] font-semibold gap-2">
                  <Plus className="w-4 h-4" />
                  Submit Idea
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {sortedSuggestions.map((s) => (
                  <SuggestionCard key={s.id} suggestion={s} onVote={handleVote} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Submit Idea Dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-amber-500" />
              Submit an Idea
            </DialogTitle>
            <DialogDescription>
              Share a feature request or improvement idea. Your submission is anonymous to other agents.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Title <span className="text-red-500">*</span></label>
              <Input
                placeholder="e.g. Export bookings to PDF"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                maxLength={255}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Description <span className="text-gray-400 font-normal">(optional)</span></label>
              <Textarea
                placeholder="Describe your idea in more detail..."
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={4}
                maxLength={2000}
              />
              <p className="text-xs text-gray-400 mt-1 text-right">{newDesc.length}/2000</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)}>Cancel</Button>
            <Button
              onClick={() => submitMutation.mutate({ title: newTitle.trim(), description: newDesc.trim() || undefined })}
              disabled={!newTitle.trim() || submitMutation.isPending}
              className="bg-[#02E6D2] hover:bg-[#00c9b8] text-[#1a1a2e] font-semibold"
            >
              {submitMutation.isPending ? "Submitting…" : "Submit Idea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
