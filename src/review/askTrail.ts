/**
 * The ask trail — every certified review ask on one pull request, narrowed to what a reader needs to say
 * "I asked Rosa 26 hours ago, in a DM, here is the message".
 *
 * ## Why the recipients come from the classifier and never from the message's tags
 *
 * A message's `tagged` ids and its DM counterpart name everybody it reached, not everybody it asked ABOUT
 * THIS PULL REQUEST. A batch ask in a channel names several pull requests (one batch named ten), one per line with its own
 * reviewer, so a whole-message rule would name somebody who was never asked about some of the rows (two of the five still open in that batch)
 * (`./reviewState.ts`'s `askTarget`). So a trail entry carries {@link askDecisionFor}'s `recipients`,
 * which are scoped to the pull request by construction — and its first recipient is exactly the person
 * `askBumpVerdict` judges a chase against, so the name printed beside "ask again: due" is the one the
 * verdict was about.
 *
 * Pure. The mentions arrive already classified as asks by `slackReviewState`; this only projects them.
 */
import { askDecisionFor } from "./readingMerge.js";
import type { SlackMention } from "./slackEvidenceTypes.js";

/** One certified ask on one pull request, as the pull-request page and the reviewer register carry it. */
export interface LandingAsk {
  /** `channel:ts` — the message's own identity, the key two readings of one ask are deduplicated on. */
  readonly messageKey: string;
  readonly atIso: string;
  readonly permalink: string;
  /** Where it was posted, as the mention names it: `#dev-team`, or the direct message's own name. */
  readonly channel: string;
  readonly isDirectMessage: boolean;
  /** Which Slack leg found it: the local corpus, or the live search over the corpus's blind window. */
  readonly leg: "corpus" | "live";
  /** The Slack ids this message asked about THIS pull request — people (`U`/`W`) and groups (`S`). Never empty. */
  readonly recipients: readonly string[];
}

/**
 * The trail for one pull request, newest first — the order `slackReviewState` hands its asks over in.
 *
 * A mention the classifier does not certify as an ask is dropped rather than carried with no recipients:
 * `slack.asks` is already that filter's output, so a drop here means the two disagree, and a trail entry
 * naming nobody is the row this module exists to prevent.
 *
 * @param asks the certified asks for one pull request, newest first
 * @returns one entry per ask, in the same order
 */
export function askTrailOf({ asks }: { asks: readonly SlackMention[] }): readonly LandingAsk[] {
  return asks.flatMap((mention) => {
    const decision = askDecisionFor({ mention });
    if (decision.kind !== "ask") {
      return [];
    }
    return [
      {
        atIso: mention.atIso,
        channel: mention.channel,
        isDirectMessage: mention.isDirectMessage,
        leg: mention.leg,
        messageKey: mention.messageKey,
        permalink: mention.permalink,
        recipients: decision.recipients,
      },
    ];
  });
}

/**
 * Every Slack id a set of trails names, once each, in first-seen order — what the landing document resolves
 * to names so a page never prints an id the roster could have named.
 *
 * @param trails the trails of every row in one read
 * @returns the distinct recipient ids
 */
export function slackIdsOf({ trails }: { trails: readonly (readonly LandingAsk[])[] }): readonly string[] {
  const seen = new Set<string>();
  for (const trail of trails) {
    for (const ask of trail) {
      for (const id of ask.recipients) {
        seen.add(id);
      }
    }
  }
  return [...seen];
}
