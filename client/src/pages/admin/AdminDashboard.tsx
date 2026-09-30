import { useMemo, useState } from "react";
import { Link } from "wouter";
import { format, formatDistanceToNowStrict, differenceInCalendarDays, isToday, isPast } from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  CircleAlert,
  Clock3,
  CreditCard,
  FileCheck2,
  FileText,
  Flame,
  Gift,
  Landmark,
  ListChecks,
  MessageSquare,
  PencilLine,
  Plus,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import TaskFormDialog from "./TaskFormDialog";

type TaskPriority = "low" | "medium" | "high" | "urgent";

const PRIORITY_STYLES: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-slate-100 text-slate-600" },
  medium: { label: "Medium", className: "bg-blue-50 text-blue-700" },
  high: { label: "High", className: "bg-amber-100 text-amber-800" },
  urgent: { label: "Urgent", className: "bg-red-100 text-red-700" },
};

const EVENT_STYLES: Record<string, { label: string; className: string }> = {
  holiday: { label: "Away", className: "bg-[#FFC3BC] text-[#414141]" },
  event: { label: "Event", className: "bg-[#70FFE8] text-[#414141]" },
  task: { label: "Calendar task", className: "bg-amber-100 text-amber-800" },
  rota: { label: "Rota", className: "bg-violet-100 text-violet-800" },
};

const CONTROL_TILES = [
  {
    key: "ptsMissing",
    title: "PTS files missing payment date",
    detail: "Open PTS-stage bookings without a Final Supplier Payment Date.",
    href: "/pts-missing-payment",
    icon: Landmark,
    tone: "amber",
  },
  {
    key: "claimableMissing",
    title: "Claimable files missing payment date",
    detail: "Commission Claimable bookings without a Final Supplier Payment Date.",
    href: "/commission-claimable-missing-payment",
    icon: FileCheck2,
    tone: "blue",
  },
  {
    key: "missedMandates",
    title: "Mandate without Direct Debit",
    detail: "Agents with an active GoCardless mandate but no subscription.",
    href: "/crm/agents",
    icon: CreditCard,
    tone: "rose",
  },
] as const;

function daysLabel(value: number) {
  if (value <= 0) return "today";
  return `${value}d`;
}

function dueLabel(dueDate: Date | string | null | undefined) {
  if (!dueDate) return "No due date";
  const date = new Date(dueDate);
  const days = differenceInCalendarDays(date, new Date());
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days}d`;
}

function taskTone(task: any) {
  if (task.dueDate && isPast(new Date(task.dueDate)) && !isToday(new Date(task.dueDate))) {
    return "border-red-200 bg-red-50/60";
  }
  if (!task.acknowledgedAt || (task.dueDate && isToday(new Date(task.dueDate)))) {
    return "border-amber-200 bg-amber-50/60";
  }
  return "border-border bg-card";
}

function SectionHeader({
  icon: Icon,
  title,
  count,
  href,
  actionLabel = "View all",
  accent = "#02E6D2",
}: {
  icon: React.ElementType;
  title: string;
  count?: number;
  href?: string;
  actionLabel?: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accent}24`, color: accent }}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-bold leading-tight">{title}</h2>
        {typeof count === "number" && (
          <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{count === 1 ? "1 item" : `${count} items`}</p>
        )}
      </div>
      {href && (
        <Link href={href} className="ml-auto">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
            {actionLabel} <ArrowRight size={12} />
          </Button>
        </Link>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 text-muted-foreground">
      <Icon size={22} className="opacity-30 mb-2" />
      <p className="text-xs font-medium">{message}</p>
    </div>
  );
}

