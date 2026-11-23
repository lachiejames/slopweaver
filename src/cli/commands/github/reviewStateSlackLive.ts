/**
 * The live half of the review-state read's Slack legs — the paged search per pull request, the bounded read
 * AROUND each hit, and the whole thread under each channel post of the owner's — folded into the corpus half as each
 * read lands. Split out of `./reviewStateSlack.ts`, which runs the corpus scan, lays the recorded readings
 * over the result and says how far each leg reached; nothing here reads the corpus.
 */

import type { SlackApi } from "../../../corpus/slack/fetch.js";
import type { PrLiveState } from "../../../live/github/reviewState.js";
import {
  type SlackSearchMatch,
  type SlackSearchMessages,
  type SlackSearchReceipt,
  searchAllPages,
} from "../../../live/slack/searchMessages.js";
import { mergeMentions } from "../../../review/slackEvidence.js";
import { judgeLiveCandidates } from "../../../review/slackEvidenceLive.js";
import {
  type LiveCandidate,
  prKeyOf,
  type SlackCoverage,
  type SlackIdentity,
  type SlackMention,
} from "../../../review/slackEvidenceTypes.js";
import { linkingCandidates } from "../../../review/slackNeighbourhood.js";
import { readAroundHits, readShareThreads } from "./reviewStateReadAround.js";

/** How many search candidates the live Slack leg asks for per page. */
const LIVE_SEARCH_COUNT = 100;

/**
 * The most pages the live leg reads for one pull request. A result spanning more is reported incomplete in the
 * run's residue, never cut silently. Five pages is five hundred linking messages for ONE pull request.
 */
const LIVE_SEARCH_MAX_PAGES = 5;

/** A pull request the run is reading, as the two Slack legs name one. */
export type PrRef = { owner: string; repo: string; number: number };

/**
 * The `{owner, repo, number}` a pull request's slug and number make.
 *
 * @returns the reference both Slack legs name the pull request by
 */
export function refKeyOf({ pr }: { pr: PrLiveState }): PrRef {
  const [owner = "", repo = ""] = pr.repoSlug.split("/");
  return { number: pr.number, owner, repo };
}

/**
 * Fold one set of judged live candidates into the corpus half, for every pull request the run is reading.
 *
 * @param candidates what a live read produced, before judgement
 * @param refs every pull request in the run
 * @param identity who the owner is, so a match can be placed as the owner's or somebody else's
 * @param grouped the corpus half, mutated in place
 */
function foldCandidates({
  candidates,
  refs,
  identity,
  grouped,
}: {
  candidates: readonly LiveCandidate[];
  refs: readonly PrRef[];
  identity: SlackIdentity;
  grouped: Map<string, SlackMention[]>;
}): void {
  // One read serves every pull request, so the matcher would otherwise run once per message per pull
  // request. The pre-filter is what keeps that proportional to the evidence — see `linkingCandidates`.
  const linking = linkingCandidates({ candidates });
  for (const ref of refs) {
    const live = judgeLiveCandidates({ candidates: linking, identity, ref });
    if (live.length === 0) {
      continue;
    }
    const key = prKeyOf({ ref });
    const corpus = grouped.get(key);
    if (corpus === undefined) {
      grouped.set(key, [...mergeMentions({ corpus: [], live })]);
      continue;
    }
    grouped.set(key, [...mergeMentions({ corpus, live })]);
  }
}

/**
 * Run the live Slack leg for one pull request, folding what it finds into the corpus half.
 *
 * @param search the live search seam
 * @param pr the pull request being looked for
 * @param refs every pull request in the run, so one read serves them all
 * @param grouped the corpus half, mutated in place
 * @param identity who the owner is, so a live match can be placed as the owner's or somebody else's
 * @param onProblem where a failed search is reported
 * @returns what the search read, so an incomplete one reaches the run's residue, and the hits it returned
 */
async function foldLiveLeg({
  search,
  pr,
  refs,
  grouped,
  identity,
  onProblem,
}: {
  search: SlackSearchMessages;
  pr: PrLiveState;
  refs: readonly PrRef[];
  grouped: Map<string, SlackMention[]>;
  identity: SlackIdentity;
  onProblem: (line: string) => void;
}): Promise<{ readonly receipt: SlackSearchReceipt; readonly matches: readonly SlackSearchMatch[] }> {
  const ref = refKeyOf({ pr });
  const key = prKeyOf({ ref });
  const found = await searchAllPages({
    count: LIVE_SEARCH_COUNT,
    maxPages: LIVE_SEARCH_MAX_PAGES,
    query: pr.url,
    search,
  });
  if (!found.receipt.complete) {
    onProblem(`${key}: live Slack search incomplete — ${found.receipt.stoppedBecause}`);
  }
  foldCandidates({ candidates: found.matches, grouped, identity, refs });
  return { matches: found.matches, receipt: found.receipt };
}

