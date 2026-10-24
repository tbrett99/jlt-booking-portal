import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  escapeCommunityReplyHtml,
  shouldAlertSupportForCommunityReply,
  shouldNotifyCommunityPostAuthor,
} from "./community-reply-notifications";

const routerSource = readFileSync(resolve(process.cwd(), "server/community-router.ts"), "utf8");
const notificationSource = readFileSync(resolve(process.cwd(), "server/community-reply-notifications.ts"), "utf8");

describe("Community reply notifications", () => {
  it("notifies an agent who receives a reply from someone else", () => {
    expect(shouldNotifyCommunityPostAuthor({
      postAuthorId: 17,
      commenterId: 18,
      postAuthorRole: "agent",
    })).toBe(true);
  });

  it("does not notify someone about their own reply or send agent alerts for staff posts", () => {
    expect(shouldNotifyCommunityPostAuthor({
      postAuthorId: 17,
      commenterId: 17,
      postAuthorRole: "agent",
    })).toBe(false);
    expect(shouldNotifyCommunityPostAuthor({
      postAuthorId: 17,
      commenterId: 18,
      postAuthorRole: "admin",
    })).toBe(false);
  });

  it("alerts support only when an agent replies to a staff-created post", () => {
    expect(shouldAlertSupportForCommunityReply({
      postAuthorId: 17,
      commenterId: 18,
      postAuthorRole: "super_admin",
      commenterRole: "agent",
    })).toBe(true);
    expect(shouldAlertSupportForCommunityReply({
      postAuthorId: 17,
      commenterId: 18,
      postAuthorRole: "admin",
      commenterRole: "admin",
    })).toBe(false);
    expect(shouldAlertSupportForCommunityReply({
      postAuthorId: 17,
      commenterId: 18,
      postAuthorRole: "agent",
      commenterRole: "agent",
    })).toBe(false);
  });

  it("escapes commenter text before placing it in notification email HTML", () => {
    expect(escapeCommunityReplyHtml(`<script>alert("x")</script> & 'text'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;text&#39;",
    );
  });

  it("delivers best-effort notifications only after the Community comment is saved", () => {
    const saveCommentAt = routerSource.indexOf("const commentId = await createComment");
    const notifyAt = routerSource.indexOf("void sendCommunityReplyNotifications");

    expect(saveCommentAt).toBeGreaterThan(-1);
    expect(notifyAt).toBeGreaterThan(saveCommentAt);
    expect(routerSource).toContain("Reply notification dispatcher failed");
    expect(notificationSource).toContain("await Promise.all(deliveries)");
    expect(notificationSource).toContain("async function deliverWithoutBlocking");
  });

  it("uses correspondence-aware agent delivery and one audited support email", () => {
    expect(notificationSource).toContain("userId: postAuthor.id");
    expect(notificationSource).toContain('triggerKey: "community_post_reply"');
    expect(notificationSource).toContain('triggerKey: "community_reply_to_staff_post"');
    expect(notificationSource).toContain('toEmail: "support@thejltgroup.co.uk"');
    expect(notificationSource).toContain('linkUrl: `/community?postId=${post.id}`');
  });
});
