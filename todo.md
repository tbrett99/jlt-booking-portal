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
