import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Loader2, Mail } from "lucide-react";

export default function NotificationTemplates() {
  const utils = trpc.useUtils();
  const [editingTemplate, setEditingTemplate] = useState<any | null>(null);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data: templates = [], isLoading } = trpc.notifications.templates.list.useQuery();
  const upsertTemplate = trpc.notifications.templates.update.useMutation({
    onSuccess: () => utils.notifications.templates.invalidate(),
  });

  const openEdit = (t: any) => {
    setEditingTemplate(t);
    setSubject(t.subject);
    setBodyHtml(t.bodyHtml);
  };

  const handleSave = async () => {
    if (!editingTemplate) return;
    setIsSaving(true);
    try {
      await upsertTemplate.mutateAsync({
        triggerKey: editingTemplate.triggerKey,
        label: editingTemplate.label,
        subject,
        bodyHtml,
        recipientType: editingTemplate.recipientType,
      });
      toast.success("Template saved");
      setEditingTemplate(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to save template");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Notification Templates</h1>
        <p className="text-sm text-muted-foreground">
          Edit the email templates sent automatically when booking stages change.
          Available variables: <code className="text-xs bg-muted px-1 rounded">{"{{agentName}}"}</code>{" "}
          <code className="text-xs bg-muted px-1 rounded">{"{{clientName}}"}</code>{" "}
          <code className="text-xs bg-muted px-1 rounded">{"{{bookingId}}"}</code>
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#70FFE8' }} />
        </div>
      ) : (
        <div className="grid gap-4">
          {(templates as any[]).map((t) => (
            <Card key={t.id ?? t.triggerKey}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Mail size={14} style={{ color: '#02E6D2' }} />
                      <span className="font-semibold text-sm">{t.label}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full ml-2"
                        style={{ background: t.recipientType === 'agent' ? '#70FFE8' : '#FFC3BC', color: '#414141' }}>
                        → {t.recipientType}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">Subject: {t.subject}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 font-mono"
                      dangerouslySetInnerHTML={{ __html: t.bodyHtml.replace(/<[^>]+>/g, ' ').trim().slice(0, 120) + '...' }} />
                  </div>
                  <Button variant="outline" size="sm" className="gap-1 flex-shrink-0" onClick={() => openEdit(t)}>
                    <Pencil size={12} />Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {templates.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No templates found</p>
          )}
        </div>
      )}

      <Dialog open={!!editingTemplate} onOpenChange={() => setEditingTemplate(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Template: {editingTemplate?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="p-3 rounded-lg text-xs" style={{ background: '#FFF6ED', color: '#92400e' }}>
              Available variables: <strong>{"{{agentName}}"}</strong>, <strong>{"{{clientName}}"}</strong>, <strong>{"{{bookingId}}"}</strong>
            </div>
            <div className="space-y-2">
              <Label>Email Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line..." />
            </div>
            <div className="space-y-2">
              <Label>Email Body (HTML)</Label>
              <Textarea
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                className="min-h-[200px] font-mono text-xs"
                placeholder="<p>Hi {{agentName}},</p>..."
              />
            </div>
            {bodyHtml && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Preview</Label>
                <div className="p-4 rounded-lg border bg-white text-sm"
                  dangerouslySetInnerHTML={{
                    __html: bodyHtml
                      .replace(/\{\{agentName\}\}/g, "Jane Smith")
                      .replace(/\{\{clientName\}\}/g, "John Doe")
                      .replace(/\{\{bookingId\}\}/g, "42")
                  }} />
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <Button onClick={handleSave} disabled={isSaving} style={{ background: '#70FFE8', color: '#414141' }} className="font-semibold">
                {isSaving ? <><Loader2 size={14} className="animate-spin mr-2" />Saving...</> : "Save Template"}
              </Button>
              <Button variant="outline" onClick={() => setEditingTemplate(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
