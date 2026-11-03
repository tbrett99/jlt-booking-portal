import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { MergePreview } from "./agent-merge-contract";

export type Row = Record<string, any>;
export type OwnerPolicy = { table: string; owner: string; label: string; mode: "move" | "archive" | "cache"; agentRecipient?: boolean };
// Explicit subjects only. Signer IDs, historical actors and authentication tokens
// deliberately stay attached to their original historical user.
export const MERGE_OWNERS: readonly OwnerPolicy[] = [
  ...[
    ["bookings", "Bookings"], ["amendments", "Amendments"], ["cancellations", "Cancellation requests"],
    ["refunds", "Refund requests"], ["commission_claims", "Commission claims (ownership only)"],
    ["reimbursement_items", "Reimbursements (ownership only)"], ["flight_requests", "Flight requests"],
    ["remittance_lines", "PTS remittance items (ownership only)"], ["commission_remittance_items", "Commission remittance items (ownership only)"],
    ["commission_readiness_reminders", "Existing commission reminder evidence"],
    ["agent_engagement_cases", "Engagement cases"], ["agent_engagement_interactions", "Engagement conversations"],
    ["academy_enrollments", "Academy course enrolments"], ["academy_action_assignments", "Academy action assignments"],
    ["academy_action_plan_targets", "Academy action audiences"], ["fnf_voucher_uses", "Voucher use history"],
    ["competition_entries", "Competition entries"], ["public_enquiries", "Public enquiries"],
    ["public_holiday_showcases", "Holiday showcases"], ["public_holiday_showcase_edit_requests", "Showcase requests"],
  ].map(([table, label]) => ({ table, label, owner: "agentId", mode: "move" as const })),
  ...[
    ["gc_mandates", "GoCardless mandate references"], ["gc_subscriptions", "GoCardless subscription references"],
    ["gc_mandate_replacements", "Mandate replacement history"], ["gc_payment_events", "Historic GoCardless payment evidence"],
    ["membership_payment_inbox", "Canonical payment event ownership"], ["membership_payment_obligations", "Membership payment obligations"],
    ["membership_payment_settlements", "Recorded membership settlements"], ["agent_emails", "Existing email history (no resend)"],
    ["in_app_notifications", "Existing notifications (no new notifications)"], ["agent_tags", "Tags"],
    ["agent_supplier_logins", "Supplier login records"], ["agent_supplier_stages", "Supplier onboarding stages"],
    ["supplier_login_requests", "Supplier login requests"], ["agent_change_requests", "Profile change requests"],
    ["event_registrations", "Event registrations"], ["roadmap_suggestions", "Roadmap suggestions"],
    ["roadmap_votes", "Roadmap votes"], ["library_content_activity", "Library activity"],
    ["public_agent_profiles", "Public profile"],
  ].map(([table, label]) => ({ table, label, owner: "userId", mode: "move" as const })),
  { table: "agent_crm_notes", label: "CRM notes", owner: "agentUserId", mode: "move" },
  { table: "prospects", label: "Linked recruitment prospects", owner: "linkedUserId", mode: "move" },
  { table: "academy_access", label: "Academy access", owner: "agentId", mode: "move" },
  // Identity-keyed reward collisions need review; never award points a second time.
  { table: "momentum_ledger", label: "Momentum reward history", owner: "agentId", mode: "move" },
  ...[
    ["contract_signatures", "Original signed contracts"], ["terms_signings", "Original signed terms"],
    ["join_sessions", "Original onboarding / contract evidence"], ["agent_status_events", "Original membership status history"],
    ["agent_crm_profiles", "Original CRM profile and document references"], ["admin_onboarding_checklist", "Original staff onboarding checklist"],
    ["gc_payment_failures", "Original legacy payment counter audit"], ["membership_payment_fees", "Original administration-fee ledger"],
    ["membership_payment_outbox", "Original payment email idempotency ledger"], ["inbox_audit_logs", "Original inbox audit"],
    ["agent_support_conversations", "Original AI support conversations"], ["agent_support_feedback", "Original AI support feedback"],
    ["community_confirmations", "Original Community confirmations"], ["community_reactions", "Original Community reactions"],
    ["community_post_views", "Original Community reading history"], ["community_confirmation_reminders", "Original Community reminder history"],
  ].map(([table, label]) => ({ table, label, owner: "userId", mode: "archive" as const })),
  { table: "academy_audit_log", label: "Original Academy audit", owner: "agentId", mode: "archive" },
  { table: "fnf_voucher_allocations", label: "Original voucher grants (not added together)", owner: "agentId", mode: "archive" },
  { table: "public_agent_profile_changes", label: "Original public profile audit", owner: "agentId", mode: "archive" },
  { table: "public_holiday_showcase_events", label: "Original showcase audit", owner: "agentId", mode: "archive" },
  { table: "membership_payment_accounts", label: "Original derived payment cache", owner: "userId", mode: "cache" },
  { table: "email_sends", label: "Original campaign delivery history", owner: "recipientId", mode: "archive", agentRecipient: true },
  { table: "email_drip_enrollments", label: "Original drip history", owner: "recipientId", mode: "archive", agentRecipient: true },
];

export function stable(value: any): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("base64"));
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value === undefined ? null : value);
}
export function mergeDigest(value: any): string { return createHash("sha256").update(stable(value)).digest("hex"); }
export function identifiersValid(source: number, primary: number) {
  if (!Number.isSafeInteger(source) || !Number.isSafeInteger(primary) || source <= 0 || primary <= 0 || source === primary) throw new Error("Choose two different agent user IDs.");
}
export function uniqueCollision(row: Row, other: Row, keys: string[], owner: string) {
  return keys.includes(owner) && keys.filter(k => k !== owner).every(k => row[k] != null && other[k] != null && stable(row[k]) === stable(other[k]));
}
export function makeMergeToken(input: { source: number; primary: number; actor: number; digest: string; expiry: number }, secret: string) {
  if (!secret) throw new Error("The Portal signing secret is not configured; merge is unavailable.");
  const body = Buffer.from(JSON.stringify(input)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function verifyMergeToken(token: string, expected: { source: number; primary: number; actor: number; digest: string }, secret: string, now = Date.now()) {
  if (!secret) throw new Error("The Portal signing secret is not configured; merge is unavailable.");
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new Error("Refresh the merge preview before confirming.");
  const actual = Buffer.from(signature, "base64url");
  const wanted = createHmac("sha256", secret).update(body).digest();
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw new Error("The merge preview signature is invalid; refresh the preview.");
  const claim = JSON.parse(Buffer.from(body, "base64url").toString());
  if (!Number.isFinite(claim.expiry) || claim.expiry <= now || Object.entries(expected).some(([k,v]) => claim[k] !== v)) throw new Error("These records changed or the preview expired. Refresh and review the merge again; nothing was changed.");
}
export function publicPreview(plan: MergePreview): MergePreview { return plan; }
