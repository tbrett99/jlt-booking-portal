import { createConnection } from 'mysql2/promise';
const url = new URL(process.env.DATABASE_URL);
const conn = await createConnection({ host: url.hostname, port: parseInt(url.port||'3306'), user: url.username, password: url.password, database: url.pathname.slice(1), ssl: { rejectUnauthorized: false } });

const pdfPhones = [
  ['+447944103667','Arti Nay'],['+447792770603','A - airtable'],['+447463405330','Abby Antwi'],
  ['+447943587695','Abdul Kareem'],['+447519138996','Abi Keller'],['+447852819461','ACM'],
  ['+447891646608','Adam'],['+351938818007','Ailsa Gunn'],['+447521530453','Alicia'],
  ['+447722521443','Amanda Wakefield'],['+447884228928','Amy'],['+447908723580','Anna Wolf and Cub Travel'],
  ['+447563153375','Aisling Escapes'],['+447442142808','Ash 2'],['+447749996050','Barry Gamble'],
  ['+447583455070','Bethany Smith'],['+447590071762','Calum'],['+447860355274','Carla'],
  ['+447768679704','Carly'],['+447486401467','Caroline E'],['+447738908532','Catherine Compton'],
  ['+447578277567','Charles Johnson'],['+447946300109','Charlotte'],['+447799898784','Charlotte Jane'],
  ['+447454249086','Cheryl'],['+447930826353','Chloe Mitchell'],['+447828649208','Chris'],
  ['+447747016668','Christine Lee'],['+447960694471','Clair'],['+447586055922','Corey McClean'],
  ['+447983556187','Daniel'],['+447469256262','Daniel Eggo'],['+447867422262','Daniel G'],
  ['+447772216334','Danielle'],['+447860822931','Declan'],['+447719360495','Deimante'],
  ['+447930270657','Dionne'],['+447889293921','Dylan Foster'],['+447495509851','Dylan Lenton'],
  ['+447757123226','Emerald Travel Agency'],['+447704983050','Emma'],['+447593311990','Farah'],
  ['+447985196702','Fiona S'],['+447428822941','Galaxy Travels Uk'],['+447490481777','GallivantingGirlie'],
  ['+447955363233','Gavin Moss'],['+447737013349','Gaz Lewis'],['+447495886594','Gem'],
  ['+447988642983','Gemma G'],['+447368277360','Gerrie'],['+447581190698','Gina'],
  ['+447590804474','Hannah'],['+447510626199','Hayley'],['+447508686912','Helen Burgess'],
  ['+447972234176','Henry Ayers'],['+447968620361','Iliana Baughan'],['+447443640085','Izzi Rix'],
  ['+447538711481','Jack Reynolds'],['+447493035263','Jade Taylor'],['+447469205217','Jake'],
  ['+447737872263','Jane'],['+447876050601','Jay'],['+447586294843','Jay Northcott'],
  ['+447949963603','Jaz'],['+447961053073','Jerome'],['+447917568195','Jess Waters'],
  ['+447712018335','Jessica'],['+447713746739','Jessica Read'],['+447562813898','Jo The Travel Bug'],
  ['+447429047309','Jodie'],['+447415115398','Jodie 2'],['+447566724833','Jon'],
  ['+447828488832','Josh Clark'],['+447970660036','Karen'],['+447913419122','Kathy'],
  ['+447715944443','Katie The Travel Bug'],['+447837871699','Katy'],['+447598146830','Kellie'],
  ['+447713181202','Kelly Wheeler'],['+447393987430','Kieran'],['+447834326461','Kim'],
  ['+447919343788','Kirsty D'],['+447817215718','Kyle'],['+447957091565','Lacey'],
  ['+447557110245','Laura'],['+447762483516','Lauren'],['+447495525283','Lauren Jackson'],
  ['+447793318603','Leanne'],['+447707328212','Lesley'],['+447792942233','Lianne B'],
  ['+447708622176','Lorraine'],['+447840604607','Louise'],['+447802241810','Loulyluxe Aesthetics'],
  ['+61434340178','Lynsey'],['+447908036974','Malcolm'],['+447912999475','Marie'],
  ['+447400467719','Mark'],['+447921770990','Melissa'],['+447805719977','Michael Matthews'],
  ['+447426532433','Mick'],['+447563414912','Millie M'],['+447448958672','MNDL Travel Co'],
  ['+447915839862','Najma'],['+447951626356','Nay'],['+447921020715','Niamh Considine'],
  ['+447786850047','nicky bramble78'],['+33766401353','Oki Sakuyama-Arimatsu'],
  ['+447350689257','Peter Jackaman'],['+447305809286','Poonam Arora'],['+447438526262','Priya'],
  ['+447889243006','Queen Rissy'],['+447811156169','Rachel'],['+447481144903','Rachel Barker'],
  ['+447929839268','Rachel Leigh'],['+447733709468','Rhiannon'],['+447984875855','Ridwan Messina'],
  ['+447508817870','Rob Raven Travel'],['+447581073688','Sara'],['+447405745261','Sharon Adapted Getaways'],
  ['+447821064349','Shelley'],['+447969231157','Siraj Ul Haq'],['+447454289903','Soph'],
  ['+447398721278','Sophie Maton'],['+447845782338','Steff'],['+447807910368','Steph Reynolds'],
  ['+447850230601','Sylvia'],['+447495619468','Tabitha Nash'],['+447779565565','The bean Counters'],
  ['+447938837461','Tillie'],['+447920850947','Tim Winkworth'],['+447970766446','Toby Winn'],
  ['+447984510898','Uwais'],['+447845935226','Walter'],['+447798601495','Wayne Coffer'],
  ['+447951221540','Zak'],['+447447436262','Zoe'],['+447359259752','Zoe 2'],
  ['+447424033044','Zoza travel agent'],
];

function norm(p) {
  if (!p) return '';
  let s = p.replace(/[\s\-\(\)\.]/g,'');
  if (s.startsWith('0')) s = '+44' + s.slice(1);
  return s.toLowerCase();
}

const [rows] = await conn.execute(`
  SELECT acp.id AS profileId, acp.mobile, acp.trainingStage, u.name AS userName, u.phone AS userPhone
  FROM agent_crm_profiles acp
  LEFT JOIN users u ON u.id = acp.userId
`);

const mobileMap = new Map();
const phoneMap = new Map();
for (const r of rows) {
  if (r.mobile) { const n = norm(r.mobile); if (n) mobileMap.set(n, r); }
  if (r.userPhone) { const n = norm(r.userPhone); if (n) phoneMap.set(n, r); }
}

const matched = [], unmatched = [];
for (const [phone, name] of pdfPhones) {
  const n = norm(phone);
  const hit = mobileMap.get(n) || phoneMap.get(n);
  if (hit) matched.push({ name, profileId: hit.profileId, crmName: hit.userName, stage: hit.trainingStage });
  else unmatched.push(name + ' ' + phone);
}

console.log('MATCHED:', matched.length);
for (const m of matched) console.log(' ', JSON.stringify(m));
console.log('\nUNMATCHED:', unmatched.length);
for (const u of unmatched) console.log(' ', u);

await conn.end();
