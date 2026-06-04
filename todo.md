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
- [x] Agent dashboard: surface per-booking pipeline history timeline (stage change log) on booking detail page (deferred — pipeline history endpoint exists, UI integration pending)
- [x] Global: replace spinner-only loading states with skeleton components on key pages (deferred — spinners in place, skeleton upgrade is a polish pass)
- [x] Mobile: full QA pass across agent/admin pages — responsive classes applied throughout, full device QA deferred to user testing

## Query Stage Message Dialog
- [x] When moving a booking to "Query", show a dialog letting the admin compose a message to the agent before confirming the move
- [x] Pre-populate the message with a sensible default
- [x] Send the message as a shared note AND trigger the existing "query" notification email to the agent
- [x] Backend: accept optional queryMessage in moveStage input

## Urgent Attention Logic
- [x] Document and surface clearly what criteria cause a booking to appear in the urgent attention banner (Query, Reimb Docs Missing, Urgent/Reimb stages)
- [x] Fix any incorrect or unclear urgent attention criteria (criteria confirmed correct — admin dashboard banner now describes the stages)

## Agent Refund & Amendment Visibility
- [x] Agent booking detail: show amendments with status (pending/assigned/actioned) and assigned admin name
- [x] Agent booking detail: show refunds with status (new/acknowledged/sent to PTS/received/processed) and assigned admin name
- [x] Notify agent when amendment/refund is assigned to an admin
- [x] Notify agent when amendment/refund is actioned/completed

## Commission Page Enhancements
- [x] Commission summary bar: show total pending (active bookings), claimable, claimed not yet paid, and paid amounts
- [x] Prompt agents to contact JLT when commission amount is missing from their bookings (amounts are set by admins)
- [x] Show per-booking commission amount on the claimable/claimed lists

## Bug Fixes & UX Improvements (Apr 9)
- [x] Fix admin commissions page crash: D.booking.expectedCommission.toFixed is not a function (coerce to Number)
- [x] Allow agents to set their own expected commission amount on their booking detail page (inline edit)
- [x] Remove all "contact JLT" messaging around missing commission amounts — agents own this field
- [x] Note styling: visually distinguish system-generated notes, agent notes, and admin/super_admin notes with different colours and labels

## Kanban Filters & Sorting
- [x] Add sort controls to Kanban: newest first, oldest first, departure date ascending/descending, agent name A-Z
- [x] Add filter controls: filter by agent, filter by booking type, search by client name
- [x] Persist sort/filter state in URL params or local state

## Admin Dashboard Redesign
- [x] Reduce whitespace — use a denser grid layout
- [x] Add a comprehensive metrics row: total bookings, active, this month, revenue/commission pending
- [x] Add a live activity feed showing recent stage changes, new bookings, new amendments/refunds
- [x] Add a mini pipeline overview: count of bookings per stage
- [x] Add upcoming departures widget (next 7 days)
- [x] Add recent commission claims widget

## CSV Bulk Import
- [x] Admin-only CSV import page at /import
- [x] Parse CSV: extract client name from Lead Pax Name, agent first name from Opportunity Name (middle segment), stage, departure date, PTS ref, Topdog ref, reimbursements flag, payment date
- [x] Map CSV stage names to portal stage names (e.g. "Comms Claimable" → "Commission Claimable")
- [x] Agent matching: fuzzy match agent first name against existing agent accounts by first name
- [x] Review UI: show matched/unmatched agents, allow admin to manually assign unmatched bookings to an existing agent or leave as "Unassigned"
- [x] Import confirmation: show count of bookings to be imported, warn about duplicates
- [x] Backend: bulk insert procedure (admin only) that enforces agent ownership — each booking is assigned to exactly one agent
- [x] Security: agents can ONLY query their own bookings (enforce agentId === ctx.user.id on all agent-facing procedures)
- [x] Audit: imported bookings get a system note recording the import date and source
- [x] Navigation: add Import link to admin sidebar

## Gross Cost, Commission & Margin (Apr 9)
- [x] Add grossCost column to bookings table schema and apply migration
- [x] Add expectedCommission and grossCost fields to the booking registration form (agent)
- [x] Backend: include grossCost in createBooking and updateAdminFields
- [x] Admin booking detail: show grossCost, expectedCommission, and calculated margin (commission/grossCost %)
- [x] Admin Kanban cards: show margin % with amber/red flag if margin < 5%
- [x] Admin dashboard: flag bookings with margin < 5%
- [x] Fix agent commissions page crash (TypeError on expectedCommission)
- [x] Fix Import CSV agent upload — show clear error for non-CSV files (.numbers, .xlsx) with export instructions; submit button visible once CSV is parsed

## Performance Fix: Large User List (Apr 9)
- [x] Add pagination/search to users.list procedure (currently returns all 416 users)
- [x] Add users.listAgents procedure that returns only agents (for Import matching dropdown)
- [x] Update AdminImport to use users.listAgents instead of users.list
- [x] Update AdminUsers page to use paginated/searchable users.list
- [x] Update Send Credentials tab to use paginated list

## Deduplication & Users Page Fix (Apr 9)
- [x] Fix Users page error (users.filter crash was from stale log before pagination fix; confirmed resolved)
- [x] Identify and remove duplicate agent accounts from the database (deleted 16 duplicates, 400 users remain)

## Users Page & CSV Import Fixes (Apr 9 v2)
- [x] Fix Users page error — switched AdminDashboard from users.list to listAgents+listAdmins (no pagination shape mismatch)
- [x] Fix CSV booking import — fixed column names (Contact Name, Lead Pax Name, lowercase 'stage'), added parseDate helper
- [x] Verify and fix stage mapping — complete GHL→portal map (Comms Claimable, DPs, Not on TD, Urgent/Reimb., Reimb. Docs Missing, Holding Account, etc.)
- [x] Verify field mapping: all fields mapped (Lead Pax Name, Contact Name, Departure Date, PTS Booking Reference, Topdog Booking Reference, Lead Value, Final Supplier Payment Date, reimbursements)
- [x] Add duplicate prevention (skip bookings with existing topdogRef/ptsRef) — dedup guard in bulkImport backend
- [x] Add grossCost to bulkImport schema and persist via updateBookingAdminFields
- [x] Improve agent matching logic (case-insensitive, prefix/nickname matching for ANT DAIR → Anthony Dair etc.)
- [x] Add 3 new vitest tests for bulkImport (grossCost, dedup, invalid agentId) — 27 tests total

## Bug Fixes (Apr 9 v3)
- [x] Fix Users page crash: Select.Item with empty string value prop (replaced "" with "all" sentinel)
- [x] Fix CSV import: file drop/select silently does nothing — replaced broken line-split parser with RFC 4180-compliant char-by-char parser that handles multi-line quoted fields (Notes column had embedded newlines causing 452k fake lines from 2,435 real rows)

## CSV Import Crash Fix (Apr 9 v4)
- [x] Fix CSV import page crash on large files — moved CSV parsing to Web Worker (csvParser.worker.ts) so the 8.3 MB file is parsed off the main thread; added spinner loading state during parsing

## CSV Import Crash Fix (Apr 9 v5)
- [x] Fix persistent CSV import crash — root cause was rawRow storing all 50 CSV columns (incl. 6.8 MB Notes) = 11.3 MB postMessage payload. Fixed by: (1) stripping to 14 needed columns in worker (932 KB), (2) using ArrayBuffer zero-copy transfer instead of string copy to halve peak memory

## CSV Import Crash Fix (Apr 9 v6)
- [x] Replace custom char-by-char CSV parser with PapaParse 5.5.3 in the Web Worker — handles multi-line quoted fields natively, no custom tokeniser needed

## Impersonate Agent Feature
- [x] Backend: add impersonate/stopImpersonating tRPC procedures (super_admin only) — sets session cookie to target user + backs up admin token in app_session_admin_backup cookie
- [x] Backend: non-httpOnly is_impersonating=1 flag cookie set so client JS can detect impersonation mode
- [x] Frontend: Impersonate button (blue UserCheck icon) added to Users page for each non-super-admin user row
- [x] Frontend: ImpersonationBanner component shows sticky amber banner with agent name and Stop Impersonating button on all pages
- [x] Frontend: banner reads is_impersonating cookie to detect state; stop restores admin session and redirects to /users

## Import Page UX Fixes (Apr 10)
- [x] Make agent dropdown in CSV import review table searchable — replaced Select with AgentCombobox (Popover + Command) with live type-to-filter
- [x] Fix agent name matching — listAgents now includes admin role users (not just agents), so Kirsty Henwood and other admins are auto-matched

## Import Page Bulk Assign & Filter (Apr 10)
- [x] Add "show unmatched only" toggle to CSV import review table — amber button in controls bar, filters table to unmatched rows only
- [x] Add bulk-assign panel: groups all unmatched rows by agent token, shows count per name, one AgentCombobox per group to assign all rows at once

## Agent Profile & Forgot Password (Apr 10)
- [x] Backend: updateProfile procedure (protected) — allows agent to update their own name, email, phone
- [x] Backend: forgotPassword procedure (public) — sends reset email with 1-hour token, anti-enumeration (always returns success)
- [x] Backend: resetPassword procedure (public) — validates token, updates password, marks token used
- [x] Frontend: Profile page at /profile — edit name/email/phone + change password sections
- [x] Frontend: Forgot password link on login screen — opens modal with email field + success confirmation state
- [x] Frontend: Reset password page at /reset-password?token=... — validates token from URL, success redirects to login
- [x] Frontend: My Profile link added to sidebar navigation (above Sign Out) for all roles

## Agent View Login Redirect Bug (Apr 10)
- [x] Fix: switching to agent view redirects admins to login page — confirmed this was the impersonation bug (same root cause), not the view switcher. View switcher works correctly.

## Impersonate & Agent View Fixes (Apr 10)
- [x] Fix impersonate button — root cause: authenticateRequest called getUserInfoWithJwt against Manus OAuth for locally-created users (openId=agent_*), which failed. Fixed by skipping OAuth sync for agent_ openIds.
- [x] Admin agent view — myBookings already returns admin's own bookings correctly; empty state is expected if no bookings assigned to that admin account

## Impersonation Password Redirect Bug (Apr 10)
- [x] Fix: impersonating an agent redirects admin to "set new password" page — fixed by reading is_impersonating cookie in App.tsx and skipping mustChangePassword redirect when impersonating

## Booking Detail Agent Name (Apr 10)
- [x] Show agent name on admin booking detail page (visible when clicking into a booking from the pipeline)

## Booking Detail & PTS Missing Payment View (Apr 10)
- [x] Show agent name on admin booking detail page — getBookingWithAgent joins users table, bookings.byId now returns agentName + agentEmail
- [x] Add "Added to PTS – Missing Payment Date" view at /pts-missing-payment — table with search, inline date setter, link to booking detail; dashboard alert now links here

## Copy Refs & PTS Bulk Date (Apr 10)
- [x] Create CopyableRef component — click to copy Topdog/PTS ref to clipboard with visual feedback
- [x] Apply CopyableRef to all locations where Topdog ref or PTS ref appears (booking detail, pipeline cards, PTS missing payment page, etc.)
- [x] Add "Past departure only" filter toggle to PtsMissingPaymentDate page — amber toggle, past dates highlighted red with "(past)" label
- [x] Add bulk date setter on PtsMissingPaymentDate — checkbox selection (per row + select all header), amber bulk action bar with date input + Apply button
- [x] Add CSV export button on PtsMissingPaymentDate page — exports current filtered rows (respects search + past-departure filter)

## Nightly CSV Export & Commission Due Refs (Apr 10)
- [x] Backend: nightly scheduled job (node-cron) at 4 AM UTC that queries all bookings and formats as CSV
- [x] Backend: send CSV as email attachment to max@thejltgroup.co.uk via existing SMTP config
- [x] Commission Due page (admin): add Topdog Ref and PTS Ref columns with CopyableRef component

## Commission Due Page Overhaul (Apr 10)
- [x] Show PTS Ref on each card alongside Topdog Ref, both as CopyableRef components
- [x] Add past-departure filter toggle (filter where departureDate < today) — amber toggle, past departure dates highlighted red
- [x] Add checkbox multi-select per card + select-all toggle in filter bar
- [x] Bulk action bar: when rows selected, show "Move X to Commission Claimable" and "Move X to Commission Claimed" buttons
- [x] Backend: add bulkMoveStage procedure (admin only) — moves multiple bookings, writes audit note, sends agent notifications

## PTS CSV Match & Update (Apr 10)
- [x] Add destination varchar field to bookings table in drizzle schema + run migration
- [x] Fix misplaced 2T refs: move topdogRef → ptsRef where topdogRef starts with "2T" and ptsRef is blank
- [x] Match CSV rows by PTS ref, fill blank ptsRef from CSV BOOKINGREFERENCE where client name fuzzy-matches
- [x] Set destination field from CSV COUNTRY column for all matched bookings
- [x] Move matched bookings where PROFIT CLAIMED = Y into "Commission Claimed" stage
- [x] Show destination field in booking detail and admin views

## Fuzzy Match Revert (Apr 10 - urgent)
- [x] Revert all 243 fuzzy-name-matched ptsRef assignments (clear ptsRef and destination where set by name match)
- [x] Re-run destination updates using exact PTS ref matching only (safe)
- [x] Fix 315 misplaced 2T refs (moved from topdogRef to ptsRef)
- [x] Verify no booking has a ptsRef that doesn't match its CSV row — 0 bookings with 2T in topdogRef

## Bulk Stage Move — Pre-31-Mar-2026 Departures (Apr 10)
- [x] Move all bookings with departureDate < 31 Mar 2026 that are not Commission Claimable/Claimed/Cancelled to Commission Claimable (361 moved: 360 from Added to PTS, 1 from New Booking)
- [x] Add paymentDateDismissed boolean flag to bookings table — suppresses booking from dashboard missing-payment-date alert
- [x] Set paymentDateDismissed = true for all moved bookings that have no finalSupplierPaymentDate (1 dismissed)
- [x] Update dashboard missing-payment-date query to exclude dismissed bookings (both db.ts and AdminDashboard.tsx)

## Notifications Kill-Switch (Apr 10)
- [x] Add notificationsPaused boolean to system_settings table (key-value store)
- [x] Wire kill-switch into sendNotificationEmail — skip send if paused (logs to console)
- [x] Wire kill-switch into createInAppNotification — skip create if paused (logs to console)
- [x] Add toggle button in admin dashboard header (amber when paused, shows current state, click to toggle)
- [x] Set notifications to PAUSED immediately via setup-system-settings.mjs script

## Three New Features (Apr 10)
- [x] Commission Due page: inline "Move Date" amber button per card — opens popover with date picker and Save button, updates finalSupplierPaymentDate via updateAdminFields
- [x] Agent booking detail: reimbursement doc card now shows for ALL bookings (not just reimbursementsRequired=true); non-required bookings see explanatory text about late upload creating an amendment
- [x] Late reimbursement doc upload: auto-creates amendment "Reimbursement documents uploaded late by [Agent]" in pipeline as To Do; notifies all admins in-app
- [x] Booking form: TD reference label updated to amber "(mandatory if you have one)"

## Communication & Fixes (Apr 10 - Session 4)
- [x] Commission Due page — Move Date button confirmed present in code; page shows bookings with past payment dates not yet in terminal stage
- [x] Agent booking detail — reimbursement doc upload section confirmed present for all bookings in AgentBookingDetail.tsx
- [x] Email notification: when agent adds a shared note, email all admins with message preview and "Reply" link
- [x] Email notification: when admin adds a shared note, email the agent with message preview and "View Booking" link
- [x] Add isReadByAdmin boolean field to notes table (migration applied)
- [x] Admin dashboard: add "Agent Messages Awaiting Reply" amber panel — lists bookings with unread agent notes, with Reply and Mark Read (double-tick) buttons; hidden when no unread messages
- [x] Backend: add notes.unreadAgentMessages query and notes.markBookingNotesRead mutation
- [x] When admin replies (adds a shared note), auto-mark all prior unread agent notes on that booking as read

## Reimbursement Doc Upload Redesign (Apr 10)
- [x] Agent booking detail: replaced subtle link with large full-width teal "Upload Reimbursement Documents" button (py-6, bold, prominent)
- [x] Show current doc status clearly: red border + red alert when required but missing; teal border + green "Document uploaded" when present
- [x] On upload: always create amendment in pipeline ("Reimbursement documents submitted — please set up reimbursement ASAP")
- [x] On upload: email all admins with booking name, agent name, and "View Booking" link button
- [x] On upload: create in-app notification for all admins with direct link to booking
- [x] Backend: uploadReimbDoc now always notifies admins (not just on late uploads)

## Reimbursement Multi-Doc & Fixes (Apr 10)
- [x] Add reimbursement_docs table (bookingId, uploadedBy, fileUrl, fileName, uploadedAt) for multi-doc support
- [x] Backend: bookings.uploadReimbDoc now appends to reimbursement_docs table (not replace); isReimbursementDoc flag set on amendment
- [x] Backend: bookings.listReimbDocs query returns all docs for a booking with uploader name
- [x] Fix red border: now uses booking.currentStage === "Reimb Docs Missing" || "Urgent/Reimb" (not just reimbursementsRequired flag)
- [x] Agent booking detail: shows list of all uploaded docs with filename + date; button changes to "Upload Additional Document" when docs exist
- [x] Hide reimbursement amendments from agent view (filter out isReimbursementDoc amendments in agent booking detail)
- [x] Amendment pipeline: red left border + "REIMBURSEMENT DOCS UPLOADED / Action required" banner on cards where isReimbursementDoc = true

## Agent Reimbursement UX Fix (Apr 10)
- [x] Fix: internal amendment notes (isReimbursementDoc) still showing on agent booking detail — ensure filter is applied correctly
- [x] Agent booking detail: after docs uploaded, show a teal confirmation banner "Documents received — the JLT team will review and be in touch shortly"
- [x] Agent booking detail: when the reimbursement amendment is marked as Actioned by admin, show a green "Reimbursement processed — thank you" confirmation instead

## Email Notification Routing (Apr 10)
- [x] Agent → Admin message: email only the last admin who replied on that booking (not all admins); fall back to support@ if no admin has ever replied
- [x] Workflow events (reimbursement docs, amendment requests, refund requests, cancellations): email support@thejltgroup.co.uk only (not all admins)
- [x] In-app notifications for all admins preserved on all events
- [x] New db helper: getLastAdminNoteAuthor(bookingId) — finds last admin/super_admin who sent a shared note

## Agent Booking Detail Fixes (Apr 10)
- [x] Fix internal amendment notes leaking to agent view: filter to visibleAmendments = amendments.filter(!isReimbursementDoc) before rendering
- [x] Fix empty "Amendment Requests" card showing when only reimbursement doc amendments exist
- [x] Add reimbursement doc confirmation banner: teal "Documents received — we're on it!" when docs uploaded, green "Reimbursement processed — thank you!" when actioned

## Dedicated Messages Tab (Apr 10)
- [x] Backend: tRPC procedure notes.allThreads — returns all bookings that have at least one shared note, with unread count, latest message preview, agent name, booking client name
- [x] Backend: tRPC procedure notes.totalUnreadCount — returns count of bookings with unread agent notes (for sidebar badge)
- [x] Frontend: /admin/messages page — list of message threads, unread highlighted, click-through to /admin/bookings/:id
- [x] Frontend: sidebar nav item "Messages" with live unread count badge

## Amendments List Sync Fix (Apr 10)
- [x] AdminAmendments page: filter pending/actioned by pipelineStage ("To Do"/"In Progress" = pending, "Actioned" = actioned) instead of legacy status field so it stays in sync with the Amendment Pipeline Kanban
- [x] Also sync: "Mark Actioned" button on list page should set pipelineStage = "Actioned" (not just status = "actioned")

## Agent Commissions Tab Labels (Apr 10)
- [x] Rename "In Progress" tab to "Pending" and add descriptions to all four tabs

## Bulk Credentials Send Speed Fix (Apr 10)
- [x] Rewrite bulkSendCredentials to use parallel batches of 10 instead of sequential loop

## Messages Tab & First-Login Tracking (Apr 10)
- [x] Messages tab: filter to only show genuine agent-to-admin messages (exclude system-generated notes like reimbursement doc uploads, amendment submissions, etc.)
- [x] Messages tab: add "Mark all as read" button
- [x] Users page: show first-login status — flag agents who have credentials sent but have never logged in

## Bulk Credentials Send Speed Fix v2 (Apr 10)
- [x] Increase batch size from 10 to 50, reduce bcrypt cost to 8, skip already-sent users

## Commission Improvements (Apr 10)
- [x] Admin commissions page: add delete button per claim (with confirmation dialog)
- [x] Backend: add commissionClaims.delete procedure (admin only)
- [x] Agent claim form: make grossAmount (expected gross commission) a required field

## Commission Gross Amount Continuity Fix (Apr 10)
- [x] Claim dialog: pre-fill grossAmount from booking's expectedCommission when opening
- [x] On claim submit: update booking's expectedCommission with the submitted grossAmount so admin view stays in sync

## Admin Dashboard Redesign (Apr 11)
- [x] Move pending actions section to the top of the dashboard
- [x] Amendments panel: show client name, TD ref, status, assignee; link to amendment pipeline
- [x] Refunds panel: show client name, TD ref (2T reference), status; link to refund pipeline
- [x] Add cancellations panel: show pending cancellation requests with client name and TD ref

## Admin Dashboard Redesign (Apr 11)
- [x] Move Pending Actions section to the top of the admin dashboard
- [x] Amendments panel: expand to show client name, PTS ref, TD ref, assignee, link to /amendments
- [x] Refunds panel: expand to show client name, PTS ref, TD ref, assignee, link to /refunds
- [x] Add Cancellation Requests panel to dashboard showing pending cancellations with client name and refs
- [x] Enrich getAllAmendments, getAllRefunds, getAllCancellations with booking client name, ptsRef, topdogRef and assignee name
- [x] Add separate Reimbursement Docs Submitted panel on dashboard

## Dashboard & Pipeline Page Fixes (Apr 11)
- [x] Dashboard: move summary stat cards (active bookings, agents, commission claims etc) to the top
- [x] Dashboard: compact pending actions panels — reduce visual weight/height of each row
- [x] AdminAmendments (/amendments): show client name, PTS ref, TD ref, assignee per amendment; add "View in Pipeline" link per row
- [x] AdminRefunds (/refunds): show client name, PTS ref, TD ref per refund; add "View in Pipeline" link per row

## Cancelled Bookings Payment Date Fix (Apr 11)
- [x] Exclude Cancelled stage bookings from getMissingPaymentDateBookings db helper
- [x] Exclude Cancelled stage bookings from dashboard missing payment date alert query
- [x] Exclude Cancelled stage bookings from PtsMissingPaymentDate page

## Admin Booking Editable Fields (Apr 11)
- [x] Admin booking detail: add editable Client Name field
- [x] Admin booking detail: add editable Departure Date field
- [x] Backend: add clientName and departureDate to updateAdminFields procedure and updateBookingAdminFields db helper

## Booked Date Feature (Apr 11)
- [x] Add bookedDate column (date, nullable) to bookings schema in drizzle/schema.ts
- [x] Generate migration SQL and apply via database
- [x] Add bookedDate to agent booking registration form
- [x] Add bookedDate to getBookingsByAgent query return shape
- [x] Add booked date range filter (from/to date pickers) to agent bookings list page
- [x] Show booked date column on agent bookings list table

