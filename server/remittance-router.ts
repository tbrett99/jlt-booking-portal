import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import {
  remittanceBatches,
  remittanceLines,
  bookings,
  users,
  commissionClaims,
} from "../drizzle/schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { sendDirectEmail } from "./email";
import { createInAppNotification } from "./db";
import { pushClaimStatusToOrbit } from "./orbit-sync";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNum(v: string | undefined | null): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function toDecimalStr(n: number): string {
  return n.toFixed(2);
}

type CsvRow = Record<string, string>;

// ─── Router ───────────────────────────────────────────────────────────────────

export const remittanceRouter = router({

  // ── Upload a new batch ──────────────────────────────────────────────────────
  uploadBatch: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      weekOf: z.string(), // ISO date string
      rows: z.array(z.record(z.string(), z.string())), // raw CSV rows as key-value objects
    }))
    .mutation(async ({ ctx, input }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Normalise column names — support both old PTS format and new JLT commissions format
      // Old: Client, Booking Reference, Return Date, Total IN, Total OUT, VAT, Remittance
      // New: Client Name, Booking Ref, Return Date, Total IN, Total OUT, VAT, Remit 80%
      const normaliseRow = (r: CsvRow): CsvRow => ({
        ...r,
        "Client": r["Client"] ?? r["Client Name"] ?? "",
        "Booking Reference": r["Booking Reference"] ?? r["Booking Ref"] ?? "",
        "Return Date": r["Return Date"] ?? "",
        "Total IN": r["Total IN"] ?? "",
        "Total OUT": r["Total OUT"] ?? "",
        "VAT": r["VAT"] ?? "",
        // New CSV has Remit 80% as the agent payout; old CSV has Remittance as total
        "Remittance": r["Remittance"] ?? r["Remit 80%"] ?? "",
        "Agent": r["Agent"] ?? "",
        "Email": r["Email"] ?? "",
      });

      // Filter out the Totals row and empty rows
      const dataRows = (input.rows as CsvRow[])
        .map(normaliseRow)
        .filter(
          (r) => r["Client"]?.toLowerCase() !== "totals" && r["Booking Reference"]?.trim()
        );

      if (dataRows.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No valid rows found in CSV" });
      }

      // Create the batch record first
      const [batchResult] = await db.insert(remittanceBatches).values({
        name: input.name,
        weekOf: new Date(input.weekOf),
        uploadedById: ctx.user.id,
        totalRemittance: "0",
        totalLines: 0,
        matchedLines: 0,
        unmatchedLines: 0,
      });
      const batchId = (batchResult as any).insertId as number;

      // Process each row: match to booking, look up agent, calculate splits
      let totalRemittance = 0;
      let matchedCount = 0;
      let unmatchedCount = 0;
      let processingFlagCount = 0;
      const lineValues: (typeof remittanceLines.$inferInsert & { _processingClaimId?: number })[] = [];

      for (const rawRow of dataRows) {
        const ref = (rawRow["Booking Reference"] ?? "").trim();
        const remittanceAmt = parseNum(rawRow["Remittance"]);
        totalRemittance += remittanceAmt;

        // Try to match booking: first by ptsRef, then by topdogRef (for JLT commissions CSV)
        let matchedBookingRows = await db
          .select({ id: bookings.id, agentId: bookings.agentId })
          .from(bookings)
          .where(eq(bookings.ptsRef, ref))
          .limit(1);

        if (matchedBookingRows.length === 0) {
          matchedBookingRows = await db
            .select({ id: bookings.id, agentId: bookings.agentId })
            .from(bookings)
            .where(eq(bookings.topdogRef, ref))
            .limit(1);
        }

        const ptsRef = ref;

        let bookingId: number | null = null;
        let agentId: number | null = null;
        let agentName: string | null = null;
        let agentEmail: string | null = null;
        let agentCommissionRate = 80; // default 80%, overridden per agent
        let isMatched = false;
        let processingClaimId: number | null = null;
        let vatFromPortalAmt: number | null = null;

        if (matchedBookingRows.length > 0) {
          const booking = matchedBookingRows[0];
          bookingId = booking.id;
          agentId = booking.agentId;
          isMatched = true;
          matchedCount++;

          // Look up agent details (including commission rate)
          const agentRows = await db
            .select({ name: users.name, email: users.email, commissionRatePct: users.commissionRatePct })
            .from(users)
            .where(eq(users.id, agentId))
            .limit(1);
          if (agentRows.length > 0) {
            agentName = agentRows[0].name ?? null;
            agentEmail = agentRows[0].email ?? null;
            agentCommissionRate = agentRows[0].commissionRatePct ?? 80;
          }

          // Check for awaiting_payment claim → auto-advance to paid (normal flow)
          const awaitingClaims = await db
            .select({ id: commissionClaims.id, vatAmount: commissionClaims.vatAmount })
            .from(commissionClaims)
            .where(
              and(
                eq(commissionClaims.bookingId, bookingId),
                eq(commissionClaims.status, "awaiting_payment")
              )
            )
            .limit(1);

          if (awaitingClaims.length > 0) {
            // Capture portal VAT from the claim
            const claimVat = awaitingClaims[0].vatAmount;
            if (claimVat !== null && claimVat !== undefined) {
              vatFromPortalAmt = parseFloat(String(claimVat));
            }
          } else {
            // Check if there's a processing claim — flag for admin review
            const processingClaims = await db
              .select({ id: commissionClaims.id, vatAmount: commissionClaims.vatAmount })
              .from(commissionClaims)
              .where(
                and(
                  eq(commissionClaims.bookingId, bookingId),
                  eq(commissionClaims.status, "processing")
                )
              )
              .limit(1);

            if (processingClaims.length > 0) {
              processingClaimId = processingClaims[0].id;
              processingFlagCount++;
              // Still capture VAT from processing claim
              const claimVat = processingClaims[0].vatAmount;
              if (claimVat !== null && claimVat !== undefined) {
                vatFromPortalAmt = parseFloat(String(claimVat));
              }
            } else {
              // Fallback: claim may already be 'paid' (e.g. re-upload of a batch).
              // VAT amount doesn't change after payment, so it's safe to read it.
              const paidClaims = await db
                .select({ id: commissionClaims.id, vatAmount: commissionClaims.vatAmount })
                .from(commissionClaims)
                .where(
                  and(
                    eq(commissionClaims.bookingId, bookingId),
                    eq(commissionClaims.status, "paid")
                  )
                )
                .limit(1);
              if (paidClaims.length > 0) {
                const claimVat = paidClaims[0].vatAmount;
                if (claimVat !== null && claimVat !== undefined) {
                  vatFromPortalAmt = parseFloat(String(claimVat));
                }
              }
            }
          }
        } else {
          unmatchedCount++;
        }

        // Calculate agent/JLT split — deduct VAT from remittance first
        const vatAmt = parseNum(rawRow["VAT"]);
        // Use vatFromPortal (from claim) if available, otherwise use VAT from PTS CSV
        const effectiveVat = vatFromPortalAmt !== null ? vatFromPortalAmt : (vatAmt > 0 ? vatAmt : 0);
        const netRemittance = Math.max(0, remittanceAmt - effectiveVat);
        const agentRate = agentCommissionRate / 100;
        const remit80 = parseFloat((netRemittance * agentRate).toFixed(2));
        const jlt20 = parseFloat((netRemittance * (1 - agentRate)).toFixed(2));

        lineValues.push({
          batchId,
          clientName: rawRow["Client"] ?? "",
          ptsRef: ref,
          returnDate: rawRow["Return Date"] ?? null,
          pax: rawRow["PAX"] ? parseInt(rawRow["PAX"]) || null : null,
          currency: rawRow["Currency"] ?? "GBP",
          totalIn: rawRow["Total IN"] ? toDecimalStr(parseNum(rawRow["Total IN"])) : null,
          totalOut: rawRow["Total OUT"] ? toDecimalStr(parseNum(rawRow["Total OUT"])) : null,
          sfi: rawRow["SFI"] ? toDecimalStr(parseNum(rawRow["SFI"])) : null,
          safi: rawRow["SAFI"] ? toDecimalStr(parseNum(rawRow["SAFI"])) : null,
          ptrc: rawRow["PTRC"] ? toDecimalStr(parseNum(rawRow["PTRC"])) : null,
          pts: rawRow["PTS"] ? toDecimalStr(parseNum(rawRow["PTS"])) : null,
          vatFromPts: vatAmt > 0 ? toDecimalStr(vatAmt) : null,
          remittance: toDecimalStr(remittanceAmt),
          vatFromPortal: vatFromPortalAmt !== null ? toDecimalStr(vatFromPortalAmt) : null,
          remit80: toDecimalStr(remit80),
          jlt20: toDecimalStr(jlt20),
          bookingId,
          agentId,
          agentName: agentName ?? (rawRow["Agent"]?.trim() || null),
          agentEmail: agentEmail ?? (rawRow["Email"]?.trim() || null),
          isMatched,
          pushedToAgent: false,
          processingClaimId,
        });
      }

      // Insert all lines one by one to capture insertIds for claim linking
      for (let i = 0; i < lineValues.length; i++) {
        const lineVal = lineValues[i];
        const [lineResult] = await db.insert(remittanceLines).values(lineVal);
        const lineId = (lineResult as any).insertId as number;

        // If matched and has awaiting_payment claim → advance to "paid" and write VAT from CSV
        if (lineVal.bookingId && lineVal.isMatched && !lineVal.processingClaimId) {
          const vatFromCsvStr = lineVal.vatFromPts ?? null;
          await db
            .update(commissionClaims)
            .set({
              status: "paid",
              remittanceLineId: lineId,
              paidAt: new Date(),
              ...(vatFromCsvStr !== null ? { vatAmount: vatFromCsvStr } : {}),
            })
            .where(
              and(
                eq(commissionClaims.bookingId, lineVal.bookingId),
                eq(commissionClaims.status, "awaiting_payment")
              )
            );
          // Notify Orbit (fire-and-forget)
          pushClaimStatusToOrbit(lineVal.bookingId).catch(() => {});
        }
      }

      // Update batch summary
      await db
        .update(remittanceBatches)
        .set({
          totalRemittance: toDecimalStr(totalRemittance),
          totalLines: dataRows.length,
          matchedLines: matchedCount,
          unmatchedLines: unmatchedCount,
        })
        .where(eq(remittanceBatches.id, batchId));

      return { batchId, totalLines: dataRows.length, matchedCount, unmatchedCount, processingFlagCount };
    }),

  // ── List all batches ────────────────────────────────────────────────────────
  getBatches: protectedProcedure.query(async ({ ctx }) => {
    if (!["admin", "super_admin"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const db = await getDb();
    if (!db) return [];
    const batches = await db
      .select()
      .from(remittanceBatches)
      .orderBy(remittanceBatches.weekOf);
    return batches.reverse();
  }),

  // ── Get lines for Janine's View ─────────────────────────────────────────────
  getJaninesView: protectedProcedure
    .input(z.object({ batchId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) return [];

      const lines = input.batchId
        ? await db.select().from(remittanceLines).where(eq(remittanceLines.batchId, input.batchId))
        : await db.select().from(remittanceLines);

      const sortedLines = [...lines].sort((a, b) =>
        (a.agentName ?? "").localeCompare(b.agentName ?? "") ||
        (a.clientName ?? "").localeCompare(b.clientName ?? "")
      );

      // Attach batch names
      const batchIds = Array.from(new Set(sortedLines.map((l) => l.batchId)));
      const batches = batchIds.length > 0
        ? await db.select({ id: remittanceBatches.id, name: remittanceBatches.name, weekOf: remittanceBatches.weekOf })
            .from(remittanceBatches)
            .where(inArray(remittanceBatches.id, batchIds))
        : [];
      const batchMap: Record<number, { name: string; weekOf: Date | null }> = {};
      for (const b of batches) batchMap[b.id] = { name: b.name, weekOf: b.weekOf };

      // Attach bookingType from commission_claims for matched lines
      const matchedBookingIds = sortedLines.filter((l) => l.bookingId).map((l) => l.bookingId as number);
      const claimRows = matchedBookingIds.length > 0
        ? await db
            .select({ bookingId: commissionClaims.bookingId, bookingType: commissionClaims.bookingType, status: commissionClaims.status })
            .from(commissionClaims)
            .where(inArray(commissionClaims.bookingId, matchedBookingIds))
        : [];
      const claimMap: Record<number, { bookingType: string; status: string }> = {};
      for (const c of claimRows) claimMap[c.bookingId] = { bookingType: c.bookingType, status: c.status };

      const result = sortedLines.map((l) => ({
        ...l,
        batchName: batchMap[l.batchId]?.name ?? "",
        weekOf: batchMap[l.batchId]?.weekOf ?? null,
        bookingType: l.bookingId ? (claimMap[l.bookingId]?.bookingType ?? null) : null,
        claimStatus: l.bookingId ? (claimMap[l.bookingId]?.status ?? null) : null,
      }));
      return result;
    }),

  // ── Get Agent View (matched lines grouped by agent) ─────────────────────────
  getAgentView: protectedProcedure
    .input(z.object({ batchId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) return [];

      const lines = input.batchId
        ? await db.select().from(remittanceLines).where(
            and(eq(remittanceLines.batchId, input.batchId), eq(remittanceLines.isMatched, true))
          )
        : await db.select().from(remittanceLines).where(eq(remittanceLines.isMatched, true));

      // Attach batch names
      const batchIds = Array.from(new Set(lines.map((l) => l.batchId)));
      const batches = batchIds.length > 0
        ? await db.select({ id: remittanceBatches.id, name: remittanceBatches.name, weekOf: remittanceBatches.weekOf })
            .from(remittanceBatches)
            .where(inArray(remittanceBatches.id, batchIds))
        : [];
      const batchMap: Record<number, { name: string; weekOf: Date | null }> = {};
      for (const b of batches) batchMap[b.id] = { name: b.name, weekOf: b.weekOf };

      // Group by agent
      const agentMap: Record<string, {
        agentId: number | null;
        agentName: string;
        agentEmail: string;
        totalRemit80: number;
        bankAccountName: string | null;
        bankSortCode: string | null;
        bankAccountNumber: string | null;
        lines: Array<typeof lines[0] & { batchName: string; weekOf: Date | null }>;
      }> = {};

      for (const line of lines) {
        const key = line.agentEmail ?? line.agentName ?? "unknown";
        if (!agentMap[key]) {
          agentMap[key] = {
            agentId: line.agentId,
            agentName: line.agentName ?? "Unknown Agent",
            agentEmail: line.agentEmail ?? "",
            totalRemit80: 0,
            bankAccountName: null,
            bankSortCode: null,
            bankAccountNumber: null,
            lines: [],
          };
        }
        agentMap[key].totalRemit80 = parseFloat(
          (agentMap[key].totalRemit80 + parseFloat(line.remit80 ?? "0")).toFixed(2)
        );
        agentMap[key].lines.push({
          ...line,
          batchName: batchMap[line.batchId]?.name ?? "",
          weekOf: batchMap[line.batchId]?.weekOf ?? null,
        });
      }

      // Fetch and decrypt bank details for all matched agents
      const agentEntries = Object.values(agentMap);
      const agentUserIds = agentEntries.map((a) => a.agentId).filter((id): id is number => id !== null);
      if (agentUserIds.length > 0) {
        const { agentCrmProfiles } = await import("../drizzle/schema");
        const { inArray: inArrayOp } = await import("drizzle-orm");
        const { decryptAgentBankDetails } = await import("./agent-crm-db");
        const profiles = await db
          .select({ userId: agentCrmProfiles.userId, bankAccountName: agentCrmProfiles.bankAccountName, bankSortCode: agentCrmProfiles.bankSortCode, bankAccountNumber: agentCrmProfiles.bankAccountNumber })
          .from(agentCrmProfiles)
          .where(inArrayOp(agentCrmProfiles.userId, agentUserIds));
        const bankMap = new Map<number, { bankAccountName: string | null; bankSortCode: string | null; bankAccountNumber: string | null }>();
        for (const p of profiles) {
          const dec = await decryptAgentBankDetails(p as any);
          bankMap.set(p.userId, { bankAccountName: dec.bankAccountName ?? null, bankSortCode: dec.bankSortCode ?? null, bankAccountNumber: dec.bankAccountNumber ?? null });
        }
        for (const agent of agentEntries) {
          if (agent.agentId !== null && bankMap.has(agent.agentId)) {
            const b = bankMap.get(agent.agentId)!;
            agent.bankAccountName = b.bankAccountName;
            agent.bankSortCode = b.bankSortCode;
            agent.bankAccountNumber = b.bankAccountNumber;
          }
        }
      }

      return Object.values(agentMap).sort((a, b) => a.agentName.localeCompare(b.agentName));
    }),

  // ── Get lines flagged as 'Needs Review' (processing claim) ─────────────────
  getNeedsReview: protectedProcedure
    .input(z.object({ batchId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) return [];

      const lines = input.batchId
        ? await db.select().from(remittanceLines).where(
            and(
              eq(remittanceLines.batchId, input.batchId),
              isNotNull(remittanceLines.processingClaimId)
            )
          )
        : await db.select().from(remittanceLines).where(
            isNotNull(remittanceLines.processingClaimId)
          );

      if (lines.length === 0) return [];

      // Attach batch names
      const batchIds = Array.from(new Set(lines.map((l) => l.batchId)));
      const batches = batchIds.length > 0
        ? await db.select({ id: remittanceBatches.id, name: remittanceBatches.name, weekOf: remittanceBatches.weekOf })
            .from(remittanceBatches)
            .where(inArray(remittanceBatches.id, batchIds))
        : [];
      const batchMap: Record<number, { name: string; weekOf: Date | null }> = {};
      for (const b of batches) batchMap[b.id] = { name: b.name, weekOf: b.weekOf };

      // Attach claim details
      const claimIds = lines.map((l) => l.processingClaimId as number);
      const claims = claimIds.length > 0
        ? await db
            .select({
              id: commissionClaims.id,
              bookingId: commissionClaims.bookingId,
              status: commissionClaims.status,
              bookingType: commissionClaims.bookingType,
              claimedAt: commissionClaims.claimedAt,
            })
            .from(commissionClaims)
            .where(inArray(commissionClaims.id, claimIds))
        : [];
      const claimMap: Record<number, typeof claims[0]> = {};
      for (const c of claims) claimMap[c.id] = c;

      return lines.map((l) => ({
        ...l,
        batchName: batchMap[l.batchId]?.name ?? "",
        weekOf: batchMap[l.batchId]?.weekOf ?? null,
        claim: l.processingClaimId ? (claimMap[l.processingClaimId] ?? null) : null,
      }));
    }),

  // ── Approve a processing-flagged line: advance claim processing → paid ──────
  approveProcessingClaim: protectedProcedure
    .input(z.object({ lineId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Get the line
      const lineRows = await db
        .select()
        .from(remittanceLines)
        .where(eq(remittanceLines.id, input.lineId))
        .limit(1);
      if (lineRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Line not found" });
      const line = lineRows[0];

      if (!line.processingClaimId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This line has no processing claim to approve" });
      }

      // Advance claim: processing → awaiting_payment → paid (in one step, since admin is approving)
      await db
        .update(commissionClaims)
        .set({
          status: "paid",
          remittanceLineId: input.lineId,
          paidAt: new Date(),
        })
        .where(eq(commissionClaims.id, line.processingClaimId));
      // Notify Orbit (fire-and-forget)
      if (line.bookingId) pushClaimStatusToOrbit(line.bookingId).catch(() => {});

      // Clear the flag on the line
      await db
        .update(remittanceLines)
        .set({ processingClaimId: null })
        .where(eq(remittanceLines.id, input.lineId));

      return { ok: true };
    }),

  // ── Update admin notes on a line ────────────────────────────────────────────
  updateLineNotes: protectedProcedure
    .input(z.object({ lineId: z.number(), notes: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(remittanceLines)
        .set({ adminNotes: input.notes })
        .where(eq(remittanceLines.id, input.lineId));
      return { ok: true };
    }),

  // ── Update VAT on a line and recalculate 80/20 split ─────────────────────────
  updateLineVat: protectedProcedure
    .input(z.object({ lineId: z.number(), vat: z.number().nullable() }))
    .mutation(async ({ ctx, input }) => {
      if (!['admin', 'super_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const lineRows = await db
        .select({ remittance: remittanceLines.remittance, vatFromPts: remittanceLines.vatFromPts, agentId: remittanceLines.agentId })
        .from(remittanceLines)
        .where(eq(remittanceLines.id, input.lineId))
        .limit(1);
      if (lineRows.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });

      // Look up agent commission rate
      let agentCommissionRate = 80;
      if (lineRows[0].agentId) {
        const agentRateRows = await db
          .select({ commissionRatePct: users.commissionRatePct })
          .from(users)
          .where(eq(users.id, lineRows[0].agentId))
          .limit(1);
        if (agentRateRows.length > 0) agentCommissionRate = agentRateRows[0].commissionRatePct ?? 80;
      }

      const remittanceAmt = parseNum(lineRows[0].remittance);
      const vatPts = lineRows[0].vatFromPts ? parseNum(lineRows[0].vatFromPts) : 0;
      const effectiveVat = input.vat !== null ? input.vat : vatPts;
      const netRemittance = Math.max(0, remittanceAmt - effectiveVat);
      const agentRate = agentCommissionRate / 100;
      const remit80 = (netRemittance * agentRate).toFixed(2);
      const jlt20 = (netRemittance * (1 - agentRate)).toFixed(2);

      await db
        .update(remittanceLines)
        .set({
          vatFromPortal: input.vat !== null ? input.vat.toFixed(2) : null,
          remit80,
          jlt20,
        })
        .where(eq(remittanceLines.id, input.lineId));

      return { ok: true, remit80: parseFloat(remit80), jlt20: parseFloat(jlt20) };
    }),

  // ── Manually match an unmatched line to a booking ───────────────────────────
  matchLine: protectedProcedure
    .input(z.object({ lineId: z.number(), bookingId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const bookingRows = await db
        .select({ id: bookings.id, agentId: bookings.agentId })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);
      if (bookingRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
      }
      const booking = bookingRows[0];
      const agentRows = await db
        .select({ name: users.name, email: users.email, commissionRatePct: users.commissionRatePct })
        .from(users)
        .where(eq(users.id, booking.agentId))
        .limit(1);
      const agent = agentRows[0] ?? { name: null, email: null, commissionRatePct: 80 };
      const matchLineAgentRate = (agent.commissionRatePct ?? 80) / 100;

      // Check claim status on this booking
      let processingClaimId: number | null = null;
      let vatFromPortal: string | null = null;

      // First: read any VAT the admin already entered on this line — we must not overwrite it
      const existingLineRows = await db
        .select({ vatFromPortal: remittanceLines.vatFromPortal })
        .from(remittanceLines)
        .where(eq(remittanceLines.id, input.lineId))
        .limit(1);
      const existingLineVat = existingLineRows.length > 0 && existingLineRows[0].vatFromPortal !== null
        ? existingLineRows[0].vatFromPortal
        : null;

      // Try awaiting_payment first
      const awaitingClaims = await db
        .select({ id: commissionClaims.id, vatAmount: commissionClaims.vatAmount })
        .from(commissionClaims)
        .where(and(eq(commissionClaims.bookingId, booking.id), eq(commissionClaims.status, "awaiting_payment")))
        .limit(1);

      if (awaitingClaims.length > 0) {
        const v = awaitingClaims[0].vatAmount;
        if (v !== null && v !== undefined) vatFromPortal = parseFloat(String(v)).toFixed(2);
      } else {
        // Check for processing claim
        const processingClaims = await db
          .select({ id: commissionClaims.id, vatAmount: commissionClaims.vatAmount })
          .from(commissionClaims)
          .where(and(eq(commissionClaims.bookingId, booking.id), eq(commissionClaims.status, "processing")))
          .limit(1);
        if (processingClaims.length > 0) {
          processingClaimId = processingClaims[0].id;
          const v = processingClaims[0].vatAmount;
          if (v !== null && v !== undefined) vatFromPortal = parseFloat(String(v)).toFixed(2);
        }
      }

      // Preserve the admin-entered VAT on the line if no claim VAT was found
      if (vatFromPortal === null && existingLineVat !== null) {
        vatFromPortal = existingLineVat;
      }

      // Recalculate remit80/jlt20 using vatFromPortal if available
      const lineForCalc = await db
        .select({ remittance: remittanceLines.remittance, vatFromPts: remittanceLines.vatFromPts })
        .from(remittanceLines)
        .where(eq(remittanceLines.id, input.lineId))
        .limit(1);
      let recalcRemit80: string | undefined;
      let recalcJlt20: string | undefined;
      if (lineForCalc.length > 0) {
        const remittanceAmt = parseNum(lineForCalc[0].remittance);
        const vatPortal = vatFromPortal !== null ? parseFloat(vatFromPortal) : null;
        const vatPts = lineForCalc[0].vatFromPts ? parseNum(lineForCalc[0].vatFromPts) : 0;
        const effectiveVat = vatPortal !== null ? vatPortal : vatPts;
        const netRemittance = Math.max(0, remittanceAmt - effectiveVat);
        recalcRemit80 = netRemittance > 0 ? (netRemittance * matchLineAgentRate).toFixed(2) : undefined;
        recalcJlt20 = netRemittance > 0 ? (netRemittance * (1 - matchLineAgentRate)).toFixed(2) : undefined;
      }

      await db
        .update(remittanceLines)
        .set({
          bookingId: booking.id,
          agentId: booking.agentId,
          agentName: agent.name ?? null,
          agentEmail: agent.email ?? null,
          isMatched: true,
          processingClaimId,
          vatFromPortal,
          ...(recalcRemit80 !== undefined ? { remit80: recalcRemit80, jlt20: recalcJlt20 } : {}),
        })
        .where(eq(remittanceLines.id, input.lineId));

      // Advance awaiting_payment claim to "paid" (only if no processing flag)
      if (!processingClaimId) {
        await db
          .update(commissionClaims)
          .set({ status: "paid", remittanceLineId: input.lineId, paidAt: new Date() })
          .where(
            and(
              eq(commissionClaims.bookingId, booking.id),
              eq(commissionClaims.status, "awaiting_payment")
            )
          );
        // Notify Orbit (fire-and-forget)
        pushClaimStatusToOrbit(booking.id).catch(() => {});
      }

      // Update batch counts
      const lineRows = await db
        .select({ batchId: remittanceLines.batchId })
        .from(remittanceLines)
        .where(eq(remittanceLines.id, input.lineId))
        .limit(1);
      if (lineRows.length > 0) {
        const batchId = lineRows[0].batchId;
        const allLines = await db
          .select({ isMatched: remittanceLines.isMatched })
          .from(remittanceLines)
          .where(eq(remittanceLines.batchId, batchId));
        const matched = allLines.filter((l) => l.isMatched).length;
        await db
          .update(remittanceBatches)
          .set({ matchedLines: matched, unmatchedLines: allLines.length - matched })
          .where(eq(remittanceBatches.id, batchId));
      }

      return { ok: true, needsReview: processingClaimId !== null };
    }),

  // ── Push remittances to agents ──────────────────────────────────────────────
  pushToAgents: protectedProcedure
    .input(z.object({ batchId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const lines = await db
        .select()
        .from(remittanceLines)
        .where(
          and(
            eq(remittanceLines.batchId, input.batchId),
            eq(remittanceLines.isMatched, true),
            eq(remittanceLines.pushedToAgent, false)
          )
        );

      if (lines.length === 0) {
        return { pushed: 0, message: "No unpushed matched lines found" };
      }

      const batchRows = await db
        .select()
        .from(remittanceBatches)
        .where(eq(remittanceBatches.id, input.batchId))
        .limit(1);
      const batch = batchRows[0];

      // Group by agent
      const agentGroups: Record<number, typeof lines> = {};
      for (const line of lines) {
        if (!line.agentId) continue;
        if (!agentGroups[line.agentId]) agentGroups[line.agentId] = [];
        agentGroups[line.agentId].push(line);
      }

      let pushedCount = 0;
      for (const [agentIdStr, agentLines] of Object.entries(agentGroups)) {
        const agentId = parseInt(agentIdStr);
        const totalRemit80 = agentLines.reduce(
          (sum, l) => sum + parseFloat(l.remit80 ?? "0"),
          0
        );
        const agentName = agentLines[0].agentName ?? "Agent";
        const agentEmail = agentLines[0].agentEmail ?? "";

        const bookingList = agentLines
          .map((l) => `• ${l.clientName} (${l.ptsRef}) — £${parseFloat(l.remit80 ?? "0").toFixed(2)}`)
          .join("\n");

        const notifContent = `Your commission remittance for ${batch?.name ?? "this week"} has been processed.\n\nTotal: £${totalRemit80.toFixed(2)}\n\n${bookingList}\n\nThis will be included in your next payment run.`;

        try {
          await createInAppNotification({
            userId: agentId,
            message: notifContent,
          });
        } catch (_) {}

        if (agentEmail) {
          try {
            await sendDirectEmail({
              toEmail: agentEmail,
              toName: agentName,
              subject: `JLT Group — Commission Remittance ${batch?.name ?? ""}`,
              html: `<p>Hi ${agentName},</p><p>${notifContent.replace(/\n/g, "<br>")}</p><p>If you have any questions, please contact <a href="mailto:memberships@thejltgroup.co.uk">memberships@thejltgroup.co.uk</a></p><p>The JLT Group Team</p>`,
            });
          } catch (_) {}
        }

        pushedCount += agentLines.length;
      }

      // Mark lines as pushed
      const lineIds = lines.filter((l) => l.agentId).map((l) => l.id);
      if (lineIds.length > 0) {
        await db
          .update(remittanceLines)
          .set({ pushedToAgent: true, pushedAt: new Date() })
          .where(inArray(remittanceLines.id, lineIds));
      }

      await db
        .update(remittanceBatches)
        .set({ pushedToAgentsAt: new Date() })
        .where(eq(remittanceBatches.id, input.batchId));

      return { pushed: pushedCount };
    }),

  // ── Agent: get my remittances ───────────────────────────────────────────────
  getMyRemittances: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const lines = await db
      .select()
      .from(remittanceLines)
      .where(
        and(
          eq(remittanceLines.agentId, ctx.user.id),
          eq(remittanceLines.pushedToAgent, true)
        )
      );

    const sortedLines = [...lines].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const batchIds = Array.from(new Set(sortedLines.map((l) => l.batchId)));
    const batches = batchIds.length > 0
      ? await db.select({ id: remittanceBatches.id, name: remittanceBatches.name, weekOf: remittanceBatches.weekOf })
          .from(remittanceBatches)
          .where(inArray(remittanceBatches.id, batchIds))
      : [];
    const batchMap: Record<number, { name: string; weekOf: Date | null }> = {};
    for (const b of batches) batchMap[b.id] = { name: b.name, weekOf: b.weekOf };

    return sortedLines.map((l) => ({
      ...l,
      batchName: batchMap[l.batchId]?.name ?? "",
      weekOf: batchMap[l.batchId]?.weekOf ?? null,
    }));
  }),

  // ── Mark all claims in a batch as paid + push remittances to agents ──────────
  markBatchPaid: protectedProcedure
    .input(z.object({ batchId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!['admin', 'super_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      // Fetch all matched lines in this batch
      const lines = await db
        .select()
        .from(remittanceLines)
        .where(
          and(
            eq(remittanceLines.batchId, input.batchId),
            eq(remittanceLines.isMatched, true)
          )
        );

      const batchRows = await db
        .select()
        .from(remittanceBatches)
        .where(eq(remittanceBatches.id, input.batchId))
        .limit(1);
      const batch = batchRows[0];

      let paidCount = 0;
      let pushedCount = 0;
      const now = new Date();

      // For each matched line: advance commission claim to paid, set VAT from CSV
      for (const line of lines) {
        if (!line.bookingId) continue;

        // Update VAT on commission claim from CSV value if present
        const vatFromCsv = line.vatFromPts ? parseFloat(String(line.vatFromPts)) : null;

        // Advance processing or awaiting_payment claim to paid, and set VAT from CSV
        await db
          .update(commissionClaims)
          .set({
            status: 'paid',
            paidAt: now,
            remittanceLineId: line.id,
            ...(vatFromCsv !== null ? { vatAmount: toDecimalStr(vatFromCsv) } : {}),
          })
          .where(
            and(
              eq(commissionClaims.bookingId, line.bookingId),
              inArray(commissionClaims.status, ['processing', 'awaiting_payment'])
            )
          );
        // Notify Orbit (fire-and-forget)
        pushClaimStatusToOrbit(line.bookingId).catch(() => {});
        paidCount++;
      }

      // Push remittances to agents (send notifications + emails)
      const unpushedLines = lines.filter((l) => !l.pushedToAgent && l.agentId);
      const agentGroups: Record<number, typeof lines> = {};
      for (const line of unpushedLines) {
        if (!line.agentId) continue;
        if (!agentGroups[line.agentId]) agentGroups[line.agentId] = [];
        agentGroups[line.agentId].push(line);
      }

      for (const [agentIdStr, agentLines] of Object.entries(agentGroups)) {
        const agentId = parseInt(agentIdStr);
        const totalRemit80 = agentLines.reduce((sum, l) => sum + parseFloat(l.remit80 ?? '0'), 0);
        const agentName = agentLines[0].agentName ?? 'Agent';
        const agentEmail = agentLines[0].agentEmail ?? '';
        const bookingList = agentLines
          .map((l) => `• ${l.clientName} (${l.ptsRef}) — £${parseFloat(l.remit80 ?? '0').toFixed(2)}`)
          .join('\n');
        const notifContent = `Your commission payment for ${batch?.name ?? 'this week'} has been processed and marked as paid.\n\nTotal: £${totalRemit80.toFixed(2)}\n\n${bookingList}\n\nPlease contact memberships@thejltgroup.co.uk if you have any questions.`;
        try {
          await createInAppNotification({ userId: agentId, message: notifContent });
        } catch (_) {}
        if (agentEmail) {
          try {
            await sendDirectEmail({
              toEmail: agentEmail,
              toName: agentName,
              subject: `JLT Group — Commission Payment ${batch?.name ?? ''}`,
              html: `<p>Hi ${agentName},</p><p>${notifContent.replace(/\n/g, '<br>')}</p><p>The JLT Group Team</p>`,
            });
          } catch (_) {}
        }
        pushedCount += agentLines.length;
      }

      // Mark all matched lines as pushed
      const lineIds = unpushedLines.map((l) => l.id);
      if (lineIds.length > 0) {
        await db
          .update(remittanceLines)
          .set({ pushedToAgent: true, pushedAt: now })
          .where(inArray(remittanceLines.id, lineIds));
      }
      await db
        .update(remittanceBatches)
        .set({ pushedToAgentsAt: now })
        .where(eq(remittanceBatches.id, input.batchId));

      return { paidCount, pushedCount };
    }),

  // ── Delete a batch (super_admin only) ───────────────────────────────────────
  deleteBatch: protectedProcedure
    .input(z.object({ batchId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(remittanceLines).where(eq(remittanceLines.batchId, input.batchId));
      await db.delete(remittanceBatches).where(eq(remittanceBatches.id, input.batchId));
      return { ok: true };
    }),
});
