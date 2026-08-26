import { useState } from "react";
import { format } from "date-fns";
import { MessageCircle, Send, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function AmendmentMessageThread({ amendmentId, bookingId, compact = false }: { amendmentId: number; bookingId: number; compact?: boolean }) {
  const utils = trpc.useUtils();
  const { data: messages = [] } = trpc.notes.byAmendment.useQuery({ amendmentId });
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const sendMessage = trpc.notes.add.useMutation({
    onSuccess: async () => {
      setContent("");
      setOpen(false);
      await Promise.all([
        utils.notes.byAmendment.invalidate({ amendmentId }),
        utils.notes.list.invalidate({ bookingId }),
        utils.notes.allThreads.invalidate(),
      ]);
      toast.success("Message sent to the agent and added to the booking Messages thread");
    },
    onError: (error) => toast.error(error.message || "Unable to send amendment message"),
  });

  const handleSend = () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    sendMessage.mutate({ bookingId, amendmentId, content: trimmed, isInternal: false });
  };

  return (
    <div className={compact ? "space-y-1.5" : "rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-2"}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-violet-900">
          <MessageCircle className="h-3.5 w-3.5" /> Amendment messages{messages.length > 0 ? ` (${messages.length})` : ""}
        </span>
        <Button type="button" size="sm" variant="outline" className="h-7 border-violet-300 bg-white px-2 text-xs text-violet-800 hover:bg-violet-100" onClick={() => setOpen(true)}>
          <Send className="mr-1 h-3 w-3" /> Message agent
        </Button>
      </div>
      {messages.length > 0 ? (
        <div className="space-y-1.5 border-l-2 border-violet-200 pl-2.5">
          {(messages as any[]).map((message) => (
            <div key={message.id} className="text-xs">
              <p className="font-medium text-foreground">{message.authorName}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{message.content}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{format(new Date(message.createdAt), "d MMM yyyy, HH:mm")}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No direct amendment messages have been sent yet.</p>
      )}

      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setContent(""); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-violet-600" /> Message agent about this amendment</DialogTitle>
            <DialogDescription>This sends the agent an email and in-portal notification. It will also appear in the booking’s shared Messages thread and in this amendment’s communication trail.</DialogDescription>
          </DialogHeader>
          <Textarea autoFocus value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write your message to the agent…" className="min-h-32" maxLength={5000} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={sendMessage.isPending}>Cancel</Button>
            <Button onClick={handleSend} disabled={sendMessage.isPending || !content.trim()}>
              {sendMessage.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
              Send message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