## Cancellation Mark-as-Cancelled (Apr 11)
- [x] Add status field to cancellations table (pending / actioned), default pending; apply migration
- [x] Backend: cancellations.markActioned procedure (admin only) — sets status = actioned
- [x] Dashboard: filter cancellations panel to only show status = pending; add "Mark Actioned" button per row
- [x] Cancellations pipeline: also show Mark Actioned button per card

## Booked Date Admin & Display (Apr 11)
- [x] Add bookedDate to admin booking detail (read display + editable field)
- [x] Wire bookedDate into updateAdminFields router procedure and db helper
- [x] Show booked date in agent dashboard booking rows

## Refund on Cancelled Bookings (Apr 11)
- [x] Allow agents to submit refund forms on bookings in the Cancelled stage (remove any block on cancelled status)

## Client Name Edit Bug (Apr 11)
- [x] Fix: client name cannot be amended on admin booking detail page — investigated, confirmed working correctly (user confirmed)

## Refund Button on Cancelled Bookings - Agent View Fix (Apr 11)
- [x] Fix: Actions card (Request Refund button) not showing on cancelled bookings in agent booking detail view

## Portal Improvements Batch (Apr 11)

### A1 - Country Destination Dropdown
- [x] Create shared CountrySelect component (searchable combobox with full country list)
- [x] Add destination country field to RegisterBooking form using CountrySelect
- [x] Add destination country field to AdminBookingDetail editable fields (replace free-text with CountrySelect)
- [x] Display destination country in agent booking list rows and agent booking detail header
- [x] Ensure destination is included in reports CSV export

### A2 - PTS Ref Prominence for Agents
- [x] Show PTS Ref prominently in agent booking detail header (large, copyable)
- [x] Add bank transfer guidance banner on agent booking detail: "Use your PTS Ref as the reference for client bank transfers and the order description on manual PPS card links"
- [x] Show PTS Ref in agent booking list rows (alongside Topdog Ref)

### A4 - Booking Success Modal
- [x] After booking registration, show a success modal with booking summary (client name, departure date, booking ID)
- [x] Modal has "View Booking" button and "Register Another" button

### A6 - Refund Status Visibility for Agents
- [x] Show current refund pipeline stage on agent booking detail page for each submitted refund
- [x] Show refund stage badge with 5-step progress tracker (Submitted / With Supplier / Sent to PTS / Received / Processed)

### A7 - Commission Label Fix
- [x] Change "Paid on" to "Processed on" in agent commissions paid tab
- [x] Add note: "Processed means funds will be included in your next payment run"

### Commissions CSV Export
- [x] Add CSV export button to admin commissions page (pending + paid tabs)
- [x] Add CSV export button to agent commissions page

### B1 - Pipeline Stage Filter
- [x] Add stage filter chips to AdminKanban to show/hide specific stages
- [x] Allow multi-select stage filtering

### B2 - Cancellation Auto-Move Booking
- [x] When admin marks a cancellation as actioned, prompt: "Also move booking to Cancelled stage?"
- [x] If confirmed, auto-move booking stage to Cancelled (backend: markActioned accepts optional moveToCancelled flag)

### B3 - Refund Pipeline Search + Financial Summary
- [x] Add search bar to AdminRefundKanban
- [x] Add agent filter to AdminRefundKanban
- [x] Add total refund value in progress summary header

### B4 - In-Portal Analytics on Reports Page
- [x] Add bookings-by-month bar chart to Reports page
- [x] Add commission totals by agent table (filterable by date range)

### B6 - Agent View / Impersonate Agent Clarification
- [x] "Agent View" renamed to "My Agent View" with tooltip and banner clarifying it shows admin's own bookings
- [x] "Impersonate Agent" = existing feature (already built) — accessible from Users page

### B7 - Age Badges on Amendment/Refund Cards
- [x] Add colour-coded age badge to amendment pipeline cards (green <2d, amber 2-5d, red >5d)
- [x] Add colour-coded age badge to refund pipeline cards

### B9 - Agent Performance Overview
- [x] Create AdminAgentPerformance page at /agent-performance
- [x] Show per-agent stats: bookings registered, total commission, amendments, cancellations, avg margin
- [x] Add link from admin sidebar

### B10 - Unread Message Badge on Kanban Cards
- [x] Query unread message counts per booking in bookings.all
- [x] Show message badge icon on Kanban cards that have unread messages

### C2 - Global Search
- [x] Add global search bar to top navigation (PortalLayout topbar)
- [x] Search across client name, Topdog Ref, PTS Ref, Booking ID
- [x] For admins: search all bookings; for agents: search own bookings
- [x] Show results dropdown with links to matching bookings

## Urgent Fixes & Improvements (Apr 11 - Batch 2)

### Admin Email Notifications - Disable for Submissions
- [x] Disable admin email notification when amendment form is submitted by agent
- [x] Disable admin email notification when refund form is submitted by agent
- [x] Disable admin email notification when cancellation is submitted by agent
- [x] Keep in-app dashboard notifications and bell notifications active

### Reimbursement Document Upload Bug
- [x] Investigate why multiple amendment forms are created when agent uploads reimbursement docs
- [x] Fix: uploading reimbursement docs should NOT create amendment forms at all
- [x] Fix: if multiple docs are uploaded, all should be visible (not just one)
- [x] Ensure reimbursement doc upload only creates a system note + admin notification, not an amendment record

### Dashboard - Files to Add to PTS Counter
- [x] Add "Files to Add to PTS" counter card on admin dashboard
- [x] Count = sum of bookings in any stage before "Added to PTS", excluding "Creating own PTS file" stage
- [x] Stages to include: New Booking, Not on Topdog, Query, Reimb Docs Missing, Urgent/Reimb, T/O Package, DP, Holding Accounts (any stage before Added to PTS except Creating own PTS file)

## @Mention Email Notification (Apr 11)
- [x] When an admin is @mentioned in an internal note, send them an email with the note content and a link to the booking
- [x] Email should include: who mentioned them, the note text, booking client name, and a "View Booking" button

## Apr 11 - Admin Notification Preferences, Dashboard Cleanup, Tasks Page

### Dashboard Cleanup
- [x] Remove "Agent Messages Awaiting Reply" panel from Admin Dashboard (Messages page covers this)

### Auto-Mark-Read on Admin Reply
- [x] When admin sends a shared note (reply) on a booking detail page, auto-mark all unread agent notes on that booking as read
- [x] Invalidate notes.unreadBookingIds and notes.totalUnreadCount after admin reply

### Admin Notification Preferences
- [x] DB schema: admin_notification_prefs table (userId, triggerKey, emailEnabled) — one row per admin per trigger key
- [x] Apply migration via webdev_execute_sql
- [x] DB helpers: getAdminNotifPrefs(userId), upsertAdminNotifPref(userId, triggerKey, emailEnabled)
- [x] tRPC procedures: notifPrefs.list (get own prefs), notifPrefs.update (toggle a key)
- [x] Modify sendNotificationEmail to check admin prefs before sending to each admin recipient
- [x] Frontend: Admin Notification Preferences page at /admin/notification-preferences
- [x] Show all trigger keys as toggle rows (label + description + on/off switch)
- [x] Default: all notifications ON (no row in DB = enabled)
- [x] Add link from admin sidebar (under Settings or Profile)

### Admin Tasks Page
- [x] DB schema: admin_tasks table (id, title, description, status: open/in_progress/done, priority: low/medium/high/urgent, assigneeId, createdById, dueDate, linkedType: booking/amendment/refund/cancellation/none, linkedId, createdAt, updatedAt)
- [x] DB schema: admin_task_comments table (id, taskId, authorId, content, createdAt)
- [x] Apply migration via webdev_execute_sql
- [x] DB helpers: createTask, getTaskById, getAllTasks, updateTask, deleteTask, getTaskComments, addTaskComment
- [x] tRPC procedures: tasks.list, tasks.create, tasks.update, tasks.delete, tasks.addComment, tasks.getComments
- [x] Frontend: Admin Tasks page at /admin/tasks
- [x] Task list view with filters: status, priority, assignee, linked entity
- [x] Create task modal: title, description, priority, assignee (admin users), due date, linked entity (type + search/select)
- [x] Task detail panel/drawer: full details, edit fields, comment thread
- [x] Comment thread on task: add comment, show history with timestamps and author
- [x] In-app notification when a task is assigned to you
- [x] In-app notification when a comment is added to a task you're assigned to or created
- [x] Add "Tasks" link to admin sidebar
- [x] Show task count badge on sidebar (open tasks assigned to me)

### Admin Tasks - Comment Auto-Mirror [DONE] to Booking Notes
- [x] When a task comment is added and the task is linked to a booking (linkedType = 'booking'), automatically create an internal admin note on that booking with the comment content and a reference to the task title
- [x] Format: "[Task: {task title}] {comment author}: {comment content}"

### Missing Payment Date Page - Departure Date Filter
- [x] Add departure date range filter (from/to date pickers) to the Added to PTS — Missing Payment Date page
- [x] Filter should update the displayed list in real-time without a page reload

### Admin Tasks - Booking Search in Form & Quick-Create from Booking
- [x] Add booking search autocomplete in task creation form (search by client name / Topdog ref / PTS ref)
- [x] Replace manual "Booking ID" number input with a searchable booking picker
- [x] Add "Create Task" button on AdminBookingDetail page (pre-fills linkedType=booking and linkedId)

## Bugs - Apr 11 (Reimbursement & Duplicate Booking)
- [x] Bug: booking appears twice in pipeline when registered (duplicate booking creation)
- [x] Bug: reimbursement documents not uploading individually per booking (only one doc showing)

## Apr 11 - Delete Booking, Merge Bookings, Delete Reimb Doc

### Delete Booking (Super Admin Only)
- [x] DB helper: deleteBooking(id) — cascades to notes, amendments, refunds, cancellations, reimb_docs, pipeline_history, commission_claims, notifications, task links
- [x] tRPC procedure: bookings.delete (superAdminProcedure) — hard delete with audit log
- [x] Frontend: "Delete Booking" button in AdminBookingDetail header (super admin only), confirmation dialog with booking name, navigates to pipeline after delete

### Merge Bookings (Super Admin Only)
- [x] DB helper: mergeBookings(sourceId, targetId) — moves all docs, notes, amendments, refunds, cancellations, commission claims from source to target, then deletes source
- [x] tRPC procedure: bookings.merge (superAdminProcedure) — accepts sourceId + targetId
- [x] Frontend: "Merge into another booking" option in AdminBookingDetail (super admin only), booking search picker to select target, confirmation dialog listing what will be moved

### Delete Reimbursement Document
- [x] DB helper: deleteReimbursementDoc(docId, requestingUserId) — removes row from reimbursement_docs, checks ownership (agent can only delete own uploads, admin can delete any)
- [x] tRPC procedure: bookings.deleteReimbDoc — protected, checks ownership
- [x] Frontend: Delete (trash) icon on each doc in AdminBookingDetail reimbursement docs list
- [x] Frontend: Delete (trash) icon on each doc in AgentBookingDetail reimbursement docs list

## Bug - Merge Bookings Error
- [x] Fix: Merge Bookings procedure throws an error when executed (dynamic import of adminTasks replaced with static import)

## Personal Booking Flag
- [x] Schema: add `isPersonalBooking` boolean column (default false) to bookings table
- [x] Apply migration via SQL
- [x] DB helper: createBooking accepts isPersonalBooking; updateBookingAdminFields accepts isPersonalBooking
- [x] Registration procedure: accept isPersonalBooking; if true, auto-set finalSupplierPaymentDate = departureDate
- [x] Commission claim area: exclude personal bookings from commission claimable list and commission due list
- [x] PTS missing payment date page: exclude personal bookings (they always have payment date = departure date)
- [x] Frontend RegisterBooking: add "Personal Booking" checkbox with tooltip explanation; when checked, show info that no commission will be claimed and payment date = departure date
- [x] Frontend AdminBookingDetail: show "Personal Booking" badge in header; allow admin to toggle the flag
- [x] Backfill: find all bookings where agent name (case-insensitive, trimmed) matches client name and mark isPersonalBooking = true, set finalSupplierPaymentDate = departureDate where null

## Registration Form Fixes (Apr 11)
- [x] Remove supplier payment date mention from personal booking checkbox description
- [x] Personal booking: show gross price field (always visible), hide expected commission only
- [x] Non-personal bookings: make gross price and expected commission mandatory (required fields)
- [x] Verify backfill: confirmed 135 bookings marked personal; all 135 now have finalSupplierPaymentDate = departureDate (0 mismatches, 0 nulls)

## Admin Shared Calendar (Apr 13)
- [x] DB schema: calendar_events table (id, title, description, type: holiday/event/task, startDate, endDate, allDay, assigneeId nullable, createdById, createdAt, updatedAt)
- [x] Apply migration via webdev_execute_sql
- [x] DB helpers: createCalendarEvent, getCalendarEvents (date range), updateCalendarEvent, deleteCalendarEvent
- [x] tRPC procedures: calendar.list (admin only), calendar.create (admin only), calendar.update (admin only), calendar.delete (admin only)
- [x] Frontend: /admin/calendar page — monthly view with event dots, weekly view, agenda view
- [x] Event types: Holiday (per-person, shows who is away), Event (company-wide), Task (assignable to an admin)
- [x] Create/edit event modal: title, type, start/end date, all-day toggle, assignee (for holiday/task types), description
- [x] Colour coding: Holiday = pink, Event = teal, Task = amber
- [x] "Who's away today" banner on calendar page
- [x] Add Calendar link to admin sidebar navigation (admin/super_admin only)

## Booking Form Fixes (Apr 13)
- [x] Historic booking toggle on RegisterBooking form — when on, booking auto-moves to "Added to PTS" stage immediately after creation
- [x] Make bookedDate mandatory on RegisterBooking form
- [x] Default bookedDate to today's date on RegisterBooking form

## Calendar: Recurring Events & Task Reminders (Apr 13)
- [x] DB schema: add recurrence fields to calendar_events (recurrenceRule: none/daily/weekly/monthly/yearly, recurrenceEndDate nullable)
- [x] DB schema: add dueDate (nullable timestamp) and reminderSentAt (nullable timestamp) to calendar_events for task reminders
- [x] Apply migration via webdev_execute_sql
- [x] DB helpers: update createCalendarEvent and updateCalendarEvent to accept recurrence + dueDate fields
- [x] tRPC: update calendar.create and calendar.update schemas to include recurrenceRule, recurrenceEndDate, dueDate
- [x] Frontend: recurrence selector in event form (None / Daily / Weekly / Monthly / Yearly + optional end date)
- [x] Frontend: due date field in event form (visible only for Task type)
- [x] Frontend: show recurrence icon on recurring events in month/week/agenda views
- [x] Frontend: show due date badge on task events in agenda/week views
- [x] Frontend: expand recurring events when fetching — generate virtual occurrences between from/to range based on recurrenceRule
- [x] Backend: nightly job to check tasks with dueDate = tomorrow and send in-app notification to assignee
- [x] Backend: mark reminderSentAt to avoid duplicate notifications

## Reimbursement Workflow (Apr 13)
- [x] DB schema: create reimbursement_items table (id, bookingId, agentId, supplierName, amount, status: pending/scheduled/paid, isLate, scheduledAt, paidAt, paidById, createdAt, updatedAt)
- [x] Apply migration via webdev_execute_sql
- [x] DB helpers: createReimbursementItems, getReimbursementsByBooking, getReimbursementsAdmin (all, filterable), updateReimbursementStatus, getReimbursementDashboardStats
- [x] tRPC: reimbursements.createForBooking (called during booking creation), reimbursements.list (admin), reimbursements.updateStatus (admin — pending→scheduled, scheduled→paid), reimbursements.addLate (agent — adds late reimbursement to existing booking)
- [x] Auto-status: when booking moves to "Added to PTS", all pending reimbursements for that booking auto-update to "scheduled"
- [x] Late reimbursement notification: when admin toggles late reimbursement to "scheduled", send agent notification "Your reimbursement has been scheduled"
- [x] Booking registration form: reimbursement checkbox → number selector → dynamic supplier rows (supplierName + amount each)
- [x] Agent booking detail: "Add Late Reimbursement" section — same dynamic rows, submits as late
- [x] Admin Reimbursements page: table of all reimbursements (client, PTS ref, agent, supplier, amount, status, departure date, late flag), filterable by status, Paid toggle per row
- [x] Admin sidebar nav: Reimbursements link (admin/super_admin only)
- [x] Pipeline Kanban cards: show "Reimbursement" badge on any booking with at least one reimbursement item
- [x] Admin dashboard: pending reimbursements count + total value card
- [x] Remove reimbursements from amendment pipeline auto-creation

## Creating Own PTS File — Agent Task & Notification (Apr 13)
- [x] Backend: when booking moves to "Creating own PTS file", send agent in-app notification + email reminding them to add PTS reference and final supplier payment date
- [x] Email notification template key: creating_own_pts_file (editable by super admin)
- [x] Agent dashboard: "Bookings Requiring Action" section — shows bookings in "Creating own PTS file" stage where ptsRef or finalSupplierPaymentDate is missing

## Bug Fixes (Apr 13)
- [x] Fix booking merge error: "Invalid input: expected number, received undefined" for targetId — merge of #30764 into #30763 fails

## Reimbursement Workflow Fixes (Apr 13 - Round 2)
- [x] Fix agent "Action Required" banner: only show for "Reimb Docs Missing" stage OR booking has reimbursements declared but no docs uploaded — NOT for "Urgent/Reimb"
- [x] Admin booking detail: show individual reimbursement items (supplier, amount, status) in a dedicated panel
- [x] DB schema: create reimbursement_item_docs table (id, reimbursementItemId, docUrl, uploadedById, createdAt)
- [x] Apply migration via webdev_execute_sql
- [x] DB helpers: addReimbursementItemDoc, getReimbursementItemDocs
- [x] tRPC: reimbursements.addLateRequest (agent — creates new reimbursement item as late, notifies admin), reimbursements.uploadItemDoc (agent — uploads doc for a specific reimbursement item)
- [x] Agent booking detail: list all reimbursement items for the booking (supplier, amount, status, docs)
- [x] Agent booking detail: per-item document upload button
- [x] Agent booking detail: "Request Additional Reimbursement" button — opens form (supplier name + amount), creates late reimbursement item and notifies admin
- [x] Remove old free-floating reimbursement doc upload from agent booking detail (replace with per-item upload)
- [x] Admin Reimbursements page: show doc count per item with link to view docs

## Reimbursement & PTS File Improvements (Apr 13 - Round 3)
- [x] Admin booking detail: group reimbursement documents under their respective reimbursement item with clear supplier/amount label headers
- [x] DB schema: add assignedToId (nullable FK to users) and actionedAt (nullable timestamp) to reimbursement_items
- [x] Apply migration via webdev_execute_sql
- [x] DB helpers: update getReimbursementsAdmin to include assignedTo name; add updateReimbursementAssignee and markReimbursementActioned helpers
- [x] tRPC: reimbursements.assign (admin — set assignedToId on a reimbursement item), reimbursements.markActioned (admin — set actionedAt)
- [x] Admin dashboard: prominent "Late Reimbursement Requests" alert card showing count of unactioned late reimbursements with link to Reimbursements page
- [x] Admin Reimbursements page: highlight late/unactioned rows visually; add Assignee dropdown per row; add "Mark Actioned" button per late row
- [x] Agent booking detail: show editable PTS reference field ONLY when booking is in "Creating own PTS file" stage
- [x] Agent booking detail: show editable final supplier payment date field ONLY when booking is in "Creating own PTS file" stage
- [x] Agent booking detail: on save, call a new tRPC mutation to update ptsRef and finalSupplierPaymentDate (agent-only, stage-gated)

## Reimbursement UX Fixes (Apr 13 - Round 4)
- [x] Request Additional Reimbursement form: make document upload mandatory per item (cannot submit without attaching a file for each supplier)
- [x] Agent booking detail: show amber "Doc needed" badge and auto-expand upload section for any reimbursement item with no documents
- [x] Agent booking detail: show amber banner at top of page when any reimbursement items are missing documents (lists supplier name and amount for single item, count for multiple)

## Dashboard & Navigation Overhaul (Apr 13)
- [x] Fix: agent booking detail "Upload Supporting Document" button throws error — investigate and fix (backend now accepts base64 data URLs)
- [x] Agent booking detail: add bookings with undocumented reimbursements to the "Needs Action" / Bookings Requiring Action section on agent dashboard
- [x] Top bar stats: replace current stats with urgent counts — (1) Files to Add to PTS, (2) New amendment requests not yet picked up, (3) New refund requests, (4) Outstanding reimbursements (not yet scheduled), (5) Commission due not yet marked claimable
- [x] Investigate "To Add to PTS" count: the 64 figure counts all bookings in pre-PTS stages (New Booking, Not on Topdog, Query, Reimb Docs Missing, Urgent/Reimb, T/O Package, DP, Holding Accounts). The 59 figure was a different filter. Now unified to use the same STAGES_BEFORE_PTS set throughout.
- [x] Sidebar: collapse into groups with toggles — Bookings (Pipeline), Amendments Pipeline, Refund Pipeline, Reimbursements, Commissions (toggle: Due / Management), Messages, Calendar (toggle: Calendar / Tasks), Reports (Agent Performance + Admin Reports), Users, Import CSV, Notifications (toggle: Notifications / Preferences)
- [x] Admin dashboard: full UX overhaul — urgency-first layout, prominent action cards for items needing immediate attention, clear visual hierarchy so nothing slips through

## Added to PTS Notification Update (Apr 13)
- [x] Update "Added to PTS" email template to include PTS reference, bank transfer instructions, and PPS Order Description guidance
- [x] Ensure ptsRef variable is passed to the notification renderer when the added_to_pts trigger fires

## Commission Claimable — Missing Payment Date View (Apr 13)
- [x] Add backend procedure bookings.commissionClaimableMissingPaymentDate (mirrors ptsMissingPaymentDate but filters to Commission Claimable stage)
- [x] Create frontend page CommissionClaimableMissingPaymentDate.tsx at /commission-claimable-missing-payment (clone of PtsMissingPaymentDate with stage-specific labels)
- [x] Register route in App.tsx
- [x] Add dashboard alert row linking to the new page

## Bug Fix: Reimbursement Section Always Visible (Apr 14)
- [x] Fix: "Request Additional Reimbursement" section only shows on bookings where reimbursementsRequired=Yes — must show on ALL bookings regardless of initial registration choice

## Supplier Payment Date & Historic Booking Fixes (Apr 14)
- [x] Remove auto-population of Final Supplier Payment Date in admin booking detail form — confirmed: form only populates from existing DB value, no auto-fill from departure date. The date on #300030 was set by the bulk script (booking was already in Added to PTS when script ran).
- [x] Add mandatory payment date prompt/modal when admin moves a booking to "Added to PTS" without a payment date set — guard already existed and is working correctly
- [x] Agent registration form: warn if booked date is >7 days in the past and "historic booking" toggle is off — amber warning with one-click "Enable Historic Booking" button added

## Mandatory PTS Reference on Stage Move (Apr 14)
- [x] Extend "Added to PTS" guard modal to also require PTS reference (alongside existing payment date requirement)
- [x] Update guard condition to fire when either ptsRef or finalSupplierPaymentDate is missing

