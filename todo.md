# JLT Group Booking Portal - TODO

## Phase 1: Database Schema & Migrations
- [x] Extend users table with role enum (super_admin, admin, agent) and agentCode field
- [x] Create bookings table (clientName, departureDate, topdogRef, reimbursementsRequired, reimbursementDocUrl, status, agentId, ptsRef, topdogRef, finalSupplierPaymentDate, expectedCommission)
- [x] Create pipeline_stages table (name, order, colour)
- [x] Create booking_pipeline table (bookingId, stageId, movedAt, movedBy)
- [x] Create amendments table (bookingId, details, status, agentId, createdAt)
- [x] Create cancellations table (bookingId, confirmedAt, agentId)
- [x] Create refunds table (bookingId, refundType, supplierCount, amountToClient, refundReason, clientBankName, clientSortCode [encrypted], clientAccountNumber [encrypted], stepsTaken, agentId)
- [x] Create refund_suppliers table (refundId, supplierName, amountDue)
- [x] Create notes table (bookingId, authorId, content, isInternal, createdAt)
- [x] Create notification_templates table (triggerKey, subject, bodyHtml, updatedBy, updatedAt)
- [x] Create notification_log table (bookingId, templateKey, sentTo, sentAt)
- [x] Apply all migrations via webdev_execute_sql

## Phase 2: Auth & User Management
- [x] Extend role enum to super_admin / admin / agent
- [x] Admin-only: create agent account (name, email, generate temp password, send credentials email)
- [x] Admin-only: list all users, deactivate/reactivate accounts
- [x] Super Admin: promote/demote user roles
- [x] Login page with JLT branding
- [x] Role-based route guards on frontend
- [x] protectedProcedure variants: adminProcedure, superAdminProcedure

## Phase 3: Booking Registration & Agent Dashboard
- [x] Booking registration form (clientName, departureDate, topdogRef optional, reimbursementsRequired Y/N, document upload if Y)
- [x] Late document upload: notify admin when docs uploaded after initial submission
- [x] Agent dashboard: list own bookings with status badges (Added to PTS, Commission Claimable, Commission Claimed, Cancelled, Amendment Actioned)
- [x] Expected commission field per booking (free numeric input, visible to admin)
- [x] Commission Claim placeholder ("Coming Soon") on agent dashboard

## Phase 4: Admin Kanban Pipeline
- [x] Kanban board with all 13 stages: New Booking, Creating own PTS file, Not on Topdog, Query, Reimb Docs Missing, Urgent/Reimb, T/O Package, DP, Added to PTS, Commission Claimable, Commission Claimed, Cancelled, Holding Accounts
- [x] Drag-and-drop (or move button) to change booking stage — admin only
- [x] Booking detail panel: PTS ref, Topdog ref, final supplier payment date fields (admin editable)
- [x] Final supplier payment date triggers internal admin reminder notification
- [x] Admin can view all bookings across all agents
- [x] Super Admin can edit pipeline stage names and order

## Phase 5: Amendment, Cancellation & Refund Forms
- [x] Amendment form: search/select booking, describe changes, moves to Amendment workflow stub
- [x] Cancellation form: confirm cancellation, prompt to submit refund form if needed
- [x] Refund form: refundType (supplier/customer/both), supplier count selector, dynamic supplier fields (name + amount), amount to client, refund reason, client bank details (AES-256 encrypted at rest), steps taken
- [x] Refund, Amendment, Cancellation Kanban stubs (placeholder pipelines for future expansion)

## Phase 6: Dual Note System
- [x] Shared notes: visible to both agent and admin, WhatsApp-style thread per booking
- [x] Internal admin-only notes: never visible to agents
- [x] Immutable notes: no edit or delete
- [x] Full timestamped history with user tag
- [x] In-app notification when a shared note is added (both parties)

## Phase 7: Notification System
- [x] Email notifications via support@thejltgroup.co.uk (SMTP config)
- [x] Trigger: Not on Topdog → agent email
- [x] Trigger: Query → agent email
- [x] Trigger: Reimb Docs Missing → agent email
- [x] Trigger: Added to PTS → agent email
- [x] Trigger: Commission Claimable → agent email
- [x] Trigger: Commission Claimed → agent email
- [x] Trigger: Cancelled → agent email
- [x] Trigger: Amendment Actioned → agent email
- [x] Trigger: Final supplier payment date → internal admin reminder
- [x] Trigger: Late reimbursement doc upload → admin notification
- [x] Super Admin editable notification templates (subject + body) per trigger key
- [x] In-app notification bell with unread count

## Phase 8: Reporting Module
- [x] Report view: all bookings filterable by agent and date range
- [x] Export as CSV
- [x] Export as Excel (.xlsx)

