import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MessageSquare, ChevronRight, Clock, CheckCircle2, AlertCircle,
  Search, RefreshCw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { format, formatDistanceToNow } from "date-fns";

type Thread = {
  bookingId: number;
  clientName: string;
  topdogRef: string | null;
  ptsRef: string | null;
  latestMessage: string;
  latestMessageAt: Date;
  latestAuthorName: string;
  latestAuthorRole: string;
  totalMessages: number;
};

function ThreadCard({ thread, showBadge }: { thread: Thread; showBadge?: boolean }) {
  const isFromAdmin =
    thread.latestAuthorRole === "admin" || thread.latestAuthorRole === "super_admin";
  const timeAgo = formatDistanceToNow(new Date(thread.latestMessageAt), { addSuffix: true });

  return (
    <Link href={`/bookings/${thread.bookingId}#messages`}>
      <div
        className={`flex items-start gap-3 p-4 rounded-xl border transition-all hover:shadow-sm cursor-pointer ${
          isFromAdmin
            ? "border-[#70FFE8]/60 bg-[#f0fffb] dark:bg-[#0a2e2a]/40"
            : "border-border hover:border-[#70FFE8]/30"
        }`}
      >
        {/* Icon */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{
            background: isFromAdmin ? "#70FFE8" : "#f3f4f6",
            color: isFromAdmin ? "#414141" : "#9ca3af",
          }}
        >
          <MessageSquare size={15} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="font-semibold text-sm text-foreground truncate">
              {thread.clientName}
            </p>
            {showBadge && isFromAdmin && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: "#70FFE8", color: "#414141" }}
              >
                Reply needed
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground truncate mb-1">
            <span className="font-medium">
              {isFromAdmin ? "JLT Team" : "You"}:
            </span>{" "}
            {thread.latestMessage.startsWith("[System]")
              ? "(system note)"
              : thread.latestMessage.length > 100
              ? thread.latestMessage.slice(0, 100) + "…"
              : thread.latestMessage}
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            {thread.topdogRef && (
              <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                {thread.topdogRef}
              </span>
            )}
            {thread.ptsRef && (
              <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                PTS: {thread.ptsRef}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock size={9} />
              {timeAgo}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {thread.totalMessages} message{thread.totalMessages !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        <ChevronRight size={15} className="text-muted-foreground flex-shrink-0 mt-1" />
      </div>
    </Link>
  );
}

export default function AgentMessages() {
  const [tab, setTab] = useState<"unanswered" | "all">("unanswered");
  const [search, setSearch] = useState("");

  const {
    data: unanswered = [],
    isLoading: loadingUnanswered,
    refetch: refetchUnanswered,
  } = trpc.notes.myUnansweredThreads.useQuery();

  const {
    data: allThreads = [],
    isLoading: loadingAll,
    refetch: refetchAll,
  } = trpc.notes.myAllThreads.useQuery(undefined, {
    enabled: tab === "all",
  });

  const isLoading = tab === "unanswered" ? loadingUnanswered : loadingAll;
  const threads = tab === "unanswered" ? unanswered : allThreads;

  const filtered = threads.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.clientName.toLowerCase().includes(q) ||
      (t.topdogRef ?? "").toLowerCase().includes(q) ||
      (t.ptsRef ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Messages</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Conversations with the JLT Team on your bookings
          </p>
        </div>
        <button
          onClick={() => (tab === "unanswered" ? refetchUnanswered() : refetchAll())}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          title="Refresh"
        >
          <RefreshCw size={15} className="text-muted-foreground" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setTab("unanswered")}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
            tab === "unanswered" ? "text-[#414141]" : "text-muted-foreground hover:bg-muted"
          }`}
          style={tab === "unanswered" ? { background: "#70FFE8" } : {}}
        >
          Needs Reply
          {unanswered.length > 0 && (
            <span
              className="ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: "#414141", color: "#70FFE8" }}
            >
              {unanswered.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("all")}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
            tab === "all" ? "text-[#414141]" : "text-muted-foreground hover:bg-muted"
          }`}
          style={tab === "all" ? { background: "#e0e7ff" } : {}}
        >
          All Conversations
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by client name or ref…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>

      {/* Content */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            {tab === "unanswered" ? (
              <>
                <AlertCircle size={15} style={{ color: "#f97316" }} />
                <span>Awaiting Your Reply</span>
              </>
            ) : (
              <>
                <MessageSquare size={15} style={{ color: "#02E6D2" }} />
                <span>All Conversations</span>
              </>
            )}
            <span className="ml-auto text-xs text-muted-foreground font-normal">
              {filtered.length} thread{filtered.length !== 1 ? "s" : ""}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div
                className="animate-spin rounded-full h-8 w-8 border-b-2"
                style={{ borderColor: "#70FFE8" }}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              {tab === "unanswered" ? (
                <>
                  <CheckCircle2
                    size={40}
                    className="mx-auto mb-3 opacity-40"
                    style={{ color: "#059669" }}
                  />
                  <p className="font-medium text-foreground">You're all caught up!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    No messages from JLT Team waiting for your reply.
                  </p>
                </>
              ) : (
                <>
                  <MessageSquare
                    size={40}
                    className="mx-auto mb-3 opacity-30 text-muted-foreground"
                  />
                  <p className="font-medium text-foreground">
                    {search ? "No conversations match your search" : "No conversations yet"}
                  </p>
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="text-sm underline mt-2"
                      style={{ color: "#02E6D2" }}
                    >
                      Clear search
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((thread) => (
                <ThreadCard
                  key={thread.bookingId}
                  thread={thread}
                  showBadge={tab === "unanswered"}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {tab === "unanswered" && unanswered.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Click any conversation to open the booking and reply to JLT Team.
        </p>
      )}
    </div>
  );
}
