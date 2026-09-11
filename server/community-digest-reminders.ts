import type { Request, Response } from "express";
import { getSystemSetting, setSystemSetting } from "./db";
import { sendDirectEmail } from "./email";
import { sdk } from "./_core/sdk";

const SUPPORT_EMAIL = "support@thejltgroup.co.uk";
const DIGEST_URL = "https://portal.thejltgroup.co.uk/admin/weekly-digest";

function londonCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: value("weekday"),
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
  };
}

function previousMondayToSunday(now: Date) {
  const start = new Date(now);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday - 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} – ${end.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
}

async function sendReminder({ kind, label, key }: { kind: "weekly" | "monthly"; label: string; key: string }) {
  if (await getSystemSetting(key)) return false;

  const title = kind === "weekly" ? "Weekly Update" : "Monthly Review";
  const result = await sendDirectEmail({
    toEmail: SUPPORT_EMAIL,
    toName: "JLT Support",
    subject: `Reminder: prepare the JLT ${title}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#252525;">
        <h2 style="margin:0 0 12px;">Prepare the JLT ${title}</h2>
        <p style="line-height:1.6;">Your manual ${title.toLowerCase()} is ready to prepare for <strong>${label}</strong>.</p>
        <p style="line-height:1.6;">Review the business and Community updates, add any personal introduction, then send a test before distributing it to active agents.</p>
        <p style="margin:24px 0;"><a href="${DIGEST_URL}" style="display:inline-block;background:#414141;color:#70FFE8;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:700;">Open Agent Digests</a></p>
      </div>`,
  });

  if (!result.success) throw new Error(result.error ?? `Failed to send ${kind} digest reminder`);
  await setSystemSetting(key, new Date().toISOString());
  return true;
}

/**
 * Project-level Heartbeat entry point. The cron calls this every Tuesday at 09:00 UTC.
 * Weekly reminders are issued every Tuesday; the monthly reminder is also sent on the
 * first Tuesday of a new month, leaving both agent communications manually controlled.
 */
export async function communityDigestReminderHandler(req: Request, res: Response) {
  let user;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    return res.status(403).json({ error: "Cron-only endpoint" });
  }
  if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "Cron-only endpoint" });

  try {
    const now = new Date();
    const london = londonCalendarDate(now);
    if (london.weekday !== "Tue") return res.json({ ok: true, skipped: "Not Tuesday" });

    const weeklySent = await sendReminder({
      kind: "weekly",
      label: previousMondayToSunday(now),
      key: `community_digest_reminder_weekly_${london.year}-${String(london.month).padStart(2, "0")}-${String(london.day).padStart(2, "0")}`,
    });
    const monthlySent = london.day <= 7
      ? await sendReminder({
          kind: "monthly",
          label: new Date(london.year, london.month - 2, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
          key: `community_digest_reminder_monthly_${london.year}-${String(london.month).padStart(2, "0")}`,
        })
      : false;

    return res.json({ ok: true, weeklySent, monthlySent });
  } catch (error: any) {
    console.error("[CommunityDigestReminder] Error:", error?.message);
    return res.status(500).json({ ok: false, error: error?.message ?? "Unknown error" });
  }
}
