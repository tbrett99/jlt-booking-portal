/**
 * One-off script: send a test weekly digest email to a given address.
 * Usage: node -r dotenv/config scripts/send-test-digest.mjs
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import nodemailer from "nodemailer";

const TO_EMAIL = "max@loupr.com";
const TO_NAME  = "Max Kelly";
const ORIGIN   = "https://portal.thejltgroup.co.uk";

const conn = await createConnection(process.env.DATABASE_URL);

// ── Date boundaries ────────────────────────────────────────────────────────────
const now = new Date();
// Start of this Monday
const mondayThisWeek = new Date(now);
mondayThisWeek.setHours(0, 0, 0, 0);
mondayThisWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));

// Next week Mon–Sun
const dayOfWeek = now.getDay();
const daysUntilNextMon = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
const nextMonday = new Date(now);
nextMonday.setDate(now.getDate() + daysUntilNextMon);
nextMonday.setHours(0, 0, 0, 0);
const nextSunday = new Date(nextMonday);
nextSunday.setDate(nextMonday.getDate() + 6);
nextSunday.setHours(23, 59, 59, 999);

// ── Stats ─────────────────────────────────────────────────────────────────────
const [[bRow]] = await conn.execute(
  `SELECT COUNT(*) AS cnt FROM bookings WHERE createdAt >= ?`, [mondayThisWeek]
);
const bookingsThisWeek = bRow.cnt;

const [[cRow]] = await conn.execute(
  `SELECT COALESCE(SUM(grossAmount),0) AS total FROM commission_claims WHERE status IN ('paid','awaiting_payment') AND claimedAt >= ?`, [mondayThisWeek]
);
const commissionTotal = Number(cRow.total);

const [[rRow]] = await conn.execute(
  `SELECT COUNT(*) AS cnt FROM reimbursement_items WHERE status='paid' AND paidAt >= ?`, [mondayThisWeek]
);
const reimbursementsCount = rRow.cnt;

// ── Community posts this week (ALL — no cap) ──────────────────────────────────
const [postRows] = await conn.execute(
  `SELECT id, title, authorName, bodyHtml, category FROM community_posts
   WHERE isDraft=0 AND isHidden=0 AND createdAt >= ?
   ORDER BY createdAt DESC`, [mondayThisWeek]
);

// ── Upcoming events next week ─────────────────────────────────────────────────
const [eventRows] = await conn.execute(
  `SELECT id, title, startDate, eventCategory FROM calendar_events
   WHERE agentFacing=1 AND startDate >= ? AND startDate <= ?
   ORDER BY startDate ASC`, [nextMonday, nextSunday]
);

// ── First bookings this week ──────────────────────────────────────────────────
const [thisWeekBookings] = await conn.execute(
  `SELECT b.id AS bookingId, u.name AS agentName, b.agentId
   FROM bookings b JOIN users u ON u.id = b.agentId
   WHERE b.createdAt >= ?`, [mondayThisWeek]
);
const firstBookings = [];
for (const b of thisWeekBookings) {
  const [[{ cnt }]] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM bookings WHERE agentId = ? AND createdAt < ?`,
    [b.agentId, mondayThisWeek]
  );
  if (Number(cnt) === 0) firstBookings.push(b.agentName);
}

// ── Tiered high-margin bookings ───────────────────────────────────────────────
const [marginRows] = await conn.execute(
  `SELECT u.name AS agentName, b.expectedCommission, b.grossCost
   FROM bookings b JOIN users u ON u.id = b.agentId
   WHERE b.createdAt >= ? AND b.expectedCommission IS NOT NULL AND b.grossCost > 0`,
  [mondayThisWeek]
);
const tierOrder = ["20%+", "15–20%", "12–15%", "10–12%"];
const tierEmoji = { "20%+": "🥇", "15–20%": "🥈", "12–15%": "🥉", "10–12%": "🎯" };
const tierColor = { "20%+": "#FFD700", "15–20%": "#C0C0C0", "12–15%": "#CD7F32", "10–12%": "#02E6D2" };
const byTier = {};
for (const b of marginRows) {
  const pct = (Number(b.expectedCommission) / Number(b.grossCost)) * 100;
  if (pct < 10) continue;
  const tier = pct >= 20 ? "20%+" : pct >= 15 ? "15–20%" : pct >= 12 ? "12–15%" : "10–12%";
  if (!byTier[tier]) byTier[tier] = [];
  byTier[tier].push({ name: b.agentName, pct: Math.round(pct * 10) / 10 });
}

// ── Commission paid out ───────────────────────────────────────────────────────
const [commPaidRows] = await conn.execute(
  `SELECT u.name AS agentName, cc.grossAmount FROM commission_claims cc JOIN users u ON u.id = cc.agentId
   WHERE cc.claimedAt >= ? AND cc.status IN ('paid','awaiting_payment')`, [mondayThisWeek]
);
const commPaidNames = [...new Set(commPaidRows.map(c => c.agentName))];
const commPaidTotal = commPaidRows.reduce((s, c) => s + Number(c.grossAmount ?? 0), 0);

await conn.end();

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

// ── Agent highlights ──────────────────────────────────────────────────────────
const highlightRows = [];
for (const name of firstBookings) {
  highlightRows.push(`<tr style="background:#f0fff8;"><td style="padding:10px 14px;font-size:13px;color:#414141;font-family:'Poppins',sans-serif;border-bottom:1px solid #e8f8f0;">🎉 <strong>${name}</strong> registered their <strong>first ever booking</strong> — welcome to the JLT journey!</td></tr>`);
}
for (const tier of tierOrder) {
  const group = byTier[tier];
  if (!group?.length) continue;
  const emoji = tierEmoji[tier];
  const color = tierColor[tier];
  const names = group.map(h => `<strong>${h.name}</strong> (${h.pct}%)`).join(", ");
  highlightRows.push(`<tr><td style="padding:10px 14px;font-size:13px;color:#414141;font-family:'Poppins',sans-serif;border-bottom:1px solid #f5f5f5;border-left:4px solid ${color};">${emoji} <span style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;">${tier} margin</span><br/>${names}</td></tr>`);
}
if (commPaidNames.length > 0) {
  highlightRows.push(`<tr><td style="padding:10px 14px;font-size:13px;color:#414141;font-family:'Poppins',sans-serif;">🏆 Commission paid out to <strong>${commPaidNames.join(", ")}</strong> — total: <strong>£${commPaidTotal.toLocaleString("en-GB",{maximumFractionDigits:0})}</strong></td></tr>`);
}
const highlightsHtml = highlightRows.length > 0 ? `
  <div style="margin-bottom:28px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #FFD700;padding-bottom:6px;">
      <span style="font-size:18px;">🌟</span>
      <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">Celebrating Our Agents</h3>
    </div>
    <table style="width:100%;border-collapse:collapse;background:#fffdf0;border:1px solid #ffe88a;border-radius:8px;overflow:hidden;">
      <tbody>${highlightRows.join("")}</tbody>
    </table>
  </div>
` : "";

// ── Upcoming events next week ─────────────────────────────────────────────────
const nextWeekLabel = nextMonday.toLocaleDateString("en-GB",{day:"numeric",month:"short"}) + " – " + nextSunday.toLocaleDateString("en-GB",{day:"numeric",month:"short"});
let eventsHtml = "";
if (eventRows.length > 0) {
  const rows = eventRows.map(ev => {
    const d = new Date(ev.startDate);
    const dateStr = d.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});
    const timeStr = d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
    const catLabel = categoryLabel[ev.eventCategory ?? ""] ?? (ev.eventCategory ?? "Event");
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:13px;font-weight:600;color:#414141;font-family:'Poppins',sans-serif;">${ev.title}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;font-family:'Poppins',sans-serif;">${catLabel}</div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;">
        <div style="font-size:12px;font-weight:600;color:#02E6D2;font-family:'Poppins',sans-serif;">${dateStr}</div>
        <div style="font-size:11px;color:#888;font-family:'Poppins',sans-serif;">${timeStr}</div>
      </td>
    </tr>`;
  }).join("");
  eventsHtml = `
    <div style="margin-bottom:32px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #70FFE8;padding-bottom:6px;">
        <span style="font-size:18px;">📅</span>
        <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">Coming Up Next Week (${nextWeekLabel})</h3>
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

// ── Community snapshot bar ────────────────────────────────────────────────────
const postsByCategory = {};
for (const p of postRows) {
  const cat = p.category ?? "news_announcements";
  if (!postsByCategory[cat]) postsByCategory[cat] = [];
  postsByCategory[cat].push(p);
}
const snapshotOrder = ["business_update","news_announcements","supplier_news_deals","training_webinars","agent_win","jlt_stay_story","mindset","first_class_lounge"];
const snapshotCells = snapshotOrder
  .filter(cat => postsByCategory[cat]?.length > 0)
  .map(cat => {
    const count = postsByCategory[cat].length;
    const label = categoryLabel[cat] ?? cat;
    const emoji = categoryEmoji[cat] ?? "📌";
    const color = categoryColor[cat] ?? "#70FFE8";
    return `<td style="padding:10px 8px;text-align:center;vertical-align:top;">
      <div style="background:${color}22;border:1px solid ${color};border-radius:8px;padding:10px 8px;">
        <div style="font-size:20px;">${emoji}</div>
        <div style="font-size:18px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;">${count}</div>
        <div style="font-size:10px;color:#666;font-family:'Poppins',sans-serif;line-height:1.3;">${label}</div>
      </div>
    </td>`;
  });
const snapshotHtml = snapshotCells.length > 0 ? `
  <div style="margin-bottom:28px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:2px solid #70FFE8;padding-bottom:6px;">
      <span style="font-size:18px;">📊</span>
      <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">This Week in the Community</h3>
    </div>
    <table style="width:100%;border-collapse:collapse;"><tr>${snapshotCells.join("")}</tr></table>
  </div>
` : "";

// ── Community posts grouped by category ──────────────────────────────────────
let postsHtml = "";
for (const [cat, posts] of Object.entries(postsByCategory)) {
  const label       = categoryLabel[cat] ?? cat;
  const emoji       = categoryEmoji[cat] ?? "📌";
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
          <p style="margin:0 0 10px;font-size:13px;color:#555;line-height:1.5;font-family:'Poppins',sans-serif;">${excerpt(p.bodyHtml ?? "")}</p>
          <a href="${ORIGIN}/community?postId=${p.id}" style="font-size:12px;font-weight:600;color:#02E6D2;text-decoration:none;font-family:'Poppins',sans-serif;">Read full post →</a>
        </div>
      `).join("")}
    </div>
  `;
}
if (!postsHtml) postsHtml = `<p style="color:#888;font-family:'Poppins',sans-serif;">No community posts this week.</p>`;

// ── Week label ────────────────────────────────────────────────────────────────
const weekLabel = mondayThisWeek.toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});

// ── Full email HTML ───────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>JLT Group Weekly Update</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Poppins',Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;background:#f5f5f5;padding:24px 16px;">
    <div style="background:linear-gradient(135deg,#414141 0%,#2a2a2a 100%);border-radius:16px 16px 0 0;padding:32px 32px 24px;text-align:center;">
      <div style="display:inline-block;background:#70FFE8;border-radius:8px;padding:6px 16px;margin-bottom:16px;">
        <span style="font-size:12px;font-weight:700;color:#414141;letter-spacing:0.1em;text-transform:uppercase;">JLT Group</span>
      </div>
      <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#ffffff;line-height:1.2;">Weekly Update</h1>
      <p style="margin:0;font-size:13px;color:#70FFE8;font-weight:500;">Week of ${weekLabel}</p>
    </div>
    <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px 32px;">
      ${statsHtml}
      ${highlightsHtml}
      ${eventsHtml}
      ${snapshotHtml}
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;border-bottom:2px solid #70FFE8;padding-bottom:6px;">
          <span style="font-size:18px;">🗞️</span>
          <h3 style="margin:0;font-size:15px;font-weight:700;color:#414141;font-family:'Poppins',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">From the Community Hub</h3>
        </div>
        ${postsHtml}
      </div>
      <div style="text-align:center;margin-top:32px;padding-top:24px;border-top:1px solid #f0f0f0;">
        <a href="${ORIGIN}/community" style="display:inline-block;background:linear-gradient(135deg,#70FFE8 0%,#02E6D2 100%);color:#414141;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;font-family:'Poppins',sans-serif;">Visit the Community Hub →</a>
        <p style="margin:16px 0 0;font-size:11px;color:#aaa;font-family:'Poppins',sans-serif;">You're receiving this because you're an active JLT Group agent.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

// ── Send via SMTP ─────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const info = await transporter.sendMail({
  from: `"JLT Group" <${process.env.SMTP_USER}>`,
  to: `"${TO_NAME}" <${TO_EMAIL}>`,
  subject: `JLT Weekly Update — ${mondayThisWeek.toLocaleDateString("en-GB",{day:"numeric",month:"long"})}`,
  html,
});

console.log("✅ Test digest sent:", info.messageId);
console.log(`   Stats: ${bookingsThisWeek} bookings, £${commissionTotal.toLocaleString("en-GB",{maximumFractionDigits:0})} commission, ${reimbursementsCount} reimbursements`);
console.log(`   First bookings: ${firstBookings.length > 0 ? firstBookings.join(", ") : "none"}`);
console.log(`   High-margin tiers: ${Object.entries(byTier).map(([t,g]) => `${t}: ${g.length}`).join(", ") || "none"}`);
console.log(`   Posts: ${postRows.length} total across ${Object.keys(postsByCategory).length} categories`);
console.log(`   Next week events: ${eventRows.length}`);
