import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CalendarDays, Info, Plane, ChevronRight, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  addMonths,
  format as fmtDate,
  isToday,
  isBefore,
  isAfter,
  startOfDay,
} from "date-fns";

function fmt(d: Date | string | null | undefined) {
  if (!d) return "—";
  return fmtDate(new Date(d), "dd/MM/yyyy");
}

type TimelineBooking = {
  id: number;
  clientName: string;
  currentStage: string;
  departureDate: Date | string | null;
  finalSupplierPaymentDate: Date | string;
  expectedCommission: string | number | null;
  ptsRef: string | null;
  topdogRef: string | null;
  claimStatus: string | null;
};

function MonthCalendar({
  month,
  paymentDates,
  highlightedDate,
  onDateClick,
}: {
  month: Date;
  paymentDates: Date[];
  highlightedDate: Date | null;
  onDateClick: (d: Date) => void;
}) {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const firstDow = (startOfMonth(month).getDay() + 6) % 7; // Mon = 0

  return (
    <div className="rounded-xl border border-border bg-card p-3 w-full">
      <p className="text-xs font-semibold text-center text-muted-foreground mb-2">
        {fmtDate(month, "MMMM yyyy")}
      </p>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="text-[10px] text-muted-foreground font-medium py-0.5">
            {d}
          </span>
        ))}
        {Array.from({ length: firstDow }).map((_, i) => (
          <span key={`e${i}`} />
        ))}
        {days.map((day) => {
          const hasPayment = paymentDates.some((pd) => isSameDay(pd, day));
          const isHighlighted = highlightedDate && isSameDay(highlightedDate, day);
          const todayDay = isToday(day);
          return (
            <button
              key={day.toISOString()}
              onClick={() => hasPayment && onDateClick(day)}
              className={`text-[11px] rounded-full w-6 h-6 mx-auto flex items-center justify-center transition-colors
                ${
                  isHighlighted
                    ? "bg-[#02E6D2] text-[#414141] font-bold"
                    : hasPayment
                    ? "bg-[#02E6D2]/20 text-[#0f4c4a] font-bold hover:bg-[#02E6D2]/40 cursor-pointer"
                    : todayDay
                    ? "ring-1 ring-[#02E6D2] text-foreground"
                    : "text-muted-foreground"
                }`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BookingRow({ b }: { b: TimelineBooking }) {
  return (
    <div className="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-accent/30 transition-colors gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground truncate">{b.clientName}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
          {b.departureDate && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Plane size={10} /> Departs {fmt(b.departureDate)}
            </span>
          )}
          <span className="text-xs font-medium" style={{ color: "#0f4c4a" }}>
            Payment date: {fmtDate(new Date(b.finalSupplierPaymentDate), "dd MMM yyyy")}
          </span>
        </div>
        {b.expectedCommission != null && (
          <p className="text-sm font-semibold mt-0.5" style={{ color: "#065f46" }}>
            £{Number(b.expectedCommission).toFixed(2)}
          </p>
        )}
        {b.ptsRef && (
          <p className="text-xs text-muted-foreground font-mono">{b.ptsRef}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            b.claimStatus === "processing"
              ? "bg-orange-100 text-orange-700"
              : b.claimStatus === "top_up_required"
              ? "bg-red-100 text-red-700"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {b.currentStage}
        </span>
        <Link href={`/bookings/${b.id}`}>
          <button className="p-1 rounded hover:bg-muted">
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>
        </Link>
      </div>
    </div>
  );
}

function MonthAccordion({
  label,
  bookings,
  defaultOpen,
  accent,
  month,
  paymentDates,
  highlightedDate,
  onDateClick,
  isOverdue,
}: {
  label: string;
  bookings: TimelineBooking[];
  defaultOpen?: boolean;
  accent?: string;
  month?: Date;
  paymentDates?: Date[];
  highlightedDate?: Date | null;
  onDateClick?: (d: Date) => void;
  isOverdue?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const total = bookings.reduce((acc, b) => acc + Number(b.expectedCommission ?? 0), 0);

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 bg-card hover:bg-accent/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <CalendarDays size={16} style={{ color: accent ?? "#6b7280" }} />
          <span className="font-semibold text-foreground">{label}</span>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-bold"
            style={{
              background: accent ? `${accent}22` : "#f3f4f6",
              color: accent ?? "#6b7280",
            }}
          >
            {bookings.length} booking{bookings.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {total > 0 && (
            <span className="text-sm font-bold" style={{ color: "#065f46" }}>
              £{total.toFixed(2)}
            </span>
          )}
          <ChevronDown
            size={16}
            className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-3 border-t border-border bg-background space-y-4">
          {/* Overdue explainer */}
          {isOverdue && (
            <div className="rounded-lg border p-3 flex items-start gap-3" style={{ background: "#fef2f2", borderColor: "#fca5a5" }}>
              <Info size={14} className="shrink-0 mt-0.5 text-red-500" />
              <div>
                <p className="font-semibold text-xs text-red-700">Final supplier payment date has passed</p>
                <p className="text-xs mt-0.5 text-red-600 leading-relaxed">
                  The final supplier payment date on these bookings has now passed, but commission has not yet been claimed. JLT will review each file and notify you when it becomes claimable.
                </p>
                <p className="text-xs mt-1.5 text-red-600 leading-relaxed">
                  <strong>Tip:</strong> You can <strong>pre-authorise your commission</strong> on any booking — open the booking and toggle the pre-authorisation switch. This allows JLT to automatically process your claim as soon as the file is reviewed, with no action needed from you.
                </p>
              </div>
            </div>
          )}
          {/* Mini calendar for this month if provided */}
          {month && paymentDates && (
            <MonthCalendar
              month={month}
              paymentDates={paymentDates}
              highlightedDate={highlightedDate ?? null}
              onDateClick={onDateClick ?? (() => {})}
            />
          )}
          {highlightedDate && onDateClick && (
            <p className="text-xs text-center text-muted-foreground -mt-2">
              Showing bookings with payment date{" "}
              <strong>{fmtDate(highlightedDate, "dd MMMM yyyy")}</strong> —{" "}
              <button className="underline" onClick={() => onDateClick(highlightedDate)}>
                clear filter
              </button>
            </p>
          )}
          <div className="space-y-2">
            {bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No bookings match this date.
              </p>
            ) : (
              bookings.map((b) => <BookingRow key={b.id} b={b} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommissionTimeline() {
  const { data: timelineBookings, isLoading } = trpc.commissionClaims.myTimeline.useQuery();
  const [highlightedDates, setHighlightedDates] = useState<Record<string, Date | null>>({});

  const now = startOfDay(new Date());

  // Build month buckets: overdue + up to 12 future months
  const months = useMemo(() => {
    const result: { key: string; label: string; month: Date }[] = [];
    // Overdue bucket (no month)
    result.push({ key: "overdue", label: "Overdue — payment date passed", month: new Date(0) });
    for (let i = 0; i < 12; i++) {
      const m = addMonths(startOfMonth(now), i);
      result.push({ key: fmtDate(m, "yyyy-MM"), label: fmtDate(m, "MMMM yyyy"), month: m });
    }
    return result;
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, TimelineBooking[]> = {};
    for (const { key } of months) map[key] = [];
    for (const b of timelineBookings ?? []) {
      const pd = startOfDay(new Date(b.finalSupplierPaymentDate));
      if (isBefore(pd, now)) {
        map["overdue"]?.push(b);
      } else {
        const key = fmtDate(startOfMonth(pd), "yyyy-MM");
        if (map[key]) map[key].push(b);
        else {
          // Beyond 12 months — put in last bucket
          const last = months[months.length - 1].key;
          map[last]?.push(b);
        }
      }
    }
    return map;
  }, [timelineBookings, months]);

  const toggleHighlight = (monthKey: string, date: Date) => {
    setHighlightedDates((prev) => {
      const current = prev[monthKey];
      return {
        ...prev,
        [monthKey]: current && isSameDay(current, date) ? null : date,
      };
    });
  };

  const nonEmptyMonths = months.filter((m) => (grouped[m.key]?.length ?? 0) > 0);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <CalendarDays size={22} className="text-[#02E6D2]" />
          Commission Timeline
        </h1>
        <p className="text-muted-foreground mt-1">
          See when your bookings are expected to become claimable, month by month.
        </p>
      </div>

      {/* Disclaimer */}
      <div
        className="rounded-xl border p-4 flex items-start gap-3"
        style={{ background: "#fffbeb", borderColor: "#f59e0b" }}
      >
        <Info size={16} className="shrink-0 mt-0.5 text-amber-600" />
        <div>
          <p className="font-semibold text-sm text-amber-800">Approximate dates — please read</p>
          <p className="text-xs mt-1 text-amber-700 leading-relaxed">
            The <strong>Final Supplier Payment Date</strong> shown here is set by JLT a few days{" "}
            <em>after</em> the final supplier has been paid. This buffer accounts for PTS processing
            time and ensures funds have fully cleared before we review the file for commission.
            These dates are therefore a <strong>guide only</strong> — your commission will become
            claimable once JLT has reviewed and approved the file, which may be slightly later than
            the date shown.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-[#02E6D2]" />
        </div>
      ) : !timelineBookings || timelineBookings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>No upcoming commission dates yet.</p>
            <p className="text-sm mt-1">
              Dates will appear here once JLT sets the final supplier payment date on your bookings.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {nonEmptyMonths.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No bookings with payment dates found.
            </p>
          ) : (
            nonEmptyMonths.map(({ key, label, month }, idx) => {
              const bookings = grouped[key] ?? [];
              const isOverdue = key === "overdue";
              const paymentDates = bookings.map((b) => new Date(b.finalSupplierPaymentDate));
              const highlighted = highlightedDates[key] ?? null;
              const filteredBookings = highlighted
                ? bookings.filter((b) =>
                    isSameDay(new Date(b.finalSupplierPaymentDate), highlighted)
                  )
                : bookings;

              return (
                <MonthAccordion
                  key={key}
                  label={label}
                  bookings={filteredBookings}
                  defaultOpen={idx === 0}
                  accent={isOverdue ? "#dc2626" : idx === 1 ? "#0f4c4a" : "#374151"}
                  month={isOverdue ? undefined : month}
                  paymentDates={isOverdue ? undefined : paymentDates}
                  highlightedDate={highlighted}
                  onDateClick={isOverdue ? undefined : (d) => toggleHighlight(key, d)}
                  isOverdue={isOverdue}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
