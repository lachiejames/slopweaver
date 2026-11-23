/**
 * Whether a finding the owner shared has come back to the owner: the team had a FULL working day and said nothing, or said only an
 * untimed "I'm looking into it" and nothing after it, or somebody says it is fixed.
 *
 * The rules, journalled on the board row
 * `never-lead-with-the-pr-lead-with-the-discussion-on-every-queue-card`:
 *
 * - The finding comes back to the owner, who decides whether to bump; the team gets a full working day to respond
 *   first — {@link FindingFollowupVerdict} `quiet`.
 * - On "I'm looking into it" with no timeframe, the same after a business day with no further update (people
 *   sometimes drop things) — `stalled`.
 * - On a "fixed" our checks contradict, the owner gets that evidence straight away, assuming the fix is actually
 *   deployed — `claimed-fixed`, with no clock. Whether it is deployed, and
 *   whether the original check still fails, is the visible seat's to settle (`skills/automation/reference/thread-chase.md`);
 *   nothing here can see a deploy or run a check.
 *
 * ## The person carries no cadence
 *
 * A verdict is a candidate for ONE card to the owner, never a schedule on the person (`../outbound/slack/sharedFindings.ts`
 * spends that card). A thread where the OWNER spoke after the team's last word is `slack awaiting`'s, which chases the owner's own
 * ask, so it is `in-hand` here rather than a second card for one silence — UNLESS the team's last word claims a fix.
 * The owner's "thanks" under a "fixed" checks nothing, and a contradicted fix is evidence the owner lacks, so `claimed-fixed`
 * outranks the owner's own later word (the ordering is deliberate).
 *
 * ## The text tests are lexical and conservative
 *
 * {@link acknowledgementKindOf} and {@link isFixedClaim} read the AUTHORED text with links, mentions and code removed.
 * Both are built to under-select: an acknowledgement is a short reply that is mostly the acknowledgement and asks
 * nothing back, and a fixed claim is a completed-state word no negation, question, condition or future governs. A
 * miss is what the seat's live read and the owner's own eye are for; the patterns move on a measured miss, never a guess.
 *
 * Pure — no I/O, no clock. `nowIso` is supplied so a frozen fixture judges its own time.
 */

import { compareSlackTimestamps } from "../live/slack/selection.js";
import { BUSINESS_DAY_MS, businessMsBetween } from "../review/businessTime.js";

/** Who wrote one message in a finding's thread, as the verdict needs to know it. */
type FindingThreadRole = "owner" | "person" | "other";

/** One message in a shared finding's thread. */
export interface FindingThreadMessage {
  /** The message's own Slack `ts` — what orders the thread. */
  readonly ts: string;
  readonly tsIso: string;
  readonly authorId: string;
  /** `owner` is the owner, `person` anybody else who is a person, `other` a bot, an app or Slopweaver itself. */
  readonly role: FindingThreadRole;
  /** The author's own words, mention runs intact. */
  readonly text: string;
  readonly permalink: string;
}

/** Why a finding is not coming back to the owner now. */
export type FindingInHandReason = "answered" | "inside-first-day" | "owner-spoke" | "timed-promise" | "undated";

/** Whether one shared finding comes back to the owner, and on what. */
export type FindingFollowupVerdict =
  | { readonly kind: "quiet"; readonly businessMs: number }
  | { readonly kind: "stalled"; readonly businessMs: number; readonly acknowledgement: FindingThreadMessage }
  | { readonly kind: "claimed-fixed"; readonly claim: FindingThreadMessage }
  | { readonly kind: "in-hand"; readonly reason: FindingInHandReason; readonly latest?: FindingThreadMessage };

/** Slack's link, mention and broadcast runs, which carry nobody's words. */
const SLACK_RUN = /<[^<>]*>/g;

