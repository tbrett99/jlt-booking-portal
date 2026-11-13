import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  agentSupportConversations,
  agentSupportFeedback,
  agentSupportMessages,
} from "../drizzle/schema";
import { loadAdminPilotSupportSources } from "./agent-support-sources";
import { generateSupportTurn } from "./agent-support-generation";
import { chunkAgentSupportSource, normaliseAgentSupportText } from "./agent-support-utils";
import { maskGenericDocumentRequirementClauses } from "./agent-support-language";
import {
  safeStoredSupportText,
  screenSupportInput,
  SUPPORT_PRIVACY_MESSAGE,
} from "./agent-support-privacy";
import {
  readSupportConditionChecks,
  readSupportMetadata,
  readSupportValidationDiagnostic,
  supportEnvelope,
} from "../shared/agent-support-metadata";
import type {
  SupportConversationMessage,
  SupportHistoryTurn,
  SupportTurnResult,
} from "../shared/agent-support-pilot";

export {
  policySources,
  loadAdminPilotSupportSources,
} from "./agent-support-sources";
// Kept as compatibility exports for existing safety regression checks.
export { assistantSystemPrompt } from "./agent-support-generation";
export function isAssistantUnavailableAnswer(value: string) {
  return /^i can[’']t confirm that from the approved agent-facing portal content/i.test(
    value.trim()
  );
}

const RETENTION_DAYS = 90;
const MAX_ANSWERS_PER_HOUR = 30;
const SUPPORT_EMAIL = "support@thejltgroup.co.uk";
const AGENT_SUPPORT_MODEL = "gpt-5-mini";
const safeAdminProcedure = adminProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.isActive === false)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This assistant pilot is available only to active administrators.",
    });
  try {
    const result = await next();
    if (!result.ok && result.error.code === "INTERNAL_SERVER_ERROR")
      return {
        ...result,
        error: new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "The assistant pilot could not complete this request. Please try again.",
        }),
      };
    return result;
  } catch (error) {
    if (
      error instanceof TRPCError &&
      [
        "NOT_FOUND",
        "TOO_MANY_REQUESTS",
        "BAD_REQUEST",
        "FORBIDDEN",
        "UNAUTHORIZED",
      ].includes(error.code)
    )
      throw error;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The assistant pilot could not complete this request. Please try again.",
    });
  }
});

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
async function database(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Assistant database unavailable");
  return db;
}
function currentScope(now: Date) {
  return and(
    eq(agentSupportConversations.pilotScope, "admin_only"),
    gt(agentSupportConversations.expiresAt, now)
  );
}
function ownedScope(userId: number, id: number, now: Date) {
  return and(
    eq(agentSupportConversations.id, id),
    eq(agentSupportConversations.userId, userId),
    currentScope(now)
  );
}
function checkedId(value: unknown) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Assistant persistence could not be verified");
  return id;
}

async function purgeExpiredSupportHistory(db: Db) {
  await db.transaction(async tx => {
    const rows = await tx
      .select({ id: agentSupportConversations.id })
      .from(agentSupportConversations)
      .where(lte(agentSupportConversations.expiresAt, new Date()))
      .limit(500)
      .for("update");
    const ids = rows.map(row => row.id);
    if (!ids.length) return;
    const messages = await tx
      .select({ id: agentSupportMessages.id })
      .from(agentSupportMessages)
      .where(inArray(agentSupportMessages.conversationId, ids));
    if (messages.length)
      await tx.delete(agentSupportFeedback).where(
        inArray(
          agentSupportFeedback.messageId,
          messages.map(row => row.id)
        )
      );
    await tx
      .delete(agentSupportMessages)
      .where(inArray(agentSupportMessages.conversationId, ids));
    await tx
      .delete(agentSupportConversations)
      .where(inArray(agentSupportConversations.id, ids));
  });
}

