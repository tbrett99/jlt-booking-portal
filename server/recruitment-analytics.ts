/**
 * Recruitment Analytics — aggregated stats for the performance dashboard
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

  // Weekly new enquiry volume (last 52 weeks)
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

  const whereClause = opts?.dateFrom
    ? gte(recruitmentProspects.createdAt, opts.dateFrom)
    : undefined;

  // ── Fetch all prospects (within date range) ──────────────────────────────
  const allProspects: any[] = await (whereClause
    ? (db.select().from(recruitmentProspects).where(whereClause) as any)
    : (db.select().from(recruitmentProspects) as any));

  const total = allProspects.length;
  const totalApplications = allProspects.filter((p) => p.applicationSubmittedAt).length;
  const totalWon = allProspects.filter((p) => p.pipelineStage === "won").length;
  const totalArchived = allProspects.filter((p) => p.pipelineStage === "archived").length;
  const overallConversionRate = total > 0 ? Math.round((totalWon / total) * 100) : 0;

  // ── Stage funnel ─────────────────────────────────────────────────────────
  const stageCounts: Record<string, number> = {};
  for (const p of allProspects) {
    stageCounts[p.pipelineStage] = (stageCounts[p.pipelineStage] ?? 0) + 1;
  }
  const stageFunnel = Object.entries(STAGE_LABELS).map(([stage, label]) => ({
    stage,
    label,
    count: stageCounts[stage] ?? 0,
  }));

  // ── Lead source breakdown ─────────────────────────────────────────────────
  const sourceMap: Record<string, { count: number; wonCount: number }> = {};
  for (const p of allProspects) {
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
      if (p.pipelineStage === "won") sourceMap[src].wonCount++;
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

  // ── Weekly volume (last 52 weeks) ─────────────────────────────────────────
  const weeklyMap: Record<string, number> = {};
  const now = new Date();
  for (let i = 51; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const weekKey = getWeekKey(d);
    weeklyMap[weekKey] = 0;
  }
  for (const p of allProspects) {
    if (p.createdAt) {
      const weekKey = getWeekKey(new Date(p.createdAt));
      if (weekKey in weeklyMap) weeklyMap[weekKey]++;
    }
  }
  const weeklyVolume = Object.entries(weeklyMap).map(([week, count]) => ({ week, count }));

  // ── Conversion rates ─────────────────────────────────────────────────────
  const countInStageOrBeyond = (stages: string[]) =>
    allProspects.filter((p) => stages.includes(p.pipelineStage)).length;

  // "Ever reached" counts — use applicationSubmittedAt as proxy for application_received
  const everApplied = allProspects.filter((p) => p.applicationSubmittedAt).length;
  const everArApproved = allProspects.filter((p) =>
    ["ar_approved", "discovery_call_booked", "rebook_required", "did_not_turn_up",
     "discovery_call_complete", "onboarding_approved", "onboarding_declined", "won", "waitlisted"].includes(p.pipelineStage)
  ).length;
  const everCallBooked = allProspects.filter((p) =>
    ["discovery_call_booked", "rebook_required", "did_not_turn_up",
     "discovery_call_complete", "onboarding_approved", "onboarding_declined", "won"].includes(p.pipelineStage)
  ).length;
  const everCallComplete = allProspects.filter((p) =>
    ["discovery_call_complete", "onboarding_approved", "onboarding_declined", "won"].includes(p.pipelineStage)
  ).length;
  const everOnboardingApproved = allProspects.filter((p) =>
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
  // Use stage history to compute average time spent in each stage
  let stageHistory: any[] = [];
  try {
    stageHistory = await (db.select().from(recruitmentStageHistory).orderBy(
      recruitmentStageHistory.prospectId,
      recruitmentStageHistory.changedAt
    ) as any);
  } catch {}

  // Group by prospectId, compute time between consecutive stage entries
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
