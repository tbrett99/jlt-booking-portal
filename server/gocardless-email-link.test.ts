import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupGoCardlessEmailLink, selectGoCardlessEmailLink } from "./gocardless-email-link";

const email = "lorna@example.test";
const customers = [
  { id: "CU_EMPTY", email, given_name: "Lorna", family_name: "Tompkins" },
  { id: "CU_CURRENT", email: ` ${email.toUpperCase()} `, given_name: "Lorna", family_name: "Hartmann" },
];
const mandate = (id = "MD_CURRENT", customer = "CU_CURRENT", status = "active") => ({ id, status, scheme: "sepa_core", links: { customer } });
const subscription = (id = "SB_CURRENT", mid = "MD_CURRENT", status = "active") => ({
  id, status, amount: 10200, currency: "EUR", interval_unit: "monthly", interval: 1,
  start_date: "2025-09-01", day_of_month: 5,
  upcoming_payments: [{ charge_date: "2026-12-05", amount: 10200 }],
  links: { mandate: mid },
});
const page = (resource: string, rows: unknown[], after: string | null = null) => ({ [resource]: rows, meta: { cursors: { after } } });
function transport(overrides?: (url: URL) => unknown) {
  return vi.fn(async (path: string) => {
    const url = new URL(path, "https://fixture.invalid");
    const overridden = overrides?.(url);
    if (overridden !== undefined) return overridden;
    if (url.pathname === "/customers") return page("customers", customers);
    if (url.pathname === "/mandates") return page("mandates", url.searchParams.get("customer") === "CU_CURRENT" ? [mandate()] : []);
    if (url.pathname === "/subscriptions") return page("subscriptions", url.searchParams.get("customer") === "CU_CURRENT" ? [subscription()] : []);
    throw new Error(`Unexpected fixture request ${path}`);
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("pure GoCardless exact-email selection", () => {
  it("considers the empty first customer and retains SEPA/EUR provider values", () => {
    const result = selectGoCardlessEmailLink(` ${email.toUpperCase()} `, customers, [mandate()], [subscription()]);
    expect(result).toMatchObject({ email, matchingCustomerCount: 2, customer: { id: "CU_CURRENT" }, mandate: { scheme: "sepa_core" }, subscription: { amount: 10200, currency: "EUR", interval: 1 } });
    expect(result.subscription).toEqual(subscription());
  });
  it("does not depend on customer, mandate or subscription array order", () => {
    const mandates = [mandate("MD_OLD", "CU_CURRENT", "failed"), mandate()];
    const subs = [subscription("SB_OLD", "MD_OLD", "cancelled"), subscription()];
    expect(selectGoCardlessEmailLink(email, customers, mandates, subs)).toEqual(
      selectGoCardlessEmailLink(email, [...customers].reverse(), [...mandates].reverse(), [...subs].reverse()));
  });
  it("deduplicates identical IDs including object key-order differences", () => {
    const m = mandate();
    expect(selectGoCardlessEmailLink(email, [...customers, customers[1]], [m, { links: m.links, scheme: m.scheme, status: m.status, id: m.id }], [subscription(), subscription()])).toMatchObject({ matchingCustomerCount: 2, subscription: { id: "SB_CURRENT" } });
  });
  it.each(["customer", "mandate", "subscription"])("rejects conflicting duplicate %s records", resource => {
    const cs = resource === "customer" ? [...customers, { ...customers[1], email: "other@example.test" }] : customers;
    const ms = resource === "mandate" ? [mandate(), { ...mandate(), status: "submitted" }] : [mandate()];
    const ss = resource === "subscription" ? [subscription(), { ...subscription(), amount: 1 }] : [subscription()];
    expect(() => selectGoCardlessEmailLink(email, cs, ms, ss)).toThrow("Conflicting");
  });
  it("does not disambiguate two reusable mandates by presence of one subscription", () => {
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate(), mandate("MD_TWO", "CU_EMPTY")], [subscription()])).toThrow("Ambiguous");
  });
  it("rejects two ongoing subscriptions on one mandate", () => {
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate()], [subscription(), subscription("SB_TWO", "MD_CURRENT", "paused")])).toThrow("Ambiguous");
  });
  it("retains paused monthly subscriptions rather than claiming mandate-only", () => {
    expect(selectGoCardlessEmailLink(email, customers, [mandate()], [subscription("SB_CURRENT", "MD_CURRENT", "paused")]).subscription?.status).toBe("paused");
  });
  it("permits a single reusable mandate with no ongoing subscription", () => {
    expect(selectGoCardlessEmailLink(email, customers, [mandate()], [subscription("SB_FINISHED", "MD_CURRENT", "finished")]).subscription).toBeNull();
  });
  it.each(["active", "submitted", "pending_submission", "pending"])("permits sole %s mandate-only selection", status => {
    expect(selectGoCardlessEmailLink(email, customers, [mandate("MD_CURRENT", "CU_CURRENT", status)], []).subscription).toBeNull();
  });
  it.each(["failed", "expired", "cancelled", "consumed", "blocked", "suspended_by_payer"])("ignores terminal/unusable %s mandate history", status => {
    expect(selectGoCardlessEmailLink(email, customers, [mandate("MD_OLD", "CU_CURRENT", status), mandate()], []).mandate.id).toBe("MD_CURRENT");
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate("MD_OLD", "CU_CURRENT", status)], [])).toThrow("no reusable");
  });
  it("holds pending approval even when another active mandate exists", () => {
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate(), mandate("MD_APPROVAL", "CU_CURRENT", "pending_customer_approval")], [])).toThrow("awaits customer approval");
  });
  it.each([
    { status: "pending_customer_approval" }, { status: "future_status" },
    { interval_unit: "weekly" }, { interval: 2 },
  ])("holds unsupported ongoing subscription instead of implying none: %j", override => {
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate()], [{ ...subscription(), ...override }])).toThrow("Unsupported ongoing");
  });
  it("holds unknown mandate status and ongoing subscription on unusable mandate", () => {
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate("MD_CURRENT", "CU_CURRENT", "unknown")], [])).toThrow("Unsupported");
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate(), mandate("MD_UNKNOWN", "CU_CURRENT", "unknown")], [subscription()])).toThrow("Unsupported");
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate("MD_CURRENT", "CU_CURRENT", "failed")], [subscription()])).toThrow("unusable mandate");
  });
  it.each([{ amount: 0 }, { amount: 1.2 }, { currency: "" }, { start_date: null }])("rejects malformed selected subscription %j", override => {
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate()], [{ ...subscription(), ...override }])).toThrow("Malformed ongoing");
  });
  it("rejects no customers and never fuzzy-matches email", () => {
    expect(() => selectGoCardlessEmailLink(email, [{ id: "CU_OTHER", email: `prefix.${email}` }], [], [])).toThrow(`No GoCardless customer found with email ${email}`);
  });
  it("rejects missing IDs and provider-chain mismatches, including terminal subscriptions", () => {
    expect(() => selectGoCardlessEmailLink(email, [...customers, { email }], [], [])).toThrow("Malformed");
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate("MD_BAD", "CU_OTHER")], [])).toThrow("chain mismatch");
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate()], [subscription("SB_BAD", "MD_OTHER", "cancelled")])).toThrow("chain mismatch");
    expect(() => selectGoCardlessEmailLink(email, customers, [mandate()], [{ ...subscription(), links: { mandate: "MD_CURRENT", customer: "CU_EMPTY" } }])).toThrow("chain mismatch");
  });
});

