/**
 * When a stalled review may be chased again — a cadence, deliberately not a rate limit.
 *
 * ## The product rule this encodes
 *
 * Chasing someone twice is NORMAL. The rule: if a reviewer has not replied for a day, you bump them.
 * So there is no counter here, no maximum, and no terminal refusal — every send simply starts a fresh day. A
 * mechanism that eventually told the owner "you have chased this person enough" would be answering a question
 * nobody asked, and would block the very act the rule describes.
 *
 * What that leaves is a much narrower job: decide whether a day of SILENCE has actually elapsed.
 *
 * ## A day is a BUSINESS day
 *
 * The standing rule: 24 hours is enough for most cases, a few warrant a longer wait, and only business days
 * count, because nobody is expected to review on the weekend. So the silence is counted by `./businessTime.ts`
 * — Monday to Friday, never a Saturday or a Sunday — and an ask sent Friday afternoon is due Monday afternoon,
 * not Saturday. The 24 business hours is a FLOOR: `due` offers a chase, it never sends one, which is what
 * leaves room for the cases the owner would wait longer on.
 *
 * ## Why silence takes a direction, and why a timestamp comparison is not enough
 *
 * The obvious implementation compares the direct message's most recent timestamp against the last thing we sent,
 * and treats "something newer exists" as a reply. An adversarial pass killed it with one sequence: the owner
 * sends the ask, the reviewer stays silent, and the owner later types anything at all in that same DM. The
 * newest message is now the owner's own, so a timestamp-only rule reports the reviewer as having replied and
 * suppresses every future bump — permanently, and silently.
 *
 * Slack's own object documentation is the reason it cannot be patched over: a conversation's `latest` is the most
 * recent message in the conversation, NOT the most recent message from the other participant. So this module
 * refuses to accept a bare timestamp. Its input is {@link ReviewerActivity}, which forces the caller to say
 * whose message it saw — and to say `unknown` when it could not tell, rather than defaulting to one.
 *
 * That is the whole reason the shape is a union rather than a nullable timestamp: `unknown` and `silent` are
 * different answers, and collapsing them is how a blind check reports a confident result.
 *
 * Pure. The clock is a parameter.
 */

import { businessInstantAfter, businessMsBetween } from "./businessTime.js";

/** How many BUSINESS hours a reviewer is left alone after being asked, before a bump is offered. */
export const BUMP_AFTER_BUSINESS_HOURS = 24;

/** Milliseconds in an hour. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * What was observed in the reviewer's direct message since we wrote to it.
 *
 * `replied` requires the reviewer's OWN identity to have been established, which is what stops the owner's later
 * message counting as an answer. `unknown` is a first-class outcome, not a failure: an unreadable conversation, a
 * missing scope, or a Slack payload that omitted its state fields are all "nothing was established", and none of
 * them may be reported as either silence or a reply.
 */
export type ReviewerActivity =
  | {
      readonly kind: "replied";
      /** The reviewer's Slack user id, as it appeared on the message that ended the silence. */
      readonly bySlackUserId: string;
      readonly atIso: string;
    }
  | { readonly kind: "silent" }
  | {
      readonly kind: "unknown";
      /** Why nothing could be established, in a phrase fit to print beside a refusal. */
      readonly reason: string;
    };

/**
 * Whether a bump may be offered, and the reason when it may not.
 *
 * Every arm carries its own reason rather than the caller composing one, so the sentence the owner reads is
 * written next to the rule that produced it.
 */
export type BumpVerdict =
  | { readonly kind: "due"; readonly silentSinceIso: string; readonly eligibleSinceIso: string }
  | { readonly kind: "replied"; readonly why: string }
  | { readonly kind: "too-soon"; readonly eligibleAtIso: string; readonly why: string }
  | { readonly kind: "unknown"; readonly why: string };

/**
 * Whether the reviewer's own reply is the thing that ended the silence.
 *
 * Compared against the target's id rather than "not us", because a DM can carry a third participant's message in
 * some Slack configurations, and "somebody other than the owner spoke" is not the same claim as "the person we
 * asked answered". Only the latter should stop a chase.
 */
