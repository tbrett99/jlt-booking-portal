import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Search, CheckCheck, ArrowRight, User, Tag, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type DeptTag = "Commissions" | "Refunds" | "Amendments" | "Reimbursements" | "New Booking" | "Support";

const TAG_STYLES: Record<DeptTag, { bg: string; color: string }> = {
  Commissions:    { bg: "#dbeafe", color: "#1e40af" },
  Refunds:        { bg: "#fee2e2", color: "#991b1b" },
  Amendments:     { bg: "#fef3c7", color: "#92400e" },
  Reimbursements: { bg: "#ede9fe", color: "#5b21b6" },
  "New Booking":  { bg: "#d1fae5", color: "#065f46" },
  Support:        { bg: "#fce7f3", color: "#9d174d" },
};

const ALL_TAGS: DeptTag[] = ["Commissions", "Refunds", "Amendments", "Reimbursements", "New Booking", "Support"];

function TagChip({ tag, onRemove, onClick }: { tag: DeptTag; onRemove?: () => void; onClick?: () => void }) {
  const s = TAG_STYLES[tag];
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full cursor-pointer select-none"
      style={{ background: s.bg, color: s.color }}
      onClick={onClick}
      title={onClick ? `Click to filter by ${tag}` : undefined}
    >
      {tag}
      {onRemove && (
        <button
          className="ml-0.5 hover:opacity-70"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove tag"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

function TagSelector({ bookingId, currentTag, onTagSet }: { bookingId: number; currentTag: string | null; onTagSet: (tag: DeptTag | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-dashed border-border hover:border-foreground/30 transition-colors"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        title="Set department tag"
      >
        <Tag size={11} />
        {currentTag ? <span style={{ color: TAG_STYLES[currentTag as DeptTag]?.color }}>{currentTag}</span> : "Tag"}
      </button>
      {open && (
        <div
          className="absolute z-50 top-full mt-1 right-0 bg-popover border border-border rounded-xl shadow-lg p-2 min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] text-muted-foreground px-1 mb-1.5 font-medium uppercase tracking-wide">Department</p>
          <div className="flex flex-col gap-1">
            {ALL_TAGS.map((t) => (
              <button
                key={t}
                className="text-left px-2 py-1 rounded hover:bg-muted text-xs font-medium transition-colors flex items-center gap-2"
                style={{ color: TAG_STYLES[t].color }}
                onClick={() => { onTagSet(t); setOpen(false); }}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TAG_STYLES[t].color }} />
                {t}
              </button>
            ))}
            {currentTag && (
              <button
                className="text-left px-2 py-1 rounded hover:bg-muted text-xs text-muted-foreground mt-1 border-t border-border pt-2"
                onClick={() => { onTagSet(null); setOpen(false); }}
              >
                Remove tag
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminMessages() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const [tagFilter, setTagFilter] = useState<DeptTag | null>(null);

  const utils = trpc.useUtils();
  const { data: threads = [], isLoading, refetch } = trpc.notes.allThreads.useQuery();
  const markRead = trpc.notes.markBookingNotesRead.useMutation({
    onSuccess: () => { refetch(); utils.notes.totalUnreadCount.invalidate(); },
  });
  const markAllRead = trpc.notes.markAllRead.useMutation({
    onSuccess: () => { refetch(); utils.notes.totalUnreadCount.invalidate(); },
  });
  const setTag = trpc.notes.setThreadTag.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => toast.error(e.message),
  });

  const sortedThreads = [...threads].sort((a, b) => new Date(b.latestMessageAt).getTime() - new Date(a.latestMessageAt).getTime());

  const filtered = sortedThreads.filter((t) => {
    if (filter === "unread" && t.unreadCount === 0) return false;
    if (tagFilter && t.tag !== tagFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.clientName.toLowerCase().includes(q) ||
        t.agentName.toLowerCase().includes(q) ||
        (t.ptsRef ?? "").toLowerCase().includes(q) ||
        (t.topdogRef ?? "").toLowerCase().includes(q) ||
        t.latestMessage.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalUnread = sortedThreads.filter((t) => t.unreadCount > 0).length;

  // Tag counts for filter bar
  const tagCounts = ALL_TAGS.reduce((acc, tag) => {
    acc[tag] = sortedThreads.filter((t) => t.tag === tag && (filter === "all" || t.unreadCount > 0)).length;
    return acc;
  }, {} as Record<DeptTag, number>);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(112,255,232,0.15)" }}>
            <MessageSquare size={20} style={{ color: "#02E6D2" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Messages</h1>
            <p className="text-sm text-muted-foreground">
              {totalUnread > 0 ? `${totalUnread} booking${totalUnread !== 1 ? "s" : ""} with unread messages` : "All messages read"}
            </p>
          </div>
          {totalUnread > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-sm gap-1.5"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck size={14} />
              {markAllRead.isPending ? "Marking…" : "Mark all as read"}
            </Button>
          )}
        </div>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by client, agent, ref or message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex rounded-lg overflow-hidden border border-border text-sm">
          <button
            className={`px-4 py-1.5 font-medium transition-colors ${filter === "unread" ? "text-white" : "text-muted-foreground hover:bg-muted"}`}
            style={filter === "unread" ? { background: "#02E6D2", color: "#414141" } : {}}
            onClick={() => setFilter("unread")}
          >
            Unread {totalUnread > 0 && <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5">{totalUnread}</span>}
          </button>
          <button
            className={`px-4 py-1.5 font-medium transition-colors ${filter === "all" ? "text-white" : "text-muted-foreground hover:bg-muted"}`}
            style={filter === "all" ? { background: "#02E6D2", color: "#414141" } : {}}
            onClick={() => setFilter("all")}
          >
            All ({threads.length})
          </button>
        </div>
      </div>

      {/* Department tag filter bar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Filter by dept:</span>
        {ALL_TAGS.map((tag) => {
          const count = tagCounts[tag];
          const isActive = tagFilter === tag;
          const s = TAG_STYLES[tag];
          return (
            <button
              key={tag}
              onClick={() => setTagFilter(isActive ? null : tag)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-all"
              style={{
                background: isActive ? s.bg : "transparent",
                color: isActive ? s.color : "var(--muted-foreground)",
                borderColor: isActive ? s.color : "var(--border)",
                opacity: count === 0 ? 0.4 : 1,
              }}
            >
              {tag}
              {count > 0 && <span className="text-[10px] opacity-70">({count})</span>}
            </button>
          );
        })}
        {tagFilter && (
          <button className="text-xs text-muted-foreground underline" onClick={() => setTagFilter(null)}>
            Clear
          </button>
        )}
      </div>

      {/* Thread list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">
            {tagFilter ? `No ${filter === "unread" ? "unread " : ""}messages tagged "${tagFilter}"` : filter === "unread" ? "No unread messages" : "No message threads yet"}
          </p>
          {filter === "unread" && !tagFilter && (
            <button className="mt-2 text-sm underline" onClick={() => setFilter("all")}>View all threads</button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((thread) => {
            const isUnread = thread.unreadCount > 0;
            const isAgentLatest = thread.latestAuthorRole === "agent";
            const currentTag = thread.tag as DeptTag | null;
            return (
              <div
                key={thread.bookingId}
                className="rounded-xl border transition-all"
                style={{
                  borderColor: isUnread ? "#02E6D2" : "var(--border)",
                  background: isUnread ? "rgba(2,230,210,0.04)" : "var(--card)",
                }}
              >
                <div className="flex items-start gap-4 p-4">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: isAgentLatest ? "#FFF6ED" : "rgba(112,255,232,0.15)" }}>
                    <User size={16} style={{ color: isAgentLatest ? "#92400e" : "#0f766e" }} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Row 1: client name, unread badge, time */}
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-semibold text-sm text-foreground">{thread.clientName}</span>
                      {isUnread && (
                        <span className="flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#ef4444", color: "white" }}>
                          {thread.unreadCount} unread
                        </span>
                      )}
                      {currentTag && (
                        <TagChip
                          tag={currentTag}
                          onRemove={() => setTag.mutate({ bookingId: thread.bookingId, tag: null })}
                        />
                      )}
                      <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                        {formatDistanceToNow(new Date(thread.latestMessageAt), { addSuffix: true })}
                      </span>
                    </div>

                    {/* Row 2: agent, refs, last admin responder */}
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">Agent: <span className="font-medium text-foreground/80">{thread.agentName}</span></span>
                      {thread.ptsRef && <span className="text-xs text-muted-foreground">· PTS: {thread.ptsRef}</span>}
                      {thread.topdogRef && <span className="text-xs text-muted-foreground">· TD: {thread.topdogRef}</span>}
                      {(thread as any).lastAdminName && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          Last replied by: <span className="font-medium text-foreground/80">{(thread as any).lastAdminName}</span>
                        </span>
                      )}
                    </div>

                    {/* Row 3: message preview (2 lines) */}
                    <p
                      className="text-sm text-muted-foreground"
                      style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                    >
                      <span className="font-medium text-foreground">{thread.latestAuthorName}:</span>{" "}
                      {thread.latestMessage.replace(/^\[System\]\s*/i, "")}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 flex-shrink-0 items-end">
                    <Link href={`/bookings/${thread.bookingId}`}>
                      <Button size="sm" className="h-8 text-xs gap-1.5" style={{ background: "#02E6D2", color: "#414141" }}>
                        Open <ArrowRight size={13} />
                      </Button>
                    </Link>
                    <TagSelector
                      bookingId={thread.bookingId}
                      currentTag={currentTag}
                      onTagSet={(tag) => setTag.mutate({ bookingId: thread.bookingId, tag })}
                    />
                    {isUnread && (
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                        onClick={() => markRead.mutate({ bookingId: thread.bookingId })}
                      >
                        <CheckCheck size={12} /> Mark read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
