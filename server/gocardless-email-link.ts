import { canLinkGoCardlessMandate, parseGoCardlessMandateStatus } from "../shared/gocardless-mandate-status";

export interface GoCardlessEmailLinkCustomer {
  id: string;
  email?: string | null;
  [key: string]: unknown;
}
export interface GoCardlessEmailLinkMandate {
  id: string;
  status: string;
  scheme?: string;
  links: { customer: string; [key: string]: unknown };
  [key: string]: unknown;
}
export interface GoCardlessEmailLinkSubscription {
  id: string;
  status: "active" | "paused";
  amount: number;
  currency: string;
  interval_unit: "monthly";
  interval: 1;
  start_date: string;
  day_of_month?: number | null;
  upcoming_payments?: Array<{ charge_date: string; amount: number }>;
  links: { mandate: string; customer?: string; [key: string]: unknown };
  [key: string]: unknown;
}
export interface GoCardlessEmailLinkSelection {
  email: string;
  customer: GoCardlessEmailLinkCustomer;
  mandate: GoCardlessEmailLinkMandate;
  subscription: GoCardlessEmailLinkSubscription | null;
  matchingCustomerCount: number;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const MAX_PAGES = 200;
const MAX_MATCHING_CUSTOMERS = 20;
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["cancelled", "finished"]);

function object(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Object key order is not evidence of a conflicting provider resource.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function dedupe(records: unknown[], resource: string): Record<string, any>[] {
  const byId = new Map<string, Record<string, any>>();
  for (const record of records) {
    if (!object(record) || typeof record.id !== "string" || !record.id.trim()) {
      throw new Error(`Malformed GoCardless ${resource} record; held for staff review.`);
    }
    const existing = byId.get(record.id);
    if (existing && canonical(existing) !== canonical(record)) {
      throw new Error(`Conflicting GoCardless ${resource} records for ${record.id}; held for staff review.`);
    }
    byId.set(record.id, record);
  }
  return Array.from(byId.values());
}

function matchingCustomers(email: string, customers: unknown[]): GoCardlessEmailLinkCustomer[] {
  const matching = dedupe(customers, "customer").filter(customer =>
    typeof customer.email === "string" && normalizeEmail(customer.email) === email
  ) as GoCardlessEmailLinkCustomer[];
  if (matching.length > MAX_MATCHING_CUSTOMERS) {
    throw new Error(`Too many exact-email GoCardless customers (${matching.length}); held for staff review.`);
  }
  return matching;
}

/** Pure selection: no networking, ownership changes, or local persistence. */
export function selectGoCardlessEmailLink(
  rawEmail: string,
  customers: unknown[],
  mandates: unknown[],
  subscriptions: unknown[],
): GoCardlessEmailLinkSelection {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error("An email address is required for GoCardless lookup.");
  const matching = matchingCustomers(email, customers);
  if (!matching.length) throw new Error(`No GoCardless customer found with email ${email}.`);
  const customersById = new Map(matching.map(customer => [customer.id, customer]));
  const allMandates = dedupe(mandates, "mandate");
  const mandatesById = new Map<string, GoCardlessEmailLinkMandate>();
  const eligible: GoCardlessEmailLinkMandate[] = [];
  for (const mandate of allMandates) {
    if (!object(mandate.links) || !customersById.has(mandate.links.customer)) {
      throw new Error(`GoCardless mandate ${mandate.id} has a customer-chain mismatch; held for staff review.`);
    }
    const status = parseGoCardlessMandateStatus(mandate.status);
    if (status === "pending_customer_approval") {
      throw new Error(`GoCardless mandate ${mandate.id} awaits customer approval; held for staff review.`);
    }
    const typed = mandate as GoCardlessEmailLinkMandate;
    mandatesById.set(mandate.id, typed);
    if (canLinkGoCardlessMandate(status)) eligible.push(typed);
  }

  const ongoing: GoCardlessEmailLinkSubscription[] = [];
  for (const subscription of dedupe(subscriptions, "subscription")) {
    const mandate = object(subscription.links) ? mandatesById.get(subscription.links.mandate) : undefined;
    if (!mandate || (subscription.links.customer !== undefined && subscription.links.customer !== mandate.links.customer)) {
      throw new Error(`GoCardless subscription ${subscription.id} has a mandate/customer-chain mismatch; held for staff review.`);
    }
    if (TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) continue;
    if (!["active", "paused"].includes(subscription.status) || subscription.interval_unit !== "monthly" || subscription.interval !== 1) {
      throw new Error(`Unsupported ongoing GoCardless subscription ${subscription.id} (${String(subscription.status)}); held for staff review.`);
    }
    if (!canLinkGoCardlessMandate(mandate.status)) {
      throw new Error(`Ongoing GoCardless subscription ${subscription.id} has an unusable mandate; held for staff review.`);
    }
    if (!Number.isSafeInteger(subscription.amount) || subscription.amount <= 0 ||
        typeof subscription.currency !== "string" || !/^[A-Z]{3}$/.test(subscription.currency) ||
        typeof subscription.start_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(subscription.start_date)) {
      throw new Error(`Malformed ongoing GoCardless subscription ${subscription.id}; held for staff review.`);
    }
    ongoing.push(subscription as GoCardlessEmailLinkSubscription);
  }
  if (eligible.length > 1 || ongoing.length > 1) {
    throw new Error(`Ambiguous GoCardless email match: ${eligible.length} eligible mandates and ${ongoing.length} ongoing subscriptions across ${matching.length} matching customers; held for staff review.`);
  }
  if (!eligible.length) {
    throw new Error(`GoCardless email ${email} matches ${matching.length} customers, but no reusable active/pending mandate exists across those customers.`);
  }
  const mandate = eligible[0]; // Cardinality is exactly one, never a provider-order preference.
  return {
    email,
    customer: customersById.get(mandate.links.customer)!,
    mandate,
    subscription: ongoing.length === 1 ? ongoing[0] : null,
    matchingCustomerCount: matching.length,
  };
}

async function getAll(
  resource: "customers" | "mandates" | "subscriptions",
  getPage: (path: string) => Promise<any>,
  customerId?: string,
): Promise<unknown[]> {
  const all: unknown[] = [];
  const seenCursors = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: "500" });
    if (customerId) params.set("customer", customerId);
    if (after) params.set("after", after);
    const data = await getPage(`/${resource}?${params.toString()}`);
    if (!object(data) || !Array.isArray(data[resource])) {
      throw new Error(`Malformed GoCardless ${resource} list; lookup incomplete, held for staff review.`);
    }
    // Scope is checked per page as well as by the pure selector, so a response
    // from a different matching customer cannot silently pass a scoped request.
    if (customerId) {
      for (const record of data[resource]) {
        if (!object(record) || !object(record.links) ||
            (resource === "mandates" && record.links.customer !== customerId) ||
            (resource === "subscriptions" && record.links.customer !== undefined && record.links.customer !== customerId)) {
          throw new Error(`GoCardless ${resource} customer-scope mismatch; held for staff review.`);
        }
      }
    }
    all.push(...data[resource]);
    if (!object(data.meta) || !object(data.meta.cursors) ||
        !Object.prototype.hasOwnProperty.call(data.meta.cursors, "after")) {
      throw new Error(`Malformed GoCardless ${resource} pagination; lookup incomplete, held for staff review.`);
    }
    const next = data.meta.cursors.after;
    if (next === null) return all;
    if (typeof next !== "string" || !next.trim() || seenCursors.has(next)) {
      throw new Error(`Invalid or repeated GoCardless ${resource} pagination cursor; lookup incomplete, held for staff review.`);
    }
    seenCursors.add(next);
    after = next;
  }
  throw new Error(`GoCardless ${resource} pagination page limit exceeded; lookup incomplete, held for staff review.`);
}

