import {
  formatDigestIntro,
  type DigestIntroFormat,
} from "../shared/community-digest-format";

/** Render the digest intro using the same safe semantics as the editor preview. */
export function formatCommunityDigestIntro(
  text: string | null | undefined,
  format: DigestIntroFormat = "markdown"
): string {
  return formatDigestIntro(text, format);
}
