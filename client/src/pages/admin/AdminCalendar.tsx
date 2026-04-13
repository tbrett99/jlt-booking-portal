import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  ChevronLeft, ChevronRight, Plus, CalendarDays, List, LayoutGrid,
  Pencil, Trash2, X, Check, ChevronsUpDown, User
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, eachDayOfInterval,
  isSameMonth, isSameDay, isToday, parseISO, addDays
} from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = "holiday" | "event" | "task";

interface CalEvent {
  id: number;
  title: string;
  description: string | null;
  type: EventType;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  assigneeId: number | null;
  assigneeName: string | null;
  createdById: number;
  createdAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<EventType, { bg: string; text: string; badge: string }> = {
  holiday: { bg: "bg-[#FFC3BC]", text: "text-[#414141]", badge: "bg-[#FFC3BC] text-[#414141]" },
  event:   { bg: "bg-[#70FFE8]", text: "text-[#414141]", badge: "bg-[#70FFE8] text-[#414141]" },
  task:    { bg: "bg-amber-200",  text: "text-amber-900",  badge: "bg-amber-200 text-amber-900" },
};

const TYPE_LABELS: Record<EventType, string> = {
  holiday: "Holiday / Leave",
  event:   "Company Event",
  task:    "Task",
};

function toLocalDateString(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function toLocalDateTimeString(d: Date) {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

// ─── Event Form Dialog ────────────────────────────────────────────────────────

interface EventFormDialogProps {
  open: boolean;
  onClose: () => void;
  event?: CalEvent | null;
  defaultDate?: Date;
  adminUsers: { id: number; name: string | null }[];
  onSaved: () => void;
}

function EventFormDialog({ open, onClose, event, defaultDate, adminUsers, onSaved }: EventFormDialogProps) {
  const today = defaultDate ?? new Date();
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [type, setType] = useState<EventType>(event?.type ?? "event");
  const [allDay, setAllDay] = useState(event?.allDay ?? true);
  const [startDate, setStartDate] = useState(
    event ? (allDay ? toLocalDateString(event.startDate) : toLocalDateTimeString(event.startDate))
          : toLocalDateString(today)
  );
  const [endDate, setEndDate] = useState(
    event ? (allDay ? toLocalDateString(event.endDate) : toLocalDateTimeString(event.endDate))
          : toLocalDateString(today)
  );
  const [assigneeId, setAssigneeId] = useState<number | null>(event?.assigneeId ?? null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);

  const createMutation = trpc.calendar.create.useMutation({ onSuccess: () => { onSaved(); onClose(); } });
  const updateMutation = trpc.calendar.update.useMutation({ onSuccess: () => { onSaved(); onClose(); } });

  const isLoading = createMutation.isPending || updateMutation.isPending;

  function handleSubmit() {
    if (!title.trim()) return;
    const start = allDay ? new Date(startDate + "T00:00:00") : new Date(startDate);
    const end   = allDay ? new Date(endDate   + "T23:59:59") : new Date(endDate);
    if (event) {
      updateMutation.mutate({ id: event.id, title, description: description || null, type, startDate: start, endDate: end, allDay, assigneeId });
    } else {
      createMutation.mutate({ title, description: description || undefined, type, startDate: start, endDate: end, allDay, assigneeId });
    }
  }

  const assigneeName = adminUsers.find(u => u.id === assigneeId)?.name ?? "Unassigned";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{event ? "Edit Event" : "New Event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" className="mt-1" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={v => setType(v as EventType)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="holiday">Holiday / Leave</SelectItem>
                <SelectItem value="event">Company Event</SelectItem>
                <SelectItem value="task">Task</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="allday" checked={allDay} onCheckedChange={setAllDay} />
            <Label htmlFor="allday">All day</Label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start {allDay ? "Date" : "Date & Time"}</Label>
              <Input
                type={allDay ? "date" : "datetime-local"}
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>End {allDay ? "Date" : "Date & Time"}</Label>
              <Input
                type={allDay ? "date" : "datetime-local"}
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          {(type === "holiday" || type === "task") && (
            <div>
              <Label>{type === "holiday" ? "Who is off?" : "Assigned to"}</Label>
              <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full mt-1 justify-between">
                    <span className="flex items-center gap-2">
                      <User size={14} />
                      {assigneeName}
                    </span>
                    <ChevronsUpDown size={14} className="opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0">
                  <Command>
                    <CommandInput placeholder="Search admin..." />
                    <CommandList>
                      <CommandEmpty>No admin found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="" onSelect={() => { setAssigneeId(null); setAssigneeOpen(false); }}>
                          <Check size={14} className={assigneeId === null ? "opacity-100" : "opacity-0"} />
                          Unassigned
                        </CommandItem>
                        {adminUsers.map(u => (
                          <CommandItem key={u.id} value={u.name ?? ""} onSelect={() => { setAssigneeId(u.id); setAssigneeOpen(false); }}>
                            <Check size={14} className={assigneeId === u.id ? "opacity-100" : "opacity-0"} />
                            {u.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}
          <div>
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="mt-1" placeholder="Add details..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isLoading || !title.trim()} style={{ background: "#02E6D2", color: "#414141" }}>
            {isLoading ? "Saving..." : event ? "Save Changes" : "Create Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Event Detail Popover ─────────────────────────────────────────────────────

interface EventDetailProps {
  event: CalEvent;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function EventDetail({ event, onEdit, onDelete, onClose }: EventDetailProps) {
  const colors = TYPE_COLORS[event.type];
  return (
    <div className="p-4 space-y-3 min-w-[260px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{event.title}</p>
          <Badge className={`mt-1 text-xs ${colors.badge}`}>{TYPE_LABELS[event.type]}</Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6 shrink-0"><X size={14} /></Button>
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          {event.allDay
            ? isSameDay(event.startDate, event.endDate)
              ? format(event.startDate, "d MMM yyyy")
              : `${format(event.startDate, "d MMM")} – ${format(event.endDate, "d MMM yyyy")}`
            : `${format(event.startDate, "d MMM yyyy HH:mm")} – ${format(event.endDate, "HH:mm")}`
          }
        </p>
        {event.assigneeName && (
          <p className="flex items-center gap-1"><User size={12} /> {event.assigneeName}</p>
        )}
        {event.description && <p className="text-foreground/80">{event.description}</p>}
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={onEdit} className="flex-1 gap-1"><Pencil size={12} />Edit</Button>
        <Button size="sm" variant="outline" onClick={onDelete} className="flex-1 gap-1 text-destructive hover:text-destructive"><Trash2 size={12} />Delete</Button>
      </div>
    </div>
  );
}

// ─── Main Calendar Page ───────────────────────────────────────────────────────

type ViewMode = "month" | "week" | "agenda";

export default function AdminCalendar() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);
  const [defaultFormDate, setDefaultFormDate] = useState<Date | undefined>(undefined);

  // Compute date range for query
  const { from, to } = useMemo(() => {
    if (viewMode === "month") {
      return {
        from: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 }),
        to: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 }),
      };
    } else if (viewMode === "week") {
      return {
        from: startOfWeek(currentDate, { weekStartsOn: 1 }),
        to: endOfWeek(currentDate, { weekStartsOn: 1 }),
      };
    } else {
      // Agenda: next 60 days
      return { from: currentDate, to: addDays(currentDate, 60) };
    }
  }, [viewMode, currentDate]);

  const { data: events = [], refetch } = trpc.calendar.list.useQuery(
    { from, to },
    { refetchOnWindowFocus: false }
  );

  const { data: adminUsers = [] } = trpc.users.listAdmins.useQuery();

  const deleteMutation = trpc.calendar.delete.useMutation({ onSuccess: () => { refetch(); setSelectedEvent(null); } });

  function handlePrev() {
    if (viewMode === "month") setCurrentDate(subMonths(currentDate, 1));
    else if (viewMode === "week") setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(d => addDays(d, -30));
  }
  function handleNext() {
    if (viewMode === "month") setCurrentDate(addMonths(currentDate, 1));
    else if (viewMode === "week") setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(d => addDays(d, 30));
  }
  function handleToday() { setCurrentDate(new Date()); }

  function openCreate(date?: Date) {
    setEditingEvent(null);
    setDefaultFormDate(date);
    setFormOpen(true);
  }
  function openEdit(ev: CalEvent) {
    setEditingEvent(ev);
    setSelectedEvent(null);
    setFormOpen(true);
  }
  function handleDelete(ev: CalEvent) {
    if (confirm(`Delete "${ev.title}"?`)) deleteMutation.mutate({ id: ev.id });
  }

  // Events that overlap a given day
  function eventsOnDay(day: Date): CalEvent[] {
    return (events as CalEvent[]).filter(ev => {
      const start = new Date(ev.startDate);
      const end   = new Date(ev.endDate);
      return day >= start && day <= end;
    });
  }

  // Who's away today
  const todayAway = (events as CalEvent[]).filter(ev => {
    if (ev.type !== "holiday") return false;
    const start = new Date(ev.startDate);
    const end   = new Date(ev.endDate);
    const today = new Date();
    return today >= start && today <= end;
  });

  const headerLabel = viewMode === "month"
    ? format(currentDate, "MMMM yyyy")
    : viewMode === "week"
      ? `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), "d MMM")} – ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), "d MMM yyyy")}`
      : `From ${format(currentDate, "d MMM yyyy")}`;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#414141]">Team Calendar</h1>
          <p className="text-sm text-muted-foreground">Holidays, events and tasks for the admin team</p>
        </div>
        <Button onClick={() => openCreate()} style={{ background: "#02E6D2", color: "#414141" }} className="gap-2">
          <Plus size={16} /> New Event
        </Button>
      </div>

      {/* Who's away today */}
      {todayAway.length > 0 && (
        <div className="rounded-lg border border-[#FFC3BC] bg-[#FFF6ED] px-4 py-2 flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium text-[#414141]">Away today:</span>
          {todayAway.map(ev => (
            <Badge key={ev.id} className="bg-[#FFC3BC] text-[#414141] text-xs">
              {ev.assigneeName ?? ev.title}
            </Badge>
          ))}
        </div>
      )}

      {/* Navigation bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={handleToday}>Today</Button>
        <Button variant="ghost" size="icon" onClick={handlePrev}><ChevronLeft size={16} /></Button>
        <Button variant="ghost" size="icon" onClick={handleNext}><ChevronRight size={16} /></Button>
        <span className="font-semibold text-[#414141] text-sm min-w-[180px]">{headerLabel}</span>
        <div className="ml-auto flex gap-1">
          {(["month", "week", "agenda"] as ViewMode[]).map(v => (
            <Button
              key={v}
              variant={viewMode === v ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode(v)}
              style={viewMode === v ? { background: "#414141", color: "#70FFE8" } : {}}
              className="capitalize gap-1"
            >
              {v === "month" && <LayoutGrid size={14} />}
              {v === "week" && <CalendarDays size={14} />}
              {v === "agenda" && <List size={14} />}
              {v}
            </Button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap text-xs">
        {(Object.entries(TYPE_COLORS) as [EventType, typeof TYPE_COLORS[EventType]][]).map(([t, c]) => (
          <span key={t} className={`px-2 py-0.5 rounded-full font-medium ${c.badge}`}>{TYPE_LABELS[t]}</span>
        ))}
      </div>

      {/* Month View */}
      {viewMode === "month" && (
        <MonthView
          currentDate={currentDate}
          events={events as CalEvent[]}
          eventsOnDay={eventsOnDay}
          onDayClick={openCreate}
          onEventClick={setSelectedEvent}
          selectedEvent={selectedEvent}
          onEditEvent={openEdit}
          onDeleteEvent={handleDelete}
          onCloseDetail={() => setSelectedEvent(null)}
        />
      )}

      {/* Week View */}
      {viewMode === "week" && (
        <WeekView
          currentDate={currentDate}
          eventsOnDay={eventsOnDay}
          onDayClick={openCreate}
          onEventClick={setSelectedEvent}
          selectedEvent={selectedEvent}
          onEditEvent={openEdit}
          onDeleteEvent={handleDelete}
          onCloseDetail={() => setSelectedEvent(null)}
        />
      )}

      {/* Agenda View */}
      {viewMode === "agenda" && (
        <AgendaView
          from={from}
          to={to}
          events={events as CalEvent[]}
          onEventClick={setSelectedEvent}
          selectedEvent={selectedEvent}
          onEditEvent={openEdit}
          onDeleteEvent={handleDelete}
          onCloseDetail={() => setSelectedEvent(null)}
        />
      )}

      {/* Event Form Dialog */}
      {formOpen && (
        <EventFormDialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          event={editingEvent}
          defaultDate={defaultFormDate}
          adminUsers={adminUsers as { id: number; name: string | null }[]}
          onSaved={refetch}
        />
      )}
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

interface MonthViewProps {
  currentDate: Date;
  events: CalEvent[];
  eventsOnDay: (d: Date) => CalEvent[];
  onDayClick: (d: Date) => void;
  onEventClick: (ev: CalEvent) => void;
  selectedEvent: CalEvent | null;
  onEditEvent: (ev: CalEvent) => void;
  onDeleteEvent: (ev: CalEvent) => void;
  onCloseDetail: () => void;
}

function MonthView({ currentDate, eventsOnDay, onDayClick, onEventClick, selectedEvent, onEditEvent, onDeleteEvent, onCloseDetail }: MonthViewProps) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd   = endOfMonth(currentDate);
  const calStart   = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd     = endOfWeek(monthEnd,   { weekStartsOn: 1 });
  const days       = eachDayOfInterval({ start: calStart, end: calEnd });
  const weekDays   = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 bg-[#414141]">
        {weekDays.map(d => (
          <div key={d} className="text-center text-xs font-semibold text-[#70FFE8] py-2">{d}</div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7">
        {days.map(day => {
          const dayEvents = eventsOnDay(day);
          const inMonth = isSameMonth(day, currentDate);
          const isToday_ = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className={`min-h-[90px] border-b border-r p-1 cursor-pointer hover:bg-muted/30 transition-colors ${!inMonth ? "bg-muted/10 opacity-50" : ""}`}
              onClick={() => onDayClick(day)}
            >
              <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${isToday_ ? "bg-[#02E6D2] text-[#414141]" : "text-muted-foreground"}`}>
                {format(day, "d")}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map(ev => {
                  const colors = TYPE_COLORS[ev.type];
                  return (
                    <Popover key={ev.id} open={selectedEvent?.id === ev.id} onOpenChange={(o) => !o && onCloseDetail()}>
                      <PopoverTrigger asChild>
                        <div
                          className={`text-xs px-1 rounded truncate cursor-pointer ${colors.bg} ${colors.text} font-medium`}
                          onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                        >
                          {ev.assigneeName && ev.type === "holiday" ? `${ev.assigneeName.split(" ")[0]}: ` : ""}
                          {ev.title}
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-auto" side="right">
                        <EventDetail event={ev} onEdit={() => onEditEvent(ev)} onDelete={() => onDeleteEvent(ev)} onClose={onCloseDetail} />
                      </PopoverContent>
                    </Popover>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="text-xs text-muted-foreground pl-1">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

interface WeekViewProps {
  currentDate: Date;
  eventsOnDay: (d: Date) => CalEvent[];
  onDayClick: (d: Date) => void;
  onEventClick: (ev: CalEvent) => void;
  selectedEvent: CalEvent | null;
  onEditEvent: (ev: CalEvent) => void;
  onDeleteEvent: (ev: CalEvent) => void;
  onCloseDetail: () => void;
}

function WeekView({ currentDate, eventsOnDay, onDayClick, onEventClick, selectedEvent, onEditEvent, onDeleteEvent, onCloseDetail }: WeekViewProps) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 bg-[#414141]">
        {days.map(d => (
          <div key={d.toISOString()} className={`text-center py-3 ${isToday(d) ? "bg-[#02E6D2]" : ""}`}>
            <p className={`text-xs font-semibold ${isToday(d) ? "text-[#414141]" : "text-[#70FFE8]"}`}>{format(d, "EEE")}</p>
            <p className={`text-sm font-bold ${isToday(d) ? "text-[#414141]" : "text-white"}`}>{format(d, "d")}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 min-h-[300px]">
        {days.map(day => {
          const dayEvents = eventsOnDay(day);
          return (
            <div
              key={day.toISOString()}
              className="border-r p-2 cursor-pointer hover:bg-muted/20 space-y-1"
              onClick={() => onDayClick(day)}
            >
              {dayEvents.map(ev => {
                const colors = TYPE_COLORS[ev.type];
                return (
                  <Popover key={ev.id} open={selectedEvent?.id === ev.id} onOpenChange={o => !o && onCloseDetail()}>
                    <PopoverTrigger asChild>
                      <div
                        className={`text-xs px-2 py-1 rounded-md cursor-pointer ${colors.bg} ${colors.text} font-medium`}
                        onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                      >
                        {ev.assigneeName && ev.type === "holiday" ? `${ev.assigneeName.split(" ")[0]}: ` : ""}
                        {ev.title}
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-auto" side="bottom">
                      <EventDetail event={ev} onEdit={() => onEditEvent(ev)} onDelete={() => onDeleteEvent(ev)} onClose={onCloseDetail} />
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Agenda View ──────────────────────────────────────────────────────────────

interface AgendaViewProps {
  from: Date;
  to: Date;
  events: CalEvent[];
  onEventClick: (ev: CalEvent) => void;
  selectedEvent: CalEvent | null;
  onEditEvent: (ev: CalEvent) => void;
  onDeleteEvent: (ev: CalEvent) => void;
  onCloseDetail: () => void;
}

function AgendaView({ from, to, events, onEventClick, selectedEvent, onEditEvent, onDeleteEvent, onCloseDetail }: AgendaViewProps) {
  const days = eachDayOfInterval({ start: from, end: to });

  const daysWithEvents = days.filter(day => {
    return events.some(ev => {
      const start = new Date(ev.startDate);
      const end   = new Date(ev.endDate);
      return day >= start && day <= end;
    });
  });

  if (daysWithEvents.length === 0) {
    return (
      <div className="border rounded-xl p-12 text-center text-muted-foreground">
        <CalendarDays size={40} className="mx-auto mb-3 opacity-30" />
        <p className="font-medium">No events in this period</p>
        <p className="text-sm mt-1">Click "New Event" to add one</p>
      </div>
    );
  }

  return (
    <div className="border rounded-xl overflow-hidden divide-y">
      {daysWithEvents.map(day => {
        const dayEvents = events.filter(ev => {
          const start = new Date(ev.startDate);
          const end   = new Date(ev.endDate);
          return day >= start && day <= end;
        });
        return (
          <div key={day.toISOString()} className="flex gap-0">
            <div className={`w-24 shrink-0 p-3 text-center border-r ${isToday(day) ? "bg-[#02E6D2]/20" : "bg-muted/10"}`}>
              <p className="text-xs text-muted-foreground">{format(day, "EEE")}</p>
              <p className={`text-lg font-bold ${isToday(day) ? "text-[#02E6D2]" : "text-[#414141]"}`}>{format(day, "d")}</p>
              <p className="text-xs text-muted-foreground">{format(day, "MMM")}</p>
            </div>
            <div className="flex-1 p-3 space-y-2">
              {dayEvents.map(ev => {
                const colors = TYPE_COLORS[ev.type];
                return (
                  <Popover key={ev.id} open={selectedEvent?.id === ev.id} onOpenChange={o => !o && onCloseDetail()}>
                    <PopoverTrigger asChild>
                      <div
                        className={`flex items-start gap-3 p-2 rounded-lg cursor-pointer hover:opacity-90 ${colors.bg}`}
                        onClick={() => onEventClick(ev)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold truncate ${colors.text}`}>{ev.title}</p>
                          {ev.assigneeName && (
                            <p className={`text-xs flex items-center gap-1 ${colors.text} opacity-80`}>
                              <User size={10} /> {ev.assigneeName}
                            </p>
                          )}
                          {ev.description && (
                            <p className={`text-xs mt-0.5 ${colors.text} opacity-70 truncate`}>{ev.description}</p>
                          )}
                        </div>
                        <Badge className={`shrink-0 text-xs ${colors.badge}`}>{TYPE_LABELS[ev.type]}</Badge>
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-auto" side="right">
                      <EventDetail event={ev} onEdit={() => onEditEvent(ev)} onDelete={() => onDeleteEvent(ev)} onClose={onCloseDetail} />
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
