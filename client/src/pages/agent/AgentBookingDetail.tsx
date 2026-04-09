import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft, Send, Upload, FileText, Loader2, Calendar,
  CheckCircle2, Circle, AlertCircle, Sparkles, TrendingUp, Clock
} from "lucide-react";
import { format, differenceInDays, isPast } from "date-fns";
import { useAuth } from "@/_core/hooks/useAuth";

// The visible pipeline stages for agents (simplified)
const PIPELINE_STEPS = [
  { stage: "New Booking",            label: "Registered" },
  { stage: "Creating own PTS file",  label: "PTS File" },
  { stage: "Added to PTS",           label: "Added to PTS" },
  { stage: "Commission Claimable",   label: "Commission Ready" },
  { stage: "Commission Claimed",     label: "Claimed" },
];

const STAGE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  "New Booking":           { label: "New",                  color: "#414141", bg: "#FFF6ED" },
  "Creating own PTS file": { label: "Creating PTS",         color: "#414141", bg: "#e0e7ff" },
  "Not on Topdog":         { label: "Not on Topdog",        color: "#92400e", bg: "#fef3c7" },
  "Query":                 { label: "Query — Action Needed",color: "#92400e", bg: "#fef9c3" },
  "Reimb Docs Missing":    { label: "Docs Missing",         color: "#991b1b", bg: "#fee2e2" },
  "Urgent/Reimb":          { label: "Urgent",               color: "#991b1b", bg: "#fecaca" },
  "T/O Package":           { label: "T/O Package",          color: "#5b21b6", bg: "#ede9fe" },
  "DP":                    { label: "DP",                   color: "#9d174d", bg: "#fce7f3" },
  "Added to PTS":          { label: "Added to PTS",         color: "#065f46", bg: "#d1fae5" },
  "Commission Claimable":  { label: "Commission Ready",     color: "#065f46", bg: "#70FFE8" },
  "Commission Claimed":    { label: "Commission Claimed",   color: "#064e3b", bg: "#a7f3d0" },
  "Cancelled":             { label: "Cancelled",            color: "#6b7280", bg: "#f3f4f6" },
  "Holding Accounts":      { label: "Holding",              color: "#92400e", bg: "#fef3c7" },
};

const ATTENTION_STAGES = new Set(["Query", "Reimb Docs Missing", "Urgent/Reimb", "Not on Topdog"]);

