# Reimbursement Work Tracking Proposal

## Recommendation

Keep the existing **Reimbursements** page and the **Reimbursement Items** section of each booking as the only two places staff work. The improvement should add just one additional status, **Awaiting agent**, rather than create a separate work tracker, queue, or multi-step process.

The standard path remains simple:

> **Pending → Scheduled → Paid**

“Scheduled” continues to mean that the reimbursement has genuinely been processed on PTS. When JLT needs a missing invoice, cleared payment evidence, or clarification before that can happen, staff move the item from **Pending** to **Awaiting agent**. Once the agent provides what is needed, staff process it in PTS and move it directly to **Scheduled**. There is no need for separate New, Working on it, Ready for PTS, or Closed statuses.

## Booking-file experience

Each reimbursement item on the booking should gain a compact **Chase and activity** section directly beneath its document list. This keeps the work record attached to the exact supplier and amount, even when a booking has several reimbursement items.

The section should show the current status, latest action with author and timestamp, and, when relevant, the next follow-up date. Staff record exactly what has been requested when they set, or update, Awaiting agent.

For example, a staff member could record:

> Chelsea Crosby — Chased agent — 19 September 2026, 10:35. Asked for a supplier invoice showing the client name and amount paid, plus cleared payment evidence. Follow up on 23 September.

The **Awaiting agent** action should require the staff member to record what has been requested and set a follow-up date. This creates an unambiguous record of who chased the request, what was asked for, and when it must be reviewed again.

Setting Awaiting agent sends the same request automatically into the established booking Messages thread, alongside an in-portal notification and email. The reimbursement audit preserves the staff activity record and follow-up date; the agent does not see staff-only follow-up dates.

The current document controls stay where they are. When the agent uploads evidence, the item history records the upload. The item stays Awaiting agent until staff have checked the evidence and processed the reimbursement in PTS, at which point they change it directly to Scheduled.

## Reimbursements page experience

The existing admin list should become the operational queue. It should not become a separate case-management product.

The current payment counters remain and two targeted counters are added:

| Counter | Meaning |
|---|---|
| **Awaiting agent** | JLT has requested information or evidence from the agent. |
| **Follow-up overdue** | Awaiting-agent items whose next follow-up date has passed. |
| **Scheduled 5+ days** | Preserve the current payment-control check. |

The table should add **Last activity** and **Next follow-up** columns, while retaining **Status** and **Assigned To**. An Awaiting agent row could therefore read:

> Awaiting agent · Chelsea Crosby · Chased yesterday: invoice and cleared payment proof requested · Follow up 23 Sep

Quick actions on the list are deliberately limited: assign an owner, set Awaiting agent, log a chase again, or mark the item Scheduled once the requested information has been received and the reimbursement has been processed in PTS. Full note history and document review stay on the booking file, preventing a second editing surface.

The default open-items view should be ordered by urgency: overdue follow-ups first, then Awaiting agent, then ordinary Pending items. Existing filters for agent, client, amount, company card, payment status, late submissions, and scheduled-more-than-five-days should remain available.

## Data and audit approach

The existing `reimbursement_items` record already stores the payment status, assignee, PTS scheduling timestamp, paid timestamp, documents, and booking relationship. The existing `reimbursement_audit_logs` table already stores an item identifier, booking identifier, author, time, action type, and free-text note. It is therefore the right base for the per-item activity history.

The implementation would make the following additive changes:

| Field | Purpose |
|---|---|
| `status` | Extend the existing payment status with `awaiting_agent`; retain Pending, Scheduled, and Paid. |
| `nextFollowUpAt` | The date staff expect to chase or review again. |
| `lastChasedAt` | Lets staff see when the latest chase was made without reading the full history. |
| `lastChasedById` | Identifies the administrator who last chased the agent. |

No historic reimbursement records need to be overwritten. Existing open Pending items remain Pending, while existing Scheduled and Paid items retain their current meaning. No historic item will be labelled Awaiting agent unless staff choose that status.

Every important status change and chase should generate an immutable reimbursement activity entry, including the author, timestamp, old and new status where relevant, chase note, and follow-up date. The existing document and message records remain in their established booking sections.

## Safeguards

The proposal keeps the workflow lean. It removes the present ambiguity where a Pending reimbursement might mean “normal processing” or “we are waiting on the agent,” while preventing an item being marked Scheduled merely to remove it from the list before PTS work has happened.

The agent-facing view should remain simple. Agents see whether their reimbursement is Pending, Awaiting agent, Scheduled, or Paid; messages sent to them; and requests to upload evidence. Internal notes, assignment, and staff-only follow-up dates remain admin-only.

Once the requested information is received and the reimbursement is processed in PTS, the existing change to Scheduled is the confirmation that the operational work is complete.

## Delivery sequence

The work can be delivered without creating a new Portal section. It requires one additive database migration, server-side permission checks and audit logging, booking-file controls, and extensions to the existing `/admin/reimbursements` list.

The recommended release order is:

1. Extend the existing reimbursement status with Awaiting agent and add follow-up and chase metadata, while leaving Scheduled and Paid processing intact.
2. Add the per-item chase history to the booking reimbursement section.
3. Add the Awaiting agent and Follow-up overdue counters, filters, and urgency ordering to the existing reimbursement page.
4. Add regression coverage for permissions, immutable activity history, follow-up reminders, multi-item bookings, and the Pending/Awaiting agent/Scheduled/Paid flow.
5. Release only after staff can verify a sample reimbursement through Pending, Awaiting agent, Scheduled, and Paid.

## Decision recorded

The recommended operating model is **Pending → Awaiting agent → Scheduled → Paid**. An item stays Pending while JLT can process it normally; it only moves to Awaiting agent when staff need something further from the agent. This keeps the workflow in the existing two Portal locations and avoids another separate queue or admin area.

## References

[1]: https://portal.thejltgroup.co.uk/admin/reimbursements "JLT Portal reimbursements administration view"
[2]: https://portal.thejltgroup.co.uk/ "JLT Booking Portal"
