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
  const [digestType, setDigestType] = useState<"weekly" | "monthly">("weekly");

  // Weekly updates always cover the previous completed Mon–Sun period.
  // Monthly reviews always cover the previous completed calendar month.
  const periodStart = useMemo(() => {
    const d = new Date();
    if (digestType === "monthly") {
      d.setMonth(d.getMonth() - 1, 1);
    } else {
      const daysSinceMonday = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - daysSinceMonday - 7);
    }
    d.setHours(0, 0, 0, 0);
    return d;
  }, [digestType]);
  const periodEnd = useMemo(() => {
    const d = new Date(periodStart);
    if (digestType === "monthly") d.setMonth(d.getMonth() + 1, 1);
    else d.setDate(d.getDate() + 7);
    return d;
  }, [digestType, periodStart]);
  const periodLabel = useMemo(() => {
    const lastDay = new Date(periodEnd.getTime() - 1);
    return digestType === "monthly"
      ? periodStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
      : `${periodStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${lastDay.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  }, [digestType, periodEnd, periodStart]);
  const digestTitle = digestType === "monthly" ? "Monthly Review" : "Weekly Update";

  const createDraft = trpc.community.digest.getOrCreateDraft.useMutation();
  const { data: digests, isLoading: digestsLoading, refetch: refetchDigests } = trpc.community.digest.list.useQuery();

  // Match using the fixed start of the selected reporting period.
  const draft = digests?.find((d: any) => {
    const dStart = new Date(d.weekStarting);
    return (d.digestType ?? "weekly") === digestType
      && Math.abs(dStart.getTime() - periodStart.getTime()) <= 2 * 24 * 60 * 60 * 1000;
  });

  const sendTest = trpc.community.digest.send.useMutation({
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
      testToEmail: testEmailAddress,
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
      await createDraft.mutateAsync({ periodStart, digestType });
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
          <h1 className="text-2xl font-bold text-foreground">Agent Digests</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manually prepare and send the completed reporting period to all active agents
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

      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-muted/30 p-2">
        <Button type="button" variant={digestType === "weekly" ? "default" : "ghost"} onClick={() => { setDigestType("weekly"); setCustomSubject(""); setCustomIntro(""); }}>
          Weekly Update
        </Button>
        <Button type="button" variant={digestType === "monthly" ? "default" : "ghost"} onClick={() => { setDigestType("monthly"); setCustomSubject(""); setCustomIntro(""); }}>
          Monthly Review
        </Button>
        <div className="ml-auto flex items-center px-2 text-sm font-medium text-muted-foreground">{periodLabel}</div>
      </div>

      {!draft ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No {digestTitle.toLowerCase()} draft for this period</p>
          <p className="text-sm mt-1">Click "Generate Draft" to create the {periodLabel} draft</p>
        </div>
      ) : (
        <>
          {/* Status banner */}
          {draft.status === "sent" && (
            <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" />
              This {digestType === "monthly" ? "month's review" : "week's update"} was sent to {(draft as any).recipientCount ?? 0} agents
              {(draft as any).sentAt && ` on ${new Date((draft as any).sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
            </div>
          )}

          {/* Stats block */}
          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-card border border-border rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{stats.bookingsThisWeek ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Bookings this {digestType === "monthly" ? "month" : "week"}</p>
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
                {includedPostIds.length} post{includedPostIds.length !== 1 ? "s" : ""} included from this {digestType === "monthly" ? "month" : "week"}
              </h3>
            </div>
          )}

          {/* Customisation */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-sm text-foreground">Customise (optional)</h3>
            <div className="space-y-1.5">
              <Label className="text-xs">Custom subject line</Label>
              <Input
                placeholder={`JLT ${digestTitle} — ${periodLabel}`}
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

          <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Sales report access</p>
            <p className="mt-1">Every digest includes an <strong>Open Orbit</strong> button linking agents to Travel Updates for the relevant sales report.</p>
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
                    {(d.digestType ?? "weekly") === "monthly" ? "Monthly Review" : "Weekly Update"} · {new Date(d.weekStarting).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
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
                {customSubject || `JLT ${digestTitle} — ${periodLabel}`}
              </h2>
              {customIntro && <p className="text-muted-foreground italic">{customIntro}</p>}
              <h3>This {digestType === "monthly" ? "Month" : "Week"}'s Numbers</h3>
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
                  + {includedPostIds.length} community post{includedPostIds.length !== 1 ? "s" : ""} from this {digestType === "monthly" ? "month" : "week"}
                </p>
              )}
              <p><a href="https://orbit.thejltgroup.co.uk/travel-updates" target="_blank" rel="noreferrer" className="font-medium text-primary underline">Open Orbit Travel Updates</a> to view the relevant sales report.</p>
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
              <DialogTitle>Send {digestTitle}?</DialogTitle>
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
