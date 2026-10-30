import type { AgentSupportSource } from "./agent-support-utils";

/**
 * Small, code-reviewed guides for agent workflows that are already displayed in
 * the Portal UI but are not stored as Knowledge Base records. These are a
 * positive allow-list: do not add API responses, individual booking data,
 * document contents, payment records or staff-only operational instructions.
 *
 * Keep each guide aligned with the corresponding agent UI and link agents back
 * to the normal Portal workspace rather than inventing a parallel workflow.
 */
export const AGENT_PORTAL_PROCEDURE_SOURCES: AgentSupportSource[] = [
  {
    key: "portal-procedure:reimbursement-request-v1",
    kind: "portal_procedure",
    title: "Requesting a reimbursement in the Agent Portal",
    category: "Bookings & requests",
    href: "/my-bookings",
    text: `How to claim, request or set up a reimbursement in the Agent Portal:
1. Open My bookings and find the correct booking.
2. Open that booking and go to the My Reimbursements section.
3. Select Request Additional Reimbursement.
4. Before continuing, have the required supporting documents ready: a confirmation or invoice showing the supplier name, client name and amount paid; and proof of payment that matches the supplier and amount and shows the payment has cleared. A payment still shown as pending is not accepted.
5. Confirm that the documents are ready and the payment has cleared.
6. Add each reimbursement item with its supplier name and amount. Select the JLT company card option only when that expense was paid using the JLT company card; those funds return to JLT rather than being paid back to the agent.
7. Upload the supporting documents for every reimbursement item, then submit the request.

If JLT asks for further information after submission, check the booking Messages and upload the requested evidence in the relevant My Reimbursements item. Do not send reimbursement documents as a general booking-message attachment.`,
  },
];