## Phase 9: Branding & Mobile Polish
- [x] Apply Poppins font globally
- [x] Apply JLT colour palette (#70FFE8, #414141, #FFC3BC, #FFF6ED, #02E6D2)
- [x] Fully responsive layout for mobile and tablet
- [x] Consistent sidebar navigation with role-aware menu items
- [x] Loading states, empty states, and error states throughout

## Phase 10: Tests & Delivery
- [x] Vitest unit tests for key procedures (booking creation, role guards, note immutability, encryption)
- [x] Save checkpoint
- [x] Deliver to user

## Bugs
- [x] Password change on first login refreshes the page instead of completing login and redirecting to dashboard
- [x] "Rate exceeded" JSON parse error on login — auth.me hits Manus OAuth server for password-based sessions, triggering rate limit

## New Features
- [x] Admin/Super Admin view switcher — toggle between admin panel and agent-facing view (own bookings, register booking, notes etc.)
- [x] Fix SMTP port to 465 (SSL, verified working)
- [x] Add delete user feature for admin/super admin (Super Admin only, with confirmation dialog)
- [x] Create test agent account (testagent@thejltgroup.co.uk)
- [x] Fix notifications bell — full dropdown panel with unread badge, mark-all-read, deep links to bookings
- [x] System-generated audit notes on all booking actions (booking created, stage moved, amendment submitted, refund submitted, cancellation submitted, admin fields updated, reimbursement doc uploaded)
- [x] Amendment pipeline Kanban with stages: To Do / In Progress / Actioned, with assignee field and assignee visible on amendment dashboard
- [x] Refund pipeline Kanban with stages: New Refund Request / Acknowledged by Supplier / Refund Sent to PTS / Refund Received in JLT / Refund Processed, with assignee field
- [x] Commission Due tab: shows all bookings where finalSupplierPaymentDate has passed and stage is not yet Commission Claimable/Claimed/Cancelled

## Agent Flow & Commission Workflow
- [x] Fix: add system audit note in bookings.updateAdminFields mutation
- [x] Fix: verify getCommissionDueBookings excludes Commission Claimable/Claimed/Cancelled stages
- [x] DB schema: commission_claims table (bookingId, agentId, claimedAt, status: pending/paid, paidAt, paidById)
- [x] Agent sidebar: Cancel Booking shortcut with booking search & select
- [x] Agent sidebar: Request Amendment shortcut with booking search & select
- [x] Agent Commission page: sections for Not Ready / Claimable / Claimed Not Paid / Paid
- [x] Agent Commission page: Claim Commission button on claimable bookings
- [x] Admin Commission page: view all claims (pending + paid), bulk mark-as-paid with checkbox selection
- [x] Admin Commission page: individual mark-as-paid per booking
- [x] Notifications: agent notified when commission marked as paid by admin

## Commission Claim & Notifications Fixes
- [x] Fix blank notifications/templates page (super admin) — seeded 10 default templates
- [x] Add bookingType field to commission_claims (Lapland, Cruise, Disney, Other) — shown on admin commissions page
- [x] Commission claim modal: ask agent to select booking type before submitting claim
- [x] Send test email notification to max@thejltgroup.co.uk — sent successfully via port 465

## Pipeline Card & Routing Fixes
- [x] Fix 404 on amendment pipeline card click-through to booking detail
- [x] Fix 404 on refund pipeline card click-through to booking detail
- [x] Show client name + PTS ref + TD ref on amendment pipeline cards
- [x] Show client name + PTS ref + TD ref on refund pipeline cards
- [x] Bug: commission claim not appearing on admin commissions page after agent claims it (status filter was "claimed" instead of "claimed_not_paid")

## Pipeline Guardrail
- [x] Backend: reject moveStage to "Added to PTS" or any later stage if finalSupplierPaymentDate is not set
- [x] Frontend: intercept stage change in AdminKanban, show modal prompting admin to add payment date if missing, then retry move
- [x] Frontend: also guard the BookingDetail page stage-move control with the same check

## @Mention in Internal Notes
- [x] Backend: parse @mentions from note content after save, create in-app notification for each mentioned admin user
- [x] Frontend: typing @ in internal note textarea shows autocomplete dropdown of admin/super_admin users
- [x] Frontend: selecting a user inserts @Name into the note text
- [x] Frontend: render @mentions as highlighted spans in note display

## UX Polish & Agent Experience
- [x] Agent dashboard: show full booking timeline/status history per booking, not just current stage
- [x] Agent dashboard: add summary stats bar (total bookings, active, commission ready, paid)
- [x] Agent booking detail: show clear visual pipeline progress indicator (which stage the booking is at)
- [x] Agent booking detail: show expected commission prominently
- [x] Agent booking detail: show departure date countdown
- [x] Agent booking list: add search and filter by status
- [x] Admin Kanban: add payment date warning badge on cards missing the date
- [x] Admin BookingDetail: add guard dialog (modal) for missing payment date when moving stage
- [x] Global: improve empty states with helpful CTAs
- [x] Global: improve loading skeletons
- [x] Global: ensure all error messages are user-friendly
- [x] Navigation: add active state indicators to sidebar items
- [x] Mobile: review and fix any overflow/layout issues on small screens

## Future Improvements (Post-Delivery)
- [ ] Agent dashboard: surface per-booking pipeline history timeline (stage change log) on booking detail page
- [ ] Global: replace spinner-only loading states with skeleton components on key pages (dashboard, kanban, booking detail)
- [ ] Mobile: full QA pass across agent/admin pages — fix any confirmed overflow/wrapping issues

## Query Stage Message Dialog
- [ ] When moving a booking to "Query", show a dialog letting the admin compose a message to the agent before confirming the move
- [ ] Pre-populate the message with a sensible default
- [ ] Send the message as a shared note AND trigger the existing "query" notification email to the agent
- [ ] Backend: accept optional queryMessage in moveStage input

## Urgent Attention Logic
- [ ] Document and surface clearly what criteria cause a booking to appear in the urgent attention banner
- [ ] Fix any incorrect or unclear urgent attention criteria

## Agent Refund & Amendment Visibility
- [x] Agent booking detail: show amendments with status (pending/assigned/actioned) and assigned admin name
- [x] Agent booking detail: show refunds with status (new/acknowledged/sent to PTS/received/processed) and assigned admin name
- [x] Notify agent when amendment/refund is assigned to an admin
- [x] Notify agent when amendment/refund is actioned/completed

## Commission Page Enhancements
- [x] Commission summary bar: show total pending (active bookings), claimable, claimed not yet paid, and paid amounts
- [x] Prompt agents to contact JLT when commission amount is missing from their bookings (amounts are set by admins)
- [x] Show per-booking commission amount on the claimable/claimed lists
