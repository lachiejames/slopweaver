/**
 * The pure half of the suggestion card: the words a tier is drawn with, and the slots an approve press sends. A "not
 * them" carries the owner's words, so it is said in the call's chat with the pull request open — the console takes no typed
 * words. Pure, so the one mapping a press depends on — owner/name to the bare repository name the
 * act's `id` slot accepts — is tested rather than trusted.
 */
import type { ReviewerTier } from "../components/live/readReviewers";

/** The act row an approve presses. */
export const APPROVE_SLUG = "reviewer-approve";

/**
 * The tier as a reader says it. A history tier says so, because a suggestion read as ownership is the
 * failure the verb's own basis sentence is worded against.
 *
 * @returns the words
 */
export function tierWords({ tier }: { tier: ReviewerTier }): string {
  switch (tier) {
    case "named-code-owner":
      return "code owner";
    case "team-history":
      return "who you asked for this team";
    case "repo-history":
      return "who you asked in this repository";
    default: {
      const never: never = tier;
      return never;
    }
  }
}

/**
 * The slots an approve sends. The repository is the bare name: an `id` slot refuses a slash, and the verb
 * resolves a bare name against the reading and refuses one that names two repositories.
 *
 * @param repoSlug the row's `owner/name`
 * @param number the pull request number
 * @param reviewer the Slack member id the owner is approving
 * @returns the slots
 */
export function approveSlotsOf({
  repoSlug,
  number,
  reviewer,
}: {
  repoSlug: string;
  number: number;
  reviewer: string;
}): Record<string, string> {
  const bare = repoSlug.slice(repoSlug.lastIndexOf("/") + 1);
  return { number: String(number), repo: bare, reviewer };
}
