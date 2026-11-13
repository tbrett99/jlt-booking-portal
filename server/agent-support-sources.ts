import { TRPCError } from "@trpc/server";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "./db";
import {
  academyCourses,
  academyLessons,
  academyModules,
  communityPosts,
  knowledgeBaseArticles,
  suppliers,
  users,
  webinarLibraryItems,
} from "../drizzle/schema";
import {
  FULL_TERMS_SECTIONS,
  CODE_OF_CONDUCT_SECTIONS,
  APPENDIX_SECTIONS,
} from "../client/src/pages/policyData";
import { PRIVACY_SECTIONS } from "../client/src/pages/TermsAndPolicies";
import { CURRENT_POLICY_REVISION } from "../shared/policy-revision";
import { AGENT_PORTAL_PROCEDURE_SOURCES } from "./agent-support-portal-procedures";
import {
  buildAcademyAgentSupportText,
  buildSupplierAgentSupportText,
  stripAgentSupportHtml,
  type AgentSupportSource,
} from "./agent-support-utils";
const COMMUNITY_ASSISTANT_CATEGORIES = ["news_announcements"] as const;

export function policySources(): AgentSupportSource[] {
  const sections = [
    ...FULL_TERMS_SECTIONS.map(section => ({
      title: `Terms & Conditions (${CURRENT_POLICY_REVISION.publicationLabel}) — ${section.title}`,
      content: section.content,
      href: "/terms?version=2026-11&section=terms",
    })),
    ...CODE_OF_CONDUCT_SECTIONS.map(section => ({
      title: `Code of Conduct (${CURRENT_POLICY_REVISION.publicationLabel}) — ${section.title}`,
      content: section.content,
      href: "/terms?version=2026-11&section=conduct",
    })),
    ...APPENDIX_SECTIONS.map(section => ({
      title: `Terms appendix (${CURRENT_POLICY_REVISION.publicationLabel}) — ${section.title}`,
      content: section.content,
      href: "/terms?version=2026-11&section=appendices",
    })),
    ...PRIVACY_SECTIONS.map(section => ({
      title: `Privacy Policy (May 2026) — ${section.title}`,
      content: section.content,
      href: "/terms?section=privacy",
    })),
  ];

  return sections.map((section, index) => ({
    key: `policy:${index}`,
    kind: "policy",
    title: section.title,
    text: stripAgentSupportHtml(section.content),
    href: section.href,
    category: "Agent Terms & Policies",
  }));
}

/**
 * Deliberately uses positive field projections instead of reusing broader Portal
 * endpoints. This keeps credentials, notes, assessment data, activity records
 * and storage keys structurally unable to reach the LLM context.
 */
export async function loadAdminPilotSupportSources(): Promise<
  AgentSupportSource[]
> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  const now = new Date();

  const [articles, webinars, supplierRows, communityRows, academyRows] =
    await Promise.all([
      db
        .select({
          id: knowledgeBaseArticles.id,
          title: knowledgeBaseArticles.title,
          summary: knowledgeBaseArticles.summary,
          contentHtml: knowledgeBaseArticles.contentHtml,
          category: knowledgeBaseArticles.category,
          publishedAt: knowledgeBaseArticles.publishedAt,
          updatedAt: knowledgeBaseArticles.updatedAt,
        })
        .from(knowledgeBaseArticles)
        // The learner library uses published status as its visibility gate;
        // a missing historical timestamp must not hide otherwise published text.
        .where(eq(knowledgeBaseArticles.status, "published")),
      db
        .select({
          id: webinarLibraryItems.id,
          title: webinarLibraryItems.title,
          summary: webinarLibraryItems.summary,
          descriptionHtml: webinarLibraryItems.descriptionHtml,
          category: webinarLibraryItems.category,
          videoUrl: webinarLibraryItems.videoUrl,
          privateTranscript: webinarLibraryItems.privateTranscript,
          assistantTranscriptApprovedAt:
            webinarLibraryItems.assistantTranscriptApprovedAt,
          recordedAt: webinarLibraryItems.recordedAt,
          publishedAt: webinarLibraryItems.publishedAt,
          updatedAt: webinarLibraryItems.updatedAt,
        })
        .from(webinarLibraryItems)
        .where(eq(webinarLibraryItems.status, "published")),
      db
        .select({
          id: suppliers.id,
          name: suppliers.name,
          description: suppliers.description,
          shortDescription: suppliers.shortDescription,
          publicWebsite: suppliers.publicWebsite,
          tradeWebsite: suppliers.tradeWebsite,
          additionalWebsite: suppliers.additionalWebsite,
          categories: suppliers.categories,
          locations: suppliers.locations,
          usp: suppliers.usp,
          priceTier: suppliers.priceTier,
          notSuitableFor: suppliers.notSuitableFor,
          aiSummary: suppliers.aiSummary,
          idealClient: suppliers.idealClient,
          bookingTips: suppliers.bookingTips,
          updatedAt: suppliers.updatedAt,
        })
        .from(suppliers)
        .where(eq(suppliers.isActive, 1)),
      db
        .select({
          id: communityPosts.id,
          title: communityPosts.title,
          bodyHtml: communityPosts.bodyHtml,
          category: communityPosts.category,
          createdAt: communityPosts.createdAt,
          updatedAt: communityPosts.updatedAt,
        })
        .from(communityPosts)
        .innerJoin(users, eq(users.id, communityPosts.authorId))
        .where(
          and(
            eq(communityPosts.isDraft, false),
            eq(communityPosts.isHidden, false),
            inArray(
              communityPosts.category,
              COMMUNITY_ASSISTANT_CATEGORIES as unknown as [
                "news_announcements",
              ]
            ),
            inArray(users.role, ["admin", "super_admin"]),
            or(
              isNull(communityPosts.expiresAt),
              gt(communityPosts.expiresAt, now)
            )
          )
        ),
      db
        .select({
          courseId: academyCourses.id,
          courseTitle: academyCourses.title,
          moduleId: academyModules.id,
          moduleTitle: academyModules.title,
          releaseWeek: academyModules.releaseWeek,
          lessonId: academyLessons.id,
          lessonTitle: academyLessons.title,
          summary: academyLessons.summary,
          contentHtml: academyLessons.contentHtml,
          videoUrl: academyLessons.videoUrl,
          updatedAt: academyLessons.updatedAt,
        })
        .from(academyLessons)
        .innerJoin(
          academyModules,
          eq(academyModules.id, academyLessons.moduleId)
        )
        .innerJoin(
          academyCourses,
          eq(academyCourses.id, academyModules.courseId)
        )
        .where(
          and(
            eq(academyCourses.status, "published"),
            isNull(academyLessons.archivedAt)
          )
        ),
    ]);

  const articleSources: AgentSupportSource[] = articles.map(article => ({
    key: `kb:${article.id}`,
    kind: "knowledge_base",
    title: article.title,
    text: [article.summary, stripAgentSupportHtml(article.contentHtml)]
      .filter(Boolean)
      .join("\n"),
    href: `/knowledge-base?article=${article.id}`,
    category: article.category,
    updatedAt: article.updatedAt ?? article.publishedAt,
  }));

  const webinarSources: AgentSupportSource[] = webinars.map(webinar => {
    const transcript =
      webinar.assistantTranscriptApprovedAt && webinar.privateTranscript
        ? `Staff-reviewed transcript: ${webinar.privateTranscript}`
        : null;
    return {
      key: `webinar:${webinar.id}`,
      kind: "webinar",
      title: webinar.title,
      text: [
        webinar.summary,
        stripAgentSupportHtml(webinar.descriptionHtml),
        transcript,
      ]
        .filter(Boolean)
        .join("\n"),
      href: `/webinars?webinar=${webinar.id}`,
      category: webinar.category,
      updatedAt: webinar.updatedAt ?? webinar.publishedAt,
      timestampLabel: transcript
        ? "See linked recording for the relevant timestamp"
        : null,
    };
  });

  const supplierSources: AgentSupportSource[] = supplierRows.map(supplier => ({
    key: `supplier:${supplier.id}`,
    kind: "supplier",
    title: supplier.name,
    text: buildSupplierAgentSupportText(supplier),
    href: `/suppliers?supplierId=${supplier.id}`,
    category: supplier.categories,
    updatedAt: supplier.updatedAt,
  }));

  const communitySources: AgentSupportSource[] = communityRows.map(post => ({
    key: `community:${post.id}`,
    kind: "community",
    title: post.title,
    text: stripAgentSupportHtml(post.bodyHtml),
    href: `/community?postId=${post.id}`,
    category: post.category,
    updatedAt: post.updatedAt ?? post.createdAt,
  }));

  // Admin pilot scope deliberately lets staff validate published Academy text.
  // A future agent router must replace this with the agent's active access,
  // owned enrollment, Friday release and sequential-unlock checks before it can
  // return any course source. No assessment, progress or transcript field is
  // selected here.
  const academySources: AgentSupportSource[] = academyRows.map(lesson => ({
    key: `academy:${lesson.lessonId}`,
    kind: "academy",
    title: `${lesson.courseTitle} — ${lesson.moduleTitle}: ${lesson.lessonTitle}`,
    text: buildAcademyAgentSupportText({
      courseTitle: lesson.courseTitle,
      moduleTitle: lesson.moduleTitle,
      lessonTitle: lesson.lessonTitle,
      summary: lesson.summary,
      contentHtml: lesson.contentHtml,
    }),
    href: "/academy",
    category: lesson.courseTitle,
    updatedAt: lesson.updatedAt,
  }));

  return [
    ...articleSources,
    ...webinarSources,
    ...academySources,
    ...supplierSources,
    ...communitySources,
    ...policySources(),
    ...AGENT_PORTAL_PROCEDURE_SOURCES,
  ].filter(source => source.text.trim().length > 0);
}
