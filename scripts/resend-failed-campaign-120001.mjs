/**
 * One-off script: resend "We've listened..." campaign to the 73 failed recipients
 * from the resend attempt on 2026-05-18.
 * Rate-limited to 3 sends/sec to stay within Resend's 5 req/sec limit.
 */
import mysql from "mysql2/promise";
import { Resend } from "resend";

const DATABASE_URL = process.env.DATABASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const BASE_URL = "https://portal.thejltgroup.co.uk";
const CAMPAIGN_ID = 120001;
const AGENT_FROM = "JLT Group <support@mail.thejltgroup.co.uk>";
const AGENT_REPLY_TO = "support@thejltgroup.co.uk";

if (!DATABASE_URL || !RESEND_API_KEY) {
  console.error("Missing DATABASE_URL or RESEND_API_KEY");
  process.exit(1);
}

// Strip SSL JSON from URL and connect with ssl option
const urlWithoutSsl = DATABASE_URL.replace(/\?ssl=.*$/, "");
const pool = mysql.createPool({ uri: urlWithoutSsl, ssl: { rejectUnauthorized: false } });
const resend = new Resend(RESEND_API_KEY);

const SUBJECT = "We've listened...";
const BODY_HTML = `<p>Hi {{First Name}}</p><p></p><p>This is our formal follow-up to Tuesday's call (12th May) with everything you need to know.</p><p></p><p>We asked, you told us, and we listened. After carefully reviewing your feedback and taking a closer look at how we can make this work best for everyone, we've refined our approach and we think it's stronger for it.&nbsp;</p><p></p><p>Rather than applying a fixed minimum to every individual booking, we are now asking for an <strong>average commission margin of at least 6% (inclusive of VAT and fees) across your bookings over the course of each calendar month</strong>. This gives you genuine flexibility across your business - you can price individual bookings according to the situation, provided your overall monthly average meets the threshold.</p><p></p><p>We do want to be transparent about one thing though; bookings at 1–3% margins are unfortunately not commercially viable for either side once the time and resource involved in supporting them is taken into account. Whilst we are giving you the flexibility to drop below the 6% on individual bookings, we do ask that you keep these to a minimum.</p><p></p><p>Our goal is still to increase your average commission and earnings with enhanced training and resources.&nbsp;We want you to know your worth and charge for your time accordingly.</p><p></p><p>As a result of this change, we have updated the Membership Agreement. <strong>You'll find the new version on your dashboard ready for signing </strong>it and reflects the revised margin structure.</p><p></p><p>The new agreement takes effect from <strong>13th June 2026</strong>. Please read and sign it ahead of this date.</p><p></p><p>We've included the link for Tuesday's call, as well as Rachel Earl's coveted webinar around pricing holidays below:</p><div data-button-block="true" style="text-align: center; margin: 16px 0px;"><a href="#" style="display: inline-block; padding: 12px 28px; background: rgb(2, 230, 210); color: rgb(65, 65, 65); font-weight: 600; border-radius: 6px; text-decoration: none; font-family: Poppins, Arial, sans-serif;"><a target="_blank" rel="noopener noreferrer nofollow" class="text-blue-600 underline" href="https://www.loom.com/share/b25296b225094521bed88ef01679ca58"><strong>Compulsory Call Replay</strong></a></a></div><div data-button-block="true" style="text-align: center; margin: 16px 0px;"><a href="#" style="display: inline-block; padding: 12px 28px; background: rgb(2, 230, 210); color: rgb(65, 65, 65); font-weight: 600; border-radius: 6px; text-decoration: none; font-family: Poppins, Arial, sans-serif;"><a target="_blank" rel="noopener noreferrer nofollow" class="text-blue-600 underline" href="https://www.loom.com/share/a36be7de58c94ed6aa3cf12e6e79b914"><strong>Rachel's Pricing Webinar - Must watch!!</strong></a></a></div><p></p><p>If you have any questions, we're always here at <a target="_blank" rel="noopener noreferrer nofollow" class="text-blue-600 underline" href="mailto:support@thejltgroup.co.uk">support@thejltgroup.co.uk</a>.</p><p></p><p>Kind regards</p><p>Janine, Max &amp; the JLT Crew</p>`;

function applyMergeTags(html, name) {
  const firstName = name ? name.split(" ")[0] : "there";
  return html.replace(/\{\{First Name\}\}/gi, firstName).replace(/\{\{first_name\}\}/gi, firstName);
}

function wrapInBrandedTemplate(bodyHtml) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#f5f5f5;font-family:Poppins,Arial,sans-serif;}
.wrapper{max-width:600px;margin:0 auto;background:#ffffff;}
.header{background:#1a1a2e;padding:24px 32px;text-align:center;}
.header img{height:40px;}
.body{padding:32px;color:#333333;font-size:15px;line-height:1.6;}
.footer{background:#f0f0f0;padding:16px 32px;font-size:12px;color:#888888;text-align:center;}
a{color:#02e6d2;}
</style></head>
<body><div class="wrapper">
<div class="header"><span style="color:#ffffff;font-size:20px;font-weight:700;">JLT Group</span></div>
<div class="body">${bodyHtml}</div>
<div class="footer">JLT Group &bull; <a href="${BASE_URL}/unsubscribe">Unsubscribe</a></div>
</div></body></html>`;
}

async function main() {
  // Get all failed send records for this campaign from today
  const [rows] = await pool.execute(
    `SELECT id, recipientEmail, recipientName, recipientId FROM email_sends
     WHERE campaignId = ? AND DATE(createdAt) = '2026-05-18' AND status = 'failed'
     ORDER BY id`,
    [CAMPAIGN_ID]
  );

  console.log(`Found ${rows.length} failed recipients to resend to.`);

  let sent = 0;
  let failed = 0;
  const BATCH_SIZE = 3;
  const BATCH_DELAY_MS = 1200;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const personalisedBody = applyMergeTags(BODY_HTML, r.recipientName);
    const html = wrapInBrandedTemplate(personalisedBody);

    try {
      const result = await resend.emails.send({
        from: AGENT_FROM,
        replyTo: AGENT_REPLY_TO,
        to: r.recipientEmail,
        subject: SUBJECT,
        html,
      });

      if (result.error) {
        console.error(`  FAILED ${r.recipientEmail}: ${result.error.message}`);
        await pool.execute(
          `UPDATE email_sends SET status='failed', failedReason=? WHERE id=?`,
          [result.error.message, r.id]
        );
        failed++;
      } else {
        await pool.execute(
          `UPDATE email_sends SET status='sent', resendMessageId=?, sentAt=NOW(), failedReason=NULL WHERE id=?`,
          [result.data?.id ?? null, r.id]
        );
        console.log(`  [${i+1}/${rows.length}] Sent → ${r.recipientEmail}`);
        sent++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  EXCEPTION ${r.recipientEmail}: ${msg}`);
      await pool.execute(
        `UPDATE email_sends SET status='failed', failedReason=? WHERE id=?`,
        [msg, r.id]
      );
      failed++;
    }

    // Rate limit: pause after every BATCH_SIZE sends
    if ((i + 1) % BATCH_SIZE === 0 && i + 1 < rows.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
