/**
 * Reading AROUND a live `search.messages` hit, so one collapsed match expands into the real set.
 *
 * ## The defect this repairs, and why a second read is the only repair
 *
 * Slack documents that `search.messages` collapses proximate matches — *"when a search query matches
 * multiple messages in close proximity to one another, only one match will be returned"* — and WHICH one it
 * returns is not stable. MEASURED on one real pull request: two messages minutes apart in one channel both
 * linked it, the search returned the one carrying no mention run, `github review-state` reported that nobody
 * had been asked, and a later identical query returned the OTHER message. No amount of paging fixes that,
 * because the collapsed sibling is not on any page: the only way to see it is to go and read the messages
 * around the hit that WAS returned.
 *
 * So every hit is treated as an ANCHOR rather than as evidence in its own right, and two bounded reads are
 * taken around it — its own thread in full, and its channel's top-level rows over the window the corpus does
 * not cover. Both are judged by `./slackEvidenceLive.ts`'s `judgeLiveCandidates`, the same exact matcher the
 * search leg's own hits go through, so nothing here forks what counts as a link or an ask.
 *
 * ## What the read can and cannot claim, stated rather than discovered
 *
 * The claim it buys is narrow and exact: **everything Slack could have collapsed AGAINST A RETURNED HIT has
 * now been read.** Collapsing is defined by proximity to the match it returned, so a collapsed sibling is
 * either in that hit's own thread or adjacent to it in the channel, and both are covered. That is precisely
 * what `./absenceBounded.ts`'s `absenceBounded` needs to stop treating one live hit as proof the exhaustive leg
 * is behind.
 *
 * It is NOT a claim that the window holds nothing else, and three bounds are why:
 *
 *  - `conversations.history` returns TOP-LEVEL rows only. A reply under a root older than the window is
 *    invisible to it, and no walk short of every thread in the channel would see one.
 *  - A candidate is judged on its own `text`, exactly as a search hit is, so a pull request reached only
 *    through an unfurled attachment or a quote is outside this leg on both halves.
 *  - Slack's search index is the anchor generator. A channel it returned no hit for is not read around at
 *    all, so an unindexed message in such a channel is seen by neither leg.
 *
 * Only the exhaustive corpus scan carries a general absence, which is the owner's standing ruling and is
 * unchanged by any of this — see `./absenceBounded.ts`'s `absenceBounded`.
 */

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { slackTsToIso } from "../lib/slackTs.js";
import { type SlackNeighbourhoodError, SlackNeighbourhoodErrors } from "../live/slack/neighbourhoodErrors.js";
import type { SlackSearchMatch } from "../live/slack/searchMessages.js";
import { findPrLinks } from "./prLink.js";
import type { LiveCandidate } from "./slackEvidenceTypes.js";

/**
 * The most distinct conversations one run reads around.
 *
 * `github landing` runs the live leg over a whole fleet of pull requests, so the anchors of one run can span
 * many conversations and an uncapped read would walk the workspace. The cap sheds the OLDEST evidence first
 * (see {@link neighbourhoodChannels}), because the newest hit is the one the corpus is least likely to hold.
 */
export const NEIGHBOURHOOD_CHANNEL_CAP = 12;

/**
 * The most threads one conversation's read walks in full.
 *
 * A run that would exceed it reports the conversation UNREAD rather than partly read — a window walked
 * halfway carries no claim at all, and `../live/slack/pagination.ts`'s complete-or-fail contract is the
 * same idea one layer down.
 */
export const NEIGHBOURHOOD_THREAD_CAP = 24;

/**
 * The most `conversations.history` pages one conversation's walk reads before it refuses.
 *
 * The window's SIZE is opened by data this read does not control — it starts at the corpus watermark, so a
 * corpus a fortnight stale asks for a fortnight of a busy channel. Tighter than
 * `../live/slack/pagination.ts`'s own 200-page ceiling for the same reason `searchAllPages` takes a bound:
 * a read this one is running fifteen of must have a worst case a reader would wait for. A walk that would
 * exceed it refuses, so the conversation claims no window and the residue says to refresh — which is the
 * honest answer, since a corpus that stale cannot carry an absence on any other ground either.
 */
