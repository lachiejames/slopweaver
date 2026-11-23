/**
 * The HIGH-STAKES channel gate: a fleet top-level post to a channel many people watch is defensible on its face,
 * and one a day at most, or it does not go out.
 *
 * ## The rule
 *
 * A channel many people look at is high stakes for keeping the signal-to-noise ratio tight, so a post there has to
 * be defensible, and several fleet posts in a row there are refused. The channels are named per install
 * in `profile.json` `slackHighStakes.channels` (`../../profile.ts`), because a channel id is one install's own.
 *
 * ## Two refusals, both on the TOP-LEVEL post only
 *
 * A reply inside a thread is conversation, and neither refusal reads one. What a room of watchers sees is the
 * channel's own list of top-level posts, which is where "several posts from us in a row" happened. A reply is one
 * only when its `--thread-ts` is a real top-level message there ({@link threadAnchorOf}), and an EDIT of a
 * top-level post is read as a new one, since it can turn a defended card into any other shape.
 *
 * - **Undefended** ({@link undefendedPostRefusal}). The defensibility block is the `finding` form
 *   (`../artifact/finding.ts`): it will not parse without where the tracker was searched and nothing found, the
 *   member-facing impact, a unique-user blast radius, a system-of-record view plus three screenshots, at least one option
 *   and where earlier threads were searched. So "requires the block" is exactly "is a finding card", and every
 *   other shape — every as-me post included, which has no finding form — is refused. Pure, so admission asks it
 *   before anything is read.
 * - **Second post** ({@link secondPostRefusal}). A second fleet top-level post in the same high-stakes channel
 *   inside {@link HIGH_STAKES_WINDOW_MS} is refused, naming the first. "The fleet" is every identity the install
 *   posts as — the bot's ids and the owner's own — read LIVE from the channel, so a post made by any path counts
 *   and a deleted one no longer does. An unreadable history REFUSES, because the case it would guess wrong is the
 *   one the gate exists for (`./publicCardGate.ts` fails closed for the same reason). Two sends that read the
 *   same empty day at the same moment would both pass, so a LIVE send takes the channel's claim
 *   (`./highStakesClaim.ts`) before it reads, and a claim another send holds refuses like a post already there.
 *
 * Both take the owner's word through a journalled hatch, which is the "without the owner's word" half of the row. A home with no
 * `profile.json` cannot say which channels are high-stakes, so every send from it to a channel is refused
 * ({@link unlistedChannelRefusal}): read as "none are", an empty `--home` would be a way round the whole gate.
 */
import { slackPermalink } from "../../corpus/slack/curated.js";
import { hatchFor } from "../../hatch/lookup.js";
import { hatchRefusalLines } from "../../hatch/render.js";
import { isRecord } from "../../lib/parsers.js";
import { slackTsToEpochMs } from "../../lib/slackTs.js";
import { FINDING_KIND } from "../artifact/finding.js";
import type { DripShape } from "./types.js";

/** One day: "several posts from us in a row" happen inside one. */
export const HIGH_STAKES_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A channel the install names high-stakes, and how a refusal names it to a reader. */
export interface HighStakesChannel {
  readonly id: string;
  readonly name: string;
}

/** One fleet top-level post already standing in the channel inside the window. */
export interface PriorFleetPost {
  readonly ts: string;
  readonly permalink: string;
}

/**
 * What the live read of the channel established: the fleet's own top-level posts inside the window, why it
 * could not say, that another send holds the channel's claim and may be posting there now, or that this one send
 * would itself put several top-level posts there, the first of which is the day's one.
 */
export type FleetHistory =
  | { readonly kind: "read"; readonly priors: readonly PriorFleetPost[] }
  | { readonly kind: "unread"; readonly reason: string }
  | { readonly kind: "claimed"; readonly claimedIso: string }
  | { readonly kind: "several"; readonly posts: number };

/**
 * How many top-level posts one send puts in its channel: every message of a `top-level` drip, else only its first,
 * since the rest thread under it. Pure.
 *
 * @param shape the send's drip shape
 * @param messageCount how many messages the send carries
 * @returns the count of top-level posts the send makes
 */
export function topLevelPostsOf({ shape, messageCount }: { shape: DripShape; messageCount: number }): number {
  return shape === "top-level" ? messageCount : 1;
}

