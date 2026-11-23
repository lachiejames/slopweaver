/**
 * The third Slack leg of the review-state read: going back and READING AROUND each live search hit.
 *
 * It is not a third source. `search.messages` collapses proximate matches by documentation, so a hit is an
 * ANCHOR rather than a result set — `../../../review/slackNeighbourhood.ts` holds the pure half, and says
 * exactly what reading around one can and cannot claim.
 *
 * Split out of `./reviewStateSlack.ts` along the seam the leg already had: nothing here judges a message
 * against a pull request. What it reads goes to the caller's {@link FoldCandidates}, which owns the matcher,
 * the run's pull requests and the corpus half being merged into.
 */

import type { SlackApi } from "../../../corpus/slack/fetch.js";
import { slackTsFromEpochMs } from "../../../lib/slackTs.js";
import { fetchCompleteSlackHistory, fetchCompleteSlackThread } from "../../../live/slack/pagination.js";
import type { SlackSearchMatch } from "../../../live/slack/searchMessages.js";
import { shareThreadOf, shareThreadRootsOf } from "../../../review/channelShareEvidence.js";
import type {
  LiveCandidate,
  NeighbourhoodWindow,
  ShareThreadRead,
  SlackIdentity,
  SlackMention,
} from "../../../review/slackEvidenceTypes.js";
import {
  historyCandidates,
  NEIGHBOURHOOD_CHANNEL_CAP,
  NEIGHBOURHOOD_HISTORY_MAX_PAGES,
  NEIGHBOURHOOD_THREAD_CAP,
  type NeighbourhoodAnchor,
  type NeighbourhoodChannel,
  neighbourhoodAnchors,
  neighbourhoodChannels,
  threadsActiveInWindow,
} from "../../../review/slackNeighbourhood.js";

/** Where a read-around's messages go — the caller judges them against every pull request in its run. */
type FoldCandidates = (args: { candidates: readonly LiveCandidate[] }) => void;

/** Every row one conversation's window holds, and everything that stopped it being all of them. */
interface WindowRows {
  readonly rawMessages: readonly unknown[];
  readonly problems: readonly string[];
  readonly exceededCap: boolean;
}

/**
 * Add every thread the window touches to the history rows already read.
 *
 * `conversations.history` returns top-level rows only, so a reply is invisible to it. Two sets of roots are
 * opened: each anchor's OWN thread whatever its root's age — a hit that is a reply under an older root is
 * exactly where a collapsed ask-and-bump burst sits — and every thread whose newest reply lands in the
 * window. A root that will not open is a problem rather than a stop: the rest of the conversation is still
 * worth reading, and the caller withholds the window on any problem at all.
 *
 * @param api the conversation read seam
 * @param channelId the conversation the roots belong to
 * @param anchors every anchor in this conversation
 * @param history the top-level rows the window walk already returned
 * @param oldest where the window starts, as a Slack timestamp
 * @returns every row the window holds, every root that would not open, and whether the thread bound bit
 */
async function gatherWindowRows({
  api,
  channelId,
  anchors,
  history,
  oldest,
}: {
  api: Pick<SlackApi, "history" | "replies">;
  channelId: string;
  anchors: readonly NeighbourhoodAnchor[];
  history: readonly unknown[];
  oldest: string;
}): Promise<WindowRows> {
  const plan = threadsActiveInWindow({ cap: NEIGHBOURHOOD_THREAD_CAP, oldestTs: oldest, rawMessages: history });
  const roots = [...new Set([...anchors.map((anchor) => anchor.threadTs), ...plan.roots])];
  const rawMessages: unknown[] = [...history];
  const problems: string[] = [];
  for (const threadTs of roots) {
    const thread = await fetchCompleteSlackThread({ api, channel: channelId, threadTs });
    if (thread.isErr()) {
      problems.push(`read-around of thread ${threadTs} in ${channelId} failed: ${thread.error.message}`);
      continue;
    }
    rawMessages.push(...thread.value.rawMessages);
  }
  return { exceededCap: plan.exceededCap, problems, rawMessages };
}

/** What one conversation's read-around produced. */
interface ChannelReadAround {
  /** The window it may claim, absent when any part of the walk could not be completed. */
  readonly window: NeighbourhoodWindow | undefined;
  readonly problems: readonly string[];
}

/**
 * Read one conversation exhaustively over the corpus's blind window, and around each anchor's own thread.
 *
 * Every failure withholds the WINDOW rather than shortening it — a half-read window carries no claim — while
 * whatever was read is still folded in, because a message found is a message found whatever else went wrong.
 *
 * @param api the conversation read seam
 * @param channel the conversation to read around, as the anchors named it
 * @param anchors every anchor in this conversation, whose own threads are opened whatever their age
 * @param fromIso the corpus watermark, which is where the window starts
 * @param nowIso when this read was taken, which is where the window ends
 * @param fold where what it read goes to be judged
 * @returns the window it may claim, and every reason it could not claim one
 */
