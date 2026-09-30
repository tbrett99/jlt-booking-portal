# Booking Mentions → Admin Tasks: Scoped Proposal

## Recommendation

Keep the existing **internal booking note** as the place where the team talks about the file, and use the existing **Admin Tasks** system as the accountable work queue.

When an admin selects a colleague with `@` in an internal note, the composer should offer a compact, pre-selected **Create an action task for the tagged colleague** control. Sending the note then:

1. saves the internal note exactly as it does today;
2. creates one linked task for each selected colleague when the control is on;
3. sends **one combined action notification**, rather than a separate mention alert and a separate task alert; and
4. lets the assignee acknowledge, work, comment on, or complete the task from the normal Tasks page.

This preserves the quick, familiar booking-note workflow while giving JLT a reliable record of ownership and completion. It does **not** add another work area to manage.

## What Exists Today

The Portal already has the main foundations:

| Existing capability | Current behaviour | Gap this proposal closes |
|---|---|---|
| Internal booking notes | Admins can write notes and select colleagues using `@` | A tagged colleague is notified, but no item is tracked to completion. |
| Mention notifications | A tagged admin receives an in-app alert and an email linking to the booking | There is no acknowledgement or completion state. |
| Admin Tasks | Tasks have an assignee, priority, due date, Open / In progress / Done states, booking links, comments, and in-app assignment alerts | Tasks must currently be created separately from the note. |
| Booking links | Tasks can already be linked to a booking and task comments automatically mirror into booking internal notes | There is no link back from the original mention note to the generated task. |
| Super Admin BI | The Staff tab counts tasks created and completed in the selected week | It does not show the **current outstanding queue**, ownership, overdue work, or acknowledgement state. |

The live data confirms this would solve a real visibility issue: there are **202 historical internal notes containing an `@` mention across 138 bookings**, while the current task queue contains only **7 open tasks** (6 overdue). That is why notes cannot currently be relied on as an action tracker.

## Proposed User Experience

### 1. Creating an internal note on a booking

The existing `@` selector remains unchanged. Once at least one other admin is selected, a small action row appears beneath the note:

> **Create action tasks for tagged colleagues**  [On]
>
> Tasks will be linked to this booking. Turn this off for an FYI-only mention.

- It is **on by default** once someone is tagged, because the requested workflow is normally action-led.
- An admin can turn it off when the tag is only to keep someone informed.
- The note is still sent and the tag still notifies the colleague when the control is off.
- The task title is generated from the first meaningful line of the note (with `@names` removed), with the complete note saved as the task context. This avoids a second mandatory form.
- Default task settings are **Open**, **Medium priority**, no due date. The assignee or creator can refine priority/due date in the existing task editor.

### 2. Multiple colleagues in one note

If a note tags two people with task creation enabled, the Portal creates **two separately assigned tasks**, each linked to the same booking and source note. This avoids ambiguous shared ownership.

The author is excluded from automatic assignment if they tag themselves; they can still use the existing **Create Task** button if they want a personal task.

### 3. Acknowledgement and completion

The existing status model maps cleanly to the desired behaviour:

| Task state | Meaning in the new workflow | Assignee action |
|---|---|---|
| **Open** | The action request is outstanding and not yet acknowledged | **Acknowledge / Start** |
| **In progress** | The assignee has seen it and is working on it | **Mark done** when resolved |
| **Done** | The requested action is complete | Can be reopened if further work is needed |

The task will show who acknowledged it and when, plus who completed it and when. Existing task comments remain the conversation area; because the task is booking-linked, comments continue to appear automatically in the internal booking notes.

### 4. Booking-level visibility

On the booking page:

- the original internal note carries an **Action task** status chip for each generated task: Open, In progress, or Done;
- the right-hand Booking Overview gains one compact **Admin tasks** item only when there are outstanding linked tasks;
- opening it scrolls to the relevant note/task context, rather than creating a new booking tab or panel.

This means anyone opening a booking can see at a glance whether a tagged request has been acknowledged or finished.

### 5. Super Admin oversight — inside the existing Super Admin area

Add a compact **Outstanding Admin Tasks** panel to the existing **Staff** tab in `/super-admin`, rather than a new section of the Portal.

It would include:

