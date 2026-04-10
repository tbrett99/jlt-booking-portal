import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

try {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`reimbursement_docs\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`bookingId\` int NOT NULL,
      \`uploadedById\` int NOT NULL,
      \`fileUrl\` text NOT NULL,
      \`fileName\` varchar(255) NOT NULL,
      \`mimeType\` varchar(100),
      \`uploadedAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`reimbursement_docs_id\` PRIMARY KEY(\`id\`)
    )
  `);
  console.log("✓ reimbursement_docs table created");

  // Add isReimbursementDoc column to amendments (safe — ADD COLUMN IF NOT EXISTS)
  try {
    await conn.execute(`ALTER TABLE \`amendments\` ADD COLUMN \`isReimbursementDoc\` boolean DEFAULT false NOT NULL`);
    console.log("✓ isReimbursementDoc column added to amendments");
  } catch (e) {
    if (e.code === "ER_DUP_FIELDNAME") {
      console.log("✓ isReimbursementDoc column already exists");
    } else throw e;
  }

  console.log("Migration complete.");
} finally {
  await conn.end();
}