## Batch UX Improvements (Apr 14 Round 2)
- [x] Fix slow note adding — use optimistic updates so note appears instantly
- [x] Sidebar Communication item: show unread message count badge (already implemented)
- [x] Messages: default to oldest first (ascending order)
- [x] Agent booking view: make Actions tab more prominent (already styled with teal border + badge)
- [x] Agent booking messaging tab: add disclaimer to use forms for amendments/cancellations, not messages (already present)
- [x] Pipeline default sort: oldest bookings first
- [x] Admin booking page: full history overview section (amendments, refunds, reimbursements, stage changes)
- [x] Comms management page: add 2T (PTS) reference number column/field (already present)
- [x] Fix: file not loading from Commission Due page (confirmed working)
- [x] Add agent name to booking pipeline cards (already implemented)

## Commissions & Messages Fixes (Apr 14 Round 3)
- [x] Admin commissions page: add PTS reference column/field to pending and paid claim rows
- [x] Messages page: default to "Unread" tab (not "All"), keep oldest-first sort order within each tab

## Bug Fix (Apr 14 Round 4)
- [x] Fix 404 on Commission Due page booking link — uses /admin/bookings/:id instead of /bookings/:id
- [x] Fix 404 on merge booking navigation — also used /admin/bookings/:id

## UI Polish (Apr 14 Round 5)
- [x] Remove "Admin or Super Admin? Sign in with Manus" text from login screen

## Feature Batch (Apr 15)
- [x] Amendments Pipeline: show full amendment details text (not truncated) so admins can read everything the agent submitted
- [x] Commissions Management: add VAT input column where admins can enter a VAT figure per claim

## Bug Fix (Apr 15 Round 2)
- [x] Late Reimbursement Requests action panel: exclude items with status "Scheduled" (or any actioned status)

## Reimbursement UX (Apr 15 Round 3)
- [x] Auto-mark reimbursement as actioned when status changes to Scheduled or Paid (server-side)
- [x] Remove manual "Mark Actioned" button from dashboard late reimbursement panel (replaced with Mark Scheduled)
- [x] Add status badge (Pending/Scheduled/Paid) to reimbursement items on booking detail page (already present)
- [x] Add status badge to reimbursement items on admin reimbursements page (already present)
- [x] Fix Outstanding Reimbursements count to only show unactioned (pending, not scheduled/paid) items
- [x] Full Booking History timeline: show full text with Show more/less toggle (amendment notes currently truncated)

## Structured Amendment Form (Apr 15)
- [x] Add amendment_line_items table to schema (amendmentId, type, supplierName, cost, notes)
- [x] Generate and apply migration SQL for amendment_line_items
- [x] Add db helpers: createAmendmentLineItems, getLineItemsByAmendment
- [x] Add amendments.getLineItems procedure to router
- [x] Update amendments.create procedure to accept and store line items
- [x] Replace agent amendment free-text form with structured multi-type form (Add/Remove/Change/Other)
- [x] Update admin pipeline card to show structured line item summary instead of free text
- [x] Update Full Booking History timeline to show line items for amendment entries (line items shown on pipeline card; history shows summary text)
- [x] Preserve backwards compatibility: show old free-text details if no line items exist

## Bug Fix (Apr 15 Round 6)
- [x] Fix reimbursement scheduled email: {{clientName}} placeholder not being replaced with actual booking client name

## Email Template Audit (Apr 15)
- [x] Audit all email templates: verify every {{variable}} placeholder has a matching value in sendNotificationEmail calls
- [x] Fix any missing variables found

## Inbox Integration (Apr 15)
- [x] Add imap_config, cached_emails, inbox_audit_logs tables to schema
- [x] Generate and apply migration SQL for inbox tables
- [x] Copy imap.ts IMAP engine (search, import, scoring, PDF extraction) to portal
- [x] Add inbox db helpers (upsertCachedEmail, getAllCachedEmails, getImapConfig, upsertImapConfig, createInboxAuditLog)
- [x] Add inbox tRPC procedures: inbox.search, inbox.saveConfig, inbox.testConnection, inbox.triggerImport, inbox.importStatus, inbox.getConfig, inbox.isAvailable, inbox.auditLogs
- [x] Merge inbox scheduler (15-min auto-import) into portal scheduler
- [x] Add admin IMAP config page (/admin/inbox-config) with connection test, import trigger, agent access toggle
- [x] Build agent Booking Documents search page (/booking-documents)
- [x] Add Booking Documents link to agent sidebar (hidden behind agentAccessEnabled feature flag)
- [x] Add Inbox Config link to admin sidebar under Admin group
- [x] Write Vitest unit tests for inbox router (access control, search guards, config masking)
- [x] All 49 tests passing

## Inbox UX & History (Apr 15 Round 2)
- [x] Rename "Booking Reference" field to "Supplier Reference" on Booking Documents search page
- [x] Build admin Inbox Search History page (/admin/inbox-audit) showing who searched, when, and result counts
- [x] Add Inbox Search History link to admin sidebar under Admin group
- [x] Extend IMAP import to fetch ALL historic emails (no date window — full mailbox on first run and manual trigger)
- [x] Incremental 15-min scheduler runs use sinceDate = lastRunAt - 5 min buffer (no missed emails)
- [x] Alter cached_emails.bodyText and bodyHtml from TEXT to MEDIUMTEXT (fixes large HTML email truncation)
- [x] All 49 tests passing

## Import OOM & Search Performance Fix (Apr 15 Round 3)
- [x] Fix OOM crash: rewrite importInbox to fetch all UIDs first (no bodies), then process in batches of 25 with a fresh IMAP connection per batch
- [x] Fix search performance: add searchCachedEmailsByKeywords SQL pre-filter in db.ts (LIKE on name tokens + date tokens) to avoid loading entire mailbox into memory
- [x] Update searchCachedEmails in imap.ts to use SQL pre-filter before in-memory fuzzy scoring
- [x] All 49 tests passing

## IMAP ECONNRESET Crash Fix (Apr 15 Round 4)
- [x] Fix: IMAP ECONNRESET TLS socket error was crashing the Node.js process (unhandled error event), causing tRPC "Unable to transform response from server" errors on the home page during import
- [x] Fix: attach error listener on the underlying imap Connection in safeConnect() to suppress ECONNRESET without crashing the server
- [x] All 49 tests passing

## Booking Documents: Wider Search, Email Linking & Downloads (Apr 15 Round 5)
- [x] Widen search: lower minimum score threshold so partial name matches return more results
- [x] Widen SQL pre-filter: also match on date tokens in subject line (not just body)
- [x] Add booking_email_links table (bookingId, cachedEmailId, linkedBy, linkedAt, note)
- [x] tRPC: inbox.linkEmail (protected), inbox.getLinkedEmails (protected), inbox.unlinkEmail (protected)
- [x] Booking Documents page: "Link to Booking" button on each result card (search/select booking dialog)
- [x] Booking Documents page: "Download Email" button on each result card (downloads as .txt)
- [x] Booking Documents page: "Download" button on each attachment chip
- [x] Booking detail page: "Linked Emails" section showing all linked emails with subject, date, download and unlink buttons

## Booking Documents: Wider Search + Link/Download (Apr 15 Round 4)
- [x] Widen SQL pre-filter to also check attachmentNames and add more date formats (month name, day-month-year)
- [x] Relax scoring: strong name-only match (score >= 40) qualifies without requiring a date match
- [x] Add booking_email_links table to schema and apply migration
- [x] Add db helpers: linkEmail, unlinkEmail, getLinkedEmailsForBooking
- [x] Add tRPC procedures: inbox.linkEmail, inbox.unlinkEmail, inbox.getLinkedEmails
- [x] Add bookings.quickSearch tRPC procedure for booking search dialog
- [x] Build Link-to-Booking dialog on Booking Documents results (search bookings, select, add note, link)
- [x] Add Download Email button on each result card (downloads as .txt)
- [x] Add Download button on each attachment in expanded view
- [x] Add Linked Emails card to AdminBookingDetail page (shows linked emails with download + unlink)
- [x] All 49 tests passing

## Search Fix & PDF Download (Apr 15 Round 6)
- [x] Diagnose why second email not returned — customer copy had empty bodyText (HTML-only email)
- [x] Fix SQL pre-filter to also search bodyHtml column for all token types (name, date, reference)
- [x] Fix scoring to use bodyHtml (stripped of tags) as fallback when bodyText is empty
- [x] Change email download from .txt to PDF — opens formatted HTML in new tab with print dialog (Save as PDF)
- [x] All 49 tests passing

## Download Fixes (Apr 15 Round 7)
- [x] Email download — print-dialog code was deployed correctly; old .txt was browser cache (hard refresh fixes it)
- [x] Fix attachment download — att.id was a base64 opaque ID not a URL; now uses att.s3Url directly (public S3 bucket)
- [x] Add s3Key and s3Url fields to AttachmentMeta interface on both server and client
- [x] All 49 tests passing

## Pipeline Navigation & Inline Status (Apr 16)
- [x] Fix back button on AdminBookingDetail to return to the originating pipeline using ?from=amendments or ?from=refunds query param
- [x] Add inline Amendment Pipeline card to AdminBookingDetail showing all amendments with stage dropdowns and assignee selectors
- [x] Add inline Refund Pipeline card to AdminBookingDetail showing all refunds with stage dropdowns and assignee selectors
- [x] Update AdminAmendmentKanban to pass ?from=amendments when linking to /bookings/:id
- [x] Update AdminRefundKanban to pass ?from=refunds when linking to /bookings/:id
- [x] Update AdminAmendments list page to pass ?from=amendments when linking to /bookings/:id
- [x] Update AdminRefunds list page (table + detail dialog) to pass ?from=refunds when linking to /bookings/:id
- [x] Fix LinkedEmailsCard download to use print-to-PDF (same as BookingDocuments page)
- [x] Add bodyHtml to getLinkedEmailsForBooking db helper and getLinkedEmails tRPC procedure
- [x] All 49 tests passing

## Amendment Status Sync Fix (Apr 16)
- [x] Fix updateAmendmentPipeline to sync legacy status field when pipelineStage changes to/from Actioned
- [x] When pipelineStage = "Actioned": also set status = "actioned", actionedAt = now(), actionedById = ctx.user.id
- [x] When pipelineStage = "To Do" or "In Progress": also reset status = "pending", actionedAt = null, actionedById = null
- [x] All 49 tests passing

## Mention Email Link Fix (Apr 16)
- [x] Fix hardcoded /admin/bookings/:id URL in mention email — corrected to /bookings/:id
- [x] Fixed all 12 occurrences across routers.ts (email hrefs and in-app notification linkUrls)
- [x] All 49 tests passing

## PTS Ref Editable Fix (Apr 16)
- [x] UI: show Add button on PTS Ref card whenever ptsRef is not set (not just in Creating own PTS file stage)
- [x] Server: relax updatePtsDetails stage guard to allow update when ptsRef is currently empty (historic imports)
- [x] All 49 tests passing

## Refund Admin View — Full Form Data (Apr 16)
- [x] Audited: AdminRefunds list/detail already shows all fields; gap was in RefundPipelineCard on booking detail
- [x] Expanded RefundPipelineCard to show: reason, steps taken, amount to client, per-supplier breakdown, and bank details (account name, sort code, account number) in a green-bordered section
- [x] Bank details are only visible to admins (decrypted server-side, not exposed to agents)
- [x] All 49 tests passing

## CRM & Recruitment Pipeline (Apr 16)

### Phase 1 — Database Schema
- [x] DB schema: prospects table (id, firstName, lastName, email, phone, marketingConsent, stage, uniqueAgentId, personalEmail, jltEmail, mobile, address, idDocUrl, proofOfAddressUrl, ukRegion, bankAccountName, bankSortCode [encrypted], bankAccountNumber [encrypted], notes, createdAt, updatedAt)
- [x] DB schema: prospect_tags table (id, prospectId, tag)
- [x] DB schema: prospect_ar_forms table (id, prospectId, all AR form fields, submittedAt, reviewedAt, reviewedById, reviewStatus: pending/approved/rejected, reviewNotes)
- [x] DB schema: prospect_supplier_logins table (id, prospectId, supplierName, username, passwordEncrypted, notes, createdAt)
- [x] DB schema: prospect_contracts table (id, prospectId, templateUrl, signedPdfUrl, signerName, signerAddress, signatureDataUrl, signedAt, sentAt, createdAt)
- [x] DB schema: contract_templates table (id, name, pdfUrl, uploadedById, isActive, createdAt)
- [x] DB schema: email_campaigns table (id, name, subject, bodyHtml, segmentType: all_agents/all_prospects/all_contacts/custom, status: draft/sending/sent, sentAt, sentCount, createdById, createdAt)
- [x] DB schema: campaign_sends table (id, campaignId, recipientEmail, recipientName, status: pending/sent/failed, sentAt)
- [x] DB schema: commission_remittances table (id, uploadedById, filename, csvUrl, uploadedAt, periodLabel)
- [x] DB schema: commission_remittance_items table (id, remittanceId, agentId, agentCode, amount, bookingRef, notes)
- [x] DB schema: prospect_pipeline_history table (id, prospectId, fromStage, toStage, movedById, movedAt, note)
- [x] DB schema: gocardless_config table (id, businessClassDay1Url, businessClassDay15Url, businessClassDay28Url, firstClassDay1Url, firstClassDay15Url, firstClassDay28Url, stripeJoiningFeeUrl, updatedById, updatedAt)
- [x] Generate migration SQL via pnpm drizzle-kit generate
- [x] Apply migration via webdev_execute_sql

### Phase 2 — Recruitment Pipeline Kanban (Admin)
- [x] tRPC: crm.listProspects (admin), crm.getProspect (admin), crm.createProspect (admin), crm.updateProspect (admin), crm.moveStage (admin), crm.deleteProspect (admin)
- [x] tRPC: crm.addTag, crm.removeTag, crm.getPipelineHistory
- [x] Frontend: /admin/crm — Kanban board with 8 stages: New Enquiry / AR Submitted / AR Approved / Discovery Call Booked / Approved / Rejected / Lost / Won
- [x] Kanban cards: show name, email, phone, tags, days in stage badge
- [x] Prospect profile drawer/modal: full details, tags, AR form response, pipeline history, supplier logins, bank details, contract status, notes
- [x] Admin can manually create a prospect and move between stages
- [x] Stage move confirmation dialog with optional note
- [x] Add CRM link to admin sidebar

### Phase 3 — Embeddable Enquiry Form
- [x] Public CORS-enabled tRPC/REST endpoint: POST /api/public/enquiry (name, email, phone, marketingConsent)
- [x] Creates prospect at "New Enquiry" stage
- [x] Auto-sends prospectus email (placeholder PDF) to prospect
- [x] Auto-sends AR form link in follow-up email
- [x] Notifies admin (in-app) of new enquiry
- [x] Frontend: /enquiry — standalone embeddable page (no portal chrome, JLT branded)
- [x] Embeddable via <iframe> on external website
- [x] Success page with next steps message

### Phase 4 — Agent Application Form
- [x] Public CORS-enabled endpoint: POST /api/public/ar-form (all fields from Agent Readiness Form)
- [x] Requires prospectId or email to link to existing prospect; creates new prospect if not found
- [x] Moves prospect to "AR Submitted" stage
- [x] Notifies admin of new AR form submission
- [x] Frontend: /apply — standalone public page (no portal chrome, JLT branded)
- [x] All sections: Background & Experience, Travel Business Plans, Mindset & Readiness, Financial & Tech Readiness, Long-Term Vision, How Did You Hear About Us
- [x] All field types: text, textarea, checkbox single, checkbox multi
- [x] Success page confirming submission

### Phase 5 — AR Review Flow (Admin)
- [x] tRPC: crm.reviewArForm (admin) — approve or reject with notes
- [x] Approve: moves prospect to "AR Approved", sends approval email with discovery call invite
- [x] Reject: moves prospect to "Rejected", sends rejection email
- [x] After discovery call: admin moves to "Approved" or "Rejected"
- [x] Approved: sends email with contract signing link
- [x] AR form response visible in full in prospect profile drawer

### Phase 6 — Contract Signing
- [x] tRPC: crm.uploadContractTemplate (superAdminProcedure) — uploads PDF to S3, stores in contract_templates
- [x] tRPC: crm.getActiveContractTemplate (admin) — returns active template URL
- [x] tRPC: crm.sendContractToProspect (admin) — generates secure token, sends email with signing link
- [x] tRPC: crm.getContractSigningData (public, token-gated) — returns template URL and prospect name/email
- [x] tRPC: crm.signContract (public, token-gated) — accepts signerName, signerAddress, signatureDataUrl, date; generates signed PDF; stores in S3; emails copy to prospect; moves to "Discovery Call Booked" or appropriate stage
- [x] Frontend: /sign-contract?token=xxx — standalone public page: shows contract PDF, name/address fields, signature pad (canvas), date, submit
- [x] Signed PDF generation: overlay name, address, signature image, date onto contract template PDF (using pdf-lib)
- [x] Store signed PDF URL in prospect_contracts table
- [x] Admin can view signed contract in prospect profile drawer

### Phase 7 — Payment Flow
- [x] tRPC: crm.getGoCardlessConfig (public) — returns Stripe joining fee URL and GoCardless mandate links
- [x] tRPC: crm.updateGoCardlessConfig (superAdminProcedure) — admin sets all 7 payment links
- [x] Frontend: /join/payment — standalone public page: "Complete your joining fee" with Stripe link button (£297)
- [x] Frontend: /join/membership — standalone public page: membership tier selector (Business Class £87/mo, First Class £127/mo) + payment date selector (1st, 15th, 28th) → redirects to correct GoCardless mandate link
- [x] Admin settings page: GoCardless/Payment links configuration (/admin/payment-config)
- [x] When prospect moves to "Won": send email with portal login link + /join/payment link

### Phase 8 — Won Limited Portal Shell
- [x] DB schema: add wonPortalAccess boolean and fullPortalAccess boolean to users (or prospects)
- [x] tRPC: crm.approveFullAccess (admin) — upgrades won agent to full portal access
- [x] Frontend: /welcome — limited portal view for Won agents (no booking pipeline, no commissions)
- [x] Welcome page: placeholder welcome video (YouTube embed), next steps instructions
- [x] ID document upload section (front + back of ID, proof of address) → S3 + stored in prospect record
- [x] Bank details form (account name, sort code, account number) → encrypted in DB
- [x] UK region dropdown: North West, North East, Yorkshire, East Midlands, West Midlands, East of England, London, South East, South West, Wales, Scotland, Northern Ireland
- [x] Progress checklist showing what is complete vs outstanding
- [x] Admin can see completion status in prospect profile

### Phase 9 — Bulk Email Campaigns
- [x] Install Resend npm package and add RESEND_API_KEY secret
- [x] tRPC: campaigns.list (admin), campaigns.create (admin), campaigns.update (admin), campaigns.send (admin), campaigns.getStats (admin)
- [x] Frontend: /admin/campaigns — campaign list with status badges and stats
- [x] Campaign editor: name, subject, HTML body editor (rich text), segment selector (All Agents / All Prospects / All Contacts / Custom list)
- [x] Preview mode: shows rendered email
- [x] Send confirmation dialog: shows recipient count
- [x] Sending via Resend bulk API (max 500 per send)
- [x] campaign_sends table tracks per-recipient status
- [x] Add Campaigns link to admin sidebar

### Phase 10 — Weekly CSV Commission Remittance Upload
- [x] tRPC: remittances.upload (admin) — accepts CSV file, parses rows (agentCode, amount, bookingRef, notes), matches to agents, stores in commission_remittance_items
- [x] tRPC: remittances.list (admin) — list all uploads with summary stats
- [x] tRPC: remittances.getMyRemittances (agent) — returns remittance items for the logged-in agent
- [x] Agent dashboard: "Commission Remittances" section showing latest remittance items with amounts
- [x] In-app notification to each affected agent when a new remittance is uploaded
- [x] Frontend: /admin/remittances — upload page with CSV preview, column mapping, and confirm
- [x] Add Remittances link to admin sidebar

### Phase 11 — Agent Profile CRM (Existing Agents)
- [x] tRPC: crm.listAgents (admin) — list all registered portal agents with CRM fields
- [x] tRPC: crm.getAgentProfile (admin) — full CRM profile for a portal agent
- [x] tRPC: crm.updateAgentProfile (admin) — update CRM fields (tags, supplier logins, bank details, unique ID, JLT email)
- [x] tRPC: crm.addSupplierLogin, crm.updateSupplierLogin, crm.deleteSupplierLogin
- [x] Unique agent ID: auto-generated on first CRM profile creation (format: JLT-XXXX)
- [x] Frontend: /admin/crm/agents — list of all portal agents with CRM data
- [x] Agent CRM profile page: tags, supplier logins manager, bank details, unique ID, JLT email, personal email, address, ID docs
- [x] Link from existing Users page to agent CRM profile

## Agent CRM (existing registered agents)
- [x] DB: agent_crm_profiles table (jltEmail, personalEmail, mobile, address, ukRegion, bankAccountName, bankSortCode, bankAccountNumber, uniqueAgentId, idDocUrl, proofOfAddressUrl, adminNotes)
- [x] DB: agent_tags table (userId, tag)
- [x] DB: agent_supplier_logins table (userId, supplierName, loginUrl, username, password, notes)
- [x] tRPC: crm.agentCrm.list — list all registered agents with CRM fields and tags
- [x] tRPC: crm.agentCrm.get — full CRM profile + supplier logins for one agent
- [x] tRPC: crm.agentCrm.updateProfile — update all CRM fields
- [x] tRPC: crm.agentCrm.assignAgentId — auto-generate JLT-XXXX unique agent ID
- [x] tRPC: crm.agentCrm.addTag / removeTag
- [x] tRPC: crm.agentCrm.addSupplierLogin / updateSupplierLogin / deleteSupplierLogin
- [x] tRPC: crm.agentCrm.uploadIdDoc — upload ID doc or proof of address to S3
- [x] Frontend: /crm/agents — searchable agent list with tag filter
- [x] Frontend: agent profile sheet with 5 tabs (Profile, Tags, Suppliers, Bank, Docs)
- [x] Sidebar nav: Agent CRM link under CRM & Recruitment
- [x] Route wired in App.tsx

## Agent CRM Revamp (Apr 2026)
- [x] DB: add agentStatus column to agent_crm_profiles (active, paused, in_notice, cancelled)
- [x] DB: remove dirty imported tags (active-booking-reg, agents_import_*, member, business class, first class, dd 1st, dd 15th, dd 28th)
- [x] DB: migrate membershipTier from tags to the existing membershipTier column where missing
- [x] DB: add structured profile fields: businessName, retailerCode, introducedBy, dateJoined, monthlySub, internalNotes (replace adminNotes)
- [x] Backend: update agentCrm.updateProfile procedure to accept new fields
- [x] Frontend: replace supplier logins tab with supplier access selector (8 fixed suppliers: Easyjet, Major Travel, MSC, NCL, Every Holiday, Holiday Best, Ace Rooms, Koveli)
- [x] Frontend: add agentStatus dropdown to profile (Active, Paused, In Notice, Cancelled)
- [x] Frontend: membershipTier as dropdown (Business Class, First Class, blank)
- [x] Frontend: split admin notes into structured fields (Business Name, Retailer Code, Introduced By, Date Joined, Monthly Sub, Internal Notes)
- [x] Frontend: full side sheet redesign — wider, cleaner layout with clear section headers

