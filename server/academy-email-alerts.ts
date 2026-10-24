import { and, eq, isNull, or } from "drizzle-orm";
import {
  academyEmailAlertDeliveries,
  academyEmailAlerts,
} from "../drizzle/schema";
import { getDb } from "./db";
import { sendDirectEmail, sendSupportEmail } from "./email";

export const ACADEMY_ALERT_EVENTS = [
  "week_released",
  "module_started",
  "module_completed",
  "action_submitted_for_review",
  "action_overdue",
  "course_completed",
  "written_assessment_ready",
  "three_attempt_lock",
] as const;

export type AcademyAlertEvent = (typeof ACADEMY_ALERT_EVENTS)[number];

type AlertContext = {
  eventType: AcademyAlertEvent;
  eventKey: string;
  enrollmentId: number;
  courseId: number;
  courseTitle: string;
  moduleId?: number | null;
  moduleTitle?: string | null;
  agentId: number;
  agentName: string | null;
  agentEmail: string | null;
  actionTitle?: string | null;
  dueDate?: Date | null;
};

const PORTAL_URL = "https://portal.thejltgroup.co.uk";

function escapeHtml(value: string | null | undefined) {
  return (value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function eventLabel(eventType: AcademyAlertEvent) {
  return ({
    week_released: "course week released",
    module_started: "module started",
    module_completed: "module completed",
    action_submitted_for_review: "action submitted for review",
    action_overdue: "action overdue",
    course_completed: "course completed",
    written_assessment_ready: "written assessment ready to mark",
    three_attempt_lock: "three-attempt support lock",
  } satisfies Record<AcademyAlertEvent, string>)[eventType];
}

function renderTemplate(template: string, context: AlertContext) {
  const courseUrl = `${PORTAL_URL}/academy/course/${context.enrollmentId}`;
  const values: Record<string, string> = {
    agent_name: escapeHtml(context.agentName || "Agent"),
    agent_email: escapeHtml(context.agentEmail || "No email recorded"),
    course_title: escapeHtml(context.courseTitle),
    module_title: escapeHtml(context.moduleTitle || "Course-wide"),
    event_label: escapeHtml(eventLabel(context.eventType)),
    action_title: escapeHtml(context.actionTitle || "—"),
    due_date: context.dueDate
      ? escapeHtml(context.dueDate.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }))
      : "—",
    portal_url: PORTAL_URL,
    course_url: courseUrl,
  };
  return template.replace(/\{\{([a-z_]+)\}\}/g, (match, key: string) => values[key] ?? match);
}

function isDuplicateDeliveryError(error: any) {
  return error?.code === "ER_DUP_ENTRY" || error?.cause?.code === "ER_DUP_ENTRY";
}

/**
 * Sends every active course/module alert exactly once for a particular Academy
 * event. A durable reservation is made before delivery; failed deliveries are
 * released for a later retry without changing learning or Action records.
 */
export async function dispatchAcademyEmailAlerts(context: AlertContext) {
  const db = await getDb();
  if (!db) return { sent: 0, skipped: 0, failed: 0 };
  const scope = context.moduleId
    ? or(eq(academyEmailAlerts.moduleId, context.moduleId), isNull(academyEmailAlerts.moduleId))
    : isNull(academyEmailAlerts.moduleId);
  const rules = await db.select().from(academyEmailAlerts).where(and(
    eq(academyEmailAlerts.courseId, context.courseId),
    eq(academyEmailAlerts.eventType, context.eventType),
    eq(academyEmailAlerts.isActive, true),
    scope,
  ));

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const rule of rules) {
    const recipientEmail = rule.recipientType === "support" ? "support@thejltgroup.co.uk" : rule.recipientEmail?.trim().toLowerCase();
    if (!recipientEmail) { skipped++; continue; }

    try {
      await db.insert(academyEmailAlertDeliveries).values({
        alertId: rule.id,
        enrollmentId: context.enrollmentId,
        moduleId: context.moduleId ?? null,
        eventKey: context.eventKey,
        recipientEmail,
      } as any);
    } catch (error) {
      if (isDuplicateDeliveryError(error)) { skipped++; continue; }
      throw error;
    }

    const subject = renderTemplate(rule.subjectTemplate, context);
    const html = renderTemplate(rule.bodyHtmlTemplate, context);
    const result = rule.recipientType === "support"
      ? await sendSupportEmail({ subject, html })
      : await sendDirectEmail({
        toEmail: recipientEmail,
        toName: rule.recipientName?.trim() || "JLT Academy",
        subject,
        html,
        triggerKey: `academy_custom_alert_${rule.id}`,
      });
    if (result.success) {
      sent++;
      continue;
    }

    failed++;
    await db.delete(academyEmailAlertDeliveries).where(and(
      eq(academyEmailAlertDeliveries.alertId, rule.id),
      eq(academyEmailAlertDeliveries.enrollmentId, context.enrollmentId),
      eq(academyEmailAlertDeliveries.eventKey, context.eventKey),
    ));
  }
  return { sent, skipped, failed };
}

export function academyAlertTemplateHint() {
  return "Use {{agent_name}}, {{agent_email}}, {{course_title}}, {{module_title}}, {{event_label}}, {{action_title}}, {{due_date}}, {{course_url}} or {{portal_url}}.";
}