export const NEIGHBOURHOOD_HISTORY_MAX_PAGES = 10;

/** One live search hit, read as a place to go and look rather than as evidence. */
export interface NeighbourhoodAnchor {
  readonly channelId: string;
  /** Slack's own channel name, as the search hit spelled it — a `D…` conversation names its counterpart. */
  readonly channelName: string;
  /** The ROOT of the thread the hit sits in, which is the hit's own `ts` when it is not a reply. */
  readonly threadTs: string;
  /** The workspace origin the hit's permalink carries, so a neighbour's permalink is built from Slack's own. */
  readonly workspace: string;
  readonly atIso: string;
}

/** One conversation to read around, and the newest anchor that named it. */
export interface NeighbourhoodChannel {
  readonly channelId: string;
  readonly channelName: string;
  readonly workspace: string;
  readonly newestAnchorIso: string;
}

/** Which conversations a run reads around, and the ones a cap shed. */
export interface NeighbourhoodChannelPlan {
  readonly channels: readonly NeighbourhoodChannel[];
  /** The conversations the cap excluded, newest-first, as Slack names them. */
  readonly skipped: readonly string[];
}

/** The `?thread_ts=` a reply's permalink carries, which names the thread the hit really sits in. */
const THREAD_TS_QUERY = /[?&]thread_ts=([0-9]+\.[0-9]+)/;

/**
 * The workspace origin a Slack permalink was built on.
 *
 * Taken off the hit's OWN permalink rather than resolved through `auth.test`, because the provider already
 * spelled it there and a second round trip could only disagree with it.
 *
 * @param permalink the hit's permalink
 * @returns the origin, e.g. `https://example.slack.com`, or the empty string when the link is unreadable
 */
export function workspaceOfPermalink({ permalink }: { permalink: string }): string {
  const marker = "/archives/";
  const at = permalink.indexOf(marker);
  if (at <= 0) {
    return "";
  }
  return permalink.slice(0, at);
}

/** The thread root a hit belongs to: the one its permalink names, else the hit's own `ts`. */
function threadTsOf({ match }: { match: SlackSearchMatch }): string {
  const fromQuery = THREAD_TS_QUERY.exec(match.permalink)?.[1];
  if (fromQuery === undefined) {
    return match.ts;
  }
  return fromQuery;
}

/**
 * Where to go and look for what the search collapsed.
 *
 * A hit that is a thread REPLY names its root only in its permalink's query string, and the root is what
 * `conversations.replies` has to be called with — so a hit whose permalink cannot be read falls back to its
 * own `ts`, which is the correct root for every top-level message and is never worse than not looking.
 *
 * @param matches the hits the live search returned
 * @returns one anchor per hit that carries a conversation id and a timestamp
 */
export function neighbourhoodAnchors({
  matches,
}: {
  matches: readonly SlackSearchMatch[];
}): readonly NeighbourhoodAnchor[] {
  const anchors: NeighbourhoodAnchor[] = [];
  for (const match of matches) {
    if (match.channelId === "" || match.ts === "") {
      continue;
    }
    anchors.push({
      atIso: match.tsIso,
      channelId: match.channelId,
      channelName: match.channelName,
      threadTs: threadTsOf({ match }),
      workspace: workspaceOfPermalink({ permalink: match.permalink }),
    });
  }
  return anchors;
}

/**
 * Which conversations this run reads around, newest evidence first, capped.
 *
 * @param anchors every anchor the run's hits produced
 * @param cap the most conversations to read around
 * @returns the conversations to walk, and the ones the cap shed
 */