describe("injected GET-only provider lookup", () => {
  it("only calls injected transport and scopes resource lists to every exact customer", async () => {
    const network = vi.fn(() => { throw new Error("Real network is forbidden"); });
    vi.stubGlobal("fetch", network);
    const getPage = transport();
    expect(await lookupGoCardlessEmailLink(email, getPage)).toMatchObject({ matchingCustomerCount: 2, customer: { id: "CU_CURRENT" } });
    expect(network).not.toHaveBeenCalled();
    expect(getPage).toHaveBeenCalledTimes(5);
    for (const [path] of getPage.mock.calls) {
      const url = new URL(path, "https://fixture.invalid");
      expect(url.searchParams.has("email")).toBe(false);
      if (url.pathname !== "/customers") expect(["CU_EMPTY", "CU_CURRENT"]).toContain(url.searchParams.get("customer"));
    }
  });
  it("consumes complete pagination for customers and each scoped resource", async () => {
    const getPage = transport(url => {
      const after = url.searchParams.get("after");
      if (url.pathname === "/customers") return after ? page("customers", [customers[1], { id: "CU_UNRELATED", email: "other@example.test" }]) : page("customers", [customers[0]], "CUS_PAGE_2");
      if (url.searchParams.get("customer") === "CU_CURRENT") {
        const resource = url.pathname.slice(1);
        if (!after) return page(resource, [], `${resource}_PAGE_2`);
        return page(resource, resource === "mandates" ? [mandate()] : [subscription()]);
      }
      return undefined;
    });
    expect((await lookupGoCardlessEmailLink(email, getPage)).subscription?.id).toBe("SB_CURRENT");
    expect(getPage).toHaveBeenCalledTimes(8);
    expect(getPage.mock.calls.every(([path]) => !path.includes("CU_UNRELATED"))).toBe(true);
  });
  it("does not request mandates/subscriptions when no customer matches", async () => {
    const getPage = vi.fn(async () => page("customers", []));
    await expect(lookupGoCardlessEmailLink(email, getPage)).rejects.toThrow("No GoCardless customer");
    expect(getPage).toHaveBeenCalledOnce();
  });
  it("rejects empty email before any request", async () => {
    const getPage = transport();
    await expect(lookupGoCardlessEmailLink(" ", getPage)).rejects.toThrow("email address is required");
    expect(getPage).not.toHaveBeenCalled();
  });
  it("propagates a later-page failure without returning partial success", async () => {
    const getPage = transport(url => {
      if (url.pathname === "/customers") {
        if (url.searchParams.has("after")) throw new Error("fixture HTTP 503");
        return page("customers", customers, "NEXT");
      }
      return undefined;
    });
    await expect(lookupGoCardlessEmailLink(email, getPage)).rejects.toThrow("fixture HTTP 503");
    expect(getPage).toHaveBeenCalledTimes(2);
  });
  it.each([{}, { customers: null }, { customers: {} }, { customers: [] }, { customers: [], meta: [] }, { customers: [], meta: {} }, { customers: [], meta: { cursors: [] } }, { customers: [], meta: { cursors: {} } }, { customers: [], meta: { cursors: { after: undefined } } }, { customers: [], meta: { cursors: { after: 9 } } }])("rejects malformed page or pagination %j", data => {
    return expect(lookupGoCardlessEmailLink(email, async () => data)).rejects.toThrow(/Malformed|Invalid/);
  });
  it("holds excessive exact-email matches before any scoped fan-out", async () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ id: `CU_${index}`, email }));
    const getPage = vi.fn(async () => page("customers", many));
    await expect(lookupGoCardlessEmailLink(email, getPage)).rejects.toThrow("Too many exact-email");
    expect(getPage).toHaveBeenCalledOnce();
    expect(() => selectGoCardlessEmailLink(email, many, [], [])).toThrow("Too many exact-email");
  });
  it("rejects repeated cursors", async () => {
    const getPage = vi.fn(async () => page("customers", customers, "SAME"));
    await expect(lookupGoCardlessEmailLink(email, getPage)).rejects.toThrow("repeated");
    expect(getPage).toHaveBeenCalledTimes(2);
  });
  it("enforces a finite page cap", async () => {
    let count = 0;
    const getPage = vi.fn(async () => page("customers", [], `PAGE_${++count}`));
    await expect(lookupGoCardlessEmailLink(email, getPage)).rejects.toThrow("page limit");
    expect(getPage).toHaveBeenCalledTimes(200);
  });
  it("rejects a scoped mandate returned under another matching customer", async () => {
    const getPage = transport(url => url.pathname === "/mandates" && url.searchParams.get("customer") === "CU_EMPTY" ? page("mandates", [mandate()]) : undefined);
    await expect(lookupGoCardlessEmailLink(email, getPage)).rejects.toThrow("scope mismatch");
  });
  it("rejects a scoped subscription pointing to another matching customer's mandate", async () => {
    const getPage = transport(url => url.pathname === "/subscriptions" && url.searchParams.get("customer") === "CU_EMPTY" ? page("subscriptions", [subscription()]) : undefined);
    await expect(lookupGoCardlessEmailLink(email, getPage)).rejects.toThrow("chain mismatch");
  });
});
