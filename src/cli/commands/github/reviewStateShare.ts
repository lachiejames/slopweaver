/**
 * The third review state's inputs, joined for one pull request: its Slack evidence, the live reads the clock rests
 * on, and whether anybody has picked it up on GitHub. `../../../review/channelShare.ts` is the rule; this is the
 * join `./reviewStateReport.ts` hands it.
 *
 * Pure.
 */
import type { PrLiveState } from "../../../live/github/reviewState.js";
import { type ChannelShare, channelShareOf } from "../../../review/channelShare.js";
import type { ThreadDetail } from "../../../review/prStateDetail.js";
import { isBotLogin, type SlackReviewState } from "../../../review/reviewState.js";
import { liveBeyondCorpus, type SlackCoverage } from "../../../review/slackEvidenceTypes.js";

/**
 * Whether a human other than the author has picked the pull request up on GitHub: submitted a review of ANY
 * kind — a comment counts — or opened a review thread. The channel-share state stands down on either.
 *
 * A bot is GitHub's word first — the actor's `Bot` type, since GraphQL spells a bot's login with no `[bot]`
 * suffix, so a Copilot or Renovate review would otherwise read as a colleague's — and the login spelling second.
 * A review or thread GitHub returned with NO author (a deleted account reads as a null actor) is somebody it
 * cannot name, never proof of nobody, so it counts as picked up.
 *
 * A capped read cannot carry the absence: a review or thread GitHub did not return may be a human's, so a
 * truncated list with no human in it answers true, and the share state stands down rather than claim nobody.
 *
 * @returns true when somebody has, or when a capped read cannot rule it out
 */
export function reviewedOnGithub({ pr, threads }: { pr: PrLiveState; threads: readonly ThreadDetail[] }): boolean {
  const human = ({ login, bot }: { login: string; bot: boolean }): boolean => {
    if (bot) {
      return false;
    }
    if (login === "") {
      return true;
    }
    return login !== pr.authorLogin && !isBotLogin({ login });
  };
  if (pr.reviewsTruncated || pr.threadsTruncated) {
    return true;
  }
  return (
    pr.reviews.some((review) => human({ bot: review.byBot === true, login: review.login })) ||
    threads.some((thread) => human({ bot: thread.openedByBot === true, login: thread.openedByLogin }))
  );
}

/**
 * The channel share for one pull request, read over the corpus watermark and the thread reads taken at sync time
 * rather than `slack.bounded`: the clock runs past the pull request's last GitHub activity.
 *
 * @param slack the pull request's Slack review state — its asks and every message that links it
 * @param coverage how far each Slack leg reached, the share's thread reads included
 * @param threads the pull request's review threads, read for a human who opened one
 * @param nowIso when this run was taken
 * @returns the share, or `undefined` when the state does not apply
 */
export function channelShareFor({
  pr,
  slack,
  coverage,
  threads,
  nowIso,
}: {
  pr: PrLiveState;
  slack: SlackReviewState;
  coverage: SlackCoverage;
  threads: readonly ThreadDetail[];
  nowIso: string;
}): ChannelShare | undefined {
  return channelShareOf({
    asks: slack.asks,
    evidence: {
      corpusBehind: liveBeyondCorpus({ coverage, mentions: slack.mentions }),
      corpusThroughIso: coverage.corpusThroughIso,
      threads: coverage.shareThreads,
    },
    mentions: slack.mentions,
    nowIso,
    reviewedOnGithub: reviewedOnGithub({ pr, threads }),
  });
}
