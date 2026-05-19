/**
 * System Workflows — admin reference page
 * Shows all automated workflows, triggers, and rules built into the portal
 * so admins don't need to ask what happens in each scenario.
 */
import { Shield, Zap, Mail, AlertTriangle, CheckCircle, XCircle, Clock, CreditCard, Users, RefreshCw, Bell, ExternalLink } from "lucide-react";

interface WorkflowRule {
  trigger: string;
  actions: string[];
  note?: string;
}

interface WorkflowSection {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  rules: WorkflowRule[];
}

const sections: WorkflowSection[] = [
  {
    id: "payment-failures",
    icon: <CreditCard size={20} />,
    title: "Direct Debit Payment Failures",
    description: "Automated responses when a GoCardless DD payment fails or is charged back.",
    color: "#fee2e2",
    rules: [
      {
        trigger: "1st consecutive payment failure",
        actions: [
          "Agent emailed: payment failed, warning this is failure 1 of 3",
          "Admin notified at support@thejltgroup.co.uk with agent name, email, and CRM link",
          "Failure count incremented in database",
        ],
      },
      {
        trigger: "2nd consecutive payment failure",
        actions: [
          "Agent emailed: payment failed, warning this is failure 2 of 3",
          "Admin notified at support@thejltgroup.co.uk",
          "Failure count incremented to 2",
        ],
      },
      {
        trigger: "3rd consecutive payment failure",
        actions: [
          "Agent emailed: portal access suspended due to 3 consecutive failures",
          "Agent portal status set to Suspended — login blocked immediately",
          "Admin notified at support@thejltgroup.co.uk with urgent alert",
          "Failure count recorded with auto-suspend timestamp",
        ],
        note: "To reinstate access, go to the agent's CRM profile and change their status back to Active. You should also confirm with GoCardless that their mandate is healthy before reinstating.",
      },
      {
        trigger: "Successful payment (after previous failures)",
        actions: [
          "Agent emailed: payment receipt",
          "Consecutive failure counter reset to 0",
          "Portal access NOT automatically reinstated — admin must manually reactivate if suspended",
        ],
        note: "Suspension is intentional — a human should confirm the situation is resolved before restoring access.",
      },
    ],
  },
  {
    id: "mandate-events",
    icon: <RefreshCw size={20} />,
    title: "Direct Debit Mandate Events",
    description: "What happens when a GoCardless mandate changes state.",
    color: "#fef3c7",
    rules: [
      {
        trigger: "Mandate cancelled (agent cancels their DD)",
        actions: [
          "Mandate status updated in portal database",
          "Admin notified at support@thejltgroup.co.uk with mandate ID and agent ID",
          "Payment event logged",
        ],
        note: "Portal access is NOT automatically changed. Admin must decide whether to suspend or cancel the agent manually via CRM.",
      },
      {
        trigger: "Mandate expired",
        actions: [
          "Mandate status updated to expired in portal database",
          "Admin notified at support@thejltgroup.co.uk",
          "Payment event logged",
        ],
        note: "Same as cancellation — no automatic portal access change. Manual admin action required.",
      },
      {
        trigger: "Mandate failed (bank rejects setup)",
        actions: [
          "Mandate status updated to failed in portal database",
          "Admin notified at support@thejltgroup.co.uk",
          "Payment event logged",
        ],
      },
      {
        trigger: "Mandate active (bank confirms setup)",
        actions: [
          "Mandate status updated to active in portal database",
          "GoCardless subscription created automatically for the agent's membership tier and payment day",
          "Agent emailed: DD setup confirmation",
        ],
      },
    ],
  },
  {
    id: "portal-access",
    icon: <Shield size={20} />,
    title: "Portal Access States",
    description: "What each agent status means for portal login access.",
    color: "#ede9fe",
    rules: [
      {
        trigger: "Status: Active",
        actions: ["Agent can log in and use the portal normally"],
      },
      {
        trigger: "Status: Paused (admin-set)",
        actions: [
          "Agent login blocked",
          "Admin notified at memberships@thejltgroup.co.uk to pause their DD",
          "Pause end date recorded — admin must manually reactivate when pause ends",
        ],
        note: "Set via CRM agent profile → Change Status. Used for temporary breaks (e.g. maternity, sabbatical).",
      },
      {
        trigger: "Status: In Notice",
        actions: [
          "Agent can still log in — access continues during notice period",
          "Notice end date recorded",
        ],
        note: "Agent has given notice to leave. They retain access until the notice period ends. Admin must manually cancel them after.",
      },
      {
        trigger: "Status: Suspended (auto or admin-set)",
        actions: [
          "Agent login blocked immediately",
          "Used for: 3 consecutive DD failures (automatic) or admin manual action",
        ],
        note: "To reinstate: go to CRM profile → Change Status → Active.",
      },
      {
        trigger: "Status: Cancelled",
        actions: [
          "Agent login blocked permanently",
          "Account retained in system for historical records",
        ],
        note: "Irreversible from the portal UI. Contact support if a cancelled agent needs to rejoin — they would need a new account.",
      },
    ],
  },
  {
    id: "agent-onboarding",
    icon: <Users size={20} />,
    title: "Agent Onboarding (New Joins)",
    description: "Automated steps when a new agent completes the sign-up flow.",
    color: "#d1fae5",
    rules: [
      {
        trigger: "GoCardless payment confirmed (solo agent or duo/trio leader)",
        actions: [
          "Agent user account created (or linked if already exists)",
          "CRM profile created with membership tier, type, and date joined",
          "Unique Agent ID (JLT-XXXX) assigned automatically",
          "GoCardless mandate row created in portal database",
          "Admin notified at support@thejltgroup.co.uk: new joiner alert",
          "Agent emailed: welcome email with portal login link",
          "If agent was invited as a team partner: team link created automatically",
          "If agent is a team leader: any partners who already have profiles are linked to the team",
        ],
      },
      {
        trigger: "Team invite accepted (duo/trio partner, no payment)",
        actions: [
          "CRM profile created with team link",
          "Unique Agent ID (JLT-XXXX) assigned automatically",
          "Invite marked as accepted",
          "Join session marked as complete",
        ],
        note: "Team partners do not pay a joining fee — their leader's payment covers the team. They still sign the contract.",
      },
      {
        trigger: "Admin manually assigns agent to a team via CRM",
        actions: [
          "If agent has no CRM profile: profile created with team link and Agent ID assigned",
          "If agent already has a CRM profile: team ID updated on existing profile",
        ],
      },
    ],
  },
  {
    id: "agent-ids",
    icon: <Zap size={20} />,
    title: "Agent IDs (JLT-XXXX)",
    description: "How and when Agent IDs are assigned.",
    color: "#e0f2fe",
    rules: [
      {
        trigger: "New agent joins via GoCardless payment",
        actions: ["JLT-XXXX ID assigned automatically at CRM profile creation"],
      },
      {
        trigger: "Team partner accepts invite (no payment)",
        actions: ["JLT-XXXX ID assigned automatically at CRM profile creation"],
      },
      {
        trigger: "Admin manually adds agent to a team",
        actions: ["JLT-XXXX ID assigned automatically if no profile exists yet"],
      },
      {
        trigger: "Agent clicks Open Orbit (SSO login)",
        actions: [
          "SSO verify response includes uniqueAgentId",
          "Orbit stores the Agent ID against the agent's Orbit account",
          "Bookings submitted from Orbit carry the Agent ID for portal attribution",
        ],
      },
    ],
  },
  {
    id: "tiktok-leads",
    icon: <Bell size={20} />,
    title: "TikTok Recruitment Leads",
    description: "Attribution rule for leads coming from TikTok.",
    color: "#fce7f3",
    rules: [
      {
        trigger: "Prospect selects TikTok as how they heard about JLT",
        actions: [
          "Referral automatically attributed to Max Kelly (user 760)",
          "Applies to both the public enquiry form and the internal prospect creation form",
        ],
        note: "This is a fixed rule — all TikTok leads go to Max regardless of who creates the prospect record.",
      },
    ],
  },
  {
    id: "gc-receipts",
    icon: <Mail size={20} />,
    title: "Payment Receipts",
    description: "When receipt emails are sent to agents.",
    color: "#f0fdf4",
    rules: [
      {
        trigger: "GoCardless payment confirmed",
        actions: [
          "Receipt email sent to agent with amount, tier, date, and GC reference",
          "Deduplication check: if a receipt was already sent for this payment ID (e.g. webhook retry), no duplicate is sent",
        ],
        note: "Receipts are sent on 'confirmed' only — not on 'paid_out'. This prevents double receipts since GoCardless fires both events.",
      },
    ],
  },
];

