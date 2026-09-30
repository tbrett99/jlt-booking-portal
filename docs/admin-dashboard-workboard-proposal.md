# Admin Dashboard Workboard Proposal

## Recommendation

Replace the current broad **Admin Dashboard** with a focused daily workboard: a screen designed to answer, in order:

1. **What needs a response or action today?**
2. **What is assigned to me, the wider team, or unclaimed?**
3. **Which operational queues are ageing or blocked?**
4. **What membership, calendar, and community activity needs attention?**

This keeps the existing specialist pages as the places where work is completed. The dashboard becomes the clear, click-through starting point rather than another dashboard of duplicate reports.

> The existing **Super Admin** reporting dashboard should remain the strategic reporting area. The redesigned **Admin Dashboard** should be the live operational workboard used daily by admins and super admins.

No database migration is expected for the first phase. The existing booking, task, message, calendar, membership, change-request, community, GoCardless, and pipeline-history records already provide the required information.

---

## Proposed dashboard structure

### 1. Daily command header

A compact heading, for example:

> **Good morning, Max — Tuesday 30 September**  
> 4 tasks need attention · 6 unread conversations · 3 team events today

This makes the dashboard immediately feel personal and action-led without adding noise.

The header will contain:

- **My open tasks** count, including overdue and unacknowledged tasks.
- **Unread agent conversations** count.
- **Today’s calendar** count.
- A prominent **Create task** action.
- Direct links to Tasks, Messages, and the Calendar.

### 2. Priority work: messages and tasks

This becomes the most prominent section of the page, in a two-column desktop layout.

| Panel | What it shows | Interaction |
|---|---|---|
| **My task focus** | The signed-in admin’s open tasks, with overdue first, then unacknowledged, due today, and due soon. Show title, owner/source, linked booking, priority, due date, and status. | Mark complete, acknowledge where applicable, or open the task/booking. Include **View all my tasks**. |
| **Team task board** | Unassigned tasks plus the most overdue open tasks across the team. Show the current owner so work does not disappear between people. | Assign/open the task; link to the redesigned Task workbench. |
| **Message inbox zero** | Total unread threads plus the latest 4–5 unread agent conversations. Show client, agent, department tag, last message, and how long it has waited. | Open the relevant booking message thread or the Messages page. |

**Recommendation:** use a red/amber emphasis only where needed:

- **Red:** overdue task or a message waiting beyond the agreed service threshold.
- **Amber:** unacknowledged task, task due today, or agent message waiting today.
- **Neutral/mint:** work already in progress or recently acknowledged.

This makes it immediately obvious what must be cleared, while preserving the goal that the unread message count reaches **zero every day**.

### 3. Essential control checks

Replace the current generic “Requires immediate action” block with **only** the three controls requested:

| Control check | Definition | Destination |
|---|---|---|
| **PTS bookings missing Final Supplier Payment Date** | Open/non-cancelled bookings outside Commission Claimable with no final supplier payment date and no valid dismissal. | A filtered drill-down list of the affected bookings. |
| **Commission Claimable bookings missing Final Supplier Payment Date** | Commission Claimable bookings with no final supplier payment date and no valid dismissal. | A filtered drill-down list of the affected bookings. |
| **Active mandate, no Direct Debit subscription** | An agent with an active GoCardless mandate but no active Direct Debit subscription. | A filtered membership/direct-debit resolution list. |

Each tile should show both the count and a short list of the oldest affected records when there are any. A zero state should be calm and affirmative rather than occupying large empty cards.

**Important improvement:** the dashboard should not merely show a number. Each tile should have a named, filtered resolution view so staff can act on the records without manually searching for them.

### 4. Today’s calendar

A compact **Today at JLT** panel, using the existing Team Calendar records:

- Timed company events, webinars, and meetings in chronological order.
- All-day events and team holidays.
- Calendar tasks due today.
- A small “Who is away today” row when relevant.
- **Open calendar** and **Add event** links.

This keeps the calendar visible without recreating the full calendar inside the dashboard.

### 5. Active queues and pipeline health

Keep the existing pending work and pipeline breakdown, but make it useful for managing throughput.

#### Pending actions

Retain the existing operational queues, but show each as a concise action card:

- Amendments awaiting action
- Refunds awaiting action
- Reimbursements pending / awaiting agent
- Cancellations awaiting action
- Flight requests awaiting action
- Commission claims in processing

For each queue, display:

- **Open count**
- **Oldest item age**
- **Number beyond the team’s working target**
- Direct link to the filtered source page