/**
 * The live search leg, one search per pull request, folded into `grouped` as it goes.
 *
 * @param search the live search seam, or `undefined` when the leg does not run
 * @param refs every pull request in the run, so a hit linking another one is placed too
 * @param onProblem where an incomplete search is said out loud
 * @returns every receipt and hit, and each pull request's own search by key
 */
async function searchEachPr({
  search,
  prs,
  grouped,
  identity,
  refs,
  onProblem,
}: {
  search: SlackSearchMessages | undefined;
  prs: readonly PrLiveState[];
  grouped: Map<string, SlackMention[]>;
  identity: SlackIdentity;
  refs: readonly PrRef[];
  onProblem: (line: string) => void;
}): Promise<{
  readonly receipts: readonly SlackSearchReceipt[];
  readonly matches: readonly SlackSearchMatch[];
}> {
  const receipts: SlackSearchReceipt[] = [];
  const matches: SlackSearchMatch[] = [];
  if (search === undefined) {
    return { matches, receipts };
  }
  for (const pr of prs) {
    const leg = await foldLiveLeg({ grouped, identity, onProblem, pr, refs, search });
    receipts.push(leg.receipt);
    matches.push(...leg.matches);
  }
  return { matches, receipts };
}

/**
 * The conversation reads: the read-around of every conversation a live search hit, and the whole thread under
 * every channel post of the owner's. Nothing is read when the
 * conversation seam is absent.
 *
 * @param conversations the conversation read seam, or `undefined` when live Slack did not run or has no token
 * @param corpusThroughIso the corpus watermark each read-around starts from
 * @param matches every live hit
 * @returns the windows read, each thread read by key, and every reason one is missing
 */
async function readLiveConversations({
  conversations,
  corpusThroughIso,
  grouped,
  identity,
  matches,
  nowIso,
  refs,
}: {
  conversations: Pick<SlackApi, "history" | "replies"> | undefined;
  corpusThroughIso: string | undefined;
  grouped: Map<string, SlackMention[]>;
  identity: SlackIdentity;
  matches: readonly SlackSearchMatch[];
  nowIso: string;
  refs: readonly PrRef[];
}): Promise<
  Pick<SlackCoverage, "shareThreads"> & { windows: SlackCoverage["neighbourhoods"]; problems: readonly string[] }
> {
  if (conversations === undefined) {
    return { problems: [], shareThreads: {}, windows: [] };
  }
  const around = await readAroundHits({
    api: conversations,
    corpusThroughIso,
    fold: ({ candidates }) => {
      foldCandidates({ candidates, grouped, identity, refs });
    },
    matches,
    nowIso,
  });
  // Readings attach a verdict and never move a post, so the threads to read are known before they apply.
  const threads = await readShareThreads({ api: conversations, grouped, identity, nowIso });
  return { problems: [...around.problems, ...threads.problems], shareThreads: threads.reads, windows: around.windows };
}

/**
 * The whole live half: one search per pull request, then the conversation reads its hits call for, all folded
 * into `grouped` as they go. A leg that does not run reads nothing and claims nothing.
 *
 * @param search the live search seam, or `undefined` when the leg does not run
 * @param conversations the conversation read seam, or `undefined` when live Slack did not run or has no token
 * @param corpusThroughIso the corpus watermark each read-around starts from
 * @param grouped the corpus half, mutated in place
 * @param identity who the owner is, so a live message can be placed as the owner's or somebody else's
 * @param onProblem where an incomplete search is said out loud as it happens
 * @returns the windows and threads read, and every reason a read is missing
 */
export async function readLiveSlack({
  search,
  conversations,
  corpusThroughIso,
  grouped,
  identity,
  nowIso,
  onProblem,
  prs,
}: {
  search: SlackSearchMessages | undefined;
  conversations: Pick<SlackApi, "history" | "replies"> | undefined;
  corpusThroughIso: string | undefined;
  grouped: Map<string, SlackMention[]>;
  identity: SlackIdentity;
  nowIso: string;
  onProblem: (line: string) => void;
  prs: readonly PrLiveState[];
}): Promise<
  Pick<SlackCoverage, "shareThreads"> & {
    readonly windows: SlackCoverage["neighbourhoods"];
    readonly problems: readonly string[];
  }
> {
  const refs = prs.map((pr) => refKeyOf({ pr }));
  const { receipts, matches } = await searchEachPr({ grouped, identity, onProblem, prs, refs, search });
  const read = await readLiveConversations({
    conversations,
    corpusThroughIso,
    grouped,
    identity,
    matches,
    nowIso,
    refs,
  });
  const incomplete = receipts
    .filter((receipt) => !receipt.complete)
    .map((receipt) => `live Slack search for ${receipt.query} is incomplete: ${receipt.stoppedBecause}`);
  return { ...read, problems: [...incomplete, ...read.problems] };
}