/**
 * How long, from when it was taken, a live send's claim on a high-stakes channel holds off every other fleet send
 * there whatever became of the process that took it; while that process lives, the claim holds for the whole
 * {@link HIGH_STAKES_WINDOW_MS} (`./highStakesClaim.ts`), since no clock bounds a rate-limited read or a sleeping
 * laptop.
 *
 * Past the send, the post shows in `conversations.history` and the history is the record again. A claim is never
 * released once its send was attempted, because a send that threw may still have landed (`./sendReservation.ts`
 * keeps its reservation for the same reason), so a send that failed holds the channel for this long, and the
 * second-post hatch is the way past it.
 */
export const HIGH_STAKES_CLAIM_WINDOW_MS = 10 * 60 * 1000;

/**
 * One send's claim on a high-stakes channel: taken by this caller under `claimId`, held by another send since
 * `claimedIso`, held by nobody (for a caller that only looked), or not writable at all, which refuses like an
 * unread day.
 */
export type ChannelClaim =
  | { readonly kind: "held"; readonly claimId: string }
  | { readonly kind: "free" }
  | { readonly kind: "taken"; readonly claimedIso: string }
  | { readonly kind: "unwritable"; readonly reason: string };

/**
 * Whether a send is aimed at a direct message rather than a channel: a `D…` conversation id, a `U…`/`W…` user id,
 * or an `@handle`. Pure.
 *
 * @param channel where the send is aimed, as the caller spelled it
 * @returns true for a direct message, which no high-stakes list can name
 */
function isDirectMessageTarget({ channel }: { channel: string }): boolean {
  return channel.startsWith("@") || /^[DUW][A-Z0-9]{2,}$/.test(channel);
}

/**
 * Refuse a send to a channel when the home cannot say which channels are high-stakes. Pure.
 *
 * Not a hatch: nothing about the send is refused on policy. The fact that is missing is the list, and writing
 * `slackHighStakes` into the home's `profile.json`, or sending from the home that has one, is the way forward.
 *
 * @param channel where the send is aimed, as the caller spelled it
 * @param listGap why the home names no list, or undefined when it names one
 * @returns the one refusal line, or empty when the list was read or the send is a direct message
 */
export function unlistedChannelRefusal({
  channel,
  listGap,
}: {
  channel: string;
  listGap: string | undefined;
}): readonly string[] {
  if (listGap === undefined || isDirectMessageTarget({ channel })) {
    return [];
  }
  return [
    `${listGap}: a send to ${channel} is refused rather than read as ordinary, and nothing was posted. ` +
      "Send from the home whose profile.json names `slackHighStakes`, or add that block to this one.",
  ];
}

/**
 * The high-stakes entry a send is aimed at, or undefined when the channel is not one.
 *
 * Matched on the id OR the name, with or without its `#`, because `chat.postMessage` accepts a channel name and
 * `--channel bugs` would otherwise walk straight past a gate keyed on `C0SYN000003`.
 *
 * @param channel where the send is aimed, as the caller spelled it
 * @param channels the install's named high-stakes channels
 * @returns the matching entry, or undefined
 */
