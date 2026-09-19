import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ReimbursementTarget = {
  id: number;
  supplierName: string;
  clientName?: string | null;
};

type Props = {
  open: boolean;
  target: ReimbursementTarget | null;
  isPending?: boolean;
  onClose: () => void;
  onSubmit: (input: { note: string; nextFollowUpAt?: Date }) => void;
};

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

export function ReimbursementAwaitingAgentDialog({
  open,
  target,
  isPending = false,
  onClose,
  onSubmit,
}: Props) {
  const [note, setNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState(() => dateInputValue(3));

  useEffect(() => {
    if (!open) return;
    setNote("");
    setFollowUpDate(dateInputValue(3));
  }, [open, target?.id]);

  const valid = note.trim().length >= 3 && !!followUpDate;
  const subject = target?.clientName ? `${target.clientName} — ${target.supplierName}` : target?.supplierName;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Awaiting information from agent</DialogTitle>
          <DialogDescription>
            Send one clear request to the agent. The same text is sent to their booking Messages thread and recorded in the reimbursement list and activity history.
          </DialogDescription>
        </DialogHeader>
        {subject && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">{subject}</p>
        )}
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="reimbursement-chase-note">
              What has been requested? <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="reimbursement-chase-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="For example: Please upload the supplier invoice showing the client name and amount paid, plus cleared payment evidence."
              rows={5}
              maxLength={3000}
              className="resize-y"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">The agent will receive this request in the booking Messages thread, as an in-portal notification, and by email. Your internal reimbursement activity record keeps the same request and follow-up date.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reimbursement-follow-up">Next follow-up date <span className="text-red-500">*</span></Label>
            <Input
              id="reimbursement-follow-up"
              type="date"
              min={dateInputValue(0)}
              value={followUpDate}
              onChange={(event) => setFollowUpDate(event.target.value)}
              className="max-w-52"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            type="button"
            disabled={!valid || isPending}
            className="bg-amber-600 text-white hover:bg-amber-700"
            onClick={() => onSubmit({
              note: note.trim(),
              nextFollowUpAt: new Date(`${followUpDate}T12:00:00`),
            })}
          >
            {isPending ? "Sending…" : "Send request & set Awaiting agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
