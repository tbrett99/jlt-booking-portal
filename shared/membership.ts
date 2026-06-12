// ─── Membership Tiers & Pricing ──────────────────────────────────────────────
// All amounts in pence (GBP)

export const MEMBERSHIP_TIERS = ["business_class", "first_class"] as const;
export type MembershipTier = (typeof MEMBERSHIP_TIERS)[number];

export const MEMBERSHIP_TYPES = ["solo", "duo", "trio"] as const;
export type MembershipType = (typeof MEMBERSHIP_TYPES)[number];

export const PAYMENT_DAYS = [1, 15, 28] as const;
export type PaymentDay = (typeof PAYMENT_DAYS)[number];

// Joining fee — varies by membership type
export const JOINING_FEE_PENCE = 69700; // £697 (solo) — updated price

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

// Joining fee amounts — vary by membership type (updated Jun 2026)
export const JOINING_FEES: Record<MembershipType, number> = {
  solo: 69700,  // £697
  duo: 99700,   // £997
  trio: 149700, // £1,497
};

// Legacy / honoured joining fees — used by discount codes for prospects
// who were promised the old price before the Jun 2026 increase.
export const LEGACY_JOINING_FEES: Record<MembershipType, number> = {
  solo: 29700,  // £297
  duo: 44700,   // £447
  trio: 59700,  // £597
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
export function getJoiningFee(type: MembershipType): number {
  return JOINING_FEES[type];
}

// Helper: format pence as £ string
export function formatPounds(pence: number): string {
  return `£${(pence / 100).toFixed(2).replace(/\.00$/, "")}`;
}