export function highStakesChannelOf({
  channel,
  channels,
}: {
  channel: string;
  channels: readonly HighStakesChannel[];
}): HighStakesChannel | undefined {
  const bare = channel.replace(/^#/, "");
  return channels.find((entry) => entry.id === bare || entry.name.replace(/^#/, "") === bare);
}

/**
 * Whether a `--thread-ts` names a real top-level message in the channel, so the send really is a reply.
 *
 * Asked because a reply is never gated: a caller's word that a send is a reply would otherwise be the whole
 * exemption, and a `ts` naming no message makes a reply of nothing.
 */
export type ThreadAnchor =
  { readonly kind: "present" } | { readonly kind: "absent" } | { readonly kind: "unread"; readonly reason: string };

/**
 * Whether a history read anchored on `threadTs` holds that exact top-level message. Pure.
 *
 * `conversations.history` answers with the NEAREST message when the asked one is gone, so the `ts` is compared
 * exactly; and a broadcast reply appears in history too, so a message whose `thread_ts` is another message's is
 * not a thread parent.
 *
 * @param rawMessages what the anchored `conversations.history` read returned, unparsed
 * @param threadTs the `--thread-ts` the send names
 * @returns present when that exact top-level message is there, else absent
 */
export function threadAnchorOf({
  rawMessages,
  threadTs,
}: {
  rawMessages: readonly unknown[];
  threadTs: string;
}): ThreadAnchor {
  const parent = rawMessages.find(
    (raw) =>
      isRecord(raw) && raw["ts"] === threadTs && (raw["thread_ts"] === undefined || raw["thread_ts"] === threadTs),
  );
  return parent === undefined ? { kind: "absent" } : { kind: "present" };
}

/**
 * Refuse a top-level post to a high-stakes channel that is not a `finding` card. Pure.
 *
 * @param target the gated channel, or undefined when the send is not gated
 * @param formKind the bot form kind that produced the card, or undefined for an as-me post, which has none
 * @param allowUndefended whether the `high-stakes-undefended` hatch is open
 * @returns the four-line refusal, or empty when the send may proceed
 */
export function undefendedPostRefusal({
  target,
  formKind,
  allowUndefended,
}: {
  target: HighStakesChannel | undefined;
  formKind: string | undefined;
  allowUndefended: boolean;
}): readonly string[] {
  if (target === undefined || allowUndefended || formKind === FINDING_KIND) {
    return [];
  }
  const shape = formKind === undefined ? "an as-me post" : `a \`${formKind}\` card`;
  return hatchRefusalLines({
    detail:
      `this is ${shape} to ${target.name}, and a top-level post there goes out only as a \`{"kind":"finding"}\` ` +
      "bot card, whose form will not parse without the whole block",
    hatch: hatchFor({ id: "high-stakes-undefended" }),
  });
}

/**
 * Refuse a second fleet top-level post to one high-stakes channel inside the window, or any when the history
 * could not be read. Pure.
 *
 * @param target the gated channel, or undefined when the send is not gated
 * @param history what the live read of that channel established
 * @param allowSecondPost whether the `high-stakes-second-post` hatch is open
 * @returns the four-line refusal naming the earlier post, or empty when the send may proceed
 */
export function secondPostRefusal({
  target,
  history,
  allowSecondPost,
}: {
  target: HighStakesChannel | undefined;
  history: FleetHistory;
  allowSecondPost: boolean;
}): readonly string[] {
  if (target === undefined || allowSecondPost) {
    return [];
  }
  const hatch = hatchFor({ id: "high-stakes-second-post" });
  if (history.kind === "unread") {
    return hatchRefusalLines({
      detail: `${target.name}'s last 24 hours could not be read (${history.reason}), so it is refused rather than guessed at`,
      hatch,
    });
  }
  if (history.kind === "claimed") {
    return hatchRefusalLines({
      detail: `another fleet send claimed ${target.name} at ${history.claimedIso} and may be posting there now`,
      hatch,
    });
  }
  if (history.kind === "several") {
    return hatchRefusalLines({
      detail: `this one send would put ${String(history.posts)} top-level posts in ${target.name}, and every one after the first is a second post`,
      hatch,
    });
  }
  const latest = history.priors.at(-1);
  if (latest === undefined) {
    return [];
  }
  return hatchRefusalLines({
    detail: `the fleet already posted at the top level of ${target.name} at ${latest.permalink}`,
    hatch,
  });
}

/**
 * The fleet's own top-level posts in a channel's raw history, inside the window ending now, oldest first. Pure.
 *
 * A message counts when it has a `ts` inside the window, is not a reply (no `thread_ts`, or one equal to its own
 * `ts`), and its `user` is one of the fleet's ids. A deleted message never appears in `conversations.history`,
 * and the tombstone Slack leaves under a parent that had replies is authored by Slackbot, so neither counts.
 *
 * @param rawMessages what `conversations.history` returned, unparsed
 * @param fleetUserIds every user id the install posts as — the owner's, the bot's own
 * @param nowMs the instant the window ends at
 * @param channel the channel, for the permalinks a refusal cites
 * @param workspaceUrl the workspace those permalinks are built against
 * @returns the fleet's top-level posts inside the window
 */
export function fleetTopLevelPostsWithin({
  rawMessages,
  fleetUserIds,
  nowMs,
  channel,
  workspaceUrl,
}: {
  rawMessages: readonly unknown[];
  fleetUserIds: readonly string[];
  nowMs: number;
  channel: string;
  workspaceUrl: string;
}): readonly PriorFleetPost[] {
  const posts = rawMessages.flatMap((raw): readonly (PriorFleetPost & { readonly ms: number })[] => {
    if (!isRecord(raw) || typeof raw["ts"] !== "string" || typeof raw["user"] !== "string") {
      return [];
    }
    const ts = raw["ts"];
    const threadTs = raw["thread_ts"];
    const isReply = typeof threadTs === "string" && threadTs !== ts;
    const ms = slackTsToEpochMs({ ts });
    if (isReply || ms === undefined || nowMs - ms > HIGH_STAKES_WINDOW_MS || !fleetUserIds.includes(raw["user"])) {
      return [];
    }
    return [{ ms, permalink: slackPermalink({ channelId: channel, ts, workspaceUrl }), ts }];
  });
  return posts.toSorted((a, b) => a.ms - b.ms).map(({ permalink, ts }) => ({ permalink, ts }));
}
