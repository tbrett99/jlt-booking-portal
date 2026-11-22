import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql, { type Pool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import fs from "node:fs";
const enabled = process.env.JLT_HQ_LOCAL_MYSQL_TEST === "1";
let pool: Pool;
let db: ReturnType<typeof drizzle>;
vi.mock("./db", () => ({
  getDb: async () => db,
  getRawDbPool: async () => pool,
}));
const actor = { id: 47, role: "super_admin", name: "SAMPLE administrator" };
describe.skipIf(!enabled)(
  "Management HQ exact local-only MySQL milestone",
  () => {
    beforeAll(async () => {
      const socketPath = "/home/ubuntu/hq-mysql-probe/mysql.sock";
      if (!fs.existsSync(socketPath))
        throw new Error("Dedicated HQ fixture socket required");
      pool = mysql.createPool({
        socketPath,
        user: "root",
        database: "jlt_hq_probe",
        connectionLimit: 3,
      });
      db = drizzle(pool);
      await pool.execute(
        "CREATE TABLE users (id int PRIMARY KEY, role varchar(40), name text, isActive boolean, portalStatus varchar(40))"
      );
      await pool.execute(
        "INSERT INTO users VALUES (47,'super_admin','SAMPLE administrator',1,'active'),(48,'super_admin','Other SAMPLE administrator',1,'active')"
      );
      await pool.execute(
        "CREATE TABLE bookings (id int PRIMARY KEY,grossCost varchar(40),currentStage varchar(40))"
      );
      await pool.execute(
        "INSERT INTO bookings VALUES (99,'UNCHANGED','operational')"
      );
      await pool.execute(
        "CREATE TABLE payments (id int PRIMARY KEY,amount varchar(40))"
      );
      await pool.execute("INSERT INTO payments VALUES (99,'UNCHANGED')");
      const migration = fs.readFileSync(
        "drizzle/0188_majestic_greymalkin.sql",
        "utf8"
      );
      for (const statement of migration.split("--> statement-breakpoint"))
        await pool.query(statement);
    }, 30000);
    afterAll(async () => {
      await pool?.end();
    });
    it("persists four implemented-contract scenarios and exposes consistent reports via real tRPC", async () => {
      const { managementHqRouter } = await import("./management-hq-router");
      const caller = managementHqRouter.createCaller({
        user: actor,
        req: {},
        res: {},
      } as any);
      expect((await caller.status()).hasSample).toBe(false);
      expect(
        await caller.sample({ scenario: "initial", expectedVersion: null })
      ).toEqual({ stateVersion: 1 });
      const initial = await caller.report({ year: 2026, month: 1 });
      const sample = initial.bookings.find(b => b.id === "1")!;
      expect(sample.financials.gross).toBe("10000.00");
      expect(sample.seller).toBeNull();
      expect(sample.processor).toBeNull();
      expect(sample.currentOwner?.userId).toBe(101);
      expect(sample.assignedStaff?.userId).toBe(102);
      expect(sample.attributionState).toBe("provisional_current_owner");
      expect(
        await caller.sample({ scenario: "amended", expectedVersion: 1 })
      ).toEqual({ stateVersion: 2 });
      const amended = await caller.report({ year: 2026, month: 1 });
      expect(amended.bookings.find(b => b.id === "1")!.financials.gross).toBe(
        "11000.00"
      );
      expect(
        (await caller.report({ year: 2026, month: 4 })).bookings.some(
          b => b.id === "1"
        )
      ).toBe(false);
      expect((await caller.exportCsv({ year: 2026, month: 1 })).csv).toContain(
        "11000.00"
      );
      expect(
        await caller.sample({ scenario: "cancelled", expectedVersion: 2 })
      ).toEqual({ stateVersion: 3 });
      const cancelled = await caller.report({ year: 2026, month: 1 });
      const retained = cancelled.bookings.find(b => b.id === "1")!;
      expect(retained.status).toBe("cancelled");
      expect(retained.financials.gross).toBe("11000.00");
      expect(retained.cohort).toBe("cancelled");
      expect(cancelled.totals.bookingCount).toBe(0);
      expect(cancelled.totals.grossSales.knownSum).toBeNull();
      expect(
        await caller.sample({ scenario: "registered", expectedVersion: 3 })
      ).toEqual({ stateVersion: 4 });
      expect(
        (await caller.report({ year: 2026, month: 1 })).bookings
      ).toHaveLength(0);
      expect(
        (await caller.report({ year: 2026, month: 2 })).bookings[0]
          .reportingDate
      ).toBe("2026-02-03");
      const other = managementHqRouter.createCaller({
        user: { ...actor, id: 48 },
        req: {},
        res: {},
      } as any);
      expect((await other.status()).hasSample).toBe(false);
    });
    it("preserves newer generation on lost CAS and rejects fresh revoked admin without writes", async () => {
      const { managementHqRouter } = await import("./management-hq-router");
      const caller = managementHqRouter.createCaller({
        user: actor,
        req: {},
        res: {},
      } as any);
      await expect(
        caller.sample({ scenario: "initial", expectedVersion: 1 })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await caller.status()).stateVersion).toBe(4);
      await pool.execute("UPDATE users SET role='admin' WHERE id=47");
      await expect(caller.report({ year: 2026 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.sample({ scenario: "initial", expectedVersion: 4 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await pool.execute("UPDATE users SET role='super_admin' WHERE id=47");
      expect((await caller.status()).stateVersion).toBe(4);
    });
    it("has never mutated sentinel operational booking/payment data; removes its synthetic rows", async () => {
      const [bookings] = await pool.query<any[]>("SELECT * FROM bookings");
      const [payments] = await pool.query<any[]>("SELECT * FROM payments");
      expect(bookings).toEqual([
        { id: 99, grossCost: "UNCHANGED", currentStage: "operational" },
      ]);
      expect(payments).toEqual([{ id: 99, amount: "UNCHANGED" }]);
      for (const table of [
        "management_hq_datasets",
        "bookings",
        "payments",
        "users",
      ]) {
        await pool.execute(`DELETE FROM ${table}`);
        const [rows] = await pool.query<any[]>(
          `SELECT COUNT(*) AS n FROM ${table}`
        );
        expect(Number(rows[0].n)).toBe(0);
      }
    });
  }
);
