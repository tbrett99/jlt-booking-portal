import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ArrowLeft, Send, Lock, FileText, Loader2, Save } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/_core/hooks/useAuth";

const STAGES = [
  "New Booking", "Creating own PTS file", "Not on Topdog", "Query",
  "Reimb Docs Missing", "Urgent/Reimb", "T/O Package", "DP",
  "Added to PTS", "Commission Claimable", "Commission Claimed",
  "Cancelled", "Holding Accounts",
];

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

  const { data: booking, isLoading } = trpc.bookings.byId.useQuery({ id: bookingId });

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
  const refetchShared = refetchNotes;
  const refetchInternal = refetchNotes;
  const addNote = trpc.notes.add.useMutation();
  const updateDetails = trpc.bookings.updateAdminFields.useMutation();
  const moveStage = trpc.bookings.moveStage.useMutation({
    onSuccess: () => utils.bookings.byId.invalidate({ id: bookingId }),
  });

  const handleSendNote = async (isInternal: boolean) => {
    const content = isInternal ? internalNote : sharedNote;
    if (!content.trim()) return;
    if (isInternal) setIsSendingInternal(true); else setIsSendingShared(true);
    try {
      await addNote.mutateAsync({ bookingId, content, isInternal });
      if (isInternal) { setInternalNote(""); await refetchInternal(); }
      else { setSharedNote(""); await refetchShared(); }
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/pipeline">
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft size={16} />Pipeline</Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{booking.clientName}</h1>
          <p className="text-sm text-muted-foreground">Booking #{booking.id}</p>
        </div>
        {/* Stage selector */}
        <Select
          value={booking.currentStage}
          onValueChange={(val) => moveStage.mutate({ bookingId, toStage: val })}
        >
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
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
                  <Label className="text-xs">Payment Date</Label>
                  <Input type="date" value={editPaymentDate} onChange={(e) => setEditPaymentDate(e.target.value)} className="h-8 text-sm" />
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
                          <p className="whitespace-pre-wrap">{note.content}</p>
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
                  Internal notes are never visible to agents
                </div>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {internalNotes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No internal notes yet</p>
                  ) : internalNotes.map((note) => (
                    <div key={note.id} className="p-3 rounded-lg border text-sm"
                      style={{ background: '#FFF6ED', borderColor: '#FFC3BC' }}>
                      <p className="text-xs font-medium opacity-70 mb-1">{note.authorName}</p>
                      <p className="whitespace-pre-wrap">{note.content}</p>
                      <p className="text-xs opacity-50 mt-1">{format(new Date(note.createdAt), "dd MMM, HH:mm")}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2 border-t">
                  <Textarea value={internalNote} onChange={(e) => setInternalNote(e.target.value)}
                    placeholder="Internal note (admin only)..." className="min-h-[56px] resize-none text-sm"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendNote(true); } }} />
                  <Button onClick={() => handleSendNote(true)} disabled={isSendingInternal || !internalNote.trim()}
                    style={{ background: '#FFC3BC', color: '#414141' }} className="self-end">
                    {isSendingInternal ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
