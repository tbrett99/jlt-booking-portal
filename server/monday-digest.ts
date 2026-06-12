/**
 * Monday Morning Business Digest
 * Triggered by a Heartbeat cron every Monday at 08:00 UTC.
 * Queries the previous week's stats and emails a formatted HTML digest
 * to support@thejltgroup.co.uk.
 */
import type { Request, Response } from "express";
import { getDb } from "./db";
import { sendDirectEmail } from "./email";
import {
  agentCrmProfiles, agentStatusEvents, gcPaymentEvents, gcMandates,
  bookings, pipelineHistory, amendments, refunds, flightRequests,
  commissionClaims, reimbursementItems, remittanceBatches, remittanceLines,
  recruitmentProspects, recruitmentStageHistory,
} from "../drizzle/schema";
import {
  and, eq, gte, lt, ne, isNotNull, sql,
} from "drizzle-orm";

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtGbp(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-GB");
}

function pctChange(current: number, prev: number): string {
  if (prev === 0) return "";
  const pct = Math.round(((current - prev) / prev) * 100);
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "→";
  const color = pct > 0 ? "#16a34a" : pct < 0 ? "#dc2626" : "#6b7280";
  return ` <span style="color:${color};font-size:12px;">${arrow} ${Math.abs(pct)}% WoW</span>`;
}

function row(label: string, value: string, wow = "", highlight = false): string {
  const bg = highlight ? "background:#f0fdf4;" : "";
  return `<tr style="${bg}">
    <td style="padding:6px 12px;color:#374151;font-size:14px;">${label}</td>
    <td style="padding:6px 12px;font-weight:600;font-size:14px;text-align:right;">${value}${wow}</td>
  </tr>`;
}

function section(title: string, rows: string): string {
  return `
  <div style="margin:24px 0;">
    <h3 style="margin:0 0 8px;padding:8px 12px;background:#1a1a2e;color:#70FFE8;font-size:14px;font-weight:700;border-radius:6px 6px 0 0;letter-spacing:0.05em;text-transform:uppercase;">${title}</h3>
    <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:0 0 6px 6px;overflow:hidden;">
      ${rows}
    </table>
  </div>`;
}

function n(v: number | null | undefined): number {
  return Number(v ?? 0);
}

