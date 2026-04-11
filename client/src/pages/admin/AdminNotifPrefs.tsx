import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { ArrowLeft, Bell, BellOff, Mail, MailX, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

// All admin-facing notification triggers with labels and descriptions
type TriggerItem = { key: string; label: string; description: string; emailNotApplicable?: boolean };
type TriggerGroup = { group: string; items: TriggerItem[] };
const ADMIN_TRIGGERS: TriggerGroup[] = [
  {
    group: "Agent Messages",
    items: [
      {
        key: "agent_message",
        label: "Agent sends a message on a booking",
        description: "Email you when an agent leaves a shared note on any booking. Only the last admin who replied receives this; others get an in-app notification only.",
      },
      {
        key: "admin_mention",
        label: "@Mention in internal note",
        description: "Email you when another admin @mentions you in an internal booking note.",
      },
    ],
  },
  {
    group: "Workflow Events",
    items: [
      {
        key: "reimb_doc_upload",
        label: "Reimbursement document uploaded",
        description: "Email when an agent uploads reimbursement documents for a booking.",
      },
      {
        key: "new_amendment",
        label: "Amendment submitted",
        description: "Email when an agent submits an amendment request.",
      },
      {
        key: "new_refund",
        label: "Refund request submitted",
        description: "Email when an agent submits a refund request.",
      },
      {
        key: "new_cancellation",
        label: "Cancellation request submitted",
        description: "Email when an agent submits a cancellation request.",
      },
      {
        key: "commission_claim",
        label: "Commission claim submitted",
        description: "Email when an agent submits a commission claim.",
      },
    ],
  },
  {
    group: "Scheduled Reminders",
    items: [
      {
        key: "supplier_payment_due",
        label: "Final supplier payment date reached",
        description: "Daily digest email listing bookings where the final supplier payment date has passed but commission has not been marked claimable.",
      },
      {
        key: "late_reimb_doc",
        label: "Late reimbursement document upload",
        description: "Email when an agent uploads a reimbursement document after the initial submission window.",
      },
    ],
  },
  {
    group: "Admin Tasks",
    items: [
      {
        key: "task_assigned",
        label: "Task assigned to you",
        description: "In-app notification when another admin assigns a task to you. Email is not sent for task assignments — use in-app notifications.",
        emailNotApplicable: true,
      },
      {
        key: "task_comment",
        label: "Comment on your task",
        description: "In-app notification when someone comments on a task you created or are assigned to. Email is not sent for task comments.",
        emailNotApplicable: true,
      },
    ],
  },
];

export default function AdminNotifPrefs() {
  const { data: prefs = [], isLoading, refetch } = trpc.notifPrefs.list.useQuery();
  const updatePref = trpc.notifPrefs.update.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => toast.error(err.message || "Failed to update preference"),
  });

  // Build a lookup: triggerKey -> emailEnabled (default true if no row)
  const prefMap = new Map(prefs.map((p) => [p.triggerKey, p.emailEnabled]));

  function isEnabled(key: string): boolean {
    return prefMap.get(key) ?? true;
  }

  function toggle(key: string, current: boolean) {
    updatePref.mutate({ triggerKey: key, emailEnabled: !current });
    toast.success(!current ? "Email notifications enabled" : "Email notifications disabled");
  }

  const totalEnabled = ADMIN_TRIGGERS.flatMap((g) => g.items)
    .filter((item) => !item.emailNotApplicable && isEnabled(item.key)).length;
  const totalApplicable = ADMIN_TRIGGERS.flatMap((g) => g.items)
    .filter((item) => !item.emailNotApplicable).length;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bell size={20} className="text-[#70FFE8]" />
            My Notification Preferences
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Control which email notifications you receive. In-app notifications are always sent regardless of these settings.
          </p>
        </div>
        <Badge variant="outline" className="flex-shrink-0 gap-1.5">
          <Mail size={12} />
          {totalEnabled} / {totalApplicable} email types on
        </Badge>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 mb-6 text-sm text-blue-800">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <p>These preferences apply only to your account. Other admins manage their own preferences independently. Changes take effect immediately.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" size={28} style={{ color: '#70FFE8' }} />
        </div>
      ) : (
        <div className="space-y-6">
          {ADMIN_TRIGGERS.map((group) => (
            <Card key={group.group}>
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {group.group}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <div className="divide-y">
                  {group.items.map((item) => {
                    const enabled = isEnabled(item.key);
                    const isPending = updatePref.isPending && updatePref.variables?.triggerKey === item.key;
                    return (
                      <div key={item.key} className="flex items-start gap-4 py-3.5 first:pt-0 last:pb-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium">{item.label}</p>
                            {item.emailNotApplicable && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">In-app only</Badge>
                            )}
                            {!item.emailNotApplicable && enabled && (
                              <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                                <Mail size={10} /> Email on
                              </span>
                            )}
                            {!item.emailNotApplicable && !enabled && (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <MailX size={10} /> Email off
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>
                        </div>
                        {!item.emailNotApplicable && (
                          <div className="flex-shrink-0 pt-0.5">
                            <Switch
                              checked={enabled}
                              onCheckedChange={() => toggle(item.key, enabled)}
                              disabled={isPending}
                              aria-label={`Toggle email for ${item.label}`}
                            />
                          </div>
                        )}
                        {item.emailNotApplicable && (
                          <div className="flex-shrink-0 pt-0.5">
                            <BellOff size={16} className="text-muted-foreground opacity-40" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
