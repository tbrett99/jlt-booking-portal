import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Send, Lock, FileText, Loader2, Save, AlertTriangle, Calendar, User, AtSign } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/_core/hooks/useAuth";

const STAGES = [
  "New Booking", "Creating own PTS file", "Not on Topdog", "Query",
  "Reimb Docs Missing", "Urgent/Reimb", "T/O Package", "DP",
  "Added to PTS", "Commission Claimable", "Commission Claimed",
  "Cancelled", "Holding Accounts",
];

const STAGES_REQUIRING_PAYMENT_DATE = [
  "Added to PTS",
  "Commission Claimable",
  "Commission Claimed",
  "Holding Accounts",
];

// Render note content with @mentions highlighted
function NoteContent({ content }: { content: string }) {
  const parts = content.split(/(@[A-Za-z][A-Za-z0-9 ]*)/g);
  return (
    <p className="whitespace-pre-wrap text-sm">
      {parts.map((part, i) =>
        part.startsWith("@") ? (
          <span key={i} className="font-semibold rounded px-1" style={{ background: "#70FFE8", color: "#414141" }}>
            {part}
          </span>
        ) : (
          part
        )
      )}
    </p>
  );
}

export default function AdminBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const bookingId = Number(id);
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [sharedNote, setSharedNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [isSendingShared, setIsSendingShared] = useState(false);
  const [isSendingInternal, setIsSendingInternal] = useState(false);
  const [editPts, setEditPts] = useState("");
  const [editTopdog, setEditTopdog] = useState("");
  const [editPaymentDate, setEditPaymentDate] = useState("");
  const [editCommission, setEditCommission] = useState("");
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [detailsInitialised, setDetailsInitialised] = useState(false);
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [showPaymentDateGuard, setShowPaymentDateGuard] = useState(false);

  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionDropdownOpen, setMentionDropdownOpen] = useState(false);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: booking, isLoading } = trpc.bookings.byId.useQuery({ id: bookingId });
  const { data: adminUsers = [] } = trpc.users.listAdmins.useQuery();

  // Populate editable fields once booking loads
  if (booking && !detailsInitialised) {
    setEditPts(booking.ptsRef ?? "");
    setEditTopdog(booking.topdogRef ?? "");
    setEditPaymentDate(booking.finalSupplierPaymentDate ? format(new Date(booking.finalSupplierPaymentDate), "yyyy-MM-dd") : "");
    setEditCommission(booking.expectedCommission ? String(booking.expectedCommission) : "");
    setDetailsInitialised(true);
  }

  const { data: allNotes = [], refetch: refetchNotes } = trpc.notes.list.useQuery({ bookingId });
  const sharedNotes = allNotes.filter(n => !n.isInternal);
  const internalNotes = allNotes.filter(n => n.isInternal);

  const addNote = trpc.notes.add.useMutation();
  const updateDetails = trpc.bookings.updateAdminFields.useMutation();
  const moveStage = trpc.bookings.moveStage.useMutation({
    onSuccess: () => utils.bookings.byId.invalidate({ id: bookingId }),
    onError: (err) => toast.error(err.message || "Failed to move booking"),
  });

  // @mention: detect when user types @ in internal note
  const handleInternalNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInternalNote(val);

    // Find the last @ before cursor
    const cursorPos = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([A-Za-z][A-Za-z0-9 ]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionDropdownOpen(true);
    } else if (textBeforeCursor.match(/@$/)) {
      setMentionQuery("");
      setMentionDropdownOpen(true);
    } else {
      setMentionDropdownOpen(false);
      setMentionQuery(null);
    }
  };

  const insertMention = (name: string) => {
    const textarea = internalTextareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart ?? internalNote.length;
    const textBeforeCursor = internalNote.slice(0, cursorPos);
    const textAfterCursor = internalNote.slice(cursorPos);
    // Replace the partial @mention with the full name
    const replaced = textBeforeCursor.replace(/@([A-Za-z][A-Za-z0-9 ]*)?$/, `@${name} `);
    setInternalNote(replaced + textAfterCursor);
    setMentionDropdownOpen(false);
    setMentionQuery(null);
    setTimeout(() => textarea.focus(), 0);
  };

  const filteredAdmins = adminUsers.filter(
    (a) => a.id !== user?.id && (mentionQuery === null || a.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
  );

  const handleStageChange = (newStage: string) => {
    if (
      STAGES_REQUIRING_PAYMENT_DATE.includes(newStage) &&
      !booking?.finalSupplierPaymentDate &&
      !editPaymentDate
    ) {
      setPendingStage(newStage);
      setShowPaymentDateGuard(true);
      return;
    }
    moveStage.mutate({ bookingId, toStage: newStage });
  };

  const handleGuardSaveAndMove = async () => {
    if (!editPaymentDate) {
      toast.error("Please enter a Final Supplier Payment Date before moving to this stage.");
      return;
    }
    setIsSavingDetails(true);
    try {
      await updateDetails.mutateAsync({
        bookingId,
        finalSupplierPaymentDate: new Date(editPaymentDate),
      });
      await utils.bookings.byId.invalidate({ id: bookingId });
      if (pendingStage) {
        moveStage.mutate({ bookingId, toStage: pendingStage });
      }
      setShowPaymentDateGuard(false);
      setPendingStage(null);
      toast.success("Payment date saved and booking moved.");
    } catch (err: any) {
      toast.error(err.message || "Failed to save payment date");
    } finally {
      setIsSavingDetails(false);
    }
  };

  const handleSendNote = async (isInternal: boolean) => {
    const content = isInternal ? internalNote : sharedNote;
    if (!content.trim()) return;
    if (isInternal) setIsSendingInternal(true); else setIsSendingShared(true);
    try {
      await addNote.mutateAsync({ bookingId, content, isInternal });
      if (isInternal) { setInternalNote(""); await refetchNotes(); }
      else { setSharedNote(""); await refetchNotes(); }
      toast.success("Note added");
    } catch (err: any) {
      toast.error(err.message || "Failed to add note");
    } finally {
      if (isInternal) setIsSendingInternal(false); else setIsSendingShared(false);
    }
  };

  const handleSaveDetails = async () => {
    setIsSavingDetails(true);
    try {
      await updateDetails.mutateAsync({
        bookingId,
        ptsRef: editPts || undefined,
        topdogRef: editTopdog || undefined,
        finalSupplierPaymentDate: editPaymentDate ? new Date(editPaymentDate) : null,
        expectedCommission: editCommission ? Number(editCommission) : undefined,
      });
      await utils.bookings.byId.invalidate({ id: bookingId });
      toast.success("Details saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save details");
    } finally {
      setIsSavingDetails(false);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin" size={32} style={{ color: '#70FFE8' }} />
    </div>
  );
  if (!booking) return <div className="text-center py-20 text-muted-foreground">Booking not found.</div>;

  const missingPaymentDate = !booking.finalSupplierPaymentDate && !editPaymentDate;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/pipeline">
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft size={16} />Pipeline</Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{booking.clientName}</h1>
          <p className="text-sm text-muted-foreground">Booking #{booking.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {missingPaymentDate && STAGES_REQUIRING_PAYMENT_DATE.includes(booking.currentStage) && (
            <Badge variant="destructive" className="gap-1 text-xs">
              <AlertTriangle size={10} /> Payment date missing
            </Badge>
          )}
          <Select value={booking.currentStage} onValueChange={handleStageChange}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Booking info */}
        <Card>
          <CardHeader><CardTitle className="text-base">Booking Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Client</dt>
                <dd className="font-medium mt-0.5">{booking.clientName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Departure</dt>
                <dd className="font-medium mt-0.5">{format(new Date(booking.departureDate), "dd MMM yyyy")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Agent</dt>
                <dd className="font-medium mt-0.5">Agent #{booking.agentId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reimbursements</dt>
                <dd className="font-medium mt-0.5">{booking.reimbursementsRequired ? "Yes" : "No"}</dd>
              </div>
            </dl>

            {booking.reimbursementDocUrl && (
              <div className="flex items-center gap-2 text-sm pt-2 border-t">
                <FileText size={14} style={{ color: '#02E6D2' }} />
                <a href={booking.reimbursementDocUrl} target="_blank" rel="noopener noreferrer"
                  className="underline" style={{ color: '#02E6D2' }}>
                  View reimbursement document
                </a>
                {booking.reimbursementDocLateUpload && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                    Late upload
                  </span>
                )}
              </div>
            )}

            <div className="space-y-3 pt-2 border-t">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Topdog Ref</Label>
                  <Input value={editTopdog} onChange={(e) => setEditTopdog(e.target.value)} placeholder="TD..." className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">PTS Ref</Label>
                  <Input value={editPts} onChange={(e) => setEditPts(e.target.value)} placeholder="PTS..." className="h-8 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    <Calendar size={11} />
                    Final Supplier Payment Date
                    {missingPaymentDate && <span className="text-red-500 ml-1">*</span>}
                  </Label>
                  <Input
                    type="date"
                    value={editPaymentDate}
                    onChange={(e) => setEditPaymentDate(e.target.value)}
                    className={`h-8 text-sm ${missingPaymentDate ? "border-red-400 ring-1 ring-red-300" : ""}`}
                  />
                  {missingPaymentDate && (
                    <p className="text-xs text-red-500">Required before moving to "Added to PTS" or later</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Expected Commission (£)</Label>
                  <Input type="number" value={editCommission} onChange={(e) => setEditCommission(e.target.value)} placeholder="0.00" className="h-8 text-sm" />
                </div>
              </div>
              <Button onClick={handleSaveDetails} disabled={isSavingDetails} size="sm"
                style={{ background: '#70FFE8', color: '#414141' }} className="gap-2">
                {isSavingDetails ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Details
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue="shared">
              <TabsList className="w-full mb-4">
                <TabsTrigger value="shared" className="flex-1">Shared ({sharedNotes.length})</TabsTrigger>
                <TabsTrigger value="internal" className="flex-1">
                  <Lock size={12} className="mr-1" />
                  Internal ({internalNotes.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="shared" className="space-y-3">
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {sharedNotes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No shared notes yet</p>
                  ) : sharedNotes.map((note) => {
                    const isMe = note.authorId === user?.id;
                    return (
                      <div key={note.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                        <div className="max-w-[85%] rounded-2xl px-3 py-2 text-sm"
                          style={{ background: isMe ? '#70FFE8' : '#f3f4f6', color: '#414141' }}>
                          <p className="text-xs font-medium opacity-70 mb-1">{note.authorName}</p>
                          <NoteContent content={note.content} />
                          <p className="text-xs opacity-50 mt-1">{format(new Date(note.createdAt), "dd MMM, HH:mm")}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2 pt-2 border-t">
                  <Textarea value={sharedNote} onChange={(e) => setSharedNote(e.target.value)}
                    placeholder="Shared message (agent can see this)..." className="min-h-[56px] resize-none text-sm"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendNote(false); } }} />
                  <Button onClick={() => handleSendNote(false)} disabled={isSendingShared || !sharedNote.trim()}
                    style={{ background: '#70FFE8', color: '#414141' }} className="self-end">
                    {isSendingShared ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="internal" className="space-y-3">
                <div className="p-2 rounded-lg text-xs flex items-center gap-2 mb-2"
                  style={{ background: '#FFF6ED', color: '#92400e' }}>
                  <Lock size={12} />
                  Internal notes are never visible to agents. Use <AtSign size={11} className="inline mx-0.5" /> to tag a colleague.
                </div>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {internalNotes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No internal notes yet</p>
                  ) : internalNotes.map((note) => (
                    <div key={note.id} className="p-3 rounded-lg border text-sm"
                      style={{ background: '#FFF6ED', borderColor: '#FFC3BC' }}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <User size={11} className="opacity-50" />
                        <p className="text-xs font-medium opacity-70">{note.authorName}</p>
                      </div>
                      <NoteContent content={note.content} />
                      <p className="text-xs opacity-50 mt-1">{format(new Date(note.createdAt), "dd MMM, HH:mm")}</p>
                    </div>
                  ))}
                </div>
                {/* @mention textarea with dropdown */}
                <div className="relative pt-2 border-t">
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Textarea
                        ref={internalTextareaRef}
                        value={internalNote}
                        onChange={handleInternalNoteChange}
                        placeholder="Internal note — type @ to mention a colleague..."
                        className="min-h-[56px] resize-none text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { setMentionDropdownOpen(false); return; }
                          if (e.key === "Enter" && !e.shiftKey && !mentionDropdownOpen) {
                            e.preventDefault();
                            handleSendNote(true);
                          }
                        }}
                        onBlur={() => setTimeout(() => setMentionDropdownOpen(false), 150)}
                      />
                      {/* @mention dropdown */}
                      {mentionDropdownOpen && filteredAdmins.length > 0 && (
                        <div className="absolute bottom-full left-0 mb-1 w-56 rounded-lg border shadow-lg z-50 overflow-hidden"
                          style={{ background: '#fff', borderColor: '#FFC3BC' }}>
                          {filteredAdmins.map((admin) => (
                            <button
                              key={admin.id}
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                              onMouseDown={(e) => { e.preventDefault(); insertMention(admin.name); }}
                            >
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                                style={{ background: '#70FFE8', color: '#414141' }}>
                                {admin.name.charAt(0).toUpperCase()}
                              </div>
                              <span>{admin.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button onClick={() => handleSendNote(true)} disabled={isSendingInternal || !internalNote.trim()}
                      style={{ background: '#FFC3BC', color: '#414141' }} className="self-end">
                      {isSendingInternal ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Payment Date Guard Dialog */}
      <Dialog open={showPaymentDateGuard} onOpenChange={setShowPaymentDateGuard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              Final Supplier Payment Date Required
            </DialogTitle>
            <DialogDescription>
              You must set a Final Supplier Payment Date before moving this booking to <strong>"{pendingStage}"</strong>.
              Enter the date below and click Save &amp; Move to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-sm">Final Supplier Payment Date</Label>
            <Input
              type="date"
              value={editPaymentDate}
              onChange={(e) => setEditPaymentDate(e.target.value)}
              className="h-9"
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowPaymentDateGuard(false); setPendingStage(null); }}>
              Cancel
            </Button>
            <Button
              onClick={handleGuardSaveAndMove}
              disabled={isSavingDetails || !editPaymentDate}
              style={{ background: '#70FFE8', color: '#414141' }}
            >
              {isSavingDetails ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Save &amp; Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
