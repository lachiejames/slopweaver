/**
 * A row waiting on a human, said as five facts rather than one verdict word.
 *
 * Every row waiting on a human carries who is being waited on, when the review was requested, the last nudge,
 * whether it is stale, and the next act. MEASURED on a set of 24 `blocked-on` rows (`slopweaver reading last --producer "github
 * landing" --json`): the row said `blocked-on` and a team, and every one of those five was either absent or
 * buried in a `why` sentence a reader had to parse.
 *
 * Pure, and computed from what the row already read — nothing here fetches. The staleness rule is
 * `./cadence.ts`'s, reached through the row's own `bump`, so this module and the chase path cannot disagree
 * about what a day of silence is: a BUSINESS day, weekends excluded.
 *
 * **`unknown` is split by what would settle it**, because the two cost different things: a Slack corpus
 * that ends before the pull request's last activity is settled by a sync, while a message the classifier
 * abstained on is settled by a visible session reading it. Collapsed, both read "could not tell", and the
 * one a session can clear this minute waits beside the one it cannot.
 *
 * **`name-the-reviewer` is the one act only the owner's word can supply.** Nobody has been asked, the window can
 * carry that absence, and every name GitHub holds the pull request for is a TEAM, or GitHub names nobody — so
 * an ask has no person to go to until the owner names one. A row blocked on an individual is `ask` instead: the fleet can draft that ask
 * as the owner without any word from them, or a discussion opener instead where nothing agreed the change and it is no obvious bug.
 */

import { businessMsBetween } from "./businessTime.js";
import { BUMP_AFTER_BUSINESS_HOURS, type BumpVerdict } from "./cadence.js";
import type { ChannelShare } from "./channelShare.js";
import type { LandingAction } from "./landing.js";
import { identityOf } from "./landingTests.js";
import { askDecisionFor } from "./readingMerge.js";
import { askTarget, type PrReviewState, type SlackReviewState } from "./reviewState.js";
import type { SlackMention } from "./slackEvidenceTypes.js";

/** Milliseconds in an hour. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * When each reviewer was last requested, `@`-prefixed as CODEOWNERS spells one, and whether older events exist.
 *
 * Declared here rather than beside its parser (`../live/github/reviewRequestEvents.ts`) so the review layer
 * owns the shape it reasons over, the way `./githubCodeowners.ts` owns `GithubReviewRequest`.
 */
export interface ReviewRequestTimes {
  /**
   * Reviewer → the newest request instant this read carried for them. A plain record rather than a `Map`,
   * because `github review-state --json` prints it, and a `Map` serialises as `{}`, which reads as
   * "nobody was requested".
   */
  readonly latestByReviewer: Readonly<Record<string, string>>;
  /** Whether GitHub holds older request events this read did not carry. */
  readonly truncated: boolean;
}

/** The one next act on a row waiting on a human. */
type HumanWaitNext =
  "bump" | "wait" | "wait-on-channel" | "ask" | "name-the-reviewer" | "read-the-messages" | "sync-slack";

/** The five facts, and the sentence a page or the voice prints for them. */
export interface HumanWait {
  /** Who GitHub is holding it for, `@`-prefixed as CODEOWNERS spells one. */
  readonly who: readonly string[];
  /** When the newest open request to any of {@link HumanWait.who} was made, or `undefined` when unread. */
  readonly requestedAtIso: string | undefined;
  /** The newest message that asked someone to review it, when one was found. */
  readonly lastAsk: { readonly atIso: string; readonly permalink: string; readonly to: string } | undefined;
  /** `yes` once a business day of silence has passed since the last ask, or since the request when nobody was asked. */
  readonly stale: "yes" | "no" | "unknown";
  readonly next: HumanWaitNext;
  /**
   * The Slack corpus watermark on a `sync-slack` wait whose corpus is provably behind — what the page prints
   * as "Slack history stale since", in place of a verdict the window cannot carry. `undefined` on every
   * other act, and on a corpus never ingested.
   */
  readonly slackThroughIso: string | undefined;
  /** One short sentence, the whole row's wait, for a page line or the voice. */
  readonly sentence: string;
}

