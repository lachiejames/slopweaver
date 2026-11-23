/**
 * Where a posted Slack message ACTUALLY landed, judged against where it was addressed — pure.
 *
 * After a send, the message is read back: an approved message for a thread can land in the wrong thread or at the
 * top level of the channel, which is a public mistake, so the check reads before and after the act. The repair is
 * automated and unasked: delete it and put it in the right place, unless people have already started engaging; a
 * bare reaction is moved automatically.
 *
 * This module holds the two decisions that rule turns on, with no Slack call, clock or file in reach: whether
 * Slack's own account of a message (`ReadSlackMessage.threadTs`, an observation) matches the address the post asked
 * for, and whether a PERSON has said anything after the misplaced message. The effectful half — the read-back, the
 * delete, the repost, the cross-link and the journal — is `../../corpus/slack/writeGuardPlacement.ts`.
 *
 * Reactions never count as engagement by construction: they are not messages, so a thread read never returns one.
 */
import { compareStrings } from "../../lib/compare.js";
import { isRecord } from "../../lib/parsers.js";

/** The identity a guarded post went out under, as `auth.test` names it — the one author whose messages are its own. */
export interface PostingIdentity {
  readonly botId?: string | undefined;
  readonly userId?: string | undefined;
}

/** Where a post was addressed: a channel, and the thread root it replies under when it is a reply. */
export interface SlackPlacementAddress {
  readonly channel: string;
  readonly threadTs?: string | undefined;
}

/** Where Slack says a message is: the conversation it answered with, its own ts, and the root it hangs under. */
export interface ObservedSlackPlacement {
  readonly channel: string;
  readonly ts: string;
  readonly threadTs?: string | undefined;
  /** For a post addressed to a PERSON: the member on the other end of the `D…` Slack answered with. */
  readonly dmMember?: string | undefined;
}

/** A message's identity as a journal row carries it. */
export interface PlacedMessageRef {
  readonly channel: string;
  readonly ts: string;
}

/** Whether the observed placement is the addressed one, and when not, what each side said. */
export type PlacementMatch = { readonly kind: "matched" } | { readonly kind: "mismatched"; readonly detail: string };

/** Why a repair the read-back called for did not complete. */
type PlacementRepairFailureReason =
  | "intent-journal-unwritable"
  | "engagement-unreadable"
  | "delete-failed"
  | "second-placement-mismatch"
  | "repost-failed"
  | "cross-link-failed"
  | "repost-engaged";

/**
 * What the read-back after one post found, and what it did about it. A closed set: every post the guard sees ends
 * in exactly one of these, and the send report prints it.
 */
export type PlacementOutcome =
  | { readonly kind: "verified"; readonly posted: PlacedMessageRef }
  | { readonly kind: "unverified"; readonly posted: PlacedMessageRef; readonly detail: string }
  | {
      readonly kind: "moved";
      readonly from: PlacedMessageRef;
      readonly to: PlacedMessageRef;
      readonly detail: string;
    }
  | {
      readonly kind: "held";
      readonly posted: PlacedMessageRef;
      readonly intended: SlackPlacementAddress;
      readonly crossLink: PlacedMessageRef;
      readonly detail: string;
    }
  | {
      readonly kind: "repair-failed";
      readonly posted: PlacedMessageRef;
      readonly reason: PlacementRepairFailureReason;
      readonly detail: string;
    };

/**
 * What a guarded post hands back about its placement: the outcome, and — separately, because it never changes
 * where the message is — a journal row that could not be written. A send that already landed never throws over
 * its own bookkeeping, so the failure rides here and the send report prints it.
 */
export interface PlacementReport {
  readonly outcome: PlacementOutcome;
  readonly journalFailure?: string | undefined;
}

/** A conversation id Slack answers a post with — never a person's `U…`/`W…` id a DM may be addressed by. */
const CONVERSATION_ID = /^[CGD][A-Z0-9]+$/u;

/** A person's id, which a DM may be addressed by. */
const MEMBER_ID = /^[UW][A-Z0-9]+$/u;

/**
 * Whether a post was addressed to a PERSON rather than a conversation — the case whose channel half is judged by who
 * is on the other end of the DM Slack answered with.
 *
 * @param address where the post was addressed
 * @returns true for a `U…`/`W…` channel
 */
export function addressedToPerson({ address }: { address: SlackPlacementAddress }): boolean {
  return MEMBER_ID.test(address.channel);
}

/** Spell an address for a detail line: `C…` or `C… thread <ts>`. */
function where({ channel, threadTs }: { channel: string; threadTs: string | undefined }): string {
  return threadTs === undefined ? `${channel} top level` : `${channel} thread ${threadTs}`;
}

/**
 * Judge one read-back against the address its post asked for.
 *
 * A top-level post matches when Slack reports no `thread_ts`, or one equal to the message's OWN ts — which is what a
 * root that has gathered replies carries. A reply matches only when Slack's `thread_ts` is exactly the root asked
 * for. The channel half compares ids when the request named a conversation id. A DM addressed by a person's id comes
 * back under its `D…` id, so there the half is the DM's MEMBER against the person asked for — a `D…` with somebody else,
 * or one whose member could not be read, is not where the post was addressed.
 *
 * @param requested where the post was addressed
 * @param observed where Slack says the message is
 * @returns `matched`, or `mismatched` with both sides spelled out
 */
