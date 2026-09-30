import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { format, isPast, isToday, isTomorrow } from "date-fns";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock,
  Edit3,
  Filter,
  Flag,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Square,
  Tag,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import TaskFormDialog from "./TaskFormDialog";
import { resolveEquivalentTaskOwnerIds } from "@shared/task-identity";

type TaskStatus = "open" | "in_progress" | "done";
type TaskPriority = "low" | "medium" | "high" | "urgent";
type LinkedType = "booking" | "amendment" | "refund" | "cancellation" | "none";
type TaskView = "focus" | "team" | "done";
type FocusFilter = "all" | "unacknowledged" | "due_today" | "overdue";
type OwnerFilter = "all" | "mine" | "unassigned" | `user:${number}`;

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  open: { label: "Unacknowledged", color: "border-amber-200 bg-amber-50 text-amber-800" },
  in_progress: { label: "In progress", color: "border-sky-200 bg-sky-50 text-sky-800" },
  done: { label: "Completed", color: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  low: { label: "Low", color: "border-slate-200 bg-slate-50 text-slate-600" },
  medium: { label: "Medium", color: "border-amber-200 bg-amber-50 text-amber-700" },
  high: { label: "High", color: "border-orange-200 bg-orange-50 text-orange-700" },
  urgent: { label: "Urgent", color: "border-rose-200 bg-rose-50 text-rose-700" },
};

const LINKED_TYPE_LABELS: Record<LinkedType, string> = {
  booking: "Booking",
  amendment: "Amendment",
  refund: "Refund",
  cancellation: "Cancellation",
  none: "None",
};

function dueDateLabel(dueDate: Date | null | undefined): { text: string; tone: "urgent" | "today" | "neutral" } | null {
  if (!dueDate) return null;
  const date = new Date(dueDate);
  if (isToday(date)) return { text: "Due today", tone: "today" };
  if (isTomorrow(date)) return { text: "Due tomorrow", tone: "neutral" };
  if (isPast(date)) return { text: `Overdue · ${format(date, "dd MMM")}`, tone: "urgent" };
  return { text: `Due ${format(date, "dd MMM")}`, tone: "neutral" };
}

function isOverdue(task: any) {
  return task.status !== "done" && !!task.dueDate && isPast(new Date(task.dueDate)) && !isToday(new Date(task.dueDate));
}

function isDueToday(task: any) {
  return task.status !== "done" && !!task.dueDate && isToday(new Date(task.dueDate));
}