export async function mondayDigestHandler(req: Request, res: Response) {
  try {
    // Authenticate — allow both Heartbeat cron and the EXPORT_TRIGGER_TOKEN for manual testing
    const authHeader = req.headers.authorization ?? "";
    const exportToken = process.env.EXPORT_TRIGGER_TOKEN ?? "";
    const isBearerAuth = exportToken && authHeader === `Bearer ${exportToken}`;
    const isCronHeader = req.headers["x-manus-cron-task-uid"];
    if (!isBearerAuth && !isCronHeader) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const db = await getDb();
    if (!db) return res.status(500).json({ error: "DB unavailable" });

    // Determine the week to report on: the most recently completed Mon–Sun
    const now = new Date();
    const thisMonday = getMondayOfWeek(now);
    // If today is Monday, report on last week; otherwise report on the current week-to-date
    const reportMonday = now.getDay() === 1 ? new Date(thisMonday.getTime() - 7 * 86400000) : new Date(thisMonday.getTime() - 7 * 86400000);
    const reportSunday = new Date(reportMonday.getTime() + 7 * 86400000);
    const prevMonday = new Date(reportMonday.getTime() - 7 * 86400000);
    const prevSunday = new Date(reportMonday.getTime());

    const weekLabel = `${reportMonday.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(reportSunday.getTime() - 1).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

    // ── Membership ──
    const [totalActive, newSignups, newSignupsPrev, cancellations, cancellationsPrev, inNotice, paused] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)` }).from(agentCrmProfiles).where(eq(agentCrmProfiles.agentStatus, "active")),
      db.select({ count: sql<number>`COUNT(*)` }).from(agentStatusEvents).where(and(eq(agentStatusEvents.toStatus, "active"), gte(agentStatusEvents.createdAt, reportMonday), lt(agentStatusEvents.createdAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(agentStatusEvents).where(and(eq(agentStatusEvents.toStatus, "active"), gte(agentStatusEvents.createdAt, prevMonday), lt(agentStatusEvents.createdAt, prevSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(agentStatusEvents).where(and(eq(agentStatusEvents.toStatus, "in_notice"), gte(agentStatusEvents.createdAt, reportMonday), lt(agentStatusEvents.createdAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(agentStatusEvents).where(and(eq(agentStatusEvents.toStatus, "in_notice"), gte(agentStatusEvents.createdAt, prevMonday), lt(agentStatusEvents.createdAt, prevSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(agentCrmProfiles).where(eq(agentCrmProfiles.agentStatus, "in_notice")),
      db.select({ count: sql<number>`COUNT(*)` }).from(agentCrmProfiles).where(eq(agentCrmProfiles.agentStatus, "paused")),
    ]);
    const netGrowth = n(newSignups[0]?.count) - n(cancellations[0]?.count);

    // ── DD Revenue ──
    const [mrrRaw, confirmedThisWeek, confirmedPrevWeek, paidOutThisWeek, failedThisWeek] = await Promise.all([
      db.select({ totalPence: sql<number>`SUM(amount)` }).from(gcMandates).innerJoin(agentCrmProfiles, eq(gcMandates.userId, agentCrmProfiles.userId)).where(and(eq(gcMandates.status, "active"), eq(agentCrmProfiles.agentStatus, "active"))),
      db.select({ count: sql<number>`COUNT(DISTINCT paymentId)`, totalPence: sql<number>`SUM(amount)` }).from(gcPaymentEvents).where(and(eq(gcPaymentEvents.eventType, "payments_confirmed"), gte(gcPaymentEvents.occurredAt, reportMonday), lt(gcPaymentEvents.occurredAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(DISTINCT paymentId)`, totalPence: sql<number>`SUM(amount)` }).from(gcPaymentEvents).where(and(eq(gcPaymentEvents.eventType, "payments_confirmed"), gte(gcPaymentEvents.occurredAt, prevMonday), lt(gcPaymentEvents.occurredAt, prevSunday))),
      db.select({ count: sql<number>`COUNT(DISTINCT paymentId)`, totalPence: sql<number>`SUM(amount)` }).from(gcPaymentEvents).where(and(eq(gcPaymentEvents.eventType, "payments_paid_out"), gte(gcPaymentEvents.occurredAt, reportMonday), lt(gcPaymentEvents.occurredAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(DISTINCT paymentId)`, totalPence: sql<number>`SUM(amount)` }).from(gcPaymentEvents).where(and(eq(gcPaymentEvents.eventType, "payments_failed"), gte(gcPaymentEvents.occurredAt, reportMonday), lt(gcPaymentEvents.occurredAt, reportSunday))),
    ]);

    // ── Bookings ──
    const [newBookings, newBookingsPrev, pipelineMoves, amendmentsNew, refundsNew, flightsPending] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)` }).from(bookings).where(and(gte(bookings.createdAt, reportMonday), lt(bookings.createdAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(bookings).where(and(gte(bookings.createdAt, prevMonday), lt(bookings.createdAt, prevSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(pipelineHistory).where(and(gte(pipelineHistory.movedAt, reportMonday), lt(pipelineHistory.movedAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(amendments).where(and(gte(amendments.createdAt, reportMonday), lt(amendments.createdAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(refunds).where(and(gte(refunds.createdAt, reportMonday), lt(refunds.createdAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(flightRequests).where(and(ne(flightRequests.status, "completed"), ne(flightRequests.status, "cancelled"))),
    ]);

    // ── Financials ──
    const [jltRevThisWeek, jltRevPrevWeek, agentPayouts, commClaimsNew, commClaimsPaid, reimbPaid, reimbPending] = await Promise.all([
      db.select({ total: sql<number>`SUM(jlt20)` }).from(remittanceLines).innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id)).where(and(gte(remittanceBatches.createdAt, reportMonday), lt(remittanceBatches.createdAt, reportSunday), isNotNull(remittanceLines.jlt20))),
      db.select({ total: sql<number>`SUM(jlt20)` }).from(remittanceLines).innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id)).where(and(gte(remittanceBatches.createdAt, prevMonday), lt(remittanceBatches.createdAt, prevSunday), isNotNull(remittanceLines.jlt20))),
      db.select({ total: sql<number>`SUM(remit80)` }).from(remittanceLines).innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id)).where(and(gte(remittanceBatches.createdAt, reportMonday), lt(remittanceBatches.createdAt, reportSunday), isNotNull(remittanceLines.remit80))),
      db.select({ count: sql<number>`COUNT(*)`, gross: sql<number>`SUM(grossAmount)` }).from(commissionClaims).where(and(gte(commissionClaims.createdAt, reportMonday), lt(commissionClaims.createdAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(*)`, gross: sql<number>`SUM(grossAmount)` }).from(commissionClaims).where(and(eq(commissionClaims.status, "paid"), isNotNull(commissionClaims.paidAt), gte(commissionClaims.paidAt, reportMonday), lt(commissionClaims.paidAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(*)`, total: sql<number>`SUM(amount)` }).from(reimbursementItems).where(and(eq(reimbursementItems.status, "paid"), isNotNull(reimbursementItems.paidAt), gte(reimbursementItems.paidAt, reportMonday), lt(reimbursementItems.paidAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(*)`, total: sql<number>`SUM(amount)` }).from(reimbursementItems).where(eq(reimbursementItems.status, "pending")),
    ]);

    // ── Recruitment ──
    const [newProspects, newProspectsPrev, wonThisWeek] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentProspects).where(and(gte(recruitmentProspects.createdAt, reportMonday), lt(recruitmentProspects.createdAt, reportSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentProspects).where(and(gte(recruitmentProspects.createdAt, prevMonday), lt(recruitmentProspects.createdAt, prevSunday))),
      db.select({ count: sql<number>`COUNT(*)` }).from(recruitmentStageHistory).where(and(eq(recruitmentStageHistory.toStage, "won"), gte(recruitmentStageHistory.changedAt, reportMonday), lt(recruitmentStageHistory.changedAt, reportSunday))),
    ]);

    // ── Build HTML ──
    const membershipRows = [
      row("Total Active Agents", fmtNum(n(totalActive[0]?.count)), "", true),
      row("New Sign-Ups", fmtNum(n(newSignups[0]?.count)), pctChange(n(newSignups[0]?.count), n(newSignupsPrev[0]?.count))),
      row("Cancellations / In Notice", fmtNum(n(cancellations[0]?.count)), pctChange(n(cancellations[0]?.count), n(cancellationsPrev[0]?.count))),
      row("Net Growth", `${netGrowth >= 0 ? "+" : ""}${fmtNum(netGrowth)}`, "", netGrowth > 0),
      row("Currently In Notice", fmtNum(n(inNotice[0]?.count))),
      row("Currently Paused", fmtNum(n(paused[0]?.count))),
    ].join("");

    const ddRows = [
      row("MRR (Active Subscriptions)", fmtGbp(Math.round(n(mrrRaw[0]?.totalPence) / 100)), "", true),
      row("Confirmed This Week", fmtGbp(Math.round(n(confirmedThisWeek[0]?.totalPence) / 100)), pctChange(n(confirmedThisWeek[0]?.totalPence), n(confirmedPrevWeek[0]?.totalPence))),
      row("Paid Out This Week", fmtGbp(Math.round(n(paidOutThisWeek[0]?.totalPence) / 100))),
      row("Failed Payments", fmtNum(n(failedThisWeek[0]?.count)), "", n(failedThisWeek[0]?.count) > 0),
    ].join("");

    const bookingsRows = [
      row("New Bookings", fmtNum(n(newBookings[0]?.count)), pctChange(n(newBookings[0]?.count), n(newBookingsPrev[0]?.count)), true),
      row("Pipeline Moves", fmtNum(n(pipelineMoves[0]?.count))),
      row("Amendments Raised", fmtNum(n(amendmentsNew[0]?.count))),
      row("Refunds Raised", fmtNum(n(refundsNew[0]?.count))),
      row("Flight Requests Pending", fmtNum(n(flightsPending[0]?.count)), "", n(flightsPending[0]?.count) > 0),
    ].join("");

    const financialsRows = [
      row("JLT Revenue (Remittance)", fmtGbp(n(jltRevThisWeek[0]?.total)), pctChange(n(jltRevThisWeek[0]?.total), n(jltRevPrevWeek[0]?.total)), true),
      row("Agent Payouts", fmtGbp(n(agentPayouts[0]?.total))),
      row("Commission Claims (New)", `${fmtNum(n(commClaimsNew[0]?.count))} (${fmtGbp(n(commClaimsNew[0]?.gross))} gross)`),
      row("Commissions Paid", `${fmtNum(n(commClaimsPaid[0]?.count))} (${fmtGbp(n(commClaimsPaid[0]?.gross))} paid)`),
      row("Reimbursements Paid", `${fmtNum(n(reimbPaid[0]?.count))} (${fmtGbp(n(reimbPaid[0]?.total))} total)`),
      row("Reimbursements Pending", `${fmtNum(n(reimbPending[0]?.count))} (${fmtGbp(n(reimbPending[0]?.total))} outstanding)`, "", n(reimbPending[0]?.count) > 0),
    ].join("");

    const recruitmentRows = [
      row("New Prospects", fmtNum(n(newProspects[0]?.count)), pctChange(n(newProspects[0]?.count), n(newProspectsPrev[0]?.count)), true),
      row("Won (Converted to Agents)", fmtNum(n(wonThisWeek[0]?.count))),
    ].join("");

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:24px;">
  <div style="max-width:640px;margin:0 auto;">
    <div style="background:#1a1a2e;color:#70FFE8;padding:20px 24px;border-radius:8px 8px 0 0;text-align:center;">
      <h1 style="margin:0;font-size:22px;font-weight:700;">JLT Group — Weekly Business Digest</h1>
      <p style="margin:6px 0 0;color:#a0f0e0;font-size:14px;">Week of ${weekLabel}</p>
    </div>
    <div style="background:#ffffff;padding:16px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
      <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">
        This digest was automatically generated on ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} at ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} UTC.
        <a href="${process.env.PORTAL_BASE_URL ?? "https://portal.thejltgroup.co.uk"}/super-admin" style="color:#1a8a78;text-decoration:none;">View full BI dashboard →</a>
      </p>
      ${section("👥 Membership & Retention", membershipRows)}
      ${section("💳 Direct Debit Revenue", ddRows)}
      ${section("📋 Bookings & Pipeline", bookingsRows)}
      ${section("💷 Financials", financialsRows)}
      ${section("🎯 Recruitment", recruitmentRows)}
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;text-align:center;">
        JLT Group Portal · Automated digest · <a href="${process.env.PORTAL_BASE_URL ?? "https://portal.thejltgroup.co.uk"}/super-admin" style="color:#1a8a78;">View Dashboard</a>
      </p>
    </div>
  </div>
</body>
</html>`;

    const result = await sendDirectEmail({
      toEmail: "max@thejltgroup.co.uk",
      toName: "Max",
      subject: `📊 JLT Weekly Digest — ${weekLabel}`,
      html,
    });

    if (!result.success) {
      console.error("[Monday Digest] Email failed:", result.error);
      return res.status(500).json({ ok: false, error: result.error });
    }

    console.log(`[Monday Digest] Sent for week ${weekLabel}`);
    return res.json({ ok: true, weekLabel });
  } catch (err: any) {
    console.error("[Monday Digest] Error:", err);
    return res.status(500).json({
      error: err?.message ?? "Unknown error",
      stack: err?.stack,
      context: { url: req.url },
      timestamp: new Date().toISOString(),
    });
  }
}
