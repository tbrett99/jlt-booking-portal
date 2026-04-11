import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { format, isPast, isToday, isTomorrow } from "date-fns";
import {
  CheckSquare, Square, Plus, MessageSquare, ChevronDown, ChevronUp,
  Calendar, User, Tag, Link2, Trash2, Edit3, Send, Loader2,
  AlertCircle, Clock, CheckCircle2, Filter, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import TaskFormDialog from "./TaskFormDialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = "open" | "in_progress" | "done";
type TaskPriority = "low" | "medium" | "high" | "urgent";
type LinkedType = "booking" | "amendment" | "refund" | "cancellation" | "none";

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; icon: React.ReactNode }> = {
  open: { label: "Open", color: "bg-slate-100 text-slate-700 border-slate-200", icon: <Square size={12} /> },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700 border-blue-200", icon: <Clock size={12} /> },
  done: { label: "Done", color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <CheckCircle2 size={12} /> },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  low: { label: "Low", color: "bg-slate-100 text-slate-600 border-slate-200" },
  medium: { label: "Medium", color: "bg-amber-100 text-amber-700 border-amber-200" },
  high: { label: "High", color: "bg-orange-100 text-orange-700 border-orange-200" },
  urgent: { label: "Urgent", color: "bg-red-100 text-red-700 border-red-200" },
};

const LINKED_TYPE_LABELS: Record<LinkedType, string> = {
  booking: "Booking",
  amendment: "Amendment",
  refund: "Refund",
  cancellation: "Cancellation",
  none: "None",
};

function dueDateLabel(dueDate: Date | null | undefined): { text: string; urgent: boolean } | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (isToday(d)) return { text: "Due today", urgent: true };
  if (isTomorrow(d)) return { text: "Due tomorrow", urgent: true };
  if (isPast(d)) return { text: `Overdue (${format(d, "dd MMM")})`, urgent: true };
  return { text: `Due ${format(d, "dd MMM")}`, urgent: false };
}

// ─── Task Row / Card ──────────────────────────────────────────────────────────

