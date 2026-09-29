import { and, eq } from "drizzle-orm";
import {
  agentCrmProfiles,
  gcPaymentFailures,
  gcSubscriptions,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { sendDirectEmail, sendSupportEmail } from "./email";

const GC_VERSION = "2015-07-06";
const TERMINAL_SUCCESS_STATUSES = new Set(["confirmed", "paid_out"]);
const TERMINAL_FAILURE_STATUSES = new Set(["failed", "charged_back"]);

export type GoCardlessPaymentHistoryItem = {
  id: string;
  status: string;
  charge_date?: string | null;
  created_at?: string | null;
  links?: {
    subscription?: string | null;
    mandate?: string | null;
  };
};

export type PaymentFailureStreak = {
  consecutiveFailures: number;
  lastFailedPaymentId: string | null;
  lastFailedAt: Date | null;
};

export function calculatePaymentFailureStreak(
  payments: GoCardlessPaymentHistoryItem[],
): PaymentFailureStreak {
  const ordered = [...payments].sort((left, right) => {
    const leftDate = `${left.charge_date ?? ""}|${left.created_at ?? ""}|${left.id}`;
    const rightDate = `${right.charge_date ?? ""}|${right.created_at ?? ""}|${right.id}`;
    return leftDate.localeCompare(rightDate);
  });

  let consecutiveFailures = 0;
  let lastFailedPaymentId: string | null = null;
  let lastFailedAt: Date | null = null;

  for (const payment of ordered) {
    if (TERMINAL_SUCCESS_STATUSES.has(payment.status)) {
      consecutiveFailures = 0;
      lastFailedPaymentId = null;
      lastFailedAt = null;
      continue;
    }

    if (TERMINAL_FAILURE_STATUSES.has(payment.status)) {
      consecutiveFailures += 1;
      lastFailedPaymentId = payment.id;
      const occurredAt = payment.charge_date ?? payment.created_at ?? null;
      lastFailedAt = occurredAt ? new Date(occurredAt) : null;
    }
  }

  return { consecutiveFailures, lastFailedPaymentId, lastFailedAt };
}

function getGoCardlessHeaders(): HeadersInit {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN;
  if (!token) {
    throw new Error("GOCARDLESS_ACCESS_TOKEN not configured");
  }

  return {
    Authorization: `Bearer ${token}`,
    "GoCardless-Version": GC_VERSION,
    Accept: "application/json",
  };
}

function getGoCardlessBaseUrl(): string {
  return (process.env.GOCARDLESS_ENVIRONMENT ?? "live").toLowerCase() === "live"
    ? "https://api.gocardless.com"
    : "https://api-sandbox.gocardless.com";
}

async function listLivePayments(): Promise<GoCardlessPaymentHistoryItem[]> {
  const payments: GoCardlessPaymentHistoryItem[] = [];
  let after: string | null = null;

  do {
    const url = new URL(`${getGoCardlessBaseUrl()}/payments`);
    url.searchParams.set("limit", "500");
    if (after) url.searchParams.set("after", after);

    const response = await fetch(url, { headers: getGoCardlessHeaders() });
    if (!response.ok) {
      throw new Error(`GoCardless payment reconciliation request failed with HTTP ${response.status}`);
    }

    const payload = await response.json() as {
      payments?: GoCardlessPaymentHistoryItem[];
      meta?: { cursors?: { after?: string | null } };
    };
    payments.push(...(payload.payments ?? []));
    after = payload.meta?.cursors?.after ?? null;
  } while (after);

  return payments;
}

function suspensionEmailHtml(agentName: string, failureCount: number): string {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;color:#414141;">
  <h1 style="font-size:22px;margin:0 0 18px;color:#991b1b;">JLT Group</h1>
  <p>Hi ${agentName},</p>
  <p>Your JLT Group membership Direct Debit has failed <strong>${failureCount} consecutive times</strong>.</p>
  <p style="padding:16px;border-left:4px solid #dc2626;background:#fef2f2;"><strong>Your portal access has been temporarily suspended.</strong> Please contact memberships@thejltgroup.co.uk so we can resolve the payment and restore your account.</p>
  <p>JLT Group</p>
</div>`;
}

function supportSuspensionEmailHtml(input: {
  agentName: string;
  agentCode: string | null;
  userId: number;
  failureCount: number;
  lastFailedAt: Date | null;
}): string {
  const date = input.lastFailedAt
    ? input.lastFailedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    : "Unknown";
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;color:#414141;">
  <h1 style="font-size:22px;margin:0 0 18px;color:#991b1b;">Agent auto-suspended for non-payment</h1>
  <table style="border-collapse:collapse;width:100%;">
    <tr><td style="padding:8px 0;color:#6b7280;">Agent</td><td style="padding:8px 0;font-weight:600;">${input.agentName}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;">Agent code</td><td style="padding:8px 0;">${input.agentCode ?? "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;">Consecutive failed payments</td><td style="padding:8px 0;font-weight:600;color:#991b1b;">${input.failureCount}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;">Latest failed payment date</td><td style="padding:8px 0;">${date}</td></tr>
  </table>
  <p style="margin-top:20px;"><a href="https://portal.thejltgroup.co.uk/crm/${input.userId}">Open agent CRM record</a></p>
</div>`;
}

export type PaymentFailureReconciliationResult = {
  scannedSubscriptions: number;
  updatedFailureCounters: number;
  suspendedAgentCodes: string[];
};

/**
 * Rebuild current payment-failure streaks from GoCardless rather than relying
 * only on webhook delivery. This deliberately never reinstates an account.
 */
export async function reconcilePaymentFailureSuspensions(): Promise<PaymentFailureReconciliationResult> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable for GoCardless payment reconciliation");
  }

  const subscriptions = await db
    .select({
      subscriptionId: gcSubscriptions.subscriptionId,
      userId: users.id,
      agentName: users.name,
      agentEmail: users.email,
      portalStatus: users.portalStatus,
      isActive: users.isActive,
      agentCode: agentCrmProfiles.uniqueAgentId,
      agentStatus: agentCrmProfiles.agentStatus,
    })
    .from(gcSubscriptions)
    .innerJoin(users, eq(gcSubscriptions.userId, users.id))
    .innerJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
    .where(and(
      eq(gcSubscriptions.status, "active"),
      eq(users.role, "agent"),
    ));

  const trackedSubscriptions = subscriptions.filter((subscription) => Boolean(subscription.subscriptionId));
  const subscriptionsById = new Map<string, typeof trackedSubscriptions[number]>();
  const subscriptionsByUserId = new Map<number, {
    agent: typeof trackedSubscriptions[number];
    subscriptionIds: string[];
  }>();
  for (const subscription of trackedSubscriptions) {
    if (subscription.subscriptionId) {
      subscriptionsById.set(subscription.subscriptionId, subscription);
      const current = subscriptionsByUserId.get(subscription.userId);
      if (current) {
        current.subscriptionIds.push(subscription.subscriptionId);
      } else {
        subscriptionsByUserId.set(subscription.userId, {
          agent: subscription,
          subscriptionIds: [subscription.subscriptionId],
        });
      }
    }
  }

  const livePayments = await listLivePayments();
  const paymentsBySubscription = new Map<string, GoCardlessPaymentHistoryItem[]>();
  for (const payment of livePayments) {
    const subscriptionId = payment.links?.subscription ?? null;
    if (!subscriptionId || !subscriptionsById.has(subscriptionId)) continue;
    const bucket = paymentsBySubscription.get(subscriptionId) ?? [];
    bucket.push(payment);
    paymentsBySubscription.set(subscriptionId, bucket);
  }

  const existingFailureRows = await db.select().from(gcPaymentFailures);
  const failureByUserId = new Map(existingFailureRows.map((row) => [row.userId, row]));
  let updatedFailureCounters = 0;
  const suspendedAgentCodes: string[] = [];

  for (const userId of Array.from(subscriptionsByUserId.keys())) {
    const userSubscriptions = subscriptionsByUserId.get(userId);
    if (!userSubscriptions) continue;
    const subscription = userSubscriptions.agent;
    const paymentHistory = userSubscriptions.subscriptionIds.flatMap(
      (subscriptionId) => paymentsBySubscription.get(subscriptionId) ?? [],
    );

    const streak = calculatePaymentFailureStreak(paymentHistory);
    const existing = failureByUserId.get(subscription.userId);
    const countChanged = existing?.consecutiveFailures !== streak.consecutiveFailures;
    const paymentChanged = existing?.lastFailedPaymentId !== streak.lastFailedPaymentId;

    if (existing) {
      if (countChanged || paymentChanged) {
        await db.update(gcPaymentFailures)
          .set({
            consecutiveFailures: streak.consecutiveFailures,
            lastFailedAt: streak.lastFailedAt,
            lastFailedPaymentId: streak.lastFailedPaymentId,
          })
          .where(eq(gcPaymentFailures.id, existing.id));
        updatedFailureCounters += 1;
      }
    } else if (streak.consecutiveFailures > 0) {
      await db.insert(gcPaymentFailures).values({
        userId: subscription.userId,
        consecutiveFailures: streak.consecutiveFailures,
        lastFailedAt: streak.lastFailedAt,
        lastFailedPaymentId: streak.lastFailedPaymentId,
      });
      updatedFailureCounters += 1;
    }

    const activelyTrading = subscription.isActive
      && subscription.portalStatus === "active"
      && subscription.agentStatus === "active";
    if (!activelyTrading || streak.consecutiveFailures < 3) continue;

    const suspendedAt = new Date();
    await db.transaction(async (tx) => {
      await tx.update(users)
        .set({
          portalStatus: "suspended",
          isActive: false,
          suspendedAt,
          suspensionReason: "non_payment",
        })
        .where(eq(users.id, subscription.userId));
      await tx.update(agentCrmProfiles)
        .set({
          agentStatus: "suspended",
          suspendedAt,
          suspensionReason: "non_payment",
        })
        .where(eq(agentCrmProfiles.userId, subscription.userId));
      await tx.update(gcPaymentFailures)
        .set({ autoSuspendedAt: suspendedAt })
        .where(eq(gcPaymentFailures.userId, subscription.userId));
    });

    const agentName = subscription.agentName ?? "Agent";
    const agentCode = subscription.agentCode ?? null;
    suspendedAgentCodes.push(agentCode ?? `user-${subscription.userId}`);
    try {
      if (subscription.agentEmail) {
        await sendDirectEmail({
          toEmail: subscription.agentEmail,
          toName: agentName,
          subject: "Portal Access Suspended — Membership Payment Failed",
          html: suspensionEmailHtml(agentName, streak.consecutiveFailures),
          ...({ triggerKey: `gc_payment_suspension_${subscription.userId}`, userId: subscription.userId } as any),
        });
      }
      await sendSupportEmail({
        subject: `Agent Auto-Suspended: ${agentName} — ${streak.consecutiveFailures} Consecutive DD Failures`,
        html: supportSuspensionEmailHtml({
          agentName,
          agentCode,
          userId: subscription.userId,
          failureCount: streak.consecutiveFailures,
          lastFailedAt: streak.lastFailedAt,
        }),
      });
    } catch (notificationError) {
      console.error(`[PaymentFailureReconciliation] Suspension notifications failed for user ${subscription.userId}`, notificationError);
    }
  }

  return {
    scannedSubscriptions: subscriptionsById.size,
    updatedFailureCounters,
    suspendedAgentCodes,
  };
}
