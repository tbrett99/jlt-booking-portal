/**
 * Recruitment Analytics — aggregated stats for the performance dashboard
 *
 * Key design decision:
 * - totalWon counts prospects whose stage was moved to "won" within the selected
 *   date range (using stage history), NOT prospects created in that range who
 *   happen to currently be at "won". This gives accurate weekly/monthly sign-up
 *   counts regardless of when the prospect first enquired.
 * - weeklyVolume counts won conversions per week (same logic).
 * - totalProspects, funnel, and conversion rates are still based on enquiry
 *   createdAt so the funnel remains meaningful.
 */
import { getDb } from "./db";
import {
  recruitmentProspects,
  recruitmentStageHistory,
} from "../drizzle/schema";
import { gte, and, sql } from "drizzle-orm";

export interface RecruitmentAnalytics {
  // KPI totals
  totalProspects: number;
  totalApplications: number;
  totalWon: number;
  totalArchived: number;
  overallConversionRate: number; // enquiry → won %

  // Stage funnel counts (ordered)
  stageFunnel: { stage: string; label: string; count: number }[];

  // Lead source breakdown
  sourceBreakdown: { source: string; count: number; wonCount: number; conversionRate: number }[];

  // Weekly won conversions (last 52 weeks)
  weeklyVolume: { week: string; count: number }[];

  // Conversion rates between key stages
  conversionRates: {
    enquiryToApplication: number;
    applicationToArApproved: number;
    arApprovedToCallBooked: number;
    callBookedToCallComplete: number;
    callCompleteToOnboardingApproved: number;
    onboardingApprovedToWon: number;
    overallEnquiryToWon: number;
  };

  // Average days in each stage (from stage history)
  avgDaysInStage: { stage: string; label: string; avgDays: number }[];
}

const STAGE_LABELS: Record<string, string> = {
  new_enquiry: "New Enquiry",
  application_received: "Application Received",
  ar_approved: "AR Approved",
  ar_declined: "AR Declined",
  discovery_call_booked: "Call Booked",
  rebook_required: "Rebook Required",
  did_not_turn_up: "Did Not Turn Up",
  discovery_call_complete: "Call Complete",
  onboarding_approved: "Onboarding Approved",
  onboarding_declined: "Onboarding Declined",
  won: "Won",
  waitlisted: "Waitlisted",
  archived: "Archived",
};

const FUNNEL_STAGES = [
  "new_enquiry",
  "application_received",
  "ar_approved",
  "discovery_call_booked",
  "discovery_call_complete",
  "onboarding_approved",
  "won",
];

