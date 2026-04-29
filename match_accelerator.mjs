import { createConnection } from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL;

// Parse DATABASE_URL: mysql://user:pass@host:port/dbname
const url = new URL(DB_URL);
const conn = await createConnection({
  host: url.hostname,
  port: parseInt(url.port || '3306'),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: false }
});

// All agents from the PDF with their phone numbers (normalised)
const pdfAgents = [
  { name: 'Arti Nay', phone: '+447944103667' },
  { name: 'A - Need to gather from airtable', phone: '+447792770603' },
  { name: 'Abby Antwi', phone: '+447463405330' },
  { name: 'Abdul Kareem', phone: '+447943587695' },
  { name: 'Abi Keller', phone: '+447519138996' },
  { name: 'ACM', phone: '+447852819461' },
  { name: 'Adam', phone: '+447891646608' },
  { name: 'Ailsa Gunn', phone: '+351938818007' },
  { name: 'Alicia', phone: '+447521530453' },
  { name: 'Amanda Wakefield', phone: '+447722521443' },
  { name: 'Amy', phone: '+447884228928' },
  { name: 'Anna | Wolf and Cub Travel', phone: '+447908723580' },
  { name: 'Aisling Escapes', phone: '+447563153375' },
  { name: 'Ash (2)', phone: '+447442142808' },
  { name: 'Barry Gamble', phone: '+447749996050' },
  { name: 'Bethany Smith', phone: '+447583455070' },
  { name: 'Calum', phone: '+447590071762' },
  { name: 'Carla', phone: '+447860355274' },
  { name: 'Carly', phone: '+447768679704' },
  { name: 'Caroline E', phone: '+447486401467' },
  { name: 'Catherine Compton', phone: '+447738908532' },
  { name: 'Charles Johnson', phone: '+447578277567' },
  { name: 'Charlotte', phone: '+447946300109' },
  { name: 'Charlotte Jane', phone: '+447799898784' },
  { name: 'Cheryl', phone: '+447454249086' },
  { name: 'Chloe Mitchell', phone: '+447930826353' },
  { name: 'Chris', phone: '+447828649208' },
  { name: 'Christine Lee', phone: '+447747016668' },
  { name: 'Clair', phone: '+447960694471' },
  { name: 'Corey McClean', phone: '+447586055922' },
  { name: 'Daniel', phone: '+447983556187' },
  { name: 'Daniel Eggo', phone: '+447469256262' },
  { name: 'Daniel G', phone: '+447867422262' },
  { name: 'Danielle', phone: '+447772216334' },
  { name: 'Declan', phone: '+447860822931' },
  { name: 'Deimante', phone: '+447719360495' },
  { name: 'Dionne', phone: '+447930270657' },
  { name: 'Dylan Foster', phone: '+447889293921' },
  { name: 'Dylan Lenton', phone: '+447495509851' },
  { name: 'Emerald Travel Agency', phone: '+447757123226' },
  { name: 'Emma', phone: '+447704983050' },
  { name: 'Farah', phone: '+447593311990' },
  { name: 'Fiona S', phone: '+447985196702' },
  { name: 'Galaxy Travels Uk', phone: '+447428822941' },
  { name: 'GallivantingGirlie', phone: '+447490481777' },
  { name: 'Gavin Moss', phone: '+447955363233' },
  { name: 'Gaz Lewis', phone: '+447737013349' },
  { name: 'Gem', phone: '+447495886594' },
  { name: 'Gemma G', phone: '+447988642983' },
  { name: 'Gerrie', phone: '+447368277360' },
  { name: 'Gina', phone: '+447581190698' },
  { name: 'Hannah', phone: '+447590804474' },
  { name: 'Hayley', phone: '+447510626199' },
  { name: 'Helen Burgess', phone: '+447508686912' },
  { name: 'Henry Ayers', phone: '+447972234176' },
  { name: 'Iliana Baughan', phone: '+447968620361' },
  { name: 'Izzi Rix', phone: '+447443640085' },
  { name: 'Jack Reynolds', phone: '+447538711481' },
  { name: 'Jade Taylor', phone: '+447493035263' },
  { name: 'Jake', phone: '+447469205217' },
  { name: 'Jane', phone: '+447737872263' },
  { name: 'Jay', phone: '+447876050601' },
  { name: 'Jay Northcott', phone: '+447586294843' },
  { name: 'Jaz', phone: '+447949963603' },
  { name: 'Jerome', phone: '+447961053073' },
  { name: 'Jess Waters', phone: '+447917568195' },
  { name: 'Jessica', phone: '+447712018335' },
  { name: 'Jessica Read', phone: '+447713746739' },
  { name: 'Jo | The Travel Bug', phone: '+447562813898' },
  { name: 'Jodie', phone: '+447429047309' },
  { name: 'Jodie (2)', phone: '+447415115398' },
  { name: 'Jon', phone: '+447566724833' },
  { name: 'Josh Clark', phone: '+447828488832' },
  { name: 'Karen', phone: '+447970660036' },
  { name: 'Kathy', phone: '+447913419122' },
  { name: 'Katie @ The Travel Bug', phone: '+447715944443' },
  { name: 'Katy', phone: '+447837871699' },
  { name: 'Kellie', phone: '+447598146830' },
  { name: 'Kelly Wheeler', phone: '+447713181202' },
  { name: 'Kieran', phone: '+447393987430' },
  { name: 'Kim', phone: '+447834326461' },
  { name: 'Kirsty D', phone: '+447919343788' },
  { name: 'Kyle', phone: '+447817215718' },
  { name: 'Lacey', phone: '+447957091565' },
  { name: 'Laura', phone: '+447557110245' },
  { name: 'Lauren', phone: '+447762483516' },
  { name: 'Lauren Jackson', phone: '+447495525283' },
  { name: 'Leanne', phone: '+447793318603' },
  { name: 'Lesley', phone: '+447707328212' },
  { name: 'Lianne B', phone: '+447792942233' },
  { name: 'Lorraine', phone: '+447708622176' },
  { name: 'Louise', phone: '+447840604607' },
  { name: 'Loulyluxe Aesthetics', phone: '+447802241810' },
  { name: 'Lynsey', phone: '+61434340178' },
  { name: 'Malcolm', phone: '+447908036974' },
  { name: 'Marie', phone: '+447912999475' },
  { name: 'Mark', phone: '+447400467719' },
  { name: 'Melissa', phone: '+447921770990' },
  { name: 'Michael Matthews', phone: '+447805719977' },
  { name: 'Mick', phone: '+447426532433' },
  { name: 'Millie M', phone: '+447563414912' },
  { name: 'MNDL Travel Co.', phone: '+447448958672' },
  { name: 'Najma', phone: '+447915839862' },
  { name: 'Nay', phone: '+447951626356' },
  { name: 'Niamh Considine', phone: '+447921020715' },
  { name: 'nicky bramble78', phone: '+447786850047' },
  { name: 'Oki Sakuyama-Arimatsu', phone: '+33766401353' },
  { name: 'Peter Jackaman', phone: '+447350689257' },
  { name: 'Poonam Arora', phone: '+447305809286' },
  { name: 'Priya', phone: '+447438526262' },
  { name: 'Queen Rissy', phone: '+447889243006' },
  { name: 'Rachel', phone: '+447811156169' },
  { name: 'Rachel Barker', phone: '+447481144903' },
  { name: 'Rachel Leigh', phone: '+447929839268' },
  { name: 'Rhiannon', phone: '+447733709468' },
  { name: 'Ridwan Messina', phone: '+447984875855' },
  { name: 'Rob - Raven Travel', phone: '+447508817870' },
  { name: 'Sara', phone: '+447581073688' },
  { name: 'Sharon - Adapted Getaways', phone: '+447405745261' },
  { name: 'Shelley', phone: '+447821064349' },
  { name: 'Siraj Ul Haq', phone: '+447969231157' },
  { name: 'Soph', phone: '+447454289903' },
  { name: 'Sophie Maton', phone: '+447398721278' },
  { name: 'Steff', phone: '+447845782338' },
  { name: 'Steph Reynolds @ Steph\'s Suitcase', phone: '+447807910368' },
  { name: 'Sylvia', phone: '+447850230601' },
  { name: 'Tabitha Nash', phone: '+447495619468' },
  { name: 'The bean Counters', phone: '+447779565565' },
  { name: 'Tillie', phone: '+447938837461' },
  { name: 'Tim Winkworth', phone: '+447920850947' },
  { name: 'Toby Winn', phone: '+447970766446' },
  { name: 'Uwais', phone: '+447984510898' },
  { name: 'Walter', phone: '+447845935226' },
  { name: 'Wayne Coffer', phone: '+447798601495' },
  { name: 'Zak', phone: '+447951221540' },
  { name: 'Zoe', phone: '+447447436262' },
  { name: 'Zoe (2)', phone: '+447359259752' },
  { name: 'Zoza travel agent', phone: '+447424033044' },
];