/** A fenced code block. */
const FENCED_CODE = /```[^`]*```/g;

/** An inline code span. */
const INLINE_CODE = /`[^`\n]*`/g;

/**
 * The words a test reads: runs and code removed, curly apostrophes straightened, lowercased, spaces collapsed.
 *
 * @param text the authored text
 * @returns the normalised prose
 */
function proseOf({ text }: { text: string }): string {
  return text
    .replace(FENCED_CODE, " ")
    .replace(INLINE_CODE, " ")
    .replace(SLACK_RUN, " ")
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The acknowledgement phrases: somebody says they will look, and nothing more. Not yet measured against real replies,
 * since only one finding had been released when this shipped; the seat's skipped rows are what move this list.
 */
const ACKNOWLEDGEMENT =
  /\b(?:look(?:ing)? into|tak(?:e|ing) a look|ha(?:ve|ving) a look|look(?:ing)? at (?:it|this|that)|investigat(?:e|ing)|dig(?:ging)? into|check(?:ing)? (?:it|this|that) out|on it|will check|i'll check|we'll check|will get back|get back to you|will take a look|will have a look|checking now)\b/;

/** The longest reply still read as an acknowledgement and nothing more. Beyond it a reply carries an answer. */
const ACKNOWLEDGEMENT_MAX_WORDS = 20;

/** Words that carry an answer — a cause or a diagnosis — which an acknowledgement on its own never does. */
const SUBSTANTIVE =
  /\b(?:because|caused|cause|due to|the issue is|the problem is|looks like|seems like|it's from|is from|coming from)\b/;

/** A measurable time a promise names. "soon" and "later" are not one, and stay untimed. */
const TIMEFRAME = new RegExp(
  [
    String.raw`\b(?:today|tonight|tomorrow|tmrw|tmr)\b`,
    String.raw`\bthis (?:morning|afternoon|arvo|evening|week)\b`,
    String.raw`\bnext (?:week|monday|tuesday|wednesday|thursday|friday)\b`,
    String.raw`\b(?:eod|cob|eow)\b`,
    String.raw`\bend of (?:the )?(?:day|week)\b`,
    String.raw`\b(?:mon|tue|tues|wed|thu|thur|thurs|fri)(?:day)?\b`,
    String.raw`\b\d{1,2}(?::\d{2})? ?(?:am|pm)\b`,
    String.raw`\b\d{1,2}:\d{2}\b`,
    String.raw`\bin (?:a|an|\d+|a few|a couple of|a couple) ?(?:min|mins|minutes|hour|hours|hr|hrs|day|days|week|weeks)\b`,
    String.raw`\bafter (?:lunch|standup|stand-up|the meeting|this meeting)\b`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b`,
    String.raw`\b\d{1,2}/\d{1,2}\b`,
  ].join("|"),
);

/**
 * Whether one reply is an acknowledgement and nothing more, and whether it names when.
 *
 * A reply that asks something back (`?`) is never one: the ball is then in our court, which `slack owed` reads.
 *
 * @param text the reply's authored text
 * @returns `timed` when it names a measurable time, `untimed` when it names none, undefined when it is not an
 *   acknowledgement at all
 */
export function acknowledgementKindOf({ text }: { text: string }): "timed" | "untimed" | undefined {
  const prose = proseOf({ text });
  if (prose.includes("?") || !ACKNOWLEDGEMENT.test(prose) || SUBSTANTIVE.test(prose)) {
    return undefined;
  }
  if (prose.split(" ").length > ACKNOWLEDGEMENT_MAX_WORDS) {
    return undefined;
  }
  return TIMEFRAME.test(prose) ? "timed" : "untimed";
}

/** A completed state: the thing was fixed, or the fix went out. */
const FIXED_WORD =
  /\b(?:fixed|resolved|sorted|patched|hotfixed|mitigated|deployed|shipped|rolled out|reverted|(?:merged|pushed) (?:a|the) fix|fix (?:is|was|has been) (?:in|out|live|merged))\b/g;

/**
 * The hedged claim "should be fixed now", which {@link GOVERNED}'s `should` and `be` would otherwise read as a future:
 * the trailing or leading `now` is what makes it a claim about the present.
 */
const HEDGED_NOW_CLAIM = new RegExp(
  [
    String.raw`\bshould (?:now be|be now) (?:fixed|resolved|sorted|patched|mitigated|deployed|good|working)\b`,
    String.raw`\bshould be (?:fixed|resolved|sorted|patched|mitigated|deployed|good|working) now\b`,
  ].join("|"),
);

/** A word in the run before a completed-state word that negates it, puts it in the future, or makes it conditional. */
const GOVERNED =
  /\b(?:not|no|never|nope|isn't|isnt|wasn't|hasn't|haven't|hadn't|aren't|weren't|won't|don't|doesn't|didn't|yet|once|when|until|unless|if|after|before|will|gonna|going|needs?|should|could|would|might|may|must|can|be|hopefully|probably|maybe)\b/;

/** How many words before a completed-state word may govern it. */
const GOVERN_WINDOW_WORDS = 4;

/**
 * Whether one reply claims the problem is fixed: a completed-state word in a clause that is not a question, with no
 * negation, condition or future in the few words before it, or the hedged "should be fixed now". "Fixed, deploying
 * after lunch" claims it; "will be fixed", "should be fixed once it deploys", "not fixed yet", "once it's resolved" and
 * "is this fixed?" do not.
 *
 * @param text the reply's authored text
 * @returns true when some clause claims the fix
 */
export function isFixedClaim({ text }: { text: string }): boolean {
  const prose = proseOf({ text });
  for (const clause of prose.split(/(?<=[.!?;,\n])/)) {
    if (clause.trim().endsWith("?")) {
      continue;
    }
    if (HEDGED_NOW_CLAIM.test(clause)) {
      return true;
    }
    for (const match of clause.matchAll(FIXED_WORD)) {
      const before = clause.slice(0, match.index).trim().split(" ").slice(-GOVERN_WINDOW_WORDS).join(" ");
      if (!GOVERNED.test(before)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The latest message with a given role, by Slack's own ordering.
 *
 * @param messages the thread's messages after the finding, in any order
 * @param role whose word is wanted
 * @returns that message, undefined when nobody with the role spoke
 */
function latestOf({
  messages,
  role,
}: {
  messages: readonly FindingThreadMessage[];
  role: FindingThreadRole;
}): FindingThreadMessage | undefined {
  let latest: FindingThreadMessage | undefined;
  for (const message of messages) {
    if (message.role !== role) {
      continue;
    }
    if (latest === undefined || compareSlackTimestamps({ left: message.ts, right: latest.ts }) > 0) {
      latest = message;
    }
  }
  return latest;
}

/**
 * The verdict a business-day clock gives, from one instant to now.
 *
 * @param fromIso when the silence started
 * @param nowIso the run's own instant
 * @returns the elapsed business time once a full day has passed, else why not
 */
function fullDayAfter({
  fromIso,
  nowIso,
}: {
  fromIso: string;
  nowIso: string;
}): { readonly businessMs: number } | { readonly reason: "inside-first-day" | "undated" } {
  const businessMs = businessMsBetween({ fromIso, toIso: nowIso });
  if (businessMs === undefined) {
    return { reason: "undated" };
  }
  if (businessMs < BUSINESS_DAY_MS) {
    return { reason: "inside-first-day" };
  }
  return { businessMs };
}

/**
 * Whether one shared finding comes back to the owner now.
 *
 * Precedence: the team's latest word claiming a fix flags it at once; the OWNER's word after the team's last is
 * `slack awaiting`'s to chase; no word from the team is `quiet` after a full business day from the post; an untimed
 * acknowledgement as the team's last word is `stalled` after a full business day from it; anything else is in hand.
 *
 * @param messageTs the finding's own landed `ts`; only messages strictly after it are read
 * @param postedAtIso when the finding landed
 * @param messages the thread's messages, in any order, the finding itself included or not
 * @param nowIso the run's own instant
 * @returns the verdict
 */
export function findingFollowupVerdictOf({
  messageTs,
  postedAtIso,
  messages,
  nowIso,
}: {
  messageTs: string;
  postedAtIso: string;
  messages: readonly FindingThreadMessage[];
  nowIso: string;
}): FindingFollowupVerdict {
  const after = messages.filter((message) => compareSlackTimestamps({ left: message.ts, right: messageTs }) > 0);
  const team = latestOf({ messages: after, role: "person" });
  const owner = latestOf({ messages: after, role: "owner" });
  if (team !== undefined && isFixedClaim({ text: team.text })) {
    return { claim: team, kind: "claimed-fixed" };
  }
  const ownerSpokeLast =
    owner !== undefined && (team === undefined || compareSlackTimestamps({ left: owner.ts, right: team.ts }) > 0);
  if (ownerSpokeLast) {
    return { kind: "in-hand", latest: owner, reason: "owner-spoke" };
  }
  if (team === undefined) {
    const clock = fullDayAfter({ fromIso: postedAtIso, nowIso });
    return "businessMs" in clock ? { businessMs: clock.businessMs, kind: "quiet" } : { kind: "in-hand", ...clock };
  }
  const acknowledgement = acknowledgementKindOf({ text: team.text });
  if (acknowledgement === undefined) {
    return { kind: "in-hand", latest: team, reason: "answered" };
  }
  if (acknowledgement === "timed") {
    return { kind: "in-hand", latest: team, reason: "timed-promise" };
  }
  const clock = fullDayAfter({ fromIso: team.tsIso, nowIso });
  if ("businessMs" in clock) {
    return { acknowledgement: team, businessMs: clock.businessMs, kind: "stalled" };
  }
  return { kind: "in-hand", latest: team, ...clock };
}
