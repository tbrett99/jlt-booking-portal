import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { MessageSquare, Search, CheckCheck, ArrowRight, User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export default function AdminMessages() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("unread");

  const utils = trpc.useUtils();
  const { data: threads = [], isLoading, refetch } = trpc.notes.allThreads.useQuery();
  const markRead = trpc.notes.markBookingNotesRead.useMutation({
    onSuccess: () => {
      refetch();
      utils.notes.totalUnreadCount.invalidate();
    },
  });
  const markAllRead = trpc.notes.markAllRead.useMutation({
    onSuccess: () => {
      refetch();
      utils.notes.totalUnreadCount.invalidate();
    },
  });

  // Sort oldest first (ascending by latest message date)
  const sortedThreads = [...threads].sort((a, b) => new Date(a.latestMessageAt).getTime() - new Date(b.latestMessageAt).getTime());

  const filtered = sortedThreads.filter((t) => {
    if (filter === "unread" && t.unreadCount === 0) return false;
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

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
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

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
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

      {/* Thread list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">{filter === "unread" ? "No unread messages" : "No message threads yet"}</p>
          {filter === "unread" && (
            <button className="mt-2 text-sm underline" onClick={() => setFilter("all")}>View all threads</button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((thread) => {
            const isUnread = thread.unreadCount > 0;
            const isAgentLatest = thread.latestAuthorRole === "agent";
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
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-semibold text-sm text-foreground truncate">{thread.clientName}</span>
                      {isUnread && (
                        <span className="flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#ef4444", color: "white" }}>
                          {thread.unreadCount} unread
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                        {formatDistanceToNow(new Date(thread.latestMessageAt), { addSuffix: true })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xs text-muted-foreground">Agent: {thread.agentName}</span>
                      {thread.ptsRef && (
                        <span className="text-xs text-muted-foreground">· PTS: {thread.ptsRef}</span>
                      )}
                      {thread.topdogRef && (
                        <span className="text-xs text-muted-foreground">· TD: {thread.topdogRef}</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
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
