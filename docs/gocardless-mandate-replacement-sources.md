# GoCardless mandate replacement implementation sources

Reviewed 20 October 2026.

## Hosted Billing Request Flow for a new Direct Debit mandate

Source: https://docs.gocardless.com/docs/collect-payments/setting-up-mandates

Key points used in the Portal implementation:

- A Billing Request with a `mandate_request` creates a mandate authorisation request. It is not a payment request.
- GoCardless recommends a Billing Request Flow for Hosted Pages. The resulting `authorisation_url` can be sent to the payer by email.
- The flow’s `redirect_uri` is only a return location; the result must be confirmed by GoCardless webhook events, not by trusting the redirect.
- An active mandate is then eligible for a recurring subscription.

## Prefilling the payer’s customer details

Source: https://docs.gocardless.com/docs/optimise/prefill-customer-details/billing-request-flow/

Key points used in the Portal implementation:

- Billing Request Flows support prefilled name and email details.
- Prefilling lowers payer friction but does not prevent the payer from completing the needed Direct Debit authorisation.
- A payer returning to a hosted flow resumes their progress.
