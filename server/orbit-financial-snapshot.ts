import { z } from "zod";

const money = z.number()
  .finite()
  .nonnegative()
  .max(9_999_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, "Money values must have no more than two decimal places")
  .nullable();

/**
 * Validates Orbit's full, current financial snapshot for an existing Portal
 * booking. This is intentionally separate from the legacy commission update
 * shape so existing callers remain compatible during the staged rollout.
 */
export const orbitFinancialSnapshotSchema = z.object({
  crmRef: z.string().trim().min(1).max(100),
  bookingId: z.number().int().positive().optional(),
  currency: z.literal("GBP"),
  grossBookingValue: money,
  totalNetCost: money,
  netCostSubtotal: money,
  netCostStatus: z.enum(["complete", "incomplete", "unavailable"]),
  missingNetCostProducts: z.number().int().nonnegative(),
  grossMargin: money,
  marginPct: money,
  expectedCommission: money,
  financialRevision: z.string().regex(/^[a-f0-9]{64}$/i, "financialRevision must be a 64-character hexadecimal string"),
  financialSnapshotAt: z.string().datetime({ offset: true }),
}).superRefine((snapshot, ctx) => {
  if (snapshot.netCostStatus === "complete") {
    if (snapshot.totalNetCost === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalNetCost"], message: "A complete snapshot requires totalNetCost." });
    }
    if (snapshot.missingNetCostProducts !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["missingNetCostProducts"], message: "A complete snapshot cannot have missing net-cost products." });
    }
    return;
  }

  if (snapshot.netCostStatus === "incomplete") {
    if (snapshot.totalNetCost !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalNetCost"], message: "An incomplete snapshot must not provide a full totalNetCost." });
    }
    if (snapshot.netCostSubtotal === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["netCostSubtotal"], message: "An incomplete snapshot requires netCostSubtotal." });
    }
    if (snapshot.missingNetCostProducts < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["missingNetCostProducts"], message: "An incomplete snapshot requires at least one missing net-cost product." });
    }
    for (const field of ["grossMargin", "marginPct", "expectedCommission"] as const) {
      if (snapshot[field] !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "An incomplete snapshot must not provide a complete financial result." });
      }
    }
    return;
  }

  for (const field of ["totalNetCost", "netCostSubtotal", "grossMargin", "marginPct", "expectedCommission"] as const) {
    if (snapshot[field] !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "An unavailable snapshot must not provide financial comparison values." });
    }
  }
});

export type OrbitFinancialSnapshotPayload = z.infer<typeof orbitFinancialSnapshotSchema>;

export function isOrbitFinancialSnapshotPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const value = payload as Record<string, unknown>;
  return "financialRevision" in value || "financialSnapshotAt" in value || "netCostStatus" in value;
}

/** Never reflect received financial values into integration error responses. */
export function toSafeFinancialSnapshotIssues(issues: readonly z.ZodIssue[]) {
  return issues.slice(0, 8).map((issue) => ({
    path: issue.path.map(String).join(".") || "payload",
    code: issue.code,
    message: issue.code === "invalid_type"
      ? "Invalid field type."
      : issue.code === "too_small"
        ? "A required value is missing."
        : issue.code === "too_big"
          ? "Value exceeds the supported limit."
          : "Value does not meet the financial snapshot contract.",
  }));
}
