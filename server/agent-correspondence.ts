import { eq } from "drizzle-orm";
import { agentCrmProfiles, users } from "../drizzle/schema";
import { getDb } from "./db";

export const CORRESPONDENCE_EMAIL_KINDS = ["jlt", "personal", "business"] as const;
export type CorrespondenceEmailKind = (typeof CORRESPONDENCE_EMAIL_KINDS)[number];
export type CorrespondenceEmailSource = CorrespondenceEmailKind | "login_fallback" | "caller_fallback";

export function normaliseCorrespondenceEmailKind(value: unknown): CorrespondenceEmailKind | null {
  return typeof value === "string" && (CORRESPONDENCE_EMAIL_KINDS as readonly string[]).includes(value)
    ? value as CorrespondenceEmailKind
    : null;
}

export function isUsableCorrespondenceEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  const candidate = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate);
}

export function selectCorrespondenceAddress(params: {
  kind: unknown;
  jltEmail?: string | null;
  personalEmail?: string | null;
  businessEmail?: string | null;
  loginEmail?: string | null;
  fallbackEmail?: string | null;
}): { email: string; source: CorrespondenceEmailSource } {
  const kind = normaliseCorrespondenceEmailKind(params.kind);
  const selected = kind === "jlt"
    ? params.jltEmail
    : kind === "personal"
      ? params.personalEmail
      : kind === "business"
        ? params.businessEmail
        : null;

  if (kind && isUsableCorrespondenceEmail(selected)) {
    return { email: selected.trim(), source: kind };
  }
  if (isUsableCorrespondenceEmail(params.loginEmail)) {
    return { email: params.loginEmail.trim(), source: "login_fallback" };
  }
  return { email: (params.fallbackEmail ?? "").trim(), source: "caller_fallback" };
}

/**
 * Resolves the staff-selected correspondence address immediately before sending
 * an agent-facing operational email. Login credentials and password resets do
 * not call this resolver: they always stay tied to users.email.
 */
export async function resolveAgentCorrespondence(params: {
  userId: number;
  fallbackEmail: string;
  fallbackName?: string | null;
}): Promise<{ email: string; name: string; source: CorrespondenceEmailSource }> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        email: params.fallbackEmail,
        name: params.fallbackName?.trim() || "Agent",
        source: "caller_fallback",
      };
    }

    const rows = await db
      .select({
        name: users.name,
        loginEmail: users.email,
        correspondenceEmailKind: agentCrmProfiles.correspondenceEmailKind,
        jltEmail: agentCrmProfiles.jltEmail,
        personalEmail: agentCrmProfiles.personalEmail,
        businessEmail: agentCrmProfiles.businessEmail,
      })
      .from(users)
      .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
      .where(eq(users.id, params.userId))
      .limit(1);

    const recipient = rows[0];
    if (!recipient) {
      return {
        email: params.fallbackEmail,
        name: params.fallbackName?.trim() || "Agent",
        source: "caller_fallback",
      };
    }

    const address = selectCorrespondenceAddress({
      kind: recipient.correspondenceEmailKind,
      jltEmail: recipient.jltEmail,
      personalEmail: recipient.personalEmail,
      businessEmail: recipient.businessEmail,
      loginEmail: recipient.loginEmail,
      fallbackEmail: params.fallbackEmail,
    });
    return {
      ...address,
      name: recipient.name?.trim() || params.fallbackName?.trim() || "Agent",
    };
  } catch (error) {
    console.error("[Correspondence] Could not resolve CRM email preference; using caller address", error);
    return {
      email: params.fallbackEmail,
      name: params.fallbackName?.trim() || "Agent",
      source: "caller_fallback",
    };
  }
}