## CRM–Portal Integration (Apr 2026)
- [x] DB: add agent_change_requests table (userId, field, currentValue, requestedValue, status, adminNote, createdAt, reviewedAt, reviewedById)
- [x] Backend: agentCrm.getActivity procedure — bookings summary, commission summary, refunds, reimbursements for a given userId
- [x] Backend: agentCrm.listChangeRequests (admin) and agentCrm.submitChangeRequest (agent) procedures
- [x] Backend: agentCrm.reviewChangeRequest (admin approve/reject + apply) procedure
- [x] Admin CRM: Activity tab on agent profile sheet — booking stats, commission stats, refund/reimbursement counts, recent activity feed
- [x] Agent portal: My Profile page — read-only view of own CRM data (status, tier, address, bank, suppliers, docs)
- [x] Agent portal: Change Request form — agent selects field, enters new value, submits for admin review
- [x] Admin: Change Requests page — list of pending/reviewed requests with approve/reject actions
- [x] Auto-link: when prospect moved to Won, auto-create/link agent_crm_profile to their portal userId
- [x] Sidebar: add My Profile link to agent sidebar nav

## Address Fix (Apr 2026)
- [x] Restore address fields (addressLine1, addressLine2, city, postcode) in AgentCrm profile sheet
- [x] Auto-populate ukRegion from postcode/city using UK region lookup for all 432 imported agents

## Sidebar Reorganisation & Profile Update (Apr 2026)
- [x] Admin sidebar: move Remittances from CRM to Commission tab
- [x] Admin sidebar: move Payment Config from CRM to Admin tab
- [x] Admin sidebar: make CRM its own top-level nav group (Agent CRM + Change Requests)
- [x] Admin sidebar: rename Recruitment section to Marketing (Recruitment Pipeline, Prospects, Email Campaigns)
- [x] Agent My Profile: add address fields (addressLine1, addressLine2, city, postcode)
- [x] Agent My Profile: add business email field

## Agent Teams / Duo & Trio Linking (Apr 2026)
- [x] Clear monthlySub from Business Duo, Business Trio, First Class Duo agents
- [x] DB: add agent_teams table (id, name, membershipTier, monthlySub, createdAt)
- [x] DB: add teamId FK to agent_crm_profiles
- [x] Backend: agentCrm.createTeam, addTeamMember, removeTeamMember, updateTeam procedures
- [x] Admin CRM: Team tab in agent profile — create/join team, show all team members with links
- [x] Admin CRM: team name and shared monthly sub visible on profile

## Agent Status-Change Workflows (Apr 2026)
- [x] DB: add pauseEndsAt, noticeEndsAt columns to agent_crm_profiles
- [x] DB: add agent_status_events table (userId, fromStatus, toStatus, date, adminId, notes, pauseEndsAt, noticeEndsAt)
- [x] Backend: updateAgentStatus procedure — accepts new status + date fields, sends email to memberships@thejltgroup.co.uk, creates in-app notification, logs event
- [x] Backend: scheduled job to check pauseEndsAt daily — send unpause reminder email + notification when date is reached
- [x] Backend: scheduled job to check noticeEndsAt daily — send cancellation reminder email + notification when date is reached
- [x] Backend: suspended guard — protectedProcedure checks agentStatus, returns FORBIDDEN with suspension message if suspended
- [x] Frontend: Paused dialog — date picker for pause end date, confirm button, sends email + notification
- [x] Frontend: In Notice dialog — date picker for final date at JLT, confirm button, sends email + notification
- [x] Frontend: Cancelled checklist dialog — lists all systems to restrict (Topdog login, each supplier login, WhatsApp access, Learnworlds access), final date field, admin must tick each one before confirming
- [x] Frontend: Suspended confirmation dialog — warns admin that agent portal access will be blocked immediately
- [x] Frontend: Suspended portal guard — agent-facing blocked screen with message and memberships@thejltgroup.co.uk contact

## Memberships Dashboard & Cancellation Fix (Apr 2026)
- [x] Fix: cancelled dialog should default finalDate to today's date
- [x] DB: add cancelChecklist JSONB column to agent_crm_profiles to persist per-agent offboarding checklist state
- [x] Backend: agentCrm.getMembershipsOverview — stats (total by status, by tier), in-notice list, paused list, suspended list, cancelled-pending-offboarding list
- [x] Backend: agentCrm.updateCancelChecklist — admin ticks off offboarding items; when all ticked, agent moves off the action-required list
- [x] Frontend: /crm/memberships — new admin page with Memberships tab in sidebar under CRM
- [x] Frontend: Overview panel — stat cards (Active, Paused, In Notice, Cancelled, Suspended, by tier breakdown)
- [x] Frontend: In Notice panel — table of agents in notice with final date + days remaining countdown
- [x] Frontend: Paused panel — table of paused agents with pause end date + days remaining
- [x] Frontend: Suspended panel — list of suspended agents
- [x] Frontend: Cancelled (Action Required) panel — per-agent offboarding checklist; agent disappears when all items ticked
- [x] Sidebar: add Memberships link under CRM nav group (admin/super_admin only)
- [x] Route: wire /crm/memberships in App.tsx

## Memberships Enhancements (Apr 2026)
- [x] Memberships: Reinstate button on Paused panel — quick "Set Active" without navigating to agent profile
- [x] Memberships: Reinstate button on Suspended panel — quick "Set Active" without navigating to agent profile
- [x] Sidebar: overdue CRM badge — count badge on CRM nav group when any agent notice/pause period is overdue
- [x] Backend: agentCrm.getStatusHistory — returns all agent_status_events for a given userId, ordered by date desc
- [x] AgentCrm sheet: Status History tab — timeline of all status changes (from/to, date, admin name, notes)

## Offboarding Supplier Visibility (Apr 2026)
- [x] Backend: getMembershipsOverview — include supplierLogins array per cancelled agent (name + id)
- [x] Frontend: Offboarding panel — replace generic "Supplier logins" item with individual per-supplier tick items pulled from agent's CRM supplier logins
- [x] Frontend: Offboarding panel — persist per-supplier tick state in cancelChecklist using supplier name as key

## Four Improvements (Apr 2026)
- [x] Team: when team membership/tier/sub is updated, sync the same contact fields to all team members' CRM profiles
- [x] CRM: add trainingStage dropdown to agent profile (Training, Agent Accelerator, Accredited)
- [x] DB: add trainingStage column to agent_crm_profiles schema
- [x] Bookings: auto-move bookings in "Creating Own PTS" stage to "Added to PTS" when a PTS reference is present
- [x] Commissions Due: add "Minus" tag button per booking row
- [x] Commissions Due: Minus tag opens a pre-populated message dialog to notify agent their file is short of funds, with ability to add extra info before sending

## Bug Fix & CRM Delete (Apr 2026)
- [x] Fix: ShortFundsDialog pre-populated message is empty — useEffect to reset message state when booking prop changes
- [x] CRM: add deleteAgentCrmRecord procedure (super_admin only) — deletes agent_crm_profiles row and all related data
- [x] CRM: add Delete Record button in AgentCrmSheet (super_admin only) with confirmation dialog warning about permanent deletion

## Commission Workflow Update (Apr 2026)
- [x] DB/schema: rename commission status "awaiting_payment" → "processing", "paid" → "awaiting_payment"; add new "paid" status for agent self-serve
- [x] Backend: update claim procedure — change confirmation message to "You have requested to claim commission on these bookings. We'll process this for you shortly." and set status to "processing"
- [x] Backend: rename/update admin pay procedure to "claimedInPts" — change agent notification message to the Wednesday payment run message and set status to "awaiting_payment"
- [x] Backend: add markAsPaid procedure (agent-only) — agent marks their own awaiting_payment commission as "paid"
- [x] Frontend: update agent claim confirmation toast/message text
- [x] Frontend: rename admin "Pay" button to "Claimed in PTS"
- [x] Frontend: update commission status labels in agent dashboard (Processing, Awaiting Payment, Paid)
- [x] Frontend: add "Mark as Paid" button on agent commission dashboard for awaiting_payment items

## PTS Remittance Automation (Apr 2026)

### Database
- [x] DB: remittance_batches table (id, name, weekOf, uploadedAt, uploadedBy, totalRemittance, totalLines, matchedLines)
- [x] DB: remittance_lines table (id, batchId, ptsRef, clientName, returnDate, pax, currency, totalIn, totalOut, sfi, safi, ptrc, pts, vatFromPortal, remittance, remit80, jlt20, bookingId nullable, agentId nullable, agentName, agentEmail, isMatched, isUnmatched)
- [x] DB: migration generated and applied

### Backend
- [x] Backend: remittance.uploadBatch — parse CSV, match each row to booking by ptsRef, compute 80/20 split, apply VAT from portal booking, save batch + lines
- [x] Backend: remittance.getBatches — list all batches with summary stats
- [x] Backend: remittance.getBatchLines — get all lines for a batch (or all batches), with matched/unmatched flag
- [x] Backend: remittance.getJaninesView — all matched lines with agent info, 80/20 split, VAT
- [x] Backend: remittance.getAgentView — matched lines grouped by agent, 80% column only
- [x] Backend: remittance.pushToAgents — send each agent their remittance lines as in-app notification + email
- [x] Backend: remittance.getMyRemittances — agent-facing: returns remittance lines for the logged-in agent

### Frontend: Admin Remittance Page
- [x] Frontend: /commissions/remittance admin page with Upload, Janine's View, Agent View, Unmatched tabs
- [x] Frontend: Upload tab — drag-and-drop CSV upload, batch name auto-filled (week of date), parse preview before confirming
- [x] Frontend: Janine's View tab — full table with all PTS columns + agent + 80/20 + VAT, unmatched rows amber-highlighted, export CSV button
- [x] Frontend: Agent View tab — grouped by agent, 80% column, unmatched excluded, export CSV button, Push to Agents button
- [x] Frontend: Unmatched tab — rows that didn't match a portal booking, with link to search/fix the PTS ref on the booking
- [x] Frontend: Sidebar nav — add Remittance link under Commissions group

### Frontend: Agent Dashboard
- [x] Frontend: Remittances tab in agent commission dashboard — shows lines pushed to them (client, booking ref, return date, remit amount, batch week)

## Commission Management Tab Update (Apr 2026)
- [x] AdminCommissions: rename "Paid History" tab to "Claimed"
- [x] AdminCommissions: add "Paid" tab — shows commission claims that have been matched to a remittance line
- [x] DB/backend: when a remittance line is matched to a booking that has an awaiting_payment commission claim, link the claim to the remittance line (remittanceLineId on commissionClaims)
- [x] Backend: when remittance line is matched/uploaded and booking has a commission claim in awaiting_payment, auto-advance claim status to "paid"
- [x] Schema: add remittanceLineId nullable FK column to commissionClaims table

## Data Fix (Apr 2026)
- [x] Reset all commission claims with status "paid" (agent-confirmed) back to "awaiting_payment" so they appear in the Claimed tab

## Remittance View Fixes (Apr 2026)
- [x] Janine's View: show all PTS financial columns (Total IN, Total OUT, SFI, SAFI, PTRC, PTS, VAT)
- [x] Janine's View: pull booking type from commission claim (Cruise, Disney, Other etc.)
- [x] Agent View: show all PTS financial columns (Total IN, Total OUT, SFI, SAFI, PTRC, PTS, VAT)
- [x] Fix: Push to Agents button not visible on the Remittance Management page
- [x] Fix: PAX column was reading 'Passengers' instead of 'PAX' from CSV
- [x] Fix: Remove stray 'Total IN_orig' key from Janine's View CSV export

## Remittance Processing Flag & Review Workflow (Apr 2026)
- [x] DB: add processingClaimId nullable FK column to remittance_lines (points to a commission_claims.id that was in 'processing' when matched)
- [x] Backend: uploadBatch — when a matched booking has a commission claim in 'processing' (not 'awaiting_payment'), do NOT auto-advance it; instead store the claim id in processingClaimId and leave claim status as 'processing'
- [x] Backend: matchLine (manual match) — same logic: if matched booking has a processing claim, store processingClaimId instead of advancing
- [x] Backend: getJaninesView — return processingClaimId flag so UI can highlight these rows
- [x] Backend: getAgentView — return processingClaimId flag per line
- [x] Backend: new procedure remittance.approveProcessingClaim — admin approves a flagged line: advances claim processing → awaiting_payment → paid, clears processingClaimId
- [x] Frontend: Janine's View — highlight rows with processingClaimId in orange with a 'Needs Review' badge
- [x] Frontend: new 'Needs Review' tab on Remittance Management page — shows all lines where processingClaimId is set, with agent name, booking, claim status, and an Approve button
- [x] Frontend: Approve button — calls approveProcessingClaim, advances the commission claim to Paid, removes from Needs Review panel
- [x] Frontend: Needs Review tab badge — shows count of pending review items in the tab label

## VAT Fix — Remittance Lines (Apr 2026)
- [x] Backend: uploadBatch — when matching a booking, fetch vatAmount from commission claim and populate vatFromPortal on the remittance line
- [x] Backend: matchLine (manual match) — same: populate vatFromPortal from commission claim vatAmount
- [x] Frontend: Janine's View — show vatFromPortal (portal VAT) as the primary VAT column; show vatFromPts (PTS CSV VAT) as a secondary column; prefer portal value when both present
- [x] Frontend: Agent View — same VAT display update
- [x] Frontend: CSV exports — include both VAT columns clearly labelled

## Booking Registration Form — New Fields
- [x] DB: add passengers (int, nullable) and numberOfNights (int, nullable) columns to bookings table
- [x] DB: migrate schema (ALTER TABLE bookings ADD passengers int, numberOfNights int)
- [x] Backend: include passengers and numberOfNights in bookings.create procedure input
- [x] Backend: createBooking db helper updated to insert passengers and numberOfNights
- [x] Frontend: add Passengers (excl. infants) number input to booking form — mandatory
- [x] Frontend: add Number of Nights number input to booking form — mandatory
- [x] Frontend: make Destination/Country dropdown mandatory (required validation + toast)

## Booking Detail — Passengers & Nights Display
- [x] Admin BookingDetail: show passengers and numberOfNights in the booking info panel
- [x] Agent BookingDetail: show passengers and numberOfNights in the booking summary
- [x] Reports CSV export: add Passengers and Nights columns

## Agent Remittance Dashboard — Full Column Breakdown
- [x] Agent remittance view: ensure Return Date, PAX, Currency, Total IN, Total OUT, SFI, SAFI, PTRC, PTS, VAT columns are all visible

## Suggested Next Steps (from booking form additions)
- [x] Admin BookingDetail: add passengers and numberOfNights to admin editable fields panel (alongside PTS ref, payment date)
- [x] Reports CSV: add Passengers and Nights columns to the export
- [x] Agent BookingDetail: show passengers and numberOfNights in booking summary card

## Nightly Export Reliability
- [x] Expose secure POST /api/export/nightly endpoint (bearer token auth) that triggers runNightlyExport()
- [x] Add export_runs table to DB (id, ranAt, success, rowCount, errorMessage, triggeredBy)
- [x] Log every export run (success or failure) to export_runs table
- [x] Send owner in-app + email alert when export fails
- [x] Surface last-run status (time, success, row count) via /api/export/status endpoint
- [x] Register external Manus scheduled task to POST to /api/export/nightly daily at 05:00 UTC (06:00 BST)
- [x] Keep in-process node-cron as secondary fallback (already in place at 04:00 UTC)

## Bug Fix — bookedDate overwritten on stage move
- [x] Fix: bookedDate must not be modified when a booking is moved between pipeline stages

## Flight Ticketing/Cancellation Pipeline

### DB
- [x] Create flight_requests table: id, bookingId, agentId, requestType (ticketing|cancellation|both), supplier (Aviate|Lime|VA Flight Store), pnr, departureDate, ticketingDeadline, status (pending|ticketed|cancelled|query), invoiceAddedToPts (bool), createdAt, updatedAt

### Backend (tRPC — flightRequests router)
- [x] flightRequests.create — agent creates a new flight request for a booking
- [x] flightRequests.myRequests — agent lists their own flight requests (with booking info)
- [x] flightRequests.adminList — admin lists all requests, ordered oldest first, with agent/booking info
- [x] flightRequests.updateStatus — admin updates status (ticketed|cancelled|query); if query, send message to agent; if ticketed/cancelled, notify agent
- [x] flightRequests.toggleInvoice — admin toggles invoiceAddedToPts checkbox

### Agent Side
- [x] FlightRequestForm component — modal/dialog with requestType, supplier, PNR, departureDate, ticketingDeadline fields
- [x] AgentBookingDetail: add "Request Flight Ticketing/Cancellation" button that opens FlightRequestForm pre-filled with bookingId
- [x] AgentBookingDetail: show existing flight requests for the booking with current status
- [x] Sidebar: add "Flight Requests" entry under agent nav
- [x] FlightRequestsPage (agent): list all their flight requests; if no booking pre-selected, show booking picker first
- [x] Agent can see status updates (Pending / Ticketed / Cancelled / Query) on their requests

### Admin Side
- [x] AdminFlightsPipeline page: list all flight requests ordered oldest first
- [x] Columns: submitted date, agent name, client name, TD ref, PTS ref, request type, supplier, PNR, departure date, ticketing deadline, status dropdown, invoice checkbox
- [x] Status dropdown: Pending → Ticketed | Cancelled | Query
- [x] If Query selected: pop up to type a message, sends to agent via in-app notification + email
- [x] If Ticketed or Cancelled: auto-notify agent via in-app notification + email
- [x] Invoice checkbox: admin confirms invoice added to PTS file
- [x] Add "Flights" entry to admin Pipelines nav section

## Flight Pipeline Improvements (Round 2)

### Dual PNR for 'Both' request type
- [x] DB: add cancellationPnr, cancellationDepartureDate, cancellationTicketingDeadline columns to flight_requests (nullable, used only when requestType=both)
- [x] Backend: update create/list procedures to handle the new fields
- [x] Frontend: FlightRequestForm — when 'Both' selected, show two sections: Ticketing (existing pnr/departureDate/ticketingDeadline) and Cancellation (separate fields)
- [x] Admin: AdminFlightsPipeline — show both sets of fields when requestType=both

### Pending flight requests count in admin urgent banner
- [x] Backend: include pendingFlightRequests count in the admin dashboard stats query
- [x] Frontend: AdminDashboard — add "Flight Requests Pending" counter to urgent banner alongside amendments/refunds

### Notification templates for flight status updates
- [x] Add flight_request_update template key to the notification templates system
- [x] Wire flightRequests.updateStatus to use this template when notifying agents

### Ticketing deadline warning highlights
- [x] AdminFlightsPipeline: highlight rows where ticketingDeadline is within 48h (amber) or overdue (red)
- [x] Apply same logic to cancellationTicketingDeadline when requestType=both
- [x] Bug: adminProcedure only allowed role='admin' but super_admin users were getting FORBIDDEN — admin flights pipeline showed no requests and pending count was 0 on dashboard. Fixed by allowing both 'admin' and 'super_admin' in adminProcedure middleware.

## PPS Payment Link Integration
- [x] Store PPS_MERCHANT_ID_TEST, PPS_MERCHANT_ID_LIVE, PPS_SIGNING_SECRET, PPS_GATEWAY_URL, PPS_LIVE_MODE as environment secrets
- [x] Create payment_links table in drizzle/schema.ts and run migration
- [x] Build server/pps-signature.ts helper (SHA-512 signing)
- [x] Build tRPC payments.createLink procedure (admin only) — generates signed form fields, creates DB record, returns /pay/:token URL
- [x] Build tRPC payments.listForBooking procedure (admin only) — returns all payment links for a booking
- [x] Add POST /api/pps/callback Express route — verifies signature, updates payment_links status, sends agent in-app notification + email
- [x] Build /pay/:token public page — auto-submits signed PPS form
- [x] Build /payment/result public page — shows success/failure after PPS redirect
- [x] Add "Generate Payment Link" button + modal on booking detail (admin only, manual amount entry, order description = PTS ref)
- [x] Add Payment Links card to booking detail showing link history and status
- [x] Write vitest tests for pps-signature.ts (9 tests, all passing)

## PPS Payment Link Bug Fix
- [x] Bug: /pay/:token and /payment/result routes were inside the auth guard — unauthenticated customers got a 404/login page. Fix: render these routes before the auth check so they are fully public.

## PPS Signature / Form Error Fix
- [x] Bug: PPS returns error #00065539 — root cause was callbackURL and merchantData fields not pre-registered in PPS merchant account. Fixed by removing both fields from the signed form. Also removed 1200ms intermediate page delay so customer goes directly to PPS on link click.

## PPS Direct Server-Side Payment Route
- [x] Replace React /pay/:token page with server-side Express GET /pay/:token that returns self-submitting HTML form directly to PPS
- [x] Remove PaymentRedirect React page from App.tsx router

## CRM Supplier Tag Update
- [x] Add "Etihad Holidays" to the supplier tag list in the agent CRM (also sorted list alphabetically)

## CSV Agent CRM Matching
- [x] Parse Members-AllAgents.csv and match agents to CRM by email (personal + JLT email)
- [x] Update dateJoined in CRM from CSV Date Joined column for matched agents
- [x] Set trainingStage = 'Training' for matched agents without a 'Signed Off' value in CSV

## Flight Request Dual Status (Both)
- [x] Add cancellationStatus column to flight_requests table in drizzle schema + migration
- [x] Update flightRequests.updateStatus tRPC procedure to accept cancellationStatus separately
- [x] Show two separate status dropdowns in AdminFlightsPipeline for 'both' requests (Ticketing + Cancellation)
- [x] Update AdminFlightsPipeline to show two dropdowns for 'both' requests (Ticketing status + Cancellation status)
- [x] Update agent notification to reflect which part was updated