export function neighbourhoodChannels({
  anchors,
  cap,
}: {
  anchors: readonly NeighbourhoodAnchor[];
  cap: number;
}): NeighbourhoodChannelPlan {
  const byChannel = new Map<string, NeighbourhoodChannel>();
  for (const anchor of anchors) {
    const seen = byChannel.get(anchor.channelId);
    // The WORKSPACE is kept from whichever anchor could name one, independently of which is newest: an
    // unreadable permalink names no origin, and a neighbour's own permalink is built from it.
    const workspace = anchor.workspace === "" && seen !== undefined ? seen.workspace : anchor.workspace;
    if (seen !== undefined && seen.newestAnchorIso >= anchor.atIso) {
      byChannel.set(anchor.channelId, { ...seen, workspace });
      continue;
    }
    byChannel.set(anchor.channelId, {
      channelId: anchor.channelId,
      channelName: anchor.channelName,
      newestAnchorIso: anchor.atIso,
      workspace,
    });
  }
  const ranked = [...byChannel.values()].toSorted((left, right) =>
    right.newestAnchorIso.localeCompare(left.newestAnchorIso),
  );
  return {
    channels: ranked.slice(0, Math.max(0, cap)),
    skipped: ranked.slice(Math.max(0, cap)).map((channel) => describeChannel({ channel })),
  };
}

/** How a residue line names one conversation it did not read around. */
function describeChannel({ channel }: { channel: NeighbourhoodChannel }): string {
  if (channel.channelName === "") {
    return channel.channelId;
  }
  if (channel.channelId.startsWith("D")) {
    return `dm:${channel.channelName}`;
  }
  return `#${channel.channelName}`;
}

/** Which threads a window's top-level rows say have been active inside it, and whether a cap refused them. */
export interface ThreadWalkPlan {
  /** Thread ROOT timestamps to read in full. */
  readonly roots: readonly string[];
  /** True when more threads were active in the window than the cap allows, so the window carries no claim. */
  readonly exceededCap: boolean;
}

/**
 * The threads a channel's window read has to open to see a reply the top-level rows do not carry.
 *
 * `conversations.history` returns top-level messages only, so a burst of replies — exactly the shape an
 * ask-and-bump sequence has, and exactly what Slack's search collapses — is invisible to it. A root whose
 * own `latest_reply` falls inside the window has been active in it and is opened; one whose replies are all
 * older than the window has nothing the corpus does not already hold.
 *
 * @param rawMessages the channel's top-level rows, as `conversations.history` returned them
 * @param oldestTs the window's start, Slack's decimal `ts`
 * @param cap the most threads one conversation may open
 * @returns the roots to walk, and whether the cap refused the window outright
 */
export function threadsActiveInWindow({
  rawMessages,
  oldestTs,
  cap,
}: {
  rawMessages: readonly unknown[];
  oldestTs: string;
  cap: number;
}): ThreadWalkPlan {
  const roots: string[] = [];
  for (const raw of rawMessages) {
    if (!isRecord(raw)) {
      continue;
    }
    const ts = raw["ts"];
    const latestReply = raw["latest_reply"];
    const replyCount = raw["reply_count"];
    const hasReplies = typeof replyCount === "number" && replyCount > 0;
    if (typeof ts !== "string" || !hasReplies || typeof latestReply !== "string") {
      continue;
    }
    if (compareTs({ left: latestReply, right: oldestTs }) >= 0) {
      roots.push(ts);
    }
  }
  return { exceededCap: roots.length > cap, roots: roots.slice(0, Math.max(0, cap)) };
}

/**
 * Compare two Slack decimal timestamps numerically, so `1787942086.7` orders below `1787942086.747699`
 * rather than above it the way a string comparison puts them.
 *
 * @param left one timestamp
 * @param right the other
 * @returns negative when `left` is older, positive when it is newer, zero when they are the same instant
 */