/** Nothing was selected off the timeline, so no reviewer has a request instant. */
const UNREAD_TIMES: ReviewRequestTimes = { latestByReviewer: {}, truncated: true };

/**
 * The wait on a landing row, or `undefined` on a row that is not waiting on a code owner.
 *
 * @param action the row's act — only `blocked-on` is a wait on a human
 * @param state the pull request's answers, whose Slack, bump and request-time reads this is built from
 * @param who the row's `blockedOn`
 * @param nowIso when the read was taken
 * @returns the wait, or undefined
 */
export function humanWaitOn({
  action,
  state,
  who,
  nowIso,
}: {
  action: LandingAction;
  state: PrReviewState;
  who: readonly string[];
  nowIso: string;
}): HumanWait | undefined {
  if (action !== "blocked-on") {
    return undefined;
  }
  // An absent read is said as absent: every reviewer is then "requested at a time this read did not carry".
  let times = UNREAD_TIMES;
  if (state.reviewRequestTimes !== undefined) {
    times = state.reviewRequestTimes;
  }
  return humanWaitOf({ bump: state.bump, nowIso, share: state.channelShare, slack: state.slack, times, who });
}

/**
 * The wait on one row, from what the row already read.
 *
 * @param who the names GitHub is holding the pull request for — the row's `blockedOn`
 * @param times when each reviewer was last requested, off the timeline
 * @param slack what the Slack legs established about an ask
 * @param bump the row's own cadence verdict on the newest ask
 * @param share the post to a channel with nobody named, when that is the row's review state
 * @param nowIso the instant the reading was taken, which staleness is measured against
 * @returns the five facts and their sentence
 */
export function humanWaitOf({
  who,
  times,
  slack,
  bump,
  share,
  nowIso,
}: {
  who: readonly string[];
  times: ReviewRequestTimes;
  slack: SlackReviewState;
  bump: BumpVerdict;
  share: ChannelShare | undefined;
  nowIso: string;
}): HumanWait {
  const requestedAtIso = requestedAtOf({ times, who });
  const lastAsk = lastAskOf({ asks: slack.asks });
  const shared = sharedActOf({ share, who });
  let act: { next: HumanWaitNext; stale: HumanWait["stale"] };
  let nudge: string | undefined;
  let slackThroughIso: string | undefined;
  if (shared !== undefined && share !== undefined) {
    act = shared;
    nudge = `shared in ${share.channel} ${minuteOf({ iso: share.postedAtIso })}, nobody named`;
    if (share.asOfIso < nowIso) {
      nudge = `${nudge} as of the Slack read at ${minuteOf({ iso: share.asOfIso })}`;
    }
  } else {
    act = nextActOf({ bump, nowIso, requestedAtIso, slack, who });
    if (act.next === "sync-slack") {
      slackThroughIso = slack.staleThroughIso;
    }
  }
  const { next, stale } = act;
  return {
    lastAsk,
    next,
    requestedAtIso,
    sentence: sentenceOf({ lastAsk, next, nudge, requestedAtIso, slackThroughIso, stale, who }),
    slackThroughIso,
    stale,
    who,
  };
}

/**
 * One holder as the two reads can both name it: its KIND and its last path segment, lower-cased.
 *
 * The kind is in the key because {@link identityOf} alone joins a team and a user of the same name. The r1
 * review's counterexample: `@acme/design` (a team) and `@design` (a person) both read `design`, so the
 * team's wait took the person's newer request and read not stale. Both reads spell a team `@org/team`
 * (CODEOWNERS and GitHub's `combinedSlug`) and a person `@login`, so the slash is the kind.
 */
function holderKey({ token }: { token: string }): string {
  let kind = "user";
  if (token.includes("/")) {
    kind = "team";
  }
  return `${kind}:${identityOf({ token })}`;
}

