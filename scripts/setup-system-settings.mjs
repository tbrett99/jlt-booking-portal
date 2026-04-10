import mysql from "mysql2/promise";
import "dotenv/config";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Create system_settings table (backtick-quoted key column to avoid reserved word conflict)
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`system_settings\` (
      \`key\` VARCHAR(100) NOT NULL,
      \`value\` TEXT NOT NULL,
      \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`key\`)
    )
  `);
  console.log("system_settings table ready.");

  // Set notifications_paused = true immediately
  await conn.execute(
    "INSERT INTO `system_settings` (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?, `updatedAt` = NOW()",
    ["notifications_paused", "true", "true"]
  );
  console.log("notifications_paused set to: true");

  const [rows] = await conn.execute("SELECT * FROM `system_settings`");
  console.log("Current settings:", rows);

  await conn.end();
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