function taskSort(a: any, b: any) {
  const priorityOrder: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1;
  if (a.status !== b.status) return a.status === "open" ? -1 : 1;
  if (priorityOrder[a.priority as TaskPriority] !== priorityOrder[b.priority as TaskPriority]) {
    return priorityOrder[a.priority as TaskPriority] - priorityOrder[b.priority as TaskPriority];
  }
  if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function WorkMetric({
  label,
  value,
  detail,
  tone = "slate",
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "slate" | "amber" | "sky" | "rose" | "emerald";
  icon: React.ElementType;
  active?: boolean;
  onClick: () => void;
}) {
  const styles = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm ${styles} ${active ? "ring-2 ring-offset-2 ring-[#70FFE8]" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="mt-1 text-sm font-semibold">{label}</p>
        </div>
        <Icon size={18} className="opacity-80 transition-transform group-hover:scale-110" />
      </div>
      <p className="mt-2 text-xs opacity-75">{detail}</p>
    </button>
  );
}

function TaskSection({
  title,
  description,
  tasks,
  emptyMessage,
  adminUsers,
  currentUserIds,
  onRefresh,
  openTaskId,
}: {
  title: string;
  description: string;
  tasks: any[];
  emptyMessage: string;
  adminUsers: { id: number; name: string }[];
  currentUserIds: number[];
  onRefresh: () => void;
  openTaskId?: number | null;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </Badge>
      </div>
      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-5 py-6 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              adminUsers={adminUsers}
              currentUserIds={currentUserIds}
              onRefresh={onRefresh}
              autoExpand={task.id === openTaskId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskCard({
  task,
  adminUsers,
  currentUserIds,
  onRefresh,
  autoExpand = false,
}: {
  task: any;
  adminUsers: { id: number; name: string }[];
  currentUserIds: number[];
  onRefresh: () => void;
  autoExpand?: boolean;
}) {
  const [expanded, setExpanded] = useState(autoExpand);
  const [comment, setComment] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);
  const { data: comments = [], refetch: refetchComments } = trpc.tasks.getComments.useQuery(
    { taskId: task.id },
    { enabled: expanded },
  );

  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: (_result, input) => {
      const feedback = input.status === "in_progress"
        ? "Task acknowledged and moved to In Progress"
        : input.status === "done"
        ? "Task marked complete"
        : "Task reopened";
      toast.success(feedback);
      onRefresh();
    },
    onError: (err) => toast.error(err.message || "Failed to update task"),
  });
  const deleteTask = trpc.tasks.delete.useMutation({
    onSuccess: () => { toast.success("Task deleted"); onRefresh(); },
    onError: (err) => toast.error(err.message || "Failed to delete task"),
  });
  const addComment = trpc.tasks.addComment.useMutation({
    onSuccess: () => { setComment(""); refetchComments(); toast.success("Update added"); },
    onError: (err) => toast.error(err.message || "Failed to add update"),
  });

  const due = dueDateLabel(task.dueDate);
  const status = task.status as TaskStatus;
  const priority = task.priority as TaskPriority;
  const isMine = currentUserIds.includes(task.assigneeId);
  const isAtRisk = isOverdue(task) || priority === "urgent";
  const bookingLabel = task.linkedBookingClientName ?? (task.linkedId ? `Booking #${task.linkedId}` : null);
  const lastActivity = task.completedAt ?? task.acknowledgedAt ?? task.updatedAt ?? task.createdAt;

  function handleSendComment() {
    if (!comment.trim()) return;
    addComment.mutate({ taskId: task.id, content: comment.trim() });
  }

  return (
    <>
      <Card id={`task-${task.id}`} className={`overflow-hidden border transition-shadow hover:shadow-md ${isAtRisk ? "border-rose-200" : isMine && status !== "done" ? "border-[#70FFE8]/70" : "border-border"}`}>
        <CardContent className="p-0">
          <div className={`h-1 ${status === "done" ? "bg-emerald-400" : isAtRisk ? "bg-rose-400" : status === "in_progress" ? "bg-sky-400" : "bg-amber-400"}`} />
          <div className="p-4 sm:p-5">
            <div className="flex gap-3">
              <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${status === "done" ? "bg-emerald-50 text-emerald-600" : status === "in_progress" ? "bg-sky-50 text-sky-600" : "bg-amber-50 text-amber-700"}`}>
                {status === "done" ? <CheckCircle2 size={19} /> : status === "in_progress" ? <Clock size={19} /> : <Square size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start gap-2">
                  <h3 className={`text-[15px] font-bold leading-6 ${status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}>{task.title}</h3>
                  <Badge variant="outline" className={`text-[10px] ${PRIORITY_CONFIG[priority].color}`}>
                    <Flag size={10} className="mr-1" />{PRIORITY_CONFIG[priority].label}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${STATUS_CONFIG[status].color}`}>
                    {STATUS_CONFIG[status].label}
                  </Badge>
                  {task.recurrenceRule && task.recurrenceRule !== "none" && (
                    <Badge variant="outline" className="border-violet-200 bg-violet-50 text-[10px] text-violet-700">
                      <RefreshCw size={10} className="mr-1" />Repeats {task.recurrenceRule}
                    </Badge>
                  )}
                  {task.createdFrom === "booking_mention" && (
                    <Badge variant="outline" className="border-violet-200 bg-violet-50 text-[10px] text-violet-700">
                      <MessageSquare size={10} className="mr-1" />From booking note
                    </Badge>
                  )}
                </div>
                {task.description && (
                  <p className="mt-1.5 max-w-4xl whitespace-pre-line text-sm leading-5 text-muted-foreground">{task.description}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                  <span className={`inline-flex items-center gap-1 ${isMine ? "font-semibold text-foreground" : ""}`}><User size={12} />{task.assigneeName ?? "Unassigned"}{isMine ? " · You" : ""}</span>
                  {due && <span className={`inline-flex items-center gap-1 font-medium ${due.tone === "urgent" ? "text-rose-700" : due.tone === "today" ? "text-amber-800" : ""}`}><Calendar size={12} />{due.text}</span>}
                  {bookingLabel && task.linkedType === "booking" && task.linkedId && (
                    <Link href={`/bookings/${task.linkedId}`} className="inline-flex items-center gap-1 font-medium text-[#168c7a] hover:underline">
                      <Link2 size={12} />{bookingLabel}
                    </Link>
                  )}
                  {task.linkedType !== "booking" && task.linkedType !== "none" && task.linkedId && (
                    <span className="inline-flex items-center gap-1"><Link2 size={12} />{LINKED_TYPE_LABELS[task.linkedType as LinkedType]} #{task.linkedId}</span>
                  )}
                  <span className="inline-flex items-center gap-1"><Clock size={12} />Updated {format(new Date(lastActivity), "dd MMM, HH:mm")}</span>
                </div>
                {(task.acknowledgedAt || task.completedAt) && (
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    {task.acknowledgedAt && <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-800">Acknowledged by {task.acknowledgedByName ?? "Admin"} · {format(new Date(task.acknowledgedAt), "dd MMM, HH:mm")}</span>}
                    {task.completedAt && <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-800">Completed by {task.completedByName ?? "Admin"} · {format(new Date(task.completedAt), "dd MMM, HH:mm")}</span>}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-2">
                {status === "open" && (
                  <Button size="sm" className="gap-1.5 bg-[#168c7a] text-white hover:bg-[#116f61]" onClick={() => updateTask.mutate({ id: task.id, status: "in_progress" })} disabled={updateTask.isPending}>
                    {updateTask.isPending ? <Loader2 size={13} className="animate-spin" /> : <CircleDot size={13} />}Acknowledge & start
                  </Button>
                )}
                {status === "in_progress" && (
                  <Button size="sm" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => updateTask.mutate({ id: task.id, status: "done" })} disabled={updateTask.isPending}>
                    {updateTask.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckSquare size={13} />}Mark complete
                  </Button>
                )}
                {status === "done" && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => updateTask.mutate({ id: task.id, status: "open" })} disabled={updateTask.isPending}>
                    <Square size={13} />Reopen
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-muted-foreground" onClick={() => setExpanded((value) => !value)}>
                  <MessageSquare size={13} />{(comments as any[]).length > 0 ? `${(comments as any[]).length} updates` : "Add update"}
                  {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setEditOpen(true)} title="Edit task"><Edit3 size={14} /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-rose-600" onClick={() => { if (confirm("Delete this task?")) deleteTask.mutate({ id: task.id }); }} title="Delete task"><Trash2 size={14} /></Button>
              </div>
            </div>

            {expanded && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="space-y-3">
                  {(comments as any[]).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No updates yet. Add a note so the next person can see what has happened.</p>
                  ) : (
                    (comments as any[]).map((entry) => (
                      <div key={entry.id} className="flex gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{(entry.authorName ?? "A")[0]}</div>
                        <div className="min-w-0 flex-1 rounded-xl bg-muted/50 px-3 py-2">
                          <p className="text-xs font-semibold">{entry.authorName ?? "Admin"} <span className="font-normal text-muted-foreground">· {format(new Date(entry.createdAt), "dd MMM, HH:mm")}</span></p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{entry.content}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-4 flex gap-2">
                  <Textarea
                    placeholder="Add a useful progress update…"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    rows={2}
                    className="resize-none text-sm"
                    onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) handleSendComment(); }}
                  />
                  <Button size="sm" className="self-end gap-1.5" onClick={handleSendComment} disabled={!comment.trim() || addComment.isPending}>
                    {addComment.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}Post
                  </Button>
                </div>
                {task.linkedType === "booking" && task.linkedId && <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"><AlertCircle size={11} />This update is also added to the booking’s internal notes.</p>}
              </div>
            )}
          </div>
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
            recurrenceRule: task.recurrenceRule,
            recurrenceInterval: task.recurrenceInterval,
            linkedType: task.linkedType,
            linkedId: task.linkedId,
            linkedBookingLabel: task.linkedBookingClientName ?? undefined,
          }}
        />
      )}
    </>
  );
}

export default function AdminTasks() {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<TaskView>("focus");
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | TaskPriority>("all");
  const [search, setSearch] = useState("");
  const [openTaskId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const value = Number(new URLSearchParams(window.location.search).get("task"));
    return Number.isInteger(value) && value > 0 ? value : null;
  });

  const taskList = trpc.tasks.list.useQuery(undefined, { retry: 2 });
  const { data: tasks = [], isLoading, isError: taskListError, error: taskListFailure, refetch } = taskList;
  const { data: adminUsers = [] } = trpc.users.listAdmins.useQuery();
  const allTasks = tasks as any[];
  const currentUserIds = useMemo(
    () => resolveEquivalentTaskOwnerIds(user, adminUsers as { id: number; email?: string | null; identityUserIds?: number[] }[]),
    [user, adminUsers],
  );
  const currentUserId = user?.id ?? 0;

  const stats = useMemo(() => {
    const active = allTasks.filter((task) => task.status !== "done");
    const mine = active.filter((task) => currentUserIds.includes(task.assigneeId));
    return {
      active: active.length,
      mine: mine.length,
      unacknowledged: mine.filter((task) => task.status === "open").length,
      inProgress: mine.filter((task) => task.status === "in_progress").length,
      dueToday: mine.filter(isDueToday).length,
      overdue: active.filter(isOverdue).length,
      completed: allTasks.filter((task) => task.status === "done").length,
    };
  }, [allTasks, currentUserIds]);

  const visibleTasks = useMemo(() => {
    let list = [...allTasks];
    if (view === "focus") list = list.filter((task) => currentUserIds.includes(task.assigneeId) && task.status !== "done");
    if (view === "team") list = list.filter((task) => task.status !== "done");
    if (view === "done") list = list.filter((task) => task.status === "done");

    if (view !== "focus") {
      if (ownerFilter === "mine") list = list.filter((task) => currentUserIds.includes(task.assigneeId));
      if (ownerFilter === "unassigned") list = list.filter((task) => !task.assigneeId);
      if (ownerFilter.startsWith("user:")) list = list.filter((task) => task.assigneeId === Number(ownerFilter.slice(5)));
    }
    if (priorityFilter !== "all") list = list.filter((task) => task.priority === priorityFilter);
    if (focusFilter === "unacknowledged") list = list.filter((task) => task.status === "open");
    if (focusFilter === "due_today") list = list.filter(isDueToday);
    if (focusFilter === "overdue") list = list.filter(isOverdue);
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      list = list.filter((task) =>
        task.title.toLowerCase().includes(query)
        || (task.description ?? "").toLowerCase().includes(query)
        || (task.assigneeName ?? "").toLowerCase().includes(query)
        || (task.linkedBookingClientName ?? "").toLowerCase().includes(query),
      );
    }
    return list.sort(taskSort);
  }, [allTasks, currentUserIds, focusFilter, ownerFilter, priorityFilter, search, view]);

  const immediateTasks = visibleTasks.filter((task) => task.status === "open" || isOverdue(task) || isDueToday(task));
  const plannedTasks = visibleTasks.filter((task) => !immediateTasks.some((immediate) => immediate.id === task.id));
  const isFiltered = search.trim() || priorityFilter !== "all" || ownerFilter !== "all" || focusFilter !== "all";

  function switchView(next: TaskView) {
    setView(next);
    setFocusFilter("all");
    setOwnerFilter("all");
  }

  function applyFocusFilter(filter: FocusFilter, targetView: TaskView = "focus") {
    setView(targetView);
    setFocusFilter(filter);
  }

  const hasPersonalTasks = stats.mine > 0;
  const shouldShowTeamFallback = view === "focus" && !isLoading && !taskListError && !hasPersonalTasks && stats.active > 0;

  useEffect(() => {
    if (!openTaskId) return;
    setView("team");
    setFocusFilter("all");
    setOwnerFilter("all");
    setSearch("");
  }, [openTaskId]);

  useEffect(() => {
    if (!openTaskId || isLoading) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`task-${openTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isLoading, openTaskId, visibleTasks]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-emerald-50/70 p-5 shadow-sm sm:p-7">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#168c7a]"><CheckSquare size={17} />Task workbench</div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Make the next action obvious.</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Start with your priorities, acknowledge work that needs your attention, and leave a useful update before handing anything on.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/dashboard"><Button variant="outline" size="icon" className="h-9 w-9" title="Back to dashboard"><ArrowLeft size={16} /></Button></Link>
            <Button onClick={() => setCreateOpen(true)} className="h-9 gap-2 bg-[#168c7a] text-white hover:bg-[#116f61]"><Plus size={15} />New task</Button>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <WorkMetric label="Needs your acknowledgement" value={stats.unacknowledged} detail="Start these first so the team knows you own them." tone="amber" icon={Square} active={view === "focus" && focusFilter === "unacknowledged"} onClick={() => applyFocusFilter("unacknowledged")} />
          <WorkMetric label="Your work in progress" value={stats.inProgress} detail="Keep these moving with a short update when needed." tone="sky" icon={Clock} active={view === "focus" && focusFilter === "all"} onClick={() => applyFocusFilter("all")} />
          <WorkMetric label="Due today" value={stats.dueToday} detail="Prioritise these before the day gets away from you." tone="emerald" icon={Calendar} active={view === "focus" && focusFilter === "due_today"} onClick={() => applyFocusFilter("due_today")} />
          <WorkMetric label="Team tasks overdue" value={stats.overdue} detail="A shared risk view so important work does not drift." tone="rose" icon={AlertCircle} active={view === "team" && focusFilter === "overdue"} onClick={() => applyFocusFilter("overdue", "team")} />
        </div>
      </header>

      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Task views">
          {([
            ["focus", "My focus", stats.mine, User],
            ["team", "Team queue", stats.active, Users],
            ["done", "Completed", stats.completed, CheckCircle2],
          ] as const).map(([value, label, count, Icon]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={view === value ? "default" : "outline"}
              className={`gap-1.5 ${view === value ? "bg-slate-900 text-white hover:bg-slate-800" : ""}`}
              onClick={() => switchView(value)}
            >
              <Icon size={14} />{label}<span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] ${view === value ? "bg-white/20" : "bg-muted"}`}>{count}</span>
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{view === "focus" ? "Your personal daily queue" : view === "team" ? "Every active task across the team" : "Recently completed work"}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:p-4">
        <Input placeholder="Search a task, colleague or booking…" value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 flex-1" />
        <div className="flex flex-wrap gap-2">
          {view !== "focus" && (
            <Select value={ownerFilter} onValueChange={(value) => setOwnerFilter(value as OwnerFilter)}>
              <SelectTrigger className="h-9 w-36"><User size={13} className="mr-1.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignees</SelectItem>
                <SelectItem value="mine">Assigned to me</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {(adminUsers as { id: number; name: string }[]).map((admin) => (
                  <SelectItem key={admin.id} value={`user:${admin.id}`}>{admin.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={priorityFilter} onValueChange={(value) => setPriorityFilter(value as "all" | TaskPriority)}>
            <SelectTrigger className="h-9 w-36"><Filter size={13} className="mr-1.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          {isFiltered && <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => { setSearch(""); setPriorityFilter("all"); setOwnerFilter("all"); setFocusFilter("all"); }}>Clear filters</Button>}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-[#168c7a]" size={28} /></div>
      ) : taskListError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-rose-600" />
          <h2 className="mt-3 font-bold text-rose-950">Tasks could not be loaded</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-rose-800">The task list has not been treated as empty. Please retry; if this continues, tell Support the time it occurred so the exact request can be traced.</p>
          <Button className="mt-4" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
          {import.meta.env.DEV && taskListFailure?.message && <p className="mt-3 text-xs text-rose-700">{taskListFailure.message}</p>}
        </div>
      ) : view === "done" ? (
        <TaskSection title="Completed work" description="Completed tasks stay here as a useful record. Reopen only when work genuinely needs to resume." tasks={visibleTasks} emptyMessage="No completed tasks match this view." adminUsers={adminUsers as any[]} currentUserIds={currentUserIds} onRefresh={refetch} openTaskId={openTaskId} />
      ) : isFiltered && focusFilter !== "all" ? (
        <TaskSection title={focusFilter === "unacknowledged" ? "Tasks waiting for acknowledgement" : focusFilter === "due_today" ? "Tasks due today" : "Overdue tasks"} description="Filtered from the current work view." tasks={visibleTasks} emptyMessage="Nothing matches this focused view." adminUsers={adminUsers as any[]} currentUserIds={currentUserIds} onRefresh={refetch} openTaskId={openTaskId} />
      ) : shouldShowTeamFallback ? (
        <div className="space-y-8">
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-950">
            <p className="font-semibold">No tasks are assigned to you yet.</p>
            <p className="mt-1 text-sky-800">Showing the active team queue instead, so work is still visible and nothing is missed. Use <strong>New task</strong> to add one for yourself.</p>
          </div>
          <TaskSection title="Team work needing attention" description="Unacknowledged, overdue, or due-today tasks across the team." tasks={allTasks.filter((task) => task.status !== "done" && (task.status === "open" || isOverdue(task) || isDueToday(task))).sort(taskSort)} emptyMessage="No team tasks need immediate attention." adminUsers={adminUsers as any[]} currentUserIds={currentUserIds} onRefresh={refetch} openTaskId={openTaskId} />
          <TaskSection title="Everything else in the team queue" description="Active work that is currently on track." tasks={allTasks.filter((task) => task.status !== "done" && task.status !== "open" && !isOverdue(task) && !isDueToday(task)).sort(taskSort)} emptyMessage="The active team queue is clear." adminUsers={adminUsers as any[]} currentUserIds={currentUserIds} onRefresh={refetch} openTaskId={openTaskId} />
        </div>
      ) : (
        <div className="space-y-8">
          <TaskSection title={view === "focus" ? "Act on these first" : "Needs attention"} description={view === "focus" ? "Acknowledge new requests, deal with overdue work, and protect today’s deadlines." : "Unacknowledged, overdue, or due today across the team."} tasks={immediateTasks} emptyMessage={view === "focus" ? "You are clear on urgent work. Check your planned work below or help the team queue." : "No team tasks need immediate attention."} adminUsers={adminUsers as any[]} currentUserIds={currentUserIds} onRefresh={refetch} openTaskId={openTaskId} />
          <TaskSection title={view === "focus" ? "Your planned work" : "Everything else in the queue"} description={view === "focus" ? "Use these to plan the rest of your day and add an update whenever circumstances change." : "Active work that is currently on track."} tasks={plannedTasks} emptyMessage={view === "focus" ? "No further tasks are assigned to you." : "The active team queue is clear."} adminUsers={adminUsers as any[]} currentUserIds={currentUserIds} onRefresh={refetch} openTaskId={openTaskId} />
        </div>
      )}

      {createOpen && <TaskFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={refetch} adminUsers={adminUsers as any[]} defaultAssigneeId={currentUserId} />}
    </div>
  );
}