/**
 * When the wait began: the EARLIEST newest-request across everyone it is held for, since the row has waited
 * from the first of them. `undefined` when any of them has no request this read carried — an older request
 * beyond a cut page is exactly the one that would move the answer.
 *
 * Matched on {@link holderKey}, not the printed name: the codeowner read and the timeline can spell one team
 * two ways, and an exact-string miss would read as "never requested".
 */
function requestedAtOf({ who, times }: { who: readonly string[]; times: ReviewRequestTimes }): string | undefined {
  const byIdentity = new Map<string, string>();
  for (const [name, at] of Object.entries(times.latestByReviewer)) {
    const identity = holderKey({ token: name });
    const seen = byIdentity.get(identity);
    if (seen === undefined || Date.parse(at) > Date.parse(seen)) {
      byIdentity.set(identity, at);
    }
  }
  let earliest: string | undefined;
  for (const name of who) {
    const at = byIdentity.get(holderKey({ token: name }));
    if (at === undefined) {
      return undefined;
    }
    if (earliest === undefined || Date.parse(at) < Date.parse(earliest)) {
      earliest = at;
    }
  }
  return earliest;
}

/** The newest ask, with who it went to. */
function lastAskOf({ asks }: { asks: readonly SlackMention[] }): HumanWait["lastAsk"] {
  const newest = asks[0];
  if (newest === undefined) {
    return undefined;
  }
  return { atIso: newest.atIso, permalink: newest.permalink, to: askTarget({ mention: newest }) };
}

/**
 * Whether no PERSON is named to ask: every name is a team — `@org/team`, the spelling CODEOWNERS and GitHub's
 * `combinedSlug` share — or nobody is named at all, which is a BLOCKED merge with no request and no decision
 * (`./landingTests.ts`). Either way an ask has nobody to go to until the owner names one.
 */
function noPersonNamed({ who }: { who: readonly string[] }): boolean {
  return who.every((name) => name.includes("/"));
}

/**
 * A business day of silence since `sinceIso` — weekends never count, on the same clock as the chase — or
 * `unknown` when there is no instant to measure from.
 */
function staleSince({ sinceIso, nowIso }: { sinceIso: string | undefined; nowIso: string }): HumanWait["stale"] {
  if (sinceIso === undefined) {
    return "unknown";
  }
  const silentMs = businessMsBetween({ fromIso: sinceIso, toIso: nowIso });
  if (silentMs === undefined) {
    return "unknown";
  }
  return silentMs >= BUMP_AFTER_BUSINESS_HOURS * HOUR_MS ? "yes" : "no";
}

/**
 * The next act when the row was shared with a channel and nobody named — `./channelShare.ts`'s clock decides.
 *
 * Green and yellow are a deliberate wait on the channel, yellow already stale; red is the moment to name
 * somebody, the same act as nobody asked. An `unknown` clock is a Slack sync: the post was found, so the ask arms'
 * "nobody asked — name somebody" would be a reviewer suggestion the clock has not earned.
 *
 * @returns the act, or `undefined` when there is no share
 */
function sharedActOf({
  share,
  who,
}: {
  share: ChannelShare | undefined;
  who: readonly string[];
}): { next: HumanWaitNext; stale: HumanWait["stale"] } | undefined {
  if (share === undefined) {
    return undefined;
  }
  switch (share.tone) {
    case "green":
      return { next: "wait-on-channel", stale: "no" };
    case "yellow":
      return { next: "wait-on-channel", stale: "yes" };
    case "red":
      return { next: noPersonNamed({ who }) ? "name-the-reviewer" : "ask", stale: "yes" };
    case "unknown":
      return { next: "sync-slack", stale: "unknown" };
    default: {
      const never: never = share.tone;
      return never;
    }
  }
}

