import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (relative: string) => readFileSync(
  fileURLToPath(new URL(`../${relative}`, import.meta.url)),
  "utf8",
);

describe("Orbit financial sync audit and staff visibility", () => {
  const schema = source("drizzle/schema.ts");
  const db = source("server/db.ts");
  const router = source("server/routers.ts");
  const bookingDetail = source("client/src/pages/admin/AdminBookingDetail.tsx");

  it("records one immutable outcome for every newer Orbit revision", () => {
    expect(schema).toContain('"orbit_financial_sync_events"');
    expect(schema).toContain('uniqueIndex("orbit_financial_sync_event_revision_unique")');
    expect(db).toContain("await tx.insert(orbitFinancialSyncEvents).values");
    expect(db).toContain("applyOrbitFinancialSnapshot");
  });

  it("exposes a staff-only sync history and clear booking-level status", () => {
    expect(router).toContain("orbitFinancialSyncStatus: adminProcedure");
    expect(bookingDetail).toContain('if (!isHeld)');
    expect(bookingDetail).toContain("Last synced from Orbit:");
    expect(bookingDetail).toContain("Orbit financial update requires review");
    expect(bookingDetail).toContain("Review required");
    expect(bookingDetail).toContain("Gross booking price (£)");
    expect(bookingDetail).not.toContain(': "Latest snapshot"');
  });

  it("does not let legacy commission-only sync bypass a protected claim lifecycle", () => {
    const externalApi = source("server/external-api.ts");
    expect(externalApi).toContain("Send the full versioned Orbit financial snapshot");
    expect(externalApi).toContain("held_for_claim_review");
  });
});
