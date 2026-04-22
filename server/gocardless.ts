/**
 * GoCardless API helper
 * Wraps the GoCardless REST API for mandate and subscription management.
 */

const GC_BASE_URL = "https://api.gocardless.com";
const GC_VERSION = "2015-07-06";

function gcHeaders() {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN;
  if (!token) throw new Error("GOCARDLESS_ACCESS_TOKEN not set");
  return {
    Authorization: `Bearer ${token}`,
    "GoCardless-Version": GC_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function gcRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${GC_BASE_URL}${path}`, {
    method,
    headers: gcHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: { message: string; type: string } };
  if (!res.ok) {
    const err = (json as any).error;
    throw new Error(`GoCardless API error ${res.status}: ${err?.message ?? JSON.stringify(json)}`);
  }
  return json;
}

// ─── Billing Requests ─────────────────────────────────────────────────────────

export interface GcBillingRequest {
  id: string;
  status: string;
  mandate_request: { scheme: string; links?: { mandate?: string } };
}

export async function createBillingRequest(opts: {
  givenName?: string;
  familyName?: string;
  email?: string;
}): Promise<GcBillingRequest> {
  const body: any = {
    billing_requests: {
      mandate_request: { scheme: "bacs" },
    },
  };
  if (opts.givenName || opts.familyName || opts.email) {
    body.billing_requests.prefilled_customer = {
      ...(opts.givenName && { given_name: opts.givenName }),
      ...(opts.familyName && { family_name: opts.familyName }),
      ...(opts.email && { email: opts.email }),
    };
  }
  const res = await gcRequest<{ billing_requests: GcBillingRequest }>(
    "POST",
    "/billing_requests",
    body
  );
  return res.billing_requests;
}

// ─── Join Flow: Billing Request with Instant Bank Pay + Mandate ─────────────

export interface GcJoinBillingRequest {
  id: string;
  status: string;
  payment_request?: { amount: number; currency: string; description: string };
  mandate_request?: { scheme: string; links?: { mandate?: string } };
}

/**
 * Creates a GoCardless Billing Request for the join flow:
 * - payment_request: one-off Instant Bank Pay (joining fee)
 * - mandate_request: BACS Direct Debit mandate setup
 * Both are fulfilled in a single GoCardless hosted flow.
 */
export async function createJoinBillingRequest(opts: {
  amountPence: number;       // joining fee in pence
  description: string;       // e.g. "JLT Group Joining Fee"
  givenName?: string;
  familyName?: string;
  email?: string;
}): Promise<GcJoinBillingRequest> {
  const body: any = {
    billing_requests: {
      payment_request: {
        amount: opts.amountPence,
        currency: "GBP",
        description: opts.description,
      },
      mandate_request: {
        scheme: "bacs",
        description: "JLT Group Monthly Membership",
      },
    },
  };
  if (opts.givenName || opts.familyName || opts.email) {
    body.billing_requests.prefilled_customer = {
      ...(opts.givenName && { given_name: opts.givenName }),
      ...(opts.familyName && { family_name: opts.familyName }),
      ...(opts.email && { email: opts.email }),
    };
  }
  const res = await gcRequest<{ billing_requests: GcJoinBillingRequest }>(
    "POST",
    "/billing_requests",
    body
  );
  return res.billing_requests;
}

// ─── Billing Request Flows ────────────────────────────────────────────────────

export interface GcBillingRequestFlow {
  id: string;
  authorisation_url: string;
}

export async function createBillingRequestFlow(opts: {
  billingRequestId: string;
  redirectUri: string;
  exitUri?: string;
}): Promise<GcBillingRequestFlow> {
  const res = await gcRequest<{ billing_request_flows: GcBillingRequestFlow }>(
    "POST",
    "/billing_request_flows",
    {
      billing_request_flows: {
        redirect_uri: opts.redirectUri,
        exit_uri: opts.exitUri ?? opts.redirectUri,
        links: { billing_request: opts.billingRequestId },
      },
    }
  );
  return res.billing_request_flows;
}

// ─── Mandates ─────────────────────────────────────────────────────────────────

export interface GcMandate {
  id: string;
  status: string;
  scheme: string;
  next_possible_charge_date: string | null;
}

export async function getMandate(mandateId: string): Promise<GcMandate> {
  const res = await gcRequest<{ mandates: GcMandate }>(
    "GET",
    `/mandates/${mandateId}`
  );
  return res.mandates;
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

export interface GcSubscription {
  id: string;
  status: string;
  amount: number;
  currency: string;
  interval_unit: string;
  start_date: string;
  day_of_month: number | null;
  upcoming_payments: { charge_date: string; amount: number }[];
}

export async function createSubscription(opts: {
  mandateId: string;
  amountPence: number;
  name: string;
  startDate: string; // YYYY-MM-DD
  dayOfMonth?: number; // 1–28
}): Promise<GcSubscription> {
  const body: any = {
    subscriptions: {
      amount: opts.amountPence,
      currency: "GBP",
      name: opts.name,
      interval_unit: "monthly",
      interval: 1,
      start_date: opts.startDate,
      links: { mandate: opts.mandateId },
    },
  };
  if (opts.dayOfMonth) {
    body.subscriptions.day_of_month = opts.dayOfMonth;
  }
  const res = await gcRequest<{ subscriptions: GcSubscription }>(
    "POST",
    "/subscriptions",
    body
  );
  return res.subscriptions;
}

// ─── Billing Request lookup ───────────────────────────────────────────────────

export async function getBillingRequest(brqId: string): Promise<GcBillingRequest> {
  const res = await gcRequest<{ billing_requests: GcBillingRequest }>(
    "GET",
    `/billing_requests/${brqId}`
  );
  return res.billing_requests;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the subscription start_date as a YYYY-MM-DD string:
 * one calendar month after joiningFeeDate, on the requested dayOfMonth.
 * If dayOfMonth is beyond the end of that month, clamps to the last day.
 */
export function calcSubscriptionStartDate(
  joiningFeeDate: Date,
  dayOfMonth: number
): string {
  const d = new Date(joiningFeeDate);
  d.setMonth(d.getMonth() + 1);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(dayOfMonth, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