function TaskRow({
  task,
  adminUsers,
  onRefresh,
  currentUserId,
}: {
  task: any;
  adminUsers: { id: number; name: string }[];
  onRefresh: () => void;
  currentUserId: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const { data: comments = [], refetch: refetchComments } = trpc.tasks.getComments.useQuery(
    { taskId: task.id },
    { enabled: expanded }
  );

  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: () => onRefresh(),
    onError: (err) => toast.error(err.message || "Failed to update"),
  });
  const deleteTask = trpc.tasks.delete.useMutation({
    onSuccess: () => { toast.success("Task deleted"); onRefresh(); },
    onError: (err) => toast.error(err.message || "Failed to delete"),
  });
  const addComment = trpc.tasks.addComment.useMutation({
    onSuccess: () => { setComment(""); refetchComments(); },
    onError: (err) => toast.error(err.message || "Failed to add comment"),
  });

  const due = dueDateLabel(task.dueDate);
  const statusCfg = STATUS_CONFIG[task.status as TaskStatus];
  const priorityCfg = PRIORITY_CONFIG[task.priority as TaskPriority];

  function cycleStatus() {
    const next: Record<TaskStatus, TaskStatus> = { open: "in_progress", in_progress: "done", done: "open" };
    updateTask.mutate({ id: task.id, status: next[task.status as TaskStatus] });
  }

  function handleSendComment() {
    if (!comment.trim()) return;
    addComment.mutate({ taskId: task.id, content: comment.trim() });
  }

  return (
    <>
      <Card className={`transition-all ${task.status === "done" ? "opacity-60" : ""}`}>
        <CardContent className="px-4 py-3">
          <div className="flex items-start gap-3">
            {/* Status toggle */}
            <button
              onClick={cycleStatus}
              className="mt-0.5 flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              title={`Status: ${statusCfg.label} — click to advance`}
            >
              {task.status === "done"
                ? <CheckSquare size={18} className="text-emerald-500" />
                : task.status === "in_progress"
                ? <Clock size={18} className="text-blue-500" />
                : <Square size={18} />}
            </button>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 flex-wrap">
                <span className={`text-sm font-medium ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                  {task.title}
                </span>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${priorityCfg.color}`}>
                  {priorityCfg.label}
                </Badge>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusCfg.color}`}>
                  {statusCfg.label}
                </Badge>
                {due && (
                  <span className={`flex items-center gap-1 text-[10px] font-medium ${due.urgent ? "text-red-600" : "text-muted-foreground"}`}>
                    <Calendar size={10} />
                    {due.text}
                  </span>
                )}
              </div>

              {task.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</p>
              )}

              <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px] text-muted-foreground">
                {task.assigneeName && (
                  <span className="flex items-center gap-1">
                    <User size={10} />
                    {task.assigneeName}
                  </span>
                )}
                {!task.assigneeName && (
                  <span className="flex items-center gap-1 italic">
                    <User size={10} />
                    Unassigned
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Tag size={10} />
                  Created by {task.creatorName ?? "Admin"}
                </span>
                {task.linkedType !== "none" && task.linkedId && (
                  <Link href={task.linkedType === "booking" ? `/bookings/${task.linkedId}` : `/${task.linkedType}s`}>
                    <span className="flex items-center gap-1 text-[#70FFE8] hover:underline cursor-pointer">
                      <Link2 size={10} />
                      {LINKED_TYPE_LABELS[task.linkedType as LinkedType]} #{task.linkedId}
                    </span>
                  </Link>
                )}
                <span>{format(new Date(task.createdAt), "dd MMM yyyy")}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded((v) => !v)}
                title="Comments"
              >
                <MessageSquare size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setEditOpen(true)}
                title="Edit"
              >
                <Edit3 size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                onClick={() => {
                  if (confirm("Delete this task?")) deleteTask.mutate({ id: task.id });
                }}
                title="Delete"
              >
                <Trash2 size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </Button>
            </div>
          </div>

          {/* Expanded comments section */}
          {expanded && (
            <div className="mt-3 pl-7 border-t pt-3 space-y-3">
              {comments.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No comments yet.</p>
              )}
              {comments.map((c: any) => (
                <div key={c.id} className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-[10px] font-bold uppercase">
                    {(c.authorName ?? "A")[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold">{c.authorName ?? "Admin"}</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(c.createdAt), "dd MMM, HH:mm")}</span>
                      {task.linkedType === "booking" && task.linkedId && (
                        <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                          <Link2 size={9} /> mirrored to booking
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap">{c.content}</p>
                  </div>
                </div>
              ))}

              {/* Add comment */}
              <div className="flex gap-2 pt-1">
                <Textarea
                  placeholder="Add a comment…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSendComment();
                  }}
                />
                <Button
                  size="sm"
                  className="self-end h-8 px-3"
                  onClick={handleSendComment}
                  disabled={!comment.trim() || addComment.isPending}
                >
                  {addComment.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                </Button>
              </div>
              {task.linkedType === "booking" && task.linkedId && (
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <AlertCircle size={9} />
                  Comments on this task are automatically mirrored as internal notes on Booking #{task.linkedId}.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {editOpen && (
        <TaskFormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={onRefresh}
          adminUsers={adminUsers}
          initial={{
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            assigneeId: task.assigneeId,
            dueDate: task.dueDate,
            linkedType: task.linkedType,
            linkedId: task.linkedId,
          }}
        />
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminTasks() {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | TaskStatus>("all");
  const [filterAssignee, setFilterAssignee] = useState<"all" | "mine">("all");
  const [filterPriority, setFilterPriority] = useState<"all" | TaskPriority>("all");
  const [search, setSearch] = useState("");

  const { data: tasks = [], isLoading, refetch } = trpc.tasks.list.useQuery();
  const { data: adminUsers = [] } = trpc.users.listAdmins.useQuery();

  const filtered = useMemo(() => {
    let list = tasks as any[];
    if (filterStatus !== "all") list = list.filter((t) => t.status === filterStatus);
    if (filterAssignee === "mine") list = list.filter((t) => t.assigneeId === user?.id);
    if (filterPriority !== "all") list = list.filter((t) => t.priority === filterPriority);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        (t.assigneeName ?? "").toLowerCase().includes(q)
      );
    }
    // Sort: urgent first, then by due date, then by created
    list = [...list].sort((a, b) => {
      const pOrder: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      if (a.status === "done" && b.status !== "done") return 1;
      if (b.status === "done" && a.status !== "done") return -1;
      if (pOrder[a.priority as TaskPriority] !== pOrder[b.priority as TaskPriority]) {
        return pOrder[a.priority as TaskPriority] - pOrder[b.priority as TaskPriority];
      }
      if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return list;
  }, [tasks, filterStatus, filterAssignee, filterPriority, search, user?.id]);

  const openCount = (tasks as any[]).filter((t) => t.status !== "done").length;
  const myCount = (tasks as any[]).filter((t) => t.assigneeId === user?.id && t.status !== "done").length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CheckSquare size={20} className="text-[#70FFE8]" />
            Admin Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading ? "Loading…" : `${openCount} open task${openCount !== 1 ? "s" : ""}${myCount > 0 ? ` · ${myCount} assigned to you` : ""}`}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 flex-shrink-0" size="sm">
          <Plus size={14} />
          New task
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <Input
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 max-w-xs"
        />
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
          <SelectTrigger className="h-9 w-36">
            <Filter size={12} className="mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={(v) => setFilterPriority(v as any)}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="All priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={filterAssignee === "mine" ? "default" : "outline"}
          size="sm"
          className={`h-9 gap-1.5 ${filterAssignee === "mine" ? "bg-[#70FFE8] text-[#1a1a2e] hover:bg-[#5ae0d0] border-[#70FFE8]" : ""}`}
          onClick={() => setFilterAssignee((v) => v === "mine" ? "all" : "mine")}
        >
          <User size={13} />
          My tasks
        </Button>
        {filtered.length > 0 && (
          <span className="text-sm text-muted-foreground ml-auto">
            {filtered.length} task{filtered.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" size={28} style={{ color: "#70FFE8" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {search || filterStatus !== "all" || filterAssignee !== "all" || filterPriority !== "all"
            ? "No tasks match your filters."
            : "No tasks yet. Create one to get started."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              adminUsers={adminUsers as any[]}
              onRefresh={refetch}
              currentUserId={user?.id ?? 0}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      {createOpen && (
        <TaskFormDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={refetch}
          adminUsers={adminUsers as any[]}
        />
      )}
    </div>
  );
}