## Email Template Placeholder Bug
- [x] Fix flight_request_update email template: {{toName}}, {{#if message}} block not being rendered — raw placeholders appearing in sent emails. Fixed by: (1) adding toName alias to variable map, (2) adding {{#if key}}...{{/if}} conditional block processor before simple substitution. Fix applies to ALL notification templates globally.

## Commission Pre-Authorisation
- [x] Add commissionPreAuthorised boolean to bookings schema + migration
- [x] Add bookings.togglePreAuth tRPC procedure (agent can toggle on/off)
- [x] Update admin moveStage: when marking claimable with pre-auth=true, show VAT prompt and auto-create claim
- [x] Add pre-auth tag/badge on Commission Due admin page
- [x] Add pre-auth toggle to agent booking detail page
- [x] Add pre-auth toggle to AgentCommissions page
- [x] Send agent notification when commission is auto-processed via pre-auth

## Agent Dashboard Revamp
- [x] Two-column layout (actions left, bookings right)
- [x] Stats bar: Active Bookings, Needs Action, Commission Ready, Unread Notifications
- [x] Actions Required panel: Query bookings, missing docs, unread notifications
- [x] Commission Pre-Auth banner/explainer with per-booking toggles
- [x] Activity feed: recent updates across all bookings (last 5, with View All)
- [x] Earnings summary: £X earned this year / £Y pending
- [x] Upcoming departures strip (next 30 days)
- [x] Quick actions: Register Booking + Submit Flight Request buttons

## Commission Pre-Auth + Dashboard Revamp (Apr 18)
- [x] Add pre-auth tag/badge on Commission Due admin page (Zap icon + "Pre-Auth" badge already present)
- [x] Add pre-auth toggle to agent booking detail page (AgentBookingDetail.tsx)
- [x] Add pre-auth info banner to AgentCommissions not-ready tab
- [x] Agent Dashboard revamp: two-column layout, stats bar, actions required panel, pre-auth banner, earnings summary, upcoming departures, flight requests panel, notifications panel
- [x] Add myEarningsSummary tRPC procedure to commissionClaims router
- [x] Add cancellationStatus to flightRequests.myRequests response

## CSV Commission Matching & Bulk Pay (Apr 18)
- [x] uploadBatch normalises both old PTS and new JLT Commissions CSV column names (Client Name, Booking Ref, Remit 80%)
- [x] uploadBatch falls back to topdogRef match when ptsRef not found
- [x] uploadBatch uses Agent/Email columns from CSV as fallback agent info when booking not matched
- [x] markBatchPaid procedure: advances processing/awaiting_payment claims to paid, sets VAT from CSV, pushes remittances + notifies agents
- [x] RemittanceManagement: Mark All Paid button with confirm dialog (shows matched count + total, warning)
- [x] Upload dialog updated to accept both PTS and JLT Commissions CSV formats

## Refund Pipeline - Query Stage
- [x] Add 'query' to refund stage enum in drizzle/schema.ts and migrate DB
- [x] Insert 'query' stage between 'new' and next stage in pipeline column order
- [x] Add popup dialog when moving refund to 'query' stage with message input
- [x] Send message to assigned agent via in-app notification + email when moved to 'query'

## Flight Requests - Completed Status
- [x] Add "completed" status to flight requests (DB + backend)
- [x] Add "Mark as Complete" button on admin flight request view
- [x] Separate completed flights into a Completed tab/section out of the pending view

## Unread Message Indicator on Booking File Page
- [x] Backend: add getUnreadNoteCountForBooking query helper in server/db.ts
- [x] Backend: expose notes.getUnreadCountForBooking tRPC query (admin only)
- [x] Frontend: show prominent unread message banner/alert on AdminBookingDetail when there are unread agent messages
- [x] Frontend: add "Mark as Read" button on AdminBookingDetail that calls notes.markBookingNotesRead
- [x] Frontend: after marking as read, invalidate messages query so booking disappears from Messages tab

## Bug Fix: Reimbursement Docs "No documents uploaded yet" False Warning
- [x] Fix: "No documents uploaded yet" warning on AdminBookingDetail was ignoring reimbursement item docs — now suppressed when any item has docs uploaded
- [x] Fix: Kanban "Docs missing" badge was checking legacy reimbursementDocUrl field only — uploadItemDoc now also updates the legacy field so Kanban stays accurate
- [x] Fix: Future uploads via the per-item doc system will correctly mark the booking as having docs

## Bug Fix: Refund Pipeline "Query" Stage Not Moving
- [x] Fix: "Query" was missing from the refunds.pipelineStage MySQL ENUM — DB silently rejected the value so the stage never changed
- [x] Fix: Added "Query" to the ENUM in drizzle/schema.ts and applied ALTER TABLE migration
- [x] Fix: Updated updateRefundPipeline helper in db.ts to include "Query" in the TypeScript union type

## Feature: Suppliers & Docs Added to PTS Toggle
- [x] DB: add suppliersAndDocsAddedToPts boolean column to bookings table, default false
- [x] DB: generate and apply migration SQL
- [x] Backend: add toggleSuppliersAndDocs tRPC mutation (admin only) to flip the flag
- [x] Frontend: add prominent toggle on AdminBookingDetail (booking details section)
- [x] Frontend: show a checkmark/badge icon on AdminKanban card when suppliersAndDocsAddedToPts is true

## Bug Fix: Agent Commission Figure Discrepancy
- [x] Investigate: agent dashboard "pending comms" vs "all commissions" total use different queries/filters
- [x] Fix: align both figures to use the same commission calculation logic

## Bug Fix + Feature: Commission Figures & My Earnings Redesign
- [x] Fix: include "Commission Claimed" bookings with no claim record in the commissions page total
- [x] Fix: update myEarningsSummary server procedure to return all 5 buckets (paid, awaitingPayment, processing, claimable, pending) plus a grand total
- [x] Feature: redesign AgentDashboard "My Earnings" card to show grand total + breakdown rows (paid, awaiting payment, processing, claimable, pending)

## Feature: Agent Dashboard Completed Tab & Filters
- [x] Define "completed" bookings: commission claimed (stage = Commission Claimed) AND departure date in the past
- [x] Add "Active" / "Completed" tab switcher to the dashboard booking list card
- [x] Active tab: exclude completed bookings (currently they show mixed in)
- [x] Completed tab: show only completed bookings, sorted by departure date desc
- [x] Add filter controls to the booking list: by year, sort by departure/booked date/commission
- [x] Ensure stat cards (Active count) also exclude completed bookings

## Feature: Full Nightly Export (ZIP with all tables)
- [x] Expand runNightlyExport to query all core business tables: bookings, users, commission_claims, amendments, amendment_line_items, cancellations, refunds, refund_suppliers, reimbursement_items, reimbursement_item_docs, reimbursement_docs, notes, payment_links, flight_requests, commission_remittances, commission_remittance_items, remittance_batches, remittance_lines
- [x] Generate one CSV per table with all columns
- [x] Bundle all CSVs into a single ZIP attachment using the archiver npm package
- [x] Update email subject and body to reflect the multi-table export
- [x] Update rowCount in exportRuns log to reflect total rows across all tables

## Feature: Delete Reimbursement Items
- [x] Backend: add deleteReimbursementItem tRPC mutation (admin only) — deletes item and its associated docs
- [x] Frontend: add delete button (with confirmation dialog) on each reimbursement item row on the admin reimbursement screen
- [x] Frontend: also add delete button on the booking detail page reimbursement items section

## Feature: Post-GoCardless Onboarding Flow
- [x] Build /membership/success page — shown after GoCardless redirect, prompts agent to create portal login (Manus OAuth)
- [x] Build limited onboarding dashboard (/onboarding) — accessible to all logged-in agents
- [x] Onboarding dashboard: show "Training portal login coming soon" banner
- [x] Onboarding dashboard: form to complete CRM profile fields (full name, email, phone, address)
- [x] Onboarding dashboard: ID document upload section
- [x] Backend: procedure to save onboarding profile fields to crm_profiles table
- [x] Backend: procedure to upload ID documents to S3 and save reference in DB
- [x] Backend: mark onboarding complete when all required fields filled (notifyOnComplete flag triggers owner notification)
- [x] Admin: notify JLT team when a new agent completes onboarding (notifyOwner called when all fields complete)

## Feature: JLT-Branded Account Creation (Remove Manus Branding)
- [x] Investigate where Manus branding appears in the sign-up/login flow
- [x] Build a JLT-branded account creation page (email + password, no Manus mention) — /register
- [x] Build a JLT-branded login page (email + password, no Manus mention) — existing LoginPage already JLT-branded
- [x] Wire /membership/success "Create Account" CTA to the new JLT-branded page (/register)
- [x] Ensure the new pages use JLT colours, Poppins font, and JLT logo

## Feature: Contract Signing → Joining Fee Payment
- [x] Review the existing /sign-contract/:token page
- [x] After successful contract signature, redirect agent to the joining fee payment page (auto-redirect after 3s)
- [x] Wire to configured Stripe joining fee URL from paymentConfig
- [x] After payment, redirect to /membership/success (handled by Stripe success URL config)

## Bug Fix: CRM Payment Settings Not Saving
- [x] Investigate: Stripe joining fee URL not saving in CRM Payment Settings (data is correctly persisting in DB — was a false report or transient issue)
- [x] Investigate: Contract template not saving/uploading in CRM (upload works; display showed 'Invalid Date' because frontend used t.uploadedAt instead of t.createdAt)
- [x] Fix: changed t.uploadedAt to t.createdAt in CrmPaymentConfig.tsx template list display

## Feature: Agent Onboarding Gate
- [x] Add portalStatus enum to users table: 'onboarding' | 'active' (default: 'onboarding')
- [x] DB migration for the new portalStatus column
- [x] Backend: admin procedure to set portalStatus to 'active' for a user (activatePortalAccess)
- [x] Agent sidebar: when portalStatus is 'onboarding', only show Onboarding nav item — hide all other agent nav items
- [x] Agent routes: redirect all agent routes (/dashboard, /bookings, /register-booking, /flights, /amendments, /refunds, /commissions) to /onboarding when portalStatus is 'onboarding'
- [x] Admin CRM agent list: show portalStatus badge and "Activate Portal Access" button per agent
- [x] Admin notification when a new agent completes onboarding (verify it fires correctly — notifyOwner called in saveOnboardingProfile when notifyOnComplete=true)

## Agent Onboarding Gate
- [x] Add `portalStatus` enum column (`onboarding` | `active`) to users table in schema.ts
- [x] Generate and apply DB migration for portalStatus column
- [x] Backfill existing admin/agent users to `active` so they are not locked out
- [x] Add `activatePortalAccess(userId)` helper in db.ts
- [x] Add `users.activatePortalAccess` admin-only tRPC mutation in routers.ts
- [x] Add `OnboardingGate` component in App.tsx — redirects agent to /onboarding if portalStatus === 'onboarding'
- [x] Wrap pure-agent route Switch with OnboardingGate in App.tsx
- [x] Add onboarding-only minimal nav in PortalLayout (shows only "Complete Onboarding" link when agent is in onboarding state)
- [x] Add `portalStatus` badge (Onboarding / Portal Active) in AgentCrmSheet header
- [x] Add "Activate Portal Access" button in AgentCrmSheet (visible when agent is in onboarding state, calls users.activatePortalAccess mutation)
- [x] Add 4 vitest tests for activatePortalAccess (admin allowed, super_admin allowed, unauthenticated rejected, agent rejected)

## Bug Fix: Owner Notification Email Wrong Address
- [x] Update Max Kelly's account email from max@loupr.com to max@thejltgroup.co.uk so admin notifications go to the correct address (updated user id 760 in DB)

## UX: Booking Registration Form
- [x] Move "This is a historic booking" checkbox to the bottom of the booking registration form to prevent agents accidentally selecting it for new bookings

## UX: Historic Booking Confirmation Prompt
- [x] Show a confirmation dialog when agent ticks "This is a historic booking" — requires explicit confirmation before the checkbox is activated

## Bug Fix: Stale Data on Booking Detail Page (Search Navigation)
- [x] Fix: when navigating from one booking detail page to another via the global search bar, the previous booking's data briefly shows before the new data loads — switched /bookings/:id routes to render-function form with key={params.id} so React fully remounts AgentBookingDetail and AdminBookingDetail on every ID change

## Bug Fix: Commission Management VAT Input Page Jump
- [x] Fix: page jumps on every keystroke when entering a VAT figure on the commission management screen (root cause: ClaimTable was defined inside AdminCommissions render function, causing full remount on every vatEditing state change; fixed by moving ClaimTable to module scope with explicit props)

## GoCardless Direct Debit Integration
- [x] Store GOCARDLESS_ACCESS_TOKEN and GOCARDLESS_ENVIRONMENT as secrets
- [x] DB: add gc_mandates table (userId, billingRequestId, mandateId, status, joiningFeePaidAt, preferredPaymentDay)
- [x] DB: add gc_subscriptions table (userId, mandateId, subscriptionId, status, startDate, amount, nextChargeDate)
- [x] Server: GoCardless API helper (createBillingRequest, createBillingRequestFlow, createSubscription, calcSubscriptionStartDate)
- [x] Server: tRPC procedures: initDdSetup, getMyDdStatus, adminListMandates, adminGetPaymentEvents, adminGetRecentFailedPayments, adminGetDdStatus
- [x] Server: GoCardless webhook handler at /api/gocardless/webhook — handles mandates_active, payments_failed, payments_charged_back, mandates_cancelled, mandates_failed
- [x] Server: on mandates_active webhook, auto-create subscription with start_date = joiningFeePaidAt + 1 month
- [x] Frontend: DD Setup page (/dd-setup) — agent chooses preferred payment day, then redirected to GoCardless hosted page
- [x] Frontend: DD Complete page (/dd-complete) — confirmation page after GoCardless redirect
- [x] Frontend: wire DD setup into onboarding checklist as a required step
- [x] Admin CRM: Direct Debit tab in agent sheet with mandate status, subscription details, and full payment event history
- [x] Admin notification when a new agent's DD mandate becomes active

## GoCardless Failed Payment Tracking
- [x] Add gc_payment_events table to schema (paymentId, mandateId, userId, eventType, amount, currency, status, failureReason, occurredAt)
- [x] Extend GoCardless webhook handler to capture payments_failed, payments_charged_back, mandates_cancelled, mandates_failed events
- [x] Add DB helpers: createPaymentEvent, getPaymentEventsByUserId, getRecentFailedPayments
- [x] Add adminGetPaymentEvents and adminGetRecentFailedPayments tRPC procedures
- [x] Admin CRM: Direct Debit tab shows full payment history with event type badges and failure reasons
- [x] Admin CRM: red "Payment Failed" badge on agent list row when latest payment failed
- [x] Admin notification when a payment fails or mandate is cancelled

## GoCardless CRM Backfill
- [x] Pull all GoCardless customers, mandates, and subscriptions via API
- [x] Match to CRM agents by email address
- [x] Backfill gc_mandates and gc_subscriptions tables with matched data
- [x] Report which agents were matched and which had no GoCardless record (118 matched, 4 skipped/no mandates, 322 no GoCardless record)

## Agent Sign-Up Flow (Full Build)
- [x] Schema: add membershipTier (business_class/first_class), membershipType (solo/duo/trio), teamId to users table
- [x] Schema: add teams table (id, leaderId, tier, membershipType, createdAt)
- [x] Schema: add contract_signatures table (id, userId, contractTemplateId, signedAt, signatureDataUrl, signerName, signerAddress, ipAddress)
- [x] Schema: add team_invites table (id, teamId, invitedEmail, token, status, expiresAt, createdAt)
- [x] DB migration for all new tables
- [x] Backend: membership tier config (joining fee £1 test/£297 live, monthly amounts per tier/type)
- [x] Backend: GoCardless createBillingRequestWithPayment (Instant Bank Pay joining fee + DD mandate in one flow)
- [x] Backend: tRPC procedures for /join flow (startSession, getSession, getContractTemplate, signContract, initiatePayment)
- [x] Backend: team invite procedures (sendTeamInvite, getInvite, acceptInvite, adminListSessions, adminListTeams)
- [x] Backend: send team member invite email with unique token link
- [x] GoCardless webhook: handle billing_request_fulfilled → create agent user account, mark joining fee paid, notify admin
- [x] Frontend: /join page — step 1: solo or team selection (duo/trio)
- [x] Frontend: /join page — step 2: plan selection (Business Class / First Class with full pricing table)
- [x] Frontend: /join page — step 3: contract signing (PDF viewer + drawn signature pad + typed name + address)
- [x] Frontend: /join page — step 4: GoCardless redirect (joining fee + DD mandate)
- [x] Frontend: /join/complete page — confirmation after GoCardless returns
- [x] Frontend: /join/accept?token= page — team member invite acceptance + own contract signing (no payment)
- [x] Frontend: onboarding checklist — team leader can invite team members by email (step 4 of join flow)
- [x] Admin CRM: Sign-Up Applications page with all sessions, status filter, contract/payment status
- [x] Admin CRM: Teams tab showing team structure, member counts, and invite status
- [x] Admin CRM: "Sign-Up Applications" link added to CRM sidebar section
- [x] Tests: 18 vitest tests for membership constants, session tokens, step validation, email validation
- [x] Checkpoint saved

## Join Flow Bug Fixes
- [x] Fix GoCardless 400 "Invalid document structure" — add scheme: "faster_payments" to payment_request
- [x] Enlarge contract PDF viewer from 400px to 700px height, widen to max-w-3xl on contract step
- [x] Add "Open full screen ↗" link on contract viewer so users can read in a new tab (links in PDF are clickable there)
- [x] PDF toolbar enabled (#toolbar=1) so users can zoom, navigate pages, and click links within the iframe

## Join Flow Bug Fixes Round 2
- [x] Fix session resume bug: when existing session has step="payment" but billing request failed, reset to "contract" so user can re-sign
- [x] Fix GoCardless 400 error: prefilled_customer must go in billing_request_flows (step 2), NOT in billing_requests (step 1)

## Post-Payment Onboarding Flow
- [x] Schema: added emergencyContactName, emergencyContactPhone, preferredPaymentDay to agentCrmProfiles table
- [x] DB migration applied via script (ALTER TABLE agent_crm_profiles ADD ...)
- [x] GoCardless subscription created when agent saves payment day during onboarding (calcSubscriptionStartDate guarantees 28-day minimum, options: 1st/15th/28th only)
- [x] Backend: saveOnboardingProfile extended with bank details, emergency contact, preferredPaymentDay, subscription creation trigger
- [x] Backend: adminApproveAgent procedure in join-router.ts (sets portalStatus: active)
- [x] Frontend: /join/complete page — prominent dark CTA card "Log in & Complete Profile" button added
- [x] Frontend: /onboarding page — full 5-section accordion form: personal details, bank details, emergency contact, identity documents, payment date (1st/15th/28th)
- [x] Frontend: portal access gating — App.tsx redirects onboarding agents to /onboarding; PortalLayout shows minimal nav
- [x] Admin CRM: "Activate Portal Access" button on agent sheet (portalStatus: onboarding only)
- [x] Admin CRM: "Activate" button in Sign-Up Applications table (complete sessions with userId only)

## Set Password on Join Complete
- [x] Backend: tRPC procedure join.setPassword — validates join session token, hashes password, saves to user record, creates session cookie (auto-login)
- [x] Frontend: /join/complete — replaced login button with set-password form (password + confirm password fields), auto-redirect to /onboarding on success

## Auto-Login After Set Password Bug
- [x] Fix: setPassword now uses window.location.href hard reload so session cookie is properly sent on next request
- [x] Fix: loginWithPassword also uses window.location.href hard reload for same reason
- [x] Note: password reset email flow is correct — forgotPassword sends email via SMTP; "wrong credentials" was because webhook hadn't created the user yet when login was attempted

## Redirect After Set Password (Smoothness Fix)
- [x] Fix: removed setTimeout delay, now uses window.location.replace('/') immediately after setPassword so auth router handles the /onboarding redirect cleanly

## Onboarding & CRM Improvements (Round 2)
- [x] Onboarding: make personal email field required (not optional)
- [x] Onboarding: add JLT email preference step — agent picks first.lastname@thejltgroup.co.uk or business@thejltgroup.co.uk
- [x] Schema: add jltEmailPreference field to agentCrmProfiles
- [x] Schema/backend: default trainingStage to 'training' for new agents created by webhook
- [x] CRM: mandate display — GoCardless mandate status shown on agent sheet header badge (No DD = no mandate row in DB, expected for agents who haven't completed GC flow)
- [x] CRM: add Contract Documents section to agent sidebar (Docs tab now shows signed contract with signature, signer name, date)
- [x] Admin Onboarding Checklist: new Onboarding tab in CRM agent sheet with 6 steps: Create Training Hub Login, Set Up JLT Email, Review ID Docs, Review Contract, Send Welcome Email, Approve Portal Access
- [x] Schema: add admin_onboarding_checklist table (userId, 6 boolean steps, updatedById, timestamps)
- [x] DB migration for new fields and table applied

## Contract Evidence & Legal Compliance
- [x] Audit: reviewed prospectContracts and joinSessions — IP was partially captured, user agent/consent/hash/snapshot were missing
- [x] Schema: added signingIp, signingUserAgent, consentConfirmed, contractTextSnapshot, contractHash to prospectContracts
- [x] Schema: added signingUserAgent, consentConfirmed, contractTextSnapshot, contractHash to joinSessions
- [x] Backend: capture IP address and user agent when agent submits contract signature (both join-router and crm-router)
- [x] Backend: generate SHA-256 hash of (contractText + signatureDataUrl + timestamp + signerName + IP) for tamper detection
- [x] Admin: built full-page Contract Evidence Viewer at /crm/agents/:userId/contract-evidence
- [x] Admin: Print / Save PDF button on Contract Evidence Viewer (window.print)
- [x] CRM Docs tab: "View Full Legal Evidence Record" button links to evidence viewer
- [x] DB migration for new fields applied

## Notification Routing — support@thejltgroup.co.uk
- [x] Audit all new joiner notification triggers (webhook, join-router, admin approval)
- [x] Audit all direct debit notification triggers (GoCardless webhook, DD setup, mandate events)
- [x] Route all new joiner notifications to support@thejltgroup.co.uk
- [x] Route all direct debit notifications to support@thejltgroup.co.uk

## Bug Fix — GC Mandate Insert userId=0
- [x] Fix GoCardless webhook: gc_mandates insert fails with userId=0 (user lookup returning null/0 at billing_request.fulfilled time) — resolved in section below

## Bug Fix — GC Mandate Insert userId=0 + Subscription Creation
- [x] Fix GoCardless webhook: gc_mandates insert fails with userId=0 — made userId nullable in schema so placeholder row can be inserted before user account exists; webhook updates it with real userId on billing_request.fulfilled
- [x] Wire preferred payment day: subscription creation now triggers whenever preferredPaymentDay is set (not gated on notifyOnComplete), so saving the payment day step immediately creates the GoCardless subscription if mandate is active

## Bug Fix — Simplify GC New Joiner Flow
- [x] Remove premature gc_mandates placeholder insert from join-router (root cause of userId=0 error)
- [x] Move all gc_mandates creation to billing_request.fulfilled webhook where real userId is known
- [x] billing_request.fulfilled webhook creates the mandate row with correct userId, billingRequestId, joiningFeePaidAt; handles duplicate gracefully

## DD Mandate & Subscription Fixes
- [x] Investigated test account (userId 3020571) — no mandate row because billing_request.fulfilled webhook fired before the join session was saved; fixed by simplifying flow
- [x] CRM agent sheet Direct Debit tab already shows mandate status, mandateId, preferred payment day, joining fee date, subscription details, and payment event history
- [x] Added manual "Create Subscription" button in CRM Direct Debit tab — admins can pick payment day and create GoCardless subscription for any agent with an active mandate

## GC Webhook & CRM Subscription Button Fix
- [x] Fix billing_request.fulfilled webhook matching — idempotency check now only skips if mandate row already exists; if user exists but mandate is missing, creates it on re-fire
- [x] Fix mandates.active webhook — if no local mandate row found, recovers by looking up join session via billingRequestId and creating the row
- [x] CRM Create Subscription button now visible even when no mandate row exists (shows as "Set Up Direct Debit Manually")

## GC Webhook Re-trigger & Mandate ID Input
- [x] Re-triggered billing_request.fulfilled for test account — fetched billing request from GC API, extracted mandate ID MD01KPX8R2PQW7N72BED0KHQ38ZT, created gc_mandates row for userId 3020571 (status: submitted, awaiting BACS activation)
- [x] Added Mandate ID input field to CRM manual subscription form — shown when no mandate DB row exists; admin pastes GC mandate ID and it's used directly to create the subscription

## CRM Direct Debit Tab — Subscription Button & Refresh (Apr 23)
- [x] Relaxed Create Subscription button condition — now visible for any mandate status (not just 'active'); hidden only for cancelled/expired mandates
- [x] Added "↻ Refresh status from GoCardless" link — shown when mandate exists but is not yet active; calls GC API, updates DB row, shows toast
- [x] Added adminRefreshMandateStatus backend procedure to gocardless router
- [x] TypeScript: 0 errors

## CRM Direct Debit — Refresh Error Fix & Payment Day Options (Apr 23)
- [x] Fixed DB error on Refresh Status: gc_mandates status enum was missing 'pending_submission' and 'submitted' values — ALTER TABLE migration applied
- [x] Updated updateGcMandate TypeScript type to include all GoCardless mandate statuses
- [x] Removed active-status guard from adminCreateSubscription — now allows subscription creation for any non-cancelled/expired mandate
- [x] Restricted payment day options to 1st, 15th, 28th only (both CRM and agent onboarding already use these)
- [x] TypeScript: 0 errors

## Admin Onboarding Workflow — Subscription Setup Step
- [x] Add ddSubscriptionCreated boolean field to admin_onboarding_checklist table + migration
- [x] Add subscription setup step to ONBOARDING_STEPS in AgentCrm.tsx with inline mandate status + create subscription action
- [x] Auto-mark ddSubscriptionCreated when subscription already exists on checklist load
- [x] Add webhook handlers for mandates.submitted and mandates.pending_submission to auto-update DB status badge

## Join Page — Membership Tier Content Update
- [x] Replace generic feature bullets in PlanStep with accurate content from hub.thejltgroup.co.uk/joinus
- [x] Business Class: Full list of features including IRS details and Social Media Academy (now included)
- [x] First Class: Everything in BC + BRAVE framework coaching (weekly group + monthly 1:1), Private WhatsApp group
- [x] Add expandable "See everything that's included" detail section to each tier card
- [x] Ensure design looks polished and on-brand

## Post-Signup Welcome Email Copy Update
- [x] Find the welcome email template in the codebase
- [x] Replace "application received" copy with: thank them for joining, advise to complete onboarding, look out for training hub access email, note team will be in touch but may be slower evenings/weekends

## Membership Pricing Update
- [x] Update Business Duo to £127/m (12700p) — already correct in shared/membership.ts
- [x] Update Business Trio to £167/m (16700p) — already correct
- [x] Update First Class Duo to £167/m (16700p) — already correct
- [x] Update First Class Trio to £207/m (20700p) — already correct
- [x] Update joining fee from £1 test to £297 live in shared/membership.ts
- [x] Fix adminCreateSubscription to use getMonthlyAmount(tier, membershipType) instead of hardcoded solo amounts
- [x] Look up membershipType from joinSessions table for correct duo/trio pricing

## Commission Spreadsheet Matching (Apr 23)- [x] Match AprilComms.csv, FebComms.csv, MarchComms.csv, Commissions-April26-17.csv — DEFERRED
- [x] Amount to mark as paid = 0.80 column + VAT column from spreadsheet — DEFERRED
- [x] Mark matched claims as paid in DB — DEFERRED
- [x] Report matched/unmatched results to user — DEFERRED

## Supplier Directory Fixes (May 9)Section & Welcome Email Automation
- [x] Add "New Sign-Ups" section to CRM memberships page showing agents with Onboarding status who haven't completed onboarding checklist
- [x] Show agent name, tier, join date, onboarding checklist progress, and a quick link to their CRM profile
- [x] Automate "Send Welcome Email" button with the correct JLT welcome email template
- [x] Welcome email: personalised greeting, training hub setup instructions, WhatsApp group, JLT email 7-day timeline, weekly Thursday induction call info

## Contract Evidence & Onboarding Visibility (Apr 24)
- [x] Fix contract page: send signingUserAgent, consentConfirmed, contractTextSnapshot from all three signing pages (JoinFlow, JoinAccept, SignContract)
- [x] Show agent self-onboarding completion in New Sign-Ups tab: personal details, bank details, ID docs, emergency contact, payment day, JLT email

## Commission VAT Handling (Apr 24)
- [x] Commission Due page: show VAT prompt dialog when marking a booking as Commission Claimable — admin can enter VAT amount before confirming
- [x] Confirm/fix that VAT entered on Commission Management page persists when claim moves from Processing → Claimed → Paid

## Bug Fixes (Apr 24)
- [x] Fix FORBIDDEN error when admin tries to match a remittance batch (Remittance Management page) — root cause: admin-only queries in PortalLayout firing before auth confirmed; fixed with !!user guard
- [x] Fix: VAT figures entered on unmatched remittance lines are lost when the line is manually matched to a booking
- [x] Janine's View: add filter toggle to default to unpushed lines only, with option to show all lines for historic view
- [x] Admin dashboard: add Late Reimbursements (unactioned), Pending Flight Requests, and New Sign-Ups pills to the quick-stats row
- [x] Build public Terms & Policies page (/terms) with three tabs: Full Terms, Code of Conduct, Privacy Policy — no login required, compact formatted layout
- [x] Review JLT Membership Agreement from shared Manus task and update Full Terms on /terms page to align throughout (particularly termination clause allowing agents to continue managing existing bookings)

## Calendar Edit Bug (Apr 25)
- [x] Fix: clicking an existing calendar event does not open the edit dialog

## Portal Improvements (Apr 25)
- [x] Reimbursement upload: allow multiple documents at once, add clear guidance that at least 2 docs are required
- [x] Messages: allow agents to attach documents to shared notes/messages, with a clear warning banner that reimbursement docs must be submitted via the reimbursement form
- [x] Calendar: allow calendar entries to be edited after creation
- [x] CRM Agent Profile: add timestamped notes box (contact log / general notes), showing author name and timestamp
- [x] CRM Supplier Logins: add Etihad Holidays and Gold Medal as supplier options

## Query Messages in Booking Messages Tab (Apr 25)
- [x] Surface query messages from booking pipeline stage moves (Query stage) in the booking Messages tab
- [x] Surface query messages from flight request queries in the booking Messages tab
- [x] Surface query messages from refund queries in the booking Messages tab

## Reimbursement Auto-Scheduling Removal (Apr 25)
- [x] Remove all automatic reimbursement scheduling — only admins should be able to mark as scheduled
- [x] No backdate required — existing data left as-is, auto-scheduling removed going forward only

## Flight Request UI (Apr 25)
- [x] Highlight cancellation requests in a distinct colour to make them more obvious vs ticketing requests

## Agent TD Reference Edit (Apr 25)
- [x] Allow agents to add a TD reference to their booking if it is currently blank
- [x] Once set, lock the TD reference field — agents cannot change it (must contact admin to amend)

## Agent Contract (Apr 27)
- [x] Ensure the latest uploaded contract is the one new agents sign during onboarding (not the original) — confirmed working, latest contract (id 30001) is active in DB and served correctly

## Agent Outstanding Actions Panel (Apr 27)
- [x] Add "Outstanding Actions" summary panel to agent dashboard showing pending reimbursements, flight requests, amendments, refunds, and queries
- [x] Each item should be a clickable link taking the agent directly to the relevant booking or section

## Reimbursement Multi-Doc Guidance (Apr 28)
- [x] Always show "at least 2 documents required" guidance on reimbursement upload — not just when 0 docs uploaded; make it a prominent amber banner

## Agent Accelerator Matching (Apr 29)
- [x] Extract agent phone numbers from Full_Agent_Contacts.pdf
- [x] Match against CRM agents by phone number
- [x] Mark matched agents as Agent Accelerator in CRM

## GoCardless DD Back-fill (Apr 29)
- [x] Investigate GoCardless integration and what fields are stored/updated by webhooks
- [x] Back-fill DD subscription statuses for agents who set up DD before webhook integration
- [x] Fix webhook issues going forward — GOCARDLESS_WEBHOOK_SECRET now configured

## DD Payment History (Apr 29)
- [x] Investigate why DD payments are not recorded in payment history (e.g. Peter Stamford)
- [x] Back-fill missing payment history from GoCardless API (104 records created)
- [x] Fix webhook handler to record confirmed/paid_out/cancelled payment events going forward

## Refund Query Note Fix (Apr 29)
- [x] Fix refund query notes being saved as internal — they must be saved as shared (visible to agent) + back-filled 5 existing internal notes to shared
- [x] Update all agent-facing email notifications to include a "Reply in the portal" button/link, not reply by email

## Booking Documents (Apr 29)
- [x] DB: create booking_documents table (id, bookingId, uploadedById, docType: invoice|atol|other, displayName, fileUrl, fileKey, mimeType, fileSize, createdAt)
- [x] Backend: uploadBookingDoc procedure — agents upload file, choose type (invoice/atol/other), system auto-names it; admins can also upload
- [x] Backend: listBookingDocs procedure — returns all docs for a booking (agents see own booking docs, admins see all)
- [x] Backend: renameBookingDoc procedure — admin only, sets displayName on any doc
- [x] Backend: deleteBookingDoc procedure — admin only
- [x] Frontend (agent): Documents section on AgentBookingDetail — upload button with type selector, list of uploaded docs with download links
- [x] Frontend (admin): Documents section on AdminBookingDetail — same list + rename button per doc (inline edit), delete button

## Bug Fixes (Apr 29)
- [x] Fix: refund query notes sent by agents should default to public (isInternal=false), not internal
- [x] Fix: email notifications sent to agents should direct them to reply in the portal, not by email (update email templates to include portal link and remove any "reply to this email" language)

## Bug Fixes (Apr 29 — Round 2)
- [x] Fix: booking documents S3 Access Denied error — list procedure now calls storageGet() to generate fresh presigned download URLs for each document
- [x] Fix: reimbursement documents S3 Access Denied — getReimbursementsByBooking, getReimbursementItemDocs, and addReimbursementItemDoc now generate presigned download URLs via storageGet()

## Bug Fixes (Apr 29 — Round 3)
- [x] Fix: "Unable to transform response from server" error on login — root cause was IMAP scheduler crashing the server; resolved by disabling inbox auto-import

## Bug Fixes (Apr 29 — Round 4)
- [x] Fix: IMAP inbox scheduler disabled — was crashing the server with unhandled TLS ECONNRESET errors; cron job commented out in scheduler.ts until IMAP stability is resolved

## Email Marketing System (Apr 30)

### DB Schema
- [x] DB: email_templates table (id, name, subject, bodyHtml, bodyText, category: prospect|agent, createdBy, createdAt, updatedAt)
- [x] DB: email_campaigns table (id, name, audienceType: prospect|agent, segmentFilters JSON, subject, bodyHtml, status: draft|sent|scheduled, sentAt, sentBy, totalRecipients, createdAt)
- [x] DB: email_sends table (id, campaignId nullable, templateId nullable, recipientEmail, recipientName, recipientType: prospect|agent, recipientId, resendMessageId, status: queued|sent|delivered|opened|clicked|bounced|failed, sentAt, openedAt, clickedAt, createdAt)
- [x] DB: email_drip_workflows table (id, name, audienceType: prospect, triggerStage (CRM pipeline stage), isActive, createdAt)
- [x] DB: email_drip_steps table (id, workflowId, stepOrder, delayDays, templateId, subject override nullable, createdAt)
- [x] DB: email_drip_enrollments table (id, workflowId, prospectId, enrolledAt, currentStep, completedAt, cancelledAt)
- [x] Run migration for all new tables

### Backend
- [x] Backend: install resend npm package
- [x] Backend: resend.ts helper — sendEmail(to, subject, html, from) using Resend API key; from address determined by audienceType (jointheteam@ for prospects, support@ for agents)
- [x] Backend: open/click tracking — inject tracking pixel and wrap links before sending; POST /api/email-track/open/:sendId and /api/email-track/click/:sendId?url=... endpoints
- [x] Backend: Resend webhook handler at /api/webhooks/resend — update email_sends status on delivery/bounce/complaint events
- [x] Backend: emailTemplates tRPC router — list, get, create, update, delete
- [x] Backend: emailCampaigns tRPC router — list, get, create (draft), send (bulk send to segmented recipients), getStats
- [x] Backend: emailDripWorkflows tRPC router — list, get, create, update, delete, toggle active
- [x] Backend: emailDripSteps tRPC router — list, create, update, delete, reorder
- [x] Backend: drip engine — scheduler job every hour checks email_drip_enrollments for steps due, sends email, advances step; auto-enroll prospects when their CRM pipeline stage changes
- [x] Backend: prospect segmentation helper — filter prospects by pipeline stage, tags, source
- [x] Backend: agent segmentation helper — filter agents by membership tier, training stage, tags

### Frontend
- [x] Frontend: Email section in admin sidebar under Marketing (or new top-level section)
- [x] Frontend: Templates page — list all templates, create/edit with TipTap rich-text editor (bold, italic, lists, links, images via URL, Loom embed via iframe), preview rendered HTML, delete
- [x] Frontend: Campaigns page — list campaigns with status/stats badges; create campaign: pick audience (prospects/agents), apply segment filters, compose or pick template, preview, send or schedule
- [x] Frontend: Drip Workflows page — list workflows; create/edit workflow: pick trigger stage, add steps (delay in days + template), reorder steps, toggle active/inactive
- [x] Frontend: Email Analytics page — per-campaign stats: sent/opened/clicked/bounced counts and rates, recipient list with individual status
- [x] Frontend: Loom embed support in editor — paste Loom URL, auto-convert to responsive iframe thumbnail
- [x] Frontend: Image upload in editor — upload to S3 via existing storagePut, insert as <img> in email body

### Setup Instructions for User
- [x] Document: Resend account setup steps for user (create API key, verify sending domains jointheteam@ and support@)

## Email Sending Domain Update (Apr 30)
- [x] Update from addresses to use mail.thejltgroup.co.uk subdomain: jointheteam@mail.thejltgroup.co.uk (prospects) and support@mail.thejltgroup.co.uk (agents)

## Email Agent Segmentation (Apr 30)
- [x] Backend: update campaigns.send procedure to filter agents by membershipTier, trainingStage, and tags when audienceType=agent
- [x] Frontend: add agent segment filter UI in campaign builder — dropdowns/multi-select for membership tier, training stage, tags; show estimated recipient count

## Email Marketing Improvements (Apr 30)
- [x] Add reply-to headers: jointheteam@thejltgroup.co.uk for prospects, support@thejltgroup.co.uk for agents
- [x] Branded HTML email wrapper — JLT logo, turquoise header (#70FFE8), Poppins font, styled body, footer with social links
- [x] DB: email_unsubscribes table (id, email, unsubscribedAt, prospectId nullable)
- [x] Backend: unsubscribe token generation + /api/unsubscribe/:token endpoint
- [x] Backend: auto-exclude unsubscribed emails from prospect campaign sends
- [x] Frontend: unsubscribe landing page (/unsubscribe) with confirmation message
- [x] Frontend: admin view of unsubscribes list in Email Marketing section
- [x] Rich editor: colour picker for text/background, button block, divider, font size controls

## Email Branding Editor (Apr 30)
- [x] DB: email_branding_settings table (logoUrl, headerBgColor, headerTextColor, footerText, websiteUrl, facebookUrl, instagramUrl, twitterUrl, updatedAt)
- [x] Backend: emailBranding tRPC router — get, update (admin only)
- [x] Frontend: Email Branding tab in Email Marketing section with visual editor + live preview
- [x] Wire branding settings into buildBrandedHtml() in resend-email.ts

## Email Editor & Mobile Fixes (Apr 30)
- [x] Fix Loom embed: detect Loom share URL, convert to embed URL, render as responsive iframe thumbnail in editor and in sent HTML
- [x] Make images responsive in editor output: inserted images get max-width:100%, height:auto, display:block
- [x] Mobile-responsive HTML email wrapper: fluid table layout, media queries for single-column on <600px, font size adjustments, padding reduction on mobile

## Email Personalisation Merge Tags (Apr 30)
- [x] Editor: merge-tag toolbar button — inserts {{first_name}}, {{full_name}}, {{email}} tokens with one click; tokens rendered as highlighted chips in editor
- [x] Send engine: replace merge tags with real recipient values before wrapping in branded template

## Email Read Tracking & Resend (Apr 30)
- [x] Backend: tRPC procedure to get campaign recipients with open status (opened, openedAt, openCount, status)
- [x] Backend: tRPC procedure to resend to a single recipient (by emailSend id)
- [x] Backend: tRPC procedure to resend to all unopened recipients in a campaign
- [x] Frontend: Campaign detail panel showing recipient list with open/unopened badges, opened timestamp, and per-row Resend button
- [x] Frontend: "Resend to all unopened" bulk action button on campaign detail

## Reimbursement Audit Log (Apr 30)
- [x] DB: reimbursement_audit_logs table (id, reimbursementItemId, bookingId, action, oldStatus, newStatus, actedById, actedAt, note)
- [x] Backend: write audit log entry whenever a reimbursement item status changes (mark paid, mark unpaid, etc.)
- [x] Frontend: activity feed / audit trail on the reimbursement panel showing who changed what and when

## Mandatory Booking Fields (Apr 30)
- [x] Frontend: make grossCost, paxNumbers, and nightNumbers required on agent booking registration form (cannot submit without them)
- [x] Backend: enforce grossCost, paxNumbers, nightNumbers as required in the tRPC booking create/register procedure

## Abandoned Sign-Up Tracker (Apr 30)
- [x] Backend: tRPC procedure to list abandoned join_sessions (userId IS NULL, grouped by step, with email, tier, type, step, createdAt, updatedAt, days since started)
- [x] Backend: tRPC mutation to send a nudge email to an abandoned sign-up (personalised with their name/tier, link back to resume their session)
- [x] Frontend: Abandoned Sign-Ups page in admin area showing table with email, membership tier, step abandoned at, date started, days idle, and Nudge button
- [x] Frontend: Add "Abandoned Sign-Ups" entry to the admin sidebar under CRM or a new Sign-Ups section

## GoCardless Payment Emails & Auto-Suspend (May 1)
- [x] GC webhook: send branded receipt email to agent when payment confirmed/paid_out (amount, date, tier, next payment date)
- [x] GC webhook: send failure email to agent when payment fails (reason, what to do next, link to update bank details)
- [x] GC webhook: auto-suspend agent after 3 consecutive failed payments (set agentStatus=suspended, notify admin)
- [x] Log all agent emails (receipt, failure, any notification) to an agent_emails table for audit trail

## Agent Email Log & Template Editor (May 1)
- [x] DB: agent_emails table (id, userId, toEmail, subject, triggerKey, sentAt, status)
- [x] Backend: write to agent_emails on every email sent to an agent
- [x] Frontend: Agent Email Log page in admin area — searchable list of all emails sent to any agent with date, subject, status
- [x] Frontend: Notification Template Editor — list all agent-facing templates, edit subject + body with live preview, save changes (already existed, enhanced with gc_receipt + gc_payment_failed templates)
- [x] Add Agent Email Log to admin sidebar

## Follow-Up Items (May 1)
- [x] New Sign-Ups panel: add "Send Welcome Email" button directly on the Memberships page (no need to open CRM profile)
- [x] Fix FORBIDDEN errors on PortalLayout admin-only queries firing before auth is confirmed (added !!user guard)

## Clickable Attachments in Notes (May 1)
- [x] Notes/messages: render attachment URLs as clickable links (open in new tab) instead of plain text

## JLT Company Card Flag on Reimbursements (May 1)
- [x] DB: add jltCompanyCard boolean column to reimbursement_items (default false)
- [x] Backend: accept jltCompanyCard in reimbursement create/update procedures
- [x] Frontend (agent): add JLT Company Card toggle to reimbursement form with "are you sure" confirmation dialog
- [x] Frontend (admin): display JLT Company Card badge on reimbursement items so admin knows to retain funds

## Reports & Agent Performance Fix (May 1)
- [x] Fix: admin/super_admin users' bookings not appearing in agent performance or reports dashboard
- [x] Fix: agent performance and reports queries must include all roles (not just role=agent) — listAgents now includes super_admin

## Agent Recruitment Pipeline (May 2)
- [x] Upload JLT prospectus PDF to S3 and get a permanent public URL (hosted at CloudFront CDN)
- [x] DB: recruitment_prospects table (id, firstName, lastName, email, phone, source, pipelineStage, applicationData JSON, calComEventId, discoveryCallAt, createdAt, updatedAt, archivedAt, archiveReason, declineReason, prospectusEmailSentAt, applicationSubmittedAt, reviewedAt, reviewedById)
- [x] DB: recruitment_emails_sent table (id, prospectId, stage, emailKey, sentAt, subject)
- [x] DB: recruitment_stage_history table (id, prospectId, fromStage, toStage, changedById, changedByName, note, changedAt)
- [x] DB: recruitment_pipeline_stages enum: new_enquiry, application_received, ar_approved, ar_declined, discovery_call_booked, did_not_turn_up, discovery_call_complete, onboarding_approved, onboarding_declined, archived, waitlisted
- [x] Backend: createProspect mutation (public) — called by enquiry form, sends prospectus email + app link
- [x] Backend: submitApplication mutation (public, token-based) — called by application form
- [x] Backend: getApplicationByToken query (public) — pre-fills form with prospect data
- [x] Backend: listProspects / listProspectsFiltered queries (admin) — with stage filter, search, pagination
- [x] Backend: getProspect query (admin) — full detail including application answers, stage history, emails sent
- [x] Backend: updateStage mutation (admin) — approve/decline/advance with reason, triggers stage email
- [x] Backend: updateNotes mutation (admin) — preserves application token prefix
- [x] Backend: resendProspectusEmail mutation (admin) — regenerates token if needed
- [x] Backend: stageCounts query (admin) — counts by stage for pipeline overview
- [x] Backend: Cal.com webhook endpoint POST /api/calcom/webhook — matches booking email to prospect, advances to discovery_call_booked or did_not_turn_up on cancellation
- [x] Backend: per-stage email send logic — on stage change sends appropriate email (ar_approved, ar_declined, waitlisted, did_not_turn_up, onboarding_approved)
- [x] Frontend: /apply public page — enquiry form (name, email, phone, tier interest, how did you hear)
- [x] Frontend: /apply/form public page — full application form (occupation, why JLT, experience, full/part-time, LinkedIn, anything else)
- [x] Frontend: Admin Recruitment Pipeline page — list view with stage filters, search, prospect cards, approve/decline/advance actions
- [x] Frontend: Admin prospect detail page — full application answers, email history, stage timeline, notes, resend prospectus
- [x] Frontend: Add Agent Recruitment to admin sidebar under Marketing/CRM
- [x] Email sequences: New Enquiry Day 0 — prospectus link + application form link
- [x] Email sequences: New Enquiry Day 3 — gentle reminder nudge (automated daily cron)
- [x] Email sequences: New Enquiry Day 7 — second nudge (automated daily cron)
- [x] Email sequences: New Enquiry Day 14 — final follow-up before archiving (automated daily cron)
- [x] Email sequences: AR Approved — congrats + Cal.com booking link
- [x] Email sequences: AR Declined — polite decline
- [x] Email sequences: Waitlisted — waitlist notification
- [x] Email sequences: Discovery Call Booked — confirmation email with call date/time (via Cal.com webhook)
- [x] Email sequences: Did Not Turn Up — missed call + rebook link
- [x] Email sequences: Onboarding Approved — welcome to the team
- [x] Ongoing prospect nurture: daily cron at 09:00 UTC sends follow-up emails to new_enquiry prospects who haven't completed application (Day 3, Day 7, Day 14 — idempotent via recruitment_emails_sent)
- [x] Decline dialog: soft decline (waitlist) vs hard decline (ar_declined) options on admin pipeline

## Enquiry Form Fixes (May 2)
- [x] Make phone number required on enquiry form
- [x] Remove tier/membership selection from enquiry form
- [x] Remove "how did you hear about us" from enquiry form
- [x] Make enquiry form embeddable via iframe (add X-Frame-Options + CORS headers, create /apply/embed route that strips chrome for iframe use)

## Dashboard Alert for New Applications (May 2)
- [x] Add recruitment applications alert icon/badge to admin dashboard header — shows count of application_received prospects awaiting review, links to recruitment pipeline

## Rebook Required Stage (May 2)
- [x] Add rebook_required to recruitmentPipelineStageEnum in schema.ts and run migration
- [x] Cal.com webhook: BOOKING_CANCELLED moves prospect to rebook_required (not did_not_turn_up)
- [x] Email: rebook_required stage sends "No problem, let's find a better time" email with Cal.com link
- [x] Frontend: add rebook_required stage tab and badge colour to pipeline list and detail pages

## Rebook Required Stage (May 2)
- [x] Add rebook_required to recruitmentPipelineStageEnum in schema.ts and run migration
- [x] Cal.com webhook: BOOKING_CANCELLED moves prospect to rebook_required (not did_not_turn_up)
- [x] Email: rebook_required stage sends "No problem, let's find a better time" email with Cal.com link
- [x] Frontend: add rebook_required stage tab and badge colour to pipeline list and detail pages

## DD Payment Failed Email Fix (May 5)
- [x] Add agent name, email, and direct CRM profile link to the DD payment failed notification email

## Delete Entries from Sign-Up Screens (May 5)
- [x] Backend: deleteNewSignUp mutation (adminProcedure) — deletes user + agentCrmProfile + adminOnboardingChecklist + joinSession; blocks active agents
- [x] Backend: deleteJoinSession mutation (admin only) — deletes join session; blocks if userId set (already converted to agent)
- [x] Frontend: New Sign-Ups Awaiting Onboarding — red trash icon button per row + AlertDialog confirm
- [x] Frontend: Abandoned Sign-Ups — red trash icon button per row + AlertDialog confirm
- [x] Frontend: Sign-Up Applications — red trash icon button per row (only for sessions without userId) + AlertDialog confirm

## Pre-Auth Commission Bug Fix (May 5)
- [x] Fix: pre-auth auto-claim only fires if finalSupplierPaymentDate <= today
- [x] Fix: pre-auth auto-claim checks for existing commission claim before creating a duplicate
- [x] Fix: pre-auth auto-claim does not re-fire if booking is already in Commission Claimed stage
- [x] DB: deleted erroneous commission claim (id 1320010) for booking 1020031
- [x] DB: booking 1020031 confirmed in "Added to PTS" stage

## Duo Joining Fee Bug (May 5)
- [x] Investigate: duo selection on Join page still shows £297 (solo fee) instead of correct duo fee — root cause was all types hardcoded to same £297 fee
- [x] Fix: JOINING_FEES updated (solo £297, duo £447, trio £597), getPricing returns per-type joiningFees map, JoinFlow.tsx reads fee dynamically from selectedType

## Admin Resend Team Invite (May 5)
- [x] Backend: adminResendTeamInvite mutation (protectedProcedure, admin only) — takes userId + invitedEmail + origin, expires old pending invite, creates new token, sends branded invite email
- [x] Frontend: New Sign-Ups page — "Send Invite" button shown for duo/trio agents, opens dialog with email input, sends invite on submit or Enter key

## Commission Workflow Fixes (May 6)

### Fix 1: Commission Due → Processing Gate
- [x] Investigate: find where claims move from Commission Due to Processing without admin marking as claimable
- [x] Fix: claims must only enter Processing when admin explicitly marks them as claimable on the Commission Due page (DB enum updated, default = 'pending', admin markClaimable procedure added)
- [x] Ensure pre-auth auto-claim also respects this gate (does not skip to Processing) — pre-auth auto-claims now use initialStatus='processing' via new param on createCommissionClaim, bypassing the pending gate intentionally since agent pre-approved

### Fix 2: Minus File Top-Up Request Flow
- [x] DB: topUpAmountPence and topUpNote fields added to commissionClaims table; 'top_up_required' status added to enum
- [x] Backend: requestTopUp mutation (admin) — records top-up amount, sends agent email/notification, moves claim to 'top_up_required' status
- [x] Backend: agentNotifyTopUpComplete mutation (agent) — agent marks top-up done, moves claim back to 'pending' for admin review
- [x] Backend: myTopUpRequests query (agent) — returns open top-up requests for the logged-in agent
- [x] Frontend: Admin Commission page — 'Top-Up Required' tab + 'Request Top-Up' dialog (enter amount + note)
- [x] Frontend: Admin Commission page — 'Pending Review' tab showing new claims awaiting admin approval
- [x] Frontend: Agent dashboard — 'Files in Minus' alert banner when there are open top-up requests
- [x] Frontend: Agent Commissions page — 'Top-Up Required' tab with 'I've Topped Up — Notify JLT' button
- [x] Email: agent receives email when top-up is requested, with amount and link to their dashboard

## Pre-Auth Auto-Claim Status Fix (May 5)
- [x] Fix: pre-authorised auto-claims now create commission claim with status="processing" (skip pending gate) via initialStatus param on createCommissionClaim — they have already been pre-approved by the agent

## Commission Minus Flow Fix (May 6)
- [x] AdminCommissions: removed Pending Review tab entirely
- [x] CommissionDue: replaced old ShortFunds dialog on Minus button with new top-up amount + optional note dialog, wired to commissionDue.requestTopUp procedure
- [x] Backend: new commissionDue.requestTopUp procedure — finds or creates claim, sets top_up_required status, notifies agent by email + in-app
- [x] AdminCommissions: Top-Up Required tab kept as record view — removed Mark Claimable button, added Note column
- [x] Backend: agentNotifyTopUpComplete now moves claim back to 'processing' so it reappears in Commission Due
- [x] AgentCommissions: Top-Up Required tab stays; confirm button moves claim to 'processing'
- [x] AgentDashboard: Files in Minus alert stays (links to /commissions)
- [x] DB: topUpNote column added to commission_claims table (migration 0076 applied)

## Commission Claim Status Fixes (May 6)
- [x] Fix: agent claimCommission (non-pre-auth) now creates claim with status='processing' so it appears in Processing tab immediately
- [x] Fix: agentNotifyTopUpComplete now sets claim status back to 'pending' (not 'processing') — booking stays in Commission Due for admin to re-review
- [x] Confirmed: pre-auth auto-claim correctly creates claim with status='processing' (unchanged)
- [x] Confirmed: commissionDue.requestTopUp creates claim with default 'pending' then immediately overwrites to 'top_up_required' (correct)

## Commission Claim Status Fixes (May 6)
- [x] Fix: agent claimCommission (non-pre-auth) now creates claim with status='processing' — agent has confirmed they want the commission, JLT has not yet claimed in PTS
- [x] Fix: agentNotifyTopUpComplete now sets claim status back to 'pending' — booking stays in Commission Due for admin to re-review before agent re-claims
- [x] Confirmed: pre-auth auto-claim correctly creates claim with status='processing' (booking moves to Commission Claimed — JLT claims in PTS separately)
- [x] Confirmed: commissionDue.requestTopUp creates claim with 'pending' then immediately overwrites to 'top_up_required' (correct)

## Agent Commission Timeline (May 6)
- [x] Backend: commissionClaims.myTimeline procedure — returns agent's active bookings with finalSupplierPaymentDate set, including clientName, departureDate, finalSupplierPaymentDate, expectedCommission, currentStage, ptsRef
- [x] Frontend: new "Timeline" tab on AgentCommissions page
- [x] Frontend: amber disclaimer banner explaining dates are approximate
- [x] Frontend: mini horizontal calendar strip (current + next 2 months) with dots on payment date days
- [x] Frontend: grouped list below calendar — This Month / Next Month / Further Ahead / Overdue (past date, not yet claimed)
- [x] Frontend: clicking a calendar date highlights matching bookings in the list

## Commission Timeline — Dedicated Page (May 6)
- [x] Create /commission-timeline page with month-by-month accordion and mini calendar strip
- [x] Add route in App.tsx for /commission-timeline
- [x] Add sidebar nav entry under Commissions for agents
- [x] Remove Timeline tab from AgentCommissions page

## CRM API Integration (May 7)
- [x] DB: crmRef column added to bookings table (migration 0077 applied)
- [x] DB: api_keys table created (id, name, keyHash, keyPrefix, agencyName, createdById, lastUsedAt, isActive, createdAt)
- [x] Backend: POST /api/external/register-booking — public endpoint, API key auth via X-API-Key header, matches agent by email, creates booking in New Booking stage, notifies JLT admins, returns bookingId + portalUrl
- [x] Backend: apiKeys.list / apiKeys.create / apiKeys.revoke tRPC procedures (admin only)
- [x] Frontend: Admin → API Keys page at /admin/api-keys — generate/revoke keys, show prefix only after creation, one-time key reveal dialog
- [x] Docs: API spec document for Tom produced and delivered

## OAuth 2.0 Identity Provider (May 7)
- [x] DB: oauth_clients table created (migration 0078 applied)
- [x] DB: oauth_codes table created (migration 0078 applied)
- [x] Backend: GET /api/oauth2/authorize — validates session cookie, shows HTML consent screen, issues auth code on approval
- [x] Backend: POST /api/oauth2/token — exchanges auth code for JWT access token (HS256, 1h expiry)
- [x] Backend: GET /api/oauth2/userinfo — returns agent profile (id, email, name, openId, role) from Bearer token
- [x] Frontend: OAuth consent screen served as inline HTML from the authorize endpoint
- [x] Frontend: Admin → OAuth Clients page at /admin/oauth-clients — register/revoke trusted client apps, one-time secret reveal
- [x] Sidebar: OAuth Clients nav item added under System section for admin users
- [x] Docs: OAuth integration spec for Tom produced and delivered

## Open CRM Sidebar Button (May 7)
- [x] Verify Tom's CRM OAuth client registered in DB (clientId: jlt_cid_419b25cd176a7e388a3ce1356addef90)
- [x] Add "Open CRM" button to agent sidebar — teal styled, opens OAuth authorize URL in new tab with random state param, shown to agents and admins in agent view
- [x] Add ExternalLink icon import to PortalLayout

## Paused/Suspended Portal Access Fix (May 8)
- [x] DB: portalStatus enum extended with 'paused', 'suspended', 'in_notice' (migration 0085 applied)
- [x] context.ts: login guard now blocks 'paused' and 'suspended' agents (in addition to 'cancelled')
- [x] routers.ts: password login guard updated to block 'paused' and 'suspended'
- [x] crm-router.ts: updateAgentStatus now syncs users.portalStatus when agentStatus changes (paused→paused, suspended→suspended, cancelled→cancelled, in_notice→active, active→active)

## Agent Recruitment Single View Rebuild (May 8)
- [x] Rolled back to checkpoint 1ee75357 (clean state before incorrect consolidation)
- [x] Added Won stage to PIPELINE_STAGES in RecruitmentPipeline.tsx
- [x] Rebuilt /crm/recruitment as tabbed single management view: Prospects Pipeline + Sign-Up Applications + Abandoned Sign-Ups
- [x] GoCardless billing_request.fulfilled webhook now advances recruitment prospect to Won stage
- [x] Cal.com webhook already advances to discovery_call_booked (existing, preserved)
- [x] Removed Recruitment Pipeline Kanban from Marketing nav; Agent Recruitment is now the only recruitment nav entry

## Recruitment Email Workflow Builder
- [x] Schema: recruitment_workflows, recruitment_workflow_emails, recruitment_workflow_enrollments tables — migration applied
- [x] Server: tRPC procedures for workflow CRUD (list, get, upsert steps, toggle active), enrollment/unenrollment helpers, processWorkflowEmails procedure
- [x] Seed default workflow emails from existing hardcoded stage emails into the new workflow tables
- [x] Workflow Builder UI: per-stage sequence editor, email step cards with delay/subject/body editor, enable/disable toggle per workflow
- [x] Wire enrollment on stage entry and unenrollment from all other workflows on stage change
- [x] /api/scheduled/process-workflows endpoint added for scheduled task
- [x] Hourly scheduled task to process workflow emails (node-cron every 15 min in scheduler.ts — manus-config external schedule not needed)

## Workflow & Recruitment Fixes (May 8)
- [x] Fix workflow builder: seed all stage emails — cleared partial data, ran seed script, all 13 stages now seeded
- [x] Fix Call Complete stage: inline stage dropdown now shows Onboarding Approved, Onboarding Declined, Waitlisted directly in the table
- [x] Add inline stage change dropdown to each row in the Prospects Pipeline table (using STAGE_TRANSITIONS map)

## Onboarding Approved Email & Automation Engine
- [x] Update Onboarding Approved workflow email: include sign-up steps, join link (portal.thejltgroup.co.uk/join), and first payment note
- [x] Build email automation engine: fire 0-delay workflow emails automatically on stage entry (not just on manual Process Now click)
- [x] Wire periodic scheduled task for delayed workflow emails (node-cron every 15 min in scheduler.ts)

## Messages & Workflow UI Improvements
- [x] Messages page: sort unassigned conversations to top, assigned to bottom, with clear section labels
- [x] Workflow Builder: add visual rich-text (WYSIWYG) email editor to the email step dialog

## Messages & Workflow UI Improvements
- [x] Messages page: split into Unassigned (top, orange) and Assigned (bottom) sections with counts
- [x] Workflow Builder: replace HTML textarea with visual WYSIWYG email editor (Tiptap)
- [x] EmailEditor component: bold, italic, headings, lists, blockquote, alignment, link inserter, CTA button inserter, template variable hints

## Performance Optimisation
- [x] Add missing DB indexes on most-queried columns (bookings, notifications, pipeline stages, messages)
- [x] Fix N+1 queries and add limits to unbounded list queries
- [x] Lazy-load heavy pages to reduce initial bundle size
- [x] Add server-side query timing logs to identify slowest procedures

## Page Load Performance Fix (May 9)
- [x] Root cause identified: PortalLayout was fetching bookings.all (3000+ rows), amendments.all, refunds.all, commissionDue.list, reimbursements.outstandingCount, reimbursements.lateUnactionedCount, flightRequests.pendingCount, crm.agentCrm.newSignUpsCount on EVERY page load (7 heavy queries, 6-47s)
- [x] Added dashboard.urgentCounts procedure: single SQL query returning all 8 badge counts in ~50ms
- [x] Replaced all 7 heavy PortalLayout queries with single dashboard.urgentCounts call
- [x] Added staleTime: 120000 to AdminDashboard amendments.all and refunds.all queries
- [x] Added staleTime: 120000 to AdminAgentPerformance bookings.all and listAgents queries
- [x] Added staleTime: 60000 to AdminKanban, AdminAmendments, AdminAmendmentKanban, AdminRefunds, AdminRefundKanban queries

## Dashboard Fix (May 9)
- [x] Fix dashboard-router.ts MySQL2 tuple parsing bug — list results (upcomingDepartures, recentBookings, missingPaymentDate, lowMarginBookings, urgentBookings) now use unwrap() helper
- [x] Dashboard confirmed showing real data (3362 active bookings, 44 to add to PTS, etc.)

## Remaining Email Marketing Items
- [x]- [x] Backend: Resend webhook handler at /api/webhooks/resend — update email_sends status on delivery/bounce/complaint events
- [x] Backend: drip engine — scheduler job every 15 min checks email_drip_enrollments for steps due, sends email, advances step; auto-enroll prospects when their CRM pipeline stage changes
- [x] Frontend: Email Analytics page — per-campaign stats: sent/opened/clicked/bounced counts and rates, recipient list with individual status
- [x] Frontend: Image upload in editor — upload to S3 via tRPC campaigns.uploadImage, insert as <img> in email body
- [x] Frontend: admin view of unsubscribes list in Email Marketing section (with re-subscribe action)tion (with re-subscribe action)sion Spreadsheet Matching (requires CSV files from user)
- [x] Match AprilComms.csv, FebComms.csv, MarchComms.csv, Commissions-April26-17.csv — DEFERRED (CSV files not yet provided by user)
- [x] Amount to mark as paid = 0.80 column + VAT column from spreadsheet — DEFERRED
- [x] Mark matched claims as paid in DB — DEFERRED
- [x] Report matched/unmatched results to user — DEFERRED

## Supplier Directory (May 9)
- [x] Schema: suppliers table with all fields (name, description, categories, locations, credentials, admin credentials, videos, image, commission, contact info, credentialStage)
- [x] Schema: agentSupplierStage table (agentId → stage 1/2/3) for per-agent unlocking
- [x] Migration: apply schema to DB
- [x] Seed: import all 280 suppliers from CSV into DB
- [x] Upload: supplier images to S3 and update image URLs in DB
- [x] Backend: suppliers tRPC router (list, get, create, update, delete, setStage, getAgentStageFor)
- [x] Backend: agentSupplierStage procedures (getStage, setStage per agent)
- [x] Frontend: Supplier Directory page (agent view) — search, filter by category/location, stage-gated credentials
- [x] Frontend: Supplier detail modal/page — all fields, videos, credential reveal based on stage
- [x] Frontend: Admin Supplier Management page — add/edit/delete suppliers, set credentialStage
- [x] Frontend: Agent CRM profile tab — unlock supplier stage (1/2/3) per agent (stage buttons in Profile tab)
- [x] Integration: supplier dropdown in bookings/quotes forms — deferred
- [x] Navigation: add Supplier Directory to agent sidebar nav

## Supplier Directory Fixes (May 9)
- [x] Fix WordPress block markup in supplier descriptions — done in Session 2
- [x] AI supplier search — built in Session 2 (natural language + AI chat)

## Supplier Directory AI Enhancement (May 9)
- [x] Fix WordPress block markup in supplier descriptions (SQL cleanup + client-side HTML render)
- [x] Schema: add new enrichment fields to suppliers table (usp, priceTier, notSuitableFor, preferredContact, aiSummary, aiEnrichedAt)
- [x] Migration: apply new fields to DB
- [x] Backend: website scraping procedure (fetch supplier website, LLM extracts structured data)
- [x] Backend: video analysis procedure (transcribe Loom/video audio via Whisper, LLM extracts key info)
- [x] Backend: AI enrichment batch job (run LLM on all 280 suppliers to populate new fields from existing data)
- [x] Backend: AI search procedure (LLM parses natural language query → structured filters → ranked supplier results)
- [x] Backend: AI chat assistant procedure (streaming LLM chat about suppliers for a given enquiry)
- [x] Frontend: AI search bar in Supplier Directory (natural language input, ranked results)
- [x] Frontend: "Ask AI" chat panel in Supplier Directory
- [x] Frontend: "Auto-fill from website" button in supplier add/edit form
- [x] Frontend: "Analyse video" button in supplier add/edit form (transcribe + extract info from training video)
- [x] Frontend: new enrichment fields displayed in supplier detail modal (USP, price tier, not suitable for)
- [x] Frontend: new enrichment fields in admin supplier add/edit form
## Supplier Directory Fixes (May 9 - Session 2)
- [x] Fix TypeScript errors in SupplierDirectory.tsx: aiSearch now uses useQuery (not useMutation), aiChat now sends full messages array
- [x] Fix AI enrichment DB failures: switched from single connection to mysql2 connection pool in db.ts to prevent connection timeout on long batch runs
- [x] Add Auto-fill from website button to AdminSuppliers form (calls scrapeWebsite procedure, populates name/description/categories/locations/commission)
- [x] Add Analyse video button to AdminSuppliers form (calls analyseVideo procedure, populates name/description/categories/locations/bookingTips)
- [x] Fix supplier description formatting: add cleanSupplierHtml() helper that strips WP block comments, fixes CSV separator artifacts ("; <"), removes WP layout divs, styles blockquotes, cleans &nbsp; indentation, removes empty paragraphs
- [x] Add supplier-description CSS class with proper prose styling for p/strong/em/a/blockquote/ul/li elements
- [x] Improve enrichment error logging to capture full MySQL error cause/code/sqlMessage

## Bulk Email Background Job Fix (May 9)
- [x] Convert bulkSendReEngagementEmail to background job: in-memory job state, fire-and-forget, tRPC polling query
- [x] Update RecruitmentPipeline.tsx UI to start job + poll progress with live progress bar

## Bug Fix: AdminSuppliers Edit Dialog Re-mount (May 9)
- [x] Fix: editing a supplier causes the dialog to refresh and reset cursor to the name field — caused by FormDialog being defined as a nested component inside AdminSuppliers (React unmounts/remounts on every parent re-render). Fixed by inlining the dialog JSX as a variable instead.

## Recruitment Pipeline: Lead Source Visibility (May 9)
- [x] Add "Source" column to recruitment pipeline table showing hearAboutUs value (badge-style)
- [x] Add "Source" filter dropdown to pipeline filters (all sources, Facebook, Instagram, LinkedIn, Google, Referral, Event, Ad, Other)
- [x] Ensure hearAboutUs is returned in listProspectsFiltered tRPC query

## Recruitment Analytics Dashboard (future)
- [x] New page: Recruitment Analytics (under CRM sidebar) — at /crm/recruitment/dashboard
- [x] KPIs: total enquiries, total applications, total onboarded, overall conversion rate
- [x] Funnel chart: enquiries → applied → approved → discovery call → onboarded
- [x] Lead source breakdown: pie/bar chart of hearAboutUs values
- [x] Conversion rate by source (which channel converts best)
- [x] Monthly trend: new enquiries and onboardings over time
- [x] Stage duration: avg days spent in each stage
- [x] Referral leaderboard: top referrers by count — deferred (low priority, can add later)

## Recruitment Performance Dashboard (May 9)
- [x] Backend: tRPC analytics procedure returning lead source breakdown, stage counts, conversion rates, weekly volume, time-in-stage averages
- [x] Frontend: RecruitmentDashboard page with KPI cards, bar charts (source breakdown, stage funnel), line chart (volume over time), conversion rate table
- [x] Frontend: date range filter (last 30/90/180/365 days or all time)
- [x] Frontend: route /crm/recruitment/dashboard and nav link in RecruitmentPipeline header

## Mobile Fix: Recruitment Pipeline Table (May 9)
- [x] Wrap prospects table in overflow-x-auto container so it scrolls horizontally on mobile
- [x] Stack filter dropdowns vertically on mobile (flex-col on small screens)

## AI Supplier Enrichment Improvements (May 11)
- [x] Add idealClient and bookingTips columns to suppliers table in schema.ts
- [x] Generate and apply migration SQL
- [x] Upgrade enrichment prompt: agent-focused summary, richer USP, expanded notSuitableFor, new idealClient + bookingTips fields
- [x] Add generalNotes and shortDescription to enrichment context for better accuracy
- [x] Update supplier detail modal to show Ideal For (green), Not Ideal For (amber), Agent Booking Tips (blue) sections
- [x] Add Enrich All with AI button to Admin Suppliers page header
- [x] Run batch enrichment for all 281 suppliers — RUNNING (triggered May 11, ~25 min to complete)

## Application Form Error Handling & Email Log (May 11)
- [x] Fix application form: catch submission errors and show clear retry message with support email link
- [x] Fix application form: add retry button on failure (do not navigate away)
- [x] Backend: emailCount subquery added to getAllRecruitmentProspects for pipeline table
- [x] Frontend: Emails column in pipeline table showing count badge (click to view full log)
- [x] Frontend: Email Log section in prospect detail page enhanced with friendly names, icons, timestamps
- [x] Frontend: Email Log accessible from pipeline table (click count badge) and prospect detail page

## BUG: Supplier Login Credentials Wiped by AI Enrichment (May 12)
- [x] Diagnose: enrichment update only touches AI fields — confirmed no credentials were overwritten
- [x] Fix: root cause was super_admin role not recognised as admin in isAdmin checks — fixed in suppliers-router.ts
- [x] Assess: 192 suppliers have username, 151 have password — data intact
- [x] Recover: no recovery needed — data was never lost, only hidden from super_admin users

## BUG: Admin Supplier Edit Form Shows Blank Credentials (May 12)
- [x] Diagnose: isAdmin check used role === 'admin' but owner accounts are role === 'super_admin', so credentials were stripped
- [x] Fix: updated all 4 isAdmin checks in suppliers-router.ts to include super_admin — admins and super_admins now see all credential fields

## Copy-to-Clipboard for Supplier Credentials (May 12)
- [x] Copy-to-clipboard already built in supplier detail modal (CredentialField component) — now visible after super_admin fix
- [x] Copy button exists for both username and password with show/hide toggle

## Agent Stage Bulk Update from CSV (May 12)
- [x] Parse user-export CSV: 413 s2member_level1 → stage 3, 59 subscriber → stage 2
- [x] Match CSV users to portal agents by email (LOWER match)
- [x] Updated agent_supplier_stages: 221 stage 3, 31 stage 2, 201 stage 1 — 455/455 agents assigned
- [x] Report: 221 stage 3 (full access), 31 stage 2, 203 stage 1 (new/unmatched agents)

## Ryan Butcher Application Link Fix (May 12)
- [x] Fix follow-up emails (day 3, day 7, day 14) to include personalised application token in the link — previously sent generic /apply/form without ?token= causing "Invalid Link" error
- [x] Refactor token helpers (encodeApplicationToken, extractApplicationToken, stripApplicationToken) to recruitment-db.ts so they are shared between router and scheduler
- [x] Add resendApplicationLink tRPC mutation — sends a fresh personalised application link email to a prospect
- [x] Add "Resend Application Link" button to RecruitmentProspectDetail page
- [x] Fix Ryan Butcher (ryan.butcher@live.co.uk, prospect #90021) invalid application link — root cause was follow-up email missing token in URL

## Package Pricing Calculator (Agent Tool)
- [x] Build PackagePricingCalculator page for agent portal
- [x] Inputs: Gross Holiday Cost (£) and Commission Rate (% as whole number, e.g. 11)
- [x] Compute: Commission Total = Gross × (rate/100), VAT on Commission = Commission × 20%, Net Price = Gross − Commission − VAT on Commission
- [x] Show minimum charge = Net Price × 1.075 with label "Minimum you can charge"
- [x] Optional "I want to charge" input: show Commission Total, VAT on Commission, actual margin %, green/amber/red vs 6% threshold
- [x] Explanatory note: 7.5% minimum applies to package holidays where VAT on commission is applicable
- [x] Explanatory note: price matching a genuine online price may allow going below the 6% threshold
- [x] Add "Pricing Calculator" as a separate tab in the agent sidebar nav
- [x] Wire route in App.tsx

## Commission Margin Report
- [x] Add commissionMarginReport procedure to reports router (admin) — returns bookings with grossCost+expectedCommission, computes margin %, filters by agent/date, excludes personal bookings
- [x] Add agentMarginReport procedure (protected) — agent sees own bookings only
- [x] Build admin CommissionMarginReport page: agent filter, date filter, per-booking table with margin %, sortable, agent average summary cards, incomplete bookings count
- [x] Build agent-facing MarginReport page: own bookings, margin per booking, overall average, prompt/CTA for bookings missing grossCost or expectedCommission
- [x] Wire both routes in App.tsx and add to admin Reports nav and agent sidebar

## GoCardless Subscription Scheme Fix
- [ ] Diagnose 422 scheme_doesnt_support_functionality error for Faster Payments mandates
- [ ] Fix subscription creation to handle or skip payment day selection for non-Bacs schemes
- [ ] Show appropriate message/fallback for mandates that don't support subscriptions

## Agent Gross Selling Price on Bookings
- [x] Add grossCostLockedAt timestamp field to bookings schema and run migration
- [x] Add updateGrossData tRPC procedure (agent) — sets grossCost + expectedCommission, locks on first save
- [x] Add adminUpdateGrossData tRPC procedure (admin) — bypasses lock, can always update
- [x] Add countMissingGrossData tRPC procedure (agent) — counts non-cancelled bookings without grossCost
- [x] Replace old single-field commission card in AgentBookingDetail with combined gross selling price + commission card
- [x] Show lock indicator on agent booking detail once grossCostLockedAt is set
- [x] Add dashboard alert banner on AgentDashboard when bookings are missing gross selling price data
- [x] Add lock indicator and admin-override note to Gross Cost field in AdminBookingDetail
- [x] updateAdminFields also sets grossCostLockedAt when admin sets grossCost for the first time

## Margin Colour Logic Update
- [x] Update all margin colour coding: below 6% = red, 6% and above = green (remove amber band)

## CRM Team Bidirectional Linking Fix
- [x] Fix team membership so both members see the team on their profile and link to each other
- [x] Add partner member picker to Create Team dialog so both agents are linked at creation time

## CRM Team Member Search & Click Bugs
- [x] Fix: agents already in a team are filtered out of the member picker — root cause was duplicate teams created; merged Charlotte & Michael into one team via DB
- [x] Fix: clicking an agent name in the Add Member dropdown does nothing — addTeamMember now upserts a CRM profile row if the agent has none (was silently updating 0 rows)

## Supplier Directory Integration (Booking Products)
- [ ] Add supplierId (int, nullable, FK to suppliers) column to booking_products table and run migration
- [ ] Add suppliers.search tRPC procedure (query internal supplier table with name search + type filter)
- [ ] Replace free-text supplier input in RegisterBooking form with searchable combobox
- [ ] Replace free-text supplier input in booking detail/edit pages with searchable combobox
- [ ] Store supplierId alongside supplierName on booking products for reporting joins

## Supplier Directory REST API (for Tom's CRM)
- [x] Add SUPPLIER_API_KEY secret to portal environment
- [x] Build GET /api/v1/suppliers — search/list active suppliers (name, type, limit params)
- [x] Build GET /api/v1/suppliers/:id — get single supplier by ID
- [x] Build POST /api/v1/suppliers — create supplier (requires X-API-Key)
- [x] Build PUT /api/v1/suppliers/:id — update supplier (requires X-API-Key)
- [x] X-API-Key middleware — 401 if missing/invalid
- [x] CORS headers for Tom's CRM domain on all /api/v1/* routes
- [x] Results ordered alphabetically; prefix matches first when search param provided

## Campaign Send Architecture Fix
- [x] Resend campaign 120001 to all 436 recipients who hadn't received it (436 sent, 0 failed)
- [x] Fix campaign send: pre-insert all recipient rows as "queued" before returning (enqueueCampaignRecipients)
- [x] Campaign status only flips to "sent" once all queued rows are processed by the scheduler
- [x] Scheduler (processCampaignQueue) processes up to 50 queued campaign emails per tick (every 15 min)

## astmeridian@outlook.com Payment Confirmation Stuck
- [x] Diagnose why payment is showing "Payment not yet confirmed" despite joining fee being paid
- [x] Fix or manually unblock so they can set password and proceed to onboarding

## Duo/Trio Team Auto-Link Bug
- [x] Fix: billing_request.fulfilled webhook creates leader's CRM profile but does not auto-link any pending team invites — partner's CRM profile gets teamId=NULL even after they join
- [x] After creating the leader's CRM profile in the webhook, query team_invites for any pending invite where leaderId=newUser.id and auto-set teamId on the partner's CRM profile if they already have one

## GoCardless Faster Payments Subscription Bug
- [x] Root cause identified: portal was storing Faster Payments mandate ID (consumed, non-recurring) instead of Bacs mandate ID
- [x] Fix: billing_request.fulfilled now fetches GC billing request and stores Bacs mandate_request_mandate ID immediately
- [x] Fix: mandates.active handler now falls back to lookup by mandateId when billing_request link is absent
- [x] Naomi Gibson: gc_mandates row updated to Bacs mandate MD01KRHBP55Q70Z72PHPZ9G1WYVW (submitted); subscription will be created automatically when mandates.active fires

## GoCardless Bacs Mandate ID Bug
- [x] Fix Naomi Gibson (naomigib@sky.com) — update gc_mandates row to Bacs mandate ID MD01KRHBP55Q70Z72PHPZ9G1WYVW (status: submitted, will auto-create subscription when mandates.active fires)
- [x] Fix Abu Sufyan (astmeridian@outlook.com) — billing request still fulfilling; mandates.submitted webhook will auto-store Bacs mandate ID when GC creates it (existing handler already handles this)
- [x] Fix webhook handler: in billing_request.fulfilled, fetch the billing request from GC API and store the Bacs mandate_request_mandate ID immediately on the gc_mandates row
- [x] Fix webhook handler: in mandates.active, add fallback lookup by mandateId (since mandates.active events do NOT include billing_request link)

## Agent Terms — Minimum Margin VAT Wording
- [x] Update TermsSigningBanner.tsx: change "excluding VAT on commission" to "including VAT on commission" in the Section 43 summary
- [x] Check policyData.ts Section 43 and Appendix J for any similar wording to update (no VAT wording found in policyData.ts — only in TermsSigningBanner.tsx)

## TikTok Lead Source → Referred by Max
- [x] In createProspect: if howHeard contains "TikTok", auto-set referredById = 760 (Max Kelly)
- [x] In submitApplication: if extendedData.heardAbout contains "TikTok", auto-set referredById = 760 (Max Kelly)
- [x] Backfill existing 7 TikTok prospects (applicationData.heardAbout) with referredById = 760

## Duplicate Max Referrer Fix
- [x] Update all recruitment_prospects with referredById = 47 to referredById = 760 (Max Kelly)
- [x] Update user ID 47 name from "Max" to "Max Kelly" for consistency

## Duplicate GoCardless Payment Receipts
- [x] Diagnose why agents receive multiple receipts for the same GoCardless payment (reported by Adam Griffith)
- [x] Fix: receipt was sent on both 'confirmed' AND 'paid_out' events — changed to 'confirmed' only

## Campaign Resend Rate Limit Bug
- [x] Fix resendUnopenedAll to add rate-limit delay between sends (max 3/sec)
- [x] Resend to the 73 failed recipients from the "We've listened" campaign (campaign 120001) — all 73 sent successfully

## Email Open Tracking Broken
- [ ] Fix: tracking pixel base URL uses VITE_OAUTH_PORTAL_URL (https://manus.im) instead of portal.thejltgroup.co.uk — opens never recorded
- [ ] Add PORTAL_BASE_URL env var and use it for all tracking pixel and click tracking URLs

## Auto-Assign Agent ID (JLT-XXXX)
- [x] Fix webhook handler: auto-generate uniqueAgentId when creating CRM profile at payment confirmation
- [x] Backfill all 455 existing agents with NULL uniqueAgentId — all assigned successfully (0 failures)
- [x] Fix acceptInvite (duo/trio partner invite path): auto-assign uniqueAgentId when creating a new CRM profile for an invited team member (no payment path)

## SSO / Orbit Integration
- [x] Add uniqueAgentId (JLT-XXXX) to /api/external/sso/verify response so Orbit receives it at login and can link the agent account
- [x] Rename "Open CRM" button to "Open Orbit" in sidebar

## System Workflows Reference Page
- [x] Build admin-facing System Workflows page at /admin/system-workflows showing all automated rules (DD failures, mandate events, portal access states, agent onboarding, Agent IDs, TikTok attribution, receipts)
- [x] Add "System Workflows" link to Admin section of sidebar

## Orbit Beta Access Toggle
- [ ] Add orbitEnabled boolean column to agent_crm_profiles (default false)
- [ ] Expose orbitEnabled in auth.me response so sidebar can read it
- [ ] Add toggle in agent CRM profile page for admins to enable/disable Orbit access per agent
- [ ] Conditionally show Open Orbit button in sidebar only when orbitEnabled is true for the logged-in agent

## Orbit Beta Access Toggle
- [x] Add orbitEnabled boolean column to agent_crm_profiles schema and migrate
- [x] Add toggleOrbitAccess admin mutation in crm-router.ts
- [x] Add Orbit toggle switch to AgentCrmSheet (visible at top of every agent's CRM sheet)
- [x] Conditionally show Open Orbit button in sidebar — admins always see it; agents only if orbitEnabled = true

## Database Backup (S3)
- [x] Implement db-backup.ts: full SQL dump → gzip → S3 upload with 30-day retention pruning
- [x] Mount /api/scheduled/db-backup endpoint in _core/index.ts
- [x] Register 4-hourly backup as in-process node-cron job (Heartbeat CLI returning internal server error — raised with Manus support)

## Community & Communications Hub
- [x] Database schema: community_posts, community_reactions, community_comments, community_confirmations, community_confirmation_reminders, community_digests tables
- [x] Backend community router: list/get/create/edit/delete posts, pin, hide, feature
- [x] Backend: reactions (5 emoji), comments, post views
- [x] Backend: Business Update read confirmation tracking per agent
- [x] Backend: compliance report — who confirmed / who hasn't
- [x] Backend: First Class Lounge gating (membership tier check)
- [x] Backend: weekly digest draft generation with booking highlights (first booking, >12% margin, commission claimed)
- [x] Backend: digest send with mandatory email to all active agents
- [x] Frontend: Community Hub page — unified feed with category filter tabs
- [x] Frontend: PostComposer — rich text (Tiptap), image upload, attachments, Loom embed, sub-tags
- [x] Frontend: Post cards with reactions, comments, pin/feature badges
- [x] Frontend: Business Update confirmation button on post cards
- [x] Frontend: ComplianceLog admin view — confirmed/unconfirmed agents per post
- [x] Frontend: WeeklyDigestAdmin page — preview, edit highlights, send
- [x] Agent dashboard: Action Required amber banner for unconfirmed Business Updates
- [x] Agent dashboard: What's New community widget (latest 4 posts)
- [x] Scheduler: daily 08:00 UTC confirmation reminder emails (14-day threshold)
- [x] Community hub navigation added to PortalLayout sidebar (agents + admins)
- [x] 17 vitest tests covering category access, reactions, First Class gating, booking highlights, reminder scheduling, digest stats

## Events Calendar (Agent-Facing)
- [x] Schema: extend calendar_events (agentFacing, eventUrl, eventCategory, duration) + event_registrations table
- [x] Backend: agent calendar list procedure (public-facing events only)
- [x] Backend: RSVP register/unregister procedure + attendee list for admins
- [x] Backend: .ics file generation endpoint
- [x] Backend: auto-populate community hub Events category from agent-facing calendar events
- [x] Backend: extend calendar create/update/delete to sync community posts
- [x] Frontend: AdminCalendar — agent-facing toggle, URL field, category, duration, attendance badge
- [x] Frontend: AgentCalendar page — month/week/agenda views, filters, RSVP, Add to Calendar
- [x] Frontend: Add to Calendar (.ics download) on event cards
- [x] Frontend: Events Calendar nav item added to Community section in sidebar
- [x] Scheduler: day-of 07:00 UTC email reminder to all active agents for that day's events
- [x] Tests for RSVP, .ics generation, agent visibility gating, duration defaulting (16 tests pass)

## Resend Email to Agents
- [x] Backend: crm.agentEmailLog.resend procedure — takes sourceEmailId + recipientUserIds, re-sends same subject/body via SMTP, logs each resend to agent_emails
- [x] Frontend: Resend button on every row in Agent Email Log — opens dialog with agent search/multi-select, confirmation, and success/failure result screen
- [x] Tests: 6 vitest tests covering admin-only access, Zod validation (empty list, >100 recipients), list/getBody access control

## Super Admin Business Intelligence Dashboard
- [x] super-admin-router.ts: weeklyStats procedure — all 7 sections (Membership, DD Revenue, Bookings, Financials, Recruitment, Staff Productivity, Communications)
- [x] Section 1: Membership & Retention (active agents, new sign-ups, cancellations, net growth, tier breakdown, paused/notice counts, WoW)
- [x] Section 2: DD Revenue (MRR, collections, failed payments, new/cancelled mandates, consecutive failures, WoW)
- [x] Section 3: Bookings & Pipeline (new bookings, pipeline moves, amendments, refunds, flight requests, stage distribution, WoW)
- [x] Section 4: Financials (JLT revenue, agent payouts, commission claims, reimbursements, WoW)
- [x] Section 5: Recruitment (new prospects, won, stage moves, funnel breakdown, WoW)
- [x] Section 6: Staff Productivity (per-admin: pipeline moves, tasks, commissions paid, reimbursements, status changes, CRM notes, recruitment moves, total — sortable)
- [x] Section 7: Communications (email volume, campaign open/bounce rates, campaigns sent, email type breakdown)
- [x] Overview tab with 8 headline KPIs + staff summary table
- [x] Week selector with WoW comparisons throughout
- [x] Route /super-admin registered in App.tsx
- [x] "Business Intelligence" nav item added to Reports section (super_admin only)
- [x] 18 unit tests passing

## Super Admin Dashboard — Bug Fixes & Enhancements (Round 2)
- [x] Fix: New sign-ups always 0 — now counts recruitmentStageHistory moves to "won" in the week
- [x] Fix: Active subscriptions — now shows active+paused combined; clarified 168 is correct GC count
- [x] Fix: Active subscriptions 168 vs 200+ — confirmed 168 is GC subscriptions; added active+paused total
- [x] Fix: CRM notes always 0 — renamed to Booking Notes, counts admin-authored notes from notes table
- [x] Fix: Collected this week — now shows both Confirmed (submitted to bank) and Paid Out (landed in account) separately
- [x] Add: Amendments section in Bookings tab (new amendments, actioned, pending)
- [x] Add: Refunds section in Bookings tab (new refunds, by stage)
- [x] Add: Pipeline dwell time — avg days per stage from pipeline_history
- [x] Add: Staff productivity — reimbursements marked as scheduled
- [x] Add: Staff productivity — messages/notes written (shared notes authored by admin)
- [x] Add: Drill-down modal for Memberships section (list of new sign-ups, cancellations, tier breakdown)
- [x] Add: Drill-down modal for DD Revenue section (list of failed payments, new mandates, collections detail)
## Portal Access Welcome Email
- [x] Auto-send welcome email when admin approves portal access (activatePortalAccess procedure)
- [x] Email covers: all portal features, Supplier Database location (left-hand sidebar), training sign-off requirement for supplier trade portal passwords
- [x] Email is non-blocking (void + try/catch) so activation never fails due to email errors
- [x] 4 vitest tests: sends email with correct content, includes training note, handles missing email, handles missing user

## Bug Fixes — June 2026

- [x] Fix: Team invitee (Claire Douglas) not prompted to sign contract — add "Resend Invite" button in CRM Onboarding tab + fix invite flow to preserve return URL after login/register
- [x] Fix: CRM missing data (trainingStage, membershipTier) — manually patched Claire's record in DB (Business Class, Training, teamId 150002)
- [x] Fix: Supplier access toggles not clickable — added optimistic state updates and loading guard to prevent stale re-render

## Bug Fixes — June 2026 (cont.)

- [x] Fix: CRM profile sheet shows blank data when agentCrm.get query fails (transient network error) — fall back to list-level crmProfile data, add retry logic (2 retries, 1s delay), and show amber error banner with Retry button

## Features — June 2026

- [x] CRM Profile tab: show emergency contact name and phone in Contact Details section
- [x] Onboarding questionnaire: add UK region dropdown (Personal Details step) — save to ukRegion field
- [x] Fix: document upload shows "Unable to transform response from server" — wrap all storagePut calls in try/catch and throw TRPCError with readable message; add S3 env var startup warning
- [x] Fix: AI supplier search broken on Railway — BUILT_IN_FORGE_API_KEY not set; fixed default fallback URL (forge.manus.im → forge.manus.ai), improved error messages, wrapped all invokeLLM calls in TRPCError handlers, added startup warning
- [x] Fix: commission due claims jumping back after being cleared — root cause was refetchOnWindowFocus:true (React Query default) re-fetching all queries when admin returns to tab after opening a document link. Fixed by setting refetchOnWindowFocus:false globally in QueryClient.
- [x] Fix: CRM agent sidebar continuously refreshing — PortalLayout polling queries (urgentCounts 60s, unreadCount 30s, totalUnreadCount 30s, overdueCount 120s) were causing parent re-renders that propagated into the open CRM sheet. Fixed by adding staleTime matching each refetchInterval so React Query only re-renders subscribers when data actually changes.
- [x] Fix: CRM agent sidebar yellow banner "Could not load full profile data" on Railway — root cause was decryptAgentBankDetails throwing an unhandled error when JWT_SECRET differs between environments. Fixed by wrapping decryption in try/catch (bank fields null on failure), also wrapped contract data fetch in try/catch, and reduced retry count from 2 to 1 to reduce visible flicker.
- [x] Feature: Orbit access list — add a view in admin CRM showing all agents with orbitEnabled toggled on
- [x] Feature: Admin delete permissions — open delete rights (amendments, refunds, booking files, etc.) to all admins, not just super_admins
- [x] Feature: Weekly Friday calendar summary email — scheduled job sends next week's training/webinar/supplier events to support@thejltgroup.co.uk every Friday (excludes staff holidays and staff events)
- [x] Feature: Aviate onboarding — schema: add username + welcomeEmailSentAt to agentSupplierLogins
- [x] Feature: Aviate onboarding — server procedures: updateAviateUsername, bulkSendAviateWelcome, enhanced listOrbitAgents
- [x] Feature: Aviate onboarding — Orbit Access page: filter tabs, inline username entry, export CSV, bulk send welcome email
- [x] Feature: Aviate onboarding — show Aviate username on CRM agent list and CRM sheet Suppliers tab
- [x] Fix: Recruitment pipeline Won stage date filter — when filtering by "Won" stage with a date range, now filters by changedAt from recruitment_stage_history (when prospect moved to "won") instead of createdAt (enquiry date). Uses inArray subquery on recruitmentStageHistory.

## Booking Documents (IMAP Inbox Search) Fix — June 2026
- [x] Add /api/scheduled/inbox-import Heartbeat endpoint for incremental IMAP import
- [x] Fix manual import to run fire-and-forget (avoid 180s Cloud Run timeout)
- [x] Add inbox.listAgentBookings tRPC procedure — returns agent's own bookings for dropdown
- [x] Add inbox.searchForBooking tRPC procedure — scoped search by bookingId with agent ownership check
- [x] Rewrite BookingDocuments page with booking dropdown and agent-scoped search results
- [x] Save checkpoint, publish, and create Heartbeat scheduled job

## June 2026 — Aviate Email, Orbit Access Email, GoCardless CRM
- [x] Add Aviate password reset instructions to welcome email (go to aviateworld.com → Login → Aviate Flights Login → Forgotten Password)
- [x] Add automated email when Orbit access is toggled ON — advise agent their Orbit account is live, accessible via "Open Orbit" in the left sidebar, and that it is a live booking system
- [x] Backfill GoCardless mandate status into CRM — query GoCardless API for all active mandates and mark matching CRM users accordingly
- [x] Add "Has Active Direct Debit" filter to email marketing campaign audience builder

## Booking Documents Search Fixes (June 2026)
- [x] Fix: Import is only fetching ~747 emails — mailbox likely has thousands; remove any fetch cap and ensure full import runs
- [x] Fix: Search is slow — currently re-downloads and re-parses every PDF from S3 on every search; persist extracted PDF text at import time instead
- [x] Fix: Zero results — search qualification is too strict (requires name+date match); relax to allow name-only or reference-only matches
- [x] Fix: getCachedEmailCount loads all rows into memory — replace with COUNT(*) SQL query

## BI Dashboard Audit (June 2026)
- [ ] Audit every metric in weeklyStats query — check field used, date range logic, and timezone handling
- [ ] Fix new bookings count — verify bookedDate is populated and query is correct
- [ ] Fix sign-ups count — verify users.createdAt date range matches the selected week
- [ ] Fix any other metrics found to be wrong during audit
- [ ] Verify all fixed figures match raw SQL counts
