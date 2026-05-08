/**
 * One-time seed script: inserts all default recruitment workflow emails.
 * Run with: node server/seed-workflows.mjs
 */
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const conn = await mysql.createConnection(DB_URL);

const CAL_LINK = "https://cal.com/jlt-group/jlt-discovery";
const PORTAL_URL = "https://portal.thejltgroup.co.uk";

const STAGES = [
  {
    stage: "new_enquiry",
    name: "New Enquiry",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "Your JLT Group Prospectus is Ready!",
        bodyHtml: `<p>Hi {{firstName}},</p><p>Thank you for your interest in joining the JLT Group travel agency network!</p><p>We have attached your prospectus — please take a look and, when you are ready, complete your application using the link below.</p><p style="text-align:center;margin:24px 0;"><a href="{{applicationLink}}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Complete Your Application</a></p><p>If you have any questions, just reply to this email — we would love to hear from you.</p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "application_received",
    name: "Application Received",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "Application Received — JLT Group",
        bodyHtml: `<p>Hi {{firstName}},</p><p>Thank you for completing your application to join the JLT Group team! We have received your answers and our team will be in touch shortly.</p><p>We review all applications personally, so please allow a few business days for us to get back to you.</p><p>In the meantime, if you have any questions, feel free to reply to this email.</p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "ar_approved",
    name: "AR Approved",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "Great News — Your Application Has Been Approved!",
        bodyHtml: `<p>Hi {{firstName}},</p><p>We have reviewed your application and we are delighted to let you know that you have been approved to move forward in our recruitment process!</p><p>The next step is a short discovery call with our team. Please use the link below to book a time that works for you:</p><p style="text-align:center;margin:24px 0;"><a href="${CAL_LINK}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Book Your Discovery Call</a></p><p>We look forward to speaking with you soon!</p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
      {
        stepOrder: 2,
        delayHours: 48,
        subject: "Reminder: Book Your Discovery Call — JLT Group",
        bodyHtml: `<p>Hi {{firstName}},</p><p>Just a friendly reminder that you have been approved to join the JLT Group team and we are waiting to hear from you!</p><p>Please book your discovery call at a time that suits you:</p><p style="text-align:center;margin:24px 0;"><a href="${CAL_LINK}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Book Your Discovery Call</a></p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "ar_declined",
    name: "AR Declined",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "Update on Your JLT Group Application",
        bodyHtml: `<p>Hi {{firstName}},</p><p>Thank you for taking the time to apply to join the JLT Group team. We have carefully reviewed your application and, unfortunately, we will not be moving forward at this time.</p><p>We appreciate your interest and wish you all the best in your future endeavours.</p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "discovery_call_booked",
    name: "Call Booked",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "Your Discovery Call is Confirmed — JLT Group",
        bodyHtml: `<p>Hi {{firstName}},</p><p>Great news — your discovery call with the JLT Group team is confirmed!</p><p>We look forward to speaking with you. If you need to reschedule, please use the link in your calendar invitation.</p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "rebook_required",
    name: "Rebook Required",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "No problem — let us find a better time | JLT Group",
        bodyHtml: `<p>Hi {{firstName}},</p><p>We noticed you cancelled your discovery call — that is completely fine, life gets busy!</p><p>If you would still like to speak with us, please feel free to rebook at a time that suits you:</p><p style="text-align:center;margin:24px 0;"><a href="${CAL_LINK}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Book a New Time</a></p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
      {
        stepOrder: 2,
        delayHours: 72,
        subject: "Still interested? Book your call — JLT Group",
        bodyHtml: `<p>Hi {{firstName}},</p><p>We wanted to check in — we would still love to have a chat with you about joining the JLT Group team.</p><p>If the timing works for you, please book a call at your convenience:</p><p style="text-align:center;margin:24px 0;"><a href="${CAL_LINK}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Book a Call</a></p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "did_not_turn_up",
    name: "Did Not Turn Up",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "We Missed You — JLT Group Discovery Call",
        bodyHtml: `<p>Hi {{firstName}},</p><p>We noticed you were not able to make it to your discovery call today. No worries — these things happen!</p><p>If you would still like to speak with us, please feel free to rebook at a time that suits you:</p><p style="text-align:center;margin:24px 0;"><a href="${CAL_LINK}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Rebook Your Discovery Call</a></p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "discovery_call_complete",
    name: "Call Complete",
    emails: [],
  },
  {
    stage: "onboarding_approved",
    name: "Onboarding Approved",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "Welcome to the JLT Group Family!",
        bodyHtml: `<p>Hi {{firstName}},</p><p>We are absolutely thrilled to welcome you to the JLT Group team!</p><p>Your onboarding has been approved and we will be in touch very shortly with everything you need to get started.</p><p>We cannot wait to have you on board!</p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "onboarding_declined",
    name: "Onboarding Declined",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "Update on Your JLT Group Onboarding",
        bodyHtml: `<p>Hi {{firstName}},</p><p>Thank you for your time and enthusiasm throughout the recruitment process. After careful consideration, we will not be moving forward with your onboarding at this time.</p><p>We appreciate your interest in the JLT Group and wish you all the best.</p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "waitlisted",
    name: "Waitlisted",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "You are on Our Waitlist — JLT Group",
        bodyHtml: `<p>Hi {{firstName}},</p><p>Thank you for your interest in joining the JLT Group. While we are not able to move forward right now, we would love to keep in touch and reach out when a suitable opportunity arises.</p><p>We have added you to our waitlist and will be in touch as soon as something opens up.</p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
      {
        stepOrder: 2,
        delayHours: 720,
        subject: "Checking in — JLT Group",
        bodyHtml: `<p>Hi {{firstName}},</p><p>We just wanted to check in and let you know we still have you on our waitlist. We will be in touch as soon as a suitable opportunity opens up.</p><p>In the meantime, if anything has changed or you have any questions, please do not hesitate to reach out.</p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "won",
    name: "Won",
    emails: [
      {
        stepOrder: 1,
        delayHours: 0,
        subject: "You are officially part of the JLT Group!",
        bodyHtml: `<p>Hi {{firstName}},</p><p>Welcome to the JLT Group family! Your account is now active and you can log in to the portal to get started.</p><p style="text-align:center;margin:24px 0;"><a href="${PORTAL_URL}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Access Your Portal</a></p><p>If you have any questions, do not hesitate to reach out to us.</p><p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
      },
    ],
  },
  {
    stage: "archived",
    name: "Archived",
    emails: [],
  },
];

console.log("Seeding recruitment workflow emails...");

for (const { stage, name, emails } of STAGES) {
  const [existing] = await conn.execute("SELECT id FROM recruitment_workflows WHERE stage = ?", [stage]);
  let workflowId;
  if (existing.length > 0) {
    workflowId = existing[0].id;
    console.log(`  Workflow exists: ${stage} (id=${workflowId})`);
  } else {
    const [result] = await conn.execute(
      "INSERT INTO recruitment_workflows (stage, name, isActive) VALUES (?, ?, 1)",
      [stage, name]
    );
    workflowId = result.insertId;
    console.log(`  Created workflow: ${stage} (id=${workflowId})`);
  }

  // Clear existing emails for this workflow
  await conn.execute("DELETE FROM recruitment_workflow_emails WHERE workflowId = ?", [workflowId]);

  for (const email of emails) {
    await conn.execute(
      "INSERT INTO recruitment_workflow_emails (workflowId, stepOrder, delayHours, subject, bodyHtml) VALUES (?, ?, ?, ?, ?)",
      [workflowId, email.stepOrder, email.delayHours, email.subject, email.bodyHtml]
    );
    console.log(`    + Step ${email.stepOrder}: ${email.subject}`);
  }
}

await conn.end();
console.log("Done!");