async function readAroundChannel({
  api,
  channel,
  anchors,
  fromIso,
  nowIso,
  fold,
}: {
  api: Pick<SlackApi, "history" | "replies">;
  channel: NeighbourhoodChannel;
  anchors: readonly NeighbourhoodAnchor[];
  fromIso: string;
  nowIso: string;
  fold: FoldCandidates;
}): Promise<ChannelReadAround> {
  const label = channel.channelId;
  const oldest = slackTsFromEpochMs({ ms: Date.parse(fromIso) });
  const history = await fetchCompleteSlackHistory({
    api,
    channel: channel.channelId,
    latest: slackTsFromEpochMs({ ms: Date.parse(nowIso) }),
    maxPages: NEIGHBOURHOOD_HISTORY_MAX_PAGES,
    oldest,
    paced: true,
  });
  if (history.isErr()) {
    return { problems: [`read-around of ${label} failed: ${history.error.message}`], window: undefined };
  }
  const rows = await gatherWindowRows({
    anchors,
    api,
    channelId: channel.channelId,
    history: history.value.rawMessages,
    oldest,
  });
  const problems = [...rows.problems];
  const candidates = historyCandidates({
    channelId: channel.channelId,
    channelName: channel.channelName,
    rawMessages: rows.rawMessages,
    workspace: channel.workspace,
  });
  if (candidates.isErr()) {
    return {
      problems: [...problems, `read-around of ${label} is unreadable: ${candidates.error.message}`],
      window: undefined,
    };
  }
  fold({ candidates: candidates.value });
  if (rows.exceededCap) {
    problems.push(
      `read-around of ${label} opened ${String(NEIGHBOURHOOD_THREAD_CAP)} threads, the bound, so its window carries no absence`,
    );
  }
  const complete = problems.length === 0;
  return {
    problems,
    window: complete ? { channelId: channel.channelId, fromIso, throughIso: nowIso } : undefined,
  };
}

/**
 * Go back and read around every live hit this run produced.
 *
 * Skipped entirely when the corpus has never been ingested: the window a read-around claims starts at the
 * corpus watermark, and with no watermark there is no window to name — nor any absence it could rescue,
 * since `absenceBounded` refuses on the missing corpus first.
 *
 * @param api the conversation read seam
 * @param matches every hit the live searches returned
 * @param corpusThroughIso the corpus watermark, or undefined when Slack has never been ingested
 * @param nowIso when this run was taken
 * @param fold where what it read goes to be judged
 * @returns the windows this run may claim, and every reason one is missing
 */
export async function readAroundHits({
  api,
  matches,
  corpusThroughIso,
  nowIso,
  fold,
}: {
  api: Pick<SlackApi, "history" | "replies">;
  matches: readonly SlackSearchMatch[];
  corpusThroughIso: string | undefined;
  nowIso: string;
  fold: FoldCandidates;
}): Promise<{ readonly windows: readonly NeighbourhoodWindow[]; readonly problems: readonly string[] }> {
  if (corpusThroughIso === undefined) {
    return { problems: [], windows: [] };
  }
  const anchors = neighbourhoodAnchors({ matches });
  const plan = neighbourhoodChannels({ anchors, cap: NEIGHBOURHOOD_CHANNEL_CAP });
  const windows: NeighbourhoodWindow[] = [];
  const problems: string[] = [];
  if (plan.skipped.length > 0) {
    problems.push(
      `${String(plan.skipped.length)} conversation(s) with a live hit were NOT read around (the ` +
        `${String(NEIGHBOURHOOD_CHANNEL_CAP)}-conversation bound): ${plan.skipped.join(" ")}`,
    );
  }
  for (const channel of plan.channels) {
    const read = await readAroundChannel({
      anchors: anchors.filter((anchor) => anchor.channelId === channel.channelId),
      api,
      channel,
      fold,
      fromIso: corpusThroughIso,
      nowIso,
    });
    problems.push(...read.problems);
    if (read.window !== undefined) {
      windows.push(read.window);
    }
  }
  return { problems, windows };
}

/**
 * Read the whole thread under every channel post of the owner's that links a pull request in the run.
 *
 * A share's clock needs these because a reply need not link anything, so neither search leg can see one. One read
 * per thread serves every pull request it is under. A thread that will not read, or reads back a row it cannot
 * place, is left out rather than kept half-read: its share then carries no absence (`../../../review/channelShare.ts`).
 *
 * @param api the conversation read seam
 * @param grouped every message the legs found, by pull-request key
 * @param identity who the owner is and which ids are the owner's own bot, so a reply can be placed as a colleague's
 * @param nowIso when this run was taken, which is when each thread is read through
 * @returns each thread read, by thread key, and every reason one is missing
 */
export async function readShareThreads({
  api,
  grouped,
  identity,
  nowIso,
}: {
  api: Pick<SlackApi, "replies">;
  grouped: ReadonlyMap<string, readonly SlackMention[]>;
  identity: SlackIdentity;
  nowIso: string;
}): Promise<{ readonly reads: Readonly<Record<string, ShareThreadRead>>; readonly problems: readonly string[] }> {
  const reads: Record<string, ShareThreadRead> = {};
  const problems: string[] = [];
  for (const root of shareThreadRootsOf({ grouped })) {
    const thread = await fetchCompleteSlackThread({ api, channel: root.channelId, threadTs: root.rootTs });
    if (thread.isErr()) {
      problems.push(`the thread under a shared post, ${root.threadKey}, would not read: ${thread.error.message}`);
      continue;
    }
    const read = shareThreadOf({ identity, rawMessages: thread.value.rawMessages, readAtIso: nowIso, root });
    if (read === undefined) {
      problems.push(`the thread under a shared post, ${root.threadKey}, returned a row it cannot place`);
      continue;
    }
    reads[root.threadKey] = read;
  }
  return { problems, reads };
}