#### Pipeline breakdown with ageing

Replace a plain stage-count chart with a **stage health table**:

| Stage | Files | Median / average days in stage | Oldest file | Over target |
|---|---:|---:|---:|---:|
| New Booking | 18 | 1.4 days | 6 days | 2 |
| Query | 7 | 4.8 days | 12 days | 3 |
| To Add to PTS | 23 | 2.1 days | 9 days | 4 |

The Portal already records booking stage history, so it can calculate how long files have been in their current stage. The recommended measures are:

- **Count** — current workload.
- **Median/average age** — how the queue is moving overall.
- **Oldest file** — catches a single forgotten file that an average conceals.
- **Over-target count** — makes stalled work visible.

For phase one, the threshold can be shown transparently in the dashboard copy and set as a sensible operational default. If desired later, thresholds can become configurable settings; that is not required for the first release.

### 6. Membership watchlist

Add a **Membership dates to watch** section for agents whose:

- **Notice period ends today or in the next 14 days**;
- **Pause ends today or in the next 14 days**; or
- Notice/pause end date is already overdue.

Each row should show the agent, membership status, date, days remaining/overdue state, and a direct link to their CRM/membership record.

This should sit alongside a small summary of active, paused, in-notice, and suspended agents rather than duplicating the full Memberships dashboard.

### 7. Change requests and Agent Wins

Two smaller panels complete the daily view:

| Panel | Contents | Purpose |
|---|---|---|
| **Change requests awaiting review** | Pending count plus the latest requests: agent, requested field, age, and a Review link. | Stops profile/bank/contact changes sitting unnoticed. |
| **Latest Agent Wins** | The latest 3–5 Agent Win posts: agent, title, date, and link to the Community post. | Gives staff immediate visibility of activity worth celebrating or sharing. |

The Portal already records these items. Phase one presents the latest submissions; it does **not** introduce a separate “seen” workflow for Agent Wins. That avoids unnecessary administration while retaining a clear route to the Community page.

---

## What will be removed from the Admin Dashboard

The following are deliberately removed from the operational dashboard:

- The current generic **Requires immediate action** presentation.
- **Upcoming departures**.
- **Recent bookings**.
- Broad historical/financial reporting that is better retained in Business Intelligence and Super Admin reporting.

This makes room for the work that needs a response now: tasks, agent messages, control checks, queues, and membership dates.

---

## Interaction principles

1. **Every number leads somewhere useful.** Counts are never dead-end metrics.
2. **No duplicate working area.** Work stays in Tasks, Messages, Calendar, Bookings, Memberships, and their existing specialist screens.
3. **Personal first, team second.** Start with the signed-in admin’s tasks, then show team/unassigned work.
4. **Age matters as much as volume.** An old single item should not disappear inside a low count.
5. **A clear zero is a success state.** “Inbox zero” and “No control exceptions” should be visible and positive.
6. **No new data collection in phase one.** Reuse existing audited Portal records and do not introduce a separate dashboard-only workflow.

---

## Delivery approach

### Phase 1 — Core operational workboard (recommended first release)

1. Replace the current dashboard layout and remove departures/recent-booking modules.
2. Add the daily header, prominent task panels, unread-message panel, and today’s calendar.
3. Replace generic immediate-action cards with the three requested control checks.
4. Add active-queue cards and pipeline ageing data.
5. Add membership dates, pending change requests, and latest Agent Wins.
6. Add direct drill-down links from every card.

### Phase 2 — Optional refinements after staff use it

- Configurable queue ageing targets.
- Saved dashboard preferences (for example, collapsed calm sections).
- A lightweight “daily inbox zero achieved” indicator/history, if staff find it motivating.
- Team capacity signals, only if real workload data proves they are useful.

---

## Technical notes

- **No SQL migration expected for Phase 1.** This is a data aggregation, server query, and interface redesign.
- The existing Portal already provides:
  - booking final-supplier-payment-date checks;
  - GoCardless mandate/subscription information;
  - task status, acknowledgement, owner, due date, and booking link;
  - unread booking-message threads;
  - calendar events and recurring event rules;
  - booking pipeline history and current-stage timing;
  - agent status, notice-end, and pause-end dates;
  - pending profile change requests; and
  - Agent Win community posts.
- A dedicated, compact dashboard query should aggregate the workboard data efficiently rather than loading every full specialist-page dataset on initial render.
- All dashboard data remains internal and role-gated to admins/super admins.
