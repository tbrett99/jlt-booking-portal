import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Mail, RefreshCw, Send, Eye, Loader2, CheckCircle2, Clock,
  Award, BookOpen,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function WeeklyDigestAdmin() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [testEmailOpen, setTestEmailOpen] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const [customIntro, setCustomIntro] = useState("");

  // Stable week start — most recent Friday (Fri–Fri window, digest sent every Friday)
  const weekStart = useMemo(() => {
    const d = new Date();
    const day = d.getDay(); // 0=Sun,1=Mon,...,5=Fri,6=Sat
    // Days since last Friday: Fri=0, Sat=1, Sun=2, Mon=3, Tue=4, Wed=5, Thu=6
    const daysSinceFriday = (day + 2) % 7;
    d.setDate(d.getDate() - daysSinceFriday);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const createDraft = trpc.community.digest.getOrCreateDraft.useMutation();
  const { data: digests, isLoading: digestsLoading, refetch: refetchDigests } = trpc.community.digest.list.useQuery();

  // Match using weekStarting (the correct DB field name)
  const draft = digests?.find((d: any) => {
    const dStart = new Date(d.weekStarting);
    return dStart.toDateString() === weekStart.toDateString();
  });

  const sendTest = trpc.community.digest.sendTest.useMutation({
    onSuccess: () => {
      toast.success(`Test email sent to ${testEmailAddress}`);
      setTestEmailOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSendTest = async () => {
    if (!draft || !testEmailAddress) return;
    await sendTest.mutateAsync({
      digestId: draft.id,
      origin: window.location.origin,
      toEmail: testEmailAddress,
      customSubject: customSubject || undefined,
      customIntro: customIntro || undefined,
    });
  };

  const sendDigest = trpc.community.digest.send.useMutation({
    onSuccess: (result: any) => {
      toast.success(`Digest sent to ${result.sentCount ?? result.sent ?? 0} agents`);
      setSendConfirmOpen(false);
      refetchDigests();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleCreateOrRefresh = async () => {
    try {
      await createDraft.mutateAsync({ weekStarting: weekStart });
      refetchDigests();
      toast.success("Digest draft ready");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate digest");
    }
  };

  const stats = draft?.statsSnapshot as any;
  const highlightsRaw = draft?.bookingHighlightsOverride as any;
  // Backend stores a structured object { firstBookings, highMargin, commissionClaimed }
  const highlights = highlightsRaw && typeof highlightsRaw === 'object' && !Array.isArray(highlightsRaw)
    ? highlightsRaw
    : null;
  const highlightItems: { emoji: string; message: string }[] = [];
  if (highlights) {
    for (const h of highlights.firstBookings ?? []) {
      highlightItems.push({ emoji: '🎉', message: `${h.agentName} registered their first ever booking — welcome to the journey!` });
    }
    for (const h of highlights.highMargin ?? []) {
      highlightItems.push({ emoji: '💰', message: `${h.agentName} secured a high-margin booking this week — great work!` });
    }
    if ((highlights.commissionClaimed?.agentNames?.length ?? 0) > 0) {
      const names = highlights.commissionClaimed.agentNames.join(', ');
      const total = Number(highlights.commissionClaimed.totalAmount ?? 0);
      highlightItems.push({ emoji: '🏆', message: `Commission paid out to ${names} — total: £${total.toLocaleString('en-GB', { maximumFractionDigits: 0 })}` });
    }
  }
  const includedPostIds: number[] = Array.isArray(draft?.includedPostIds)
    ? (draft.includedPostIds as number[])
    : [];

  if (digestsLoading) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Weekly Digest</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Review and send the weekly community digest to all active agents
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleCreateOrRefresh}
          disabled={createDraft.isPending}
        >
          {createDraft.isPending
            ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            : <RefreshCw className="w-4 h-4 mr-2" />}
          {draft ? "Regenerate" : "Generate Draft"}
        </Button>
      </div>

      {!draft ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No digest draft for this week</p>
          <p className="text-sm mt-1">Click "Generate Draft" to create this week's digest</p>
        </div>
      ) : (
        <>
          {/* Status banner */}
          {draft.status === "sent" && (
            <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" />
              This week's digest was sent to {(draft as any).recipientCount ?? 0} agents
              {(draft as any).sentAt && ` on ${new Date((draft as any).sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
            </div>
          )}

          {/* Stats block */}
          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-card border border-border rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{stats.bookingsThisWeek ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Bookings this week</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-foreground">
                  {stats.totalCommissionClaimed
                    ? `£${Number(stats.totalCommissionClaimed).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    : "£0"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Commission claimed</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{stats.reimbursementsCount ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Reimbursements</p>
              </div>
            </div>
          )}

          {/* Agent highlights */}
          {highlightItems.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="font-semibold text-sm text-foreground mb-3 flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-500" /> Agent Highlights
              </h3>
              <div className="space-y-2">
                {highlightItems.map((h, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm">
                    <span className="text-base">{h.emoji}</span>
                    <span className="text-foreground">{h.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Included posts count */}
          {includedPostIds.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" />
                {includedPostIds.length} post{includedPostIds.length !== 1 ? "s" : ""} included from this week
              </h3>
            </div>
          )}

          {/* Customisation */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-sm text-foreground">Customise (optional)</h3>
            <div className="space-y-1.5">
              <Label className="text-xs">Custom subject line</Label>
              <Input
                placeholder={`JLT Weekly Digest — ${weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`}
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Personal intro message (optional)</Label>
              <Textarea
                placeholder="Add a personal message from the team..."
                value={customIntro}
                onChange={(e) => setCustomIntro(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          {/* Actions */}
          {draft.status !== "sent" && (
            <div className="flex gap-3 flex-wrap">
              <Button variant="outline" onClick={() => setPreviewOpen(true)} className="flex-1">
                <Eye className="w-4 h-4 mr-2" /> Preview
              </Button>
              <Button variant="outline" onClick={() => setTestEmailOpen(true)} className="flex-1">
                <Mail className="w-4 h-4 mr-2" /> Send Test Email
              </Button>
              <Button onClick={() => setSendConfirmOpen(true)} className="flex-1">
                <Send className="w-4 h-4 mr-2" /> Send to All Agents
              </Button>
            </div>
          )}
        </>
      )}

      {/* Past digests */}
      {digests && digests.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm text-foreground mb-3">Past Digests</h3>
          <div className="space-y-2">
            {digests.slice(0, 8).map((d: any) => (
              <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 bg-card border border-border rounded-lg">
                {d.status === "sent"
                  ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  : <Clock className="w-4 h-4 text-amber-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Week of {new Date(d.weekStarting).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.status === "sent"
                      ? `Sent to ${d.recipientCount ?? 0} agents on ${new Date(d.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                      : "Draft"}
                  </p>
                </div>
                <Badge variant={d.status === "sent" ? "default" : "outline"} className="text-xs capitalize">
                  {d.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview Dialog */}
      {previewOpen && draft && (
        <Dialog open onOpenChange={() => setPreviewOpen(false)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Digest Preview</DialogTitle>
            </DialogHeader>
            <div className="prose prose-sm max-w-none">
              <h2 className="text-lg font-bold">
                {customSubject || `JLT Weekly Digest — ${weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`}
              </h2>
              {customIntro && <p className="text-muted-foreground italic">{customIntro}</p>}
              <h3>This Week's Numbers</h3>
              {stats && (
                <ul>
                  <li>📋 {stats.bookingsThisWeek ?? 0} bookings registered</li>
                  <li>💰 £{Number(stats.totalCommissionClaimed ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 0 })} commission claimed</li>
                  <li>🔄 {stats.reimbursementsCount ?? 0} reimbursements processed</li>
                </ul>
              )}
              {highlightItems.length > 0 && (
                <>
                  <h3>Celebrating Our Agents</h3>
                  <ul>
                    {highlightItems.map((h, i) => (
                      <li key={i}>{h.emoji} {h.message}</li>
                    ))}
                  </ul>
                </>
              )}
              {includedPostIds.length > 0 && (
                <p className="text-muted-foreground text-sm">
                  + {includedPostIds.length} community post{includedPostIds.length !== 1 ? "s" : ""} from this week
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Test Email Dialog */}
      {testEmailOpen && draft && (
        <Dialog open onOpenChange={() => setTestEmailOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Send Test Email</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Send a preview of this digest to a single email address. It will be marked <strong>[TEST]</strong> in the subject line.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Email address</Label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={testEmailAddress}
                onChange={(e) => setTestEmailAddress(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendTest()}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTestEmailOpen(false)}>Cancel</Button>
              <Button
                onClick={handleSendTest}
                disabled={sendTest.isPending || !testEmailAddress}
              >
                {sendTest.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
                  : <><Mail className="w-4 h-4 mr-2" /> Send Test</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Send Confirm Dialog */}
      {sendConfirmOpen && (
        <Dialog open onOpenChange={() => setSendConfirmOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Send Weekly Digest?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will send the digest email to all active agents. This action cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSendConfirmOpen(false)}>Cancel</Button>
              <Button
                onClick={() => sendDigest.mutate({
                  digestId: draft!.id,
                  origin: window.location.origin,
                  customSubject: customSubject || undefined,
                  customIntro: customIntro || undefined,
                })}
                disabled={sendDigest.isPending}
              >
                {sendDigest.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
                  : "Yes, Send Now"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