export async function getRecruitmentAnalytics(opts?: {
  dateFrom?: Date;
}): Promise<RecruitmentAnalytics> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const dateFrom = opts?.dateFrom;

  // ── Fetch ALL prospects (no date filter) for funnel/conversion accuracy ──
  const allProspects: any[] = await (db.select().from(recruitmentProspects) as any);

  // ── Fetch ALL stage history ───────────────────────────────────────────────
  let stageHistory: any[] = [];
  try {
    stageHistory = await (db.select().from(recruitmentStageHistory).orderBy(
      recruitmentStageHistory.prospectId,
      recruitmentStageHistory.changedAt
    ) as any);
  } catch {}

  // ── Won conversions: prospects moved to "won" within the date range ───────
  // For each prospect, find the earliest stage history entry where toStage = "won"
  // If no history entry exists (direct sign-up without pipeline), fall back to
  // the prospect's createdAt (which equals the agent's sign-up time for auto-created records)
  const wonProspectIds = new Set(
    allProspects.filter((p) => p.pipelineStage === "won").map((p) => p.id)
  );

  // Build a map of prospectId → earliest won date (from history or createdAt)
  const wonDateByProspect = new Map<number, Date>();
  for (const row of stageHistory) {
    if (row.toStage === "won" && wonProspectIds.has(row.prospectId)) {
      const existing = wonDateByProspect.get(row.prospectId);
      const rowDate = new Date(row.changedAt);
      if (!existing || rowDate < existing) {
        wonDateByProspect.set(row.prospectId, rowDate);
      }
    }
  }
  // For won prospects with no history entry, use their createdAt as the won date
  for (const p of allProspects) {
    if (p.pipelineStage === "won" && !wonDateByProspect.has(p.id) && p.createdAt) {
      wonDateByProspect.set(p.id, new Date(p.createdAt));
    }
  }

  // Filter won prospects by date range
  const wonInPeriod = Array.from(wonDateByProspect.entries()).filter(([, wonDate]) => {
    if (!dateFrom) return true;
    return wonDate >= dateFrom;
  });
  const totalWon = wonInPeriod.length;

  // ── Prospects within date range (for funnel/totals) ───────────────────────
  const prospectsInPeriod = dateFrom
    ? allProspects.filter((p) => p.createdAt && new Date(p.createdAt) >= dateFrom)
    : allProspects;

  const total = prospectsInPeriod.length;
  const totalApplications = prospectsInPeriod.filter((p) => p.applicationSubmittedAt).length;
  const totalArchived = prospectsInPeriod.filter((p) => p.pipelineStage === "archived").length;
  const overallConversionRate = total > 0 ? Math.round((totalWon / total) * 100) : 0;

  // ── Stage funnel (based on all prospects, current stage) ─────────────────
  const stageCounts: Record<string, number> = {};
  for (const p of allProspects) {
    stageCounts[p.pipelineStage] = (stageCounts[p.pipelineStage] ?? 0) + 1;
  }
  const stageFunnel = Object.entries(STAGE_LABELS).map(([stage, label]) => ({
    stage,
    label,
    count: stageCounts[stage] ?? 0,
  }));

  // ── Lead source breakdown (based on prospects in period) ─────────────────
  const wonProspectIdSet = new Set(wonInPeriod.map(([id]) => id));
  const sourceMap: Record<string, { count: number; wonCount: number }> = {};
  for (const p of prospectsInPeriod) {
    let sources: string[] = [];
    try {
      const ad = typeof p.applicationData === "string"
        ? JSON.parse(p.applicationData)
        : p.applicationData;
      if (ad?.heardAbout?.length) sources = ad.heardAbout;
    } catch {}
    if (!sources.length && p.howHeard) sources = [p.howHeard];
    if (!sources.length) sources = ["Unknown"];

    for (const src of sources) {
      if (!sourceMap[src]) sourceMap[src] = { count: 0, wonCount: 0 };
      sourceMap[src].count++;
      if (wonProspectIdSet.has(p.id)) sourceMap[src].wonCount++;
    }
  }
  const sourceBreakdown = Object.entries(sourceMap)
    .map(([source, { count, wonCount }]) => ({
      source,
      count,
      wonCount,
      conversionRate: count > 0 ? Math.round((wonCount / count) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // ── Weekly volume: won conversions per week (last 52 weeks) ──────────────
  const weeklyMap: Record<string, number> = {};
  const now = new Date();
  for (let i = 51; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const weekKey = getWeekKey(d);
    weeklyMap[weekKey] = 0;
  }
  for (const [, wonDate] of Array.from(wonDateByProspect.entries())) {
    const weekKey = getWeekKey(wonDate);
    if (weekKey in weeklyMap) weeklyMap[weekKey]++;
  }
  const weeklyVolume = Object.entries(weeklyMap).map(([week, count]) => ({ week, count }));

  // ── Conversion rates (based on prospects in period) ───────────────────────
  const everApplied = prospectsInPeriod.filter((p) => p.applicationSubmittedAt).length;
  const everArApproved = prospectsInPeriod.filter((p) =>
    ["ar_approved", "discovery_call_booked", "rebook_required", "did_not_turn_up",
     "discovery_call_complete", "onboarding_approved", "onboarding_declined", "won", "waitlisted"].includes(p.pipelineStage)
  ).length;
  const everCallBooked = prospectsInPeriod.filter((p) =>
    ["discovery_call_booked", "rebook_required", "did_not_turn_up",
     "discovery_call_complete", "onboarding_approved", "onboarding_declined", "won"].includes(p.pipelineStage)
  ).length;
  const everCallComplete = prospectsInPeriod.filter((p) =>
    ["discovery_call_complete", "onboarding_approved", "onboarding_declined", "won"].includes(p.pipelineStage)
  ).length;
  const everOnboardingApproved = prospectsInPeriod.filter((p) =>
    ["onboarding_approved", "won"].includes(p.pipelineStage)
  ).length;

  const pct = (num: number, den: number) => den > 0 ? Math.round((num / den) * 100) : 0;

  const conversionRates = {
    enquiryToApplication: pct(everApplied, total),
    applicationToArApproved: pct(everArApproved, everApplied),
    arApprovedToCallBooked: pct(everCallBooked, everArApproved),
    callBookedToCallComplete: pct(everCallComplete, everCallBooked),
    callCompleteToOnboardingApproved: pct(everOnboardingApproved, everCallComplete),
    onboardingApprovedToWon: pct(totalWon, everOnboardingApproved),
    overallEnquiryToWon: pct(totalWon, total),
  };

  // ── Average days in each stage ────────────────────────────────────────────
  const stageDurations: Record<string, number[]> = {};
  const byProspect: Record<number, any[]> = {};
  for (const row of stageHistory) {
    if (!byProspect[row.prospectId]) byProspect[row.prospectId] = [];
    byProspect[row.prospectId].push(row);
  }
  for (const rows of Object.values(byProspect)) {
    rows.sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
    for (let i = 0; i < rows.length - 1; i++) {
      const fromStage = rows[i].toStage;
      const t1 = new Date(rows[i].changedAt).getTime();
      const t2 = new Date(rows[i + 1].changedAt).getTime();
      const days = (t2 - t1) / (1000 * 60 * 60 * 24);
      if (!stageDurations[fromStage]) stageDurations[fromStage] = [];
      stageDurations[fromStage].push(days);
    }
  }
  const avgDaysInStage = FUNNEL_STAGES.map((stage) => {
    const durations = stageDurations[stage] ?? [];
    const avgDays = durations.length > 0
      ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
      : 0;
    return { stage, label: STAGE_LABELS[stage] ?? stage, avgDays };
  });

  return {
    totalProspects: total,
    totalApplications,
    totalWon,
    totalArchived,
    overallConversionRate,
    stageFunnel,
    sourceBreakdown,
    weeklyVolume,
    conversionRates,
    avgDaysInStage,
  };
}

function getWeekKey(d: Date): string {
  const year = d.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const week = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
