import type { Request, Response } from "express";
import { and, eq, gte, lt, ne } from "drizzle-orm";
import { bookings, commissionReadinessReminders, users } from "../drizzle/schema";
import { createInAppNotification, getDb, getSystemSetting } from "./db";
import { sendDirectEmail } from "./email";
import { sdk } from "./_core/sdk";
import { commissionReadinessTargetWindow } from "./commission-readiness-utils";

const PORTAL_URL = "https://portal.thejltgroup.co.uk";
const REMINDER_SCHEDULE_KEY = "commission_readiness_reminder_schedule_task_uid";

function isDuplicateReminderError(error: any) {
  return error?.code === "ER_DUP_ENTRY" || error?.cause?.code === "ER_DUP_ENTRY";
}

function formatDepartureDate(value: Date) {
  return value.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function buildReminderHtml(input: { agentName: string; clientName: string; departureDate: Date; bookingId: number }) {
  const bookingUrl = `${PORTAL_URL}/bookings/${input.bookingId}`;
  return `
    <p>Hi ${input.agentName.split(" ")[0] || input.agentName},</p>
    <p>Your client <strong>${input.clientName}</strong> is due to travel on <strong>${formatDepartureDate(input.departureDate)}</strong>. Their commission will be due soon.</p>
    <p>Please be proactive now and speak with your client about any final extras they may need, including seats, baggage, airport parking, transfers or other additions. Make sure everything is organised before you claim commission.</p>
    <p><strong>Important:</strong> amendments made after commission has been claimed will be subject to additional PTS and JLT amendment fees.</p>
    <p style="margin:24px 0;"><a href="${bookingUrl}" style="display:inline-block;background:#414141;color:#70FFE8;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:700;">Review this booking</a></p>
    <p>Thank you for keeping your client’s trip fully prepared.</p>`;
}

/** Daily project-level Heartbeat endpoint. Each booking/departure pair can reserve only one email. */
export async function commissionReadinessReminderHandler(req: Request, res: Response) {
  let cronUser;
  try {
    cronUser = await sdk.authenticateRequest(req);
  } catch {
    return res.status(403).json({ error: "Cron-only endpoint" });
  }
  if (!cronUser.isCron || !cronUser.taskUid) return res.status(403).json({ error: "Cron-only endpoint" });

  try {
    const expectedTaskUid = await getSystemSetting(REMINDER_SCHEDULE_KEY);
    if (!expectedTaskUid || expectedTaskUid !== cronUser.taskUid) {
      return res.json({ ok: true, skipped: "orphan_or_unrecognised_schedule" });
    }

    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const { start, end } = commissionReadinessTargetWindow(new Date());
    const candidates = await db
      .select({
        bookingId: bookings.id,
        agentId: bookings.agentId,
        clientName: bookings.clientName,
        departureDate: bookings.departureDate,
        currentStage: bookings.currentStage,
        isPersonalBooking: bookings.isPersonalBooking,
        agentName: users.name,
        agentEmail: users.email,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.agentId))
      .where(and(
        gte(bookings.departureDate, start),
        lt(bookings.departureDate, end),
        ne(bookings.currentStage, "Cancelled"),
        eq(bookings.isPersonalBooking, false),
        eq(users.isActive, true),
      ));

    let sent = 0;
    let skipped = 0;
    const failures: Array<{ bookingId: number; error: string }> = [];
    for (const booking of candidates) {
      if (!booking.agentEmail) { skipped++; continue; }
      try {
        await db.insert(commissionReadinessReminders).values({
          bookingId: booking.bookingId,
          agentId: booking.agentId,
          departureDate: booking.departureDate,
        });
      } catch (error: any) {
        if (isDuplicateReminderError(error)) { skipped++; continue; }
        throw error;
      }

      const email = await sendDirectEmail({
        toEmail: booking.agentEmail,
        toName: booking.agentName ?? "JLT Agent",
        subject: "Commission due soon — complete your client’s final travel checks",
        html: buildReminderHtml({
          agentName: booking.agentName ?? "JLT Agent",
          clientName: booking.clientName,
          departureDate: booking.departureDate,
          bookingId: booking.bookingId,
        }),
        bookingId: booking.bookingId,
        userId: booking.agentId,
        triggerKey: "commission_readiness_12_weeks",
      });

      if (!email.success) {
        await db.delete(commissionReadinessReminders).where(and(
          eq(commissionReadinessReminders.bookingId, booking.bookingId),
          eq(commissionReadinessReminders.departureDate, booking.departureDate),
        ));
        failures.push({ bookingId: booking.bookingId, error: email.error ?? "Email delivery failed" });
        continue;
      }

      await createInAppNotification({
        userId: booking.agentId,
        bookingId: booking.bookingId,
        message: `Commission will be due soon for ${booking.clientName}. Please complete all client travel checks before claiming.`,
        linkUrl: `/bookings/${booking.bookingId}`,
      });
      sent++;
    }

    if (failures.length > 0) {
      return res.status(500).json({ ok: false, sent, skipped, failures });
    }
    return res.json({ ok: true, targetDate: start.toISOString().slice(0, 10), sent, skipped });
  } catch (error: any) {
    console.error("[CommissionReadinessReminder] Error:", error?.message);
    return res.status(500).json({ ok: false, error: error?.message ?? "Unknown error", timestamp: new Date().toISOString() });
  }
}