function TaskRow({
  task,
  onStart,
  onDone,
}: {
  task: any;
  onStart: (id: number) => void;
  onDone: (id: number) => void;
}) {
  const priority = PRIORITY_STYLES[(task.priority as TaskPriority) ?? "medium"] ?? PRIORITY_STYLES.medium;
  const dueIsOverdue = task.dueDate && isPast(new Date(task.dueDate)) && !isToday(new Date(task.dueDate));
  const taskHref = task.linkedType === "booking" && task.linkedId ? `/bookings/${task.linkedId}` : "/admin/tasks";

  return (
    <div className={`rounded-xl border p-3 transition-colors ${taskTone(task)}`}>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={() => onDone(task.id)}
          className="mt-0.5 w-5 h-5 rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center transition-colors"
          aria-label={`Mark ${task.title} complete`}
          title="Mark complete"
        >
          <CheckCircle2 size={12} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-semibold leading-tight break-words">{task.title}</p>
            <Badge className={`h-4 rounded-full px-1.5 text-[9px] border-0 ${priority.className}`}>{priority.label}</Badge>
            {task.createdFrom === "booking_mention" && (
              <Badge className="h-4 rounded-full px-1.5 text-[9px] bg-violet-100 text-violet-700 border-0">Booking mention</Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-x-2 gap-y-1 flex-wrap text-[10px] text-muted-foreground">
            <span className={dueIsOverdue ? "font-semibold text-red-700" : task.dueDate && isToday(new Date(task.dueDate)) ? "font-semibold text-amber-800" : ""}>
              {dueLabel(task.dueDate)}
            </span>
            {task.assigneeName && <span>· {task.assigneeName}</span>}
            {task.linkedBookingClientName && <span className="text-[#0f766e]">· {task.linkedBookingClientName}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!task.acknowledgedAt && task.status === "open" && (
            <button
              type="button"
              onClick={() => onStart(task.id)}
              className="text-[10px] font-semibold px-1.5 py-1 rounded border border-amber-200 text-amber-800 hover:bg-amber-100"
              title="Acknowledge and start this task"
            >
              Start
            </button>
          )}
          <Link href={taskHref} className="p-1 text-muted-foreground hover:text-foreground" title="Open task or booking">
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function LoadingWorkboard() {
  return (
    <div className="p-1 space-y-5 animate-pulse">
      <div className="h-16 rounded-2xl bg-muted" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 h-80 rounded-2xl bg-muted" />
        <div className="h-80 rounded-2xl bg-muted" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {[1, 2, 3].map((key) => <div key={key} className="h-48 rounded-2xl bg-muted" />)}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { data: workboard, isLoading, isError } = trpc.dashboard.workboard.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const utils = trpc.useUtils();
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: () => {
      utils.dashboard.workboard.invalidate();
      utils.tasks.list.invalidate();
    },
  });

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const myTasks = (workboard?.myTasks ?? []) as any[];
  const teamTasks = (workboard?.teamTasks ?? []) as any[];
  const unreadMessages = (workboard?.unreadMessages ?? []) as any[];
  const controls = workboard?.controls as any;
  const queues = (workboard?.queues ?? []) as any[];
  const pipelineHealth = (workboard?.pipelineHealth ?? []) as any[];
  const membershipWatch = (workboard?.membership?.watch ?? []) as any[];
  const changeRequests = (workboard?.changeRequests?.records ?? []) as any[];
  const agentWins = (workboard?.agentWins ?? []) as any[];
  const todayEvents = (workboard?.today?.events ?? []) as any[];
  const todayAway = (workboard?.today?.away ?? []) as any[];
  const adminUsers = (workboard?.adminUsers ?? []) as { id: number; name: string }[];

  const taskAttentionCount = useMemo(() => {
    return myTasks.filter((task) => !task.acknowledgedAt || (task.dueDate && new Date(task.dueDate) <= now)).length;
  }, [myTasks, now]);

  if (isLoading) return <LoadingWorkboard />;

  if (isError || !workboard) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <CircleAlert className="mx-auto mb-2 opacity-40" />
        <p className="text-sm font-medium">The daily workboard could not be loaded.</p>
        <p className="text-xs mt-1">Please refresh or use the specialist portal pages while the data reconnects.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-1 pb-8">
      {/* Daily command header */}
      <section className="rounded-2xl border border-[#70FFE8]/60 bg-gradient-to-br from-[#ecfffb] via-card to-[#fffaf2] px-5 py-4 shadow-sm">
        <div className="flex flex-wrap gap-4 items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl flex items-center justify-center bg-[#70FFE8] text-[#414141]"><Sparkles size={16} /></span>
              <div>
                <h1 className="text-xl font-bold tracking-tight">{greeting} — your daily workboard</h1>
                <p className="text-xs text-muted-foreground mt-0.5">{format(now, "EEEE d MMMM yyyy")} · Clear what needs a response first.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs">
              <Link href="/admin/tasks" className="font-semibold hover:underline text-[#0f766e]">{taskAttentionCount} task{taskAttentionCount === 1 ? "" : "s"} need attention</Link>
              <Link href="/messages" className="font-semibold hover:underline text-[#7c3aed]">{workboard.unreadMessageCount} unread conversation{workboard.unreadMessageCount === 1 ? "" : "s"}</Link>
              <Link href="/admin/calendar" className="font-semibold hover:underline text-[#92400e]">{todayEvents.length} calendar item{todayEvents.length === 1 ? "" : "s"} today</Link>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/messages"><Button size="sm" variant="outline" className="gap-1.5 text-xs"><MessageSquare size={13} /> Messages</Button></Link>
            <Link href="/admin/calendar"><Button size="sm" variant="outline" className="gap-1.5 text-xs"><CalendarDays size={13} /> Calendar</Button></Link>
            <Button size="sm" className="gap-1.5 text-xs bg-[#02E6D2] text-[#414141] hover:bg-[#70FFE8]" onClick={() => setNewTaskOpen(true)}>
              <Plus size={14} /> New task
            </Button>
          </div>
        </div>
      </section>

      {/* Personal and team work */}
      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2 border-t-4 border-t-[#02E6D2]">
          <CardHeader className="pb-3 pt-4 px-4">
            <SectionHeader icon={ListChecks} title="My task focus" count={myTasks.length} href="/admin/tasks" accent="#0f766e" />
            <p className="text-[11px] text-muted-foreground mt-2">Overdue and unacknowledged tasks rise to the top. Start them to make ownership visible.</p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {myTasks.length === 0 ? <EmptyState icon={CheckCircle2} message="Your task list is clear — great work." /> : (
              <div className="grid gap-2 md:grid-cols-2">
                {myTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onStart={(id) => updateTask.mutate({ id, status: "in_progress" })}
                    onDone={(id) => updateTask.mutate({ id, status: "done" })}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-[#a78bfa]">
          <CardHeader className="pb-3 pt-4 px-4">
            <SectionHeader icon={Users} title="Team task board" count={teamTasks.length} href="/admin/tasks" accent="#7c3aed" />
            <p className="text-[11px] text-muted-foreground mt-2">Unassigned work and team tasks that are already overdue.</p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {teamTasks.length === 0 ? <EmptyState icon={CheckSquare} message="No unclaimed or overdue team tasks." /> : (
              <div className="space-y-2">
                {teamTasks.slice(0, 4).map((task) => (
                  <TaskRow key={task.id} task={task} onStart={(id) => updateTask.mutate({ id, status: "in_progress" })} onDone={(id) => updateTask.mutate({ id, status: "done" })} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Inbox zero and today */}
      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3 border-t-4 border-t-[#7c3aed]">
          <CardHeader className="pb-3 pt-4 px-4">
            <SectionHeader icon={MessageSquare} title="Message inbox zero" count={workboard.unreadMessageCount} href="/messages" accent="#7c3aed" />
            <p className="text-[11px] text-muted-foreground mt-2">Agent conversations still awaiting an admin response, shown oldest first.</p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {unreadMessages.length === 0 ? <EmptyState icon={CheckCircle2} message="Inbox zero — no agent replies waiting." /> : (
              <div className="space-y-2">
                {unreadMessages.map((message) => {
                  const waitingHours = Math.max(0, Math.round((Date.now() - new Date(message.latestMessageAt).getTime()) / 3_600_000));
                  const isAgeing = waitingHours >= 24;
                  return (
                    <Link key={`${message.bookingId}-${message.latestMessageAt}`} href={`/bookings/${message.bookingId}`}>
                      <div className={`group flex gap-3 rounded-xl border p-3 transition-colors cursor-pointer ${isAgeing ? "border-red-200 bg-red-50/50 hover:bg-red-50" : "border-[#d8c8f8] bg-violet-50/40 hover:bg-violet-50"}`}>
                        <div className={`mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${isAgeing ? "bg-red-100 text-red-700" : "bg-violet-100 text-violet-700"}`}><MessageSquare size={14} /></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            <p className="text-xs font-semibold">{message.clientName}</p>
                            <Badge className="h-4 px-1.5 text-[9px] bg-red-100 text-red-700 border-0">{message.unreadCount} unread</Badge>
                            {message.tag && <Badge className="h-4 px-1.5 text-[9px] bg-violet-100 text-violet-700 border-0">{message.tag}</Badge>}
                            <span className={`ml-auto text-[10px] font-medium ${isAgeing ? "text-red-700" : "text-muted-foreground"}`}>{formatDistanceToNowStrict(new Date(message.latestMessageAt), { addSuffix: true })}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{message.agentName ?? "Agent"} · {String(message.latestMessage).replace(/^\[System\]\s*/i, "")}</p>
                        </div>
                        <ChevronRight size={14} className="self-center text-muted-foreground group-hover:text-foreground" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-t-4 border-t-[#f6bc72]">
          <CardHeader className="pb-3 pt-4 px-4">
            <SectionHeader icon={CalendarDays} title="Today at JLT" count={todayEvents.length} href="/admin/calendar" accent="#d97706" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {todayEvents.length === 0 ? <EmptyState icon={CalendarDays} message="Nothing is scheduled for today." /> : (
              <div className="space-y-2">
                {todayEvents.map((event, index) => {
                  const eventStyle = EVENT_STYLES[event.type] ?? EVENT_STYLES.event;
                  return (
                    <div key={`${event.id}-${index}`} className="flex items-start gap-2.5 rounded-xl border bg-card p-2.5">
                      <Badge className={`mt-0.5 h-5 text-[9px] border-0 ${eventStyle.className}`}>{eventStyle.label}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">{event.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {event.allDay ? "All day" : format(new Date(event.startDate), "HH:mm")}{event.assigneeName ? ` · ${event.assigneeName}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {todayAway.length > 0 && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Away today</p>
                <div className="flex flex-wrap gap-1.5">
                  {todayAway.map((event, index) => <Badge key={`${event.id}-away-${index}`} className="bg-[#FFC3BC] text-[#414141] text-[10px] border-0">{event.assigneeName ?? event.title}</Badge>)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Requested controls only */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert size={16} className="text-[#b45309]" />
          <div>
            <h2 className="text-sm font-bold">Essential control checks</h2>
            <p className="text-[11px] text-muted-foreground">The three checks that protect payment and PTS processing.</p>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {CONTROL_TILES.map((tile) => {
            const control = controls?.[tile.key] ?? { count: 0, records: [] };
            const colorMap = tile.tone === "rose"
              ? { border: "border-rose-200", badge: "bg-rose-100 text-rose-700", icon: "bg-rose-100 text-rose-700" }
              : tile.tone === "blue"
                ? { border: "border-blue-200", badge: "bg-blue-100 text-blue-700", icon: "bg-blue-100 text-blue-700" }
                : { border: "border-amber-200", badge: "bg-amber-100 text-amber-800", icon: "bg-amber-100 text-amber-800" };
            const Icon = tile.icon;
            return (
              <Card key={tile.key} className={`${colorMap.border} overflow-hidden`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <span className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${colorMap.icon}`}><Icon size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex gap-2 items-start">
                        <p className="text-xs font-bold leading-tight flex-1">{tile.title}</p>
                        <Badge className={`h-5 px-1.5 text-[10px] border-0 ${colorMap.badge}`}>{control.count}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{tile.detail}</p>
                    </div>
                  </div>
                  {control.count === 0 ? (
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-700"><CheckCircle2 size={13} /> All clear</div>
                  ) : (
                    <div className="mt-3 pt-2.5 border-t space-y-1.5">
                      {(control.records as any[]).map((record) => (
                        <p key={record.id ?? record.userId} className="text-[11px] truncate text-muted-foreground">{record.clientName ?? record.userName} {record.currentStage ? <span className="text-[10px]">· {record.currentStage}</span> : ""}</p>
                      ))}
                      <Link href={tile.href} className="inline-flex items-center gap-1 pt-1 text-[11px] font-semibold hover:underline text-foreground">Resolve records <ArrowRight size={11} /></Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Queue health and stage age */}
      <section className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-3 pt-4 px-4">
            <SectionHeader icon={Clock3} title="Active queues" href="/pipeline" actionLabel="Open pipeline" accent="#b45309" />
            <p className="text-[11px] text-muted-foreground mt-2">Working target: under 3 days. Oldest age keeps individual items from slipping through.</p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {queues.map((queue) => (
                <Link key={queue.label} href={queue.href}>
                  <div className={`rounded-xl border p-3 transition-colors hover:bg-muted/40 cursor-pointer ${queue.overTargetCount > 0 ? "border-amber-200 bg-amber-50/40" : "bg-card"}`}>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold flex-1">{queue.label}</p>
                      <span className="text-lg leading-none font-bold">{queue.count}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Oldest {daysLabel(queue.oldestAgeDays)}</span>
                      <span className={queue.overTargetCount > 0 ? "font-semibold text-amber-800" : ""}>{queue.overTargetCount} over target</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader className="pb-3 pt-4 px-4">
            <SectionHeader icon={Flame} title="Pipeline stage health" href="/pipeline" actionLabel="Open Kanban" accent="#e11d48" />
            <p className="text-[11px] text-muted-foreground mt-2">A 3-day working target is shown transparently; use the oldest age to find stalled files.</p>
          </CardHeader>
          <CardContent className="px-4 pb-4 overflow-x-auto">
            {pipelineHealth.length === 0 ? <EmptyState icon={FileText} message="No active booking stages to show." /> : (
              <table className="w-full min-w-[620px] text-left">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                  <tr>
                    <th className="pb-2 font-semibold">Stage</th>
                    <th className="pb-2 pr-2 text-right font-semibold">Files</th>
                    <th className="pb-2 pr-2 text-right font-semibold">Avg age</th>
                    <th className="pb-2 pr-2 text-right font-semibold">Oldest</th>
                    <th className="pb-2 text-right font-semibold">Over 3d</th>
                  </tr>
                </thead>
                <tbody>
                  {pipelineHealth.slice(0, 9).map((stage) => (
                    <tr key={stage.stage} className="border-b last:border-0 text-xs">
                      <td className="py-2.5 font-medium">{stage.stage}</td>
                      <td className="py-2.5 pr-2 text-right tabular-nums">{stage.count}</td>
                      <td className="py-2.5 pr-2 text-right tabular-nums text-muted-foreground">{stage.averageAgeDays}d</td>
                      <td className={`py-2.5 pr-2 text-right tabular-nums ${stage.oldestAgeDays > stage.targetDays ? "font-semibold text-amber-800" : "text-muted-foreground"}`}>{stage.oldestAgeDays}d</td>
                      <td className={`py-2.5 text-right tabular-nums ${stage.overTargetCount > 0 ? "font-bold text-red-700" : "text-muted-foreground"}`}>{stage.overTargetCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Membership and change workflow */}
      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader className="pb-3 pt-4 px-4">
            <SectionHeader icon={Users} title="Membership dates to watch" count={membershipWatch.length} href="/crm/memberships" accent="#0f766e" />
            <div className="flex gap-2 mt-2 flex-wrap text-[10px]">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{workboard.membership.active} active</span>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{workboard.membership.paused} paused</span>
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700">{workboard.membership.inNotice} in notice</span>
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">{workboard.membership.suspended} suspended</span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {membershipWatch.length === 0 ? <EmptyState icon={CheckCircle2} message="No membership end dates need attention in the next 14 days." /> : (
              <div className="space-y-2">
                {membershipWatch.map((agent) => {
                  const days = differenceInCalendarDays(new Date(agent.endDate), new Date());
                  const overdue = days < 0;
                  return (
                    <Link key={agent.userId} href={`/crm/agents?agent=${agent.userId}`}>
                      <div className={`flex items-center gap-3 rounded-xl border p-3 transition-colors cursor-pointer hover:bg-muted/40 ${overdue ? "border-red-200 bg-red-50/50" : days <= 7 ? "border-amber-200 bg-amber-50/50" : "bg-card"}`}>
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${agent.agentStatus === "paused" ? "bg-amber-100 text-amber-800" : "bg-orange-100 text-orange-800"}`}><Users size={14} /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate">{agent.name}</p>
                          <p className="text-[10px] text-muted-foreground">{agent.agentStatus === "paused" ? "Pause ends" : "Notice ends"} · {format(new Date(agent.endDate), "d MMM yyyy")}</p>
                        </div>
                        <span className={`text-[11px] font-bold ${overdue ? "text-red-700" : days === 0 ? "text-amber-800" : "text-muted-foreground"}`}>{overdue ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`}</span>
                        <ChevronRight size={14} className="text-muted-foreground" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="pb-3 pt-4 px-4">
            <SectionHeader icon={PencilLine} title="Change requests" count={workboard.changeRequests.count} href="/crm/change-requests" actionLabel="Review" accent="#2563eb" />
            <p className="text-[11px] text-muted-foreground mt-2">Profile, contact and payment-detail changes awaiting review.</p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {changeRequests.length === 0 ? <EmptyState icon={CheckCircle2} message="No change requests are waiting." /> : (
              <div className="space-y-2">
                {changeRequests.map((request) => (
                  <Link key={request.id} href="/crm/change-requests">
                    <div className="flex items-center gap-2.5 rounded-xl border p-2.5 hover:bg-muted/40 transition-colors cursor-pointer">
                      <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center"><PencilLine size={13} /></span>
                      <div className="min-w-0 flex-1"><p className="text-xs font-semibold truncate">{request.agentName}</p><p className="text-[10px] text-muted-foreground truncate">{request.fieldLabel}</p></div>
                      <span className="text-[10px] text-muted-foreground">{formatDistanceToNowStrict(new Date(request.createdAt), { addSuffix: true })}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Agent Wins */}
      <section>
        <Card className="border-t-4 border-t-[#f6bc72]">
          <CardHeader className="pb-3 pt-4 px-4">
            <SectionHeader icon={Gift} title="Latest Agent Wins" count={agentWins.length} href="/community" actionLabel="Open Community" accent="#d97706" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {agentWins.length === 0 ? <EmptyState icon={Gift} message="No Agent Wins have been shared recently." /> : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                {agentWins.map((post) => (
                  <Link key={post.id} href="/community">
                    <div className="h-full rounded-xl border bg-gradient-to-br from-[#fff8eb] to-card p-3 hover:shadow-sm transition-shadow cursor-pointer">
                      <p className="text-xs font-bold line-clamp-2">{post.title}</p>
                      <p className="mt-2 text-[10px] text-muted-foreground">{post.authorName} · {formatDistanceToNowStrict(new Date(post.createdAt), { addSuffix: true })}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <TaskFormDialog
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onSaved={() => utils.dashboard.workboard.invalidate()}
        adminUsers={adminUsers}
      />
    </div>
  );
}