const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: "#d1fae5", text: "#065f46" },
  paused: { bg: "#fef3c7", text: "#92400e" },
  suspended: { bg: "#fee2e2", text: "#991b1b" },
  in_notice: { bg: "#dbeafe", text: "#1e40af" },
  cancelled: { bg: "#f3f4f6", text: "#374151" },
};

export default function SystemWorkflows() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg" style={{ background: "rgba(112,255,232,0.15)" }}>
            <Zap size={22} style={{ color: "#02E6D2" }} />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "#414141" }}>System Workflows</h1>
        </div>
        <p className="text-sm text-gray-500 ml-12">
          A reference guide to all automated rules and workflows built into the portal. Use this to understand what the system does automatically and what requires manual admin action.
        </p>
      </div>

      {/* Quick reference: portal access states */}
      <div className="mb-8 rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100" style={{ background: "#f9fafb" }}>
          <h2 className="font-semibold text-sm" style={{ color: "#414141" }}>Quick Reference — Portal Access by Status</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-gray-100">
          {[
            { status: "Active", canLogin: true, color: "#d1fae5", text: "#065f46" },
            { status: "Paused", canLogin: false, color: "#fef3c7", text: "#92400e" },
            { status: "In Notice", canLogin: true, color: "#dbeafe", text: "#1e40af" },
            { status: "Suspended", canLogin: false, color: "#fee2e2", text: "#991b1b" },
            { status: "Cancelled", canLogin: false, color: "#f3f4f6", text: "#374151" },
          ].map((s) => (
            <div key={s.status} className="flex flex-col items-center justify-center py-4 px-3 gap-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: s.color, color: s.text }}>{s.status}</span>
              {s.canLogin ? (
                <span className="flex items-center gap-1 text-xs text-green-700"><CheckCircle size={12} /> Can log in</span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-red-600"><XCircle size={12} /> Blocked</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Workflow sections */}
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.id} className="rounded-xl border border-gray-200 overflow-hidden">
            {/* Section header */}
            <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100" style={{ background: section.color + "60" }}>
              <div className="mt-0.5 shrink-0" style={{ color: "#414141" }}>{section.icon}</div>
              <div>
                <h2 className="font-semibold" style={{ color: "#414141" }}>{section.title}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
              </div>
            </div>

            {/* Rules */}
            <div className="divide-y divide-gray-100">
              {section.rules.map((rule, i) => (
                <div key={i} className="px-5 py-4">
                  <div className="flex items-start gap-2 mb-2">
                    <Zap size={13} className="mt-0.5 shrink-0" style={{ color: "#02E6D2" }} />
                    <span className="text-sm font-medium" style={{ color: "#414141" }}>{rule.trigger}</span>
                  </div>
                  <ul className="ml-5 space-y-1">
                    {rule.actions.map((action, j) => (
                      <li key={j} className="text-sm text-gray-600 flex items-start gap-2">
                        <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-400 shrink-0" />
                        {action}
                      </li>
                    ))}
                  </ul>
                  {rule.note && (
                    <div className="mt-3 ml-5 flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: "#FFF6ED" }}>
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: "#d97706" }} />
                      <p className="text-xs text-amber-800">{rule.note}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <div className="mt-8 rounded-xl border border-gray-200 px-5 py-4 flex items-start gap-3" style={{ background: "#f9fafb" }}>
        <Clock size={16} className="mt-0.5 shrink-0 text-gray-400" />
        <p className="text-xs text-gray-500">
          This page reflects the actual automation code running in the portal. If a workflow is changed by a developer, this page should be updated to match. Last reviewed: May 2026.
        </p>
      </div>
    </div>
  );
}
