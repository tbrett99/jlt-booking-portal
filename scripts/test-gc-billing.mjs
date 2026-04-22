/**
 * Test script: call GoCardless billing request API and print the full error response.
 * Run with: node scripts/test-gc-billing.mjs
 */
import { config } from "dotenv";
config();

const token = process.env.GOCARDLESS_ACCESS_TOKEN;
const BASE_URL = "https://api.gocardless.com";

const headers = {
  Authorization: `Bearer ${token}`,
  "GoCardless-Version": "2015-07-06",
  "Content-Type": "application/json",
  Accept: "application/json",
};

console.log("Token present:", !!token);
console.log("");

// Step 1: Create billing request WITHOUT prefilled_customer
const body1 = {
  billing_requests: {
    payment_request: {
      amount: 100,
      currency: "GBP",
      description: "JLT Group Joining Fee",
      scheme: "faster_payments",
    },
    mandate_request: {
      scheme: "bacs",
    },
  },
};

console.log("=== Step 1: Create billing request (no prefilled_customer) ===");
const res1 = await fetch(`${BASE_URL}/billing_requests`, {
  method: "POST",
  headers,
  body: JSON.stringify(body1),
});
const json1 = await res1.json();
console.log("Status:", res1.status);
if (!res1.ok) {
  console.log("ERROR:", JSON.stringify(json1, null, 2));
  process.exit(1);
}
const brqId = json1.billing_requests.id;
console.log("Billing Request ID:", brqId);
console.log("");

// Step 2: Create billing request flow WITH prefilled_customer
const body2 = {
  billing_request_flows: {
    redirect_uri: "https://example.com/complete",
    exit_uri: "https://example.com/exit",
    prefilled_customer: {
      given_name: "Test",
      family_name: "User",
      email: "test@example.com",
    },
    links: { billing_request: brqId },
  },
};

console.log("=== Step 2: Create billing request flow (with prefilled_customer) ===");
const res2 = await fetch(`${BASE_URL}/billing_request_flows`, {
  method: "POST",
  headers,
  body: JSON.stringify(body2),
});
const json2 = await res2.json();
console.log("Status:", res2.status);
if (!res2.ok) {
  console.log("ERROR:", JSON.stringify(json2, null, 2));
  process.exit(1);
}
console.log("Flow URL:", json2.billing_request_flows?.authorisation_url);
console.log("SUCCESS! Both steps worked.");
