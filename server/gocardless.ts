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
  const json = (await res.json()) as T & { error?: { message: string; type: string; errors?: any[] } };
  if (!res.ok) {
    const err = (json as any).error;
    const detail = err?.errors ? JSON.stringify(err.errors) : JSON.stringify(json);
    console.error(`[GoCardless] ${method} ${path} → ${res.status}`, JSON.stringify(json, null, 2));
    throw new Error(`GoCardless API error ${res.status}: ${err?.message ?? detail}\n${detail}`);
  }
  return json;
}

// ─── Billing Requests ─────────────────────────────────────────────────────────

export interface GcBillingRequest {
  id: string;
  status: string;
  mandate_request: { scheme: string; links?: { mandate?: string } };
  links?: {
    mandate_request_mandate?: string;
    mandate?: string;
    [key: string]: string | undefined;
  };
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
}): Promise<GcJoinBillingRequest> {
  const body: any = {
    billing_requests: {
      payment_request: {
        amount: opts.amountPence,
        currency: "GBP",
        description: opts.description,
        scheme: "faster_payments",
      },
      mandate_request: {
        scheme: "bacs",
      },
    },
  };
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
  prefilledCustomer?: {
    givenName?: string;
    familyName?: string;
    email?: string;
  };
}): Promise<GcBillingRequestFlow> {
  const flowBody: any = {
    redirect_uri: opts.redirectUri,
    exit_uri: opts.exitUri ?? opts.redirectUri,
    links: { billing_request: opts.billingRequestId },
  };
  if (opts.prefilledCustomer) {
    const pc = opts.prefilledCustomer;
    if (pc.givenName || pc.familyName || pc.email) {
      flowBody.prefilled_customer = {
        ...(pc.givenName && { given_name: pc.givenName }),
        ...(pc.familyName && { family_name: pc.familyName }),
        ...(pc.email && { email: pc.email }),
      };
    }
  }
  const res = await gcRequest<{ billing_request_flows: GcBillingRequestFlow }>(
    "POST",
    "/billing_request_flows",
    { billing_request_flows: flowBody }
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
 * Calculate the first subscription charge date.
 * Finds the next occurrence of `dayOfMonth` that is at least 28 days after `joiningFeeDate`.
 * If the chosen day in the next calendar month is still within 28 days, it rolls to the month after.
 *
 * Example: join 1 Apr, pick day 15 → earliest = 29 Apr → 15 May ✓
 * Example: join 28 Apr, pick day 1  → earliest = 26 May → 1 Jun ✓
 * Example: join 1 Apr, pick day 30  → earliest = 29 Apr → 30 Apr ✓ (same month, >28 days)
 */
export function calcSubscriptionStartDate(
  joiningFeeDate: Date,
  dayOfMonth: number
): string {
  // Clamp dayOfMonth to 1–28 (GoCardless max is 28 to avoid month-end issues)
  const targetDay = Math.max(1, Math.min(28, dayOfMonth));
  // Earliest allowed date: 28 days from joining
  const earliest = new Date(joiningFeeDate);
  earliest.setDate(earliest.getDate() + 28);

  // Try the target day in the same month as `earliest`
  let candidate = new Date(earliest.getFullYear(), earliest.getMonth(), targetDay);
  // If that day has already passed (or is before earliest), move to next month
  if (candidate < earliest) {
    candidate = new Date(earliest.getFullYear(), earliest.getMonth() + 1, targetDay);
  }
  const year = candidate.getFullYear();
  const month = candidate.getMonth() + 1;
  const day = candidate.getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
