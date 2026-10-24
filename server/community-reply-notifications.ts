import { createInAppNotification, getUserById } from "./db";
import { sendDirectEmail } from "./email";

const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL ?? "https://portal.thejltgroup.co.uk";

type CommunityPostForReplyNotification = {
  id: number;
  authorId: number;
  authorName: string;
  title: string;
};

type CommunityCommenterForReplyNotification = {
  id: number;
  name?: string | null;
  role: string;
  content: string;
};

type PostAuthorForReplyNotification = {
  id: number;
  name?: string | null;
  email?: string | null;
  role: string;
};

function isStaffRole(role: string | null | undefined) {
  return role === "admin" || role === "super_admin";
}

export function shouldNotifyCommunityPostAuthor(params: {
  postAuthorId: number;
  commenterId: number;
  postAuthorRole?: string | null;
}) {
  return params.postAuthorId !== params.commenterId && params.postAuthorRole === "agent";
}

export function shouldAlertSupportForCommunityReply(params: {
  postAuthorId: number;
  commenterId: number;
  postAuthorRole?: string | null;
  commenterRole: string;
}) {
  return params.postAuthorId !== params.commenterId
    && params.commenterRole === "agent"
    && isStaffRole(params.postAuthorRole);
}

export function escapeCommunityReplyHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function commentHtml(content: string) {
  return escapeCommunityReplyHtml(content).replace(/\r?\n/g, "<br />");
}

function communityPostUrl(postId: number) {
  return `${PORTAL_BASE_URL}/community?postId=${postId}`;
}

async function deliverWithoutBlocking(label: string, delivery: () => Promise<unknown>) {
  try {
    await delivery();
  } catch (error) {
    console.error(`[Community] ${label} failed:`, error);
  }
}

/**
 * Runs only after a Community reply has been successfully saved. Every delivery
 * is deliberately isolated, so a temporary email or notification issue can
 * never reject, lose, or delay the reply itself.
 */
export async function sendCommunityReplyNotifications(params: {
  post: CommunityPostForReplyNotification;
  commenter: CommunityCommenterForReplyNotification;
}) {
  const { post, commenter } = params;
  if (post.authorId === commenter.id) return;

  let postAuthor: PostAuthorForReplyNotification | undefined;
  try {
    postAuthor = await getUserById(post.authorId) as PostAuthorForReplyNotification | undefined;
  } catch (error) {
    console.error("[Community] Could not load post author for reply notifications:", error);
    return;
  }

  if (!postAuthor) return;

  const commenterName = commenter.name?.trim() || "A Community member";
  const postUrl = communityPostUrl(post.id);
  const safeTitle = escapeCommunityReplyHtml(post.title);
  const safeCommenterName = escapeCommunityReplyHtml(commenterName);
  const safeComment = commentHtml(commenter.content);
  const deliveries: Array<Promise<void>> = [];

  if (shouldNotifyCommunityPostAuthor({
    postAuthorId: post.authorId,
    commenterId: commenter.id,
    postAuthorRole: postAuthor.role,
  })) {
    deliveries.push(deliverWithoutBlocking("Community in-app reply alert", async () => {
      await createInAppNotification({
        userId: postAuthor.id,
        message: `${commenterName} replied to your Community post "${post.title}".`,
        linkUrl: `/community?postId=${post.id}`,
      });
    }));

    if (postAuthor.email) {
      deliveries.push(deliverWithoutBlocking("Community reply email to agent", async () => {
        const result = await sendDirectEmail({
          toEmail: postAuthor.email!,
          toName: postAuthor.name ?? "Agent",
          userId: postAuthor.id,
          triggerKey: "community_post_reply",
          subject: `New Community reply: ${post.title}`,
          html: `
            <p>Hi ${escapeCommunityReplyHtml(postAuthor.name ?? "there")},</p>
            <p><strong>${safeCommenterName}</strong> has replied to your Community post:</p>
            <p style="margin:16px 0;padding:12px 16px;border-left:4px solid #02E6D2;background:#f0fffe;"><strong>${safeTitle}</strong></p>
            <p><strong>Reply:</strong></p>
            <div style="margin:0 0 18px;padding:12px 16px;border:1px solid #e5e7eb;border-radius:6px;background:#ffffff;color:#333;">${safeComment}</div>
            <p><a href="${postUrl}" style="display:inline-block;background:#02E6D2;color:#1a1a2e;padding:10px 18px;border-radius:6px;font-weight:700;text-decoration:none;">Open Community post &rarr;</a></p>
          `,
        });
        if (!result.success) {
          console.error("[Community] Reply email to agent was not delivered:", result.error);
        }
      }));
    }
  }

  if (shouldAlertSupportForCommunityReply({
    postAuthorId: post.authorId,
    commenterId: commenter.id,
    postAuthorRole: postAuthor.role,
    commenterRole: commenter.role,
  })) {
    deliveries.push(deliverWithoutBlocking("Community staff-post reply support email", async () => {
      const result = await sendDirectEmail({
        toEmail: "support@thejltgroup.co.uk",
        toName: "JLT Support",
        triggerKey: "community_reply_to_staff_post",
        subject: `Community reply to staff post: ${post.title}`,
        html: `
          <p><strong>${safeCommenterName}</strong> has replied to a Community post created by <strong>${escapeCommunityReplyHtml(post.authorName || postAuthor.name || "a staff member")}</strong>.</p>
          <p><strong>Post:</strong> ${safeTitle}</p>
          <p><strong>Reply:</strong></p>
          <div style="margin:0 0 18px;padding:12px 16px;border:1px solid #e5e7eb;border-radius:6px;background:#ffffff;color:#333;">${safeComment}</div>
          <p><a href="${postUrl}" style="display:inline-block;background:#02E6D2;color:#1a1a2e;padding:10px 18px;border-radius:6px;font-weight:700;text-decoration:none;">Open Community post &rarr;</a></p>
        `,
      });
      if (!result.success) {
        console.error("[Community] Reply-to-staff-post support email was not delivered:", result.error);
      }
    }));
  }

  await Promise.all(deliveries);
}
