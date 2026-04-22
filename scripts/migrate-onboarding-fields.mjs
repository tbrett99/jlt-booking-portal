import { createConnection } from "mysql2/promise";

const db = await createConnection(process.env.DATABASE_URL);

const statements = [
  "ALTER TABLE `agent_crm_profiles` ADD COLUMN `emergencyContactName` varchar(255)",
  "ALTER TABLE `agent_crm_profiles` ADD COLUMN `emergencyContactPhone` varchar(30)",
  "ALTER TABLE `agent_crm_profiles` ADD COLUMN `preferredPaymentDay` int",
];

for (const sql of statements) {
  try {
    await db.execute(sql);
    console.log("✓", sql.slice(0, 70));
  } catch (err) {
    if (err.code === "ER_DUP_FIELDNAME") {
      console.log("⏭ Already exists:", sql.slice(40, 80));
    } else {
      console.error("✗", err.message);
    }
  }
}

await db.end();
console.log("Migration complete.");
