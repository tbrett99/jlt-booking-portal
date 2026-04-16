import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Send, Eye, Pencil } from "lucide-react";

const SEGMENT_LABELS: Record<string, string> = {
  all_agents: "All Agents",
  all_prospects: "All Prospects",
  all_contacts: "All Contacts (Agents + Prospects)",
  won_prospects: "Won Prospects Only",
  custom: "Custom",
};

const statusColor: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sending: "bg-blue-100 text-blue-700",
  sent: "bg-green-100 text-green-700",
};

export default function CrmCampaigns() {
  const [createDialog, setCreateDialog] = useState(false);
  const [editDialog, setEditDialog] = useState<any>(null);
  const [previewDialog, setPreviewDialog] = useState<any>(null);
  const [sendConfirm, setSendConfirm] = useState<any>(null);
  const [form, setForm] = useState({ name: "", subject: "", bodyHtml: "", segmentType: "all_agents" as const });

  const { data: campaigns = [], refetch } = trpc.crm.campaigns.list.useQuery();
  const createCampaign = trpc.crm.campaigns.create.useMutation({
    onSuccess: () => { refetch(); setCreateDialog(false); setForm({ name: "", subject: "", bodyHtml: "", segmentType: "all_agents" }); toast.success("Campaign created"); },
    onError: (e) => toast.error(e.message),
  });
  const updateCampaign = trpc.crm.campaigns.update.useMutation({
    onSuccess: () => { refetch(); setEditDialog(null); toast.success("Campaign updated"); },
    onError: (e) => toast.error(e.message),
  });
  const sendCampaign = trpc.crm.campaigns.send.useMutation({
    onSuccess: (data) => { refetch(); setSendConfirm(null); toast.success(`Campaign sent to ${data.sentCount} recipients`); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Email Campaigns</h1>
          <p className="text-sm text-muted-foreground">Send business updates to agents and prospects (up to 500 recipients)</p>
        </div>
        <Button size="sm" onClick={() => setCreateDialog(true)}><Plus size={14} className="mr-1" />New Campaign</Button>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
        <strong>Note:</strong> Emails are sent via SMTP. For best deliverability, ensure your domain's SPF/DKIM records are configured. Campaigns are capped at 500 recipients.
      </div>

      {/* Campaign list */}
      <div className="space-y-3">
        {(campaigns as any[]).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg">
            <p className="font-medium">No campaigns yet</p>
            <p className="text-sm">Create your first email campaign to get started.</p>
          </div>
        ) : (campaigns as any[]).map((c: any) => (
          <Card key={c.id}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{c.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[c.status] ?? "bg-gray-100 text-gray-600"}`}>{c.status}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">Subject: {c.subject}</p>
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                    <span>Segment: {SEGMENT_LABELS[c.segmentType] ?? c.segmentType}</span>
                    {c.sentAt && <span>Sent: {new Date(c.sentAt).toLocaleDateString("en-GB")}</span>}
                    {c.sentCount > 0 && <span>{c.sentCount} recipients</span>}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setPreviewDialog(c)}><Eye size={13} className="mr-1" />Preview</Button>
                  {c.status === "draft" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setEditDialog({ ...c })}><Pencil size={13} className="mr-1" />Edit</Button>
                      <Button size="sm" onClick={() => setSendConfirm(c)}><Send size={13} className="mr-1" />Send</Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Email Campaign</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Campaign Name</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. April Business Update" />
              </div>
              <div className="space-y-1.5">
                <Label>Recipients</Label>
                <Select value={form.segmentType} onValueChange={(v) => setForm((f) => ({ ...f, segmentType: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SEGMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email Subject</Label>
              <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="e.g. Important update from JLT Group" />
            </div>
            <div className="space-y-1.5">
              <Label>Email Body (HTML)</Label>
              <Textarea rows={10} value={form.bodyHtml} onChange={(e) => setForm((f) => ({ ...f, bodyHtml: e.target.value }))} placeholder="<p>Dear Agent,</p><p>We have an exciting update...</p>" className="font-mono text-sm" />
              <p className="text-xs text-muted-foreground">You can use HTML to format your email. Keep it simple for best compatibility.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(false)}>Cancel</Button>
            <Button onClick={() => createCampaign.mutate(form)} disabled={createCampaign.isPending || !form.name || !form.subject || !form.bodyHtml}>
              {createCampaign.isPending ? "Creating…" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit Campaign</DialogTitle></DialogHeader>
          {editDialog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Campaign Name</Label>
                  <Input value={editDialog.name} onChange={(e) => setEditDialog((d: any) => ({ ...d, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Recipients</Label>
                  <Select value={editDialog.segmentType} onValueChange={(v) => setEditDialog((d: any) => ({ ...d, segmentType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SEGMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Email Subject</Label>
                <Input value={editDialog.subject} onChange={(e) => setEditDialog((d: any) => ({ ...d, subject: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Email Body (HTML)</Label>
                <Textarea rows={10} value={editDialog.bodyHtml} onChange={(e) => setEditDialog((d: any) => ({ ...d, bodyHtml: e.target.value }))} className="font-mono text-sm" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>Cancel</Button>
            <Button onClick={() => updateCampaign.mutate({ id: editDialog.id, name: editDialog.name, subject: editDialog.subject, bodyHtml: editDialog.bodyHtml, segmentType: editDialog.segmentType })} disabled={updateCampaign.isPending}>
              {updateCampaign.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!previewDialog} onOpenChange={() => setPreviewDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Preview — {previewDialog?.name}</DialogTitle></DialogHeader>
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-4 py-2 border-b text-sm">
              <span className="text-muted-foreground">Subject: </span><span className="font-medium">{previewDialog?.subject}</span>
            </div>
            <div className="p-4 max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{ __html: previewDialog?.bodyHtml ?? "" }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send confirm dialog */}
      <Dialog open={!!sendConfirm} onOpenChange={() => setSendConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send Campaign</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            You are about to send <strong>"{sendConfirm?.name}"</strong> to all <strong>{SEGMENT_LABELS[sendConfirm?.segmentType] ?? sendConfirm?.segmentType}</strong>. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendConfirm(null)}>Cancel</Button>
            <Button onClick={() => sendCampaign.mutate({ id: sendConfirm.id })} disabled={sendCampaign.isPending}>
              {sendCampaign.isPending ? "Sending…" : "Yes, Send Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
