import { TRPCError } from "@trpc/server";
import { and, eq, or, sql } from "drizzle-orm";
import { agentCrmNotes, agentCrmProfiles, gcMandates, gcSubscriptions, users } from "../drizzle/schema";
import { canLinkGoCardlessMandate, parseGoCardlessMandateStatus } from "../shared/gocardless-mandate-status";
import { withGoCardlessEmailLinkLock } from "./gocardless-email-link-lock";

/** Narrow input: existing provider references only, never bank details or creation intent. */
export type EmailLinkMirror = {
  email: string;
  customer: { id: string };
  mandate: { id: string; status: string };
  subscription: null | {
    id: string; status: string; amount: number; currency: string;
    start_date?: string | null; day_of_month?: number | null;
    upcoming_payments?: Array<{ charge_date: string; amount?: number }>;
    links: { mandate?: string };
  };
};
export type EmailLinkAgent = { id: number; name: string | null; email: string | null; role: string };
export type EmailLinkActor = { id: number; name: string | null };
export type EmailLinkResult = { success: true; gcCustomerId: string; mandatesFound: number; subscriptionId: string | null; message: string };
const normalise = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
const conflict = (message: string): never => { throw new TRPCError({ code: "CONFLICT", message }); };

/** No provider writes, messages, payment collection, or automatic arrears changes. */
export async function mirrorGoCardlessEmailLink(
  agent: EmailLinkAgent,
  selection: EmailLinkMirror,
  actor: EmailLinkActor,
  options: { usesLoginEmail: boolean; db?: any } = { usesLoginEmail: true },
): Promise<EmailLinkResult> {
  if (!options.db) {
    return withGoCardlessEmailLinkLock(db => mirrorGoCardlessEmailLink(agent, selection, actor, { ...options, db }));
  }
  const db = options.db;
  const status = parseGoCardlessMandateStatus(selection.mandate.status);
  if (!status || !canLinkGoCardlessMandate(status)) conflict("The selected mandate is not available for linking. Refresh GoCardless and try again.");
  const sub = selection.subscription;
  if (sub && (sub.links.mandate !== selection.mandate.id || !["active", "paused"].includes(sub.status))) {
    conflict("The subscription does not match the selected mandate. No Portal records have been changed.");
  }
  if (sub && (!Number.isSafeInteger(sub.amount) || sub.amount < 0 || !/^[A-Z]{3}$/.test(sub.currency))) {
    conflict("GoCardless returned invalid subscription amounts or currency. No Portal records have been changed.");
  }
  if (sub && (!sub.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(sub.start_date))) {
    conflict("GoCardless did not return the original subscription start date. No Portal records have been changed.");
  }

  return db.transaction(async (tx: any) => {
    const accounts = await tx.select({ id: users.id, email: users.email, role: users.role })
      .from(users).where(or(eq(users.id, agent.id), sql`LOWER(TRIM(${users.email})) = ${normalise(selection.email)}`)).for("update");
    const current = accounts.find((row: any) => row.id === agent.id);
    if (!current || current.role !== "agent") conflict("This record is no longer an agent account. No Portal records have been changed.");
    if (accounts.some((row: any) => row.id !== agent.id && normalise(row.email) === normalise(selection.email))) {
      conflict("This GoCardless email also matches another Portal account. Staff must review the duplicate identity before linking; no records have been reassigned.");
    }
    if (options.usesLoginEmail && normalise(current.email) !== normalise(selection.email)) {
      conflict("The agent email changed during the lookup. Refresh their CRM record and try again.");
    }
    const [profile] = await tx.select({ agentStatus: agentCrmProfiles.agentStatus })
      .from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, agent.id)).for("update");
    if (["cancelled", "canceled", "left", "departed"].includes(normalise(profile?.agentStatus))) {
      conflict("This membership has been cancelled. Restore or review the membership before linking a current Direct Debit.");
    }

    // Lock both target references and this agent's current records. Competing
    // transactions cannot validate and partially write the same reference.
    const mandates = await tx.select().from(gcMandates)
      .where(or(eq(gcMandates.mandateId, selection.mandate.id), eq(gcMandates.userId, agent.id))).for("update");
    const subscriptions = await tx.select().from(gcSubscriptions)
      .where(or(eq(gcSubscriptions.mandateId, selection.mandate.id), eq(gcSubscriptions.userId, agent.id),
        ...(sub ? [eq(gcSubscriptions.subscriptionId, sub.id)] : []))).for("update");
    const matchingMandates = mandates.filter((row: any) => row.mandateId === selection.mandate.id);
    if (matchingMandates.some((row: any) => row.userId !== agent.id)) {
      conflict("This GoCardless mandate is already linked to another or unverified CRM record. No records have been reassigned; staff must review the ownership.");
    }
    if (subscriptions.some((row: any) =>
      (row.mandateId === selection.mandate.id || (sub && row.subscriptionId === sub.id)) && row.userId !== agent.id)) {
      conflict("This GoCardless subscription or mandate is already linked to another or unverified CRM record. No records have been reassigned; staff must review the ownership.");
    }
    if (sub && subscriptions.some((row: any) => row.subscriptionId === sub.id && row.mandateId !== selection.mandate.id)) {
      conflict("The local subscription has a different mandate reference. Use the reviewed mandate replacement workflow.");
    }
    if (mandates.some((row: any) => row.userId === agent.id && row.mandateId !== selection.mandate.id && canLinkGoCardlessMandate(row.status))) {
      conflict("This agent already has a different active or pending mandate. Use Replace mandate rather than linking a second current mandate.");
    }
    if (subscriptions.some((row: any) => row.userId === agent.id && ["active", "paused"].includes(row.status) && row.subscriptionId !== sub?.id)) {
      conflict("This agent already has a different ongoing subscription. Review it before linking; no second subscription has been added.");
    }
    if (matchingMandates.length && mandates.some((row: any) =>
      row.userId === agent.id && row.mandateId !== selection.mandate.id &&
      matchingMandates.every((selected: any) => new Date(row.createdAt).getTime() > new Date(selected.createdAt).getTime() ||
        (new Date(row.createdAt).getTime() === new Date(selected.createdAt).getTime() && row.id > selected.id)))) {
      conflict("A newer mandate record exists for this agent. Use Replace mandate so current and historical references remain clear.");
    }

    const now = new Date();
    const preferredDay = sub?.day_of_month && sub.day_of_month >= 1 && sub.day_of_month <= 31 ? sub.day_of_month : undefined;
    if (!matchingMandates.length) {
      await tx.insert(gcMandates).values({ userId: agent.id, mandateId: selection.mandate.id, status,
        ...(preferredDay ? { preferredPaymentDay: preferredDay } : {}), createdAt: now, updatedAt: now });
    } else {
      await tx.update(gcMandates).set({ status, ...(preferredDay ? { preferredPaymentDay: preferredDay } : {}), updatedAt: now })
        .where(and(eq(gcMandates.mandateId, selection.mandate.id), eq(gcMandates.userId, agent.id)));
    }
    if (sub) {
      const values = { userId: agent.id, mandateId: selection.mandate.id, subscriptionId: sub.id,
        status: sub.status as "active" | "paused", amount: sub.amount, currency: sub.currency,
        startDate: sub.start_date, dayOfMonth: sub.day_of_month ?? null,
        nextChargeDate: sub.upcoming_payments?.[0]?.charge_date ?? null, updatedAt: now };
      const existing = subscriptions.filter((row: any) => row.subscriptionId === sub.id);
      if (!existing.length) await tx.insert(gcSubscriptions).values({ ...values, createdAt: now });
      else await tx.update(gcSubscriptions).set({ status: values.status, amount: values.amount, currency: values.currency,
        startDate: values.startDate, dayOfMonth: values.dayOfMonth, nextChargeDate: values.nextChargeDate, updatedAt: now })
        .where(and(eq(gcSubscriptions.subscriptionId, sub.id), eq(gcSubscriptions.userId, agent.id)));
    }
    await tx.insert(agentCrmNotes).values({ agentUserId: agent.id, authorId: actor.id, authorName: actor.name,
      content: `GoCardless email link reviewed by staff: ${selection.email}. Customer ${selection.customer.id}; mandate ${selection.mandate.id} (${status}); ${sub ? `existing subscription ${sub.id} (${sub.status}, ${sub.currency} ${(sub.amount / 100).toFixed(2)})` : "mandate only; no ongoing subscription found"}. Existing provider references mirrored only; no new collection, subscription, notification or membership-status change was requested.`,
      createdAt: now });
    return { success: true as const, gcCustomerId: selection.customer.id, mandatesFound: 1,
      subscriptionId: sub?.id ?? null, message: sub
        ? `Linked existing ${sub.status} subscription ${sub.id} for ${agent.name ?? agent.email}. No new subscription or payment was created.`
        : `Mandate linked for ${agent.name ?? agent.email}; no ongoing subscription was found. No new subscription or payment was created.` };
  });
}
