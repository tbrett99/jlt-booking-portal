import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Eye, EyeOff, Lightbulb, Rocket, Clock, CheckCircle2,
  ChevronDown, ChevronUp, MessageSquare, Send, ThumbsUp, ThumbsDown, ArrowRight, Users, Sparkles
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type RoadmapItem = {
  id: number;
  title: string;
  description: string | null;
  category: string;
  status: string;
  timeframe: string | null;
  progressPct: number;
  internalNotes: string | null;
  effort: string | null;
  priorityScore: number;
  fromSuggestionId: number | null;
  isVisible: boolean;
  sortOrder: number;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

type Note = {
  id: number;
  note: string;
  createdAt: Date;
  authorName: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = ["Bookings", "Payments", "CRM", "Reports", "Commissions", "Community", "Mobile", "Admin", "Other"] as const;
const STATUSES = [
  { value: "under_consideration", label: "Under Consideration", icon: Lightbulb, colour: "text-amber-600 bg-amber-50 border-amber-200" },
  { value: "planned", label: "Planned", icon: Clock, colour: "text-blue-600 bg-blue-50 border-blue-200" },
  { value: "in_progress", label: "In Progress", icon: Rocket, colour: "text-violet-600 bg-violet-50 border-violet-200" },
  { value: "released", label: "Released", icon: CheckCircle2, colour: "text-emerald-600 bg-emerald-50 border-emerald-200" },
] as const;
const EFFORTS = [
  { value: "small", label: "Small (< 1 day)" },
  { value: "medium", label: "Medium (1–3 days)" },
  { value: "large", label: "Large (1–2 weeks)" },
  { value: "xl", label: "XL (> 2 weeks)" },
];
const CATEGORY_COLOURS: Record<string, string> = {
  Bookings: "bg-blue-100 text-blue-700",
  Payments: "bg-emerald-100 text-emerald-700",
  CRM: "bg-purple-100 text-purple-700",
  Reports: "bg-amber-100 text-amber-700",
  Commissions: "bg-orange-100 text-orange-700",
  Community: "bg-pink-100 text-pink-700",
  Mobile: "bg-cyan-100 text-cyan-700",
  Admin: "bg-slate-100 text-slate-700",
  Other: "bg-gray-100 text-gray-600",
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

// ─── Item Form ────────────────────────────────────────────────────────────────

type ItemFormState = {
  title: string;
  description: string;
  category: string;
  status: string;
  timeframe: string;
  progressPct: number;
  internalNotes: string;
  effort: string;
  priorityScore: number;
  isVisible: boolean;
  sortOrder: number;
};

const defaultForm = (): ItemFormState => ({
  title: "",
  description: "",
  category: "Other",
  status: "planned",
  timeframe: "",
  progressPct: 0,
  internalNotes: "",
  effort: "",
  priorityScore: 0,
  isVisible: true,
  sortOrder: 0,
});

function ItemFormDialog({
  open,
  onClose,
  initial,
  onSave,
  isSaving,
  title: dialogTitle,
}: {
  open: boolean;
  onClose: () => void;
  initial: ItemFormState;
  onSave: (data: ItemFormState) => void;
  isSaving: boolean;
  title: string;
}) {
  const [form, setForm] = useState<ItemFormState>(initial);
  const set = (k: keyof ItemFormState, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Reset when dialog opens
  useState(() => { setForm(initial); });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Title <span className="text-red-500">*</span></Label>
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Feature title" maxLength={255} className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What does this feature do?" rows={3} className="mt-1" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Timeframe</Label>
              <Input value={form.timeframe} onChange={(e) => set("timeframe", e.target.value)} placeholder="e.g. Q3 2026, July 2026" className="mt-1" />
            </div>
            <div>
              <Label>Effort</Label>
              <Select value={form.effort || ""} onValueChange={(v) => set("effort", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select effort" /></SelectTrigger>
                <SelectContent>
                  {EFFORTS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.status === "in_progress" && (
              <div className="col-span-2">
                <Label>Progress ({form.progressPct}%)</Label>
                <input
                  type="range" min={0} max={100} value={form.progressPct}
                  onChange={(e) => set("progressPct", Number(e.target.value))}
                  className="w-full mt-2 accent-violet-500"
                />
              </div>
            )}
            <div>
              <Label>Priority Score</Label>
              <Input type="number" value={form.priorityScore} onChange={(e) => set("priorityScore", Number(e.target.value))} className="mt-1" />
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input type="number" value={form.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Internal Notes <span className="text-gray-400 font-normal text-xs">(admin only — never shown to agents)</span></Label>
              <Textarea value={form.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} placeholder="Blockers, dependencies, dev notes..." rows={3} className="mt-1" />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <Switch checked={form.isVisible} onCheckedChange={(v) => set("isVisible", v)} id="visible-switch" />
              <Label htmlFor="visible-switch">Visible to agents</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave(form)}
            disabled={!form.title.trim() || isSaving}
            className="bg-[#02E6D2] hover:bg-[#00c9b8] text-[#1a1a2e] font-semibold"
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Convert Suggestion Dialog ────────────────────────────────────────────────

function ConvertSuggestionDialog({
  suggestion,
  onClose,
  onConvert,
  isConverting,
}: {
  suggestion: Suggestion | null;
  onClose: () => void;
  onConvert: (suggestionId: number, data: any) => void;
  isConverting: boolean;
}) {
  const [form, setForm] = useState({ title: "", description: "", category: "Other", status: "planned", timeframe: "", isVisible: true });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  if (!suggestion) return null;

  // Pre-fill from suggestion when it changes
  const prefill = () => {
    setForm({ title: suggestion.title, description: suggestion.description ?? "", category: "Other", status: "planned", timeframe: "", isVisible: true });
  };

  return (
    <Dialog open={!!suggestion} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-violet-600" />
            Convert to Roadmap Item
          </DialogTitle>
          <DialogDescription>
            This will create a new roadmap item and link it to the suggestion.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Title <span className="text-red-500">*</span></Label>
            <Input value={form.title || suggestion.title} onChange={(e) => set("title", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Timeframe</Label>
            <Input value={form.timeframe} onChange={(e) => set("timeframe", e.target.value)} placeholder="e.g. Q3 2026" className="mt-1" />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.isVisible} onCheckedChange={(v) => set("isVisible", v)} id="conv-visible" />
            <Label htmlFor="conv-visible">Visible to agents immediately</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onConvert(suggestion.id, { ...form, title: form.title || suggestion.title })}
            disabled={isConverting}
            className="bg-violet-600 hover:bg-violet-700 text-white font-semibold gap-2"
          >
            <ArrowRight className="w-4 h-4" />
            {isConverting ? "Converting…" : "Convert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Item Row with Notes Panel ────────────────────────────────────────────────

function ItemRow({ item, onEdit, onDelete }: { item: RoadmapItem; onEdit: (item: RoadmapItem) => void; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState("");
  const utils = trpc.useUtils();

  const { data: notes = [], isLoading: notesLoading } = trpc.roadmap.listNotes.useQuery(
    { itemId: item.id },
    { enabled: expanded }
  );

  const addNoteMutation = trpc.roadmap.addNote.useMutation({
    onSuccess: () => {
      setNoteText("");
      utils.roadmap.listNotes.invalidate({ itemId: item.id });
    },
    onError: (e) => toast.error(e.message),
  });

  const statusConfig = STATUSES.find((s) => s.value === item.status);
  const StatusIcon = statusConfig?.icon ?? Clock;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Main row */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statusConfig?.colour ?? ""}`}>
                <StatusIcon className="w-3 h-3" />
                {statusConfig?.label ?? item.status}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLOURS[item.category] ?? ""}`}>
                {item.category}
              </span>
              {!item.isVisible && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                  <EyeOff className="w-3 h-3" />
                  Hidden
                </span>
              )}
              {item.fromSuggestionId && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-pink-50 text-pink-600 border border-pink-200">
                  <Users className="w-3 h-3" />
                  From suggestion
                </span>
              )}
            </div>
            <h3 className="font-semibold text-gray-900 text-sm">{item.title}</h3>
            {item.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.description}</p>}
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
              {item.timeframe && <span>📅 {item.timeframe}</span>}
              {item.effort && <span>⚡ {item.effort}</span>}
              {item.priorityScore > 0 && <span>🎯 Priority {item.priorityScore}</span>}
              {item.status === "in_progress" && <span className="text-violet-600 font-medium">{item.progressPct}% complete</span>}
            </div>
            {item.internalNotes && (
              <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <span className="font-semibold">Internal: </span>{item.internalNotes}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)} className="text-gray-500 gap-1">
              <MessageSquare className="w-4 h-4" />
              <span className="text-xs">Notes</span>
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onEdit(item)} className="text-gray-500">
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete(item.id)} className="text-red-400 hover:text-red-600">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Notes panel */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Internal Activity Log</h4>
          {notesLoading ? (
            <div className="text-xs text-gray-400">Loading…</div>
          ) : (notes as Note[]).length === 0 ? (
            <div className="text-xs text-gray-400 mb-3">No notes yet.</div>
          ) : (
            <div className="flex flex-col gap-2 mb-3">
              {(notes as Note[]).map((n) => (
                <div key={n.id} className="bg-white rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">{n.authorName ?? "Admin"}</span>
                    <span className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <p className="text-xs text-gray-600 whitespace-pre-wrap">{n.note}</p>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note (blockers, updates, decisions)…"
              rows={2}
              className="text-xs"
            />
            <Button
              size="sm"
              onClick={() => addNoteMutation.mutate({ itemId: item.id, note: noteText.trim() })}
              disabled={!noteText.trim() || addNoteMutation.isPending}
              className="bg-[#02E6D2] hover:bg-[#00c9b8] text-[#1a1a2e] self-end"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AdminSuggestionCard ──────────────────────────────────────────────────────────

type Reply = { id: number; body: string; createdAt: Date; updatedAt: Date; authorName: string | null };

function AdminSuggestionCard({
  s,
  expandedReplies, setExpandedReplies,
  replyingToId, setReplyingToId,
  replyText, setReplyText,
  editingReply, setEditingReply,
  addReplyMutation, editReplyMutation, deleteReplyMutation,
  updateSuggestionStatusMutation,
  setConvertingSuggestion,
  deleteSuggestionMutation,
}: {
  s: Suggestion;
  expandedReplies: Set<number>;
  setExpandedReplies: React.Dispatch<React.SetStateAction<Set<number>>>;
  replyingToId: number | null;
  setReplyingToId: (id: number | null) => void;
  replyText: string;
  setReplyText: (t: string) => void;
  editingReply: { replyId: number; body: string } | null;
  setEditingReply: (r: { replyId: number; body: string } | null) => void;
  addReplyMutation: any;
  editReplyMutation: any;
  deleteReplyMutation: any;
  updateSuggestionStatusMutation: any;
  setConvertingSuggestion: (s: Suggestion) => void;
  deleteSuggestionMutation: any;
}) {
  const isExpanded = expandedReplies.has(s.id);
  const toggleReplies = () => setExpandedReplies((prev) => {
    const next = new Set(prev);
    if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
    return next;
  });

  const { data: replies = [], isLoading: repliesLoading } = trpc.roadmap.listReplies.useQuery(
    { suggestionId: s.id },
    { enabled: isExpanded }
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-4">
        <div className="flex gap-4 items-start">
          {/* Vote score */}
          <div className="flex flex-col items-center min-w-[48px]">
            <ThumbsUp className="w-4 h-4 text-emerald-500 mb-0.5" />
            <span className={`text-sm font-bold tabular-nums ${s.votes > 0 ? "text-emerald-600" : s.votes < 0 ? "text-red-500" : "text-gray-500"}`}>
              {s.votes > 0 ? `+${s.votes}` : s.votes}
            </span>
          </div>
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="font-semibold text-gray-900 text-sm">{s.title}</h3>
              <div className="flex items-center gap-2 shrink-0">
                <Select
                  value={s.status}
                  onValueChange={(v) => updateSuggestionStatusMutation.mutate({ id: s.id, status: v as any })}
                >
                  <SelectTrigger className={`h-7 text-xs w-36 ${SUGGESTION_STATUS_COLOURS[s.status] ?? ""}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="under_review">Under Review</SelectItem>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {s.description && <p className="text-xs text-gray-500 mb-2">{s.description}</p>}
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="font-medium text-gray-600">By: {s.submitterName ?? "Unknown"}</span>
              <span>{new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              {s.convertedToItemId && (
                <span className="text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  On roadmap
                </span>
              )}
            </div>
          </div>
          {/* Actions */}
          <div className="flex gap-2 shrink-0">
            {!s.convertedToItemId && (
              <Button
                size="sm" variant="outline"
                onClick={() => setConvertingSuggestion(s)}
                className="text-violet-600 border-violet-200 hover:bg-violet-50 gap-1 text-xs"
              >
                <ArrowRight className="w-3 h-3" />
                Add to Roadmap
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => deleteSuggestionMutation.mutate({ id: s.id })} className="text-red-400 hover:text-red-600">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Replies section */}
      <div className="border-t border-gray-100">
        <button
          onClick={toggleReplies}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-[#02E6D2]" />
            <span className="font-medium text-[#02E6D2]">Admin Replies</span>
            {!isExpanded && (
              <span className="text-gray-400">(click to view / reply)</span>
            )}
          </span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {isExpanded && (
          <div className="px-4 pb-4 space-y-3">
            {repliesLoading ? (
              <div className="h-10 rounded-lg bg-gray-100 animate-pulse" />
            ) : replies.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No replies yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(replies as Reply[]).map((reply) => (
                  <div key={reply.id} className="bg-[#f0fffe] border border-[#70FFE8]/40 rounded-xl p-3">
                    {editingReply?.replyId === reply.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editingReply.body}
                          onChange={(e) => setEditingReply({ ...editingReply, body: e.target.value })}
                          rows={3}
                          className="text-xs"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => editReplyMutation.mutate({ replyId: reply.id, body: editingReply.body })} disabled={editReplyMutation.isPending} className="bg-[#02E6D2] hover:bg-[#00c9b8] text-[#1a1a2e] text-xs h-7">
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingReply(null)} className="text-xs h-7">Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#1a1a2e]">{reply.authorName ?? "Admin"}</span>
                            <span className="text-xs text-gray-400">{new Date(reply.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => setEditingReply({ replyId: reply.id, body: reply.body })} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button onClick={() => deleteReplyMutation.mutate({ replyId: reply.id })} className="p-1 text-gray-400 hover:text-red-500 rounded">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{reply.body}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Reply compose */}
            {replyingToId === s.id ? (
              <div className="space-y-2">
                <Textarea
                  placeholder="Write a reply visible to all agents..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => addReplyMutation.mutate({ suggestionId: s.id, body: replyText.trim() })}
                    disabled={!replyText.trim() || addReplyMutation.isPending}
                    className="bg-[#02E6D2] hover:bg-[#00c9b8] text-[#1a1a2e] font-semibold gap-1.5 text-xs h-7"
                  >
                    <Send className="w-3 h-3" />
                    Post Reply
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setReplyingToId(null); setReplyText(""); }} className="text-xs h-7">Cancel</Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm" variant="outline"
                onClick={() => { setReplyingToId(s.id); }}
                className="gap-1.5 text-xs h-7 text-[#02E6D2] border-[#02E6D2]/40 hover:bg-[#f0fffe]"
              >
                <MessageSquare className="w-3 h-3" />
                Add Reply
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────

export default function AdminRoadmap() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"items" | "suggestions">("items");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<RoadmapItem | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [convertingSuggestion, setConvertingSuggestion] = useState<Suggestion | null>(null);
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [expandedReplies, setExpandedReplies] = useState<Set<number>>(new Set());
  const [editingReply, setEditingReply] = useState<{ replyId: number; body: string } | null>(null);

  const { data: items = [], isLoading: itemsLoading } = trpc.roadmap.listAdmin.useQuery();
  const { data: suggestions = [], isLoading: suggestionsLoading } = trpc.roadmap.listSuggestions.useQuery();

  const createMutation = trpc.roadmap.create.useMutation({
    onSuccess: () => { toast.success("Roadmap item created"); setShowCreateDialog(false); utils.roadmap.listAdmin.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.roadmap.update.useMutation({
    onSuccess: () => { toast.success("Saved"); setEditingItem(null); utils.roadmap.listAdmin.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.roadmap.delete.useMutation({
    onSuccess: () => { toast.success("Deleted"); setDeletingId(null); utils.roadmap.listAdmin.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteSuggestionMutation = trpc.roadmap.deleteSuggestion.useMutation({
    onSuccess: () => { toast.success("Suggestion deleted"); utils.roadmap.listSuggestions.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const updateSuggestionStatusMutation = trpc.roadmap.updateSuggestionStatus.useMutation({
    onSuccess: () => utils.roadmap.listSuggestions.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const addReplyMutation = trpc.roadmap.addReply.useMutation({
    onSuccess: (_data, vars) => {
      toast.success("Reply posted");
      setReplyingToId(null);
      setReplyText("");
      utils.roadmap.listReplies.invalidate({ suggestionId: vars.suggestionId });
    },
    onError: (e) => toast.error(e.message),
  });

  const editReplyMutation = trpc.roadmap.editReply.useMutation({
    onSuccess: (_data, vars) => {
      toast.success("Reply updated");
      setEditingReply(null);
      // Invalidate all suggestion replies (we don't know which suggestionId from here)
      utils.roadmap.listReplies.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteReplyMutation = trpc.roadmap.deleteReply.useMutation({
    onSuccess: () => {
      toast.success("Reply deleted");
      utils.roadmap.listReplies.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const convertMutation = trpc.roadmap.convertSuggestion.useMutation({
    onSuccess: () => {
      toast.success("Suggestion converted to roadmap item");
      setConvertingSuggestion(null);
      utils.roadmap.listAdmin.invalidate();
      utils.roadmap.listSuggestions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSaveCreate = (form: ItemFormState) => {
    createMutation.mutate({
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      category: form.category as any,
      status: form.status as any,
      timeframe: form.timeframe.trim() || undefined,
      progressPct: form.progressPct,
      internalNotes: form.internalNotes.trim() || undefined,
      effort: (form.effort || undefined) as any,
      priorityScore: form.priorityScore,
      isVisible: form.isVisible,
      sortOrder: form.sortOrder,
    });
  };

  const handleSaveEdit = (form: ItemFormState) => {
    if (!editingItem) return;
    updateMutation.mutate({
      id: editingItem.id,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      category: form.category as any,
      status: form.status as any,
      timeframe: form.timeframe.trim() || null,
      progressPct: form.progressPct,
      internalNotes: form.internalNotes.trim() || null,
      effort: (form.effort || null) as any,
      priorityScore: form.priorityScore,
      isVisible: form.isVisible,
      sortOrder: form.sortOrder,
    });
  };

  const filteredItems = useMemo(() => {
    const all = items as RoadmapItem[];
    if (filterStatus === "all") return all;
    return all.filter((i) => i.status === filterStatus);
  }, [items, filterStatus]);

  const sortedSuggestions = useMemo(
    () => [...(suggestions as Suggestion[])].sort((a, b) => b.votes - a.votes),
    [suggestions]
  );

  const itemToForm = (item: RoadmapItem): ItemFormState => ({
    title: item.title,
    description: item.description ?? "",
    category: item.category,
    status: item.status,
    timeframe: item.timeframe ?? "",
    progressPct: item.progressPct,
    internalNotes: item.internalNotes ?? "",
    effort: item.effort ?? "",
    priorityScore: item.priorityScore,
    isVisible: item.isVisible,
    sortOrder: item.sortOrder,
  });

  const statusCounts = useMemo(() => {
    const all = items as RoadmapItem[];
    return {
      all: all.length,
      under_consideration: all.filter((i) => i.status === "under_consideration").length,
      planned: all.filter((i) => i.status === "planned").length,
      in_progress: all.filter((i) => i.status === "in_progress").length,
      released: all.filter((i) => i.status === "released").length,
    };
  }, [items]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-[#02E6D2]" />
            Roadmap Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage the public roadmap and community suggestions</p>
        </div>
        <Button
          onClick={() => setShowCreateDialog(true)}
          className="bg-[#02E6D2] hover:bg-[#00c9b8] text-[#1a1a2e] font-semibold gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Item
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <button
          onClick={() => setTab("items")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "items" ? "border-[#02E6D2] text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"}`}
        >
          Roadmap Items
          <span className="ml-2 bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{(items as RoadmapItem[]).length}</span>
        </button>
        <button
          onClick={() => setTab("suggestions")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "suggestions" ? "border-[#02E6D2] text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"}`}
        >
          Community Suggestions
          <span className="ml-2 bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{(suggestions as Suggestion[]).length}</span>
        </button>
      </div>

      {/* ── Roadmap Items Tab ── */}
      {tab === "items" && (
        <div>
          {/* Status filter */}
          <div className="flex gap-2 flex-wrap mb-5">
            {[
              { key: "all", label: "All", count: statusCounts.all },
              { key: "under_consideration", label: "Under Consideration", count: statusCounts.under_consideration },
              { key: "planned", label: "Planned", count: statusCounts.planned },
              { key: "in_progress", label: "In Progress", count: statusCounts.in_progress },
              { key: "released", label: "Released", count: statusCounts.released },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilterStatus(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterStatus === f.key
                    ? "bg-[#02E6D2] text-[#1a1a2e]"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>

          {itemsLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Rocket className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No items yet. Click "Add Item" to get started.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onEdit={(i) => setEditingItem(i)}
                  onDelete={(id) => setDeletingId(id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Suggestions Tab ── */}
      {tab === "suggestions" && (
        <div>
          {suggestionsLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          ) : sortedSuggestions.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Lightbulb className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No suggestions yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {sortedSuggestions.map((s) => (
                <AdminSuggestionCard
                  key={s.id}
                  s={s}
                  expandedReplies={expandedReplies}
                  setExpandedReplies={setExpandedReplies}
                  replyingToId={replyingToId}
                  setReplyingToId={setReplyingToId}
                  replyText={replyText}
                  setReplyText={setReplyText}
                  editingReply={editingReply}
                  setEditingReply={setEditingReply}
                  addReplyMutation={addReplyMutation}
                  editReplyMutation={editReplyMutation}
                  deleteReplyMutation={deleteReplyMutation}
                  updateSuggestionStatusMutation={updateSuggestionStatusMutation}
                  setConvertingSuggestion={setConvertingSuggestion}
                  deleteSuggestionMutation={deleteSuggestionMutation}
                />
              ))}

            </div>
          )}
        </div>
      )}

      {/* Create Dialog */}
      <ItemFormDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        initial={defaultForm()}
        onSave={handleSaveCreate}
        isSaving={createMutation.isPending}
        title="Add Roadmap Item"
      />

      {/* Edit Dialog */}
      {editingItem && (
        <ItemFormDialog
          open={!!editingItem}
          onClose={() => setEditingItem(null)}
          initial={itemToForm(editingItem)}
          onSave={handleSaveEdit}
          isSaving={updateMutation.isPending}
          title="Edit Roadmap Item"
        />
      )}

      {/* Delete Confirm */}
      <Dialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Roadmap Item</DialogTitle>
            <DialogDescription>This will permanently delete the item and all its internal notes. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deletingId && deleteMutation.mutate({ id: deletingId })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Suggestion Dialog */}
      <ConvertSuggestionDialog
        suggestion={convertingSuggestion}
        onClose={() => setConvertingSuggestion(null)}
        onConvert={(id, data) => convertMutation.mutate({ suggestionId: id, ...data })}
        isConverting={convertMutation.isPending}
      />
    </div>
  );
}