async function requireOwnedConversation(
  db: Db,
  userId: number,
  id: number,
  now = new Date()
) {
  const [conversation] = await db
    .select({
      id: agentSupportConversations.id,
      expiresAt: agentSupportConversations.expiresAt,
    })
    .from(agentSupportConversations)
    .where(ownedScope(userId, id, now))
    .limit(1);
  // A query may itself finish after its cutoff: do not accept a stale expiry.
  if (!conversation || conversation.expiresAt.getTime() <= Date.now())
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This assistant conversation is no longer available.",
    });
  return conversation;
}
async function ownedConversationId(
  db: Db,
  userId: number,
  requested: number | undefined,
  now: Date
) {
  if (requested)
    return (await requireOwnedConversation(db, userId, requested, now)).id;
  const inserted = await db
    .insert(agentSupportConversations)
    .values({
      userId,
      pilotScope: "admin_only",
      startedAt: now,
      expiresAt: new Date(now.getTime() + RETENTION_DAYS * 86400000),
    })
    .$returningId();
  return checkedId(inserted[0]?.id);
}
async function conversationHistory(
  db: Db,
  userId: number,
  id: number
): Promise<SupportHistoryTurn[]> {
  const rows = await db
    .select({
      role: agentSupportMessages.role,
      content: agentSupportMessages.content,
      sourceRefs: agentSupportMessages.sourceRefs,
      responseStatus: agentSupportMessages.responseStatus,
    })
    .from(agentSupportMessages)
    .innerJoin(
      agentSupportConversations,
      eq(agentSupportConversations.id, agentSupportMessages.conversationId)
    )
    .where(ownedScope(userId, id, new Date()))
    .orderBy(desc(agentSupportMessages.id))
    .limit(32);
  let remaining = 6000;
  const history: SupportHistoryTurn[] = [];
  for (let index = 0; index < rows.length - 1; index++) {
    const assistant = rows[index],
      user = rows[index + 1];
    // Ask commits both messages together under the conversation lock. Do not
    // combine the safe half of a private, legacy or incomplete exchange with
    // another turn. Descending history is assistant then its preceding user.
    if (assistant.role !== "assistant" || user.role !== "user") continue;
    index++;
    const assistantMeta = readSupportMetadata(
      assistant.sourceRefs,
      assistant.responseStatus
    );
    const userMeta = readSupportMetadata(user.sourceRefs, user.responseStatus);
    if (
      !assistantMeta.inputScreened ||
      !userMeta.inputScreened ||
      (!assistantMeta.verified && assistantMeta.disposition !== "clarify")
    )
      continue;
    const userText = safeStoredSupportText(user.content);
    const assistantText = safeStoredSupportText(assistant.content, true, assistantMeta.verified);
    if (
      [userText, assistantText].some(text =>
        text.startsWith("[Private details omitted")
      )
    )
      continue;
    if (history.length >= 8) break;
    const boundedAssistant = assistantText.slice(0, 1200),
      boundedUser = userText.slice(0, 1200);
    if (boundedAssistant.length + boundedUser.length > remaining) break;
    remaining -= boundedAssistant.length + boundedUser.length;
    history.push(
      { role: "assistant", content: boundedAssistant },
      { role: "user", content: boundedUser }
    );
  }
  return history.reverse();
}
function blockedResult(): SupportTurnResult {
  return {
    answer: SUPPORT_PRIVACY_MESSAGE,
    sources: [],
    disposition: "privacy_blocked",
    verified: false,
    status: "insufficient_sources",
    unresolvedReason: "private_details_blocked",
    model: null,
    promptTokens: null,
    completionTokens: null,
    modelCalls: 0,
    latencyMs: 0,
  };
}

function safeConditionChecks(value: unknown) {
  return readSupportConditionChecks(value).filter(check => screenSupportInput([
    check.source.title, check.source.label, check.source.timestampLabel ?? "",
  ].join("\n")).safe);
}

