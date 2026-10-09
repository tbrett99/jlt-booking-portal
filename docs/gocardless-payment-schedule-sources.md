# GoCardless payment schedule sources

- GoCardless Retry failed payment guidance: https://support.gocardless.com/hc/en-us/articles/115002900765-Retrying-a-failed-payment
  - A manually retried failed payment is resubmitted and is tracked via the payment timeline.
  - A payment can be re-submitted up to three times.
  - Success+ can automatically schedule retries based on its chosen retry day.
- GoCardless API reference: https://docs.gocardless.com/docs/api-reference
  - The Core Payments API exposes Payment and Subscription endpoints. The Portal currently receives `subscriptions[].upcoming_payments` via its existing GoCardless subscription sync, so it can combine the subscription’s live upcoming schedule with future collection-payment records for the subscription.

Implementation decision: the CRM Direct Debit tab will fetch the live subscription and its future payment records from GoCardless whenever staff open the profile, render exact future collection dates and amounts, flag a future collection after a recorded failure as a potential retry/recollection, and deliberately state "No future collection date is currently scheduled" rather than guessing a retry date.