/** GET-only orchestration; the caller supplies the read transport. Never uses fetch. */
export async function lookupGoCardlessEmailLink(
  rawEmail: string,
  getPage: (path: string) => Promise<any>,
): Promise<GoCardlessEmailLinkSelection> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error("An email address is required for GoCardless lookup.");
  // GoCardless customer listing has no supported exact-email filter.
  const customers = await getAll("customers", getPage);
  const matching = matchingCustomers(email, customers);
  if (!matching.length) throw new Error(`No GoCardless customer found with email ${email}.`);
  const scoped = await Promise.all(matching.map(async customer => {
    const [mandates, subscriptions] = await Promise.all([
      getAll("mandates", getPage, customer.id),
      getAll("subscriptions", getPage, customer.id),
    ]);
    const mandateIds = new Set(dedupe(mandates, "mandate").map(mandate => mandate.id));
    for (const subscription of subscriptions) {
      if (!object(subscription) || !object(subscription.links) || !mandateIds.has(subscription.links.mandate)) {
        throw new Error(`GoCardless subscription mandate/customer-chain mismatch for customer ${customer.id}; held for staff review.`);
      }
    }
    return { mandates, subscriptions };
  }));
  return selectGoCardlessEmailLink(email, matching, scoped.flatMap(result => result.mandates), scoped.flatMap(result => result.subscriptions));
}

export { getAll as listGoCardlessEmailLinkResources };
