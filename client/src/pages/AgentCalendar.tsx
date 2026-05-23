import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, CalendarDays, List, LayoutGrid,
  ExternalLink, Download, Users, Check, RefreshCw,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, eachDayOfInterval,
  isSameMonth, isSameDay, isToday, addDays, addYears, differenceInDays,
} from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventCategory = "training" | "webinar" | "supplier_event";
type RecurrenceRule = "none" | "daily" | "weekly" | "monthly" | "yearly";

interface AgentEvent {
  id: number;
  title: string;
  description: string | null;
  type: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  createdById: number;
  createdAt: Date;
  recurrenceRule: RecurrenceRule;
  recurrenceEndDate: Date | null;
  agentFacing: boolean | null;
  eventUrl: string | null;
  eventCategory: EventCategory | null;
  duration: number | null;
  registrationEnabled: boolean | null;
  registrationCount: number;
  isRegistered: boolean;
}

interface AgentEventOccurrence extends AgentEvent {
  occurrenceStart: Date;
  occurrenceEnd: Date;
  isRecurring: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<EventCategory, { bg: string; text: string; badge: string; dot: string }> = {
  training:       { bg: "bg-[#70FFE8]",  text: "text-[#414141]", badge: "bg-[#70FFE8] text-[#414141]",  dot: "bg-[#02E6D2]" },
  webinar:        { bg: "bg-[#FFC3BC]",  text: "text-[#414141]", badge: "bg-[#FFC3BC] text-[#414141]",  dot: "bg-pink-400" },
  supplier_event: { bg: "bg-purple-100", text: "text-purple-800", badge: "bg-purple-100 text-purple-800", dot: "bg-purple-400" },
};

const CATEGORY_LABELS: Record<EventCategory, string> = {
  training: "Training",
  webinar: "Webinar",
  supplier_event: "Supplier Event",
};

const DEFAULT_COLORS = { bg: "bg-[#70FFE8]", text: "text-[#414141]", badge: "bg-[#70FFE8] text-[#414141]", dot: "bg-[#02E6D2]" };

function getColors(ev: AgentEvent) {
  return ev.eventCategory ? (CATEGORY_COLORS[ev.eventCategory] ?? DEFAULT_COLORS) : DEFAULT_COLORS;
}

function expandRecurring(ev: AgentEvent, rangeFrom: Date, rangeTo: Date): AgentEventOccurrence[] {
  if (ev.recurrenceRule === "none") {
    return [{ ...ev, occurrenceStart: new Date(ev.startDate), occurrenceEnd: new Date(ev.endDate), isRecurring: false }];
  }
  const duration = differenceInDays(new Date(ev.endDate), new Date(ev.startDate));
  const recEnd = ev.recurrenceEndDate ? new Date(ev.recurrenceEndDate) : addYears(new Date(ev.startDate), 3);
  const occurrences: AgentEventOccurrence[] = [];
  let cursor = new Date(ev.startDate);
  while (cursor <= rangeTo && cursor <= recEnd) {
    const occEnd = addDays(cursor, duration);
    if (occEnd >= rangeFrom) {
      occurrences.push({ ...ev, occurrenceStart: new Date(cursor), occurrenceEnd: occEnd, isRecurring: true });
    }
    if (ev.recurrenceRule === "daily") cursor = addDays(cursor, 1);
    else if (ev.recurrenceRule === "weekly") cursor = addDays(cursor, 7);
    else if (ev.recurrenceRule === "monthly") cursor = addMonths(cursor, 1);
    else if (ev.recurrenceRule === "yearly") cursor = addYears(cursor, 1);
    else break;
  }
  return occurrences;
}

// ─── Event Detail Dialog ──────────────────────────────────────────────────────

function EventDetailDialog({
  event,
  onClose,
}: {
  event: AgentEventOccurrence;
  onClose: () => void;
}) {
  const colors = getColors(event);
  const utils = trpc.useUtils();

  const registerMutation = trpc.calendar.register.useMutation({
    onSuccess: () => {
      toast.success("You're registered for this event!");
      utils.calendar.listAgentEvents.invalidate();
    },
    onError: () => toast.error("Failed to register. Please try again."),
  });

  const unregisterMutation = trpc.calendar.unregister.useMutation({
    onSuccess: () => {
      toast.success("Registration cancelled.");
      utils.calendar.listAgentEvents.invalidate();
    },
    onError: () => toast.error("Failed to cancel registration."),
  });

  const { data: icsData } = trpc.calendar.generateIcs.useQuery(
    { eventId: event.id },
    { enabled: true }
  );

  function downloadIcs() {
    if (!icsData) return;
    const blob = new Blob([icsData.ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = icsData.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const start = event.occurrenceStart;
  const timeStr = event.allDay
    ? (isSameDay(start, event.occurrenceEnd)
        ? format(start, "d MMMM yyyy")
        : `${format(start, "d MMM")} – ${format(event.occurrenceEnd, "d MMM yyyy")}`)
    : `${format(start, "EEEE d MMMM yyyy")} at ${format(start, "HH:mm")}${event.duration ? ` (${event.duration} min)` : ""}`;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg leading-snug">{event.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            {event.eventCategory && (
              <Badge className={`text-xs ${colors.badge}`}>{CATEGORY_LABELS[event.eventCategory]}</Badge>
            )}
            {event.isRecurring && (
              <Badge variant="outline" className="text-xs gap-1"><RefreshCw size={10} />Recurring</Badge>
            )}
            {event.registrationEnabled && (
              <Badge variant="outline" className="text-xs gap-1"><Users size={10} />{event.registrationCount} attending</Badge>
            )}
          </div>

          {/* Time */}
          <p className="text-sm text-muted-foreground">{timeStr}</p>

          {/* Description */}
          {event.description && (
            <p className="text-sm text-foreground/80 whitespace-pre-wrap">{event.description}</p>
          )}

          {/* Join URL */}
          {event.eventUrl && (
            <a
              href={event.eventUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-medium text-[#02E6D2] hover:underline"
            >
              <ExternalLink size={14} /> Join / Register
            </a>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1 flex-wrap">
            {event.registrationEnabled && (
              event.isRegistered ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-destructive hover:text-destructive"
                  disabled={unregisterMutation.isPending}
                  onClick={() => unregisterMutation.mutate({ eventId: event.id })}
                >
                  <Check size={14} /> Cancel RSVP
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="gap-1"
                  style={{ background: "#02E6D2", color: "#414141" }}
                  disabled={registerMutation.isPending}
                  onClick={() => registerMutation.mutate({ eventId: event.id })}
                >
                  <Users size={14} /> RSVP
                </Button>
              )
            )}
            <Button variant="outline" size="sm" className="gap-1" onClick={downloadIcs} disabled={!icsData}>
              <Download size={14} /> Add to Calendar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main AgentCalendar Page ──────────────────────────────────────────────────

type ViewMode = "month" | "week" | "agenda";

export default function AgentCalendar() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<AgentEventOccurrence | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<EventCategory | "all">("all");

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

  const { data: rawEvents = [] } = trpc.calendar.listAgentEvents.useQuery(
    { from, to },
    { refetchOnWindowFocus: false }
  );

  const allOccurrences = useMemo<AgentEventOccurrence[]>(() => {
    const result: AgentEventOccurrence[] = [];
    for (const ev of rawEvents as AgentEvent[]) {
      result.push(...expandRecurring(ev, from, to));
    }
    return result;
  }, [rawEvents, from, to]);

  const events = useMemo(() => {
    if (categoryFilter === "all") return allOccurrences;
    return allOccurrences.filter(ev => ev.eventCategory === categoryFilter);
  }, [allOccurrences, categoryFilter]);

  function eventsOnDay(day: Date): AgentEventOccurrence[] {
    return events.filter(ev => day >= ev.occurrenceStart && day <= ev.occurrenceEnd);
  }

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

  const headerLabel = viewMode === "month"
    ? format(currentDate, "MMMM yyyy")
    : viewMode === "week"
      ? `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), "d MMM")} – ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), "d MMM yyyy")}`
      : `From ${format(currentDate, "d MMM yyyy")}`;

  // Upcoming events in the next 7 days for the sidebar
  const upcomingThisWeek = useMemo(() => {
    const now = new Date();
    const weekEnd = addDays(now, 7);
    return allOccurrences
      .filter(ev => ev.occurrenceStart >= now && ev.occurrenceStart <= weekEnd)
      .sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime())
      .slice(0, 5);
  }, [allOccurrences]);

  return (
    <div className="flex h-full min-h-screen bg-background">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-border bg-card p-4 gap-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
            Filter by Type
          </p>
          {(["all", "training", "webinar", "supplier_event"] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left w-full ${
                categoryFilter === cat
                  ? "bg-[#414141] text-[#70FFE8]"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              {cat === "all" ? "📅" : cat === "training" ? "🎓" : cat === "webinar" ? "💻" : "✈️"}
              <span className="flex-1 truncate">
                {cat === "all" ? "All Events" : CATEGORY_LABELS[cat]}
              </span>
            </button>
          ))}
        </div>

        {/* Upcoming this week */}
        {upcomingThisWeek.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
              Coming Up
            </p>
            <div className="space-y-2">
              {upcomingThisWeek.map((ev, i) => {
                const colors = getColors(ev);
                return (
                  <button
                    key={`${ev.id}-${i}`}
                    onClick={() => setSelectedEvent(ev)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium ${colors.bg} ${colors.text} hover:opacity-90 transition-opacity`}
                  >
                    <p className="font-semibold truncate">{ev.title}</p>
                    <p className="opacity-70 mt-0.5">
                      {ev.allDay ? format(ev.occurrenceStart, "EEE d MMM") : format(ev.occurrenceStart, "EEE d MMM, HH:mm")}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 lg:px-6 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>Today</Button>
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
        </div>

        {/* Legend */}
        <div className="px-4 lg:px-6 pt-3 pb-2 flex gap-3 flex-wrap text-xs items-center">
          {(Object.entries(CATEGORY_LABELS) as [EventCategory, string][]).map(([cat, label]) => {
            const colors = CATEGORY_COLORS[cat];
            return (
              <span key={cat} className={`px-2 py-0.5 rounded-full font-medium ${colors.badge}`}>{label}</span>
            );
          })}
          <span className="flex items-center gap-1 text-muted-foreground"><Users size={11} /> = RSVP enabled</span>
        </div>

        {/* Views */}
        <div className="flex-1 px-4 lg:px-6 pb-8">
          {viewMode === "month" && (
            <MonthView
              currentDate={currentDate}
              eventsOnDay={eventsOnDay}
              onEventClick={setSelectedEvent}
            />
          )}
          {viewMode === "week" && (
            <WeekView
              currentDate={currentDate}
              eventsOnDay={eventsOnDay}
              onEventClick={setSelectedEvent}
            />
          )}
          {viewMode === "agenda" && (
            <AgendaView
              from={from}
              to={to}
              events={events}
              onEventClick={setSelectedEvent}
            />
          )}
        </div>
      </main>

      {/* Event Detail Dialog */}
      {selectedEvent && (
        <EventDetailDialog
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({
  currentDate,
  eventsOnDay,
  onEventClick,
}: {
  currentDate: Date;
  eventsOnDay: (d: Date) => AgentEventOccurrence[];
  onEventClick: (ev: AgentEventOccurrence) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd   = endOfMonth(currentDate);
  const calStart   = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd     = endOfWeek(monthEnd,   { weekStartsOn: 1 });
  const days       = eachDayOfInterval({ start: calStart, end: calEnd });
  const weekDays   = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="border rounded-xl overflow-hidden mt-2">
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
              className={`min-h-[90px] border-b border-r p-1 ${!inMonth ? "bg-muted/10 opacity-50" : ""}`}
            >
              <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${isToday_ ? "bg-[#02E6D2] text-[#414141]" : "text-muted-foreground"}`}>
                {format(day, "d")}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((ev, i) => {
                  const colors = getColors(ev);
                  return (
                    <div
                      key={`${ev.id}-${i}`}
                      className={`text-xs px-1 rounded truncate cursor-pointer ${colors.bg} ${colors.text} font-medium flex items-center gap-0.5`}
                      onClick={() => onEventClick(ev)}
                    >
                      {ev.registrationEnabled && <Users size={9} className="shrink-0 opacity-70" />}
                      <span className="truncate">{ev.title}</span>
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

function WeekView({
  currentDate,
  eventsOnDay,
  onEventClick,
}: {
  currentDate: Date;
  eventsOnDay: (d: Date) => AgentEventOccurrence[];
  onEventClick: (ev: AgentEventOccurrence) => void;
}) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });

  return (
    <div className="border rounded-xl overflow-hidden mt-2">
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
            <div key={day.toISOString()} className="border-r p-2 space-y-1">
              {dayEvents.map((ev, i) => {
                const colors = getColors(ev);
                return (
                  <div
                    key={`${ev.id}-${i}`}
                    className={`text-xs px-2 py-1 rounded-md cursor-pointer ${colors.bg} ${colors.text} font-medium flex items-center gap-1`}
                    onClick={() => onEventClick(ev)}
                  >
                    {ev.registrationEnabled && <Users size={9} className="shrink-0 opacity-70" />}
                    <span className="truncate">{ev.title}</span>
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

function AgendaView({
  from,
  to,
  events,
  onEventClick,
}: {
  from: Date;
  to: Date;
  events: AgentEventOccurrence[];
  onEventClick: (ev: AgentEventOccurrence) => void;
}) {
  const days = eachDayOfInterval({ start: from, end: to });
  const daysWithEvents = days.filter(day =>
    events.some(ev => day >= ev.occurrenceStart && day <= ev.occurrenceEnd)
  );

  if (daysWithEvents.length === 0) {
    return (
      <div className="border rounded-xl p-12 text-center text-muted-foreground mt-2">
        <CalendarDays size={40} className="mx-auto mb-3 opacity-30" />
        <p className="font-medium">No events in this period</p>
        <p className="text-sm mt-1">Check back soon for upcoming training and webinars.</p>
      </div>
    );
  }

  return (
    <div className="border rounded-xl overflow-hidden divide-y mt-2">
      {daysWithEvents.map(day => {
        const dayEvents = events.filter(ev => day >= ev.occurrenceStart && day <= ev.occurrenceEnd);
        return (
          <div key={day.toISOString()} className="flex gap-0">
            <div className={`w-24 shrink-0 p-3 text-center border-r ${isToday(day) ? "bg-[#02E6D2]/20" : "bg-muted/10"}`}>
              <p className="text-xs text-muted-foreground">{format(day, "EEE")}</p>
              <p className={`text-lg font-bold ${isToday(day) ? "text-[#02E6D2]" : "text-[#414141]"}`}>{format(day, "d")}</p>
              <p className="text-xs text-muted-foreground">{format(day, "MMM")}</p>
            </div>
            <div className="flex-1 p-3 space-y-2">
              {dayEvents.map((ev, i) => {
                const colors = getColors(ev);
                return (
                  <div
                    key={`${ev.id}-${i}`}
                    className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:opacity-90 ${colors.bg}`}
                    onClick={() => onEventClick(ev)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate flex items-center gap-1 ${colors.text}`}>
                        {ev.registrationEnabled && <Users size={11} className="shrink-0 opacity-70" />}
                        {ev.title}
                      </p>
                      {!ev.allDay && (
                        <p className={`text-xs mt-0.5 ${colors.text} opacity-80`}>
                          {format(ev.occurrenceStart, "HH:mm")}{ev.duration ? ` · ${ev.duration} min` : ""}
                        </p>
                      )}
                      {ev.description && (
                        <p className={`text-xs mt-1 ${colors.text} opacity-70 line-clamp-2`}>{ev.description}</p>
                      )}
                      {ev.registrationEnabled && (
                        <p className={`text-xs mt-1 flex items-center gap-1 ${colors.text} opacity-70`}>
                          <Users size={10} /> {ev.registrationCount} attending
                          {ev.isRegistered && <span className="ml-1 font-semibold text-green-700">· You're in!</span>}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {ev.eventCategory && (
                        <Badge className={`text-xs ${colors.badge}`}>{CATEGORY_LABELS[ev.eventCategory]}</Badge>
                      )}
                      {ev.eventUrl && (
                        <ExternalLink size={12} className={`${colors.text} opacity-60`} />
                      )}
                    </div>
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
