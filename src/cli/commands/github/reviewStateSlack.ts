/**
 * The Slack legs of the review-state read — the streamed corpus scan, the paged live search, and the
 * bounded read AROUND each live hit — and how far each reached. Split out of `./reviewStateRun.ts` along the
 * seam the run already had: nothing here reads GitHub, and nothing in the run's GitHub half reads Slack.
 *
 * The third leg is not a third source. It is the live search leg going back to look: `search.messages`
 * collapses proximate matches by documentation, so a hit is an ANCHOR. `./reviewStateReadAround.ts` does
 * that walking and `../../../review/slackNeighbourhood.ts` says what it can and cannot claim; this file
 * owns the judging, which is why the read-around hands its messages back here rather than matching them.
 *
 * Last, the visible sessions' recorded readings (`github reviewer read`) are laid over what the legs found
 * (`../../../review/readingMerge.ts`), so every consumer of `grouped` sees a settled message as settled.
 */

import { slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import type { SlackApi } from "../../../corpus/slack/fetch.js";
import { type SlackBotDeclaration, slackOwnerBotIdentity } from "../../../corpus/slack/ownerBot.js";
import { readWatermark } from "../../../corpus/watermark.js";
import type { Result } from "../../../lib/result.js";
import type { PrLiveState } from "../../../live/github/reviewState.js";
import { makeSlackSearchMessages, type SlackSearchMessages } from "../../../live/slack/searchMessages.js";
import { loadProfile } from "../../../profileStore.js";
import { reviewErrorLines } from "../../../review/errors.js";
import { applyReadings } from "../../../review/readingMerge.js";
import { type ReviewerReadRow, type ReviewerRegisterError, readingsByPr } from "../../../review/reviewerRegister.js";
import { readReviewerRegister } from "../../../review/reviewerRegisterStore.js";
import { scanCorpusMentions } from "../../../review/slackEvidenceScan.js";
import {
  prKeyOf,
  type SlackCoverage,
  type SlackIdentity,
  type SlackMention,
} from "../../../review/slackEvidenceTypes.js";
import { slackResidue } from "./reviewStateResidue.js";
import { type PrRef, readLiveSlack, refKeyOf } from "./reviewStateSlackLive.js";

/** The Slack seams the legs need — the matching fields of the run's own deps. */
export interface SlackLegDeps {
  readonly slackSearch: (args: { home: string | undefined }) => SlackSearchMessages | undefined;
  /**
   * The conversation reads that expand a collapsed search hit into its real set.
   *
   * A seam of its own rather than a field on {@link SlackLegDeps.slackSearch} because it is a different
   * Slack method family with a different completeness contract: `search.messages` reports a truncated read
   * as residue, while `conversations.history`/`.replies` are complete-or-fail
   * (`../../../live/slack/pagination.ts`).
   */
  readonly slackConversations: (args: {
    home: string | undefined;
  }) => Pick<SlackApi, "history" | "replies"> | undefined;
  readonly corpusMentions: (args: {
    home: string;
    refs: readonly PrRef[];
    identity: SlackIdentity;
  }) => Result<readonly SlackMention[]>;
  readonly slackIdentity: (args: { home: string }) => SlackIdentity;
  readonly corpusThrough: (args: { home: string }) => string | undefined;
  /**
   * `github reviewer read`'s recorded readings, by pull request then message. A register that cannot be read
   * answers with its failure, which the leg reports and reads past: a missing reading leaves the classifier's
   * own answer, never a guessed one.
   */
  readonly askReadings: (args: {
    home: string;
  }) => Result<ReadonlyMap<string, ReadonlyMap<string, ReviewerReadRow>>, ReviewerRegisterError>;
  readonly now: () => Date;
  readonly writeDiagnostic: (line: string) => void;
}

/** Group corpus mentions by their pull-request key. */
function groupByPr({ mentions }: { mentions: readonly SlackMention[] }): Map<string, SlackMention[]> {
  const grouped = new Map<string, SlackMention[]>();
  for (const mention of mentions) {
    const existing = grouped.get(mention.prKey);
    if (existing === undefined) {
      grouped.set(mention.prKey, [mention]);
      continue;
    }
    existing.push(mention);
  }
  return grouped;
}

/**
 * Run every Slack leg and report how far each reached.
 *
 * The corpus leg is ONE streamed scan for every pull request at once; the live leg is one search per pull
 * request, because Slack's own query is per-link. Splitting them this way is what keeps a forty-pull-request
 * run to a single pass over 6.3 GB of bronze rather than forty. The read-around is per CONVERSATION rather
 * than per pull request for the same reason: one walk of a channel serves every hit in it.
 *
 * @param slackLive whether the live search leg runs at all
 * @param liveHome the home whose Slack credential the live legs read
 * @param deps the Slack seams
 * @param home the state home whose bronze is scanned
 * @param prs the pull requests being read
 * @returns every mention grouped by pull request, and how far each leg reached
 */
export async function gatherSlack({
  slackLive,
  liveHome,
  deps,
  home,
  prs,
}: {
  slackLive: boolean;
  liveHome: string | undefined;
  deps: SlackLegDeps;
  home: string;
  prs: readonly PrLiveState[];
}): Promise<{ readonly grouped: Map<string, SlackMention[]>; readonly coverage: SlackCoverage }> {
  const refs = prs.map((pr) => refKeyOf({ pr }));
  const identity = deps.slackIdentity({ home });
  const scanned = deps.corpusMentions({ home, identity, refs });
  if (scanned.isErr()) {
    deps.writeDiagnostic(scanned.error.join("; "));
  }
  const grouped = groupByPr({ mentions: scanned.isOk() ? scanned.value : [] });
  const search = slackLive ? deps.slackSearch({ home: liveHome }) : undefined;
  const liveRan = search !== undefined;
  // A corpus scan that could not READ must not lend its watermark to an absence: the watermark says how far
  // ingest reached, never that this scan saw it. Withholding it is what turns every such row's `no` into
  // `unknown`, through the one rule that already decides absences.
  const corpusThroughIso = scanned.isOk() ? deps.corpusThrough({ home }) : undefined;
  const nowIso = deps.now().toISOString();
  const live = await readLiveSlack({
    // Not gated on the search leg: a share's thread read is one exhaustive read per post of the owner's, not a search, and
    // the tick and the page's Sync run without `--slack-live` — gated, a share could never carry "no reply".
    conversations: deps.slackConversations({ home: liveHome }),
    corpusThroughIso,
    grouped,
    identity,
    nowIso,
    onProblem: deps.writeDiagnostic,
    prs,
    search,
  });
  applyRecordedReadings({ deps, grouped, home, prs });
  const residue = [
    ...slackResidue({ corpusThroughIso, liveRan, neighbourhoods: live.windows, nowIso }),
    ...(scanned.isErr() ? scanned.error : []),
    ...live.problems,
  ];
  return {
    coverage: {
      corpusThroughIso,
      liveRan,
      neighbourhoods: live.windows,
      residue,
      shareThreads: live.shareThreads,
    },
    grouped,
  };
}

/**
 * Lay the recorded readings over each pull request's mentions, in place. A register that cannot be read is
 * said out loud, because a read that silently dropped the readings would put "not known" back on rows a
 * session already settled.
 */
function applyRecordedReadings({
  deps,
  grouped,
  home,
  prs,
}: {
  deps: SlackLegDeps;
  grouped: Map<string, SlackMention[]>;
  home: string;
  prs: readonly PrLiveState[];
}): void {
  const read = deps.askReadings({ home });
  if (read.isErr()) {
    deps.writeDiagnostic(`recorded ask readings were not applied: ${read.error.message}`);
    return;
  }
  for (const pr of prs) {
    const prKey = prKeyOf({ ref: refKeyOf({ pr }) });
    const readings = read.value.get(prKey);
    if (readings !== undefined) {
      grouped.set(prKey, [...applyReadings({ mentions: mentionsFor({ grouped, pr }), readings })]);
    }
  }
}

/**
 * One pull request's mentions, newest first.
 *
 * @param grouped every mention, grouped by pull-request key
 * @param pr the pull request
 * @returns its mentions, newest first
 */
export function mentionsFor({
  grouped,
  pr,
}: {
  grouped: Map<string, SlackMention[]>;
  pr: PrLiveState;
}): readonly SlackMention[] {
  const found = grouped.get(prKeyOf({ ref: refKeyOf({ pr }) }));
  return found === undefined ? [] : found.toSorted((a, b) => b.atIso.localeCompare(a.atIso));
}

/**
 * Who the owner is in Slack, from the profile's `slackBot` declaration: their id, Slopweaver's own bot ids, and their as-me
 * bot when one is declared — the whole-thread read sees that bot's rows raw and has to resolve them itself.
 *
 * @param slackBot the profile's declaration, when set
 * @returns the identity; with no declaration, nobody reads as the owner
 */
export function slackIdentityOf({
  slackBot,
}: {
  slackBot: (SlackBotDeclaration & { readonly selfUserIds?: readonly string[] }) | undefined;
}): SlackIdentity {
  if (slackBot === undefined) {
    // No Slack bot configured: no owner id and no bot ids, which reads as nobody being the owner.
    return { ownerSlackUserId: "", selfUserIds: [] };
  }
  const { ownerUserId = "", selfUserIds = [] } = slackBot;
  const ownerBot = slackOwnerBotIdentity({ slackBot });
  if (ownerBot === undefined) {
    return { ownerSlackUserId: ownerUserId, selfUserIds };
  }
  return { ownerBot, ownerSlackUserId: ownerUserId, selfUserIds };
}

/**
 * The Slack legs' production seams: the owner's Slack user token, the local corpus and its watermark, the owner's
 * identity from the profile, and the reviewer register's readings.
 *
 * @returns every Slack seam but the clock and the diagnostic channel, which the run shares with its GitHub half
 */
export function productionSlackLegDeps(): Omit<SlackLegDeps, "now" | "writeDiagnostic"> {
  return {
    askReadings: ({ home }) => readReviewerRegister({ home }).map((rows) => readingsByPr({ rows })),
    corpusMentions: ({ home, identity, refs }) =>
      scanCorpusMentions({ home, identity, refs }).mapErr((error) => reviewErrorLines({ error })),
    corpusThrough: ({ home }) => readWatermark({ home, source: "slack" }),
    slackConversations: ({ home }) => {
      const token = slackUserToken(home === undefined ? {} : { home });
      return token === undefined ? undefined : makeSlackApi({ token });
    },
    slackIdentity: ({ home }) => slackIdentityOf({ slackBot: loadProfile({ home })?.slackBot }),
    slackSearch: ({ home }) => {
      const token = slackUserToken(home === undefined ? {} : { home });
      return token === undefined ? undefined : makeSlackSearchMessages({ token });
    },
  };
}