export const agentSupportRouter = router({
  overview: safeAdminProcedure.query(async () => {
    const db = await database();
    await purgeExpiredSupportHistory(db);
    const sources = await loadAdminPilotSupportSources();
    const now = new Date();
    const recent = new Date(now.getTime() - 30 * 86400000);
    const [stats] = await db
      .select({
        questions: sql<number>`COALESCE(SUM(${agentSupportMessages.role} = 'user'), 0)`,
        answered: sql<number>`COALESCE(SUM(${agentSupportMessages.role} = 'assistant' AND ${agentSupportMessages.responseStatus} = 'answered'), 0)`,
        unresolved: sql<number>`COALESCE(SUM(${agentSupportMessages.role} = 'assistant' AND ${agentSupportMessages.unresolvedReason} IN ('no_relevant_approved_source','model_confirmed_no_direct_support')), 0)`,
        clarified: sql<number>`COALESCE(SUM(${agentSupportMessages.role} = 'assistant' AND JSON_UNQUOTE(JSON_EXTRACT(${agentSupportMessages.sourceRefs}, '$.disposition')) = 'clarify'), 0)`,
        withheld: sql<number>`COALESCE(SUM(${agentSupportMessages.role} = 'assistant' AND JSON_UNQUOTE(JSON_EXTRACT(${agentSupportMessages.sourceRefs}, '$.disposition')) = 'validation_failed'), 0)`,
        privacyBlocked: sql<number>`COALESCE(SUM(${agentSupportMessages.role} = 'assistant' AND ${agentSupportMessages.unresolvedReason} = 'private_details_blocked'), 0)`,
        failed: sql<number>`COALESCE(SUM(${agentSupportMessages.role} = 'assistant' AND ${agentSupportMessages.responseStatus} = 'failed'), 0)`,
        promptTokens: sql<number>`COALESCE(SUM(${agentSupportMessages.promptTokens}), 0)`,
        completionTokens: sql<number>`COALESCE(SUM(${agentSupportMessages.completionTokens}), 0)`,
        modelCalls: sql<number>`COALESCE(SUM(JSON_EXTRACT(${agentSupportMessages.sourceRefs}, '$.modelCalls')), 0)`,
      })
      .from(agentSupportMessages)
      .innerJoin(
        agentSupportConversations,
        eq(agentSupportConversations.id, agentSupportMessages.conversationId)
      )
      .where(
        and(currentScope(now), gt(agentSupportMessages.createdAt, recent))
      );
    const feedbackCounts = await db
      .select({
        rating: agentSupportFeedback.rating,
        count: sql<number>`COUNT(*)`,
      })
      .from(agentSupportFeedback)
      .innerJoin(
        agentSupportMessages,
        eq(agentSupportMessages.id, agentSupportFeedback.messageId)
      )
      .innerJoin(
        agentSupportConversations,
        eq(agentSupportConversations.id, agentSupportMessages.conversationId)
      )
      .where(and(currentScope(now), gt(agentSupportFeedback.createdAt, recent)))
      .groupBy(agentSupportFeedback.rating);
    const sourceCounts = sources.reduce<Record<string, number>>(
      (counts, source) => {
        counts[source.kind] = (counts[source.kind] ?? 0) + 1;
        return counts;
      },
      {}
    );
    const n = (key: keyof NonNullable<typeof stats>) =>
      Number(stats?.[key] ?? 0);
    return {
      pilotScope: "admin_only" as const,
      retentionDays: RETENTION_DAYS,
      sourceCounts,
      metrics: {
        questions: n("questions"),
        answered: n("answered"),
        unresolved: n("unresolved"),
        clarified: n("clarified"),
        withheld: n("withheld"),
        privacyBlocked: n("privacyBlocked"),
        failed: n("failed"),
        promptTokens: n("promptTokens"),
        completionTokens: n("completionTokens"),
        modelCalls: n("modelCalls"),
        helpful: Number(
          feedbackCounts.find(row => row.rating === "helpful")?.count ?? 0
        ),
        notHelpful: Number(
          feedbackCounts.find(row => row.rating === "not_helpful")?.count ?? 0
        ),
      },
      explicitExclusions: [
        "Booking and client records",
        "Financial, payment and commission information",
        "Emails, attachments and supplier credentials",
        "Academy answers, attempts, marking and audit data",
        "Community comments and activity",
      ],
    };
  }),

  conversations: safeAdminProcedure.query(async ({ ctx }) => {
    const db = await database();
    return db
      .select({
        id: agentSupportConversations.id,
        startedAt: agentSupportConversations.startedAt,
        updatedAt: agentSupportConversations.updatedAt,
      })
      .from(agentSupportConversations)
      .where(
        and(
          eq(agentSupportConversations.userId, ctx.user.id),
          currentScope(new Date())
        )
      )
      .orderBy(
        desc(agentSupportConversations.updatedAt),
        desc(agentSupportConversations.id)
      )
      .limit(20);
  }),

  conversation: safeAdminProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await database();
      const conversation = await requireOwnedConversation(
        db,
        ctx.user.id,
        input.conversationId
      );
      const rows = await db
        .select({
          id: agentSupportMessages.id,
          role: agentSupportMessages.role,
          content: agentSupportMessages.content,
          sourceRefs: agentSupportMessages.sourceRefs,
          responseStatus: agentSupportMessages.responseStatus,
          createdAt: agentSupportMessages.createdAt,
        })
        .from(agentSupportMessages)
        .where(eq(agentSupportMessages.conversationId, conversation.id))
        .orderBy(desc(agentSupportMessages.id))
        .limit(100);
      const ids = rows
        .filter(row => row.role === "assistant")
        .map(row => row.id);
      const feedbackRows = ids.length
        ? await db
            .select({
              messageId: agentSupportFeedback.messageId,
              rating: agentSupportFeedback.rating,
            })
            .from(agentSupportFeedback)
            .where(
              and(
                eq(agentSupportFeedback.userId, ctx.user.id),
                inArray(agentSupportFeedback.messageId, ids)
              )
            )
        : [];
      await requireOwnedConversation(db, ctx.user.id, input.conversationId);
      const messages: SupportConversationMessage[] = rows.reverse().map(row => {
        const meta = readSupportMetadata(row.sourceRefs, row.responseStatus);
        const conditionChecks = safeConditionChecks(meta.conditionChecks);
        return {
          id: row.id,
          role: row.role,
          content: safeStoredSupportText(row.content, row.role === "assistant", meta.verified),
          createdAt: row.createdAt,
          sources: row.role === "assistant" ? meta.sources : [],
          disposition: meta.disposition,
          verified: meta.verified,
          ...(row.role === "assistant" && meta.validationDiagnostic
            ? { validationDiagnostic: meta.validationDiagnostic }
            : {}),
          ...(row.role === "assistant" && conditionChecks.length
            ? { conditionChecks }
            : {}),
          feedback:
            feedbackRows.find(vote => vote.messageId === row.id)?.rating ??
            null,
        };
      });
      return { id: conversation.id, messages };
    }),

  conditionSource: safeAdminProcedure
    .input(z.object({
      messageId: z.number().int().positive(),
      checkIndex: z.number().int().min(0).max(7),
    }).strict())
    .query(async ({ ctx, input }) => {
      const db = await database();
      const userId = ctx.user.id;
      const requireCurrentIdentity = () => {
        if (!ctx.user || ctx.user.id !== userId || ctx.user.isActive === false ||
          !["admin", "super_admin"].includes(ctx.user.role))
          throw new TRPCError({ code: "FORBIDDEN", message: "This assistant pilot is available only to active administrators." });
      };
      // The request names only an owned message and a bounded saved reference.
      // It cannot select an arbitrary source key, content snapshot or quote.
      const [message] = await db
        .select({
          conversationId: agentSupportMessages.conversationId,
          sourceRefs: agentSupportMessages.sourceRefs,
          responseStatus: agentSupportMessages.responseStatus,
        })
        .from(agentSupportMessages)
        .innerJoin(agentSupportConversations, eq(agentSupportConversations.id, agentSupportMessages.conversationId))
        .where(and(
          eq(agentSupportMessages.id, input.messageId),
          eq(agentSupportMessages.role, "assistant"),
          eq(agentSupportConversations.userId, userId),
          currentScope(new Date())
        ))
        .limit(1);
      if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "This assistant answer is no longer available." });
      await requireOwnedConversation(db, userId, message.conversationId);
      requireCurrentIdentity();
      const unavailable = { available: false as const, reason: "source_changed_or_unavailable" as const };
      const finish = async <T,>(value: T) => {
        await requireOwnedConversation(db, userId, message.conversationId);
        requireCurrentIdentity();
        return value;
      };
      const meta = readSupportMetadata(message.sourceRefs, message.responseStatus);
      const check = meta.disposition === "validation_failed" && meta.validationDiagnostic === "conditions_missing"
        ? safeConditionChecks(meta.conditionChecks)[input.checkIndex] : undefined;
      if (!check) return finish(unavailable);
      const sources = await loadAdminPilotSupportSources();
      const source = sources.find(row => row.key === check.source.key);
      if (!source || source.kind !== check.source.kind || source.href !== check.source.href || source.title !== check.source.title)
        return finish(unavailable);
      const chunk = chunkAgentSupportSource(source).find(row => row.chunkIndex === check.chunkIndex);
      if (!chunk || check.end > chunk.chunkText.length ||
        createHash("sha256").update(normaliseAgentSupportText(chunk.chunkText)).digest("hex") !== check.sourceFingerprint)
        return finish(unavailable);
      const excerpt = chunk.chunkText.slice(check.start, check.end);
      // This masks only the same closed generic requirements as the verified
      // output boundary. Actual values/extra clauses still fail ordinary screening.
      const screened = [excerpt, source.title, check.source.title, check.source.label, check.source.timestampLabel ?? ""]
        .map(text => maskGenericDocumentRequirementClauses(text)).join("\n");
      if (!screenSupportInput(screened).safe) return finish(unavailable);
      return finish({ available: true as const, source: check.source, excerpt });
    }),

  ask: safeAdminProcedure
    .input(
      z.object({
        question: z.string().trim().min(2).max(2000),
        conversationId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const screened = screenSupportInput(input.question);
      const userId = ctx.user.id;
      const db = await database();
      await purgeExpiredSupportHistory(db);
      const now = new Date();
      const [rate] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentSupportMessages)
        .innerJoin(
          agentSupportConversations,
          eq(agentSupportMessages.conversationId, agentSupportConversations.id)
        )
        .where(
          and(
            eq(agentSupportConversations.userId, userId),
            eq(agentSupportMessages.role, "user"),
            currentScope(now),
            gt(
              agentSupportMessages.createdAt,
              new Date(now.getTime() - 3600000)
            )
          )
        );
      if (Number(rate?.count ?? 0) >= MAX_ANSWERS_PER_HOUR)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            "The assistant pilot has a 30-question-per-hour limit. Please try again shortly.",
        });
      const conversationId = await ownedConversationId(
        db,
        userId,
        input.conversationId,
        now
      );
      const requireCurrentIdentity = () => {
        if (
          !ctx.user ||
          ctx.user.id !== userId ||
          ctx.user.isActive === false ||
          !["admin", "super_admin"].includes(ctx.user.role)
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "This assistant pilot is available only to active administrators.",
          });
      };
      let result: SupportTurnResult;
      if (screened.safe) {
        const history = await conversationHistory(db, userId, conversationId);
        const sources = await loadAdminPilotSupportSources();
        // Source loading/history can outlive ownership or retention. Recheck
        // after all preparation awaits, immediately before the model boundary.
        await requireOwnedConversation(db, userId, conversationId);
        requireCurrentIdentity();
        result = await generateSupportTurn({
          question: screened.text,
          history,
          sources,
        });
      } else result = blockedResult();
      if (result.status === "answered" && !result.verified)
        throw new Error("Unverified assistant answer refused");
      const validationDiagnostic =
        result.disposition === "validation_failed" && result.status !== "answered"
          ? readSupportValidationDiagnostic(result.validationDiagnostic)
          : null;
      const conditionChecks = screened.safe && validationDiagnostic === "conditions_missing"
        ? safeConditionChecks(result.conditionChecks) : [];
      const saved = await db.transaction(async tx => {
        // Long model calls must never revive an expired/deleted/foreign conversation.
        const committedAt = new Date();
        const [owner] = await tx
          .select({ id: agentSupportConversations.id })
          .from(agentSupportConversations)
          .where(ownedScope(userId, conversationId, committedAt))
          .limit(1)
          .for("update");
        if (!owner)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This assistant conversation is no longer available.",
          });
        requireCurrentIdentity();
        const [user] = await tx
          .insert(agentSupportMessages)
          .values({
            conversationId,
            role: "user",
            content: screened.text,
            responseStatus: "answered",
            contextSourceCount: 0,
            sourceRefs: supportEnvelope({
              sources: [],
              disposition: screened.safe ? "answered" : "privacy_blocked",
              verified: false,
              modelCalls: 0,
              latencyMs: 0,
            }),
            createdAt: committedAt,
          })
          .$returningId();
        const [assistant] = await tx
          .insert(agentSupportMessages)
          .values({
            conversationId,
            role: "assistant",
            content: result.answer,
            responseStatus: result.status,
            sourceRefs: supportEnvelope({
              sources: result.sources,
              disposition: result.disposition,
              verified: result.verified,
              modelCalls: result.modelCalls,
              latencyMs: result.latencyMs,
              ...(validationDiagnostic ? { validationDiagnostic } : {}),
              ...(conditionChecks.length ? { conditionChecks } : {}),
            }),
            model: result.model,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            contextSourceCount: result.sources.length,
            unresolvedReason: result.unresolvedReason,
            createdAt: committedAt,
          })
          .$returningId();
        const userMessageId = checkedId(user?.id),
          messageId = checkedId(assistant?.id);
        await tx
          .update(agentSupportConversations)
          .set({ updatedAt: committedAt })
          .where(ownedScope(userId, conversationId, committedAt));
        return { userMessageId, messageId };
      });
      return {
        conversationId,
        ...saved,
        question: screened.text,
        answer: result.answer,
        sources: result.sources,
        status: result.status,
        disposition: result.disposition,
        verified: result.verified,
        ...(validationDiagnostic ? { validationDiagnostic } : {}),
        ...(conditionChecks.length ? { conditionChecks } : {}),
      };
    }),

  feedback: safeAdminProcedure
    .input(
      z.object({
        messageId: z.number().int().positive(),
        rating: z.enum(["helpful", "not_helpful"]),
        note: z.string().trim().max(1000).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const note = input.note ? screenSupportInput(input.note) : null;
      if (note && !note.safe)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Please remove private details from your feedback note.",
        });
      const db = await database();
      await db.transaction(async tx => {
        const [message] = await tx
          .select({ id: agentSupportMessages.id })
          .from(agentSupportMessages)
          .innerJoin(
            agentSupportConversations,
            eq(
              agentSupportConversations.id,
              agentSupportMessages.conversationId
            )
          )
          .where(
            and(
              eq(agentSupportMessages.id, input.messageId),
              eq(agentSupportMessages.role, "assistant"),
              eq(agentSupportConversations.userId, ctx.user.id),
              currentScope(new Date())
            )
          )
          .limit(1)
          .for("update");
        if (!message)
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "This assistant answer is no longer available for feedback.",
          });
        await tx
          .insert(agentSupportFeedback)
          .values({
            messageId: message.id,
            userId: ctx.user.id,
            rating: input.rating,
            note: note?.text || null,
          })
          .onDuplicateKeyUpdate({
            set: { rating: input.rating, note: note?.text || null },
          });
      });
      return { success: true };
    }),

  recentGaps: safeAdminProcedure.query(async () => {
    const db = await database();
    const rows = await db
      .select({
        id: agentSupportMessages.id,
        question: sql<string>`(SELECT q.content FROM agent_support_messages q WHERE q.conversationId = ${agentSupportMessages.conversationId} AND q.role = 'user' AND q.id < ${agentSupportMessages.id} ORDER BY q.id DESC LIMIT 1)`,
        createdAt: agentSupportMessages.createdAt,
        reason: agentSupportMessages.unresolvedReason,
      })
      .from(agentSupportMessages)
      .innerJoin(
        agentSupportConversations,
        eq(agentSupportConversations.id, agentSupportMessages.conversationId)
      )
      .where(
        and(
          currentScope(new Date()),
          eq(agentSupportMessages.role, "assistant"),
          inArray(agentSupportMessages.unresolvedReason, [
            "no_relevant_approved_source",
            "model_confirmed_no_direct_support",
          ])
        )
      )
      .orderBy(
        desc(agentSupportMessages.createdAt),
        desc(agentSupportMessages.id)
      )
      .limit(25);
    return rows.map(row => ({
      ...row,
      question: safeStoredSupportText(row.question),
    }));
  }),
});

export const AGENT_SUPPORT_PILOT_CONFIG = {
  model: AGENT_SUPPORT_MODEL,
  retentionDays: RETENTION_DAYS,
  supportEmail: SUPPORT_EMAIL,
} as const;