function repliedByTarget({
  activity,
  targetSlackUserId,
}: {
  activity: ReviewerActivity;
  targetSlackUserId: string;
}): boolean {
  return activity.kind === "replied" && activity.bySlackUserId === targetSlackUserId;
}

/**
 * Decide whether the reviewer may be bumped.
 *
 * @param lastSentIso when the last ask or bump was CONFIRMED sent to this reviewer
 * @param activity what was observed in that direct message since — see {@link ReviewerActivity}
 * @param targetSlackUserId the reviewer's Slack user id, so a reply is attributed rather than assumed
 * @param nowIso the reference instant
 * @param afterBusinessHours how many weekday hours the silence must last; defaults to
 *   {@link BUMP_AFTER_BUSINESS_HOURS}
 * @returns whether a bump is due, and why when it is not
 */
export function bumpVerdict({
  lastSentIso,
  activity,
  targetSlackUserId,
  nowIso,
  afterBusinessHours = BUMP_AFTER_BUSINESS_HOURS,
}: {
  lastSentIso: string;
  activity: ReviewerActivity;
  targetSlackUserId: string;
  nowIso: string;
  afterBusinessHours?: number;
}): BumpVerdict {
  if (activity.kind === "unknown") {
    return { kind: "unknown", why: `could not tell whether they replied: ${activity.reason}` };
  }
  if (repliedByTarget({ activity, targetSlackUserId })) {
    return { kind: "replied", why: "they have replied, so there is nothing to chase" };
  }
  const barMs = afterBusinessHours * HOUR_MS;
  const silentMs = businessMsBetween({ fromIso: lastSentIso, toIso: nowIso });
  const eligibleIso = businessInstantAfter({ businessMs: barMs, fromIso: lastSentIso });
  if (silentMs === undefined || eligibleIso === undefined) {
    // Evidence we cannot date is no evidence. Never eligibility: a bump offered off an unparseable clock is a
    // message to a colleague justified by nothing.
    return { kind: "unknown", why: "the last send or the current time is not a readable instant" };
  }
  if (silentMs < barMs) {
    return {
      eligibleAtIso: eligibleIso,
      kind: "too-soon",
      why: `${String(afterBusinessHours)} business hours of silence is the bar, weekends excluded; not bump-eligible until ${eligibleIso}`,
    };
  }
  return { eligibleSinceIso: eligibleIso, kind: "due", silentSinceIso: lastSentIso };
}

/**
 * The follow-up choices to put in front of the owner when a bump is due.
 *
 * Two, because the owner named two: bump the same person, or ask a different person who still satisfies
 * ownership. Neither is ever taken automatically — this function returns what to OFFER.
 *
 * Widening a team to its Slack group is deliberately NOT among them. The picker does report which teams could be
 * widened, and that is shown as context, but a group mention reaches people the owner never chose and cannot be
 * sent under the owner's own name as a personal ask. Offering it as an action would quietly convert "chase a human" into
 * "page a team".
 */
export type FollowUpChoice =
  | { readonly kind: "bump"; readonly login: string; readonly why: string }
  | { readonly kind: "ask-different"; readonly why: string };

/**
 * The choices for a due chase.
 *
 * `ask-different` carries no candidate on purpose: a different reviewer must come from re-running the picker with
 * this person excluded, so naming one here would be this repository guessing at ownership — the exact thing it
 * must not do, since it cannot see CODEOWNERS.
 *
 * @param login the reviewer who has gone quiet
 * @returns the two choices, in the order the owner should read them
 */
export function followUpChoices({ login }: { login: string }): readonly [FollowUpChoice, FollowUpChoice] {
  return [
    { kind: "bump", login, why: `bump ${login} — a business day of silence, which is normal and worth one nudge` },
    {
      kind: "ask-different",
      why: "ask someone else who still satisfies ownership — re-runs the picker with them excluded",
    },
  ];
}
