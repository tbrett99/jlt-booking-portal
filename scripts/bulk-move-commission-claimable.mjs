/**
 * Bulk move bookings with departure before 31 March 2026 to Commission Claimable.
 * For bookings missing a final supplier payment date, set paymentDateDismissed = true
 * so they are suppressed from the dashboard missing-payment-date alert.
 */

import mysql from "mysql2/promise";
import "dotenv/config";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log("Connected.");

  // Get all eligible bookings
  const [eligible] = await conn.execute(
    `SELECT id, clientName, currentStage, finalSupplierPaymentDate 
     FROM bookings 
     WHERE departureDate < '2026-03-31 23:59:59'
     AND currentStage NOT IN ('Commission Claimable', 'Commission Claimed', 'Cancelled')`
  );
  console.log(`Eligible bookings to move: ${eligible.length}`);

  let moved = 0;
  let dismissed = 0;

  for (const b of eligible) {
    const missingPaymentDate = b.finalSupplierPaymentDate === null;

    // Move to Commission Claimable, set dismissed flag if no payment date
    await conn.execute(
      "UPDATE bookings SET currentStage = 'Commission Claimable', paymentDateDismissed = ? WHERE id = ?",
      [missingPaymentDate ? 1 : 0, b.id]
    );

    // Pipeline history
    await conn.execute(
      "INSERT INTO pipeline_history (bookingId, fromStage, toStage, movedById, movedAt) VALUES (?, ?, 'Commission Claimable', 1, NOW())",
      [b.id, b.currentStage]
    );

    // System note
    const noteMsg = missingPaymentDate
      ? "[System] Moved to Commission Claimable (departure before 31 Mar 2026). Missing payment date — suppressed from dashboard alert."
      : "[System] Moved to Commission Claimable (departure before 31 Mar 2026).";
    await conn.execute(
      "INSERT INTO notes (bookingId, authorId, content, isInternal, createdAt) VALUES (?, 1, ?, true, NOW())",
      [b.id, noteMsg]
    );

    moved++;
    if (missingPaymentDate) dismissed++;
  }

  console.log(`\n=== Results ===`);
  console.log(`Moved to Commission Claimable: ${moved}`);
  console.log(`Dismissed from payment date alert: ${dismissed}`);

  const [claimable] = await conn.execute(
    "SELECT COUNT(*) as c FROM bookings WHERE currentStage = 'Commission Claimable'"
  );
  console.log(`Total Commission Claimable now: ${claimable[0].c}`);

  await conn.end();
}

main().catch((e) => {
  console.error("Script failed:", e.message);
  process.exit(1);
});