function compareTs({ left, right }: { left: string; right: string }): number {
  const a = Number.parseFloat(left);
  const b = Number.parseFloat(right);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return left.localeCompare(right);
  }
  return a - b;
}

/**
 * Turn raw `conversations.history`/`.replies` rows into candidates the live leg's own matcher can judge.
 *
 * The rows are read RAW rather than through `../live/slack/neighbourhood.ts`'s `ChannelMessageSummary`,
 * whose `textPreview` is cut at 240 characters and which carries no mention runs at all: judging that would
 * miss a link past the cut and every `<@…>` beside it, which is the one thing this read exists to find.
 *
 * A row it cannot read REFUSES the whole set rather than being dropped, because a dropped row is exactly
 * the collapsed sibling this read went looking for — the same reason `projectChannelHistory` refuses one.
 *
 * @param rawMessages every row the walk returned, from any number of calls
 * @param channelId the conversation these rows came from
 * @param channelName Slack's own name for it, as the anchor's hit spelled it
 * @param workspace the origin a neighbour's permalink is built on
 * @returns one candidate per distinct message, oldest first, or the first reason the set is untrustworthy
 */
export function historyCandidates({
  rawMessages,
  channelId,
  channelName,
  workspace,
}: {
  rawMessages: readonly unknown[];
  channelId: string;
  channelName: string;
  workspace: string;
}): Result<readonly LiveCandidate[], SlackNeighbourhoodError> {
  const byTs = new Map<string, LiveCandidate>();
  for (const raw of rawMessages) {
    if (!isRecord(raw)) {
      return err(SlackNeighbourhoodErrors.malformedRow());
    }
    const ts = raw["ts"];
    if (typeof ts !== "string" || ts.length === 0) {
      return err(SlackNeighbourhoodErrors.missingTs());
    }
    const tsIso = slackTsToIso({ ts });
    if (tsIso === undefined) {
      return err(SlackNeighbourhoodErrors.unreadableTs({ ts }));
    }
    // A thread walk returns its root again beside the history row for the same message; one message is one
    // candidate, so the second copy is the same record rather than a duplicate to refuse.
    byTs.set(ts, {
      channelId,
      channelName,
      permalink: `${workspace}/archives/${channelId}/p${ts.replace(".", "")}`,
      text: textOf({ raw }),
      ts,
      tsIso,
      userId: userOf({ raw }),
    });
  }
  return ok([...byTs.values()].toSorted((left, right) => compareTs({ left: left.ts, right: right.ts })));
}

/**
 * The candidates worth offering to the matcher at all — the ones whose own words link SOME pull request.
 *
 * One read serves every pull request in the run, so the matcher would otherwise run once per candidate per
 * pull request: a forty-pull-request `github landing` over a thousand-message window is forty thousand
 * link scans, where all but a handful of the messages are somebody saying good morning. This is the one
 * pass that makes the rest proportional to the evidence rather than to the conversation.
 *
 * It is a pre-filter, never a judgement: which pull request a surviving candidate reaches, and whether it
 * asks anything, stays entirely `./slackEvidenceLive.ts`'s to decide.
 *
 * @param candidates every message a read produced
 * @returns the ones linking at least one pull request
 */
export function linkingCandidates({ candidates }: { candidates: readonly LiveCandidate[] }): readonly LiveCandidate[] {
  return candidates.filter((candidate) => findPrLinks({ haystack: candidate.text }).length > 0);
}

/** A row's own visible words, empty when it carried none (an attachment-only post, a file share). */
function textOf({ raw }: { raw: Readonly<Record<string, unknown>> }): string {
  const text = raw["text"];
  return typeof text === "string" ? text : "";
}

/** The author's Slack user id, empty for a row posted by an app under a `bot_id` alone. */
function userOf({ raw }: { raw: Readonly<Record<string, unknown>> }): string {
  const user = raw["user"];
  return typeof user === "string" ? user : "";
}