| View | Content |
|---|---|
| Summary cards | Outstanding, unacknowledged (Open), in progress, overdue, and due today counts |
| Team ownership table | Per admin: Open, In progress, Overdue, and Completed in selected period |
| Action queue | Booking/client, task title, assignee, state, priority, age/due date, last activity, and direct booking link |
| Filters | Assignee, state, priority, overdue, and **Created from booking mention** |

The list should default to the oldest unacknowledged / overdue work first, so it functions as a useful management queue rather than a historic report.

## Data and Technical Scope

### Database migration required

A small additive migration is needed for accountable mention-created tasks:

| Change | Purpose |
|---|---|
| `admin_tasks.sourceNoteId` (nullable) | Reliably links an automatically created task to its original internal note and prevents duplicate task creation from the same note/assignee. |
| `admin_tasks.createdFrom` (nullable enum or constrained value) | Distinguishes `booking_mention` tasks from normal manually created tasks for reporting/filtering. |
| `admin_tasks.acknowledgedAt`, `acknowledgedById` | Shows when and by whom a task was noticed / started. |
| `admin_tasks.completedAt`, `completedById` | Retains completion accountability even if the status is later reopened. |
| indexes on assignee/status/due date and source-note fields | Keeps the Super Admin outstanding queue fast as the task history grows. |

No historic notes will be converted into tasks automatically. The 202 older mentions were not necessarily requests for action, so backfilling would create misleading work. The integration applies **prospectively** once released.

### Server changes

- Make note creation return the persisted note ID.
- Replace the current name-regex-only handling for selected UI mentions with a structured, server-validated list of admin IDs.
- Create one idempotent linked task per selected non-author admin when the action control is enabled.
- Consolidate the current mention and task-assignment alerts into one clear notification and existing-style email for action tasks.
- Record acknowledgement and completion attribution when task state changes.
- Add a super-admin-only outstanding task summary/list query.

### UI changes

- Internal note composer: action-task toggle plus concise helper copy.
- Booking note list and Booking Overview: status chips/counts for linked tasks.
- Existing `/admin/tasks`: show **Created from booking mention** and source-booking context; make acknowledgment explicit rather than requiring users to infer the first status click.
- Existing `/super-admin` Staff tab: task oversight summary and filtered action queue.

## Safeguards and Improvements Included

1. **No task flood for FYI tags** — the action toggle is visible and can be turned off before sending.
2. **No duplicate alerts** — an action mention produces a single combined notification/email, not two alerts.
3. **No duplicate tasks** — the source note and assignee are stored, so retrying a request cannot create another task for the same person.
4. **Clear ownership** — each tagged colleague receives their own task, never an unowned shared item.
5. **No automatic historic backfill** — only new notes create tasks, avoiding false workload.
6. **No private-content exposure to agents** — this stays entirely within internal admin notes, admin tasks, and Super Admin reporting.
7. **No separate operational area** — booking context remains on the booking; daily working remains in Tasks; supervision remains within Super Admin.
8. **Existing task comments remain the audit trail** — booking-linked comments still mirror to internal notes, preserving one readable chain of events on the booking.

## Acceptance Criteria

- An admin can create an FYI-only mention without a task.
- An admin can create a booking-note action task for one or more selected admins/super admins in one send.
- Each assignee sees their task in **My tasks**, with an actionable booking link and no duplicate alert.
- The original booking note displays the linked task state.
- The assignee can acknowledge/start and complete the task; those names/timestamps are visible to admins and Super Admin.
- Task comments remain mirrored to the booking’s internal note history.
- Super Admin can see and filter all currently outstanding mention-created tasks, including overdue and unacknowledged items.
- Only admins and super admins can create, view, or manage the work; agents never see it.

## Validation and Release Plan

- Add focused tests for one/multiple/FYI/self mentions, idempotency, booking linking, acknowledgement/completion audit fields, notification consolidation, and super-admin filtering.
- Run focused Vitest suites, TypeScript validation, production build, and visual checks for booking notes, Tasks, and Super Admin.
- Apply the additive production migration once, checkpoint, push `main`, and verify the live booking, tasks, and super-admin routes.

## Decision Needed Before Build

**Recommended default:** show **Create action tasks for tagged colleagues** as **on by default** when an admin tags someone in an internal booking note, while allowing the author to switch it off for an FYI-only mention.

This gives the team the fast automatic behaviour requested without turning every casual tag into permanent work.