// Normalise a phone number: strip spaces, dashes, parentheses
function normalise(phone) {
  if (!phone) return '';
  let p = phone.replace(/[\s\-\(\)\.]/g, '');
  // Convert leading 0 (UK) to +44
  if (p.startsWith('0')) p = '+44' + p.slice(1);
  return p.toLowerCase();
}

// Get all CRM agents with phone numbers
const [rows] = await conn.execute(
  `SELECT id, firstName, lastName, phone, crmStage FROM agents WHERE phone IS NOT NULL AND phone != ''`
);

console.log(`CRM agents with phone: ${rows.length}`);

// Build lookup map from normalised phone -> agent
const crmMap = new Map();
for (const row of rows) {
  const norm = normalise(row.phone);
  if (norm) crmMap.set(norm, row);
}

const matched = [];
const unmatched = [];

for (const pdfAgent of pdfAgents) {
  const norm = normalise(pdfAgent.phone);
  if (!norm) { unmatched.push({ ...pdfAgent, reason: 'no phone' }); continue; }
  const crmAgent = crmMap.get(norm);
  if (crmAgent) {
    matched.push({ pdfName: pdfAgent.name, crmId: crmAgent.id, crmName: `${crmAgent.firstName} ${crmAgent.lastName}`, currentStage: crmAgent.crmStage, phone: pdfAgent.phone });
  } else {
    unmatched.push({ ...pdfAgent, reason: 'no match in CRM' });
  }
}

console.log(`\nMatched: ${matched.length}`);
console.log(`Unmatched: ${unmatched.length}`);

console.log('\n=== MATCHED AGENTS ===');
for (const m of matched) {
  console.log(`  PDF: "${m.pdfName}" → CRM: "${m.crmName}" (id=${m.crmId}, stage=${m.currentStage})`);
}

console.log('\n=== UNMATCHED (no CRM record) ===');
for (const u of unmatched) {
  console.log(`  "${u.name}" ${u.phone} — ${u.reason}`);
}

await conn.end();
