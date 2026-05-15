/**
 * One-off script: resend campaign 120001 ("We've listened...") to all agents
 * who were not in the original 7 sends.
 *
 * Run with: node scripts/resend-campaign-120001.mjs
 */
import { createConnection } from "mysql2/promise";
import { Resend } from "resend";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const CAMPAIGN_ID = 120001;
const ALREADY_SENT = [
  "testagent@thejltgroup.co.uk",
  "megannorton2000@gmail.com",
  "peter@cruisefamily.co.uk",
  "raegan.kither@gmail.com",
  "struansmith7@gmail.com",
  "mr.r.e.hillerby@icloud.com",
  "ejtravels123@gmail.com",
];

const SUBJECT = "We've listened...";
const FROM = "JLT Group <support@mail.thejltgroup.co.uk>";
const REPLY_TO = "support@thejltgroup.co.uk";

// Campaign body HTML — strip the broken nested anchor tags from buttons
const BODY_HTML = `<p>Hi {{First Name}}</p><p></p><p>This is our formal follow-up to Tuesday's call (12th May) with everything you need to know.</p><p></p><p>We asked, you told us, and we listened. After carefully reviewing your feedback and taking a closer look at how we can make this work best for everyone, we've refined our approach and we think it's stronger for it.&nbsp;</p><p></p><p>Rather than applying a fixed minimum to every individual booking, we are now asking for an <strong>average commission margin of at least 6% across your bookings over the course of each calendar month</strong>. This gives you genuine flexibility across your business - you can price individual bookings according to the situation, provided your overall monthly average meets the threshold.</p><p></p><p>We do want to be transparent about one thing though; bookings at 1–3% margins are unfortunately not commercially viable for either side once the time and resource involved in supporting them is taken into account. Whilst we are giving you the flexibility to drop below the 6% on individual bookings, we do ask that you keep these to a minimum.</p><p></p><p>Our goal is still to increase your average commission and earnings with enhanced training and resources.&nbsp;We want you to know your worth and charge for your time accordingly.</p><p></p><p>As a result of this change, we have updated the Membership Agreement. <strong>You'll find the new version on your dashboard ready for signing</strong> and it reflects the revised margin structure.</p><p></p><p>The new agreement takes effect from <strong>13th June 2026</strong>. Please read and sign it ahead of this date.</p><p></p><p>We've included the link for Tuesday's call, as well as Rachel Earl's coveted webinar around pricing holidays below:</p><p style="text-align:center;margin:16px 0"><a href="https://www.loom.com/share/b25296b225094521bed88ef01679ca58" style="display:inline-block;padding:12px 28px;background:#02e6d2;color:#414141;font-weight:600;border-radius:6px;text-decoration:none;font-family:Poppins,Arial,sans-serif;">Compulsory Call Replay</a></p><p style="text-align:center;margin:16px 0"><a href="https://www.loom.com/share/a36be7de58c94ed6aa3cf12e6e79b914" style="display:inline-block;padding:12px 28px;background:#02e6d2;color:#414141;font-weight:600;border-radius:6px;text-decoration:none;font-family:Poppins,Arial,sans-serif;">Rachel's Pricing Webinar - Must watch!!</a></p><p></p><p>If you have any questions, we're always here at <a href="mailto:support@thejltgroup.co.uk">support@thejltgroup.co.uk</a>.</p><p></p><p>Kind regards</p><p>Janine, Max &amp; the JLT Crew</p>`;

async function main() {
  const db = await createConnection(process.env.DATABASE_URL);
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Get all active agents not already sent to
  const [agents] = await db.query(
    `SELECT u.id, u.email, u.name FROM users u
     WHERE u.role = 'agent' AND u.isActive = 1 AND u.email IS NOT NULL`
  );

  const toSend = agents.filter(
    (a) => !ALREADY_SENT.includes(a.email.toLowerCase())
  );

  console.log(`Total active agents: ${agents.length}`);
  console.log(`Already sent: ${ALREADY_SENT.length}`);
  console.log(`To send: ${toSend.length}`);

  let sent = 0;
  let failed = 0;

  for (const agent of toSend) {
    const firstName = agent.name ? agent.name.split(" ")[0] : "there";
    const personalised = BODY_HTML.replace("{{First Name}}", firstName);

    try {
      const result = await resend.emails.send({
        from: FROM,
        replyTo: REPLY_TO,
        to: agent.email,
        subject: SUBJECT,
        html: personalised,
      });

      if (result.error) {
        console.error(`FAILED ${agent.email}: ${result.error.message}`);
        failed++;
      } else {
        // Record in email_sends
        await db.query(
          `INSERT INTO email_sends (campaignId, recipientEmail, recipientName, recipientType, recipientId, subject, resendMessageId, status, sentAt, createdAt)
           VALUES (?, ?, ?, 'agent', ?, ?, ?, 'sent', NOW(), NOW())`,
          [CAMPAIGN_ID, agent.email, agent.name ?? null, agent.id, SUBJECT, result.data?.id ?? null]
        );
        sent++;
        if (sent % 10 === 0) console.log(`Sent ${sent}/${toSend.length}...`);
      }
    } catch (err) {
      console.error(`ERROR ${agent.email}:`, err.message);
      failed++;
    }

    // 100ms delay to respect Resend rate limits
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
  await db.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
