/**
 * One-off script: send a test weekly digest email to a given address.
 * Usage: node scripts/send-test-digest.mjs
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import nodemailer from "nodemailer";

const TO_EMAIL = "max@loupr.com";
const TO_NAME  = "Max Kelly";
const ORIGIN   = "https://portal.thejltgroup.co.uk";

// ── DB ────────────────────────────────────────────────────────────────────────
const conn = await createConnection(process.env.DATABASE_URL);

// Stats: bookings this week
const [bookingRows] = await conn.execute(
  `SELECT COUNT(*) AS cnt FROM bookings WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
);
const bookingsThisWeek = bookingRows[0].cnt;

// Commission claimed this week
const [commRows] = await conn.execute(
  `SELECT COALESCE(SUM(grossAmount),0) AS total FROM commission_claims WHERE status='paid' AND paidAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
);
const commissionTotal = Number(commRows[0].total);

// Reimbursements paid this week (reimbursement_items marked as paid)
const [reimbRows] = await conn.execute(
  `SELECT COUNT(*) AS cnt FROM reimbursement_items WHERE status='paid' AND paidAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
);
const reimbursementsCount = reimbRows[0].cnt;

// Community posts this week (up to 12)
const [postRows] = await conn.execute(
  `SELECT id, title, authorName, bodyHtml, category FROM community_posts
   WHERE isDraft=0 AND isHidden=0 AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
   ORDER BY createdAt DESC LIMIT 12`
);

// Upcoming events (next 14 days)
const [eventRows] = await conn.execute(
  `SELECT id, title, startDate, eventCategory FROM calendar_events
   WHERE agentFacing=1 AND startDate >= NOW() AND startDate <= DATE_ADD(NOW(), INTERVAL 14 DAY)
   ORDER BY startDate ASC LIMIT 5`
);

// (conn.end() moved to after all queries)

// ── Helpers ───────────────────────────────────────────────────────────────────
const stripHtml = (html) => (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const excerpt   = (html, len = 160) => {
  const plain = stripHtml(html);
  return plain.length > len ? plain.slice(0, len).trimEnd() + "…" : plain;
};

const categoryLabel = {
  business_update:    "Business Updates",
  supplier_news_deals:"Supplier News & Deals",
  news_announcements: "News & Announcements",
  agent_win:          "Agent Wins",
  jlt_stay_story:     "JLT Stay & Story",
  events:             "Events",
  training_webinars:  "Training & Webinars",
  mindset:            "Mindset",
  first_class_lounge: "First Class Lounge",
};
const categoryEmoji = {
  business_update:    "📊",
  supplier_news_deals:"✈️",
  news_announcements: "📢",
  agent_win:          "🏆",
  jlt_stay_story:     "🌍",
  events:             "📅",
  training_webinars:  "🎓",
  mindset:            "💡",
  first_class_lounge: "💎",
};
const categoryColor = {
  business_update:    "#02E6D2",
  supplier_news_deals:"#70FFE8",
  news_announcements: "#FFC3BC",
  agent_win:          "#FFD700",
  jlt_stay_story:     "#70FFE8",
  events:             "#FFC3BC",
  training_webinars:  "#02E6D2",
  mindset:            "#FFF6ED",
  first_class_lounge: "#FFD700",
};

// ── Stats block ───────────────────────────────────────────────────────────────
const statsHtml = `
  <div style="margin-bottom:28px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #70FFE8;padding-bottom:6px;">
      <span style="font-size:18px;">📈</span>
      <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">This Week's Numbers</h3>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="width:33%;padding:0 6px 0 0;">
          <div style="background:linear-gradient(135deg,#70FFE8 0%,#02E6D2 100%);border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">${bookingsThisWeek}</div>
            <div style="font-size:11px;font-weight:600;color:#414141;margin-top:4px;font-family:'Poppins',sans-serif;">Bookings Registered</div>
          </div>
        </td>
        <td style="width:33%;padding:0 3px;">
          <div style="background:linear-gradient(135deg,#FFC3BC 0%,#ffada4 100%);border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">£${commissionTotal.toLocaleString("en-GB",{maximumFractionDigits:0})}</div>
            <div style="font-size:11px;font-weight:600;color:#414141;margin-top:4px;font-family:'Poppins',sans-serif;">Commission Claimed</div>
          </div>
        </td>
        <td style="width:33%;padding:0 0 0 6px;">
          <div style="background:linear-gradient(135deg,#FFF6ED 0%,#ffe8d0 100%);border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">${reimbursementsCount}</div>
            <div style="font-size:11px;font-weight:600;color:#414141;margin-top:4px;font-family:'Poppins',sans-serif;">Reimbursements</div>
          </div>
        </td>
      </tr>
    </table>
  </div>
`;

// Reopen connection for highlights queries (mysql2 single-use connection workaround)
const conn2 = await createConnection(process.env.DATABASE_URL);

// ── Agent highlights ─────────────────────────────────────────────────────────
const mondayThisWeek = new Date();
mondayThisWeek.setHours(0, 0, 0, 0);
mondayThisWeek.setDate(mondayThisWeek.getDate() - ((mondayThisWeek.getDay() + 6) % 7));

const [firstBookingRows] = await conn2.execute(
  `SELECT b.id AS bookingId, u.name AS agentName, b.agentId
   FROM bookings b
   JOIN users u ON u.id = b.agentId
   WHERE b.createdAt >= ? LIMIT 50`,
  [mondayThisWeek]
);
const highlightItems = [];
for (const b of firstBookingRows) {
  const [[{ cnt }]] = await conn2.execute(
    `SELECT COUNT(*) AS cnt FROM bookings WHERE agentId = ? AND createdAt < ?`,
    [b.agentId, mondayThisWeek]
  );
  if (Number(cnt) === 0) {
    highlightItems.push({ emoji: '🎉', message: `${b.agentName} registered their first ever booking — welcome to the journey!` });
  }
}

const [highMarginRows] = await conn2.execute(
  `SELECT u.name AS agentName, b.id AS bookingId, b.expectedCommission, b.grossCost
   FROM bookings b JOIN users u ON u.id = b.agentId
   WHERE b.createdAt >= ? AND b.expectedCommission IS NOT NULL AND b.grossCost IS NOT NULL AND b.grossCost > 0`,
  [mondayThisWeek]
);
for (const b of highMarginRows) {
  if (Number(b.grossCost) > 0 && (Number(b.expectedCommission) / Number(b.grossCost)) * 100 > 12) {
    highlightItems.push({ emoji: '💰', message: `${b.agentName} secured a high-margin booking this week — great work!` });
  }
}

const [commRows2] = await conn2.execute(
  `SELECT u.name AS agentName, cc.grossAmount
   FROM commission_claims cc JOIN users u ON u.id = cc.agentId
   WHERE cc.claimedAt >= ? AND cc.status IN ('paid','awaiting_payment')`,
  [mondayThisWeek]
);
if (commRows2.length > 0) {
  const commNames = [...new Set(commRows2.map(c => c.agentName))].join(', ');
  const commTotal = commRows2.reduce((s, c) => s + Number(c.grossAmount ?? 0), 0);
  highlightItems.push({ emoji: '🏆', message: `Commission paid out to ${commNames} — total: £${commTotal.toLocaleString('en-GB', { maximumFractionDigits: 0 })}` });
}

let highlightsHtml = '';
if (highlightItems.length > 0) {
  const rows = highlightItems.map(h => `
    <tr><td style="padding:8px 12px;font-size:13px;color:#414141;font-family:'Poppins',sans-serif;">${h.emoji} <strong>${h.message.split(' ')[0]}</strong> ${h.message.split(' ').slice(1).join(' ')}</td></tr>
  `).join('');
  highlightsHtml = `
    <div style="margin-bottom:28px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #FFD700;padding-bottom:6px;">
        <span style="font-size:18px;">🌟</span>
        <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">Celebrating Our Agents</h3>
      </div>
      <table style="width:100%;border-collapse:collapse;background:#fffdf0;border:1px solid #ffe88a;border-radius:8px;overflow:hidden;">
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Upcoming events ───────────────────────────────────────────────────────────
let eventsHtml = "";
if (eventRows.length > 0) {
  const rows = eventRows.map(ev => {
    const d = new Date(ev.startDate);
    const dateStr = d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" });
    const timeStr = d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
    const catLabel = categoryLabel[ev.eventCategory ?? ""] ?? (ev.eventCategory ?? "Event");
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">
          <div style="font-size:13px;font-weight:600;color:#414141;font-family:'Poppins',sans-serif;">${ev.title}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;font-family:'Poppins',sans-serif;">${catLabel}</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;">
          <div style="font-size:12px;font-weight:600;color:#02E6D2;font-family:'Poppins',sans-serif;">${dateStr}</div>
          <div style="font-size:11px;color:#888;font-family:'Poppins',sans-serif;">${timeStr}</div>
        </td>
      </tr>
    `;
  }).join("");
  eventsHtml = `
    <div style="margin-bottom:32px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #70FFE8;padding-bottom:6px;">
        <span style="font-size:18px;">📅</span>
        <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">Coming Up</h3>
      </div>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:8px 0 0;font-size:12px;color:#888;font-family:'Poppins',sans-serif;">
        <a href="${ORIGIN}/events" style="color:#02E6D2;text-decoration:none;">View full calendar →</a>
      </p>
    </div>
  `;
}

// ── Community posts grouped by category ──────────────────────────────────────
const postsByCategory = {};
for (const p of postRows) {
  const cat = p.category ?? "news_announcements";
  if (!postsByCategory[cat]) postsByCategory[cat] = [];
  postsByCategory[cat].push(p);
}

let postsHtml = "";
for (const [cat, posts] of Object.entries(postsByCategory)) {
  const label      = categoryLabel[cat] ?? cat;
  const emoji      = categoryEmoji[cat] ?? "📌";
  const accentColor = categoryColor[cat] ?? "#70FFE8";
  postsHtml += `
    <div style="margin-bottom:28px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid ${accentColor};padding-bottom:6px;">
        <span style="font-size:18px;">${emoji}</span>
        <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">${label}</h3>
      </div>
      ${posts.map(p => `
        <div style="background:#ffffff;border:1px solid #e8e8e8;border-left:4px solid ${accentColor};border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:10px;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#414141;font-family:'Poppins',sans-serif;">${p.title}</p>
          <p style="margin:0 0 8px;font-size:12px;color:#888;font-family:'Poppins',sans-serif;">By ${p.authorName}</p>
          <p style="margin:0 0 10px;font-size:13px;color:#555;line-height:1.5;font-family:'Poppins',sans-serif;">${excerpt(p.bodyHtml)}</p>
          <a href="${ORIGIN}/community?postId=${p.id}" style="font-size:12px;font-weight:600;color:#02E6D2;text-decoration:none;font-family:'Poppins',sans-serif;">Read full post →</a>
        </div>
      `).join("")}
    </div>
  `;
}
if (!postsHtml) postsHtml = `<p style="color:#888;font-family:'Poppins',sans-serif;">No community posts this week.</p>`;

// ── Week label ────────────────────────────────────────────────────────────────
const weekLabel = new Date().toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" });

// ── Full email ────────────────────────────────────────────────────────────────
const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>JLT Group Weekly Update</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Poppins',Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;background:#f5f5f5;padding:24px 16px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#414141 0%,#2a2a2a 100%);border-radius:16px 16px 0 0;padding:32px 32px 24px;text-align:center;">
      <div style="display:inline-block;background:#70FFE8;border-radius:8px;padding:6px 16px;margin-bottom:16px;">
        <span style="font-size:12px;font-weight:700;color:#414141;letter-spacing:0.1em;text-transform:uppercase;">JLT Group</span>
      </div>
      <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#ffffff;line-height:1.2;">Weekly Update</h1>
      <p style="margin:0;font-size:13px;color:#70FFE8;font-weight:500;">Week of ${weekLabel}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#aaa;">⚡ Test email — sent directly to you</p>
    </div>

    <!-- Body -->
    <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px 32px;">

      ${statsHtml}
      ${highlightsHtml}
      ${eventsHtml}

      <!-- Community Posts -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;border-bottom:2px solid #70FFE8;padding-bottom:6px;">
          <span style="font-size:18px;">🗞️</span>
          <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">From the Community Hub</h3>
        </div>
        ${postsHtml}
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-top:32px;padding-top:24px;border-top:1px solid #f0f0f0;">
        <a href="${ORIGIN}/community"
           style="display:inline-block;background:linear-gradient(135deg,#70FFE8 0%,#02E6D2 100%);color:#414141;font-weight:700;font-size:14px;padding:14px 32px;border-radius:50px;text-decoration:none;font-family:'Poppins',sans-serif;">
          Visit the Community Hub
        </a>
        <p style="margin:12px 0 0;font-size:12px;color:#aaa;">
          <a href="${ORIGIN}/events" style="color:#02E6D2;text-decoration:none;">View Calendar</a>
          &nbsp;·&nbsp;
          <a href="${ORIGIN}/community" style="color:#02E6D2;text-decoration:none;">Community Hub</a>
        </p>
      </div>

    </div>

    <!-- Footer -->
    <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#aaa;font-family:'Poppins',sans-serif;">
      JLT Group Agent Portal — You're receiving this as an active JLT agent.<br/>
      © ${new Date().getFullYear()} JLT Group. All rights reserved.
    </p>

  </div>
</body>
</html>`;

await conn2.end();

// ── Send ──────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "mail.thejltgroup.co.uk",
  port: Number(process.env.SMTP_PORT ?? 465),
  secure: Number(process.env.SMTP_PORT ?? 465) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

await transporter.sendMail({
  from: `"JLT Group" <support@thejltgroup.co.uk>`,
  to:   `"${TO_NAME}" <${TO_EMAIL}>`,
  subject: `[TEST] JLT Group Weekly Update — ${weekLabel}`,
  html: emailHtml,
});

console.log(`✅ Test digest sent to ${TO_EMAIL}`);