export function compareSlackPlacement({
  requested,
  observed,
}: {
  requested: SlackPlacementAddress;
  observed: ObservedSlackPlacement;
}): PlacementMatch {
  const toPerson = addressedToPerson({ address: requested });
  let channelMatches = !CONVERSATION_ID.test(requested.channel) || requested.channel === observed.channel;
  if (toPerson) {
    channelMatches = observed.dmMember === requested.channel;
  }
  const observedRoot = observed.threadTs === observed.ts ? undefined : observed.threadTs;
  const threadMatches = requested.threadTs === observedRoot;
  if (channelMatches && threadMatches) {
    return { kind: "matched" };
  }
  let member = "";
  if (toPerson) {
    member =
      observed.dmMember === undefined ? " (a DM whose member could not be read)" : ` (a DM with ${observed.dmMember})`;
  }
  return {
    detail:
      `addressed to ${where({ channel: requested.channel, threadTs: requested.threadTs })}, ` +
      `but Slack has ${observed.ts} at ${where({ channel: observed.channel, threadTs: observedRoot })}${member}`,
    kind: "mismatched",
  };
}

/**
 * The messages a PERSON posted strictly after `afterTs` — the "have people started engaging" question the repair
 * turns on.
 *
 * Applied to the misplaced message's own thread when it landed top-level (its replies), and to the thread it landed
 * in when it landed as a reply somewhere else (anything said after it there).
 *
 * Every message counts except this install's OWN bot posts: `bot_id` equal to the posting bot's, with no `user` or
 * the bot's own user. A bare `bot_id` is not enough, because a person posting through an app — the owner's as-me token
 * included — carries one beside their own `user`, and the delete this guards is irreversible. So another app's
 * message counts too, and the cost is a cross-link where a move would have done. On the as-me lane `auth.test`
 * names no bot, so nothing is excluded: the owner's own reply to a misplaced message is exactly the conversation the rule
 * says not to move. An identity that could not be read excludes nothing either.
 *
 * @param rawMessages the thread's raw messages, already fetched, in any order
 * @param afterTs the misplaced message's own ts
 * @param self who the guarded post went out as, or `undefined` when `auth.test` could not say
 * @returns the ts of every message that counts as engagement, oldest first
 */
export function engagementAfter({
  rawMessages,
  afterTs,
  self,
}: {
  rawMessages: readonly unknown[];
  afterTs: string;
  self: PostingIdentity | undefined;
}): readonly string[] {
  const engaged: string[] = [];
  for (const message of rawMessages) {
    if (!isRecord(message) || typeof message["ts"] !== "string" || message["ts"] <= afterTs) {
      continue;
    }
    if (!ownBotPost({ message, self })) {
      engaged.push(message["ts"]);
    }
  }
  return engaged.toSorted((left, right) => compareStrings({ a: left, b: right }));
}

/**
 * Whether one raw message is this install's OWN bot post: `bot_id` equal to the identity's bot, with no `user` or the
 * bot's own user. The one rule both reads that ask "did somebody else say something" apply — the misplacement repair
 * here and a release's re-read (`./releaseFreshness.ts`) — so the two can never disagree about the same message.
 *
 * Anything else is somebody else's words, an app included: a person posting through an app carries its `bot_id`
 * beside their own `user`, so a bare `bot_id` proves nothing. An as-me identity names no bot and an unread one is
 * `undefined`, and both exclude nothing.
 *
 * @param message one raw message, already known to be a record
 * @param self who the read is on behalf of, or `undefined` when `auth.test` could not say
 * @returns `true` only for the identity's own bot post
 */
export function ownBotPost({
  message,
  self,
}: {
  message: Readonly<Record<string, unknown>>;
  self: PostingIdentity | undefined;
}): boolean {
  const user = message["user"];
  return self?.botId !== undefined && message["bot_id"] === self.botId && (user === undefined || user === self.userId);
}

/**
 * The one line a send report prints about where its message landed, plus the journal failure when there was one.
 *
 * @param report what the read-back found and did, and whether its journal row landed
 * @returns `placement: …`, naming the message and, for a repair, both places
 */
export function placementLine({ report }: { report: PlacementReport }): string {
  const line = outcomeLine({ outcome: report.outcome });
  if (report.journalFailure === undefined) {
    return line;
  }
  return `${line}; journal row NOT written: ${report.journalFailure}`;
}

/** The outcome half of {@link placementLine}. */
function outcomeLine({ outcome }: { outcome: PlacementOutcome }): string {
  switch (outcome.kind) {
    case "verified":
      return `placement: verified ${outcome.posted.channel}/${outcome.posted.ts}`;
    case "unverified":
      return `placement: NOT CHECKED ${outcome.posted.channel}/${outcome.posted.ts} — ${outcome.detail}`;
    case "moved":
      return (
        `placement: MOVED ${outcome.from.channel}/${outcome.from.ts} → ${outcome.to.channel}/${outcome.to.ts} ` +
        `(${outcome.detail})`
      );
    case "held":
      return (
        `placement: HELD ${outcome.posted.channel}/${outcome.posted.ts} where it landed, because conversation ` +
        `started on it; cross-linked from ${outcome.crossLink.channel}/${outcome.crossLink.ts} (${outcome.detail})`
      );
    case "repair-failed":
      return (
        `placement: REPAIR FAILED ${outcome.posted.channel}/${outcome.posted.ts} — ${outcome.reason}: ` +
        `${outcome.detail}`
      );
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
