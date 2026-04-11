/**
 * Standalone TaskFormDialog — create or edit an admin task.
 * Exported so it can be used from AdminTasks.tsx and AdminBookingDetail.tsx.
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { format } from "date-fns";
import { Search, X, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/useDebounce";

type TaskPriority = "low" | "medium" | "high" | "urgent";
type LinkedType = "booking" | "amendment" | "refund" | "cancellation" | "none";

const LINKED_TYPE_LABELS: Record<LinkedType, string> = {
  booking: "Booking",
  amendment: "Amendment",
  refund: "Refund",
  cancellation: "Cancellation",
  none: "None",
};

// ─── Booking Search Picker ────────────────────────────────────────────────────

export function BookingPicker({
  value,
  onChange,
  disabled,
}: {
  value: { id: number; label: string } | null;
  onChange: (v: { id: number; label: string } | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 280);

  const { data: results = [], isFetching } = trpc.bookings.quickSearch.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 }
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-muted/40 text-sm">
        <Link2 size={13} className="text-[#70FFE8] flex-shrink-0" />
        <span className="flex-1 truncate font-medium">{value.label}</span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
            title="Remove booking link"
          >
            <X size={13} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <Search size={13} className="absolute left-3 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Search by client name, PTS ref, TD ref…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => query.length >= 2 && setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          disabled={disabled}
          className="w-full h-9 pl-8 pr-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#70FFE8] disabled:opacity-50"
        />
      </div>
      {open && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-border bg-card shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {isFetching ? (
            <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-[#70FFE8] border-t-transparent animate-spin" />
              Searching…
            </div>
          ) : (results as any[]).length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">No bookings found</div>
          ) : (
            <ul>
              {(results as any[]).map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2.5 hover:bg-muted/60 transition-colors border-b border-border last:border-0"
                    onClick={() => {
                      onChange({ id: b.id, label: `${b.clientName} (#${b.id}${b.ptsRef ? ` · PTS: ${b.ptsRef}` : ""})` });
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm text-foreground truncate">{b.clientName}</span>
                      <span className="text-xs text-muted-foreground shrink-0">#{b.id}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {b.ptsRef && <span className="text-xs text-muted-foreground">PTS: {b.ptsRef}</span>}
                      {b.topdogRef && <span className="text-xs text-muted-foreground">TD: {b.topdogRef}</span>}
                      {b.departureDate && (
                        <span className="text-xs text-muted-foreground">{format(new Date(b.departureDate), "dd MMM yyyy")}</span>
                      )}
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-auto">{b.currentStage}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TaskFormDialog ───────────────────────────────────────────────────────────

export default function TaskFormDialog({
  open,
  onClose,
  onSaved,
  adminUsers,
  initial,
  prefillBooking,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  adminUsers: { id: number; name: string }[];
  /** Pre-fill the booking link (e.g. when opened from a booking detail page) */
  prefillBooking?: { id: number; label: string };
  initial?: {
    id: number;
    title: string;
    description: string | null;
    priority: TaskPriority;
    assigneeId: number | null;
    dueDate: Date | null;
    linkedType: LinkedType;
    linkedId: number | null;
    linkedBookingLabel?: string;
  };
}) {
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? "medium");
  const [assigneeId, setAssigneeId] = useState<string>(
    initial?.assigneeId ? String(initial.assigneeId) : "unassigned"
  );
  const [dueDate, setDueDate] = useState(
    initial?.dueDate ? format(new Date(initial.dueDate), "yyyy-MM-dd") : ""
  );
  const [linkedType, setLinkedType] = useState<LinkedType>(
    initial?.linkedType ?? (prefillBooking ? "booking" : "none")
  );
  const [linkedBooking, setLinkedBooking] = useState<{ id: number; label: string } | null>(
    prefillBooking ??
      (initial?.linkedType === "booking" && initial.linkedId
        ? { id: initial.linkedId, label: initial.linkedBookingLabel ?? `Booking #${initial.linkedId}` }
        : null)
  );
  const [linkedId, setLinkedId] = useState(
    initial?.linkedType !== "booking" && initial?.linkedId ? String(initial.linkedId) : ""
  );

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: () => { toast.success("Task created"); onSaved(); onClose(); },
    onError: (err) => toast.error(err.message || "Failed to create task"),
  });
  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: () => { toast.success("Task updated"); onSaved(); onClose(); },
    onError: (err) => toast.error(err.message || "Failed to update task"),
  });

  function handleSubmit() {
    if (!title.trim()) { toast.error("Title is required"); return; }
    const resolvedLinkedId =
      linkedType === "booking"
        ? (linkedBooking?.id ?? undefined)
        : linkedType !== "none" && linkedId
        ? Number(linkedId)
        : undefined;
    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      assigneeId: assigneeId !== "unassigned" ? Number(assigneeId) : undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      linkedType,
      linkedId: resolvedLinkedId,
    };
    if (isEdit && initial) {
      updateTask.mutate({ id: initial.id, ...payload });
    } else {
      createTask.mutate(payload);
    }
  }

  const isPending = createTask.isPending || updateTask.isPending;
  // When opened from a booking detail page, the booking picker is locked (pre-filled)
  const bookingLocked = !!prefillBooking && !isEdit;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Task" : "New Task"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the task details below."
              : prefillBooking
              ? `Creating a task linked to ${prefillBooking.label}.`
              : "Create a new task and optionally assign it to an admin."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Title *</label>
            <Input
              placeholder="e.g. Chase supplier for invoice"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <Textarea
              placeholder="Optional details or context…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Assign to</label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {adminUsers.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Due date</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9"
            />
          </div>
          {/* Link section */}
          <div className="space-y-3">
            {!bookingLocked && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Link to</label>
                  <Select
                    value={linkedType}
                    onValueChange={(v) => {
                      setLinkedType(v as LinkedType);
                      setLinkedId("");
                      if (v !== "booking") setLinkedBooking(null);
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="booking">Booking</SelectItem>
                      <SelectItem value="amendment">Amendment</SelectItem>
                      <SelectItem value="refund">Refund</SelectItem>
                      <SelectItem value="cancellation">Cancellation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {linkedType !== "none" && linkedType !== "booking" && (
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      {LINKED_TYPE_LABELS[linkedType]} ID
                    </label>
                    <Input
                      type="number"
                      placeholder="e.g. 42"
                      value={linkedId}
                      onChange={(e) => setLinkedId(e.target.value)}
                      className="h-9"
                    />
                  </div>
                )}
              </div>
            )}
            {linkedType === "booking" && (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {bookingLocked ? "Linked booking" : "Search booking"}
                </label>
                <BookingPicker
                  value={linkedBooking}
                  onChange={setLinkedBooking}
                  disabled={bookingLocked}
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !title.trim()}>
            {isPending && <Loader2 size={14} className="animate-spin mr-1.5" />}
            {isEdit ? "Save changes" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
