import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
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
  Pencil, Trash2, X, Check, ChevronsUpDown, User, RefreshCw, Clock, BellOff
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, eachDayOfInterval,
  isSameMonth, isSameDay, isToday, addDays, addYears,
  differenceInDays, isBefore, isAfter, startOfDay, endOfDay
} from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = "holiday" | "event" | "task";
type RecurrenceRule = "none" | "daily" | "weekly" | "monthly" | "yearly";

type EventCategory = "training" | "webinar" | "supplier_event";

const CATEGORY_LABELS: Record<EventCategory, string> = {
  training: "Training",
  webinar: "Webinar",
  supplier_event: "Supplier Event",
};

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
  recurrenceRule: RecurrenceRule;
  recurrenceEndDate: Date | null;
  dueDate: Date | null;
  reminderSentAt: Date | null;
  // Agent-facing fields
  agentFacing: boolean | null;
  eventUrl: string | null;
  eventCategory: EventCategory | null;
  duration: number | null;
  registrationEnabled: boolean | null;
}

// A virtual occurrence of a recurring event (has a base event id + shifted dates)
interface CalEventOccurrence extends CalEvent {
  occurrenceStart: Date;
  occurrenceEnd: Date;
  isRecurring: boolean;
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

const RECURRENCE_LABELS: Record<RecurrenceRule, string> = {
  none:    "Does not repeat",
  daily:   "Daily",
  weekly:  "Weekly",
  monthly: "Monthly",
  yearly:  "Yearly",
};

function toLocalDateString(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function toLocalDateTimeString(d: Date) {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Expand a recurring event into all occurrences that overlap [rangeFrom, rangeTo].
 * Returns an array of CalEventOccurrence objects.
 */
function expandRecurring(ev: CalEvent, rangeFrom: Date, rangeTo: Date): CalEventOccurrence[] {
  if (ev.recurrenceRule === "none") {
    return [{
      ...ev,
      occurrenceStart: new Date(ev.startDate),
      occurrenceEnd: new Date(ev.endDate),
      isRecurring: false,
    }];
  }

  const duration = differenceInDays(new Date(ev.endDate), new Date(ev.startDate));
  const recEnd = ev.recurrenceEndDate ? new Date(ev.recurrenceEndDate) : addYears(new Date(ev.startDate), 3); // cap at 3 years if no end
  const occurrences: CalEventOccurrence[] = [];
  let cursor = new Date(ev.startDate);
  let safety = 0;

  while (!isAfter(cursor, rangeTo) && !isAfter(cursor, recEnd) && safety < 500) {
    safety++;
    const occEnd = addDays(cursor, duration);
    // Check if this occurrence overlaps the range
    if (!isBefore(occEnd, rangeFrom) && !isAfter(cursor, rangeTo)) {
      occurrences.push({
        ...ev,
        occurrenceStart: new Date(cursor),
        occurrenceEnd: occEnd,
        isRecurring: true,
      });
    }
    // Advance cursor
    switch (ev.recurrenceRule) {
      case "daily":   cursor = addDays(cursor, 1); break;
      case "weekly":  cursor = addDays(cursor, 7); break;
      case "monthly": {
        const next = new Date(cursor);
        next.setMonth(next.getMonth() + 1);
        cursor = next;
        break;
      }
      case "yearly": {
        const next = new Date(cursor);
        next.setFullYear(next.getFullYear() + 1);
        cursor = next;
        break;
      }
    }
  }
  return occurrences;
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
    event ? (event.allDay ? toLocalDateString(new Date(event.startDate)) : toLocalDateTimeString(new Date(event.startDate)))
          : toLocalDateString(today)
  );
  const [endDate, setEndDate] = useState(
    event ? (event.allDay ? toLocalDateString(new Date(event.endDate)) : toLocalDateTimeString(new Date(event.endDate)))
          : toLocalDateString(today)
  );
  const [startTime, setStartTime] = useState(
    event && !event.allDay ? format(new Date(event.startDate), "HH:mm") : "09:00"
  );
  const [assigneeId, setAssigneeId] = useState<number | null>(event?.assigneeId ?? null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>(event?.recurrenceRule ?? "none");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(
    event?.recurrenceEndDate ? toLocalDateString(new Date(event.recurrenceEndDate)) : ""
  );
  const [dueDate, setDueDate] = useState(
    event?.dueDate ? toLocalDateString(new Date(event.dueDate)) : ""
  );
  // Agent-facing fields
  const [agentFacing, setAgentFacing] = useState(event?.agentFacing ?? false);
  const [eventUrl, setEventUrl] = useState(event?.eventUrl ?? "");
  const [eventCategory, setEventCategory] = useState<EventCategory | "">(event?.eventCategory ?? "");
  const [duration, setDuration] = useState<string>(String(event?.duration ?? 60));
  const [registrationEnabled, setRegistrationEnabled] = useState(event?.registrationEnabled ?? false);

  const createMutation = trpc.calendar.create.useMutation({ onSuccess: () => { onSaved(); onClose(); } });
  const updateMutation = trpc.calendar.update.useMutation({ onSuccess: () => { onSaved(); onClose(); } });

  const isLoading = createMutation.isPending || updateMutation.isPending;

  function handleSubmit() {
    if (!title.trim()) return;
    let start: Date;
    let end: Date;
    if (allDay) {
      start = new Date(startDate + "T00:00:00");
      end   = new Date(endDate   + "T23:59:59");
    } else {
      // Use startDate + startTime; end = start + duration
      start = new Date(startDate + "T" + startTime + ":00");
      const durationMins = parseInt(duration) || 60;
      end = new Date(start.getTime() + durationMins * 60 * 1000);
    }
    const recEnd = recurrenceRule !== "none" && recurrenceEndDate ? new Date(recurrenceEndDate + "T23:59:59") : null;
    const due = type === "task" && dueDate ? new Date(dueDate + "T23:59:59") : null;
    const durationVal = agentFacing && !allDay ? (parseInt(duration) || 60) : null;

    if (event) {
      updateMutation.mutate({
        id: event.id, title, description: description || null, type,
        startDate: start, endDate: end, allDay, assigneeId,
        recurrenceRule, recurrenceEndDate: recEnd, dueDate: due,
        agentFacing,
        eventUrl: agentFacing && eventUrl ? eventUrl : null,
        eventCategory: agentFacing && eventCategory ? eventCategory as EventCategory : null,
        duration: durationVal,
        registrationEnabled: agentFacing ? registrationEnabled : false,
      });
    } else {
      createMutation.mutate({
        title, description: description || undefined, type,
        startDate: start, endDate: end, allDay, assigneeId,
        recurrenceRule, recurrenceEndDate: recEnd, dueDate: due,
        agentFacing,
        eventUrl: agentFacing && eventUrl ? eventUrl : undefined,
        eventCategory: agentFacing && eventCategory ? eventCategory as EventCategory : undefined,
        duration: durationVal,
        registrationEnabled: agentFacing ? registrationEnabled : false,
      });
    }
  }

  const assigneeName = adminUsers.find(u => u.id === assigneeId)?.name ?? "Unassigned";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{event ? "Edit Event" : "New Event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Title */}
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" className="mt-1" />
          </div>

          {/* Type */}
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={v => setType(v as EventType)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="holiday">Holiday / Leave</SelectItem>
                <SelectItem value="event">Company Event</SelectItem>
                <SelectItem value="task">Task</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* All day toggle */}
          <div className="flex items-center gap-3">
            <Switch id="allday" checked={allDay} onCheckedChange={setAllDay} />
            <Label htmlFor="allday">All day</Label>
          </div>

          {/* Start / End */}
          {allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>End Date</Label>
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Start Time</Label>
                <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="mt-1" />
              </div>
            </div>
          )}

          {/* Assignee */}
          {(type === "holiday" || type === "task") && (
            <div>
              <Label>{type === "holiday" ? "Who is off?" : "Assigned to"}</Label>
              <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full mt-1 justify-between">
                    <span className="flex items-center gap-2"><User size={14} />{assigneeName}</span>
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

          {/* Task Due Date */}
          {type === "task" && (
            <div>
              <Label className="flex items-center gap-1"><Clock size={13} /> Due Date (optional)</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">The assignee will receive a reminder the day before this date.</p>
            </div>
          )}

          {/* Recurrence */}
          <div>
            <Label className="flex items-center gap-1"><RefreshCw size={13} /> Repeat</Label>
            <Select value={recurrenceRule} onValueChange={v => setRecurrenceRule(v as RecurrenceRule)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.entries(RECURRENCE_LABELS) as [RecurrenceRule, string][]).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {recurrenceRule !== "none" && (
              <div className="mt-2">
                <Label className="text-xs text-muted-foreground">End date (optional — leave blank to repeat indefinitely)</Label>
                <Input type="date" value={recurrenceEndDate} onChange={e => setRecurrenceEndDate(e.target.value)} className="mt-1" />
              </div>
            )}
          </div>

          {/* Duration (for timed events) */}
          {!allDay && (
            <div>
              <Label className="flex items-center gap-1"><Clock size={13} /> Duration (minutes)</Label>
              <Input
                type="number" min={1} value={duration}
                onChange={e => setDuration(e.target.value)}
                className="mt-1 w-32"
                placeholder="60"
              />
              <p className="text-xs text-muted-foreground mt-1">Default: 60 minutes</p>
            </div>
          )}

          {/* Description */}
          <div>
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="mt-1" placeholder="Add details..." />
          </div>

          {/* Agent-facing section */}
          {type === "event" && (
            <div className="border rounded-lg p-3 space-y-3 bg-[#70FFE8]/10">
              <div className="flex items-center gap-3">
                <Switch id="agentfacing" checked={!!agentFacing} onCheckedChange={setAgentFacing} />
                <Label htmlFor="agentfacing" className="font-semibold">Visible to Agents</Label>
              </div>
              {agentFacing && (
                <>
                  <p className="text-xs text-muted-foreground">This event will appear on the agent community calendar and trigger a day-of email reminder to all agents.</p>
                  <div>
                    <Label>Category</Label>
                    <Select value={eventCategory} onValueChange={v => setEventCategory(v as EventCategory | "")}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="training">Training</SelectItem>
                        <SelectItem value="webinar">Webinar</SelectItem>
                        <SelectItem value="supplier_event">Supplier Event</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Join / Registration URL (optional)</Label>
                    <Input
                      value={eventUrl}
                      onChange={e => setEventUrl(e.target.value)}
                      className="mt-1"
                      placeholder="https://zoom.us/j/..."
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch id="regenabled" checked={!!registrationEnabled} onCheckedChange={setRegistrationEnabled} />
                    <Label htmlFor="regenabled">Enable RSVP (agents can mark attendance)</Label>
                  </div>
                </>
              )}
            </div>
          )}
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
  event: CalEventOccurrence;
  onEdit: () => void;
  onDelete: () => void;
  onCancelAndNotify?: () => void;
  isCancelling?: boolean;
  onClose: () => void;
}

function EventDetail({ event, onEdit, onDelete, onCancelAndNotify, isCancelling, onClose }: EventDetailProps) {
  const colors = TYPE_COLORS[event.type];
  const start = event.occurrenceStart;
  const end   = event.occurrenceEnd;
  const { data: attendees } = trpc.calendar.attendees.useQuery(
    { eventId: event.id },
    { enabled: event.type === "event" && !!event.registrationEnabled }
  );
  return (
    <div className="p-4 space-y-3 min-w-[280px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{event.title}</p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <Badge className={`text-xs ${colors.badge}`}>{TYPE_LABELS[event.type]}</Badge>
            {event.agentFacing && (
              <Badge className="text-xs bg-[#02E6D2] text-[#414141]">Agent Visible</Badge>
            )}
            {event.eventCategory && (
              <Badge variant="outline" className="text-xs">{CATEGORY_LABELS[event.eventCategory]}</Badge>
            )}
            {event.isRecurring && (
              <Badge variant="outline" className="text-xs gap-1"><RefreshCw size={10} />{RECURRENCE_LABELS[event.recurrenceRule]}</Badge>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6 shrink-0"><X size={14} /></Button>
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          {event.allDay
            ? isSameDay(start, end)
              ? format(start, "d MMM yyyy")
              : `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`
            : `${format(start, "d MMM yyyy, HH:mm")}${event.duration ? ` (${event.duration} min)` : ""}`
          }
        </p>
        {event.assigneeName && (
          <p className="flex items-center gap-1"><User size={12} /> {event.assigneeName}</p>
        )}
        {event.dueDate && (
          <p className="flex items-center gap-1 text-amber-700 font-medium">
            <Clock size={12} /> Due: {format(new Date(event.dueDate), "d MMM yyyy")}
          </p>
        )}
        {event.eventUrl && (
          <p className="flex items-center gap-1">
            <span className="text-[#02E6D2] font-medium">Join:</span>
            <a href={event.eventUrl} target="_blank" rel="noopener noreferrer" className="underline truncate max-w-[200px]">{event.eventUrl}</a>
          </p>
        )}
        {event.description && <p className="text-foreground/80">{event.description}</p>}
        {attendees && attendees.length > 0 && (
          <div>
            <p className="font-medium text-foreground/80 mb-1">RSVPs ({attendees.length}):</p>
            <div className="flex flex-wrap gap-1">
              {attendees.slice(0, 8).map(a => (
                <Badge key={a.userId} variant="outline" className="text-xs">{a.name ?? a.email ?? `User ${a.userId}`}</Badge>
              ))}
              {attendees.length > 8 && <Badge variant="outline" className="text-xs">+{attendees.length - 8} more</Badge>}
            </div>
          </div>
        )}
        {event.registrationEnabled && (!attendees || attendees.length === 0) && (
          <p className="italic">No RSVPs yet</p>
        )}
      </div>
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onEdit} className="flex-1 gap-1"><Pencil size={12} />Edit</Button>
          <Button size="sm" variant="outline" onClick={onDelete} className="flex-1 gap-1 text-destructive hover:text-destructive"><Trash2 size={12} />Delete</Button>
        </div>
        {onCancelAndNotify && (
          <Button size="sm" variant="outline" onClick={onCancelAndNotify} disabled={isCancelling} className="w-full gap-1 text-orange-600 hover:text-orange-700 border-orange-300">
            <BellOff size={12} />{isCancelling ? "Cancelling..." : "Cancel Event & Notify Agents"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Main Calendar Page ───────────────────────────────────────────────────────

type ViewMode = "month" | "week" | "agenda";

export default function AdminCalendar() {
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalEventOccurrence | null>(null);
  const [defaultFormDate, setDefaultFormDate] = useState<Date | undefined>(undefined);

  // Compute date range for query — fetch a wider window for recurring events
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
      return { from: currentDate, to: addDays(currentDate, 60) };
    }
  }, [viewMode, currentDate]);

  const { data: rawEvents = [], refetch } = trpc.calendar.list.useQuery(
    { from, to },
    { refetchOnWindowFocus: false }
  );

  // Expand recurring events into individual occurrences
  const events = useMemo<CalEventOccurrence[]>(() => {
    const result: CalEventOccurrence[] = [];
    for (const ev of rawEvents as CalEvent[]) {
      const occurrences = expandRecurring(ev, from, to);
      result.push(...occurrences);
    }
    return result;
  }, [rawEvents, from, to]);

  const { data: adminUsers = [] } = trpc.users.listAdmins.useQuery();

  const deleteMutation = trpc.calendar.delete.useMutation({ onSuccess: () => { refetch(); setSelectedEvent(null); } });
  const cancelAndNotifyMutation = trpc.calendar.cancelAndNotify.useMutation({
    onSuccess: (res) => {
      toast.success(`Event cancelled. ${res.notified} agent${res.notified !== 1 ? 's' : ''} notified.`);
      refetch();
      setSelectedEvent(null);
    },
    onError: () => toast.error("Failed to cancel event."),
  });

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
  function openEdit(ev: CalEventOccurrence) {
    // Edit the base event (not the occurrence)
    setEditingEvent(ev as CalEvent);
    setSelectedEvent(null);
    setFormOpen(true);
  }
  function handleDelete(ev: CalEventOccurrence) {
    if (confirm(`Delete "${ev.title}"?${ev.isRecurring ? "\n\nThis will delete all occurrences of this recurring event." : ""}`)) {
      deleteMutation.mutate({ id: ev.id });
    }
  }
  function handleCancelAndNotify(ev: CalEventOccurrence) {
    if (confirm(`Cancel "${ev.title}" and send a cancellation email to all active agents?`)) {
      cancelAndNotifyMutation.mutate({ id: ev.id });
    }
  }

  // Events that overlap a given day
  function eventsOnDay(day: Date): CalEventOccurrence[] {
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);
    return events.filter(ev => ev.occurrenceStart <= dayEnd && ev.occurrenceEnd >= dayStart);
  }

  // Who's away today
  const todayAway = events.filter(ev => {
    if (ev.type !== "holiday") return false;
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());
    return ev.occurrenceStart <= todayEnd && ev.occurrenceEnd >= todayStart;
  });

  // Tasks due soon (within 3 days)
  const tasksDueSoon = events.filter(ev => {
    if (ev.type !== "task" || !ev.dueDate) return false;
    const due = new Date(ev.dueDate);
    const now = new Date();
    const diffDays = differenceInDays(due, now);
    return diffDays >= 0 && diffDays <= 3;
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
          {todayAway.map((ev, i) => (
            <Badge key={`${ev.id}-${i}`} className="bg-[#FFC3BC] text-[#414141] text-xs">
              {ev.assigneeName ?? ev.title}
            </Badge>
          ))}
        </div>
      )}

      {/* Tasks due soon */}
      {tasksDueSoon.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium text-amber-800 flex items-center gap-1"><Clock size={14} /> Due soon:</span>
          {tasksDueSoon.map((ev, i) => (
            <Badge key={`${ev.id}-${i}`} className="bg-amber-200 text-amber-900 text-xs">
              {ev.title}
              {ev.dueDate && ` — ${format(new Date(ev.dueDate), "d MMM")}`}
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
      <div className="flex gap-3 flex-wrap text-xs items-center">
        {(Object.entries(TYPE_COLORS) as [EventType, typeof TYPE_COLORS[EventType]][]).map(([t, c]) => (
          <span key={t} className={`px-2 py-0.5 rounded-full font-medium ${c.badge}`}>{TYPE_LABELS[t]}</span>
        ))}
        <span className="flex items-center gap-1 text-muted-foreground"><RefreshCw size={11} /> = recurring</span>
        <span className="flex items-center gap-1 text-muted-foreground"><Clock size={11} /> = due date</span>
      </div>

      {/* Month View */}
      {viewMode === "month" && (
        <MonthView
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
          events={events}
          onEventClick={setSelectedEvent}
          selectedEvent={selectedEvent}
          onEditEvent={openEdit}
          onDeleteEvent={handleDelete}
          onCloseDetail={() => setSelectedEvent(null)}
        />
      )}

      {/* Event Detail Dialog */}
      {selectedEvent && (
        <Dialog open onOpenChange={(v) => !v && setSelectedEvent(null)}>
          <DialogContent className="max-w-sm">
            <EventDetail
              event={selectedEvent}
              onEdit={() => openEdit(selectedEvent)}
              onDelete={() => handleDelete(selectedEvent)}
              onCancelAndNotify={selectedEvent.agentFacing ? () => handleCancelAndNotify(selectedEvent) : undefined}
              isCancelling={cancelAndNotifyMutation.isPending}
              onClose={() => setSelectedEvent(null)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Event Form Dialog */}
      {formOpen && (
        <EventFormDialog
          key={editingEvent ? `edit-${editingEvent.id}` : `new-${defaultFormDate?.toISOString() ?? 'new'}`}
          open={formOpen}
          onClose={() => { setFormOpen(false); setEditingEvent(null); }}
          event={editingEvent}
          defaultDate={defaultFormDate}
          adminUsers={adminUsers as { id: number; name: string | null }[]}
          onSaved={() => { refetch(); setEditingEvent(null); }}
        />
      )}
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

interface MonthViewProps {
  currentDate: Date;
  eventsOnDay: (d: Date) => CalEventOccurrence[];
  onDayClick: (d: Date) => void;
  onEventClick: (ev: CalEventOccurrence) => void;
  selectedEvent: CalEventOccurrence | null;
  onEditEvent: (ev: CalEventOccurrence) => void;
  onDeleteEvent: (ev: CalEventOccurrence) => void;
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
      <div className="grid grid-cols-7 bg-[#414141]">
        {weekDays.map(d => (
          <div key={d} className="text-center text-xs font-semibold text-[#70FFE8] py-2">{d}</div>
        ))}
      </div>
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
                {dayEvents.slice(0, 3).map((ev, i) => {
                  const colors = TYPE_COLORS[ev.type];
                  return (
                    <div
                      key={`${ev.id}-${i}`}
                      className={`text-xs px-1 rounded truncate cursor-pointer ${colors.bg} ${colors.text} font-medium flex items-center gap-0.5`}
                      onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                    >
                      {ev.isRecurring && <RefreshCw size={9} className="shrink-0 opacity-70" />}
                      {ev.dueDate && ev.type === "task" && <Clock size={9} className="shrink-0 opacity-70" />}
                      <span className="truncate">
                        {ev.assigneeName && ev.type === "holiday" ? `${ev.assigneeName.split(" ")[0]}: ` : ""}
                        {ev.title}
                      </span>
                    </div>
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
  eventsOnDay: (d: Date) => CalEventOccurrence[];
  onDayClick: (d: Date) => void;
  onEventClick: (ev: CalEventOccurrence) => void;
  selectedEvent: CalEventOccurrence | null;
  onEditEvent: (ev: CalEventOccurrence) => void;
  onDeleteEvent: (ev: CalEventOccurrence) => void;
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
              {dayEvents.map((ev, i) => {
                const colors = TYPE_COLORS[ev.type];
                return (
                  <div
                    key={`${ev.id}-${i}`}
                    className={`text-xs px-2 py-1 rounded-md cursor-pointer ${colors.bg} ${colors.text} font-medium flex items-center gap-1`}
                    onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                  >
                    {ev.isRecurring && <RefreshCw size={9} className="shrink-0 opacity-70" />}
                    {ev.dueDate && ev.type === "task" && <Clock size={9} className="shrink-0 opacity-70" />}
                    <span className="truncate">
                      {ev.assigneeName && ev.type === "holiday" ? `${ev.assigneeName.split(" ")[0]}: ` : ""}
                      {ev.title}
                    </span>
                  </div>
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
  events: CalEventOccurrence[];
  onEventClick: (ev: CalEventOccurrence) => void;
  selectedEvent: CalEventOccurrence | null;
  onEditEvent: (ev: CalEventOccurrence) => void;
  onDeleteEvent: (ev: CalEventOccurrence) => void;
  onCloseDetail: () => void;
}

function AgendaView({ from, to, events, onEventClick, selectedEvent, onEditEvent, onDeleteEvent, onCloseDetail }: AgendaViewProps) {
  const days = eachDayOfInterval({ start: from, end: to });

  const daysWithEvents = days.filter(day => {
    const ds = startOfDay(day);
    const de = endOfDay(day);
    return events.some(ev => ev.occurrenceStart <= de && ev.occurrenceEnd >= ds);
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
        const ds = startOfDay(day);
        const de = endOfDay(day);
        const dayEvents = events.filter(ev => ev.occurrenceStart <= de && ev.occurrenceEnd >= ds);
        return (
          <div key={day.toISOString()} className="flex gap-0">
            <div className={`w-24 shrink-0 p-3 text-center border-r ${isToday(day) ? "bg-[#02E6D2]/20" : "bg-muted/10"}`}>
              <p className="text-xs text-muted-foreground">{format(day, "EEE")}</p>
              <p className={`text-lg font-bold ${isToday(day) ? "text-[#02E6D2]" : "text-[#414141]"}`}>{format(day, "d")}</p>
              <p className="text-xs text-muted-foreground">{format(day, "MMM")}</p>
            </div>
            <div className="flex-1 p-3 space-y-2">
              {dayEvents.map((ev, i) => {
                const colors = TYPE_COLORS[ev.type];
                return (
                  <div
                    key={`${ev.id}-${i}`}
                    className={`flex items-start gap-3 p-2 rounded-lg cursor-pointer hover:opacity-90 ${colors.bg}`}
                    onClick={() => onEventClick(ev)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate flex items-center gap-1 ${colors.text}`}>
                        {ev.isRecurring && <RefreshCw size={11} className="shrink-0 opacity-70" />}
                        {ev.title}
                      </p>
                      {ev.assigneeName && (
                        <p className={`text-xs flex items-center gap-1 ${colors.text} opacity-80`}>
                          <User size={10} /> {ev.assigneeName}
                        </p>
                      )}
                      {ev.dueDate && ev.type === "task" && (
                        <p className={`text-xs flex items-center gap-1 text-amber-700 font-medium`}>
                          <Clock size={10} /> Due: {format(new Date(ev.dueDate), "d MMM yyyy")}
                        </p>
                      )}
                      {ev.description && (
                        <p className={`text-xs mt-0.5 ${colors.text} opacity-70 truncate`}>{ev.description}</p>
                      )}
                    </div>
                    <Badge className={`shrink-0 text-xs ${colors.badge}`}>{TYPE_LABELS[ev.type]}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
