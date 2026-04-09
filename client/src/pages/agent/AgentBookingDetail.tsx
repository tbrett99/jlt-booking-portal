import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Send, Upload, FileText, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/_core/hooks/useAuth";

const STAGE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  "New Booking": { label: "New", color: "#414141", bg: "#FFF6ED" },
  "Added to PTS": { label: "Added to PTS", color: "#065f46", bg: "#d1fae5" },
  "Commission Claimable": { label: "Commission Ready", color: "#065f46", bg: "#70FFE8" },
  "Commission Claimed": { label: "Claimed", color: "#064e3b", bg: "#a7f3d0" },
  "Cancelled": { label: "Cancelled", color: "#6b7280", bg: "#f3f4f6" },
  "Query": { label: "Query", color: "#92400e", bg: "#fef9c3" },
  "Not on Topdog": { label: "Not on Topdog", color: "#92400e", bg: "#fef3c7" },
  "Reimb Docs Missing": { label: "Docs Missing", color: "#991b1b", bg: "#fee2e2" },
};

export default function AgentBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const bookingId = Number(id);
  const { user } = useAuth();
  const [noteContent, setNoteContent] = useState("");
  const [isSendingNote, setIsSendingNote] = useState(false);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: booking, isLoading } = trpc.bookings.byId.useQuery({ id: bookingId });
  const { data: notes = [], refetch: refetchNotes } = trpc.notes.list.useQuery({ bookingId });
  const addNote = trpc.notes.add.useMutation();
  const uploadDoc = trpc.bookings.uploadReimbDoc.useMutation();

  const handleSendNote = async () => {
    if (!noteContent.trim()) return;
    setIsSendingNote(true);
    try {
      await addNote.mutateAsync({ bookingId, content: noteContent, isInternal: false });
      setNoteContent("");
      await refetchNotes();
      toast.success("Note sent");
    } catch (err: any) {
      toast.error(err.message || "Failed to send note");
    } finally {
      setIsSendingNote(false);
    }
  };

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("File must be under 10MB"); return; }
    setIsUploadingDoc(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const base64 = btoa(Array.from(uint8).map(b => String.fromCharCode(b)).join(''));
      const result = await uploadDoc.mutateAsync({
        bookingId,
        fileBase64: base64,
        fileName: file.name,
        mimeType: file.type,
      });
      await utils.bookings.byId.invalidate({ id: bookingId });
      toast.success(result.isLate ? "Document uploaded (admin has been notified)" : "Document uploaded successfully");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setIsUploadingDoc(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin" size={32} style={{ color: '#70FFE8' }} />
      </div>
    );
  }

  if (!booking) {
    return <div className="text-center py-20 text-muted-foreground">Booking not found.</div>;
  }

  const badge = STAGE_BADGE[booking.currentStage] ?? { label: booking.currentStage, color: "#414141", bg: "#f3f4f6" };
  const isCancelled = booking.currentStage === "Cancelled";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft size={16} />Back</Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{booking.clientName}</h1>
          <p className="text-sm text-muted-foreground">Booking #{booking.id}</p>
        </div>
        <span className="px-3 py-1 rounded-full text-sm font-medium flex-shrink-0"
          style={{ background: badge.bg, color: badge.color }}>
          {badge.label}
        </span>
      </div>

      {/* Details */}
      <Card>
        <CardHeader><CardTitle className="text-base">Booking Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Client Name</dt>
              <dd className="font-medium mt-0.5">{booking.clientName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Departure Date</dt>
              <dd className="font-medium mt-0.5">{format(new Date(booking.departureDate), "dd MMM yyyy")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Topdog Reference</dt>
              <dd className="font-medium mt-0.5">{booking.topdogRef ?? <span className="italic text-muted-foreground">Not set</span>}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">PTS Reference</dt>
              <dd className="font-medium mt-0.5">{booking.ptsRef ?? <span className="italic text-muted-foreground">Not set</span>}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Reimbursements</dt>
              <dd className="font-medium mt-0.5">{booking.reimbursementsRequired ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Expected Commission</dt>
              <dd className="font-medium mt-0.5">
                {booking.expectedCommission ? `£${Number(booking.expectedCommission).toFixed(2)}` : <span className="italic text-muted-foreground">Not set</span>}
              </dd>
            </div>
          </dl>

          {/* Reimbursement doc upload */}
          {booking.reimbursementsRequired && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm font-medium mb-2">Reimbursement Document</p>
              {booking.reimbursementDocUrl ? (
                <div className="flex items-center gap-2 text-sm">
                  <FileText size={16} style={{ color: '#02E6D2' }} />
                  <a href={booking.reimbursementDocUrl} target="_blank" rel="noopener noreferrer"
                    className="underline" style={{ color: '#02E6D2' }}>
                    View uploaded document
                  </a>
                  {booking.reimbursementDocLateUpload && (
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                      Late upload
                    </span>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">No document uploaded yet.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={isUploadingDoc}
                    className="gap-2"
                  >
                    {isUploadingDoc ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Upload Document
                  </Button>
                  <input ref={fileRef} type="file" className="hidden" onChange={handleDocUpload}
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      {!isCancelled && (
        <Card>
          <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Link href={`/bookings/${bookingId}/amend`}>
              <Button variant="outline" size="sm">Submit Amendment</Button>
            </Link>
            <Link href={`/bookings/${bookingId}/refund`}>
              <Button variant="outline" size="sm">Request Refund</Button>
            </Link>
            <Link href={`/bookings/${bookingId}/cancel`}>
              <Button variant="outline" size="sm" className="text-destructive border-destructive hover:bg-destructive/10">
                Cancel Booking
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Shared Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Messages</CardTitle>
          <p className="text-xs text-muted-foreground">Communicate with the JLT team about this booking</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {notes.filter(n => !n.isInternal).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No messages yet. Start the conversation below.</p>
            ) : (
              notes.filter(n => !n.isInternal).map((note) => {
                const isMe = note.authorId === user?.id;
                return (
                  <div key={note.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${isMe ? "rounded-br-sm" : "rounded-bl-sm"}`}
                      style={{
                        background: isMe ? '#70FFE8' : '#f3f4f6',
                        color: '#414141'
                      }}>
                      <p className="font-medium text-xs mb-1 opacity-70">{note.authorName}</p>
                      <p className="whitespace-pre-wrap">{note.content}</p>
                      <p className="text-xs opacity-50 mt-1 text-right">
                        {format(new Date(note.createdAt), "dd MMM, HH:mm")}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <Textarea
              placeholder="Type a message..."
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="min-h-[60px] resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendNote();
                }
              }}
            />
            <Button
              onClick={handleSendNote}
              disabled={isSendingNote || !noteContent.trim()}
              style={{ background: '#70FFE8', color: '#414141' }}
              className="self-end"
            >
              {isSendingNote ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
