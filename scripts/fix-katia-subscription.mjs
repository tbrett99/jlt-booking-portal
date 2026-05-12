/**
 * One-off script: create the missing GoCardless subscription for Katia Adimora
 * User ID: 6661650, Mandate: MD01KQVWMK81XZJNH02WBJTTGCXH, preferred day: 15
 * Joining fee paid: 2026-05-05
 */
import { createSubscription, calcSubscriptionStartDate } from "../server/gocardless.ts";
import { createGcSubscription } from "../server/gocardless-db.ts";

const mandateId = "MD01KQVWMK81XZJNH02WBJTTGCXH";
const userId = 6661650;
const joiningFeeDate = new Date("2026-05-05T10:58:47Z");
const dayOfMonth = 15;
// Business Class solo = £297/month (29700 pence)
const amountPence = 29700;

const startDate = calcSubscriptionStartDate(joiningFeeDate, dayOfMonth);
console.log(`Calculated start date: ${startDate}`);

const sub = await createSubscription({
  mandateId,
  amountPence,
  name: "JLT Business Class Membership",
  startDate,
  dayOfMonth,
});

console.log("Subscription created:", sub.id, "start:", sub.start_date, "amount:", sub.amount);

await createGcSubscription({
  userId,
  mandateId,
  subscriptionId: sub.id,
  amount: sub.amount,
  startDate,
  dayOfMonth,
  nextChargeDate: sub.upcoming_payments?.[0]?.charge_date,
});

console.log("Subscription saved to database. Done.");