function getPipelineProgress(currentStage: string): number {
  const idx = PIPELINE_STEPS.findIndex((s) => s.stage === currentStage);
  if (idx >= 0) return idx;
  // Intermediate stages map to step 1 (between registered and added to PTS)
  return 1;
}

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
      toast.success("Message sent");
    } catch (err: any) {
      toast.error(err.message || "Failed to send message");
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
      toast.success(result.isLate ? "Document uploaded — the JLT team has been notified" : "Document uploaded successfully");
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
  const needsAction = ATTENTION_STAGES.has(booking.currentStage);
  const isCommissionReady = booking.currentStage === "Commission Claimable";
  const sharedNotes = notes.filter(n => !n.isInternal);

  const daysUntilDeparture = differenceInDays(new Date(booking.departureDate), new Date());
  const departed = isPast(new Date(booking.departureDate));

  const pipelineStep = getPipelineProgress(booking.currentStage);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft size={16} />My Bookings</Button>
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

      {/* Attention banner */}
      {needsAction && (
        <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
          style={{ borderLeftColor: '#f97316', background: '#fff7ed' }}>
          <AlertCircle size={18} style={{ color: '#f97316' }} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm" style={{ color: '#92400e' }}>Action required on this booking</p>
            <p className="text-xs mt-0.5" style={{ color: '#92400e', opacity: 0.8 }}>
              This booking is in <strong>{booking.currentStage}</strong> status. Please check the messages below for details from the JLT team.
            </p>
          </div>
        </div>
      )}

      {/* Commission ready banner */}
      {isCommissionReady && (
        <div className="rounded-xl border-l-4 p-4 flex items-center gap-3"
          style={{ borderLeftColor: '#02E6D2', background: '#ecfdf5' }}>
          <Sparkles size={18} style={{ color: '#02E6D2' }} className="flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-sm" style={{ color: '#065f46' }}>Your commission is ready to claim!</p>
            <p className="text-xs mt-0.5 opacity-70" style={{ color: '#065f46' }}>Head to My Commissions to submit your claim.</p>
          </div>
          <Link href="/commissions">
            <Button size="sm" style={{ background: '#70FFE8', color: '#414141' }} className="flex-shrink-0">
              Claim Now
            </Button>
          </Link>
        </div>
      )}

      {/* Pipeline progress */}
      {!isCancelled && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Booking Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-0">
              {PIPELINE_STEPS.map((step, idx) => {
                const isCompleted = idx < pipelineStep;
                const isCurrent = idx === pipelineStep;
                const isLast = idx === PIPELINE_STEPS.length - 1;
                return (
                  <div key={step.stage} className="flex items-center flex-1 min-w-0">
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all ${
                        isCompleted ? "border-[#02E6D2]" : isCurrent ? "border-[#70FFE8]" : "border-muted"
                      }`}
                        style={{
                          background: isCompleted ? '#02E6D2' : isCurrent ? '#70FFE8' : 'transparent',
                        }}>
                        {isCompleted ? (
                          <CheckCircle2 size={14} style={{ color: 'white' }} />
                        ) : isCurrent ? (
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#414141' }} />
                        ) : (
                          <Circle size={14} className="text-muted-foreground" />
                        )}
                      </div>
                      <span className={`text-[10px] text-center leading-tight max-w-[60px] ${
                        isCurrent ? "font-semibold" : "text-muted-foreground"
                      }`}>
                        {step.label}
                      </span>
                    </div>
                    {!isLast && (
                      <div className="flex-1 h-0.5 mx-1 mb-4"
                        style={{ background: isCompleted ? '#02E6D2' : '#e5e7eb' }} />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key info cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl p-3 border" style={{ background: '#FFF6ED' }}>
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Calendar size={11} /> Departure
          </p>
          <p className="font-semibold text-sm">{format(new Date(booking.departureDate), "dd MMM yyyy")}</p>
          <p className="text-xs mt-0.5" style={{ color: departed ? '#9ca3af' : daysUntilDeparture <= 30 ? '#f97316' : '#02E6D2' }}>
            {departed ? "Departed" : `${daysUntilDeparture} days away`}
          </p>
        </div>

        <div className="rounded-xl p-3 border" style={{ background: '#f9fafb' }}>
          <p className="text-xs text-muted-foreground mb-1">Topdog Ref</p>
          <p className="font-semibold text-sm truncate">
            {booking.topdogRef ?? <span className="italic text-muted-foreground font-normal">Not set</span>}
          </p>
        </div>

        <div className="rounded-xl p-3 border" style={{ background: '#f9fafb' }}>
          <p className="text-xs text-muted-foreground mb-1">PTS Ref</p>
          <p className="font-semibold text-sm truncate">
            {booking.ptsRef ?? <span className="italic text-muted-foreground font-normal">Not set</span>}
          </p>
        </div>

        <div className="rounded-xl p-3 border" style={{ background: booking.expectedCommission ? '#ecfdf5' : '#f9fafb' }}>
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <TrendingUp size={11} /> Commission
          </p>
          <p className="font-semibold text-sm" style={{ color: booking.expectedCommission ? '#065f46' : undefined }}>
            {booking.expectedCommission
              ? `£${Number(booking.expectedCommission).toFixed(2)}`
              : <span className="italic text-muted-foreground font-normal">Not set</span>}
          </p>
        </div>
      </div>

      {/* Reimbursement doc */}
      {booking.reimbursementsRequired && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Reimbursement Document</CardTitle>
          </CardHeader>
          <CardContent>
            {booking.reimbursementDocUrl ? (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 size={16} style={{ color: '#02E6D2' }} />
                <a href={booking.reimbursementDocUrl} target="_blank" rel="noopener noreferrer"
                  className="underline font-medium" style={{ color: '#02E6D2' }}>
                  View uploaded document
                </a>
                {booking.reimbursementDocLateUpload && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                    Late upload
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">Document not yet uploaded</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Please upload your reimbursement document as soon as possible.</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={isUploadingDoc}
                  className="gap-2 flex-shrink-0"
                >
                  {isUploadingDoc ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Upload
                </Button>
                <input ref={fileRef} type="file" className="hidden" onChange={handleDocUpload}
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {!isCancelled && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href={`/bookings/${bookingId}/amend`}>
              <Button variant="outline" size="sm">Request Amendment</Button>
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

      {/* Messages */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Messages with JLT Team</CardTitle>
          <p className="text-xs text-muted-foreground">All messages are visible to both you and the JLT team</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {sharedNotes.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No messages yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Start the conversation with the JLT team below.</p>
              </div>
            ) : (
              sharedNotes.map((note) => {
                const isMe = note.authorId === user?.id;
                return (
                  <div key={note.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${isMe ? "rounded-br-sm" : "rounded-bl-sm"}`}
                      style={{ background: isMe ? '#70FFE8' : '#f3f4f6', color: '#414141' }}>
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
              placeholder="Type a message to the JLT team..."
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="min-h-[60px] resize-none text-sm"
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
