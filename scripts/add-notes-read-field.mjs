import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
try {
  await conn.execute("ALTER TABLE notes ADD COLUMN isReadByAdmin boolean DEFAULT false NOT NULL");
  console.log("✅ Added isReadByAdmin column to notes table");
} catch (e) {
  if (e.code === "ER_DUP_FIELDNAME") {
    console.log("ℹ️  Column already exists, skipping");
  } else {
    throw e;
  }
}
await conn.end();
process.exit(0);