/** The next act and staleness, off whether anybody was asked. */
function nextActOf({
  who,
  slack,
  bump,
  requestedAtIso,
  nowIso,
}: {
  who: readonly string[];
  slack: SlackReviewState;
  bump: BumpVerdict;
  requestedAtIso: string | undefined;
  nowIso: string;
}): { next: HumanWaitNext; stale: HumanWait["stale"] } {
  if (slack.asked === "no") {
    const stale = staleSince({ nowIso, sinceIso: requestedAtIso });
    if (noPersonNamed({ who })) {
      return { next: "name-the-reviewer", stale };
    }
    return { next: "ask", stale };
  }
  if (slack.asked === "yes") {
    if (bump.kind === "due") {
      return { next: "bump", stale: "yes" };
    }
    if (bump.kind === "too-soon" || bump.kind === "replied") {
      return { next: "wait", stale: "no" };
    }
  }
  const unsettled = slack.mentions.some((mention) => askDecisionFor({ mention }).kind === "undecided");
  if (unsettled || slack.bounded) {
    return { next: "read-the-messages", stale: "unknown" };
  }
  return { next: "sync-slack", stale: "unknown" };
}

/** An instant as a reader scans it — `YYYY-MM-DD HH:MMZ`. */
function minuteOf({ iso }: { iso: string }): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

/** What the next act says, in the words the row prints after `next:`. */
const NEXT_PHRASE: Record<Exclude<HumanWaitNext, "sync-slack">, string> = {
  ask: "draft the ask to them, as you, or a discussion opener if nothing agreed the change and it is no obvious bug",
  bump: "bump them, as you",
  "name-the-reviewer": "name a person to ask — only your word is missing",
  "read-the-messages": "a session reads the Slack messages this read could not settle",
  wait: "wait — nothing is owed yet",
  "wait-on-channel": "the channel has it — name a reviewer if nobody picks it up",
};

/**
 * What `sync-slack` says: that the Slack history is behind and since when, so a reader sees what this read
 * does not know rather than a verdict. It names no single unknown on purpose: the act follows a window too
 * stale to say whether anybody was asked, and one too stale to say whether an ask it found was answered.
 *
 * @param throughIso the corpus watermark, `undefined` when no watermark PROVES the history behind — never ingested, unreadable, or a pull request whose own activity is not an instant
 * @returns the phrase, with the watermark to the minute
 */
function syncSlackPhrase({ throughIso }: { throughIso: string | undefined }): string {
  if (throughIso === undefined) {
    return "Slack history does not settle this, sync to know";
  }
  return `Slack history stale since ${minuteOf({ iso: throughIso })}, sync to know`;
}

/** What staleness says. */
const STALE_PHRASE: Record<HumanWait["stale"], string> = {
  no: "not stale",
  unknown: "staleness unknown",
  yes: `stale — a business day of silence (${String(BUMP_AFTER_BUSINESS_HOURS)} business hours, weekends excluded)`,
};

/** The five facts, in their fixed order, as one line. */
function sentenceOf({
  who,
  requestedAtIso,
  lastAsk,
  stale,
  next,
  nudge,
  slackThroughIso,
}: {
  who: readonly string[];
  requestedAtIso: string | undefined;
  lastAsk: HumanWait["lastAsk"];
  stale: HumanWait["stale"];
  next: HumanWaitNext;
  /** The last-nudge fact when the channel share already says it; `undefined` to derive it from the ask. */
  nudge: string | undefined;
  slackThroughIso: string | undefined;
}): string {
  let requested = "requested at a time this read did not carry";
  if (requestedAtIso !== undefined) {
    requested = `requested ${minuteOf({ iso: requestedAtIso })}`;
  }
  let nudgeText = "no ask found";
  if (nudge !== undefined) {
    nudgeText = nudge;
  } else if (lastAsk !== undefined) {
    nudgeText = `last asked ${minuteOf({ iso: lastAsk.atIso })}`;
  }
  let whoText = "nobody GitHub names";
  if (who.length > 0) {
    whoText = who.join(", ");
  }
  let nextText: string;
  if (next === "sync-slack") {
    nextText = syncSlackPhrase({ throughIso: slackThroughIso });
  } else {
    nextText = NEXT_PHRASE[next];
  }
  return `Waiting on ${whoText} · ${requested} · ${nudgeText} · ${STALE_PHRASE[stale]} · next: ${nextText}`;
}
