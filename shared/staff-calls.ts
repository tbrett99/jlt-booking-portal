import { z } from "zod";

export const STAFF_CALL_REASONS = [
  { key: "onboarding", label: "Onboarding" },
  { key: "accelerator_support", label: "Accelerator support" },
  { key: "business_review", label: "Business review" },
  { key: "welfare_check_in", label: "Welfare check-in" },
  { key: "training_follow_up", label: "Training follow-up" },
  { key: "other", label: "Other" },
] as const;
export const staffCallReason = z.enum([
  "onboarding",
  "accelerator_support",
  "business_review",
  "welfare_check_in",
  "training_follow_up",
  "other",
]);
export const staffCallFormat = z.enum(["one_to_one", "group"]);
export const staffCallAttendance = z.enum([
  "awaiting",
  "attended",
  "no_show",
  "excused",
  "notheld",
]);
export const staffCallOutcome = z.enum([
  "completed",
  "follow_up_required",
  "no_contact",
  "not_held",
]);
export const staffCallStatus = z.enum([
  "pending",
  "booked",
  "needs_recovery",
  "cancelled",
]);
export type StaffCallReasonKey = z.infer<typeof staffCallReason>;
export type StaffCallFormat = z.infer<typeof staffCallFormat>;
export type StaffCallAttendance = z.infer<typeof staffCallAttendance>;
export type StaffCallOutcome = z.infer<typeof staffCallOutcome>;
const id = z.number().int().positive().safe();
const version = z.number().int().positive().safe();
const dates = { from: z.date(), to: z.date() };
const validWindow = (days: number) => (v: { from: Date; to: Date }) =>
  v.to.getTime() > v.from.getTime() &&
  v.to.getTime() - v.from.getTime() <= days * 86_400_000;
const agentIds = z
  .array(id)
  .min(1)
  .max(50)
  .refine(
    ids => new Set(ids).size === ids.length,
    "Select each agent exactly once"
  );
export const staffCallWindowInput = z
  .object({
    ...dates,
    limit: z.number().int().min(1).max(100).default(50),
    cursor: id.optional(),
  })
  .strict()
  .refine(validWindow(62), "Choose a date window of at most 62 days");
export const staffCallDiaryInput = z
  .object({
    ...dates,
    hostUserId: id.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: id.optional(),
  })
  .strict()
  .refine(validWindow(62), "Choose a date window of at most 62 days");
export const staffCallAgentsInput = z
  .object({
    query: z.string().trim().max(100).default(""),
    cursor: id.optional(),
    limit: z.number().int().min(1).max(50).default(25),
  })
  .strict();
export const staffCallGetInput = z.object({ callId: id }).strict();
export const staffCallAvailabilityInput = z
  .object({ ...dates, hostUserId: id, format: staffCallFormat, agentIds })
  .strict()
  .refine(validWindow(31), "Choose a date window of at most 31 days")
  .refine(
    v => v.format !== "one_to_one" || v.agentIds.length === 1,
    "A one-to-one call requires exactly one agent"
  );
export const staffCallBookInput = z
  .object({
    requestId: z.string().uuid(),
    hostUserId: id,
    reasonKey: staffCallReason,
    reasonExplanation: z.string().trim().max(1000).optional(),
    format: staffCallFormat,
    startAt: z.date(),
    endAt: z.date(),
    agentIds,
  })
  .strict()
  .refine(
    v => v.reasonKey !== "other" || !!v.reasonExplanation?.trim(),
    "Explain the Other reason"
  )
  .refine(
    v => v.format !== "one_to_one" || v.agentIds.length === 1,
    "A one-to-one call requires exactly one agent"
  )
  .refine(
    v =>
      v.endAt > v.startAt &&
      v.endAt.getTime() - v.startAt.getTime() <= 8 * 3_600_000,
    "Call duration must be positive and at most eight hours"
  );
export const staffCallRescheduleInput = z
  .object({
    requestId: z.string().uuid(),
    callId: id,
    expectedVersion: version,
    startAt: z.date(),
    endAt: z.date(),
  })
  .strict()
  .refine(
    v =>
      v.endAt > v.startAt &&
      v.endAt.getTime() - v.startAt.getTime() <= 8 * 3_600_000,
    "Call duration must be positive and at most eight hours"
  );
export const staffCallCancelInput = z
  .object({
    requestId: z.string().uuid(),
    callId: id,
    expectedVersion: version,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const staffCallCancelParticipantInput = z
  .object({
    requestId: z.string().uuid(),
    callId: id,
    participantId: id,
    expectedVersion: version,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const staffCallReconcileInput = z
  .object({ requestId: z.string().uuid() })
  .strict();
export const staffCallNotesInput = z
  .object({
    callId: id,
    participantId: id,
    expectedVersion: version,
    attendance: z.enum(["attended", "no_show", "excused", "notheld"]),
    outcome: staffCallOutcome,
    privateNotes: z.string().trim().min(1).max(20_000),
  })
  .strict()
  .refine(
    v =>
      v.attendance === "attended"
        ? ["completed", "follow_up_required"].includes(v.outcome)
        : v.attendance === "notheld"
          ? v.outcome === "not_held"
          : v.outcome === "no_contact",
    "Outcome must match recorded attendance"
  );
export const staffCallShareInput = z
  .object({
    callId: id,
    participantId: id,
    expectedVersion: version,
    sharedSummary: z.string().trim().min(1).max(10_000),
  })
  .strict();
export const staffCallFollowUpInput = z
  .object({
    callId: id,
    participantId: id,
    expectedVersion: version,
    title: z.string().trim().min(3).max(255),
    instructions: z.string().trim().min(3).max(20_000),
    dueAt: z.date().nullable().optional(),
    requiresNote: z.boolean().default(true),
    requiresUrl: z.boolean().default(false),
    requiresUpload: z.boolean().default(false),
    staffReviewRequired: z.boolean().default(false),
  })
  .strict();
export const staffCallAgentHistoryInput = z
  .object({
    agentId: id,
    limit: z.number().int().min(1).max(100).default(30),
    cursor: id.optional(),
  })
  .strict();

export type StaffCallSummary = {
  id: number;
  hostUserId: number;
  hostName: string | null;
  reasonKey: string;
  reasonExplanation: string | null;
  format: StaffCallFormat;
  startAt: Date;
  endAt: Date;
  status: z.infer<typeof staffCallStatus>;
  version: number;
  participantCount: number;
  meetingUrl: string | null;
};
export type StaffCallParticipantDto = {
  id: number;
  agentId: number;
  name: string | null;
  attendance: StaffCallAttendance;
  outcome?: StaffCallOutcome | null;
  privateNotes?: string | null;
  sharedSummary: string | null;
  sharedAt: Date | null;
  version: number;
  status: "active" | "cancelled";
};
export type StaffCallOperationResult = {
  requestId: string;
  callId: number;
  state: "pending" | "succeeded" | "needs_recovery" | "failed";
  status: z.infer<typeof staffCallStatus>;
  message: string | null;
};
