// ─── Membership Tiers & Pricing ──────────────────────────────────────────────
// All amounts in pence (GBP)

export const MEMBERSHIP_TIERS = ["business_class", "first_class"] as const;
export type MembershipTier = (typeof MEMBERSHIP_TIERS)[number];

export const MEMBERSHIP_TYPES = ["solo", "duo", "trio"] as const;
export type MembershipType = (typeof MEMBERSHIP_TYPES)[number];

export const PAYMENT_DAYS = [1, 15, 28] as const;
export type PaymentDay = (typeof PAYMENT_DAYS)[number];

// Joining fee — same for all tiers and types
// Set to 100 (£1) for testing; change to 29700 (£297) for live
export const JOINING_FEE_PENCE = 100; // £1 test — change to 29700 for live

// Monthly subscription amounts in pence
export const MONTHLY_AMOUNTS: Record<MembershipTier, Record<MembershipType, number>> = {
  business_class: {
    solo: 8700,   // £87/month
    duo: 12700,   // £127/month
    trio: 16700,  // £167/month
  },
  first_class: {
    solo: 12700,  // £127/month
    duo: 16700,   // £167/month
    trio: 20700,  // £207/month
  },
};

// Joining fee amounts (same for all tiers, varies by type)
// NOTE: Currently all the same; kept separate for future flexibility
export const JOINING_FEES: Record<MembershipType, number> = {
  solo: JOINING_FEE_PENCE,
  duo: JOINING_FEE_PENCE,
  trio: JOINING_FEE_PENCE,
};

// Human-readable labels
export const TIER_LABELS: Record<MembershipTier, string> = {
  business_class: "Business Class",
  first_class: "First Class",
};

export const TYPE_LABELS: Record<MembershipType, string> = {
  solo: "Solo",
  duo: "Duo (2 agents)",
  trio: "Trio (3 agents)",
};

export const MEMBER_COUNTS: Record<MembershipType, number> = {
  solo: 1,
  duo: 2,
  trio: 3,
};

// Helper: get monthly amount for a tier/type combination
export function getMonthlyAmount(tier: MembershipTier, type: MembershipType): number {
  return MONTHLY_AMOUNTS[tier][type];
}

// Helper: get joining fee for a membership type
export function getJoiningFee(_type: MembershipType): number {
  return JOINING_FEE_PENCE;
}

// Helper: format pence as £ string
export function formatPounds(pence: number): string {
  return `£${(pence / 100).toFixed(2).replace(/\.00$/, "")}`;
}
